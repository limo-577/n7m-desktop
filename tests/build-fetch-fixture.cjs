'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const undici = require('undici');
assert.equal(globalThis.fetch, undici.fetch);
assert.equal(globalThis.Request, undici.Request);
assert.equal(globalThis.Response, undici.Response);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'n7m-fetch-test-'));
const server = http.createServer((req, res) => {
  if (req.url === '/bad') {
    res.writeHead(200, { 'content-encoding': 'gzip, gzip, gzip, gzip, gzip, gzip', 'content-length': '32' });
    res.flushHeaders();
    res.socket.end();
  } else res.end('known fixture bytes');
});
server.listen(0, '127.0.0.1', async () => {
  try {
    const base = 'http://127.0.0.1:' + server.address().port;
    const downloaderPath = path.join(path.dirname(require.resolve('@electron/get')), 'FetchDownloader.js');
    const { FetchDownloader } = await import(require('node:url').pathToFileURL(downloaderPath).href);
    const output = path.join(temp, 'download.bin');
    await new FetchDownloader().download(base + '/ok', output, { quiet: true });
    assert.equal(fs.readFileSync(output, 'utf8'), 'known fixture bytes');
    await assert.rejects(fetch(base + '/bad'));
    // Allow late stream errors to surface before declaring success.
    await new Promise(resolve => setTimeout(resolve, 75));
    console.log(JSON.stringify({ npmUndici: require('undici/package.json').version, nodeEmbeddedUndici: process.versions.undici, downloaderPassed: true, malformedResponseRejected: true }));
  } catch (error) {
    console.error(error.stack); process.exitCode = 1;
  } finally {
    server.closeAllConnections(); server.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
