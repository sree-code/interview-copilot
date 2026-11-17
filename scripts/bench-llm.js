'use strict';

// Measures how fast each configured model starts answering (time to first
// token) and finishes, with a realistic interview prompt, using YOUR keys.
//
//   npm run bench:llm                 # every provider that has a key in .env
//   npm run bench:llm -- --runs 5     # more runs per model
//
// Keys are read from .env: GROQ_API_KEY, OPENAI_API_KEY, CEREBRAS_API_KEY,
// OPENROUTER_API_KEY, GEMINI_API_KEY (first key if comma-separated).

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { OPENAI_COMPATIBLE_PRESETS, OpenAICompatibleService } = require('../src/services/ai/openai-compatible-service');

const runsArgIndex = process.argv.indexOf('--runs');
const RUNS = runsArgIndex > -1 ? Math.max(1, Number(process.argv[runsArgIndex + 1]) || 3) : 3;

const PROMPT = `You are helping a candidate in a live software-engineering interview.
Answer in first person, 3-4 short spoken sentences, no markdown.
Interviewer: "How would you design a rate limiter for a public API?"`;

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

async function listModels(preset, apiKey) {
  try {
    const response = await fetch(`${preset.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) return { error: `HTTP ${response.status}` };
    const json = await response.json();
    return { ids: new Set((json.data || []).map((model) => String(model.id).replace(/^models\//, ''))) };
  } catch (error) {
    return { error: error.message };
  }
}

async function timeOne(service) {
  const started = performance.now();
  let firstTokenAt = null;
  const text = await service.generateText(PROMPT, {
    onChunk: () => {
      if (firstTokenAt === null) firstTokenAt = performance.now();
    }
  });
  const done = performance.now();
  return { ttft: (firstTokenAt ?? done) - started, total: done - started, chars: text.length, sample: text };
}

async function main() {
  const results = [];

  for (const [id, preset] of Object.entries(OPENAI_COMPATIBLE_PRESETS)) {
    const apiKey = String(process.env[preset.envKey] || '').split(',')[0].trim();
    if (!apiKey) {
      console.log(`- ${preset.label}: skipped (no ${preset.envKey} in .env)`);
      continue;
    }

    const listing = await listModels(preset, apiKey);
    if (listing.error) {
      console.log(`- ${preset.label}: could not list models (${listing.error})`);
    }

    for (const model of preset.candidateModels) {
      if (listing.ids && !listing.ids.has(model)) {
        console.log(`- ${preset.label} ${model}: not available to this key`);
        continue;
      }

      const service = new OpenAICompatibleService({ preset: id, apiKey, modelName: model, maxOutputTokens: 200 });
      const runs = [];
      let failure = null;
      for (let run = 0; run < RUNS; run += 1) {
        try {
          runs.push(await timeOne(service));
        } catch (error) {
          failure = error.message.slice(0, 160);
          break;
        }
      }

      if (failure) {
        console.log(`- ${preset.label} ${model}: failed (${failure})`);
        results.push({ provider: preset.label, preset: id, model, failure });
        continue;
      }

      const row = {
        provider: preset.label,
        preset: id,
        model,
        ttftMs: Math.round(median(runs.map((r) => r.ttft))),
        totalMs: Math.round(median(runs.map((r) => r.total))),
        sample: runs[runs.length - 1].sample.replace(/\s+/g, ' ').slice(0, 140)
      };
      results.push(row);
      console.log(`- ${preset.label} ${model}: first token ${row.ttftMs} ms, full answer ${row.totalMs} ms`);
    }
  }

  const ok = results.filter((row) => !row.failure).sort((a, b) => a.ttftMs - b.ttftMs);
  console.log('');
  if (ok.length === 0) {
    console.log('No model could be measured. Add at least one API key to .env.');
    process.exitCode = 1;
    return;
  }

  console.log(`Median of ${RUNS} runs, fastest first:`);
  console.table(ok.map(({ provider, model, ttftMs, totalMs }) => ({ provider, model, 'first token (ms)': ttftMs, 'full answer (ms)': totalMs })));
  const best = ok[0];
  console.log(`Fastest: ${best.provider} / ${best.model}`);
  console.log(`Sample: "${best.sample}…"`);
  console.log(`To use it: Settings > AI Provider > Fast cloud model > ${best.provider}, model ${best.model}`);
  console.log(`(or in .env: FAST_LLM_PRESET=${best.preset} FAST_LLM_MODEL=${best.model})`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
