'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

// HTML parsing normalizes CRLF before CSP hashes are checked by Chromium.
for (const name of ['index.html', 'desktop-lyric.html']) {
  const file = path.join(__dirname, '..', 'renderer', name);
  const html = fs.readFileSync(file, 'utf8');
  const hashes = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter(match => !/\bsrc\s*=/i.test(match[1]))
    .map(match => "'sha256-" + createHash('sha256').update(match[2].replace(/\r\n?/g, '\n')).digest('base64') + "'");
  const updated = html.replace(/script-src [^;]+;/, "script-src 'self' " + hashes.join(' ') + ';');
  if (html !== updated) fs.writeFileSync(file, updated);
  console.log(`CSP hashes updated: ${name} (${hashes.length} inline scripts)`);
}
