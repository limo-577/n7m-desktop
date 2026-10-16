'use strict';
// Explicitly preloaded by the Electron download/build commands only.
// npm overrides cannot replace Node's embedded fetch implementation.
const undici = require('undici');
const version = require('undici/package.json').version;
const [major, minor, patch] = version.split('.').map(Number);
if (major !== 7 || minor < 30 || (minor === 30 && patch < 1)) {
  throw new Error('Build downloads require the reviewed undici 7.x branch, version >= 7.30.1. Run npm ci --ignore-scripts.');
}
undici.install();
