// A stone on screen: its volume textures, the pieces it has been sawn into,
// the windows ground into its skin, and the appraiser that prices it.
import * as THREE from 'three';
import { makeField, KERF, weightKg } from './gen.js';
import { createAppraiser } from './appraise.js';
import { createStoneUniforms, createJadeMaterial, MAX_WINDOWS, MAX_PLANES } from './material.js';
import { createGrind } from './grind.js';

let nextId = 1;
const _m = new THREE.Matrix4();
const _o = {};
const _white = new THREE.Color(0.85, 0.85, 0.82);
const lin = (r, g, b) => [r ** 2.2, g ** 2.2, b ** 2.2];
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const step01 = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Body colour of the flesh, linear RGB: the shader's jadeAlbedo, for whatever is broken off the stone. */
function fleshColor(U, g, pur, yel, blk) {
  const hue = U.uHue.value, h = Math.abs(hue), body = U.uBodyColor.value;
  const gVivid = mix3(lin(0.20, 0.76, 0.30), hue < 0 ? lin(0.10, 0.58, 0.56) : lin(0.55, 0.78, 0.18), h * 0.6);
  const gPale = mix3(lin(0.74, 0.92, 0.76), hue < 0 ? lin(0.72, 0.90, 0.92) : lin(0.86, 0.93, 0.70), h * 0.6);
  const gDeep = mix3(lin(0.0, 0.42, 0.17), hue < 0 ? lin(0.0, 0.33, 0.33) : lin(0.16, 0.42, 0.05), h * 0.5);
  const gc = g < 0.5 ? mix3(gPale, gVivid, g * 2) : mix3(gVivid, gDeep, (g - 0.5) * 2);
  let c = mix3([body.r, body.g, body.b], gc, 1 - Math.exp(-g * 6.5));
  const tone = U.uPurpleTone.value;
  c = mix3(c, mix3(mix3(lin(0.86, 0.74, 0.92), lin(0.76, 0.78, 0.95), tone), mix3(lin(0.55, 0.34, 0.70), lin(0.42, 0.40, 0.76), tone), pur), 1 - Math.exp(-pur * 3.2));
  const yc = mix3(lin(0.95, 0.70, 0.18), lin(0.74, 0.22, 0.06), U.uYellowRed.value).map((x) => x * (1 - 0.3 * yel));
  c = mix3(c, yc, 1 - Math.exp(-yel * 3.6));
  return mix3(c, lin(0.05, 0.065, 0.055), step01(0.12, 0.7, blk));
}

function volumeTexture(data, n) {
  const t = new THREE.Data3DTexture(data, n, n, n);
  t.format = THREE.RGBAFormat;
  t.type = THREE.UnsignedByteType;
  // (mip levels are for the torch: its light is traced through blurred copies of the volume)
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.wrapS = t.wrapT = t.wrapR = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}

function geometryOf(m) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3));
  g.setAttribute('aNormal0', new THREE.BufferAttribute(m.normals0, 3));
  g.setAttribute('aDepth', new THREE.BufferAttribute(m.depth, 1));
  g.setAttribute('aCap', new THREE.BufferAttribute(m.cap, 1));
  g.setIndex(new THREE.BufferAttribute(m.indices, 1));
  g.computeBoundingSphere();
  return g;
}

export class StoneView {
  static async create(def, factory, noiseTex) {
    const id = nextId++;
    const { baked, mesh } = await factory.grow(id, def);
    return new StoneView(id, def, baked, mesh, factory, noiseTex);
  }

  constructor(id, def, baked, mesh, factory, noiseTex) {
    this.id = id;
    this.def = def;
    this.factory = factory;
    this.field = makeField(def);
    this.app = createAppraiser(def, baked, this.field);
    this.cells = baked.cells;
    this.texA = volumeTexture(baked.texA, baked.n);
    this.texB = volumeTexture(baked.texB, baked.n);
    this.shared = createStoneUniforms(def, this.texA, this.texB, noiseTex);
    this.scale = def.unitCm / 10; // stone units -> world decimetres
    this.kg = weightKg(def, mesh.volume);
    this.root = new THREE.Group();
    this.windows = [];
    this.pieces = [];
    this.fleshAt = def.skinT + def.fogT;
    this.whole = this._addPiece([], mesh);
    this.radius = this.whole.radius * this.scale;
  }

  _addPiece(planes, meshData) {
    const mat = createJadeMaterial(this.shared);
    const u = mat.userData.u;
    u.uScale.value = this.scale;
    u.uPlaneN.value = Math.min(planes.length, MAX_PLANES);
    planes.slice(-MAX_PLANES).forEach((p, i) => u.uPlanes.value[i].set(p.s * p.n[0], p.s * p.n[1], p.s * p.n[2], p.s * p.d - KERF * 0.5));
    const mesh = new THREE.Mesh(geometryOf(meshData), mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const holder = new THREE.Group();
    holder.scale.setScalar(this.scale);
    holder.add(mesh);
    const piece = { stone: this, planes, mesh, mat, u, holder, center: new THREE.Vector3(), volume: 0, radius: 1, kg: 0 };
    mesh.userData.piece = piece;
    this._measure(piece, meshData);
    this.root.add(holder);
    this.pieces.push(piece);
    return piece;
  }

  _measure(piece, m) {
    piece.center.fromArray(m.center);
    piece.volume = m.volume;
    piece.kg = weightKg(this.def, m.volume);
    piece.mesh.position.copy(piece.center).multiplyScalar(-1);
    let r2 = 0;
    const p = m.positions;
    for (let i = 0; i < p.length; i += 3) {
      const dx = p[i] - m.center[0], dy = p[i + 1] - m.center[1], dz = p[i + 2] - m.center[2];
      r2 = Math.max(r2, dx * dx + dy * dy + dz * dz);
    }
    piece.radius = Math.sqrt(r2);
  }

  /** Height the holder must sit at for the piece to rest on the bench in this pose. */
  restHeight(piece, quat) {
    const e = _m.makeRotationFromQuaternion(quat).elements;
    const p = piece.mesh.geometry.attributes.position.array, c = piece.center;
    let minY = Infinity;
    for (let i = 0; i < p.length; i += 3) {
      const y = e[1] * (p[i] - c.x) + e[5] * (p[i + 1] - c.y) + e[9] * (p[i + 2] - c.z);
      if (y < minY) minY = y;
    }
    return -minY * this.scale;
  }

  /** Extent of the piece along a world direction, about its centre: [lo, hi] in world units. */
  extent(piece, dir) {
    const q = piece.holder.quaternion.clone().invert();
    const d = dir.clone().applyQuaternion(q);
    const p = piece.mesh.geometry.attributes.position.array, c = piece.center;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < p.length; i += 3) {
      const v = d.x * (p[i] - c.x) + d.y * (p[i + 1] - c.y) + d.z * (p[i + 2] - c.z);
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    return [lo * this.scale, hi * this.scale];
  }

  /** Place a piece: orientation, then horizontal position; it settles onto the bench. */
  place(piece, quat, x, z) {
    piece.holder.quaternion.copy(quat);
    piece.holder.position.set(x, this.restHeight(piece, quat), z);
  }

  // ---------------------------------------------------------------- windows
  /**
   * Start a window at a point on a piece (stone space). The geometry is carved
   * to its full depth at once, but drawn filled in: the grinding job that comes
   * back (grind.js) is what lets it down, spot by spot, as the burr is run over
   * it. Call its end() when the burr is done.
   */
  async openWindow(piece, point, normal, spec) {
    if (this.windows.length >= MAX_WINDOWS) throw new Error('too many windows');
    const index = this.windows.length;
    // the way the oval is squeezed: any direction lying in the surface
    const t = new THREE.Vector3(Math.sin(index * 2.4 + point.x * 9), Math.cos(index * 1.7 + point.y * 7), Math.sin(index + point.z * 5)).cross(normal).normalize();
    const w = {
      c: [point.x, point.y, point.z], r: spec.r, depth: spec.depth, o: (index * 7.31 + point.x * 13) % 20,
      dir: [t.x, t.y, t.z], squash: 0.15 + 0.55 * Math.abs(Math.sin(index * 3.3 + point.y * 11)),
      n: [normal.x, normal.y, normal.z],
    };
    this.windows.push(w);
    this.shared.uWin.value[index].set(w.c[0], w.c[1], w.c[2], w.r);
    this.shared.uWinP.value[index].set(0, 0, w.depth, w.o);
    const grind = createGrind(this, piece, w, index);
    grind.begin();
    this.shared.uWinN.value = this.windows.length;
    let m;
    try {
      [m] = await this.factory.mesh(this.id, this.def, [{ planes: piece.planes }], this.windows);
    } catch (err) {
      grind.end();
      throw err;
    }
    piece.mesh.geometry.dispose();
    piece.mesh.geometry = geometryOf(m);
    const quat = piece.holder.quaternion.clone(), pos = piece.holder.position.clone();
    const before = piece.center.clone();
    this._measure(piece, m);
    // keep the piece where it lies: the centre of mass moved a hair
    piece.holder.position.copy(pos).add(piece.center.clone().sub(before).multiplyScalar(this.scale).applyQuaternion(quat));
    return grind;
  }

  /** 0: a window as the burr leaves it, matte under its own slurry. 1: wiped and shining. */
  polishWindow(index, polish) { this.shared.uWinP.value[index].y = polish; }

  /**
   * The colour of a crumb broken off the stone at a point (stone space), into
   * `out` (linear RGB): sandy skin, the dark rind under it, the fog, or the
   * flesh itself. `depth` is how far under the old skin the crumb comes from.
   */
  crumb(p, out, depth = -this.field.sd(p.x, p.y, p.z)) {
    const U = this.shared, { skinT, fogT } = this.def;
    const r1 = Math.random(), r2 = Math.random();
    if (depth < skinT * 0.45) {
      // weathered sand: the skin's own colour, stained here and dirty there
      out.copy(U.uSkinColor.value).lerp(U.uSkinStain.value, r1 * 0.6 * (0.3 + 0.7 * this.def.stainAmt)).lerp(U.uSkinDark.value, r2 * r2 * r2 * 0.45);
    } else if (depth < skinT) {
      out.copy(U.uSkinColor.value).lerp(U.uSkinStain.value, 0.6).multiplyScalar(0.5 + 0.4 * r1);
    } else if (depth < skinT + fogT) {
      const t = (depth - skinT) / Math.max(fogT, 1e-4);
      out.copy(U.uFogColor.value);
      out.r *= 0.52 + 0.48 * t; out.g *= 0.4 + 0.6 * t; out.b *= 0.32 + 0.68 * t;
      out.multiplyScalar(0.8 + 0.3 * r1);
    } else {
      const o = this.field.sample(p.x, p.y, p.z, depth, _o);
      // (colour stops, it does not fade to a haze: the same cut-off the cut face is drawn with)
      const g = Math.min(1, o.g * step01(0.04, 0.24, o.g) * 1.2);
      const c = fleshColor(U, g, o.pur, o.yel, o.blk);
      // a broken face is paler than a sawn one: every crystal scatters light
      out.setRGB(c[0], c[1], c[2]).lerp(_white, 0.22).multiplyScalar(0.82 + 0.25 * r1);
    }
    return out;
  }

  // ---------------------------------------------------------------- sawing
  /** Rough share of a piece's flesh on the positive side of a plane (for validating a cut). */
  splitShare(piece, n, d) {
    let pos = 0, neg = 0;
    const cells = this.cells;
    for (let j = 0; j < cells.n; j++) {
      const x = cells.pos[j * 3], y = cells.pos[j * 3 + 1], z = cells.pos[j * 3 + 2];
      let inside = true;
      for (const p of piece.planes) if (p.s * (x * p.n[0] + y * p.n[1] + z * p.n[2] - p.d) > 0) { inside = false; break; }
      if (!inside) continue;
      if (x * n[0] + y * n[1] + z * n[2] - d > 0) pos += cells.frac[j]; else neg += cells.frac[j];
    }
    return pos + neg > 0 ? pos / (pos + neg) : 0.5;
  }

  /** Mesh the two halves a cut would make (does not change the stone yet). */
  async prepareCut(piece, n, d) {
    const a = [...piece.planes, { n, d, s: 1 }], b = [...piece.planes, { n, d, s: -1 }];
    const meshes = await this.factory.mesh(this.id, this.def, [{ planes: a }, { planes: b }], this.windows);
    return { piece, planes: [a, b], meshes };
  }

  /** Swap a piece for its two halves, lying exactly where the piece lay. */
  commitCut(prep) {
    const parent = prep.piece;
    const quat = parent.holder.quaternion, pos = parent.holder.position;
    const out = [];
    for (let i = 0; i < 2; i++) {
      const child = this._addPiece(prep.planes[i], prep.meshes[i]);
      child.holder.quaternion.copy(quat);
      child.holder.position.copy(pos).add(child.center.clone().sub(parent.center).multiplyScalar(this.scale).applyQuaternion(quat));
      out.push(child);
    }
    this.root.remove(parent.holder);
    parent.mesh.geometry.dispose();
    parent.mat.dispose();
    // the halves take the parent's place in the row, left one first
    this.pieces.splice(this.pieces.length - 2, 2);
    out.sort((a, b) => a.holder.position.x - b.holder.position.x);
    this.pieces.splice(this.pieces.indexOf(parent), 1, ...out);
    return out;
  }

  /** Every point where flesh is exposed, in stone space (xyz triples). */
  exposedPoints(pieces = this.pieces) {
    const out = [];
    for (const piece of pieces) {
      const g = piece.mesh.geometry;
      const p = g.attributes.position.array, dep = g.attributes.aDepth.array;
      for (let i = 0; i < dep.length; i++) if (dep[i] > this.fleshAt) out.push(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
    }
    return out;
  }

  /** Stone-space point of a world-space hit on a piece. */
  toStone(piece, world) { return piece.mesh.worldToLocal(world.clone()); }
  toWorld(piece, stonePoint) { return piece.mesh.localToWorld(stonePoint.clone()); }

  dispose() {
    for (const p of this.pieces) { p.mesh.geometry.dispose(); p.mat.dispose(); }
    this.texA.dispose(); this.texB.dispose();
    this.factory.drop(this.id);
    this.root.removeFromParent();
  }
}
