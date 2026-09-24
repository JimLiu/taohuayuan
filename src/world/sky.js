// Sky dome and the far ridges. The ridges are layered like a handscroll: each farther layer
// lighter and bluer, their feet dissolving into the morning mist.
import * as THREE from 'three';
import { G, withG } from '../core/shared.js';
import { Rng } from '../core/rng.js';
import { fbm2, ridge2 } from '../core/noise.js';

export const SKY_GLSL = /* glsl */ `
float stars(vec3 rd){
  vec3 a = abs(rd); vec2 uv; float face;
  if (a.x > a.y && a.x > a.z) { uv = rd.zy / a.x; face = sign(rd.x); }
  else if (a.y > a.z) { uv = rd.xz / a.y; face = 2.0 * sign(rd.y); }
  else { uv = rd.xy / a.z; face = 3.0 * sign(rd.z); }
  vec2 g = uv * 120.0; vec2 id = floor(g); vec2 f = fract(g);
  float h = hash13(vec3(id, face));
  vec2 c = vec2(hash13(vec3(id, face + 3.1)), hash13(vec3(id, face + 5.7))) * 0.7 + 0.15;
  return pow(h, 22.0) * smoothstep(0.08, 0.0, length(f - c)) * (0.7 + 0.3 * sin(uTime * 2.0 + h * 50.0)) * 3.0;
}
vec3 skyColor(vec3 rd, float withSun){
  float s = max(dot(rd, uSunDir), 0.0);
  float h = rd.y;
  vec3 horizon = skyFogColor(normalize(vec3(rd.x, max(h, 0.0), rd.z)));
  float t = clamp(h, 0.0, 1.0);
  vec3 col = mix(horizon, uSkyUp, smoothstep(0.0, 0.25, t));
  col = mix(col, uSkyZen, smoothstep(0.2, 0.8, t));
  float band = exp(-max(h, 0.0) * 6.0);
  col += uSunCol * (pow(s, 6.0) * 0.05 * (0.4 + band) + pow(s, 40.0) * 0.1) * uSunVis;
  col += uHorizonGlow * band * 0.06 * (0.3 + 0.7 * pow(s, 1.5));
  if (uNight > 0.01 && h > 0.0) col += vec3(0.8, 0.85, 1.0) * stars(rd) * uNight * smoothstep(0.0, 0.3, h);
  // thin high cloud, drifting: silvered toward the sun
  if (h > 0.0) {
    vec2 uv = rd.xz / (h + 0.08) * 0.8 + vec2(uTime * 0.003, uTime * 0.001);
    float n = fbm3(uv * 1.1) * 0.6 + fbm3(uv * 3.2 + 4.0) * 0.3 + vnoise(uv * 9.0) * 0.1;
    // combed out into long streaks (mares' tails), with open blue between them
    float streak = fbm3(vec2(uv.x * 0.32, uv.y * 3.4) + 9.0);
    float d = smoothstep(0.56, 0.86, n * 0.6 + streak * 0.48);
    d *= smoothstep(0.0, 0.1, h) * (1.0 - smoothstep(0.35, 0.9, h) * 0.7);
    vec3 lit = mix(uCloudLit, uCloudLit * vec3(1.18, 1.1, 1.0), pow(s, 6.0));
    vec3 cc = mix(lit, uCloudShade, smoothstep(0.55, 0.95, n) * 0.6);
    col = mix(col, cc * mix(0.7, 1.0, band), d * 0.75);
  }
  col += withSun * uSunVis * uSunCol * 5.0 * smoothstep(0.99955, 0.99975, s);
  return col;
}
`;

export function buildSky() {
  const mat = new THREE.ShaderMaterial({
    uniforms: withG(),
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
    fragmentShader: /* glsl */ `
      #include <common>
      ${SKY_GLSL}
      varying vec3 vDir;
      void main(){
        vec3 rd = normalize(vDir);
        if (uReflect > 0.5) rd.y = abs(rd.y);
        gl_FragColor = vec4(skyColor(rd, 1.0), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthWrite: false,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(5000, 48, 24), mat);
  m.frustumCulled = false;
  m.renderOrder = -10;
  m.name = 'sky';
  m.onBeforeRender = (r, s, cam) => { m.position.copy(cam.position); m.updateMatrixWorld(); };
  return m;
}

// far ridges: full rings around the basin so every view out has depth
export function buildRidges() {
  const group = new THREE.Group();
  group.name = 'ridges';
  const layers = [
    { r: 1250, h: 230, base: -10, haze: 0.34, seed: 1, depth: 320, tint: [0.27, 0.34, 0.33] },
    { r: 1800, h: 360, base: -30, haze: 0.52, seed: 2, depth: 420, tint: [0.3, 0.37, 0.42] },
    { r: 2600, h: 520, base: -50, haze: 0.68, seed: 3, depth: 520, tint: [0.36, 0.42, 0.5] },
    { r: 3500, h: 700, base: -80, haze: 0.8, seed: 4, depth: 520, tint: [0.42, 0.48, 0.56] },
  ];
  const centre = new THREE.Vector3(10, 0, -120);
  for (const L of layers) {
    const pos = [], idx = [];
    const seg = 420, rows = 10;
    const off = new Rng(L.seed * 77).range(0, 100);
    for (let v = 0; v <= rows; v++) {
      const g = (v / rows) * L.depth;
      for (let m = 0; m <= seg; m++) {
        const a = (m / seg) * Math.PI * 2;
        const R = L.r + g;
        const x = centre.x + Math.sin(a) * R, z = centre.z - Math.cos(a) * R;
        const E = g / L.depth;
        const T = ridge2(a * 3.2 + off, E * 1.1 + off, 5);
        const I = fbm2(a * 1.4 + off, 3.3, 3) * 0.5 + 0.5;
        // the southern gap where the creek world opens is lower, so the outside feels wide
        const southGap = 1 - 0.45 * Math.exp(-Math.pow((((a + Math.PI) % (Math.PI * 2)) - Math.PI) / 0.5, 2));
        let y = L.base + L.h * (0.22 + 0.95 * T * (0.5 + 0.5 * I)) * (a > Math.PI * 0.6 && a < Math.PI * 1.4 ? southGap : 1);
        y *= Math.sin(Math.min(1, E * 2.2 + 0.05) * Math.PI * 0.5);
        pos.push(x, y, z);
      }
    }
    for (let v = 0; v < rows; v++)
      for (let m = 0; m < seg; m++) {
        const a = v * (seg + 1) + m, b = a + 1, c = a + seg + 1, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mat = new THREE.ShaderMaterial({
      uniforms: withG({ uHaze: { value: L.haze }, uBase: { value: L.base }, uH: { value: L.h }, uTint: { value: new THREE.Vector3(...L.tint) } }),
      vertexShader: /* glsl */ `
        varying vec3 vW; varying vec3 vN;
        void main(){ vW = (modelMatrix * vec4(position,1.0)).xyz; vN = normal; gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0); }`,
      fragmentShader: /* glsl */ `
        #include <common>
        uniform float uHaze, uBase, uH; uniform vec3 uTint;
        varying vec3 vW; varying vec3 vN;
        void main(){
          vec3 N = normalize(vN);
          vec3 rd = normalize(vW - cameraPosition);
          if (uReflect > 0.5) rd.y = -rd.y;
          float ndl = max(dot(N, uSunDir), 0.0);
          float rel = clamp((vW.y - uBase) / uH, 0.0, 1.0);
          // ink-wash: darker crests, texture strokes down the slopes
          float stroke = fbm3(vec2(vW.x + vW.z, vW.y * 3.0) * 0.012);
          vec3 base = uTint * (0.55 + 0.25 * smoothstep(0.2, 0.9, rel) + 0.2 * stroke);
          vec3 col = base * (0.55 + 0.45 * N.y) * uAmbK * 0.7 + base * uSunCol * ndl * 0.18;
          vec3 fogc = skyFogColor(normalize(vec3(rd.x, max(rd.y, 0.0), rd.z)));
          float haze = uHaze + (1.0 - uHaze) * (1.0 - smoothstep(0.0, 0.55, rel)) * 0.75;
          haze = clamp(haze, 0.0, 0.985);
          gl_FragColor = vec4(mix(col, fogc, haze), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = -5;
    group.add(mesh);
  }
  return group;
}
