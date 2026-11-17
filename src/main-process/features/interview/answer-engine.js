'use strict';

// Live answers ("fast mode").
//
// Every final transcript line goes through here and is stored in the session.
// When fast mode is on and the interviewer finishes a question:
//   1. If it matches one of your prepared answers, that answer is shown at
//      once (no model call).
//   2. Otherwise the model writes a short spoken answer, streamed.
// If the interviewer speaks again while an answer is still streaming, that
// answer is cancelled and a short follow-up answer is written that takes the
// interruption and the earlier context into account.

const { createQaIndex } = require('./qa-bank');
const { buildLiveAnswerPrompt, buildPersonalContext, routeQuestion } = require('./personal-context');

const ACTION_ID = 'autoAnswer';
// Wait this long after the interviewer stops for an immediate continuation
// (speech-to-text often splits one question into two turns).
const DEFAULT_MERGE_MS = 350;
const QUESTION_START = /^(what|why|how|when|where|who|which|tell|describe|explain|walk|can|could|would|will|do|did|does|have|has|are|is|was|were|give|share|talk|let'?s|so|okay so|and)\b/i;

function wordCount(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}

// Interviewer lines worth answering: questions, prompts, or anything longer
// than a short acknowledgement ("okay", "great, thanks").
function isAnswerable(text) {
  const value = String(text || '').trim();
  if (!value) return false;
  if (value.endsWith('?')) return true;
  if (wordCount(value) >= 6) return true;
  return QUESTION_START.test(value) && wordCount(value) >= 3;
}

function createAnswerEngine({
  stores,
  runtime,
  sendToRenderer,
  mergeMs = DEFAULT_MERGE_MS,
  setTimeout: setTimer = setTimeout,
  clearTimeout: clearTimer = clearTimeout,
  maxOutputTokens = 260
}) {
  let qaIndex = createQaIndex(stores.getBank().pairs);
  let active = null; // { id, question, controller, text }
  let pendingHost = null; // { text, timer }
  let answerCounter = 0;

  function reloadBank() {
    qaIndex = createQaIndex(stores.getBank().pairs);
    return qaIndex.size;
  }

  function isFastMode() {
    return Boolean(stores.getProfile().fastMode);
  }

  function recentTranscript(maxEvents = 12) {
    return stores.getEvents()
      .filter((event) => event.kind === 'host' || event.kind === 'you')
      .slice(-maxEvents)
      .map((event) => `${event.kind === 'host' ? 'Interviewer' : 'Candidate'}: ${event.text}`)
      .join('\n');
  }

  function personalContextFor(question) {
    const { references } = routeQuestion(question, qaIndex);
    return buildPersonalContext({
      profile: stores.getProfile(),
      references,
      qaHistory: stores.getQaHistory(6),
      spokenAnswers: stores.getSpokenAnswers({ limit: 3 })
    });
  }

  function emitStart(id, question, source) {
    sendToRenderer('ai-stream-start', {
      actionId: ACTION_ID,
      answerId: id,
      question,
      source,
      label: source === 'bank' ? 'Your prepared answer' : 'Suggested answer'
    });
  }

  function cancelActive(reason) {
    if (!active) return null;
    const cancelled = active;
    active = null;
    cancelled.controller.abort();
    sendToRenderer('ai-stream-end', { actionId: ACTION_ID, answerId: cancelled.id, interrupted: true, reason });
    if (cancelled.text.trim()) {
      stores.appendEvent('answer', cancelled.text, { question: cancelled.question, source: 'llm', interrupted: true });
    }
    return cancelled;
  }

  async function answer(question, { interruption = null, trigger = 'auto' } = {}) {
    const id = `ans-${Date.now()}-${(answerCounter += 1)}`;
    const route = interruption ? { direct: null } : routeQuestion(question, qaIndex);

    if (route.direct) {
      emitStart(id, question, 'bank');
      sendToRenderer('ai-stream-chunk', { actionId: ACTION_ID, answerId: id, text: route.direct.answer, index: 1 });
      sendToRenderer('ai-stream-end', { actionId: ACTION_ID, answerId: id, interrupted: false, source: 'bank' });
      stores.appendEvent('answer', route.direct.answer, { question, source: 'bank', matchedQuestion: route.direct.question, score: route.direct.score });
      return { source: 'bank', text: route.direct.answer, matchedQuestion: route.direct.question };
    }

    if (!runtime.isActiveProviderReady()) {
      sendToRenderer('ai-stream-end', { actionId: ACTION_ID, answerId: id, error: 'No AI provider configured. Add an API key in Settings.' });
      return { source: 'none', text: '' };
    }

    const controller = new AbortController();
    const current = { id, question, controller, text: '', startedAt: Date.now(), trigger };
    active = current;
    emitStart(id, question, 'llm');

    const prompt = buildLiveAnswerPrompt({
      question,
      interruption,
      personalContext: personalContextFor(interruption ? `${interruption.previousQuestion} ${question}` : question),
      recentTranscript: recentTranscript(),
      programmingLanguage: runtime.getActiveProgrammingLanguage()
    });

    let index = 0;
    try {
      const text = await runtime.executeWithKeyFailover((service) => service.generateText(prompt, {
        signal: controller.signal,
        maxOutputTokens,
        onChunk: ({ text: chunk }) => {
          if (active !== current) return;
          current.text += chunk;
          index += 1;
          if (index === 1) current.firstChunkMs = Date.now() - current.startedAt;
          sendToRenderer('ai-stream-chunk', { actionId: ACTION_ID, answerId: id, text: chunk, index });
        }
      }));

      if (active !== current) {
        return { source: 'llm', text: current.text, interrupted: true };
      }
      active = null;
      const finalText = text || current.text;
      sendToRenderer('ai-stream-end', { actionId: ACTION_ID, answerId: id, interrupted: false, source: 'llm' });
      stores.appendEvent('answer', finalText, { question, source: 'llm', ...(interruption ? { followUpTo: interruption.previousQuestion } : {}) });
      return { source: 'llm', text: finalText, firstChunkMs: current.firstChunkMs };
    } catch (error) {
      if (controller.signal.aborted || error?.name === 'AbortError') {
        return { source: 'llm', text: current.text, interrupted: true };
      }
      if (active === current) active = null;
      sendToRenderer('ai-stream-end', { actionId: ACTION_ID, answerId: id, error: error.message });
      return { source: 'error', text: '', error: error.message };
    }
  }

  function startFromHost(text) {
    const interrupted = active ? cancelActive('interviewer-spoke') : null;
    const interruption = interrupted
      ? { previousQuestion: interrupted.question, partialAnswer: interrupted.text }
      : null;
    return answer(text, { interruption });
  }

  // Called for every final transcript line. source: 'system' (interviewer)
  // or 'mic' (you). Returns a promise when an answer was started.
  function onTranscriptFinal(source, text) {
    const value = String(text || '').trim();
    if (!value) return null;

    if (source !== 'system') {
      stores.appendEvent('you', value);
      return null;
    }

    stores.appendEvent('host', value);
    if (!isFastMode()) return null;

    // An answer is streaming and the interviewer says something short and
    // non-question-like ("mm-hm", "right"): let the answer continue.
    if (active && !isAnswerable(value) && wordCount(value) < 4) return null;
    if (!active && !isAnswerable(value)) return null;

    // Merge quick consecutive interviewer turns into one question.
    if (pendingHost) {
      clearTimer(pendingHost.timer);
      pendingHost.text = `${pendingHost.text} ${value}`;
    } else {
      pendingHost = { text: value, timer: null };
    }

    return new Promise((resolve) => {
      pendingHost.timer = setTimer(() => {
        const merged = pendingHost.text;
        pendingHost = null;
        resolve(startFromHost(merged));
      }, mergeMs);
    });
  }

  // Manual trigger ("answer the last question" button / shortcut).
  function answerLastQuestion() {
    const lastHost = [...stores.getEvents()].reverse().find((event) => event.kind === 'host');
    if (!lastHost) return Promise.resolve({ source: 'none', text: '', error: 'No interviewer question yet.' });
    return startFromHost(lastHost.text);
  }

  function stop() {
    if (pendingHost) {
      clearTimer(pendingHost.timer);
      pendingHost = null;
    }
    cancelActive('stopped');
  }

  return {
    answerLastQuestion,
    isAnswering: () => Boolean(active),
    onTranscriptFinal,
    personalContextFor,
    reloadBank,
    stop
  };
}

module.exports = {
  ACTION_ID,
  createAnswerEngine,
  isAnswerable
};
