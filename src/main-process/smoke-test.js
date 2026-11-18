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
  send('vosk-final', { source: 'system', text: 'And how would it behave across regions?' });
  await wait(300);
  send('ai-stream-start', { actionId: 'autoAnswer', answerId: 'demo-3', label: 'Suggested answer' });
  send('ai-stream-chunk', { actionId: 'autoAnswer', answerId: 'demo-3', text: "Each region keeps its own bucket and syncs counts every few seconds, so a user can't get double the limit by switching regions." });
  send('ai-stream-end', { actionId: 'autoAnswer', answerId: 'demo-3' });
  await shot('conversation');
  await contents.executeJavaScript(`(() => { for (const el of document.querySelectorAll('.conversation *')) { if (el.scrollHeight > el.clientHeight + 20) { el.scrollTop = 0; } } })()`);
  await shot('conversation-top');
  await click('[aria-label="Dark mode"]');
  await shot('conversation-dark');
  await click('[aria-label="Light mode"]');
  // Notices: a call started, and the one-time stats question.
  send('meeting-detected', { app: 'zoom', label: 'Zoom' });
  await shot('notice-meeting');
  await contents.executeJavaScript('window.__copilotStore?.actions.dismissMeeting()');
  await contents.executeJavaScript('window.__copilotStore?._debugSet({ telemetry: { configured: true, required: true, consent: null, askUser: true } })');
  await shot('beta-accept');
  await contents.executeJavaScript('window.__copilotStore?._debugSet({ telemetry: { configured: true, required: true, consent: true, askUser: false } })');
  const scrollDrawer = () => contents.executeJavaScript(`(() => { for (const el of document.querySelectorAll('dialog *')) { if (el.scrollHeight > el.clientHeight + 40 && /(auto|scroll)/.test(getComputedStyle(el).overflowY)) { el.scrollTop = el.scrollHeight; return true; } } return false; })()`);
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
      await contents.executeJavaScript(`(() => { for (const el of document.querySelectorAll('dialog *')) el.scrollTop = 0; })()`);
      await shot(`settings-${tab.toLowerCase()}`);
      const sections = { Interview: [['Job post link', 'job'], ['Key terms', 'terms']], Window: [['Click-through in compact mode', 'interview']] }[tab] || [];
      for (const [text, name] of sections) {
        const ok = await contents.executeJavaScript(`(() => { const el = [...document.querySelectorAll('dialog *')].filter((e) => e.textContent.trim().startsWith(${JSON.stringify(text)})).sort((x, y) => x.querySelectorAll('*').length - y.querySelectorAll('*').length)[0]; if (!el) return false; el.scrollIntoView({ block: 'start' }); return true; })()`);
        if (ok) await shot(`settings-${tab.toLowerCase()}-${name}`);
      }
      if ((tab === 'Interview' || tab === 'Window') && await scrollDrawer()) await shot(`settings-${tab.toLowerCase()}-more`);
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
  await contents.executeJavaScript('window.__copilotStore?.actions.answerNav("previous")');
  await shot('compact-pager');
  await contents.executeJavaScript('window.__copilotStore?.actions.answerNav("next"); window.__copilotStore?.actions.zoomText("in"); window.__copilotStore?.actions.zoomText("in")');
  await shot('compact-bigger-text');
  await contents.executeJavaScript('window.__copilotStore?.actions.zoomText("reset")');
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
