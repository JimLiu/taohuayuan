// Water: the creek and its spring pool outside, the pond and canals in the basin.
// One shader: flowing ripples, depth tint, fresnel mix toward a planar reflection of the banks
// (half resolution, rendered only for the water level the camera is near), a narrow sun glint.
import * as THREE from 'three';
import { withG } from '../core/shared.js';
import { SKY_GLSL } from './sky.js';
import {
  creekX, creekHW, creekDir, SRC, SRC_Z, WATER_OUT, POND, POND_Y, CANALS, height,
} from './layout.js';
import { clamp } from '../core/rng.js';

export const LAYER_NO_REFLECT = 1; // grass, petals in the air near the lens, etc.

const VERT = /* glsl */ `
  attribute float aDepth;
  uniform mat4 uTexMat;
  varying vec3 vWP;
  varying float vDepth;
  varying vec4 vRC;
  void main(){
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWP = wp.xyz;
    vDepth = aDepth;
    vRC = uTexMat * wp;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;

const FRAG = /* glsl */ `
  #include <common>
  ${SKY_GLSL}
  uniform sampler2D uRefl;
  uniform float uHasRefl, uFlow, uStill, uClear;
  uniform vec3 uDeep, uShallow;
  varying vec3 vWP;
  varying float vDepth;
  varying vec4 vRC;

  float rip(vec2 p, vec2 fl){
    float t = uTime;
    float a = vnoise(p * 0.55 - fl * t * 0.55) * 0.55;
    a += vnoise(p * 1.3 + vec2(3.1, 1.7) - fl * t * 0.9 + vec2(t * 0.05, 0.0)) * 0.3;
    a += vnoise(p * 3.4 + vec2(-t * 0.21, t * 0.17) - fl * t * 1.4) * 0.15;
    return a;
  }
  void main(){
    vec3 wp = vWP;
    // flow: downstream along the creek, near still in the pool and pond
    vec2 c = creekAt(wp.z);
    vec2 fl = vec2(0.0);
    if (uFlow > 0.5) {
      float dx = creekAt(wp.z + 2.0).x - creekAt(wp.z - 2.0).x;
      float across = clamp(abs(wp.x - c.x) / max(c.y, 1.0), 0.0, 1.0);
      fl = normalize(vec2(dx * 0.25, 1.0)) * mix(0.9, 0.25, across * across) * smoothstep(${SRC_Z + 3}.0, ${SRC_Z + 16}.0, wp.z);
    }
    float e = 0.07;
    vec2 p = wp.xz;
    float h0 = rip(p, fl), hx = rip(p + vec2(e, 0.0), fl), hz = rip(p + vec2(0.0, e), fl);
    float amp = mix(mix(0.28, 0.13, uClear), 0.11, uStill);
    vec3 V = normalize(cameraPosition - wp);
    float dist = length(cameraPosition - wp);
    amp *= 1.0 - smoothstep(60.0, 400.0, dist) * 0.7;
    vec3 n = normalize(vec3(-(hx - h0) / e * amp, 1.0, -(hz - h0) / e * amp));
    float ndv = max(dot(n, V), 0.0);
    float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
    vec3 R = reflect(-V, n);
    vec3 refl = skyColor(normalize(vec3(R.x, abs(R.y), R.z)), 0.0);
    if (uHasRefl > 0.5) {
      vec2 uv = vRC.xy / vRC.w + n.xz * 0.045 * (1.0 - smoothstep(30.0, 250.0, dist) * 0.6);
      refl = texture2D(uRefl, uv).rgb;
    }
    float d = clamp(vDepth, 0.0, 3.0);
    float sunL = max(uSunDir.y, 0.0) * 0.9 + 0.25;
    float sg = pow(max(dot(R, uSunDir), 0.0), 520.0) * 3.5 + pow(max(dot(R, uSunDir), 0.0), 60.0) * 0.08;
    vec3 col; float a;
    if (uClear > 0.5) {
      // clear: the stones on the bed show through (the terrain darkens and tints them for the water they are
      // seen through); here only the light scattered back by the water body, the reflection, and the glint
      float path = d / max(V.y, 0.12);
      float scat = (1.0 - exp(-0.13 * path)) * 0.72;
      vec3 body = mix(uShallow, uDeep, smoothstep(0.1, 1.4, d)) * (uAmbK * 0.6 + uSunCol * 0.1 * sunL) * (1.0 - 0.6 * uNight);
      float fr = clamp(fres, 0.0, 1.0);
      a = fr + (1.0 - fr) * scat;
      col = (fr * refl * 0.9 + (1.0 - fr) * scat * body) / max(a, 1e-3);
      col += uSunCol * sg * uSunVis / max(a, 0.2);
      a = min(1.0, a + sg * 0.5);
      a *= smoothstep(0.0, 0.12, vDepth);
    } else {
      // body: see into the shallows, dark in the pools
      vec3 body = mix(uShallow, uDeep, smoothstep(0.05, 1.6, d));
      body *= (uAmbK * 0.55 + uSunCol * 0.1 * sunL) * (1.0 - 0.6 * uNight);
      col = mix(body, refl, clamp(fres * 1.05 + 0.08, 0.0, 1.0));
      col += uSunCol * sg * uSunVis;
      a = smoothstep(0.0, 0.22, vDepth);
    }
    col = applyAtmosphere(col, wp);
    gl_FragColor = vec4(col, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

function makeMaterial(level, flow, still, deep, shallow, clear = 0) {
  return new THREE.ShaderMaterial({
    uniforms: withG({
      uRefl: { value: null }, uHasRefl: { value: 0 }, uTexMat: { value: new THREE.Matrix4() },
      uFlow: { value: flow }, uStill: { value: still }, uClear: { value: clear },
      uDeep: { value: new THREE.Vector3(...deep) }, uShallow: { value: new THREE.Vector3(...shallow) },
    }),
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: true,
    userData: { level },
  });
}

function ribbon(centre, halfWidth, zs, level, across = 10) {
  const pos = [], dep = [], idx = [];
  for (let r = 0; r < zs.length; r++) {
    const z = zs[r];
    const cx = centre(z), hw = halfWidth(z);
    for (let a = 0; a <= across; a++) {
      const x = cx + (a / across * 2 - 1) * hw;
      pos.push(x, level, z);
      dep.push(level - height(x, z));
    }
  }
  const W = across + 1;
  for (let r = 0; r < zs.length - 1; r++)
    for (let a = 0; a < across; a++) {
      const i = r * W + a;
      idx.push(i, i + W, i + 1, i + 1, i + W, i + W + 1);
    }
  return geo(pos, dep, idx);
}

function geo(pos, dep, idx) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aDepth', new THREE.Float32BufferAttribute(dep, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

function ellipse(cx, cz, rx, rz, rot, level, rings = 8, seg = 64) {
  const pos = [cx, level, cz], dep = [level - height(cx, cz)], idx = [];
  const c = Math.cos(rot), s = Math.sin(rot);
  for (let r = 1; r <= rings; r++) {
    const f = r / rings;
    for (let m = 0; m < seg; m++) {
      const a = (m / seg) * Math.PI * 2;
      const u = Math.cos(a) * rx * f, v = Math.sin(a) * rz * f;
      const x = cx + u * c + v * s, z = cz - u * s + v * c;
      pos.push(x, level, z);
      dep.push(level - height(x, z));
    }
  }
  for (let m = 0; m < seg; m++) idx.push(0, 1 + ((m + 1) % seg), 1 + m);
  for (let r = 1; r < rings; r++)
    for (let m = 0; m < seg; m++) {
      const a = 1 + (r - 1) * seg + m, b = 1 + (r - 1) * seg + ((m + 1) % seg);
      const c2 = a + seg, d = b + seg;
      idx.push(a, b, c2, b, d, c2);
    }
  return geo(pos, dep, idx);
}

function polyRibbon(poly, hw, level, step = 1.2) {
  // resample the polyline, then extrude sideways
  const pts = [];
  for (let i = 0; i < poly.length - 1; i++) {
    const [ax, az] = poly[i], [bx, bz] = poly[i + 1];
    const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(L / step));
    for (let k = 0; k < n; k++) pts.push([ax + (bx - ax) * k / n, az + (bz - az) * k / n]);
  }
  pts.push(poly[poly.length - 1]);
  const pos = [], dep = [], idx = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let tx = b[0] - a[0], tz = b[1] - a[1];
    const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    for (const sd of [-1, -0.5, 0, 0.5, 1]) {
      const x = pts[i][0] - tz * hw * sd, z = pts[i][1] + tx * hw * sd;
      pos.push(x, level, z);
      dep.push(level - height(x, z));
    }
  }
  for (let i = 0; i < pts.length - 1; i++)
    for (let k = 0; k < 4; k++) {
      const a = i * 5 + k;
      idx.push(a, a + 1, a + 5, a + 1, a + 6, a + 5);
    }
  return geo(pos, dep, idx);
}

export function buildWater() {
  const group = new THREE.Group();
  group.name = 'water';
  const creekMat = makeMaterial(WATER_OUT, 1, 0, [0.018, 0.075, 0.068], [0.05, 0.13, 0.115], 1);
  const stillMat = makeMaterial(POND_Y, 0, 1, [0.035, 0.08, 0.075], [0.22, 0.25, 0.17]);

  const zs = [];
  for (let z = SRC_Z + 1; z < 1300; z += z < 400 ? 1.5 : 3) zs.push(z);
  const creek = new THREE.Mesh(ribbon(creekX, (z) => creekHW(z) + 3.2, zs, WATER_OUT, 12), creekMat);
  creek.name = 'creek';
  const pool = new THREE.Mesh(ellipse(SRC.x, SRC.z, SRC.r + 3, SRC.r + 3, 0, WATER_OUT, 8, 56), creekMat);
  pool.name = 'pool';
  const pond = new THREE.Mesh(ellipse(POND.x, POND.z, POND.rx + 6, POND.rz + 6, POND.rot, POND_Y, 10, 72), stillMat);
  pond.name = 'pond';
  group.add(creek, pool, pond);
  for (const c of CANALS) {
    const m = new THREE.Mesh(polyRibbon(c, 3.0, POND_Y), stillMat);
    m.name = 'canal';
    group.add(m);
  }
  for (const m of group.children) { m.renderOrder = 2; m.receiveShadow = false; }
  // everything that samples the planar reflection (the paddies add theirs)
  group.userData = { creekMat, stillMat, reflTargets: [creekMat.uniforms, stillMat.uniforms] };
  return group;
}

// ---------------------------------------------------------------- planar reflection
export class WaterReflection {
  constructor(renderer, water) {
    this.renderer = renderer;
    this.water = water;
    this.rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 0 });
    this.rt.texture.generateMipmaps = false;
    this.cam = new THREE.PerspectiveCamera();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.tex = new THREE.Matrix4();
    this.scale = 0.5;
    this.enabled = true;
    this._v = new THREE.Vector3();
    this._t = new THREE.Vector3();
    this._size = new THREE.Vector2();
  }
  levelFor(camera) {
    // the camera looks at the creek outside, or the pond and paddies inside
    return camera.position.z > 30 ? WATER_OUT : POND_Y;
  }
  update(scene, camera, G) {
    const mats = this.water.userData.reflTargets;
    if (!this.enabled) { for (const m of mats) m.uHasRefl.value = 0; return; }
    const r = this.renderer;
    r.getDrawingBufferSize(this._size);
    const w = Math.max(4, Math.floor(this._size.x * this.scale)), h = Math.max(4, Math.floor(this._size.y * this.scale));
    if (this.rt.width !== w || this.rt.height !== h) this.rt.setSize(w, h);
    const level = this.levelFor(camera);
    const cam = this.cam;
    cam.copy(camera);
    // reflect position, forward and up across y = level
    const p = camera.position;
    cam.position.set(p.x, 2 * level - p.y, p.z);
    camera.getWorldDirection(this._v);
    this._t.copy(p).add(this._v);
    this._t.y = 2 * level - this._t.y;
    cam.up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    cam.up.y = -cam.up.y;
    cam.lookAt(this._t);
    cam.updateMatrixWorld();
    cam.projectionMatrix.copy(camera.projectionMatrix);
    cam.layers.set(0);
    // texture matrix: world -> reflection uv
    this.tex.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.tex.multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);
    for (const m of mats) { m.uTexMat.value.copy(this.tex); m.uRefl.value = this.rt.texture; }

    this.water.visible = false;
    this.plane.set(new THREE.Vector3(0, 1, 0), -level + 0.05);
    const prevClip = r.clippingPlanes, prevRT = r.getRenderTarget();
    r.clippingPlanes = [this.plane];
    G.uReflect.value = 1;
    for (const m of mats) m.uHasRefl.value = 0;
    r.setRenderTarget(this.rt);
    r.clear();
    r.render(scene, cam);
    r.setRenderTarget(prevRT);
    r.clippingPlanes = prevClip;
    G.uReflect.value = 0;
    this.water.visible = true;
    for (const m of mats) m.uHasRefl.value = 1;
  }
}
