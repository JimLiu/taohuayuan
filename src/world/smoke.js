// 炊烟: kitchen smoke from the village chimneys. Each chimney sends up a thin column of soft puffs that
// rise, slow, widen, lean away on the breeze and thin out into the morning air. One instanced draw for all
// of them: every puff is a camera-facing quad whose whole life is worked out in the vertex shader.
import * as THREE from 'three';
import { withG } from '../core/shared.js';
import { Rng } from '../core/rng.js';

const PUFFS = 16; // per chimney

export function buildSmoke(chimneys) {
  const rng = new Rng(7310);
  const base = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute('position', base.attributes.position);
  geo.setAttribute('uv', base.attributes.uv);
  const src = [], seed = [];
  // not every hearth is lit at once; the lit ones burn at their own strength
  const lit = chimneys.filter((_, i) => i % 4 !== 3);
  for (const c of lit) {
    const strength = rng.range(0.7, 1.1), rate = rng.range(0.045, 0.06);
    for (let k = 0; k < PUFFS; k++) {
      src.push(c[0], c[1], c[2], strength);
      seed.push(k / PUFFS + rng.range(-0.02, 0.02), rate, rng.next(), rng.next());
    }
  }
  geo.setAttribute('aSrc', new THREE.InstancedBufferAttribute(new Float32Array(src), 4));
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(new Float32Array(seed), 4));
  geo.instanceCount = src.length / 4;

  const mat = new THREE.ShaderMaterial({
    uniforms: withG(),
    vertexShader: /* glsl */ `
      #include <common>
      attribute vec4 aSrc;   // chimney top xyz, strength
      attribute vec4 aSeed;  // phase, rate, two randoms
      varying vec2 vUv; varying float vA; varying vec3 vWP; varying float vR;
      void main(){
        float age = fract(uTime * aSeed.y + aSeed.x);
        // rising quickly at first, then slowing as it cools; leaning downwind more and more
        float rise = 9.0 * (1.0 - pow(1.0 - age, 1.8));
        vec2 wind = uWind.xy * (0.4 + 0.6 * uWind.z);
        float lean = 5.0 * pow(age, 1.5);
        vec3 c = aSrc.xyz + vec3(wind.x * lean, rise, wind.y * lean);
        // and wandering: a slow sideways weave that grows with height
        float t = uTime * 0.23 + aSeed.z * 6.28;
        c.x += (sin(t + age * 5.0) * 0.5 + sin(t * 1.7 + age * 9.0 + 1.3) * 0.25) * age * 1.2;
        c.z += (cos(t * 0.8 + age * 4.0) * 0.5) * age * 1.2;
        float size = mix(0.55, 4.2, pow(age, 0.8)) * (0.85 + 0.3 * aSeed.w);
        vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        float rot = aSeed.w * 6.28 + age * 1.5;
        vec2 q = mat2(cos(rot), -sin(rot), sin(rot), cos(rot)) * position.xy;
        vec3 wp = c + (right * q.x + up * q.y) * size;
        vUv = position.xy * 2.0; vR = aSeed.z;
        vA = smoothstep(0.0, 0.06, age) * pow(1.0 - age, 1.6) * aSrc.w;
        vWP = wp;
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      #include <common>
      varying vec2 vUv; varying float vA; varying vec3 vWP; varying float vR;
      void main(){
        float r = length(vUv);
        float n = fbm3(vUv * 1.6 + vR * 17.0 + vec2(0.0, uTime * 0.05));
        float a = smoothstep(1.0, 0.15, r + (n - 0.5) * 0.7) * vA * 0.7;
        a *= 1.0 - 0.6 * uNight;
        if (a < 0.004) discard;
        // wood smoke: a pale blue-grey, lit a little warmer on the sun side
        vec3 base = vec3(0.74, 0.75, 0.78);
        vec3 col = base * (uAmbK * 0.55 + uSunCol * uSunVis * 0.09 * (0.7 + 0.3 * n));
        col = applyAtmosphere(col, vWP);
        gl_FragColor = vec4(col, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'smoke';
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  return mesh;
}
