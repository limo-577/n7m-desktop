const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..');
const patterns = {
  privateKey: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/g,
  githubToken: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/g,
  awsKey: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  googleKey: /\bAIza[0-9A-Za-z_-]{35}\b/g,
  slackToken: /\bxox[baprs]-[0-9A-Za-z-]{20,}\b/g,
  stripeKey: /\b[rs]k_live_[0-9A-Za-z]{20,}\b/g,
  credentialUrl: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|https?):\/\/[^\s\/@:'"]+:[^\s\/@'"]+@/g,
  webhook: /https:\/\/(?:hooks\.slack\.com\/services\/|(?:discord(?:app)?\.com)\/api\/webhooks\/)[^\s'"]+/g,
  assignedSecret: /\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[:=]\s*['"][^'"\r\n]{8,}['"]/gi
};
const hits = [], files = [];
function inspect(name, buffer) {
  files.push(name);
  const text = buffer.toString('utf8');
  for (const [rule, regex] of Object.entries(patterns)) {
    regex.lastIndex = 0;
    for (const m of text.matchAll(regex)) hits.push({ file: name, rule, line: text.slice(0, m.index).split('\n').length });
  }
}
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'audit-evidence', '.git'].includes(entry.name)) continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (entry.isFile()) inspect(path.relative(root, file), fs.readFileSync(file));
  }
}
walk(root);
if (process.argv[2]) {
  const asar = require('@electron/asar'), archive = path.resolve(process.argv[2]);
  for (const name of asar.listPackage(archive)) {
    if (!/\.(?:js|cjs|mjs|json|html|css|md|txt|yml|yaml|pem|key|env|map)$/i.test(name)) continue;
    inspect('ASAR:' + name, asar.extractFile(archive, name.replace(/^[\\/]+/, '')));
  }
}
fs.writeFileSync(path.join(__dirname, 'secret-scan.json'), JSON.stringify({ scannedFiles: files.length, files, hits, note: 'Pattern scan; matches contain locations only, not secret values. Git history is unavailable.' }, null, 2));
console.log(JSON.stringify({ scannedFiles: files.length, hits }, null, 2));
