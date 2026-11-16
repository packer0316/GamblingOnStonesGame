// The stall: which stones are on the cloth, what the vendor asks for them,
// and what the vendor says to get you to pay it.
import { makeStone } from '../stone/gen.js';
import { StoneView } from '../stone/view.js';
import { MINES, SKINS } from './lore.js';
import { nice } from './game.js';
import { rng } from '../stone/noise.js';

export const STALL_SIZE = 5;

function freshSeed() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] || 1;
}

/** The vendor's patter. It leans on whatever the skin shows -- and is not to be trusted. */
export function pitchFor(stone) {
  const { def, app } = stone;
  const R = rng(def.seed ^ 0x7a11);
  const M = MINES[def.mine];
  const visible = [...app.knownCracks].filter(Boolean).length;
  const lines = [];
  lines.push(R.pick([
    `正宗${M.name}的料，我自己上山收的。`,
    `${M.name}老坑，這種皮殼現在很難收到了。`,
    `老闆好眼光，這塊${M.name}今天剛到。`,
    `這塊${M.name}放我這三天，已經五個人問過了。`,
  ]));
  // a plain-looking stone at a fancy price: say why
  if (app.hope >= 0.3) lines.push(R.pick([`${M.name}出這種水頭的不多，行家都賭它石心有貨，價錢才站在這。`, '別看皮上沒東西，這種料十塊裡總有一塊切出高貨，賭性在這。']));
  if (app.shellMean.g > 0.2) lines.push(R.pick(['你看這松花，一片一片的，色絕對吃進去了！', '松花這麼濃，底下沒有綠我頭給你。']));
  else if (app.shellMean.g > 0.05) lines.push(R.pick(['皮上有松花，賭它裡面走色。', '零星有點松花，賭個色根不過分吧。']));
  if (def.green.bands.length) lines.push('這條蟒帶纏過去，色就跟著蟒走。');
  if (def.grain < 0.8) lines.push(R.pick(['你摸這砂，又細又緊，種老。', '皮殼這麼緊，裡面起碼冰種起跳。']));
  else if (def.grain > 1.15) lines.push('砂是粗了點，但個頭大，手鐲位夠。');
  if (app.shellMean.blk > 0.12) lines.push('有點癬沒關係，癬下常有高色。');
  if (visible >= 3) lines.push(R.pick(['裂是有幾條，都是皮上的，不進去。', '有裂才便宜嘛，避開裂照樣出牌子。']));
  else if (visible === 0) lines.push('整塊找不到一條裂，完美。');
  if (def.skin === 'waxShell' || def.skin === 'waterSkin') lines.push('皮這麼薄，你自己打燈看，水頭多長。');
  lines.push(R.pick(['價錢好談，但真的沒什麼空間了。', '賭石嘛，一刀下去誰也說不準。', '你要是切漲了，記得回來請我喝茶。', '我開這個價，已經是交朋友了。']));
  return lines.slice(0, 4).join('');
}

async function grow(seed, factory, noiseTex, opt) {
  const stone = await StoneView.create(makeStone(seed, opt), factory, noiseTex);
  stone.price = nice(Math.max(300, stone.app.askPrice));
  stone.pitch = pitchFor(stone);
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
  return stones;
}
