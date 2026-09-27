/* =====================================================================
   RED SKIES — cabin.js   RS.cabin : the Pantsir operator cabin (V1.4).
   1) model(THREE): the 3-D cabin seen from the operator's seat — console with the radar monitor (the DOM #p-scope is
      projected onto its screen), the EO monitor (the EO render target is its picture, #eo is projected on top), a slanted
      armoured windshield above/behind the console, off-white Pantsir panels, keyboard shelf + trackball, side walls
      (map monitor, switch column, cable looms, handles), roof with red/white dome lamps. Merged by material: one opaque
      mesh (custom per-vertex lit shader, one canvas atlas), the windshield glass (rain), the EO face (set by scene.js).
      Frame: eye at the origin, −Z forward, +Y up, metres. The seat's rest pose is SEAT (pitch, horizontal FOV).
   2) DOM projection: bind(el, name) → every frame (update(), called by RS.scene.render) the element is mapped onto
      RS.scene.screenQuad(name) (TL,TR,BR,BL in #hatch CSS px; null → hidden) with a CSS matrix3d homography, so taps
      and text keep working. toLocal(el, clientX, clientY) → element-local CSS px (any descendant of a bound element);
      toClient(el, x, y) → client px. Transforms are only rewritten when the quad moves ≥ EPS px.
   3) Look-around: drag on the cabin (the #view canvas, i.e. outside the screens / HUD) → yaw ±60°, pitch −10…+35°;
      a critically damped spring brings the view home ~0.6 s after release. look = { yaw (+ = left), pitch (+ = up), dragging, set(y,p) }.
   API: RS.cabin = { SEAT, model(THREE), bind, unbind, update, toLocal, toClient, look, frame(dt), debug() }
   ===================================================================== */
(function () {
  const RS = window.RS;
  const D2R = Math.PI / 180;
  // rest pose: pitch (deg, − = down), tan of the horizontal half-FOV (kept for every aspect), design aspect (390×464 hatch)
  const SEAT = { pitch: -15, tanH: 0.5, aspect: 390 / 464, yawMax: 60, pitchMin: -10, pitchMax: 35 };
  const RADAR_AR = 390 / 215;                 // #p-scope layout aspect (CSS: aspect-ratio 390/215)

  /* ---------------- geometry builder: cabin-frame quads/boxes/cylinders → one merged BufferGeometry ---------------- */
  function Builder(T) {
    const P = [], N = [], C = [], UV = [], E = [], I = [];
    const V = (x, y, z) => new T.Vector3(x, y, z);
    let uvr = null;                            // current atlas rect [u0,v0,u1,v1] (null = the white texel block)
    const WHITE = [0.955, 0.012, 0.99, 0.045];
    // quad: origin o, edge vectors u (→) and v (↑), normal u×v; subdivided sx×sy; colour col (hex); e = self-illumination
    function quad(o, u, v, col, o2) {
      o2 = o2 || {};
      const sx = o2.sx || 1, sy = o2.sy || 1, r = o2.uv || uvr || WHITE, e = o2.e || 0;
      const n = new T.Vector3().crossVectors(u, v).normalize(), c = new T.Color(col), base = P.length / 3;
      for (let j = 0; j <= sy; j++) for (let i = 0; i <= sx; i++) {
        const s = i / sx, t = j / sy;
        P.push(o.x + u.x * s + v.x * t, o.y + u.y * s + v.y * t, o.z + u.z * s + v.z * t);
        N.push(n.x, n.y, n.z); C.push(c.r, c.g, c.b); E.push(e);
        UV.push(r[0] + (r[2] - r[0]) * (o2.flipU ? 1 - s : s), r[1] + (r[3] - r[1]) * t);
      }
      for (let j = 0; j < sy; j++) for (let i = 0; i < sx; i++) {
        const a = base + j * (sx + 1) + i, b = a + 1, d = a + sx + 1, cc = d + 1;
        I.push(a, b, cc, a, cc, d);
      }
    }
    // basis from Euler angles (deg): X right, Y up, Z back
    function basis(rx, ry, rz) {
      const m = new T.Matrix4().makeRotationFromEuler(new T.Euler((rx || 0) * D2R, (ry || 0) * D2R, (rz || 0) * D2R, 'YXZ'));
      const X = V(1, 0, 0).applyMatrix4(m), Y = V(0, 1, 0).applyMatrix4(m), Z = V(0, 0, 1).applyMatrix4(m);
      return { X, Y, Z };
    }
    // box: centre c, size [w,h,d], rotation [rx,ry,rz], colour (or per-face {f:+z colour…}), faces mask e.g. 'xXyYzZ' (lower = −)
    function box(c, s, rot, col, o2) {
      o2 = o2 || {};
      const B = rot && rot.X ? rot : basis(rot && rot[0], rot && rot[1], rot && rot[2]), hx = s[0] / 2, hy = s[1] / 2, hz = s[2] / 2;
      const X = B.X, Y = B.Y, Z = B.Z, f = o2.faces || 'xXyYzZ', cs = typeof col === 'object' ? col : null;
      const at = (a, b, cz) => V(c.x + X.x * a + Y.x * b + Z.x * cz, c.y + X.y * a + Y.y * b + Z.y * cz, c.z + X.z * a + Y.z * b + Z.z * cz);
      const cl = k => cs ? (cs[k] !== undefined ? cs[k] : cs.all) : col;
      const q = (k, o, u, v, extra) => quad(o, u, v, cl(k), Object.assign({ sx: o2.sx, sy: o2.sy, e: o2.e }, extra || {}));
      if (f.includes('Z')) q('Z', at(-hx, -hy, hz), X.clone().multiplyScalar(2 * hx), Y.clone().multiplyScalar(2 * hy), o2.front);
      if (f.includes('z')) q('z', at(hx, -hy, -hz), X.clone().multiplyScalar(-2 * hx), Y.clone().multiplyScalar(2 * hy));
      if (f.includes('X')) q('X', at(hx, -hy, hz), Z.clone().multiplyScalar(-2 * hz), Y.clone().multiplyScalar(2 * hy));
      if (f.includes('x')) q('x', at(-hx, -hy, -hz), Z.clone().multiplyScalar(2 * hz), Y.clone().multiplyScalar(2 * hy));
      if (f.includes('Y')) q('Y', at(-hx, hy, hz), X.clone().multiplyScalar(2 * hx), Z.clone().multiplyScalar(-2 * hz), o2.top);
      if (f.includes('y')) q('y', at(-hx, -hy, -hz), X.clone().multiplyScalar(2 * hx), Z.clone().multiplyScalar(2 * hz));
      return B;
    }
    // cylinder between points a and b, radius r, n sides (open ends unless caps)
    function cyl(a, b, r, n, col, caps, r2) {
      const ax = new T.Vector3().subVectors(b, a), L = ax.length(); ax.normalize();
      const t1 = Math.abs(ax.y) < 0.9 ? V(0, 1, 0) : V(1, 0, 0), p = new T.Vector3().crossVectors(ax, t1).normalize(), q = new T.Vector3().crossVectors(ax, p);
      const c = new T.Color(col), rb = r2 === undefined ? r : r2, base = P.length / 3, r0 = uvr || WHITE;
      for (let i = 0; i <= n; i++) {
        const t = i / n * Math.PI * 2, cs = Math.cos(t), sn = Math.sin(t);
        const nx = p.x * cs + q.x * sn, ny = p.y * cs + q.y * sn, nz = p.z * cs + q.z * sn;
        P.push(a.x + nx * r, a.y + ny * r, a.z + nz * r, b.x + nx * rb, b.y + ny * rb, b.z + nz * rb);
        N.push(nx, ny, nz, nx, ny, nz); C.push(c.r, c.g, c.b, c.r, c.g, c.b); E.push(0, 0);
        UV.push(r0[0], r0[1], r0[0], r0[1]);
      }
      for (let i = 0; i < n; i++) { const k = base + i * 2; I.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
      if (caps) {
        const cap = (o, rr, sgn) => {
          const k0 = P.length / 3; P.push(o.x, o.y, o.z); N.push(ax.x * sgn, ax.y * sgn, ax.z * sgn); C.push(c.r, c.g, c.b); E.push(0); UV.push(r0[0], r0[1]);
          for (let i = 0; i <= n; i++) {
            const t = i / n * Math.PI * 2, x = p.x * Math.cos(t) + q.x * Math.sin(t), y = p.y * Math.cos(t) + q.y * Math.sin(t), z = p.z * Math.cos(t) + q.z * Math.sin(t);
            P.push(o.x + x * rr, o.y + y * rr, o.z + z * rr); N.push(ax.x * sgn, ax.y * sgn, ax.z * sgn); C.push(c.r, c.g, c.b); E.push(0); UV.push(r0[0], r0[1]);
          }
          for (let i = 0; i < n; i++) sgn > 0 ? I.push(k0, k0 + 1 + i, k0 + 2 + i) : I.push(k0, k0 + 2 + i, k0 + 1 + i);
        };
        cap(b, rb, 1); cap(a, r, -1);
      }
    }
    // dome (half sphere) facing +axis
    function dome(c, axis, r, n, col, flat) {
      const ax = axis.clone().normalize(), t1 = Math.abs(ax.y) < 0.9 ? V(0, 1, 0) : V(1, 0, 0);
      const p = new T.Vector3().crossVectors(ax, t1).normalize(), q = new T.Vector3().crossVectors(ax, p), cc = new T.Color(col), base = P.length / 3, m = n >> 1, r0 = uvr || WHITE;
      for (let j = 0; j <= m; j++) for (let i = 0; i <= n; i++) {
        const ph = j / m * Math.PI / 2, th = i / n * Math.PI * 2, cr = Math.cos(ph), sr = Math.sin(ph) * (flat || 1);
        const nx = (p.x * Math.cos(th) + q.x * Math.sin(th)) * cr + ax.x * Math.sin(ph), ny = (p.y * Math.cos(th) + q.y * Math.sin(th)) * cr + ax.y * Math.sin(ph), nz = (p.z * Math.cos(th) + q.z * Math.sin(th)) * cr + ax.z * Math.sin(ph);
        P.push(c.x + (nx - ax.x * Math.sin(ph)) * r + ax.x * sr * r, c.y + (ny - ax.y * Math.sin(ph)) * r + ax.y * sr * r, c.z + (nz - ax.z * Math.sin(ph)) * r + ax.z * sr * r);
        N.push(nx, ny, nz); C.push(cc.r, cc.g, cc.b); E.push(0); UV.push(r0[0], r0[1]);
      }
      for (let j = 0; j < m; j++) for (let i = 0; i < n; i++) { const a = base + j * (n + 1) + i, b = a + n + 1; I.push(a, a + 1, b + 1, a, b + 1, b); }
    }
    function tube(pts, r, n, col) { for (let i = 0; i + 1 < pts.length; i++) cyl(pts[i], pts[i + 1], r, n, col, false); }
    function geometry(lightFn) {
      const g = new T.BufferGeometry(), nV = P.length / 3, L = new Float32Array(nV * 4);
      for (let i = 0; i < nV; i++) lightFn(P[i * 3], P[i * 3 + 1], P[i * 3 + 2], N[i * 3], N[i * 3 + 1], N[i * 3 + 2], L, i * 4);
      g.setAttribute('position', new T.Float32BufferAttribute(P, 3));
      g.setAttribute('normal', new T.Float32BufferAttribute(N, 3));
      g.setAttribute('color', new T.Float32BufferAttribute(C, 3));
      g.setAttribute('uv', new T.Float32BufferAttribute(UV, 2));
      g.setAttribute('aE', new T.Float32BufferAttribute(E, 1));
      g.setAttribute('aL', new T.BufferAttribute(L, 4));
      g.setIndex(I); g.computeBoundingSphere();
      return g;
    }
    return { V, quad, box, cyl, dome, tube, basis, geometry, set uv(r) { uvr = r; }, get uv() { return uvr; }, get tris() { return I.length / 3; } };
  }

  /* ---------------- canvas atlas: keys, switch column, tactical map, placards, vents ---------------- */
  const AT = 1024;
  const REG = {                               // [x, y, w, h] in atlas px
    keysL: [0, 0, 512, 192], keysR: [512, 0, 512, 192], map: [0, 192, 384, 448], swR: [384, 192, 192, 512], lamps: [576, 192, 256, 48],
    plate: [576, 240, 256, 96], vent: [832, 192, 192, 192], roofP: [576, 336, 256, 128], eoKeys: [576, 464, 256, 40], radKeys: [576, 504, 448, 40],
    warn: [832, 384, 192, 80], side: [0, 640, 384, 256], dash: [384, 704, 512, 96], hatch: [896, 544, 128, 128],
    pan: [0, 896, 128, 128], pan2: [128, 896, 128, 128], panD: [256, 896, 128, 128], mini: [384, 800, 256, 96],
    // V1.4.2 Cyrillic stencils / plates
    st1: [576, 544, 320, 40], lblR: [576, 584, 320, 40], lblE: [576, 624, 160, 40], st2: [576, 664, 320, 40],
    warn2: [640, 800, 384, 48], st3: [640, 848, 384, 48], dplate: [384, 896, 320, 64], ext: [704, 896, 256, 64], post: [896, 672, 40, 128]
  };
  const uvOf = k => { const r = REG[k]; return [r[0] / AT, 1 - (r[1] + r[3]) / AT, (r[0] + r[2]) / AT, 1 - r[1] / AT]; };
  function atlas(T) {
    const cv = document.createElement('canvas'); cv.width = cv.height = AT;
    const g = cv.getContext('2d'), R = REG, F = 'bold ', MONO = '"DejaVu Sans Mono", Menlo, Consolas, monospace';
    g.fillStyle = '#e4e7e3'; g.fillRect(0, 0, AT, AT);
    g.fillStyle = '#ffffff'; g.fillRect(AT - 64, AT - 64, 64, 64);                                   // white texel block (plain panels)
    const rr = (x, y, w, h, r, fill, stroke) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); if (fill) { g.fillStyle = fill; g.fill(); } if (stroke) { g.strokeStyle = stroke; g.stroke(); } };
    const txt = (s, x, y, sz, col, al) => { g.font = F + sz + 'px ' + MONO; g.fillStyle = col; g.textAlign = al || 'center'; g.textBaseline = 'middle'; g.fillText(s, x, y); };
    const plateBg = (r, c0, c1) => { const gr = g.createLinearGradient(0, r[1], 0, r[1] + r[3]); gr.addColorStop(0, c0); gr.addColorStop(1, c1); g.fillStyle = gr; g.fillRect(r[0], r[1], r[2], r[3]); };
    const key = (x, y, w, h, lbl, lit) => {                   // engraved flat key
      rr(x + 1, y + 2, w, h, 3, 'rgba(0,0,0,.28)');
      const gr = g.createLinearGradient(0, y, 0, y + h); gr.addColorStop(0, lit || '#f1f3f0'); gr.addColorStop(1, lit ? lit : '#c9cdc8');
      rr(x, y, w, h, 3, gr, '#8d928e');
      if (lbl) txt(lbl, x + w / 2, y + h / 2 + 1, Math.min(12, h * 0.42), lit ? '#2a1a00' : '#3c464c');
    };
    // keyboard plates (engraved legend keys)
    const LB = ['ПУСК', 'СБР', 'ВЗХ', 'ОТМ', 'ЦУ', 'АС', 'РС', 'ТВ', 'ТП', 'ЗУМ', 'ВВ', 'ОК', 'F1', 'F2', 'F3', 'F4', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', 'РЕЖ', 'КНТ'];
    for (const k of ['keysL', 'keysR']) {
      const r = R[k]; plateBg(r, '#dfe2de', '#c6cac5'); g.strokeStyle = '#9ba09b'; g.lineWidth = 2; g.strokeRect(r[0] + 2, r[1] + 2, r[2] - 4, r[3] - 4);
      let n = k === 'keysL' ? 0 : 11;
      const cols = k === 'keysL' ? 9 : 5, kw = 42, kh = 30;
      for (let j = 0; j < 4; j++) for (let i = 0; i < cols; i++) {
        const x = r[0] + 18 + i * (kw + 10) + (j % 2) * 4, y = r[1] + 20 + j * (kh + 12);
        key(x, y, kw, kh, LB[n++ % LB.length], (k === 'keysL' && i === 8 && j === 0) ? '#f3b433' : (k === 'keysL' && i === 7 && j === 0) ? '#e0473a' : null);
      }
      if (k === 'keysR') {                                    // trackball recess + three buttons
        const cx = r[0] + 400, cy = r[1] + 96;
        rr(cx - 88, cy - 70, 176, 140, 14, '#5d6366', '#3a3f42');
        g.fillStyle = '#2b2f31'; g.beginPath(); g.arc(cx, cy + 6, 46, 0, 7); g.fill();
        for (let i = 0; i < 3; i++) { g.fillStyle = '#8b9094'; g.beginPath(); g.arc(cx - 50 + i * 50, cy - 52, 9, 0, 7); g.fill(); }
      }
    }
    // tactical map (left monitor): pale terrain, roads, river, grid, unit symbols + a menu column
    {
      const r = R.map, x0 = r[0], y0 = r[1], w = r[2], h = r[3];
      g.fillStyle = '#0d1418'; g.fillRect(x0, y0, w, h);
      const mw = w - 88, mh = h * 0.62;
      g.fillStyle = '#e9e2c6'; g.fillRect(x0 + 8, y0 + 8, mw, mh);
      g.save(); g.beginPath(); g.rect(x0 + 8, y0 + 8, mw, mh); g.clip();
      g.fillStyle = '#c9dcae'; for (let i = 0; i < 9; i++) { g.beginPath(); g.ellipse(x0 + 30 + (i * 67) % mw, y0 + 30 + (i * 113) % mh, 40, 22, i, 0, 7); g.fill(); }
      g.strokeStyle = '#4f8fd0'; g.lineWidth = 4; g.beginPath(); g.moveTo(x0 + 8, y0 + 120); g.bezierCurveTo(x0 + 120, y0 + 60, x0 + 180, y0 + 220, x0 + mw, y0 + 150); g.stroke();
      g.strokeStyle = '#d04a2a'; g.lineWidth = 3; g.beginPath(); g.moveTo(x0 + 40, y0 + mh); g.lineTo(x0 + 150, y0 + 90); g.lineTo(x0 + mw, y0 + 40); g.stroke();
      g.strokeStyle = '#f0b429'; g.lineWidth = 2; g.beginPath(); g.moveTo(x0 + 8, y0 + 200); g.lineTo(x0 + 230, y0 + 250); g.stroke();
      g.strokeStyle = 'rgba(40,60,80,.35)'; g.lineWidth = 1; for (let i = 0; i < 8; i++) { g.beginPath(); g.moveTo(x0 + 8 + i * 40, y0 + 8); g.lineTo(x0 + 8 + i * 40, y0 + 8 + mh); g.stroke(); g.beginPath(); g.moveTo(x0 + 8, y0 + 8 + i * 40); g.lineTo(x0 + 8 + mw, y0 + 8 + i * 40); g.stroke(); }
      g.strokeStyle = '#c0202a'; g.lineWidth = 2; for (let i = 0; i < 4; i++) { const px = x0 + 60 + i * 55, py = y0 + 60 + (i * 37) % 120; g.beginPath(); g.moveTo(px, py - 8); g.lineTo(px + 8, py); g.lineTo(px, py + 8); g.lineTo(px - 8, py); g.closePath(); g.stroke(); }
      g.strokeStyle = '#1f5fbf'; g.beginPath(); g.arc(x0 + 150, y0 + 170, 9, 0, 7); g.stroke();
      g.restore();
      // lower half: a light-blue plot + table
      g.fillStyle = '#bfe2f4'; g.fillRect(x0 + 8, y0 + 16 + mh, mw * 0.55, h - mh - 24);
      g.strokeStyle = '#3a6f95'; g.lineWidth = 2; g.beginPath(); g.arc(x0 + 8 + mw * 0.27, y0 + 16 + mh + (h - mh - 24) / 2, 50, 0, 7); g.stroke();
      g.fillStyle = '#d7dcd8'; g.fillRect(x0 + 16 + mw * 0.55, y0 + 16 + mh, mw * 0.45 - 8, h - mh - 24);
      g.fillStyle = '#7a8a93'; for (let i = 0; i < 8; i++) g.fillRect(x0 + 24 + mw * 0.55, y0 + 26 + mh + i * 18, mw * 0.3, 7);
      g.fillStyle = '#bfc4c1'; g.fillRect(x0 + w - 76, y0 + 8, 68, h - 16);
      g.fillStyle = '#5b6468'; for (let i = 0; i < 12; i++) g.fillRect(x0 + w - 70, y0 + 20 + i * 34, 56, 8);
      const lc = ['#5fc26d', '#dc3027', '#f3b433', '#5fc26d']; for (let i = 0; i < 4; i++) { g.fillStyle = lc[i]; g.fillRect(x0 + w - 70, y0 + h - 44 + (i % 2) * 18, 26, 12); }
    }
    // right switch column (photo: guarded ON/OFF switches, square push buttons, red/amber lit ones)
    {
      const r = R.swR, x0 = r[0], y0 = r[1], w = r[2];
      plateBg(r, '#e3e6e2', '#cfd3ce'); g.strokeStyle = '#a3a8a4'; g.lineWidth = 2; g.strokeRect(x0 + 2, y0 + 2, w - 4, r[3] - 4);
      for (let i = 0; i < 2; i++) { rr(x0 + 18 + i * 84, y0 + 16, 72, 86, 6, '#f2f4f1', '#8d928e'); txt(i ? 'ОТКЛ' : 'ВКЛ', x0 + 54 + i * 84, y0 + 40, 13, '#3c464c'); g.fillStyle = '#c8ccc8'; g.fillRect(x0 + 32 + i * 84, y0 + 64, 44, 26); }
      rr(x0 + 26, y0 + 118, 140, 70, 6, '#f2f4f1', '#8d928e'); txt('ТОРМ  ТРЕ', x0 + 96, y0 + 150, 13, '#3c464c');
      for (let j = 0; j < 3; j++) for (let i = 0; i < 2; i++) key(x0 + 40 + i * 70, y0 + 206 + j * 52, 46, 38, ['ПУ', 'ОБ', 'АЗ', 'МС', 'ТР', 'СП'][j * 2 + i]);
      key(x0 + 40, y0 + 364, 46, 38, 'АВ', '#e0473a'); key(x0 + 110, y0 + 364, 46, 38, 'РЗ', '#f3b433');
      for (let i = 0; i < 2; i++) { rr(x0 + 26 + i * 76, y0 + 420, 64, 80, 6, '#f2f4f1', '#8d928e'); txt(i ? 'АЛЧ' : 'ЛЧ', x0 + 58 + i * 76, y0 + 446, 12, '#3c464c'); g.fillStyle = '#b8bdb9'; g.fillRect(x0 + 40 + i * 76, y0 + 470, 36, 22); }
    }
    // lamp caps, placard, vents, roof panel, key rows
    { const r = R.lamps; plateBg(r, '#3a3f42', '#2a2e31'); const lc = ['#39d353', '#39d353', '#f0b429', '#dc3027', '#e8ecef', '#39d353', '#f0b429', '#4a4f53'];
      for (let i = 0; i < 8; i++) { g.fillStyle = lc[i]; g.beginPath(); g.arc(r[0] + 18 + i * 31, r[1] + 24, 10, 0, 7); g.fill(); g.fillStyle = 'rgba(255,255,255,.55)'; g.beginPath(); g.arc(r[0] + 15 + i * 31, r[1] + 20, 3, 0, 7); g.fill(); } }
    { const r = R.plate; plateBg(r, '#e8eae6', '#d3d6d2'); g.strokeStyle = '#8d928e'; g.lineWidth = 2; g.strokeRect(r[0] + 3, r[1] + 3, r[2] - 6, r[3] - 6);
      txt('ПАНЦИРЬ-С1', r[0] + r[2] / 2, r[1] + 36, 30, '#28343a'); txt('ПУЛЬТ ОПЕРАТОРА  №2', r[0] + r[2] / 2, r[1] + 72, 15, '#4a565c'); }
    { const r = R.vent; g.fillStyle = '#c9cdc9'; g.fillRect(r[0], r[1], r[2], r[3]); for (let i = 0; i < 12; i++) rr(r[0] + 18, r[1] + 14 + i * 14, r[2] - 36, 7, 3, '#2d3235'); }
    { const r = R.roofP; plateBg(r, '#dfe2de', '#c9cdc8'); for (let i = 0; i < 6; i++) { g.fillStyle = '#9aa09d'; g.fillRect(r[0] + 18 + i * 40, r[1] + 30, 22, 36); g.fillStyle = '#2d3235'; g.fillRect(r[0] + 26 + i * 40, r[1] + 22, 6, 22); txt(['СВЕТ', 'ВЕНТ', 'ОБОГ', 'ФВУ', 'СТЕК', 'ДЕЖ'][i], r[0] + 29 + i * 40, r[1] + 90, 11, '#3c464c'); } }
    { const r = R.eoKeys, L = ['ТВ', 'ТП', 'УВ+', 'УВ−', 'ЯРК', 'КНТ', 'АС', 'СБР']; plateBg(r, '#3d4245', '#2c3033');
      for (let i = 0; i < 8; i++) { rr(r[0] + 8 + i * 31, r[1] + 8, 25, 24, 3, '#8b9094', '#1c1f21'); txt(L[i], r[0] + 20.5 + i * 31, r[1] + 21, 9, '#15191b'); } }
    { const r = R.radKeys, L = ['ОБЗ', 'СЕКТ', 'МСШ', 'ЦУ', 'ЗХВ', 'СБР', 'ОТМ', 'ПУСК', 'РЕЖ', 'ЯРК', 'КАЛ', 'ТЕСТ']; plateBg(r, '#4a5054', '#383d40');
      for (let i = 0; i < 12; i++) { rr(r[0] + 14 + i * 36, r[1] + 8, 29, 24, 3, '#9aa09d', '#1c1f21'); txt(L[i], r[0] + 28.5 + i * 36, r[1] + 21, 9, '#15191b'); } }
    { const r = R.warn; g.fillStyle = '#f0c419'; g.fillRect(r[0], r[1], r[2], r[3]); g.save(); g.beginPath(); g.rect(r[0], r[1], r[2], 18); g.clip();
      g.fillStyle = '#1b1b1b'; for (let i = -2; i < 14; i++) { g.beginPath(); g.moveTo(r[0] + i * 18, r[1]); g.lineTo(r[0] + i * 18 + 9, r[1]); g.lineTo(r[0] + i * 18 - 9, r[1] + 18); g.lineTo(r[0] + i * 18 - 18, r[1] + 18); g.fill(); } g.restore();
      txt('ОСТОРОЖНО', r[0] + r[2] / 2, r[1] + 38, 18, '#1b1b1b'); txt('ВЫСОКОЕ НАПРЯЖЕНИЕ', r[0] + r[2] / 2, r[1] + 62, 12, '#1b1b1b'); }
    { const r = R.side; plateBg(r, '#dde0dc', '#c7cbc6'); g.strokeStyle = '#9ba09b'; g.lineWidth = 2; g.strokeRect(r[0] + 3, r[1] + 3, r[2] - 6, r[3] - 6);
      for (let i = 0; i < 6; i++) { g.fillStyle = '#2d3235'; g.beginPath(); g.arc(r[0] + 40 + i * 58, r[1] + 50, 16, 0, 7); g.fill(); g.fillStyle = '#6b7275'; g.beginPath(); g.arc(r[0] + 40 + i * 58, r[1] + 50, 8, 0, 7); g.fill(); }
      for (let i = 0; i < 8; i++) key(r[0] + 22 + i * 44, r[1] + 100, 34, 28, String(i + 1));
      rr(r[0] + 22, r[1] + 150, 160, 80, 4, '#2d3235'); g.fillStyle = '#3f9a5a'; g.fillRect(r[0] + 30, r[1] + 158, 144, 64); txt('27.0 В', r[0] + 102, r[1] + 190, 22, '#d8ffe0');
      rr(r[0] + 200, r[1] + 150, 160, 80, 4, '#3a3f42'); for (let i = 0; i < 4; i++) { g.fillStyle = i === 1 ? '#dc3027' : '#8b9094'; g.fillRect(r[0] + 212 + i * 36, r[1] + 170, 24, 40); } }
    { const r = R.dash; plateBg(r, '#dde0dc', '#c9cdc8'); for (let i = 0; i < 10; i++) { g.fillStyle = ['#39d353', '#4a4f53', '#f0b429', '#4a4f53', '#39d353', '#e8ecef', '#4a4f53', '#dc3027', '#4a4f53', '#39d353'][i]; g.fillRect(r[0] + 16 + i * 48, r[1] + 16, 30, 16); txt(['ПИТ', 'ГОТОВ', 'НАВЕД', 'ЗАХВ', 'ПУСК', 'СВЯЗЬ', 'РЕЗЕРВ', 'АВАР', 'ОХЛАЖ', 'НОРМА'][i], r[0] + 31 + i * 48, r[1] + 54, 10, '#2f383d'); } g.fillStyle = '#6b7275'; g.fillRect(r[0] + 12, r[1] + 72, r[2] - 24, 2); txt('СИГНАЛИЗАЦИЯ  СОСТОЯНИЯ', r[0] + r[2] / 2, r[1] + 84, 11, '#4a565c'); }
    { const r = R.hatch; g.fillStyle = '#cfd3cf'; g.fillRect(r[0], r[1], r[2], r[3]); g.strokeStyle = '#8d928e'; g.lineWidth = 6; g.beginPath(); g.arc(r[0] + 64, r[1] + 64, 56, 0, 7); g.stroke(); g.lineWidth = 2; g.beginPath(); g.arc(r[0] + 64, r[1] + 64, 44, 0, 7); g.stroke(); }
    // painted panels: off-white / light grey / dark grey with a bevel (light top-left, shadowed bottom-right), grain and 4 screws
    for (const [k, c0, c1] of [['pan', '#eceee9', '#d6d9d4'], ['pan2', '#d9dcd7', '#c2c6c1'], ['panD', '#5a6064', '#454b4f']]) {
      const r = R[k], [x, y, w, h] = r, gr = g.createLinearGradient(x, y, x + w * 0.3, y + h);
      gr.addColorStop(0, c0); gr.addColorStop(1, c1); g.fillStyle = gr; g.fillRect(x, y, w, h);
      for (let i = 0; i < 260; i++) { g.fillStyle = 'rgba(0,0,0,' + (0.015 + 0.03 * ((i * 37) % 7) / 7) + ')'; g.fillRect(x + (i * 53) % w, y + (i * 97) % h, 2, 2); }
      g.fillStyle = 'rgba(255,255,255,.55)'; g.fillRect(x, y, w, 3); g.fillRect(x, y, 3, h);
      g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(x, y + h - 4, w, 4); g.fillRect(x + w - 4, y, 4, h);
      g.fillStyle = 'rgba(0,0,0,.10)'; g.fillRect(x + 3, y + h - 9, w - 6, 5);
      for (const [sx, sy] of [[10, 10], [w - 12, 10], [10, h - 13], [w - 12, h - 13]]) { g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.arc(x + sx, y + sy, 3.2, 0, 7); g.fill(); g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(x + sx - 2, y + sy - 0.5, 4, 1); }
    }
    { const r = R.mini; plateBg(r, '#2a2f31', '#1f2325'); g.fillStyle = '#0d2a18'; g.fillRect(r[0] + 8, r[1] + 8, 150, r[3] - 16);
      txt('СИСТ  НОРМ', r[0] + 83, r[1] + 30, 13, '#6dff9a'); txt('U 27.2  I 14', r[0] + 83, r[1] + 52, 13, '#6dff9a'); txt('T +21°', r[0] + 83, r[1] + 72, 13, '#6dff9a');
      for (let i = 0; i < 3; i++) { g.fillStyle = ['#39d353', '#f0b429', '#4a4f53'][i]; g.beginPath(); g.arc(r[0] + 186 + i * 24, r[1] + 30, 8, 0, 7); g.fill(); }
      for (let i = 0; i < 3; i++) rr(r[0] + 176 + i * 24, r[1] + 52, 18, 30, 3, '#9aa09d', '#141718'); }
    // V1.4.2 Cyrillic stencils and plates
    { const r = R.st1; g.fillStyle = '#e6e8e4'; g.fillRect(r[0], r[1], r[2], r[3]); txt('ПРОВЕРЬ СЕКТОР ПУСКА', r[0] + r[2] / 2, r[1] + 21, 24, '#2b3033'); }
    { const r = R.lblR; rr(r[0] + 2, r[1] + 4, r[2] - 4, r[3] - 8, 4, '#1d2123', '#5d6366'); txt('ИКО  ·  РЛС ОБНАРУЖЕНИЯ', r[0] + r[2] / 2, r[1] + 21, 15, '#e8ecef'); }
    { const r = R.lblE; rr(r[0] + 2, r[1] + 4, r[2] - 4, r[3] - 8, 4, '#1d2123', '#5d6366'); txt('ОЭС-1', r[0] + r[2] / 2, r[1] + 21, 16, '#e8ecef'); }
    { const r = R.st2; g.fillStyle = '#e6e8e4'; g.fillRect(r[0], r[1], r[2], r[3]); txt('ПИТАНИЕ', r[0] + 80, r[1] + 20, 15, '#3c464c'); txt('ОСВЕЩ.', r[0] + 238, r[1] + 20, 15, '#3c464c');
      g.fillStyle = '#6b7275'; g.fillRect(r[0] + 14, r[1] + 32, 132, 2); g.fillRect(r[0] + 176, r[1] + 32, 124, 2); }
    { const r = R.warn2; g.fillStyle = '#f0c419'; g.fillRect(r[0], r[1], r[2], r[3]); g.strokeStyle = '#1b1b1b'; g.lineWidth = 3; g.strokeRect(r[0] + 3, r[1] + 3, r[2] - 6, r[3] - 6);
      const cx = r[0] + 30, cy = r[1] + 24; g.fillStyle = '#1b1b1b'; for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, 15, i * 2.094 - 0.52, i * 2.094 + 0.52); g.fill(); }
      g.fillStyle = '#f0c419'; g.beginPath(); g.arc(cx, cy, 4.5, 0, 7); g.fill(); g.fillStyle = '#1b1b1b'; g.beginPath(); g.arc(cx, cy, 3, 0, 7); g.fill();
      txt('ОПАСНО!  СВЧ-ИЗЛУЧЕНИЕ', r[0] + 212, r[1] + 25, 17, '#1b1b1b'); }
    { const r = R.st3; g.fillStyle = '#eef0ec'; g.fillRect(r[0], r[1], r[2], r[3]); g.strokeStyle = '#c0281b'; g.lineWidth = 3; g.strokeRect(r[0] + 3, r[1] + 3, r[2] - 6, r[3] - 6);
      txt('НЕ КУРИТЬ  ·  ПРОХОД НЕ ЗАГРОМОЖДАТЬ', r[0] + r[2] / 2, r[1] + 25, 15, '#c0281b'); }
    { const r = R.dplate; const gr = g.createLinearGradient(r[0], r[1], r[0] + r[2], r[1] + r[3]); gr.addColorStop(0, '#c9ccc4'); gr.addColorStop(0.5, '#e7e9e3'); gr.addColorStop(1, '#b4b8b0');
      g.fillStyle = gr; g.fillRect(r[0], r[1], r[2], r[3]); g.strokeStyle = '#6b7275'; g.lineWidth = 2; g.strokeRect(r[0] + 3, r[1] + 3, r[2] - 6, r[3] - 6);
      txt('ИЗДЕЛИЕ 96К6', r[0] + r[2] / 2, r[1] + 20, 16, '#1f2629'); txt('ЗАВ. № 0417     ИЗГ. 2019', r[0] + r[2] / 2, r[1] + 44, 13, '#2f383d');
      for (const [sx, sy] of [[10, 10], [r[2] - 10, 10], [10, r[3] - 10], [r[2] - 10, r[3] - 10]]) { g.fillStyle = '#7d8385'; g.beginPath(); g.arc(r[0] + sx, r[1] + sy, 3, 0, 7); g.fill(); } }
    { const r = R.ext; g.fillStyle = '#b8241c'; g.fillRect(r[0], r[1], r[2], r[3]); txt('ОГНЕТУШИТЕЛЬ', r[0] + r[2] / 2, r[1] + 26, 20, '#ffffff'); txt('ОУ-3', r[0] + r[2] / 2, r[1] + 48, 13, '#ffd9d4'); }
    { const r = R.post; g.fillStyle = '#d2d6d1'; g.fillRect(r[0], r[1], r[2], r[3]); g.save(); g.translate(r[0] + r[2] / 2, r[1] + r[3] / 2); g.rotate(-Math.PI / 2);
      g.font = F + '15px ' + MONO; g.fillStyle = '#4a5054'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('БРОНЕСТЕКЛО', 0, 1); g.restore(); }
    const tex = new T.CanvasTexture(cv);
    tex.anisotropy = 4; tex.minFilter = T.LinearMipmapLinearFilter; tex.magFilter = T.LinearFilter;
    return tex;
  }

  /* ---------------- shaders (all include the log-depth chunks: the renderer uses a logarithmic depth buffer) ---------------- */
  // cabin body: per-vertex light = sky (hemisphere, × window exposure aL.y) + sun through the glass (× aL.x) + screen glow (aL.z)
  // + red night lamps (aL.w) + a small interior fill; aE = self-illumination (lamps, the map monitor)
  const BODY_VS = `
    #include <common>
    #include <logdepthbuf_pars_vertex>
    attribute vec3 color; attribute vec4 aL; attribute float aE;
    uniform vec3 uSky, uGnd, uSunC, uSunD, uScr, uLmp, uFill;
    varying vec3 vCol, vLit; varying vec2 vUv; varying float vE;
    void main() {
      vec3 n = normalize(normal);
      vec3 hemi = mix(uGnd, uSky, n.y * 0.5 + 0.5) * aL.y + uFill * (0.55 + 0.45 * aL.y);
      vLit = hemi + uSunC * max(dot(n, uSunD), 0.0) * aL.x + uScr * aL.z + uLmp * aL.w;
      vCol = color; vUv = uv; vE = aE;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      #include <logdepthbuf_vertex>
    }`;
  const BODY_FS = `
    #include <common>
    #include <logdepthbuf_pars_fragment>
    uniform sampler2D map; uniform float uSelf;
    varying vec3 vCol, vLit; varying vec2 vUv; varying float vE;
    void main() {
      #include <logdepthbuf_fragment>
      vec3 c = texture2D(map, vUv).rgb * vCol;
      gl_FragColor = vec4(c * vLit + c * vE * uSelf, 1.0);
    }`;
  // windshield: faint tint + dirt, a sky-light glare gradient, rain drops (static beads + running streaks) when wet
  const GLASS_VS = `
    #include <common>
    #include <logdepthbuf_pars_vertex>
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      #include <logdepthbuf_vertex>
    }`;
  const GLASS_FS = `
    #include <common>
    #include <logdepthbuf_pars_fragment>
    uniform float uTime, uRain, uNight; uniform vec3 uTint, uGlare, uIn; uniform vec2 uSize;
    varying vec2 vUv;
    float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    // one layer of drops: cells of c metres; each cell has a bead that sometimes runs down leaving a trail
    vec2 drops(vec2 m, float c, float t, float seed) {
      vec2 g = m / c, id = floor(g), f = fract(g) - 0.5;
      float r = h21(id + seed), r2 = h21(id + seed + 7.3);
      float run = step(0.72, r) * fract(t * (0.15 + 0.35 * r2) + r);          // ~28 % of the beads are sliding
      vec2 p = vec2((r2 - 0.5) * 0.6, 0.45 - run * 1.1 + (r - 0.5) * 0.2);
      float s = 0.10 + 0.14 * r;
      vec2 d = (f - p) * vec2(1.0, 1.25);
      float bead = smoothstep(s, s * 0.55, length(d));
      float trail = run > 0.0 ? smoothstep(0.035, 0.0, abs(f.x - p.x)) * step(p.y, f.y) * smoothstep(0.5, 0.0, f.y - p.y) * 0.45 : 0.0;
      float rim = bead * smoothstep(s * 0.2, s * 0.9, length(d - vec2(-0.02, 0.03)));
      return vec2(max(bead, trail), rim);
    }
    void main() {
      #include <logdepthbuf_fragment>
      vec2 m = vUv * uSize;                                                   // metres on the glass
      float g = pow(clamp(vUv.y, 0.0, 1.0), 1.6);                               // glare: sky light on the upper glass
      float dust = h21(floor(m * 90.0)) * 0.05 + smoothstep(0.55, 1.0, sin(m.x * 9.0 + sin(m.y * 7.0) * 2.0) * 0.5 + 0.5) * 0.05;
      vec3 col = uTint; float a = 0.13 + dust;
      col = mix(col, uGlare, g * 0.6); a += g * 0.14;
      float edge = smoothstep(0.1, 0.0, min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y)));   // darker, thicker glass edges
      col *= 1.0 - edge * 0.5; a += edge * 0.25;
      col += uIn * (1.0 - vUv.y) * 0.6; a += dot(uIn, vec3(0.33)) * (1.0 - vUv.y) * 0.25;   // interior reflection (screens / red lamps)
      if (uRain > 0.0) {
        vec2 d1 = drops(m, 0.030, uTime, 1.0), d2 = drops(m + 0.013, 0.019, uTime * 1.3, 5.0);
        float w = max(d1.x, d2.x * 0.8), rim = max(d1.y, d2.y);
        col = mix(col, mix(uGlare * 0.55, vec3(0.9), 0.35 + 0.4 * rim) * (1.0 - uNight * 0.7), w * uRain);
        a = mix(a, 0.55 + 0.3 * rim, w * uRain);
        a += uRain * 0.08;                                                    // wet film
      }
      gl_FragColor = vec4(col, clamp(a, 0.0, 0.92));
    }`;

  /* ---------------- the model ---------------- */
  // camera-space → cabin frame for the rest pitch; a screen rectangle from its centre in NDC, depth D, width w, aspect ar, tilt t (deg)
  function seatRect(T, nx, ny, D, w, ar, t) {
    const tanV = SEAT.tanH / SEAT.aspect, h = w / ar, p = SEAT.pitch * D2R, ct = Math.cos(t * D2R), st = Math.sin(t * D2R);
    const c = new T.Vector3(nx * D * SEAT.tanH, ny * D * tanV, -D);
    const R = new T.Vector3(w / 2, 0, 0), Up = new T.Vector3(0, ct * h / 2, -st * h / 2);
    const k = [c.clone().sub(R).add(Up), c.clone().add(R).add(Up), c.clone().add(R).sub(Up), c.clone().sub(R).sub(Up)];   // TL TR BR BL
    const rot = new T.Matrix4().makeRotationX(p);
    k.forEach(v => v.applyMatrix4(rot));
    return k;
  }
  // shared placement (both the model and the tests use it)
  function layout(T) {
    // radar monitor: bottom edge near the hatch bottom, ~0.98 of the width; tilted back 8° from the image plane
    const radar = seatRect(T, 0, -0.522, 0.5347, 0.505, RADAR_AR, 5);
    // EO monitor (4:3) on the right of the upper instrument panel, under the windshield, behind the radar monitor
    const eo = seatRect(T, 0.497, 0.207, 0.70, 0.30, 4 / 3, 12);
    return { radar, eo };
  }
  function model(T) {
    const B = Builder(T), V = B.V, L = layout(T), rad = L.radar, eo = L.eo;
    const tex = atlas(T);
    // palette (Pantsir interior: off-white panels, light-grey bezels, dark-grey housings, black rubber)
    const WH = 0xdfe2dd, WH2 = 0xd2d6d1, GR = 0xa7ada9, GR2 = 0x8d9390, DK = 0x4a5054, DK2 = 0x2e3336, BK = 0x16191b, RB = 0x222527;
    const mid = (a, b) => a.clone().add(b).multiplyScalar(0.5);
    const sub = (a, b) => new T.Vector3().subVectors(a, b);
    const glassParts = [], winQuads = [];
    // --- monitor housing around a screen rectangle k (TL,TR,BR,BL): frame + back box + inner black lip
    function housing(k, bz, depth, col, extraL, keys) {
      const right = sub(k[1], k[0]).normalize(), up = sub(k[0], k[3]).normalize(), n = new T.Vector3().crossVectors(right, up).normalize();
      const w = k[0].distanceTo(k[1]), h = k[0].distanceTo(k[3]), c = mid(k[0], k[2]);
      const bl = bz + (extraL || 0), bR = bz, bT = bz, bB = bz * (keys ? 2.1 : 1.2);
      const o = k[3].clone().addScaledVector(right, -bl).addScaledVector(up, -bB).addScaledVector(n, 0.004);
      const W = w + bl + bR, H = h + bT + bB, U = right.clone().multiplyScalar(W), Vv = up.clone().multiplyScalar(H);
      const at = (x, y) => o.clone().addScaledVector(right, x).addScaledVector(up, y);
      // bezel frame (4 strips so the screen hole stays open) + a thin dark inner bezel right around the screen
      B.quad(at(0, 0), right.clone().multiplyScalar(W), up.clone().multiplyScalar(bB), col, { sx: 3 });
      B.quad(at(0, bB + h), right.clone().multiplyScalar(W), up.clone().multiplyScalar(bT), col, { sx: 3 });
      B.quad(at(0, bB), right.clone().multiplyScalar(bl), up.clone().multiplyScalar(h), col, { sy: 2 });
      B.quad(at(bl + w, bB), right.clone().multiplyScalar(bR), up.clone().multiplyScalar(h), col, { sy: 2 });
      const ib = 0.0075, f = n.clone().multiplyScalar(0.0006), iw = right.clone().multiplyScalar(w + 2 * ib), ih = up.clone().multiplyScalar(h + 2 * ib);
      const i0 = k[3].clone().addScaledVector(right, -ib).addScaledVector(up, -ib).add(f).addScaledVector(n, 0.004);
      B.quad(i0, iw, up.clone().multiplyScalar(ib), DK2); B.quad(i0.clone().addScaledVector(up, h + ib), iw, up.clone().multiplyScalar(ib), DK2);
      B.quad(i0.clone().addScaledVector(up, ib), right.clone().multiplyScalar(ib), up.clone().multiplyScalar(h), DK2);
      B.quad(i0.clone().addScaledVector(up, ib).addScaledVector(right, w + ib), right.clone().multiplyScalar(ib), up.clone().multiplyScalar(h), DK2);
      if (extraL) B.quad(i0.clone().addScaledVector(right, -extraL + 0.004).addScaledVector(up, ib - 0.004), right.clone().multiplyScalar(extraL - 0.006), up.clone().multiplyScalar(h + 0.008), DK);   // DOM strip seat
      // key row under the screen
      if (keys) { B.uv = uvOf(keys); B.quad(at(bl + w * 0.2, bB * 0.18).addScaledVector(n, 0.0015), right.clone().multiplyScalar(w * 0.6), up.clone().multiplyScalar(bB * 0.6), 0xffffff); B.uv = null; }
      // the box behind: sides, top, bottom, back
      const back = n.clone().multiplyScalar(-depth), sd = 0.8;
      const s0 = at(0, 0), s1 = at(W, 0), s2 = at(W, H), s3 = at(0, H);
      B.quad(s3, back, sub(s0, s3), DK, { flipU: true });                                     // left side
      B.quad(s1, back, sub(s2, s1), DK);                                                      // right side
      B.quad(s2, back, sub(s3, s2), DK2);                                                     // top
      B.quad(s0, back.clone().multiplyScalar(sd), sub(s1, s0), DK2);                          // bottom
      B.quad(s1.clone().add(back), sub(s0, s1), sub(s3, s0), DK2);                            // back
      return { c, n, right, up, w, h, o, W, H };
    }
    // --- radar monitor (lower, close): DOM #p-scope covers the screen; dark face behind it
    B.quad(rad[3], sub(rad[2], rad[3]), sub(rad[0], rad[3]), 0x0e1215, { sx: 2, sy: 2 });
    const hR = housing(rad, 0.018, 0.10, GR, 0, 'radKeys');
    // --- EO monitor (upper right): its picture is a separate mesh (EO render target, scene.js); DOM strip on the left bezel
    const hE = housing(eo, 0.013, 0.11, GR, 0.05, 'eoKeys');
    // mounting arm for the EO monitor down to the upper console
    B.box(mid(eo[2], eo[3]).addScaledVector(hE.up, -0.07).addScaledVector(hE.n, -0.06), [0.06, 0.09, 0.05], [0, 0, 0], DK2, { faces: 'xXzZ' });

    // --- upper instrument panel: slants from the windshield sill down toward the operator; the EO monitor stands on its right,
    //     the radar monitor in front of its lower edge; lamp rows, a small status display, switches (reference photo)
    const SILL_Y = -0.06, SILL_Z = -1.0, TOP_Y = 0.19, TOP_Z = -0.78, XL = -0.70, XR = 0.72;
    const ip0 = V(-0.95, -0.215, -0.60), ipU = V(0, SILL_Y - 0.012 + 0.215, SILL_Z - 0.01 + 0.60), ipR = V(1.9, 0, 0);   // near edge → sill
    const ipN = new T.Vector3().crossVectors(ipR, ipU).normalize();
    for (const [x0, x1, k] of [[-0.95, -0.52, 'pan2'], [-0.52, -0.02, 'pan'], [-0.02, 0.5, 'pan'], [0.5, 0.95, 'pan2']]) {
      B.uv = uvOf(k); B.quad(ip0.clone().setX(x0), V(x1 - x0, 0, 0), ipU, 0xffffff, { sx: 4, sy: 3 }); B.uv = null;
    }
    const ipAt = (x, t) => ip0.clone().setX(x).addScaledVector(ipU, t).addScaledVector(ipN, 0.0015);
    B.uv = uvOf('dash'); B.quad(ipAt(-0.44, 0.74), V(0.34, 0, 0), ipU.clone().multiplyScalar(0.13), 0xffffff, { e: 0.3 }); B.uv = null;   // lamp row
    B.uv = uvOf('mini'); B.quad(ipAt(-0.40, 0.30), V(0.19, 0, 0), ipU.clone().multiplyScalar(0.18), 0xffffff, { e: 0.45 }); B.uv = null;   // status display
    B.uv = uvOf('plate'); B.quad(ipAt(-0.195, 0.30), V(0.15, 0, 0), ipU.clone().multiplyScalar(0.14), 0xffffff); B.uv = null;               // placard
    B.uv = uvOf('lamps'); B.quad(ipAt(-0.16, 0.12), V(0.12, 0, 0), ipU.clone().multiplyScalar(0.06), 0xffffff, { e: 0.8 }); B.uv = null;   // lamp caps
    for (let i = 0; i < 5; i++) {                                                                                                          // toggle switches
      const b0 = ipAt(-0.44 + i * 0.045, 0.58); B.cyl(b0, b0.clone().addScaledVector(ipN, 0.008), 0.009, 8, GR2, true);
      B.cyl(b0.clone().addScaledVector(ipN, 0.008), b0.clone().addScaledVector(ipN, 0.03).addScaledVector(ipU, i % 2 ? 0.02 : -0.02), 0.0028, 5, 0xc8ccc9, true);
    }
    for (let i = 0; i < 3; i++) { const b0 = ipAt(-0.64 + i * 0.07, 0.12); B.cyl(b0, b0.clone().addScaledVector(ipN, 0.016), 0.017, 10, BK, true); B.cyl(b0.clone().addScaledVector(ipN, 0.016), b0.clone().addScaledVector(ipN, 0.02), 0.005, 6, 0xd8dcd9, true); }
    // V1.4.2 Cyrillic: switch-group legend, data plate on the instrument panel; plates on the monitor bezels
    B.uv = uvOf('st2'); B.quad(ipAt(-0.458, 0.63), V(0.24, 0, 0), ipU.clone().multiplyScalar(0.05), 0xffffff); B.uv = null;
    B.uv = uvOf('dplate'); B.quad(ipAt(-0.195, 0.47), V(0.15, 0, 0), ipU.clone().multiplyScalar(0.075), 0xffffff); B.uv = null;
    B.uv = uvOf('st1'); B.quad(ipAt(-0.44, 0.885), V(0.40, 0, 0), ipU.clone().multiplyScalar(0.09), 0xffffff); B.uv = null;          // stencil under the windshield
    { const pw = Math.min(0.17, hR.w * 0.36), f = hR.n.clone().multiplyScalar(0.0012);
      B.uv = uvOf('lblR'); B.quad(hR.o.clone().addScaledVector(hR.right, hR.W * 0.05).addScaledVector(hR.up, hR.H - 0.0165).add(f), hR.right.clone().multiplyScalar(pw), hR.up.clone().multiplyScalar(0.015), 0xffffff, { e: 0.25 }); B.uv = null;
      const bl = hE.W - hE.w - 0.013, bB = 0.013 * 2.1;
      B.uv = uvOf('lblE'); B.quad(hE.o.clone().addScaledVector(hE.right, bl + 0.004).addScaledVector(hE.up, bB * 0.2).add(hE.n.clone().multiplyScalar(0.0015)), hE.right.clone().multiplyScalar(hE.w * 0.17), hE.up.clone().multiplyScalar(bB * 0.55), 0xffffff, { e: 0.25 }); B.uv = null; }
    B.cyl(ipAt(-0.93, 0.55), ipAt(0.93, 0.55).addScaledVector(ipN, 0.0), 0.004, 5, GR2, false);                                             // trim rail
    B.box(V(0, -0.70, -0.63), [1.9, 0.98, 0.06], [0, 0, 0], WH2, { faces: 'Z', sx: 8, sy: 3 });                                          // face behind the radar, down to the floor

    // --- windshield frame: slanted plane from the sill (SILL_Y, SILL_Z) to the top (TOP_Y, TOP_Z); two panes, centre post
    const sill = V(0, SILL_Y, SILL_Z), top = V(0, TOP_Y, TOP_Z), wUp = sub(top, sill), wH = wUp.length(); wUp.normalize();
    const wN = new T.Vector3().crossVectors(V(1, 0, 0), wUp).normalize();                    // faces the operator
    const P = (x, t) => sill.clone().setX(x).addScaledVector(wUp, t);
    const panes = [[XL, -0.012], [0.045, XR]];
    // frame around the openings (in the glass plane, a little in front of it) + deep armoured reveals
    const FR = 0.05, REV = 0.09;
    B.quad(P(-0.95, -0.06), V(1.9, 0, 0), wUp.clone().multiplyScalar(0.06 + FR * 0.3), GR, { sx: 6 });                       // sill band
    B.quad(P(-0.95, wH - FR * 0.3), V(1.9, 0, 0), wUp.clone().multiplyScalar(0.2), WH2, { sx: 6 });                         // header band
    B.quad(P(-0.95, 0), V(0.95 + XL, 0, 0), wUp.clone().multiplyScalar(wH), WH2, { sy: 3 });                              // left pillar
    B.quad(P(XR, 0), V(0.95 - XR, 0, 0), wUp.clone().multiplyScalar(wH), WH2, { sy: 3 });                                // right pillar
    B.quad(P(panes[0][1], 0), V(panes[1][0] - panes[0][1], 0, 0), wUp.clone().multiplyScalar(wH), WH2, { sy: 2 });       // centre post
    for (const [x0, x1] of panes) {
      const back = wN.clone().multiplyScalar(-REV);
      const a = P(x0, 0), b = P(x1, 0), c = P(x1, wH), d = P(x0, wH);
      B.quad(a, sub(b, a), back, GR2);                                                        // bottom reveal (faces up)
      B.quad(d.clone().add(back), sub(c, d), back.clone().negate(), DK);                     // top reveal (faces down)
      B.quad(a, back, sub(d, a), GR2);                                                        // left reveal (faces +x)
      B.quad(b.clone().add(back), back.clone().negate(), sub(c, b), GR2);                   // right reveal (faces −x)
      // rubber seal just inside the glass
      const seal = wN.clone().multiplyScalar(-REV + 0.004), s = 0.012;
      B.quad(a.clone().add(seal), sub(b, a), wUp.clone().multiplyScalar(s), RB);
      B.quad(d.clone().add(seal).addScaledVector(wUp, -s), sub(c, d), wUp.clone().multiplyScalar(s), RB);
      glassParts.push([a.clone().add(wN.clone().multiplyScalar(-REV + 0.006)), sub(b, a), sub(d, a)]);
      winQuads.push(a.clone().add(back), b.clone().add(back), c.clone().add(back), d.clone().add(back));
    }
    // V1.4.2 stencils on the windshield frame: sill band legend + vertical legend on the centre post
    B.uv = uvOf('post'); B.quad(P(panes[0][1] + 0.004, 0.13).addScaledVector(wN, 0.002), V(panes[1][0] - panes[0][1] - 0.008, 0, 0), wUp.clone().multiplyScalar(Math.min(0.18, wH - 0.15)), 0xffffff); B.uv = null;
    // wiper arms parked along the bottom of each pane (outside the glass)
    for (const [x0, x1] of panes) B.cyl(P(x0 + 0.06, 0.035).addScaledVector(wN, -REV - 0.02), P(x1 - 0.05, 0.028).addScaledVector(wN, -REV - 0.02), 0.006, 5, BK, false);

    // --- roof: flat ceiling panels, dome lamps (white + red), overhead switch panel, hatch ring, grab handle
    const RY = 0.34;
    B.uv = uvOf('pan2');                                                                          // ceiling: painted panels (face down)
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) B.quad(V(-0.95 + i * 0.6334, RY, TOP_Z - 0.02 + j * 0.4667), V(0.6334, 0, 0), V(0, 0, 0.4667), 0xffffff, { sx: 3, sy: 3 });
    B.uv = null;
    B.uv = uvOf('roofP'); B.quad(V(-0.26, RY - 0.012, -0.64), V(0.52, 0, 0), V(0, 0, 0.16), 0xffffff); B.uv = null;          // overhead switch panel
    B.box(V(0, RY - 0.006, -0.56), [0.56, 0.012, 0.22], [0, 0, 0], GR, { faces: 'xXzZ' });
    for (const s of [-1, 1]) {
      const lc = V(s * 0.42, RY - 0.02, -0.30);
      B.box(lc, [0.13, 0.03, 0.08], [0, 0, 0], GR2, { faces: 'xXzZy' });
      B.quad(V(lc.x - 0.05, lc.y - 0.0155, lc.z - 0.03), V(0.045, 0, 0), V(0, 0, 0.06), 0xff2a1a, { e: 1 });           // red lens
      B.quad(V(lc.x + 0.005, lc.y - 0.0155, lc.z - 0.03), V(0.045, 0, 0), V(0, 0, 0.06), 0xfff4d8, { e: 0.35 });        // white lens
    }
    B.uv = uvOf('hatch'); B.quad(V(-0.22, RY - 0.004, -0.12), V(0.44, 0, 0), V(0, 0, 0.44), 0xffffff); B.uv = null;          // roof hatch
    B.tube([V(-0.30, RY - 0.005, 0.30), V(-0.30, RY - 0.06, 0.30), V(0.30, RY - 0.06, 0.30), V(0.30, RY - 0.005, 0.30)], 0.012, 6, DK);   // grab handle
    // cable loom along the front ceiling edge
    B.tube([V(-0.93, RY - 0.03, TOP_Z + 0.10), V(0.93, RY - 0.03, TOP_Z + 0.10)], 0.018, 6, 0x5a5f55);
    B.tube([V(-0.92, RY - 0.05, TOP_Z + 0.12), V(-0.92, -0.16, TOP_Z + 0.12)], 0.014, 6, 0x5a5f55);

    // --- keyboard shelf below the radar monitor: key plates + trackball
    const shelfY = hR.o.y - 0.012, shelfZ0 = hR.o.z + 0.02, shelfD = 0.30;
    B.box(V(0, shelfY - 0.025, shelfZ0 + shelfD / 2), [1.30, 0.05, shelfD], [0, 0, 0], { all: WH, y: WH2, Z: GR }, { faces: 'YZxX', sx: 6, sy: 2 });
    B.uv = uvOf('keysL'); B.quad(V(-0.60, shelfY + 0.002, shelfZ0 + 0.22), V(0.52, 0, 0), V(0, 0.01, -0.19), 0xffffff); B.uv = null;
    B.uv = uvOf('keysR'); B.quad(V(0.02, shelfY + 0.002, shelfZ0 + 0.22), V(0.52, 0, 0), V(0, 0.01, -0.19), 0xffffff); B.uv = null;
    B.dome(V(0.415, shelfY + 0.004, shelfZ0 + 0.125), V(0, 1, 0), 0.034, 14, 0x1c1f22, 0.75);          // trackball
    B.box(V(0, shelfY - 0.04, shelfZ0 + shelfD + 0.02), [1.30, 0.04, 0.04], [0, 0, 0], RB, { faces: 'YZ' });   // rubber edge
    // --- the console body under the shelf + side cheeks up to the dash
    B.box(V(0, shelfY - 0.36, shelfZ0 + 0.10), [1.30, 0.62, 0.02], [0, 0, 0], WH2, { faces: 'Z', sx: 4, sy: 2 });
    for (const s of [-1, 1]) B.box(V(s * 0.66, -0.26, -0.62), [0.04, 0.34, 0.40], [0, 0, 0], WH, { faces: s < 0 ? 'XYZ' : 'xYZ', sy: 2 });

    // --- left side: angled map monitor (static tactical map, self-lit), switch panel, side window, extinguisher box
    {
      const c = V(-0.62, -0.13, -0.42), bs = B.basis(-12, 52, 0), w = 0.30, h = 0.34;
      B.box(c.clone().addScaledVector(bs.Z, -0.05), [w + 0.05, h + 0.07, 0.10], bs, { all: DK, Z: GR2 }, { faces: 'xXyYZ' });
      B.uv = uvOf('map'); B.quad(c.clone().addScaledVector(bs.X, -w / 2).addScaledVector(bs.Y, -h / 2 + 0.01).addScaledVector(bs.Z, 0.0015), bs.X.clone().multiplyScalar(w), bs.Y.clone().multiplyScalar(h), 0xffffff, { e: 0.85 }); B.uv = null;
      // left wall panel with the side window
      B.uv = uvOf('pan2'); B.quad(V(-0.95, -1.2, 0.5), V(0, 0, -0.75), V(0, 1.1, 0), 0xffffff, { sx: 3, sy: 3 }); B.quad(V(-0.95, -1.2, -0.25), V(0, 0, -0.75), V(0, 1.1, 0), 0xffffff, { sx: 3, sy: 3 }); B.uv = null;   // lower wall
      B.quad(V(-0.95, -0.1, 0.5), V(0, 0, -0.95), V(0, 0.46, 0), WH, { sx: 4, sy: 2 });                                     // upper wall behind the window
      B.quad(V(-0.95, -0.1, -0.45), V(0, 0, -0.55), V(0, 0.07, 0), WH, { sx: 2 });                                         // under the window
      B.quad(V(-0.95, 0.20, -0.45), V(0, 0, -0.55), V(0, 0.16, 0), WH, { sx: 2 });                                         // above the window
      const sw = [V(-0.95, -0.03, -0.45), V(-0.95, -0.03, -1.0), V(-0.95, 0.20, -1.0), V(-0.95, 0.20, -0.45)];           // side window opening (x = −0.95)
      B.quad(V(-0.99, -0.03, -0.45), V(0.04, 0, 0), V(0, 0, -0.55), GR2); B.quad(V(-0.95, 0.20, -0.45), V(-0.04, 0, 0), V(0, 0, -0.55), DK);
      B.quad(V(-0.99, -0.03, -0.45), V(0, 0.23, 0), V(0.04, 0, 0), GR2); B.quad(V(-0.95, -0.03, -1.0), V(0, 0.23, 0), V(-0.04, 0, 0), GR2);
      B.quad(V(-0.95, -1.2, -1.0), V(0, 0, -0.18), V(0, 1.56, 0), WH2, { sy: 3 });                                         // wall ahead of the window
      glassParts.push([V(-0.985, -0.03, -0.45), V(0, 0, -0.55), V(0, 0.23, 0)]);
      winQuads.push(V(-0.99, -0.03, -0.45), V(-0.99, -0.03, -1.0), V(-0.99, 0.20, -1.0), V(-0.99, 0.20, -0.45));
      B.uv = uvOf('side'); B.quad(V(-0.945, -0.52, -0.05), V(0, 0, -0.42), V(0, 0.28, 0), 0xffffff); B.uv = null;          // wall switch panel
      B.box(V(-0.90, -0.34, 0.22), [0.10, 0.28, 0.12], [0, 0, 0], { all: 0xb8241c, x: 0x8e1a14 }, { faces: 'XYZz' });         // red box
      B.uv = uvOf('ext'); B.quad(V(-0.849, -0.30, 0.275), V(0, 0, -0.11), V(0, 0.028, 0), 0xffffff); B.uv = null;               // V1.4.2 its label
      B.uv = uvOf('st3'); B.quad(V(-0.944, -0.205, -0.04), V(0, 0, -0.40), V(0, 0.05, 0), 0xffffff); B.uv = null;              // no-smoking stencil
      B.tube([V(-0.93, 0.05, 0.30), V(-0.88, 0.05, 0.30), V(-0.88, 0.05, -0.20), V(-0.93, 0.05, -0.20)], 0.011, 6, DK);    // handle
      B.tube([V(-0.93, -0.62, 0.45), V(-0.93, -0.62, -0.9)], 0.016, 6, 0x5a5f55); B.tube([V(-0.925, -0.66, 0.45), V(-0.925, -0.66, -0.9)], 0.01, 5, 0x3a3f36);
    }
    // --- right side: the switch column (photo), right wall with vents, placard and handle
    {
      const c = V(0.60, -0.10, -0.46), bs = B.basis(-6, -48, 0);
      B.box(c.clone().addScaledVector(bs.Z, -0.04), [0.21, 0.56, 0.08], bs, { all: WH2, Z: WH }, { faces: 'xXYZ' });
      B.uv = uvOf('swR'); B.quad(c.clone().addScaledVector(bs.X, -0.095).addScaledVector(bs.Y, -0.265).addScaledVector(bs.Z, 0.0015), bs.X.clone().multiplyScalar(0.19), bs.Y.clone().multiplyScalar(0.53), 0xffffff); B.uv = null;
      B.uv = uvOf('pan'); B.quad(V(0.95, -1.2, -1.18), V(0, 0, 0.84), V(0, 1.56, 0), 0xffffff, { sx: 3, sy: 4 }); B.quad(V(0.95, -1.2, -0.34), V(0, 0, 0.84), V(0, 1.56, 0), 0xffffff, { sx: 3, sy: 4 }); B.uv = null;   // right wall
      B.uv = uvOf('vent'); B.quad(V(0.945, 0.02, -0.55), V(0, 0, 0.22), V(0, 0.22, 0), 0xffffff); B.uv = null;
      B.uv = uvOf('warn'); B.quad(V(0.945, -0.28, -0.20), V(0, 0, 0.20), V(0, 0.085, 0), 0xffffff); B.uv = null;
      B.uv = uvOf('warn2'); B.quad(V(0.945, -0.16, -0.31), V(0, 0, 0.30), V(0, 0.0375, 0), 0xffffff); B.uv = null;          // V1.4.2 microwave hazard
      B.tube([V(0.93, 0.08, -0.15), V(0.88, 0.08, -0.15), V(0.88, 0.08, 0.30), V(0.93, 0.08, 0.30)], 0.011, 6, DK);
      B.tube([V(0.93, RY - 0.05, -0.75), V(0.93, RY - 0.05, 0.45)], 0.02, 6, 0x5a5f55);
      B.uv = uvOf('lamps'); B.quad(V(0.945, -0.08, -0.62), V(0, 0, 0.26), V(0, 0.05, 0), 0xffffff, { e: 0.9 }); B.uv = null;
    }
    // --- floor (mostly unseen) + a rear wall so the look-around never sees the sky through a gap
    B.quad(V(-0.95, -1.15, 0.8), V(1.9, 0, 0), V(0, 0, -2.0), 0x3a3f3c, { sx: 2, sy: 2 });
    B.quad(V(0.95, -1.15, 0.8), V(-1.9, 0, 0), V(0, 1.51, 0), WH2, { sx: 2 });

    // ---- per-vertex light terms: window exposure (sun, sky), screen glow, red night lamps
    const W0 = V(-0.1, 0.06, -0.92), W1 = V(-0.99, 0.08, -0.72);        // windshield / side window centres
    const scr = [[hR.c, hR.n, 1.0], [hE.c, hE.n, 0.55], [V(-0.62, -0.13, -0.42), V(0.75, 0.2, 0.6).normalize(), 0.35]];
    const lamps = [V(-0.42, RY - 0.05, -0.30), V(0.42, RY - 0.05, -0.30)];
    const _d = new T.Vector3();
    const light = (x, y, z, nx, ny, nz, out, o) => {
      let sun = 0, sky = 0;
      for (const [Wc, k] of [[W0, 1], [W1, 0.45]]) {
        _d.set(Wc.x - x, Wc.y - y, Wc.z - z); const d = _d.length() + 1e-4; _d.divideScalar(d);
        const f = Math.max(0, nx * _d.x + ny * _d.y + nz * _d.z);
        sky += k * (0.25 + 0.75 * f) / (1 + d * d * 1.6); sun += k * f / (1 + d * d * 2.5);
      }
      sky = Math.min(1, 0.34 + sky * 1.2 + Math.max(0, y + 0.2) * 0.3);
      if (y < -0.5) sky *= 0.6 + 0.4 * (y + 1.2) / 0.7;                // low: darker (floor / under the shelf)
      let g = 0;
      for (const [c, n, k] of scr) {
        _d.set(x - c.x, y - c.y, z - c.z); const d = _d.length() + 1e-4; _d.divideScalar(d);
        const emit = Math.max(0, _d.x * n.x + _d.y * n.y + _d.z * n.z), rec = Math.max(0, -(nx * _d.x + ny * _d.y + nz * _d.z));
        g += k * emit * rec * 0.05 / (d * d + 0.02);
      }
      let lp = 0;
      for (const c of lamps) {
        _d.set(c.x - x, c.y - y, c.z - z); const d = _d.length() + 1e-4;
        lp += Math.max(0.15, (nx * _d.x + ny * _d.y + nz * _d.z) / d) * 0.07 / (d * d + 0.12);
      }
      out[o] = Math.min(1, sun * 1.4); out[o + 1] = sky; out[o + 2] = Math.min(1.4, g); out[o + 3] = Math.min(0.9, lp);
    };
    const geo = B.geometry(light);
    const uniforms = { map: { value: tex }, uSky: { value: new T.Color(0.6, 0.62, 0.66) }, uGnd: { value: new T.Color(0.25, 0.24, 0.2) }, uSunC: { value: new T.Color(0.5, 0.5, 0.5) },
      uSunD: { value: new T.Vector3(0, 0.6, -0.8) }, uScr: { value: new T.Color(0.12, 0.16, 0.2) }, uLmp: { value: new T.Color(0, 0, 0) }, uFill: { value: new T.Color(0.12, 0.12, 0.12) }, uSelf: { value: 1 } };
    const bodyMat = new T.ShaderMaterial({ vertexShader: BODY_VS, fragmentShader: BODY_FS, uniforms });
    const group = new T.Group(); group.name = 'cabin';
    const body = new T.Mesh(geo, bodyMat); body.name = 'cabin_body'; body.frustumCulled = false; group.add(body);
    // glass: all panes in one mesh (uv spans each pane; size in metres drives the drop scale)
    const gp = [], gu = [], gi = [];
    for (const [o, u, v] of glassParts) { const b = gp.length / 3; gp.push(o.x, o.y, o.z, o.x + u.x, o.y + u.y, o.z + u.z, o.x + u.x + v.x, o.y + u.y + v.y, o.z + u.z + v.z, o.x + v.x, o.y + v.y, o.z + v.z); gu.push(0, 0, 1, 0, 1, 1, 0, 1); gi.push(b, b + 1, b + 2, b, b + 2, b + 3); }
    const gg = new T.BufferGeometry(); gg.setAttribute('position', new T.Float32BufferAttribute(gp, 3)); gg.setAttribute('uv', new T.Float32BufferAttribute(gu, 2)); gg.setIndex(gi);
    const glassU = { uTime: { value: 0 }, uRain: { value: 0 }, uNight: { value: 0 }, uTint: { value: new T.Color(0.55, 0.62, 0.6) }, uGlare: { value: new T.Color(0.8, 0.85, 0.9) },
      uIn: { value: new T.Color(0, 0, 0) }, uSize: { value: new T.Vector2(0.78, 0.46) } };
    const glassMat = new T.ShaderMaterial({ vertexShader: GLASS_VS, fragmentShader: GLASS_FS, uniforms: glassU, transparent: true, depthWrite: false, side: T.DoubleSide });
    const glass = new T.Mesh(gg, glassMat); glass.name = 'cabin_glass'; glass.renderOrder = 5; glass.frustumCulled = false; group.add(glass);
    // EO picture: a quad on the EO screen (material assigned by scene.js; the EO post shader runs on it)
    const eg = new T.BufferGeometry(), e0 = eo[3], e1 = eo[2], e2 = eo[1], e3 = eo[0], off = hE.n.clone().multiplyScalar(0.0005);
    eg.setAttribute('position', new T.Float32BufferAttribute([e0, e1, e2, e3].flatMap(v => [v.x + off.x, v.y + off.y, v.z + off.z]), 3));
    eg.setAttribute('uv', new T.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2)); eg.setIndex([0, 1, 2, 0, 2, 3]);
    const eoFace = new T.Mesh(eg, new T.MeshBasicMaterial({ color: 0x0a0d0e })); eoFace.name = 'cabin_eo'; eoFace.frustumCulled = false; group.add(eoFace);
    return { group, body, glass, eoFace, uniforms, glassU, rects: { radar: rad, eo }, windows: winQuads, tris: B.tris + gi.length / 3 + 2 };
  }

  /* ---------------- DOM projection (homography → CSS matrix3d) ---------------- */
  const EPS = 0.05;                           // px: re-write a transform only when a corner moved at least this much
  const binds = [];                           // { el, name, q:[8], w, h, H:[9] (local px → hatch px), Hi:[9], vis, n }
  let hatchEl = null, updates = 0, ro = null;
  function bind(el, name) {
    if (!el) return null;
    let b = binds.find(x => x.el === el);
    if (!b) { b = { el, name, q: [0, 0, 0, 0, 0, 0, 0, 0], w: 0, h: 0, H: null, Hi: null, vis: null, n: 0 }; binds.push(b); }
    b.name = name; b.w = 0; b.dirty = true; el.__cab = b;
    el.style.transformOrigin = '0 0';
    if (window.ResizeObserver) { ro = ro || new ResizeObserver(es => { for (const e of es) if (e.target.__cab) e.target.__cab.dirty = true; }); ro.observe(el); }
    return b;
  }
  function unbind(el) { const i = binds.findIndex(x => x.el === el); if (i >= 0) { binds.splice(i, 1); el.__cab = null; el.style.transform = ''; el.style.visibility = ''; } }
  // unit square → quad (Heckbert), then scaled for a w×h element; H = [a b c; d e f; g h 1] (row-major)
  function homography(q, w, h, H) {
    const x0 = q[0], y0 = q[1], x1 = q[2], y1 = q[3], x2 = q[4], y2 = q[5], x3 = q[6], y3 = q[7];
    const sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3;
    let g = 0, hh = 0;
    if (Math.abs(sx) > 1e-9 || Math.abs(sy) > 1e-9) {
      const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2, den = dx1 * dy2 - dx2 * dy1;
      g = (sx * dy2 - dx2 * sy) / den; hh = (dx1 * sy - sx * dy1) / den;
    }
    H[0] = (x1 - x0 + g * x1) / w; H[1] = (x3 - x0 + hh * x3) / h; H[2] = x0;
    H[3] = (y1 - y0 + g * y1) / w; H[4] = (y3 - y0 + hh * y3) / h; H[5] = y0;
    H[6] = g / w; H[7] = hh / h; H[8] = 1;
    return H;
  }
  function inv3(m, o) {
    const a = m[0], b = m[1], c = m[2], d = m[3], e = m[4], f = m[5], g = m[6], h = m[7], i = m[8];
    const A = e * i - f * h, Bq = -(d * i - f * g), C = d * h - e * g, det = a * A + b * Bq + c * C || 1e-12;
    o[0] = A / det; o[1] = -(b * i - c * h) / det; o[2] = (b * f - c * e) / det;
    o[3] = Bq / det; o[4] = (a * i - c * g) / det; o[5] = -(a * f - c * d) / det;
    o[6] = C / det; o[7] = -(a * h - b * g) / det; o[8] = (a * e - b * d) / det;
    return o;
  }
  const f6 = v => (Math.abs(v) < 1e-12 ? 0 : +v.toPrecision(9));
  function apply(b) {
    const H = b.H;
    // matrix3d is column-major: (x,y,0,1) → (H0 x + H1 y + H2, H3 x + H4 y + H5, 0, H6 x + H7 y + 1)
    b.el.style.transform = 'matrix3d(' + f6(H[0]) + ',' + f6(H[3]) + ',0,' + f6(H[6]) + ',' + f6(H[1]) + ',' + f6(H[4]) + ',0,' + f6(H[7]) + ',0,0,1,0,' + f6(H[2]) + ',' + f6(H[5]) + ',0,1)';
    updates++; b.n++;
  }
  function update() {
    const S = RS.scene;
    for (let k = 0; k < binds.length; k++) {
      const b = binds[k], q = S && S.screenQuad ? S.screenQuad(b.name) : null;
      if (!q) { if (b.vis !== false) { b.vis = false; b.el.style.visibility = 'hidden'; } continue; }
      if (b.vis !== true) { b.vis = true; b.el.style.visibility = ''; }
      if (b.dirty || !ro) { b.dw = b.el.offsetWidth; b.dh = b.el.offsetHeight; b.dirty = false; }   // layout size (read only after a resize)
      const w = b.dw, h = b.dh;
      if (!w || !h) continue;
      let moved = w !== b.w || h !== b.h || !b.H;
      if (!moved) for (let i = 0; i < 8; i++) if (Math.abs(q[i] - b.q[i]) >= EPS) { moved = true; break; }
      if (!moved) continue;
      for (let i = 0; i < 8; i++) b.q[i] = q[i];
      b.w = w; b.h = h;
      b.H = homography(q, w, h, b.H || new Array(9)); b.Hi = inv3(b.H, b.Hi || new Array(9));
      apply(b);
    }
  }
  // bound ancestor of el + el's border-box offset inside it (layout px; transforms don't change offsets)
  function rootOf(el, out) {
    let x = 0, y = 0, e = el;
    while (e && !e.__cab) {
      const p = e.offsetParent; if (!p) return null;
      x += e.offsetLeft + p.clientLeft; y += e.offsetTop + p.clientTop; e = p;
      if (p.__cab) break;
    }
    if (!e || !e.__cab || !e.__cab.H) return null;
    out.x = x; out.y = y; out.b = e.__cab; return out;
  }
  const _o = { x: 0, y: 0, b: null };
  function hatchOrigin() { hatchEl = hatchEl || document.getElementById('hatch'); const r = hatchEl.getBoundingClientRect(); return [r.left + hatchEl.clientLeft, r.top + hatchEl.clientTop]; }
  /** client px → element-local CSS px ({x,y}); elements that aren't projected fall back to their bounding box. */
  function toLocal(el, cx, cy) {
    const R = rootOf(el, _o);
    if (!R) { const r = el.getBoundingClientRect(); return { x: cx - r.left, y: cy - r.top }; }
    const [hx, hy] = hatchOrigin(), X = cx - hx, Y = cy - hy, M = R.b.Hi;
    const w = M[6] * X + M[7] * Y + M[8];
    return { x: (M[0] * X + M[1] * Y + M[2]) / w - R.x, y: (M[3] * X + M[4] * Y + M[5]) / w - R.y };
  }
  /** element-local CSS px → client px ({x,y}). */
  function toClient(el, x, y) {
    const R = rootOf(el, _o);
    if (!R) { const r = el.getBoundingClientRect(); return { x: r.left + x, y: r.top + y }; }
    const [hx, hy] = hatchOrigin(), u = x + R.x, v = y + R.y, M = R.b.H, w = M[6] * u + M[7] * v + M[8];
    return { x: hx + (M[0] * u + M[1] * v + M[2]) / w, y: hy + (M[3] * u + M[4] * v + M[5]) / w };
  }

  /* ---------------- look-around (drag on the cabin) ---------------- */
  const look = { yaw: 0, pitch: 0, vy: 0, vp: 0, dragging: false, ty: 0, tp: 0, releasedAt: 0,
    set(y, p) { this.ty = this.yaw = clampv(+y || 0, -SEAT.yawMax, SEAT.yawMax); this.tp = this.pitch = clampv(+p || 0, SEAT.pitchMin, SEAT.pitchMax); this.vy = this.vp = 0; return [this.yaw, this.pitch]; } };
  const clampv = (v, a, b) => Math.max(a, Math.min(b, v));
  const DEG_PER_PX = 0.28, OMEGA = 9;         // spring: critically damped, settles in ~0.6 s
  let drag = null, enabled = true;
  function frame(dt) {
    dt = Math.min(dt || 0, 0.25);
    const L = look;
    if (!enabled && !L.dragging) { L.ty = L.tp = 0; }
    if (L.dragging) {                        // follow the finger closely
      const k = 1 - Math.exp(-dt * 30);
      L.yaw += (L.ty - L.yaw) * k; L.pitch += (L.tp - L.pitch) * k; L.vy = L.vp = 0;
    } else {
      // exact critically damped step (stable at any frame rate): x(t) = (x0 + (v0 + ω x0) t) e^(−ωt)
      const e = Math.exp(-OMEGA * dt), ay = L.vy + OMEGA * L.yaw, ap = L.vp + OMEGA * L.pitch;
      L.yaw = (L.yaw + ay * dt) * e; L.vy = (L.vy - OMEGA * ay * dt) * e;
      L.pitch = (L.pitch + ap * dt) * e; L.vp = (L.vp - OMEGA * ap * dt) * e;
      if (Math.abs(L.yaw) < 0.01 && Math.abs(L.vy) < 0.05) { L.yaw = 0; L.vy = 0; }
      if (Math.abs(L.pitch) < 0.01 && Math.abs(L.vp) < 0.05) { L.pitch = 0; L.vp = 0; }
    }
    return L;
  }
  function onDown(ev) {
    if (!enabled || document.body.classList.contains('titling') || (RS.scene && RS.scene.titleOn)) return;
    if (drag) return;
    drag = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, y0: look.yaw, p0: look.pitch };
    look.dragging = true; look.ty = look.yaw; look.tp = look.pitch;
    try { ev.target.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
  }
  function onMove(ev) {
    if (!drag || ev.pointerId !== drag.id) return;
    // grab the world: drag left → the view turns right (yaw −), drag down → look up
    look.ty = clampv(drag.y0 + (ev.clientX - drag.x) * DEG_PER_PX, -SEAT.yawMax, SEAT.yawMax);
    look.tp = clampv(drag.p0 + (ev.clientY - drag.y) * DEG_PER_PX, SEAT.pitchMin, SEAT.pitchMax);
  }
  function onUp(ev) { if (!drag || ev.pointerId !== drag.id) return; drag = null; look.dragging = false; look.releasedAt = performance.now(); }
  let inputBound = false;
  function bindInput() {
    if (inputBound) return;
    const v = document.getElementById('view'); if (!v) return;
    inputBound = true;
    v.addEventListener('pointerdown', onDown);
    v.addEventListener('pointermove', onMove);
    v.addEventListener('pointerup', onUp);
    v.addEventListener('pointercancel', onUp);
    v.addEventListener('lostpointercapture', onUp);
  }
  function setEnabled(v) { enabled = !!v; if (!enabled && drag) { drag = null; look.dragging = false; } return enabled; }

  function debug() {
    const out = { updates, look: { yaw: +look.yaw.toFixed(2), pitch: +look.pitch.toFixed(2), dragging: look.dragging }, enabled, binds: {} };
    for (const b of binds) out.binds[b.name] = { id: b.el.id, visible: b.vis, w: b.w, h: b.h, quad: b.q.map(v => +v.toFixed(1)), n: b.n };
    return out;
  }
  RS.cabin = { SEAT, RADAR_AR, model, layout, bind, unbind, update, toLocal, toClient, look, frame, setEnabled, bindInput, debug, homography };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindInput); else bindInput();
})();
