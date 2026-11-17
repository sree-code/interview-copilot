'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAskAiSessionPrompt, selectConversationContext } = require('../src/services/ai/prompts');

function countOccurrences(haystack, needle) {
  return haystack.split(needle).length - 1;
}

test('Ask AI prompt sends the transcript once, not up to three times', () => {
  const line = 'Host: reverse a linked list in place';
  const prompt = buildAskAiSessionPrompt({
    contextString: `${line}\nYou: sure`,
    transcriptContext: line,
    sessionSummary: line
  });

  assert.equal(countOccurrences(prompt, line), 1);
  assert.match(prompt, /Conversation \(chronological\):/);
});

test('falls back to transcript, then summary, when no full context is given', () => {
  assert.deepEqual(
    selectConversationContext({ transcriptContext: 'T', sessionSummary: 'S' }),
    { label: 'Transcript', content: 'T' }
  );
  assert.deepEqual(
    selectConversationContext({ sessionSummary: 'S' }),
    { label: 'Session summary', content: 'S' }
  );
  assert.deepEqual(selectConversationContext({}), { label: '', content: '' });
});

test('Ask AI prompt honours the programming language setting', () => {
  const prompt = buildAskAiSessionPrompt({ contextString: 'Host: two sum', programmingLanguage: 'Java' });
  assert.match(prompt, /prefer Java\b/i);
});

test('OCR text is its own block, not mixed into the transcript', () => {
  const prompt = buildAskAiSessionPrompt({
    transcriptContext: 'Host: solve this',
    screenText: '[Screenshot ss-1]\nGiven an array nums'
  });
  assert.match(prompt, /Transcript:\nHost: solve this\n\nExtracted screen text \(supplemental\):\n\[Screenshot ss-1\]/);
});
