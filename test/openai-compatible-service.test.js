'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { OpenAICompatibleService } = require('../src/services/ai/openai-compatible-service');

function sseResponse(deltas, { delayMs = 0, signal } = {}) {
  const encoder = new TextEncoder();
  async function* body() {
    for (const delta of deltas) {
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
      if (signal?.aborted) {
        const error = new Error('This operation was aborted');
        error.name = 'AbortError';
        throw error;
      }
      yield encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n\n`);
    }
    yield encoder.encode('data: [DONE]\n\n');
  }
  return { ok: true, status: 200, body: body() };
}

test('streams deltas from an SSE chat-completions response', async () => {
  const calls = [];
  const service = new OpenAICompatibleService({
    preset: 'groq',
    apiKey: 'k',
    fetchImpl: async (url, init) => { calls.push({ url, init }); return sseResponse(['Hello', ' there']); }
  });
  const chunks = [];
  const text = await service.generateText('hi', { onChunk: ({ text: t }) => chunks.push(t) });

  assert.equal(text, 'Hello there');
  assert.deepEqual(chunks, ['Hello', ' there']);
  assert.equal(calls[0].url, 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer k');
  assert.equal(JSON.parse(calls[0].init.body).model, 'llama-3.3-70b-versatile');
});

test('sends screenshots as image parts only when the model supports vision', async () => {
  let body;
  const service = new OpenAICompatibleService({
    preset: 'openai',
    apiKey: 'k',
    fetchImpl: async (_url, init) => { body = JSON.parse(init.body); return sseResponse(['ok']); }
  });
  await service.generateMultimodal([{ text: 'look' }, { inlineData: { mimeType: 'image/jpeg', data: 'QUJD' } }], { onChunk: () => {} });
  assert.equal(body.messages[0].content[1].image_url.url, 'data:image/jpeg;base64,QUJD');
});

test('retries a 429 before any text was streamed', async () => {
  let attempts = 0;
  const service = new OpenAICompatibleService({
    preset: 'groq',
    apiKey: 'k',
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1) return { ok: false, status: 429, text: async () => 'rate limited' };
      return sseResponse(['fine']);
    }
  });
  assert.equal(await service.generateText('q', { onChunk: () => {} }), 'fine');
  assert.equal(attempts, 2);
});

test('an aborted request stops streaming and is not retried', async () => {
  let attempts = 0;
  const controller = new AbortController();
  const service = new OpenAICompatibleService({
    preset: 'groq',
    apiKey: 'k',
    fetchImpl: async (_url, init) => { attempts += 1; return sseResponse(['a', 'b', 'c', 'd'], { delayMs: 20, signal: init.signal }); }
  });
  const chunks = [];
  const pending = service.generateText('q', { onChunk: ({ text }) => chunks.push(text), signal: controller.signal });
  setTimeout(() => controller.abort(), 45);
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(attempts, 1);
  assert.ok(chunks.length < 4);
});
