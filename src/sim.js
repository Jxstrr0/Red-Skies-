/* =====================================================================
   RED SKIES — sim.js   RS.sim : air picture, radar, tracks, IFF, weapons.
   Pure JS: no DOM, no THREE. Loads in node when window is stubbed.
   Run B: IFF, classify, assign/lock, fire (SAM + gun), reload/reserve,
   ARMs, jamming, strikes, popups, swarms, ROE changes, comms/ack,
   random events, fratricide, placeholder grade. Seeded (RS.sim.init({seed})).
   ===================================================================== */
(function () {
  const G = (typeof window !== 'undefined') ? window : globalThis;
  const RS = G.RS;
  const K = RS.KIND, WP = RS.WEAPON, CLS = RS.CLS, IFF = RS.IFF, ROE = RS.ROE, RE = RS.RANDOM_EVENT, D2R = Math.PI / 180;

  const RADAR_H = 12;            // antenna height m
  const TRACK_LOST_S = 20;       // unseen → faded
  const WARN_AFTER = 90, WARN_EVERY = 10;
  const DEFENDED_KM = 3;         // hostile inside this = leaker
  const EXIT_KM = 115, EGRESS_KM = 40, PUSH_KM = 95;   // PUSH_KM: raids start out near the edge of the 100 km radar   // egressing hostiles leave the picture at EGRESS_KM
  // [RS] realistic flight: the round is thrown ~20 m up (cold launch), the motor lights at `ign`, it climbs near-vertically and
  // pitches over while boosting at `acc` m/s² for `burn` s (peak = acc·burn), then coasts, losing speed to drag (dv/dt = -k·v²).
  // Lance (48N6 class): peak ~1840 m/s at 12.5 s, ~45 s to 60 km.  Dart (9M96/Buk class): peak ~1250 m/s at 5.8 s, ~27 s to 25 km.
  // `tmax` = guidance/battery life; a round still flying after that self-destructs (a miss).
  const KIN = { lance: { ign: 1.0, acc: 160, burn: 11.5, k: 7.4e-6, pitch: 2.6, tmax: 75 },
                dart:  { ign: 1.0, acc: 260, burn: 4.8,  k: 1.6e-5, pitch: 1.8, tmax: 40 } };
  const TH_V0 = 40, TH_DEC = 42;                              // catapult throw (matches models_launchers V0/DEC)
  const throwH = t => { const ta = TH_V0 / TH_DEC, tc = Math.min(t, ta); return Math.max(0, TH_V0 * tc - 0.5 * TH_DEC * tc * tc - (t > ta ? 4.9 * (t - ta) * (t - ta) : 0)); };
  // time to cover d metres from state (te = s since ignition, v = current m/s), straight-line estimate
  const remTime = (K, te, v, d) => {
    if (te < 0) return -te + remTime(K, 0, 0, d);
    if (te < K.burn) {
      const tb = K.burn - te, db = v * tb + 0.5 * K.acc * tb * tb;
      if (d <= db) return (Math.sqrt(v * v + 2 * K.acc * d) - v) / K.acc;
      return tb + remTime(K, K.burn, v + K.acc * tb, d - db);
    }
    return (Math.exp(K.k * d) - 1) / (K.k * Math.max(v, 1));   // coasting under v² drag
  };
  const flyTime = (key, w, rm) => KIN[key] ? remTime(KIN[key], -KIN[key].ign, 0, rm) : rm / w.spd;
  const IFF_DELAY = 1.5, TERMINAL_KM = 5, HIT_KM = 0.2, SALVO_GAP = { lance: 2.0, dart: 1.5 };   // s between salvo rounds (ref clip: cold-launch pair ~2 s apart)
  const GUN_S = 1.5, GUN_DELAY = 0.6;
  const ARM_EMIT_S = 90, ARM_KM = 45, ARM_SPD = 700, ARM_BLIND_P = 0.2, JAM_KM = 80, STRIKE_KM = 6;
  const FRAT_END_S = 4, RADAR_DOWN_S = 30, BURN_S = 3;
  const HOSTILE = { [K.JET_HOSTILE]: 1, [K.HELO_HOSTILE]: 1, [K.CRUISE]: 1, [K.DRONE]: 1, [K.ARM]: 1 };
  const DEF_WEAPONS = {
    lance:  { label: 'Lance',  kind: 'sam', minKm: 3, maxKm: 60, maxAlt: 20000, spd: 1840, pkBase: 0.80, reloadS: 50, perLauncher: 4 },
    dart:   { label: 'Dart',   kind: 'sam', minKm: 1, maxKm: 25,  maxAlt: 10000, spd: 1250, pkBase: 0.80, reloadS: 15, perLauncher: 4 },
    harrow: { label: 'Harrow', kind: 'gun', minKm: 0, maxKm: 4, maxAlt: 4000, roundsPerBurst: 40, pkPerBurst: 0.6, reloadS: 30, perLauncher: 600 }
  };
  const DEF_RESERVE = { lance: 8, dart: 8, harrow: 1200 };
  const PKM = (lance, dart, harrow) => ({ lance, dart, harrow });
  const DEF_PKMOD = {
    [K.DRONE]: PKM(0.6, 0.9, 1.3), [K.CRUISE]: PKM(0.8, 0.9, 1.0), [K.HELO_HOSTILE]: PKM(0.7, 1, 1.0), [K.JET_HOSTILE]: PKM(1, 1, 0.3),
    [K.ARM]: PKM(0.5, 0.8, 0.9), [K.JET_FRIEND]: PKM(1, 1, 0.3), [K.STRIKE_FRIEND]: PKM(1, 1, 0.3), [K.TRANSPORT]: PKM(1, 1, 0.5),
    [K.HELO_FRIEND]: PKM(0.7, 1, 0.8)
  };
  const LPOS = { L1: [-0.1, 0.06], L2: [0.1, 0.06], L3: [0, -0.1], G1: [0.06, -0.06] };   // km from battery origin
  const COST = { harrow: 0, dart: 1, lance: 2 };
  const PK_MARGIN = 0.12;        // bestLauncher: a costlier weapon must beat a cheaper one's Pk by this much (saves Lances for what needs them)

  let content = null, def = null, baseSeed = null, rand = Math.random;
  let spawnList = [], commsList = [], roeList = [], evList = [], ents = [], trackEnt = {}, mpriv = {};
  let spawnIdx = 0, commsIdx = 0, roeIdx = 0, evIdx = 0, nextEnt = 1, nextTrack = 1, nextMissile = 1, nextComms = 1, warnNext = WARN_AFTER;
  let pendLaunch = [], pendIff = [], pendGun = [], debris = [], alarms = {}, lockOn = {}, activeEv = {};
  let radarDownUntil = 0, jamSent = 0, endAt = 0, endReason = '', gunUntil = 0, leakerUntil = 0, assetUntil = 0;

  function resetPrivate() {
    ents = []; trackEnt = {}; mpriv = {}; spawnIdx = commsIdx = roeIdx = evIdx = 0;
    nextEnt = nextTrack = nextMissile = nextComms = 1; warnNext = WARN_AFTER;
    pendLaunch = []; pendIff = []; pendGun = []; debris = []; alarms = {}; lockOn = {}; activeEv = {};
    radarDownUntil = 0; jamSent = 0; endAt = 0; endReason = ''; gunUntil = 0; leakerUntil = 0; assetUntil = 0;
  }

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  const weap = n => Object.assign({}, DEF_WEAPONS[n], content && content.weapons && content.weapons[n]);
  function pkMod(kind, w) {
    const t = content && content.threats && content.threats[kind], m = t && t.pkMod;
    if (m && typeof m[w] === 'number') return m[w];
    return DEF_PKMOD[kind] ? DEF_PKMOD[kind][w] : 1;
  }

  function freshState() {
    const L = (id, weapon) => {
      const n = weap(weapon).perLauncher;
      return { id, weapon, rounds: n, max: n, ready: true, reloadT: 0, jammed: false, assignedTrack: null, reloadTotal: 0 };
    };
    return {
      t: 0,
      shift: { id: '', name: '', duration: 0, elapsed: 0, running: false, roe: ROE.TIGHT, failed: false },
      radar: { on: false, rangeKm: 100, sweepDeg: 0, rpm: 12, emitTime: 0, jam: 0, jamBearing: 0, health: 1, armEta: null },
      tracks: [], selectedId: null,
      battery: {
        launchers: [L('L1', WP.LANCE), L('L2', WP.LANCE), L('L3', WP.DART), L('G1', WP.HARROW)],
        doctrine: RS.DOCTRINE.SLS, assignedTo: {},
        reserve: Object.assign({}, DEF_RESERVE, content && content.reserve, def && def.reserve)
      },
      missiles: [], gun: { firing: false, bearingDeg: 0, elevDeg: 0, targetId: null },
      asset: { hp: 1 },
      stats: { kills: 0, misses: 0, leakers: 0, fired: { lance: 0, dart: 0, harrow: 0 }, reactionTimes: [], fratricide: false },
      comms: [], visible: []
    };
  }

  const sim = { state: freshState() };
  const emit = (n, p) => RS.bus.emit(n, p);
  const wrap360 = a => ((a % 360) + 360) % 360;
  const angDiff = (a, b) => ((b - a + 540) % 360) - 180;      // signed shortest a→b
  const clamp01 = v => Math.max(0, Math.min(1, v));
  const rnd = (v, d) => { const f = Math.pow(10, d); return Math.round(v * f) / f; };
  const bearingOf = (x, y) => wrap360(Math.atan2(x, y) / D2R);
  const findTrack = id => sim.state.tracks.find(k => k.id === id) || null;
  const launcher = id => sim.state.battery.launchers.find(l => l.id === id) || null;
  const trackOf = e => (e.trackId && findTrack(e.trackId)) || null;

  function alarm(kind, on) {
    if (!!alarms[kind] === on) return;
    alarms[kind] = on;
    emit('ALARM', { kind, on });
  }

  function pushComms(from, text, priority, needsAck) {
    const s = sim.state;
    const c = { id: nextComms++, t: rnd(s.t, 1), from, text, priority: priority || 'normal', needsAck: !!needsAck, acked: false };
    s.comms.push(c);
    if (s.comms.length > 40) s.comms.shift();
    emit('COMMS', { from: c.from, text: c.text, priority: c.priority, id: c.id, needsAck: c.needsAck });
  }

  /* ---------- entities ---------- */
  function spawn(s) {
    const n = s.count > 1 ? Math.floor(s.count) : 1;
    let e = null;
    for (let i = 0; i < n; i++) {
      const sp = n > 1 ? (s.spread || 1) : 0;
      e = {
        id: 'E' + (nextEnt++), kind: s.kind, x: s.x + (sp ? (rand() - 0.5) * 2 * sp : 0), y: s.y + (sp ? (rand() - 0.5) * 2 * sp : 0),
        alt: s.alt, hdg: s.hdg, spd: s.spd, corridor: s.corridor ? s.corridor.map(p => p.slice()) : null, wp: 0,
        orbit: null, paints: 0, lastPaint: -1e9, trackId: null, trackT: null, leaked: false, dead: false,
        rcs: (content.threats[s.kind] || {}).rcs || 0.3, baseAlt: s.alt, popup: s.popup || null,
        iffBroken: !!s.iffBroken, jammer: !!s.jammer, armCarrier: !!s.armCarrier, strike: !!s.strike,
        released: false, egress: false, armFired: false, shotAt: false, prevR: 1e9
      };
      if (e.popup) e.alt = Math.min(e.alt, e.popup.hideAlt * 0.8);
      if (!HOSTILE[s.kind] && !e.corridor && (s.orbit || s.kind === K.JET_FRIEND)) {
        const o = s.orbit || { cx: s.x, cy: s.y, r: 8 };
        e.orbit = { cx: o.cx, cy: o.cy, r: o.r || 8, dir: 1 };
      }
      ents.push(e);
    }
    return e;
  }

  function removeEnt(e, reason) {
    const i = ents.indexOf(e);
    if (i >= 0) ents.splice(i, 1);
    e.dead = true;
    const tr = trackOf(e);
    if (tr) loseTrack(tr, reason);
  }

  function steerTo(e, tx, ty, rate, dt) {
    const d = angDiff(e.hdg, bearingOf(tx - e.x, ty - e.y)), m = rate * dt;
    e.hdg = wrap360(e.hdg + Math.max(-m, Math.min(m, d)));
  }

  function assetHit(e, dmg) {
    const s = sim.state;
    s.asset.hp = Math.max(0, rnd(s.asset.hp - dmg, 3));
    emit('ASSET_HIT', { byId: e.trackId || e.id, damage: rnd(dmg, 2) });
    assetUntil = s.t + 5;
    if (s.asset.hp <= 0 && !endAt) { s.shift.failed = true; endAt = s.t + FRAT_END_S; endReason = 'asset_destroyed'; }
  }

  function armArrive(e) {
    const R = sim.state.radar;
    if (!(R.on || rand() < ARM_BLIND_P)) return;
    const dmg = 0.35 + rand() * 0.25;
    R.health = Math.max(0.1, rnd(R.health - dmg, 3));      // floor: degraded, never destroyed
    emit('ARM_IMPACT', { damage: rnd(dmg, 2) });
    if (R.health < 0.3) forceRadarOff(RADAR_DOWN_S);
  }

  function moveEnt(e, dt) {
    const s = sim.state, hostile = HOSTILE[e.kind];
    const turn = e.kind === K.CRUISE ? 2 : e.kind === K.DRONE ? 4 : e.kind === K.ARM ? 30 : 3;
    let r = Math.hypot(e.x, e.y);
    if (e.kind === K.ARM) {
      if (s.radar.on) steerTo(e, 0, 0, turn, dt);            // homes on emissions; blind → holds last bearing
      e.alt = Math.min(e.alt, 30 + r * 150);
    } else if (e.corridor) {
      const p = e.corridor[e.wp];
      steerTo(e, p[0], p[1], turn, dt);
      const dist = Math.hypot(p[0] - e.x, p[1] - e.y);
      if (e.wp === e.corridor.length - 1) { const glide = dist * 1000 * 0.06; if (e.alt > glide) e.alt = Math.max(glide, e.alt - 20 * dt); }
      if (dist < 1.2) { e.wp++; if (e.wp >= e.corridor.length) return 'landed'; }
    } else if (e.orbit) {
      const o = e.orbit, dx = e.x - o.cx, dy = e.y - o.cy, ro = Math.hypot(dx, dy) || 1e-3;
      const tang = wrap360(Math.atan2(dy, -dx) / D2R);          // clockwise tangent
      const corr = Math.max(-40, Math.min(40, (ro - o.r) * 8));  // pull toward circle
      e.hdg = wrap360(e.hdg + Math.max(-turn * dt, Math.min(turn * dt, angDiff(e.hdg, tang + corr))));
    } else if (hostile) {
      if (e.egress) steerTo(e, e.x * 10, e.y * 10, 8, dt);      // turn outbound and leave
      else if (r > DEFENDED_KM && !e.leaked) steerTo(e, 0, 0, e.kind === K.DRONE ? 4 : 2, dt);
      if (e.kind === K.DRONE) e.hdg = wrap360(e.hdg + Math.sin(s.t * 0.3 + e.x) * 4 * dt);
    }
    if (e.popup && r <= e.popup.atKm) e.alt = Math.min(e.baseAlt, e.alt + 15 * dt);
    const v = e.spd / 1000 * dt;
    e.x += Math.sin(e.hdg * D2R) * v;
    e.y += Math.cos(e.hdg * D2R) * v;
    r = Math.hypot(e.x, e.y);
    if (e.kind === K.ARM) {
      if (r < 0.3 || (r < 3 && r > e.prevR)) { armArrive(e); return 'exited'; }
      e.prevR = r;
      return r > EXIT_KM ? 'exited' : null;
    }
    if (hostile && e.strike && !e.released && r < STRIKE_KM) {
      e.released = true; e.egress = true;
      assetHit(e, 0.15 + rand() * 0.15);
    }
    if (hostile && !e.leaked && !e.released && r < DEFENDED_KM) {
      e.leaked = true; s.stats.leakers++; leakerUntil = s.t + 5;
      emit('LEAKER', { id: e.trackId || e.id });
    }
    if ((e.kind === K.CRUISE || e.kind === K.DRONE) && r < 0.5) { assetHit(e, e.kind === K.CRUISE ? 0.25 : 0.08); return 'exited'; }
    if (r > EXIT_KM || ((e.egress || e.leaked) && r > EGRESS_KM)) return 'exited';
    return null;
  }

  function launchArm(c) {
    c.armFired = true;
    const a = spawn({ kind: K.ARM, x: c.x, y: c.y, alt: Math.min(c.alt, 3000), hdg: bearingOf(-c.x, -c.y), spd: ARM_SPD });
    emit('ARM_INBOUND', { id: a.id, eta: rnd(Math.hypot(a.x, a.y) * 1000 / ARM_SPD, 1) });
    alarm('arm', true);
  }

  /* ---------- radar ---------- */
  function pd(e, r) {
    const radar = sim.state.radar;
    const horizon = 4.12 * (Math.sqrt(RADAR_H) + Math.sqrt(Math.max(0, e.alt)));
    if (r > horizon) return 0;
    const eff = radar.rangeKm * Math.pow(Math.max(0.01, e.rcs), 0.25) * radar.health;
    const x = r / eff;
    if (x >= 1) return 0;
    let p = 0.95 * (1 - x * x * x * x);
    if (r > horizon * 0.85) p *= 0.5;                // clutter near the horizon
    return p * (1 - 0.7 * radar.jam);
  }

  function paint(e) {
    const s = sim.state, t = s.t;
    const tr0 = trackOf(e);
    if (tr0) { updateTrack(tr0, e); return; }
    e.trackId = null;
    if (t - e.lastPaint > 12) e.paints = 0;
    e.paints++; e.lastPaint = t;
    if (e.paints >= 2) {
      const tr = {
        id: 'T' + String(nextTrack++).padStart(2, '0'), x: 0, y: 0, alt: 0, hdg: 0, spd: 0, rangeKm: 0, bearingDeg: 0,
        closure: 0, quality: 0.4, firstSeen: t, lastSeen: t, iff: IFF.NONE, cls: CLS.UNKNOWN, priority: 0,
        assigned: null, strobe: false, engagedBy: []
      };
      trackEnt[tr.id] = e;
      e.trackId = tr.id;
      if (e.trackT === null) e.trackT = t;
      updateTrack(tr, e);
      s.tracks.push(tr);
      s.tracks.sort((a, b) => (a.id < b.id ? -1 : 1));
      emit('TRACK_NEW', { id: tr.id, track: snapshot(tr) });
    }
  }

  const onJamBearing = brg => sim.state.radar.jam > 0.15 && Math.abs(angDiff(brg, sim.state.radar.jamBearing)) < 8;

  function updateTrack(tr, e) {
    const R = sim.state.radar;
    let n = (1 - tr.quality) * 0.3 + R.jam * 0.6;                // measurement noise: quality + jamming
    if (onJamBearing(bearingOf(e.x, e.y))) n += R.jam * 3;       // strobe: position unreliable
    tr.x = e.x + (rand() - 0.5) * n; tr.y = e.y + (rand() - 0.5) * n;
    tr.alt = Math.round(e.alt / 50) * 50; tr.hdg = Math.round(e.hdg); tr.spd = Math.round(e.spd);
    tr.lastSeen = sim.state.t; tr.quality = Math.min(1, tr.quality + 0.3);
    derive(tr);
  }

  function derive(tr) {
    const s = sim.state, r = Math.hypot(tr.x, tr.y) || 1e-3;
    tr.rangeKm = +r.toFixed(2);
    tr.bearingDeg = Math.round(bearingOf(tr.x, tr.y));
    const vx = Math.sin(tr.hdg * D2R) * tr.spd, vy = Math.cos(tr.hdg * D2R) * tr.spd;
    tr.closure = Math.round(-(tr.x * vx + tr.y * vy) / r);
    const prox = Math.max(0, 1 - r / 60), close = clamp01(tr.closure / 300), low = tr.alt < 500 ? 0.15 : 0;
    let p = 100 * (0.4 * prox + 0.35 * close + low);
    if (tr.cls === CLS.HOSTILE) p += 25; else if (tr.cls === CLS.FRIEND) p *= 0.05;
    tr.priority = Math.round(Math.max(0, Math.min(100, p)));
    tr.assigned = s.battery.assignedTo[tr.id] || null;
    tr.strobe = onJamBearing(tr.bearingDeg);
    tr.engagedBy = s.missiles.filter(m => m.targetId === tr.id).map(m => m.id);
  }

  function snapshot(tr) {
    const o = {};
    for (const k in tr) o[k] = Array.isArray(tr[k]) ? tr[k].slice() : tr[k];
    return o;
  }

  function loseTrack(tr, reason) {
    const s = sim.state;
    s.tracks.splice(s.tracks.indexOf(tr), 1);
    if (trackEnt[tr.id]) trackEnt[tr.id].trackId = null;
    delete trackEnt[tr.id];
    unassign(tr.id);
    emit('TRACK_LOST', { id: tr.id, reason });
    if (s.selectedId === tr.id) { s.selectedId = null; emit('TRACK_SELECTED', { id: null }); }
  }

  function forceRadarOff(seconds) {
    const R = sim.state.radar;
    radarDownUntil = Math.max(radarDownUntil, sim.state.t + seconds);
    alarm('radar', true);
    if (R.on) { R.on = false; R.emitTime = 0; warnNext = WARN_AFTER; emit('RADAR_STATE', { on: false }); }
  }

  /* ---------- fire control ---------- */
  function setLock(lid, id, on) {
    const cur = lockOn[lid] || null;
    if (on) {
      if (cur === id) return;
      if (cur) emit('LOCK', { id: cur, launcherId: lid, on: false });
      lockOn[lid] = id;
      emit('LOCK', { id, launcherId: lid, on: true });
    } else if (cur && (id === null || cur === id)) {
      lockOn[lid] = null;
      emit('LOCK', { id: cur, launcherId: lid, on: false });
    }
  }

  function unassign(trackId) {
    const b = sim.state.battery, lid = b.assignedTo[trackId];
    if (!lid) return;
    delete b.assignedTo[trackId];
    const L = launcher(lid);
    if (L && L.assignedTrack === trackId) L.assignedTrack = null;
    setLock(lid, trackId, false);
    const tr = findTrack(trackId);
    if (tr) tr.assigned = null;
  }

  function roeReason(tr) {
    const roe = sim.state.shift.roe;
    if (roe === ROE.HOLD) return 'roe_hold';
    if (tr.cls === CLS.FRIEND) return 'classified_friend';
    if (roe === ROE.TIGHT && tr.cls !== CLS.HOSTILE) return 'roe_tight_not_hostile';
    return null;
  }

  // Fire-control solution for a track/launcher pair (ROE not considered).
  function solution(tr, L) {
    const out = (ok, reason, pk, tti, inRange) => ({ ok, reason, pk, tti, inRange });
    if (!tr) return out(false, 'no_track', 0, 0, false);
    if (!L) return out(false, 'not_assigned', 0, 0, false);
    const s = sim.state, w = weap(L.weapon), gun = L.weapon === WP.HARROW, e = trackEnt[tr.id];
    const r = tr.rangeKm, inRange = r >= w.minKm && r <= w.maxKm && tr.alt <= w.maxAlt;
    const u = (r - w.minKm) / (w.maxKm - w.minKm);
    // missiles lose Pk at both envelope edges; a gun is best close in and fades with range (last-ditch CIWS)
    const edge = !inRange ? 0 : gun ? 1 - 0.4 * u * u : Math.min(1, 0.5 + 0.5 * Math.min(u, 1 - u) / 0.15);
    const pk = clamp01((gun ? w.pkPerBurst : w.pkBase) * pkMod(e ? e.kind : null, L.weapon) *
      (1 - (gun ? 0.2 : 0.5) * s.radar.jam) * (0.6 + 0.4 * tr.quality) * edge);
    const tti = gun ? GUN_DELAY : rnd(flyTime(L.weapon, w, r * 1000), 1);
    let reason = null;
    if (L.jammed) reason = 'jammed';
    else if (!L.ready) reason = 'not_ready';
    else if (L.rounds <= 0) reason = 'no_rounds';
    else if (!gun && !s.radar.on) reason = 'radar_off';
    else if (r < w.minKm) reason = 'too_close';
    else if (!inRange) reason = 'out_of_range';
    return out(!reason, reason, rnd(pk, 3), tti, inRange);
  }

  function launchMissile(L, trackId, e, pk) {
    const s = sim.state, w = weap(L.weapon), p = LPOS[L.id];
    L.rounds--; s.stats.fired[L.weapon]++;
    const m = {
      id: 'M' + (nextMissile++), weapon: L.weapon, x: p[0], y: p[1], alt: 5, targetId: trackId, launcherId: L.id, flightT: 0,
      hdg: Math.round(bearingOf(e.x - p[0], e.y - p[1])), spd: 0, phase: 'boost',
      tti: rnd(flyTime(L.weapon, w, Math.hypot(e.x - p[0], e.y - p[1]) * 1000), 1)
    };
    s.missiles.push(m);
    mpriv[m.id] = { ent: e, pk, degraded: false, v: 0, bo: false };
    emit('LAUNCH', { missileId: m.id, weapon: m.weapon, launcherId: L.id, targetId: trackId, x: p[0], y: p[1], alt: 0 });
    if (L.rounds <= 0) startReload(L);
  }

  function fireGun(L, tr, e, salvo, pk) {
    const s = sim.state, w = weap(WP.HARROW), full = w.roundsPerBurst * (salvo ? 2 : 1), n = Math.min(L.rounds, full);
    const p1 = pk * n / full * (salvo ? 2 : 1);
    const pkEff = salvo ? 1 - Math.pow(1 - Math.min(1, p1 / 2), 2) : p1;
    L.rounds -= n; s.stats.fired.harrow += n;
    const brg = tr.bearingDeg, elev = rnd(Math.atan2(tr.alt, tr.rangeKm * 1000) / D2R, 1);
    s.gun = { firing: true, bearingDeg: brg, elevDeg: elev, targetId: tr.id };
    L.ready = false; gunUntil = s.t + GUN_S * (salvo ? 2 : 1);
    pendGun.push({ at: s.t + GUN_DELAY, e, trackId: tr.id, pk: pkEff });
    emit('GUN_FIRE', { launcherId: L.id, targetId: tr.id, burst: true, bearingDeg: brg, elevDeg: elev, rounds: n });
    if (L.rounds <= 0) startReload(L);
  }

  function kill(e, weapon, targetId) {
    const s = sim.state, friend = !HOSTILE[e.kind], trackId = e.trackId || null, tid = trackId || targetId || e.id;
    if (!friend) s.stats.kills++;
    emit('KILL', { targetId: tid, weapon, wasFriend: friend, x: e.x, y: e.y, alt: e.alt, trackId });
    if (friend) {
      emit('FRATRICIDE', { targetId: tid });
      s.stats.fratricide = true; s.shift.failed = true;
      alarm('fratricide', true);
      if (!endAt || endReason !== 'fratricide') { endAt = s.t + FRAT_END_S; endReason = 'fratricide'; }
    }
    debris.push({ e, until: s.t + BURN_S });
    removeEnt(e, 'killed');
  }

  function miss(missileId, targetId) {
    sim.state.stats.misses++;
    emit('MISS', { missileId, targetId });
  }

  function startReload(L) {
    const res = sim.state.battery.reserve;
    if (L.reloadT > 0 || L.rounds >= L.max || !(res[L.weapon] > 0)) return false;
    const w = weap(L.weapon);
    L.ready = false; L.reloadT = L.reloadTotal = w.reloadS;
    setLock(L.id, null, false);
    emit('RELOAD_START', { launcherId: L.id, seconds: w.reloadS });
    return true;
  }

  function checkAmmo() {
    const b = sim.state.battery;
    let n = b.reserve.lance + b.reserve.dart;
    for (const L of b.launchers) if (L.weapon !== WP.HARROW) n += L.rounds;
    alarm('lowammo', n <= 3);
  }

  function updateMissiles(dt) {
    const s = sim.state, R = s.radar;
    for (let i = s.missiles.length - 1; i >= 0; i--) {
      const m = s.missiles[i], P = mpriv[m.id], e = P.ent, w = weap(m.weapon);
      const done = () => { s.missiles.splice(i, 1); delete mpriv[m.id]; };
      m.flightT += dt;
      if (e.dead) { done(); miss(m.id, m.targetId); continue; }
      const d0 = Math.hypot((e.x - m.x) * 1000, (e.y - m.y) * 1000, e.alt - m.alt);
      const K = KIN[m.weapon] || { ign: 0, acc: 1e9, burn: 1e9, k: 0, pitch: 0, tmax: 1e9 }, te = m.flightT - K.ign;
      if (te <= 0) P.v = 0;
      else if (te < K.burn) P.v = K.acc * te;                                // boost
      else { if (!P.bo) { P.bo = true; P.v = K.acc * K.burn; } P.v -= K.k * P.v * P.v * dt; }   // burnout → coast
      const v = P.v;
      m.spd = Math.round(v);
      m.motor = te > 0 && te < K.burn;
      m.phase = te < K.burn ? 'boost' : d0 < TERMINAL_KM * 1000 ? 'terminal' : 'midcourse';
      if (!R.on && (m.phase === 'midcourse' || (m.phase === 'terminal' && m.weapon !== WP.LANCE))) P.degraded = true;
      const tgo = remTime(K, te, v, d0), ev = e.spd / 1000 * tgo;            // lead pursuit on the true entity
      const dx = (e.x + Math.sin(e.hdg * D2R) * ev - m.x) * 1000, dy = (e.y + Math.cos(e.hdg * D2R) * ev - m.y) * 1000, dz = e.alt - m.alt;
      const dd = Math.hypot(dx, dy, dz) || 1;
      if (te <= 0) {                                         // thrown out of the canister: straight up, motor not lit
        if (P.alt0 === undefined) P.alt0 = m.alt;
        m.alt = P.alt0 + throwH(m.flightT);
      } else {
        // pitch-over: blend the vertical climb into the guidance direction
        const k = K.pitch > 0 ? Math.min(1, te / K.pitch) : 1, kk = k * k * (3 - 2 * k);
        let ux = dx / dd * kk, uy = dy / dd * kk, uz = dz / dd * kk + (1 - kk);
        const un = Math.hypot(ux, uy, uz) || 1, step = Math.min(v * dt, dd);
        m.x += ux / un * step / 1000; m.y += uy / un * step / 1000; m.alt += uz / un * step;
      }
      m.hdg = Math.round(bearingOf(dx, dy));
      const d1 = Math.hypot((e.x - m.x) * 1000, (e.y - m.y) * 1000, e.alt - m.alt);
      m.tti = rnd(remTime(K, te, v, d1), 1);
      if (d1 < HIT_KM * 1000) {
        done();
        emit('INTERCEPT', { missileId: m.id, targetId: m.targetId, x: e.x, y: e.y, alt: e.alt });
        if (rand() < P.pk * (P.degraded ? 0.25 : 1)) kill(e, m.weapon, m.targetId); else miss(m.id, m.targetId);
      } else if (m.flightT > K.tmax) { done(); miss(m.id, m.targetId); }   // out of energy / guidance time
    }
  }

  function updateLocks() {
    const s = sim.state;
    for (const L of s.battery.launchers) {
      const id = L.assignedTrack, tr = id && findTrack(id);
      if (!tr) { setLock(L.id, null, false); continue; }
      const busy = s.missiles.some(m => m.launcherId === L.id && m.targetId === id) || pendLaunch.some(p => p.lid === L.id);
      setLock(L.id, id, !busy && solution(tr, L).ok);
    }
  }

  /* ---------- random events / ROE ---------- */
  function setRoe(roe) {
    sim.state.shift.roe = roe;
    emit('ROE_CHANGE', { roe });
    pushComms('HQ', 'Weapons ' + roe + '.', 'high', false);
  }

  function evLauncher(detail) {
    const id = detail && (typeof detail === 'string' ? detail : detail.launcherId);
    return launcher(id) || launcher('L1');
  }

  function startEvent(ev) {
    const s = sim.state, detail = ev.detail === undefined ? null : ev.detail;
    activeEv[ev.kind] = { until: s.t + (ev.duration || 0), detail };
    emit('RANDOM_EVENT', { kind: ev.kind, active: true, detail });
    if (ev.kind === RE.RADAR_FAULT) forceRadarOff(ev.duration || 20);
    else if (ev.kind === RE.LAUNCHER_JAM) { const L = evLauncher(detail); L.jammed = true; setLock(L.id, null, false); }
    else if (ev.kind === RE.ROE_CHANGE && detail && detail.roe) setRoe(detail.roe);
  }

  function endEvent(kind) {
    const a = activeEv[kind];
    delete activeEv[kind];
    if (kind === RE.LAUNCHER_JAM) evLauncher(a.detail).jammed = false;
    else if (kind === RE.LATE_RESUPPLY && a.detail) {
      const res = sim.state.battery.reserve;
      for (const w of ['lance', 'dart', 'harrow']) if (typeof a.detail[w] === 'number') res[w] += a.detail[w];
    }
    emit('RANDOM_EVENT', { kind, active: false, detail: a.detail });
  }

  function grade() {
    const s = sim.state, st = s.stats;
    if (st.fratricide || s.shift.failed || s.asset.hp <= 0) return 'F';
    const sc = 100 * s.asset.hp - 10 * st.leakers;
    return sc >= 90 ? 'A' : sc >= 75 ? 'B' : sc >= 60 ? 'C' : sc >= 40 ? 'D' : 'F';
  }

  /* ---------- lifecycle ---------- */
  sim.init = function (opts) {
    content = (opts && opts.content) || RS.content;
    baseSeed = opts && typeof opts.seed === 'number' ? opts.seed >>> 0 : null;
    def = null;
    sim.state = freshState();
  };

  // Hostile jets and cruise missiles are authored to appear inside ~65 km. Start them further back along their inbound
  // heading (up to PUSH_KM) and correspondingly earlier, so they arrive exactly as authored but the 100 km radar sees them sooner.
  function pushOut(sp) {
    if (sp.kind !== K.JET_HOSTILE && sp.kind !== K.CRUISE) return sp;
    const r0 = Math.hypot(sp.x, sp.y), v = (sp.spd || 250) / 1000, d = Math.min(PUSH_KM - r0, (sp.t || 0) * v);
    if (!(d > 1)) return sp;
    const h = sp.hdg * D2R;
    return Object.assign({}, sp, { x: +(sp.x - Math.sin(h) * d).toFixed(2), y: +(sp.y - Math.cos(h) * d).toFixed(2), t: Math.max(0, sp.t - d / v) });
  }
  sim.startShift = function (shiftDef) {
    if (!content) sim.init({ content: RS.content });
    def = shiftDef; resetPrivate();
    let h = 2166136261; for (const c of String(def.id)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    if (baseSeed !== null) h ^= Math.imul(baseSeed + 1, 0x9E3779B1);
    rand = mulberry32(h >>> 0); for (let i = 0; i < 8; i++) rand();
    sim.state = freshState();
    const s = sim.state, byT = (a, b) => a.t - b.t;
    s.shift = { id: def.id, name: def.name, duration: def.duration, elapsed: 0, running: true, roe: def.roe || ROE.TIGHT, failed: false };
    spawnList = (def.spawns || []).map(pushOut).sort(byT);
    commsList = (def.comms || []).slice().sort(byT);
    roeList = (def.roeChanges || []).slice().sort(byT);
    evList = (def.events || []).slice().sort(byT);
    emit('SHIFT_START', { def });
    sim.cmd.radar(true);
  };

  sim.step = function () {
    const s = sim.state, dt = RS.SIM_DT, R = s.radar;
    if (!s.shift.running) return;
    s.t += dt; s.shift.elapsed += dt;
    const el = s.shift.elapsed;

    while (spawnIdx < spawnList.length && spawnList[spawnIdx].t <= el) spawn(spawnList[spawnIdx++]);
    while (commsIdx < commsList.length && commsList[commsIdx].t <= el) {
      const c = commsList[commsIdx++];
      pushComms(c.from, c.text, c.priority, c.needsAck);
    }
    while (roeIdx < roeList.length && roeList[roeIdx].t <= el) setRoe(roeList[roeIdx++].roe);
    while (evIdx < evList.length && evList[evIdx].t <= el) startEvent(evList[evIdx++]);
    for (const k in activeEv) if (s.t >= activeEv[k].until) endEvent(k);

    for (let i = ents.length - 1; i >= 0; i--) {
      const e = ents[i], res = moveEnt(e, dt);
      if (res) removeEnt(e, res);
    }
    if (R.on && R.emitTime > ARM_EMIT_S) {
      for (const e of ents.slice()) if (e.armCarrier && !e.armFired && HOSTILE[e.kind] && Math.hypot(e.x, e.y) <= ARM_KM) launchArm(e);
    }

    // weapons
    for (let i = pendLaunch.length - 1; i >= 0; i--) {
      const p = pendLaunch[i];
      if (s.t < p.at) continue;
      pendLaunch.splice(i, 1);
      const L = launcher(p.lid);
      if (L.rounds > 0 && !L.jammed && !p.e.dead) launchMissile(L, p.trackId, p.e, p.pk);
    }
    updateMissiles(dt);
    for (let i = pendGun.length - 1; i >= 0; i--) {
      const g = pendGun[i];
      if (s.t < g.at) continue;
      pendGun.splice(i, 1);
      if (!g.e.dead && rand() < g.pk) kill(g.e, WP.HARROW, g.trackId); else miss(null, g.trackId);
    }
    const G1 = launcher('G1');
    if (s.gun.firing && s.t >= gunUntil) { s.gun.firing = false; s.gun.targetId = null; if (G1.reloadT <= 0) G1.ready = true; }
    for (const L of s.battery.launchers) {
      if (L.reloadT <= 0) continue;
      L.reloadT = Math.max(0, L.reloadT - dt);
      if (L.reloadT > 0) continue;
      const n = Math.min(L.max - L.rounds, s.battery.reserve[L.weapon]);
      L.rounds += n; s.battery.reserve[L.weapon] -= n;
      L.ready = !(L.id === 'G1' && s.gun.firing);
      emit('RELOAD_DONE', { launcherId: L.id });
    }

    // jamming
    let jam = 0, jb = R.jamBearing;
    for (const e of ents) {
      if (!e.jammer || !HOSTILE[e.kind]) continue;
      const j = clamp01((JAM_KM - Math.hypot(e.x, e.y)) / 60);
      if (j > jam) { jam = j; jb = bearingOf(e.x, e.y); }
    }
    R.jam = rnd(jam, 2); R.jamBearing = Math.round(jb);
    if (Math.abs(R.jam - jamSent) >= 0.1 || (R.jam === 0 && jamSent > 0)) { jamSent = R.jam; emit('JAMMING', { level: R.jam, bearing: R.jamBearing }); }

    // radar sweep + paints
    if (radarDownUntil && s.t >= radarDownUntil) { radarDownUntil = 0; alarm('radar', false); if (!R.on) pushComms('BATTERY', 'Radar back up. Transmit when ready.', 'high'); }
    if (R.on && R.health > 0) {
      const prev = R.sweepDeg, delta = R.rpm * 6 * dt;
      R.sweepDeg = wrap360(prev + delta);
      for (const e of ents) {
        const r = Math.hypot(e.x, e.y);
        if (r > R.rangeKm * 1.05) continue;
        const off = wrap360(bearingOf(e.x, e.y) - prev);
        if (off < delta && rand() < pd(e, r)) paint(e);
      }
      R.emitTime += dt;
      if (R.emitTime >= warnNext) { emit('RADAR_WARN', { seconds: Math.round(R.emitTime) }); warnNext += WARN_EVERY; }
    }

    // IFF replies
    for (let i = pendIff.length - 1; i >= 0; i--) {
      const q = pendIff[i];
      if (s.t < q.at) continue;
      pendIff.splice(i, 1);
      const tr = findTrack(q.id), e = trackEnt[q.id];
      if (!tr || !e) continue;
      let result;
      if (HOSTILE[e.kind]) result = rand() < 0.85 ? IFF.NO_RESPONSE : IFF.INVALID;
      else result = (e.iffBroken || activeEv[RE.IFF_FAIL] || rand() >= 0.95) ? IFF.NO_RESPONSE : IFF.FRIEND;
      tr.iff = result;
      emit('IFF_RESULT', { id: q.id, result });
    }

    // track upkeep: dead-reckon, decay, fade
    for (let i = s.tracks.length - 1; i >= 0; i--) {
      const tr = s.tracks[i];
      const v = tr.spd / 1000 * dt;
      tr.x += Math.sin(tr.hdg * D2R) * v; tr.y += Math.cos(tr.hdg * D2R) * v;
      tr.quality = Math.max(0, tr.quality - dt * (R.on ? 0.025 : 0.04));
      derive(tr);
      if (s.t - tr.lastSeen > TRACK_LOST_S) loseTrack(tr, 'faded');
    }
    updateLocks();

    // ARM warning + timed alarms
    let eta = null;
    for (const e of ents) if (e.kind === K.ARM) { const t = Math.hypot(e.x, e.y) * 1000 / e.spd; if (eta === null || t < eta) eta = t; }
    R.armEta = eta === null ? null : rnd(eta, 1);
    alarm('arm', eta !== null);
    alarm('leaker', s.t < leakerUntil);
    alarm('asset', s.t < assetUntil);
    checkAmmo();

    // truth for the scene
    s.visible = [];
    for (const e of ents) {
      if (Math.hypot(e.x, e.y) <= (RS.AIR_VISIBLE_KM || RS.VISIBLE_KM)) s.visible.push({ id: e.id, kind: e.kind, x: e.x, y: e.y, alt: e.alt, hdg: e.hdg, burning: false, spd: e.spd });
    }
    for (let i = debris.length - 1; i >= 0; i--) {
      const d = debris[i], e = d.e;
      if (s.t >= d.until) { debris.splice(i, 1); continue; }
      const v = e.spd * 0.5 / 1000 * dt;
      e.x += Math.sin(e.hdg * D2R) * v; e.y += Math.cos(e.hdg * D2R) * v; e.alt = Math.max(0, e.alt - 80 * dt);
      if (Math.hypot(e.x, e.y) <= (RS.AIR_VISIBLE_KM || RS.VISIBLE_KM)) s.visible.push({ id: e.id, kind: e.kind, x: e.x, y: e.y, alt: e.alt, hdg: e.hdg, burning: true, spd: e.spd });
    }
    for (const m of s.missiles) {
      if (Math.hypot(m.x, m.y) <= RS.VISIBLE_KM * 3) s.visible.push({ id: m.id, kind: 'missile_' + m.weapon, x: m.x, y: m.y, alt: m.alt, hdg: m.hdg, burning: !!m.motor, spd: m.spd });
    }

    emit('SIM_TICK', { t: s.t, dt });
    if (endAt && s.t >= endAt) sim.endShift(endReason);
    else if (s.shift.elapsed >= s.shift.duration) sim.endShift('complete');
  };

  sim.endShift = function (reason) {
    const s = sim.state;
    if (!s.shift.running) return;
    s.shift.running = false;
    s.shift.failed = s.shift.failed || s.stats.fratricide || s.asset.hp <= 0;
    emit('SHIFT_END', { grade: grade(), failed: s.shift.failed, reason: reason || 'ended', stats: JSON.parse(JSON.stringify(s.stats)) });
  };

  /* ---------- commands ---------- */
  sim.cmd = {
    selectTrack(id) {
      const s = sim.state;
      if (id !== null && !s.tracks.some(t => t.id === id)) return false;
      s.selectedId = id;
      emit('TRACK_SELECTED', { id });
      return true;
    },
    radar(on) {
      const s = sim.state, R = s.radar;
      on = !!on;
      if (on && (R.health <= 0 || s.t < radarDownUntil)) return false;
      if (R.on === on) return true;
      R.on = on;
      if (!on) { R.emitTime = 0; warnNext = WARN_AFTER; }
      emit('RADAR_STATE', { on });
      return true;
    },
    setDoctrine(d) {
      if (d !== RS.DOCTRINE.SLS && d !== RS.DOCTRINE.SALVO) return false;
      sim.state.battery.doctrine = d;
      return true;
    },
    interrogate(id) {
      const s = sim.state, tr = findTrack(id);
      if (!tr || !s.radar.on || tr.iff === IFF.PENDING) return false;
      tr.iff = IFF.PENDING;
      pendIff.push({ at: s.t + IFF_DELAY - 1e-9, id });
      emit('IFF_SENT', { id });
      return true;
    },
    classify(id, cls) {
      const tr = findTrack(id);
      if (!tr || !Object.values(CLS).includes(cls)) return false;
      tr.cls = cls;
      derive(tr);
      emit('CLASSIFIED', { id, cls });
      return true;
    },
    assign(id, lid) {
      const s = sim.state, tr = findTrack(id);
      if (!tr) return false;
      if (lid == null) {
        unassign(id);
        emit('ASSIGNED', { id, weapon: null, launcherId: null });
        return true;
      }
      const L = launcher(lid);
      if (!L) return false;
      if (s.battery.assignedTo[id] === lid) return true;
      unassign(id);
      if (L.assignedTrack) unassign(L.assignedTrack);
      s.battery.assignedTo[id] = lid; L.assignedTrack = id; tr.assigned = lid;
      emit('ASSIGNED', { id, weapon: L.weapon, launcherId: lid });
      updateLocks();
      return true;
    },
    fire(id) {
      const s = sim.state;
      if (!s.shift.running) return false;
      const reject = reason => { emit('FIRE_REJECTED', { id: id === undefined ? null : id, reason }); return false; };
      const tr = findTrack(id);
      if (!tr) return reject('no_track');
      const rr = roeReason(tr);
      if (rr) return reject(rr);
      const lid = s.battery.assignedTo[id];
      if (!lid) return reject('not_assigned');
      const L = launcher(lid), sol = solution(tr, L);
      if (!sol.ok) return reject(sol.reason);
      const e = trackEnt[id];
      if (HOSTILE[e.kind] && !e.shotAt) { e.shotAt = true; s.stats.reactionTimes.push(rnd(s.t - e.trackT, 1)); }
      setLock(lid, id, false);
      const salvo = s.battery.doctrine === RS.DOCTRINE.SALVO;
      if (L.weapon === WP.HARROW) fireGun(L, tr, e, salvo, sol.pk);
      else {
        launchMissile(L, id, e, sol.pk);
        if (salvo && L.rounds > 0) pendLaunch.push({ at: s.t + (SALVO_GAP[L.weapon] || 2) - 1e-9, lid, trackId: id, e, pk: sol.pk });
      }
      return true;
    },
    reload(lid) {
      const L = launcher(lid);
      return !!L && startReload(L);
    },
    ack(commsId) {
      const c = sim.state.comms.find(k => k.id === commsId);
      if (!c || !c.needsAck || c.acked) return false;
      c.acked = true;
      return true;
    }
  };

  /* ---------- queries (read-only) ---------- */
  /** TEST-ONLY truth peek (never used by UI/scene): true kind behind a track, or null. */
  sim.debugTruth = id => (trackEnt[id] ? trackEnt[id].kind : null);

  sim.query = {
    engage(trackId, launcherId) {
      const tr = findTrack(trackId);
      const L = launcher(launcherId || (tr && sim.state.battery.assignedTo[trackId]));
      const sol = solution(tr, L);
      const rr = tr && roeReason(tr);
      if (rr) { sol.ok = false; sol.reason = rr; }
      return sol;
    },
    bestLauncher(trackId) {
      const tr = findTrack(trackId);
      if (!tr) return null;
      let best = null, bestPk = -1;
      for (const L of sim.state.battery.launchers) {
        const sol = solution(tr, L);
        if (!sol.ok) continue;
        if (!best || sol.pk > bestPk + PK_MARGIN * (COST[L.weapon] > COST[best.weapon] ? 1 : -1) ||
            (Math.abs(sol.pk - bestPk) <= PK_MARGIN && COST[L.weapon] < COST[best.weapon])) { best = L; bestPk = sol.pk; }
      }
      return best ? best.id : null;
    }
  };

  RS.sim = sim;
})();
