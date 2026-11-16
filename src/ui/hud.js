// Everything drawn over the bench: the bankroll, the stall's price cards, the
// stone's sheet, the tool rack, the market quote and the verdict on each cut.
import { money, parseMoney } from '../game/game.js';
import { MINES, SKINS, SAYINGS } from '../game/lore.js';

const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

const TOOLS = [
  { id: 'torch', name: '打燈', hint: '壓燈看水頭與色', key: 'T', free: true },
  { id: 'rub', name: '擦皮', hint: '擦一小口，淺', key: '1' },
  { id: 'window', name: '開窗', hint: '磨掉皮殼見肉', key: '2' },
  { id: 'bigWindow', name: '開大窗', hint: '看得多，也賭得大', key: '3' },
  { id: 'cut', name: '切一刀', hint: '在石頭上畫線下刀', key: '4' },
  { id: 'flip', name: '翻面', hint: '看看底下', key: 'F', free: true, instant: true },
];

export function createHud(root, cb) {
  root.innerHTML = '';
  const top = el('div', 'top', `
    <div class="brand">一刀窮 · 一刀富<small>緬甸翡翠原石</small></div>
    <div class="cash"><label>本金</label><b>¥0</b><i class="cash-delta"></i></div>
    <div class="top-btns"><button data-act="gm" title="GM 面板（快捷鍵 \`）">GM</button><button data-act="rules">行話</button><button data-act="mute">音效 開</button></div>`);
  // GM panel: set the bankroll to anything, or nudge it by a fixed amount.
  const GM_STEPS = [1e4, 1e5, 1e6, 1e7, 1e8, 1e9];
  const stepLabel = (v) => (v >= 1e8 ? `${v / 1e8} 億` : `${v / 1e4} 萬`);
  const gm = el('div', 'gm hidden', `
    <h3>GM · 本金</h3>
    <div class="gm-now">目前 <b>¥0</b></div>
    <div class="gm-row"><input type="text" inputmode="decimal" spellcheck="false" autocomplete="off" placeholder="例：5000000、500萬、1.5億、+50萬" /><button data-act="gm-set" class="gm-go">設定</button></div>
    <div class="gm-grid">${GM_STEPS.map((v) => `<button data-act="gm-add" data-v="${v}">+${stepLabel(v)}</button>`).join('')}</div>
    <div class="gm-grid minus">${GM_STEPS.map((v) => `<button data-act="gm-add" data-v="${-v}">−${stepLabel(v)}</button>`).join('')}</div>
    <div class="gm-grid two"><button data-act="gm-to" data-v="0">歸零</button><button data-act="gm-to" data-v="start">回到起始本金</button></div>
    <div class="gm-foot"><span>直接輸入是設定；前面加 + 或 − 是加減</span><button data-act="gm">關閉</button></div>`);
  const gmInput = gm.querySelector('input');
  const gmNow = gm.querySelector('.gm-now b');
  const stall = el('div', 'stall');
  const stallBar = el('div', 'stall-bar', '<span>今日到貨 — 點一塊上手細看，打燈免費</span><button data-act="refresh">換一批貨</button><button data-act="refill" class="hidden">補充本金</button>');
  const sheet = el('div', 'sheet hidden');
  const tools = el('div', 'tools hidden');
  const msg = el('div', 'msg');
  const saying = el('div', 'saying');
  const delta = el('div', 'delta');
  const confirm = el('div', 'confirm hidden', '<span></span><button data-act="cut-yes" class="go">下刀</button><button data-act="cut-no">取消</button>');
  const modal = el('div', 'modal hidden');
  const rules = el('div', 'rules hidden');
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('class', 'cutline');
  const line = document.createElementNS(svgNS, 'line');
  svg.appendChild(line);
  root.append(top, stall, stallBar, sheet, tools, msg, saying, delta, confirm, svg, modal, rules, gm);

  function toggleGm(show = gm.classList.contains('hidden')) {
    gm.classList.toggle('hidden', !show);
    if (show) { rules.classList.add('hidden'); gmInput.value = ''; gmInput.classList.remove('bad'); gmInput.focus(); }
    else gmInput.blur();
  }
  function submitGm() {
    const amount = parseMoney(gmInput.value);
    if (!amount) { gmInput.classList.add('bad'); cb.sfx.deny(); return; }
    gmInput.classList.remove('bad');
    gmInput.value = '';
    if (amount.relative) cb.onGmAdd(amount.value); else cb.onGmSet(amount.value);
  }
  gmInput.addEventListener('keydown', (e) => {
    e.stopPropagation(); // digits typed here are an amount, not tool shortcuts
    if (e.key === 'Enter') submitGm();
    else if (e.key === 'Escape' || e.key === '`') { e.preventDefault(); toggleGm(false); }
  });
  gmInput.addEventListener('input', () => gmInput.classList.remove('bad'));

  rules.innerHTML = `<h3>行話小抄</h3>
    <p><b>種水</b>　質地的細膩與通透：豆種 → 糯種 → 冰種 → 玻璃種，越往後越值錢。</p>
    <p><b>松花・蟒帶</b>　皮上的綠色斑與帶狀紋，是裡面有色的徵兆——但色不一定吃得進去。</p>
    <p><b>癬</b>　皮上的黑斑。癬會吃綠，也可能伴著高色。</p>
    <p><b>霧</b>　皮與肉之間的一層。白霧底淨、黃霧帶翡、紅霧底灰、黑霧賭高色。</p>
    <p><b>裂・綹・棉</b>　裂決定能不能出手鐲；棉是玉肉裡的白絮，冰種以上才看得見。</p>
    <p><b>打燈</b>　光暈走得越遠種越老；光被擋住的地方是裂；光的顏色就是肉的顏色。</p>
    <p><b>擦漲・切漲・切垮</b>　每一次見肉，市場都會重新出價。見好就收，還是再賭一刀？</p>
    <button data-act="rules">知道了</button>`;

  // ---------------------------------------------------------------- top bar
  const cashEl = top.querySelector('.cash b');
  const cashDelta = top.querySelector('.cash-delta');
  let shownCash = null, cashAnim = 0;
  function setCash(v) {
    if (shownCash === null) { shownCash = v; cashEl.textContent = money(v); return; }
    if (v === shownCash) return;
    const from = shownCash, diff = v - from;
    shownCash = v;
    cashDelta.textContent = `${diff > 0 ? '+' : '−'}${money(Math.abs(diff)).slice(1)}`;
    cashDelta.className = `cash-delta show ${diff > 0 ? 'up' : 'down'}`;
    clearTimeout(cashDelta._t);
    cashDelta._t = setTimeout(() => { cashDelta.className = 'cash-delta'; }, 1600);
    const id = ++cashAnim, t0 = performance.now(), dur = Math.min(1400, 300 + Math.abs(diff) / 200);
    const step = (t) => {
      if (id !== cashAnim) return;
      const k = Math.min((t - t0) / dur, 1);
      cashEl.textContent = money(from + diff * (1 - Math.pow(1 - k, 3)));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    cb.sfx.click();
    if (act === 'rules') { rules.classList.toggle('hidden'); gm.classList.add('hidden'); }
    else if (act === 'gm') toggleGm();
    else if (act === 'gm-set') submitGm();
    else if (act === 'gm-add') cb.onGmAdd(Number(b.dataset.v));
    else if (act === 'gm-to') cb.onGmSet(b.dataset.v === 'start' ? 'start' : Number(b.dataset.v));
    else if (act === 'mute') { const m = !cb.sfx.muted; cb.onMute(m); b.textContent = m ? '音效 關' : '音效 開'; }
    else if (act === 'refresh') cb.onRefresh();
    else if (act === 'refill') cb.onRefill();
    else if (act === 'cut-yes') cb.onConfirmCut(true);
    else if (act === 'cut-no') cb.onConfirmCut(false);
    else if (act === 'buy') cb.onBuy();
    else if (act === 'back') cb.onBack();
    else if (act === 'sell') cb.onSell();
    else if (act === 'tool') cb.onTool(b.dataset.tool);
    else if (act === 'close-result') hud._closeResult?.();
  });

  // ---------------------------------------------------------------- stall cards
  function showStall(stones, cash) {
    stall.innerHTML = '';
    stones.forEach((s, i) => {
      const card = el('button', 'card', `
        <div class="card-mine">${MINES[s.def.mine].name}</div>
        <div class="card-skin">${SKINS[s.def.skin].name} · ${s.kg < 1 ? `${Math.round(s.kg * 1000)} 克` : `${s.kg.toFixed(1)} 公斤`}</div>
        <div class="card-price">${money(s.price)}</div>`);
      if (s.price > cash) card.classList.add('dear');
      card.addEventListener('click', () => cb.onPick(i)); // picking a stone sounds as leaning in (sfx.lean), not a click
      card.addEventListener('pointerenter', () => { cb.sfx.hover(); cb.onHover(i); });
      card.addEventListener('pointerleave', () => cb.onHover(-1));
      stall.appendChild(card);
    });
  }

  // ---------------------------------------------------------------- stone sheet
  let quoteEls = null;
  function showSheet(stone, owned) {
    const M = MINES[stone.def.mine];
    sheet.innerHTML = `
      <div class="sheet-mine">${M.name}<small>${SKINS[stone.def.skin].name}</small></div>
      <div class="sheet-kg">${stone.kg < 1 ? `${Math.round(stone.kg * 1000)} 克` : `${stone.kg.toFixed(2)} 公斤`} · 約 ${(stone.def.unitCm * 2).toFixed(0)} 公分</div>
      <p class="sheet-blurb">${M.blurb}</p>
      <div class="chips">${stone.app.traits().map((t) => `<span>${t}</span>`).join('')}</div>
      ${owned ? '' : `<blockquote>${stone.pitch}</blockquote>`}
      <div class="quote ${owned ? '' : 'hidden'}">
        <div class="q-row"><label>市場估價</label><b data-q="value">—</b></div>
        <div class="q-row"><label>現在賣得</label><b data-q="offer">—</b></div>
        <div class="q-row"><label>投入成本</label><b data-q="cost">—</b></div>
        <div class="q-row pl"><label>帳面盈虧</label><b data-q="pl">—</b></div>
        <div class="q-clear"><label>明朗度</label><div class="bar"><i></i></div><span data-q="cov">0%</span></div>
      </div>
      <ul class="log"></ul>`;
    quoteEls = {
      value: sheet.querySelector('[data-q=value]'), offer: sheet.querySelector('[data-q=offer]'), cost: sheet.querySelector('[data-q=cost]'),
      pl: sheet.querySelector('[data-q=pl]'), cov: sheet.querySelector('[data-q=cov]'), bar: sheet.querySelector('.bar i'), log: sheet.querySelector('.log'),
    };
    sheet.classList.remove('hidden');
  }

  function setQuote({ value, offer, coverage, cost }) {
    if (!quoteEls) return;
    quoteEls.value.textContent = money(value);
    quoteEls.offer.textContent = money(offer);
    quoteEls.cost.textContent = money(cost);
    const pl = offer - cost;
    quoteEls.pl.textContent = `${pl >= 0 ? '+' : '−'}${money(Math.abs(pl)).slice(1)}`;
    quoteEls.pl.className = pl >= 0 ? 'up' : 'down';
    quoteEls.cov.textContent = `${Math.round(coverage * 100)}%`;
    quoteEls.bar.style.width = `${Math.round(coverage * 100)}%`;
    const sellBtn = tools.querySelector('[data-act=sell] b');
    if (sellBtn) sellBtn.textContent = money(offer);
  }

  function log(text, cls = '') {
    if (!quoteEls) return;
    const li = el('li', cls, text);
    quoteEls.log.prepend(li);
    while (quoteEls.log.children.length > 7) quoteEls.log.lastChild.remove();
  }

  // ---------------------------------------------------------------- tool rack
  function showTools(mode, info = {}) {
    if (mode === 'market') { tools.classList.add('hidden'); return; }
    const btn = (t, fee) => `<button class="tool" data-act="tool" data-tool="${t.id}">
        <span class="tool-key">${t.key}</span><span class="tool-name">${t.name}</span>
        <span class="tool-fee">${t.free ? '免費' : money(fee)}</span><span class="tool-hint">${t.hint}</span></button>`;
    if (mode === 'inspect') {
      tools.innerHTML = `${btn(TOOLS[0])}${btn(TOOLS[5])}
        <button class="buy ${info.afford ? '' : 'dear'}" data-act="buy"><span>${info.afford ? '買下' : '本金不夠'}</span><b>${money(info.price)}</b></button>
        <button class="back" data-act="back">放回攤上</button>`;
    } else {
      tools.innerHTML = `${TOOLS.map((t) => btn(t, info.fees?.[t.id])).join('')}
        <button class="sell" data-act="sell"><span>賣出</span><b>—</b></button>`;
    }
    tools.classList.remove('hidden');
  }
  function setTool(id) {
    tools.querySelectorAll('.tool').forEach((b) => b.classList.toggle('on', b.dataset.tool === id));
  }

  // ---------------------------------------------------------------- verdict on a reveal
  let deltaTimer = 0;
  function showDelta({ title, pct, lines = [], tier }) {
    delta.innerHTML = `<div class="delta-title">${title}</div>
      <div class="delta-pct">${pct >= 0 ? '+' : '−'}${Math.abs(pct).toFixed(Math.abs(pct) < 10 ? 1 : 0)}%</div>
      ${lines.map((l) => `<div class="delta-line">${l}</div>`).join('')}`;
    delta.className = `delta show ${pct >= 0 ? 'up' : 'down'} t${Math.abs(tier)}`;
    clearTimeout(deltaTimer);
    deltaTimer = setTimeout(() => { delta.className = 'delta'; }, 2600 + lines.length * 500);
  }

  // ---------------------------------------------------------------- result
  function showResult(r) {
    const rows = r.products.map((p) => `<tr><td>${p.name}</td><td>${p.count}</td><td>${money(p.value)}</td></tr>`).join('');
    const verdict = r.truth > r.sold * 1.15 ? `賣早了——它其實值 ${money(r.truth)}` : r.truth < r.sold * 0.85 ? `賣得漂亮——買家解開只值 ${money(r.truth)}` : `價錢公道——解開後值 ${money(r.truth)}`;
    modal.innerHTML = `<div class="result ${r.profit >= 0 ? 'win' : 'lose'}">
      <div class="result-head">${r.profit >= 0 ? '這一塊，賺了' : '這一塊，賠了'}</div>
      <div class="result-pl">${r.profit >= 0 ? '+' : '−'}${money(Math.abs(r.profit)).slice(1)}</div>
      <div class="result-rows">
        <div><label>買價</label><b>${money(r.price)}</b></div><div><label>工錢</label><b>${money(r.fees)}</b></div>
        <div><label>賣得</label><b>${money(r.sold)}</b></div>
      </div>
      <div class="truth">
        <div class="truth-head">買家把它全解開了</div>
        <div class="truth-name ${r.rare ? 'rare' : ''}">${r.name}</div>
        <div class="truth-verdict">${verdict}</div>
        <table><thead><tr><th>取件</th><th>數量</th><th>價值</th></tr></thead><tbody>${rows || '<tr><td colspan="3">只剩一堆邊角料</td></tr>'}</tbody></table>
        ${r.note ? `<div class="truth-note">${r.note}</div>` : ''}
      </div>
      <button data-act="close-result" class="go">回到攤位</button></div>`;
    modal.classList.remove('hidden');
    return new Promise((resolve) => { hud._closeResult = () => { modal.classList.add('hidden'); hud._closeResult = null; resolve(); }; });
  }

  // ---------------------------------------------------------------- sayings ticker
  let sayIdx = Math.floor(Math.random() * SAYINGS.length);
  const nextSaying = () => {
    saying.classList.remove('show');
    setTimeout(() => { saying.textContent = `「${SAYINGS[sayIdx++ % SAYINGS.length]}」`; saying.classList.add('show'); }, 600);
  };
  nextSaying();
  setInterval(nextSaying, 11000);

  let msgTimer = 0;
  const hud = {
    sync(state) {
      setCash(state.cash);
      gmNow.textContent = money(state.cash);
      root.classList.toggle('busy', state.busy);
    },
    toggleGm,
    setMode(mode) {
      root.dataset.mode = mode;
      stall.classList.toggle('hidden', mode !== 'market');
      stallBar.classList.toggle('hidden', mode !== 'market');
      if (mode === 'market') { sheet.classList.add('hidden'); tools.classList.add('hidden'); quoteEls = null; }
    },
    showStall, showSheet, setQuote, log, showTools, setTool, showDelta, showResult,
    hoverCard(i) { [...stall.children].forEach((c, j) => c.classList.toggle('hover', i === j)); },
    showRefill(show) { stallBar.querySelector('[data-act=refill]').classList.toggle('hidden', !show); },
    message(text, kind = '') {
      msg.textContent = text;
      msg.className = `msg ${text ? 'show' : ''} ${kind}`;
      clearTimeout(msgTimer);
      if (text) msgTimer = setTimeout(() => { msg.className = 'msg'; }, 4200);
    },
    cutLine(a, b) {
      if (!a) { svg.classList.remove('show'); return; }
      line.setAttribute('x1', a.x); line.setAttribute('y1', a.y); line.setAttribute('x2', b.x); line.setAttribute('y2', b.y);
      svg.classList.add('show');
    },
    confirmCut(show, fee) {
      confirm.classList.toggle('hidden', !show);
      if (show) confirm.querySelector('span').textContent = `沿紅線下刀，工錢 ${money(fee)}。切下去就回不了頭。`;
    },
    get modalOpen() { return !modal.classList.contains('hidden'); },
  };
  return hud;
}
