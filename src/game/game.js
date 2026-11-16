// The money. Nothing here knows about rendering: it holds the bankroll, the
// stone in hand and what has been spent on it.
import { TUNING } from './tuning.js';

/** Round to a figure a dealer would actually say out loud. */
export function nice(v) {
  if (v < 100) return Math.max(10, Math.round(v / 10) * 10);
  const mag = Math.pow(10, Math.floor(Math.log10(v)) - 1);
  return Math.round(v / mag) * mag;
}

export const money = (v) => `¥${Math.round(v).toLocaleString('en-US')}`;

const CASH_LIMIT = 99_999_999_999; // as much as the bankroll readout has room for

/**
 * Read an amount as a GM would type it: "5000000", "5,000,000", "500萬", "1.5億".
 * A leading + or - makes it a change instead of a new balance.
 * Returns { value, relative } or null if it is not an amount.
 */
export function parseMoney(text) {
  const t = String(text).replace(/[¥$,，\s元]/g, '');
  const m = /^([+\-−]?)(\d+(?:\.\d+)?)(萬|万|億|亿|k|m)?$/i.exec(t);
  if (!m) return null;
  const unit = { 萬: 1e4, 万: 1e4, 億: 1e8, 亿: 1e8, k: 1e3, m: 1e6 }[(m[3] || '').toLowerCase()] || 1;
  const v = Math.round(Number(m[2]) * unit);
  return { value: m[1] === '-' || m[1] === '−' ? -v : v, relative: m[1] !== '' };
}

export function createGame() {
  const listeners = new Set();
  const state = {
    cash: TUNING.startCash,
    busy: false,
    holding: null, // { stone, price, fees, log: [] }
    stats: { stones: 0, profit: 0, wins: 0, best: 0, worst: 0 },
  };
  const emit = () => listeners.forEach((fn) => fn(state));

  return {
    state,
    onChange(fn) { listeners.add(fn); fn(state); },
    setBusy(b) { state.busy = b; emit(); },

    buy(stone, price) {
      if (state.cash < price) return false;
      state.cash -= price;
      state.holding = { stone, price, fees: 0, log: [] };
      emit();
      return true;
    },
    /** What the workshop charges for a job on the stone in hand. */
    fee(kind) {
      const f = TUNING.fees[kind];
      if (!f || !state.holding) return 0;
      return nice(Math.min(f.max, Math.max(f.min, state.holding.price * f.pct)));
    },
    charge(kind) {
      const amount = this.fee(kind);
      if (!state.holding || state.cash < amount) return 0;
      state.cash -= amount;
      state.holding.fees += amount;
      emit();
      return amount;
    },
    get cost() { return state.holding ? state.holding.price + state.holding.fees : 0; },
    sell(amount) {
      const cost = this.cost;
      const profit = amount - cost;
      state.cash += amount;
      const s = state.stats;
      s.stones++; s.profit += profit;
      if (profit > 0) s.wins++;
      s.best = Math.max(s.best, profit); s.worst = Math.min(s.worst, profit);
      state.holding = null;
      emit();
      return { cost, profit };
    },
    refill() { state.cash = TUNING.startCash; emit(); },
    /** GM: put any amount in the bankroll. */
    setCash(v) {
      state.cash = Math.max(0, Math.min(CASH_LIMIT, Math.round(Number(v) || 0)));
      emit();
      return state.cash;
    },
    addCash(d) { return this.setCash(state.cash + d); },
  };
}
