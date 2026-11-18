const { invokeWithFallback } = require('./helpers');

function createInvokeActions(ipcRenderer) {
  return {
    toggleStealth: invokeWithFallback(ipcRenderer, {
      channel: 'toggle-stealth',
      label: 'toggleStealth',
      fallback: (error) => ({ error: error.message })
    }),

    emergencyHide: invokeWithFallback(ipcRenderer, {
      channel: 'emergency-hide',
      label: 'emergencyHide',
      fallback: (error) => ({ error: error.message })
    }),

    interviewGetState: invokeWithFallback(ipcRenderer, {
      channel: 'interview-get-state',
      label: 'interviewGetState',
      fallback: (error) => ({ error: error.message })
    }),

    interviewSaveProfile: invokeWithFallback(ipcRenderer, {
      channel: 'interview-save-profile',
      label: 'interviewSaveProfile',
      fallback: (error) => ({ success: false, error: error.message })
    }),

    interviewImportText: invokeWithFallback(ipcRenderer, {
      channel: 'interview-import-text',
      label: 'interviewImportText',
      fallback: (error) => ({ success: false, error: error.message })
    }),

    interviewImportQa: invokeWithFallback(ipcRenderer, {
      channel: 'interview-import-qa',
      label: 'interviewImportQa',
      fallback: (error) => ({ success: false, error: error.message })
    }),

    interviewClearSession: invokeWithFallback(ipcRenderer, {
      channel: 'interview-clear-session',
      label: 'interviewClearSession',
      fallback: (error) => ({ success: false, error: error.message })
    }),

    interviewAnswerLastQuestion: invokeWithFallback(ipcRenderer, {
      channel: 'interview-answer-last-question',
      label: 'interviewAnswerLastQuestion',
      fallback: (error) => ({ success: false, error: error.message })
    }),

    listOllamaModels: invokeWithFallback(ipcRenderer, {
      channel: 'list-ollama-models',
      label: 'listOllamaModels',
      fallback: (error) => ({ success: false, error: error.message })
    }),

    takeStealthScreenshot: invokeWithFallback(ipcRenderer, {
      channel: 'take-stealth-screenshot',
      label: 'takeStealthScreenshot',
      fallback: (error) => ({ error: error.message })
    }),

    analyzeStealth: invokeWithFallback(ipcRenderer, {
      channel: 'analyze-stealth',
      label: 'analyzeStealth',
      fallback: (error) => ({ error: error.message })
    }),

    analyzeStealthWithContext: invokeWithFallback(ipcRenderer, {
      channel: 'analyze-stealth-with-context',
      label: 'analyzeStealthWithContext',
      fallback: (error) => ({ error: error.message })
    }),

    askAiWithSessionContext: invokeWithFallback(ipcRenderer, {
      channel: 'ask-ai-with-session-context',
      label: 'askAiWithSessionContext',
      fallback: (error) => ({ success: false, error: error.message })
    }),

    clearStealth: invokeWithFallback(ipcRenderer, {
      channel: 'clear-stealth',
      label: 'clearStealth',
      fallback: (error) => ({ error: error.message })
    }),

    getScreenshotsCount: invokeWithFallback(ipcRenderer, {
      channel: 'get-screenshots-count',
      label: 'getScreenshotsCount',
      fallback: () => 0
    }),

    getWindowBounds: invokeWithFallback(ipcRenderer, {
      channel: 'get-window-bounds',
      label: 'getWindowBounds',
      fallback: (error) => ({ error: error.message })
    }),

    setWindowBounds: invokeWithFallback(ipcRenderer, {
      channel: 'set-window-bounds',
      label: 'setWindowBounds',
      fallback: (error) => ({ error: error.message })
    }),

    setCompactMode: invokeWithFallback(ipcRenderer, {
      channel: 'set-compact-mode',
      label: 'setCompactMode',
      fallback: (error) => ({ error: error.message })
    }),

    getCompactMode: invokeWithFallback(ipcRenderer, {
      channel: 'get-compact-mode',
      label: 'getCompactMode',
      fallback: () => false
    }),

    moveWindowTopCenter: invokeWithFallback(ipcRenderer, {
      channel: 'move-window-top-center',
      label: 'moveWindowTopCenter',
      fallback: (error) => ({ error: error.message })
    }),

    setWindowSizePreset: invokeWithFallback(ipcRenderer, {
      channel: 'set-window-size-preset',
      label: 'setWindowSizePreset',
      transformArgs: (args) => [{ preset: args[0] }],
      fallback: (error) => ({ error: error.message })
    }),

    startVoiceRecognition: invokeWithFallback(ipcRenderer, {
      channel: 'start-voice-recognition',
      label: 'startVoiceRecognition',
      transformArgs: (args) => [{ source: args[0] }],
      fallback: (error) => ({ error: error.message })
    }),

    stopVoiceRecognition: invokeWithFallback(ipcRenderer, {
      channel: 'stop-voice-recognition',
      label: 'stopVoiceRecognition',
      transformArgs: (args) => [{ source: args[0] }],
      fallback: (error) => ({ error: error.message })
    }),

setInterviewWindowOptions: invokeWithFallback(ipcRenderer, {
      channel: 'set-interview-window-options',
      label: 'setInterviewWindowOptions',
      fallback: (error) => ({ error: error.message })
    }),

    moveToNextDisplay: invokeWithFallback(ipcRenderer, {
      channel: 'move-to-next-display',
      label: 'moveToNextDisplay',
      fallback: (error) => ({ error: error.message })
    }),

    setZoomFactor: invokeWithFallback(ipcRenderer, {
      channel: 'set-zoom-factor',
      label: 'setZoomFactor',
      fallback: (error) => ({ error: error.message })
    }),

    setCallShortcuts: invokeWithFallback(ipcRenderer, {
      channel: 'set-call-shortcuts',
      label: 'setCallShortcuts',
      fallback: (error) => ({ error: error.message })
    }),

    forceEndpoint: invokeWithFallback(ipcRenderer, {
      channel: 'force-endpoint',
      label: 'forceEndpoint',
      fallback: () => false
    }),

    telemetryGetStatus: invokeWithFallback(ipcRenderer, {
      channel: 'telemetry-get-status',
      label: 'telemetryGetStatus',
      fallback: () => ({ configured: false, consent: null, askUser: false })
    }),

    telemetrySetConsent: invokeWithFallback(ipcRenderer, {
      channel: 'telemetry-set-consent',
      label: 'telemetrySetConsent',
      fallback: (error) => ({ error: error.message })
    }),

    importJobUrl: invokeWithFallback(ipcRenderer, {
      channel: 'interview-import-job-url',
      label: 'importJobUrl',
      fallback: (error) => ({ success: false, error: error.message })
    }),

    getMeetingStatus: invokeWithFallback(ipcRenderer, {
      channel: 'meeting-detect-get-status',
      label: 'getMeetingStatus',
      fallback: () => ({ apps: [] })
    }),

    setMeetingDetection: invokeWithFallback(ipcRenderer, {
      channel: 'meeting-detect-set-enabled',
      label: 'setMeetingDetection',
      fallback: (error) => ({ error: error.message })
    }),

    getUpdateStatus: invokeWithFallback(ipcRenderer, {
      channel: 'update-get-status',
      label: 'getUpdateStatus',
      fallback: () => ({ state: 'idle' })
    }),

    installUpdate: invokeWithFallback(ipcRenderer, {
      channel: 'update-install',
      label: 'installUpdate',
      fallback: (error) => ({ error: error.message })
    }),

    // Fire-and-forget, called on mousemove while click-through is on.
    setMousePassthrough: (ignore) => {
      ipcRenderer.send('set-mouse-passthrough', Boolean(ignore));
    },

    trackEvent: (event, props) => {
      ipcRenderer.send('telemetry-track', { event, props });
    },

    sendAudioChunk: (source, audioData) => {
      ipcRenderer.send('audio-chunk', { source, data: audioData });
    },

    getDesktopSources: invokeWithFallback(ipcRenderer, {
      channel: 'get-desktop-sources',
      label: 'getDesktopSources',
      fallback: () => []
    }),

    transcribeAudio: invokeWithFallback(ipcRenderer, {
      channel: 'transcribe-audio',
      label: 'transcribeAudio',
      fallback: (error) => ({ success: false, error: error.message })
    }),

    addVoiceTranscript: invokeWithFallback(ipcRenderer, {
      channel: 'add-voice-transcript',
      label: 'addVoiceTranscript',
      fallback: (error) => ({ error: error.message })
    }),

    suggestResponse: invokeWithFallback(ipcRenderer, {
      channel: 'suggest-response',
      label: 'suggestResponse',
      fallback: (error) => ({ error: error.message })
    }),

    generateMeetingNotes: invokeWithFallback(ipcRenderer, {
      channel: 'generate-meeting-notes',
      label: 'generateMeetingNotes',
      fallback: (error) => ({ error: error.message })
    }),

    generateFollowUpEmail: invokeWithFallback(ipcRenderer, {
      channel: 'generate-follow-up-email',
      label: 'generateFollowUpEmail',
      fallback: (error) => ({ error: error.message })
    }),

    answerQuestion: invokeWithFallback(ipcRenderer, {
      channel: 'answer-question',
      label: 'answerQuestion',
      fallback: (error) => ({ error: error.message })
    }),

    getConversationInsights: invokeWithFallback(ipcRenderer, {
      channel: 'get-conversation-insights',
      label: 'getConversationInsights',
      fallback: (error) => ({ error: error.message })
    }),

    clearConversationHistory: invokeWithFallback(ipcRenderer, {
      channel: 'clear-conversation-history',
      label: 'clearConversationHistory',
      fallback: (error) => ({ error: error.message })
    }),

    getConversationHistory: invokeWithFallback(ipcRenderer, {
      channel: 'get-conversation-history',
      label: 'getConversationHistory',
      fallback: (error) => ({ error: error.message })
    }),

    getSettings: invokeWithFallback(ipcRenderer, {
      channel: 'get-settings',
      label: 'getSettings',
      fallback: (error) => ({ error: error.message })
    }),

    saveSettings: invokeWithFallback(ipcRenderer, {
      channel: 'save-settings',
      label: 'saveSettings',
      fallback: (error) => ({ success: false, error: error.message })
    }),

    setThemePreference: invokeWithFallback(ipcRenderer, {
      channel: 'set-theme-preference',
      label: 'setThemePreference',
      transformArgs: (args) => [{ theme: args[0] }],
      fallback: (error) => ({ success: false, error: error.message })
    }),

    closeApp: invokeWithFallback(ipcRenderer, {
      channel: 'close-app',
      label: 'closeApp',
      fallback: (error) => ({ error: error.message })
    }),

    getMobileServerStatus: invokeWithFallback(ipcRenderer, {
      channel: 'mobile-server-get-status',
      label: 'getMobileServerStatus',
      fallback: () => ({ listening: false, port: 7823, urls: [], clientCount: 0, error: null })
    })
  };
}

module.exports = {
  createInvokeActions
};
