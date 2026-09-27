/* =====================================================================
   RED SKIES — ui.js   RS.ui : desk monitors + thumb zone.
   Layout: radar scope always visible; TRACK/IFF, BATTERY, COMMS/LOG are tabs below it.
   Reads RS.sim.state (never .visible, never true kinds). Writes only via RS.sim.cmd.
   Panels redraw ≤10 Hz on SIM_TICK (active tab only); the scope redraws every animation frame.
   V1.3 Pantsir-style scope console (#p-scope; only this panel is light): grey bezel, status cell row (TX/EMCON, ROE,
   TRK, RDR %, JAM, DEGR; the ARM/alarm strip #alertstrip lights red over the right-hand cells), left soft-keys
   (◀ ▶ ZOOM), light-blue round PPI (#scope canvas) and a range-height strip (#hstrip: range 0…zoom, altitude sqrt 0…15 km).
   Scope input: tap near a track → snaps to nearest; drag finger → selection follows nearest track; tap one of our
   missiles → selects that missile's target (the EO camera watches it); tap in the strip → nearest track there;
   ZOOM key cycles display range 100/60/30/15 km (display only, radar range unchanged).
   Thumb zone: RADAR · IFF · FRIEND · HOSTILE · ASSIGN (tap = best launcher, long-press = picker)
   · FIRE (guarded: tap lifts the cover, then press-and-hold 0.6 s; label names the assigned launcher).
   Launcher strip (above the thumb zone): one chip per launcher; with a track selected each chip shows
   sim.query.engage (green Pk / grey reason). Tap chip = assign, tap the assigned chip = clear.
   Classifying a track HOSTILE with no assignment auto-assigns sim.query.bestLauncher.
   ===================================================================== */
(function () {
  const RS = window.RS;
  const D2R = Math.PI / 180, LOG_MAX = 60;
  const ZOOMS = [100, 60, 30, 15], RINGS = { 100: [25, 50, 75, 100], 60: [10, 20, 40, 60], 30: [10, 20, 30], 15: [5, 10, 15] };
  const SNAP_PX = 70, DRAG_PX = 110, HYST_PX = 10;
  const HOLD_MS = 600, COVER_IDLE_MS = 6000, LONG_MS = 500, TOAST_MS = 2000, TOP_PAD = 12;
  const ALARM_ORDER = ['arm', 'fratricide', 'asset', 'leaker', 'radar', 'lowammo'];
  const ALARM_TXT = { arm: 'ARM INBOUND · GO SILENT', fratricide: 'FRATRICIDE · CEASE FIRE', asset: 'DEFENDED ASSET HIT',
    leaker: 'LEAKER INSIDE DEFENDED LINE', radar: 'RADAR DEGRADED', lowammo: 'LOW AMMO · RELOAD' };
  const REASON = {
    roe_hold: 'ROE HOLD: weapons hold, no fire', roe_tight_not_hostile: 'ROE TIGHT: classify HOSTILE first',
    classified_friend: 'Track is FRIEND: cannot engage', not_assigned: 'Not assigned: press ASSIGN first',
    not_ready: 'Launcher not ready', no_rounds: 'No rounds: reload launcher', out_of_range: 'Out of range',
    too_close: 'Too close: inside minimum range', radar_off: 'Radar off: no fire-control solution',
    jammed: 'Launcher jammed', no_track: 'Track lost'
  };
  const SHORT = { roe_tight_not_hostile: 'ROE TIGHT', roe_hold: 'ROE HOLD', classified_friend: 'FRIEND', out_of_range: 'OUT OF RNG',
    too_close: 'TOO CLOSE', not_ready: 'NOT READY', no_rounds: 'NO ROUNDS', radar_off: 'RADAR OFF' };
  const IFF_LBL = { NONE: ['SEND', ''], PENDING: ['', 'pend'], FRIEND: ['FRND', 'ok'], NO_RESPONSE: ['NO RSP', 'amber'], INVALID: ['INVLD', 'red'] };
  const WLBL = { lance: 'LANCE', dart: 'DART', harrow: 'GUN' };
  const CHIP_R = { out_of_range: 'OUT RNG', too_close: 'TOO CLOSE', no_rounds: 'NO RNDS', not_ready: 'RELOAD', roe_hold: 'ROE HOLD',
    roe_tight_not_hostile: 'ROE TIGHT', classified_friend: 'FRIEND', radar_off: 'NO RADAR', jammed: 'JAM', no_track: 'NO TRACK' };
  const CROWD_PX = 22, KEY_W = 46, STRIP_MIN = 64, STRIP_SNAP_PX = 40;
  // V1.3 light-glass palette (Pantsir style): dark NATO-style symbols on light-blue glass
  const CLS_COL = { UNKNOWN: [176, 102, 0], HOSTILE: [214, 22, 30], FRIEND: [18, 72, 204] };   // symbols
  const CLS_TXT = { UNKNOWN: [118, 66, 0], HOSTILE: [168, 12, 20], FRIEND: [12, 54, 160] };    // data tags (darker: small text)
  const INK = '#0a1d2e', ACT = '#007d72', RED = '#d4161e';
  const GLASS = [['#c4e6f2', '#a9d6e8'], ['#d0dbdf', '#b5c5cb']];                               // [transmitting, silent]
  const SWEEP = [];                                                                           // fading wedge behind the sweep line
  for (let i = 0; i < 22; i++) SWEEP.push('rgba(18,76,128,' + (0.26 * (1 - i / 22)).toFixed(3) + ')');
  const glass = [null, null];

  let sim, root, scope, sctx, dpr = 1, W = 0, H = 0, cx = 0, cy = 0, R = 1, inited = false;
  let tab = 'track', viewKm = 100, lastPanelAt = 0, tickAt = 0, FF = 'monospace';
  let drag = null;                      // {id:pointerId, x, y} while finger is on the scope
  let warnLoggedAt = -1;                // emitTime of last logged RADAR_WARN (throttle)
  let frozen = false, frozenT = 0;      // no DOM rebuild of tab body / sheet while a finger is down on it
  let sheetOpen = false, press = null, noClickUntil = 0, toastT = 0, rejectSeen = false, lastRoe = null, alertOn = false, tickN = 0;
  const fire = { armed: false, holdAt: 0, lastAt: 0, pid: null, need: HOLD_MS };
  // Fast buttons act on pointerup (not the delayed/fragile synthesized click): thumb zone, launcher chips, zoom.
  const FAST = '#thumbzone [data-act], #lstrip [data-act], #b-zoom, #b-prev, #b-next, #b-repair';
  let fast = null;
  const log = [], cache = {}, alarms = {}, armIds = new Set(), trails = {};
  const $ = id => document.getElementById(id);
  const S = () => sim.state;
  const pad = (n, w) => String(n).padStart(w || 2, '0');
  const mmss = t => pad(Math.floor(Math.max(0, t) / 60)) + ':' + pad(Math.floor(Math.max(0, t) % 60));
  const tap = what => RS.bus.emit('UI_TAP', { what });
  const buzz = ms => { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) { } };
  const esc = t => String(t).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const setHTML = (el, key, html) => { if (el && cache[key] !== html) { cache[key] = html; el.innerHTML = html; } };
  const why = r => REASON[r] || String(r || 'rejected').replace(/_/g, ' ').toUpperCase();
  const short = r => SHORT[r] || String(r || '').replace(/_/g, ' ').toUpperCase();
  const selTrack = () => { const s = S(); return s.tracks.find(t => t.id === s.selectedId) || null; };
  const clsPill = c => c === 'HOSTILE' ? 'red' : c === 'FRIEND' ? 'cyan' : 'amber';
  const hasQ = () => !!(sim.query && sim.query.engage);
  const engage = (tid, lid) => { try { return hasQ() ? sim.query.engage(tid, lid) : null; } catch (e) { return null; } };
  const W_UP = w => String(w || '').toUpperCase();
  const lname = l => l.id + ' ' + (WLBL[l.weapon] || W_UP(l.weapon));
  const launcher = id => S().battery.launchers.find(l => l.id === id) || null;
  const pctTxt = q => Math.round((q.pk || 0) * 100) + '%';
  const chipWhy = (q, l) => q.reason === 'not_ready' && l && !l.jammed && l.reloadT > 0 ? 'RLD ' + Math.ceil(l.reloadT) + 's'
    : CHIP_R[q.reason] || short(q.reason).slice(0, 9) || '--';

  function addLog(text, cls) {
    log.unshift({ t: S().shift.elapsed, text, cls: cls || '' });
    if (log.length > LOG_MAX) log.length = LOG_MAX;
    if (cls === 'hi') flagComms();
  }
  function flagComms() { if (tab !== 'comms') { const tc = $('tab-comms'); if (tc) tc.classList.add('alert'); } }

  function toast(msg, cls) {
    const t = $('toast'); if (!t) return;
    t.textContent = msg; t.className = 'show ' + (cls || '');
    clearTimeout(toastT); toastT = setTimeout(() => { t.className = cls || ''; }, TOAST_MS);
  }

  /* ---------- scope geometry ---------- */
  /** V1.3 Pantsir console: #sbody = soft-key column | square PPI slot (#ppi) | height-strip column (#hcol).
   *  The #scope canvas lies over the slot with the classic geometry (cx = w/2, cy = (h + TOP_PAD)/2, R = min(w, h - TOP_PAD)/2 - 10;
   *  tutorial.js mirrors it): 2R+20 × 2R+32 px, transparent outside the glass, so the glass fills the slot and the margins
   *  tuck under the status row and the neighbouring columns (those sit above it). */
  function layoutScope() {
    const sb = $('sbody'), slot = $('ppi');
    if (!sb || !slot || !scope) return;
    const bw = sb.clientWidth, bh = sb.clientHeight;
    if (!bw || !bh) return;
    const side = Math.max(60, Math.min(bh, bw - KEY_W - 6 - STRIP_MIN)) & ~1;      // even: integer centre and radius
    if (slot.style.width !== side + 'px') slot.style.width = side + 'px';
    const r = side / 2 - 1, w = 2 * r + 20, h = 2 * r + 32, st = scope.style;
    if (st.width !== w + 'px' || st.height !== h + 'px') { st.width = w + 'px'; st.height = h + 'px'; }
    st.left = (slot.offsetLeft + side / 2 - w / 2) + 'px'; st.top = (slot.offsetTop + side / 2 - (h + TOP_PAD) / 2) + 'px';
  }
  function sizeScope() {
    if (!scope) return;
    const w = scope.clientWidth, h = scope.clientHeight;
    if (!w || !h) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (scope.width !== Math.round(w * dpr) || scope.height !== Math.round(h * dpr)) {
      scope.width = Math.round(w * dpr); scope.height = Math.round(h * dpr);
    } else if (w === W && h === H && glass[0]) return;               // unchanged (debug helpers call this every frame)
    W = w; H = h; cx = w / 2; cy = (h + TOP_PAD) / 2; R = Math.max(20, Math.min(w, h - TOP_PAD) / 2 - 10);
    for (let i = 0; i < 2; i++) {                                    // glass: [0] transmitting, [1] silent (greyer)
      const g = sctx.createRadialGradient(cx, cy, R * 0.08, cx, cy, R);
      g.addColorStop(0, GLASS[i][0]); g.addColorStop(1, GLASS[i][1]); glass[i] = g;
    }
  }
  const ang = b => (b - 90) * D2R;
  const kmPos = (x, y) => ({ x: cx + x / viewKm * R, y: cy - y / viewKm * R });
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, Math.min(1, a)).toFixed(2)})`;
  /** Screen position of a track; tracks beyond the display range are pinned to the rim (out:true). */
  function trackPos(tr) {
    const r = Math.hypot(tr.x, tr.y);
    if (r <= viewKm) { const p = kmPos(tr.x, tr.y); p.out = false; return p; }
    const t = ang(tr.bearingDeg);
    return { x: cx + Math.cos(t) * (R - 6), y: cy + Math.sin(t) * (R - 6), out: true };
  }

  /** NATO-style symbol path (caller fills + strokes): HOSTILE diamond, FRIEND circle, UNKNOWN square. */
  function symbolPath(c, cls, x, y, d) {
    c.beginPath();
    if (cls === 'HOSTILE') { const e = d * 1.2; c.moveTo(x, y - e); c.lineTo(x + e, y); c.lineTo(x, y + e); c.lineTo(x - e, y); c.closePath(); }
    else if (cls === 'FRIEND') c.arc(x, y, d * 0.95, 0, 7);
    else c.rect(x - d * 0.8, y - d * 0.8, d * 1.6, d * 1.6);
  }
  /** Selected-track bracket box: four corner marks, half-size b, arm k. */
  function brackets(c, x, y, b, k) {
    c.beginPath();
    c.moveTo(x - b, y - b + k); c.lineTo(x - b, y - b); c.lineTo(x - b + k, y - b);
    c.moveTo(x + b - k, y - b); c.lineTo(x + b, y - b); c.lineTo(x + b, y - b + k);
    c.moveTo(x + b, y + b - k); c.lineTo(x + b, y + b); c.lineTo(x + b - k, y + b);
    c.moveTo(x - b + k, y + b); c.lineTo(x - b, y + b); c.lineTo(x - b, y + b - k);
    c.stroke();
  }
  /** Symbol for one track (both displays): ARM glyph, rim chevron (off-scale) or class symbol; dashed while IFF is pending. */
  function trackMark(c, tr, x, y, d, alpha, glow, out, chevAng) {
    const rgb = CLS_COL[tr.cls] || CLS_COL.UNKNOWN;
    if (armIds.has(tr.id)) { c.fillStyle = RED; c.strokeStyle = RED; missileIcon(c, x, y, tr.hdg, d / 7.5); return; }
    c.strokeStyle = rgba(rgb, alpha); c.fillStyle = rgba(rgb, alpha);
    if (out) {                                      // off-scale: small filled chevron pointing outward
      const e = d * 0.85;
      c.beginPath(); c.moveTo(x + Math.cos(chevAng) * e, y + Math.sin(chevAng) * e);
      c.lineTo(x + Math.cos(chevAng + 2.4) * e, y + Math.sin(chevAng + 2.4) * e); c.lineTo(x + Math.cos(chevAng - 2.4) * e, y + Math.sin(chevAng - 2.4) * e);
      c.closePath(); c.fill(); return;
    }
    symbolPath(c, tr.cls, x, y, d);
    c.fillStyle = rgba(rgb, (0.1 + 0.22 * glow) * alpha); c.fill();     // fresh sweep hit = stronger tint
    if (tr.iff === 'PENDING') c.setLineDash([3, 2]);
    c.lineWidth = d > 5 ? 2 : 1.5; c.stroke(); c.setLineDash([]); c.lineWidth = 1;
  }

  // weapon envelopes: [weapon, colour, label]
  const WRINGS = [['lance', 'rgba(22,86,170,.78)', 'LANCE'], ['dart', 'rgba(116,48,176,.78)', 'DART'], ['harrow', 'rgba(170,58,30,.85)', 'GUN']];
  const weap = w => (RS.content && RS.content.weapons && RS.content.weapons[w]) || null;
  const weapKm = w => { const W_ = weap(w); return W_ ? W_.maxKm : 0; };
  const marks = [], lastPos = {};                     // SPLASH/MISS markers; last known missile positions (km)
  // small missile glyph pointing along hdg (deg true): body, nose, tail fins
  function missileIcon(c, x, y, hdg, k) {
    const a = (hdg || 0) * D2R, fx = Math.sin(a), fy = -Math.cos(a), sx = -fy, sy = fx, L = 7 * k, F = 3 * k;
    c.lineWidth = 1.6 * k; c.beginPath(); c.moveTo(x - fx * L, y - fy * L); c.lineTo(x + fx * (L - 2), y + fy * (L - 2)); c.stroke();
    c.beginPath(); c.moveTo(x + fx * (L + 2), y + fy * (L + 2)); c.lineTo(x + fx * (L - 3) + sx * 2.2 * k, y + fy * (L - 3) + sy * 2.2 * k);
    c.lineTo(x + fx * (L - 3) - sx * 2.2 * k, y + fy * (L - 3) - sy * 2.2 * k); c.closePath(); c.fill();
    c.beginPath(); c.moveTo(x - fx * L + sx * F, y - fy * L + sy * F); c.lineTo(x - fx * (L - 3), y - fy * (L - 3)); c.lineTo(x - fx * L - sx * F, y - fy * L - sy * F); c.stroke();
    c.lineWidth = 1;
  }
  const byTti = (a, b) => a.tti - b.tti;
  const msl = [];                                     // reused: missiles sorted by TTI

  function drawScope() {
    requestAnimationFrame(drawScope);
    if (!sctx || !sim) return;
    const now = performance.now();
    tickFire(now);
    if (scope.clientWidth !== W || scope.clientHeight !== H) sizeScope();
    const s = S(), rad = s.radar, on = rad.on, c = sctx, rk = viewKm;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    // round display: dark bezel ring, light-blue glass (greyer while silent), crisp edge
    c.fillStyle = '#353c41'; c.beginPath(); c.arc(cx, cy, R + 3, 0, 7); c.fill();
    c.fillStyle = glass[on ? 0 : 1]; c.beginPath(); c.arc(cx, cy, R, 0, 7); c.fill();

    // sweep: crisp leading edge + short fading wedge, no glow (extrapolated between sim ticks for smoothness)
    if (on) {
      const since = Math.min(RS.SIM_DT, (now - tickAt) / 1000);
      const a = ang(rad.sweepDeg + rad.rpm * 6 * since), step = 2.4 * D2R;
      for (let i = 0; i < SWEEP.length; i++) {
        c.fillStyle = SWEEP[i];
        c.beginPath(); c.moveTo(cx, cy); c.arc(cx, cy, R, a - (i + 1) * step, a - i * step); c.closePath(); c.fill();
      }
      c.strokeStyle = 'rgba(6,40,74,.9)'; c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); c.stroke();
    }

    // rings + bearing ticks + cardinal letters (dark blue on the glass)
    c.globalAlpha = on ? 1 : 0.6;
    c.strokeStyle = 'rgba(14,56,92,.42)'; c.lineWidth = 1; c.fillStyle = 'rgba(14,56,92,.85)'; c.font = '9px ' + FF;
    c.textAlign = 'left'; c.textBaseline = 'alphabetic';
    for (const r of RINGS[rk]) { const rr = r / rk * R, rl = Math.min(rr, R - 13), la = ang(160); c.beginPath(); c.arc(cx, cy, rr, 0, 7); c.stroke(); c.fillText(r + '', cx + Math.cos(la) * rl + 3, cy + Math.sin(la) * rl - 3); }
    c.strokeStyle = 'rgba(14,56,92,.75)';
    for (let b = 0; b < 360; b += 10) {
      const t = ang(b), l = b % 30 ? 4 : 8;
      c.beginPath(); c.moveTo(cx + Math.cos(t) * (R - l), cy + Math.sin(t) * (R - l)); c.lineTo(cx + Math.cos(t) * R, cy + Math.sin(t) * R); c.stroke();
    }
    // weapon envelopes: Lance / Dart / Harrow max range (dashed), labelled on the lower-left
    c.setLineDash([3, 4]); c.lineWidth = 1.3;
    for (const [w, col, tag] of WRINGS) {
      const km = weapKm(w); if (!(km > 0) || km > rk) continue;
      const rr = km / rk * R; c.strokeStyle = col; c.beginPath(); c.arc(cx, cy, rr, 0, 7); c.stroke();
      if (rr > 14) { const la = ang(222); c.fillStyle = col; c.fillText(tag, cx + Math.cos(la) * (rr - 3) + 3, cy + Math.sin(la) * (rr - 3) - 5); }   // just inside the ring
    }
    c.setLineDash([]); c.lineWidth = 1; c.fillStyle = '#0c3456';
    c.font = 'bold 11px ' + FF; c.textAlign = 'center'; c.textBaseline = 'middle';
    for (let i = 0; i < 4; i++) { const t = ang(i * 90); c.fillText('NESW'[i], cx + Math.cos(t) * (R - 16), cy + Math.sin(t) * (R - 16)); }
    c.globalAlpha = 1;
    c.strokeStyle = '#1d3a52'; c.lineWidth = 1; c.beginPath(); c.arc(cx, cy, R - 0.5, 0, 7); c.stroke();   // glass edge
    // radar damage: red segment inside the rim, proportional to lost health
    if (rad.health < 1) {
      c.strokeStyle = 'rgba(214,22,30,.6)'; c.lineWidth = 4;
      c.beginPath(); c.arc(cx, cy, R - 2.5, ang(0), ang(0) + (1 - Math.max(0, rad.health)) * Math.PI * 2); c.stroke(); c.lineWidth = 1;
    }
    c.fillStyle = INK; c.fillRect(cx - 2.5, cy - 2.5, 5, 5);            // own battery

    // tracks
    c.textAlign = 'left'; c.textBaseline = 'middle';
    const blink = (now / 300 | 0) % 2 === 0, pulse = (now % 1000) / 1000;
    let selPos = null;
    const pos = {}, labels = [];
    for (const tr of s.tracks) {
      const p = trackPos(tr), x = p.x, y = p.y; pos[tr.id] = p;
      const age = s.t - tr.lastSeen, glow = Math.exp(-age / 2.5);
      const alpha = Math.min(1, 0.5 + 0.35 * tr.quality + 0.25 * glow) * (on ? 1 : 0.7) * (p.out ? 0.75 : 1);
      const rgb = CLS_COL[tr.cls] || CLS_COL.UNKNOWN;
      if (tr.strobe) {                                  // jam strobe: dashed bearing line (position unreliable)
        c.strokeStyle = `rgba(170,96,0,${(alpha * 0.7).toFixed(2)})`; c.lineWidth = 1.2; c.setLineDash([5, 3]); c.beginPath(); c.moveTo(cx, cy);
        const t = ang(tr.bearingDeg); c.lineTo(cx + Math.cos(t) * R, cy + Math.sin(t) * R); c.stroke(); c.setLineDash([]); c.lineWidth = 1;
      }
      if (tr.assigned) {                                // assigned: dashed line from the battery
        c.strokeStyle = 'rgba(128,74,0,.6)'; c.lineWidth = 1; c.setLineDash([3, 4]);
        c.beginPath(); c.moveTo(cx, cy); c.lineTo(x, y); c.stroke(); c.setLineDash([]);
      }
      if (!p.out && !armIds.has(tr.id)) {               // velocity leader: 60 s of travel (capped), from the symbol edge
        const lead = Math.min(R * 0.45, tr.spd * 60 / 1000 / rk * R), hx_ = Math.sin(tr.hdg * D2R), hy_ = -Math.cos(tr.hdg * D2R);
        if (lead > 7) { c.strokeStyle = rgba(rgb, alpha); c.lineWidth = 1.5; c.beginPath(); c.moveTo(x + hx_ * 7, y + hy_ * 7); c.lineTo(x + hx_ * lead, y + hy_ * lead); c.stroke(); }
      }
      trackMark(c, tr, x, y, 6, alpha, glow, p.out, ang(tr.bearingDeg));
      if (!p.out) labels.push({ tr, x, y, alpha });
      if (tr.iff === 'PENDING') {                       // IFF pending: pulsing ring (+ dashed symbol)
        c.strokeStyle = `rgba(150,88,0,${(0.9 * (1 - pulse)).toFixed(2)})`; c.lineWidth = 1.5;
        c.beginPath(); c.arc(x, y, 8 + 12 * pulse, 0, 7); c.stroke(); c.lineWidth = 1;
      }
      if (armIds.has(tr.id) && blink && p.out) {
        c.fillStyle = RED; c.font = 'bold 10px ' + FF; c.fillText('ARM', x + 10, y);
      }
      if (tr.id === s.selectedId) selPos = p;
    }
    // missiles in flight: dark glyph (teal once its own seeker is active), trail, thin line to the target, TTI countdown.
    // Their glyph + countdown boxes are reserved first so track tags keep clear of them.
    msl.length = 0; for (const m of s.missiles || []) msl.push(m); msl.sort(byTti);
    const ttiDone = {}, resv = [];
    for (const m of msl) {
      const mp = kmPos(m.x, m.y); resv.push({ x: mp.x - 8, y: mp.y - 8, w: 16, h: 16 });
      if (isFinite(m.tti) && m.tti > 0 && !ttiDone[m.targetId]) { ttiDone[m.targetId] = m.id; resv.push({ x: mp.x + 7, y: mp.y + 3, w: m.active ? 46 : 22, h: 12 }); }
    }
    drawLabels(c, labels, s.selectedId, blink, resv);
    for (const m of msl) {
      const mp = kmPos(m.x, m.y), tp = pos[m.targetId];
      if (tp) { c.strokeStyle = 'rgba(10,29,46,.28)'; c.lineWidth = 1; c.setLineDash([2, 3]); c.beginPath(); c.moveTo(mp.x, mp.y); c.lineTo(tp.x, tp.y); c.stroke(); c.setLineDash([]); }
      const tr = trails[m.id] || [];
      c.strokeStyle = m.active ? 'rgba(0,125,114,.55)' : 'rgba(10,29,46,.5)'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(mp.x, mp.y);
      let len = 0, px = mp.x, py = mp.y;
      for (let i = tr.length - 1; i >= 0; i--) { const q = kmPos(tr[i][0], tr[i][1]); len += Math.hypot(q.x - px, q.y - py); px = q.x; py = q.y; c.lineTo(q.x, q.y); }
      if (len < 8 && m.hdg != null) c.lineTo(mp.x - Math.sin(m.hdg * D2R) * 8, mp.y + Math.cos(m.hdg * D2R) * 8);
      c.stroke();
      if (m.active) {                                                 // V1.1.4: active seeker cone from the nose toward the target
        const tt = s.tracks.find(t => t.id === m.targetId), tq = tt ? kmPos(tt.x, tt.y) : null;   // true (unpinned) target position
        const ang = tq ? Math.atan2(tq.x - mp.x, -(tq.y - mp.y)) : (m.hdg || 0) * D2R, hw = 22 * D2R;
        const nx = mp.x + Math.sin(ang) * 6, ny = mp.y - Math.cos(ang) * 6, Lc = tq ? Math.max(8, Math.min(18, Math.hypot(tq.x - nx, tq.y - ny) - 9)) : 18;   // stop short of the target mark
        const pulse = 0.55 + 0.45 * Math.sin(now / 180);
        const a1x = nx + Math.sin(ang - hw) * Lc, a1y = ny - Math.cos(ang - hw) * Lc, ar = Math.atan2(-Math.cos(ang), Math.sin(ang));
        c.beginPath(); c.moveTo(nx, ny); c.lineTo(a1x, a1y); c.arc(nx, ny, Lc, ar - hw, ar + hw); c.closePath();
        c.fillStyle = `rgba(0,150,136,${(0.14 + 0.16 * pulse).toFixed(3)})`; c.fill();
        c.strokeStyle = `rgba(0,110,100,${(0.5 + 0.4 * pulse).toFixed(3)})`; c.lineWidth = 1; c.stroke();
      }
      const mc = m.active ? ACT : INK;
      c.fillStyle = mc; c.strokeStyle = mc; missileIcon(c, mp.x, mp.y, m.hdg, 0.85);
      if (ttiDone[m.targetId] === m.id) {         // one countdown per target (salvo pairs overlap); ACT = own seeker, radar free
        c.font = 'bold 10px ' + FF; c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillStyle = mc;
        c.fillText(Math.ceil(m.tti) + 's' + (m.active ? ' ACT' : ''), mp.x + 8, mp.y + 9);
      }
    }
    // SPLASH / MISS markers (fade over ~3.5 s)
    for (let i = marks.length - 1; i >= 0; i--) {
      const mk = marks[i], a = 1 - (now - mk.at) / 3500;
      if (a <= 0) { marks.splice(i, 1); continue; }
      const q = kmPos(mk.x, mk.y), k = 1 - a;
      c.globalAlpha = a; c.strokeStyle = mk.col; c.fillStyle = mk.col; c.lineWidth = 2;
      if (mk.kill) { c.beginPath(); c.arc(q.x, q.y, 6 + 16 * k, 0, 7); c.stroke(); }
      else { c.beginPath(); c.moveTo(q.x - 5, q.y - 5); c.lineTo(q.x + 5, q.y + 5); c.moveTo(q.x + 5, q.y - 5); c.lineTo(q.x - 5, q.y + 5); c.stroke(); }
      c.font = 'bold 11px ' + FF; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(mk.text, q.x, q.y - 16);
      c.globalAlpha = 1; c.textAlign = 'left'; c.lineWidth = 1;
    }
    if (selPos) { c.strokeStyle = INK; c.lineWidth = 2; brackets(c, selPos.x, selPos.y, 13, 5); c.lineWidth = 1; }
    // drag reticle: ring under the finger + leader to the track it is locking
    if (drag) {
      c.strokeStyle = 'rgba(10,29,46,.5)'; c.lineWidth = 1.5;
      c.beginPath(); c.arc(drag.x, drag.y, 26, 0, 7); c.stroke();
      if (selPos) { c.setLineDash([4, 4]); c.beginPath(); c.moveTo(drag.x, drag.y); c.lineTo(selPos.x, selPos.y); c.stroke(); c.setLineDash([]); }
      c.lineWidth = 1;
    }
    if (!on) {                                            // silent / repairing: legend on a light plate
      const t = rad.repair ? 'REPAIRING ' + Math.max(0, Math.ceil(rad.repair.until - s.t)) + 's' : 'RADAR OFF', y = cy + R * 0.42;
      c.font = 'bold 14px ' + FF; c.textAlign = 'center'; c.textBaseline = 'middle';
      const w = c.measureText(t).width + 14;
      c.fillStyle = 'rgba(236,242,244,.85)'; c.fillRect(cx - w / 2, y - 10, w, 20);
      c.strokeStyle = '#8a5000'; c.lineWidth = 1; c.strokeRect(cx - w / 2 + 0.5, y - 9.5, w - 1, 19);
      c.fillStyle = '#7a4600'; c.fillText(t, cx, y + 0.5);
    }
    drawStrip(now, s, blink);
  }

  /** Track data tags (id / altitude in hundreds of m + speed m/s): selected first; a track with another contact within
   *  CROWD_PX gets its id only. Each tag takes the first of 4 slots (right, left, above, below) inside the glass and not
   *  overlapping symbols, missile glyphs/countdowns, ring numerals or tags already placed; a non-selected tag with no free
   *  slot is skipped (symbol stays). */
  function drawLabels(c, list, selId, blink, resv) {
    const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    const R2 = (R - 2) * (R - 2), d2 = (x, y) => (x - cx) * (x - cx) + (y - cy) * (y - cy);
    const inGlass = b => d2(b.x, b.y) < R2 && d2(b.x + b.w, b.y) < R2 && d2(b.x, b.y + b.h) < R2 && d2(b.x + b.w, b.y + b.h) < R2;
    const boxes = list.map(o => ({ x: o.x - 8, y: o.y - 8, w: 16, h: 16, o }));
    const placed = resv, la = ang(160);                                 // missile glyphs/countdowns + ring numerals
    for (const rk of RINGS[viewKm]) { const rr = Math.min(rk / viewKm * R, R - 13); placed.push({ x: cx + Math.cos(la) * rr + 2, y: cy + Math.sin(la) * rr - 10, w: 14, h: 10 }); }
    list.sort((a, b) => (b.tr.id === selId) - (a.tr.id === selId) || b.tr.priority - a.tr.priority);
    c.font = '10px ' + FF;
    for (const o of list) {
      const tr = o.tr, sel = tr.id === selId;
      const crowd = !sel && list.some(q => q !== o && Math.hypot(q.x - o.x, q.y - o.y) < CROWD_PX);
      const l2 = crowd ? null : pad(Math.round(tr.alt / 100), 3) + ' ' + pad(Math.round(tr.spd), 3), arm = armIds.has(tr.id);
      const ev = !arm && tr.evade ? 'EVADE' : null;
      const w = Math.max(c.measureText(tr.id).width, l2 ? c.measureText(l2).width * 0.9 : 0, arm ? 22 : 0, ev ? 32 : 0) + 2;
      const h = (l2 ? 23 : 12) + (arm || ev ? 11 : 0), g = sel ? 15 : 10;
      const slots = [[o.x + g, o.y - 12], [o.x - g - w, o.y - 12], [o.x - w / 2, o.y - g - h], [o.x - w / 2, o.y + g]];
      let r = null;
      for (const [sx, sy] of slots) {
        const cand = { x: sx, y: sy, w, h };
        if (inGlass(cand) && !placed.some(p => hit(p, cand)) && !boxes.some(b => b.o !== o && hit(b, cand))) { r = cand; break; }
      }
      if (!r && !sel) continue;
      r = r || { x: slots[0][0], y: slots[0][1], w, h };
      placed.push(r);
      c.font = (sel ? 'bold ' : '') + '10px ' + FF; c.fillStyle = rgba(CLS_TXT[tr.cls] || CLS_TXT.UNKNOWN, sel ? 1 : o.alpha + 0.1);
      c.fillText(tr.id, r.x, r.y + 6);
      if (l2) { c.font = '9px ' + FF; c.fillStyle = `rgba(10,29,46,${(sel ? 0.9 : o.alpha * 0.72).toFixed(2)})`; c.fillText(l2, r.x, r.y + 17); }
      if (arm && blink) { c.fillStyle = RED; c.font = 'bold 10px ' + FF; c.fillText('ARM', r.x, r.y + h - 5); }
      if (ev) { c.fillStyle = blink ? '#c05000' : 'rgba(192,80,0,.5)'; c.font = 'bold 9px ' + FF; c.fillText(ev, r.x, r.y + h - 5); }
      c.font = '10px ' + FF;
    }
  }

  /* ---------- range-height strip (right column): x = ground range 0…zoom km, y = altitude 0…15 km on a sqrt scale ---------- */
  const H_MAX = 15000, H_TICKS = [1, 3, 6, 10, 15], HPL = 16, HPR = 6, HPT = 17, HPB = 12;
  let hs = null, hctx = null, hW = 0, hH = 0, hTick = -1, hSel = null, hZoom = 0, hBlink = -1;
  const hGlass = [null, null];
  function sizeStrip() {
    if (!hs) return;
    const w = hs.clientWidth, h = hs.clientHeight;
    if (!w || !h) return;
    if (hs.width !== Math.round(w * dpr) || hs.height !== Math.round(h * dpr)) { hs.width = Math.round(w * dpr); hs.height = Math.round(h * dpr); }
    else if (w === hW && h === hH && hGlass[0]) return;
    hW = w; hH = h; hTick = -1;
    for (let i = 0; i < 2; i++) { const g = hctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, GLASS[i][0]); g.addColorStop(1, GLASS[i][1]); hGlass[i] = g; }
  }
  const hx = km => HPL + Math.min(Math.max(km, 0), viewKm) / viewKm * (hW - HPL - HPR);
  const hy = alt => hH - HPB - Math.sqrt(Math.min(Math.max(alt, 0), H_MAX) / H_MAX) * (hH - HPB - HPT);
  /** Strip position of a track; beyond the zoom range it is pinned to the right edge (out:true). */
  function stripPos(tr) { const out = tr.rangeKm > viewKm; return { x: out ? hW - HPR - 1 : hx(tr.rangeKm), y: hy(tr.alt), out }; }

  function drawStrip(now, s, blink) {
    if (!hctx) return;
    if (hs.clientWidth !== hW || hs.clientHeight !== hH) sizeStrip();
    if (!hW || !hH) return;
    const bk = (now / 300) | 0;                          // redraw on a sim tick, selection, zoom or blink phase change
    if (tickAt === hTick && s.selectedId === hSel && viewKm === hZoom && bk === hBlink) return;
    hTick = tickAt; hSel = s.selectedId; hZoom = viewKm; hBlink = bk;
    const c = hctx, on = s.radar.on, gy = hH - HPB, x0 = HPL, x1 = hW - HPR, pw = x1 - x0;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = hGlass[on ? 0 : 1]; c.fillRect(0, 0, hW, hH);
    c.fillStyle = 'rgba(96,74,38,.2)'; c.fillRect(0, gy, hW, HPB);                   // ground band
    c.globalAlpha = on ? 1 : 0.6;
    // altitude grid (sqrt: low fliers get room) + range grid, labels
    c.lineWidth = 1; c.strokeStyle = 'rgba(14,56,92,.2)'; c.fillStyle = 'rgba(14,56,92,.85)'; c.font = '8px ' + FF;
    c.textAlign = 'right'; c.textBaseline = 'middle';
    for (const k of H_TICKS) { const y = Math.round(hy(k * 1000)) + 0.5; c.beginPath(); c.moveTo(x0, y); c.lineTo(x1, y); c.stroke(); c.fillText(k, x0 - 2, y); }
    c.textAlign = 'center';
    for (const r of RINGS[viewKm]) {
      const x = Math.round(hx(r)) + 0.5; c.beginPath(); c.moveTo(x, HPT - 3); c.lineTo(x, gy); c.stroke();
      c.fillText(r, Math.min(x, hW - 3 - c.measureText(r).width / 2), gy + HPB / 2 + 0.5);
    }
    c.strokeStyle = 'rgba(14,56,92,.55)'; c.beginPath(); c.moveTo(x0 + 0.5, HPT - 3); c.lineTo(x0 + 0.5, gy); c.stroke();   // altitude axis
    // weapon envelopes: ceiling × max range (dashed; right edge only when inside the zoom)
    c.setLineDash([3, 3]); c.lineWidth = 1.2;
    for (const [w, col] of WRINGS) {
      const wp = weap(w); if (!wp) continue;
      const yt = Math.round(hy(wp.maxAlt)) + 0.5, xr = Math.round(hx(wp.maxKm)) + 0.5;
      c.strokeStyle = col; c.beginPath(); c.moveTo(x0, yt); c.lineTo(xr, yt); if (wp.maxKm <= viewKm) c.lineTo(xr, gy); c.stroke();
    }
    c.setLineDash([]); c.lineWidth = 1;
    c.strokeStyle = 'rgba(70,52,24,.9)'; c.beginPath(); c.moveTo(0, gy + 0.5); c.lineTo(hW, gy + 0.5); c.stroke();   // ground line
    c.globalAlpha = 1;
    // tracks (leader = closing/opening speed), then own missiles: trail + dot at display altitude (incl. loft)
    let sp = null, sel = null;
    for (const tr of s.tracks) {
      const p = stripPos(tr), glow = Math.exp(-(s.t - tr.lastSeen) / 2.5);
      const alpha = Math.min(1, 0.5 + 0.35 * tr.quality + 0.25 * glow) * (on ? 1 : 0.7) * (p.out ? 0.75 : 1);
      if (!p.out && !armIds.has(tr.id) && tr.closure) {                 // leader: closing (−) / opening (+) over 60 s
        const lead = Math.max(-22, Math.min(22, -tr.closure * 60 / 1000 / viewKm * pw));
        if (Math.abs(lead) > 5) { c.strokeStyle = rgba(CLS_COL[tr.cls] || CLS_COL.UNKNOWN, alpha); c.lineWidth = 1.2; c.beginPath(); c.moveTo(p.x + Math.sign(lead) * 5, p.y); c.lineTo(p.x + lead, p.y); c.stroke(); }
      }
      trackMark(c, tr, p.x, p.y, 4.2, alpha, glow, p.out, 0);
      if (tr.id === s.selectedId) { sp = p; sel = tr; }
    }
    for (const m of s.missiles || []) {
      const x = hx(Math.hypot(m.x, m.y)), y = hy(m.alt + (m.loft || 0)), tr = trails[m.id], col = m.active ? ACT : INK;
      c.strokeStyle = m.active ? 'rgba(0,125,114,.55)' : 'rgba(10,29,46,.45)'; c.lineWidth = 1.2; c.beginPath(); c.moveTo(x, y);
      if (tr) for (let i = tr.length - 1; i >= 0; i--) c.lineTo(hx(Math.hypot(tr[i][0], tr[i][1])), hy(tr[i][2]));
      c.stroke();
      c.fillStyle = col; c.beginPath(); c.arc(x, y, 2.4, 0, 7); c.fill();
    }
    if (sp) {                                            // selected: brackets + altitude line to the axis + readout in the header
      c.strokeStyle = 'rgba(10,29,46,.4)'; c.setLineDash([2, 2]); c.beginPath(); c.moveTo(x0, Math.round(sp.y) + 0.5); c.lineTo(sp.x - 8, Math.round(sp.y) + 0.5); c.stroke(); c.setLineDash([]);
      c.strokeStyle = INK; c.lineWidth = 1.5; brackets(c, sp.x, sp.y, 8, 3.5); c.lineWidth = 1;
    }
    c.font = 'bold 9px ' + FF; c.textBaseline = 'middle'; c.textAlign = 'left'; c.fillStyle = '#0c3456';
    c.fillText('ALT km', 3, 7.5);
    if (sel) { c.textAlign = 'right'; c.fillStyle = rgba(CLS_TXT[sel.cls] || CLS_TXT.UNKNOWN, 1); c.fillText(sel.id + ' ' + (sel.alt / 1000).toFixed(1), hW - 3, 7.5); }
    c.strokeStyle = '#27333b'; c.lineWidth = 1; c.strokeRect(0.5, 0.5, hW - 1, hH - 1);
  }

  /* ---------- scope input ---------- */
  function nearest(px, py, maxPx) {
    let best = null, bd = maxPx;
    for (const tr of S().tracks) {
      const p = trackPos(tr), d = Math.hypot(p.x - px, p.y - py);
      if (d < bd) { bd = d; best = tr; }
    }
    return best ? { tr: best, d: bd } : null;
  }
  // V1.4: #p-scope is projected onto the cabin's radar monitor (RS.cabin, matrix3d) → map pointer / debug positions through it
  function localOf(el, cx, cy) {
    if (RS.cabin) { const p = RS.cabin.toLocal(el, cx, cy); return [p.x, p.y]; }
    const r = el.getBoundingClientRect(); return [cx - r.left, cy - r.top];
  }
  function clientOf(el, x, y) {
    if (RS.cabin) return RS.cabin.toClient(el, x, y);
    const r = el.getBoundingClientRect(); return { x: r.left + x, y: r.top + y };
  }
  function local(ev) { return localOf(scope, ev.clientX, ev.clientY); }
  function select(id) {
    if (S().selectedId === id) return;
    tap('track'); buzz(8); sim.cmd.selectTrack(id); renderPanels(true);
  }
  /** Own missile glyph under the finger, or null. */
  function nearMissile(x, y, maxD, posOf) {
    let best = null;
    for (const m of S().missiles || []) {
      const p = posOf(m), d = Math.hypot(p.x - x, p.y - y);
      if (d <= maxD && (!best || d < best.d)) best = { m, d };
    }
    return best;
  }
  const mPPI = m => kmPos(m.x, m.y);
  const mStrip = m => ({ x: hx(Math.hypot(m.x, m.y)), y: hy(m.alt + (m.loft || 0)) });
  /** Tap on one of our missiles → select that missile's target (the EO camera then watches it arrive). */
  function missileTap(m) {
    const tid = m.targetId, s = S();
    if (!tid || !s.tracks.some(t => t.id === tid)) { toast('Target track lost', 'amber'); return; }
    if (s.selectedId === tid) { tap('track'); buzz(8); } else select(tid);
  }
  function onDown(ev) {
    const [x, y] = local(ev);
    drag = { id: ev.pointerId, x, y };
    try { scope.setPointerCapture(ev.pointerId); } catch (e) { }
    const n = nearest(x, y, SNAP_PX), mm = nearMissile(x, y, 18, mPPI);
    if (mm && (!n || mm.d < n.d)) { missileTap(mm.m); return; }
    if (n) select(n.tr.id);
  }
  function onMove(ev) {
    if (!drag || ev.pointerId !== drag.id) return;
    const [x, y] = local(ev); drag.x = x; drag.y = y;
    const n = nearest(x, y, DRAG_PX); if (!n || n.tr.id === S().selectedId) return;
    const cur = selTrack();
    const cd = cur ? Math.hypot(trackPos(cur).x - x, trackPos(cur).y - y) : 1e9;
    if (n.d + HYST_PX < cd) select(n.tr.id);
  }
  function onUp(ev) { if (drag && ev.pointerId === drag.id) drag = null; }
  /** Height strip: tap selects the nearest track there (or a missile's target). */
  function onStripDown(ev) {
    ev.preventDefault();
    const [x, y] = localOf(hs, ev.clientX, ev.clientY);
    let best = null, bd = STRIP_SNAP_PX;
    for (const tr of S().tracks) { const p = stripPos(tr), d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = tr; } }
    const mm = nearMissile(x, y, 12, mStrip);
    if (mm && (!best || mm.d < bd)) { missileTap(mm.m); return; }
    if (best) select(best.id);
  }

  /* ---------- thumb-zone logic ---------- */
  /** Why a thumb button cannot act right now (null = it can). */
  function blocked(act) {
    const s = S(), tr = selTrack();
    if (!tr) return 'Select a track on the scope first';
    if (act === 'iff' && !s.radar.on) return 'Radar off: IFF needs the radar';
    if (act === 'iff' && tr.iff === 'PENDING') return 'IFF interrogation in progress';
    if ((act === 'assign' || act === 'fire') && tr.cls === 'FRIEND') return 'Track is FRIEND: cannot engage';
    if (act === 'fire' && !tr.assigned) return 'No launcher assigned: tap a launcher chip';
    return null;
  }

  function doAssign() {
    const tr = selTrack(), b = blocked('assign');
    if (b) { toast(b, 'amber'); return; }
    tap('button');
    const best = bestFor(tr.id);
    if (!best) { toast(noLauncherMsg(tr.id), 'amber'); return; }
    if (tr.assigned === best) { toast(tr.id + ' already on ' + best, 'amber'); return; }
    assignTo(tr, best);
  }
  function bestFor(tid) { try { return sim.query && sim.query.bestLauncher ? sim.query.bestLauncher(tid) : null; } catch (e) { return null; } }
  /** Reason from the most suitable launcher (in range first, then highest Pk, then ready). */
  function noLauncherMsg(tid) {
    let best = null, bq = null, bs = -1;
    for (const l of S().battery.launchers) {
      const q = engage(tid, l.id); if (!q) continue;
      const sc = (q.inRange ? 4 : 0) + (q.pk || 0) * 2 + (l.ready && !l.jammed ? 1 : 0);
      if (sc > bs) { bs = sc; best = l; bq = q; }
    }
    return 'No launcher' + (best ? ': ' + why(bq.reason) + ' (' + lname(best) + ')' : ': no solution');
  }
  /** Assign launcher lid to track tr, with feedback toast. Returns accepted. */
  function assignTo(tr, lid) {
    const l = launcher(lid), okd = sim.cmd.assign(tr.id, lid);
    if (!okd) { const q = engage(tr.id, lid); toast(lname(l || { id: lid }) + ' refused' + (q && q.reason ? ': ' + why(q.reason) : ''), 'amber'); return false; }
    tap('button'); buzz(10);
    const q = engage(tr.id, lid);
    toast(lname(l || { id: lid }) + ' assigned' + (q ? (q.ok ? ' · Pk ' + pctTxt(q) : ' · ' + chipWhy(q, l)) : ''), q && !q.ok ? 'amber' : 'ok');
    renderPanels(true);
    return true;
  }
  function chipTap(lid) {
    const tr = selTrack();
    if (!tr) { toast('Select a track on the scope first', 'amber'); return; }
    if (tr.assigned === lid) {
      tap('button'); buzz(8);
      if (sim.cmd.assign(tr.id, null)) toast(tr.id + ': ' + lid + ' assignment cleared', 'amber'); else toast('Clear refused', 'amber');
      renderPanels(true); return;
    }
    const b = blocked('assign'); if (b) { toast(b, 'amber'); return; }
    assignTo(tr, lid);
  }
  /** After a HOSTILE call: engage straight away if nothing is assigned yet. */
  function autoAssign(tid) {
    const tr = S().tracks.find(t => t.id === tid);
    if (!tr || tr.cls !== 'HOSTILE' || tr.assigned) return;
    const best = bestFor(tid);
    if (best) assignTo(tr, best); else toast(tid + ' HOSTILE · ' + noLauncherMsg(tid), 'amber');
  }

  function openSheet() {
    const tr = selTrack(), b = blocked('assign');
    if (b) { toast(b, 'amber'); return; }
    sheetOpen = true; buzz(20); tap('panel');
    cache.sh = null; renderSheet(true);
    $('sheet').classList.add('open');
  }
  function closeSheet() { sheetOpen = false; const e = $('sheet'); if (e) e.classList.remove('open'); }

  function setArmed(on) {
    if (fire.armed === on) return;
    fire.armed = on; fire.holdAt = 0; fire.lastAt = performance.now();
    const b = $('b-fire'); b.classList.toggle('armed', on); b.classList.remove('holding'); b.style.setProperty('--p', 0);
    RS.bus.emit('UI_FIRE_ARMED', { armed: on });
  }
  function doFire() {
    const id = S().selectedId;
    rejectSeen = false;
    const ok = sim.cmd.fire(id);
    if (!ok && !rejectSeen) toast('FIRE REJECTED', 'red');
    buzz(ok ? 60 : [20, 40, 20]);
    setArmed(false);
    renderPanels(true);
  }
  function tickFire(now) {
    const b = $('b-fire'); if (!b) return;
    if (fire.armed && fire.holdAt) {
      const p = Math.min(1, (now - fire.holdAt) / (fire.need || HOLD_MS));
      b.style.setProperty('--p', p.toFixed(3));
      if (p >= 1) { fire.holdAt = 0; b.classList.remove('holding'); doFire(); }
    } else if (fire.armed && now - fire.lastAt > COVER_IDLE_MS) setArmed(false);
  }

  function bindThumb() {
    const ab = $('b-assign'), fb = $('b-fire');
    const cancelPress = () => { if (press) { clearTimeout(press.t); press = null; } };
    ab.addEventListener('pointerdown', ev => {
      ev.preventDefault(); cancelPress();
      press = { id: ev.pointerId, long: false, t: setTimeout(() => { if (press) { press.long = true; openSheet(); } }, LONG_MS) };
    });
    // after a long-press the browser still synthesizes a click at the finger: swallow it so it cannot hit the sheet
    ab.addEventListener('pointerup', ev => { if (press && !press.long) { cancelPress(); doAssign(); } else { if (press) noClickUntil = performance.now() + 400; cancelPress(); } });
    ab.addEventListener('pointercancel', cancelPress);
    ab.addEventListener('pointerleave', cancelPress);
    fb.addEventListener('pointerdown', ev => {
      ev.preventDefault();
      const b = blocked('fire');
      if (b) { toast(b, 'amber'); return; }
      fire.lastAt = performance.now();
      // one gesture: pressing the closed cover flips it AND starts the hold (a little longer than when already open)
      const wasArmed = fire.armed;
      if (!wasArmed) { tap('button'); buzz(15); setArmed(true); }
      fire.need = wasArmed ? HOLD_MS : HOLD_MS + 300;
      try { fb.setPointerCapture(ev.pointerId); } catch (e) { }
      fire.pid = ev.pointerId; fire.holdAt = performance.now(); fb.classList.add('holding'); buzz(10);
    });
    const release = () => { if (fire.holdAt) { fire.holdAt = 0; fire.lastAt = performance.now(); fb.classList.remove('holding'); fb.style.setProperty('--p', 0); } };
    fb.addEventListener('pointerup', release);
    fb.addEventListener('pointercancel', release);
    $('thumbzone').addEventListener('contextmenu', ev => ev.preventDefault());
  }

  function renderThumb(s) {
    const tr = selTrack(), rad = s.radar;
    const rb = $('b-radar');
    rb.className = 'tz ' + (rad.on ? (rad.emitTime > 90 ? 'hot' : 'on') : 'off');
    setHTML(rb, 'rb', `RADAR<b>${rad.on ? 'ON' : 'OFF'}</b>`);
    const ib = $('b-iff'), il = IFF_LBL[tr ? tr.iff : 'NONE'] || IFF_LBL.NONE;
    ib.className = 'tz ' + il[1] + (blocked('iff') && !(tr && tr.iff === 'PENDING') ? ' dis' : '');
    setHTML(ib, 'ib', 'IFF<b>' + (tr && tr.iff === 'PENDING' ? '<i class="spin"></i>' : il[0]) + '</b>');
    $('b-friend').className = 'tz' + (tr ? (tr.cls === 'FRIEND' ? ' sel' : '') : ' dis');
    $('b-hostile').className = 'tz' + (tr ? (tr.cls === 'HOSTILE' ? ' sel' : '') : ' dis');
    const ab = $('b-assign');
    ab.className = 'tz' + (blocked('assign') ? ' dis' : tr.assigned ? ' sel' : '');
    setHTML(ab, 'ab', 'ASSIGN<b>' + (tr && tr.assigned ? tr.assigned : 'AUTO') + '</b>');
    const fb = $('b-fire'), fd = !!blocked('fire'), fl = 'FIRE' + (tr && tr.assigned ? ' ' + tr.assigned : '');
    fb.classList.toggle('dis', fd);
    if (cache.fl !== fl) { cache.fl = fl; $('fire-lbl').textContent = fl; $('fire-cov').textContent = fl; }
    if (fd && fire.armed) setArmed(false);
  }

  /* ---------- launcher strip ---------- */
  const chips = {};
  function renderStrip(s) {
    const el = $('lstrip'); if (!el) return;
    const L = s.battery.launchers, tr = selTrack();
    if (Object.keys(chips).filter(k => k !== '_doc').length !== L.length || !L.every(l => chips[l.id])) {
      el.innerHTML = '';
      for (const k in chips) delete chips[k];
      for (const l of L) {
        const b = document.createElement('button');
        b.className = 'lchip'; b.id = 'chip-' + l.id; b.dataset.act = 'chip'; b.dataset.l = l.id;
        b.innerHTML = '<span class="lc-h"></span><span class="lc-p"></span><span class="lc-s"></span>';
        el.appendChild(b); chips[l.id] = { b, h: b.children[0], p: b.children[1], st: b.children[2], k: {} };
      }
      const d = document.createElement('button');                    // one-tap SHOT (1 round) / SALVO (2 rounds) toggle
      d.className = 'lchip doc'; d.id = 'b-doc'; d.dataset.act = 'doctog'; el.appendChild(d); chips._doc = d;
    }
    const salvo = s.battery.doctrine === RS.DOCTRINE.SALVO, dh = salvo ? '<b>2×</b><span>SALVO</span>' : '<b>1×</b><span>SHOT</span>';
    if (chips._doc && chips._doc._h !== dh) { chips._doc._h = dh; chips._doc.innerHTML = dh; chips._doc.classList.toggle('on', salvo); chips._doc.setAttribute('aria-label', salvo ? 'Salvo: 2 rounds per shot' : 'Single shot'); }
    for (const l of L) {
      const ch = chips[l.id], set = (node, key, html) => { if (ch.k[key] !== html) { ch.k[key] = html; node.innerHTML = html; } };
      let cls = 'lchip', st, tag = '';
      if (tr) {
        const q = engage(tr.id, l.id) || { ok: false, reason: null, pk: 0 };
        if (tr.assigned === l.id) { cls += ' asg'; st = 'ASSIGNED'; tag = q.ok ? pctTxt(q) : chipWhy(q, l); }
        else if (q.ok) { cls += ' ok'; st = 'Pk ' + pctTxt(q); }
        else { cls += ' no'; st = chipWhy(q, l); }
      } else if (l.jammed) { cls += ' st-jam'; st = 'JAM'; }
      else if (!l.ready) { cls += ' st-rld'; st = 'RLD ' + Math.ceil(l.reloadT) + 's'; }
      else if (l.rounds <= 0) { cls += ' st-empty'; st = 'EMPTY'; }
      else st = 'READY';
      if (ch.b.className !== cls) ch.b.className = cls;
      set(ch.h, 'h', `<b>${l.id}</b> ${WLBL[l.weapon] || W_UP(l.weapon)}`);
      const pips = l.weapon === 'harrow' || l.max > 8
        ? `<u><s style="width:${Math.round(100 * Math.max(0, l.rounds) / Math.max(1, l.max))}%"></s></u>`
        : '<i></i>'.repeat(Math.max(0, l.rounds)) + '<i class="e"></i>'.repeat(Math.max(0, l.max - l.rounds));
      set(ch.p, 'p', pips + (tag ? `<em>${esc(tag)}</em>` : l.weapon === 'harrow' ? `<em>${l.rounds}</em>` : ''));
      set(ch.st, 's', esc(st));
      ch.b.setAttribute('aria-label', `${lname(l)} ${st}`);
    }
  }

  /* ---------- panels ---------- */
  function engageRows(tr, s) {
    if (!hasQ()) return '<p class="muted">Fire-control solution unavailable.</p>';
    let h = '<div class="erow ehdr"><span></span><span>WPN</span><span>STATUS</span><span>PK</span><span>TTI</span><span>RDS</span></div>';
    for (const l of s.battery.launchers) {
      const q = engage(tr.id, l.id) || { ok: false, reason: null, pk: 0, tti: 0 };
      const rd = l.weapon === 'harrow' ? l.rounds : l.rounds + 'r';
      h += `<button class="erow ${q.ok ? 'ok' : 'no'}${tr.assigned === l.id ? ' asg' : ''}" data-act="pick" data-l="${l.id}">` +
        `<b>${l.id}</b><span>${W_UP(l.weapon)}</span>` +
        `<span class="${q.ok ? 'ok' : 'amber'}">${q.ok ? (tr.assigned === l.id ? 'ASSIGNED' : 'READY') : esc(short(q.reason))}</span>` +
        `<span>${q.inRange === false ? '--' : Math.round(q.pk * 100) + '%'}</span><span>${q.tti ? Math.round(q.tti) + 's' : '--'}</span><span class="muted">${rd}</span></button>`;
    }
    return h;
  }

  function trackBody(s) {
    const tr = selTrack();
    let h = '<div class="pad">';
    if (tr) {
      const f = (k, v) => `<div><b>${k}</b><span>${v}</span></div>`, il = IFF_LBL[tr.iff] || IFF_LBL.NONE;
      h += `<div class="thdr"><span class="big">${tr.id}</span><span class="pill ${clsPill(tr.cls)}">${tr.cls}</span>` +
        `<span class="chip ${il[1] === 'pend' ? 'amber' : il[1]}">IFF ${tr.iff === 'PENDING' ? '<i class="spin"></i>' : tr.iff.replace('_', ' ')}</span>` +
        `<span class="muted">Q${Math.round(tr.quality * 100)}</span></div>`;
      h += '<div class="kv">' + f('ALT m', tr.alt) + f('SPD m/s', tr.spd) + f('HDG', pad(tr.hdg, 3) + '°') + f('CLOSURE', (tr.closure > 0 ? '+' : '') + tr.closure) +
        f('RANGE km', tr.rangeKm.toFixed(1)) + f('BRG', pad(tr.bearingDeg, 3) + '°') + f('IFF', tr.iff === 'NO_RESPONSE' ? 'NO RSP' : tr.iff) + f('PRIORITY', tr.priority) + '</div>';
      const ib = blocked('iff') ? ' dis' : '';
      h += '<div class="row b4">' + `<button class="btn${ib}" data-act="iff">INTERROGATE</button>` +
        ['FRIEND', 'HOSTILE', 'UNKNOWN'].map(c => `<button class="btn ${tr.cls === c ? 'sel' : ''} c${c[0]}" data-act="cls" data-v="${c}">${c}</button>`).join('') + '</div>';
      h += '<div class="sec">ENGAGEMENT · tap a row to assign</div>' + engageRows(tr, s);
    } else h += '<p class="muted" style="margin:4px 0 8px">No track selected. Touch the scope near a contact, or drag your finger to sweep through them.</p>';
    h += '</div><table><tr><th>PRI</th><th>ID</th><th>RNG</th><th>BRG</th><th>ALT</th><th>CLS</th></tr>';
    const list = s.tracks.slice().sort((a, b) => b.priority - a.priority || (a.id < b.id ? -1 : 1));
    for (const t of list) {
      h += `<tr data-act="sel" data-id="${t.id}" class="${t.id === s.selectedId ? 'sel' : ''}"><td class="pri">${t.priority}</td><td>${t.id}${t.assigned ? '<span class="amber">*</span>' : ''}</td>` +
        `<td>${t.rangeKm.toFixed(0)}</td><td>${pad(t.bearingDeg, 3)}</td><td>${t.alt}</td><td class="c${t.cls[0]}">${t.cls.slice(0, 4)}</td></tr>`;
    }
    return h + '</table>';
  }

  function batteryBody(s) {
    const b = s.battery, rs = b.reserve || null;
    let h = '<div class="pad" style="padding-top:2px">';
    for (const l of b.launchers) {
      const pips = l.weapon === 'harrow' ? `<span><span class="ok">${l.rounds}</span><span class="muted">/${l.max}</span></span>`
        : '<span class="pips">' + '■'.repeat(Math.max(0, l.rounds)) + '<i>' + '■'.repeat(Math.max(0, l.max - l.rounds)) + '</i></span>';
      let st;
      if (l.jammed) st = '<span class="red">JAM</span>';
      else if (l.ready) st = '<span class="ok">READY</span>';
      else {
        const tot = l.reloadTotal || Math.max(l.reloadT, 1), pct = Math.round(100 * (1 - l.reloadT / tot));
        st = `<span class="bar"><i style="width:${Math.max(0, Math.min(100, pct))}%"></i></span><small class="amber">RLD ${Math.ceil(l.reloadT)}s</small>`;
      }
      const asg = l.assignedTrack || Object.keys(b.assignedTo || {}).find(k => b.assignedTo[k] === l.id) || null;
      const rsv = rs ? rs[l.weapon] : 1, can = !l.jammed && l.ready && l.rounds < l.max && rsv > 0;
      h += `<div class="lrow"><b>${l.id}</b><div><small>${W_UP(l.weapon)}</small>${pips}</div><div>${st}</div>` +
        `<span class="${asg ? 'amber' : 'muted'}">${asg ? '→' + asg : '—'}</span>` +
        `<button class="btn sm${can ? '' : ' dis'}" data-act="reload" data-l="${l.id}">RELOAD</button></div>`;
    }
    if (rs) h += `<div class="resv">RESERVE Lance <b>${rs.lance}</b> · Dart <b>${rs.dart}</b> · Harrow <b>${rs.harrow}</b></div>`;
    const salvo = b.doctrine === RS.DOCTRINE.SALVO;
    h += '<div class="row" style="margin-top:8px"><span class="muted" style="align-self:center">DOCTRINE</span>' +
      `<button class="btn ${salvo ? '' : 'sel'}" data-act="doc" data-v="${RS.DOCTRINE.SLS}">SHOOT-LOOK-SHOOT</button>` +
      `<button class="btn ${salvo ? 'sel' : ''}" data-act="doc" data-v="${RS.DOCTRINE.SALVO}">SALVO</button></div>`;
    return h + '</div>';
  }

  function commsBody(s) {
    const roe = s.shift.roe, cls = roe === 'FREE' ? 'red' : roe === 'TIGHT' ? 'amber' : 'ok';
    let h = `<div class="pad row" style="margin:0;align-items:center;justify-content:space-between"><span>WEAPONS <span class="pill ${cls}">${roe}</span></span>` +
      `<span class="muted">${esc(s.shift.name || '')}</span></div>`;
    const cm = s.comms || [];
    if (cm.length) {
      h += '<div class="sec" style="margin:4px 10px">MESSAGES</div><ul class="msgs">';
      for (let i = cm.length - 1; i >= 0 && i >= cm.length - 12; i--) {
        const m = cm[i], need = m.needsAck && !m.acked;
        h += `<li class="${m.priority === 'high' ? 'hi' : ''}${need ? ' need' : ''}"><span class="ts muted">${mmss(m.t)}</span>` +
          `<span class="tx"><b>${esc(m.from)}:</b> ${esc(m.text)}</span>` +
          (need ? `<button class="btn sm" data-act="ack" data-id="${m.id}">ACK</button>` : m.needsAck ? '<span class="ok">✓</span>' : '') + '</li>';
      }
      h += '</ul><div class="sec" style="margin:8px 10px 4px">EVENT LOG</div>';
    }
    h += '<ul class="log">';
    for (const l of log) h += `<li class="${l.cls}"><span class="ts">${mmss(l.t)}</span>${l.text}</li>`;
    return h + '</ul>';
  }

  function renderSheet(force) {
    if (!sheetOpen || (frozen && !force)) return;
    const tr = selTrack();
    if (!tr) { closeSheet(); return; }
    setHTML($('sheetcard'), 'sh', `<div class="shdr"><span>ASSIGN ${tr.id} <span class="pill ${clsPill(tr.cls)}">${tr.cls}</span></span>` +
      `<button class="btn sm" data-act="sheetx">CANCEL</button></div>` + engageRows(tr, S()) +
      `<div class="row"><button class="btn${tr.assigned ? '' : ' dis'}" style="flex:1" data-act="pick" data-l="">CLEAR ASSIGNMENT</button></div>`);
  }

  function renderAlerts(s) {
    let top = null, n = 0;
    const eta = s.radar.armEta, act = k => alarms[k] || (k === 'arm' && typeof eta === 'number');
    for (const k of ALARM_ORDER) if (act(k)) { n++; if (!top) top = k; }
    const el = $('alertstrip'), ps = $('p-scope');
    alertOn = !!top;
    if (el) {
      el.className = top ? 'on ' + (top === 'radar' || top === 'lowammo' ? 'amber' : 'red') : '';
      setHTML(el, 'al', top ? `▲ ${ALARM_TXT[top]}${top === 'arm' && eta != null ? ' ' + mmss(Math.ceil(eta)) : ''}${n > 1 ? ` <small>+${n - 1}</small>` : ''}` : '');
    }
    if (ps) {
      ps.classList.toggle('alerting', alertOn);
      const w = s.weather, night = !!w && (w.time === 'night' || !!w.nightEv);   // night: dim the light glass a little
      if (ps.classList.contains('night') !== night) ps.classList.toggle('night', night);
    }
    const rp = $('roepill'), roe = s.shift.roe;
    if (rp && roe !== lastRoe) {
      rp.textContent = 'ROE ' + roe; rp.className = 'cell ' + (roe === 'FREE' ? 'red' : roe === 'TIGHT' ? 'amber' : 'ok');
      if (lastRoe) { void rp.offsetWidth; rp.classList.add('flash'); }
      lastRoe = roe;
    }
    renderCells(s);
  }
  /** Status cell row (Pantsir style): lit green = OK, amber = caution, red = alarm, grey = inactive. */
  function cell(id, txt, cls) {
    const k = 'c-' + id, v = txt + '|' + cls;
    if (cache[k] === v) return;
    const e = $(id); if (!e) return;
    cache[k] = v; e.textContent = txt; e.className = 'cell' + (cls ? ' ' + cls : '');
  }
  function renderCells(s) {
    const rad = s.radar, rep = rad.repair, jam = rad.jam || 0;
    cell('st-tx', rep ? 'RPR ' + Math.max(0, Math.ceil(rep.until - s.t)) + 's' : rad.on ? 'TX ' + mmss(rad.emitTime) : 'EMCON',
      rep ? 'amber' : !rad.on ? 'info' : rad.emitTime > 90 ? 'red' : rad.emitTime > 60 ? 'amber' : 'ok');
    cell('st-trk', 'TRK ' + s.tracks.length, s.tracks.length ? 'info' : '');
    cell('st-rdr', 'RDR ' + Math.round(Math.max(0, rad.health) * 100) + '%', rad.health >= 0.95 ? 'ok' : rad.degraded ? 'red' : 'amber');
    cell('st-jam', jam > 0.15 ? 'JAM ' + pad(Math.round(rad.jamBearing || 0), 3) : 'JAM', jam > 0.5 ? 'red' : jam > 0.15 ? 'amber' : '');
    cell('st-deg', 'DEGR', rad.degraded && !rep ? 'red blink' : '');
  }

  function renderPanels(force) {
    const now = performance.now();
    if (!force && now - lastPanelAt < 100) return;
    lastPanelAt = now;
    if (frozen && now - frozenT > 4000) frozen = false;          // safety: never stay frozen
    const s = S();
    // tab summaries (always)
    const sel = selTrack();
    setHTML($('sum-track'), 'st', sel ? `${sel.id} ${sel.rangeKm.toFixed(0)}km <span class="c${sel.cls[0]}">${sel.cls.slice(0, 3)}</span>${sel.assigned ? ' ' + sel.assigned : ''}` : `${s.tracks.length} tracks`);
    setHTML($('sum-battery'), 'sb', s.battery.launchers.map(l => l.jammed ? '<span class="warn">J</span>' : !l.ready ? '<span class="warn">R</span>' : l.weapon === 'harrow' ? 'G' + l.rounds : l.rounds).join(' · '));
    const unack = (s.comms || []).filter(m => m.needsAck && !m.acked).length;
    setHTML($('sum-comms'), 'sc', `<span class="${s.shift.roe === 'FREE' ? 'warn' : ''}">${s.shift.roe}</span>` +
      (unack ? ` · <span class="warn">ACK ${unack}</span>` : '') + ` · ${log.length ? esc(log[0].text.replace(/<[^>]+>/g, '')) : ''}`);
    const ck = $('clock'); if (ck) ck.textContent = s.shift.endless ? 'WAVE ' + (s.shift.wave || 0) + ' · ' + mmss(s.shift.elapsed) : mmss(s.shift.elapsed) + ' / ' + mmss(s.shift.duration);
    const rb = $('b-repair');                                         // REPAIR shows once the radar is damaged
    if (rb) {
      const want = s.radar.health < 0.95 && s.shift.running, rep = s.radar.repair;
      if (rb.hidden === want) rb.hidden = !want;
      setHTML(rb, 'rb', rep ? `REPAIR<i>${Math.max(0, Math.ceil(rep.until - s.t))} s</i>` : `REPAIR<i>RDR ${Math.round(s.radar.health * 100)}%</i>`);
      rb.classList.toggle('busy', !!rep); rb.classList.toggle('urgent', !rep && !!s.radar.degraded);
    }
    renderThumb(s);
    renderStrip(s);
    renderAlerts(s);
    renderSheet(false);
    if (frozen) return;
    // only the active tab body is live
    if (tab === 'track') setHTML($('body-track'), 'bt', trackBody(s));
    if (tab === 'battery') setHTML($('body-battery'), 'bb', batteryBody(s));
    if (tab === 'comms') setHTML($('body-comms'), 'bc', commsBody(s));
  }

  /** Switch the lower monitor tab. 'scope' is accepted for compatibility (scope is always visible). */
  function expand(name) {
    if (!name || name === 'scope' || !$('body-' + name)) return;
    tab = name;
    root.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    root.querySelectorAll('#tabbody .pbody').forEach(b => b.classList.toggle('active', b.dataset.panel === name));
    if (name === 'comms') { const tc = $('tab-comms'); if (tc) tc.classList.remove('alert'); }
    cache.bt = cache.bb = cache.bc = null; frozen = false;
    renderPanels(true);
  }

  function setZoom(km) {
    viewKm = km;
    const b = $('b-zoom'); if (b) b.innerHTML = `<i>ZOOM</i><b>${km}</b><i>KM</i>`;
  }

  function bindFast() {
    document.addEventListener('pointerdown', ev => {
      const el = ev.target.closest && ev.target.closest(FAST);
      if (!el || el.disabled) return;
      ev.preventDefault();
      if (fast) fast.el.classList.remove('down');
      fast = { el, id: ev.pointerId, x: ev.clientX, y: ev.clientY };
      el.classList.add('down');
    }, true);
    const end = (ev, ok) => {
      if (!fast || ev.pointerId !== fast.id) return;
      const f = fast; fast = null; f.el.classList.remove('down');
      if (!ok) return;
      const r = f.el.getBoundingClientRect(), m = 24;             // forgive a small slide off the edge
      if (ev.clientX < r.left - m || ev.clientX > r.right + m || ev.clientY < r.top - m || ev.clientY > r.bottom + m) return;
      act(f.el, ev);
    };
    window.addEventListener('pointerup', ev => end(ev, true), true);
    window.addEventListener('pointercancel', ev => end(ev, false), true);
  }

  function onClick(ev) {
    if (performance.now() < noClickUntil) { noClickUntil = 0; ev.preventDefault(); ev.stopPropagation(); return; }
    const t = ev.target.closest('.tab');
    if (t) { tap('panel'); expand(t.dataset.tab); return; }
    const el = ev.target.closest('[data-act]');
    if (!el || el.disabled) return;
    if (el.matches(FAST)) return;                                   // already handled on pointerup
    act(el, ev);
  }

  function act(el, ev) {
    const act = el.dataset.act, s = S(), tr = selTrack();
    if (act === 'sheetx') { if (ev.target === el || el.tagName === 'BUTTON') closeSheet(); return; }
    if (act === 'sel') { tap('track'); sim.cmd.selectTrack(el.dataset.id); }
    else if (act === 'doc') { tap('button'); sim.cmd.setDoctrine(el.dataset.v); }
    else if (act === 'radar') {
      tap('button');
      if (!sim.cmd.radar(!s.radar.on) && !s.radar.on) toast(s.radar.repair ? 'Radar under repair' : 'Radar unavailable', 'amber');
    }
    else if (act === 'repair') {
      tap('button');
      if (sim.cmd.repairRadar && sim.cmd.repairRadar()) { toast('Radar repair started: radar silent', 'amber'); buzz(30); }
      else toast(s.radar.repair ? 'Repair already under way' : 'Radar does not need repair', 'amber');
    }
    else if (act === 'doctog') {
      tap('button'); const salvo = s.battery.doctrine === RS.DOCTRINE.SALVO;
      sim.cmd.setDoctrine(salvo ? RS.DOCTRINE.SLS : RS.DOCTRINE.SALVO); renderStrip(S());
    }
    else if (act === 'cyc') {                                        // ◀ ▶ step through tracks in the TRACK list order (highest priority first)
      const list = s.tracks.slice().sort((a, b) => b.priority - a.priority || (a.id < b.id ? -1 : 1));
      if (!list.length) { toast('No tracks', 'amber'); return; }
      const d = +el.dataset.d || 1, i = list.findIndex(t => t.id === s.selectedId);
      const n = i < 0 ? (d > 0 ? 0 : list.length - 1) : (i + d + list.length) % list.length;
      select(list[n].id);
    }
    else if (act === 'zoom') { tap('button'); setZoom(ZOOMS[(ZOOMS.indexOf(viewKm) + 1) % ZOOMS.length]); }
    else if (act === 'iff') {
      const b = blocked('iff'); if (b) { toast(b, 'amber'); return; }
      tap('button'); if (!sim.cmd.interrogate(tr.id)) toast('IFF not available', 'amber');
    } else if (act === 'cls') {
      if (!tr) { toast('Select a track on the scope first', 'amber'); return; }
      tap('button'); buzz(8); sim.cmd.classify(tr.id, el.dataset.v);
      if (el.dataset.v === 'HOSTILE') autoAssign(tr.id);
    } else if (act === 'chip') { chipTap(el.dataset.l); return; }
    else if (act === 'pick') {
      if (!tr) return;
      const lid = el.dataset.l || null;
      if (!lid && !tr.assigned) return;
      tap('button'); buzz(10);
      if (!sim.cmd.assign(tr.id, lid)) toast('Assign refused', 'amber');
      closeSheet();
    } else if (act === 'reload') {
      const l = s.battery.launchers.find(x => x.id === el.dataset.l); if (!l) return;
      const rs = s.battery.reserve;
      const b = l.jammed ? 'Launcher jammed' : !l.ready ? 'Already reloading' : l.rounds >= l.max ? l.id + ' is full' : rs && rs[l.weapon] <= 0 ? 'Reserve empty: no ' + W_UP(l.weapon) : null;
      if (b) { toast(b, 'amber'); return; }
      tap('button'); if (!sim.cmd.reload(l.id)) toast('Reload refused', 'amber');
    } else if (act === 'ack') { tap('button'); sim.cmd.ack(+el.dataset.id); cache.bc = null; }
    else if (act === 'restart') {
      $('endcard').classList.remove('show');
      if (RS.main && RS.main.restart) RS.main.restart(); else location.reload();
      return;
    }
    renderPanels(true);
  }

  function showEnd(p) {
    setArmed(false); closeSheet();
    if (RS.meta) return;                                  // meta owns the debrief; this card is the fallback only
    const st = p.stats || S().stats || {}, f = st.fired || {}, s = S();
    const col = p.grade === 'A' || p.grade === 'B' ? 'ok' : p.grade === 'C' ? 'amber' : 'red';
    const k = (a, b) => `<div><b>${a}</b><span>${b}</span></div>`;
    setHTML($('endbody'), 'end', `<div class="muted" style="letter-spacing:.2em">SHIFT ${p.failed ? 'FAILED' : 'COMPLETE'}</div>` +
      `<div class="grade ${col}">${esc(p.grade)}</div><div>${esc(String(p.reason || '').replace(/_/g, ' ').toUpperCase())}</div>` +
      '<div class="kv">' + k('KILLS', st.kills || 0) + k('MISSES', st.misses || 0) + k('LEAKERS', st.leakers || 0) +
      k('FIRED', (f.lance || 0) + (f.dart || 0) + (f.harrow || 0)) + k('ASSET', Math.round((s.asset ? s.asset.hp : 1) * 100) + '%') +
      k('FRAT', st.fratricide ? '<span class="red">YES</span>' : 'NO') + '</div>' +
      '<button class="btn" style="width:100%;min-height:52px" data-act="restart">RESTART</button>');
    $('endcard').classList.add('show');
  }

  function bindBus() {
    const on = RS.bus.on, T = id => `<b>${esc(id)}</b>`;
    on('SIM_TICK', () => {
      tickAt = performance.now();
      for (const m of S().missiles || []) lastPos[m.id] = [m.x, m.y];
      if (++tickN % 4 === 0) {                            // missile trails: sample every 0.2 s, keep ~2.4 s
        const ms = S().missiles || [], live = {};
        for (const m of ms) { live[m.id] = 1; const tr = trails[m.id] || (trails[m.id] = []); tr.push([m.x, m.y, m.alt + (m.loft || 0)]); if (tr.length > 12) tr.shift(); }
        for (const id in trails) if (!live[id]) delete trails[id];
      }
      renderPanels(false);
    });
    on('TRACK_SELECTED', () => { cache.bt = null; });
    on('TRACK_NEW', p => addLog(`NEW TRACK ${p.id} brg ${pad(p.track.bearingDeg, 3)}° ${p.track.rangeKm.toFixed(0)} km ${p.track.alt} m`, 'sys'));
    on('TRACK_LOST', p => { armIds.delete(p.id); if (p.reason !== 'faded' && p.reason !== 'killed') addLog(`TRACK ${p.id} ${String(p.reason).toUpperCase()}`, 'sys'); });
    on('RADAR_STATE', p => { if (!p.on) warnLoggedAt = -1; addLog(p.on ? 'RADAR TRANSMITTING' : 'RADAR SILENT (EMCON)', p.on ? 'sys' : 'hi'); });
    // throttle: first warning, then at most once a minute while still transmitting
    on('RADAR_WARN', p => {
      if (warnLoggedAt >= 0 && p.seconds - warnLoggedAt < 60) return;
      warnLoggedAt = p.seconds;
      addLog(`EMISSION WARNING: ${mmss(p.seconds)} continuous, ARM risk rising`, 'hi');
    });
    on('COMMS', p => {
      if (!S().comms) addLog(`<b>${esc(p.from)}:</b> ${esc(p.text)}`, p.priority === 'high' ? 'hi' : '');
      if (p.priority === 'high' || p.needsAck) { flagComms(); if (p.needsAck) toast(`${p.from}: acknowledge in COMMS`, 'amber'); }
    });
    on('IFF_RESULT', p => addLog(`IFF ${T(p.id)} ${String(p.result).replace('_', ' ')}`, p.result === 'FRIEND' ? 'sys' : p.result === 'INVALID' ? 'hi' : ''));
    on('CLASSIFIED', p => addLog(`${T(p.id)} CLASSIFIED ${p.cls}`, ''));
    on('ASSIGNED', p => addLog(`${T(p.id)} ASSIGNED ${p.launcherId} (${W_UP(p.weapon)})`, ''));
    on('LAUNCH', p => addLog(`LAUNCH ${p.launcherId} ${W_UP(p.weapon)} → ${T(p.targetId)}`, 'sys'));
    on('MISSILE_ACTIVE', p => addLog(`${esc(p.missileId)} ACTIVE → ${T(p.targetId)}: seeker on, radar free for this round`, 'sys'));
    on('GUN_FIRE', p => addLog(`G1 BURST → ${T(p.targetId)}`, 'sys'));
    on('KILL', p => addLog(p.wasFriend ? `FRIENDLY DOWN ${T(p.trackId || p.targetId)}` : `SPLASH ${T(p.trackId || p.targetId)} (${W_UP(p.weapon)})`, p.wasFriend ? 'hi' : 'sys'));
    on('MISS', p => {
      addLog(`MISS on ${T(p.targetId)}`, 'hi');
      const lp = p.missileId && lastPos[p.missileId];
      if (lp) marks.push({ x: lp[0], y: lp[1], text: 'MISS', col: '#9a5200', at: performance.now(), kill: false });
      if (p.missileId) delete lastPos[p.missileId];
    });
    on('KILL', p => { if (isFinite(p.x) && isFinite(p.y)) marks.push({ x: p.x, y: p.y, text: p.wasFriend ? 'FRIENDLY' : 'SPLASH', col: p.wasFriend ? '#1248cc' : '#0b7a36', at: performance.now(), kill: true }); });
    on('INTERCEPT', p => { if (p.missileId) delete lastPos[p.missileId]; });
    on('RADAR_REPAIR', p => addLog(p.active ? 'RADAR REPAIR STARTED (EMCON)' : 'RADAR REPAIRED', p.active ? 'hi' : 'sys'));
    on('EVADE', p => { if (p.trackId && p.kind !== 'dive') addLog(`${T(p.trackId)} EVADING (${String(p.kind).toUpperCase()})`, 'sys'); });
    on('FRATRICIDE', p => addLog(`FRATRICIDE: ${T(p.targetId)} WAS FRIENDLY`, 'hi'));
    on('FIRE_REJECTED', p => { rejectSeen = true; toast(why(p.reason), 'red'); addLog(`FIRE REJECTED ${T(p.id || '')}: ${short(p.reason)}`, ''); });
    on('RELOAD_START', p => addLog(`${p.launcherId} RELOADING ${Math.round(p.seconds)} s`, ''));
    on('RELOAD_DONE', p => addLog(`${p.launcherId} RELOADED`, 'sys'));
    on('ARM_INBOUND', p => { armIds.add(p.id); addLog(`ARM INBOUND ${T(p.id)} eta ${Math.round(p.eta)} s: GO SILENT`, 'hi'); buzz([80, 60, 80]); });
    on('ARM_IMPACT', p => addLog(`ARM IMPACT: radar damage ${Math.round(p.damage * 100)}%`, 'hi'));
    on('ASSET_HIT', p => addLog(`ASSET HIT by ${T(p.byId)} (-${Math.round(p.damage * 100)}%)`, 'hi'));
    on('LEAKER', p => addLog(`LEAKER ${T(p.id)} inside defended line`, 'hi'));
    on('ROE_CHANGE', p => { addLog(`ROE → WEAPONS ${p.roe}`, 'hi'); toast('ROE: WEAPONS ' + p.roe, 'amber'); });
    on('RANDOM_EVENT', p => { if (p.active) addLog(`EVENT: ${String(p.kind).replace(/_/g, ' ').toUpperCase()}${p.detail ? ' · ' + esc(typeof p.detail === 'object' ? Object.entries(p.detail).map(([k, v]) => k + ' ' + v).join(', ') : p.detail) : ''}`, 'hi'); });
    on('ALARM', p => { alarms[p.kind] = !!p.on; });
    on('WAVE', p => { addLog(`WAVE ${p.n} INBOUND: ${p.hostiles} hostile${p.hostiles === 1 ? '' : 's'}`, 'hi'); toast('WAVE ' + p.n, 'amber'); });
    on('SHIFT_START', p => {
      log.length = 0; warnLoggedAt = -1; armIds.clear(); lastRoe = null;
      for (const k in alarms) delete alarms[k];
      for (const k in trails) delete trails[k];
      const ec = $('endcard'); if (ec) ec.classList.remove('show');
      setArmed(false); closeSheet();
      addLog('SHIFT START: ' + esc(p.def.name), 'sys');
    });
    on('SHIFT_END', p => { addLog(`SHIFT END: grade ${p.grade} (${esc(p.reason)})`, 'hi'); showEnd(p); });
  }

  const api = {
    init({ root: r, sim: sm }) {
      root = r; sim = sm || RS.sim;
      if (inited) { renderPanels(true); return; }
      inited = true;
      scope = $('scope'); sctx = scope.getContext('2d');
      if (RS.cabin && $('p-scope')) RS.cabin.bind($('p-scope'), 'radar');   // V1.4: the console lives on the cabin's radar monitor
      hs = $('hstrip'); hctx = hs ? hs.getContext('2d') : null;
      FF = getComputedStyle(document.body).fontFamily || 'monospace';
      document.addEventListener('click', onClick);
      const freeze = () => { frozen = true; frozenT = performance.now(); };
      const thaw = () => setTimeout(() => { frozen = false; }, 80);
      for (const id of ['tabbody', 'sheet']) $(id).addEventListener('pointerdown', freeze);
      window.addEventListener('pointerup', thaw); window.addEventListener('pointercancel', thaw);
      scope.addEventListener('pointerdown', onDown);
      scope.addEventListener('pointermove', onMove);
      scope.addEventListener('pointerup', onUp);
      scope.addEventListener('pointercancel', onUp);
      if (hs) hs.addEventListener('pointerdown', onStripDown);
      const relayout = () => { layoutScope(); sizeScope(); sizeStrip(); };
      window.addEventListener('resize', () => { relayout(); renderPanels(true); });
      if (window.ResizeObserver) new ResizeObserver(relayout).observe($('sbody') || scope);
      bindThumb();
      bindFast();
      bindBus();
      relayout();
      requestAnimationFrame(drawScope);
      renderPanels(true);
    },
    expand,
    get expanded() { return tab; },
    get zoomKm() { return viewKm; },
    get fireArmed() { return fire.armed; },
    get sheetOpen() { return sheetOpen; },
    setZoom,
    /** Test helper: page (CSS px) position of a track on the PPI, or null if unknown. */
    debugTrackScreenPos(id) {
      const tr = S().tracks.find(t => t.id === id);
      if (!tr) return null;
      sizeScope();
      const p = trackPos(tr), c = clientOf(scope, p.x, p.y);
      return { x: c.x, y: c.y, out: p.out };
    },
    /** Test helper: page position of a track on the range-height strip (out:true = pinned beyond the zoom range), or null. */
    debugStripPos(id) {
      const tr = S().tracks.find(t => t.id === id);
      if (!tr || !hs) return null;
      sizeStrip();
      const p = stripPos(tr), c = clientOf(hs, p.x, p.y);
      return { x: c.x, y: c.y, out: p.out };
    },
    /** Page position of a scope point (km east / north of the battery), clamped inside the glass: e.g. a missile for the tutorial.
     *  (All debug*Pos helpers map through RS.cabin, so they land on the projected console.) */
    debugScopePos(xKm, yKm) {
      sizeScope();
      const p = kmPos(xKm, yKm), d = Math.hypot(p.x - cx, p.y - cy), k = d > R - 6 ? (R - 6) / d : 1, c = clientOf(scope, cx + (p.x - cx) * k, cy + (p.y - cy) * k);
      return { x: c.x, y: c.y, out: k < 1 };
    },
    /** Page position of one of our missiles on the PPI (null if not in flight). */
    debugMissileScreenPos(id) {
      const m = (S().missiles || []).find(q => q.id === id);
      return m ? api.debugScopePos(m.x, m.y) : null;
    }
  };
  RS.ui = api;
})();
