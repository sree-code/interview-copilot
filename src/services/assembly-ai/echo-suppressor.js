'use strict';

// Drops "You" (mic) transcript lines that are really the interviewer's voice
// leaking from the speakers into the microphone. Both streams then transcribe
// the same words within a second or two of each other.
//
// Rules:
// - A mic line is an echo when most of its words also appear in a system
//   ("Host") line that arrived within `windowMs` of it.
// - Mic finals are held for `holdMs` so a system final that arrives slightly
//   later can still cancel them.
// - Very short mic lines (< minWords) only count as echo on an exact match,
//   so a genuine "yes" / "okay" isn't swallowed.
// - Repeating the question back ("so, reverse a linked list?") usually ends
//   several seconds after the interviewer, outside the window, so it is kept.

const DEFAULTS = {
  windowMs: 2500,
  holdMs: 900,
  containmentThreshold: 0.6,
  partialContainmentThreshold: 0.7,
  minWords: 3,
  historyMs: 15000
};

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

// Share of mic words (multiset) that also occur in the system text.
function containment(micTokens, systemTokens) {
  if (micTokens.length === 0) return 0;
  const available = new Map();
  for (const token of systemTokens) {
    available.set(token, (available.get(token) || 0) + 1);
  }
  let matched = 0;
  for (const token of micTokens) {
    const count = available.get(token) || 0;
    if (count > 0) {
      matched += 1;
      available.set(token, count - 1);
    }
  }
  return matched / micTokens.length;
}

function createEchoSuppressor(options = {}) {
  const config = { ...DEFAULTS, ...options };
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const setTimer = options.setTimeout || setTimeout;
  const clearTimer = options.clearTimeout || clearTimeout;
  const onSuppressed = typeof options.onSuppressed === 'function' ? options.onSuppressed : () => {};

  // Recent system texts (finals and the latest partial) with arrival time.
  let systemHistory = [];
  let latestSystemPartial = null;
  // Mic finals waiting for the hold to expire: { tokens, text, at, emit, timer }
  let heldMic = [];

  function prune() {
    const cutoff = now() - config.historyMs;
    systemHistory = systemHistory.filter((entry) => entry.at >= cutoff);
  }

  function isEchoOf(micTokens, micAt, systemEntry, threshold) {
    if (Math.abs(micAt - systemEntry.at) > config.windowMs) return false;
    if (micTokens.length < config.minWords) {
      return micTokens.join(' ') === systemEntry.tokens.join(' ');
    }
    return containment(micTokens, systemEntry.tokens) >= threshold;
  }

  function findSystemMatch(micTokens, micAt, threshold) {
    const candidates = latestSystemPartial ? [...systemHistory, latestSystemPartial] : systemHistory;
    return candidates.find((entry) => isEchoOf(micTokens, micAt, entry, threshold)) || null;
  }

  function release(held) {
    heldMic = heldMic.filter((entry) => entry !== held);
    held.emit(held.text);
  }

  function suppress(held, match) {
    clearTimer(held.timer);
    heldMic = heldMic.filter((entry) => entry !== held);
    onSuppressed({ text: held.text, matchedSystemText: match.text });
  }

  // system: always emitted immediately; may cancel held mic lines.
  function handleSystemFinal(text, emit) {
    const entry = { text, tokens: tokenize(text), at: now() };
    systemHistory.push(entry);
    latestSystemPartial = null;
    prune();
    emit(text);

    for (const held of [...heldMic]) {
      if (isEchoOf(held.tokens, held.at, entry, config.containmentThreshold)) {
        suppress(held, entry);
      }
    }
  }

  function handleSystemPartial(text) {
    latestSystemPartial = { text, tokens: tokenize(text), at: now() };
  }

  function handleMicFinal(text, emit) {
    const tokens = tokenize(text);
    const at = now();
    const match = findSystemMatch(tokens, at, config.containmentThreshold);
    if (match) {
      onSuppressed({ text, matchedSystemText: match.text });
      return;
    }

    const held = { text, tokens, at, emit, timer: null };
    held.timer = setTimer(() => release(held), config.holdMs);
    heldMic.push(held);
  }

  // Returns true when a mic partial should be hidden as a likely echo.
  function isLikelyEchoPartial(text) {
    const tokens = tokenize(text);
    if (tokens.length < config.minWords) return false;
    return Boolean(findSystemMatch(tokens, now(), config.partialContainmentThreshold));
  }

  function flush() {
    for (const held of [...heldMic]) {
      clearTimer(held.timer);
      release(held);
    }
  }

  function reset() {
    for (const held of heldMic) clearTimer(held.timer);
    heldMic = [];
    systemHistory = [];
    latestSystemPartial = null;
  }

  return {
    handleMicFinal,
    handleSystemFinal,
    handleSystemPartial,
    isLikelyEchoPartial,
    flush,
    reset
  };
}

module.exports = {
  containment,
  createEchoSuppressor,
  tokenize
};
