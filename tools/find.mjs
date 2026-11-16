// Finds stall seeds whose first stone does something worth a screenshot.
//   node tools/find.mjs --want up      a cut through the middle that sends the price up hard
//   node tools/find.mjs --want down    ... or collapses it
//   node tools/find.mjs --want grade   high 種水 within a fresh bankroll
// The seed printed is a stall seed: open the game with ?seed=N&fixed=1 and pick stone 0.
import { makeStone, makeField } from '../src/stone/gen.js';
import { bakeVolume } from '../src/stone/bake.js';
import { createAppraiser } from '../src/stone/appraise.js';
import { MINES } from '../src/game/lore.js';
import { TUNING } from '../src/game/tuning.js';

const args = process.argv.slice(2);
const get = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const want = get('want', 'up');
const from = Number(get('from', 1)), count = Number(get('count', 400));

for (let seed = from; seed < from + count; seed++) {
  const def = makeStone(seed);
  const field = makeField(def);
  const app = createAppraiser(def, bakeVolume(field, 64), field);
  if (app.askPrice > TUNING.startCash || app.askPrice < 3000) continue;
  const before = app.estimate().offer;
  const pts = [];
  const fleshAt = def.skinT + def.fogT;
  for (let i = -60; i <= 60; i++) for (let j = -60; j <= 60; j++) {
    const y = i * 0.02, z = j * 0.02;
    if (-field.sd(0, y, z) > fleshAt) pts.push(0, y, z);
  }
  app.reveal(pts);
  const pct = (app.estimate().offer / before - 1) * 100;
  const d = app.describe();
  const hit = want === 'up' ? pct > 90 : want === 'down' ? pct < -50 : d.z > 0.75;
  if (hit) console.log(`seed ${seed}  ${MINES[def.mine].name}  ask ${Math.round(app.askPrice)}  cut x=0: ${pct.toFixed(0)}%  ${d.name}  true ${Math.round(app.trueValue)}`);
}
