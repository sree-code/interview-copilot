'use strict';

// `--smoke-test`: start the app, check the window loaded with its preload
// bridge and no renderer errors, then exit 0 (pass) or 1 (fail). Used by CI
// to prove the built app starts on Windows/macOS without a person watching.

const SETTLE_MS = 4000;
const TIMEOUT_MS = 45000;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Optional: SMOKE_SCREENSHOT_DIR=<dir> saves PNGs of the main view and each
// settings tab, for checking the UI without a person watching.
async function captureScreens(contents, dir) {
  const fs = require('fs');
  const path = require('path');
  fs.mkdirSync(dir, { recursive: true });
  const shot = async (name) => {
    await wait(700);
    const image = await contents.capturePage();
    fs.writeFileSync(path.join(dir, `${name}.png`), image.toPNG());
    console.log(`Saved ${name}.png`);
  };
  const click = (selector) => contents.executeJavaScript(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (el) el.click(); return !!el; })()`);
  await shot('main');

  // Feed a short mock interview through the same IPC events the services send.
  const send = (channel, payload) => contents.send(channel, payload);
  send('vosk-final', { source: 'system', text: 'Thanks for joining. Could you introduce yourself?' });
  await wait(400);
  send('ai-stream-start', { actionId: 'autoAnswer', answerId: 'demo-1', label: 'Your prepared answer' });
  send('ai-stream-chunk', { actionId: 'autoAnswer', answerId: 'demo-1', text: "I'm a backend engineer with five years in payments. Most recently I led the **ledger rebuild** at my current company." });
  send('ai-stream-end', { actionId: 'autoAnswer', answerId: 'demo-1' });
  send('vosk-final', { source: 'mic', text: "Sure, so I'm a backend engineer, about five years on payment systems." });
  send('vosk-final', { source: 'system', text: 'How would you design a rate limiter for a public API?' });
  await wait(400);
  send('ai-stream-start', { actionId: 'autoAnswer', answerId: 'demo-2', label: 'Suggested answer' });
  for (const part of ["I'd use a token bucket per API key, ", 'stored in Redis so every instance shares it.\n\n', '```python\ndef allow(key):\n    return bucket(key).take(1)\n```']) {
    send('ai-stream-chunk', { actionId: 'autoAnswer', answerId: 'demo-2', text: part });
    await wait(150);
  }
  send('ai-stream-end', { actionId: 'autoAnswer', answerId: 'demo-2' });
  await shot('conversation');
  await contents.executeJavaScript(`(() => { for (const el of document.querySelectorAll('.conversation *')) { if (el.scrollHeight > el.clientHeight + 20) { el.scrollTop = 0; } } })()`);
  await shot('conversation-top');
  await click('[aria-label="Dark mode"]');
  await shot('conversation-dark');
  await click('[aria-label="Light mode"]');
  if (await click('[aria-label="Settings"]')) {
    await shot('settings-ai');
    for (const tab of ['Interview', 'Window', 'Shortcuts', 'Diagnostics']) {
      const found = await contents.executeJavaScript(`(() => {
        const el = [...document.querySelectorAll('dialog button, dialog a, dialog [role]')].find((t) => t.textContent.trim().startsWith(${JSON.stringify(tab)}));
        if (!el) return 'tabs: ' + [...document.querySelectorAll('dialog button')].map((t) => t.tagName + ':' + t.textContent.trim()).join(',');
        for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) el.dispatchEvent(new PointerEvent(type, { bubbles: true, isPrimary: true, button: 0 }));
        el.click();
        return 'ok';
      })()`);
      if (found !== 'ok') console.log(`Tab ${tab} not clicked (${found})`);
      await shot(`settings-${tab.toLowerCase()}`);
    }
    await contents.executeJavaScript(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  }
  // See-through panel, then compact mode (latest answer only).
  await contents.executeJavaScript('window.__copilotStore?.actions.setBackgroundLevel(35)');
  await shot('see-through');
  await contents.executeJavaScript('window.__copilotStore?.actions.setCompact(true)');
  await wait(500);
  await shot('compact-see-through');
  await contents.executeJavaScript('window.__copilotStore?.actions.setBackgroundLevel(100)');
  await shot('compact');
  await contents.executeJavaScript('window.__copilotStore?.actions.setCompact(false)');
}

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
        if (process.env.SMOKE_SCREENSHOT_DIR) await captureScreens(contents, process.env.SMOKE_SCREENSHOT_DIR);
        if (errors.length) return finish(false, `${errors.length} renderer error(s)`);
        return finish(true);
      } catch (error) {
        return finish(false, error.message);
      }
    }, SETTLE_MS);
  });
}

module.exports = { runSmokeTest };
