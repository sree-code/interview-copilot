// All renderer logic for the Astryx UI, with no DOM code: chat messages,
// transcription (mic + system audio), AI actions, fast-mode live answers,
// settings and the interview profile. React reads it with
// useSyncExternalStore; every change produces a new state object.
//
// Reuses the framework-free modules of the original renderer (audio
// capture, transcript merging, AI context building) so behaviour matches.

import { createAudioPipeline } from '../../renderer/features/assembly-ai/audio-pipeline.js';
import { createTranscriptBufferManager } from '../../renderer/features/assembly-ai/transcript-buffer.js';
import { normalizeSource, sourceLabel } from '../../renderer/features/assembly-ai/source-state.js';
import { buildFilteredAiContextBundle } from '../../renderer/features/ai-context/context-bundle.js';
import {
  canToggleAiForMessageType,
  defaultIncludeInAiForMessageType,
  isSystemMessageType
} from '../../renderer/features/ai-context/message-types.js';

const AI_CONTEXT_CHAR_BUDGET = 12000;
const MAX_LOGS = 80;
const LIVE_ANSWER_ACTION = 'autoAnswer';

export const AI_ACTIONS = ['askAi', 'screenAi', 'suggest', 'notes', 'insights'];

function emptySource(selected) {
  return { selected, status: 'off', active: false, partial: '', lastText: 'No transcript yet' };
}

export function createSessionStore(api = window.electronAPI) {
  let state = {
    ready: false,
    startedAt: Date.now(),
    settings: null,
    hasModelKey: false,
    hasAssemblyKey: false,
    messages: [],
    sources: { system: emptySource(true), mic: emptySource(false) },
    logs: [],
    inFlight: Object.fromEntries(AI_ACTIONS.map((id) => [id, false])),
    busyText: '',
    screenshots: 0,
    mobile: { listening: false, port: 7823, urls: [], clientCount: 0, error: null },
    interview: null,
    hidden: false,
    theme: 'light'
  };

  const listeners = new Set();
  const toastListeners = new Set();
  let sequence = 0;

  const getState = () => state;
  const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
  const onToast = (fn) => { toastListeners.add(fn); return () => toastListeners.delete(fn); };
  function set(patch) {
    state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
    listeners.forEach((fn) => fn());
  }
  function toast(message, type = 'info') {
    toastListeners.forEach((fn) => fn({ message, type }));
  }

  // ── Logs ──
  function log(level, event, message, source = null, meta = null, timestamp = Date.now()) {
    const entry = { id: ++sequence, level: level || 'info', event, message: message || '', source: source ? normalizeSource(source) : null, meta, timestamp };
    set((s) => ({ logs: [...s.logs.slice(-(MAX_LOGS - 1)), entry] }));
  }

  // ── Messages ──
  function addMessage(type, content, options = {}) {
    const record = {
      id: `msg-${++sequence}`,
      type,
      content: String(content ?? ''),
      label: options.label || null,
      timestamp: new Date(),
      canToggleAi: canToggleAiForMessageType(type),
      includeInAi: defaultIncludeInAiForMessageType(type),
      screenshotId: typeof options.screenshotId === 'string' ? options.screenshotId : null,
      streaming: Boolean(options.streaming),
      note: options.note || null
    };
    set((s) => ({ messages: [...s.messages, record] }));
    return record;
  }
  function updateMessage(id, patch) {
    set((s) => ({ messages: s.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)) }));
  }
  function toggleInclusion(id) {
    set((s) => ({ messages: s.messages.map((m) => (m.id === id && m.canToggleAi ? { ...m, includeInAi: !m.includeInAi } : m)) }));
  }
  function isIncludedForAi(message) {
    if (!message || isSystemMessageType(message.type)) return false;
    return message.canToggleAi ? Boolean(message.includeInAi) : message.includeInAi !== false;
  }
  function contextBundle(emitLog = false) {
    return buildFilteredAiContextBundle({
      messages: state.messages,
      isMessageIncludedForAi: isIncludedForAi,
      charBudget: AI_CONTEXT_CHAR_BUDGET,
      emitTruncationLog: emitLog,
      onTruncationLog: (dropped, budget) => log('info', 'context-cap', `Trimmed ${dropped} older message(s) to stay within ${budget} chars`)
    });
  }
  function addManualContext(text) {
    const value = String(text || '').trim();
    if (!value) return;
    addMessage('voice-mic', value);
  }

  // ── Transcription ──
  const audio = { system: { ctx: null, stream: null, processor: null }, mic: { ctx: null, stream: null, processor: null } };
  const audioPipeline = createAudioPipeline({
    sendAudioChunk: (source, buffer) => api.sendAudioChunk(source, buffer),
    addMonitorLog: (...args) => log(...args)
  });
  // Finals that arrive close together are merged into one chat line. The
  // line is shown as soon as the first part arrives and grows as more come,
  // so it always appears before the answer to it.
  const pendingLine = { system: null, mic: null };
  const lineType = (source) => (source === 'system' ? 'voice-system' : 'voice-mic');
  const transcriptBuffer = createTranscriptBufferManager({
    mergeWindowMs: 3500,
    onBuffer: ({ source, text, segments }) => {
      if (pendingLine[source]) updateMessage(pendingLine[source], { content: text });
      else pendingLine[source] = addMessage(lineType(source), text).id;
      log('info', 'final-buffer', 'Buffered transcript segment', source, { segments, chars: text.length });
    },
    onFlush: ({ source, text, reason, segments }) => {
      if (pendingLine[source]) updateMessage(pendingLine[source], { content: text });
      else addMessage(lineType(source), text);
      pendingLine[source] = null;
      log('info', 'final-flush', 'Merged transcript committed', source, { reason, segments, chars: text.length });
    }
  });

  function patchSource(source, patch) {
    const key = normalizeSource(source);
    set((s) => ({ sources: { ...s.sources, [key]: { ...s.sources[key], ...patch } } }));
  }
  const isActive = (source) => state.sources[normalizeSource(source)].active;
  const isConnecting = (source) => state.sources[normalizeSource(source)].status === 'connecting';
  const anyActive = () => state.sources.system.active || state.sources.mic.active;
  const anyConnecting = () => isConnecting('system') || isConnecting('mic');

  function resetLine(source) {
    transcriptBuffer.resetFinalTranscriptBuffer(source);
    pendingLine[source] = null;
  }

  function releaseAudio(source) {
    const a = audio[source];
    audioPipeline.stopAudioResources(a.ctx, a.stream, a.processor);
    audio[source] = { ctx: null, stream: null, processor: null };
    audioPipeline.resetSourceSampleQueue(source);
  }

  async function startSource(source) {
    if (isActive(source) || isConnecting(source)) return;
    const label = sourceLabel(source);
    patchSource(source, { status: 'connecting', lastText: `Connecting to ${label}...` });
    log('info', 'start-request', `Starting ${label} source`, source);
    resetLine(source);
    try {
      let stream;
      if (source === 'system') {
        const sources = await api.getDesktopSources();
        if (!sources || sources.length === 0) {
          throw new Error('No screen source available. On macOS allow the app under System Settings > Privacy & Security > Screen & System Audio Recording, then restart it.');
        }
        const result = await api.startVoiceRecognition('system');
        if (result?.error) throw new Error(result.error);
        stream = await audioPipeline.getSystemAudioStream(sources[0].id);
        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack && audioPipeline.isLikelyCameraTrack(videoTrack.label)) {
          throw new Error(`Desktop capture fell back to a camera (${videoTrack.label || 'unknown'}).`);
        }
        stream.getVideoTracks().forEach((track) => track.stop());
      } else {
        const result = await api.startVoiceRecognition('mic');
        if (result?.error) throw new Error(result.error);
        stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
      }
      const ctx = new AudioContext();
      await ctx.resume();
      audioPipeline.resetSourceSampleQueue(source);
      audio[source] = { ctx, stream, processor: null };
      patchSource(source, { active: true });
      audio[source].processor = await audioPipeline.buildAudioProcessor(ctx, stream, source, () => isActive(source));
      addMessage('system', source === 'system' ? 'Listening to the interviewer (system audio)…' : 'Mic listening…');
      log('info', 'source-active', `${label} source active`, source);
    } catch (error) {
      toast(`${label} failed: ${error.message}`, 'error');
      log('error', 'source-failed', error.message, source);
      releaseAudio(source);
      patchSource(source, { active: false, status: 'error', lastText: `${label} error: ${error.message}` });
      try { await api.stopVoiceRecognition(source); } catch (_) { /* ignore */ }
    }
  }

  async function stopSource(source) {
    if (!isActive(source) && !isConnecting(source)) return;
    audioPipeline.drainSourceSampleQueue(source, { flushPartial: true });
    transcriptBuffer.flushFinalTranscript(source, 'stop-request');
    releaseAudio(source);
    try { await api.stopVoiceRecognition(source); } catch (error) { log('error', 'stop-failed', error.message, source); }
    audioPipeline.resetChunkCounter(source);
    patchSource(source, { active: false, status: 'off', partial: '', lastText: `${sourceLabel(source)} stopped` });
    log('info', 'source-stopped', `${sourceLabel(source)} source stopped`, source);
  }

  async function toggleTranscription() {
    if (!state.hasAssemblyKey) {
      toast('Add your AssemblyAI key in Settings first.', 'error');
      return;
    }
    if (anyActive() || anyConnecting()) {
      await Promise.all(['system', 'mic'].map(stopSource));
      return;
    }
    const selected = ['system', 'mic'].filter((source) => state.sources[source].selected);
    if (selected.length === 0) {
      toast('Turn on Interviewer audio or Mic first.', 'error');
      return;
    }
    for (const source of selected) await startSource(source);
  }

  function setSourceSelected(source, selected) {
    patchSource(source, { selected: Boolean(selected) });
    log('info', 'source-toggle', `${sourceLabel(source)} ${selected ? 'enabled' : 'disabled'}`, source);
    if (anyActive() || anyConnecting()) {
      (selected ? startSource(source) : stopSource(source)).catch((error) => log('error', 'source-toggle-failed', error.message, source));
    }
  }

  function handleSourceEnded(source, { error = null } = {}) {
    transcriptBuffer.flushFinalTranscript(source, error ? 'status-error' : 'stopped-event');
    releaseAudio(source);
    resetLine(source);
    patchSource(source, {
      active: false,
      partial: '',
      status: error ? 'error' : 'off',
      lastText: error ? `Error: ${error}` : `${sourceLabel(source)} stopped`
    });
  }

  // ── AI actions ──
  function setInFlight(id, value) {
    set((s) => ({ inFlight: { ...s.inFlight, [id]: value } }));
  }
  async function withLock(id, fn) {
    if (state.inFlight[id]) return;
    setInFlight(id, true);
    try { await fn(); } finally { setInFlight(id, false); }
  }
  function streamInto(actionId, label) {
    let text = '';
    const record = addMessage('ai-response', '', { label, streaming: true });
    const off = api.onAiStreamChunk((data) => {
      if (data?.actionId !== actionId) return;
      text += data.text;
      updateMessage(record.id, { content: text });
      set({ busyText: '' });
    });
    return {
      record,
      finish(finalText) {
        off?.();
        updateMessage(record.id, { content: finalText ?? text, streaming: false });
      },
      fail(message) {
        off?.();
        updateMessage(record.id, { streaming: false, note: message });
      }
    };
  }
  function requireModel() {
    if (state.hasModelKey) return true;
    toast('Add an AI model key in Settings first.', 'error');
    return false;
  }

  async function askAi() {
    if (!requireModel()) return;
    const bundle = contextBundle(true);
    if (!bundle.contextString && bundle.enabledScreenshotIds.length === 0) {
      toast('Nothing to answer yet: no transcript or screenshots.', 'error');
      return;
    }
    await withLock('askAi', async () => {
      const stream = streamInto('askAi', 'Best next answer');
      set({ busyText: 'Thinking about the whole conversation…' });
      try {
        const result = await api.askAiWithSessionContext({
          mode: 'best-next-answer',
          contextString: bundle.contextString,
          transcriptContext: bundle.transcriptContext,
          sessionSummary: bundle.sessionSummary,
          enabledScreenshotIds: bundle.enabledScreenshotIds,
          screenshotCount: bundle.enabledScreenshotIds.length
        });
        if (!result?.success || !result?.text) throw new Error(result?.error || 'Ask AI failed');
        stream.finish(result.text);
      } catch (error) {
        stream.fail(`Error: ${error.message}`);
        toast('Ask AI failed', 'error');
      } finally {
        set({ busyText: '' });
      }
    });
  }

  let screenAiStream = null;
  async function screenAi() {
    if (!requireModel()) return;
    const bundle = contextBundle(true);
    if (bundle.enabledScreenshotIds.length === 0) {
      toast('Take a screenshot first (Alt+Shift+S).', 'error');
      return;
    }
    if (state.inFlight.screenAi) return;
    setInFlight('screenAi', true);
    screenAiStream = streamInto('screenAi', 'Screen answer');
    set({ busyText: 'Reading the screen…' });
    try {
      await api.analyzeStealthWithContext({ contextString: bundle.contextString, enabledScreenshotIds: bundle.enabledScreenshotIds });
    } catch (error) {
      screenAiStream?.fail(`Error: ${error.message}`);
      screenAiStream = null;
      setInFlight('screenAi', false);
      set({ busyText: '' });
      toast('Screen analysis failed', 'error');
    }
  }

  async function simpleAction(id, label, call, pick, needsTranscriptOnly = false) {
    if (!requireModel()) return;
    const bundle = contextBundle(true);
    const context = needsTranscriptOnly ? String(bundle.transcriptContext || '').trim() : bundle.contextString;
    if (!context) {
      toast('Nothing to work with yet: no transcript.', 'error');
      return;
    }
    await withLock(id, async () => {
      const stream = streamInto(id, label);
      try {
        const result = await call(bundle, context);
        const text = pick(result);
        if (!result?.success || !text) throw new Error(result?.error || `${label} failed`);
        stream.finish(text);
      } catch (error) {
        stream.fail(`Error: ${error.message}`);
        toast(`${label} failed`, 'error');
      }
    });
  }
  const suggest = () => simpleAction('suggest', 'What to say next', (b, ctx) => api.suggestResponse({ context: b.sessionSummary || 'Current meeting conversation', contextString: ctx }), (r) => r?.suggestions, true);
  const notes = () => simpleAction('notes', 'Notes', (_b, ctx) => api.generateMeetingNotes({ contextString: ctx }), (r) => r?.notes);
  const insights = () => simpleAction('insights', 'Insights', (_b, ctx) => api.getConversationInsights({ contextString: ctx }), (r) => r?.insights);

  async function screenshot() {
    try { await api.takeStealthScreenshot(); } catch (_) { toast('Screenshot failed', 'error'); }
  }
  async function clearAll() {
    try {
      await api.clearStealth();
      await api.clearConversationHistory?.();
      pendingLine.system = null;
      pendingLine.mic = null;
      set({ messages: [], screenshots: 0 });
      toast('Cleared');
    } catch (_) {
      toast('Clear failed', 'error');
    }
  }
  async function hideNow() {
    try { await api.emergencyHide(); } catch (_) { /* ignore */ }
  }
  async function closeApp() {
    transcriptBuffer.flushAllFinalTranscripts('app-close');
    try { await api.closeApp(); } catch (_) { /* ignore */ }
  }

  // ── Settings & profile ──
  function applySettings(settings) {
    if (!settings) return;
    let hasModelKey;
    if (settings.aiProvider === 'ollama') hasModelKey = true;
    else if (settings.aiProvider === 'openai-compatible') hasModelKey = Boolean(settings.fastLlm?.apiKey || /localhost|127\.0\.0\.1/.test(settings.fastLlm?.baseUrl || ''));
    else hasModelKey = typeof settings.hasGeminiApiKeys === 'boolean' ? settings.hasGeminiApiKeys : Boolean(String(settings.geminiApiKey || '').trim());
    const hasAssemblyKey = typeof settings.hasAssemblyAiApiKey === 'boolean' ? settings.hasAssemblyAiApiKey : Boolean(String(settings.assemblyAiApiKey || '').trim());
    set({ settings, hasModelKey, hasAssemblyKey, theme: settings.themePreference || state.theme });
  }
  async function reloadSettings() {
    try { applySettings(await api.getSettings()); } catch (error) { log('error', 'settings-load-failed', error.message); }
  }
  async function saveSettings(values) {
    const result = await api.saveSettings(values);
    if (!result?.success) throw new Error(result?.error || 'Settings not saved');
    await reloadSettings();
    return result;
  }
  async function setTheme(theme) {
    set({ theme });
    try { await api.setThemePreference(theme); } catch (_) { /* ignore */ }
  }
  async function reloadInterview() {
    if (!api.interviewGetState) return null;
    const interview = await api.interviewGetState();
    if (interview && !interview.error) set({ interview });
    return interview;
  }
  async function saveProfile(profile) {
    const result = await api.interviewSaveProfile(profile);
    if (!result?.success) throw new Error(result?.error || 'Profile not saved');
    await reloadInterview();
    return result;
  }
  async function importText(kind) {
    const result = await api.interviewImportText(kind);
    if (result?.success) return result.text;
    if (result && !result.canceled) throw new Error(result.error || 'Import failed');
    return null;
  }
  async function importQa() {
    const result = await api.interviewImportQa();
    if (result?.success) { await reloadInterview(); return result.count; }
    if (result && !result.canceled) throw new Error(result.error || 'Import failed');
    return null;
  }
  async function clearSession() {
    const result = await api.interviewClearSession();
    if (result?.success) await reloadInterview();
  }
  async function answerLastQuestion() {
    const result = await api.interviewAnswerLastQuestion?.();
    if (result && result.success === false) toast(result.error || 'No question to answer yet', 'error');
  }

  // ── IPC wiring ──
  const liveAnswers = new Map();
  function bindIpc() {
    api.onScreenshotTakenStealth((payload) => {
      const data = typeof payload === 'object' && payload !== null ? payload : { count: payload };
      set({ screenshots: Number(data.count || 0) });
      addMessage('screenshot', 'Screenshot captured', { screenshotId: typeof data.screenshotId === 'string' ? data.screenshotId : null });
    });
    api.onAnalysisStart(() => { if (!screenAiStream) set({ busyText: 'Reading the screen…' }); });
    api.onAnalysisResult((data) => {
      set({ busyText: '' });
      setInFlight('screenAi', false);
      if (data?.error) {
        if (screenAiStream) screenAiStream.fail(`Error: ${data.error}`);
        else addMessage('system', `Error: ${data.error}`);
        toast('Screen analysis failed', 'error');
      } else if (screenAiStream) {
        screenAiStream.finish(data.text);
      } else {
        addMessage('ai-response', data?.text || '', { label: 'Screen answer' });
      }
      screenAiStream = null;
    });
    api.onEmergencyClear(() => set({ hidden: true }));
    api.onError((message) => toast(message, 'error'));

    api.onVoskStatus((data) => {
      const source = normalizeSource(data?.source);
      const status = data?.status;
      if (status === 'loading') patchSource(source, { status: 'connecting', lastText: 'Connecting…' });
      else if (status === 'listening') patchSource(source, { status: 'listening', lastText: 'Listening…' });
      else if (status === 'stopped') patchSource(source, { status: 'off', lastText: 'Stopped' });
      log('info', `status-${status}`, data?.message || '', source);
    });
    api.onVoskPartial((data) => {
      const source = normalizeSource(data?.source);
      const text = String(data?.text || '').trim();
      if (!text || !isActive(source)) return;
      patchSource(source, { partial: text, lastText: `Live: ${text}` });
    });
    api.onVoskFinal((data) => {
      const source = normalizeSource(data?.source);
      const text = String(data?.text || '').trim();
      if (!text) return;
      patchSource(source, { partial: '', lastText: `Final: ${text}` });
      log('info', 'final', 'Final transcript received', source, { chars: text.length });
      // Something (an answer, the other speaker) came after the line being
      // built: close it so the new words start a new line below.
      const pendingId = pendingLine[source];
      if (pendingId && state.messages[state.messages.length - 1]?.id !== pendingId) {
        transcriptBuffer.flushFinalTranscript(source, 'interleaved');
      }
      transcriptBuffer.queueFinalTranscript(source, text);
    });
    api.onVoskError((data) => {
      const source = normalizeSource(data?.source);
      const error = data?.error || 'Unknown transcription error';
      toast(`${sourceLabel(source)}: ${error}`, 'error');
      addMessage('system', `Transcription error (${sourceLabel(source)}): ${error}`);
      log('error', 'status-error', error, source);
      handleSourceEnded(source, { error });
    });
    api.onVoskStopped((data) => {
      const source = normalizeSource(data?.source);
      handleSourceEnded(source);
      log('info', 'stopped-event', 'Stop acknowledged', source);
    });
    api.onToggleVoiceRecognition?.(() => toggleTranscription().catch((error) => log('error', 'shortcut-toggle-failed', error.message)));
    api.onTriggerAskAi?.(() => askAi().catch((error) => log('error', 'shortcut-ask-ai-failed', error.message)));
    api.onSttDebug?.((data) => log(data?.level || 'info', data?.event || 'stt-debug', data?.message || '', data?.source || null, data?.meta || null, data?.ts || Date.now()));

    // Fast-mode answers from the main-process answer engine.
    api.onAiStreamStart?.((data) => {
      if (data?.actionId !== LIVE_ANSWER_ACTION) return;
      const record = addMessage('ai-response', '', { label: data.label || 'Suggested answer', streaming: true });
      liveAnswers.set(data.answerId, { id: record.id, text: '' });
    });
    api.onAiStreamChunk?.((data) => {
      if (data?.actionId !== LIVE_ANSWER_ACTION) return;
      const entry = liveAnswers.get(data.answerId);
      if (!entry) return;
      entry.text += data.text;
      updateMessage(entry.id, { content: entry.text });
    });
    api.onAiStreamEnd?.((data) => {
      if (data?.actionId !== LIVE_ANSWER_ACTION) return;
      const entry = liveAnswers.get(data.answerId);
      if (entry) {
        updateMessage(entry.id, {
          streaming: false,
          note: data.error ? data.error : data.interrupted ? 'Interrupted, answering the follow-up' : null
        });
      } else if (data.error) {
        addMessage('system', `Live answer failed: ${data.error}`);
      }
      liveAnswers.delete(data.answerId);
    });

    api.onClearFromMobile?.(() => { set({ messages: [], screenshots: 0 }); toast('Cleared from your phone'); });
    api.onMobileServerStatus?.((data) => set((s) => ({ mobile: { ...s.mobile, ...(data || {}) } })));
    api.getMobileServerStatus?.().then((data) => { if (data) set((s) => ({ mobile: { ...s.mobile, ...data } })); }).catch(() => {});

    window.addEventListener('error', (event) => log('error', 'renderer-error', event?.message || 'Renderer error'));
    window.addEventListener('unhandledrejection', (event) => log('error', 'renderer-rejection', event?.reason?.message || String(event?.reason || '')));
  }

  async function init() {
    bindIpc();
    await reloadSettings();
    try {
      const interview = await reloadInterview();
      if (interview?.session?.questions > 0) {
        addMessage('system', `Continuing your session: ${interview.session.questions} earlier interviewer lines, ${interview.session.answers} answers.${interview.profile.fastMode ? ' Fast mode is on.' : ''}`);
      } else if (interview?.profile?.fastMode) {
        addMessage('system', 'Fast mode is on: answers appear when the interviewer finishes a question.');
      }
    } catch (error) {
      log('error', 'interview-load-failed', error.message);
    }
    set({ ready: true });
    log('info', 'init', 'Renderer initialized');
    console.log('Renderer initialized - Ready for live transcription!');
  }

  return {
    getState,
    subscribe,
    onToast,
    init,
    contextBundle,
    actions: {
      toggleTranscription,
      setSourceSelected,
      askAi,
      screenAi,
      suggest,
      notes,
      insights,
      screenshot,
      clearAll,
      hideNow,
      closeApp,
      toggleInclusion,
      addManualContext,
      saveSettings,
      reloadSettings,
      setTheme,
      saveProfile,
      importText,
      importQa,
      clearSession,
      answerLastQuestion,
      listOllamaModels: (baseUrl) => api.listOllamaModels(baseUrl),
      copyText: (text) => navigator.clipboard.writeText(String(text || '')),
      toggleStealth: () => api.toggleStealth?.(),
      showWindow: () => set({ hidden: false }),
      toast
    }
  };
}
