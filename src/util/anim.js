// Tiny promise-based animation driver. Sequences read top to bottom:
//   await anim.tween(0.4, (k) => { ... }, ease.outBack);
//   await anim.wait(0.1);

export const ease = {
  linear: (t) => t,
  inQuad: (t) => t * t,
  outQuad: (t) => 1 - (1 - t) * (1 - t),
  inOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  inCubic: (t) => t * t * t,
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  inQuart: (t) => t * t * t * t,
  outQuart: (t) => 1 - Math.pow(1 - t, 4),
  inExpo: (t) => (t === 0 ? 0 : Math.pow(2, 10 * t - 10)),
  outExpo: (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  inBack: (t) => 2.70158 * t * t * t - 1.70158 * t * t,
  outBack: (t) => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2),
  outElastic: (t) =>
    t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1,
  outBounce: (t) => {
    const n = 7.5625, d = 2.75;
    if (t < 1 / d) return n * t * t;
    if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
    if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
    return n * (t -= 2.625 / d) * t + 0.984375;
  },
};

export class Animator {
  constructor() {
    this.items = [];
    this.timeScale = 1;
  }

  /** Calls fn(k) with eased progress 0..1 over `dur` seconds. */
  tween(dur, fn, easing = ease.inOutCubic) {
    return new Promise((resolve) => {
      if (dur <= 0) { fn(1); resolve(); return; }
      fn(easing(0));
      this.items.push({ t: 0, dur, fn, easing, resolve });
    });
  }

  wait(dur) {
    return this.tween(dur, () => {}, ease.linear);
  }

  update(dt) {
    const step = dt * this.timeScale;
    const items = this.items;
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      it.t += step;
      const k = Math.min(it.t / it.dur, 1);
      it.fn(it.easing(k));
      if (k >= 1) {
        items.splice(i, 1);
        it.resolve();
      }
    }
  }
}

/** Critically damped spring for values that chase a target (head sway etc). */
export class Spring {
  constructor(value = 0, stiffness = 120, damping = 14) {
    this.x = value; this.v = 0; this.target = value;
    this.k = stiffness; this.c = damping;
  }
  kick(impulse) { this.v += impulse; }
  update(dt) {
    const steps = Math.max(1, Math.ceil(dt / 0.008));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const a = -this.k * (this.x - this.target) - this.c * this.v;
      this.v += a * h;
      this.x += this.v * h;
    }
    return this.x;
  }
}

export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
export const rand = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
export const randSign = () => (Math.random() < 0.5 ? -1 : 1);
