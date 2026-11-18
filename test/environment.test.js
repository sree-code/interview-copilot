'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const dotenv = require('dotenv');
const { getEnvPath, saveApplicationEnvironment } = require('../src/bootstrap/environment');

function fakePackagedApp(dir) {
  return { isPackaged: true, getPath: (name) => (name === 'userData' ? dir : os.tmpdir()) };
}

test('packaged builds keep .env in the user data folder, not the install folder', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'envtest-'));
  assert.equal(getEnvPath(fakePackagedApp(dir)), path.join(dir, '.env'));
});

test('saving settings keeps keys the Settings screen does not manage', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'envtest-'));
  const app = fakePackagedApp(dir);
  fs.writeFileSync(path.join(dir, '.env'), 'GROQ_API_KEY=gsk_test\nFAST_LLM_PRESET=groq\nASSEMBLY_AI_STREAM_PARAMS="a=1&b=two words"\nSTART_HIDDEN=true\n');
  const saved = { ...process.env };
  try {
    saveApplicationEnvironment(app, { startHidden: false });
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
  const parsed = dotenv.parse(fs.readFileSync(path.join(dir, '.env'), 'utf8'));
  assert.equal(parsed.GROQ_API_KEY, 'gsk_test');
  assert.equal(parsed.FAST_LLM_PRESET, 'groq');
  assert.equal(parsed.ASSEMBLY_AI_STREAM_PARAMS, 'a=1&b=two words');
  assert.equal(parsed.START_HIDDEN, 'false');
});

test('reads ASSEMBLY_AI_API_KEY and GEMINI_API_KEY from .env-style variables', () => {
  const { normalizeApplicationEnvironment } = require('../src/bootstrap/environment');
  const env = normalizeApplicationEnvironment({ ASSEMBLY_AI_API_KEY: ' aai ', GEMINI_API_KEY: 'g1,g2' });
  assert.equal(env.assemblyAiApiKey, 'aai');
  assert.deepEqual(env.geminiApiKeys, ['g1', 'g2']);
});
