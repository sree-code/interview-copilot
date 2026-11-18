'use strict';

// Automatic updates from GitHub Releases (Windows installer only).
// The new version downloads in the background; the app shows "Update ready"
// and installs it when you click Restart, or the next time you quit.
// The portable .exe, macOS and runs from source are not updated this way
// (use the README steps there).

const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;
const FIRST_CHECK_MS = 15000;

function createUpdater({ app, sendToRenderer, telemetry = null, loadAutoUpdater = () => require('electron-updater').autoUpdater }) {
  let status = { state: 'idle', version: null, supported: false };
  let autoUpdater = null;
  let timer = null;

  const supported = app.isPackaged
    && process.platform === 'win32'
    && !process.env.PORTABLE_EXECUTABLE_DIR
    && !/^(0|false|off)$/i.test(String(process.env.COPILOT_AUTO_UPDATE || ''));

  function setStatus(patch) {
    status = { ...status, ...patch };
    sendToRenderer('update-status', status);
  }

  function start() {
    status.supported = supported;
    if (!supported) return status;
    try {
      autoUpdater = loadAutoUpdater();
      autoUpdater.autoDownload = true;
      autoUpdater.autoInstallOnAppQuit = true;
      autoUpdater.on('checking-for-update', () => setStatus({ state: 'checking' }));
      autoUpdater.on('update-available', (info) => {
        setStatus({ state: 'downloading', version: info?.version || null });
        telemetry?.track('update_available', { to_version: info?.version || '' });
      });
      autoUpdater.on('update-not-available', () => setStatus({ state: 'idle' }));
      autoUpdater.on('download-progress', (progress) => setStatus({ state: 'downloading', percent: Math.round(progress?.percent || 0) }));
      autoUpdater.on('update-downloaded', (info) => {
        setStatus({ state: 'ready', version: info?.version || status.version });
        telemetry?.track('update_downloaded', { to_version: info?.version || '' });
      });
      autoUpdater.on('error', (error) => {
        setStatus({ state: 'error' });
        telemetry?.trackError('update', error);
      });
      const check = () => autoUpdater.checkForUpdates().catch(() => {});
      setTimeout(check, FIRST_CHECK_MS).unref?.();
      timer = setInterval(check, CHECK_EVERY_MS);
      timer.unref?.();
    } catch (error) {
      console.warn('Auto-update unavailable:', error.message);
      status = { ...status, supported: false };
    }
    return status;
  }

  function isReady() {
    return status.state === 'ready' && Boolean(autoUpdater);
  }

  // Restart now and install. silent=true: no installer window.
  function installNow() {
    if (!isReady()) return { success: false, error: 'No update downloaded yet.' };
    setImmediate(() => autoUpdater.quitAndInstall(true, true));
    return { success: true };
  }

  // Called when the app quits on its own (app.exit skips the updater's
  // quit hook): install silently without restarting.
  function installOnQuit() {
    if (!isReady()) return false;
    try {
      autoUpdater.quitAndInstall(true, false);
      return true;
    } catch (_) {
      return false;
    }
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { getStatus: () => status, installNow, installOnQuit, isReady, start, stop };
}

module.exports = {
  createUpdater
};
