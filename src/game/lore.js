// What a jade dealer carries in their head: the mines (場口) and what each is
// known for, the kinds of skin (皮殼), and the sayings of the trade.
//
// Every number here is a tendency, not a promise. A mine profile only shifts
// the odds of what grows inside a stone; the stone itself is generated in
// src/stone/gen.js and may contradict everything its skin suggests.

/** Skin types. Colours are linear-ish RGB, 0..1. */
export const SKINS = {
  whiteSand: {
    name: '白鹽沙皮', color: [0.80, 0.77, 0.70], stain: [0.62, 0.50, 0.33], dark: [0.33, 0.30, 0.26],
    grain: 1.0, rough: 0.96, wax: 0.0, speck: 0.55, thick: 1.0,
  },
  greySand: {
    name: '灰白沙皮', color: [0.60, 0.59, 0.55], stain: [0.50, 0.42, 0.30], dark: [0.24, 0.23, 0.21],
    grain: 0.9, rough: 0.94, wax: 0.0, speck: 0.5, thick: 1.0,
  },
  yellowSand: {
    name: '黃沙皮', color: [0.74, 0.57, 0.31], stain: [0.52, 0.31, 0.13], dark: [0.30, 0.20, 0.10],
    grain: 1.1, rough: 0.95, wax: 0.0, speck: 0.5, thick: 1.1,
  },
  redSand: {
    name: '紅沙皮', color: [0.46, 0.27, 0.19], stain: [0.33, 0.16, 0.1], dark: [0.17, 0.1, 0.07],
    grain: 0.95, rough: 0.9, wax: 0.12, speck: 0.4, thick: 1.0,
  },
  blackWax: {
    name: '黑烏沙', color: [0.075, 0.075, 0.07], stain: [0.19, 0.16, 0.11], dark: [0.02, 0.02, 0.02],
    grain: 0.7, rough: 0.62, wax: 0.55, speck: 0.3, thick: 0.9,
  },
  waxShell: {
    name: '蠟殼', color: [0.27, 0.15, 0.09], stain: [0.47, 0.36, 0.22], dark: [0.09, 0.05, 0.03],
    grain: 0.6, rough: 0.5, wax: 0.8, speck: 0.25, thick: 0.7,
  },
  waterSkin: {
    name: '水翻砂皮', color: [0.44, 0.43, 0.34], stain: [0.50, 0.38, 0.20], dark: [0.19, 0.19, 0.15],
    grain: 0.45, rough: 0.6, wax: 0.3, speck: 0.3, thick: 0.45,
  },
};

/**
 * Mines. Ranges are [lo, hi]; tables are {choice: weight}.
 *   size     cm per stone unit (a stone is roughly 2 units long)
 *   round    0 angular mountain stone .. 1 river pebble
 *   z        種水: mean and spread of the base grade (0 brick .. 1 glass)
 *   color    what kind of green is inside
 *   gPeak    how strong that green can get
 *   hue      -1 bluish .. +1 yellowish
 *   lucky    chance a stone is one of the rare finds (機緣, see makeStone), before TUNING.luck:
 *            imperial 帝王綠, violet 冰紫羅蘭, spring 春帶彩, glass 皮粗肉細, vein 藏色
 */
export const MINES = {
  moxisha: {
    name: '莫西沙', weight: 1.0,
    blurb: '白鹽沙皮，皮薄砂細。出高冰、玻璃種的無色與飄花料，行話「種老」；但棉多、裂多。',
    size: [4.6, 8.2], round: 0.45,
    skins: { whiteSand: 0.65, greySand: 0.35 }, skinT: [0.014, 0.03],
    z: { mean: 0.6, sd: 0.2 }, flip: 0.22,
    color: { none: 0.42, wisps: 0.3, band: 0.1, blobs: 0.1, full: 0.012, skinDeep: 0.068 },
    gPeak: [0.2, 0.62], hue: [-0.6, 0.15],
    body: { white: 0.45, clearWater: 0.2, blueWater: 0.2, grey: 0.15 },
    purple: 0.03, yellow: 0.1, black: 0.08,
    cotton: [0.25, 0.85], cottonType: { dots: 0.55, cloud: 0.45 },
    cracks: [2, 7], shatter: 0.25,
    fog: { white: 0.6, yellow: 0.2, none: 0.2 },
    lucky: { imperial: 0.012, violet: 0.04, spring: 0.012, glass: 0.04, vein: 0.022 },
  },
  mona: {
    name: '木那', weight: 1.0,
    blurb: '「海天一色，點點雪花」。黃、白鹽沙皮，種水足、色偏淡而勻，內部常帶雪花棉。',
    size: [5.0, 9.5], round: 0.4,
    skins: { yellowSand: 0.55, whiteSand: 0.45 }, skinT: [0.018, 0.036],
    z: { mean: 0.57, sd: 0.17 }, flip: 0.15,
    color: { none: 0.3, wisps: 0.18, band: 0.14, blobs: 0.1, full: 0.2, skinDeep: 0.08 },
    gPeak: [0.18, 0.6], hue: [-0.15, 0.4],
    body: { white: 0.35, clearWater: 0.45, blueWater: 0.05, grey: 0.15 },
    purple: 0.04, yellow: 0.18, black: 0.05,
    cotton: [0.35, 0.9], cottonType: { dots: 0.85, cloud: 0.15 },
    cracks: [1, 5], shatter: 0.15,
    fog: { white: 0.45, yellow: 0.4, none: 0.15 },
    lucky: { imperial: 0.03, violet: 0.06, spring: 0.018, glass: 0.03, vein: 0.026 },
  },
  huika: {
    name: '會卡', weight: 1.0,
    blurb: '皮薄如紙，常帶蠟殼，打燈透。色偏藍、底偏灰，種水變化大，「十會卡九裂」。',
    size: [4.6, 9.0], round: 0.6,
    skins: { waxShell: 0.45, waterSkin: 0.3, greySand: 0.25 }, skinT: [0.008, 0.02],
    z: { mean: 0.5, sd: 0.22 }, flip: 0.35,
    color: { none: 0.25, wisps: 0.2, band: 0.2, blobs: 0.17, full: 0.03, skinDeep: 0.15 },
    gPeak: [0.3, 0.8], hue: [-0.9, -0.1],
    body: { white: 0.2, blueWater: 0.25, grey: 0.4, oil: 0.15 },
    purple: 0.03, yellow: 0.15, black: 0.12,
    cotton: [0.1, 0.6], cottonType: { dots: 0.3, cloud: 0.7 },
    cracks: [4, 10], shatter: 0.45,
    fog: { white: 0.3, yellow: 0.3, none: 0.4 },
    lucky: { imperial: 0.025, violet: 0.04, spring: 0.015, glass: 0.034, vein: 0.03 },
  },
  damakan: {
    name: '大馬坎', weight: 0.9,
    blurb: '半山半水石，黃紅皮、個頭小。霧厚，常見黃霧紅霧，出黃加綠與紅翡，底偏灰。',
    size: [3.2, 5.6], round: 0.8,
    skins: { redSand: 0.5, yellowSand: 0.35, waterSkin: 0.15 }, skinT: [0.014, 0.03],
    z: { mean: 0.5, sd: 0.16 }, flip: 0.15,
    color: { none: 0.3, wisps: 0.12, band: 0.2, blobs: 0.24, full: 0.03, skinDeep: 0.11 },
    gPeak: [0.3, 0.85], hue: [-0.2, 0.6],
    body: { white: 0.35, grey: 0.45, oil: 0.2 },
    purple: 0.03, yellow: 0.7, black: 0.1,
    cotton: [0.1, 0.5], cottonType: { dots: 0.3, cloud: 0.7 },
    cracks: [1, 5], shatter: 0.2,
    fog: { yellow: 0.5, red: 0.4, white: 0.1 },
    lucky: { imperial: 0.04, violet: 0.04, spring: 0.03, glass: 0.016, vein: 0.038 },
  },
  mowanji: {
    name: '莫灣基', weight: 0.9,
    blurb: '黑烏沙。賭色的場口，容易出滿綠高色，但種偏嫩、底灰帶髒，黑癬會「吃綠」。',
    size: [4.5, 8.5], round: 0.5,
    skins: { blackWax: 1 }, skinT: [0.014, 0.03],
    z: { mean: 0.36, sd: 0.17 }, flip: 0.2,
    color: { none: 0.2, wisps: 0.05, band: 0.27, blobs: 0.2, full: 0.1, skinDeep: 0.18 },
    gPeak: [0.45, 1.0], hue: [-0.3, 0.3],
    body: { white: 0.2, grey: 0.5, oil: 0.3 },
    purple: 0.02, yellow: 0.08, black: 0.55,
    cotton: [0.1, 0.5], cottonType: { dots: 0.2, cloud: 0.8 },
    cracks: [3, 8], shatter: 0.35,
    fog: { black: 0.45, white: 0.2, none: 0.35 },
    lucky: { imperial: 0.075, violet: 0.025, spring: 0.012, glass: 0.014, vein: 0.045 },
  },
  hpakant: {
    name: '帕敢', weight: 0.7,
    blurb: '最老的名場口。皮殼緊、種色均衡，高種高色都出過，個頭大，價錢也從不便宜。',
    size: [6.0, 11.0], round: 0.5,
    skins: { yellowSand: 0.4, whiteSand: 0.25, blackWax: 0.35 }, skinT: [0.016, 0.034],
    z: { mean: 0.56, sd: 0.2 }, flip: 0.15,
    color: { none: 0.25, wisps: 0.15, band: 0.24, blobs: 0.17, full: 0.07, skinDeep: 0.12 },
    gPeak: [0.35, 0.95], hue: [-0.25, 0.3],
    body: { white: 0.5, clearWater: 0.15, grey: 0.25, oil: 0.1 },
    purple: 0.05, yellow: 0.15, black: 0.15,
    cotton: [0.1, 0.6], cottonType: { dots: 0.4, cloud: 0.6 },
    cracks: [1, 6], shatter: 0.2,
    fog: { white: 0.5, yellow: 0.25, black: 0.1, none: 0.15 },
    lucky: { imperial: 0.065, violet: 0.07, spring: 0.03, glass: 0.024, vein: 0.034 },
  },
  nanqi: {
    name: '南奇', weight: 0.8,
    blurb: '黃皮、黑皮的半山半水石。色辣、色陽，但裂多、底髒，取件要避裂。',
    size: [3.6, 6.5], round: 0.7,
    skins: { yellowSand: 0.45, blackWax: 0.3, waterSkin: 0.25 }, skinT: [0.01, 0.026],
    z: { mean: 0.47, sd: 0.17 }, flip: 0.2,
    color: { none: 0.15, wisps: 0.08, band: 0.3, blobs: 0.27, full: 0.06, skinDeep: 0.14 },
    gPeak: [0.5, 1.0], hue: [0.0, 0.5],
    body: { white: 0.35, grey: 0.45, oil: 0.2 },
    purple: 0.02, yellow: 0.25, black: 0.3,
    cotton: [0.1, 0.5], cottonType: { dots: 0.3, cloud: 0.7 },
    cracks: [4, 10], shatter: 0.5,
    fog: { yellow: 0.35, white: 0.25, none: 0.4 },
    lucky: { imperial: 0.055, violet: 0.03, spring: 0.015, glass: 0.014, vein: 0.045 },
  },
  houjiang: {
    name: '後江', weight: 0.7,
    blurb: '小顆水石，皮薄、種老。色陽且「翻色」，做戒面一流；個頭太小，出不了手鐲。',
    size: [2.2, 3.6], round: 0.9,
    skins: { waterSkin: 0.7, greySand: 0.3 }, skinT: [0.012, 0.024],
    z: { mean: 0.64, sd: 0.16 }, flip: 0.1,
    color: { none: 0.15, wisps: 0.1, band: 0.25, blobs: 0.3, full: 0.1, skinDeep: 0.1 },
    gPeak: [0.5, 1.0], hue: [-0.1, 0.45],
    body: { white: 0.5, clearWater: 0.25, grey: 0.25 },
    purple: 0.02, yellow: 0.12, black: 0.1,
    cotton: [0.05, 0.4], cottonType: { dots: 0.5, cloud: 0.5 },
    cracks: [3, 9], shatter: 0.4,
    fog: { white: 0.4, yellow: 0.2, none: 0.4 },
    lucky: { imperial: 0.065, violet: 0.04, spring: 0.015, glass: 0.021, vein: 0.038 },
  },
  basan: {
    name: '八三', weight: 0.8,
    blurb: '新場口的山石，塊大、皮薄近乎無皮。種嫩水短，常帶春色；多是公斤料，偶有驚喜。',
    size: [6.5, 12.0], round: 0.15,
    skins: { greySand: 0.6, whiteSand: 0.4 }, skinT: [0.006, 0.014],
    z: { mean: 0.22, sd: 0.13 }, flip: 0.18,
    color: { none: 0.45, wisps: 0.05, band: 0.2, blobs: 0.2, full: 0.02, skinDeep: 0.08 },
    gPeak: [0.2, 0.7], hue: [-0.2, 0.4],
    body: { white: 0.6, grey: 0.4 },
    purple: 0.5, yellow: 0.1, black: 0.1,
    cotton: [0.3, 0.8], cottonType: { dots: 0.2, cloud: 0.8 },
    cracks: [2, 7], shatter: 0.3,
    fog: { none: 0.7, white: 0.3 },
    lucky: { imperial: 0.012, violet: 0.12, spring: 0.045, glass: 0.014, vein: 0.022 },
  },
};

export const FOGS = {
  none: { name: '無霧', color: [0.8, 0.8, 0.76] },
  white: { name: '白霧', color: [0.9, 0.9, 0.86] },
  yellow: { name: '黃霧', color: [0.83, 0.6, 0.2] },
  red: { name: '紅霧', color: [0.62, 0.2, 0.08] },
  black: { name: '黑霧', color: [0.1, 0.1, 0.1] },
};

export const BODIES = {
  white: { name: '白底', color: [0.84, 0.85, 0.81], q: 1.0 },
  grey: { name: '灰底', color: [0.55, 0.58, 0.57], q: 0.62 },
  oil: { name: '油青底', color: [0.31, 0.42, 0.37], q: 0.72 },
  blueWater: { name: '藍水', color: [0.56, 0.74, 0.79], q: 1.2 },
  clearWater: { name: '晴水', color: [0.66, 0.84, 0.71], q: 1.3 },
};

/** 種水 grades, lowest first. `at` is the lower bound of the grade. */
export const GRADES = [
  { at: 0.0, name: '磚頭料' },
  { at: 0.12, name: '豆種' },
  { at: 0.28, name: '糯種' },
  { at: 0.45, name: '糯冰種' },
  { at: 0.6, name: '冰種' },
  { at: 0.78, name: '高冰種' },
  { at: 0.9, name: '玻璃種' },
];
export function gradeName(z) {
  let name = GRADES[0].name;
  for (const g of GRADES) if (z >= g.at) name = g.name;
  return name;
}

/** Sayings shown on the ticker; each is a real rule of thumb of the trade. */
export const SAYINGS = [
  '一刀窮，一刀富，一刀披麻布。',
  '神仙難斷寸玉。',
  '擦漲不算漲，切漲才算漲。',
  '寧買一線，不買一片。',
  '不識場口，不玩賭石。',
  '多看少買，多擦少切。',
  '龍到處有水——有色的地方，種水往往也好。',
  '冷眼觀煞：黑癬吃綠，癬下的色不一定保得住。',
  '砂細種老，砂粗種嫩；先摸皮殼再打燈。',
  '無綹不遮花：雕花多的地方，底下常是裂。',
  '十春九豆：紫羅蘭十塊有九塊種嫩。',
  '松花是色的苗頭，蟒帶是色的路。',
  '打燈看水頭：光暈走得遠，種才老。',
  '窗口越小，膽子要越大。',
  '裂怕橫，不怕順；順著裂下刀，少賠一半。',
  '白霧底淨，黃霧帶翡，紅霧底灰，黑霧賭高色。',
];
