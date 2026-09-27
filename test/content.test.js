/* RED SKIES — content schema test. node test/content.test.js  (exit 1 on failure) */
const fs = require('fs'), path = require('path'), vm = require('vm');
const src = f => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
const ctx = { console, Math, JSON, Object, Array, String, Number };
ctx.window = ctx; ctx.globalThis = ctx; ctx.RS = {};
vm.createContext(ctx);
for (const f of ['contracts.js', 'content.js']) vm.runInContext(src(f), ctx, { filename: f });
const RS = ctx.window.RS, C = RS.content;

let fails = 0, checks = 0;
const errs = [];
const ok = (c, m) => { checks++; if (!c) { fails++; if (errs.length < 40) errs.push(m); } };
const fin = v => typeof v === 'number' && Number.isFinite(v);
const KINDS = Object.values(RS.KIND), ROES = Object.values(RS.ROE), REV = Object.values(RS.RANDOM_EVENT);
const FRIEND = [RS.KIND.JET_FRIEND, RS.KIND.STRIKE_FRIEND, RS.KIND.TRANSPORT, RS.KIND.HELO_FRIEND];

// weapons — exact numbers shared with the sim
const W = {
  lance: { minKm: 3, maxKm: 40, maxAlt: 20000, spd: 1100, pkBase: 0.8, reloadS: 50, perLauncher: 4, kind: 'sam', label: 'Lance' },
  dart: { minKm: 1, maxKm: 20, maxAlt: 10000, spd: 1000, pkBase: 0.8, reloadS: 15, perLauncher: 4, kind: 'sam', label: 'Dart' },
  harrow: { kind: 'gun', minKm: 0, maxKm: 4, maxAlt: 4000, roundsPerBurst: 40, pkPerBurst: 0.6, reloadS: 30, perLauncher: 600, label: 'Harrow' } };
for (const w in W) for (const k in W[w]) ok(C.weapons[w] && C.weapons[w][k] === W[w][k], `weapons.${w}.${k} = ${W[w][k]}`);
ok(JSON.stringify(C.reserve) === JSON.stringify({ lance: 8, dart: 8, harrow: 1200 }), 'reserve');

// threats
for (const k of KINDS) {
  const t = C.threats[k];
  ok(!!t, 'threat ' + k); if (!t) continue;
  ok(t.pkMod && ['lance', 'dart', 'harrow'].every(w => fin(t.pkMod[w]) && t.pkMod[w] > 0), k + ' pkMod');
  ok(fin(t.maneuver) && t.maneuver >= 0 && t.maneuver <= 1, k + ' maneuver');
  ok(typeof t.armCapable === 'boolean' && typeof t.jammer === 'boolean', k + ' flags');
  ok(t.altBand.length === 2 && t.spdBand.length === 2 && fin(t.rcs), k + ' bands');
}
const pk = (k, a) => JSON.stringify(C.threats[k].pkMod) === JSON.stringify({ lance: a[0], dart: a[1], harrow: a[2] });
ok(pk('drone', [.6, .9, 1.3]) && pk('cruise_missile', [.8, .9, 1]) && pk('helo_hostile', [.7, 1, 1]) && pk('jet_hostile', [1, 1, .3]) && pk('arm_missile', [.5, .8, .9]), 'pkMod defaults');

function checkShift(s, tag) {
  ok(typeof s.id === 'string' && typeof s.name === 'string', tag + ' id/name');
  ok(fin(s.duration) && s.duration > 0 && ROES.includes(s.roe), tag + ' duration/roe');
  if (s.reserve) ok(['lance', 'dart', 'harrow'].every(w => fin(s.reserve[w]) && s.reserve[w] >= 0), tag + ' reserve');
  for (const rc of s.roeChanges || []) ok(fin(rc.t) && rc.t >= 0 && rc.t <= s.duration && ROES.includes(rc.roe), tag + ' roeChange ' + JSON.stringify(rc));
  for (const e of s.events || []) ok(fin(e.t) && fin(e.duration) && REV.includes(e.kind), tag + ' event ' + JSON.stringify(e));
  for (const c of s.comms) ok(fin(c.t) && ['HQ', 'CAP', 'TOWER', 'BATTERY'].includes(c.from) && typeof c.text === 'string' && c.text.length > 0 &&
    ['low', 'normal', 'high'].includes(c.priority) && (c.needsAck === undefined || c.needsAck === true), tag + ' comm ' + JSON.stringify(c));
  if ((s.roeChanges || []).length) ok(s.comms.some(c => c.needsAck), tag + ' roe change has needsAck order');
  s.spawns.forEach((p, i) => {
    const m = `${tag} spawn#${i} ${p.kind}`;
    ok(KINDS.includes(p.kind), m + ' kind');
    ok(['t', 'x', 'y', 'alt', 'hdg', 'spd'].every(f => fin(p[f])), m + ' numbers finite');
    ok(p.t >= 0 && p.t < s.duration && Math.hypot(p.x, p.y) <= 80 && p.alt >= 0 && p.alt < 20000 && p.hdg >= 0 && p.hdg < 360 && p.spd > 0, m + ' ranges');
    if (p.corridor) ok(p.corridor.length >= 2 && p.corridor.every(w => w.length === 2 && fin(w[0]) && fin(w[1]) && Math.hypot(w[0], w[1]) <= 80), m + ' corridor in km');
    if (p.orbit) ok(fin(p.orbit.cx) && fin(p.orbit.cy) && fin(p.orbit.r) && Math.hypot(p.orbit.cx, p.orbit.cy) + p.orbit.r <= 40, m + ' orbit within 40 km');
    if (p.popup) ok(fin(p.popup.hideAlt) && fin(p.popup.atKm) && p.alt <= p.popup.hideAlt, m + ' popup');
    if (p.count !== undefined) ok(Number.isInteger(p.count) && p.count >= 1 && fin(p.spread) && p.spread > 0 && p.spread < 10, m + ' count/spread');
    for (const f of ['iffBroken', 'jammer', 'armCarrier', 'strike']) if (p[f] !== undefined) ok(p[f] === true, m + ' ' + f + ' is true');
    if (p.group !== undefined) ok(typeof p.group === 'string', m + ' group');
    if (p.jammer || p.armCarrier || p.strike || p.popup || p.count > 1) ok(!FRIEND.includes(p.kind), m + ' hostile-only flag on hostile');
    if (p.iffBroken) {
      ok(FRIEND.includes(p.kind), m + ' iffBroken only on friendlies');
      ok(typeof p.callsign === 'string' && s.comms.some(c => c.t < p.t && c.text.includes(p.callsign) && /IFF/.test(c.text)),
        m + ` iffBroken ${p.callsign} announced on radio before t=${p.t}`);
    }
  });
}

const s0 = C.shifts[0];
checkShift(s0, 'S0');
ok(s0.name === 'Shift 0: Kessel Range Check' && s0.duration === 480 && s0.roe === 'TIGHT', 'S0 header');
const has = f => s0.spawns.some(f);
ok(has(p => p.iffBroken && p.callsign === 'Hammer 2' && p.corridor), 'S0 Hammer 2 iffBroken on corridor');
ok(s0.comms.some(c => c.text === 'Hammer 2, IFF inop, egressing sector 2 via north corridor.'), 'S0 Hammer 2 call');
ok(has(p => p.kind === 'transport' && p.corridor) && has(p => p.strike) && has(p => p.jammer) && has(p => p.popup), 'S0 transport/strike/jammer/popup');
ok(has(p => p.armCarrier && p.t >= 170), 'S0 ARM carrier after ~3 min');
ok(has(p => p.kind === 'drone' && p.count === 6 && p.spread === 2), 'S0 drone swarm 6 / 2 km');
ok(s0.spawns.filter(p => p.kind === 'cruise_missile' && p.alt < 100).length >= 2, 'S0 low cruise pair');
ok(JSON.stringify(s0.roeChanges) === JSON.stringify([{ t: 300, roe: 'FREE' }, { t: 390, roe: 'TIGHT' }]), 'S0 roe TIGHT→FREE 5:00 → TIGHT 6:30');
ok(s0.spawns.every((p, i, a) => !i || a[i - 1].t <= p.t), 'S0 spawns sorted');

let flags = { iffBroken: 0, jammer: 0, armCarrier: 0, popup: 0, swarm: 0 };
for (const d of [0, 0.5, 1]) for (let seed = 1; seed <= 20; seed++) {
  const a = C.makeFreeShift(seed, d), b = C.makeFreeShift(seed, d);
  checkShift(a, `F${seed}@${d}`);
  ok(JSON.stringify(a) === JSON.stringify(b), `F${seed}@${d} deterministic`);
  if (d === 1) for (const p of a.spawns) { for (const f of ['iffBroken', 'jammer', 'armCarrier', 'popup']) if (p[f]) flags[f]++; if (p.count > 2) flags.swarm++; }
}
ok(JSON.stringify(C.makeFreeShift(1, 0.5)) !== JSON.stringify(C.makeFreeShift(2, 0.5)), 'different seeds differ');
ok(Object.values(flags).every(n => n > 0), 'difficulty 1 uses every new flag ' + JSON.stringify(flags));
const cnt = d => { let n = 0; for (let s = 1; s <= 20; s++) n += C.makeFreeShift(s, d).spawns.filter(p => !FRIEND.includes(p.kind)).length; return n; };
ok(cnt(1) > cnt(0), `hostiles scale with difficulty (${cnt(0)} → ${cnt(1)})`);
ok(typeof C.mulberry32 === 'function' && Array.isArray(C.airbase), 'legacy exports');

errs.forEach(e => console.log('  FAIL ' + e));
console.log(fails ? `\n${fails}/${checks} FAILED` : `\nALL PASS (${checks} checks)`);
process.exit(fails ? 1 : 0);
