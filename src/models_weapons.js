/* ============================================================================
 * models_weapons.js — Red Skies / Weapons Hold · air-launched weapons
 * Prairie Blue Studio · procedural, no textures, three.js r128+
 *
 * Fictional, generic Western-style modern weapons (not copies of real types):
 *   aam_long        "Spire"     long-range radar-guided air-to-air missile   3.66 m
 *   aam_short       "Needle"    short-range heat-seeking air-to-air missile  2.90 m
 *   agm_arm         "Ember"     anti-radiation missile (homes on radar)      4.10 m
 *   agm_light       "Hatchet"   light laser/IR-guided air-to-ground missile  1.80 m
 *   glide_bomb      "Kite"      small winged glide bomb                      1.80 m
 *   cruise_missile  "Farstrike" low-observable turbojet cruise missile       5.10 m
 *   arm_missile     alias of agm_arm (kind name from the build plan)
 *
 * Models.create(kind, opts) → THREE.Group, nose +Z, 1 unit = 1 m, origin at the
 *   body centreline, mid-length.  opts: { flight: true (default) | false, lod }
 *   flight:true  → fins/wings deployed, motor plume on (rockets), cruise intake out
 *   flight:false → carried configuration (folded wings, no plume)
 * userData: kind, name, role, guidance, length, diameter, smoke (Object3D at the
 *   tail — attach trails here), setMotor(on), update(dt)
 *
 * For airframe builders: RSWeapons.parts(kind, {flight, lod}) returns
 *   [{ geometry, material }] in the same local frame (cached; do not dispose).
 *   RSWeapons.info[kind].r is the body radius (lugs sit at y = +r).
 *   RSWeapons.rackParts('agm_light' | 'glide_bomb') → multi-carriage rack + rounds,
 *   origin at the rack's top attach point.
 *
 * Load order: before models_jets.js (the jets use it when present).
 * ==========================================================================*/
(function () {
  'use strict';
  const THREE = window.THREE;
  if (!THREE) { console.error('models_weapons.js: THREE not found'); return; }
  const V3 = THREE.Vector3, M4 = THREE.Matrix4, PI = Math.PI;

  /* ------------------------------------------------------------- materials */
  const D = THREE.DoubleSide;
  const MAT = {};
  function mat(n) {
    if (MAT[n]) return MAT[n];
    const S = (c, r, m) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m, side: D });
    const defs = {
      body:    () => S(0xb4b9bd, 0.55, 0.15),   // light gull grey
      bodyD:   () => S(0x7d858b, 0.6, 0.15),    // medium grey (ARM, cruise)
      radome:  () => S(0xd8d5ca, 0.45, 0.02),   // off-white radome
      radomeD: () => S(0x3f4448, 0.5, 0.05),    // dark radome
      yellow:  () => S(0xd4ad1e, 0.55, 0.05),   // live warhead band
      brown:   () => S(0x6e4726, 0.6, 0.05),    // rocket motor band
      black:   () => S(0x161718, 0.6, 0.1),
      stencil: () => S(0x2a2c2e, 0.7, 0.05),
      metal:   () => S(0x6d6a66, 0.35, 0.8),
      burnt:   () => S(0x2e2a27, 0.5, 0.6),
      glass:   () => new THREE.MeshStandardMaterial({ color: 0x2b3f4d, roughness: 0.03, metalness: 0.95, side: D }),
      gold:    () => new THREE.MeshStandardMaterial({ color: 0x8a6d25, roughness: 0.06, metalness: 1.0, side: D }),
      rack:    () => S(0x5c6258, 0.75, 0.2),
      plumeO:  () => new THREE.MeshBasicMaterial({ color: 0xff7a22, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, side: D }),
      plumeI:  () => new THREE.MeshBasicMaterial({ color: 0xfff4d6, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: D }),
      heat:    () => new THREE.MeshBasicMaterial({ color: 0xa04818, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: D })
    };
    return (MAT[n] = defs[n]());
  }

  /* ------------------------------------------------------------ geometry kit */
  const T = (x, y, z) => new M4().makeTranslation(x, y, z);
  const R = (x, y, z) => new M4().makeRotationFromEuler(new THREE.Euler(x, y, z));

  function loft(rings, o) {
    o = o || {};
    const N = rings[0].length, pos = [], idx = [];
    rings.forEach(r => r.forEach(p => pos.push(p.x, p.y, p.z)));
    for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < N; j++) {
      const a = i * N + j, b = i * N + (j + 1) % N, c = (i + 1) * N + j, d = (i + 1) * N + (j + 1) % N;
      idx.push(a, b, c, b, d, c);
    }
    const cap = (ri, rev) => {
      const r = rings[ri], cen = new V3(); r.forEach(p => cen.add(p)); cen.divideScalar(N);
      const ci = pos.length / 3; pos.push(cen.x, cen.y, cen.z);
      for (let j = 0; j < N; j++) { const a = ri * N + j, b = ri * N + (j + 1) % N; rev ? idx.push(ci, a, b) : idx.push(ci, b, a); }
    };
    if (o.capStart !== false) cap(0, false);
    if (o.capEnd !== false) cap(rings.length - 1, true);
    let g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    // outward winding by signed volume
    let v = 0; const A = new V3(), B = new V3(), C = new V3(), P = g.attributes.position;
    for (let i = 0; i < idx.length; i += 3) { A.fromBufferAttribute(P, idx[i]); B.fromBufferAttribute(P, idx[i + 1]); C.fromBufferAttribute(P, idx[i + 2]); v += A.dot(B.cross(C)); }
    if (v < 0) for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
    g.setIndex(idx);
    if (o.flat) g = g.toNonIndexed();
    g.computeVertexNormals();
    return g;
  }
  // Lathe along +Z: profile [[r, z], ...] from tail to nose
  function lathe(profile, segs) {
    const g = new THREE.LatheGeometry(profile.map(p => new THREE.Vector2(Math.max(p[0], 0.0004), p[1])), segs);
    g.rotateX(PI / 2);
    return g;
  }
  // Tangent-ogive nose from z0 (radius R) to tip at z1, n samples
  function ogive(R0, z0, z1, n, blunt) {
    const L = z1 - z0, rho = (R0 * R0 + L * L) / (2 * R0), pts = [];
    for (let i = 0; i <= n; i++) {
      const x = i / n * L;
      const y = Math.sqrt(rho * rho - x * x) + R0 - rho;
      pts.push([Math.max(y, blunt || 0.001), z0 + x]);
    }
    return pts;
  }
  // Thin fin, flat-shaded. Span along +Y from the body surface; chord along -Z from LE.
  function finGeom(c0, c1, span, sweep, t) {
    const sec = (y, zLE, c, th) => [[0, zLE], [th / 2, zLE - c * 0.22], [th / 2, zLE - c * 0.8], [0, zLE - c], [-th / 2, zLE - c * 0.8], [-th / 2, zLE - c * 0.22]]
      .map(p => new V3(p[0], y, p[1]));
    return loft([sec(0, 0, c0, t), sec(span, -sweep, c1, t * 0.7)], { flat: true });
  }
  function box(w, h, l) { return new THREE.BoxGeometry(w, h, l); }
  function cylZ(r0, r1, len, segs, open) { const g = new THREE.CylinderGeometry(r1, r0, len, segs, 1, !!open); g.rotateX(PI / 2); return g; }

  // Collects geometry per material with a transform stack; merges on build.
  class Kit {
    constructor(segs) { this.b = new Map(); this.m = new M4(); this.segs = segs; }
    add(geom, material, local) {
      let g = geom.index ? geom.toNonIndexed() : geom.clone();
      if (!g.attributes.normal) g.computeVertexNormals();
      Object.keys(g.attributes).forEach(k => { if (k !== 'position' && k !== 'normal') g.deleteAttribute(k); });
      g.applyMatrix4(local ? this.m.clone().multiply(local) : this.m);
      if (!this.b.has(material)) this.b.set(material, []);
      this.b.get(material).push(g);
    }
    with(local, fn) { const o = this.m; this.m = o.clone().multiply(local); fn(); this.m = o; }
    parts() {
      const out = [];
      this.b.forEach((list, material) => {
        let n = 0; list.forEach(g => n += g.attributes.position.count);
        const P = new Float32Array(n * 3), N = new Float32Array(n * 3); let o = 0;
        list.forEach(g => { P.set(g.attributes.position.array, o); N.set(g.attributes.normal.array, o); o += g.attributes.position.count * 3; });
        const bg = new THREE.BufferGeometry();
        bg.setAttribute('position', new THREE.BufferAttribute(P, 3));
        bg.setAttribute('normal', new THREE.BufferAttribute(N, 3));
        bg.computeBoundingSphere();
        out.push({ geometry: bg, material });
      });
      return out;
    }
  }
  // Cruciform fins around the body at radius r; X-configuration by default
  function fins(k, r, zLE, c0, c1, span, sweep, t, material, offset) {
    for (let i = 0; i < 4; i++) {
      const a = (offset === undefined ? PI / 4 : offset) + i * PI / 2;
      k.add(finGeom(c0, c1, span, sweep, t), material, R(0, 0, a - PI / 2).multiply(T(0, r * 0.96, zLE)));
    }
  }
  // Band: short cylinder slightly proud of the body
  function band(k, r, z0, z1, material) { k.add(cylZ(r * 1.012, r * 1.012, z1 - z0, k.segs, true), material, T(0, 0, (z0 + z1) / 2)); }
  // Stencil block: tiny dark "text" strips on the body at angle a
  function stencil(k, r, z, a, lines) {
    for (let i = 0; i < lines; i++) k.add(box(0.004, 0.012, 0.16 - i * 0.04), mat('stencil'), R(0, 0, a).multiply(T(0, r * 1.004, z - i * 0.03)).multiply(R(0, 0, PI / 2)));
  }
  // Suspension lugs + umbilical raceway on top
  function lugs(k, r, zs, raceway) {
    zs.forEach(z => k.add(box(0.035, 0.03, 0.05), mat('metal'), T(0, r + 0.012, z)));
    if (raceway) k.add(box(0.03, 0.022, raceway[1] - raceway[0]), mat(raceway[2] || 'body'), T(0, r + 0.006, (raceway[0] + raceway[1]) / 2));
  }
  // Rocket nozzle at the tail
  function nozzle(k, r, z, len) {
    k.add(lathe([[r * 0.78, z - len], [r * 0.86, z - len * 0.5], [r * 0.95, z]], k.segs), mat('burnt'));
    k.add(new THREE.CircleGeometry(r * 0.72, k.segs), mat('black'), T(0, 0, z - len * 0.6).multiply(R(0, PI, 0)));
  }

  /* --------------------------------------------------------------- designs */
  const INFO = {
    aam_long:       { name: 'Spire',     role: 'Long-range air-to-air missile',    guidance: 'Active radar', length: 3.66, r: 0.089, motor: 'rocket' },
    aam_short:      { name: 'Needle',    role: 'Short-range air-to-air missile',   guidance: 'Imaging infrared', length: 2.90, r: 0.064, motor: 'rocket' },
    agm_arm:        { name: 'Ember',     role: 'Anti-radiation missile',           guidance: 'Passive radar homing', length: 4.10, r: 0.127, motor: 'rocket' },
    agm_light:      { name: 'Hatchet',   role: 'Light air-to-ground missile',      guidance: 'Laser / infrared', length: 1.80, r: 0.089, motor: 'rocket' },
    glide_bomb:     { name: 'Kite',      role: 'Small glide bomb',                 guidance: 'GPS / inertial', length: 1.80, r: 0.1, motor: 'none' },
    cruise_missile: { name: 'Farstrike', role: 'Stand-off cruise missile',         guidance: 'Inertial / terrain / IR', length: 5.10, r: 0.3, motor: 'jet' }
  };
  const BUILD = {};

  BUILD.aam_long = function (k, fl) {
    const r = 0.089, L = 3.66, zt = -L / 2, zn = L / 2, S = k.segs;
    k.add(lathe([[r * 0.95, zt + 0.02], [r, zt + 0.05], [r, 1.18]], S), mat('body'));
    k.add(lathe(ogive(r, 1.18, zn, 10, 0.006), S), mat('radome'));
    k.add(new THREE.TorusGeometry(r, 0.004, 4, S), mat('stencil'), T(0, 0, 1.18));
    band(k, r, 0.42, 0.5, mat('yellow'));            // warhead
    band(k, r, -0.55, -0.47, mat('brown'));          // rocket motor
    fins(k, r, 0.45, 0.72, 0.4, 0.085, 0.3, 0.012, mat('body'));        // long low strakes
    fins(k, r, zt + 0.38, 0.34, 0.17, 0.18, 0.15, 0.014, mat('body'));  // tail control fins
    nozzle(k, r, zt + 0.02, 0.06);
    lugs(k, r, [0.55, -0.35], [-1.3, 1.05]);
    stencil(k, r, 0.2, 0.9, 3); stencil(k, r, -0.9, -0.9, 2);
  };

  BUILD.aam_short = function (k, fl) {
    const r = 0.064, L = 2.9, zt = -L / 2, zn = L / 2, S = k.segs;
    k.add(lathe([[r * 0.95, zt + 0.02], [r, zt + 0.05], [r, zn - 0.16], [r * 0.93, zn - 0.08]], S), mat('body'));
    k.add(new THREE.SphereGeometry(r * 0.93, S, 10, 0, 2 * PI, 0, PI / 2), mat('glass'), T(0, 0, zn - 0.08).multiply(R(PI / 2, 0, 0)));
    k.add(new THREE.TorusGeometry(r * 0.94, 0.005, 4, S), mat('metal'), T(0, 0, zn - 0.08));
    band(k, r, 0.62, 0.7, mat('yellow'));
    band(k, r, -0.3, -0.23, mat('brown'));
    fins(k, r, zn - 0.3, 0.26, 0.2, 0.045, 0.05, 0.01, mat('body'));      // fixed nose strakes
    fins(k, r, zt + 0.42, 0.4, 0.22, 0.13, 0.16, 0.012, mat('body'));     // clipped tail fins
    nozzle(k, r, zt + 0.02, 0.05);
    for (let i = 0; i < 4; i++) k.add(box(0.05, 0.004, 0.07), mat('burnt'), R(0, 0, i * PI / 2 + PI / 4).multiply(T(0, r * 0.62, zt - 0.02))); // TVC vanes
    lugs(k, r, [0.4, -0.5], [-0.95, 0.75]);
    stencil(k, r, 0.1, 0.9, 3);
  };

  BUILD.agm_arm = function (k, fl) {
    const r = 0.127, L = 4.1, zt = -L / 2, zn = L / 2, S = k.segs;
    k.add(lathe([[r * 0.95, zt + 0.02], [r, zt + 0.06], [r, 1.05]], S), mat('bodyD'));
    k.add(lathe(ogive(r, 1.05, zn, 12, 0.004), S), mat('radomeD'));
    band(k, r, 0.55, 0.65, mat('yellow'));
    band(k, r, -0.75, -0.65, mat('brown'));
    fins(k, r, 0.62, 0.95, 0.08, 0.26, 0.82, 0.016, mat('bodyD'));      // delta mid wings
    fins(k, r, zt + 0.45, 0.42, 0.24, 0.2, 0.18, 0.016, mat('bodyD'));  // tail fins
    nozzle(k, r, zt + 0.02, 0.07);
    for (let i = 0; i < 4; i++) k.add(box(0.012, 0.012, 0.35), mat('stencil'), R(0, 0, i * PI / 2).multiply(T(0, r * 0.99, 1.4))); // antenna strips on radome
    lugs(k, r, [0.7, -0.45], [-1.5, 0.95, 'bodyD']);
    stencil(k, r, 0.25, 0.9, 3); stencil(k, r, -1.2, -0.9, 2);
  };

  BUILD.agm_light = function (k, fl) {
    const r = 0.089, L = 1.8, zt = -L / 2, zn = L / 2, S = k.segs;
    k.add(lathe([[r * 0.95, zt + 0.02], [r, zt + 0.04], [r, zn - 0.12], [r * 0.9, zn - 0.07]], S), mat('body'));
    // faceted seeker window
    const dome = new THREE.SphereGeometry(r * 0.9, 8, 5, 0, 2 * PI, 0, PI / 2);
    k.add(dome.toNonIndexed(), mat('gold'), T(0, 0, zn - 0.07).multiply(R(PI / 2, 0, 0)));
    k.add(new THREE.TorusGeometry(r * 0.9, 0.006, 4, S), mat('metal'), T(0, 0, zn - 0.07));
    band(k, r, 0.28, 0.34, mat('yellow'));
    band(k, r, -0.25, -0.2, mat('brown'));
    fins(k, r, 0.2, 0.42, 0.3, 0.07, 0.1, 0.01, mat('body'));             // mid wings
    fins(k, r, zt + 0.2, 0.18, 0.12, 0.1, 0.06, 0.01, mat('body'));        // tail control fins
    nozzle(k, r, zt + 0.02, 0.04);
    k.add(box(0.03, 0.02, 0.55), mat('rack'), T(0, r + 0.008, -0.05));        // launch rail shoe
    stencil(k, r, 0.0, 0.9, 2);
  };

  BUILD.glide_bomb = function (k, fl) {
    const r = 0.1, L = 1.8, zt = -L / 2, zn = L / 2, S = k.segs;
    k.add(lathe([[r * 0.6, zt], [r * 0.85, zt + 0.12], [r, zt + 0.35], [r, 0.45]], S), mat('body'));
    k.add(lathe(ogive(r, 0.45, zn, 10, 0.012), S), mat('body'));
    band(k, r, 0.36, 0.44, mat('yellow'));
    k.add(new THREE.CircleGeometry(r * 0.6, S), mat('black'), T(0, 0, zt).multiply(R(0, PI, 0)));
    fins(k, r * 0.8, zt + 0.2, 0.2, 0.14, 0.1, 0.05, 0.012, mat('body'));  // tail fins
    // diamond-back wings: pivot on top, folded along the body when carried
    const wz = 0.25, spread = fl ? 1.05 : 0.0;
    k.add(cylZ(0.035, 0.035, 0.12, 10), mat('metal'), T(0, r + 0.02, wz));
    [1, -1].forEach(s => {
      k.with(T(0, r + 0.045 + (s > 0 ? 0 : 0.012), wz).multiply(R(0, s * spread, 0)), () => {
        // plate from pivot rearward (folded) → swings outward when deployed
        const w = new THREE.BoxGeometry(0.075, 0.01, 0.78); w.translate(0, 0, -0.36);
        k.add(w, mat('body'));
      });
    });
    lugs(k, r, [0.2, -0.15]);
    stencil(k, r, -0.2, 0.9, 2);
  };

  BUILD.cruise_missile = function (k, fl) {
    const L = 5.1, zt = -L / 2, zn = L / 2;
    // faceted, flat-bottomed low-observable body
    const ring = (z, w, t, b, nose) => {
      const c = nose || 1;
      return [[w, -b * 0.2], [w * 0.8 * c, t * 0.65], [w * 0.35, t], [-w * 0.35, t], [-w * 0.8 * c, t * 0.65], [-w, -b * 0.2], [-w * 0.85, -b], [w * 0.85, -b]]
        .map(p => new V3(p[0], p[1], z));
    };
    const st = [[zt, 0.2, 0.14, 0.12], [zt + 0.4, 0.27, 0.22, 0.2], [zt + 1.0, 0.3, 0.26, 0.24], [1.6, 0.3, 0.26, 0.24], [2.15, 0.22, 0.18, 0.2], [zn - 0.12, 0.08, 0.06, 0.12], [zn, 0.02, 0.02, 0.05]];
    k.add(loft(st.map(s => ring(s[0], s[1], s[2], s[3])), { flat: true }), mat('bodyD'));
    // yellow warhead stripe wrapped around the faceted body
    k.add(loft([ring(1.15, 0.306, 0.266, 0.246), ring(1.23, 0.306, 0.266, 0.246)], { flat: true, capStart: false, capEnd: false }), mat('yellow'));
    // seeker window on the nose
    k.add(box(0.12, 0.01, 0.16), mat('gold'), T(0, 0.19, 2.05).multiply(R(-0.25, 0, 0)));
    // wings: folded flush under the top when carried, swept out in flight
    [1, -1].forEach(s => {
      k.with(T(0, 0.27 + (s < 0 && !fl ? 0.03 : 0), 0.55).multiply(R(0, s * (fl ? 0.42 : 1.54), 0)), () => {
        const w = finGeom(0.34, 0.22, fl ? 1.25 : 1.1, fl ? 0.2 : 0.1, 0.03);
        w.rotateZ(-s * PI / 2); // span along ±X
        k.add(w, mat('bodyD'));
      });
    });
    k.add(cylZ(0.07, 0.07, 0.06, 10), mat('metal'), T(0, 0.27, 0.55));
    // tail: two canted upper fins + two canted lower fins
    [[1, 0.5], [-1, 0.5], [1, -0.55], [-1, -0.55]].forEach(([s, up]) => {
      const a = up > 0 ? s * -0.5 : s * (PI - 0.6);
      const span = up > 0 ? 0.38 : 0.22;
      k.add(finGeom(0.42, 0.22, fl || up > 0 ? span : span * 0.4, 0.2, 0.018), mat('bodyD'), R(0, 0, a).multiply(T(0, 0.13, zt + 0.5)));
    });
    // engine: exhaust + intake scoop (deployed in flight)
    k.add(cylZ(0.11, 0.12, 0.08, 14, true), mat('burnt'), T(0, -0.02, zt - 0.03));
    k.add(new THREE.CircleGeometry(0.1, 14), mat('black'), T(0, -0.02, zt - 0.02).multiply(R(0, PI, 0)));
    if (fl) {
      k.add(loft([ring(-0.3, 0.12, 0.02, 0.02).map(p => p.setY(p.y - 0.24)), ring(-1.1, 0.12, 0.02, 0.12).map(p => p.setY(p.y - 0.26))], { flat: true, capStart: false }), mat('bodyD'));
      k.add(box(0.2, 0.1, 0.02), mat('black'), T(0, -0.3, -0.32));
    } else {
      k.add(box(0.22, 0.008, 0.7), mat('stencil'), T(0, -0.245, -0.7)); // closed intake door outline
    }
    lugs(k, 0.265, [0.9, -0.9]);
    // panel seams + stencils
    [-1.4, -0.3, 1.9].forEach(z => k.add(box(0.56, 0.006, 0.012), mat('stencil'), T(0, 0.262, z)));
    stencil(k, 0.3, 0.2, 1.1, 3);
  };

  /* ------------------------------------------------------ parts + racks API */
  const partCache = new Map();
  function parts(kind, opts) {
    opts = opts || {};
    if (kind === 'arm_missile') kind = 'agm_arm';
    if (!BUILD[kind]) return [];
    const fl = opts.flight !== false, lod = opts.lod === 'low' ? 'low' : 'high';
    const key = kind + '|' + fl + '|' + lod;
    if (!partCache.has(key)) {
      const k = new Kit(lod === 'low' ? 8 : 20);
      BUILD[kind](k, fl);
      partCache.set(key, k.parts());
    }
    return partCache.get(key);
  }
  // Multi-carriage racks. Origin = top attach point of the rack.
  function rackParts(kind, opts) {
    const key = 'rack|' + kind + '|' + ((opts && opts.lod) || 'high');
    if (partCache.has(key)) return partCache.get(key);
    const k = new Kit(12);
    const put = (m, kd) => parts(kd, { flight: false, lod: opts && opts.lod }).forEach(p => k.add(p.geometry, p.material, m));
    if (kind === 'agm_light') {       // triple rail launcher
      const r = INFO.agm_light.r;
      k.add(box(0.14, 0.12, 1.0), mat('rack'), T(0, -0.06, 0));
      [[0, -0.12 - r - 0.03, 0], [0.2, -0.1 - r * 0.4, 0.8], [-0.2, -0.1 - r * 0.4, -0.8]].forEach(([x, y, a]) => {
        k.add(box(0.06, 0.05, 0.95), mat('rack'), T(x * 0.55, y + r + 0.025, 0.02).multiply(R(0, 0, a)));
        put(T(x + (a ? Math.sign(x) * 0.04 : 0), y, 0.1).multiply(R(0, 0, a)), 'agm_light');
      });
    } else if (kind === 'glide_bomb') { // twin carriage
      const r = INFO.glide_bomb.r;
      k.add(box(0.16, 0.1, 1.1), mat('rack'), T(0, -0.05, 0));
      k.add(box(0.46, 0.05, 0.3), mat('rack'), T(0, -0.1, 0.25));
      k.add(box(0.46, 0.05, 0.3), mat('rack'), T(0, -0.1, -0.25));
      [0.17, -0.17].forEach(x => put(T(x, -0.14 - r, 0.1), 'glide_bomb'));
    }
    const out = k.parts(); partCache.set(key, out); return out;
  }

  /* --------------------------------------------------- flying model (create) */
  function create(kind, opts) {
    opts = opts || {};
    if (kind === 'arm_missile') kind = 'agm_arm';
    const info = INFO[kind];
    if (!info) return null;
    const fl = opts.flight !== false;
    const g = new THREE.Group(); g.name = kind;
    parts(kind, { flight: fl, lod: opts.lod }).forEach(p => g.add(new THREE.Mesh(p.geometry, p.material)));
    const tail = -info.length / 2;
    const smoke = new THREE.Object3D(); smoke.name = 'smoke'; smoke.position.set(0, kind === 'cruise_missile' ? -0.02 : 0, tail - 0.05); g.add(smoke);
    let plume = null;
    if (info.motor === 'rocket') {
      plume = new THREE.Group();
      const s = info.r / 0.089;
      const o = new THREE.Mesh(new THREE.ConeGeometry(0.075 * s, 1.5 * s, 12, 1, true), mat('plumeO'));
      o.rotation.x = -PI / 2; o.position.z = -0.75 * s;
      const i = new THREE.Mesh(new THREE.ConeGeometry(0.045 * s, 0.7 * s, 10, 1, true), mat('plumeI'));
      i.rotation.x = -PI / 2; i.position.z = -0.35 * s;
      const glow = new THREE.Mesh(new THREE.SphereGeometry(0.09 * s, 10, 8), mat('plumeI'));
      plume.add(o, i, glow);
      smoke.add(plume);
    } else if (info.motor === 'jet') {
      plume = new THREE.Mesh(new THREE.CircleGeometry(0.09, 14), mat('heat'));
      plume.rotation.y = PI; plume.position.z = 0.03;
      smoke.add(plume);
    }
    let on = fl, t = Math.random() * 10;
    g.userData = { kind, name: info.name, role: info.role, guidance: info.guidance, length: info.length, diameter: info.r * 2, motor: info.motor, flight: fl };
    const ud = g.userData;
    ud.smoke = smoke;
    ud.setMotor = v => { on = !!v; if (plume) plume.visible = on; };
    ud.update = dt => {
      t += dt || 0.016;
      if (plume && on && info.motor === 'rocket') { const f = 1 + 0.12 * Math.sin(t * 57) + 0.08 * Math.sin(t * 91); plume.scale.set(1, 1, f); }
    };
    ud.setMotor(fl);
    return g;
  }

  const Weapons = { version: 'weapons-1.0', kinds: Object.keys(INFO), info: INFO, parts, rackParts, create };
  window.RSWeapons = Weapons;

  /* ------------------------------------------------- hook into Models API */
  let M = (typeof Models !== 'undefined') ? Models : window.Models; // eslint-disable-line no-undef
  if (!M) M = window.Models = { version: '0', kinds: [], create: null };
  const prev = typeof M.create === 'function' ? M.create.bind(M) : null;
  M.create = function (kind, opts) {
    if (INFO[kind] || kind === 'arm_missile') return create(kind, opts);
    return prev ? prev(kind, opts) : null;
  };
  const ks = new Set(M.kinds || []); Object.keys(INFO).forEach(k => ks.add(k)); ks.add('arm_missile');
  M.kinds = Array.from(ks);
  M.weapons = Weapons;
  M.version = (M.version || '0') + '+' + Weapons.version;
})();
