'use strict';

const {
  lstatSync,
  readdirSync,
  readFileSync
} = require('node:fs');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const VERSION = '8.1.3';
const ROOT = path.resolve(__dirname, '..');
const FFMPEG_DIR = path.join(ROOT, 'resources', 'ffmpeg');
const EXECUTABLE = path.join(FFMPEG_DIR, 'ffmpeg.exe');
const METADATA_FILES = [
  'BUILD_INFO',
  'CONTROL',
  'DEPENDENCIES-MINIMAL.txt',
  'LICENSE.txt',
  'LAME-LICENSE.txt',
  'NOTICE.txt',
  'PROVENANCE.md',
  'vcpkg.spdx.json'
];

function fail(message) {
  throw new Error(message);
}

function assertRegularFile(filePath, name) {
  let info;
  try {
    info = lstatSync(filePath);
  } catch {
    fail(`Required bundled FFmpeg file is missing: ${name}`);
  }
  if (!info.isFile() || info.isSymbolicLink()) {
    fail(`Bundled FFmpeg file is not a regular file: ${name}`);
  }
}

function sha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function run(executable, args) {
  try {
    return execFileSync(executable, args, {
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (error) {
    const details = String(error.stderr || error.message).trim().slice(0, 500);
    fail(`Bundled FFmpeg validation failed: ${details}`);
  }
}

function validate() {
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    fail('The bundled FFmpeg build is supported only on Windows x64.');
  }

  let buildInfo;
  try {
    buildInfo = JSON.parse(readFileSync(path.join(FFMPEG_DIR, 'BUILD_INFO'), 'utf8'));
  } catch {
    fail('FFmpeg build metadata is missing or invalid.');
  }
  if (buildInfo.version !== VERSION || buildInfo.target !== 'x64-windows' ||
      buildInfo.license !== 'LGPL-3.0-or-later') {
    fail('FFmpeg build metadata does not match the approved release configuration.');
  }

  const expectedHashes = buildInfo.runtimeSha256;
  if (!expectedHashes || typeof expectedHashes !== 'object' ||
      !/^[a-f0-9]{64}$/i.test(expectedHashes['ffmpeg.exe'] || '')) {
    fail('FFmpeg runtime checksums are missing from BUILD_INFO.');
  }

  const expectedNames = new Set([...METADATA_FILES, ...Object.keys(expectedHashes)]);
  for (const name of expectedNames) {
    assertRegularFile(path.join(FFMPEG_DIR, name), name);
  }
  const actualNames = new Set(readdirSync(FFMPEG_DIR));
  if (actualNames.size !== expectedNames.size ||
      [...actualNames].some(name => !expectedNames.has(name))) {
    fail('Unexpected files are present in resources/ffmpeg; review the runtime file allowlist.');
  }
  for (const [name, expected] of Object.entries(expectedHashes)) {
    if (!/^[a-f0-9]{64}$/i.test(expected) ||
        sha256(path.join(FFMPEG_DIR, name)) !== expected.toLowerCase()) {
      fail(`Bundled FFmpeg SHA-256 verification failed: ${name}`);
    }
  }

  const version = run(EXECUTABLE, ['-version']);
  if (!version.startsWith(`ffmpeg version ${VERSION} `)) {
    fail(`The bundled executable does not identify as FFmpeg ${VERSION}.`);
  }
  const license = run(EXECUTABLE, ['-L']);
  if (!/GNU Lesser General Public License/i.test(license) ||
      /--enable-(?:gpl|nonfree)\b/.test(version)) {
    fail('FFmpeg license/build flags do not match the approved LGPL configuration.');
  }
  const config = run(EXECUTABLE, ['-buildconf']);
  for (const option of [
    '--disable-network', '--disable-protocols', '--disable-demuxers',
    '--disable-decoders', '--disable-encoders', '--disable-muxers',
    '--disable-filters', '--disable-bsfs', '--disable-parsers',
    '--disable-devices', '--disable-hwaccels', '--enable-protocol=file',
    '--enable-demuxer=wav', '--enable-decoder=pcm_s16le',
    '--enable-encoder=libmp3lame', '--enable-muxer=mp3', '--enable-filter=aresample'
  ]) {
    if (!config.includes(option)) fail(`Required FFmpeg build option is missing: ${option}`);
  }
  if (/--enable-(?:gpl|nonfree)\b/.test(config)) {
    fail('A GPL or nonfree FFmpeg option is enabled.');
  }
  const encoders = run(EXECUTABLE, ['-hide_banner', '-encoders']);
  if (!/\blibmp3lame\b/.test(encoders)) {
    fail('The bundled FFmpeg build does not include the required MP3 encoder.');
  }
  function listComponents(args, predicate) {
    return run(EXECUTABLE, args).split(/\r?\n/).map(line => line.trim().split(/\s+/))
      .filter(parts => parts.length > 1 && predicate(parts[0]) && /^[a-z0-9_]+$/.test(parts[1]))
      .map(parts => parts[1]).sort();
  }
  const components = {
    decoders: listComponents(['-hide_banner', '-decoders'], flags => /^[VAS.][A-Z.]{5}$/.test(flags)),
    demuxers: listComponents(['-hide_banner', '-demuxers'], flags => flags === 'D'),
    encoders: listComponents(['-hide_banner', '-encoders'], flags => /^[VAS.][A-Z.]{5}$/.test(flags)),
    muxers: listComponents(['-hide_banner', '-muxers'], flags => flags === 'E'),
    filters: listComponents(['-hide_banner', '-filters'], flags => /^[T.][S.]$/.test(flags))
  };
  const expected = {
    decoders: ['pcm_s16le'],
    demuxers: ['wav'],
    encoders: ['libmp3lame'],
    muxers: ['mp3'],
    filters: ['aformat', 'abuffer', 'abuffersink', 'anull', 'aresample', 'atrim',
      'buffer', 'buffersink', 'crop', 'format', 'hflip', 'null', 'rotate', 'transpose', 'trim', 'vflip']
  };
  for (const [type, expectedNames] of Object.entries(expected)) {
    const actual = components[type];
    const sortedExpected = [...expectedNames].sort();
    if (actual.length !== sortedExpected.length || actual.some((name, index) => name !== sortedExpected[index])) {
      fail('Unexpected FFmpeg ' + type + ' are enabled: ' + actual.join(', '));
    }
  }
  const protocols = run(EXECUTABLE, ['-hide_banner', '-protocols']);
  if (/^\s+(?!file\s*$)[a-z][a-z0-9+.-]*\s*$/im.test(protocols)) {
    fail('Unexpected FFmpeg network or non-file protocol is enabled.');
  }

  console.log(`Verified local FFmpeg ${VERSION} minimal LGPL runtime.`);
}

try {
  validate();
} catch (error) {
  console.error(`Unable to validate the bundled FFmpeg runtime: ${error.message}`);
  process.exitCode = 1;
}
