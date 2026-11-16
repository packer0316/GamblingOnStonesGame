// The stone shader.
//
// One physically based material draws every surface of a stone -- sandy skin,
// the rind and fog seen edge-on at a window or a cut, and the flesh itself --
// choosing between them from how far below the original skin a fragment lies.
//
// Flesh is not a painted surface. Each fragment marches a ray into the baked
// volume and gathers what the eye would: opaque 豆種 answers within a hair,
// 冰種 lets the ray run centimetres deep past cotton, colour veins and the
// silver sheets of cracks. On top of that march sits what a real sawn face
// shows up close: interlocking crystal grains, ragged-edged inclusions, a fog
// that creeps inward in tongues, the arcs of the blade, and an uneven film of
// water. A torch pressed to the stone is carried through the same volume, so
// its glow spreads as far as the material is clear and takes the colour of
// whatever it crosses.

import * as THREE from 'three';
import { BOX, MAX_CRACKS, MAX_BANDS } from './gen.js';
import { SD_LO, SD_HI, VOL_N } from './bake.js';
import { SKINS, FOGS, BODIES } from '../game/lore.js';
import { GRIND } from './grind.js';

export const MAX_WINDOWS = 16;
export const MAX_PLANES = 8;

/**
 * Share of a torch's light that gets through the skin, one way. A jade torch
 * is made to punch through sand: a thick or waxy skin dims the glow, it does
 * not put it out.
 */
export const skinPass = (skinT, wax) => Math.exp(-skinT * 34) * (1 - 0.4 * wax);

/** How bright the room is, 0..1. One value for every stone; the main loop keeps it current. */
export const LIT = { value: 1 };

const srgb = (c) => new THREE.Color().setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace);
const v4 = (n) => Array.from({ length: n }, () => new THREE.Vector4());
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Uniforms shared by every piece of one stone. */
export function createStoneUniforms(def, texA, texB, noiseTex) {
  const S = SKINS[def.skin];
  // crystal size follows the grade: 3 mm grains in 豆種, well under a millimetre once it turns icy
  const crystalCm = 0.32 - 0.25 * smooth(0.1, 0.55, def.z.base);
  const u = {
    uTexA: { value: texA }, uTexB: { value: texB }, uNoise: { value: noiseTex },
    uSkinT: { value: def.skinT }, uFogT: { value: def.fogT }, uUnit: { value: def.unitCm },
    uGrain: { value: def.grain }, uSkinRough: { value: S.rough }, uSkinWax: { value: S.wax }, uSpeck: { value: S.speck },
    uSkinPass: { value: skinPass(def.skinT, S.wax) },
    uStainAmt: { value: def.stainAmt }, uStainOff: { value: new THREE.Vector3(...def.stainOff).multiplyScalar(0.02) },
    uSkinColor: { value: srgb(S.color) }, uSkinStain: { value: srgb(S.stain) }, uSkinDark: { value: srgb(S.dark) },
    uFogColor: { value: srgb(FOGS[def.fogType].color) }, uBodyColor: { value: srgb(BODIES[def.body].color) },
    uHue: { value: def.green.hue }, uPurpleTone: { value: def.purple ? def.purple.tone : 0 },
    uYellowRed: { value: def.yellow ? def.yellow.red : 0 }, uCottonDots: { value: def.cotton.type === 'dots' ? 1 : 0 },
    uCrystal: { value: def.unitCm / crystalCm },
    uCrackN: { value: def.cracks.length },
    uCrackC: { value: v4(MAX_CRACKS) }, uCrackNrm: { value: v4(MAX_CRACKS) }, uCrackK1: { value: v4(MAX_CRACKS) },
    uCrackK2: { value: v4(MAX_CRACKS) }, uCrackK3: { value: v4(MAX_CRACKS) }, uCrackA: { value: v4(MAX_CRACKS) }, uCrackB: { value: v4(MAX_CRACKS) },
    uBandN: { value: def.green.bands.length }, uBandC: { value: v4(MAX_BANDS) }, uBandNrm: { value: v4(MAX_BANDS) },
    uWinN: { value: 0 }, uWin: { value: v4(MAX_WINDOWS) }, uWinP: { value: v4(MAX_WINDOWS) },
    // the window being ground right now (-1: none), and the burr's track over it (grind.js)
    uWinLive: { value: -1 }, uGrind: { value: GRIND.texture },
    uGrindC: { value: new THREE.Vector4() }, uGrindU: { value: new THREE.Vector4() }, uGrindV: { value: new THREE.Vector4() },
    uWet: { value: 0 },
    uTime: { value: 0 }, uClay: { value: 0 }, uLit: LIT,
    uTorchColor: { value: new THREE.Color(1, 0.96, 0.88) },
  };
  def.cracks.forEach((c, i) => {
    u.uCrackC.value[i].set(c.c[0], c.c[1], c.c[2], c.r);
    u.uCrackNrm.value[i].set(c.n[0], c.n[1], c.n[2], c.open);
    u.uCrackK1.value[i].set(c.k1[0], c.k1[1], c.k1[2], c.p1);
    u.uCrackK2.value[i].set(c.k2[0], c.k2[1], c.k2[2], c.p2);
    u.uCrackK3.value[i].set(c.k3[0], c.k3[1], c.k3[2], c.p3);
    u.uCrackA.value[i].set(c.a1, c.a2, c.stain, c.skinVis);
    u.uCrackB.value[i].set(c.healed ? 1 : 0, 0, 0, 0);
  });
  def.green.bands.forEach((b, i) => {
    u.uBandC.value[i].set(b.c[0], b.c[1], b.c[2], b.r);
    u.uBandNrm.value[i].set(b.n[0], b.n[1], b.n[2], b.th);
  });
  return u;
}

/** A material for one piece. `shared` comes from createStoneUniforms. */
export function createJadeMaterial(shared) {
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, roughness: 0.9, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.1,
    ior: 1.66, specularIntensity: 1, envMapIntensity: 1,
  });
  const own = {
    uPlaneN: { value: 0 }, uPlanes: { value: v4(MAX_PLANES) },
    uTorchPos: { value: new THREE.Vector3() }, uTorchPower: { value: 0 }, uTorchEntry: { value: 1 },
    uTorchRim: { value: 0.2 }, uTorchLeak: { value: new THREE.Vector3(1, 0, 0) },
    uSlurry: { value: 0 }, uSlurryPlane: { value: new THREE.Vector4(1, 0, 0, 99) },
    uHover: { value: 0 }, uScale: { value: 1 },
    uLaser: { value: new THREE.Vector4(1, 0, 0, 0) }, uLaserOn: { value: 0 },
    uKerf: { value: new THREE.Vector4(1, 0, 0, 0) }, uSawA: { value: new THREE.Vector3() }, uSawB: { value: new THREE.Vector3() },
    uSawR: { value: 1 }, uSawOn: { value: 0 },
    uMark: { value: new THREE.Vector4(0, 0, 0, 0) }, uMarkOn: { value: 0 },
  };
  mat.userData.u = { ...shared, ...own };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, mat.userData.u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aDepth;
        attribute float aCap;
        attribute vec3 aNormal0;
        uniform int uWinN, uWinLive;
        uniform vec4 uWin[${MAX_WINDOWS}];
        uniform sampler2D uGrind;
        uniform vec4 uGrindC, uGrindU, uGrindV;
        varying vec3 vObjPos;
        varying vec3 vObjNormal;
        varying vec3 vCamObj;
        varying float vDepth;
        varying float vCap;
        varying float vGround;`)
      // A window is meshed at its full depth the moment the job starts, but the
      // stone must not sink before the burr gets there. Every vertex the window
      // has lowered is held up on the original skin (position and normal) and
      // let down by as much as the burr's track says has been ground away at
      // that spot -- so the stone opens where the burr is, and nowhere else.
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        float jGround = 1.0;
        if (uWinLive >= 0 && aCap < 0.5 && aDepth > 0.0008) {
          vec3 rel = position - uGrindC.xyz;
          if (dot(rel, rel) < uGrindC.w * uGrindC.w) {
            jGround = textureLod(uGrind, vec2(dot(rel, uGrindU.xyz), dot(rel, uGrindV.xyz)) + 0.5, 0.0).r;
            // (what an older window took away here stays away)
            for (int i = 0; i < ${MAX_WINDOWS}; i++) {
              if (i >= uWinN) break;
              if (i == uWinLive) continue;
              float r = uWin[i].w;
              jGround = max(jGround, 1.0 - smoothstep(r * 0.5, r * 1.3, distance(position, uWin[i].xyz)));
            }
          }
        }
        float jHold = 1.0 - jGround;
        objectNormal = normalize(mix(objectNormal, aNormal0, jHold));`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        transformed += aNormal0 * (aDepth * jHold);
        vObjPos = transformed;
        vObjNormal = objectNormal;
        vDepth = aDepth;
        vGround = jGround;
        vCap = aCap;
        {
          mat3 m3 = mat3(modelMatrix);
          vCamObj = transpose(m3) * (cameraPosition - modelMatrix[3].xyz) / dot(m3[0], m3[0]);
        }`);
    // A height field turned into a normal, in view space. Unlike the stock
    // bump map this is true to scale: zooming does not change the relief.
    const bump = (normal, height, limit) => `{
          vec3 dpx = dFdx(-vViewPosition), dpy = dFdy(-vViewPosition);
          float hx = dFdx(${height}) * uScale, hy = dFdy(${height}) * uScale;
          vec3 r1 = cross(dpy, ${normal}), r2 = cross(${normal}, dpx);
          float det = dot(dpx, r1);
          if (abs(det) > 1e-12) ${normal} = normalize(${normal} - clamp((hx * r1 + hy * r2) / det, -${limit}, ${limit}));
        }`;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${SURFACE}`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = jRough;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${bump('normal', 'jHeight', '1.3')}`)
      .replace('#include <clearcoat_normal_fragment_maps>', `#include <clearcoat_normal_fragment_maps>
        #ifdef USE_CLEARCOAT
        // the film of water on a sawn face is never optically flat
        ${bump('clearcoatNormal', 'jFilm', '0.5')}
        #endif`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += jEmissive;`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
        material.clearcoat = jCoat;
        material.clearcoatRoughness = jCoatRough;`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        // a bare lamp on wet stone would burn a hole in the picture; keep the glint, lose the glare
        clearcoatSpecularDirect = min(clearcoatSpecularDirect, vec3(1.1));
        reflectedLight.directSpecular = min(reflectedLight.directSpecular, vec3(0.7));`);
  };
  mat.customProgramCacheKey = () => 'jade-v4';
  return mat;
}

// ----------------------------------------------------------------------------
const PARS = /* glsl */ `
uniform sampler3D uTexA, uTexB, uNoise;
uniform float uSkinT, uFogT, uUnit, uScale, uGrain, uSkinRough, uSkinWax, uSpeck, uSkinPass, uStainAmt, uCrystal, uLit;
uniform vec3 uSkinColor, uSkinStain, uSkinDark, uStainOff, uFogColor, uBodyColor;
uniform float uHue, uPurpleTone, uYellowRed, uCottonDots;
uniform int uCrackN;
uniform vec4 uCrackC[${MAX_CRACKS}], uCrackNrm[${MAX_CRACKS}], uCrackK1[${MAX_CRACKS}], uCrackK2[${MAX_CRACKS}], uCrackK3[${MAX_CRACKS}], uCrackA[${MAX_CRACKS}], uCrackB[${MAX_CRACKS}];
uniform int uBandN;
uniform vec4 uBandC[${MAX_BANDS}], uBandNrm[${MAX_BANDS}];
uniform int uWinN, uWinLive;
uniform vec4 uWin[${MAX_WINDOWS}], uWinP[${MAX_WINDOWS}];
uniform sampler2D uGrind;
uniform vec4 uGrindC, uGrindU, uGrindV;
uniform int uPlaneN;
uniform vec4 uPlanes[${MAX_PLANES}];
uniform vec3 uTorchPos, uTorchColor, uTorchLeak;
uniform float uTorchPower, uTorchEntry, uTorchRim;
uniform float uWet, uSlurry, uLaserOn, uSawR, uSawOn, uTime, uHover, uClay;
uniform vec4 uSlurryPlane, uLaser, uKerf, uMark;
uniform vec3 uSawA, uSawB;
uniform float uMarkOn;
varying vec3 vObjPos;
varying vec3 vObjNormal;
varying vec3 vCamObj;
varying float vDepth;
varying float vCap;
varying float vGround;

const float BOXH = ${BOX.toFixed(4)};
const float SD_LO = ${SD_LO.toFixed(4)};
const float SD_HI = ${SD_HI.toFixed(4)};
const int STEPS = 13;
const int TORCH_STEPS = 6;
const float VOXEL = ${((2 * BOX) / VOL_N).toFixed(5)};

vec3 uvw(vec3 p) { return p / (2.0 * BOXH) + 0.5; }

/**
 * Noise lookup with the texel fraction eased, so the interpolation is smooth
 * in its first derivative. Plain trilinear filtering is only continuous in
 * value, and a bump map taken from it shades as a field of tiny flat facets.
 */
vec4 noiseSmooth(vec3 p) {
  vec3 t = p * 64.0 + 0.5;
  vec3 i = floor(t), f = t - i;
  f = f * f * (3.0 - 2.0 * f);
  // mip level from the true footprint; the eased coordinate jumps at texel edges
  return textureGrad(uNoise, (i + f - 0.5) / 64.0, dFdx(p), dFdy(p));
}
vec3 lin(float r, float g, float b) { return pow(vec3(r, g, b), vec3(2.2)); }
float sat(float x) { return clamp(x, 0.0, 1.0); }

vec3 hash3(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}

/**
 * Interlocking crystal grains (a 3D Voronoi diagram).
 * x, z: two numbers that belong to the grain; y: distance to its boundary.
 */
vec3 grains(vec3 p) {
  vec3 ip = floor(p), fp = p - ip;
  float d1 = 9.0, d2 = 9.0;
  vec3 id = vec3(0.0);
  for (int k = -1; k <= 1; k++) for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec3 g = vec3(float(i), float(j), float(k));
    vec3 o = hash3(ip + g);
    vec3 r = g + o - fp;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; id = o; } else if (d < d2) { d2 = d; }
  }
  return vec3(id.x, sqrt(d2) - sqrt(d1), id.y);
}

/** Scattering per unit length: brick-opaque down to glass-clear. */
float sigmaOf(float zq) { return 190.0 * exp(-5.2 * zq) + 0.8; }

/** Body colour of the material, before any light transport. */
vec3 jadeAlbedo(float g, float pur, float yel, float blk) {
  vec3 gPale = lin(0.74, 0.92, 0.76), gVivid = lin(0.20, 0.76, 0.30), gDeep = lin(0.0, 0.42, 0.17);
  float h = abs(uHue);
  gVivid = mix(gVivid, uHue < 0.0 ? lin(0.10, 0.58, 0.56) : lin(0.55, 0.78, 0.18), h * 0.6);
  gPale = mix(gPale, uHue < 0.0 ? lin(0.72, 0.90, 0.92) : lin(0.86, 0.93, 0.70), h * 0.6);
  gDeep = mix(gDeep, uHue < 0.0 ? lin(0.0, 0.33, 0.33) : lin(0.16, 0.42, 0.05), h * 0.5);
  vec3 gc = g < 0.5 ? mix(gPale, gVivid, g * 2.0) : mix(gVivid, gDeep, (g - 0.5) * 2.0);
  vec3 c = mix(uBodyColor, gc, 1.0 - exp(-g * 6.5));
  vec3 pLight = mix(lin(0.86, 0.74, 0.92), lin(0.76, 0.78, 0.95), uPurpleTone);
  vec3 pDeep = mix(lin(0.55, 0.34, 0.70), lin(0.42, 0.40, 0.76), uPurpleTone);
  c = mix(c, mix(pLight, pDeep, pur), 1.0 - exp(-pur * 3.2));
  vec3 yc = mix(lin(0.95, 0.70, 0.18), lin(0.74, 0.22, 0.06), uYellowRed) * mix(1.0, 0.7, yel);
  c = mix(c, yc, 1.0 - exp(-yel * 3.6));
  return mix(c, lin(0.05, 0.065, 0.055), smoothstep(0.12, 0.7, blk));
}

/** Distance to crack i; 'side' is the signed offset from its sheet. */
float crackDist(int i, vec3 p, out float side) {
  vec3 d = p - uCrackC[i].xyz;
  vec3 n = uCrackNrm[i].xyz;
  float along = dot(d, n);
  side = along + uCrackA[i].x * sin(dot(p, uCrackK1[i].xyz) + uCrackK1[i].w) + uCrackA[i].y * sin(dot(p, uCrackK2[i].xyz) + uCrackK2[i].w);
  float rho = sqrt(max(dot(d, d) - along * along, 0.0));
  float rr = uCrackC[i].w * (1.0 + 0.18 * sin(dot(p, uCrackK3[i].xyz) + uCrackK3[i].w));
  float o = max(rho - rr, 0.0);
  return sqrt(side * side + o * o);
}

/**
 * What the flesh is at a point -- green, purple, yellow, black -- from the two
 * volume samples there and a sample of noise. The volume can only store colour
 * as a blur. Real colour ends in ragged, fibrous edges, so the detail is put
 * back here. A saw cut and the torch both read the flesh through this, so the
 * lamp promises nothing the blade will not find.
 */
vec4 fleshMix(vec4 a, vec4 b, vec4 nd) {
  float g = sat(a.r * (0.5 + 1.0 * nd.g) + (nd.a - 0.5) * 0.12 * smoothstep(0.02, 0.2, a.r));
  g = sat(g * smoothstep(0.04, 0.24, g) * 1.2); // colour stops; it does not fade to a haze
  // 黑癬 is crystals, not a smudge: a hard ragged edge and a dusting of specks round it
  float blk = smoothstep(0.3, 0.5, b.b + (nd.g - 0.5) * 0.5 + (nd.a - 0.5) * 0.28);
  blk = max(blk, smoothstep(0.8, 0.88, nd.a) * smoothstep(0.05, 0.3, b.b));
  return vec4(g, sat(b.r * (0.6 + 0.8 * nd.g)), sat(b.g * (0.55 + 0.9 * nd.r)), blk);
}

/**
 * What stands between the torch and x: how fast the light dies on the way
 * (ext, per unit length) and which colours the stone takes out of it (dye).
 * Chalky stone swallows the light within millimetres, clear stone carries it
 * most of the way across; black, cotton and shattered ground stand in its way.
 */
void torchPath(vec3 x, vec3 inward, float jitter, out vec3 dye, out float ext) {
  vec3 seg = x - uTorchPos;
  float len = length(seg);
  // Scattered light does not keep to the straight line under the skin: on its
  // way from lamp to eye it sags into the body of the stone, deeper the
  // further it has to go. So that is where the samples are taken.
  vec3 sag = inward * (len * 0.3);
  // long steps read a blurred copy of the volume, so a thin vein is not stepped over
  float lod = clamp(log2(len / (float(TORCH_STEPS) * VOXEL) + 1e-4), 0.0, 1.5);
  vec3 made = vec3(0.0);
  ext = 0.0;
  for (int i = 0; i < TORCH_STEPS; i++) {
    float f = (float(i) + jitter) / float(TORCH_STEPS);
    vec3 q = uvw(uTorchPos + seg * f + sag * (4.0 * f * (1.0 - f)));
    vec4 a = textureLod(uTexA, q, lod), b = textureLod(uTexB, q, lod);
    // (a faint haze of colour is not colour: the same cut-off the flesh itself is drawn with)
    made += vec3(a.r * smoothstep(0.04, 0.24, a.r) * 1.2, b.r, b.g);
    ext += 1.0 / mix(0.03, 1.5, pow(a.g, 2.5)) + b.b * 22.0 + a.b * smoothstep(0.25, 0.6, a.g) * 4.0 + b.a * 8.0;
  }
  made /= float(TORCH_STEPS);
  ext /= float(TORCH_STEPS);
  // Light that has crossed coloured material carries some of its colour. (The
  // rusty layer under the skin is thin beside the body of the stone; counted
  // in full it would drown every green in orange.)
  vec3 alb = jadeAlbedo(min(made.x, 1.0), made.y, made.z * 0.5, 0.0);
  dye = 1.0 - alb / max(alb.r, max(alb.g, alb.b));
}

/** Torch light arriving at x, given what the way there is made of. */
vec3 torchAt(vec3 x, vec3 dye, float ext) {
  float d = distance(x, uTorchPos);
  // the lamp is a disc as wide as its bezel, not a point: the glow starts at the rim
  float r = max(d - uTorchRim * 0.7, 0.0);
  float spread = 1.0 + r * 4.0;
  // (the dye is kept mild: a torch that turns a few green threads into a green stone is lying about the cut)
  return uTorchColor * exp(-dye * (d * 0.35) - ext * r) * (uTorchPower * uTorchEntry / (spread * spread));
}

float segDist(vec3 p, vec3 a, vec3 b) {
  vec3 ab = b - a;
  float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
  return distance(p, a + ab * t);
}
`;

// ----------------------------------------------------------------------------
const SURFACE = /* glsl */ `
vec3 jP = vObjPos;
vec3 jN = normalize(vObjNormal);
vec3 jV = normalize(vCamObj - jP);
float gs = uUnit / 7.0;

vec3 pGrain = jP * (2.3 * gs / uGrain) + 0.11;
vec3 pFine = jP * (9.5 * gs / uGrain) + 0.53;
vec3 pCrystal = jP * uCrystal;
vec4 nBig = noiseSmooth(jP * 0.21 + uStainOff);
vec4 nMed = noiseSmooth(jP * 0.83 + 0.37);
vec4 nGrain = noiseSmooth(pGrain);
vec4 nFine = noiseSmooth(pFine);
// Relief finer than a few pixels cannot be shaded from screen-space
// derivatives without breaking into blocks, so it flattens out with distance.
float reliefGrain = 1.0 - smoothstep(0.22, 0.7, length(fwidth(pGrain)) * 64.0);
float reliefFine = 1.0 - smoothstep(0.22, 0.7, length(fwidth(pFine)) * 64.0);
float crystalFade = 1.0 - smoothstep(0.22, 0.6, length(fwidth(pCrystal)));
float cutFace = step(0.5, vCap);
// a different fraction of a step for every pixel: banding in a march turns to grain
float jJit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
// where the line of sight goes once it is inside the stone
vec3 jIn = refract(-jV, jN, 1.0 / 1.6);
if (dot(jIn, jIn) < 0.5) jIn = -jN;

// ---- which layer is this fragment on?
float jDepth = vDepth;
float jPolish = 0.0;
float jRaw = 0.0; // a window that has been ground but not yet wiped
float jGroove = 0.0; // relief of the burr's track that is finer than the mesh
for (int i = 0; i < ${MAX_WINDOWS}; i++) {
  if (i >= uWinN) break;
  float r = uWin[i].w;
  float d = distance(jP, uWin[i].xyz);
  if (d < r * 1.35) {
    float inside = 1.0 - smoothstep(r * 0.8, r * 1.25, d);
    jPolish = max(jPolish, uWinP[i].y * inside);
    jRaw = max(jRaw, (1.0 - uWinP[i].y) * (1.0 - smoothstep(r * 1.1, r * 1.35, d)));
  }
}
jPolish *= 1.0 - cutFace; // a window's polish stops at the saw face that later cut through it
jRaw *= 1.0 - cutFace;
// The window being ground: only as deep, at each spot, as the burr has taken it.
if (uWinLive >= 0 && vCap < 0.5) {
  vec3 rel = jP - uGrindC.xyz;
  if (dot(rel, rel) < uGrindC.w * uGrindC.w) {
    vec2 guv = vec2(dot(rel, uGrindU.xyz), dot(rel, uGrindV.xyz)) + 0.5;
    // A burr chews its way along: the edge of its track wanders. (Only by the
    // broad noise: anything finer than a few pixels here would flip single
    // pixels between skin and rind, and show the noise's own lattice as a mesh.)
    guv += (vec2(nMed.r, nMed.a) - 0.5) * 0.03 + (vec2(nBig.g, nBig.a) - 0.5) * 0.02;
    float ground = texture2D(uGrind, guv).r;
    for (int i = 0; i < ${MAX_WINDOWS}; i++) {
      if (i >= uWinN) break;
      if (i == uWinLive) continue;
      float r = uWin[i].w;
      ground = max(ground, 1.0 - smoothstep(r * 0.5, r * 1.3, distance(jP, uWin[i].xyz)));
    }
    jDepth *= ground;
    jGroove = vDepth * (ground - vGround);
  }
}
float wob = (nMed.g - 0.5) * 0.012 + (nMed.a - 0.5) * 0.005; // ragged layer boundaries
float soft = 0.0018 + fwidth(jDepth) * 1.2;
float outer = 1.0 - smoothstep(0.0022, 0.005, jDepth);
// The rind is a crust of uneven thickness, and under it the fog creeps into
// the flesh in tongues: neither boundary is ever a clean ring.
float tRind = uSkinT * (0.8 + 0.25 * nMed.a);
float fogW = uFogT * (0.42 + 0.45 * nBig.b + 0.28 * nMed.r);
float dIn = jDepth + wob * 0.6;
float sRind = smoothstep(tRind - soft, tRind + soft, dIn);
float fogDepth = (dIn - tRind) / max(fogW, 1e-4); // 0 under the rind, 1 where the fog gives out
float flesh = sRind * smoothstep(0.6, 1.0, fogDepth + (nGrain.a - 0.5) * 0.2 + (nMed.g - 0.5) * 0.14);
float rind = (1.0 - outer) * (1.0 - sRind);
float fogL = sRind * (1.0 - flesh);
float exposed = 1.0 - outer;

vec3 jCol = vec3(0.0);
vec3 jEmissive = vec3(0.0);
float jRough = 0.9, jCoat = 0.0, jCoatRough = 0.12, jHeight = 0.0, jFilm = 0.0;

// ---- skin: what is just underneath shows through as 松花, 癬 and stain
vec3 below = jP - jN * (uSkinT + uFogT + 0.022);
vec4 sA = textureLod(uTexA, uvw(below), 0.0);
vec4 sB = textureLod(uTexB, uvw(below), 0.0);
float skinCrack = 0.0, rust = 0.0, fleshCrack = 0.0, fleshRust = 0.0, fleshHealed = 0.0, crackGroove = 0.0;
float cSide[${MAX_CRACKS}], cWide[${MAX_CRACKS}]; // which side of each crack this spot is on, for the torch
for (int i = 0; i < ${MAX_CRACKS}; i++) {
  if (i >= uCrackN) break;
  float side;
  float cd = crackDist(i, jP, side);
  // (width from the signed offset: the distance itself has a kink on the line, where its derivative vanishes)
  float w = max(0.0032, fwidth(side) * 1.4);
  cSide[i] = side; cWide[i] = w;
  float line = 1.0 - smoothstep(w * 0.4, w * 1.7, cd);
  float healed = uCrackB[i].x;
  skinCrack = max(skinCrack, line * uCrackA[i].w * (1.0 - 0.5 * healed));
  // a groove only when the crack is wide enough on screen to shade without shimmering
  crackGroove = max(crackGroove, (1.0 - smoothstep(0.004, 0.012, cd)) * uCrackA[i].w * (1.0 - smoothstep(0.0008, 0.002, fwidth(side))));
  rust = max(rust, (1.0 - smoothstep(0.0, 0.05, cd)) * uCrackA[i].z * uCrackA[i].w);
  fleshCrack = max(fleshCrack, line * uCrackNrm[i].w * (1.0 - healed));
  fleshHealed = max(fleshHealed, line * healed);
  // iron creeps out from a stained crack, further along some grains than others
  fleshRust = max(fleshRust, (1.0 - smoothstep(0.0, 0.02 + 0.05 * nGrain.g, cd)) * uCrackA[i].z * (1.0 - healed));
}

// ---- torch: what its light has to cross to get under this spot
vec3 tDye = vec3(0.0);
float tExt = 0.0, tOpen = 1.0;
if (uTorchPower > 0.0) {
  torchPath(jP - jN * 0.03, -normalize(jN + normalize(uTorchPos)), jJit, tDye, tExt);
  // A crack is a mirror standing in the light's way: the stone beyond it stays
  // dark, and the shadow's edge lies exactly along the crack -- seen on the
  // skin or not.
  vec3 seg = jP - uTorchPos;
  for (int i = 0; i < ${MAX_CRACKS}; i++) {
    if (i >= uCrackN) break;
    float sT, sH;
    crackDist(i, uTorchPos, sT);
    float sX = cSide[i];
    float across = smoothstep(-cWide[i], cWide[i], -sX * sign(sT)); // 0 on the lamp's side of the sheet, 1 beyond it
    float den = sT - sX;
    vec3 h = uTorchPos + seg * (abs(den) > 1e-5 ? clamp(sT / den, 0.0, 1.0) : 1.0);
    float cd = crackDist(i, h, sH);
    float past = sqrt(max(cd * cd - sH * sH, 0.0)); // how far outside the sheet's edge the light slips by
    tOpen *= 1.0 - across * (1.0 - smoothstep(0.0, 0.06, past)) * uCrackNrm[i].w * mix(0.85, 0.3, uCrackB[i].x);
  }
}
float mang = 0.0;
for (int i = 0; i < ${MAX_BANDS}; i++) {
  if (i >= uBandN) break;
  vec3 d = jP - uBandC[i].xyz;
  float along = dot(d, uBandNrm[i].xyz);
  float rho = sqrt(max(dot(d, d) - along * along, 0.0));
  float th = uBandNrm[i].w;
  mang = max(mang, (1.0 - smoothstep(th * 0.8, th * 1.9, abs(along + (nMed.r - 0.5) * 0.09))) * (1.0 - smoothstep(uBandC[i].w * 0.85, uBandC[i].w * 1.2, rho)));
}
// 松花: a faded, mossy speckling over colour that lies just under the skin -- never paint
float song = smoothstep(0.1, 0.5, sA.r + (nMed.r - 0.5) * 0.3) * smoothstep(0.34, 0.62, nGrain.g + (nMed.a - 0.5) * 0.5);
float xian = smoothstep(0.3, 0.6, sB.b + (nMed.g - 0.5) * 0.28);
float wax = uSkinWax * smoothstep(0.38, 0.6, nBig.b + (nMed.r - 0.5) * 0.3);
float pits = 1.0 - smoothstep(0.17, 0.3, nFine.g);
float grit = nGrain.a * 0.55 + nFine.a * 0.45; // 0..1 height of the sand
vec3 skinCol = uSkinColor;
skinCol = mix(skinCol, uSkinStain, smoothstep(0.4, 0.74, nBig.r + (uStainAmt - 0.5) * 0.5 + (nMed.a - 0.5) * 0.2) * 0.85);
skinCol = mix(skinCol, uSkinDark, pits * 0.45 + smoothstep(0.56, 0.82, nBig.g + (nMed.g - 0.5) * 0.3) * 0.45);
skinCol *= 0.9 + 0.2 * nMed.r;
// dirt sits in the hollows between grains, the grain tops are rubbed pale
skinCol *= mix(1.0, 0.55 + 0.75 * smoothstep(0.25, 0.75, grit), uSpeck);
skinCol += lin(0.6, 0.58, 0.52) * smoothstep(0.78, 0.92, nFine.a) * uSpeck * 0.1;
vec3 songCol = mix(skinCol * vec3(0.62, 0.85, 0.55), lin(0.22, 0.42, 0.26), 0.35 + 0.4 * sat(sA.r));
skinCol = mix(skinCol, songCol, song * 0.6);
skinCol = mix(skinCol, skinCol * mix(vec3(1.3, 0.92, 0.5), vec3(1.25, 0.55, 0.4), uYellowRed), sB.g * 0.45);
skinCol = mix(skinCol, lin(0.07, 0.075, 0.07), xian * 0.92);
skinCol = mix(skinCol, skinCol * 1.2 + 0.03, mang * 0.55);
skinCol = mix(skinCol, uSkinStain * 0.7, rust * 0.5);
skinCol *= 1.0 - 0.82 * skinCrack;
float skinRough = mix(uSkinRough, 0.3, max(xian * 0.8, wax));
float skinHeight = ((nGrain.a - 0.5) * 0.0075 * reliefGrain + ((nFine.a - 0.5) * 0.003 + (nFine.g - 0.5) * 0.0012 - pits * 0.003) * reliefFine)
    * uGrain * (1.0 - 0.6 * mang) * (1.0 - 0.75 * max(xian, wax))
  + (nMed.g - 0.5) * 0.013 + (nMed.a - 0.5) * 0.006 + (nBig.g - 0.5) * 0.02 - crackGroove * 0.006;

// ---- the cut through the stone: crystal grains, and what the flesh is just here
// Jade is a felt of interlocked crystals, never a tidy mosaic: the lattice is
// warped so no two grains match, small crystals fill in between the large
// ones, and a seam is a soft change of tone rather than a drawn line.
vec3 gr = vec3(0.5, 1.0, 0.5), gr2 = vec3(0.5, 1.0, 0.5);
vec4 fA = vec4(0.0, 0.4, 0.0, 0.0), fB = vec4(0.0);
float fineFade = 1.0 - smoothstep(0.22, 0.6, length(fwidth(pCrystal)) * 2.3);
float crystalVis = 0.0;
if (exposed > 0.004) {
  fA = textureLod(uTexA, uvw(jP - jN * 0.004), 0.0);
  fB = textureLod(uTexB, uvw(jP - jN * 0.004), 0.0);
  crystalVis = (1.0 - smoothstep(0.18, 0.62, fA.g)) * crystalFade;
  // (the lattice search is the dearest thing on a cut face: skip it wherever the grains would not show)
  if (crystalVis > 0.01) {
    vec3 warp = (nGrain.rgb - 0.5) * 0.95;
    gr = grains(pCrystal + warp);
    if (fineFade > 0.01) gr2 = grains(pCrystal * 2.3 + 7.1 - warp);
  }
}
float grainTone = (gr.x - 0.5) * 0.62 + (gr2.x - 0.5) * 0.38 * fineFade; // each grain returns a little more or less light
float seam = ((1.0 - smoothstep(0.0, 0.17, gr.y)) * 0.62 + (1.0 - smoothstep(0.0, 0.2, gr2.y)) * 0.3 * fineFade) * crystalVis;

// rind: a dark gritty crust. fog: weathered, stained jade -- rusty against the
// skin, paling inward, patchy from grain to grain
vec3 rindCol = mix(uSkinColor, uSkinStain, 0.6) * (0.32 + 0.42 * nGrain.a) * (0.85 + 0.3 * nFine.a);
float fd = sat(fogDepth);
vec3 stained = jadeAlbedo(fA.r * 0.6, fB.r * 0.5, fB.g, fB.b * 0.6);
vec3 fogCol = mix(uFogColor * vec3(0.52, 0.4, 0.32), uFogColor, smoothstep(0.0, 0.6, fd + (nGrain.g - 0.5) * 0.3));
fogCol = mix(fogCol, stained, 0.16 + 0.42 * fd * fd);
fogCol *= (0.8 + 0.28 * nMed.r) * (1.0 + grainTone * 0.26 * crystalVis) * (1.0 - 0.2 * seam);

// ---- flesh: march into the volume
vec3 fleshCol = vec3(0.0), fleshGlow = vec3(0.0);
float fleshZ = 0.5, fleshGrain = 0.0;
if (flesh > 0.004) {
  vec3 rd = jIn;
  // where does the ray meet each crack sheet?
  float tc[${MAX_CRACKS}];
  for (int i = 0; i < ${MAX_CRACKS}; i++) {
    tc[i] = -1.0;
    if (i >= uCrackN) continue;
    vec3 n = uCrackNrm[i].xyz;
    float den = dot(rd, n);
    if (abs(den) < 0.02) continue;
    float t = dot(uCrackC[i].xyz - jP, n) / den;
    if (t <= 0.0) continue;
    float side;
    float cd = crackDist(i, jP + rd * t, side);
    t -= (side - dot(jP + rd * t - uCrackC[i].xyz, n)) / den; // follow the sheet's waviness
    if (t > 0.0 && cd < abs(side) + 0.004) tc[i] = t;
  }
  float jitter = jJit;
  vec3 T = vec3(1.0);
  float t = 0.0, dt = 0.0055;
  for (int s = 0; s < STEPS; s++) {
    vec3 x = jP + rd * (t + dt * (0.35 + 0.5 * jitter));
    bool gone = false;
    for (int i = 0; i < ${MAX_PLANES}; i++) {
      if (i >= uPlaneN) break;
      if (dot(uPlanes[i].xyz, x) - uPlanes[i].w > 0.0) gone = true;
    }
    vec3 q = uvw(x);
    vec4 a = textureLod(uTexA, q, 0.0);
    float sdv = mix(SD_LO, SD_HI, a.a);
    if (gone || sdv > 0.0) {
      // out the far side: a little daylight comes back through thin, clear stone
      fleshCol += T * lin(0.30, 0.31, 0.30) * 0.5;
      T = vec3(0.0);
      break;
    }
    if (s > 0 && -sdv < uSkinT + uFogT * 0.5) {
      // the inside of the skin
      fleshCol += T * fogCol * 0.22;
      T = vec3(0.0);
      break;
    }
    vec4 b = textureLod(uTexB, q, 0.0);
    vec4 nd = textureLod(uNoise, x * (2.6 * gs) + 0.2, 0.0);
    vec4 fm = fleshMix(a, b, nd);
    float g = fm.x, pur = fm.y, yel = fm.z, blk = fm.w;
    float zq = a.g;
    if (s == 0) fleshZ = zq;
    vec3 alb = jadeAlbedo(g, pur, yel, blk);
    // a grey-green halo of stained ground round the black
    alb = mix(alb, alb * vec3(0.7, 0.8, 0.73), smoothstep(0.08, 0.3, b.b) * (1.0 - blk) * 0.55);
    // clear material reads cool and watery, not chalk white
    alb *= mix(vec3(1.0), vec3(0.84, 0.92, 0.95), smoothstep(0.45, 0.9, zq) * (1.0 - sat(g * 3.0)));
    // jade is a felt of crystals: denser and thinner patches, milky along the seams
    alb *= 0.93 + 0.14 * nd.g;
    float sig = sigmaOf(zq) * mix(0.6, 1.55, nd.r);
    sig += (1.0 - smoothstep(0.0, 0.22, nd.b)) * 26.0 * (1.0 - zq);
    // cotton: specks like snow, or drifting cloud
    vec4 nc = textureLod(uNoise, x * (uCottonDots > 0.5 ? 4.6 : 1.9) * gs + 0.7, 0.0);
    float cot = a.b * (uCottonDots > 0.5 ? smoothstep(0.74, 0.83, nc.a) * 1.7 * (0.35 + a.b) : smoothstep(0.55, 0.82, nc.r) * smoothstep(0.3, 0.6, nc.g))
      * mix(0.4, 1.0, smoothstep(0.25, 0.6, zq));
    sig += cot * 110.0;
    alb = mix(alb, lin(0.9, 0.91, 0.89), sat(cot) * 0.85 * (1.0 - blk));
    // shattered ground: a net of hairline cracks
    float net = (1.0 - smoothstep(0.03, 0.09, textureLod(uNoise, x * (1.5 * gs) + 0.9, 0.0).b)) * b.a;
    sig += net * 90.0;
    alb = mix(alb, alb * 0.35, net * 0.7);
    float aStep = 1.0 - exp(-sig * dt);
    float Ts = dot(T, vec3(0.333));
    // crack sheets crossed in this step flash back whatever light is about
    for (int i = 0; i < ${MAX_CRACKS}; i++) {
      if (tc[i] > t && tc[i] <= t + dt) {
        float healed = uCrackB[i].x;
        float op = uCrackNrm[i].w * mix(0.72, 0.22, healed);
        vec3 ca = mix(lin(0.9, 0.9, 0.88), lin(0.55, 0.3, 0.1), uCrackA[i].z * (1.0 - healed));
        fleshCol += T * op * ca * sqrt(Ts) * 0.75 * exp(-t * 3.2);
        if (uTorchPower > 0.0) fleshGlow += T * op * ca * torchAt(x, tDye, tExt) * 1.6;
        T *= 1.0 - op;
      }
    }
    // light that has gone deep rarely finds its way back out
    fleshCol += T * aStep * alb * sqrt(Ts) * exp(-t * 3.2);
    if (uTorchPower > 0.0) fleshGlow += T * aStep * alb * torchAt(x, tDye, tExt);
    T *= 1.0 - aStep;
    T *= exp(-(vec3(1.0) - alb) * 4.5 * dt);
    t += dt;
    dt *= 1.42;
    if (max(T.r, max(T.g, T.b)) < 0.015) break;
  }
  // Coarse material shows its crystals: each grain lies at its own angle and
  // returns a little more or less light, with a fine dark seam between them.
  // Finer material keeps only a sugary tooth; the finest is smooth as wax.
  fleshGrain = 1.0 - smoothstep(0.1, 0.5, fleshZ);
  fleshCol *= 1.0 + grainTone * 0.2 * crystalVis;
  fleshCol *= 1.0 - 0.12 * seam;
  fleshCol *= 1.0 + (nFine.a - 0.5) * 0.12 * (1.0 - smoothstep(0.3, 0.8, fleshZ)) * reliefFine;
  // cracks where they break the surface
  fleshCol = mix(fleshCol, mix(fleshCol * 0.5, lin(0.5, 0.27, 0.09), 0.7), fleshRust * 0.6);
  fleshCol = mix(fleshCol, fleshCol * 1.25 + 0.03, fleshHealed * 0.5);
  fleshCol *= 1.0 - 0.8 * fleshCrack;
}

// ---- put the layers together
jCol = skinCol * outer + rindCol * rind + fogCol * fogL + fleshCol * flesh;
// the blade leaves faint arcs across a sawn face
float sawArg = length(jP - vec3(0.6, 2.8, 0.3)) * 230.0 + nMed.r * 9.0;
float sawMark = sin(sawArg) * (1.0 - smoothstep(0.8, 2.2, fwidth(sawArg))) * cutFace * exposed;
jCol *= 1.0 + sawMark * 0.022;
// Water does not lie evenly: it pools, thins and beads, so the sheen comes and goes.
float film = smoothstep(0.3, 0.62, nBig.b * 0.55 + nMed.r * 0.5 + nBig.r * 0.15);
float wetFace = uWet * cutFace;
// a window is polished; a sawn face is matte until water is thrown on it
float gloss = mix(jPolish, uWet * (0.5 + 0.5 * film), cutFace);
// (the sawn face itself stays rough under its film of water; only polishing smooths the stone)
float fleshRough = mix(mix(0.66, 0.46, fleshZ), mix(0.3, 0.07, fleshZ), jPolish) + fleshGrain * 0.12 * (1.0 - gloss) + sawMark * 0.03;
jRough = skinRough * outer + 0.88 * rind + 0.72 * fogL + fleshRough * flesh;
jCoat = exposed * gloss * mix(0.5, mix(0.6, 1.0, jPolish), flesh);
jCoatRough = mix(mix(0.2, 0.09, fleshZ) + (1.0 - film) * 0.08, mix(0.12, 0.03, fleshZ), jPolish * flesh);
jHeight = skinHeight * outer + (rind + fogL) * (nGrain.a * 0.004 * reliefGrain - seam * 0.002)
  + flesh * (1.0 - gloss) * (nGrain.a * 0.003 * fleshGrain * reliefGrain - seam * 0.001)
  + sawMark * 0.00016 * (1.0 - 0.8 * gloss) - jGroove * 0.7;
// Until it is wiped, a freshly ground window lies under the milk of its own
// grinding: the colour is there to be guessed at, and comes up with the water.
float veil = jRaw * exposed * (0.12 + 0.24 * smoothstep(0.3, 0.75, nMed.r * 0.6 + nGrain.a * 0.4));
jCol = mix(jCol, lin(0.80, 0.79, 0.74) * (0.82 + 0.3 * nGrain.a) * mix(vec3(1.0), jCol * 2.0 + 0.4, 0.3), veil);
jRough = mix(jRough, 0.9, veil);
// Broad swells built from sines, not from the noise texture: anything sampled
// from a lattice has a gradient that dips at every lattice point, and a mirror
// film shows that as a grid in the highlight.
jFilm = (sin(dot(jP, vec3(7.1, 3.3, 5.7))) + 0.7 * sin(dot(jP, vec3(-4.3, 8.9, 2.1)) + 1.7) + 0.4 * sin(dot(jP, vec3(12.3, -6.1, 9.7)) + 0.6)
  + 0.22 * sin(dot(jP, vec3(-19.0, 14.0, 23.0)) + 2.9)) * 0.0042 * wetFace;
// wet stone is darker and richer than dry stone
jCol = mix(jCol, pow(jCol, vec3(1.12)) * 0.9, wetFace * exposed * (0.6 + 0.4 * film));
// the cleavage of a coarse grain flashing as the eye moves across it (翠性)
float flashHit = pow(sat(dot(normalize(vec3(gr.x, gr.z, fract(gr.x * 7.31 + gr.z * 3.7)) * 2.0 - 1.0), jV)), 70.0);
jEmissive += vec3(0.85, 0.88, 0.84) * flashHit * crystalVis * flesh * 0.2 * uLit * smoothstep(0.03, 0.12, gr.y);

// wet skin goes dark and takes a sheen
jCol *= mix(1.0, 0.66, uWet * outer);
jRough = mix(jRough, jRough * 0.55, uWet * outer);
jCoat = max(jCoat, uWet * outer * 0.45);

// ---- torch
if (uTorchPower > 0.0) {
  vec3 off = jP - uTorchPos;
  float dT = length(off);
  // Through the skin the eye sees the lit flesh under it, a little way down
  // the line of sight: the glow has depth, and slides under the sand as the
  // stone is turned.
  vec3 deepP = jP + jIn * ((uSkinT + uFogT + 0.03) / max(dot(jIn, -jN), 0.6));
  vec4 dA = textureLod(uTexA, uvw(deepP), 0.0), dB = textureLod(uTexB, uvw(deepP), 0.0);
  // The flesh there is read the way a saw cut would show it, and it colours
  // the glow no more than that: a thread of green lights up as a thread, pale
  // ground stays pale, and coloured flesh is dimmer than the ground round it,
  // as it is on a cut face. Black and shattered ground hold the light back.
  vec4 dM = fleshMix(dA, dB, textureLod(uNoise, deepP * (2.6 * gs) + 0.2, 0.0));
  vec3 body = jadeAlbedo(dM.x, dM.y, dM.z * 0.5, 0.0);
  body /= max(max(body.r, max(body.g, body.b)), max(uBodyColor.r, max(uBodyColor.g, uBodyColor.b)));
  // and the skin it shines through is a diffuser: it washes the colour out about as far as the wet
  // sheen does on a sawn face, so the green under the lamp is the green the cut will show, not a richer one
  body = mix(vec3(1.0), body, 0.55);
  body *= mix(vec3(1.0), vec3(0.9, 0.97, 1.0), smoothstep(0.45, 0.9, dA.g) * (1.0 - sat(dM.x * 3.0))); // clear stone reads cool
  float held = (1.0 - 0.85 * dM.w) * (1.0 - 0.4 * dB.a);
  vec3 skinGlow = torchAt(deepP, tDye, tExt) * body * (tOpen * held * uSkinPass * 24.0);
  vec3 cutGlow = fleshGlow * (tOpen * 14.0);
  // however hard the lamp is pressed in, the stone glows; it does not burn out to a white lamp
  skinGlow /= 1.0 + dot(skinGlow, vec3(0.25, 0.6, 0.15)) / 1.9;
  cutGlow /= 1.0 + dot(cutGlow, vec3(0.25, 0.6, 0.15)) / 3.0;
  // The skin is a screen the light comes out through, and it stays a skin
  // however bright the stone behind it: lighter between the grains of sand,
  // shut where 癬, wax or a dirt-filled crack sits on it, tinted its own colour.
  float screen = mix(1.0, 0.52 + 0.8 * smoothstep(0.25, 0.75, grit), sat(uSpeck + 0.3))
    * (1.0 - 0.8 * xian) * (1.0 - 0.7 * wax) * (1.0 - 0.9 * skinCrack);
  skinGlow *= mix(vec3(1.0), normalize(uSkinColor + 0.05) * 1.6, 0.5) * screen;
  // Light escaping between the bezel and the stone: a tight ring on the
  // surface itself, strongest where the gap opens. It is lit stone, not a
  // lamp, so it is never brighter than the stone can reflect.
  float rimD = (dT - uTorchRim) / max(uTorchRim, 0.02);
  float gapSide = 0.2 + 0.8 * sat(dot(off / max(dT, 1e-4), uTorchLeak) * 1.5);
  float spill = exp(-rimD * rimD * 6.0) * gapSide * smoothstep(0.5, 0.9, dT / max(uTorchRim, 0.02));
  vec3 lit = jCol * uTorchColor * (uTorchPower * 0.8 * spill);
  jEmissive += skinGlow * (outer + 0.45 * (rind + fogL)) + cutGlow * flesh + lit;
}

// ---- slurry left on a fresh saw face, until it is washed off
if (uSlurry > 0.0 && vCap > 0.5) {
  float onFace = 1.0 - smoothstep(0.004, 0.012, abs(dot(jP, uSlurryPlane.xyz) - uSlurryPlane.w));
  float m = sat(uSlurry * 1.7 - nMed.r * 0.7 - nBig.g * 0.25) * onFace;
  vec3 mud = lin(0.80, 0.79, 0.74) * (0.8 + 0.3 * nGrain.a) * mix(vec3(1.0), jCol * 2.0 + 0.4, 0.18) * (1.0 + sawMark * 0.12);
  jCol = mix(jCol, mud, m * 0.95);
  jRough = mix(jRough, 0.92, m);
  jCoat *= 1.0 - m;
  jFilm *= 1.0 - m;
  jEmissive *= 1.0 - m * 0.9;
}

// ---- the saw at work: a dark kerf with slurry smeared beside it
if (uSawOn > 0.5) {
  float kd = abs(dot(jP, uKerf.xyz) - uKerf.w);
  float swept = 1.0 - smoothstep(uSawR - 0.01, uSawR + 0.004, segDist(jP, uSawA, uSawB));
  float smear = (1.0 - smoothstep(0.0, 0.07, kd)) * swept * (0.5 + 0.5 * nMed.r);
  jCol = mix(jCol, lin(0.78, 0.77, 0.72), smear * 0.7);
  jRough = mix(jRough, 0.9, smear);
  float slot = (1.0 - smoothstep(0.004, 0.0075, kd)) * swept;
  jCol = mix(jCol, vec3(0.004), slot);
  jCoat *= 1.0 - slot;
  jEmissive *= 1.0 - slot;
}

// ---- laser guide of the saw
if (uLaserOn > 0.0) {
  float ls = dot(jP, uLaser.xyz) - uLaser.w;
  float ld = abs(ls);
  float lw = max(0.0022, fwidth(ls) * 1.2);
  jEmissive += vec3(1.0, 0.03, 0.02) * uLaserOn * ((1.0 - smoothstep(lw * 0.5, lw * 1.5, ld)) * 3.5 + exp(-ld * ld / 0.0009) * 0.35);
}

// ---- chalk ring where a window is about to be ground
if (uMarkOn > 0.0) {
  float ms = distance(jP, uMark.xyz) - uMark.w;
  float md = abs(ms);
  float mw = max(0.004, fwidth(ms) * 1.5);
  float ring = 1.0 - smoothstep(mw * 0.5, mw * 1.6, md);
  jCol = mix(jCol, vec3(0.9), ring * 0.55 * uMarkOn);
  jEmissive += vec3(1.0, 0.85, 0.5) * ring * 0.5 * uMarkOn;
}

jEmissive += vec3(0.35, 1.0, 0.65) * uHover * (0.035 + 0.1 * pow(1.0 - sat(dot(jN, jV)), 2.5));
if (uClay > 0.5) { jCol = vec3(0.5); jRough = 0.8; jCoat = 0.0; jEmissive = vec3(0.0); }
diffuseColor.rgb = jCol;
`;
