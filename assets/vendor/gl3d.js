/* GL3D: a small WebGL2 renderer for the portfolio's 3D models. No dependencies.
   Physically based shading (GGX + Schlick + Smith), a procedural studio
   environment for reflections (gradient sky + two rectangular softboxes),
   one soft-shadowed key light, a transparent "shadow catcher" ground,
   ACES tone mapping, clearcoat, canvas textures, picking and DOM-label projection.

   Conventions
   - Units: metres-ish. +Y is up. Geometry is centred on its local origin.
   - node.rot = [rx, ry, rz] radians, applied Z first, then X, then Y (M = T * Ry * Rx * Rz * S).
   - Colours are sRGB hex strings ('#aabbcc') or linear [r, g, b] arrays.
   - The canvas is transparent (premultiplied alpha): the page shows through.

   Quick start
     const v = GL3D.view(canvas, { shadow: 2048 });
     if (!v) return fallback();
     const m = GL3D.material({ color: '#d8f36a', roughness: .35 });
     v.scene.add(GL3D.node({ geo: GL3D.box(1, .2, 1, { r: .04 }), mat: m }));
     v.camera.pos = [2, 1.6, 2.4]; v.camera.target = [0, 0, 0];
     v.frame((dt, t) => { ...animate...; return true; });   // return false to idle
*/
(() => {
  'use strict';

  /* ------------------------------------------------------------------ math */
  const M4 = {
    create() { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; },
    identity(o) { o.fill(0); o[0] = o[5] = o[10] = o[15] = 1; return o; },
    mul(o, a, b) {
      const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3], a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7],
        a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11], a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
      for (let i = 0; i < 4; i++) {
        const b0 = b[i * 4], b1 = b[i * 4 + 1], b2 = b[i * 4 + 2], b3 = b[i * 4 + 3];
        o[i * 4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
        o[i * 4 + 1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
        o[i * 4 + 2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
        o[i * 4 + 3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
      }
      return o;
    },
    perspective(o, fovy, aspect, near, far) {
      const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
      o.fill(0); o[0] = f / aspect; o[5] = f; o[10] = (far + near) * nf; o[11] = -1; o[14] = 2 * far * near * nf; return o;
    },
    ortho(o, l, r, b, t, n, f) {
      const lr = 1 / (l - r), bt = 1 / (b - t), nf = 1 / (n - f);
      o.fill(0); o[0] = -2 * lr; o[5] = -2 * bt; o[10] = 2 * nf; o[12] = (l + r) * lr; o[13] = (t + b) * bt; o[14] = (f + n) * nf; o[15] = 1; return o;
    },
    lookAt(o, e, c, up) {
      let zx = e[0] - c[0], zy = e[1] - c[1], zz = e[2] - c[2];
      let l = Math.hypot(zx, zy, zz) || 1; zx /= l; zy /= l; zz /= l;
      let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
      l = Math.hypot(xx, xy, xz) || 1; xx /= l; xy /= l; xz /= l;
      const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
      o[0] = xx; o[1] = yx; o[2] = zx; o[3] = 0; o[4] = xy; o[5] = yy; o[6] = zy; o[7] = 0;
      o[8] = xz; o[9] = yz; o[10] = zz; o[11] = 0;
      o[12] = -(xx * e[0] + xy * e[1] + xz * e[2]); o[13] = -(yx * e[0] + yy * e[1] + yz * e[2]); o[14] = -(zx * e[0] + zy * e[1] + zz * e[2]); o[15] = 1;
      return o;
    },
    fromTRS(o, t, r, s) {
      const cx = Math.cos(r[0]), sx = Math.sin(r[0]), cy = Math.cos(r[1]), sy = Math.sin(r[1]), cz = Math.cos(r[2]), sz = Math.sin(r[2]);
      const sX = s[0], sY = s[1], sZ = s[2];
      // R = Ry * Rx * Rz (column-major)
      o[0] = (cy * cz + sy * sx * sz) * sX; o[1] = (cx * sz) * sX; o[2] = (-sy * cz + cy * sx * sz) * sX; o[3] = 0;
      o[4] = (-cy * sz + sy * sx * cz) * sY; o[5] = (cx * cz) * sY; o[6] = (sy * sz + cy * sx * cz) * sY; o[7] = 0;
      o[8] = (sy * cx) * sZ; o[9] = (-sx) * sZ; o[10] = (cy * cx) * sZ; o[11] = 0;
      o[12] = t[0]; o[13] = t[1]; o[14] = t[2]; o[15] = 1;
      return o;
    },
    invert(o, a) {
      const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3], a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7],
        a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11], a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
      const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11,
        b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12, b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30,
        b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
      let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
      if (!det) return M4.identity(o);
      det = 1 / det;
      o[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det; o[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
      o[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det; o[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
      o[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det; o[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
      o[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det; o[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
      o[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det; o[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
      o[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det; o[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
      o[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det; o[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
      o[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det; o[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
      return o;
    },
    normal3(o, m) { // inverse-transpose of the upper 3x3
      const a00 = m[0], a01 = m[1], a02 = m[2], a10 = m[4], a11 = m[5], a12 = m[6], a20 = m[8], a21 = m[9], a22 = m[10];
      const b01 = a22 * a11 - a12 * a21, b11 = -a22 * a10 + a12 * a20, b21 = a21 * a10 - a11 * a20;
      let det = a00 * b01 + a01 * b11 + a02 * b21; if (!det) det = 1e-8; det = 1 / det;
      o[0] = b01 * det; o[3] = (-a22 * a01 + a02 * a21) * det; o[6] = (a12 * a01 - a02 * a11) * det;
      o[1] = b11 * det; o[4] = (a22 * a00 - a02 * a20) * det; o[7] = (-a12 * a00 + a02 * a10) * det;
      o[2] = b21 * det; o[5] = (-a21 * a00 + a01 * a20) * det; o[8] = (a11 * a00 - a01 * a10) * det;
      return o;
    },
    apply(m, p) { // transform a point
      const x = p[0], y = p[1], z = p[2], w = m[3] * x + m[7] * y + m[11] * z + m[15] || 1;
      return [(m[0] * x + m[4] * y + m[8] * z + m[12]) / w, (m[1] * x + m[5] * y + m[9] * z + m[13]) / w, (m[2] * x + m[6] * y + m[10] * z + m[14]) / w];
    }
  };
  const V3 = {
    sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
    add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
    scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
    dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    len: a => Math.hypot(a[0], a[1], a[2]),
    norm: a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
    lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
  };
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const damp = (cur, target, lambda, dt) => cur + (target - cur) * (1 - Math.exp(-lambda * dt));
  const s2l = c => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  function color(c) {
    if (Array.isArray(c) || c instanceof Float32Array) return [c[0], c[1], c[2]];
    const h = String(c || '#ffffff').replace('#', '');
    const f = h.length === 3 ? h.split('').map(x => x + x).join('') : h;
    return [s2l(parseInt(f.slice(0, 2), 16) / 255), s2l(parseInt(f.slice(2, 4), 16) / 255), s2l(parseInt(f.slice(4, 6), 16) / 255)];
  }

  /* -------------------------------------------------------------- geometry */
  // A geometry is { positions, normals, uvs, indices } of plain arrays or typed arrays.
  function finish(p, n, u, i) {
    return { positions: new Float32Array(p), normals: new Float32Array(n), uvs: new Float32Array(u || new Array(p.length / 3 * 2).fill(0)), indices: (p.length / 3 > 65535 ? new Uint32Array(i) : new Uint16Array(i)), version: 0 };
  }

  // Rounded box. Vertices cluster on the rounded edges, so highlights read as real bevels.
  function box(w, h, d, o = {}) {
    const H = [w / 2, h / 2, d / 2];
    const r = Math.min(o.r || 0, H[0], H[1], H[2]) * 0.999;
    const seg = r > 0 ? (o.seg || 4) : 1;
    const samples = a => {
      if (r <= 0) return [-H[a], H[a]];
      const out = [];
      for (let i = 0; i <= seg; i++) out.push(-H[a] + r - r * Math.cos(i / seg * Math.PI / 2));
      for (let i = seg; i >= 0; i--) out.push(H[a] - r + r * Math.cos(i / seg * Math.PI / 2));
      return out;
    };
    const S = [samples(0), samples(1), samples(2)];
    const P = [], N = [], U = [], I = [];
    const faces = [[0, 1, 2, 1], [0, 1, 2, -1], [2, 1, 0, 1], [2, 1, 0, -1], [0, 2, 1, 1], [0, 2, 1, -1]];
    for (const [ua, va, fa, sign] of faces) {
      const us = S[ua], vs = S[va], base = P.length / 3;
      for (let j = 0; j < vs.length; j++) for (let i = 0; i < us.length; i++) {
        const p = [0, 0, 0]; p[ua] = us[i]; p[va] = vs[j]; p[fa] = sign * H[fa];
        const inner = p.map((x, k) => clamp(x, -(H[k] - r), H[k] - r));
        let nn = V3.sub(p, inner); let l = V3.len(nn);
        if (l < 1e-9) { nn = [0, 0, 0]; nn[fa] = sign; l = 1; }
        nn = V3.scale(nn, 1 / l);
        const q = r > 0 ? V3.add(inner, V3.scale(nn, r)) : p;
        P.push(q[0], q[1], q[2]); N.push(nn[0], nn[1], nn[2]);
        U.push((us[i] + H[ua]) / (2 * H[ua]), (vs[j] + H[va]) / (2 * H[va]));
      }
      const fn = [0, 0, 0]; fn[fa] = sign;
      for (let j = 0; j < vs.length - 1; j++) for (let i = 0; i < us.length - 1; i++) {
        const a = base + j * us.length + i, b = a + 1, c = a + us.length, e = c + 1;
        // choose winding so the face points outwards
        const pa = [P[a * 3], P[a * 3 + 1], P[a * 3 + 2]], pb = [P[b * 3], P[b * 3 + 1], P[b * 3 + 2]], pc = [P[c * 3], P[c * 3 + 1], P[c * 3 + 2]];
        const cr = V3.cross(V3.sub(pb, pa), V3.sub(pc, pa));
        if (V3.dot(cr, fn) >= 0) I.push(a, b, c, b, e, c); else I.push(a, c, b, b, c, e);
      }
    }
    return finish(P, N, U, I);
  }

  // Lathe: revolve a profile [[radius, y], ...] (bottom to top) around +Y.
  function lathe(profile, o = {}) {
    const seg = o.seg || 32, P = [], N = [], U = [], I = [];
    const prof = profile.map(p => [p[0], p[1]]);
    // per-profile-vertex 2D normals (outward)
    const n2 = prof.map((p, i) => {
      const a = prof[Math.max(0, i - 1)], b = prof[Math.min(prof.length - 1, i + 1)];
      let tx = b[0] - a[0], ty = b[1] - a[1]; const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
      return [ty, -tx];
    });
    for (let s = 0; s <= seg; s++) {
      const a = s / seg * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      for (let i = 0; i < prof.length; i++) {
        const [rr, y] = prof[i], [nr, ny] = n2[i];
        P.push(rr * ca, y, rr * sa); N.push(nr * ca, ny, nr * sa); U.push(s / seg, i / (prof.length - 1));
      }
    }
    const L = prof.length;
    for (let s = 0; s < seg; s++) for (let i = 0; i < L - 1; i++) {
      const a = s * L + i, b = a + 1, c = a + L, d = c + 1;
      I.push(a, b, c, b, d, c);
    }
    return finish(P, N, U, I);
  }

  function cylinder(rTop, rBot, h, o = {}) {
    const seg = o.seg || 32, bev = Math.min(o.bevel || 0, h / 2, rTop, rBot), prof = [];
    if (o.cap !== false) prof.push([0.0001, -h / 2]);
    if (bev > 0) {
      for (let i = 0; i <= 3; i++) { const t = i / 3 * Math.PI / 2; prof.push([rBot - bev + Math.sin(t) * bev, -h / 2 + bev - Math.cos(t) * bev]); }
      for (let i = 0; i <= 3; i++) { const t = i / 3 * Math.PI / 2; prof.push([rTop - bev + Math.cos(t) * bev, h / 2 - bev + Math.sin(t) * bev]); }
    } else {
      prof.push([rBot, -h / 2], [rBot, -h / 2], [rTop, h / 2], [rTop, h / 2]);
    }
    if (o.cap !== false) prof.push([0.0001, h / 2]);
    if (bev > 0) return lathe(prof, { seg });
    // hard edges: build side and caps separately for crisp normals
    const side = lathe([[rBot, -h / 2], [rTop, h / 2]], { seg });
    if (o.cap === false) return side;
    return merge([{ geo: side }, { geo: disc(rBot, { seg }), pos: [0, -h / 2, 0], rot: [Math.PI, 0, 0] }, { geo: disc(rTop, { seg }), pos: [0, h / 2, 0] }]);
  }
  function disc(r, o = {}) { // facing +Y
    const seg = o.seg || 32, P = [0, 0, 0], N = [0, 1, 0], U = [.5, .5], I = [];
    for (let s = 0; s <= seg; s++) { const a = s / seg * Math.PI * 2; P.push(Math.cos(a) * r, 0, Math.sin(a) * r); N.push(0, 1, 0); U.push(.5 + Math.cos(a) * .5, .5 + Math.sin(a) * .5); }
    for (let s = 1; s <= seg; s++) I.push(0, s + 1, s);
    return finish(P, N, U, I);
  }
  function sphere(r, o = {}) {
    const seg = o.seg || 32, rings = o.rings || 18, prof = [];
    for (let i = 0; i <= rings; i++) { const t = -Math.PI / 2 + i / rings * Math.PI; prof.push([Math.max(1e-4, Math.cos(t) * r), Math.sin(t) * r]); }
    return lathe(prof, { seg });
  }
  function torus(R, r, o = {}) { // ring in the XZ plane
    const seg = o.seg || 48, tube = o.tube || 16, prof = [];
    for (let i = 0; i <= tube; i++) { const t = -Math.PI / 2 - i / tube * Math.PI * 2; prof.push([R + Math.cos(t) * r, Math.sin(t) * r]); }
    return lathe(prof, { seg });
  }
  // Tube along a 3D polyline with parallel-transport frames.
  function tube(path, radius, o = {}) {
    const seg = o.seg || 8, P = [], N = [], U = [], I = [], n = path.length;
    if (n < 2) return finish([], [], [], []);
    let prevN = null;
    for (let i = 0; i < n; i++) {
      const a = path[Math.max(0, i - 1)], b = path[Math.min(n - 1, i + 1)];
      const T = V3.norm(V3.sub(b, a));
      let Nn;
      if (!prevN) { const ref = Math.abs(T[1]) < .9 ? [0, 1, 0] : [1, 0, 0]; Nn = V3.norm(V3.cross(V3.cross(T, ref), T)); }
      else { Nn = V3.norm(V3.sub(prevN, V3.scale(T, V3.dot(prevN, T)))); }
      prevN = Nn;
      const B = V3.cross(T, Nn), rr = typeof radius === 'function' ? radius(i / (n - 1)) : radius;
      for (let s = 0; s <= seg; s++) {
        const ang = s / seg * Math.PI * 2, c = Math.cos(ang), si = Math.sin(ang);
        const nn = [Nn[0] * c + B[0] * si, Nn[1] * c + B[1] * si, Nn[2] * c + B[2] * si];
        P.push(path[i][0] + nn[0] * rr, path[i][1] + nn[1] * rr, path[i][2] + nn[2] * rr); N.push(nn[0], nn[1], nn[2]); U.push(i / (n - 1), s / seg);
      }
    }
    for (let i = 0; i < n - 1; i++) for (let s = 0; s < seg; s++) {
      const a = i * (seg + 1) + s, b = a + 1, c = a + seg + 1, d = c + 1;
      I.push(a, b, c, b, d, c);
    }
    return finish(P, N, U, I);
  }
  // Grid in XZ (w along X, d along Z) with an optional height(x, z) function.
  function plane(w, d, o = {}) {
    const sx = o.sx || 1, sz = o.sz || 1, hf = o.height || null, P = [], N = [], U = [], I = [];
    const H = (x, z) => hf ? hf(x, z) : 0, e = Math.min(w / sx, d / sz) * .5;
    for (let j = 0; j <= sz; j++) for (let i = 0; i <= sx; i++) {
      const x = -w / 2 + i / sx * w, z = -d / 2 + j / sz * d, y = H(x, z);
      P.push(x, y, z); U.push(i / sx, j / sz);
      if (hf) { const nx = H(x - e, z) - H(x + e, z), nz = H(x, z - e) - H(x, z + e); const nn = V3.norm([nx, 2 * e, nz]); N.push(nn[0], nn[1], nn[2]); }
      else N.push(0, 1, 0);
    }
    for (let j = 0; j < sz; j++) for (let i = 0; i < sx; i++) {
      const a = j * (sx + 1) + i, b = a + 1, c = a + sx + 1, dd = c + 1;
      I.push(a, c, b, b, c, dd);
    }
    return finish(P, N, U, I);
  }
  // 2D helpers for extrude
  function roundedRect(w, h, r, seg = 6) {
    r = Math.min(r, w / 2, h / 2); const pts = [], cs = [[w / 2 - r, h / 2 - r, 0], [-w / 2 + r, h / 2 - r, 1], [-w / 2 + r, -h / 2 + r, 2], [w / 2 - r, -h / 2 + r, 3]];
    for (const [cx, cy, q] of cs) for (let i = 0; i <= seg; i++) { const a = (q + i / seg) * Math.PI / 2; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
    return pts; // CCW
  }
  function triangulate(pts) { // ear clipping, CCW simple polygon
    const idx = pts.map((_, i) => i), out = [];
    const area = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
    const inside = (p, a, b, c) => area(a, b, p) >= 0 && area(b, c, p) >= 0 && area(c, a, p) >= 0;
    let guard = 0;
    while (idx.length > 3 && guard++ < 10000) {
      let cut = false;
      for (let i = 0; i < idx.length; i++) {
        const i0 = idx[(i + idx.length - 1) % idx.length], i1 = idx[i], i2 = idx[(i + 1) % idx.length];
        const a = pts[i0], b = pts[i1], c = pts[i2];
        if (area(a, b, c) <= 1e-12) continue;
        let ok = true;
        for (const j of idx) { if (j === i0 || j === i1 || j === i2) continue; if (inside(pts[j], a, b, c)) { ok = false; break; } }
        if (!ok) continue;
        out.push(i0, i1, i2); idx.splice(i, 1); cut = true; break;
      }
      if (!cut) break;
    }
    if (idx.length === 3) out.push(idx[0], idx[1], idx[2]);
    return out;
  }
  // Extrude a CCW 2D shape (x, y) into Y-up thickness: shape x -> X, shape y -> Z, depth along Y (centred).
  function extrude(shape, depth, o = {}) {
    const P = [], N = [], U = [], I = [], n = shape.length, h = depth / 2, tri = triangulate(shape);
    let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
    for (const [x, y] of shape) { minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y); }
    const uv = (x, y) => [(x - minx) / (maxx - minx || 1), (y - miny) / (maxy - miny || 1)];
    // top (+Y) and bottom (-Y). Shape y maps to -Z so CCW in 2D stays CCW seen from above.
    for (const [sgn, ny] of [[1, 1], [-1, -1]]) {
      const base = P.length / 3;
      for (const [x, y] of shape) { P.push(x, sgn * h, -y); N.push(0, ny, 0); U.push(...uv(x, y)); }
      for (let t = 0; t < tri.length; t += 3) { if (sgn > 0) I.push(base + tri[t], base + tri[t + 1], base + tri[t + 2]); else I.push(base + tri[t], base + tri[t + 2], base + tri[t + 1]); }
    }
    // sides with smooth normals across gentle corners (rounded outlines)
    const base = P.length / 3;
    for (let i = 0; i <= n; i++) {
      const p = shape[i % n], a = shape[(i - 1 + n) % n], b = shape[(i + 1) % n];
      let tx = b[0] - a[0], ty = b[1] - a[1]; const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
      const nx = ty, nz = tx; // outward for CCW, with y -> -z
      P.push(p[0], h, -p[1], p[0], -h, -p[1]); N.push(nx, 0, nz, nx, 0, nz); U.push(i / n, 1, i / n, 0);
    }
    for (let i = 0; i < n; i++) { const a = base + i * 2, b = a + 1, c = a + 2, d = a + 3; I.push(a, b, c, c, b, d); }
    return finish(P, N, U, I);
  }
  // Merge [{geo, pos, rot, scale}] into one geometry (static batching).
  function merge(list) {
    const P = [], N = [], U = [], I = [], m = M4.create(), nm = new Float32Array(9);
    for (const it of list) {
      const g = it.geo; if (!g) continue;
      M4.fromTRS(m, it.pos || [0, 0, 0], it.rot || [0, 0, 0], typeof it.scale === 'number' ? [it.scale, it.scale, it.scale] : (it.scale || [1, 1, 1]));
      M4.normal3(nm, m);
      const base = P.length / 3, p = g.positions, nn = g.normals;
      for (let i = 0; i < p.length; i += 3) {
        const x = p[i], y = p[i + 1], z = p[i + 2];
        P.push(m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]);
        const a = nn[i], b = nn[i + 1], c = nn[i + 2];
        const ox = nm[0] * a + nm[3] * b + nm[6] * c, oy = nm[1] * a + nm[4] * b + nm[7] * c, oz = nm[2] * a + nm[5] * b + nm[8] * c, l = Math.hypot(ox, oy, oz) || 1;
        N.push(ox / l, oy / l, oz / l);
      }
      for (let i = 0; i < g.uvs.length; i++) U.push(g.uvs[i]);
      for (let i = 0; i < g.indices.length; i++) I.push(g.indices[i] + base);
    }
    return finish(P, N, U, I);
  }
  // Replace the data of a dynamic geometry in place (e.g. a live signal trace).
  function updateGeo(g, next) { g.positions = next.positions; g.normals = next.normals; g.uvs = next.uvs; g.indices = next.indices; g.version = (g.version || 0) + 1; }

  /* ------------------------------------------------------- materials/nodes */
  let nodeIds = 1;
  function material(o = {}) {
    return {
      color: color(o.color || '#ffffff'), metalness: o.metalness ?? 0, roughness: o.roughness ?? .5,
      emissive: color(o.emissive || '#000000'), emissiveIntensity: o.emissiveIntensity ?? 1,
      opacity: o.opacity ?? 1, transparent: !!o.transparent || (o.opacity ?? 1) < 1 || !!o.shadowCatcher,
      clearcoat: o.clearcoat || 0, clearcoatRoughness: o.clearcoatRoughness ?? .08, envIntensity: o.envIntensity ?? 1,
      map: o.map || null, unlit: !!o.unlit, shadowCatcher: !!o.shadowCatcher, catchRadius: o.catchRadius || 3,
      doubleSided: !!o.doubleSided, depthWrite: o.depthWrite ?? !(o.transparent || (o.opacity ?? 1) < 1 || o.shadowCatcher),
      sheen: o.sheen || 0
    };
  }
  function node(o = {}) {
    const n = {
      id: nodeIds++, name: o.name || '', geo: o.geo || null, mat: o.mat || null,
      pos: o.pos ? o.pos.slice() : [0, 0, 0], rot: o.rot ? o.rot.slice() : [0, 0, 0],
      scale: typeof o.scale === 'number' ? [o.scale, o.scale, o.scale] : (o.scale ? o.scale.slice() : [1, 1, 1]),
      visible: o.visible !== false, castShadow: o.castShadow !== false, pick: o.pick || null,
      children: [], parent: null, local: M4.create(), world: M4.create(), userData: o.userData || {},
      add(...cs) { for (const c of cs) { if (!c) continue; if (c.parent) c.parent.remove(c); c.parent = n; n.children.push(c); } return n; },
      remove(c) { const i = n.children.indexOf(c); if (i >= 0) { n.children.splice(i, 1); c.parent = null; } return n; },
      worldPos() { return [n.world[12], n.world[13], n.world[14]]; },
      find(name) { if (n.name === name) return n; for (const c of n.children) { const f = c.find(name); if (f) return f; } return null; },
      traverse(fn) { fn(n); for (const c of n.children) c.traverse(fn); }
    };
    if (o.children) n.add(...o.children);
    return n;
  }

  /* ---------------------------------------------------------------- shaders */
  const VS = `#version 300 es
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNor; layout(location=2) in vec2 aUv;
uniform mat4 uModel, uView, uProj, uLightVP; uniform mat3 uNormalM;
out vec3 vW; out vec3 vN; out vec2 vUv; out vec4 vL;
void main(){ vec4 w = uModel*vec4(aPos,1.); vW=w.xyz; vN=normalize(uNormalM*aNor); vUv=aUv; vL=uLightVP*w; gl_Position=uProj*uView*w; }`;
  const FS = `#version 300 es
precision highp float; precision highp sampler2DShadow;
in vec3 vW; in vec3 vN; in vec2 vUv; in vec4 vL;
uniform vec3 uCam, uLightDir, uLightCol; uniform float uLightInt;
uniform vec3 uBase, uEmissive; uniform float uMetal, uRough, uOpacity, uClearcoat, uCcRough, uEnvInt, uExposure, uSheen;
uniform int uMode, uHasMap, uHasShadow; uniform sampler2D uMap; uniform sampler2DShadow uShadow; uniform float uTexel, uSoft;
uniform vec3 uSky, uHorizon, uGround, uShadowTint; uniform vec3 uCatchC; uniform float uCatchR;
uniform vec2 uFog; uniform float uEnvRot; uniform vec4 uContacts[8]; uniform int uContactN;
out vec4 o;
const float PI=3.14159265;
const vec2 PD[12]=vec2[](vec2(-.326,-.406),vec2(-.840,-.074),vec2(-.696,.457),vec2(-.203,.621),vec2(.962,-.195),vec2(.473,-.480),vec2(.519,.767),vec2(.185,-.893),vec2(.507,.064),vec2(.896,.412),vec2(-.322,-.933),vec2(-.792,-.598));
vec3 rotY(vec3 d,float a){float c=cos(a),s=sin(a);return vec3(c*d.x+s*d.z,d.y,-s*d.x+c*d.z);}
float softbox(vec3 d, vec3 k, vec3 u, vec2 size, float blur){
  float f=dot(d,k); if(f<=0.) return 0.;
  vec3 r=normalize(cross(k,u)); vec3 up=cross(r,k);
  vec2 q=vec2(dot(d,r),dot(d,up))/f;
  return smoothstep(size.x+blur,size.x-blur,abs(q.x))*smoothstep(size.y+blur,size.y-blur,abs(q.y));
}
vec3 env(vec3 d, float rough){
  d=rotY(d,uEnvRot);
  float y=d.y;
  vec3 c = y>0. ? mix(uHorizon,uSky,pow(clamp(y,0.,1.),.55)) : mix(uHorizon,uGround,pow(clamp(-y,0.,1.),.4));
  float b=.04+rough*1.1;
  float k1=softbox(d,normalize(vec3(-.35,.85,.45)),vec3(0.,0.,-1.),vec2(.9,.35),b);
  float k2=softbox(d,normalize(vec3(.9,.25,-.15)),vec3(0.,1.,0.),vec2(.18,.75),b);
  float k3=softbox(d,normalize(vec3(-.2,.15,1.)),vec3(0.,1.,0.),vec2(1.1,.12),b);
  float e=mix(1.,.35,rough);
  return c + vec3(1.,.99,.96)*(k1*3.2+k2*1.9+k3*.9)*e;
}
vec3 envDiffuse(vec3 n){ return mix(uGround, mix(uHorizon,uSky,.6), n.y*.5+.5)*1.05 + vec3(.12)*max(dot(n,normalize(vec3(-.35,.85,.45))),0.); }
float D_GGX(float NoH,float a){float a2=a*a;float d=NoH*NoH*(a2-1.)+1.;return a2/(PI*d*d+1e-7);}
float V_SmithGGX(float NoV,float NoL,float a){float k=a*.5;float gv=NoV/(NoV*(1.-k)+k);float gl=NoL/(NoL*(1.-k)+k);return gv*gl/max(4.*NoV*NoL,1e-4);}
vec3 F_Schlick(float c,vec3 f0){return f0+(1.-f0)*pow(1.-c,5.);}
vec3 envBRDF(vec3 f0,float rough,float NoV){const vec4 c0=vec4(-1.,-.0275,-.572,.022);const vec4 c1=vec4(1.,.0425,1.04,-.04);vec4 r=rough*c0+c1;float a004=min(r.x*r.x,exp2(-9.28*NoV))*r.x+r.y;vec2 AB=vec2(-1.04,1.04)*a004+r.zw;return f0*AB.x+AB.y;}
vec3 aces(vec3 x){const float a=2.51,b=.03,c=2.43,d=.59,e=.14;return clamp((x*(a*x+b))/(x*(c*x+d)+e),0.,1.);}
float shadowAt(vec3 n){
  if(uHasShadow==0) return 1.;
  vec3 p=vL.xyz/vL.w*.5+.5;
  if(p.x<0.||p.x>1.||p.y<0.||p.y>1.||p.z>1.) return 1.;
  float bias=.0012+.0035*(1.-abs(dot(n,normalize(-uLightDir))));
  float s=0.; float r=uSoft*uTexel;
  for(int i=0;i<12;i++) s+=texture(uShadow,vec3(p.xy+PD[i]*r,p.z-bias));
  return s/12.;
}
void main(){
  vec3 N=normalize(vN); if(!gl_FrontFacing) N=-N;
  float sh=shadowAt(N);
  float fog = uFog.y>uFog.x ? 1.-smoothstep(uFog.x,uFog.y,length(vW-uCam)) : 1.;
  if(uMode==2){ // shadow catcher: only the shadow, fading out radially
    float fade=1.-smoothstep(uCatchR*.45,uCatchR,length(vW.xz-uCatchC.xz));
    float occ=0.;
    for(int i=0;i<8;i++){ if(i>=uContactN) break; vec4 c=uContacts[i]; float d=length(vW.xz-c.xy)/c.z; occ=max(occ,c.w*(1.-smoothstep(0.,1.,d))*(1.-smoothstep(0.,1.,d))); }
    float a=clamp(max((1.-sh)*uOpacity,occ)*fade*fog,0.,1.);
    o=vec4(uShadowTint*a,a); return;
  }
  vec4 tex = uHasMap==1 ? texture(uMap,vUv) : vec4(1.);
  vec3 base=uBase*tex.rgb;
  if(uMode==1){ vec3 c=base+uEmissive; float a=uOpacity*tex.a*fog; o=vec4(pow(clamp(c,0.,1.),vec3(1./2.2))*a,a); return; }
  vec3 V=normalize(uCam-vW); float NoV=max(dot(N,V),1e-3);
  vec3 L=normalize(-uLightDir); vec3 H=normalize(L+V);
  float NoL=max(dot(N,L),0.), NoH=max(dot(N,H),0.), VoH=max(dot(V,H),0.);
  float rough=clamp(uRough,.04,1.); float a=rough*rough;
  vec3 f0=mix(vec3(.04),base,uMetal); vec3 dif=base*(1.-uMetal);
  vec3 F=F_Schlick(VoH,f0);
  vec3 spec=D_GGX(NoH,a)*V_SmithGGX(NoV,NoL,a)*F;
  vec3 direct=((1.-F)*dif/PI+spec)*uLightCol*uLightInt*NoL*sh;
  vec3 R=reflect(-V,N);
  float occ=mix(.55,1.,sh);
  vec3 ambient=(envDiffuse(N)*dif + env(R,rough)*envBRDF(f0,rough,NoV))*uEnvInt*occ;
  if(uSheen>0.){ ambient+=uSheen*pow(1.-NoV,3.)*envDiffuse(N)*.6; }
  vec3 col=direct+ambient;
  if(uClearcoat>0.){
    float Fc=.04+.96*pow(1.-NoV,5.); float ca=max(uCcRough*uCcRough,.003);
    float ccs=D_GGX(NoH,ca)*V_SmithGGX(NoV,NoL,ca)*(.04+.96*pow(1.-VoH,5.));
    col=col*(1.-uClearcoat*Fc)+uClearcoat*(env(R,uCcRough)*Fc*uEnvInt*occ+ccs*uLightCol*uLightInt*NoL*sh);
  }
  col+=uEmissive;
  col=aces(col*uExposure);
  float al=uOpacity*tex.a*fog;
  o=vec4(pow(col,vec3(1./2.2))*al,al);
}`;
  const DEPTH_VS = `#version 300 es
layout(location=0) in vec3 aPos; uniform mat4 uModel, uLightVP; void main(){ gl_Position=uLightVP*uModel*vec4(aPos,1.); }`;
  const DEPTH_FS = `#version 300 es
precision mediump float; out vec4 o; void main(){ o=vec4(1.); }`;
  const PICK_FS = `#version 300 es
precision highp float; uniform vec3 uId; out vec4 o; void main(){ o=vec4(uId,1.); }`;
  const PICK_VS = `#version 300 es
layout(location=0) in vec3 aPos; uniform mat4 uModel, uView, uProj; void main(){ gl_Position=uProj*uView*uModel*vec4(aPos,1.); }`;

  function compile(gl, vs, fs) {
    const mk = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const p = gl.createProgram(); gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'aPos'); gl.bindAttribLocation(p, 1, 'aNor'); gl.bindAttribLocation(p, 2, 'aUv');
    gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); const name = info.name.replace(/\[0\]$/, ''); u[name] = gl.getUniformLocation(p, info.name); }
    return { p, u };
  }

  /* ------------------------------------------------------------------- view */
  function supported() {
    try { const c = document.createElement('canvas'); const gl = c.getContext('webgl2'); const ok = !!(gl && typeof gl.createShader === 'function'); if (gl) { const ext = gl.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext(); } return ok; } catch (e) { return false; }
  }

  function view(canvas, opts = {}) {
    const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: true, preserveDrawingBuffer: !!opts.preserveDrawingBuffer, powerPreference: 'high-performance' });
    if (!gl || typeof gl.createShader !== 'function') return null;
    const coarse = matchMedia('(pointer: coarse)').matches, small = Math.min(screen.width, screen.height) < 700;
    const v = {
      gl, canvas, scene: node({ name: 'scene' }),
      camera: { pos: [3, 2, 4], target: [0, 0, 0], up: [0, 1, 0], fov: opts.fov || 35, near: .05, far: 100 },
      light: { dir: V3.norm(opts.lightDir || [-.45, -1, -.35]), color: color(opts.lightColor || '#fff6ea'), intensity: opts.lightIntensity ?? 2.3, target: [0, 0, 0], bounds: opts.shadowBounds || 4, soft: opts.shadowSoft ?? 2.2 },
      env: { sky: color(opts.sky || '#e6e9e0'), horizon: color(opts.horizon || '#aab2a3'), ground: color(opts.ground || '#465046'), intensity: opts.envIntensity ?? .9, rot: 0 },
      exposure: opts.exposure ?? 1, fog: opts.fog || [0, 0], shadowTint: color(opts.shadowTint || '#16231b'),
      contacts: [], // up to 8 soft contact-shadow blobs on the shadow catcher: [x, z, radius, strength]
      dpr: 1, width: 1, height: 1, visible: true, ok: true, frames: 0, dprScale: 1, adaptive: opts.adaptive !== false,
      maxDpr: opts.maxDpr || (coarse || small ? 1.5 : 2)
    };
    let progs, shadowSize = opts.shadow === 0 ? 0 : (opts.shadow || (coarse || small ? 1024 : 2048));
    let shadowFb = null, shadowTex = null, whiteTex = null, pickFb = null, pickW = 0, pickH = 0;
    let gpu = new WeakMap(), texs = new WeakMap();
    const view_ = M4.create(), proj = M4.create(), lightVP = M4.create(), lv = M4.create(), lp = M4.create(), nm = new Float32Array(9);

    function initGL() {
      progs = { main: compile(gl, VS, FS), depth: compile(gl, DEPTH_VS, DEPTH_FS), pick: compile(gl, PICK_VS, PICK_FS) };
      gpu = new WeakMap(); texs = new WeakMap(); shadowFb = null; pickFb = null;
      // unit 0 always holds a colour texture (1x1 white when a material has no map) and unit 1 the depth
      // texture (1x1 when shadows are off): a colour sampler must never read the compare-mode depth texture
      whiteTex = gl.createTexture(); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, whiteTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.activeTexture(gl.TEXTURE1);
      shadowTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, shadowTex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, shadowSize || 1, shadowSize || 1);
      {
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
      }
      if (shadowSize) {
        shadowFb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFb);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, shadowTex, 0);
        gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      }
      gl.activeTexture(gl.TEXTURE0);
    }
    try { initGL(); } catch (e) { console.warn('[gl3d]', e); return null; }

    function vao(g) {
      let e = gpu.get(g);
      if (e && e.version === g.version) return e;
      if (e) { gl.deleteVertexArray(e.vao); e.bufs.forEach(b => gl.deleteBuffer(b)); }
      const va = gl.createVertexArray(); gl.bindVertexArray(va);
      const bufs = [];
      const attr = (data, loc, size) => { const b = gl.createBuffer(); bufs.push(b); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0); };
      attr(g.positions instanceof Float32Array ? g.positions : new Float32Array(g.positions), 0, 3);
      attr(g.normals instanceof Float32Array ? g.normals : new Float32Array(g.normals), 1, 3);
      attr(g.uvs instanceof Float32Array ? g.uvs : new Float32Array(g.uvs), 2, 2);
      const ib = gl.createBuffer(); bufs.push(ib); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
      const idx = g.indices instanceof Uint16Array || g.indices instanceof Uint32Array ? g.indices : (g.positions.length / 3 > 65535 ? new Uint32Array(g.indices) : new Uint16Array(g.indices));
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
      gl.bindVertexArray(null);
      e = { vao: va, bufs, count: idx.length, type: idx instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, version: g.version };
      gpu.set(g, e); return e;
    }
    // Textures: v.texture(canvasOrImage, {srgb:true}) → handle; set handle.needsUpdate = true to re-upload.
    v.texture = (source, o = {}) => ({ source, srgb: o.srgb !== false, needsUpdate: true, repeat: !!o.repeat, mips: o.mips !== false && !o.dynamic });
    function bindTex(h, unit) {
      let t = texs.get(h);
      if (!t) { t = gl.createTexture(); texs.set(h, t); h.needsUpdate = true; }
      gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
      if (h.needsUpdate && h.source && (h.source.width || h.source.videoWidth)) {
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, h.srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, h.source);
        const wrap = h.repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        if (h.mips) { gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); }
        else gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        h.needsUpdate = false;
      }
    }

    function resize() {
      const r = canvas.getBoundingClientRect();
      v.dpr = Math.max(.75, Math.min(window.devicePixelRatio || 1, v.maxDpr) * v.dprScale);
      const w = Math.max(1, Math.round(r.width * v.dpr)), h = Math.max(1, Math.round(r.height * v.dpr));
      v.width = r.width; v.height = r.height;
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; v.invalidate(); }
    }
    v.resize = resize;

    // collect drawables with world matrices
    let draws = [];
    function collect(n, parentWorld, pickId) {
      if (!n.visible) return;
      M4.fromTRS(n.local, n.pos, n.rot, n.scale);
      if (parentWorld) M4.mul(n.world, parentWorld, n.local); else n.world.set(n.local);
      const pid = n.pick ? n.id : pickId;
      if (n.geo && n.mat) draws.push({ n, pid });
      for (const c of n.children) collect(c, n.world, pid);
    }
    function camMatrices() {
      const c = v.camera, aspect = v.width / Math.max(1, v.height);
      M4.perspective(proj, c.fov * Math.PI / 180, aspect, c.near, c.far);
      if (c.shift) { proj[8] = -c.shift[0]; proj[9] = -c.shift[1]; } // lens shift in NDC: frame the subject off-centre without changing perspective
      M4.lookAt(view_, c.pos, c.target, c.up);
    }
    function drawGeo(prog, d) {
      const e = vao(d.n.geo);
      gl.uniformMatrix4fv(prog.u.uModel, false, d.n.world);
      gl.bindVertexArray(e.vao); gl.drawElements(gl.TRIANGLES, e.count, e.type, 0);
    }

    v.render = function () {
      if (gl.isContextLost()) return;
      resize();
      draws = []; collect(v.scene, null, 0);
      camMatrices();
      const L = v.light;
      // shadow pass
      if (shadowSize) {
        const tgt = L.target, b = L.bounds;
        const eye = V3.sub(tgt, V3.scale(L.dir, b * 2.5));
        M4.lookAt(lv, eye, tgt, Math.abs(L.dir[1]) > .98 ? [0, 0, 1] : [0, 1, 0]);
        M4.ortho(lp, -b, b, -b, b, .1, b * 6);
        M4.mul(lightVP, lp, lv);
        gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFb); gl.viewport(0, 0, shadowSize, shadowSize);
        gl.clear(gl.DEPTH_BUFFER_BIT); gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.disable(gl.BLEND);
        gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK); gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1.5, 3);
        gl.useProgram(progs.depth.p); gl.uniformMatrix4fv(progs.depth.u.uLightVP, false, lightVP);
        for (const d of draws) { const m = d.n.mat; if (!d.n.castShadow || m.shadowCatcher || m.unlit || m.opacity < .5) continue; if (m.doubleSided) gl.disable(gl.CULL_FACE); else gl.enable(gl.CULL_FACE); drawGeo(progs.depth, d); }
        gl.disable(gl.POLYGON_OFFSET_FILL);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      }
      // main pass
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
      const P = progs.main, u = P.u; gl.useProgram(P.p);
      gl.uniformMatrix4fv(u.uView, false, view_); gl.uniformMatrix4fv(u.uProj, false, proj); gl.uniformMatrix4fv(u.uLightVP, false, lightVP);
      gl.uniform3fv(u.uCam, v.camera.pos); gl.uniform3fv(u.uLightDir, L.dir); gl.uniform3fv(u.uLightCol, L.color); gl.uniform1f(u.uLightInt, L.intensity);
      gl.uniform3fv(u.uSky, v.env.sky); gl.uniform3fv(u.uHorizon, v.env.horizon); gl.uniform3fv(u.uGround, v.env.ground); gl.uniform1f(u.uEnvRot, v.env.rot || 0);
      gl.uniform1f(u.uExposure, v.exposure); gl.uniform2fv(u.uFog, v.fog); gl.uniform3fv(u.uShadowTint, v.shadowTint);
      gl.uniform1i(u.uHasShadow, shadowSize ? 1 : 0); gl.uniform1f(u.uTexel, shadowSize ? 1 / shadowSize : 0); gl.uniform1f(u.uSoft, L.soft);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, shadowTex); gl.uniform1i(u.uShadow, 1);
      gl.uniform1i(u.uMap, 0);
      const cn = Math.min(8, v.contacts.length); gl.uniform1i(u.uContactN, cn);
      if (cn) { const ca = new Float32Array(32); v.contacts.slice(0, 8).forEach((c, i) => ca.set(c, i * 4)); gl.uniform4fv(u.uContacts, ca); }
      const cam = v.camera.pos;
      const opaque = draws.filter(d => !d.n.mat.transparent), trans = draws.filter(d => d.n.mat.transparent);
      trans.forEach(d => { const w = d.n.world; d.z = (w[12] - cam[0]) ** 2 + (w[13] - cam[1]) ** 2 + (w[14] - cam[2]) ** 2; });
      trans.sort((a, b) => (a.n.mat.shadowCatcher ? -1 : 0) - (b.n.mat.shadowCatcher ? -1 : 0) || b.z - a.z);
      const drawMain = d => {
        const m = d.n.mat;
        M4.normal3(nm, d.n.world); gl.uniformMatrix3fv(u.uNormalM, false, nm);
        gl.uniform3fv(u.uBase, m.color);
        gl.uniform3f(u.uEmissive, m.emissive[0] * m.emissiveIntensity, m.emissive[1] * m.emissiveIntensity, m.emissive[2] * m.emissiveIntensity);
        gl.uniform1f(u.uMetal, m.metalness); gl.uniform1f(u.uRough, m.roughness); gl.uniform1f(u.uOpacity, m.opacity);
        gl.uniform1f(u.uClearcoat, m.clearcoat); gl.uniform1f(u.uCcRough, m.clearcoatRoughness); gl.uniform1f(u.uEnvInt, v.env.intensity * m.envIntensity); gl.uniform1f(u.uSheen, m.sheen);
        gl.uniform1i(u.uMode, m.shadowCatcher ? 2 : m.unlit ? 1 : 0);
        if (m.shadowCatcher) { gl.uniform3fv(u.uCatchC, d.n.worldPos()); gl.uniform1f(u.uCatchR, m.catchRadius); }
        if (m.map) { bindTex(m.map, 0); gl.uniform1i(u.uHasMap, 1); } else { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, whiteTex); gl.uniform1i(u.uHasMap, 0); }
        if (m.doubleSided) gl.disable(gl.CULL_FACE); else { gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK); }
        gl.depthMask(m.depthWrite);
        drawGeo(P, d);
      };
      gl.disable(gl.BLEND); opaque.forEach(drawMain);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); trans.forEach(drawMain);
      gl.depthMask(true); gl.bindVertexArray(null);
      v.frames++;
      if (v.onRender) v.onRender(); // world matrices are current here (DOM labels, etc.)
    };

    // Picking: returns the nearest node with a truthy .pick (or null) under a client point.
    v.pick = function (clientX, clientY) {
      if (gl.isContextLost()) return null;
      const r = canvas.getBoundingClientRect();
      const x = Math.floor((clientX - r.left) * canvas.width / r.width), y = Math.floor((r.bottom - clientY) * canvas.height / r.height);
      if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return null;
      if (!pickFb || pickW !== canvas.width || pickH !== canvas.height) {
        pickW = canvas.width; pickH = canvas.height;
        pickFb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, pickFb);
        const ct = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, ct); gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA8, pickW, pickH);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, ct);
        const db = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, db); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, pickW, pickH);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, db);
      }
      draws = []; collect(v.scene, null, 0); camMatrices();
      gl.bindFramebuffer(gl.FRAMEBUFFER, pickFb); gl.viewport(0, 0, pickW, pickH);
      gl.enable(gl.SCISSOR_TEST); gl.scissor(x, y, 1, 1);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.depthMask(true);
      const P = progs.pick; gl.useProgram(P.p);
      gl.uniformMatrix4fv(P.u.uView, false, view_); gl.uniformMatrix4fv(P.u.uProj, false, proj);
      const byId = new Map();
      for (const d of draws) {
        const m = d.n.mat; if (m.shadowCatcher || m.opacity < .2) continue;
        if (m.transparent && !d.pid) continue; // glass that isn't a part must not hide the parts behind it
        const id = d.pid; let n = d.n; while (n && n.id !== id) n = n.parent; if (id) byId.set(id, n);
        gl.uniform3f(P.u.uId, (id & 255) / 255, ((id >> 8) & 255) / 255, ((id >> 16) & 255) / 255);
        if (m.doubleSided) gl.disable(gl.CULL_FACE); else gl.enable(gl.CULL_FACE);
        drawGeo(P, d);
      }
      const px = new Uint8Array(4); gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      gl.disable(gl.SCISSOR_TEST); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.bindVertexArray(null);
      const id = px[0] + (px[1] << 8) + (px[2] << 16);
      return id ? byId.get(id) || null : null;
    };

    // World point → CSS pixels relative to the canvas; {x, y, behind}
    v.project = function (p) {
      camMatrices();
      const vp = M4.mul(M4.create(), proj, view_);
      const x = vp[0] * p[0] + vp[4] * p[1] + vp[8] * p[2] + vp[12], y = vp[1] * p[0] + vp[5] * p[1] + vp[9] * p[2] + vp[13], w = vp[3] * p[0] + vp[7] * p[1] + vp[11] * p[2] + vp[15];
      return { x: (x / w * .5 + .5) * v.width, y: (1 - (y / w * .5 + .5)) * v.height, behind: w <= 0 };
    };

    /* ---- loop: runs only while visible and the tab is shown ---- */
    let raf = 0, last = 0, t0 = performance.now(), frameFn = null, dirty = true, ema = 16.7, slow = 0, fast = 0;
    function tick(now) {
      raf = 0;
      if (!v.visible || document.hidden || gl.isContextLost()) return;
      const raw = now - last, dt = Math.min(.05, raw / 1000 || 0); last = now;
      // adaptive resolution: step down when frames run slow, creep back up when there is headroom
      if (v.adaptive && raw > 0 && raw < 100) {
        ema = ema * .9 + raw * .1;
        if (ema > 21) { fast = 0; if (++slow > 45 && v.dprScale > .6) { v.dprScale = Math.max(.6, v.dprScale - .15); slow = 0; resize(); } }
        else if (ema < 17.8) { slow = 0; if (++fast > 240 && v.dprScale < 1) { v.dprScale = Math.min(1, v.dprScale + .1); fast = 0; resize(); } }
        else { slow = Math.max(0, slow - 1); }
      }
      let keep = false;
      if (frameFn) keep = frameFn(dt, (now - t0) / 1000) !== false;
      if (keep || dirty) { dirty = false; v.render(); }
      if (keep) raf = requestAnimationFrame(tick);
    }
    v.invalidate = () => { dirty = true; v.wake(); };
    v.wake = () => { if (!raf && v.visible && !document.hidden) { last = performance.now(); raf = requestAnimationFrame(tick); } };
    v.frame = fn => { frameFn = fn; v.wake(); return () => { frameFn = null; }; };
    const io = new IntersectionObserver(es => { v.visible = es[es.length - 1].isIntersecting; if (v.visible) v.wake(); }, { rootMargin: opts.rootMargin || '120px' });
    io.observe(canvas);
    const ro = new ResizeObserver(() => { resize(); v.invalidate(); });
    ro.observe(canvas);
    const onVis = () => { if (!document.hidden) v.wake(); };
    document.addEventListener('visibilitychange', onVis);
    canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); v.ok = false; });
    canvas.addEventListener('webglcontextrestored', () => { try { initGL(); v.ok = true; v.invalidate(); } catch (e) { console.warn('[gl3d] restore failed', e); } });
    v.dispose = () => { io.disconnect(); ro.disconnect(); document.removeEventListener('visibilitychange', onVis); frameFn = null; if (raf) cancelAnimationFrame(raf); const ext = gl.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext(); };
    resize();
    return v;
  }

  /* --------------------------------------------------------- page helpers */
  // Progress 0..1 of a tall section with a sticky child (how far it has been scrolled through).
  function scrollProgress(section) {
    const r = section.getBoundingClientRect(), span = r.height - innerHeight;
    return span > 0 ? clamp(-r.top / span, 0, 1) : (r.top < 0 ? 1 : 0);
  }
  // Pointer drag helper: calls onMove(dx, dy, e) while dragging; returns a dispose function.
  function drag(el, onMove, onEnd) {
    let id = null, px = 0, py = 0;
    const down = e => { if (e.button !== 0) return; id = e.pointerId; px = e.clientX; py = e.clientY; el.setPointerCapture(id); el.classList.add('is-dragging'); };
    const move = e => { if (e.pointerId !== id) return; const dx = e.clientX - px, dy = e.clientY - py; px = e.clientX; py = e.clientY; onMove(dx, dy, e); };
    const up = e => { if (e.pointerId !== id) return; id = null; el.classList.remove('is-dragging'); if (onEnd) onEnd(e); };
    el.addEventListener('pointerdown', down); el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    return () => { el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); };
  }
  // A canvas-backed texture you can draw on every frame (screens, readouts).
  function canvasTexture(v, w, h, draw) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d'), tex = v.texture(c, { dynamic: true, mips: false });
    const api = { canvas: c, ctx, tex, redraw(...a) { draw(ctx, w, h, ...a); tex.needsUpdate = true; } };
    if (draw) api.redraw();
    return api;
  }

  window.GL3D = {
    supported, view, node, material, color, M4, V3, clamp, smooth, damp, scrollProgress, drag, canvasTexture,
    box, cylinder, disc, sphere, torus, tube, plane, lathe, extrude, roundedRect, triangulate, merge, updateGeo,
    reducedMotion: () => matchMedia('(prefers-reduced-motion: reduce)').matches
  };
})();
