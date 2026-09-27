/* RED SKIES — shared Playwright setup for the test/*.check.js browser checks.
   Needs `npm install` (the pinned playwright devDependency) and a Chromium that Playwright can launch:
   `npx playwright install chromium`, or point PLAYWRIGHT_CHROMIUM at a Chromium binary.
   The page is dist/weapons_hold.html (node build.js); three.js is bundled, so no CDN is needed.
   Google Fonts requests are blocked (the page must work without them) and their load errors are not counted. */
const fs = require('fs'), path = require('path');
let pw;
try { pw = require('playwright'); } catch (e) {
  try { pw = require('playwright-core'); } catch (e2) { console.error('Playwright not found: run `npm install` first.'); process.exit(1); }
}
const ROOT = path.join(__dirname, '..');
const URL = 'file://' + path.join(ROOT, 'dist', 'weapons_hold.html');
const SHOTS = path.join(__dirname, 'shots');
const FONTS = /fonts\.(googleapis|gstatic)\.com/;
const GL_ARGS = ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'];

// sandbox fallback: a preinstalled Chromium under PLAYWRIGHT_BROWSERS_PATH (e.g. /opt/pw-browsers)
function findChromium() {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!base || !fs.existsSync(base)) return undefined;
  for (const d of fs.readdirSync(base).filter(d => /^chromium-\d+$/.test(d)).sort().reverse()) {
    const exe = path.join(base, d, 'chrome-linux', 'chrome');
    if (fs.existsSync(exe)) return exe;
  }
  return undefined;
}

/** Launch headless Chromium with software WebGL. extraArgs are appended to the Chromium flags. */
async function launch(extraArgs) {
  const opts = { headless: true, args: GL_ARGS.concat(extraArgs || []) };
  if (process.env.PLAYWRIGHT_CHROMIUM) opts.executablePath = process.env.PLAYWRIGHT_CHROMIUM;
  try { return await pw.chromium.launch(opts); } catch (e) {
    const exe = !opts.executablePath && findChromium();
    if (!exe) throw e;
    return pw.chromium.launch(Object.assign(opts, { executablePath: exe }));
  }
}

/** New phone-sized context + page. Returns { ctx, page, errors } — errors collects console errors and page errors. */
async function newPage(browser, ctxOpts) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, ctxOpts || {}));
  const page = await ctx.newPage(), errors = [];
  page.on('console', m => { if (m.type() === 'error' && !FONTS.test((m.location() || {}).url || '')) errors.push('console: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.route(FONTS, r => r.abort());
  return { ctx, page, errors };
}

module.exports = { pw, launch, newPage, URL, ROOT, SHOTS };
