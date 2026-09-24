// Height-field terrain in tiles whose resolution follows where the camera will look closely:
// 1 m along the creek and the peach forest, finer around the basin, coarse on the far ring.
import * as THREE from 'three';
import {
  height, basinR, creekDist, forestMask, inMouthBox, WATER_OUT, FLOOR, PATHS_NS, PATHS_EW, FIELD_BOUNDS,
  polyDist, DESCENT, VILLAGE, THRESH, pondDist, CANALS, fieldAt, SRC,
} from './layout.js';
import { fbm2, perlin2 } from '../core/noise.js';
import { smoothstep, clamp, lerp } from '../core/rng.js';
import { hook } from '../core/shared.js';
import { GROUND_GLSL } from './grass.js';
import { builtAt, toLocal } from './villageplan.js';

const lin = (r, g, b) => [Math.pow(r, 2.2), Math.pow(g, 2.2), Math.pow(b, 2.2)];
const C = {
  grass: lin(0.47, 0.6, 0.27),
  lush: lin(0.36, 0.55, 0.22),
  young: lin(0.58, 0.68, 0.3),
  dryGrass: lin(0.6, 0.6, 0.38),
  soil: lin(0.5, 0.4, 0.29),
  wetSoil: lin(0.33, 0.29, 0.22),
  path: lin(0.66, 0.57, 0.43),
  earth: lin(0.6, 0.5, 0.37),
  yard: lin(0.62, 0.55, 0.44),
  rock: lin(0.52, 0.5, 0.46),
  rockDark: lin(0.35, 0.34, 0.32),
  forest: lin(0.22, 0.29, 0.2),
  forestHi: lin(0.31, 0.37, 0.24),
  apron: lin(0.42, 0.52, 0.29),
  gravel: lin(0.42, 0.4, 0.33),
  bed: lin(0.3, 0.33, 0.24),
  moss: lin(0.3, 0.4, 0.18),
};
const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

function nearPaths(x, z) {
  let d = 1e9;
  if (x > FIELD_BOUNDS.x0 - 2 && x < FIELD_BOUNDS.x1 + 2 && z < FIELD_BOUNDS.z0 + 2 && z > FIELD_BOUNDS.z1 - 30) {
    for (const px of PATHS_NS) d = Math.min(d, Math.abs(x - px) - (px === 0 ? 0.6 : 0));
    for (const pz of PATHS_EW) d = Math.min(d, Math.abs(z - pz));
  }
  d = Math.min(d, polyDist(DESCENT, x, z).d - 0.2);
  return d;
}

// how much of a vertex is under the slope forest (set by terrainColor, read by buildTile): the shader
// draws the crowns there
let forestW = 0;

export function terrainColor(x, y, z, ny, peachDensity) {
  const s = 1 - ny;
  const n1 = fbm2(x * 0.045, z * 0.045, 3), n2 = perlin2(x * 0.21, z * 0.21);
  const r = basinR(x, z);
  let c;
  if (r < 1.0 && z < -28) {
    // basin: grass, packed paths, village earth, rim slopes
    c = mix3(C.grass, C.young, smoothstep(-0.3, 0.5, n1));
    const rim = smoothstep(0.76, 0.95, r);
    c = mix3(c, mix3(C.apron, C.forestHi, smoothstep(0.9, 1.0, r)), rim);
    const pd = nearPaths(x, z);
    if (pd < 1.6) c = mix3(C.path, c, smoothstep(0.55, 1.6, pd + n2 * 0.3));
    const [vu, vv] = toLocal(x, z);
    const vil = 1 - smoothstep(0.8, 1.15, Math.hypot((vu - 10) / 78, (vv + 8) / 44) + n1 * 0.2);
    if (vil > 0) {
      c = mix3(c, mix3(C.earth, C.grass, smoothstep(-0.3, 0.7, n2 + n1)), vil * 0.5);
      const b = builtAt(x, z);
      if (b.house || b.yard) c = mix3(C.yard, C.earth, 0.5 + 0.5 * n2);
      if (b.lane < 2.6) c = mix3(C.path, c, smoothstep(0.9, 2.6, b.lane + n2 * 0.4));
    }
    const th = Math.hypot(x - THRESH.x, z - THRESH.z);
    if (th < THRESH.r + 1) c = mix3(lin(0.7, 0.62, 0.5), c, smoothstep(THRESH.r - 1, THRESH.r + 1, th));
    // inside the plots: wet mud under the paddies, bare soil under the dry crops (the field surfaces lie on top)
    const fp = fieldAt(x, z);
    if (fp) c = mix3(c, fp.flooded ? C.wetSoil : C.soil, smoothstep(0.2, 1.0, Math.min(x - fp.x0, fp.x1 - x, z - fp.z0, fp.z1 - z)));
    const pnd = pondDist(x, z);
    if (pnd < 3) c = mix3(C.wetSoil, c, smoothstep(-0.5, 3, pnd));
    for (const cn of CANALS) { const d = polyDist(cn, x, z).d; if (d < 2.2) c = mix3(C.wetSoil, c, smoothstep(0.8, 2.2, d)); }
    if (y < -0.2) c = C.bed;
  } else {
    // outside: lush banks, gravel at the water line, the bed under the creek
    const cd = creekDist(x, z);
    c = mix3(C.lush, C.grass, smoothstep(2, 30, cd) * 0.6 + n1 * 0.4);
    c = mix3(c, C.young, smoothstep(0.2, 0.7, n2 * 0.5 + n1) * 0.4);
    // deeper and less yellow than the basin's lawns: long wild grass in the valley's shade
    const kd = lerp(1, 0.78, smoothstep(16, 60, cd));
    c = [c[0] * 0.64 * kd, c[1] * 0.74 * kd, c[2] * 0.74 * kd];
    if (cd < 1.8) c = mix3(C.wetSoil, c, smoothstep(-0.4, 1.8, cd + n2 * 0.5));
    if (y < WATER_OUT - 0.1) c = mix3(C.gravel, C.bed, smoothstep(WATER_OUT - 0.3, WATER_OUT - 1.4, y));
    if (Math.hypot(x - SRC.x, z - SRC.z) < SRC.r + 1.5 && y < WATER_OUT + 0.2) c = mix3(C.moss, C.gravel, n2 * 0.5 + 0.5);
  }
  // mountains: forested slopes, rock on the steep faces and the crests. In the basin the wood comes
  // down to a ragged line some way above the apron; outside it keeps above the creek's meadows
  const base = r < 1 ? FLOOR + 16 + 10 * n1 : WATER_OUT + 12;
  // with glades and bare shoulders where the wood thins, so the slopes aren't one even pelt
  const glade = smoothstep(0.12, 0.4, fbm2(x * 0.009 + 11.3, z * 0.009 - 3.7, 2) - 0.3 * smoothstep(40, 160, y));
  const up = smoothstep(base, base + 16, y) * (1 - forestMask(x, z)) * (1 - 0.8 * glade);
  if (up > 0) c = mix3(c, mix3(C.forest, C.forestHi, smoothstep(-0.3, 0.6, n1)), up);
  const rocky = clamp(smoothstep(0.6, 0.82, s + n2 * 0.16) + smoothstep(190, 250, y + n1 * 30) * 0.5, 0, 1);
  if (rocky > 0) c = mix3(c, mix3(C.rock, C.rockDark, smoothstep(-0.4, 0.5, n2)), rocky);
  forestW = up * (1 - rocky);
  return c;
}

// the slope forest's weight at a point (0 open ground .. 1 full wood), and the ground height there
export function forestCover(x, z) {
  const y = height(x, z), e = 1.5;
  const gx = height(x - e, z) - height(x + e, z), gz = height(x, z - e) - height(x, z + e);
  const c = terrainColor(x, y, z, (2 * e) / Math.hypot(gx, 2 * e, gz), 0);
  return { w: forestW, y, c };
}

export function tileRes(cx, cz) {
  const r = basinR(cx, cz);
  const cd = creekDist(cx, cz);
  if (cz > 10 && cz < 720 && cd < 90) return cd < 60 ? 1.0 : 2.0;
  if (cz > 720 && cz < 1000 && cd < 70) return 2.0;
  if (r < 0.95) return 1.25;
  if (r < 1.12) return 2.0;
  if (r < 1.6 || (cz > 0 && cz < 1000 && cd < 260)) return 4.0;
  return 8.0;
}

// the height of the rendered mesh (triangle interpolation of the tile grid), for things that
// lie on the ground: petals, leaves, stones. height() itself can sit a few cm off on slopes.
const TX0 = -1000, TZ0 = -900, TT = 100;
export function surfaceHeight(x, z) {
  const tx = TX0 + Math.floor((x - TX0) / TT) * TT, tz = TZ0 + Math.floor((z - TZ0) / TT) * TT;
  const res = tileRes(tx + TT / 2, tz + TT / 2);
  const gi = Math.floor((x - tx) / res), gj = Math.floor((z - tz) / res);
  const x0 = tx + gi * res, z0 = tz + gj * res;
  const fx = (x - x0) / res, fz = (z - z0) / res;
  const hb = height(x0 + res, z0), hc = height(x0, z0 + res);
  if (fx + fz <= 1) {
    const ha = height(x0, z0);
    return ha + fx * (hb - ha) + fz * (hc - ha);
  }
  const hd = height(x0 + res, z0 + res);
  return hd + (1 - fx) * (hc - hd) + (1 - fz) * (hb - hd);
}

export function buildTerrain(peachDensityFn = () => 0) {
  const group = new THREE.Group();
  group.name = 'terrain';
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94, metalness: 0 });
  // the grass bake (set later by main): the ground between near blades is in their shade
  // river stones (Poly Haven "Ganges River Pebbles", CC0) for the creek bed and the strand along its banks
  const pebble = new THREE.TextureLoader().load(new URL('../assets/tex/river_pebbles_diff.webp', import.meta.url).href);
  pebble.wrapS = pebble.wrapT = THREE.RepeatWrapping;
  pebble.colorSpace = THREE.SRGBColorSpace;
  pebble.anisotropy = 8;
  mat.userData.uniforms = { uGround: { value: null }, uGroundRect: { value: new THREE.Vector4(0, 0, 1, 1) }, uPebble: { value: pebble } };
  hook(mat, 'terrain', (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aBlush, aForest;\nvarying float vBlush, vForest;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBlush = aBlush;\nvForest = aForest;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vBlush, vForest;\nuniform sampler2D uPebble;\n' + GROUND_GLSL)
      .replace('#include <color_fragment>', `#include <color_fragment>
      vec3 cnW = vec3(0.0, 1.0, 0.0);
      float cnK = 0.0;
      {
        vec2 wp = vFogWP.xz;
        float n = fbm3(wp * 0.33) - 0.5;
        float m = vnoise(wp * 2.7) - 0.5;
        diffuseColor.rgb *= 1.0 + n * 0.28 + m * 0.12;
        if (vForest > 0.01) {
          // 林冠, the painter's dotted wood: crowns on a jittered 5.5 m grid, the gaps between them in shade;
          // where a crown is only a few pixels across it settles to its average
          vec2 p = wp / 5.5;
          vec2 ip = floor(p), fp = fract(p);
          float best = 9.0, bh = 0.0;
          vec2 bo = vec2(0.0);
          for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
            vec2 g = vec2(float(i), float(j));
            vec2 h = vec2(hash12(ip + g), hash12(ip + g + 17.31));
            float cr = 0.52 + 0.22 * h.y;
            vec2 o = (g + 0.2 + 0.6 * h - fp) / cr;
            float d = length(o);
            if (d < best) { best = d; bo = o; bh = hash12(ip + g + 5.7); }
          }
          float res = 1.0 - smoothstep(0.12, 0.45, length(fwidth(p)));
          float crown = 1.0 - smoothstep(0.8, 1.02, best);
          // evergreens darker and bluer, more of them higher up; the spring broadleaves fresh and yellower
          // outside, along the creek, the hills are mostly dark conifer (the reference's river shot); the basin keeps its mixed wood
          float outs = step(30.0, vFogWP.z);
          float ever = step(bh, mix(0.28 + 0.42 * smoothstep(30.0, 150.0, vFogWP.y), 0.62 + 0.3 * smoothstep(20.0, 120.0, vFogWP.y), outs));
          vec3 tint = ever > 0.5 ? mix(vec3(0.74, 0.86, 0.92), vec3(0.55, 0.7, 0.8), outs) : mix(vec3(1.0), vec3(1.22, 1.18, 0.84), fract(bh * 7.31));
          vec3 cc = diffuseColor.rgb * mix(vec3(0.46, 0.48, 0.52), tint, crown);
          diffuseColor.rgb = mix(diffuseColor.rgb, mix(diffuseColor.rgb * 0.9, cc, res), vForest);
          vec2 sxz = -bo * crown * 0.85;
          cnW = vec3(sxz.x, sqrt(max(0.0, 1.0 - dot(sxz, sxz))), sxz.y);
          cnK = crown * res * vForest * mix(0.8, 0.35, outs);
        }
        if (uGroundRect.z > 1.0) {
          vec4 gr = groundAt(wp);
          float nearG = 1.0 - smoothstep(34.0, 52.0, distance(cameraPosition.xz, wp));
          diffuseColor.rgb *= 1.0 - 0.3 * gr.y * (1.0 - 0.6 * gr.z) * nearG;
        }
        // petals gathered under the trees and in drift lines along the bank
        // (a broken speckle rather than a wash: pink over green averages to grey)
        float drift = smoothstep(0.35, 0.8, vnoise(wp * 0.9 + 3.0) * 0.7 + vnoise(wp * 4.0) * 0.3);
        float speck = smoothstep(0.4, 0.8, vnoise(wp * 13.0) * 0.65 + vnoise(wp * 29.0) * 0.35);
        float bl = clamp(vBlush * (0.3 + 0.9 * drift) * (0.35 + 0.65 * speck), 0.0, 1.0);
        // close by, the real petals (instanced and laid in drifts) take over
        bl *= mix(0.25, 1.0, smoothstep(14.0, 40.0, distance(cameraPosition, vFogWP)));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.88, 0.5, 0.58), bl * 0.6);
        float wl = vFogWP.z > 30.0 ? uWaterLv.x : uWaterLv.y;
        if (vFogWP.z > 30.0) {
          // the creek runs clear over river stones, which come up out of it as a strand along both banks
          float hy = vFogWP.y - wl;
          float strand = 1.0 - smoothstep(0.26, 0.62, hy + (n + m) * 0.4);
          vec3 peb = texture2D(uPebble, wp * 0.41).rgb * 0.64 + texture2D(uPebble, wp * 0.157 + 0.31).rgb * 0.36;
          peb *= 0.92 + n * 0.35;
          peb = mix(peb, peb * vec3(0.78, 0.92, 0.66), smoothstep(0.12, 0.5, hy) * 0.55);
          diffuseColor.rgb = mix(diffuseColor.rgb, peb, strand);
          // wet at the water's edge
          diffuseColor.rgb *= 1.0 - 0.28 * (1.0 - smoothstep(0.0, 0.14, hy)) * step(0.0, hy);
          if (hy < 0.0) {
            // the light coming up from the bed has crossed water on its way to the eye: red goes first, then blue
            // (the surface adds the scattered colour and the reflection; see water.js)
            vec3 Vv = normalize(cameraPosition - vFogWP);
            float path = min(-hy / max(Vv.y, 0.1), 8.0);
            diffuseColor.rgb *= exp(-vec3(0.4, 0.12, 0.17) * path) * vec3(0.9, 1.0, 1.0);
          }
        } else {
          float under = smoothstep(wl + 0.05, wl - 0.9, vFogWP.y);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.55, 0.66, 0.6), under);
          diffuseColor.rgb *= 1.0 - 0.18 * smoothstep(wl + 0.35, wl, vFogWP.y) * (1.0 - under);
        }
      }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      if (cnK > 0.0) normal = normalize(mix(normal, (viewMatrix * vec4(cnW, 0.0)).xyz, cnK));`);
  });

  const X0 = -1000, X1 = 1000, Z0 = -900, Z1 = 1300, T = 100;
  const buckets = new Map();
  for (let tz = Z0; tz < Z1; tz += T) {
    for (let tx = X0; tx < X1; tx += T) {
      const res = tileRes(tx + T / 2, tz + T / 2);
      const geo = buildTile(tx, tz, T, res, peachDensityFn);
      const key = `${Math.floor((tx - X0) / 400)}:${Math.floor((tz - Z0) / 400)}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(geo);
    }
  }
  for (const geos of buckets.values()) {
    const g = mergeSimple(geos);
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    m.castShadow = true;
    group.add(m);
  }
  group.userData.material = mat;
  return group;
}

function buildTile(x0, z0, size, res, blushFn) {
  const n = Math.round(size / res);
  const N = n + 3; // with a one-sample border for normals
  const H = new Float32Array(N * N);
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) H[j * N + i] = height(x0 + (i - 1) * res, z0 + (j - 1) * res);
  const V = (n + 1) * (n + 1);
  const skirt = 4 * (n + 1);
  const pos = new Float32Array((V + skirt) * 3);
  const nor = new Float32Array((V + skirt) * 3);
  const col = new Float32Array((V + skirt) * 3);
  const blush = new Float32Array(V + skirt);
  const forest = new Float32Array(V + skirt);
  let k = 0;
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const x = x0 + i * res, z = z0 + j * res;
      const h = H[(j + 1) * N + (i + 1)];
      const dx = (H[(j + 1) * N + i + 2] - H[(j + 1) * N + i]) / (2 * res);
      const dz = (H[(j + 2) * N + i + 1] - H[j * N + i + 1]) / (2 * res);
      const l = Math.hypot(dx, 1, dz);
      pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
      nor[k * 3] = -dx / l; nor[k * 3 + 1] = 1 / l; nor[k * 3 + 2] = -dz / l;
      const c = terrainColor(x, h, z, 1 / l);
      col[k * 3] = c[0]; col[k * 3 + 1] = c[1]; col[k * 3 + 2] = c[2];
      forest[k] = forestW;
      blush[k] = blushFn(x, h, z);
      k++;
    }
  }
  const idx = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1;
      const cx = x0 + (i + 0.5) * res, cz = z0 + (j + 0.5) * res;
      if (inMouthBox(cx, cz)) continue;
      idx.push(a, c, b, b, c, d);
    }
  }
  // skirts hide cracks where neighbouring tiles use a different resolution
  const edges = [];
  for (let i = 0; i <= n; i++) edges.push([i, 0]);
  for (let j = 0; j <= n; j++) edges.push([n, j]);
  for (let i = n; i >= 0; i--) edges.push([i, n]);
  for (let j = n; j >= 0; j--) edges.push([0, j]);
  const ring = [];
  for (const [i, j] of edges) {
    const src = j * (n + 1) + i;
    pos[k * 3] = pos[src * 3]; pos[k * 3 + 1] = pos[src * 3 + 1] - Math.max(2, res * 1.5); pos[k * 3 + 2] = pos[src * 3 + 2];
    nor[k * 3] = nor[src * 3]; nor[k * 3 + 1] = nor[src * 3 + 1]; nor[k * 3 + 2] = nor[src * 3 + 2];
    col[k * 3] = col[src * 3]; col[k * 3 + 1] = col[src * 3 + 1]; col[k * 3 + 2] = col[src * 3 + 2];
    forest[k] = forest[src];
    ring.push([src, k]);
    k++;
    if (k >= V + skirt) break;
  }
  for (let e = 0; e < ring.length - 1; e++) {
    const [a, as] = ring[e], [b, bs] = ring[e + 1];
    const mx = (pos[a * 3] + pos[b * 3]) / 2, mz = (pos[a * 3 + 2] + pos[b * 3 + 2]) / 2;
    if (inMouthBox(mx, mz, -0.5)) continue;
    idx.push(a, b, as, b, bs, as, a, as, b, b, as, bs);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, k * 3), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor.subarray(0, k * 3), 3));
  g.setAttribute('color', new THREE.BufferAttribute(col.subarray(0, k * 3), 3));
  g.setAttribute('aBlush', new THREE.BufferAttribute(blush.subarray(0, k), 1));
  g.setAttribute('aForest', new THREE.BufferAttribute(forest.subarray(0, k), 1));
  g.setIndex(idx);
  return g;
}

// merge geometries with identical attribute layouts (position/normal/color/aBlush + index)
export function mergeSimple(geos) {
  let nv = 0, ni = 0;
  const names = Object.keys(geos[0].attributes);
  for (const g of geos) { nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
  const out = new THREE.BufferGeometry();
  const arrays = {};
  for (const nm of names) arrays[nm] = new Float32Array(nv * geos[0].attributes[nm].itemSize);
  const index = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let vo = 0, io = 0;
  for (const g of geos) {
    for (const nm of names) {
      const a = g.attributes[nm];
      arrays[nm].set(a.array.subarray(0, a.count * a.itemSize), vo * a.itemSize);
    }
    if (g.index) {
      const src = g.index.array;
      for (let i = 0; i < g.index.count; i++) index[io++] = src[i] + vo;
    } else {
      for (let i = 0; i < g.attributes.position.count; i++) index[io++] = vo + i;
    }
    vo += g.attributes.position.count;
  }
  for (const nm of names) out.setAttribute(nm, new THREE.BufferAttribute(arrays[nm], geos[0].attributes[nm].itemSize));
  out.setIndex(new THREE.BufferAttribute(index, 1));
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return out;
}
