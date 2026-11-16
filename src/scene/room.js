// The room the bench stands in: a jade dealer's hall on an autumn night.
//
// What is in focus is real geometry: the felt, the rosewood rail around it and the brass
// line between them, standing on a counter that goes down to the floor, and maple leaves
// drifting down through the lamplight. What is out of focus is painted by one shader on a
// sphere around the scene. Every view ray is carried to the walls of a box-shaped room and
// shaded where it lands, so the hall has true parallax as the camera moves, and costs
// nothing where the bench covers it:
//
//   - carved lattice screens between red-lacquered posts, lamplit, the shadows of maple
//     boughs outside stirring on the paper
//   - a moon gate in the far wall, and through it the garden at dusk: a low gold moon behind
//     a thin cloud, hills in washes of ink with a pagoda on the ridge, a lake holding the
//     moon, a half-moon bridge closed into a circle by its reflection, red maples lit from
//     beneath by stone lanterns, leaves coming down, and a bough reaching across the moon
//   - long tables either side of the gate: a vase of red maple, rough stones on stands, a lamp
//   - red silk lanterns over the room, and a polished stone floor with leaves blown in
//     through the gate and the moon lying on it in a cold pale oval
//
// Warm lamps inside, a cold moon outside, and the colours of leaves about to fall.
// Shapes out there are drawn soft on purpose. The lens is focused on the bench.
//
// World units are decimetres; the bench top is y = 0.

import * as THREE from 'three';

/** The felt of the bench top (its rail lies outside these bounds). */
export const TABLE = { x0: -14, x1: 14, z0: -16, z1: 11, rail: 1.4, lip: 0.3, floor: -7.6 };

const f = (v) => v.toFixed(2);

// ---------------------------------------------------------------------------- the hall
const ROOM_FRAG = /* glsl */ `
uniform float uTime, uDim, uPix;
varying vec3 vWorld;

const float RW = 40.0, RB = 38.0, RF = 42.0;        // half-width, far wall, wall behind the player
const float FLOOR = ${f(TABLE.floor)}, CEIL = 30.0;
const vec3 WOOD = vec3(0.0075, 0.004, 0.0026);
const vec3 LACQUER = vec3(0.036, 0.0036, 0.0026);   // vermilion lacquer, in a dim room
const vec3 GOLD = vec3(0.42, 0.27, 0.08);
const vec3 AMBER = vec3(1.0, 0.56, 0.2);
const vec3 MOON = vec3(1.0, 0.85, 0.6);             // a low autumn moon, warm at the rim of the sky

float hash1(float n) { return fract(sin(n * 127.1) * 43758.5453); }
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), u = fract(p);
  u = u * u * (3.0 - 2.0 * u);
  return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), u.x), mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) { return 0.55 * vnoise(p) + 0.3 * vnoise(p * 2.07 + 11.3) + 0.15 * vnoise(p * 4.3 + 3.7); }
/** 1 on a line of half-width w where d = 0; 'aa' is how soft its edge is. */
float band(float d, float w, float aa) { return 1.0 - smoothstep(w - aa, w + aa, abs(d)); }
/** 1 inside (d < 0), with an edge 'aa' soft. */
float fill(float d, float aa) { return 1.0 - smoothstep(-aa, aa, d); }
float sdSeg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0));
}
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

/** A maple leaf of radius s pointing up: seven pointed lobes, the lowest two small, a notch for the stalk. */
float mapleSd(vec2 p, float s) {
  float a = atan(p.x, p.y), r = length(p);
  float lobe = pow(abs(cos(a * 3.5)), 1.5);
  float R = s * mix(0.7, 1.0, smoothstep(2.7, 0.2, abs(a))) * (0.34 + 0.66 * lobe);
  R *= 1.0 - 0.9 * smoothstep(2.8, 3.1, abs(a));
  R += s * 0.03 * sin(a * 44.0) * lobe;           // a toothed edge on every lobe
  return (r - R) * 0.75;
}

/** The colours of the turn of the year: 0 gold, then orange, scarlet, and at 1 the darkest crimson. */
vec3 autumn(float k) {
  vec3 c = mix(vec3(0.80, 0.50, 0.09), vec3(0.88, 0.25, 0.04), smoothstep(0.0, 0.35, k));
  c = mix(c, vec3(0.72, 0.065, 0.03), smoothstep(0.3, 0.65, k));
  return mix(c, vec3(0.34, 0.014, 0.03), smoothstep(0.65, 1.0, k));
}

/** The lattice of a screen: a square within each square, tied to its frame. p in cells. */
float lattice(vec2 p, float aa) {
  vec2 c = fract(p) - 0.5, a = abs(c);
  float w = 0.05;
  float m = max(band(a.x - 0.5, w, aa), band(a.y - 0.5, w, aa));
  m = max(m, band(max(a.x, a.y) - 0.26, w * 0.85, aa));
  m = max(m, band(c.x, w * 0.85, aa) * smoothstep(0.26 - aa, 0.26 + aa, a.y));
  m = max(m, band(c.y, w * 0.85, aa) * smoothstep(0.26 - aa, 0.26 + aa, a.x));
  return m;
}

/**
 * The shadow of a maple outside, thrown on the paper by the moon and stirring in the wind.
 * p: across the bay (0 at its middle) and up. 0 where nothing falls.
 */
float branchShadow(vec2 p, float bay, float seed) {
  float h = hash1(bay * 3.17 + seed * 7.0);
  if ((h > 0.6 && !(seed == 0.0 && abs(bay) >= 1.0 && abs(bay) <= 2.0)) || p.y < 2.5) return 0.0;   // not every window has a tree outside it; those beside the gate do
  // beside the gate the tree stands on the far side of the window from the vase on the table
  float side = seed == 0.0 && abs(bay) >= 1.0 ? sign(bay) : (h < 0.3 ? -1.0 : 1.0);
  float sway = sin(uTime * 0.45 + bay * 1.3) * 0.16 + sin(uTime * 1.13 + bay * 2.0) * 0.04;
  vec2 q = vec2(p.x * side, p.y);
  q.x += sway * max(13.5 - q.y, 0.0) * 0.12;          // the tips move, the bough hardly at all
  vec2 a = vec2(4.6, 13.8), b = vec2(0.6, 9.8 + h * 2.0), c = vec2(-2.4, 7.6 + h * 3.0), e = vec2(2.1, 11.7), f = vec2(1.3, 6.0);
  float d = min(sdSeg(q, a, b) - 0.15, min(sdSeg(q, b, c) - 0.08, sdSeg(q, e, f) - 0.07));
  if (d > 2.3) return 0.0;                              // clear of every twig and every leaf on it
  float shade = 1.0 - smoothstep(0.0, 0.3, d);
  vec2 ci = floor(q / 1.2);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 id = ci + vec2(float(i), float(j));
    if (hash2(id * 1.7 + seed) > 0.78) continue;
    vec2 lc = (id + 0.5 + (vec2(hash2(id + seed), hash2(id.yx + seed * 3.0)) - 0.5) * 0.5) * 1.2;
    float near = min(sdSeg(lc, a, b), min(sdSeg(lc, b, c), sdSeg(lc, e, f)));
    if (near > 1.3) continue;
    vec2 lp = rot(hash2(id + 9.0) * 6.28 + sway * 2.0) * (q - lc);
    shade = max(shade, 1.0 - smoothstep(-0.12, 0.22, mapleSd(lp, 0.6)));   // soft: seen through paper
  }
  return shade;
}

/** A wall of carved screens between lacquered posts. p: along the wall, height. */
vec3 screens(vec2 p, float seed, float aa, bool rough) {
  const float BAY = 9.0;
  float bx = p.x / BAY + 0.5;
  float bay = floor(bx);
  float u = (fract(bx) - 0.5) * BAY;                    // across this bay, 0 at its middle
  float lamp = hash1(bay * 7.31 + seed);                // every bay has its own lamp behind the paper
  float flick = 0.94 + 0.06 * sin(uTime * (0.9 + lamp) + bay * 2.7 + seed * 5.0) * sin(uTime * 0.37 + lamp * 9.0);
  float open = fill(abs(u) - 3.7, aa) * fill(-1.7 - p.y, aa) * fill(p.y - 17.5, aa);
  float gy = exp(-pow((p.y - 2.4 - lamp * 3.6) / 5.2, 2.0));
  float gx = exp(-u * u / 9.0);
  float g = gy * gx;
  vec3 paper = mix(vec3(1.0, 0.33, 0.08), vec3(1.0, 0.62, 0.28), g) * (0.010 + 0.46 * g * g + 0.065 * g) * (0.55 + 0.8 * lamp) * flick;
  paper *= 0.86 + 0.28 * vnoise(p * vec2(2.2, 0.7) + seed);   // the fibre of the paper
  // the moon outside lights the paper too, cold and even, stronger up high; the maple's
  // shadow is in that light, not in the lamp's
  float shade = rough ? 0.0 : branchShadow(vec2(u, p.y), bay, seed);
  vec3 moonPaper = vec3(0.019, 0.023, 0.033) * smoothstep(0.0, 13.0, p.y) * (rough ? 1.0 : 0.8 + 0.4 * vnoise(p * vec2(0.45, 0.3) + seed * 3.0));
  paper = paper * (1.0 - 0.5 * shade) + moonPaper * (1.0 - 0.9 * shade);
  float lat = lattice(vec2(u, p.y + 1.7) / 1.24, aa / 1.24);
  lat = max(lat, band(p.y - 3.25, 0.2, aa));              // a heavier rail at waist height
  vec3 col = mix(WOOD, mix(paper, WOOD * 0.7, lat), open);
  // posts: round, red-lacquered, banded in gold where they meet beam and sill
  float s = clamp((abs(u) - 4.5) / 0.8, -1.0, 0.0);
  float rnd = sqrt(1.0 - s * s);
  vec3 post = LACQUER * (0.35 + 1.9 * rnd) + AMBER * 0.012 * (1.0 - rnd) * gy;
  float ring = max(band(p.y - 16.7, 0.24, aa), band(p.y + 1.15, 0.2, aa));
  post = mix(post, GOLD * (0.04 + 0.13 * rnd) + AMBER * 0.025 * gy, ring);
  col = mix(col, post, 1.0 - fill(abs(u) - 3.7, aa));
  // below the screens: a carved panel
  float inset = band(max(abs(u) - 2.9, abs(p.y + 4.5) - 1.9), 0.07, aa);
  col += WOOD * 1.6 * inset * fill(p.y + 1.7, aa) + AMBER * 0.006 * gx * fill(abs(p.y + 1.7) - 0.25, aa);
  // the beam the screens hang from: lacquer, with a line of gold along it
  col = mix(col, LACQUER * 0.55 + GOLD * 0.09 * band(p.y - 18.2, 0.08, aa), 1.0 - fill(p.y - 17.5, aa));
  return col;
}

/** A stone lantern on the bank. Returns how solid it is; 'glow' is where its firebox shows light. */
float stoneLantern(vec2 p, vec2 base, float aa, out float glow) {
  vec2 q = p - base;
  float m = fill(max(abs(q.x) - 0.75, abs(q.y - 0.18) - 0.18), aa);       // plinth
  m = max(m, fill(max(abs(q.x) - 0.22, abs(q.y - 1.0) - 0.7), aa));       // post
  m = max(m, fill(max(abs(q.x) - 0.62, abs(q.y - 1.78) - 0.1), aa));      // platform
  m = max(m, fill(max(abs(q.x) - 0.48, abs(q.y - 2.25) - 0.38), aa));     // firebox
  glow = fill(max(abs(q.x) - 0.25, abs(q.y - 2.25) - 0.22), aa);
  float ry = q.y - 2.66;                                                    // roof: wide, and swept up at the eaves
  m = max(m, fill(max(abs(q.x) - (1.25 - ry * 2.2) - 0.25 * smoothstep(0.7, 1.3, abs(q.x)) * step(ry, 0.12), abs(ry - 0.15) - 0.15 - 0.12 * smoothstep(0.8, 1.35, abs(q.x))), aa));
  m = max(m, fill(length(q - vec2(0.0, 3.12)) - 0.13, aa));               // finial
  return max(m, glow);
}

/**
 * Foliage as a painter dabs it: soft round clumps that run into one another. Returns the
 * field (0 in the open, about 1 in a clump); 'lit' is how far round each clump faces
 * 'toLight', blended smoothly between clumps; 'tone' tells clumps apart.
 */
float foliage(vec2 p, float size, vec2 toLight, out float lit, out float tone) {
  vec2 q = p / size, ci = floor(q);
  float F = 0.0, L = 0.0, T = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 id = ci + vec2(float(i), float(j));
    vec2 c = id + 0.5 + (vec2(hash2(id), hash2(id + 17.0)) - 0.5) * 0.8;
    vec2 v = (q - c) / (0.55 + 0.3 * hash2(id + 5.0));
    float w = exp(-dot(v, v) * 2.2);
    F += w;
    L += w * clamp(0.5 + 0.7 * dot(v, toLight), 0.0, 1.0);
    T += w * hash2(id + 9.0);
  }
  lit = L / (F + 1e-4); tone = T / (F + 1e-4);
  return F;
}

/** A maple: crooked trunk and boughs, a crown of leaf clumps in crimson, scarlet and gold. */
float mapleTree(vec2 p, vec2 root, float lean, vec2 cc, vec2 cr, float seed, vec2 lamp, float aa, out vec3 c) {
  vec2 k1 = root + vec2(lean * 1.4, 3.6), k2 = cc + vec2(-lean, -cr.y * 0.45);
  float tr = sdSeg(p, root, k1) - mix(0.6, 0.38, clamp((p.y - root.y) / 4.0, 0.0, 1.0));
  tr = min(tr, sdSeg(p, k1, k2) - 0.3);
  tr = min(tr, sdSeg(p, k2, k2 + vec2(cr.x * 0.55, cr.y * 0.38)) - 0.16);
  tr = min(tr, sdSeg(p, k2, k2 + vec2(-cr.x * 0.6, cr.y * 0.22)) - 0.15);
  tr = min(tr, sdSeg(p, mix(k1, k2, 0.5), mix(k1, k2, 0.5) + vec2(lean * 2.8, cr.y * 0.55)) - 0.12);
  float trunk = fill(tr, aa);
  vec2 d = (p - cc) / cr;
  if (length(d * vec2(1.0, 1.15)) > 1.5) {                 // well clear of the crown: only the trunk can be here
    c = vec3(0.0025, 0.0016, 0.0016) + vec3(0.03, 0.012, 0.004) * exp(-length(p - lamp) / 4.0);
    return trunk;
  }
  float env = 1.0 - length(d * vec2(1.0, 1.15)) + 0.4 * (fbm(p * 0.22 + seed) - 0.5);   // > 0 inside the crown
  float lit, tone;
  float F = foliage(p + seed * 13.0, 1.2, vec2(0.62, 0.78), lit, tone);
  F = F * smoothstep(-0.25, 0.45, env) * 1.35 + 0.22 * (vnoise(rot(0.7) * p * 4.5 + seed) - 0.5);   // ragged, leafy edge
  float crown = smoothstep(0.5 - 0.04 - aa * 0.3, 0.5 + 0.04 + aa * 0.3, F);
  float k = clamp(0.5 + 0.8 * (fbm(p * 0.13 + seed * 2.0) - 0.5) + 0.5 * (tone - 0.5), 0.0, 1.0);
  float lamp2 = exp(-length(p - lamp) / 10.0) * (1.0 - lit);       // the lantern lights them from beneath
  float inner = 1.0 - 0.5 * smoothstep(0.9, 2.2, F);                // deep in the crown, leaf shades leaf
  float fine = 0.78 + 0.22 * vnoise(rot(1.1) * p * 7.0 + seed);
  vec3 leaf = autumn(k) * (0.03 + 0.17 * lit * lit + 0.35 * lamp2) * inner * fine;
  leaf += autumn(k * 0.5) * MOON * 0.06 * (1.0 - smoothstep(0.0, 0.3, env)) * lit;   // thin at the rim: the moon comes through
  c = mix(vec3(0.0025, 0.0016, 0.0016) + vec3(0.03, 0.012, 0.004) * exp(-length(p - lamp) / 4.0) * trunk, leaf, crown);
  return max(trunk, crown);
}

/** A half-moon bridge, its arch closed into a full circle by its reflection. */
float bridge(vec2 p, float water, float aa) {
  vec2 q = vec2(p.x + 3.0, abs(p.y - water));
  float r = length(q);
  float arch = fill(abs(r - 4.2) - 0.4, aa);
  float rail = fill(abs(r - 5.0) - 0.07, aa) * step(0.7, q.y);
  float ang = atan(q.y, q.x);
  float posts = fill(abs(fract(ang * 2.6) - 0.5) - 0.045, aa * 0.2) * step(4.55, r) * step(r, 5.05) * step(0.9, q.y);
  float abut = fill(max(abs(abs(q.x) - 5.7) - 1.3, q.y - 0.75), aa);
  return max(max(arch, rail), max(posts, abut));
}

/** Leaves on their way down through the garden: at most one in each cell of a drifting grid. */
void falling(vec2 p, float cell, float speed, float light, float aa, inout vec3 col) {
  vec2 q = p / cell + vec2(-uTime * speed * 0.5, uTime * speed);
  vec2 id = floor(q);
  float h = hash2(id);
  if (h > 0.17) return;
  float t = uTime * (0.6 + h);
  vec2 lp = q - id - vec2(0.5 + 0.2 * sin(t + h * 20.0), 0.5);
  lp = rot(t * 1.3 + h * 40.0) * lp;
  lp.x /= max(abs(cos(t * 1.7 + h * 9.0)), 0.25);        // edge-on, then face-on, as it tumbles
  col = mix(col, autumn(fract(h * 7.3)) * light, fill(mapleSd(lp, 0.22), 0.03 + aa / cell));
}

/** A maple bough reaching across the gate, close enough to touch. 'back' is the moonlight behind it. */
float bough(vec2 p, float back, float aa, out vec3 c) {
  c = vec3(0.0);
  float sway = sin(uTime * 0.5) * 0.1 + sin(uTime * 1.3) * 0.03;
  p.x -= sway * max(8.2 - p.y, 0.0) * 0.18;
  vec2 a = vec2(18.0, 15.0), b = vec2(11.5, 11.4), e = vec2(6.8, 9.7), f = vec2(3.2, 8.6), g = vec2(0.4, 8.0);
  vec2 t1 = b + vec2(-1.6, -3.0), t2 = e + vec2(-0.5, -2.6), t3 = e + vec2(-2.0, 1.4), t4 = f + vec2(-0.6, -1.9);
  float d = sdSeg(p, a, b) - 0.36;
  d = min(d, sdSeg(p, b, e) - 0.22);
  d = min(d, sdSeg(p, e, f) - 0.12);
  d = min(d, sdSeg(p, f, g) - 0.065);
  d = min(d, min(sdSeg(p, b, t1) - 0.09, sdSeg(p, e, t2) - 0.06));
  d = min(d, min(sdSeg(p, e, t3) - 0.06, sdSeg(p, f, t4) - 0.05));
  if (d > 2.6) return 0.0;
  float wood = fill(d, aa);
  c = vec3(0.002, 0.0012, 0.001);
  float leaves = 0.0;
  vec3 lc = vec3(0.0);
  vec2 ci = floor(p / 0.95);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 id = ci + vec2(float(i), float(j));
    float h = hash2(id + 4.0);
    if (h > 0.85) continue;
    vec2 cc = (id + 0.5 + (vec2(hash2(id + 1.0), hash2(id + 2.0)) - 0.5) * 0.6) * 0.95;
    float near = min(min(sdSeg(cc, b, e), sdSeg(cc, e, f)), sdSeg(cc, f, g));
    near = min(near, min(min(sdSeg(cc, b, t1), sdSeg(cc, e, t2)), min(sdSeg(cc, e, t3), sdSeg(cc, f, t4))));
    if (near > 1.25 || near < 0.25) continue;
    vec2 lp = rot(3.14 + (hash2(id + 3.0) - 0.5) * 1.8) * (p - cc);   // they hang, more or less
    float m = fill(mapleSd(lp, 0.55 + 0.25 * h), 0.02 + aa);
    float k = 0.25 + 0.7 * hash2(id + 6.0);
    lc = mix(lc, autumn(k) * (0.012 + 0.55 * back * (0.6 + 0.4 * hash2(id + 8.0))) + vec3(0.04, 0.012, 0.004) * 0.3, m);
    leaves = max(leaves, m);
  }
  c = mix(c, lc, leaves);
  return max(wood, leaves);
}

/** What shows through the moon gate: layers at their own depths, so they slide past each other. */
vec3 garden(vec3 ro, vec3 rd, float aa, bool rough) {
  // (composed for the view from the stall, which sees the upper half of the gate: the moon
  // and the maples sit high; the lake and the bridge are there for whoever comes closer)
  const float WATER = -2.5;
  // ---- the far plane: sky, moon, hills, and the lake that holds them
  vec2 g = (ro + rd * ((-(RB + 46.0) - ro.z) / rd.z)).xy;
  bool below = g.y < WATER;
  vec2 s = g;
  float ripple = 0.0;
  if (below) {
    float dep = WATER - g.y;
    ripple = 0.5 * sin(g.x * 1.3 + dep * 3.0 - uTime * 0.9) + 0.5 * sin(g.x * 0.47 - dep * 5.1 + uTime * 0.6);
    s = vec2(g.x + ripple * 0.12 * dep, 2.0 * WATER - g.y + ripple * 0.05 * dep);
  }
  float sy = smoothstep(WATER, WATER + 32.0, s.y);
  vec3 col = mix(vec3(0.060, 0.018, 0.028), vec3(0.018, 0.010, 0.034), smoothstep(0.0, 0.4, sy));   // ember and rose at the horizon, violet dusk above
  col = mix(col, vec3(0.004, 0.004, 0.016), smoothstep(0.4, 1.0, sy));
  vec2 MP = vec2(8.0, 7.0);
  float md = length(s - MP);
  col += MOON * (fill(md - 3.0, 0.16 + aa) * (0.70 - 0.2 * fbm((s - MP) * 0.6 + 5.0)) + 0.11 * exp(-md / 3.6) + 0.03 * exp(-md / 14.0));
  float cl = fbm(vec2(s.x * 0.07 + uTime * 0.006, s.y * 0.30 + 2.0));
  float cloud = smoothstep(0.5, 0.78, cl) * smoothstep(WATER + 9.0, WATER + 15.0, s.y);
  col = mix(col, col * 0.35 + MOON * 0.04 * exp(-md / 6.0), cloud * 0.8);       // a thin cloud across the moon
  // far hills in washes of ink, mist lying between them, a pagoda on the ridge
  float h1 = WATER + 5.0 + 7.5 * fbm(vec2(s.x * 0.028 + 3.0, 1.0));
  float ridge = fill(s.y - h1, 0.9 + aa);
  float pb = WATER + 5.0 + 7.5 * fbm(vec2(-14.0 * 0.028 + 3.0, 1.0)) - 0.4;
  vec2 pq = vec2(s.x + 14.0, s.y - pb);
  float tier = floor(pq.y / 1.05), ty = fract(pq.y / 1.05) * 1.05;
  float pw = 1.15 - 0.16 * tier;
  float pagoda = fill(max(abs(pq.x) - pw * 0.62, -pq.y), aa) * step(tier, 4.0)
               + fill(max(abs(pq.x) - pw - 0.2 * smoothstep(0.75, 1.05, ty), abs(ty - 0.92) - 0.1), aa) * step(tier, 4.0) * step(0.0, pq.y);
  pagoda = max(clamp(pagoda, 0.0, 1.0), fill(max(abs(pq.x) - 0.06, abs(pq.y - 6.0) - 0.8), aa));
  col = mix(col, vec3(0.016, 0.012, 0.024), max(ridge, clamp(pagoda, 0.0, 1.0)) * 0.92);
  col += vec3(1.0, 0.55, 0.2) * 0.12 * fill(length(pq - vec2(0.0, 4.55)) - 0.09, aa);   // a light kept burning in its top storey
  col += vec3(0.040, 0.025, 0.030) * exp(-pow((s.y - h1 + 1.0) / 2.0, 2.0)) * (0.5 + vnoise(vec2(s.x * 0.06 + uTime * 0.01, s.y * 0.4)));
  float h2 = WATER + 1.0 + 3.2 * fbm(vec2(s.x * 0.06 + 11.0, 4.0));
  col = mix(col, vec3(0.008, 0.006, 0.013), fill(s.y - h2, 0.5 + aa));
  if (below) {
    col *= 0.55;                                                                  // water darkens what it holds
    col += MOON * 0.10 * exp(-pow((g.x - MP.x) / (0.6 + 0.35 * (WATER - g.y)), 2.0)) * smoothstep(0.3, 0.95, 0.5 + 0.5 * ripple);
    col += vec3(0.022, 0.013, 0.017) * exp(-(WATER - g.y) / 1.3);                 // mist on the water
  }
  if (rough) return col;
  // ---- the bridge across the lake
  vec2 bq = (ro + rd * ((-(RB + 30.0) - ro.z) / rd.z)).xy;
  float bw = WATER - 0.5;
  vec2 bqr = bq;
  if (bq.y < bw) bqr.x += sin(bq.y * 6.0 + uTime * 1.2) * 0.06 * (bw - bq.y);
  float br = bridge(bqr, bw, 0.12 + aa);
  vec3 stone = bq.y < bw ? vec3(0.005, 0.004, 0.007) : vec3(0.007, 0.006, 0.010) + MOON * 0.02 * smoothstep(-0.5, 0.6, bq.y - bw - 3.8);
  col = mix(col, stone, br);
  falling(bq, 1.5, 0.22, 0.03 + 0.1 * exp(-md / 9.0), aa, col);
  // ---- maples on the near bank, a stone lantern under each
  vec2 t = (ro + rd * ((-(RB + 14.0) - ro.z) / rd.z)).xy;
  vec2 LA = vec2(-5.0, -4.6), LB = vec2(8.6, -4.9);
  vec3 tc;
  // one great maple framing the left of the gate, a smaller one at the right edge; the moon between them
  float tm = mapleTree(t, vec2(-13.5, -5.8), 0.9, vec2(-11.0, 8.5), vec2(8.0, 5.8), 1.0, LA + vec2(0.0, 2.25), aa, tc);
  col = mix(col, tc, tm);
  tm = mapleTree(t, vec2(15.5, -5.8), -0.6, vec2(14.5, 5.5), vec2(5.0, 4.6), 7.0, LB + vec2(0.0, 2.25), aa, tc);
  col = mix(col, tc, tm);
  float bank = -5.4 + 0.9 * fbm(vec2(t.x * 0.12, 2.0));
  float lit = max(exp(-length(t - LA - vec2(0.0, 2.2)) / 5.0), exp(-length(t - LB - vec2(0.0, 2.2)) / 5.0));
  vec3 ground = autumn(vnoise(t * 1.6)) * (0.005 + 0.12 * lit * lit) * (0.45 + 0.55 * vnoise(t * 4.1));
  col = mix(col, ground, fill(t.y - bank, 0.1 + aa));                            // the bank, deep in fallen leaves
  float glow;
  float ln = stoneLantern(t, LA, aa, glow);
  col = mix(col, vec3(0.004, 0.0035, 0.004) + vec3(0.05, 0.02, 0.006) * exp(-length(t - LA - vec2(0.0, 2.25)) / 1.2), ln);
  col += vec3(1.0, 0.52, 0.16) * 0.55 * glow + vec3(1.0, 0.45, 0.15) * 0.05 * exp(-length(t - LA - vec2(0.0, 2.25)) / 1.6);
  ln = stoneLantern(t, LB, aa, glow);
  col = mix(col, vec3(0.004, 0.0035, 0.004) + vec3(0.05, 0.02, 0.006) * exp(-length(t - LB - vec2(0.0, 2.25)) / 1.2), ln);
  col += vec3(1.0, 0.52, 0.16) * 0.55 * glow + vec3(1.0, 0.45, 0.15) * 0.05 * exp(-length(t - LB - vec2(0.0, 2.25)) / 1.6);
  // ---- leaves coming down between the trees and the gate, and a bough across the moon
  vec2 fq = (ro + rd * ((-(RB + 8.0) - ro.z) / rd.z)).xy;
  falling(fq, 2.3, 0.3, 0.035 + 0.25 * exp(-md / 6.0) + 0.06 * lit, aa, col);
  vec2 nb = (ro + rd * ((-(RB + 4.0) - ro.z) / rd.z)).xy;
  vec3 bc;
  float bm = bough(nb, exp(-md / 5.5) + 0.12 * exp(-md / 18.0), 0.03 + aa * 0.5, bc);
  return mix(col, bc, bm);
}

/** What stands on the long tables beside the gate. Returns how solid it is; 'lit' is what glows. */
float furniture(vec2 c, float aa, out vec3 lit) {
  lit = vec3(0.0);
  float x = abs(c.x), m = 0.0;
  if (x < 11.0 || x > 32.0 || c.y > 9.6) return 0.0;
  float top = -0.65;                                      // the table tops, just below the bench top
  m = max(m, fill(abs(x - 21.5) - 9.5, aa) * fill(abs(c.y - top + 0.2) - 0.2, aa));
  m = max(m, fill(abs(abs(x - 21.5) - 8.9) - 0.32, aa) * fill(c.y - top, aa));
  m = max(m, fill(abs(x - 21.5) - 9.0, aa) * band(c.y - top + 0.95, 0.09, aa));
  // a tall vase, and in it a branch of red maple
  float yv = (c.y - top) / 3.6;
  float wv = 0.34 + 0.72 * exp(-pow((yv - 0.4) / 0.26, 2.0)) + 0.1 * exp(-pow((yv - 1.0) / 0.05, 2.0));
  m = max(m, fill(abs(x - 14.4) - wv, aa) * fill(abs(yv - 0.5) - 0.5, aa * 0.3));
  vec2 q = vec2(x, c.y);
  float br = sdSeg(q, vec2(14.4, 2.9), vec2(15.0, 4.9)) - 0.09;
  br = min(br, sdSeg(q, vec2(15.0, 4.9), vec2(16.7, 6.3)) - 0.075);
  br = min(br, sdSeg(q, vec2(16.7, 6.3), vec2(17.2, 8.4)) - 0.055);
  br = min(br, sdSeg(q, vec2(15.0, 4.9), vec2(13.8, 6.6)) - 0.055);
  br = min(br, sdSeg(q, vec2(16.7, 6.3), vec2(18.4, 6.9)) - 0.045);
  br = min(br, sdSeg(q, vec2(13.8, 6.6), vec2(14.1, 8.0)) - 0.04);
  m = max(m, fill(br, aa));
  // its leaves glow red against the lit paper behind them
  float leafM = 0.0;
  vec3 leafC = vec3(0.0);
  for (int i = 0; i < 9; i++) {
    float fi = float(i);
    vec2 lc = i == 0 ? vec2(17.2, 8.55) : i == 1 ? vec2(18.6, 6.95) : i == 2 ? vec2(14.1, 8.2) : i == 3 ? vec2(16.1, 5.5) :
              i == 4 ? vec2(13.5, 6.9) : i == 5 ? vec2(17.6, 7.4) : i == 6 ? vec2(15.4, 6.2) : i == 7 ? vec2(16.6, 8.0) : vec2(14.8, 7.3);
    vec2 lp = rot(3.14 + (hash1(fi * 3.7) - 0.5) * 2.2 + sin(uTime * 0.7 + fi) * 0.05) * (q - lc);
    float lm = fill(mapleSd(lp, 0.42 + 0.12 * hash1(fi * 5.1)), aa * 0.7);
    leafC = mix(leafC, autumn(0.35 + 0.55 * hash1(fi * 9.3)) * 0.3, lm);   // the paper behind shines through them
    leafM = max(leafM, lm);
  }
  // rough stones on their stands
  vec2 s1 = (q - vec2(19.0, top + 1.75)) / vec2(1.75, 1.35);
  float r1 = length(s1) - 1.0 + 0.2 * (vnoise(vec2(atan(s1.y, s1.x) * 1.6, 3.0)) - 0.5);
  m = max(m, fill(r1, aa * 0.6));
  m = max(m, fill(abs(x - 19.0) - 1.0 + (c.y - top) * 0.3, aa) * fill(abs(c.y - top - 0.25) - 0.25, aa));
  vec2 s2 = (q - vec2(27.6, top + 1.15)) / vec2(2.1, 0.85);
  float r2 = length(s2) - 1.0 + 0.24 * (vnoise(vec2(atan(s2.y, s2.x) * 1.9, 7.0)) - 0.5);
  m = max(m, fill(r2, aa * 0.6));
  m = max(m, fill(abs(x - 27.6) - 1.2, aa) * fill(abs(c.y - top - 0.18) - 0.18, aa));
  // a lamp: the one thing here that gives light instead of blocking it
  float stem = fill(abs(x - 23.2) - 0.1, aa) * fill(abs(c.y - top - 0.9) - 0.9, aa);
  stem = max(stem, fill(length((q - vec2(23.2, top + 0.15)) / vec2(0.75, 0.2)) - 1.0, aa * 0.6));
  m = max(m, stem);
  float ys = (c.y - top - 1.8) / 2.0;                    // 0 at the bottom of the shade, 1 at its top
  float sw = mix(1.3, 0.75, ys);
  float shade = fill(abs(x - 23.2) - sw, aa) * fill(abs(ys - 0.5) - 0.5, aa * 0.4);
  float flick = 0.95 + 0.05 * sin(uTime * 1.7 + sign(c.x) * 2.0);
  vec3 rim = vec3(0.0);
  rim += max(dot(normalize(s1), vec2(0.86, 0.5)), 0.0) * smoothstep(-0.45, -0.02, r1) * fill(r1, aa * 0.6) * 0.030;
  rim += max(dot(normalize(s2), vec2(-0.9, 0.44)), 0.0) * smoothstep(-0.45, -0.02, r2) * fill(r2, aa * 0.6) * 0.034;
  rim += smoothstep(0.35, 1.0, (x - 14.4) / wv) * fill(abs(x - 14.4) - wv, aa) * fill(abs(yv - 0.5) - 0.5, aa * 0.3) * 0.016;
  float across = (x - 23.2) / sw;
  lit = mix(vec3(1.0, 0.40, 0.12), vec3(1.0, 0.60, 0.26), exp(-across * across * 2.0)) * shade
    * (0.10 + 0.66 * exp(-pow((ys - 0.3) / 0.36, 2.0)) * (1.0 - 0.55 * across * across)) * flick;
  float halo = length((q - vec2(23.2, top + 2.6)) / vec2(1.0, 1.2));
  lit += AMBER * 0.05 * exp(-halo / 1.8) * flick + vec3(1.0, 0.5, 0.2) * rim * flick;
  lit = mix(lit, leafC * flick, leafM);
  return max(max(m, shade), leafM);
}

/** Red silk lanterns hanging over the room, gold at top and foot. Paints them over 'col' where the ray passes one before 'tMax'. */
void lanterns(vec3 ro, vec3 rd, float tMax, float aa, inout vec3 col) {
  if (ro.y + rd.y * tMax < 8.0) return;
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float side = mod(fi, 2.0) * 2.0 - 1.0, row = floor(fi / 2.0);
    vec3 c = vec3(side * (12.0 + row * 9.0), 13.5 + row * 1.5 - mod(row, 2.0) * 2.0, -27.0 + row * 17.0);
    c.x += sin(uTime * 0.35 + fi * 2.1) * 0.12;          // they turn a little in the draught
    vec3 v = c - ro;
    float tc = dot(v, rd);
    if (tc < 0.5 || tc > tMax) continue;
    vec3 q = ro + rd * tc - c;
    float d = length(q * vec3(1.0, 0.7, 1.0)) - 1.45;
    float flick = 0.93 + 0.07 * sin(uTime * (1.1 + fi * 0.13) + fi * 4.0);
    float hx = clamp(dot(q, normalize(vec3(rd.z, 0.0, -rd.x))) / 1.45, -1.0, 1.0);
    float ribs = 0.86 + 0.14 * cos(asin(hx) * 11.0);
    float cap = smoothstep(1.5, 1.7, abs(q.y));
    vec3 silk = mix(vec3(1.0, 0.13, 0.045) * (0.82 - 0.32 * abs(q.y) / 2.0) * ribs, GOLD * 0.22 * (0.7 + 0.3 * ribs), cap) * flick;
    float tassel = fill(abs(q.x) - 0.07, aa) * fill(abs(q.y + 3.3) - 1.2, aa) * step(length(q.xz), 0.4);
    float knot = fill(length(q.xy - vec2(0.0, -2.15)) - 0.16, aa) * step(length(q.xz), 0.4);
    col += vec3(1.0, 0.32, 0.12) * 0.075 * exp(-max(d, 0.0) / 2.6) * flick;
    col = mix(col, silk, fill(d, 0.1 + aa));
    col = mix(col, vec3(0.20, 0.012, 0.008) * flick, tassel);
    col = mix(col, GOLD * 0.18, knot);
  }
}

/** Everything a ray meets above the floor. 'soft' is extra blur; the floor's reflection passes it and gets the plain version. */
vec3 hall(vec3 ro, vec3 rd, float soft) {
  bool rough = soft > 0.0;
  float sx = rd.x >= 0.0 ? 1.0 : -1.0, sz = rd.z >= 0.0 ? 1.0 : -1.0;
  float tx = (sx * RW - ro.x) / (rd.x + sx * 1e-5);
  float tz = ((sz > 0.0 ? RF : -RB) - ro.z) / (rd.z + sz * 1e-5);
  float ty = rd.y > 1e-4 ? (CEIL - ro.y) / rd.y : 1e9;
  float t = min(tx, min(tz, ty));
  vec3 p = ro + rd * t;
  float aa = max(0.13 + soft, t * uPix * 1.5);
  vec3 col;
  if (t == ty) {
    // coffered ceiling, lit only by what spills up the walls
    vec2 k = abs(fract(p.xz / 9.0) - 0.5);
    float edge = min(RW - abs(p.x), min(p.z + RB, RF - p.z));
    col = WOOD * (0.35 + 0.5 * smoothstep(0.38, 0.47, max(k.x, k.y))) + AMBER * 0.006 * exp(-edge / 7.0);
  } else if (t == tx) {
    col = screens(vec2(p.z * sx, p.y), 3.0 + sx, aa, rough);
  } else if (sz > 0.0) {
    col = screens(vec2(p.x, p.y), 9.0, aa, rough) * 0.6;
  } else {
    // the far wall: screens, and the moon gate in the middle of it
    float d = length(p.xy - vec2(0.0, 2.6)) - 10.2;
    col = screens(vec2(p.x, p.y), 0.0, aa, rough);
    float ring = fill(d - 1.35, aa);
    vec3 frame = LACQUER * 0.8 + vec3(0.040, 0.028, 0.022) * exp(-max(d, 0.0) / 0.16);   // its inner edge takes the moonlight
    frame += GOLD * (band(d - 0.72, 0.05, aa) * 0.3 + band(d - 1.25, 0.04, aa) * 0.18);  // two lines of gilding
    col = mix(col, frame, ring);
    col = mix(col, garden(ro, rd, aa, rough), fill(d, aa));
    if (!rough) {
      float tf = (-(RB - 2.6) - ro.z) / (rd.z - 1e-5);
      vec3 lit;
      float m = furniture((ro + rd * tf).xy, aa * 0.8, lit);
      col = mix(col, WOOD * 0.55, m) + lit;
    }
  }
  if (!rough) lanterns(ro, rd, t, aa, col);
  // the air of the room: warm, a little thick
  return mix(col, vec3(0.016, 0.010, 0.006), 1.0 - exp(-t * 0.0042));
}

/** Maple leaves blown in through the gate, lying on the stone floor. */
float floorLeaves(vec2 xz, float aa, out vec3 c) {
  vec2 q = xz / 1.1;
  vec2 ci = floor(q);
  float h = hash2(ci + 31.0);
  float drift = exp(-max(xz.y + RB, 0.0) / 13.0) * (1.0 - smoothstep(8.0, 20.0, abs(xz.x))) + 0.3 * smoothstep(RW - 9.0, RW, abs(xz.x));
  c = vec3(0.0);
  if (h > 0.05 + 0.5 * drift) return 0.0;
  vec2 cc = ci + 0.5 + (vec2(hash2(ci + 7.0), hash2(ci + 13.0)) - 0.5) * 0.5;
  vec2 lp = rot(hash2(ci + 3.0) * 6.28) * (q - cc);
  c = autumn(hash2(ci + 19.0));
  return fill(mapleSd(lp, 0.3 + 0.12 * hash2(ci + 5.0)), 0.04 + aa / 1.1);
}

void main() {
  vec3 ro = cameraPosition, rd = normalize(vWorld - cameraPosition);
  vec3 col;
  float tf = rd.y < -1e-4 ? (FLOOR - ro.y) / rd.y : 1e9;
  vec3 pf = ro + rd * tf;
  if (tf < 1e8 && abs(pf.x) < RW && pf.z > -RB && pf.z < RF) {
    // polished black stone: a soft copy of the hall, and the dark under the counter
    vec3 refl = hall(pf, vec3(rd.x, -rd.y, rd.z), 0.5 + 0.012 * tf);
    float fres = 0.035 + 0.5 * pow(1.0 - abs(rd.y), 3.0);
    vec2 slab = abs(fract(pf.xz / 11.0) - 0.5);
    float joint = smoothstep(0.495 - 0.4 * tf * uPix, 0.5, max(slab.x, slab.y));
    vec3 base = vec3(0.0042, 0.0036, 0.0032) * (0.7 + 0.6 * fbm(pf.xz * 0.13));
    // the moon comes in through the gate and lies on the floor, cold, in a long pale oval
    vec2 mp = (pf.xz - vec2(-2.0, -30.0)) / vec2(8.5, 7.5);
    float pool = exp(-dot(mp, mp)) * (0.85 + 0.15 * fbm(pf.xz * 0.4));
    base += vec3(0.010, 0.012, 0.018) * pool;
    vec2 o = max(abs(pf.xz - vec2(${f((TABLE.x0 + TABLE.x1) / 2)}, ${f((TABLE.z0 + TABLE.z1) / 2)})) - vec2(${f((TABLE.x1 - TABLE.x0) / 2 + TABLE.rail)}, ${f((TABLE.z1 - TABLE.z0) / 2 + TABLE.rail)}), 0.0);
    float clearOf = smoothstep(0.0, 9.0, length(o));
    col = (base * (1.0 - 0.5 * joint) + refl * fres * 0.9) * (0.25 + 0.75 * clearOf);
    vec3 lc;
    float lv = floorLeaves(pf.xz, tf * uPix * 1.5, lc);
    col = mix(col, lc * (0.006 + 0.06 * pool) * (0.25 + 0.75 * clearOf), lv);
    col = mix(col, vec3(0.016, 0.010, 0.006), 1.0 - exp(-tf * 0.0042));
  } else {
    col = hall(ro, rd, 0.0);
  }
  col *= uDim;
  col += (hash2(gl_FragCoord.xy + fract(uTime * 7.31) * 113.0) - 0.5) * (0.0007 + 0.02 * max(col.r, max(col.g, col.b)));
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}`;

// ---------------------------------------------------------------------------- the bench
/** Pile of the felt: fine fibres and a few scuffs. Tiles every few decimetres without showing it. */
function feltTexture() {
  const size = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = '#0b3024';
  g.fillRect(0, 0, size, size);
  const img = g.getImageData(0, 0, size, size);
  const d = img.data;
  let s = 1234567;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) | 0; return (s >>> 0) / 4294967296; };
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * 24 + (rnd() < 0.02 ? 20 : 0);
    d[i] = Math.max(0, d[i] + n * 0.55); d[i + 1] = Math.max(0, d[i + 1] + n); d[i + 2] = Math.max(0, d[i + 2] + n * 0.75);
  }
  g.putImageData(img, 0, 0);
  g.globalAlpha = 0.07;
  for (let i = 0; i < 9000; i++) {
    const x = rnd() * size, y = rnd() * size, a = rnd() * 6.28, l = 3 + rnd() * 9;
    g.strokeStyle = rnd() < 0.5 ? '#7fd0aa' : '#03130c';
    for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) {
      g.beginPath(); g.moveTo(x + ox, y + oy); g.lineTo(x + ox + Math.cos(a) * l, y + oy + Math.sin(a) * l); g.stroke();
    }
  }
  g.globalAlpha = 1;
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(1 / 8.5, 1 / 8.5); // the geometry's uv is in decimetres
  map.anisotropy = 8;
  return map;
}

/** A rectangle with rounded corners, as a Shape or (for a hole) a Path. */
function roundRect(x0, y0, x1, y1, r, path = new THREE.Shape()) {
  path.moveTo(x0 + r, y0);
  path.lineTo(x1 - r, y0); path.absarc(x1 - r, y0 + r, r, -Math.PI / 2, 0, false);
  path.lineTo(x1, y1 - r); path.absarc(x1 - r, y1 - r, r, 0, Math.PI / 2, false);
  path.lineTo(x0 + r, y1); path.absarc(x0 + r, y1 - r, r, Math.PI / 2, Math.PI, false);
  path.lineTo(x0, y0 + r); path.absarc(x0 + r, y0 + r, r, Math.PI, Math.PI * 1.5, false);
  return path;
}
/** The bench outline grown by 'grow' (shape y is world -z: the shapes are laid flat afterwards). */
const outline = (grow, r, path) => roundRect(TABLE.x0 - grow, -TABLE.z1 - grow, TABLE.x1 + grow, -TABLE.z0 + grow, r, path);
const flat = (geo) => geo.rotateX(-Math.PI / 2);

const NOISE = /* glsl */ `
float rHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float rNoise(vec2 p) {
  vec2 i = floor(p), u = fract(p);
  u = u * u * (3.0 - 2.0 * u);
  return mix(mix(rHash(i), rHash(i + vec2(1.0, 0.0)), u.x), mix(rHash(i + vec2(0.0, 1.0)), rHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
/** How much of the lamp reaches a point of the bench: full under it, a little everywhere. */
float lampPool(vec2 xz) { return 0.035 + 0.965 * pow(smoothstep(15.5, 1.0, length((xz - vec2(0.0, -0.6)) * vec2(1.0, 1.18))), 1.7); }
`;
const WORLD_VARYING = (shader) => {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vWp;\nvarying vec3 vWn;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWn = mat3(modelMatrix) * objectNormal;');
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vWp;\nvarying vec3 vWn;\n${NOISE}`);
};

function buildBench() {
  const group = new THREE.Group();

  // ---- felt: deep green pile with 七寶 (linked coins) woven into it tone on tone, and two lines of gold thread round the edge
  const feltMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, map: feltTexture(), roughness: 1, metalness: 0, envMapIntensity: 0.06, specularIntensity: 0,
    sheen: 1, sheenRoughness: 0.45, sheenColor: new THREE.Color(0x1a5a41),
  });
  feltMat.onBeforeCompile = (shader) => {
    WORLD_VARYING(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
        vec2 fq = vWp.xz / 0.46;
        float fAa = (fwidth(fq.x) + fwidth(fq.y)) * 0.75;
        vec2 fc = fract(fq);
        float coin = 1e3;
        for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) coin = min(coin, abs(length(fc - vec2(float(i), float(j)) - 0.5) - 0.7071));
        float weave = (1.0 - smoothstep(0.045 - fAa, 0.045 + fAa, coin)) * (1.0 - smoothstep(0.06, 0.2, fAa));
        diffuseColor.rgb *= 1.0 + 0.17 * weave;
        // gold thread: distance in from the edge of the felt, corners rounded with it
        vec2 fh = vec2(${f((TABLE.x1 - TABLE.x0) / 2)}, ${f((TABLE.z1 - TABLE.z0) / 2)});
        vec2 fd = abs(vWp.xz - vec2(${f((TABLE.x0 + TABLE.x1) / 2)}, ${f((TABLE.z0 + TABLE.z1) / 2)})) - fh + 1.6;
        float fromEdge = 1.6 - (length(max(fd, 0.0)) + min(max(fd.x, fd.y), 0.0));
        float gAa = fwidth(fromEdge) * 0.9;
        float thread = max(1.0 - smoothstep(0.045 - gAa, 0.045 + gAa, abs(fromEdge - 0.95)), 1.0 - smoothstep(0.02 - gAa, 0.02 + gAa, abs(fromEdge - 1.2)));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.50, 0.33, 0.10), thread * 0.9);
        float fPool = lampPool(vWp.xz);
        diffuseColor.rgb *= fPool;`)
      // (the nap catches light at a glancing angle; out of the lamp there is none for it to catch)
      .replace("#include <lights_fragment_end>", "#include <lights_fragment_end>\n#ifdef USE_SHEEN\nsheenSpecularDirect *= fPool; sheenSpecularIndirect *= fPool;\n#endif")
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.42, thread);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 0.85, thread);');
  };
  const felt = new THREE.Mesh(flat(new THREE.ShapeGeometry(outline(0.05, 0.7), 10)), feltMat);
  felt.receiveShadow = true;
  group.add(felt);

  // ---- rosewood, lacquered: the rail round the felt and the counter under it
  const woodMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, roughness: 0.45, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.22, envMapIntensity: 0.22,
  });
  woodMat.onBeforeCompile = (shader) => {
    WORLD_VARYING(shader);
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
      // the grain runs along each side of the frame and meets at the mitres
      vec3 wn = abs(normalize(vWn));
      float overX = max(${f(TABLE.x0)} - vWp.x, vWp.x - ${f(TABLE.x1)}), overZ = max(${f(TABLE.z0)} - vWp.z, vWp.z - ${f(TABLE.z1)});
      bool alongZ = wn.y > 0.5 ? overX > overZ : wn.x > wn.z;
      float along = alongZ ? vWp.z : vWp.x;
      float across = wn.y > 0.5 ? (alongZ ? vWp.x : vWp.z) : vWp.y;
      float grain = 0.6 * rNoise(vec2(along * 0.16, across * 4.6)) + 0.4 * rNoise(vec2(along * 0.5 + 7.0, across * 15.0));
      float pore = rNoise(vec2(along * 3.0, across * 60.0));
      vec3 timber = mix(vec3(0.022, 0.0055, 0.0035), vec3(0.14, 0.036, 0.016), smoothstep(0.25, 0.8, grain)) * (0.9 + 0.2 * pore);
      diffuseColor.rgb = timber * (wn.y > 0.5 ? 0.3 + 0.7 * lampPool(vWp.xz) : 0.55);`);
  };
  const frame = outline(TABLE.rail, 1.9);
  frame.holes.push(outline(0, 0.7, new THREE.Path()));
  const bevel = 0.07;
  const rail = new THREE.Mesh(
    flat(new THREE.ExtrudeGeometry(frame, { depth: TABLE.lip - bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 10 })),
    woodMat,
  );
  rail.castShadow = rail.receiveShadow = true;
  const counter = new THREE.Mesh(flat(new THREE.ExtrudeGeometry(outline(TABLE.rail - 0.45, 1.5), { depth: -TABLE.floor - 0.05, bevelEnabled: false, curveSegments: 10 })), woodMat);
  counter.position.y = TABLE.floor;
  group.add(rail, counter);

  // ---- brass: let into the wood where it meets the felt, and a band round the counter
  const brassMat = new THREE.MeshStandardMaterial({ color: 0xc9953c, metalness: 1, roughness: 0.3, envMapIntensity: 1.1 });
  const lineShape = outline(0.05, 0.75);
  lineShape.holes.push(outline(-0.11, 0.6, new THREE.Path()));
  const inlay = new THREE.Mesh(flat(new THREE.ShapeGeometry(lineShape, 10)), brassMat);
  inlay.position.y = 0.006;
  inlay.receiveShadow = true;
  const kickShape = outline(0.04, 0.74);
  kickShape.holes.push(outline(-0.035, 0.665, new THREE.Path()));
  const kick = new THREE.Mesh(flat(new THREE.ExtrudeGeometry(kickShape, { depth: 0.11, bevelEnabled: false, curveSegments: 10 })), brassMat);
  const bandShape = outline(TABLE.rail - 0.42, 1.52);
  bandShape.holes.push(outline(TABLE.rail - 0.6, 1.4, new THREE.Path()));
  const band = new THREE.Mesh(flat(new THREE.ExtrudeGeometry(bandShape, { depth: 0.12, bevelEnabled: false, curveSegments: 10 })), brassMat);
  band.position.y = -0.62;
  group.add(inlay, kick, band);

  return { group, felt };
}

// ---------------------------------------------------------------------------- dust in the lamplight
function buildDust() {
  const N = 260;
  const pos = new Float32Array(N * 3), seed = new Float32Array(N * 4);
  let s = 97531;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) | 0; return (s >>> 0) / 4294967296; };
  for (let i = 0; i < N; i++) {
    pos[i * 3] = (rnd() - 0.5) * 24; pos[i * 3 + 1] = 0.3 + rnd() * 9; pos[i * 3 + 2] = (rnd() - 0.5) * 18;
    for (let k = 0; k < 4; k++) seed[i * 4 + k] = rnd();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 5, 0), 30);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uLit: { value: 1 }, uScale: { value: 1000 } },
    vertexShader: /* glsl */ `
      attribute vec4 aSeed;
      uniform float uTime, uLit, uScale;
      varying float vA;
      void main() {
        vec3 p = position;
        float t = uTime * (0.05 + 0.07 * aSeed.y);
        p.x += sin(t * 2.1 + aSeed.x * 6.28) * 0.9 + sin(t * 0.7 + aSeed.x * 17.0) * 0.5;
        p.y = mod(p.y + uTime * 0.012 * (aSeed.y - 0.35), 9.0) + 0.3 + sin(t * 1.3 + aSeed.x * 11.0) * 0.3;
        p.z += cos(t * 1.7 + aSeed.x * 3.0) * 0.8;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = max(uScale * (0.022 + 0.04 * aSeed.z) / -mv.z, 1.0);
        // only what drifts through the lamp's cone shows, and it turns as it goes
        float cone = smoothstep(8.5, 1.5, length(p.xz - vec2(0.4, 0.5))) * smoothstep(0.0, 1.2, p.y);
        float turn = 0.5 + 0.5 * sin(uTime * (0.5 + aSeed.w * 1.3) + aSeed.x * 40.0);
        vA = cone * turn * turn * uLit * smoothstep(0.6, 3.0, -mv.z);
      }`,
    fragmentShader: /* glsl */ `
      varying float vA;
      void main() {
        float a = smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5));
        gl_FragColor = vec4(vec3(1.0, 0.84, 0.6) * a * a * vA * 0.42, 1.0);
      }`,
  });
  const points = new THREE.Points(geo, mat);
  points.renderOrder = 4;
  return points;
}

/** The lamp's cone, seen in the dust and smoke of the room: faint, and gone at its edges. */
function buildShaft() {
  const top = 15, r0 = 1.4, r1 = 9.5;
  const geo = new THREE.CylinderGeometry(r0, r1, top, 48, 1, true);
  geo.translate(0.3, top / 2, 0.2);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide,
    uniforms: { uLit: { value: 1 }, uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vN, vV, vP;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vP = wp.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        vV = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uLit, uTime;
      varying vec3 vN, vV, vP;
      float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n2(vec2 p) { vec2 i = floor(p), u = fract(p); u = u * u * (3.0 - 2.0 * u);
        return mix(mix(h2(i), h2(i + vec2(1.0, 0.0)), u.x), mix(h2(i + vec2(0.0, 1.0)), h2(i + vec2(1.0, 1.0)), u.x), u.y); }
      void main() {
        // thickest where the cone is seen face on, nothing at its silhouette
        float face = pow(abs(dot(normalize(vN), normalize(vV))), 2.2);
        float rise = smoothstep(0.0, 3.5, vP.y) * (1.0 - smoothstep(6.0, ${top.toFixed(1)}, vP.y) * 0.75);
        float smoke = 0.6 + 0.8 * n2(vec2(atan(vP.z, vP.x) * 2.0 + uTime * 0.02, vP.y * 0.35 - uTime * 0.03));
        gl_FragColor = vec4(vec3(1.0, 0.82, 0.56) * face * rise * smoke * uLit * 0.02, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 3;
  return mesh;
}

// ---------------------------------------------------------------------------- maple leaves coming down
/** The outline of a maple leaf, as a radius at angle `a` from its tip (seven lobes, a notch for the stalk). */
function leafRadius(a) {
  const lobe = Math.pow(Math.abs(Math.cos(a * 3.5)), 1.5);
  const t = Math.min(1, Math.max(0, (2.7 - Math.abs(a)) / 2.5));
  let r = (0.7 + 0.3 * t * t * (3 - 2 * t)) * (0.34 + 0.66 * lobe);
  r *= 1 - 0.9 * Math.min(1, Math.max(0, (Math.abs(a) - 2.8) / 0.3));
  return r + 0.03 * Math.sin(a * 44) * lobe;
}

/** One leaf, drawn: gold at the heart going to scarlet at the points, veins, a stalk, a darker edge. */
function leafTexture() {
  const S = 256, R = S * 0.44, cx = S / 2, cy = S * 0.52;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const at = (a, k) => [cx + Math.sin(a) * R * k, cy - Math.cos(a) * R * k];
  g.beginPath();
  for (let i = 0; i <= 360; i++) {
    const a = -Math.PI + (i / 360) * Math.PI * 2;
    const [x, y] = at(a, leafRadius(a));
    if (i) g.lineTo(x, y); else g.moveTo(x, y);
  }
  g.closePath();
  const grad = g.createRadialGradient(cx, cy, 0, cx, cy, R);
  grad.addColorStop(0, '#ffe08a'); grad.addColorStop(0.35, '#ffb347'); grad.addColorStop(0.75, '#ff7a2e'); grad.addColorStop(1, '#f2552a');
  g.fillStyle = grad;
  g.fill();
  g.save();
  g.clip();
  let s = 4242;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) | 0; return (s >>> 0) / 4294967296; };
  for (let i = 0; i < 70; i++) {   // mottling: the leaf has started to go
    const [x, y] = [cx + (rnd() - 0.5) * R * 1.8, cy + (rnd() - 0.5) * R * 1.8];
    const r = 3 + rnd() * 14;
    const sp = g.createRadialGradient(x, y, 0, x, y, r);
    sp.addColorStop(0, `rgba(150,30,10,${0.08 + rnd() * 0.18})`); sp.addColorStop(1, 'rgba(150,30,10,0)');
    g.fillStyle = sp; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let k = -3; k <= 3; k++) {  // a vein out to every point, a few side veins off each
    const a = (k * 2 * Math.PI) / 7;
    const [x, y] = at(a, leafRadius(a) * 0.93);
    g.strokeStyle = 'rgba(160,45,12,0.55)'; g.lineWidth = 2.6 - Math.abs(k) * 0.3;
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(x, y); g.stroke();
    g.lineWidth = 0.9;
    for (let j = 1; j <= 3; j++) {
      const f = j / 4.2, bx = cx + (x - cx) * f, by = cy + (y - cy) * f;
      for (const sgn of [-1, 1]) {
        const [ex, ey] = at(a + sgn * 0.35, leafRadius(a) * (f + 0.2));
        g.beginPath(); g.moveTo(bx, by); g.lineTo(ex, ey); g.stroke();
      }
    }
  }
  g.restore();
  g.lineWidth = 2.5; g.strokeStyle = 'rgba(120,22,8,0.6)'; g.stroke();
  g.strokeStyle = '#7a2e10'; g.lineWidth = 3.2;  // the stalk
  g.beginPath(); g.moveTo(cx, cy); g.quadraticCurveTo(cx + 4, cy + R * 0.35, cx - 3, cy + R * 0.62); g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/**
 * Leaves drifting down through the hall: they tumble, swing in the draught from the gate,
 * settle on the floor or the edge of the bench, lie a while, and fade. None come down over
 * the middle of the bench, where the stones are.
 */
function buildLeaves() {
  const N = 72;
  const geo = new THREE.PlaneGeometry(1, 1, 4, 4);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {   // folded a little along the midrib, curled at the tip
    const x = pos.getX(i), y = pos.getY(i);
    pos.setZ(i, -0.14 * Math.abs(x) + 0.06 * y * y);
  }
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ map: leafTexture(), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.62, metalness: 0 });
  const glow = { value: 0.1 };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uGlow = glow;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', /* glsl */ `#include <begin_vertex>
      #ifdef USE_INSTANCING
      // nothing drifts right past the lens: a leaf shrinks away as the camera nears it
      vec4 leafAt = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
      transformed *= smoothstep(1.4, 4.0, distance(leafAt.xyz, cameraPosition));
      #endif`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uGlow;')
      // thin enough to glow with the light of the room behind it
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * uGlow;');
  };
  const mesh = new THREE.InstancedMesh(geo, mat, N);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  const tints = [new THREE.Color(0.85, 0.16, 0.1), new THREE.Color(1, 0.32, 0.14), new THREE.Color(1, 0.55, 0.26), new THREE.Color(1, 0.82, 0.42), new THREE.Color(0.62, 0.09, 0.08)];
  let s = 13579;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) | 0; return (s >>> 0) / 4294967296; };
  const over = (x, z) => Math.abs(x) < 13 && z > -10.5 && z < 13.5;   // the working part of the bench
  const onFelt = (x, z) => x > TABLE.x0 && x < TABLE.x1 && z > TABLE.z0 && z < TABLE.z1;
  const onRail = (x, z) => x > TABLE.x0 - TABLE.rail && x < TABLE.x1 + TABLE.rail && z > TABLE.z0 - TABLE.rail && z < TABLE.z1 + TABLE.rail;
  const ground = (x, z) => (onFelt(x, z) ? 0.006 : onRail(x, z) ? TABLE.lip + 0.006 : TABLE.floor + 0.012);
  const leaves = [];
  const spawn = (L, anywhere) => {
    do { L.x = (rnd() - 0.5) * 70; L.z = -35 + rnd() * 44; } while (over(L.x, L.z));
    L.y = anywhere ? TABLE.floor + rnd() * 28 : 18 + rnd() * 8;
    L.fall = 2.0 + rnd() * 1.6; L.swing = 0.9 + rnd() * 1.6; L.freq = 0.6 + rnd() * 0.8; L.phase = rnd() * 6.28;
    L.axis = new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize();
    L.spin = (1.4 + rnd() * 2.6) * (rnd() < 0.5 ? -1 : 1); L.angle = rnd() * 6.28;
    L.size = 0.55 + rnd() * 0.5; L.rest = -1; L.fade = 1; L.t = rnd() * 10;
    L.yaw = rnd() * 6.28;
    mesh.setColorAt(leaves.indexOf(L) >= 0 ? leaves.indexOf(L) : leaves.length, tints[Math.floor(rnd() * tints.length)]);
  };
  for (let i = 0; i < N; i++) { const L = {}; spawn(L, true); leaves.push(L); }
  mesh.instanceColor.needsUpdate = true;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), q2 = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
  const flat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  const UPV = new THREE.Vector3(0, 1, 0), TILT = new THREE.Vector3(1, 0, 0);
  return {
    mesh, glow,
    update(dt) {
      dt = Math.min(dt, 0.05);
      let recolour = false;
      for (let i = 0; i < N; i++) {
        const L = leaves[i];
        if (L.rest < 0) {
          L.t += dt;
          // the draught from the gate carries them toward the room and a little sideways
          L.x += (0.55 + Math.sin(L.t * L.freq + L.phase) * L.swing) * dt;
          L.z += (0.35 + Math.cos(L.t * L.freq * 0.8 + L.phase * 1.7) * L.swing * 0.6) * dt;
          // a leaf falls fastest flat-on to the air and drifts when it swings edge-on
          L.y -= L.fall * (0.65 + 0.35 * Math.abs(Math.sin(L.t * L.freq + L.phase))) * dt;
          L.angle += L.spin * dt;
          q.setFromAxisAngle(L.axis, L.angle);
          q2.setFromAxisAngle(TILT, Math.sin(L.t * L.freq * 2 + L.phase) * 0.6);
          q.multiply(q2);
          if (over(L.x, L.z) && L.y < 10) L.fade = Math.max(0, L.fade - dt * 1.5);   // never onto the stones
          const gy = ground(L.x, L.z);
          if (L.y <= gy) { L.y = gy; L.rest = 6 + rnd() * 12; }
          if (Math.abs(L.x) > 38 || L.z < -36 || L.z > 38 || L.fade <= 0) { spawn(L, false); recolour = true; }
        } else {
          L.rest -= dt;
          q2.setFromAxisAngle(UPV, L.yaw);
          q.copy(q2).multiply(flat);
          if (L.rest < 1.5) L.fade = Math.max(0, L.rest / 1.5);
          if (L.rest <= 0) { spawn(L, false); recolour = true; }
        }
        p.set(L.x, L.y, L.z);
        sc.setScalar(L.size * L.fade);
        mesh.setMatrixAt(i, m.compose(p, q, sc));
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (recolour) mesh.instanceColor.needsUpdate = true;
    },
  };
}

/**
 * Builds the hall, the bench and the dust. Add `group` to the scene; `felt` is the bench top.
 * `update(dt, room, lamp)`: how much of the room's own light and of the bench lamp is up (0..1).
 */
export function createRoom() {
  const group = new THREE.Group();
  const hall = new THREE.Mesh(
    new THREE.SphereGeometry(150, 32, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { uTime: { value: 0 }, uDim: { value: 1 }, uPix: { value: 0.001 } },
      vertexShader: 'varying vec3 vWorld; void main(){ vWorld = (modelMatrix * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0); }',
      fragmentShader: ROOM_FRAG,
    }),
  );
  hall.renderOrder = 10; // after everything solid: the bench hides most of it, and what is hidden is never shaded
  hall.frustumCulled = false;
  const bench = buildBench();
  const dust = buildDust();
  const shaft = buildShaft();
  const leaves = buildLeaves();
  group.add(hall, bench.group, shaft, dust, leaves.mesh);
  let time = 0;
  return {
    group, felt: bench.felt,
    update(dt, room, lamp) {
      time += dt;
      leaves.update(dt);
      leaves.glow.value = 0.12 * room + 0.03;
      hall.material.uniforms.uTime.value = time;
      hall.material.uniforms.uDim.value = room;
      dust.material.uniforms.uTime.value = time;
      dust.material.uniforms.uLit.value = lamp;
      shaft.material.uniforms.uTime.value = time;
      shaft.material.uniforms.uLit.value = lamp;
    },
    /** `pixels`: height of the drawing buffer; `fov`: vertical field of view in degrees. */
    resize(pixels, fov) {
      const k = 2 * Math.tan((fov * Math.PI) / 360) / pixels;
      hall.material.uniforms.uPix.value = k; // the size of a pixel, per unit of distance
      dust.material.uniforms.uScale.value = 1 / k;
    },
  };
}
