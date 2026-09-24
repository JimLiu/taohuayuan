// 处处志之: on his way out the fisherman marks the way. At each turn of the bank a few stones piled up
// and a stake driven in, a knot of grass tied round its head and a strip torn from his undyed coat.
// They stand only in that chapter: when the prefect's men come looking for them (遂迷) they are gone.
import * as THREE from 'three';
import { Rng, lerp } from '../core/rng.js';
import { hook } from '../core/shared.js';
import { creekX, creekHW, creekDir } from './layout.js';
import { surfaceHeight, mergeSimple } from './terrain.js';

// along the peach wood, downstream from the cave's creek; side +1 is the east bank
export const MARKS = [
  { z: 63, side: 1 }, { z: 80, side: -1 }, { z: 97, side: 1 }, { z: 112, side: 1 }, { z: 125, side: -1 },
];

const tint = (g, c) => {
  const n = g.attributes.position.count, C = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) C.set(c, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(C, 3));
  return g;
};
const prep = (g) => {
  g = g.index ? g.toNonIndexed() : g;
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  return g;
};

function stone(rng, r, h) {
  const g = prep(new THREE.DodecahedronGeometry(1, 0));
  const P = g.attributes.position;
  for (let i = 0; i < P.count; i++) P.setXYZ(i, P.getX(i) * r * rng.range(0.9, 1.1), P.getY(i) * h, P.getZ(i) * r * rng.range(0.85, 1.05));
  g.computeVertexNormals();
  const k = rng.range(0.85, 1.1);
  return tint(g, [0.5 * k, 0.49 * k, 0.45 * k]);
}

// the pile: flat stones, each smaller, not quite centred on the last
function cairn(rng) {
  const parts = [];
  let y = 0, x = 0, z = 0;
  const n = rng.int(4, 5);
  for (let i = 0; i < n; i++) {
    const r = lerp(0.42, 0.16, i / (n - 1)) * rng.range(0.9, 1.1), h = r * rng.range(0.4, 0.55);
    const s = stone(rng, r, h);
    s.rotateY(rng.range(0, 6.28));
    s.translate(x, y + h * 0.8, z);
    parts.push(s);
    y += h * 1.55;
    x += rng.range(-0.04, 0.04); z += rng.range(-0.04, 0.04);
  }
  return parts;
}

// the stake, the grass knot round its head, and the strip of cloth hanging from it (aFree: how free the cloth hangs)
function stake(rng) {
  const H = rng.range(1.5, 1.7);
  const post = prep(new THREE.CylinderGeometry(0.04, 0.05, H, 6, 1));
  post.translate(0, H / 2 - 0.12, 0);
  tint(post, [0.42, 0.34, 0.26]);
  const knot = prep(new THREE.TorusGeometry(0.065, 0.03, 5, 8));
  knot.rotateX(Math.PI / 2);
  knot.translate(0, H - 0.26, 0);
  tint(knot, [0.5, 0.52, 0.3]);
  const parts = [post, knot];
  // the grass ends left sticking out of the knot
  for (let i = 0; i < 5; i++) {
    const b = prep(new THREE.ConeGeometry(0.016, rng.range(0.25, 0.4), 3, 1));
    const a = rng.range(0, 6.28);
    b.translate(0, 0.1, 0);
    b.rotateZ(rng.range(0.9, 1.4));
    b.rotateY(a);
    b.translate(0, H - 0.26, 0);
    parts.push(tint(b, [0.46, 0.5, 0.28]));
  }
  const cloth = prep(new THREE.PlaneGeometry(0.1, 0.62, 1, 8));
  cloth.translate(0.06, H - 0.3 - 0.31, 0);
  tint(cloth, [0.9, 0.87, 0.78]);
  parts.push(cloth);
  const W = new Float32Array(cloth.attributes.position.count);
  for (let i = 0; i < W.length; i++) W[i] = (H - 0.3 - cloth.attributes.position.getY(i)) / 0.62;
  cloth.setAttribute('aFree', new THREE.BufferAttribute(W, 1));
  return parts;
}

export function buildMarkers(peachTrees = []) {
  const group = new THREE.Group();
  group.name = 'markers';
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
  hook(m, 'markers', (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aFree;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      if (aFree > 0.0) {
        // the strip streams out on the same wind as the petals, flicking at its end
        vec3 wp0 = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vec3 sw = windSway(wp0, 1.0, wp0.x);
        float f = aFree * aFree;
        vec3 o = vec3(sw.x, 0.0, sw.z) * 0.35 * f + vec3(0.0, length(sw.xz) * 0.12 * f, 0.0);
        o += vec3(-sw.z, 0.0, sw.x) * sin(uTime * 6.0 + aFree * 4.0 + wp0.x) * 0.1 * f;
        transformed += transpose(mat3(modelMatrix)) * o;
      }`);
  });
  const rng = new Rng(2222);
  for (const M of MARKS) {
    // on the bank, clear of the peach trunks
    let x = 0, z = M.z;
    for (let k = 0; k < 20; k++) {
      z = M.z + rng.range(-2, 2);
      x = creekX(z) + M.side * (creekHW(z) + rng.range(0.6, 1.1));
      if (peachTrees.every((t) => Math.hypot(t.x - x, t.z - z) > 1.3)) break;
    }
    const d = creekDir(z);
    const parts = [...cairn(rng)];
    // the stake beside the pile, on its downstream side
    const tilt = rng.range(-0.08, 0.08), ox = d.x * 0.5 + rng.range(-0.1, 0.1), oz = d.z * 0.5;
    for (const p of stake(rng)) {
      p.rotateZ(tilt);
      p.translate(ox, 0, oz);
      parts.push(p);
    }
    for (const p of parts) if (!p.attributes.aFree) p.setAttribute('aFree', new THREE.BufferAttribute(new Float32Array(p.attributes.position.count), 1));
    const g = mergeSimple(parts);
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(x, surfaceHeight(x, z) - 0.04, z);
    mesh.rotation.y = rng.range(0, 6.28);
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.name = `mark-${M.z}`;
    mesh.userData.z = M.z;
    group.add(mesh);
  }
  group.visible = false;
  // each mark is made as the boat comes by it, and stays behind it
  group.userData.update = (story, name) => {
    group.visible = name === '志之';
    // (driven in and piled up as he passes: each rises out of the bank over the next few metres)
    if (group.visible) for (const m of group.children) {
      const k = Math.min(1, (story.boat.z - (m.userData.z - 2)) / 4);
      m.visible = k > 0;
      if (m.visible) m.scale.set(0.6 + 0.4 * k, k * (2 - k), 0.6 + 0.4 * k);
    }
  };
  return group;
}
