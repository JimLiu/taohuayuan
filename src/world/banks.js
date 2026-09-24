// 夹岸: the banks of the peach reach. Mossy boulders at the foot of the bank, a few standing out in the
// stream, and ferns in their lee and under the trees. The meshes are the reference scene's compact cuts of
// Poly Haven's rock_moss_set_02 and fern_02 (assets-src/web/ref/*.msh, shipped gzipped as src/assets/ref/*.mshz);
// the textures are the Poly Haven originals (CC0, assets-src/web/tex/, shipped as WebP in src/assets/tex/).
// Merged per 100 m of creek, so each stretch is one draw for the rocks and one for the ferns.
import * as THREE from 'three';
import { Rng } from '../core/rng.js';
import { loadMSH } from '../core/msh.js';
import { hook, TRANSLUCENT } from '../core/shared.js';
import { creekX, creekHW, creekDist, forestMask, WATER_OUT, FOREST } from './layout.js';
import { surfaceHeight } from './terrain.js';
import { cameraSamples, segSphere } from './flora.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

function texture(url, srgb) {
  const t = new THREE.TextureLoader().load(url);
  t.flipY = false; // glTF uv convention, as the meshes carry it
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// bake a list of { g, m } (geometry, matrix) into one indexed geometry
function merge(parts) {
  let nv = 0, ni = 0;
  for (const { g } of parts) { nv += g.attributes.position.count; ni += g.index.count; }
  const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), U = new Float32Array(nv * 2), I = new Uint32Array(ni);
  const v = new THREE.Vector3(), nm = new THREE.Matrix3();
  let ov = 0, oi = 0;
  for (const { g, m } of parts) {
    const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv, ix = g.index.array;
    nm.getNormalMatrix(m);
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m); P.set([v.x, v.y, v.z], (ov + i) * 3);
      v.fromBufferAttribute(n, i).applyMatrix3(nm).normalize(); N.set([v.x, v.y, v.z], (ov + i) * 3);
      U.set([uv.getX(i), uv.getY(i)], (ov + i) * 2);
    }
    for (let i = 0; i < ix.length; i++) I[oi + i] = ix[i] + ov;
    ov += p.count; oi += ix.length;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(P, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(U, 2));
  out.setIndex(new THREE.BufferAttribute(I, 1));
  out.computeBoundingSphere();
  return out;
}

export async function buildBanks(trees) {
  const group = new THREE.Group();
  group.name = 'banks';
  const [rocks, ferns] = await Promise.all([
    loadMSH(new URL('../assets/ref/rock_moss_set_02_lo.mshz', import.meta.url).href),
    loadMSH(new URL('../assets/ref/fern_02.mshz', import.meta.url).href),
  ]);
  const rng = new Rng(5150);
  const cams = cameraSamples();
  // clear of every story camera and of the first stretch of its line of sight
  const clear = (x, y, z, r) => {
    for (const k of cams) {
      if (Math.abs(k.p[2] - z) > 90) continue;
      if (Math.hypot(k.p[0] - x, k.p[1] - y, k.p[2] - z) < r + 2) return false;
      if (segSphere(k.p, k.l, 40, V(x, y, z), r)) return false;
    }
    return true;
  };
  const trunkNear = (x, z, d) => trees.some((t) => Math.abs(t.x - x) < d && Math.abs(t.z - z) < d && Math.hypot(t.x - x, t.z - z) < d);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  const pose = (x, y, z, s, yaw, tilt = 0.12) => {
    e.set(rng.range(-tilt, tilt), yaw, rng.range(-tilt, tilt));
    return m4.compose(V(x, y, z), q.setFromEuler(e), V(s * rng.range(0.9, 1.1), s * rng.range(0.85, 1.1), s * rng.range(0.9, 1.1))).clone();
  };
  const chunk = (z) => Math.floor(z / 100);
  const rockParts = new Map(), fernParts = new Map();
  const add = (map, z, part) => { const k = chunk(z); if (!map.has(k)) map.set(k, []); map.get(k).push(part); };
  const placed = [];
  const fern = (x, z, s) => {
    const y = surfaceHeight(x, z);
    if (y < WATER_OUT + 0.12 || creekDist(x, z) < 0.3) return false;
    if (!clear(x, y + 0.3, z, 0.9)) return false;
    add(fernParts, z, { g: ferns[rng.int(0, ferns.length - 1)], m: pose(x, y - 0.03, z, s, rng.range(0, 6.28), 0.18) });
    return true;
  };

  // boulders along both banks, alone or in twos and threes, with open stretches between
  for (const side of [-1, 1]) {
    for (let z = FOREST.z0 - 6; z < FOREST.z1 + 26; z += rng.range(4, 12)) {
      const n = rng.next() < 0.35 ? rng.int(2, 3) : 1;
      for (let i = 0; i < n; i++) {
        const zz = z + rng.range(-1.8, 1.8);
        const mid = i === 0 && rng.next() < 0.1;
        const hw = creekHW(zz);
        // at the foot of the bank (some in the shallows), or now and then a stone out in the current
        const x = mid ? creekX(zz) + side * hw * rng.range(0.15, 0.6) : creekX(zz) + side * (hw + rng.range(-0.6, 1.4));
        const k = mid ? (rng.next() < 0.5 ? 3 : 5) : rng.int(0, rocks.length - 1);
        const s = mid ? rng.range(1.5, 2.0) : rng.range(0.7, 1.9) * (i ? 0.7 : 1);
        const g = rocks[k], bb = g.boundingBox;
        const r = Math.max(bb.max.x, bb.max.z) * s;
        if (placed.some((p) => Math.hypot(p.x - x, p.z - zz) < p.r + r * 0.8)) continue;
        if (trunkNear(x, zz, r + 0.6)) continue;
        const y = surfaceHeight(x, zz), H = bb.max.y * s;
        // sunk into the ground by a quarter of its height, deeper on the slope toward the water;
        // a stone in the current shows a good third of itself above the water, its foot on the bed
        const yy = mid ? Math.min(WATER_OUT + H * rng.range(0.38, 0.55) - H, y - 0.1) : y - H * rng.range(0.18, 0.35);
        if (mid && yy < y - H * 0.6) continue;
        if (yy + H < WATER_OUT + (mid ? 0.3 : 0.2)) continue;
        if (!clear(x, yy + bb.max.y * s * 0.5, zz, r)) continue;
        placed.push({ x, z: zz, r, top: yy + H });
        add(rockParts, zz, { g, m: pose(x, yy, zz, s, rng.range(0, 6.28)) });
        // ferns in its lee, on the land side
        if (!mid) for (let f = rng.int(0, 3); f > 0; f--) {
          const a = rng.range(-1.2, 1.2), d = r + rng.range(0.2, 1.1);
          fern(x + side * Math.cos(a) * d, zz + Math.sin(a) * d, rng.range(1.4, 2.4));
        }
      }
    }
  }
  // and ferns scattered under the bank trees, in small colonies
  for (let tries = 0, made = 0; tries < 3000 && made < 110; tries++) {
    const z = rng.range(FOREST.z0, FOREST.z1 + 10), side = rng.sign();
    const x = creekX(z) + side * (creekHW(z) + rng.range(0.8, 9));
    if (forestMask(x, z) < 0.3) continue;
    for (let c = rng.int(1, 4); c > 0; c--) if (fern(x + rng.range(-1.5, 1.5), z + rng.range(-1.5, 1.5), rng.range(1.3, 2.3))) made++;
  }

  // ---------------------------------------------------------------- materials
  const rockMat = new THREE.MeshStandardMaterial({
    map: texture(new URL('../assets/tex/rock_moss_set_02_diff_1k.webp', import.meta.url).href, true),
    normalMap: texture(new URL('../assets/tex/rock_moss_set_02_nor_gl_1k.jpg', import.meta.url).href),
    roughness: 0.92, metalness: 0,
  });
  hook(rockMat, 'bank-rock', (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWN;')
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n vWN = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWN;')
      .replace('#include <color_fragment>', `#include <color_fragment>
      {
        // the scan is a pale grey-brown stone: lift it, and let moss take the tops and the shaded
        // north faces the way it does on creek boulders; dark and wet at the waterline
        float lum = dot(diffuseColor.rgb, vec3(0.3, 0.55, 0.15));
        float n = vnoise(vFogWP.xz * 2.3) * 0.6 + vnoise(vFogWP.xz * 7.1 + vFogWP.y * 3.0) * 0.4;
        float moss = smoothstep(0.35, 0.8, vWN.y + (n - 0.5) * 0.9) * 0.85;
        vec3 mossC = vec3(0.26, 0.36, 0.12) * (0.7 + lum * 1.6);
        diffuseColor.rgb = mix(diffuseColor.rgb * vec3(1.18, 1.2, 1.16), mossC, moss);
        float hy = vFogWP.y - uWaterLv.x;
        diffuseColor.rgb *= mix(0.5, 1.0, smoothstep(-0.02, 0.22, hy));
      }`);
  });
  const fernMat = new THREE.MeshStandardMaterial({
    map: texture(new URL('../assets/tex/fern_02_diff_1k.webp', import.meta.url).href, true),
    normalMap: texture(new URL('../assets/tex/fern_02_nor_gl_1k.webp', import.meta.url).href),
    alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.75, metalness: 0,
  });
  fernMat.alphaToCoverage = true;
  hook(fernMat, 'bank-fern', (sh) => {
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb *= vec3(0.9, 0.95, 0.85);')
      .replace('#include <lights_fragment_begin>', `#include <lights_fragment_begin>
      {
        ${TRANSLUCENT}
        reflectedLight.directDiffuse += sunC * diffuseColor.rgb * (sunBack * 1.2 + sunWrap * 0.3);
      }`);
  });

  let nRock = 0, nFern = 0;
  for (const [k, parts] of rockParts) {
    const m = new THREE.Mesh(merge(parts), rockMat);
    m.name = `bank-rocks-${k}`; m.castShadow = true; m.receiveShadow = true;
    group.add(m); nRock += parts.length;
  }
  for (const [k, parts] of fernParts) {
    const m = new THREE.Mesh(merge(parts), fernMat);
    m.name = `bank-ferns-${k}`; m.receiveShadow = true;
    group.add(m); nFern += parts.length;
  }
  group.userData = { rocks: nRock, ferns: nFern, stones: placed };
  return group;
}
