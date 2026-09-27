/* RED SKIES — campaign + grading test. node test/campaign.test.js  (exit 1 on failure) */
const fs = require('fs'), path = require('path'), vm = require('vm');
const src = f => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
const ctx = { console, Math, JSON, Object, Array, String, Number, isFinite };
ctx.window = ctx; ctx.globalThis = ctx; ctx.RS = {};
vm.createContext(ctx);
for (const f of ['contracts.js', 'content.js', 'campaign.js', 'sim.js']) vm.runInContext(src(f), ctx, { filename: f });
const RS = ctx.window.RS, CP = RS.campaign;

let fails = 0, checks = 0;
const ok = (c, m) => { checks++; if (!c) { fails++; console.log('  FAIL ' + m); } };
const fin = v => typeof v === 'number' && Number.isFinite(v);
const KINDS = Object.values(RS.KIND), ROES = Object.values(RS.ROE), REV = Object.values(RS.RANDOM_EVENT);
const FRIEND = [RS.KIND.JET_FRIEND, RS.KIND.STRIKE_FRIEND, RS.KIND.TRANSPORT, RS.KIND.HELO_FRIEND];
const SPAWN_KEYS = ['t', 'kind', 'x', 'y', 'alt', 'hdg', 'spd', 'corridor', 'orbit', 'callsign', 'iffBroken', 'jammer', 'armCarrier', 'strike', 'group', 'popup', 'count', 'spread'];
const DEF_KEYS = ['id', 'name', 'duration', 'roe', 'reserve', 'roeChanges', 'events', 'spawns', 'comms'];

ok(CP && Array.isArray(CP.shifts) && CP.shifts.length === 6, '6 campaign shifts');
ok(CP.story.length === 6 && CP.budget.length === 6 && ['lance', 'dart', 'harrow'].every(w => fin(CP.prices[w]) && CP.prices[w] > 0), 'story/budget/prices');
const ids = new Set();
CP.shifts.forEach((s, i) => {
  const tag = s.id || 'shift' + i;
  ok(s.name.startsWith('Shift ' + (i + 1)), tag + ' name "Shift ' + (i + 1) + '…"');
  ok(!ids.has(s.id), tag + ' unique id'); ids.add(s.id);
  ok(Object.keys(s).every(k => DEF_KEYS.includes(k)), tag + ' only ShiftDef fields: ' + Object.keys(s));
  ok(fin(s.duration) && s.duration >= 360 && s.duration <= 540, tag + ' duration 360–540');
  ok(ROES.includes(s.roe), tag + ' roe');
  if (i > 0) ok(s.duration >= CP.shifts[i - 1].duration, tag + ' durations escalate');
  if (s.reserve) ok(['lance', 'dart', 'harrow'].every(w => fin(s.reserve[w]) && s.reserve[w] >= 0), tag + ' reserve');
  (s.roeChanges || []).forEach(r => ok(fin(r.t) && r.t < s.duration && ROES.includes(r.roe), tag + ' roeChange'));
  (s.events || []).forEach(e => ok(fin(e.t) && e.t >= 0 && e.t < s.duration && REV.includes(e.kind) && fin(e.duration) && e.duration > 0, tag + ' event ' + e.kind));
  ok(s.spawns.length >= 6, tag + ' has spawns');
  let hostiles = 0;
  for (const sp of s.spawns) {
    const st = tag + ' spawn@' + sp.t + ' ' + sp.kind;
    ok(Object.keys(sp).every(k => SPAWN_KEYS.includes(k)), st + ' keys');
    ok(KINDS.includes(sp.kind) && sp.kind !== RS.KIND.ARM, st + ' kind');
    ok(['t', 'x', 'y', 'alt', 'hdg', 'spd'].every(k => fin(sp[k])), st + ' numbers');
    ok(sp.t >= 0 && sp.t < s.duration && sp.alt >= 0 && sp.spd > 0 && sp.hdg >= 0 && sp.hdg < 360, st + ' ranges');
    ok(Math.hypot(sp.x, sp.y) <= 75, st + " spawn within 75 km");
    if (sp.orbit) ok(Math.hypot(sp.orbit.cx, sp.orbit.cy) + sp.orbit.r <= 35, st + ' CAP orbit within 35 km');
    if (sp.corridor) ok(sp.corridor.every(p => p.length === 2 && fin(p[0]) && fin(p[1])), st + ' corridor');
    if (sp.count) ok(sp.count >= 1 && sp.count <= 16 && fin(sp.spread), st + ' swarm');
    const friend = FRIEND.includes(sp.kind);
    if (friend) ok(!!sp.callsign && (sp.corridor || sp.orbit), st + ' friendly has callsign + corridor/orbit');
    else { hostiles += sp.count || 1; ok(!sp.iffBroken && !sp.callsign, st + ' hostile has no callsign/iffBroken'); }
    if (sp.iffBroken) {
      ok(friend, st + ' iffBroken only on friendlies');
      const call = s.comms.find(c => c.t < sp.t - 10 && c.text.includes(sp.callsign) && /IFF inop/.test(c.text) && /sector \d/.test(c.text) && /corridor/.test(c.text));
      ok(!!call, st + ' iffBroken ' + sp.callsign + ' radio-announced (callsign, sector, corridor) beforehand');
    }
  }
  ok(hostiles >= 4, tag + ' hostiles ' + hostiles);
  s.comms.forEach(c => ok(fin(c.t) && c.t < s.duration && ['HQ', 'CAP', 'TOWER', 'BATTERY'].includes(c.from) && typeof c.text === 'string' && ['low', 'normal', 'high'].includes(c.priority), tag + ' comms @' + c.t));
  // no scheduled radio while the comms outage is active
  (s.events || []).filter(e => e.kind === 'comms_outage').forEach(e => ok(!s.comms.some(c => c.t >= e.t && c.t < e.t + e.duration), tag + ' silent during comms outage'));
  // ROE changes announced shortly before with an ack
  (s.roeChanges || []).forEach(r => ok(s.comms.some(c => c.t < r.t && c.t >= r.t - 20 && c.needsAck), tag + ' roe change @' + r.t + ' announced with ack'));
});
const evKinds = new Set(CP.shifts.flatMap(s => (s.events || []).map(e => e.kind)));
['night', 'storm', 'radar_fault', 'comms_outage', 'launcher_jam', 'late_resupply'].forEach(k => ok(evKinds.has(k), 'campaign uses event ' + k));
ok(CP.shifts[0].comms.filter(c => /^Tip:/.test(c.text)).length >= 4, 'shift 1 has HQ hints');
ok(CP.shifts.some(s => s.spawns.some(p => p.armCarrier)) && CP.shifts[4].spawns.some(p => (p.count || 0) >= 10), 'ARM shooters + big swarms');

// each shift runs in the real sim to completion without throwing
for (const s of CP.shifts) {
  let end = null; const off = RS.bus.on('SHIFT_END', p => { end = p; });
  RS.sim.init({ content: RS.content, seed: 7 });
  RS.sim.startShift(s);
  let err = null;
  try { for (let i = 0; i < s.duration * RS.SIM_HZ + 10 && !end; i++) RS.sim.step(); } catch (e) { err = e; }
  off();
  ok(!err && end && (end.reason === 'complete' || end.failed), s.id + ' runs to end in sim (' + (end && end.reason) + ')' + (err ? ': ' + err.stack : ''));
  if (end) { const g = CP.grade(end.stats, RS.sim.state); ok('ABCDF'.includes(g.grade) && fin(g.score), s.id + ' gradeable (' + g.grade + ' ' + g.score + ')'); }
}

// grading edge cases
const G = CP.grade, st = (o) => Object.assign({ kills: 0, misses: 0, leakers: 0, fired: { lance: 0, dart: 0, harrow: 0 }, reactionTimes: [], fratricide: false }, o);
const hp = h => ({ asset: { hp: h } });
let g = G(st({ fratricide: true, kills: 10, fired: { lance: 10, dart: 0, harrow: 0 }, reactionTimes: [5] }), hp(1));
ok(g.grade === 'F' && g.failed && /ratricide/.test(g.reason), 'fratricide → F failed');
g = G(st({ kills: 10, fired: { lance: 10, dart: 0, harrow: 0 }, reactionTimes: [5] }), hp(0));
ok(g.grade === 'F' && g.failed && /asset/i.test(g.reason), 'asset hp 0 → F failed');
g = G(st({ kills: 10, fired: { lance: 8, dart: 4, harrow: 0 }, reactionTimes: [8, 12, 10] }), hp(1));
ok(g.grade === 'A' && !g.failed && g.score >= 85, 'perfect-ish shift → A (' + g.score + ')');
g = G(st({ kills: 6, leakers: 1, fired: { lance: 8, dart: 4, harrow: 0 }, reactionTimes: [30, 40] }), hp(0.8));
ok(g.grade === 'B' || g.grade === 'C', 'moderate shift → B/C (' + g.grade + ' ' + g.score + ')');
g = G(st({ kills: 1, leakers: 4, fired: { lance: 12, dart: 8, harrow: 400 }, reactionTimes: [85] }), hp(0.3));
ok(g.grade === 'F' && g.failed, 'bad shift → F (' + g.score + ')');
g = G(st({}), hp(1));
ok(g.grade === 'B' && g.parts.ammo === 50 && g.parts.reaction === 50, 'nothing fired, nothing lost → neutral B (' + g.score + ')');
g = G(st({ kills: 5, fired: { lance: 0, dart: 0, harrow: 200 }, reactionTimes: [20] }), hp(1));
ok(g.parts.ammo === 100, 'harrow counted in 40-round bursts (' + g.parts.ammo + ')');
g = G(null, null);
ok(g && 'ABCDF'.includes(g.grade), 'null input tolerated');
g = G(st({ kills: 3, fired: { lance: 3, dart: 0, harrow: 0 }, reactionTimes: [NaN, 20] }), hp(1.4));
ok(g.parts.asset === 100 && fin(g.score), 'clamps hp, ignores NaN reaction');

console.log(`campaign.test: ${checks - fails}/${checks} checks passed`);
process.exit(fails ? 1 : 0);
