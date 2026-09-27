/* =====================================================================
   RED SKIES — title.js   RS.title : the cover page (v19).
   Live 3-D backdrop (RS.scene title mode: crimson dusk, launchers against the sun, fake sky traffic),
   a timed title reveal, TAP TO BEGIN (unlocks audio), ambient bed (wind, far rumble, distant radar ping),
   and show launches at passing bandits. Stays behind the main menu; drops away when a shift starts.
   API: prepare() (at page load, no gesture), begin() (inside the first tap), backdrop(on), get on, debug()
   ===================================================================== */
(function () {
  const RS = window.RS;
  const $ = id => document.getElementById(id);
  let on = false, t0 = 0, timers = [], amb = null, showT = null, begun = false, shots = 0;
  const later = (ms, fn) => { const id = setTimeout(fn, ms); timers.push(id); return id; };
  const clearTimers = () => { timers.forEach(clearTimeout); timers = []; };

  /* ---------- sound: ambient bed + show launch voices (need RS.audio.ctx, i.e. after the first tap) ---------- */
  function ambient(start) {
    const A = RS.audio, ctx = A && A.ctx, dest = A && A.sfxBus;
    if (!start) {
      if (amb) { const a = amb; amb = null; const n = a.ctx.currentTime; try { a.out.gain.cancelScheduledValues(n); a.out.gain.setValueAtTime(a.out.gain.value, n); a.out.gain.linearRampToValueAtTime(0.0001, n + 1.6); } catch (e) { /* */ }
        setTimeout(() => { a.stop.forEach(f => { try { f(); } catch (e) { /* */ } }); try { a.out.disconnect(); } catch (e) { /* */ } }, 1800); }
      return;
    }
    if (amb || !ctx || !dest) return;
    const n = ctx.currentTime, out = ctx.createGain(); out.gain.setValueAtTime(0.0001, n); out.gain.linearRampToValueAtTime(1, n + 3); out.connect(dest);
    const buf = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate), d = buf.getChannelData(0);
    let b = 0; for (let i = 0; i < d.length; i++) { b = (b + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = b * 3.5; }   // brown noise
    const stop = [];
    const bed = (f, q, vol, lfoHz, lfoAmt, type) => {
      const s = ctx.createBufferSource(), bq = ctx.createBiquadFilter(), g = ctx.createGain(), l = ctx.createOscillator(), lg = ctx.createGain();
      s.buffer = buf; s.loop = true; bq.type = type || 'bandpass'; bq.frequency.value = f; bq.Q.value = q; g.gain.value = vol;
      l.frequency.value = lfoHz; lg.gain.value = lfoAmt; l.connect(lg); lg.connect(g.gain);
      const lf = ctx.createGain(); lf.gain.value = f * 0.35; l.connect(lf); lf.connect(bq.frequency);
      s.connect(bq); bq.connect(g); g.connect(out); s.start(n, Math.random() * 3); l.start(n);
      stop.push(() => { s.stop(); l.stop(); });
    };
    bed(520, 0.7, 0.10, 0.09, 0.06);                  // wind through the grass, slow gusts
    bed(1500, 1.2, 0.03, 0.13, 0.02);                 // whistle in the grass tops
    bed(70, 0.6, 0.20, 0.05, 0.08, 'lowpass');        // far jet rumble / distant thunder of the front
    // the search radar, far off: a soft two-tone ping every sweep
    const ping = setInterval(() => { if (!amb || RS.audio.muted) return; RS.audio.tone(1150, 0.5, 'sine', 0.018, 880); }, 6000);
    stop.push(() => clearInterval(ping));
    amb = { ctx, out, stop };
  }
  function launchSound(mid, id) {
    const S = RS.sfx; if (!S || !S.ctx || !S.fire) return;
    const kind = id === 'L3' ? 'missile_dart' : 'missile_lance';
    let last = null;
    try {
      S.fire(kind, () => {
        const p = RS.scene.titleProbe(mid);
        if (p && p.alive === false) return Object.assign({}, last || { x: 0, y: 0, z: 0 }, { alive: false });
        if (p) last = p;
        return last || { x: 0, y: 0, z: 0 };
      });
    } catch (e) { console.warn('[title] launch sound', e); }
  }

  /* ---------- show launches: one at a time, spaced, until the launchers are dry ---------- */
  const ORDER = ['L2', 'L3', 'L1', 'L2', 'L3', 'L1', 'L2', 'L3', 'L1', 'L2', 'L3', 'L1'];
  function fire(withSound) {
    if (!on || !RS.scene.titleOn) return null;
    if (RS.covered && RS.covered()) return null;        // V1.4.3: the scene is paused under the ROTATE cover — hold the show round
    for (let i = 0; i < 3; i++) {
      const id = ORDER[shots % ORDER.length]; shots++;
      const mid = RS.scene.titleLaunch(id);
      if (mid) { if (withSound) launchSound(mid, id); return mid; }
    }
    return null;
  }
  function schedule() { clearTimeout(showT); if (!on) return; showT = setTimeout(() => { fire(begun); schedule(); }, 17000 + Math.random() * 7000); }

  /* ---------- reveal ---------- */
  function reveal() {
    const b = $('boot'); if (!b) return;
    b.classList.remove('s1', 's2', 's3', 's4');
    later(120, () => b.classList.add('s1'));            // black lifts, kicker + rule
    later(1100, () => b.classList.add('s2'));           // the letters burn in
    later(2400, () => b.classList.add('s3'));           // subtitle + brief
    later(2700, () => fire(false));                     // first round leaves the tube (silent: no gesture yet)
    later(4300, () => b.classList.add('s4'));           // TAP TO BEGIN + credit
    later(9000, schedule);
  }
  function skip() { clearTimers(); const b = $('boot'); if (b) b.classList.add('s1', 's2', 's3', 's4'); }

  function layout(v) {
    document.body.classList.toggle('titling', v);
    if (RS.main && RS.main.resize) RS.main.resize();
  }
  /** Show / hide the cinematic backdrop (menus sit on top of it; a running shift never shows it). */
  function backdrop(v) {
    v = !!v && !(RS.sim && RS.sim.state && RS.sim.state.shift && RS.sim.state.shift.running);
    if (v === on) return on;
    on = v;
    layout(on);
    RS.scene.setTitle(on);
    if (on) { shots = 0; if (begun) { ambient(true); later(1500, () => fire(true)); schedule(); } }
    else { clearTimers(); clearTimeout(showT); ambient(false); }
    return on;
  }

  function prepare() {
    t0 = performance.now();
    RS.scene.onTitleKill = p => { try { if (RS.sfx && RS.sfx.ctx) RS.sfx.detonate('missile_lance', p, { ground: false }); } catch (e) { /* */ } };
    backdrop(true);
    reveal();
    RS.bus.on('SHIFT_START', () => backdrop(false));
  }
  /** First tap: skip the rest of the reveal, start the ambient bed, and send a round up with sound. */
  function begin() {
    begun = true; skip();
    if (on) { ambient(true); later(700, () => fire(true)); schedule(); }
  }

  RS.title = { prepare, begin, backdrop, get on() { return on; },
    debug() { return { on, begun, shots, amb: !!amb, kills: RS.scene.titleKills || 0, t: (performance.now() - t0) / 1000 }; } };
})();
