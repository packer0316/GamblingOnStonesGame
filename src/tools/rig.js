// The tools of the trade, modelled part by part: the jade torch, the
// flexible-shaft grinder that opens windows, and the water-cooled drop saw.
//
// Nothing here is a loaded asset. Turned parts are lathed from profiles with
// real chamfers (a chamfer is what catches the light on machined metal), cast
// and sheet parts are extruded with bevels, and the surface finishes -- knurling,
// hammer-tone enamel, brushed steel -- are normal maps computed from height
// functions.
import * as THREE from 'three';

const TAU = Math.PI * 2;
const V2 = (x, y) => new THREE.Vector2(x, y);
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// ============================================================ shared helpers
function mesh(geometry, material) {
  const m = new THREE.Mesh(geometry, material);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/**
 * Lathe with a crisp edge at every profile point: each profile segment gets
 * its own flat normal (smooth round the axis). List the profile so the outside
 * is on your right as you walk it -- outward along the bottom, then upward.
 */
function latheGeometry(points, segments = 64) {
  const pos = [], nrm = [], uv = [], idx = [];
  let run = 0;
  const total = points.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - points[i - 1][0], p[1] - points[i - 1][1]) : 0), 0) || 1;
  for (let k = 0; k < points.length - 1; k++) {
    const [r0, y0] = points[k], [r1, y1] = points[k + 1];
    const len = Math.hypot(r1 - r0, y1 - y0);
    if (len < 1e-7) continue;
    const nr = (y1 - y0) / len, ny = -(r1 - r0) / len;
    const base = pos.length / 3;
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * TAU, c = Math.cos(a), s = Math.sin(a);
      pos.push(r0 * c, y0, r0 * s, r1 * c, y1, r1 * s);
      nrm.push(nr * c, ny, nr * s, nr * c, ny, nr * s);
      uv.push(i / segments, run / total, i / segments, (run + len) / total);
    }
    for (let i = 0; i < segments; i++) {
      const a = base + i * 2, b = a + 1, a2 = a + 2, b2 = a + 3;
      idx.push(a, b, a2, b, b2, a2);
    }
    run += len;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}
const lathe = (points, material, segments) => mesh(latheGeometry(points, segments), material);

/** A box with rounded edges, centred on the origin. */
function roundBox(w, h, d, r = 0.02) {
  r = Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4);
  const x = w / 2 - r, y = h / 2 - r;
  const s = new THREE.Shape();
  s.moveTo(-x, -y); s.lineTo(x, -y); s.lineTo(x, y); s.lineTo(-x, y); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: d - 2 * r, bevelEnabled: true, bevelThickness: r, bevelSize: r, bevelSegments: 3, curveSegments: 4 });
  g.center();
  return g;
}

function canvasOf(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}
function textureOf(canvas, { repeat, srgb = true } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}

/** A tiling normal map from a height function h(u, v) in 0..1. */
function normalMap(height, size, strength, repeat) {
  const c = canvasOf(size);
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size, e = 1 / size;
      const h = height(u, v);
      let nx = (h - height((u + e) % 1, v)) * strength, ny = (h - height(u, (v + e) % 1)) * strength;
      const l = Math.hypot(nx, ny, 1);
      nx /= l; ny /= l;
      const o = (x + y * size) * 4;
      img.data[o] = (nx * 0.5 + 0.5) * 255; img.data[o + 1] = (ny * 0.5 + 0.5) * 255; img.data[o + 2] = (1 / l * 0.5 + 0.5) * 255; img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return textureOf(c, { repeat, srgb: false });
}

/** Tiling value noise, 0..1. */
function tileNoise(period, seed) {
  const hash = (i, j) => {
    let h = Math.imul((i % period + period) % period, 374761393) ^ Math.imul((j % period + period) % period, 668265263) ^ Math.imul(seed, 2147483647);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  return (u, v) => {
    const x = u * period, y = v * period, i = Math.floor(x), j = Math.floor(y);
    let fx = x - i, fy = y - j;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    return (hash(i, j) * (1 - fx) + hash(i + 1, j) * fx) * (1 - fy) + (hash(i, j + 1) * (1 - fx) + hash(i + 1, j + 1) * fx) * fy;
  };
}

const tri = (t) => 1 - Math.abs(2 * (t - Math.floor(t)) - 1);
let _finishes = null;
/** Surface finishes shared by the tools (built once). */
function finishes() {
  if (_finishes) return _finishes;
  const n1 = tileNoise(9, 3), n2 = tileNoise(23, 7), n3 = tileNoise(5, 11);
  _finishes = {
    // diamond knurling: two families of grooves crossing
    knurl: (repeat) => { const t = _finishes.knurlBase.clone(); t.repeat.set(repeat[0], repeat[1]); t.needsUpdate = true; return t; },
    knurlBase: normalMap((u, v) => Math.pow(Math.min(tri((u + v) * 4), tri((u - v) * 4)), 0.8), 128, 5, [12, 8]),
    // hammer-tone machine enamel: shallow overlapping dimples
    hammer: normalMap((u, v) => n1(u, v) * 0.6 + n2(u, v) * 0.4, 256, 2.2, [3, 3]),
    // cast iron under paint: coarser, lumpier
    cast: normalMap((u, v) => n3(u, v) * 0.55 + n2(u, v) * 0.45, 256, 3.2, [2, 2]),
    // a screw thread
    thread: normalMap((u, v) => tri(v * 8 + u), 64, 3.5, [1, 14]),
    // fine machining lines round a turned part
    turned: normalMap((u, v) => tri(v * 16) * 0.5 + n2(u, v) * 0.5, 128, 1.1, [1, 4]),
  };
  return _finishes;
}

/**
 * Lathe with normals smoothed along the profile, for forms that are curved
 * rather than turned in steps (a burr's nose). Same profile convention as
 * latheGeometry; v runs along the profile by arc length.
 */
function smoothLatheGeometry(points, segments = 64) {
  const n = points.length;
  const segN = [];
  let total = 0;
  for (let k = 0; k < n - 1; k++) {
    const dr = points[k + 1][0] - points[k][0], dy = points[k + 1][1] - points[k][1], len = Math.hypot(dr, dy) || 1;
    segN.push([dy / len, -dr / len]);
    total += len;
  }
  const pos = [], nrm = [], uv = [], idx = [];
  let run = 0;
  for (let k = 0; k < n; k++) {
    if (k) run += Math.hypot(points[k][0] - points[k - 1][0], points[k][1] - points[k - 1][1]);
    const a = segN[Math.max(0, k - 1)], b = segN[Math.min(n - 2, k)];
    const l = Math.hypot(a[0] + b[0], a[1] + b[1]) || 1;
    const nr = (a[0] + b[0]) / l, ny = (a[1] + b[1]) / l;
    for (let i = 0; i <= segments; i++) {
      const t = (i / segments) * TAU, c = Math.cos(t), s = Math.sin(t);
      pos.push(points[k][0] * c, points[k][1], points[k][0] * s);
      nrm.push(nr * c, ny, nr * s);
      uv.push(i / segments, run / total);
    }
  }
  for (let k = 0; k < n - 1; k++) {
    for (let i = 0; i < segments; i++) {
      const a = k * (segments + 1) + i, b = a + segments + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

const smooth01 = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lcg = (seed) => { let s = seed; return () => { s = (Math.imul(s, 1664525) + 1013904223) | 0; return (s >>> 0) / 4294967296; }; };

/**
 * Dried slurry flecked over a turned part: a colour map, and a roughness /
 * metalness map to go with it (a fleck is matte mud, not metal). `where(v)`
 * is how thickly it lies at v along the part's profile.
 */
function spatterMaps(base, rough, seed, where, count = 1400) {
  const w = 512, h = 256;
  const col = canvasOf(w, h), orm = canvasOf(w, h);
  const gc = col.getContext('2d'), go = orm.getContext('2d');
  gc.fillStyle = base; gc.fillRect(0, 0, w, h);
  go.fillStyle = `rgb(0,${Math.round(rough * 255)},255)`; go.fillRect(0, 0, w, h);
  const rnd = lcg(seed);
  for (let i = 0; i < count; i++) {
    const v = rnd(), keep = rnd() < where(v);
    const x = rnd() * w, y = (1 - v) * h, rx = 0.4 + rnd() ** 3 * 3.2, ry = rx * (0.5 + rnd()), rot = rnd() * 3.14, a = 0.12 + rnd() * 0.34;
    if (!keep) continue;
    for (const dx of [-w, 0, w]) { // the part is round: flecks wrap
      gc.fillStyle = `rgba(186,183,172,${a})`; gc.beginPath(); gc.ellipse(x + dx, y, rx, ry, rot, 0, TAU); gc.fill();
      go.fillStyle = `rgba(0,238,24,${Math.min(1, a * 1.3)})`; go.beginPath(); go.ellipse(x + dx, y, rx, ry, rot, 0, TAU); go.fill();
    }
  }
  return { map: textureOf(col, { repeat: [1, 1] }), orm: textureOf(orm, { repeat: [1, 1], srgb: false }) };
}

function glowTexture() {
  const c = canvasOf(128);
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.12, 'rgba(255,255,255,0.75)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.18)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

// ============================================================ torch
export const TORCH = {
  rim: 0.139, // radius of the bezel that meets the stone
  // [distance back from the face, radius]: rings that must stay outside the stone
  rings: [[0, 0.139], [0.26, 0.139], [0.62, 0.112], [1.14, 0.116]],
};

/**
 * Jade torch, about 13 cm long. Origin at the centre of the face that meets
 * the stone; the body runs back along +Z.
 *
 * The torch is only ever seen in the dark, so its metals carry the studio
 * environment themselves (a material with its own envMap is not dimmed with
 * the room) at a low level: enough to read the machining, never enough to glow.
 */
export function createTorch(env) {
  const fin = finishes();
  const lit = { envMap: env, envMapIntensity: 0.3 };
  const anodised = new THREE.MeshPhysicalMaterial({ color: 0x30343b, metalness: 0.92, roughness: 0.4, clearcoat: 0.15, clearcoatRoughness: 0.5, normalMap: fin.turned, normalScale: V2(0.25, 0.25), ...lit });
  const knurled = new THREE.MeshPhysicalMaterial({ color: 0x2a2d33, metalness: 0.92, roughness: 0.46, normalMap: fin.knurl([13, 9]), normalScale: V2(1.5, 1.5), ...lit });
  const stainless = new THREE.MeshStandardMaterial({ color: 0xd9dde2, metalness: 1, roughness: 0.2, normalMap: fin.turned, normalScale: V2(0.2, 0.2), ...lit, envMapIntensity: 0.45 });
  const copper = new THREE.MeshStandardMaterial({ color: 0xc87446, metalness: 1, roughness: 0.24, ...lit, envMapIntensity: 0.5 });
  const springSteel = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, metalness: 1, roughness: 0.3, ...lit });
  const boot = new THREE.MeshStandardMaterial({ color: 0x121315, metalness: 0, roughness: 0.82, ...lit });
  const oring = new THREE.MeshStandardMaterial({ color: 0xd9601c, metalness: 0, roughness: 0.6, ...lit });
  const glassMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0, 0, 0) });
  const mirror = new THREE.MeshBasicMaterial({ color: new THREE.Color(0, 0, 0), side: THREE.DoubleSide });
  const lamp = new THREE.MeshBasicMaterial({ color: new THREE.Color(0, 0, 0) });
  const pilot = new THREE.MeshBasicMaterial({ color: new THREE.Color(0, 0, 0) });

  const group = new THREE.Group();
  const body = new THREE.Group();
  body.rotation.x = Math.PI / 2; // parts are turned about Y; +Y becomes +Z
  group.add(body);

  // -- crenellated strike bezel: six teeth stand proud of the lens, so light escapes between them
  const TEETH = 6, tooth = 0.024;
  const shapes = [];
  for (let i = 0; i < TEETH; i++) {
    const a0 = (i / TEETH) * TAU + 0.16, a1 = ((i + 1) / TEETH) * TAU - 0.16;
    const s = new THREE.Shape();
    s.absarc(0, 0, 0.138, a0, a1, false);
    s.absarc(0, 0, 0.108, a1, a0, true);
    shapes.push(s);
  }
  const crown = mesh(new THREE.ExtrudeGeometry(shapes, { depth: tooth - 0.006, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 2, curveSegments: 10 }), stainless);
  crown.geometry.rotateX(-Math.PI / 2); // extrude along +Y
  crown.position.y = 0.003;
  body.add(crown);
  body.add(lathe([[0.108, tooth], [0.138, tooth], [0.1405, tooth + 0.004], [0.1405, 0.088], [0.137, 0.093], [0.108, 0.093], [0.108, tooth]], stainless));

  // -- the optics: glass, reflector, emitter
  const glass = new THREE.Mesh(new THREE.CircleGeometry(0.108, 40), glassMat);
  glass.rotation.x = Math.PI / 2; // faces -Y, toward the stone
  glass.position.y = tooth + 0.006;
  body.add(glass);
  const refl = [];
  for (let i = 0; i <= 10; i++) { const t = i / 10; refl.push([0.104 - 0.08 * Math.pow(t, 0.55), tooth + 0.012 + 0.11 * t]); }
  body.add(new THREE.Mesh(latheGeometry(refl, 40), mirror));
  const led = new THREE.Mesh(new THREE.CircleGeometry(0.022, 20), lamp);
  led.rotation.x = Math.PI / 2;
  led.position.y = tooth + 0.12;
  body.add(led);

  // -- head: chamfered barrel with cooling fins turned into it
  const head = [[0.137, 0.093], [0.1395, 0.097], [0.1395, 0.172], [0.137, 0.176]];
  for (let i = 0; i < 5; i++) {
    const y = 0.184 + i * 0.038;
    head.push([0.137, y], [0.118, y + 0.004], [0.118, y + 0.016], [0.137, y + 0.02]);
  }
  head.push([0.137, 0.376], [0.1395, 0.38], [0.1395, 0.412], [0.136, 0.418], [0.116, 0.476], [0.114, 0.5]);
  body.add(lathe(head, anodised));
  // etched band round the head
  const etch = canvasOf(1024, 64);
  {
    const g = etch.getContext('2d');
    g.fillStyle = 'rgba(214,220,228,0.82)';
    g.font = '600 30px "Segoe UI", Arial, sans-serif';
    g.textBaseline = 'middle';
    const text = 'JADE-X3    6500K · 365nm    IPX8    ◆    ';
    for (let x = 0; x < 1024; x += 512) g.fillText(text, x + 6, 34);
  }
  const band = new THREE.Mesh(
    new THREE.CylinderGeometry(0.1402, 0.1402, 0.05, 64, 1, true),
    new THREE.MeshStandardMaterial({ map: textureOf(etch), transparent: true, metalness: 0.2, roughness: 0.7, depthWrite: false, ...lit }),
  );
  band.position.y = 0.134;
  body.add(band);

  // -- copper ring, o-ring, body tube
  body.add(lathe([[0.114, 0.5], [0.121, 0.503], [0.121, 0.52], [0.114, 0.523]], copper));
  const seal = mesh(new THREE.TorusGeometry(0.109, 0.007, 10, 48), oring);
  seal.rotation.x = Math.PI / 2; seal.position.y = 0.531;
  body.add(seal);
  body.add(lathe([[0.104, 0.523], [0.108, 0.538], [0.108, 0.58], [0.1045, 0.585]], anodised));
  const grip = mesh(new THREE.CylinderGeometry(0.105, 0.105, 0.43, 64, 1, true), knurled);
  grip.position.y = 0.8;
  body.add(grip);
  // two plain bands break the knurling
  for (const y of [0.72, 0.9]) body.add(lathe([[0.105, y - 0.012], [0.1075, y - 0.009], [0.1075, y + 0.009], [0.105, y + 0.012]], anodised));

  // -- tail cap with finger flutes, rubber switch and a pilot ring
  const tail = [[0.1045, 1.015], [0.108, 1.02], [0.108, 1.05], [0.112, 1.056]];
  for (let i = 0; i < 4; i++) { const y = 1.066 + i * 0.03; tail.push([0.112, y], [0.105, y + 0.004], [0.105, y + 0.012], [0.112, y + 0.016]); }
  tail.push([0.112, 1.19], [0.107, 1.198], [0.086, 1.204], [0.082, 1.198], [0.07, 1.196]);
  body.add(lathe(tail, anodised));
  const button = mesh(new THREE.SphereGeometry(0.07, 28, 12, 0, TAU, 0, Math.PI / 2), boot);
  button.scale.y = 0.32; button.position.y = 1.194;
  body.add(button);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.074, 0.0022, 6, 48), pilot);
  ring.rotation.x = Math.PI / 2; ring.position.y = 1.2;
  body.add(ring);

  // -- pocket clip: a sprung steel tongue on a collar
  body.add(lathe([[0.108, 0.985], [0.1115, 0.988], [0.1115, 1.012], [0.108, 1.015]], springSteel));
  const path = [[0.116, 1.012], [0.123, 0.99], [0.127, 0.86], [0.125, 0.69], [0.111, 0.64], [0.112, 0.625], [0.128, 0.595]];
  const clipShape = new THREE.Shape();
  path.forEach(([r, y], i) => (i ? clipShape.lineTo(r, y) : clipShape.moveTo(r, y)));
  for (let i = path.length - 1; i >= 0; i--) clipShape.lineTo(path[i][0] + 0.007, path[i][1]);
  clipShape.closePath();
  const clip = mesh(new THREE.ExtrudeGeometry(clipShape, { depth: 0.044, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 1 }), springSteel);
  clip.position.z = -0.022;
  body.add(clip);

  // -- light that gets out: a glow at the gap between bezel and stone, and a
  //    faint bloom round the whole head
  const glowMap = glowTexture();
  const sprite = (size) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowMap, color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    s.scale.setScalar(size);
    s.renderOrder = 18;
    return s;
  };
  const leak = sprite(0.3), halo = sprite(0.9);
  halo.position.z = 0.03;
  group.add(leak, halo);

  // The lamp's spill lives in the scene, not in this group: hiding a light
  // changes the scene's light count, and every material would recompile.
  // It is kept faint and short: a torch pressed to a stone lights the stone
  // from inside, and anything that floods the skin hides exactly that.
  const light = new THREE.PointLight(0xfff0d8, 0, 1.5, 2);
  group.traverse((o) => { if (o.isMesh && o.material !== glassMat && o.material !== mirror && o.material !== lamp && o.material !== pilot) o.castShadow = true; });
  group.visible = false;
  return {
    group, light, leak,
    set(power, color) {
      glassMat.color.copy(color).multiplyScalar(2.6 * power);
      mirror.color.copy(color).multiplyScalar(1.4 * power);
      lamp.color.copy(color).multiplyScalar(5 * power);
      pilot.color.setRGB(0.03 * power, 0.42 * power, 0.16 * power); // a standby LED, not a second lamp
      leak.material.color.copy(color); leak.material.opacity = 0.42 * power;
      halo.material.color.copy(color); halo.material.opacity = 0.05 * power;
      light.color.copy(color);
      light.intensity = 0.16 * power;
    },
  };
}

// ============================================================ grinder
/** A coil of wire wound round the Z axis, its radius easing from r0 to r1. */
class Coil extends THREE.Curve {
  constructor(z0, z1, r0, r1, turns) { super(); Object.assign(this, { z0, z1, r0, r1, turns }); }
  getPoint(t, target = new THREE.Vector3()) {
    const a = t * this.turns * TAU, r = this.r0 + (this.r1 - this.r0) * t;
    return target.set(Math.cos(a) * r, Math.sin(a) * r, this.z0 + (this.z1 - this.z0) * t);
  }
}

/**
 * Flexible-shaft handpiece with a sintered diamond burr: the tool that opens
 * a window.
 *
 * Origin at the burr's contact point. The stone's surface is the group's XZ
 * plane and the handpiece leans back along +Z, so it is its upper side the
 * camera sees. True to size: a 13 mm burr on a 3 mm shank, a 24 mm handpiece.
 *
 * Everything the spindle turns (burr, shank, collet and its nut) is in
 * `wheel`, which the job spins; setSpin fades their detail into the smear a
 * fast tool shows, and turns the water on.
 */
export function createGrinder() {
  const fin = finishes();
  const R = 0.066; // radius of the burr
  const group = new THREE.Group();
  const lean = new THREE.Group();
  lean.rotation.x = -0.9;
  lean.position.set(0, R, 0);
  group.add(lean);
  // Turned parts are made about Y, as on the lathe; `axis` lays that along the
  // handpiece (lean +Z). y is the distance back from the centre of the burr.
  const axis = new THREE.Group();
  axis.rotation.x = Math.PI / 2;
  const wheel = new THREE.Group();
  wheel.rotation.x = Math.PI / 2;
  lean.add(axis, wheel);

  // (satin, and lit a little beyond what the room reflects: seen end-on from the
  // operator's side a true mirror shows only the dark ceiling and reads as black)
  const stainless = new THREE.MeshStandardMaterial({ color: 0xd9dde2, metalness: 0.92, roughness: 0.34, normalMap: fin.turned, normalScale: V2(0.22, 0.22), envMapIntensity: 1.9 });
  const polished = new THREE.MeshStandardMaterial({ color: 0xe8ebee, metalness: 1, roughness: 0.25 }); // ground, not mirror: a mirror rod under the lamp is one long glare
  const anodised = new THREE.MeshPhysicalMaterial({ color: 0x22252b, metalness: 0.9, roughness: 0.4, clearcoat: 0.2, clearcoatRoughness: 0.45, normalMap: fin.turned, normalScale: V2(0.2, 0.2) });
  const blackOxide = new THREE.MeshStandardMaterial({ color: 0x16181b, metalness: 0.85, roughness: 0.42 });
  const copper = new THREE.MeshStandardMaterial({ color: 0xc87446, metalness: 1, roughness: 0.26 });
  const brassMat = new THREE.MeshStandardMaterial({ color: 0xc09a48, metalness: 1, roughness: 0.3 });
  const hollow = new THREE.MeshBasicMaterial({ color: 0x030303 });

  // ---------------------------------------------------------------- burr
  // Diamond grit plated on in nickel, with spiral gullets to carry the water,
  // and a bare steel collar at the back where the plating stops.
  // (u round the burr, t from its tip to its back)
  const GULLETS = 5, BARE = 0.925;
  const gullet = (u, t) => {
    const s = Math.abs(((((u * GULLETS + t * 3.4) % 1) + 1) % 1) - 0.5);
    return Math.max(0, 1 - s / 0.075) * smooth01(0.36, 0.43, t) * (1 - smooth01(0.84, 0.895, t));
  };
  const gA = tileNoise(113, 21), gB = tileNoise(47, 4), gC = tileNoise(11, 9);
  const colC = canvasOf(512, 256), ormC = canvasOf(512, 256), blurC = canvasOf(8, 256);
  {
    const gc = colC.getContext('2d'), go = ormC.getContext('2d'), gb = blurC.getContext('2d');
    const col = gc.createImageData(512, 256), orm = go.createImageData(512, 256), blur = gb.createImageData(8, 256);
    const rnd = lcg(77);
    for (let y = 0; y < 256; y++) {
      const t = 1 - y / 255;
      let sr = 0, sg = 0, sb = 0;
      for (let x = 0; x < 512; x++) {
        const u = x / 512, grit = gA(u, t) * 0.6 + gB(u, t) * 0.4, patch = gC(u, t);
        // nickel bond, a shade warm: pale where the grit stands proud, dark in the pits between
        let r = 150 + 120 * (grit - 0.5) + 24 * (patch - 0.5), g = 147 + 116 * (grit - 0.5) + 22 * (patch - 0.5), b = 138 + 108 * (grit - 0.5) + 18 * (patch - 0.5);
        let rough = 0.58 - 0.22 * (grit - 0.5), metal = 0.92;
        // worn bright on the shoulder of the nose, where it bears on the stone
        const wear = Math.exp(-((t - 0.34) ** 2) / 0.01) * 0.28;
        r += 60 * wear; g += 60 * wear; b += 58 * wear; rough -= 0.2 * wear;
        // a diamond standing out of the bond: a point of light, or a dark one seen edge-on
        const d = rnd();
        if (d < 0.045) { r += 95; g += 98; b += 104; rough = 0.1; metal = 0.3; } else if (d < 0.075) { r *= 0.45; g *= 0.45; b *= 0.47; }
        // the gullets are dark; dried slurry lies in them and creeps up from the back
        const gl = gullet(u, t);
        r *= 1 - 0.78 * gl; g *= 1 - 0.78 * gl; b *= 1 - 0.76 * gl;
        const mud = Math.min(1, gl * (0.15 + 0.7 * patch) + smooth01(0.72, 0.92, t) * (0.1 + 0.5 * patch));
        r += (208 - r) * mud * 0.7; g += (204 - g) * mud * 0.7; b += (192 - b) * mud * 0.7;
        rough += (0.92 - rough) * mud; metal *= 1 - 0.85 * mud;
        // past the plating: turned steel
        const bare = smooth01(BARE - 0.006, BARE + 0.006, t);
        const lineTone = 196 + 18 * Math.sin(t * 900);
        r += (lineTone - r) * bare; g += (lineTone + 3 - g) * bare; b += (lineTone + 8 - b) * bare;
        rough += (0.24 - rough) * bare; metal += (1 - metal) * bare;
        const o = (x + y * 512) * 4;
        col.data[o] = r; col.data[o + 1] = g; col.data[o + 2] = b; col.data[o + 3] = 255;
        orm.data[o] = 0; orm.data[o + 1] = rough * 255; orm.data[o + 2] = metal * 255; orm.data[o + 3] = 255;
        sr += r; sg += g; sb += b;
      }
      // What a turning burr shows: every ring of it averaged round, a little
      // uneven from ring to ring, and greyed by the slurry it is running in.
      const ring = 0.78 + 0.24 * rnd(), wetMud = t < BARE ? 0.16 : 0.06;
      for (let x = 0; x < 8; x++) {
        const o = (x + y * 8) * 4;
        blur.data[o] = (sr / 512) * ring * (1 - wetMud) + 205 * wetMud; blur.data[o + 1] = (sg / 512) * ring * (1 - wetMud) + 202 * wetMud;
        blur.data[o + 2] = (sb / 512) * ring * (1 - wetMud) + 192 * wetMud; blur.data[o + 3] = 255;
      }
    }
    gc.putImageData(col, 0, 0); go.putImageData(orm, 0, 0); gb.putImageData(blur, 0, 0);
  }
  const burrOrm = textureOf(ormC, { repeat: [1, 1], srgb: false });
  const burrMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, map: textureOf(colC, { repeat: [1, 1] }), roughnessMap: burrOrm, metalnessMap: burrOrm, roughness: 1, metalness: 1,
    normalMap: normalMap((u, v) => (0.55 * gA(u, 1 - v) + 0.45 * gB(u, 1 - v)) * (1 - smooth01(BARE - 0.006, BARE + 0.006, 1 - v)) - 1.4 * gullet(u, 1 - v), 512, 3.6, [1, 1]),
    normalScale: V2(1, -1), envMapIntensity: 1.5,
  });
  const burrBlur = new THREE.MeshStandardMaterial({
    color: 0xffffff, map: textureOf(blurC), metalness: 0.6, roughness: 0.46, envMapIntensity: 1.3,
    transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  // a barrel with a domed nose
  const head = [[0.0006, -0.108]];
  for (let i = 1; i <= 8; i++) { const a = (i / 8) * (Math.PI / 2); head.push([R * Math.sin(a), -0.05 - 0.058 * Math.cos(a)]); }
  head.push([R + 0.001, -0.02], [R + 0.0015, 0.008], [R + 0.001, 0.034], [R, 0.05], [R - 0.004, 0.058], [R - 0.012, 0.0625]);
  const headGeo = smoothLatheGeometry(head, 72);
  wheel.add(mesh(headGeo, burrMat));
  const smear = new THREE.Mesh(headGeo, burrBlur);
  smear.renderOrder = 3;
  wheel.add(smear);
  // its steel body shows at the back, then the shank
  wheel.add(lathe([[R - 0.012, 0.0625], [0.032, 0.066], [0.03, 0.068], [0.03, 0.082], [0.027, 0.086], [0.0155, 0.09]], stainless, 40));
  wheel.add(lathe([[0.0155, 0.09], [0.0155, 0.37]], polished, 20));

  // ---------------------------------------------------------------- collet, nut, spindle (all turning)
  const slitC = canvasOf(64, 8);
  {
    const g = slitC.getContext('2d');
    g.fillStyle = '#c9cdd3'; g.fillRect(0, 0, 64, 8);
    g.fillStyle = '#0a0b0c';
    for (let i = 0; i < 4; i++) g.fillRect(i * 16 + 7, 0, 2, 8); // the four saw cuts that let a collet close
  }
  const colletMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: textureOf(slitC, { repeat: [1, 1] }), metalness: 1, roughness: 0.3 });
  wheel.add(lathe([[0.0165, 0.292], [0.022, 0.292], [0.035, 0.33], [0.035, 0.352]], colletMat, 32));
  const hex = new THREE.Shape();
  for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU, x = Math.cos(a) * 0.047, y = Math.sin(a) * 0.047; if (i) hex.lineTo(x, y); else hex.moveTo(x, y); }
  hex.closePath();
  const nutGeo = new THREE.ExtrudeGeometry(hex, { depth: 0.06, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.005, bevelSegments: 2 });
  nutGeo.rotateX(-Math.PI / 2); // extrude along +Y
  const nut = mesh(nutGeo, new THREE.MeshStandardMaterial({ color: 0xd3d8de, metalness: 0.92, roughness: 0.28, envMapIntensity: 1.9 }));
  nut.position.y = 0.356;
  wheel.add(nut);
  wheel.add(lathe([[0.03, 0.422], [0.041, 0.424], [0.041, 0.5]], stainless, 32));
  const lockHole = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.0835, 12), hollow); // for the pin that holds the spindle while the nut is turned
  lockHole.rotation.z = Math.PI / 2;
  lockHole.position.y = 0.463;
  wheel.add(lockHole);
  // at speed the flats of the nut and the hole in the spindle run together into plain bright rounds
  const roundBlur = new THREE.MeshStandardMaterial({ color: 0xc6cbd1, metalness: 1, roughness: 0.2, transparent: true, opacity: 0, depthWrite: false });
  const nutSmear = new THREE.Mesh(latheGeometry([[0.03, 0.349], [0.0495, 0.349], [0.0515, 0.353], [0.0515, 0.419], [0.0495, 0.423], [0.0418, 0.424], [0.0418, 0.497]], 40), roundBlur);
  nutSmear.renderOrder = 3;
  axis.add(nutSmear);

  // ---------------------------------------------------------------- nose: bearing cap and cone, flecked with dried slurry
  const flecks = spatterMaps('#d9dde2', 0.36, 5, (v) => 0.04 + 0.96 * (1 - v) ** 3, 1000);
  const noseMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, map: flecks.map, roughnessMap: flecks.orm, metalnessMap: flecks.orm, roughness: 1, metalness: 0.92,
    normalMap: fin.turned, normalScale: V2(0.22, 0.22), envMapIntensity: 1.9,
  });
  axis.add(new THREE.Mesh(latheGeometry([[0.0405, 0.4985], [0.05, 0.4985]], 40), hollow)); // the gap the spindle runs in
  axis.add(lathe([
    [0.049, 0.497], [0.064, 0.497], [0.068, 0.502], [0.068, 0.545], [0.064, 0.549], [0.064, 0.559], [0.069, 0.563], // cap, and the groove behind it
    [0.074, 0.569], [0.104, 0.752], [0.11, 0.759], [0.11, 0.792], [0.106, 0.796], [0.099, 0.796],
  ], noseMat, 72));
  const seal = mesh(new THREE.TorusGeometry(0.103, 0.0085, 10, 56), new THREE.MeshStandardMaterial({ color: 0xd9601c, metalness: 0, roughness: 0.6 }));
  seal.rotation.x = Math.PI / 2;
  seal.position.y = 0.806;
  axis.add(seal);

  // ---------------------------------------------------------------- body: collar, knurled grip, etched barrel, coupling
  axis.add(lathe([[0.099, 0.816], [0.114, 0.816], [0.119, 0.821], [0.119, 0.852], [0.116, 0.856], [0.1125, 0.856]], stainless, 72));
  // knurling worn bright on its points, where a thumb has been for years
  const knurlH = (u, v) => Math.pow(Math.min(tri((u + v) * 4), tri((u - v) * 4)), 0.8);
  const wornC = canvasOf(128);
  {
    const g = wornC.getContext('2d'), img = g.createImageData(128, 128);
    for (let y = 0; y < 128; y++) {
      for (let x = 0; x < 128; x++) {
        const w = smooth01(0.7, 1, knurlH(x / 128, y / 128)) * 0.5, o = (x + y * 128) * 4;
        img.data[o] = 30 + 98 * w; img.data[o + 1] = 33 + 102 * w; img.data[o + 2] = 38 + 106 * w; img.data[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
  }
  const grip = mesh(new THREE.CylinderGeometry(0.1135, 0.1135, 0.44, 72, 1, true), new THREE.MeshPhysicalMaterial({
    color: 0xffffff, map: textureOf(wornC, { repeat: [14, 9] }), metalness: 0.92, roughness: 0.44, normalMap: fin.knurl([14, 9]), normalScale: V2(1.6, 1.6),
  }));
  grip.position.y = 1.076;
  axis.add(grip);
  for (const y of [1.0, 1.15]) axis.add(lathe([[0.1135, y - 0.014], [0.117, y - 0.01], [0.117, y + 0.01], [0.1135, y + 0.014]], stainless, 72));
  axis.add(lathe([[0.1135, 1.296], [0.118, 1.301], [0.118, 1.5], [0.115, 1.504]], anodised, 72));
  const etch = canvasOf(1024, 64);
  {
    const g = etch.getContext('2d');
    g.fillStyle = 'rgba(216,222,230,0.85)';
    g.font = '600 29px "Segoe UI", Arial, sans-serif';
    g.textBaseline = 'middle';
    // (one copy centred on the side that faces up, the other underneath)
    for (const x of [-256, 256, 768]) g.fillText('JADEFLEX H-30   35,000 r/min   Ø2.35–4.0   ◆', x + 14, 34);
  }
  const band = new THREE.Mesh(
    new THREE.CylinderGeometry(0.1184, 0.1184, 0.056, 72, 1, true),
    new THREE.MeshStandardMaterial({ map: textureOf(etch), transparent: true, metalness: 0.2, roughness: 0.7, depthWrite: false }),
  );
  band.position.y = 1.4;
  band.rotation.z = Math.PI; // lettered to be read by whoever holds it: from behind, looking down toward the burr
  axis.add(band);
  axis.add(lathe([[0.115, 1.504], [0.1195, 1.507], [0.1195, 1.522], [0.115, 1.525]], copper, 72));
  axis.add(lathe([[0.113, 1.525], [0.113, 1.56], [0.103, 1.7], [0.099, 1.706]], anodised, 72));
  // quick-release collar: straight knurl, so it turns in wet fingers
  const collar = mesh(new THREE.CylinderGeometry(0.099, 0.099, 0.14, 72, 1, true), new THREE.MeshStandardMaterial({
    color: 0xcdd2d8, metalness: 1, roughness: 0.3, normalMap: normalMap((u) => Math.pow(tri(u * 8), 0.7), 64, 4, [9, 1]), normalScale: V2(1.3, 1.3),
  }));
  collar.position.y = 1.776;
  axis.add(collar);
  axis.add(lathe([[0.099, 1.846], [0.095, 1.851], [0.078, 1.851], [0.078, 1.885], [0.074, 1.888], [0.074, 1.897], [0.078, 1.9], [0.078, 1.935], [0.073, 1.94], [0.05, 1.94]], stainless, 56)); // and the ferrule crimped on the sheath

  // ---------------------------------------------------------------- sheath and its spring, away to the motor hanging over the bench
  // (from here on in the handpiece's own frame: Z along it, +Y its upper side)
  const neoprene = new THREE.MeshStandardMaterial({
    color: 0x0d0e10, metalness: 0, roughness: 0.78, normalMap: normalMap((u, v) => tri(u * 4 + v), 64, 2.4, [70, 1]), normalScale: V2(0.9, 0.9),
  });
  const run = new THREE.CatmullRomCurve3([V3(0, 0, 1.92), V3(0, 0, 2.3), V3(0, 0.02, 2.75), V3(0.08, 0.3, 3.5), V3(0.4, 1.4, 4.7), V3(0.9, 4, 6.2), V3(1.2, 9, 8)]);
  lean.add(mesh(new THREE.TubeGeometry(run, 90, 0.05, 14), neoprene));
  lean.add(mesh(new THREE.TubeGeometry(new Coil(1.945, 2.52, 0.066, 0.058, 15), 15 * 22, 0.0072, 6), stainless)); // keeps the sheath from kinking where it leaves the handpiece

  // ---------------------------------------------------------------- water: a drip line clipped along the side, a needle over the burr
  const SIDE = V3(0.985, 0.174, 0); // which way off the axis the line lies: to the side, clear of the lettering on top
  const off = (r, z) => V3(SIDE.x * r, SIDE.y * r, z);
  const rod = (a, b, r, mat) => {
    const m = mesh(new THREE.CylinderGeometry(r, r, a.distanceTo(b), 10), mat);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(V3(0, 1, 0), b.clone().sub(a).normalize());
    return m;
  };
  const pvc = new THREE.MeshPhysicalMaterial({ color: 0xa9d6e6, metalness: 0, roughness: 0.12, transparent: true, opacity: 0.4 });
  const line = new THREE.CatmullRomCurve3([off(0.134, 0.84), off(0.134, 1.3), off(0.132, 1.95), V3(0.1, 0.09, 2.6), V3(0.17, 0.4, 3.5), V3(0.5, 1.5, 4.7), V3(1.0, 4.1, 6.2), V3(1.3, 9, 8)]);
  lean.add(new THREE.Mesh(new THREE.TubeGeometry(line, 90, 0.011, 8), pvc));
  lean.add(rod(off(0.134, 0.79), off(0.134, 0.87), 0.0165, brassMat)); // hose barb
  const needle = new THREE.CatmullRomCurve3([off(0.134, 0.8), off(0.132, 0.66), off(0.116, 0.42), off(0.1, 0.2), off(0.094, 0.11)]);
  lean.add(mesh(new THREE.TubeGeometry(needle, 48, 0.0044, 10), stainless));
  // two clips hold the line to the body
  for (const [y, r] of [[0.836, 0.119], [1.6, 0.11]]) {
    axis.add(lathe([[r, y - 0.011], [r + 0.0025, y - 0.009], [r + 0.0025, y + 0.009], [r, y + 0.011]], blackOxide, 72));
    const saddle = mesh(roundBox(0.03, 0.134 - r + 0.022, 0.02, 0.005), blackOxide);
    saddle.position.copy(off((0.134 + r) / 2 + 0.005, y));
    saddle.rotation.z = -Math.atan2(SIDE.x, SIDE.y);
    lean.add(saddle);
  }
  // the bead that hangs on the needle, and the thread of water that falls on the burr when the tap is open
  const water = new THREE.MeshPhysicalMaterial({ color: 0xd4ecf7, metalness: 0, roughness: 0.03, clearcoat: 1, clearcoatRoughness: 0.03, transparent: true, opacity: 0.42, depthWrite: false });
  const tip = off(0.094, 0.11);
  const bead = new THREE.Mesh(new THREE.SphereGeometry(0.0115, 12, 10), water);
  bead.position.copy(tip).add(V3(0, -0.006, -0.008));
  bead.scale.set(1, 1, 1.35);
  const thread = new THREE.Mesh(new THREE.CylinderGeometry(0.0038, 0.0052, 1, 8), water);
  const wet = off(0.064, 0.04);
  thread.position.copy(tip).add(wet).multiplyScalar(0.5);
  thread.quaternion.setFromUnitVectors(V3(0, 1, 0), wet.clone().sub(tip).normalize());
  thread.scale.y = tip.distanceTo(wet);
  thread.visible = false;
  lean.add(bead, thread);

  group.visible = false;
  return {
    group, wheel,
    /** 0 at rest .. 1 at working speed: grit, gullets and the flats of the nut smear into rings, and the water runs. */
    setSpin(k) {
      k = Math.min(1, Math.max(0, k));
      burrBlur.opacity = k * 0.86;
      roundBlur.opacity = k * 0.85;
      thread.visible = k > 0.05;
      bead.visible = !thread.visible;
    },
  };
}

// ============================================================ saw
const BLADE_SEGMENTS = 30;

/** Brushed steel for the blade core: concentric grind marks, heat tint near the rim, old slurry. */
function bladeSteelTexture() {
  const size = 1024, cx = size / 2;
  const c = canvasOf(size);
  const g = c.getContext('2d');
  g.fillStyle = '#9aa0a7';
  g.fillRect(0, 0, size, size);
  let s = 99;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) | 0; return (s >>> 0) / 4294967296; };
  for (let i = 0; i < 2600; i++) {
    const r = rnd() * cx, a0 = rnd() * TAU, len = 0.15 + rnd() * 1.4;
    g.strokeStyle = `rgba(${rnd() < 0.5 ? '255,255,255' : '18,22,28'},${0.03 + rnd() * 0.09})`;
    g.lineWidth = 0.5 + rnd() * 1.2;
    g.beginPath(); g.arc(cx, cx, r, a0, a0 + len); g.stroke();
  }
  // heat tint just inside the segments, dried slurry flung outward
  const grad = g.createRadialGradient(cx, cx, cx * 0.15, cx, cx, cx);
  grad.addColorStop(0, 'rgba(0,0,0,0.3)'); grad.addColorStop(0.3, 'rgba(0,0,0,0)');
  grad.addColorStop(0.78, 'rgba(120,96,60,0)'); grad.addColorStop(0.9, 'rgba(120,96,60,0.28)'); grad.addColorStop(1, 'rgba(206,202,190,0.4)');
  g.fillStyle = grad; g.fillRect(0, 0, size, size);
  // maker's ring of text
  g.save();
  g.translate(cx, cx);
  g.fillStyle = 'rgba(20,24,30,0.75)';
  g.font = '700 26px Arial, sans-serif';
  g.textAlign = 'center';
  const text = 'DIAMOND  Ø400 × 2.4 × 25.4   MAX 3200 r/min   JADE & STONE   ';
  for (let i = 0; i < text.length; i++) { g.save(); g.rotate((i / text.length) * TAU); g.fillText(text[i], 0, -cx * 0.36); g.restore(); }
  g.restore();
  const t = textureOf(c);
  t.repeat.set(0.5, 0.5); t.offset.set(0.5, 0.5); // extruded caps are mapped in shape units (-1..1)
  return t;
}

/** What the spinning blade smears into: rings, no teeth. */
function bladeBlurTexture() {
  const size = 512, cx = size / 2;
  const c = canvasOf(size);
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(cx, cx, 0, cx, cx, cx);
  const stops = [
    [0, '90,95,102,1'], [0.16, '120,125,132,1'], [0.47, '150,156,163,1'], [0.5, '112,117,124,1'], [0.56, '112,117,124,1'], [0.59, '150,156,163,1'],
    [0.64, '132,137,144,1'], [0.8, '132,137,144,1'], [0.83, '156,160,165,1'], [0.862, '150,150,148,1'], [0.87, '128,118,96,0.92'],
    [0.925, '150,124,78,0.9'], [0.985, '166,136,82,0.88'], [1, '166,136,82,0'],
  ];
  for (const [at, rgba] of stops) grad.addColorStop(at, `rgba(${rgba})`);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  // the streaks a fast wheel shows under a lamp
  g.globalCompositeOperation = 'source-atop';
  let s = 5;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) | 0; return (s >>> 0) / 4294967296; };
  for (let i = 0; i < 220; i++) {
    g.strokeStyle = `rgba(${rnd() < 0.5 ? '255,255,255' : '10,12,16'},${0.03 + rnd() * 0.05})`;
    g.lineWidth = 1 + rnd() * 3;
    g.beginPath(); g.arc(cx, cx, rnd() * cx, 0, TAU); g.stroke();
  }
  return textureOf(c);
}

function plateTexture(draw, w = 512, h = 256) {
  const c = canvasOf(w, h);
  draw(c.getContext('2d'), w, h);
  return textureOf(c);
}

/**
 * Water-cooled drop saw for stone.
 *
 * Everything is in blade radii: the blade has radius 1, lies in the plane
 * x = 0, and its centre is the origin of `head`. Scale `root` to the blade the
 * cut needs. `head` rides the column: set head.position.y to the height of the
 * blade's centre above the table. The operator stands at +X, +Z.
 */
export function createSaw() {
  const fin = finishes();
  const enamel = new THREE.MeshPhysicalMaterial({ color: 0x2f6f5c, metalness: 0.25, roughness: 0.42, clearcoat: 0.55, clearcoatRoughness: 0.28, normalMap: fin.hammer, normalScale: V2(0.55, 0.55) });
  const castPaint = new THREE.MeshPhysicalMaterial({ color: 0x2a5f50, metalness: 0.3, roughness: 0.5, clearcoat: 0.35, clearcoatRoughness: 0.4, normalMap: fin.cast, normalScale: V2(0.8, 0.8) });
  const castIron = new THREE.MeshStandardMaterial({ color: 0x8a9098, metalness: 0.7, roughness: 0.46, normalMap: fin.cast, normalScale: V2(0.5, 0.5), envMapIntensity: 1.6 });
  const machined = new THREE.MeshStandardMaterial({ color: 0xc4cad2, metalness: 1, roughness: 0.3, normalMap: fin.turned, normalScale: V2(0.3, 0.3), envMapIntensity: 1.5 });
  // ground and hard-chromed guide rods: bright, but not a black mirror in a dim room
  const chrome = new THREE.MeshStandardMaterial({ color: 0xeef1f4, metalness: 1, roughness: 0.22, envMapIntensity: 2.2 });
  const blackOxide = new THREE.MeshStandardMaterial({ color: 0x1b1d21, metalness: 0.85, roughness: 0.42 });
  const motorGrey = new THREE.MeshPhysicalMaterial({ color: 0x3d4650, metalness: 0.5, roughness: 0.5, clearcoat: 0.3, clearcoatRoughness: 0.4, normalMap: fin.cast, normalScale: V2(0.4, 0.4) });
  const rubberMat = new THREE.MeshStandardMaterial({ color: 0x0f1012, metalness: 0, roughness: 0.88 });
  const phenolic = new THREE.MeshPhysicalMaterial({ color: 0x0c0c0e, metalness: 0, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.08 });
  const brassMat = new THREE.MeshStandardMaterial({ color: 0xc09a48, metalness: 1, roughness: 0.3 });
  const bronze = new THREE.MeshStandardMaterial({ color: 0xa97c3e, metalness: 0.9, roughness: 0.38 });
  const hoseBlue = new THREE.MeshPhysicalMaterial({ color: 0x1f63b8, metalness: 0, roughness: 0.42, clearcoat: 0.5, clearcoatRoughness: 0.3 });
  const nozzleOrange = new THREE.MeshPhysicalMaterial({ color: 0xe46a1a, metalness: 0, roughness: 0.4, clearcoat: 0.5, clearcoatRoughness: 0.3 });
  const pvc = new THREE.MeshPhysicalMaterial({ color: 0xbfe2ee, metalness: 0, roughness: 0.15, transparent: true, opacity: 0.55 });
  const threadMat = new THREE.MeshStandardMaterial({ color: 0x8e949c, metalness: 1, roughness: 0.4, normalMap: fin.thread, normalScale: V2(1.4, 1.4) });

  const root = new THREE.Group();
  const frame = new THREE.Group(); // stands on the bench
  const head = new THREE.Group(); // rides the column
  root.add(frame, head);

  const hexBolt = new THREE.CylinderGeometry(0.024, 0.024, 0.02, 6);
  const washer = new THREE.CylinderGeometry(0.03, 0.03, 0.005, 16);
  /** A hex bolt head on a washer; `axis` is the way the head points. */
  const bolt = (parent, x, y, z, axis = 'y', scale = 1) => {
    const g = new THREE.Group();
    const a = mesh(hexBolt, blackOxide), b = mesh(washer, machined);
    a.position.y = 0.012; b.position.y = 0.0025;
    g.add(a, b);
    g.scale.setScalar(scale);
    if (axis === 'x') g.rotation.z = -Math.PI / 2;
    else if (axis === '-x') g.rotation.z = Math.PI / 2;
    else if (axis === 'z') g.rotation.x = Math.PI / 2;
    g.position.set(x, y, z);
    parent.add(g);
    return g;
  };

  // ---------------------------------------------------------------- blade
  const blade = new THREE.Group();
  head.add(blade);
  {
    const N = BLADE_SEGMENTS, gap = 0.03, rCore = 0.927, rGullet = 0.865;
    const P = (r, a) => [Math.cos(a) * r, Math.sin(a) * r];
    // steel core, notched between the segments
    const core = new THREE.Shape();
    for (let i = 0; i < N; i++) {
      const a0 = (i / N) * TAU + gap / 2, a1 = ((i + 1) / N) * TAU - gap / 2, mid = ((i + 1) / N) * TAU;
      if (i === 0) core.moveTo(...P(rCore, a0));
      core.absarc(0, 0, rCore, a0, a1, false);
      core.lineTo(...P(rGullet + 0.012, a1));
      core.quadraticCurveTo(...P(rGullet - 0.012, mid), ...P(rGullet + 0.012, mid + gap / 2)); // keyhole bottom of the gullet
      core.lineTo(...P(rCore, mid + gap / 2));
    }
    const hole = (cx, cy, rx, ry, rot = 0) => { const h = new THREE.Path(); h.absellipse(cx, cy, rx, ry, 0, TAU, true, rot); core.holes.push(h); };
    hole(0, 0, 0.05, 0.05);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      hole(Math.cos(a) * 0.53, Math.sin(a) * 0.53, 0.04, 0.04); // lightening holes
      const b = a + TAU / 12;
      hole(Math.cos(b) * 0.72, Math.sin(b) * 0.72, 0.016, 0.085, b + 0.5); // laser-cut expansion slots
    }
    const coreMesh = mesh(
      new THREE.ExtrudeGeometry(core, { depth: 0.012, bevelEnabled: false, curveSegments: 6 }),
      new THREE.MeshStandardMaterial({ map: bladeSteelTexture(), color: 0xffffff, metalness: 0.72, roughness: 0.36, envMapIntensity: 1.8 }),
    );
    coreMesh.geometry.translate(0, 0, -0.006);
    coreMesh.geometry.rotateY(Math.PI / 2);
    blade.add(coreMesh);
    // sintered diamond segments, proud of the core on both faces
    const segs = [];
    for (let i = 0; i < N; i++) {
      const a0 = (i / N) * TAU + gap / 2, a1 = ((i + 1) / N) * TAU - gap / 2;
      const s = new THREE.Shape();
      s.absarc(0, 0, 1, a0, a1, false);
      s.absarc(0, 0, rCore - 0.004, a1, a0, true);
      segs.push(s);
    }
    const rim = mesh(
      new THREE.ExtrudeGeometry(segs, { depth: 0.016, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.002, bevelSegments: 1, curveSegments: 4 }),
      new THREE.MeshStandardMaterial({ color: 0xa5834a, metalness: 0.75, roughness: 0.62, normalMap: fin.cast, normalScale: V2(0.6, 0.6) }),
    );
    rim.geometry.translate(0, 0, -0.008);
    rim.geometry.rotateY(Math.PI / 2);
    blade.add(rim);
    // arbor: flanges, washer, nut and the thread end
    for (const side of [-1, 1]) {
      const f = lathe([[0.05, 0], [0.165, 0], [0.175, 0.01], [0.175, 0.024], [0.15, 0.034], [0.09, 0.04], [0.05, 0.04]], machined, 48);
      f.rotation.z = side > 0 ? -Math.PI / 2 : Math.PI / 2; // +Y -> ±X
      f.position.x = side * 0.008;
      blade.add(f);
    }
    const nut = mesh(new THREE.CylinderGeometry(0.066, 0.066, 0.05, 6), blackOxide); nut.rotation.z = Math.PI / 2; nut.position.x = 0.075; blade.add(nut);
    const stud = mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.05, 20), threadMat); stud.rotation.z = Math.PI / 2; stud.position.x = 0.12; blade.add(stud);
  }
  // the blur a fast blade smears into: fixed discs just off each face, faded in with speed
  const blurMat = new THREE.MeshStandardMaterial({ map: bladeBlurTexture(), transparent: true, opacity: 0, metalness: 0.7, roughness: 0.3, envMapIntensity: 1.8, depthWrite: false });
  for (const side of [-1, 1]) {
    const d = new THREE.Mesh(new THREE.CircleGeometry(1.004, 96), blurMat);
    d.rotation.y = (side * Math.PI) / 2;
    d.position.x = side * 0.0125;
    d.renderOrder = 3;
    head.add(d);
  }

  // ---------------------------------------------------------------- spindle, on the far side of the blade
  const spindle = lathe([[0, 0.03], [0.1, 0.03], [0.135, 0.045], [0.135, 0.09], [0.12, 0.1], [0.12, 0.3], [0.14, 0.31], [0.14, 0.36], [0, 0.36]], castPaint, 40);
  spindle.rotation.z = Math.PI / 2; // +Y -> -X
  head.add(spindle);
  const cap = lathe([[0.06, 0.028], [0.1, 0.028], [0.105, 0.034], [0.06, 0.034]], machined, 32);
  cap.rotation.z = Math.PI / 2;
  head.add(cap);
  const nipple = mesh(new THREE.CylinderGeometry(0.012, 0.016, 0.04, 8), brassMat); nipple.position.set(-0.2, 0.15, 0); head.add(nipple);

  // ---------------------------------------------------------------- guard
  // angles run from +Z (front) up over +Y to the back
  const G0 = 0.3, G1 = 3.62, RG = 1.1, GW = 0.125;
  {
    const band = mesh(new THREE.CylinderGeometry(RG, RG, GW * 2, 72, 1, true, G0, G1 - G0), enamel.clone());
    band.material.side = THREE.DoubleSide;
    band.geometry.rotateZ(Math.PI / 2);
    head.add(band);
    const cheekShape = new THREE.Shape();
    cheekShape.absarc(0, 0, RG, G0, G1, false);
    cheekShape.absarc(0, 0, 0.23, G1, G0, true);
    const cheekGeo = new THREE.ExtrudeGeometry(cheekShape, { depth: 0.01, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 1, curveSegments: 48 });
    cheekGeo.translate(0, 0, -0.005);
    cheekGeo.rotateY(-Math.PI / 2); // shape x -> +Z
    const lipCurve = new THREE.CatmullRomCurve3(Array.from({ length: 41 }, (_, i) => { const a = G0 + ((G1 - G0) * i) / 40; return V3(0, Math.sin(a) * RG, Math.cos(a) * RG); }));
    const lipGeo = new THREE.TubeGeometry(lipCurve, 80, 0.016, 8);
    for (const side of [-1, 1]) {
      const cheek = mesh(cheekGeo, enamel); cheek.position.x = side * GW; head.add(cheek);
      const lip = mesh(lipGeo, enamel); lip.position.x = side * GW; head.add(lip);
      for (let i = 0; i < 9; i++) {
        const a = G0 + 0.12 + ((G1 - G0 - 0.24) * i) / 8;
        bolt(head, side * (GW + 0.009), Math.sin(a) * 1.0, Math.cos(a) * 1.0, side > 0 ? 'x' : '-x', 0.8);
      }
    }
    // hub plate on the operator's side, round the arbor
    const hub = lathe([[0.23, 0], [0.34, 0], [0.35, 0.008], [0.35, 0.02], [0.23, 0.02]], castPaint, 40);
    hub.rotation.z = -Math.PI / 2; hub.position.x = GW; head.add(hub);
    for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU + 0.3; bolt(head, GW + 0.02, Math.sin(a) * 0.29, Math.cos(a) * 0.29, 'x', 0.7); }
    // rubber splash flap hanging off the front edge
    const flap = mesh(roundBox(GW * 2 - 0.02, 0.3, 0.014, 0.006), rubberMat);
    flap.position.set(0, Math.sin(G0) * RG - 0.13, Math.cos(G0) * RG + 0.012);
    flap.rotation.x = -0.16;
    head.add(flap);
    const hinge = mesh(new THREE.CylinderGeometry(0.014, 0.014, GW * 2, 10), blackOxide); hinge.rotation.z = Math.PI / 2; hinge.position.set(0, Math.sin(G0) * RG + 0.012, Math.cos(G0) * RG + 0.016); head.add(hinge);
    // maker's plate and warning label
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.2), new THREE.MeshStandardMaterial({
      map: plateTexture((g, w, h) => {
        const grd = g.createLinearGradient(0, 0, w, h); grd.addColorStop(0, '#c9ccd0'); grd.addColorStop(0.5, '#eef0f2'); grd.addColorStop(1, '#b4b8bd');
        g.fillStyle = grd; g.fillRect(0, 0, w, h);
        g.strokeStyle = '#30343a'; g.lineWidth = 5; g.strokeRect(10, 10, w - 20, h - 20);
        g.fillStyle = '#17191c'; g.textBaseline = 'middle';
        g.font = '700 50px "Microsoft JhengHei", "PingFang TC", sans-serif'; g.fillText('翡翠切石機', 30, 62);
        g.font = '600 26px Arial, sans-serif'; g.fillText('MODEL  JC-400W', 30, 122); g.fillText('Ø400   2.2 kW   2800 r/min', 30, 158); g.fillText('No. 26-0417          IP54', 30, 194);
        g.fillStyle = '#1d6b53'; g.fillRect(w - 118, 30, 88, 56); g.fillStyle = '#eef0f2'; g.font = '700 30px Arial'; g.fillText('JC', w - 96, 60);
        for (const [x, y] of [[22, 22], [w - 22, 22], [22, h - 22], [w - 22, h - 22]]) { g.fillStyle = '#5a5f66'; g.beginPath(); g.arc(x, y, 7, 0, TAU); g.fill(); }
      }), metalness: 0.9, roughness: 0.35,
    }));
    plate.rotation.y = Math.PI / 2; plate.position.set(GW + 0.012, 0.72, -0.34); plate.rotation.x = 0; head.add(plate);
    const warn = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), new THREE.MeshStandardMaterial({
      map: plateTexture((g, w, h) => {
        g.fillStyle = '#f2c81e'; g.fillRect(0, 0, w, h);
        g.strokeStyle = '#111'; g.lineWidth = 10; g.strokeRect(8, 8, w - 16, h - 16);
        g.fillStyle = '#111'; g.beginPath(); g.moveTo(w / 2, 34); g.lineTo(w - 50, 150); g.lineTo(50, 150); g.closePath(); g.fill();
        g.fillStyle = '#f2c81e'; g.font = '700 92px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('!', w / 2, 108);
        g.fillStyle = '#111'; g.font = '700 34px "Microsoft JhengHei", sans-serif'; g.fillText('小心鋸片', w / 2, 186); g.font = '700 22px Arial'; g.fillText('ROTATING BLADE', w / 2, 226);
      }, 256, 256), metalness: 0, roughness: 0.55,
    }));
    warn.rotation.y = Math.PI / 2; warn.position.set(GW + 0.012, 0.52, 0.62); head.add(warn);
  }

  // ---------------------------------------------------------------- arm, carriage, motor, belt guard (far side)
  const MY = 0.86, MZ = -0.62; // motor shaft
  {
    // cast swing arm, seen from the side (shape x = +Z, shape y = +Y)
    const arm = new THREE.Shape();
    [[0.16, -0.12], [0.16, 0.1], [-0.2, 0.46], [-0.3, 0.56], [-0.95, 0.56], [-1.5, 0.42], [-1.5, -0.26], [-1.05, -0.26], [-0.62, -0.06], [-0.18, -0.16]]
      .forEach(([x, y], i) => (i ? arm.lineTo(x, y) : arm.moveTo(x, y)));
    arm.closePath();
    const window1 = new THREE.Path(); window1.absellipse(-0.86, 0.2, 0.3, 0.13, 0, TAU, true, 0.12); arm.holes.push(window1);
    const armMesh = mesh(new THREE.ExtrudeGeometry(arm, { depth: 0.13, bevelEnabled: true, bevelThickness: 0.018, bevelSize: 0.018, bevelSegments: 3, curveSegments: 20 }), castPaint);
    armMesh.geometry.translate(0, 0, -0.065);
    armMesh.geometry.rotateY(-Math.PI / 2);
    armMesh.position.x = -0.245;
    head.add(armMesh);
    // carriage block that grips the column
    const carriage = mesh(roundBox(0.92, 0.84, 0.46, 0.03), castPaint);
    carriage.position.set(-0.2, 0.08, -1.72);
    head.add(carriage);
    for (const x of [-0.5, 0.1]) for (const y of [0.5, -0.34]) {
      const bush = lathe([[0.058, 0], [0.085, 0], [0.09, 0.006], [0.09, 0.03], [0.058, 0.03]], bronze, 28);
      bush.position.set(x, y > 0 ? y : y - 0.03, -1.72);
      head.add(bush);
    }
    for (const [x, y] of [[-0.56, 0.42], [0.16, 0.42], [-0.56, -0.26], [0.16, -0.26]]) bolt(head, x, y, -1.485, 'z');
    // clamp lever on the carriage
    const lock = mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.26, 10), machined); lock.rotation.z = Math.PI / 2 - 0.5; lock.position.set(0.36, 0.14, -1.6); head.add(lock);
    const lockKnob = mesh(new THREE.SphereGeometry(0.038, 16, 12), phenolic); lockKnob.position.set(0.47, 0.2, -1.6); head.add(lockKnob);

    // motor: finned TEFC frame, end bells, fan cowl, terminal box
    const finShape = new THREE.Shape();
    const F = 26, r0 = 0.205, r1 = 0.245;
    for (let i = 0; i < F; i++) {
      const a = (i / F) * TAU, w = (TAU / F) * 0.3;
      const pts = [[r0, a - w * 1.6], [r1, a - w], [r1, a + w], [r0, a + w * 1.6]];
      pts.forEach(([r, t], k) => (i === 0 && k === 0 ? finShape.moveTo(Math.cos(t) * r, Math.sin(t) * r) : finShape.lineTo(Math.cos(t) * r, Math.sin(t) * r)));
    }
    finShape.closePath();
    const motor = new THREE.Group();
    motor.position.set(0, MY, MZ);
    head.add(motor);
    const frameGeo = new THREE.ExtrudeGeometry(finShape, { depth: 0.46, bevelEnabled: false });
    frameGeo.translate(0, 0, -0.23); frameGeo.rotateY(Math.PI / 2);
    const mFrame = mesh(frameGeo, motorGrey); mFrame.position.x = 0.05; motor.add(mFrame);
    for (const side of [-1, 1]) {
      const bell = lathe([[0, 0], [0.215, 0], [0.225, 0.01], [0.225, 0.05], [0.16, 0.085], [0.1, 0.095], [0, 0.095]], motorGrey, 40);
      bell.rotation.z = side > 0 ? -Math.PI / 2 : Math.PI / 2;
      bell.position.x = 0.05 + side * 0.23;
      motor.add(bell);
    }
    // fan cowl on the operator's side, with a pierced end
    const cowl = lathe([[0.232, 0], [0.24, 0.006], [0.24, 0.16], [0.226, 0.176], [0, 0.176]], motorGrey, 40);
    cowl.rotation.z = -Math.PI / 2; cowl.position.x = 0.36; motor.add(cowl);
    const grille = new THREE.Mesh(new THREE.CircleGeometry(0.2, 40), new THREE.MeshStandardMaterial({
      map: plateTexture((g, w, h) => {
        g.fillStyle = '#39424c'; g.fillRect(0, 0, w, h);
        g.fillStyle = '#090a0c';
        for (let ring = 1; ring <= 5; ring++) for (let i = 0; i < ring * 9; i++) { const a = (i / (ring * 9)) * TAU + ring; g.beginPath(); g.arc(w / 2 + Math.cos(a) * ring * 23, h / 2 + Math.sin(a) * ring * 23, 6.5, 0, TAU); g.fill(); }
      }, 256, 256), metalness: 0.5, roughness: 0.5,
    }));
    grille.rotation.y = Math.PI / 2; grille.position.x = 0.538; motor.add(grille);
    // terminal box, gland and cable
    const tbox = mesh(roundBox(0.2, 0.1, 0.17, 0.012), motorGrey); tbox.position.set(0.05, 0.285, 0); motor.add(tbox);
    const lid = mesh(roundBox(0.21, 0.016, 0.18, 0.006), blackOxide); lid.position.set(0.05, 0.342, 0); motor.add(lid);
    for (const [x, z] of [[-0.035, -0.07], [0.135, -0.07], [-0.035, 0.07], [0.135, 0.07]]) bolt(motor, x, 0.35, z, 'y', 0.5);
    const gland = mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.06, 6), brassMat); gland.rotation.x = Math.PI / 2; gland.position.set(0.05, 0.285, -0.11); motor.add(gland);
    const cable = mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V3(0.05, 0.285, -0.14), V3(0.05, 0.3, -0.4), V3(-0.05, 0.1, -0.8), V3(-0.2, -0.5, -1.25), V3(-0.25, -0.6, -1.7)]), 30, 0.02, 8), rubberMat);
    motor.add(cable);
    const mPlate = new THREE.Mesh(new THREE.PlaneGeometry(0.17, 0.1), new THREE.MeshStandardMaterial({
      map: plateTexture((g, w, h) => {
        g.fillStyle = '#d7dadd'; g.fillRect(0, 0, w, h); g.strokeStyle = '#444'; g.lineWidth = 4; g.strokeRect(6, 6, w - 12, h - 12);
        g.fillStyle = '#16181b'; g.font = '700 30px Arial'; g.fillText('3~ MOTOR  Y2-90L-2', 20, 44);
        g.font = '600 22px Arial'; g.fillText('2.2 kW   380 V   4.8 A', 20, 84); g.fillText('2840 r/min   50 Hz   IP55', 20, 116); g.fillText('INS. CL. F     S1', 20, 148);
      }, 384, 176), metalness: 0.85, roughness: 0.4,
    }));
    mPlate.position.set(0.05, -0.06, 0.247); motor.add(mPlate);
    // motor foot on the arm
    const foot = mesh(roundBox(0.46, 0.05, 0.4, 0.012), castPaint); foot.position.set(0.0, -0.27, 0); motor.add(foot);
    for (const [x, z] of [[-0.18, -0.15], [0.18, -0.15], [-0.18, 0.15], [0.18, 0.15]]) bolt(motor, x, -0.245, z, 'y', 0.8);
    const post = mesh(roundBox(0.14, 0.08, 0.3, 0.012), castPaint); post.position.set(-0.2, -0.3, 0); motor.add(post);

    // belt guard from spindle to motor, on the far side
    const dz = MZ, dy = MY, len = Math.hypot(dz, dy), ang = Math.atan2(dy, dz), rb = 0.2;
    const belt = new THREE.Shape();
    belt.absarc(0, 0, rb, ang + Math.PI / 2, ang + (Math.PI * 3) / 2, false);
    belt.absarc(dz, dy, rb, ang - Math.PI / 2, ang + Math.PI / 2, false);
    belt.closePath();
    const beltMesh = mesh(new THREE.ExtrudeGeometry(belt, { depth: 0.1, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 3, curveSegments: 24 }), enamel);
    beltMesh.geometry.translate(0, 0, -0.05);
    beltMesh.geometry.rotateY(-Math.PI / 2);
    beltMesh.position.x = -0.46;
    head.add(beltMesh);
    for (const t of [0, 1]) for (const s of [-1, 1]) {
      const cz = dz * t + Math.cos(ang + Math.PI / 2) * s * 0.15, cy = dy * t + Math.sin(ang + Math.PI / 2) * s * 0.15;
      bolt(head, -0.53, cy, cz, '-x', 0.7);
    }
    void len;
  }

  // ---------------------------------------------------------------- feed handle, toward the operator
  {
    const a = V3(0.26, 0.2, -1.55), b = V3(0.62, 0.78, -0.5);
    const rod = mesh(new THREE.CylinderGeometry(0.022, 0.022, a.distanceTo(b), 12), chrome);
    rod.position.copy(a).add(b).multiplyScalar(0.5);
    rod.quaternion.setFromUnitVectors(V3(0, 1, 0), b.clone().sub(a).normalize());
    head.add(rod);
    const boss = mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.08, 16), castPaint); boss.rotation.z = Math.PI / 2; boss.position.copy(a); head.add(boss);
    const knob = mesh(new THREE.SphereGeometry(0.075, 24, 16), phenolic); knob.position.copy(b); head.add(knob);
  }

  // ---------------------------------------------------------------- coolant: manifold, two jointed hoses, nozzles
  const jets = [];
  {
    const top = V3(0, Math.sin(0.5) * (RG + 0.05), Math.cos(0.5) * (RG + 0.05));
    const manifold = mesh(roundBox(0.3, 0.07, 0.09, 0.012), brassMat); manifold.position.copy(top); manifold.rotation.x = -0.5; head.add(manifold);
    const valve = mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.06, 10), brassMat); valve.position.copy(top).add(V3(0, 0.06, 0.02)); head.add(valve);
    const lever = mesh(roundBox(0.02, 0.012, 0.13, 0.004), new THREE.MeshStandardMaterial({ color: 0xc22b1f, metalness: 0.2, roughness: 0.5 })); lever.position.copy(top).add(V3(0, 0.095, 0.06)); head.add(lever);
    const bead = new THREE.SphereGeometry(0.034, 12, 8);
    for (const side of [-1, 1]) {
      const curve = new THREE.CatmullRomCurve3([
        top.clone().add(V3(side * 0.12, -0.02, 0.03)), V3(side * 0.2, 0.42, 1.16), V3(side * 0.2, 0.05, 1.2), V3(side * 0.13, -0.24, 1.08),
      ]);
      const count = 17;
      const hose = new THREE.InstancedMesh(bead, hoseBlue, count);
      hose.castShadow = true;
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = V3(1, 0.82, 1);
      for (let i = 0; i < count; i++) {
        const t = i / (count - 1);
        q.setFromUnitVectors(V3(0, 1, 0), curve.getTangentAt(t));
        hose.setMatrixAt(i, m.compose(curve.getPointAt(t), q, sc));
      }
      head.add(hose);
      const tip = curve.getPointAt(1), aim = V3(side * 0.02, -0.52, 0.8);
      const dir = aim.clone().sub(tip).normalize();
      const nozzle = mesh(new THREE.CylinderGeometry(0.012, 0.03, 0.11, 12), nozzleOrange);
      nozzle.position.copy(tip).addScaledVector(dir, 0.05);
      nozzle.quaternion.setFromUnitVectors(V3(0, 1, 0), dir);
      head.add(nozzle);
      // the stream itself, shown while the coolant runs
      const start = tip.clone().addScaledVector(dir, 0.1), length = start.distanceTo(aim);
      const jet = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.007, length, 8), new THREE.MeshPhysicalMaterial({ color: 0xd9efff, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.55, envMapIntensity: 2 }));
      jet.position.copy(start).add(aim).multiplyScalar(0.5);
      jet.quaternion.setFromUnitVectors(V3(0, 1, 0), dir);
      jet.visible = false;
      head.add(jet);
      jets.push(jet);
    }
    // supply line back over the guard to the column
    head.add(mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([top.clone().add(V3(-0.16, 0, 0)), V3(-0.3, 1.16, 0.6), V3(-0.4, 1.2, -0.4), V3(-0.45, 0.75, -1.3), V3(-0.5, 0.2, -2.0)]), 40, 0.022, 8), pvc));
  }

  // ---------------------------------------------------------------- frame: column
  {
    const base = mesh(roundBox(1.1, 0.24, 0.76, 0.03), castPaint); base.position.set(-0.2, 0.12, -1.74); frame.add(base);
    for (const [x, z] of [[-0.66, -2.04], [0.26, -2.04], [-0.66, -1.44], [0.26, -1.44]]) bolt(frame, x, 0.24, z, 'y', 1.3);
    const bridge = mesh(roundBox(0.8, 0.1, 0.3, 0.02), castPaint); bridge.position.set(-0.2, 0.05, -1.32); frame.add(bridge);
    const H = 3.5;
    for (const x of [-0.5, 0.1]) {
      const rod = mesh(new THREE.CylinderGeometry(0.056, 0.056, H, 28), chrome); rod.position.set(x, 0.2 + H / 2, -1.72); frame.add(rod);
      const collar = lathe([[0.056, 0], [0.09, 0], [0.095, 0.008], [0.095, 0.05], [0.056, 0.06]], machined, 28); collar.position.set(x, 0.24, -1.72); frame.add(collar);
    }
    const screw = mesh(new THREE.CylinderGeometry(0.032, 0.032, H, 20), threadMat); screw.position.set(-0.2, 0.2 + H / 2, -1.72); frame.add(screw);
    const yoke = mesh(roundBox(0.96, 0.18, 0.44, 0.03), castPaint); yoke.position.set(-0.2, 0.2 + H + 0.05, -1.72); frame.add(yoke);
    // handwheel on top
    const wy = 0.2 + H + 0.24;
    const hub = mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.1, 16), machined); hub.position.set(-0.2, wy - 0.04, -1.72); frame.add(hub);
    const wheel = mesh(new THREE.TorusGeometry(0.24, 0.022, 12, 40), blackOxide); wheel.rotation.x = Math.PI / 2; wheel.position.set(-0.2, wy, -1.72); frame.add(wheel);
    for (let i = 0; i < 3; i++) {
      const spoke = mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.46, 8), machined);
      spoke.rotation.z = Math.PI / 2; spoke.rotation.y = (i / 3) * Math.PI; spoke.position.set(-0.2, wy, -1.72);
      frame.add(spoke);
    }
    const crank = mesh(new THREE.CylinderGeometry(0.02, 0.024, 0.14, 10), phenolic); crank.position.set(0.04, wy + 0.07, -1.72); frame.add(crank);
  }

  // ---------------------------------------------------------------- frame: table with the blade slot, splash tray
  const TZ = 1.3, TX = 1.55;
  {
    const tableMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, metalness: 0.85, roughness: 0.42, normalMap: fin.cast, normalScale: V2(0.25, 0.25),
      map: plateTexture((g, w, h) => {
        g.fillStyle = '#5b6067'; g.fillRect(0, 0, w, h);
        let s = 17;
        const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) | 0; return (s >>> 0) / 4294967296; };
        // planing marks, T-slots, and the slurry that never quite washes off
        for (let i = 0; i < 700; i++) { g.strokeStyle = `rgba(${rnd() < 0.5 ? '255,255,255' : '0,0,0'},${0.02 + rnd() * 0.05})`; g.lineWidth = 1; const y = rnd() * h; g.beginPath(); g.moveTo(0, y); g.lineTo(w, y + (rnd() - 0.5) * 6); g.stroke(); }
        for (const y of [h * 0.22, h * 0.78]) { g.fillStyle = '#0b0c0e'; g.fillRect(0, y - 9, w, 18); g.fillStyle = 'rgba(255,255,255,0.14)'; g.fillRect(0, y - 12, w, 3); g.fillRect(0, y + 9, w, 3); }
        for (let i = 0; i < 60; i++) { const x = rnd() * w, y = rnd() * h, r = 14 + rnd() * 70; const grd = g.createRadialGradient(x, y, 0, x, y, r); grd.addColorStop(0, `rgba(200,197,186,${0.05 + rnd() * 0.12})`); grd.addColorStop(1, 'rgba(200,197,186,0)'); g.fillStyle = grd; g.fillRect(x - r, y - r, r * 2, r * 2); }
      }, 512, 512),
    });
    for (const side of [-1, 1]) {
      const plate = mesh(roundBox(TX - 0.022, 0.06, TZ * 2, 0.008), tableMat);
      plate.position.set(side * (0.022 + (TX - 0.022) / 2), -0.016, 0);
      frame.add(plate);
    }
    const slot = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.02, TZ * 2), new THREE.MeshBasicMaterial({ color: 0x020202 }));
    slot.position.y = -0.02; frame.add(slot);
    // tray walls
    for (const [w, d, x, z] of [[TX * 2 + 0.12, 0.04, 0, TZ + 0.04], [0.04, TZ * 2 + 0.12, TX + 0.04, 0], [0.04, TZ * 2 + 0.12, -TX - 0.04, 0]]) {
      const wall = mesh(roundBox(w, 0.13, d, 0.012), enamel); wall.position.set(x, 0.035, z); frame.add(wall);
    }
    const back = mesh(roundBox(TX * 2 + 0.12, 0.13, 0.04, 0.012), enamel); back.position.set(0, 0.035, -TZ - 0.04); frame.add(back);
  }

  // ---------------------------------------------------------------- frame: vise, one jaw each side of the blade
  const jaws = [];
  for (const side of [-1, 1]) {
    const jaw = new THREE.Group(); // origin on the face that meets the stone
    const block = mesh(roundBox(0.15, 0.3, 0.84, 0.014), castIron); block.position.set(side * 0.095, 0.16, 0); jaw.add(block);
    const pad = mesh(roundBox(0.02, 0.26, 0.8, 0.006), rubberMat); pad.position.set(side * 0.01, 0.16, 0); jaw.add(pad);
    const screw = mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.5, 14), threadMat); screw.rotation.z = Math.PI / 2; screw.position.set(side * 0.92, 0.17, 0); jaw.add(screw);
    const bar = mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.34, 10), machined); bar.rotation.x = Math.PI / 2; bar.position.set(side * 1.66, 0.17, 0); jaw.add(bar);
    for (const z of [-0.17, 0.17]) { const ball = mesh(new THREE.SphereGeometry(0.03, 12, 10), phenolic); ball.position.set(side * 1.66, 0.17, z); jaw.add(ball); }
    for (const z of [-0.3, 0.3]) { const guide = mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 10), chrome); guide.rotation.z = Math.PI / 2; guide.position.set(side * 0.42, 0.08, z); jaw.add(guide); }
    frame.add(jaw);
    jaws.push(jaw);
    // fixed nut block the screw runs through
    const nutBlock = mesh(roundBox(0.16, 0.3, 0.9, 0.016), castPaint); nutBlock.position.set(side * (TX - 0.16), 0.16, 0); frame.add(nutBlock);
    for (const z of [-0.36, 0.36]) bolt(frame, side * (TX - 0.16), 0.31, z, 'y', 0.9);
  }
  const JAW_OPEN = TX - 0.34;

  root.visible = false;
  return {
    root, head, blade, jaws,
    table: { halfX: TX, halfZ: TZ, jawOpen: JAW_OPEN, jawHeight: 0.31 },
    /** 0 at rest .. 1 at cutting speed: fades the teeth into a blur. */
    setSpin(k) { blurMat.opacity = Math.min(1, Math.max(0, k)) * 0.96; },
    /** Inner faces of the jaws, as distances from the blade plane (machine units). */
    setJaws(left, right) { jaws[0].position.x = -left; jaws[1].position.x = right; },
    setCoolant(on) { for (const j of jets) j.visible = on; },
  };
}
