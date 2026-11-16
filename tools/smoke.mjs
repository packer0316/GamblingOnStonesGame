// Plays the game end to end in a headless browser and checks the books.
//   npm run dev            (leave it running)
//   node tools/smoke.mjs   [--rounds 3] [--chrome path]
// Each round: pick a stone, buy it, rub, window, saw twice, sell. After every
// step the bankroll must equal what the ledger says it should.
import puppeteer from 'puppeteer-core';

const args = process.argv.slice(2);
const get = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const base = get('base', 'http://127.0.0.1:5183/');
const rounds = Number(get('rounds', 2));
const chrome = get('chrome', process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe');

const browser = await puppeteer.launch({
  executablePath: chrome, headless: true,
  args: ['--window-size=1280,720', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--mute-audio'],
  defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
const problems = [];
page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
await page.goto(`${base}?fixed=1`, { waitUntil: 'load' });
await page.waitForFunction('window.__ready || window.__error', { timeout: 90000 });
const bootError = await page.evaluate('window.__error');
if (bootError) { console.log('BOOT ERROR', bootError); await browser.close(); process.exit(1); }

const ev = (js) => page.evaluate(js);
const settle = (ms) => new Promise((r) => setTimeout(r, ms));
const idle = () => page.waitForFunction('!__game.game.state.busy', { timeout: 90000, polling: 100 });
let ok = true;
const check = (cond, msg) => { if (!cond) { ok = false; console.log('  FAIL', msg); } };

for (let r = 0; r < rounds; r++) {
  await idle();
  await settle(1200);
  const stall = await ev('__game.stall.map((s) => ({ title: s.title, price: s.price, kg: s.kg }))');
  const cash0 = await ev('__game.game.state.cash');
  // the cheapest stone the bankroll covers
  let pick = -1;
  stall.forEach((s, i) => { if (s.price <= cash0 && (pick < 0 || s.price < stall[pick].price)) pick = i; });
  check(pick >= 0, 'nothing on the stall is affordable');
  if (pick < 0) break;
  console.log(`round ${r + 1}: ${stall[pick].title}  ${stall[pick].kg.toFixed(2)} kg  ¥${stall[pick].price}  (cash ¥${cash0})`);
  await ev(`__game.inspect(${pick})`);
  await settle(1100);
  await ev('__game.buy()');
  await idle();
  let ledger = cash0 - stall[pick].price;
  check((await ev('__game.game.state.cash')) === ledger, 'cash after buying');
  check((await ev('__game.mode')) === 'bench', 'mode is bench after buying');

  const steps = [
    ['rub', `__game.windowAt([0.2, 0.7, 1], 'rub')`],
    ['window', `__game.windowAt([-0.6, 0.5, 0.8], 'window')`],
    ['cut', `__game.cutPlane([1, 0.1, 0.2], 0.02, 0)`],
    ['cut', `__game.cutPlane([0, 0.2, 1], 0.0, 0)`],
  ];
  for (const [kind, js] of steps) {
    const fee = await ev(`__game.game.fee('${kind}')`);
    const before = await ev('__game.stone.app.estimate().offer');
    const res = await ev(js);
    await idle();
    await settle(400);
    const after = await ev('__game.stone.app.estimate()');
    if (res && typeof res === 'object') {
      ledger -= fee;
      console.log(`  ${kind.padEnd(7)} fee ¥${fee}  offer ¥${Math.round(before)} -> ¥${Math.round(after.offer)}  (${res.pct >= 0 ? '+' : ''}${res.pct.toFixed(1)}%)  seen ${(after.coverage * 100).toFixed(0)}%  pieces ${await ev('__game.stone.pieces.length')}`);
    } else {
      console.log(`  ${kind.padEnd(7)} not done: ${res}`);
    }
    check((await ev('__game.game.state.cash')) === ledger, `cash after ${kind}`);
    check(Number.isFinite(after.offer) && after.offer > 0, `offer is a number after ${kind}`);
  }
  const truth = await ev('__game.stone.app.trueValue');
  const name = await ev('__game.stone.app.describe().name');
  await ev('(__game.sell(), 1)'); // resolves only when the result is dismissed, so do not wait on it
  await page.waitForFunction('__game.hud.modalOpen', { timeout: 20000 });
  const cash1 = await ev('__game.game.state.cash');
  console.log(`  sold for ¥${cash1 - ledger}; opened up it was ${name}, worth ¥${Math.round(truth)}`);
  check(cash1 > ledger, 'selling pays something');
  await page.evaluate(() => document.querySelector('[data-act=close-result]').click());
  await settle(800);
}
await idle();
check((await ev('__game.mode')) === 'market', 'back at the market at the end');
for (const p of problems) { ok = false; console.log('  FAIL', p); }
console.log(ok ? 'smoke: all good' : 'smoke: FAILED');
await browser.close();
process.exit(ok ? 0 : 1);
