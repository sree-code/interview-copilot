'use strict';

// Key terms, job-post import, meeting detection, telemetry, vision
// fallback and AssemblyAI ForceEndpoint.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');

const { extractKeyterms } = require('../src/main-process/features/interview/keyterms');
const { parseJobPage, importJobFromUrl } = require('../src/main-process/features/interview/job-url');
const { parseMicInUse, createMeetingDetector } = require('../src/main-process/features/meeting/meeting-detector');
const { createTelemetry, cleanProps, errorKind } = require('../src/main-process/features/telemetry/telemetry');
const { createTelemetryObserver } = require('../src/main-process/features/telemetry/observer');
const { OpenAICompatibleService } = require('../src/services/ai/openai-compatible-service');
const { createAssemblyAiService } = require('../src/services/assembly-ai/service');
const { sanitizeProfile } = require('../src/main-process/features/interview/stores');
const { buildPersonalContext } = require('../src/main-process/features/interview/personal-context');

// ── Key terms ──
test('key terms: manual first, then company, role and tech words; deduped and capped', () => {
  const terms = extractKeyterms({
    keyterms: 'Sorbet, Ruby on Rails\nsorbet',
    targetCompany: 'Stripe',
    targetRole: 'Backend Engineer',
    jobDescription: 'We use Kubernetes, PostgreSQL and gRPC on AWS. The team ships APIs. Experience with C++ or Node.js.',
    resumeText: 'Built React apps on EC2 at Google.'
  });
  assert.deepEqual(terms.slice(0, 4), ['Sorbet', 'Ruby on Rails', 'Stripe', 'Backend Engineer']);
  for (const word of ['Kubernetes', 'PostgreSQL', 'gRPC', 'AWS', 'C++', 'Node.js', 'EC2', 'React', 'Google']) {
    assert.ok(terms.includes(word), `missing ${word}`);
  }
  for (const word of ['We', 'The', 'Experience', 'Built']) assert.ok(!terms.includes(word), `should skip ${word}`);
  const many = extractKeyterms({ keyterms: Array.from({ length: 150 }, (_, i) => `Term${i}x`).join(',') });
  assert.equal(many.length, 100);
});

test('profile keeps language and answer timing only when valid; language reaches the prompt', () => {
  assert.equal(sanitizeProfile({ language: 'es' }).language, 'es');
  assert.equal(sanitizeProfile({ language: 'xx' }).language, 'en');
  assert.equal(sanitizeProfile({ answerTiming: 'fast' }).answerTiming, 'fast');
  assert.equal(sanitizeProfile({ answerTiming: 'instant' }).answerTiming, 'balanced');
  assert.match(buildPersonalContext({ profile: { language: 'es' } }), /Write every answer in Spanish/);
  assert.doesNotMatch(buildPersonalContext({ profile: { language: 'en', name: 'A' } }), /LANGUAGE/);
});

// ── Job post import ──
test('job post: reads schema.org JobPosting, including @graph and encoded HTML', () => {
  const html = `<script type="application/ld+json">{"@graph":[{"@type":"WebPage"},{"@type":"JobPosting","title":"Backend Engineer","hiringOrganization":{"name":"Acme &amp; Co"},"description":"&lt;p&gt;Build APIs&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Go&lt;/li&gt;&lt;/ul&gt;"}]}</script>`;
  const job = parseJobPage(html);
  assert.equal(job.source, 'job-posting');
  assert.equal(job.role, 'Backend Engineer');
  assert.equal(job.company, 'Acme & Co');
  assert.equal(job.jobDescription, 'Build APIs\n\n- Go');
});

test('job post: falls back to page text, and rejects bad links and short pages', async () => {
  const body = 'About the role. '.repeat(30);
  const html = `<html><head><title>Data Engineer - Globex</title><meta property="og:site_name" content="Globex"></head><body><nav>menu</nav><p>${body}</p><script>x()</script></body></html>`;
  const job = parseJobPage(html);
  assert.equal(job.source, 'page-text');
  assert.equal(job.role, 'Data Engineer');
  assert.equal(job.company, 'Globex');
  assert.ok(!job.jobDescription.includes('menu') && !job.jobDescription.includes('x()'));

  await assert.rejects(importJobFromUrl('file:///etc/passwd'), /http/);
  await assert.rejects(importJobFromUrl('not a url'), /valid link/);
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => '<html><body>Sign in</body></html>' });
  await assert.rejects(importJobFromUrl('https://example.com/job', { fetchImpl }), /Paste it instead/);
});

// ── Meeting detection ──
const REG = [
  'HKEY_CURRENT_USER\\Software\\x\\microphone\\MSTeams_8wekyb3d8bbwe',
  '    LastUsedTimeStart    REG_QWORD    0x1dc1',
  '    LastUsedTimeStop    REG_QWORD    0x0',
  '',
  'HKEY_CURRENT_USER\\Software\\x\\microphone\\NonPackaged\\C:#Program Files#Zoom#Zoom.exe',
  '    LastUsedTimeStop    REG_QWORD    0x1dc2',
  '',
  'HKEY_CURRENT_USER\\Software\\x\\microphone\\NonPackaged\\C:#Apps#Meeting Assistant.exe',
  '    LastUsedTimeStop    REG_QWORD    0x0'
].join('\r\n');

test('meeting detection: apps with LastUsedTimeStop 0 are using the mic (ours excluded)', () => {
  assert.deepEqual(parseMicInUse(REG, { ownExe: 'C:\\Apps\\Meeting Assistant.exe' }), ['MSTeams_8wekyb3d8bbwe']);
});

test('meeting detection: reports a call once, and not while listening', async () => {
  const seen = [];
  let listening = false;
  const detector = createMeetingDetector({
    platform: 'win32',
    exec: async () => REG,
    ownExe: 'C:\\Apps\\Meeting Assistant.exe',
    isListening: () => listening,
    onDetected: (app) => seen.push(app.app),
    setInterval: () => ({ unref() {} }),
    clearInterval: () => {}
  });
  await detector.check();
  await detector.check();
  assert.deepEqual(seen, ['teams']);
  const idle = createMeetingDetector({ platform: 'win32', exec: async () => REG, isListening: () => true, onDetected: (a) => seen.push(a.app) });
  await idle.check();
  assert.deepEqual(seen, ['teams']);
  listening = true;
});

// ── Telemetry ──
function fakeApp(dir) {
  return { getPath: () => dir, getVersion: () => '1.2.3', isPackaged: false, getLocale: () => 'en-US' };
}
function telemetryWith(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'telemetry-'));
  const sent = [];
  const telemetry = createTelemetry({
    app: fakeApp(dir),
    config: { host: 'https://ingest.example', projectKey: 'phc_test' },
    env: {},
    argv: [],
    fetchImpl: async (url, init) => { sent.push({ url, body: JSON.parse(init.body) }); return { ok: true, status: 200 }; },
    setInterval: () => ({ unref() {} }),
    clearInterval: () => {},
    ...options
  });
  return { telemetry, sent, dir };
}

test('telemetry: nothing is recorded or sent before the user says yes', async () => {
  const { telemetry, sent } = telemetryWith();
  assert.equal(telemetry.getStatus().askUser, true);
  assert.equal(telemetry.track('app_started', { startup_ms: 900 }), false);
  await telemetry.flush();
  assert.equal(sent.length, 0);
  telemetry.setConsent(false);
  assert.equal(telemetry.track('app_started'), false);
  assert.equal(telemetry.getStatus().askUser, false);
});

test('telemetry: after opt-in, batches go to /batch/ with anonymous id and safe props only', async () => {
  const { telemetry, sent, dir } = telemetryWith();
  telemetry.setConsent(true);
  telemetry.track('answer_shown', { first_word_ms: 312.456, source: 'llm', transcript: 'word '.repeat(40), 'Bad Key': 1, nested: { a: 1 }, key: 'gsk_abcdefghijklmnopqrstuvwxyz123456' });
  await telemetry.flush();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, 'https://ingest.example/batch/');
  assert.equal(sent[0].body.api_key, 'phc_test');
  const event = sent[0].body.batch.find((e) => e.event === 'answer_shown');
  assert.equal(event.properties.first_word_ms, 312.46);
  assert.equal(event.properties.app_version, '1.2.3');
  assert.equal(event.properties.transcript.length, 80);
  assert.equal(event.properties.key, '[redacted]');
  assert.ok(!('nested' in event.properties) && !('Bad Key' in event.properties));
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'telemetry.json'), 'utf8'));
  assert.equal(event.properties.distinct_id, saved.installId);
});

test('telemetry: off in CI, smoke tests and with COPILOT_TELEMETRY=0; no key = off', () => {
  assert.equal(telemetryWith({ env: { CI: 'true' } }).telemetry.getStatus().configured, false);
  assert.equal(telemetryWith({ argv: ['--smoke-test'] }).telemetry.getStatus().configured, false);
  assert.equal(telemetryWith({ env: { COPILOT_TELEMETRY: '0' } }).telemetry.getStatus().configured, false);
  assert.equal(telemetryWith({ config: { host: 'https://x', projectKey: '' } }).telemetry.getStatus().configured, false);
});

test('telemetry: errors keep only a category and status; failed sends are retried', async () => {
  assert.deepEqual(errorKind(new Error('groq API error 429: rate limit reached for user ...')), { error_kind: 'rate_limit', http_status: 429 });
  assert.deepEqual(errorKind('Invalid API key provided'), { error_kind: 'auth' });
  assert.deepEqual(cleanProps({ ok: true, n: Infinity }), { ok: true });
  let fail = true;
  const sent = [];
  const { telemetry } = telemetryWith({ fetchImpl: async (_u, init) => { if (fail) throw new Error('offline'); sent.push(JSON.parse(init.body)); return { ok: true }; } });
  telemetry.setConsent(true);
  telemetry.track('feature_used', { feature: 'compact' });
  await telemetry.flush();
  fail = false;
  await telemetry.flush();
  assert.equal(sent[0].batch.length, 2); // opt-in + feature_used
});

test('telemetry observer: measures answer speed from stream events without reading text', async () => {
  const tracked = [];
  const timings = [];
  let clock = 1000;
  const observer = createTelemetryObserver({
    telemetry: { track: (e, p) => tracked.push({ e, p }), timing: (n, ms) => timings.push({ n, ms }), trackError: (area, err) => tracked.push({ e: 'error', p: { area, err } }), timingSummary: () => ({}) },
    getModelInfo: () => ({ provider: 'openai-compatible', model: 'm' }),
    now: () => clock
  });
  observer.observe('ai-stream-start', { actionId: 'autoAnswer', answerId: 'a1', source: 'llm' });
  clock += 280;
  observer.observe('ai-stream-chunk', { actionId: 'autoAnswer', answerId: 'a1', text: 'Hello' });
  clock += 400;
  observer.observe('ai-stream-end', { actionId: 'autoAnswer', answerId: 'a1', source: 'llm' });
  const shown = tracked.find((t) => t.e === 'answer_shown');
  assert.equal(shown.p.first_word_ms, 280);
  assert.equal(shown.p.total_ms, 680);
  assert.equal(shown.p.kind, 'live');
  assert.equal(shown.p.chars, 5);
  assert.equal(JSON.stringify(shown).includes('Hello'), false);
  assert.deepEqual(timings, [{ n: 'live_first_word', ms: 280 }]);
  observer.observe('vosk-status', { source: 'system', status: 'listening' });
  observer.observe('vosk-stopped', { source: 'system' });
  assert.ok(tracked.some((t) => t.e === 'listening_started') && tracked.some((t) => t.e === 'listening_stopped'));
});

// ── Vision with fallback ──
test('Groq: screenshots go to the vision model; if it fails, the answer uses screen text', async () => {
  const bodies = [];
  let visionFails = false;
  const service = new OpenAICompatibleService({
    preset: 'groq',
    apiKey: 'k',
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      bodies.push(body);
      if (Array.isArray(body.messages[0].content) && visionFails) return { ok: false, status: 404, text: async () => 'model not found' };
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'answer' } }] }) };
    }
  });
  const image = { inlineData: { mimeType: 'image/jpeg', data: 'QUJD' } };
  assert.equal(await service.analyzeScreenshots([image], 'screen text'), 'answer');
  assert.equal(bodies[0].model, 'meta-llama/llama-4-scout-17b-16e-instruct');
  assert.ok(!('reasoning_effort' in bodies[0]));
  assert.equal(bodies[0].messages[0].content[1].type, 'image_url');

  visionFails = true;
  bodies.length = 0;
  assert.equal(await service.analyzeScreenshots([image], 'screen text'), 'answer');
  assert.equal(bodies.length, 2);
  assert.equal(bodies[1].model, 'openai/gpt-oss-20b');
  assert.equal(typeof bodies[1].messages[0].content, 'string');
});

// ── AssemblyAI ──
class FakeSocket extends EventEmitter {
  static OPEN = 1;
  constructor(url) { super(); this.url = url; this.readyState = 1; this.sent = []; FakeSocket.last = this; }
  send(data) { this.sent.push(data); }
  terminate() {}
}

function sttService(getStreamOptions = () => ({})) {
  const finals = [];
  const service = createAssemblyAiService({
    WebSocket: FakeSocket,
    desktopCapturer: {},
    getAssemblyApiKey: () => 'key',
    getSpeechModel: () => 'universal-streaming-english',
    getGeminiService: () => null,
    sendToRenderer: () => {},
    onFinalTranscript: (source, text, meta) => finals.push({ source, text, meta }),
    getStreamOptions
  });
  return { service, finals };
}
const message = (ws, msg) => ws.emit('message', Buffer.from(JSON.stringify(msg)));

test('AssemblyAI: key terms, language model and turn settings go into the connection URL', () => {
  const { service } = sttService(() => ({ keyterms: ['Kubernetes', 'x'.repeat(60)], speechModel: 'universal-streaming-multilingual', turnParams: { max_turn_silence: 900 } }));
  service.startAssemblyAiStream('system');
  const url = new URL(FakeSocket.last.url);
  assert.deepEqual(JSON.parse(url.searchParams.get('keyterms_prompt')), ['Kubernetes']);
  assert.equal(url.searchParams.get('speech_model'), 'universal-streaming-multilingual');
  assert.equal(url.searchParams.get('max_turn_silence'), '900');
  service.dispose();
});

test('AssemblyAI: Ask AI closes an open turn with ForceEndpoint and waits for the final', async () => {
  const { service, finals } = sttService();
  service.startAssemblyAiStream('system');
  const ws = FakeSocket.last;
  ws.emit('open');
  assert.equal(await service.forceEndpoint('system'), false); // nothing open
  message(ws, { type: 'Turn', transcript: 'tell me about your', end_of_turn: false });
  const pending = service.forceEndpoint('system');
  assert.equal(JSON.parse(ws.sent[ws.sent.length - 1]).type, 'ForceEndpoint');
  message(ws, { type: 'Turn', transcript: 'Tell me about your last project.', end_of_turn: true });
  assert.equal(await pending, true);
  assert.equal(finals[0].meta.forced, true);
  service.dispose();
});
