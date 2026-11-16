// The workshop's choreography. Each function plays one job from start to
// finish -- carrying a stone, grinding a window, sawing it in two, washing the
// faces -- and resolves when the stone is ready to be looked at again.
//
// Nothing here decides what the job costs or what it is worth; that is the
// caller's business. These only make the truth visible.
import * as THREE from 'three';
import { ease } from '../util/anim.js';
import { TORCH } from '../tools/rig.js';
import { TABLE } from '../scene/room.js';

/** How far back the saw waits (size R): well behind the stone, but with its own table still on the bench. */
const sawPark = (R) => Math.min(R * 4 + 9, -TABLE.z0 - R * 1.3 - 0.8);

const _probe = new THREE.Vector3();
const TAU = Math.PI * 2;
const PALE = new THREE.Color(0.61, 0.6, 0.52); // stone ground to powder: whatever it was, it is paler
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0), X = V(1, 0, 0), Z = V(0, 0, 1);
const SHOW = V(0, 0.8, 0.6).normalize(); // where a cut face is turned: up, tilted at the player
const FLIP = new THREE.Quaternion().setFromAxisAngle(X, Math.PI);

export function createActions({ stage, anim, fx, sfx, torch, grinder, saw }) {
  const wait = (s) => anim.wait(s);

  /** Carry a piece to a pose, lifting it clear of the bench on the way. */
  function carry(stone, piece, quat, x, z, dur = 0.7, quiet = false) {
    const h = piece.holder;
    const q0 = h.quaternion.clone(), p0 = h.position.clone();
    const p1 = V(x, stone.restHeight(piece, quat), z);
    const lift = Math.min(1.4, piece.radius * stone.scale * 0.9 + 0.15);
    return anim.tween(dur, (k) => {
      h.quaternion.slerpQuaternions(q0, quat, k);
      h.position.lerpVectors(p0, p1, k);
      h.position.y += Math.sin(k * Math.PI) * lift;
    }, ease.inOutCubic).then(() => { if (!quiet) sfx.thud(Math.min(1, 0.35 + piece.kg * 0.12)); });
  }

  /** The orientation a piece is shown in: whole stones as they lie, cut pieces face up. */
  function showQuat(piece) {
    const q = new THREE.Quaternion();
    if (piece.planes.length) {
      const p = piece.planes[piece.planes.length - 1];
      q.setFromUnitVectors(V(p.n[0], p.n[1], p.n[2]).multiplyScalar(p.s).normalize(), SHOW);
    }
    return piece.flipped ? FLIP.clone().multiply(q) : q;
  }

  /** Where every piece of a stone goes when they are laid out in a row. */
  function rowTargets(stone) {
    const items = stone.pieces.map((piece) => ({ piece, quat: showQuat(piece), half: piece.radius * stone.scale * 0.9 }));
    const gap = 0.3;
    const rows = items.length > 5 ? 2 : 1;
    const perRow = Math.ceil(items.length / rows);
    for (let r = 0; r < rows; r++) {
      const row = items.slice(r * perRow, (r + 1) * perRow);
      let width = -gap;
      for (const it of row) width += it.half * 2 + gap;
      let x = -width / 2;
      for (const it of row) { it.x = x + it.half; it.z = rows === 1 ? 0 : (r === 0 ? -1.3 : 1.3) * Math.max(1, it.half); x += it.half * 2 + gap; }
    }
    let width = 0, depth = 0;
    for (const it of items) { width = Math.max(width, Math.abs(it.x) + it.half); depth = Math.max(depth, Math.abs(it.z) + it.half); }
    return { items, width: width * 2, depth: depth * 2 };
  }

  async function layout(stone, dur = 0.8) {
    const row = rowTargets(stone);
    await Promise.all(row.items.map((it, i) => wait(i * 0.07).then(() => carry(stone, it.piece, it.quat, it.x, it.z, dur))));
    return row;
  }

  /** Camera that takes in everything a stone has become. */
  function benchView(stone) {
    const row = rowTargets(stone);
    let top = 0;
    for (const it of row.items) top = Math.max(top, it.piece.radius * stone.scale * 1.5);
    const span = Math.max(row.width * 0.52, row.depth * 0.9, top * 1.5, 1.2);
    const dist = span / Math.tan((stage.camera.fov * Math.PI) / 360) * (stage.camera.aspect < 1.3 ? 1.5 : 1) + 0.6;
    const tgt = V(0, top * 0.3, 0);
    return { pos: tgt.clone().add(V(0.12, 0.62, 0.78).normalize().multiplyScalar(dist)), tgt, dist };
  }

  // ---------------------------------------------------------------- torch
  /** Press the torch to the stone at a raycast hit. */
  function aimTorch(hit, power, color) {
    const piece = hit.object.userData.piece, stone = piece.stone;
    const g = piece.mesh.geometry, f = hit.face;
    const dep = g.attributes.aDepth.array;
    const depth = (dep[f.a] + dep[f.b] + dep[f.c]) / 3;
    // through a window or a cut the light goes straight in; through skin, only what the skin lets by
    const entry = depth > stone.fleshAt ? 1 : stone.shared.uSkinPass.value;
    const p = stone.toStone(piece, hit.point);
    // the smooth surface normal, not the facet's: the torch should not twitch from triangle to triangle
    const nObj = (hit.normal || f.normal).clone().normalize();
    for (const other of stone.pieces) other.u.uTorchPower.value = 0;
    piece.u.uTorchPos.value.copy(p).addScaledVector(nObj, -0.012);
    piece.u.uTorchEntry.value = entry;
    piece.u.uTorchPower.value = power;
    stone.shared.uTorchColor.value.copy(color);
    const nW = nObj.clone().applyQuaternion(piece.holder.quaternion).normalize();

    // Pressed nearly flat, tipped a little toward the right of the view so the
    // body never hides the glow -- and tipped further the more squarely the
    // camera faces the spot.
    const toCam = stage.camera.position.clone().sub(hit.point).normalize();
    const facing = Math.max(0, toCam.dot(nW));
    const tilt = 0.16 + 0.24 * Math.min(1, Math.max(0, (facing - 0.6) / 0.35));
    const right = X.clone().applyQuaternion(stage.camera.quaternion), camUp = UP.clone().applyQuaternion(stage.camera.quaternion);
    const lean = right.multiplyScalar(0.9).addScaledVector(camUp, -0.35).projectOnPlane(nW).normalize();
    const axis = nW.clone().multiplyScalar(Math.cos(tilt)).addScaledVector(lean, Math.sin(tilt)).normalize();

    // Back the torch off along the normal until no part of it is inside the
    // stone. The stone's own distance field says how deep each test point is,
    // so this holds on any curve, hollow or ridge, not just on a flat patch.
    const sd = piece.sdf || (piece.sdf = stone.field.pieceSd({ planes: piece.planes }, stone.windows));
    const e1 = new THREE.Vector3().crossVectors(axis, Math.abs(axis.y) < 0.9 ? UP : X).normalize();
    const e2 = new THREE.Vector3().crossVectors(axis, e1);
    piece.mesh.updateWorldMatrix(true, false);
    let lift = 0;
    for (let pass = 0; pass < 5; pass++) {
      let worst = 0;
      for (const [back, radius] of TORCH.rings) {
        for (let k = 0; k < 12; k++) {
          const a = (k / 12) * Math.PI * 2;
          _probe.copy(hit.point).addScaledVector(nW, lift).addScaledVector(axis, back)
            .addScaledVector(e1, Math.cos(a) * radius).addScaledVector(e2, Math.sin(a) * radius);
          piece.mesh.worldToLocal(_probe);
          const inside = -sd(_probe.x, _probe.y, _probe.z) * stone.scale;
          if (inside > worst) worst = inside;
        }
      }
      if (worst <= 0.0015) break;
      lift += worst + 0.003;
    }
    lift += 0.004; // a hair of daylight, so the bezel never z-fights the skin
    const face = hit.point.clone().addScaledVector(nW, lift);
    torch.group.position.copy(face);
    torch.group.quaternion.setFromUnitVectors(Z, axis);

    // The side of the bezel that stands off the stone is where light gets out.
    const gap = lean.clone().multiplyScalar(-1).projectOnPlane(axis).normalize();
    torch.leak.position.copy(gap).applyQuaternion(torch.group.quaternion.clone().invert()).multiplyScalar(TORCH.rim * 0.85);
    torch.light.position.copy(face).addScaledVector(gap, TORCH.rim * 0.9).addScaledVector(nW, 0.02);
    piece.u.uTorchRim.value = TORCH.rim / stone.scale;
    piece.u.uTorchLeak.value.copy(gap).applyQuaternion(piece.holder.quaternion.clone().invert());
    torch.group.visible = true;
    torch.set(power, color);
    return entry;
  }
  function torchOff(stone) {
    if (stone) for (const p of stone.pieces) p.u.uTorchPower.value = 0;
    torch.group.visible = false;
    torch.set(0, torch.light.color);
  }

  // ---------------------------------------------------------------- window
  /**
   * Grind a window at a raycast hit. `spec` is { r, depth, secs } in stone
   * units. Resolves once the window is washed and shining.
   *
   * The stone opens where the burr is. The burr is walked over the window --
   * in at the middle, out in a spiral, once round the rim -- and wherever it
   * bears it leaves its track in the grinding job (stone/grind.js), which is
   * what the shader lets the surface down by.
   */
  async function grindWindow(hit, spec) {
    const piece = hit.object.userData.piece, stone = piece.stone;
    const nObj = hit.face.normal.clone();
    const pStone = stone.toStone(piece, hit.point);
    const nW = nObj.clone().applyQuaternion(piece.holder.quaternion).normalize();
    const at = hit.point.clone();
    const rW = spec.r * stone.scale;

    // look at the work, a little off the normal so the tool does not hide it
    const toCam = stage.camera.position.clone().sub(at).normalize();
    const view = nW.clone().multiplyScalar(0.7).addScaledVector(toCam, 0.45);
    view.y = Math.max(view.y, 0.2);
    view.normalize();
    const camDist = Math.max(rW * 8.5, stone.radius * 1.5 + 1.1);
    stage.flyTo(at.clone().addScaledVector(view, camDist), at.clone(), 0.75);

    const job = await stone.openWindow(piece, pStone, nObj, spec);
    piece.mesh.updateWorldMatrix(true, false);
    let motor = null;
    try {
      // tool frame: Y out of the stone, Z back toward the camera and upward
      const back = toCam.clone().addScaledVector(UP, 0.6).projectOnPlane(nW).normalize();
      const side = new THREE.Vector3().crossVectors(nW, back).normalize();
      grinder.group.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(side, nW, back));
      grinder.group.visible = true;
      const from = at.clone().addScaledVector(nW, 1.2).addScaledVector(back, 0.8);

      // ---- the burr's way over the window
      // What the burr takes to full depth as it passes, and the rounded wall of its groove beyond that.
      const bit = Math.max(Math.min(0.05 / stone.scale, job.reachMin * 0.6), spec.r * 0.18), wall = bit * 1.55;
      // Out from the middle in a spiral tight enough that each turn overlaps the
      // last, then once round the rim to true up the edge. The dish is an oval
      // with a wandering edge, and the spiral is drawn to fit it.
      const turns = Math.min(6, Math.max(0.5, (job.reachMean - bit * 0.85) / (bit * 1.15)));
      const sweep = TAU * (turns + 1), a0 = Math.random() * TAU;
      const spot = (f, out) => {
        const ang = a0 + f * sweep, k = Math.min(1, (f * sweep) / (TAU * turns));
        const rho = k * Math.max(job.reachAt(ang) - bit * 0.85, 0) * (1 + 0.04 * Math.sin(ang * 3.3 + 1) * Math.sin(k * Math.PI)); // (a hand, not a lathe)
        return out.set(Math.cos(ang) * rho, Math.sin(ang) * rho);
      };
      // the same path by distance travelled, so the burr moves at a steady pace
      const STEPS = 240, along = new Float32Array(STEPS + 1), q0 = new THREE.Vector2(), q1 = new THREE.Vector2();
      spot(0, q0);
      for (let i = 1; i <= STEPS; i++) { along[i] = along[i - 1] + spot(i / STEPS, q1).distanceTo(q0); q0.copy(q1); }
      const length = along[STEPS];
      const atDistance = (s, out) => {
        let i = 1;
        while (i < STEPS && along[i] < s) i++;
        return spot((i - 1 + (s - along[i - 1]) / Math.max(along[i] - along[i - 1], 1e-9)) / STEPS, out);
      };
      const bear = new THREE.Vector3(), here = new THREE.Vector2();
      /** Bring the burr down on a spot of the window; returns where that is in the world. */
      const touch = (press) => {
        job.stamp(here.x, here.y, bit, wall, press);
        return piece.mesh.localToWorld(job.contact(here.x, here.y, bear));
      };

      // it comes in already running, and the water with it
      const first = piece.mesh.localToWorld(job.contact(0, 0, new THREE.Vector3()));
      motor = sfx.grinder(); // (heard spinning up as it comes in)
      await anim.tween(0.4, (k) => { grinder.group.position.lerpVectors(from, first, k); grinder.setSpin(k * 1.5); grinder.wheel.rotation.y = k * 9; }, ease.outCubic);

      // What flies off is the stone itself: sand off the skin, then rind, fog and flesh as the burr goes down.
      const tint = new THREE.Color(), paste = new THREE.Color(), haze = new THREE.Color();
      const crumb = () => {
        const floor = job.depthAt(here.x, here.y);
        return stone.crumb(piece.mesh.worldToLocal(_probe.copy(bear)), tint, Math.random() * (floor + 0.004));
      };

      const PLUNGE = 0.24, secs = PLUNGE + spec.secs;
      let spin = 0, acc = 0, last = 0, gone = 0;
      await anim.tween(secs, (k) => {
        const dt = (k - last) * secs, t = k * secs; last = k;
        spin += dt * 70;
        grinder.wheel.rotation.y = spin;
        let pos;
        if (t < PLUNGE) {
          // the burr sinks in where it was set down
          here.set(0, 0);
          pos = touch(ease.outQuad(t / PLUNGE));
        } else {
          const x = (t - PLUNGE) / spec.secs, s = (x * x * (3 - 2 * x) * 0.3 + x * 0.7) * length;
          // every spot between the last frame and this one is ground, however long the frame was
          const n = Math.max(1, Math.ceil((s - gone) / (bit * 0.3)));
          for (let i = 1; i <= n; i++) { atDistance(gone + ((s - gone) * i) / n, here); pos = touch(1); }
          gone = s;
        }
        grinder.group.position.copy(pos);
        const a = a0 + (gone / Math.max(length, 1e-6)) * sweep;
        motor.set(1, 0.55 + 0.45 * Math.sin(a * 1.7) * Math.sin(t * 16));
        acc += dt;
        if (acc > 0.03) {
          acc = 0;
          haze.copy(crumb()).lerp(PALE, 0.35);
          paste.copy(PALE).lerp(crumb(), 0.5).multiplyScalar(0.72); // powder in water: mud the colour of what was ground, a shade darker for being wet
          fx.sparks.emit(pos, { count: 2, speed: 5, dir: side.clone().multiplyScalar(Math.cos(a)).addScaledVector(nW, 0.5), spread: 0.5, color: [2.6, 1.3, 0.4], life: 0.22 });
          fx.puffs.emit(pos, { count: 1, color: [haze.r, haze.g, haze.b], size: [0.05, 0.42], speed: 0.6, life: 0.7, alpha: 0.3, dir: nW, jitter: rW });
          if (Math.random() < 0.6) fx.slurry.emit(pos, { count: 1, speed: 2.2, dir: nW.clone().addScaledVector(side, Math.cos(a)), spread: 0.7, scale: [0.35, 0.8], life: 1.2, color: paste });
          if (Math.random() < 0.25) fx.chips.emit(pos, { count: 1, speed: 2.5, dir: nW, spread: 0.9, scale: [0.3, 0.8], life: 1.6, color: crumb });
        }
        stage.shake(0.0035);
      }, ease.linear);
      motor.stop();
      // the burr comes away; whatever fringe it left standing goes with its last touch
      const lift = grinder.group.position.clone();
      anim.tween(0.35, (k) => { grinder.group.position.lerpVectors(lift, from, k); grinder.setSpin(1 - k); }, ease.inCubic).then(() => { grinder.group.visible = false; });
      await anim.tween(0.18, (k) => job.settle(k), ease.outQuad);
      job.end();

      // a squirt of water, a wipe, and the window shines
      await wait(0.1);
      sfx.squirt();
      fx.water.emit(at.clone().addScaledVector(nW, 0.5), { count: 26, speed: 2.4, dir: nW.clone().multiplyScalar(-1), spread: 0.5, scale: [0.4, 1], life: 0.9, jitter: rW });
      fx.puffs.emit(at, { count: 4, color: 0xdfeaf2, size: [0.1, rW * 3], speed: 0.4, life: 0.6, alpha: 0.22, jitter: rW });
      sfx.wipe();
      await anim.tween(0.7, (k) => stone.polishWindow(job.index, k), ease.outCubic);
    } catch (err) {
      if (motor) motor.stop();
      grinder.group.visible = false;
      throw err;
    } finally {
      // (whatever went wrong, the window is in the stone: show it as it is)
      job.end();
      stone.polishWindow(job.index, 1);
    }
    return { stone, piece, index: job.index, at };
  }

  // ---------------------------------------------------------------- saw
  /** Pour water over fresh faces and let the slurry run off. */
  async function wash(stone, pieces) {
    sfx.pour();
    for (const p of pieces) {
      const c = p.holder.position.clone();
      for (let i = 0; i < 3; i++) {
        wait(i * 0.16).then(() => {
          fx.water.emit(c.clone().add(V(0, p.radius * stone.scale + 0.9, 0)), { count: 30, speed: 1.6, dir: V(0, -1, 0), spread: 0.35, scale: [0.5, 1.2], life: 1.0, jitter: p.radius * stone.scale });
          fx.puffs.emit(c.clone().add(V(0, 0.3, 0)), { count: 3, color: 0xdfeaf2, size: [0.2, p.radius * stone.scale * 2.2], speed: 0.5, life: 0.8, alpha: 0.18, jitter: 0.4 });
        });
      }
    }
    const w0 = stone.shared.uWet.value;
    await anim.tween(1.5, (k) => {
      for (const p of pieces) p.u.uSlurry.value = 1 - k;
      stone.shared.uWet.value = w0 + (1 - w0) * k;
    }, ease.inOutQuad);
    for (const p of pieces) p.u.uSlurry.value = 0;
  }

  /**
   * Saw a piece along a plane (stone space: n . p = d). Plays the whole cut
   * and resolves with the two halves, parted but still caked in slurry. The
   * caller decides when to wash them.
   */
  async function sawCut(stone, piece, n, d, onPhase = () => {}) {
    const prepping = stone.prepareCut(piece, n, d);
    prepping.catch(() => {});
    const nS = V(n[0], n[1], n[2]);
    piece.u.uLaser.value.set(n[0], n[1], n[2], d);
    piece.u.uLaserOn.value = 1;

    // ---- onto the saw: the cut plane becomes the blade's plane, x = 0
    const nW = nS.clone().applyQuaternion(piece.holder.quaternion);
    const sign = nW.x < 0 ? -1 : 1;
    const quat = new THREE.Quaternion().setFromUnitVectors(nW.clone().multiplyScalar(sign).normalize(), X).multiply(piece.holder.quaternion);
    const off = (nS.dot(piece.center) - d) * stone.scale * sign;
    for (const other of stone.pieces) {
      // everything else is cleared well off to the sides, out of the machine's way
      if (other !== piece) carry(stone, other, other.holder.quaternion.clone(), other.holder.position.x < 0 ? -6.5 : 6.5, 2.2, 0.7, true);
    }

    // Measure the piece as it will lie on the saw table, and size the machine to it.
    const q0 = piece.holder.quaternion.clone();
    piece.holder.quaternion.copy(quat);
    const H = stone.extent(piece, UP)[1] + stone.restHeight(piece, quat);
    const [zLo, zHi] = stone.extent(piece, Z);
    const [xLo, xHi] = stone.extent(piece, X);
    piece.holder.quaternion.copy(q0);
    const reach = Math.max(-zLo, zHi);
    const left = -(off + xLo), right = off + xHi; // how far the stone reaches either side of the blade
    const R = Math.max(H * 0.95, reach * 1.45, Math.max(left, right) * 0.95, 1.1);
    const yStart = H + R + 0.2, yEnd = R * 0.6; // the blade finishes in the slot in the table
    const park = yStart + 0.9;
    const T = saw.table;
    saw.root.scale.setScalar(R);
    saw.root.position.set(0, 0, -sawPark(R));
    saw.head.position.y = park / R;
    saw.setJaws(T.jawOpen, T.jawOpen);
    saw.setSpin(0);
    saw.setCoolant(false);
    saw.root.visible = true;
    stage.flyTo(V(R * 1.55 + 2.3, H * 0.7 + R * 0.95 + 1.5, R * 2.7 + 3.3), V(0, H * 0.5 + R * 0.22, -R * 0.15), 1.1);
    onPhase('saw');

    // the stone goes down first; the machine is run up to it from the back of the bench
    const carried = carry(stone, piece, quat, off, 0, 0.85);
    await wait(0.4);
    sfx.machineRoll();
    await anim.tween(0.95, (k) => { saw.root.position.z = -sawPark(R) * (1 - k); }, ease.outCubic);
    await carried;
    sfx.thud(1);
    stage.shake(0.012);
    // jaws in, one from each side of the blade
    const gripL = Math.max(0.2, left / R), gripR = Math.max(0.2, right / R);
    sfx.vise(true); // the screws run in and the jaws bite as they meet the stone
    await anim.tween(0.4, (k) => saw.setJaws(T.jawOpen + (gripL - T.jawOpen) * k, T.jawOpen + (gripR - T.jawOpen) * k), ease.inOutCubic);

    const motor = sfx.saw();
    motor.set(0.7, 0);
    piece.mesh.updateWorldMatrix(true, false);
    const setBlade = (y) => {
      saw.head.position.y = y / R;
      piece.u.uSawB.value.copy(piece.mesh.worldToLocal(V(0, y, 0)));
    };
    piece.u.uKerf.value.set(n[0], n[1], n[2], d);
    piece.u.uSawR.value = R / stone.scale;
    piece.u.uSawA.value.copy(piece.mesh.worldToLocal(V(0, yStart, 0)));
    piece.u.uSawB.value.copy(piece.u.uSawA.value);
    piece.u.uSawOn.value = 1;
    let spin = 0;
    // spin up, bring the head down to the stone, water on
    await anim.tween(0.75, (k) => {
      spin += 0.12 + 0.6 * k;
      saw.blade.rotation.x = spin;
      saw.setSpin(k);
      saw.head.position.y = (park + (yStart - park) * k) / R;
    }, ease.inOutCubic);
    saw.setCoolant(true);
    const coolant = sfx.coolant();
    piece.u.uLaserOn.value = 0;

    // ---- the cut: fast in air, slow and loud in stone
    // What the blade throws is the stone it is in at that moment: skin as it goes in, then flesh.
    const tint = new THREE.Color(), paste = new THREE.Color(), haze = new THREE.Color();
    const crumb = () => {
      // somewhere low on the stretch of the cut the rim is in
      _probe.set(0, Math.max(y - R, 0.02) + Math.random() * Math.min(0.4, H * 0.3), (Math.random() - 0.5) * reach * 1.6);
      piece.mesh.worldToLocal(_probe);
      return stone.crumb(_probe, tint, Math.max(0, -stone.field.sd(_probe.x, _probe.y, _probe.z)));
    };
    const secs = 2.3 + Math.min(2.2, H * 0.55);
    let last = 0, acc = 0, y = yStart;
    await anim.tween(secs, (k) => {
      const dt = (k - last) * secs; last = k;
      spin += dt * 55;
      saw.blade.rotation.x = spin;
      saw.setSpin(1);
      y = yStart + (yEnd - yStart) * k;
      setBlade(y);
      const bottom = y - R;
      const biting = bottom < H && bottom > -R * 0.35;
      const load = biting ? 0.55 + 0.35 * Math.sin(k * 23) + 0.1 * Math.random() : 0;
      motor.set(1, Math.max(0, load));
      acc += dt;
      if (biting && acc > 0.03) {
        acc = 0;
        // slurry leaves where the rim comes out of the stone, thrown forward and down
        const yy = Math.max(bottom, 0.04) + Math.random() * 0.1;
        const half = Math.sqrt(Math.max(R * R - (y - yy) * (y - yy), 0));
        const front = V(0, yy, Math.min(half, reach) * 0.95);
        paste.copy(PALE).lerp(crumb(), 0.4).multiplyScalar(0.72); // the same mud that cakes the sawn face, wet
        haze.copy(crumb()).lerp(PALE, 0.6);
        fx.slurry.emit(front, { count: 3, speed: 5.5, dir: V(0, -0.15, 1), spread: 0.45, scale: [0.4, 1.1], life: 1.3, color: paste });
        fx.water.emit(front, { count: 2, speed: 6.5, dir: V(0, 0.1, 1), spread: 0.5, scale: [0.3, 0.8], life: 1.0 });
        fx.puffs.emit(front, { count: 1, color: [haze.r, haze.g, haze.b], size: [0.15, 1.2], speed: 1.3, life: 0.9, alpha: 0.2, dir: V(0, 0.4, 1) });
        if (Math.random() < 0.35) fx.sparks.emit(front, { count: 3, speed: 7, dir: V(0, 0.2, 1), spread: 0.6, color: [2.4, 1.2, 0.4], life: 0.2 });
        if (Math.random() < 0.3) fx.puffs.emit(V(0, Math.min(H, bottom + 0.2), 0), { count: 1, color: [haze.r, haze.g, haze.b], size: [0.1, 0.7], speed: 0.6, life: 0.8, alpha: 0.2 });
        stage.shake(0.006);
      }
    }, (t) => t * t * (3 - 2 * t) * 0.35 + t * 0.65);
    motor.set(0.6, 0);

    // ---- blade out and run down; the halves are what the jaws are left holding
    const prep = await prepping;
    saw.setCoolant(false);
    coolant.stop();
    motor.stop();
    await anim.tween(0.8, (k) => {
      spin += 0.7 * (1 - k) + 0.03;
      saw.blade.rotation.x = spin;
      saw.setSpin(1 - k);
      saw.head.position.y = (yEnd + (park - yEnd) * k) / R;
    }, ease.inOutCubic);
    const halves = stone.commitCut(prep);
    for (const h of halves) { h.u.uSlurryPlane.value.set(n[0], n[1], n[2], d); h.u.uSlurry.value = 1; }
    sfx.vise(false);
    await anim.tween(0.35, (k) => saw.setJaws(gripL + (T.jawOpen - gripL) * k, gripR + (T.jawOpen - gripR) * k), ease.inOutCubic);
    // the machine is run back out of the way
    sfx.machineRoll();
    await anim.tween(0.7, (k) => { saw.root.position.z = -sawPark(R) * k; }, ease.inCubic);
    saw.root.visible = false;
    onPhase('part');
    return halves;
  }

  /** Ease the two halves apart and turn their faces up, still caked in slurry. */
  async function partHalves(stone, halves) {
    sfx.part();
    await Promise.all(halves.map((h, i) => {
      const x0 = h.holder.position.x, dir = i === 0 ? -1 : 1;
      return anim.tween(0.9, (k) => { h.holder.position.x = x0 + dir * 0.55 * k; }, ease.outCubic);
    }));
  }

  // ---------------------------------------------------------------- flip
  async function flip(stone, piece) {
    piece.flipped = !piece.flipped;
    const quat = FLIP.clone().multiply(piece.holder.quaternion);
    sfx.whoosh(0.25);
    await carry(stone, piece, quat, piece.holder.position.x, piece.holder.position.z, 0.6);
  }

  /** A shower of coins and light for a cut that came good. */
  function celebrate(at, tier, size = 1) {
    // sized to the stone, so a pebble is not buried under its own winnings
    const s = Math.min(1.1, Math.max(0.3, size * 0.75));
    stage.flash(0.12 + 0.1 * tier, [1, 0.9, 0.6]);
    stage.shockwave(at, 0.5 + 0.3 * tier);
    stage.impact(at, { zoom: 0.25 * tier, chroma: 0.3 * tier });
    stage.glow(0.12 * tier);
    fx.coins.emit(at.clone().add(V(0, 1.2 * s, 0)), { count: 14 * tier * tier, speed: (6 + tier * 2) * s, dir: UP, spread: 0.8, up: 5 * s, scale: [0.8 * s, 1.2 * s], life: 3.2 });
    fx.sparks.emit(at.clone().add(V(0, 0.8 * s, 0)), { count: 40 * tier, speed: 9 * s, color: [3, 2.2, 0.8], life: 0.7, gravity: 0.2 });
    setTimeout(() => stage.glow(0), 1800);
  }

  return { carry, showQuat, rowTargets, layout, benchView, aimTorch, torchOff, grindWindow, sawCut, partHalves, wash, flip, celebrate };
}
