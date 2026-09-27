/* =====================================================================
   RED SKIES — audio.js   RS.audio : procedural WebAudio synth + haptics (no assets).
   init() must run inside the first user gesture; it subscribes to the bus once.
   Graph: voices → master gain → DynamicsCompressor (limiter) → destination.
          RS.sfx (audio_weapons.js) → sfxBus → master  (so mute covers weapon audio too).
   Weapon sounds (launch, flight, detonation, break-up, ARM impact, asset hit) belong to RS.sfx; this file keeps
   radar, UI, IFF, lock, Harrow gun, alarms, comms, haptics, kill/miss console tones and aircraft flybys.
   API: init(), setMuted(m), muted, ctx, sfxBus, hint, tone(), alarm(kind, on), debug() -> {voices, loops, locks, sfx, flyby, peak, nan, ...}
   ===================================================================== */
(function () {
  const RS = window.RS;
  const VOL = 0.5, MAX_VOICES = 32, SOUND_KMS = 0.343;   // speed of sound km/s
  let ctx = null, master = null, sfxBus = null, meter = null, outMeter = null, meterBuf = null, outPeak = 0, noiseBuf = null, lastSweep = 0, lastWarn = -999,
    subscribed = false, voices = 0, sfxBound = false, rafOn = false, peak = 0, nanSeen = false;
  const loops = {}, locks = {}, missDelay = {}, fly = {};
  // scene positions (metres, x east, y up, z south) used until RS.scene.launcherPos exists
  const DEFAULTS = { L1: { x: -45, y: 0, z: -30 }, L2: { x: 45, y: 0, z: -30 }, L3: { x: 0, y: 0, z: -70 }, G1: { x: 30, y: 0, z: 20 },
    RADAR: { x: 0, y: 6, z: 60 }, ASSET: { x: 0, y: 0, z: 400 } };
  const posOf = id => {
    try { const p = RS.scene && RS.scene.launcherPos && RS.scene.launcherPos(id); if (p && isFinite(p.x) && isFinite(p.z)) return p; } catch (e) { /* scene not ready */ }
    return DEFAULTS[id] || DEFAULTS.L1;
  };
  const sfxOn = () => sfxBound && !!(RS.sfx && RS.sfx.ctx);
  function listenerNow() {
    try { const l = RS.scene && RS.scene.listener && RS.scene.listener(); if (l && l.pos && isFinite(l.pos.x)) return l; } catch (e) { /* */ }
    return null;
  }

  const live = () => ctx && ctx.state === 'running' && voices < MAX_VOICES;
  const track = src => { voices++; src.onended = () => { voices = Math.max(0, voices - 1); }; };
  function env(g, t, vol, dur, atk) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + (atk || 0.008));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }
  function tone(freq, dur, type, vol, slideTo, delay) {
    if (!live()) return;
    const t = ctx.currentTime + (delay || 0), o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    env(g, t, vol || 0.2, dur);
    o.connect(g); g.connect(master);
    track(o); o.start(t); o.stop(t + dur + 0.02);
  }
  // filtered noise; f/fTo sweep the filter; atk shapes the swell
  function noise(dur, vol, f, fType, fTo, delay, atk) {
    if (!live()) return null;
    const t = ctx.currentTime + (delay || 0), s = ctx.createBufferSource(), bq = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuf; s.loop = true;
    bq.type = fType || 'lowpass'; bq.frequency.setValueAtTime(f, t);
    if (fTo) bq.frequency.exponentialRampToValueAtTime(fTo, t + dur);
    env(g, t, vol, dur, atk);
    s.connect(bq); bq.connect(g); g.connect(master);
    track(s); s.start(t); s.stop(t + dur + 0.05);
    return g;
  }
  function boom(delay, vol) {
    noise(1.4, vol, 380, 'lowpass', 60, delay, 0.01);
    tone(70, 0.9, 'sine', vol * 0.8, 32, delay);
  }
  // continuous voice (oscillator + optional LFO on gain or pitch); returns stop()
  function drone(freq, type, vol, lfoHz, lfoDepth, lfoTarget, lp) {
    if (!ctx) return () => {};
    const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    o.type = type; o.frequency.value = freq; f.type = 'lowpass'; f.frequency.value = lp || 2000;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.05);
    let lfo = null;
    if (lfoHz) {
      lfo = ctx.createOscillator(); const d = ctx.createGain();
      lfo.frequency.value = lfoHz; d.gain.value = lfoDepth;
      lfo.connect(d); d.connect(lfoTarget === 'pitch' ? o.frequency : g.gain); lfo.start(t);
    }
    o.connect(f); f.connect(g); g.connect(master); o.start(t);
    return () => {
      const n = ctx.currentTime;
      try { g.gain.cancelScheduledValues(n); g.gain.setValueAtTime(g.gain.value || 0.0001, n); g.gain.exponentialRampToValueAtTime(0.0001, n + 0.06);
        o.stop(n + 0.08); if (lfo) lfo.stop(n + 0.08); } catch (e) { /* already stopped */ }
    };
  }
  function buzz(p) {
    if (api.muted) return;
    try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) { /* unsupported */ }
  }
  const distDelay = p => {
    const km = Math.hypot(+p.x || 0, +p.y || 0, (+p.alt || 0) / 1000);
    return Math.min(km / SOUND_KMS, 3);
  };

  /* ---------- alarms: each kind is one loop until turned off ---------- */
  const every = (ms, fn) => { fn(); const id = setInterval(fn, ms); return () => clearInterval(id); };
  const ALARMS = {
    arm:        () => every(320, () => { tone(1400, 0.12, 'square', 0.07); tone(900, 0.12, 'square', 0.07, 0, 0.15); }),
    fratricide: () => drone(660, 'square', 0.06, 0, 0, null, 1800),
    asset:      () => every(1400, () => tone(460, 0.7, 'sawtooth', 0.08, 320)),
    leaker:     () => drone(620, 'triangle', 0.07, 6, 140, 'pitch'),
    radar:      () => drone(150, 'sawtooth', 0.05, 2, 0.05, 'gain', 600),
    lowammo:    () => every(3000, () => { tone(520, 0.08, 'square', 0.06); tone(520, 0.08, 'square', 0.06, 0, 0.14); })
  };
  function alarm(kind, on) {
    if (on) {
      if (loops[kind] || !ALARMS[kind]) return;
      loops[kind] = ALARMS[kind]();
      buzz([60]);
    } else if (loops[kind]) { loops[kind](); delete loops[kind]; }
  }
  function lock(id, on) {
    if (on) { if (!locks[id]) locks[id] = drone(92, 'sawtooth', 0.045, 7, 0.02, 'gain', 380); }
    else if (locks[id]) { locks[id](); delete locks[id]; }
  }
  const stopLocks = () => Object.keys(locks).forEach(k => lock(k, false));

  /* ---------- aircraft flybys: filtered noise per nearby aircraft, doppler from range-rate (max 3) ---------- */
  const AIR = { jet_friend: 'jet', strike_friend: 'jet', transport: 'jet', jet_hostile: 'jet', helo_friend: 'helo', helo_hostile: 'helo', drone: 'helo' };
  const FLY_KM = 3, FLY_MAX = 3;
  function flyVoice(kind) {
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(), helo = AIR[kind] === 'helo';
    s.buffer = noiseBuf; s.loop = true; f.type = helo ? 'lowpass' : 'bandpass'; f.frequency.value = helo ? 420 : 900; f.Q.value = helo ? 0.7 : 0.6;
    g.gain.value = 0.0001; s.connect(f); f.connect(g); g.connect(sfxBus || master); s.start(ctx.currentTime, Math.random());
    let lfo = null;
    if (helo) {                                      // blade slap
      lfo = ctx.createOscillator(); const d = ctx.createGain(); lfo.frequency.value = kind === 'drone' ? 60 : 17; d.gain.value = 0.5;
      const am = ctx.createGain(); am.gain.value = 0.6; f.disconnect(); f.connect(am); am.connect(g); lfo.connect(d); d.connect(am.gain); lfo.start(ctx.currentTime);
    }
    return { s, f, g, lfo, helo, r: null, base: f.frequency.value, vol: kind === 'drone' ? 0.12 : helo ? 0.35 : 0.5 };
  }
  function stopFly(id) {
    (id ? [id] : Object.keys(fly)).forEach(k => {
      const v = fly[k]; if (!v) return; delete fly[k];
      try { const n = ctx.currentTime; v.g.gain.setTargetAtTime(0.0001, n, 0.15); v.s.stop(n + 0.8); if (v.lfo) v.lfo.stop(n + 0.8); } catch (e) { /* */ }
    });
  }
  function flyby(dt) {
    const st = RS.sim && RS.sim.state, l = listenerNow(), lp = l ? l.pos : { x: 0, y: 1.6, z: 0 };
    if (!st || !st.visible || !st.shift || !st.shift.running) { stopFly(); return; }
    const near = [];
    for (const v of st.visible) {
      if (!AIR[v.kind]) continue;
      const dx = v.x * 1000 - lp.x, dy = (v.alt || 0) - lp.y, dz = -v.y * 1000 - lp.z, r = Math.hypot(dx, dy, dz);
      if (isFinite(r) && r < FLY_KM * 1000) near.push({ v, r });
    }
    near.sort((a, b) => a.r - b.r);
    const keep = near.slice(0, FLY_MAX), ids = keep.map(n => n.v.id);
    Object.keys(fly).forEach(k => { if (ids.indexOf(k) < 0) stopFly(k); });
    const n = ctx.currentTime;
    for (const { v, r } of keep) {
      const f = fly[v.id] || (fly[v.id] = flyVoice(v.kind));
      const rr = f.r === null || dt <= 0 ? 0 : (f.r - r) / dt;              // + = closing, m/s
      f.r = r;
      const dop = Math.max(0.6, Math.min(1.8, 343 / (343 - Math.max(-250, Math.min(250, rr)))));
      const vol = Math.min(1, f.vol * Math.pow(250 / Math.max(r, 60), 1.1)) * (1 - Math.max(0, r - 2500) / 500);
      f.s.playbackRate.setTargetAtTime(dop, n, 0.1);
      f.f.frequency.setTargetAtTime(Math.max(120, Math.min(8000, f.base * dop * (1 + 600 / Math.max(r, 200)))), n, 0.1);
      f.g.gain.setTargetAtTime(Math.max(0.0001, vol), n, 0.12);
    }
  }
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = frame.last ? Math.min(0.25, (now - frame.last) / 1000) : 0; frame.last = now;
    if (!ctx) return;
    try {
      if (sfxOn()) { const l = listenerNow(); if (l) RS.sfx.setListener(l.pos, l.headingDeg || 0); RS.sfx.update(); }
      flyby(dt);
      if (meter) {
        if (meter.getFloatTimeDomainData) meter.getFloatTimeDomainData(meterBuf);
        for (let i = 0; i < meterBuf.length; i++) { const a = Math.abs(meterBuf[i]); if (a !== a) nanSeen = true; else if (a > peak) peak = a; }
        outMeter.getFloatTimeDomainData(meterBuf);
        for (let i = 0; i < meterBuf.length; i++) { const a = Math.abs(meterBuf[i]); if (a !== a) nanSeen = true; else if (a > outPeak) outPeak = a; }
      }
    } catch (e) { console.warn('[audio] frame', e); }
  }

  function subscribe() {
    const on = RS.bus.on;
    on('SIM_TICK', () => {
      const r = RS.sim && RS.sim.state && RS.sim.state.radar;
      if (!r) return;
      if (r.on && r.sweepDeg < lastSweep) tone(1150, 0.35, 'sine', 0.06, 900);   // sweep passed north
      lastSweep = r.sweepDeg;
    });
    on('UI_TAP', () => tone(2400, 0.03, 'square', 0.04));
    on('TRACK_NEW', () => { tone(660, 0.09, 'triangle', 0.12); tone(880, 0.12, 'triangle', 0.12, 0, 0.11); });
    on('RADAR_WARN', p => { if (p.seconds - lastWarn >= 30 || p.seconds < lastWarn) { lastWarn = p.seconds; tone(440, 0.25, 'sawtooth', 0.06); } });
    on('RADAR_STATE', p => tone(p.on ? 300 : 200, 0.2, 'triangle', 0.1, p.on ? 600 : 100));
    on('IFF_SENT', () => { tone(1800, 0.06, 'sine', 0.08, 2600); tone(1800, 0.06, 'sine', 0.08, 2600, 0.09); });
    on('IFF_RESULT', p => {
      if (p.result === RS.IFF.FRIEND) { tone(880, 0.12, 'sine', 0.12); tone(1320, 0.18, 'sine', 0.12, 0, 0.14); }
      else if (p.result === RS.IFF.NO_RESPONSE) tone(170, 0.3, 'triangle', 0.14, 150);
      else if (p.result === RS.IFF.INVALID) { tone(110, 0.45, 'sawtooth', 0.1); tone(117, 0.45, 'square', 0.07); }
    });
    on('LOCK', p => lock(p.launcherId || 'L?', !!p.on));
    on('LAUNCH', () => {                              // the launch itself is RS.sfx (cold Lance / hot Dart)
      if (!sfxOn()) { noise(1.5, 0.28, 500, 'bandpass', 1800, 0, 0.12); tone(85, 0.35, 'sine', 0.3, 38); }
      buzz([30]);
    });
    on('GUN_FIRE', p => {
      const dur = Math.min(3, 1.5 * Math.max(1, (+p.rounds || 40) / 40));
      if (!live()) return;
      const g = noise(dur, 0.18, 1600, 'bandpass', 0, 0, 0.005);
      if (g) {                                         // chop into ~22 bursts/s with a square LFO on the gain
        const l = ctx.createOscillator(), d = ctx.createGain(), t = ctx.currentTime;
        l.type = 'square'; l.frequency.value = 22; d.gain.value = 0.16;
        l.connect(d); d.connect(g.gain); l.start(t); l.stop(t + dur + 0.05);
      }
    });
    on('INTERCEPT', p => { const d = distDelay(p); missDelay[p.missileId] = d; if (!sfxOn()) boom(d, 0.35); });
    on('KILL', p => { tone(1046, 0.1, 'sine', 0.1, 0, distDelay(p) + 0.5); tone(1568, 0.16, 'sine', 0.1, 0, distDelay(p) + 0.62); buzz([20, 40, 20]); });
    on('MISS', p => {
      const d = (missDelay[p.missileId] || 0) + 0.4; delete missDelay[p.missileId];
      tone(330, 0.2, 'triangle', 0.12, 0, d); tone(220, 0.3, 'triangle', 0.12, 0, d + 0.24);
    });
    on('FIRE_REJECTED', () => { tone(240, 0.08, 'square', 0.08); tone(240, 0.08, 'square', 0.08, 0, 0.13); buzz([15, 30, 15]); });
    on('UI_FIRE_ARMED', p => { noise(0.03, p.armed ? 0.3 : 0.15, 2400, 'highpass'); tone(p.armed ? 130 : 180, 0.04, 'square', 0.12); });
    on('COMMS', p => { if (p.priority === 'high') { noise(0.14, 0.12, 1500, 'bandpass'); tone(1400, 0.06, 'sine', 0.08, 1900, 0.16); } });
    on('ALARM', p => alarm(p.kind, !!p.on));
    on('ARM_INBOUND', () => buzz([100, 50, 100, 50, 100]));
    on('ARM_IMPACT', () => { if (!sfxOn()) boom(0, 0.5); });
    on('ASSET_HIT', () => { if (!sfxOn()) boom(0.3, 0.45); });
    on('FRATRICIDE', () => buzz([400]));
    on('RELOAD_DONE', () => { noise(0.03, 0.2, 2000, 'highpass'); noise(0.03, 0.2, 2000, 'highpass', 0, 0.12); });
    on('SHIFT_START', () => {
      stopLocks(); Object.keys(loops).forEach(k => alarm(k, false)); stopFly();
      if (RS.sfx && RS.sfx.stopAll) RS.sfx.stopAll();
    });
    on('SHIFT_END', stopLocks);
  }

  const api = {
    get ctx() { return ctx; },
    get sfxBus() { return sfxBus; },
    hint: 'Sound on? Flip the ringer switch off silent.',     // iPhone: WebAudio is silent in silent mode
    muted: false,
    init() {
      try {
        if (!ctx) {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (AC) {
            ctx = new AC();
            const comp = ctx.createDynamicsCompressor();
            comp.threshold.value = -14; comp.knee.value = 6; comp.ratio.value = 12; comp.attack.value = 0.003; comp.release.value = 0.2;
            master = ctx.createGain(); master.gain.value = api.muted ? 0 : VOL;
            master.connect(comp); comp.connect(ctx.destination);
            noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
            const d = noiseBuf.getChannelData(0);
            for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
            sfxBus = ctx.createGain(); sfxBus.gain.value = 1; sfxBus.connect(master);
            // small-speaker exciter: bass below ~180 Hz is regenerated as audible harmonics (phones can't play the fundamentals)
            try {
              const xl = ctx.createBiquadFilter(); xl.type = 'lowpass'; xl.frequency.value = 180;
              const ws = ctx.createWaveShaper(), n = 1024, cv = new Float32Array(n);
              for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; cv[i] = Math.tanh(3 * x); }
              ws.curve = cv;
              const xh = ctx.createBiquadFilter(); xh.type = 'bandpass'; xh.frequency.value = 320; xh.Q.value = 0.6;
              const xg = ctx.createGain(); xg.gain.value = 0.45;
              sfxBus.connect(xl); xl.connect(ws); ws.connect(xh); xh.connect(xg); xg.connect(master);
            } catch (e) { /* exciter optional */ }
            if (ctx.createAnalyser) { meter = ctx.createAnalyser(); meter.fftSize = 1024; meterBuf = new Float32Array(meter.fftSize);
              if (meter.getFloatTimeDomainData) { sfxBus.connect(meter); outMeter = ctx.createAnalyser(); outMeter.fftSize = 1024; master.connect(outMeter); }
              else meter = null; }                                              // old Safari: no float meter (debug only)
          }
        }
        if (ctx && ctx.state === 'suspended') ctx.resume();
      } catch (e) { ctx = null; }
      if (ctx && !sfxBound && RS.sfx && RS.sfx.attach) {
        try {
          RS.sfx.attach(ctx, sfxBus);
          RS.sfx.bindGame(RS, { launcherPos: posOf, radarPos: () => posOf('RADAR'), assetPos: () => posOf('ASSET') });
          sfxBound = true;
        } catch (e) { console.warn('[audio] sfx attach failed', e); }
      }
      if (!subscribed) { subscribed = true; subscribe(); }
      if (ctx && !rafOn && window.requestAnimationFrame) { rafOn = true; requestAnimationFrame(frame); }
    },
    setMuted(m) { api.muted = !!m; if (master) master.gain.value = m ? 0 : VOL; if (m) try { navigator.vibrate && navigator.vibrate(0); } catch (e) { /* */ } },
    tone, alarm,
    debug(resetPeak) {
      const out = { voices, loops: Object.keys(loops).length, locks: Object.keys(locks).length, loopKinds: Object.keys(loops), lockIds: Object.keys(locks),
        state: ctx ? ctx.state : 'none', sfx: sfxOn(), sfxActive: RS.sfx && sfxBound ? RS.sfx.active : 0, flyby: Object.keys(fly).length,
        peak: meter ? peak : null, outPeak: meter ? outPeak : null, nan: nanSeen };
      if (resetPeak) { peak = 0; outPeak = 0; nanSeen = false; }
      return out;
    }
  };
  RS.audio = api;
})();
