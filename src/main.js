import * as THREE from 'three';
import { createStage } from './scene/stage.js';
import { createFactory } from './stone/factory.js';
import { createTileNoise } from './stone/tileNoise.js';
import { MAX_WINDOWS, MAX_PLANES, LIT } from './stone/material.js';
import { Animator, ease } from './util/anim.js';
import { createParticles } from './fx/particles.js';
import { createSfx } from './audio/sfx.js';
import { createTorch, createGrinder, createSaw } from './tools/rig.js';
import { createActions } from './game/actions.js';
import { createGame, nice, money } from './game/game.js';
import { stockStall } from './game/market.js';
import { gradeName } from './game/lore.js';
import { TUNING } from './game/tuning.js';
import { createHud } from './ui/hud.js';

const params = new URLSearchParams(location.search);
const TEST = params.has('fixed'); // deterministic stall and no adaptive resolution, for screenshots
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const TORCH_WHITE = new THREE.Color(1, 0.97, 0.9);

// What each grinding job removes: radius in cm, how deep, how long it takes.
// (`secs` is the time the burr spends walking over the window: long enough to watch the stone open under it)
const WINDOW_SPECS = {
  rub: { cm: 0.6, deep: (s) => s.fleshAt + 0.008, secs: 1.1, name: '擦皮' },
  window: { cm: 1.3, deep: (s) => s.fleshAt + 0.012, secs: 2.0, name: '開窗' },
  bigWindow: { cm: 2.4, deep: (s) => s.fleshAt + 0.02, secs: 3.1, name: '開大窗' },
};

async function boot() {
  const canvas = document.getElementById('stage');
  const stage = createStage(canvas);
  const anim = new Animator();
  const factory = createFactory();
  const noiseTex = createTileNoise();
  const fx = createParticles(stage.scene);
  const sfx = createSfx();
  sfx.preload();
  const torch = createTorch(stage.scene.environment), grinder = createGrinder(), saw = createSaw();
  stage.scene.add(torch.group, torch.light, grinder.group, saw.root);
  const actions = createActions({ stage, anim, fx, sfx, torch, grinder, saw });
  const game = createGame();
  if (params.has('cash')) game.state.cash = Number(params.get('cash')); // look-dev: afford anything

  let mode = 'market';
  let stall = [];
  let stone = null; // the stone being looked at or worked on
  let tool = null;
  let focus = null; // the piece the camera orbits
  let pendingCut = null;
  let marketBusy = false;
  let torchTrail = null; // where the torch last touched the stone, for its ticks (torchSlide)

  const MARKET_CAM = { pos: V(0, 3.0, 13.2), tgt: V(0, 0.75, 0) }; // low, like someone leaning over the stall, with the hall behind it
  const holding = () => game.state.holding;

  // ------------------------------------------------------------ HUD
  const hud = createHud(document.getElementById('hud'), {
    sfx,
    onPick: (i) => inspect(i),
    onHover: (i) => hoverStall(i),
    onRefresh: () => openMarket(),
    onRefill: () => { game.refill(); hud.message('本金已補充', 'good'); hud.showStall(stall, game.state.cash); hud.showRefill(false); },
    onMute: (m) => sfx.setMuted(m),
    onBuy: () => buy(),
    onBack: () => backToMarket(),
    onSell: () => sell(),
    onTool: (id) => setTool(id),
    onConfirmCut: (yes) => (yes ? doCut() : cancelCut()),
    onGmSet: (v) => gmCash(game.setCash(v === 'start' ? TUNING.startCash : v), '設為'),
    onGmAdd: (d) => gmCash(game.addCash(d), d >= 0 ? '加到' : '減到'),
  });
  game.onChange((state) => hud.sync(state));

  /** The bankroll was changed from the GM panel: everything that shows "can you afford it" follows. */
  function gmCash(cash, verb) {
    sfx.coins(false);
    hud.message(`GM：本金${verb} ${money(cash)}`, 'good');
    if (stall.length) {
      hud.showStall(stall, cash);
      hud.showRefill(stall.every((s) => s.price > cash));
    }
    if (mode === 'inspect' && stone) {
      hud.showTools('inspect', { price: stone.price, afford: cash >= stone.price });
      hud.setTool(tool);
    }
  }

  // ------------------------------------------------------------ market
  function stallPositions(stones) {
    let x = 0;
    const xs = [];
    stones.forEach((s, i) => { if (i) x += stones[i - 1].radius + s.radius + 0.55; xs.push(x); });
    const mid = x / 2;
    return xs.map((v) => V(v - mid, 0, -0.045 * (v - mid) * (v - mid)));
  }

  async function openMarket() {
    if (marketBusy) return;
    marketBusy = true;
    setTool(null);
    mode = 'market';
    hud.setMode('market');
    game.setBusy(true);
    hud.message('老闆正在擺貨…');
    stage.flyTo(MARKET_CAM.pos, MARKET_CAM.tgt, 1.0);
    stage.setOrbit(7, 19);
    await Promise.all(stall.map((s) => anim.tween(0.4, (k) => { s.root.position.y = -k * 0.2; s.root.scale.setScalar(1 - k); }, ease.inCubic)));
    for (const s of stall) s.dispose();
    // look-dev: ?seed=7&mine=mona&color=band&z=0.8 rigs the first stone on the cloth
    // ... and &lucky=imperial|violet|spring|glass|vein (&hidden=0|1) makes it one of the rare finds
    const rigged = ['mine', 'color', 'z', 'body', 'fog', 'black', 'lucky'].some((k) => params.has(k));
    const first = rigged
      ? {
        mine: params.get('mine') || undefined, color: params.get('color') || undefined, z: params.has('z') ? Number(params.get('z')) : undefined,
        body: params.get('body') || undefined, fog: params.get('fog') || undefined, black: params.has('black'),
        lucky: params.get('lucky') || undefined, hidden: params.has('hidden') ? params.get('hidden') !== '0' : undefined,
      }
      : undefined;
    stall = await stockStall(factory, noiseTex, game.state.cash, { seed: Number(params.get('seed')) || 0, first });
    sfx.cloth(); // the vendor shakes out the cloth for the new lot
    const spots = stallPositions(stall);
    stall.forEach((s, i) => {
      s.place(s.whole, new THREE.Quaternion(), 0, 0);
      s.root.position.copy(spots[i]);
      s.home = spots[i].clone();
      s.root.position.y = 4;
      s.root.visible = false;
      stage.scene.add(s.root);
      anim.wait(TEST ? 0 : 0.15 + i * 0.13).then(() => {
        s.root.visible = true;
        return anim.tween(TEST ? 0 : 0.5, (k) => { s.root.position.y = 4 * (1 - k); }, ease.outBounce);
      }).then(() => sfx.thud(Math.min(1, 0.3 + s.kg * 0.1)));
    });
    hud.showStall(stall, game.state.cash);
    hud.showRefill(stall.every((s) => s.price > game.state.cash));
    hud.message('');
    game.setBusy(false);
    marketBusy = false;
  }

  function hoverStall(i) {
    stall.forEach((s, j) => { s.whole.u.uHover.value = i === j ? 1 : 0; });
    hud.hoverCard(i);
  }

  function viewOf(s) {
    const r = s.radius, c = s.root.position;
    const tgt = V(c.x, r * 0.42, c.z);
    return { tgt, pos: tgt.clone().add(V(0.22, 0.5, 1).normalize().multiplyScalar(r * 3.3 + 1.4)) };
  }

  function inspect(i) {
    if (game.state.busy || mode !== 'market') return;
    stone = stall[i];
    focus = stone.whole;
    mode = 'inspect';
    hoverStall(-1);
    hud.setMode('inspect');
    hud.showSheet(stone, false);
    hud.showTools('inspect', { price: stone.price, afford: game.state.cash >= stone.price });
    hud.message('拖曳旋轉、滾輪縮放。打燈看看水頭，再決定買不買。');
    const v = viewOf(stone);
    stage.flyTo(v.pos, v.tgt, 0.9);
    stage.setOrbit(stone.radius * 1.5 + 0.4, stone.radius * 7 + 5);
    sfx.lean(true); // the player leans in over the felt: clothes, not a click
  }

  function backToMarket() {
    if (game.state.busy || mode !== 'inspect') return;
    setTool(null);
    stone = null; focus = null;
    mode = 'market';
    hud.setMode('market');
    stage.flyTo(MARKET_CAM.pos, MARKET_CAM.tgt, 0.9);
    stage.setOrbit(7, 19);
    sfx.lean(false);
  }

  async function buy() {
    if (game.state.busy || mode !== 'inspect') return;
    if (!game.buy(stone, stone.price)) { sfx.deny(); hud.message('本金不夠，這塊買不起', 'warn'); return; }
    setTool(null);
    sfx.pay();
    game.setBusy(true);
    mode = 'bench';
    hud.setMode('bench');
    hud.message(`成交！${money(stone.price)} 買下這塊${stone.title}`, 'good');
    // the rest of the stall is cleared away; the stone comes to the middle of the bench
    const rest = stall.filter((s) => s !== stone);
    stall = [];
    rest.forEach((s) => anim.tween(0.5, (k) => { s.root.position.z = s.home.z - k * 5; s.root.scale.setScalar(1 - k * 0.99); }, ease.inCubic).then(() => s.dispose()));
    const from = stone.root.position.clone();
    const view = actions.benchView(stone);
    stage.flyTo(view.pos, view.tgt, 1.0);
    sfx.lift();
    await anim.tween(0.9, (k) => { stone.root.position.lerpVectors(from, V(), k); stone.root.position.y = Math.sin(k * Math.PI) * 0.8; }, ease.inOutCubic);
    sfx.thud(Math.min(1, 0.4 + stone.kg * 0.1));
    stage.setOrbit(stone.radius * 1.3 + 0.4, stone.radius * 9 + 7);
    hud.showSheet(stone, true);
    showBenchTools();
    hud.log(`買下 ${money(stone.price)}`);
    refreshQuote();
    game.setBusy(false);
  }

  function showBenchTools() {
    hud.showTools('bench', { fees: { rub: game.fee('rub'), window: game.fee('window'), bigWindow: game.fee('bigWindow'), cut: game.fee('cut') } });
    hud.setTool(tool);
    refreshQuote();
  }

  function refreshQuote() {
    if (!stone || !holding()) return null;
    const est = stone.app.estimate();
    hud.setQuote({ value: est.value, offer: nice(est.offer), coverage: est.coverage, cost: game.cost });
    return est;
  }

  // ------------------------------------------------------------ tools
  function setTool(id) {
    if (id === 'flip') { doFlip(); return; }
    if (id && game.state.busy) return;
    if (id === tool) id = null;
    if (id && id !== 'torch' && mode !== 'bench') return;
    if (tool === 'torch') { actions.torchOff(stone); stage.darken(0); sfx.torch(false); torchTrail = null; }
    if (tool === 'cut') cancelCut();
    clearMarks();
    tool = id;
    if (tool === 'torch') { stage.darken(1); sfx.torch(true); hud.message('把燈壓在石頭上：光暈走多遠、什麼顏色、哪裡被擋住', 'good'); }
    if (tool === 'cut') hud.message('左鍵在石頭上拖一條線，就是下刀的位置（右鍵拖曳可轉視角）', 'good');
    if (tool && WINDOW_SPECS[tool]) hud.message(`點石頭上要${WINDOW_SPECS[tool].name}的位置`, 'good');
    // while marking a cut the left button draws; the right button always turns the view
    stage.controls.mouseButtons.LEFT = tool === 'cut' ? -1 : THREE.MOUSE.ROTATE;
    canvas.classList.toggle('tooling', !!tool);
    hud.setTool(tool);
  }

  function clearMarks() {
    if (!stone) return;
    for (const p of stone.pieces) { p.u.uMarkOn.value = 0; p.u.uLaserOn.value = 0; }
    hud.cutLine(null);
  }

  async function doFlip() {
    if (game.state.busy || !stone || mode === 'market') return;
    const piece = focus && stone.pieces.includes(focus) ? focus : stone.pieces[0];
    game.setBusy(true);
    if (tool === 'torch') { actions.torchOff(stone); torchTrail = null; }
    await actions.flip(stone, piece);
    game.setBusy(false);
  }

  // ------------------------------------------------------------ picking
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const setRay = (x, y) => {
    const r = canvas.getBoundingClientRect();
    ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, stage.camera);
  };
  const hitStone = (x, y) => {
    if (!stone) return null;
    setRay(x, y);
    return raycaster.intersectObjects(stone.pieces.map((p) => p.mesh), false)[0] || null;
  };
  const hitStall = (x, y) => {
    setRay(x, y);
    const hit = raycaster.intersectObjects(stall.map((s) => s.whole.mesh), false)[0];
    return hit ? stall.indexOf(hit.object.userData.piece.stone) : -1;
  };
  const depthAt = (hit) => {
    const d = hit.object.geometry.attributes.aDepth.array, f = hit.face;
    return (d[f.a] + d[f.b] + d[f.c]) / 3;
  };

  // ------------------------------------------------------------ what a reveal means
  function commentary(s) {
    if (s.weight <= 0) return ['只擦到霧層，還沒見肉'];
    const L = [];
    // the finds a dealer waits years for come first
    if (s.rich > 0.15) L.push(Math.abs(stone.def.green.hue) < 0.35 && s.z > 0.55 ? '帝王綠！濃、陽、正、勻，色吃滿了' : '出高色！一片化不開的辣綠');
    else if (s.violet > 0.25) L.push('紫羅蘭！冰透的春色，十春九豆的那一塊例外');
    else if (s.g > 0.28 && s.g > s.gGuess + 0.07) L.push('見綠！色比皮上的苗頭還濃');
    else if (s.gGuess > 0.14 && s.g < s.gGuess * 0.5) L.push('色沒吃進去——靠皮綠');
    else if (s.g > 0.1) L.push('有色，走進去了');
    const grade = gradeName(s.z);
    if (s.z > s.zGuess + 0.07) L.push(`種比預期老，是${grade}`);
    else if (s.z < s.zGuess - 0.07) L.push(`變種了，只有${grade}`);
    else L.push(`肉質：${grade}`);
    // part of the price was a bet on what the heart might hold, and the heart has now been seen
    const found = s.rich > 0.15 || s.violet > 0.25 || s.g > s.gGuess + 0.05 || s.pur > 0.3 || s.z > s.zGuess + 0.07;
    if (s.hopeLost > 0.1 && !found) L.unshift('石心沒有貨，賭性沒了');
    if (s.bigCracks) L.push('出了大裂，手鐲位懸了');
    else if (s.cracks) L.push(`出了 ${s.cracks} 條裂`);
    if (s.sh > 0.4) L.push('裡面一片碎裂');
    if (s.blk > 0.3) L.push('黑癬吃進來了');
    if (s.cot > 0.5 && s.z > 0.5) L.push('棉重');
    if (s.pur > 0.3 && s.violet <= 0.25) L.push('出春色');
    if (s.yel > 0.35) L.push('見翡色');
    return L.slice(0, 3);
  }

  function verdict(before, summary, kind, at, fee) {
    const est = refreshQuote();
    const pct = (est.offer / Math.max(before, 1) - 1) * 100;
    const cut = kind === 'cut';
    const flat = Math.abs(pct) < 3;
    const title = flat ? '持平' : pct > 0 ? (cut ? (pct >= 300 ? '一刀富' : pct >= 60 ? '大漲' : '切漲') : '擦漲') : cut ? (pct <= -45 ? '切垮' : '切跌') : '擦垮';
    const tier = pct >= 150 ? 3 : pct >= 60 ? 2 : pct >= 15 ? 1 : pct > -3 ? 0 : pct > -40 ? -1 : -2;
    hud.showDelta({ title, pct, lines: commentary(summary), tier });
    sfx.verdict(tier);
    if (tier >= 1) actions.celebrate(at, tier, stone.radius);
    else if (tier < 0) { stage.shake(0.03 * -tier); stage.flash(0.06, [0.4, 0.5, 0.45]); if (summary.cracks) sfx.crack(); }
    hud.log(`${cut ? '切一刀' : WINDOW_SPECS[kind].name} −${money(fee).slice(1)}　${title} ${pct >= 0 ? '+' : '−'}${Math.abs(pct).toFixed(0)}%`, flat ? '' : pct > 0 ? 'up' : 'down');
    return { pct, tier };
  }

  // ------------------------------------------------------------ window
  /** Radius of a grinding job in stone units: a real size in cm, kept workable on very small and very large stones. */
  const windowRadius = (kind) => Math.min(0.34, Math.max(0.09, WINDOW_SPECS[kind].cm / stone.def.unitCm));

  async function doWindow(hit, kind) {
    const spec = WINDOW_SPECS[kind];
    if (depthAt(hit) > stone.def.skinT) { hud.message('這裡已經見肉了，換個有皮的地方', 'warn'); sfx.deny(); return 'exposed'; }
    if (stone.windows.length >= MAX_WINDOWS) { hud.message('這塊石頭已經開滿窗了', 'warn'); sfx.deny(); return 'full'; }
    const fee = game.charge(kind);
    if (!fee) { hud.message('本金不夠付工錢', 'warn'); sfx.deny(); return 'funds'; }
    game.setBusy(true);
    sfx.fee();
    clearMarks();
    const before = stone.app.estimate().offer;
    const piece = hit.object.userData.piece;
    const r = windowRadius(kind);
    const at = hit.point.clone();
    try {
      await actions.grindWindow(hit, { r, depth: spec.deep(stone), secs: spec.secs });
    } catch (err) { console.error(err); }
    const summary = stone.app.reveal(stone.exposedPoints([piece]));
    const result = verdict(before, summary, kind, at, fee);
    game.setBusy(false);
    return result;
  }

  // ------------------------------------------------------------ cut
  let drag = null;
  function planeFromLine(a, b) {
    setRay(a.x, a.y);
    const da = raycaster.ray.direction.clone();
    setRay(b.x, b.y);
    const db = raycaster.ray.direction.clone();
    const nW = new THREE.Vector3().crossVectors(da, db);
    if (nW.lengthSq() < 1e-10) return null;
    nW.normalize();
    // the piece the line crosses
    let hit = null;
    for (const t of [0.5, 0.35, 0.65, 0.2, 0.8]) {
      hit = hitStone(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
      if (hit) break;
    }
    if (!hit) return null;
    const piece = hit.object.userData.piece;
    const nS = nW.clone().applyQuaternion(piece.holder.quaternion.clone().invert()).normalize();
    const d = nS.dot(piece.mesh.worldToLocal(stage.camera.position.clone()));
    return { piece, n: [nS.x, nS.y, nS.z], d };
  }

  function previewCut(a, b) {
    hud.cutLine(a, b);
    const plane = planeFromLine(a, b);
    for (const p of stone.pieces) p.u.uLaserOn.value = 0;
    if (plane) { plane.piece.u.uLaser.value.set(plane.n[0], plane.n[1], plane.n[2], plane.d); plane.piece.u.uLaserOn.value = 1; }
    return plane;
  }

  function proposeCut(plane) {
    if (!plane) { hud.message('這條線沒有畫在石頭上', 'warn'); clearMarks(); return 'miss'; }
    const share = stone.splitShare(plane.piece, plane.n, plane.d);
    if (share < 0.04 || share > 0.96) { hud.message('這一刀只削到皮，往裡面一點重畫', 'warn'); clearMarks(); sfx.deny(); return 'thin'; }
    if (plane.piece.planes.length >= MAX_PLANES || stone.pieces.length >= 8) { hud.message('已經切得夠碎了，再切只剩邊角料', 'warn'); clearMarks(); sfx.deny(); return 'max'; }
    pendingCut = plane;
    hud.cutLine(null);
    hud.confirmCut(true, game.fee('cut'));
    return 'ok';
  }

  function cancelCut() {
    pendingCut = null;
    hud.confirmCut(false);
    clearMarks();
  }

  async function doCut() {
    if (!pendingCut || game.state.busy) return 'none';
    const { piece, n, d } = pendingCut;
    const fee = game.charge('cut');
    if (!fee) { hud.message('本金不夠付工錢', 'warn'); sfx.deny(); cancelCut(); return 'funds'; }
    pendingCut = null;
    hud.confirmCut(false);
    hud.cutLine(null);
    setTool(null);
    game.setBusy(true);
    sfx.fee();
    const before = stone.app.estimate().offer;
    hud.message('師傅下刀了…');
    let halves = [];
    try {
      halves = await actions.sawCut(stone, piece, n, d);
      await actions.partHalves(stone, halves);
      // the moment nobody can call
      hud.message('');
      sfx.heartbeat();
      stage.spotlight(V(0, 0.6, 0), 0.55);
      await anim.wait(0.75);
      sfx.heartbeat();
      const view = actions.benchView(stone);
      stage.flyTo(view.pos, view.tgt, 1.1);
      await actions.layout(stone, 0.9);
      await actions.wash(stone, halves);
    } catch (err) {
      console.error(err);
    }
    stage.spotlight(null, 0);
    focus = halves[0] || stone.pieces[0];
    const summary = stone.app.reveal(stone.exposedPoints(halves));
    const result = verdict(before, summary, 'cut', V(0, 0.5, 0), fee);
    const view = actions.benchView(stone);
    stage.setOrbit(1.2, view.dist * 2.2 + 4);
    game.setBusy(false);
    return result;
  }

  // ------------------------------------------------------------ sell
  async function sell() {
    if (game.state.busy || mode !== 'bench' || !stone) return;
    setTool(null);
    game.setBusy(true);
    const est = stone.app.estimate();
    const sold = nice(est.offer);
    const h = holding();
    const { profit } = game.sell(sold);
    // the buyer's counter riffles out the money: longer for a bigger sum, a brighter bell on a profit
    sfx.countUp(Math.min(2.6, 0.7 + Math.log10(Math.max(sold, 100)) * 0.25), profit > 0);
    if (profit > h.price * 0.5) sfx.coins(true);
    const prod = stone.app.products();
    const names = { bracelet: '手鐲', pendant: '牌子・掛件', cabochon: '蛋面・戒面', small: '珠子・小件' };
    const products = Object.keys(names).filter((k) => prod[k].count > 0).map((k) => ({ name: names[k], count: prod[k].count, value: prod[k].value }));
    const desc = stone.app.describe();
    await hud.showResult({
      profit, price: h.price, fees: h.fees, sold, truth: stone.app.trueValue, name: desc.name, rare: desc.rare, products,
      note: `賣出時明朗度 ${Math.round(est.coverage * 100)}%。${prod.bestBracelet ? `最好的一支手鐲約 ${money(nice(prod.bestBracelet))}。` : stone.app.canBracelet ? '' : '個頭太小，出不了手鐲。'}`,
    });
    const old = stone;
    stone = null; focus = null;
    await anim.tween(0.4, (k) => old.root.scale.setScalar(1 - k * 0.99), ease.inCubic);
    old.dispose();
    game.setBusy(false);
    openMarket();
  }

  // ------------------------------------------------------------ pointer input
  stage.controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  // browsers keep audio suspended until the first gesture, wherever it lands
  window.addEventListener('pointerdown', () => sfx.unlock(), { capture: true });
  let down = null;

  /**
   * The torch is pressed to the stone, so sliding it over the skin makes its metal
   * head tick against the rough surface: once as it touches down, then every so
   * often along the way (an uneven stretch, in stone radii), more often and a
   * touch harder the faster it is moved. (`torchTrail` is declared with the state up top.)
   */
  function torchSlide(p) {
    const now = performance.now();
    const step = () => stone.radius * (0.12 + Math.random() * 0.3);
    if (!torchTrail) {
      torchTrail = { p: p.clone(), t: now, run: 0, next: step(), last: now };
      sfx.torchTap(0.55);
      return;
    }
    const d = p.distanceTo(torchTrail.p), dt = Math.max(8, now - torchTrail.t) / 1000;
    torchTrail.p.copy(p); torchTrail.t = now;
    torchTrail.run += d;
    if (torchTrail.run < torchTrail.next || now - torchTrail.last < 45) return;
    const speed = d / dt / stone.radius; // radii per second
    sfx.torchTap(Math.min(1, 0.2 + speed * 0.12));
    torchTrail.run = 0; torchTrail.next = step(); torchTrail.last = now;
  }
  canvas.addEventListener('pointerdown', (e) => {
    sfx.unlock();
    down = { x: e.clientX, y: e.clientY };
    if (tool === 'cut' && !game.state.busy && !pendingCut && e.button === 0) {
      drag = { a: { x: e.clientX, y: e.clientY } };
      canvas.setPointerCapture(e.pointerId);
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (game.state.busy || hud.modalOpen) return;
    if (drag) { previewCut(drag.a, { x: e.clientX, y: e.clientY }); return; }
    if (mode === 'market') {
      const i = e.buttons ? -1 : hitStall(e.clientX, e.clientY);
      hoverStall(i);
      canvas.classList.toggle('pointing', i >= 0);
      return;
    }
    if (e.buttons && tool !== 'torch') return; // orbiting
    const hit = hitStone(e.clientX, e.clientY);
    if (tool === 'torch') {
      if (hit) { actions.aimTorch(hit, 1, TORCH_WHITE); torchSlide(hit.point); } else { actions.torchOff(stone); torchTrail = null; }
    } else if (tool && WINDOW_SPECS[tool]) {
      for (const p of stone.pieces) p.u.uMarkOn.value = 0;
      if (hit) {
        const piece = hit.object.userData.piece;
        const r = windowRadius(tool);
        const p = stone.toStone(piece, hit.point);
        piece.u.uMark.value.set(p.x, p.y, p.z, r);
        piece.u.uMarkOn.value = 1;
      }
    }
  });
  canvas.addEventListener('pointerleave', () => { if (mode === 'market') hoverStall(-1); });
  canvas.addEventListener('pointerup', (e) => {
    if (drag) {
      const a = drag.a, b = { x: e.clientX, y: e.clientY };
      drag = null;
      if (Math.hypot(b.x - a.x, b.y - a.y) < 40) { hud.message('線太短了，拖長一點', 'warn'); clearMarks(); return; }
      proposeCut(previewCut(a, b));
      return;
    }
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    down = null;
    if (moved > 6 || game.state.busy || hud.modalOpen) return;
    if (mode === 'market') {
      const i = hitStall(e.clientX, e.clientY);
      if (i >= 0) inspect(i);
      return;
    }
    const hit = hitStone(e.clientX, e.clientY);
    if (!hit) return;
    if (tool && WINDOW_SPECS[tool]) { doWindow(hit, tool); return; }
    if (!tool && stone.pieces.length > 1) {
      // pick a piece up to look at it
      focus = hit.object.userData.piece;
      const tgt = focus.holder.position.clone();
      stage.flyTo(stage.camera.position.clone().add(tgt.clone().sub(stage.controls.target)), tgt, 0.5);
    }
  });

  window.addEventListener('keydown', (e) => {
    if (hud.modalOpen || e.repeat) return;
    if (e.target instanceof HTMLInputElement) return; // typing an amount, not picking a tool
    if (e.key === '`') { e.preventDefault(); hud.toggleGm(); return; }
    const k = e.key.toLowerCase();
    if (k === 'escape') { if (pendingCut) cancelCut(); else if (tool) setTool(null); else if (mode === 'inspect') backToMarket(); return; }
    if (mode === 'market') return;
    const map = { t: 'torch', f: 'flip', 1: 'rub', 2: 'window', 3: 'bigWindow', 4: 'cut' };
    if (map[k]) { sfx.click(); setTool(map[k]); }
  });

  // ------------------------------------------------------------ frame loop
  const clock = new THREE.Clock();
  const quality = { ratio: Math.min(window.devicePixelRatio, 1.5), acc: 0, n: 0 };
  const applyRatio = () => {
    stage.renderer.setPixelRatio(quality.ratio);
    stage.composer.setPixelRatio(quality.ratio);
    stage.composer.setSize(canvas.clientWidth, canvas.clientHeight);
  };
  if (!TEST) applyRatio();

  function frame() {
    const dt = Math.min(clock.getDelta(), 0.05);
    anim.update(dt);
    fx.update(dt);
    stage.update(dt);
    LIT.value = stage.roomLight; // the stones' own glints dim with the lamp
    stage.render();
    if (!TEST) {
      // hold the frame rate on integrated graphics by trading resolution
      quality.acc += dt; quality.n++;
      if (quality.acc > 1.5) {
        const fps = quality.n / quality.acc;
        const max = Math.min(window.devicePixelRatio, 1.5);
        if (fps < 38 && quality.ratio > 0.55) { quality.ratio = Math.max(0.55, quality.ratio * 0.85); applyRatio(); }
        else if (fps > 57 && quality.ratio < max) { quality.ratio = Math.min(max, quality.ratio * 1.07); applyRatio(); }
        quality.acc = 0; quality.n = 0;
      }
    }
    requestAnimationFrame(frame);
  }

  // Hooks for tools/shot.mjs and tools/smoke.mjs.
  window.__game = {
    stage, game, hud, actions, anim, fx, sfx, THREE,
    get stone() { return stone; }, get stall() { return stall; }, get mode() { return mode; }, get tool() { return tool; },
    inspect, buy, sell, setTool, backToMarket, openMarket, doCut, cancelCut,
    /** Ray from outside the stone inward along -dir; returns the hit on the focused stone. */
    probe(dir) {
      const d = V(...dir).normalize();
      const c = stone.pieces[0].holder.getWorldPosition(V());
      raycaster.set(c.clone().addScaledVector(d, 30), d.clone().multiplyScalar(-1));
      return raycaster.intersectObjects(stone.pieces.map((p) => p.mesh), false)[0] || null;
    },
    windowAt(dir, kind = 'window') { const hit = this.probe(dir); return hit ? doWindow(hit, kind) : 'miss'; },
    torchAt(dir) { const hit = this.probe(dir); if (tool !== 'torch') setTool('torch'); return hit ? actions.aimTorch(hit, 1, TORCH_WHITE) : 'miss'; },
    /** Propose and make a cut on a piece along a plane in stone space. */
    cutPlane(n, d, pieceIndex = 0) {
      const l = Math.hypot(...n);
      const r = proposeCut({ piece: stone.pieces[pieceIndex], n: n.map((v) => v / l), d });
      return r === 'ok' ? doCut() : r;
    },
  };

  frame();
  await openMarket();
  document.getElementById('loading').classList.add('done');
  window.__ready = true;
  if (params.get('pick')) inspect(Number(params.get('pick')));

  // Look-dev: ?rig=saw, ?rig=grinder or ?rig=torch stands a tool on the empty bench, lit, to be orbited.
  if (params.get('rig')) {
    for (const s of stall) s.root.visible = false;
    hud.setMode('bench');
    document.getElementById('hud').style.display = 'none';
    if (params.get('rig') === 'saw') {
      saw.root.visible = true;
      saw.root.scale.setScalar(1.4);
      saw.root.position.set(0, 0, 0);
      saw.head.position.y = 1.85;
      saw.setJaws(0.55, 0.55);
      saw.setSpin(Number(params.get('spin') || 0));
      saw.setCoolant(params.has('water'));
      stage.setOrbit(1, 40);
      stage.camera.position.set(4.6, 4.4, 7.4);
      stage.controls.target.set(-0.1, 2.0, -0.6);
    } else if (params.get('rig') === 'grinder') {
      // as it works: burr on the cloth, handpiece leaning back. &spin=1 blurs the burr, &zoom=1 goes in on the nose
      grinder.group.visible = true;
      grinder.group.position.set(0, 0.024, 0); // (its nose works below the surface it is cutting)
      grinder.group.rotation.set(0, -0.55, 0);
      if (grinder.setSpin) grinder.setSpin(Number(params.get('spin') || 0));
      stage.setOrbit(0.25, 14);
      if (params.has('zoom')) { stage.camera.position.set(0.55, 0.5, 0.75); stage.controls.target.set(0.05, 0.2, 0.12); }
      else if (params.has('far')) { stage.camera.position.set(3.4, 2.6, 3.6); stage.controls.target.set(0.5, 1.5, 1.0); }
      else { stage.camera.position.set(1.9, 1.25, 1.7); stage.controls.target.set(0.3, 0.75, 0.55); }
    } else {
      torch.group.visible = true;
      torch.set(params.has('on') ? 1 : 0, TORCH_WHITE);
      torch.group.position.set(0, 0.6, 0);
      torch.group.rotation.set(-0.5, 2.3, 0.2);
      // (the torch's metals are tuned for a dark room; lift them for the lamp)
      torch.group.traverse((o) => { if (o.material && o.material.envMapIntensity !== undefined) o.material.envMapIntensity = 1; });
      stage.setOrbit(0.4, 12);
      stage.camera.position.set(1.3, 1.2, 1.9);
      stage.controls.target.set(0.15, 0.55, 0.2);
    }
    stage.controls.update();
    // (the market's opening glide may still be running; this ends it where the camera now stands)
    stage.flyTo(stage.camera.position.clone(), stage.controls.target.clone(), 0.01);
  }
}

boot().catch((err) => {
  console.error(err);
  document.querySelector('.loading-text').textContent = String(err.message || err);
  window.__error = String(err.stack || err);
});
