'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

async function main() {
  const root = path.resolve(__dirname, '..');
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const installerName = `${packageJson.build.productName} Setup ${packageJson.version}.exe`;
  const installerPath = path.join(root, 'dist', installerName);
  const checksumPath = `${installerPath}.sha256`;
  if (!fs.existsSync(installerPath) || !fs.statSync(installerPath).isFile()) {
    throw new Error(`Built installer not found: ${installerPath}`);
  }

  const digest = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(installerPath)) digest.update(chunk);
  const checksum = digest.digest('hex');
  fs.writeFileSync(checksumPath, `${checksum}  ${installerName}\n`, 'utf8');
  console.log(`Wrote installer SHA-256: ${checksum}`);
}

main().catch(error => {
  console.error(`Unable to write installer checksum: ${error.message}`);
  process.exitCode = 1;
});
