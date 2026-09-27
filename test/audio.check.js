/* RED SKIES — audio (RS.audio + RS.sfx weapon audio) + haptics browser check (Playwright + preinstalled Chromium).
   node build.js && node test/audio.check.js   → exits 1 on failure */
const fs = require('fs'), path = require('path');
let pw;
try { pw = require('playwright'); } catch (e) {
  try { pw = require('playwright-core'); } catch (e2) { pw = require('/home/claude/.npm-global/lib/node_modules/playwright'); }
}
const { chromium } = pw;
const URL = 'file://' + path.join(__dirname, '..', 'dist', 'weapons_hold.html');
function findChromium() {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  for (const p of [path.join(base, 'chromium-1194/chrome-linux/chrome'), '/opt/pw-browsers/chromium/chrome-linux/chrome']) if (fs.existsSync(p)) return p;
  return undefined;
}
let fails = 0;
const ok = (c, m) => { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fails++; };
const KINDS = ['arm', 'fratricide', 'asset', 'leaker', 'radar', 'lowammo'];

(async () => {
  const launch = { headless: true, args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] };
  if (process.env.HTTPS_PROXY) launch.proxy = { server: process.env.HTTPS_PROXY };
  let browser;
  try { browser = await chromium.launch(launch); } catch (e) { launch.executablePath = findChromium(); browser = await chromium.launch(launch); }
  const bctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, ignoreHTTPSErrors: true });
  await bctx.addInitScript(() => {
    window.__vib = [];
    try { Object.defineProperty(navigator, 'vibrate', { configurable: true, value: p => { window.__vib.push(JSON.stringify(p)); return true; } }); } catch (e) { /* */ }
  });
  const page = await bctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));

  await page.goto(URL, { waitUntil: 'load' });
  await page.tap('#start');
  await page.evaluate(() => { if (RS.meta && RS.meta.startShift) RS.meta.startShift(RS.content.shifts[0]); });   // menu flow (Run C)
  await page.waitForTimeout(600);
  const st = await page.evaluate(() => RS.audio.debug(true));
  ok(st.state === 'running', `AudioContext running after start tap (${st.state})`);
  ok(await page.evaluate(() => !!RS.sfx && RS.sfx.ctx === RS.audio.ctx && RS.audio.debug().sfx && !!RS.audio.sfxBus), 'RS.sfx attached to RS.audio.ctx via sfxBus');
  ok(await page.evaluate(() => typeof RS.audio.hint === 'string' && /silent/i.test(RS.audio.hint)), 'RS.audio.hint present (iPhone ringer)');
  ok(st.peak !== null, 'sfxBus peak meter available');
  await page.evaluate(() => { window.__fl = []; RS.sfx.onFlight = (h, k) => window.__fl.push(h); });

  // weapon events are voiced by RS.sfx only: audio.js adds no voices for them (no double sounds)
  const dup = await page.evaluate(() => {
    const E = (n, p) => RS.bus.emit(n, p), v = () => RS.audio.debug().voices, out = {};
    let v0 = v(); E('LAUNCH', { missileId: 'M90', weapon: 'lance', launcherId: 'L1', targetId: 'T90', x: 0.05, y: 0, alt: 0 }); out.lance = v() - v0;
    v0 = v(); E('LAUNCH', { missileId: 'M91', weapon: 'dart', launcherId: 'L3', targetId: 'T90', x: 0, y: 0.07, alt: 0 }); out.dart = v() - v0;
    v0 = v(); E('INTERCEPT', { missileId: 'M90', targetId: 'T90', x: 0.4, y: 0.3, alt: 800 }); out.intercept = v() - v0;
    v0 = v(); E('ARM_IMPACT', { damage: 0.4 }); out.arm = v() - v0;
    v0 = v(); E('ASSET_HIT', { byId: 'T95', damage: 0.2 }); out.asset = v() - v0;
    v0 = v(); E('KILL', { targetId: 'T90', trackId: 'T90', weapon: 'lance', wasFriend: false, x: 0.4, y: 0.3, alt: 800 }); out.kill = v() - v0;
    v0 = v(); E('MISS', { missileId: 'M92', targetId: 'T91' }); out.miss = v() - v0;
    v0 = v(); E('GUN_FIRE', { launcherId: 'G1', targetId: 'T90', burst: true, bearingDeg: 45, elevDeg: 10, rounds: 40 }); out.gun = v() - v0;
    return out;
  });
  ok(dup.lance === 0 && dup.dart === 0 && dup.intercept === 0 && dup.arm === 0 && dup.asset === 0, 'launch/intercept/ARM/asset booms not duplicated in audio.js ' + JSON.stringify(dup));
  ok(dup.kill === 2 && dup.miss === 2 && dup.gun === 1, 'kill console tone, miss tones and Harrow gun kept in audio.js');
  await page.waitForTimeout(1500);
  const p1 = await page.evaluate(() => RS.audio.debug(true));
  ok(p1.peak > 0.01 && !p1.nan, `sfx audible on sfxBus, no NaN (peak ${p1.peak && p1.peak.toFixed(3)})`);

  // remaining one-shot UI/console events
  const peak = await page.evaluate(() => {
    const E = (n, p) => RS.bus.emit(n, p);
    E('UI_TAP', { what: 'button' });
    E('IFF_SENT', { id: 'T90' });
    for (const r of ['FRIEND', 'NO_RESPONSE', 'INVALID']) E('IFF_RESULT', { id: 'T90', result: r });
    E('UI_FIRE_ARMED', { armed: true }); E('UI_FIRE_ARMED', { armed: false });
    E('FIRE_REJECTED', { id: 'T90', reason: 'roe_hold' });
    E('COMMS', { id: 1, from: 'HQ', text: 'test', priority: 'high', needsAck: true });
    E('ARM_INBOUND', { id: 'T92', eta: 20 });
    E('FRATRICIDE', { targetId: 'T93' });
    E('RADAR_WARN', { seconds: 95 });
    E('RELOAD_DONE', { launcherId: 'L1' });
    return RS.audio.debug().voices;
  });
  ok(peak > 5, `one-shot voices sounding (${peak})`);

  // real sim engagement: fast-forward, classify a true hostile, assign best launcher, fire
  const eng = await page.evaluate(() => {
    const S = RS.sim.state, hostile = k => /hostile|cruise|drone|arm/.test(k || '');
    for (let i = 0; i < 12000; i++) {
      RS.sim.step();
      if (i % 20) continue;
      for (const t of S.tracks) {
        if (!hostile(RS.sim.debugTruth(t.id)) || t.engagedBy.length) continue;
        const lid = RS.sim.query.bestLauncher(t.id);
        if (!lid || lid === 'G1') continue;
        RS.sim.cmd.classify(t.id, RS.CLS.HOSTILE); RS.sim.cmd.assign(t.id, lid);
        const n0 = RS.sim.state.missiles.length;
        window.__ev = [];
        for (const e of ['INTERCEPT', 'KILL', 'MISS']) RS.bus.on(e, p => window.__ev.push(e));
        const fired = RS.sim.cmd.fire(t.id);
        return { id: t.id, lid, kind: RS.sim.debugTruth(t.id), fired, n: RS.sim.state.missiles.length - n0, steps: i };
      }
    }
    return null;
  });
  ok(!!eng && eng.fired && eng.n >= 1, 'real engagement fired ' + JSON.stringify(eng));
  await page.waitForTimeout(300);
  const fl = await page.evaluate(() => ({ active: RS.sfx.active, kinds: window.__fl.map(h => h.kind) }));
  ok(fl.active >= 1 && fl.kinds.some(k => /missile_(lance|dart)/.test(k)), 'SAM flight loop running ' + JSON.stringify(fl));
  let evs = [];
  for (let i = 0; i < 60 && !evs.length; i++) { await page.waitForTimeout(500); evs = await page.evaluate(() => window.__ev || []); }
  ok(evs.includes('INTERCEPT') || evs.includes('MISS'), 'engagement resolved: ' + evs.join(','));
  await page.waitForTimeout(1000);
  const ended = await page.evaluate(() => window.__fl.filter(h => /missile_/.test(h.kind)).every(h => h.ended));
  ok(ended, 'SAM flight loops ended after intercept');
  let act = -1;
  for (let i = 0; i < 70 && act !== 0; i++) { await page.waitForTimeout(500); act = await page.evaluate(() => RS.sfx.active - RS.sim.state.visible.filter(v => /cruise|arm/.test(v.kind)).length); }
  ok(act <= 0, `sfx voices drained after engagement (${act})`);
  const p2 = await page.evaluate(() => RS.audio.debug(true));
  ok(!p2.nan && p2.flyby <= 3, `no NaN through the engagement, flyby voices ≤ 3 (${p2.flyby})`);

  // locks: one voice per launcher, stop cleanly
  const lk = await page.evaluate(() => {
    const E = (n, p) => RS.bus.emit(n, p), out = [];
    E('LOCK', { id: 'T90', launcherId: 'L1', on: true }); E('LOCK', { id: 'T90', launcherId: 'L1', on: true });
    E('LOCK', { id: 'T91', launcherId: 'L3', on: true });
    out.push(RS.audio.debug().locks);
    E('LOCK', { id: 'T90', launcherId: 'L1', on: false }); E('LOCK', { id: 'T91', launcherId: 'L3', on: false });
    out.push(RS.audio.debug().locks);
    return out;
  });
  ok(lk[0] === 2 && lk[1] === 0, `lock growl: 1 voice per launcher, stops (${lk})`);

  // alarms via bus and via RS.audio.alarm
  const al = await page.evaluate(k => {
    k.forEach((kind, i) => i % 2 ? RS.audio.alarm(kind, true) : RS.bus.emit('ALARM', { kind, on: true }));
    RS.bus.emit('ALARM', { kind: 'arm', on: true });                                // duplicate on is ignored
    return RS.audio.debug().loops;
  }, KINDS);
  ok(al === KINDS.length, `all ${KINDS.length} alarm loops running (${al})`);
  await page.waitForTimeout(3500);                                                   // let loops cycle
  const off = await page.evaluate(k => {
    k.forEach((kind, i) => i % 2 ? RS.bus.emit('ALARM', { kind, on: false }) : RS.audio.alarm(kind, false));
    return RS.audio.debug();
  }, KINDS);
  ok(off.loops === 0 && off.locks === 0, `alarm loops stopped (${JSON.stringify(off.loopKinds)})`);
  await page.waitForTimeout(4000);
  const v = await page.evaluate(() => RS.audio.debug().voices);
  ok(v <= 4, `voices drained after loops stop (${v})`);

  // haptics
  const vib = await page.evaluate(() => window.__vib.slice());
  for (const p of [[30], [20, 40, 20], [100, 50, 100, 50, 100], [60], [400], [15, 30, 15]])
    ok(vib.includes(JSON.stringify(p)), 'vibrate ' + JSON.stringify(p));

  // mute silences everything (sfx included) and haptics
  await page.evaluate(() => RS.audio.setMuted(true));
  await page.waitForTimeout(250);                       // let pre-mute samples leave the analyser window
  await page.evaluate(() => { RS.audio.debug(true); window.__n = window.__vib.length;
    RS.bus.emit('LAUNCH', { missileId: 'M99', weapon: 'dart', launcherId: 'L3', targetId: 'T90', x: 0, y: 0, alt: 0 });
    RS.bus.emit('ARM_IMPACT', { damage: 0.3 });
    RS.bus.emit('FIRE_REJECTED', { id: 'T90', reason: 'no_rounds' }); });
  await page.waitForTimeout(1200);
  const mu = await page.evaluate(() => { const d = RS.audio.debug(true), after = window.__vib.slice(window.__n).filter(p => p !== '0'); RS.audio.setMuted(false); return { d, after: after.length }; });
  ok(mu.after === 0, 'setMuted(true) disables haptics');
  ok(mu.d.peak > 0.01 && mu.d.outPeak < 1e-4, `setMuted(true) silences sfx at the output (sfxBus ${mu.d.peak.toFixed(3)}, out ${mu.d.outPeak.toExponential(1)})`);

  // SHIFT_START stops sfx loops cleanly
  const rs = await page.evaluate(() => {
    RS.sfx.flight('cruise_missile', t => ({ x: 800 - t * 250, y: 60, z: -400 }));
    const before = RS.sfx.active; RS.main.restart();
    return { before, after: RS.sfx.active, fly: RS.audio.debug().flyby };
  });
  ok(rs.before >= 1 && rs.after === 0, `SHIFT_START stops sfx loops (${rs.before} → ${rs.after})`);
  await page.waitForTimeout(800);
  ok(!(await page.evaluate(() => RS.audio.debug().nan)), 'no NaN on the audio meters');

  ok(errors.length === 0, 'no console/page errors' + (errors.length ? '\n    ' + errors.join('\n    ') : ''));
  await browser.close();
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
