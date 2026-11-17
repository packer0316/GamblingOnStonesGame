// Cash coins (方孔錢) thrown up when a cut comes good.
//
// Each is a rigid disc. It flies, tumbles, strikes the felt on its rim, rings down and
// lies flat -- or, where another coin is already lying, comes to rest on top of it, leaning
// against its edge if it only half covers it. Nothing passes through the bench, through a
// coin lying under it, or through the stone on the bench.
//
// How: a coin is tested at a ring of points round its rim, a smaller ring inside that and
// its centre. Each point is kept above whatever is under it -- the bench, the top face of
// every coin lying lower, the stone (by its own distance field) -- with an impulse applied
// at that point, so a strike on the rim turns the coin as well as stopping it. A coin only
// ever leans on coins below it: that keeps a heap stable without solving the heap at once.
//
// Units are decimetres, as everywhere; the bench top is y = 0.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TABLE } from '../scene/room.js';

const GRAVITY = 55;
const RADIUS = 0.16; // of a coin at scale 1: a little over three centimetres across
const THICK = 0.1; // half its thickness, as a share of its radius
const STEP = 1 / 180; // the physics runs at this, whatever the frame rate
const BOUNCE = { felt: 0.3, coin: 0.22, stone: 0.3 };
const GRIP = { felt: 0.55, coin: 0.35, stone: 0.45 };

// Where a coin is tested, in its own plane (radius 1): 14 round the rim, 6 half way in, the centre.
const PROBES = [];
for (let i = 0; i < 14; i++) PROBES.push([Math.cos((i / 14) * Math.PI * 2), Math.sin((i / 14) * Math.PI * 2)]);
for (let i = 0; i < 6; i++) PROBES.push([0.55 * Math.cos((i / 6) * Math.PI * 2 + 0.3), 0.55 * Math.sin((i / 6) * Math.PI * 2 + 0.3)]);
PROBES.push([0, 0]);

// ---------------------------------------------------------------------------- the coin itself
/** A cash coin of radius 1 lying in the xz plane: raised rim, square hole with its own raised border. */
function coinGeometry() {
  const b = 0.03; // bevel: it grows the outline by this much, so the shapes are drawn that much shy
  const full = THICK * 2, field = full * 0.62;
  const circle = (r, path) => { path.absarc(0, 0, r, 0, Math.PI * 2, false); return path; };
  const square = (a, path) => { path.moveTo(-a, -a); path.lineTo(a, -a); path.lineTo(a, a); path.lineTo(-a, a); path.closePath(); return path; };
  const solid = (shape, thick, bevel) => {
    const g = new THREE.ExtrudeGeometry(shape, bevel
      ? { depth: thick - 2 * b, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 2, curveSegments: 20 }
      : { depth: thick, bevelEnabled: false, curveSegments: 20 });
    g.translate(0, 0, -(bevel ? thick - 2 * b : thick) / 2);
    return g.rotateX(Math.PI / 2);
  };
  const rim = circle(1 - b, new THREE.Shape());
  rim.holes.push(circle(0.86 + b, new THREE.Path()));
  const border = square(0.38 - b, new THREE.Shape());
  border.holes.push(square(0.27 + b, new THREE.Path()));
  const plate = circle(0.87, new THREE.Shape());
  plate.holes.push(square(0.37, new THREE.Path()));
  const g = mergeGeometries([solid(rim, full, true), solid(border, full, true), solid(plate, field, false)]);
  // one drawing for both faces, laid over the coin from above
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) * 0.5 + 0.5, 0.5 - p.getZ(i) * 0.5);
  g.computeBoundingSphere();
  return g;
}

/** Colour and relief of a face: 招財進寶 round the hole, old gold worn bright on everything that stands proud. */
function coinTextures() {
  if (typeof document === 'undefined') return {};
  const S = 512, c = S / 2;
  const make = () => { const el = document.createElement('canvas'); el.width = el.height = S; return [el, el.getContext('2d')]; };
  const [colEl, col] = make();
  const [bumpEl, bump] = make();
  const FONT = '900 104px "Noto Serif TC", "Source Han Serif TC", "Songti TC", "PMingLiU", "MingLiU", "STSong", serif';
  const legend = [['招', 0, -0.615], ['財', 0, 0.615], ['進', 0.615, 0], ['寶', -0.615, 0]]; // read top, bottom, right, left
  const proud = (g, fill, stroke) => {
    g.fillStyle = fill;
    g.beginPath(); g.arc(c, c, c, 0, Math.PI * 2); g.arc(c, c, c * 0.86, 0, Math.PI * 2, true); g.fill(); // the rim
    g.fillRect(c - c * 0.38, c - c * 0.38, c * 0.76, c * 0.76); // the border of the hole
    g.font = FONT; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const [ch, x, y] of legend) {
      if (stroke) { g.lineWidth = 7; g.strokeStyle = stroke; g.strokeText(ch, c + x * c, c + y * c + 4); }
      g.fillText(ch, c + x * c, c + y * c + 4);
    }
  };
  // colour: a dull field with the dirt of years in it
  const grad = col.createRadialGradient(c * 0.8, c * 0.7, 10, c, c, c);
  grad.addColorStop(0, '#b3862f'); grad.addColorStop(1, '#8a6220');
  col.fillStyle = grad; col.fillRect(0, 0, S, S);
  let s = 24680;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) | 0; return (s >>> 0) / 4294967296; };
  for (let i = 0; i < 2600; i++) {
    col.fillStyle = rnd() < 0.6 ? 'rgba(52,34,10,0.16)' : 'rgba(255,214,130,0.10)';
    col.beginPath(); col.arc(rnd() * S, rnd() * S, 1 + rnd() * 3.5, 0, Math.PI * 2); col.fill();
  }
  proud(col, '#ffdc80', '#5e3d10');
  // relief: the field low, everything else high, edges softened so the light rolls over them
  bump.fillStyle = '#404040'; bump.fillRect(0, 0, S, S);
  bump.filter = 'blur(2px)';
  proud(bump, '#ffffff', null);
  const tex = (el, srgb) => {
    const t = new THREE.CanvasTexture(el);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  };
  return { map: tex(colEl, true), bumpMap: tex(bumpEl, false) };
}

// ---------------------------------------------------------------------------- the coins
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

class Coins {
  constructor(scene, max = 260) {
    this.max = max;
    this.next = 0;
    this.drawn = 0;
    this.solids = [];
    /** Called as coins leave (`count`) and as each lands (`force` 0..1, `metal`: on another coin). */
    this.onSpray = null;
    this.onClink = null;
    const { map, bumpMap } = coinTextures();
    const material = new THREE.MeshStandardMaterial({
      color: map ? 0xffffff : 0xf0bf55, map: map || null, bumpMap: bumpMap || null, bumpScale: 1.6,
      roughness: 0.3, metalness: 1, envMapIntensity: 1.7,
    });
    this.mesh = new THREE.InstancedMesh(coinGeometry(), material, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.castShadow = this.mesh.receiveShadow = true;
    scene.add(this.mesh);
    // state: 0 gone, 1 waiting to be thrown, 2 moving, 3 asleep
    this.c = Array.from({ length: max }, (_, id) => ({
      id, state: 0, life: 0, wait: 0, r: RADIUS, h: RADIUS * THICK,
      px: 0, py: 0, pz: 0, vx: 0, vy: 0, vz: 0, qx: 0, qy: 0, qz: 0, qw: 1, wx: 0, wy: 0, wz: 0,
      ax: 1, ay: 0, az: 0, nx: 0, ny: 1, nz: 0, bx: 0, by: 0, bz: 1, // its three axes in the world; n is the one through the hole
      tx: 0, ty: 1, tz: 0, // n, turned to look up: the way out of its upper face
      down: false, still: 0, since: 0, hush: 0, tries: 0,
    }));
    this.order = [];
    this.near = [];
    this.grid = new Map();
    // contacts of the coin being solved
    this.k = { n: 0, rx: new Float32Array(64), ry: new Float32Array(64), rz: new Float32Array(64), nx: new Float32Array(64), ny: new Float32Array(64), nz: new Float32Array(64), d: new Float32Array(64), kind: new Uint8Array(64) };
  }

  /**
   * Throws coins up from `origin`. The options are the ones every burst takes
   * (count, speed, dir, spread, up, scale as [smallest, largest], life in seconds).
   */
  emit(origin, { count = 20, speed = 2.5, dir = null, spread = 1, scale = [0.8, 1.2], life = 3, up = 0 } = {}) {
    const span = Math.min(0.3, count * 0.004); // they leave over a moment, not all in one frame
    for (let n = 0; n < count; n++) {
      const c = this.c[this.next];
      this.next = (this.next + 1) % this.max;
      if (c.state) this.wakeAbove(c);
      let x = Math.random() * 2 - 1, y = Math.random() * 2 - 1, z = Math.random() * 2 - 1;
      const l = Math.hypot(x, y, z) || 1;
      x /= l; y /= l; z /= l;
      c.r = RADIUS * (scale[0] + Math.random() * (scale[1] - scale[0]));
      c.h = c.r * THICK;
      c.px = origin.x + x * c.r * 1.5; c.py = Math.max(origin.y + y * c.r * 1.5, c.r + 0.02); c.pz = origin.z + z * c.r * 1.5;
      if (dir) { x = dir.x + x * spread; y = dir.y + y * spread; z = dir.z + z * spread; }
      const v = speed * (0.3 + Math.random());
      c.vx = x * v; c.vy = y * v + up; c.vz = z * v;
      _q.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      c.qx = _q.x; c.qy = _q.y; c.qz = _q.z; c.qw = _q.w;
      // flipping end over end, the way a tossed coin does, with a little spin about its own axis
      const a = Math.random() * 6.283, flip = 14 + Math.random() * 26;
      axes(c);
      c.wx = (c.ax * Math.cos(a) + c.bx * Math.sin(a)) * flip + c.nx * (Math.random() - 0.5) * 12;
      c.wy = (c.ay * Math.cos(a) + c.by * Math.sin(a)) * flip + c.ny * (Math.random() - 0.5) * 12;
      c.wz = (c.az * Math.cos(a) + c.bz * Math.sin(a)) * flip + c.nz * (Math.random() - 0.5) * 12;
      c.life = life * (0.85 + Math.random() * 0.3);
      c.wait = Math.random() * span;
      c.state = 1; c.down = false; c.still = 0; c.since = 0; c.hush = 0; c.tries = 0;
    }
    this.onSpray?.(count);
  }

  /** Lets the coins strike a stone on the bench (a StoneView), or nothing with `null`. */
  collideWith(stone) {
    this.solids = [];
    if (!stone || !stone.field || !stone.pieces) return;
    for (const piece of stone.pieces) {
      this.solids.push({
        piece, sd: stone.field.pieceSd(piece, stone.windows), scale: stone.scale,
        e: new Float64Array(16), inv: new THREE.Matrix4(), cx: 0, cy: 0, cz: 0, r: 0,
      });
    }
  }

  /** Coins lying on `c`, or leaning on it, are let go: it is about to stop being there. */
  wakeAbove(c) {
    for (const o of this.c) {
      if (o.state !== 3 || o === c) continue;
      const dx = o.px - c.px, dz = o.pz - c.pz, reach = o.r + c.r;
      if (dx * dx + dz * dz < reach * reach && o.py >= c.py - 0.001) { o.state = 2; o.still = 0; }
    }
  }

  wakeAll() { for (const o of this.c) if (o.state === 3) { o.state = 2; o.still = 0; } }

  clear() { for (const c of this.c) if (c.state) { c.life = Math.min(c.life, 0.3); if (c.state === 1) c.state = 0; } }

  update(dt) {
    let any = false;
    for (const c of this.c) if (c.state) { any = true; break; }
    if (!any) { if (this.drawn) { this.drawn = 0; this.mesh.count = 0; } return; }

    this.trackSolids();
    for (const c of this.c) {
      if (!c.state) continue;
      if (c.state === 1) { c.wait -= dt; if (c.wait <= 0) c.state = 2; continue; }
      c.life -= dt;
      if (c.life <= 0) { this.wakeAbove(c); c.state = 0; }
    }
    const steps = Math.max(1, Math.min(6, Math.ceil(dt / STEP)));
    for (let i = 0; i < steps; i++) this.step(dt / steps);

    let top = -1;
    for (const c of this.c) {
      if (c.state < 2) { this.mesh.setMatrixAt(c.id, ZERO); continue; }
      top = c.id;
      const k = c.r * Math.min(c.life / 0.35, 1); // it shrinks away over its last third of a second
      this.mesh.setMatrixAt(c.id, _m.compose(_p.set(c.px, c.py, c.pz), _q.set(c.qx, c.qy, c.qz, c.qw), _s.set(k, k, k)));
    }
    this.drawn = top + 1;
    this.mesh.count = this.drawn;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Where the stone's pieces are now; if one has been moved, whatever lay on it is let go. */
  trackSolids() {
    for (let i = this.solids.length - 1; i >= 0; i--) {
      const s = this.solids[i], mesh = s.piece.mesh;
      if (!mesh.parent || !s.piece.holder.parent || !s.piece.holder.parent.parent) { this.solids.splice(i, 1); this.wakeAll(); continue; }
      mesh.updateWorldMatrix(true, false);
      const e = mesh.matrixWorld.elements;
      let moved = false;
      for (let j = 0; j < 16; j++) if (Math.abs(e[j] - s.e[j]) > 1e-6) { moved = true; s.e[j] = e[j]; }
      if (!moved) continue;
      s.inv.copy(mesh.matrixWorld).invert();
      _p.copy(s.piece.center).applyMatrix4(mesh.matrixWorld);
      s.cx = _p.x; s.cy = _p.y; s.cz = _p.z;
      s.r = s.piece.radius * s.scale + 0.05;
      this.wakeAll();
    }
  }

  step(dt) {
    // What a moving coin can come down on: every coin at rest, and every moving coin that is
    // already down and lower than it. Lowest first, so each leans only on those dealt with.
    const order = this.order, grid = this.grid, CELL = 0.5;
    const lay = (c) => {
      const key = Math.floor(c.px / CELL) * 4096 + Math.floor(c.pz / CELL);
      const cell = grid.get(key);
      if (cell) cell.push(c); else grid.set(key, [c]);
    };
    order.length = 0;
    grid.clear();
    for (const c of this.c) { if (c.state === 3) lay(c); else if (c.state === 2) order.push(c); }
    order.sort((a, b) => a.py - b.py || a.id - b.id);
    for (const c of order) {
      this.move(c, dt, grid, CELL);
      if (c.down) lay(c);
    }
  }

  move(c, dt, grid, CELL) {
    c.vy -= GRAVITY * dt;
    c.px += c.vx * dt; c.py += c.vy * dt; c.pz += c.vz * dt;
    const w = Math.hypot(c.wx, c.wy, c.wz);
    if (w > 1e-4) {
      const half = w * dt * 0.5, sn = Math.sin(half) / w, cs = Math.cos(half);
      const ax = c.wx * sn, ay = c.wy * sn, az = c.wz * sn; // dq * q
      const { qx, qy, qz, qw } = c;
      c.qx = cs * qx + ax * qw + ay * qz - az * qy;
      c.qy = cs * qy + ay * qw + az * qx - ax * qz;
      c.qz = cs * qz + az * qw + ax * qy - ay * qx;
      c.qw = cs * qw - ax * qx - ay * qy - az * qz;
      const n = Math.hypot(c.qx, c.qy, c.qz, c.qw) || 1;
      c.qx /= n; c.qy /= n; c.qz /= n; c.qw /= n;
    }
    axes(c);
    c.hush -= dt;

    // ---- what is it touching?
    const k = this.k;
    k.n = 0;
    // Which face is underneath: 1 or -1 lying down, fading to 0 as it comes up on edge. A rim is
    // round, so a coin stood on it has nothing to balance on and goes over the way it leans.
    const side = Math.max(-1, Math.min(1, c.ny / 0.3));
    const ux = c.nx * side, uy = c.ny * side, uz = c.nz * side;
    const hard = c.ny >= 0 ? 1 : -1, fx = c.nx * hard, fy = c.ny * hard, fz = c.nz * hard; // its upper face, for what pokes it from below
    const fall = (Math.abs(c.vy) + w * c.r) * dt; // how far a point of it can have come since the last step
    const gx = Math.floor(c.px / CELL), gz = Math.floor(c.pz / CELL);
    const near = this.near;
    near.length = 0;
    for (let i = gx - 1; i <= gx + 1; i++) for (let j = gz - 1; j <= gz + 1; j++) {
      const cell = grid.get(i * 4096 + j);
      if (!cell) continue;
      for (const o of cell) {
        const dx = c.px - o.px, dz = c.pz - o.pz, reach = o.r + c.r;
        if (dx * dx + dz * dz < reach * reach) near.push(o);
      }
    }
    let deep = 0, lift = 0;
    const steep = Math.sqrt(Math.max(0, 1 - c.ny * c.ny));
    if (steep > 0.02) {
      const rx = (c.nx * c.ny / steep) * c.r - ux * c.h, ry = ((c.ny * c.ny - 1) / steep) * c.r - uy * c.h, rz = (c.nz * c.ny / steep) * c.r - uz * c.h;
      const y = c.py + ry;
      if (y < 0) { lift = -y; deep = this.touch(rx, ry, rz, 0, 1, 0, -y, 0); }
    }
    for (let p = 0; p < PROBES.length; p++) {
      const a = PROBES[p][0] * c.r, b = PROBES[p][1] * c.r;
      // the point of the under face below this probe, from the centre
      const rx = c.ax * a + c.bx * b - ux * c.h, ry = c.ay * a + c.by * b - uy * c.h, rz = c.az * a + c.bz * b - uz * c.h;
      const y = c.py + ry;
      if (y < 0) { lift = Math.max(lift, -y); deep = Math.max(deep, this.touch(rx, ry, rz, 0, 1, 0, -y, 0)); }
      if (near.length) {
        const x = c.px + rx, z = c.pz + rz;
        for (const o of near) deep = Math.max(deep, this.onto(o, rx, ry, rz, x - o.px, y - o.py, z - o.pz, fall));
      }
    }
    for (const o of near) {
      const tx = o.tx, ty = o.ty, tz = o.tz;
      // The two places coins really meet, found exactly rather than left to fall between probes:
      // the point of this one's rim that is lowest against the other's face ...
      const lean = c.nx * tx + c.ny * ty + c.nz * tz, tilt = Math.sqrt(Math.max(0, 1 - lean * lean));
      if (tilt > 0.02) {
        const rx = ((c.nx * lean - tx) / tilt) * c.r - ux * c.h, ry = ((c.ny * lean - ty) / tilt) * c.r - uy * c.h, rz = ((c.nz * lean - tz) / tilt) * c.r - uz * c.h;
        deep = Math.max(deep, this.onto(o, rx, ry, rz, c.px + rx - o.px, c.py + ry - o.py, c.pz + rz - o.pz, fall));
      }
      // ... and the point of the other's top edge that stands highest into this one
      const back = o.nx * fx + o.ny * fy + o.nz * fz, cant = Math.sqrt(Math.max(0, 1 - back * back));
      if (cant > 0.02) {
        deep = Math.max(deep, this.under(c, fx, fy, fz,
          o.px + ((fx - o.nx * back) / cant) * o.r + tx * o.h - c.px, o.py + ((fy - o.ny * back) / cant) * o.r + ty * o.h - c.py, o.pz + ((fz - o.nz * back) / cant) * o.r + tz * o.h - c.pz, tx, ty, tz));
      }
      // and round the rest of that edge
      for (let p = 0; p < 14; p++) {
        const a = PROBES[p][0] * o.r, b = PROBES[p][1] * o.r;
        deep = Math.max(deep, this.under(c, fx, fy, fz,
          o.px + o.ax * a + o.bx * b + tx * o.h - c.px, o.py + o.ay * a + o.by * b + ty * o.h - c.py, o.pz + o.az * a + o.bz * b + tz * o.h - c.pz, tx, ty, tz));
      }
    }
    for (const s of this.solids) this.strike(c, s);

    // ---- stop it going into any of them
    let hit = 0, metal = false;
    if (k.n) {
      const R2 = c.r * c.r, Id = 1 / (0.25 * R2 + c.h * c.h / 3), Ia = 1 / (0.5 * R2); // 1 / moment about a diameter, about the axis
      for (let pass = 0; pass < 3; pass++) {
        for (let i = 0; i < k.n; i++) {
          const rx = k.rx[i], ry = k.ry[i], rz = k.rz[i], nx = k.nx[i], ny = k.ny[i], nz = k.nz[i], kind = k.kind[i];
          // velocity of that point of the coin
          let ux2 = c.vx + c.wy * rz - c.wz * ry, uy2 = c.vy + c.wz * rx - c.wx * rz, uz2 = c.vz + c.wx * ry - c.wy * rx;
          const vn = ux2 * nx + uy2 * ny + uz2 * nz;
          if (vn >= 0) continue;
          const e = pass === 0 && vn < -1.4 ? (kind === 0 ? BOUNCE.felt : kind === 1 ? BOUNCE.coin : BOUNCE.stone) : 0;
          const j = (-(1 + e) * vn) / (1 + bend(c, rx, ry, rz, nx, ny, nz, Id, Ia));
          push(c, rx, ry, rz, nx * j, ny * j, nz * j, Id, Ia);
          if (pass === 0 && -vn > hit) { hit = -vn; metal = kind === 1; }
          // and the cloth, or the coin under it, drags at it
          ux2 = c.vx + c.wy * rz - c.wz * ry; uy2 = c.vy + c.wz * rx - c.wx * rz; uz2 = c.vz + c.wx * ry - c.wy * rx;
          const vn2 = ux2 * nx + uy2 * ny + uz2 * nz;
          let tx = ux2 - nx * vn2, ty = uy2 - ny * vn2, tz = uz2 - nz * vn2;
          const vt = Math.hypot(tx, ty, tz);
          if (vt > 1e-4) {
            tx /= vt; ty /= vt; tz /= vt;
            const mu = kind === 0 ? GRIP.felt : kind === 1 ? GRIP.coin : GRIP.stone;
            const jt = Math.min(mu * j, vt / (1 + bend(c, rx, ry, rz, tx, ty, tz, Id, Ia)));
            push(c, rx, ry, rz, -tx * jt, -ty * jt, -tz * jt, Id, Ia);
          }
        }
      }
      // out of the bench altogether; out of anything else most of the way, the rest next step
      c.py += lift;
      let worst = -1, depth = 0;
      for (let i = 0; i < k.n; i++) if (k.kind[i] !== 0 && k.d[i] > depth) { depth = k.d[i]; worst = i; }
      if (worst >= 0) { const m = depth * 0.85; c.px += k.nx[worst] * m; c.py += k.ny[worst] * m; c.pz += k.nz[worst] * m; }
    }

    // ---- the edges of the felt
    if (c.px < TABLE.x0 + c.r) { c.px = TABLE.x0 + c.r; if (c.vx < 0) c.vx *= -0.4; }
    if (c.px > TABLE.x1 - c.r) { c.px = TABLE.x1 - c.r; if (c.vx > 0) c.vx *= -0.4; }
    if (c.pz < TABLE.z0 + c.r) { c.pz = TABLE.z0 + c.r; if (c.vz < 0) c.vz *= -0.4; }
    if (c.pz > TABLE.z1 - c.r) { c.pz = TABLE.z1 - c.r; if (c.vz > 0) c.vz *= -0.4; }

    // ---- coming to rest
    if (!k.n) { c.still = 0; return; }
    c.down = true;
    c.since += dt;
    // (not in its last moments: coins dropping as the heap under them is cleared away should not be heard)
    if (hit > 1.6 && c.hush <= 0 && c.life > 0.9) { c.hush = 0.07; this.onClink?.(Math.min(1, hit / 11), metal); }
    const onEdge = 1 - Math.min(1, Math.abs(c.ny) / 0.5); // 1 stood on its rim, 0 lying down
    const roll = Math.exp(-(3.2 + 5 * onEdge) * dt), slide = Math.exp(-(2.2 + 4 * onEdge) * dt); // rolling and sliding both die on cloth
    c.wx *= roll; c.wy *= roll; c.wz *= roll;
    c.vx *= slide; c.vz *= slide;
    const speed = Math.hypot(c.vx, c.vy, c.vz), turn = Math.hypot(c.wx, c.wy, c.wz);
    if (Math.abs(c.ny) < 0.06) {
      // dead upright: the least thing tips it, and here that is which coin it happens to be
      const way = c.ny !== 0 ? Math.sign(c.ny) : c.id % 2 ? 1 : -1, hx = -c.nz, hz = c.nx, hl = Math.hypot(hx, hz) || 1; // (n x up: turning about it lifts n)
      c.wx += (hx / hl) * way * 30 * dt; c.wz += (hz / hl) * way * 30 * dt;
    }
    if (onEdge > 0.3) { c.still = 0; return; } // not a way to lie: wait for it to go over
    if (speed < 0.45 && turn < 2.2) c.still += dt; else c.still = 0;
    if ((c.still > 0.16 || c.since > 2.6) && this.settle(c)) {
      c.state = 3;
      c.vx = c.vy = c.vz = c.wx = c.wy = c.wz = 0;
    }
  }

  /**
   * May this coin stop where it is? Not if that leaves it standing in a coin already at
   * rest. The contacts above keep coins apart nearly always; in a heap of tilted coins two
   * edges can still cross between the points that are tested. So before a coin is allowed
   * to rest it is checked against its neighbours all round both faces, and if it fails it
   * is lifted, laid flatter and left to settle again -- or, after a few tries, tipped off
   * the heap to one side.
   */
  settle(c) {
    let worst = 0, into = null;
    for (const o of this.c) {
      if (o.state !== 3 || o === c) continue;
      const dx = o.px - c.px, dz = o.pz - c.pz, reach = o.r + c.r;
      if (dx * dx + dz * dz >= reach * reach || Math.abs(o.py - c.py) > reach) continue;
      const d = Math.max(sunk(c, o), sunk(o, c));
      if (d > worst) { worst = d; into = o; }
    }
    if (!into || worst < 0.2 * Math.min(c.h, into.h)) return true;
    if ((into.px - c.px) * c.tx + (into.py - c.py) * c.ty + (into.pz - c.pz) * c.tz > 0 && into.py > c.py) {
      // the other one is lying on this one: it is the one to move
      into.state = 2; into.still = 0; into.since = 0;
      return true;
    }
    c.py += worst + c.h * 0.5;
    // turned half way to lying level, about the line it is tilted round
    const ax = c.tz, az = -c.tx, al = Math.hypot(ax, az);
    if (al > 1e-4) {
      const half = Math.atan2(al, c.ty) * 0.25, sn = Math.sin(half) / al, cs = Math.cos(half);
      const x = ax * sn, z = az * sn, { qx, qy, qz, qw } = c;
      c.qx = cs * qx + x * qw - z * qy; c.qy = cs * qy + z * qx - x * qz; c.qz = cs * qz + z * qw + x * qy; c.qw = cs * qw - x * qx - z * qz;
      axes(c);
    }
    c.vx = c.vy = c.vz = c.wx = c.wy = c.wz = 0;
    if (++c.tries > 3) {
      const dx = c.px - into.px, dz = c.pz - into.pz, l = Math.hypot(dx, dz) || 1;
      c.vx = (dx / l) * 2.4; c.vz = (dz / l) * 2.4; c.vy = 1.2;
      c.tries = 0;
    }
    c.still = 0; c.since = Math.min(c.since, 1.5);
    return false;
  }

  /** A point of the moving coin's under face (r from its centre, d from the centre of coin o) against o's upper face. */
  onto(o, rx, ry, rz, dx, dy, dz, fall) {
    const along = dx * o.tx + dy * o.ty + dz * o.tz, over = along - o.h; // above that face by this much
    if (over >= 0 || over < -(2.4 * o.h + fall)) return 0; // clear of it, or right under it (then it is this one that is being lain on)
    if (dx * dx + dy * dy + dz * dz - along * along > o.r * o.r) return 0; // beside it, not on it
    return this.touch(rx, ry, rz, o.tx, o.ty, o.tz, -over, 1);
  }

  /** A point on the top edge of a coin underneath (d from the moving coin's centre) against the moving coin c, whose upper face looks along f. */
  under(c, fx, fy, fz, dx, dy, dz, tx, ty, tz) {
    const along = dx * fx + dy * fy + dz * fz;
    if (along <= -c.h || along >= c.h) return 0; // under this coin, or clear above it
    if (dx * dx + dy * dy + dz * dz - along * along > c.r * c.r) return 0;
    return this.touch(dx, dy, dz, tx, ty, tz, along + c.h, 1);
  }

  /** Notes a contact of the coin being solved: the point (from its centre), the way out, how deep, on what. */
  touch(rx, ry, rz, nx, ny, nz, depth, kind) {
    const k = this.k;
    if (k.n < 64) {
      const i = k.n++;
      k.rx[i] = rx; k.ry[i] = ry; k.rz[i] = rz; k.nx[i] = nx; k.ny[i] = ny; k.nz[i] = nz; k.d[i] = depth; k.kind[i] = kind;
    }
    return depth;
  }

  /** The coin against one piece of stone: its distance field says how deep, and which way is out. */
  strike(c, s) {
    const dx = c.px - s.cx, dy = c.py - s.cy, dz = c.pz - s.cz, reach = s.r + c.r;
    if (dx * dx + dy * dy + dz * dz > reach * reach) return;
    const m = s.inv.elements, sc = s.scale;
    const dist = (x, y, z) => s.sd(m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]) * sc;
    if (dist(c.px, c.py, c.pz) > c.r + 0.03) return;
    let deep = 0, bx = 0, by = 0, bz = 0;
    for (let p = 0; p <= 14; p += 2) {
      const a = p < 14 ? PROBES[p][0] * c.r : 0, b = p < 14 ? PROBES[p][1] * c.r : 0;
      const rx = c.ax * a + c.bx * b, ry = c.ay * a + c.by * b, rz = c.az * a + c.bz * b;
      const d = c.h - dist(c.px + rx, c.py + ry, c.pz + rz);
      if (d > deep) { deep = d; bx = rx; by = ry; bz = rz; }
    }
    if (deep <= 0) return;
    const x = c.px + bx, y = c.py + by, z = c.pz + bz, e = 0.02, d0 = dist(x, y, z);
    let nx = dist(x + e, y, z) - d0, ny = dist(x, y + e, z) - d0, nz = dist(x, y, z + e) - d0;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-6) return;
    nx /= l; ny /= l; nz /= l;
    this.touch(bx - nx * c.h, by - ny * c.h, bz - nz * c.h, nx, ny, nz, deep, 2);
  }
}

// Points over a face of a coin (radius 1), for checking one coin against another all round.
const FACE = [];
for (const [rho, n] of [[1, 20], [0.62, 10], [0.25, 5]]) for (let i = 0; i < n; i++) FACE.push([rho * Math.cos((i / n) * Math.PI * 2), rho * Math.sin((i / n) * Math.PI * 2)]);

/** How far the deepest point of either face of coin a is inside coin b; 0 if none is. */
function sunk(a, b) {
  let worst = 0;
  for (let side = -1; side <= 1; side += 2) {
    const ox = a.px + a.nx * a.h * side - b.px, oy = a.py + a.ny * a.h * side - b.py, oz = a.pz + a.nz * a.h * side - b.pz;
    for (let i = 0; i < FACE.length; i++) {
      const u = FACE[i][0] * a.r, v = FACE[i][1] * a.r;
      const dx = ox + a.ax * u + a.bx * v, dy = oy + a.ay * u + a.by * v, dz = oz + a.az * u + a.bz * v;
      const along = dx * b.nx + dy * b.ny + dz * b.nz;
      const inside = Math.min(b.h - Math.abs(along), b.r - Math.sqrt(Math.max(dx * dx + dy * dy + dz * dz - along * along, 0)));
      if (inside > worst) worst = inside;
    }
  }
  return worst;
}

/** The coin's axes in the world, from its quaternion: a and b in its plane, n through the hole. */
function axes(c) {
  const { qx, qy, qz, qw } = c;
  c.ax = 1 - 2 * (qy * qy + qz * qz); c.ay = 2 * (qx * qy + qz * qw); c.az = 2 * (qx * qz - qy * qw);
  c.nx = 2 * (qx * qy - qz * qw); c.ny = 1 - 2 * (qx * qx + qz * qz); c.nz = 2 * (qy * qz + qx * qw);
  c.bx = 2 * (qx * qz + qy * qw); c.by = 2 * (qy * qz - qx * qw); c.bz = 1 - 2 * (qx * qx + qy * qy);
  const up = c.ny >= 0 ? 1 : -1;
  c.tx = c.nx * up; c.ty = c.ny * up; c.tz = c.nz * up;
}

/** How much a push at point r along d goes into turning the coin instead of moving it (mass 1). */
function bend(c, rx, ry, rz, dx, dy, dz, Id, Ia) {
  const tx = ry * dz - rz * dy, ty = rz * dx - rx * dz, tz = rx * dy - ry * dx; // r x d
  const along = tx * c.nx + ty * c.ny + tz * c.nz;
  const ix = (tx - c.nx * along) * Id + c.nx * along * Ia, iy = (ty - c.ny * along) * Id + c.ny * along * Ia, iz = (tz - c.nz * along) * Id + c.nz * along * Ia;
  return (iy * rz - iz * ry) * dx + (iz * rx - ix * rz) * dy + (ix * ry - iy * rx) * dz; // ((I^-1 (r x d)) x r) . d
}

/** An impulse J on the coin at point r from its centre. */
function push(c, rx, ry, rz, jx, jy, jz, Id, Ia) {
  c.vx += jx; c.vy += jy; c.vz += jz;
  const tx = ry * jz - rz * jy, ty = rz * jx - rx * jz, tz = rx * jy - ry * jx;
  const along = tx * c.nx + ty * c.ny + tz * c.nz;
  c.wx += (tx - c.nx * along) * Id + c.nx * along * Ia;
  c.wy += (ty - c.ny * along) * Id + c.ny * along * Ia;
  c.wz += (tz - c.nz * along) * Id + c.nz * along * Ia;
}

export function createCoins(scene, max) { return new Coins(scene, max); }
