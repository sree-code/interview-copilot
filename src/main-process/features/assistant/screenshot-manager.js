const fs = require('fs');
const path = require('path');
const screenshot = require('screenshot-desktop');

// Longest edge sent to the model. Full-resolution PNGs from a 4K/Retina
// screen are several MB of base64; vision models downsample anyway, so this
// mostly saves upload time. Override with SCREENSHOT_MAX_EDGE.
const DEFAULT_MAX_EDGE = 1600;
const JPEG_QUALITY = 82;

function getMaxEdge() {
  const configured = Number(process.env.SCREENSHOT_MAX_EDGE);
  return Number.isFinite(configured) && configured >= 320 ? configured : DEFAULT_MAX_EDGE;
}

// Default encoder: downscale + JPEG via Electron's nativeImage. Falls back to
// the original PNG when nativeImage isn't available (e.g. under plain node).
function defaultEncodeImage(buffer) {
  let nativeImage = null;
  try {
    ({ nativeImage } = require('electron'));
  } catch (_) {
    nativeImage = null;
  }

  if (!nativeImage || typeof nativeImage.createFromBuffer !== 'function') {
    return { data: buffer, mimeType: 'image/png' };
  }

  let image = nativeImage.createFromBuffer(buffer);
  if (image.isEmpty()) {
    return { data: buffer, mimeType: 'image/png' };
  }

  const { width, height } = image.getSize();
  const maxEdge = getMaxEdge();
  const longest = Math.max(width, height);
  if (longest > maxEdge) {
    const scale = maxEdge / longest;
    image = image.resize({
      width: Math.round(width * scale),
      height: Math.round(height * scale),
      quality: 'good'
    });
  }

  // Flat UI / code-editor screens compress far better as PNG (and stay sharp);
  // photo-like screens (video calls) are smaller as JPEG. Keep the smaller.
  const png = image.toPNG();
  const jpeg = image.toJPEG(JPEG_QUALITY);
  return jpeg.length < png.length
    ? { data: jpeg, mimeType: 'image/jpeg' }
    : { data: png, mimeType: 'image/png' };
}

function createScreenshotManager({
  app,
  getMainWindow,
  getAppEnvironment,
  sendToRenderer,
  onScreenshotCaptured = null,
  encodeImage = defaultEncodeImage
}) {
  // path -> { data: base64, mimeType }, so a screenshot is encoded once even
  // when it's sent with several requests.
  const encodedCache = new Map();
  let screenshots = [];
  let screenshotSequence = 0;
  let screenshotInProgress = false;

  function nextScreenshotId() {
    screenshotSequence += 1;
    return `ss-${Date.now()}-${screenshotSequence}`;
  }

  function normalizeScreenshotEntry(entry) {
    if (!entry) return null;

    if (typeof entry === 'string') {
      return {
        id: null,
        path: entry,
        timestamp: null
      };
    }

    if (typeof entry.path === 'string') {
      return {
        id: typeof entry.id === 'string' ? entry.id : null,
        path: entry.path,
        timestamp: typeof entry.timestamp === 'string' ? entry.timestamp : null
      };
    }

    return null;
  }

  function getScreenshotsDir() {
    return app.isPackaged
      ? path.join(app.getPath('userData'), '.stealth_screenshots')
      : path.join(__dirname, '..', '..', '..', '..', '.stealth_screenshots');
  }

  function ensureScreenshotsDir() {
    const screenshotsDir = getScreenshotsDir();
    if (!fs.existsSync(screenshotsDir)) {
      fs.mkdirSync(screenshotsDir, { recursive: true });
    }
    return screenshotsDir;
  }

  function getEncodedImage(filePath) {
    const cached = encodedCache.get(filePath);
    if (cached) {
      return cached;
    }

    const raw = fs.readFileSync(filePath);
    let encoded;
    try {
      encoded = encodeImage(raw);
    } catch (error) {
      console.error('Screenshot encode failed, sending original PNG:', error);
      encoded = { data: raw, mimeType: 'image/png' };
    }

    const part = { data: Buffer.from(encoded.data).toString('base64'), mimeType: encoded.mimeType };
    encodedCache.set(filePath, part);
    return part;
  }

  function cleanupScreenshotFile(entry) {
    const normalizedEntry = normalizeScreenshotEntry(entry);
    if (normalizedEntry) {
      encodedCache.delete(normalizedEntry.path);
    }
    if (normalizedEntry && fs.existsSync(normalizedEntry.path)) {
      fs.unlinkSync(normalizedEntry.path);
    }
  }

  async function takeStealthScreenshot() {
    if (screenshotInProgress) {
      console.log('Screenshot already in progress, skipping');
      return null;
    }

    const mainWindow = getMainWindow();
    const appEnvironment = getAppEnvironment();

    if (!mainWindow || mainWindow.isDestroyed()) {
      throw new Error('Main window not available');
    }

    screenshotInProgress = true;
    try {
      console.log('Taking stealth screenshot...');
      const currentOpacity = mainWindow.getOpacity();
      const screenshotDelay = appEnvironment?.screenshotDelay || 300;

      mainWindow.setOpacity(0.01);
      await new Promise((resolve) => setTimeout(resolve, screenshotDelay));

      const screenshotsDir = ensureScreenshotsDir();
      const screenshotPath = path.join(screenshotsDir, `stealth-${Date.now()}.png`);

      await screenshot({ filename: screenshotPath });

      const screenshotEntry = {
        id: nextScreenshotId(),
        path: screenshotPath,
        timestamp: new Date().toISOString()
      };

      screenshots.push(screenshotEntry);
      if (screenshots.length > appEnvironment.maxScreenshots) {
        cleanupScreenshotFile(screenshots.shift());
      }

      mainWindow.setOpacity(currentOpacity);

      if (typeof onScreenshotCaptured === 'function') {
        try {
          onScreenshotCaptured(screenshotEntry);
        } catch (callbackError) {
          console.error('onScreenshotCaptured failed:', callbackError);
        }
      }

      console.log(`Screenshot saved: ${screenshotPath}`);
      console.log(`Total screenshots: ${screenshots.length}`);

      sendToRenderer('screenshot-taken-stealth', {
        count: screenshots.length,
        screenshotId: screenshotEntry.id,
        timestamp: screenshotEntry.timestamp
      });

      return screenshotPath;
    } catch (error) {
      try {
        mainWindow.setOpacity(1.0);
      } catch (_) {
        // no-op
      }
      console.error('Stealth screenshot error:', error);
      throw error;
    } finally {
      screenshotInProgress = false;
    }
  }

  async function buildImagePartsFromScreenshots({ strict = true, includeIds = null } = {}) {
    const includeIdSet = Array.isArray(includeIds)
      ? new Set(includeIds.filter((id) => typeof id === 'string' && id.trim().length > 0))
      : null;

    const usableEntries = [];

    for (const entry of screenshots) {
      const normalizedEntry = normalizeScreenshotEntry(entry);
      if (!normalizedEntry) continue;

      if (includeIdSet && (!normalizedEntry.id || !includeIdSet.has(normalizedEntry.id))) {
        continue;
      }

      if (fs.existsSync(normalizedEntry.path)) {
        usableEntries.push(normalizedEntry);
        continue;
      }

      console.error(`Screenshot file not found: ${normalizedEntry.path}`);
      if (strict) {
        throw new Error(`Screenshot file not found: ${normalizedEntry.path}`);
      }
    }

    const imageParts = usableEntries.map((entry) => ({
      inlineData: getEncodedImage(entry.path)
    }));

    return {
      imageParts,
      entries: usableEntries
    };
  }

  function clearStealth() {
    screenshots.forEach((entry) => {
      cleanupScreenshotFile(entry);
    });

    screenshots = [];
    screenshotSequence = 0;

    console.log('All screenshots and context cleared');
    return { success: true };
  }

  function cleanupTransientResources() {
    screenshots.forEach((entry) => {
      cleanupScreenshotFile(entry);
    });

    screenshots = [];
    screenshotSequence = 0;
  }

  function getScreenshotsCount() {
    return screenshots.length;
  }

  function hasScreenshots() {
    return screenshots.length > 0;
  }

  return {
    buildImagePartsFromScreenshots,
    cleanupTransientResources,
    clearStealth,
    getScreenshotsCount,
    hasScreenshots,
    takeStealthScreenshot
  };
}

module.exports = {
  createScreenshotManager,
  defaultEncodeImage
};
