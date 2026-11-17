// The stall: which stones are on the cloth, what the vendor asks for them,
// and what the vendor says to get you to pay it.
import { makeStone } from '../stone/gen.js';
import { StoneView } from '../stone/view.js';
import { MINES, SKINS } from './lore.js';
import { VOICES } from './patter.js';
import { nice } from './game.js';
import { rng } from '../stone/noise.js';

export const STALL_SIZE = 5;

function freshSeed() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] || 1;
}

/**
 * The vendor's patter in voice `V` (from patter.js): an opener, two remarks on
 * whatever the skin shows, and a closer. It is not to be trusted.
 */
export function pitchFor(stone, V) {
  const { def, app } = stone;
  const R = rng(def.seed ^ 0x7a11);
  const fill = (s) => s.replaceAll('{M}', MINES[def.mine].name).replaceAll('{S}', SKINS[def.skin].name);
  const say = (key) => fill(R.pick(V[key]));
  const visible = [...app.knownCracks].filter(Boolean).length;
  const cm = def.unitCm * 2; // the size the sheet shows
  const traits = [];
  if (app.shellMean.g > 0.2) traits.push('songStrong');
  else if (app.shellMean.g > 0.05) traits.push('songWeak');
  if (def.green.bands.length) traits.push('band');
  if (def.grain < 0.8) traits.push('fine');
  else if (def.grain > 1.15) traits.push('coarse');
  if (app.shellMean.blk > 0.12) traits.push('black');
  if (visible >= 3) traits.push('cracksMany');
  else if (visible === 0) traits.push('cracksNone');
  if (def.skin === 'waxShell' || def.skin === 'waterSkin') traits.push('thinSkin');
  if (cm >= 16) traits.push('big');
  else if (cm <= 9) traits.push('small');
  // which two get said changes from stone to stone; a plain skin at a fancy price always gets explained
  for (let i = traits.length - 1; i > 0; i--) {
    const j = Math.floor(R() * (i + 1));
    [traits[i], traits[j]] = [traits[j], traits[i]];
  }
  if (app.hope >= 0.3) traits.unshift('hope');
  return [say('open'), ...traits.slice(0, 2).map(say), say('close')].join('');
}

async function grow(seed, factory, noiseTex, opt) {
  const stone = await StoneView.create(makeStone(seed, opt), factory, noiseTex);
  stone.price = nice(Math.max(300, stone.app.askPrice));
  stone.title = `${MINES[stone.def.mine].name} · ${SKINS[stone.def.skin].name}`;
  return stone;
}

/**
 * Put `count` stones on the cloth. At least two are within reach of `cash`,
 * so the player is never left with nothing to do but stare.
 */
export async function stockStall(factory, noiseTex, cash, { count = STALL_SIZE, seed = 0, first, onStone } = {}) {
  const seeds = Array.from({ length: count }, (_, i) => (seed ? seed + i * 101 : freshSeed()));
  const stones = await Promise.all(seeds.map(async (s, i) => {
    const st = await grow(s, factory, noiseTex, i === 0 ? first : undefined); // `first` rigs stone 0, for look-dev
    onStone?.(st);
    return st;
  }));
  if (!seed) {
    const cheapMines = ['basan', 'nanqi', 'damakan', 'houjiang', 'mowanji'];
    for (let tries = 0; tries < 4; tries++) {
      if (stones.filter((s) => s.price <= cash).length >= 2) break;
      // swap the dearest stone for something from a cheaper mine
      let worst = 0;
      for (let i = 1; i < stones.length; i++) if (stones[i].price > stones[worst].price) worst = i;
      stones[worst].dispose();
      stones[worst] = await grow(freshSeed(), factory, noiseTex, { mine: cheapMines[tries % cheapMines.length], sizeScale: 0.8 });
    }
  }
  // the vendor talks each stone up a different way: no two on the cloth in the same voice
  const R = rng(seed || freshSeed());
  const voices = [...VOICES];
  for (let i = voices.length - 1; i > 0; i--) {
    const j = Math.floor(R() * (i + 1));
    [voices[i], voices[j]] = [voices[j], voices[i]];
  }
  stones.forEach((s, i) => { s.pitch = pitchFor(s, voices[i % voices.length]); });
  return stones;
}
