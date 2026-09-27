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
  let paused = false, curDef = null;                          // pause freezes the sim step only; render keeps running
  RS.bus.on('SHIFT_START', p => { curDef = p.def || curDef; });
  const $ = id => document.getElementById(id);

  function resize() {
    const h = $('hatch');
    if (RS.scene && h) RS.scene.resize(h.clientWidth, h.clientHeight);
  }

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.25, Math.max(0, (now - last) / 1000));
    last = now;
    acc += dt;
    let n = 0;
    if (paused) acc = 0;
    while (acc >= RS.SIM_DT && n < 5) { RS.sim.step(); acc -= RS.SIM_DT; n++; }
    if (n === 5) acc = 0;                                  // clamp catch-up
    RS.scene.render(dt, RS.sim.state);
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
    paused = false;
    if (RS.sim.state.shift.running) RS.sim.endShift('restart');
    RS.sim.startShift(curDef || RS.content.shifts[0]);
  }
  function pause() { if (!started) return false; paused = true; return true; }
  function resume() { paused = false; acc = 0; return true; }

  RS.main = { start, restart, resize, pause, resume,
    get fps() { return fps; }, get started() { return started; }, get paused() { return paused; }, get def() { return curDef; } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
