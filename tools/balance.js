/* RED SKIES — balance probe: a perfect-ID "bot operator" plays shifts headless; prints per-weapon usage and outcomes.
   node tools/balance.js [reactionS=4] [salvo=0]   (reaction = seconds from track to engagement decision) */
const fs = require('fs'), path = require('path'), vm = require('vm');
const src = f => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
function run(pick, reactS, seed) {
  const ctx = { console: { log() {}, error() {}, warn() {} }, Math, JSON, Object, Array, String, Number };
  ctx.window = ctx; ctx.RS = {}; ctx.globalThis = ctx; vm.createContext(ctx);
  for (const f of ['contracts.js', 'content.js', 'campaign.js', 'sim.js']) vm.runInContext(src(f), ctx, { filename: f });
  const RS = ctx.window.RS, S = () => RS.sim.state;
  const def = pick(RS);
  RS.sim.init({ content: RS.content, seed }); RS.sim.startShift(def);
  const H = ['jet_hostile', 'helo_hostile', 'cruise_missile', 'drone', 'arm_missile'];
  const seen = {}, out = { kills: { lance: 0, dart: 0, harrow: 0 }, dartShotKm: [], lanceShotKm: [], leak: 0, noShot: 0 };
  RS.bus.on('KILL', p => { if (!p.wasFriend) out.kills[p.weapon]++; });
  RS.bus.on('LAUNCH', p => { const t = S().tracks.find(q => q.id === p.targetId); if (t) (p.weapon === 'dart' ? out.dartShotKm : out.lanceShotKm).push(t.rangeKm); });
  let steps = 0;
  while (S().shift.running && steps < 20 * 700) {
    RS.sim.step(); steps++;
    if (steps % 10) continue;                             // decide every 0.5 s
    if (!S().radar.on) RS.sim.cmd.radar(true);           // bot keeps transmitting (no EMCON discipline)
    for (const t of S().tracks) {
      if (!H.includes(RS.sim.debugTruth(t.id))) continue;
      seen[t.id] = seen[t.id] || S().t;
      if (S().t - seen[t.id] < reactS) continue;           // operator reaction time
      if (t.cls !== 'HOSTILE') RS.sim.cmd.classify(t.id, 'HOSTILE');
      if (t.engagedBy.length) continue;
      const l = RS.sim.query.bestLauncher(t.id); if (!l) continue;
      RS.sim.cmd.assign(t.id, l); RS.sim.cmd.fire(t.id);
    }
  }
  const st = S().stats, avg = a => a.length ? (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) : '-';
  return { name: def.name, hp: +S().asset.hp.toFixed(2), leakers: st.leakers, fired: st.fired, kills: out.kills,
    dartAvgKm: avg(out.dartShotKm), lanceAvgKm: avg(out.lanceShotKm), reserveLeft: S().battery.reserve, failed: S().shift.failed };
}
const reactS = +(process.argv[2] || 4);
const picks = [['C1', R => R.campaign.shifts[0]], ['C2', R => R.campaign.shifts[1]], ['C3', R => R.campaign.shifts[2]], ['C4', R => R.campaign.shifts[3]], ['C5', R => R.campaign.shifts[4]], ['C6', R => R.campaign.shifts[5]],
  ['free hard', R => R.content.makeFreeShift(7, 1)], ['free hard b', R => R.content.makeFreeShift(21, 1)]];
for (const [n, p] of picks) {
  const rs = [1, 2, 3].map(seed => run(p, reactS, seed));
  const mean = k => (rs.reduce((a, r) => a + r[k], 0) / rs.length).toFixed(2);
  const r = rs[0];
  console.log(`${n.padEnd(12)} hp ${mean('hp')} leakers ${mean('leakers')} | fired L${r.fired.lance} D${r.fired.dart} G${r.fired.harrow} | kills L${r.kills.lance} D${r.kills.dart} G${r.kills.harrow} | shot km L${r.lanceAvgKm} D${r.dartAvgKm} | reserve L${r.reserveLeft.lance} D${r.reserveLeft.dart} | failed ${rs.filter(x => x.failed).length}/3`);
}
