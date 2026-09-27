/* =====================================================================
   RED SKIES — ui.js   RS.ui : desk monitors + thumb zone.
   Layout: radar scope always visible; TRACK/IFF, BATTERY, COMMS/LOG are tabs below it.
   Reads RS.sim.state (never .visible, never true kinds). Writes only via RS.sim.cmd.
   Panels redraw ≤10 Hz on SIM_TICK (active tab only); the scope redraws every animation frame.
   Scope input: tap near a track → snaps to nearest; drag finger → selection follows nearest track;
   ZOOM button cycles display range 100/60/30/15 km (display only, radar range unchanged).
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
  const CROWD_PX = 22;
  const CLS_COL = { UNKNOWN: [255, 176, 32], HOSTILE: [255, 75, 58], FRIEND: [63, 240, 208] };

  let sim, root, scope, sctx, dpr = 1, W = 0, H = 0, cx = 0, cy = 0, R = 1, inited = false;
  let tab = 'track', viewKm = 100, lastPanelAt = 0, tickAt = 0, FF = 'monospace';
  let drag = null;                      // {id:pointerId, x, y} while finger is on the scope
  let warnLoggedAt = -1;                // emitTime of last logged RADAR_WARN (throttle)
  let frozen = false, frozenT = 0;      // no DOM rebuild of tab body / sheet while a finger is down on it
  let sheetOpen = false, press = null, noClickUntil = 0, toastT = 0, rejectSeen = false, lastRoe = null, alertOn = false, tickN = 0;
  const fire = { armed: false, holdAt: 0, lastAt: 0, pid: null, need: HOLD_MS };
  // Fast buttons act on pointerup (not the delayed/fragile synthesized click): thumb zone, launcher chips, zoom.
  const FAST = '#thumbzone [data-act], #lstrip [data-act], #b-zoom, #b-prev, #b-next';
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
  function sizeScope() {
    if (!scope) return;
    const w = scope.clientWidth, h = scope.clientHeight;
    if (!w || !h) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (scope.width !== Math.round(w * dpr) || scope.height !== Math.round(h * dpr)) {
      scope.width = Math.round(w * dpr); scope.height = Math.round(h * dpr);
    }
    W = w; H = h; cx = w / 2; cy = (h + TOP_PAD) / 2; R = Math.max(20, Math.min(w, h - TOP_PAD) / 2 - 10);
  }
  const ang = b => (b - 90) * D2R;
  const kmPos = (x, y) => ({ x: cx + x / viewKm * R, y: cy - y / viewKm * R });
  /** Screen position of a track; tracks beyond the display range are pinned to the rim (out:true). */
  function trackPos(tr) {
    const r = Math.hypot(tr.x, tr.y);
    if (r <= viewKm) { const p = kmPos(tr.x, tr.y); p.out = false; return p; }
    const t = ang(tr.bearingDeg);
    return { x: cx + Math.cos(t) * (R - 6), y: cy + Math.sin(t) * (R - 6), out: true };
  }

  /** NTDS-style symbol: UNKNOWN open square, HOSTILE diamond, FRIEND circle. */
  function symbol(c, cls, x, y, d) {
    c.beginPath();
    if (cls === 'HOSTILE') { c.moveTo(x, y - d); c.lineTo(x + d, y); c.lineTo(x, y + d); c.lineTo(x - d, y); c.closePath(); }
    else if (cls === 'FRIEND') c.arc(x, y, d * 0.85, 0, 7);
    else c.rect(x - d * 0.75, y - d * 0.75, d * 1.5, d * 1.5);
    c.stroke();
  }

  function drawScope() {
    requestAnimationFrame(drawScope);
    if (!sctx || !sim) return;
    const now = performance.now();
    tickFire(now);
    if (scope.clientWidth !== W || scope.clientHeight !== H) sizeScope();
    const s = S(), rad = s.radar, on = rad.on, c = sctx, rk = viewKm;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = '#020604'; c.fillRect(0, 0, W, H);
    const bg = c.createRadialGradient(cx, cy, 0, cx, cy, R);
    bg.addColorStop(0, on ? '#06190d' : '#040a06'); bg.addColorStop(1, '#020805');
    c.fillStyle = bg; c.beginPath(); c.arc(cx, cy, R, 0, 7); c.fill();
    c.globalAlpha = on ? 1 : 0.4;

    // sweep with afterglow (extrapolated between sim ticks for smoothness)
    if (on) {
      const since = Math.min(RS.SIM_DT, (now - tickAt) / 1000);
      const a = ang(rad.sweepDeg + rad.rpm * 6 * since), N = 28, step = 2.2 * D2R;
      for (let i = 0; i < N; i++) {
        c.fillStyle = `rgba(69,255,132,${(0.22 * (1 - i / N)).toFixed(3)})`;
        c.beginPath(); c.moveTo(cx, cy); c.arc(cx, cy, R, a - (i + 1) * step, a - i * step); c.closePath(); c.fill();
      }
      c.strokeStyle = 'rgba(140,255,180,.9)'; c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); c.stroke();
    }

    // rings + ticks + cardinal letters (inside the rim, leaving the top edge for the ROE pill)
    c.strokeStyle = '#1d6b3a'; c.lineWidth = 1; c.fillStyle = '#2fbf62'; c.font = '9px ' + FF;
    c.textAlign = 'left'; c.textBaseline = 'alphabetic';
    for (const r of RINGS[rk]) { const rr = r / rk * R; c.beginPath(); c.arc(cx, cy, rr, 0, 7); c.stroke(); const la = ang(160); c.fillText(r + '', cx + Math.cos(la) * rr + 3, cy + Math.sin(la) * rr - 3); }
    for (let b = 0; b < 360; b += 10) {
      const t = ang(b), l = b % 30 ? 4 : 9;
      c.beginPath(); c.moveTo(cx + Math.cos(t) * (R - l), cy + Math.sin(t) * (R - l)); c.lineTo(cx + Math.cos(t) * R, cy + Math.sin(t) * R); c.stroke();
    }
    c.font = 'bold 11px ' + FF; c.textAlign = 'center'; c.textBaseline = 'middle';
    [['N', 0], ['E', 90], ['S', 180], ['W', 270]].forEach(([n, b]) => { const t = ang(b); c.fillText(n, cx + Math.cos(t) * (R - 17), cy + Math.sin(t) * (R - 17)); });
    // radar damage: dimmed red segment of the rim proportional to lost health
    if (rad.health < 1) {
      c.strokeStyle = 'rgba(255,75,58,.45)'; c.lineWidth = 5;
      c.beginPath(); c.arc(cx, cy, R + 3, ang(0), ang(0) + (1 - Math.max(0, rad.health)) * Math.PI * 2); c.stroke();
    }
    c.fillStyle = '#ffb020'; c.fillRect(cx - 2.5, cy - 2.5, 5, 5);
    c.globalAlpha = 1;

    // tracks
    c.font = '11px ' + FF; c.textAlign = 'left'; c.textBaseline = 'middle';
    const blink = (now / 300 | 0) % 2 === 0, pulse = (now % 1000) / 1000;
    let selPos = null;
    const pos = {}, labels = [];
    for (const tr of s.tracks) {
      const p = trackPos(tr), x = p.x, y = p.y; pos[tr.id] = p;
      const age = s.t - tr.lastSeen, glow = Math.exp(-age / 2.5);
      const alpha = Math.min(1, 0.35 + 0.5 * tr.quality + 0.3 * glow) * (on ? 1 : 0.7) * (p.out ? 0.6 : 1);
      const rgb = CLS_COL[tr.cls] || CLS_COL.UNKNOWN, k = 0.75 + 0.25 * glow;
      const col = `rgba(${Math.round(rgb[0] * k)},${Math.round(rgb[1] * k)},${Math.round(rgb[2] * k)},${alpha.toFixed(2)})`;
      if (tr.strobe) {
        c.strokeStyle = `rgba(255,176,32,${alpha * 0.6})`; c.lineWidth = 1; c.beginPath(); c.moveTo(cx, cy);
        const t = ang(tr.bearingDeg); c.lineTo(cx + Math.cos(t) * R, cy + Math.sin(t) * R); c.stroke();
      }
      if (tr.assigned) {                                   // assigned: dashed line from the battery
        c.strokeStyle = 'rgba(255,210,140,.55)'; c.lineWidth = 1; c.setLineDash([3, 4]);
        c.beginPath(); c.moveTo(cx, cy); c.lineTo(x, y); c.stroke(); c.setLineDash([]);
      }
      c.fillStyle = col; c.strokeStyle = col; c.lineWidth = 1;
      if (p.out) {                                  // off-scale: small chevron on the rim pointing outward
        const t = ang(tr.bearingDeg), d = 5;
        c.beginPath(); c.moveTo(x + Math.cos(t) * d, y + Math.sin(t) * d);
        c.lineTo(x + Math.cos(t + 2.4) * d, y + Math.sin(t + 2.4) * d); c.lineTo(x + Math.cos(t - 2.4) * d, y + Math.sin(t - 2.4) * d);
        c.closePath(); c.fill();
      } else {
        const lead = tr.spd * 60 / 1000 / rk * R;   // velocity leader: 60 s of travel
        c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.sin(tr.hdg * D2R) * lead, y - Math.cos(tr.hdg * D2R) * lead); c.stroke();
        c.lineWidth = 2; symbol(c, tr.cls, x, y, 6 + 1.5 * glow); c.lineWidth = 1;
        labels.push({ tr, x, y, col, alpha });
      }
      if (tr.iff === 'PENDING') {                         // IFF pending: pulsing ring
        c.strokeStyle = `rgba(255,220,120,${(1 - pulse).toFixed(2)})`; c.lineWidth = 1.5;
        c.beginPath(); c.arc(x, y, 8 + 12 * pulse, 0, 7); c.stroke();
      }
      if (armIds.has(tr.id) && blink && p.out) {
        c.fillStyle = '#ff4b3a'; c.font = 'bold 11px ' + FF; c.fillText('ARM', x + 10, y); c.font = '11px ' + FF;
      }
      if (tr.id === s.selectedId) selPos = p;
    }
    drawLabels(c, labels, s.selectedId, blink);
    // missiles in flight: bright dot, short trail, thin line to the target track
    for (const m of s.missiles || []) {
      const mp = kmPos(m.x, m.y), tp = pos[m.targetId];
      if (tp) { c.strokeStyle = 'rgba(255,255,255,.25)'; c.lineWidth = 1; c.beginPath(); c.moveTo(mp.x, mp.y); c.lineTo(tp.x, tp.y); c.stroke(); }
      const tr = trails[m.id] || [];
      c.strokeStyle = 'rgba(220,255,230,.55)'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(mp.x, mp.y);
      let len = 0, px = mp.x, py = mp.y;
      for (let i = tr.length - 1; i >= 0; i--) { const q = kmPos(tr[i][0], tr[i][1]); len += Math.hypot(q.x - px, q.y - py); px = q.x; py = q.y; c.lineTo(q.x, q.y); }
      if (len < 8 && m.hdg != null) c.lineTo(mp.x - Math.sin(m.hdg * D2R) * 8, mp.y + Math.cos(m.hdg * D2R) * 8);
      c.stroke();
      c.fillStyle = '#ffffff'; c.beginPath(); c.arc(mp.x, mp.y, 2.6, 0, 7); c.fill();
    }
    if (selPos) {
      c.strokeStyle = '#ffffff'; c.lineWidth = 1.5; const b = 13;
      c.strokeRect(selPos.x - b, selPos.y - b, b * 2, b * 2);
    }
    // drag reticle: ring under the finger + leader to the track it is locking
    if (drag) {
      c.strokeStyle = 'rgba(255,176,32,.55)'; c.lineWidth = 1.5;
      c.beginPath(); c.arc(drag.x, drag.y, 26, 0, 7); c.stroke();
      if (selPos) { c.setLineDash([4, 4]); c.beginPath(); c.moveTo(drag.x, drag.y); c.lineTo(selPos.x, selPos.y); c.stroke(); c.setLineDash([]); }
    }
    if (!on) {
      c.fillStyle = '#ffb020'; c.font = 'bold 16px ' + FF; c.textAlign = 'center';
      c.fillText('RADAR OFF', cx, cy + R * 0.35);
    }
    // corner readouts (pushed below the alert strip when it is showing)
    const ty = alertOn ? 38 : 14;
    c.textAlign = 'left'; c.font = '11px ' + FF; c.textBaseline = 'middle';
    c.fillStyle = rad.emitTime > 90 ? '#ff4b3a' : '#2fbf62';
    c.fillText(on ? 'TX ' + mmss(rad.emitTime) : 'SILENT', 8, ty);
    if (rad.health < 1) { c.fillStyle = '#ff4b3a'; c.fillText('RDR ' + Math.round(rad.health * 100) + '%', 8, ty + 15); }
    c.fillStyle = '#2fbf62'; c.textAlign = 'right'; c.fillText('TRK ' + s.tracks.length, W - 8, ty);
  }

  /** Track labels: selected first (always full id + altitude); a track with another contact within CROWD_PX gets
   *  its id only. Each label takes the first of 4 slots (right, left, above, below) not overlapping symbols, the
   *  ROE pill or labels already placed; a non-selected label with no free slot is skipped (symbol stays). */
  function drawLabels(c, list, selId, blink) {
    const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    const boxes = list.map(o => ({ x: o.x - 8, y: o.y - 8, w: 16, h: 16, o }));
    const placed = [{ x: cx - 40, y: (alertOn ? 28 : 3), w: 80, h: 24 }], la = ang(160);   // ROE pill + ring numerals
    for (const rk of RINGS[viewKm]) { const rr = rk / viewKm * R; placed.push({ x: cx + Math.cos(la) * rr + 2, y: cy + Math.sin(la) * rr - 10, w: 14, h: 10 }); }
    list.sort((a, b) => (b.tr.id === selId) - (a.tr.id === selId) || b.tr.priority - a.tr.priority);
    for (const o of list) {
      const sel = o.tr.id === selId;
      const crowd = !sel && list.some(q => q !== o && Math.hypot(q.x - o.x, q.y - o.y) < CROWD_PX);
      const alt = crowd ? null : pad(Math.round(o.tr.alt / 100), 3), arm = armIds.has(o.tr.id);
      const w = Math.max(c.measureText(o.tr.id).width, alt ? c.measureText(alt).width : 0, arm ? 24 : 0) + 2;
      const h = (alt ? 26 : 13) + (arm ? 13 : 0), g = sel ? 15 : 10;
      const slots = [[o.x + g, o.y - 13], [o.x - g - w, o.y - 13], [o.x - w / 2, o.y - g - h], [o.x - w / 2, o.y + g]];
      let r = null;
      for (const [sx, sy] of slots) {
        const cand = { x: sx, y: sy, w, h };
        if (!placed.some(p => hit(p, cand)) && !boxes.some(b => b.o !== o && hit(b, cand))) { r = cand; break; }
      }
      if (!r && !sel) continue;
      r = r || { x: slots[0][0], y: slots[0][1], w, h };
      placed.push(r);
      c.fillStyle = sel ? '#ffffff' : o.col; c.fillText(o.tr.id, r.x, r.y + 6);
      if (alt) { c.fillStyle = `rgba(160,200,170,${(o.alpha * 0.8).toFixed(2)})`; c.fillText(alt, r.x, r.y + 20); }
      if (arm && blink) { c.fillStyle = '#ff4b3a'; c.font = 'bold 11px ' + FF; c.fillText('ARM', r.x, r.y + h - 6); c.font = '11px ' + FF; }
    }
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
  function local(ev) { const r = scope.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; }
  function select(id) {
    if (S().selectedId === id) return;
    tap('track'); buzz(8); sim.cmd.selectTrack(id); renderPanels(true);
  }
  function onDown(ev) {
    const [x, y] = local(ev);
    drag = { id: ev.pointerId, x, y };
    try { scope.setPointerCapture(ev.pointerId); } catch (e) { }
    const n = nearest(x, y, SNAP_PX);
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
    if (Object.keys(chips).length !== L.length || !L.every(l => chips[l.id])) {
      el.innerHTML = '';
      for (const k in chips) delete chips[k];
      for (const l of L) {
        const b = document.createElement('button');
        b.className = 'lchip'; b.id = 'chip-' + l.id; b.dataset.act = 'chip'; b.dataset.l = l.id;
        b.innerHTML = '<span class="lc-h"></span><span class="lc-p"></span><span class="lc-s"></span>';
        el.appendChild(b); chips[l.id] = { b, h: b.children[0], p: b.children[1], st: b.children[2], k: {} };
      }
    }
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
    if (ps) ps.classList.toggle('alerting', alertOn);
    const rp = $('roepill'), roe = s.shift.roe;
    if (rp && roe !== lastRoe) {
      rp.textContent = roe; rp.className = 'pill ' + (roe === 'FREE' ? 'red' : roe === 'TIGHT' ? 'amber' : 'ok');
      if (lastRoe) { void rp.offsetWidth; rp.classList.add('flash'); }
      lastRoe = roe;
    }
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
    const ck = $('clock'); if (ck) ck.textContent = mmss(s.shift.elapsed) + ' / ' + mmss(s.shift.duration);
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
    const b = $('b-zoom'); if (b) b.innerHTML = km + ' KM<b>ZOOM</b>';
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
    else if (act === 'radar') { tap('button'); sim.cmd.radar(!s.radar.on); }
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
      if (++tickN % 4 === 0) {                            // missile trails: sample every 0.2 s, keep ~2.4 s
        const ms = S().missiles || [], live = {};
        for (const m of ms) { live[m.id] = 1; const tr = trails[m.id] || (trails[m.id] = []); tr.push([m.x, m.y]); if (tr.length > 12) tr.shift(); }
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
    on('GUN_FIRE', p => addLog(`G1 BURST → ${T(p.targetId)}`, 'sys'));
    on('KILL', p => addLog(p.wasFriend ? `FRIENDLY DOWN ${T(p.trackId || p.targetId)}` : `SPLASH ${T(p.trackId || p.targetId)} (${W_UP(p.weapon)})`, p.wasFriend ? 'hi' : 'sys'));
    on('MISS', p => addLog(`MISS on ${T(p.targetId)}`, 'hi'));
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
      window.addEventListener('resize', () => { sizeScope(); renderPanels(true); });
      if (window.ResizeObserver) new ResizeObserver(sizeScope).observe(scope);
      bindThumb();
      bindFast();
      bindBus();
      sizeScope();
      requestAnimationFrame(drawScope);
      renderPanels(true);
    },
    expand,
    get expanded() { return tab; },
    get zoomKm() { return viewKm; },
    get fireArmed() { return fire.armed; },
    get sheetOpen() { return sheetOpen; },
    setZoom,
    /** Test helper: page (CSS px) position of a track on the scope, or null if unknown. */
    debugTrackScreenPos(id) {
      const tr = S().tracks.find(t => t.id === id);
      if (!tr) return null;
      sizeScope();
      const rect = scope.getBoundingClientRect(), p = trackPos(tr);
      return { x: rect.left + p.x, y: rect.top + p.y, out: p.out };
    }
  };
  RS.ui = api;
})();
