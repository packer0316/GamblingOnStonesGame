// Seeded randomness and gradient noise. Pure math, shared by the browser,
// the stone worker and the Node tools, so a seed always grows the same stone.

/** mulberry32 with a few helpers hung on it. */
export function rng(seed) {
  let a = (seed >>> 0) || 1;
  const f = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  f.range = (lo, hi) => lo + f() * (hi - lo);
  f.int = (lo, hi) => Math.floor(lo + f() * (hi - lo + 1));
  f.chance = (p) => f() < p;
  f.pick = (arr) => arr[Math.floor(f() * arr.length)];
  /** Pick a key of {key: weight}. */
  f.weighted = (table) => {
    let total = 0;
    for (const k in table) total += table[k];
    let x = f() * total;
    for (const k in table) { x -= table[k]; if (x <= 0) return k; }
    return Object.keys(table)[0];
  };
  f.gauss = () => {
    const u = Math.max(f(), 1e-9), v = f();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(6.283185307 * v);
  };
  /** Uniform direction on the sphere. */
  f.dir = () => {
    const z = f() * 2 - 1, a2 = f() * 6.283185307, r = Math.sqrt(1 - z * z);
    return [r * Math.cos(a2), z, r * Math.sin(a2)];
  };
  return f;
}

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const mix = (a, b, t) => a + (b - a) * t;
function grad(h, x, y, z) {
  h &= 15;
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}

/** Classic improved Perlin noise over a seeded permutation; returns about -1..1. */
export function makeNoise(seed) {
  const r = rng(seed ^ 0x9e3779b9);
  const perm = new Uint8Array(256);
  for (let i = 0; i < 256; i++) perm[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    const t = perm[i]; perm[i] = perm[j]; perm[j] = t;
  }
  const p = new Uint8Array(512);
  for (let i = 0; i < 512; i++) p[i] = perm[i & 255];

  function n3(x, y, z) {
    let X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
    x -= X; y -= Y; z -= Z;
    X &= 255; Y &= 255; Z &= 255;
    const u = fade(x), v = fade(y), w = fade(z);
    const A = p[X] + Y, AA = p[A] + Z, AB = p[A + 1] + Z;
    const B = p[X + 1] + Y, BA = p[B] + Z, BB = p[B + 1] + Z;
    return mix(
      mix(mix(grad(p[AA], x, y, z), grad(p[BA], x - 1, y, z), u), mix(grad(p[AB], x, y - 1, z), grad(p[BB], x - 1, y - 1, z), u), v),
      mix(mix(grad(p[AA + 1], x, y, z - 1), grad(p[BA + 1], x - 1, y, z - 1), u), mix(grad(p[AB + 1], x, y - 1, z - 1), grad(p[BB + 1], x - 1, y - 1, z - 1), u), v),
      w,
    );
  }

  function fbm(x, y, z, octaves = 3, gain = 0.5, lac = 2.03) {
    let amp = 1, sum = 0, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * n3(x, y, z);
      norm += amp;
      x = x * lac + 17.3; y = y * lac - 9.1; z = z * lac + 4.7;
      amp *= gain;
    }
    return sum / norm;
  }

  /** Ridged noise: thin bright creases, 0..1. */
  function ridge(x, y, z) {
    return 1 - Math.abs(n3(x, y, z));
  }

  return { n3, fbm, ridge };
}

export const clamp = (v, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);
export const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export const lerp = mix;
