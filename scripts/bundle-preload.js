'use strict';

// Bundles the preload script into one file (the assistant window runs with
// sandbox: true, and a sandboxed preload can only require('electron') and a
// few built-ins, not its own helper files), and bundles the React + Astryx
// UI (src/windows/assistant/app) into app.bundle.js / app.bundle.css.
// Run automatically by `npm start` and `npm run build`.

const path = require('path');
const esbuild = require('esbuild');

const root = path.join(__dirname, '..');
const outfile = path.join(root, 'src', 'windows', 'assistant', 'preload.bundle.js');

function bundlePreload() {
  esbuild.buildSync({
    entryPoints: [path.join(root, 'src', 'windows', 'assistant', 'preload.js')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    external: ['electron'],
    logLevel: 'warning'
  });
  bundleApp();
  return outfile;
}

function bundleApp() {
  const dir = path.join(root, 'src', 'windows', 'assistant');
  esbuild.buildSync({
    entryPoints: { 'app.bundle': path.join(dir, 'app', 'main.jsx') },
    outdir: dir,
    bundle: true,
    platform: 'browser',
    format: 'esm',
    target: 'chrome130',
    jsx: 'automatic',
    minify: true,
    sourcemap: false,
    legalComments: 'none',
    define: { 'process.env.NODE_ENV': '"production"' },
    loader: { '.woff': 'file', '.woff2': 'file', '.ttf': 'file', '.svg': 'file', '.png': 'file' },
    assetNames: 'app-assets/[name]-[hash]',
    logLevel: 'warning'
  });
}

if (require.main === module) {
  console.log(`[bundle-preload] wrote ${path.relative(root, bundlePreload())}`);
}

module.exports = { bundlePreload, bundleApp };
