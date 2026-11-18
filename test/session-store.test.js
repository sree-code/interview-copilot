'use strict';

// Tests the Astryx UI's logic layer (src/windows/assistant/app/engine) with
// a fake electronAPI. The engine is ESM for the browser, so it's bundled to
// CommonJS with esbuild first.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const esbuild = require('esbuild');

const outfile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'engine-')), 'engine.cjs');
esbuild.buildSync({
  entryPoints: [path.join(__dirname, '..', 'src', 'windows', 'assistant', 'app', 'engine', 'session-store.js')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  logLevel: 'error'
});
global.window = { addEventListener() {} };
const { createSessionStore } = require(outfile);

function fakeApi(overrides = {}) {
  const handlers = {};
  const on = (name) => (fn) => { (handlers[name] ||= []).push(fn); return () => {}; };
  const api = {
    emit: (name, data) => (handlers[name] || []).forEach((fn) => fn(data)),
    getSettings: async () => ({ aiProvider: 'openai-compatible', fastLlm: { apiKey: 'k' }, hasAssemblyAiApiKey: true }),
    interviewGetState: async () => ({ profile: { fastMode: true }, bank: { count: 2 }, session: { questions: 0 } }),
    getMobileServerStatus: async () => ({}),
    sendAudioChunk() {},
    ...overrides
  };
  for (const name of ['onScreenshotTakenStealth', 'onAnalysisStart', 'onAnalysisResult', 'onEmergencyClear', 'onError', 'onVoskStatus', 'onVoskPartial', 'onVoskFinal', 'onVoskError', 'onVoskStopped', 'onToggleVoiceRecognition', 'onTriggerAskAi', 'onSttDebug', 'onAiStreamStart', 'onAiStreamChunk', 'onAiStreamEnd', 'onClearFromMobile', 'onMobileServerStatus']) {
    api[name] = on(name);
  }
  return api;
}

async function ready(api) {
  const store = createSessionStore(api);
  await store.init();
  return store;
}

const visible = (store) => store.getState().messages
  .filter((m) => m.type !== 'system')
  .map((m) => `${m.type}:${m.label ? `${m.label}:` : ''}${m.content}`);

test('detects configured keys from settings', async () => {
  const store = await ready(fakeApi());
  assert.equal(store.getState().hasModelKey, true);
  assert.equal(store.getState().hasAssemblyKey, true);
});

test('interviewer line appears at once and stays above its answer', async () => {
  const api = fakeApi();
  const store = await ready(api);
  api.emit('onVoskFinal', { source: 'system', text: 'Could you introduce yourself?' });
  api.emit('onAiStreamStart', { actionId: 'autoAnswer', answerId: 'a1', label: 'Your prepared answer' });
  api.emit('onAiStreamChunk', { actionId: 'autoAnswer', answerId: 'a1', text: 'I build payment systems.' });
  api.emit('onAiStreamEnd', { actionId: 'autoAnswer', answerId: 'a1' });
  api.emit('onVoskFinal', { source: 'system', text: 'And why this company?' });
  assert.deepEqual(visible(store), [
    'voice-system:Could you introduce yourself?',
    'ai-response:Your prepared answer:I build payment systems.',
    'voice-system:And why this company?'
  ]);
});

test('consecutive interviewer fragments merge into one line', async () => {
  const api = fakeApi();
  const store = await ready(api);
  api.emit('onVoskFinal', { source: 'system', text: 'Tell me about' });
  api.emit('onVoskFinal', { source: 'system', text: 'a hard bug you fixed.' });
  assert.deepEqual(visible(store), ['voice-system:Tell me about a hard bug you fixed.']);
});

test('interrupted live answer is marked and stops streaming', async () => {
  const api = fakeApi();
  const store = await ready(api);
  api.emit('onAiStreamStart', { actionId: 'autoAnswer', answerId: 'a1', label: 'Suggested answer' });
  api.emit('onAiStreamChunk', { actionId: 'autoAnswer', answerId: 'a1', text: 'First I would' });
  api.emit('onAiStreamEnd', { actionId: 'autoAnswer', answerId: 'a1', interrupted: true });
  const answer = store.getState().messages.find((m) => m.type === 'ai-response');
  assert.equal(answer.streaming, false);
  assert.match(answer.note, /Interrupted/);
});

test('other actions\' stream chunks do not leak into live answers', async () => {
  const api = fakeApi();
  const store = await ready(api);
  api.emit('onAiStreamStart', { actionId: 'autoAnswer', answerId: 'a1', label: 'Suggested answer' });
  api.emit('onAiStreamChunk', { actionId: 'askAi', text: 'unrelated' });
  api.emit('onAiStreamChunk', { actionId: 'autoAnswer', answerId: 'a1', text: 'mine' });
  assert.equal(store.getState().messages.find((m) => m.type === 'ai-response').content, 'mine');
});

test('Listen without an AssemblyAI key shows an error instead of starting', async () => {
  const toasts = [];
  const api = fakeApi({ getSettings: async () => ({ aiProvider: 'gemini', hasGeminiApiKeys: false, hasAssemblyAiApiKey: false }) });
  const store = await ready(api);
  store.onToast((t) => toasts.push(t));
  await store.actions.toggleTranscription();
  assert.equal(toasts[0]?.type, 'error');
  assert.equal(store.getState().sources.system.status, 'off');
});

test('manual context is added as a You line and used as AI context', async () => {
  const store = await ready(fakeApi());
  store.actions.addManualContext('I prefer Kotlin');
  assert.match(store.contextBundle().contextString, /You: I prefer Kotlin/);
});

test('compact mode follows the main process', async () => {
  const calls = [];
  const api = fakeApi({ setCompactMode: async (on) => { calls.push(on); return { compact: on }; }, getCompactMode: async () => false });
  api.onCompactModeChanged = (fn) => { api._compact = fn; return () => {}; };
  const store = await ready(api);
  await store.actions.toggleCompact();
  assert.deepEqual(calls, [true]);
  assert.equal(store.getState().compact, true);
  api._compact(false); // e.g. Alt+Shift+M pressed while another app has focus
  assert.equal(store.getState().compact, false);
});

test('panel background level is clamped to 0-100', async () => {
  const store = await ready(fakeApi());
  store.actions.setBackgroundLevel(140);
  assert.equal(store.getState().backgroundLevel, 100);
  store.actions.setBackgroundLevel(-5);
  assert.equal(store.getState().backgroundLevel, 0);
});

test('answer pager flips through answers and returns to following the latest', async () => {
  const api = fakeApi();
  const store = await ready(api);
  for (const id of ['a1', 'a2', 'a3']) {
    api.emit('onAiStreamStart', { actionId: 'autoAnswer', answerId: id });
    api.emit('onAiStreamEnd', { actionId: 'autoAnswer', answerId: id });
  }
  assert.equal(store.getState().pagerIndex, null);
  store.actions.answerNav('previous');
  assert.equal(store.getState().pagerIndex, 1);
  store.actions.answerNav('previous');
  store.actions.answerNav('previous');
  assert.equal(store.getState().pagerIndex, 0);
  store.actions.answerNav('next');
  store.actions.answerNav('next');
  assert.equal(store.getState().pagerIndex, null);
  const seq = store.getState().scrollRequest.seq;
  store.actions.answerNav('down');
  assert.deepEqual(store.getState().scrollRequest, { dir: 'down', seq: seq + 1 });
});

test('text size steps and Ask AI closes an open interviewer turn first', async () => {
  const calls = [];
  const api = fakeApi({
    setZoomFactor: async (f) => calls.push(['zoom', f]),
    forceEndpoint: async (source) => { calls.push(['force', source]); return true; },
    askAiWithSessionContext: async () => { calls.push(['ask']); return { success: true, text: 'ok' }; },
    onAiStreamChunk: () => () => {}
  });
  const store = await ready(api);
  store.actions.zoomText('in');
  assert.equal(store.getState().prefs.textZoom, 1.1);
  store.actions.zoomText('reset');
  assert.equal(store.getState().prefs.textZoom, 1);
  api.emit('onVoskStatus', { source: 'system', status: 'listening' });
  api.emit('onVoskFinal', { source: 'system', text: 'Earlier line.' });
  api.emit('onVoskPartial', { source: 'system', text: 'and how would you' });
  await store.actions.askAi();
  assert.deepEqual(calls.filter((c) => c[0] !== 'zoom'), [['force', 'system'], ['ask']]);
});
