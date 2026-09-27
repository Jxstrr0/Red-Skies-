/* =====================================================================
 * jet_friend.js — Red Skies / Weapons Hold · Models API part  (v2.1.0)
 * Friendly heavy twin-engine air-superiority fighter, "Gyrfalcon".
 * Original fictional design. Procedural three.js (r128), no external assets.
 *
 * Units: 1 = 1 m. +Z forward (nose), +Y up, +X = aircraft's LEFT wing.
 * Origin: aircraft centre. Size: ~22.6 m long, ~14.9 m span, ~5.1 m tall.
 *
 * Usage:
 *   const jet = ModelParts.jet_friend({ missiles:true, lights:true, markings:'A', lod:'high' });
 *   scene.add(jet);
 *   jet.userData.update(dt, time);            // every frame (strobes, reheat flicker)
 *   jet.userData.setAfterburner(0..1)  (alias setThrottle)
 *   jet.userData.setControls({ roll, pitch, yaw, flap })   // each -1..1
 *        roll>0 = right wing down, pitch>0 = nose up, yaw>0 = nose right
 *   jet.userData.setLights(bool) · setMissiles(bool) · setMarkings('A'|'B'|'C'|null)
 *   jet.userData.setLoadout('cap'|'sead'|'strike'|'clean')   (opts.loadout, default 'cap')
 *     Uses models_weapons_east.js (load it first); falls back to simple missiles without it.
 *   jet.userData.nozzles → [Vector3, Vector3] exhaust anchors (local space)
 *   jet.userData.name/role/length/span/height/triangles
 *
 * In models.js:  create(kind, opts) → if (ModelParts[kind]) return ModelParts[kind](opts)
 * ===================================================================== */
(function (root) {
  'use strict';
  var THREE = root.THREE;
  var ModelParts = root.ModelParts = root.ModelParts || {};
  var GLOBAL = root;

  function V(x, y, z) { return new THREE.Vector3(x, y, z); }
  function rng(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function hex(h) { var c = new THREE.Color(h); return [c.r, c.g, c.b]; }

  // ---------- palette ----------
  var CAMO = ['#3f5262', '#5b7183', '#7f93a2', '#a7b5be'];   // deep, dark, mid, light
  var BELLY_TINT = [1.05, 1.07, 1.08];
  var TEX_N = 1024, TEXEL_M = 0.075, CAMO_REPEAT_M = TEX_N * TEXEL_M;  // 76.8 m
  var WHITE = [1, 1, 1];

  // ---------- geometry accumulator ----------
  function Mesher() { this.p = []; this.c = []; }
  Mesher.prototype.tri = function (a, b, c, col) {
    this.p.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    for (var i = 0; i < 3; i++) this.c.push(col[0], col[1], col[2]);
  };
  var _e1 = V(0, 0, 0), _e2 = V(0, 0, 0), _n = V(0, 0, 0), _m = V(0, 0, 0);
  Mesher.prototype.otri = function (a, b, c, ref, col) {
    _e1.subVectors(b, a); _e2.subVectors(c, a); _n.crossVectors(_e1, _e2);
    _m.copy(a).add(b).add(c).multiplyScalar(1 / 3).sub(ref);
    if (_n.dot(_m) < 0) this.tri(a, c, b, col); else this.tri(a, b, c, col);
  };
  Mesher.prototype.addGeo = function (g, mat4, col) {
    var ng = g.index ? g.toNonIndexed() : g;
    if (mat4) ng.applyMatrix4(mat4);
    var p = ng.attributes.position.array;
    for (var i = 0; i < p.length; i++) this.p.push(p[i]);
    for (var j = 0; j < p.length / 3; j++) this.c.push(col[0], col[1], col[2]);
  };
  // o.camo → box-projected UVs + belly tint; o.smooth → welded normals with crease angle
  Mesher.prototype.build = function (o) {
    o = o || {};
    var g = new THREE.BufferGeometry();
    var pos = new Float32Array(this.p), col = new Float32Array(this.c);
    var nv = pos.length / 3, nt = nv / 3;
    var nor = new Float32Array(pos.length), uv = new Float32Array(nv * 2);
    var fn = new Float32Array(nt * 3), fa = new Float32Array(nt * 3);
    var a = V(0, 0, 0), b = V(0, 0, 0), c = V(0, 0, 0), n = V(0, 0, 0);
    var S = 1 / CAMO_REPEAT_M, pu = 4 / TEX_N, pv = 1 - 4 / TEX_N;
    for (var t = 0; t < nt; t++) {
      var i9 = t * 9;
      a.fromArray(pos, i9); b.fromArray(pos, i9 + 3); c.fromArray(pos, i9 + 6);
      n.subVectors(c, b).cross(_e1.subVectors(a, b));
      fa[t * 3] = n.x; fa[t * 3 + 1] = n.y; fa[t * 3 + 2] = n.z;
      n.normalize(); fn[t * 3] = n.x; fn[t * 3 + 1] = n.y; fn[t * 3 + 2] = n.z;
      for (var k = 0; k < 3; k++) { nor[i9 + k * 3] = n.x; nor[i9 + k * 3 + 1] = n.y; nor[i9 + k * 3 + 2] = n.z; }
      if (!o.camo) continue;
      var ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z), belly = n.y < -0.4;
      for (var v = 0; v < 3; v++) {
        var vi = t * 3 + v, px = pos[vi * 3], py = pos[vi * 3 + 1], pz = pos[vi * 3 + 2], U, Wv;
        if (belly) { U = pu; Wv = pv; col[vi * 3] *= BELLY_TINT[0]; col[vi * 3 + 1] *= BELLY_TINT[1]; col[vi * 3 + 2] *= BELLY_TINT[2]; }
        else if (ay >= ax && ay >= az) { U = px * S + 0.13; Wv = pz * S + 0.29; }
        else if (ax >= az) { U = pz * S + 0.37; Wv = py * S + 0.71; }
        else { U = px * S + 0.61; Wv = py * S + 0.05; }
        uv[vi * 2] = U; uv[vi * 2 + 1] = Wv;
      }
    }
    if (o.smooth) {
      var groups = {}, cosC = Math.cos((o.crease || 50) * Math.PI / 180);
      for (var q = 0; q < nv; q++) {
        var key = Math.round(pos[q * 3] * 1000) + ',' + Math.round(pos[q * 3 + 1] * 1000) + ',' + Math.round(pos[q * 3 + 2] * 1000);
        (groups[key] || (groups[key] = [])).push(q);
      }
      Object.keys(groups).forEach(function (key) {
        var L = groups[key];
        for (var i = 0; i < L.length; i++) {
          var vi = L[i], f = (vi / 3) | 0, sx = 0, sy = 0, sz = 0;
          for (var j = 0; j < L.length; j++) {
            var gg = (L[j] / 3) | 0;
            var d = fn[f * 3] * fn[gg * 3] + fn[f * 3 + 1] * fn[gg * 3 + 1] + fn[f * 3 + 2] * fn[gg * 3 + 2];
            if (d > cosC) { sx += fa[gg * 3]; sy += fa[gg * 3 + 1]; sz += fa[gg * 3 + 2]; }
          }
          var len = Math.sqrt(sx * sx + sy * sy + sz * sz) || 1;
          nor[vi * 3] = sx / len; nor[vi * 3 + 1] = sy / len; nor[vi * 3 + 2] = sz / len;
        }
      });
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    if (o.camo) g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.computeBoundingSphere();
    return g;
  };

  function skin(M, rings, col, o) {
    o = o || {};
    var n = rings[0].length, cents = [], all = V(0, 0, 0);
    rings.forEach(function (r) {
      var c = V(0, 0, 0); r.forEach(function (p) { c.add(p); }); c.divideScalar(r.length);
      cents.push(c); all.add(c);
    });
    all.divideScalar(rings.length);
    for (var k = 0; k < rings.length - 1; k++) {
      var ref = o.ref || cents[k].clone().add(cents[k + 1]).multiplyScalar(0.5);
      for (var i = 0; i < n; i++) {
        var a = rings[k][i], b = rings[k][(i + 1) % n], c = rings[k + 1][(i + 1) % n], d = rings[k + 1][i];
        M.otri(a, c, b, ref, col); M.otri(a, d, c, ref, col);
      }
    }
    function cap(r, apex) { for (var i = 0; i < n; i++) M.otri(apex, r[i], r[(i + 1) % n], o.ref || all, col); }
    if (o.capStart) cap(rings[0], o.startApex || cents[0]);
    if (o.capEnd) cap(rings[rings.length - 1], o.endApex || cents[cents.length - 1]);
  }
  function sring(s, n, sx) {
    var pts = [], e = 2 / (s.p || 2), X = (s.x || 0) * (sx || 1);
    for (var i = 0; i < n; i++) {
      var t = 2 * Math.PI * i / n, c = Math.cos(t), sn = Math.sin(t);
      pts.push(V(X + s.w * Math.sign(c) * Math.pow(Math.abs(c), e),
                 (s.y || 0) + (sn >= 0 ? s.h : s.b) * Math.sign(sn) * Math.pow(Math.abs(sn), e), s.z));
    }
    return pts;
  }
  function loft(M, secs, n, col, o, sx) { skin(M, secs.map(function (s) { return sring(s, n, sx); }), col, o); }

  function foil(le, chord, t, axis, prof) {
    var pts = [];
    prof.forEach(function (q) { pts.push(le.clone().add(V(0, 0, -q[0] * chord)).addScaledVector(axis, q[1] * t / 2)); });
    for (var i = prof.length - 1; i >= 0; i--) {
      if (prof[i][1] === 0) continue;
      pts.push(le.clone().add(V(0, 0, -prof[i][0] * chord)).addScaledVector(axis, -prof[i][1] * t / 2));
    }
    return pts;
  }
  function panel(M, r, tp, axis, prof, col, steps) {
    var rings = [], N = steps || 1;
    for (var i = 0; i <= N; i++) {
      var f = i / N, le = r.le.clone().lerp(tp.le, f);
      rings.push(foil(le, r.chord + (tp.chord - r.chord) * f, r.t + (tp.t - r.t) * f, axis, prof));
    }
    skin(M, rings, col, { capStart: true, capEnd: true });
  }

  var P_MAIN = [[0, 0], [0.02, 0.32], [0.06, 0.56], [0.14, 0.82], [0.28, 0.98], [0.45, 1], [0.65, 0.88], [0.85, 0.72], [1, 0.58]];
  var P_CTRL = [[0, 0.9], [0.08, 1], [0.3, 0.8], [0.6, 0.5], [1, 0.07]];
  var P_TAIL = [[0, 0], [0.03, 0.4], [0.1, 0.72], [0.3, 1], [0.55, 0.85], [0.8, 0.5], [1, 0.08]];
  var AX = V(1, 0, 0), AY = V(0, 1, 0);

  // ---------- wing planform (unchanged from v1) ----------
  var W = { rx: 2.5, tx: 7.2, rLE: 0.6, tLE: -3.6, rH: -4.1, tH: -4.95, rTE: -5.35, tTE: -5.55, rT: 0.36, tT: 0.09, ry: -0.08, ty: -0.12 };
  function wf(x) { return (x - W.rx) / (W.tx - W.rx); }
  function wLE(x) { return W.rLE + (W.tLE - W.rLE) * wf(x); }
  function wH(x) { return W.rH + (W.tH - W.rH) * wf(x); }
  function wTE(x) { return W.rTE + (W.tTE - W.rTE) * wf(x); }
  function wT(x) { return W.rT + (W.tT - W.rT) * wf(x); }
  function wY(x) { return W.ry + (W.ty - W.ry) * wf(x); }

  // ---------- textures ----------
  function canvas(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function makeCamo() {
    var N = TEX_N, cv = canvas(N, N), g = cv.getContext('2d'), img = g.createImageData(N, N), r = rng(35);
    function lat(P) { var a = new Float32Array(P * P); for (var i = 0; i < a.length; i++) a[i] = r(); return a; }
    function vn(L, P, x, y) {
      var xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
      fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
      var x0 = xi % P, y0 = yi % P, x1 = (xi + 1) % P, y1 = (yi + 1) % P;
      var a = L[y0 * P + x0] + (L[y0 * P + x1] - L[y0 * P + x0]) * fx;
      var b = L[y1 * P + x0] + (L[y1 * P + x1] - L[y1 * P + x0]) * fx;
      return a + (b - a) * fy;
    }
    var L1 = lat(8), L2 = lat(16), L3 = lat(32), K = lat(16);
    var tones = CAMO.map(function (h) { var c = new THREE.Color(h); return [c.r * 255, c.g * 255, c.b * 255]; });
    var B = 4, NB = N / B, cell = new Uint8Array(NB * NB);       // camo "pixel" = 4 texels = 0.3 m
    for (var cy = 0; cy < NB; cy++) for (var cx = 0; cx < NB; cx++) {
      var u = cx / NB, v = cy / NB;
      var n = 0.55 * vn(L1, 8, u * 8, v * 8) + 0.3 * vn(L2, 16, u * 16, v * 16) + 0.15 * vn(L3, 32, u * 32, v * 32);
      n += (r() - 0.5) * 0.07;
      var k = vn(K, 16, u * 16 + 3.3, v * 16 + 7.1);
      var ti = n < 0.4 ? 1 : n < 0.53 ? 2 : 3;
      if (ti === 1 && k > 0.55) ti = 0;
      cell[cy * NB + cx] = ti;
    }
    // panel lines: frames every 1.2 m, stringers every 2.4 m, plus hatch outlines
    var line = new Uint8Array(N * N), F = 16, Sg = 32;
    for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) if (x % F === 0 || y % Sg === 0) line[y * N + x] = 1;
    var hr = rng(9);
    for (var h = 0; h < 90; h++) {
      var hx = Math.floor(hr() * N), hy = Math.floor(hr() * N), hw = 6 + Math.floor(hr() * 30), hh = 4 + Math.floor(hr() * 14);
      for (var yy = 0; yy <= hh; yy++) for (var xx = 0; xx <= hw; xx++) {
        if (yy === 0 || yy === hh || xx === 0 || xx === hw) line[((hy + yy) % N) * N + (hx + xx) % N] = 1;
      }
    }
    for (var py = 0; py < N; py++) for (var px = 0; px < N; px++) {
      var patch = px < 8 && py < 8, ti2 = patch ? 3 : cell[((py / B) | 0) * NB + ((px / B) | 0)];
      var t3 = tones[ti2], o = (py * N + px) * 4, d = line[py * N + px] && !patch ? 0.86 : 1;
      img.data[o] = t3[0] * d; img.data[o + 1] = t3[1] * d; img.data[o + 2] = t3[2] * d; img.data[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    var tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.anisotropy = 4;
    return tex;
  }
  function makeGlow() {
    var cv = canvas(64, 64), g = cv.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.18, 'rgba(255,255,255,0.85)');
    gr.addColorStop(0.45, 'rgba(255,255,255,0.22)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(cv);
  }
  function makeFlame() {
    var cv = canvas(16, 128), g = cv.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 128);
    gr.addColorStop(0, 'rgba(90,110,255,0)'); gr.addColorStop(0.45, 'rgba(255,150,80,0.35)');
    gr.addColorStop(0.8, 'rgba(255,215,160,0.85)'); gr.addColorStop(1, 'rgba(255,250,235,1)');
    g.fillStyle = gr; g.fillRect(0, 0, 16, 128);
    g.globalCompositeOperation = 'lighter';
    for (var i = 0; i < 4; i++) {
      var y = 118 - i * 20, d = g.createRadialGradient(8, y, 0, 8, y, 7);
      d.addColorStop(0, 'rgba(255,240,220,' + (0.55 - i * 0.12) + ')'); d.addColorStop(1, 'rgba(255,240,220,0)');
      g.fillStyle = d; g.fillRect(0, y - 8, 16, 16);
    }
    return new THREE.CanvasTexture(cv);
  }
  // tiny procedural environment cube so glass, metal and paint pick up sky/ground reflections
  function makeEnv() {
    var faces = [];
    for (var f = 0; f < 6; f++) {
      var cv = canvas(32, 32), g = cv.getContext('2d');
      if (f === 2) { g.fillStyle = '#8fb6dc'; g.fillRect(0, 0, 32, 32); }
      else if (f === 3) { g.fillStyle = '#5b6150'; g.fillRect(0, 0, 32, 32); }
      else { var gr = g.createLinearGradient(0, 0, 0, 32); gr.addColorStop(0, '#86aed6'); gr.addColorStop(0.5, '#c9d8e4'); gr.addColorStop(0.52, '#6d7461'); gr.addColorStop(1, '#4d5343'); g.fillStyle = gr; g.fillRect(0, 0, 32, 32); }
      faces.push(cv);
    }
    var cube = new THREE.CubeTexture(faces); cube.needsUpdate = true;
    return cube;
  }

  // ---------- markings (fictional) ----------
  var SCHEMES = {
    A: { name: 'Compass', main: '#1f4478', ring: '#f2f2ef', star: '#e5b44a', num: '#1f4478', numEdge: '#f2f2ef' },
    B: { name: 'Talon', main: '#f2f2ef', ring: '#b8232f', star: '#1a1c1e', num: '#b8232f', numEdge: '#f2f2ef' },
    C: { name: 'Low-vis', main: '#7f8b94', ring: '#4b555d', star: '#4b555d', num: '#46505a', numEdge: null }
  };
  function roundelTex(s) {
    var cv = canvas(256, 256), g = cv.getContext('2d'), c = 128;
    g.beginPath(); g.arc(c, c, 118, 0, Math.PI * 2); g.fillStyle = s.main; g.fill();
    g.lineWidth = 16; g.strokeStyle = s.ring; g.beginPath(); g.arc(c, c, 104, 0, Math.PI * 2); g.stroke();
    g.fillStyle = s.star;
    if (s.name === 'Talon') {
      g.beginPath(); g.moveTo(c, 34); g.lineTo(c + 62, 150); g.lineTo(c + 22, 150); g.lineTo(c, 104); g.lineTo(c - 22, 150); g.lineTo(c - 62, 150); g.closePath(); g.fill();
      g.beginPath(); g.arc(c, 186, 20, 0, Math.PI * 2); g.fill();
    } else {
      g.beginPath(); g.moveTo(c, 30); g.lineTo(c + 22, c - 22); g.lineTo(c + 98, c); g.lineTo(c + 22, c + 22); g.lineTo(c, c + 98); g.lineTo(c - 22, c + 22); g.lineTo(c - 98, c); g.lineTo(c - 22, c - 22); g.closePath(); g.fill();
    }
    var t = new THREE.CanvasTexture(cv); t.anisotropy = 4; return t;
  }
  function flashTex(s) {
    var cv = canvas(256, 128), g = cv.getContext('2d');
    g.fillStyle = s.main; g.fillRect(0, 0, 256, 128);
    g.fillStyle = s.ring; g.beginPath(); g.moveTo(96, 0); g.lineTo(176, 0); g.lineTo(80, 128); g.lineTo(0, 128); g.closePath(); g.fill();
    g.fillStyle = s.star; g.beginPath(); g.moveTo(208, 0); g.lineTo(256, 0); g.lineTo(256, 64); g.lineTo(112, 128); g.lineTo(96, 128); g.closePath(); g.fill();
    var t = new THREE.CanvasTexture(cv); t.anisotropy = 4; return t;
  }
  function numberTex(s, txt) {
    var cv = canvas(256, 128), g = cv.getContext('2d');
    g.font = 'bold 112px "Arial Narrow", "Helvetica Neue", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    if (s.numEdge) { g.lineWidth = 14; g.strokeStyle = s.numEdge; g.lineJoin = 'round'; g.strokeText(txt, 128, 68); }
    g.fillStyle = s.num; g.fillText(txt, 128, 68);
    var t = new THREE.CanvasTexture(cv); t.anisotropy = 4; return t;
  }

  // ---------- shared build (per LOD) ----------
  var SH = {};
  function shared(lod) {
    if (SH[lod]) return SH[lod];
    var hi = lod !== 'low', Q = hi ? 1 : 0.5;
    var seg = function (n) { return Math.max(6, Math.round(n * Q)); };
    var C = {
      radome: hex('#7d8b96'), dark: hex('#15181b'), probe: hex('#3a3f44'), pod: hex('#8b969e'),
      cockpit: hex('#22262a'), seat: hex('#3a3f38'), helmet: hex('#d8dad6'), visor: hex('#1a2a33'), suit: hex('#4f5a4d'),
      mWhite: hex('#e0e3dd'), mSeek: hex('#3a4147'), mYel: hex('#c9a227'), mBrn: hex('#6b4a2b'), mFin: hex('#c6cbc4'), turbine: hex('#4a4744')
    };
    if (!SH.tex) SH.tex = { camo: makeCamo(), glow: makeGlow(), flame: makeFlame(), env: makeEnv() };
    var tex = SH.tex;
    if (!SH.mat) SH.mat = {
      camo: new THREE.MeshStandardMaterial({ map: tex.camo, vertexColors: true, metalness: 0.22, roughness: 0.58, envMap: tex.env, envMapIntensity: 0.55, emissive: 0x141a20 }),
      trim: new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.2, roughness: 0.6, envMap: tex.env, envMapIntensity: 0.4 }),
      metal: new THREE.MeshStandardMaterial({ color: 0x8a847c, metalness: 0.85, roughness: 0.45, envMap: tex.env, envMapIntensity: 0.9, side: THREE.DoubleSide, flatShading: true }),
      glass: new THREE.MeshStandardMaterial({ color: 0x5f8aa8, metalness: 0.6, roughness: 0.08, envMap: tex.env, envMapIntensity: 0.8, transparent: true, opacity: 0.36, side: THREE.DoubleSide, depthWrite: false }),
      ball: new THREE.MeshStandardMaterial({ color: 0x1b2730, metalness: 0.9, roughness: 0.05, envMap: tex.env, envMapIntensity: 1.4 })
    };
    var mat = SH.mat, m4 = new THREE.Matrix4();

    // ===== airframe (camo, smooth) — same layout as v1, finer =====
    var B = new Mesher();
    loft(B, [
      { z: 8.2, y: -0.02, w: 0.58, h: 0.58, b: 0.56 },
      { z: 7.6, y: -0.01, w: 0.63, h: 0.62, b: 0.60, p: 2.1 },
      { z: 7.0, y: 0, w: 0.68, h: 0.66, b: 0.64, p: 2.2 },
      { z: 6.4, y: 0, w: 0.72, h: 0.67, b: 0.67, p: 2.3 },
      { z: 5.8, y: 0, w: 0.76, h: 0.68, b: 0.70, p: 2.4 },
      { z: 5.0, y: 0, w: 0.81, h: 0.74, b: 0.72, p: 2.5 },
      { z: 4.2, y: 0, w: 0.86, h: 0.80, b: 0.74, p: 2.6 },
      { z: 3.4, y: 0, w: 0.91, h: 0.90, b: 0.72, p: 2.6 },
      { z: 2.6, y: 0, w: 0.95, h: 0.92, b: 0.70, p: 2.6 },
      { z: 1.5, y: 0, w: 0.97, h: 0.90, b: 0.66, p: 2.7 },
      { z: 0.5, y: 0, w: 0.98, h: 0.88, b: 0.62, p: 2.8 },
      { z: -1.0, y: 0, w: 0.95, h: 0.83, b: 0.58, p: 2.8 },
      { z: -2.5, y: 0, w: 0.92, h: 0.78, b: 0.55, p: 2.8 },
      { z: -4.0, y: 0, w: 0.85, h: 0.70, b: 0.52, p: 2.7 },
      { z: -5.5, y: 0, w: 0.78, h: 0.62, b: 0.50, p: 2.6 },
      { z: -6.8, y: 0.01, w: 0.66, h: 0.53, b: 0.45, p: 2.5 },
      { z: -8.0, y: 0.02, w: 0.56, h: 0.46, b: 0.40, p: 2.4 },
      { z: -9.0, y: 0.04, w: 0.44, h: 0.36, b: 0.33, p: 2.2 },
      { z: -9.8, y: 0.05, w: 0.33, h: 0.28, b: 0.26 },
      { z: -10.6, y: 0.06, w: 0.22, h: 0.18, b: 0.18 },
    ], seg(32), WHITE, { capEnd: true, endApex: V(0, 0.06, -10.9) });
    var half = [[0, 6.6], [0.7, 6.2], [1.15, 5.0], [1.6, 3.6], [2.1, 2.0], [2.6, 0.5], [2.62, -5.2], [2.45, -7.4], [1.3, -8.6], [0.6, -8.9], [0, -9.0]];
    var sh = new THREE.Shape();
    half.forEach(function (q, i) { if (i === 0) sh.moveTo(q[0], -q[1]); else sh.lineTo(q[0], -q[1]); });
    for (var i = half.length - 2; i > 0; i--) sh.lineTo(-half[i][0], -half[i][1]);
    sh.closePath();
    var plate = new THREE.ExtrudeGeometry(sh, { depth: 0.08, bevelEnabled: true, bevelThickness: 0.11, bevelSize: 0.14, bevelSegments: hi ? 3 : 1 });
    plate.rotateX(-Math.PI / 2); plate.translate(0, -0.1, 0);
    B.addGeo(plate, null, WHITE);

    [1, -1].forEach(function (s) {
      loft(B, [
        { x: 1.5, z: 2.9, y: -0.72, w: 0.6, h: 0.5, b: 0.52, p: 5 },
        { x: 1.5, z: 1.2, y: -0.74, w: 0.62, h: 0.5, b: 0.58, p: 4 },
        { x: 1.5, z: -2.0, y: -0.72, w: 0.62, h: 0.48, b: 0.58, p: 3.4 },
        { x: 1.5, z: -5.0, y: -0.66, w: 0.6, h: 0.5, b: 0.56, p: 2.8 },
        { x: 1.5, z: -7.4, y: -0.6, w: 0.54, h: 0.5, b: 0.52, p: 2.2 },
        { x: 1.5, z: -8.6, y: -0.58, w: 0.5, h: 0.5, b: 0.5 },
      ], seg(24), WHITE, {}, s);
      loft(B, [
        { x: 2.35, z: -4.6, y: -0.05, w: 0.12, h: 0.12, b: 0.10 },
        { x: 2.35, z: -5.3, y: -0.05, w: 0.22, h: 0.20, b: 0.20 },
        { x: 2.35, z: -8.8, y: -0.03, w: 0.20, h: 0.18, b: 0.18 },
        { x: 2.35, z: -9.8, y: -0.02, w: 0.10, h: 0.08, b: 0.08 },
      ], seg(12), WHITE, { capStart: true, capEnd: true, endApex: V(s * 2.35, -0.02, -10.0) }, s);
      panel(B, { le: V(s * W.rx, W.ry, W.rLE), chord: W.rLE - W.rH, t: W.rT },
               { le: V(s * W.tx, W.ty, W.tLE), chord: W.tLE - W.tH, t: W.tT }, AY, P_MAIN, WHITE, 2);
      panel(B, { le: V(s * 2.35, 0.1, -4.4), chord: 3.4 * 0.72, t: 0.2 },
               { le: V(s * 2.62, 3.95, -7.35), chord: 1.45 * 0.72, t: 0.07 }, AX, P_MAIN, WHITE, 2);
      panel(B, { le: V(s * 2.05, -0.95, -5.0), chord: 1.7, t: 0.08 },
               { le: V(s * 2.2, -1.85, -5.9), chord: 1.0, t: 0.04 }, AX, P_TAIL, WHITE);
      B.addGeo(new THREE.BoxGeometry(0.1, 0.12, 2.6), m4.makeTranslation(s * 7.25, -0.12, -4.2), WHITE);
      B.addGeo(new THREE.BoxGeometry(0.1, 0.3, 2.0), m4.makeTranslation(s * 4.2, -0.37, -2.4), WHITE);
      B.addGeo(new THREE.BoxGeometry(0.1, 0.26, 1.6), m4.makeTranslation(s * 5.8, -0.33, -3.45), WHITE);
      B.addGeo(new THREE.BoxGeometry(0.12, 0.3, 1.9), m4.makeTranslation(s * 1.5, -1.42, -1.2), WHITE);   // under-intake pylon
    });
    B.addGeo(new THREE.BoxGeometry(0.12, 0.3, 1.8), m4.makeTranslation(0, -0.66, 0.9), WHITE);
    B.addGeo(new THREE.BoxGeometry(0.12, 0.3, 1.8), m4.makeTranslation(0, -0.62, -3.5), WHITE);
    var airframe = B.build({ camo: true, smooth: true, crease: 46 });

    // ===== trim: radome, intakes, pods, cockpit, probe =====
    var T = new Mesher();
    loft(T, [
      { z: 10.4, y: -0.16, w: 0.16, h: 0.16, b: 0.16 },
      { z: 10.0, y: -0.13, w: 0.27, h: 0.27, b: 0.27 },
      { z: 9.4, y: -0.09, w: 0.41, h: 0.41, b: 0.41 },
      { z: 8.8, y: -0.05, w: 0.51, h: 0.51, b: 0.51 },
      { z: 8.2, y: -0.02, w: 0.58, h: 0.58, b: 0.56 },
    ], seg(32), C.radome, { capStart: true, startApex: V(0, -0.18, 10.9) });
    var probe = new THREE.CylinderGeometry(0.018, 0.03, 1.0, 6); probe.rotateX(Math.PI / 2);
    T.addGeo(probe, m4.makeTranslation(0, -0.18, 11.3), C.probe);
    [1, -1].forEach(function (s) {
      // intake lip (folds inward, faces forward) + dark duct
      loft(T, [
        { x: 1.5, z: 2.9, y: -0.72, w: 0.6, h: 0.5, b: 0.52, p: 5 },
        { x: 1.5, z: 2.6, y: -0.72, w: 0.52, h: 0.42, b: 0.44, p: 5 },
      ], seg(24), C.pod, { ref: V(s * 1.5, -0.72, -60) }, s);
      T.addGeo(new THREE.BoxGeometry(1.04, 0.86, 1.2), m4.makeTranslation(s * 1.5, -0.72, 2.0), C.dark);
      // fin-tip antenna pod
      var podG = new THREE.CylinderGeometry(0.08, 0.065, 1.3, seg(10)); podG.rotateX(Math.PI / 2);
      T.addGeo(podG, m4.makeTranslation(s * 2.62, 3.96, -7.85), C.pod);
      var podN = new THREE.ConeGeometry(0.08, 0.35, seg(10)); podN.rotateX(Math.PI / 2);
      T.addGeo(podN, m4.makeTranslation(s * 2.62, 3.96, -7.02), C.pod);
      // wingtip light housing
      T.addGeo(new THREE.BoxGeometry(0.12, 0.1, 0.3), m4.makeTranslation(s * 7.25, -0.08, -2.95), C.pod);
    });
    T.addGeo(new THREE.BoxGeometry(0.16, 0.14, 0.6), m4.makeTranslation(-1.5, 0.02, 3.4), C.dark);     // gun port
    T.addGeo(new THREE.CylinderGeometry(0.12, 0.17, 0.14, seg(12)), m4.makeTranslation(-0.14, 0.66, 6.5), C.radome); // sensor-ball base
    if (hi) {                                                                                             // cockpit interior
      T.addGeo(new THREE.BoxGeometry(0.86, 0.5, 2.0), m4.makeTranslation(0, 0.3, 5.1), C.cockpit);
      T.addGeo(new THREE.BoxGeometry(0.76, 0.2, 0.45), m4.makeTranslation(0, 0.66, 6.0), C.cockpit);
      var seat = new THREE.BoxGeometry(0.46, 0.68, 0.28); seat.rotateX(-0.28);
      T.addGeo(seat, m4.makeTranslation(0, 0.62, 4.5), C.seat);
      T.addGeo(new THREE.BoxGeometry(0.46, 0.1, 0.46), m4.makeTranslation(0, 0.42, 4.86), C.seat);
      T.addGeo(new THREE.BoxGeometry(0.26, 0.16, 0.16), m4.makeTranslation(0, 0.9, 4.52), C.seat);
      T.addGeo(new THREE.BoxGeometry(0.38, 0.4, 0.26), m4.makeTranslation(0, 0.64, 4.82), C.suit);
      T.addGeo(new THREE.SphereGeometry(0.14, seg(14), seg(10)), m4.makeTranslation(0, 0.9, 4.9), C.helmet);
      T.addGeo(new THREE.SphereGeometry(0.11, seg(12), seg(8)), m4.makeTranslation(0, 0.88, 4.98), C.visor);
      T.addGeo(new THREE.BoxGeometry(0.05, 0.05, 0.8), m4.makeTranslation(0, 0.6, 5.6), C.cockpit);
    }
    var trim = T.build({ smooth: true, crease: 40 });

    // ===== nozzles (metal, faceted petals) =====
    var N = new Mesher();
    [1, -1].forEach(function (s) {
      var nz = new THREE.CylinderGeometry(0.5, 0.43, 0.8, seg(18), 1, true); nz.rotateX(Math.PI / 2);
      N.addGeo(nz, m4.makeTranslation(s * 1.5, -0.58, -8.95), WHITE);
      var petals = new THREE.CylinderGeometry(0.43, 0.37, 0.34, seg(18), 1, true); petals.rotateX(Math.PI / 2);
      N.addGeo(petals, m4.makeTranslation(s * 1.5, -0.58, -9.5), WHITE);
      var ring = new THREE.TorusGeometry(0.5, 0.035, 6, seg(18));
      N.addGeo(ring, m4.makeTranslation(s * 1.5, -0.58, -8.55), WHITE);
    });
    var nozzles = N.build({});

    // ===== canopy, frames, sensor ball =====
    var canopy = new THREE.SphereGeometry(1, seg(28), seg(14), 0, Math.PI * 2, 0, Math.PI / 2);
    canopy.scale(0.54, 0.66, 1.95); canopy.translate(0, 0.47, 5.2);
    var F = new Mesher();
    [[6.05, 0.53, 0.6], [4.35, 0.54, 0.66]].forEach(function (b) {
      var arc = new THREE.TorusGeometry(1, 0.03, 6, seg(20), Math.PI); arc.scale(b[1], b[2], 1);
      F.addGeo(arc, m4.makeTranslation(0, 0.47, b[0]), C.pod);
    });
    F.addGeo(new THREE.BoxGeometry(1.12, 0.04, 1.95), m4.makeTranslation(0, 0.48, 5.2), C.pod);
    var frames = F.build({ smooth: true });
    var ball = new THREE.SphereGeometry(0.14, seg(16), seg(12)); ball.translate(-0.14, 0.8, 6.5);

    // ===== missiles =====
    var S = new Mesher();
    function missile(len, r, x, y, z) {
      var body = len - r * 4.2, m = new THREE.Matrix4();
      var cyl = new THREE.CylinderGeometry(r, r, body, seg(12), 1, true); cyl.rotateX(Math.PI / 2);
      S.addGeo(cyl, m.makeTranslation(x, y, z - r * 2.1), C.mWhite);
      var nose = new THREE.ConeGeometry(r, r * 4.2, seg(12)); nose.rotateX(Math.PI / 2);
      S.addGeo(nose, m.makeTranslation(x, y, z + body / 2), C.mSeek);
      var cap = new THREE.CircleGeometry(r, seg(12)); cap.rotateY(Math.PI);
      S.addGeo(cap, m.makeTranslation(x, y, z - r * 2.1 - body / 2), C.turbine);
      [0.62, 0.48].forEach(function (f, i) {
        var band = new THREE.CylinderGeometry(r * 1.02, r * 1.02, 0.08, seg(12), 1, true); band.rotateX(Math.PI / 2);
        S.addGeo(band, m.makeTranslation(x, y, z - r * 2.1 + body * (f - 0.5)), i ? C.mBrn : C.mYel);
      });
      for (var k = 0; k < 4; k++) {
        var a = k * Math.PI / 2 + Math.PI / 4, ca = Math.cos(a), sa = Math.sin(a), rot = new THREE.Matrix4().makeRotationZ(a - Math.PI / 2);
        var fin = new THREE.BoxGeometry(0.018, r * 2.6, 0.42);
        S.addGeo(fin, new THREE.Matrix4().makeTranslation(x + ca * r * 1.8, y + sa * r * 1.8, z - len / 2 + 0.3).multiply(rot), C.mFin);
        var cf = new THREE.BoxGeometry(0.014, r * 1.4, 0.2);
        S.addGeo(cf, new THREE.Matrix4().makeTranslation(x + ca * r * 1.3, y + sa * r * 1.3, z + len / 2 - r * 5.5).multiply(rot), C.mFin);
      }
    }
    [1, -1].forEach(function (s) {
      missile(3.0, 0.09, s * 7.3, -0.26, -3.9);
      missile(3.7, 0.105, s * 4.2, -0.66, -2.2);
      missile(3.0, 0.09, s * 5.8, -0.58, -3.2);
      missile(3.7, 0.105, s * 1.5, -1.72, -1.0);       // under intake
    });
    missile(3.7, 0.105, 0, -0.93, 1.1);
    missile(3.7, 0.105, 0, -0.89, -3.3);
    var stores = S.build({ smooth: true, crease: 40 });

    // ===== control surfaces =====
    var ctrls = [];
    function ctrl(name, s, geoFn, h0, h1) {
      var M = new Mesher(); geoFn(M);
      var g = M.build({ camo: true, smooth: true, crease: 46 }); g.translate(-h0.x, -h0.y, -h0.z);
      ctrls.push({ name: name, side: s, geo: g, hinge: h0, axis: h1.clone().sub(h0).normalize() });
    }
    [1, -1].forEach(function (s) {
      function wingCtrl(name, x0, x1) {
        var h0 = V(s * x0, wY(x0), wH(x0)), h1 = V(s * x1, wY(x1), wH(x1));
        ctrl(name, s, function (M) {
          panel(M, { le: h0.clone(), chord: wH(x0) - wTE(x0), t: wT(x0) * 0.62 },
                   { le: h1.clone(), chord: wH(x1) - wTE(x1), t: wT(x1) * 0.62 }, AY, P_CTRL, WHITE);
        }, h0, h1);
      }
      wingCtrl('flap', 2.62, 4.9);
      wingCtrl('aileron', 4.95, 7.0);
      var th0 = V(s * 2.5, -0.37, -7.4), th1 = V(s * 6.3, -0.37, -7.4);
      ctrl('taileron', s, function (M) {
        panel(M, { le: V(s * 2.5, -0.35, -6.3), chord: 3.0, t: 0.16 },
                 { le: V(s * 6.3, -0.40, -8.5), chord: 1.15, t: 0.06 }, AY, P_TAIL, WHITE, 2);
      }, th0, th1);
      var r0 = V(s * 2.35, 0.1, -4.4 - 3.4 * 0.72), r1 = V(s * 2.62, 3.95, -7.35 - 1.45 * 0.72);
      ctrl('rudder', s, function (M) {
        panel(M, { le: r0.clone(), chord: 3.4 * 0.28, t: 0.2 * 0.5 },
                 { le: r1.clone(), chord: 1.45 * 0.28, t: 0.07 * 0.5 }, AX, P_CTRL, WHITE);
      }, r0, r1);
    });

    // ===== effect geometry =====
    var flameCore = new THREE.ConeGeometry(0.34, 2.4, seg(12), 1, true); flameCore.translate(0, 1.2, 0); flameCore.rotateX(-Math.PI / 2);
    var flameOuter = new THREE.ConeGeometry(0.44, 4.6, seg(12), 1, true); flameOuter.translate(0, 2.3, 0); flameOuter.rotateX(-Math.PI / 2);
    var disc = new THREE.CircleGeometry(0.42, seg(18)); disc.rotateY(Math.PI);
    var turbine = new THREE.ConeGeometry(0.16, 0.25, seg(12)); turbine.rotateX(-Math.PI / 2);

    // ===== markings (decal planes on flat surfaces) =====
    var decals = {};
    Object.keys(SCHEMES).forEach(function (k) {
      var s = SCHEMES[k], list = [], rt = roundelTex(s), ft = flashTex(s), nt = numberTex(s, '21');
      function dm(t) { return new THREE.MeshStandardMaterial({ map: t, transparent: true, alphaTest: 0.5, metalness: 0.2, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide }); }
      var rM = dm(rt), fM = dm(ft), nM = dm(nt);
      [1, -1].forEach(function (sd) {
        var x = 5.0, zc = wH(x) + 0.5 * (wLE(x) - wH(x)), top = wY(x) + wT(x) * 0.5 * 0.9 + 0.03, bot = wY(x) - wT(x) * 0.5 * 0.9 - 0.03;
        var p = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5), rM); p.rotation.x = -Math.PI / 2; p.position.set(sd * x, top, zc); list.push(p);
        var q = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5), rM); q.rotation.x = Math.PI / 2; q.position.set(sd * x, bot, zc); list.push(q);
        // fin flash, both faces of each fin, following the 4° outward cant
        [1, -1].forEach(function (face) {          // face +1 = outboard side of the fin
          var f = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.5), fM), cant = Math.atan2(0.27, 3.85);
          f.position.set(sd * (2.53 + face * 0.08), 2.6, -7.07);
          f.rotation.set(0, sd * face * Math.PI / 2, -sd * cant, 'ZYX');
          list.push(f);
        });
        // bort number on the intake side
        var n = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.45), nM);
        n.position.set(sd * (1.5 + 0.62 + 0.02), -0.72, 0.3); n.rotation.y = sd * Math.PI / 2; list.push(n);
      });
      decals[k] = list;
    });

    SH[lod] = { mat: mat, tex: tex, geo: { airframe: airframe, trim: trim, nozzles: nozzles, canopy: canopy, frames: frames, ball: ball, stores: stores, flameCore: flameCore, flameOuter: flameOuter, disc: disc, turbine: turbine }, ctrls: ctrls, decals: decals };
    return SH[lod];
  }


  // ---------- loadouts (use models_weapons_east.js when present) ----------
  // Hardpoints: y = bottom of the pylon/rail; weapons hang with their lugs on it.
  var HP = {
    tipL:   [7.3, -0.18, -3.9],  tipR:   [-7.3, -0.18, -3.9],
    outerL: [5.8, -0.46, -3.2],  outerR: [-5.8, -0.46, -3.2],
    innerL: [4.2, -0.52, -2.2],  innerR: [-4.2, -0.52, -2.2],
    intakeL:[1.5, -1.57, -1.0],  intakeR:[-1.5, -1.57, -1.0],
    tunF:   [0, -0.81, 1.0],     tunA:   [0, -0.77, -3.4]
  };
  var LOADOUTS = {
    cap:    { tip: 'aam_short_e', outer: 'aam_short_e', inner: 'aam_long_e', intake: 'aam_long_e', tunF: 'aam_heavy_e', tunA: 'aam_heavy_e' },
    sead:   { tip: 'aam_short_e', outer: 'aam_long_e', inner: 'agm_arm_e', intake: 'aam_long_e', tunF: 'agm_arm_e' },
    strike: { tip: 'aam_short_e', outer: 'agm_light_e', inner: 'guided_bomb_e', intake: 'aam_long_e', tunnel: 'cruise_e' },
    clean:  {}
  };
  function loadoutParts(lod, name) {
    var S = SH[lod]; S.loadouts = S.loadouts || {};
    if (S.loadouts[name]) return S.loadouts[name];
    var WE = GLOBAL.RSWeaponsEast, spec = LOADOUTS[name] || {}, byMat = new Map();
    function put(list, mx) {
      list.forEach(function (p) {
        var gg = p.geometry.clone(); gg.applyMatrix4(mx);
        if (!byMat.has(p.material)) byMat.set(p.material, []);
        byMat.get(p.material).push(gg);
      });
    }
    function hang(kind, hp, zShift) {
      var inf = WE.info[kind], x = hp[0], z = hp[2] + (zShift || 0), y = hp[1];
      if (kind === 'agm_light_e') {                  // launch rail adapter first
        put(WE.rackParts(kind, { lod: lod }), new THREE.Matrix4().makeTranslation(x, y, z));
        y -= 0.13;
      }
      put(WE.parts(kind, { flight: false, lod: lod }), new THREE.Matrix4().makeTranslation(x, y - inf.r - 0.035, z));
    }
    if (WE && name !== 'clean') {
      ['tip', 'outer', 'inner', 'intake'].forEach(function (k) {
        if (!spec[k]) return;
        var shift = k === 'inner' && spec[k] === 'agm_arm_e' ? 0.3 : 0;
        hang(spec[k], HP[k + 'L'], shift); hang(spec[k], HP[k + 'R'], shift);
      });
      if (spec.tunF) hang(spec.tunF, HP.tunF);
      if (spec.tunA) hang(spec.tunA, HP.tunA);
      if (spec.tunnel) hang(spec.tunnel, [0, -0.79, -1.3]);
    }
    var out = [];
    byMat.forEach(function (list, material) {
      var n = 0; list.forEach(function (gg) { n += gg.attributes.position.count; });
      var P = new Float32Array(n * 3), N = new Float32Array(n * 3), o = 0;
      list.forEach(function (gg) { P.set(gg.attributes.position.array, o); N.set(gg.attributes.normal.array, o); o += gg.attributes.position.count * 3; });
      var bg = new THREE.BufferGeometry();
      bg.setAttribute('position', new THREE.BufferAttribute(P, 3));
      bg.setAttribute('normal', new THREE.BufferAttribute(N, 3));
      bg.computeBoundingSphere();
      out.push({ geometry: bg, material: material });
    });
    S.loadouts[name] = out;
    return out;
  }

  // ---------- instance ----------
  function create(opts) {
    opts = opts || {};
    var lod = opts.lod === 'low' ? 'low' : 'high';
    var sh = shared(lod), g = sh.geo, m = sh.mat;
    var root = new THREE.Group();
    root.name = 'jet_friend';

    function mesh(geo, mt) { var o = new THREE.Mesh(geo, mt); root.add(o); return o; }
    mesh(g.airframe, m.camo); mesh(g.trim, m.trim); mesh(g.nozzles, m.metal); mesh(g.frames, m.trim);
    mesh(g.ball, m.ball);
    var canopy = mesh(g.canopy, m.glass); canopy.renderOrder = 1;
    var WE = GLOBAL.RSWeaponsEast;
    var fallback = mesh(g.stores, m.trim);                 // built-in missiles if the weapons module is missing
    var storesGrp = new THREE.Group(); storesGrp.name = 'stores'; root.add(storesGrp);

    var surf = {};
    sh.ctrls.forEach(function (c) {
      var pivot = new THREE.Object3D(); pivot.position.copy(c.hinge);
      pivot.add(new THREE.Mesh(c.geo, m.camo)); root.add(pivot);
      surf[c.name + (c.side > 0 ? 'L' : 'R')] = { pivot: pivot, axis: c.axis, side: c.side };
    });

    // markings (cloned per instance so visibility is independent)
    var marks = {};
    Object.keys(sh.decals).forEach(function (k) {
      var grp = new THREE.Group(); grp.visible = false;
      sh.decals[k].forEach(function (d) { grp.add(d.clone()); });
      root.add(grp); marks[k] = grp;
    });

    // afterburner
    var burners = [], nozzles = [];
    [1, -1].forEach(function (s) {
      var glowMat = new THREE.MeshBasicMaterial({ color: 0x2a211c });
      var d = new THREE.Mesh(g.disc, glowMat); d.position.set(s * 1.5, -0.58, -8.7); root.add(d);
      var tb = new THREE.Mesh(g.turbine, m.metal); tb.position.set(s * 1.5, -0.58, -8.6); root.add(tb);
      var fm = function (col, op) {
        return new THREE.MeshBasicMaterial({ map: sh.tex.flame, color: col, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      };
      var core = new THREE.Mesh(g.flameCore, fm(0xfff0d8, 1)), outer = new THREE.Mesh(g.flameOuter, fm(0xff8a3c, 0.8));
      [core, outer].forEach(function (f) { f.position.set(s * 1.5, -0.58, -9.6); f.renderOrder = 2; root.add(f); });
      burners.push({ disc: glowMat, core: core, outer: outer, phase: s * 1.7 });
      nozzles.push(V(s * 1.5, -0.58, -9.65));
    });

    function light(col, x, y, z, size) {
      var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: sh.tex.glow, color: col, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      sp.position.set(x, y, z); sp.scale.setScalar(size); sp.userData.base = size; sp.renderOrder = 3; root.add(sp); return sp;
    }
    var L = {
      navL: light(0xff2a2a, 7.25, -0.05, -2.8, 0.7),
      navR: light(0x2aff5a, -7.25, -0.05, -2.8, 0.7),
      tail: light(0xffffff, 0, 0.06, -10.95, 0.6),
      strL: light(0xffffff, 2.62, 4.0, -8.5, 2.2),
      strR: light(0xffffff, -2.62, 4.0, -8.5, 2.2),
      bcnT: light(0xff3020, 0, 0.9, -1.5, 1.2),
      bcnB: light(0xff3020, 0, -0.68, -6.5, 1.2),
    };

    var state = { ab: 0, lights: opts.lights !== false, t: 0, ctl: { roll: 0, pitch: 0, yaw: 0, flap: 0 }, marks: null };

    function rot(sv, down) { sv.pivot.quaternion.setFromAxisAngle(sv.axis, -sv.side * down); }
    function setControls(c) {
      var k = state.ctl; ['roll', 'pitch', 'yaw', 'flap'].forEach(function (n) { if (c && c[n] !== undefined) k[n] = Math.max(-1, Math.min(1, c[n])); });
      var D = Math.PI / 180;
      rot(surf.aileronL, (k.roll * 20 + k.flap * 8) * D);
      rot(surf.aileronR, (-k.roll * 20 + k.flap * 8) * D);
      rot(surf.flapL, k.flap * 25 * D);
      rot(surf.flapR, k.flap * 25 * D);
      rot(surf.taileronL, (-k.pitch * 15 + k.roll * 8) * D);
      rot(surf.taileronR, (-k.pitch * 15 - k.roll * 8) * D);
      surf.rudderL.pivot.quaternion.setFromAxisAngle(surf.rudderL.axis, k.yaw * 20 * D);
      surf.rudderR.pivot.quaternion.setFromAxisAngle(surf.rudderR.axis, k.yaw * 20 * D);
    }
    var cGlow = new THREE.Color(), cDark = new THREE.Color(0x2a211c), cHot = new THREE.Color(0xff9a4a);
    function setAfterburner(v) {
      state.ab = Math.max(0, Math.min(1, v || 0));
      burners.forEach(function (b) { b.disc.color.copy(cGlow.copy(cDark).lerp(cHot, Math.min(1, state.ab * 1.6))); });
    }
    function setLights(on) { state.lights = !!on; Object.keys(L).forEach(function (k) { L[k].visible = state.lights; }); }
    function setLoadout(name) {
      if (name === true || name === undefined || name === null) name = 'cap';
      if (name === false) name = 'clean';
      if (!LOADOUTS[name]) name = 'cap';
      state.loadout = name;
      while (storesGrp.children.length) storesGrp.remove(storesGrp.children[0]);
      if (WE) {
        fallback.visible = false;
        loadoutParts(lod, name).forEach(function (p) { storesGrp.add(new THREE.Mesh(p.geometry, p.material)); });
      } else {
        fallback.visible = name !== 'clean' && state.stores;
      }
      root.userData && (root.userData.loadout = name);
      recount();
    }
    function setMissiles(on) { state.stores = !!on; storesGrp.visible = state.stores; if (!WE) fallback.visible = state.stores && state.loadout !== 'clean'; }
    function setMarkings(k) { state.marks = k && marks[k] ? k : null; Object.keys(marks).forEach(function (n) { marks[n].visible = n === state.marks; }); }

    function update(dt, time) {
      state.t = time !== undefined ? time : state.t + (dt || 0);
      var t = state.t, ab = state.ab;
      burners.forEach(function (b) {
        var on = ab > 0.03, fl = 1 + 0.07 * Math.sin(t * 57 + b.phase) + 0.04 * Math.sin(t * 91 + b.phase * 3);
        b.core.visible = b.outer.visible = on;
        if (!on) return;
        b.core.scale.set(0.85 + 0.15 * ab, 0.85 + 0.15 * ab, (0.25 + 0.75 * ab) * fl);
        b.outer.scale.set(0.8 + 0.2 * ab, 0.8 + 0.2 * ab, (0.15 + 0.85 * ab) * fl);
        b.core.material.opacity = Math.min(1, ab * 1.4);
        b.outer.material.opacity = Math.max(0, ab - 0.35) * 1.2 * fl;
      });
      if (!state.lights) return;
      var sp = t % 1.3, strobe = (sp < 0.05) || (sp > 0.16 && sp < 0.21);
      L.strL.visible = L.strR.visible = strobe;
      L.bcnT.visible = ((t + 0.5) % 1.0) < 0.12; L.bcnB.visible = ((t + 1.0) % 1.0) < 0.12;
    }

    setControls({}); setAfterburner(opts.afterburner || 0); setLights(state.lights);
    state.stores = opts.missiles !== false;
    setLoadout(opts.loadout); setMissiles(state.stores); setMarkings(opts.markings === undefined ? 'A' : opts.markings); update(0, 0);

    function recount() {
      var tris = 0;
      root.traverse(function (o) { if (o.isMesh && o.visible && o.geometry.attributes.position) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
      if (root.userData) root.userData.triangles = Math.round(tris);
      return Math.round(tris);
    }
    var tris = recount();

    root.userData = {
      kind: 'jet_friend', name: 'Gyrfalcon', role: 'heavy air-superiority fighter', length: 22.6, span: 14.9, height: 5.1,
      triangles: Math.round(tris), nozzles: nozzles, lod: lod, schemes: Object.keys(SCHEMES),
      update: update, setAfterburner: setAfterburner, setThrottle: setAfterburner, setControls: setControls,
      setLights: setLights, setMissiles: setMissiles, setMarkings: setMarkings, lights: L, materials: m,
      setLoadout: setLoadout, loadout: state.loadout, loadouts: Object.keys(LOADOUTS), recount: recount,
    };
    return root;
  }

  ModelParts.jet_friend = create;
  ModelParts.jet_friend.version = "2.1.0";
  ModelParts.jet_friend.schemes = SCHEMES;
})(typeof window !== 'undefined' ? window : globalThis);
