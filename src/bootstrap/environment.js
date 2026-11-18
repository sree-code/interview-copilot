const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const OPTIONAL_ENV_DEFAULTS = Object.freeze({
  HIDE_FROM_SCREEN_CAPTURE: 'true',
  START_HIDDEN: 'false',
  MAX_SCREENSHOTS: '50',
  SCREENSHOT_DELAY: '300',
  NODE_ENV: 'production',
  NODE_OPTIONS: '--max-old-space-size=4096'
});

function normalizeGeminiApiKeys(value) {
  const sourceValues = Array.isArray(value)
    ? value
    : String(value ?? '').split(',');
  const seen = new Set();
  const keys = [];

  for (const rawValue of sourceValues) {
    const key = String(rawValue || '').trim();
    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    keys.push(key);
  }

  return keys;
}

// Where the app reads and writes its .env.
// Dev: the project folder. Packaged: the per-user data folder
// (%APPDATA%\Meeting Assistant on Windows, ~/Library/Application Support/...
// on macOS). Never the install folder: the Windows portable .exe unpacks to a
// new temp folder on every launch, Program Files isn't writable, and writing
// inside a macOS .app breaks its signature.
function getEnvPath(app) {
  return app.isPackaged
    ? path.join(app.getPath('userData'), '.env')
    : path.join(__dirname, '..', '..', '.env');
}

// Extra read-only places a packaged build also checks, so a .env placed next
// to the portable .exe (or bundled in resources) still works. Earlier files
// win; values already in the environment are never overridden.
function getExtraEnvPaths(app) {
  if (!app.isPackaged) return [];
  return [
    process.env.PORTABLE_EXECUTABLE_DIR && path.join(process.env.PORTABLE_EXECUTABLE_DIR, '.env'),
    process.resourcesPath && path.join(process.resourcesPath, '.env')
  ].filter(Boolean);
}

function parseBoolean(value, defaultValue) {
  if (value == null || value === '') {
    return defaultValue;
  }

  const normalized = String(value).trim().toLowerCase();

  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }

  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return defaultValue;
}

function parsePositiveInteger(value, defaultValue) {
  const parsedValue = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : defaultValue;
}

function normalizeApplicationEnvironment(source = {}) {
  const geminiApiKeys = normalizeGeminiApiKeys(
    source.geminiApiKey ?? source.geminiApiKeys ?? source.GEMINI_API_KEY
  );

  return {
    geminiApiKey: geminiApiKeys.join(','),
    geminiApiKeys,
    // .env uses ASSEMBLY_AI_API_KEY; without this it was read as empty and
    // then blanked in process.env by syncProcessEnvironment.
    assemblyAiApiKey: String(source.assemblyAiApiKey || source.ASSEMBLY_AI_API_KEY || '').trim(),
    hideFromScreenCapture: parseBoolean(
      source.HIDE_FROM_SCREEN_CAPTURE ?? source.hideFromScreenCapture,
      parseBoolean(OPTIONAL_ENV_DEFAULTS.HIDE_FROM_SCREEN_CAPTURE, true)
    ),
    startHidden: parseBoolean(
      source.START_HIDDEN ?? source.startHidden,
      parseBoolean(OPTIONAL_ENV_DEFAULTS.START_HIDDEN, false)
    ),
    maxScreenshots: parsePositiveInteger(
      source.MAX_SCREENSHOTS ?? source.maxScreenshots,
      parsePositiveInteger(OPTIONAL_ENV_DEFAULTS.MAX_SCREENSHOTS, 50)
    ),
    screenshotDelay: parsePositiveInteger(
      source.SCREENSHOT_DELAY ?? source.screenshotDelay,
      parsePositiveInteger(OPTIONAL_ENV_DEFAULTS.SCREENSHOT_DELAY, 300)
    ),
    nodeEnv: String(source.NODE_ENV || source.nodeEnv || OPTIONAL_ENV_DEFAULTS.NODE_ENV).trim() || OPTIONAL_ENV_DEFAULTS.NODE_ENV,
    nodeOptions: String(source.NODE_OPTIONS || source.nodeOptions || OPTIONAL_ENV_DEFAULTS.NODE_OPTIONS).trim() || OPTIONAL_ENV_DEFAULTS.NODE_OPTIONS
  };
}

function syncProcessEnvironment(environment) {
  process.env.GEMINI_API_KEY = environment.geminiApiKey;
  process.env.ASSEMBLY_AI_API_KEY = environment.assemblyAiApiKey;
  process.env.HIDE_FROM_SCREEN_CAPTURE = String(environment.hideFromScreenCapture);
  process.env.START_HIDDEN = String(environment.startHidden);
  process.env.MAX_SCREENSHOTS = String(environment.maxScreenshots);
  process.env.SCREENSHOT_DELAY = String(environment.screenshotDelay);
  process.env.NODE_ENV = environment.nodeEnv;
  process.env.NODE_OPTIONS = environment.nodeOptions;
}

function validateRequiredEnvironment(environment, envPath) {
  void environment;
  void envPath;
}

function loadApplicationEnvironment(app) {
  const envPath = getEnvPath(app);
  for (const candidate of [envPath, ...getExtraEnvPaths(app)]) {
    if (fs.existsSync(candidate)) dotenv.config({ path: candidate, quiet: true });
  }

  const environment = normalizeApplicationEnvironment(process.env);
  syncProcessEnvironment(environment);
  validateRequiredEnvironment(environment, envPath);

  return {
    envPath,
    ...environment
  };
}

const MANAGED_ENV_KEYS = new Set([
  'HIDE_FROM_SCREEN_CAPTURE', 'START_HIDDEN', 'MAX_SCREENSHOTS', 'SCREENSHOT_DELAY', 'NODE_ENV', 'NODE_OPTIONS'
]);

function formatEnvValue(value) {
  const text = String(value ?? '');
  return /[\s#"'\\]/.test(text) ? JSON.stringify(text) : text;
}

// Keys the Settings screen doesn't manage (GROQ_API_KEY, FAST_LLM_PRESET,
// ASSEMBLY_AI_STREAM_PARAMS, ...) are kept when the file is rewritten.
function buildEnvironmentFileContent(environment, preserved = {}) {
  const extra = Object.entries(preserved).filter(([key]) => !MANAGED_ENV_KEYS.has(key));
  return [
    ...(extra.length
      ? ['# Your own settings (kept when the app saves this file)', ...extra.map(([key, value]) => `${key}=${formatEnvValue(value)}`), '']
      : []),
    '# Keys entered in the Settings screen are stored in app state, not here.',
    '',
    '# Optional capture behavior',
    '# true = hide this app from screen sharing/screen capture',
    '# false = allow this app to appear in screen sharing/screen capture',
    `HIDE_FROM_SCREEN_CAPTURE=${environment.hideFromScreenCapture}`,
    '',
    '# Optional startup mode',
    '# true = start the window hidden (background mode)',
    '# false = show the window on startup',
    `START_HIDDEN=${environment.startHidden}`,
    '',
    '# Optional screenshot settings',
    `MAX_SCREENSHOTS=${environment.maxScreenshots}`,
    `SCREENSHOT_DELAY=${environment.screenshotDelay}`,
    '',
    '# Optional runtime settings',
    `NODE_ENV=${environment.nodeEnv}`,
    `NODE_OPTIONS=${environment.nodeOptions}`,
    ''
  ].join('\n');
}

function saveApplicationEnvironment(app, values = {}) {
  const envPath = getEnvPath(app);
  const environment = normalizeApplicationEnvironment(values);
  syncProcessEnvironment(environment);
  let preserved = {};
  try {
    preserved = dotenv.parse(fs.readFileSync(envPath, 'utf8'));
  } catch (_) {
    // no existing file
  }
  fs.mkdirSync(path.dirname(envPath), { recursive: true });
  fs.writeFileSync(envPath, buildEnvironmentFileContent(environment, preserved), { encoding: 'utf8', mode: 0o600 });

  return {
    envPath,
    ...environment
  };
}

module.exports = {
  OPTIONAL_ENV_DEFAULTS,
  buildEnvironmentFileContent,
  getEnvPath,
  loadApplicationEnvironment,
  normalizeGeminiApiKeys,
  normalizeApplicationEnvironment,
  saveApplicationEnvironment
};
