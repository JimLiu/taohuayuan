// The cave: "山有小口，仿佛若有光……初极狭，才通人。复行数十步，豁然开朗。"
// A voxel passage along TUNNEL, the rock of both mouths (filling the holes left in the terrain), crags on the
// face above the outer mouth, and an overhanging hood with flanking boulders that frames the basin view.
import * as THREE from 'three';
import { TUNNEL, EXIT, ENTRY, height, creekDist, MOUTH_BOXES, inMouthBox } from './layout.js';
import { VoxelGrid, meshVoxels, voxelMaterial } from '../core/voxel.js';
import { fbm3, perlin3, fbm2, perlin2 } from '../core/noise.js';
import { clamp, lerp, smoothstep, hash3 } from '../core/rng.js';

// ---------------------------------------------------------------- centre line
const SEG = [];
let LEN = 0;
for (let i = 0; i < TUNNEL.length - 1; i++) {
  const a = TUNNEL[i], b = TUNNEL[i + 1];
  const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
  SEG.push({ a, b, s0: LEN, len, dx: (b[0] - a[0]) / len, dz: (b[2] - a[2]) / len });
  LEN += len;
}
export const TUNNEL_LEN = LEN;

// nearest point on the centre line in plan, extended straight out past both mouths
export function passageNear(x, z) {
  let best = 1e9, s = 0, floor = 0, lat = 0;
  for (let i = 0; i < SEG.length; i++) {
    const S = SEG[i];
    const lo = i === 0 ? -10 : 0, hi = i === SEG.length - 1 ? S.len + 10 : S.len;
    const t = clamp((x - S.a[0]) * S.dx + (z - S.a[2]) * S.dz, lo, hi);
    const px = S.a[0] + S.dx * t, pz = S.a[2] + S.dz * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < best) {
      best = d;
      s = S.s0 + t;
      floor = lerp(S.a[1], S.b[1], clamp(t / S.len, 0, 1));
      lat = (x - px) * -S.dz + (z - pz) * S.dx;
    }
  }
  return { d: best, s, floor, lat };
}
// a point on the walking line at arc length s (for the camera and walkers)
export function passagePoint(s) {
  s = clamp(s, -10, LEN + 10);
  let i = 0;
  while (i < SEG.length - 1 && s > SEG[i].s0 + SEG[i].len) i++;
  const S = SEG[i], t = s - S.s0;
  return { x: S.a[0] + S.dx * t, y: lerp(S.a[1], S.b[1], clamp(t / S.len, 0, 1)), z: S.a[2] + S.dz * t, dx: S.dx, dz: S.dz };
}

// half width and height of the passage: a small mouth, a long squeeze, then it opens out
export function halfW(s) {
  if (s < 0) return lerp(0.92, 1.3, smoothstep(0, -3, s));
  let w = lerp(0.92, 0.6, smoothstep(0.5, 6, s)) + 0.07 * Math.sin(s * 0.37) + 0.04 * Math.sin(s * 1.13 + 1);
  w = lerp(w, 1.15, smoothstep(LEN - 30, LEN - 10, s));
  w = lerp(w, 2.5, smoothstep(LEN - 10, LEN, s));
  return lerp(w, 3.8, smoothstep(LEN, LEN + 5, s));
}
export function hgt(s) {
  if (s < 0) return lerp(2.4, 2.9, smoothstep(0, -3, s));
  let h = lerp(2.4, 2.1, smoothstep(0.5, 6, s)) + 0.1 * Math.sin(s * 0.29 + 2);
  h = lerp(h, 2.7, smoothstep(LEN - 30, LEN - 10, s));
  h = lerp(h, 3.35, smoothstep(LEN - 10, LEN, s));
  return lerp(h, 4.6, smoothstep(LEN, LEN + 5, s));
}

// is (x,y,z) open air inside the passage?
function carved(x, y, z, P) {
  const hh = hgt(P.s), hw = halfW(P.s);
  const v = (y - P.floor) / hh;
  if (v < -0.1 || v > 1.15 || P.d > hw + 0.6) return false;
  if (y < P.floor + 0.05 * perlin2(x * 1.7, z * 1.7)) return false;
  const prof = v < 0.45 ? 0.8 + 0.2 * (v / 0.45) : Math.sqrt(Math.max(0, 1 - Math.pow((v - 0.45) / 0.55, 2)));
  const n = fbm3(x * 0.8, y * 0.8, z * 0.8, 2) * 0.24 + perlin3(x * 2.3, y * 2.3, z * 2.3) * 0.06;
  return P.d < hw * prof + n * (0.5 + 0.5 * prof);
}

// baked light: daylight reaches a few metres in from each mouth; the middle stays dark
function caveLight(x, y, z) {
  const P = passageNear(x, z);
  if (P.d > halfW(P.s) + 1.6 || y > P.floor + hgt(P.s) + 1.2 || y < P.floor - 1.2) return 1;
  const s = P.s;
  const south = Math.exp(-Math.max(s, 0) / 5.5);
  const north = Math.exp(-Math.max(LEN - s, 0) / 10);
  // never quite black: a little light creeps round the bends from both ends
  return clamp(Math.max(south, north) + 0.1 * Math.exp(-Math.max(LEN - s, 0) / 40), 0.13, 1);
}

// ---------------------------------------------------------------- palette
const lin = (r, g, b) => [Math.pow(r, 2.2), Math.pow(g, 2.2), Math.pow(b, 2.2)];
const PAL = [
  null,
  lin(0.57, 0.54, 0.49),   // 1 rock
  lin(0.51, 0.49, 0.45),   // 2 rock, darker stratum
  lin(0.63, 0.6, 0.54),    // 3 pale stratum
  lin(0.42, 0.41, 0.38),   // 4 shadowed rock
  lin(0.34, 0.43, 0.2),    // 5 moss
  lin(0.44, 0.56, 0.25),   // 6 grass
  lin(0.31, 0.3, 0.28),    // 7 damp rock inside
  lin(0.43, 0.37, 0.29),   // 8 trodden floor
  lin(0.62, 0.6, 0.45),    // 9 lichen
];

// strata give the rock the horizontal banding of a painted 皴 texture
function rockId(x, y, z) {
  const b = y * 0.85 + 1.6 * fbm2(x * 0.07, z * 0.07, 2) + 0.35 * perlin3(x * 0.4, y * 0.4, z * 0.4);
  const f = b - Math.floor(b);
  const lich = perlin3(x * 0.3 + 5, y * 0.3, z * 0.3);
  if (lich > 0.38) return 9;
  return f < 0.18 ? 2 : f < 0.34 ? 3 : f < 0.4 ? 4 : 1;
}

// ---------------------------------------------------------------- region builder
// A voxel block over [x0,x1]x[z0,z1]: rock below the terrain surface plus protrusion, minus the passage.
function buildRegion({ x0, x1, z0, z1, y0, size, prot, extra = null, allSolid = false }) {
  const nx = Math.ceil((x1 - x0) / size), nz = Math.ceil((z1 - z0) / size);
  // per column: terrain height and slope (with a one-cell border), and the nearest passage point
  const W = nx + 2, D = nz + 2;
  const Hc = new Float32Array(W * D);
  for (let k = 0; k < D; k++) for (let i = 0; i < W; i++) Hc[k * W + i] = height(x0 + (i - 0.5) * size, z0 + (k - 0.5) * size);
  const top = new Float32Array(nx * nz), must = new Float32Array(nx * nz), amp = new Float32Array(nx * nz);
  const Pc = new Array(nx * nz);
  let yMax = y0 + 1;
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
    const x = x0 + (i + 0.5) * size, z = z0 + (k + 0.5) * size;
    const h = Hc[(k + 1) * W + i + 1];
    const gx = (Hc[(k + 1) * W + i + 2] - Hc[(k + 1) * W + i]) / (2 * size);
    const gz = (Hc[(k + 2) * W + i + 1] - Hc[k * W + i + 1]) / (2 * size);
    const slope = Math.hypot(gx, gz);
    const edge = Math.min(x - x0, x1 - x, z - z0, z1 - z);
    const pr = allSolid ? 1e3 : prot(x, z, h, slope, edge);
    const t = h + pr;
    top[k * nx + i] = t;
    amp[k * nx + i] = smoothstep(-0.25, 0.45, pr);
    // where the terrain has a hole the rock must reach above the old surface everywhere
    must[k * nx + i] = inMouthBox(x, z, -1.0) ? h + 0.12 : -1e9;
    Pc[k * nx + i] = passageNear(x, z);
    yMax = Math.max(yMax, t + 0.5, extra ? extra.yMax : 0);
  }
  const yTop = allSolid ? extra.yMax : Math.min(yMax, y0 + 120);
  const ny = Math.ceil((yTop - y0) / size);
  const g = new VoxelGrid(nx, ny, nz, size, [x0, y0, z0]);
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
    const x = g.wx(i), z = g.wz(k);
    const t = top[k * nx + i], P = Pc[k * nx + i];
    const nearP = P.d < halfW(P.s) + 1.2;
    for (let j = 0; j < ny; j++) {
      const y = g.wy(j);
      // the surface breaks up only where rock is meant to stand out; buried rock stays buried
      const a = amp[k * nx + i];
      let s = y < t - 2.5 ? true : y > t + 2.5 ? false : y < t + (a > 0 ? fbm3(x * 0.35, y * 0.35, z * 0.35, 2) * a : 0);
      if (y < must[k * nx + i]) s = true;
      if (!s && extra) s = extra.solid(x, y, z);
      if (s && nearP && carved(x, y, z, P)) s = false;
      if (s) g.d[(k * ny + j) * nx + i] = 1;
    }
  }
  // cells beyond the block: solid where the surrounding rock would continue
  g.outside = (i, j, k) => {
    if (allSolid) return 1;
    const ic = clamp(i, 0, nx - 1), kc = clamp(k, 0, nz - 1);
    if (j < 0) return 1;
    return g.wy(j) < top[kc * nx + ic] - 0.3 ? 1 : 0;
  };
  // materials: grass and moss on exposed tops outside, damp rock in the passage, strata elsewhere
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
    const P = Pc[k * nx + i];
    const nearP = P.d < halfW(P.s) + 1.0;
    for (let j = 0; j < ny; j++) {
      const idx = (k * ny + j) * nx + i;
      if (!g.d[idx]) continue;
      const above = g.get(i, j + 1, k);
      // only cells that show a face need a material
      if (above && g.get(i, j - 1, k) && g.get(i + 1, j, k) && g.get(i - 1, j, k) && g.get(i, j, k + 1) && g.get(i, j, k - 1)) continue;
      const x = g.wx(i), y = g.wy(j), z = g.wz(k);
      let id = rockId(x, y, z);
      const inCave = nearP && y < P.floor + hgt(P.s) + 0.6 && P.s > -1.5 && P.s < LEN + 1.5;
      if (inCave) {
        id = y < P.floor + 0.25 ? 8 : hash3(i, j, k) < 0.5 ? 7 : 2;
        if (P.s > LEN - 6 || P.s < 2) id = y < P.floor + 0.25 ? 8 : rockId(x, y, z);
      } else if (!above) {
        const m = fbm2(x * 0.25, z * 0.25, 2) + 0.25 * perlin2(x * 1.3, z * 1.3);
        id = m > 0.22 ? 6 : m > -0.12 ? 5 : id;
      } else if (!g.get(i + 1, j, k) || !g.get(i - 1, j, k) || !g.get(i, j, k + 1) || !g.get(i, j, k - 1)) {
        // moss creeping down from ledges
        if (g.get(i, j + 2, k) === 0 && perlin3(x * 0.6, y * 0.6, z * 0.6) > 0.1) id = 5;
      }
      g.d[idx] = id;
    }
  }
  return g;
}

// ---------------------------------------------------------------- the build
export function buildTunnel() {
  const group = new THREE.Group();
  group.name = 'tunnel';
  const mat = voxelMaterial({ key: 'rock', bevel: 0.09, rough: 0.93 });
  const add = (grid, seed) => {
    const geo = meshVoxels(grid, PAL, { light: caveLight, jitter: 0.06, seed });
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    return geo;
  };

  const inBox = (x, z, b, pad) => x > b.x0 - pad && x < b.x1 + pad && z > b.z0 - pad && z < b.z1 + pad;
  // protrusion: always covers the skipped terrain; crags stand out of steep faces; buried elsewhere
  const protFor = (box) => (x, z, h, slope, edge) => {
    const n = fbm2(x * 0.11, z * 0.11, 3);
    const steep = smoothstep(0.9, 2.6, slope);
    let p = -0.45 + steep * (0.7 + 2.2 * Math.max(0, n + 0.25));
    const inside = inBox(x, z, box, 0) ? 1 : inBox(x, z, box, 1.2) ? 0.5 : 0;
    if (inside) p = Math.max(p, lerp(-0.1, 0.35 + 0.5 * Math.max(0, n), inside));
    // keep the spring pool and the creek clear
    if (creekDist(x, z) < 1.2) p = Math.min(p, -0.4);
    return p * smoothstep(0, 2.5, edge) - 0.45 * (1 - smoothstep(0, 2.5, edge));
  };

  // south: the small mouth at the foot of the face, crags on the face around it
  const SB = MOUTH_BOXES[0];
  add(buildRegion({ x0: -16, x1: 24, z0: 26, z1: 44, y0: 3.5, size: 0.3, prot: protFor(SB) }), 1);

  // north: the mouth in the hillside, with an overhanging hood and boulders framing the view
  const NB = MOUTH_BOXES[1];
  const blobs = [
    { x: -2.6, y: 19.2, z: -41.5, rx: 6.2, ry: 4.4, rz: 5.2 },   // the hood over the mouth
    { x: -9.6, y: 15.6, z: -46.5, rx: 2.8, ry: 2.4, rz: 2.4 },   // boulder, left of the ledge
    { x: 4.8, y: 16.2, z: -45.2, rx: 2.4, ry: 3.1, rz: 2.6 },    // boulder, right
    { x: 6.9, y: 15.2, z: -48.8, rx: 1.4, ry: 1.2, rz: 1.3 },
  ];
  const extraN = {
    yMax: 25,
    solid: (x, y, z) => {
      for (const b of blobs) {
        const q = Math.pow((x - b.x) / b.rx, 2) + Math.pow((y - b.y) / (y < b.y ? b.ry * 2.4 : b.ry), 2) + Math.pow((z - b.z) / b.rz, 2);
        if (q < 1.6 && q < 1 + 0.55 * fbm3(x * 0.4, y * 0.4, z * 0.4, 2) + 0.12 * perlin3(x * 1.5, y * 1.5, z * 1.5)) return true;
      }
      return false;
    },
  };
  add(buildRegion({ x0: -15, x1: 11, z0: -53, z1: -30, y0: 11, size: 0.2, prot: protFor(NB), extra: extraN }), 2);

  // the long middle: all rock but the passage, closed on every side
  const mid = SEG.flatMap((S) => [S.a, S.b]).filter((p) => p[2] < 26.5 && p[2] > -30.5);
  const xs = mid.map((p) => p[0]), ys = mid.map((p) => p[1]);
  add(buildRegion({
    x0: Math.min(...xs) - 2.4, x1: Math.max(...xs) + 2.4, z0: -30, z1: 26, y0: Math.min(...ys) - 1.2, size: 0.25,
    prot: () => 0, allSolid: true, extra: { yMax: Math.max(...ys) + 4.2, solid: () => true },
  }), 3);

  // "仿佛若有光": a faint warm glow a few metres in, seen from the pool
  const glowMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uAmt: { value: 1 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform float uAmt; varying vec2 vUv; void main(){ vec2 p = vUv*2.0-1.0; float r = dot(p*vec2(1.0,0.7),p*vec2(1.0,0.7)); float a = exp(-r*3.2)*0.22*uAmt; gl_FragColor = vec4(vec3(1.0,0.9,0.72)*a, 1.0); }',
  });
  const gp = passagePoint(7);
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 2.2), glowMat);
  glow.position.set(gp.x, gp.y + 1.05, gp.z);
  glow.lookAt(ENTRY.x, ENTRY.y + 1.2, ENTRY.z + 10);
  glow.name = 'caveGlow';
  group.add(glow);

  group.userData = { glow, material: mat };
  return group;
}
