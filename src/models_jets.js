/* ============================================================================
 * models_jets.js — Red Skies / Weapons Hold · hostile jet models
 * Prairie Blue Studio · procedural, no textures, three.js r128+
 *
 * Plugs into the Models API from the build plan:
 *   Models.create('jet_hostile', { variant: 'fighter' })  → THREE.Group
 *   Models.create('jet_hostile_bomber')                    → THREE.Group
 *
 * Variants (all fictional, generic Western styling — not copies of real types):
 *   fighter  "Kestrel"  twin-engine, twin-tail air-superiority fighter   ~19 m
 *   light    "Wasp"     single-engine light multirole fighter            ~15 m
 *   stealth  "Shade"    faceted low-observable strike jet                ~17 m
 *   bomber   "Anvil"    four-engine swept-wing heavy bomber              ~45 m
 *   awacs    "Lantern"  twin-engine airborne early-warning jet + rotodome ~46 m
 *
 * opts: { variant, scheme: 'woodland'|'desert'|'grey'|'darkgrey',
 *         loadout: true (preset default) | false | 'cap'|'sead'|'strike'|'cruise',
 *         markings: true, lod: 'high'|'low' }
 * Weapons: load models_weapons.js BEFORE this file to get the detailed stores
 *   (Spire/Needle AAMs, Ember ARM, Hatchet racks, Kite glide bombs, Farstrike).
 *
 * Conventions: 1 unit = 1 m, +Z forward (nose), +Y up, origin at the aircraft's
 * centre. Materials are MeshStandardMaterial (one directional + hemisphere light
 * is enough). Two-tone camo is drawn by a small shader patch, not a texture.
 *
 * Returned group.userData:
 *   kind, variant, name, role, length, span, height
 *   nozzles  : Object3D[]  exhaust points (attach contrails/smoke here)
 *   setThrottle(t 0..1) : flame length; >0.8 = afterburner (fighters only)
 *   update(dt)          : flame flicker + AWACS rotodome spin; call per frame
 *
 * Load order: include AFTER models.js so it can extend the existing Models object.
 * Geometry is built once per option-set and cached; create() returns cheap clones.
 * ==========================================================================*/
(function () {
  'use strict';
  const THREE = window.THREE;
  if (!THREE) { console.error('models_jets.js: THREE not found'); return; }
  const V3 = THREE.Vector3, M4 = THREE.Matrix4, PI = Math.PI;

  /* ---------------------------------------------------------------- materials */
  const SCHEMES = {
    woodland: { a: 0x4d5a34, b: 0x8c7c56, under: 0x9ea6a8 },
    desert:   { a: 0xb49c6c, b: 0x7b6548, under: 0xb9b8ae },
    grey:     { a: 0x77808a, b: 0x535b64, under: 0xa9afb4 },
    darkgrey: { a: 0x505760, b: 0x3a4047, under: 0x737a82 }
  };

  const CAMO_VS_DECL = 'varying vec3 vCamoP;\nvarying vec3 vCamoN;\n';
  const CAMO_FS_DECL = `
varying vec3 vCamoP; varying vec3 vCamoN;
uniform vec3 uCamoA; uniform vec3 uCamoB; uniform vec3 uCamoU; uniform float uCamoS; uniform float uPanel;
float cHash(vec3 p){ p = fract(p*0.3183099+0.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float cNoise(vec3 x){ vec3 i=floor(x); vec3 f=fract(x); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(cHash(i),cHash(i+vec3(1,0,0)),f.x),mix(cHash(i+vec3(0,1,0)),cHash(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(cHash(i+vec3(0,0,1)),cHash(i+vec3(1,0,1)),f.x),mix(cHash(i+vec3(0,1,1)),cHash(i+vec3(1,1,1)),f.x),f.y),f.z); }
float cPanel(float v, float s){ float fw = fwidth(v); float d = abs(fract(v / s + 0.5) - 0.5) * s;
  float keep = step(0.3, cHash(vec3(floor(v / s + 0.5), s * 7.1, 3.3)));
  return keep * (1.0 - smoothstep(0.01, 0.01 + fw * 1.2, d)) * (1.0 - smoothstep(s * 0.02, s * 0.07, fw)); }
`;
  const CAMO_FS_COLOR = `
  vec3 cp = vCamoP * uCamoS;
  float cn = cNoise(cp) * 0.65 + cNoise(cp * 2.3 + 7.1) * 0.35;
  float cm = smoothstep(0.47, 0.53, cn);
  vec3 cTop = mix(uCamoA, uCamoB, cm);
  float cUnder = 1.0 - smoothstep(-0.55, -0.2, normalize(vCamoN).y);
  vec3 cCol = mix(cTop, uCamoU, cUnder);
  cCol *= 0.9 + 0.12 * cNoise(vCamoP * 3.1);
  if (uPanel > 0.0) { // engraved panel lines: frames along z, stringers on flat and side faces
    vec3 cN = normalize(vCamoN);
    float pz = cPanel(vCamoP.z, uPanel);
    float px = 0.7 * cPanel(vCamoP.x + 0.37, uPanel * 1.9) * step(0.6, abs(cN.y));
    float py = 0.7 * cPanel(vCamoP.y + 0.21, uPanel * 0.8) * step(0.6, abs(cN.x));
    cCol *= 1.0 - 0.2 * max(pz, max(px, py));
  }
  vec4 diffuseColor = vec4( cCol, opacity );
`;
  // a little self-light so undersides stay readable when seen from the ground
  const CAMO_FS_EMIS = '#include <emissivemap_fragment>\n totalEmissiveRadiance += cCol * (0.05 + 0.2 * cUnder);';
  function camoMaterial(scheme, scale) {
    const s = SCHEMES[scheme] || SCHEMES.woodland;
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.78, metalness: 0.12, side: THREE.DoubleSide });
    const u = {
      uCamoA: { value: new THREE.Color(s.a) }, uCamoB: { value: new THREE.Color(s.b) },
      uCamoU: { value: new THREE.Color(s.under) }, uCamoS: { value: scale }, uPanel: { value: 0 }
    };
    m.extensions = { derivatives: true };
    m.onBeforeCompile = function (sh) {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = CAMO_VS_DECL + sh.vertexShader.replace('#include <begin_vertex>',
        '#include <begin_vertex>\n vCamoP = position; vCamoN = normal;');
      sh.fragmentShader = CAMO_FS_DECL + sh.fragmentShader.replace(
        'vec4 diffuseColor = vec4( diffuse, opacity );', CAMO_FS_COLOR).replace('#include <emissivemap_fragment>', CAMO_FS_EMIS);
    };
    m.userData.camo = u;
    return m;
  }

  const MAT = {}; // shared plain materials, created lazily
  function mat(name) {
    if (MAT[name]) return MAT[name];
    const D = THREE.DoubleSide;
    const defs = {
      dark:    () => new THREE.MeshStandardMaterial({ color: 0x24272a, roughness: 0.7, metalness: 0.2, side: D }),
      radome:  () => new THREE.MeshStandardMaterial({ color: 0x5b6066, roughness: 0.6, metalness: 0.05, side: D }),
      metal:   () => new THREE.MeshStandardMaterial({ color: 0x77716a, roughness: 0.38, metalness: 0.75, side: D }),
      burnt:   () => new THREE.MeshStandardMaterial({ color: 0x3e3833, roughness: 0.5, metalness: 0.6, side: D }),
      glass:   () => new THREE.MeshStandardMaterial({ color: 0x223441, roughness: 0.08, metalness: 0.9, side: D }),
      goldglass: () => new THREE.MeshStandardMaterial({ color: 0x6a5a2c, roughness: 0.1, metalness: 0.95, side: D }),
      canopyC: () => new THREE.MeshStandardMaterial({ color: 0x3d5566, roughness: 0.04, metalness: 0.7, transparent: true, opacity: 0.42, depthWrite: false, side: D }),
      canopyG: () => new THREE.MeshStandardMaterial({ color: 0x8a7336, roughness: 0.05, metalness: 0.85, transparent: true, opacity: 0.55, depthWrite: false, side: D }),
      seam:    () => new THREE.MeshStandardMaterial({ color: 0x1f231f, roughness: 0.85, metalness: 0.05, side: D }),
      suit:    () => new THREE.MeshStandardMaterial({ color: 0x5a5f45, roughness: 0.9, metalness: 0.0, side: D }),
      helmet:  () => new THREE.MeshStandardMaterial({ color: 0x7c8078, roughness: 0.5, metalness: 0.1, side: D }),
      visor:   () => new THREE.MeshStandardMaterial({ color: 0x1a1406, roughness: 0.05, metalness: 1.0, side: D }),
      hud:     () => new THREE.MeshBasicMaterial({ color: 0x7dffa0, transparent: true, opacity: 0.25, depthWrite: false, side: D }),
      white:   () => new THREE.MeshStandardMaterial({ color: 0xdcdbd2, roughness: 0.55, metalness: 0.1, side: D }),
      olive:   () => new THREE.MeshStandardMaterial({ color: 0x4f5638, roughness: 0.7, metalness: 0.1, side: D }),
      red:     () => new THREE.MeshStandardMaterial({ color: 0xb02a1f, roughness: 0.6, metalness: 0.05, side: D }),
      black:   () => new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.6, metalness: 0.05, side: D }),
      lvA:     () => new THREE.MeshStandardMaterial({ color: 0x2c3036, roughness: 0.7, metalness: 0.05, side: D }),
      lvB:     () => new THREE.MeshStandardMaterial({ color: 0x5c626a, roughness: 0.7, metalness: 0.05, side: D }),
      hot:     () => new THREE.MeshBasicMaterial({ color: 0x9a3a10, side: D }),
      navR:    () => new THREE.MeshBasicMaterial({ color: 0xff3020 }),
      navG:    () => new THREE.MeshBasicMaterial({ color: 0x30ff60 }),
      navW:    () => new THREE.MeshBasicMaterial({ color: 0xffffff }),
      slime:   () => new THREE.MeshBasicMaterial({ color: 0x9dff7a }),
      flameO:  () => new THREE.MeshBasicMaterial({ color: 0xff6a18, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: D }),
      flameI:  () => new THREE.MeshBasicMaterial({ color: 0xfff1c8, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: D }),
      diamond: () => new THREE.MeshBasicMaterial({ color: 0xffb060, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false })
    };
    return (MAT[name] = defs[name]());
  }

  /* ------------------------------------------------------ geometry utilities */
  function signedVolume(pos, idx) {
    let v = 0; const a = new V3(), b = new V3(), c = new V3();
    const n = idx ? idx.length : pos.count;
    for (let i = 0; i < n; i += 3) {
      const i0 = idx ? idx[i] : i, i1 = idx ? idx[i + 1] : i + 1, i2 = idx ? idx[i + 2] : i + 2;
      a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1); c.fromBufferAttribute(pos, i2);
      v += a.dot(b.cross(c));
    }
    return v;
  }

  // Loft closed rings (arrays of V3 with equal counts) into a skin with optional end caps.
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
      for (let j = 0; j < N; j++) {
        const a = ri * N + j, b = ri * N + (j + 1) % N;
        rev ? idx.push(ci, a, b) : idx.push(ci, b, a);
      }
    };
    if (o.capStart !== false) cap(0, false);
    if (o.capEnd !== false) cap(rings.length - 1, true);
    let g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    if (signedVolume(g.attributes.position, idx) < 0) {
      for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
      g.setIndex(idx);
    }
    if (o.flat) g = g.toNonIndexed();
    g.computeVertexNormals();
    return g;
  }

  // Superellipse cross-section; separate top/bottom half-heights, x-centre offset.
  function sring(s, N) {
    const pts = [], e = 2 / (s.n || 2), cx = s.x || 0, cy = s.y || 0;
    for (let i = 0; i < N; i++) {
      const a = i / N * 2 * PI, c = Math.cos(a), sn = Math.sin(a);
      pts.push(new V3(cx + s.w * Math.sign(c) * Math.pow(Math.abs(c), e),
        cy + (sn >= 0 ? s.t : s.b) * Math.sign(sn) * Math.pow(Math.abs(sn), e), s.z));
    }
    return pts;
  }
  // Faceted chine section (stealth). 8 points, counter-clockwise.
  function chineRing(s) {
    const w = s.w, t = s.t, b = s.b, y = s.y || 0, x = s.x || 0, z = s.z;
    return [[w, 0], [0.55 * w, 0.78 * t], [0.18 * w, t], [-0.18 * w, t], [-0.55 * w, 0.78 * t],
      [-w, 0], [-0.5 * w, -b], [0.5 * w, -b]].map(p => new V3(x + p[0], y + p[1], z));
  }

  // Smooth (cardinal Hermite) interpolation of station tables along z.
  const KEYS = ['w', 't', 'b', 'y', 'n', 'x'];
  function prepStations(st) {
    st = st.map(s => Object.assign({ y: 0, n: 2, x: 0 }, s)).sort((a, b) => a.z - b.z);
    return st;
  }
  function sampleStation(st, z) {
    const L = st.length;
    if (z <= st[0].z) return Object.assign({}, st[0], { z });
    if (z >= st[L - 1].z) return Object.assign({}, st[L - 1], { z });
    let i = 0; while (st[i + 1].z < z) i++;
    const s0 = st[i], s1 = st[i + 1], h = s1.z - s0.z, t = (z - s0.z) / h;
    const t2 = t * t, t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
    const slope = (k, j) => {
      if (j === 0) return (st[1][k] - st[0][k]) / (st[1].z - st[0].z);
      if (j === L - 1) return (st[j][k] - st[j - 1][k]) / (st[j].z - st[j - 1].z);
      return (st[j + 1][k] - st[j - 1][k]) / (st[j + 1].z - st[j - 1].z);
    };
    const out = { z };
    KEYS.forEach(k => {
      out[k] = h00 * s0[k] + h10 * h * slope(k, i) + h01 * s1[k] + h11 * h * slope(k, i + 1);
    });
    out.w = Math.max(out.w, 0.004); out.t = Math.max(out.t, 0.004); out.b = Math.max(out.b, 0.004);
    out.n = Math.max(out.n, 0.8);
    return out;
  }
  function loftStations(st, o) {
    st = prepStations(st);
    const z0 = st[0].z, z1 = st[st.length - 1].z, step = o.step || 0.4;
    const n = Math.max(2, Math.ceil((z1 - z0) / step));
    const rings = [];
    for (let i = 0; i <= n; i++) {
      const s = sampleStation(st, z0 + (z1 - z0) * i / n);
      rings.push(o.chine ? chineRing(s) : sring(s, o.N || 24));
    }
    return loft(rings, o);
  }
  // Point + basis on a station-defined surface (a: 0 = +X side, PI/2 = top).
  function surfFrame(st, z, a, chine) {
    const P = (zz, aa) => {
      const s = sampleStation(st, zz), e = 2 / s.n, c = Math.cos(aa), sn = Math.sin(aa);
      return new V3((s.x || 0) + s.w * Math.sign(c) * Math.pow(Math.abs(c), e),
        (s.y || 0) + (sn >= 0 ? s.t : s.b) * Math.sign(sn) * Math.pow(Math.abs(sn), e), zz);
    };
    const p = P(z, a);
    const tz = P(z + 0.05, a).sub(P(z - 0.05, a)).normalize();
    const ta = P(z, a + 0.02).sub(P(z, a - 0.02)).normalize();
    const nrm = new V3().crossVectors(ta, tz).normalize();
    const b = new V3().crossVectors(nrm, tz).normalize();
    const m = new M4().makeBasis(b, nrm, tz).setPosition(p);
    return m;
  }

  // Tapered wing / fin panel. Span along +X in local frame, chord along Z (LE at larger z).
  function nacaHalf(x, t) {
    return 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x * x * x - 0.1036 * x * x * x * x);
  }
  function wingGeom(p, M, flat) {
    M = M || 9;
    const ring = (x, y, zLE, c, t) => {
      const pts = [];
      // upper: TE -> LE, lower: LE -> TE (cosine spacing)
      const xs = []; for (let i = 0; i <= M; i++) xs.push((1 - Math.cos(i / M * PI)) / 2);
      for (let i = M; i >= 0; i--) pts.push(new V3(x, y + nacaHalf(xs[i], t) * c + 0.002, zLE - xs[i] * c));
      for (let i = 1; i < M; i++) pts.push(new V3(x, y - nacaHalf(xs[i], t) * c - 0.002, zLE - xs[i] * c));
      return pts;
    };
    const rings = [];
    const segs = p.segs || 1;
    for (let k = 0; k <= segs; k++) {
      const f = k / segs, L = (a, b) => a + (b - a) * f;
      rings.push(ring(L(p.x0, p.x1), L(p.y0 || 0, p.y1 || 0), L(p.z0, p.z1), L(p.c0, p.c1), L(p.t0, p.t1)));
    }
    return loft(rings, { flat });
  }
  function wingPoint(p, spanF, chordF, side) {
    const L = (a, b) => a + (b - a) * spanF;
    const c = L(p.c0, p.c1), t = L(p.t0, p.t1);
    return new V3(L(p.x0, p.x1), L(p.y0 || 0, p.y1 || 0) + side * (nacaHalf(chordF, t) * c + 0.012), L(p.z0, p.z1) - chordF * c);
  }

  function latheZ(profile, segs) { // profile: [[r, z], ...] low z → high z
    const g = new THREE.LatheGeometry(profile.map(p => new THREE.Vector2(Math.max(p[0], 0.0005), p[1])), segs || 20);
    g.rotateX(PI / 2);
    return g;
  }
  function cylZ(r0, r1, len, segs, open) { // along +Z, r0 at back (-len/2), r1 at front
    const g = new THREE.CylinderGeometry(r1, r0, len, segs || 16, 1, !!open);
    g.rotateX(PI / 2);
    return g;
  }
  function box(w, h, l) { return new THREE.BoxGeometry(w, h, l); }

  /* -------------------------------------------------------------------- Sink
   * Collects static geometry, baked into the aircraft frame, bucketed by material. */
  class Sink {
    constructor() { this.b = new Map(); this.m = new M4(); }
    add(geom, material, local) {
      let g = geom.index ? geom.toNonIndexed() : geom.clone();
      if (!g.attributes.normal) g.computeVertexNormals();
      Object.keys(g.attributes).forEach(k => { if (k !== 'position' && k !== 'normal') g.deleteAttribute(k); });
      const m = local ? this.m.clone().multiply(local) : this.m;
      g.applyMatrix4(m);
      if (m.determinant() < 0) { // mirrored: restore winding so DoubleSide lighting stays correct
        ['position', 'normal'].forEach(k => {
          const A = g.attributes[k].array;
          for (let i = 0; i < A.length; i += 9) for (let j = 0; j < 3; j++) { const t = A[i + 3 + j]; A[i + 3 + j] = A[i + 6 + j]; A[i + 6 + j] = t; }
        });
      }
      if (!this.b.has(material)) this.b.set(material, []);
      this.b.get(material).push(g);
      return this;
    }
    with(local, fn) { const old = this.m; this.m = old.clone().multiply(local); fn(); this.m = old; }
    sym(fn) { fn(1); this.with(new M4().makeScale(-1, 1, 1), () => fn(-1)); }
    build(target) {
      let tris = 0;
      this.b.forEach((list, material) => {
        let n = 0; list.forEach(g => n += g.attributes.position.count);
        const P = new Float32Array(n * 3), N = new Float32Array(n * 3); let o = 0;
        list.forEach(g => { P.set(g.attributes.position.array, o); N.set(g.attributes.normal.array, o); o += g.attributes.position.count * 3; });
        const bg = new THREE.BufferGeometry();
        bg.setAttribute('position', new THREE.BufferAttribute(P, 3));
        bg.setAttribute('normal', new THREE.BufferAttribute(N, 3));
        bg.computeBoundingSphere();
        const mesh = new THREE.Mesh(bg, material);
        mesh.name = 'static';
        target.add(mesh); tris += n / 3;
      });
      return tris;
    }
  }
  const T = (x, y, z) => new M4().makeTranslation(x, y, z);
  const R = (x, y, z) => new M4().makeRotationFromEuler(new THREE.Euler(x, y, z));
  const TR = (x, y, z, rx, ry, rz) => T(x, y, z).multiply(R(rx || 0, ry || 0, rz || 0));
  const S = (x, y, z) => new M4().makeScale(x, y, z);

  /* ------------------------------------------------------------ shared parts */
  // Weapons come from models_weapons.js (RSWeapons) when it is loaded; the simple
  // built-in shapes below are the fallback.
  const WMAP = { aamL: 'aam_long', aamS: 'aam_short', agm: 'agm_light', bomb: 'glide_bomb', cruise: 'cruise_missile' };
  let buildLod = 'high';
  function wparts(kind) { return window.RSWeapons ? window.RSWeapons.parts(kind, { flight: false, lod: buildLod }) : null; }
  // Hang a store from an attach point (pylon bottom / rail); lugs touch the attach point.
  function hang(sk, kind, m) {
    const W = window.RSWeapons;
    if (!W) { const back = Object.keys(WMAP).find(k => WMAP[k] === kind) || 'aamL'; missile(sk, back, m.clone().multiply(T(0, -0.15, 0))); return; }
    const r = kind === 'cruise_missile' ? 0.265 : W.info[kind].r;
    sk.with(m.clone().multiply(T(0, -r - 0.02, 0)), () => wparts(kind).forEach(p => sk.add(p.geometry, p.material)));
  }
  function rack(sk, kind, m) {
    const W = window.RSWeapons;
    if (!W) { missile(sk, kind === 'agm_light' ? 'agm' : 'bomb', m.clone().multiply(T(0, -0.3, 0))); return; }
    sk.with(m, () => W.rackParts(kind, { lod: buildLod }).forEach(p => sk.add(p.geometry, p.material)));
  }
  function missile(sk, type, m) {
    if (window.RSWeapons && WMAP[type]) { sk.with(m, () => wparts(WMAP[type]).forEach(p => sk.add(p.geometry, p.material))); return; }
    sk.with(m, () => {
      const W = mat('white'), D = mat('dark'), O = mat('olive');
      if (type === 'aamL') { // long-range AAM
        const L = 3.7, r = 0.09;
        sk.add(cylZ(r, r, L - 0.5, 12), W, T(0, 0, -0.25));
        sk.add(latheZ([[r, 0], [r * 0.7, 0.3], [0, 0.5]], 12), D, T(0, 0, L / 2 - 0.5));
        sk.add(cylZ(r * 1.02, r * 1.02, 0.12, 12), mat('black'), T(0, 0, 0.8));
        for (let i = 0; i < 4; i++) {
          sk.add(box(0.012, 0.2, 0.3), W, R(0, 0, i * PI / 2 + PI / 4).multiply(T(0, 0.17, -L / 2 + 0.25)));
          sk.add(box(0.01, 0.12, 0.5), W, R(0, 0, i * PI / 2 + PI / 4).multiply(T(0, 0.14, 0.3)));
        }
      } else if (type === 'aamS') { // short-range AAM
        const L = 2.9, r = 0.064;
        sk.add(cylZ(r, r, L - 0.3, 10), W, T(0, 0, -0.15));
        sk.add(latheZ([[r, 0], [r * 0.6, 0.2], [0.02, 0.3]], 10), mat('glass'), T(0, 0, L / 2 - 0.3));
        for (let i = 0; i < 4; i++) {
          sk.add(box(0.01, 0.2, 0.25), W, R(0, 0, i * PI / 2 + PI / 4).multiply(T(0, 0.15, -L / 2 + 0.2)));
          sk.add(box(0.01, 0.1, 0.12), W, R(0, 0, i * PI / 2 + PI / 4).multiply(T(0, 0.1, L / 2 - 0.55)));
        }
        sk.add(cylZ(r * 1.03, r * 1.03, 0.08, 10), mat('olive'), T(0, 0, 0.5));
      } else if (type === 'bomb') {
        sk.add(latheZ([[0.001, -1.4], [0.12, -1.2], [0.18, -0.6], [0.18, 0.5], [0.13, 1.1], [0.001, 1.35]], 14), O);
        sk.add(cylZ(0.185, 0.185, 0.06, 14), mat('black'), T(0, 0, 0.9));
        for (let i = 0; i < 4; i++) sk.add(box(0.012, 0.22, 0.4), O, R(0, 0, i * PI / 2 + PI / 4).multiply(T(0, 0.19, -1.15)));
      } else if (type === 'agm') { // air-to-ground missile
        const L = 4.2, r = 0.17;
        sk.add(cylZ(r, r, L - 0.6, 12), W, T(0, 0, -0.3));
        sk.add(latheZ([[r, 0], [r * 0.8, 0.35], [0.03, 0.6]], 12), D, T(0, 0, L / 2 - 0.6));
        for (let i = 0; i < 4; i++) {
          sk.add(box(0.015, 0.26, 0.9), W, R(0, 0, i * PI / 2 + PI / 4).multiply(T(0, 0.28, 0.2)));
          sk.add(box(0.015, 0.2, 0.3), W, R(0, 0, i * PI / 2 + PI / 4).multiply(T(0, 0.26, -L / 2 + 0.2)));
        }
      } else if (type === 'cruise') { // big stand-off cruise missile
        const L = 6.2;
        sk.add(loftStations([
          { z: -3.1, w: 0.3, t: 0.28, b: 0.3, n: 3 }, { z: -2.4, w: 0.38, t: 0.34, b: 0.36, n: 3 },
          { z: 2.2, w: 0.38, t: 0.34, b: 0.36, n: 3 }, { z: 2.9, w: 0.22, t: 0.2, b: 0.2, n: 2.5 }, { z: 3.1, w: 0.02, t: 0.02, b: 0.02 }
        ], { N: 16, step: 0.5 }), O);
        sk.sym(() => sk.add(wingGeom({ x0: 0.3, x1: 1.5, z0: 0.6, z1: 0.1, c0: 0.7, c1: 0.4, t0: 0.08, t1: 0.08, y0: 0.2, y1: 0.2 }, 5), O));
        for (let i = 0; i < 3; i++) sk.add(box(0.02, 0.4, 0.45), O, R(0, 0, i * 2 * PI / 3).multiply(T(0, 0.45, -L / 2 + 0.3)));
        sk.add(cylZ(0.18, 0.2, 0.3, 12), D, T(0, -0.36, -1.2));
      }
    });
  }
  function pylon(sk, len, h, m, material) {
    sk.with(m, () => sk.add(wingGeom({ x0: 0, x1: h, z0: len / 2, z1: len / 2 - 0.1, c0: len, c1: len * 0.9, t0: 0.1, t1: 0.1 }, 5), material || mat('dark'), R(0, 0, -PI / 2)));
  }
  function tank(sk, len, r, m, material) {
    sk.with(m, () => {
      sk.add(latheZ([[0.001, -len / 2], [r * 0.45, -len / 2 + len * 0.12], [r, -len * 0.18], [r, len * 0.1], [r * 0.6, len * 0.36], [0.001, len / 2]], 16), material);
      for (let i = 0; i < 3; i++) sk.add(box(0.01, r * 0.9, len * 0.14), material, R(0, 0, PI / 4 + i * PI / 2).multiply(T(0, r * 0.8, -len / 2 + len * 0.1)));
    });
  }
  function canopy(sk, len, w, h, m, frames, material) {
    sk.with(m, () => {
      const g = new THREE.SphereGeometry(1, 28, 12, 0, 2 * PI, 0, PI / 2);
      sk.add(g, material || mat('glass'), S(w, h, len / 2));
      (frames || []).forEach(fz => {
        const k = Math.sqrt(Math.max(0, 1 - Math.pow(fz / (len / 2), 2)));
        const f = new THREE.TorusGeometry(1, 0.02, 5, 20, PI);
        sk.add(f, mat('dark'), T(0, 0, fz).multiply(S(w * k * 1.01, h * k * 1.01, 1)));
      });
      // sill rail
      sk.add(new THREE.TorusGeometry(1, 0.025, 4, 32), mat('dark'), R(PI / 2, 0, 0).multiply(S(w * 1.01, len / 2 * 1.01, 1)));
    });
  }
  // Roundel: fictional — red disc, white ring, dark forward-pointing triangle.
  function roundel(sk, r, m, lowvis) {
    const A = lowvis ? mat('lvA') : mat('red'), B = lowvis ? mat('lvB') : mat('white'), C = lowvis ? mat('lvB') : mat('black');
    sk.with(m, () => {
      sk.add(new THREE.CircleGeometry(r, 24), A, R(-PI / 2, 0, 0));
      sk.add(new THREE.RingGeometry(r * 0.52, r * 0.66, 24), B, T(0, 0.004, 0).multiply(R(-PI / 2, 0, 0)));
      const sh = new THREE.Shape(); const q = r * 0.42;
      sh.moveTo(0, q); sh.lineTo(-q * 0.87, -q * 0.5); sh.lineTo(q * 0.87, -q * 0.5); sh.lineTo(0, q);
      sk.add(new THREE.ShapeGeometry(sh), C, T(0, 0.006, 0).multiply(R(-PI / 2, 0, 0)));
    });
  }
  // Fin flash: two stripes, red/white (or low-vis)
  function finFlash(sk, w, h, m, lowvis) {
    sk.with(m, () => {
      sk.add(new THREE.PlaneGeometry(w, h / 2), lowvis ? mat('lvA') : mat('red'), T(0, 0, h / 4).multiply(R(-PI / 2, 0, 0)));
      sk.add(new THREE.PlaneGeometry(w, h / 2), lowvis ? mat('lvB') : mat('white'), T(0, 0, -h / 4).multiply(R(-PI / 2, 0, 0)));
    });
  }
  // Wing-panel helper: add a wing panel + optional roundel.
  function onWing(p, spanF, chordF, side) {
    const pt = wingPoint(p, spanF, chordF, side);
    const roll = Math.atan2((p.y1 || 0) - (p.y0 || 0), p.x1 - p.x0);
    return T(pt.x, pt.y, pt.z).multiply(R(0, 0, roll)).multiply(side < 0 ? R(PI, 0, 0) : new M4());
  }
  // Military jet nozzle with petals; returns local exhaust point
  function nozzle(sk, r, len, m, dyn) {
    sk.with(m, () => {
      sk.add(latheZ([[r * 1.02, 0], [r * 1.0, -len * 0.4], [r * 0.9, -len]], 18), mat('metal'));
      for (let i = 0; i < 18; i++) sk.add(box(0.012, 0.02, len * 0.55), mat('burnt'), R(0, 0, i / 18 * 2 * PI).multiply(T(0, r * 0.93, -len * 0.75)).multiply(R(0.1, 0, 0)));
      sk.add(cylZ(r * 0.86, r * 0.86, len * 0.9, 18, true), mat('burnt'), T(0, 0, -len * 0.45));
      sk.add(new THREE.CircleGeometry(r * 0.84, 18), mat('hot'), T(0, 0, -len * 0.25).multiply(R(0, PI, 0)));
      sk.add(new THREE.CircleGeometry(r * 0.3, 12), mat('burnt'), T(0, 0, -len * 0.22).multiply(R(0, PI, 0)));
    });
    const e = new V3(0, 0, -len).applyMatrix4(sk.m.clone().multiply(m));
    dyn.nozzles.push({ p: e, r: r * 0.85, afterburner: true });
  }
  // High-bypass / turbofan nacelle (bombers, AWACS); along +Z, origin at centre.
  function nacelle(sk, r, len, m, mat1, dyn) {
    sk.with(m, () => {
      sk.add(latheZ([[r * 0.72, -len / 2], [r * 0.82, -len * 0.3], [r, 0], [r * 1.0, len * 0.35], [r * 0.93, len / 2]], 22), mat1);
      sk.add(new THREE.TorusGeometry(r * 0.9, r * 0.06, 6, 22), mat('metal'), T(0, 0, len / 2));
      sk.add(new THREE.CircleGeometry(r * 0.88, 22), mat('dark'), T(0, 0, len / 2 - 0.2));
      sk.add(latheZ([[r * 0.25, 0], [0.01, r * 0.35]], 12), mat('metal'), T(0, 0, len / 2 - 0.2));
      sk.add(latheZ([[r * 0.35, -len * 0.62], [r * 0.6, -len / 2]], 16), mat('burnt'));
      sk.add(new THREE.CircleGeometry(r * 0.7, 18), mat('dark'), T(0, 0, -len / 2 + 0.02).multiply(R(0, PI, 0)));
    });
    const e = new V3(0, 0, -len * 0.62).applyMatrix4(sk.m.clone().multiply(m));
    dyn.nozzles.push({ p: e, r: r * 0.35, afterburner: false });
  }
  function blade(sk, h, l, m, material) { // blade antenna, local Y = surface normal
    sk.with(m, () => sk.add(wingGeom({ x0: 0, x1: h, z0: l / 2, z1: -l / 2 + l * 0.35, c0: l, c1: l * 0.4, t0: 0.12, t1: 0.12 }, 4), material || mat('dark'), R(0, 0, PI / 2)));
  }
  function nav(sk, x, y, z, color) { sk.add(new THREE.SphereGeometry(0.07, 8, 6), mat(color), T(x, y, z)); }
  function slime(sk, w, l, m) { sk.add(box(w, 0.015, l), mat('slime'), m); }

  // Thin seam between two points (panel joints, hinge lines)
  function seamLine(sk, a, b, w, material) {
    const d = new V3().subVectors(b, a), L = d.length(); if (L < 1e-4) return;
    const q = new THREE.Quaternion().setFromUnitVectors(new V3(0, 0, 1), d.normalize());
    const m = new M4().compose(new V3().addVectors(a, b).multiplyScalar(0.5), q, new V3(1, 1, 1));
    sk.add(box(w, w * 0.5, L + w), material || mat('seam'), m);
  }
  // Control surface outline on a wing panel (top and bottom): hinge line + two side cuts
  function hinge(sk, p, f0, f1, cf, w) {
    [1, -1].forEach(sd => {
      seamLine(sk, wingPoint(p, f0, cf, sd), wingPoint(p, f1, cf, sd), w);
      seamLine(sk, wingPoint(p, f0, cf, sd), wingPoint(p, f0, 0.985, sd), w);
      seamLine(sk, wingPoint(p, f1, cf, sd), wingPoint(p, f1, 0.985, sd), w);
    });
  }
  function slatLine(sk, p, f0, f1, cf, w) { [1, -1].forEach(sd => seamLine(sk, wingPoint(p, f0, cf, sd), wingPoint(p, f1, cf, sd), w)); }
  // Static dischargers (wicks) on the trailing edge
  function wicks(sk, p, fs, len) {
    fs.forEach(f => { const q = wingPoint(p, f, 1, 0); q.y -= 0.012 * 0; sk.add(cylZ(len * 0.03, len * 0.02, len, 5), mat('black'), T(q.x, q.y, q.z - len / 2 + 0.05)); });
  }
  // Rectangular door/hatch outline in a surface frame (local X across, Z along)
  function seamRect(sk, frame, sx, sz, w) {
    sk.with(frame, () => {
      const y = 0.012, a = new V3(-sx / 2, y, -sz / 2), b = new V3(sx / 2, y, -sz / 2), c = new V3(sx / 2, y, sz / 2), d = new V3(-sx / 2, y, sz / 2);
      seamLine(sk, a, b, w); seamLine(sk, b, c, w); seamLine(sk, c, d, w); seamLine(sk, d, a, w);
    });
  }
  // Seat + pilot + glare shield + HUD, sized to a canopy (base y, centre z, height h)
  function cockpit(sk, y, z, h, hud) {
    const hy = y + h * 0.6, hz = z - 0.25;
    sk.add(box(0.52, 0.95, 0.14), mat('dark'), T(0, hy - 0.38, hz - 0.3).multiply(R(-0.28, 0, 0)));   // seat back
    sk.add(box(0.36, 0.22, 0.12), mat('dark'), T(0, hy + 0.1, hz - 0.36).multiply(R(-0.28, 0, 0)));   // headbox
    sk.add(box(0.46, 0.42, 0.3), mat('suit'), T(0, hy - 0.42, hz - 0.05).multiply(R(-0.2, 0, 0)));    // torso
    sk.add(new THREE.SphereGeometry(0.135, 14, 10), mat('helmet'), T(0, hy, hz));
    sk.add(new THREE.SphereGeometry(0.14, 14, 6, PI / 2 - 0.9, 1.8, 0.95, 0.75), mat('visor'), T(0, hy, hz));
    sk.add(box(0.1, 0.06, 0.22), mat('dark'), T(0, hy - 0.12, hz + 0.14));                           // mask hose
    sk.add(box(0.62, 0.1, 0.5), mat('dark'), T(0, y + h * 0.18, z + 0.7));                          // glare shield
    if (hud) sk.add(box(0.2, 0.2, 0.01), mat('hud'), T(0, y + h * 0.4, z + 0.88).multiply(R(-0.35, 0, 0)));
  }

  /* ----------------------------------------------------------- the aircraft */
  const BUILD = {};

  // ---- F: "Kestrel" twin-engine, twin-tail air-superiority fighter (~19 m)
  BUILD.fighter = function (o, sk, dyn) {
    const C = o.camo, hi = o.hi, N = hi ? 36 : 14, step = hi ? 0.22 : 0.7;
    const fus = [
      { z: 9.7, w: 0.02, t: 0.02, b: 0.02, y: 0.12 },
      { z: 9.2, w: 0.24, t: 0.23, b: 0.22, y: 0.12 },
      { z: 8.2, w: 0.46, t: 0.44, b: 0.4, y: 0.12 },
      { z: 6.9, w: 0.64, t: 0.6, b: 0.54, y: 0.12 },
      { z: 5.6, w: 0.74, t: 0.74, b: 0.62, y: 0.14, n: 2.2 },
      { z: 4.0, w: 0.84, t: 0.9, b: 0.66, y: 0.14, n: 2.4 },
      { z: 2.4, w: 1.35, t: 0.8, b: 0.66, y: 0.08, n: 2.8 },
      { z: 0.5, w: 1.95, t: 0.66, b: 0.6, y: 0.02, n: 3.2 },
      { z: -3.0, w: 2.0, t: 0.58, b: 0.58, y: 0, n: 3.4 },
      { z: -6.0, w: 1.85, t: 0.52, b: 0.55, y: 0, n: 3.4 },
      { z: -8.1, w: 1.58, t: 0.47, b: 0.5, y: 0, n: 3.2 },
      { z: -9.1, w: 1.45, t: 0.44, b: 0.46, y: 0, n: 3.0 }
    ];
    const stp = prepStations(fus);
    const radomeCut = 7.0;
    sk.add(loftStations(fus.filter(s => s.z >= radomeCut - 0.01).concat([{ z: radomeCut, w: sampleStation(stp, radomeCut).w, t: sampleStation(stp, radomeCut).t, b: sampleStation(stp, radomeCut).b, y: 0.12 }]), { N, step }), mat('radome'));
    sk.add(loftStations([{ z: radomeCut, w: sampleStation(stp, radomeCut).w, t: sampleStation(stp, radomeCut).t, b: sampleStation(stp, radomeCut).b, y: 0.12 }].concat(fus.filter(s => s.z < radomeCut)), { N, step }), C);
    // canopy, IRST, pitot
    canopy(sk, 3.4, 0.5, 0.6, T(0, 0.86, 5.3), hi ? [0.9, -0.2] : [], hi ? mat('canopyC') : mat('glass'));
    if (hi) cockpit(sk, 0.86, 5.3, 0.6, true);
    if (hi) {
      sk.add(new THREE.SphereGeometry(0.1, 10, 8), mat('glass'), T(0.25, 0.86, 7.3));
      sk.add(cylZ(0.02, 0.012, 1.4, 6), mat('metal'), T(0, 0.12, 10.35));
      sk.add(cylZ(0.05, 0.05, 0.18, 8), mat('dark'), T(0, 0.12, 9.72));
    }
    // intakes (boxy, raked)
    sk.sym(() => {
      const inl = [
        { z: 3.9, x: 1.28, w: 0.46, t: 0.52, b: 0.56, y: -0.08, n: 5 },
        { z: 2.8, x: 1.3, w: 0.5, t: 0.55, b: 0.6, y: -0.06, n: 5 },
        { z: 0.0, x: 1.3, w: 0.52, t: 0.55, b: 0.6, y: -0.02, n: 5 },
        { z: -2.2, x: 1.2, w: 0.4, t: 0.4, b: 0.5, y: 0, n: 4 }
      ];
      sk.add(loftStations(inl, { N: hi ? 24 : 12, step: 0.5, capStart: false }), C);
      sk.add(box(0.8, 0.95, 0.05), mat('dark'), T(1.28, -0.1, 3.72));
      sk.add(box(0.04, 1.1, 0.8), C, T(0.84, -0.08, 3.5)); // splitter plate
      if (hi) sk.add(box(0.9, 0.04, 0.9), C, T(1.28, 0.49, 3.6).multiply(R(-0.35, 0, 0))); // ramp lip
    });
    // wings
    const wing = { x0: 1.6, x1: 6.5, z0: 2.3, z1: -2.3, c0: 6.2, c1: 1.5, t0: 0.05, t1: 0.04, y0: 0.05, y1: -0.02 };
    const stab = { x0: 1.4, x1: 4.3, z0: -6.4, z1: -8.7, c0: 3.1, c1: 1.3, t0: 0.05, t1: 0.04, y0: 0.0, y1: -0.05 };
    const fin = { x0: 0.35, x1: 3.3, z0: -4.9, z1: -7.6, c0: 3.7, c1: 1.3, t0: 0.05, t1: 0.04 };
    sk.sym((side) => {
      sk.add(wingGeom(wing, hi ? 16 : 6), C);
      sk.add(wingGeom(stab, hi ? 13 : 5), C);
      sk.with(T(1.25, 0.1, 0).multiply(R(0, 0, PI / 2 - 0.2)), () => {
        sk.add(wingGeom(fin, hi ? 13 : 5), C);
        if (hi) sk.add(cylZ(0.07, 0.07, 1.1, 8), mat('dark'), T(3.32, 0, -7.55)); // fin-tip cap
        if (o.markings) finFlash(sk, 0.8, 1.2, onWing(fin, 0.62, 0.45, -1), o.lowvis);
      });
      // wing tip rail + nav + slime light
      sk.add(box(0.1, 0.12, 2.4), mat('dark'), T(6.55, -0.02, -2.6));
      if (hi) {
        nav(sk, 6.6, 0.0, -1.35, side > 0 ? 'navR' : 'navG');
        slime(sk, 0.3, 0.06, onWing(wing, 0.92, 0.5, 1));
      }
      if (o.markings) roundel(sk, 0.62, onWing(wing, 0.72, 0.42, 1), o.lowvis);
      // gun port on left only-ish (both sides for symmetry is fine)
      if (o.loadout !== 'clean') {
        const lo = o.loadout;
        hang(sk, 'aam_short', T(6.6, -0.08, -2.6));                      // wingtip rail
        pylon(sk, 1.8, 0.35, T(3.2, -0.02, -0.4));                        // inboard pylon
        if (lo === 'sead') hang(sk, 'agm_arm', T(3.2, -0.37, -0.4));
        else if (lo === 'strike') rack(sk, 'glide_bomb', T(3.2, -0.37, -0.5));
        else hang(sk, 'aam_long', T(3.2, -0.37, -0.4));
        pylon(sk, 1.4, 0.3, T(4.8, -0.03, -1.6));                         // outboard pylon
        if (lo === 'strike') rack(sk, 'agm_light', T(4.8, -0.33, -1.5));
        else hang(sk, 'aam_short', T(4.8, -0.33, -1.6));
        missile(sk, 'aamL', T(1.25, -0.72, 1.1));   // conformal on intake sides
        missile(sk, 'aamL', T(1.25, -0.72, -3.4));
      }
    });
    // spine antennas, airbrake line, tail stingers
    if (hi) {
      blade(sk, 0.28, 0.4, surfFrame(stp, 1.5, PI / 2));
      blade(sk, 0.2, 0.3, surfFrame(stp, -5, PI / 2));
      blade(sk, 0.22, 0.3, surfFrame(stp, 3.2, -PI / 2));
      sk.sym(() => { sk.add(cylZ(0.2, 0.12, 2.0, 10), C, T(1.55, 0.0, -9.2)); slime(sk, 0.06, 0.8, surfFrame(stp, 5.2, 0.45)); });
      nav(sk, 0, 0.62, -3.2, 'navW');
    }
    if (o.loadout !== 'clean') { pylon(sk, 2.0, 0.3, T(0, -0.55, -1.2)); tank(sk, 4.4, 0.36, T(0, -1.2, -1.0), C); }
    sk.sym(() => nozzle(sk, 0.56, 1.0, T(0.72, 0.0, -9.0), dyn));
    if (hi) {
      sk.sym(() => {
        hinge(sk, wing, 0.1, 0.55, 0.78, 0.03); hinge(sk, wing, 0.58, 0.9, 0.8, 0.03);
        slatLine(sk, wing, 0.1, 0.95, 0.12, 0.025);
        wicks(sk, wing, [0.78, 0.9], 0.3); wicks(sk, stab, [0.92], 0.25);
        sk.with(T(1.25, 0.1, 0).multiply(R(0, 0, PI / 2 - 0.2)), () => { hinge(sk, fin, 0.12, 0.8, 0.72, 0.03); wicks(sk, fin, [0.9], 0.25); });
        // ventral fins under the engines
        sk.with(T(1.05, -0.42, 0).multiply(R(0, 0, -PI / 2 + 0.3)), () =>
          sk.add(wingGeom({ x0: 0, x1: 0.62, z0: -5.7, z1: -6.2, c0: 1.5, c1: 0.8, t0: 0.05, t1: 0.05 }, 6), C));
        seamRect(sk, T(1.28, -0.64, 0.6).multiply(R(PI, 0, 0)), 0.5, 2.2, 0.025);   // main gear doors
        seamRect(sk, surfFrame(stp, 3.0, 0.1), 0.3, 1.4, 0.02);                      // avionics bay
        sk.add(cylZ(0.012, 0.012, 0.35, 5), mat('metal'), surfFrame(stp, 8.6, 0.25).multiply(T(0, 0.02, 0.1))); // AoA vane
      });
      seamRect(sk, surfFrame(stp, 6.2, -PI / 2), 0.36, 1.7, 0.025);                 // nose gear doors
      seamRect(sk, surfFrame(stp, -1.2, PI / 2), 1.0, 1.9, 0.025);                  // dorsal airbrake
      seamRect(sk, surfFrame(stp, 4.9, PI / 2 - 0.9), 0.35, 0.5, 0.02);             // boarding step
    }
    return { length: 19.9, span: 13.3, height: 5.5, camoScale: 0.42, panel: 1.2 };
  };

  // ---- L: "Wasp" single-engine light multirole (~15 m)
  BUILD.light = function (o, sk, dyn) {
    const C = o.camo, hi = o.hi, N = hi ? 36 : 14, step = hi ? 0.22 : 0.6;
    const fus = [
      { z: 7.7, w: 0.02, t: 0.02, b: 0.02, y: 0.1 },
      { z: 7.2, w: 0.2, t: 0.2, b: 0.2, y: 0.1 },
      { z: 6.2, w: 0.4, t: 0.42, b: 0.4, y: 0.1 },
      { z: 5.1, w: 0.52, t: 0.56, b: 0.5, y: 0.12 },
      { z: 3.8, w: 0.58, t: 0.72, b: 0.55, y: 0.14, n: 2.3 },
      { z: 2.2, w: 0.68, t: 0.74, b: 0.6, y: 0.12, n: 2.6 },
      { z: 0.0, w: 0.82, t: 0.66, b: 0.62, y: 0.05, n: 2.8 },
      { z: -3.0, w: 0.8, t: 0.6, b: 0.6, y: 0.05, n: 2.6 },
      { z: -5.8, w: 0.62, t: 0.56, b: 0.56, y: 0.05, n: 2.3 },
      { z: -6.9, w: 0.56, t: 0.54, b: 0.54, y: 0.05, n: 2.0 }
    ];
    const stp = prepStations(fus);
    const cut = 5.8, sc = sampleStation(stp, cut);
    sk.add(loftStations(fus.filter(s => s.z > cut).concat([Object.assign({}, sc)]), { N, step }), mat('radome'));
    sk.add(loftStations([Object.assign({}, sc)].concat(fus.filter(s => s.z < cut)), { N, step }), C);
    // bubble canopy
    canopy(sk, 3.6, 0.42, 0.62, T(0, 0.78, 3.6), hi ? [-0.9] : [], hi ? mat('canopyG') : mat('goldglass'));
    if (hi) cockpit(sk, 0.78, 3.7, 0.62, true);
    // dorsal spine behind canopy
    sk.add(loftStations([{ z: 1.9, w: 0.3, t: 0.35, b: 0.1, y: 0.7 }, { z: -2.5, w: 0.3, t: 0.2, b: 0.1, y: 0.62 }, { z: -4.8, w: 0.2, t: 0.02, b: 0.1, y: 0.58 }], { N: 16, step: 0.6 }), C);
    // ventral intake
    sk.add(loftStations([
      { z: 3.2, w: 0.55, t: 0.25, b: 0.45, y: -0.72, n: 2.6 },
      { z: 2.0, w: 0.56, t: 0.3, b: 0.46, y: -0.68, n: 2.6 },
      { z: -1.5, w: 0.5, t: 0.3, b: 0.35, y: -0.5, n: 2.4 },
      { z: -3.0, w: 0.4, t: 0.2, b: 0.12, y: -0.4, n: 2.2 }
    ], { N: hi ? 22 : 12, step: 0.7, capStart: false }), C);
    sk.add(new THREE.CircleGeometry(1, 20), mat('dark'), T(0, -0.8, 3.1).multiply(S(0.5, 0.38, 1)));
    // LERX strakes + wings (cropped delta)
    const lerx = { x0: 0.5, x1: 1.1, z0: 3.6, z1: 0.6, c0: 4.6, c1: 1.6, t0: 0.03, t1: 0.03, y0: 0.05, y1: 0.05 };
    const wing = { x0: 0.7, x1: 4.7, z0: 1.0, z1: -2.3, c0: 4.7, c1: 1.45, t0: 0.045, t1: 0.04, y0: 0.05, y1: 0.05 };
    const stab = { x0: 0.6, x1: 2.9, z0: -4.6, z1: -6.1, c0: 2.6, c1: 1.15, t0: 0.05, t1: 0.04, y0: 0, y1: -0.28 };
    sk.sym((side) => {
      sk.add(wingGeom(lerx, 6), C);
      sk.add(wingGeom(wing, hi ? 16 : 6), C);
      sk.add(wingGeom(stab, hi ? 13 : 5), C);
      sk.add(box(0.1, 0.12, 2.3), mat('dark'), T(4.75, 0.02, -2.5));
      if (hi) {
        nav(sk, 0.95, 0.08, 0.9, side > 0 ? 'navR' : 'navG');
        sk.with(T(0.35, -0.5, -4.2).multiply(R(0, 0, -PI / 2 - 0.5)), () => sk.add(wingGeom({ x0: 0, x1: 0.55, z0: 0.5, z1: 0.1, c0: 1.3, c1: 0.7, t0: 0.05, t1: 0.05 }, 5), C)); // ventral fin
      }
      if (o.markings) roundel(sk, 0.46, onWing(wing, 0.66, 0.45, 1), o.lowvis);
      if (o.loadout !== 'clean') {
        const lo = o.loadout;
        hang(sk, 'aam_short', T(4.8, -0.04, -2.5));                       // wingtip rail
        pylon(sk, 1.6, 0.3, T(2.0, 0.02, -0.3));                          // inboard pylon
        if (lo === 'sead') hang(sk, 'agm_arm', T(2.0, -0.28, -0.3));
        else if (lo === 'cap') hang(sk, 'aam_long', T(2.0, -0.28, -0.3));
        else rack(sk, 'glide_bomb', T(2.0, -0.28, -0.4));
        pylon(sk, 1.3, 0.28, T(3.4, 0.02, -1.4));                         // outboard pylon
        if (lo === 'strike') rack(sk, 'agm_light', T(3.4, -0.26, -1.3));
        else hang(sk, 'aam_short', T(3.4, -0.26, -1.4));
      }
    });
    // single fin
    const fin = { x0: 0.45, x1: 3.3, z0: -3.2, z1: -5.7, c0: 3.5, c1: 1.3, t0: 0.05, t1: 0.04 };
    sk.with(T(0, 0.3, 0).multiply(R(0, 0, PI / 2)), () => {
      sk.add(wingGeom(fin, hi ? 13 : 5), C);
      if (hi) { sk.add(cylZ(0.1, 0.13, 1.3, 10), C, T(0.9, 0, -6.0)); sk.add(cylZ(0.07, 0.07, 0.8, 8), mat('dark'), T(3.3, 0, -5.5)); nav(sk, 3.35, 0, -6.0, 'navW'); }
      if (o.markings) { finFlash(sk, 0.7, 1.0, onWing(fin, 0.55, 0.5, -1), o.lowvis); finFlash(sk, 0.7, 1.0, onWing(fin, 0.55, 0.5, 1), o.lowvis); }
    });
    if (hi) {
      sk.add(cylZ(0.018, 0.01, 1.0, 6), mat('metal'), T(0, 0.1, 8.1));
      blade(sk, 0.22, 0.35, surfFrame(stp, 0.8, -PI / 2));
      blade(sk, 0.18, 0.3, surfFrame(stp, -2.0, -PI / 2));
      sk.add(box(0.04, 0.3, 0.05), mat('dark'), T(0, 0.95, 1.4));
      sk.add(cylZ(0.04, 0.04, 0.2, 8), mat('black'), T(-0.6, 0.35, 2.2)); // gun
    }
    if (o.loadout !== 'clean') { pylon(sk, 1.8, 0.2, T(0, -0.9, -1.8)); tank(sk, 3.4, 0.3, T(0, -1.3, -1.6), C); }
    nozzle(sk, 0.52, 0.95, T(0, 0.05, -6.9), dyn);
    if (hi) {
      sk.sym(() => {
        hinge(sk, wing, 0.12, 0.82, 0.78, 0.028); slatLine(sk, wing, 0.1, 0.95, 0.1, 0.022);
        wicks(sk, wing, [0.82], 0.25); wicks(sk, stab, [0.9], 0.2);
        seamRect(sk, surfFrame(stp, -0.6, -PI / 2 + 0.95), 0.4, 1.8, 0.022);        // main gear doors
        seamRect(sk, surfFrame(stp, 4.4, 0.35), 0.3, 1.0, 0.02);                   // avionics bay
        sk.add(cylZ(0.01, 0.01, 0.3, 5), mat('metal'), surfFrame(stp, 6.8, 0.25).multiply(T(0, 0.02, 0.1)));
      });
      sk.with(T(0, 0.3, 0).multiply(R(0, 0, PI / 2)), () => { hinge(sk, fin, 0.1, 0.72, 0.7, 0.028); wicks(sk, fin, [0.92], 0.22); });
      seamRect(sk, surfFrame(stp, -4.5, PI / 2), 0.5, 1.2, 0.02);                   // speed brake / access
    }
    return { length: 15.6, span: 9.8, height: 5.0, camoScale: 0.5, panel: 1.0 };
  };

  // ---- S: "Shade" faceted low-observable strike jet (~17 m)
  BUILD.stealth = function (o, sk, dyn) {
    const C = o.camo, hi = o.hi, step = hi ? 0.35 : 0.8;
    const fus = [
      { z: 8.4, w: 0.03, t: 0.02, b: 0.02, y: 0.05 },
      { z: 7.2, w: 0.55, t: 0.34, b: 0.28, y: 0.05 },
      { z: 5.4, w: 1.05, t: 0.7, b: 0.45, y: 0.05 },
      { z: 3.0, w: 1.6, t: 0.82, b: 0.55, y: 0.05 },
      { z: 0.5, w: 2.35, t: 0.72, b: 0.6, y: 0.02 },
      { z: -3.0, w: 2.4, t: 0.62, b: 0.58, y: 0 },
      { z: -6.4, w: 2.1, t: 0.5, b: 0.5, y: 0 },
      { z: -7.9, w: 1.8, t: 0.42, b: 0.44, y: 0 }
    ];
    sk.add(loftStations(fus, { chine: true, step, flat: true }), C);
    // caret intakes
    sk.sym(() => {
      const ring = (z, s) => [[1.4 * s + 0.2, 0.05], [1.9, 0.1 + 0.5 * s], [1.9, -0.5 * s], [1.3, -0.45 * s - 0.05], [1.2, 0.25 * s]]
        .map(p => new V3(p[0], p[1], z));
      sk.add(loft([ring(3.6, 1), ring(2.4, 1.05), ring(0.2, 1.0), ring(-2.0, 0.6)], { flat: true, capStart: false }), C);
      sk.add(loft([ring(3.55, 0.92).map(p => p.clone()), ring(3.3, 0.9)], { flat: true }), mat('dark'));
    });
    // faceted canopy
    sk.with(T(0, 0.72, 4.5), () => {
      const g = new THREE.SphereGeometry(1, 8, 4, 0, 2 * PI, 0, PI / 2); g.scale(0.5, 0.56, 1.9);
      sk.add(g.toNonIndexed(), hi ? mat('canopyG') : mat('goldglass'));
    });
    if (hi) cockpit(sk, 0.72, 4.6, 0.56, true);
    const wing = { x0: 1.9, x1: 6.1, z0: 1.4, z1: -2.7, c0: 6.0, c1: 1.75, t0: 0.035, t1: 0.03, y0: 0.05, y1: 0.05 };
    const stab = { x0: 1.7, x1: 4.0, z0: -5.0, z1: -6.9, c0: 2.9, c1: 1.2, t0: 0.035, t1: 0.03, y0: 0.0, y1: 0.0 };
    const fin = { x0: 0.3, x1: 2.6, z0: -3.8, z1: -5.8, c0: 3.2, c1: 1.2, t0: 0.035, t1: 0.03 };
    sk.sym((side) => {
      sk.add(wingGeom(wing, 4, true), C);
      sk.add(wingGeom(stab, 4, true), C);
      sk.with(T(1.55, 0.35, 0).multiply(R(0, 0, PI / 2 - 0.47)), () => {
        sk.add(wingGeom(fin, 4, true), C);
        if (o.markings) roundel(sk, 0.3, onWing(fin, 0.5, 0.45, -1), true);
      });
      if (o.markings) roundel(sk, 0.42, onWing(wing, 0.7, 0.45, 1), true);
      if (hi) {
        // weapon-bay door outlines (sawtooth) + edge treatment strips
        sk.add(box(0.7, 0.012, 3.6), mat('lvA'), T(0.55, -0.61, -0.8));
        sk.add(box(0.05, 0.02, 4.3), mat('lvA'), onWing(wing, 0.5, 0.02, 1).multiply(R(0, -0.78, 0)));
        nav(sk, 6.1, 0.05, -2.9, side > 0 ? 'navR' : 'navG');
      }
    });
    if (hi) {
      sk.add(cylZ(0.02, 0.012, 0.6, 6), mat('lvA'), T(0, 0.05, 8.6));
      sk.add(box(0.8, 0.012, 0.9), mat('lvA'), T(0, 0.83, 1.8)); // refuel door
    }
    // shrouded twin nozzles
    sk.sym(() => {
      sk.add(loft([
        [[0.35, 0.3], [1.05, 0.3], [1.1, -0.3], [0.3, -0.3]].map(p => new V3(p[0], p[1], -6.9)),
        [[0.38, 0.22], [1.0, 0.22], [1.02, -0.22], [0.36, -0.22]].map(p => new V3(p[0], p[1], -8.6))
      ], { flat: true, capEnd: false }), C);
      sk.add(box(0.6, 0.4, 0.05), mat('hot'), T(0.7, 0, -8.3));
      for (let i = 0; i < 4; i++) sk.add(box(0.04, 0.44, 0.35), mat('burnt'), T(0.42 + i * 0.18, 0, -8.5).multiply(R(0, 0.3 * (i % 2 ? 1 : -1), 0)));
    });
    [1, -1].forEach(s => dyn.nozzles.push({ p: new V3(0.7 * s, 0, -8.6), r: 0.3, afterburner: true }));
    if (hi) {
      sk.sym(() => {
        hinge(sk, wing, 0.1, 0.92, 0.8, 0.025); slatLine(sk, wing, 0.08, 0.95, 0.1, 0.02);
        sk.with(T(1.55, 0.35, 0).multiply(R(0, 0, PI / 2 - 0.47)), () => hinge(sk, fin, 0.1, 0.85, 0.7, 0.025));
        // sawtooth gear-door edge under the intake
        const zz = [2.6, 2.2, 1.8, 1.4, 1.0, 0.6], y = -0.62;
        for (let i = 0; i < zz.length - 1; i++) seamLine(sk, new V3(i % 2 ? 1.0 : 1.3, y, zz[i]), new V3(i % 2 ? 1.3 : 1.0, y, zz[i + 1]), 0.025, mat('lvA'));
        seamRect(sk, T(0.6, 0.83, -2.6), 0.5, 1.2, 0.02);                          // top access panels
      });
      const zz = [6.6, 6.3, 6.0, 5.7, 5.4];                                          // nose gear sawtooth
      for (let i = 0; i < zz.length - 1; i++) seamLine(sk, new V3(i % 2 ? 0.25 : -0.25, -0.27, zz[i]), new V3(i % 2 ? -0.25 : 0.25, -0.27, zz[i + 1]), 0.025, mat('lvA'));
    }
    return { length: 17.0, span: 12.2, height: 4.4, camoScale: 0.3, panel: 1.5 };
  };

  // ---- B: "Anvil" four-engine swept-wing heavy bomber (~45 m)
  BUILD.bomber = function (o, sk, dyn) {
    const C = o.camo, hi = o.hi, N = hi ? 40 : 14, step = hi ? 0.6 : 2.0;
    const fus = [
      { z: 22.6, w: 0.05, t: 0.05, b: 0.05, y: -0.3 },
      { z: 21.8, w: 0.9, t: 0.85, b: 0.8, y: -0.25 },
      { z: 20.0, w: 1.55, t: 1.6, b: 1.45, y: -0.1 },
      { z: 17.5, w: 1.9, t: 2.1, b: 1.8, y: 0.05 },
      { z: 14.0, w: 2.0, t: 2.1, b: 1.95, y: 0.05 },
      { z: -12.0, w: 2.0, t: 2.05, b: 1.95, y: 0.05 },
      { z: -18.0, w: 1.5, t: 1.6, b: 1.2, y: 0.5 },
      { z: -22.0, w: 0.75, t: 0.8, b: 0.55, y: 1.1 },
      { z: -23.2, w: 0.35, t: 0.35, b: 0.3, y: 1.3 }
    ];
    const stp = prepStations(fus);
    sk.add(loftStations(fus, { N, step }), C);
    // cockpit windows (surface-mounted panes)
    if (hi) {
      [-0.5, -0.2, 0.2, 0.5].forEach((dx, i) => {
        const a = PI / 2 + (dx < 0 ? 0.28 : -0.28) * (Math.abs(dx) > 0.3 ? 2 : 1);
        sk.add(box(0.55, 0.03, 0.55), mat('glass'), surfFrame(stp, 19.1, a));
      });
      for (let i = 0; i < 3; i++) sk.add(box(0.35, 0.03, 0.3), mat('glass'), surfFrame(stp, 18.1 - i * 0.5, PI / 2 + 0.9));
      for (let i = 0; i < 3; i++) sk.add(box(0.35, 0.03, 0.3), mat('glass'), surfFrame(stp, 18.1 - i * 0.5, PI / 2 - 0.9));
      sk.add(cylZ(0.05, 0.03, 1.6, 6), mat('metal'), T(0, -0.3, 23.2)); // probe
      // bomb bay doors outlines + refuel receptacle + antennas
      sk.add(box(1.8, 0.03, 12), mat('dark'), T(0, -1.9, 0));
      sk.add(box(0.03, 0.05, 12), mat('black'), T(0, -1.93, 0));
      sk.add(box(0.8, 0.03, 0.8), mat('dark'), surfFrame(stp, 16.0, PI / 2));
      blade(sk, 0.6, 0.8, surfFrame(stp, 8, PI / 2));
      blade(sk, 0.5, 0.7, surfFrame(stp, -6, PI / 2));
      blade(sk, 0.5, 0.7, surfFrame(stp, 4, -PI / 2));
      blade(sk, 0.4, 0.6, surfFrame(stp, -10, -PI / 2));
      sk.add(new THREE.SphereGeometry(0.45, 12, 8), mat('radome'), T(0, 1.3, -23.2)); // tail radar
      nav(sk, 0, 2.2, -2, 'navW');
    }
    // high swept wing
    const wing = { x0: 1.5, x1: 21.0, z0: 6.5, z1: -9.5, c0: 10.5, c1: 3.4, t0: 0.12, t1: 0.09, y0: 1.35, y1: 0.9, segs: 2 };
    const stab = { x0: 0.6, x1: 8.6, z0: -16.8, z1: -21.3, c0: 5.4, c1: 2.1, t0: 0.08, t1: 0.07, y0: 1.2, y1: 1.3 };
    sk.sym((side) => {
      sk.add(wingGeom(wing, hi ? 18 : 6), C);
      sk.add(wingGeom(stab, hi ? 13 : 5), C);
      // wing-body fairing
      sk.add(loftStations([{ z: 7, x: 1.4, w: 0.4, t: 0.3, b: 0.4, y: 1.6 }, { z: 2, x: 1.6, w: 0.8, t: 0.45, b: 0.6, y: 1.5 }, { z: -4, x: 1.5, w: 0.5, t: 0.3, b: 0.5, y: 1.5 }], { N: 14, step: 1.5 }), C);
      // podded engines (inboard + outboard)
      [[7.2, 0.28], [13.2, 0.5]].forEach(([x, f]) => {
        const zLE = wing.z0 + (wing.z1 - wing.z0) * ((x - wing.x0) / (wing.x1 - wing.x0));
        const yW = wing.y0 + (wing.y1 - wing.y0) * ((x - wing.x0) / (wing.x1 - wing.x0));
        nacelle(sk, 0.85, 5.2, T(x, yW - 1.35, zLE + 1.4), C, dyn);
        sk.add(box(0.28, 1.1, 3.6), C, T(x, yW - 0.55, zLE - 0.5).multiply(R(0.05, 0, 0)));
      });
      if (hi) {
        nav(sk, 21.1, 0.9, -10.2, side > 0 ? 'navR' : 'navG');
        // flap track fairings
        [5, 10, 16].forEach(x => {
          const f = (x - wing.x0) / (wing.x1 - wing.x0), zTE = wing.z0 + (wing.z1 - wing.z0) * f - (wing.c0 + (wing.c1 - wing.c0) * f);
          const yW = wing.y0 + (wing.y1 - wing.y0) * f;
          sk.add(latheZ([[0.01, -1.6], [0.22, -0.6], [0.2, 0.9], [0.01, 1.6]], 8), C, T(x, yW - 0.25, zTE + 1.0));
        });
      }
      if (o.markings) roundel(sk, 1.3, onWing(wing, 0.78, 0.4, 1), o.lowvis);
      if (o.markings) {
        const fm = surfFrame(stp, -8, 0.15); sk.with(fm, () => roundel(sk, 1.0, new M4(), o.lowvis));
      }
      if (o.loadout !== 'clean') { // stand-off cruise missiles on a twin-carriage inboard pylon
        const x = 4.2, f = (x - wing.x0) / (wing.x1 - wing.x0), zLE = wing.z0 + (wing.z1 - wing.z0) * f, yW = wing.y0 + (wing.y1 - wing.y0) * f;
        sk.add(box(0.3, 1.2, 4.0), mat('dark'), T(x, yW - 0.6, zLE - 2.5));
        sk.add(box(1.0, 0.12, 2.6), mat('dark'), T(x, yW - 1.24, zLE - 2.4));
        if (window.RSWeapons) { hang(sk, 'cruise_missile', T(x - 0.36, yW - 1.3, zLE - 2.3)); hang(sk, 'cruise_missile', T(x + 0.36, yW - 1.3, zLE - 2.3)); }
        else { missile(sk, 'cruise', T(x - 0.45, yW - 1.75, zLE - 2.3)); missile(sk, 'cruise', T(x + 0.45, yW - 1.75, zLE - 2.3)); }
      }
    });
    const fin = { x0: 1.5, x1: 9.5, z0: -13.6, z1: -20.2, c0: 8.2, c1: 3.0, t0: 0.09, t1: 0.08 };
    sk.with(T(0, 0.5, 0).multiply(R(0, 0, PI / 2)), () => {
      sk.add(wingGeom(fin, hi ? 12 : 5), C);
      if (o.markings) { finFlash(sk, 2.2, 2.6, onWing(fin, 0.6, 0.45, -1), o.lowvis); finFlash(sk, 2.2, 2.6, onWing(fin, 0.6, 0.45, 1), o.lowvis); }
      if (hi) nav(sk, 9.6, 0, -23.0, 'navW');
    });
    if (hi) {
      sk.sym(() => {
        hinge(sk, wing, 0.05, 0.5, 0.75, 0.06); hinge(sk, wing, 0.54, 0.88, 0.78, 0.06);
        slatLine(sk, wing, 0.06, 0.96, 0.08, 0.05); slatLine(sk, wing, 0.3, 0.7, 0.6, 0.045); // spoiler line
        hinge(sk, stab, 0.08, 0.92, 0.7, 0.05);
        wicks(sk, wing, [0.84, 0.91, 0.98], 0.45); wicks(sk, stab, [0.93], 0.4);
        // main gear fairings along the lower fuselage
        sk.add(latheZ([[0.02, -4.5], [0.55, -3.2], [0.62, 2.0], [0.4, 3.6], [0.02, 4.4]], 16), C, T(1.75, -1.45, -1.0).multiply(S(1, 0.8, 1)));
        seamRect(sk, surfFrame(stp, 15.2, -0.55), 1.4, 0.9, 0.04);                  // crew entry hatch
        seamRect(sk, surfFrame(stp, 2.0, 0.35), 1.0, 1.4, 0.04);                    // equipment bay
        sk.add(new THREE.SphereGeometry(1, 10, 6), mat('radome'), surfFrame(stp, 12.5, -0.25).multiply(S(0.35, 0.18, 0.9))); // ECM blister
      });
      sk.with(T(0, 0.5, 0).multiply(R(0, 0, PI / 2)), () => { hinge(sk, fin, 0.08, 0.9, 0.68, 0.05); wicks(sk, fin, [0.95], 0.4); });
      sk.add(cylZ(0.18, 0.18, 0.4, 10), mat('burnt'), T(0.4, 1.35, -22.9));           // APU exhaust
    }
    return { length: 46.0, span: 42.5, height: 10.8, camoScale: 0.14, panel: 2.2 };
  };

  // ---- A: "Lantern" airborne early-warning jet with rotodome (~46 m)
  BUILD.awacs = function (o, sk, dyn) {
    const C = o.camo, hi = o.hi, N = hi ? 40 : 14, step = hi ? 0.6 : 2.0;
    const fus = [
      { z: 23.0, w: 0.05, t: 0.05, b: 0.05, y: -0.3 },
      { z: 22.2, w: 1.0, t: 1.0, b: 0.9, y: -0.25 },
      { z: 20.5, w: 1.75, t: 1.8, b: 1.6, y: -0.05 },
      { z: 18.0, w: 2.05, t: 2.1, b: 2.0, y: 0.0 },
      { z: -12.0, w: 2.05, t: 2.1, b: 2.0, y: 0 },
      { z: -18.5, w: 1.5, t: 1.6, b: 1.0, y: 0.6 },
      { z: -22.5, w: 0.6, t: 0.6, b: 0.4, y: 1.35 },
      { z: -23.4, w: 0.25, t: 0.25, b: 0.2, y: 1.45 }
    ];
    const stp = prepStations(fus);
    sk.add(loftStations(fus, { N, step }), C);
    if (hi) {
      // cockpit windscreen panes
      [0.28, 0.08, -0.08, -0.28].forEach((d, i) => sk.add(box(0.5, 0.03, 0.5), mat('glass'), surfFrame(stp, 20.6, PI / 2 + d * 1.6)));
      [0.75, 1.0, -0.75, -1.0].forEach(a => sk.add(box(0.4, 0.03, 0.42), mat('glass'), surfFrame(stp, 20.1, PI / 2 + a)));
      // a few cabin windows (mostly blanked on an AEW jet)
      for (let i = 0; i < 6; i++) { sk.add(box(0.22, 0.03, 0.3), mat('dark'), surfFrame(stp, 16 - i * 1.1, 0.3)); sk.add(box(0.22, 0.03, 0.3), mat('dark'), surfFrame(stp, 16 - i * 1.1, PI - 0.3)); }
      // antennas / blisters
      blade(sk, 0.5, 0.8, surfFrame(stp, 12, PI / 2));
      blade(sk, 0.5, 0.8, surfFrame(stp, 10, -PI / 2));
      blade(sk, 0.4, 0.6, surfFrame(stp, -14, -PI / 2));
      sk.add(new THREE.SphereGeometry(1, 12, 8), mat('radome'), surfFrame(stp, 6, -PI / 2).multiply(S(0.7, 0.35, 1.6)));
      sk.add(new THREE.SphereGeometry(1, 12, 8), mat('radome'), T(0, -0.4, 23.1).multiply(S(0.3, 0.3, 0.3)));
      sk.add(cylZ(0.04, 0.03, 1.8, 6), mat('metal'), T(0, 2.05, 18.5).multiply(R(0.05, 0, 0))); // refuel probe
      nav(sk, 0, 2.15, 0, 'navW');
    }
    // low wing with dihedral + winglets
    const wing = { x0: 1.8, x1: 21.8, z0: 3.8, z1: -8.8, c0: 8.4, c1: 2.4, t0: 0.12, t1: 0.1, y0: -1.2, y1: 0.2, segs: 2 };
    const stab = { x0: 0.6, x1: 7.6, z0: -17.2, z1: -21.4, c0: 4.6, c1: 1.8, t0: 0.08, t1: 0.07, y0: 0.9, y1: 1.3 };
    sk.sym((side) => {
      sk.add(wingGeom(wing, hi ? 18 : 6), C);
      sk.add(wingGeom(stab, hi ? 13 : 5), C);
      sk.with(T(21.7, 0.2, 0).multiply(R(0, 0, PI / 2 - 0.35)), () =>
        sk.add(wingGeom({ x0: 0, x1: 2.2, z0: -8.9, z1: -10.2, c0: 2.2, c1: 0.8, t0: 0.08, t1: 0.08 }, 6), C));
      sk.add(loftStations([{ z: 5, x: 1.5, w: 0.6, t: 0.4, b: 0.6, y: -1.4 }, { z: -1, x: 1.6, w: 1.0, t: 0.5, b: 0.8, y: -1.4 }, { z: -6, x: 1.4, w: 0.5, t: 0.4, b: 0.5, y: -1.3 }], { N: 14, step: 1.5 }), C);
      const x = 7.6, f = (x - wing.x0) / (wing.x1 - wing.x0), zLE = wing.z0 + (wing.z1 - wing.z0) * f, yW = wing.y0 + (wing.y1 - wing.y0) * f;
      nacelle(sk, 1.35, 5.8, T(x, yW - 1.6, zLE + 2.6), C, dyn);
      sk.add(box(0.35, 1.2, 4.5), C, T(x, yW - 0.55, zLE + 0.2));
      if (hi) nav(sk, 21.9, 0.25, -9.2, side > 0 ? 'navR' : 'navG');
      if (o.markings) roundel(sk, 1.2, onWing(wing, 0.74, 0.42, 1), o.lowvis);
      if (o.markings) sk.with(surfFrame(stp, -7, 0.2), () => roundel(sk, 1.0, new M4(), o.lowvis));
    });
    const fin = { x0: 1.4, x1: 9.2, z0: -14.2, z1: -20.4, c0: 7.2, c1: 2.8, t0: 0.09, t1: 0.08 };
    sk.with(T(0, 0.6, 0).multiply(R(0, 0, PI / 2)), () => {
      sk.add(wingGeom(fin, hi ? 12 : 5), C);
      if (o.markings) { finFlash(sk, 2.0, 2.4, onWing(fin, 0.6, 0.45, -1), o.lowvis); finFlash(sk, 2.0, 2.4, onWing(fin, 0.6, 0.45, 1), o.lowvis); }
    });
    // rotodome struts (static), dome itself is dynamic
    sk.sym(() => sk.with(T(0.6, 3.05, -4.8).multiply(R(0, 0, -0.25)), () =>
      sk.add(wingGeom({ x0: -1.0, x1: 1.0, z0: 1.2, z1: 1.0, c0: 2.4, c1: 2.0, t0: 0.1, t1: 0.1 }, 5), C, R(0, 0, PI / 2))));
    dyn.rotodome = { y: 4.45, z: -4.8, r: 4.6, h: 0.95 };
    if (hi) {
      sk.sym(() => {
        hinge(sk, wing, 0.05, 0.55, 0.74, 0.06); hinge(sk, wing, 0.6, 0.86, 0.78, 0.06);
        slatLine(sk, wing, 0.1, 0.96, 0.07, 0.05); slatLine(sk, wing, 0.25, 0.6, 0.6, 0.045);
        hinge(sk, stab, 0.1, 0.9, 0.7, 0.05);
        wicks(sk, wing, [0.9, 0.96], 0.45); wicks(sk, stab, [0.93], 0.4);
        seamRect(sk, surfFrame(stp, 17.4, 0.12), 1.9, 0.95, 0.04);                   // forward door
        seamRect(sk, surfFrame(stp, -13.0, 0.12), 1.8, 0.85, 0.04);                  // aft door
        seamRect(sk, surfFrame(stp, 1.5, -0.35), 0.9, 1.2, 0.04);                    // overwing exit
      });
      sk.with(T(0, 0.6, 0).multiply(R(0, 0, PI / 2)), () => { hinge(sk, fin, 0.1, 0.9, 0.68, 0.05); wicks(sk, fin, [0.95], 0.4); });
      // belly gear fairing + APU exhaust
      sk.add(loftStations([{ z: 4.5, w: 0.8, t: 0.4, b: 0.3, y: -1.8 }, { z: 2.0, w: 1.9, t: 0.5, b: 0.55, y: -1.75, n: 2.4 },
        { z: -3.5, w: 1.9, t: 0.5, b: 0.55, y: -1.75, n: 2.4 }, { z: -6.5, w: 0.8, t: 0.4, b: 0.3, y: -1.8 }], { N: 24, step: 0.8 }), C);
      seamRect(sk, T(0, -2.31, 17.0).multiply(R(PI, 0, 0)), 0.8, 2.0, 0.04);          // nose gear doors
      sk.add(cylZ(0.15, 0.15, 0.35, 10), mat('burnt'), T(0, 1.45, -23.45));
    }
    return { length: 46.4, span: 44.0, height: 12.5, camoScale: 0.13, panel: 2.2 };
  };

  /* -------------------------------------------------- dynamic parts + API */
  function addFlames(group, nozzles) {
    const flames = [];
    nozzles.forEach((nz, i) => {
      const holder = new THREE.Object3D();
      holder.name = 'nozzle' + i;
      holder.position.copy(nz.p);
      group.add(holder);
      if (!nz.afterburner) return;
      const f = new THREE.Group(); f.name = 'flame';
      const outer = new THREE.Mesh(new THREE.ConeGeometry(nz.r * 0.95, nz.r * 7, 14, 1, true), mat('flameO'));
      outer.rotation.x = -PI / 2; outer.position.z = -nz.r * 3.5;
      const inner = new THREE.Mesh(new THREE.ConeGeometry(nz.r * 0.6, nz.r * 4, 12, 1, true), mat('flameI'));
      inner.rotation.x = -PI / 2; inner.position.z = -nz.r * 2;
      f.add(outer, inner);
      for (let k = 0; k < 4; k++) {
        const d = new THREE.Mesh(new THREE.SphereGeometry(nz.r * 0.32 * (1 - k * 0.15), 8, 6), mat('diamond'));
        d.scale.z = 1.8; d.position.z = -nz.r * (1.4 + k * 1.3); f.add(d);
      }
      holder.add(f);
    });
    return flames;
  }
  function addRotodome(group, rd, camo) {
    const g = new THREE.Group(); g.name = 'rotodome';
    g.position.set(0, rd.y, rd.z);
    const prof = [[0.001, -rd.h / 2], [rd.r * 0.8, -rd.h / 2], [rd.r, -rd.h * 0.15], [rd.r, rd.h * 0.15], [rd.r * 0.8, rd.h / 2], [0.001, rd.h / 2]]
      .map(p => new THREE.Vector2(p[0], p[1]));
    const dome = new THREE.Mesh(new THREE.LatheGeometry(prof, 40), camo);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(rd.r * 1.005, rd.r * 1.005, rd.h * 0.22, 40, 1, true), mat('dark'));
    g.add(dome, band);
    group.add(g);
  }

  function finalize(obj) {
    const ud = obj.userData;
    const holders = [], flames = [];
    let dome = null;
    obj.traverse(c => {
      if (/^nozzle\d+$/.test(c.name)) holders.push(c);
      if (c.name === 'flame') flames.push(c);
      if (c.name === 'rotodome') dome = c;
    });
    let thr = 0.6, t = Math.random() * 10;
    ud.nozzles = holders;
    ud.setThrottle = function (v) {
      thr = Math.max(0, Math.min(1, v));
      flames.forEach(f => { f.visible = thr > 0.05; });
    };
    ud.update = function (dt) {
      t += dt || 0.016;
      if (dome) dome.rotation.y += (dt || 0.016) * (2 * PI / 10); // 6 rpm
      const ab = thr > 0.8 ? 1 : 0;
      const len = 0.25 + thr * 0.55 + ab * 0.6;
      flames.forEach((f, i) => {
        const fl = 1 + 0.07 * Math.sin(t * 43 + i * 1.7) + 0.05 * Math.sin(t * 71 + i);
        f.scale.set(0.8 + ab * 0.25, 0.8 + ab * 0.25, len * fl);
        f.children.forEach((c, k) => { if (k >= 2) c.visible = ab === 1; });
      });
    };
    ud.setThrottle(thr); ud.update(0);
    return obj;
  }

  const INFO = {
    fighter: { name: 'Kestrel', role: 'Air-superiority fighter', threat: 'high' },
    light:   { name: 'Wasp', role: 'Light multirole fighter', threat: 'medium' },
    stealth: { name: 'Shade', role: 'Low-observable strike', threat: 'high' },
    bomber:  { name: 'Anvil', role: 'Heavy bomber / cruise-missile carrier', threat: 'high' },
    awacs:   { name: 'Lantern', role: 'Airborne early warning', threat: 'low' }
  };
  const DEFAULT_SCHEME = { fighter: 'woodland', light: 'woodland', stealth: 'darkgrey', bomber: 'woodland', awacs: 'woodland' };
  const cache = new Map();
  // Loadout presets per airframe (first entry is the default). 'clean' = no stores.
  const LOADOUTS = { fighter: ['cap', 'sead', 'strike'], light: ['strike', 'sead', 'cap'], stealth: ['clean'], bomber: ['cruise'], awacs: ['clean'] };
  function resolveLoadout(variant, v) {
    if (v === false || v === 'clean') return 'clean';
    if (typeof v === 'string' && LOADOUTS[variant].indexOf(v) >= 0) return v;
    return LOADOUTS[variant][0];
  }

  function buildTemplate(variant, opts) {
    const hi = opts.lod !== 'low';
    const scheme = opts.scheme || DEFAULT_SCHEME[variant];
    const sk = new Sink(), dyn = { nozzles: [] };
    // camo scale is decided per airframe; build once to learn it (cheap: material is lazy)
    const camo = camoMaterial(scheme, 0.4);
    buildLod = hi ? 'high' : 'low';
    const o = { camo, hi, loadout: resolveLoadout(variant, opts.loadout), markings: opts.markings !== false, lowvis: variant === 'stealth' || scheme === 'darkgrey' };
    const dims = BUILD[variant](o, sk, dyn);
    camo.userData.camo.uCamoS.value = dims.camoScale;
    camo.userData.camo.uPanel.value = hi ? (dims.panel || 0) : 0;
    const g = new THREE.Group();
    const tris = sk.build(g);
    addFlames(g, dyn.nozzles);
    if (dyn.rotodome) addRotodome(g, dyn.rotodome, camo);
    Object.assign(g.userData, { kind: 'jet_hostile', variant, scheme, loadout: o.loadout, name: INFO[variant].name, role: INFO[variant].role,
      threat: INFO[variant].threat, length: dims.length, span: dims.span, height: dims.height, triangles: Math.round(tris) });
    g.name = 'jet_hostile_' + variant;
    return g;
  }

  const VARIANTS = Object.keys(BUILD);
  const Jets = {
    version: 'jets-1.2',
    variants: VARIANTS.slice(),
    info: INFO,
    loadouts: LOADOUTS,
    schemes: Object.keys(SCHEMES),
    create(variant, opts) {
      opts = opts || {};
      if (variant === 'random') variant = VARIANTS[Math.floor(Math.random() * VARIANTS.length)];
      if (!BUILD[variant]) variant = 'fighter';
      const key = [variant, opts.scheme || '', opts.lod || 'high', resolveLoadout(variant, opts.loadout), opts.markings !== false].join('|');
      if (!cache.has(key)) cache.set(key, buildTemplate(variant, opts));
      const tpl = cache.get(key);
      const obj = tpl.clone(true);
      obj.userData = Object.assign({}, tpl.userData);
      return finalize(obj);
    },
    clearCache() {
      cache.forEach(g => g.traverse(c => { if (c.geometry) c.geometry.dispose(); }));
      cache.clear();
    }
  };

  /* ------------------------------------------------- hook into Models API */
  let M = (typeof Models !== 'undefined') ? Models : window.Models; // eslint-disable-line no-undef
  if (!M) M = window.Models = { version: '0', kinds: [], create: null };
  const prevCreate = typeof M.create === 'function' ? M.create.bind(M) : null;
  M.create = function (kind, opts) {
    opts = opts || {};
    if (kind === 'jet_hostile') return Jets.create(opts.variant || 'fighter', opts);
    if (typeof kind === 'string' && kind.indexOf('jet_hostile_') === 0) return Jets.create(kind.slice(12), opts);
    return prevCreate ? prevCreate(kind, opts) : null;
  };
  const kinds = new Set(M.kinds || []);
  kinds.add('jet_hostile'); VARIANTS.forEach(v => kinds.add('jet_hostile_' + v));
  M.kinds = Array.from(kinds);
  M.jets = Jets;
  M.version = (M.version || '0') + '+' + Jets.version;
})();
