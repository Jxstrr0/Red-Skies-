/* =====================================================================
   RED SKIES — campaign.js   RS.campaign : the Kessel campaign (6 shifts) + grading.
   ---------------------------------------------------------------------
   RS.campaign = {
     shifts:  ShiftDef[6]        (see content.js JSDoc; only contract fields are used; each has a fixed v1.1 `weather`)
     story:   [{ situation, notes[] }]   briefing text, parallel to shifts
     budget:  number[6]           credits granted before shift i (index 0 = starting magazine, no shop)
     bonus:   { A, B }            extra credits after an A/B grade
     prices:  { lance, dart }     credits per missile;  harrow: credits per 100 rounds
     step:    { lance:1, dart:1, harrow:100 }   resupply stepper increments
     grade(stats, state) -> { grade, failed, score, reason, parts:{asset,leakers,ammo,reaction} (0..100) }
   }
   Pure data + functions; runs in node (tests) with window stubbed.
   ===================================================================== */
(function () {
  const RS = (typeof window !== 'undefined' ? window : globalThis).RS;
  const K = RS.KIND, ROE = RS.ROE, EV = RS.RANDOM_EVENT;

  // geography shared with content.js: Kessel airbase 22 km SSW; sector 1 = east, sector 2 = north
  const AIRBASE = [-8, -22];
  const RTB_EAST = [[40, 30], [18, 10], [4, -6], AIRBASE];
  const RTB_NORTH = [[5, 55], [2, 20], [-4, -8], AIRBASE];
  const CAP_NW = { cx: -10, cy: 18, r: 8 };    // 28.6 km max from the battery
  const CAP_W = { cx: -18, cy: 4, r: 7 };      // 25.4 km

  /* hostile inbound from bearing brg (deg) at range km, heading at the battery */
  function H(t, kind, brg, km, alt, spd, extra) {
    const b = brg * Math.PI / 180;
    return Object.assign({ t, kind, x: +(Math.sin(b) * km).toFixed(1), y: +(Math.cos(b) * km).toFixed(1), alt, hdg: (brg + 180) % 360, spd }, extra || {});
  }
  /* friendly on an RTB corridor, spawned just before its first waypoint */
  function F(t, kind, callsign, east, alt, spd, extra) {
    const c = east ? RTB_EAST : RTB_NORTH;
    const p = east ? [56, 42] : [7, 63];
    return Object.assign({ t, kind, callsign, x: p[0], y: p[1], alt, hdg: east ? 230 : 185, spd, corridor: c }, extra || {});
  }
  function CAP(t, callsign, x, y, alt, orbit, group) {
    return { t, kind: K.JET_FRIEND, callsign, group: group || 'cap', x, y, alt, hdg: 0, spd: 220, orbit };
  }
  const C = (t, from, text, priority, needsAck) => needsAck ? { t, from, text, priority, needsAck: true } : { t, from, text, priority };

  /* ---------- Shift 1: First Watch — gentle, lots of HQ coaching ---------- */
  const s1 = {
    id: 'C1', name: 'Shift 1: First Watch', duration: 360, roe: ROE.TIGHT,
    weather: { time: 'day', sky: 'clear' },
    reserve: { lance: 8, dart: 8, harrow: 1200 },
    spawns: [
      CAP(0, 'Viper 1', -18, 18, 7000, CAP_NW, 'viper'),
      CAP(4, 'Viper 2', -2, 18, 7600, CAP_NW, 'viper'),
      F(30, K.TRANSPORT, 'Heavy 11', true, 5200, 150),
      H(80, K.JET_HOSTILE, 5, 62, 6000, 250, { group: 'r1' }),
      H(150, K.DRONE, 40, 30, 700, 45, { group: 'd1', count: 2, spread: 1 }),
      H(215, K.JET_HOSTILE, 20, 62, 5000, 260, { group: 'r2', strike: true }),
      H(219, K.JET_HOSTILE, 24, 62, 5200, 260, { group: 'r2', strike: true }),
      H(270, K.CRUISE, 80, 58, 50, 245, { group: 'cm1' })
    ],
    comms: [
      C(2, 'HQ', 'Battery Kessel, first watch. Weapons TIGHT: engage only what you have classified HOSTILE.', 'normal'),
      C(10, 'HQ', 'Tip: tap a contact on the scope to select it. Friendly traffic is announced on the radio.', 'normal'),
      C(16, 'CAP', 'Viper flight on station, orbit north-west, angels 7.', 'low'),
      C(22, 'TOWER', 'Heavy 11 inbound east corridor, sector 1. Slow and big, one of ours.', 'low'),
      C(40, 'HQ', 'Tip: select a contact and press IFF. A FRIEND reply means one of ours: classify it FRIEND.', 'normal'),
      C(75, 'HQ', 'Single fast mover from the north, sector 2. Not ours. Interrogate it.', 'high'),
      C(95, 'HQ', 'Tip: no IFF reply and coming straight at you? Classify HOSTILE, ASSIGN a launcher, then hold FIRE.', 'high'),
      C(120, 'HQ', 'Tip: Lance reaches 60 km, save it for jets. Dart covers 25 km and reloads fast: use it on drones, helos and cruise missiles. Harrow gun is last-ditch inside 4 km.', 'normal'),
      C(145, 'BATTERY', 'Two small slow contacts north-east. Drones. Let them come to Dart or Harrow.', 'normal'),
      C(205, 'HQ', 'Strike pair from the north-north-east heading for the depot. Stop them before 6 km.', 'high'),
      C(235, 'HQ', 'Tip: radar ON is how you see, but long emission invites anti-radiation missiles. Not today.', 'low'),
      C(262, 'HQ', 'Low-level launch east, sector 1. Cruise missile, very low. You will see it late.', 'high'),
      C(330, 'TOWER', 'Heavy 11 on the ground. Good first watch, Kessel.', 'low')
    ]
  };

  /* ---------- Shift 2: Night Shift ---------- */
  const s2 = {
    id: 'C2', name: 'Shift 2: Night Shift', duration: 420, roe: ROE.TIGHT,
    weather: { time: 'night', sky: 'clear' },
    events: [{ t: 0, kind: EV.NIGHT, duration: 420, detail: 'night' }],
    spawns: [
      CAP(0, 'Cobra 1', -24, 6, 8000, CAP_W, 'cobra'),
      F(40, K.HELO_FRIEND, 'Dustoff 3', true, 300, 60, { x: 30, y: 22 }),
      F(95, K.STRIKE_FRIEND, 'Hammer 1', false, 3500, 240, { group: 'hammer' }),
      F(99, K.STRIKE_FRIEND, 'Hammer 2', false, 3200, 235, { group: 'hammer', iffBroken: true, x: 9, y: 64 }),
      H(120, K.JET_HOSTILE, 10, 62, 5500, 270, { group: 'r1', strike: true }),
      H(123, K.JET_HOSTILE, 14, 62, 5200, 270, { group: 'r1', strike: true }),
      H(170, K.HELO_HOSTILE, 95, 26, 40, 65, { group: 'h1', popup: { hideAlt: 60, atKm: 10 } }),
      H(174, K.HELO_HOSTILE, 102, 27, 35, 65, { group: 'h1', popup: { hideAlt: 60, atKm: 10 } }),
      H(230, K.CRUISE, 70, 60, 45, 250, { group: 'cm1' }),
      H(234, K.CRUISE, 74, 60, 40, 250, { group: 'cm1' }),
      H(290, K.DRONE, 35, 32, 800, 45, { group: 'd1', count: 4, spread: 2 }),
      H(330, K.JET_HOSTILE, 50, 62, 1200, 290, { group: 'r2', strike: true })
    ],
    comms: [
      C(2, 'HQ', 'Kessel, night watch. Weapons TIGHT. Hatch view is dark: trust the scope.', 'normal'),
      C(10, 'CAP', 'Cobra 1 on station, west orbit, angels 8.', 'low'),
      C(30, 'TOWER', 'Dustoff 3, medevac helicopter, low, east corridor sector 1.', 'normal'),
      C(55, 'TOWER', 'Hammer 2, IFF inop, egressing sector 2 via north corridor. Two ship, angels 3.', 'high'),
      C(80, 'HQ', 'Remember: Hammer 2 will not answer IFF. Check the corridor before you classify.', 'normal'),
      C(112, 'HQ', 'Bandits trailing Hammer flight, sector 2. Verify before engaging.', 'high'),
      C(160, 'HQ', 'Rotor noise east, very low. None of ours except Dustoff. Expect pop-ups near 10 km.', 'high'),
      C(222, 'HQ', 'Low-level launch east. Cruise pair.', 'high'),
      C(280, 'BATTERY', 'Small slow contacts north-east. Drones, four or more.', 'normal'),
      C(320, 'HQ', 'Low fast mover north-east, sector 1. Hostile strike.', 'high'),
      C(400, 'HQ', 'Dawn relief crew en route.', 'low')
    ]
  };

  /* ---------- Shift 3: Storm Front — weather, clutter, a radar fault ---------- */
  const s3 = {
    id: 'C3', name: 'Shift 3: Storm Front', duration: 450, roe: ROE.TIGHT,
    weather: { time: 'dusk', sky: 'rain' },
    events: [
      { t: 20, kind: EV.STORM, duration: 400, detail: 'storm cell over the site' },
      { t: 205, kind: EV.RADAR_FAULT, duration: 25, detail: 'lightning strike, radar resetting' },
      { t: 300, kind: EV.LAUNCHER_JAM, duration: 30, detail: 'L1' }
    ],
    spawns: [
      CAP(0, 'Viper 1', -16, 20, 7000, CAP_NW, 'viper'),
      F(60, K.TRANSPORT, 'Heavy 21', true, 4800, 150),
      H(90, K.JET_HOSTILE, 45, 62, 8000, 250, { group: 'jam', jammer: true }),
      H(110, K.JET_HOSTILE, 30, 62, 2500, 280, { group: 'r1', strike: true }),
      H(113, K.JET_HOSTILE, 34, 62, 2300, 280, { group: 'r1', strike: true }),
      H(160, K.DRONE, 60, 34, 600, 50, { group: 'd1', count: 5, spread: 2 }),
      F(180, K.STRIKE_FRIEND, 'Anvil 1', true, 1500, 230, { iffBroken: true }),
      H(215, K.CRUISE, 85, 60, 40, 250, { group: 'cm1' }),
      H(219, K.CRUISE, 88, 60, 40, 250, { group: 'cm1' }),
      H(270, K.HELO_HOSTILE, 110, 25, 35, 70, { group: 'h1', popup: { hideAlt: 60, atKm: 9 } }),
      H(320, K.JET_HOSTILE, 5, 62, 900, 300, { group: 'r2', strike: true }),
      H(324, K.JET_HOSTILE, 9, 62, 1000, 300, { group: 'r2', strike: true })
    ],
    comms: [
      C(2, 'HQ', 'Kessel, storm front moving through. Expect clutter and a noisy scope. Weapons TIGHT.', 'normal'),
      C(12, 'CAP', 'Viper 1, single ship, north-west orbit. Weather is ugly up here.', 'low'),
      C(45, 'TOWER', 'Heavy 21 inbound east corridor, sector 1.', 'low'),
      C(85, 'HQ', 'Stand-off jammer north-east, high. It will smear the picture. Watch strobes.', 'normal'),
      C(105, 'HQ', 'Low strike pair behind the jammer, sector 1. Weapons TIGHT still applies.', 'high'),
      C(140, 'TOWER', 'Anvil 1, IFF inop, egressing sector 1 via east corridor, low, angels 1.5.', 'high'),
      C(155, 'BATTERY', 'Drone group north-east, five plus.', 'normal'),
      C(200, 'BATTERY', 'Lightning close by. Radar may drop out.', 'high'),
      C(210, 'HQ', 'Cruise pair east, very low.', 'high'),
      C(262, 'HQ', 'Rotor traffic south-east, low. Hostile. Expect a pop-up.', 'high'),
      C(295, 'BATTERY', 'L1 rail fouled by the storm. Crew clearing it.', 'normal'),
      C(315, 'HQ', 'Fast movers north, on the deck. Last push before the front clears.', 'high')
    ]
  };

  /* ---------- Shift 4: Silent Line — comms outage, broken-IFF friendlies under pressure ---------- */
  const s4 = {
    id: 'C4', name: 'Shift 4: Silent Line', duration: 480, roe: ROE.TIGHT,
    weather: { time: 'dawn', sky: 'overcast' },
    events: [
      { t: 170, kind: EV.COMMS_OUT, duration: 110, detail: 'HQ link down' },
      { t: 150, kind: EV.IFF_FAIL, duration: 50, detail: 'interrogator degraded' }
    ],
    spawns: [
      CAP(0, 'Cobra 1', -22, 8, 7800, CAP_W, 'cobra'),
      CAP(4, 'Cobra 2', -12, 0, 8200, CAP_W, 'cobra'),
      F(120, K.STRIKE_FRIEND, 'Talon 1', false, 3000, 245, { group: 'talon', iffBroken: true }),
      F(124, K.STRIKE_FRIEND, 'Talon 2', false, 2800, 240, { group: 'talon', iffBroken: true, x: 9, y: 64 }),
      H(140, K.JET_HOSTILE, 8, 62, 3500, 290, { group: 'r1', strike: true }),
      H(144, K.JET_HOSTILE, 12, 62, 3300, 290, { group: 'r1', strike: true }),
      F(200, K.STRIKE_FRIEND, 'Saber 1', true, 2000, 235, { iffBroken: true }),
      H(215, K.JET_HOSTILE, 48, 62, 2200, 290, { group: 'r2', strike: true }),
      H(240, K.DRONE, 30, 32, 700, 45, { group: 'd1', count: 6, spread: 2 }),
      H(260, K.CRUISE, 75, 60, 40, 250, { group: 'cm1' }),
      H(320, K.JET_HOSTILE, 40, 62, 8000, 260, { group: 'jam', jammer: true }),
      H(350, K.JET_HOSTILE, 15, 62, 5000, 280, { group: 'r3', strike: true }),
      H(354, K.JET_HOSTILE, 19, 62, 4800, 280, { group: 'r3', strike: true }),
      F(390, K.TRANSPORT, 'Heavy 31', true, 5000, 150)
    ],
    comms: [
      C(2, 'HQ', 'Kessel, weapons TIGHT. Strike packages returning damaged. Listen to TOWER.', 'normal'),
      C(10, 'CAP', 'Cobra flight on station, west orbit, angels 8.', 'low'),
      C(60, 'TOWER', 'Talon 1 and Talon 2, both IFF inop, egressing sector 2 via north corridor, angels 3.', 'high', true),
      C(95, 'TOWER', 'Saber 1, IFF inop, battle damage, egressing sector 1 via east corridor, angels 2.', 'high', true),
      C(130, 'HQ', 'Hostile pair chasing Talon flight down the north corridor. Separate them by speed and track.', 'high'),
      C(148, 'BATTERY', 'Interrogator fault. IFF replies unreliable for about a minute.', 'high'),
      C(165, 'HQ', 'Link to HQ failing. You are on your own. Hold TIGHT.', 'high'),
      C(290, 'HQ', 'Link restored. Report picture. Jammer and a second strike pair expected north.', 'high'),
      C(375, 'TOWER', 'Heavy 31 inbound east corridor, sector 1.', 'low'),
      C(460, 'HQ', 'Relief crew en route. Good work holding the line.', 'low')
    ]
  };

  /* ---------- Shift 5: Swarm Season — big drone swarms, ARM shooters ---------- */
  const s5 = {
    id: 'C5', name: 'Shift 5: Swarm Season', duration: 500, roe: ROE.TIGHT,
    weather: { time: 'day', sky: 'overcast' },
    roeChanges: [{ t: 200, roe: ROE.FREE }, { t: 320, roe: ROE.TIGHT }],
    events: [{ t: 380, kind: EV.LAUNCHER_JAM, duration: 25, detail: 'L3' }],
    spawns: [
      CAP(0, 'Viper 1', -18, 16, 7000, CAP_NW, 'viper'),
      H(60, K.DRONE, 25, 34, 800, 45, { group: 'd1', count: 8, spread: 2.5 }),
      H(110, K.JET_HOSTILE, 5, 62, 7500, 280, { group: 'arm1', armCarrier: true }),
      H(140, K.DRONE, 70, 34, 600, 50, { group: 'd2', count: 10, spread: 3 }),
      F(150, K.STRIKE_FRIEND, 'Lancer 1', true, 2500, 240, { iffBroken: true }),
      H(210, K.JET_HOSTILE, 35, 62, 1500, 300, { group: 'r1', strike: true }),
      H(213, K.JET_HOSTILE, 39, 62, 1400, 300, { group: 'r1', strike: true }),
      H(230, K.DRONE, 45, 34, 700, 45, { group: 'd3', count: 12, spread: 3 }),
      H(260, K.JET_HOSTILE, 55, 62, 7000, 270, { group: 'arm2', armCarrier: true }),
      H(300, K.CRUISE, 80, 60, 40, 250, { group: 'cm1' }),
      H(304, K.CRUISE, 83, 60, 40, 250, { group: 'cm1' }),
      F(340, K.TRANSPORT, 'Heavy 41', false, 5000, 150),
      H(370, K.DRONE, 15, 34, 900, 50, { group: 'd4', count: 8, spread: 2 }),
      H(410, K.JET_HOSTILE, 20, 62, 5500, 280, { group: 'r2', strike: true })
    ],
    comms: [
      C(2, 'HQ', 'Kessel, weapons TIGHT. Drone launches reported across the border. Save Lance for the jets.', 'normal'),
      C(10, 'CAP', 'Viper 1 on station north-west.', 'low'),
      C(55, 'BATTERY', 'Swarm north-north-east, eight plus. Harrow and Dart work.', 'high'),
      C(100, 'HQ', 'Shooter with anti-radiation missiles, north, high. Radar discipline: go silent if it launches.', 'high'),
      C(110, 'TOWER', 'Lancer 1, IFF inop, egressing sector 1 via east corridor, angels 2.5.', 'high', true),
      C(135, 'BATTERY', 'Second swarm east, ten plus.', 'high'),
      C(190, 'HQ', 'Weapons FREE in ten seconds. Lancer 1 is still in the east corridor. Acknowledge.', 'high', true),
      C(225, 'BATTERY', 'Third swarm north-east. Big one.', 'high'),
      C(255, 'HQ', 'Second ARM shooter north-east, high.', 'high'),
      C(312, 'HQ', 'Weapons TIGHT in ten seconds. Heavy 41 inbound north corridor.', 'high', true),
      C(365, 'BATTERY', 'Another swarm north.', 'normal'),
      C(405, 'HQ', 'Strike jet north, last of the wave.', 'high')
    ]
  };

  /* ---------- Shift 6: Red Skies — final combined raid ---------- */
  const s6 = {
    id: 'C6', name: 'Shift 6: Red Skies', duration: 540, roe: ROE.TIGHT,
    weather: { time: 'night', sky: 'overcast' },
    roeChanges: [{ t: 240, roe: ROE.FREE }, { t: 400, roe: ROE.TIGHT }],
    events: [
      { t: 0, kind: EV.NIGHT, duration: 540, detail: 'night' },
      { t: 180, kind: EV.LATE_RESUPPLY, duration: 90, detail: { lance: 4, dart: 4, harrow: 300 } },
      { t: 300, kind: EV.LAUNCHER_JAM, duration: 30, detail: 'L2' },
      { t: 330, kind: EV.COMMS_OUT, duration: 60, detail: 'HQ link jammed' }
    ],
    spawns: [
      CAP(0, 'Cobra 1', -20, 6, 8000, CAP_W, 'cobra'),
      CAP(4, 'Cobra 2', -14, 2, 7600, CAP_W, 'cobra'),
      F(40, K.TRANSPORT, 'Heavy 51', true, 5200, 150),
      H(80, K.JET_HOSTILE, 40, 62, 8200, 250, { group: 'jam1', jammer: true }),
      H(100, K.CRUISE, 70, 60, 40, 250, { group: 'cm1' }),
      H(103, K.CRUISE, 74, 60, 40, 250, { group: 'cm1' }),
      H(106, K.CRUISE, 78, 60, 40, 250, { group: 'cm1' }),
      F(130, K.STRIKE_FRIEND, 'Hammer 1', false, 3500, 240, { group: 'hammer' }),
      F(134, K.STRIKE_FRIEND, 'Hammer 2', false, 3200, 235, { group: 'hammer', iffBroken: true, x: 9, y: 64 }),
      H(150, K.JET_HOSTILE, 10, 62, 5000, 290, { group: 'r1', strike: true }),
      H(153, K.JET_HOSTILE, 14, 62, 5200, 290, { group: 'r1', strike: true }),
      H(170, K.JET_HOSTILE, 0, 62, 7500, 280, { group: 'arm1', armCarrier: true }),
      H(200, K.DRONE, 35, 34, 700, 45, { group: 'd1', count: 10, spread: 3 }),
      H(230, K.HELO_HOSTILE, 100, 26, 35, 70, { group: 'h1', popup: { hideAlt: 60, atKm: 10 } }),
      H(233, K.HELO_HOSTILE, 108, 27, 35, 70, { group: 'h1', popup: { hideAlt: 60, atKm: 10 } }),
      H(250, K.JET_HOSTILE, 45, 62, 1200, 300, { group: 'r2', strike: true }),
      H(253, K.JET_HOSTILE, 49, 62, 1000, 300, { group: 'r2', strike: true }),
      H(280, K.JET_HOSTILE, 60, 62, 7000, 270, { group: 'arm2', armCarrier: true }),
      H(310, K.DRONE, 65, 34, 600, 50, { group: 'd2', count: 12, spread: 3 }),
      H(350, K.CRUISE, 20, 60, 40, 250, { group: 'cm2' }),
      H(354, K.CRUISE, 25, 60, 40, 250, { group: 'cm2' }),
      F(420, K.STRIKE_FRIEND, 'Saber 2', true, 1800, 230, { iffBroken: true }),
      H(440, K.JET_HOSTILE, 25, 62, 4500, 290, { group: 'r3', strike: true })
    ],
    comms: [
      C(2, 'HQ', 'All batteries: major raid expected tonight. Kessel, weapons TIGHT until ordered.', 'high'),
      C(10, 'CAP', 'Cobra flight on station, west orbit.', 'low'),
      C(25, 'TOWER', 'Heavy 51 inbound east corridor, sector 1. Last flight in before the raid.', 'low'),
      C(75, 'HQ', 'Jammer up north-east. Raid is forming behind it.', 'high'),
      C(92, 'HQ', 'Cruise launches east, three missiles, very low.', 'high'),
      C(95, 'TOWER', 'Hammer 2, IFF inop, egressing sector 2 via north corridor, angels 3, with Hammer 1.', 'high', true),
      C(145, 'HQ', 'Strike pair trailing Hammer flight, sector 2.', 'high'),
      C(165, 'HQ', 'ARM shooter north, high. Radar discipline.', 'high'),
      C(175, 'BATTERY', 'Resupply truck delayed. Reserve top-up in about ninety seconds.', 'normal'),
      C(195, 'BATTERY', 'Swarm north-east, ten plus.', 'high'),
      C(228, 'HQ', 'Weapons FREE in ten seconds. Classified FRIENDs are still protected. Acknowledge.', 'high', true),
      C(245, 'HQ', 'Low strike pair north-east. Rotors south-east.', 'high'),
      C(275, 'HQ', 'Second ARM shooter east-north-east.', 'high'),
      C(305, 'BATTERY', 'Another swarm east, twelve plus. HQ link getting jammed.', 'high'),
      C(395, 'HQ', 'Link back. Weapons TIGHT in five. Saber 2 coming home soon.', 'high', true),
      C(398, 'TOWER', 'Saber 2, IFF inop, egressing sector 1 via east corridor, angels 1.8.', 'high'),
      C(435, 'HQ', 'Last strike jet north-north-east. Hold them off, Kessel.', 'high'),
      C(520, 'HQ', 'Raid is breaking up. Red skies over Varenna, but the line held.', 'normal')
    ]
  };

  /* =====================================================================
     V1.2 mission variants: each shift has A (the original) + B + C. meta picks one at random per playthrough
     (a retry after a failure keeps the same one). Same shift id for grades/medals; def.variant = 'A'|'B'|'C'.
     ===================================================================== */
  const V = (base, key, title, def) => Object.assign({ id: base.id + key, name: base.name + ' · ' + title, duration: base.duration, roe: ROE.TIGHT, reserve: base.reserve, variant: key, title }, def);

  /* ---------- Shift 1 ---------- */
  const s1b = V(s1, 'B', 'Border Patrol', {
    weather: { time: 'day', sky: 'overcast' },
    spawns: [
      CAP(0, 'Viper 1', -18, 18, 7000, CAP_NW, 'viper'),
      F(35, K.HELO_FRIEND, 'Angel 5', true, 250, 60, { x: 30, y: 22, iffBroken: true }),
      H(70, K.JET_HOSTILE, 355, 62, 7000, 250, { group: 'probe1', turnBack: 34 }),
      H(120, K.DRONE, 20, 34, 1400, 40, { group: 'recon' }),
      H(185, K.JET_HOSTILE, 30, 62, 6500, 250, { group: 'probe2', turnBack: 30 }),
      H(230, K.JET_HOSTILE, 10, 62, 5200, 265, { group: 'r1', strike: true }),
      H(275, K.DRONE, 60, 32, 700, 45, { group: 'd1', count: 2, spread: 1 }),
      H(300, K.CRUISE, 95, 58, 50, 245, { group: 'cm1' })
    ],
    comms: [
      C(2, 'HQ', 'Kessel, border patrol watch. Weapons TIGHT. The other side is probing: not everything that comes close needs a missile.', 'normal'),
      C(12, 'CAP', 'Viper 1 on station north-west.', 'low'),
      C(20, 'TOWER', 'Angel 5, medevac helicopter, IFF inop, low, sector 1 via east corridor. Do not shoot the helicopter.', 'high', true),
      C(40, 'HQ', 'Tip: select a contact and press IFF. Angel 5 will NOT answer: use the corridor and the radio call.', 'normal'),
      C(65, 'HQ', 'Fast mover north, high. Probably a probe. Track it: if it turns back at the border, let it go.', 'high'),
      C(115, 'BATTERY', 'Small slow contact north-north-east, high for a drone. Recon. Dart or Harrow when it comes close.', 'normal'),
      C(180, 'HQ', 'Second probe north-east. Same drill: watch before you shoot.', 'normal'),
      C(222, 'HQ', 'This one is not turning. Strike jet north, heading for the depot. Stop it before 6 km.', 'high'),
      C(270, 'BATTERY', 'Drone pair east-north-east.', 'normal'),
      C(292, 'HQ', 'Low-level launch east. Cruise missile, very low.', 'high'),
      C(340, 'TOWER', 'Angel 5 on the pad. Clean watch, Kessel.', 'low')
    ]
  });
  const s1c = V(s1, 'C', 'Morning Traffic', {
    weather: { time: 'dawn', sky: 'clear' },
    spawns: [
      CAP(0, 'Viper 1', -18, 18, 7000, CAP_NW, 'viper'),
      F(20, K.TRANSPORT, 'Heavy 12', true, 5200, 150),
      F(60, K.TRANSPORT, 'Heavy 13', false, 5600, 150),
      H(95, K.JET_HOSTILE, 15, 62, 6000, 255, { group: 'r1' }),
      F(110, K.TRANSPORT, 'Heavy 14', true, 4800, 150),
      H(150, K.CRUISE, 65, 58, 60, 240, { group: 'cm1' }),
      H(200, K.DRONE, 330, 30, 700, 45, { group: 'd1', count: 3, spread: 1.2 }),
      F(215, K.TRANSPORT, 'Heavy 15', false, 5200, 150),
      H(250, K.JET_HOSTILE, 25, 62, 5000, 265, { group: 'r2', strike: true }),
      H(290, K.CRUISE, 70, 58, 50, 245, { group: 'cm2' })
    ],
    comms: [
      C(2, 'HQ', 'Kessel, morning rush on the corridors. Weapons TIGHT. Lots of friendly heavies today.', 'normal'),
      C(10, 'HQ', 'Tip: tap a contact to select it, press IFF. Heavies are slow and big and they answer IFF.', 'normal'),
      C(15, 'TOWER', 'Heavy 12 inbound east corridor, sector 1.', 'low'),
      C(55, 'TOWER', 'Heavy 13 inbound north corridor, sector 2.', 'low'),
      C(90, 'HQ', 'Fast mover north-north-east, not on any flight plan. Interrogate it.', 'high'),
      C(105, 'TOWER', 'Heavy 14 inbound east corridor.', 'low'),
      C(145, 'HQ', 'Something low and fast is using the east corridor under the traffic. Cruise missile. Do not mix it up with the heavies.', 'high'),
      C(195, 'BATTERY', 'Drones north-west, three.', 'normal'),
      C(210, 'TOWER', 'Heavy 15 inbound north corridor.', 'low'),
      C(245, 'HQ', 'Strike jet north-north-east, heading for the depot.', 'high'),
      C(285, 'HQ', 'Second cruise missile, east, very low.', 'high'),
      C(345, 'TOWER', 'Corridors clear. Good first watch, Kessel.', 'low')
    ]
  });

  /* ---------- Shift 2 ---------- */
  const s2b = V(s2, 'B', 'Lights Out', {
    weather: { time: 'night', sky: 'clear' },
    events: [{ t: 0, kind: EV.NIGHT, duration: 420, detail: 'night' }],
    spawns: [
      CAP(0, 'Cobra 1', -24, 6, 8000, CAP_W, 'cobra'),
      F(50, K.HELO_FRIEND, 'Dustoff 4', true, 300, 60, { x: 30, y: 22 }),
      H(90, K.HELO_HOSTILE, 165, 24, 35, 70, { group: 'h1', popup: { hideAlt: 60, atKm: 9 } }),
      H(94, K.HELO_HOSTILE, 172, 25, 35, 70, { group: 'h1', popup: { hideAlt: 60, atKm: 9 } }),
      H(150, K.JET_HOSTILE, 20, 62, 5000, 275, { group: 'r1', strike: true }),
      H(200, K.HELO_HOSTILE, 140, 25, 30, 70, { group: 'h2', popup: { hideAlt: 60, atKm: 8 } }),
      H(203, K.HELO_HOSTILE, 147, 26, 30, 70, { group: 'h2', popup: { hideAlt: 60, atKm: 8 } }),
      H(206, K.HELO_HOSTILE, 154, 25, 30, 70, { group: 'h2', popup: { hideAlt: 60, atKm: 8 } }),
      H(260, K.CRUISE, 80, 60, 40, 250, { group: 'cm1' }),
      H(300, K.DRONE, 190, 30, 500, 45, { group: 'd1', count: 4, spread: 2 }),
      H(340, K.HELO_HOSTILE, 200, 24, 30, 75, { group: 'h3', popup: { hideAlt: 60, atKm: 8 } }),
      H(343, K.HELO_HOSTILE, 208, 25, 30, 75, { group: 'h3', popup: { hideAlt: 60, atKm: 8 } })
    ],
    comms: [
      C(2, 'HQ', 'Kessel, night watch. Weapons TIGHT. Enemy rotor units are moving in the southern valley.', 'normal'),
      C(10, 'CAP', 'Cobra 1 on station, west orbit, angels 8.', 'low'),
      C(40, 'TOWER', 'Dustoff 4, medevac helicopter, low, east corridor sector 1. Ours.', 'normal'),
      C(80, 'HQ', 'Rotor noise south, below your radar. Expect pop-ups near 9 km. Dart and Harrow.', 'high'),
      C(145, 'HQ', 'Strike jet north-north-east. Keep a Lance for it.', 'high'),
      C(195, 'HQ', 'Second helicopter group south-east, three ships, very low.', 'high'),
      C(255, 'HQ', 'Cruise missile east.', 'high'),
      C(295, 'BATTERY', 'Drones south, four.', 'normal'),
      C(335, 'HQ', 'Last rotor group south-south-west. Hold them, Kessel.', 'high'),
      C(400, 'HQ', 'Valley quiet. Dawn relief crew en route.', 'low')
    ]
  });
  const s2c = V(s2, 'C', 'Homecoming', {
    weather: { time: 'night', sky: 'clear' },
    events: [{ t: 0, kind: EV.NIGHT, duration: 420, detail: 'night' }],
    spawns: [
      CAP(0, 'Cobra 1', -24, 6, 8000, CAP_W, 'cobra'),
      F(80, K.STRIKE_FRIEND, 'Hammer 1', false, 3500, 240, { group: 'hammer' }),
      F(84, K.STRIKE_FRIEND, 'Hammer 2', false, 3300, 238, { group: 'hammer', x: 9, y: 64 }),
      F(90, K.STRIKE_FRIEND, 'Anvil 1', true, 3000, 235, { group: 'anvil' }),
      F(94, K.STRIKE_FRIEND, 'Anvil 2', true, 2800, 232, { group: 'anvil', iffBroken: true, x: 58, y: 44 }),
      H(96, K.JET_HOSTILE, 50, 62, 3000, 238, { group: 'shadow', strike: true }),
      H(160, K.JET_HOSTILE, 8, 62, 5200, 280, { group: 'r1', strike: true }),
      H(163, K.JET_HOSTILE, 12, 62, 5000, 280, { group: 'r1', strike: true }),
      H(220, K.CRUISE, 75, 60, 40, 250, { group: 'cm1' }),
      H(224, K.CRUISE, 79, 60, 40, 250, { group: 'cm1' }),
      H(280, K.HELO_HOSTILE, 115, 26, 35, 65, { group: 'h1', popup: { hideAlt: 60, atKm: 10 } }),
      H(320, K.DRONE, 30, 32, 800, 45, { group: 'd1', count: 4, spread: 2 }),
      H(350, K.JET_HOSTILE, 40, 62, 1200, 290, { group: 'r2', strike: true })
    ],
    comms: [
      C(2, 'HQ', 'Kessel, night watch. Weapons TIGHT. Two strike packages coming home at once.', 'normal'),
      C(10, 'CAP', 'Cobra 1 on station, west orbit.', 'low'),
      C(55, 'TOWER', 'Hammer flight, two ship, north corridor sector 2, angels 3. Both squawking.', 'normal'),
      C(62, 'TOWER', 'Anvil flight, two ship, east corridor sector 1, angels 3. Anvil 2 IFF inop.', 'high', true),
      C(100, 'HQ', 'Intel: a hostile may be tucked in with one of the packages. Count the ships in each flight.', 'high'),
      C(155, 'HQ', 'Strike pair north. Hammer flight is still in that corridor: check before you shoot.', 'high'),
      C(215, 'HQ', 'Cruise pair east, very low.', 'high'),
      C(275, 'HQ', 'Rotors east-south-east, low. Pop-up near 10 km.', 'high'),
      C(315, 'BATTERY', 'Drones north-east, four.', 'normal'),
      C(345, 'HQ', 'Low fast mover north-east. Hostile strike.', 'high'),
      C(400, 'TOWER', 'Hammer and Anvil flights all down safe. Thanks, Kessel.', 'low')
    ]
  });

  /* ---------- Shift 3 ---------- */
  const s3b = V(s3, 'B', 'Fog Bank', {
    weather: { time: 'dawn', sky: 'rain' },
    events: [{ t: 240, kind: EV.LAUNCHER_JAM, duration: 30, detail: 'L3' }],
    spawns: [
      CAP(0, 'Viper 1', -16, 20, 7000, CAP_NW, 'viper'),
      H(60, K.DRONE, 40, 34, 500, 45, { group: 'd1', count: 6, spread: 2 }),
      F(90, K.TRANSPORT, 'Heavy 22', true, 4800, 150),
      H(120, K.JET_HOSTILE, 15, 62, 1500, 285, { group: 'r1', strike: true }),
      H(170, K.DRONE, 80, 34, 400, 50, { group: 'd2', count: 6, spread: 2 }),
      F(190, K.STRIKE_FRIEND, 'Anvil 3', true, 1500, 230, { iffBroken: true }),
      H(230, K.CRUISE, 95, 60, 40, 250, { group: 'cm1' }),
      H(234, K.CRUISE, 99, 60, 40, 250, { group: 'cm1' }),
      H(280, K.HELO_HOSTILE, 130, 25, 30, 70, { group: 'h1', popup: { hideAlt: 60, atKm: 7 } }),
      H(320, K.DRONE, 10, 34, 450, 45, { group: 'd3', count: 8, spread: 2.5 }),
      H(360, K.JET_HOSTILE, 25, 62, 900, 300, { group: 'r2', strike: true })
    ],
    comms: [
      C(2, 'HQ', 'Kessel, fog and rain at dawn. Visibility is six kilometres: the hatch will not help you. Weapons TIGHT.', 'normal'),
      C(12, 'CAP', 'Viper 1, north-west orbit. Soup from the deck to angels 4.', 'low'),
      C(55, 'BATTERY', 'Drone group north-east, six. Rain is eating small returns: they will show late.', 'high'),
      C(80, 'TOWER', 'Heavy 22 inbound east corridor, sector 1.', 'low'),
      C(115, 'HQ', 'Low fast mover north-north-east, strike.', 'high'),
      C(150, 'TOWER', 'Anvil 3, IFF inop, egressing sector 1 via east corridor, low, angels 1.5.', 'high', true),
      C(165, 'BATTERY', 'Second drone group east, six.', 'high'),
      C(225, 'HQ', 'Cruise pair east-south-east, very low.', 'high'),
      C(235, 'BATTERY', 'L3 rail waterlogged. Crew clearing it.', 'normal'),
      C(275, 'HQ', 'Rotors south-east, hiding in the fog. Pop-up near 7 km.', 'high'),
      C(315, 'BATTERY', 'Big drone group north, eight plus.', 'high'),
      C(355, 'HQ', 'Last strike jet north-north-east, on the deck.', 'high')
    ]
  });
  const s3c = V(s3, 'C', 'Lightning Alley', {
    weather: { time: 'dusk', sky: 'rain' },
    events: [
      { t: 20, kind: EV.STORM, duration: 420, detail: 'storm cell over the site' },
      { t: 110, kind: EV.RADAR_FAULT, duration: 20, detail: 'lightning strike, radar resetting' },
      { t: 215, kind: EV.RADAR_FAULT, duration: 22, detail: 'lightning strike, radar resetting' },
      { t: 330, kind: EV.RADAR_FAULT, duration: 20, detail: 'lightning strike, radar resetting' }
    ],
    spawns: [
      CAP(0, 'Viper 1', -16, 20, 7000, CAP_NW, 'viper'),
      H(70, K.CRUISE, 70, 60, 40, 250, { group: 'cm1' }),
      H(74, K.CRUISE, 74, 60, 40, 250, { group: 'cm1' }),
      H(100, K.JET_HOSTILE, 10, 62, 5000, 270, { group: 'r1', strike: true }),
      F(140, K.TRANSPORT, 'Heavy 23', false, 5000, 150),
      H(170, K.CRUISE, 85, 60, 40, 250, { group: 'cm2' }),
      H(174, K.CRUISE, 89, 60, 40, 250, { group: 'cm2' }),
      H(190, K.JET_HOSTILE, 40, 62, 8000, 250, { group: 'jam', jammer: true }),
      F(230, K.STRIKE_FRIEND, 'Anvil 1', true, 1500, 230, { iffBroken: true }),
      H(260, K.DRONE, 50, 34, 600, 50, { group: 'd1', count: 5, spread: 2 }),
      H(290, K.CRUISE, 60, 60, 40, 250, { group: 'cm3' }),
      H(294, K.CRUISE, 64, 60, 40, 250, { group: 'cm3' }),
      H(340, K.JET_HOSTILE, 20, 62, 900, 300, { group: 'r2', strike: true })
    ],
    comms: [
      C(2, 'HQ', 'Kessel, a line of thunderstorms is sitting on your site. Expect repeated lightning dropouts. Weapons TIGHT.', 'normal'),
      C(12, 'CAP', 'Viper 1, north-west orbit.', 'low'),
      C(65, 'HQ', 'Cruise pair east. Remember: Lance goes active inside 20 km, Dart needs the radar all the way.', 'high'),
      C(95, 'HQ', 'Strike jet north.', 'high'),
      C(105, 'BATTERY', 'Lightning close. Radar may drop.', 'high'),
      C(135, 'TOWER', 'Heavy 23 inbound north corridor, sector 2.', 'low'),
      C(165, 'HQ', 'Second cruise pair east.', 'high'),
      C(185, 'HQ', 'Jammer north-east, high.', 'normal'),
      C(210, 'BATTERY', 'More lightning. Radar may drop again.', 'high'),
      C(205, 'TOWER', 'Anvil 1, IFF inop, egressing sector 1 via east corridor, angels 1.5.', 'high', true),
      C(255, 'BATTERY', 'Drones north-east, five.', 'normal'),
      C(285, 'HQ', 'Third cruise pair east-north-east.', 'high'),
      C(325, 'BATTERY', 'Strike close by. Radar dropping.', 'high'),
      C(335, 'HQ', 'Fast mover north-north-east, on the deck.', 'high')
    ]
  });

  /* ---------- Shift 4 ---------- */
  const s4b = V(s4, 'B', 'Blackout', {
    weather: { time: 'dawn', sky: 'overcast' },
    events: [{ t: 30, kind: EV.COMMS_OUT, duration: 330, detail: 'HQ link down' }],
    spawns: [
      CAP(0, 'Cobra 1', -22, 8, 7800, CAP_W, 'cobra'),
      F(70, K.STRIKE_FRIEND, 'Talon 3', false, 3000, 245, { iffBroken: true }),
      H(100, K.JET_HOSTILE, 20, 62, 3500, 285, { group: 'r1', strike: true }),
      F(130, K.TRANSPORT, 'Heavy 32', true, 5000, 150),
      H(160, K.DRONE, 45, 32, 700, 45, { group: 'd1', count: 5, spread: 2 }),
      F(190, K.STRIKE_FRIEND, 'Saber 3', true, 2000, 235, { iffBroken: true }),
      H(200, K.JET_HOSTILE, 60, 62, 2200, 290, { group: 'r2', strike: true }),
      H(250, K.CRUISE, 85, 60, 40, 250, { group: 'cm1' }),
      H(300, K.JET_HOSTILE, 5, 62, 5000, 280, { group: 'r3', strike: true }),
      H(304, K.JET_HOSTILE, 9, 62, 4800, 280, { group: 'r3', strike: true }),
      F(380, K.TRANSPORT, 'Heavy 33', false, 5000, 150)
    ],
    comms: [
      C(2, 'HQ', 'Kessel, the HQ link is failing. Before it goes: Talon 3, IFF inop, sector 2 via north corridor, and Saber 3, IFF inop, sector 1 via east corridor. Weapons TIGHT.', 'high', true),
      C(12, 'HQ', 'Heavy 32 east and Heavy 33 north are expected later. Anything else is not ours. HQ out.', 'high'),
      C(365, 'HQ', 'Link restored. Kessel, report. Heavy 33 inbound north corridor.', 'high'),
      C(460, 'HQ', 'Relief crew en route. You held it alone. Well done.', 'low')
    ]
  });
  const s4c = V(s4, 'C', 'Decoy Day', {
    weather: { time: 'day', sky: 'overcast' },
    events: [{ t: 200, kind: EV.IFF_FAIL, duration: 45, detail: 'interrogator degraded' }],
    spawns: [
      CAP(0, 'Cobra 1', -22, 8, 7800, CAP_W, 'cobra'),
      H(80, K.DRONE, 10, 62, 6000, 230, { group: 'dc1', decoy: true, rcs: 0.8 }),
      H(82, K.DRONE, 16, 62, 6200, 230, { group: 'dc1', decoy: true, rcs: 0.8 }),
      H(86, K.JET_HOSTILE, 13, 62, 5800, 280, { group: 'r1', strike: true }),
      H(150, K.DRONE, 45, 62, 5000, 230, { group: 'dc2', decoy: true, rcs: 0.8 }),
      H(152, K.DRONE, 50, 62, 5200, 230, { group: 'dc2', decoy: true, rcs: 0.8 }),
      H(155, K.DRONE, 55, 62, 5000, 230, { group: 'dc2', decoy: true, rcs: 0.8 }),
      H(158, K.JET_HOSTILE, 48, 62, 2500, 290, { group: 'r2', strike: true }),
      F(180, K.STRIKE_FRIEND, 'Saber 1', true, 2000, 235, { iffBroken: true }),
      H(240, K.CRUISE, 80, 60, 40, 250, { group: 'cm1' }),
      H(290, K.DRONE, 0, 62, 7000, 230, { group: 'dc3', decoy: true, rcs: 0.8 }),
      H(292, K.DRONE, 355, 62, 7200, 230, { group: 'dc3', decoy: true, rcs: 0.8 }),
      H(294, K.DRONE, 5, 62, 7000, 230, { group: 'dc3', decoy: true, rcs: 0.8 }),
      H(296, K.JET_HOSTILE, 2, 62, 6800, 285, { group: 'r3', strike: true }),
      H(299, K.JET_HOSTILE, 8, 62, 6600, 285, { group: 'r3', strike: true }),
      H(360, K.DRONE, 30, 32, 700, 45, { group: 'd1', count: 5, spread: 2 })
    ],
    comms: [
      C(2, 'HQ', 'Kessel, intel says the enemy is launching decoys today: small jets on a straight line that look like fighters on radar. Weapons TIGHT.', 'normal'),
      C(10, 'HQ', 'Tip: decoys fly dead straight at one speed and burn out about 12 km out. Real jets are faster and dodge when you lock them.', 'normal'),
      C(75, 'HQ', 'Three fast contacts north. At least one is real. Spend your Lances wisely.', 'high'),
      C(145, 'HQ', 'Four contacts north-east. Mix of decoys and a strike jet.', 'high'),
      C(160, 'TOWER', 'Saber 1, IFF inop, egressing sector 1 via east corridor, angels 2.', 'high', true),
      C(195, 'BATTERY', 'Interrogator fault. IFF replies unreliable for about a minute.', 'high'),
      C(235, 'HQ', 'Cruise missile east. That one is real.', 'high'),
      C(285, 'HQ', 'Big group north, five contacts. Decoys screening a strike pair.', 'high'),
      C(355, 'BATTERY', 'Drones north-east, five. Real ones this time.', 'normal'),
      C(460, 'HQ', 'Relief crew en route. Good shooting, Kessel.', 'low')
    ]
  });

  /* ---------- Shift 5 ---------- */
  const s5b = V(s5, 'B', "Hornet's Nest", {
    weather: { time: 'day', sky: 'clear' },
    reserve: { lance: 6, dart: 10, harrow: 1800 },
    roeChanges: [{ t: 150, roe: ROE.FREE }, { t: 300, roe: ROE.TIGHT }],
    spawns: [
      CAP(0, 'Viper 1', -18, 16, 7000, CAP_NW, 'viper'),
      H(60, K.DRONE, 0, 34, 700, 45, { group: 'd1', count: 6, spread: 2 }),
      H(62, K.DRONE, 120, 34, 600, 45, { group: 'd2', count: 6, spread: 2 }),
      H(64, K.DRONE, 240, 34, 700, 45, { group: 'd3', count: 6, spread: 2 }),
      H(130, K.JET_HOSTILE, 30, 62, 7000, 280, { group: 'arm1', armCarrier: true }),
      F(140, K.STRIKE_FRIEND, 'Lancer 2', true, 2500, 240, { iffBroken: true }),
      H(190, K.DRONE, 60, 34, 600, 50, { group: 'd4', count: 8, spread: 2.5 }),
      H(192, K.DRONE, 300, 34, 600, 50, { group: 'd5', count: 8, spread: 2.5 }),
      H(250, K.JET_HOSTILE, 20, 62, 1500, 300, { group: 'r1', strike: true }),
      H(320, K.DRONE, 180, 34, 700, 45, { group: 'd6', count: 10, spread: 3 }),
      H(380, K.CRUISE, 90, 60, 40, 250, { group: 'cm1' }),
      H(420, K.DRONE, 30, 34, 800, 50, { group: 'd7', count: 8, spread: 2 })
    ],
    comms: [
      C(2, 'HQ', 'Kessel, swarm launches from three directions today and the magazine is thin. Harrow is your friend. Weapons TIGHT.', 'normal'),
      C(55, 'BATTERY', 'Three swarms: north, south-east, south-west. Six each.', 'high'),
      C(125, 'HQ', 'ARM shooter north-north-east, high. Keep emissions short.', 'high'),
      C(120, 'TOWER', 'Lancer 2, IFF inop, egressing sector 1 via east corridor, angels 2.5.', 'high', true),
      C(145, 'HQ', 'Weapons FREE. Lancer 2 is still in the east corridor. Acknowledge.', 'high', true),
      C(185, 'BATTERY', 'Two more swarms, east-north-east and north-west, eight each.', 'high'),
      C(245, 'HQ', 'Strike jet north-north-east, on the deck.', 'high'),
      C(295, 'HQ', 'Weapons TIGHT in five. Acknowledge.', 'high', true),
      C(315, 'BATTERY', 'Big swarm south, ten plus.', 'high'),
      C(375, 'HQ', 'Cruise missile east.', 'high'),
      C(415, 'BATTERY', 'Last swarm north-north-east.', 'normal')
    ]
  });
  const s5c = V(s5, 'C', 'Wild Weasel', {
    weather: { time: 'dusk', sky: 'clear' },
    roeChanges: [{ t: 260, roe: ROE.FREE }, { t: 380, roe: ROE.TIGHT }],
    spawns: [
      CAP(0, 'Viper 1', -18, 16, 7000, CAP_NW, 'viper'),
      H(70, K.JET_HOSTILE, 20, 62, 6000, 260, { group: 'bait1', turnBack: 40 }),
      H(75, K.JET_HOSTILE, 10, 62, 7800, 270, { group: 'arm1', armCarrier: true }),
      H(140, K.DRONE, 50, 34, 700, 45, { group: 'd1', count: 8, spread: 2.5 }),
      H(180, K.JET_HOSTILE, 60, 62, 5500, 260, { group: 'bait2', turnBack: 38 }),
      H(185, K.JET_HOSTILE, 50, 62, 7600, 270, { group: 'arm2', armCarrier: true }),
      F(200, K.STRIKE_FRIEND, 'Lancer 1', true, 2500, 240, { iffBroken: true }),
      H(250, K.JET_HOSTILE, 30, 62, 1500, 300, { group: 'r1', strike: true }),
      H(253, K.JET_HOSTILE, 34, 62, 1400, 300, { group: 'r1', strike: true }),
      H(300, K.DRONE, 15, 34, 800, 45, { group: 'd2', count: 10, spread: 3 }),
      H(340, K.JET_HOSTILE, 0, 62, 7800, 270, { group: 'arm3', armCarrier: true }),
      H(345, K.JET_HOSTILE, 355, 62, 6000, 260, { group: 'bait3', turnBack: 38 }),
      H(420, K.JET_HOSTILE, 25, 62, 5000, 285, { group: 'r2', strike: true })
    ],
    comms: [
      C(2, 'HQ', 'Kessel, enemy Wild Weasels today: bait jets to make you transmit, ARM shooters behind them. Weapons TIGHT.', 'normal'),
      C(10, 'HQ', 'Tip: fire a Lance, wait for ACT on the scope, then go silent. The round finishes the job on its own.', 'normal'),
      C(65, 'HQ', 'Fast mover north-north-east with a high contact behind it. Classic weasel pair.', 'high'),
      C(135, 'BATTERY', 'Swarm north-east, eight.', 'high'),
      C(175, 'HQ', 'Second weasel pair north-east.', 'high'),
      C(180, 'TOWER', 'Lancer 1, IFF inop, egressing sector 1 via east corridor, angels 2.5.', 'high', true),
      C(245, 'HQ', 'Strike pair north-north-east, low. Weapons FREE in fifteen. Acknowledge.', 'high', true),
      C(295, 'BATTERY', 'Big swarm north, ten plus.', 'high'),
      C(335, 'HQ', 'Third weasel pair north.', 'high'),
      C(365, 'HQ', 'Weapons TIGHT in fifteen. Acknowledge.', 'high', true),
      C(415, 'HQ', 'Last strike jet north-north-east.', 'high')
    ]
  });

  /* ---------- Shift 6 ---------- */
  const s6b = V(s6, 'B', 'Dawn Assault', {
    weather: { time: 'dawn', sky: 'clear' },
    roeChanges: [{ t: 120, roe: ROE.FREE }, { t: 380, roe: ROE.TIGHT }],
    events: [
      { t: 200, kind: EV.LATE_RESUPPLY, duration: 90, detail: { lance: 4, dart: 6, harrow: 300 } },
      { t: 280, kind: EV.LAUNCHER_JAM, duration: 30, detail: 'L1' }
    ],
    spawns: [
      CAP(0, 'Cobra 1', -20, 6, 8000, CAP_W, 'cobra'),
      H(60, K.JET_HOSTILE, 80, 62, 8200, 250, { group: 'jam1', jammer: true }),
      H(90, K.CRUISE, 80, 60, 40, 250, { group: 'cm1' }),
      H(92, K.CRUISE, 84, 60, 40, 250, { group: 'cm1' }),
      H(94, K.CRUISE, 88, 60, 40, 250, { group: 'cm1' }),
      H(96, K.CRUISE, 92, 60, 40, 250, { group: 'cm1' }),
      H(98, K.CRUISE, 96, 60, 40, 250, { group: 'cm1' }),
      H(150, K.JET_HOSTILE, 75, 62, 1500, 300, { group: 'r1', strike: true }),
      H(153, K.JET_HOSTILE, 85, 62, 1300, 300, { group: 'r1', strike: true }),
      F(170, K.STRIKE_FRIEND, 'Hammer 3', false, 3500, 240, { iffBroken: true }),
      H(190, K.JET_HOSTILE, 70, 62, 7200, 270, { group: 'arm1', armCarrier: true }),
      H(220, K.DRONE, 95, 34, 700, 45, { group: 'd1', count: 10, spread: 3 }),
      H(250, K.HELO_HOSTILE, 110, 26, 35, 70, { group: 'h1', popup: { hideAlt: 60, atKm: 10 } }),
      H(253, K.HELO_HOSTILE, 118, 27, 35, 70, { group: 'h1', popup: { hideAlt: 60, atKm: 10 } }),
      H(300, K.CRUISE, 70, 60, 40, 250, { group: 'cm2' }),
      H(303, K.CRUISE, 75, 60, 40, 250, { group: 'cm2' }),
      H(306, K.CRUISE, 100, 60, 40, 250, { group: 'cm2' }),
      H(350, K.JET_HOSTILE, 60, 62, 5000, 290, { group: 'r2', strike: true }),
      H(353, K.JET_HOSTILE, 90, 62, 4800, 290, { group: 'r2', strike: true }),
      F(430, K.TRANSPORT, 'Heavy 52', false, 5200, 150),
      H(450, K.DRONE, 70, 34, 600, 50, { group: 'd2', count: 10, spread: 3 })
    ],
    comms: [
      C(2, 'HQ', 'All batteries: they are coming out of the sunrise, east. Kessel, weapons TIGHT until ordered.', 'high'),
      C(10, 'CAP', 'Cobra 1 on station, west orbit. Sun in our eyes over there.', 'low'),
      C(55, 'HQ', 'Jammer up east. Raid is forming behind it.', 'high'),
      C(85, 'HQ', 'Mass cruise launch east: five missiles, very low.', 'high'),
      C(115, 'HQ', 'Weapons FREE in five. Acknowledge.', 'high', true),
      C(145, 'HQ', 'Low strike pair east.', 'high'),
      C(150, 'TOWER', 'Hammer 3, IFF inop, egressing sector 2 via north corridor, angels 3. Even under FREE, not him.', 'high', true),
      C(185, 'HQ', 'ARM shooter east, high. Radar discipline.', 'high'),
      C(195, 'BATTERY', 'Resupply truck on its way. Top-up in about ninety seconds.', 'normal'),
      C(215, 'BATTERY', 'Swarm east, ten plus.', 'high'),
      C(245, 'HQ', 'Rotors east-south-east, low.', 'high'),
      C(275, 'BATTERY', 'L1 jammed. Crew on it.', 'normal'),
      C(295, 'HQ', 'Second cruise salvo east.', 'high'),
      C(345, 'HQ', 'Strike pair east, the last of the jets.', 'high'),
      C(375, 'HQ', 'Weapons TIGHT in five. Heavy 52 coming in north.', 'high', true),
      C(445, 'BATTERY', 'Late swarm east.', 'normal'),
      C(525, 'HQ', 'The sun is up and the line held. Red skies over Varenna.', 'normal')
    ]
  });
  const s6c = V(s6, 'C', 'Last Stand', {
    duration: 600,
    radarHealth: 0.55,
    weather: { time: 'night', sky: 'overcast' },
    roeChanges: [{ t: 100, roe: ROE.FREE }, { t: 520, roe: ROE.TIGHT }],
    events: [
      { t: 0, kind: EV.NIGHT, duration: 600, detail: 'night' },
      { t: 280, kind: EV.LATE_RESUPPLY, duration: 60, detail: { lance: 6, dart: 6, harrow: 600 } }
    ],
    spawns: [
      CAP(0, 'Cobra 1', -20, 6, 8000, CAP_W, 'cobra'),
      H(70, K.JET_HOSTILE, 30, 62, 8200, 250, { group: 'jam1', jammer: true }),
      H(90, K.CRUISE, 60, 60, 40, 250, { group: 'cm1' }),
      H(93, K.CRUISE, 66, 60, 40, 250, { group: 'cm1' }),
      H(110, K.JET_HOSTILE, 10, 62, 5000, 290, { group: 'r1', strike: true }),
      H(113, K.JET_HOSTILE, 16, 62, 5200, 290, { group: 'r1', strike: true }),
      H(130, K.JET_HOSTILE, 0, 62, 7500, 280, { group: 'arm1', armCarrier: true }),
      H(150, K.DRONE, 40, 34, 700, 45, { group: 'd1', count: 10, spread: 3 }),
      H(175, K.HELO_HOSTILE, 100, 26, 35, 70, { group: 'h1', popup: { hideAlt: 60, atKm: 10 } }),
      H(180, K.JET_HOSTILE, 50, 62, 1200, 300, { group: 'r2', strike: true }),
      F(250, K.STRIKE_FRIEND, 'Saber 4', true, 1800, 230, { iffBroken: true }),
      H(360, K.JET_HOSTILE, 45, 62, 8200, 250, { group: 'jam2', jammer: true }),
      H(380, K.CRUISE, 20, 60, 40, 250, { group: 'cm2' }),
      H(383, K.CRUISE, 25, 60, 40, 250, { group: 'cm2' }),
      H(386, K.CRUISE, 30, 60, 40, 250, { group: 'cm2' }),
      H(400, K.JET_HOSTILE, 60, 62, 7000, 270, { group: 'arm2', armCarrier: true }),
      H(420, K.DRONE, 70, 34, 600, 50, { group: 'd2', count: 12, spread: 3 }),
      H(440, K.JET_HOSTILE, 20, 62, 1000, 300, { group: 'r3', strike: true }),
      H(443, K.JET_HOSTILE, 26, 62, 1100, 300, { group: 'r3', strike: true }),
      H(470, K.HELO_HOSTILE, 130, 26, 35, 70, { group: 'h2', popup: { hideAlt: 60, atKm: 10 } }),
      H(473, K.HELO_HOSTILE, 138, 27, 35, 70, { group: 'h2', popup: { hideAlt: 60, atKm: 10 } }),
      H(500, K.JET_HOSTILE, 5, 62, 4500, 290, { group: 'r4', strike: true })
    ],
    comms: [
      C(2, 'HQ', 'Kessel, your radar took shrapnel last night and there is no spare. It is at half strength. Two waves are coming. Weapons TIGHT.', 'high'),
      C(12, 'BATTERY', 'Radar degraded. We can fix it, but the repair takes it off the air for about 25 seconds. Pick your moment.', 'high'),
      C(65, 'HQ', 'Jammer north-north-east. First wave behind it.', 'high'),
      C(95, 'HQ', 'Weapons FREE. Cruise pair east-north-east, strike pair north.', 'high', true),
      C(125, 'HQ', 'ARM shooter north, high.', 'high'),
      C(145, 'BATTERY', 'Swarm north-east, ten plus.', 'high'),
      C(170, 'HQ', 'Rotors east, low. Fast mover north-east on the deck.', 'high'),
      C(230, 'TOWER', 'Saber 4, IFF inop, egressing sector 1 via east corridor, angels 1.8. Even under FREE, not him.', 'high', true),
      C(260, 'HQ', 'First wave is spent. If you are going to repair the radar, now is the time.', 'high'),
      C(275, 'BATTERY', 'Resupply truck here in a minute.', 'normal'),
      C(355, 'HQ', 'Second wave forming. Jammer north-east.', 'high'),
      C(375, 'HQ', 'Cruise salvo north, three missiles.', 'high'),
      C(395, 'HQ', 'Second ARM shooter east-north-east.', 'high'),
      C(415, 'BATTERY', 'Big swarm east-north-east.', 'high'),
      C(435, 'HQ', 'Strike pair north-north-east, on the deck.', 'high'),
      C(465, 'HQ', 'Rotors south-east.', 'high'),
      C(495, 'HQ', 'Last jet north. Hold, Kessel.', 'high'),
      C(515, 'HQ', 'Weapons TIGHT in five. Acknowledge.', 'high', true),
      C(585, 'HQ', 'Both waves broken. Last stand held. Red skies over Varenna.', 'normal')
    ]
  });

  const vstory = {
    C1B: { situation: 'Border patrol. The other side is probing the line with fighters that turn back at the border, a recon drone and, eventually, one strike that does not turn. Our medevac helicopter is flying with a dead transponder.',
      notes: ['Angel 5 (east corridor, low) will NOT answer IFF.', 'Probes that turn back are not worth a missile: ammo efficiency is graded.', 'Weapons TIGHT: only HOSTILE-classified tracks can be engaged.'] },
    C1C: { situation: 'Dawn rush. Four friendly heavies use the corridors while the enemy hides a cruise missile in the traffic and sends a couple of jets and drones.',
      notes: ['Heavies are slow, big and answer IFF.', 'The cruise missile rides the east corridor very low, under the traffic.', 'Weapons TIGHT: only HOSTILE-classified tracks can be engaged.'] },
    C2B: { situation: 'Night. Enemy helicopter units come up the southern valley in waves, below your radar, popping up close. One strike jet and a cruise missile keep the north honest.',
      notes: ['Pop-ups near 8-9 km: keep Dart and Harrow ready.', 'Dustoff 4 is ours (east corridor, low, answers IFF).'] },
    C2C: { situation: 'Night. Two strike packages come home at once, one per corridor. Intel says a hostile is tucked in with one of them.',
      notes: ['Anvil 2 (east) will NOT answer IFF.', 'Count the ships: Hammer and Anvil are two-ship flights.', 'Hostile strike pair north while Hammer is still in the corridor.'] },
    C3B: { situation: 'Dawn fog and rain, six kilometres of visibility. Drone swarms use the murk and small returns show up late in the rain.',
      notes: ['Anvil 3 returns via the east corridor without IFF.', 'Rain hides small targets: drones appear late.', 'L3 will be out for a while mid-shift.'] },
    C3C: { situation: 'A thunderstorm parks over the site. Lightning knocks the radar out three times while cruise missiles keep coming.',
      notes: ['Anvil 1 returns via the east corridor without IFF.', 'Lance goes active inside 20 km (ACT) and survives a dropout; Dart does not.', 'A jammer joins mid-shift.'] },
    C4B: { situation: 'The HQ link goes down in the first minute and stays down. Two friendlies come home without IFF, two heavies are expected; everything else is hostile.',
      notes: ['Talon 3 (north) and Saber 3 (east) will NOT answer IFF.', 'Heavy 32 (east) and Heavy 33 (north) are ours.', 'No radio for most of the shift: remember this briefing.'] },
    C4C: { situation: 'Decoy day. The enemy screens real strike jets with decoys that look like fighters on radar. Every Lance wasted on a decoy is one you will not have later.',
      notes: ['Decoys fly dead straight at one speed and burn out about 12 km out.', 'Real jets are faster and dodge when locked.', 'Saber 1 returns via the east corridor without IFF.'] },
    C5B: { situation: "Hornet's nest. Swarms from three directions at once, a thin magazine and a short weapons FREE window.",
      notes: ['Only 6 Lance in reserve: Harrow and Dart for the swarms.', 'Lancer 2 flies the east corridor without IFF, even during FREE.', 'One ARM shooter north-north-east.'] },
    C5C: { situation: 'Wild Weasels. Bait jets fly in to make you transmit while ARM shooters wait behind them. Timing your emissions is everything.',
      notes: ['Fire a Lance, wait for ACT, then go silent.', 'Bait jets turn back around 40 km.', 'Lancer 1 flies the east corridor without IFF.'] },
    C6B: { situation: 'The raid comes out of the sunrise, all from the east: a five-missile cruise salvo, strike jets, rotors, swarms and an ARM shooter, with a long FREE window.',
      notes: ['Hammer 3 (north) is without IFF, even under FREE.', 'A late resupply tops up the reserve.', 'L1 will jam for a while.'] },
    C6C: { situation: 'Last stand. Your radar starts damaged at half strength and two big waves are coming over a longer watch. Fit a repair in between them.',
      notes: ['Radar at 55%: shorter detection range until repaired.', 'Repair takes ~25 s off the air: HQ will tell you when the first wave is spent.', 'Saber 4 (east) is without IFF, even under FREE.'] }
  };

  const story = [
    { situation: 'Your first watch at battery Kessel on the Varenna border. HQ expects light probing: a single fighter, a few drones, maybe a cruise missile. HQ will coach you on the radio.',
      notes: ['Select a contact, press IFF, then classify it.', 'Weapons TIGHT: only HOSTILE-classified tracks can be engaged.', 'Friendly traffic is always announced on the radio.'] },
    { situation: 'Night watch. A strike package returns along the north corridor, and one jet has lost its transponder. Hostile helicopters and cruise missiles use the dark.',
      notes: ['Hammer 2 will NOT answer IFF: check the north corridor.', 'Helicopters pop up near 10 km: keep Dart ready.'] },
    { situation: 'A storm front crosses the sector. Expect clutter, a jammer, a radar dropout from lightning and a fouled launcher, while the enemy hides in the weather.',
      notes: ['Anvil 1 returns via the east corridor without IFF.', 'If the radar drops, missiles in midcourse lose guidance. Lance goes active inside 20 km (ACT on the scope): after that it needs no radar. Dart needs the radar all the way.'] },
    { situation: 'Damaged strike jets are coming home without IFF, with hostiles on their tail. Mid-shift the HQ link goes down and the interrogator fails.',
      notes: ['Talon 1, Talon 2 (north) and Saber 1 (east) will not answer IFF.', 'During the outage there is no radio: remember the briefing.'] },
    { situation: 'Swarm season. Large drone swarms saturate the scope while anti-radiation missile shooters wait for your radar to stay on too long. HQ will open a weapons FREE window.',
      notes: ['Save Lance for the jets: Harrow and Dart for drones.', 'An ARM inbound means go silent: radar OFF.', 'Lancer 1 flies the east corridor without IFF, even during FREE.'] },
    { situation: 'The big one. A combined night raid: jammers, cruise missiles, ARM shooters, swarms, pop-up helicopters and strike jets, with friendlies still coming home.',
      notes: ['Hammer 2 and Saber 2 are without IFF.', 'A late resupply tops up the reserve mid-shift.', 'The HQ link will be jammed for a minute.'] }
  ];

  /* ---------- grading ---------- */
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const HARROW_BURST = 40;
  /** Grade a finished shift. stats = SHIFT_END.stats (state.stats), state = RS.sim.state (needs .asset.hp). */
  function grade(stats, state) {
    const st = stats || {}, f = st.fired || {};
    const hp = clamp(state && state.asset && typeof state.asset.hp === 'number' ? state.asset.hp : 1, 0, 1);
    const kills = st.kills || 0, leakers = st.leakers || 0;
    const shots = (f.lance || 0) + (f.dart || 0) + (f.harrow || 0) / HARROW_BURST;   // Harrow counted in bursts
    const rt = (st.reactionTimes || []).filter(v => typeof v === 'number' && isFinite(v));
    const parts = {
      asset: Math.round(hp * 100),
      leakers: Math.round(clamp(100 - 25 * leakers, 0, 100)),
      ammo: shots > 0 ? Math.round(clamp(kills / shots / 0.75, 0, 1) * 100) : (kills > 0 ? 100 : 50),
      reaction: rt.length ? Math.round(clamp((90 - rt.reduce((a, b) => a + b, 0) / rt.length) / 75, 0, 1) * 100) : 50
    };
    const meanRt = rt.length ? rt.reduce((a, b) => a + b, 0) / rt.length : null;
    const score = Math.round(0.4 * parts.asset + 0.2 * parts.leakers + 0.2 * parts.ammo + 0.2 * parts.reaction);
    if (st.fratricide) return { grade: 'F', failed: true, score: 0, reason: 'Fratricide: a friendly aircraft was shot down', parts, meanRt };
    if (hp <= 0) return { grade: 'F', failed: true, score: 0, reason: 'Defended asset destroyed', parts, meanRt };
    const g = score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : score >= 40 ? 'D' : 'F';
    const reason = g === 'F' ? 'Score too low: the defence did not hold' : g === 'A' ? 'Outstanding watch' : g === 'B' ? 'Solid watch' : g === 'C' ? 'The line held, just' : 'Barely passable';
    return { grade: g, failed: g === 'F', score, reason, parts, meanRt };
  }

  RS.campaign = {
    shifts: [s1, s2, s3, s4, s5, s6], story,
    /** V1.2: variants[i] = [{key, title, def, story}] — A is the original shift. */
    variants: [[s1, s1b, s1c], [s2, s2b, s2c], [s3, s3b, s3c], [s4, s4b, s4c], [s5, s5b, s5c], [s6, s6b, s6c]].map((vs, i) =>
      vs.map((d, j) => ({ key: 'ABC'[j], title: j ? d.title : d.name.replace(/^Shift \d+:\s*/, ''), def: d, story: j ? vstory[d.id] : story[i] }))),
    budget: [0, 260, 300, 340, 400, 460],
    bonus: { A: 80, B: 40 },
    prices: { lance: 30, dart: 12, harrow: 15 },     // lance/dart per missile, harrow per 100 rounds
    step: { lance: 1, dart: 1, harrow: 100 },
    max: { lance: 24, dart: 24, harrow: 3000 },
    grade, corridors: { east: RTB_EAST, north: RTB_NORTH }
  };
})();
