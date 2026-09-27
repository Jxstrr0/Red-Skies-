/* RED SKIES — headless browser check (Playwright + preinstalled Chromium).
   node test/browser.check.js   → exits 1 on failure, writes test/shots/*.png */
const fs = require('fs'), path = require('path');
let pw;
try { pw = require('playwright'); } catch (e) {
  try { pw = require('playwright-core'); } catch (e2) { pw = require('/home/claude/.npm-global/lib/node_modules/playwright'); }
}
const { chromium } = pw;

const ROOT = path.join(__dirname, '..');
const URL = 'file://' + path.join(ROOT, 'dist', 'weapons_hold.html');
const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

function findChromium() {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  for (const p of [path.join(base, 'chromium-1194/chrome-linux/chrome'), '/opt/pw-browsers/chromium/chrome-linux/chrome']) if (fs.existsSync(p)) return p;
  return undefined;                                          // let playwright resolve
}

let fails = 0;
const ok = (c, m) => { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fails++; };

(async () => {
  const launch = { headless: true, args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] };
  if (process.env.HTTPS_PROXY) launch.proxy = { server: process.env.HTTPS_PROXY };
  let browser;
  try { browser = await chromium.launch(launch); } catch (e) { launch.executablePath = findChromium(); browser = await chromium.launch(launch); }
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('requestfailed', r => errors.push('requestfailed: ' + r.url() + ' ' + (r.failure() || {}).errorText));

  await page.goto(URL, { waitUntil: 'load' });
  ok(await page.evaluate(() => typeof THREE !== 'undefined' && THREE.REVISION === '128'), 'three.js r128 loaded from cdnjs');
  ok(await page.title() === 'Red Skies', 'title is "Red Skies"');
  await page.screenshot({ path: path.join(SHOTS, '01_boot.png') });

  await page.tap('#start');
  // meta layer: TAP TO START → main menu → CAMPAIGN → shift 1 → briefing → BEGIN
  if (await page.waitForFunction(() => window.RS && RS.meta && RS.meta.screen === 'menu', null, { timeout: 8000 }).then(() => true, () => false)) {
    await page.tap('#m-campaign'); await page.tap('[data-m=pick][data-i="0"]'); await page.tap('#m-begin');
    ok(await page.evaluate(() => RS.sim.state.shift.running && RS.meta.screen === null), 'menu → campaign shift 1 started');
  }
  await page.waitForTimeout(8000);
  ok(errors.length === 0, 'no console/page errors after 8 s' + (errors.length ? '\n    ' + errors.join('\n    ') : ''));
  ok(await page.evaluate(() => RS.main.started && document.getElementById('boot').classList.contains('gone')), 'boot screen dismissed, game started');

  const nTracks = await page.evaluate(() => { for (let i = 0; i < 1200; i++) RS.sim.step(); return RS.sim.state.tracks.length; });
  ok(nTracks >= 1, `tracks after fast-forward: ${nTracks}`);
  await page.waitForTimeout(300);

  const target = await page.evaluate(() => {
    const s = RS.sim.state;
    // pick the track farthest from its neighbours so the tap is unambiguous
    let best = null, bd = -1;
    for (const t of s.tracks) {
      const p = RS.ui.debugTrackScreenPos(t.id); if (!p) continue;
      const d = Math.min(1e9, ...s.tracks.filter(o => o !== t).map(o => { const q = RS.ui.debugTrackScreenPos(o.id); return q ? Math.hypot(q.x - p.x, q.y - p.y) : 1e9; }));
      if (d > bd) { bd = d; best = { id: t.id, p }; }
    }
    return best;
  });
  ok(!!target, 'debugTrackScreenPos returns a position' + (target ? ` (${target.id} @ ${target.p.x.toFixed(0)},${target.p.y.toFixed(0)})` : ''));
  if (target) {
    await page.touchscreen.tap(target.p.x, target.p.y);
    await page.waitForTimeout(200);
    const sel = await page.evaluate(() => RS.sim.state.selectedId);
    ok(sel === target.id, `tap selects track (selectedId=${sel})`);
  }
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(SHOTS, '02_play.png') });

  // radar toggle via thumb zone
  await page.tap('#b-radar');
  ok(await page.evaluate(() => RS.sim.state.radar.on === false), 'RADAR button turns radar off');
  await page.tap('#b-radar');
  ok(await page.evaluate(() => RS.sim.state.radar.on === true), 'RADAR button turns radar on');

  // near-miss tap snaps to the nearest track (30 px off target)
  if (target) {
    await page.evaluate(() => RS.sim.cmd.selectTrack(null));
    await page.touchscreen.tap(target.p.x + 30, target.p.y + 12);
    await page.waitForTimeout(150);
    ok(await page.evaluate(id => RS.sim.state.selectedId === id, target.id), 'near-miss tap snaps to nearest track');
  }
  // drag: finger moves from one track to another → selection follows
  const pair = await page.evaluate(() => {
    const ps = RS.sim.state.tracks.map(t => ({ id: t.id, p: RS.ui.debugTrackScreenPos(t.id) })).filter(o => o.p && !o.p.out);
    for (const a of ps) for (const b of ps) if (a !== b && Math.hypot(a.p.x - b.p.x, a.p.y - b.p.y) > 60) return [a, b];
    return null;
  });
  if (pair) {
    const cdp = await page.context().newCDPSession(page);
    const pt = (x, y) => [{ x, y, id: 1 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(pair[0].p.x, pair[0].p.y) });
    for (let i = 1; i <= 10; i++) {
      const x = pair[0].p.x + (pair[1].p.x - pair[0].p.x) * i / 10, y = pair[0].p.y + (pair[1].p.y - pair[0].p.y) * i / 10;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(x, y) });
      await page.waitForTimeout(20);
    }
    await page.screenshot({ path: path.join(SHOTS, '02c_drag.png') });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    ok(await page.evaluate(id => RS.sim.state.selectedId === id, pair[1].id), `drag moves selection ${pair[0].id} -> ${pair[1].id}`);
  } else console.log('  INFO drag test skipped (need two separated tracks)');
  // zoom cycles 60 → 30 → 15 → 60
  const zs = [];
  for (let i = 0; i < 3; i++) { await page.tap('#b-zoom'); zs.push(await page.evaluate(() => RS.ui.zoomKm)); }
  ok(zs.join() === '30,15,60', `zoom cycles (${zs.join()})`);
  // sloppy one-finger taps (finger slides ~10 px) on zoom + RADAR must register exactly once each
  {
    const cdp2 = await page.context().newCDPSession(page);
    const sloppy = async sel => {
      const r = await page.evaluate(q => { const b = document.querySelector(q).getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }, sel);
      await cdp2.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: r.x, y: r.y, id: 7 }] });
      await cdp2.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: r.x + 6, y: r.y + 8, id: 7 }] });
      await cdp2.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForTimeout(120);
    };
    const z0 = await page.evaluate(() => RS.ui.zoomKm);
    await sloppy('#b-zoom');
    const z1 = await page.evaluate(() => RS.ui.zoomKm);
    ok(z1 !== z0 && [60, 30, 15].indexOf(z1) === ([60, 30, 15].indexOf(z0) + 1) % 3, `sloppy tap on ZOOM registers once (${z0} -> ${z1})`);
    for (let i = 0; i < 2; i++) await sloppy('#b-zoom');   // back to where it was
    const r0 = await page.evaluate(() => RS.sim.state.radar.on);
    await sloppy('#b-radar');
    ok(await page.evaluate(v => RS.sim.state.radar.on === !v, r0), 'sloppy tap on RADAR registers once');
    await sloppy('#b-radar');
    ok(await page.evaluate(v => RS.sim.state.radar.on === v, r0), 'second sloppy tap toggles back');
  }
  await page.tap('#b-zoom'); await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(SHOTS, '02d_zoom30.png') });
  await page.tap('#b-zoom'); await page.tap('#b-zoom');

  // tabs: one active at a time, scope stays visible
  await page.tap('#tab-track');
  await page.waitForTimeout(250);
  ok(await page.evaluate(() => RS.ui.expanded === 'track' && document.querySelectorAll('#tabbody .pbody.active').length === 1), 'track tab active (one at a time)');
  await page.screenshot({ path: path.join(SHOTS, '02b_track_panel.png') });
  await page.tap('#tab-battery'); await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(SHOTS, '02e_battery.png') });
  await page.tap('#tab-comms');
  await page.waitForTimeout(400);
  ok(await page.evaluate(() => RS.ui.expanded === 'comms' && document.getElementById('scope').getBoundingClientRect().height > 200), 'comms tab active, scope still visible');
  await page.screenshot({ path: path.join(SHOTS, '03_scope_expanded.png') });
  const warnLines = await page.evaluate(() => [...document.querySelectorAll('#body-comms li')].filter(l => /EMISSION/.test(l.textContent)).length);
  ok(warnLines <= 2, `emission warnings throttled in log (${warnLines})`);

  const layout = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
    hatchH: document.getElementById('hatch').getBoundingClientRect().height,
    tzBottom: document.getElementById('thumbzone').getBoundingClientRect().bottom,
    minBtn: Math.min(...[...document.querySelectorAll('#thumbzone button, .tab, #b-zoom')].map(b => Math.min(b.getBoundingClientRect().height, b.getBoundingClientRect().width)))
  }));
  ok(layout.sw <= layout.cw, `no horizontal scroll (${layout.sw} <= ${layout.cw})`);
  ok(Math.abs(layout.hatchH / 844 - 0.35) < 0.02, `hatch ~35% height (${layout.hatchH}px)`);
  ok(layout.tzBottom <= 844.5, `thumb zone on screen (bottom ${layout.tzBottom})`);
  ok(layout.minBtn >= 44, `tap targets >= 44px (min ${layout.minBtn.toFixed(0)})`);

  // fps sample
  const fps = await page.evaluate(() => new Promise(res => {
    let n = 0; const t0 = performance.now();
    const f = () => { n++; if (performance.now() - t0 < 5000) requestAnimationFrame(f); else res(n / ((performance.now() - t0) / 1000)); };
    requestAnimationFrame(f);
  }));
  console.log(`  INFO average fps over 5 s (headless, swiftshader): ${fps.toFixed(1)}`);

  // ---- real-sim combat integration: IFF, classify, assign, fire, outcome ----
  const combat = await page.evaluate(() => {
    const ev = {}; ['IFF_RESULT','CLASSIFIED','ASSIGNED','LAUNCH','GUN_FIRE','INTERCEPT','KILL','MISS','FIRE_REJECTED','LOCK','ARM_INBOUND','JAMMING','ASSET_HIT','ROE_CHANGE','FRATRICIDE']
      .forEach(n => RS.bus.on(n, () => { ev[n] = (ev[n] || 0) + 1; }));
    const step = n => { for (let i = 0; i < n; i++) RS.sim.step(); };
    const HOST = ['jet_hostile', 'helo_hostile', 'cruise_missile', 'drone', 'arm_missile'];
    const s = RS.sim.state; let fired = null, shots = 0;
    for (let k = 0; k < 60 && shots < 6; k++) {                // up to 5 more minutes, 5 s chunks
      step(100);
      for (const t of s.tracks) {
        if (!HOST.includes(RS.sim.debugTruth(t.id)) || t.engagedBy.length) continue;
        if (t.cls !== 'HOSTILE') RS.sim.cmd.classify(t.id, 'HOSTILE');
        const l = RS.sim.query.bestLauncher(t.id); if (!l) continue;
        RS.sim.cmd.assign(t.id, l);
        if (RS.sim.cmd.fire(t.id)) { fired = fired || (t.id + '@' + l); shots++; }
      }
    }
    step(20 * 30);
    return { fired, shots, ev, running: s.shift.running, hp: +s.asset.hp.toFixed(2), reserve: s.battery.reserve, stats: s.stats };
  });
  console.log('  INFO combat', JSON.stringify(combat));
  ok(!!combat.fired, 'real sim: a HOSTILE-classified track can be engaged (' + combat.fired + ')');
  ok((combat.ev.LAUNCH || 0) + (combat.ev.GUN_FIRE || 0) >= 1, 'real sim: LAUNCH/GUN_FIRE emitted');
  ok((combat.ev.KILL || 0) + (combat.ev.MISS || 0) >= 1, 'real sim: engagement resolved (KILL/MISS)');
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(SHOTS, '05_combat.png') });

  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(400);
  ok(await page.evaluate(() => getComputedStyle(document.getElementById('rotate')).display !== 'none'), 'rotate overlay shown in landscape');
  await page.screenshot({ path: path.join(SHOTS, '04_landscape.png') });

  ok(errors.length === 0, 'no errors at end' + (errors.length ? '\n    ' + errors.join('\n    ') : ''));
  await browser.close();
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
