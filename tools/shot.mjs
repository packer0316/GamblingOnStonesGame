// Headless screenshot helper for checking the look of the game.
//   node tools/shot.mjs --out front.png --q "seed=7&lab=1" [--w 1280 --h 720]
//                       [--wait 1200] [--eval "js to run in page"] [--after 800]
// Several shots in one browser session: repeat --out/--q (and --eval) pairs.
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const args = process.argv.slice(2);
const get = (name, def) => {
  const i = args.lastIndexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const all = (name) => args.flatMap((a, i) => (a === `--${name}` ? [args[i + 1]] : []));

const base = get('base', 'http://127.0.0.1:5183/');
const w = Number(get('w', 1280)), h = Number(get('h', 720));
const wait = Number(get('wait', 900));
const after = Number(get('after', 600));
const outs = all('out'), qs = all('q'), evals = all('eval');
const chrome = get('chrome', process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe');

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: true,
  args: [
    `--window-size=${w},${h}`, '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist',
    '--enable-webgl', '--hide-scrollbars', '--mute-audio', '--autoplay-policy=no-user-gesture-required',
  ],
  defaultViewport: { width: w, height: h, deviceScaleFactor: Number(get('dpr', 1)) },
});
const page = await browser.newPage();
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) console.log(`[page ${m.type()}]`, m.text()); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

for (let i = 0; i < outs.length; i++) {
  const url = base + (qs[i] ? `?${qs[i]}` : '');
  await page.goto(url, { waitUntil: 'load' });
  try {
    await page.waitForFunction('window.__ready || window.__error', { timeout: 60000 });
  } catch { console.log('timeout waiting for __ready'); }
  const err = await page.evaluate('window.__error');
  if (err) console.log('[boot error]', err);
  await new Promise((r) => setTimeout(r, wait));
  const out = resolve(outs[i]);
  mkdirSync(dirname(out), { recursive: true });
  if (evals[i]) {
    // not awaited: a sequence can then capture the action while it plays
    const pending = page.evaluate(evals[i]).then((r) => { if (r !== undefined) console.log('[eval]', JSON.stringify(r)); }, (e) => console.log('[eval error]', e.message));
    const seq = get('seq');
    if (seq) {
      // --seq "200,600,1200": screenshots at these ms after the eval starts
      // --until "js expr": start that clock only once the expression is true
      const until = get('until');
      if (until) await page.waitForFunction(until, { timeout: 90000, polling: 50 }).catch(() => console.log('until: timed out'));
      const t0 = Date.now();
      let n = 0;
      for (const ms of seq.split(',').map(Number)) {
        await new Promise((r2) => setTimeout(r2, Math.max(0, ms - (Date.now() - t0))));
        const p = out.replace(/\.png$/, `_${String(n++).padStart(2, '0')}.png`);
        await page.screenshot({ path: p });
        console.log('saved', p, `@${Date.now() - t0}ms`);
      }
      continue;
    }
    await Promise.race([pending, new Promise((r2) => setTimeout(r2, 30000))]);
    await new Promise((r2) => setTimeout(r2, after));
  }
  await page.screenshot({ path: out });
  console.log('saved', out);
}
if (get('gpu')) console.log(await page.evaluate(() => {
  const gl = document.createElement('canvas').getContext('webgl2');
  const e = gl.getExtension('WEBGL_debug_renderer_info');
  return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'n/a';
}));
await browser.close();
