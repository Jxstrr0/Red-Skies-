/* ============================================================================
 * audio_weapons.js — Red Skies / Weapons Hold · weapon sound engine
 * Prairie Blue Studio · 100% procedural WebAudio (no samples, no downloads)
 *
 * Every missile/bomb type in the game gets its own voice for each phase:
 *   launch   cold (Lance: gas-generator ejection → cover crack → motor lights ~0.85 s later, ~25 m up)
 *            hot  (Dart: motor fires inside the box — instant blast)
 *            rail (air-launched rockets), eject (bombs, cruise missiles: ejector clunk, cruise spools up)
 *   flight   rocket roar (boost → sustain → burnout → coasting wind), turbojet whine (cruise),
 *            falling-bomb whistle; true doppler from a moving delay line
 *   detonate warhead-sized blast (crack, body, boom, rolling echo), air burst vs ground impact
 *   extras   supersonic crack at close pass, debris whistle + ground impacts after a kill,
 *            ear-ringing and ducking after a very close blast
 * Distance model (listener = the player at the hatch): speed-of-sound delay (343 m/s — you see
 * the flash first), inverse-distance loudness, air absorption (far = muffled), terrain echo.
 * Supersonic missiles coming at you are silent until they pass — you hear the crack, then the roar.
 *
 * Coordinates: scene metres (x east, y up, z SOUTH), same as the game scene. Listener default (0,1.6,0).
 *
 * API (window.RSSfx; also RS.sfx when RS exists)
 *   attach(audioContext, destinationNode?)   share the game's context (RS.audio.ctx) — call after the
 *                                            first user tap. Works with OfflineAudioContext too.
 *   setListener({x,y,z}, headingDeg?)        heading = direction the view faces (0 = north)
 *   setVolume(0..1)
 *   launch(kind, pos, opts?)                 launch transient only
 *   flight(kind, getState, opts?) → handle   moving loop; getState(tSinceStart) → {x,y,z[,vx,vy,vz][,alive:false]}
 *                                            opts.ignite = seconds before the motor lights (cold launch)
 *   fire(kind, getState, opts?) → handle     launch + flight together (position = first getState)
 *   detonate(kind, pos, {ground})            warhead blast for that weapon kind
 *   breakup(pos)                             aircraft/target break-up + falling debris (after a kill)
 *   crack(pos, strength)                     sonic crack
 *   update()                                 call every frame (moves the flight loops)
 *   bindGame(RS, {launcherPos(id), radarPos, assetPos})   wires the game's event bus (see bottom)
 *   profiles                                 per-kind sound table (edit to tune)
 *   onEvent(type, pos, kind, time) / onFlight(handle, kind)   optional hooks (debug views, UI flashes)
 * ==========================================================================*/
(function () {
  'use strict';
  const C = 343;                       // speed of sound, m/s
  const MAX_DELAY = 25;                // s (≈ 8.6 km of flight-loop propagation)
  let ctx = null, master = null, duck = null, comp = null, revIn = null, B = null;
  const L = { x: 0, y: 1.6, z: 0, heading: 0 };
  const handles = new Set();

  /* ------------------------------------------------------------ weapon table
   * motor: rocket | jet | none   size: 0..1 (motor size → lower, bigger roar)
   * boost/sustain: burn seconds  speed: typical m/s   warhead: kg   ref: loudness ref distance (m)
   * launch: cold | hot | rail | eject   burst: air | ground   whine: turbojet tone Hz  whistle: fall whistle Hz */
  const P = {
    missile_lance:  { name: 'Lance SAM',        launch: 'cold',  motor: 'rocket', size: 1.0,  boost: 11.5, sustain: 0, speed: 1400, warhead: 145, burst: 'air', ref: 90, ignite: 1.0 },
    missile_dart:   { name: 'Dart SAM',         launch: 'cold', ignite: 1.0,   motor: 'rocket', size: 0.72, boost: 4.8, sustain: 0, speed: 1100, warhead: 45,  burst: 'air', ref: 70 },
    aam_long:       { name: 'Spire AAM',        launch: 'rail',  motor: 'rocket', size: 0.45, boost: 3, sustain: 6, speed: 1250, warhead: 20,  burst: 'air', ref: 45 },
    aam_short:      { name: 'Needle AAM',       launch: 'rail',  motor: 'rocket', size: 0.32, boost: 5, sustain: 0, speed: 900,  warhead: 9,   burst: 'air', ref: 35 },
    agm_arm:        { name: 'Ember ARM',        launch: 'rail',  motor: 'rocket', size: 0.55, boost: 4, sustain: 8, speed: 760,  warhead: 65,  burst: 'ground', ref: 50 },
    agm_light:      { name: 'Hatchet AGM',      launch: 'rail',  motor: 'rocket', size: 0.36, boost: 3, sustain: 0, speed: 420,  warhead: 9,   burst: 'ground', ref: 30 },
    glide_bomb:     { name: 'Kite glide bomb',  launch: 'eject', motor: 'none',   speed: 230,  warhead: 100, burst: 'ground', whistle: 1250, ref: 25 },
    cruise_missile: { name: 'Farstrike cruise', launch: 'eject', motor: 'jet',    whine: 3150, speed: 250, warhead: 450, burst: 'ground', ref: 55 },
    aam_long_e:     { name: 'Sable AAM',        launch: 'rail',  motor: 'rocket', size: 0.47, boost: 4, sustain: 4, speed: 1150, warhead: 39,  burst: 'air', ref: 45 },
    aam_short_e:    { name: 'Sting AAM',        launch: 'rail',  motor: 'rocket', size: 0.33, boost: 5, sustain: 0, speed: 880,  warhead: 8,   burst: 'air', ref: 35 },
    aam_heavy_e:    { name: 'Longbow AAM',      launch: 'rail',  motor: 'rocket', size: 0.62, boost: 5, sustain: 10, speed: 1350, warhead: 60, burst: 'air', ref: 55 },
    agm_arm_e:      { name: 'Cinder ARM',       launch: 'rail',  motor: 'rocket', size: 0.6,  boost: 4, sustain: 9, speed: 800,  warhead: 90,  burst: 'ground', ref: 55 },
    agm_light_e:    { name: 'Pike AGM',         launch: 'rail',  motor: 'rocket', size: 0.4,  boost: 3, sustain: 2, speed: 380,  warhead: 12,  burst: 'ground', ref: 32 },
    guided_bomb_e:  { name: 'Boulder LGB',      launch: 'eject', motor: 'none',   speed: 280,  warhead: 500, burst: 'ground', whistle: 820, ref: 30 },
    cruise_e:       { name: 'Longshot cruise',  launch: 'eject', motor: 'jet',    whine: 2450, speed: 235, warhead: 400, burst: 'ground', ref: 60 }
  };
  const ALIAS = { arm_missile: 'agm_arm', lance: 'missile_lance', dart: 'missile_dart' };
  const prof = k => P[ALIAS[k] || k] || P.aam_long;

  /* ----------------------------------------------------------------- setup */
  function attach(audioContext, destination) {
    ctx = audioContext;
    master = ctx.createGain(); master.gain.value = 0.9;
    duck = ctx.createGain(); duck.gain.value = 1;
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 6; comp.attack.value = 0.002; comp.release.value = 0.35;
    master.connect(duck); duck.connect(comp); comp.connect(destination || ctx.destination);
    B = buffers();
    const conv = ctx.createConvolver(); conv.buffer = B.ir;
    revIn = ctx.createGain(); revIn.gain.value = 1;
    const revOut = ctx.createGain(); revOut.gain.value = 0.55;
    revIn.connect(conv); conv.connect(revOut); revOut.connect(duck);
    return api;
  }
  function buffers() {
    const sr = ctx.sampleRate, n = Math.floor(sr * 3), R = Math.random;
    const mk = (len, ch) => ctx.createBuffer(ch || 1, len, sr);
    const white = mk(n), brown = mk(n), crackle = mk(n), pink = mk(n);
    let d = white.getChannelData(0); for (let i = 0; i < n; i++) d[i] = R() * 2 - 1;
    d = brown.getChannelData(0); let last = 0;
    for (let i = 0; i < n; i++) { last = (last + 0.02 * (R() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
    d = pink.getChannelData(0); let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < n; i++) { const w = R() * 2 - 1; b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0527; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2; }
    // crackle: sparse, positively-skewed shock spikes (the "tearing" in supersonic rocket exhaust)
    d = crackle.getChannelData(0);
    for (let i = 0; i < n;) {
      i += Math.floor(sr * (0.0006 + R() * R() * 0.012));
      const a = 0.25 + R() * 0.75, len = Math.max(2, Math.floor(sr * 0.0005));
      for (let k = 0; k < len * 4 && i + k < n; k++) d[i + k] += k === 0 ? a : -a * 0.3 * Math.exp(-k / len);
    }
    // N-wave (sonic crack): rise, linear fall through zero, rise back — ~6 ms
    const nl = Math.floor(sr * 0.006), nw = mk(nl + 8); d = nw.getChannelData(0);
    for (let i = 0; i < nl; i++) d[i + 2] = 1 - 2 * i / nl;
    // outdoor impulse response: diffuse decay + discrete terrain echoes, stereo, darkened
    const il = Math.floor(sr * 3.4), ir = mk(il, 2);
    for (let c = 0; c < 2; c++) {
      d = ir.getChannelData(c); let lp = 0;
      const echoes = c ? [0.52, 1.05, 1.9] : [0.47, 1.18, 2.1];
      for (let i = 0; i < il; i++) {
        const t = i / sr;
        let v = (R() * 2 - 1) * Math.exp(-t / 0.75) * (t < 0.02 ? t / 0.02 : 1) * 0.5;
        echoes.forEach((e, j) => { if (t > e && t < e + 0.35) v += (R() * 2 - 1) * Math.exp(-(t - e) / 0.08) * (0.55 - j * 0.14); });
        lp += 0.12 * (v - lp); d[i] = lp;
      }
    }
    return { white, brown, crackle, pink, nwave: nw, ir };
  }

  /* ---------------------------------------------------------- spatial core */
  const dist = p => Math.hypot(p.x - L.x, (p.y || 0) - L.y, (p.z || 0) - L.z);
  const distGain = (d, ref) => Math.min(1.4, Math.pow(ref / Math.max(d, 1), 0.85));
  const airCut = d => Math.max(400, 16000 / (1 + d / 1500));   // [RS] gentler air absorption: distant motors keep their crackle (ref clip 3)
  function panOf(p) {
    const az = Math.atan2(p.x - L.x, -(p.z - L.z)) - L.heading * Math.PI / 180;
    return Math.max(-0.9, Math.min(0.9, Math.sin(az) * 0.9));
  }
  // Static emitter: returns an input node + the time the sound ARRIVES at the listener.
  function emitter(p, ref, revAmt) {
    const d = dist(p);
    const inp = ctx.createGain(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
    lp.type = 'lowpass'; lp.frequency.value = airCut(d); lp.Q.value = 0.5;
    g.gain.value = distGain(d, ref);
    inp.connect(lp); lp.connect(g);
    if (ctx.createStereoPanner) { const pn = ctx.createStereoPanner(); pn.pan.value = panOf(p); g.connect(pn); pn.connect(master); }
    else g.connect(master);
    const send = ctx.createGain(); send.gain.value = (revAmt || 0.25) * Math.min(1, 0.35 + d / 3000) * g.gain.value;
    lp.connect(send); send.connect(revIn);
    return { inp, t: ctx.currentTime + 0.02 + d / C, d };
  }

  /* ----------------------------------------------------------- primitives */
  function env(param, t, a, peak, dcy, curve) {
    param.setValueAtTime(0.0001, t);
    param.linearRampToValueAtTime(peak, t + a);
    if (curve === 'lin') param.linearRampToValueAtTime(0.0001, t + a + dcy);
    else param.setTargetAtTime(0.0001, t + a, dcy / 4.5);
  }
  function noise(dest, t, o) {
    const s = ctx.createBufferSource(); s.buffer = B[o.buf || 'white']; s.loop = true;
    s.playbackRate.value = o.rate || 1;
    const f = ctx.createBiquadFilter(); f.type = o.type || 'lowpass'; f.frequency.value = o.f || 1000; f.Q.value = o.q || 0.7;
    if (o.f1) f.frequency.exponentialRampToValueAtTime(o.f1, t + (o.a || 0.005) + (o.d || 0.3));
    const g = ctx.createGain(); env(g.gain, t, o.a || 0.004, o.peak || 0.5, o.d || 0.3, o.curve);
    s.connect(f); f.connect(g); g.connect(dest);
    s.start(t, Math.random() * 2); s.stop(t + (o.a || 0.004) + (o.d || 0.3) * 1.3 + 0.1);
    return s;
  }
  function tone(dest, t, o) {
    const s = ctx.createOscillator(); s.type = o.type || 'sine';
    s.frequency.setValueAtTime(o.f0, t);
    if (o.f1) s.frequency.exponentialRampToValueAtTime(o.f1, t + (o.a || 0.005) + o.d);
    const g = ctx.createGain(); env(g.gain, t, o.a || 0.005, o.peak || 0.4, o.d);
    s.connect(g); g.connect(dest); s.start(t); s.stop(t + (o.a || 0.005) + o.d * 1.3 + 0.1);
    return s;
  }
  function ring(dest, t, freqs, dcy, peak) { freqs.forEach((f, i) => tone(dest, t, { f0: f, d: dcy * (1 - i * 0.18), peak: peak / (1 + i * 0.6), a: 0.002 })); }
  function nwave(dest, t, peak, stretch) {
    const s = ctx.createBufferSource(); s.buffer = B.nwave; s.playbackRate.value = 1 / (stretch || 1);
    const g = ctx.createGain(); g.gain.value = peak; s.connect(g); g.connect(dest); s.start(t);
  }

  /* ------------------------------------------------------------- launches */
  const emit = (type, p, kind) => { if (api.onEvent) try { api.onEvent(type, p, kind, ctx.currentTime); } catch (e) { } };
  function launch(kind, p, o) {
    if (!ctx) return;
    const w = prof(kind); emit('launch', p, kind);
    if (w.launch === 'cold') return launchCold(p, w);
    if (w.launch === 'hot') return launchHot(p, w);
    if (w.launch === 'eject') return launchEject(p, w);
    return launchRail(p, w);
  }
  // Lance: gas generator throws the round out of the tube; cover ruptures; motor lights mid-air.
  // [V1.1.1] metallic "CLUNK": steel-on-steel strike = sharp click + knocked body + short inharmonic
  // steel partials (detuned pairs beat → metallic shimmer) + a low thud. Ref clip (S-400 cold launch):
  // two broadband hits 0.20 s apart, each ~60 ms of 150 Hz–4 kHz energy, ~-18 dB silence between them.
  const STEEL = [1, 2.31, 3.83, 5.37, 7.09, 9.12];                     // thick steel tube / latch modes (inharmonic)
  function clank(o, t, k, pitch) {
    const b = 410 * pitch;
    noise(o, t, { buf: 'white', type: 'highpass', f: 2800, d: 0.016, peak: 1.6 * k, a: 0.0004 });           // hard impact click
    noise(o, t, { buf: 'white', type: 'bandpass', f: 1250 * pitch, q: 1.2, d: 0.07, peak: 2.4 * k, a: 0.0006 }); // metal knock (phone band)
    noise(o, t, { buf: 'brown', type: 'bandpass', f: 380 * pitch, q: 1.0, d: 0.09, peak: 1.6 * k, a: 0.001 });   // body of the hit
    tone(o, t, { f0: 150 * pitch, f1: 70, d: 0.12, peak: 0.9 * k, a: 0.0015 });                                 // low thud
    STEEL.forEach((m, i) => {                                                                                  // steel ring, fast decay
      const f = b * m, d = 0.26 / (1 + i * 0.55), pk = 0.26 * k / (1 + i * 0.3);
      tone(o, t + 0.001, { f0: f, d, peak: pk, a: 0.0008, type: i < 2 ? 'triangle' : 'sine' });
      tone(o, t + 0.001, { f0: f * 1.013, d: d * 0.8, peak: pk * 0.6, a: 0.0008 });
    });
    for (let i = 1; i <= 3; i++)                                                                               // latch chatter
      noise(o, t + 0.018 * i + Math.random() * 0.006, { buf: 'white', type: 'bandpass', f: 2200 + i * 500, q: 3, d: 0.012, peak: 0.28 * k / i, a: 0.0005 });
  }
  function launchCold(p, w) {
    const e = emitter(p, 60, 0.3), t = e.t, o = e.inp, ign = w.ignite || 0.85;
    tone(o, t, { f0: 58, f1: 30, d: 0.28, peak: 0.6, a: 0.003 });                              // short gas "whump" under the first clunk
    noise(o, t, { buf: 'brown', f: 300, d: 0.14, peak: 0.9, a: 0.002 });                       // gas slug (short: keeps the gap clean)
    // "CLUNK — CLUNK": 1) gas charge fires / latches + cover go, 2) 0.20 s later the round clears the tube mouth
    const pz = 1 / Math.sqrt(w.size || 1);                       // Dart's smaller canister rings a little higher
    clank(o, t, 1.0, pz); clank(o, t + 0.2, 0.95, 1.14 * pz);
    // rising hiss as the round hangs / the motor igniter spins up (ref: builds over the ~0.5 s before ignition)
    noise(o, t + ign - 0.5, { buf: 'white', type: 'bandpass', f: 2600, f1: 4200, q: 0.5, d: 0.12, peak: 0.22, a: 0.5, curve: 'lin' });
    // motor ignition bang ~25 m above the launcher
    const up = { x: p.x, y: (p.y || 0) + 25, z: p.z };
    const e2 = emitter(up, 90, 0.45), t2 = e2.t + ign;
    noise(e2.inp, t2, { buf: 'white', f: 5000, d: 0.12, peak: 0.9, a: 0.001 });
    tone(e2.inp, t2, { f0: 70, f1: 35, d: 0.35, peak: 0.8, a: 0.002 });
    // [RS] phone-speaker layer: mid-band motor roar as the round climbs away (small speakers can't play the sub-bass above)
    // [RS] ignition roar, louder than the ejection bang; bright (~2 kHz) at first, darkening to ~800 Hz over ~4.5 s (ref clip)
    noise(e2.inp, t2 + 0.02, { buf: 'pink', type: 'bandpass', f: 2000, f1: 800, q: 0.6, d: 4.5, peak: 1.5, a: 0.05 });
    noise(e2.inp, t2 + 0.02, { buf: 'crackle', type: 'highpass', f: 1200, d: 2.6, peak: 0.75, a: 0.04 });
    noise(e2.inp, t2, { buf: 'white', type: 'highpass', f: 3000, d: 1.1, peak: 0.5, a: 0.01 });
    // cover fragments and grit landing around the launcher
    for (let i = 0; i < 6; i++) {
      const tt = t + 1.3 + Math.random() * 1.8;
      tone(o, tt, { f0: 1800 + Math.random() * 2500, d: 0.05 + Math.random() * 0.06, peak: 0.05 + Math.random() * 0.05, a: 0.001 });
      noise(o, tt, { buf: 'white', type: 'bandpass', f: 3000, d: 0.02, peak: 0.05, a: 0.001 });
    }
    noise(o, t + 0.9, { buf: 'pink', type: 'bandpass', f: 1400, q: 0.6, d: 1.6, peak: 0.07, a: 0.3 }); // settling dust hiss
  }
  // Dart: motor fires inside the box canister — instant blast, blast wash, box rattle.
  function launchHot(p, w) {
    const e = emitter(p, 70, 0.45), t = e.t, o = e.inp;
    noise(o, t, { buf: 'white', f: 9000, d: 0.09, peak: 1.3, a: 0.0006 });                     // front cover blow-out
    noise(o, t, { buf: 'brown', f: 420, d: 1.1, peak: 1.5, a: 0.01 });                         // blast body
    tone(o, t, { f0: 64, f1: 30, d: 0.7, peak: 1.0, a: 0.004 });                               // chest thump
    noise(o, t + 0.02, { buf: 'crackle', type: 'highpass', f: 600, d: 1.2, peak: 0.6, a: 0.01 }); // raw exhaust crackle at the box
    noise(o, t + 0.15, { buf: 'pink', f: 180, d: 2.2, peak: 0.6, a: 0.2 });                    // ground wash rumble
    for (let i = 0; i < 5; i++) noise(o, t + 0.05 + i * 0.045, { buf: 'white', type: 'bandpass', f: 1600 + i * 300, q: 4, d: 0.05, peak: 0.12, a: 0.001 }); // box rattle
    ring(o, t + 0.02, [340, 815, 1630], 0.8, 0.05);
    // [RS] phone-speaker layer: mid-band motor roar leaving the box
    noise(o, t + 0.03, { buf: 'pink', type: 'bandpass', f: 1800, f1: 700, q: 0.6, d: 3.4, peak: 1.3, a: 0.03 });
  }
  // Air-launched rocket off a rail: short igniter pop + the motor "whoosh" onset.
  function launchRail(p, w) {
    const e = emitter(p, w.ref, 0.35), t = e.t, o = e.inp, s = w.size || 0.4;
    noise(o, t, { buf: 'white', f: 7000, d: 0.05, peak: 0.6, a: 0.0008 });
    noise(o, t, { buf: 'white', type: 'bandpass', f: 1400 - s * 600, f1: 700, q: 0.6, d: 0.6, peak: 0.7, a: 0.02 });
    tone(o, t, { f0: 90 - s * 30, f1: 45, d: 0.3, peak: 0.4 });
  }
  // Ejected store (bombs, cruise): cartridge ejector clunk; cruise engines spool in flight().
  function launchEject(p, w) {
    const e = emitter(p, 18, 0.2), t = e.t, o = e.inp;
    noise(o, t, { buf: 'white', type: 'bandpass', f: 900, q: 1.5, d: 0.06, peak: 0.6, a: 0.001 });
    tone(o, t, { f0: 160, f1: 90, d: 0.12, peak: 0.4 });
    ring(o, t, [640, 1510], 0.25, 0.05);
  }

  /* ------------------------------------------------------------- flight */
  function flight(kind, getState, opts) {
    if (!ctx) return null;
    opts = opts || {};
    const w = prof(kind), t0 = ctx.currentTime, s = w.size || 0.5;
    const out = ctx.createGain(); out.gain.value = 0;                 // output-side mute (supersonic approach)
    const mix = ctx.createGain();
    const motor = ctx.createGain(); motor.gain.value = 0;
    const wind = ctx.createGain(); wind.gain.value = 0;
    const delay = ctx.createDelay(MAX_DELAY + 1);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.5;
    const dg = ctx.createGain();
    const pn = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const send = ctx.createGain();
    const flut = ctx.createGain(); flut.gain.value = 1;
    motor.connect(flut); flut.connect(mix); wind.connect(mix); mix.connect(delay); delay.connect(lp); lp.connect(dg); dg.connect(out);
    if (pn) { out.connect(pn); pn.connect(master); } else out.connect(master);
    lp.connect(send); send.connect(revIn);
    const srcs = [];
    const loop = (buf, type, f, q, gain, dest, rate) => {
      const b = ctx.createBufferSource(); b.buffer = B[buf]; b.loop = true; b.playbackRate.value = rate || 1;
      const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
      const g = ctx.createGain(); g.gain.value = gain;
      b.connect(fl); fl.connect(g); g.connect(dest || motor); b.start(ctx.currentTime, Math.random() * 2); srcs.push(b);
      return { b, fl, g };
    };
    let whine = null;
    if (w.motor === 'rocket') {
      // [RS] ref clip 3: a climbing motor sounds like a tearing crackle centred ~1.5–3 kHz, not a bass rumble
      loop('brown', 'lowpass', 190 + 520 * (1 - s), 0.6, 0.7);                           // deep roar (bigger motor = lower)
      loop('white', 'bandpass', 1500 + 1800 * (1 - s), 0.55, 0.5);                      // exhaust hiss
      loop('crackle', 'highpass', 500, 0.5, 0.55);                                      // shock crackle
      loop('crackle', 'bandpass', 2400, 0.6, 0.9);                                      // [RS] tearing crackle band
      loop('pink', 'lowpass', 900, 0.5, 0.35);
      const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 6 + Math.random() * 5; lg.gain.value = 0.05;   // [RS] was 0.12: read as stutter on phones
      lfo.connect(lg); lg.connect(flut.gain); lfo.start(t0); srcs.push(lfo);            // turbulence flutter
    } else if (w.motor === 'jet') {
      const wg = ctx.createGain(); wg.gain.value = 0.18; wg.connect(motor);
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = w.whine; bp.Q.value = 3; bp.connect(wg);
      const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), o3 = ctx.createOscillator();
      o1.type = 'sawtooth'; o2.type = 'sawtooth'; o3.type = 'triangle';
      [o1, o2].forEach(o => o.connect(bp));
      const g3 = ctx.createGain(); g3.gain.value = 0.06; o3.connect(g3); g3.connect(motor);
      const spool = opts.spool !== false && w.launch === 'eject' ? 2.2 : 0;
      [[o1, 1], [o2, 1.007], [o3, 0.5]].forEach(([o, m]) => {
        o.frequency.setValueAtTime(w.whine * m * (spool ? 0.25 : 1), t0);
        if (spool) o.frequency.exponentialRampToValueAtTime(w.whine * m, t0 + spool);
        o.start(t0); srcs.push(o);
      });
      loop('brown', 'lowpass', 650, 0.6, 1.1);                                          // jet roar
      loop('white', 'highpass', 4500, 0.5, 0.05);                                       // intake hiss
      whine = { bp };
    }
    // aerodynamic rush (all), whistle (unpowered bombs)
    const rush = loop('white', 'bandpass', 800, 0.8, 0.5, wind);
    const whistle = w.whistle ? loop('white', 'bandpass', w.whistle, 22, 9, wind) : null;

    // Retarded-time propagation: the source writes into the delay line in its own time; the listener
    // reads the sample EMITTED at tau where tau + d(tau)/C = now. That gives exact doppler, first
    // arrival after the true travel time, a silent approach for supersonic sources (nothing arrives
    // before the Mach cone), and a correct tail after the source is gone.
    const hist = [];                              // {t, x, y, z, d} in context time
    const refF = w.ref * (w.motor === 'rocket' ? 5 : w.motor === 'jet' ? 1.6 : 2.4);   // [RS] rockets stay audible for ~8 s as they climb away (ref clip 3)
    let prev = null, prevT = 0, closing = 0, ended = false, cracked = false, endAt = 0, lastD = 0;
    let Dp = null, tp = 0, rate = 0;
    function source(now) {
      const tt = now - t0;
      let st = getState(tt);
      if (!st || st.alive === false || !isFinite(st.x) || !isFinite(st.z)) { h.stop(); return; }   // [RS] finite guard
      if (st.vx === undefined) {
        if (prev && tt > prevT) { const k = 1 / (tt - prevT); st = Object.assign({}, st, { vx: (st.x - prev.x) * k, vy: (st.y - prev.y) * k, vz: (st.z - prev.z) * k }); }
        else st = Object.assign({}, st, { vx: 0, vy: 0, vz: 0 });
        prev = { x: st.x, y: st.y, z: st.z }; prevT = tt;
      }
      const d = dist(st), sp = Math.hypot(st.vx, st.vy, st.vz);
      const vr = -((st.x - L.x) * st.vx + (st.y - L.y) * st.vy + (st.z - L.z) * st.vz) / Math.max(d, 1); // + = closing
      if (!cracked && sp > C * 1.05 && closing > 0 && vr <= 0 && d < 900) { cracked = true; crack(st, Math.min(1, 300 / Math.max(d, 60))); }
      closing = vr;
      // motor envelope (source side)
      const tm = tt - (opts.ignite !== undefined ? opts.ignite : 0);
      let m = 0;
      if (w.motor === 'rocket') m = tm < 0 ? 0 : tm < w.boost ? 1 : tm < w.boost + w.sustain ? 0.42 : 0;
      else if (w.motor === 'jet') m = st.engine === false ? 0 : 0.9;
      if (st.motor === false) m = 0;
      motor.gain.setTargetAtTime(m, now, m > 0.5 && tm < 0.1 ? 0.01 : 0.6);   // [RS] slow boost→sustain fade (was an audible step)
      const v = Math.max(sp, 1), wv = Math.min(1.2, Math.pow(v / 350, 2));
      wind.gain.setTargetAtTime(wv * (m > 0 ? 0.25 : 0.55), now, 0.1);
      rush.fl.frequency.setTargetAtTime(350 + v * 2.2, now, 0.1);
      if (whistle) whistle.fl.frequency.setTargetAtTime(w.whistle * (0.75 + 0.35 * Math.min(1, v / 300)), now, 0.2);
      hist.push({ t: now, x: st.x, y: st.y, z: st.z, d });
      lastD = d; h.pos = st; h.dist = d;
    }
    function listener(now) {
      let k = -1, e = null;
      for (let i = hist.length - 1; i > 0; i--) {
        const a = hist[i - 1], b = hist[i], fa = a.t + a.d / C - now, fb = b.t + b.d / C - now;
        if (fa <= 0 && fb >= 0) {
          const u = fa === fb ? 0 : fa / (fa - fb);
          e = { t: a.t + (b.t - a.t) * u, x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, z: a.z + (b.z - a.z) * u, d: a.d + (b.d - a.d) * u };
          k = i - 1; break;
        }
      }
      if (k > 2) hist.splice(0, k - 1);          // older samples have already been heard
      const heard = !!e && now - e.t <= MAX_DELAY;
      const D = e ? Math.min(now - e.t, MAX_DELAY) : Math.min(MAX_DELAY, hist.length ? now - hist[0].t + hist[0].d / C : 0);
      const dt_ = delay.delayTime;
      let Dt;
      if (opts.maxStretch) {
        // [RS] own SAMs: a receding Mach-3+ source would be time-stretched ~5x (crackle turns into slow, stuttering pops).
        // Steer a smoothed read head toward the true delay with its rate bounded → steady, gently falling pitch.
        const dtf = Dp === null ? 0 : Math.max(0, Math.min(0.1, now - tp));
        if (Dp === null) Dp = D;
        const want = Math.max(-opts.maxStretch, Math.min(opts.maxStretch, (D - Dp) / 0.6));
        rate += (want - rate) * Math.min(1, dtf / 0.35);
        Dp = Math.max(0, Math.min(MAX_DELAY, Dp + rate * dtf)); tp = now;
        Dt = Dp + rate * 0.12;
      } else {
        // steer the read head with a short linear ramp along the predicted slope → smooth, steady doppler
        if (Dp !== null && now > tp + 1e-4) rate = rate * 0.5 + ((D - Dp) / (now - tp)) * 0.5;
        Dp = D; tp = now;
        Dt = D + rate * 0.12;
      }
      dt_.cancelScheduledValues(now); dt_.setValueAtTime(dt_.value, now);
      dt_.linearRampToValueAtTime(Math.max(0, Math.min(MAX_DELAY, Dt)), now + 0.12);
      out.gain.setTargetAtTime(heard ? 1 : 0, now, 0.02);
      if (e) {
        lp.frequency.setTargetAtTime(airCut(e.d), now, 0.05);
        dg.gain.setTargetAtTime(distGain(e.d, refF), now, 0.05);
        if (pn) pn.pan.setTargetAtTime(panOf(e), now, 0.05);
        send.gain.setTargetAtTime(0.25 * Math.min(1, 0.3 + e.d / 3000) * distGain(e.d, refF), now, 0.1);
      }
    }
    const h = {
      kind: ALIAS[kind] || kind,
      kill() {                                   // [RS] immediate silence + removal (shift restart)
        h.stop(0.02); handles.delete(h);
        const now = ctx.currentTime; out.gain.cancelScheduledValues(now); out.gain.setTargetAtTime(0, now, 0.03);
        srcs.forEach(x => { try { x.stop(now + 0.2); } catch (e) { } });
      },
      update() {
        const now = ctx.currentTime;
        if (!ended) source(now);
        listener(now);
        if (ended && now > endAt) { handles.delete(h); out.gain.setTargetAtTime(0, now, 0.05); }
      },
      stop(fade) {
        if (ended) return; ended = true; h.ended = true;
        const now = ctx.currentTime;
        motor.gain.setTargetAtTime(0, now, fade || 0.03); wind.gain.setTargetAtTime(0, now, fade || 0.03);
        endAt = now + Math.min(lastD / C, MAX_DELAY) + 0.4;
        srcs.forEach(x => { try { x.stop(endAt + 0.3); } catch (e) { } });
      }
    };
    // initialise so the line starts silent (nothing has travelled to the listener yet)
    let s0 = getState(0); if (!s0 || !isFinite(s0.x) || !isFinite(s0.z)) s0 = { x: L.x, y: L.y, z: L.z };   // [RS] finite guard
    const d0 = dist(s0);
    delay.delayTime.value = Math.min(d0 / C, MAX_DELAY); lp.frequency.value = airCut(d0); dg.gain.value = distGain(d0, refF);
    handles.add(h);
    h.update();
    if (api.onFlight) try { api.onFlight(h, kind); } catch (e) { }
    return h;
  }
  function fire(kind, getState, opts) {
    const p0 = getState(0);
    launch(kind, p0, opts);
    const w = prof(kind);
    return flight(kind, getState, Object.assign({ ignite: w.launch === 'cold' ? (w.ignite || 0.85) : 0 }, opts));
  }
  function update() { handles.forEach(h => h.update()); }
  function stopAll() { Array.from(handles).forEach(h => h.kill()); }   // [RS] silence every flight loop now

  /* ------------------------------------------------------------ detonations */
  function detonate(kind, p, o) {
    if (!ctx) return;
    o = o || {};
    const w = prof(kind), kg = o.kg || w.warhead || 20; emit('detonate', p, kind);
    const ground = o.ground !== undefined ? o.ground : w.burst === 'ground';
    const s = Math.cbrt(kg / 20);                 // blast scale (cube-root scaling)
    const e = emitter(p, 95 * s, 0.6), t = e.t, x = e.inp;
    noise(x, t, { buf: 'white', f: 12000, d: 0.02 + 0.015 * s, peak: 1.2, a: 0.0004 });                  // shock front crack
    noise(x, t, { buf: 'brown', f: 1400 / Math.sqrt(s), d: 0.35 + 0.35 * s, peak: 1.6, a: 0.002 });      // blast body
    tone(x, t, { f0: 70 / Math.pow(s, 0.3), f1: 24, d: 0.5 + 0.5 * s, peak: 1.2, a: 0.003 });            // pressure boom
    noise(x, t + 0.05, { buf: 'pink', f: 220, d: 1.5 + 1.4 * s, peak: 0.55, a: 0.15 });                  // rolling rumble
    if (ground) {
      noise(x, t + 0.12, { buf: 'pink', type: 'bandpass', f: 900, q: 0.5, d: 1.6 * s + 0.6, peak: 0.28, a: 0.25 }); // dirt and debris rain
      for (let i = 0; i < 8; i++) tone(x, t + 0.4 + Math.random() * 1.8 * s, { f0: 90 + Math.random() * 120, d: 0.08, peak: 0.1, a: 0.002 }); // clods landing
    } else {
      noise(x, t + 0.02, { buf: 'white', type: 'bandpass', f: 2600, q: 0.7, d: 0.35, peak: 0.22, a: 0.01 });  // fragment whirr
    }
    // very close: ears ring, everything else ducks
    if (e.d < 180) ears(t, 1 - e.d / 180);
    return e;
  }
  function ears(t, k) {
    const g = ctx.createGain(); g.connect(comp);
    tone(g, t + 0.05, { f0: 4150, d: 5.5 * k + 1, peak: 0.05 * k, a: 0.3 });
    duck.gain.cancelScheduledValues(t);
    duck.gain.setValueAtTime(1, t); duck.gain.linearRampToValueAtTime(1 - 0.6 * k, t + 0.08);
    duck.gain.linearRampToValueAtTime(1, t + 2.5 + 3 * k);
  }
  function crack(p, strength) {
    if (!ctx) return; emit('crack', p);
    const e = emitter(p, 400, 0.4);
    nwave(e.inp, e.t, 1.0 * (strength || 1), 1);
    noise(e.inp, e.t, { buf: 'white', type: 'highpass', f: 2500, d: 0.03, peak: 0.3, a: 0.0005 });
  }
  // Target break-up after a kill: fuel flash + secondary pops, then fragments whistle down and land.
  function breakup(p) {
    if (!ctx) return; emit('breakup', p);
    const e = emitter(p, 70, 0.6), t = e.t, x = e.inp;
    noise(x, t + 0.1, { buf: 'brown', f: 500, d: 2.2, peak: 0.9, a: 0.25 });                    // fuel fireball whoomp
    for (let i = 0; i < 3; i++) noise(x, t + 0.5 + i * 0.4 + Math.random() * 0.3, { buf: 'brown', f: 900, d: 0.3, peak: 0.4, a: 0.003 });
    const alt = Math.max(0, p.y || 0);
    const fall = Math.min(24, Math.sqrt(2 * alt / 9.81) * 1.6 + 1);                           // with drag
    for (let i = 0; i < 5; i++) {                                                              // tumbling fragments whistling down
      const q = { x: p.x + (Math.random() - 0.5) * 400, y: alt * 0.35, z: p.z + (Math.random() - 0.5) * 400 };
      const ee = emitter(q, 12, 0.2), tt = ee.t + fall * (0.5 + Math.random() * 0.3);
      tone(ee.inp, tt, { f0: 900 + Math.random() * 800, f1: 300 + Math.random() * 200, d: 1.5 + Math.random(), peak: 0.08, a: 0.4, type: 'sine' });
    }
    for (let i = 0; i < 4; i++) {                                                              // pieces hitting the ground
      const q = { x: p.x + (Math.random() - 0.5) * 600, y: 0, z: p.z + (Math.random() - 0.5) * 600 };
      const ee = emitter(q, 30, 0.4), tt = ee.t + fall * (0.9 + Math.random() * 0.4);
      noise(ee.inp, tt, { buf: 'brown', f: 600, d: 0.5, peak: 0.6, a: 0.002 });
      ring(ee.inp, tt, [310 + Math.random() * 200, 870], 0.5, 0.05);
    }
  }

  /* ------------------------------------------------------ game integration
   * bindGame(RS, opts) subscribes to the frozen event contract:
   *   LAUNCH     → cold/hot launch at the launcher + a flight loop following RS.sim.state.missiles[id]
   *   INTERCEPT  → warhead of that SAM at the intercept point;  MISS → self-destruct pop a moment later
   *   KILL       → break-up + falling debris (also for gun kills)
   *   ARM_IMPACT → ARM warhead at the radar;  ASSET_HIT → warhead of the attacker's kind at the asset
   *   and every frame (update): any cruise_missile / arm_missile in RS.sim.state.visible gets a flight loop
   * opts.launcherPos(launcherId) → scene {x,y,z}; opts.radarPos; opts.assetPos (scene metres). */
  function bindGame(RS, opts) {
    opts = opts || {};
    const lpos = opts.launcherPos || (id => ({ L1: { x: -45, y: 0, z: -30 }, L2: { x: 45, y: 0, z: -30 }, L3: { x: 0, y: 0, z: -70 } }[id] || { x: 0, y: 0, z: -40 }));
    const at = (v, d) => { const p = typeof v === 'function' ? v() : v; return p && isFinite(p.x) ? p : d; };   // [RS] fn or object
    const radarPos = () => at(opts.radarPos, { x: 0, y: 6, z: 60 });
    const assetPos = () => at(opts.assetPos, { x: 0, y: 0, z: 400 });
    const toScene = (x, y, alt) => ({ x: x * 1000, y: alt, z: -y * 1000 });
    const mKind = {}, tracked = new Map(), lastKind = {}, lastLaunchAt = {};
    const S = () => RS.sim && RS.sim.state;
    RS.bus.on('LAUNCH', ev => {
      const kind = ev.weapon === 'dart' ? 'missile_dart' : 'missile_lance';
      mKind[ev.missileId] = kind;
      const lp = lpos(ev.launcherId), w = prof(kind), t0 = ctx ? ctx.currentTime : 0;
      launch(kind, lp);
      // [RS] salvo surge (ref clip 3): a second motor lighting while the first still roars thickens and swells the combined sound
      if (ctx && lastLaunchAt[ev.launcherId] !== undefined && t0 - lastLaunchAt[ev.launcherId] < 3.5) {
        const e = emitter({ x: lp.x, y: (lp.y || 0) + 40, z: lp.z }, 90, 0.45), ts = e.t + (w.launch === 'cold' ? (w.ignite || 0.85) : 0);
        noise(e.inp, ts, { buf: 'pink', type: 'bandpass', f: 1500, f1: 650, q: 0.5, d: 5.5, peak: 1.1, a: 0.6 });   // slow swell: two motors beating
        noise(e.inp, ts + 0.1, { buf: 'crackle', type: 'bandpass', f: 2600, q: 0.7, d: 4.0, peak: 0.6, a: 0.4 });  // denser tearing
      }
      lastLaunchAt[ev.launcherId] = t0;
      // [RS] the sim moves in 20 Hz steps; feed the audio a smoothed, continuous path (steps made the roar warble/stutter).
      // The sim starts the round where the sim launcher is; bleed off the offset to the scene TEL over ~6 s.
      const sm = { p: null, v: { x: 0, y: 0, z: 0 }, st: -1, at: 0, off: null, q: null, last: 0 };
      flight(kind, tt => {
        const st = S(), m = st && st.missiles.find(q => q.id === ev.missileId);
        if (!m) return { alive: false };
        const P = toScene(m.x, m.y, m.alt);
        if (!sm.off) sm.off = { x: lp.x - P.x, z: lp.z - P.z };
        if (st.t !== sm.st) {
          if (sm.p && st.t > sm.st) { const k = 1 / (st.t - sm.st); sm.v = { x: (P.x - sm.p.x) * k, y: (P.y - sm.p.y) * k, z: (P.z - sm.p.z) * k }; }
          sm.p = P; sm.st = st.t; sm.at = tt;
        }
        const ex = Math.min(0.15, tt - sm.at), dec = Math.exp(-tt / 6);
        const tx = sm.p.x + sm.v.x * ex + sm.off.x * dec, ty = sm.p.y + sm.v.y * ex, tz = sm.p.z + sm.v.z * ex + sm.off.z * dec;
        const dt = Math.max(0, Math.min(0.1, tt - sm.last)); sm.last = tt;
        if (!sm.q) sm.q = { x: tx, y: ty, z: tz };
        else {                                   // dead-reckon on the sim velocity, pull gently toward the sim position
          const a = Math.min(1, dt / 0.25);
          sm.q.x += sm.v.x * dt + (tx - sm.q.x) * a; sm.q.y += sm.v.y * dt + (ty - sm.q.y) * a; sm.q.z += sm.v.z * dt + (tz - sm.q.z) * a;
        }
        return { x: sm.q.x, y: sm.q.y, z: sm.q.z, vx: sm.v.x, vy: sm.v.y, vz: sm.v.z };
      }, { ignite: w.launch === 'cold' ? w.ignite : 0, maxStretch: 0.45 });
    });
    RS.bus.on('INTERCEPT', ev => detonate(mKind[ev.missileId] || 'missile_lance', toScene(ev.x, ev.y, ev.alt), { ground: false }));
    RS.bus.on('MISS', ev => {
      const m = S() && S().missiles.find(q => q.id === ev.missileId);
      if (m) detonate(mKind[ev.missileId] || 'missile_lance', toScene(m.x, m.y, m.alt), { kg: 15, ground: false });
    });
    RS.bus.on('KILL', ev => breakup(toScene(ev.x, ev.y, ev.alt)));
    RS.bus.on('ARM_IMPACT', () => detonate('arm_missile', radarPos(), { ground: true }));
    RS.bus.on('ASSET_HIT', ev => detonate(lastKind[ev.byId] || 'cruise_missile', assetPos(), { ground: true }));
    RS.bus.on('SHIFT_START', () => { stopAll(); tracked.clear(); for (const k in mKind) delete mKind[k]; for (const k in lastKind) delete lastKind[k]; for (const k in lastLaunchAt) delete lastLaunchAt[k]; });   // [RS] entity ids restart per shift
    const prevUpdate = api.update;
    api.update = function () {
      const st = S();
      if (st && st.visible) {
        st.visible.forEach(v => {
          if ((v.kind === 'cruise_missile' || v.kind === 'arm_missile') && !tracked.has(v.id)) {
            lastKind[v.id] = v.kind;
            tracked.set(v.id, flight(v.kind, () => {
              const q = S().visible.find(z => z.id === v.id);
              return q ? toScene(q.x, q.y, q.alt) : { alive: false };
            }, { ignite: 0 }));
          }
        });
      }
      prevUpdate();
    };
  }

  const api = {
    version: 'sfx-1.0', profiles: P, attach, launch, flight, fire, detonate, breakup, crack, update, stopAll, bindGame,
    setListener(p, heading) { Object.assign(L, p || {}); if (heading !== undefined) L.heading = heading; },
    setVolume(v) { if (master) master.gain.value = v; },
    get ctx() { return ctx; },
    get active() { return handles.size; },
    SPEED_OF_SOUND: C
  };
  window.RSSfx = api;
  if (window.RS) window.RS.sfx = api;
})();
