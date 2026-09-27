/* =====================================================================
   RED SKIES — models.js   RS.models v0 (placeholder primitives)
   Units metres. Origin ground centre (aircraft: centre of mass). +Z forward, +Y up.
   A future model-lab file replaces this file only; keep the API identical.
   ===================================================================== */
(function () {
  const RS = window.RS;
  const mats = {};
  const mat = c => mats[c] || (mats[c] = new THREE.MeshLambertMaterial({ color: c }));

  // part(geometry, colour, [x,y,z], [rx,ry,rz]) → Mesh added to parent
  function part(parent, geo, c, p, r) {
    const m = new THREE.Mesh(geo, mat(c));
    if (p) m.position.set(p[0], p[1], p[2]);
    if (r) m.rotation.set(r[0], r[1], r[2]);
    parent.add(m);
    return m;
  }
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const cyl = (rt, rb, h, s) => new THREE.CylinderGeometry(rt, rb, h, s || 8);
  const cone = (r, h, s) => new THREE.ConeGeometry(r, h, s || 8);
  const X90 = [Math.PI / 2, 0, 0];

  function truck(g, body, len) {
    part(g, box(2.5, 0.9, len), 0x2b2f24, [0, 1.0, 0]);                    // chassis
    part(g, box(2.5, 1.7, 2.0), body, [0, 1.9, len / 2 - 1.0]);             // cab
    part(g, box(2.3, 0.5, 0.1), 0x0d1a1f, [0, 2.3, len / 2 + 0.01]);        // windscreen
    for (let i = 0; i < 3; i++) part(g, cyl(0.55, 0.55, 2.7, 10), 0x111111, [0, 0.55, len / 2 - 1.3 - i * (len - 2.2) / 2], [0, 0, Math.PI / 2]);
  }

  function launcher(kind) {
    const g = new THREE.Group();
    const lance = kind === 'launcher_lance', body = lance ? 0x4a5236 : 0x55553a;
    truck(g, body, lance ? 8 : 7);
    const pivot = new THREE.Group();
    pivot.position.set(0, 1.6, lance ? -3.4 : -3);
    pivot.rotation.x = -0.6;                                                  // elevate rack toward +Z/up
    g.add(pivot);
    const rails = [];
    const n = 4, len = lance ? 6 : 4.2;
    for (let i = 0; i < n; i++) {
      const x = (i % 2 - 0.5) * (lance ? 0.8 : 1.3), y = Math.floor(i / 2) * (lance ? 0.8 : 0.0) + 0.5;
      if (lance) part(pivot, box(0.7, 0.7, len), body, [x, y, len / 2]);     // canister
      else {
        part(pivot, box(0.15, 0.15, len), 0x333333, [x, y, len / 2]);        // rail
        part(pivot, cyl(0.12, 0.12, 3, 6), 0xd8d8cc, [x, y + 0.2, len / 2], X90);
      }
      const r = new THREE.Object3D(); r.position.set(x, y, len); pivot.add(r); rails.push(r);
    }
    part(pivot, box(lance ? 1.8 : 3, 0.3, 1), 0x2b2f24, [0, 0.1, 0.6]);
    g.userData.rails = rails; g.userData.elevator = pivot;
    return g;
  }

  function gun() {
    const g = new THREE.Group();
    part(g, cyl(1.8, 2.1, 0.6, 10), 0x3d4230, [0, 0.3, 0]);
    const turret = new THREE.Group(); turret.position.y = 0.6; g.add(turret);
    part(g, box(3.6, 0.35, 0.5), 0x2b2f24, [0, 0.18, 0]); part(g, box(0.5, 0.35, 3.6), 0x2b2f24, [0, 0.19, 0]);   // outrigger feet
    part(turret, box(1.8, 1.4, 2.2), 0x4a5236, [0, 0.7, 0]);
    part(turret, box(1.1, 0.5, 1.0), 0x3d4230, [0, 1.62, -0.4]);                // sight/radar housing
    part(turret, box(0.35, 0.9, 1.4), 0x3d4230, [1.0, 0.75, -0.2]);            // ammo drum
    const barrels = new THREE.Group(); barrels.position.set(0, 1.0, 0.8); barrels.rotation.x = -0.5; turret.add(barrels);
    for (const x of [-0.45, 0.45]) part(barrels, cyl(0.09, 0.12, 3.6, 6), 0x222222, [x, 0, 1.8], X90);
    const rail = new THREE.Object3D(); rail.position.set(0, 0, 3.6); barrels.add(rail);
    g.userData.rails = [rail]; g.userData.turret = turret; g.userData.elevator = barrels;
    return g;
  }

  function missile(len, rad, c, finSpan) {
    const g = new THREE.Group();
    part(g, cyl(rad, rad, len * 0.8, 8), c, [0, 0, -len * 0.05], X90);
    part(g, cone(rad, len * 0.2, 8), c, [0, 0, len * 0.45], X90);
    part(g, box(finSpan, 0.03, len * 0.12), 0x444444, [0, 0, -len * 0.38]);
    part(g, box(0.03, finSpan, len * 0.12), 0x444444, [0, 0, -len * 0.38]);
    return g;
  }

  function jet(c, hostile) {
    const g = new THREE.Group();
    part(g, cyl(0.6, 0.9, 11, 8), c, [0, 0, -0.5], X90);
    part(g, cone(0.6, 3.5, 8), c, [0, 0, 6.7], X90);
    part(g, box(0.8, 0.5, 2.2), 0x1c2a33, [0, 0.7, 3.2]);                   // canopy
    part(g, box(hostile ? 11 : 10, 0.18, hostile ? 4.5 : 3.2), c, [0, -0.1, -1.0]);
    part(g, box(4.5, 0.12, 1.6), c, [0, 0, -5.2]);                            // tailplane
    part(g, box(0.15, 2.6, 2.2), c, [0, 1.5, -5.0]);                         // fin
    if (hostile) part(g, box(3, 0.1, 0.8), 0x7a2a22, [0, 0.1, 3.5]);         // canards
    return g;
  }

  function helo() {
    const g = new THREE.Group();
    part(g, box(1.4, 1.8, 4.5), 0x4b5138, [0, 0, 1]);
    part(g, box(0.9, 0.6, 1.4), 0x1c2a33, [0, 0.4, 3.2]);
    part(g, cyl(0.25, 0.4, 7, 6), 0x4b5138, [0, 0.3, -4.5], X90);
    part(g, box(0.15, 1.6, 0.8), 0x4b5138, [0, 1.0, -7.8]);
    part(g, box(3.5, 0.12, 0.8), 0x3a3e2c, [0, -0.3, 0.8]);                  // stub wings
    const rotor = new THREE.Group(); rotor.name = 'rotor'; rotor.position.y = 1.2; g.add(rotor);
    part(rotor, box(12, 0.06, 0.4), 0x222222);
    part(rotor, box(0.4, 0.06, 12), 0x222222);
    g.userData.rotor = rotor;
    return g;
  }

  function drone() {
    const g = new THREE.Group();
    part(g, box(0.3, 0.3, 1.8), 0x6a6a5a);
    part(g, box(2.4, 0.05, 0.4), 0x6a6a5a, [0, 0.1, 0.1]);
    part(g, box(0.9, 0.05, 0.25), 0x6a6a5a, [0, 0.1, -0.8]);
    const prop = part(g, box(0.7, 0.05, 0.08), 0x111111, [0, 0, -0.95]); prop.name = 'rotor';
    g.userData.rotor = prop;
    return g;
  }

  function tree() {
    const g = new THREE.Group();
    part(g, cyl(0.2, 0.3, 2.2, 5), 0x3b2c1e, [0, 1.1, 0]);
    part(g, cone(2.0, 6.5, 6), 0x2c4026, [0, 5.0, 0]);
    return g;
  }

  // transport: high-wing four-engine airlifter placeholder (~30 m)
  function transport() {
    const g = new THREE.Group(), c = 0x6f7a72;
    part(g, cyl(1.9, 1.9, 22, 10), c, [0, 0, 0], X90);
    part(g, cone(1.9, 4, 10), c, [0, 0, 13], X90);
    part(g, cyl(0.6, 1.9, 7, 10), c, [0, 0.9, -14.2], X90);
    part(g, box(2.2, 0.6, 1.8), 0x1c2a33, [0, 1.35, 12.2]);
    part(g, box(36, 0.45, 4.2), c, [0, 1.9, 0.5]);
    for (const x of [-11, -5.5, 5.5, 11]) part(g, cyl(0.55, 0.6, 3.6, 8), 0x4a524c, [x, 1.2, 2.2], X90);
    part(g, box(11, 0.25, 3), c, [0, 1.6, -16.2]);
    part(g, box(0.35, 5.5, 4.2), c, [0, 4.2, -16]);
    return g;
  }

  // radar vehicle: 6x6 truck + mast + rotating planar array (userData.dish spins)
  function radarVehicle() {
    const g = new THREE.Group();
    truck(g, 0x4a5236, 9);
    part(g, box(2.5, 2.2, 5.2), 0x434a31, [0, 2.55, -1.6]);                // equipment shelter
    part(g, cyl(0.28, 0.42, 7, 8), 0x3d4230, [0, 7.1, -2.4]);              // mast
    const dish = new THREE.Group(); dish.position.set(0, 10.8, -2.4); g.add(dish);
    part(dish, box(6.2, 2.4, 0.35), 0x6b705a, [0, 0, 0.3]);
    part(dish, box(6.4, 0.12, 0.5), 0x2f3326, [0, 1.25, 0.3]);
    part(dish, box(0.5, 0.5, 1.2), 0x2a2a2a, [0, -0.2, -0.5]);
    g.userData.dish = dish;
    return g;
  }

  function debris() {
    const g = new THREE.Group();
    for (let i = 0; i < 6; i++) part(g, box(0.5 + i * 0.2, 0.3, 0.6 + (i % 3) * 0.4), i % 2 ? 0x1a1a1a : 0x3a342c,
      [Math.sin(i * 2.1) * 2, 0.15, Math.cos(i * 1.7) * 2], [0, i, 0]);
    return g;
  }

  // Fire-control shelter interior. Camera sits at about (0, 1.3, -0.4) looking +Z out of the hatch.
  function shelter() {
    const g = new THREE.Group();
    const W = 3, H = 2.4, D = 3, wall = 0x262a22, dark = 0x15170f, trim = 0x3a3f30;
    const hw = 1.62, hb = 0.96, ht = 2.22, fz = 0.9;   // hatch w/bottom/top/front z: sized so only a thin frame shows at camera pitch 10°
    part(g, box(W, 0.1, D), dark, [0, 0, 0]);                                // floor
    part(g, box(W, 0.1, D), dark, [0, H, 0]);                                // ceiling
    part(g, box(0.1, H, D), wall, [-W / 2, H / 2, 0]);
    part(g, box(0.1, H, D), wall, [W / 2, H / 2, 0]);
    part(g, box(W, H, 0.1), wall, [0, H / 2, -D / 2]);
    // front wall around the hatch opening
    part(g, box(W, hb, 0.12), wall, [0, hb / 2, fz]);
    part(g, box(W, H - ht, 0.12), wall, [0, (H + ht) / 2, fz]);
    part(g, box((W - hw) / 2, ht - hb, 0.12), wall, [-(W + hw) / 4, (hb + ht) / 2, fz]);
    part(g, box((W - hw) / 2, ht - hb, 0.12), wall, [(W + hw) / 4, (hb + ht) / 2, fz]);
    // hatch frame lip + hinged cover
    // No coplanar faces anywhere (they z-fight and shimmer as the camera sways): each trim piece stands
    // ~2.5 cm proud of the wall opening with its back half buried in the wall; posts are shallower than lips.
    part(g, box(hw + 0.1, 0.05, 0.14), trim, [0, hb + 0.01, fz]);
    part(g, box(hw + 0.1, 0.05, 0.14), trim, [0, ht - 0.01, fz]);
    part(g, box(0.05, ht - hb, 0.13), trim, [-hw / 2 + 0.01, (hb + ht) / 2, fz]);
    part(g, box(0.05, ht - hb, 0.13), trim, [hw / 2 - 0.01, (hb + ht) / 2, fz]);
    // desk ledge under the hatch
    part(g, box(W - 0.2, 0.06, 0.6), 0x1d2018, [0, 0.8, fz - 0.35]);
    return g;
  }

  const builders = {
    shelter_interior: shelter,
    launcher_lance: () => launcher('launcher_lance'),
    launcher_dart: () => launcher('launcher_dart'),
    gun_harrow: gun,
    missile_lance: () => missile(5.2, 0.22, 0xd9d9cc, 0.9),
    missile_dart: () => missile(3.0, 0.12, 0xe0e0d0, 0.5),
    jet_friend: () => jet(0x7d8a96, false),
    jet_hostile: () => jet(0x8a7a62, true),
    helo_attack: helo,
    cruise_missile: () => { const g = missile(6, 0.28, 0x9a9a8a, 0.4); part(g, box(2.6, 0.05, 0.5), 0x777766, [0, 0, 0]); return g; },
    drone,
    arm_missile: () => missile(4.2, 0.13, 0xcfcfc0, 0.6),
    tree,
    debris,
    transport,
    radar_vehicle: radarVehicle
  };

  RS.models = {
    version: 'v0-placeholder',
    kinds: ['shelter_interior', 'launcher_lance', 'launcher_dart', 'gun_harrow', 'missile_lance', 'missile_dart',
      'jet_friend', 'jet_hostile', 'helo_attack', 'cruise_missile', 'drone', 'arm_missile', 'tree', 'debris',
      'transport', 'radar_vehicle'],
    // placeholder builders stay reachable after the vendor modules wrap create()
    placeholder(kind, opts) {
      const b = builders[kind];
      if (!b) throw new Error('RS.models: unknown kind ' + kind);
      const o = b(opts || {});
      o.name = kind;
      return o;
    },
    // end of the vendor wrapper chain: ModelParts (jet_friend.js, loaded later) first, then placeholders
    create(kind, opts) {
      opts = opts || {};
      const MP = window.ModelParts;
      if (!opts.placeholder && MP && typeof MP[kind] === 'function') {
        try { const o = MP[kind](opts); if (o) { o.name = o.name || kind; return o; } } catch (e) { console.warn('RS.models: ' + kind + ' vendor build failed, using placeholder', e); }
      }
      return RS.models.placeholder(kind, opts);
    }
  };
  // Models bridge: vendor modules loaded right after this file wrap Models.create in place (see contracts.js)
  window.Models = RS.models;
})();
