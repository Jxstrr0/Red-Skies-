/* ============================================================================
 * models_launchers.js — Red Skies / Weapons Hold · SAM launcher vehicles
 * Prairie Blue Studio · procedural, three.js r128+. Needs models_weapons_east.js.
 *
 * Original fictional designs in the heavy transporter-erector-launcher class:
 *   launcher_lance  6x6 bonneted tractor + 4-axle semitrailer, 4 round canisters
 *                   (Lance long-range SAM). ~17.9 m long.
 *   launcher_dart   8x8 cab-forward truck, 4 square box canisters
 *                   (Dart medium-range SAM). ~12.2 m long.
 * Three-tone camo (green / sand / black). Both cold-launch: the round is
 * thrown out of the canister by a gas charge, ignites ~20 m up, pitches over.
 *
 * Models.create('launcher_lance' | 'launcher_dart', opts) → THREE.Group
 *   opts: { state: 'travel' (default) | 'ready', loaded: 0..4 (default 4), idle: true, lod }
 *   Units 1 = 1 m, origin at ground centre, +Z forward (cab end).
 * userData:
 *   update(dt)                       call every frame (animation, launches, particles)
 *   deploy() / stow()                outriggers + erector + mast; returns seconds
 *   state                            'travel' | 'deploying' | 'ready' | 'stowing'
 *   slots                            [{ loaded, busy }] ×4 ;  rounds → count loaded
 *   launch(slot?, opts) → missile Object3D or null (not ready / empty)
 *      opts: { dir: world Vector3 | azimuth (rad, 0 = +Z world, +X positive) + elevation (rad, default 0.6),
 *              handoffAt: seconds after firing (default 2.6),
 *              onHandoff({ missile, position, velocity, direction }) — the game takes over flight here.
 *              Without onHandoff the launcher flies it straight on and removes it after 7 s. }
 *   salvo(n, opts, gap = 1.5 s)      fires n rounds in sequence
 *   reload(slot?) → seconds (spent canister swung out, fresh one swung in)
 *   setIdle(bool)                    engine exhaust puffs
 *   onEvent = fn(name, data)         'deployed','stowed','launch','ignite','handoff','reloaded'
 *   fxParent                         world object for missiles + smoke (defaults to the launcher's parent)
 * ==========================================================================*/
(function () {
  'use strict';
  const THREE = window.THREE;
  if (!THREE) { console.error('models_launchers.js: THREE not found'); return; }
  const V3 = THREE.Vector3, M4 = THREE.Matrix4, Q = THREE.Quaternion, PI = Math.PI;
  const T = (x, y, z) => new M4().makeTranslation(x, y, z);
  const R = (x, y, z) => new M4().makeRotationFromEuler(new THREE.Euler(x, y, z));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const ease = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

  /* ---------------------------------------------------------------- textures */
  function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  let TEX = null;
  function textures() {
    if (TEX) return TEX;
    // three-tone disruptive camo, tileable
    const N = 512, cv = document.createElement('canvas'); cv.width = cv.height = N;
    const g = cv.getContext('2d'), img = g.createImageData(N, N), r = rng(77);
    const lat = P => { const a = new Float32Array(P * P); for (let i = 0; i < a.length; i++) a[i] = r(); return a; };
    const vn = (L, P, x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y); let fx = x - xi, fy = y - yi;
      fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
      const x0 = xi % P, y0 = yi % P, x1 = (xi + 1) % P, y1 = (yi + 1) % P;
      const a = L[y0 * P + x0] + (L[y0 * P + x1] - L[y0 * P + x0]) * fx, b = L[y1 * P + x0] + (L[y1 * P + x1] - L[y1 * P + x0]) * fx;
      return a + (b - a) * fy;
    };
    const A1 = lat(6), A2 = lat(12), B1 = lat(6), B2 = lat(12), C3 = lat(24);
    const green = [74, 88, 52], sand = [150, 136, 96], black = [32, 34, 28];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const u = x / N, v = y / N, d = 0.12 * vn(C3, 24, u * 24, v * 24);
      const a = 0.65 * vn(A1, 6, u * 6, v * 6) + 0.35 * vn(A2, 12, u * 12, v * 12) + d;
      const b = 0.65 * vn(B1, 6, u * 6 + 2.1, v * 6 + 4.7) + 0.35 * vn(B2, 12, u * 12, v * 12) + d;
      let c = green;
      if (a > 0.66) c = sand;
      if (b > 0.7) c = black;
      const o = (y * N + x) * 4, n = 0.94 + 0.06 * r();
      img.data[o] = c[0] * n; img.data[o + 1] = c[1] * n; img.data[o + 2] = c[2] * n; img.data[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const camo = new THREE.CanvasTexture(cv); camo.wrapS = camo.wrapT = THREE.RepeatWrapping; camo.anisotropy = 4;
    // soft smoke puff
    const sc = document.createElement('canvas'); sc.width = sc.height = 64;
    const sg = sc.getContext('2d');
    for (let i = 0; i < 7; i++) {
      const cx = 32 + (r() - 0.5) * 18, cy = 32 + (r() - 0.5) * 18, rr = 14 + r() * 12;
      const gr = sg.createRadialGradient(cx, cy, 0, cx, cy, rr);
      gr.addColorStop(0, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      sg.fillStyle = gr; sg.fillRect(0, 0, 64, 64);
    }
    const smoke = new THREE.CanvasTexture(sc);
    const fc = document.createElement('canvas'); fc.width = fc.height = 64;
    const fg = fc.getContext('2d'), fgr = fg.createRadialGradient(32, 32, 0, 32, 32, 32);
    fgr.addColorStop(0, 'rgba(255,255,240,1)'); fgr.addColorStop(0.3, 'rgba(255,200,120,0.8)'); fgr.addColorStop(1, 'rgba(255,120,40,0)');
    fg.fillStyle = fgr; fg.fillRect(0, 0, 64, 64);
    TEX = { camo, smoke, flash: new THREE.CanvasTexture(fc) };
    return TEX;
  }

  /* --------------------------------------------------------------- materials */
  const MAT = {};
  function mat(n) {
    if (MAT[n]) return MAT[n];
    const S = (c, r, m, o) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: r, metalness: m }, o || {}));
    const defs = {
      camo: () => S(0xffffff, 0.82, 0.1, { map: textures().camo }),
      tyre: () => S(0x1b1c1a, 0.95, 0.0),
      hub: () => S(0x3d4a2c, 0.7, 0.2),
      steel: () => S(0x4f524a, 0.6, 0.6),
      chrome: () => S(0xb7bab6, 0.25, 0.95),
      black: () => S(0x131412, 0.8, 0.1),
      glass: () => S(0x1b262d, 0.08, 0.6),
      lamp: () => new THREE.MeshBasicMaterial({ color: 0xf7efd2 }),
      tail: () => new THREE.MeshBasicMaterial({ color: 0x8a1d18 }),
      amber: () => new THREE.MeshBasicMaterial({ color: 0xd08a1c })
    };
    return (MAT[n] = defs[n]());
  }

  /* ------------------------------------------------------------ geometry kit */
  class Kit {
    constructor() { this.b = new Map(); }
    add(geom, key, m) {
      let g = geom.index ? geom.toNonIndexed() : geom.clone();
      if (!g.attributes.normal) g.computeVertexNormals();
      Object.keys(g.attributes).forEach(k => { if (k !== 'position' && k !== 'normal') g.deleteAttribute(k); });
      if (m) g.applyMatrix4(m);
      if (!this.b.has(key)) this.b.set(key, []);
      this.b.get(key).push(g);
    }
    box(key, x0, x1, y0, y1, z0, z1, m) {
      const g = new THREE.BoxGeometry(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0));
      g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      this.add(g, key, m);
    }
    cylX(key, r, w, x, y, z, segs) { const g = new THREE.CylinderGeometry(r, r, w, segs || 18); g.rotateZ(PI / 2); g.translate(x, y, z); this.add(g, key); }
    cylY(key, r, h, x, y0, z, segs) { const g = new THREE.CylinderGeometry(r, r, h, segs || 10); g.translate(x, y0 + h / 2, z); this.add(g, key); }
    cylZ(key, r, l, x, y, z0, segs) { const g = new THREE.CylinderGeometry(r, r, l, segs || 14); g.rotateX(PI / 2); g.translate(x, y, z0 + l / 2); this.add(g, key); }
    meshes() {
      const out = [];
      this.b.forEach((list, key) => {
        let n = 0; list.forEach(g => n += g.attributes.position.count);
        const P = new Float32Array(n * 3), N = new Float32Array(n * 3); let o = 0;
        list.forEach(g => { P.set(g.attributes.position.array, o); N.set(g.attributes.normal.array, o); o += g.attributes.position.count * 3; });
        const bg = new THREE.BufferGeometry();
        bg.setAttribute('position', new THREE.BufferAttribute(P, 3));
        bg.setAttribute('normal', new THREE.BufferAttribute(N, 3));
        const material = typeof key === 'string' ? mat(key) : key;
        if (material.map) {                         // box-projected UVs, 16 m repeat
          const uv = new Float32Array(n * 2), S = 1 / 16, a = new V3(), b = new V3(), c = new V3(), f = new V3(), e = new V3();
          for (let t = 0; t < n; t += 3) {
            a.fromArray(P, t * 3); b.fromArray(P, t * 3 + 3); c.fromArray(P, t * 3 + 6);
            f.subVectors(c, b).cross(e.subVectors(a, b));
            const ax = Math.abs(f.x), ay = Math.abs(f.y), az = Math.abs(f.z);
            for (let v = 0; v < 3; v++) {
              const i = (t + v) * 3, x = P[i], y = P[i + 1], z = P[i + 2];
              let U, W;
              if (ay >= ax && ay >= az) { U = x * S + 0.3; W = z * S; } else if (ax >= az) { U = z * S; W = y * S + 0.6; } else { U = x * S + 0.1; W = y * S + 0.2; }
              uv[(t + v) * 2] = U; uv[(t + v) * 2 + 1] = W;
            }
          }
          bg.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
        }
        bg.computeBoundingSphere();
        out.push(new THREE.Mesh(bg, material));
      });
      return out;
    }
  }
  const group = (list, name) => { const g = new THREE.Group(); if (name) g.name = name; list.forEach(m => g.add(m)); return g; };

  function wheel(k, x, y, z, r, w, segs) {
    k.cylX('tyre', r, w, x, y, z, segs);
    const s = Math.sign(x);
    k.cylX('hub', r * 0.52, 0.04, x + s * (w / 2 + 0.005), y, z, segs);
    k.cylX('steel', r * 0.18, 0.06, x + s * (w / 2 + 0.03), y, z, 8);
    for (let i = 0; i < 8; i++) {                 // hub bolts
      const a = i * PI / 4, g = new THREE.CylinderGeometry(0.018, 0.018, 0.05, 5); g.rotateZ(PI / 2);
      g.translate(x + s * (w / 2 + 0.03), y + Math.cos(a) * r * 0.32, z + Math.sin(a) * r * 0.32); k.add(g, 'steel');
    }
    // tread blocks on the outer face
    for (let i = 0; i < segs; i++) {
      const a = (i + 0.5) / segs * 2 * PI, g = new THREE.BoxGeometry(w * 0.9, 0.04, r * 0.22);
      g.translate(0, r + 0.01, 0); g.applyMatrix4(R(a, 0, 0)); g.translate(x, y, z); k.add(g, 'tyre');
    }
  }
  function lamp(k, key, x, y, z, s) { k.box(key, x - s, x + s, y - s * 0.7, y + s * 0.7, z, z + 0.03); }

  /* ------------------------------------------------------------ vehicle defs */
  // Each builder fills: body kit (static, vehicle frame), and returns layout data.
  const DEF = {};

  DEF.launcher_lance = {
    name: 'Lance TEL', missile: 'missile_lance', canLen: 8.0, base: 0.2, mOff: 3.85,
    slots: [[-0.4, 0.46], [0.4, 0.46], [-0.4, 1.26], [0.4, 1.26]],
    pivot: [0, 1.9, -9.1], ramA: [0, 1.55, -1.4], ramB: [0, -0.12, 5.6],
    outriggers: [[1.3, 1.25, -1.2], [-1.3, 1.25, -1.2], [1.3, 1.25, -8.5], [-1.3, 1.25, -8.5]],
    mast: [-1.05, 2.66, 3.35], exhaust: [1.0, 3.55, 4.0], length: 17.9,
    build(k, lod) {
      const ws = lod === 'low' ? 12 : 20;
      // ---- tractor
      k.box('steel', -0.5, 0.5, 0.9, 1.22, 1.6, 8.2);                     // frame rails
      k.box('black', -1.28, 1.28, 0.78, 1.12, 8.2, 8.5);                   // bumper
      k.box('steel', -0.9, 0.9, 0.6, 0.78, 8.3, 8.45);                     // bash plate
      k.box('camo', -0.95, 0.95, 1.42, 2.36, 6.25, 8.0);                   // engine hood
      const hn = new THREE.BoxGeometry(1.9, 0.5, 0.5); hn.applyMatrix4(R(-0.5, 0, 0)); hn.translate(0, 2.2, 8.05); k.add(hn, 'camo'); // sloped hood nose
      k.box('camo', -0.95, 0.95, 1.2, 2.0, 8.0, 8.2);                      // grille surround
      k.box('black', -0.75, 0.75, 1.3, 1.95, 8.2, 8.23);                   // grille
      for (let i = 0; i < 6; i++) k.box('steel', -0.72, 0.72, 1.36 + i * 0.1, 1.39 + i * 0.1, 8.22, 8.25);
      [-1, 1].forEach(s => {
        lamp(k, 'lamp', s * 0.82, 1.6, 8.2, 0.12); lamp(k, 'amber', s * 0.82, 1.35, 8.2, 0.06);
        k.box('camo', s * 0.95, s * 1.3, 1.48, 1.58, 6.3, 7.75);            // front fenders
        const fs = new THREE.BoxGeometry(0.35, 0.1, 0.6); fs.applyMatrix4(R(0.55, 0, 0)); fs.translate(s * 1.12, 1.36, 7.9); k.add(fs, 'camo');
        k.box('camo', s * 0.85, s * 1.3, 1.28, 1.36, 1.2, 3.7);            // rear fenders
        k.cylZ('camo', 0.3, 1.3, s * 1.05, 1.0, 4.45, 16);                  // fuel tanks
        k.box('steel', s * 1.0, s * 1.3, 0.75, 0.8, 4.4, 5.8);              // step
        k.box('black', s * 1.26, s * 1.3, 2.25, 2.7, 6.0, 6.15);            // mirror
        k.box('steel', s * 1.24, s * 1.36, 2.3, 2.34, 6.05, 6.1);
        wheel(k, s * 1.05, 0.62, 7.0, 0.62, 0.52, ws);
        wheel(k, s * 1.05, 0.62, 3.1, 0.62, 0.52, ws);
        wheel(k, s * 1.05, 0.62, 1.8, 0.62, 0.52, ws);
      });
      // cab
      k.box('camo', -1.25, 1.25, 1.35, 2.92, 4.05, 6.2);
      const ws2 = new THREE.BoxGeometry(2.3, 0.8, 0.12); ws2.applyMatrix4(R(-0.18, 0, 0)); ws2.translate(0, 2.47, 6.24); k.add(ws2, 'glass');
      [-1, 1].forEach(s => { k.box('glass', s * 1.25, s * 1.27, 2.2, 2.75, 4.9, 5.95); k.box('black', s * 1.25, s * 1.27, 1.5, 2.1, 5.9, 5.94); });
      k.box('glass', -1.1, 1.1, 2.3, 2.75, 4.03, 4.05);
      k.box('camo', -1.2, 1.2, 2.92, 3.02, 4.1, 6.15);                     // roof
      k.box('steel', -0.9, 0.9, 3.02, 3.08, 4.3, 5.9);                     // roof rack
      lamp(k, 'amber', 0, 3.1, 5.9, 0.07);
      // equipment / power unit box behind cab
      k.box('camo', -1.2, 1.2, 1.35, 2.62, 2.45, 3.95);
      for (let i = 0; i < 5; i++) k.box('black', 1.2, 1.22, 1.6 + i * 0.18, 1.68 + i * 0.18, 2.7, 3.7);   // louvres
      k.box('steel', -1.22, -1.2, 1.5, 2.4, 2.6, 3.8);                     // hatch
      k.cylY('black', 0.09, 1.25, 1.0, 2.4, 4.0);                           // exhaust stack
      k.cylY('steel', 0.12, 0.35, 1.0, 2.6, 4.0);
      k.box('steel', -0.7, 0.7, 1.22, 1.34, 1.9, 3.1);                     // fifth wheel
      // ---- semitrailer
      k.box('camo', -1.12, 1.12, 1.5, 1.98, 0.4, 3.3);                     // gooseneck
      k.box('steel', -0.1, 0.1, 1.34, 1.5, 2.4, 2.6);                      // kingpin
      k.box('camo', -1.12, 1.12, 1.3, 1.98, -0.1, 0.45);                   // step down
      k.box('camo', -1.25, 1.25, 1.2, 1.55, -9.0, 0.0);                    // main deck
      k.box('steel', -0.45, 0.45, 0.95, 1.2, -9.0, 0.0);                   // spine
      [-1, 1].forEach(s => {
        k.box('camo', s * 0.75, s * 1.22, 0.65, 1.2, -3.6, -0.6);          // side lockers
        for (let i = 0; i < 3; i++) k.box('black', s * 1.22, s * 1.24, 0.72, 1.12, -3.5 + i * 1.0, -2.7 + i * 1.0);
        k.box('camo', s * 0.8, s * 1.3, 1.12, 1.18, -9.1, -3.9);           // mudguards
        [-4.55, -5.85, -7.15, -8.45].forEach(z => wheel(k, s * 1.05, 0.56, z, 0.56, 0.48, ws));
        k.box('steel', s * 0.3, s * 0.45, 0.5, 0.9, 0.9, 1.4);             // landing leg
        k.box('steel', s * 0.25, s * 0.5, 0.05, 0.12, 0.9, 1.4);
        lamp(k, 'tail', s * 1.0, 1.3, -9.06, 0.08);
      });
      k.box('black', -1.25, 1.25, 0.8, 1.0, -9.15, -9.0);                  // rear bumper
      // travel supports + pivot brackets
      k.box('steel', -0.8, 0.8, 1.55, 1.78, -0.9, -0.6);
      k.box('steel', -0.8, 0.8, 1.55, 1.78, -4.6, -4.3);
      k.box('steel', -1.0, -0.7, 1.55, 2.05, -9.35, -8.7); k.box('steel', 0.7, 1.0, 1.55, 2.05, -9.35, -8.7);
      k.box('steel', -0.25, 0.25, 1.3, 1.6, -1.9, -0.9);                   // ram anchor
    }
  };

  DEF.launcher_dart = {
    name: 'Dart TEL', missile: 'missile_dart', canLen: 6.2, base: 0.15, mOff: 3.05,
    slots: [[-0.28, 0.33], [0.28, 0.33], [-0.28, 0.89], [0.28, 0.89]],
    pivot: [0, 1.78, -5.95], ramA: [0, 1.5, 0.9], ramB: [0, -0.1, 4.2],
    outriggers: [[1.3, 1.2, -0.9], [-1.3, 1.2, -0.9], [1.3, 1.2, -5.5], [-1.3, 1.2, -5.5]],
    mast: [1.0, 2.75, 1.7], exhaust: [-1.05, 3.05, 3.7], length: 12.2,
    build(k, lod) {
      const ws = lod === 'low' ? 12 : 20;
      k.box('steel', -0.5, 0.5, 0.85, 1.2, -5.9, 5.8);                     // frame
      // cab-forward cab
      k.box('camo', -1.28, 1.28, 1.3, 2.85, 3.95, 5.9);
      const nose = new THREE.BoxGeometry(2.56, 0.7, 0.3); nose.applyMatrix4(R(0.35, 0, 0)); nose.translate(0, 1.45, 5.95); k.add(nose, 'camo');
      const wsc = new THREE.BoxGeometry(2.3, 0.75, 0.1); wsc.applyMatrix4(R(-0.12, 0, 0)); wsc.translate(0, 2.4, 5.93); k.add(wsc, 'glass');
      k.box('black', -1.3, 1.3, 0.8, 1.15, 5.8, 6.1);                      // bumper
      k.box('black', -0.9, 0.9, 1.5, 1.85, 5.95, 5.98);                    // grille
      k.box('camo', -1.22, 1.22, 2.85, 2.95, 4.0, 5.8);                    // roof
      lamp(k, 'amber', -0.9, 2.98, 5.6, 0.06); lamp(k, 'amber', 0.9, 2.98, 5.6, 0.06);
      [-1, 1].forEach(s => {
        lamp(k, 'lamp', s * 0.95, 1.55, 6.0, 0.12);
        k.box('glass', s * 1.28, s * 1.3, 2.05, 2.65, 4.3, 5.6);
        k.box('black', s * 1.28, s * 1.3, 1.45, 1.95, 4.3, 5.6);            // door lower
        k.box('black', s * 1.3, s * 1.36, 2.2, 2.6, 5.75, 5.85);            // mirror
        k.box('steel', s * 1.0, s * 1.32, 0.75, 0.8, 4.1, 4.9);             // step
        [4.35, 2.9, -2.6, -4.05].forEach(z => wheel(k, s * 1.07, 0.6, z, 0.6, 0.52, ws));
        k.box('camo', s * 0.8, s * 1.34, 1.22, 1.3, 1.9, 5.1);              // front fenders
        k.box('camo', s * 0.8, s * 1.34, 1.22, 1.3, -4.9, -1.75);           // rear fenders
        k.cylZ('camo', 0.3, 2.6, s * 1.02, 0.95, -1.5, 16);                 // fuel tanks
        k.box('camo', s * 0.7, s * 1.2, 0.6, 1.2, 1.3, 2.0);                // battery box
        lamp(k, 'tail', s * 1.05, 1.25, -6.03, 0.08);
      });
      // power unit + equipment
      k.box('camo', -1.2, 1.2, 1.3, 2.7, 1.35, 3.85);
      for (let i = 0; i < 5; i++) { k.box('black', 1.2, 1.22, 1.55 + i * 0.2, 1.64 + i * 0.2, 1.6, 3.5); k.box('black', -1.22, -1.2, 1.55 + i * 0.2, 1.64 + i * 0.2, 1.6, 3.5); }
      k.cylY('black', 0.08, 1.2, -1.05, 1.9, 3.7);
      k.cylY('steel', 0.11, 0.3, -1.05, 2.3, 3.7);
      // deck
      k.box('camo', -1.25, 1.25, 1.2, 1.5, -6.0, 1.35);
      k.box('black', -1.25, 1.25, 0.75, 0.95, -6.1, -5.95);
      k.box('steel', -0.7, 0.7, 1.5, 1.67, -1.4, -1.1);                     // travel support
      k.box('steel', -0.9, -0.62, 1.5, 1.95, -6.2, -5.6); k.box('steel', 0.62, 0.9, 1.5, 1.95, -6.2, -5.6);
      k.box('steel', -0.22, 0.22, 1.25, 1.55, 0.4, 1.3);                    // ram anchor
    }
  };

  /* ------------------------------------------------------------------ pack */
  function buildPack(def, lod) {
    const WE = window.RSWeaponsEast, kind = def.missile, k = new Kit();
    const lance = kind === 'missile_lance', L = def.canLen;
    // cradle: two beams, cross frames, base plate
    const xs = def.slots.map(s => s[0]), ys = def.slots.map(s => s[1]);
    const hw = Math.max(...xs) + (lance ? 0.44 : 0.3), top = Math.max(...ys) + (lance ? 0.44 : 0.3);
    [-1, 1].forEach(s => k.box('steel', s * (hw - 0.3) - 0.09, s * (hw - 0.3) + 0.09, -0.22, 0.02, 0.0, L + 0.2));
    [L * 0.12, L * 0.5, L * 0.88].forEach(z => {
      k.box('camo', -hw, hw, -0.04, 0.04, z - 0.12, z + 0.12);
      k.box('camo', -hw, hw, top - 0.04, top + 0.04, z - 0.12, z + 0.12);
      k.box('camo', -hw - 0.04, -hw + 0.04, -0.04, top, z - 0.12, z + 0.12);
      k.box('camo', hw - 0.04, hw + 0.04, -0.04, top, z - 0.12, z + 0.12);
    });
    k.box('camo', -hw, hw, -0.22, top, -0.2, def.base);                     // base plate / gas generator block
    k.box('steel', -0.3, 0.3, -0.36, -0.12, def.ramB[2] - 0.3, def.ramB[2] + 0.3);   // ram lug
    const pack = group(k.meshes(), 'pack');
    // per-slot canister, cap and round
    const slots = def.slots.map(([x, y]) => {
      const can = group(WE.canisterParts(kind, { loaded: false, cap: false, lod }).map(p => new THREE.Mesh(p.geometry, p.material)), 'canister');
      let cap;
      if (lance) {
        const cg = new THREE.SphereGeometry(0.36, 20, 8, 0, 2 * PI, 0, PI / 2);
        cg.applyMatrix4(new M4().makeScale(1, 0.35, 1)); cg.rotateX(PI / 2);
        cap = new THREE.Mesh(cg, WE.parts ? capMat() : mat('steel'));
      } else {
        cap = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.46, 0.03), capMat());
      }
      cap.position.set(0, 0, L);
      can.add(cap);
      const holder = new THREE.Group(); holder.position.set(x, y, def.base); holder.add(can);
      pack.add(holder);
      return { holder, can, cap, x, y };
    });
    return { pack, slots };
  }
  let _capMat = null;
  function capMat() { return _capMat || (_capMat = new THREE.MeshStandardMaterial({ color: 0x3a4530, roughness: 0.75, metalness: 0.12, side: THREE.DoubleSide })); }

  /* ------------------------------------------------------------- particles */
  class FX {
    constructor(parent) {
      this.parent = parent; this.list = []; this.free = [];
    }
    spawn(type, pos, vel, o) {
      const tx = textures();
      let sp = this.free.pop();
      if (!sp) {
        sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tx.smoke, transparent: true, depthWrite: false }));
        sp.userData.p = {};
      }
      const p = sp.userData.p;
      p.vel = vel.clone(); p.age = 0; p.life = o.life; p.s0 = o.s0; p.s1 = o.s1; p.a0 = o.a0; p.drag = o.drag || 0.5; p.rise = o.rise || 0;
      sp.material.map = o.flash ? tx.flash : tx.smoke;
      sp.material.blending = o.flash ? THREE.AdditiveBlending : THREE.NormalBlending;
      sp.material.color.set(o.color || 0xffffff); sp.material.opacity = o.a0; sp.material.rotation = Math.random() * PI * 2;
      sp.position.copy(pos); sp.scale.setScalar(o.s0); sp.visible = true; sp.renderOrder = 4;
      if (sp.parent !== this.parent) this.parent.add(sp);
      this.list.push(sp);
    }
    update(dt) {
      for (let i = this.list.length - 1; i >= 0; i--) {
        const sp = this.list[i], p = sp.userData.p;
        p.age += dt;
        if (p.age >= p.life) { sp.visible = false; this.list.splice(i, 1); this.free.push(sp); continue; }
        const f = p.age / p.life;
        p.vel.multiplyScalar(Math.max(0, 1 - p.drag * dt)); p.vel.y += p.rise * dt;
        sp.position.addScaledVector(p.vel, dt);
        if (sp.position.y < 0.2) sp.position.y = 0.2;
        sp.scale.setScalar(p.s0 + (p.s1 - p.s0) * Math.sqrt(f));
        sp.material.opacity = p.a0 * (1 - f) * (1 - f);
      }
    }
  }

  /* --------------------------------------------------------------- create */
  function create(kind, opts) {
    opts = opts || {};
    const def = DEF[kind], WE = window.RSWeaponsEast;
    if (!def || !WE) { if (!WE) console.error('models_launchers.js needs models_weapons_east.js'); return null; }
    const lod = opts.lod === 'low' ? 'low' : 'high';
    const root = new THREE.Group(); root.name = kind;

    // static body (built once per kind/lod, meshes shared)
    const key = kind + '|' + lod;
    if (!DEF[key]) { const k = new Kit(); def.build(k, lod); DEF[key] = k.meshes(); }
    DEF[key].forEach(m => root.add(new THREE.Mesh(m.geometry, m.material)));

    // erector pack on its pivot
    const pk = buildPack(def, lod);
    const pivot = new THREE.Group(); pivot.position.set(...def.pivot); pivot.add(pk.pack); root.add(pivot);

    // hydraulic ram: barrel + two telescoping stages, re-aimed each frame
    const unitCyl = r => { const g = new THREE.CylinderGeometry(r, r, 1, 12); g.translate(0, 0.5, 0); return g; };
    const ram = [new THREE.Mesh(unitCyl(0.15), mat('camo')), new THREE.Mesh(unitCyl(0.11), mat('chrome')), new THREE.Mesh(unitCyl(0.08), mat('chrome'))];
    ram.forEach(m => root.add(m));
    const ramA = new V3(...def.ramA), ramBl = new V3(...def.ramB);

    // outriggers: beam slides out sideways, then the jack leg drives down onto a pad
    const outs = def.outriggers.map(([x, y, z]) => {
      const s = Math.sign(x), g = new THREE.Group(); g.position.set(x - s * 0.9, y, z);
      const ak = new Kit();
      ak.box('camo', -0.55, 0.55, -0.12, 0.12, -0.14, 0.14);               // sliding beam
      ak.box('camo', s * 0.45 - 0.14, s * 0.45 + 0.14, -0.45, 0.25, -0.16, 0.16);   // jack housing
      ak.meshes().forEach(m => g.add(m));
      const leg = new THREE.Mesh(unitCyl(0.07), mat('chrome')); leg.rotation.x = PI; leg.position.set(s * 0.45, -0.4, 0); g.add(leg);
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.3, 0.08, 14), mat('steel')); pad.position.set(s * 0.45, -0.5, 0); g.add(pad);
      root.add(g);
      return { g, leg, pad, s, x, y };
    });
    // telescoping mast with antenna
    const mastG = new THREE.Group(); mastG.position.set(...def.mast); root.add(mastG);
    const mastSeg = [0.07, 0.055, 0.04].map((r, i) => { const m = new THREE.Mesh(unitCyl(r), mat(i ? 'chrome' : 'steel')); mastG.add(m); return m; });
    const mastTop = new THREE.Group(); mastG.add(mastTop);
    { const k = new Kit(); k.box('steel', -0.35, 0.35, 0.0, 0.05, -0.05, 0.05); k.cylY('black', 0.012, 1.2, 0.3, 0.05, 0, 6); k.cylY('black', 0.012, 0.9, -0.3, 0.05, 0, 6); k.box('camo', -0.2, 0.2, 0.05, 0.35, -0.1, 0.1); k.meshes().forEach(m => mastTop.add(m)); }

    // missiles in the canisters
    const missileAt = (sl) => {
      const m = WE.create(def.missile, { flight: false, lod });
      m.position.set(0, 0, def.mOff + 0.1); sl.can.add(m); sl.missile = m;
    };
    const loadedN = opts.loaded === undefined ? 4 : clamp(opts.loaded | 0, 0, 4);
    const slots = pk.slots.map((sl, i) => {
      sl.loaded = i < loadedN; sl.busy = false;
      if (sl.loaded) missileAt(sl); else sl.cap.visible = false;
      return sl;
    });

    // state
    const st = { e: 0, o: 0, m: 0, state: 'travel', idle: opts.idle !== false, t: 0, exT: 0, tasks: [] };
    if (opts.state === 'ready') { st.e = 1; st.o = 1; st.m = 1; st.state = 'ready'; }
    let fx = null;
    const fxParent = () => ud.fxParent || root.parent || root;
    const getFx = () => { const p = fxParent(); if (!fx || fx.parent !== p) fx = new FX(p); return fx; };
    const emit = (n, d) => { if (typeof ud.onEvent === 'function') ud.onEvent(n, d); };

    // --- pose from state
    const _a = new V3(), _b = new V3(), _d = new V3(), _up = new V3(0, 1, 0);
    function aimCyl(m, from, dir, len) { m.position.copy(from); m.quaternion.setFromUnitVectors(_up, dir); m.scale.set(1, Math.max(0.01, len), 1); }
    function pose() {
      pivot.rotation.x = -PI / 2 * ease(st.e);
      // ram: from anchor on the chassis to the lug under the pack
      pivot.updateMatrix();
      _b.copy(ramBl).applyMatrix4(pivot.matrix);
      _d.subVectors(_b, ramA); const d = _d.length(); _d.normalize();
      const barrel = Math.min(2.0, d);
      aimCyl(ram[0], ramA, _d, barrel);
      const s1 = 1.8 + (d - 1.8) * 0.5;
      aimCyl(ram[1], _a.copy(ramA).addScaledVector(_d, Math.min(1.7, d * 0.8)), _d, Math.max(0.1, s1 - Math.min(1.7, d * 0.8) + 0.2));
      const s2from = Math.min(d - 0.1, Math.max(1.9, s1 - 0.2));
      aimCyl(ram[2], _a.copy(ramA).addScaledVector(_d, s2from), _d, d - s2from);
      // outriggers: stowed pointing up along the side → planted on the ground
      const o1 = ease(clamp(st.o * 2, 0, 1)), o2 = ease(clamp(st.o * 2 - 1, 0, 1));
      outs.forEach(r => {
        r.g.position.x = r.x - r.s * 0.9 * (1 - o1);
        const len = 0.12 + (r.y - 0.5) * o2;                 // leg reaches the ground when fully down
        r.leg.scale.y = len; r.pad.position.y = -0.4 - len - 0.04;
      });
      // mast
      const mh = 0.3 + 3.7 * ease(st.m);
      mastSeg[0].scale.y = Math.min(mh, 1.4); mastSeg[1].position.y = 0; mastSeg[1].scale.y = Math.max(0.3, Math.min(mh, 2.7));
      mastSeg[2].scale.y = mh; mastTop.position.y = mh;
    }

    // --- sequencing
    function after(t, fn) { st.tasks.push({ t: st.t + t, fn }); }
    function deploy() {
      if (st.state === 'ready' || st.state === 'deploying') return 0;
      st.state = 'deploying'; st.goal = 'ready';
      return (1 - st.o) * 1.6 + (1 - st.e) * 4.2;
    }
    function stow() {
      if (st.state === 'travel' || st.state === 'stowing') return 0;
      if (slots.some(s => s.busy)) return 0;
      st.state = 'stowing'; st.goal = 'travel';
      return st.e * 4.2 + st.o * 1.6;
    }

    // --- cold launch
    const flights = [];
    function launch(slotIdx, lo) {
      lo = lo || {};
      if (st.state !== 'ready') return null;
      if (slotIdx === undefined || slotIdx === null) slotIdx = slots.findIndex(s => s.loaded && !s.busy);
      const sl = slots[slotIdx];
      if (!sl || !sl.loaded || sl.busy) return null;
      root.updateMatrixWorld(true);
      const parent = fxParent(); parent.updateMatrixWorld(true);
      const inv = new M4().copy(parent.matrixWorld).invert();
      const toP = new M4().multiplyMatrices(inv, sl.can.matrixWorld);          // canister frame → parent frame
      const axis = new V3(0, 0, 1).transformDirection(toP);
      const mouth = new V3(0, 0, def.canLen).applyMatrix4(toP);
      const base = new V3(0, 0, 0).applyMatrix4(toP);
      const start = new V3(0, 0, def.mOff + 0.1).applyMatrix4(toP);
      // target direction (in parent frame)
      let dir = lo.dir ? lo.dir.clone().normalize() : null;
      if (!dir) {
        const hdg = new V3(0, 0, 1).transformDirection(new M4().multiplyMatrices(inv, root.matrixWorld));
        const az = lo.azimuth !== undefined ? lo.azimuth : Math.atan2(hdg.x, hdg.z), el = lo.elevation !== undefined ? lo.elevation : 0.6;
        dir = new V3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
      }
      // hand the round from the canister to the world
      sl.can.remove(sl.missile);
      const carried = sl.missile, flying = WE.create(def.missile, { flight: true, lod });
      const m = new THREE.Group(); m.name = def.missile + '_launch';
      m.add(carried, flying); carried.position.set(0, 0, 0); flying.visible = false; flying.userData.setMotor(false);
      m.userData = flying.userData;
      m.position.copy(start); m.quaternion.setFromUnitVectors(new V3(0, 0, 1), axis);
      parent.add(m);
      sl.missile = null; sl.loaded = false; sl.busy = true;
      // cap blows off
      sl.cap.visible = false;
      const cap = sl.cap.clone(); cap.visible = true; cap.position.copy(mouth); cap.quaternion.copy(m.quaternion);
      parent.add(cap);
      const side = new V3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize().multiplyScalar(4);
      const F = getFx(), big = def.missile === 'missile_lance' ? 1 : 0.7;
      // gas-generator puff out of the mouth and the base, dust ring on the ground
      for (let i = 0; i < 12; i++) F.spawn('puff', mouth, axis.clone().multiplyScalar(6 + Math.random() * 8).add(new V3((Math.random() - 0.5) * 5, 0, (Math.random() - 0.5) * 5)), { life: 2.6 + Math.random(), s0: 1.2 * big, s1: 6 * big, a0: 0.85, color: 0x46423d, drag: 1.2, rise: 0.4 });
      for (let i = 0; i < 6; i++) F.spawn('puff', base, new V3((Math.random() - 0.5) * 6, 1.5, (Math.random() - 0.5) * 6), { life: 2.2, s0: 1.0 * big, s1: 4.5 * big, a0: 0.7, color: 0x5a554e, drag: 1.4, rise: 0.3 });
      const g0 = new V3(0, 0.3, 0).applyMatrix4(new M4().multiplyMatrices(inv, root.matrixWorld));
      for (let i = 0; i < 16; i++) { const a = i / 16 * PI * 2; F.spawn('dust', g0.clone().add(new V3(Math.cos(a) * 3, 0, Math.sin(a) * 5)), new V3(Math.cos(a) * 9, 0.6, Math.sin(a) * 9), { life: 3.2, s0: 2.5, s1: 8, a0: 0.55, color: 0xa39277, drag: 1.1 }); }
      const f = { m, carried, flying, sl, axis, start, dir, t: 0, speed: 0, ign: false, unf: false, hand: false, cap, capV: axis.clone().multiplyScalar(22).add(side), capW: new V3(Math.random() * 8, Math.random() * 8, 0),
        handoffAt: lo.handoffAt || 2.6, onHandoff: lo.onHandoff, trailT: 0, q0: m.quaternion.clone(), q1: new Q().setFromUnitVectors(new V3(0, 0, 1), dir), vel: new V3() };
      flights.push(f);
      emit('launch', { slot: slotIdx, missile: m });
      return m;
    }
    function salvo(n, lo, gap) {
      let fired = 0; gap = gap || 1.5;
      for (let i = 0; i < slots.length && fired < n; i++) {
        if (slots[i].loaded && !slots[i].busy) { const idx = i; after(fired * gap, () => launch(idx, lo)); fired++; }
      }
      return fired;
    }
    // [RS] harder catapult throw (~20 m up), visible slow-down and a short hang at the apex, then the motor lights (Kelbo: "throw it up, then light it")
    const V0 = 40, DEC = 42, IGN = 1.0, UNF = 0.3, TILT0 = 0.6, TILT = 0.12;   // [RS] ref clip 2: first thunk → ignition ≈ 1.0 s; apex ~19 m at 0.95 s   // apex ~20 m at 1.05 s, ~0.15 s hang, keeps the throw inside the hatch view
    function updateFlight(f, dt) {
      f.t += dt;
      const t = f.t, m = f.m;
      if (!f.ign) {
        const ta = V0 / DEC, tc = Math.min(t, ta), s = V0 * tc - 0.5 * DEC * tc * tc - (t > ta ? 0.5 * 9.8 * (t - ta) * (t - ta) : 0);   // [RS] rise, stop, start to drop
        m.position.copy(f.start).addScaledVector(f.axis, s);
        f.speed = t < ta ? V0 - DEC * t : -9.8 * (t - ta);
        if (t > TILT0) m.quaternion.copy(f.q0).slerp(f.q1, TILT * ease(clamp((t - TILT0) / (IGN - TILT0), 0, 1)));   // [RS] gas-dynamic tilt toward the target before ignition
      }
      if (!f.unf && t >= UNF) { f.unf = true; f.carried.visible = false; f.flying.visible = true; }
      if (!f.ign && t >= IGN) {
        f.ign = true; f.flying.userData.setMotor(true);
        const F = getFx(), tail = new V3(0, 0, -m.userData.length / 2).applyQuaternion(m.quaternion).add(m.position);
        F.spawn('flash', tail, new V3(), { life: 0.25, s0: 3, s1: 7, a0: 1, flash: true });
        for (let i = 0; i < 6; i++) F.spawn('puff', tail, new V3((Math.random() - 0.5) * 6, -4, (Math.random() - 0.5) * 6), { life: 2.5, s0: 1.5, s1: 6, a0: 0.8, color: 0xf1efe8, drag: 1.2 });
        emit('ignite', { missile: m });
      }
      if (f.ign) {
        // [RS] match the sim: near-vertical climb, pitch over toward the target, ~16 g (Lance) / ~26 g (Dart) boost
        const lance = def.missile === 'missile_lance', k = clamp((t - IGN) / (lance ? 2.6 : 1.8), 0, 1);
        m.quaternion.copy(f.q0).slerp(f.q1, TILT + (1 - TILT) * k * k * (3 - 2 * k));
        if (f.speed < 0) f.speed = 0;
        f.speed += (lance ? 160 : 260) * dt;
        f.vel.set(0, 0, 1).applyQuaternion(m.quaternion).multiplyScalar(f.speed);
        m.position.addScaledVector(f.vel, dt);
        f.trailT -= dt;
        if (f.trailT <= 0) {
          f.trailT = 0.025;
          const tail = new V3(0, 0, -m.userData.length / 2 - 0.4).applyQuaternion(m.quaternion).add(m.position);
          getFx().spawn('trail', tail, new V3((Math.random() - 0.5) * 1.2, 0.3, (Math.random() - 0.5) * 1.2), { life: 3.5, s0: 0.9, s1: 4.2, a0: 0.75, color: 0xe7e6e0, drag: 0.8, rise: 0.25 });
        }
      } else {
        f.vel.copy(f.axis).multiplyScalar(f.speed);
      }
      if (m.userData.update) m.userData.update(dt);
      // cap tumbles away
      if (f.cap) {
        f.capV.y -= 9.8 * dt; f.cap.position.addScaledVector(f.capV, dt);
        f.cap.rotation.x += f.capW.x * dt; f.cap.rotation.y += f.capW.y * dt;
        if (f.cap.position.y < 0.2 || t > 4) { f.cap.parent && f.cap.parent.remove(f.cap); f.cap = null; }
      }
      if (!f.hand && t >= f.handoffAt) {
        f.hand = true; f.sl.busy = false;
        const data = { missile: m, position: m.position.clone(), velocity: f.vel.clone(), direction: new V3(0, 0, 1).applyQuaternion(m.quaternion) };
        emit('handoff', data);
        if (typeof f.onHandoff === 'function') { f.onHandoff(data); f.done = !f.cap; f.external = true; }
      }
      if (f.external) { if (!f.cap) f.done = true; return; }
      if (t > f.handoffAt + 7) { m.parent && m.parent.remove(m); f.done = true; }
    }

    // --- reload: spent canister swings out sideways, fresh one swings in
    function reload(slotIdx) {
      if (slotIdx === undefined || slotIdx === null) slotIdx = slots.findIndex(s => !s.loaded && !s.busy);
      const sl = slots[slotIdx];
      if (!sl || sl.loaded || sl.busy) return 0;
      sl.busy = true; sl.rl = 0; sl.rside = sl.x >= 0 ? 1 : -1;
      return 2.4;
    }
    function updateReload(sl, dt) {
      sl.rl += dt;
      const t = sl.rl, out = 3.2 * sl.rside;
      if (t < 1.1) sl.holder.position.x = sl.x + out * ease(t / 1.1);
      else {
        if (!sl.loaded) { sl.loaded = true; sl.cap.visible = true; missileAt(sl); }
        sl.holder.position.x = sl.x + out * (1 - ease(clamp((t - 1.3) / 1.1, 0, 1)));
      }
      if (t >= 2.4) { sl.holder.position.x = sl.x; sl.busy = false; sl.rl = undefined; emit('reloaded', { slot: slots.indexOf(sl) }); }
    }

    function update(dt) {
      dt = Math.min(dt || 0.016, 0.1);
      st.t += dt;
      for (let i = st.tasks.length - 1; i >= 0; i--) if (st.tasks[i].t <= st.t) { const tk = st.tasks.splice(i, 1)[0]; tk.fn(); }
      // deploy: outriggers first, then erector; stow: erector first, then outriggers. Mast rides with the outriggers.
      if (st.state === 'deploying') {
        if (st.o < 1) st.o = Math.min(1, st.o + dt / 1.6);
        else st.e = Math.min(1, st.e + dt / 4.2);
        if (st.o >= 1 && st.e >= 1) { st.state = 'ready'; emit('deployed', {}); }
      } else if (st.state === 'stowing') {
        if (st.e > 0) st.e = Math.max(0, st.e - dt / 4.2);
        else st.o = Math.max(0, st.o - dt / 1.6);
        if (st.e <= 0 && st.o <= 0) { st.state = 'travel'; emit('stowed', {}); }
      }
      const mt = st.state === 'ready' || st.state === 'deploying' ? 1 : (st.state === 'stowing' && st.e > 0 ? 1 : 0);
      st.m += clamp(mt - st.m, -dt / 2, dt / 2);
      pose();
      for (let i = flights.length - 1; i >= 0; i--) { updateFlight(flights[i], dt); if (flights[i].done) flights.splice(i, 1); }
      slots.forEach(sl => { if (sl.rl !== undefined) updateReload(sl, dt); });
      // idle engine exhaust
      if (st.idle) {
        st.exT -= dt;
        if (st.exT <= 0) {
          st.exT = 0.22 + Math.random() * 0.15;
          root.updateMatrixWorld(true);
          const p = fxParent(); p.updateMatrixWorld(true);
          const pos = new V3(...def.exhaust).applyMatrix4(root.matrixWorld).applyMatrix4(new M4().copy(p.matrixWorld).invert());
          getFx().spawn('exhaust', pos, new V3((Math.random() - 0.5) * 0.4, 1.4, (Math.random() - 0.5) * 0.4), { life: 1.6, s0: 0.25, s1: 1.3, a0: 0.35, color: 0x4a4a46, drag: 0.6, rise: 0.3 });
        }
      }
      if (fx) fx.update(dt);
    }

    pose();
    const ud = root.userData = {
      kind, name: def.name, length: def.length, missileKind: def.missile,
      get state() { return st.state; },
      get slots() { return slots.map(s => ({ loaded: s.loaded, busy: s.busy })); },
      get rounds() { return slots.filter(s => s.loaded).length; },
      update, deploy, stow, launch, salvo, reload,
      setIdle(v) { st.idle = !!v; },
      setState(s) { if (s === 'ready') { st.e = st.o = st.m = 1; st.state = 'ready'; } else { st.e = st.o = st.m = 0; st.state = 'travel'; } pose(); },
      onEvent: null, fxParent: null
    };
    return root;
  }

  const Launchers = { version: 'launchers-1.0', kinds: Object.keys(DEF).filter(k => k.indexOf('|') < 0), create };
  window.RSLaunchers = Launchers;

  let M = (typeof Models !== 'undefined') ? Models : window.Models; // eslint-disable-line no-undef
  if (!M) M = window.Models = { version: '0', kinds: [], create: null };
  const prev = typeof M.create === 'function' ? M.create.bind(M) : null;
  M.create = function (kind, opts) {
    if (kind === 'launcher_lance' || kind === 'launcher_dart') return create(kind, opts);
    return prev ? prev(kind, opts) : null;
  };
  const ks = new Set(M.kinds || []); ks.add('launcher_lance'); ks.add('launcher_dart');
  M.kinds = Array.from(ks);
  M.launchers = Launchers;
  M.version = (M.version || '0') + '+' + Launchers.version;
})();
