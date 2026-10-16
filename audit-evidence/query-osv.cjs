const fs = require('node:fs');
(async () => {
  const lock = require('../package-lock.json');
  const packages = new Map();
  for (const [location, info] of Object.entries(lock.packages)) {
    if (!location.startsWith('node_modules/') || !info.version) continue;
    const name = info.name || location.split('node_modules/').pop();
    packages.set(name + '@' + info.version, { package: { name, ecosystem: 'npm' }, version: info.version });
  }
  // Local patches require separate source review; query the upstream base explicitly.
  packages.set('sprintf-js@1.1.3 (local base)', { package: { name: 'sprintf-js', ecosystem: 'npm' }, version: '1.1.3' });
  const queries = [...packages.values()], results = [];
  for (let i = 0; i < queries.length; i += 100) {
    const response = await fetch('https://api.osv.dev/v1/querybatch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ queries: queries.slice(i, i + 100) }), signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw Error('OSV HTTP ' + response.status);
    results.push(...(await response.json()).results);
  }
  const report = queries.map((query, i) => ({ ...query, ...results[i] }));
  fs.writeFileSync(__dirname + '/osv-results.json', JSON.stringify({ checkedAt: new Date().toISOString(), report }, null, 2));
  console.log(JSON.stringify({ queries: report.length, matches: report.filter(r => r.vulns?.length) }, null, 2));
})().catch(e => { console.error(e.message); process.exitCode = 1; });
