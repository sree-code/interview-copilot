'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createInterviewStores } = require('../src/main-process/features/interview/stores');
const { createAnswerEngine } = require('../src/main-process/features/interview/answer-engine');

function setup(t, { fastMode = true, chunks = ['I would ', 'use a token bucket.'], chunkDelayMs = 5 } = {}) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'answer-engine-'));
  t.after(() => fs.rmSync(baseDir, { recursive: true, force: true }));
  const stores = createInterviewStores({ baseDir });
  stores.saveProfile({ name: 'Sam', targetCompany: 'Acme', resumeText: 'Backend engineer, payments, Java.', fastMode });
  stores.saveBank([{ question: 'Tell me about yourself.', answer: 'PREPARED: I build payment systems.' }], 'qa.txt');

  const prompts = [];
  const events = [];
  const service = {
    async generateText(prompt, { onChunk, signal }) {
      prompts.push(prompt);
      let text = '';
      for (const chunk of chunks) {
        await new Promise((resolve) => setTimeout(resolve, chunkDelayMs));
        if (signal?.aborted) {
          const error = new Error('aborted');
          error.name = 'AbortError';
          throw error;
        }
        text += chunk;
        onChunk({ text: chunk });
      }
      return text;
    }
  };
  const runtime = {
    isActiveProviderReady: () => true,
    getActiveProgrammingLanguage: () => 'Python',
    executeWithKeyFailover: (operation) => operation(service)
  };
  const engine = createAnswerEngine({
    stores,
    runtime,
    mergeMs: 10,
    sendToRenderer: (channel, data) => events.push({ channel, ...data })
  });
  return { engine, stores, prompts, events };
}

test('fast mode off: lines are recorded but nothing is answered', async (t) => {
  const { engine, stores, prompts } = setup(t, { fastMode: false });
  assert.equal(engine.onTranscriptFinal('system', 'How would you design a rate limiter?'), null);
  assert.equal(prompts.length, 0);
  assert.equal(stores.getEvents()[0].kind, 'host');
});

test('a prepared answer is shown instantly without calling the model', async (t) => {
  const { engine, prompts, events, stores } = setup(t);
  const result = await engine.onTranscriptFinal('system', 'Could you introduce yourself?');
  assert.equal(result.source, 'bank');
  assert.equal(prompts.length, 0);
  assert.deepEqual(events.map((e) => e.channel), ['ai-stream-start', 'ai-stream-chunk', 'ai-stream-end']);
  assert.equal(events[0].label, 'Your prepared answer');
  assert.equal(stores.getQaHistory().at(-1).source, 'bank');
});

test('other questions stream a model answer that uses the profile', async (t) => {
  const { engine, prompts, events, stores } = setup(t);
  const result = await engine.onTranscriptFinal('system', 'How would you design a rate limiter for an API?');
  assert.equal(result.source, 'llm');
  assert.equal(result.text, 'I would use a token bucket.');
  assert.match(prompts[0], /Backend engineer, payments, Java/);
  assert.match(prompts[0], /The interviewer just asked: "How would you design a rate limiter for an API\?"/);
  assert.equal(events.filter((e) => e.channel === 'ai-stream-chunk').length, 2);
  assert.equal(stores.getQaHistory().at(-1).answer, 'I would use a token bucket.');
});

test('an interviewer interruption cancels the answer and writes a follow-up', async (t) => {
  const { engine, prompts, events } = setup(t, { chunks: ['one ', 'two ', 'three ', 'four ', 'five'], chunkDelayMs: 25 });
  const first = engine.onTranscriptFinal('system', 'How would you design a rate limiter for an API?');
  await new Promise((resolve) => setTimeout(resolve, 70));
  const second = engine.onTranscriptFinal('system', 'Wait, what about distributed clients?');
  const [firstResult, secondResult] = await Promise.all([first, second]);

  assert.equal(firstResult.interrupted, true);
  assert.equal(secondResult.source, 'llm');
  assert.match(prompts[1], /The interviewer interrupted\. Previous question: "How would you design a rate limiter for an API\?"/);
  assert.match(prompts[1], /The interviewer just said: "Wait, what about distributed clients\?"/);
  const ends = events.filter((e) => e.channel === 'ai-stream-end');
  assert.equal(ends[0].interrupted, true);
  assert.equal(ends[1].interrupted, false);
});

test('a short "mm-hm" while an answer streams does not interrupt it', async (t) => {
  const { engine, prompts } = setup(t, { chunks: ['a ', 'b ', 'c'], chunkDelayMs: 20 });
  const first = engine.onTranscriptFinal('system', 'How do you handle on-call incidents?');
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(engine.onTranscriptFinal('system', 'Mm-hm.'), null);
  const result = await first;
  assert.equal(result.interrupted, undefined);
  assert.equal(prompts.length, 1);
});

test('your own lines are stored as speaking-style samples, not answered', async (t) => {
  const { engine, stores, prompts } = setup(t);
  await engine.onTranscriptFinal('system', 'Tell me about your current project.');
  engine.onTranscriptFinal('mic', 'So basically we rebuilt the ledger, and honestly the hard part was the backfill, we ran it for like three weeks in shadow mode.');
  assert.equal(prompts.length, 1);
  assert.equal(stores.getSpokenAnswers({ minWords: 10 }).length, 1);
});
