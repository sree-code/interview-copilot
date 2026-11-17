'use strict';

// End-to-end test of the live pipeline with real services, no microphone.
//
//   npm run test:live
//
// 1. Generates a mock interview with macOS `say`: an interviewer track and a
//    "mic" track containing the candidate's answers PLUS a quieter copy of
//    the interviewer (speaker echo).
// 2. Streams both tracks in real time through the app's own AssemblyAI
//    service (with the echo filter) — the same code the app runs.
// 3. Final lines go to the answer engine in fast mode with a prepared Q&A
//    bank, using your model key, and timings are printed.
//
// Needs in .env: ASSEMBLY_AI_API_KEY, and either FAST_LLM_PRESET +
// the preset's key (e.g. GROQ_API_KEY) or GEMINI_API_KEY.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const WebSocket = require('ws');
const { createAssemblyAiService } = require('../src/services/assembly-ai/service');
const { createGeminiRuntime } = require('../src/main-process/features/assistant/gemini-runtime');
const { createInterviewStores } = require('../src/main-process/features/interview/stores');
const { createAnswerEngine } = require('../src/main-process/features/interview/answer-engine');

const SAMPLE_RATE = 16000;
const FRAME_SAMPLES = 1600; // 100 ms, same as the app
const ECHO_GAIN = 0.3;

const SCRIPT = [
  { who: 'host', text: 'Thanks for joining today. Could you introduce yourself?', gapAfter: 1.0 },
  { who: 'you', text: "Sure. So I'm a backend engineer, I've spent about five years on payment systems, mostly Java and Kafka.", gapAfter: 2.5 },
  { who: 'host', text: 'How would you design a rate limiter for a public API?', gapAfter: 2.2 },
  { who: 'host', text: 'Sorry, and how would that work across multiple regions?', gapAfter: 6.0 },
  { who: 'host', text: 'What would you say are your weaknesses?', gapAfter: 6.0 }
];

const BANK = [
  { question: 'Tell me about yourself.', answer: "I'm a backend engineer with five years in payments. Most recently I led the ledger rebuild at my current company." },
  { question: 'What is your biggest weakness?', answer: 'I used to over-polish code reviews; now I time-box them and leave non-blocking nits as suggestions.' }
];

function requireEnv() {
  const missing = [];
  if (!process.env.ASSEMBLY_AI_API_KEY) missing.push('ASSEMBLY_AI_API_KEY');
  if (!process.env.FAST_LLM_PRESET && !process.env.GEMINI_API_KEY) missing.push('FAST_LLM_PRESET + its key, or GEMINI_API_KEY');
  if (missing.length) {
    console.error(`Missing in .env: ${missing.join(', ')}`);
    process.exit(2);
  }
  if (process.platform !== 'darwin') {
    console.error('This test uses macOS `say` to generate speech.');
    process.exit(2);
  }
}

function synthesize(text, voice, dir, name) {
  const aiff = path.join(dir, `${name}.aiff`);
  const wav = path.join(dir, `${name}.wav`);
  execFileSync('say', ['-v', voice, '-o', aiff, text]);
  execFileSync('afconvert', ['-f', 'WAVE', '-d', `LEI16@${SAMPLE_RATE}`, '-c', '1', aiff, wav]);
  const buffer = fs.readFileSync(wav);
  const dataOffset = buffer.indexOf(Buffer.from('data')) + 8;
  return new Int16Array(buffer.buffer.slice(buffer.byteOffset + dataOffset, buffer.byteOffset + buffer.length));
}

function buildTracks(dir) {
  const host = [];
  const mic = [];
  const marks = [];
  let cursor = 0;
  const push = (track, samples, at) => {
    for (let i = 0; i < samples.length; i += 1) {
      const index = at + i;
      track[index] = Math.max(-32768, Math.min(32767, (track[index] || 0) + samples[i]));
    }
  };

  SCRIPT.forEach((line, index) => {
    const samples = synthesize(line.text, line.who === 'host' ? 'Samantha' : 'Daniel', dir, `line${index}`);
    if (line.who === 'host') {
      push(host, samples, cursor);
      // Speaker echo reaches the mic ~30 ms later, quieter.
      push(mic, samples.map((s) => Math.round(s * ECHO_GAIN)), cursor + Math.round(0.03 * SAMPLE_RATE));
    } else {
      push(mic, samples, cursor);
    }
    marks.push({ ...line, endsAt: (cursor + samples.length) / SAMPLE_RATE });
    cursor += samples.length + Math.round(line.gapAfter * SAMPLE_RATE);
  });

  const length = cursor + SAMPLE_RATE * 4;
  const fill = (track) => Int16Array.from({ length }, (_, i) => track[i] || 0);
  return { host: fill(host), mic: fill(mic), marks, seconds: length / SAMPLE_RATE };
}

async function main() {
  requireEnv();
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'live-pipeline-'));
  const started = Date.now();
  const at = () => ((Date.now() - started) / 1000).toFixed(1).padStart(5);
  const log = (...args) => console.log(`[${at()}s]`, ...args);

  console.log('Generating mock interview audio with `say`...');
  const tracks = buildTracks(workDir);
  console.log(`Audio: ${tracks.seconds.toFixed(1)} s per track (interviewer + mic with echo)\n`);

  const runtime = createGeminiRuntime();
  if (process.env.FAST_LLM_PRESET) {
    runtime.setActiveAiProvider('openai-compatible');
    runtime.setFastLlmConfig({});
  } else {
    runtime.setActiveAiProvider('gemini');
    runtime.setKeys(process.env.GEMINI_API_KEY.split(',').map((k) => k.trim()).filter(Boolean), 0);
  }
  runtime.initializeAiService();
  const providerLabel = process.env.FAST_LLM_PRESET
    ? `${runtime.getFastLlmConfig().preset} / ${runtime.getFastLlmConfig().model}`
    : `gemini / ${runtime.getActiveGeminiModel()}`;
  console.log(`Model: ${providerLabel}`);

  const stores = createInterviewStores({ baseDir: path.join(workDir, 'interview') });
  stores.saveProfile({
    name: 'Test Candidate',
    currentRole: 'Backend Engineer',
    targetCompany: 'Acme',
    targetRole: 'Senior Backend Engineer',
    resumeText: 'Backend engineer, 5 years in payments. Java, Kafka, PostgreSQL, Redis. Led ledger rebuild.',
    fastMode: true
  });
  stores.saveBank(BANK, 'mock-qa');

  const results = { finals: { system: [], mic: [] }, echoDropped: [], answers: [], turnDelays: [] };
  let lineEnds;
  let frameSentAt = [];
  const answerTimers = new Map();

  const engine = createAnswerEngine({
    stores,
    runtime,
    sendToRenderer: (channel, data) => {
      if (data?.actionId !== 'autoAnswer') return;
      if (channel === 'ai-stream-start') {
        answerTimers.set(data.answerId, { start: Date.now(), first: null, text: '', label: data.label, question: data.question });
        log(`→ ${data.label} for: "${data.question}"`);
      } else if (channel === 'ai-stream-chunk') {
        const entry = answerTimers.get(data.answerId);
        if (entry && entry.first === null) entry.first = Date.now();
        if (entry) entry.text += data.text;
      } else if (channel === 'ai-stream-end') {
        const entry = answerTimers.get(data.answerId) || {};
        const firstMs = entry.first ? entry.first - entry.start : null;
        const summary = data.error ? `ERROR ${data.error}` : data.interrupted ? 'INTERRUPTED' : 'done';
        log(`← ${summary}: first text after ${firstMs ?? '-'} ms, total ${Date.now() - (entry.start || Date.now())} ms`);
        if (entry.text) log(`   "${entry.text.replace(/\s+/g, ' ').trim().slice(0, 220)}"`);
        results.answers.push({ ...entry, firstMs, interrupted: Boolean(data.interrupted), error: data.error || null });
      }
    }
  });

  const pending = [];
  const assembly = createAssemblyAiService({
    WebSocket,
    desktopCapturer: null,
    getAssemblyApiKey: () => process.env.ASSEMBLY_AI_API_KEY,
    getSpeechModel: () => process.env.ASSEMBLY_AI_SPEECH_MODEL || 'universal-streaming-english',
    getGeminiService: () => null,
    sendToRenderer: (channel, data) => {
      if (channel === 'vosk-error') log(`STT error [${data.source}]: ${data.error || data.message}`);
      if (channel === 'stt-debug' && data?.event === 'echo-suppressed') {
        results.echoDropped.push(data.meta.text);
        log(`  ✂ echo dropped (mic): "${data.meta.text}"`);
      }
    },
    onFinalTranscript: (source, text) => {
      results.finals[source].push(text);
      if (source === 'system' && typeof lineEnds !== 'undefined') {
        // Delay since the frame holding the end of the latest finished
        // interviewer line was actually sent.
        const spokenEnd = lineEnds.filter((mark) => mark.who === 'host' && frameSentAt[mark.endFrame]).pop();
        if (spokenEnd) results.turnDelays.push(Math.round(Date.now() - frameSentAt[spokenEnd.endFrame]));
      }
      log(`${source === 'system' ? 'INTERVIEWER' : 'YOU        '}: ${text}`);
      const promise = engine.onTranscriptFinal(source, text);
      if (promise) pending.push(promise);
    }
  });

  for (const source of ['system', 'mic']) {
    const result = assembly.startAssemblyAiStream(source);
    if (!result.success) throw new Error(`Could not start ${source}: ${result.error}`);
  }
  await new Promise((resolve) => setTimeout(resolve, 1500));

  console.log('\nStreaming audio in real time...\n');
  const streamStartedAt = Date.now();
  frameSentAt = [];
  lineEnds = tracks.marks.map((mark) => ({ ...mark, endFrame: Math.floor((mark.endsAt * SAMPLE_RATE) / FRAME_SAMPLES) }));
  const frames = Math.ceil(tracks.host.length / FRAME_SAMPLES);
  for (let frame = 0; frame < frames; frame += 1) {
    const from = frame * FRAME_SAMPLES;
    for (const [source, track] of [['system', tracks.host], ['mic', tracks.mic]]) {
      const chunk = track.slice(from, from + FRAME_SAMPLES);
      assembly.handleAudioChunk({ source, data: Buffer.from(chunk.buffer) });
    }
    frameSentAt[frame] = Date.now();
    // Keep exact real-time pace (no drift from timer overhead).
    const nextAt = streamStartedAt + (frame + 1) * 100;
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, nextAt - Date.now())));
  }

  await new Promise((resolve) => setTimeout(resolve, 3000));
  assembly.stopVoiceRecognition({ source: 'all' });
  await Promise.allSettled(pending);
  await new Promise((resolve) => setTimeout(resolve, 1500));

  // ── Report ──
  const hostLines = SCRIPT.filter((line) => line.who === 'host').length;
  const echoedIntoMic = results.finals.mic.filter((text) => /introduce|rate limiter|regions|weakness/i.test(text));
  const bankAnswers = results.answers.filter((a) => a.label === 'Your prepared answer');
  const modelAnswers = results.answers.filter((a) => a.label === 'Suggested answer' && !a.error);
  const firstTokenTimes = modelAnswers.map((a) => a.firstMs).filter((ms) => ms !== null);

  console.log('\n──────── Result ────────');
  console.log(`Interviewer lines spoken: ${hostLines}, transcribed finals: ${results.finals.system.length}`);
  console.log(`Your lines transcribed: ${results.finals.mic.length}; echo lines dropped: ${results.echoDropped.length}; echo that got through: ${echoedIntoMic.length}`);
  console.log(`Prepared answers used: ${bankAnswers.length} (expected 2: introduce yourself, weaknesses)`);
  console.log(`Model answers: ${modelAnswers.length}; interrupted: ${results.answers.filter((a) => a.interrupted).length}; errors: ${results.answers.filter((a) => a.error).length}`);
  if (results.turnDelays.length) {
    console.log(`Interviewer stops talking -> final transcript: ${results.turnDelays.join(' ms, ')} ms`);
  }
  if (firstTokenTimes.length) {
    console.log(`Model time to first text: ${firstTokenTimes.join(' ms, ')} ms`);
  }
  console.log(`Session file: ${path.join(workDir, 'interview', 'session.jsonl')}`);

  const ok = results.finals.system.length > 0 && echoedIntoMic.length === 0 && bankAnswers.length >= 1 && results.answers.every((a) => !a.error);
  console.log(ok ? '\nPASS' : '\nCHECK THE LOG ABOVE');
  process.exitCode = ok ? 0 : 1;
  setTimeout(() => process.exit(), 500);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
