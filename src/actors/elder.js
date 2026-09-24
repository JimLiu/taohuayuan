// 黄发: an old man sweeping the lane by the big tree. The sculpt is the reference scene's monk (assets-src/web/ref/monk.msh),
// bent over a besom; its texture did not come with it either, so it is painted here by region from its shape:
// grey hair left round the back of the head and tied in a small knot (added here: a bald pate reads as a monk),
// a hemp robe with a dark sash, grey trousers bound into leg wraps, straw sandals, and a besom of grey straw.
// It is a static mesh; the reference's vertex shader moves it (breath, a slow sway, and the sweep itself).
import * as THREE from 'three';
import { loadMSH } from '../core/msh.js';
import { hook } from '../core/shared.js';
import { SKIN, HAIR } from './crowd.js';

const PAINT = {
  robe: [0.49, 0.46, 0.4], sash: [0.28, 0.24, 0.2], trousers: [0.36, 0.34, 0.31], wraps: [0.62, 0.6, 0.54],
  sandal: [0.5, 0.45, 0.35], skin: SKIN[3], hair: HAIR.grey, broom: [0.5, 0.46, 0.36], wood: [0.36, 0.3, 0.22],
};

// the besom's handle, as a line from the head of the broom (t = 0) to where it passes the upper hand (t ~ 0.8)
const A = new THREE.Vector3(0.172, -0.428, 0.261), E = new THREE.Vector3(-0.351, 0.34, -0.103);
const LEN = A.distanceTo(E), DIR = E.clone().sub(A).normalize();
const HEAD = new THREE.Vector3(-0.097, 0.82, -0.15);
const _v = new THREE.Vector3();

function region(x, y, z) {
  _v.set(x - A.x, y - A.y, z - A.z);
  const t = _v.dot(DIR) / LEN, d = _v.addScaledVector(DIR, -t * LEN).length();
  const inHand = (t > 0.38 && t < 0.58) || (t > 0.68 && t < 0.87);
  if ((y < -0.5 && x > 0.1 && z > 0.05) || (t < 0.1 && t > -0.5 && d < 0.1)) return 'broom';
  if (!inHand && t > 0.1 && t < 0.9 && d < 0.045) return 'wood';
  if (inHand) return d < 0.019 ? 'wood' : d < 0.08 ? 'skin' : 'robe';
  const hx = x - HEAD.x, hy = y - HEAD.y, hz = z - HEAD.z, hr = Math.hypot(hx, hy, hz);
  if (hr < 0.17) return hz / hr < -0.25 && hy / hr < 0.75 && y > 0.7 ? 'hair' : 'skin';
  if (y > 0.58 && y < 0.72 && Math.hypot(hx, z + 0.12) < 0.07) return 'skin';
  if (y < -0.88) return 'sandal';
  if (y < -0.62) return 'wraps';
  if (y < -0.2) return 'trousers';
  if (Math.abs(y - 0.27) < 0.04 && (z < -0.12 ? x > -0.47 && x < 0.12 : Math.abs(x + 0.17) < 0.19)) return 'sash';
  return 'robe';
}

// the topknot: a small squashed ball of hair on the back of the crown
function knot() {
  const g = new THREE.SphereGeometry(0.042, 12, 8);
  g.scale(1, 0.8, 1);
  g.rotateX(-0.6);
  g.translate(HEAD.x, 0.905, -0.279);
  return g;
}

function build(src) {
  const parts = [src, knot()];
  let nv = 0, ni = 0;
  for (const g of parts) { nv += g.attributes.position.count; ni += g.index.count; }
  const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), C = new Float32Array(nv * 3), S = new Float32Array(nv), I = new Uint32Array(ni);
  let ov = 0, oi = 0;
  for (const [k, g] of parts.entries()) {
    const p = g.attributes.position, n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const r = k ? 'hair' : region(x, y, z);
      P.set([x, y, z], (ov + i) * 3);
      N.set([n.getX(i), n.getY(i), n.getZ(i)], (ov + i) * 3);
      C.set(PAINT[r], (ov + i) * 3);
      S[ov + i] = r === 'broom' || r === 'sandal' ? 1 : r === 'hair' ? 0.5 : 0;
    }
    const ix = g.index.array;
    for (let i = 0; i < ix.length; i++) I[oi + i] = ix[i] + ov;
    ov += p.count; oi += ix.length;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(P, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  out.setAttribute('color', new THREE.BufferAttribute(C, 3));
  out.setAttribute('aStraw', new THREE.BufferAttribute(S, 1));
  out.setIndex(new THREE.BufferAttribute(I, 1));
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

let GEO = null;
export async function loadElder() {
  if (!GEO) GEO = build((await loadMSH(new URL('../assets/ref/monk.mshz', import.meta.url).href))[0]);
  return GEO;
}

// sway: how far the figure rocks on its ankles; sweep: the stroke's turn of the shoulders (radians)
export function makeElder({ height = 1.6, sway = 0.003, sweep = 0.12 } = {}) {
  const g = GEO;
  if (!g) throw new Error('loadElder() first');
  const bb = g.boundingBox, H = bb.max.y - bb.min.y;
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  mat.userData.uniforms = { uSway: { value: sway }, uSweep: { value: sweep }, uYMin: { value: bb.min.y }, uYMax: { value: bb.max.y } };
  hook(mat, 'elder', (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
uniform float uSway, uSweep, uYMin, uYMax;
attribute float aStraw;
varying float vStraw; varying vec3 vObj;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      {
        vObj = position; vStraw = aStraw;
        float H = uYMax - uYMin;
        float hN = (position.y - uYMin) / H;                 // 0 at the feet, 1 at the crown
        float ph = uTime * 0.9 + modelMatrix[3].x * 0.37;
        // breath: the chest widens a touch, the shoulders lift
        float chest = exp(-pow((hN - 0.68) / 0.1, 2.0));
        transformed.xz *= 1.0 + chest * 0.012 * sin(uTime * 1.25);
        transformed.y += smoothstep(0.55, 0.8, hN) * 0.004 * sin(uTime * 1.25);
        // a slow shift of weight from the ankles, a gust adding a little
        float a = (sin(ph * 0.55) * 0.6 + sin(ph * 0.23 + 1.3) * 0.4) * uSway * hN;
        a += windGust(modelMatrix[3].xyz) * 0.006 * hN * hN;
        transformed.x += a * H;
        // the sweep: the shoulders turn about the spine and the besom's head swings wider, on a slow stroke
        float st = sin(uTime * 2.6);
        float turn = st * uSweep * smoothstep(0.25, 0.75, hN);
        vec2 c0 = vec2(-0.16, -0.18);
        transformed.xz = c0 + mat2(cos(turn), -sin(turn), sin(turn), cos(turn)) * (transformed.xz - c0);
        float broom = (1.0 - smoothstep(0.05, 0.4, hN)) * smoothstep(0.14, 0.3, position.x);
        transformed.z += st * uSweep * 1.4 * broom * H;
      }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vStraw; varying vec3 vObj;')
      .replace('#include <color_fragment>', `#include <color_fragment>
      {
        vec3 b = vObj;
        // straw of the besom and the sandals, streaked along the stalks; hair combed back in fine strands
        float streak = vnoise(vec2(b.x * 90.0 + b.z * 70.0, b.y * 6.0));
        float strawK = (0.78 + 0.34 * streak) * (0.9 + 0.2 * vnoise(b.xz * 40.0));
        float hairK = 0.85 + 0.25 * vnoise(vec2(atan(b.x + 0.097, b.z + 0.15) * 30.0, b.y * 8.0));
        float cloth = 0.93 + 0.1 * vnoise(b.xy * 90.0) + 0.05 * vnoise(b.zy * 23.0);
        diffuseColor.rgb *= vStraw > 0.75 ? strawK : vStraw > 0.25 ? hairK : cloth;
      }`);
  });
  const mesh = new THREE.Mesh(g, mat);
  const s = height / H;
  mesh.scale.setScalar(s);
  mesh.position.y = -bb.min.y * s;
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.name = 'elder-mesh';
  const root = new THREE.Group();
  root.name = 'elder';
  root.add(mesh);
  return root;
}
