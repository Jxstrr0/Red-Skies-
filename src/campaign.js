/* =====================================================================
   RED SKIES — campaign.js   RS.campaign : the Kessel campaign (6 shifts) + grading.
   ---------------------------------------------------------------------
   RS.campaign = {
     shifts:  ShiftDef[6]        (see content.js JSDoc; only contract fields are used)
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

  const story = [
    { situation: 'Your first watch at battery Kessel on the Varenna border. HQ expects light probing: a single fighter, a few drones, maybe a cruise missile. HQ will coach you on the radio.',
      notes: ['Select a contact, press IFF, then classify it.', 'Weapons TIGHT: only HOSTILE-classified tracks can be engaged.', 'Friendly traffic is always announced on the radio.'] },
    { situation: 'Night watch. A strike package returns along the north corridor, and one jet has lost its transponder. Hostile helicopters and cruise missiles use the dark.',
      notes: ['Hammer 2 will NOT answer IFF: check the north corridor.', 'Helicopters pop up near 10 km: keep Dart ready.'] },
    { situation: 'A storm front crosses the sector. Expect clutter, a jammer, a radar dropout from lightning and a fouled launcher, while the enemy hides in the weather.',
      notes: ['Anvil 1 returns via the east corridor without IFF.', 'If the radar drops, missiles in midcourse lose guidance.'] },
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
    budget: [0, 260, 300, 340, 400, 460],
    bonus: { A: 80, B: 40 },
    prices: { lance: 30, dart: 12, harrow: 15 },     // lance/dart per missile, harrow per 100 rounds
    step: { lance: 1, dart: 1, harrow: 100 },
    max: { lance: 24, dart: 24, harrow: 3000 },
    grade, corridors: { east: RTB_EAST, north: RTB_NORTH }
  };
})();
