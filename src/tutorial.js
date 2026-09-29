/* =====================================================================
   RED SKIES — tutorial.js   RS.tutorial : guided "Training Watch" (V1.1).
   Plays a scripted, forgiving shift (day/clear, ROE TIGHT, no random events): a friendly CAP fighter with a radio call,
   a slow hostile jet in Lance range, then a small drone for the Dart. Every shot the player fires hits (ShiftDef.sureHit, V1.4.4). A coach card (top of the screen, over the 3-D
   view, never over the thumb zone or the element it points at) walks the player through the real controls; a pulsing
   ring sits on the control (or scope contact) to use. Steps advance on real bus events / sim state, so doing things out
   of order is fine (a step whose goal is already met is skipped). Text-only steps freeze the sim with RS.main.hold(true).
   API: start(), stop(), get running, get done, debug().   Save key 'tutorial' {done}.   Bus: TUTORIAL {step, done}.
   The script knows its own spawns: contacts are matched to their role by RS.sim.debugTruth (fallback: geometry).
   ===================================================================== */
(function () {
  const RS = window.RS;
  const $ = id => document.getElementById(id);
  const WL = { lance: 'LANCE', dart: 'DART', harrow: 'GUN' };
  const FRIENDK = { jet_friend: 1, strike_friend: 1, transport: 1, helo_friend: 1 };
  const TOP_PAD = 12;                                   // ui.js scope geometry (for the missile position)

  /** The training ShiftDef (fresh copy each start). */
  function makeDef() {
    return {
      id: 'TRAIN', name: 'Training Watch', tutorial: true, duration: 1800, roe: 'TIGHT', sureHit: true,   // training: every shot kills
      weather: { time: 'day', sky: 'clear' }, reserve: { lance: 12, dart: 12, harrow: 1800 }, events: [], roeChanges: [],
      spawns: [
        { t: 0, kind: 'jet_friend', callsign: 'Viper 1', x: -16, y: 13, alt: 6000, hdg: 0, spd: 200, orbit: { cx: -14, cy: 12, r: 6 } },
        { t: 0, kind: 'jet_hostile', x: 26, y: 31, alt: 5000, hdg: 220, spd: 170 },          // ~40 km NE, slow, inbound (the tracker camera sees 35 km)
        { t: 55, kind: 'drone', x: 8, y: -12, alt: 300, hdg: 326, spd: 40 }                  // ~14 km SE, low and slow (Dart)
      ],
      comms: [
        { t: 1, from: 'CAP', text: 'Viper 1 on station west of you, squawking friendly.', priority: 'normal' },
        { t: 3, from: 'HQ', text: 'No friendly flights north-east today. Anything there is hostile.', priority: 'high' }
      ]
    };
  }

  const CSS = `
#tut-card { position: fixed; z-index: 9; display: none; padding: 9px 11px 8px; border: 1px solid #ffd24a; border-radius: 8px;
  background: rgba(5,14,9,.95); color: #e4f3e8; box-shadow: 0 6px 22px rgba(0,0,0,.6); font-size: 14px; line-height: 1.4; }
#tut-card.on { display: block; }
#tut-card .tk { font-size: 10px; letter-spacing: .18em; color: #ffd24a; margin-bottom: 3px; }
#tut-card .tt b { color: #fff; }
#tut-card .tt .c { color: #3ff0d0; } #tut-card .tt .r { color: #ff6a5a; } #tut-card .tt .a { color: #ffb020; }
#tut-card .th { display: none; margin-top: 5px; color: #ffb020; font-size: 13px; }
#tut-card .th.on { display: block; }
#tut-card .tb { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 6px; }
#tut-card .tb button { min-height: 44px; min-width: 64px; padding: 0 14px; border-radius: 6px; font-size: 13px; letter-spacing: .08em; }
#tut-card .tskip { color: #8fa898; border: 1px solid #2f4a39; }
#tut-card .tskip.arm { color: #ffb020; border-color: #ffb020; }
#tut-card .tnext { background: #ffd24a; color: #0a0d0b; font-weight: bold; }
#tut-card .twait { color: #8fa898; font-size: 12px; text-align: right; }
#tut-ring { position: fixed; z-index: 9; display: none; pointer-events: none; border: 3px solid #ffd24a; border-radius: 10px;
  animation: tutp 1.1s ease-out infinite; }
#tut-ring.on { display: block; }
#tut-ring.pt { border-radius: 50%; }
@keyframes tutp { 0% { box-shadow: 0 0 0 0 rgba(255,210,74,.75); opacity: 1; } 70% { box-shadow: 0 0 0 14px rgba(255,210,74,0); opacity: .75; }
  100% { box-shadow: 0 0 0 0 rgba(255,210,74,0); opacity: 1; } }
@media (prefers-reduced-motion: reduce) { #tut-ring { animation: none; } }`;

  /* ---------- state ---------- */
  let running = false, idx = 0, def = null, raf = 0, starting = false, holding = false, oops = false, skipArm = 0, hint = '', hintStep = -1;
  let card = null, ring = null, lastHtml = '', built = false, zoom0 = 100;
  let F = {};                                           // per-shift flags (launched/killed/gone/missed, cached ids)
  const resetFlags = () => { F = { ids: {}, seen: {}, launched: {}, killed: {}, gone: {}, missed: {}, shot: {}, camFar: {} }; };
  resetFlags();

  const S = () => RS.sim.state;
  const truth = id => { try { return RS.sim.debugTruth ? RS.sim.debugTruth(id) : null; } catch (e) { return null; } };
  /** Role of a track in the script: 'friend' | 'jet' | 'drone' | null. */
  function role(tr) {
    const k = truth(tr.id);
    if (k) return FRIENDK[k] ? 'friend' : k === 'jet_hostile' ? 'jet' : k === 'drone' ? 'drone' : null;
    return tr.x < -3 ? 'friend' : tr.y > 0 ? 'jet' : 'drone';               // geometry fallback (W / NE / SE)
  }
  function scan() {                                     // cache current track id per role
    const ids = {};
    for (const tr of S().tracks) { const r = role(tr); if (r && !ids[r]) ids[r] = tr.id; }
    for (const r in ids) { F.seen[r] = true; if (F.gone[r]) F.gone[r] = false; }
    F.ids = ids;
  }
  const trk = r => { const id = F.ids[r]; return id ? S().tracks.find(t => t.id === id) || null : null; };
  const sel = r => !!F.ids[r] && S().selectedId === F.ids[r];
  const over = r => F.killed[r] || F.gone[r];
  const inFlight = r => (S().missiles || []).some(m => m.targetId === F.ids[r]);
  /** What the tracker camera shows of role r: {s:'seen'} (in its range), {s:'far', km, max} (aimed at it, too far away),
   *  {s:'other'} (watching something else or nothing), or null (no camera, e.g. node tests). big: swapped to fill the view.
   *  far: max = whole km it sees, km = the jet's distance to 0.1 km like the camera's own readout, always shown above max. */
  function cam(r) {
    let e = null;
    try { e = RS.scene && RS.scene.eo ? RS.scene.eo.state : null; } catch (x) { e = null; }
    if (!e || !e.on) return null;
    const big = !!e.swapped;
    if (!F.ids[r] || e.trackId !== F.ids[r] || !e.hasTarget) return { s: 'other', big };
    if (e.inRange) return { s: 'seen', big };
    const max = Math.floor(e.maxKm);
    return { s: 'far', big, max, km: Math.max(+e.rangeKm.toFixed(1), max + 0.1).toFixed(1) };
  }
  /** "the tracker camera" (+ where it is, unless it fills the view); up = capital first letter */
  const camName = (c, up) => (up ? 'The' : 'the') + ' <b>tracker camera</b>' + (c && c.big ? '' : ' (top right)');
  const lname = id => { const l = S().battery.launchers.find(x => x.id === id); return id + ' ' + (l ? WL[l.weapon] || l.weapon.toUpperCase() : ''); };

  /* ---------- steps ----------
     text(): html · at(): '#selector' | {x,y} (page px) | null · next: true/fn → NEXT button + sim held
     wait(): true → advance · need: role that must be selected (else the step asks for it) · hold:false keeps the sim running */
  const trackAt = r => () => F.ids[r] ? { track: F.ids[r] } : '#scope';
  const STEPS = [
    { id: 'welcome', next: true, at: () => null,
      text: () => '<b>Welcome to Battery Kessel.</b> You guard the airbase behind you from air attack. ' +
        'This short training shows you the controls. Nothing moves while you read.' },
    { id: 'scope', next: true, at: () => '#p-scope',
      text: () => 'This is your <b>radar scope</b>. You are the square in the middle, north is up, and the rings show distance in km.' },
    { id: 'radar', next: true, at: () => '#b-radar',
      text: () => '<b>RADAR</b> is on. It finds aircraft, but it also gives you away: after 90 s the <b>TX</b> timer turns red ' +
        'and enemies may fire radar-hunting missiles. Switch it off when the sky is quiet.' },
    { id: 'zoom', wait: () => RS.ui && RS.ui.zoomKm !== zoom0, at: () => '#b-zoom',
      text: () => 'Tap <b>ZOOM</b> for a closer look. It cycles 100, 60, 30 and 15 km.' },
    { id: 'f_sel', wait: () => sel('friend') || !!(trk('friend') && trk('friend').cls === 'FRIEND'), at: trackAt('friend'),
      text: () => F.ids.friend ? 'Contacts show up as <span class="a">amber squares</span>. Tap the one in the ring.'
        : 'Watch the sweep. The radar needs a couple of turns to find a contact.' },
    { id: 'f_iff', need: 'friend', wait: () => { const t = trk('friend'); return !!t && (t.iff === 'FRIEND' || t.cls === 'FRIEND'); }, at: () => '#b-iff',
      text: () => 'Tap <b>IFF</b> to ask it "friend or foe?". The answer takes a second.' },
    { id: 'f_cls', need: 'friend', wait: () => { const t = trk('friend'); return !!t && t.cls === 'FRIEND'; }, at: () => '#b-friend',
      text: () => 'It answered <span class="c">FRIEND</span>. That is Viper 1, our fighter (it called in on the radio). Tap <b>FRIEND</b>.' },
    { id: 'f_ok', next: true, at: trackAt('friend'),
      text: () => 'Friends turn into <span class="c">blue circles</span>. You can never fire at a track marked FRIEND.' },
    { id: 'j_sel', wait: () => sel('jet') || over('jet'), at: trackAt('jet'),
      text: () => F.ids.jet ? 'Now the contact in the <b>north-east</b>. Tap it.' : 'Watch the north-east. Another contact is on its way.' },
    { id: 'j_iff', need: 'jet', wait: () => { const t = trk('jet'); return over('jet') || (!!t && (t.iff === 'NO_RESPONSE' || t.iff === 'INVALID' || t.cls === 'HOSTILE')); },
      at: () => '#b-iff', text: () => 'Ask this one with <b>IFF</b> too.' },
    { id: 'j_radio', next: true, at: () => '#tab-comms',
      text: () => 'No answer. And HQ radioed: <i>"No friendly flights north-east today."</i> Radio calls are kept in <b>COMMS / LOG</b>.' },
    { id: 'j_cls', need: 'jet', wait: () => { const t = trk('jet'); return over('jet') || (!!t && t.cls === 'HOSTILE'); }, at: () => '#b-hostile',
      text: () => 'No IFF reply plus the radio call: it is an enemy. Tap <b>HOSTILE</b>.' },
    { id: 'assign', need: 'jet', next: () => { const t = trk('jet'); return !!(t && t.assigned); }, wait: () => over('jet'),
      at: () => { const t = trk('jet'); return t && t.assigned ? '#chip-' + t.assigned : '#b-assign'; },
      text: () => { const t = trk('jet'); return t && t.assigned
        ? `The battery picked <b>${lname(t.assigned)}</b> for it. Lance reaches 60 km, Dart 25 km, the Harrow gun only 4 km. Tap a launcher chip to choose yourself.`
        : 'Tap <b>ASSIGN</b> to give it a launcher.'; } },
    { id: 'fire', need: 'jet', wait: () => F.launched.jet || over('jet'), at: () => '#b-fire',
      text: () => 'Weapons <span class="a">TIGHT</span>: you may fire at HOSTILE tracks. <b>Press and hold FIRE</b> until the ring fills.' },
    // V1.4.4: the camera only sees ~35 km, so these follow what it really shows (OUT OF RANGE → picked up); NEXT is offered
    // while the missile flies, and the step moves on by itself at the splash
    { id: 'cam', next: () => !over('jet'), hold: false, wait: () => over('jet') || (!inFlight('jet') && F.missed.jet),
      at: () => { const c = cam('jet'); return c && c.s === 'seen' ? '#eo-fr' : missileAt('jet'); }, eye: true,
      text: () => {
        const c = cam('jet');
        if (c && c.s === 'seen') return `${camName(c, true)} has picked up the jet: <b>watch the splash!</b> The small arrow on the scope is your missile.` +
          (c.big ? '' : ' <b>Tip:</b> tap the camera to make it big.');
        if (c && c.s === 'far') return `Missile away! The small arrow on the scope is your missile. ${camName(c, true)} says <span class="r">OUT OF RANGE</span>: ` +
          `it sees about ${c.max} km and the jet is ${c.km} km away. It picks the jet up as it comes closer.`;
        return `Missile away! The small arrow on the scope is your missile. <b>Tip:</b> tap the jet (or your missile) to aim ${camName(c)} at the jet.`;
      } },
    { id: 'j_kill', wait: () => over('jet'), watch: true, eye: true,
      at: () => { const c = cam('jet'); return c && c.s === 'seen' ? '#eo-fr' : F.ids.jet ? { track: F.ids.jet } : '#scope'; },
      text: () => {
        const c = cam('jet');
        if (c && c.s === 'seen') return 'The camera has the jet: <b>watch the splash!</b>';
        if (c && c.s === 'far') return `Your missile is on its way. The camera picks the jet up inside about ${c.max} km (the jet is ${c.km} km away now).`;
        return 'Wait for your missile to reach the jet...';
      } },
    { id: 'splash', next: true, at: () => null, eye: true,
      text: () => !F.killed.jet ? 'It got past you this time. On a real watch, fire before it reaches the base.'
        : F.camFar.jet ? '<b>Splash!</b> Target destroyed. It went down beyond the camera\'s reach, so the camera only showed the SPLASH tag. Nice work.'
          : '<b>Splash!</b> Target destroyed. Nice work.' },
    { id: 'd_sel', wait: () => sel('drone') || over('drone'), at: trackAt('drone'),
      text: () => F.ids.drone ? 'A new contact is creeping in <b>low and slow</b> from the south-east. Tap it.'
        : 'Keep watching the scope: something small is coming from the south-east.' },
    { id: 'd_id', need: 'drone', wait: () => { const t = trk('drone'); return over('drone') || (!!t && t.cls === 'HOSTILE'); },
      at: () => { const t = trk('drone'); return t && (t.iff === 'NONE' || t.iff === 'PENDING') ? '#b-iff' : '#b-hostile'; },
      text: () => { const t = trk('drone'); return t && (t.iff === 'NONE' || t.iff === 'PENDING') ? 'Check it with <b>IFF</b> first.'
        : 'No reply, and nothing of ours flies that low and slow. Tap <b>HOSTILE</b>.'; } },
    { id: 'd_fire', need: 'drone', wait: () => F.launched.drone || over('drone'),
      at: () => { const t = trk('drone'); return t && t.assigned ? '#b-fire' : '#b-assign'; },
      text: () => { const t = trk('drone'); return t && t.assigned
        ? `Small and close: the battery picked <b>${lname(t.assigned)}</b>. Anything inside 4 km gets the GUN. <b>Hold FIRE.</b>`
        : 'Tap <b>ASSIGN</b>, then hold <b>FIRE</b>.'; } },
    { id: 'd_kill', wait: () => over('drone'), watch: true, at: trackAt('drone'), text: () => 'Watch it go...' },
    { id: 'roe', next: true, at: () => '#roepill',
      text: () => (F.killed.drone ? '<b>Got it!</b> ' : '') + 'The <b>ROE</b> tag on the scope is your order: TIGHT = only HOSTILE tracks, ' +
        'HOLD = no firing, FREE = anything not marked FRIEND. HQ may change it.' },
    { id: 'salvo', next: true, at: () => '#b-doc',
      text: () => '<b>1× SHOT</b> fires one missile per press. Tap it for <b>2× SALVO</b>: two missiles, surer, but it uses more ammo. ' +
        'In training every shot hits; on a real watch shots can miss and jets can dodge.' },
    { id: 'more', next: true, at: () => '#m-pause',
      text: () => 'If enemy missiles damage the radar, a <b>REPAIR</b> button appears on the scope. <b>II</b> pauses the game.' },
    { id: 'finish', next: true, final: true, at: () => null,
      text: () => '<b>Training complete.</b> You are ready for your first watch. Good hunting!' }
  ];
  const IX = id => STEPS.findIndex(s => s.id === id);
  const FIRST_ACTION = IX('f_sel');

  /** Screen position of the newest missile flying at role r (mirrors ui.js scope geometry), else the target track. */
  function missileAt(r) {
    const ms = (S().missiles || []).filter(m => m.targetId === F.ids[r]), sc = $('scope');
    if (!ms.length || !sc) return F.ids[r] ? { track: F.ids[r] } : '#scope';
    const m = ms[ms.length - 1];
    // V1.4: the scope is projected onto the cabin's radar monitor → ask ui.js (it maps through RS.cabin)
    if (RS.ui && RS.ui.debugMissileScreenPos) { const p = RS.ui.debugMissileScreenPos(m.id); if (p) return { x: p.x, y: p.y }; }
    const b = sc.getBoundingClientRect(), w = sc.clientWidth, h = sc.clientHeight;
    const R = Math.max(20, Math.min(w, h - TOP_PAD) / 2 - 10), km = (RS.ui && RS.ui.zoomKm) || 100;
    const x = w / 2 + m.x / km * R, y = (h + TOP_PAD) / 2 - m.y / km * R;
    return { x: b.left + Math.max(8, Math.min(w - 8, x)), y: b.top + Math.max(8, Math.min(h - 8, y)) };
  }

  /* ---------- DOM ---------- */
  function build() {
    if (built) return;
    built = true;
    const st = document.createElement('style'); st.id = 'tut-style'; st.textContent = CSS; document.head.appendChild(st);
    card = document.createElement('div'); card.id = 'tut-card'; card.setAttribute('role', 'dialog'); card.setAttribute('aria-live', 'polite');
    card.innerHTML = '<div class="tk"></div><div class="tt"></div><div class="th"></div><div class="tb">' +
      '<button class="tskip" data-tut="skip">SKIP</button><span class="twait"></span><button class="tnext" data-tut="next">NEXT ▸</button></div>';
    ring = document.createElement('div'); ring.id = 'tut-ring';
    document.body.appendChild(ring); document.body.appendChild(card);
    card.addEventListener('click', ev => {
      const b = ev.target.closest('[data-tut]'); if (!b) return;
      ev.stopPropagation();
      RS.bus.emit('UI_TAP', { what: 'button' });
      if (b.dataset.tut === 'next') onNext();
      else if (b.dataset.tut === 'skip') onSkip();
    });
  }

  function setHold(v) { if (holding !== v) { holding = v; if (RS.main && RS.main.hold) RS.main.hold(v); } }
  function setHint(t) { hint = t || ''; hintStep = idx; }

  function go(i) {
    idx = Math.max(0, Math.min(STEPS.length - 1, i));
    hint = ''; skipArm = 0;
    if (STEPS[idx].id === 'zoom') zoom0 = RS.ui ? RS.ui.zoomKm : 100;
    RS.bus.emit('TUTORIAL', { step: STEPS[idx].id, done: false });
  }

  function onNext() {
    if (oops) { oops = false; restartShift(); return; }
    const st = STEPS[idx];
    if (st.final) { finish(); return; }
    if (isNext(st)) go(idx + 1);
  }
  function onSkip() {
    const now = performance.now();
    if (!skipArm || now - skipArm > 2500) { skipArm = now; lastHtml = ''; return; }   // second tap within 2.5 s skips
    finish();
  }
  const isNext = st => typeof st.next === 'function' ? !!st.next() : !!st.next;

  /** Target → rect {l,t,r,b} in page px, or null. */
  function rectOf(at) {
    if (!at) return null;
    if (typeof at === 'string') {
      const el = document.querySelector(at);
      if (!el || el.hidden) return null;
      const b = el.getBoundingClientRect();
      if (!b.width || !b.height) return null;
      return { l: b.left, t: b.top, r: b.right, b: b.bottom, pt: false };
    }
    let p = at;
    if (at.track) p = RS.ui && RS.ui.debugTrackScreenPos ? RS.ui.debugTrackScreenPos(at.track) : null;
    if (!p) return null;
    return { l: p.x - 22, t: p.y - 22, r: p.x + 22, b: p.y + 22, pt: true };
  }

  /** Card slot: over the 3-D view (above the radar console, which it never covers), else the top of the screen, else just above the launcher strip.
   *  Never overlaps the ring target or the launcher strip / thumb zone. */
  function place(tr, eye) {
    const app = $('app') || document.body, ab = app.getBoundingClientRect(), hb = ($('hatch') || app).getBoundingClientRect();
    const ls = ($('lstrip') || $('thumbzone') || app).getBoundingClientRect();
    const w = Math.min(ab.width - 16, 440), left = ab.left + (ab.width - w) / 2;
    card.style.width = w + 'px'; card.style.left = left + 'px';
    const h = card.offsetHeight, floor = ls.top - 6, pad = 8, pb = $('m-pause'), avoid = tr ? [Object.assign({ k: 100 }, tr)] : [];   // k: weight in the no-fit fallback
    if (pb && pb.offsetParent) { const b = pb.getBoundingClientRect(); avoid.push({ l: b.left, t: b.top, r: b.right, b: b.bottom, k: 100 }); }   // keep II reachable
    const ps = $('p-scope'); let psTop = hb.bottom;              // V1.4: the radar console is on the cabin's lower monitor: keep it clear
    if (ps && ps.style.visibility !== 'hidden') { const b = ps.getBoundingClientRect(); if (b.height) { psTop = b.top; avoid.push({ l: b.left, t: b.top, r: b.right, b: b.bottom }); } }
    if (eye) { const e = $('eo-fr'), b = e && e.getBoundingClientRect(); if (b && b.width && b.height) avoid.push({ l: b.left, t: b.top, r: b.right, b: b.bottom }); }   // V1.4.4: camera steps keep the camera visible
    const hits = t => avoid.some(q => t < q.b + pad && t + h > q.t - pad && left < q.r + pad && left + w > q.l - pad);
    const cands = [psTop - h - 6, Math.max(8, hb.top + 54), floor - h];
    let top = cands.find(t => t >= 0 && t + h <= floor && !hits(t));
    if (top === undefined) {                                     // fits nowhere (small phone): the slot that covers the least
      // the ring target and II weigh 100×: covering part of the scope or the camera beats hiding the control to use or the pause button
      const cover = t => avoid.reduce((a, q) => a + (q.k || 1) * Math.max(0, Math.min(t + h, q.b + pad) - Math.max(t, q.t - pad)) * Math.max(0, Math.min(left + w, q.r + pad) - Math.max(left, q.l - pad)), 0);
      top = cands.map(t => Math.max(0, Math.min(t, floor - h))).reduce((a, t) => cover(t) < cover(a) ? t : a);
    }
    card.style.top = Math.round(top) + 'px';
  }

  function frame() {
    raf = requestAnimationFrame(frame);
    if (!running) return;
    const s = S();
    if (!s.shift.running) return;
    scan();
    let st = STEPS[idx];
    // advance through steps whose goal is already met (copes with out-of-order play)
    for (let n = 0; n < STEPS.length && !oops && !isNext(st) && st.wait && st.wait(); n++) { go(idx + 1); st = STEPS[idx]; }
    if (hintStep !== idx) hint = '';
    let text, at, wait = '', next = false;
    if (oops) { text = oopsText(); at = null; next = true; }
    else {
      next = isNext(st);
      text = st.text(); at = st.at();
      if (!next && !s.radar.on && !s.radar.repair && st.id !== 'zoom') { at = '#b-radar'; wait = 'radar off'; text += '<br><span class="a">The radar is off: tap RADAR to switch it back on.</span>'; }
      else if (!next && st.need && !over(st.need) && !sel(st.need)) {
        const id = F.ids[st.need];
        text = id ? `First select <b>${id}</b> again: tap it in the ring on the scope.` : 'Wait for the contact to show on the scope again.';
        at = id ? { track: id } : '#scope';
      }
      if (!next) wait = wait || (st.watch ? 'watching…' : 'your move ▸');
    }
    setHold(oops || (next && st.hold !== false));
    const nk = STEPS.length, k = Math.min(idx + 1, nk);
    const html = `${oops ? 'TRAINING · OOPS' : 'TRAINING · ' + k + '/' + nk}|${text}|${hint}|${next}|${wait}|${skipArm ? 1 : 0}|${oops}|${!!st.final}`;
    if (html !== lastHtml) {
      lastHtml = html;
      card.children[0].textContent = oops ? 'TRAINING · OOPS' : 'TRAINING · ' + k + ' / ' + nk;
      card.children[1].innerHTML = text;
      card.children[2].textContent = hint; card.children[2].classList.toggle('on', !!hint);
      const tb = card.children[3], nb = tb.querySelector('.tnext'), sb = tb.querySelector('.tskip');
      nb.style.display = next ? '' : 'none';
      nb.textContent = oops ? 'TRY AGAIN ▸' : st.final ? 'FINISH ▸' : 'NEXT ▸';
      tb.querySelector('.twait').textContent = next ? '' : wait;
      sb.textContent = skipArm ? 'SKIP? TAP AGAIN' : 'SKIP';
      sb.classList.toggle('arm', !!skipArm);
      sb.style.visibility = st.final && !oops ? 'hidden' : '';
    }
    if (skipArm && performance.now() - skipArm > 2500) { skipArm = 0; }
    const r = rectOf(at);
    if (r) {
      const g = r.pt ? 0 : 5;
      ring.className = 'on' + (r.pt ? ' pt' : '');
      ring.style.left = (r.l - g) + 'px'; ring.style.top = (r.t - g) + 'px';
      ring.style.width = (r.r - r.l + 2 * g) + 'px'; ring.style.height = (r.b - r.t + 2 * g) + 'px';
    } else ring.className = '';
    card.classList.add('on');
    place(r, !oops && !!st.eye);
  }
  const oopsText = () => '<b>Oops, that was a friendly aircraft.</b> In a real watch that ends your shift. ' +
    'Always check IFF and the radio before you call HOSTILE. Let\'s try that again.';

  /* ---------- bus ---------- */
  const roleOfId = id => {
    if (id && F.shot[id]) return F.shot[id];                 // V1.4.4: a track we shot at (it may have faded since: radar off)
    for (const r in F.ids) if (F.ids[r] === id) return r;
    const k = id && truth(id); return k ? role({ id, x: 0, y: 0 }) : null;
  };
  function bindBus() {
    const on = RS.bus.on;
    const shotAt = p => { if (!running) return; const r = roleOfId(p.targetId); if (r) { F.shot[p.targetId] = r; F.launched[r] = true; F.missed[r] = false; } };
    on('LAUNCH', shotAt);
    on('GUN_FIRE', shotAt);
    on('KILL', p => {
      if (!running) return;
      const r = roleOfId(p.trackId || p.targetId); if (!r) return;
      const c = cam(r); F.camFar[r] = !!(c && c.s === 'far');   // for the splash text: did the camera see it go down?
      F.killed[r] = true;
    });
    on('TRACK_LOST', p => {
      if (!running || (p.reason !== 'exited' && p.reason !== 'landed')) return;
      const r = roleOfId(p.id); if (r && !F.killed[r]) F.gone[r] = true;
    });
    on('MISS', p => {
      if (!running) return;
      const r = roleOfId(p.targetId); if (!r) return;
      F.missed[r] = true;
      setTimeout(() => {                                   // after this tick: any other round still flying at it?
        if (!running || over(r) || inFlight(r)) return;
        const back = r === 'jet' ? IX('fire') : r === 'drone' ? IX('d_fire') : -1;
        if (back >= 0 && idx > back && idx <= back + (r === 'jet' ? 2 : 1)) {
          F.launched[r] = false; go(back);
          setHint('Missed! Hold FIRE again.');                 // (training shots always hit: a safety net)
        }
      }, 0);
    });
    on('IFF_RESULT', p => {
      if (!running) return;
      const r = roleOfId(p.id);
      if (r === 'friend' && p.result !== 'FRIEND' && STEPS[idx].id === 'f_iff') setHint('No answer this time (it happens). Tap IFF again.');
    });
    on('CLASSIFIED', p => {
      if (!running) return;
      const r = roleOfId(p.id);
      if (r === 'friend' && p.cls === 'HOSTILE') setHint('Careful! It answered FRIEND on IFF. Tap FRIEND.');
      else if (r !== 'friend' && p.cls === 'FRIEND') setHint('Hmm, no friendly flies there. Look again.');
    });
    on('FIRE_REJECTED', p => {
      if (!running) return;
      const m = { roe_tight_not_hostile: 'Tap HOSTILE first: ROE TIGHT only allows HOSTILE tracks.', out_of_range: 'That launcher can\'t reach it (too far or too high). Wait, or tap another chip.',
        radar_off: 'Turn RADAR on: missiles need it.', not_ready: 'That launcher is reloading. Tap another green chip.', no_rounds: 'That launcher is empty. Tap another chip.' }[p.reason];
      if (m) setHint(m);
    });
    on('FRATRICIDE', () => { if (!running) return; oops = true; hint = ''; setHold(true); lastHtml = ''; });
    on('SHIFT_START', p => {
      if (!running || starting) return;
      if (p.def && p.def.tutorial) { resetFlags(); oops = false; holding = false; go(FIRST_ACTION); }   // pause-menu RESTART
      else cleanup();                                    // some other shift took over
    });
    on('SHIFT_END', p => {
      if (!running || p.reason === 'restart') return;
      cleanup();
      if (p.reason !== 'quit' && RS.meta && RS.meta.show) RS.meta.show('menu');   // e.g. time ran out: back to the menu
    });
  }

  /* ---------- lifecycle ---------- */
  function startShiftDef() {
    starting = true;
    try { if (RS.meta && RS.meta.startShift) RS.meta.startShift(def); else RS.sim.startShift(def); } finally { starting = false; }
  }
  function restartShift() {
    resetFlags();
    if (S().shift.running) RS.sim.endShift('restart');
    holding = false;
    startShiftDef();
    go(FIRST_ACTION);
  }
  function start() {
    if (!RS.sim || !RS.bus) return false;
    build();
    if (running) cleanup();
    def = makeDef(); resetFlags(); oops = false; holding = false; lastHtml = '';
    running = true; idx = 0;
    if (RS.main && RS.main.paused && RS.main.resume) RS.main.resume();
    startShiftDef();
    go(0);
    cancelAnimationFrame(raf); raf = requestAnimationFrame(frame);
    return true;
  }
  function cleanup() {
    if (!running) return;
    running = false; oops = false;
    cancelAnimationFrame(raf); raf = 0;
    if (card) card.classList.remove('on');
    if (ring) ring.className = '';
    setHold(false);
    if (RS.main && RS.main.hold) RS.main.hold(false);
    RS.bus.emit('TUTORIAL', { step: STEPS[idx].id, done: isDone() });
  }
  /** Leave the tutorial (e.g. pause menu QUIT). Ends the training shift if it is still running; does not mark it done. */
  function stop() {
    if (!running) return false;
    const ours = S().shift.running && S().shift.id === 'TRAIN';
    cleanup();
    if (ours) RS.sim.endShift('quit');
    return true;
  }
  /** Training complete or skipped: mark done, end the shift, back to the main menu. */
  function finish() {
    try { if (RS.save) RS.save('tutorial', { done: true }); } catch (e) { /* storage blocked */ }
    memDone = true;
    stop();
    if (RS.main && RS.main.paused && RS.main.resume) RS.main.resume();
    if (RS.meta && RS.meta.show) RS.meta.show('menu');
  }
  let memDone = false;
  function isDone() {
    if (memDone) return true;
    try { const v = RS.load ? RS.load('tutorial', null) : null; return !!(v && v.done); } catch (e) { return false; }
  }

  bindBus();
  RS.tutorial = {
    start, stop,
    get running() { return running; },
    get done() { return isDone(); },
    /** Test/debug view: current step, cached role → track ids, flags. */
    debug() { return { running, step: STEPS[idx].id, idx, steps: STEPS.map(s => s.id), held: holding, oops, hint, ids: Object.assign({}, F.ids),
      launched: Object.assign({}, F.launched), killed: Object.assign({}, F.killed), gone: Object.assign({}, F.gone), done: isDone() }; },
    makeDef
  };
})();
