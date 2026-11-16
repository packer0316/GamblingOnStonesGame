// Turns one sawn piece of a stone into a triangle mesh.
//
// Surface nets give the topology; every vertex is then pulled onto the true
// surface. Where a saw plane meets the skin the vertices are snapped onto the
// crease itself and the cut face gets its own copies of them, so a cut reads
// as a dead-flat face with a crisp edge instead of a rounded-off blob.
//
// Each vertex carries `depth`, its distance below the original skin. The
// shader uses it to tell skin from rind, fog and flesh.

import { BOX, KERF } from './gen.js';

const EDGES = [
  [0, 1], [2, 3], [4, 5], [6, 7],
  [0, 2], [1, 3], [4, 6], [5, 7],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

export function meshPiece(field, piece, windows, h = 0.018) {
  const sdf = field.pieceSd(piece, windows);
  const skin = field.pieceSd({ planes: [] }, windows); // carved skin, no saw planes
  const planes = piece.planes;
  const min = -BOX + h * 0.37, block = 4; // off-grid so flat cuts never land on a sample
  const n = Math.ceil((2 * BOX) / h) + 1;
  const sx = n, sxy = n * n;
  const val = new Float32Array(n * n * n);

  // Coarse pass: whole blocks far from the surface are filled without sampling.
  const bh = h * block;
  const reach = bh * 0.87 * 1.7 + h;
  for (let bk = 0; bk < n; bk += block) {
    for (let bj = 0; bj < n; bj += block) {
      for (let bi = 0; bi < n; bi += block) {
        const dc = sdf(min + (bi + block * 0.5) * h, min + (bj + block * 0.5) * h, min + (bk + block * 0.5) * h);
        const far = Math.abs(dc) > reach;
        const ke = Math.min(bk + block, n), je = Math.min(bj + block, n), ie = Math.min(bi + block, n);
        for (let k = bk; k < ke; k++) {
          for (let j = bj; j < je; j++) {
            let idx = bi + j * sx + k * sxy;
            for (let i = bi; i < ie; i++, idx++) val[idx] = far ? dc : sdf(min + i * h, min + j * h, min + k * h);
          }
        }
      }
    }
  }

  // One vertex per cell the surface crosses.
  const cellVert = new Int32Array(n * n * n).fill(-1);
  const pos = [];
  const corner = new Float32Array(8);
  for (let k = 0; k < n - 1; k++) {
    for (let j = 0; j < n - 1; j++) {
      for (let i = 0; i < n - 1; i++) {
        const base = i + j * sx + k * sxy;
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const v = val[base + (c & 1) + ((c >> 1) & 1) * sx + ((c >> 2) & 1) * sxy];
          corner[c] = v;
          if (v < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        let px = 0, py = 0, pz = 0, m = 0;
        for (let e = 0; e < 12; e++) {
          const a = EDGES[e][0], b = EDGES[e][1];
          const va = corner[a], vb = corner[b];
          if (va < 0 === vb < 0) continue;
          const t = va / (va - vb);
          px += (a & 1) + t * ((b & 1) - (a & 1));
          py += ((a >> 1) & 1) + t * (((b >> 1) & 1) - ((a >> 1) & 1));
          pz += ((a >> 2) & 1) + t * (((b >> 2) & 1) - ((a >> 2) & 1));
          m++;
        }
        cellVert[base] = pos.length / 3;
        pos.push(min + (i + px / m) * h, min + (j + py / m) * h, min + (k + pz / m) * h);
      }
    }
  }

  // Snap vertices onto the surface (or the crease between two surfaces).
  const count = pos.length / 3;
  const P = new Float32Array(pos);
  const N = new Float32Array(count * 3); // skin normal
  const onPlane = new Int32Array(count); // bit i set: the vertex lies on saw plane i
  const e = h * 0.3;
  const g = [0, 0, 0];
  const grad = (x, y, z) => {
    g[0] = skin(x + e, y, z) - skin(x - e, y, z);
    g[1] = skin(x, y + e, z) - skin(x, y - e, z);
    g[2] = skin(x, y, z + e) - skin(x, y, z - e);
    const l = Math.hypot(g[0], g[1], g[2]) || 1;
    g[0] /= l; g[1] /= l; g[2] /= l;
  };
  const planeVal = (p, x, y, z) => p.s * (x * p.n[0] + y * p.n[1] + z * p.n[2] - p.d) + KERF * 0.5;
  const near = h * 0.9;
  for (let v = 0; v < count; v++) {
    let x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    let bits = 0;
    const s0 = skin(x, y, z);
    let top = s0;
    for (let i = 0; i < planes.length; i++) top = Math.max(top, planeVal(planes[i], x, y, z));
    for (let i = 0; i < planes.length && i < 30; i++) if (planeVal(planes[i], x, y, z) > top - near) bits |= 1 << i;
    const onSkin = s0 > top - near;
    const rounds = bits && onSkin ? 5 : bits ? 2 : 3;
    for (let it = 0; it < rounds; it++) {
      if (onSkin) {
        const d = skin(x, y, z);
        if (Math.abs(d) > h * 0.002) {
          grad(x, y, z);
          const step = Math.max(-h, Math.min(h, d)) * 0.9;
          x -= g[0] * step; y -= g[1] * step; z -= g[2] * step;
        }
      }
      for (let i = 0; i < planes.length && i < 30; i++) {
        if (!(bits & (1 << i))) continue;
        const p = planes[i], d = planeVal(p, x, y, z);
        x -= p.s * p.n[0] * d; y -= p.s * p.n[1] * d; z -= p.s * p.n[2] * d;
      }
    }
    grad(x, y, z);
    P[v * 3] = x; P[v * 3 + 1] = y; P[v * 3 + 2] = z;
    N[v * 3] = g[0]; N[v * 3 + 1] = g[1]; N[v * 3 + 2] = g[2];
    onPlane[v] = bits;
  }

  // Emit triangles. Cut faces get their own vertices, with the plane's normal.
  const outPos = [], outNrm = [], outDepth = [], outCap = [], outNrm0 = [], index = [];
  // Normal of the skin as it was before any window was ground: where a window
  // has sunk the surface, the shader lifts the vertex back out along this
  // until the grinder actually reaches it.
  const e0 = h * 0.3;
  const skinNormal0 = (x, y, z, out) => {
    let gx = field.sd(x + e0, y, z) - field.sd(x - e0, y, z), gy = field.sd(x, y + e0, z) - field.sd(x, y - e0, z), gz = field.sd(x, y, z + e0) - field.sd(x, y, z - e0);
    const l = Math.hypot(gx, gy, gz) || 1;
    out.push(gx / l, gy / l, gz / l);
  };
  const skinId = new Int32Array(count).fill(-1);
  const capId = new Map();
  const emit = (v, plane) => {
    if (plane < 0) {
      if (skinId[v] >= 0) return skinId[v];
    } else {
      const key = v * 32 + plane;
      const got = capId.get(key);
      if (got !== undefined) return got;
      capId.set(key, outDepth.length);
    }
    const id = outDepth.length;
    const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    outPos.push(x, y, z);
    if (plane < 0) { outNrm.push(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]); skinId[v] = id; }
    else { const p = planes[plane]; outNrm.push(p.s * p.n[0], p.s * p.n[1], p.s * p.n[2]); }
    const depth = -field.sd(x, y, z);
    outDepth.push(depth);
    outCap.push(plane < 0 ? 0 : 1);
    // only a vertex sunk by a window needs the old normal; everywhere else it is the normal it has
    if (plane < 0 && depth > 0.0008) skinNormal0(x, y, z, outNrm0);
    else outNrm0.push(outNrm[id * 3], outNrm[id * 3 + 1], outNrm[id * 3 + 2]);
    return id;
  };
  const tri = (a, b, c) => {
    if (a === b || b === c || a === c) return;
    const common = onPlane[a] & onPlane[b] & onPlane[c];
    const plane = common ? 31 - Math.clz32(common & -common) : -1;
    const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
    const ux = P[b * 3] - ax, uy = P[b * 3 + 1] - ay, uz = P[b * 3 + 2] - az;
    const vx = P[c * 3] - ax, vy = P[c * 3 + 1] - ay, vz = P[c * 3 + 2] - az;
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    if (fx * fx + fy * fy + fz * fz < 1e-16) return;
    let facing;
    if (plane >= 0) { const p = planes[plane]; facing = p.s * (fx * p.n[0] + fy * p.n[1] + fz * p.n[2]); }
    else {
      facing = fx * (N[a * 3] + N[b * 3] + N[c * 3]) + fy * (N[a * 3 + 1] + N[b * 3 + 1] + N[c * 3 + 1]) + fz * (N[a * 3 + 2] + N[b * 3 + 2] + N[c * 3 + 2]);
    }
    const i0 = emit(a, plane), i1 = emit(b, plane), i2 = emit(c, plane);
    if (facing < 0) index.push(i0, i2, i1); else index.push(i0, i1, i2);
  };
  const quad = (a, b, c, d) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    const ac = dist2(P, a, c), bd = dist2(P, b, d);
    if (ac <= bd) { tri(a, b, c); tri(a, c, d); } else { tri(a, b, d); tri(b, c, d); }
  };
  for (let k = 1; k < n - 1; k++) {
    for (let j = 1; j < n - 1; j++) {
      for (let i = 1; i < n - 1; i++) {
        const base = i + j * sx + k * sxy;
        const s = val[base] < 0;
        if (s !== val[base + 1] < 0) quad(cellVert[base - sx - sxy], cellVert[base - sxy], cellVert[base], cellVert[base - sx]);
        if (s !== val[base + sx] < 0) quad(cellVert[base - 1 - sxy], cellVert[base - sxy], cellVert[base], cellVert[base - 1]);
        if (s !== val[base + sxy] < 0) quad(cellVert[base - 1 - sx], cellVert[base - sx], cellVert[base], cellVert[base - 1]);
      }
    }
  }

  const positions = new Float32Array(outPos);
  const indices = new Uint32Array(index);
  // Volume and centre of mass by the divergence theorem; bounds for placing it.
  let vol = 0, cx = 0, cy = 0, cz = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3;
    const x0 = positions[a], y0 = positions[a + 1], z0 = positions[a + 2];
    const x1 = positions[b], y1 = positions[b + 1], z1 = positions[b + 2];
    const x2 = positions[c], y2 = positions[c + 1], z2 = positions[c + 2];
    const v = (x0 * (y1 * z2 - z1 * y2) - y0 * (x1 * z2 - z1 * x2) + z0 * (x1 * y2 - y1 * x2)) / 6;
    vol += v;
    cx += v * (x0 + x1 + x2) / 4; cy += v * (y0 + y1 + y2) / 4; cz += v * (z0 + z1 + z2) / 4;
  }
  const lo = [9, 9, 9], hi = [-9, -9, -9];
  for (let i = 0; i < positions.length; i += 3) {
    for (let a = 0; a < 3; a++) { const v = positions[i + a]; if (v < lo[a]) lo[a] = v; if (v > hi[a]) hi[a] = v; }
  }
  const center = Math.abs(vol) > 1e-9 ? [cx / vol, cy / vol, cz / vol] : [0, 0, 0];
  vol = Math.abs(vol);
  return {
    positions,
    normals: new Float32Array(outNrm),
    normals0: new Float32Array(outNrm0),
    depth: new Float32Array(outDepth),
    cap: new Float32Array(outCap),
    indices,
    volume: vol,
    center,
    bounds: { min: lo, max: hi },
  };
}

function dist2(P, a, b) {
  const dx = P[a * 3] - P[b * 3], dy = P[a * 3 + 1] - P[b * 3 + 1], dz = P[a * 3 + 2] - P[b * 3 + 2];
  return dx * dx + dy * dy + dz * dz;
}
