// A small tiling 3D noise texture. The stone shader samples it at several
// scales for everything too fine to bake per stone: sand grains, stains,
// crystal texture, cotton specks, the ragged edge of a colour vein.
//
//   r  low fbm (4 + 8 + 16 periods per tile)
//   g  mid fbm (8 + 16 + 32)
//   b  cell borders (Worley F2 - F1, 8 cells per tile): 0 on a border, 1 inside
//   a  fine fbm (16 + 32)
import * as THREE from 'three';

function hash(i, j, k, s) {
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(k, 1274126177) ^ Math.imul(s, 362437);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

/** Periodic gradient noise, about -1..1. */
function pnoise(x, y, z, period, seed) {
  const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
  const fx = x - X, fy = y - Y, fz = z - Z;
  const u = fade(fx), v = fade(fy), w = fade(fz);
  let sum = 0;
  for (let c = 0; c < 8; c++) {
    const dx = c & 1, dy = (c >> 1) & 1, dz = (c >> 2) & 1;
    const i = (((X + dx) % period) + period) % period, j = (((Y + dy) % period) + period) % period, k = (((Z + dz) % period) + period) % period;
    // gradient from two hashed angles
    const a = hash(i, j, k, seed) * 6.2831853, b = hash(i, j, k, seed + 71) * 2 - 1;
    const r = Math.sqrt(1 - b * b);
    const g = r * Math.cos(a) * (fx - dx) + r * Math.sin(a) * (fy - dy) + b * (fz - dz);
    sum += g * (dx ? u : 1 - u) * (dy ? v : 1 - v) * (dz ? w : 1 - w);
  }
  return sum * 1.5;
}

/** Periodic Worley: distances to the nearest and second nearest feature point. */
function worley(x, y, z, period, seed, out) {
  const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
  let f1 = 9, f2 = 9;
  for (let dk = -1; dk <= 1; dk++) for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
    const ci = X + di, cj = Y + dj, ck = Z + dk;
    const i = ((ci % period) + period) % period, j = ((cj % period) + period) % period, k = ((ck % period) + period) % period;
    const px = ci + hash(i, j, k, seed), py = cj + hash(i, j, k, seed + 13), pz = ck + hash(i, j, k, seed + 29);
    const d = Math.hypot(px - x, py - y, pz - z);
    if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
  }
  out[0] = f1; out[1] = f2;
}

export function createTileNoise(size = 64) {
  const data = new Uint8Array(size * size * size * 4);
  const w = [0, 0];
  const byte = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));
  for (let k = 0; k < size; k++) {
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const x = i / size, y = j / size, z = k / size;
        const o = (i + j * size + k * size * size) * 4;
        const lo = pnoise(x * 4, y * 4, z * 4, 4, 1) + 0.5 * pnoise(x * 8, y * 8, z * 8, 8, 2) + 0.25 * pnoise(x * 16, y * 16, z * 16, 16, 3);
        const mid = pnoise(x * 8, y * 8, z * 8, 8, 4) + 0.5 * pnoise(x * 16, y * 16, z * 16, 16, 5) + 0.25 * pnoise(x * 32, y * 32, z * 32, 32, 6);
        const fine = pnoise(x * 16, y * 16, z * 16, 16, 7) + 0.6 * pnoise(x * 32, y * 32, z * 32, 32, 8);
        worley(x * 8, y * 8, z * 8, 8, 9, w);
        data[o] = byte(0.5 + lo * 0.42);
        data[o + 1] = byte(0.5 + mid * 0.42);
        data[o + 2] = byte((w[1] - w[0]) * 2.2);
        data[o + 3] = byte(0.5 + fine * 0.45);
      }
    }
  }
  const tex = new THREE.Data3DTexture(data, size, size, size);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}
