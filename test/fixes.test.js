/* RED SKIES — V1.4.3 regression tests for the sim fixes. node test/fixes.test.js  (exit 1 on failure)
   Each case builds a tiny ShiftDef and drives the real sim headless (fresh vm context per case). */
const fs = require('fs'), path = require('path'), vm = require('vm');
const src = f => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');

function fresh(files) {
  const ctx = { console: { log() {}, error: (...a) => console.error(...a), warn() {} }, Math, JSON, Object, Array, String, Number, isFinite };
  ctx.window = ctx; ctx.globalThis = ctx; ctx.RS = {};
  vm.createContext(ctx);
  for (const f of files || ['contracts.js', 'content.js', 'campaign.js', 'sim.js']) vm.runInContext(src(f), ctx, { filename: f });
  const RS = ctx.window.RS, ev = {};
  for (const n of RS.EV) RS.bus.on(n, p => (ev[n] = ev[n] || []).push({ t: RS.sim.state.t, p }));
  const E = n => ev[n] || [];
  const steps = s => { for (let i = 0; i < Math.round(s * RS.SIM_HZ); i++) RS.sim.step(); };
  const until = (fn, maxS) => { for (let i = 0; i < maxS * RS.SIM_HZ && !fn(); i++) RS.sim.step(); return fn(); };
  return { RS, E, steps, until, S: () => RS.sim.state };
}
const def = (spawns, extra) => Object.assign({ id: 'TST', name: 'Test', duration: 900, roe: 'FREE', spawns, comms: [] }, extra || {});

let fails = 0, checks = 0;
const ok = (c, m) => { checks++; console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fails++; };

/* ---------- 1. SALVO: the queued second round re-checks ROE / FRIEND / assignment / radar ---------- */
console.log('salvo second round');
function salvo(action) {
  const g = fresh(), { RS, E, S } = g;
  RS.sim.init({ content: RS.content, seed: 7 });
  RS.sim.startShift(def([{ t: 0, kind: 'jet_hostile', x: 0, y: 18, alt: 3000, hdg: 90, spd: 200 }]));
  RS.sim.cmd.radar(true);
  g.until(() => S().tracks.length, 30);
  const id = S().tracks[0].id;
  RS.sim.cmd.classify(id, 'HOSTILE'); RS.sim.cmd.setDoctrine(RS.DOCTRINE.SALVO); RS.sim.cmd.assign(id, 'L3');
  const fired = RS.sim.cmd.fire(id);
  g.steps(0.5);
  if (action === 'friend') RS.sim.cmd.classify(id, 'FRIEND');
  if (action === 'radar') RS.sim.cmd.radar(false);
  if (action === 'hold') S().shift.roe = 'HOLD';
  if (action === 'unassign') RS.sim.cmd.assign(id, null);
  g.steps(3);
  return { fired, launches: E('LAUNCH').filter(e => e.p.launcherId === 'L3').length };
}
const base = salvo(null);
ok(base.fired && base.launches === 2, `control: SALVO launches 2 (${base.launches})`);
for (const a of ['friend', 'radar', 'hold', 'unassign']) {
  const r = salvo(a);
  ok(r.fired && r.launches === 1, `second round cancelled after ${a} (${r.launches} launched)`);
}

/* ---------- 2. ARM_INBOUND names the ARM's TRACK once it is on the scope ---------- */
console.log('ARM_INBOUND ids');
{
  const g = fresh(), { RS, E, S } = g;
  RS.sim.init({ content: RS.content, seed: 3 });
  RS.sim.startShift(def([{ t: 0, kind: 'jet_hostile', armCarrier: true, x: 5, y: 40, alt: 7000, hdg: 180, spd: 120 }]));
  RS.sim.cmd.radar(true);
  g.until(() => E('ARM_INBOUND').some(e => e.p.tracked), 160);
  const a = E('ARM_INBOUND');
  ok(a.length >= 1 && a[0].p.id === null && a[0].p.tracked === false && a[0].p.eta > 0, 'launch warning: id null, tracked false, eta set');
  const tr = a.find(e => e.p.tracked);
  ok(!!tr && /^T\d+$/.test(tr.p.id) && RS.sim.debugTruth(tr.p.id) === 'arm_missile', `tracked ARM id is its track (${tr && tr.p.id})`);
  ok(a.every(e => !/^E/.test(String(e.p.id))), 'no entity ids leak through ARM_INBOUND');
}

/* ---------- 3. Pop-up helicopters stay hidden until atKm, then climb ---------- */
console.log('pop-up helos');
{
  const g = fresh(), { RS, E, S } = g;
  RS.sim.init({ content: RS.content, seed: 5 });
  RS.sim.startShift(def([{ t: 0, kind: 'helo_hostile', x: 26, y: 0, alt: 40, hdg: 270, spd: 65, popup: { hideAlt: 60, atKm: 10 } }]));
  RS.sim.cmd.radar(true);
  g.until(() => S().tracks.length, 500);
  const tr = S().tracks[0], tt = S().t;
  ok(!!tr && tr.rangeKm <= 10.5, `first tracked inside atKm (${tr && tr.rangeKm.toFixed(1)} km)`);
  ok(!!tr && tt <= 60, `pops up soon after its spawn time, not minutes later (${tt.toFixed(0)} s)`);
  let maxAlt = 0;
  for (let i = 0; i < 20 * 20; i++) { RS.sim.step(); const t = S().tracks[0]; if (t) maxAlt = Math.max(maxAlt, t.alt); }
  ok(maxAlt > 100, `climbs after popping up (max ${Math.round(maxAlt)} m)`);
}

/* ---------- 4. Corridor friendlies spawned past waypoint 0 fly home, not outbound ---------- */
console.log('corridor join');
{
  const g = fresh(), { RS, S } = g;
  const AB = RS.content.airbase, RTB_EAST = [[40, 30], [18, 10], [4, -6], AB];
  RS.sim.init({ content: RS.content, seed: 9 });
  RS.sim.startShift(def([{ t: 0, kind: 'helo_friend', callsign: 'Angel 5', x: 30, y: 22, alt: 250, hdg: 230, spd: 60, corridor: RTB_EAST }], { roe: 'TIGHT' }));
  RS.sim.cmd.radar(true);
  g.until(() => S().tracks.length, 30);
  const d = () => { const t = S().tracks[0]; return t ? Math.hypot(t.x - AB[0], t.y - AB[1]) : NaN; };
  const d0 = d(); g.steps(120); const d1 = d();
  ok(d1 < d0 - 5, `closes on the airbase (${d0.toFixed(1)} → ${d1.toFixed(1)} km in 120 s)`);
}

/* ---------- 5. Two reloads cannot promise the same reserve rounds ---------- */
console.log('shared reserve');
{
  const g = fresh(), { RS, E, S } = g;
  RS.sim.init({ content: RS.content, seed: 1 });
  RS.sim.startShift(def([], { reserve: { lance: 3, dart: 8, harrow: 1200 } }));
  const L = id => S().battery.launchers.find(l => l.id === id);
  L('L1').rounds = 1; L('L2').rounds = 0;
  const r1 = RS.sim.cmd.reload('L1'), r2 = RS.sim.cmd.reload('L2');
  ok(r1 === true && r2 === false, `L1 reloads, L2 refused while L1 holds the last 3 rounds (${r1}/${r2})`);
  g.steps(52);
  ok(L('L1').rounds === 4 && L('L2').rounds === 0 && S().battery.reserve.lance === 0, `after reload: L1 ${L('L1').rounds}, L2 ${L('L2').rounds}, reserve ${S().battery.reserve.lance}`);
  ok(E('RELOAD_DONE').every(e => e.p.launcherId !== 'L2'), 'no RELOAD_DONE for the launcher that got nothing');
  S().battery.reserve.lance += 8;                                   // late resupply
  g.steps(1);
  ok(L('L2').reloadT > 0, 'the empty launcher starts reloading once reserve is free again');
  g.steps(52);
  ok(L('L2').rounds === 4 && S().battery.reserve.lance === 4, `L2 reloaded from the resupply (L2 ${L('L2').rounds}, reserve ${S().battery.reserve.lance})`);
}

/* ---------- 6. SHIFT_END.grade matches the debrief grade (RS.campaign.grade) ---------- */
console.log('SHIFT_END grade');
{
  const g = fresh(), { RS, E, S } = g;
  RS.sim.init({ content: RS.content, seed: 2 });
  // 7 non-strike jets leak past the defended line with the asset untouched: the old sim rule said F, the debrief says C
  RS.sim.startShift(def([0, 50, 100, 150, 200, 250, 300].map(b => ({ t: 0, kind: 'jet_hostile', x: 12 * Math.sin(b * Math.PI / 180), y: 12 * Math.cos(b * Math.PI / 180), alt: 2000, hdg: (b + 180) % 360, spd: 250 })), { duration: 150 }));
  g.until(() => E('SHIFT_END').length, 200);
  const p = (E('SHIFT_END')[0] || {}).p;
  const want = p && RS.campaign.grade(p.stats, S()).grade;
  ok(!!p && p.grade === want, `SHIFT_END.grade ${p && p.grade} = campaign.grade ${want}`);
}
{
  const g = fresh(['contracts.js', 'content.js', 'sim.js']), { RS, E } = g;    // sim alone (no campaign.js): still grades
  RS.sim.init({ content: RS.content, seed: 2 });
  RS.sim.startShift(def([], { duration: 10 }));
  g.until(() => E('SHIFT_END').length, 30);
  ok(/^[ABCDF]$/.test((E('SHIFT_END')[0] || { p: {} }).p.grade), 'sim-only fallback grade still works');
}

console.log(fails ? `${fails}/${checks} FAILED` : `fixes.test: ${checks}/${checks} checks passed`);
process.exit(fails ? 1 : 0);
