'use strict';

// `--smoke-test`: start the app, check the window loaded with its preload
// bridge and no renderer errors, then exit 0 (pass) or 1 (fail). Used by CI
// to prove the built app starts on Windows/macOS without a person watching.

const SETTLE_MS = 4000;
const TIMEOUT_MS = 45000;

function runSmokeTest({ app, mainWindow }) {
  const errors = [];
  const finish = (ok, reason) => {
    console.log(ok ? 'SMOKE PASS' : `SMOKE FAIL: ${reason}`);
    if (errors.length) console.log(`Renderer errors:\n- ${errors.join('\n- ')}`);
    app.exit(ok ? 0 : 1);
  };

  const timer = setTimeout(() => finish(false, `window did not finish loading within ${TIMEOUT_MS / 1000}s`), TIMEOUT_MS);
  const contents = mainWindow.webContents;

  contents.on('console-message', (event, legacyLevel, legacyMessage) => {
    const level = typeof event?.level === 'string' ? event.level : (legacyLevel >= 3 ? 'error' : 'info');
    const message = typeof event?.message === 'string' ? event.message : legacyMessage;
    if (level === 'error') errors.push(String(message).slice(0, 300));
  });
  contents.on('preload-error', (_event, preloadPath, error) => errors.push(`preload ${preloadPath}: ${error?.message || error}`));
  contents.on('render-process-gone', (_event, details) => {
    clearTimeout(timer);
    finish(false, `renderer crashed (${details?.reason})`);
  });
  contents.on('did-fail-load', (_event, code, description) => {
    clearTimeout(timer);
    finish(false, `page failed to load (${code} ${description})`);
  });

  contents.once('did-finish-load', () => {
    setTimeout(async () => {
      clearTimeout(timer);
      try {
        const state = await contents.executeJavaScript(
          `({ bridge: typeof window.electronAPI === 'object' && window.electronAPI !== null, app: !!document.getElementById('app') })`
        );
        if (!state.bridge) return finish(false, 'preload bridge (window.electronAPI) missing');
        if (!state.app) return finish(false, 'renderer root element missing');
        if (errors.length) return finish(false, `${errors.length} renderer error(s)`);
        return finish(true);
      } catch (error) {
        return finish(false, error.message);
      }
    }, SETTLE_MS);
  });
}

module.exports = { runSmokeTest };
