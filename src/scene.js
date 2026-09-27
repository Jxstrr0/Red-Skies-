/* =====================================================================
   RED SKIES — scene.js   RS.scene : the view out of the shelter hatch.
   Reads state.visible / missiles / battery / radar / gun. Never reads tracks.
   API: init, resize, render, heightAt, launcherPos, listener, setEnv, shake, debug
        v1.1: setEnv({time:'dawn'|'day'|'dusk'|'night', sky:'clear'|'overcast'|'rain', visKm?}) (+ old weather:'storm' alias);
              SHIFT_START reads def.weather. follow(missileId|null) → boolean, following → id|null: watch-your-kill chase
              camera (emits CAM_FOLLOW {id|null}); a far-ground plane follows the camera so there is ground out to ~110 km.
        title: setTitle(on), titleLaunch(id) → missileId, titleProbe(missileId), titleOn — cover-page cinematic (v19)
        V1.3: eo = { state, setMode('TV'|'IR'|'AUTO'), toggleSwap(), swapped } — EO tracker camera inset (see the EO section);
              debug.eo (internals: stats per pass, camera, render target)
   ===================================================================== */
(function () {
  const RS = window.RS;
  const D2R = Math.PI / 180;
  const VIEW_BRG = 25;                       // hatch faces NNE (deg true)
  const EYE = 2.1;                           // V1.4: seated in the Pantsir cabin up on the truck (eye above the ground)
  const FAR_AIR = 4500;                      // aircraft beyond this (m) draw as a speck + contrail instead of a sub-pixel model
  const FAR_FX = 8000;                       // effects further than this are pulled in along the view ray (angular size kept)
  let REDUCED = false;
  try { REDUCED = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { /* ignore */ }

  let cab = null, cabScene = null, seatCam = null;   // V1.4 cabin (RS.cabin.model) in its own scene, drawn over the world
  let renderer, scene, camera, models, shelter, time = 0, simT = -1, simAge = 0, lastState = null, terrainMesh = null;
  let hemi, sun, workLight, flashLight, skyMesh, skyGeo, stars, moon, rain, bolt, sunSpr, sunHalo, skyGroup, terrainMat, farGround;
  let smoke, glow, flare, tracers, farSys;  // particle systems
  const U = { scale: { value: 400 }, maxPx: { value: 256 }, fogColor: { value: new THREE.Color() }, fogNear: { value: 1000 }, fogFar: { value: 5000 },
    pass: { value: 0 }, ir: { value: 0 } };   // V1.3: pass 0 = hatch camera, 1 = EO tracker; ir 1 = thermal look for the EO pass
  // V1.3 EO: particle layer for new spawns — 0 both cameras, 1 hatch only (pulled-in / speck stand-ins), 2 EO only (true place, true size)
  let LAY = 0;
  const V3 = THREE.Vector3;
  const _v = new V3(), _w = new V3(), _q = new THREE.Quaternion(), _Z = new V3(0, 0, 1);

  // yaw so a model's +Z points along bearing b (three: north = -Z, east = +X)
  const yawFor = b => Math.PI - b * D2R;
  const dirOf = b => [Math.sin(b * D2R), -Math.cos(b * D2R)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  function idHash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

  /* ---------------- terrain (battery pad flat, hills beyond) ---------------- */
  function hash(i, j) { const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return s - Math.floor(s); }
  function vnoise(x, z) {
    const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j;
    const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
    const a = hash(i, j), b = hash(i + 1, j), c = hash(i, j + 1), d = hash(i + 1, j + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function heightAt(x, z) {
    const d = Math.hypot(x, z);
    let n = 0, amp = 1, f = 1 / 900;
    for (let o = 0; o < 4; o++) { n += (vnoise(x * f, z * f) - 0.5) * amp; amp *= 0.5; f *= 2.1; }
    const hills = clamp((d - 250) / 2200, 0, 1), pad = sstep(260, 520, d);
    return pad * (n * (8 + hills * 320) + hills * hills * 60);
  }

  /* ---------------- battery layout (static; valid before init for audio) ---------------- */
  // rel = bearing offset from the hatch axis, dist m, face = vehicle heading (deg true)
  const LAYOUT = {
    L1: { rel: -17, dist: 60, face: VIEW_BRG - 17 + 62, kind: 'launcher_lance', lod: 'high' },
    L2: { rel: 4, dist: 135, face: VIEW_BRG + 4 - 58, kind: 'launcher_lance', lod: 'low' },
    L3: { rel: 19, dist: 70, face: VIEW_BRG + 19 + 118, kind: 'launcher_dart', lod: 'high' },
    G1: { rel: -1, dist: 34, face: VIEW_BRG - 1, kind: 'gun_harrow' },
    RADAR: { rel: -8, dist: 88, face: VIEW_BRG - 8 + 105, kind: 'radar_search' },           // search AESA (ARMs home on this one)
    FC: { rel: 11, dist: 120, face: VIEW_BRG + 11 - 70, kind: 'radar_fc', lod: 'low' },   // V1.4.3 perf: ≥ 98 m away (fine detail is sub-pixel)                  // fire-control PESA on its mast
    LA: { rel: -13, dist: 210, face: VIEW_BRG - 13 + 40, kind: 'radar_lowalt', lod: 'low' },  // low-altitude radar tower
    CP: { rel: 15, dist: 98, face: VIEW_BRG + 15 + 95, kind: 'command_post', lod: 'low' },
    GEN: { rel: 25, dist: 110, face: VIEW_BRG + 25 + 150, kind: 'generator', lod: 'low' }
  };
  for (const id in LAYOUT) {
    const L = LAYOUT[id], [dx, dz] = dirOf(VIEW_BRG + L.rel);
    L.x = dx * L.dist; L.z = dz * L.dist; L.y = heightAt(L.x, L.z);
  }
  const ASSET = (() => { const [dx, dz] = dirOf(200); return { x: dx * 22000, y: 0, z: dz * 22000 }; })();
  // the asset (Kessel, 200° / 22 km) is behind the hatch: its smoke column is drawn at a visible stand-in bearing
  const ASSET_VIEW = (() => { const [dx, dz] = dirOf(34); return { x: dx * 3000, z: dz * 3000 }; })();   // clear of L2/L3 in the hatch
  const HEIGHT_FOR = { L1: 3, L2: 3, L3: 3, G1: 2, RADAR: 11, FC: 20, LA: 26, CP: 3, GEN: 2 };

  /* ---------------- procedural textures ---------------- */
  function rng(seed) { return () => (seed = (seed * 16807) % 2147483647) / 2147483647; }
  function canvasTex(draw, N) {
    N = N || 64; const c = document.createElement('canvas'); c.width = c.height = N;
    draw(c.getContext('2d'), N); const t = new THREE.CanvasTexture(c); return t;
  }
  const texPuff = () => canvasTex((g, N) => {
    const r = rng(7);
    for (let i = 0; i < 10; i++) {
      const x = N / 2 + (r() - 0.5) * N * 0.34, y = N / 2 + (r() - 0.5) * N * 0.34, rad = N * (0.16 + r() * 0.16);
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, N, N);
    }
  });
  // tiled ground detail (~9 m per tile): straw stubble, green blades, soil flecks around a light base (multiplies vertex colour)
  const texGround = () => canvasTex((g, N) => {
    const r = rng(31);
    g.fillStyle = 'rgb(222,216,198)'; g.fillRect(0, 0, N, N);
    for (let i = 0; i < 90; i++) {                                   // soft mottling
      const x = r() * N, y = r() * N, rad = 6 + r() * 26, gr = g.createRadialGradient(x, y, 0, x, y, rad), v = r() < 0.5;
      gr.addColorStop(0, v ? 'rgba(150,160,110,0.35)' : 'rgba(250,235,190,0.35)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(0, 0, N, N);
    }
    const C = ['rgba(245,225,160,', 'rgba(170,180,110,', 'rgba(120,108,86,', 'rgba(205,190,140,'];
    for (let i = 0; i < 2600; i++) {                                 // blades / stubble strokes (wrapped so the tile is seamless)
      const x = r() * N, y = r() * N, a = -Math.PI / 2 + (r() - 0.5) * 1.4, l = 2 + r() * 7;
      g.strokeStyle = C[(r() * C.length) | 0] + (0.35 + r() * 0.5) + ')'; g.lineWidth = 0.6 + r() * 0.9;
      for (const ox of [0, -N, N]) for (const oy of [0, -N, N]) {
        if (x + ox < -10 || x + ox > N + 10 || y + oy < -10 || y + oy > N + 10) continue;
        g.beginPath(); g.moveTo(x + ox, y + oy); g.lineTo(x + ox + Math.cos(a) * l, y + oy + Math.sin(a) * l); g.stroke();
      }
    }
  }, 256);
  // V1.2.3 grass atlas: 2×2 tuft variants, 512² each (0 short turf, 1 tall feather grass, 2 seeded wheatgrass, 3 dry/broken).
  // Blades are near-neutral (instance colour carries the hue); transparent texels carry the average colour (clean mips).
  const texTuft = () => {
    const C = 512, N = C * 2, c = document.createElement('canvas'); c.width = c.height = N;
    const g = c.getContext('2d'), r = rng(77);
    const PAL = [[226, 214, 184], [212, 200, 168], [196, 190, 164], [236, 230, 210], [182, 176, 150], [150, 156, 122], [170, 170, 140]];
    const blade = (ox, oy, bx, h, lean, w, col, curl, fold) => {    // filled, tapered, curved blade; fold = tip droops past the bend
      const base = oy + C, tx = ox + bx + lean, ty = base - h, mx = ox + bx + lean * (0.3 + curl), my = base - h * 0.58;
      const [R, G, B] = col, gr = g.createLinearGradient(0, base, 0, ty);
      gr.addColorStop(0, `rgb(${R * 0.68 | 0},${G * 0.68 | 0},${B * 0.6 | 0})`); gr.addColorStop(0.35, `rgb(${R * 0.9 | 0},${G * 0.9 | 0},${B * 0.86 | 0})`);
      gr.addColorStop(0.8, `rgb(${R},${G},${B})`); gr.addColorStop(1, `rgb(${Math.min(255, R * 1.1) | 0},${Math.min(255, G * 1.08) | 0},${Math.min(255, B * 1.06) | 0})`);
      g.fillStyle = gr; g.beginPath();
      g.moveTo(ox + bx - w, base); g.quadraticCurveTo(mx - w * 0.5, my, tx, ty); g.quadraticCurveTo(mx + w * 0.5, my, ox + bx + w, base); g.closePath(); g.fill();
      g.strokeStyle = `rgba(${Math.min(255, R * 1.18) | 0},${Math.min(255, G * 1.15) | 0},${Math.min(255, B * 1.1) | 0},0.35)`; g.lineWidth = Math.max(0.6, w * 0.35);   // midrib highlight
      g.beginPath(); g.moveTo(ox + bx, base - h * 0.08); g.quadraticCurveTo(mx, my, tx, ty); g.stroke();
      if (fold) {                                                     // broken / drooping tip
        const d = lean >= 0 ? 1 : -1, L = h * fold;
        g.strokeStyle = `rgb(${R * 0.95 | 0},${G * 0.93 | 0},${B * 0.88 | 0})`; g.lineWidth = Math.max(0.8, w * 0.8); g.lineCap = 'round';
        g.beginPath(); g.moveTo(tx, ty); g.quadraticCurveTo(tx + d * L * 0.7, ty - L * 0.1, tx + d * L, ty + L * 0.6); g.stroke();
      }
      return [tx, ty];
    };
    const plume = (tx, ty, dir, L) => {                               // feather-grass awn: long, silky, drooping
      g.lineCap = 'round';
      for (const [lw, a] of [[5, 0.12], [2.4, 0.3], [1.1, 0.9]]) {
        g.strokeStyle = `rgba(246,242,228,${a})`; g.lineWidth = lw;
        g.beginPath(); g.moveTo(tx, ty); g.bezierCurveTo(tx + dir * L * 0.35, ty - L * 0.25, tx + dir * L * 0.8, ty - L * 0.05, tx + dir * L, ty + L * 0.55); g.stroke();
      }
    };
    const head = (tx, ty, ang, len, col) => {                         // wheatgrass spike: stacked spikelets
      g.save(); g.translate(tx, ty); g.rotate(ang);
      for (let k = 0; k < 7; k++) { g.fillStyle = `rgb(${col[0] - k * 3},${col[1] - k * 4},${col[2] - k * 5})`; g.beginPath(); g.ellipse((k % 2 ? 2.2 : -2.2), k * len / 7, 2.6, len / 9, (k % 2 ? 0.35 : -0.35), 0, 7); g.fill(); }
      g.restore();
    };
    const cell = (v, ox, oy) => {
      const nB = [120, 80, 90, 60][v];
      for (let i = 0; i < nB; i++) {
        const back = i < nB * 0.42;
        const hMul = v === 0 ? (back ? 0.28 + r() * 0.2 : 0.4 + r() * 0.34) : v === 1 ? (back ? 0.3 + r() * 0.25 : 0.5 + r() * 0.42) : v === 2 ? (back ? 0.32 + r() * 0.2 : 0.5 + r() * 0.38) : (back ? 0.2 + r() * 0.2 : 0.3 + r() * 0.4);
        const h = C * hMul, bx = C * (0.26 + r() * 0.48), lean = (r() - 0.5) * C * (v === 3 ? 0.55 : 0.22 + hMul * 0.32);
        let pc = PAL[(r() * PAL.length) | 0];
        if (v === 0 && r() < 0.45) pc = PAL[5 + ((r() * 2) | 0)];       // turf keeps some grey-green at the base
        if (v === 3) pc = r() < 0.6 ? [206, 196, 172] : [168, 160, 138];
        const k = back ? 0.6 : 1, col = pc.map(x => x * k * (0.88 + r() * 0.2));
        const w = ((v === 0 ? 1.4 : v === 3 ? 1.6 : 1.9) + r() * (v === 1 ? 1.4 : 2.2)) * 1.7;
        const fold = (v === 3 && r() < 0.5) ? 0.2 + r() * 0.25 : (!back && r() < 0.08 ? 0.15 : 0);
        const [tx, ty] = blade(ox, oy, bx, h, lean, w, col, (r() - 0.5) * 0.4, fold);
        if (!back && v === 1 && r() < 0.42) plume(tx, ty, lean >= 0 ? 1 : -1, C * (0.14 + r() * 0.14));
        if (!back && v === 2 && r() < 0.34) head(tx, ty + 2, Math.atan2(lean, h) * 0.9, 20 + r() * 16, [212 + (r() * 20 | 0), 188, 128]);
        if (!back && v === 0 && r() < 0.05) head(tx, ty + 2, Math.atan2(lean, h), 10 + r() * 6, [200, 184, 130]);
      }
    };
    for (let v = 0; v < 4; v++) cell(v, (v % 2) * C, (v < 2 ? 1 : 0) * C);   // canvas y is top-down: variants 0,1 on the lower half → DataTexture v 0..0.5
    const img = g.getImageData(0, 0, N, N).data, data = new Uint8Array(N * N * 4);
    let sr = 0, sg = 0, sb = 0, n = 0;
    for (let i = 0; i < img.length; i += 4) if (img[i + 3] > 200) { sr += img[i]; sg += img[i + 1]; sb += img[i + 2]; n++; }
    const avg = [sr / n, sg / n, sb / n];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {       // DataTexture rows run bottom-up
      const si = ((N - 1 - y) * N + x) * 4, di = (y * N + x) * 4, a = img[si + 3], k = a / 255;
      data[di] = img[si] * k + avg[0] * (1 - k); data[di + 1] = img[si + 1] * k + avg[1] * (1 - k); data[di + 2] = img[si + 2] * k + avg[2] * (1 - k); data[di + 3] = a;
    }
    const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true;
    return t;
  };
  const texGlow = () => canvasTex((g, N) => {
    const gr = g.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.18, 'rgba(255,255,255,0.8)');
    gr.addColorStop(0.5, 'rgba(255,255,255,0.18)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, N, N);
  });

  /* ---------------- particle system: one Points draw per system, pooled ---------------- */
  const PVS = `
    attribute float size; attribute float alpha; attribute vec3 pcol; attribute float layer;
    uniform float uScale, uMinPx, uMaxPx, uFogNear, uFogFar, uFogK, uPass;
    varying float vA; varying vec3 vC; varying float vF;
    #include <common>
    #include <logdepthbuf_pars_vertex>
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      float d = max(0.1, -mv.z);
      float on = (layer < 0.5 || abs(layer - 1.0 - uPass) < 0.5) ? 1.0 : 0.0;   // layer 1: hatch pass only, 2: EO pass only
      gl_PointSize = on * clamp(max(size * uScale / d, uMinPx), 0.0, uMaxPx);
      vA = alpha * on; vC = pcol; vF = uFogK * smoothstep(uFogNear, uFogFar, d);
      gl_Position = projectionMatrix * mv;
      #include <logdepthbuf_vertex>
      if (on < 0.5) gl_Position = vec4(0.0, 0.0, -2.0, 1.0);                  // outside the clip volume
    }`;
  const PFS = `
    uniform sampler2D map; uniform vec3 uFogColor; uniform float uAdd, uIR;
    varying float vA; varying vec3 vC; varying float vF;
    #include <logdepthbuf_pars_fragment>
    void main() {
      #include <logdepthbuf_fragment>
      vec4 t = texture2D(map, gl_PointCoord);
      float a = t.a * vA;
      if (a < 0.004) discard;
      vec3 c = vC;
      if (uIR > 0.5) c = uAdd > 0.5 ? vec3(min(1.0, 1.4 * max(c.r, max(c.g, c.b))))     // thermal: flames/flashes white-hot,
        : vec3(0.2 + 0.22 * dot(c, vec3(0.3, 0.59, 0.11)));                             // smoke/contrails a dull grey
      c = uAdd > 0.5 ? c * (1.0 - vF) : mix(c, uFogColor, vF);
      gl_FragColor = vec4(c, a);
    }`;
  let smokeLight = 0.85;                     // brightness of non-additive smoke for the current light (day 1, dusk .85, night .3)
  const PS_ATTR = ['position', 'pcol', 'size', 'alpha', 'layer'];
  class PSys {
    constructor(cap, tex, additive, minPx, fogK, order) {
      this.cap = cap; this.n = 0; this.rr = 0; this.add = !!additive;
      const F = k => new Float32Array(cap * k);
      this.P = F(3); this.C = F(3); this.S = F(1); this.A = F(1); this.L = F(1);
      this.d = { vx: F(1), vy: F(1), vz: F(1), age: F(1), life: F(1), s0: F(1), s1: F(1), a0: F(1), drag: F(1), rise: F(1) };
      const g = this.geo = new THREE.BufferGeometry();
      const at = (a, k) => new THREE.BufferAttribute(a, k).setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('position', at(this.P, 3)); g.setAttribute('pcol', at(this.C, 3));
      g.setAttribute('size', at(this.S, 1)); g.setAttribute('alpha', at(this.A, 1)); g.setAttribute('layer', at(this.L, 1));
      g.setDrawRange(0, 0);
      const m = new THREE.ShaderMaterial({
        uniforms: { map: { value: tex }, uScale: U.scale, uMaxPx: U.maxPx, uMinPx: { value: minPx }, uFogColor: U.fogColor,
          uFogNear: U.fogNear, uFogFar: U.fogFar, uFogK: { value: fogK }, uAdd: { value: additive ? 1 : 0 }, uPass: U.pass, uIR: U.ir },
        vertexShader: PVS, fragmentShader: PFS, transparent: true, depthWrite: false,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending
      });
      m.extensions.fragDepth = true;
      this.pts = new THREE.Points(g, m); this.pts.frustumCulled = false; this.pts.renderOrder = order;
      scene.add(this.pts);
    }
    // o: { life, s0, s1, a0, c:hex, drag, rise }   k scales size
    spawn(x, y, z, vx, vy, vz, o, k) {
      let i;
      if (this.n < this.cap) i = this.n++; else { i = this.rr; this.rr = (this.rr + 1) % this.cap; }
      const d = this.d; k = k || 1;
      this.P[i * 3] = x; this.P[i * 3 + 1] = y; this.P[i * 3 + 2] = z;
      d.vx[i] = vx; d.vy[i] = vy; d.vz[i] = vz; d.age[i] = 0; d.life[i] = o.life;
      d.s0[i] = o.s0 * k; d.s1[i] = (o.s1 == null ? o.s0 : o.s1) * k; d.a0[i] = o.a0; d.drag[i] = o.drag || 0; d.rise[i] = o.rise || 0;
      const c = o.c, L = this.add ? 1 : smokeLight * (0.8 + Math.random() * 0.2);   // lit smoke: env light + per-puff shading (billows)
      this.C[i * 3] = ((c >> 16) & 255) / 255 * L; this.C[i * 3 + 1] = ((c >> 8) & 255) / 255 * L; this.C[i * 3 + 2] = (c & 255) / 255 * L;
      this.S[i] = d.s0[i]; this.A[i] = o.a0; this.L[i] = LAY;
    }
    kill(i) {
      const j = --this.n, d = this.d;
      if (i === j) return;
      for (let k = 0; k < 3; k++) { this.P[i * 3 + k] = this.P[j * 3 + k]; this.C[i * 3 + k] = this.C[j * 3 + k]; }
      this.S[i] = this.S[j]; this.A[i] = this.A[j]; this.L[i] = this.L[j];
      for (const key in d) d[key][i] = d[key][j];
    }
    update(dt) {
      const d = this.d, P = this.P;
      for (let i = 0; i < this.n; i++) {
        if (d.age[i] >= d.life[i]) { this.kill(i); i--; continue; }
        if (d.life[i] < 0.01) { d.age[i] = 1; continue; }          // one-frame glow: drawn as spawned, dies next update
        d.age[i] += dt;
        const f = Math.min(1, d.age[i] / d.life[i]), dr = Math.max(0, 1 - d.drag[i] * dt);
        d.vx[i] *= dr; d.vy[i] = d.vy[i] * dr + d.rise[i] * dt; d.vz[i] *= dr;
        P[i * 3] += d.vx[i] * dt; P[i * 3 + 1] += d.vy[i] * dt; P[i * 3 + 2] += d.vz[i] * dt;
        this.S[i] = d.s0[i] + (d.s1[i] - d.s0[i]) * Math.sqrt(f);
        this.A[i] = d.a0[i] * (1 - f) * (1 - f * 0.3);
      }
      if (this.rr >= this.n) this.rr = 0;
      const g = this.geo, n = this.n; g.setDrawRange(0, n);
      if (!n) return;                             // V1.4.3 perf: nothing alive → nothing drawn, nothing to upload
      for (const k of PS_ATTR) { const a = g.attributes[k]; a.updateRange.offset = 0; a.updateRange.count = n * a.itemSize; a.needsUpdate = true; }   // live prefix only
    }
  }
  // particle presets
  const FX = {
    trail: { life: 6, s0: 1.6, s1: 16, a0: 0.55, c: 0xe2e0da, drag: 0.5, rise: 0.25 },
    contrail: { life: 9, s0: 3, s1: 24, a0: 0.32, c: 0xf2f4f8, drag: 0.05 },
    // cold-launch sequence (reference: Kelbo's clip) — grey ejection gas, orange ignition, huge lingering white cloud
    ejectGas: { life: 6, s0: 3, s1: 15, a0: 0.9, c: 0x3e3a36, drag: 1.1, rise: 1.0 },          // charcoal powder-gas (ref clip 2)
    throwTrail: { life: 4.5, s0: 2, s1: 11, a0: 0.8, c: 0x47423d, drag: 0.8, rise: 0.5 },
    capBit: { life: 2.6, s0: 0.35, s1: 0.35, a0: 1, c: 0x1c1916, drag: 0.25, rise: -9.8 },   // cap/cover fragments (fall under gravity)
    ignFire: { life: 0.7, s0: 10, s1: 26, a0: 1, c: 0xffb347, drag: 2, rise: 1 },
    ignCore: { life: 0.35, s0: 18, s1: 40, a0: 1, c: 0xfff2c4 },
    launchCloud: { life: 17, s0: 10, s1: 70, a0: 0.72, c: 0xeeece6, drag: 0.45, rise: 0.7 },
    exhaust: { life: 14, s0: 6, s1: 50, a0: 0.7, c: 0xf3efe4, drag: 0.9, rise: 0.5 },
    farTrail: { life: 16, s0: 60, s1: 240, a0: 0.7, c: 0xf4f6fa, drag: 0.02 },   // distant contrail (spreads wide, stays visible)
    farDot: { life: 0.001, s0: 0, a0: 1, c: 0x0c0d0f },
    dark: { life: 7, s0: 8, s1: 45, a0: 0.75, c: 0x1e1c1a, drag: 0.5, rise: 1.2 },
    grey: { life: 4, s0: 4, s1: 18, a0: 0.6, c: 0x6a6660, drag: 0.8, rise: 0.6 },
    column: { life: 26, s0: 30, s1: 190, a0: 0.55, c: 0x1c1b1a, drag: 0.02, rise: 1.0 },
    fire: { life: 0.9, s0: 7, s1: 16, a0: 0.9, c: 0xff7a26, drag: 1.5, rise: 3 },
    vapor: { life: 0.45, s0: 1.2, s1: 7, a0: 0.5, c: 0xffffff, drag: 3 },          // V1.2.2 condensation on hard pulls
    ember: { life: 0.5, s0: 2.5, s1: 4, a0: 0.9, c: 0xff9a40, drag: 0.5 },
    flash: { life: 0.5, s0: 50, s1: 150, a0: 1, c: 0xfff1d6 },
    ball: { life: 1.6, s0: 18, s1: 50, a0: 0.95, c: 0xff8a2a, drag: 1.2, rise: 4 },
    puffBig: { life: 9, s0: 25, s1: 110, a0: 0.8, c: 0x1e1c1a, drag: 0.6, rise: 1.5 },
    muzzle: { life: 0.06, s0: 1.6, s1: 2.4, a0: 1, c: 0xffd08a },
    dot: { life: 0.001, s0: 0, a0: 0.9, c: 0x111214 },
    motor: { life: 0.001, s0: 2.2, a0: 1, c: 0xffd9a0 },
    navR: { life: 0.001, s0: 0.8, a0: 1, c: 0xff3020 }, navG: { life: 0.001, s0: 0.8, a0: 1, c: 0x30ff60 },
    navW: { life: 0.001, s0: 1.2, a0: 1, c: 0xffffff }, work: { life: 0.001, s0: 1.4, a0: 0.9, c: 0xffe2a8 },
    heat: { life: 0.001, s0: 2.6, a0: 0.9, c: 0xfff0e0 }                              // V1.3 EO/IR: engine exhaust hot spot
  };
  // world position for an effect at sim (x km, y km, alt m); far ones are pulled in to FAR_FX along the ray
  function fxPos(px, py, pz) {
    const c = camera.position; _v.set(px - c.x, py - c.y, pz - c.z);
    const d = _v.length(), k = d > FAR_FX ? FAR_FX / d : 1;
    return { x: c.x + _v.x * k, y: c.y + _v.y * k, z: c.z + _v.z * k, k, d };
  }
  // V1.3 EO: a far effect the tracker is looking at is spawned twice — pulled in for the hatch (layer 1) and at its true
  // place / true size for the EO camera (layer 2). fn(q) spawns the effect at q. Events only (allocates).
  function fxAt(px, py, pz, fn) {
    const q = fxPos(px, py, pz);
    if (q.k < 1 && eoSees(px, py, pz)) { LAY = 1; fn(q); LAY = 2; fn({ x: px, y: py, z: pz, k: 1, d: q.d }); LAY = 0; }
    else fn(q);
    return q;
  }
  function burst(sys, p, o, n, spd, k) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283, b = Math.acos(2 * Math.random() - 1), s = spd * (0.4 + Math.random() * 0.6) * p.k;
      sys.spawn(p.x, p.y, p.z, Math.sin(b) * Math.cos(a) * s, Math.cos(b) * s, Math.sin(b) * Math.sin(a) * s, o, (k || 1) * p.k * (0.7 + Math.random() * 0.6));
    }
  }
  function pulseLight(x, y, z, power) { if (!flashLight) return; flashLight.position.set(x, y, z); flashT = Math.max(flashT, power); }
  let flashT = 0;

  /* ---------------- tracers (one LineSegments draw) ---------------- */
  const TR_N = 48;
  function buildTracers() {
    const g = new THREE.BufferGeometry(), P = new Float32Array(TR_N * 6), C = new Float32Array(TR_N * 6);
    g.setAttribute('position', new THREE.BufferAttribute(P, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(C, 3).setUsage(THREE.DynamicDrawUsage));
    const m = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    const ls = new THREE.LineSegments(g, m); ls.frustumCulled = false; ls.renderOrder = 6; scene.add(ls);
    return { ls, P, C, list: Array.from({ length: TR_N }, () => ({ on: false, p: new V3(), v: new V3(), age: 0 })), i: 0 };
  }
  function updateTracers(dt) {
    const T = tracers; T.P.fill(0); T.C.fill(0);
    T.list.forEach((t, i) => {
      if (!t.on) return;
      t.age += dt; if (t.age > 1.8) { t.on = false; return; }
      t.v.y -= 9.8 * dt; t.p.addScaledVector(t.v, dt);
      const f = 1 - t.age / 1.8, o = i * 6;
      T.P[o] = t.p.x; T.P[o + 1] = t.p.y; T.P[o + 2] = t.p.z;
      T.P[o + 3] = t.p.x - t.v.x * 0.05; T.P[o + 4] = t.p.y - t.v.y * 0.05; T.P[o + 5] = t.p.z - t.v.z * 0.05;
      T.C[o] = 1.0 * f; T.C[o + 1] = 0.75 * f; T.C[o + 2] = 0.35 * f; T.C[o + 3] = 0.5 * f; T.C[o + 4] = 0.2 * f; T.C[o + 5] = 0.05 * f;
    });
    T.ls.geometry.attributes.position.needsUpdate = true; T.ls.geometry.attributes.color.needsUpdate = true;
  }

  /* ---------------- world building ---------------- */
  function buildTerrain() {
    const size = 9000, seg = 120;
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position, cols = new Float32Array(pos.count * 3), c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), h = heightAt(x, z);
      pos.setY(i, h);
      // summer steppe: straw-gold fields with greener hollows; trampled/gravel battery pad at the centre
      groundCol(c, x, z, h, 1 - sstep(60, 240, Math.hypot(x, z)), (hash(i, 7) - 0.5) * 0.04);
      cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    geo.computeVertexNormals();
    const det = texGround(); det.wrapS = det.wrapT = THREE.RepeatWrapping; det.repeat.set(size / 9, size / 9);
    det.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 1);
    terrainMat = new THREE.MeshLambertMaterial({ vertexColors: true, map: det }); eoClip(terrainMat);
    terrainMesh = new THREE.Mesh(geo, terrainMat); scene.add(terrainMesh);
  }
  // steppe colour at (x,z) — shared by the near terrain and the far ground (pad = battery-pad blend 0..1)
  function groundCol(c, x, z, h, pad, jitter) {
    const t = clamp(h / 260, 0, 1), patch = vnoise(x / 420 + 11, z / 420 - 7), dry = sstep(0.35, 0.65, patch);
    c.setRGB(0.28 + 0.14 * dry + 0.10 * t, 0.29 + 0.08 * dry + 0.04 * t, 0.15 + 0.04 * dry + 0.08 * t);
    if (jitter) c.offsetHSL(0, 0, jitter);
    if (pad > 0) c.lerp(PAD_COL, pad * 0.5);
    return c;
  }
  const PAD_COL = new THREE.Color(0.27, 0.26, 0.19);
  /* ---------------- far ground: a coarse terrain sheet (45 km, 900 m cells) that re-centres under the camera.
     Inside the near-terrain square it sinks out of sight; outside it carries the same hills + colours (the detail
     texture's average is baked in). Rebuilt only when the camera crosses a cell (~1k heightAt calls). ---------------- */
  const FG_CELL = 900, FG_N = 50, NEAR_HALF = 4500;
  function buildFarGround() {
    const geo = new THREE.PlaneGeometry(FG_CELL * FG_N, FG_CELL * FG_N, FG_N, FG_N);
    geo.rotateX(-Math.PI / 2);
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 3), 3));
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true }); eoClip(mat);
    const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; mesh.renderOrder = -0.5;
    scene.add(mesh);
    farGround = { mesh, geo, mat, base: geo.attributes.position.array.slice(), cx: NaN, cz: NaN };
    updateFarGround(0, 0);
  }
  const _fc = new THREE.Color();
  function updateFarGround(x, z) {
    const F = farGround, cx = Math.round(x / FG_CELL) * FG_CELL, cz = Math.round(z / FG_CELL) * FG_CELL;
    if (cx === F.cx && cz === F.cz) return;
    F.cx = cx; F.cz = cz; F.mesh.position.set(cx, 0, cz);
    const pos = F.geo.attributes.position, col = F.geo.attributes.color, B = F.base;
    for (let i = 0; i < pos.count; i++) {
      const wx = B[i * 3] + cx, wz = B[i * 3 + 2] + cz, h = heightAt(wx, wz);
      const inside = Math.abs(wx) < NEAR_HALF && Math.abs(wz) < NEAR_HALF;
      pos.setY(i, inside ? h - 160 : h);
      groundCol(_fc, wx, wz, h, 0, 0);
      col.setXYZ(i, _fc.r * 0.83, _fc.g * 0.8, _fc.b * 0.7);          // × the ground texture's average tint
    }
    pos.needsUpdate = true; col.needsUpdate = true; F.geo.computeVertexNormals();
  }
  /* ---------------- grass (V1.2.3): two instanced layers of steppe tufts in the hatch's view, swaying in the wind ----------------
     near: 3 crossed quads × 3 height segments (blades bend in a smooth curve), 4 atlas variants; mid/far: 2 crossed quads.
     Shading: base AO, per-instance hue, gust sheen, translucent tips when looking into a low sun. */
  const grassU = { uTime: { value: 0 }, uWind: { value: 1 }, uSun: { value: new THREE.Color(0, 0, 0) }, uSunDir: { value: new V3(0, 1, 0) } };
  let grassGust = 0, grassMesh = null, grassFull = 0, grassTitle = null;
  const grassLayers = [];                                             // [{ mesh, full }]
  // auto-quality: if frames run slow for ~3 s, thin the grass, then lower the render resolution (phones differ a lot)
  const perf = { acc: 0, n: 0, level: 0 };
  function autoQuality(rawDt) {
    if (perf.level >= 3 || !(rawDt > 0) || api.lockQuality) return;   // lockQuality: test/screenshot hook
    perf.acc += rawDt; perf.n++;
    if (perf.acc < 3) return;
    const avg = perf.acc / perf.n; perf.acc = 0; perf.n = 0;
    if (avg < 1 / 40) return;                                        // ≥ 40 fps: keep full quality
    perf.level++;
    if (perf.level <= 2) for (const L of grassLayers) L.mesh.count = Math.round(L.full * (perf.level === 1 ? 0.55 : 0.3));
    else if (perf.level === 3) { renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.1)); api.resize(renderer.domElement.clientWidth, renderer.domElement.clientHeight); }
  }
  function tuftGeo(quads, segs) {
    // crossed quads, 1 m wide × 1 m tall, base at y = 0; normals point up so tufts light like the ground
    const P = [], U = [], I = [];
    for (let k = 0; k < quads; k++) {
      const a = k * Math.PI / quads + 0.3, cx = Math.cos(a) * 0.5, cz = Math.sin(a) * 0.5, b = P.length / 3;
      for (let j = 0; j <= segs; j++) { const y = j / segs; P.push(-cx, y, -cz, cx, y, cz); U.push(0, y, 1, y); }
      for (let j = 0; j < segs; j++) { const o = b + j * 2; I.push(o, o + 1, o + 3, o, o + 3, o + 2); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(P.map((v, i) => (i % 3 === 1 ? 1 : 0)), 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); geo.setIndex(I);
    return geo;
  }
  function grassMat(tex) {
    const mat = new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.4, side: THREE.DoubleSide });
    mat.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, { uTime: grassU.uTime, uWind: grassU.uWind, uSun: grassU.uSun, uSunDir: grassU.uSunDir });
      sh.vertexShader = 'uniform float uTime; uniform float uWind; uniform vec3 uSunDir; attribute float aVar; varying float vBend; varying float vGy; varying float vBack;\n' + sh.vertexShader
        .replace('#include <uv_vertex>', `#include <uv_vertex>
        vUv = uv * 0.5 + vec2(mod(aVar, 2.0), step(1.5, aVar)) * 0.5;      // atlas cell
        vGy = uv.y;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
        float gh = max(position.y, 0.0);
        vec4 gp = instanceMatrix[3];
        float ph = uTime * 1.7 + gp.x * 0.09 + gp.z * 0.06;
        // travelling gust bands roll across the field (the silvery waves on real steppe grass) + a slower broad swell
        float wave = sin(dot(gp.xz, vec2(0.052, 0.031)) - uTime * 1.35) * 0.5 + 0.5;
        float swell = sin(dot(gp.xz, vec2(0.011, -0.017)) - uTime * 0.4) * 0.5 + 0.5;
        wave = wave * wave * wave * (0.6 + 0.6 * swell);
        float sw = (sin(ph) * 0.4 + sin(ph * 2.3 + 1.7) * 0.14 + sin(ph * 5.1 + position.x * 7.0) * 0.05 + 0.3 + wave * 0.95) * uWind;
        float bend = gh * gh;
        transformed.x += sw * bend * 0.34; transformed.z += sw * bend * 0.19;
        transformed.y -= abs(sw) * bend * 0.08;
        transformed.xz += position.xz * bend * (0.18 + 0.1 * step(0.5, aVar) * step(aVar, 1.5));   // blades fan out as they rise
        vBend = wave * min(uWind, 1.6);
        vec3 wpos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        vBack = pow(max(dot(normalize(wpos - cameraPosition), uSunDir), 0.0), 3.0);`);
      // back faces of the crossed quads must light like the front (Lambert would light them from below → black specks)
      sh.fragmentShader = 'uniform vec3 uSun; varying float vBend; varying float vGy; varying float vBack;\n' + sh.fragmentShader
        .replace(/:\s*vLightBack\s*;/g, ': vLightFront;').replace(/:\s*vIndirectBack\s*;/g, ': vIndirectFront;')
        .replace('#include <map_fragment>', `#include <map_fragment>
          diffuseColor.rgb *= mix(0.4, 1.08, smoothstep(0.0, 0.8, vGy));       // ambient occlusion deep in the tuft
          diffuseColor.rgb *= 1.0 + 0.2 * vBend * vGy;                            // bent blades flash their pale undersides
          float gEdge = 1.0 - smoothstep(0.42, 0.95, diffuseColor.a);             // blade edges / thin tips (partial alpha)`)
        .replace('#include <output_fragment>', `outgoingLight += uSun * (diffuseColor.rgb * (0.3 * vGy * vGy + 1.6 * vBack * vGy) + vec3(0.6, 0.46, 0.3) * vBack * gEdge * vGy * 2.4);   // low sun through the tips, rim-lit blade edges
          #include <output_fragment>`);
    };
    return mat;
  }
  function buildGrass() {
    const tex = texTuft(); tex.anisotropy = 8;
    const clear = [['L1', 15], ['L2', 15], ['L3', 12], ['G1', 8], ['RADAR', 13], ['FC', 11], ['LA', 8], ['CP', 10], ['GEN', 6]];
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new V3(), pp = new V3(), col = new THREE.Color(), Y = new V3(0, 1, 0);
    const straw = new THREE.Color(0xd9c38f), pale = new THREE.Color(0xe6dcc0), olive = new THREE.Color(0x8e8c5c), sage = new THREE.Color(0x8d9272),
      dryg = new THREE.Color(0xc2ab7c), grey = new THREE.Color(0xaaa594), rust = new THREE.Color(0xb68f5f);
    // V1.4.3 perf: farGeo/farD split a layer — tufts beyond farD metres use a lighter geometry (same placement stream, so the
    // field looks the same; beyond ~10 m a tuft is a few pixels tall and the extra quads/segments were ~100k triangles a frame)
    const layer = (N, geo, near, seed, o, farGeo, farD) => {
      o = o || { ox: 0, oz: 0, brg: VIEW_BRG, spread: near ? 80 : 92, d0: near ? 3.2 : 30, d1: near ? 30 : 300, pw: near ? 1.35 : 1.7 };
      const r = rng(seed), mat = grassMat(tex);
      const band = g => ({ mesh: new THREE.InstancedMesh(g, mat, N), aVar: new Float32Array(N), n: 0 });
      const A = band(geo), B = farGeo ? band(farGeo) : null;
      let n = 0;
      for (let i = 0; i < N * 5 && n < N; i++) {
        const b = o.brg + (r() - 0.5) * o.spread, d = o.d0 + Math.pow(r(), o.pw) * o.d1;
        const [dx, dz] = dirOf(b), x = o.ox + dx * d, z = o.oz + dz * d;
        if (o.ox && Math.hypot(x, z) < 26) continue;                  // title layer: leave the battery pad to the main layers
        if (clear.some(([id, rad]) => Math.hypot(x - LAYOUT[id].x, z - LAYOUT[id].z) < rad)) continue;
        const clump = vnoise(x / 6 + 3, z / 6 - 5), patch = vnoise(x / 23 - 7, z / 23 + 2), dry = vnoise(x / 38, z / 38) * 0.7 + vnoise(x / 110 + 5, z / 110) * 0.3, fine = vnoise(x / 9 - 9, z / 9 + 4);
        if (r() > (near ? 0.04 : 0.22) + sstep(0.35, 0.8, clump) * 1.05) continue;   // clumps with thin, bare-ish ground between
        // variant: turf everywhere, feather grass in patches, wheatgrass on the drier ground, the odd dead tuft
        const u = r();
        const v = u < 0.07 ? 3 : patch > 0.62 && u < 0.55 ? 1 : dry > 0.55 && u < 0.5 ? 2 : u < 0.62 ? 0 : patch > 0.45 ? 1 : 2;
        const close = sstep(10, 4, d) * (o.ox ? 0.4 : 1);                                // the nearest tufts are bigger so single blades read
        const hv = [0.3, 0.62, 0.5, 0.3][v], wv = [0.9, 0.95, 0.85, 0.8][v];
        const h = hv * (0.7 + r() * 0.55 + clump * 0.3) * (d > 60 ? 1.1 : 1) * (1 + close * 0.3);
        const w = wv * (0.65 + r() * 0.5 + (d > 60 ? 0.35 : 0)) * (1 + close * 0.25);
        q.setFromAxisAngle(Y, r() * 6.283);
        m.compose(pp.set(x, heightAt(x, z) - 0.04, z), q, sc.set(w, h, w));
        const T = B && d > farD ? B : A, mesh = T.mesh, k = T.n++;
        mesh.setMatrixAt(k, m); T.aVar[k] = v;
        col.copy(olive).lerp(sage, sstep(0.3, 0.7, patch) * 0.6).lerp(straw, 0.05 + 0.75 * sstep(0.3, 0.7, dry)).lerp(dryg, fine * 0.35);
        if (v === 1) col.lerp(pale, 0.35);
        if (v === 2) col.lerp(rust, 0.18 * r());
        if (v === 3) col.lerp(grey, 0.65);
        col.multiplyScalar(0.46 + clump * 0.26 + r() * 0.16);
        mesh.setColorAt(k, col);
        n++;
      }
      if (B) { B.full = tuftGeo(3, 3); B.full.setAttribute('aVar', new THREE.InstancedBufferAttribute(B.aVar, 1)); A.mesh.userData.farBand = { mesh: B.mesh, lite: farGeo, full: B.full }; }
      for (const T of B ? [A, B] : [A]) {
        const mesh = T.mesh;
        mesh.geometry.setAttribute('aVar', new THREE.InstancedBufferAttribute(T.aVar, 1));
        mesh.count = T.n; mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.frustumCulled = false;
        if (T === A) scene.add(mesh); else A.mesh.add(mesh);         // far band rides on the near mesh: one visible flag for both
        grassLayers.push({ mesh, full: T.n });
      }
      return A.mesh;
    };
    grassMesh = layer(11000, tuftGeo(3, 3), true, 4242, null, tuftGeo(2, 2), 10);
    layer(15000, tuftGeo(2, 1), false, 777);
    // cover page: the camera sits low in the grass SW of the site looking NNE into the sun → backlit foreground tufts
    grassTitle = layer(6500, tuftGeo(3, 3), true, 99, { ox: TCAM.x, oz: TCAM.z, brg: TCAM.brg, spread: 110, d0: 1.4, d1: 60, pw: 1.6 });   // kept full: lighter tufts dim the backlit rim of the hero shot
    grassTitle.visible = !!title.on;
    if (title.on) grassMesh.userData.farBand.mesh.geometry = grassMesh.userData.farBand.full;
    grassFull = grassLayers.reduce((a, L) => a + L.full, 0);
  }
  function buildSky() {
    skyGeo = new THREE.SphereGeometry(9500, 24, 12);
    skyGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(skyGeo.attributes.position.count * 3), 3));
    skyMesh = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
    skyMesh.renderOrder = -1;
    skyGroup = new THREE.Group(); skyGroup.add(skyMesh); scene.add(skyGroup);   // sky, stars, moon, sun ride with the camera (chase cam)
    // stars
    const r = rng(99), N = 700, P = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const a = r() * 6.283, e = Math.asin(0.04 + r() * 0.96);
      P[i * 3] = Math.cos(e) * Math.sin(a) * 9000; P[i * 3 + 1] = Math.sin(e) * 9000; P[i * 3 + 2] = Math.cos(e) * Math.cos(a) * 9000;
    }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(P, 3));
    stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xcfd8ff, size: 1.6, sizeAttenuation: false, fog: false, depthWrite: false, transparent: true, opacity: 0.85 }));
    stars.frustumCulled = false; skyGroup.add(stars);
    // moon (disc sprite), bearing 48°, 22° up
    moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: canvasTex((g, N) => {
      const gr = g.createRadialGradient(N / 2, N / 2, N * 0.2, N / 2, N / 2, N / 2);
      gr.addColorStop(0, 'rgba(235,240,255,1)'); gr.addColorStop(0.36, 'rgba(225,232,250,1)'); gr.addColorStop(0.42, 'rgba(160,180,230,0.25)'); gr.addColorStop(1, 'rgba(120,140,200,0)');
      g.fillStyle = gr; g.fillRect(0, 0, N, N);
      g.fillStyle = 'rgba(150,160,180,0.35)'; [[0.42, 0.44, 0.07], [0.58, 0.55, 0.05], [0.5, 0.6, 0.04]].forEach(([x, y, rr]) => { g.beginPath(); g.arc(x * N, y * N, rr * N, 0, 7); g.fill(); });
    }, 128), fog: false, depthWrite: false, transparent: true }));
    const [mx, mz] = dirOf(48); moon.position.set(mx * 8500 * 0.93, 8500 * 0.37, mz * 8500 * 0.93); moon.scale.setScalar(320);
    skyGroup.add(moon);
    // [v19] title sun: a low, swollen disc + wide halo (only shown on the cover page)
    const sunTex = canvasTex((g, N) => {
      const gr = g.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2);
      gr.addColorStop(0, 'rgba(255,236,200,1)'); gr.addColorStop(0.3, 'rgba(255,190,120,1)'); gr.addColorStop(0.38, 'rgba(255,120,60,0.55)');
      gr.addColorStop(0.55, 'rgba(255,80,40,0.12)'); gr.addColorStop(1, 'rgba(255,60,30,0)');
      g.fillStyle = gr; g.fillRect(0, 0, N, N);
    }, 256);
    sunSpr = new THREE.Sprite(new THREE.SpriteMaterial({ map: sunTex, fog: false, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending }));
    sunSpr.scale.setScalar(900); sunSpr.visible = false; sunSpr.renderOrder = 0; skyGroup.add(sunSpr);
    const haloTex = canvasTex((g, N) => {
      const gr = g.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2);
      gr.addColorStop(0, 'rgba(255,120,60,0.55)'); gr.addColorStop(0.4, 'rgba(230,70,40,0.18)'); gr.addColorStop(1, 'rgba(200,40,30,0)');
      g.fillStyle = gr; g.fillRect(0, 0, N, N);
    }, 128);
    sunHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, fog: false, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending }));
    sunHalo.scale.setScalar(5200); sunHalo.visible = false; skyGroup.add(sunHalo);
  }
  /* v1.1 overcast / rain: a stratus deck — a big disc CLOUD_H above the camera with tileable fbm lumps, world-anchored (the
     texture offset follows the camera so the chase view flies under it), drifting with the wind. Drawn right after the sky with
     no depth write, so aircraft above it stay visible (gameplay); fog melts it into the horizon haze. */
  const CLOUD_H = 1500, CLOUD_TILE = 4200, CLOUD_R = 28000;
  let cloudDeck = null;
  function buildCloudDeck() {
    const tex = canvasTex((g, N) => {
      const img = g.createImageData(N, N), d = img.data;
      const tv = (x, y, P, s) => {                 // tileable value noise, period P lattice cells
        const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
        const h = (a, b) => hash(((a % P) + P) % P + (((b % P) + P) % P) * 131, s);
        const a0 = h(xi, yi) + (h(xi + 1, yi) - h(xi, yi)) * u, a1 = h(xi, yi + 1) + (h(xi + 1, yi + 1) - h(xi, yi + 1)) * u;
        return a0 + (a1 - a0) * v;
      };
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        let n = 0, amp = 0.5, P = 4;
        for (let o = 0; o < 5; o++, amp *= 0.5, P *= 2) n += amp * tv(x / N * P, y / N * P, P, 17 + o * 7);
        const k = 0.66 + 0.34 * sstep(0.3, 0.72, n / 0.97), i = (y * N + x) * 4;   // dark bases, paler gaps between the lumps
        d[i] = d[i + 1] = d[i + 2] = Math.round(k * 255); d[i + 3] = 255;
      }
      g.putImageData(img, 0, 0);
    }, 256);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(CLOUD_R * 2 / CLOUD_TILE, CLOUD_R * 2 / CLOUD_TILE);
    tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const geo = new THREE.CircleGeometry(CLOUD_R, 40); geo.rotateX(Math.PI / 2);   // faces down
    cloudDeck = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, depthWrite: false, side: THREE.DoubleSide }));
    cloudDeck.renderOrder = -0.9; cloudDeck.frustumCulled = false; cloudDeck.visible = false;
    scene.add(cloudDeck);
  }
  function updateCloudDeck(dt) {
    if (!cloudDeck || !cloudDeck.visible) return;
    const c = camera.position, T = cloudDeck.material.map;
    cloudDeck.position.set(c.x, Math.max(CLOUD_H, c.y + CLOUD_H), c.z);
    cloudDeck.userData.drift = (cloudDeck.userData.drift || 0) + dt * (env.cur && env.cur.storm ? 14 : 6);   // m/s of wind
    T.offset.set(((c.x + cloudDeck.userData.drift) / CLOUD_TILE) % 1, ((c.z + cloudDeck.userData.drift * 0.4) / CLOUD_TILE) % 1);
  }
  function buildTrees(n) {
    const proto = models.create('tree', { placeholder: true });
    proto.updateMatrixWorld(true);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new V3(), p = new V3(), mats = [];
    const rnd = rng(12345);
    for (let i = 0; i < n; i++) {
      const b = rnd() * 360, r = 280 + Math.pow(rnd(), 0.7) * 3300;
      const [dx, dz] = dirOf(b), x = dx * r, z = dz * r;
      const k = 0.7 + rnd() * 0.7;
      q.setFromAxisAngle(new V3(0, 1, 0), rnd() * 6.28);
      mats.push(new THREE.Matrix4().compose(p.set(x, heightAt(x, z) - 0.3, z), q, s.set(k, k * (0.8 + rnd() * 0.5), k)));
    }
    proto.traverse(o => {
      if (!o.isMesh) return;
      const im = new THREE.InstancedMesh(o.geometry, o.material, n);
      for (let i = 0; i < n; i++) im.setMatrixAt(i, m.multiplyMatrices(mats[i], o.matrixWorld));
      im.instanceMatrix.needsUpdate = true;
      scene.add(im); eoHide.push(im);              // V1.3: the EO pass skips them (they'd float over its LOS-lowered terrain)
    });
  }
  function buildRain() {
    const N = 650, P = new Float32Array(N * 6), g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(P, 3).setUsage(THREE.DynamicDrawUsage));
    const ls = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x9aa4ae, transparent: true, opacity: 0.45, depthWrite: false, fog: false }));
    ls.frustumCulled = false; ls.visible = false; ls.renderOrder = 7; scene.add(ls);
    const d = []; const r = rng(4242);
    for (let i = 0; i < N; i++) d.push({ x: (r() - 0.5) * 60, y: r() * 40, z: (r() - 0.5) * 60 });
    return { ls, P, d };
  }
  function buildBolt() {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(24 * 6), 3).setUsage(THREE.DynamicDrawUsage));
    const ls = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xe8ecff, fog: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    ls.visible = false; ls.frustumCulled = false; scene.add(ls); return ls;
  }

  /* ---------------- battery ---------------- */
  const tels = {};                            // id → { obj, ud, queue:[], lastLaunch, reloading:{slot:until} }
  let gun = null, radar = null, radarDmg = 0;
  const ground = {};                          // FC, LA, CP, GEN
  let genPuff = 0, fcYaw = null;
  // rounds sealed inside capped canisters can't be seen: skip drawing them (~7k tris, ~40 draw calls per TEL)
  function hideCarried(obj) { obj.traverse(o => { if (o.parent && o.parent.name === 'canister' && /^missile_/.test(o.name)) o.visible = false; }); }
  function placeObj(obj, L) { obj.position.set(L.x, L.y, L.z); obj.rotation.y = yawFor(L.face); scene.add(obj); return obj; }
  /* ---------------- cold-launch smoke (grey gas → orange ignition → huge white cloud that rolls over the site) ---------------- */
  const thrown = [];                          // rounds between leaving the tube and hand-off: { m, t, ign (-1 = not lit), k }
  const _rnd = (a, b) => a + Math.random() * (b - a);
  const titleK = () => title.on ? 0.55 : 1;   // [v19] cover page: a smaller cloud so it doesn't white out the frame
  function ejectFx(P) {
    const tk = titleK();
    for (let i = 0; i < 16 * tk; i++) smoke.spawn(P.x + _rnd(-1.5, 1.5), P.y + _rnd(-2, 1), P.z + _rnd(-1.5, 1.5), _rnd(-3, 3), _rnd(4, 14), _rnd(-3, 3), FX.ejectGas, _rnd(0.7, 1.3));
    for (let i = 0; i < 22; i++) smoke.spawn(P.x, P.y + 1, P.z, _rnd(-9, 9), _rnd(14, 34), _rnd(-9, 9), FX.capBit, _rnd(0.6, 1.6));   // cover fragments spray up
    api.shake(0.18);
  }
  function igniteFx(P, k) {
    k *= titleK();
    burst(flare, { x: P.x, y: P.y, z: P.z, k: 1 }, FX.flash, 2, 0, 1.4 * k);
    burst(glow, { x: P.x, y: P.y - 2, z: P.z, k: 1 }, FX.ignCore, 3, 4, k);
    burst(glow, { x: P.x, y: P.y - 4, z: P.z, k: 1 }, FX.ignFire, 14, 18, k);
    pulseLight(P.x, P.y, P.z, 1.3 * k); api.shake(0.3 * k);
    grassGust = Math.max(grassGust, 2.5 * k * clamp(120 / Math.max(30, Math.hypot(P.x, P.z)), 0.3, 1));   // blast wind flattens the grass
    // exhaust slams into the ground and spreads out: the cloud that swallows the launcher site
    const g = heightAt(P.x, P.z);
    for (let i = 0; i < Math.round(34 * k); i++) {
      const a = Math.random() * 6.283, sp = _rnd(8, 26) * k, h = _rnd(0, 1) < 0.35 ? _rnd(0, P.y - g) : _rnd(0, 6);
      smoke.spawn(P.x + Math.cos(a) * _rnd(0, 6), g + 2 + h, P.z + Math.sin(a) * _rnd(0, 6), Math.cos(a) * sp, _rnd(-1, 5), Math.sin(a) * sp, FX.launchCloud, _rnd(0.7, 1.25) * k);
    }
  }
  function updateThrown(dt) {
    for (let i = thrown.length - 1; i >= 0; i--) {
      const th = thrown[i], m = th.m; th.t += dt;
      if (!m || !m.parent || th.t > 4) { thrown.splice(i, 1); continue; }
      m.updateMatrixWorld();
      const len = (m.userData.length || 6) * 0.5 + 0.4;
      _v.set(0, 0, -len).applyMatrix4(m.matrixWorld);
      if (th.ign < 0 && !th.second && th.t > 0.2) {             // second "thunk": the round clears the tube mouth
        th.second = true; const P0 = th.p0;
        for (let j = 0; j < 8; j++) smoke.spawn(P0.x + _rnd(-1, 1), P0.y + _rnd(0, 3), P0.z + _rnd(-1, 1), _rnd(-2, 2), _rnd(6, 16), _rnd(-2, 2), FX.ejectGas, _rnd(0.5, 0.9));
        api.shake(0.12);
      }
      // V1.4.3 perf: at most one emission per 1/60 s (a 120 Hz phone drew twice the smoke); slower frames never emit more than before
      th.acc = (th.acc || 0) + dt * 60;
      const ticks = th.acc >= 1 ? 1 : 0; if (ticks) th.acc = Math.min(th.acc - 1, 0.99);
      if (th.ign < 0) { for (let j = 0; j < 2 * ticks; j++) smoke.spawn(_v.x + _rnd(-0.6, 0.6), _v.y - _rnd(0, 1.5), _v.z + _rnd(-0.6, 0.6), _rnd(-1.5, 1.5), _rnd(-3, 1), _rnd(-1.5, 1.5), FX.throwTrail, _rnd(0.8, 1.2)); continue; }
      th.ign += dt;
      if (th.ign < 1.4) {                     // first ~1.4 s of burn: blinding plume pushed down onto the site
        for (let u = 0; u < ticks; u++) {
          glow.spawn(_v.x, _v.y, _v.z, 0, -6, 0, FX.ignFire, 0.8 * th.k);
          for (let j = 0; j < 2; j++) smoke.spawn(_v.x + _rnd(-2, 2), _v.y - _rnd(0, 4), _v.z + _rnd(-2, 2), _rnd(-6, 6), _rnd(-26, -10) * th.k, _rnd(-6, 6), FX.exhaust, _rnd(0.8, 1.3) * th.k);
        }
      }
    }
  }
  function buildBattery() {
    for (const id of ['L1', 'L2', 'L3']) {
      const L = LAYOUT[id];
      let obj = null;
      try { obj = models.create(L.kind, { state: 'ready', loaded: 4, idle: true, lod: L.lod }); } catch (e) { console.warn('scene: TEL build failed', e); }
      if (!obj || !obj.userData || typeof obj.userData.launch !== 'function') obj = models.create(L.kind, { placeholder: true });
      placeObj(obj, L);
      const ud = obj.userData;
      if (ud.update) { ud.fxParent = scene; if (ud.setState) ud.setState('ready'); }
      ud.onEvent = (name, data) => {
        const mm = data && data.missile;
        if (name === 'launch' && mm) {
          if (mm.children[0]) mm.children[0].visible = true;                  // round leaving the tube
          if (id === 'L3') { thrown.push({ m: mm, t: 0, ign: 0, k: 0.75 * titleK() }); igniteFx(mm.position, 0.75); }   // Dart: hot launch from the box
          else { ejectFx(mm.position); thrown.push({ m: mm, t: 0, ign: -1, k: titleK(), second: false, p0: mm.position.clone() }); }      // Lance: gas throw, no flame yet
        }
        if (name === 'ignite' && mm) {
          const th = thrown.find(q => q.m === mm);
          if (th && th.ign < 0) { th.ign = 0; igniteFx(mm.position, th.k / titleK()); }
          else if (!th) igniteFx(mm.position, 1);
        }
        if (name === 'reloaded') hideCarried(obj);
      };
      hideCarried(obj);
      tels[id] = { id, obj, ud, queue: [], lastLaunch: -9, reloading: {}, vendor: typeof ud.launch === 'function' };
    }
    gun = placeObj(models.create('gun_harrow'), LAYOUT.G1);
    gun.userData.aimB = LAYOUT.G1.face; gun.userData.aimE = 20;
    const mk = (id, fb) => { let o = null; try { o = models.create(LAYOUT[id].kind, { lod: LAYOUT[id].lod || 'high' }); } catch (e) { o = null; }
      return placeObj(o && o.userData && (o.userData.head || !fb) ? o : models.create(fb, { placeholder: true }), LAYOUT[id]); };
    radar = mk('RADAR', 'radar_vehicle');
    if (!radar.userData.head && radar.userData.dish) radar.userData.head = radar.userData.dish;   // placeholder fallback
    for (const id of ['FC', 'LA', 'CP', 'GEN']) ground[id] = mk(id, id === 'FC' || id === 'LA' ? 'radar_vehicle' : null);
  }

  /* ---------------- model cache (build each option set once, clone) ---------------- */
  const tpl = {};
  function cloneBare(o) {                   // Object3D.clone JSON-copies userData — strip it first (vendor userData holds closures/meshes)
    const saved = []; o.traverse(c => { saved.push([c, c.userData]); c.userData = {}; });
    const k = o.clone(true); saved.forEach(([c, u]) => { c.userData = u; }); return k;
  }
  const HOSTILE_VARIANTS = ['fighter', 'light', 'stealth'];
  function specFor(v) {
    switch (v.kind) {
      case 'jet_hostile': return { kind: 'jet_hostile', opts: { variant: HOSTILE_VARIANTS[idHash(v.id) % 3], loadout: 'strike' } };
      case 'strike_friend': return { kind: 'jet_friend', opts: { loadout: 'strike', lights: false } };
      case 'jet_friend': return { kind: 'jet_friend', opts: { loadout: 'cap', lights: false } };
      case 'transport': return { kind: 'transport', opts: { placeholder: true } };
      case 'helo_friend': case 'helo_hostile': return { kind: 'helo_attack', opts: { placeholder: true } };
      case 'cruise_missile': return { kind: 'cruise_missile', opts: {} };
      case 'arm_missile': return { kind: 'arm_missile', opts: {} };
      case 'missile_lance': case 'missile_dart': return { kind: v.kind, opts: { flight: true } };
      default: return { kind: 'drone', opts: { placeholder: true } };
    }
  }
  function makeModel(spec, lod) {
    if (lod === 'far') {                    // V1.4.3 perf: 2.5–4.5 km (2–5 px) — the ~110-tri primitive stand-in, not the 10–25k-tri low model
      const key = spec.kind + JSON.stringify(spec.opts || {}) + '|far';
      let t = tpl[key];
      if (!t) {
        t = tpl[key] = models.placeholder ? models.placeholder(spec.kind, {}) : models.create(spec.kind, { placeholder: true });   // vendor wrappers ignore opts.placeholder
        // same silhouette size as the model it stands in for (the primitive jet is ~14.6 m; the vendor jets are 20–26 m), so no size pop at the switch
        try {
          const size = o => new THREE.Box3().setFromObject(o).getSize(new V3()), a = size(makeModel(spec, 'low')), b = size(t);
          const k = Math.max(a.x, a.z) / Math.max(b.x, b.z);
          if (k > 0.5 && k < 4) t.scale.setScalar(k);
        } catch (e) { /* keep native size */ }
      }
      const o = cloneBare(t); o.userData = { nozzles: null, length: 10, rotor: null };
      return o;
    }
    const opts = Object.assign({}, spec.opts, { lod });
    const key = spec.kind + JSON.stringify(opts);
    if (spec.kind === 'jet_hostile') { try { return models.create('jet_hostile', opts); } catch (e) { return models.create('jet_hostile', { placeholder: true }); } }
    let t = tpl[key];
    if (!t) {
      try { t = models.create(spec.kind, opts); } catch (e) { t = null; }
      if (!t) t = models.create(spec.kind === 'arm_missile' || spec.kind === 'cruise_missile' ? spec.kind : 'drone', { placeholder: true });
      tpl[key] = t;
    }
    const o = cloneBare(t);
    o.userData = { nozzles: t.userData.nozzles, length: t.userData.length || 10, rotor: o.getObjectByName('rotor') };
    return o;
  }
  function prewarm() {
    const specs = [{ kind: 'jet_friend', opts: { loadout: 'cap', lights: false } }, { kind: 'jet_friend', opts: { loadout: 'strike', lights: false } },
      { kind: 'cruise_missile', opts: {} }, { kind: 'arm_missile', opts: {} }, { kind: 'transport', opts: { placeholder: true } },
      { kind: 'helo_attack', opts: { placeholder: true } }, { kind: 'drone', opts: { placeholder: true } }];
    const g = new THREE.Group(); g.position.set(0, -500, 0);
    for (const s of specs) for (const lod of ['high', 'low']) g.add(makeModel(s, lod));
    for (const v of HOSTILE_VARIANTS) for (const lod of ['high', 'low']) g.add(makeModel({ kind: 'jet_hostile', opts: { variant: v, loadout: 'strike' } }, lod));
    for (const k of ['missile_lance', 'missile_dart']) g.add(makeModel({ kind: k, opts: { flight: true } }, 'high'));
    scene.add(g);
    try { renderer.compile(scene, camera); } catch (e) { /* ignore */ }
    scene.remove(g);
  }

  /* ---------------- aircraft actors ---------------- */
  const actors = {};                         // entity id → { root, hi, lo, far, spec, useLo (false|true|'far'), prev:{hdg,alt,t}, bank, trailT }
  function actorFor(v) {
    let a = actors[v.id];
    if (a) return a;
    const spec = specFor(v), root = new THREE.Group();
    root.rotation.order = 'YXZ';
    a = actors[v.id] = { root, spec, hi: null, lo: null, far: null, useLo: null, bank: 0, pitch: 0, hdgPrev: v.hdg, altPrev: v.alt, trailT: 0, vy: 0, P: new V3(), t0: simT };
    scene.add(root);
    return a;
  }
  function setLod(a, lo) {                   // lo: false = high, true = low, 'far' = primitive stand-in (jets only)
    if (a.useLo === lo) return;
    a.useLo = lo;
    const key = lo === 'far' ? 'far' : lo ? 'lo' : 'hi';
    if (!a[key]) { a[key] = makeModel(a.spec, key === 'far' ? 'far' : lo ? 'low' : 'high'); a.root.add(a[key]); }
    if (a.hi) a.hi.visible = key === 'hi'; if (a.lo) a.lo.visible = key === 'lo'; if (a.far) a.far.visible = key === 'far';
  }
  const FAR_TIER = { jet_hostile: 1, jet_friend: 1 };   // the heavy vendor models (10–12k tris, up to 41 draws even at 'low')
  function removeActor(id) { const a = actors[id]; if (!a) return; scene.remove(a.root); delete actors[id]; }

  /* ---------------- missile flights (TEL launch → hand-off → follow sim missile) ---------------- */
  const flights = {};                        // missileId → { m, pos, vel, followed, blend, lostT, age, trailT, simP, simV, simPT }
  const queued = {};                         // missileId → launcherId (waiting for its TEL)
  function startFlight(id, m, pos, vel, own) {
    if (m.parent !== scene) scene.add(m);
    delete queued[id];
    flights[id] = { id, m, own: !!own, pos: pos.clone(), vel: vel.clone(), followed: false, blend: 0, lostT: 0, age: 0, trailT: 0, simP: null, simV: new V3(), simAt: 0 };
  }
  function endFlight(id, puff) {
    const f = flights[id]; if (!f) return;
    if (puff) { const p = { x: f.pos.x, y: f.pos.y, z: f.pos.z, k: 1 }; burst(flare, p, FX.flash, 1, 0, 0.3); burst(smoke, p, FX.grey, 5, 6); }
    if (f.m.parent) f.m.parent.remove(f.m);
    // vendor rounds build fresh plume geometry per missile (under the 'smoke' anchor); body parts are cached — keep those
    if (f.own) f.m.traverse(o => { if (o.name === 'smoke') o.traverse(c => { if (c.geometry) c.geometry.dispose(); }); });
    delete flights[id];
  }
  function launchFromTel(T, mid, state) {
    const ud = T.ud, simM = state && state.missiles ? state.missiles.find(m => m.id === mid) : null;
    const vis = state && state.visible ? state.visible.find(v => v.id === mid) : null;
    const hdg = simM && isFinite(simM.hdg) ? simM.hdg : (vis && isFinite(vis.hdg) ? vis.hdg : LAYOUT[T.id].face);
    // [RS] pitch-over target: the real elevation to the target (the sim climbs vertically, then turns toward it)
    const tgt = simM && state.tracks ? state.tracks.find(t => t.id === simM.targetId) : null;
    const el = tgt ? clamp(Math.atan2(tgt.alt, Math.max(1, tgt.rangeKm) * 1000), 0.05, 1.2) : 0.3;
    const dir = new V3(Math.sin(hdg * D2R) * Math.cos(el), Math.sin(el), -Math.cos(hdg * D2R) * Math.cos(el));
    const aim = titleAim[mid], tg = aim && title.ents.find(e => e.id === aim);
    if (tg) dir.set(tg.x * 1000 - T.obj.position.x, tg.alt - T.obj.position.y, -tg.y * 1000 - T.obj.position.z).normalize();
    // the scene TELs don't sit exactly where the sim puts its launchers; carry that offset and bleed it off in flight
    const off = simM ? new V3(T.obj.position.x - simM.x * 1000, 0, T.obj.position.z + simM.y * 1000) : null;
    let m = null;
    if (T.vendor) m = ud.launch(null, { dir, handoffAt: 2.6, onHandoff: d => { startFlight(mid, d.missile, d.position, d.velocity, true); if (off && flights[mid]) flights[mid].off = off; if (aim && flights[mid]) flights[mid].aim = aim; } });
    if (aim) titleM[mid] = m || null;
    T.lastLaunch = time;
    api.shake(clamp(30 / LAYOUT[T.id].dist, 0.12, 0.35));
    if (!m) {                                 // no round on the rails (desync) — fly a fresh one from the launcher
      const kind = T.id === 'L3' ? 'missile_dart' : 'missile_lance';
      const mm = makeModel({ kind, opts: { flight: true } }, 'high'), P = T.obj.position.clone(); P.y += 6;
      startFlight(mid, mm, P, dir.clone().multiplyScalar(120)); if (aim) flights[mid].aim = aim;
      burst(smoke, { x: P.x, y: P.y, z: P.z, k: 1 }, FX.grey, 10, 8);
    }
  }
  const _m1 = new THREE.Vector3(), _m2 = new THREE.Vector3(), _m3 = new THREE.Vector3(), _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e1 = new THREE.Euler();
  function updateFlight(f, v, dt) {
    f.age += dt;
    if (v) {
      const P = _w.set(v.x * 1000, v.alt, -v.y * 1000);
      if (f.off) { P.add(f.off); f.off.multiplyScalar(Math.exp(-dt / 6)); }
      if (!f.simP) { f.simP = P.clone(); f.simAt = simT; }
      else if (simT !== f.simAt && !P.equals(f.simP)) {
        const dtS = Math.max(0.02, simT - f.simAt);
        f.simV.subVectors(P, f.simP).divideScalar(dtS); f.simP.copy(P); f.simAt = simT;
      }
      if (!f.followed) { f.followed = true; f.blend = 0; }
      f.blend = Math.min(1, f.blend + dt / 1.2);   // [RS] gentle hand-over from the launch animation to the sim track
      const pred = _v.copy(f.simP).addScaledVector(f.simV, Math.min(simAge, 0.12));
      f.pos.addScaledVector(f.vel, dt);
      const k = f.blend < 1 ? f.blend * f.blend : 1 - Math.exp(-14 * dt);
      f.pos.lerp(pred, Math.max(k, f.blend >= 1 ? 0.35 : 0));
      if (f.simV.lengthSq() > 1) f.vel.lerp(f.simV, 1 - Math.exp(-6 * dt));
      f.lostT = 0;
      // V1.2.1: never below the terrain (sim altitudes are above sea level; the hills here reach ~250 m)
      if (f.age > 1.2) { const gy = heightAt(f.pos.x, f.pos.z) + 12; if (f.pos.y < gy) { f.pos.y = gy; if (f.vel.y < 0) f.vel.y *= 0.2; } }
    } else if (f.aim) {                      // [v19] cover-page round: steer at its fake target, burst on arrival
      const tg = title.ents.find(e => e.id === f.aim);
      if (!tg || f.age > 16) { endFlight(f.id, true); return; }
      _w.set(tg.x * 1000, tg.alt, -tg.y * 1000);
      const sp = Math.min(1500, f.vel.length() + 240 * dt);
      _v.subVectors(_w, f.pos); const d = _v.length();
      f.vel.normalize().lerp(_v.normalize(), 1 - Math.exp(-dt * 2.2)).normalize().multiplyScalar(sp);
      if (d < Math.max(90, sp * dt * 1.5)) { titleKill(tg); endFlight(f.id, false); return; }
      f.pos.addScaledVector(f.vel, dt);
    } else {
      f.vel.addScaledVector(_v.copy(f.vel).normalize(), 60 * dt);
      f.pos.addScaledVector(f.vel, dt);
      f.lostT += dt;
      const lim = f.followed ? 1.5 : 6;
      const s = clamp(1 - (f.lostT - lim + 1) / 1, 0, 1);
      if (f.lostT > lim) { endFlight(f.id, false); return; }
      if (f.m.userData.setMotor && f.lostT > lim - 0.5) f.m.userData.setMotor(false);
      f.m.scale.setScalar(Math.max(0.01, s));
    }
    // V1.2.2 maneuvering: the body leads the velocity into a turn (angle of attack), lags a touch, banks with the
    // turn and hunts slightly (guidance jitter). Hard pulls (sim m.g) throw off vapour.
    if (v && typeof v.g === 'number') f.g = v.g;
    const guided = f.followed && f.age > 1.6;
    if (guided) {                                   // guidance jitter: small lateral wander (visible in the follow cam)
      if (f.jit === undefined) f.jit = Math.random() * 100;
      const jt = time * 2.3 + f.jit, amp = 1.4 + Math.min(2, (f.g || 0) * 0.05);
      _m1.set(Math.sin(jt) + 0.5 * Math.sin(jt * 2.7 + 1.3), 0.6 * Math.sin(jt * 1.9 + 2.1), 0);
      f.m.position.copy(f.pos).addScaledVector(_m1.applyQuaternion(f.m.quaternion), amp);
    } else f.m.position.copy(f.pos);
    if (f.vel.lengthSq() > 1) {
      const dir = _v.copy(f.vel).normalize();
      if (!f.dPrev) { f.dPrev = dir.clone(); f.q = new THREE.Quaternion().setFromUnitVectors(_Z, dir); f.roll = 0; }
      const lat = _m2.subVectors(dir, f.dPrev), rate = dt > 0 ? lat.length() / dt : 0;       // rad/s turn rate
      const aoa = Math.min(0.14, rate * 0.35);
      if (lat.lengthSq() > 1e-10) lat.normalize();
      const look = _m3.copy(dir).addScaledVector(lat, Math.tan(aoa)).normalize();
      _q1.setFromUnitVectors(_Z, look);
      f.q.slerp(_q1, guided ? 1 - Math.exp(-dt / 0.09) : 1);
      const yawRate = (f.dPrev.x * dir.z - f.dPrev.z * dir.x) / Math.max(dt, 1e-3);          // signed turn about world up
      const rollT = guided ? clamp(-yawRate * 1.6, -0.9, 0.9) + (f.jit !== undefined ? 0.05 * Math.sin(time * 3.1 + f.jit) : 0) : 0;
      f.roll += (rollT - f.roll) * (1 - Math.exp(-dt / 0.22));
      f.m.quaternion.copy(f.q).multiply(_q2.setFromAxisAngle(_Z, f.roll));
      if (guided) f.m.quaternion.multiply(_q2.setFromEuler(_e1.set(0.012 * Math.sin(time * 5.3 + f.jit), 0.015 * Math.sin(time * 4.1 + f.jit * 1.7), 0)));
      f.dPrev.copy(dir);
    }
    const inEO = eoSees(f.pos.x, f.pos.y, f.pos.z);   // V1.3: the tracker is looking at this round
    // vapour: from ~12 G, more and bigger the harder it pulls
    if (f.g > 12 && (inEO || camera.position.distanceTo(f.pos) < 3000) && Math.random() < dt * (f.g - 8) * 1.4) {
      const r = (f.m.userData.length || 6) * 0.3;
      _m1.set((Math.random() - 0.5) * r, (Math.random() - 0.5) * r, (Math.random() - 0.3) * r * 2).applyQuaternion(f.m.quaternion).add(f.m.position);
      smoke.spawn(_m1.x, _m1.y, _m1.z, f.vel.x * 0.02, f.vel.y * 0.02, f.vel.z * 0.02, FX.vapor, Math.min(2.2, 0.6 + f.g / 30));
    }
    if (f.m.userData.update) f.m.userData.update(dt);
    // trail + motor glow at the tail
    const len = (f.m.userData.length || 6) * 0.5 + 0.6;
    _v.set(0, 0, -len).applyQuaternion(f.m.quaternion).add(f.m.position);
    // [RS] motor burnout (sim: Lance ~12.5 s, Dart ~5.8 s after launch): flame out, no new smoke; the old trail drifts away
    const lit = !(v && v.burning === false && f.own && f.age > 1);
    if (!lit && !f.out) { f.out = true; if (f.m.userData.setMotor) f.m.userData.setMotor(false); }
    if (lit && f.lostT < 0.8) glow.spawn(_v.x, _v.y, _v.z, 0, 0, 0, FX.motor, 1);
    // puffs every ~6 m along the path, interpolated back to last frame's tail so low frame rates don't leave gaps
    if (!f.tail) f.tail = _v.clone();
    // far rounds (v1.1: own missiles stay in state.visible at any range) thin their trail; beyond visual range, none
    // V1.3: in the EO's view the trail is dense enough for the zoomed frame, and drawn for the EO alone beyond visual range
    const dc = f.pos.distanceTo(camera.position), seg = _w.subVectors(_v, f.tail), segL = seg.length(), vm = visM();
    const step = inEO ? eoStep(f.pos) : (f.aim ? 11 : 6) * Math.max(1, dc / 2500);
    if (f.lostT < 1 && lit && (dc < vm || inEO)) {
      let s = f.trailT;
      LAY = dc < vm ? 0 : 2;
      for (; s < segL && s < 400; s += step) {
        const k = s / segL;
        smoke.spawn(f.tail.x + seg.x * k + (Math.random() - 0.5), f.tail.y + seg.y * k + (Math.random() - 0.5), f.tail.z + seg.z * k + (Math.random() - 0.5), (Math.random() - 0.5) * 1.5, 0.3, (Math.random() - 0.5) * 1.5, FX.trail, 1);
      }
      LAY = 0;
      f.trailT = Math.max(0, s - segL);
    }
    f.tail.copy(_v);
  }

  /* ---------------- debris pool ---------------- */
  const debris = [];
  function setLayer(o, n) { o.layers.set(n); for (let i = 0; i < o.children.length; i++) setLayer(o.children[i], n); }
  function spawnDebris(p, n) {
    for (let i = 0; i < n; i++) {
      const d = debris.find(x => !x.on); if (!d) return;
      d.on = true; d.t = 0; d.o.visible = true; d.o.position.set(p.x, p.y, p.z);
      d.v.set((Math.random() - 0.5) * 60, Math.random() * 25, (Math.random() - 0.5) * 60).multiplyScalar(p.k);
      d.w.set(Math.random() * 4, Math.random() * 4, Math.random() * 4); d.k = p.k; d.o.scale.setScalar(1.4 * p.k);
      if (d.lay !== LAY) { d.lay = LAY; setLayer(d.o, LAY); }   // V1.3: object layer 1 = hatch camera only, 2 = EO only
    }
  }
  function updateDebris(dt) {
    for (const d of debris) {
      if (!d.on) continue;
      d.t += dt; d.v.y -= 9.8 * dt * d.k; d.v.multiplyScalar(1 - 0.12 * dt);
      d.o.position.addScaledVector(d.v, dt);
      d.o.rotation.x += d.w.x * dt; d.o.rotation.y += d.w.y * dt;
      const p = d.o.position;
      LAY = d.lay || 0;
      if (Math.random() < dt * 22) glow.spawn(p.x, p.y, p.z, 0, 2, 0, FX.fire, d.k * 0.5);
      if (Math.random() < dt * 14) smoke.spawn(p.x, p.y, p.z, 0, 1, 0, FX.dark, d.k * 0.4);
      if (d.t > 16 || p.y < heightAt(p.x, p.z)) { d.on = false; d.o.visible = false; }
    }
    LAY = 0;
  }

  /* ---------------- persistent emitters (ARM smoke, asset column, burning wrecks) ---------------- */
  const emitters = [];                       // { x,y,z, until, rate, o, k, acc }
  function addEmitter(x, y, z, dur, rate, o, k) { if (emitters.length > 12) emitters.shift(); emitters.push({ x, y, z, until: time + dur, rate, o, k, acc: 0 }); }

  /* ---------------- radars: search AESA follows the sim sweep; FC PESA scans, then slews to the engaged target; low-alt tower spins ---------------- */
  function turnTo(o, want, rate, dt) {
    const d = Math.atan2(Math.sin(want - o.rotation.y), Math.cos(want - o.rotation.y));
    o.rotation.y += clamp(d, -rate * dt, rate * dt);
  }
  function updateRadars(dt, state) {
    const on = !!(state && state.radar && state.radar.on && radarOn), dead = radarDmg >= 0.5;
    const rh = radar && radar.userData.head;
    if (rh) {
      if (dead) rh.rotation.z = Math.min(0.5, rh.rotation.z + dt * 0.8);          // ARM hit: the array droops and stops
      else if (on) rh.rotation.y = yawFor(state.radar.sweepDeg) - radar.rotation.y;
    }
    const fc = ground.FC, fh = fc && fc.userData.head;
    if (fh && on) {
      // engaged target: the newest missile in flight, else any launcher's assigned track
      let tid = null;
      const ms = state.missiles || [];
      if (ms.length) tid = ms[ms.length - 1].targetId;
      else for (const L of (state.battery && state.battery.launchers) || []) if (L.assignedTrack) { tid = L.assignedTrack; break; }
      const tr = tid && state.tracks ? state.tracks.find(t => t.id === tid) : null;
      if (tr && isFinite(tr.bearingDeg)) turnTo(fh, yawFor(tr.bearingDeg) - fc.rotation.y, 1.6, dt);   // slew and hold on the target
      else fh.rotation.y += 0.55 * dt;                                                                  // idle: slow search rotation
    }
    const la = ground.LA, lh = la && la.userData.head;
    if (lh && on) lh.rotation.y += 1.15 * dt;                                         // ~5.5 s per turn
    if (gun && gun.userData.searchRadar) gun.userData.searchRadar.rotation.y += 2.1 * dt;   // the gun's own radar, always on
    for (const id in ground) { const u = ground[id].userData; if (u && u.update) u.update(dt); }
    // generator exhaust: a thin grey trickle
    const ex = ground.GEN && ground.GEN.userData.exhaust;
    if (ex && (genPuff -= dt) <= 0) { genPuff = 0.35 + Math.random() * 0.3; ex.getWorldPosition(_v); smoke.spawn(_v.x, _v.y + 0.3, _v.z, 0.3 + Math.random() * 0.4, 1.2, (Math.random() - 0.5) * 0.4, FX.grey, 0.22); }
  }

  /* ---------------- gun ---------------- */
  let gunFire = 0, gunTr = 0, gunEvt = null;
  function updateGun(dt, state) {
    const gd = gun.userData, st = state && state.gun;
    if (gunEvt) { gd.aimB = gunEvt.b; gd.aimE = gunEvt.e; }
    else if (st && st.firing && isFinite(st.bearingDeg)) { gd.aimB = st.bearingDeg; gd.aimE = st.elevDeg; }
    // slew turret (90°/s) and barrels (60°/s)
    const wantY = yawFor(gd.aimB) - gun.rotation.y, t = gd.turret, e = gd.elevator;
    let dy = Math.atan2(Math.sin(wantY - t.rotation.y), Math.cos(wantY - t.rotation.y));
    t.rotation.y += clamp(dy, -1.6 * dt, 1.6 * dt);
    const wantX = -clamp(gd.aimE, -2, 85) * D2R;
    e.rotation.x += clamp(wantX - e.rotation.x, -1.05 * dt, 1.05 * dt);
    if (gunFire <= 0) { gunEvt = null; return; }
    gunFire -= dt; gunTr -= dt;
    const rail = gd.rails[(time * 20 | 0) % gd.rails.length]; rail.getWorldPosition(_v);
    if (Math.random() < 0.7) glow.spawn(_v.x, _v.y, _v.z, 0, 0, 0, FX.muzzle, 1 + Math.random());
    pulseLight(_v.x, _v.y + 1, _v.z, 0.25);
    while (gunTr <= 0) {
      gunTr += 0.05;
      const tr = tracers.list[tracers.i]; tracers.i = (tracers.i + 1) % TR_N;
      _w.set(0, 0, 1).transformDirection(rail.matrixWorld);
      _w.x += (Math.random() - 0.5) * 0.012; _w.y += (Math.random() - 0.5) * 0.012; _w.z += (Math.random() - 0.5) * 0.012;
      tr.on = true; tr.age = Math.random() * 0.05; tr.p.copy(_v); tr.v.copy(_w.normalize()).multiplyScalar(1050);
      if (Math.random() < 0.3) smoke.spawn(_v.x, _v.y, _v.z, _w.x * 4, 1, _w.z * 4, FX.grey, 0.35);
    }
  }

  /* ---------------- environment: time of day × sky (clear / overcast / rain), visual range ---------------- */
  // top/mid/hor sky gradient, fog colour + near/far, hemi sky/ground/intensity, sun colour/intensity/position.
  // glow/sb/se: a sun disc + warm bloom at bearing sb, elevation se (dawn, cover page)
  const PRESETS = {
    dawn: { top: 0x24386a, mid: 0x8a7ca6, hor: 0xf2a27a, fog: 0xc0a0a0, fn: 1300, ff: 6400, hs: 0xb4aed0, hg: 0x3a3226, hi: 0.72, sc: 0xffb888, si: 1.0, sp: [0, 0, 0], stars: 0.12, moon: 0, glow: 0xffc080, sb: 52, se: 3.4, sun: 0.8 },
    day: { top: 0x3f74b0, mid: 0x86aed2, hor: 0xcdd9e2, fog: 0xb3c2d0, fn: 1600, ff: 7200, hs: 0xc4d6ee, hg: 0x3e3b2a, hi: 0.85, sc: 0xfff3e2, si: 1.05, sp: [-1500, 3200, 1200], stars: 0, moon: 0 },
    dusk: { top: 0x0e1830, mid: 0x4a3a4c, hor: 0xc0643a, fog: 0x8a5a4a, fn: 1200, ff: 5200, hs: 0x8a90b0, hg: 0x2a2618, hi: 0.75, sc: 0xffc49a, si: 0.9, sp: [-3000, 1200, 2000], stars: 0, moon: 0 },
    // [v19] cover page: crimson dusk, sun sitting on the horizon behind the battery (bearing sb, elevation se)
    ember: { top: 0x0a0816, mid: 0x3c1626, hor: 0xe0482a, fog: 0x6e2c24, fn: 700, ff: 5200, hs: 0x8a6a80, hg: 0x2a1812, hi: 0.62, sc: 0xff9a60, si: 0.85, sp: [0, 0, 0], stars: 0.35, moon: 0, glow: 0xffa050, sb: 22, se: 2.2, sun: 1 },
    night: { top: 0x02040b, mid: 0x060a16, hor: 0x121a2a, fog: 0x0b1019, fn: 700, ff: 4600, hs: 0x2a3a58, hg: 0x06070a, hi: 0.32, sc: 0x9fb4d8, si: 0.28, sp: [2500, 3000, -3500], stars: 1, moon: 1 }
  };
  // overcast deck greys (top, mid, horizon, fog) scaled by how much light gets through at each time of day
  const OVC = [0x6e7780, 0x8a9199, 0xa2a8ae, 0x979ea4], OVC_L = { dawn: 0.62, day: 1, dusk: 0.5, night: 0.1 };
  const VIS_KM = { clear: 15, overcast: 11, rain: 6 };
  const env = { time: 'dusk', sky: 'clear', weather: 'clear', visKm: 0, evNight: false, evStorm: false, cur: null, lightning: 0, nextBolt: 6, wt: undefined, ws: undefined, wv: undefined };
  const _c1 = new THREE.Color(), _c2 = new THREE.Color();
  function applyEnv() {
    const night = env.evNight || env.time === 'night', storm = env.evStorm || env.weather === 'storm';
    const sky = title.on ? 'clear' : storm ? 'rain' : env.sky, time = night ? 'night' : env.time;
    const P = title.on ? PRESETS.ember : PRESETS[time] || PRESETS.dusk, C = h => new THREE.Color(h);
    const ovc = sky !== 'clear', wet = sky === 'rain';
    // visual range: clear 15, overcast 11, rain 6 km; night halves it (min 3). The sim's state.weather.visKm already folds in the
    // storm/night events, so take the smaller of the two (a scene-only event still closes the haze in)
    const visCalc = Math.max(3, VIS_KM[sky] * (night ? 0.5 : 1)), visKm = env.visKm > 0 ? Math.min(env.visKm, visCalc) : visCalc;
    smokeLight = title.on ? 0.5 : (night ? 0.3 : time === 'day' ? 1 : time === 'dawn' ? 0.9 : 0.85) * (wet ? 0.72 : ovc ? 0.86 : 1);
    const top = C(P.top), mid = C(P.mid), hor = C(P.hor), fog = C(P.fog);
    let fn = P.fn, ff = P.ff, hi = P.hi, si = P.si;
    if (ovc) {
      const L = (OVC_L[time] || 0.5) * (wet ? 0.68 : 1) * (storm ? 0.85 : 1), k = wet ? 0.93 : 0.85;
      [top, mid, hor, fog].forEach((c, i) => c.lerp(_c1.set(OVC[i]).multiplyScalar(L), k));
      hor.lerp(fog, time !== 'night' ? 0.8 : 0.5);                       // a flat, featureless horizon haze under the deck
      hi = P.hi * (wet ? 0.8 : 1.12) * (time === 'night' ? 0.8 : 1); si = P.si * (wet ? 0.18 : 0.3);   // flat light: sky fill, a weak diffuse sun
      fn = wet ? 120 : P.fn * 0.75; ff = Math.min(wet ? 1e9 : P.ff, visKm * 1000 * (wet ? 0.72 : 0.62));
    } else ff = Math.min(ff, visKm * 1000);
    const pos = skyGeo.attributes.position, col = skyGeo.attributes.color, c = _c2;
    const glowC = P.glow && !ovc ? C(P.glow) : null, [gx, gz] = dirOf(P.sb || 0);
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 9500;
      if (y > 0.25) c.copy(mid).lerp(top, Math.min(1, (y - 0.25) / 0.5)); else c.copy(hor).lerp(mid, Math.max(0, y / 0.25));
      if (y < 0) c.copy(hor).lerp(fog, Math.min(1, -y * 4));
      if (glowC) {                              // warm bloom toward the sun, strongest on the horizon
        const l = Math.hypot(pos.getX(i), pos.getZ(i)) || 1;
        const d = Math.max(0, (pos.getX(i) * gx + pos.getZ(i) * gz) / l), k = Math.pow(d, 5) * Math.max(0, 1 - Math.abs(y) * 2.6);
        c.lerp(glowC, Math.min(0.85, k));
      }
      col.setXYZ(i, c.r, c.g, c.b);
    }
    col.needsUpdate = true;
    scene.fog.color.copy(fog); renderer.setClearColor(fog);
    U.fogColor.value.copy(fog);
    hemi.color.set(P.hs); hemi.groundColor.set(P.hg); hemi.intensity = hi;
    sun.color.set(P.sc); sun.intensity = si; sun.position.set(P.sp[0], P.sp[1], P.sp[2]);
    if (ovc) { hemi.color.lerp(_c1.set(0xc8ccd2).multiplyScalar(OVC_L[time] > 0.3 ? 1 : 0.4), 0.7); sun.color.lerp(_c1.set(0xdfe3e8), 0.8); }
    if (P.sb !== undefined) {                     // sun from bearing/elevation; the disc sits on the horizon
      const [sx, sz] = dirOf(P.sb), ce = Math.cos(P.se * D2R), se = Math.sin(P.se * D2R);
      sun.position.set(sx * 3000, 3000 * Math.max(0.08, se), sz * 3000);
      sunSpr.position.set(sx * 8800 * ce, 8800 * se, sz * 8800 * ce); sunHalo.position.copy(sunSpr.position);
      sunSpr.material.opacity = sunHalo.material.opacity = P.sun || 1;
    }
    sunSpr.visible = sunHalo.visible = !!glowC;
    stars.visible = P.stars > 0 && !ovc; stars.material.opacity = P.stars * 0.85;
    moon.visible = !!P.moon && !ovc;
    rain.ls.visible = wet;
    rain.ls.material.opacity = night ? 0.3 : 0.42;
    // wet ground: darker, a touch cooler; the grass too
    // overcast: the flat light mutes the straw a little
    const wk = wet ? 0.6 : ovc ? 0.9 : 1, wb = wet ? 0.7 : ovc ? 0.92 : 1;
    terrainMat.color.setRGB(wk, wk, wb);
    if (farGround) farGround.mat.color.setRGB(wk, wk, wb);
    for (const L of grassLayers) L.mesh.material.color.setRGB(wet ? 0.58 : ovc ? 0.84 : 1, wet ? 0.6 : ovc ? 0.84 : 1, wet ? 0.56 : ovc ? 0.84 : 1);
    if (cloudDeck) {                              // the deck's underside: a shade darker than the sky overhead
      cloudDeck.visible = ovc;
      cloudDeck.material.color.copy(mid).lerp(top, 0.3).multiplyScalar(wet ? 1.12 : 1.22);
    }
    workLight.intensity = night ? 0.55 : 0;
    env.cur = { night, storm, wet, overcast: ovc, time, sky, visKm, hi, fn, ff, skyMul: 1, sky4: [top, mid, hor, fog] };   // sky4: EO fog matches the dome
    fogK = -1; fogFor(chase.fog);
  }
  // fog distances; k = chase-camera blend (the chase view opens the haze out toward the full visual range)
  let fogK = -1;
  const visM = () => (env.cur ? env.cur.visKm : 15) * 1000;
  function fogFor(k) {
    const E = env.cur; if (!E || k === fogK) return;
    fogK = k;
    // up high the air below is thinner than the ground-level haze: let the ground show through out to ~1.6× visual range
    const ffC = Math.max(E.ff, Math.min(28000, E.visKm * 1000 * 1.6)), fnC = Math.max(E.fn, ffC * 0.1);
    const fn = E.fn + (fnC - E.fn) * k, ff = E.ff + (ffC - E.ff) * k;
    scene.fog.near = fn; scene.fog.far = ff; U.fogNear.value = fn; U.fogFar.value = ff;
  }
  function updateEnv(dt) {
    const E = env.cur; if (!E) return;
    if (E.wet) {
      // rain streaks in a box ahead of the camera, slanted by the wind
      const R = rain, c = camera.position;
      camera.getWorldDirection(_w); const cx = c.x + _w.x * 30, cz = c.z + _w.z * 30, fall = E.storm ? 30 : 26;
      for (let i = 0; i < R.d.length; i++) {
        const d = R.d[i]; d.y -= fall * dt; if (d.y < -3) d.y += 40;
        const x = cx + d.x, y = c.y + d.y, z = cz + d.z, o = i * 6;
        R.P[o] = x; R.P[o + 1] = y; R.P[o + 2] = z; R.P[o + 3] = x + 0.3; R.P[o + 4] = y + 1.7; R.P[o + 5] = z + 0.1;
      }
      R.ls.geometry.attributes.position.needsUpdate = true;
    }
    if (E.storm) {
      env.nextBolt -= dt;
      if (env.nextBolt <= 0) {
        env.nextBolt = 5 + Math.random() * 10; env.lightning = 0.55;
        const b = VIEW_BRG + (Math.random() - 0.5) * 60, r = 2000 + Math.random() * 2500, [bx, bz] = dirOf(b);
        const P = bolt.geometry.attributes.position; let x = bx * r, y = 1400, z = bz * r;
        for (let i = 0; i < 24; i++) {
          const nx = x + (Math.random() - 0.5) * 140, ny = y - 1400 / 24 - heightAt(x, z) / 24, nz = z + (Math.random() - 0.5) * 140;
          P.setXYZ(i * 2, x, y, z); P.setXYZ(i * 2 + 1, nx, ny, nz); x = nx; y = ny; z = nz;
        }
        P.needsUpdate = true;
      }
    }
    if (env.lightning > 0) env.lightning -= dt;
    const L = env.lightning > 0 && (env.lightning > 0.42 || (env.lightning > 0.2 && env.lightning < 0.3));
    bolt.visible = L;
    hemi.intensity = E.hi + (L ? 1.6 : 0);
    skyMesh.material.color.setScalar(L ? 2.2 : 1);
  }
  // ShiftDef.weather / state.weather → env (time, sky, visKm)
  function envFromWeather(w) {
    w = w || {};
    env.time = PRESETS[w.time] && w.time !== 'ember' ? w.time : 'dusk';
    env.sky = VIS_KM[w.sky] ? w.sky : 'clear';
    env.weather = 'clear'; env.visKm = isFinite(w.visKm) && w.visKm > 0 ? +w.visKm : 0;
  }

  /* ---------------- bus hookup ---------------- */
  let shakeT = 0;
  function onBus() {
    const on = (n, f) => RS.bus.on(n, f);
    on('LAUNCH', p => {
      const T = tels[p.launcherId]; if (!T) return;
      T.queue.push(p.missileId); queued[p.missileId] = p.launcherId;
    });
    on('INTERCEPT', p => {
      if (chase.id === p.missileId && chase.mode === 'follow' && flights[p.missileId]) { chase.last.set(p.x * 1000, p.alt, -p.y * 1000); chase.burst = true; }
      endFlight(p.missileId, false);
      const q = fxAt(p.x * 1000, p.alt, -p.y * 1000, q => {
        burst(flare, q, FX.flash, 2, 0, 1); burst(glow, q, FX.ball, 6, 25, 0.8); burst(glow, q, FX.ember, 14, 120, 1.5); burst(smoke, q, FX.puffBig, 6, 14, 0.7);
      });
      pulseLight(q.x, q.y, q.z, 1);
    });
    on('KILL', p => {
      const q = fxAt(p.x * 1000, p.alt, -p.y * 1000, q => {
        burst(flare, q, FX.flash, 1, 0, 1.6); burst(glow, q, FX.ball, 16, 40, 1.3); burst(glow, q, FX.ember, 24, 160, 1.6);
        burst(smoke, q, FX.puffBig, 12, 22, 1); spawnDebris(q, 4);
      });
      pulseLight(q.x, q.y, q.z, 1.2);
      if (q.d < 3000) api.shake(0.3 * (1 - q.d / 3000));
      eoEvent('KILL', p);
    });
    on('MISS', p => { endFlight(p.missileId, true); eoEvent('MISS', p); });
    on('TRACK_LOST', p => eoEvent('LOST', p));
    on('RELOAD_START', p => {                // first canister swap starts now; the rest follow the sim's reload timer
      const T = tels[p.launcherId]; if (!T || !T.vendor) return;
      T.reloadDur = p.seconds;
      const i = T.ud.slots.findIndex(s => !s.loaded && !s.busy);
      if (i >= 0 && T.ud.reload(i) > 0) { T.reloading[i] = time + 2.5; T.nextReload = time + 1; }
    });
    on('GUN_FIRE', p => {
      gunFire = Math.max(gunFire, 1.5 * (p.rounds > 250 ? 2 : 1)); gunTr = 0;
      if (isFinite(p.bearingDeg)) gunEvt = { b: p.bearingDeg, e: isFinite(p.elevDeg) ? p.elevDeg : 20 };
    });
    on('ARM_IMPACT', p => {
      const L = LAYOUT.RADAR, q = { x: L.x, y: L.y + 10, z: L.z, k: 1 }, dmg = isFinite(p.damage) ? p.damage : 1;
      burst(flare, q, FX.flash, 3, 0, 1.2); burst(glow, q, FX.fire, 40, 45, 1.3); burst(smoke, q, FX.dark, 20, 25, 0.8);
      spawnDebris(q, 5); pulseLight(q.x, q.y, q.z, 2); api.shake(0.85);
      radarDmg = Math.max(radarDmg, dmg); addEmitter(L.x, L.y + 4, L.z, 45, 5, FX.dark, 0.6);
    });
    on('ASSET_HIT', p => {
      const x = ASSET_VIEW.x, z = ASSET_VIEW.z, y = heightAt(x, z) + 20, q = fxPos(x, y, z);
      burst(flare, q, FX.flash, 2, 0, 3); burst(glow, q, FX.fire, 20, 60, 3); pulseLight(x, y + 50, z, 1.5);
      addEmitter(x, y, z, 70, 2.2 + 3 * (p.damage || 0.3), FX.column, 1);
    });
    on('RANDOM_EVENT', p => {
      if (p.kind === 'night') { env.evNight = !!p.active; applyEnv(); }
      if (p.kind === 'storm') { env.evStorm = !!p.active; applyEnv(); }
    });
    on('RADAR_STATE', p => { radarOn = !!p.on; });
    on('SHIFT_END', () => { if (chase.mode) chaseReset(); });   // debrief: back in the shelter at once
    on('SHIFT_START', p => {
      for (const id in actors) removeActor(id);
      for (const id in flights) endFlight(id, false);
      for (const id in queued) delete queued[id];
      for (const id in tels) tels[id].queue.length = 0;
      emitters.length = 0; radarDmg = 0; gunFire = 0; env.evNight = env.evStorm = false;
      envFromWeather(p && p.def && p.def.weather); env.wt = env.ws = env.wv = undefined; chaseReset(); applyEnv();
      eoReset();
    });
  }
  let radarOn = true;

  /* ---------------- per-frame battery upkeep ---------------- */
  function updateBattery(dt, state) {
    const bl = state && state.battery && state.battery.launchers;
    for (const id in tels) {
      const T = tels[id], ud = T.ud;
      if (ud.update) ud.update(dt);
      if (!T.vendor) { if (T.queue.length) launchFromTel(T, T.queue.shift(), state); continue; }
      // queued launches: one at a time, 1.3 s apart, onto a loaded idle slot (wait for a canister swap in progress)
      if (T.queue.length && time - T.lastLaunch > 1.3) {
        const free = ud.slots.some(s => s.loaded && !s.busy), swapping = Object.keys(T.reloading).some(k => T.reloading[k] > time);
        if (free || !swapping || time - T.lastLaunch > 6) launchFromTel(T, T.queue.shift(), state);
      }
      // canister count follows the sim's rounds
      const L = bl && bl.find(l => l.id === id);
      if (L && !T.queue.length && time - T.lastLaunch > 3) {
        const slots = ud.slots; let have = 0, want = L.rounds;
        slots.forEach((s, i) => { if (s.loaded || T.reloading[i] > time) have++; });
        // sim reload in progress: swap canisters in step with its progress (they finish as the sim's timer runs out)
        if (L.reloadT > 0) { const tot = L.reloadTotal || T.reloadDur || 20; want = Math.max(want, Math.min(L.max || 4, Math.ceil(4 * clamp(1 - (L.reloadT - 2.5) / tot, 0, 1)))); }
        if (have < want && (T.nextReload || 0) <= time) {
          const i = slots.findIndex(s => !s.loaded && !s.busy);
          if (i >= 0 && ud.reload(i) > 0) { T.reloading[i] = time + 2.5; T.nextReload = time + (L.reloadT > 0 ? 0.8 : 0.6); }
        }
      }
    }
  }

  /* ---------------- [v19] cover page: cinematic camera, fake sky traffic, show launches ---------------- */
  const title = { on: false, t: 0, ents: [], n: 0, seq: 0, fov: 0 };
  const titleAim = {}, titleM = {};
  // camera: low in the grass south-west of the site, looking NNE into the sun past the launchers; slow lateral drift
  const TCAM = { x: -38, z: 22, y: 1.1, brg: 24, pitch: 11 };
  function titleCam(sh1, sh2) {
    const t = title.t, drift = Math.sin(t * 0.045) * 9, rise = Math.sin(t * 0.07) * 0.35, [rx, rz] = dirOf(TCAM.brg + 90);
    const x = TCAM.x + rx * drift, z = TCAM.z + rz * drift;
    camera.position.set(x + sh1 * 0.05, heightAt(x, z) + TCAM.y + rise + sh2 * 0.05, z);
    const b = TCAM.brg + Math.sin(t * 0.031) * 1.5 + sh1 * 1.2, [lx, lz] = dirOf(b), p = TCAM.pitch + Math.sin(t * 0.05) * 0.6 + sh2 * 1;
    camera.lookAt(camera.position.x + lx * 100, camera.position.y + 100 * Math.tan(p * D2R), camera.position.z + lz * 100);
  }
  // fake traffic (sim units: km, m, deg, m/s). A high friendly pair lays contrails across the sun; bandits cross low-mid for the show launches.
  function titleSpawn(kind, o) { const e = Object.assign({ id: 'T' + (++title.n), kind, spd: 240, turn: 0 }, o); title.ents.push(e); return e; }
  function titleReset() {
    title.ents.length = 0; title.t = 0;
    const [ax, ay] = [Math.sin(24 * D2R), Math.cos(24 * D2R)];
    titleSpawn('jet_friend', { x: -30, y: 34, alt: 8200, hdg: 94, spd: 250 });
    titleSpawn('jet_friend', { x: -31.2, y: 33.1, alt: 8000, hdg: 94, spd: 250 });
    titleSpawn('jet_hostile', { x: ax * 9 - 3, y: ay * 9 + 1, alt: 2600, hdg: 100, spd: 230, bandit: true });
    titleSpawn('jet_hostile', { x: ax * 11 + 2, y: ay * 11, alt: 3400, hdg: 262, spd: 230, bandit: true });
  }
  function titleStep(dt) {
    title.t += dt;
    for (const e of title.ents) {
      if (e.turn) e.hdg = (e.hdg + e.turn * dt + 360) % 360;
      e.x += Math.sin(e.hdg * D2R) * e.spd * dt / 1000; e.y += Math.cos(e.hdg * D2R) * e.spd * dt / 1000;
      if (e.bandit) { const r = Math.hypot(e.x, e.y); if (Math.abs(e.x - Math.sin(24 * D2R) * r) > 7) e.hdg = (e.hdg + 180) % 360; }   // weave back across the view
    }
    // friendlies loop back across the sky once they leave it
    for (const e of title.ents) if (e.kind === 'jet_friend' && e.x > 32) e.x -= 64;
    return { t: time, visible: title.ents, missiles: [], tracks: [], battery: null, radar: { on: true, sweepDeg: (time * 60) % 360 } };
  }
  function titleKill(tg) {
    const q = fxPos(tg.x * 1000, tg.alt, -tg.y * 1000);
    burst(flare, q, FX.flash, 1, 0, 1.8); burst(glow, q, FX.ball, 16, 40, 1.3); burst(glow, q, FX.ember, 24, 160, 1.6);
    burst(smoke, q, FX.puffBig, 12, 22, 1); spawnDebris(q, 3); pulseLight(q.x, q.y, q.z, 1.2);
    api.titleKills = (api.titleKills || 0) + 1;
    if (api.onTitleKill) try { api.onTitleKill({ x: tg.x * 1000, y: tg.alt, z: -tg.y * 1000 }); } catch (e) { /* audio optional */ }
    title.ents.splice(title.ents.indexOf(tg), 1);
    const r = 9 + Math.random() * 3, b = 14 + Math.random() * 20;       // a fresh bandit wanders in a little later
    setTimeout(() => { if (title.on) titleSpawn('jet_hostile', { x: Math.sin(b * D2R) * r - 6, y: Math.cos(b * D2R) * r, alt: 2400 + Math.random() * 1400, hdg: 95, spd: 230, bandit: true }); }, 6000);
  }
  function setTitle(on) {
    on = !!on; if (on === title.on || !scene) return title.on;
    title.on = on; if (grassTitle) grassTitle.visible = on;
    const fb = grassMesh && grassMesh.userData.farBand;          // V1.4.3: full tufts for the cover shot, light ones in play
    if (fb) fb.mesh.geometry = on ? fb.full : fb.lite;
    if (chase.mode) chaseReset();
    if (on) titleReset();
    else {
      title.ents.length = 0; for (const id in actors) removeActor(id);
      // the shift starts with full launchers: swap in fresh canisters for every show round, instantly
      for (const id in tels) {
        const T = tels[id]; T.queue = T.queue.filter(m => !titleAim[m]); if (!T.vendor) continue;
        for (let k = 0; k < 40 && T.ud.rounds < 4; k++) { let i; while ((i = T.ud.slots.findIndex(q => !q.loaded && !q.busy)) >= 0 && T.ud.reload(i) > 0); T.ud.update(0.1); }
        T.reloading = {}; T.lastLaunch = -9;
      }
    }
    if (shelter) shelter.visible = !on;
    applyEnv();
    api.resize(renderer.domElement.clientWidth || 390, renderer.domElement.clientHeight || 300);
    return on;
  }
  /** Fire a show round from a launcher at the nearest cover-page bandit. Returns the missile id, or null (none loaded / no target). */
  function titleLaunch(id) {
    const T = tels[id]; if (!title.on || !T) return null;
    if (T.vendor && !T.ud.slots.some(s => s.loaded && !s.busy)) return null;
    const P = T.obj.position, cands = title.ents.filter(e => e.bandit && !Object.values(titleAim).includes(e.id));
    if (!cands.length) return null;
    cands.sort((a, b) => Math.hypot(a.x * 1000 - P.x, -a.y * 1000 - P.z) - Math.hypot(b.x * 1000 - P.x, -b.y * 1000 - P.z));
    const mid = 'TM' + (++title.seq);
    titleAim[mid] = cands[0].id; T.queue.push(mid); queued[mid] = id; T.lastLaunch = -9;
    return mid;
  }
  /** Where a show round is right now (scene metres), for the audio engine to follow. */
  function titleProbe(mid) {
    const f = flights[mid];
    if (f) return { x: f.pos.x, y: f.pos.y, z: f.pos.z, vx: f.vel.x, vy: f.vel.y, vz: f.vel.z };
    const m = titleM[mid];
    if (m && m.parent) { m.getWorldPosition(_v); return { x: _v.x, y: _v.y, z: _v.z }; }
    if (queued[mid]) { const P = tels[queued[mid]].obj.position; return { x: P.x, y: P.y + 4, z: P.z }; }
    return m === undefined ? null : { alive: false };
  }

  /* ---------------- v1.1 watch-your-kill: chase camera behind one of our missiles ----------------
     follow(id) → blend in from the hatch (0.6 s) → ride behind + above the round, looking between its velocity and its
     target → round gone (intercept/miss): hold ~2.2 s, backing off from the burst → ease home to the hatch over 0.7 s. */
  const chase = { id: null, mode: null, t: 0, k: 0, fog: 0, seen: false, tgtId: null, tgtAt: -9,
    pos: new V3(), q: new THREE.Quaternion(), from: new V3(), fromQ: new THREE.Quaternion(), off: new V3(0, 6, 24), look: new V3(0, 0, -1),
    last: new V3(), lastCam: new V3(), back: new V3(), anchor: new V3(), anchored: false, w: 0 };
  const HOLD_S = 2.2, EASE_S = 0.7, BLEND_S = 0.6;
  const _cq = new THREE.Quaternion(), _cm = new THREE.Matrix4(), _cu = new V3(0, 1, 0), _ct = new V3(), _cd = new V3();
  function chaseReset() {
    const was = chase.id;
    chase.id = null; chase.mode = null; chase.k = 0; chase.fog = 0;
    if (shelter) shelter.visible = !title.on;
    if (was) RS.bus.emit('CAM_FOLLOW', { id: null });
  }
  function follow(id) {
    if (id == null) {
      if (!chase.mode || chase.mode === 'ease') return true;
      startEase(); return true;
    }
    if (title.on || !scene) return false;
    const vis = lastState && lastState.visible;
    const known = flights[id] || queued[id] || (vis && vis.some(v => v.id === id && (v.kind === 'missile_lance' || v.kind === 'missile_dart')));
    if (!known) return false;
    const fresh = chase.mode !== 'follow' || chase.id !== id;
    if (chase.mode !== 'follow' && chase.mode !== 'hold') { chase.from.copy(camera.position); chase.fromQ.copy(camera.quaternion); chase.k = 0; }
    else if (chase.id !== id) { chase.from.copy(chase.pos); chase.fromQ.copy(chase.q); chase.k = 0; }
    chase.id = id; chase.mode = 'follow'; chase.t = 0; chase.seen = !!flights[id]; chase.tgtId = null; chase.tgtAt = -9;
    if (flights[id]) primeChase(flights[id]);
    if (fresh) RS.bus.emit('CAM_FOLLOW', { id });
    return true;
  }
  function primeChase(f) {                    // start the offset behind the round's current heading
    _cd.copy(f.vel); if (_cd.lengthSq() < 1) _cd.set(0, 1, 0); _cd.normalize();
    chase.look.copy(_cd); chase.off.copy(_cd).multiplyScalar(-24); chase.off.y += 6;
  }
  function startEase() {
    const was = chase.id;
    chase.mode = 'ease'; chase.t = 0; chase.id = null;
    chase.from.copy(chase.pos); chase.fromQ.copy(chase.q);
    if (was) RS.bus.emit('CAM_FOLLOW', { id: null });
  }
  // where the round's target is (scene metres) — truth entity nearest the sim track, re-resolved every 0.5 s
  function chaseTarget(state, f) {
    if (!state) return null;
    if (time - chase.tgtAt > 0.5) {
      chase.tgtAt = time; chase.tgtId = null;
      const m = state.missiles && state.missiles.find(q => q.id === chase.id);
      const tr = m && state.tracks ? state.tracks.find(t => t.id === m.targetId) : null;
      const vis = state.visible || [];
      if (m && m.targetEnt) chase.tgtId = m.targetEnt;
      else if (tr) {
        let best = 3.5;
        for (const v of vis) {
          if (v.kind === 'missile_lance' || v.kind === 'missile_dart') continue;
          const d = Math.hypot(v.x - tr.x, v.y - tr.y, (v.alt - tr.alt) / 1000);
          if (d < best) { best = d; chase.tgtId = v.id; }
        }
        if (!chase.tgtId) { chase.tgtId = '#' + tr.id; }
      }
    }
    if (!chase.tgtId) return null;
    if (chase.tgtId[0] === '#') {
      const tr = state.tracks && state.tracks.find(t => t.id === chase.tgtId.slice(1));
      return tr ? _ct.set(tr.x * 1000, tr.alt, -tr.y * 1000) : null;
    }
    const a = actors[chase.tgtId];
    return a ? _ct.copy(a.root.position) : null;
  }
  // called after the hatch pose is set: overrides the camera while following / holding / easing home
  function updateChase(dt, state) {
    if (!chase.mode) return;
    chase.t += dt;
    const f = chase.id && flights[chase.id];
    if (chase.mode === 'follow') {
      if (f) {
        if (!chase.seen) { chase.seen = true; primeChase(f); }
        chase.k = Math.min(1, chase.k + dt / BLEND_S);
        _cd.copy(f.vel); if (_cd.lengthSq() < 1) _cd.copy(chase.look); _cd.normalize();
        const tp = chaseTarget(state, f);
        if (tp) { _w.subVectors(tp, f.pos); const dist = _w.length(); if (dist > 1) { _w.divideScalar(dist); if (_w.dot(_cd) > -0.2) _cd.lerp(_w, dist < 400 ? 0.3 : 0.55).normalize(); } }
        chase.look.lerp(_cd, 1 - Math.exp(-3.5 * dt)).normalize();
        // desired offset: behind the look direction, a little above; smoothed so turns swing the view gently
        _w.copy(chase.look).multiplyScalar(-24); _w.y += 6;
        chase.off.lerp(_w, 1 - Math.exp(-2.5 * dt));
        const A = chase.anchor.copy(f.pos).addScaledVector(f.vel, dt); chase.anchored = true;   // where the round will be after this frame's flight update
        chase.pos.copy(A).add(chase.off);
        const gy = heightAt(chase.pos.x, chase.pos.z) + 9; if (chase.pos.y < gy) chase.pos.y = gy;
        chase.last.copy(A); chase.lastCam.copy(chase.pos);
        _w.copy(A).addScaledVector(chase.look, 160);
        _cm.lookAt(chase.pos, _w, _cu); chase.q.setFromRotationMatrix(_cm);
      } else if (chase.seen) {                // the round is gone: hold on the burst
        chase.mode = 'hold'; chase.t = 0;
        chase.back.subVectors(chase.lastCam, chase.last); if (chase.back.lengthSq() < 1) chase.back.set(0, 0.3, 1); chase.back.normalize();
      } else if (!queued[chase.id] && chase.t > 2) { startEase(); }   // never showed up
      else { chase.pos.copy(camera.position); chase.q.copy(camera.quaternion); chase.from.copy(camera.position); chase.fromQ.copy(camera.quaternion); return; }
    }
    if (chase.mode === 'hold') {
      const s = sstep(0, 1.3, chase.t);
      chase.pos.copy(chase.lastCam).addScaledVector(chase.back, 90 * s); chase.pos.y += 25 * s;
      const gy = heightAt(chase.pos.x, chase.pos.z) + 9; if (chase.pos.y < gy) chase.pos.y = gy;
      _cm.lookAt(chase.pos, chase.last, _cu); _cq.setFromRotationMatrix(_cm); chase.q.slerp(_cq, 1 - Math.exp(-7 * dt));
      if (chase.t >= HOLD_S) startEase();
    }
    if (chase.mode === 'ease') {
      const s = sstep(0, 1, chase.t / EASE_S);
      if (s >= 1) { chaseReset(); shakeT = 0; return; }
      chase.pos.lerpVectors(chase.from, camera.position, s);
      chase.q.copy(chase.fromQ).slerp(camera.quaternion, s);
      chase.k = 1 - s;
    }
    const k = chase.mode === 'follow' ? sstep(0, 1, chase.k) : 1;
    chase.w = k; camera.position.lerp(chase.pos, k); camera.quaternion.slerp(chase.q, k);
    chase.fog = Math.round((chase.mode === 'ease' ? 1 - sstep(0, 1, chase.t / EASE_S) : k) * 20) / 20;
    if (shelter) shelter.visible = false;
  }

  /* ---------------- V1.3 EO tracking camera (Pantsir-style TV/IR tracker) ----------------
     A zoomed camera on a turret ~7 m above the shelter, slaved to the selected track (the sim puts its entity in state.visible
     at any range with sel:true). Rendered on the same WebGL context: the EO pass goes into a small render target (inset pixel
     size), then a post pass (grain, vignette, haze compensation, IR white-hot curve) draws it into the inset viewport (scissor).
     Tap-to-swap: the EO fills the hatch and the battery view is drawn into the inset instead. The EO pass never draws the grass,
     shelter, trees, rain or battery vehicles; far targets get their high LOD + true-size effects (particle layer 2). */
  const EO_H = 7, FOV_MIN = 0.2, FOV_MAX = 20, FOV_IDLE = 16, SLEW = 60, HOLD_EO = 4, IDLE_S = 3, FRAC = 0.35;
  const EO_SIZE = { jet_hostile: 17, jet_friend: 16, strike_friend: 16, transport: 44, helo_hostile: 17, helo_friend: 17, cruise_missile: 6.5, arm_missile: 4.5, drone: 5 };
  const eoHide = [];                         // trees + battery vehicles (filled at build)
  const eoAct = []; let eoActN = 0;          // actors inside the EO's view this frame (forced high LOD, visible) for the EO pass
  const EOT = { uEOClip: { value: 0 }, uEOCam: { value: new V3() }, uEOTgt: { value: new V3() }, uEOW: { value: new THREE.Vector2(1300, 0.02) }, uEOH: { value: 0.001 } };
  const eo = {
    on: false, live: false, swapped: false, manual: null, mode: 'TV', auto: true,
    tgtId: null, trackId: null, kind: null, size: 15, hasTarget: false, hasAim: false, holding: false, holdT: 0, idleT: 0, fresh: true,
    pos: new V3(), aim: new V3(), dir: new V3(0, 0, -1), cosCone: 0.9, rangeMax: 35000,
    az: VIEW_BRG, el: 5, fov: FOV_IDLE, err: 0, rAz: 0, rEl: 0, pAz: 0, pEl: 0, rangeM: 0, rangeKm: 0, inRange: true, slewing: false,
    holdFov: 1, lostReason: null, event: null, W: 390, H: 300, rectN: { x: 0, y: 0, w: 180, h: 135 }, rectS: { x: 0, y: 0, w: 120, h: 90 }, rectL: { x: 0, y: 0, w: 180, h: 135 }, face: null, gate: { x: 0, y: 0, w: 0, h: 0 }, gateOn: false,
    cam: null, rt: null, post: null, hot: null, fogNear: 1, fogFar: 2, dehaze: 1, bg: new THREE.Color(),
    stats: { main: { calls: 0, tris: 0 }, eo: { calls: 0, tris: 0 }, post: { calls: 0, tris: 0 }, cab: { calls: 0, tris: 0 } }
  };
  const _eoV = new V3();
  const wrap180 = a => ((a % 360) + 540) % 360 - 180;
  // EO pass only: in a corridor along the line of sight the terrain is held under it — in front of the target (the sim has
  // no terrain masking, so a low cruise missile behind a hill must still be seen) and behind it, just under the frame centre
  // (a low flier reads against the sky with the skyline right below it instead of a wall of hillside)
  function eoClip(mat) {
    mat.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, EOT);
      sh.vertexShader = 'uniform float uEOClip; uniform vec3 uEOCam; uniform vec3 uEOTgt; uniform vec2 uEOW; uniform float uEOH;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        if (uEOClip > 0.5) {
          vec4 eW = modelMatrix * vec4(transformed, 1.0);
          vec2 eD = eW.xz - uEOCam.xz, eL = uEOTgt.xz - uEOCam.xz;
          float eR = max(length(eL), 1.0); vec2 eU = eL / eR;
          float eA = dot(eD, eU), eLat = abs(eD.x * eU.y - eD.y * eU.x), eWd = uEOW.x + eA * uEOW.y, eS = (uEOTgt.y - uEOCam.y) / eR;
          float eLim = eA < eR ? uEOCam.y + eS * eA - 6.0 - eA * 0.004 : uEOCam.y + eA * (eS - uEOH);
          float eK = eA > 0.0 ? 1.0 - smoothstep(eWd, eWd * 1.8, eLat) : 0.0;
          if (eW.y > eLim) transformed.y -= (eW.y - eLim) * eK;
        }`);
    };
  }
  // is world point (x,y,z) inside the tracker's view cone (last frame's pose) and inside EO range?
  function eoSees(x, y, z) {
    if (!eo.live) return false;
    const c = eo.pos, dx = x - c.x, dy = y - c.y, dz = z - c.z, d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < 1 || d > eo.rangeMax) return false;
    return (dx * eo.dir.x + dy * eo.dir.y + dz * eo.dir.z) / d > eo.cosCone;
  }
  // trail puff spacing (m) that reads as a continuous trail in the zoomed EO frame
  function eoStep(p) { return clamp(p.distanceTo(eo.pos) * eo.fov * D2R / 50, 6, 60); }
  function eoRangeKm(ir) {
    const E = env.cur, vk = E ? E.visKm : 15;
    return ir ? Math.min(40, vk * 3) : Math.min(35, vk * 2.5) * (E && E.night ? 0.45 : 1);   // night TV is poor
  }
  function eoReset() {                         // shift start: AUTO mode, normal layout, no target
    eo.manual = null; eo.swapped = false; eo.tgtId = null; eo.trackId = null; eo.hasTarget = eo.hasAim = eo.holding = false;
    eo.idleT = IDLE_S; eo.az = VIEW_BRG; eo.el = 5; eo.fov = FOV_IDLE; eo.event = null; eo.lostReason = null;
  }
  function eoEvent(type, p) {
    const watched = eo.trackId && (p.targetId === eo.trackId || p.trackId === eo.trackId || p.id === eo.trackId);
    if (!watched) return;
    eo.event = { type, t: time, reason: p.reason || null };
    if (type === 'KILL' && isFinite(p.x)) { eo.aim.set(p.x * 1000, p.alt, -p.y * 1000); eo.hasAim = true; }   // hold on the burst
    if (type === 'LOST') eo.lostReason = p.reason || null;
  }
  /* V1.4 cabin screens. rectN = the EO monitor's picture at the seat's rest pose (bbox, CSS px in the hatch; sizes the render
     target), rectS = swapped: the EO fills the cabin view above the radar monitor (the radar stays visible and tappable).
     Live quads (TL,TR,BR,BL CSS px) are projected every frame from the cabin model for RS.cabin (DOM matrix3d). */
  const Q = { radar: [0, 0, 0, 0, 0, 0, 0, 0], eo: [0, 0, 0, 0, 0, 0, 0, 0], sw: [0, 0, 0, 0, 0, 0, 0, 0], rRadar: [0, 0, 0, 0, 0, 0, 0, 0], rEo: [0, 0, 0, 0, 0, 0, 0, 0],
    okR: false, okE: false, lens: 0, win: { x: 0, y: 0, w: 0, h: 0, full: true } };
  const _qv = new V3();
  // cabin-local corners → CSS px with camera C (false if a corner is behind the camera)
  function projQuad(C, pts, out, W, H) {
    for (let i = 0; i < 4; i++) {
      _qv.copy(pts[i]).applyMatrix4(cab.group.matrixWorld).applyMatrix4(C.matrixWorldInverse);
      if (_qv.z > -0.02) return false;
      _qv.applyMatrix4(C.projectionMatrix);
      out[i * 2] = (_qv.x + 1) / 2 * W; out[i * 2 + 1] = (1 - _qv.y) / 2 * H;
    }
    return true;
  }
  function bbox(q, r) {
    const x0 = Math.min(q[0], q[2], q[4], q[6]), x1 = Math.max(q[0], q[2], q[4], q[6]), y0 = Math.min(q[1], q[3], q[5], q[7]), y1 = Math.max(q[1], q[3], q[5], q[7]);
    r.x = Math.round(x0); r.y = Math.round(y0); r.w = Math.round(x1 - x0); r.h = Math.round(y1 - y0); return r;
  }
  // seat projection: horizontal FOV fixed (the radar monitor spans the width); a narrower-than-design hatch gets a small lens
  // shift up so the radar's bottom edge stays on screen; a wide one opens the view instead
  function seatProj(C, w, h) {
    const S = RS.cabin.SEAT, asp = w / Math.max(1, h), tvRef = S.tanH / S.aspect;
    let tv = S.tanH / asp; if (tv < tvRef * 0.9) tv = tvRef * 0.9;
    C.aspect = asp; C.fov = 2 * Math.atan(tv) / D2R;
    const r = tvRef / tv, lens = r > 1 ? 0.966 * (r - 1) : 0;      // NDC shift that keeps the radar bottom (NDC −0.966 by design) in view
    Q.lens = lens;
    if (lens > 0.001) C.setViewOffset(w, h, 0, lens * h / 2, w, h); else C.clearViewOffset();
    C.updateProjectionMatrix();
  }
  const _sq = new THREE.Quaternion(), _se = new THREE.Euler(0, 0, 0, 'YXZ');
  function seatPose(C, yaw, pitch, roll, dx, dy) {
    const g = cab.group;
    _v.set(dx, dy, 0).applyQuaternion(g.quaternion); C.position.copy(g.position).add(_v);
    _se.set((RS.cabin.SEAT.pitch + pitch) * D2R, yaw * D2R, roll * D2R, 'YXZ'); _sq.setFromEuler(_se);
    C.quaternion.copy(g.quaternion).multiply(_sq);
  }
  function eoLayout(w, h) {
    eo.W = w; eo.H = h;
    if (!cab) return;
    seatProj(seatCam, w, h); seatPose(seatCam, 0, 0, 0, 0, 0); seatCam.updateMatrixWorld();
    projQuad(seatCam, cab.rects.radar, Q.rRadar, w, h); projQuad(seatCam, cab.rects.eo, Q.rEo, w, h);
    bbox(Q.rEo, eo.rectN);
    const top = Math.max(60, Math.round(Math.min(Q.rRadar[1], Q.rRadar[3])) - 3);
    eo.rectS.x = 0; eo.rectS.y = 0; eo.rectS.w = w; eo.rectS.h = top;
    const S = Q.sw; S[0] = 0; S[1] = 0; S[2] = w; S[3] = 0; S[4] = w; S[5] = top; S[6] = 0; S[7] = top;
  }
  // this frame's quads (after the camera pose) + the scissor box of the windows for the world pass
  function cabinQuads() {
    const on = !!(cab && shelter.visible);
    Q.okR = on && projQuad(camera, cab.rects.radar, Q.radar, eo.W, eo.H);
    Q.okE = on && projQuad(camera, cab.rects.eo, Q.eo, eo.W, eo.H);
    if (Q.okE) bbox(Q.eo, eo.rectL);
    // world pass scissor: bbox of the window openings (full frame if any corner is behind the camera)
    const Wn = Q.win, P = cab ? cab.windows : null; Wn.full = true;
    if (!on || !P) return;
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (let i = 0; i < P.length; i++) {
      _qv.copy(P[i]).applyMatrix4(cab.group.matrixWorld).applyMatrix4(camera.matrixWorldInverse);
      if (_qv.z > -0.02) return;
      _qv.applyMatrix4(camera.projectionMatrix);
      const x = (_qv.x + 1) / 2 * eo.W, y = (1 - _qv.y) / 2 * eo.H;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    x0 = Math.max(0, Math.floor(x0) - 2); y0 = Math.max(0, Math.floor(y0) - 2); x1 = Math.min(eo.W, Math.ceil(x1) + 2); y1 = Math.min(eo.H, Math.ceil(y1) + 2);
    if (x1 <= x0 || y1 <= y0) { Wn.x = Wn.y = 0; Wn.w = Wn.h = 0; Wn.full = false; return; }
    Wn.x = x0; Wn.y = y0; Wn.w = x1 - x0; Wn.h = y1 - y0; Wn.full = false;
  }
  function screenQuad(name) {
    if (name === 'radar') return Q.okR ? Q.radar : null;
    if (name === 'eo') return !eo.on || !(cab && shelter.visible) ? null : eo.swapped ? Q.sw : Q.okE ? Q.eo : null;
    return null;
  }
  // cabin light from the world's sky / sun (per frame: lightning flashes the sky light too); no allocations
  const _ci = new THREE.Quaternion(), SCR_C = new THREE.Color(0.55, 0.78, 1.0), LMP_C = new THREE.Color(1.0, 0.1, 0.05);
  function cabinLight() {
    const u = cab.uniforms, g = cab.glassU, E = env.cur || {}, night = !!E.night, dusk = E.time === 'dusk' || E.time === 'dawn', ovc = !!E.overcast;
    const hk = hemi.intensity;
    u.uSky.value.copy(hemi.color).multiplyScalar(hk * 1.05); u.uGnd.value.copy(hemi.color).lerp(hemi.groundColor, 0.35).multiplyScalar(hk * 0.62);   // bounce off the white interior
    _ci.copy(cab.group.quaternion).invert();
    _v.copy(sun.position).normalize().applyQuaternion(_ci); u.uSunD.value.copy(_v);
    const front = clamp(-_v.z, 0, 1) * 0.75 + 0.25;                       // the sun shines in through the windshield when it is ahead
    u.uSunC.value.copy(sun.color).multiplyScalar(sun.intensity * (night ? 0.2 : 1.05) * front);
    u.uScr.value.copy(SCR_C).multiplyScalar(night ? 0.34 : dusk ? 0.22 : ovc ? 0.16 : 0.12);
    u.uLmp.value.copy(LMP_C).multiplyScalar(night ? 0.42 : dusk ? 0.08 : 0);
    const f = night ? 0.018 : dusk ? 0.08 : 0.2; u.uFill.value.setRGB(f * (night ? 1.6 : 1), f * (night ? 0.7 : 1), f * (night ? 0.7 : 1.02));
    u.uSelf.value = night ? 0.85 : 1;
    g.uTime.value = time; g.uRain.value = E.wet ? (E.storm ? 1 : 0.8) : 0; g.uNight.value = night ? 1 : 0;
    g.uGlare.value.copy(hemi.color).multiplyScalar(Math.min(1, hk * 1.1));
    g.uTint.value.setRGB(0.5, 0.58, 0.56).multiplyScalar(night ? 0.2 : dusk ? 0.6 : 1);
    if (night) g.uIn.value.setRGB(0.13, 0.03, 0.03); else g.uIn.value.setRGB(0.02, 0.03, 0.04);
  }
  const POST_VS = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
  // V1.4: the same post shader runs on the cabin's EO monitor face (ON_MESH: log depth, monitor glare, no-signal screen)
  const FACE_VS = `
    #include <common>
    #include <logdepthbuf_pars_vertex>
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      #include <logdepthbuf_vertex>
    }`;
  const POST_FS = `
    #ifdef ON_MESH
    #include <common>
    #include <logdepthbuf_pars_fragment>
    #endif
    uniform sampler2D tMap; uniform vec2 uRes; uniform float uIR, uGain, uNoise, uTime, uDehaze, uOn; uniform vec3 uBg;
    varying vec2 vUv;
    const vec3 W = vec3(0.299, 0.587, 0.114);
    float rnd(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      #ifdef ON_MESH
      #include <logdepthbuf_fragment>
      if (uOn < 0.5) { float z = rnd(floor(vUv * vec2(160.0, 120.0)) + floor(uTime * 12.0)); gl_FragColor = vec4(vec3(0.03, 0.045, 0.05) + z * 0.025, 1.0); return; }
      #endif
      vec3 c = texture2D(tMap, vUv).rgb;
      float n = rnd(floor(vUv * uRes) + floor(fract(uTime * 7.13) * 97.0)) - 0.5;      // fine grain, new every frame
      if (uIR > 0.5) {                                   // white-hot thermal: luminance curve, hot spots bloom a touch
        vec2 px = 1.5 / uRes;
        float l = dot(c, W), m = max(max(dot(texture2D(tMap, vUv + vec2(px.x, 0.0)).rgb, W), dot(texture2D(tMap, vUv - vec2(px.x, 0.0)).rgb, W)),
          max(dot(texture2D(tMap, vUv + vec2(0.0, px.y)).rgb, W), dot(texture2D(tMap, vUv - vec2(0.0, px.y)).rgb, W)));
        l = max(l, m * 0.8 * smoothstep(0.45, 0.7, m));
        float b = dot(uBg, W);
        l = b + (l - b) * uDehaze;                       // haze compensation (auto contrast on the target range)
        c = vec3(smoothstep(0.03, 0.92, l));
      } else {
        c = uBg + (c - uBg) * uDehaze;
        c *= uGain;                                      // night: the camera's gain goes up (and so does the noise)
        c = mix(vec3(dot(c, W)), c, 0.6);                // slightly desaturated
        c = (c - 0.5) * 1.14 + 0.5;                      // contrasty
      }
      c += n * uNoise;
      vec2 q = vUv - 0.5; c *= 1.0 - 0.9 * dot(q, q);  // vignette
      #ifdef ON_MESH
      c *= 0.965 + 0.035 * sin(vUv.y * uRes.y * 3.14159);   // faint scan lines
      c += vec3(0.05, 0.06, 0.065) * smoothstep(0.18, 0.0, abs(vUv.x * 0.55 - vUv.y + 0.62)) + 0.018;   // monitor glass glare + black level
      #else
      c *= 0.965 + 0.035 * sin(gl_FragCoord.y * 3.14159);   // faint scan lines
      #endif
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`;
  function eoBuild() {
    eo.cam = new THREE.PerspectiveCamera(10, 4 / 3, 2, 60000);
    eo.cam.layers.enable(2);                   // EO-only objects (true-place debris); layer 1 = hatch-only stand-ins
    camera.layers.enable(1);
    const o = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true, stencilBuffer: false };
    const MS = THREE.WebGLMultisampleRenderTarget;
    eo.rt = renderer.capabilities.isWebGL2 && MS ? new MS(8, 8, o) : new THREE.WebGLRenderTarget(8, 8, o);
    if (eo.rt.samples !== undefined) eo.rt.samples = 4;
    const mat = new THREE.ShaderMaterial({ vertexShader: POST_VS, fragmentShader: POST_FS, depthTest: false, depthWrite: false,
      uniforms: { tMap: { value: eo.rt.texture }, uRes: { value: new THREE.Vector2(8, 8) }, uIR: { value: 0 }, uGain: { value: 1 }, uNoise: { value: 0.05 },
        uTime: { value: 0 }, uDehaze: { value: 1 }, uOn: { value: 1 }, uBg: { value: new THREE.Color() } } });
    const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); q.frustumCulled = false;
    const ps = new THREE.Scene(); ps.add(q);
    eo.post = { scene: ps, cam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), mat };
    eo.face = new THREE.ShaderMaterial({ vertexShader: FACE_VS, fragmentShader: '#define ON_MESH\n' + POST_FS, uniforms: mat.uniforms });   // shared uniforms
    if (cab) cab.eoFace.material = eo.face;
    eo.hot = new THREE.MeshLambertMaterial({ color: 0x4a4a4a, emissive: 0x8e8e8e });   // IR: airframes read warm-hot (the tailpipe glow is hotter)
    for (const id in tels) eoHide.push(tels[id].obj);
    eoHide.push(gun, radar); for (const id in ground) eoHide.push(ground[id]);
  }
  // sky dome colour at elevation el (deg) — the same gradient applyEnv paints on the dome (the EO fog fades targets into it)
  function skyAt(el, out) {
    const S = env.cur && env.cur.sky4; if (!S) return out.setRGB(0.6, 0.65, 0.7);
    const y = Math.sin(el * D2R);
    if (y > 0.25) out.copy(S[1]).lerp(S[0], Math.min(1, (y - 0.25) / 0.5)); else out.copy(S[2]).lerp(S[1], Math.max(0, y / 0.25));
    if (y < 0) out.copy(S[2]).lerp(S[3], Math.min(1, -y * 4));
    return out;
  }
  function eoUpdate(dt, state) {
    const E = eo;
    E.on = !title.on && !!E.cam;
    E.live = E.on;
    if (!E.on) return;
    const ENV = env.cur || {};
    E.auto = !E.manual; E.mode = E.manual || (ENV.night || ENV.wet ? 'IR' : 'TV');
    const ir = E.mode === 'IR', R = eoRangeKm(ir) * 1000;
    E.rangeMax = R;
    E.pos.set(0, heightAt(0, 0) + EO_H, 0);
    // the selected track's entity (sel:true); its actor carries the smooth scene position
    const vis = state && state.visible; let tv = null;
    if (vis) for (let i = 0; i < vis.length; i++) { const v = vis[i]; if (v.sel && (!tv || (tv.burning && !v.burning))) tv = v; }
    const a = tv && actors[tv.id];
    if (a) {
      if (E.tgtId !== tv.id) { E.tgtId = tv.id; E.fresh = true; E.kind = tv.kind; E.size = EO_SIZE[tv.kind] || 15; E.event = null; E.lostReason = null; }
      E.trackId = (state && state.selectedId) || E.trackId;
      E.aim.copy(a.root.position); E.hasAim = true; E.hasTarget = true; E.holding = false; E.idleT = 0;
    } else {
      if (E.hasTarget) {                       // lost (killed / exited / deselected): hold on the last aim point ~4 s
        E.hasTarget = false; E.holding = true; E.holdT = 0;
        E.holdFov = clamp(Math.max(E.fov * 1.6, 2 * Math.atan(420 / 2 / Math.max(300, E.rangeM)) / D2R), FOV_MIN, 6);
      }
      if (E.holding) { E.holdT += dt; if (E.holdT > HOLD_EO) { E.holding = false; E.hasAim = false; E.tgtId = null; E.trackId = null; E.idleT = 0; } }
      else { E.idleT += dt; E.tgtId = null; E.trackId = null; }
    }
    // desired pointing
    let tAz = E.az, tEl = E.el;
    if (E.hasAim) {
      const dx = E.aim.x - E.pos.x, dy = E.aim.y - E.pos.y, dz = E.aim.z - E.pos.z, hz = Math.hypot(dx, dz);
      tAz = (Math.atan2(dx, -dz) / D2R + 360) % 360; tEl = Math.atan2(dy, hz) / D2R; E.rangeM = Math.hypot(hz, dy);
    } else if (E.idleT > IDLE_S) { tAz = VIEW_BRG; tEl = 5; }   // no track for a while: drift back to the hatch bearing
    // feed-forward of the target's angular rate → a moving target stays centred (no lag) once the servo has caught up
    if (E.hasTarget && !E.fresh && dt > 0) {
      const k = Math.min(1, dt * 8);
      E.rAz += (clamp(wrap180(tAz - E.pAz) / dt, -90, 90) - E.rAz) * k; E.rEl += (clamp((tEl - E.pEl) / dt, -90, 90) - E.rEl) * k;
    } else { E.rAz = 0; E.rEl = 0; }
    E.fresh = false; E.pAz = tAz; E.pEl = tEl;
    // feed-forward first, then close what is left exponentially (so this frame's camera lands on this frame's target)
    const cosE = Math.max(0.1, Math.cos(E.el * D2R)), fAz = E.rAz * dt, fEl = E.rEl * dt;
    const g = 1 - Math.exp(-(E.hasAim ? 7 : 0.9) * dt), vmax = (E.hasAim ? SLEW : 14) * dt;
    let mAz = fAz + wrap180(tAz - E.az - fAz) * g, mEl = fEl + (tEl - E.el - fEl) * g;
    const sp = Math.hypot(mAz * cosE, mEl); if (sp > vmax) { mAz *= vmax / sp; mEl *= vmax / sp; }   // ~60°/s turret limit
    E.az = (E.az + mAz + 360) % 360; E.el = clamp(E.el + mEl, -5, 85);
    E.err = Math.hypot(wrap180(tAz - E.az) * cosE, tEl - E.el);
    // zoom: target ~35 % of the frame width, clamped 0.25°…20°; widen while slewing; open up on a hold to show the burst
    let fT = E.fov;
    if (E.hasTarget) fT = 2 * Math.atan(E.size / FRAC / 2 / Math.max(30, E.rangeM)) / D2R;
    else if (E.holding) fT = E.holdFov;
    else if (E.idleT > IDLE_S) fT = FOV_IDLE;
    E.slewing = E.hasTarget && E.err > E.fov * 0.45;
    if (E.hasTarget && E.err > E.fov * 0.3) fT = Math.max(fT, Math.min(FOV_MAX, E.err * 2.4));
    fT = clamp(fT, FOV_MIN, FOV_MAX);
    E.fov = Math.exp(Math.log(E.fov) + (Math.log(fT) - Math.log(E.fov)) * (1 - Math.exp(-dt * (fT > E.fov ? 4 : 2.2))));
    E.inRange = !E.hasAim || E.rangeM <= R;
    E.rangeKm = E.hasAim ? E.rangeM / 1000 : 0;
    // pose (+ a little servo hunting while locked)
    const ce = Math.cos(E.el * D2R);
    E.dir.set(Math.sin(E.az * D2R) * ce, Math.sin(E.el * D2R), -Math.cos(E.az * D2R) * ce);
    const aspect = E.swapped ? E.rectS.w / Math.max(1, E.rectS.h) : 4 / 3, th = Math.tan(E.fov * D2R / 2), tv2 = th / aspect;
    E.cosCone = Math.cos(Math.min(1.5, Math.atan(Math.hypot(th, tv2)) * 1.6 + 0.001));
    const hunt = E.hasTarget && !E.slewing ? E.fov * D2R * 0.012 : 0;
    const jAz = (Math.sin(time * 2.3) + 0.6 * Math.sin(time * 5.1 + 1.3)) * hunt, jEl = (Math.sin(time * 1.9 + 0.7) + 0.5 * Math.sin(time * 4.4)) * hunt;
    _eoV.set(Math.sin(E.az * D2R + jAz) * ce, Math.sin(E.el * D2R + jEl), -Math.cos(E.az * D2R + jAz) * ce);
    const C = E.cam; C.position.copy(E.pos); C.aspect = aspect; C.fov = 2 * Math.atan(tv2) / D2R; C.updateProjectionMatrix();
    C.lookAt(E.pos.x + _eoV.x * 1000, E.pos.y + _eoV.y * 1000, E.pos.z + _eoV.z * 1000); C.updateMatrixWorld();
    // tracking gate: the target's box projected into the EO frame (0..1, top-left origin)
    E.gateOn = false;
    if (E.hasTarget && E.inRange) {
      _eoV.copy(E.aim).project(C);
      if (_eoV.z < 1 && Math.abs(_eoV.x) < 1.2 && Math.abs(_eoV.y) < 1.2) {
        const ang = Math.atan(E.size * 0.62 / Math.max(1, E.rangeM)), gw = Math.max(0.09, Math.tan(ang) / th), gh = Math.max(0.09 * aspect, Math.tan(ang) / tv2);
        const g = E.gate; g.w = Math.min(0.9, gw); g.h = Math.min(0.9, gh); g.x = (_eoV.x + 1) / 2 - g.w / 2; g.y = (1 - _eoV.y) / 2 - g.h / 2; E.gateOn = true;
      }
    }
    // fog for the EO pass: out to the EO range, fading into the sky right behind the target (IR: a cold grey sky)
    E.fogNear = R * 0.45; E.fogFar = R * 1.35;   // haze on the way out to R; beyond R the target is not drawn at all (OUT OF RANGE)
    if (ir) { const t = (ENV.night ? 0.07 : 0.11) + 0.12 * (1 - clamp(E.el / 20, 0, 1)); E.bg.setRGB(t, t, t); }
    else skyAt(Math.max(0, E.el), E.bg);
    const fT2 = E.hasAim ? clamp((E.rangeM - E.fogNear) / (E.fogFar - E.fogNear), 0, 0.85) : 0;
    E.dehaze = 1 + (ir ? 1.5 : 1.8) * fT2;      // the tracker's auto-contrast on the target range
  }
  function eoHotSwap(o, list) {               // IR: opaque airframe meshes → the hot material (restored after the pass)
    if (!o.visible) return;
    if (o.isMesh && o.material && (Array.isArray(o.material) || !o.material.transparent)) { list.push(o, o.material); o.material = eo.hot; }
    for (let i = 0; i < o.children.length; i++) eoHotSwap(o.children[i], list);
  }
  const eoSwapList = [], eoLod = [], eoHideVis = [], eoGrassVis = [], _eoFog = { near: 0, far: 0, color: new THREE.Color(), clear: new THREE.Color(), alpha: 1, hs: new THREE.Color(), hg: new THREE.Color(), hi: 0, sc: new THREE.Color(), si: 0, cc: new THREE.Color() };
  function eoPass(w, h) {
    const R = renderer, E = eo, PR = R.getPixelRatio(), rw = Math.max(2, Math.round(w * PR)), rh = Math.max(2, Math.round(h * PR));
    if (E.rt.width !== rw || E.rt.height !== rh) E.rt.setSize(rw, rh);
    const ir = E.mode === 'IR', ENV = env.cur || {}, F = _eoFog;
    // --- pass state
    for (let i = 0; i < eoHide.length; i++) { eoHideVis[i] = eoHide[i].visible; eoHide[i].visible = false; }
    for (let i = 0; i < grassLayers.length; i++) { eoGrassVis[i] = grassLayers[i].mesh.visible; grassLayers[i].mesh.visible = false; }
    const shelterVis = shelter.visible, rainVis = rain.ls.visible, skyVis = skyGroup.visible;
    shelter.visible = false; rain.ls.visible = false;
    const noGround = E.el - E.cam.fov / 2 > 6.5;          // looking well above the hills (≤ ~6° from the turret): skip the terrain
    if (noGround) { terrainMesh.visible = false; farGround.mesh.visible = false; }
    eoLod.length = 0;
    for (let i = 0; i < eoActN; i++) { const a = eoAct[i]; eoLod.push(a.root.visible, a.useLo); a.root.visible = true; setLod(a, false); }
    F.near = scene.fog.near; F.far = scene.fog.far; F.color.copy(scene.fog.color); R.getClearColor(F.clear); F.alpha = R.getClearAlpha();
    scene.fog.near = U.fogNear.value = E.fogNear; scene.fog.far = U.fogFar.value = E.fogFar;
    scene.fog.color.copy(E.bg); U.fogColor.value.copy(E.bg); R.setClearColor(E.bg, 1);
    const sc0 = U.scale.value; U.scale.value = rh / (2 * Math.tan(E.cam.fov * D2R / 2)); U.pass.value = 1; U.ir.value = ir ? 1 : 0;
    EOT.uEOClip.value = E.hasAim ? 1 : 0; EOT.uEOCam.value.copy(E.pos); EOT.uEOTgt.value.copy(E.aim);
    EOT.uEOW.value.set(1300, Math.tan(E.fov * D2R) * 1.2); EOT.uEOH.value = 0.55 * Math.tan(E.cam.fov * D2R / 2);
    eoSwapList.length = 0;
    if (ir) {
      skyGroup.visible = false;
      F.hs.copy(hemi.color); F.hg.copy(hemi.groundColor); F.hi = hemi.intensity; F.sc.copy(sun.color); F.si = sun.intensity;
      hemi.color.setRGB(1, 1, 1); hemi.groundColor.setRGB(0.42, 0.42, 0.42); hemi.intensity = ENV.night ? 0.6 : 0.8;
      sun.color.setRGB(1, 1, 1); sun.intensity = ENV.night ? 0.1 : 0.3;
      if (cloudDeck) { F.cc.copy(cloudDeck.material.color); cloudDeck.material.color.multiplyScalar(0.5); }   // the deck reads cool
      for (let i = 0; i < eoActN; i++) eoHotSwap(eoAct[i].root, eoSwapList);
      for (const id in flights) { const f = flights[id]; if (eoSees(f.pos.x, f.pos.y, f.pos.z)) eoHotSwap(f.m, eoSwapList); }
      for (const d of debris) if (d.on) eoHotSwap(d.o, eoSwapList);
    }
    R.setRenderTarget(E.rt);
    R.render(scene, E.cam);
    R.setRenderTarget(null);
    // --- restore
    for (let i = 0; i < eoSwapList.length; i += 2) eoSwapList[i].material = eoSwapList[i + 1];
    eoSwapList.length = 0;
    if (ir) { if (cloudDeck) cloudDeck.material.color.copy(F.cc); skyGroup.visible = skyVis; hemi.color.copy(F.hs); hemi.groundColor.copy(F.hg); hemi.intensity = F.hi; sun.color.copy(F.sc); sun.intensity = F.si; }
    EOT.uEOClip.value = 0;
    U.scale.value = sc0; U.pass.value = 0; U.ir.value = 0;
    scene.fog.near = U.fogNear.value = F.near; scene.fog.far = U.fogFar.value = F.far; scene.fog.color.copy(F.color); U.fogColor.value.copy(F.color); R.setClearColor(F.clear, F.alpha);
    for (let i = 0; i < eoActN; i++) { const a = eoAct[i]; a.root.visible = eoLod[i * 2]; if (eoLod[i * 2 + 1] !== null) setLod(a, eoLod[i * 2 + 1]); }
    shelter.visible = shelterVis; rain.ls.visible = rainVis;
    if (noGround) { terrainMesh.visible = true; farGround.mesh.visible = true; }
    for (let i = 0; i < eoHide.length; i++) eoHide[i].visible = eoHideVis[i];
    for (let i = 0; i < grassLayers.length; i++) grassLayers[i].mesh.visible = eoGrassVis[i];
    // post uniforms
    const u = E.post.mat.uniforms;
    u.uRes.value.set(rw, rh); u.uIR.value = ir ? 1 : 0; u.uTime.value = time; u.uDehaze.value = E.dehaze; u.uBg.value.copy(E.bg);
    // TV auto-gain: expose for the sky behind the target (dusk lifts, night runs out of gain → noisy, poor picture)
    const nightTV = !ir && ENV.night, bl = Math.max(0.02, E.bg.r * 0.299 + E.bg.g * 0.587 + E.bg.b * 0.114);
    u.uGain.value = ir ? 1 : clamp(0.52 / bl, 0.85, nightTV ? 3 : 1.8); u.uNoise.value = nightTV ? 0.2 : ir ? 0.07 : 0.05 + 0.03 * clamp(u.uGain.value - 1, 0, 1);
  }
  function stat(o, c0, t0) { const r = renderer.info.render; o.calls = r.calls - c0; o.tris = r.triangles - t0; }
  // all passes of one frame. V1.4: world (scissored to the cabin windows) → EO pass into its render target → the cabin on top
  // (its EO monitor face samples the target through the post shader). Swapped: EO pass → cabin → EO post over the view
  // above the radar monitor. Title / chase camera: the world only.
  function renderFrame() {
    const R = renderer, I = R.info.render, E = eo, S = E.stats, W = E.W, H = E.H, cabOn = !!(cab && shelter.visible);
    R.info.reset();
    S.eo.calls = S.eo.tris = S.post.calls = S.post.tris = S.cab.calls = S.cab.tris = 0;
    // V1.4.3 perf: the EO camera's world pass runs at ≤ ~30 Hz (a TV/IR tracker's rate); in between, the monitor shows the last picture
    const tNow = performance.now(), eoDue = !(E.lastPass > tNow - 31);
    if (!cabOn) { R.setScissorTest(false); R.setViewport(0, 0, W, H); R.render(scene, camera); stat(S.main, 0, 0); return; }
    let c0 = 0, t0 = 0;
    const u = E.post.mat.uniforms; u.uOn.value = E.on ? 1 : 0;
    if (E.on && E.swapped) {
      const r = E.rectS;
      if (eoDue) { eoPass(r.w, r.h); E.lastPass = tNow; } stat(S.eo, c0, t0); c0 = I.calls; t0 = I.triangles;
      R.setScissorTest(false); R.setViewport(0, 0, W, H);
      R.render(cabScene, camera); stat(S.cab, c0, t0); c0 = I.calls; t0 = I.triangles;
      R.setViewport(r.x, H - r.y - r.h, r.w, r.h); R.setScissor(r.x, H - r.y - r.h, r.w, r.h); R.setScissorTest(true);
      R.render(E.post.scene, E.post.cam); stat(S.post, c0, t0);
      S.main.calls = S.main.tris = 0;
    } else {
      const Wn = Q.win;
      R.setScissorTest(false); R.setViewport(0, 0, W, H);
      if (Wn.full) R.render(scene, camera);
      else {
        R.clear();
        if (Wn.w > 0) { R.setScissor(Wn.x, H - Wn.y - Wn.h, Wn.w, Wn.h); R.setScissorTest(true); R.autoClear = false; R.render(scene, camera); R.autoClear = true; R.setScissorTest(false); }
      }
      stat(S.main, c0, t0); c0 = I.calls; t0 = I.triangles;
      if (E.on && eoDue) { eoPass(E.rectN.w, E.rectN.h); E.lastPass = tNow; stat(S.eo, c0, t0); c0 = I.calls; t0 = I.triangles; }
      R.setRenderTarget(null); R.setScissorTest(false); R.setViewport(0, 0, W, H);
      R.autoClear = false; R.clearDepth(); R.render(cabScene, camera); R.autoClear = true; stat(S.cab, c0, t0);
    }
    R.setScissorTest(false); R.setViewport(0, 0, W, H);
  }
  const eoState = { on: false, swapped: false, mode: 'TV', auto: true, targetId: null, trackId: null, hasTarget: false, holding: false, inRange: true,
    rangeKm: 0, brgDeg: 0, elDeg: 0, fovDeg: FOV_IDLE, zoom: 1, gate: null, rect: null, slewing: false, status: 'NO TRACK', event: null, kind: null };
  const eoApi = {
    get state() {
      const E = eo, s = eoState;
      s.on = E.on; s.swapped = E.swapped; s.mode = E.mode; s.auto = !E.manual; s.targetId = E.tgtId; s.trackId = E.trackId; s.kind = E.kind;
      s.hasTarget = E.hasTarget; s.holding = E.holding; s.inRange = E.inRange; s.slewing = E.slewing;
      s.rangeKm = +E.rangeKm.toFixed(2); s.brgDeg = +E.az.toFixed(1); s.elDeg = +E.el.toFixed(2); s.fovDeg = +E.fov.toFixed(3);
      s.zoom = +(FOV_MAX / E.fov).toFixed(1); s.gate = E.gateOn ? E.gate : null; s.rect = E.swapped ? E.rectS : Q.okE ? E.rectL : E.rectN; s.event = E.event;
      s.status = !E.on ? 'OFF' : E.holding ? 'HOLD' : !E.hasTarget ? 'NO TRACK' : !E.inRange ? 'OUT OF RANGE' : E.slewing ? 'SLEWING' : 'TRACK';
      return s;
    },
    setMode(m) { m = String(m || '').toUpperCase(); eo.manual = m === 'TV' || m === 'IR' ? m : null; if (eo.on) eo.mode = eo.manual || eo.mode; return eo.manual || 'AUTO'; },
    toggleSwap() { if (!eo.on) return false; eo.swapped = !eo.swapped; return eo.swapped; },
    get swapped() { return eo.swapped; }
  };

  /* ---------------- API ---------------- */
  const api = {
    eo: eoApi,
    setTitle, titleLaunch, titleProbe, get titleOn() { return title.on; }, get titleT() { return title.t; },
    follow, get following() { return chase.mode === 'follow' || chase.mode === 'hold' ? chase.id : null; },
    init({ canvas, models: mdl }) {
      models = mdl || RS.models;
      // logarithmic depth: the view spans 5 cm (cabin console) to 30 km (far ground) — linear depth z-fights at both ends
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', logarithmicDepthBuffer: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      renderer.shadowMap.enabled = false;
      renderer.info.autoReset = false;         // V1.3: several passes per frame — renderFrame() resets once, so info = the frame total
      try { const gl = renderer.getContext(), r = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE); if (r && r[1]) U.maxPx.value = Math.min(512, r[1]); } catch (e) { /* ignore */ }
      scene = new THREE.Scene();
      scene.fog = new THREE.Fog(0x8a5a4a, 1200, 5200);
      camera = new THREE.PerspectiveCamera(50, 1, 0.05, 32000);  // far ground reaches ~30 km from the chase camera
      seatCam = new THREE.PerspectiveCamera(50, 1, 0.05, 100);   // the seat's rest pose (screen layout)

      hemi = new THREE.HemisphereLight(0x8a90b0, 0x2a2618, 0.75); scene.add(hemi);
      sun = new THREE.DirectionalLight(0xffc49a, 0.9); sun.position.set(-3000, 1200, 2000); scene.add(sun);
      // always present (constant light count → no shader recompiles): battery work light + flash light
      workLight = new THREE.PointLight(0xffe0b0, 0, 170, 1.2);
      { const a = LAYOUT.L1, b = LAYOUT.L3; workLight.position.set((a.x + b.x) * 0.35, 9, (a.z + b.z) * 0.35); scene.add(workLight); }
      flashLight = new THREE.PointLight(0xffb070, 0, 3500, 1.4); scene.add(flashLight);

      buildSky();
      buildTerrain();
      buildFarGround();
      buildCloudDeck();
      buildTrees(400);
      buildGrass();
      smoke = new PSys(3200, texPuff(), false, 1.5, 1, 3);
      glow = new PSys(1400, texGlow(), true, 2.5, 0.6, 4);
      farSys = new PSys(2400, texPuff(), false, 5, 0.25, 3);      // distant aircraft: light fog so specks/contrails stay visible
      flare = new PSys(64, texGlow(), true, 26, 0.25, 5);
      tracers = buildTracers(); rain = buildRain(); bolt = buildBolt();
      buildBattery();
      const dproto = models.create('debris', { placeholder: true });
      for (let i = 0; i < 14; i++) { const o = cloneBare(dproto); o.visible = false; scene.add(o); debris.push({ o, on: false, v: new V3(), w: new V3(), t: 0, k: 1 }); }

      // V1.4: the Pantsir operator cabin replaces the hatch shelter (same place, facing VIEW_BRG), in its own scene
      cab = RS.cabin.model(THREE);
      cabScene = new THREE.Scene(); cabScene.add(cab.group);
      { const [fx, fz] = dirOf(VIEW_BRG); cab.group.position.set(-fx * 0.45, heightAt(0, 0) + EYE, -fz * 0.45); }
      cab.group.rotation.y = -VIEW_BRG * D2R;              // cabin −Z (forward) → bearing VIEW_BRG
      cab.group.updateMatrixWorld(true);
      cab.q0 = cab.group.quaternion.clone(); cab.p0 = cab.group.position.clone();   // rest pose (the sway rocks around it)
      shelter = cab.group;
      eoBuild();

      applyEnv();
      onBus();
      api.resize(canvas.clientWidth || 390, canvas.clientHeight || 300);
      api.render(0, null);
      prewarm();
    },

    resize(w, h) {
      if (!renderer) return;
      renderer.setSize(w, h, false);
      if (title.on) { camera.aspect = w / Math.max(1, h); camera.fov = camera.aspect < 1 ? 56 : 42; camera.clearViewOffset(); camera.updateProjectionMatrix(); }
      else seatProj(camera, w, h);
      U.scale.value = h * renderer.getPixelRatio() / (2 * Math.tan(camera.fov * D2R / 2));
      eoLayout(w, h);
    },

    render(dt, state) {
      if (!renderer) return;
      autoQuality(dt);
      dt = Math.min(dt || 0, 0.1) * api.debug.timeScale;
      time += dt;
      if (title.on) state = titleStep(dt);
      lastState = state;
      if (state && state.t !== simT) { simT = state.t; simAge = 0; } else simAge += dt;
      grassGust = Math.max(0, grassGust - dt * 0.8);
      grassU.uTime.value = time; if (sun) grassU.uSunDir.value.copy(sun.position).normalize(); if (sun) grassU.uSun.value.copy(sun.color).multiplyScalar(sun.intensity * clamp(1.3 - 1.2 * sun.position.y / Math.max(1, sun.position.length()), 0.15, 1));   // tips glow most with a low sun
      grassU.uWind.value = (env.cur && env.cur.storm ? 2.2 : env.cur && env.cur.wet ? 1.6 : 1) + grassGust;
      // seated in the cabin: rest pose + drag look-around (RS.cabin.look, springs home) + subtle head sway + launch shake
      shakeT = Math.max(0, shakeT - dt * 1.4);
      const sk = shakeT * shakeT, sh1 = (Math.sin(time * 61) + Math.sin(time * 37.3)) * 0.5 * sk, sh2 = (Math.sin(time * 53.7) + Math.sin(time * 29.1)) * 0.5 * sk;
      if (title.on) titleCam(sh1, sh2);
      else {
        RS.cabin.setEnabled(!eo.swapped && !chase.mode);
        const L = RS.cabin.frame(dt);
        // sway = the vehicle rocking on its suspension: cabin + seat move together against the world, so the DOM screens stay put
        // (crisp, stable taps) while the view out of the windshield drifts; launch shake / look-around move the head in the cabin
        const g = cab.group;
        _se.set(Math.sin(time * 0.33) * 0.0016, Math.sin(time * 0.21) * 0.0022, Math.sin(time * 0.27) * 0.0024, 'YXZ'); _sq.setFromEuler(_se);
        g.quaternion.copy(cab.q0).multiply(_sq);
        g.position.set(cab.p0.x, cab.p0.y + Math.sin(time * 0.43) * 0.004, cab.p0.z); g.updateMatrixWorld(true);
        seatPose(camera, L.yaw + sh1 * 1.2, L.pitch + sh2 * 0.9, sh1 * 0.5, sh1 * 0.012, sh2 * 0.012);
      }
      if (chase.mode) updateChase(dt, state);
      camera.updateMatrixWorld();
      const W = state && state.weather;   // the sim's weather (set at startShift) wins if it differs from what we show
      if (W && !title.on && (W.time !== env.wt || W.sky !== env.ws || W.visKm !== env.wv)) { env.wt = W.time; env.ws = W.sky; env.wv = W.visKm; envFromWeather(W); applyEnv(); }

      updateRadars(dt, state);
      updateBattery(dt, state);
      if (gun) updateGun(dt, state);

      // truth entities near the battery
      const vis = (state && state.visible) || [], seen = {}, cam = camera.position, night = env.cur && env.cur.night, vm = visM();
      eoActN = 0;
      for (const v of vis) {
        if (v.kind === 'missile_lance' || v.kind === 'missile_dart') {
          seen[v.id] = 1;
          if (flights[v.id]) updateFlight(flights[v.id], v, dt);
          else if (!queued[v.id]) {       // a missile we never saw launch: fly a stand-alone model
            const m = makeModel(specFor(v), 'high'); const P = new V3(v.x * 1000, v.alt, -v.y * 1000);
            startFlight(v.id, m, P, new V3(Math.sin(v.hdg * D2R), 0.3, -Math.cos(v.hdg * D2R)).multiplyScalar(v.spd || 300));
            flights[v.id].followed = true; flights[v.id].blend = 1; updateFlight(flights[v.id], v, dt);
          }
          continue;
        }
        seen[v.id] = 1;
        const a = actorFor(v);
        if (a.t0 !== simT && (v.hdg !== a.hdgPrev || v.alt !== a.altPrev)) {
          const dS = Math.max(0.05, simT - a.t0), dh = Math.atan2(Math.sin((v.hdg - a.hdgPrev) * D2R), Math.cos((v.hdg - a.hdgPrev) * D2R)) / D2R;
          a.turn = dh / dS; a.vy = (v.alt - a.altPrev) / dS; a.hdgPrev = v.hdg; a.altPrev = v.alt; a.t0 = simT;
        }
        const age = Math.min(simAge, 0.12), spd = v.spd || 0, h = v.hdg * D2R;
        const x = v.x * 1000 + Math.sin(h) * spd * age, z = -v.y * 1000 - Math.cos(h) * spd * age;
        const y = Math.max(v.alt + (a.vy || 0) * age, heightAt(x, z) + 5);
        a.root.position.set(x, y, z);
        const dist = a.root.position.distanceTo(cam), far = dist > FAR_AIR, seenFar = dist < vm;   // beyond visual range: not drawn at all
        const inEO = eoSees(x, y, z);         // V1.3: in the tracker's view — full model + true-size effects for the EO pass
        a.root.visible = !far;
        if (!far) setLod(a, FAR_TIER[a.spec.kind] && dist > (a.useLo === 'far' ? 2300 : 2500) ? 'far' : a.useLo ? dist > 1400 : dist > 1600);
        if (inEO && eoActN < 16) eoAct[eoActN++] = a;
        a.bank += (clamp((a.turn || 0) * 0.06, -1.1, 1.1) - a.bank) * Math.min(1, dt * 3);
        a.pitch += (Math.atan2(a.vy || 0, Math.max(40, spd)) - a.pitch) * Math.min(1, dt * 3);
        a.root.rotation.set(-a.pitch, yawFor(v.hdg), a.bank);
        const mdl = a.useLo === 'far' ? a.far : a.useLo ? a.lo : a.hi, rotor = mdl && mdl.userData.rotor; if (rotor && !far) rotor.rotation.y += dt * 30;
        if (inEO && a.hi && a.hi !== mdl && a.hi.userData.rotor) a.hi.userData.rotor.rotation.y += dt * 30;
        // legibility dot (min 1.5 px) + night nav lights
        const P = a.root.position, navOk = night && v.kind !== 'cruise_missile' && v.kind !== 'arm_missile';
        LAY = inEO ? 1 : 0;                   // hatch-only stand-ins while the EO shows this one close up
        if (far) { if (seenFar) { const q = fxPos(P.x, P.y, P.z); farSys.spawn(q.x, q.y, q.z, 0, 0, 0, FX.farDot, 1); } }
        else if (dist > 900) smoke.spawn(P.x, P.y, P.z, 0, 0, 0, FX.dot, 1);
        if (night && far && !seenFar) { /* too far to see */ }
        else if (navOk && far) {              // distant: one blinking light
          const q = fxPos(P.x, P.y, P.z);
          glow.spawn(q.x, q.y, q.z, 0, 0, 0, (time + (idHash(v.id) % 10) / 10) % 1.2 < 0.15 ? FX.navW : FX.navR, 1);
        }
        LAY = far ? 2 : 0;
        if (navOk && (!far || inEO)) {        // close (or in the EO's close-up): wingtip lights + strobe
          a.root.updateMatrixWorld();
          const span = v.kind === 'transport' ? 18 : v.kind.indexOf('helo') === 0 ? 2 : 6;
          _v.set(span, 0, 0).applyMatrix4(a.root.matrixWorld); glow.spawn(_v.x, _v.y, _v.z, 0, 0, 0, FX.navR, 1);
          _v.set(-span, 0, 0).applyMatrix4(a.root.matrixWorld); glow.spawn(_v.x, _v.y, _v.z, 0, 0, 0, FX.navG, 1);
          if ((time + (idHash(v.id) % 10) / 10) % 1.2 < 0.1) glow.spawn(P.x, P.y + 1.5, P.z, 0, 0, 0, FX.navW, 1.5);
        }
        LAY = 0;
        // contrails above 5 km, smoke from burning / missile exhaust glow
        a.trailT -= dt;
        if (a.trailT <= 0) {
          a.trailT = 0.07;
          _v.set(-Math.sin(h), 0, Math.cos(h));
          const back = (a.spec.kind === 'transport' ? 16 : 9);
          if (v.burning) {
            glow.spawn(P.x + _v.x * back * 0.3, P.y, P.z + _v.z * back * 0.3, 0, 2, 0, FX.fire, 0.7);
            smoke.spawn(P.x + _v.x * back, P.y, P.z + _v.z * back, 0, 1, 0, FX.dark, 0.6);
          } else if (y > 5000 && /jet|transport|strike/.test(v.kind)) {
            const sx = Math.cos(h) * 3;
            if (far && seenFar) {          // pulled in along the view ray, angular size kept, light fog
              LAY = inEO ? 1 : 0;
              const q = fxPos(P.x + _v.x * back, P.y, P.z + _v.z * back);
              farSys.spawn(q.x, q.y, q.z, 0, 0, 0, FX.farTrail, q.k);
            }
            if (!far || inEO) {            // true contrails (the EO's close-up gets them at any range)
              LAY = far ? 2 : 0;
              smoke.spawn(P.x + _v.x * back + sx, P.y, P.z + _v.z * back + Math.sin(h) * 3, 0, 0, 0, FX.contrail, 1);
              smoke.spawn(P.x + _v.x * back - sx, P.y, P.z + _v.z * back - Math.sin(h) * 3, 0, 0, 0, FX.contrail, 1);
            }
            LAY = 0;
          }
        }
        if (inEO && eo.mode === 'IR' && !v.burning && v.kind !== 'cruise_missile' && v.kind !== 'arm_missile') {   // IR: hot tailpipe
          const tb = v.kind === 'transport' ? 14 : v.kind.indexOf('helo') === 0 ? 2 : 7;
          LAY = 2; glow.spawn(P.x - Math.sin(h) * tb, P.y + (tb === 2 ? 1.2 : 0), P.z + Math.cos(h) * tb, 0, 0, 0, FX.heat, v.kind === 'transport' ? 1.5 : 1); LAY = 0;
        }
        // (V1.3 fix: from the heading — _v may hold a camera ray from fxPos here, which threw far motors kilometres off)
        if (v.kind === 'arm_missile' || v.kind === 'cruise_missile') glow.spawn(P.x - Math.sin(h) * 3, P.y, P.z + Math.cos(h) * 3, 0, 0, 0, FX.motor, v.kind === 'arm_missile' ? 1 : 0.4);
      }
      for (const id in actors) if (!seen[id]) removeActor(id);
      for (const id in flights) if (!seen[id]) updateFlight(flights[id], null, dt);
      // the chase camera was placed before the flights moved (so LOD / far fx use it): re-anchor on where the round really is now
      if (chase.anchored) {
        const f = flights[chase.id];
        if (f) { _w.subVectors(f.pos, chase.anchor); chase.pos.add(_w); chase.lastCam.add(_w); chase.last.copy(f.pos); camera.position.addScaledVector(_w, chase.w); camera.updateMatrixWorld(); }
        chase.anchored = false;
      }
      eoUpdate(dt, state);                   // V1.3: the tracker slews/zooms onto the selected track (actors are placed by now)
      skyGroup.position.copy(camera.position);
      updateFarGround(camera.position.x, camera.position.z);
      updateCloudDeck(dt);
      fogFor(chase.mode ? chase.fog : 0);

      // night work lights on the TELs (camera-facing glows on the mast tops)
      if (night) for (const id in tels) { const o = tels[id].obj.position; glow.spawn(o.x, o.y + 4.6, o.z, 0, 0, 0, FX.work, 1); }
      // persistent emitters
      for (let i = emitters.length - 1; i >= 0; i--) {
        const e = emitters[i]; if (time > e.until) { emitters.splice(i, 1); continue; }
        e.acc += dt * e.rate;
        while (e.acc >= 1) {
          e.acc -= 1; const ex = e.x + (Math.random() - 0.5) * 6 * e.k, ez = e.z + (Math.random() - 0.5) * 6 * e.k, q = fxPos(ex, e.y, ez);
          const two = q.k < 1 && eoSees(ex, e.y, ez), vx = (Math.random() - 0.5) * 2, vy = e.o === FX.column ? 24 : 5, fire = Math.random() < 0.4;
          LAY = two ? 1 : 0;
          smoke.spawn(q.x, q.y, q.z, vx * q.k, vy * q.k, 2 * q.k, e.o, e.k * q.k);
          if (fire) glow.spawn(q.x, q.y, q.z, 0, 1.5 * q.k, 0, FX.fire, 0.6 * e.k * q.k);
          if (two) { LAY = 2; smoke.spawn(ex, e.y, ez, vx, vy, 2, e.o, e.k); if (fire) glow.spawn(ex, e.y, ez, 0, 1.5, 0, FX.fire, 0.6 * e.k); }
          LAY = 0;
        }
      }
      updateThrown(dt);
      updateDebris(dt);
      updateEnv(dt);
      flashT = Math.max(0, flashT - dt * 3);
      flashLight.intensity = flashT * (env.cur && env.cur.night ? 6 : 2.5);
      smoke.update(dt); glow.update(dt); flare.update(dt); farSys.update(dt); updateTracers(dt);
      if (cab) { camera.updateMatrixWorld(); cabinQuads(); if (shelter.visible) cabinLight(); }
      renderFrame();
      if (RS.cabin) RS.cabin.update();         // DOM screens follow this frame's camera
    },
    screenQuad,

    heightAt,
    launcherPos(id) {
      if (id === 'ASSET') return { x: ASSET.x, y: ASSET.y, z: ASSET.z };
      const L = LAYOUT[id] || LAYOUT.L1;
      return { x: L.x, y: L.y + (HEIGHT_FOR[id] || 3), z: L.z };
    },
    listener() {
      // audio stays at the hatch while the kill cam rides a missile (no doppler weirdness, you hear it from the site)
      const p = camera && !chase.mode ? camera.position : { x: 0, y: heightAt(0, 0) + EYE, z: 0 };
      return { pos: { x: p.x, y: p.y, z: p.z }, headingDeg: VIEW_BRG };
    },
    setEnv(o) {
      o = o || {};
      if (o.time && PRESETS[o.time] && o.time !== 'ember') env.time = o.time;
      if (o.sky && VIS_KM[o.sky]) { env.sky = o.sky; if (!o.weather) env.weather = 'clear'; }
      if (o.weather === 'clear' || o.weather === 'storm') env.weather = o.weather;   // old alias: storm = rain + lightning
      if (o.visKm !== undefined) env.visKm = +o.visKm > 0 ? +o.visKm : 0;
      if (scene) applyEnv();
      return { time: env.time, sky: env.sky, weather: env.weather, visKm: env.cur ? env.cur.visKm : 0 };
    },
    shake(i) { if (chase.mode) return; shakeT = clamp(Math.max(shakeT, (+i || 0) * (REDUCED ? 0.5 : 1)), 0, 1); },
    // test/debug helpers
    debug: {
      get renderer() { return renderer; }, get scene() { return scene; }, get camera() { return camera; },
      get tels() { return tels; }, get flights() { return flights; }, get actors() { return actors; },
      particles() { return { smoke: smoke.n, glow: glow.n, flare: flare.n }; },
      clearFx() { smoke.n = glow.n = flare.n = farSys.n = 0; emitters.length = 0; for (const d of debris) { d.on = false; d.o.visible = false; } },   // screenshots: a clean sky
      get eo() { return eo; }, eoSees,
      get cabin() { return cab ? { group: cab.group, scene: cabScene, tris: cab.tris, quads: Q, stats: eo.stats.cab, rectN: eo.rectN, rectS: eo.rectS } : null; },
      get env() { return env.cur; }, get chase() { return { id: chase.id, mode: chase.mode, t: chase.t }; }, get farGround() { return farGround; }, get cloudDeck() { return cloudDeck; }, get shelter() { return shelter; }, get quality() { return { level: perf.level, grass: grassLayers.reduce((a, L) => a + L.mesh.count, 0), grassFull }; }, get grassMesh() { return grassMesh; }, get radars() { const y = o => o && o.userData.head ? +o.userData.head.rotation.y.toFixed(2) : null; return { search: y(radar), fc: y(ground.FC), la: y(ground.LA), gunRadar: gun && gun.userData.searchRadar ? +gun.userData.searchRadar.rotation.y.toFixed(2) : null }; }, get shakeT() { return shakeT; },
      timeScale: 1                           // tests slow effects down to photograph them under software WebGL
    }
  };
  RS.scene = api;
})();
