/* =====================================================================
   RED SKIES — content.js   RS.content : pure data + generators
   ---------------------------------------------------------------------
   WeaponDef (RS.content.weapons[RS.WEAPON.*]):
     sam: { label, kind:'sam', minKm, maxKm, maxAlt m, spd m/s, pkBase 0..1, reloadS, perLauncher }
     gun: { label, kind:'gun', minKm, maxKm, maxAlt m, roundsPerBurst, pkPerBurst 0..1, reloadS, perLauncher }
   RS.content.reserve = { lance, dart, harrow }  default battery magazine (ShiftDef.reserve overrides)
   ThreatDef = { label, altBand:[min,max] m, spdBand:[min,max] m/s, rcs:0..1, notes,
                 pkMod:{lance,dart,harrow} (pk multiplier), maneuver:0..1, armCapable:boolean, jammer:boolean }
     keyed by RS.KIND value (e.g. RS.content.threats['jet_hostile']).
   ShiftDef = {
     id:string, name:string, duration:number (s, 480 = 8 min),
     roe:RS.ROE.*   (starting ROE),
     reserve?:{lance,dart,harrow},
     roeChanges?:[ { t:s, roe:RS.ROE.* } ],
     events?:[ { t:s, kind:RS.RANDOM_EVENT.*, duration:s, detail:string } ],
     spawns:[ { t:s, kind:RS.KIND.*, x:km, y:km, alt:m, hdg:deg (0=N, cw), spd:m/s,
                corridor?:[[x,y],...] km waypoints (entity follows them in order;
                           if the final waypoint is an airbase the entity lands there),
                orbit?:{cx,cy,r} km (CAP circle; defaults to spawn point, r 8 km; keep cx,cy,r within 35 km),
                callsign?:string  (content-only label; radio calls use it — not exposed on tracks),
                iffBroken?:true   (friendlies only; transponder inop → IFF NO_RESPONSE; always radio-announced first),
                jammer?:true, armCarrier?:true, strike?:true, group?:string,
                popup?:{hideAlt:m, atKm:km}, count?:n, spread?:km  (count>1 = swarm scattered within spread) } ],
     comms:[ { t:s, from:'HQ'|'CAP'|'TOWER'|'BATTERY', text, priority:'low'|'normal'|'high', needsAck?:true } ],
     weather?:{ time:'dawn'|'day'|'dusk'|'night', sky:'clear'|'overcast'|'rain' }   [v1.1] default {dusk, clear}
     endless?:true, seed?:number   [v1.1] survival: sim pulls waves from makeSurvivalWave(n, seed); duration ignored
     sureHit?:true                 [V1.4.4] training aid: every battery shot kills, targets never evade (see contracts.js)
   }
   [v1.1] makeFreeShift(seed, difficulty, opts?) — opts.weather {time?, sky?} ('random'/missing → picked from the seed).
   makeSurvivalShift(seed) → endless ShiftDef.  makeSurvivalWave(n, seed) → { spawns (t relative to wave start), comms }.
   pickWeather(seed, want?) → {time, sky} (seeded, weighted; fields in `want` other than 'random' are kept).
   Kinematic behaviour by kind (sim.js): friendlies with corridor follow it, friendlies
   without corridor orbit (CAP); hostiles steer toward the battery at (0,0).
   ===================================================================== */
(function () {
  const RS = (typeof window !== 'undefined' ? window : globalThis).RS;
  const K = RS.KIND, ROE = RS.ROE, EV = RS.RANDOM_EVENT;

  const weapons = {
    lance:  { label: 'Lance',  kind: 'sam', minKm: 3, maxKm: 60,  maxAlt: 20000, spd: 1840, pkBase: 0.80, reloadS: 50, perLauncher: 4 },
    dart:   { label: 'Dart',   kind: 'sam', minKm: 1, maxKm: 25,  maxAlt: 10000, spd: 1250, pkBase: 0.80, reloadS: 15, perLauncher: 4 },
    harrow: { label: 'Harrow', kind: 'gun', minKm: 0, maxKm: 4, maxAlt: 4000, roundsPerBurst: 40, pkPerBurst: 0.6, reloadS: 30, perLauncher: 600 }
  };
  const reserve = { lance: 8, dart: 8, harrow: 1200 };

  const T = (label, altBand, spdBand, rcs, notes, pk, maneuver, armCapable, jammer) =>
    ({ label, altBand, spdBand, rcs, notes, pkMod: { lance: pk[0], dart: pk[1], harrow: pk[2] }, maneuver, armCapable, jammer });
  const threats = {
    [K.JET_FRIEND]:    T('Fighter (Varennan AF)', [3000, 9000], [180, 300], 0.5, 'CAP pairs orbit inside 35 km; squawk valid IFF.', [1, 1, 0.3], 0.5, false, false),
    [K.STRIKE_FRIEND]: T('Strike aircraft (Varennan AF)', [300, 6000], [200, 280], 0.6, 'Returns along the RTB corridors after missions. IFF sometimes damaged.', [1, 1, 0.4], 0.4, false, false),
    [K.TRANSPORT]:     T('Transport (Varennan AF)', [1500, 7000], [120, 170], 1.0, 'Slow, large, flies published corridors to Kessel airbase.', [1.1, 1.1, 0.6], 0.05, false, false),
    [K.HELO_FRIEND]:   T('Utility helicopter', [50, 600], [40, 70], 0.35, 'Low and slow; often hidden by terrain.', [0.7, 1, 0.8], 0.3, false, false),
    [K.JET_HOSTILE]:   T('Strike fighter (hostile)', [200, 8000], [220, 320], 0.45, 'Ingresses from north/east toward defended asset. May carry a pod or ARMs.', [1, 1, 0.3], 0.6, true, false),
    [K.HELO_HOSTILE]:  T('Attack helicopter (hostile)', [30, 300], [50, 80], 0.3, 'Nap-of-earth; pops up late.', [0.7, 1, 1.0], 0.35, false, false),
    [K.CRUISE]:        T('Cruise missile', [30, 80], [230, 270], 0.08, 'Very low, small, fast. Seen late under radar horizon.', [0.8, 0.9, 1.0], 0.3, false, false),
    [K.DRONE]:         T('Loitering munition / drone', [150, 1500], [35, 60], 0.06, 'Tiny and slow; often in pairs or swarms.', [0.6, 0.9, 1.3], 0.2, false, false),
    [K.ARM]:           T('Anti-radiation missile', [500, 12000], [600, 800], 0.05, 'Homes on our radar emissions.', [0.5, 0.8, 0.9], 0.1, false, false)
  };
  const FRIENDLY = { [K.JET_FRIEND]: 1, [K.STRIKE_FRIEND]: 1, [K.TRANSPORT]: 1, [K.HELO_FRIEND]: 1 };

  // Kessel airbase lies 22 km SSW of the battery. Sector 1 = east, sector 2 = north.
  const AIRBASE = [-8, -22];
  const RTB_EAST = [[40, 30], [18, 10], [4, -6], AIRBASE];
  const RTB_NORTH = [[5, 55], [2, 20], [-4, -8], AIRBASE];
  const CAP_ORBIT = { cx: -10, cy: 18, r: 8 };            // 20.6 + 8 = 28.6 km max from battery

  /* Shift 0 — hand-authored combat test. Rhythm: quiet 0–1:20, rising 1:20–3:50, breather 3:50–4:50,
     final push 5:00–6:30 (weapons FREE), wind-down to 8:00. */
  const shift0 = {
    id: 'S0', name: 'Shift 0: Kessel Range Check', duration: 480, roe: ROE.TIGHT,
    roeChanges: [{ t: 300, roe: ROE.FREE }, { t: 390, roe: ROE.TIGHT }],
    events: [{ t: 255, kind: EV.LAUNCHER_JAM, duration: 25, detail: 'L2' }],
    spawns: [
      // 0:00 quiet start — CAP pair on station, transport inbound east
      { t: 0,   kind: K.JET_FRIEND, callsign: 'Viper 1', group: 'viper', x: -18, y: 18, alt: 7000, hdg: 0, spd: 220, orbit: CAP_ORBIT },
      { t: 5,   kind: K.JET_FRIEND, callsign: 'Viper 2', group: 'viper', x: -2, y: 18, alt: 7600, hdg: 180, spd: 220, orbit: CAP_ORBIT },
      { t: 20,  kind: K.TRANSPORT, callsign: 'Heavy 21', x: 58, y: 44, alt: 5200, hdg: 230, spd: 150, corridor: RTB_EAST },
      // 1:15 strike package RTB north corridor — Hammer 2 has no IFF (announced at 0:45)
      { t: 75,  kind: K.STRIKE_FRIEND, callsign: 'Hammer 1', group: 'hammer', x: 7, y: 62, alt: 3500, hdg: 185, spd: 240, corridor: RTB_NORTH },
      { t: 80,  kind: K.STRIKE_FRIEND, callsign: 'Hammer 2', group: 'hammer', iffBroken: true, x: 9, y: 63, alt: 3200, hdg: 185, spd: 235, corridor: RTB_NORTH },
      // 1:40 hostile strike pair from the north, trailing the package
      { t: 100, kind: K.JET_HOSTILE, group: 'raid1', strike: true, x: 12, y: 64, alt: 5500, hdg: 190, spd: 270 },
      { t: 103, kind: K.JET_HOSTILE, group: 'raid1', strike: true, x: 16, y: 63, alt: 5200, hdg: 195, spd: 270 },
      // 2:10 low cruise pair from the east
      { t: 130, kind: K.CRUISE, group: 'cm1', x: 60, y: 6, alt: 45, hdg: 265, spd: 250 },
      { t: 134, kind: K.CRUISE, group: 'cm1', x: 61, y: 2, alt: 40, hdg: 268, spd: 250 },
      // 2:45 drone swarm from the north-east
      { t: 165, kind: K.DRONE, group: 'swarm1', x: 24, y: 26, alt: 800, hdg: 225, spd: 45, count: 6, spread: 2 },
      // 3:10 escort jammer NE, 3:20 ARM carrier from the north, 3:45 pop-up helos east
      { t: 190, kind: K.JET_HOSTILE, group: 'raid2', jammer: true, x: 44, y: 44, alt: 8000, hdg: 225, spd: 250 },
      { t: 200, kind: K.JET_HOSTILE, group: 'raid2', armCarrier: true, x: 4, y: 64, alt: 7000, hdg: 180, spd: 280 },
      { t: 225, kind: K.HELO_HOSTILE, group: 'helo1', x: 26, y: -4, alt: 40, hdg: 280, spd: 65, popup: { hideAlt: 60, atKm: 10 } },
      { t: 229, kind: K.HELO_HOSTILE, group: 'helo1', x: 27, y: -7, alt: 35, hdg: 285, spd: 65, popup: { hideAlt: 60, atKm: 10 } },
      // 4:10 breather — CAP relief
      { t: 250, kind: K.JET_FRIEND, callsign: 'Cobra 1', x: -32, y: 4, alt: 8000, hdg: 45, spd: 240, orbit: CAP_ORBIT },
      // 5:05 final push under FREE — strike jets NE + drones
      { t: 305, kind: K.JET_HOSTILE, group: 'raid3', strike: true, x: 46, y: 42, alt: 1200, hdg: 225, spd: 300 },
      { t: 308, kind: K.JET_HOSTILE, group: 'raid3', strike: true, x: 50, y: 38, alt: 900, hdg: 230, spd: 300 },
      { t: 320, kind: K.DRONE, group: 'swarm2', x: 18, y: 28, alt: 600, hdg: 210, spd: 50, count: 3, spread: 1.5 },
      { t: 345, kind: K.CRUISE, group: 'cm2', x: 44, y: 40, alt: 40, hdg: 225, spd: 245 },
      // 6:40 wind-down — friendly strike RTB east after TIGHT restored
      { t: 400, kind: K.STRIKE_FRIEND, callsign: 'Anvil 1', x: 55, y: 35, alt: 1500, hdg: 240, spd: 230, corridor: RTB_EAST }
    ],
    comms: [
      { t: 2,   from: 'HQ',      text: 'Battery Kessel, on watch. Weapons TIGHT.', priority: 'normal' },
      { t: 10,  from: 'CAP',     text: 'Viper flight on station, orbit north-west, angels 7.', priority: 'low' },
      { t: 25,  from: 'TOWER',   text: 'Heavy 21 inbound east corridor, ETA 8 minutes.', priority: 'low' },
      { t: 45,  from: 'TOWER',   text: 'Hammer 2, IFF inop, egressing sector 2 via north corridor.', priority: 'high' },
      { t: 70,  from: 'TOWER',   text: 'Hammer flight, two ship, RTB north corridor, angels 3.', priority: 'normal' },
      { t: 95,  from: 'HQ',      text: 'Fast movers trailing Hammer, sector 2. Verify before engaging.', priority: 'high' },
      { t: 128, from: 'HQ',      text: 'Low-level launch detected, sector 1. Expect cruise.', priority: 'high' },
      { t: 160, from: 'BATTERY', text: 'Multiple small contacts north-east. Swarm likely.', priority: 'normal' },
      { t: 185, from: 'HQ',      text: 'Jamming reported north-east. Watch strobes.', priority: 'normal' },
      { t: 205, from: 'CAP',     text: 'Viper: bandit north, high and fast, possible shooter.', priority: 'high' },
      { t: 220, from: 'BATTERY', text: 'Emission time high. Consider radar discipline.', priority: 'normal' },
      { t: 240, from: 'HQ',      text: 'Rotor traffic reported east, low. None of ours.', priority: 'normal' },
      { t: 255, from: 'CAP',     text: 'Cobra 1 relieving Viper on station.', priority: 'low' },
      { t: 270, from: 'TOWER',   text: 'Heavy 21 on final. Hammer flight on the ground.', priority: 'low' },
      { t: 290, from: 'HQ',      text: 'Raid building north-east. Weapons FREE at 5:00. Acknowledge.', priority: 'high', needsAck: true },
      { t: 385, from: 'HQ',      text: 'Weapons TIGHT. Anvil 1 inbound east corridor.', priority: 'high', needsAck: true },
      { t: 440, from: 'TOWER',   text: 'Anvil 1 on the ground. Picture clear.', priority: 'low' },
      { t: 470, from: 'HQ',      text: 'Relief crew arriving. Prepare handover.', priority: 'low' }
    ]
  };

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  const CALLS = ['Hammer', 'Anvil', 'Talon', 'Saber', 'Lancer'];

  // [v1.1] weather from the seed on its own stream (the shift content stream stays unchanged)
  const WX_TIME = [['dusk', 0.3], ['day', 0.3], ['dawn', 0.2], ['night', 0.2]], WX_SKY = [['clear', 0.55], ['overcast', 0.3], ['rain', 0.15]];
  function pickWeather(seed, want) {
    const r = mulberry32(((seed >>> 0) ^ 0x5EA7E4) >>> 0), w = want || {};
    const pickW = tab => { let u = r(); for (const [k, p] of tab) { if ((u -= p) < 0) return k; } return tab[0][0]; };
    const time = pickW(WX_TIME), sky = pickW(WX_SKY);
    return { time: w.time && w.time !== 'random' ? w.time : time, sky: w.sky && w.sky !== 'random' ? w.sky : sky };
  }

  /** Seeded free-play shift. difficulty 0..1 scales hostile count, jammers, ARMs, swarms, pop-ups, broken IFF. */
  function makeFreeShift(seed, difficulty, opts) {
    const r = mulberry32(seed >>> 0);
    const d = Math.max(0, Math.min(1, difficulty == null ? 0.5 : difficulty));
    const rng = (a, b) => a + (b - a) * r();
    const pick = a => a[Math.floor(r() * a.length)];
    const spawns = [], comms = [{ t: 2, from: 'HQ', text: 'Battery on watch. Weapons TIGHT.', priority: 'normal' }];
    const add = (t, kind, bearing, rangeKm, extra) => {
      const th = threats[kind], b = bearing * Math.PI / 180;
      const hdg = (bearing + 180 + rng(-15, 15) + 360) % 360;
      const s = Object.assign({ t: Math.round(t), kind, x: +(Math.sin(b) * rangeKm).toFixed(2), y: +(Math.cos(b) * rangeKm).toFixed(2),
        alt: Math.round(rng(th.altBand[0], th.altBand[1])), hdg: Math.round(hdg), spd: Math.round(rng(th.spdBand[0], th.spdBand[1])) }, extra || {});
      spawns.push(s); return s;
    };
    const orbit = { cx: -10, cy: 20, r: 8 };
    add(0, K.JET_FRIEND, rng(290, 340), 26, { orbit, callsign: 'Viper 1', group: 'viper' });
    add(3, K.JET_FRIEND, rng(290, 340), 26, { orbit, callsign: 'Viper 2', group: 'viper' });
    comms.push({ t: 8, from: 'CAP', text: 'Viper flight on station, north-west.', priority: 'low' });
    // friendly traffic on corridors; some with broken IFF (always announced ≥ 30 s before they appear)
    const nFriends = 3 + Math.floor(r() * 3), pBroken = 0.1 + 0.4 * d;
    for (let i = 0; i < nFriends; i++) {
      const east = r() < 0.5, c = east ? RTB_EAST : RTB_NORTH, t = rng(40, 420);
      const kind = pick([K.TRANSPORT, K.STRIKE_FRIEND, K.STRIKE_FRIEND, K.HELO_FRIEND]);
      const callsign = (kind === K.TRANSPORT ? 'Heavy' : kind === K.HELO_FRIEND ? 'Dustoff' : CALLS[i % CALLS.length]) + ' ' + (i + 1);
      const broken = kind !== K.HELO_FRIEND && r() < pBroken;
      const sp = add(t, kind, east ? 50 : 5, kind === K.HELO_FRIEND ? 40 : 60, { corridor: c, callsign });
      const sector = east ? 1 : 2, via = east ? 'east' : 'north';
      if (broken) {
        sp.iffBroken = true;
        comms.push({ t: Math.max(5, sp.t - Math.round(rng(30, 60))), from: 'TOWER', text: `${callsign}, IFF inop, egressing sector ${sector} via ${via} corridor.`, priority: 'high' });
      } else comms.push({ t: Math.max(5, sp.t - 20), from: 'TOWER', text: `${callsign} RTB ${via} corridor.`, priority: 'low' });
    }
    // hostiles
    const nHostile = Math.round(4 + d * 10);
    const mix = [K.JET_HOSTILE, K.JET_HOSTILE, K.CRUISE, K.DRONE, K.HELO_HOSTILE];
    for (let i = 0; i < nHostile; i++) {
      const kind = pick(mix), t = rng(30, 440), brg = rng(-20, 110), g = 'h' + i;
      if (kind === K.JET_HOSTILE) {
        const pair = r() < 0.3 + 0.5 * d;
        add(t, kind, brg, 62, r() < 0.6 ? { group: g, strike: true } : { group: g });
        if (pair) add(t + 3, kind, brg + 4, 62, { group: g, strike: true });
      } else if (kind === K.DRONE) {
        const n = r() < 0.3 + 0.6 * d ? 3 + Math.round(d * 5) : 2;
        add(t, kind, brg, 35, { group: g, count: n, spread: +(1 + d).toFixed(1) });
      } else if (kind === K.HELO_HOSTILE) {
        add(t, kind, rng(40, 120), 28, { group: g, alt: Math.round(rng(30, 50)), popup: { hideAlt: 60, atKm: Math.round(rng(8, 12)) } });
      } else {
        add(t, kind, brg, 62, { group: g });
        if (r() < d) add(t + 4, kind, brg + 3, 62, { group: g });
      }
    }
    const nJam = d < 0.3 ? 0 : 1 + Math.floor(d * 1.99);
    for (let i = 0; i < nJam; i++) add(rng(120, 360), K.JET_HOSTILE, rng(20, 70), 62, { jammer: true, alt: Math.round(rng(7000, 8500)), group: 'jam' + i });
    const nArm = d < 0.4 ? 0 : 1 + Math.floor((d - 0.4) * 3.3);
    for (let i = 0; i < nArm; i++) add(rng(150, 380), K.JET_HOSTILE, rng(-20, 60), 62, { armCarrier: true, alt: Math.round(rng(6000, 8000)), group: 'arm' + i });
    if (nJam) comms.push({ t: 110, from: 'HQ', text: 'Stand-off jammer expected north-east.', priority: 'normal' });
    if (nArm) comms.push({ t: 140, from: 'HQ', text: 'Shooters with anti-radiation missiles airborne. Radar discipline.', priority: 'high' });
    // high difficulty: a FREE window ordered by HQ
    const roeChanges = [];
    if (d >= 0.6) {
      const t0 = Math.round(rng(240, 320));
      roeChanges.push({ t: t0, roe: ROE.FREE }, { t: t0 + 90, roe: ROE.TIGHT });
      comms.push({ t: t0 - 10, from: 'HQ', text: 'Weapons FREE in ten seconds. Acknowledge.', priority: 'high', needsAck: true },
        { t: t0 + 85, from: 'HQ', text: 'Weapons TIGHT. Acknowledge.', priority: 'high', needsAck: true });
    }
    spawns.sort((a, b) => a.t - b.t);
    comms.sort((a, b) => a.t - b.t);
    return { id: 'F' + seed, name: 'Free watch #' + seed, duration: 480, roe: ROE.TIGHT, reserve: Object.assign({}, reserve), roeChanges, spawns, comms,
      weather: pickWeather(seed, opts && opts.weather) };
  }

  /* ---------- [v1.1] Survival (endless) ---------- */
  /** Endless ShiftDef: weapons FREE, generous magazine, a CAP pair on station (so ID still matters). Waves come from the sim. */
  function makeSurvivalShift(seed) {
    seed = seed >>> 0;
    const orbit = { cx: -10, cy: 20, r: 8 };
    return { id: 'SURV-' + seed, name: 'Survival #' + seed, endless: true, seed, duration: 0, roe: ROE.FREE,
      reserve: { lance: 12, dart: 12, harrow: 1800 }, weather: pickWeather(seed),
      spawns: [
        { t: 0, kind: K.JET_FRIEND, callsign: 'Viper 1', group: 'viper', x: -18, y: 20, alt: 7000, hdg: 0, spd: 220, orbit },
        { t: 3, kind: K.JET_FRIEND, callsign: 'Viper 2', group: 'viper', x: -2, y: 20, alt: 7600, hdg: 180, spd: 220, orbit }],
      comms: [
        { t: 1, from: 'HQ', text: 'Battery, weapons FREE. Hold as long as you can. Our CAP stays on station north-west.', priority: 'high' },
        { t: 5, from: 'CAP', text: 'Viper flight on station, north-west, angels 7. Do not shoot us.', priority: 'normal' }] };
  }

  /** Wave n (1-based) of survival seed: escalating raid. Deterministic per (n, seed). t is relative to the wave start. */
  function makeSurvivalWave(n, seed) {
    n = Math.max(1, Math.floor(n));
    const r = mulberry32((Math.imul((seed >>> 0) + 1, 0x9E3779B1) ^ Math.imul(n, 0x85EBCA6B)) >>> 0);
    const rng = (a, b) => a + (b - a) * r(), pick = a => a[Math.floor(r() * a.length)];
    const spawns = [], comms = [], from = rng(-40, 100);                  // main threat axis (bearing) for this wave
    const add = (t, kind, bearing, km, extra) => {
      const th = threats[kind], b = bearing * Math.PI / 180;
      const s = Object.assign({ t: Math.round(t), kind, x: +(Math.sin(b) * km).toFixed(2), y: +(Math.cos(b) * km).toFixed(2),
        alt: Math.round(rng(th.altBand[0], th.altBand[1])), hdg: Math.round((bearing + 180 + rng(-12, 12) + 360) % 360),
        spd: Math.round(rng(th.spdBand[0], th.spdBand[1])) }, extra || {});
      spawns.push(s); return s;
    };
    const brg = () => from + rng(-35, 35), g = i => 'w' + n + '_' + i;
    let pts = 2.5 + 0.9 * (n - 1), i = 0;
    const menu = [[K.JET_HOSTILE, 2], [K.CRUISE, 1.5], [K.DRONE, 1], [K.HELO_HOSTILE, 1.5]];
    if (n >= 3) menu.push(['swarm', 2]);
    while (pts > 0.5 && i < 40) {
      const [kind, cost] = pick(menu), t = rng(0, 55); i++;
      pts -= cost;
      if (kind === K.JET_HOSTILE) {
        const pair = r() < 0.2 + 0.05 * n, b = brg(), strike = r() < 0.7;
        add(t, kind, b, rng(65, 80), strike ? { group: g(i), strike: true } : { group: g(i) });
        if (pair) { add(t + 3, kind, b + 4, rng(65, 80), { group: g(i), strike: true }); pts -= 1; }
      } else if (kind === K.CRUISE) {
        const b = brg(); add(t, kind, b, rng(55, 65), { group: g(i) });
        if (r() < 0.1 * n) { add(t + 4, kind, b + 3, rng(55, 65), { group: g(i) }); pts -= 0.75; }
      } else if (kind === K.DRONE) add(t, kind, brg(), rng(20, 26), { group: g(i), count: 2, spread: 1 });
      else if (kind === 'swarm') add(t, K.DRONE, brg(), rng(20, 26), { group: g(i), count: Math.min(8, 2 + Math.floor(n / 3)), spread: 2 });
      else add(t, kind, rng(20, 140), rng(20, 26), { group: g(i), alt: Math.round(rng(30, 50)), popup: { hideAlt: 60, atKm: Math.round(rng(8, 12)) } });
    }
    if (n >= 4) for (let k = 0; k < 1 + Math.floor((n - 4) / 4); k++) add(rng(10, 50), K.JET_HOSTILE, brg(), rng(70, 80), { armCarrier: true, alt: Math.round(rng(6000, 8000)), group: g('arm' + k) });
    if (n >= 6) for (let k = 0; k < 1 + Math.floor((n - 6) / 5); k++) add(rng(0, 30), K.JET_HOSTILE, from + rng(-15, 15), rng(75, 80), { jammer: true, alt: Math.round(rng(7000, 8500)), group: g('jam' + k) });
    // the odd friendly transit (radio-announced first) from wave 3, sometimes with a dead transponder later on
    if (n >= 3 && r() < 0.6) {
      const east = r() < 0.5, kind = pick([K.TRANSPORT, K.STRIKE_FRIEND, K.STRIKE_FRIEND]), t = Math.round(rng(25, 50));
      const callsign = (kind === K.TRANSPORT ? 'Heavy' : pick(CALLS)) + ' ' + (10 + n), broken = kind !== K.TRANSPORT && n >= 5 && r() < 0.35;
      const sp = add(t, kind, east ? 50 : 5, 60, { corridor: east ? RTB_EAST : RTB_NORTH, callsign });
      const via = east ? 'east' : 'north', sector = east ? 1 : 2;
      if (broken) sp.iffBroken = true;
      comms.push({ t: Math.max(1, t - 22), from: 'TOWER', text: broken ? `${callsign}, IFF inop, egressing sector ${sector} via ${via} corridor.` : `${callsign} RTB ${via} corridor, sector ${sector}.`, priority: broken ? 'high' : 'normal' });
    }
    if (n >= 4 && spawns.some(s => s.armCarrier)) comms.push({ t: 2, from: 'HQ', text: 'Shooters with anti-radiation missiles in this wave. Radar discipline.', priority: 'high' });
    if (n >= 6 && spawns.some(s => s.jammer)) comms.push({ t: 3, from: 'HQ', text: 'Stand-off jammer on the threat axis. Watch strobes.', priority: 'normal' });
    spawns.sort((a, b) => a.t - b.t); comms.sort((a, b) => a.t - b.t);
    return { spawns, comms };
  }

  RS.content = { weapons, reserve, threats, shifts: [shift0], makeFreeShift, makeSurvivalShift, makeSurvivalWave, pickWeather, mulberry32, airbase: AIRBASE, friendlyKinds: FRIENDLY };
})();
