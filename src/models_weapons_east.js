/* ============================================================================
 * models_weapons_east.js — Red Skies / Weapons Hold · friendly-side weapons
 * Prairie Blue Studio · procedural, no textures, three.js r128+
 *
 * Fictional, generic Eastern-bloc-style weapons (not copies of real types).
 * Air-launched (carried by jet_friend):
 *   aam_long_e     "Sable"     medium/long-range radar AAM, lattice tail fins   3.60 m
 *   aam_short_e    "Sting"     short-range IR AAM, nose canards                 2.90 m
 *   aam_heavy_e    "Longbow"   heavy long-range radar AAM                       4.20 m
 *   agm_arm_e      "Cinder"    anti-radiation missile                           4.60 m
 *   agm_light_e    "Pike"      light laser-guided air-to-ground missile         2.90 m
 *   guided_bomb_e  "Boulder"   laser-guided bomb                                3.00 m
 *   cruise_e       "Longshot"  air-launched turbofan cruise missile             6.00 m
 * Surface-to-air (the player's battery, build-plan kinds):
 *   missile_lance  "Lance"     long-range SAM, cold-launched from a canister    7.50 m
 *   missile_dart   "Dart"      medium-range SAM, box canister                   5.80 m
 *
 * Colours: white air-to-air missiles, olive ground-attack weapons, off-white
 *   SAMs with grey radomes, olive-drab canisters.
 *
 * Models.create(kind, opts) → THREE.Group, nose +Z, 1 unit = 1 m, origin at the
 *   body centreline, mid-length.  opts: { flight: true (default) | false, lod }
 *   flight:true  → fins/wings deployed, motor plume on
 *   flight:false → carried / in-canister configuration (folded fins, no plume)
 * userData: kind, name, role, guidance, length, diameter, motor, smoke (tail
 *   anchor for trails), setMotor(on), update(dt)
 *
 * For airframe / launcher builders:
 *   RSWeaponsEast.parts(kind, {flight, lod}) → [{ geometry, material }] (cached)
 *   RSWeaponsEast.info[kind].r → body radius (lugs sit at y = +r)
 *   RSWeaponsEast.canisterParts('missile_lance' | 'missile_dart', {loaded, cap, lod})
 *     → canister (+ folded round if loaded), origin at the aft end centre, tube
 *       along +Z. Tilt it up in the launcher.
 *   RSWeaponsEast.canister(kind, opts) → THREE.Group of the same.
 *
 * Load order: after models.js, before jet_friend.js (the jet uses it when present).
 * ==========================================================================*/
(function () {
  'use strict';
  const THREE = window.THREE;
  if (!THREE) { console.error('models_weapons_east.js: THREE not found'); return; }
  const V3 = THREE.Vector3, M4 = THREE.Matrix4, PI = Math.PI;

  /* ------------------------------------------------------------- materials */
  const D = THREE.DoubleSide;
  const MAT = {};
  function mat(n) {
    if (MAT[n]) return MAT[n];
    const S = (c, r, m) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m, side: D });
    const defs = {
      white:    () => S(0xe4e6e1, 0.5, 0.08),    // air-to-air body
      whiteN:   () => S(0xc8ccc6, 0.45, 0.04),   // radar AAM radome
      olive:    () => S(0x5c6646, 0.62, 0.12),   // ground-attack body
      oliveD:   () => S(0x444c35, 0.65, 0.12),
      radomeD:  () => S(0x33382c, 0.5, 0.05),
      sam:      () => S(0xdcddd4, 0.55, 0.08),   // SAM body
      samN:     () => S(0xa5a9a3, 0.45, 0.05),   // SAM radome
      red:      () => S(0xa32f28, 0.55, 0.05),
      yellow:   () => S(0xcfa41d, 0.55, 0.05),
      black:    () => S(0x161718, 0.6, 0.1),
      stencil:  () => S(0x26282a, 0.7, 0.05),
      metal:    () => S(0x6d6a66, 0.35, 0.8),
      burnt:    () => S(0x2e2a27, 0.5, 0.6),
      glass:    () => new THREE.MeshStandardMaterial({ color: 0x2b3f4d, roughness: 0.03, metalness: 0.95, side: D }),
      gold:     () => new THREE.MeshStandardMaterial({ color: 0x8a6d25, roughness: 0.06, metalness: 1.0, side: D }),
      rack:     () => S(0x4e5646, 0.75, 0.2),
      can:      () => S(0x4b5838, 0.72, 0.12),   // canister olive drab
      canD:     () => S(0x3a4530, 0.75, 0.12),
      plumeO:   () => new THREE.MeshBasicMaterial({ color: 0xff7a22, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, side: D }),
      plumeI:   () => new THREE.MeshBasicMaterial({ color: 0xfff4d6, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: D }),
      heat:     () => new THREE.MeshBasicMaterial({ color: 0xa04818, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: D })
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
  function ogive(R0, z0, z1, n, blunt) {
    const L = z1 - z0, rho = (R0 * R0 + L * L) / (2 * R0), pts = [];
    for (let i = 0; i <= n; i++) {
      const x = i / n * L, y = Math.sqrt(rho * rho - x * x) + R0 - rho;
      pts.push([Math.max(y, blunt || 0.001), z0 + x]);
    }
    return pts;
  }
  // Thin fin: span along +Y from the body surface; chord along -Z from the leading edge
  function finGeom(c0, c1, span, sweep, t) {
    const sec = (y, zLE, c, th) => [[0, zLE], [th / 2, zLE - c * 0.22], [th / 2, zLE - c * 0.8], [0, zLE - c], [-th / 2, zLE - c * 0.8], [-th / 2, zLE - c * 0.22]]
      .map(p => new V3(p[0], y, p[1]));
    return loft([sec(0, 0, c0, t), sec(span, -sweep, c1, t * 0.7)], { flat: true });
  }
  function box(w, h, l) { return new THREE.BoxGeometry(w, h, l); }
  function cylZ(r0, r1, len, segs, open) { const g = new THREE.CylinderGeometry(r1, r0, len, segs, 1, !!open); g.rotateX(PI / 2); return g; }

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
  // Cruciform fins at radius r. offset PI/4 = X layout, 0 = + layout
  function fins(k, r, zLE, c0, c1, span, sweep, t, material, offset) {
    for (let i = 0; i < 4; i++) {
      const a = (offset === undefined ? PI / 4 : offset) + i * PI / 2;
      k.add(finGeom(c0, c1, span, sweep, t), material, R(0, 0, a - PI / 2).multiply(T(0, r * 0.96, zLE)));
    }
  }
  function band(k, r, z0, z1, material) { k.add(cylZ(r * 1.012, r * 1.012, z1 - z0, k.segs, true), material, T(0, 0, (z0 + z1) / 2)); }
  function stencil(k, r, z, a, lines) {
    for (let i = 0; i < lines; i++) k.add(box(0.004, 0.012, 0.16 - i * 0.04), mat('stencil'), R(0, 0, a).multiply(T(0, r * 1.004, z - i * 0.03)).multiply(R(0, 0, PI / 2)));
  }
  function lugs(k, r, zs, raceway) {
    zs.forEach(z => k.add(box(0.035, 0.03, 0.05), mat('metal'), T(0, r + 0.012, z)));
    if (raceway) k.add(box(0.03, 0.022, raceway[1] - raceway[0]), mat(raceway[2] || 'white'), T(0, r + 0.006, (raceway[0] + raceway[1]) / 2));
  }
  function nozzle(k, r, z, len) {
    k.add(lathe([[r * 0.78, z - len], [r * 0.86, z - len * 0.5], [r * 0.95, z]], k.segs), mat('burnt'));
    k.add(new THREE.CircleGeometry(r * 0.72, k.segs), mat('black'), T(0, 0, z - len * 0.6).multiply(R(0, PI, 0)));
  }
  // Lattice (grid) fin: flat frame facing forward, span radially along +Y, width w, chord c (along Z)
  function gridFin(k, material, w, span, c, bars) {
    const t = 0.008;
    k.add(box(w, t, c), material, T(0, span, 0));             // outer tip bar
    k.add(box(w, t, c), material, T(0, 0.02, 0));             // root bar
    k.add(box(t, span, c), material, T(w / 2, span / 2, 0));  // side bars
    k.add(box(t, span, c), material, T(-w / 2, span / 2, 0));
    for (let i = 1; i <= bars; i++) {                        // inner lattice
      const f = i / (bars + 1);
      k.add(box(t * 0.8, span, c * 0.9), material, T(-w / 2 + w * f, span / 2, 0));
      k.add(box(w, t * 0.8, c * 0.9), material, T(0, 0.02 + (span - 0.02) * f, 0));
    }
    k.add(box(0.03, 0.04, c * 0.8), mat('metal'), T(0, 0.0, 0));  // hinge stub
  }

  /* --------------------------------------------------------------- designs */
  const INFO = {
    aam_long_e:    { name: 'Sable',    role: 'Medium/long-range air-to-air missile', guidance: 'Active radar',         length: 3.60, r: 0.1,   motor: 'rocket', family: 'aam' },
    aam_short_e:   { name: 'Sting',    role: 'Short-range air-to-air missile',       guidance: 'Infrared',             length: 2.90, r: 0.085, motor: 'rocket', family: 'aam' },
    aam_heavy_e:   { name: 'Longbow',  role: 'Heavy long-range air-to-air missile',  guidance: 'Inertial + active radar', length: 4.20, r: 0.19, motor: 'rocket', family: 'aam' },
    agm_arm_e:     { name: 'Cinder',   role: 'Anti-radiation missile',               guidance: 'Passive radar homing', length: 4.60, r: 0.19,  motor: 'rocket', family: 'agm' },
    agm_light_e:   { name: 'Pike',     role: 'Light air-to-ground missile',          guidance: 'Semi-active laser',    length: 2.90, r: 0.13,  motor: 'rocket', family: 'agm' },
    guided_bomb_e: { name: 'Boulder',  role: 'Laser-guided bomb',                    guidance: 'Semi-active laser',    length: 3.00, r: 0.2,   motor: 'none',   family: 'agm' },
    cruise_e:      { name: 'Longshot', role: 'Air-launched cruise missile',          guidance: 'Inertial / terrain',   length: 6.00, r: 0.26,  motor: 'jet',    family: 'agm' },
    missile_lance: { name: 'Lance',    role: 'Long-range surface-to-air missile',    guidance: 'Inertial + track-via-missile', length: 7.50, r: 0.26, motor: 'rocket', family: 'sam' },
    missile_dart:  { name: 'Dart',     role: 'Medium-range surface-to-air missile',  guidance: 'Semi-active radar',    length: 5.80, r: 0.16,  motor: 'rocket', family: 'sam' }
  };
  const BUILD = {};

  BUILD.aam_long_e = function (k, fl) {
    const r = 0.1, L = 3.6, zt = -L / 2, zn = L / 2, S = k.segs;
    k.add(lathe([[r * 0.95, zt + 0.02], [r, zt + 0.05], [r, 1.05]], S), mat('white'));
    k.add(lathe(ogive(r, 1.05, zn, 10, 0.006), S), mat('whiteN'));
    k.add(new THREE.TorusGeometry(r, 0.004, 4, S), mat('stencil'), T(0, 0, 1.05));
    band(k, r, 0.5, 0.58, mat('red'));
    band(k, r, 0.62, 0.66, mat('yellow'));
    fins(k, r, 0.55, 0.95, 0.75, 0.07, 0.2, 0.01, mat('white'));          // long narrow mid wings
    // lattice tail fins: open in flight, folded forward along the body when carried
    for (let i = 0; i < 4; i++) {
      const a = PI / 4 + i * PI / 2;
      k.with(R(0, 0, a - PI / 2).multiply(T(0, r * 0.96, zt + 0.16)).multiply(R(fl ? 0 : PI / 2 - 0.06, 0, 0)), () => gridFin(k, mat('white'), 0.17, 0.15, 0.055, 2));
    }
    nozzle(k, r * 0.9, zt + 0.02, 0.05);
    lugs(k, r, [0.6, -0.5], [-1.2, 1.0]);
    stencil(k, r, 0.2, 0.9, 3); stencil(k, r, -0.9, -0.9, 2);
  };

  BUILD.aam_short_e = function (k, fl) {
    const r = 0.085, L = 2.9, zt = -L / 2, zn = L / 2, S = k.segs;
    k.add(lathe([[r * 0.95, zt + 0.02], [r, zt + 0.05], [r, zn - 0.18], [r * 0.92, zn - 0.09]], S), mat('white'));
    k.add(new THREE.SphereGeometry(r * 0.92, S, 10, 0, 2 * PI, 0, PI / 2), mat('glass'), T(0, 0, zn - 0.09).multiply(R(PI / 2, 0, 0)));
    k.add(new THREE.TorusGeometry(r * 0.93, 0.006, 4, S), mat('metal'), T(0, 0, zn - 0.09));
    // small fixed vanes just behind the seeker, then the control canards
    fins(k, r, zn - 0.2, 0.08, 0.05, 0.05, 0.02, 0.006, mat('white'), 0);
    fins(k, r, zn - 0.38, 0.22, 0.06, 0.13, 0.12, 0.008, mat('white'), 0);
    band(k, r, 0.55, 0.62, mat('red'));
    band(k, r, 0.66, 0.69, mat('yellow'));
    // cropped-delta tail fins with tip wheels (roll stabilisers)
    fins(k, r, zt + 0.46, 0.42, 0.14, 0.16, 0.26, 0.01, mat('white'), 0);
    for (let i = 0; i < 4; i++) {
      const w = new THREE.CylinderGeometry(0.03, 0.03, 0.012, 10); w.rotateZ(PI / 2);
      k.add(w, mat('metal'), R(0, 0, i * PI / 2 - PI / 2).multiply(T(0, r + 0.15, zt + 0.1)));
    }
    nozzle(k, r * 0.9, zt + 0.02, 0.05);
    lugs(k, r, [0.4, -0.5], [-0.95, 0.75]);
    stencil(k, r, 0.1, PI / 4, 3);
  };

  BUILD.aam_heavy_e = function (k, fl) {
    const r = 0.19, L = 4.2, zt = -L / 2, zn = L / 2, S = k.segs;
    k.add(lathe([[r * 0.9, zt + 0.02], [r, zt + 0.08], [r, 1.15]], S), mat('white'));
    k.add(lathe(ogive(r, 1.15, zn, 12, 0.008), S), mat('whiteN'));
    k.add(new THREE.TorusGeometry(r, 0.005, 4, S), mat('stencil'), T(0, 0, 1.15));
    band(k, r, 0.55, 0.65, mat('red'));
    band(k, r, 0.7, 0.74, mat('yellow'));
    band(k, r, -0.9, -0.86, mat('stencil'));
    fins(k, r, 0.8, 2.1, 1.6, 0.075, 0.5, 0.012, mat('white'));            // very long low strakes
    fins(k, r, zt + 0.62, 0.6, 0.32, 0.26, 0.36, 0.016, mat('white'));     // big tail control fins
    nozzle(k, r, zt + 0.02, 0.08);
    lugs(k, r, [0.8, -0.8], [-1.6, 1.1]);
    stencil(k, r, 0.3, 0.9, 3); stencil(k, r, -1.2, -0.9, 3);
  };

  BUILD.agm_arm_e = function (k, fl) {
    const r = 0.19, L = 4.6, zt = -L / 2, zn = L / 2, S = k.segs;
    k.add(lathe([[r * 0.9, zt + 0.02], [r, zt + 0.08], [r, 1.2]], S), mat('olive'));
    k.add(lathe(ogive(r, 1.2, zn, 12, 0.01), S), mat('radomeD'));
    for (let i = 0; i < 4; i++) k.add(box(0.014, 0.014, 0.5), mat('stencil'), R(0, 0, i * PI / 2 + PI / 4).multiply(T(0, r * 0.98, 1.55)));
    band(k, r, 0.7, 0.8, mat('yellow'));
    band(k, r, 0.84, 0.88, mat('red'));
    fins(k, r, 0.55, 1.2, 0.2, 0.3, 0.95, 0.018, mat('olive'));            // cropped-delta mid wings
    fins(k, r, zt + 0.6, 0.55, 0.35, 0.24, 0.2, 0.018, mat('olive'));      // tail fins
    nozzle(k, r, zt + 0.02, 0.08);
    lugs(k, r, [0.8, -0.8], [-1.7, 1.1, 'olive']);
    stencil(k, r, 0.2, 0.9, 3); stencil(k, r, -1.3, -0.9, 3);
  };

  BUILD.agm_light_e = function (k, fl) {
    const r = 0.13, L = 2.9, zt = -L / 2, zn = L / 2, S = k.segs;
    k.add(lathe([[r * 0.9, zt + 0.02], [r, zt + 0.06], [r, zn - 0.2], [r * 0.92, zn - 0.06], [r * 0.8, zn - 0.02]], S), mat('olive'));
    k.add(new THREE.CircleGeometry(r * 0.78, S), mat('gold'), T(0, 0, zn - 0.02));            // flat laser seeker window
    k.add(new THREE.TorusGeometry(r * 0.8, 0.008, 4, S), mat('metal'), T(0, 0, zn - 0.02));
    fins(k, r, zn - 0.25, 0.2, 0.08, 0.1, 0.1, 0.008, mat('olive'));      // nose canards
    band(k, r, 0.3, 0.38, mat('yellow'));
    band(k, r, 0.42, 0.45, mat('red'));
    fins(k, r, -0.1, 0.9, 0.6, 0.12, 0.25, 0.012, mat('olive'));          // long-chord mid wings
    nozzle(k, r, zt + 0.02, 0.06);
    k.add(box(0.04, 0.03, 0.9), mat('rack'), T(0, r + 0.012, -0.1));        // rail shoe
    stencil(k, r, 0.05, 0.9, 2);
  };

  BUILD.guided_bomb_e = function (k, fl) {
    const r = 0.2, L = 3.0, zt = -L / 2, zn = L / 2, S = k.segs;
    k.add(lathe([[r * 0.55, zt], [r * 0.8, zt + 0.25], [r, zt + 0.7], [r, 0.7], [r * 0.9, 0.95]], S), mat('olive'));
    // seeker head: narrower cylinder with a glass window and control canards
    k.add(lathe([[r * 0.9, 0.95], [r * 0.62, 1.0], [r * 0.62, zn - 0.08], [r * 0.5, zn - 0.02]], S), mat('oliveD'));
    k.add(new THREE.CircleGeometry(r * 0.48, S), mat('glass'), T(0, 0, zn - 0.02));
    fins(k, r * 0.62, zn - 0.12, 0.28, 0.14, 0.13, 0.12, 0.01, mat('oliveD'));
    band(k, r, 0.3, 0.38, mat('yellow'));
    band(k, r, 0.42, 0.46, mat('red'));
    fins(k, r, 0.6, 1.4, 1.1, 0.05, 0.3, 0.012, mat('olive'), 0);          // long thin strakes
    // tail: cruciform fins, spread in flight, closed when carried
    fins(k, r * 0.8, zt + 0.45, 0.42, 0.3, fl ? 0.26 : 0.12, 0.12, 0.012, mat('olive'));
    k.add(new THREE.CircleGeometry(r * 0.55, S), mat('black'), T(0, 0, zt).multiply(R(0, PI, 0)));
    lugs(k, r, [0.55, -0.45]);
    stencil(k, r, 0.1, 0.9, 3);
  };

  BUILD.cruise_e = function (k, fl) {
    const r = 0.26, L = 6.0, zt = -L / 2, zn = L / 2, S = k.segs;
    k.add(lathe([[r * 0.7, zt], [r * 0.95, zt + 0.25], [r, zt + 0.6], [r, 1.9]], S), mat('oliveD'));
    k.add(lathe(ogive(r, 1.9, zn, 12, 0.02), S), mat('oliveD'));
    band(k, r, 1.0, 1.1, mat('yellow'));
    [-1.8, -0.4, 0.9, 1.9].forEach(z => k.add(new THREE.TorusGeometry(r * 1.003, 0.004, 3, S), mat('stencil'), T(0, 0, z)));
    // wings: folded into the belly when carried, swing out in flight
    [1, -1].forEach(s => {
      k.with(T(0, -r * 0.7, 0.4).multiply(R(0, s * (fl ? 0.35 : 1.5), 0)), () => {
        const w = finGeom(0.42, 0.26, fl ? 1.35 : 1.1, fl ? 0.2 : 0.05, 0.03);
        w.rotateZ(-s * PI / 2);
        k.add(w, mat('oliveD'));
      });
    });
    // tail fins: 6 small fins, folded when carried
    for (let i = 0; i < 6; i++) {
      const a = i * PI / 3 + PI / 6;
      k.add(finGeom(0.4, 0.22, fl ? 0.28 : 0.08, 0.15, 0.016), mat('oliveD'), R(0, 0, a - PI / 2).multiply(T(0, r * 0.9, zt + 0.55)));
    }
    // turbofan: pod drops out below the tail in flight
    if (fl) {
      k.add(box(0.06, 0.28, 0.5), mat('oliveD'), T(0, -r - 0.12, zt + 0.8));
      k.add(cylZ(0.13, 0.14, 0.9, 16), mat('oliveD'), T(0, -r - 0.32, zt + 0.7));
      k.add(new THREE.CircleGeometry(0.11, 14), mat('black'), T(0, -r - 0.32, zt + 1.151));
      k.add(new THREE.CircleGeometry(0.1, 14), mat('black'), T(0, -r - 0.32, zt + 0.249).multiply(R(0, PI, 0)));
    } else {
      k.add(box(0.26, 0.006, 1.0), mat('stencil'), T(0, -r - 0.001, zt + 0.7));
    }
    k.add(new THREE.CircleGeometry(r * 0.7, S), mat('black'), T(0, 0, zt).multiply(R(0, PI, 0)));
    lugs(k, r, [1.0, -1.0]);
    stencil(k, r, 0.2, 0.9, 3);
  };

  BUILD.missile_lance = function (k, fl) {
    const r = 0.26, L = 7.5, zt = -L / 2, zn = L / 2, S = k.segs;
    k.add(lathe([[r * 0.88, zt + 0.02], [r, zt + 0.12], [r, 1.9]], S), mat('sam'));
    k.add(lathe(ogive(r, 1.9, zn, 14, 0.02), S), mat('samN'));
    // section joints and markings
    [-2.2, -0.2, 1.1, 1.9].forEach(z => k.add(new THREE.TorusGeometry(r * 1.004, 0.006, 3, S), mat('stencil'), T(0, 0, z)));
    band(k, r, 0.55, 0.7, mat('black'));
    band(k, r, 0.75, 0.8, mat('red'));
    // four tail fins: flat along the body inside the canister, unfold after launch
    for (let i = 0; i < 4; i++) {
      const a = PI / 4 + i * PI / 2;
      k.with(R(0, 0, a - PI / 2).multiply(T(0, r * 0.96, zt + 1.0)), () => {
        k.add(finGeom(0.85, 0.45, fl ? 0.48 : 0.06, fl ? 0.3 : 0.05, 0.02), mat('sam'));
      });
    }
    // small control vanes in the exhaust (gas vanes) + nozzle
    nozzle(k, r, zt + 0.02, 0.12);
    for (let i = 0; i < 4; i++) k.add(box(0.1, 0.01, 0.14), mat('burnt'), R(0, 0, i * PI / 2).multiply(T(0, r * 0.55, zt - 0.08)));
    // cable raceways along the body
    [0, PI].forEach(a => k.add(box(0.05, 0.03, 4.6), mat('sam'), R(0, 0, a).multiply(T(0, r + 0.012, -0.6))));
    stencil(k, r, 0.2, PI / 2, 3); stencil(k, r, -1.5, -PI / 2, 3);
  };

  BUILD.missile_dart = function (k, fl) {
    const r = 0.16, L = 5.8, zt = -L / 2, zn = L / 2, S = k.segs;
    k.add(lathe([[r * 0.88, zt + 0.02], [r, zt + 0.1], [r, 1.6]], S), mat('sam'));
    k.add(lathe(ogive(r, 1.6, zn, 12, 0.012), S), mat('samN'));
    [-1.6, 0.2, 1.6].forEach(z => k.add(new THREE.TorusGeometry(r * 1.004, 0.005, 3, S), mat('stencil'), T(0, 0, z)));
    band(k, r, 0.7, 0.82, mat('black'));
    band(k, r, 0.86, 0.9, mat('red'));
    fins(k, r, 1.0, 2.2, 1.9, fl ? 0.09 : 0.04, 0.3, 0.012, mat('sam'));           // long low strakes
    fins(k, r, zt + 0.75, 0.7, 0.35, fl ? 0.3 : 0.05, 0.3, 0.016, mat('sam'));     // tail control fins
    nozzle(k, r, zt + 0.02, 0.08);
    k.add(box(0.035, 0.022, 3.4), mat('sam'), T(0, r + 0.01, -0.4));
    stencil(k, r, 0.2, PI / 2, 3);
  };

  /* ------------------------------------------------------ parts + racks API */
  const partCache = new Map();
  function parts(kind, opts) {
    opts = opts || {};
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
  // Canisters for the SAMs. Origin = aft end centre, tube along +Z.
  function canisterParts(kind, opts) {
    opts = opts || {};
    const loaded = opts.loaded !== false, lod = opts.lod === 'low' ? 'low' : 'high', capOn = opts.cap !== false;
    const key = 'can|' + kind + '|' + loaded + '|' + capOn + '|' + lod;
    if (partCache.has(key)) return partCache.get(key);
    const k = new Kit(lod === 'low' ? 10 : 24), S = k.segs;
    if (kind === 'missile_lance') {
      const Rr = 0.36, L = 8.0;
      k.add(cylZ(Rr, Rr, L, S, true), mat('can'), T(0, 0, L / 2));
      k.add(cylZ(Rr * 0.97, Rr * 0.97, L, S, true), mat('canD'), T(0, 0, L / 2));      // inner wall
      for (let z = 0.4; z < L; z += 0.9) k.add(new THREE.TorusGeometry(Rr + 0.012, 0.03, 5, S), mat('can'), T(0, 0, z));
      // end caps: domed front cover, flat rear cover with gas generator boss
      if (capOn) k.add(new THREE.SphereGeometry(Rr, S, 8, 0, 2 * PI, 0, PI / 2), mat('canD'), T(0, 0, L).multiply(R(PI / 2, 0, 0)).multiply(new M4().makeScale(1, 0.35, 1)));
      k.add(new THREE.CircleGeometry(Rr, S), mat('canD'), R(0, PI, 0));
      k.add(cylZ(0.14, 0.14, 0.2, 12), mat('metal'), T(0, 0, -0.1));
      // handling lugs, cable duct, stencil blocks
      [1.2, 6.8].forEach(z => [1, -1].forEach(s => k.add(box(0.08, 0.14, 0.14), mat('metal'), T(s * (Rr + 0.05), 0, z))));
      k.add(box(0.1, 0.07, L - 0.8), mat('can'), T(0, Rr + 0.03, L / 2));
      [2.5, 5.2].forEach(z => stencil(k, Rr, z, 0.6, 3));
      if (loaded) parts('missile_lance', { flight: false, lod }).forEach(p => k.add(p.geometry, p.material, T(0, 0, 0.1 + 3.75)));
    } else if (kind === 'missile_dart') {
      const H = 0.46, L = 6.2;
      // square box canister with frame ribs
      [[0, H / 2, H, 0.02], [0, -H / 2, H, 0.02]].forEach(([x, y, w, t]) => k.add(box(w, t, L), mat('can'), T(x, y, L / 2)));
      [[H / 2, 0], [-H / 2, 0]].forEach(([x, y]) => k.add(box(0.02, H, L), mat('can'), T(x, y, L / 2)));
      for (let z = 0.3; z < L; z += 0.95) k.add(box(H + 0.06, H + 0.06, 0.08), mat('canD'), T(0, 0, z));
      if (capOn) k.add(box(H, H, 0.03), mat('canD'), T(0, 0, L));    // frangible front cover
      k.add(box(H, H, 0.03), mat('canD'), T(0, 0, 0));
      k.add(box(0.08, 0.06, L - 0.6), mat('can'), T(0, H / 2 + 0.04, L / 2));
      [1.8, 4.3].forEach(z => k.add(box(0.004, 0.16, 0.3), mat('stencil'), T(H / 2 + 0.012, 0.05, z)));
      if (loaded) parts('missile_dart', { flight: false, lod }).forEach(p => k.add(p.geometry, p.material, T(0, 0, 0.15 + 2.9)));
    }
    const out = k.parts(); partCache.set(key, out); return out;
  }
  // Rail / carriage adapters for airframe builders. Origin = top attach point.
  function rackParts(kind, opts) {
    const key = 'rack|' + kind + '|' + ((opts && opts.lod) || 'high');
    if (partCache.has(key)) return partCache.get(key);
    const k = new Kit(12), info = INFO[kind];
    if (info) {
      const len = Math.min(info.length * 0.55, 2.2);
      k.add(box(0.1, 0.1, len), mat('rack'), T(0, -0.05, 0));
      k.add(box(0.16, 0.03, len * 0.8), mat('rack'), T(0, -0.1, 0));
    }
    const out = k.parts(); partCache.set(key, out); return out;
  }

  /* --------------------------------------------------- flying model (create) */
  function group(list) { const g = new THREE.Group(); list.forEach(p => g.add(new THREE.Mesh(p.geometry, p.material))); return g; }
  function create(kind, opts) {
    opts = opts || {};
    const info = INFO[kind];
    if (!info) return null;
    const fl = opts.flight !== false;
    const g = group(parts(kind, { flight: fl, lod: opts.lod })); g.name = kind;
    const tail = -info.length / 2;
    const smoke = new THREE.Object3D(); smoke.name = 'smoke';
    smoke.position.set(0, kind === 'cruise_e' ? -info.r - 0.32 : 0, kind === 'cruise_e' ? tail + 0.2 : tail - 0.05); g.add(smoke);
    let plume = null;
    if (info.motor === 'rocket') {
      plume = new THREE.Group();
      const s = info.r / 0.089, big = info.family === 'sam' ? 1.6 : 1;
      const o = new THREE.Mesh(new THREE.ConeGeometry(0.075 * s, 1.5 * s * big, 12, 1, true), mat('plumeO'));
      o.rotation.x = -PI / 2; o.position.z = -0.75 * s * big;
      const i = new THREE.Mesh(new THREE.ConeGeometry(0.045 * s, 0.7 * s * big, 10, 1, true), mat('plumeI'));
      i.rotation.x = -PI / 2; i.position.z = -0.35 * s * big;
      const glow = new THREE.Mesh(new THREE.SphereGeometry(0.09 * s, 10, 8), mat('plumeI'));
      plume.add(o, i, glow);
      smoke.add(plume);
    } else if (info.motor === 'jet') {
      plume = new THREE.Mesh(new THREE.CircleGeometry(0.1, 14), mat('heat'));
      plume.rotation.y = PI; plume.position.z = 0.03;
      smoke.add(plume);
    }
    let on = fl, t = Math.random() * 10;
    g.userData = { kind, name: info.name, role: info.role, guidance: info.guidance, length: info.length, diameter: info.r * 2, motor: info.motor, family: info.family, flight: fl };
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
  function canister(kind, opts) {
    const g = group(canisterParts(kind, opts)); g.name = kind + '_canister';
    g.userData = { kind: kind + '_canister', length: kind === 'missile_lance' ? 8.0 : 6.2 };
    return g;
  }

  const Weapons = { version: 'weapons-east-1.0', kinds: Object.keys(INFO), info: INFO, parts, rackParts, canisterParts, canister, create };
  window.RSWeaponsEast = Weapons;

  /* ------------------------------------------------- hook into Models API */
  let M = (typeof Models !== 'undefined') ? Models : window.Models; // eslint-disable-line no-undef
  if (!M) M = window.Models = { version: '0', kinds: [], create: null };
  const prev = typeof M.create === 'function' ? M.create.bind(M) : null;
  M.create = function (kind, opts) {
    if (INFO[kind]) return create(kind, opts);
    if (kind === 'missile_lance_canister' || kind === 'missile_dart_canister') return canister(kind.replace('_canister', ''), opts);
    return prev ? prev(kind, opts) : null;
  };
  const ks = new Set(M.kinds || []); Object.keys(INFO).forEach(k => ks.add(k)); ks.add('missile_lance_canister'); ks.add('missile_dart_canister');
  M.kinds = Array.from(ks);
  M.weaponsEast = Weapons;
  M.version = (M.version || '0') + '+' + Weapons.version;
})();
