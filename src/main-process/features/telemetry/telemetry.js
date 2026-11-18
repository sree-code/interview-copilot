'use strict';

// Anonymous usage and performance stats, opt-in.
//
// Sent only after the user says yes in the app (and only when a project key
// is set in src/telemetry-config.json). What is sent: event names, timings
// (ms), counts, on/off settings, app version, OS, CPU type, language
// setting of the OS and a random install id. The receiving service derives
// the country/city from the connection's IP address.
// Never sent: transcripts, answers, prompts, profile, resume, job
// description, Q&A, file names, API keys, error message text.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const FLUSH_INTERVAL_MS = 60_000;
const FLUSH_AT = 25;
const MAX_QUEUE = 300;
const SEND_TIMEOUT_MS = 5000;

// Long token-like strings (keys, ids) are never sent.
const SECRET_LIKE = /[A-Za-z0-9_\-]{24,}/g;

function cleanProps(props = {}) {
  const out = {};
  for (const [key, value] of Object.entries(props || {})) {
    if (!/^[a-z][a-z0-9_]{0,40}$/.test(key)) continue;
    if (typeof value === 'number') {
      if (Number.isFinite(value)) out[key] = Math.round(value * 100) / 100;
    } else if (typeof value === 'boolean') {
      out[key] = value;
    } else if (typeof value === 'string') {
      out[key] = value.replace(SECRET_LIKE, '[redacted]').slice(0, 80);
    }
  }
  return out;
}

// Error text can contain anything (provider responses, paths); only a
// category and an HTTP status are kept.
function errorKind(error) {
  const message = String(error?.message || error || '').toLowerCase();
  const status = (message.match(/\b([45]\d\d)\b/) || [])[1];
  let kind = 'other';
  if (/quota|rate limit|429/.test(message)) kind = 'rate_limit';
  else if (/401|403|unauthori|invalid api key|api key not valid|forbidden/.test(message)) kind = 'auth';
  else if (/not configured|no api key|add it in settings/.test(message)) kind = 'missing_key';
  else if (/network|fetch failed|econn|enotfound|etimedout|socket|connection/.test(message)) kind = 'network';
  else if (/timeout|timed out/.test(message)) kind = 'timeout';
  else if (/model/.test(message)) kind = 'model';
  else if (/permission|denied|not allowed/.test(message)) kind = 'permission';
  return { error_kind: kind, ...(status ? { http_status: Number(status) } : {}) };
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function createTelemetry({
  app,
  config = {},
  env = process.env,
  argv = process.argv,
  fetchImpl = globalThis.fetch,
  stateDir = null,
  setInterval: setTimer = setInterval,
  clearInterval: clearTimer = clearInterval,
  now = () => Date.now()
}) {
  const host = String(env.COPILOT_TELEMETRY_HOST || config.host || '').replace(/\/+$/, '');
  const projectKey = String(env.COPILOT_TELEMETRY_KEY || config.projectKey || '').trim();
  const disabledHere = /^(0|false|off|no)$/i.test(String(env.COPILOT_TELEMETRY || ''))
    || argv.includes('--smoke-test')
    || Boolean(env.CI);
  const configured = Boolean(host && projectKey) && !disabledHere;

  const statePath = path.join(stateDir || app.getPath('userData'), 'telemetry.json');
  let state = { installId: '', consent: null, decidedAt: null };
  let queue = [];
  let timer = null;
  let sending = null;
  const sessionId = crypto.randomUUID();
  const timings = new Map(); // name -> number[]

  function load() {
    try {
      const saved = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      state = { ...state, ...saved };
    } catch (_) { /* first run */ }
    if (!state.installId) {
      state.installId = crypto.randomUUID();
      save();
    }
  }

  function save() {
    try {
      fs.mkdirSync(path.dirname(statePath), { recursive: true });
      fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
    } catch (_) { /* ignore */ }
  }

  function enabled() {
    return configured && state.consent === true;
  }

  function baseProps() {
    return {
      app_version: app.getVersion(),
      packaged: app.isPackaged,
      os: process.platform,
      os_version: os.release(),
      arch: process.arch,
      electron: process.versions.electron || '',
      locale: typeof app.getLocale === 'function' ? app.getLocale() : '',
      cpu_count: os.cpus().length,
      memory_gb: Math.round(os.totalmem() / 1024 ** 3),
      session_id: sessionId
    };
  }

  function track(event, props = {}) {
    if (!enabled() || !/^[a-z][a-z0-9_]{1,60}$/.test(String(event))) return false;
    queue.push({
      event,
      timestamp: new Date(now()).toISOString(),
      properties: { distinct_id: state.installId, ...baseProps(), ...cleanProps(props) }
    });
    if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE);
    if (queue.length >= FLUSH_AT) flush();
    return true;
  }

  // Timings are summarized (count, p50, p90, max) per listening session
  // instead of one event per measurement.
  function timing(name, ms, _props = {}) {
    if (!enabled() || !Number.isFinite(ms) || ms < 0) return;
    const list = timings.get(name) || [];
    list.push(ms);
    if (list.length > 500) list.shift();
    timings.set(name, list);
  }

  function timingSummary() {
    const summary = {};
    for (const [name, values] of timings) {
      const sorted = values.slice().sort((a, b) => a - b);
      summary[`${name}_count`] = sorted.length;
      summary[`${name}_p50_ms`] = percentile(sorted, 50);
      summary[`${name}_p90_ms`] = percentile(sorted, 90);
      summary[`${name}_max_ms`] = sorted[sorted.length - 1];
    }
    timings.clear();
    return summary;
  }

  function trackError(area, error, props = {}) {
    return track('error', { area, ...errorKind(error), ...props });
  }

  async function flush() {
    if (!configured || !queue.length || typeof fetchImpl !== 'function') return;
    if (sending) return sending;
    const batch = queue.splice(0, queue.length);
    sending = (async () => {
      try {
        const response = await fetchImpl(`${host}/batch/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: projectKey, batch }),
          signal: AbortSignal.timeout(SEND_TIMEOUT_MS)
        });
        if (!response.ok && response.status >= 500) throw new Error(`status ${response.status}`);
      } catch (_) {
        // Offline or service down: keep the events for the next try.
        queue = [...batch, ...queue].slice(-MAX_QUEUE);
      } finally {
        sending = null;
      }
    })();
    return sending;
  }

  function setConsent(value) {
    const next = Boolean(value);
    state = { ...state, consent: next, decidedAt: new Date(now()).toISOString() };
    save();
    if (next) {
      track('telemetry_opt_in');
      startTimer();
    } else {
      queue = [];
      timings.clear();
      stopTimer();
    }
    return getStatus();
  }

  function getStatus() {
    return {
      configured,
      consent: state.consent,
      askUser: configured && state.consent === null
    };
  }

  function startTimer() {
    if (timer || !enabled()) return;
    timer = setTimer(() => { flush(); }, FLUSH_INTERVAL_MS);
    timer.unref?.();
  }

  function stopTimer() {
    if (timer) clearTimer(timer);
    timer = null;
  }

  async function shutdown(props = {}) {
    stopTimer();
    if (enabled()) track('app_quit', { ...props, ...timingSummary() });
    await flush();
  }

  load();
  startTimer();

  return {
    errorKind,
    flush,
    getStatus,
    setConsent,
    shutdown,
    timing,
    timingSummary,
    track,
    trackError,
    _state: () => ({ ...state, queued: queue.length })
  };
}

module.exports = {
  cleanProps,
  createTelemetry,
  errorKind
};
