'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm');
const { createHash } = require('node:crypto'), { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
test('build process uses patched fetch for the real Electron downloader and rejects hostile responses', () => {
  const originalFetch = globalThis.fetch;
  const result = require('node:child_process').spawnSync(process.execPath, ['--require', path.join(root, 'scripts/build-fetch.cjs'), path.join(root, 'tests/build-fetch-fixture.cjs')], { encoding: 'utf8', timeout: 10000, windowsHide: true });
  assert.equal(result.status, 0, result.stderr || String(result.error));
  assert.equal(JSON.parse(result.stdout.trim()).malformedResponseRejected, true);
  assert.equal(globalThis.fetch, originalFetch, 'the parent process is unchanged');
});
const html = fs.readFileSync(path.join(root, 'renderer/index.html'), 'utf8');
function declaration(source, name) {
  const start = source.indexOf('function ' + name + '(');
  assert.notEqual(start, -1, name);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}
function renderer() {
  const c = vm.createContext({});
  vm.runInContext(html.slice(html.indexOf('var ANNOTATION_DEFS ='), html.indexOf('async function loadSong(')), c);
  for (const n of ['parseLyrics', 'escapeHtml', 'annAnchorCharId', 'findCharText', 'flattenChars', 'buildExportHtml', 'buildPlayerLyricPackage', 'bindSidebar']) vm.runInContext(declaration(html, n), c);
  return c;
}
function main() {
  const handlers = {}, permission = {}, temp = fs.mkdtempSync(path.join(os.tmpdir(), 'n7m-security-test-'));
  const electron = {
    app: { getPath: () => temp, whenReady: () => ({ then() {} }), on() {} },
    ipcMain: { handle: (n, fn) => { handlers[n] = fn; }, on() {} },
    session: { defaultSession: { setPermissionCheckHandler: fn => { permission.check = fn; }, setPermissionRequestHandler: fn => { permission.request = fn; } } }
  };
  const c = vm.createContext({ require: n => n === 'electron' ? electron : require(n), __dirname: root, process, Buffer, ArrayBuffer, setTimeout, clearTimeout });
  vm.runInContext(fs.readFileSync(path.join(root, 'main.js'), 'utf8'), c);
  const page = pathToFileURL(path.join(root, 'renderer/index.html')).href, frame = {};
  frame.url = page;
  const window = { isDestroyed: () => false, webContents: { mainFrame: frame, getURL: () => page } };
  c.testWindow = window; vm.runInContext('mainWindow = testWindow; configurePermissions();', c);
  return { c, handlers, permission, temp, window, page, frame, event: { sender: window.webContents, senderFrame: frame }, close: () => fs.rmSync(temp, { recursive: true, force: true }) };
}
test('CSP hashes and syntax match all inline scripts', () => {
  for (const name of ['index.html', 'desktop-lyric.html']) {
    const page = fs.readFileSync(path.join(root, 'renderer', name), 'utf8'), csp = page.match(/script-src ([^;]+);/)[1];
    for (const m of page.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      if (/\bsrc\s*=/i.test(m[1])) continue;
      const script = m[2].replace(/\r\n?/g, '\n'); new vm.Script(script);
      assert.ok(csp.includes("'sha256-" + createHash('sha256').update(script).digest('base64') + "'"));
    }
    assert.ok(!csp.includes('unsafe-inline') && !csp.includes('unsafe-eval'));
  }
});
test('malformed backup causes zero writes, even after a valid first song', async () => {
  const c = renderer(), events = new Map(), saves = []; let completion;
  c.document = { getElementById: id => ({ addEventListener: (event, fn) => events.set(id + ':' + event, fn) }) };
  c.createNewSong = c.renderSongList = c.openSong = c.toast = c.saveIndex = () => {};
  c.saveSong = song => saves.push(song);
  c.FileReader = class { readAsText(file) { this.result = file.text; completion = this.onload(); } };
  c.bindSidebar();
  for (const bad of [{ title: {} }, { lines: {} }, { lines: [{ id: 'l', type: 'text', chars: [null] }] }, { annotations: [{ id: 'a', type: 'breath', charIds: 'bad' }] }, { rawLyrics: {} }]) {
    const input = { target: { files: [{ text: JSON.stringify({ songs: [{ id: 'safe', rawLyrics: '歌词' }, { id: 'bad', ...bad }] }) }], value: 'backup.json' } };
    events.get('importFile:change')(input); await completion;
    assert.equal(saves.length, 0); assert.equal(c.state.songIndex.length, 0); assert.equal(Object.keys(c.state.songsCache).length, 0);
  }
});
test('special IDs do not change cache prototypes; inherited annotation types are rejected', () => {
  const c = renderer(), song = c.prepareImportedSongs({ id: '__proto__', rawLyrics: '测试', annotations: [{ type: 'constructor' }, { type: '__proto__' }] })[0];
  c.state.songsCache[song.id] = song;
  assert.equal(Object.getPrototypeOf(c.state.songsCache), null); assert.equal(c.state.songsCache.__proto__, song);
  assert.equal(c.state.songsCache.constructor, undefined); assert.equal(song.annotations.length, 0);
  assert.equal(song.title, '导入的歌曲');
});
test('legacy import compatibility and HTML escaping survive hostile text', () => {
  const c = renderer(), payload = '<img src=x onerror="alert(1)"> & "';
  const song = c.prepareImportedSongs({ id: 's1', title: payload, rawLyrics: payload })[0];
  song.annotations = [{ id: 'a', type: 'high', charIds: [song.lines[0].chars[0].id] }]; c.normalizeSong(song);
  assert.equal(song.annotations[0].type, 'highRight'); assert.equal(song.annotations[0].position, 'inline');
  for (const output of [c.buildExportHtml(song), c.buildPlayerLyricPackage(song).html]) { assert.ok(!output.includes('<img')); assert.ok(output.includes('&lt;')); }
  assert.throws(() => c.prepareImportedSongs([{ id: 'duplicate' }, { id: 'duplicate' }]));
});
test('IPC rejects same-URL subframes and foreign webContents', async () => {
  const m = main(); try {
    assert.equal(m.c.isTrustedSender(m.event, m.window, m.page), true);
    const forged = { sender: m.window.webContents, senderFrame: { url: m.page } };
    assert.equal(m.c.isTrustedSender(forged, m.window, m.page), false);
    assert.equal((await m.handlers['recording:to-mp3'](forged, new ArrayBuffer(44))).ok, false);
    assert.equal(m.c.isTrustedSender({ sender: {}, senderFrame: m.frame }, m.window, m.page), false);
  } finally { m.close(); }
});
test('permission checks and requests allow only main-document audio', () => {
  const m = main(); try {
    const d = { requestingUrl: m.page, isMainFrame: true, mediaType: 'audio', mediaTypes: ['audio'] }, wc = m.window.webContents;
    assert.equal(m.permission.check(wc, 'media', 'file://', d), true);
    for (const p of ['notifications', 'geolocation', 'clipboard-read', 'display-capture', 'usb']) assert.equal(m.permission.check(wc, p, 'file://', d), false);
    for (const extra of [{ mediaType: 'video' }, { isMainFrame: false }, { requestingUrl: 'https://example.invalid/' }]) assert.equal(m.permission.check(wc, 'media', 'file://', { ...d, ...extra }), false);
    for (const types of [[], ['video'], ['audio', 'video'], undefined, ['audio']]) {
      let allowed; m.permission.request(wc, 'media', v => { allowed = v; }, { ...d, mediaTypes: types });
      assert.equal(allowed, !!types && types.length === 1 && types[0] === 'audio');
    }
    assert.equal(m.permission.check({}, 'media', 'file://', d), false);
  } finally { m.close(); }
});
test('folder boundary rejects traversal, junction escape, wrong extension and size', () => {
  const m = main(); try {
    const dir = path.join(m.temp, 'selected'); fs.mkdirSync(dir);
    const file = path.join(dir, 'safe.lrc'), outside = path.join(m.temp, 'outside.lrc');
    fs.writeFileSync(file, '歌词'); fs.writeFileSync(outside, 'private');
    fs.writeFileSync(path.join(m.temp, 'audio-folder.json'), JSON.stringify({ dir }));
    assert.equal(m.c.resolveSelectedFile(file, ['.lrc'], 20), file);
    assert.equal(m.c.resolveSelectedFile(outside, ['.lrc'], 20), null);
    assert.equal(m.c.resolveSelectedFile(file, ['.wav'], 20), null);
    assert.equal(m.c.resolveSelectedFile(file, ['.lrc'], 1), null);
    assert.equal(m.c.resolveSelectedFile(file + '\0', ['.lrc'], 20), null);
    if (process.platform === 'win32') {
      const link = path.join(dir, 'escape'); fs.symlinkSync(m.temp, link, 'junction');
      assert.equal(m.c.resolveSelectedFile(path.join(link, 'outside.lrc'), ['.lrc'], 20), null); fs.unlinkSync(link);
    }
  } finally { m.close(); }
});
test('WAV validator rejects inconsistent header fields', async () => {
  const m = main(); try {
    const w = Buffer.alloc(48); w.write('RIFF'); w.writeUInt32LE(40, 4); w.write('WAVEfmt ', 8);
    w.writeUInt32LE(16, 16); w.writeUInt16LE(1, 20); w.writeUInt16LE(1, 22); w.writeUInt32LE(44100, 24); w.writeUInt32LE(88200, 28);
    w.writeUInt16LE(2, 32); w.writeUInt16LE(16, 34); w.write('data', 36); w.writeUInt32LE(4, 40);
    assert.equal(m.c.isExpectedPcmWav(w), true);
    for (const [offset, value] of [[4, 0], [20, 3], [22, 0], [24, 1], [28, 0], [32, 1], [34, 8], [40, 100]]) { const bad = Buffer.from(w); bad.writeUInt32LE(value, offset); assert.equal(m.c.isExpectedPcmWav(bad), false); }
    assert.equal((await m.handlers['recording:to-mp3'](m.event, new ArrayBuffer(44))).ok, false);
  } finally { m.close(); }
});
test('both sprintf copies retain normal formatting and bound floating precision', () => {
  assert.equal(fs.readFileSync(path.join(root, 'renderer/vendor/sprintf.js'), 'utf8'), fs.readFileSync(path.join(root, 'renderer/vendor/src/sprintf.js'), 'utf8'));
  for (const name of ['sprintf.js', 'src/sprintf.js']) {
    const { sprintf } = require(path.join(root, 'renderer/vendor', name));
    assert.equal(sprintf('%s: %.2f', 'test', 1.25), 'test: 1.25'); assert.equal(sprintf('%04d', 12), '0012');
    for (const fmt of ['%.1000000f', '%.999999999999e', '%.999999999999g', '%.0g']) assert.ok(sprintf(fmt, 1.25).length <= 110);
  }
});
