/* RED SKIES — UI check against the REAL sim (Playwright; shared setup in test/_browser.js; never `playwright install`).
   node test/ui.check.js → builds dist via build.js, runs at 390×844 and 360×740 (dpr 2, touch), exits 1 on failure.
   Uses RS.sim.debugTruth(trackId) (test-only) to pick a true hostile; fast-forwards with RS.sim.step().
   UI_SIZE=390x844 (or 360x740) runs one phone size only (each takes ~2 min under software GL); default: both.
   Screenshots: test/shots/uiC_<w>_*.png */
const fs = require('fs'), path = require('path'), { execSync } = require('child_process');
const { launch, newPage, ROOT, URL, SHOTS } = require('./_browser');
fs.mkdirSync(SHOTS, { recursive: true });
execSync('node build.js', { cwd: ROOT, stdio: 'inherit' });

let fails = 0;
const ok = (c, m) => { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fails++; };

async function run(browser, W, H) {
  console.log(`\n== ${W}x${H} ==`);
  const { ctx, page, errors } = await newPage(browser, { viewport: { width: W, height: H } });
  page.setDefaultTimeout(120e3);                             // software GL at ~3 fps (and other browsers sharing the CPUs): input can lag
  const shot = n => page.screenshot({ path: path.join(SHOTS, `uiC_${W}_${n}.png`) });
  const ev = (fn, arg) => page.evaluate(fn, arg);

  await page.goto(URL, { waitUntil: 'load' });
  await page.tap('#start');
  await page.waitForTimeout(2500);
  await ev(() => { if (!RS.sim.state.shift.running) (RS.meta && RS.meta.startShift ? RS.meta.startShift : RS.sim.startShift)(RS.content.shifts[0]); });
  await page.waitForTimeout(500);
  ok(await ev(() => RS.sim.state.shift.running), 'shift running');

  // V1.4 strip: 4 launcher chips + a 5th fixed 44 px column, the one-tap SHOT/SALVO doctrine toggle #b-doc
  // (src/00_shell.html: #lstrip grid-template-columns: repeat(4, minmax(0, 1fr)) 44px; src/ui.js renderStrip)
  const strip = await ev(() => [...document.querySelectorAll('#lstrip > *')].map(b => ({ id: b.dataset.l || b.id, t: b.textContent, w: b.getBoundingClientRect().width, h: b.getBoundingClientRect().height })));
  const chips = strip.filter(c => /^[LG]\d$/.test(c.id)), doc = strip[4] || {};
  ok(strip.length === 5 && chips.map(c => c.id).join() === 'L1,L2,L3,G1', `strip has 4 launcher chips + doctrine key (${strip.map(c => c.t).join(' | ')})`);
  ok(chips.every(c => /READY|RLD|JAM|EMPTY/.test(c.t)), 'chips show launcher status with no selection');
  ok(doc.id === 'b-doc' && Math.abs(doc.w - 44) < 1 && /1×\s*SHOT/.test(doc.t), `5th column: 44 px SHOT/SALVO key (${doc.id} ${(doc.w || 0).toFixed(1)}px "${doc.t}")`);
  await page.tap('#b-doc'); await page.waitForTimeout(200);
  const salvo = await ev(() => ({ d: RS.sim.state.battery.doctrine, t: document.getElementById('b-doc').textContent, on: document.getElementById('b-doc').classList.contains('on') }));
  ok(salvo.d === 'SALVO' && /2×\s*SALVO/.test(salvo.t) && salvo.on, `doctrine key tap → SALVO (${salvo.d}, "${salvo.t}")`);
  await page.tap('#b-doc'); await page.waitForTimeout(200);
  ok(await ev(() => RS.sim.state.battery.doctrine === RS.DOCTRINE.SLS && /1×\s*SHOT/.test(document.getElementById('b-doc').textContent)), 'second tap → back to SHOOT-LOOK-SHOOT');

  // fast-forward until a true hostile (not an ARM) is inside Lance/Dart reach; select it
  let tid = null;
  for (let tries = 0; tries < 6 && !tid; tries++) {
    const cand = await ev(() => {
      const HOST = ['jet_hostile', 'cruise_missile', 'helo_hostile', 'drone'], s = RS.sim.state, wp = RS.content.weapons || {};
      const reach = ((wp.lance || {}).maxKm || 30) * 0.8, lo = ((wp.lance || {}).minKm || 3) + 3;
      for (let k = 0; k < 120; k++) {
        const t = s.tracks.filter(t => HOST.includes(RS.sim.debugTruth(t.id)) && t.rangeKm < reach && t.rangeKm > lo && !t.assigned && t.quality > 0.5)
          .sort((a, b) => HOST.indexOf(RS.sim.debugTruth(a.id)) - HOST.indexOf(RS.sim.debugTruth(b.id)) || a.rangeKm - b.rangeKm)[0];
        if (t) { RS.sim.cmd.selectTrack(t.id); return t.id + ':' + RS.sim.debugTruth(t.id); }
        for (let i = 0; i < 40; i++) RS.sim.step();
      }
      return null;
    });
    if (!cand) break;
    await page.waitForTimeout(500);
    const id = cand.split(':')[0];
    if (await ev(id => RS.sim.state.tracks.some(t => t.id === id) && RS.sim.state.selectedId === id, id)) tid = id;
    else { console.log('  INFO target ' + cand + ' dropped, retrying'); await ev(() => { for (let i = 0; i < 100; i++) RS.sim.step(); }); }
  }
  ok(!!tid, 'found a true hostile in range: ' + tid);
  if (!tid) { await shot('fail'); await ctx.close(); return; }
  await page.waitForTimeout(300);
  await shot('01_selected');
  const pre = await ev(id => ({ cls: [...document.querySelectorAll('#lstrip .lchip[data-l]')].map(b => b.className + ' :: ' + b.textContent),
    q: RS.sim.state.battery.launchers.map(l => { const q = RS.sim.query.engage(id, l.id); return l.id + ':' + q.ok + '/' + q.reason; }) }), tid);
  console.log('  INFO pre-classify chips', JSON.stringify(pre));
  ok(pre.cls.every(c => / (ok|no|asg) /.test(c + ' ')), 'every chip is green/grey/assigned with a track selected');

  // HOSTILE → auto-assign best launcher + toast
  await page.tap('#b-hostile');
  await page.waitForTimeout(250);
  const aa = await ev(id => {
    const t = RS.sim.state.tracks.find(x => x.id === id);
    return { cls: t && t.cls, assigned: t && t.assigned, toast: document.getElementById('toast').textContent,
      chips: [...document.querySelectorAll('#lstrip .lchip[data-l]')].map(b => b.dataset.l + ':' + b.className.replace('lchip', '').trim() + ':' + b.querySelector('.lc-s').textContent) };
  }, tid);
  console.log('  INFO after HOSTILE', JSON.stringify(aa));
  ok(aa.cls === 'HOSTILE', 'HOSTILE thumb classifies');
  ok(!!aa.assigned && new RegExp('^' + aa.assigned + ' \\w+ assigned · Pk \\d+%').test(aa.toast), `auto-assign on HOSTILE + toast ("${aa.toast}")`);
  ok(aa.chips.some(c => /:ok:Pk \d+%/.test(c)) || aa.chips.filter(c => /asg/.test(c)).length === 1, 'chips go green with Pk');
  ok(aa.chips.filter(c => /:asg:ASSIGNED/.test(c)).length === 1 && aa.chips.find(c => /asg/.test(c)).startsWith(aa.assigned), 'assigned chip highlighted');
  ok(await ev(() => document.getElementById('b-fire').textContent.includes('FIRE ' + RS.sim.state.tracks.find(t => t.id === RS.sim.state.selectedId).assigned)), 'FIRE label shows assigned launcher');
  await shot('02_hostile_assigned');

  // chip tap reassigns to another green chip
  const other = await ev(id => { const t = RS.sim.state.tracks.find(x => x.id === id);
    const o = RS.sim.state.battery.launchers.find(l => l.id !== t.assigned && RS.sim.query.engage(id, l.id).ok); return o ? o.id : null; }, tid);
  if (other) {
    await page.tap('#chip-' + other); await page.waitForTimeout(200);
    ok(await ev(([id, l]) => RS.sim.state.tracks.find(x => x.id === id).assigned === l, [tid, other]), `chip tap reassigns to ${other}`);
    ok(await ev(l => document.getElementById('chip-' + l).classList.contains('asg') && document.getElementById('b-fire').textContent.includes('FIRE ' + l), other), 'reassigned chip highlighted, FIRE follows');
    // tap the assigned chip again → clear
    await page.tap('#chip-' + other); await page.waitForTimeout(200);
    ok(await ev(id => !RS.sim.state.tracks.find(x => x.id === id).assigned, tid), 'tap assigned chip clears assignment');
    ok(await ev(() => document.getElementById('b-fire').classList.contains('dis') && /FIRE$/.test(document.getElementById('fire-cov').textContent)), 'FIRE disabled with no assignment');
    await shot('03_cleared');
    await page.tap('#chip-' + other); await page.waitForTimeout(200);
  } else console.log('  INFO no second green launcher: reassign/clear checks skipped');

  // flip cover + hold fires
  const launched = await (async () => {
    await ev(() => { window.__L = 0; RS.bus.on('LAUNCH', () => window.__L++); RS.bus.on('GUN_FIRE', () => window.__L++); });
    await page.tap('#b-fire'); await page.waitForTimeout(150);
    const armed = await ev(() => RS.ui.fireArmed);
    const r = await ev(() => document.getElementById('b-fire').getBoundingClientRect());
    const cdp = await ctx.newCDPSession(page), pt = [{ x: r.x + r.width / 2, y: r.y + r.height / 2, id: 1 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt });
    await page.waitForTimeout(350); await shot('04_holding');
    await page.waitForTimeout(500);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(200);
    return { armed, n: await ev(() => window.__L) };
  })();
  ok(launched.armed, 'tap on FIRE lifts the cover');
  ok(launched.n >= 1, `hold fires (LAUNCH/GUN_FIRE x${launched.n})`);
  await page.waitForTimeout(600); await shot('05_launched');

  // ARM warning shows exactly once: in the alert strip (the old #armban banner is retired: src/00_shell.html #armban display:none)
  await ev(() => { RS.sim.state.radar.armEta = 42; RS.bus.emit('ALARM', { kind: 'arm', on: true }); });
  await page.waitForTimeout(150);
  const arm = await ev(() => [...document.querySelectorAll('body *')].filter(e => e.children.length === 0 || e.id === 'alertstrip')
    .filter(e => /ARM INBOUND/.test(e.textContent) && e.offsetParent !== null && getComputedStyle(e).display !== 'none').map(e => e.id + ':' + e.textContent));
  ok(arm.length === 1 && arm[0].startsWith('alertstrip'), `ARM warning shown once (${arm.join(' | ')})`);
  await shot('06_arm');
  await ev(() => { RS.bus.emit('ALARM', { kind: 'arm', on: false }); });

  // ACK buttons only for needsAck && !acked
  await ev(() => { const c = RS.sim.state.comms; c.push({ id: 99901, t: RS.sim.state.t, from: 'HQ', text: 'ROE notice (auto)', priority: 'normal', needsAck: false, acked: false },
    { id: 99902, t: RS.sim.state.t, from: 'HQ', text: 'Confirm posture', priority: 'high', needsAck: true, acked: false }); });
  await page.tap('#tab-comms'); await page.waitForTimeout(250);
  const acks = await ev(() => [...document.querySelectorAll('#body-comms [data-act="ack"]')].map(b => +b.dataset.id));
  ok(!acks.includes(99901) && acks.includes(99902), `ACK only where needsAck && !acked (${acks.join(',')})`);
  await shot('07_comms');
  await ev(() => { const c = RS.sim.state.comms; for (let i = c.length - 1; i >= 0; i--) if (c[i].id >= 99901) c.splice(i, 1); });
  await page.tap('#tab-track'); await page.waitForTimeout(200);

  // busy scope for the declutter screenshot
  await ev(() => { for (let i = 0; i < 1600; i++) RS.sim.step(); });
  await page.waitForTimeout(400); await shot('08_busy');

  // layout
  const L = await ev(() => {
    const r = id => document.getElementById(id).getBoundingClientRect();
    const tg = [...document.querySelectorAll('#thumbzone button, .tab, #b-zoom, .lchip')].map(b => { const q = b.getBoundingClientRect(); return Math.min(q.width, q.height); });
    const clipped = [...document.querySelectorAll('.lchip > span, .tz > b, .tab .ptitle')].filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.textContent);
    return { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, hatch: r('hatch').height, scope: r('p-scope').height,
      tabbody: r('tabbody').height, strip: r('lstrip').height, stripBottom: r('lstrip').bottom, tzTop: r('thumbzone').top, tzBottom: r('thumbzone').bottom, minTap: Math.min(...tg), clipped };
  });
  console.log('  INFO layout', JSON.stringify(L));
  ok(L.sw <= L.cw, `no horizontal scroll (${L.sw} <= ${L.cw})`);
  // V1.4 cabin: #hatch { flex: 0 0 55% } (src/00_shell.html, "the hatch is the Pantsir cabin (3-D, ~55 % of the phone)")
  ok(Math.abs(L.hatch / H - 0.55) < 0.02, `hatch ~55% (${L.hatch.toFixed(0)}px)`);
  ok(L.minTap >= 44, `tap targets >= 44px (min ${L.minTap.toFixed(1)})`);
  ok(Math.abs(L.stripBottom - L.tzTop) < 2 && L.tzBottom <= H + 0.5, 'strip sits directly above the thumb zone, both on screen');
  ok(L.clipped.length === 0, 'no clipped chip/thumb/tab labels' + (L.clipped.length ? ': ' + L.clipped.join(' | ') : ''));

  // end of shift: fallback card only without RS.meta
  const end = await ev(() => {
    const had = !!RS.meta, out = {};
    const ec = document.getElementById('endcard'), pay = { grade: 'B', failed: false, reason: 'test', stats: RS.sim.state.stats };
    if (!had) { RS.bus.emit('SHIFT_END', pay); out.noMeta = ec.classList.contains('show'); ec.classList.remove('show'); RS.meta = {}; }
    RS.bus.emit('SHIFT_END', pay); out.withMeta = ec.classList.contains('show');
    if (!had) delete RS.meta;
    return out;
  });
  ok(end.withMeta === false && end.noMeta !== false, `end card: fallback without meta (${end.noMeta}), hidden with meta (${end.withMeta})`);
  ok(errors.length === 0, 'no console errors' + (errors.length ? '\n    ' + errors.join('\n    ') : ''));
  await ctx.close();
}

(async () => {
  const browser = await launch();
  const sizes = [[390, 844], [360, 740]].filter(([w, h]) => !process.env.UI_SIZE || process.env.UI_SIZE === w + 'x' + h);
  if (!sizes.length) { console.error('UI_SIZE must be 390x844 or 360x740'); process.exit(1); }
  for (const [w, h] of sizes) await run(browser, w, h);
  await browser.close();
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
