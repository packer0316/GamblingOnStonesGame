import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ease } from '../util/anim.js';
import { createRoom } from './room.js';

const ENV = 0.42, KEY = 360; // environment fill against the lamp over the bench
const DIM = { lights: 0.2, env: 0.34, sky: 0.45 }; // what is left of each when the room is darkened for the torch

// World units are decimetres: a stone 20 cm long is 2 units. The bench top is y = 0.

/** A jade dealer's lamp-lit stall, captured into an environment map. */
function buildEnvironment(renderer) {
  const env = new THREE.Scene();
  env.add(new THREE.Mesh(
    new THREE.SphereGeometry(30, 32, 16),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0.016, 0.014, 0.012), side: THREE.BackSide }),
  ));
  const panel = (w, h, pos, color, power) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(power), side: THREE.DoubleSide }),
    );
    m.position.set(...pos);
    m.lookAt(0, 0, 0);
    env.add(m);
  };
  panel(8, 5, [0, 9, 2], 0xfff3e0, 5.2); // the big lamp over the bench
  panel(4, 4, [7, 5, 6], 0xffe8c8, 2.6); // warm key
  panel(1.0, 8, [-9, 2, 3], 0xcfe6ff, 6.5); // cool strip, left
  panel(1.0, 7, [9, 1.5, -3], 0xffd3a0, 5.5); // warm strip, right
  panel(7, 1.2, [0, 5, -9], 0xe6f0ff, 4.5); // back rim
  panel(3, 3, [-5, 3, 8], 0xe8ecff, 1.2); // soft fill
  panel(16, 16, [0, -9, 0], 0x14110d, 1); // bounce off the dark cloth
  for (let i = 0; i < 7; i++) {
    // bare bulbs strung along the market lane
    const a = (i / 7) * Math.PI * 2 + 0.3;
    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 8, 6),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.86, 0.62).multiplyScalar(10) }),
    );
    dot.position.set(Math.cos(a) * 11, 5 + Math.sin(i * 2.3) * 1.8, Math.sin(a) * 11);
    env.add(dot);
  }
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(env, 0.012).texture;
  pmrem.dispose();
  env.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
  return tex;
}

export function createStage(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.environment = buildEnvironment(renderer);
  scene.environmentIntensity = ENV;
  // The hall the bench stands in, and the bench itself.
  const room = createRoom();
  scene.add(room.group);
  const bench = room.felt;

  // The lamp over the bench, plus rims to pull the stone off the dark.
  const key = new THREE.SpotLight(0xfff1dc, KEY, 60, 0.36, 0.65, 2);
  key.position.set(3.2, 11, 5.5);
  key.target.position.set(0, 0.4, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0005;
  key.shadow.radius = 5;
  key.shadow.camera.near = 4;
  key.shadow.camera.far = 30;
  scene.add(key, key.target);
  const rimL = new THREE.DirectionalLight(0xa8d8ff, 1.5);
  rimL.position.set(-6, 3, -5);
  const rimR = new THREE.DirectionalLight(0xffc890, 1.0);
  rimR.position.set(6, 2, -4);
  const fill = new THREE.DirectionalLight(0xdfe6ff, 0.45);
  fill.position.set(-3, 2.5, 7);
  scene.add(rimL, rimR, fill);
  const lights = [[key, KEY], [rimL, 1.5], [rimR, 1.0], [fill, 0.45]];

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
  camera.position.set(0, 4.2, 9.5);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0.6, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.09;
  controls.enablePan = false;
  controls.rotateSpeed = 0.6;
  controls.zoomSpeed = 0.75;
  controls.minPolarAngle = 0.12;
  controls.maxPolarAngle = 1.5;
  controls.update();

  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  const BLOOM_BASE = 0.16;
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), BLOOM_BASE, 0.55, 1.7);
  composer.addPass(bloom);
  // "Punch": zoom blur, colour fringing, a travelling ripple and a spotlight
  // dim for the moments that matter. Skipped entirely when idle.
  const punch = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null }, uCenter: { value: new THREE.Vector2(0.5, 0.5) }, uAspect: { value: 1 },
      uZoom: { value: 0 }, uChroma: { value: 0 }, uDim: { value: 0 }, uWave: { value: 0 }, uWaveAmp: { value: 0 },
      uFlash: { value: new THREE.Vector3() },
    },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse; uniform vec2 uCenter; uniform float uAspect;
      uniform float uZoom, uChroma, uDim, uWave, uWaveAmp; uniform vec3 uFlash;
      varying vec2 vUv;
      void main() {
        vec2 dir = vUv - uCenter;
        float dist = length(dir * vec2(uAspect, 1.0));
        float band = dist - uWave;
        float ripple = exp(-band * band * 520.0) * uWaveAmp;
        vec2 uv = vUv - normalize(dir + 1e-5) * ripple * 0.03;
        vec2 d2 = uv - uCenter;
        vec3 col = vec3(0.0);
        for (int i = 0; i < 8; i++) {
          float t = float(i) / 7.0;
          vec2 o = d2 * (uZoom * 0.14 * t);
          vec2 f = d2 * (uChroma * 0.022) * (0.4 + t);
          col.r += texture2D(tDiffuse, uv - o - f).r;
          col.g += texture2D(tDiffuse, uv - o).g;
          col.b += texture2D(tDiffuse, uv - o + f).b;
        }
        col /= 8.0;
        col *= 1.0 - uDim * smoothstep(0.16, 0.85, dist);
        col += vec3(0.7, 1.0, 0.8) * ripple * 0.2;
        col += uFlash;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  punch.enabled = false;
  composer.addPass(punch);
  composer.addPass(new OutputPass());
  const fxState = {
    zoom: 0, chroma: 0, dim: 0, dimTarget: 0, wave: 2, waveAmp: 0, flash: 0, flashColor: new THREE.Vector3(1, 1, 1),
    bloom: BLOOM_BASE, bloomTarget: BLOOM_BASE, dark: 0, darkTarget: 0,
  };
  const ndc = new THREE.Vector3();
  const focus = (worldPos) => {
    ndc.copy(worldPos).project(camera);
    punch.uniforms.uCenter.value.set(ndc.x * 0.5 + 0.5, ndc.y * 0.5 + 0.5);
  };

  let baseFov = 30;
  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.fov = w / h < 1 ? baseFov + (1 - w / h) * 22 : baseFov;
    camera.updateProjectionMatrix();
    punch.uniforms.uAspect.value = w / h;
    room.resize(h * renderer.getPixelRatio(), camera.fov);
  }
  window.addEventListener('resize', resize);
  resize();

  const shakeOffset = new THREE.Vector3();
  let shakeAmp = 0;
  let fly = null;

  const stage = {
    renderer, scene, camera, controls, composer, bloom, key, bench,

    shake(amount) { shakeAmp = Math.max(shakeAmp, amount); },

    /** Glide the camera to a new position/target; resolves when it arrives. */
    flyTo(pos, tgt, dur = 0.9, easing = ease.inOutCubic) {
      if (fly) fly.resolve();
      return new Promise((resolve) => {
        fly = { t: 0, dur, easing, resolve, p0: camera.position.clone(), t0: controls.target.clone(), p1: pos.clone(), t1: tgt.clone() };
        controls.enabled = false;
      });
    },
    get flying() { return !!fly; },

    /** Limits of the orbit for whatever is being looked at. */
    setOrbit(minDist, maxDist) { controls.minDistance = minDist; controls.maxDistance = maxDist; },

    impact(worldPos, { zoom = 0.6, chroma = 0.8 } = {}) {
      focus(worldPos);
      fxState.zoom = Math.max(fxState.zoom, zoom);
      fxState.chroma = Math.max(fxState.chroma, chroma);
    },
    shockwave(worldPos, amp = 1) { focus(worldPos); fxState.wave = 0; fxState.waveAmp = amp; },
    spotlight(worldPos, amount) { if (worldPos) focus(worldPos); fxState.dimTarget = amount; },
    flash(amount = 0.5, color = [0.8, 1, 0.85]) {
      fxState.flash = Math.max(fxState.flash, amount);
      fxState.flashColor.set(color[0], color[1], color[2]);
    },
    glow(extra) { fxState.bloomTarget = BLOOM_BASE + extra; },
    /** Room lights down (1) for torch work, or back up (0). */
    darken(amount) { fxState.darkTarget = amount; },
    get darkness() { return fxState.dark; },
    /** How much of the room's light is left, 1 (lamp up) down to its darkened level. */
    get roomLight() { return 1 - fxState.dark * (1 - DIM.lights); },
    calm() {
      fxState.dimTarget = 0; fxState.bloomTarget = BLOOM_BASE; fxState.zoom = 0; fxState.chroma = 0; fxState.waveAmp = 0; fxState.flash = 0;
    },

    update(dt) {
      if (fly) {
        fly.t += dt;
        const k = fly.easing(Math.min(fly.t / fly.dur, 1));
        camera.position.lerpVectors(fly.p0, fly.p1, k);
        controls.target.lerpVectors(fly.t0, fly.t1, k);
        camera.lookAt(controls.target);
        if (fly.t >= fly.dur) { const r = fly.resolve; fly = null; controls.enabled = true; controls.update(); r(); }
      } else if (controls.enabled) {
        controls.update();
      }
      shakeAmp *= Math.exp(-dt * 9);
      if (shakeAmp < 0.0004) shakeAmp = 0;

      const s = fxState, u = punch.uniforms;
      s.zoom *= Math.exp(-dt * 7);
      s.chroma *= Math.exp(-dt * 5);
      s.flash *= Math.exp(-dt * 6);
      s.dim += (s.dimTarget - s.dim) * (1 - Math.exp(-dt * 6));
      s.wave += dt * 1.5;
      s.waveAmp *= Math.exp(-dt * 2.2);
      s.bloom += (s.bloomTarget - s.bloom) * (1 - Math.exp(-dt * 5));
      s.dark += (s.darkTarget - s.dark) * (1 - Math.exp(-dt * 5));
      bloom.strength = s.bloom + s.dark * 0.1; // a touch more in the dark, for the glow in the stone -- not a white-out
      // torch work happens with the lamp turned down, not out: the bench and the stone's shape stay readable
      const lit = 1 - s.dark * (1 - DIM.lights);
      for (const [light, power] of lights) light.intensity = power * lit;
      scene.environmentIntensity = ENV * (1 - s.dark * (1 - DIM.env));
      room.update(dt, 1 - s.dark * (1 - DIM.sky), lit);
      const active = s.zoom > 0.004 || s.chroma > 0.004 || s.dim > 0.004 || s.flash > 0.004 || (s.waveAmp > 0.01 && s.wave < 1.8);
      punch.enabled = active;
      if (active) {
        u.uZoom.value = s.zoom; u.uChroma.value = s.chroma; u.uDim.value = s.dim;
        u.uWave.value = s.wave; u.uWaveAmp.value = s.wave < 1.8 ? s.waveAmp : 0;
        u.uFlash.value.copy(s.flashColor).multiplyScalar(s.flash);
      }
    },

    render() {
      if (shakeAmp > 0) {
        shakeOffset.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(shakeAmp * 2);
        camera.position.add(shakeOffset);
      }
      composer.render();
      if (shakeAmp > 0) camera.position.sub(shakeOffset);
    },
  };
  return stage;
}
