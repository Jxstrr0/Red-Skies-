/* =====================================================================
   RED SKIES — eo.js   RS.eo : EO tracker overlay (V1.3). The picture is drawn by RS.scene (RS.scene.eo: inset on the hatch
   canvas); this module adds the symbology on top: reticle, tracking gate, readouts (mode, track, range, bearing, elevation,
   zoom/FOV), status (NO TRACK / OUT OF RANGE / SLEWING / COAST), SPLASH / MISS flash for the watched track, the TV/IR soft-key
   and the grey soft-key strip. Tap the picture → swap.
   V1.4: #eo is a fixed-size box (EO_W×EO_H CSS px, the EO monitor's picture) projected onto the cabin's EO monitor by RS.cabin
   (bind 'eo'); swapped, it is sized to the swapped rect (the cabin view above the radar monitor) and only translated.
   Injects its own DOM (into #hatch, under the radar console and the HUD) + <style>; self-inits on DOMContentLoaded; runs on rAF.
   API: RS.eo = { init(), update(), debug() }
   ===================================================================== */
(function () {
  const RS = window.RS;
  const CSS = `
#eo { position: absolute; z-index: 1; left: 0; top: 0; width: 176px; height: 132px; transform-origin: 0 0; will-change: transform;
  pointer-events: none; font-family: var(--mono, monospace); display: none; }
#eo-bez { display: none; }
#eo.night #eo-strip, #eo.night #eo-key span { filter: brightness(.5) saturate(.8); }
#eo.on { display: block; }
/* grey Pantsir bezel: a ring drawn with box-shadows around the (transparent) video rect + a soft-key strip on its left */
#eo-bez { position: absolute; border-radius: 1px;
  box-shadow: 0 0 0 1px #202427, 0 0 0 2px #5b6064, 0 0 0 5px #8b9094, 0 0 0 6px #a9aeb1, 0 0 0 7px #54595d, 0 3px 9px 7px rgba(0,0,0,.45); }
#eo-strip { position: absolute; border-radius: 5px 0 0 5px; background: linear-gradient(90deg, #767b7f, #979c9f 35%, #8b9094 80%, #7c8185);
  box-shadow: -1px 0 0 #54595d, 0 1px 0 #54595d, 0 -1px 0 #54595d, 0 3px 9px rgba(0,0,0,.45); }
#eo-strip .lbl { position: absolute; left: 0; right: 0; top: 5px; text-align: center; font-size: 8px; font-weight: 700; letter-spacing: .06em;
  color: #262a2d; text-shadow: 0 1px 0 rgba(255,255,255,.4); }
#eo-strip .lamp { position: absolute; left: 50%; margin-left: -6px; width: 12px; height: 6px; border-radius: 1px; box-shadow: 0 0 0 1px #2a2e31, 0 1px 0 1px rgba(255,255,255,.25); }
#eo-strip .lamp.trk { top: 17px; } #eo-strip .lamp.mode { top: 27px; }
#eo-key { position: absolute; width: 48px; height: 48px; pointer-events: auto; touch-action: manipulation; }
#eo-key span { position: absolute; right: 3px; top: 7px; width: 18px; height: 34px; border-radius: 3px;
  background: linear-gradient(#d3d6d8, #b3b8bb); box-shadow: 0 1px 0 rgba(255,255,255,.7) inset, 0 -1px 1px rgba(0,0,0,.25) inset, 0 1px 2px rgba(0,0,0,.45);
  color: #23272a; text-shadow: 0 1px 0 rgba(255,255,255,.55); font-size: 10px; font-weight: 700; line-height: 1.05; display: flex; flex-direction: column;
  align-items: center; justify-content: center; letter-spacing: .02em; }
#eo-key span b { font-size: 6px; font-weight: 700; letter-spacing: .03em; }
#eo-key:active span, #eo-key.down span { background: linear-gradient(#b3b8bb, #c9ccce); transform: translateY(1px); }
#eo-tap { position: absolute; pointer-events: auto; touch-action: manipulation; background: transparent; }
#eo-fr { position: absolute; overflow: hidden; color: #eafff0; text-shadow: 0 0 2px #000, 0 0 1px #000; }
#eo-fr.ir { color: #ffffff; }
#eo-fr .ro { position: absolute; font-size: 9px; line-height: 1.15; white-space: pre; letter-spacing: .02em; }
#eo-fr.big .ro { font-size: 11px; }
#eo-ret i { position: absolute; background: currentColor; box-shadow: 0 0 1px #000; opacity: .9; }
#eo-gate { position: absolute; display: none; }
#eo-gate i { position: absolute; width: 28%; height: 28%; border: 0 solid currentColor; filter: drop-shadow(0 0 1px #000); }
#eo-gate i:nth-child(1) { left: 0; top: 0; border-left-width: 1.5px; border-top-width: 1.5px; }
#eo-gate i:nth-child(2) { right: 0; top: 0; border-right-width: 1.5px; border-top-width: 1.5px; }
#eo-gate i:nth-child(3) { left: 0; bottom: 0; border-left-width: 1.5px; border-bottom-width: 1.5px; }
#eo-gate i:nth-child(4) { right: 0; bottom: 0; border-right-width: 1.5px; border-bottom-width: 1.5px; }
#eo-stat { position: absolute; left: 0; right: 0; text-align: center; font-size: 10px; font-weight: 700; letter-spacing: .12em; }
#eo-stat.warn { color: #ffcf5a; } #eo-stat.bad { color: #ff8a7a; }
#eo-stat.blink { animation: eoblink 1s steps(2, start) infinite; }
#eo-flash { position: absolute; left: 50%; top: 27%; transform: translate(-50%, -50%); display: none; padding: 2px 7px; border: 1.5px solid currentColor;
  font-size: 15px; font-weight: 700; letter-spacing: .16em; background: rgba(0,0,0,.35); }
#eo-flash.on { display: block; animation: eofl 2.2s linear forwards; }
#eo-flash.kill { color: #ffffff; } #eo-flash.miss { color: #ffcf5a; }
#eo-fr.big #eo-flash { font-size: 22px; }
@keyframes eoblink { to { visibility: hidden; } }
@keyframes eofl { 0%, 58% { opacity: 1; } 62%, 70% { opacity: 0; } 74%, 84% { opacity: 1; } 88%, 100% { opacity: 0; } }
`;
  const $ = id => document.getElementById(id);
  let built = false, root, bez, strip, key, keyTxt, keyAuto, lampT, lampM, tapz, fr, ret, gate, ro = {}, stat, flash;
  let flashUntil = 0, lastFlash = null, last = {}, textAt = 0;
  const L0 = { x: -1, y: -1, w: -1, h: -1, W: -1, H: -1, sw: null };    // last laid-out geometry
  const txt = (el, k, v) => { if (last[k] !== v) { last[k] = v; el.textContent = v; } };
  const px = v => Math.round(v) + 'px';
  const EO_W = 176, EO_H = 132;                                     // layout size of the projected picture (4:3)
  function mk(tag, id, cls, parent, html) {
    const e = document.createElement(tag); if (id) e.id = id; if (cls) e.className = cls; if (html) e.innerHTML = html; (parent || root).appendChild(e); return e;
  }
  function init() {
    if (built) return true;
    const hatch = $('hatch');
    if (!hatch || !RS.scene || !RS.scene.eo) return false;
    const st = document.createElement('style'); st.id = 'eo-style'; st.textContent = CSS; document.head.appendChild(st);
    root = document.createElement('div'); root.id = 'eo';
    const view = $('view'); hatch.insertBefore(root, view ? view.nextSibling : hatch.firstChild);   // under the HUD + pause button
    bez = mk('div', 'eo-bez', '', root);
    strip = mk('div', 'eo-strip', '', root, '<span class="lbl">EO</span><i class="lamp trk"></i><i class="lamp mode"></i>');
    lampT = strip.querySelector('.lamp.trk'); lampM = strip.querySelector('.lamp.mode');
    fr = mk('div', 'eo-fr');
    ret = mk('div', 'eo-ret', '', fr, '<i></i><i></i><i></i><i></i>');
    gate = mk('div', 'eo-gate', '', fr, '<i></i><i></i><i></i><i></i>');
    for (const k of ['tl', 'tr', 'bl', 'br']) ro[k] = mk('div', null, 'ro ' + k, fr);
    stat = mk('div', 'eo-stat', '', fr);
    flash = mk('div', 'eo-flash', '', fr);
    tapz = mk('button', 'eo-tap'); tapz.setAttribute('aria-label', 'Swap tracker camera and battery view');
    key = mk('button', 'eo-key', '', root, '<span><em></em><b></b></span>'); key.setAttribute('aria-label', 'Tracker camera TV / IR');
    keyTxt = key.querySelector('em'); keyTxt.style.fontStyle = 'normal'; keyAuto = key.querySelector('b');
    if (RS.cabin) RS.cabin.bind(root, 'eo');
    tapz.addEventListener('click', ev => { ev.stopPropagation(); if (RS.scene.eo.toggleSwap() !== false) RS.bus.emit('UI_TAP', { what: 'button' }); update(); });
    key.addEventListener('click', ev => {
      ev.stopPropagation();
      const s = RS.scene.eo.state; RS.scene.eo.setMode(s.mode === 'TV' ? 'IR' : 'TV');
      RS.bus.emit('UI_TAP', { what: 'button' }); update();
    });
    key.addEventListener('pointerdown', () => key.classList.add('down'));
    for (const e of ['pointerup', 'pointercancel', 'pointerleave']) key.addEventListener(e, () => key.classList.remove('down'));
    // SPLASH / MISS for the watched track (the scene still holds its id while the sim clears the selection)
    const watched = p => { const s = RS.scene.eo.state; return s.on && s.trackId && (p.targetId === s.trackId || p.trackId === s.trackId); };
    RS.bus.on('KILL', p => { if (watched(p)) doFlash('kill', 'SPLASH'); });
    RS.bus.on('MISS', p => { if (watched(p)) doFlash('miss', 'MISS'); });
    RS.bus.on('SHIFT_START', () => { flashUntil = 0; flash.className = ''; });
    built = true;
    const loop = () => { try { if (!(RS.covered && RS.covered())) update(); } catch (e) { console.error('[eo]', e); } requestAnimationFrame(loop); };   // V1.4.3: idle under menus
    requestAnimationFrame(loop);
    return true;
  }
  function doFlash(kind, text) {
    const ms = RS.eo.flashMs || 2200;                   // tests stretch it (software GL runs ~1 fps)
    flashUntil = performance.now() + ms; lastFlash = { text, at: Date.now() };
    flash.textContent = text; flash.style.animationDuration = ms + 'ms';
    flash.className = ''; void flash.offsetWidth; flash.className = 'on ' + kind;   // restart the blink
  }
  const f1 = (v, n) => (v < 0 ? '-' : '') + Math.abs(v).toFixed(n);
  const pad3 = v => String(Math.round(v) % 360).padStart(3, '0');
  function update() {
    if (!built) return;
    const s = RS.scene && RS.scene.eo && RS.scene.eo.state;
    if (!s || !s.on || !s.rect) { if (root.classList.contains('on')) root.classList.remove('on'); return; }
    if (!root.classList.contains('on')) root.classList.add('on');
    const r = s.rect, sw = !!s.swapped, FW = sw ? Math.round(r.w) : EO_W, FH = sw ? Math.round(r.h) : EO_H;
    // layout (only when the geometry changes): the frame, tap zone and readouts fill the box; the strip + TV/IR key sit on the
    // monitor's left bezel (swapped: the key inside the frame, bottom-left)
    if (FW !== L0.w || FH !== L0.h || sw !== L0.sw) {
      L0.w = FW; L0.h = FH; L0.sw = sw; textAt = 0; last.gap = -1;
      root.style.width = px(FW); root.style.height = px(FH);
      strip.style.display = sw ? 'none' : '';
      Object.assign(strip.style, { left: px(-30), top: px(-4), width: px(26), height: px(FH + 8) });
      Object.assign(tapz.style, { left: '0px', top: '0px', width: px(FW), height: px(FH) });
      Object.assign(key.style, sw ? { left: px(FW - 54), top: px(FH - 54) } : { left: px(-48), top: px(FH - 50) });   // 48 px: ≥ 44 on screen once projected
      Object.assign(fr.style, { left: '0px', top: '0px', width: px(FW), height: px(FH) });
      fr.classList.toggle('big', !!s.swapped);
      // readouts: corners of the EO frame; swapped → left column (the battery inset sits bottom-right, the HUD on top)
      const m = s.swapped ? 8 : 4, top = s.swapped ? 46 : 3;
      const put = (e, x, y, right) => { e.style.left = right ? '' : px(x); e.style.right = right ? px(x) : ''; e.style.top = px(y); e.style.textAlign = right ? 'right' : 'left'; };
      if (s.swapped) { put(ro.tl, m, top); put(ro.tr, m, top + 16); put(ro.bl, m, FH - 40); put(ro.br, m, FH - 24); }
      else { put(ro.tl, m, top); put(ro.tr, m, top, true); put(ro.bl, m, FH - 14); put(ro.br, m, FH - 14, true); }
      stat.style.top = px(FH * 0.77 - 5);
    }
    const now = performance.now();
    if (now >= textAt) {                                 // readouts, status, key + lamps at ~10 Hz (the gate moves every frame)
      textAt = now + 100;
      const E = RS.scene.debug && RS.scene.debug.env, nt = !!(E && E.night);
      if (last.nt !== nt) { last.nt = nt; root.classList.toggle('night', nt); }
      if (last.ir !== s.mode) { last.ir = s.mode; fr.classList.toggle('ir', s.mode === 'IR'); }
      txt(ro.tl, 'tl', s.mode + (s.auto ? ' AUTO' : '') + '  ' + (s.trackId || '---'));
      txt(ro.tr, 'tr', s.hasTarget || s.holding ? f1(s.rangeKm, s.rangeKm < 10 ? 2 : 1) + ' KM' : '--.- KM');
      txt(ro.bl, 'bl', 'B' + pad3(s.brgDeg) + ' E' + f1(s.elDeg, 1));
      txt(ro.br, 'br', '×' + Math.round(s.zoom) + ' ' + (s.fovDeg < 1 ? s.fovDeg.toFixed(2) : s.fovDeg.toFixed(1)) + '°');
      const st = !s.hasTarget && !s.holding ? 'NO TRACK' : s.holding ? 'COAST' : !s.inRange ? 'OUT OF RANGE' : s.slewing ? 'SLEWING' : '';
      txt(stat, 'st', st);
      const cls = st === 'OUT OF RANGE' ? 'bad blink' : st === 'SLEWING' || st === 'COAST' ? 'warn' : st ? 'blink' : '';
      if (last.cls !== cls) { last.cls = cls; stat.className = cls; }
      txt(keyTxt, 'k', s.mode); txt(keyAuto, 'ka', s.auto ? 'AUTO' : 'MAN');
      const lt = s.hasTarget && s.inRange && !s.slewing ? '#39d353' : s.hasTarget || s.holding ? '#f0b429' : '#4a4f53';
      if (last.lt !== lt) { last.lt = lt; lampT.style.background = lt; }
      const lm = s.auto ? '#39d353' : '#f0b429';
      if (last.lm !== lm) { last.lm = lm; lampM.style.background = lm; }
    }
    // gate (0..1 in the EO frame)
    const G = s.gate;
    if (G) {
      if (gate.style.display !== 'block') gate.style.display = 'block';
      gate.style.left = px(G.x * FW); gate.style.top = px(G.y * FH); gate.style.width = px(G.w * FW); gate.style.height = px(G.h * FH);
    } else if (gate.style.display !== 'none') gate.style.display = 'none';
    // reticle: thin boresight cross whose centre gap opens around the gate
    const gapK = Math.round(Math.max(0.09, G ? Math.max(G.w, G.h * 0.75) / 2 + 0.035 : 0.09) * 100);
    if (last.gap !== gapK) {
      last.gap = gapK;
      const cx = Math.round(FW / 2), cy = Math.round(FH / 2), g = FW * gapK / 100, L = FW * 0.13, arms = ret.children;
      Object.assign(arms[0].style, { left: px(cx - g - L), top: px(cy), width: px(L), height: '1px' });
      Object.assign(arms[1].style, { left: px(cx + g), top: px(cy), width: px(L), height: '1px' });
      Object.assign(arms[2].style, { left: px(cx), top: px(cy - g - L * 0.7), width: '1px', height: px(L * 0.7) });
      Object.assign(arms[3].style, { left: px(cx), top: px(cy + g), width: '1px', height: px(L * 0.7) });
    }
    const op = s.hasTarget && !s.slewing ? '0.6' : '0.9';
    if (last.op !== op) { last.op = op; ret.style.opacity = op; }
    if (flashUntil && now > flashUntil) { flashUntil = 0; flash.className = ''; }
  }
  function debug() {
    const s = RS.scene && RS.scene.eo ? RS.scene.eo.state : null, b = e => { const q = e.getBoundingClientRect(); return { x: q.x, y: q.y, w: q.width, h: q.height }; };
    return { built, on: !!(root && root.classList.contains('on')), status: stat ? stat.textContent : '', flash: flashUntil ? flash.textContent : '', lastFlash,
      readouts: built ? { tl: ro.tl.textContent, tr: ro.tr.textContent, bl: ro.bl.textContent, br: ro.br.textContent } : null,
      gate: built && gate.style.display === 'block' ? b(gate) : null, frame: built ? b(fr) : null, tap: built ? b(tapz) : null, key: built ? b(key) : null,
      keyText: built ? keyTxt.textContent + ' ' + keyAuto.textContent : '', swapped: s ? s.swapped : false };
  }
  RS.eo = { init, update, debug, flashMs: 2200 };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  RS.bus.on('SIM_TICK', () => { if (!built) init(); });
})();
