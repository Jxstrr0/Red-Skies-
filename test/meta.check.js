/* RED SKIES — meta layer browser check (Playwright + preinstalled Chromium).
   node test/meta.check.js   → exits 1 on failure, writes test/shots/meta_*.png */
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
  return undefined;
}
let fails = 0;
const ok = (c, m) => { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fails++; };
const shot = (page, n) => page.screenshot({ path: path.join(SHOTS, 'meta_' + n + '.png') });
const W = ms => new Promise(r => setTimeout(r, ms));

async function newPage(browser, vp, blockStorage) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, isMobile: true, hasTouch: true, ignoreHTTPSErrors: true });
  if (blockStorage) await ctx.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('blocked', 'SecurityError'); } });
  });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('console', m => { if (m.type() === 'error') page.errors.push('console: ' + m.text()); });
  page.on('pageerror', e => page.errors.push('pageerror: ' + e.message));
  page.on('requestfailed', r => page.errors.push('requestfailed: ' + r.url()));
  return { ctx, page };
}
async function boot(page) {
  await page.goto(URL, { waitUntil: 'load' });
  await page.tap('#start');
  await page.waitForFunction(() => window.RS && RS.meta && RS.meta.screen === 'menu', null, { timeout: 15000 });
}
const screenIs = (page, s) => page.waitForFunction(x => RS.meta.screen === x, s, { timeout: 5000 }).then(() => true, () => false);

/** no horizontal scroll + every visible control in the meta overlay/pause ≥ 44 px */
async function layout(page, label) {
  const r = await page.evaluate(() => {
    const de = document.documentElement, m = document.getElementById('meta');
    const els = [...document.querySelectorAll('#meta button, #meta input, #m-pause')].filter(e => e.offsetParent !== null || getComputedStyle(e).position === 'fixed');
    const small = els.map(e => { const b = e.getBoundingClientRect(); return { id: e.id || e.dataset.m || e.tagName, w: b.width, h: b.height }; })
      .filter(b => b.w > 0 && (b.w < 44 || b.h < 44));
    const wide = [...document.querySelectorAll('#meta *')].filter(e => e.getBoundingClientRect().right > de.clientWidth + 0.5).map(e => e.className || e.tagName).slice(0, 3);
    return { sw: de.scrollWidth, cw: de.clientWidth, msw: m ? m.scrollWidth : 0, mcw: m ? m.clientWidth : 0, small, wide };
  });
  ok(r.sw <= r.cw && r.msw <= r.mcw && !r.wide.length, `${label}: no horizontal scroll (${r.sw}/${r.cw}, meta ${r.msw}/${r.mcw}${r.wide.length ? ' overflow: ' + r.wide : ''})`);
  ok(!r.small.length, `${label}: tap targets >= 44px` + (r.small.length ? ' ' + JSON.stringify(r.small.slice(0, 4)) : ''));
}

/** auto-play: engage true hostiles for `secs` of sim time, then end the shift as complete */
const autoPlay = (page, secs) => page.evaluate(secs => {
  const HOST = ['jet_hostile', 'helo_hostile', 'cruise_missile', 'drone', 'arm_missile'], s = RS.sim.state;
  for (let k = 0; k < secs / 2 && s.shift.running; k++) {
    for (let i = 0; i < 40 && s.shift.running; i++) RS.sim.step();
    for (const t of s.tracks) {
      if (!HOST.includes(RS.sim.debugTruth(t.id)) || t.engagedBy.length) continue;
      if (t.cls !== 'HOSTILE') RS.sim.cmd.classify(t.id, 'HOSTILE');
      const l = RS.sim.query.bestLauncher(t.id); if (!l) continue;
      RS.sim.cmd.assign(t.id, l); RS.sim.cmd.fire(t.id);
    }
  }
  if (s.shift.running) RS.sim.endShift('complete');
  return { hp: s.asset.hp, stats: s.stats };
}, secs);

(async () => {
  const launch = { headless: true, args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] };
  if (process.env.HTTPS_PROXY) launch.proxy = { server: process.env.HTTPS_PROXY };
  let browser;
  try { browser = await chromium.launch(launch); } catch (e) { launch.executablePath = findChromium(); browser = await chromium.launch(launch); }

  /* ================= 390×844 full flow ================= */
  console.log('-- 390x844 campaign flow');
  let { ctx, page } = await newPage(browser, { width: 390, height: 844 });
  await boot(page);
  ok(await page.evaluate(() => !RS.sim.state.shift.running && document.getElementById('boot').classList.contains('gone')), 'TAP TO START → main menu, no shift auto-started');
  await layout(page, 'menu'); await shot(page, '01_menu');

  await page.tap('#m-campaign');
  ok(await screenIs(page, 'map'), 'campaign map');
  ok(await page.evaluate(() => document.querySelector('[data-m=pick][data-i="1"]').disabled && !document.querySelector('[data-m=pick][data-i="0"]').disabled), 'only shift 1 unlocked on a fresh save');
  await layout(page, 'map'); await shot(page, '02_map');

  await page.tap('[data-m=pick][data-i="0"]');
  ok(await screenIs(page, 'briefing'), 'briefing card');
  const bt = await page.evaluate(() => document.getElementById('meta').innerText);
  ok(/First Watch/.test(bt) && /EXPECTED THREATS/.test(bt) && /strike fighter/.test(bt) && /RULES OF ENGAGEMENT/.test(bt) && /TIGHT/.test(bt) && /RESERVE/.test(bt), 'briefing shows name, threats, ROE, reserve');
  await layout(page, 'briefing'); await shot(page, '03_briefing');

  await page.tap('#m-begin');
  await W(1200);
  ok(await page.evaluate(() => RS.meta.screen === null && RS.sim.state.shift.running && RS.sim.state.shift.id === 'C1'), 'BEGIN starts campaign shift 1 (C1)');
  const pb = await page.evaluate(() => { const b = document.getElementById('m-pause').getBoundingClientRect(), h = document.getElementById('hatch').getBoundingClientRect(); return { w: b.width, h: b.height, right: b.right, top: b.top, hr: h.right, hb: h.bottom }; });
  ok(pb.w >= 44 && pb.h >= 44 && pb.right > pb.hr - 20 && pb.top < pb.hb / 3, `pause button top-right of hatch (${pb.w}x${pb.h})`);
  await shot(page, '04_play');

  // pause / resume
  await page.tap('#m-pause');
  ok(await screenIs(page, 'pause') && await page.evaluate(() => RS.main.paused), 'PAUSE opens pause menu, main paused');
  const t0 = await page.evaluate(() => RS.sim.state.t);
  await W(1200);
  const t1 = await page.evaluate(() => RS.sim.state.t);
  ok(t1 === t0, `sim time frozen while paused (${t0.toFixed(2)} → ${t1.toFixed(2)})`);
  await layout(page, 'pause'); await shot(page, '05_pause');
  await page.tap('#m-resume');
  await W(800);
  const t2 = await page.evaluate(() => RS.sim.state.t);
  ok(t2 > t1 + 0.3 && await page.evaluate(() => !RS.main.paused && RS.meta.screen === null), `resume advances sim time (${t2.toFixed(2)})`);

  // play to end → debrief
  const res = await autoPlay(page, 330);
  console.log('  INFO autoplay', JSON.stringify({ hp: res.hp, kills: res.stats.kills, fired: res.stats.fired, leakers: res.stats.leakers }));
  ok(await screenIs(page, 'debrief'), 'SHIFT_END → debrief');
  const deb = await page.evaluate(() => ({ g: document.getElementById('m-grade').textContent, txt: document.getElementById('meta').innerText, ec: document.getElementById('endcard').classList.contains('show'), c: RS.meta.campaign }));
  ok(/^[A-F]$/.test(deb.g), 'debrief shows grade ' + deb.g);
  ok(/ASSET/.test(deb.txt) && /LEAKERS/.test(deb.txt) && /AMMO/.test(deb.txt) && /REACTION/.test(deb.txt) && /LANCE/.test(deb.txt) && /HARROW/.test(deb.txt) && /RESERVE/.test(deb.txt), 'debrief: components, per-weapon table, reserve');
  ok(!deb.ec, 'UI end card hidden under meta debrief');
  ok(deb.g !== 'F' && deb.c.next === 1 && deb.c.best.C1 === deb.g && deb.c.pending && deb.c.pending.idx === 1, 'pass unlocks shift 2, best grade saved');
  await layout(page, 'debrief'); await shot(page, '06_debrief');

  // resupply
  await page.tap('#m-toresupply');
  ok(await screenIs(page, 'resupply'), 'RESUPPLY screen');
  const r0 = await page.evaluate(() => Object.assign({}, RS.meta.campaign.reserve));
  await page.tap('[data-m=inc][data-w=lance]'); await page.tap('[data-m=inc][data-w=lance]'); await page.tap('[data-m=inc][data-w=harrow]');
  await page.tap('[data-m=dec][data-w=lance]'); await page.tap('[data-m=inc][data-w=dart]');
  const q = await page.evaluate(() => ({ l: +document.getElementById('m-q-lance').textContent, d: +document.getElementById('m-q-dart').textContent, h: +document.getElementById('m-q-harrow').textContent, left: +document.getElementById('m-left').textContent, spent: +document.getElementById('m-spent').textContent, cr: RS.meta.campaign.pending.credits }));
  const P = await page.evaluate(() => RS.campaign.prices);
  ok(q.l === r0.lance + 1 && q.d === r0.dart + 1 && q.h === r0.harrow + 100, `steppers buy/sell (lance ${r0.lance}→${q.l}, dart ${q.d}, harrow ${q.h})`);
  ok(q.spent === P.lance + P.dart + P.harrow && q.left === q.cr - q.spent, `totals (spent ${q.spent}, left ${q.left} of ${q.cr})`);
  ok(await page.evaluate(() => document.querySelector('[data-m=dec][data-w=dart]').disabled === false && document.querySelector('[data-m=dec][data-w=lance]').disabled === false), 'minus enabled after buying');
  await layout(page, 'resupply'); await shot(page, '07_resupply');
  await page.tap('#m-confirm');
  ok(await screenIs(page, 'briefing'), 'CONFIRM → next briefing');
  const b2 = await page.evaluate(() => ({ name: RS.meta.def.name, res: RS.meta.def.reserve, camp: RS.meta.campaign.reserve, txt: document.getElementById('meta').innerText, pend: RS.meta.campaign.pending }));
  ok(/Shift 2/.test(b2.name) && b2.res.lance === q.l && b2.res.harrow === q.h && b2.camp.lance === q.l && !b2.pend, 'next ShiftDef.reserve set from resupply (' + JSON.stringify(b2.res) + ')');
  ok(/Night/.test(b2.txt) && /Hammer 2/.test(b2.txt) && /IFF INOP/.test(b2.txt), 'shift 2 briefing mentions night + Hammer 2 IFF INOP');
  await layout(page, 'briefing2'); await shot(page, '08_briefing2');

  await page.tap('[data-m=map]');
  ok(await screenIs(page, 'map') && await page.evaluate(() => !document.querySelector('[data-m=pick][data-i="1"]').disabled && document.querySelector('[data-m=pick][data-i="2"]').disabled), 'map: shift 2 unlocked, shift 3 locked');

  // settings
  await page.tap('[data-m=menu]'); await screenIs(page, 'menu');
  await page.tap('#m-settings');
  ok(await screenIs(page, 'settings'), 'settings screen');
  await page.tap('#m-sound');
  ok(await page.evaluate(() => RS.audio.muted === true && RS.meta.settings.sound === false), 'sound OFF mutes RS.audio');
  await page.tap('#m-haptics');
  ok(await page.evaluate(() => RS.settings.haptics === false), 'haptics OFF sets RS.settings.haptics=false');
  await page.tap('#m-reset');
  ok(await page.evaluate(() => !!document.getElementById('m-resetyes')), 'reset asks for in-page confirmation');
  await layout(page, 'settings'); await shot(page, '09_settings');
  await page.tap('[data-m=resetno]');
  ok(await page.evaluate(() => RS.meta.campaign.next === 1), 'cancel keeps progress');
  ok(page.errors.length === 0, 'no console errors (flow)' + (page.errors.length ? '\n    ' + page.errors.join('\n    ') : ''));

  // reload → persisted
  await page.reload({ waitUntil: 'load' });
  await page.tap('#start');
  await page.waitForFunction(() => RS.meta && RS.meta.screen === 'menu', null, { timeout: 15000 });
  const per = await page.evaluate(() => ({ c: RS.meta.campaign, s: RS.meta.settings, muted: RS.audio.muted, h: RS.settings.haptics }));
  ok(per.c.next === 1 && per.c.best.C1 === deb.g && per.c.reserve.lance === q.l && per.c.results.length === 1, 'reload: campaign progress + reserve persisted');
  ok(per.s.sound === false && per.muted === true && per.h === false, 'reload: settings persisted (muted, no haptics)');

  // free watch
  await page.tap('#m-free');
  ok(await screenIs(page, 'free'), 'free watch setup');
  await page.fill('#m-seed', '4242');
  await page.evaluate(() => { const r = document.getElementById('m-diff'); r.value = '0.8'; r.dispatchEvent(new Event('input', { bubbles: true })); });
  ok(await page.evaluate(() => /Hard/.test(document.getElementById('m-dlabel').textContent)), 'difficulty label Hard at 0.8');
  await page.tap('#m-ev-night'); await page.tap('#m-ev-late_resupply'); await page.tap('#m-ev-launcher_jam');
  await page.tap('#m-dur-6');
  ok(await page.evaluate(() => document.getElementById('m-seed').value === '4242' && document.getElementById('m-ev-night').getAttribute('aria-pressed') === 'true'), 'seed + toggles kept across re-render');
  await layout(page, 'free'); await shot(page, '10_free');
  await page.tap('#m-rseed');
  ok(await page.evaluate(() => document.getElementById('m-seed').value !== '4242'), 'RANDOM seed button');
  await page.fill('#m-seed', '4242');
  await page.tap('#m-fbrief');
  ok(await screenIs(page, 'briefing'), 'free briefing');
  await layout(page, 'free briefing'); await shot(page, '11_free_briefing');
  await page.tap('#m-begin'); await W(500);
  const fd = await page.evaluate(() => {
    const d = RS.meta.def, base = RS.content.makeFreeShift(4242, 0.8);
    return { id: d.id, run: RS.sim.state.shift.running, sid: RS.sim.state.shift.id, dur: d.duration, ev: (d.events || []).map(e => e.kind), n: d.spawns.length, bn: base.spawns.length,
      maxT: Math.max(...d.spawns.map(s => s.t)) };
  });
  ok(fd.run && fd.sid === fd.id && fd.id === 'F4242-80' && fd.dur === 360, `free shift started with seed/difficulty (${fd.id}, ${fd.dur}s)`);
  ok(['night', 'late_resupply', 'launcher_jam'].every(k => fd.ev.includes(k)) && !fd.ev.includes('storm'), 'toggled events appended (' + fd.ev + ')');
  ok(fd.n === fd.bn && fd.maxT < 360, `spawns from makeFreeShift, scaled to duration (${fd.n}, last @${fd.maxT}s)`);

  // pause → restart, pause → quit
  await autoPlay(page, 0);                  // end the free shift now
  ok(await screenIs(page, 'debrief'), 'free shift ended → debrief');
  await page.tap('#m-retry'); await screenIs(page, 'briefing'); await page.tap('#m-begin'); await W(300);
  await page.evaluate(() => { for (let i = 0; i < 400; i++) RS.sim.step(); });
  await page.tap('#m-pause'); await page.tap('#m-restart'); await W(200);
  ok(await page.evaluate(() => RS.sim.state.shift.running && RS.sim.state.shift.elapsed < 5 && RS.sim.state.shift.id === 'F4242-80' && RS.meta.screen === null), 'pause → RESTART SHIFT restarts the same def');
  await page.tap('#m-pause'); await page.tap('#m-quit');
  ok(await screenIs(page, 'menu') && await page.evaluate(() => !RS.sim.state.shift.running && !RS.main.paused), 'pause → QUIT TO MENU ends shift, menu shown');
  await W(1200);
  ok(await page.evaluate(() => RS.meta.screen === 'menu'), 'quit does not produce a debrief');

  // reset progress
  await page.tap('#m-settings'); await page.tap('#m-reset'); await page.tap('#m-resetyes');
  ok(await page.evaluate(() => RS.meta.campaign.next === 0 && !Object.keys(RS.meta.campaign.best).length && RS.load('campaign').next === 0), 'reset progress (confirmed) wipes campaign');
  await page.tap('#m-sound'); await page.tap('#m-haptics');
  ok(page.errors.length === 0, 'no console errors (390)' + (page.errors.length ? '\n    ' + page.errors.join('\n    ') : ''));
  await ctx.close();

  /* ================= 360×740 layout pass ================= */
  console.log('-- 360x740 layout');
  ({ ctx, page } = await newPage(browser, { width: 360, height: 740 }));
  await boot(page);
  await layout(page, '360 menu'); await shot(page, '360_menu');
  await page.tap('#m-campaign'); await screenIs(page, 'map'); await layout(page, '360 map');
  await page.tap('[data-m=pick][data-i="0"]'); await screenIs(page, 'briefing'); await layout(page, '360 briefing'); await shot(page, '360_briefing');
  await page.tap('#m-begin'); await W(600);
  await page.tap('#m-pause'); await layout(page, '360 pause'); await page.tap('#m-resume');
  await autoPlay(page, 60);
  await screenIs(page, 'debrief'); await layout(page, '360 debrief'); await shot(page, '360_debrief');
  if (await page.evaluate(() => !!document.getElementById('m-toresupply'))) {
    await page.tap('#m-toresupply'); await screenIs(page, 'resupply'); await layout(page, '360 resupply'); await shot(page, '360_resupply');
  } else ok(false, '360: shift 1 passed for resupply');
  await page.tap('[data-m=map]'); await page.tap('[data-m=menu]');
  await page.tap('#m-free'); await screenIs(page, 'free'); await layout(page, '360 free'); await shot(page, '360_free');
  await page.tap('[data-m=menu]'); await page.tap('#m-settings'); await page.tap('#m-reset'); await layout(page, '360 settings'); await shot(page, '360_settings');
  ok(page.errors.length === 0, 'no console errors (360)' + (page.errors.length ? '\n    ' + page.errors.join('\n    ') : ''));
  await ctx.close();

  /* ================= storage blocked ================= */
  console.log('-- storage blocked');
  ({ ctx, page } = await newPage(browser, { width: 390, height: 844 }, true));
  await boot(page);
  ok(await page.evaluate(() => { try { localStorage; return false; } catch (e) { return true; } }), 'localStorage access throws');
  await page.tap('#m-campaign'); await page.tap('[data-m=pick][data-i="0"]'); await page.tap('#m-begin'); await W(400);
  ok(await page.evaluate(() => RS.sim.state.shift.running), 'blocked storage: shift starts');
  await autoPlay(page, 40);
  ok(await screenIs(page, 'debrief') && await page.evaluate(() => /^[A-F]$/.test(document.getElementById('m-grade').textContent)), 'blocked storage: debrief with grade');
  if (await page.evaluate(() => !!document.getElementById('m-toresupply'))) {
    await page.tap('#m-toresupply'); await page.tap('[data-m=inc][data-w=dart]'); await page.tap('#m-confirm');
    ok(await screenIs(page, 'briefing') && await page.evaluate(() => /Shift 2/.test(RS.meta.def.name) && RS.meta.campaign.next === 1 && RS.save('x', 1) === false && RS.load('campaign').next === 1), 'blocked storage: resupply → shift 2 briefing, memory fallback holds progress');
  } else ok(false, 'blocked storage: shift 1 passed');
  await page.tap('[data-m=map]'); await page.tap('[data-m=menu]'); await page.tap('#m-settings'); await page.tap('#m-sound');
  ok(await page.evaluate(() => RS.audio.muted === true), 'blocked storage: settings still work');
  await shot(page, 'blocked_settings');
  ok(page.errors.length === 0, 'no console errors (storage blocked)' + (page.errors.length ? '\n    ' + page.errors.join('\n    ') : ''));
  await ctx.close();

  await browser.close();
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
