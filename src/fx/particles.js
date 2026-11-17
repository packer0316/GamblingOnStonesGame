// Everything that flies off the stone: sparks from the diamond wheel, slurry
// and water thrown by the saw, crumbs of stone, dust, and coins when a cut
// comes good.
//
// Crumbs and slurry take the colour of the stone they came off. Like
// everything else here they are of the moment: thrown out, down beside the
// work, and gone within a second or so.
import * as THREE from 'three';
import { createCoins } from './coins.js';

const GRAVITY = 55; // world units are decimetres
const UPV = new THREE.Vector3(0, 1, 0);
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

let dotTexture = null;
function softDot() {
  if (dotTexture) return dotTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return (dotTexture = new THREE.CanvasTexture(c));
}

const randDir = (out, dir, spread) => {
  let x = Math.random() * 2 - 1, y = Math.random() * 2 - 1, z = Math.random() * 2 - 1;
  const l = Math.hypot(x, y, z) || 1;
  x /= l; y /= l; z /= l;
  if (dir) { x = dir.x + x * spread; y = dir.y + y * spread; z = dir.z + z * spread; }
  out.set(x, y, z);
};
const _d = new THREE.Vector3(), _m4 = new THREE.Matrix4();

/** Bright streaks. */
class Sparks {
  constructor(scene, max = 500) {
    this.max = max;
    this.pos = new Float32Array(max * 6);
    this.col = new Float32Array(max * 6);
    this.p = Array.from({ length: max }, () => ({ life: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, r: 1, g: 1, b: 1, grav: 1 }));
    this.next = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.mesh = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
    scene.add(this.mesh);
  }

  emit(origin, { count = 20, speed = 3, spread = 1, dir = null, color = [3, 1.6, 0.5], life = 0.5, gravity = 0.55 }) {
    for (let i = 0; i < count; i++) {
      const s = this.p[this.next];
      this.next = (this.next + 1) % this.max;
      randDir(_d, dir, spread);
      const v = speed * (0.35 + Math.random() * 0.9);
      s.x = origin.x; s.y = origin.y; s.z = origin.z;
      s.vx = _d.x * v; s.vy = _d.y * v; s.vz = _d.z * v;
      s.max = s.life = life * (0.5 + Math.random());
      s.r = color[0]; s.g = color[1]; s.b = color[2];
      s.grav = gravity;
    }
  }

  update(dt) {
    const { pos, col } = this;
    for (let i = 0; i < this.max; i++) {
      const s = this.p[i];
      const o = i * 6;
      if (s.life <= 0) { col[o] = col[o + 1] = col[o + 2] = col[o + 3] = col[o + 4] = col[o + 5] = 0; continue; }
      s.life -= dt;
      s.vy -= GRAVITY * s.grav * dt;
      s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
      if (s.y < 0.01) { s.y = 0.01; s.vy *= -0.3; s.vx *= 0.6; s.vz *= 0.6; }
      const k = Math.max(s.life / s.max, 0);
      const tail = 0.03;
      pos[o] = s.x; pos[o + 1] = s.y; pos[o + 2] = s.z;
      pos[o + 3] = s.x - s.vx * tail; pos[o + 4] = s.y - s.vy * tail; pos[o + 5] = s.z - s.vz * tail;
      col[o] = s.r * k; col[o + 1] = s.g * k; col[o + 2] = s.b * k;
      col[o + 3] = s.r * k * 0.15; col[o + 4] = s.g * k * 0.15; col[o + 5] = s.b * k * 0.15;
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.color.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- what the instanced solids are made of
const NOISE = /* glsl */ `
  float crumbHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float crumbNoise(vec3 x) {
    vec3 i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(crumbHash(i), crumbHash(i + vec3(1, 0, 0)), f.x), mix(crumbHash(i + vec3(0, 1, 0)), crumbHash(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(crumbHash(i + vec3(0, 0, 1)), crumbHash(i + vec3(1, 0, 1)), f.x), mix(crumbHash(i + vec3(0, 1, 1)), crumbHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }`;

/**
 * Teach a stock material about `aFx`, four numbers every instance carries:
 * x its opacity, y a seed that is its own, z how far it has run from a flying
 * blob into a puddle. `vertex` and `fragment` are spliced in after the stock
 * position and colour; `vLump` is the point of the unscaled solid being drawn.
 */
function instanced(material, key, { vertex = '', fragment = '' } = {}) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aFx;\nvarying vec4 vFx;\nvarying vec3 vLump;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvFx = aFx;\nvLump = position;\n${vertex}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec4 vFx;\nvarying vec3 vLump;\n${NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\ndiffuseColor.a *= vFx.x;\n${fragment}`);
  };
  material.customProgramCacheKey = () => `fx-${key}`;
  return material;
}

/**
 * A crumb of broken stone, one unit across: a rough lump with a few flat
 * faces where it parted from the rest. Every instance is squashed its own way
 * (a flake, a splinter, a lump) and warped by its seed, so no two are alike.
 */
function lumpGeometry() {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.attributes.position, v = new THREE.Vector3();
  const a = new THREE.Vector3(0.6, 0.3, 0.74), b = new THREE.Vector3(-0.5, 0.8, 0.33);
  const breaks = [[0.2, 0.95, 0.24, 0.62], [-0.7, -0.35, 0.62, 0.7], [0.55, -0.6, -0.58, 0.66], [-0.1, 0.2, -0.97, 0.74], [0.9, 0.3, 0.3, 0.8]];
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    v.multiplyScalar(1 + 0.2 * Math.sin(v.dot(a) * 3.1 + 0.7) + 0.12 * Math.sin(v.dot(b) * 5.3 + 2.1));
    for (const [x, y, z, h] of breaks) {
      const d = v.x * x + v.y * y + v.z * z - h;
      if (d > 0) { v.x -= x * d; v.y -= y * d; v.z -= z * d; }
    }
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

const GRIT = {
  vertex: /* glsl */ `{
    float s = aFx.y;
    vec3 d1 = normalize(vec3(sin(s * 12.9898), sin(s * 78.233 + 1.3), sin(s * 37.719 + 2.1)) + 0.001);
    vec3 d2 = normalize(vec3(sin(s * 93.989 + 0.7), sin(s * 17.31 + 4.2), sin(s * 51.07 + 5.9)) + 0.001);
    vec3 dir = normalize(position);
    transformed *= 1.0 + 0.24 * sin(dot(dir, d1) * 3.3 + s * 6.0) + 0.15 * sin(dot(dir, d2) * 5.7 + s * 11.0);
  }`,
  fragment: /* glsl */ `{
    // broken stone: no two faces one tone, a crystal catching the light here, a dark grain there
    vec3 q = vLump * 2.6 + vFx.y * 7.3;
    float n = crumbNoise(q), n2 = crumbNoise(q * 3.3 + 11.0);
    diffuseColor.rgb *= 0.74 + 0.5 * n;
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.45 + 0.03, smoothstep(0.7, 0.82, n2) * 0.6);
    diffuseColor.rgb *= 1.0 - 0.4 * (1.0 - smoothstep(0.16, 0.3, n2));
  }`,
};

const BLOB = {
  vertex: /* glsl */ `{
    // in the air a blob; where it lands it runs out into a puddle with a ragged shore
    float s = aFx.y;
    float a = atan(position.z, position.x + 0.00001);
    transformed.xz *= 1.0 + aFx.z * (0.17 * sin(a * 2.0 + s) + 0.11 * sin(a * 3.0 + s * 2.3) + 0.06 * sin(a * 5.0 + s * 4.1));
  }`,
};

// Slurry is mud, not petals: where it lands it feathers out to nothing at the
// shore, so one splat runs into the next and a spray of them reads as a smear.
const PASTE = {
  vertex: BLOB.vertex,
  fragment: /* glsl */ `{
    float n = crumbNoise(vLump * 2.2 + vFx.y * 3.1);
    diffuseColor.rgb *= 0.8 + 0.34 * n;
    float shore = 1.0 - smoothstep(0.38 + 0.25 * n, 1.0, length(vLump.xz));
    diffuseColor.a *= mix(1.0, shore, vFx.z);
  }`,
};

/** Contact shadows for debris: too small for the shadow map, and without one it floats over the felt. */
class Shades {
  constructor(scene, max, strength) {
    const g = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.fx = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aFx', this.fx);
    const mat = instanced(new THREE.MeshBasicMaterial({
      color: 0x000000, map: softDot(), transparent: true, opacity: strength, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    }), 'shade');
    this.mesh = new THREE.InstancedMesh(g, mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
  }

  set(i, x, y, z, size, alpha) {
    this.mesh.setMatrixAt(i, _m4.makeScale(size, 1, size).setPosition(x, y, z));
    this.fx.array[i * 4] = alpha;
  }

  flush(count) {
    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.fx.needsUpdate = true;
  }
}

/**
 * Instanced little solids: water drops, slurry, crumbs of stone.
 *   unit    size of an instance at scale 1
 *   radius  how high its centre rests above the floor, at scale 1
 *   stick   lands as a splat instead of bouncing, and is gone half a second later
 *   thin    how far a splat thins out as it spreads (water going into the cloth)
 *   grit    a crumb of stone: its own shape, and it comes to rest lying flat
 *   shade   darkness of the contact shadow under it (0: none)
 */
class Burst {
  constructor(scene, geometry, material, max, { unit = 1, radius = 0.012, bounce = 0.4, stick = false, thin = 0, grit = false, shade = 0 } = {}) {
    Object.assign(this, { max, unit, radius, bounce, stick, thin, grit, next: 0, drawn: 0 });
    this.fx = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aFx', this.fx);
    this.mesh = new THREE.InstancedMesh(geometry, material, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.shades = shade ? new Shades(scene, max, shade) : null;
    this.p = Array.from({ length: max }, () => ({
      life: 0, pos: new THREE.Vector3(), vel: new THREE.Vector3(), q: new THREE.Quaternion(), to: new THREE.Quaternion(), spin: new THREE.Vector3(),
      size: 1, sx: 1, sy: 1, sz: 1, wide: 1, thick: 1, splat: 0, turn: 0, seed: 0, rest: false, shown: false,
    }));
    this._m = new THREE.Matrix4(); this._s = new THREE.Vector3(); this._q = new THREE.Quaternion(); this._a = new THREE.Vector3();
    scene.add(this.mesh);
  }

  /** `color`: a THREE.Color (linear) for the whole burst, or a function giving one for each instance. */
  emit(origin, { count = 20, speed = 2.5, dir = null, spread = 1, scale = [0.6, 1.4], life = 3, up = 0, jitter = 0, color = null }) {
    const col = this.mesh.instanceColor.array;
    for (let n = 0; n < count; n++) {
      const i = this.next, s = this.p[i];
      this.next = (i + 1) % this.max;
      randDir(_d, dir, spread);
      const v = speed * (0.3 + Math.random());
      s.pos.copy(origin);
      if (jitter) s.pos.x += (Math.random() - 0.5) * jitter, s.pos.y += (Math.random() - 0.5) * jitter, s.pos.z += (Math.random() - 0.5) * jitter;
      s.vel.set(_d.x * v, _d.y * v + up, _d.z * v);
      s.q.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      s.spin.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(26);
      // crumbs come a great many small to a few large
      const size = this.unit * (scale[0] + (this.grit ? Math.pow(Math.random(), 2.4) : Math.random()) * (scale[1] - scale[0]));
      s.size = s.sx = s.sy = s.sz = size;
      if (this.grit) {
        // a flake, a splinter or a lump; y is always its thin way, so it can be laid flat
        const k = Math.random(), a = Math.random(), b = Math.random();
        if (k < 0.42) { s.sx = size * (1 + 0.5 * a); s.sy = size * (0.2 + 0.2 * b); s.sz = size * (0.7 + 0.4 * b); }
        else if (k < 0.62) { s.sx = size * (1.4 + 0.8 * a); s.sy = size * (0.3 + 0.2 * b); s.sz = size * (0.35 + 0.25 * a); }
        else { s.sx = size * (0.85 + 0.3 * a); s.sy = size * (0.6 + 0.25 * b); s.sz = size * (0.8 + 0.35 * b); }
      }
      s.wide = size * (2.1 + 1.1 * Math.random()); s.thick = size * (0.14 + 0.1 * Math.random());
      s.life = life * (0.7 + Math.random() * 0.6);
      s.rest = false; s.splat = 0; s.turn = 0; s.shown = true;
      s.seed = Math.random() * 100;
      const c = typeof color === 'function' ? color() : color;
      const tone = c ? 0.86 + Math.random() * 0.28 : 1;
      col[i * 3] = c ? c.r * tone : 1; col[i * 3 + 1] = c ? c.g * tone : 1; col[i * 3 + 2] = c ? c.b * tone : 1;
    }
    this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt) {
    const { _m, _s, _q, _a } = this;
    const fx = this.fx.array;
    let top = -1, dirty = false;
    for (let i = 0; i < this.max; i++) {
      const s = this.p[i];
      if (s.life <= 0) {
        if (s.shown) { s.shown = false; this.mesh.setMatrixAt(i, ZERO); if (this.shades) this.shades.set(i, 0, 0, 0, 0, 0); dirty = true; }
        continue;
      }
      dirty = true; top = i;
      s.life -= dt;
      const lie = this.grit ? s.sy * 0.7 : this.stick ? s.thick * 0.3 : (this.radius * s.size) / this.unit; // centre above the bench at rest
      if (!s.rest) {
        s.vel.y -= GRAVITY * dt;
        s.pos.addScaledVector(s.vel, dt);
        const w = s.spin.length();
        if (w > 0.01) { _q.setFromAxisAngle(_a.copy(s.spin).multiplyScalar(1 / w), w * dt); s.q.premultiply(_q); }
        if (s.pos.y < lie) {
          s.pos.y = lie;
          if (this.stick) { s.rest = true; s.q.setFromAxisAngle(UPV, s.seed); s.life = Math.min(s.life, 0.5); }
          else if (s.vel.y < -3) { s.vel.y *= -this.bounce; s.vel.x *= 0.6; s.vel.z *= 0.6; s.spin.multiplyScalar(0.5); }
          else {
            s.rest = true;
            if (this.grit) {
              // a crumb turns onto its flat side as it comes to rest
              _q.setFromAxisAngle(_a.set(Math.random() - 0.5, 0, Math.random() - 0.5).normalize(), (Math.random() - 0.5) * 0.3);
              s.to.setFromAxisAngle(UPV, Math.random() * 6.283).premultiply(_q);
              s.turn = 0.12;
            }
          }
        }
      }
      if (s.turn > 0) { s.q.slerp(s.to, Math.min(1, dt / s.turn)); s.turn -= dt; }

      // everything shrinks away over its last third of a second
      const k = s.life <= 0 ? 0 : Math.min(s.life / 0.35, 1);
      const alpha = 1 - this.thin * s.splat;
      let foot; // half-width of what it covers on the bench
      if (this.stick) {
        if (s.rest) {
          s.splat = Math.min(1, s.splat + dt / 0.16);
          const e = 1 - (1 - s.splat) * (1 - s.splat);
          foot = s.size + (s.wide - s.size) * e;
          _s.set(foot * k, (s.size + (s.thick - s.size) * e) * k, foot * k);
          _m.compose(s.pos, s.q, _s);
        } else {
          // stretched along the way it is going
          const sp = s.vel.length(), st = Math.min(1, sp / 9);
          foot = s.size;
          _s.set(s.size * (1 - 0.3 * st) * k, s.size * (1 + 1.5 * st) * k, s.size * (1 - 0.3 * st) * k);
          _m.compose(s.pos, _q.setFromUnitVectors(UPV, _a.copy(s.vel).multiplyScalar(1 / Math.max(sp, 1e-4))), _s);
        }
      } else {
        foot = Math.max(s.sx, s.sz);
        _m.compose(s.pos, s.q, _s.set(s.sx * k, s.sy * k, s.sz * k));
      }
      this.mesh.setMatrixAt(i, _m);
      fx[i * 4] = alpha; fx[i * 4 + 1] = s.seed; fx[i * 4 + 2] = s.splat;
      if (this.shades) {
        const h = Math.max(0, s.pos.y - lie);
        // (the lamp is over the player's right shoulder: the shadow falls away from it, further the higher the crumb)
        const far = h + lie * 1.5;
        this.shades.set(i, s.pos.x - far * 0.29, 0.003, s.pos.z - far * 0.5, foot * 4.2 * (1 + h * 1.2), k / (1 + h * h * 60));
      }
    }
    if (dirty || this.drawn > 0) {
      this.drawn = top + 1;
      this.mesh.count = this.drawn;
      this.mesh.instanceMatrix.needsUpdate = true;
      this.fx.needsUpdate = true;
      if (this.shades) this.shades.flush(this.drawn);
    }
  }

  clear() { for (const s of this.p) if (s.life > 0) s.life = Math.min(s.life, 0.3); }
}

/** Soft puffs: stone dust, water mist, flashes. */
class Puffs {
  constructor(scene, max = 120) {
    const tex = softDot();
    this.items = [];
    for (let i = 0; i < max; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0 }));
      sp.visible = false;
      sp.renderOrder = 19;
      scene.add(sp);
      this.items.push({ sp, life: 0, max: 1, vel: new THREE.Vector3(), s0: 0.1, s1: 0.4, a: 0.5 });
    }
    this.next = 0;
  }

  emit(origin, { count = 6, color = 0xcfd8e0, size = [0.08, 0.5], speed = 0.5, life = 0.9, alpha = 0.35, dir = null, additive = false, jitter = 0.05, rise = 0 }) {
    for (let i = 0; i < count; i++) {
      const it = this.items[this.next];
      this.next = (this.next + 1) % this.items.length;
      it.sp.position.set(origin.x + (Math.random() - 0.5) * jitter, origin.y + (Math.random() - 0.5) * jitter, origin.z + (Math.random() - 0.5) * jitter);
      it.vel.set(Math.random() - 0.5, Math.random() - 0.3 + rise, Math.random() - 0.5).multiplyScalar(speed);
      if (dir) it.vel.addScaledVector(dir, speed);
      it.max = it.life = life * (0.6 + Math.random() * 0.8);
      it.s0 = size[0]; it.s1 = size[1] * (0.7 + Math.random() * 0.6);
      it.a = alpha;
      if (Array.isArray(color)) it.sp.material.color.setRGB(color[0], color[1], color[2]);
      else it.sp.material.color.set(color);
      it.sp.material.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
      it.sp.material.depthTest = !additive;
      it.sp.material.rotation = Math.random() * 6.28;
      it.sp.visible = true;
    }
  }

  update(dt) {
    for (const it of this.items) {
      if (it.life <= 0) continue;
      it.life -= dt;
      if (it.life <= 0) { it.sp.visible = false; continue; }
      const k = 1 - it.life / it.max;
      it.sp.position.addScaledVector(it.vel, dt);
      it.vel.multiplyScalar(1 - 1.8 * dt);
      const s = it.s0 + (it.s1 - it.s0) * (1 - Math.pow(1 - k, 2));
      it.sp.scale.set(s, s, 1);
      it.sp.material.opacity = it.a * (1 - k) * Math.min(k * 12, 1);
    }
  }
}

export function createParticles(scene) {
  // (clear, not milk: a drop shows as the glint on it, hardly at all as a body)
  const water = instanced(new THREE.MeshPhysicalMaterial({ color: 0xcfe6f5, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.34, depthWrite: false, envMapIntensity: 2.6 }), 'water', BLOB);
  // stone ground to a paste in water: wet, so it shines a little; its colour comes from the stone
  const slurry = instanced(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0, transparent: true, opacity: 0.92, depthWrite: false, envMapIntensity: 0.5 }), 'slurry', PASTE);
  const crumb = instanced(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0, flatShading: true, envMapIntensity: 0.7 }), 'crumb', GRIT);
  const fx = {
    sparks: new Sparks(scene),
    water: new Burst(scene, new THREE.IcosahedronGeometry(1, 2), water, 420, { unit: 0.03, stick: true, thin: 0.65 }),
    slurry: new Burst(scene, new THREE.IcosahedronGeometry(1, 2), slurry, 420, { unit: 0.03, stick: true, shade: 0.22 }),
    chips: new Burst(scene, lumpGeometry(), crumb, 200, { unit: 0.03, bounce: 0.3, grit: true, shade: 0.8 }),
    coins: createCoins(scene, 260), // rigid bodies of their own (coins.js): they land, lie flat and heap up
    puffs: new Puffs(scene),
    update(dt) { fx.sparks.update(dt); fx.water.update(dt); fx.slurry.update(dt); fx.chips.update(dt); fx.coins.update(dt); fx.puffs.update(dt); },
    clear() { fx.water.clear(); fx.slurry.clear(); fx.chips.clear(); fx.coins.clear(); },
  };
  fx.coins.mesh.castShadow = true;
  fx.chips.mesh.receiveShadow = true;
  fx.slurry.mesh.receiveShadow = true;
  return fx;
}
