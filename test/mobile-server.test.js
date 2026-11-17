'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const WebSocket = require('ws');

const TOKEN = 'test-pairing-token-1234567890';

function get(path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: 7823, path }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    }).on('error', reject);
  });
}

function wsOutcome(path) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:7823${path}`);
    ws.on('open', () => { ws.close(); resolve('open'); });
    ws.on('unexpected-response', (_req, res) => resolve(`rejected ${res.statusCode}`));
    ws.on('error', () => resolve('error'));
  });
}

test('mobile server refuses page and socket without the pairing token', async (t) => {
  process.env.MOBILE_PAIRING_TOKEN = TOKEN;
  delete process.env.MOBILE_SERVER;
  const { createMobileServer } = require('../src/main-process/features/mobile-server/server');
  const server = createMobileServer({
    getGeminiRuntime: () => null,
    getScreenshotManager: () => null,
    notifyDesktop: () => {}
  });
  t.after(() => server.close());
  await new Promise((resolve) => setTimeout(resolve, 150));

  assert.equal(await get('/'), 403);
  assert.equal(await get('/?t=wrong-token-wrong-token-xx'), 403);
  assert.equal(await get(`/?t=${TOKEN}`), 200);

  assert.equal(await wsOutcome('/'), 'rejected 401');
  assert.equal(await wsOutcome(`/?t=${TOKEN}`), 'open');

  for (const { url } of server.getStatus().urls) {
    assert.ok(url.endsWith(`/?t=${TOKEN}`), url);
  }
});
