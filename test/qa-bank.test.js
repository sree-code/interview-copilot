'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createQaIndex, parseQaText } = require('../src/main-process/features/interview/qa-bank');
const { DIRECT_MATCH_THRESHOLD } = require('../src/main-process/features/interview/personal-context');

test('parses Q:/A: layout with multi-line answers', () => {
  const pairs = parseQaText(`
Q: Tell me about yourself.
A: I'm a backend engineer with five years in payments.
I mostly work in Java and Kafka.

Q: Why do you want to join Acme?
A: Your fraud platform is the problem I want to work on.
`);
  assert.equal(pairs.length, 2);
  assert.equal(pairs[0].question, 'Tell me about yourself.');
  assert.match(pairs[0].answer, /five years in payments\.\nI mostly work in Java/);
  assert.equal(pairs[1].question, 'Why do you want to join Acme?');
});

test('parses "Question 1:" / "Answer:" layout', () => {
  const pairs = parseQaText(`Question 1: What is your biggest weakness?
Answer: I over-polish code reviews; I now time-box them.
Question 2: Describe a conflict with a teammate.
Answer: We disagreed on a schema migration...`);
  assert.deepEqual(pairs.map((p) => p.question), ['What is your biggest weakness?', 'Describe a conflict with a teammate.']);
});

test('parses numbered questions ending in "?" with the answer below', () => {
  const pairs = parseQaText(`1. Why are you leaving your current job?
I've hit the ceiling on scale problems there.

2. Where do you see yourself in five years?
Leading a platform team.`);
  assert.equal(pairs.length, 2);
  assert.equal(pairs[0].answer, "I've hit the ceiling on scale problems there.");
  assert.equal(pairs[1].question, 'Where do you see yourself in five years?');
});

const BANK = createQaIndex([
  { question: 'Tell me about yourself.', answer: 'A1' },
  { question: 'Why do you want to join Acme?', answer: 'A2' },
  { question: 'What is your biggest weakness?', answer: 'A3' },
  { question: 'Why are you leaving your current job?', answer: 'A4' },
  { question: 'How did you scale the payments ledger service?', answer: 'A5' },
  { question: 'Describe a time you had a conflict with a teammate.', answer: 'A6' },
  { question: 'What are your salary expectations?', answer: 'A7' }
]);

const SHOULD_MATCH = [
  ['So, walk me through your resume.', 'A1'],
  ['Could you introduce yourself?', 'A1'],
  ['Why do you want to work here?', 'A2'],
  ['What would you say are your weaknesses?', 'A3'],
  ['Why are you looking for a change?', 'A4'],
  ['How did you scale the ledger service for payments?', 'A5'],
  ['Tell me about a disagreement with a teammate.', 'A6'],
  ['What compensation expectations do you have?', 'A7']
];

for (const [asked, expected] of SHOULD_MATCH) {
  test(`uses the prepared answer for: "${asked}"`, () => {
    const [top] = BANK.search(asked);
    assert.equal(top?.answer, expected);
    assert.ok(top.score >= DIRECT_MATCH_THRESHOLD, `score ${top.score.toFixed(2)} below threshold`);
  });
}

const SHOULD_NOT_MATCH = [
  'How would you design a rate limiter for a public API?',
  'What is the time complexity of quicksort?',
  'Can you reverse a linked list in place?',
  'How does garbage collection work in Java?'
];

for (const asked of SHOULD_NOT_MATCH) {
  test(`goes to the model for: "${asked}"`, () => {
    const [top] = BANK.search(asked);
    assert.ok(!top || top.score < DIRECT_MATCH_THRESHOLD, `matched "${top?.question}" at ${top?.score.toFixed(2)}`);
  });
}

const { routeQuestion } = require('../src/main-process/features/interview/personal-context');

test('small talk around the question still finds the prepared answer', () => {
  const route = routeQuestion('Thanks for joining today. Could you introduce yourself?', BANK);
  assert.equal(route.direct?.answer, 'A1');
});

test('small talk alone does not trigger a prepared answer', () => {
  const route = routeQuestion('Thanks for joining today. Great to meet you.', BANK);
  assert.equal(route.direct, null);
});
