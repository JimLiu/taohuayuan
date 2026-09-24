// World layout for 桃源: the outer creek and its peach forest (south, +z), the ridge the fisherman walks
// through, and the enclosed basin with fields, pond, village, mulberry and bamboo (north, -z).
// Everything that needs to agree on "where things are" reads it from here.
import { fbm2, ridge2, perlin2 } from '../core/noise.js';
import { clamp, lerp, smoothstep, Rng } from '../core/rng.js';

export const WATER_OUT = 8.0;   // creek surface outside the mountain
export const FLOOR = 0.0;       // basin floor
export const PADDY_Y = 0.16;    // flooded paddy surface
export const POND_Y = -0.3;     // pond / canal surface

// ---------------------------------------------------------------- creek
// centre line x(z) through monotone control points, the creek flowing from its spring (SRC_Z) to +z
const CREEK = [
  [46, 0], [80, 1.5], [130, -5], [185, -2], [240, 4], [295, -3], [335, 6], [372, 22],
  [410, 40], [460, 50], [520, 42], [590, 24], [660, 30], [740, 14], [830, 2], [960, -18], [1200, -30],
];
export const SRC_Z = 46;
export const SRC = { x: 0, z: 46, r: 6.2 };

function hermite(pts, z) {
  if (z <= pts[0][0]) return pts[0][1];
  const n = pts.length;
  if (z >= pts[n - 1][0]) return pts[n - 1][1];
  let i = 0;
  while (i < n - 2 && z > pts[i + 1][0]) i++;
  const [z0, x0] = pts[i], [z1, x1] = pts[i + 1];
  const zp = i > 0 ? pts[i - 1] : pts[i], zn = i < n - 2 ? pts[i + 2] : pts[i + 1];
  const m0 = (x1 - zp[1]) / (z1 - zp[0]) * (z1 - z0);
  const m1 = (zn[1] - x0) / (zn[0] - z0) * (z1 - z0);
  const t = (z - z0) / (z1 - z0), t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * x0 + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * x1 + (t3 - t2) * m1;
}
export const creekX = (z) => hermite(CREEK, z);
export const creekHW = (z) => 2.6 + 3.2 * smoothstep(SRC_Z, 160, z) + 1.6 * smoothstep(300, 520, z) + 1.4 * smoothstep(620, 900, z);
// signed distance to the creek edge (negative in the water); past the spring it rounds off
export function creekDist(x, z) {
  if (z < SRC_Z + 4) {
    const d = Math.hypot(x - SRC.x, z - SRC.z) - SRC.r;
    const zz = Math.max(z, SRC_Z + 4);
    return Math.min(d, Math.abs(x - creekX(zz)) - creekHW(zz) + Math.max(0, (SRC_Z + 4 - z)) * 0.9);
  }
  // a slightly better distance: account for the local slope of the centre line
  const dx = (creekX(z + 1) - creekX(z - 1)) * 0.5;
  return Math.abs(x - creekX(z)) / Math.sqrt(1 + dx * dx) - creekHW(z);
}
export const creekDir = (z) => {
  const dx = (creekX(z + 1) - creekX(z - 1)) * 0.5;
  const l = Math.hypot(dx, 1);
  return { x: dx / l, z: 1 / l }; // downstream
};

// the peach forest: "夹岸数百步" along both banks
export const FOREST = { z0: 64, z1: 385, band: 34 };
export function forestMask(x, z) {
  const along = smoothstep(FOREST.z0 - 10, FOREST.z0 + 4, z) * (1 - smoothstep(FOREST.z1 - 6, FOREST.z1 + 14, z));
  const d = creekDist(x, z);
  return along * (1 - smoothstep(FOREST.band - 8, FOREST.band + 6, d));
}

// ---------------------------------------------------------------- basin
export const BASIN = { cx: 12, cz: -250, a: 250, b: 215 };
export const basinR = (x, z) => Math.hypot((x - BASIN.cx) / BASIN.a, (z - BASIN.cz) / BASIN.b);
// the south cliff face of the ring: the spring and the small cave mouth sit at its foot
const SOUTH_FACE = 1.335;

// ---------------------------------------------------------------- tunnel
// floor centre line, south (outside) mouth to north (basin) mouth
export const TUNNEL = [
  [4.0, 8.35, 37.5],
  [4.6, 8.5, 33.5],
  [4.4, 8.9, 26],
  [2.2, 9.6, 16],
  [-0.4, 10.4, 5],
  [-2.2, 11.3, -6],
  [-2.6, 12.3, -17],
  [-1.2, 13.4, -27],
  [-1.6, 14.6, -35],
  [-2.4, 15.3, -41],
  [-2.8, 15.5, -45.5],
];
export const EXIT = { x: -2.8, y: 15.5, z: -45.5 };
export const ENTRY = { x: 4.0, y: 8.35, z: 37.5 };

// ---------------------------------------------------------------- basin plan
export const POND = { x: -74, z: -206, rx: 30, rz: 19, rot: 0.35 };
// the village itself is planned in villageplan.js; these are the few places the rest of the basin needs to know
export const VILLAGE = { x0: -20, x1: 120, z0: -205, z1: -304, cx: 50, cz: -255 };
export const BIG_TREE = { x: -8.4, z: -210.3 };  // the old tree at the village gate where the elders sit
export const THRESH = { x: 41.9, z: -219.6, r: 10 };  // threshing floor, bare in spring

// 阡陌: north-south and east-west field paths
export const PATHS_NS = [-150, -104, -56, 0, 52, 104, 152];
export const PATHS_EW = [-96, -132, -168, -202];
export const FIELD_BOUNDS = { x0: -176, x1: 196, z0: -84, z1: -202 };

// the path down from the cave mouth to the fields (x, z); heights come from the terrain
export const DESCENT = [
  [-2.8, -45.5], [-3.6, -50], [-8.5, -54.5], [-9.5, -59], [-3.5, -63.5], [2.5, -67], [1.5, -72.5],
  [-1, -78], [0, -86], [0, -96],
];
const descentY = [15.5, 15.4, 13.8, 12.2, 10.2, 8.2, 6.0, 3.6, 1.2, 0.35];

// canals: from the northern hills into the pond, and along the fields
export const CANALS = [
  [[-120, -392], [-112, -350], [-102, -300], [-92, -258], [-84, -226]],
  [[-48, -200], [-26, -184], [-4, -168], [30, -168], [80, -168], [130, -168]],
  [[-78, -188], [-92, -150], [-104, -132], [-104, -96]],
];

// ---------------------------------------------------------------- helpers
function distSeg(px, pz, ax, az, bx, bz) {
  const vx = bx - ax, vz = bz - az;
  const t = clamp(((px - ax) * vx + (pz - az) * vz) / (vx * vx + vz * vz), 0, 1);
  return [Math.hypot(px - ax - vx * t, pz - az - vz * t), t];
}
export function polyDist(poly, x, z) {
  let best = 1e9, bi = 0, bt = 0;
  for (let i = 0; i < poly.length - 1; i++) {
    const [d, t] = distSeg(x, z, poly[i][0], poly[i][1], poly[i + 1][0], poly[i + 1][1]);
    if (d < best) { best = d; bi = i; bt = t; }
  }
  return { d: best, i: bi, t: bt };
}
export function pondDist(x, z) {
  const c = Math.cos(POND.rot), s = Math.sin(POND.rot);
  const dx = x - POND.x, dz = z - POND.z;
  const u = (dx * c - dz * s) / POND.rx, v = (dx * s + dz * c) / POND.rz;
  const wob = 1 + 0.12 * perlin2(x * 0.05, z * 0.05);
  return (Math.hypot(u, v) - wob) * Math.min(POND.rx, POND.rz);
}
function tunnelNearest(x, z) {
  let best = 1e9, y = 0, t = 0;
  for (let i = 0; i < TUNNEL.length - 1; i++) {
    const a = TUNNEL[i], b = TUNNEL[i + 1];
    const [d, tt] = distSeg(x, z, a[0], a[2], b[0], b[2]);
    if (d < best) { best = d; y = lerp(a[1], b[1], tt); t = (i + tt) / (TUNNEL.length - 1); }
  }
  return { d: best, y, t };
}

// ---------------------------------------------------------------- height field
function ringHeight(x, z) {
  const r = ridge2(x * 0.0052 + 3.1, z * 0.0052 - 1.7, 4);
  const f = fbm2(x * 0.011, z * 0.011, 3);
  // lower behind the village so the far ring sits under the distant ridges like a scroll's middle ground
  const north = smoothstep(-300, -520, z);
  return (70 + 120 * r * r + 25 * f) * (1 - 0.3 * north);
}

function outsideHeight(x, z) {
  const d = creekDist(x, z);
  let y;
  if (d < 0) {
    const w = creekHW(Math.max(z, SRC_Z));
    const u = clamp(-d / Math.max(w, 1), 0, 1);
    y = WATER_OUT - 0.25 - 1.35 * Math.sqrt(u) - 0.25 * fbm2(x * 0.2, z * 0.2, 2);
  } else {
    // low grassy bank, a soft lip, then rolling ground stepping up into hills
    const lip = WATER_OUT + 0.35 + 0.55 * smoothstep(0, 2.2, d);
    const roll = 1.3 * fbm2(x * 0.018, z * 0.018, 3) * smoothstep(3, 20, d);
    const rise = smoothstep(18, 150, d);
    const hills = rise * (14 + 38 * ridge2(x * 0.007 + 8, z * 0.007, 3)) + smoothstep(120, 380, d) * 90 * ridge2(x * 0.004, z * 0.004 + 4, 3);
    y = lip + roll + d * 0.02 + hills;
  }
  // spurs at the bend that keep the peach forest hidden until the boat rounds it
  const spur = (cx, cz, r, h) => h * Math.pow(Math.max(0, 1 - Math.hypot(x - cx, z - cz) / r), 1.6);
  y += spur(-8, 398, 34, 17) + spur(78, 352, 30, 12) + spur(-60, 470, 50, 22);
  return y;
}

// south sector weight (where the outside world meets the ring)
const southness = (x, z) => smoothstep(-0.2, 0.55, (z - BASIN.cz) / Math.max(Math.hypot(x - BASIN.cx, z - BASIN.cz), 1e-3));

// the ring: a gentle forested apron, then mountain masses; spurs reach down into the basin between coves
function ringMass(x, z, r, ca, sa) {
  // ridged noise sampled on a circle varies with the bearing, so its crests run radially: spurs
  const K = 2.4;
  const sp = ridge2(ca * K + 1.7 + r * 0.9, sa * K - 0.6 - r * 0.7, 3);
  const rs = r - 0.14 * (sp - 0.45);
  const apron = 30 * smoothstep(0.8, 1.12, rs) + 6 * fbm2(x * 0.02, z * 0.02, 2) * smoothstep(0.8, 1.0, rs);
  const peakAmp = 95 + 95 * (0.5 + 0.5 * perlin2(ca * 1.2 + 7.3, sa * 1.2 + 2.1) * 1.4);
  const body = peakAmp * Math.pow(smoothstep(0.97, 1.8, rs), 1.15) * (0.6 + 0.6 * sp);
  const gully = 22 * (ridge2(x * 0.012 + 3, z * 0.012 - 8, 3) - 0.35) * smoothstep(0.95, 1.35, rs);
  // lower behind the village so the far ring sits under the distant ridges like a scroll's middle ground
  const north = smoothstep(-300, -520, z);
  return (apron + body + gully) * (1 - 0.3 * north);
}

export function rawHeight(x, z) {
  const r0 = basinR(x, z);
  // the foot of the ring wanders in and out so the basin edge reads as spurs and coves, not a crater wall
  const ang = Math.atan2(x - BASIN.cx, z - BASIN.cz);
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const wob = 0.06 * perlin2(ca * 1.7 + 4, sa * 1.7) + 0.035 * perlin2(ca * 3.3 - 2, sa * 3.3 + 7.7);
  const sw = southness(x, z);
  const nearCave = Math.exp(-Math.pow(x / 60, 2)) * sw;
  const r = r0 * (1 - wob * (1 - nearCave));
  // inside: flat floor, a slight lift toward the apron
  const rim = smoothstep(0.74, 1.0, r);
  let hIn = FLOOR + 8 * Math.pow(rim, 1.7) + rim * 3 * fbm2(x * 0.03, z * 0.03, 3);
  hIn += 0.35 * fbm2(x * 0.02, z * 0.02, 2) * (1 - rim);

  const faceEdge = SOUTH_FACE + 0.012 * perlin2(x * 0.05, 3.3) + 0.05 * (1 - nearCave / Math.max(sw, 1e-3)) * sw;
  // a sheer face only above the cave; away from it the ridge slopes down into the creek world's hills
  const g = Math.exp(-Math.pow(x / 45, 2));
  const cutW = lerp(0.22, 0.035, g), ext = lerp(0.42, 0, g);
  let southCut = 1 - smoothstep(faceEdge - cutW, faceEdge + ext, r0);
  if (r0 > faceEdge - 0.01) southCut *= lerp(1, smoothstep(10, 48, creekDist(x, z)), smoothstep(faceEdge - 0.01, faceEdge + 0.04, r0));
  const outerFall = 1 - smoothstep(1.7, 2.4, r) * 0.45;
  // over the cave the ridge must stay massive, so it's lifted there regardless of the envelope
  const caveMass = nearCave * smoothstep(1.02, 1.1, r0) * (1 - smoothstep(faceEdge - 0.02, faceEdge + 0.002, r0));
  const M = ringMass(x, z, r, ca, sa);
  const hOut = outsideHeight(x, z);
  // elsewhere: the ring, with hills rising far behind it
  const hN = lerp(hIn, hOut, smoothstep(1.4, 2.2, r) * 0.7) + M * outerFall;
  // south: the ring ends in a face at whose foot the creek world begins, exactly
  let ridgeS = Math.max(M * southCut, ringHeight(x, z) * caveMass * 0.85);
  // above the cave: a rock face some thirty metres high, then the ridge climbing back at a walkable pitch
  if (g > 0.01 && r0 < faceEdge + 0.01) {
    const f0 = faceEdge - 0.018;
    const cap = 30 * (1 - smoothstep(f0, faceEdge, r0)) + Math.max(0, f0 - r0) * 215;
    ridgeS = lerp(ridgeS, Math.min(ridgeS, cap), g);
  }
  const hS = lerp(hIn, hOut, smoothstep(1.02, 1.3, r0)) + ridgeS;
  const h = lerp(hN, hS, sw);
  return h;
}

export function height(x, z) {
  let h = rawHeight(x, z);
  const r = basinR(x, z);

  if (r < 1.05) {
    // 阡陌 and 田埂: the field zone is levelled; plots sit a hand below the raised paths and bunds
    const fx = Math.min(x - FIELD_BOUNDS.x0, FIELD_BOUNDS.x1 - x, FIELD_BOUNDS.z0 - z, z - FIELD_BOUNDS.z1);
    if (fx > -4 && r < 0.84) {
      const ridge = 0.3 + 0.04 * perlin2(x * 0.3, z * 0.3);
      const p = fieldAt(x, z);
      let f = ridge;
      if (p) {
        const e = Math.min(x - p.x0, p.x1 - x, z - p.z0, p.z1 - z);
        f = lerp(ridge, p.flooded ? PADDY_Y - 0.13 : 0.1, smoothstep(0.05, 0.6, e));
      }
      h = lerp(h, f, smoothstep(-4, 0, fx) * (1 - smoothstep(0.8, 0.84, r)));
    }
    // pond and canals
    const pd = pondDist(x, z);
    if (pd < 6) {
      const k = smoothstep(6, -2, pd);
      h = lerp(h, POND_Y - 0.25 - 1.3 * smoothstep(0, -12, pd), k);
    }
    for (const c of CANALS) {
      const { d } = polyDist(c, x, z);
      if (d < 2.6) {
        const bed = POND_Y - 0.5;
        h = Math.min(h, lerp(bed, h, smoothstep(0.7, 2.6, d)));
      }
    }
    // cave ledge and the path winding down from it
    const ld = Math.hypot(x - (EXIT.x - 0.3), z - (EXIT.z - 3.2));
    if (ld < 7.5) h = lerp(EXIT.y - 0.12, h, smoothstep(3.4, 7.5, ld));
    const pd2 = polyDist(DESCENT, x, z);
    if (pd2.d < 5) {
      const py = lerp(descentY[pd2.i], descentY[pd2.i + 1], pd2.t) - 0.08;
      h = lerp(py, h, smoothstep(1.3, 5, pd2.d));
    }
  }
  // the spring pool at the foot of the cliff
  const sd = Math.hypot(x - SRC.x, z - SRC.z);
  if (sd < SRC.r + 5) {
    const k = smoothstep(SRC.r + 5, SRC.r - 1, sd);
    h = lerp(h, Math.min(h, WATER_OUT - 0.4 - 1.6 * smoothstep(SRC.r, 0, sd)), k);
  }
  // flat standing ground at the cave's outer mouth
  const ed = Math.hypot(x - ENTRY.x, z - (ENTRY.z + 3));
  if (ed < 4.5 && z > ENTRY.z + 0.5) h = lerp(ENTRY.y - 0.1, h, smoothstep(2, 4.5, ed));
  return h;
}

// where terrain triangles are replaced by the voxel rock of the cave mouths
export const MOUTH_BOXES = [
  { x0: -1.5, x1: 9.5, z0: 33, z1: 40.5 },    // south mouth at the foot of the rock face
  { x0: -8, x1: 3, z0: -47.5, z1: -37 },      // north mouth in the hillside
];
export function inMouthBox(x, z, pad = 0) {
  for (const b of MOUTH_BOXES) if (x > b.x0 + pad && x < b.x1 - pad && z > b.z0 + pad && z < b.z1 - pad) return b;
  return null;
}
export { tunnelNearest };

// the descent path with heights, for walkers
export function descentPoint(t) {
  const n = DESCENT.length - 1;
  const f = clamp(t, 0, 1) * n, i = Math.min(n - 1, Math.floor(f)), u = f - i;
  const x = lerp(DESCENT[i][0], DESCENT[i + 1][0], u), z = lerp(DESCENT[i][1], DESCENT[i + 1][1], u);
  return { x, y: height(x, z), z };
}

// ---------------------------------------------------------------- fields
// each cell between 阡陌 splits into plots; spring only: water, seedlings, green wheat, fresh tilth, greens
export function buildFields() {
  const rng = new Rng(2024);
  const plots = [];
  const xs = [FIELD_BOUNDS.x0, ...PATHS_NS, FIELD_BOUNDS.x1], zs = PATHS_EW;
  for (let i = 0; i < xs.length - 1; i++) {
    const xa = xs[i], xb = xs[i + 1];
    for (let j = 0; j < zs.length - 1; j++) {
      const za = zs[j], zb = zs[j + 1];
      const split = rng.int(1, 3);
      for (let k = 0; k < split; k++) {
        const x0 = lerp(xa, xb, k / split) + 1.1, x1 = lerp(xa, xb, (k + 1) / split) - 1.1;
        const z0 = za - 1.1, z1 = zb + 1.1;
        const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
        if (pondDist(cx, cz) < 10) continue;
        if (basinR(cx, cz) > 0.8) continue;
        if (Math.abs(cx) < 6 && cz > -100) continue;
        const nearVillage = cz < -176 && cx > -30 && cx < 120;
        const r = rng.next();
        let type;
        if (nearVillage) type = r < 0.55 ? 'greens' : r < 0.8 ? 'tilth' : 'seedlings';
        else type = r < 0.36 ? 'paddy' : r < 0.62 ? 'seedlings' : r < 0.82 ? 'wheat' : 'tilth';
        plots.push({ x0, x1, z0: Math.min(z0, z1), z1: Math.max(z0, z1), type, seed: rng.next(), flooded: type === 'paddy' || type === 'seedlings' });
      }
    }
  }
  // the band between the first 陌 and the slope: a few plots near the descent
  for (const [x0, x1] of [[-150, -106], [-102, -58], [-54, -2.2], [2.2, 50], [54, 102], [106, 150]]) {
    const z0 = -94.5, z1 = -86;
    const cx = (x0 + x1) / 2;
    if (basinR(cx, -90) > 0.79) continue;
    plots.push({ x0: x0 + 1, x1: x1 - 1, z0: Math.min(z0, z1), z1: Math.max(z0, z1), type: rng.next() < 0.5 ? 'wheat' : 'seedlings', seed: rng.next(), flooded: false });
  }
  return plots;
}
export const FIELDS = buildFields();
export function fieldAt(x, z) {
  for (const p of FIELDS) if (x > p.x0 && x < p.x1 && z > p.z0 && z < p.z1) return p;
  return null;
}

// zone of a point (for petal masking, audio, etc.)
export function zoneOf(x, y, z) {
  const r = basinR(x, z);
  if (r < 0.99 && z < -30) return 'basin';
  const tn = tunnelNearest(x, z);
  if (tn.d < 3 && y < tn.y + 4 && y > tn.y - 1 && z < 36 && z > -44) return 'tunnel';
  if (forestMask(x, z) > 0.05) return 'forest';
  return 'outside';
}
