'use strict';

const fs = require('fs');
const { createWorker } = require('tesseract.js');

// How many recognised screenshots to keep. The screenshot manager keeps
// MAX_SCREENSHOTS (default 5) files, so this comfortably covers them.
const MAX_CACHED_RESULTS = 20;

function createOcrService({
  createWorker: createWorkerFactory = createWorker,
  fsModule = fs,
  maxCachedResults = MAX_CACHED_RESULTS
} = {}) {
  let workerPromise = null;
  // path -> Promise<string>. Lets OCR start the moment a screenshot is taken
  // (prewarm) so Ask AI / Screen AI don't wait for Tesseract before calling
  // the model.
  const resultCache = new Map();

  async function getWorker() {
    if (!workerPromise) {
      workerPromise = createWorkerFactory('eng').catch((error) => {
        workerPromise = null;
        throw error;
      });
    }

    return workerPromise;
  }

  function rememberResult(path, promise) {
    resultCache.set(path, promise);
    while (resultCache.size > maxCachedResults) {
      resultCache.delete(resultCache.keys().next().value);
    }
  }

  function recognizeEntry(entry) {
    const cached = resultCache.get(entry.path);
    if (cached) {
      return cached;
    }

    // Read synchronously so a missing file is reported to the caller right away.
    const image = fsModule.readFileSync(entry.path);
    const promise = getWorker()
      .then((worker) => worker.recognize(image))
      .then((result) => String(result?.data?.text || '').trim())
      .catch((error) => {
        resultCache.delete(entry.path);
        throw error;
      });

    rememberResult(entry.path, promise);
    return promise;
  }

  function usable(entries) {
    return Array.isArray(entries)
      ? entries.filter((entry) => entry && typeof entry.path === 'string')
      : [];
  }

  // Start OCR in the background for a freshly captured screenshot.
  // Errors are swallowed here; extractTextFromEntries will retry and report.
  function prewarm(entry) {
    if (!entry || typeof entry.path !== 'string' || !fsModule.existsSync(entry.path)) {
      return;
    }

    try {
      recognizeEntry(entry).catch(() => {});
    } catch (_) {
      // ignore: reported later on the real request
    }
  }

  // budgetMs: optional time budget. When set, screenshots whose OCR isn't done
  // by then are skipped (OCR is only supplemental; the model gets the image).
  async function extractTextFromEntries(entries = [], { budgetMs } = {}) {
    const usableEntries = usable(entries);

    if (usableEntries.length === 0) {
      return '';
    }

    for (const entry of usableEntries) {
      if (!fsModule.existsSync(entry.path)) {
        throw new Error(`Screenshot file not found for OCR: ${entry.path}`);
      }
    }

    const pending = usableEntries.map((entry) => recognizeEntry(entry));
    let settled;

    if (Number.isFinite(budgetMs) && budgetMs >= 0) {
      const TIMED_OUT = Symbol('timed-out');
      let timer;
      const deadline = new Promise((resolve) => {
        timer = setTimeout(() => resolve(TIMED_OUT), budgetMs);
      });
      settled = await Promise.all(pending.map((promise) => Promise.race([
        promise.then((text) => ({ text }), () => ({ text: '' })),
        deadline.then(() => ({ text: '', timedOut: true }))
      ])));
      clearTimeout(timer);
    } else {
      settled = await Promise.all(pending.map((promise) => promise.then((text) => ({ text }))));
    }

    return usableEntries
      .map((entry, index) => ({ entry, text: settled[index].text }))
      .filter(({ text }) => text)
      .map(({ entry, text }) => `[Screenshot ${entry.id || 'unknown'}]\n${text}`)
      .join('\n\n');
  }

  async function dispose() {
    resultCache.clear();
    if (!workerPromise) {
      return;
    }

    const worker = await workerPromise;
    workerPromise = null;
    await worker.terminate();
  }

  return {
    dispose,
    extractTextFromEntries,
    prewarm
  };
}

module.exports = {
  createOcrService
};
