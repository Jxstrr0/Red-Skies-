#!/usr/bin/env node
/* RED SKIES test runner: runs every test file (a failure never hides the files after it) and exits 1 if any failed.
   node test/run.js            node unit tests  (test/*.test.js)
   node test/run.js --browser  Playwright checks (test/*.check.js; builds first) */
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const browser = process.argv.includes('--browser'), ext = browser ? '.check.js' : '.test.js';
const files = fs.readdirSync(__dirname).filter(f => f.endsWith(ext)).sort();
if (browser) spawnSync(process.execPath, [path.join(__dirname, '..', 'build.js')], { stdio: 'inherit' });
const results = files.map(f => {
  const t0 = Date.now(), r = spawnSync(process.execPath, [path.join(__dirname, f)], { stdio: 'inherit', timeout: browser ? 900e3 : 300e3 });
  return { f, ok: r.status === 0, s: ((Date.now() - t0) / 1000).toFixed(1) };
});
console.log('\n' + results.map(r => `${r.ok ? 'PASS' : 'FAIL'}  ${r.f}  (${r.s} s)`).join('\n'));
const bad = results.filter(r => !r.ok).length;
console.log(bad ? `${bad}/${results.length} test files FAILED` : `all ${results.length} test files passed`);
process.exit(bad ? 1 : 0);
