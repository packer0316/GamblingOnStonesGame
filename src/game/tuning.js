// Every number that decides how the gamble pays. Change, then run
// `npm run sim -- --plays` to see what it does to the returns.

export const TUNING = {
  startCash: 500000,
  // GM panel (top-right button, ` key) and the `?cash=` URL parameter. Off: the bankroll can
  // only move by playing, and every reload starts at `startCash`.
  gm: false,

  // ---- 機緣: how often a stone is one of the rare finds (帝王綠, 冰紫羅蘭, 春帶彩, a glass
  // heart under dull flesh, colour hidden in the core). Scales every mine's `lucky` odds in
  // lore.js: 0 switches them off, 2 doubles them. The market prices the chance in (`hope`
  // below), so the returns hold; what changes is how much of them rides on the big finds.
  luck: 1,
  // What a find hidden in the heart of a stone is worth to whoever cuts it open, in multiples
  // of what the stone would have cost as the plain thing its skin suggests. The market pays
  // this much extra for an unopened stone, times its odds of being that find -- the odds the
  // mine gives, sharpened by whether the flesh under the skin is as clear as that find needs.
  // Measured with `npm run sim -- --tail` (the 返還 of each hidden find, less the 94% a plain stone gives).
  hope: { imperial: 3.2, violet: 1.0, spring: 1.6, glass: 1.35, vein: 0.5 },
  hopeFade: 0.05, // share of the stone's heart that must be seen before the hope is settled (a window never gets there)

  // ---- how the stall prices a stone
  markup: 1.0, // asking price against the market's own first estimate
  priceNoise: 0.2, // spread (log) of how far the market misreads a stone from its skin
  readNoiseZ: 0.045, // how wrong the skin can be about 種水

  // ---- how the market reads a stone
  regress: 0.3, // how far a read off the skin is pulled toward the stone's average
  doubtGrade: 0.18, // ... and toward what the mine usually gives
  doubtGreen: 0.6, // share of skin-read colour still believed deep inside the stone
  trustFull: 0.92, // ... unless the colour is strong all over the skin: only 滿色 looks like that
  doubtYellow: 0.08, // depth (stone units) over which 翡 is expected to fade out
  hiddenRisk: 0.1, // discount for cracks nobody has seen yet
  // Share of the estimate a buyer pays for an unopened stone: buy one, do nothing,
  // sell it back, and this is what comes home (a dealer's spread, not a penalty).
  resale: 0.95,
  resaleCurve: 0.35, // how quickly that discount melts as the stone is opened up
  surpriseCells: 5, // exposed cells needed before a window is fully believed
  surprisePower: 0.62, // how hard a good or bad window re-rates the unseen rest
  // How far below an exposed face the market trusts what it saw. Kept shallow on
  // purpose: a window over skin-deep colour looks like a win (擦漲) and only the
  // saw finds out the colour never went in (切垮).
  sightBase: 0.06,
  sightClear: 0.14, // ... plus this much in glass-clear material

  // Per mine: scale on the unseen part so the first estimate is fair on average.
  // Fitted by `npm run sim -- --fit` (trimmed mean, so jackpots do not set everyday prices).
  calib: { nanqi: 0.929, basan: 1.117, mona: 1.101, damakan: 0.922, huika: 1.085, houjiang: 1.043, moxisha: 1.083, hpakant: 1.187, mowanji: 0.981 },

  // ---- what the workshop charges: a share of what the stone cost, between a floor and a ceiling.
  // Labour, not a tax on the gamble: a window and three cuts come to about 2% of the stone,
  // and no single job on any stone costs more than ¥2,000.
  fees: {
    rub: { pct: 0.0015, min: 10, max: 200 },
    window: { pct: 0.003, min: 20, max: 600 },
    bigWindow: { pct: 0.005, min: 30, max: 1000 },
    cut: { pct: 0.006, min: 40, max: 2000 },
  },
};
