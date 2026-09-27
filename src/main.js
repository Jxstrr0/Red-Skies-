/* =====================================================================
   RED SKIES — main.js   RS.main : boot, fixed-step loop, resize, save/load.
   ===================================================================== */
(function () {
  const RS = window.RS;
  const SAVE_KEY = 'redskies.v1.';

  // localStorage wrapper: never throws, falls back to memory (private mode, blocked storage)
  const mem = {};
  RS.save = function (key, value) {
    const s = JSON.stringify(value);
    mem[key] = s;
    try { localStorage.setItem(SAVE_KEY + key, s); return true; } catch (e) { return false; }
  };
  RS.load = function (key, fallback) {
    let s = null;
    try { s = localStorage.getItem(SAVE_KEY + key); } catch (e) { /* blocked */ }
    if (s == null) s = mem[key];
    if (s == null) return fallback;
    try { return JSON.parse(s); } catch (e) { return fallback; }
  };

  let started = false, prepared = false, acc = 0, last = 0, frames = 0, fpsT = 0, fps = 0, debugOn = false;
  let paused = false, held = false, curDef = null;                          // pause freezes the sim step only; render keeps running
  RS.bus.on('SHIFT_START', p => { curDef = p.def || curDef; });
  const $ = id => document.getElementById(id);

  function resize() {
    const h = $('hatch');
    if (RS.scene && h) RS.scene.resize(h.clientWidth, h.clientHeight);
  }

  // V1.4.3 perf: ~60 fps cap on 90/120 Hz screens (frame-budget accumulator, so 90 Hz still averages 60), and no 3-D render
  // while an opaque menu (pause, debrief, map, briefing…) or the ROTATE cover hides it; the sim keeps its own clock
  const FRAME_MS = 1000 / 60;
  let capAcc = 0, capPrev = 0, rotMq = null;
  try { rotMq = window.matchMedia('(orientation: landscape) and (max-height: 560px)'); } catch (e) { /* */ }
  function covered() {
    const m = $('meta');
    return (!!(m && m.classList.contains('on')) && !document.body.classList.contains('titling')) || !!(rotMq && rotMq.matches);
  }
  RS.covered = covered;
  function frame(now) {
    requestAnimationFrame(frame);
    const gap = capPrev ? now - capPrev : FRAME_MS; capPrev = now;
    capAcc = Math.min(capAcc + gap, 3 * FRAME_MS);
    if (capAcc < FRAME_MS - 1) return;
    capAcc = Math.max(0, capAcc - FRAME_MS);
    const dt = Math.min(0.25, Math.max(0, (now - last) / 1000));
    last = now;
    acc += dt;
    let n = 0;
    if (paused || held) acc = 0;
    while (acc >= RS.SIM_DT && n < 5) { RS.sim.step(); acc -= RS.SIM_DT; n++; }
    if (n === 5) acc = 0;                                  // clamp catch-up
    if (!covered()) RS.scene.render(dt, RS.sim.state);
    frames++; fpsT += dt;
    if (fpsT >= 0.5) {
      fps = frames / fpsT; frames = 0; fpsT = 0;
      if (debugOn) $('debug').textContent = `FPS ${fps.toFixed(0)}  TRK ${RS.sim.state.tracks.length}  VIS ${RS.sim.state.visible.length}  T ${RS.sim.state.t.toFixed(0)}s`;
    }
  }

  // v19: the world is built at page load (no gesture needed) so the cover page can run the live scene behind the title
  function prepare() {
    if (prepared) return;
    prepared = true;
    RS.sim.init({ content: RS.content });
    RS.scene.init({ canvas: $('view'), models: RS.models });
    RS.ui.init({ root: $('desk'), sim: RS.sim });
    if (RS.title) RS.title.prepare();
    resize();
    last = performance.now();
    requestAnimationFrame(frame);
  }
  function start() {
    if (started) return;
    prepare();
    started = true;
    RS.audio.init();                                        // first user gesture
    if (RS.title) RS.title.begin();
    $('boot').classList.add('gone');
    if (RS.meta && RS.meta.init) RS.meta.init();           // main menu; meta starts shifts
    else RS.sim.startShift(RS.content.shifts[0]);
    resize();
  }

  function boot() {
    $('start').addEventListener('click', start);
    $('title').addEventListener('click', () => {
      debugOn = !debugOn;
      $('debug').hidden = !debugOn;
      RS.bus.emit('UI_TAP', { what: 'button' });
    });
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', () => setTimeout(resize, 200));
    // V1.4.3: the ROTATE TO PORTRAIT cover hides the game, so pause the shift under it (the pause menu waits for the player)
    try {
      const mq = window.matchMedia('(orientation: landscape) and (max-height: 560px)');
      const onRot = () => { if (mq.matches && RS.meta && RS.meta.pause) RS.meta.pause(); };
      if (mq.addEventListener) mq.addEventListener('change', onRot); else if (mq.addListener) mq.addListener(onRot);
    } catch (e) { /* no matchMedia */ }
    // stop double-tap zoom / pinch on iOS
    document.addEventListener('gesturestart', e => e.preventDefault());
    // (double-tap zoom is disabled via touch-action: manipulation in CSS)
    if (typeof THREE === 'undefined') {
      $('start').textContent = 'THREE.JS FAILED TO LOAD';
      $('start').disabled = true;
      $('boot').classList.add('s1', 's2', 's3', 's4');
    } else {
      try { prepare(); } catch (e) { console.error('[main] prepare', e); $('boot').classList.add('s1', 's2', 's3', 's4'); }
    }
  }

  /** Restart the current shift def (ends the running one with reason 'restart' first so listeners clean up). */
  function restart() {
    if (!started) return start();
    if (paused) { paused = false; RS.bus.emit('PAUSE', { paused: false }); }
    if (RS.sim.state.shift.running) RS.sim.endShift('restart');
    RS.sim.startShift(curDef || RS.content.shifts[0]);
  }
  function pause() { if (!started) return false; if (!paused) { paused = true; RS.bus.emit('PAUSE', { paused: true }); } return true; }
  function resume() { const was = paused; paused = false; acc = 0; if (was) RS.bus.emit('PAUSE', { paused: false }); return true; }

  /** Freeze the sim silently (no PAUSE event, audio/voice keep going). Used by the tutorial for text-only steps. */
  function hold(v) { held = !!v; if (!held) acc = 0; return held; }
  RS.bus.on('SHIFT_START', () => { held = false; });

  RS.main = { start, restart, resize, pause, resume, hold, get held() { return held; },
    get fps() { return fps; }, get started() { return started; }, get paused() { return paused; }, get def() { return curDef; } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
