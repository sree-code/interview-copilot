'use strict';

// Bundles the preload script into one file. The assistant window runs with
// sandbox: true, and a sandboxed preload can only require('electron') and a
// few built-ins, not its own helper files. Run automatically by `npm start`
// and `npm run build`.

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
  return outfile;
}

if (require.main === module) {
  console.log(`[bundle-preload] wrote ${path.relative(root, bundlePreload())}`);
}

module.exports = { bundlePreload };
