/* RED SKIES — Training Watch sure-hit test (V1.4.4). node test/training.test.js  (exit 1 on failure)
   The tutorial's ShiftDef sets sureHit: every battery shot (Lance, Dart, Harrow; single shot or salvo) kills its target and
   targets never evade. The same def without the flag still misses (so the flag is what does it). */
const fs = require('fs'), path = require('path'), vm = require('vm');
const src = f => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');

function world() {
  const el = () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, setAttribute() {}, appendChild() {},
    addEventListener() {}, children: [], querySelector: () => el() });
  const ctx = { console: { log() {}, error: (...a) => console.error(...a), warn() {} }, Math, JSON, Object, Array, String, Number,
    setTimeout: () => 0, requestAnimationFrame: () => 0, cancelAnimationFrame() {}, performance: { now: () => 0 },
    document: { createElement: el, head: { appendChild() {} }, body: { appendChild() {} }, getElementById: () => null, querySelector: () => null } };
  ctx.window = ctx; ctx.RS = {}; ctx.globalThis = ctx; vm.createContext(ctx);
  for (const f of ['contracts.js', 'content.js', 'sim.js', 'tutorial.js']) vm.runInContext(src(f), ctx, { filename: f });
  return ctx.window.RS;
}

let fails = 0;
const ok = (cond, msg) => { console.log((cond ? '  PASS ' : '  FAIL ') + msg); if (!cond) fails++; };
const HOSTILE = ['jet_hostile', 'drone'];

/* One training run with a scripted operator. o.pick(RS, track) → launcher id; o.salvo; o.fireAt: sim s before the first
   decision; o.radarGap: switch the radar off this many s right after each launch; o.def(def) edits the ShiftDef. */
function run(seed, o) {
  const RS = world(), S = () => RS.sim.state, ev = { KILL: [], MISS: [], EVADE: [], LAUNCH: [], GUN_FIRE: [] };
  for (const n in ev) RS.bus.on(n, p => ev[n].push(p));
  const def = RS.tutorial.makeDef(); if (o.def) o.def(def);
  RS.sim.init({ content: RS.content, seed }); RS.sim.startShift(def);
  if (o.salvo) RS.sim.cmd.setDoctrine(RS.DOCTRINE.SALVO);
  const shotAt = new Set(), killedIds = new Set();
  RS.bus.on('KILL', p => { if (p.trackId) killedIds.add(p.trackId); if (p.targetId) killedIds.add(p.targetId); });
  let radarBackAt = -1, lingering = 0;
  for (let i = 0; i < 20 * (o.maxS || 420); i++) {
    const k0 = ev.KILL.length;
    RS.sim.step();
    for (const k of ev.KILL.slice(k0)) if (S().missiles.some(m => m.targetId === (k.trackId || k.targetId))) lingering++;   // a spare round outliving its kill
    if (radarBackAt >= 0 && S().t >= radarBackAt) { RS.sim.cmd.radar(true); radarBackAt = -1; }
    if (i % 10 || S().t < (o.fireAt || 0)) continue;
    for (const t of S().tracks) {
      if (!HOSTILE.includes(RS.sim.debugTruth(t.id)) || t.engagedBy.length || killedIds.has(t.id)) continue;
      if (o.when && !o.when(RS, t)) continue;
      if (t.cls !== 'HOSTILE') RS.sim.cmd.classify(t.id, 'HOSTILE');
      const l = o.pick ? o.pick(RS, t) : RS.sim.query.bestLauncher(t.id); if (!l) continue;
      RS.sim.cmd.assign(t.id, l);
      if (RS.sim.cmd.fire(t.id)) {
        shotAt.add(t.id);
        if (o.radarGap) { RS.sim.cmd.radar(false); radarBackAt = S().t + o.radarGap; }
      }
    }
    if (S().t > 60 && !S().tracks.some(t => HOSTILE.includes(RS.sim.debugTruth(t.id))) && !S().missiles.length && shotAt.size >= (o.need || 1)) break;
  }
  return { RS, ev, shotAt, killedIds, lingering, missedTargets: [...shotAt].filter(id => !killedIds.has(id)) };
}
const lance = (RS, t) => (RS.sim.state.battery.launchers.find(l => l.weapon === 'lance' && RS.sim.query.engage(t.id, l.id).ok) || {}).id || null;
const dart = (RS, t) => RS.sim.query.engage(t.id, 'L3').ok ? 'L3' : null;
const gun = (RS, t) => RS.sim.query.engage(t.id, 'G1').ok ? 'G1' : null;

console.log('Training Watch def');
{
  const RS = world(), d = RS.tutorial.makeDef(), jet = d.spawns.find(s => s.kind === 'jet_hostile');
  ok(d.sureHit === true, 'makeDef() sets sureHit');
  const r = Math.hypot(jet.x, jet.y), inbound = Math.abs((((Math.atan2(-jet.x, -jet.y) * 180 / Math.PI + 360) % 360) - jet.hdg)) < 2;
  ok(r > 39 && r < 42 && inbound, `hostile jet starts ~40 km out, heading at the battery (${r.toFixed(1)} km)`);
}

console.log('every training shot hits (Lance / Dart / gun / best, shot and salvo, 6 seeds each)');
const PICKS = { best: null, lance, dart, gun };
for (const [name, pick] of Object.entries(PICKS)) for (const salvo of [false, true]) {
  let shots = 0, missed = 0, miss = 0, evade = 0, fired = 0, linger = 0;
  for (let seed = 1; seed <= 6; seed++) {
    const r = run(seed, { pick, salvo, fireAt: 10 + seed * 7, need: name === 'gun' ? 1 : 2 });
    shots += r.shotAt.size; missed += r.missedTargets.length; miss += r.ev.MISS.length; evade += r.ev.EVADE.length;
    fired += r.ev.LAUNCH.length + r.ev.GUN_FIRE.length; linger += r.lingering;
  }
  ok(shots > 0 && missed === 0 && miss === 0 && evade === 0 && linger === 0,
    `${name.padEnd(5)} ${salvo ? 'salvo' : 'shot '}: ${shots} targets, ${fired} rounds/bursts fired, ${missed} survived, ${miss} MISS events, ${evade} EVADE events, ${linger} spare rounds outlived a kill`);
}

console.log('edge cases');
{
  let missed = 0, miss = 0, shots = 0, faded = 0;
  for (let seed = 1; seed <= 6; seed++) {                   // radar off for 25 s after each launch: Dart goes degraded, tracks fade
    const r = run(seed, { pick: (RS, t) => (RS.sim.debugTruth(t.id) === 'drone' ? dart : lance)(RS, t), radarGap: 25, fireAt: 20, need: 2 });
    shots += r.shotAt.size; missed += r.missedTargets.length; miss += r.ev.MISS.length;
    faded += r.ev.KILL.filter(k => !k.trackId).length;
  }
  ok(shots > 0 && missed === 0 && miss === 0, `radar off mid-flight: ${shots} targets, ${missed} survived, ${miss} MISS (${faded} kills after the track faded)`);
}
{
  let missed = 0, miss = 0, shots = 0;
  for (let seed = 1; seed <= 4; seed++) {                   // let the jet fly past, then fire at it going away
    const outbound = (RS, t) => RS.sim.debugTruth(t.id) !== 'jet_hostile' || (t.closure > 0 && t.rangeKm > 12);
    const r = run(seed, { pick: seed % 2 ? lance : dart, when: outbound, maxS: 700, need: 2 });
    shots += r.shotAt.size; missed += r.missedTargets.length; miss += r.ev.MISS.length;
  }
  ok(shots > 0 && missed === 0 && miss === 0, `shots at a receding jet: ${shots} targets, ${missed} survived, ${miss} MISS`);
}

console.log('the flag is what does it');
{
  let miss = 0, evade = 0;
  for (let seed = 1; seed <= 8; seed++) {
    const r = run(seed, { pick: lance, def: d => { delete d.sureHit; }, need: 2 });
    miss += r.ev.MISS.length; evade += r.ev.EVADE.length;
  }
  ok(miss > 0 && evade > 0, `same def without sureHit: ${miss} MISS, ${evade} EVADE over 8 seeds`);
}

console.log('tutorial credits a kill after the track faded (radar off)');
{
  const RS = world(), S = () => RS.sim.state;
  RS.sim.init({ content: RS.content, seed: 3 });
  RS.tutorial.start();                                      // no RS.meta in node: the tutorial starts the shift itself
  let jet = null, launched = false, t0 = 0;
  for (let i = 0; i < 20 * 300 && !RS.tutorial.debug().killed.jet; i++) {
    RS.sim.step();
    jet = jet || S().tracks.find(t => RS.sim.debugTruth(t.id) === 'jet_hostile');
    if (jet && !launched && S().t > 15) {
      RS.sim.cmd.selectTrack(jet.id); RS.sim.cmd.classify(jet.id, 'HOSTILE'); RS.sim.cmd.assign(jet.id, lance(RS, jet));
      launched = RS.sim.cmd.fire(jet.id); if (launched) { RS.sim.cmd.radar(false); t0 = S().t; }
    }
  }
  const d = RS.tutorial.debug();
  ok(launched && d.killed.jet === true && S().t - t0 > 20, `jet kill counted by the tutorial ${Math.round(S().t - t0)} s after launch with the radar off`);
  RS.tutorial.stop();
}

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
