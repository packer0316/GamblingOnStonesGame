// Game audio. Every cue is a recording (public/sfx, all CC0, cut and levelled
// by tools/sfx_build.py). Until a file has loaded, or if one fails, the cue
// falls back to a small sound synthesised with WebAudio, so nothing is ever
// silent by accident.
//
// Routing:   sfx bus ───┐
//            amb bus ───┤
//            music bus ─┴─> master -> compressor -> limiter -> speakers
//
// The machines are layered live rather than played as one file, because a saw
// has to follow the cut: a start-up recording hands over to a running loop, a
// second loop of the blade in stone fades in with the load, and both sag in
// pitch as the tool bites. The background music (public/music) plays under
// everything, with a faint murmur of dealers looping beneath it.

const ONE_SHOTS = [
  'ui_click', 'ui_hover_1', 'ui_hover_2', 'ui_hover_3', 'deny', 'whoosh', 'lean_in_1', 'lean_in_2', 'lean_out',
  'stone_down_1', 'stone_down_2', 'stone_down_3', 'stone_slide', 'stone_clack', 'stone_lift', 'cloth_rustle', 'cloth_snap',
  'pay_notes', 'count_notes', 'count_end', 'cash_ding', 'coins_1', 'coins_2', 'coins_shower',
  'coin_spray', 'coin_clink_1', 'coin_clink_2', 'coin_clink_3', 'coin_clink_4', 'coin_felt_1', 'coin_felt_2', 'coin_felt_3',
  'torch_on', 'torch_off', 'lamp_off', 'lamp_on', 'torch_tap_1', 'torch_tap_2', 'torch_tap_3', 'torch_tap_4', 'torch_tap_5',
  'grinder_start', 'grinder_stop', 'squirt', 'wipe',
  'machine_roll', 'vise_close', 'vise_open', 'saw_start', 'saw_stop', 'pour_1', 'pour_2',
  'heartbeat', 'crack_sting', 'gong_big', 'gong_small', 'firecrackers', 'crowd_cheer', 'applause',
  'crowd_ooh', 'crowd_ooh_big', 'crowd_aah', 'crowd_oh', 'crowd_ouch', 'luogu_up', 'luogu_flat', 'luogu_down', 'luogu_crash', 'boom',
];
// amb_crickets is still built (tools/sfx_build.py) but no longer loaded: the music replaced it
const LOOPS = ['amb_murmur', 'grinder_loop', 'grinder_bite', 'saw_idle', 'saw_cut', 'coolant'];

const AMB = { murmur: 0.19 }; // the hall's level under everything else
// The background music: three minutes of MP3, streamed through a media element rather
// than decoded whole (that would be ~60 MB of samples). It wraps as a song that fades
// out and starts again, so the gap MP3 leaves at a loop point does not matter here.
const MUSIC = { src: 'music/stoneBGM.mp3', gain: 0.7 }; // the file sits at -24.7 LUFS; this puts it ~5 dB under the effects, ~8 dB over the murmur

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (...names) => names[Math.floor(Math.random() * names.length)];
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function createSfx() {
  let ctx = null, master = null, sfxBus = null, ambBus = null, musicBus = null, noise = null;
  let muted = false, unlocked = false;
  const buffers = new Map();
  let preloading = null;
  const amb = { murmur: null, duck: 1 };
  let music = null; // the <audio> element, once the first gesture has started it
  let lastHover = -1, lastClink = -1;

  function ensure() {
    if (ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.85;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.25;
    // a hard ceiling, so a gong, a crowd and firecrackers together never clip
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.001; limiter.release.value = 0.12;
    master.connect(comp).connect(limiter).connect(ctx.destination);
    sfxBus = ctx.createGain();
    ambBus = ctx.createGain();
    musicBus = ctx.createGain();
    musicBus.gain.value = 0;
    sfxBus.connect(master);
    ambBus.connect(master);
    musicBus.connect(master);
    const len = ctx.sampleRate * 2;
    noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return true;
  }
  const now = () => ctx.currentTime;

  async function loadOne(name, ext) {
    try {
      const res = await fetch(`sfx/${name}.${ext}`);
      if (!res.ok) return;
      buffers.set(name, await ctx.decodeAudioData(await res.arrayBuffer()));
    } catch { /* the cue keeps its synthesised fallback */ }
  }

  /**
   * Play a recording. Returns a handle with stop(fade), or null if the file is not
   * loaded (the caller then falls back). `dur` cuts it short with a quick fade.
   */
  function play(name, { gain = 1, rate = 1, at = 0, offset = 0, dur = 0, bus = sfxBus } = {}) {
    const b = buffers.get(name);
    if (!b) return null;
    const src = ctx.createBufferSource();
    src.buffer = b;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(bus);
    const t = now() + at;
    src.start(t, offset);
    if (dur > 0) { g.gain.setTargetAtTime(0, t + dur, 0.04); src.stop(t + dur + 0.3); }
    return {
      stop(fade = 0.08) { const s = now(); g.gain.cancelScheduledValues(s); g.gain.setTargetAtTime(0, s, fade / 3); try { src.stop(s + fade + 0.05); } catch { /* already stopped */ } },
    };
  }

  /** A looping recording whose level and speed can be steered while it runs. */
  function loop(name, { gain = 0, rate = 1, bus = sfxBus } = {}) {
    const b = buffers.get(name);
    if (!b) return null;
    const src = ctx.createBufferSource();
    src.buffer = b;
    src.loop = true;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(bus);
    src.start(now(), Math.random() * b.duration * 0.5);
    return {
      setGain(v, tc = 0.06) { g.gain.setTargetAtTime(v, now(), tc); },
      setRate(r, tc = 0.08) { src.playbackRate.setTargetAtTime(r, now(), tc); },
      stop(fade = 0.2) { const s = now(); g.gain.cancelScheduledValues(s); g.gain.setTargetAtTime(0, s, fade / 3); try { src.stop(s + fade + 0.1); } catch { /* already stopped */ } },
    };
  }

  // ------------------------------------------------------------------ synth fallbacks
  function tone({ type = 'sine', f0, f1 = f0, dur = 0.2, gain = 0.3, at = 0, attack = 0.002 }) {
    const t = now() + at;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(sfxBus);
    o.start(t); o.stop(t + dur + 0.02);
  }

  function burst({ dur = 0.1, gain = 0.3, at = 0, type = 'bandpass', f0 = 2000, f1 = f0, q = 1, attack = 0.001 }) {
    const t = now() + at;
    const src = ctx.createBufferSource();
    src.buffer = noise; src.loop = true;
    const filt = ctx.createBiquadFilter();
    filt.type = type; filt.Q.value = q;
    filt.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) filt.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filt).connect(g).connect(sfxBus);
    src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.02);
  }

  /** The old all-synthesised machine, used only while the recordings are missing. */
  function synthMachine({ hum, whine, biteLo, biteHi }) {
    const out = ctx.createGain();
    out.gain.value = 0;
    out.connect(sfxBus);
    const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), og = ctx.createGain();
    o1.type = 'sawtooth'; o2.type = 'square';
    o1.frequency.value = hum; o2.frequency.value = whine;
    og.gain.value = 0.16;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = whine * 3;
    o1.connect(og); o2.connect(og); og.connect(lp).connect(out);
    const n = ctx.createBufferSource(); n.buffer = noise; n.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = (biteLo + biteHi) / 2; bp.Q.value = 0.9;
    const ng = ctx.createGain(); ng.gain.value = 0;
    n.connect(bp).connect(ng).connect(out);
    o1.start(); o2.start(); n.start();
    return {
      set(level, load) {
        const t = now();
        out.gain.setTargetAtTime(level * 0.5, t, 0.06);
        o1.frequency.setTargetAtTime(hum * (1 - 0.22 * load), t, 0.08);
        o2.frequency.setTargetAtTime(whine * (1 - 0.16 * load), t, 0.08);
        ng.gain.setTargetAtTime(0.1 + load * 0.75, t, 0.05);
        bp.frequency.setTargetAtTime(biteLo + (biteHi - biteLo) * (0.35 + 0.65 * load), t, 0.08);
      },
      stop() {
        const t = now();
        out.gain.setTargetAtTime(0, t, 0.12);
        o1.frequency.setTargetAtTime(hum * 0.3, t, 0.25); o2.frequency.setTargetAtTime(whine * 0.3, t, 0.25);
        o1.stop(t + 1); o2.stop(t + 1); n.stop(t + 1);
      },
    };
  }

  /**
   * A tool built from recordings: `start` plays once and hands over to the `idle`
   * loop at `handover` seconds; the `bite` loop rises with the load; both sag in
   * pitch as the tool works. A short internal tick keeps the hand-over going even
   * when nobody calls set().
   */
  function machine(cfg) {
    if (!buffers.has(cfg.idle) || !buffers.has(cfg.bite)) return synthMachine(cfg.synth);
    const t0 = now();
    const start = play(cfg.start, { gain: cfg.startGain });
    const idle = loop(cfg.idle), bite = loop(cfg.bite, { rate: cfg.biteRate });
    let level = 0.8, load = 0, stopped = false;
    const tick = () => {
      if (stopped) return;
      const run = smooth(cfg.handover - 0.4, cfg.handover + 0.2, now() - t0);
      idle.setGain(level * cfg.idleGain * run, 0.05);
      bite.setGain(level * cfg.biteGain * load * (0.35 + 0.65 * run), 0.04);
      idle.setRate(1 - cfg.sag * load, 0.08);
      bite.setRate(cfg.biteRate * (1 - cfg.sag * 0.5 * load) * (1 + 0.012 * Math.sin(now() * 31)), 0.06);
    };
    const timer = setInterval(tick, 30);
    tick();
    // never left running: a tool that was not stopped winds down on its own
    const guardTimer = setTimeout(() => api.stop(), 20000);
    const api = {
      set(l, ld) { level = l; load = Math.max(0, Math.min(1, ld)); tick(); },
      stop() {
        if (stopped) return;
        stopped = true;
        clearInterval(timer); clearTimeout(guardTimer);
        start?.stop(0.12);
        idle.stop(0.15); bite.stop(0.1);
        play(cfg.stop, { gain: cfg.stopGain * Math.max(0.6, level) });
      },
    };
    return api;
  }

  function startAmbience() {
    if (!unlocked || amb.murmur || !buffers.has('amb_murmur')) return;
    amb.murmur = loop('amb_murmur', { bus: ambBus });
    amb.murmur?.setGain(AMB.murmur * amb.duck, 1.5);
  }

  /** Start (or resume) the music; called from a gesture, which play() requires. */
  function startMusic() {
    if (!unlocked || muted) return;
    if (!music) {
      try {
        music = new Audio(MUSIC.src);
        music.loop = true;
        music.preload = 'auto';
        ctx.createMediaElementSource(music).connect(musicBus);
      } catch { music = null; return; }
      musicBus.gain.setTargetAtTime(MUSIC.gain, now(), 1.2);
    }
    if (music.paused) music.play().catch(() => { /* not a gesture yet: the next click retries */ });
  }

  const guard = (fn) => (...args) => { if (!muted && ensure()) { try { return fn(...args); } catch { /* audio is best-effort */ } } return null; };
  const silent = { set() {}, stop() {} };

  const sfx = {
    /** Create the audio graph and fetch every recording (nothing plays until unlock). */
    preload() {
      if (preloading || !ensure()) return preloading;
      preloading = Promise.all([...ONE_SHOTS.map((n) => loadOne(n, 'mp3')), ...LOOPS.map((n) => loadOne(n, 'wav'))])
        .then(() => { startAmbience(); return buffers.size; });
      return preloading;
    },
    get loaded() { return buffers.size; },
    unlock() {
      if (!ensure()) return;
      if (ctx.state === 'suspended') ctx.resume();
      unlocked = true;
      startAmbience();
      startMusic();
    },
    setMuted(m) {
      muted = m;
      if (master) master.gain.setTargetAtTime(m ? 0 : 0.85, now(), 0.05);
      // muted, the song pauses rather than running on silently, and picks up where it left off
      if (m) music?.pause(); else startMusic();
    },
    get muted() { return muted; },

    // ---- interface
    // cloth, never a tone: a padded slap for a click, a flick of fabric for a hover
    click: guard(() => { if (!play('ui_click', { gain: 0.6 })) burst({ dur: 0.08, gain: 0.2, type: 'lowpass', f0: 1400, f1: 300 }); }),
    hover: guard(() => {
      // sweeping across the cards fires a hover per card: the flicks thin out instead of piling up
      if (now() - lastHover < 0.07) return;
      lastHover = now();
      if (!play(pick('ui_hover_1', 'ui_hover_2', 'ui_hover_3'), { gain: 0.32, rate: rnd(0.96, 1.04) })) burst({ dur: 0.12, gain: 0.04, f0: 1800, q: 0.7, attack: 0.03 });
    }),
    /** Picking a stone up to look at it: the player leans in over the felt (`true`), or sits back. */
    lean: guard((inward = true) => {
      const name = inward ? pick('lean_in_1', 'lean_in_2') : 'lean_out';
      if (!play(name, { gain: inward ? 0.5 : 0.4, rate: rnd(0.96, 1.04) })) burst({ dur: inward ? 0.7 : 0.5, gain: 0.06, f0: 1600, q: 0.6, attack: 0.25 });
    }),
    deny: guard(() => { if (!play('deny', { gain: 0.5 })) tone({ type: 'square', f0: 160, f1: 110, dur: 0.18, gain: 0.12 }); }),
    whoosh: guard((g = 0.4) => { if (!play('whoosh', { gain: g, rate: rnd(0.9, 1.1) })) burst({ dur: 0.25, gain: 0.2, f0: 600, f1: 2400 }); }),

    // ---- stones and the stall
    /**
     * A stone set down on the felt; heavier stones land louder. Weight no longer
     * moves the pitch: a stall laid out stone by stone stepped through a scale.
     */
    thud: guard((weight = 1) => {
      const w = Math.max(0, Math.min(1, weight));
      if (!play(pick('stone_down_1', 'stone_down_2', 'stone_down_3'), { gain: 0.3 + 0.35 * w, rate: rnd(0.97, 1.03) })) {
        burst({ dur: 0.12, gain: 0.25 * w, type: 'lowpass', f0: 500, f1: 120 });
      }
    }),
    /** A stone picked up off the cloth. */
    lift: guard(() => { play('stone_lift', { gain: 0.35, rate: rnd(0.9, 1.05) }); }),
    /** The vendor shakes out the cloth and lays out a new lot. */
    cloth: guard(() => { play('cloth_snap', { gain: 0.45 }); play('cloth_rustle', { gain: 0.4, at: 0.12 }); }),
    /** Two halves knock and are eased apart. */
    part: guard(() => {
      if (!play('stone_clack', { gain: 0.65 })) { burst({ dur: 0.05, gain: 0.25, f0: 2600, q: 1.5 }); tone({ f0: 700, f1: 380, dur: 0.07, gain: 0.14 }); }
      play('stone_slide', { gain: 0.55, at: 0.08 });
    }),
    clack() { sfx.part(); }, // older name

    // ---- money
    /** Paying for a stone: notes counted onto the counter. */
    pay: guard(() => { if (!play('pay_notes', { gain: 0.75 })) tone({ f0: 500, f1: 300, dur: 0.1, gain: 0.15 }); }),
    /** Paying the workshop: a note or two. */
    fee: guard(() => { if (!play('pay_notes', { gain: 0.6, dur: 0.42 })) tone({ f0: 500, f1: 300, dur: 0.08, gain: 0.1 }); }),
    coins: guard((big) => {
      if (!play(big ? 'coins_shower' : pick('coins_1', 'coins_2'), { gain: big ? 0.55 : 0.7 })) for (let i = 0; i < 5; i++) tone({ f0: rnd(2400, 4200), dur: 0.08, gain: 0.06, at: i * 0.05 });
    }),
    /**
     * Coins thrown up off the bench, `count` of them: the handful leaving. A few are then
     * heard one by one as they land (coinClink); a great many need the body of a real pour
     * under those, timed to when the first of them come down.
     */
    coinSpray: guard((count = 14) => {
      const big = Math.min(1, count / 120);
      if (!play('coin_spray', { gain: 0.55 + 0.3 * big, rate: rnd(0.96, 1.05) })) for (let i = 0; i < 6; i++) tone({ f0: rnd(3200, 5600), dur: 0.07, gain: 0.05, at: i * 0.035 });
      if (count >= 40) play('coins_shower', { gain: 0.2 + 0.28 * big, at: 0.3, offset: 0.4, dur: 1.6 + 1.6 * big });
    }),
    /**
     * One coin landing: `force` 0..1, on the felt or (`metal`) on another coin. Called by
     * the coins themselves as they strike, so it is thinned out here: of a hundred landing
     * together only so many can be told apart, and the rest are just level.
     */
    coinClink: guard((force = 0.5, metal = false) => {
      const t = now();
      if (t - lastClink < 0.022) return;
      lastClink = t;
      const f = Math.max(0.15, Math.min(1, force));
      const name = metal ? pick('coin_clink_1', 'coin_clink_2', 'coin_clink_3', 'coin_clink_4') : pick('coin_felt_1', 'coin_felt_2', 'coin_felt_3');
      if (!play(name, { gain: (metal ? 0.5 : 0.42) * (0.25 + 0.75 * f), rate: rnd(0.9, 1.14) })) tone({ f0: rnd(3600, 5200), dur: 0.05, gain: 0.05 * f });
      // a hard landing on cloth still rings the coin a little
      if (!metal && f > 0.55) play(pick('coin_clink_1', 'coin_clink_3'), { gain: 0.16 * f, rate: rnd(1.0, 1.2), at: 0.004 });
    }),
    /** The buyer's note counter riffling out the payment, then its beep and a bell. */
    countUp: guard((secs = 1, big = false) => {
      const s = Math.max(0.5, Math.min(3, secs));
      if (play('count_notes', { gain: 0.6, dur: s })) {
        play('count_end', { gain: 0.6, at: s - 0.05 });
        play('cash_ding', { gain: big ? 0.6 : 0.4, at: s + 0.25 });
      } else tone({ f0: 1320, dur: 0.25, gain: 0.1, at: s });
    }),

    // ---- torch: the lamp over the bench goes off, the torch clicks on (and back)
    torch: guard((on) => {
      if (on) {
        play('lamp_off', { gain: 0.5 }) || tone({ type: 'square', f0: 1500, dur: 0.02, gain: 0.05 });
        play('torch_on', { gain: 0.8, at: 0.2 }) || tone({ type: 'square', f0: 2100, dur: 0.02, gain: 0.07, at: 0.2 });
      } else {
        play('torch_off', { gain: 0.8 }) || tone({ type: 'square', f0: 1500, dur: 0.02, gain: 0.07 });
        play('lamp_on', { gain: 0.5, at: 0.16 });
      }
      // in the dark the room seems to go quiet: the voices drop back, the music stays
      amb.duck = on ? 0.45 : 1;
      amb.murmur?.setGain(AMB.murmur * amb.duck, 0.5);
    }),
    /** The torch's metal head ticking on the skin as it is slid over the stone; `force` 0..1. */
    torchTap: guard((force = 0.5) => {
      const f = Math.max(0, Math.min(1, force));
      if (!play(pick('torch_tap_1', 'torch_tap_2', 'torch_tap_3', 'torch_tap_4', 'torch_tap_5'), { gain: 0.12 + 0.3 * f, rate: rnd(0.95, 1.05) })) {
        burst({ dur: 0.025, gain: 0.03 + 0.05 * f, f0: 3800, q: 2 });
      }
    }),

    // ---- grinder and water
    squirt: guard(() => { if (!play('squirt', { gain: 0.6, rate: rnd(0.95, 1.05) })) burst({ dur: 0.3, gain: 0.15, f0: 2600, f1: 1200, q: 0.6 }); }),
    wipe: guard(() => { play('wipe', { gain: 0.45 }); }),
    /** Water poured over fresh faces. */
    pour: guard(() => {
      if (!play(pick('pour_1', 'pour_2'), { gain: 0.7 })) {
        burst({ dur: 0.9, gain: 0.2, type: 'bandpass', f0: 2600, f1: 900, q: 0.6, attack: 0.03 });
        burst({ dur: 1.2, gain: 0.07, type: 'highpass', f0: 5200, q: 0.5, attack: 0.08, at: 0.05 });
      }
    }),
    /** The saw's coolant jets; returns { stop() }. */
    coolant: (...a) => guard(() => {
      const w = loop('coolant');
      if (!w) return silent;
      w.setGain(0.4, 0.15);
      const t = setTimeout(() => w.stop(0.5), 15000);
      return { stop() { clearTimeout(t); w.stop(0.35); } };
    })(...a) || silent,
    /** Older catch-all for water: a pour, a squirt or the jets. */
    water(amount = 1) { if (amount >= 0.9) sfx.pour(); else if (amount >= 0.5) sfx.squirt(); else { const c = sfx.coolant(); setTimeout(() => c.stop(), 3000); } },

    // ---- saw machine
    machineRoll: guard(() => { if (!play('machine_roll', { gain: 0.6, rate: rnd(0.95, 1.05) })) burst({ dur: 0.8, gain: 0.12, type: 'lowpass', f0: 400, f1: 200 }); }),
    vise: guard((close) => { if (!play(close ? 'vise_close' : 'vise_open', { gain: close ? 0.7 : 0.6 })) burst({ dur: 0.05, gain: 0.25, f0: 2600, q: 1.5 }); }),

    // ---- the reveal
    heartbeat: guard((g = 0.8) => { if (!play('heartbeat', { gain: g })) { tone({ f0: 62, f1: 40, dur: 0.14, gain: 0.5 }); tone({ f0: 56, f1: 38, dur: 0.16, gain: 0.4, at: 0.22 }); } }),
    crack: guard(() => { if (!play('crack_sting', { gain: 0.65 })) { burst({ dur: 0.06, gain: 0.3, f0: 3400, q: 1 }); tone({ type: 'triangle', f0: 420, f1: 120, dur: 0.12, gain: 0.2 }); } }),
    boom: guard((g = 0.6) => { if (!play('boom', { gain: g })) tone({ f0: 90, f1: 30, dur: 0.6, gain: 0.5 }); }),

    /**
     * How the crowd round the bench takes a reveal: 3 大漲, 2 切漲, 1 擦漲, 0 持平,
     * -1 跌, -2 垮. The big ones get the gong, cheering and firecrackers. (The coins that
     * fly on a win bring their own sound: coinSpray as they leave, coinClink as they land.)
     */
    verdict: guard((tier) => {
      // (levels measured off a recorded round: each tier lands louder than the one below it)
      if (tier >= 3) {
        play('gong_big', { gain: 1.0 }) || tone({ f0: 660, f1: 1320, dur: 0.8, gain: 0.2 });
        play('crowd_ooh_big', { gain: 0.75, at: 0.05 });
        play('crowd_cheer', { gain: 0.85, at: 0.95 });
        play('firecrackers', { gain: 0.65, at: 1.2 });
      } else if (tier === 2) {
        play('gong_small', { gain: 0.45 }) || tone({ f0: 660, f1: 990, dur: 0.6, gain: 0.2 });
        play('crowd_ooh', { gain: 0.55, at: 0.05 });
        play('applause', { gain: 0.5, at: 0.8 });
      } else if (tier === 1) {
        // below the gongs everything is one stroke of drum and cymbal: no jingles, nothing with a tune
        play('luogu_up', { gain: 0.6 }) || burst({ dur: 0.5, gain: 0.15, type: 'highpass', f0: 3000, q: 0.5 });
        play('crowd_aah', { gain: 0.5, at: 0.05 });
      } else if (tier === 0) {
        play('luogu_flat', { gain: 0.45 }) || burst({ dur: 0.06, gain: 0.15, f0: 900, q: 2 });
      } else if (tier === -1) {
        play('crowd_oh', { gain: 0.6 }) || burst({ dur: 0.4, gain: 0.15, type: 'lowpass', f0: 400, f1: 120 });
        play('luogu_down', { gain: 0.55, at: 0.1 });
      } else {
        play('crowd_ouch', { gain: 0.65 }) || burst({ dur: 0.6, gain: 0.2, type: 'lowpass', f0: 300, f1: 80 });
        play('boom', { gain: 0.4 });
        play('luogu_crash', { gain: 0.85, rate: 0.9, at: 0.12 });
      }
    }),

    /** Start the grinder; returns { set(level, load), stop() }. */
    grinder: (...a) => guard(() => machine({
      start: 'grinder_start', idle: 'grinder_loop', bite: 'grinder_bite', stop: 'grinder_stop',
      handover: 1.2, startGain: 0.55, idleGain: 0.5, biteGain: 0.5, biteRate: 1, stopGain: 0.5, sag: 0.08,
      synth: { hum: 310, whine: 1240, biteLo: 2600, biteHi: 6200 },
    }))(...a) || silent,
    /** Start the saw; returns { set(level, load), stop() }. */
    saw: (...a) => guard(() => machine({
      start: 'saw_start', idle: 'saw_idle', bite: 'saw_cut', stop: 'saw_stop',
      handover: 1.9, startGain: 0.6, idleGain: 0.48, biteGain: 0.9, biteRate: 1, stopGain: 0.55, sag: 0.1,
      synth: { hum: 92, whine: 368, biteLo: 1100, biteHi: 3800 },
    }))(...a) || silent,
  };
  return sfx;
}
