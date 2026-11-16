// A rough stone, grown from a seed.
//
// makeStone(seed) rolls the hidden parameters of one stone: its shape, its
// skin, and everything inside it (texture grade, colour, cotton, cracks, fog).
// makeField(def) turns those parameters into functions of position, so the
// stone is a real solid: a window, a torch and a saw cut all look at the same
// interior, wherever the player chooses to put them.
//
// Units: the stone lives in a box of half-size BOX; 1 unit is def.unitCm cm.

import { rng, makeNoise, clamp, smooth } from './noise.js';
import { MINES, SKINS, FOGS, BODIES } from '../game/lore.js';
import { TUNING } from '../game/tuning.js';

/**
 * 機緣: the rare finds. Each replaces part of what the mine rolled.
 *   imperial  帝王綠: strong, even green right through, in ice-clear material
 *   violet    冰紫羅蘭: saturated purple in ice-clear material (the exception to 十春九豆)
 *   spring    春帶彩: a thick green band through purple, sometimes 翡 under the skin too
 *   glass     皮粗肉細: ordinary flesh under the skin, a heart a grade or two clearer
 *   vein      藏色: strong colour in the middle of the stone that never reaches the skin
 * `hidden` is the share whose find stays clear of the skin -- where neither a torch on the
 * skin nor the market can read it, and only a window or the saw finds it. `z` is the 種水
 * of the flesh under the skin of those hidden ones: the one thing about them that does
 * show, and what the market prices its hopes on (see the dream in appraise.js). `asMine`
 * marks the finds whose shell is simply whatever the mine rolled, kept within that range;
 * `plain` the ones whose shell carries none of the colour they hide.
 */
export const FINDS = {
  imperial: { hidden: 0.6, z: [0.57, 0.8], plain: true },
  violet: { hidden: 0.5, z: [0.62, 0.9], plain: true },
  spring: { hidden: 0.45, z: [0.58, 0.86], plain: true },
  glass: { hidden: 1, z: [0.3, 0.6], asMine: true },
  vein: { hidden: 1, z: [0.32, 1], asMine: true, plain: true },
};

export const BOX = 1.25;
export const MAX_CRACKS = 10;
export const MAX_BANDS = 3;
export const KERF = 0.012; // material a saw cut turns into slurry

const TAU = Math.PI * 2;
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const perp = (n, R) => norm(cross(n, norm([R() - 0.5, R() - 0.5, R() - 0.5])));
const scl = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const round4 = (a) => a.map((v) => +v.toFixed(4));

export function makeStone(seed, opt = {}) {
  const R = rng(seed);
  const weights = {};
  for (const k in MINES) weights[k] = MINES[k].weight;
  const mine = opt.mine || R.weighted(weights);
  const M = MINES[mine];
  const skin = R.weighted(M.skins);
  const S = SKINS[skin];

  // ---------------------------------------------------------------- 機緣
  // Rolled on a stream of its own, so an ordinary seed still grows the stone it always did.
  const L = rng((seed ^ 0x2b7e1516) >>> 0);
  let lucky = null;
  if (opt.lucky !== undefined) lucky = opt.lucky in FINDS ? opt.lucky : null; // lab override
  else if (opt.color === undefined && opt.z === undefined) {
    let x = L();
    for (const k in FINDS) { x -= (M.lucky?.[k] || 0) * TUNING.luck; if (x < 0) { lucky = k; break; } }
  }
  const hidden = !!lucky && (opt.hidden !== undefined ? !!opt.hidden : L.chance(FINDS[lucky].hidden));
  const fine = !!lucky && lucky !== 'vein'; // gem material: cleaner than the mine usually gives

  // ---------------------------------------------------------------- shape
  const round = clamp(M.round + R.range(-0.18, 0.18));
  let unitCm = R.range(M.size[0], M.size[1]) * (opt.sizeScale || 1);
  // gem material comes in small pieces: the great finds are fist-sized, not boulders
  // (帝王綠 smallest of all: nobody leaves a boulder of it lying on a stall)
  if (fine && lucky !== 'glass') unitCm = Math.min(unitCm, lucky === 'imperial' ? L.range(3, 5.6) : L.range(3.4, 6.2));
  const radii = [1, R.range(0.5, 0.72), R.range(0.66, 0.9)]; // x longest, y shortest (it rests on y)
  const yaw = R.range(0, TAU);
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const toObj = (v) => [cy * v[0] - sy * v[2], v[1], sy * v[0] + cy * v[2]];
  const support = (n) => Math.hypot(n[0] * radii[0], n[1] * radii[1], n[2] * radii[2]);
  /** A point inside the stone, `f` of the way out at most. */
  const inside = (f) => {
    const d = R.dir(), r = Math.cbrt(R()) * f;
    return toObj([d[0] * radii[0] * r, d[1] * radii[1] * r, d[2] * radii[2] * r]);
  };

  const facets = [];
  const nFacet = Math.round((1 - round) * R.range(1.5, 5));
  for (let i = 0; i < nFacet; i++) {
    const n = R.dir();
    facets.push({ n: round4(n), h: +(support(n) * R.range(0.74, 0.92)).toFixed(4) });
  }
  const dents = [];
  const nDent = R.int(0, 2);
  for (let i = 0; i < nDent; i++) {
    // a shallow scoop out of the surface: a sphere centred outside the skin
    const d = R.dir(), r = R.range(0.2, 0.5);
    const on = [d[0] * radii[0], d[1] * radii[1], d[2] * radii[2]];
    const out = norm(on);
    const lift = r * R.range(0.78, 0.9);
    dents.push({ c: round4([on[0] + out[0] * lift, on[1] + out[1] * lift, on[2] + out[2] * lift]), r: +r.toFixed(4) });
  }

  // ---------------------------------------------------------------- 種水
  let zBase = clamp(M.z.mean + R.gauss() * M.z.sd, 0.03, 0.97);
  if (opt.z !== undefined) zBase = opt.z; // lab override
  let hasPurple = R.chance(M.purple);
  if (hasPurple && R.chance(0.7)) zBase *= R.range(0.55, 0.85); // 十春九豆
  let flip = R.chance(M.flip)
    ? { n: round4(R.dir()), d: R.range(-0.3, 0.3), delta: (R.chance(0.62) ? -1 : 1) * R.range(0.14, 0.4), width: R.range(0.04, 0.22) }
    : null;
  let zHeart = 0; // how much clearer the heart of the stone is than the flesh under the skin
  const zFind = lucky ? FINDS[lucky].z : null;
  if (lucky === 'imperial') { zBase = hidden ? L.range(zFind[0], zFind[1]) : L.range(0.62, 0.93); hasPurple = false; }
  else if (lucky === 'violet' || lucky === 'spring') { zBase = L.range(zFind[0], zFind[1]); hasPurple = true; }
  else if (lucky === 'glass') { zBase = clamp(zBase, zFind[0], zFind[1]); zHeart = Math.min(L.range(0.16, 0.34), 0.97 - zBase); }
  else if (lucky === 'vein') zBase = Math.max(zBase, zFind[0]);
  if (fine) flip = null;
  const z = { base: zBase, varAmp: R.range(0.03, 0.11), freq: R.range(0.9, 2.2), flip, heart: zHeart };

  // ---------------------------------------------------------------- green
  const kind = opt.color || R.weighted(M.color);
  const peak = () => clamp(R.range(M.gPeak[0], M.gPeak[1]) + (R.chance(0.07) ? 0.25 : 0), 0.12, 1);
  const green = { kind, bands: [], blobs: [], wisps: null, full: null, skinDeep: null };
  const addWisps = (amp) => {
    green.wisps = { amp, dir: round4(R.dir()), stretch: R.range(2.2, 4.5), freq: R.range(2.2, 4.2), thr: R.range(0.8, 0.9), off: [R.range(0, 40), R.range(0, 40), R.range(0, 40)] };
  };
  if (kind === 'band') {
    const n = R.chance(0.3) ? R.int(2, MAX_BANDS) : 1;
    const main = R.dir();
    for (let i = 0; i < n; i++) {
      // sibling bands tend to run alongside each other
      const nn = i === 0 ? main : norm([main[0] + R.range(-0.4, 0.4), main[1] + R.range(-0.4, 0.4), main[2] + R.range(-0.4, 0.4)]);
      green.bands.push({
        c: round4(inside(0.55)), n: round4(nn), r: R.range(0.45, 1.3), th: R.range(0.025, 0.11), peak: peak(),
        warp: R.range(0.04, 0.16), off: [R.range(0, 40), R.range(0, 40), R.range(0, 40)],
      });
    }
  } else if (kind === 'blobs') {
    const n = R.int(1, 4);
    for (let i = 0; i < n; i++) green.blobs.push({ c: round4(inside(0.8)), r: R.range(0.12, 0.42), peak: peak() });
  } else if (kind === 'wisps') {
    addWisps(R.range(0.22, 0.6));
  } else if (kind === 'full') {
    green.full = { amp: peak() };
  } else if (kind === 'skinDeep') {
    // 靠皮綠: a sheet of colour that hugs the skin and goes nowhere
    green.skinDeep = { amp: clamp(peak() + 0.15, 0, 1), depth: R.range(0.04, 0.13), off: [R.range(0, 40), R.range(0, 40), R.range(0, 40)] };
  }
  if (!green.wisps && kind !== 'none' && zBase > 0.45 && R.chance(0.22)) addWisps(R.range(0.15, 0.4));
  let hue = R.range(M.hue[0], M.hue[1]);
  if (lucky && lucky !== 'glass') {
    const made = { bands: [], blobs: [], wisps: null, full: null, skinDeep: null };
    if (lucky === 'imperial') {
      // `even` lifts the colour out of its usual mottling: 濃、陽、正、勻
      made.kind = 'full';
      made.full = { amp: L.range(0.9, 1), even: L.range(0.8, 1) };
      hue = L.range(-0.12, 0.2);
    } else if (lucky === 'violet') {
      made.kind = 'none';
    } else if (lucky === 'spring') {
      made.kind = 'band';
      const main = R.dir();
      for (let i = L.int(1, 2); i > 0; i--) {
        made.bands.push({
          c: round4(inside(0.4)), n: round4(norm([main[0] + L.range(-0.3, 0.3), main[1] + L.range(-0.3, 0.3), main[2] + L.range(-0.3, 0.3)])),
          r: L.range(0.7, 1.3), th: L.range(0.07, 0.14), peak: L.range(0.6, 0.9),
          warp: L.range(0.04, 0.14), off: [L.range(0, 40), L.range(0, 40), L.range(0, 40)],
        });
      }
    } else {
      made.kind = 'blobs';
      for (let i = L.int(2, 3); i > 0; i--) made.blobs.push({ c: round4(inside(0.4)), r: L.range(0.34, 0.6), peak: L.range(0.75, 1) });
    }
    Object.assign(green, made);
  }
  green.hue = hue;
  green.hq = clamp(1 - 0.42 * Math.pow(Math.abs(hue), 1.4) - (hue < -0.5 ? 0.15 : 0), 0.4, 1);

  // ---------------------------------------------------------------- body, other colours
  let body = R.weighted(M.body);
  if ((body === 'clearWater' || body === 'blueWater') && zBase < 0.5) body = R.chance(0.6) ? 'white' : 'grey';
  if (fine && lucky !== 'glass' && (body === 'grey' || body === 'oil')) body = 'white';
  if (opt.body) body = opt.body; // look-dev override
  const purple = hasPurple
    ? { amp: R.range(0.3, 0.95), freq: R.range(0.7, 1.5), thr: R.range(-0.25, 0.2), off: [R.range(0, 40), R.range(0, 40), R.range(0, 40)], tone: R.range(0, 1) }
    : null;
  // a low threshold floods the stone with colour instead of leaving it in patches
  if (lucky === 'violet') Object.assign(purple, { amp: L.range(0.78, 1), thr: L.range(-0.85, -0.5) });
  if (lucky === 'spring') Object.assign(purple, { amp: L.range(0.6, 0.95), thr: L.range(-0.6, -0.25) });
  let yellow = R.chance(M.yellow) ? { amp: R.range(0.3, 0.95), depth: R.range(0.05, 0.22), red: R.range(0, 1) } : null;
  if (lucky === 'spring' && !yellow && L.chance(0.35)) yellow = { amp: L.range(0.5, 0.95), depth: L.range(0.12, 0.22), red: L.range(0, 1) }; // 福祿壽
  let black = R.chance(M.black) || opt.black
    ? { amp: R.range(0.35, 0.95), freq: R.range(1.6, 3.4), thr: R.range(0.12, 0.42), off: [R.range(0, 40), R.range(0, 40), R.range(0, 40)], eats: R.chance(0.6) ? R.range(0.15, 0.4) : 0 }
    : null;
  if (fine && !opt.black && L.chance(0.7)) black = null;
  const cotton = {
    amp: R.range(M.cotton[0], M.cotton[1]) * (R.chance(0.2) ? 0.3 : 1) * (fine ? L.range(0.3, 0.7) : 1),
    type: R.weighted(M.cottonType), freq: R.range(1.0, 2.4), off: [R.range(0, 40), R.range(0, 40), R.range(0, 40)],
  };
  // Where the hidden part of a find begins, as depth below the flesh surface. `leak` lets
  // it come up to the skin in a few places: the patch of 松花 on an otherwise plain stone.
  let heart = null;
  if (hidden) {
    // 帝王綠 is usually a knot of colour (色根) deep in the middle of the stone, a half to
    // two thirds of the way in; one time in ten it fills the whole heart
    const knot = lucky === 'imperial' && L.chance(0.9);
    const d0 = knot ? (radii[1] - 0.06) * L.range(0.5, 0.7) : L.range(0.09, 0.19);
    heart = {
      d0, w: L.range(0.03, 0.07), warp: L.range(0.02, 0.05),
      leak: knot ? (L.chance(0.35) ? d0 * L.range(0.6, 1) : 0) : L.chance(0.45) ? d0 * L.range(0.9, 1.4) : 0,
      tint: lucky !== 'glass', off: [L.range(0, 40), L.range(0, 40), L.range(0, 40)],
    };
  }

  // ---------------------------------------------------------------- cracks
  const cracks = [];
  const nCrack = Math.min(MAX_CRACKS, R.int(M.cracks[0], M.cracks[1]) - (R.chance(0.2) ? 2 : 0)) - (fine ? L.int(0, 2) : 0);
  for (let i = 0; i < nCrack; i++) {
    const n = R.dir();
    const big = R.chance(0.16);
    const k1 = scl(perp(n, R), R.range(3, 8)), k2 = scl(perp(n, R), R.range(7, 15)), k3 = scl(perp(n, R), R.range(2, 5));
    cracks.push({
      c: round4(inside(0.85)), n: round4(n), r: big ? R.range(0.9, 1.6) : R.range(0.16, 0.7),
      k1: round4(k1), p1: R.range(0, TAU), a1: R.range(0.006, 0.03),
      k2: round4(k2), p2: R.range(0, TAU), a2: R.range(0.003, 0.011),
      k3: round4(k3), p3: R.range(0, TAU),
      healed: R.chance(0.22), // 石紋: shows, but the stone holds together
      stain: R.chance(0.45) ? R.range(0.3, 1) : 0, // 鏽裂
      open: R.range(0.45, 1),
      skinVis: R.chance(0.72) ? R.range(0.45, 1) : 0, // how clearly it shows on the skin
    });
  }
  let shatter = R.chance(M.shatter) ? { c: round4(inside(0.8)), r: R.range(0.22, 0.5), amp: R.range(0.5, 1) } : null;
  if (fine && L.chance(0.5)) shatter = null;

  // ---------------------------------------------------------------- skin and fog
  const fogType = opt.fog || R.weighted(M.fog);
  const skinT = R.range(M.skinT[0], M.skinT[1]) * S.thick;
  const fogT = fogType === 'none' ? 0.004 : R.range(0.012, 0.04);

  return {
    seed, mine, skin, unitCm, round,
    radii, yaw, shapeExp: 2.1 + (1 - round) * 2.2 + R.range(-0.25, 0.25),
    shapeAmp: [(0.085 + (1 - round) * 0.06) * R.range(0.7, 1.3), (0.035 + (1 - round) * 0.04) * R.range(0.7, 1.3), 0.008 + (1 - round) * 0.012],
    shapeOff: [R.range(0, 50), R.range(0, 50), R.range(0, 50)],
    facets, dents,
    skinT, fogT, fogType,
    // 砂細種老: a tight fine sand usually sits on an old, fine-grained stone
    // (and it answers to the heart of the stone, which is the one honest hint of a glass heart)
    grain: S.grain * (1.5 - 0.85 * clamp(zBase + zHeart * 0.8 + R.gauss() * 0.12)) * R.range(0.9, 1.1),
    stainAmt: R.range(0.15, 0.85), stainOff: [R.range(0, 50), R.range(0, 50), R.range(0, 50)],
    lucky, heart,
    z, green, body, purple, yellow, black, cotton, cracks, shatter,
    pitch: R.range(0, 1), // seeds the vendor's sales talk
  };
}

const smax = (a, b, k) => {
  const h = clamp(0.5 + (0.5 * (a - b)) / k);
  return b + (a - b) * h + k * h * (1 - h);
};

/** Functions of position for one stone. */
export function makeField(def) {
  const { n3, fbm, ridge } = makeNoise(def.seed);
  const cy = Math.cos(def.yaw), sy = Math.sin(def.yaw);
  const [rx, ry, rz] = def.radii;
  const e = def.shapeExp, inv = 1 / e;
  const [a1, a2, a3] = def.shapeAmp;
  const [o1, o2, o3] = def.shapeOff;
  const { facets, dents, cracks } = def;
  const Z = def.z, G = def.green, P = def.purple, Y = def.yellow, B = def.black, C = def.cotton, S = def.shatter;
  const skinT = def.skinT, fogT = def.fogT;
  const H = def.heart, zHeart = Z.heart || 0;
  // an even colour keeps its strength: less of the mottling every other green has
  const even = (G.full && G.full.even) || 0, mottle = 0.26 - 0.2 * even;

  /** Signed distance to the untouched skin (negative inside). */
  function sd(x, y, z) {
    const xl = cy * x + sy * z, zl = -sy * x + cy * z;
    const qx = Math.abs(xl) / rx, qy = Math.abs(y) / ry, qz = Math.abs(zl) / rz;
    const px = Math.pow(qx, e), py = Math.pow(qy, e), pz = Math.pow(qz, e);
    const sum = px + py + pz;
    let d;
    if (sum < 1e-7) d = -ry;
    else {
      const k = Math.pow(sum, inv);
      const gx = px / (qx + 1e-6) / rx, gy = py / (qy + 1e-6) / ry, gz = pz / (qz + 1e-6) / rz;
      const gl = Math.sqrt(gx * gx + gy * gy + gz * gz) * Math.pow(sum, inv - 1);
      d = (k - 1) / Math.max(gl, 0.7);
    }
    for (let i = 0; i < facets.length; i++) {
      const f = facets[i];
      d = smax(d, xl * f.n[0] + y * f.n[1] + zl * f.n[2] - f.h, 0.07);
    }
    for (let i = 0; i < dents.length; i++) {
      const t = dents[i];
      d = smax(d, t.r - Math.hypot(xl - t.c[0], y - t.c[1], zl - t.c[2]), 0.09);
    }
    d += a1 * n3(x * 1.15 + o1, y * 1.15 + o2, z * 1.15 + o3)
      + a2 * n3(x * 2.7 + o2, y * 2.7 + o3, z * 2.7 + o1)
      + a3 * n3(x * 5.6 + o3, y * 5.6 + o1, z * 5.6 + o2);
    return d;
  }

  /** What the stone is made of at a point `depth` below the skin. Fills `o`. */
  function sample(x, y, z, depth, o) {
    // 0 in the flesh under the skin, 1 in the heart of the stone, where a find keeps what it hides
    let heart = 1;
    if (H) {
      const dd = depth - skinT - fogT + H.warp * n3(x * 1.9 + H.off[0], y * 1.9 + H.off[1], z * 1.9 + H.off[2])
        + (H.leak ? H.leak * smooth(0.15, 0.55, n3(x * 0.8 + H.off[2], y * 0.8 + H.off[0], z * 0.8 + H.off[1])) : 0);
      heart = smooth(H.d0, H.d0 + H.w, dd);
    }
    const tint = H && H.tint ? heart : 1;

    let zz = Z.base + Z.varAmp * fbm(x * Z.freq + 31.7, y * Z.freq + 2.9, z * Z.freq + 13.1, 2) + zHeart * heart;
    if (Z.flip) {
      const f = Z.flip;
      const s = x * f.n[0] + y * f.n[1] + z * f.n[2] - f.d + 0.09 * n3(x * 2.1 + 9.3, y * 2.1 + 1.7, z * 2.1 + 5.9);
      zz += f.delta * smooth(-f.width, f.width, s);
    }

    let g = 0;
    for (let i = 0; i < G.bands.length; i++) {
      const b = G.bands[i];
      const dx = x - b.c[0], dy = y - b.c[1], dz = z - b.c[2];
      const along = dx * b.n[0] + dy * b.n[1] + dz * b.n[2];
      const lat = 1 - smooth(b.r * 0.55, b.r, Math.sqrt(Math.max(dx * dx + dy * dy + dz * dz - along * along, 0)));
      if (lat <= 0) continue;
      const t = (along + b.warp * n3(x * 1.6 + b.off[0], y * 1.6 + b.off[1], z * 1.6 + b.off[2])) / b.th;
      if (t * t < 12) g = Math.max(g, b.peak * Math.exp(-t * t) * lat);
    }
    for (let i = 0; i < G.blobs.length; i++) {
      const b = G.blobs[i];
      const dx = x - b.c[0], dy = y - b.c[1], dz = z - b.c[2];
      let d2 = (dx * dx + dy * dy + dz * dz) / (b.r * b.r);
      if (d2 > 6) continue;
      d2 *= 1 + 0.55 * n3(x * 3.1 + i * 7.7, y * 3.1 + 4.4, z * 3.1 + 8.8);
      g = Math.max(g, b.peak * Math.exp(-d2 * 1.5));
    }
    if (G.wisps) {
      const w = G.wisps;
      const u = (x * w.dir[0] + y * w.dir[1] + z * w.dir[2]) * (1 - 1 / w.stretch);
      const sx = (x - w.dir[0] * u) * w.freq + w.off[0], sy2 = (y - w.dir[1] * u) * w.freq + w.off[1], sz = (z - w.dir[2] * u) * w.freq + w.off[2];
      const patch = smooth(-0.15, 0.35, n3(x * 1.1 + w.off[2], y * 1.1 + w.off[0], z * 1.1 + w.off[1]));
      if (patch > 0) g = Math.max(g, w.amp * smooth(w.thr, 0.985, ridge(sx, sy2, sz)) * patch);
    }
    if (G.full) g = Math.max(g, G.full.amp * clamp(0.72 + 0.28 * even + 0.5 * fbm(x * 1.3 + 3.3, y * 1.3 + 8.1, z * 1.3 + 2.2, 2)));
    g *= tint;
    if (G.skinDeep) {
      const s = G.skinDeep;
      const dd = depth - skinT - fogT;
      if (dd < s.depth) {
        g = Math.max(g, s.amp * (1 - smooth(s.depth * 0.4, s.depth, dd)) * smooth(-0.3, 0.12, n3(x * 1.4 + s.off[0], y * 1.4 + s.off[1], z * 1.4 + s.off[2])));
      }
    }
    if (g > 0) g *= 1 - mottle + mottle * n3(x * 5.3 + 7.1, y * 5.3 + 1.3, z * 5.3 + 9.9);
    zz += 0.07 * g; // 龍到處有水

    let pur = 0;
    if (P) pur = P.amp * smooth(P.thr, P.thr + 0.4, fbm(x * P.freq + P.off[0], y * P.freq + P.off[1], z * P.freq + P.off[2], 2)) * (1 - g) * tint;

    let yel = 0;
    if (Y) {
      const dd = depth - skinT;
      if (dd < Y.depth) yel = Y.amp * (1 - smooth(Y.depth * 0.25, Y.depth, dd)) * (0.6 + 0.4 * n3(x * 2.3 + 1.1, y * 2.3 + 6.6, z * 2.3 + 3.9));
    }

    let blk = 0;
    if (B) {
      const n = 0.62 * n3(x * B.freq + B.off[0], y * B.freq + B.off[1], z * B.freq + B.off[2])
        + 0.38 * n3(x * B.freq * 2.6 + B.off[1], y * B.freq * 2.6 + B.off[2], z * B.freq * 2.6 + B.off[0]) + B.eats * g;
      blk = B.amp * smooth(B.thr, B.thr + 0.22, n);
    }

    const cot = C.amp * smooth(-0.35, 0.45, fbm(x * C.freq + C.off[0], y * C.freq + C.off[1], z * C.freq + C.off[2], 2));

    let sh = 0;
    if (S) {
      const d = Math.hypot(x - S.c[0], y - S.c[1], z - S.c[2]) / S.r * (1 + 0.3 * n3(x * 2.9 + 5.5, y * 2.9 + 2.5, z * 2.9 + 7.5));
      sh = S.amp * (1 - smooth(0.55, 1, d));
    }

    o.z = clamp(zz); o.g = clamp(g); o.pur = clamp(pur); o.yel = clamp(yel); o.blk = clamp(blk); o.cot = clamp(cot); o.sh = clamp(sh);
    return o;
  }

  /** Distance from a point to crack `i` (a wavy disc). Mirrored in the shader. */
  function crackDist(i, x, y, z) {
    const c = cracks[i];
    const dx = x - c.c[0], dy = y - c.c[1], dz = z - c.c[2];
    const along = dx * c.n[0] + dy * c.n[1] + dz * c.n[2];
    const s = along
      + c.a1 * Math.sin(x * c.k1[0] + y * c.k1[1] + z * c.k1[2] + c.p1)
      + c.a2 * Math.sin(x * c.k2[0] + y * c.k2[1] + z * c.k2[2] + c.p2);
    const rho = Math.sqrt(Math.max(dx * dx + dy * dy + dz * dz - along * along, 0));
    const rr = c.r * (1 + 0.18 * Math.sin(x * c.k3[0] + y * c.k3[1] + z * c.k3[2] + c.p3));
    const out = Math.max(rho - rr, 0);
    return Math.sqrt(s * s + out * out);
  }

  /** How far the skin is ground down at a point by the windows opened so far. */
  function windowCut(windows, x, y, z) {
    let cut = 0;
    for (let i = 0; i < windows.length; i++) {
      const w = windows[i];
      const dx = x - w.c[0], dy = y - w.c[1], dz = z - w.c[2];
      if (dx * dx + dy * dy + dz * dz > w.r * w.r * 1.7) continue;
      // windows are ground by hand: oval, never round, with a wandering edge
      const along = w.dir ? (dx * w.dir[0] + dy * w.dir[1] + dz * w.dir[2]) * w.squash : 0;
      const dist = Math.hypot(dx + (w.dir ? w.dir[0] * along : 0), dy + (w.dir ? w.dir[1] * along : 0), dz + (w.dir ? w.dir[2] * along : 0));
      const rr = w.r * (1 + 0.16 * n3(x * 3.9 + w.o, y * 3.9 + 3.1, z * 3.9 + 9.4) + 0.06 * n3(x * 11 + 2.2, y * 11 + w.o, z * 11 + 5.4));
      cut = Math.max(cut, w.depth * (1 - smooth(0.5 * rr, rr, dist)));
    }
    return cut;
  }

  /** Signed distance of one sawn piece, with every window ground into it. */
  function pieceSd(piece, windows) {
    const planes = piece.planes;
    return (x, y, z) => {
      let d = sd(x, y, z);
      if (windows.length) d += windowCut(windows, x, y, z);
      for (let i = 0; i < planes.length; i++) {
        const p = planes[i];
        const s = p.s * (x * p.n[0] + y * p.n[1] + z * p.n[2] - p.d) + KERF * 0.5;
        if (s > d) d = s;
      }
      return d;
    };
  }

  return { def, sd, sample, crackDist, windowCut, pieceSd, n3 };
}

/** Kilograms, from the solid volume in cubic units. Jadeite is 3.33 g/cm3. */
export function weightKg(def, volumeUnits) {
  return (volumeUnits * def.unitCm ** 3 * 3.33) / 1000;
}

export { MINES, SKINS, FOGS, BODIES };
