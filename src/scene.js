/* =====================================================================
   RED SKIES — scene.js   RS.scene : the view out of the shelter hatch.
   Reads state.visible / missiles / battery / radar / gun. Never reads tracks.
   API: init, resize, render, heightAt, launcherPos, listener, setEnv, shake, debug
        title: setTitle(on), titleLaunch(id) → missileId, titleProbe(missileId), titleOn — cover-page cinematic (v19)
   ===================================================================== */
(function () {
  const RS = window.RS;
  const D2R = Math.PI / 180;
  const VIEW_BRG = 25;                       // hatch faces NNE (deg true)
  const EYE = 1.3, PITCH = 10;
  const FAR_AIR = 4500;                      // aircraft beyond this (m) draw as a speck + contrail instead of a sub-pixel model
  const FAR_FX = 8000;                       // effects further than this are pulled in along the view ray (angular size kept)
  let REDUCED = false;
  try { REDUCED = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { /* ignore */ }

  let renderer, scene, camera, models, shelter, time = 0, simT = -1, simAge = 0, lastState = null;
  let hemi, sun, workLight, flashLight, skyMesh, skyGeo, stars, moon, rain, bolt, sunSpr, sunHalo;
  let smoke, glow, flare, tracers, farSys;  // particle systems
  const U = { scale: { value: 400 }, maxPx: { value: 256 }, fogColor: { value: new THREE.Color() }, fogNear: { value: 1000 }, fogFar: { value: 5000 } };
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
    FC: { rel: 11, dist: 120, face: VIEW_BRG + 11 - 70, kind: 'radar_fc' },                  // fire-control PESA on its mast
    LA: { rel: -13, dist: 210, face: VIEW_BRG - 13 + 40, kind: 'radar_lowalt', lod: 'low' },  // low-altitude radar tower
    CP: { rel: 15, dist: 98, face: VIEW_BRG + 15 + 95, kind: 'command_post' },
    GEN: { rel: 25, dist: 110, face: VIEW_BRG + 25 + 150, kind: 'generator' }
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
  // one dry-steppe tuft (alpha): tapered blades fanning from the base in straw / wheat / grey-beige, some feather-grass plumes.
  // Built as a DataTexture whose transparent texels carry the average blade colour, so mipmaps don't grow dark fringes.
  const texTuft = () => {
    const N = 256, c = document.createElement('canvas'); c.width = c.height = N;
    const g = c.getContext('2d'), r = rng(77);
    const PAL = [[232, 222, 196], [218, 206, 176], [202, 194, 170], [238, 232, 214], [188, 180, 154], [164, 162, 132]];   // near-neutral: the instance colour carries the hue
    const blade = (bx, h, lean, w, col, curl) => {                    // filled, tapered, slightly curved blade
      const tx = bx + lean, ty = N - h, mx = bx + lean * (0.25 + curl), my = N - h * 0.55;
      const gr = g.createLinearGradient(0, N, 0, ty);
      const [R, G, B] = col;
      gr.addColorStop(0, `rgb(${R * 0.78 | 0},${G * 0.76 | 0},${B * 0.7 | 0})`); gr.addColorStop(0.5, `rgb(${R},${G},${B})`);
      gr.addColorStop(1, `rgb(${Math.min(255, R * 1.08) | 0},${Math.min(255, G * 1.08) | 0},${Math.min(255, B * 1.1) | 0})`);
      g.fillStyle = gr; g.beginPath();
      g.moveTo(bx - w, N); g.quadraticCurveTo(mx - w * 0.6, my, tx, ty); g.quadraticCurveTo(mx + w * 0.6, my, bx + w, N); g.closePath(); g.fill();
      return [tx, ty];
    };
    for (let i = 0; i < 70; i++) {
      const back = i < 30;                                            // back layer: shorter, a bit darker (depth inside the tuft)
      const bx = N * (0.3 + r() * 0.4), h = N * (back ? 0.4 + r() * 0.35 : 0.55 + r() * 0.43), lean = (r() - 0.5) * N * (0.25 + (h / N) * 0.35);
      const base = PAL[(r() * PAL.length) | 0], k = back ? 0.84 : 1, col = base.map(v => v * k * (0.94 + r() * 0.12));
      const [tx, ty] = blade(bx, h, lean, 0.9 + r() * 1.5, col, (r() - 0.5) * 0.3);
      if (!back && r() < 0.22) {                                      // feather-grass plume: silky, pale, drooping from the tip
        g.strokeStyle = 'rgba(244,238,220,0.85)'; g.lineCap = 'round'; g.lineWidth = 1.1;
        const dir = lean >= 0 ? 1 : -1, L = N * (0.12 + r() * 0.1);
        g.beginPath(); g.moveTo(tx, ty); g.quadraticCurveTo(tx + dir * L * 0.6, ty - L * 0.15, tx + dir * L, ty + L * 0.45); g.stroke();
        g.lineWidth = 2.6; g.strokeStyle = 'rgba(244,238,220,0.28)'; g.stroke();
      } else if (!back && r() < 0.18) {                               // seed head
        g.fillStyle = 'rgb(214,190,132)'; g.save(); g.translate(tx, ty + 6); g.rotate(Math.atan2(lean, h) * 0.8);
        g.beginPath(); g.ellipse(0, 0, 2.2, 8, 0, 0, 7); g.fill(); g.restore();
      }
    }
    const img = g.getImageData(0, 0, N, N).data, data = new Uint8Array(N * N * 4);
    let sr = 0, sg = 0, sb = 0, n = 0;
    for (let i = 0; i < img.length; i += 4) if (img[i + 3] > 200) { sr += img[i]; sg += img[i + 1]; sb += img[i + 2]; n++; }
    const avg = [sr / n, sg / n, sb / n];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {       // DataTexture rows run bottom-up
      const si = ((N - 1 - y) * N + x) * 4, di = (y * N + x) * 4, a = img[si + 3];
      const k = a / 255;
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
    attribute float size; attribute float alpha; attribute vec3 pcol;
    uniform float uScale, uMinPx, uMaxPx, uFogNear, uFogFar, uFogK;
    varying float vA; varying vec3 vC; varying float vF;
    #include <common>
    #include <logdepthbuf_pars_vertex>
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      float d = max(0.1, -mv.z);
      gl_PointSize = clamp(max(size * uScale / d, uMinPx), 0.0, uMaxPx);
      vA = alpha; vC = pcol; vF = uFogK * smoothstep(uFogNear, uFogFar, d);
      gl_Position = projectionMatrix * mv;
      #include <logdepthbuf_vertex>
    }`;
  const PFS = `
    uniform sampler2D map; uniform vec3 uFogColor; uniform float uAdd;
    varying float vA; varying vec3 vC; varying float vF;
    #include <logdepthbuf_pars_fragment>
    void main() {
      #include <logdepthbuf_fragment>
      vec4 t = texture2D(map, gl_PointCoord);
      float a = t.a * vA;
      if (a < 0.004) discard;
      vec3 c = uAdd > 0.5 ? vC * (1.0 - vF) : mix(vC, uFogColor, vF);
      gl_FragColor = vec4(c, a);
    }`;
  let smokeLight = 0.85;                     // brightness of non-additive smoke for the current light (day 1, dusk .85, night .3)
  class PSys {
    constructor(cap, tex, additive, minPx, fogK, order) {
      this.cap = cap; this.n = 0; this.rr = 0; this.add = !!additive;
      const F = k => new Float32Array(cap * k);
      this.P = F(3); this.C = F(3); this.S = F(1); this.A = F(1);
      this.d = { vx: F(1), vy: F(1), vz: F(1), age: F(1), life: F(1), s0: F(1), s1: F(1), a0: F(1), drag: F(1), rise: F(1) };
      const g = this.geo = new THREE.BufferGeometry();
      const at = (a, k) => new THREE.BufferAttribute(a, k).setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('position', at(this.P, 3)); g.setAttribute('pcol', at(this.C, 3));
      g.setAttribute('size', at(this.S, 1)); g.setAttribute('alpha', at(this.A, 1));
      g.setDrawRange(0, 0);
      const m = new THREE.ShaderMaterial({
        uniforms: { map: { value: tex }, uScale: U.scale, uMaxPx: U.maxPx, uMinPx: { value: minPx }, uFogColor: U.fogColor,
          uFogNear: U.fogNear, uFogFar: U.fogFar, uFogK: { value: fogK }, uAdd: { value: additive ? 1 : 0 } },
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
      this.S[i] = d.s0[i]; this.A[i] = o.a0;
    }
    kill(i) {
      const j = --this.n, d = this.d;
      if (i === j) return;
      for (let k = 0; k < 3; k++) { this.P[i * 3 + k] = this.P[j * 3 + k]; this.C[i * 3 + k] = this.C[j * 3 + k]; }
      this.S[i] = this.S[j]; this.A[i] = this.A[j];
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
      const g = this.geo; g.setDrawRange(0, this.n);
      for (const k of ['position', 'pcol', 'size', 'alpha']) g.attributes[k].needsUpdate = true;
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
    ember: { life: 0.5, s0: 2.5, s1: 4, a0: 0.9, c: 0xff9a40, drag: 0.5 },
    flash: { life: 0.5, s0: 50, s1: 150, a0: 1, c: 0xfff1d6 },
    ball: { life: 1.6, s0: 18, s1: 50, a0: 0.95, c: 0xff8a2a, drag: 1.2, rise: 4 },
    puffBig: { life: 9, s0: 25, s1: 110, a0: 0.8, c: 0x1e1c1a, drag: 0.6, rise: 1.5 },
    muzzle: { life: 0.06, s0: 1.6, s1: 2.4, a0: 1, c: 0xffd08a },
    dot: { life: 0.001, s0: 0, a0: 0.9, c: 0x111214 },
    motor: { life: 0.001, s0: 2.2, a0: 1, c: 0xffd9a0 },
    navR: { life: 0.001, s0: 0.8, a0: 1, c: 0xff3020 }, navG: { life: 0.001, s0: 0.8, a0: 1, c: 0x30ff60 },
    navW: { life: 0.001, s0: 1.2, a0: 1, c: 0xffffff }, work: { life: 0.001, s0: 1.4, a0: 0.9, c: 0xffe2a8 }
  };
  // world position for an effect at sim (x km, y km, alt m); far ones are pulled in to FAR_FX along the ray
  function fxPos(px, py, pz) {
    const c = camera.position; _v.set(px - c.x, py - c.y, pz - c.z);
    const d = _v.length(), k = d > FAR_FX ? FAR_FX / d : 1;
    return { x: c.x + _v.x * k, y: c.y + _v.y * k, z: c.z + _v.z * k, k, d };
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
      const t = clamp(h / 260, 0, 1), pad = 1 - sstep(60, 240, Math.hypot(x, z));
      // summer steppe: straw-gold fields with greener hollows (macro patches from the same value noise as the hills)
      const patch = vnoise(x / 420 + 11, z / 420 - 7), dry = sstep(0.35, 0.65, patch);
      c.setRGB(0.28 + 0.14 * dry + 0.10 * t, 0.29 + 0.08 * dry + 0.04 * t, 0.15 + 0.04 * dry + 0.08 * t);
      c.offsetHSL(0, 0, (hash(i, 7) - 0.5) * 0.04);
      c.lerp(new THREE.Color(0.27, 0.26, 0.19), pad * 0.5);                // trampled/gravel battery pad
      cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    geo.computeVertexNormals();
    const det = texGround(); det.wrapS = det.wrapT = THREE.RepeatWrapping; det.repeat.set(size / 9, size / 9);
    det.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 1);
    scene.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, map: det })));
  }
  /* ---------------- grass: instanced crossed-quad tufts in the hatch's view, swaying in the wind ---------------- */
  const grassU = { uTime: { value: 0 }, uWind: { value: 1 }, uSun: { value: new THREE.Color(0, 0, 0) } };
  let grassGust = 0, grassMesh = null, grassFull = 0;
  // auto-quality: if frames run slow for ~3 s, thin the grass, then lower the render resolution (phones differ a lot)
  const perf = { acc: 0, n: 0, level: 0 };
  function autoQuality(rawDt) {
    if (perf.level >= 3 || !(rawDt > 0) || api.lockQuality) return;   // lockQuality: test/screenshot hook
    perf.acc += rawDt; perf.n++;
    if (perf.acc < 3) return;
    const avg = perf.acc / perf.n; perf.acc = 0; perf.n = 0;
    if (avg < 1 / 40) return;                                        // ≥ 40 fps: keep full quality
    perf.level++;
    if (perf.level === 1 && grassMesh) grassMesh.count = Math.round(grassFull * 0.55);
    else if (perf.level === 2 && grassMesh) grassMesh.count = Math.round(grassFull * 0.3);
    else if (perf.level === 3) { renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.1)); api.resize(renderer.domElement.clientWidth, renderer.domElement.clientHeight); }
  }
  function buildGrass() {
    const tex = texTuft(); tex.anisotropy = 4;
    // crossed quads, 1 m wide × 1 m tall, base at y = 0; normals point up so tufts light like the ground
    const P = [], U = [], I = [];
    for (let k = 0; k < 2; k++) {                                   // 2 crossed quads (less overdraw than 3 on phone GPUs)
      const a = k * Math.PI / 2, cx = Math.cos(a) * 0.5, cz = Math.sin(a) * 0.5, b = P.length / 3;
      P.push(-cx, 0, -cz, cx, 0, cz, cx, 1, cz, -cx, 1, -cz); U.push(0, 0, 1, 0, 1, 1, 0, 1);
      I.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(P.map((v, i) => (i % 3 === 1 ? 1 : 0)), 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); geo.setIndex(I);
    const mat = new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.36, side: THREE.DoubleSide });
    // (alphaToCoverage left off: costly on mobile GPUs)
    mat.onBeforeCompile = sh => {
      sh.uniforms.uTime = grassU.uTime; sh.uniforms.uWind = grassU.uWind; sh.uniforms.uSun = grassU.uSun;
      sh.vertexShader = 'uniform float uTime; uniform float uWind; varying float vBend;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        float gh = max(position.y, 0.0);
        vec4 gp = instanceMatrix[3];
        float ph = uTime * 1.7 + gp.x * 0.09 + gp.z * 0.06;
        // travelling gust bands roll across the field (the silvery waves you see on real steppe grass)
        float wave = sin(dot(gp.xz, vec2(0.052, 0.031)) - uTime * 1.35) * 0.5 + 0.5;
        wave = wave * wave * wave;
        float sw = (sin(ph) * 0.45 + sin(ph * 2.3 + 1.7) * 0.15 + 0.3 + wave * 0.9) * uWind;
        transformed.x += sw * gh * gh * 0.32; transformed.z += sw * gh * gh * 0.18;
        transformed.y -= abs(sw) * gh * gh * 0.06;
        vBend = wave * min(uWind, 1.6);`);
      // back faces of the crossed quads must light like the front (Lambert would light them from below → black specks)
      sh.fragmentShader = 'uniform vec3 uSun; varying float vBend;\n' + sh.fragmentShader.replace(/:\s*vLightBack\s*;/g, ': vLightFront;').replace(/:\s*vIndirectBack\s*;/g, ': vIndirectFront;')
        .replace('#include <map_fragment>', `#include <map_fragment>
          diffuseColor.rgb *= mix(0.42, 1.12, smoothstep(0.0, 0.85, vUv.y));   // self-shadow inside the tuft
          diffuseColor.rgb *= 1.0 + 0.16 * vBend * vUv.y;                     // bent blades show their pale undersides`)
        .replace('#include <output_fragment>', `outgoingLight += uSun * diffuseColor.rgb * (0.34 * vUv.y * vUv.y);   // low sun glowing through the tips
          #include <output_fragment>`);
    };
    const keep = [];
    const r = rng(4242), N_NEAR = 4600, N_FAR = 7400, N = N_NEAR + N_FAR;
    const clear = [['L1', 15], ['L2', 15], ['L3', 12], ['G1', 8], ['RADAR', 13], ['FC', 11], ['LA', 8], ['CP', 10], ['GEN', 6]];
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new V3(), pp = new V3(), col = new THREE.Color(), Y = new V3(0, 1, 0);
    const straw = new THREE.Color(0xe2c992), olive = new THREE.Color(0x9a9262), dryg = new THREE.Color(0xcbb282), grey = new THREE.Color(0xb0aa98);
    const mesh = new THREE.InstancedMesh(geo, mat, N);
    let n = 0;
    for (let i = 0; i < N * 4 && n < N; i++) {
      const near = n < N_NEAR;
      const b = VIEW_BRG + (r() - 0.5) * (near ? 76 : 88), d = near ? 4.5 + Math.pow(r(), 1.2) * 26 : 30 + Math.pow(r(), 1.6) * 240;
      const [dx, dz] = dirOf(b), x = dx * d, z = dz * d;
      if (clear.some(([id, rad]) => Math.hypot(x - LAYOUT[id].x, z - LAYOUT[id].z) < rad)) continue;
      const clump = vnoise(x / 7 + 3, z / 7 - 5);                     // grass grows in clumps with thinner ground between
      if (r() > (near ? 0.12 : 0.3) + sstep(0.25, 0.75, clump) * 1.1) continue;
      const close = sstep(12, 5, d);                                  // the nearest tufts are bigger so single blades read
      const h = (0.24 + r() * 0.3 + clump * 0.22) * (d > 60 ? 1.35 : 1) * (1 + close * 0.35), w = (0.6 + r() * 0.6 + (d > 60 ? 0.5 : 0)) * (1 + close * 0.3);   // knee-high steppe grass (keeps vehicle wheels readable)
      q.setFromAxisAngle(Y, r() * 6.283);
      m.compose(pp.set(x, heightAt(x, z) - 0.05, z), q, sc.set(w, h, w));
      mesh.setMatrixAt(n, m);
      const dry = vnoise(x / 60, z / 60), fine = vnoise(x / 11 - 9, z / 11 + 4);
      col.copy(olive).lerp(straw, 0.3 + 0.7 * sstep(0.25, 0.7, dry)).lerp(dryg, fine * 0.6).multiplyScalar(0.7 + clump * 0.22 + r() * 0.1);
      if (r() < 0.06) col.lerp(grey, 0.6);                          // the odd bleached, grey dead tuft
      mesh.setColorAt(n, col);
      n++;
    }
    mesh.count = n; mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.frustumCulled = false; scene.add(mesh);
    grassMesh = mesh; grassFull = n;
  }
  function buildSky() {
    skyGeo = new THREE.SphereGeometry(9500, 24, 12);
    skyGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(skyGeo.attributes.position.count * 3), 3));
    skyMesh = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
    skyMesh.renderOrder = -1; scene.add(skyMesh);
    // stars
    const r = rng(99), N = 700, P = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const a = r() * 6.283, e = Math.asin(0.04 + r() * 0.96);
      P[i * 3] = Math.cos(e) * Math.sin(a) * 9000; P[i * 3 + 1] = Math.sin(e) * 9000; P[i * 3 + 2] = Math.cos(e) * Math.cos(a) * 9000;
    }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(P, 3));
    stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xcfd8ff, size: 1.6, sizeAttenuation: false, fog: false, depthWrite: false, transparent: true, opacity: 0.85 }));
    stars.frustumCulled = false; scene.add(stars);
    // moon (disc sprite), bearing 48°, 22° up
    moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: canvasTex((g, N) => {
      const gr = g.createRadialGradient(N / 2, N / 2, N * 0.2, N / 2, N / 2, N / 2);
      gr.addColorStop(0, 'rgba(235,240,255,1)'); gr.addColorStop(0.36, 'rgba(225,232,250,1)'); gr.addColorStop(0.42, 'rgba(160,180,230,0.25)'); gr.addColorStop(1, 'rgba(120,140,200,0)');
      g.fillStyle = gr; g.fillRect(0, 0, N, N);
      g.fillStyle = 'rgba(150,160,180,0.35)'; [[0.42, 0.44, 0.07], [0.58, 0.55, 0.05], [0.5, 0.6, 0.04]].forEach(([x, y, rr]) => { g.beginPath(); g.arc(x * N, y * N, rr * N, 0, 7); g.fill(); });
    }, 128), fog: false, depthWrite: false, transparent: true }));
    const [mx, mz] = dirOf(48); moon.position.set(mx * 8500 * 0.93, 8500 * 0.37, mz * 8500 * 0.93); moon.scale.setScalar(320);
    scene.add(moon);
    // [v19] title sun: a low, swollen disc + wide halo (only shown on the cover page)
    const sunTex = canvasTex((g, N) => {
      const gr = g.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2);
      gr.addColorStop(0, 'rgba(255,236,200,1)'); gr.addColorStop(0.3, 'rgba(255,190,120,1)'); gr.addColorStop(0.38, 'rgba(255,120,60,0.55)');
      gr.addColorStop(0.55, 'rgba(255,80,40,0.12)'); gr.addColorStop(1, 'rgba(255,60,30,0)');
      g.fillStyle = gr; g.fillRect(0, 0, N, N);
    }, 256);
    sunSpr = new THREE.Sprite(new THREE.SpriteMaterial({ map: sunTex, fog: false, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending }));
    sunSpr.scale.setScalar(900); sunSpr.visible = false; sunSpr.renderOrder = 0; scene.add(sunSpr);
    const haloTex = canvasTex((g, N) => {
      const gr = g.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2);
      gr.addColorStop(0, 'rgba(255,120,60,0.55)'); gr.addColorStop(0.4, 'rgba(230,70,40,0.18)'); gr.addColorStop(1, 'rgba(200,40,30,0)');
      g.fillStyle = gr; g.fillRect(0, 0, N, N);
    }, 128);
    sunHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, fog: false, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending }));
    sunHalo.scale.setScalar(5200); sunHalo.visible = false; scene.add(sunHalo);
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
      scene.add(im);
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
      if (th.ign < 0) { for (let j = 0; j < 2; j++) smoke.spawn(_v.x + _rnd(-0.6, 0.6), _v.y - _rnd(0, 1.5), _v.z + _rnd(-0.6, 0.6), _rnd(-1.5, 1.5), _rnd(-3, 1), _rnd(-1.5, 1.5), FX.throwTrail, _rnd(0.8, 1.2)); continue; }
      th.ign += dt;
      if (th.ign < 1.4) {                     // first ~1.4 s of burn: blinding plume pushed down onto the site
        glow.spawn(_v.x, _v.y, _v.z, 0, -6, 0, FX.ignFire, 0.8 * th.k);
        for (let j = 0; j < 2; j++) smoke.spawn(_v.x + _rnd(-2, 2), _v.y - _rnd(0, 4), _v.z + _rnd(-2, 2), _rnd(-6, 6), _rnd(-26, -10) * th.k, _rnd(-6, 6), FX.exhaust, _rnd(0.8, 1.3) * th.k);
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
  const actors = {};                         // entity id → { root, hi, lo, spec, useLo, prev:{hdg,alt,t}, bank, trailT }
  function actorFor(v) {
    let a = actors[v.id];
    if (a) return a;
    const spec = specFor(v), root = new THREE.Group();
    root.rotation.order = 'YXZ';
    a = actors[v.id] = { root, spec, hi: null, lo: null, useLo: null, bank: 0, pitch: 0, hdgPrev: v.hdg, altPrev: v.alt, trailT: 0, vy: 0, P: new V3(), t0: simT };
    scene.add(root);
    return a;
  }
  function setLod(a, lo) {
    if (a.useLo === lo) return;
    a.useLo = lo;
    const key = lo ? 'lo' : 'hi';
    if (!a[key]) { a[key] = makeModel(a.spec, lo ? 'low' : 'high'); a.root.add(a[key]); }
    if (a.hi) a.hi.visible = !lo; if (a.lo) a.lo.visible = lo;
  }
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
    f.m.position.copy(f.pos);
    if (f.vel.lengthSq() > 1) f.m.quaternion.setFromUnitVectors(_Z, _v.copy(f.vel).normalize());
    if (f.m.userData.update) f.m.userData.update(dt);
    // trail + motor glow at the tail
    const len = (f.m.userData.length || 6) * 0.5 + 0.6;
    _v.set(0, 0, -len).applyQuaternion(f.m.quaternion).add(f.pos);
    // [RS] motor burnout (sim: Lance ~12.5 s, Dart ~5.8 s after launch): flame out, no new smoke; the old trail drifts away
    const lit = !(v && v.burning === false && f.own && f.age > 1);
    if (!lit && !f.out) { f.out = true; if (f.m.userData.setMotor) f.m.userData.setMotor(false); }
    if (lit && f.lostT < 0.8) glow.spawn(_v.x, _v.y, _v.z, 0, 0, 0, FX.motor, 1);
    // puffs every ~6 m along the path, interpolated back to last frame's tail so low frame rates don't leave gaps
    if (!f.tail) f.tail = _v.clone();
    const seg = _w.subVectors(_v, f.tail), segL = seg.length(), step = f.aim ? 11 : 6;
    if (f.lostT < 1 && lit) {
      let s = f.trailT;
      for (; s < segL && s < 400; s += step) {
        const k = s / segL;
        smoke.spawn(f.tail.x + seg.x * k + (Math.random() - 0.5), f.tail.y + seg.y * k + (Math.random() - 0.5), f.tail.z + seg.z * k + (Math.random() - 0.5), (Math.random() - 0.5) * 1.5, 0.3, (Math.random() - 0.5) * 1.5, FX.trail, 1);
      }
      f.trailT = Math.max(0, s - segL);
    }
    f.tail.copy(_v);
  }

  /* ---------------- debris pool ---------------- */
  const debris = [];
  function spawnDebris(p, n) {
    for (let i = 0; i < n; i++) {
      const d = debris.find(x => !x.on); if (!d) return;
      d.on = true; d.t = 0; d.o.visible = true; d.o.position.set(p.x, p.y, p.z);
      d.v.set((Math.random() - 0.5) * 60, Math.random() * 25, (Math.random() - 0.5) * 60).multiplyScalar(p.k);
      d.w.set(Math.random() * 4, Math.random() * 4, Math.random() * 4); d.k = p.k; d.o.scale.setScalar(1.4 * p.k);
    }
  }
  function updateDebris(dt) {
    for (const d of debris) {
      if (!d.on) continue;
      d.t += dt; d.v.y -= 9.8 * dt * d.k; d.v.multiplyScalar(1 - 0.12 * dt);
      d.o.position.addScaledVector(d.v, dt);
      d.o.rotation.x += d.w.x * dt; d.o.rotation.y += d.w.y * dt;
      const p = d.o.position;
      if (Math.random() < dt * 22) glow.spawn(p.x, p.y, p.z, 0, 2, 0, FX.fire, d.k * 0.5);
      if (Math.random() < dt * 14) smoke.spawn(p.x, p.y, p.z, 0, 1, 0, FX.dark, d.k * 0.4);
      if (d.t > 16 || p.y < heightAt(p.x, p.z)) { d.on = false; d.o.visible = false; }
    }
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

  /* ---------------- environment ---------------- */
  const PRESETS = {
    day: { top: 0x3f74b0, mid: 0x86aed2, hor: 0xcdd9e2, fog: 0xb3c2d0, fn: 1600, ff: 7200, hs: 0xc4d6ee, hg: 0x3e3b2a, hi: 0.85, sc: 0xfff3e2, si: 1.05, sp: [-1500, 3200, 1200], stars: 0, moon: 0 },
    dusk: { top: 0x0e1830, mid: 0x4a3a4c, hor: 0xc0643a, fog: 0x8a5a4a, fn: 1200, ff: 5200, hs: 0x8a90b0, hg: 0x2a2618, hi: 0.75, sc: 0xffc49a, si: 0.9, sp: [-3000, 1200, 2000], stars: 0, moon: 0 },
    // [v19] cover page: crimson dusk, sun sitting on the horizon behind the battery (bearing sb, elevation se)
    ember: { top: 0x0a0816, mid: 0x3c1626, hor: 0xe0482a, fog: 0x6e2c24, fn: 700, ff: 5200, hs: 0x8a6a80, hg: 0x2a1812, hi: 0.62, sc: 0xff9a60, si: 0.85, sp: [0, 0, 0], stars: 0.35, moon: 0, glow: 0xffa050, sb: 22, se: 2.2 },
    night: { top: 0x02040b, mid: 0x060a16, hor: 0x121a2a, fog: 0x0b1019, fn: 700, ff: 4600, hs: 0x2a3a58, hg: 0x06070a, hi: 0.32, sc: 0x9fb4d8, si: 0.28, sp: [2500, 3000, -3500], stars: 1, moon: 1 }
  };
  const env = { time: 'dusk', weather: 'clear', evNight: false, evStorm: false, cur: null, lightning: 0, nextBolt: 6 };
  function applyEnv() {
    const night = env.evNight || env.time === 'night', storm = env.evStorm || env.weather === 'storm';
    const P = title.on ? PRESETS.ember : PRESETS[night ? 'night' : env.time] || PRESETS.dusk, C = h => new THREE.Color(h);
    smokeLight = title.on ? 0.5 : (night ? 0.3 : env.time === 'day' ? 1 : 0.85) * (storm ? 0.75 : 1);
    const top = C(P.top), mid = C(P.mid), hor = C(P.hor), fog = C(P.fog);
    let fn = P.fn, ff = P.ff, hi = P.hi, si = P.si;
    if (storm) {
      const g = night ? [0x07090c, 0x0e1116, 0x161a20, 0x12151a] : [0x3a3f45, 0x4d5358, 0x5d6368, 0x565c61];
      top.lerp(C(g[0]), 0.85); mid.lerp(C(g[1]), 0.85); hor.lerp(C(g[2]), 0.85); fog.lerp(C(g[3]), 0.9);
      fn = 150; ff = night ? 1900 : 2400; hi *= 0.7; si *= 0.25;
    }
    const pos = skyGeo.attributes.position, col = skyGeo.attributes.color, c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 9500;
      if (y > 0.25) c.copy(mid).lerp(top, Math.min(1, (y - 0.25) / 0.5)); else c.copy(hor).lerp(mid, Math.max(0, y / 0.25));
      if (y < 0) c.copy(hor).lerp(fog, Math.min(1, -y * 4));
      if (P.glow) {                              // warm bloom toward the sun, strongest on the horizon
        const [gx, gz] = dirOf(P.sb), l = Math.hypot(pos.getX(i), pos.getZ(i)) || 1;
        const d = Math.max(0, (pos.getX(i) * gx + pos.getZ(i) * gz) / l), k = Math.pow(d, 5) * Math.max(0, 1 - Math.abs(y) * 2.6);
        c.lerp(C(P.glow), Math.min(0.85, k));
      }
      col.setXYZ(i, c.r, c.g, c.b);
    }
    col.needsUpdate = true;
    scene.fog.color.copy(fog); scene.fog.near = fn; scene.fog.far = ff; renderer.setClearColor(fog);
    U.fogColor.value.copy(fog); U.fogNear.value = fn; U.fogFar.value = ff;
    hemi.color.set(P.hs); hemi.groundColor.set(P.hg); hemi.intensity = hi;
    sun.color.set(P.sc); sun.intensity = si; sun.position.set(P.sp[0], P.sp[1], P.sp[2]);
    if (P.sb !== undefined) {                     // sun from bearing/elevation; the disc sits on the horizon
      const [sx, sz] = dirOf(P.sb), ce = Math.cos(P.se * D2R), se = Math.sin(P.se * D2R);
      sun.position.set(sx * 3000, 3000 * Math.max(0.08, se), sz * 3000);
      sunSpr.position.set(sx * 8800 * ce, 8800 * se, sz * 8800 * ce); sunHalo.position.copy(sunSpr.position);
    }
    sunSpr.visible = sunHalo.visible = !!P.glow;
    stars.visible = P.stars > 0 && !storm; stars.material.opacity = P.stars * 0.85;
    moon.visible = !!P.moon && !storm;
    rain.ls.visible = storm;
    workLight.intensity = night ? 0.55 : 0;
    env.cur = { night, storm, hi, skyMul: 1 };
  }
  function updateEnv(dt) {
    const E = env.cur; if (!E) return;
    if (E.storm) {
      // rain streaks in a box ahead of the camera
      const R = rain, c = camera.position, [fx, fz] = dirOf(VIEW_BRG), cx = c.x + fx * 30, cz = c.z + fz * 30;
      for (let i = 0; i < R.d.length; i++) {
        const d = R.d[i]; d.y -= 26 * dt; if (d.y < -3) d.y += 40;
        const x = cx + d.x, y = c.y + d.y, z = cz + d.z, o = i * 6;
        R.P[o] = x; R.P[o + 1] = y; R.P[o + 2] = z; R.P[o + 3] = x + 0.25; R.P[o + 4] = y + 1.6; R.P[o + 5] = z;
      }
      R.ls.geometry.attributes.position.needsUpdate = true;
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

  /* ---------------- bus hookup ---------------- */
  let shakeT = 0;
  function onBus() {
    const on = (n, f) => RS.bus.on(n, f);
    on('LAUNCH', p => {
      const T = tels[p.launcherId]; if (!T) return;
      T.queue.push(p.missileId); queued[p.missileId] = p.launcherId;
    });
    on('INTERCEPT', p => {
      endFlight(p.missileId, false);
      const q = fxPos(p.x * 1000, p.alt, -p.y * 1000);
      burst(flare, q, FX.flash, 2, 0, 1); burst(glow, q, FX.ball, 6, 25, 0.8); burst(glow, q, FX.ember, 14, 120, 1.5); burst(smoke, q, FX.puffBig, 6, 14, 0.7);
      pulseLight(q.x, q.y, q.z, 1);
    });
    on('KILL', p => {
      const q = fxPos(p.x * 1000, p.alt, -p.y * 1000);
      burst(flare, q, FX.flash, 1, 0, 1.6); burst(glow, q, FX.ball, 16, 40, 1.3); burst(glow, q, FX.ember, 24, 160, 1.6);
      burst(smoke, q, FX.puffBig, 12, 22, 1); spawnDebris(q, 4);
      pulseLight(q.x, q.y, q.z, 1.2);
      if (q.d < 3000) api.shake(0.3 * (1 - q.d / 3000));
    });
    on('MISS', p => endFlight(p.missileId, true));
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
    on('SHIFT_START', () => {
      for (const id in actors) removeActor(id);
      for (const id in flights) endFlight(id, false);
      for (const id in queued) delete queued[id];
      for (const id in tels) tels[id].queue.length = 0;
      emitters.length = 0; radarDmg = 0; gunFire = 0; env.evNight = env.evStorm = false; applyEnv();
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
    title.on = on;
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

  /* ---------------- API ---------------- */
  const api = {
    setTitle, titleLaunch, titleProbe, get titleOn() { return title.on; }, get titleT() { return title.t; },
    init({ canvas, models: mdl }) {
      models = mdl || RS.models;
      // logarithmic depth: the view spans 0.3 m (shelter frame) to 9 km (hills) — linear depth z-fights at both ends
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', logarithmicDepthBuffer: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      renderer.shadowMap.enabled = false;
      try { const gl = renderer.getContext(), r = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE); if (r && r[1]) U.maxPx.value = Math.min(512, r[1]); } catch (e) { /* ignore */ }
      scene = new THREE.Scene();
      scene.fog = new THREE.Fog(0x8a5a4a, 1200, 5200);
      camera = new THREE.PerspectiveCamera(50, 1, 0.3, 12000);

      hemi = new THREE.HemisphereLight(0x8a90b0, 0x2a2618, 0.75); scene.add(hemi);
      sun = new THREE.DirectionalLight(0xffc49a, 0.9); sun.position.set(-3000, 1200, 2000); scene.add(sun);
      // always present (constant light count → no shader recompiles): battery work light + flash light
      workLight = new THREE.PointLight(0xffe0b0, 0, 170, 1.2);
      { const a = LAYOUT.L1, b = LAYOUT.L3; workLight.position.set((a.x + b.x) * 0.35, 9, (a.z + b.z) * 0.35); scene.add(workLight); }
      flashLight = new THREE.PointLight(0xffb070, 0, 3500, 1.4); scene.add(flashLight);

      buildSky();
      buildTerrain();
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

      shelter = models.create('shelter_interior');
      shelter.rotation.y = yawFor(VIEW_BRG);
      shelter.position.y = heightAt(0, 0);
      scene.add(shelter);

      applyEnv();
      onBus();
      api.resize(canvas.clientWidth || 390, canvas.clientHeight || 300);
      api.render(0, null);
      prewarm();
    },

    resize(w, h) {
      if (!renderer) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(1, h);
      camera.fov = title.on ? (camera.aspect < 1 ? 56 : 42) : camera.aspect < 1 ? 62 : 50;
      camera.updateProjectionMatrix();
      U.scale.value = h * renderer.getPixelRatio() / (2 * Math.tan(camera.fov * D2R / 2));
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
      grassU.uTime.value = time; if (sun) grassU.uSun.value.copy(sun.color).multiplyScalar(sun.intensity * clamp(1.3 - 1.2 * sun.position.y / Math.max(1, sun.position.length()), 0.15, 1));   // tips glow most with a low sun
      grassU.uWind.value = (env.evStorm || env.weather === 'storm' ? 2.2 : 1) + grassGust;
      // seated camera, hatch-facing, tiny idle sway + shake
      const [fx, fz] = dirOf(VIEW_BRG), [rx, rz] = dirOf(VIEW_BRG + 90);
      const sway = Math.sin(time * 0.7) * 0.015, bob = Math.sin(time * 0.43) * 0.008;
      shakeT = Math.max(0, shakeT - dt * 1.4);
      const sk = shakeT * shakeT, sh1 = (Math.sin(time * 61) + Math.sin(time * 37.3)) * 0.5 * sk, sh2 = (Math.sin(time * 53.7) + Math.sin(time * 29.1)) * 0.5 * sk;
      if (title.on) titleCam(sh1, sh2);
      else {
      camera.position.set(-fx * 0.45 + rx * (sway + sh1 * 0.03), heightAt(0, 0) + EYE + bob + sh2 * 0.03, -fz * 0.45 + rz * (sway + sh1 * 0.03));
      const lb = VIEW_BRG + Math.sin(time * 0.21) * 0.6 + sh1 * 1.6, [lx, lz] = dirOf(lb);
      camera.lookAt(camera.position.x + lx * 100, camera.position.y + 100 * Math.tan((PITCH + sh2 * 1.2) * D2R), camera.position.z + lz * 100);
      }
      camera.updateMatrixWorld();

      updateRadars(dt, state);
      updateBattery(dt, state);
      if (gun) updateGun(dt, state);

      // truth entities near the battery
      const vis = (state && state.visible) || [], seen = {}, cam = camera.position, night = env.cur && env.cur.night;
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
        const dist = a.root.position.distanceTo(cam), far = dist > FAR_AIR;
        a.root.visible = !far;
        if (!far) setLod(a, a.useLo ? dist > 1400 : dist > 1600);
        a.bank += (clamp((a.turn || 0) * 0.06, -1.1, 1.1) - a.bank) * Math.min(1, dt * 3);
        a.pitch += (Math.atan2(a.vy || 0, Math.max(40, spd)) - a.pitch) * Math.min(1, dt * 3);
        a.root.rotation.set(-a.pitch, yawFor(v.hdg), a.bank);
        const mdl = a.useLo ? a.lo : a.hi, rotor = mdl && mdl.userData.rotor; if (rotor && !far) rotor.rotation.y += dt * 30;
        // legibility dot (min 1.5 px) + night nav lights
        const P = a.root.position;
        if (far) { const q = fxPos(P.x, P.y, P.z); farSys.spawn(q.x, q.y, q.z, 0, 0, 0, FX.farDot, 1); }
        else if (dist > 900) smoke.spawn(P.x, P.y, P.z, 0, 0, 0, FX.dot, 1);
        if (night && far && v.kind !== 'cruise_missile' && v.kind !== 'arm_missile') {   // distant: one blinking light
          const q = fxPos(P.x, P.y, P.z);
          glow.spawn(q.x, q.y, q.z, 0, 0, 0, (time + (idHash(v.id) % 10) / 10) % 1.2 < 0.15 ? FX.navW : FX.navR, 1);
        } else if (night && v.kind !== 'cruise_missile' && v.kind !== 'arm_missile') {
          a.root.updateMatrixWorld();
          const span = v.kind === 'transport' ? 18 : v.kind.indexOf('helo') === 0 ? 2 : 6;
          _v.set(span, 0, 0).applyMatrix4(a.root.matrixWorld); glow.spawn(_v.x, _v.y, _v.z, 0, 0, 0, FX.navR, 1);
          _v.set(-span, 0, 0).applyMatrix4(a.root.matrixWorld); glow.spawn(_v.x, _v.y, _v.z, 0, 0, 0, FX.navG, 1);
          if ((time + (idHash(v.id) % 10) / 10) % 1.2 < 0.1) glow.spawn(P.x, P.y + 1.5, P.z, 0, 0, 0, FX.navW, 1.5);
        }
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
            if (far) {                     // pulled in along the view ray, angular size kept, light fog
              const q = fxPos(P.x + _v.x * back, P.y, P.z + _v.z * back);
              farSys.spawn(q.x, q.y, q.z, 0, 0, 0, FX.farTrail, q.k);
            } else {
              smoke.spawn(P.x + _v.x * back + sx, P.y, P.z + _v.z * back + Math.sin(h) * 3, 0, 0, 0, FX.contrail, 1);
              smoke.spawn(P.x + _v.x * back - sx, P.y, P.z + _v.z * back - Math.sin(h) * 3, 0, 0, 0, FX.contrail, 1);
            }
          }
        }
        if (v.kind === 'arm_missile' || v.kind === 'cruise_missile') glow.spawn(P.x + _v.x * 3, P.y, P.z + _v.z * 3, 0, 0, 0, FX.motor, v.kind === 'arm_missile' ? 1 : 0.4);
      }
      for (const id in actors) if (!seen[id]) removeActor(id);
      for (const id in flights) if (!seen[id]) updateFlight(flights[id], null, dt);

      // night work lights on the TELs (camera-facing glows on the mast tops)
      if (night) for (const id in tels) { const o = tels[id].obj.position; glow.spawn(o.x, o.y + 4.6, o.z, 0, 0, 0, FX.work, 1); }
      // persistent emitters
      for (let i = emitters.length - 1; i >= 0; i--) {
        const e = emitters[i]; if (time > e.until) { emitters.splice(i, 1); continue; }
        e.acc += dt * e.rate;
        while (e.acc >= 1) {
          e.acc -= 1; const q = fxPos(e.x + (Math.random() - 0.5) * 6 * e.k, e.y, e.z + (Math.random() - 0.5) * 6 * e.k);
          smoke.spawn(q.x, q.y, q.z, (Math.random() - 0.5) * 2 * q.k, (e.o === FX.column ? 24 : 5) * q.k, 2 * q.k, e.o, e.k * q.k);
          if (Math.random() < 0.4) glow.spawn(q.x, q.y, q.z, 0, 1.5 * q.k, 0, FX.fire, 0.6 * e.k * q.k);
        }
      }
      updateThrown(dt);
      updateDebris(dt);
      updateEnv(dt);
      flashT = Math.max(0, flashT - dt * 3);
      flashLight.intensity = flashT * (env.cur && env.cur.night ? 6 : 2.5);
      smoke.update(dt); glow.update(dt); flare.update(dt); farSys.update(dt); updateTracers(dt);
      renderer.render(scene, camera);
    },

    heightAt,
    launcherPos(id) {
      if (id === 'ASSET') return { x: ASSET.x, y: ASSET.y, z: ASSET.z };
      const L = LAYOUT[id] || LAYOUT.L1;
      return { x: L.x, y: L.y + (HEIGHT_FOR[id] || 3), z: L.z };
    },
    listener() {
      const p = camera ? camera.position : { x: 0, y: heightAt(0, 0) + EYE, z: 0 };
      return { pos: { x: p.x, y: p.y, z: p.z }, headingDeg: VIEW_BRG };
    },
    setEnv(o) {
      o = o || {};
      if (o.time && PRESETS[o.time]) env.time = o.time;
      if (o.weather === 'clear' || o.weather === 'storm') env.weather = o.weather;
      if (scene) applyEnv();
      return { time: env.time, weather: env.weather };
    },
    shake(i) { shakeT = clamp(Math.max(shakeT, (+i || 0) * (REDUCED ? 0.5 : 1)), 0, 1); },
    // test/debug helpers
    debug: {
      get renderer() { return renderer; }, get scene() { return scene; }, get camera() { return camera; },
      get tels() { return tels; }, get flights() { return flights; }, get actors() { return actors; },
      particles() { return { smoke: smoke.n, glow: glow.n, flare: flare.n }; },
      get env() { return env.cur; }, get quality() { return { level: perf.level, grass: grassMesh ? grassMesh.count : 0, grassFull }; }, get grassMesh() { return grassMesh; }, get radars() { const y = o => o && o.userData.head ? +o.userData.head.rotation.y.toFixed(2) : null; return { search: y(radar), fc: y(ground.FC), la: y(ground.LA), gunRadar: gun && gun.userData.searchRadar ? +gun.userData.searchRadar.rotation.y.toFixed(2) : null }; }, get shakeT() { return shakeT; },
      timeScale: 1                           // tests slow effects down to photograph them under software WebGL
    }
  };
  RS.scene = api;
})();
