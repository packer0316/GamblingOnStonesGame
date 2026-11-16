// Bakes a stone's interior into voxels.
//
// Two RGBA volumes feed the shader (so what is drawn is exactly what was
// generated), and a coarse grid of "cells" about a centimetre across feeds the
// appraisal (so what is paid for is exactly what is drawn).
//
//   texA  r green   g 種水    b cotton   a distance to the skin
//   texB  r purple  g yellow  b black    a shattered zone

import { BOX } from './gen.js';
import { clamp } from './noise.js';

export const VOL_N = 112;
export const CELL = 4; // voxels along one cell edge
export const SD_LO = -0.2, SD_HI = 0.05; // range of the distance channel

export function bakeVolume(field, n = VOL_N) {
  const def = field.def;
  const texA = new Uint8Array(n * n * n * 4);
  const texB = new Uint8Array(n * n * n * 4);
  const step = (2 * BOX) / n;
  const M = n / CELL;
  const fleshAt = def.skinT + def.fogT;
  const acc = new Float32Array(M * M * M * 9); // sums of z g pur yel blk cot sh depth, count
  const o = {};
  const nCrack = def.cracks.length;
  const reach = new Uint8Array(nCrack); // does the crack break the skin?
  let solid = 0;
  const lo = [9, 9, 9], hi = [-9, -9, -9];

  for (let k = 0; k < n; k++) {
    const z = -BOX + (k + 0.5) * step;
    for (let j = 0; j < n; j++) {
      const y = -BOX + (j + 0.5) * step;
      for (let i = 0; i < n; i++) {
        const x = -BOX + (i + 0.5) * step;
        const idx = (i + j * n + k * n * n) * 4;
        // far corners of the box are certainly empty
        if (x * x + y * y + z * z > 1.9) { texA[idx + 3] = 255; continue; }
        const d = field.sd(x, y, z);
        texA[idx + 3] = Math.round(clamp((d - SD_LO) / (SD_HI - SD_LO)) * 255);
        if (d > 0.035) continue;
        field.sample(x, y, z, -d, o);
        texA[idx] = Math.round(o.g * 255);
        texA[idx + 1] = Math.round(o.z * 255);
        texA[idx + 2] = Math.round(o.cot * 255);
        texB[idx] = Math.round(o.pur * 255);
        texB[idx + 1] = Math.round(o.yel * 255);
        texB[idx + 2] = Math.round(o.blk * 255);
        texB[idx + 3] = Math.round(o.sh * 255);
        if (d >= 0) continue;
        solid++;
        if (x < lo[0]) lo[0] = x; if (x > hi[0]) hi[0] = x;
        if (y < lo[1]) lo[1] = y; if (y > hi[1]) hi[1] = y;
        if (z < lo[2]) lo[2] = z; if (z > hi[2]) hi[2] = z;
        if (d > -step * 1.2) {
          for (let c = 0; c < nCrack; c++) if (!reach[c] && field.crackDist(c, x, y, z) < step * 0.8) reach[c] = 1;
        }
        if (-d < fleshAt) continue;
        const ci = ((i / CELL) | 0) + ((j / CELL) | 0) * M + ((k / CELL) | 0) * M * M;
        const a = ci * 9;
        acc[a] += o.z; acc[a + 1] += o.g; acc[a + 2] += o.pur; acc[a + 3] += o.yel;
        acc[a + 4] += o.blk; acc[a + 5] += o.cot; acc[a + 6] += o.sh; acc[a + 7] += -d - fleshAt; acc[a + 8]++;
      }
    }
  }

  // Compact the cells that hold any flesh.
  let count = 0;
  for (let c = 0; c < M * M * M; c++) if (acc[c * 9 + 8] > 0) count++;
  const cells = {
    n: count, M, size: step * CELL,
    index: new Int32Array(M * M * M).fill(-1), // grid slot -> cell
    pos: new Float32Array(count * 3),
    frac: new Float32Array(count), // how much of the cell is flesh
    z: new Float32Array(count), g: new Float32Array(count), pur: new Float32Array(count), yel: new Float32Array(count),
    blk: new Float32Array(count), cot: new Float32Array(count), sh: new Float32Array(count), depth: new Float32Array(count),
    crack: new Float32Array(count * nCrack), // distance to every crack
  };
  let q = 0;
  const cs = step * CELL;
  for (let c = 0; c < M * M * M; c++) {
    const w = acc[c * 9 + 8];
    if (w <= 0) continue;
    const a = c * 9;
    const ci = c % M, cj = ((c / M) | 0) % M, ck = (c / (M * M)) | 0;
    const x = -BOX + (ci + 0.5) * cs, y = -BOX + (cj + 0.5) * cs, z = -BOX + (ck + 0.5) * cs;
    cells.index[c] = q;
    cells.pos[q * 3] = x; cells.pos[q * 3 + 1] = y; cells.pos[q * 3 + 2] = z;
    cells.frac[q] = w / (CELL * CELL * CELL);
    cells.z[q] = acc[a] / w; cells.g[q] = acc[a + 1] / w; cells.pur[q] = acc[a + 2] / w; cells.yel[q] = acc[a + 3] / w;
    cells.blk[q] = acc[a + 4] / w; cells.cot[q] = acc[a + 5] / w; cells.sh[q] = acc[a + 6] / w; cells.depth[q] = acc[a + 7] / w;
    for (let k = 0; k < nCrack; k++) cells.crack[q * nCrack + k] = field.crackDist(k, x, y, z);
    q++;
  }

  return {
    n, texA, texB, cells,
    reach: Array.from(reach),
    volume: solid * step * step * step, // cubic units, skin included
    bounds: { min: lo, max: hi },
  };
}
