'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const root = path.resolve(process.env.N7M_APP_ROOT || path.join(__dirname, '..', '..'));
const cache = path.join(root, 'node_modules', '.cache');
const vcpkg = path.resolve(process.env.N7M_VCPKG_ROOT || path.join(cache, 'vcpkg-2026.06.01'));
const packageRoot = path.join(vcpkg, 'packages', 'ffmpeg_x64-windows');
const installRoot = path.resolve(process.env.N7M_VCPKG_INSTALLED_TRIPLET ||
  path.join(cache, 'ffmpeg-minimal-installed', 'x64-windows'));
const output = path.join(root, 'resources', 'ffmpeg');
const sourceRoot = path.join(vcpkg, 'buildtrees');
const ffmpegSourceRoot = path.join(sourceRoot, 'ffmpeg', 'src');
const lameSourceRoot = path.join(sourceRoot, 'mp3lame', 'src');
const portsRoot = path.resolve(process.env.N7M_FFMPEG_PORTS_ROOT || path.join(__dirname, 'ports'));

const runtimeNames = [
  'ffmpeg.exe',
  'avcodec-62.dll',
  'avfilter-11.dll',
  'avformat-62.dll',
  'avutil-60.dll',
  'swresample-6.dll',
  'libmp3lame.dll'
];
const filters = [
  'aformat', 'anull', 'aresample', 'atrim', 'crop', 'format',
  'hflip', 'null', 'rotate', 'transpose', 'trim', 'vflip',
  'abuffer', 'buffer', 'abuffersink', 'buffersink'
];

function requireFile(filePath) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error(`Required build input is missing: ${filePath}`);
  }
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function sha512(filePath) {
  return crypto.createHash('sha512').update(fs.readFileSync(filePath)).digest('hex');
}

function findSourceDirectory(parent, pattern, requiredFile) {
  const matches = fs.readdirSync(parent, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && pattern.test(entry.name))
    .map(entry => path.join(parent, entry.name))
    .filter(directory => fs.existsSync(path.join(directory, requiredFile)));
  if (matches.length !== 1) {
    throw new Error(`Expected one source directory containing ${requiredFile}; found ${matches.length}`);
  }
  return matches[0];
}

function run(executable, args) {
  return execFileSync(executable, args, {
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 4 * 1024 * 1024
  });
}

function tableNames(text, pattern) {
  return [...new Set([...text.matchAll(pattern)].map(match => match[1]))].sort();
}

function assertExact(actual, expected, label) {
  const normalizedExpected = [...expected].sort();
  if (actual.length !== normalizedExpected.length || actual.some((item, i) => item !== normalizedExpected[i])) {
    throw new Error(`${label} mismatch: expected [${normalizedExpected.join(', ')}], got [${actual.join(', ')}]`);
  }
}

function main() {
  for (const file of [
    path.join(packageRoot, 'bin', 'ffmpeg.exe'),
    ...runtimeNames.slice(1, 6).map(name => path.join(packageRoot, 'bin', name)),
    path.join(installRoot, 'bin', 'libmp3lame.dll'),
    path.join(vcpkg, 'downloads', 'ffmpeg-ffmpeg-n8.1.3.tar.gz'),
    path.join(vcpkg, 'downloads', 'lame-3.100.tar.gz'),
    path.join(portsRoot, 'ffmpeg', 'portfile.cmake'),
    path.join(portsRoot, 'mp3lame', 'portfile.cmake')
  ]) requireFile(file);

  const ffmpegSource = findSourceDirectory(ffmpegSourceRoot, /^n8\.1\.3-.+\.clean$/, 'COPYING.LGPLv3');
  const lameSource = findSourceDirectory(lameSourceRoot, /^.+\.clean$/, 'COPYING');
  const ffmpegExe = path.join(packageRoot, 'bin', 'ffmpeg.exe');
  const envPath = [
    path.join(packageRoot, 'bin'),
    path.join(installRoot, 'bin'),
    process.env.PATH
  ].join(path.delimiter);
  process.env.PATH = envPath;
  const versionOutput = run(ffmpegExe, ['-version']);
  const licenseOutput = run(ffmpegExe, ['-L']);
  const configOutput = run(ffmpegExe, ['-buildconf']);
  if (!/^ffmpeg version 8\.1\.3\b/m.test(versionOutput)) throw new Error('Expected FFmpeg 8.1.3.');
  if (!/GNU Lesser General Public License[\s\S]*?either version 3 of the License[\s\S]*?any later version/i.test(licenseOutput)) {
    throw new Error('FFmpeg did not report LGPL version 3 or later.');
  }
  if (/--enable-(?:gpl|nonfree)\b/.test(configOutput)) throw new Error('GPL/nonfree build option is enabled.');
  for (const option of [
    '--disable-network', '--disable-protocols', '--disable-demuxers', '--disable-decoders',
    '--disable-encoders', '--disable-muxers', '--disable-parsers', '--disable-bsfs',
    '--disable-devices', '--disable-hwaccels', '--enable-protocol=file',
    '--enable-demuxer=wav', '--enable-decoder=pcm_s16le', '--enable-muxer=mp3',
    '--enable-encoder=libmp3lame'
  ]) {
    if (!configOutput.includes(option)) throw new Error(`FFmpeg build option missing: ${option}`);
  }

  const executable = path.join(packageRoot, 'bin', 'ffmpeg.exe');
  const featureTables = {
    decoders: tableNames(run(executable, ['-hide_banner', '-decoders']), /^\s*[VAS.][A-Z.]{5}\s+([a-z0-9_]+)\s/mg),
    demuxers: tableNames(run(executable, ['-hide_banner', '-demuxers']), /^\s+D\s+([a-z0-9_]+)\s/mg),
    encoders: tableNames(run(executable, ['-hide_banner', '-encoders']), /^\s*[VAS.][A-Z.]{5}\s+([a-z0-9_]+)\s/mg),
    muxers: tableNames(run(executable, ['-hide_banner', '-muxers']), /^\s+E\s+([a-z0-9_]+)\s/mg),
    protocols: tableNames(run(executable, ['-hide_banner', '-protocols']), /^\s+(file)\s*$/mg),
    filters: tableNames(run(executable, ['-hide_banner', '-filters']), /^\s*[T.][S.]\s+([a-z0-9_]+)\s/mg)
  };
  assertExact(featureTables.decoders, ['pcm_s16le'], 'FFmpeg decoders');
  assertExact(featureTables.demuxers, ['wav'], 'FFmpeg demuxers');
  assertExact(featureTables.encoders, ['libmp3lame'], 'FFmpeg encoders');
  assertExact(featureTables.muxers, ['mp3'], 'FFmpeg muxers');
  assertExact(featureTables.protocols, ['file'], 'FFmpeg protocols');
  assertExact(featureTables.filters, filters, 'FFmpeg filters');

  fs.mkdirSync(output, { recursive: true });
  const keep = new Set([...runtimeNames, 'BUILD_INFO', 'CONTROL', 'DEPENDENCIES-MINIMAL.txt',
    'LICENSE.txt', 'LAME-LICENSE.txt', 'NOTICE.txt', 'PROVENANCE.md', 'vcpkg.spdx.json']);
  for (const entry of fs.readdirSync(output, { withFileTypes: true })) {
    const target = path.join(output, entry.name);
    if (entry.isDirectory()) throw new Error(`Unexpected directory in FFmpeg runtime: ${entry.name}`);
    if (!keep.has(entry.name) || entry.name.endsWith('.dll')) fs.rmSync(target);
  }

  for (const name of runtimeNames.slice(0, 6)) {
    fs.copyFileSync(path.join(packageRoot, 'bin', name), path.join(output, name));
  }
  fs.copyFileSync(path.join(installRoot, 'bin', 'libmp3lame.dll'), path.join(output, 'libmp3lame.dll'));
  fs.copyFileSync(path.join(ffmpegSource, 'COPYING.LGPLv3'), path.join(output, 'LICENSE.txt'));
  fs.copyFileSync(path.join(lameSource, 'COPYING'), path.join(output, 'LAME-LICENSE.txt'));

  const vcpkgCommit = run('git', ['-C', vcpkg, 'rev-parse', 'HEAD']).trim();
  const vcpkgVersion = run(path.join(vcpkg, 'vcpkg.exe'), ['version']).split(/\r?\n/, 1)[0].trim();
  const ffmpegArchive = path.join(vcpkg, 'downloads', 'ffmpeg-ffmpeg-n8.1.3.tar.gz');
  const lameArchive = path.join(vcpkg, 'downloads', 'lame-3.100.tar.gz');
  const runtimeSha256 = Object.fromEntries(runtimeNames.map(name => [name, sha256(path.join(output, name))]));
  const configOptions = [...configOutput.matchAll(/(?:^|\s)(--[a-z0-9][a-z0-9-]*(?:=[^\s']+)?)/g)]
    .map(match => match[1]);
  const buildInfo = {
    schemaVersion: 1,
    version: '8.1.3',
    target: 'x64-windows',
    license: 'LGPL-3.0-or-later',
    componentLicenses: { ffmpeg: 'LGPL-3.0-or-later', lame: 'LGPL-2.0-only' },
    ports: { ffmpeg: '8.1.3#3', mp3lame: '3.100#17' },
    sourceArchives: {
      ffmpeg: { name: 'ffmpeg-ffmpeg-n8.1.3.tar.gz', sha512: sha512(ffmpegArchive) },
      lame: { name: 'lame-3.100.tar.gz', sha512: sha512(lameArchive) }
    },
    vcpkg: { repositoryCommit: vcpkgCommit, executableVersion: vcpkgVersion, mode: 'classic' },
    compiler: { msvc: '19.44.35222', windowsSdk: '10.0.26100.0', crt: 'dynamic (/MD)' },
    libraries: ['avcodec-62.dll', 'avfilter-11.dll', 'avformat-62.dll', 'avutil-60.dll',
      'swresample-6.dll', 'libmp3lame.dll'],
    decoders: featureTables.decoders,
    demuxers: featureTables.demuxers,
    encoders: featureTables.encoders,
    muxers: featureTables.muxers,
    protocols: featureTables.protocols,
    filters: featureTables.filters,
    networkEnabled: false,
    gplOrNonfreeEnabled: false,
    configuration: configOptions,
    runtimeSha256,
    sourceBundle: 'ffmpeg-8.1.3-wav-pcm-mp3-source-x64-windows-lgpl.zip',
    stagedAt: new Date().toISOString()
  };
  fs.writeFileSync(path.join(output, 'BUILD_INFO'), `${JSON.stringify(buildInfo, null, 2)}\n`);

  fs.writeFileSync(path.join(output, 'CONTROL'), [
    'Package: ffmpeg',
    'Version: 8.1.3',
    'Port-Version: 3',
    'Architecture: x64-windows',
    'License: LGPL-3.0-or-later',
    'Depends: mp3lame 3.100#17',
    'Feature: wav-mp3',
    'Description: FFmpeg CLI limited to WAV/PCM S16LE input and MP3/LAME output',
    ''
  ].join('\n'));
  fs.writeFileSync(path.join(output, 'DEPENDENCIES-MINIMAL.txt'), [
    'Runtime dependency inventory for FFmpeg 8.1.3 WAV/PCM to MP3 (Windows x64)',
    '',
    'Direct runtime components:',
    '  FFmpeg 8.1.3 (vcpkg port 8.1.3#3), LGPL-3.0-or-later',
    '  LAME 3.100 (vcpkg port 3.100#17), LGPL-2.0-only; dynamically linked as libmp3lame.dll',
    '',
    'FFmpeg shared libraries shipped:',
    ...buildInfo.libraries.map(name => `  ${name}`),
    '',
    'Enabled media components:',
    `  Protocols: ${featureTables.protocols.join(', ')}`,
    `  Demuxers: ${featureTables.demuxers.join(', ')}`,
    `  Decoders: ${featureTables.decoders.join(', ')}`,
    `  Encoders: ${featureTables.encoders.join(', ')}`,
    `  Muxers: ${featureTables.muxers.join(', ')}`,
    `  Filters: ${featureTables.filters.join(', ')}`,
    '  Parsers, bitstream filters, devices, hardware accelerators, network support, ffplay and ffprobe: disabled',
    '',
    'Build-only tools (not shipped in the application): vcpkg, CMake 4.3.2, Ninja 1.13.2,',
    'MSYS2 make 4.4.1, pkgconf 2.5.1, NASM 3.01, Microsoft C/C++ 19.44.35222, Windows SDK 10.0.26100.0.',
    ''
  ].join('\n'));
  fs.writeFileSync(path.join(output, 'NOTICE.txt'), [
    'This application bundles a locally built, dynamically linked FFmpeg 8.1.3 runtime.',
    'It is limited to local WAV / PCM S16LE input and MP3 output through LAME.',
    'FFmpeg is licensed under LGPL-3.0-or-later; LAME is licensed under LGPL-2.0-only.',
    'The corresponding source archive, exact overlay recipes, patches, and build notes are named in BUILD_INFO.',
    'The FFmpeg and LAME DLLs are shipped next to ffmpeg.exe so a recipient can replace them with compatible builds.',
    'See LICENSE.txt and LAME-LICENSE.txt for the complete license texts.',
    ''
  ].join('\n'));
  fs.writeFileSync(path.join(output, 'PROVENANCE.md'), [
    '# Minimal FFmpeg build provenance',
    '',
    '- Built locally from upstream FFmpeg tag `n8.1.3` using the pinned vcpkg source overlay; this is not a third-party prebuilt binary.',
    `- FFmpeg source archive SHA-512: ${buildInfo.sourceArchives.ffmpeg.sha512}.`,
    `- LAME source archive SHA-512: ${buildInfo.sourceArchives.lame.sha512}.`,
    `- vcpkg port repository commit: ${vcpkgCommit}; executable: ${vcpkgVersion}; classic mode.`,
    '- FFmpeg overlay revision: `8.1.3#3`; LAME: `3.100#17`; triplet: `x64-windows`.',
    '- Compiler: MSVC 19.44.35222; Windows SDK 10.0.26100.0; dynamic MSVC runtime `/MD`.',
    '- Build configuration and enabled components are recorded in `BUILD_INFO` and `DEPENDENCIES-MINIMAL.txt`.',
    '- Runtime file SHA-256 hashes are recorded in `BUILD_INFO`; `scripts/ensure-ffmpeg.js` verifies them before packaging.',
    '- The corresponding source bundle includes the exact FFmpeg/LAME source archives, recipes, patches, licenses, and build instructions.',
    ''
  ].join('\n'));

  const fileNames = runtimeNames;
  const packages = [
    {
      name: 'FFmpeg', versionInfo: '8.1.3', SPDXID: 'SPDXRef-Package-FFmpeg',
      downloadLocation: 'https://ffmpeg.org/releases/ffmpeg-8.1.3.tar.xz',
      filesAnalyzed: false, licenseConcluded: 'LGPL-3.0-or-later',
      licenseDeclared: 'LGPL-3.0-or-later', copyrightText: 'NOASSERTION',
      packageHomePage: 'https://ffmpeg.org',
      packageFileName: 'ffmpeg.exe and FFmpeg shared libraries',
      sourceInfo: `GitHub tag archive SHA-512 ${buildInfo.sourceArchives.ffmpeg.sha512}; vcpkg overlay 8.1.3#3.`,
      externalRefs: [{ referenceCategory: 'PACKAGE-MANAGER', referenceType: 'purl', referenceLocator: 'pkg:vcpkg/ffmpeg@8.1.3' }]
    },
    {
      name: 'LAME', versionInfo: '3.100', SPDXID: 'SPDXRef-Package-LAME',
      downloadLocation: 'https://downloads.sourceforge.net/project/lame/lame/3.100/lame-3.100.tar.gz',
      filesAnalyzed: false, licenseConcluded: 'LGPL-2.0-only',
      licenseDeclared: 'LGPL-2.0-only', copyrightText: 'NOASSERTION',
      packageHomePage: 'https://lame.sourceforge.io',
      packageFileName: 'libmp3lame.dll',
      sourceInfo: `Source archive SHA-512 ${buildInfo.sourceArchives.lame.sha512}; vcpkg overlay 3.100#17.`,
      externalRefs: [{ referenceCategory: 'PACKAGE-MANAGER', referenceType: 'purl', referenceLocator: 'pkg:vcpkg/mp3lame@3.100' }]
    }
  ];
  const spdx = {
    spdxVersion: 'SPDX-2.3',
    dataLicense: 'CC0-1.0',
    SPDXID: 'SPDXRef-DOCUMENT',
    name: 'n7m-desktop-minimal-ffmpeg-runtime-8.1.3',
    documentNamespace: `https://spdx.org/spdxdocs/n7m-ffmpeg-8.1.3-${crypto.randomUUID()}`,
    creationInfo: {
      creators: ['Tool: n7m-desktop-ffmpeg-runtime-stager'],
      created: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
    },
    packages,
    files: fileNames.map((name, index) => ({
      fileName: `./${name}`,
      SPDXID: `SPDXRef-File-${index + 1}`,
      checksums: [{ algorithm: 'SHA256', checksumValue: runtimeSha256[name] }],
      licenseConcluded: name === 'libmp3lame.dll' ? 'LGPL-2.0-only' : 'LGPL-3.0-or-later',
      licenseInfoInFiles: [name === 'libmp3lame.dll' ? 'LGPL-2.0-only' : 'LGPL-3.0-or-later'],
      copyrightText: 'NOASSERTION',
      fileTypes: ['BINARY']
    })),
    relationships: [
      { spdxElementId: 'SPDXRef-DOCUMENT', relationshipType: 'DESCRIBES', relatedSpdxElement: 'SPDXRef-Package-FFmpeg' },
      { spdxElementId: 'SPDXRef-Package-FFmpeg', relationshipType: 'DEPENDS_ON', relatedSpdxElement: 'SPDXRef-Package-LAME' },
      ...fileNames.map((name, index) => ({
        spdxElementId: name === 'libmp3lame.dll' ? 'SPDXRef-Package-LAME' : 'SPDXRef-Package-FFmpeg',
        relationshipType: 'CONTAINS', relatedSpdxElement: `SPDXRef-File-${index + 1}`
      }))
    ]
  };
  fs.writeFileSync(path.join(output, 'vcpkg.spdx.json'), `${JSON.stringify(spdx, null, 2)}\n`);

  const actual = fs.readdirSync(output).sort();
  const expected = [...keep].sort();
  assertExact(actual, expected, 'Staged FFmpeg runtime files');
  console.log(`Staged verified FFmpeg ${buildInfo.version} minimal LGPL runtime (${runtimeNames.length} binaries).`);
}

try {
  main();
} catch (error) {
  console.error(`Unable to stage minimal FFmpeg runtime: ${error.message}`);
  process.exitCode = 1;
}
