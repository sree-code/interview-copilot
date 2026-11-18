'use strict';

// Notices when a call starts, so the app can offer to start listening.
//
// Windows: Windows records which apps are using the microphone right now
// (Settings > Privacy > Microphone shows the same data). An entry whose
// LastUsedTimeStop is 0 is in use. No native code needed.
// macOS: Zoom starts a "CptHost" helper only during a meeting.

const { execFile } = require('child_process');

const MIC_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone';
const POLL_MS = 4000;

const APPS = [
  { id: 'zoom', label: 'Zoom', pattern: /zoom/i },
  { id: 'teams', label: 'Microsoft Teams', pattern: /teams/i },
  { id: 'webex', label: 'Webex', pattern: /webex|ciscospark/i },
  { id: 'slack', label: 'Slack', pattern: /slack/i },
  { id: 'discord', label: 'Discord', pattern: /discord/i },
  { id: 'skype', label: 'Skype', pattern: /skype/i },
  { id: 'browser', label: 'your browser (Google Meet or another web call)', pattern: /chrome|msedge|firefox|brave|opera|vivaldi|arc\.exe/i }
];

function labelFor(name) {
  return APPS.find((app) => app.pattern.test(name)) || null;
}

// Parses `reg query <MIC_KEY> /s` output into the app names using the mic.
function parseMicInUse(output, { ownExe = '' } = {}) {
  const inUse = [];
  let current = null;
  for (const line of String(output || '').split(/\r?\n/)) {
    if (/^HKEY_/i.test(line.trim())) {
      current = line.trim();
      continue;
    }
    const match = line.match(/LastUsedTimeStop\s+REG_QWORD\s+0x([0-9a-f]+)/i);
    if (match && current && /^0+$/.test(match[1])) {
      const name = current.split('\\').pop().replace(/#/g, '\\');
      if (ownExe && name.toLowerCase() === ownExe.toLowerCase()) continue;
      inUse.push(name);
    }
  }
  return inUse;
}

function createMeetingDetector({
  platform = process.platform,
  exec = (cmd, args) => new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout: 3000, maxBuffer: 1024 * 1024 }, (error, stdout) => resolve(error ? '' : String(stdout)));
  }),
  ownExe = process.execPath,
  isListening = () => false,
  onDetected = () => {},
  setInterval: setTimer = setInterval,
  clearInterval: clearTimer = clearInterval
} = {}) {
  let enabled = false;
  let timer = null;
  let active = new Set(); // app ids seen in use on the last check
  let checking = false;

  async function detectApps() {
    if (platform === 'win32') {
      const output = await exec('reg', ['query', MIC_KEY, '/s']);
      return parseMicInUse(output, { ownExe }).map(labelFor).filter(Boolean);
    }
    if (platform === 'darwin') {
      const output = await exec('ps', ['-axco', 'comm']);
      return /^CptHost$/m.test(output) ? [APPS[0]] : [];
    }
    return [];
  }

  async function check() {
    if (checking) return [];
    checking = true;
    try {
      const apps = await detectApps();
      const next = new Set(apps.map((app) => app.id));
      // Report a call once when it starts, and only if we're not listening.
      for (const app of apps) {
        if (!active.has(app.id) && !isListening()) onDetected({ app: app.id, label: app.label });
      }
      active = next;
      return apps;
    } catch (_) {
      return [];
    } finally {
      checking = false;
    }
  }

  function setEnabled(value) {
    enabled = Boolean(value) && (platform === 'win32' || platform === 'darwin');
    if (enabled && !timer) {
      timer = setTimer(check, POLL_MS);
      timer.unref?.();
      check();
    } else if (!enabled && timer) {
      clearTimer(timer);
      timer = null;
      active = new Set();
    }
    return getStatus();
  }

  function getStatus() {
    return { enabled, supported: platform === 'win32' || platform === 'darwin', apps: [...active] };
  }

  return { check, getStatus, setEnabled, stop: () => setEnabled(false) };
}

module.exports = {
  createMeetingDetector,
  labelFor,
  parseMicInUse
};
