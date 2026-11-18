'use strict';

// Turns the events the main process already sends to the window into
// telemetry: answer speed, listening sessions and errors. Reads only
// timings, ids and flags from the payloads, never the text.

function createTelemetryObserver({ telemetry, getModelInfo = () => ({}), now = () => Date.now() }) {
  const answers = new Map(); // key -> { startedAt, firstChunkAt, chars, source, kind }
  const listening = { system: null, mic: null };

  const keyFor = (data = {}) => data.answerId || data.actionId || 'unknown';
  const kindFor = (actionId) => (actionId === 'autoAnswer' ? 'live' : actionId === 'askAi' ? 'ask_ai' : actionId === 'screenAi' ? 'screen_ai' : String(actionId || 'other'));

  function observe(channel, data = {}) {
    try {
      switch (channel) {
        case 'ai-stream-start':
          answers.set(keyFor(data), { startedAt: now(), firstChunkAt: null, chars: 0, source: data.source || null, kind: kindFor(data.actionId) });
          break;
        case 'ai-stream-chunk': {
          const entry = answers.get(keyFor(data));
          if (!entry) break;
          if (!entry.firstChunkAt) entry.firstChunkAt = now();
          entry.chars += String(data.text || '').length;
          break;
        }
        case 'ai-stream-end': {
          const key = keyFor(data);
          const entry = answers.get(key);
          answers.delete(key);
          if (!entry) break;
          const source = data.source || entry.source || 'llm';
          const firstChunkMs = entry.firstChunkAt ? entry.firstChunkAt - entry.startedAt : null;
          const totalMs = now() - entry.startedAt;
          if (data.error) {
            telemetry.trackError(entry.kind, data.error);
            break;
          }
          if (entry.chars === 0 && !data.interrupted) {
            telemetry.track('answer_failed', { kind: entry.kind, total_ms: totalMs, ...getModelInfo() });
            break;
          }
          if (firstChunkMs != null && source !== 'bank') telemetry.timing(`${entry.kind}_first_word`, firstChunkMs);
          telemetry.track('answer_shown', {
            kind: entry.kind,
            source,
            interrupted: Boolean(data.interrupted),
            first_word_ms: firstChunkMs,
            total_ms: totalMs,
            chars: entry.chars,
            ...getModelInfo()
          });
          break;
        }
        case 'analysis-result':
          if (data?.error) telemetry.trackError('screen_ai', data.error);
          break;
        case 'vosk-status':
          if (data?.status === 'listening' && (data.source === 'system' || data.source === 'mic') && !listening[data.source]) {
            listening[data.source] = now();
            telemetry.track('listening_started', { source: data.source });
          }
          break;
        case 'vosk-stopped':
        case 'vosk-error': {
          const source = data?.source === 'system' ? 'system' : 'mic';
          if (channel === 'vosk-error') telemetry.trackError('transcription', data?.error, { source });
          if (listening[source]) {
            const minutes = (now() - listening[source]) / 60000;
            listening[source] = null;
            const anyLeft = listening.system || listening.mic;
            telemetry.track('listening_stopped', {
              source,
              minutes,
              ...(anyLeft ? {} : telemetry.timingSummary())
            });
          }
          break;
        }
        default:
          break;
      }
    } catch (_) {
      // Telemetry must never break the app.
    }
  }

  return { observe };
}

module.exports = {
  createTelemetryObserver
};
