// What a stone is worth, and what the market thinks it is worth.
//
// The truth: every centimetre-sized cell of flesh is priced by its grade
// (種水), its colour and its flaws, then marked down by how close it sits to
// a crack -- clean ground makes bracelets, cracked ground only makes small
// pieces. Summed, that is the stone's true value.
//
// The market never sees the truth. It starts from what the skin shows (the
// outermost flesh, read through skin and torch, assumed to carry on inward)
// and replaces that guess with fact wherever a window or a saw cut has
// exposed the flesh. A window that beats the guess re-rates the whole stone
// upward (擦漲); a cut face that falls short of it does the opposite (切垮).

import { clamp, smooth, rng } from './noise.js';
import { BODIES, MINES, gradeName } from '../game/lore.js';
import { FINDS } from './gen.js';
import { TUNING } from '../game/tuning.js';

const BRACELET_CM3 = 125; // rough used up per bracelet, waste and core included
const PENDANT_CM3 = 30;
const CABOCHON_CM3 = 5;

/** Price in 元 of one bracelet cut from this material. */
export function braceletPrice(z, g, pur, yel, blk, cot, hq, bodyQ) {
  let lg = 2.6 + 3.2 * z;
  lg += g * (0.75 + 1.0 * z) * hq;
  lg += pur * (0.4 + 0.45 * z);
  lg += yel * (0.22 + 0.35 * z);
  let v = Math.pow(10, lg);
  v *= 1 - 0.85 * blk;
  v *= 1 - 0.55 * cot * smooth(0.3, 0.75, z); // cotton only shows in clear material
  return v * bodyQ;
}

export function createAppraiser(def, baked, field) {
  const C = baked.cells;
  const n = C.n, nCrack = def.cracks.length;
  const u = def.unitCm;
  const cellCm3 = (C.size * u) ** 3;
  const hq = def.green.hq, bodyQ = BODIES[def.body].q;
  const noise = rng(def.seed ^ 0x51f15e);
  const zBias = noise.gauss() * TUNING.readNoiseZ;
  // How far the whole market misjudges this particular stone from its skin.
  // Everyone at the stall reads the same skin, so the stall's price and any
  // resale offer are wrong together: there is no buying low and flipping it unopened.
  const vendorNoise = Math.exp(noise.gauss() * TUNING.priceNoise);

  // Can a bracelet blank (a 7.4 cm disc, 1.4 cm thick) come out of this stone at all?
  const lo = [9, 9, 9], hi = [-9, -9, -9];
  let cx = 0, cy = 0, cz = 0, fleshCells = 0;
  for (let j = 0; j < n; j++) {
    for (let a = 0; a < 3; a++) { const v = C.pos[j * 3 + a]; if (v < lo[a]) lo[a] = v; if (v > hi[a]) hi[a] = v; }
    cx += C.pos[j * 3] * C.frac[j]; cy += C.pos[j * 3 + 1] * C.frac[j]; cz += C.pos[j * 3 + 2] * C.frac[j];
    fleshCells += C.frac[j];
  }
  cx /= fleshCells || 1; cy /= fleshCells || 1; cz /= fleshCells || 1;
  const dims = [0, 1, 2].map((a) => (hi[a] - lo[a] + C.size) * u).sort((a, b) => b - a);
  const canBracelet = dims[1] >= 7.2 && dims[2] >= 1.6;

  /** Share of a cell's value that survives, given the nearest crack. */
  function tier(dCm, sh, g) {
    let t = 0.07 + 0.25 * smooth(0.5, 1.6, dCm) + (canBracelet ? 0.68 : 0.1) * smooth(2.2, 3.8, dCm);
    t *= 1 - 0.85 * sh;
    // strong colour is worth cutting out as cabochons even from broken ground
    return Math.max(t, 0.45 * smooth(0.35, 0.8, g) * (1 - 0.5 * sh));
  }

  // ---------------------------------------------------------------- truth
  const uTrue = new Float32Array(n); // value of the cell if it were bracelet ground
  for (let j = 0; j < n; j++) {
    uTrue[j] = (braceletPrice(C.z[j], C.g[j], C.pur[j], C.yel[j], C.blk[j], C.cot[j], hq, bodyQ) / BRACELET_CM3) * cellCm3 * C.frac[j];
  }
  const crackCm = (j, known) => {
    let d = 99;
    for (let k = 0; k < nCrack; k++) {
      if (known && !known[k]) continue;
      const v = C.crack[j * nCrack + k] * u * (def.cracks[k].healed ? 2.6 : 1);
      if (v < d) d = v;
    }
    return d;
  };
  const tierTrue = new Float32Array(n);
  let trueValue = 0;
  for (let j = 0; j < n; j++) {
    tierTrue[j] = tier(crackCm(j, null), C.sh[j], C.g[j]);
    trueValue += uTrue[j] * tierTrue[j];
  }

  // ---------------------------------------------------------------- the market's first read
  // For every cell: the outermost flesh along the ray from the centre through it.
  const M = C.M;
  const slot = (x, y, z) => {
    const i = Math.floor((x + M * C.size * 0.5) / C.size), jj = Math.floor((y + M * C.size * 0.5) / C.size), k = Math.floor((z + M * C.size * 0.5) / C.size);
    if (i < 0 || jj < 0 || k < 0 || i >= M || jj >= M || k >= M) return -1;
    return C.index[i + jj * M + k * M * M];
  };
  const ATTR = ['z', 'g', 'pur', 'yel', 'blk', 'cot', 'sh'];
  const shellMean = {}, shellW = { w: 0 };
  for (const a of ATTR) shellMean[a] = 0;
  const proxyA = new Int32Array(n), proxyB = new Int32Array(n);
  const isShell = new Uint8Array(n);
  for (let j = 0; j < n; j++) {
    const px = C.pos[j * 3], py = C.pos[j * 3 + 1], pz = C.pos[j * 3 + 2];
    let dx = px - cx, dy = py - cy, dz = pz - cz;
    const l = Math.hypot(dx, dy, dz);
    if (l < 1e-4) { dx = 1; dy = 0; dz = 0; } else { dx /= l; dy /= l; dz /= l; }
    let last = j, prev = j;
    for (let s = 1; s < M; s++) {
      const id = slot(px + dx * s * C.size, py + dy * s * C.size, pz + dz * s * C.size);
      if (id < 0) break;
      if (id !== last) { prev = last; last = id; }
    }
    proxyA[j] = last; proxyB[j] = prev;
    isShell[last] = 1;
  }
  for (let j = 0; j < n; j++) {
    if (!isShell[j]) continue;
    for (const a of ATTR) shellMean[a] += C[a][j] * C.frac[j];
    shellW.w += C.frac[j];
  }
  for (const a of ATTR) shellMean[a] /= shellW.w || 1;

  const prior = {};
  for (const a of ATTR) {
    const arr = prior[a] = new Float32Array(n);
    const src = C[a], mean = shellMean[a];
    for (let j = 0; j < n; j++) arr[j] = (0.5 * (src[proxyA[j]] + src[proxyB[j]])) * (1 - TUNING.regress) + mean * TUNING.regress;
  }
  // The trade's own scepticism, so a dazzling skin is not taken at face value:
  // 翡 is known to be a skin-deep stain, colour under a skin often fails to
  // go in, and an exceptional read is pulled toward what the mine usually gives.
  const zUsual = MINES[def.mine].z.mean;
  // (a skin that is strong green from end to end is the exception: patches lie, a whole skin rarely does)
  const believed = TUNING.doubtGreen + (TUNING.trustFull - TUNING.doubtGreen) * smooth(0.55, 0.78, shellMean.g);
  for (let j = 0; j < n; j++) {
    const deep = C.depth[j];
    prior.yel[j] *= Math.exp(-deep / TUNING.doubtYellow);
    prior.g[j] *= believed + (1 - believed) * Math.exp(-deep / 0.15);
    prior.z[j] = clamp(prior.z[j] + (zUsual - prior.z[j]) * TUNING.doubtGrade + zBias, 0.02, 0.98);
  }
  const uPrior = new Float32Array(n);
  for (let j = 0; j < n; j++) {
    uPrior[j] = (braceletPrice(prior.z[j], prior.g[j], prior.pur[j], prior.yel[j], prior.blk[j], prior.cot[j], hq, bodyQ) / BRACELET_CM3) * cellCm3 * C.frac[j];
  }

  // ---------------------------------------------------------------- evidence
  const K = new Float32Array(n); // 0 = guessed from the skin, 1 = seen
  const known = new Uint8Array(nCrack); // cracks the market knows about
  for (let k = 0; k < nCrack; k++) known[k] = baked.reach[k] && def.cracks[k].skinVis > 0 ? 1 : 0;
  const tierNow = new Float32Array(n);
  const refreshTiers = () => {
    for (let j = 0; j < n; j++) {
      const k = K[j];
      tierNow[j] = tier(crackCm(j, known), k * C.sh[j] + (1 - k) * prior.sh[j], k * C.g[j] + (1 - k) * prior.g[j]);
    }
  };
  refreshTiers();

  const calib = TUNING.calib[def.mine] ?? 1;

  // ---------------------------------------------------------------- the dream
  // Nobody can see into the heart of an unopened stone, and everybody knows what this mine
  // has hidden there before: the chance is part of the price. The market also knows how
  // clear the flesh under the skin has to be for each kind of find -- so in a mine of dull
  // stones, a plain one with an ice-clear shell is priced as the lottery ticket it is, and
  // the same shell from a mine where ice is common carries almost nothing. One cut through
  // the heart settles it either way; a window never reaches that far.
  const mineOf = MINES[def.mine];
  const zSeen = shellMean.z + zBias;
  const usual = Math.exp(-0.5 * ((zSeen - mineOf.z.mean) / mineOf.z.sd) ** 2) / (mineOf.z.sd * 2.5066);
  let plain = 1, findOdds = 0, hope = 0;
  for (const k in FINDS) plain -= (mineOf.lucky?.[k] || 0) * TUNING.luck;
  for (const k in FINDS) {
    const F = FINDS[k];
    // (a shell that already shows colour is not hiding that colour: what shows is priced as what it is)
    const fits = smooth(F.z[0] - 0.06, F.z[0], zSeen) * (1 - smooth(F.z[1], F.z[1] + 0.06, zSeen))
      * (F.plain ? (1 - smooth(0.1, 0.3, shellMean.pur)) * (1 - smooth(0.2, 0.45, shellMean.g)) : 1);
    const odds = (mineOf.lucky?.[k] || 0) * TUNING.luck * F.hidden * fits * (F.asMine ? usual : 1 / (F.z[1] - F.z[0]));
    findOdds += odds; hope += odds * (TUNING.hope[k] || 0);
  }
  hope /= Math.max(plain, 0) * usual + findOdds || 1;
  let deepest = 0, heartW = 0;
  for (let j = 0; j < n; j++) if (C.depth[j] > deepest) deepest = C.depth[j];
  const inHeart = new Uint8Array(n);
  for (let j = 0; j < n; j++) if (C.depth[j] > 0.45 * deepest) { inHeart[j] = 1; heartW += C.frac[j]; }
  /** How much of the hope is still alive: 1 on an unopened stone, 0 once its heart has been seen. */
  const hopeLeft = () => {
    let seen = 0;
    for (let j = 0; j < n; j++) if (inHeart[j]) seen += K[j] * C.frac[j];
    return Math.exp(-seen / (heartW || 1) / TUNING.hopeFade);
  };

  /** The market's view right now. */
  function estimate() {
    let num = 0, den = 0, kSum = 0, volKnown = 0;
    for (let j = 0; j < n; j++) {
      const k = K[j];
      volKnown += k * C.frac[j];
      if (k > 0.02) { num += k * uTrue[j]; den += k * uPrior[j]; kSum += k; }
    }
    const coverage = volKnown / (fleshCells || 1);
    const dream = 1 + hope * hopeLeft();
    // one good window re-rates the rest of the stone; the effect fades as guesswork runs out
    const weight = 1 - Math.exp(-kSum / TUNING.surpriseCells);
    const surprise = den > 0 ? Math.pow(clamp(num / den, 0.04, 30), TUNING.surprisePower * weight) : 1;
    let value = 0;
    for (let j = 0; j < n; j++) {
      const k = K[j];
      // the unseen part carries the market's misreading of this stone; facts wash it out
      const unit = k * uTrue[j] + (1 - k) * uPrior[j] * surprise * calib * vendorNoise * dream;
      value += unit * tierNow[j] * (1 - TUNING.hiddenRisk * (1 - k));
    }
    // buyers shave the price for what they still cannot see
    const offer = value * (TUNING.resale + (1 - TUNING.resale) * Math.pow(coverage, TUNING.resaleCurve));
    return { value, offer, coverage, surprise, dream };
  }

  /**
   * Flesh has been exposed at these points (xyz triples, stone space).
   * Returns what the newly seen material looked like, for the commentary.
   */
  function reveal(points) {
    const hopeBefore = hope * hopeLeft();
    const seen = new Set();
    const grown = new Float32Array(n);
    const hits = new Uint16Array(nCrack);
    for (let p = 0; p < points.length; p += 3) {
      const x = points[p], y = points[p + 1], z = points[p + 2];
      for (let k = 0; k < nCrack; k++) if (!known[k] && field.crackDist(k, x, y, z) < 0.013) hits[k]++;
      // thin the points out: one per ~3 mm box is plenty
      const key = Math.round(x * 32) + Math.round(y * 32) * 4096 + Math.round(z * 32) * 16777216;
      if (seen.has(key)) continue;
      seen.add(key);
      const home = slot(x, y, z);
      // clear material lets the eye (and the torch) reach further in
      const L = TUNING.sightBase + TUNING.sightClear * (home >= 0 ? C.z[home] : 0.3);
      const reachCells = Math.ceil((L * 1.9) / C.size);
      const ci = Math.floor((x + M * C.size * 0.5) / C.size), cj = Math.floor((y + M * C.size * 0.5) / C.size), ck = Math.floor((z + M * C.size * 0.5) / C.size);
      for (let dk = -reachCells; dk <= reachCells; dk++) {
        const kk = ck + dk;
        if (kk < 0 || kk >= M) continue;
        for (let dj = -reachCells; dj <= reachCells; dj++) {
          const jj = cj + dj;
          if (jj < 0 || jj >= M) continue;
          for (let di = -reachCells; di <= reachCells; di++) {
            const ii = ci + di;
            if (ii < 0 || ii >= M) continue;
            const id = C.index[ii + jj * M + kk * M * M];
            if (id < 0) continue;
            const ddx = C.pos[id * 3] - x, ddy = C.pos[id * 3 + 1] - y, ddz = C.pos[id * 3 + 2] - z;
            const k = Math.min(1, 1.3 * Math.exp(-(ddx * ddx + ddy * ddy + ddz * ddz) / (L * L)));
            if (k > K[id]) { grown[id] += k - K[id]; K[id] = k; }
          }
        }
      }
    }
    const found = [];
    for (let k = 0; k < nCrack; k++) if (hits[k] >= 2) { known[k] = 1; found.push(k); }
    refreshTiers();

    // `rich` and `violet`: how much of what was just seen is the colour dealers dream about
    const s = { weight: 0, z: 0, g: 0, pur: 0, yel: 0, blk: 0, cot: 0, sh: 0, zGuess: 0, gGuess: 0, rich: 0, violet: 0, cracks: found.length, bigCracks: 0 };
    for (let j = 0; j < n; j++) {
      const w = grown[j] * C.frac[j];
      if (w <= 0) continue;
      s.weight += w;
      for (const a of ATTR) s[a] += C[a][j] * w;
      s.zGuess += prior.z[j] * w; s.gGuess += prior.g[j] * w;
      if (C.g[j] > 0.6) s.rich += w;
      if (C.pur[j] > 0.5 && C.z[j] > 0.58) s.violet += w;
    }
    if (s.weight > 0) { for (const a of ATTR) s[a] /= s.weight; s.zGuess /= s.weight; s.gGuess /= s.weight; s.rich /= s.weight; s.violet /= s.weight; }
    for (const k of found) if (!def.cracks[k].healed && def.cracks[k].r > 0.6) s.bigCracks++;
    s.hopeLost = hopeBefore - hope * hopeLeft(); // how much of the price was a dream this reveal settled
    return s;
  }

  /** What the stone turns into on the carver's bench (from the truth). */
  function products() {
    const out = {
      bracelet: { vol: 0, value: 0 }, pendant: { vol: 0, value: 0 }, cabochon: { vol: 0, value: 0 }, small: { vol: 0, value: 0 },
    };
    let best = 0;
    for (let j = 0; j < n; j++) {
      const t = tierTrue[j], v = uTrue[j] * t, vol = cellCm3 * C.frac[j];
      let key = 'small';
      if (canBracelet && t >= 0.72) { key = 'bracelet'; best = Math.max(best, uTrue[j] / (cellCm3 * C.frac[j] || 1) * BRACELET_CM3); }
      else if (C.g[j] > 0.45) key = 'cabochon';
      else if (t >= 0.28) key = 'pendant';
      out[key].vol += vol; out[key].value += v;
    }
    out.bracelet.count = Math.floor(out.bracelet.vol / BRACELET_CM3);
    out.pendant.count = Math.floor(out.pendant.vol / PENDANT_CM3);
    out.cabochon.count = Math.floor(out.cabochon.vol / CABOCHON_CM3);
    out.small.count = Math.floor(out.small.vol / 12);
    // a stone that holds less than one bracelet's worth of clean ground makes pendants instead
    if (out.bracelet.count === 0 && out.bracelet.vol > 0) {
      out.pendant.vol += out.bracelet.vol; out.pendant.value += out.bracelet.value;
      out.pendant.count = Math.floor(out.pendant.vol / PENDANT_CM3);
      out.bracelet.vol = 0; out.bracelet.value = 0;
    }
    out.bestBracelet = out.bracelet.count ? best : 0;
    return out;
  }

  /** Flesh-wide statistics and the trade name they add up to. */
  function describe() {
    let w = 0, z = 0, gCover = 0, gSum = 0, topCover = 0, topSum = 0, purCover = 0, yelCover = 0, blkCover = 0, cot = 0;
    for (let j = 0; j < n; j++) {
      const f = C.frac[j];
      w += f; z += C.z[j] * f; cot += C.cot[j] * f;
      if (C.g[j] > 0.14) { gCover += f; gSum += C.g[j] * f; }
      if (C.g[j] > 0.6) { topCover += f; topSum += C.g[j] * f; }
      if (C.pur[j] > 0.25) purCover += f;
      if (C.yel[j] > 0.25) yelCover += f;
      if (C.blk[j] > 0.3) blkCover += f;
    }
    w = w || 1;
    const s = { z: z / w, gCover: gCover / w, gMean: gCover ? gSum / gCover : 0, purCover: purCover / w, yelCover: yelCover / w, blkCover: blkCover / w, cot: cot / w };
    // A stone with a glass heart under duller flesh is named for the heart: the best 40% of it.
    let zName = s.z;
    if (def.z.heart) {
      const order = Array.from({ length: n }, (_, j) => j).sort((a, b) => C.z[b] - C.z[a]);
      let vol = 0, sum = 0;
      for (const j of order) { vol += C.frac[j]; sum += C.z[j] * C.frac[j]; if (vol >= 0.4 * w) break; }
      zName = sum / (vol || 1);
    }
    const grade = gradeName(zName);
    let color;
    const green = s.gCover > 0.1, purple = s.purCover > 0.15, yellow = s.yelCover > 0.12;
    // colour this strong names the stone even when it only fills the heart of it
    const rich = topCover / w > 0.06 && topSum / topCover > 0.72;
    if (green && purple && yellow) color = '福祿壽';
    else if (green && purple) color = '春帶彩';
    else if (s.gCover > 0.5 || rich) {
      color = rich ? (Math.abs(def.green.hue) < 0.35 && s.z > 0.55 ? '帝王綠' : s.gCover > 0.5 ? '滿綠' : '辣綠') : s.gMean > 0.48 ? '陽綠' : s.gMean > 0.3 ? '蘋果綠' : '淡綠';
    } else if (green && yellow) color = '黃加綠';
    else if (green) color = def.green.kind === 'wisps' ? '飄花' : s.gMean > 0.5 ? '帶綠' : '飄綠';
    else if (s.purCover > 0.3) color = '紫羅蘭';
    else if (purple) color = '帶春';
    else if (s.yelCover > 0.25) color = def.yellow && def.yellow.red > 0.6 ? '紅翡' : '黃翡';
    else color = { white: '無色', grey: '灰底', oil: '油青', blueWater: '藍水', clearWater: '晴水' }[def.body];
    s.name = grade === '磚頭料' ? '磚頭料' : `${grade}${color}`;
    if (s.blkCover > 0.25) s.name += '（帶髒）';
    s.grade = grade; s.color = color;
    // the names a dealer tells stories about
    s.rare = grade !== '磚頭料' && (['帝王綠', '滿綠', '辣綠'].includes(color) || grade === '玻璃種'
      || (['紫羅蘭', '春帶彩', '福祿壽'].includes(color) && zName >= 0.6));
    return s;
  }

  /** What anyone can read off the skin before paying. */
  function traits() {
    const out = [];
    const visible = [...known].filter(Boolean).length;
    if (shellMean.g > 0.2) out.push('松花明顯');
    else if (shellMean.g > 0.05) out.push('零星松花');
    if (def.green.bands.length) out.push('見蟒帶');
    if (shellMean.blk > 0.12) out.push('有黑癬');
    if (def.grain < 0.8) out.push('砂細'); else if (def.grain > 1.15) out.push('砂粗');
    if (hope >= 0.3) out.push('賭性大'); // the asking price is paying for what the heart might hold
    if (visible >= 4) out.push(`表面多裂（${visible} 條）`);
    else if (visible > 0) out.push(`表面見裂 ${visible} 條`);
    else out.push('表面不見裂');
    return out;
  }

  const first = estimate();
  return {
    def, canBracelet, trueValue, vendorNoise, hope,
    askPrice: first.value * TUNING.markup,
    estimate, reveal, products, describe, traits,
    get knownCracks() { return known; },
    get knowledge() { return K; },
    shellMean,
  };
}
