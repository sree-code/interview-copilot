'use strict';

// Hide shrinks the window to a small icon; clicking it (or the shortcut)
// brings the full window back, centered under wherever the icon was dragged.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createWindowController } = require('../src/main-process/features/window/window-controller');

function fakeWindow(bounds) {
  let b = { ...bounds };
  let min = [400, 300];
  const handlers = {};
  return {
    sent: [],
    getBounds: () => ({ ...b }),
    setBounds: (next) => { b = { ...b, ...next }; },
    getPosition: () => [b.x, b.y],
    setPosition: (x, y) => { b.x = x; b.y = y; },
    getMinimumSize: () => [...min],
    setMinimumSize: (w, h) => { min = [w, h]; },
    isDestroyed: () => false,
    isVisible: () => true,
    showInactive: () => {},
    setIgnoreMouseEvents: () => {},
    setOpacity: () => {},
    setAlwaysOnTop: () => {},
    webContents: { on: (name, fn) => { handlers[name] = fn; }, once: () => {}, isDestroyed: () => false },
    on: () => {},
    _min: () => min
  };
}

function controllerWith(win) {
  const sent = [];
  const area = { x: 0, y: 0, width: 1440, height: 900 };
  const controller = createWindowController({
    app: {},
    screen: { getDisplayMatching: () => ({ workArea: area }), getPrimaryDisplay: () => ({ workArea: area, workAreaSize: area }) },
    globalShortcut: { register: () => true, unregisterAll: () => {} },
    createAssistantWindow: () => win,
    getAppEnvironment: () => ({ hideFromScreenCapture: true, nodeEnv: 'test' }),
    emitSttDebug: () => {},
    sendToRenderer: (channel, payload) => sent.push([channel, payload])
  });
  controller.createWindow();
  return { controller, sent };
}

test('hide shrinks to a 40px icon and shows again at the same size and place', () => {
  const win = fakeWindow({ x: 420, y: 8, width: 600, height: 400 });
  const { controller, sent } = controllerWith(win);

  controller.emergencyHide();
  assert.equal(controller.isMinimized(), true);
  assert.deepEqual(win.getBounds(), { x: 700, y: 8, width: 40, height: 40 });
  assert.deepEqual(sent.at(-1), ['window-minimized', true]);

  controller.toggleStealthMode(); // Alt+Shift+H shows it again
  assert.equal(controller.isMinimized(), false);
  assert.deepEqual(win.getBounds(), { x: 420, y: 8, width: 600, height: 400 });
  assert.deepEqual(win._min(), [400, 300]);
  assert.deepEqual(sent.at(-1), ['window-minimized', false]);
});

test('a dragged icon brings the window back under it, kept on screen', () => {
  const win = fakeWindow({ x: 420, y: 8, width: 600, height: 400 });
  const { controller } = controllerWith(win);
  controller.toggleMinimized();
  controller.moveIconBy(600, 300); // icon now at x=1300, y=308
  controller.restoreFromIcon();
  // Centered under the icon would overflow the right edge, so it's clamped.
  assert.deepEqual(win.getBounds(), { x: 840, y: 308, width: 600, height: 400 });
  controller.moveIconBy(10, 10); // ignored when not hidden
  assert.deepEqual(win.getBounds(), { x: 840, y: 308, width: 600, height: 400 });
});

test('moving the window or switching to compact first brings it back', () => {
  const win = fakeWindow({ x: 420, y: 8, width: 600, height: 400 });
  const { controller } = controllerWith(win);
  controller.toggleMinimized();
  controller.moveToTopCenter();
  assert.equal(controller.isMinimized(), false);
  assert.equal(win.getBounds().width, 600);
});
