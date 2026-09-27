/* RED SKIES — 3-D scene check (Playwright, shared setup in test/_browser.js, software WebGL).
   node build.js && node test/scene.check.js   → exits 1 on failure, writes test/shots/scene_*.png */
const fs = require('fs'), path = require('path');
const { launch, newPage, URL, SHOTS } = require('./_browser');
fs.mkdirSync(SHOTS, { recursive: true });
let fails = 0;
const ok = (c, m) => { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fails++; };

(async () => {
  const browser = await launch();
  const { page, errors } = await newPage(browser);
  page.setDefaultTimeout(120000);

  await page.goto(URL, { waitUntil: 'load' });
  await page.tap('#start');
  await page.evaluate(() => { if (RS.meta && RS.meta.startShift) RS.meta.startShift(RS.content.shifts[0]); });   // menu flow (Run C)
  await page.waitForTimeout(3000);
  const hatch = await page.evaluate(() => { const r = document.getElementById('hatch').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
  const shot = async (name) => { await page.screenshot({ path: path.join(SHOTS, 'scene_' + name + '.png'), clip: hatch }); };
  const info = () => page.evaluate(() => { const r = RS.scene.debug.renderer.info; return { tris: r.render.triangles, calls: r.render.calls, geos: r.memory.geometries, tex: r.memory.textures, progs: r.programs.length }; });
  const fps = (ms) => page.evaluate(ms => new Promise(res => { let n = 0; const t0 = performance.now(); (function f() { n++; if (performance.now() - t0 < ms) requestAnimationFrame(f); else res(n * 1000 / (performance.now() - t0)); })(); }), ms);

  ok(errors.length === 0, 'no errors after boot' + (errors.length ? '\n    ' + errors.join('\n    ') : ''));
  const api = await page.evaluate(() => ({
    kinds: ['launcher_lance', 'launcher_dart', 'jet_hostile', 'jet_friend', 'missile_lance', 'missile_dart', 'cruise_missile', 'arm_missile', 'debris', 'tree', 'shelter_interior', 'gun_harrow', 'helo_attack', 'drone'].every(k => RS.models.kinds.includes(k)),
    bridge: window.Models === RS.models,
    pos: ['L1', 'L2', 'L3', 'G1', 'RADAR', 'ASSET'].map(id => RS.scene.launcherPos(id)),
    lis: RS.scene.listener(),
    tels: Object.values(RS.scene.debug.tels).map(t => ({ id: t.id, vendor: t.vendor, state: t.ud.state, rounds: t.ud.rounds }))
  }));
  ok(api.bridge && api.kinds, 'Models bridge: window.Models === RS.models, kinds superset');
  ok(api.pos.every(p => isFinite(p.x) && isFinite(p.y) && isFinite(p.z)), 'launcherPos for L1/L2/L3/G1/RADAR/ASSET');
  const a = api.pos[5]; ok(Math.abs(Math.hypot(a.x, a.z) - 22000) < 50 && Math.abs(((Math.atan2(a.x, -a.z) * 180 / Math.PI + 360) % 360) - 200) < 1, 'ASSET at 200° / 22 km');
  ok(api.lis && isFinite(api.lis.pos.y) && api.lis.headingDeg === 25, 'listener() pose');
  ok(api.tels.length === 3 && api.tels.every(t => t.vendor && t.state === 'ready' && t.rounds === 4), 'three vendor TELs deployed, 4 rounds each ' + JSON.stringify(api.tels));

  await shot('01_battery');
  const idleFps = await fps(3000), idle = await info();
  console.log(`  idle: fps ${idleFps.toFixed(1)}  tris ${idle.tris}  calls ${idle.calls}  geos ${idle.geos}  tex ${idle.tex}  programs ${idle.progs}`);

  // ---- real sim: fast-forward, classify a true hostile, assign a TEL, fire
  const eng = await page.evaluate(() => {
    const s = RS.sim.state; let pick = null;
    for (let i = 0; i < 6000 && !pick; i++) {
      RS.sim.step();
      if (i % 20) continue;
      for (const t of s.tracks) {
        const tr = RS.sim.debugTruth ? RS.sim.debugTruth(t.id) : null;
        const kind = tr && (tr.kind || tr);
        if (typeof kind !== 'string' || !/hostile|cruise|drone|arm/.test(kind)) continue;
        for (const L of ['L1', 'L2', 'L3']) { const q = RS.sim.query.engage(t.id, L); if (q.inRange) { pick = { id: t.id, kind, L, brg: t.bearingDeg, rng: t.rangeKm }; break; } }
        if (pick) break;
      }
    }
    if (!pick) return null;
    RS.sim.cmd.classify(pick.id, RS.CLS.HOSTILE);
    RS.sim.cmd.assign(pick.id, pick.L);
    pick.q = RS.sim.query.engage(pick.id, pick.L);
    pick.fired = RS.sim.cmd.fire(pick.id);
    return pick;
  });
  ok(!!eng && eng.fired, 'real sim: hostile classified, assigned, fired ' + JSON.stringify(eng));
  // software WebGL runs ~5 fps and the scene clamps dt to 0.1 s, so scene time runs slow here: poll rather than sleep
  await page.waitForFunction(() => Object.values(RS.scene.debug.tels).some(t => t.ud.slots.some(s => s.busy)), null, { timeout: 8000 }).catch(() => {});
  await page.evaluate(() => { RS.scene.debug.timeScale = 0.35; });
  await page.waitForTimeout(1500);
  await shot('02_cold_launch');
  await page.evaluate(() => { RS.scene.debug.timeScale = 1; });
  await page.waitForFunction(() => Object.keys(RS.scene.debug.flights).length > 0, null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const fl = await page.evaluate(() => Object.keys(RS.scene.debug.flights));
  ok(fl.length >= 1, 'missile handed off and followed by scene: ' + fl.join(','));
  await shot('03_missile_trail');

  // ---- direct bus effects
  const inView = (brg, km, alt) => ({ x: Math.sin(brg * Math.PI / 180) * km, y: Math.cos(brg * Math.PI / 180) * km, alt });
  await page.evaluate(() => { RS.scene.debug.timeScale = 0.1; });
  await page.evaluate(p => {
    RS.bus.emit('INTERCEPT', Object.assign({ missileId: 'Z1', targetId: 'T99' }, p.a));
    RS.bus.emit('KILL', Object.assign({ targetId: 'T99', weapon: 'lance', wasFriend: false, trackId: 'T99' }, p.a));
    RS.bus.emit('INTERCEPT', Object.assign({ missileId: 'Z2', targetId: 'T98' }, p.b));
  }, { a: inView(18, 3.2, 1400), b: inView(38, 24, 6000) });
  await page.waitForTimeout(250);
  await shot('04_intercept_bloom');
  const flares = await page.evaluate(() => RS.scene.debug.particles());
  ok(flares.flare >= 2 && flares.glow > 10, 'intercept/kill flashes spawned ' + JSON.stringify(flares));
  await page.evaluate(() => { RS.scene.debug.timeScale = 1; });
  await page.waitForTimeout(2500);
  await shot('05_kill_debris');

  await page.evaluate(() => RS.bus.emit('GUN_FIRE', { launcherId: 'G1', targetId: 'T97', burst: true, bearingDeg: 30, elevDeg: 22, rounds: 120 }));
  await page.waitForTimeout(1500);
  await page.evaluate(() => { RS.scene.debug.timeScale = 0.2; });
  await shot('06_tracers');
  await page.evaluate(() => { RS.scene.debug.timeScale = 1; });
  await page.evaluate(() => { RS.bus.emit('ARM_IMPACT', { damage: 0.7 }); RS.bus.emit('ASSET_HIT', { byId: 'T96', damage: 0.5 }); });
  await page.waitForTimeout(200);
  ok(await page.evaluate(() => RS.scene.debug.shakeT > 0.3), 'ARM impact shakes the camera');
  await page.waitForTimeout(2500);
  await shot('07_arm_asset');
  const busyFps = await fps(3000), busy = await info();
  console.log(`  busy: fps ${busyFps.toFixed(1)}  tris ${busy.tris}  calls ${busy.calls}  geos ${busy.geos}  particles ${JSON.stringify(await page.evaluate(() => RS.scene.debug.particles()))}`);

  // ---- environment
  await page.evaluate(() => RS.scene.setEnv({ time: 'night', weather: 'clear' }));
  await page.evaluate(() => { RS.bus.emit('LAUNCH', { missileId: 'N1', weapon: 'dart', launcherId: 'L3', targetId: 'T90', x: 0, y: 0, alt: 0 }); RS.bus.emit('GUN_FIRE', { launcherId: 'G1', targetId: 'T97', burst: true, bearingDeg: 12, elevDeg: 30, rounds: 120 }); });
  await page.waitForTimeout(4000);
  await page.evaluate(p => { RS.scene.debug.timeScale = 0.1; RS.bus.emit('INTERCEPT', Object.assign({ missileId: 'Z3', targetId: 'T95' }, p)); }, inView(30, 5, 2500));
  await page.waitForTimeout(300);
  await shot('08_night');
  await page.evaluate(() => { RS.scene.debug.timeScale = 1; });
  ok(await page.evaluate(() => RS.scene.debug.env.night && !RS.scene.debug.env.storm), 'setEnv night');
  await page.evaluate(() => RS.scene.setEnv({ time: 'dusk', weather: 'storm' }));
  await page.waitForTimeout(1200);
  await shot('09_storm');
  await page.evaluate(() => RS.scene.setEnv({ time: 'day', weather: 'clear' }));
  await page.evaluate(() => RS.bus.emit('RANDOM_EVENT', { kind: 'storm', active: true, detail: '' }));
  ok(await page.evaluate(() => RS.scene.debug.env.storm), 'RANDOM_EVENT storm drives env');
  await page.evaluate(() => RS.bus.emit('RANDOM_EVENT', { kind: 'storm', active: false, detail: '' }));
  await page.waitForTimeout(600);
  await shot('10_day');
  await page.evaluate(() => RS.scene.setEnv({ time: 'dusk', weather: 'clear' }));

  // ---- aircraft close pass: the live loop renders an injected visible[] (render is wrapped, then restored)
  await page.evaluate(() => {
    const kinds = ['jet_hostile', 'jet_hostile', 'jet_hostile', 'strike_friend', 'jet_friend', 'transport', 'helo_hostile', 'cruise_missile', 'drone', 'arm_missile'];
    const orig = RS.scene.render; let t = 1000;
    window.__restoreRender = () => { RS.scene.render = orig; };
    RS.scene.render = (dt, s0) => { t += dt; orig(dt, Object.assign({}, s0, { t, visible: kinds.map((k, i) => {
      const b = (2 + i * 5.5) * Math.PI / 180, r = 0.22 + i * 0.3;
      return { id: 'E' + (80 + i), kind: k, x: Math.sin(b) * r, y: Math.cos(b) * r, alt: k === 'helo_hostile' ? 40 : 45 + i * 70, hdg: 290, spd: 0, burning: i === 2 };
    }) })); };
  });
  await page.waitForTimeout(1500);
  const air = await page.evaluate(() => Object.keys(RS.scene.debug.actors).length);
  ok(air === 10, 'aircraft actors built for all visible kinds: ' + air);
  const tAir = await info();
  await shot('11_aircraft');
  console.log(`  aircraft frame: tris ${tAir.tris} calls ${tAir.calls}`);
  await page.evaluate(() => window.__restoreRender());

  // ---- geometry leak check: 21 launch/kill cycles across the three TELs
  const cycle = async c => {
    await page.evaluate(c => { for (const L of ['L1', 'L2', 'L3']) RS.bus.emit('LAUNCH', { missileId: 'C' + c + L, weapon: L === 'L3' ? 'dart' : 'lance', launcherId: L, targetId: 'T50', x: 0, y: 0, alt: 0 }); }, c);
    await page.waitForFunction(c => ['L1', 'L2', 'L3'].every(L => RS.scene.debug.flights['C' + c + L]), c, { timeout: 30000 }).catch(() => {});
    await page.evaluate(c => { for (const L of ['L1', 'L2', 'L3']) { RS.bus.emit('INTERCEPT', { missileId: 'C' + c + L, targetId: 'T50', x: 1, y: 3, alt: 2000 }); RS.bus.emit('KILL', { targetId: 'T50', weapon: 'lance', wasFriend: false, x: 1, y: 3, alt: 2000, trackId: 'T50' }); } }, c);
  };
  // warm-up: 5 rounds per TEL so first-use uploads happen before the baseline (debris, the out-of-rounds fallback model)
  await page.evaluate(() => { for (let i = 0; i < 5; i++) for (const L of ['L1', 'L2', 'L3']) RS.bus.emit('LAUNCH', { missileId: 'W' + i + L, weapon: L === 'L3' ? 'dart' : 'lance', launcherId: L, targetId: 'T50', x: 0, y: 0, alt: 0 }); });
  await page.waitForTimeout(3000);
  await page.evaluate(() => RS.bus.emit('KILL', { targetId: 'T50', weapon: 'lance', wasFriend: false, x: 1, y: 3, alt: 2000, trackId: 'T50' }));
  await page.waitForFunction(() => !Object.keys(RS.scene.debug.flights).length && Object.values(RS.scene.debug.tels).every(t => !t.queue.length && !t.ud.slots.some(s => s.busy)), null, { timeout: 90000, polling: 500 }).catch(() => {});
  const g0 = (await info()).geos;
  if (process.env.GEO_DEBUG) await page.evaluate(() => {
    const seen = window.__geo = new Map(), R = RS.scene.debug.renderer, orig = R.render.bind(R);
    const dispose = THREE.BufferGeometry.prototype.dispose;
    THREE.BufferGeometry.prototype.dispose = function () { seen.delete(this); return dispose.call(this); };
    R.render = (sc, cam) => { orig(sc, cam); sc.traverseVisible(o => { if (o.geometry && !seen.has(o.geometry)) { let p = o, path = []; while (p) { path.push(p.name || p.type); p = p.parent; } seen.set(o.geometry, path.slice(0, 5).join('<') + ' ' + o.geometry.type); } }); };
    window.__geo0 = new Set(seen.keys());
  });
  for (let c = 0; c < 7; c++) await cycle(c);
  // settle: no flights, queues empty, and canisters reloaded to the sim's round counts
  const synced = () => Object.values(RS.scene.debug.tels).every(t => t.ud.rounds === RS.sim.state.battery.launchers.find(l => l.id === t.id).rounds && !t.ud.slots.some(s => s.busy));
  await page.waitForFunction(s => !Object.keys(RS.scene.debug.flights).length && Object.values(RS.scene.debug.tels).every(t => !t.queue.length) && eval(s)(), synced.toString(), { timeout: 120000, polling: 500 }).catch(() => {});
  const g1 = await info();
  if (process.env.GEO_DEBUG) console.log(await page.evaluate(() => { const out = []; window.__geo.forEach((v, k) => { if (!window.__geo0.has(k)) out.push(v); }); return out.join('\n'); }), await page.evaluate(() => JSON.stringify({ sim: RS.sim.state.battery.launchers.map(l => [l.id, l.rounds, l.reloadT]), res: RS.sim.state.battery.reserve, shift: RS.sim.state.shift.running })));
  ok(g1.geos <= g0 + 2, `geometries stable over 21 launch/kill cycles (${g0} → ${g1.geos}), programs ${g1.progs}`);
  const tl = await page.evaluate(() => Object.values(RS.scene.debug.tels).map(t => t.id + ':' + t.ud.rounds + '/' + RS.sim.state.battery.launchers.find(l => l.id === t.id).rounds));
  ok(await page.evaluate(s => eval(s)(), synced.toString()), 'TEL canisters re-synced to sim rounds (tel/sim): ' + tl.join(' '));
  ok(errors.length === 0, 'no console/page errors' + (errors.length ? '\n    ' + errors.slice(0, 8).join('\n    ') : ''));

  await browser.close();
  console.log(fails ? `scene.check: ${fails} FAIL` : 'scene.check: all PASS');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
