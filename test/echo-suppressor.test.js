'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createEchoSuppressor } = require('../src/services/assembly-ai/echo-suppressor');

function harness(options = {}) {
  let clock = 0;
  const timers = [];
  const emitted = [];
  const suppressed = [];
  const suppressor = createEchoSuppressor({
    now: () => clock,
    setTimeout: (fn, ms) => {
      const timer = { fn, at: clock + ms, done: false };
      timers.push(timer);
      return timer;
    },
    clearTimeout: (timer) => { if (timer) timer.done = true; },
    onSuppressed: (info) => suppressed.push(info.text),
    ...options
  });
  return {
    suppressor,
    emitted,
    suppressed,
    mic: (text) => suppressor.handleMicFinal(text, (t) => emitted.push(['You', t])),
    host: (text) => suppressor.handleSystemFinal(text, (t) => emitted.push(['Host', t])),
    advance(ms) {
      clock += ms;
      for (const timer of timers) {
        if (!timer.done && timer.at <= clock) { timer.done = true; timer.fn(); }
      }
    }
  };
}

test('drops a mic line that echoes a host line that arrived first', () => {
  const h = harness();
  h.host('Tell me about a time you handled a production outage.');
  h.advance(400);
  h.mic('tell me about a time you handled a production');
  h.advance(2000);
  assert.deepEqual(h.emitted, [['Host', 'Tell me about a time you handled a production outage.']]);
  assert.equal(h.suppressed.length, 1);
});

test('drops a held mic line when the matching host line arrives just after it', () => {
  const h = harness();
  h.mic('how would you design a rate limiter');
  h.advance(500);
  h.host('How would you design a rate limiter for an API?');
  h.advance(2000);
  assert.deepEqual(h.emitted.map(([who]) => who), ['Host']);
});

test('keeps the user answering, even right after the question', () => {
  const h = harness();
  h.host('How would you design a rate limiter for an API?');
  h.advance(1500);
  h.mic('I would start with a token bucket per client stored in Redis');
  h.advance(1000);
  assert.deepEqual(h.emitted.map(([who]) => who), ['Host', 'You']);
});

test('keeps the user repeating the question back after a pause', () => {
  const h = harness();
  h.host('Can you reverse a linked list in place?');
  h.advance(4000);
  h.mic('so reverse a linked list in place');
  h.advance(1000);
  assert.deepEqual(h.emitted.map(([who]) => who), ['Host', 'You']);
});

test('short replies are only dropped on an exact match', () => {
  const h = harness();
  h.host('Okay, great, let us move on to system design.');
  h.advance(300);
  h.mic('okay');
  h.advance(1000);
  assert.deepEqual(h.emitted.map(([who]) => who), ['Host', 'You']);

  const e = harness();
  e.host('Okay.');
  e.advance(300);
  e.mic('okay');
  e.advance(1000);
  assert.deepEqual(e.emitted.map(([who]) => who), ['Host']);
});

test('mic partials matching the live host partial are flagged as echo', () => {
  const h = harness();
  h.suppressor.handleSystemPartial('what is the time complexity of');
  h.advance(200);
  assert.equal(h.suppressor.isLikelyEchoPartial('what is the time complexity'), true);
  assert.equal(h.suppressor.isLikelyEchoPartial('it is linear in the input'), false);
});

test('flush releases held mic lines immediately', () => {
  const h = harness();
  h.mic('my answer would be a hash map');
  assert.equal(h.emitted.length, 0);
  h.suppressor.flush();
  assert.deepEqual(h.emitted, [['You', 'my answer would be a hash map']]);
});
