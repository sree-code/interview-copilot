const {
  app,
  dialog,
  desktopCapturer,
  globalShortcut,
  ipcMain,
  screen,
  session
} = require('electron');
const WebSocket = require('ws');

const {
  loadApplicationEnvironment,
  normalizeGeminiApiKeys,
  saveApplicationEnvironment
} = require('../bootstrap/environment');
const {
  getAssemblyAiSpeechModels,
  getDefaultAssemblyAiSpeechModel,
  getKeyboardShortcuts,
  resolveAssemblyAiSpeechModel
} = require('../config');
const {
  getAppStatePath,
  loadAppState,
  saveAppState
} = require('../services/state/app-state');
const { createAssistantWindow } = require('../windows/assistant/window');
const { createSafeSender } = require('./shared/safe-send');
const { createGeminiRuntime } = require('./features/assistant/gemini-runtime');
const { createScreenshotManager } = require('./features/assistant/screenshot-manager');
const { registerAssistantIpc } = require('./features/assistant/ipc');
const { createAssemblyAiService } = require('../services/assembly-ai/service');
const { createOcrService } = require('../services/ocr/service');
const { registerAssemblyAiIpc } = require('../services/assembly-ai/ipc');
const { registerSettingsIpc } = require('./features/settings/ipc');
const { createInterviewStores } = require('./features/interview/stores');
const { createAnswerEngine } = require('./features/interview/answer-engine');
const { registerInterviewIpc } = require('./features/interview/ipc');
const { extractKeyterms } = require('./features/interview/keyterms');
const { createWindowController } = require('./features/window/window-controller');
const { DEFAULT_WINDOW_OPACITY_LEVEL } = require('./features/window/window-constants');
const { logStartupConfiguration } = require('./startup-logging');
const { createMobileServer } = require('./features/mobile-server/server');
const { createTelemetry } = require('./features/telemetry/telemetry');
const { createTelemetryObserver } = require('./features/telemetry/observer');
const telemetryConfig = require('../telemetry-config.json');
const { createMeetingDetector } = require('./features/meeting/meeting-detector');
const { createUpdater } = require('./features/updates/updater');

function resolveStartupOptions(argv = process.argv) {
  const normalizedArgs = Array.isArray(argv)
    ? argv.map((value) => String(value || '').trim().toLowerCase())
    : [];

  const hasFlag = (flag) => normalizedArgs.includes(flag);

  return {
    startHidden: hasFlag('--start-hidden') || hasFlag('--background')
  };
}

async function startApplication() {
  let appEnvironment = null;
  let appState = null;
  let isShuttingDown = false;
  const startupOptions = resolveStartupOptions();

  const geminiRuntime = createGeminiRuntime();
  const telemetry = createTelemetry({ app, config: telemetryConfig });
  let shortcutsRegistered = false;
  const registerShortcutsOnce = () => {
    if (shortcutsRegistered || !windowController) return;
    shortcutsRegistered = true;
    windowController.registerShortcuts();
  };
  const telemetryObserver = createTelemetryObserver({
    telemetry,
    getModelInfo: () => {
      const provider = geminiRuntime.getActiveAiProvider();
      const model = provider === 'openai-compatible'
        ? geminiRuntime.getFastLlmConfig().model
        : provider === 'ollama' ? 'local' : geminiRuntime.getActiveGeminiModel();
      return { provider, model };
    }
  });

  const assemblyAiSpeechModels = getAssemblyAiSpeechModels();
  const defaultAssemblyAiSpeechModel = getDefaultAssemblyAiSpeechModel();
  const keyboardShortcuts = getKeyboardShortcuts();
  let activeAssemblyAiSpeechModel = defaultAssemblyAiSpeechModel;

  let screenshotManager = null;
  let windowController = null;
  const ocrService = createOcrService();

  const baseSendToRenderer = createSafeSender(() => {
    if (!windowController) {
      return null;
    }

    return windowController.getMainWindow();
  });

  // Mobile server reports its own status (listening, URLs, client count) to
  // the desktop renderer via the un-augmented sender — we don't want it
  // bouncing back to mobile clients.
  const mobileServer = createMobileServer({
    getGeminiRuntime:    () => geminiRuntime,
    getScreenshotManager: () => screenshotManager,
    notifyDesktop:        baseSendToRenderer
  });

  // Augmented sender: events flow to both the Electron renderer and all
  // connected mobile WebSocket clients simultaneously.
  const sendToRenderer = (channel, data) => {
    telemetryObserver.observe(channel, data);
    baseSendToRenderer(channel, data);
    mobileServer.broadcast(channel, data);
  };

  // Profile, prepared Q&A and the running session, kept in userData so the
  // same session continues every time the app starts.
  const path = require('path');
  const interviewStores = createInterviewStores({
    baseDir: path.join(app.getPath('userData'), 'interview')
  });
  const interviewEngine = createAnswerEngine({
    stores: interviewStores,
    runtime: geminiRuntime,
    sendToRenderer
  });

  // "Faster" answer timing closes the interviewer's turn after a shorter
  // silence (AssemblyAI defaults otherwise). Your own mic keeps the defaults.
  const FAST_TURN_PARAMS = { min_turn_silence: 200, max_turn_silence: 900 };
  function getStreamOptions(source) {
    const profile = interviewStores.getProfile();
    return {
      keyterms: extractKeyterms(profile),
      speechModel: profile.language && profile.language !== 'en' ? 'universal-streaming-multilingual' : null,
      turnParams: source === 'system' && profile.answerTiming === 'fast' ? FAST_TURN_PARAMS : null
    };
  }

  const assemblyAiService = createAssemblyAiService({
    getStreamOptions,
    onFinalTranscript: (source, text, meta = {}) => {
      try {
        if (source === 'system' && Number.isFinite(meta.finalLatencyMs)) {
          telemetry.timing('stt_final', meta.finalLatencyMs, { forced: Boolean(meta.forced) });
        }
        // A turn closed by Ask AI is answered by Ask AI, not fast mode too.
        const pending = interviewEngine.onTranscriptFinal(source, text, { autoAnswer: !meta.forced });
        if (pending && typeof pending.catch === 'function') {
          pending.catch((error) => console.error('Live answer failed:', error));
        }
      } catch (error) {
        console.error('Interview engine error:', error);
      }
    },
    WebSocket,
    desktopCapturer,
    // Settings first, then ASSEMBLY_AI_API_KEY from .env.
    getAssemblyApiKey: () => appState?.assemblyAiApiKey || process.env.ASSEMBLY_AI_API_KEY || '',
    getSpeechModel: () => activeAssemblyAiSpeechModel,
    getGeminiService: () => geminiRuntime.getService(),
    sendToRenderer
  });

  const isListening = () => assemblyAiService.isSourceStreaming?.('system') || assemblyAiService.isSourceStreaming?.('mic');
  const meetingDetector = createMeetingDetector({
    isListening,
    onDetected: ({ app: appId, label }) => {
      sendToRenderer('meeting-detected', { app: appId, label });
      telemetry.track('meeting_detected', { app: appId });
    }
  });
  const updater = createUpdater({ app, sendToRenderer, telemetry });

  windowController = createWindowController({
    app,
    screen,
    globalShortcut,
    createAssistantWindow,
    getAppEnvironment: () => appEnvironment,
    emitSttDebug: assemblyAiService.emitSttDebug,
    sendToRenderer,
    onTakeStealthScreenshot: async () => {
      if (screenshotManager) {
        await screenshotManager.takeStealthScreenshot();
      }
    }
  });

  screenshotManager = createScreenshotManager({
    app,
    screen,
    getMainWindow: () => windowController.getMainWindow(),
    getAppEnvironment: () => appEnvironment,
    sendToRenderer,
    // Start OCR as soon as the screenshot exists, so the AI request later
    // doesn't wait for it. Only the Gemini path uses OCR text.
    onScreenshotCaptured: (entry) => {
      if (geminiRuntime.wantsOcr()) {
        ocrService.prewarm(entry);
      }
    }
  });

  function loadPersistedAppState() {
    appState = loadAppState(app);

    const activeAiProvider = geminiRuntime.setActiveAiProvider(appState.aiProvider);
    const keyState = geminiRuntime.setKeys(
      normalizeGeminiApiKeys(appState?.geminiApiKey),
      appState.geminiApiKeyIndex
    );
    const activeGeminiModel = geminiRuntime.setActiveGeminiModel(appState.geminiModel);
    const activeOllamaBaseUrl = geminiRuntime.setActiveOllamaBaseUrl(appState.ollamaBaseUrl);
    const activeOllamaModel = geminiRuntime.setActiveOllamaModel(appState.ollamaModel);
    geminiRuntime.setFastLlmConfig(appState.fastLlm || {});
    activeAssemblyAiSpeechModel = resolveAssemblyAiSpeechModel(appState.assemblyAiSpeechModel);
    const activeProgrammingLanguage = geminiRuntime.setActiveProgrammingLanguage(appState.programmingLanguage);
    const activeWindowOpacityLevel = windowController.setWindowOpacityLevel(appState.windowOpacityLevel);

    if (
      appState.aiProvider !== activeAiProvider ||
      appState.geminiApiKeyIndex !== keyState.activeApiKeyIndex ||
      appState.geminiModel !== activeGeminiModel ||
      appState.ollamaBaseUrl !== activeOllamaBaseUrl ||
      appState.ollamaModel !== activeOllamaModel ||
      appState.assemblyAiSpeechModel !== activeAssemblyAiSpeechModel ||
      appState.programmingLanguage !== activeProgrammingLanguage ||
      appState.windowOpacityLevel !== activeWindowOpacityLevel
    ) {
      appState = saveAppState(app, {
        aiProvider: activeAiProvider,
        geminiApiKeyIndex: keyState.activeApiKeyIndex,
        geminiModel: activeGeminiModel,
        ollamaBaseUrl: activeOllamaBaseUrl,
        ollamaModel: activeOllamaModel,
        assemblyAiSpeechModel: activeAssemblyAiSpeechModel,
        programmingLanguage: activeProgrammingLanguage,
        windowOpacityLevel: activeWindowOpacityLevel
      });
    }

    console.log('Loaded app state from:', getAppStatePath(app));
    console.log('Restored AI provider from app state:', activeAiProvider);
    console.log(`Restored Gemini API key index from app state: ${keyState.activeApiKeyIndex + 1}/${keyState.geminiApiKeys.length}`);
    console.log('Restored Gemini model from app state:', activeGeminiModel);
    console.log('Restored Ollama config from app state:', activeOllamaModel, 'at', activeOllamaBaseUrl);
    console.log('Restored AssemblyAI speech model from app state:', activeAssemblyAiSpeechModel);
    console.log('Restored programming language from app state:', activeProgrammingLanguage);
    console.log(`Restored window opacity level from app state: ${activeWindowOpacityLevel}/10`);
  }

  function cleanupTransientResources() {
    assemblyAiService.dispose();
    screenshotManager.cleanupTransientResources();
    ocrService.dispose().catch((error) => {
      console.error('Failed to dispose OCR worker:', error);
    });
    windowController.unregisterShortcuts();
    mobileServer.close();
    meetingDetector.stop();
    updater.stop();
  }

  function quitApplication() {
    if (isShuttingDown) {
      return;
    }

    isShuttingDown = true;

    cleanupTransientResources();
    windowController.destroyWindow();

    // Send queued stats, but never hold the exit for more than 1.5 s.
    Promise.race([
      telemetry.shutdown({ minutes_open: process.uptime() / 60 }),
      new Promise((resolve) => setTimeout(resolve, 1500))
    ]).finally(() => {
      // A downloaded update installs now (quietly) instead of on next start.
      if (!updater.installOnQuit()) app.exit(0);
    });
  }

  ipcMain.handle('meeting-detect-get-status', () => meetingDetector.getStatus());
  ipcMain.handle('meeting-detect-set-enabled', (_event, enabled) => meetingDetector.setEnabled(Boolean(enabled)));
  ipcMain.handle('update-get-status', () => updater.getStatus());
  ipcMain.handle('update-install', () => updater.installNow());

  ipcMain.handle('telemetry-get-status', () => telemetry.getStatus());
  ipcMain.handle('telemetry-set-consent', (_event, consent) => {
    const status = telemetry.setConsent(consent);
    if (!status.askUser) registerShortcutsOnce();
    return status;
  });
  // Feature use from the window. Only these names and only flag/number
  // properties are accepted.
  const RENDERER_EVENTS = new Set(['feature_used', 'setting_changed', 'ui_error']);
  ipcMain.on('telemetry-track', (_event, payload = {}) => {
    if (RENDERER_EVENTS.has(payload?.event)) telemetry.track(payload.event, payload.props || {});
  });

  ipcMain.handle('mobile-server-get-status', () => mobileServer.getStatus());

  registerAssistantIpc({
    ipcMain,
    screenshotManager,
    ocrService,
    windowController,
    geminiRuntime,
    assemblyAiService,
    sendToRenderer,
    quitApplication,
    interviewStores,
    interviewEngine
  });

  registerAssemblyAiIpc({
    ipcMain,
    assemblyAiService
  });

  registerInterviewIpc({
    ipcMain,
    dialog,
    getMainWindow: () => windowController.getMainWindow(),
    stores: interviewStores,
    engine: interviewEngine,
    beforeManualAnswer: () => assemblyAiService.forceEndpoint('system'),
    telemetry
  });

  registerSettingsIpc({
    ipcMain,
    app,
    getAppEnvironment: () => appEnvironment,
    setAppEnvironment: (nextEnvironment) => {
      appEnvironment = nextEnvironment;
    },
    getAppState: () => appState,
    setAppState: (nextAppState) => {
      appState = nextAppState;
    },
    getAppStatePath,
    saveApplicationEnvironment,
    saveAppState,
    geminiRuntime,
    windowController,
    getAssemblyAiSpeechModel: () => activeAssemblyAiSpeechModel,
    setAssemblyAiSpeechModel: (nextModel) => {
      activeAssemblyAiSpeechModel = resolveAssemblyAiSpeechModel(nextModel, activeAssemblyAiSpeechModel);
      return activeAssemblyAiSpeechModel;
    },
    keyboardShortcuts,
    assemblyAiSpeechModels,
    defaultAssemblyAiSpeechModel
  });

  // System ("host") audio: the renderer calls getDisplayMedia and we answer
  // with the first screen plus loopback audio. On macOS 14.2+ Electron 39+
  // uses the CoreAudio tap API for this (needs NSAudioCaptureUsageDescription,
  // set in package.json build.mac.extendInfo). Works on Windows too.
  function registerDisplayMediaLoopback() {
    session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
      desktopCapturer.getSources({ types: ['screen'] })
        .then((sources) => {
          if (!sources.length) {
            callback({});
            return;
          }
          callback({ video: sources[0], audio: 'loopback' });
        })
        .catch((error) => {
          console.error('Display media request failed:', error);
          callback({});
        });
    });
  }

  app.whenReady().then(() => {
    registerDisplayMediaLoopback();
    try {
      appEnvironment = loadApplicationEnvironment(app);
    } catch (error) {
      console.error('Failed to load application environment:', error);
      dialog.showErrorBox('Open-Cluely Configuration Error', error.message);
      app.exit(1);
      return;
    }

    loadPersistedAppState();

    logStartupConfiguration({
      appEnvironment,
      appState,
      geminiModels: geminiRuntime.getGeminiModels(),
      defaultGeminiModel: geminiRuntime.getDefaultGeminiModel(),
      assemblyAiSpeechModels,
      defaultAssemblyAiSpeechModel,
      programmingLanguages: geminiRuntime.getProgrammingLanguages(),
      defaultProgrammingLanguage: geminiRuntime.getDefaultProgrammingLanguage()
    });

    geminiRuntime.setActiveKeyIndexChangeHandler((nextIndex) => {
      if (!appState || appState.geminiApiKeyIndex === nextIndex) {
        return;
      }

      appState = saveAppState(app, { geminiApiKeyIndex: nextIndex });
      console.log(`Persisted Gemini API key index: ${nextIndex + 1}/${geminiRuntime.getApiKeys().length}`);
    });

    if (geminiRuntime.getActiveAiProvider() === 'openai-compatible') {
      geminiRuntime.initializeOpenAICompatibleService();
    } else if (geminiRuntime.getActiveAiProvider() === 'ollama') {
      geminiRuntime.initializeOllamaService(
        geminiRuntime.getActiveOllamaBaseUrl(),
        geminiRuntime.getActiveOllamaModel(),
        geminiRuntime.getActiveProgrammingLanguage()
      );
    } else {
      geminiRuntime.initializeGeminiService(
        geminiRuntime.getActiveApiKey(),
        geminiRuntime.getActiveGeminiModel(),
        geminiRuntime.getActiveProgrammingLanguage()
      );
    }

    app.commandLine.appendSwitch('enable-features', 'VaapiVideoDecoder');
    // Removed: ignore-certificate-errors, allow-running-insecure-content and
    // disable-web-security. They turned off TLS validation for every request
    // (API keys and transcripts to Gemini/AssemblyAI could be intercepted) and
    // overrode the window's webSecurity setting.
    app.commandLine.appendSwitch('enable-media-stream');

    const launchHidden = startupOptions.startHidden || appEnvironment.startHidden;
    console.log('App is ready, creating window...');
    console.log(`Startup mode: ${launchHidden ? 'hidden' : 'visible'}`);
    windowController.createWindow({ launchHidden });
    // Beta: global shortcuts stay off until the stats are accepted, so the
    // app can't be used around the accept screen.
    if (!telemetry.getStatus().askUser) registerShortcutsOnce();
    windowController.getMainWindow()?.webContents.once('did-finish-load', () => {
      telemetry.track('app_started', {
        startup_ms: Math.round(process.uptime() * 1000),
        provider: geminiRuntime.getActiveAiProvider(),
        fast_mode: Boolean(interviewStores.getProfile().fastMode),
        has_prepared_answers: interviewStores.getBank().pairs.length > 0,
        prepared_answers: interviewStores.getBank().pairs.length,
        has_resume: Boolean(interviewStores.getProfile().resumeText),
        language: interviewStores.getProfile().language || 'en',
        displays: screen.getAllDisplays().length
      });
    });

    updater.start();

    if (process.argv.includes('--smoke-test')) {
      require('./smoke-test').runSmokeTest({ app, mainWindow: windowController.getMainWindow() });
    }

    if (!launchHidden) {
      windowController.markVisible();
    }

    if (appState?.windowOpacityLevel == null) {
      windowController.setWindowOpacityLevel(DEFAULT_WINDOW_OPACITY_LEVEL);
    }

    console.log(`Window setup complete (${launchHidden ? 'hidden launch' : 'visible launch'})`);
  });

  app.on('window-all-closed', () => {
    // Keep running in background for stealth operation
  });

  app.on('activate', () => {
    if (!windowController.hasWindow()) {
      windowController.createWindow();
      windowController.markVisible();
    }
  });

  app.on('will-quit', () => {
    cleanupTransientResources();
  });

  app.on('render-process-gone', (_event, _contents, details) => {
    telemetry.track('crash', { kind: 'renderer', reason: details?.reason || '', exit_code: details?.exitCode });
  });
  app.on('child-process-gone', (_event, details) => {
    if (details?.reason !== 'clean-exit') {
      telemetry.track('crash', { kind: details?.type || 'child', reason: details?.reason || '', exit_code: details?.exitCode });
    }
  });
  process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);
    telemetry.trackError('main_process', error);
  });

  app.on('web-contents-created', (_event, contents) => {
    contents.on('new-window', (event) => {
      event.preventDefault();
    });

    contents.on('will-navigate', (event, navigationUrl) => {
      const mainWindow = windowController.getMainWindow();
      if (!mainWindow || mainWindow.isDestroyed()) {
        return;
      }

      if (navigationUrl !== mainWindow.webContents.getURL()) {
        event.preventDefault();
      }
    });
  });

  process.title = 'SystemIdleProcess';
}

module.exports = {
  startApplication
};
