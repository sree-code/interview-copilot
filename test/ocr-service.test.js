'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createOcrService } = require('../src/services/ocr/service');
const { buildScreenshotAnalysisPrompt } = require('../src/services/ai/prompts');

test('extracts and labels text from each captured screenshot', async () => {
  const recognizedImages = [];
  const worker = {
    recognize: async (image) => {
      recognizedImages.push(image);
      return { data: { text: image === 'first' ? 'first screen' : 'second screen' } };
    },
    terminate: async () => {}
  };
  const ocr = createOcrService({
    createWorker: async () => worker,
    fsModule: {
      existsSync: () => true,
      readFileSync: (filePath) => filePath === 'one.png' ? 'first' : 'second'
    }
  });

  const text = await ocr.extractTextFromEntries([
    { id: 'ss-1', path: 'one.png' },
    { id: 'ss-2', path: 'two.png' }
  ]);

  assert.equal(text, '[Screenshot ss-1]\nfirst screen\n\n[Screenshot ss-2]\nsecond screen');
  assert.deepEqual(recognizedImages, ['first', 'second']);
  await ocr.dispose();
});

test('reports missing screenshot files', async () => {
  const ocr = createOcrService({
    createWorker: async () => ({
      recognize: async () => ({ data: { text: '' } }),
      terminate: async () => {}
    }),
    fsModule: {
      existsSync: () => false,
      readFileSync: () => ''
    }
  });

  await assert.rejects(
    ocr.extractTextFromEntries([{ id: 'ss-1', path: 'missing.png' }]),
    /Screenshot file not found for OCR/
  );
  await ocr.dispose();
});

test('keeps Gemini screenshot analysis image-first while including OCR as supplemental context', () => {
  const prompt = buildScreenshotAnalysisPrompt({
    additionalContext: '[Screenshot ss-1]\nvisible text',
    screenshotCount: 2
  });

  assert.match(prompt, /You have 2 screenshots/);
  assert.match(prompt, /Extracted screen text \(supplemental\)/);
  assert.match(prompt, /source of truth/);
});

test('prewarm starts OCR once; the later request reuses the result', async () => {
  let calls = 0;
  const ocr = createOcrService({
    createWorker: async () => ({
      recognize: async () => { calls += 1; return { data: { text: 'two sum' } }; },
      terminate: async () => {}
    }),
    fsModule: { existsSync: () => true, readFileSync: () => 'img' }
  });

  ocr.prewarm({ id: 'ss-1', path: 'a.png' });
  const text = await ocr.extractTextFromEntries([{ id: 'ss-1', path: 'a.png' }]);

  assert.equal(text, '[Screenshot ss-1]\ntwo sum');
  assert.equal(calls, 1);
  await ocr.dispose();
});

test('a time budget skips OCR that is still running instead of blocking the AI call', async () => {
  const ocr = createOcrService({
    createWorker: async () => ({
      recognize: (image) => new Promise((resolve) => {
        setTimeout(() => resolve({ data: { text: image } }), image === 'slow' ? 500 : 0);
      }),
      terminate: async () => {}
    }),
    fsModule: { existsSync: () => true, readFileSync: (p) => (p === 'slow.png' ? 'slow' : 'fast') }
  });

  const started = Date.now();
  const text = await ocr.extractTextFromEntries(
    [{ id: 'ss-1', path: 'fast.png' }, { id: 'ss-2', path: 'slow.png' }],
    { budgetMs: 50 }
  );

  assert.equal(text, '[Screenshot ss-1]\nfast');
  assert.ok(Date.now() - started < 400, 'should not wait for the slow screenshot');
  await ocr.dispose();
});
