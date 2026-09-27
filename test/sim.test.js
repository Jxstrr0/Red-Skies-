/* RED SKIES — headless sim test. node test/sim.test.js  (exit 1 on failure) */
const fs = require('fs'), path = require('path'), vm = require('vm');
const src = f => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');

const logs = [];
const ctx = { console: { log: m => logs.push(String(m)), error: (...a) => console.error(...a), warn() {} }, Math, JSON, Object, Array, String, Number };
ctx.window = ctx; ctx.RS = {};   // browser-like: window is the global object
ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of ['contracts.js', 'content.js', 'sim.js']) vm.runInContext(src(f), ctx, { filename: f });
const RS = ctx.window.RS;

let fails = 0;
const ok = (cond, msg) => { console.log((cond ? '  PASS ' : '  FAIL ') + msg); if (!cond) fails++; };
const events = {};
for (const n of RS.EV) RS.bus.on(n, p => (events[n] = events[n] || []).push({ t: RS.sim.state.t, p }));

const TRACK_FIELDS = ['id', 'x', 'y', 'alt', 'hdg', 'spd', 'rangeKm', 'bearingDeg', 'closure', 'quality', 'firstSeen', 'lastSeen',
  'iff', 'cls', 'priority', 'assigned', 'strobe', 'engagedBy'];
const PAYLOAD = { SIM_TICK: ['t', 'dt'], TRACK_NEW: ['id', 'track'], TRACK_LOST: ['id', 'reason'], TRACK_SELECTED: ['id'],
  RADAR_STATE: ['on'], RADAR_WARN: ['seconds'], COMMS: ['from', 'text', 'priority'], LEAKER: ['id'], SHIFT_START: ['def'],
  SHIFT_END: ['grade', 'failed', 'reason', 'stats'] };

RS.sim.init({ content: RS.content });
RS.sim.startShift(RS.content.shifts[0]);
RS.sim.cmd.radar(true);
const steps = s => { for (let i = 0; i < Math.round(s * RS.SIM_HZ); i++) RS.sim.step(); };

console.log('radar on, 120 s');
let kindLeak = false, fieldMiss = [];
for (let i = 0; i < 120 * RS.SIM_HZ; i++) {
  RS.sim.step();
  for (const tr of RS.sim.state.tracks) {
    if ('kind' in tr || Object.keys(tr).some(k => /kind/i.test(k))) kindLeak = true;
    for (const f of TRACK_FIELDS) if (!(f in tr) || tr[f] === undefined) fieldMiss.push(tr.id + '.' + f);
  }
}
const s = RS.sim.state;
ok((events.TRACK_NEW || []).length >= 1, `TRACK_NEW emitted (${(events.TRACK_NEW || []).length})`);
ok(s.tracks.length >= 1, `tracks held at 120 s (${s.tracks.length})`);
ok(fieldMiss.length === 0, 'tracks have all contract fields' + (fieldMiss.length ? ' missing ' + fieldMiss.slice(0, 5) : ''));
ok(!kindLeak, 'tracks never expose kind');
ok((events.TRACK_NEW || []).every(e => !('kind' in e.p.track)), 'TRACK_NEW snapshot has no kind');
ok(s.tracks.every((t, i, a) => i === 0 || a[i - 1].id < t.id), 'tracks sorted by id');
const warns = events.RADAR_WARN || [];
ok(warns.length >= 1 && warns[0].t >= 90 && warns[0].t < 91, `RADAR_WARN after 90 s continuous (first at ${warns[0] && warns[0].t.toFixed(1)})`);
ok(warns.length >= 2 && Math.abs(warns[1].t - warns[0].t - 10) < 0.2, 'RADAR_WARN repeats every 10 s');
ok(s.visible.every(v => Math.hypot(v.x, v.y) <= RS.VISIBLE_KM), 'visible within VISIBLE_KM');

console.log('select');
const tid = s.tracks[0].id;
ok(RS.sim.cmd.selectTrack(tid) && s.selectedId === tid, 'selectTrack sets selectedId');
ok(RS.sim.cmd.selectTrack('T999') === false, 'selectTrack rejects unknown id');
ok(RS.sim.cmd.setDoctrine(RS.DOCTRINE.SALVO) && s.battery.doctrine === RS.DOCTRINE.SALVO, 'setDoctrine');
ok(['interrogate', 'classify', 'assign', 'fire'].every(c => RS.sim.cmd[c]('T999', 'L1') === false), 'commands reject unknown track');
ok(RS.sim.cmd.reload('X9') === false && RS.sim.cmd.ack(999) === false, 'reload/ack reject unknown ids');

console.log('radar off, 40 s');
const nNew = (events.TRACK_NEW || []).length;
const offT = s.t;
const before = {}; for (const t of s.tracks) before[t.id] = t.quality;
RS.sim.cmd.radar(false);
ok(s.radar.on === false && events.RADAR_STATE.slice(-1)[0].p.on === false, 'RADAR_STATE off emitted');
let paintedWhileOff = false, decayed = true;
for (let i = 0; i < 40 * RS.SIM_HZ; i++) {
  RS.sim.step();
  for (const t of s.tracks) if (t.lastSeen > offT + 1e-9) paintedWhileOff = true;
  if (i === 5 * RS.SIM_HZ) for (const t of s.tracks) if (before[t.id] !== undefined && !(t.quality < before[t.id])) decayed = false;
}
ok(!paintedWhileOff, 'no paints while radar off');
ok((events.TRACK_NEW || []).length === nNew, 'no TRACK_NEW while radar off');
ok(decayed, 'track quality decays while radar off');
ok(s.tracks.length === 0, `all tracks faded after 40 s off (${s.tracks.length} left)`);
ok((events.TRACK_LOST || []).some(e => e.p.reason === 'faded'), "TRACK_LOST reason 'faded'");
ok(s.radar.emitTime === 0, 'emitTime reset when radar off');

console.log('payload shapes');
let bad = [];
for (const n in PAYLOAD) for (const e of events[n] || []) for (const f of PAYLOAD[n]) if (!(f in e.p) || e.p[f] === undefined) bad.push(n + '.' + f);
ok(bad.length === 0, 'all emitted payloads have contract fields' + (bad.length ? ' ' + [...new Set(bad)] : ''));

console.log('full shift');
RS.sim.cmd.radar(true);
steps(480);
ok((events.SHIFT_END || []).length === 1 && !s.shift.running, 'SHIFT_END fires once at duration');
ok(RS.content.makeFreeShift(7, 0.5).spawns.length > 5 && JSON.stringify(RS.content.makeFreeShift(7, 0.5)) === JSON.stringify(RS.content.makeFreeShift(7, 0.5)), 'makeFreeShift seeded & deterministic');
ok(Object.values(RS.KIND).every(k => RS.content.threats[k] && RS.content.threats[k].altBand.length === 2), 'threat entry per KIND');
console.log('events:', Object.keys(events).map(k => k + '=' + events[k].length).join(' '));

/* =================== Run B fixture-driven checks =================== */
const K = RS.KIND, sim = RS.sim;
let ev = {};                                      // per-scenario event log
for (const n of RS.EV) RS.bus.on(n, p => (ev[n] = ev[n] || []).push({ t: sim.state.t, p }));
const E = n => ev[n] || [];
const last = n => E(n).slice(-1)[0];
function run(def, seed) { ev = {}; sim.init({ content: RS.content, seed: seed || 1 }); sim.startShift(def); }
function until(cond, maxS) { for (let i = 0; i < maxS * RS.SIM_HZ; i++) { if (cond()) return true; sim.step(); } return cond(); }
const trackNear = (x, y, tol) => sim.state.tracks.find(t => Math.hypot(t.x - x, t.y - y) < (tol || 6));
const shiftDef = (id, spawns, extra) => Object.assign({ id, name: id, duration: 900, roe: 'TIGHT', spawns, comms: [] }, extra || {});

console.log('engagement / ROE / reload / salvo / comms');
run(shiftDef('FX_ENG', [
  { t: 0, kind: K.JET_HOSTILE, x: 0, y: 25, alt: 5000, hdg: 180, spd: 250 },
  { t: 0, kind: K.JET_HOSTILE, x: 8, y: 33, alt: 5000, hdg: 180, spd: 250 },
  { t: 0, kind: K.JET_FRIEND, x: -10, y: 10, alt: 5000, hdg: 90, spd: 220, orbit: { cx: -10, cy: 12, r: 3 } }
], { reserve: { lance: 1, dart: 8, harrow: 1200 }, comms: [{ t: 1, from: 'HQ', text: 'Ack this.', priority: 'high', needsAck: true }],
  roeChanges: [{ t: 2, roe: 'FREE' }, { t: 3, roe: 'TIGHT' }], events: [{ t: 1, kind: 'launcher_jam', duration: 3, detail: { launcherId: 'L3' } }] }));
const S = () => sim.state;
until(() => sim.state.tracks.length >= 3, 45);
const h1 = S().tracks.find(t => Math.abs(t.x) < 2 && t.y > 5), fr = S().tracks.find(t => t.x < -2);
ok(h1 && fr, 'fixture tracks acquired');
ok(E('ROE_CHANGE').length === 2 && S().shift.roe === 'TIGHT' && E('COMMS').some(c => c.p.from === 'HQ' && /FREE/.test(c.p.text)), 'ROE_CHANGE applied with HQ comms');
const ackMsg = S().comms.find(c => c.needsAck && c.text === 'Ack this.');
ok(ackMsg && sim.cmd.ack(ackMsg.id) && ackMsg.acked && !sim.cmd.ack(ackMsg.id), 'comms needsAck → ack marks acked once');
ok(E('RANDOM_EVENT').length === 2 && !S().battery.launchers[2].jammed, 'launcher_jam random event starts and ends');
S().shift.roe = 'HOLD';
ok(sim.cmd.assign(h1.id, 'L1') && S().battery.launchers[0].assignedTrack === h1.id && h1.assigned === 'L1', 'assign sets launcher + track');
ok(last('LOCK') && last('LOCK').p.on && last('LOCK').p.id === h1.id, 'LOCK on after assign with valid solution');
ok(!sim.cmd.fire(h1.id) && last('FIRE_REJECTED').p.reason === 'roe_hold', 'HOLD rejects');
S().shift.roe = 'TIGHT';
ok(!sim.cmd.fire(h1.id) && last('FIRE_REJECTED').p.reason === 'roe_tight_not_hostile', 'TIGHT rejects UNKNOWN');
const q = sim.query.engage(h1.id, 'L1');
ok(q.ok === false && q.reason === 'roe_tight_not_hostile' && q.pk > 0.3 && q.tti > 0 && q.inRange, `query.engage shape (pk ${q.pk}, tti ${q.tti})`);
ok(sim.query.bestLauncher(h1.id) === 'L1' || sim.query.bestLauncher(h1.id) === 'L2', 'bestLauncher picks a Lance at ~20 km');
ok(sim.cmd.interrogate(h1.id) && h1.iff === 'PENDING' && E('IFF_SENT').length === 1, 'interrogate → PENDING + IFF_SENT');
sim.step();
ok(!sim.cmd.interrogate(h1.id), 'no re-interrogate while pending');
until(() => E('IFF_RESULT').length, 3);
ok(E('IFF_RESULT').length === 1 && Math.abs(E('IFF_RESULT')[0].t - E('IFF_SENT')[0].t - 1.5) < 0.11, 'IFF_RESULT ~1.5 s later');
ok(sim.cmd.classify(h1.id, 'HOSTILE') && h1.cls === 'HOSTILE' && last('CLASSIFIED').p.cls === 'HOSTILE', 'classify HOSTILE');
ok(sim.cmd.fire(h1.id) && E('LAUNCH').length === 1 && S().battery.launchers[0].rounds === 3, 'TIGHT allows HOSTILE → LAUNCH');
ok(last('LOCK').p.on === false, 'LOCK off on fire');
ok(S().stats.reactionTimes.length === 1 && S().stats.reactionTimes[0] > 0, 'reaction time recorded');
const L0 = E('LAUNCH')[0].p;
ok(Math.hypot(L0.x, L0.y) <= 0.15, 'LAUNCH position within 0.15 km');
sim.step();
ok(S().missiles.length === 1 && S().missiles[0].phase === 'boost' && h1.engagedBy[0] === S().missiles[0].id, 'missile in flight, engagedBy set');
ok(S().visible.some(v => v.kind === 'missile_lance' && /^M\d+$/.test(v.id)), 'missile in state.visible');
until(() => E('KILL').length || E('MISS').length, 60);
const tI = E('INTERCEPT')[0], tR = (E('KILL')[0] || E('MISS')[0]);
ok(tI && tR && E('LAUNCH')[0].t < tI.t && tI.t <= tR.t, 'LAUNCH → INTERCEPT → KILL/MISS' + (E('KILL').length ? ' (kill)' : ' (miss)'));
if (E('KILL').length) {
  ok(E('KILL')[0].p.wasFriend === false && E('KILL')[0].p.trackId === h1.id, 'KILL payload trackId/wasFriend');
  sim.step();
  ok(S().visible.some(v => v.burning) || Math.hypot(E('KILL')[0].p.x, E('KILL')[0].p.y) > RS.VISIBLE_KM, 'burning debris visible (if near)');
}
ok(sim.cmd.reload('L1') && last('RELOAD_START').p.seconds === 50 && !S().battery.launchers[0].ready, 'manual reload starts (50 s)');
until(() => E('RELOAD_DONE').length, 55);
ok(S().battery.launchers[0].rounds === 4 && S().battery.reserve.lance === 0 && S().battery.launchers[0].ready, 'reload refills from reserve');
const fr2 = S().tracks.find(t => t.id === fr.id);
ok(fr2 && sim.cmd.classify(fr2.id, 'FRIEND') && fr2.priority <= 5, 'classified FRIEND → priority ~0');
S().shift.roe = 'FREE';
sim.cmd.assign(fr2.id, 'L2');
ok(!sim.cmd.fire(fr2.id) && last('FIRE_REJECTED').p.reason === 'classified_friend', 'classified FRIEND always rejected');
ok(sim.cmd.assign(fr2.id, null) && last('ASSIGNED').p.launcherId === null && !fr2.assigned, 'assign null clears');
const h2 = S().tracks.find(t => t.id !== fr.id && t.cls === 'UNKNOWN');
ok(!!h2, 'second hostile tracked');
sim.cmd.setDoctrine('SALVO');
sim.cmd.assign(h2.id, 'L1');
const nL = E('LAUNCH').length;
ok(sim.cmd.fire(h2.id), 'FREE allows UNKNOWN');
until(() => E('LAUNCH').length >= nL + 2, 1);
ok(E('LAUNCH').length === nL + 2 && Math.abs(E('LAUNCH')[nL + 1].t - E('LAUNCH')[nL].t - 0.4) < 0.06, 'SALVO fires 2, staggered 0.4 s');
ok(S().battery.launchers[0].rounds === 2 && !sim.cmd.reload('L1'), 'reserve exhaustion blocks reload');
ok(!sim.cmd.fire('T999') && last('FIRE_REJECTED').p.reason === 'no_track', 'fire unknown → no_track');
until(() => S().missiles.length === 0, 60);

console.log('IFF truth table (400 trials)');
const iffDef = shiftDef('FX_IFF', [
  { t: 0, kind: K.JET_FRIEND, x: 0, y: 15, alt: 5000, hdg: 90, spd: 220, orbit: { cx: 0, cy: 15, r: 2 } },
  { t: 0, kind: K.JET_FRIEND, x: 0, y: -15, alt: 5000, hdg: 90, spd: 220, orbit: { cx: 0, cy: -15, r: 2 }, iffBroken: true },
  { t: 0, kind: K.JET_HOSTILE, x: 30, y: 0, alt: 6000, hdg: 270, spd: 250 }]);
const cnt = { f: {}, b: {}, h: {} }; let trials = 0;
for (let i = 0; i < 400; i++) {
  run(iffDef, 1000 + i);
  if (!until(() => S().tracks.length >= 3, 40)) continue;
  const ids = { f: trackNear(0, 15, 5), b: trackNear(0, -15, 5), h: S().tracks.find(t => t.x > 10) };
  if (!ids.f || !ids.b || !ids.h) continue;
  for (const k in ids) sim.cmd.interrogate(ids[k].id);
  until(() => E('IFF_RESULT').length >= 3, 2);
  for (const k in ids) { const r = E('IFF_RESULT').find(e => e.p.id === ids[k].id); if (r) cnt[k][r.p.result] = (cnt[k][r.p.result] || 0) + 1; }
  trials++;
}
const fr_ = (k, r) => (cnt[k][r] || 0) / trials;
ok(trials >= 380, `IFF trials completed (${trials})`);
ok(Math.abs(fr_('f', 'FRIEND') - 0.95) < 0.035 && fr_('f', 'FRIEND') + fr_('f', 'NO_RESPONSE') === 1, `friendly → FRIEND ${fr_('f', 'FRIEND').toFixed(3)} (p .95)`);
ok(Math.abs(fr_('h', 'NO_RESPONSE') - 0.85) < 0.05 && fr_('h', 'NO_RESPONSE') + fr_('h', 'INVALID') === 1, `hostile → NO_RESPONSE ${fr_('h', 'NO_RESPONSE').toFixed(3)} (p .85)`);
ok(fr_('b', 'NO_RESPONSE') === 1, 'iffBroken friend → NO_RESPONSE always');
run(iffDef, 5); until(() => S().tracks.length >= 1, 20); sim.cmd.radar(false);
ok(!sim.cmd.interrogate(S().tracks[0].id), 'interrogate rejected with radar OFF');

console.log('fratricide');
run(shiftDef('FX_FRAT', [{ t: 0, kind: K.JET_FRIEND, x: 0, y: 12, alt: 4000, hdg: 90, spd: 200, orbit: { cx: 0, cy: 12, r: 2 } }], { roe: 'FREE' }), 3);
until(() => S().tracks.length, 20);
const ft = S().tracks[0];
sim.cmd.assign(ft.id, 'L1');
for (let k = 0; k < 4 && !E('KILL').length; k++) {
  until(() => S().battery.launchers[0].ready, 60);
  sim.cmd.fire(ft.id);
  until(() => E('KILL').length || E('MISS').length > k, 40);
}
ok(E('KILL').length === 1 && E('KILL')[0].p.wasFriend === true, 'KILL of friend wasFriend=true');
ok(E('FRATRICIDE').length === 1 && S().stats.fratricide && S().shift.failed, 'FRATRICIDE + stats.fratricide + shift.failed');
ok(E('ALARM').some(a => a.p.kind === 'fratricide' && a.p.on), 'ALARM fratricide');
until(() => E('SHIFT_END').length, 6);
const se = E('SHIFT_END')[0];
ok(se && se.p.grade === 'F' && se.p.failed === true && Math.abs(se.t - E('KILL')[0].t - 4) < 0.2, 'SHIFT_END ~4 s later, grade F failed');

console.log('ARMs (50 + 50 seeded trials)');
const armDef = shiftDef('FX_ARM', [{ t: 0, kind: K.JET_HOSTILE, x: 0, y: 70, alt: 6000, hdg: 180, spd: 250, armCarrier: true }]);
let onHits = 0, offHits = 0, inb = 0;
for (let i = 0; i < 100; i++) {
  const radarOff = i >= 50;
  run(armDef, 77 + i);
  until(() => E('ARM_INBOUND').length, 130);
  if (!E('ARM_INBOUND').length) continue;
  inb++;
  if (i === 0) ok(E('ARM_INBOUND')[0].t > 90 && S().radar.armEta > 0 && E('ALARM').some(a => a.p.kind === 'arm' && a.p.on), 'ARM_INBOUND after 90 s emission, armEta set, ALARM arm');
  if (radarOff) sim.cmd.radar(false);
  until(() => S().radar.armEta === null, 120);
  if (E('ARM_IMPACT').length) radarOff ? offHits++ : onHits++;
  if (i === 0) ok(E('ARM_IMPACT').length === 1 && S().radar.health < 1, `ARM_IMPACT with radar on (health ${S().radar.health})`);
}
ok(inb === 100, `ARM launched in every trial (${inb})`);
ok(onHits >= 48 && offHits <= 20, `impact rate radar on ${onHits}/50 vs off ${offHits}/50`);
// radar forced down by low health
run(armDef, 9); S().radar.health = 0.4;
until(() => E('ARM_IMPACT').length, 200);
ok(S().radar.health < 0.3 && !S().radar.on && !sim.cmd.radar(true) && E('ALARM').some(a => a.p.kind === 'radar' && a.p.on), 'health < .3 → radar forced off');
until(() => sim.cmd.radar(true), 31);
ok(S().radar.on && S().t - E('ARM_IMPACT')[0].t >= 29.9, 'radar usable again after 30 s');

console.log('jamming');
run(shiftDef('FX_JAM', [
  { t: 0, kind: K.JET_HOSTILE, x: 35.4, y: 35.4, alt: 7000, hdg: 225, spd: 200, jammer: true },
  { t: 0, kind: K.JET_HOSTILE, x: 17.7, y: 17.7, alt: 3000, hdg: 225, spd: 150 }]), 4);
until(() => S().tracks.some(t => t.strobe), 30);
ok(S().radar.jam > 0.3 && Math.abs(S().radar.jamBearing - 45) <= 2, `radar.jam ${S().radar.jam} bearing ${S().radar.jamBearing}`);
ok(E('JAMMING').length >= 1 && E('JAMMING')[0].p.level >= 0.1, 'JAMMING emitted');
ok(S().tracks.some(t => t.strobe && Math.abs(t.bearingDeg - 45) < 10), 'track on jam bearing has strobe');

console.log('strike / cruise / gun');
run(shiftDef('FX_STRIKE', [
  { t: 0, kind: K.JET_HOSTILE, x: 0, y: 20, alt: 1000, hdg: 180, spd: 250, strike: true },
  { t: 0, kind: K.CRUISE, x: 15, y: 0, alt: 50, hdg: 270, spd: 250 },
  { t: 0, kind: K.DRONE, x: -4.5, y: 0, alt: 500, hdg: 90, spd: 40, count: 3, spread: 0.3 },
  { t: 0, kind: K.HELO_HOSTILE, x: 0, y: -7, alt: 200, hdg: 0, spd: 60, popup: { hideAlt: 60, atKm: 5.5 } }], { roe: 'FREE' }), 6);
until(() => S().tracks.some(t => t.rangeKm < 3.4 && t.bearingDeg > 250 && t.bearingDeg < 290), 30);
const dr = S().tracks.find(t => t.rangeKm < 3.4 && t.bearingDeg > 250 && t.bearingDeg < 290);
sim.cmd.setDoctrine('SHOOT_LOOK_SHOOT');
ok(dr && sim.cmd.assign(dr.id, 'G1') && sim.cmd.fire(dr.id), 'gun fires at drone');
const gf = last('GUN_FIRE');
ok(gf && gf.p.rounds === 40 && S().gun.firing && S().gun.targetId === dr.id && S().battery.launchers[3].rounds === 560, 'GUN_FIRE rounds 40, state.gun.firing');
until(() => E('KILL').length || E('MISS').length, 1);
ok((E('KILL').length || E('MISS').length) && Math.abs((E('KILL')[0] || E('MISS')[0]).t - gf.t - 0.6) < 0.06, 'gun result after 0.6 s');
until(() => !S().gun.firing, 2);
ok(!S().gun.firing && Math.abs(S().t - gf.t - 1.5) < 0.1, 'gun firing lasts 1.5 s');
let heloMaxAlt = 0, heloHidden = true;
until(() => { const v = S().visible.find(x => x.kind === K.HELO_HOSTILE); if (v) { heloMaxAlt = Math.max(heloMaxAlt, v.alt); if (Math.hypot(v.x, v.y) > 5.6 && v.alt >= 60) heloHidden = false; } return E('ASSET_HIT').length >= 2; }, 90);
ok(E('ASSET_HIT').length >= 2 && S().asset.hp < 1, `ASSET_HIT from strike + cruise (hp ${S().asset.hp})`);
ok(E('ASSET_HIT').some(a => a.p.damage === 0.25), 'cruise damage .25');
ok(E('ASSET_HIT').some(a => a.p.damage >= 0.15 && a.p.damage <= 0.3 && a.p.damage !== 0.25), 'strike release damage .15–.3');
ok(heloHidden && heloMaxAlt > 60, `popup helo climbs inside atKm (max alt ${heloMaxAlt.toFixed(0)})`);
const strikeHit = E('ASSET_HIT').find(a => a.p.damage >= 0.15 && a.p.damage <= 0.3 && a.p.damage !== 0.25);
const sid = strikeHit && strikeHit.p.byId;
until(() => false, 25);
const stTr = S().tracks.find(t => t.id === sid);
ok(stTr && stTr.closure < 0 && stTr.rangeKm > 6, `strike jet egresses after release (${sid} closure ${stTr && stTr.closure}, ${stTr && stTr.rangeKm} km)`);
until(() => E('TRACK_LOST').some(e => e.p.id === sid) || !S().shift.running, 600);
ok(E('TRACK_LOST').some(e => e.p.id === sid && e.p.reason === 'exited'), 'strike jet leaves the map → TRACK_LOST exited');

console.log('lowammo');
run(shiftDef('FX_AMMO', [], { reserve: { lance: 0, dart: 0, harrow: 0 } }), 2);
S().battery.launchers.forEach(L => { if (L.weapon !== 'harrow') L.rounds = 1; });
sim.step();
ok(E('ALARM').some(a => a.p.kind === 'lowammo' && a.p.on), 'ALARM lowammo when SAM rounds ≤ 3');
S().battery.launchers[0].rounds = 0; sim.step();
ok(!sim.cmd.reload('L1') && !E('RELOAD_START').length, 'empty launcher + empty reserve cannot reload');

console.log('payload exact shapes (all events this run)');
const SHAPE = {
  SIM_TICK: ['t', 'dt'], TRACK_NEW: ['id', 'track'], TRACK_LOST: ['id', 'reason'], TRACK_SELECTED: ['id'], IFF_SENT: ['id'],
  IFF_RESULT: ['id', 'result'], CLASSIFIED: ['id', 'cls'], ASSIGNED: ['id', 'weapon', 'launcherId'],
  LAUNCH: ['missileId', 'weapon', 'launcherId', 'targetId', 'x', 'y', 'alt'], GUN_FIRE: ['launcherId', 'targetId', 'burst', 'bearingDeg', 'elevDeg', 'rounds'],
  INTERCEPT: ['missileId', 'targetId', 'x', 'y', 'alt'], MISS: ['missileId', 'targetId'], KILL: ['targetId', 'weapon', 'wasFriend', 'x', 'y', 'alt', 'trackId'],
  FRATRICIDE: ['targetId'], RELOAD_START: ['launcherId', 'seconds'], RELOAD_DONE: ['launcherId'], RADAR_STATE: ['on'], RADAR_WARN: ['seconds'],
  JAMMING: ['level', 'bearing'], ARM_INBOUND: ['id', 'eta'], ARM_IMPACT: ['damage'], ASSET_HIT: ['byId', 'damage'], LEAKER: ['id'],
  ROE_CHANGE: ['roe'], COMMS: ['from', 'text', 'priority', 'id', 'needsAck'], ALARM: ['kind', 'on'], RANDOM_EVENT: ['kind', 'active', 'detail'],
  SHIFT_START: ['def'], SHIFT_END: ['grade', 'failed', 'reason', 'stats'], FIRE_REJECTED: ['id', 'reason'], LOCK: ['id', 'launcherId', 'on']
};
const REJ = ['roe_hold', 'roe_tight_not_hostile', 'classified_friend', 'not_assigned', 'not_ready', 'no_rounds', 'out_of_range', 'too_close', 'radar_off', 'jammed', 'no_track'];
const ALARMS = ['arm', 'leaker', 'fratricide', 'asset', 'lowammo', 'radar'];
const shapeBad = new Set(), seen = new Set();
for (const n in events) for (const e of events[n]) {
  seen.add(n);
  const want = SHAPE[n]; if (!want) continue;
  const got = Object.keys(e.p);
  if (got.length !== want.length || want.some(f => !(f in e.p) || e.p[f] === undefined)) shapeBad.add(n + ':' + got.join(','));
  if (n === 'FIRE_REJECTED' && !REJ.includes(e.p.reason)) shapeBad.add('FIRE_REJECTED.reason=' + e.p.reason);
  if (n === 'ALARM' && !ALARMS.includes(e.p.kind)) shapeBad.add('ALARM.kind=' + e.p.kind);
  if (n === 'TRACK_LOST' && !['faded', 'killed', 'landed', 'exited'].includes(e.p.reason)) shapeBad.add('TRACK_LOST.reason=' + e.p.reason);
}
ok(shapeBad.size === 0, 'every payload has exactly the contract fields' + (shapeBad.size ? ' BAD ' + [...shapeBad].join(' | ') : ''));
const missing = Object.keys(SHAPE).filter(n => !seen.has(n) && !/^UI_/.test(n));
ok(missing.length === 0, 'every sim event exercised' + (missing.length ? ' (missing ' + missing + ')' : ''));
const st = sim.state;
ok(['reserve'].every(k => k in st.battery) && 'gun' in st && 'armEta' in st.radar && 'failed' in st.shift && Array.isArray(st.comms), 'Run B state fields present');

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
