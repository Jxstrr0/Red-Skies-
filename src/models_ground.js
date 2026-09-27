/* ============================================================================
 * models_ground.js — Red Skies · battery ground equipment (radars, gun, CP, power)
 * Prairie Blue Studio · procedural, three.js r128+. Standalone (no RS, no other model file).
 *
 * Original fictional designs in the class of a long-range SAM battery's ground kit:
 *   radar_search   8x8 truck, lift pedestal, big flat-panel active array (7.6 x 3.8 m), top ~12.7 m
 *   radar_fc       8x8 truck + guyed telescopic mast, space-fed lens array (4 x 4 m) with feed boom, top ~22 m
 *   radar_lowalt   semitrailer + 24 m lattice tower, wide back-to-back flat array, top ~27.5 m
 *   gun_harrow     emplaced twin-autocannon mount: turret, twin long barrels, spinning search panel,
 *                  gun-laid tracking dish, EO block. Low: ~4 m tall, ~6 x 6 m footprint
 *   command_post   8x8 truck with equipment shelter, raised antenna mast, whips, camo net
 *   generator      two-axle gen-set trailer with louvred housing, exhaust stack, cable reels
 * Three-tone camo (green / sand / black), same palette as models_launchers.js, own pattern seed.
 *
 * Models.create(kind, { lod: 'high' | 'low' }) → THREE.Group named after the kind.
 *   Units 1 = 1 m, origin at ground centre, +Y up, +Z forward (cab end). Deployed pose.
 * userData (all kinds): kind, name, height, update(dt)
 *   radars:     head  (Group, yaw about Y rel. vehicle; array beam +Z at yaw 0)
 *               panel (Group inside head; rotation.x = tilt, negative = face looks up)
 *   gun_harrow: turret (yaw), elevator (rotation.x = -elev rad), rails [2 muzzle Object3D, +Z = fire dir],
 *               searchRadar (spin about Y), trackRadar (child of elevator)
 *   generator:  exhaust (Object3D at the stack top)
 *   radar_lowalt also blinks a red obstruction light in update().
 * ==========================================================================*/
(function () {
  'use strict';
  const THREE = window.THREE;
  if (!THREE) { console.error('models_ground.js: THREE not found'); return; }
  const V3 = THREE.Vector3, M4 = THREE.Matrix4, PI = Math.PI;
  const R = (x, y, z) => new M4().makeRotationFromEuler(new THREE.Euler(x, y, z));
  const KINDS = ['radar_search', 'radar_fc', 'radar_lowalt', 'gun_harrow', 'command_post', 'generator'];

  /* ---------------------------------------------------------------- textures */
  function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h || w; return c; };
  const rgb = (r, g, b) => 'rgb(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ')';
  let TEX = null;
  function textures() {
    if (TEX) return TEX;
    // three-tone disruptive camo, tileable (own seed so the battery vehicles differ from the launchers)
    const N = 512, cv = canvas(N), g = cv.getContext('2d'), img = g.createImageData(N, N), r = rng(211);
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

    // active array tile: 16 x 16 transmit/receive modules, tile border + corner bolts
    const ac = canvas(256), ag = ac.getContext('2d');
    ag.fillStyle = '#1c211b'; ag.fillRect(0, 0, 256, 256);
    for (let j = 0; j < 16; j++) for (let i = 0; i < 16; i++) {
      const s = 16, x = i * s, y = j * s, v = 0.86 + 0.22 * r();
      ag.fillStyle = rgb(78 * v, 88 * v, 72 * v); ag.fillRect(x + 1.5, y + 1.5, s - 3, s - 3);
      ag.fillStyle = 'rgba(255,255,255,0.10)'; ag.fillRect(x + 1.5, y + 1.5, s - 3, 1.5);
      ag.fillStyle = 'rgba(14,17,13,0.85)'; ag.fillRect(x + 7, y + 4, 2, s - 8); ag.fillRect(x + 4, y + 7, s - 8, 2);
    }
    ag.strokeStyle = '#11140f'; ag.lineWidth = 6; ag.strokeRect(0, 0, 256, 256);
    ag.fillStyle = '#8c9384'; [[8, 8], [248, 8], [8, 248], [248, 248], [128, 5], [128, 251], [5, 128], [251, 128]].forEach(p => { ag.beginPath(); ag.arc(p[0], p[1], 2.5, 0, 7); ag.fill(); });
    const aesa = new THREE.CanvasTexture(ac); aesa.anisotropy = 4;

    // space-fed lens face: dense grid of round phase-shifter elements
    const pc = canvas(512), pg = pc.getContext('2d');
    pg.fillStyle = '#4b5144'; pg.fillRect(0, 0, 512, 512);
    pg.strokeStyle = 'rgba(20,24,18,0.55)'; pg.lineWidth = 1;
    for (let i = 0; i <= 40; i++) { const p = i * 12.8; pg.beginPath(); pg.moveTo(p, 0); pg.lineTo(p, 512); pg.moveTo(0, p); pg.lineTo(512, p); pg.stroke(); }
    for (let j = 0; j < 40; j++) for (let i = 0; i < 40; i++) {
      const x = i * 12.8 + 6.4, y = j * 12.8 + 6.4, v = 0.9 + 0.2 * r();
      pg.fillStyle = rgb(30 * v, 34 * v, 28 * v); pg.beginPath(); pg.arc(x, y, 4.6, 0, 7); pg.fill();
      pg.fillStyle = 'rgba(190,196,176,0.35)'; pg.beginPath(); pg.arc(x - 1, y - 1, 1.4, 0, 7); pg.fill();
    }
    pg.strokeStyle = 'rgba(15,18,14,0.9)'; pg.lineWidth = 4;
    for (let i = 1; i < 4; i++) { const p = i * 128; pg.beginPath(); pg.moveTo(p, 0); pg.lineTo(p, 512); pg.moveTo(0, p); pg.lineTo(512, p); pg.stroke(); }
    const pesa = new THREE.CanvasTexture(pc); pesa.anisotropy = 4;

    // slotted-waveguide face: staggered rows of radiating slots
    const sc = canvas(256), sg = sc.getContext('2d');
    sg.fillStyle = '#525a47'; sg.fillRect(0, 0, 256, 256);
    for (let j = 0; j < 16; j++) {
      const y = j * 16;
      sg.fillStyle = j % 2 ? '#4a5240' : '#566049'; sg.fillRect(0, y, 256, 16);
      sg.fillStyle = 'rgba(20,23,17,0.9)';
      for (let i = 0; i < 16; i++) { const x = i * 16 + (j % 2 ? 8 : 0) + 2; sg.fillRect(x, y + 6 + (i % 2 ? -2 : 2), 11, 3); }
      sg.fillStyle = 'rgba(12,14,10,0.9)'; sg.fillRect(0, y, 256, 1.5);
    }
    sg.strokeStyle = '#1b1f17'; sg.lineWidth = 4; sg.strokeRect(0, 0, 256, 256);
    const slot = new THREE.CanvasTexture(sc); slot.anisotropy = 4;
    TEX = { camo, aesa, pesa, slot };
    return TEX;
  }

  /* --------------------------------------------------------------- materials */
  const MAT = {};
  function mat(n) {
    if (MAT[n]) return MAT[n];
    const S = o => new THREE.MeshStandardMaterial(o), t = textures();
    const defs = {
      camo: () => S({ color: 0xffffff, roughness: 0.82, metalness: 0.1, map: t.camo }),
      dark: () => S({ color: 0xffffff, roughness: 0.85, metalness: 0.08, vertexColors: true }),
      metal: () => S({ color: 0xffffff, roughness: 0.45, metalness: 0.55, vertexColors: true }),
      glass: () => S({ color: 0x1b262d, roughness: 0.08, metalness: 0.6 }),
      emit: () => new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true }),
      aesa: () => S({ color: 0xdfe6d8, roughness: 0.55, metalness: 0.3, map: t.aesa }),
      pesa: () => S({ color: 0xffffff, roughness: 0.6, metalness: 0.25, map: t.pesa }),
      slot: () => S({ color: 0xffffff, roughness: 0.65, metalness: 0.2, map: t.slot }),
      beacon: () => new THREE.MeshBasicMaterial({ color: 0xff2a14 })
    };
    return (MAT[n] = defs[n]());
  }
  const UVMAT = { aesa: 1, pesa: 1, slot: 1 };              // materials that keep the geometry's own UVs
  // key → [material, vertex colour]
  const PAL = {
    camo: ['camo'], glass: ['glass'], aesa: ['aesa'], pesa: ['pesa'], slot: ['slot'],
    tyre: ['dark', 0x1b1c1a], black: ['dark', 0x131412], hub: ['dark', 0x3d4a2c], paint: ['dark', 0x4a5634],
    sand: ['dark', 0x7d6d4c], rubber: ['dark', 0x262724], cable: ['dark', 0x121311], canvas: ['dark', 0x59603f],
    white: ['dark', 0xb8b5a6], dred: ['dark', 0x6e1c16], gsteel: ['dark', 0x55584f], olive: ['dark', 0x3f4a2f],
    steel: ['metal', 0x4f524a], chrome: ['metal', 0xb0b3ae], dsteel: ['metal', 0x2f312c], lens: ['metal', 0x14212b],
    alu: ['metal', 0x9a9e96], grate: ['metal', 0x3e413a], yellow: ['metal', 0x9b8a3a],
    lamp: ['emit', 0xf7efd2], tail: ['emit', 0x8a1d18], amber: ['emit', 0xd08a1c], green: ['emit', 0x3ad05e], red: ['emit', 0xd8261a]
  };

  /* ------------------------------------------------------------ geometry kit */
  const _q = new THREE.Quaternion(), _vm = new V3(), _vd = new V3(), _one = new V3(1, 1, 1), _Y = new V3(0, 1, 0), _col = new THREE.Color();
  function orient(a, b) {
    _vd.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const L = _vd.length(); if (!(L > 1e-5)) return null;
    _q.setFromUnitVectors(_Y, _vd.multiplyScalar(1 / L));
    _vm.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    return { L, m: new M4().compose(_vm, _q, _one) };
  }
  // reversed-winding copy (inside faces of dishes / open shells)
  function flipped(geom) {
    const g = geom.index ? geom.toNonIndexed() : geom.clone(), p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i += 3) {
      for (let c = 0; c < 3; c++) { const t = p.array[(i + 1) * 3 + c]; p.array[(i + 1) * 3 + c] = p.array[(i + 2) * 3 + c]; p.array[(i + 2) * 3 + c] = t; }
      if (n) for (let c = 0; c < 3; c++) { const t = n.array[(i + 1) * 3 + c]; n.array[(i + 1) * 3 + c] = n.array[(i + 2) * 3 + c]; n.array[(i + 2) * 3 + c] = t; }
      if (uv) for (let c = 0; c < 2; c++) { const t = uv.array[(i + 1) * 2 + c]; uv.array[(i + 1) * 2 + c] = uv.array[(i + 2) * 2 + c]; uv.array[(i + 2) * 2 + c] = t; }
    }
    if (n) for (let i = 0; i < n.array.length; i++) n.array[i] = -n.array[i];
    return g;
  }
  class Kit {
    constructor(lod) { this.b = new Map(); this.hi = lod !== 'low'; }
    add(geom, key, m) {
      const p = PAL[key] || [key, 0xffffff], mn = p[0], mt = mat(mn);
      const g = geom.index ? geom.toNonIndexed() : geom.clone();
      if (!g.attributes.normal) g.computeVertexNormals();
      Object.keys(g.attributes).forEach(k => { if (k !== 'position' && k !== 'normal' && !(UVMAT[mn] && k === 'uv')) g.deleteAttribute(k); });
      if (m) g.applyMatrix4(m);
      if (mt.vertexColors) {
        const n = g.attributes.position.count, c = new Float32Array(n * 3); _col.setHex(p[1]);
        for (let i = 0; i < n; i++) { c[i * 3] = _col.r; c[i * 3 + 1] = _col.g; c[i * 3 + 2] = _col.b; }
        g.setAttribute('color', new THREE.BufferAttribute(c, 3));
      }
      if (!this.b.has(mn)) this.b.set(mn, []);
      this.b.get(mn).push(g);
      geom.dispose();
    }
    box(key, x0, x1, y0, y1, z0, z1, m) {
      const g = new THREE.BoxGeometry(Math.max(1e-3, Math.abs(x1 - x0)), Math.max(1e-3, Math.abs(y1 - y0)), Math.max(1e-3, Math.abs(z1 - z0)));
      g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      this.add(g, key, m);
    }
    // box of size (w,h,d) rotated by euler (rx,ry,rz) about its own centre (x,y,z)
    rbox(key, w, h, d, x, y, z, rx, ry, rz) { const g = new THREE.BoxGeometry(w, h, d); g.applyMatrix4(R(rx || 0, ry || 0, rz || 0)); g.translate(x, y, z); this.add(g, key); }
    cylX(key, r, w, x, y, z, segs) { const g = new THREE.CylinderGeometry(r, r, w, segs || 16); g.rotateZ(PI / 2); g.translate(x, y, z); this.add(g, key); }
    cylY(key, r, h, x, y0, z, segs) { const g = new THREE.CylinderGeometry(r, r, h, segs || 10); g.translate(x, y0 + h / 2, z); this.add(g, key); }
    cylZ(key, r, l, x, y, z0, segs) { const g = new THREE.CylinderGeometry(r, r, l, segs || 14); g.rotateX(PI / 2); g.translate(x, y, z0 + l / 2); this.add(g, key); }
    rod(key, a, b, r, segs) { const o = orient(a, b); if (o) this.add(new THREE.CylinderGeometry(r, r, o.L, segs || 6, 1, true), key, o.m); }
    beam(key, a, b, w, d) { const o = orient(a, b); if (o) this.add(new THREE.BoxGeometry(w, o.L, d || w), key, o.m); }
    lamp(key, x, y, z, s, back) { this.box(key, x - s, x + s, y - s * 0.7, y + s * 0.7, back ? z - 0.03 : z, back ? z : z + 0.03); }
    meshes() {
      const out = [];
      this.b.forEach((list, mn) => {
        const material = mat(mn), keepUV = !!UVMAT[mn], vc = !!material.vertexColors;
        let n = 0; list.forEach(g => n += g.attributes.position.count);
        const P = new Float32Array(n * 3), N = new Float32Array(n * 3), C = vc ? new Float32Array(n * 3) : null, U = keepUV ? new Float32Array(n * 2) : null;
        let o = 0;
        list.forEach(g => {
          const c = g.attributes.position.count;
          P.set(g.attributes.position.array, o * 3); N.set(g.attributes.normal.array, o * 3);
          if (C) C.set(g.attributes.color.array, o * 3);
          if (U && g.attributes.uv) U.set(g.attributes.uv.array, o * 2);
          o += c; g.dispose();
        });
        for (let i = 0; i < P.length; i++) if (!isFinite(P[i])) P[i] = 0;
        for (let i = 0; i < N.length; i++) if (!isFinite(N[i])) N[i] = 0;
        const bg = new THREE.BufferGeometry();
        bg.setAttribute('position', new THREE.BufferAttribute(P, 3));
        bg.setAttribute('normal', new THREE.BufferAttribute(N, 3));
        if (C) bg.setAttribute('color', new THREE.BufferAttribute(C, 3));
        if (U) bg.setAttribute('uv', new THREE.BufferAttribute(U, 2));
        else if (material.map) {                   // box-projected UVs, 16 m repeat
          const uv = new Float32Array(n * 2), S = 1 / 16, a = new V3(), b = new V3(), c = new V3(), f = new V3(), e = new V3();
          for (let t = 0; t < n; t += 3) {
            a.fromArray(P, t * 3); b.fromArray(P, t * 3 + 3); c.fromArray(P, t * 3 + 6);
            f.subVectors(c, b).cross(e.subVectors(a, b));
            const ax = Math.abs(f.x), ay = Math.abs(f.y), az = Math.abs(f.z);
            for (let v = 0; v < 3; v++) {
              const i = (t + v) * 3, x = P[i], y = P[i + 1], z = P[i + 2];
              let Uu, W;
              if (ay >= ax && ay >= az) { Uu = x * S + 0.3; W = z * S; } else if (ax >= az) { Uu = z * S; W = y * S + 0.6; } else { Uu = x * S + 0.1; W = y * S + 0.2; }
              uv[(t + v) * 2] = Uu; uv[(t + v) * 2 + 1] = W;
            }
          }
          bg.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
        }
        bg.computeBoundingSphere();
        out.push(new THREE.Mesh(bg, material));
      });
      this.b.clear();
      return out;
    }
  }

  /* ------------------------------------------------------------ part helpers */
  function wheel(k, x, y, z, r, w, segs) {
    const s = Math.sign(x) || 1;
    k.cylX('tyre', r, w, x, y, z, segs);
    k.cylX('hub', r * 0.56, 0.05, x + s * (w / 2 + 0.01), y, z, segs);
    k.cylX('hub', r * 0.3, 0.09, x + s * (w / 2 + 0.04), y, z, 12);
    k.cylX('steel', r * 0.13, 0.12, x + s * (w / 2 + 0.07), y, z, 8);
    if (!k.hi) return;
    for (let i = 0; i < 8; i++) {                 // wheel nuts
      const a = i * PI / 4, yy = y + Math.cos(a) * r * 0.42, zz = z + Math.sin(a) * r * 0.42, xx = x + s * (w / 2 + 0.05);
      k.box('steel', xx - 0.025, xx + 0.025, yy - 0.022, yy + 0.022, zz - 0.022, zz + 0.022);
    }
    for (let i = 0; i < segs; i++) {              // tread blocks
      const a = (i + 0.5) / segs * 2 * PI, g = new THREE.BoxGeometry(w * 0.92, 0.035, r * 0.2);
      g.translate(0, r + 0.008, 0); g.applyMatrix4(R(a, 0, 0)); g.translate(x, y, z); k.add(g, 'tyre');
    }
  }
  // deployed outrigger jack: foot on a timber block at ground level
  function jackLeg(k, x, z, yTop) {
    const hi = k.hi;
    k.box('camo', x - 0.17, x + 0.17, yTop - 0.7, yTop, z - 0.17, z + 0.17);            // housing
    k.cylY('chrome', 0.075, Math.max(0.05, yTop - 0.7 - 0.12), x, 0.12, z, 10);           // ram
    k.cylY('steel', 0.3, 0.07, x, 0.05, z, hi ? 16 : 10);                                   // pad
    k.cylY('steel', 0.11, 0.08, x, 0.11, z, 8);                                             // ball joint
    if (hi) k.box('sand', x - 0.42, x + 0.42, 0, 0.05, z - 0.42, z + 0.42);                 // timber
  }
  function jack(k, s, z, y) {                    // side outrigger: beam out of the chassis + leg
    k.box('camo', s * 0.7, s * 1.9, y - 0.11, y + 0.11, z - 0.13, z + 0.13);
    k.box('steel', s * 1.3, s * 1.62, y + 0.11, y + 0.14, z - 0.1, z + 0.1);
    jackLeg(k, s * 1.95, z, y + 0.25);
  }
  function ladder(k, key, a, b, side, w, step) {    // rails a→b offset ±side*w/2; rungs every `step`
    const sx = side[0] * w / 2, sz = side[1] * w / 2;
    k.beam(key, [a[0] - sx, a[1], a[2] - sz], [b[0] - sx, b[1], b[2] - sz], 0.05);
    k.beam(key, [a[0] + sx, a[1], a[2] + sz], [b[0] + sx, b[1], b[2] + sz], 0.05);
    if (!k.hi && step < 0.5) step = 0.9;
    const L = b[1] - a[1], n = Math.floor(L / step);
    for (let i = 1; i <= n; i++) {
      const t = i * step / L, x = a[0] + (b[0] - a[0]) * t, y = a[1] + L * t, z = a[2] + (b[2] - a[2]) * t;
      k.beam(key, [x - sx, y, z - sz], [x + sx, y, z + sz], 0.03);
    }
  }
  // cab-forward 8x8 truck chassis + cab. o: { zf, zr, axles[4], wr }
  function truck(k, o) {
    const hi = k.hi, ws = hi ? 18 : 10, zf = o.zf, zr = o.zr, ax = o.axles, wr = o.wr || 0.6, cz = zf - 2.05;
    [-1, 1].forEach(s => k.box('dsteel', s * 0.62 - 0.09, s * 0.62 + 0.09, 0.82, 1.18, zr + 0.05, zf - 0.25));   // frame rails
    for (let z = zr + 0.3; z < zf - 0.4; z += 1.7) k.box('dsteel', -0.62, 0.62, 0.9, 1.1, z - 0.06, z + 0.06);
    ax.forEach(z => { k.cylX('dsteel', 0.08, 1.9, 0, wr, z, 8); k.box('dsteel', -0.24, 0.24, wr - 0.2, wr + 0.2, z - 0.2, z + 0.2); });
    // cab
    k.box('camo', -1.28, 1.28, 1.32, 2.9, cz, zf - 0.14);
    k.box('camo', -1.22, 1.22, 2.9, 3.0, cz + 0.05, zf - 0.22);
    k.rbox('camo', 2.56, 0.62, 0.3, 0, 1.55, zf - 0.12, 0.42, 0, 0);                        // sloped nose
    [-1, 1].forEach(s => k.rbox('glass', 1.1, 0.78, 0.06, s * 0.6, 2.42, zf - 0.1, -0.14, 0, 0));
    k.rbox('camo', 0.1, 0.84, 0.1, 0, 2.42, zf - 0.09, -0.14, 0, 0);                       // centre pillar
    k.box('camo', -1.26, 1.26, 2.86, 2.93, zf - 0.2, zf + 0.12);                           // sun visor
    k.box('black', -1.0, 1.0, 1.62, 1.98, zf - 0.17, zf - 0.1);                            // grille
    for (let i = 0; i < 4; i++) k.box('steel', -0.96, 0.96, 1.66 + i * 0.085, 1.69 + i * 0.085, zf - 0.12, zf - 0.08);
    k.box('black', -1.32, 1.32, 0.78, 1.14, zf - 0.22, zf + 0.12);                          // bumper
    [-1, 1].forEach(s => {
      k.box('steel', s * 0.62 - 0.07, s * 0.62 + 0.07, 0.84, 1.0, zf + 0.12, zf + 0.26);    // tow hooks
      k.lamp('lamp', s * 0.95, 0.96, zf + 0.12, 0.1); k.lamp('amber', s * 1.18, 0.96, zf + 0.12, 0.05);
      k.lamp('lamp', s * 0.98, 2.02, zf - 0.14, 0.08);
      k.rbox('black', 0.5, 0.03, 0.03, s * 0.55, 2.1, zf - 0.03, 0, 0, s * 0.35);          // wipers
      k.box('amber', s * 0.9 - 0.07, s * 0.9 + 0.07, 3.0, 3.13, zf - 0.47, zf - 0.33);      // roof beacons
      // doors + windows
      k.box('glass', s * 1.28, s * 1.3, 2.05, 2.7, zf - 1.6, zf - 0.45);
      k.box('black', s * 1.28, s * 1.305, 1.38, 2.74, zf - 1.66, zf - 1.62);
      k.box('black', s * 1.28, s * 1.305, 1.38, 2.74, zf - 0.42, zf - 0.38);
      k.box('steel', s * 1.28, s * 1.32, 1.9, 1.94, zf - 1.5, zf - 1.36);
      k.box('glass', s * 1.28, s * 1.3, 2.05, 2.7, cz + 0.25, cz + 0.85);
      k.box('steel', s * 1.02, s * 1.32, 0.74, 0.79, zf - 0.9, zf - 0.3);                  // steps
      k.box('steel', s * 1.1, s * 1.32, 1.12, 1.16, zf - 0.9, zf - 0.3);
      k.rod('steel', [s * 1.28, 2.62, zf - 0.4], [s * 1.56, 2.62, zf - 0.22], 0.02, 5);    // mirrors
      k.rod('steel', [s * 1.28, 2.1, zf - 0.4], [s * 1.56, 2.3, zf - 0.22], 0.02, 5);
      k.box('black', s * 1.5, s * 1.6, 2.22, 2.78, zf - 0.27, zf - 0.17);
      k.rod('steel', [s * 1.3, 1.6, cz + 0.1], [s * 1.3, 2.8, cz + 0.1], 0.02, 5);         // grab handle
      // running gear
      ax.forEach(z => wheel(k, s * 1.07, wr, z, wr, 0.52, ws));
      k.box('camo', s * 0.8, s * 1.36, 1.24, 1.32, ax[1] - 0.72, ax[0] + 0.72);             // fenders
      k.box('camo', s * 0.8, s * 1.36, 1.24, 1.32, ax[3] - 0.72, ax[2] + 0.72);
      k.rbox('camo', 0.56, 0.06, 0.5, s * 1.08, 1.12, ax[3] - 0.9, -0.6, 0, 0);
      k.rbox('camo', 0.56, 0.06, 0.5, s * 1.08, 1.12, ax[2] + 0.9, 0.6, 0, 0);
      k.box('black', s * 0.82, s * 1.32, 0.3, 1.24, ax[3] - 0.78, ax[3] - 0.75);            // mud flaps
      const gap0 = ax[2] + 0.8, gap1 = ax[1] - 0.8, gl = gap1 - gap0;
      if (gl > 1.2) {
        const tl = Math.min(1.7, gl * 0.5);
        k.cylZ('camo', 0.3, tl, s * 1.0, 0.95, gap1 - tl - 0.05, hi ? 16 : 10);             // fuel tank
        k.box('steel', s * 0.72, s * 1.3, 0.62, 0.67, gap1 - tl - 0.05, gap1 - 0.05);
        k.box('camo', s * 0.72, s * 1.25, 0.6, 1.15, gap0 + 0.05, gap0 + Math.min(0.8, gl - tl - 0.2)); // battery / tool box
        k.box('black', s * 1.25, s * 1.27, 0.7, 1.05, gap0 + 0.15, gap0 + Math.min(0.7, gl - tl - 0.3));
      }
      k.lamp('tail', s * 1.0, 1.05, zr - 0.02, 0.08, true); k.lamp('amber', s * 0.8, 1.05, zr - 0.02, 0.05, true);
    });
    k.box('black', -1.25, 1.25, 0.75, 0.98, zr - 0.1, zr + 0.05);                         // rear bumper
    k.box('steel', -0.35, 0.35, 0.95, 1.3, cz + 0.4, cz + 1.2);                            // hatch on the roof
    k.box('steel', -0.35, 0.35, 3.0, 3.05, cz + 0.4, cz + 1.2);
  }
  // equipment shelter box with corner castings, roof rim, door, vents
  function shelter(k, x0, x1, y0, y1, z0, z1) {
    k.box('camo', x0, x1, y0, y1, z0, z1);
    k.box('camo', x0 + 0.05, x1 - 0.05, y1, y1 + 0.06, z0 + 0.05, z1 - 0.05);
    [[x0, z0], [x1, z0], [x0, z1], [x1, z1]].forEach(([x, z]) => {
      const sx = x > 0 ? -1 : 1, sz = z > 0 ? -1 : 1;
      k.box('dsteel', x - 0.02 * sx, x + 0.12 * sx, y0 - 0.02, y1 + 0.02, z - 0.02 * sz, z + 0.12 * sz);
    });
    [y0, y1].forEach(y => { k.box('dsteel', x0 - 0.02, x1 + 0.02, y - 0.05, y + 0.05, z0 - 0.02, z0 + 0.08); k.box('dsteel', x0 - 0.02, x1 + 0.02, y - 0.05, y + 0.05, z1 - 0.08, z1 + 0.02); });
  }
  function louvres(k, face, x, y0, y1, z0, z1, n) {   // on an X-facing wall at x (face = ±1)
    const d = (y1 - y0) / n;
    k.box('black', x, x + face * 0.01, y0, y1, z0, z1);
    for (let i = 0; i < n; i++) k.rbox('gsteel', 0.02, d * 0.9, z1 - z0 - 0.04, x + face * 0.03, y0 + (i + 0.5) * d, (z0 + z1) / 2, 0, 0, face * 0.5);
  }
  function louvresZ(k, face, z, x0, x1, y0, y1, n) {  // on a Z-facing wall at z
    const d = (y1 - y0) / n;
    k.box('black', x0, x1, y0, y1, z, z + face * 0.01);
    for (let i = 0; i < n; i++) k.rbox('gsteel', x1 - x0 - 0.04, d * 0.9, 0.02, (x0 + x1) / 2, y0 + (i + 0.5) * d, z + face * 0.03, -face * 0.5, 0, 0);
  }
  function railing(k, key, x0, x1, z0, z1, y, h, gapSide) {   // rectangular handrail; gapSide leaves a gate on -Z side
    const posts = [];
    const nx = Math.max(1, Math.round((x1 - x0) / 1.2)), nz = Math.max(1, Math.round((z1 - z0) / 1.2));
    for (let i = 0; i <= nx; i++) { const x = x0 + (x1 - x0) * i / nx; posts.push([x, z0], [x, z1]); }
    for (let i = 1; i < nz; i++) { const z = z0 + (z1 - z0) * i / nz; posts.push([x0, z], [x1, z]); }
    posts.forEach(p => k.beam(key, [p[0], y, p[1]], [p[0], y + h, p[1]], 0.045));
    [h, h * 0.5].forEach(hh => {
      const yy = y + hh;
      k.beam(key, [x0, yy, z1], [x1, yy, z1], 0.04); k.beam(key, [x0, yy, z0], [x0, yy, z1], 0.04); k.beam(key, [x1, yy, z0], [x1, yy, z1], 0.04);
      if (gapSide) { k.beam(key, [x0, yy, z0], [x0 + (x1 - x0) * 0.35, yy, z0], 0.04); k.beam(key, [x1 - (x1 - x0) * 0.35, yy, z0], [x1, yy, z0], 0.04); }
      else k.beam(key, [x0, yy, z0], [x1, yy, z0], 0.04);
    });
    k.box(key, x0, x1, y, y + 0.1, z0 - 0.02, z0 + 0.02); k.box(key, x0, x1, y, y + 0.1, z1 - 0.02, z1 + 0.02);   // toe boards
    k.box(key, x0 - 0.02, x0 + 0.02, y, y + 0.1, z0, z1); k.box(key, x1 - 0.02, x1 + 0.02, y, y + 0.1, z0, z1);
  }
  function octShape(hw, hh, c, cy) {
    const s = new THREE.Shape();
    s.moveTo(-hw + c, cy - hh); s.lineTo(hw - c, cy - hh); s.lineTo(hw, cy - hh + c); s.lineTo(hw, cy + hh - c);
    s.lineTo(hw - c, cy + hh); s.lineTo(-hw + c, cy + hh); s.lineTo(-hw, cy + hh - c); s.lineTo(-hw, cy - hh + c); s.closePath();
    return s;
  }
  function extrude(shape, z0, depth) { const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 1, steps: 1 }); g.translate(0, 0, z0); return g; }
  // turntable + yoke base shared by the radar heads
  function turntable(k, r, h) {
    k.cylY('steel', r * 0.92, h * 0.55, 0, 0, 0, k.hi ? 28 : 14);
    k.cylY('camo', r, h * 0.45, 0, h * 0.55, 0, k.hi ? 28 : 14);
    if (k.hi) for (let i = 0; i < 16; i++) { const a = i / 16 * 2 * PI; k.box('dsteel', Math.cos(a) * r * 0.93 - 0.03, Math.cos(a) * r * 0.93 + 0.03, h * 0.45, h * 0.55, Math.sin(a) * r * 0.93 - 0.03, Math.sin(a) * r * 0.93 + 0.03); }
  }

  /* ------------------------------------------------------------ model defs */
  // build(lod) → { body: Kit, nodes: [{ name, parent, pos, rot, kit }], anchors: {...}, height, name }
  const DEF = {};

  /* ---------------- radar_search: 8x8 truck, lift pedestal, flat-panel active array */
  DEF.radar_search = function (lod) {
    const k = new Kit(lod), hi = k.hi, PZ = -2.2, PY = 7.6;
    truck(k, { zf: 6.2, zr: -6.0, axles: [4.65, 3.2, -2.9, -4.35] });
    jack(k, 1, 2.35, 1.0); jack(k, -1, 2.35, 1.0); jack(k, 1, -5.55, 1.0); jack(k, -1, -5.55, 1.0);
    // power unit behind the cab
    k.box('camo', -1.2, 1.2, 1.2, 2.75, 1.4, 3.95);
    [-1, 1].forEach(s => louvres(k, s, s * 1.2, 1.5, 2.55, 2.4, 3.8, 6));
    louvresZ(k, -1, 1.4, -0.9, 0.9, 1.5, 2.5, 5);
    k.box('camo', -1.25, 1.25, 2.75, 2.82, 1.35, 4.0);
    k.cylY('black', 0.08, 1.0, -0.95, 2.82, 3.7, 8); k.cylY('steel', 0.12, 0.3, -0.95, 3.05, 3.7, 8);
    k.rbox('black', 0.2, 0.02, 0.2, -0.95, 3.86, 3.72, 0.4, 0, 0);
    // deck + pedestal
    k.box('camo', -1.25, 1.25, 1.2, 1.5, -6.0, 1.3);
    k.box('grate', -1.2, 1.2, 1.5, 1.52, -6.0, 1.3);
    k.box('camo', -1.1, 1.1, 1.5, 2.6, PZ - 1.1, PZ + 1.1);                                   // pedestal base
    k.box('steel', -0.85, 0.85, 2.6, 2.75, PZ - 0.85, PZ + 0.85);
    k.box('camo', -0.62, 0.62, 2.75, 5.35, PZ - 0.62, PZ + 0.62);                             // stage 1
    k.box('steel', -0.7, 0.7, 5.25, 5.45, PZ - 0.7, PZ + 0.7);                                // collar
    k.box('chrome', -0.48, 0.48, 5.45, 7.3, PZ - 0.48, PZ + 0.48);                            // stage 2
    k.cylY('steel', 0.82, 0.32, 0, 7.28, PZ, hi ? 24 : 12);                                   // slew bearing
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => {
      k.beam('steel', [sx * 1.15, 1.5, PZ + sz * 1.8], [sx * 0.6, 4.4, PZ + sz * 0.62], 0.13);   // braces
      k.box('steel', sx * 1.0, sx * 1.3, 1.5, 1.6, PZ + sz * 1.8 - 0.15, PZ + sz * 1.8 + 0.15);
    });
    ladder(k, 'yellow', [-0.72, 1.55, PZ - 0.2], [-0.72, 7.2, PZ - 0.2], [0, 1], 0.42, 0.3);
    k.rod('cable', [0.64, 2.8, PZ + 0.3], [0.64, 7.2, PZ + 0.3], 0.05, 6);                  // cable loom
    k.rod('cable', [0.64, 2.8, PZ + 0.3], [0.9, 1.55, PZ + 1.5], 0.05, 6);
    // equipment cabinets at the rear + cable reel
    [-1, 1].forEach(s => {
      k.box('camo', s * 0.15, s * 1.22, 1.52, 2.7, -5.95, -4.1);
      k.box('black', s * 1.22, s * 1.235, 1.62, 2.6, -5.85, -5.05); k.box('black', s * 1.22, s * 1.235, 1.62, 2.6, -5.0, -4.2);
      k.box('steel', s * 1.22, s * 1.25, 2.05, 2.15, -5.15, -5.08);
    });
    k.box('camo', -1.25, 1.25, 2.7, 2.76, -6.0, -4.05);
    k.cylX('steel', 0.45, 0.06, -0.55, 2.05, 0.4, hi ? 18 : 10); k.cylX('steel', 0.45, 0.06, 0.55, 2.05, 0.4, hi ? 18 : 10);
    k.cylX('cable', 0.38, 1.04, 0, 2.05, 0.4, hi ? 18 : 10);
    k.box('steel', -0.62, -0.52, 1.52, 2.05, 0.3, 0.5); k.box('steel', 0.52, 0.62, 1.52, 2.05, 0.3, 0.5);

    // ---- head (yaw), origin on the slew bearing
    const h = new Kit(lod);
    turntable(h, 1.2, 0.4);
    h.box('camo', -1.62, 1.62, 0.4, 0.62, -2.95, 0.85);                                        // head deck
    h.box('grate', -1.6, 1.6, 0.62, 0.64, -1.1, 0.8);
    [-1, 1].forEach(s => {
      h.box('camo', s * 1.44, s * 1.72, 0.62, 2.05, -0.38, 0.38);                               // yoke arms
      h.beam('camo', [s * 1.58, 0.62, -0.9], [s * 1.58, 1.9, -0.1], 0.2, 0.26);
      h.cylX('steel', 0.24, 0.36, s * 1.58, 2.4, 0, hi ? 16 : 8);
      h.box('camo', s * 1.46, s * 1.7, 1.95, 2.4, -0.24, 0.24);
      h.rod('chrome', [s * 0.9, 0.64, -1.35], [s * 0.9, 1.37, 0.06], 0.06, 8);                // elevation rams
      h.rod('camo', [s * 0.9, 0.64, -1.35], [s * 0.9, 1.0, -0.63], 0.1, 8);
      h.box('steel', s * 0.8, s * 1.0, 0.62, 0.72, -1.45, -1.25);
    });
    h.box('camo', -1.25, 1.25, 0.62, 2.0, -2.9, -1.25);                                        // transmitter / cooling cabin
    h.box('camo', -1.3, 1.3, 2.0, 2.07, -2.95, -1.2);
    louvresZ(h, -1, -2.9, -1.0, 1.0, 0.8, 1.85, 6);
    [-1, 1].forEach(s => { louvres(h, s, s * 1.25, 1.1, 1.8, -2.6, -1.9, 4); h.box('black', s * 1.25, s * 1.265, 0.72, 1.9, -1.8, -1.35); });
    h.cylY('steel', 0.22, 0.12, 0.6, 2.07, -2.1, 12); h.box('black', 0.42, 0.78, 2.19, 2.21, -2.28, -1.92);   // fan
    h.rod('black', [-0.9, 2.07, -2.6], [-0.9, 4.2, -2.6], 0.015, 4);                        // whip
    h.cylY('white', 0.09, 0.06, -0.5, 2.07, -2.6, 10);                                          // GPS puck
    railing(h, 'yellow', -1.55, 1.55, -1.12, 0.78, 0.64, 0.9, false);

    // ---- panel (tilt), origin on the hinge axis. Face +Z at z 0.6..0.65, centre y +0.3
    const p = new Kit(lod), W = 3.8, Y0 = -1.6, Y1 = 2.2;
    p.box('camo', -W - 0.05, W + 0.05, Y0 - 0.05, Y1 + 0.05, 0.15, 0.55);                       // array slab
    [[-W - 0.08, -W + 0.02], [W - 0.02, W + 0.08]].forEach(([a, b]) => p.box('camo', a, b, Y0 - 0.08, Y1 + 0.08, 0.1, 0.7));
    p.box('camo', -W - 0.08, W + 0.08, Y0 - 0.08, Y0 + 0.02, 0.1, 0.7); p.box('camo', -W - 0.08, W + 0.08, Y1 - 0.02, Y1 + 0.08, 0.1, 0.7);
    const TW = 0.95;
    for (let j = 0; j < 4; j++) for (let i = 0; i < 8; i++) {
      const x0 = -W + i * TW, y0 = Y0 + j * TW, g = new THREE.BoxGeometry(TW - 0.025, TW - 0.025, 0.05);
      g.translate(x0 + TW / 2, y0 + TW / 2, 0.58); p.add(g, 'aesa');
    }
    // IFF strip on top
    p.box('camo', -2.3, 2.3, Y1 + 0.08, Y1 + 0.42, 0.2, 0.5);
    p.box('olive', -2.2, 2.2, Y1 + 0.12, Y1 + 0.38, 0.5, 0.53);
    if (hi) for (let i = 0; i < 16; i++) { const x = -2.06 + i * 0.275; p.box('alu', x - 0.05, x + 0.05, Y1 + 0.17, Y1 + 0.33, 0.53, 0.56); }
    // back structure
    [-3.4, -2.4, -0.75, 0.75, 2.4, 3.4].forEach(x => p.box('steel', x - 0.06, x + 0.06, Y0 + 0.05, Y1 - 0.05, -0.2, 0.15));
    [Y0 + 0.3, 0.3, Y1 - 0.3].forEach(y => p.box('steel', -W + 0.1, W - 0.1, y - 0.06, y + 0.06, -0.2, 0.15));
    if (hi) [[-3.4, -2.4], [-2.4, -0.75], [0.75, 2.4], [2.4, 3.4]].forEach(([a, b]) => {
      p.beam('steel', [a, Y0 + 0.3, -0.12], [b, 0.3, -0.12], 0.07); p.beam('steel', [a, Y1 - 0.3, -0.12], [b, 0.3, -0.12], 0.07);
    });
    p.box('camo', -1.25, 1.25, -0.95, 0.95, -0.72, -0.2);                                        // receiver / processor box
    louvresZ(p, -1, -0.72, -1.0, 1.0, -0.7, 0.7, 6);
    [-1, 1].forEach(s => {
      p.box('camo', s * 2.45, s * 3.4, -0.7, 1.3, -0.55, -0.2);                                   // power / cooling boxes
      p.box('black', s * 2.55, s * 3.3, -0.5, 1.1, -0.56, -0.55);
      p.cylX('steel', 0.2, 0.3, s * 1.58, 0, 0, hi ? 14 : 8);                                     // hinge lugs
      p.box('steel', s * 1.44, s * 1.72, -0.2, 0.3, -0.25, 0.15);
      p.cylX('steel', 0.07, 0.8, s * 1.9, Y0 + 0.35, -0.3, 8);                                    // coolant pipes
      p.cylX('steel', 0.07, 0.8, s * 1.9, Y1 - 0.35, -0.3, 8);
      p.box('olive', s * (W + 0.08), s * (W + 0.35), -0.4, 0.6, 0.15, 0.62);                      // side aux arrays
    });
    p.cylX('steel', 0.07, 3.6, 0, Y0 + 0.35, -0.3, 8); p.cylX('steel', 0.07, 3.6, 0, Y1 - 0.35, -0.3, 8);
    return {
      name: 'search radar', height: 12.7, body: k,
      nodes: [{ name: 'head', parent: 'root', pos: [0, PY, PZ], kit: h }, { name: 'panel', parent: 'head', pos: [0, 2.4, 0], rot: [-0.3, 0, 0], kit: p }]
    };
  };

  /* ---------------- radar_fc: 8x8 truck + guyed telescopic mast, space-fed lens array with feed boom */
  DEF.radar_fc = function (lod) {
    const k = new Kit(lod), hi = k.hi, MZ = -4.9, MY = 16.1;
    truck(k, { zf: 6.0, zr: -6.0, axles: [4.45, 3.0, -2.9, -4.35] });
    jack(k, 1, 2.15, 1.0); jack(k, -1, 2.15, 1.0); jack(k, 1, -5.6, 1.0); jack(k, -1, -5.6, 1.0);
    k.box('camo', -1.25, 1.25, 1.2, 1.5, -6.0, 3.8);                                               // deck
    // operator cabin
    shelter(k, -1.25, 1.25, 1.5, 3.95, -3.4, 3.75);
    [-1, 1].forEach(s => {
      louvres(k, s, s * 1.25, 3.1, 3.7, 2.6, 3.4, 4);
      k.box('black', s * 1.25, s * 1.265, 2.2, 2.9, -2.9, -2.2);                                   // vent grille
    });
    k.box('black', 1.25, 1.265, 1.55, 3.55, -0.6, 0.5); k.box('camo', 1.25, 1.27, 1.6, 3.5, -0.55, 0.45);   // door
    k.box('steel', 1.27, 1.31, 2.4, 2.5, 0.25, 0.35);
    for (let i = 0; i < 3; i++) k.box('steel', 1.3, 1.62, 0.55 + i * 0.32, 0.6 + i * 0.32, -0.5, 0.4);    // fold-down steps
    k.beam('steel', [1.62, 0.5, -0.5], [1.3, 1.5, -0.5], 0.04); k.beam('steel', [1.62, 0.5, 0.4], [1.3, 1.5, 0.4], 0.04);
    k.box('camo', -0.95, 0.95, 3.4, 3.95, 3.75, 4.15);                                           // air-con over the cab
    k.box('black', -0.85, 0.85, 3.5, 3.85, 4.15, 4.16);
    k.box('camo', -1.2, -0.3, 4.01, 4.4, 1.6, 2.8);                                              // roof A/C unit
    if (hi) { k.cylY('black', 0.3, 0.02, -0.75, 4.4, 2.2, 14); k.box('steel', -1.05, -0.45, 4.42, 4.44, 2.18, 2.22); }
    k.box('steel', -0.5, 0.5, 4.01, 4.5, -2.7, -2.3); k.box('rubber', -0.35, 0.35, 4.5, 4.58, -2.7, -2.3);   // mast travel rest
    k.rod('black', [0.9, 4.01, 3.2], [0.9, 7.0, 3.2], 0.016, 4); k.rod('black', [-0.9, 4.01, -3.0], [-0.9, 6.5, -3.0], 0.016, 4);
    // mast base + telescopic mast
    k.box('camo', -1.2, 1.2, 1.5, 2.1, MZ - 0.8, MZ + 0.8);
    [-1, 1].forEach(s => {
      k.box('camo', s * 0.5, s * 0.75, 1.5, 3.2, MZ - 0.55, MZ + 0.55);                            // pivot cheeks
      k.cylX('steel', 0.16, 0.2, s * 0.7, 2.9, MZ, 12);
      k.beam('steel', [s * 1.05, 1.5, -3.6], [s * 0.42, 5.2, MZ + 0.3], 0.14);                     // erector rams
      k.beam('chrome', [s * 0.8, 3.0, -4.08], [s * 0.42, 5.2, MZ + 0.3], 0.08);
    });
    k.box('camo', -0.4, 0.4, 2.1, 8.2, MZ - 0.4, MZ + 0.4);
    k.box('steel', -0.48, 0.48, 8.05, 8.35, MZ - 0.48, MZ + 0.48);
    k.box('camo', -0.32, 0.32, 8.35, 12.8, MZ - 0.32, MZ + 0.32);
    k.box('steel', -0.4, 0.4, 12.65, 12.95, MZ - 0.4, MZ + 0.4);
    k.box('chrome', -0.25, 0.25, 12.95, 15.85, MZ - 0.25, MZ + 0.25);
    k.cylY('steel', 0.55, 0.28, 0, 15.82, MZ, hi ? 20 : 10);
    k.rod('cable', [0.44, 2.2, MZ + 0.2], [0.44, 8.0, MZ + 0.2], 0.05, 5);
    k.rod('cable', [0.36, 8.4, MZ + 0.15], [0.36, 12.6, MZ + 0.15], 0.045, 5);
    k.rod('cable', [0.3, 13.0, MZ + 0.1], [0.3, 15.8, MZ + 0.1], 0.04, 5);
    k.rod('cable', [0.44, 2.2, MZ + 0.2], [1.0, 1.55, -3.6], 0.05, 5);
    // guy wires: two collars → four stakes
    const anchors = [[-6.2, MZ - 6.2], [6.2, MZ - 6.2], [-6.2, MZ + 6.2], [6.2, MZ + 6.2]];
    anchors.forEach(([x, z]) => {
      [[8.2, 0.48], [12.8, 0.4]].forEach(([y, r]) => k.rod('cable', [Math.sign(x) * r, y, MZ + Math.sign(z - MZ) * r], [x, 0.3, z], 0.016, 3));
      k.cylY('steel', 0.05, 0.45, x, 0, z, 6); k.box('sand', x - 0.3, x + 0.3, 0, 0.05, z - 0.3, z + 0.3);
    });
    // head
    const h = new Kit(lod);
    turntable(h, 0.8, 0.3);
    h.box('camo', -1.1, 1.1, 0.3, 0.48, -2.0, 0.7);
    [-1, 1].forEach(s => {
      h.box('camo', s * 1.12, s * 1.36, 0.48, 1.85, -0.34, 0.34);
      h.beam('camo', [s * 1.24, 0.48, -0.9], [s * 1.24, 1.7, -0.1], 0.18, 0.22);
      h.cylX('steel', 0.2, 0.3, s * 1.24, 2.2, 0, hi ? 14 : 8);
      h.box('camo', s * 1.13, s * 1.35, 1.8, 2.2, -0.2, 0.2);
      h.rod('chrome', [s * 0.7, 0.48, -1.2], [s * 0.7, 1.2, 0.02], 0.05, 8);
      h.rod('camo', [s * 0.7, 0.48, -1.2], [s * 0.7, 0.8, -0.65], 0.09, 8);
    });
    h.box('camo', -0.95, 0.95, 0.48, 1.75, -2.0, -1.0);                                              // transmitter cabin
    h.box('camo', -1.0, 1.0, 1.75, 1.82, -2.05, -0.95);
    louvresZ(h, -1, -2.0, -0.8, 0.8, 0.6, 1.6, 5);
    [-1, 1].forEach(s => louvres(h, s, s * 0.95, 0.9, 1.6, -1.8, -1.2, 3));
    [-1, 1].forEach(s => { h.box('olive', s * 0.98, s * 1.06, 1.0, 1.6, -0.95, -0.35); h.box('alu', s * 1.06, s * 1.08, 1.1, 1.5, -0.85, -0.45); });   // sidelobe canceller horns
    // panel: octagonal lens face 4 x 4 m, centre y +0.3; face at z 0.6
    const p = new Kit(lod), CY = 0.3, HW = 2.0, CH = 0.6;
    p.add(extrude(octShape(HW + 0.12, HW + 0.12, CH + 0.05, CY), 0.1, 0.5), 'camo');
    const ring = octShape(HW + 0.14, HW + 0.14, CH + 0.06, CY); ring.holes.push(octShape(HW - 0.02, HW - 0.02, CH - 0.01, CY));
    p.add(extrude(ring, 0.6, 0.14), 'camo');
    const face = new THREE.ShapeGeometry(octShape(HW, HW, CH, CY)), fuv = face.attributes.uv, fp = face.attributes.position;
    for (let i = 0; i < fp.count; i++) fuv.setXY(i, (fp.getX(i) + HW) / (2 * HW), (fp.getY(i) - CY + HW) / (2 * HW));
    face.translate(0, 0, 0.62); p.add(face, 'pesa');
    [-0.7, 0.7].forEach(v => { p.box('steel', -HW, HW, CY + v - 0.02, CY + v + 0.02, 0.62, 0.66); p.box('steel', v - 0.02, v + 0.02, CY - HW, CY + HW, 0.62, 0.66); });
    // feed boom + horn
    const hornP = [0, CY - 1.55, 3.25], hornD = new V3(0, CY - hornP[1], 0.64 - hornP[2]).normalize();
    [[-1.3, CY - HW + 0.1], [1.3, CY - HW + 0.1]].forEach(([x, y]) => {
      p.rod('steel', [x, y, 0.62], [0, hornP[1] - 0.12, hornP[2] - 0.15], 0.06, 8);
      p.box('steel', x - 0.12, x + 0.12, y - 0.12, y + 0.08, 0.5, 0.75);
    });
    p.rod('steel', [0, CY - HW - 0.02, 0.5], [0, hornP[1] - 0.2, hornP[2] - 0.3], 0.07, 8);
    p.rod('steel', [-0.72, CY - HW + 0.18, 1.6], [0.72, CY - HW + 0.18, 1.6], 0.035, 6);
    p.rod('dsteel', [0.12, CY - HW - 0.05, 0.5], [0.12, hornP[1] - 0.18, hornP[2] - 0.25], 0.045, 6);     // waveguide
    {
      const hg = new THREE.CylinderGeometry(0.1, 0.42, 0.75, 4, 1, true); hg.rotateY(PI / 4);
      const hm = new M4().compose(new V3(...hornP), new THREE.Quaternion().setFromUnitVectors(_Y, hornD.clone().negate()), _one);
      p.add(hg.clone(), 'camo', hm); p.add(flipped(hg), 'black', hm);
      const bg = new THREE.BoxGeometry(0.28, 0.35, 0.28); bg.translate(0, 0.5, 0); p.add(bg, 'camo', hm);
    }
    // back structure
    [-1.5, -0.5, 0.5, 1.5].forEach(x => p.box('steel', x - 0.05, x + 0.05, CY - HW + 0.4, CY + HW - 0.4, -0.2, 0.1));
    [CY - 1.2, CY, CY + 1.2].forEach(y => p.box('steel', -1.8, 1.8, y - 0.05, y + 0.05, -0.2, 0.1));
    p.box('camo', -0.9, 0.9, -0.8, 1.0, -0.62, -0.2);
    louvresZ(p, -1, -0.62, -0.7, 0.7, -0.6, 0.8, 5);
    [-1, 1].forEach(s => { p.cylX('steel', 0.17, 0.26, s * 1.24, 0, 0, hi ? 12 : 8); p.box('steel', s * 1.12, s * 1.36, -0.18, 0.25, -0.2, 0.12); });
    p.box('camo', -1.3, 1.3, CY + HW + 0.1, CY + HW + 0.42, 0.2, 0.5);                                   // IFF strip
    p.box('olive', -1.22, 1.22, CY + HW + 0.14, CY + HW + 0.38, 0.5, 0.53);
    if (hi) for (let i = 0; i < 9; i++) { const x = -1.08 + i * 0.27; p.box('alu', x - 0.045, x + 0.045, CY + HW + 0.19, CY + HW + 0.33, 0.53, 0.56); }
    return {
      name: 'fire-control radar', height: 22.0, body: k,
      nodes: [{ name: 'head', parent: 'root', pos: [0, MY, MZ], kit: h }, { name: 'panel', parent: 'head', pos: [0, 2.2, 0], rot: [-0.28, 0, 0], kit: p }]
    };
  };

  /* ---------------- radar_lowalt: semitrailer + 24 m lattice tower, wide back-to-back array */
  DEF.radar_lowalt = function (lod) {
    const k = new Kit(lod), hi = k.hi, TZ = -4.6, TOP = 24.2, B0 = 0.7, WB = 1.6, WT = 0.7, ws = hi ? 16 : 10;
    // semitrailer (tractor unhitched, standing on its landing legs)
    k.box('camo', -1.25, 1.25, 1.2, 1.5, -2.0, 6.3);                                                     // deck
    [-1, 1].forEach(s => k.box('dsteel', s * 0.55 - 0.1, s * 0.55 + 0.1, 0.85, 1.2, -2.0, 8.4));
    k.box('camo', -1.2, 1.2, 1.5, 2.0, 6.3, 8.6);                                                         // gooseneck
    k.box('steel', -0.12, 0.12, 1.3, 1.5, 7.9, 8.1);
    [-1, 1].forEach(s => {
      k.box('steel', s * 0.75, s * 0.95, 0.35, 1.5, 6.9, 7.15); k.box('chrome', s * 0.8, s * 0.9, 0.08, 0.4, 6.97, 7.08);
      k.box('steel', s * 0.62, s * 1.08, 0, 0.08, 6.8, 7.25); k.box('sand', s * 0.55, s * 1.15, -0.01, 0.0, 6.7, 7.35);
      [-1.2, 0.05, 1.3].forEach(z => wheel(k, s * 1.05, 0.52, z, 0.52, 0.46, ws));
      k.box('camo', s * 0.8, s * 1.32, 1.12, 1.2, -1.95, 2.0);
      k.box('camo', s * 0.7, s * 1.22, 0.6, 1.2, 2.5, 4.2);                                               // lockers
      k.box('black', s * 1.22, s * 1.235, 0.7, 1.1, 2.6, 3.3); k.box('black', s * 1.22, s * 1.235, 0.7, 1.1, 3.4, 4.1);
      k.lamp('tail', s * 1.0, 1.3, -2.02, 0.08, true);
      k.lamp('amber', s * 1.25, 1.35, 6.2, 0.05);
    });
    [-1.2, 0.05, 1.3].forEach(z => k.cylX('dsteel', 0.07, 1.8, 0, 0.52, z, 8));
    k.box('black', -1.25, 1.25, 0.8, 1.0, -2.15, -2.0);
    jack(k, 1, -1.7, 1.0); jack(k, -1, -1.7, 1.0); jack(k, 1, 5.9, 1.0); jack(k, -1, 5.9, 1.0);
    // equipment cabin on the deck
    shelter(k, -1.25, 1.25, 1.5, 3.9, 1.8, 6.2);
    [-1, 1].forEach(s => louvres(k, s, s * 1.25, 3.0, 3.6, 5.2, 6.0, 4));
    k.box('black', 1.25, 1.265, 1.55, 3.5, 2.3, 3.3); k.box('camo', 1.25, 1.27, 1.6, 3.45, 2.35, 3.25); k.box('steel', 1.27, 1.31, 2.4, 2.5, 2.4, 2.5);
    louvresZ(k, -1, 1.8, -0.9, 0.9, 2.6, 3.6, 5);
    k.box('camo', -1.0, 1.0, 3.96, 4.4, 4.2, 5.8);                                                        // A/C
    if (hi) [-0.5, 0.5].forEach(x => k.cylY('black', 0.28, 0.02, x, 4.4, 5.0, 14));
    // erector rams from the trailer rear to the tower
    [-1, 1].forEach(s => {
      k.box('steel', s * 0.7, s * 1.05, 1.2, 1.7, -2.3, -1.9);
      k.beam('steel', [s * 0.88, 1.5, -2.1], [s * 0.9, 6.0, TZ + 1.36], 0.16);
      k.beam('chrome', [s * 0.88, 3.4, -2.6], [s * 0.9, 6.0, TZ + 1.36], 0.09);
    });
    // tower base: pedestal + four diagonal outrigger arms with jacks
    k.box('camo', -1.9, 1.9, 0.1, 0.7, TZ - 1.9, TZ + 1.9);
    k.box('steel', -1.8, 1.8, 0.0, 0.1, TZ - 1.8, TZ + 1.8);
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => {
      const fx = sx * 3.9, fz = TZ + sz * 3.9;
      k.beam('camo', [sx * 1.6, 0.45, TZ + sz * 1.6], [fx, 0.7, fz], 0.26, 0.3);
      jackLeg(k, fx, fz, 1.1);
      k.box('steel', sx * 1.6 - 0.2, sx * 1.6 + 0.2, 0.7, 0.95, TZ + sz * 1.6 - 0.2, TZ + sz * 1.6 + 0.2);    // leg shoes
    });
    // lattice tower
    const hw = y => WB + (WT - WB) * (y - B0) / (TOP - B0), NS = hi ? 10 : 7, legs = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    legs.forEach(([sx, sz]) => k.beam('steel', [sx * WB, B0, TZ + sz * WB], [sx * WT, TOP, TZ + sz * WT], 0.16));
    for (let i = 0; i < NS; i++) {
      const ya = B0 + (TOP - B0) * i / NS, yb = B0 + (TOP - B0) * (i + 1) / NS, wa = hw(ya), wb = hw(yb);
      for (let f = 0; f < 4; f++) {
        const A = legs[f], Bq = legs[(f + 1) % 4];
        const pa0 = [A[0] * wa, ya, TZ + A[1] * wa], pa1 = [Bq[0] * wa, ya, TZ + Bq[1] * wa], pb0 = [A[0] * wb, yb, TZ + A[1] * wb], pb1 = [Bq[0] * wb, yb, TZ + Bq[1] * wb];
        k.beam('steel', pa0, pb1, 0.07); k.beam('steel', pa1, pb0, 0.07);
        if (i > 0) k.beam('steel', pa0, pa1, 0.08);
      }
    }
    // ladder on the rear face, rest platform, top platform with railing
    const lz = y => TZ - hw(y) - 0.3;
    ladder(k, 'yellow', [0, B0, lz(B0)], [0, TOP + 0.1, lz(TOP)], [1, 0], 0.45, 0.35);
    for (let y = B0 + 2.5; hi && y < TOP; y += 2.5) k.beam('yellow', [0, y, lz(y) + 0.02], [0, y, TZ - hw(y)], 0.04);
    const ym = B0 + (TOP - B0) * 0.5, wm = hw(ym);
    k.box('grate', -wm, wm, ym - 0.06, ym, TZ - wm, TZ + wm);
    k.box('grate', -1.55, 1.55, TOP, TOP + 0.1, TZ - 1.55, TZ + 1.55);
    k.box('steel', -1.6, 1.6, TOP - 0.12, TOP, TZ - 1.6, TZ + 1.6);
    railing(k, 'yellow', -1.5, 1.5, TZ - 1.5, TZ + 1.5, TOP + 0.1, 1.05, true);
    k.cylY('camo', 0.5, 0.55, 0, TOP + 0.1, TZ, hi ? 18 : 10);                                              // head pedestal
    k.cylY('steel', 0.6, 0.2, 0, TOP + 0.65, TZ, hi ? 20 : 10);
    k.beam('steel', [1.45, TOP + 0.1, TZ + 1.45], [1.45, TOP + 1.7, TZ + 1.45], 0.06);                      // beacon post
    k.rod('cable', [0.3, 1.0, TZ - 1.2], [0.3, TOP, TZ - 0.4], 0.05, 5);
    k.rod('cable', [0.3, 1.0, TZ - 1.2], [0.9, 1.52, -1.2], 0.05, 5);
    // head: turntable, central post, drive boxes
    const h = new Kit(lod);
    turntable(h, 0.75, 0.3);
    h.box('camo', -0.95, 0.95, 0.3, 0.46, -1.1, 0.9);
    h.box('camo', -0.32, 0.32, 0.46, 1.1, -0.34, 0.34);
    [-1, 1].forEach(s => {
      h.box('camo', s * 0.36, s * 0.9, 0.46, 1.0, -1.05, -0.2); h.box('black', s * 0.9, s * 0.915, 0.55, 0.9, -0.95, -0.3);
      h.box('camo', s * 0.36, s * 0.6, 0.46, 1.1, -0.2, 0.3);
      h.cylX('steel', 0.14, 0.12, s * 0.42, 1.3, 0, 12);
    });
    h.box('camo', -0.4, 0.4, 0.46, 0.9, 0.34, 0.8);
    // panel: 6.6 x 1.5 m two-faced array, hinge at origin, centre y +0.1
    const p = new Kit(lod), PW = 3.3, PH = 0.75, CY = 0.1;
    p.box('camo', -PW, PW, CY - PH, CY + PH, -0.26, 0.26);
    [1, -1].forEach(f => {
      for (let i = 0; i < 6; i++) {
        const x0 = -PW + 0.06 + i * (2 * PW - 0.12) / 6, g = new THREE.BoxGeometry((2 * PW - 0.12) / 6 - 0.03, 2 * PH - 0.12, 0.04);
        g.translate(x0 + (2 * PW - 0.12) / 12, CY, f * 0.28); p.add(g, 'slot');
      }
      p.box('camo', -PW - 0.04, PW + 0.04, CY + PH - 0.04, CY + PH + 0.06, f > 0 ? 0.2 : -0.34, f > 0 ? 0.34 : -0.2);
      p.box('camo', -PW - 0.04, PW + 0.04, CY - PH - 0.06, CY - PH + 0.04, f > 0 ? 0.2 : -0.34, f > 0 ? 0.34 : -0.2);
    });
    [-1, 1].forEach(s => {
      p.box('camo', s * PW, s * (PW + 0.1), CY - PH - 0.06, CY + PH + 0.06, -0.34, 0.34);                   // end caps
      p.cylX('steel', 0.12, 0.1, s * 0.3, 0, 0, 12);
    });
    p.box('camo', -0.3, 0.3, -0.5, 0.35, -0.36, 0.36);                                                       // hub
    p.box('camo', -2.4, 2.4, CY + PH + 0.06, CY + PH + 0.32, -0.12, 0.12);                                   // IFF strip
    if (hi) for (let i = 0; i < 14; i++) { const x = -2.21 + i * 0.34; p.box('alu', x - 0.05, x + 0.05, CY + PH + 0.1, CY + PH + 0.28, 0.12, 0.15); p.box('alu', x - 0.05, x + 0.05, CY + PH + 0.1, CY + PH + 0.28, -0.15, -0.12); }
    return {
      name: 'low-altitude radar', height: 27.5, body: k,
      nodes: [{ name: 'head', parent: 'root', pos: [0, TOP + 0.85, TZ], kit: h }, { name: 'panel', parent: 'head', pos: [0, 1.3, 0], rot: [-0.06, 0, 0], kit: p }],
      anchors: { beacon: [1.45, TOP + 1.78, TZ + 1.45] }
    };
  };

  /* ---------------- gun_harrow: emplaced twin autocannon */
  DEF.gun_harrow = function (lod) {
    const k = new Kit(lod), hi = k.hi, ws = hi ? 18 : 10, TY = 1.2;
    // carriage hull
    k.box('camo', -1.05, 1.05, 0.5, 1.0, -1.9, 1.9);
    k.rbox('camo', 2.1, 0.5, 0.4, 0, 0.62, 2.0, 0.65, 0, 0); k.rbox('camo', 2.1, 0.5, 0.4, 0, 0.62, -2.0, -0.65, 0, 0);
    k.box('steel', -1.08, 1.08, 0.98, 1.02, -1.9, 1.9);
    [-1, 1].forEach(s => {
      k.box('camo', s * 1.05, s * 1.28, 0.55, 0.95, 0.35, 1.8);                                              // side lockers
      k.box('black', s * 1.28, s * 1.29, 0.62, 0.9, 0.45, 1.05); k.box('black', s * 1.28, s * 1.29, 0.62, 0.9, 1.15, 1.7);
      k.box('steel', s * 1.28, s * 1.31, 0.74, 0.8, 0.95, 1.02);
      k.cylZ('canvas', 0.14, 1.1, s * 1.18, 0.7, -1.75, 10);                                                 // stowed tarp roll
      // lifted transport wheels
      [-1.0].forEach(z => {
        wheel(k, s * 1.5, 0.66, z, 0.52, 0.34, ws);
        k.cylX('dsteel', 0.07, 0.35, s * 1.22, 0.66, z, 8);
        k.box('camo', s * 1.28, s * 1.72, 1.2, 1.26, z - 0.62, z + 0.62);
        k.rbox('camo', 0.44, 0.06, 0.35, s * 1.5, 1.08, z + 0.72, 0.8, 0, 0); k.rbox('camo', 0.44, 0.06, 0.35, s * 1.5, 1.08, z - 0.72, -0.8, 0, 0);
      });
      // diagonal outrigger arms with jacks at the four corners of a ~5.8 m square
      [-1, 1].forEach(sz => {
        const fx = s * 2.85, fz = sz * 2.85;
        k.beam('camo', [s * 0.8, 0.72, sz * 1.7], [fx, 0.72, fz], 0.22, 0.24);
        k.beam('steel', [s * 0.8, 0.86, sz * 1.7], [fx - s * 0.2, 0.86, fz - sz * 0.2], 0.08, 0.04);
        k.box('steel', s * 0.6, s * 1.08, 0.55, 0.9, sz * 1.5, sz * 1.9);
        jackLeg(k, fx, fz, 1.15);
      });
      k.lamp('dred', s * 0.8, 0.8, -2.25, 0.06, true);
      k.box('steel', s * 0.5 - 0.06, s * 0.5 + 0.06, 0.4, 0.55, 2.1, 2.25);                                  // tie-down eyes
    });
    [-1, 1].forEach(s => { k.cylZ('cable', 0.035, 2.6, s * 1.075, 0.92, -1.4, 6); k.cylZ('cable', 0.035, 2.6, s * 1.075, 0.84, -1.4, 6); });   // tow cables
    // drawbar folded up at the front
    k.rod('steel', [-0.55, 0.62, 2.1], [0, 1.02, 2.75], 0.06, 8); k.rod('steel', [0.55, 0.62, 2.1], [0, 1.02, 2.75], 0.06, 8);
    k.add(new THREE.TorusGeometry(0.12, 0.035, 6, hi ? 14 : 8).rotateY(PI / 2).translate(0, 1.08, 2.85), 'steel');
    // APU pack on the rear face
    k.box('camo', -0.85, 0.85, 0.45, 1.12, -2.55, -2.05);
    louvresZ(k, -1, -2.55, -0.7, 0.2, 0.55, 1.0, 5);
    k.cylY('black', 0.05, 0.4, 0.55, 1.12, -2.3, 8);
    k.box('dred', 0.35, 0.7, 0.6, 0.9, -2.56, -2.555);
    k.rod('cable', [0.6, 0.55, -2.55], [0.9, 0.02, -3.4], 0.03, 5); k.rod('cable', [0.9, 0.02, -3.4], [2.2, 0.02, -4.4], 0.03, 5);
    [-0.35, 0.05].forEach(x => { k.box('olive', x - 0.17, x + 0.17, 0.15, 0.62, -2.35, -2.12); k.box('olive', x - 0.05, x + 0.05, 0.62, 0.66, -2.3, -2.16); });   // jerrycans
    // turret ring
    k.cylY('camo', 1.35, 0.1, 0, 1.0, 0, hi ? 32 : 16);
    k.cylY('steel', 1.26, 0.1, 0, 1.1, 0, hi ? 32 : 16);

    // ---- turret (yaw), origin on the ring
    const t = new Kit(lod);
    t.cylY('camo', 1.2, 0.15, 0, 0, 0, hi ? 28 : 14);
    t.box('camo', -1.1, 1.1, 0.15, 1.0, -1.35, 0.95);
    t.beam('camo', [0, 0.2, 1.42], [0, 0.98, 0.97], 2.2, 0.1);                                                 // glacis
    t.box('camo', -1.08, 1.08, 0.15, 0.6, 0.9, 1.35);
    t.box('camo', -0.95, 0.95, 0.25, 0.95, -1.95, -1.3);                                                     // bustle
    louvresZ(t, -1, -1.95, -0.8, 0.8, 0.35, 0.85, 5);
    t.box('camo', -0.9, 0.9, 1.0, 1.1, -1.9, 0.95);                                                          // roof
    [-1, 1].forEach(s => {
      t.rbox('camo', 0.3, 0.06, 2.9, s * 1.0, 1.02, -0.45, 0, 0, -s * 0.72);                                  // roof chamfers
      t.cylX('steel', 0.24, 0.2, s * 1.18, 0.85, 0.35, hi ? 16 : 10);                                         // trunnion bearings
      t.box('steel', s * 1.1, s * 1.16, 0.45, 1.25, 0.0, 0.7);
      for (let i = 0; i < 3; i++) {                                                                            // smoke dischargers
        const g = new THREE.CylinderGeometry(0.055, 0.055, 0.32, 8); g.applyMatrix4(R(0.9, 0, -s * 0.5)); g.translate(s * 0.85 - s * i * 0.14, 1.12, 0.72 - i * 0.03); t.add(g, 'dsteel');
      }
      t.rod('steel', [s * 0.8, 1.1, -1.6], [s * 0.8, 1.1, -0.2], 0.022, 5);                                   // handrails
      t.rod('steel', [s * 0.8, 1.1, -1.6], [s * 0.8, 1.25, -1.6], 0.022, 5); t.rod('steel', [s * 0.8, 1.1, -0.2], [s * 0.8, 1.25, -0.2], 0.022, 5);
      t.rod('steel', [s * 0.8, 1.25, -1.6], [s * 0.8, 1.25, -0.2], 0.022, 5);
      t.box('black', s * 0.95, s * 0.955, 0.3, 0.8, -1.8, -1.45);
    });
    t.cylY('camo', 0.36, 0.1, -0.42, 1.1, -0.5, hi ? 16 : 10);                                                // commander hatch
    t.box('steel', -0.46, -0.38, 1.1, 1.24, -0.9, -0.84);
    [[-0.85, -0.3], [-0.42, -0.02], [0.02, -0.3]].forEach(([x, z]) => { t.box('black', x - 0.07, x + 0.07, 1.1, 1.22, z - 0.05, z + 0.05); t.box('lens', x - 0.06, x + 0.06, 1.14, 1.2, z + 0.05, z + 0.055); });
    t.box('camo', 0.2, 0.62, 1.1, 1.38, 0.35, 0.8);                                                           // gunner's sight head
    t.box('lens', 0.26, 0.56, 1.16, 1.32, 0.8, 0.81);
    t.box('black', 0.18, 0.64, 1.38, 1.41, 0.3, 0.95);
    t.box('camo', -0.3, 0.3, 1.1, 1.3, -1.55, -0.65);                                                         // radar mast base
    t.cylY('camo', 0.13, 0.62, 0, 1.28, -1.1, hi ? 12 : 8);
    t.rod('black', [-0.7, 1.1, -1.8], [-0.7, 3.2, -1.85], 0.012, 4);                                          // whip
    t.box('black', -0.26, 0.26, 0.88, 1.02, 1.0, 1.02);                                                        // mantlet slot
    [-1, 1].forEach(s => {
      t.box('camo', s * 1.1, s * 1.25, 0.2, 0.62, -1.3, -0.35);                                                // side stowage bins
      t.box('dsteel', s * 1.25, s * 1.27, 0.22, 0.6, -0.84, -0.8);
      t.box('steel', s * 1.25, s * 1.28, 0.5, 0.54, -1.2, -1.1); t.box('steel', s * 1.25, s * 1.28, 0.5, 0.54, -0.55, -0.45);
      t.box('camo', s * 0.98, s * 1.1, 0.95, 1.12, -1.35, -1.25);                                              // lifting eyes
      if (hi) for (let i = 0; i < 5; i++) { const x = s * (0.18 + i * 0.2); t.box('dsteel', x - 0.025, x + 0.025, 0.28, 0.33, 1.36, 1.42); }   // glacis bolts
    });
    if (hi) for (let i = 0; i < 9; i++) { const x = -0.96 + i * 0.24; t.box('dsteel', x - 0.02, x + 0.02, 0.9, 0.94, 1.0, 1.06); }

    // ---- elevator (rotation.x = -elev), origin on the trunnion axis; guns along +Z
    const e = new Kit(lod), BX = 1.52, MZ = 3.75;
    e.cylX('steel', 0.1, 3.0, 0, 0, 0, hi ? 12 : 8);
    [-1, 1].forEach(s => {
      const x = s * BX;
      e.box('camo', s * 1.3, s * 1.74, -0.26, 0.26, -0.85, 0.72);                                            // cradle
      e.rbox('camo', 0.36, 0.4, 0.3, x, 0, 0.82, 0, 0, 0);
      e.box('dsteel', s * 1.33, s * 1.71, 0.26, 0.3, -0.8, 0.6);
      e.cylZ('steel', 0.085, 0.85, x, 0, 0.9, hi ? 14 : 8);                                                   // cooling jacket
      e.cylZ('dsteel', 0.096, 0.06, x, 0, 0.95, hi ? 14 : 8); e.cylZ('dsteel', 0.096, 0.06, x, 0, 1.68, hi ? 14 : 8);
      e.cylZ('dsteel', 0.046, 1.72, x, 0, 1.75, hi ? 12 : 8);                                                 // barrel
      e.cylZ('dsteel', 0.058, 0.08, x, 0, 2.6, hi ? 12 : 8);
      e.cylZ('dsteel', 0.064, 0.3, x, 0, MZ - 0.3, hi ? 12 : 8);                                              // muzzle brake
      [0.04, 0.13, 0.22].forEach(d => e.cylZ('steel', 0.078, 0.035, x, 0, MZ - 0.3 + d, hi ? 12 : 8));
      if (hi) [-1, 1].forEach(sy => e.box('black', x - 0.02, x + 0.02, sy * 0.05 - 0.02, sy * 0.05 + 0.02, MZ - 0.26, MZ - 0.05));
      e.cylZ('black', 0.03, 0.02, x, 0, MZ - 0.005, 8);
      // ammunition feed box + chute
      e.box('camo', s * 1.74, s * 2.02, -0.42, 0.18, -0.6, 0.45);
      e.box('steel', s * 1.72, s * 2.04, 0.18, 0.22, -0.62, 0.47);
      e.box('steel', s * 2.02, s * 2.04, -0.1, 0.0, -0.3, -0.1);
      for (let i = 0; i < 3; i++) e.rbox('black', 0.1, 0.12, 0.3, s * (1.72 - i * 0.05), 0.2 + i * 0.03, -0.1, 0, 0, -s * 0.4);
      e.box('black', s * 1.42, s * 1.62, -0.42, -0.26, -0.25, 0.2);                                          // case ejection chute
    });
    // EO block on the right cradle
    e.box('camo', 1.3, 1.76, 0.3, 0.64, -0.4, 0.42);
    e.box('black', 1.28, 1.78, 0.64, 0.67, -0.42, 0.55);
    e.box('lens', 1.36, 1.5, 0.38, 0.56, 0.42, 0.43); e.box('lens', 1.56, 1.7, 0.42, 0.56, 0.42, 0.43);
    e.cylZ('lens', 0.05, 0.02, 1.63, 0.36, 0.42, 10);
    // tracking radar mount on the left cradle
    e.box('camo', -1.66, -1.38, 0.3, 0.46, -0.4, 0.2);
    e.box('steel', -1.56, -1.48, 0.46, 0.72, -0.2, 0.1);

    // ---- tracking radar (child of elevator): small dish, feed tripod
    const tr = new Kit(lod), DR = 0.72, DT = 0.6;
    {
      const dg = new THREE.SphereGeometry(DR, hi ? 20 : 12, hi ? 5 : 3, 0, 2 * PI, 0, DT); dg.rotateX(-PI / 2); dg.translate(0, 0, DR);
      tr.add(dg.clone(), 'dsteel'); tr.add(flipped(dg), 'alu');
      const ar = DR * Math.sin(DT), ad = DR * (1 - Math.cos(DT));
      tr.add(new THREE.TorusGeometry(ar, 0.022, 5, hi ? 20 : 12).translate(0, 0, ad), 'steel');
      for (let i = 0; i < 3; i++) { const a = PI / 2 + i * 2 * PI / 3; tr.rod('steel', [Math.cos(a) * ar * 0.95, Math.sin(a) * ar * 0.95, ad], [0, 0, 0.42], 0.012, 4); }
      tr.cylZ('dsteel', 0.04, 0.12, 0, 0, 0.38, 8);
      tr.box('grate', -0.16, 0.16, -0.16, 0.16, -0.3, 0.0);
      tr.box('dsteel', -0.1, 0.1, -0.3, -0.16, -0.25, -0.05);
    }

    // ---- search radar (spins), small flat panel on the mast
    const sr = new Kit(lod);
    sr.cylY('gsteel', 0.18, 0.14, 0, 0, 0, hi ? 14 : 8);
    sr.box('paint', -0.12, 0.12, 0.14, 0.4, -0.12, 0.12);
    {
      const pm = R(-0.2, 0, 0).premultiply(new M4().makeTranslation(0, 0.48, 0.02));
      const add = (key, x0, x1, y0, y1, z0, z1) => { const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0); g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); sr.add(g, key, pm); };
      add('paint', -0.86, 0.86, -0.34, 0.34, -0.12, 0.06);
      add('paint', -0.9, 0.9, -0.36, 0.36, 0.06, 0.1);
      for (let i = 0; i < 4; i++) { const g = new THREE.BoxGeometry(0.4, 0.62, 0.03); g.translate(-0.63 + i * 0.42, 0, 0.1); sr.add(g, 'aesa', pm); }
      add('gsteel', -0.7, 0.7, -0.24, 0.22, -0.22, -0.12);
      add('paint', -0.9, 0.9, 0.36, 0.44, -0.08, 0.06);
    }
    const rails = [-1, 1].map(s => [s * BX, 0, MZ]);
    return {
      name: 'Harrow gun', height: 4.4, body: k,
      nodes: [
        { name: 'turret', parent: 'root', pos: [0, TY, 0], kit: t },
        { name: 'elevator', parent: 'turret', pos: [0, 0.85, 0.35], kit: e },
        { name: 'trackRadar', parent: 'elevator', pos: [-BX, 0.95, 0.12], kit: tr },
        { name: 'searchRadar', parent: 'turret', pos: [0, 1.9, -1.1], kit: sr }
      ],
      anchors: { rails }
    };
  };

  /* ---------------- command_post: 8x8 truck, equipment shelter, antenna mast, camo net */
  DEF.command_post = function (lod) {
    const k = new Kit(lod), hi = k.hi;
    truck(k, { zf: 6.0, zr: -5.3, axles: [4.45, 3.0, -2.45, -3.9] });
    jack(k, 1, -4.9, 1.0); jack(k, -1, -4.9, 1.0);
    k.box('camo', -1.25, 1.25, 1.2, 1.5, -5.3, 3.8);
    shelter(k, -1.27, 1.27, 1.5, 4.3, -5.2, 3.75);
    // front: air-con units over the cab
    [-0.62, 0.62].forEach(x => {
      k.box('camo', x - 0.55, x + 0.55, 3.2, 4.2, 3.75, 4.2); k.box('black', x - 0.45, x + 0.45, 3.3, 4.05, 4.2, 4.21);
      if (hi) for (let i = 0; i < 5; i++) k.box('steel', x - 0.45, x + 0.45, 3.37 + i * 0.14, 3.4 + i * 0.14, 4.21, 4.23);
    });
    // left side (-X): windows, vents; right side (+X): door (net side)
    [-2.6, -0.6, 1.4].forEach(z => { k.box('glass', -1.29, -1.27, 3.0, 3.6, z - 0.35, z + 0.35); k.box('dsteel', -1.3, -1.27, 3.62, 3.68, z - 0.42, z + 0.42); });
    louvres(k, -1, -1.27, 2.0, 2.6, -4.6, -3.6, 4);
    k.box('black', -1.285, -1.27, 1.8, 2.5, 2.4, 3.2);
    k.box('black', 1.27, 1.285, 1.55, 3.85, 0.4, 1.4); k.box('camo', 1.27, 1.29, 1.6, 3.8, 0.45, 1.35); k.box('steel', 1.29, 1.33, 2.6, 2.7, 1.2, 1.3);
    for (let i = 0; i < 3; i++) k.box('steel', 1.3, 1.65, 0.55 + i * 0.32, 0.6 + i * 0.32, 0.45, 1.35);
    k.beam('steel', [1.65, 0.5, 0.45], [1.3, 1.5, 0.45], 0.04); k.beam('steel', [1.65, 0.5, 1.35], [1.3, 1.5, 1.35], 0.04);
    louvres(k, 1, 1.27, 3.3, 3.9, -2.2, -1.2, 4);
    // rear: door + ladder to roof
    k.box('black', -0.6, 0.6, 1.55, 3.85, -5.215, -5.2); k.box('camo', -0.55, 0.55, 1.6, 3.8, -5.23, -5.21);
    k.box('steel', 0.4, 0.48, 2.6, 2.7, -5.26, -5.23);
    ladder(k, 'steel', [0.95, 0.4, -5.35], [0.95, 4.6, -5.35], [1, 0], 0.42, 0.3);
    k.cylY('red', 0.08, 0.1, 0.9, 1.3, -5.24, 8);
    // roof: stowage rack, cable reels, antenna mast, whips
    k.box('steel', -1.1, 0.3, 4.36, 4.42, -1.0, 2.8);
    [[-1.1, -1.0], [0.3, -1.0], [-1.1, 2.8], [0.3, 2.8]].forEach(([x, z]) => k.box('steel', x - 0.03, x + 0.03, 4.36, 4.62, z - 0.03, z + 0.03));
    k.beam('steel', [-1.1, 4.6, -1.0], [-1.1, 4.6, 2.8], 0.04); k.beam('steel', [0.3, 4.6, -1.0], [0.3, 4.6, 2.8], 0.04);
    k.box('canvas', -1.0, 0.2, 4.42, 4.72, -0.6, 1.4);
    k.cylX('steel', 0.3, 0.05, 0.62, 4.68, 2.3, hi ? 14 : 8); k.cylX('steel', 0.3, 0.05, 1.12, 4.68, 2.3, hi ? 14 : 8); k.cylX('cable', 0.24, 0.46, 0.87, 4.68, 2.3, hi ? 14 : 8);
    k.box('steel', 0.6, 1.14, 4.36, 4.42, 2.1, 2.5);
    const AX = -0.8, AZ = -4.5, AT = 13.5;
    k.box('camo', AX - 0.3, AX + 0.3, 4.36, 4.9, AZ - 0.3, AZ + 0.3);
    k.cylY('steel', 0.13, 3.5, AX, 4.9, AZ, 10); k.cylY('chrome', 0.1, 3.0, AX, 8.4, AZ, 10); k.cylY('chrome', 0.075, 2.1, AX, 11.4, AZ, 10);
    k.cylY('steel', 0.16, 0.1, AX, 8.35, AZ, 10); k.cylY('steel', 0.13, 0.1, AX, 11.35, AZ, 10);
    k.box('steel', AX - 0.9, AX + 0.9, AT - 0.04, AT + 0.04, AZ - 0.04, AZ + 0.04);                           // top crossbar
    k.box('steel', AX - 0.04, AX + 0.04, AT - 0.04, AT + 0.04, AZ - 0.9, AZ + 0.9);
    [-0.85, 0.85].forEach(d => { k.rod('alu', [AX + d, AT, AZ], [AX + d, AT + 1.2, AZ], 0.018, 4); k.rod('alu', [AX, AT, AZ + d], [AX, AT - 1.0, AZ + d], 0.018, 4); });
    k.rod('alu', [AX, AT, AZ], [AX, AT + 1.6, AZ], 0.02, 4);
    // log-periodic antenna
    k.beam('alu', [AX, AT - 1.0, AZ - 0.1], [AX + 1.3, AT - 1.0, AZ - 0.1], 0.04);
    if (hi) for (let i = 0; i < 7; i++) { const x = AX + 0.15 + i * 0.17, l = 0.7 - i * 0.08; k.beam('alu', [x, AT - 1.0, AZ - 0.1 - l], [x, AT - 1.0, AZ - 0.1 + l], 0.015); }
    // small dish
    {
      const dg = new THREE.SphereGeometry(0.45, hi ? 16 : 10, 3, 0, 2 * PI, 0, 0.6); dg.rotateX(-PI / 2); dg.translate(0, 0, 0.45);
      const dm = new M4().makeRotationY(0.6).premultiply(new M4().makeTranslation(AX - 0.15, AT - 2.2, AZ + 0.2));
      k.add(dg.clone(), 'white', dm); k.add(flipped(dg), 'white', dm);
      k.box('steel', AX - 0.1, AX + 0.1, AT - 2.3, AT - 2.1, AZ - 0.1, AZ + 0.1);
    }
    // mast guys
    [[-1.27, -5.2], [1.27, -5.2], [-1.27, -1.5]].forEach(([x, z]) => k.rod('cable', [AX, 10.5, AZ], [x, 4.3, z], 0.01, 3));
    k.rod('cable', [AX, 10.5, AZ], [AX - 4.5, 0.05, AZ - 2.5], 0.01, 3);
    k.cylY('steel', 0.03, 0.3, AX - 4.5, 0, AZ - 2.5, 5);
    // whip antennas
    [[0.9, 3.2, 4.2], [-0.95, 3.5, 3.4], [0.95, -3.8, 5.0], [-1.1, 0.5, 3.8], [0.9, 0.0, 3.0]].forEach(([x, z, l]) => {
      k.cylY('dsteel', 0.06, 0.18, x, 4.3, z, 8); k.rod('black', [x, 4.48, z], [x * 1.02, 4.48 + l, z], 0.012, 4);
    });
    k.cylY('white', 0.1, 0.07, -0.2, 4.36, 3.3, 12);
    // camo net draped from the roof edge on the +X side, on poles, with guy ropes
    const NX = 4.3, NY = 2.2, z0 = -5.0, z1 = 2.6, nl = Math.hypot(NX - 1.27, 4.3 - NY), na = Math.atan2(NY - 4.3, NX - 1.27);
    k.rbox('camo', nl, 0.04, z1 - z0, (NX + 1.27) / 2, (NY + 4.3) / 2, (z0 + z1) / 2, 0, 0, na);
    if (hi) for (let i = 0; i < 4; i++) { const zz = z0 + 0.8 + i * 1.95; k.rbox('camo', nl * 0.55, 0.06, 0.5, NX - nl * 0.28 * Math.cos(na), NY - nl * 0.28 * Math.sin(na) - 0.1, zz, 0.25, 0, na); }
    k.box('camo', NX - 0.02, NX + 0.02, 1.0, NY, z0, z0 + 2.5);                                                   // side curtain
    [z0 + 0.2, (z0 + z1) / 2, z1 - 0.2].forEach(z => {
      k.cylY('sand', 0.04, NY, NX - 0.05, 0, z, 6);
      k.rod('cable', [NX - 0.05, NY, z], [NX + 1.2, 0.02, z], 0.008, 3); k.cylY('steel', 0.02, 0.2, NX + 1.2, 0, z, 4);
    });
    // folding table + cable run under the net
    if (hi) { k.box('olive', 2.3, 3.3, 0.75, 0.8, -1.6, -0.8); [[2.35, -1.55], [3.25, -1.55], [2.35, -0.85], [3.25, -0.85]].forEach(([x, z]) => k.box('steel', x - 0.02, x + 0.02, 0, 0.75, z - 0.02, z + 0.02)); }
    k.rod('cable', [-1.27, 1.7, -4.0], [-2.2, 0.02, -5.5], 0.03, 5); k.rod('cable', [-2.2, 0.02, -5.5], [-4.0, 0.02, -8.0], 0.03, 5);
    return { name: 'command post', height: 15.1, body: k, nodes: [] };
  };

  /* ---------------- generator: two-axle gen-set trailer */
  DEF.generator = function (lod) {
    const k = new Kit(lod), hi = k.hi, ws = hi ? 16 : 10, EX = [0.55, 3.78, -2.05];
    [-1, 1].forEach(s => k.box('dsteel', s * 0.55 - 0.08, s * 0.55 + 0.08, 0.72, 0.95, -2.6, 2.15));
    k.box('camo', -1.15, 1.15, 0.95, 1.05, -2.6, 2.15);
    [-0.85, 0.35].forEach(z => k.cylX('dsteel', 0.06, 1.8, 0, 0.46, z, 8));
    [-1, 1].forEach(s => {
      [-0.85, 0.35].forEach(z => wheel(k, s * 1.0, 0.46, z, 0.46, 0.34, ws));
      k.box('camo', s * 0.8, s * 1.22, 1.0, 1.05, -1.5, 1.0);
      k.rbox('camo', 0.42, 0.05, 0.3, s * 1.0, 0.88, -1.6, -0.9, 0, 0); k.rbox('camo', 0.42, 0.05, 0.3, s * 1.0, 0.88, 1.1, 0.9, 0, 0);
      [-2.45, 1.95].forEach(z => {                                                                            // stabiliser legs
        k.box('steel', s * 0.95, s * 1.15, 0.55, 0.95, z - 0.1, z + 0.1);
        k.cylY('chrome', 0.045, 0.5, s * 1.05, 0.08, z, 8); k.cylY('steel', 0.14, 0.05, s * 1.05, 0.03, z, 10);
      });
      k.lamp('tail', s * 0.95, 0.85, -2.62, 0.07, true);
      // housing sides: radiator louvres, service doors
      louvres(k, s, s * 1.08, 1.4, 2.4, -2.3, -1.3, 7);
      [[-1.15, -0.1], [-0.05, 1.05]].forEach(([a, b]) => {
        k.box('black', s * 1.08, s * 1.09, 1.2, 2.5, a, a + 0.03); k.box('black', s * 1.08, s * 1.09, 1.2, 2.5, b - 0.03, b);
        k.box('steel', s * 1.08, s * 1.11, 1.8, 1.9, b - 0.2, b - 0.12);
      });
      k.box('black', s * 1.08, s * 1.09, 2.2, 2.4, -0.9, -0.4);
    });
    k.box('camo', -1.08, 1.08, 1.05, 2.65, -2.5, 1.2);                                                          // housing
    k.box('camo', -1.14, 1.14, 2.65, 2.72, -2.56, 1.26);
    louvresZ(k, -1, -2.5, -0.9, 0.9, 1.2, 2.5, 8);                                                               // rear radiator
    [[-0.95, -2.4], [0.95, -2.4], [-0.95, 1.1], [0.95, 1.1]].forEach(([x, z]) => k.box('steel', x - 0.06, x + 0.06, 2.72, 2.84, z - 0.03, z + 0.03));
    // control panel on the front face
    k.box('black', -0.75, 0.25, 1.4, 2.4, 1.2, 1.22);
    k.box('lens', -0.65, 0.15, 1.95, 2.3, 1.22, 1.23);
    if (hi) [['green', -0.6], ['amber', -0.4], ['red', -0.2]].forEach(([c, x]) => k.cylZ(c, 0.035, 0.02, x, 1.75, 1.22, 8));
    k.box('steel', 0.4, 0.9, 1.3, 1.9, 1.2, 1.3);                                                              // output sockets
    if (hi) for (let i = 0; i < 3; i++) k.cylZ('dsteel', 0.06, 0.08, 0.5 + i * 0.15, 1.5, 1.3, 10);
    // muffler + exhaust stack with rain flap
    k.cylZ('dsteel', 0.17, 1.0, EX[0], 2.95, -1.95, hi ? 14 : 8);
    k.box('steel', EX[0] - 0.2, EX[0] + 0.2, 2.72, 2.8, -1.9, -1.1);
    k.cylY('black', 0.085, EX[1] - 2.95, EX[0], 2.95, EX[2], 10);
    k.rbox('dsteel', 0.2, 0.015, 0.2, EX[0], EX[1] + 0.02, EX[2] - 0.05, 0.45, 0, 0);
    k.cylY('steel', 0.2, 0.05, -0.5, 2.72, -1.6, 12);                                                           // fuel filler / fan cap
    // cable reels on the front deck
    [-0.55, 0.55].forEach(x => {
      k.cylX('steel', 0.4, 0.04, x - 0.24, 1.55, 1.7, hi ? 18 : 10); k.cylX('steel', 0.4, 0.04, x + 0.24, 1.55, 1.7, hi ? 18 : 10);
      k.cylX('cable', 0.3, 0.44, x, 1.55, 1.7, hi ? 18 : 10);
      k.beam('steel', [x, 1.05, 1.35], [x, 1.55, 1.7], 0.05); k.beam('steel', [x, 1.05, 2.05], [x, 1.55, 1.7], 0.05);
    });
    k.rod('cable', [0.55, 1.25, 1.95], [1.2, 0.02, 2.8], 0.03, 5); k.rod('cable', [1.2, 0.02, 2.8], [2.6, 0.02, 4.2], 0.03, 5);
    // drawbar, lunette, jockey wheel
    k.rod('steel', [-0.5, 0.82, 2.1], [0, 0.72, 3.45], 0.055, 8); k.rod('steel', [0.5, 0.82, 2.1], [0, 0.72, 3.45], 0.055, 8);
    k.add(new THREE.TorusGeometry(0.11, 0.03, 6, hi ? 14 : 8).rotateX(PI / 2).translate(0, 0.72, 3.58), 'steel');
    k.cylY('steel', 0.05, 0.62, 0.18, 0.22, 3.0, 8); k.cylX('rubber', 0.12, 0.08, 0.18, 0.12, 3.0, 12);
    k.box('camo', -0.4, 0.4, 0.4, 0.72, -2.3, -1.3);                                                          // fuel tank
    k.cylY('steel', 0.015, 0.5, -1.4, 0, -2.2, 4);                                                          // earth rod
    k.rod('cable', [-1.08, 1.3, -2.2], [-1.4, 0.3, -2.2], 0.015, 3);
    k.cylZ('red', 0.06, 0.2, -0.8, 1.35, 1.22, 10);                                                            // extinguisher
    return { name: 'generator', height: 3.8, body: k, nodes: [], anchors: { exhaust: EX } };
  };

  /* --------------------------------------------------------------- create */
  const CACHE = {};
  function built(kind, lod) {
    const key = kind + '|' + lod;
    if (CACHE[key]) return CACHE[key];
    const b = DEF[kind](lod);
    const C = { name: b.name, height: b.height, anchors: b.anchors || {}, body: b.body.meshes(), nodes: b.nodes.map(n => ({ name: n.name, parent: n.parent, pos: n.pos, rot: n.rot, meshes: n.kit.meshes() })) };
    return (CACHE[key] = C);
  }
  const noop = function () {};
  function fallback(kind) {
    const g = new THREE.Group(); g.name = kind;
    const mk = n => { const o = new THREE.Group(); o.name = n; g.add(o); return o; };
    const ud = g.userData = { kind, name: kind, height: 0, update: noop };
    if (kind === 'gun_harrow') { ud.turret = mk('turret'); ud.elevator = new THREE.Group(); ud.turret.add(ud.elevator); const r = new THREE.Object3D(); ud.elevator.add(r); ud.rails = [r]; ud.searchRadar = mk('searchRadar'); ud.trackRadar = new THREE.Group(); ud.elevator.add(ud.trackRadar); }
    else if (kind.indexOf('radar_') === 0) { ud.head = mk('head'); ud.panel = new THREE.Group(); ud.head.add(ud.panel); }
    else if (kind === 'generator') ud.exhaust = mk('exhaust');
    return g;
  }
  function create(kind, opts) {
    opts = opts || {};
    if (!DEF[kind]) return null;
    const lod = opts.lod === 'low' ? 'low' : 'high';
    try {
      const C = built(kind, lod), root = new THREE.Group(); root.name = kind;
      const inst = m => new THREE.Mesh(m.geometry, m.material);
      C.body.forEach(m => root.add(inst(m)));
      const N = { root };
      C.nodes.forEach(n => {
        const g = new THREE.Group(); g.name = n.name; g.position.fromArray(n.pos);
        if (n.rot) g.rotation.set(n.rot[0], n.rot[1], n.rot[2]);
        n.meshes.forEach(m => g.add(inst(m)));
        N[n.parent].add(g); N[n.name] = g;
      });
      const ud = { kind, name: C.name, height: C.height, lod, update: noop };
      if (N.head) { ud.head = N.head; ud.panel = N.panel; ud.panelTilt = N.panel.rotation.x; }
      if (kind === 'gun_harrow') {
        ud.turret = N.turret; ud.elevator = N.elevator; ud.searchRadar = N.searchRadar; ud.trackRadar = N.trackRadar;
        ud.rails = C.anchors.rails.map((p, i) => { const o = new THREE.Object3D(); o.name = 'rail' + i; o.position.fromArray(p); N.elevator.add(o); return o; });
      }
      if (C.anchors.exhaust) { const o = new THREE.Object3D(); o.name = 'exhaust'; o.position.fromArray(C.anchors.exhaust); root.add(o); ud.exhaust = o; }
      if (C.anchors.beacon) {
        const b = new THREE.Mesh(BEACON_GEOM || (BEACON_GEOM = new THREE.SphereGeometry(0.11, 10, 6)), mat('beacon'));
        b.name = 'beacon'; b.position.fromArray(C.anchors.beacon); root.add(b);
        let t = (C.anchors.beacon[0] * 7.3 + root.id * 0.37) % 1.5;          // de-phase instances
        ud.update = function (dt) { t += dt > 0 && dt < 1 ? dt : 0; if (t > 1.5) t -= 1.5; b.visible = t < 0.18; };
        ud.beacon = b;
      }
      root.userData = ud;
      return root;
    } catch (err) {
      console.error('models_ground.js: create(' + kind + ') failed', err);
      return fallback(kind);
    }
  }
  let BEACON_GEOM = null;

  const Ground = { version: 'ground-1.0', kinds: KINDS.slice(), create };
  window.RSGround = Ground;

  let M = (typeof Models !== 'undefined') ? Models : window.Models; // eslint-disable-line no-undef
  if (!M) M = window.Models = { version: '0', kinds: [], create: null };
  const prev = typeof M.create === 'function' ? M.create.bind(M) : null;
  M.create = function (kind, opts) {
    if (KINDS.indexOf(kind) >= 0) return create(kind, opts);
    return prev ? prev(kind, opts) : null;
  };
  const ks = new Set(M.kinds || []); KINDS.forEach(k => ks.add(k));
  M.kinds = Array.from(ks);
  M.ground = Ground;
  M.version = (M.version || '0') + '+' + Ground.version;
})();
