'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createInterviewStores } = require('../src/main-process/features/interview/stores');

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'interview-stores-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('profile, bank and session survive a restart', (t) => {
  const baseDir = tempDir(t);
  const first = createInterviewStores({ baseDir });
  first.saveProfile({ name: 'Sam', targetCompany: 'Acme', fastMode: true, unknownField: 'x' });
  first.saveBank([{ question: 'Tell me about yourself?', answer: 'I build payment systems.' }], 'qa.pdf');
  first.appendEvent('host', 'Tell me about yourself.');
  first.appendEvent('answer', 'I build payment systems.', { question: 'Tell me about yourself.', source: 'bank' });

  const second = createInterviewStores({ baseDir });
  assert.equal(second.getProfile().name, 'Sam');
  assert.equal(second.getProfile().fastMode, true);
  assert.equal(second.getProfile().unknownField, undefined);
  assert.equal(second.getBank().pairs.length, 1);
  assert.deepEqual(second.getQaHistory(), [{ question: 'Tell me about yourself.', answer: 'I build payment systems.', source: 'bank' }]);
});

test('collects what you said after each question as style samples', (t) => {
  const stores = createInterviewStores({ baseDir: tempDir(t) });
  stores.appendEvent('host', 'How do you handle on-call incidents?');
  stores.appendEvent('you', 'Honestly, first thing I do is stabilise, so I roll back or shed load before I go hunting for root cause,');
  stores.appendEvent('you', 'and then I write the timeline while it is fresh so the postmortem is easy.');
  stores.appendEvent('host', 'Okay.');
  stores.appendEvent('you', 'Yeah.');

  const samples = stores.getSpokenAnswers({ minWords: 10 });
  assert.equal(samples.length, 1);
  assert.equal(samples[0].question, 'How do you handle on-call incidents?');
  assert.match(samples[0].text, /^Honestly, first thing I do is stabilise.*postmortem is easy\.$/);
});

test('clearing the session keeps the profile', (t) => {
  const baseDir = tempDir(t);
  const stores = createInterviewStores({ baseDir });
  stores.saveProfile({ name: 'Sam' });
  stores.appendEvent('host', 'Hello');
  stores.clearSession();
  const reopened = createInterviewStores({ baseDir });
  assert.equal(reopened.getEvents().length, 0);
  assert.equal(reopened.getProfile().name, 'Sam');
});
