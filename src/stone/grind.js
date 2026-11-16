// A window while it is being ground.
//
// The mesh of a window is cut to its full depth the moment the job starts
// (mesher.js). What is drawn is that dish filled back in, and let down again
// only where the burr has been. "Where the burr has been" is kept here: a
// small texture laid over the patch of skin being worked, in which the burr
// leaves its track. The stone shader reads it, vertex and fragment alike, so
// the stone opens under the burr and nowhere else.
import * as THREE from 'three';
import { KERF } from './gen.js';

const N = 128;
const TAU = Math.PI * 2;
const SPAN = 1.45; // half-width of the patch the track covers, in window radii
const data = new Uint8Array(N * N);
const texture = new THREE.DataTexture(data, N, N, THREE.RedFormat, THREE.UnsignedByteType);
texture.magFilter = texture.minFilter = THREE.LinearFilter;
texture.needsUpdate = true;

/** The burr's track. Only one job runs at a time, so one texture serves every stone. */
export const GRIND = { texture };

const _p = new THREE.Vector3();

/**
 * The job of grinding window `w` (the entry in stone.windows at `index`) into
 * a piece. Spots on the patch are given as (a, b): stone units from the
 * window's centre, `a` along the oval and `b` across it.
 */
export function createGrind(stone, piece, w, index) {
  const { field, shared } = stone;
  const c = new THREE.Vector3().fromArray(w.c), n = new THREE.Vector3().fromArray(w.n).normalize();
  const v = new THREE.Vector3().fromArray(w.dir); // the way the oval is squeezed
  v.addScaledVector(n, -v.dot(n)).normalize();
  const u = new THREE.Vector3().crossVectors(v, n).normalize();
  const half = w.r * SPAN, perUnit = N / (2 * half);
  const only = [w];

  /** The untouched skin over a spot of the patch. */
  const skinAt = (a, b, out) => {
    let x = c.x + u.x * a + v.x * b, y = c.y + u.y * a + v.y * b, z = c.z + u.z * a + v.z * b;
    for (let i = 0; i < 5; i++) { const d = field.sd(x, y, z); x -= n.x * d; y -= n.y * d; z -= n.z * d; }
    return out.set(x, y, z);
  };
  /** How deep the finished window is under a point of the skin. */
  const cutAt = (p) => field.windowCut(only, p.x, p.y, p.z);
  const sawnOff = (p) => {
    for (const q of piece.planes) if (q.s * (p.x * q.n[0] + p.y * q.n[1] + p.z * q.n[2] - q.d) + KERF * 0.5 > -0.008) return true;
    return false;
  };

  // How far the dish runs in each direction. It is an oval with a wandering
  // edge, so the burr is steered by what the dish actually is, not by a radius.
  const A = 36, reach = new Float32Array(A);
  for (let i = 0; i < A; i++) {
    const ca = Math.cos((i / A) * TAU), sa = Math.sin((i / A) * TAU);
    for (let s = 1; s <= 24; s++) {
      const rho = (s / 24) * w.r * 1.3;
      skinAt(ca * rho, sa * rho, _p);
      if (cutAt(_p) < w.depth * 0.08 || sawnOff(_p)) break;
      reach[i] = rho;
    }
  }
  for (let pass = 0; pass < 2; pass++) {
    const was = reach.slice();
    for (let i = 0; i < A; i++) reach[i] = (was[(i + A - 1) % A] + 2 * was[i] + was[(i + 1) % A]) / 4;
  }
  let reachMin = Infinity, reachMean = 0;
  for (let i = 0; i < A; i++) { reachMin = Math.min(reachMin, reach[i]); reachMean += reach[i] / A; }

  const sample = (a, b) => {
    const x = Math.min(N - 1.001, Math.max(0, (a / (2 * half) + 0.5) * N - 0.5)), y = Math.min(N - 1.001, Math.max(0, (b / (2 * half) + 0.5) * N - 0.5));
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, o = x0 + y0 * N;
    return ((data[o] * (1 - fx) + data[o + 1] * fx) * (1 - fy) + (data[o + N] * (1 - fx) + data[o + N + 1] * fx) * fy) / 255;
  };

  return {
    index, c, n, u, v, reachMin, reachMean,
    /** How far from the centre the dish runs in the direction `angle` (from u toward v). */
    reachAt(angle) {
      const f = ((((angle / TAU) % 1) + 1) % 1) * A, i = Math.floor(f);
      return reach[i % A] + (reach[(i + 1) % A] - reach[i % A]) * (f - i);
    },

    /** Nothing ground yet: the patch is drawn as the skin it still is. */
    begin() {
      data.fill(0);
      texture.needsUpdate = true;
      shared.uGrindC.value.set(c.x, c.y, c.z, w.r * 1.35);
      shared.uGrindU.value.set(u.x, u.y, u.z, 0).multiplyScalar(1 / (2 * half));
      shared.uGrindV.value.set(v.x, v.y, v.z, 0).multiplyScalar(1 / (2 * half));
      shared.uWinLive.value = index;
    },

    /**
     * The burr bears on a spot: full depth within `r0` of it, and the rounded
     * wall of its groove out to `r1`. `press` (0..1) is how far it has sunk in.
     */
    stamp(a, b, r0, r1, press = 1) {
      const cx = (a / (2 * half) + 0.5) * N - 0.5, cy = (b / (2 * half) + 0.5) * N - 0.5;
      const R0 = r0 * perUnit, R1 = r1 * perUnit;
      const x0 = Math.max(0, Math.floor(cx - R1)), x1 = Math.min(N - 1, Math.ceil(cx + R1));
      const y0 = Math.max(0, Math.floor(cy - R1)), y1 = Math.min(N - 1, Math.ceil(cy + R1));
      let changed = false;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const d = Math.hypot(x - cx, y - cy);
          if (d >= R1) continue;
          // (the wall eases out to nothing at its top: a wall that ended in a step would
          // put the skin's edge on the texel grid, and it would show as a staircase)
          const t = d <= R0 ? 0 : (d - R0) / (R1 - R0);
          const m = (1 - t * t) * (1 - t * t) * press * 255;
          const o = x + y * N;
          if (m > data[o]) { data[o] = m; changed = true; }
        }
      }
      if (changed) texture.needsUpdate = true;
    },

    /** Whatever is still standing comes down to at least `k` of the full depth (the last pass over the whole window). */
    settle(k) {
      const m = Math.min(255, k * 255);
      for (let i = 0; i < data.length; i++) if (data[i] < m) data[i] = m;
      texture.needsUpdate = true;
    },

    /** How far down (0..1 of the finished depth) a spot has been taken. */
    sample,

    /** Where the burr bears on the stone over a spot: on the skin, or as far below it as the spot has been ground. */
    contact(a, b, out) {
      skinAt(a, b, out);
      return out.addScaledVector(n, -cutAt(out) * sample(a, b));
    },

    /** How deep under the old skin the floor of the track is at a spot (stone units). */
    depthAt(a, b) { return cutAt(skinAt(a, b, _p)) * sample(a, b); },

    /** The window is finished: the mesh is drawn as it is. */
    end() { shared.uWinLive.value = -1; },
  };
}
