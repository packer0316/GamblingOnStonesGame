// Grows stones without drawing them and reports what the gamble pays.
//   node tools/simulate.mjs                 300 stones, summary per mine
//   node tools/simulate.mjs --n 1500        more stones
//   node tools/simulate.mjs --fit           print the calib table for src/game/tuning.js
//   node tools/simulate.mjs --tail          how often each rare find (機緣) turns up, and how far one cut can run
//   node tools/simulate.mjs --seed 12345    describe one stone in full
//                           [--lucky imperial|violet|spring|glass|vein|none] [--hidden 0|1]  ... as that find
//   --vol 112 grows stones at the game's own resolution (slower; hidden hearts pay more there than at 64)
import { makeStone, makeField, weightKg } from '../src/stone/gen.js';
import { bakeVolume } from '../src/stone/bake.js';
import { meshPiece } from '../src/stone/mesher.js';
import { createAppraiser } from '../src/stone/appraise.js';
import { MINES } from '../src/game/lore.js';
import { TUNING } from '../src/game/tuning.js';
import { nice } from '../src/game/game.js';

const args = process.argv.slice(2);
const get = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? (args[i + 1] ?? true) : def; };
const N = Number(get('n', 300));
const VOL = Number(get('vol', 64));
const fit = args.includes('--fit');
const tail = args.includes('--tail');
const FINDS = { imperial: '帝王綠', violet: '冰紫羅蘭', spring: '春帶彩', glass: '皮粗肉細', vein: '藏色' };
const money =(v) => (v >= 1e8 ? `${(v / 1e8).toFixed(2)}億` : v >= 1e4 ? `${(v / 1e4).toFixed(1)}萬` : `${Math.round(v)}`);

function grow(seed, opt) {
  const def = makeStone(seed, opt);
  const field = makeField(def);
  const baked = bakeVolume(field, VOL);
  const app = createAppraiser(def, baked, field);
  return { def, field, baked, app };
}

/** Flesh points on a cut plane, as the mesher would report them. */
function planePoints(s, n, d) {
  const pts = [];
  const a = Math.abs(n[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0];
  const u = norm(cross(n, a)), v = cross(n, u);
  const fleshAt = s.def.skinT + s.def.fogT;
  for (let i = -60; i <= 60; i++) for (let j = -60; j <= 60; j++) {
    const x = n[0] * d + u[0] * i * 0.02 + v[0] * j * 0.02, y = n[1] * d + u[1] * i * 0.02 + v[1] * j * 0.02, z = n[2] * d + u[2] * i * 0.02 + v[2] * j * 0.02;
    if (-s.field.sd(x, y, z) > fleshAt) pts.push(x, y, z);
  }
  return pts;
}
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(...a) || 1; return a.map((x) => x / l); };

const one = get('seed');
if (one) {
  const t0 = performance.now();
  const s = grow(Number(one), { mine: get('mine'), lucky: get('lucky'), hidden: get('hidden') === undefined ? undefined : get('hidden') !== '0' });
  const t1 = performance.now();
  const mesh = meshPiece(s.field, { planes: [] }, []);
  const t2 = performance.now();
  const d = s.app.describe();
  console.log(`seed ${one}  ${MINES[s.def.mine].name}  ${s.def.skin}  ${weightKg(s.def, s.baked.volume).toFixed(2)} kg  unit ${s.def.unitCm.toFixed(1)} cm`);
  console.log(`  bake ${(t1 - t0).toFixed(0)} ms (n=${VOL})  mesh ${(t2 - t1).toFixed(0)} ms  verts ${mesh.positions.length / 3}  tris ${mesh.indices.length / 3}`);
  console.log(`  ${d.name}  z ${d.z.toFixed(2)}  green ${(d.gCover * 100).toFixed(0)}% @${d.gMean.toFixed(2)}  kind ${s.def.green.kind}  cracks ${s.def.cracks.length}  cells ${s.baked.cells.n}`);
  if (s.def.lucky) console.log(`  機緣: ${FINDS[s.def.lucky]}${s.def.heart ? `（藏在石心，皮下 ${(s.def.heart.d0 * s.def.unitCm).toFixed(1)} 公分起）` : '（皮上看得出來）'}`);
  console.log(`  traits: ${s.app.traits().join('、')}`);
  const e0 = s.app.estimate();
  console.log(`  ask ${money(s.app.askPrice)}  estimate ${money(e0.value)}  resale ${money(e0.offer)}  TRUE ${money(s.app.trueValue)}  賭性溢價 +${(s.app.hope * 100).toFixed(0)}%`);
  for (const [n, dd] of [[[1, 0, 0], 0], [[0, 0, 1], 0], [[0, 1, 0], 0], [[1, 0, 0], 0.4], [[1, 0, 0], -0.4]]) {
    const r = s.app.reveal(planePoints(s, n, dd));
    const e = s.app.estimate();
    console.log(`  cut n=${n} d=${dd}: estimate ${money(e.value)} offer ${money(e.offer)} cover ${(e.coverage * 100).toFixed(0)}%  saw z ${r.z.toFixed(2)} g ${r.g.toFixed(2)} cracks +${r.cracks}`);
  }
  console.log('  products', JSON.stringify(s.app.products(), (k, v) => (typeof v === 'number' ? Math.round(v) : v)));
  process.exit(0);
}

/** Flesh points a window would expose: a small disc just under the skin, on the +dir side. */
function windowPoints(s, dir, r) {
  const d = norm(dir);
  let t = 1.6;
  while (t > 0 && s.field.sd(d[0] * t, d[1] * t, d[2] * t) > 0) t -= 0.01;
  const deep = t - (s.def.skinT + s.def.fogT + 0.012);
  const a = Math.abs(d[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0];
  const u = norm(cross(d, a)), v = cross(d, u);
  const pts = [];
  for (let i = -6; i <= 6; i++) for (let j = -6; j <= 6; j++) {
    const x = (i / 6) * r, y = (j / 6) * r;
    if (x * x + y * y > r * r) continue;
    pts.push(d[0] * deep + u[0] * x + v[0] * y, d[1] * deep + u[1] * x + v[1] * y, d[2] * deep + u[2] * x + v[2] * y);
  }
  return pts;
}
const feeOf = (kind, price) => nice(Math.min(TUNING.fees[kind].max, Math.max(TUNING.fees[kind].min, price * TUNING.fees[kind].pct)));

// How a line of play pays, as money back per money put in.
const PLAYS = {
  '買了就轉手': () => [],
  '開一個窗就賣': (s) => [['window', windowPoints(s, [0.3, 0.6, 1], Math.min(0.34, 1.3 / s.def.unitCm))]],
  '切一刀就賣': (s) => [['cut', planePoints(s, [1, 0, 0], 0)]],
  '窗 + 三刀全解': (s) => [
    ['window', windowPoints(s, [0.3, 0.6, 1], Math.min(0.34, 1.3 / s.def.unitCm))],
    ['cut', planePoints(s, [1, 0, 0], 0)], ['cut', planePoints(s, [0, 0, 1], 0)], ['cut', planePoints(s, [1, 0, 0], 0.4)],
  ],
  // sell the moment the stone is in profit, otherwise keep opening it
  '見好就收': (s) => 'greedy',
};
// Counted twice: over every stone, and over those a fresh bankroll can actually buy.
const plays = {}, reach = {};
for (const k in PLAYS) { plays[k] = { paid: 0, back: 0, wins: 0, n: 0 }; reach[k] = { paid: 0, back: 0, wins: 0, n: 0 }; }

function playAll(seed) {
  for (const name in PLAYS) {
    const s = grow(seed);
    const price = nice(Math.max(300, s.app.askPrice));
    let paid = price, back;
    let steps = PLAYS[name](s);
    if (steps === 'greedy') {
      steps = PLAYS['窗 + 三刀全解'](s);
      back = null;
      for (const [kind, pts] of steps) {
        paid += feeOf(kind, price);
        s.app.reveal(pts);
        const offer = nice(s.app.estimate().offer);
        if (offer > paid) { back = offer; break; }
      }
      if (back === null) back = nice(s.app.estimate().offer);
    } else {
      for (const [kind, pts] of steps) { paid += feeOf(kind, price); s.app.reveal(pts); }
      back = nice(s.app.estimate().offer);
    }
    for (const p of price <= TUNING.startCash ? [plays[name], reach[name]] : [plays[name]]) {
      p.paid += paid; p.back += back; p.n++;
      if (back > paid) p.wins++;
    }
  }
}

const rows = {};
const finds = {}, rareNames = {};
const t0 = performance.now();
for (let i = 0; i < N; i++) {
  const s = grow(1000 + i * 7919);
  if (args.includes('--plays')) playAll(1000 + i * 7919);
  if (tail) {
    // one blind cut through the middle, then sell: the least a find pays
    const tag = s.def.lucky ? `${FINDS[s.def.lucky]}${s.def.heart && s.def.lucky !== 'glass' && s.def.lucky !== 'vein' ? '・藏' : ''}` : '一般';
    const d = s.app.describe();
    if (d.rare) rareNames[d.name.replace('（帶髒）', '')] = (rareNames[d.name.replace('（帶髒）', '')] || 0) + 1;
    const price = nice(Math.max(300, s.app.askPrice));
    const paid = price + feeOf('cut', price);
    const truth = s.app.trueValue / s.app.askPrice;
    s.app.reveal(planePoints(s, [1, 0, 0], 0));
    const back = nice(s.app.estimate().offer);
    for (const k of [tag, '全部']) {
      const f = finds[k] ??= { n: 0, reach: 0, paid: 0, back: 0, m: [], ask: [], truth: [] };
      f.n++; f.ask.push(price); f.truth.push(truth);
      if (price <= TUNING.startCash) { f.reach++; f.paid += paid; f.back += back; f.m.push(back / paid); }
    }
    continue; // the cut has changed what the market knows; the per-mine table below needs it untouched
  }
  const e0 = s.app.estimate();
  const row = rows[s.def.mine] ??= { n: 0, ask: 0, est: 0, tru: 0, win: 0, ratios: [], plain: [], kg: 0, best: 0, bestName: '' };
  row.n++; row.ask += s.app.askPrice; row.est += e0.value; row.tru += s.app.trueValue;
  row.kg += weightKg(s.def, s.baked.volume);
  const ratio = s.app.trueValue / s.app.askPrice;
  row.ratios.push(ratio);
  // calib is the fairness of a plain stone's price: finds, and the hope the market pays for them, are kept out of it
  if (!s.def.lucky) row.plain.push(ratio * (1 + s.app.hope));
  if (ratio > 1) row.win++;
  if (s.app.trueValue > row.best) { row.best = s.app.trueValue; row.bestName = s.app.describe().name; }
}
const secs = (performance.now() - t0) / 1000;
console.log(`${N} stones in ${secs.toFixed(1)} s (${((secs / N) * 1000).toFixed(0)} ms each, volume ${VOL})\n`);
if (tail) {
  const pc = (a, b) => `${((a / (b || 1)) * 100).toFixed(1)}%`;
  const q = (arr, p) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor(p * arr.length))] : 0);
  console.log('（「買得起」＝起始本金買得下；返還與倍數都只算買得起的，打法是從中間切一刀就賣）\n');
  console.log('機緣　　　　　　 出現率  買得起  開價中位   返還    贏    倍數中位   前10%   最高   全解真值/開價中位');
  for (const [k, f] of Object.entries(finds).sort((a, b) => b[1].n - a[1].n)) {
    for (const a of [f.m, f.ask, f.truth]) a.sort((x, y) => x - y);
    console.log(`${k.padEnd(8, '　')} ${pc(f.n, N).padStart(7)} ${pc(f.reach, f.n).padStart(7)} ${money(q(f.ask, 0.5)).padStart(9)} ${pc(f.back, f.paid).padStart(7)} ${pc(f.m.filter((m) => m > 1).length, f.reach).padStart(6)} `
      + `${q(f.m, 0.5).toFixed(2).padStart(8)} ${q(f.m, 0.9).toFixed(2).padStart(8)} ${q(f.m, 1).toFixed(1).padStart(6)} ${q(f.truth, 0.5).toFixed(2).padStart(10)}`);
  }
  const all = finds['全部'];
  const ge = (x) => pc(all.m.filter((m) => m >= x).length, all.reach), le = (x) => pc(all.m.filter((m) => m <= x).length, all.reach);
  console.log(`\n切一刀就賣的倍數：≥1.5 倍 ${ge(1.5)}　≥2 倍 ${ge(2)}　≥3 倍 ${ge(3)}　≥5 倍 ${ge(5)}　≥10 倍 ${ge(10)}　｜　≤0.5 倍 ${le(0.5)}　≤0.3 倍 ${le(0.3)}`);
  console.log(`\n叫得出名字的（佔全部石頭）：${Object.entries(rareNames).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${pc(v, N)}`).join('　')}`);
  process.exit(0);
}
console.log('mine      n   avg kg   avg ask   avg true   RTP    win%   median  p90     best');
const total = { ask: 0, tru: 0, n: 0, win: 0 };
const calib = {};
for (const [id, r] of Object.entries(rows)) {
  r.ratios.sort((a, b) => a - b);
  const q = (p) => r.ratios[Math.min(r.ratios.length - 1, Math.floor(p * r.ratios.length))];
  console.log(
    `${MINES[id].name.padEnd(6, '　')} ${String(r.n).padStart(4)}  ${(r.kg / r.n).toFixed(1).padStart(6)}  ${money(r.ask / r.n).padStart(8)}  ${money(r.tru / r.n).padStart(8)}  ` +
    `${(r.tru / r.ask).toFixed(2)}  ${((r.win / r.n) * 100).toFixed(0).padStart(4)}%  ${q(0.5).toFixed(2).padStart(6)}  ${q(0.9).toFixed(2).padStart(5)}  ${money(r.best)} ${r.bestName}`,
  );
  total.ask += r.ask; total.tru += r.tru; total.n += r.n; total.win += r.win;
  // trimmed: the handful of jackpots should not set the price of everything else
  r.plain.sort((a, b) => a - b);
  const cut = Math.floor(r.plain.length * 0.97);
  let sum = 0;
  for (let i = 0; i < cut; i++) sum += r.plain[i];
  calib[id] = +(((sum / (cut || 1)) * (TUNING.calib[id] ?? 1))).toFixed(3);
}
console.log(`\nall     ${String(total.n).padStart(4)}  RTP ${(total.tru / total.ask).toFixed(3)}  win ${((total.win / total.n) * 100).toFixed(0)}%`);
if (fit) console.log('\ncalib (trimmed mean of true/ask over plain stones, hope taken out, folded into the current table):\n', JSON.stringify(calib));
if (args.includes('--plays')) {
  const pc = (p) => `${((p.back / p.paid) * 100).toFixed(1).padStart(6)}%  ${((p.wins / p.n) * 100).toFixed(0).padStart(4)}%`;
  console.log(`\nline of play            every stone (${Object.values(plays)[0].n})    within a fresh bankroll (${Object.values(reach)[0].n})`);
  console.log('                        returned   wins     returned   wins');
  for (const name of Object.keys(plays)) console.log(`${name.padEnd(14, '　')} ${pc(plays[name])}     ${pc(reach[name])}`);
}
