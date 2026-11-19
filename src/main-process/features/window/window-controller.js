const {
  WINDOW_DEFAULT_WIDTH,
  WINDOW_DEFAULT_HEIGHT,
  WINDOW_MIN_WIDTH,
  WINDOW_MIN_HEIGHT,
  WINDOW_OPACITY_LEVEL_MIN,
  WINDOW_OPACITY_LEVEL_MAX,
  DEFAULT_WINDOW_OPACITY_LEVEL,
  STEALTH_WINDOW_OPACITY
} = require('./window-constants');
const { getKeyboardShortcutAccelerator } = require('../../../config');

function createWindowController({
  app,
  screen,
  globalShortcut,
  createAssistantWindow,
  getAppEnvironment,
  emitSttDebug,
  sendToRenderer,
  onTakeStealthScreenshot
}) {
  let mainWindow = null;
  let isVisible = true;
  let isRecoveryReloadInProgress = false;
  let lastRecoveryReloadAt = 0;
  let activeWindowOpacityLevel = DEFAULT_WINDOW_OPACITY_LEVEL;
  // Compact mode: a small answer-only strip. Normal bounds are restored on exit.
  let compactMode = false;
  let normalBounds = null;
  let compactBounds = null;
  const COMPACT_MIN_WIDTH = 320;
  const COMPACT_MIN_HEIGHT = 120;
  // In compact mode the window doesn't take keyboard focus, so typing in
  // the meeting or your editor is never interrupted (setting, default on).
  let noFocusWhenCompact = true;
  let ignoringMouse = false;
  let onTopTimer = null;
  let callShortcutsActive = false;
  const CALL_SHORTCUTS = ['callAskAi', 'callScreenAi'];

  const RECOVERY_RELOAD_COOLDOWN_MS = 5000;

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function clampWindowOpacityLevel(level) {
    const parsedLevel = Number.parseInt(String(level ?? ''), 10);

    if (!Number.isFinite(parsedLevel)) {
      return DEFAULT_WINDOW_OPACITY_LEVEL;
    }

    return clamp(parsedLevel, WINDOW_OPACITY_LEVEL_MIN, WINDOW_OPACITY_LEVEL_MAX);
  }

  function setWindowOpacityLevel(level) {
    activeWindowOpacityLevel = clampWindowOpacityLevel(level);
    applyWindowOpacity();
    return activeWindowOpacityLevel;
  }

  function getWindowOpacityLevel() {
    return activeWindowOpacityLevel;
  }

  function getWindowOpacityFromLevel(level) {
    return clampWindowOpacityLevel(level) / 10;
  }

  function getVisibleWindowOpacity() {
    return getWindowOpacityFromLevel(activeWindowOpacityLevel);
  }

  function getStealthWindowOpacity() {
    return Math.min(getVisibleWindowOpacity(), STEALTH_WINDOW_OPACITY);
  }

  function getCurrentWindowOpacity() {
    return isVisible ? getVisibleWindowOpacity() : getStealthWindowOpacity();
  }

  function applyWindowOpacity() {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    mainWindow.setOpacity(getCurrentWindowOpacity());
  }

  function recoverMainWindowVisibility(reason, { reload = false } = {}) {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    console.warn(`Window recovery triggered: ${reason}`);
    if (typeof emitSttDebug === 'function') {
      emitSttDebug({
        level: 'error',
        event: 'window-recovery',
        message: reason
      });
    }

    try {

      isVisible = true;
      mainWindow.setOpacity(getVisibleWindowOpacity());
      if (!mainWindow.isVisible()) {
        mainWindow.show();
      }
      sendToRenderer('set-stealth-mode', false);
    } catch (error) {
      console.error('Window visibility recovery failed:', error);
    }

    if (!reload || !mainWindow.webContents || mainWindow.webContents.isDestroyed()) {
      return;
    }

    const now = Date.now();
    if (isRecoveryReloadInProgress || now - lastRecoveryReloadAt < RECOVERY_RELOAD_COOLDOWN_MS) {
      return;
    }

    isRecoveryReloadInProgress = true;
    lastRecoveryReloadAt = now;
    try {
      mainWindow.webContents.reload();
      if (typeof emitSttDebug === 'function') {
        emitSttDebug({
          event: 'window-reload',
          message: 'Triggered guarded renderer reload'
        });
      }
    } catch (error) {
      console.error('Window recovery reload failed:', error);
      isRecoveryReloadInProgress = false;
      return;
    }

    setTimeout(() => {
      isRecoveryReloadInProgress = false;
    }, 1500);
  }

  function attachWindowRecoveryHandlers() {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    mainWindow.on('unresponsive', () => {
      console.error('Main window became unresponsive');
      recoverMainWindowVisibility('window-unresponsive', { reload: true });
    });

    const contents = mainWindow.webContents;
    if (!contents || contents.isDestroyed()) {
      return;
    }

    contents.on('render-process-gone', (_event, details) => {
      console.error('Renderer process gone:', details);
      recoverMainWindowVisibility('render-process-gone', { reload: true });
    });

    contents.on('unresponsive', () => {
      console.error('WebContents became unresponsive');
      recoverMainWindowVisibility('webcontents-unresponsive', { reload: true });
    });

    contents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      console.error('WebContents did-fail-load:', {
        errorCode,
        errorDescription,
        validatedURL,
        isMainFrame
      });
      recoverMainWindowVisibility('did-fail-load', { reload: !!isMainFrame });
    });

    contents.on('did-finish-load', () => {
      isRecoveryReloadInProgress = false;
      // A reloaded window starts in full view; tell it it's an icon.
      if (minimized) sendToRenderer('window-minimized', true);
    });
  }

  // Windows: full-screen Teams/Zoom windows can end up above an always-on-top
  // window. Use the highest level and re-assert it every second.
  function startOnTopKeeper() {
    if (process.platform !== 'win32' || onTopTimer) return;
    const apply = () => {
      if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) return;
      try { mainWindow.setAlwaysOnTop(true, 'screen-saver', 1); } catch (_) { /* ignore */ }
    };
    apply();
    onTopTimer = setInterval(apply, 1000);
    onTopTimer.unref?.();
  }

  function stopOnTopKeeper() {
    if (onTopTimer) clearInterval(onTopTimer);
    onTopTimer = null;
  }

  function applyFocusPolicy() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const focusable = !(compactMode && noFocusWhenCompact);
    try {
      mainWindow.setFocusable(focusable);
      if (!focusable && mainWindow.isFocused()) mainWindow.blur();
    } catch (_) { /* not supported on this platform */ }
  }

  function setInterviewWindowOptions({ noFocus } = {}) {
    if (typeof noFocus === 'boolean') noFocusWhenCompact = noFocus;
    applyFocusPolicy();
    return { noFocus: noFocusWhenCompact };
  }

  // Click-through: the window ignores the mouse (clicks reach the meeting
  // app under it) except while the pointer is over its buttons. The window
  // decides by hit-testing mousemove events, which are still forwarded.
  function setMousePassthrough(ignore) {
    if (!mainWindow || mainWindow.isDestroyed()) return { ignoring: false };
    const next = Boolean(ignore) && compactMode;
    if (next !== ignoringMouse) {
      ignoringMouse = next;
      mainWindow.setIgnoreMouseEvents(next, { forward: true });
    }
    return { ignoring: ignoringMouse };
  }

  // Next monitor, keeping the same relative spot (compact: under its webcam).
  function moveToNextDisplay() {
    ensureRestored();
    if (!mainWindow || mainWindow.isDestroyed()) return { error: 'Main window not available' };
    const displays = screen.getAllDisplays().sort((a, b) => (a.bounds.x - b.bounds.x) || (a.bounds.y - b.bounds.y));
    if (displays.length < 2) return { displays: displays.length };
    const bounds = mainWindow.getBounds();
    const current = screen.getDisplayMatching(bounds);
    const index = displays.findIndex((d) => d.id === current.id);
    const from = current.workArea;
    const to = displays[(index + 1) % displays.length].workArea;
    const width = Math.min(bounds.width, to.width);
    const height = Math.min(bounds.height, to.height);
    const relX = (bounds.x - from.x) / Math.max(1, from.width - bounds.width);
    const relY = (bounds.y - from.y) / Math.max(1, from.height - bounds.height);
    mainWindow.setBounds({
      x: Math.round(to.x + clamp(relX, 0, 1) * (to.width - width)),
      y: Math.round(to.y + clamp(relY, 0, 1) * (to.height - height)),
      width,
      height
    }, false);
    if (compactMode) moveToTopCenter();
    return { ...mainWindow.getBounds(), displays: displays.length };
  }

  function setZoomFactor(factor) {
    if (!mainWindow || mainWindow.isDestroyed()) return { error: 'Main window not available' };
    const value = clamp(Number(factor) || 1, 0.7, 1.8);
    mainWindow.webContents.setZoomFactor(value);
    return { zoom: value };
  }

  // Ctrl+Enter style shortcuts are registered only while listening, so
  // they don't take those keys away from other apps the rest of the time.
  function setCallShortcuts(active) {
    const next = Boolean(active);
    if (next === callShortcutsActive) return { active: callShortcutsActive };
    for (const id of CALL_SHORTCUTS) {
      const accelerator = getKeyboardShortcutAccelerator(id);
      if (next) {
        const ok = globalShortcut.register(accelerator, () => {
          sendToRenderer(id === 'callAskAi' ? 'trigger-ask-ai' : 'trigger-screen-ai');
        });
        if (!ok) console.warn(`Failed to register shortcut "${id}" (${accelerator})`);
      } else if (globalShortcut.isRegistered(accelerator)) {
        globalShortcut.unregister(accelerator);
      }
    }
    callShortcutsActive = next;
    return { active: callShortcutsActive };
  }

  function createWindow({ launchHidden = false } = {}) {
    const appEnvironment = getAppEnvironment();
    mainWindow = createAssistantWindow({
      app,
      screen,
      defaultWidth: WINDOW_DEFAULT_WIDTH,
      defaultHeight: WINDOW_DEFAULT_HEIGHT,
      minWidth: WINDOW_MIN_WIDTH,
      minHeight: WINDOW_MIN_HEIGHT,
      hideFromScreenCapture: appEnvironment.hideFromScreenCapture,
      initialOpacity: launchHidden ? getStealthWindowOpacity() : getVisibleWindowOpacity(),
      launchHidden,
      nodeEnv: appEnvironment.nodeEnv
    });

    attachWindowRecoveryHandlers();
    startOnTopKeeper();
    mainWindow.webContents.on('render-process-gone', () => {
      // A crashed page can't un-ignore the mouse; never leave it unclickable.
      ignoringMouse = false;
      try { mainWindow.setIgnoreMouseEvents(false); } catch (_) { /* ignore */ }
    });
    isVisible = !launchHidden;
    return mainWindow;
  }

  function getMainWindow() {
    return mainWindow;
  }

  function getSafeWindowBounds(nextBounds = {}) {
    const currentBounds = mainWindow ? mainWindow.getBounds() : {
      x: 0,
      y: 0,
      width: WINDOW_DEFAULT_WIDTH,
      height: WINDOW_DEFAULT_HEIGHT
    };

    const rawBounds = {
      x: Number.isFinite(nextBounds.x) ? Math.round(nextBounds.x) : currentBounds.x,
      y: Number.isFinite(nextBounds.y) ? Math.round(nextBounds.y) : currentBounds.y,
      width: Number.isFinite(nextBounds.width) ? Math.round(nextBounds.width) : currentBounds.width,
      height: Number.isFinite(nextBounds.height) ? Math.round(nextBounds.height) : currentBounds.height
    };

    const display = screen.getDisplayMatching(rawBounds);
    const workArea = display && display.workArea ? display.workArea : screen.getPrimaryDisplay().workArea;

    const minWidth = compactMode ? COMPACT_MIN_WIDTH : WINDOW_MIN_WIDTH;
    const minHeight = compactMode ? COMPACT_MIN_HEIGHT : WINDOW_MIN_HEIGHT;
    const width = clamp(rawBounds.width, minWidth, workArea.width);
    const height = clamp(rawBounds.height, minHeight, workArea.height);
    const x = clamp(rawBounds.x, workArea.x, workArea.x + workArea.width - width);
    const y = clamp(rawBounds.y, workArea.y, workArea.y + workArea.height - height);

    return { x, y, width, height };
  }

  function setWindowBounds(nextBounds) {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return { error: 'Main window not available' };
    }

    const safeBounds = getSafeWindowBounds(nextBounds);
    mainWindow.setBounds(safeBounds, false);
    return mainWindow.getBounds();
  }

  function getWindowBounds() {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return { error: 'Main window not available' };
    }

    return mainWindow.getBounds();
  }

  // Hide = shrink to a small, faint icon in the same spot (the full window
  // is gone, so nothing to see or click by accident). Click the icon, or
  // press the hide shortcut again, to bring the window back. Drag the icon
  // to move it; the window comes back centered under it.
  const ICON_SIZE = 40;
  let minimized = null; // { bounds, minSize }

  function isMinimized() {
    return Boolean(minimized);
  }

  function minimizeToIcon() {
    if (!mainWindow || mainWindow.isDestroyed()) return { minimized: false };
    if (minimized) return { minimized: true };
    const bounds = mainWindow.getBounds();
    minimized = { bounds, minSize: mainWindow.getMinimumSize() };
    setMousePassthroughOff();
    sendToRenderer('window-minimized', true);
    mainWindow.setMinimumSize(ICON_SIZE, ICON_SIZE);
    mainWindow.setBounds({
      x: bounds.x + Math.round((bounds.width - ICON_SIZE) / 2),
      y: bounds.y,
      width: ICON_SIZE,
      height: ICON_SIZE
    }, false);
    return { minimized: true };
  }

  function restoreFromIcon() {
    if (!mainWindow || mainWindow.isDestroyed() || !minimized) return { minimized: false };
    const { bounds, minSize } = minimized;
    minimized = null;
    const icon = mainWindow.getBounds();
    const display = screen.getDisplayMatching(icon) || screen.getPrimaryDisplay();
    const area = display.workArea;
    const width = Math.min(bounds.width, area.width);
    const height = Math.min(bounds.height, area.height);
    const x = clamp(icon.x + Math.round(ICON_SIZE / 2 - width / 2), area.x, area.x + area.width - width);
    const y = clamp(icon.y, area.y, area.y + area.height - height);
    if (Array.isArray(minSize) && minSize.length === 2) mainWindow.setMinimumSize(minSize[0], minSize[1]);
    mainWindow.setBounds({ x, y, width, height }, false);
    if (!mainWindow.isVisible()) mainWindow.showInactive();
    sendToRenderer('window-minimized', false);
    return { minimized: false };
  }

  function toggleMinimized() {
    return minimized ? restoreFromIcon() : minimizeToIcon();
  }

  // Dragging the icon (the renderer sends how far the pointer moved).
  function moveIconBy(dx, dy) {
    if (!mainWindow || mainWindow.isDestroyed() || !minimized) return;
    const stepX = Math.round(Number(dx) || 0);
    const stepY = Math.round(Number(dy) || 0);
    if (!stepX && !stepY) return;
    const [x, y] = mainWindow.getPosition();
    mainWindow.setPosition(x + stepX, y + stepY);
  }

  // Anything that moves or resizes the full window brings it back first.
  function ensureRestored() {
    if (minimized) restoreFromIcon();
  }

  // Old names, kept for the existing shortcuts and IPC.
  function toggleStealthMode() {
    return toggleMinimized();
  }

  function emergencyHide() {
    return toggleMinimized();
  }

  function moveToPosition(position) {
    ensureRestored();
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    const windowBounds = mainWindow.getBounds();

    let x;
    let y;

    switch (position) {
      case 'left':
        x = 20;
        y = windowBounds.y;
        break;
      case 'right':
        x = width - windowBounds.width - 20;
        y = windowBounds.y;
        break;
      case 'top':
        x = Math.floor((width - windowBounds.width) / 2);
        y = 40;
        break;
      case 'bottom':
        x = Math.floor((width - windowBounds.width) / 2);
        y = height - windowBounds.height - 40;
        break;
      default:
        return;
    }

    mainWindow.setPosition(x, y);
  }

  function getCurrentWorkArea() {
    const bounds = mainWindow.getBounds();
    const display = screen.getDisplayMatching(bounds) || screen.getPrimaryDisplay();
    return display.workArea;
  }

  // Top center of the screen the window is on, just under where a laptop
  // webcam sits, so reading the answer looks like eye contact.
  function moveToTopCenter() {
    ensureRestored();
    if (!mainWindow || mainWindow.isDestroyed()) {
      return { error: 'Main window not available' };
    }
    const workArea = getCurrentWorkArea();
    const { width } = mainWindow.getBounds();
    mainWindow.setPosition(
      workArea.x + Math.round((workArea.width - width) / 2),
      workArea.y + 8
    );
    return mainWindow.getBounds();
  }

  function setCompactMode(enabled) {
    ensureRestored();
    if (!mainWindow || mainWindow.isDestroyed()) {
      return { error: 'Main window not available' };
    }
    const next = Boolean(enabled);
    if (next === compactMode) {
      return { compact: compactMode };
    }

    if (next) {
      normalBounds = mainWindow.getBounds();
      compactMode = true;
      mainWindow.setMinimumSize(COMPACT_MIN_WIDTH, COMPACT_MIN_HEIGHT);
      if (compactBounds) {
        mainWindow.setBounds(getSafeWindowBounds(compactBounds), false);
      } else {
        const workArea = getCurrentWorkArea();
        const width = clamp(Math.round(workArea.width * 0.36), 460, 720);
        const height = 210;
        mainWindow.setBounds(getSafeWindowBounds({
          x: workArea.x + Math.round((workArea.width - width) / 2),
          y: workArea.y + 8,
          width,
          height
        }), false);
      }
    } else {
      compactBounds = mainWindow.getBounds();
      compactMode = false;
      setMousePassthroughOff();
      mainWindow.setMinimumSize(WINDOW_MIN_WIDTH, WINDOW_MIN_HEIGHT);
      if (normalBounds) {
        mainWindow.setBounds(getSafeWindowBounds(normalBounds), false);
      }
    }

    applyFocusPolicy();
    sendToRenderer('compact-mode-changed', compactMode);
    return { compact: compactMode };
  }

  function setMousePassthroughOff() {
    if (ignoringMouse && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setIgnoreMouseEvents(false);
    }
    ignoringMouse = false;
  }

  function isCompactMode() {
    return compactMode;
  }

  function clampWindowSizePreset(preset) {
    const parsedPreset = Number.parseInt(String(preset ?? ''), 10);
    if (!Number.isFinite(parsedPreset)) {
      return 1;
    }

    return clamp(parsedPreset, 1, 4);
  }

  function getWindowSizeScaleForPreset(preset) {
    const clampedPreset = clampWindowSizePreset(preset);
    return 1 + ((clampedPreset - 1) * 0.25);
  }

  function setWindowSizePreset(preset) {
    ensureRestored();
    if (!mainWindow || mainWindow.isDestroyed()) {
      return { error: 'Main window not available' };
    }

    const clampedPreset = clampWindowSizePreset(preset);
    const scale = getWindowSizeScaleForPreset(clampedPreset);
    const currentBounds = mainWindow.getBounds();

    const width = Math.round(WINDOW_MIN_WIDTH * scale);
    const height = Math.round(WINDOW_MIN_HEIGHT * scale);

    const centerX = currentBounds.x + Math.round(currentBounds.width / 2);
    const centerY = currentBounds.y + Math.round(currentBounds.height / 2);

    const nextBounds = getSafeWindowBounds({
      x: centerX - Math.round(width / 2),
      y: centerY - Math.round(height / 2),
      width,
      height
    });

    mainWindow.setBounds(nextBounds, false);
    return {
      ...mainWindow.getBounds(),
      preset: clampedPreset
    };
  }

  function registerShortcuts() {
    const registerShortcut = (shortcutId, handler) => {
      const accelerator = getKeyboardShortcutAccelerator(shortcutId);
      const isRegistered = globalShortcut.register(accelerator, handler);
      if (!isRegistered) {
        console.warn(`Failed to register shortcut "${shortcutId}" (${accelerator})`);
      }
    };

    registerShortcut('toggleStealth', () => {
      toggleStealthMode();
    });

    registerShortcut('takeScreenshot', async () => {
      if (typeof onTakeStealthScreenshot === 'function') {
        await onTakeStealthScreenshot();
      }
    });

    registerShortcut('askAi', async () => {
      if (typeof emitSttDebug === 'function') {
        emitSttDebug({
          event: 'shortcut-ask-ai',
          message: 'Global Ask AI shortcut triggered'
        });
      }
      sendToRenderer('trigger-ask-ai');
    });

    registerShortcut('emergencyHide', () => {
      emergencyHide();
    });

    registerShortcut('toggleTranscription', () => {
      if (typeof emitSttDebug === 'function') {
        emitSttDebug({
          event: 'shortcut-toggle',
          message: 'Global transcription shortcut triggered'
        });
      }
      sendToRenderer('toggle-voice-recognition');
    });

    registerShortcut('moveWindowLeft', () => {
      moveToPosition('left');
    });

    registerShortcut('moveWindowRight', () => {
      moveToPosition('right');
    });

    registerShortcut('moveWindowUp', () => {
      moveToPosition('top');
    });

    registerShortcut('moveWindowDown', () => {
      moveToPosition('bottom');
    });

    registerShortcut('toggleCompact', () => {
      setCompactMode(!compactMode);
    });

    registerShortcut('moveWindowTopCenter', () => {
      moveToTopCenter();
    });

    registerShortcut('previousAnswer', () => sendToRenderer('answer-nav', 'previous'));
    registerShortcut('nextAnswer', () => sendToRenderer('answer-nav', 'next'));
    registerShortcut('scrollAnswerUp', () => sendToRenderer('answer-nav', 'up'));
    registerShortcut('scrollAnswerDown', () => sendToRenderer('answer-nav', 'down'));
    registerShortcut('textBigger', () => sendToRenderer('text-zoom', 'in'));
    registerShortcut('textSmaller', () => sendToRenderer('text-zoom', 'out'));
    registerShortcut('textReset', () => sendToRenderer('text-zoom', 'reset'));
    registerShortcut('nextScreen', () => moveToNextDisplay());

    registerShortcut('windowSizePreset1', () => {
      setWindowSizePreset(1);
    });

    registerShortcut('windowSizePreset2', () => {
      setWindowSizePreset(2);
    });

    registerShortcut('windowSizePreset3', () => {
      setWindowSizePreset(3);
    });

    registerShortcut('windowSizePreset4', () => {
      setWindowSizePreset(4);
    });
  }

  function unregisterShortcuts() {
    callShortcutsActive = false;
    globalShortcut.unregisterAll();
  }

  function destroyWindow() {

    stopOnTopKeeper();
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    mainWindow.setClosable(true);
    mainWindow.destroy();
    mainWindow = null;
  }

  function hasWindow() {
    return !!mainWindow && !mainWindow.isDestroyed();
  }

  function markVisible() {
    isVisible = true;
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.showInactive();
    }
    applyWindowOpacity();
  }

  return {
    applyWindowOpacity,
    clampWindowOpacityLevel,
    createWindow,
    destroyWindow,
    emergencyHide,
    isMinimized,
    moveIconBy,
    restoreFromIcon,
    toggleMinimized,
    getMainWindow,
    getWindowBounds,
    getWindowOpacityLevel,
    hasWindow,
    isCompactMode,
    moveToNextDisplay,
    moveToTopCenter,
    setCallShortcuts,
    setInterviewWindowOptions,
    setMousePassthrough,
    setZoomFactor,
    setCompactMode,
    markVisible,
    registerShortcuts,
    setWindowSizePreset,
    setWindowBounds,
    setWindowOpacityLevel,
    toggleStealthMode,
    unregisterShortcuts
  };
}

module.exports = {
  createWindowController
};
