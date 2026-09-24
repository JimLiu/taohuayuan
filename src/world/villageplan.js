// 屋舍俨然: the village as data. Where every hall, side house, yard, lane, well and haystack stands,
// and the named places the story needs (the gate and the old tree, the host's yard and porch, the
// spot where the villagers gather). No geometry here: the ground bake and the terrain colours read it
// before any mesh exists, and the camera keys of the village chapters are derived from its anchors.
//
// The village sits on a grid turned 15 degrees east of south (the fronts catch the morning sun and still
// face the cave mouth); u runs along the rows (east-north-east), v toward the fronts (south-south-east).
import { Rng } from '../core/rng.js';
import { PADDY_Y, BIG_TREE, THRESH } from './layout.js';

export const VROT = (15 * Math.PI) / 180;
export const VC = { x: 40, z: -246 };
const CS = Math.cos(VROT), SN = Math.sin(VROT);
export const toWorld = (u, v) => [VC.x + u * CS + v * SN, VC.z - u * SN + v * CS];
export const toLocal = (x, z) => {
  const dx = x - VC.x, dz = z - VC.z;
  return [dx * CS - dz * SN, dx * SN + dz * CS];
};

const PLINTH = 0.32;
export const ROOF = {
  thatch: { pitch: 0.64, th: 0.34 },
  tile: { pitch: 0.5, th: 0.14 },
};

// ---------------------------------------------------------------- households
// hall: u, v, width, depth, wall height, roof, porch depth, detail (0 far, 1 normal, 2 the host's)
// yard: depth in front, enclosure; wings: side houses standing in the yard ('W' / 'E'), one may be the kitchen
const H = (id, u, v, w, d, roof, o = {}) => ({
  id, u, v, w, d, roof, h: o.h ?? 2.7, porch: o.porch ?? 0, detail: o.detail ?? 1,
  yard: o.yard === undefined ? { depth: 6.5, kind: 'wattle' } : o.yard, wings: o.wings ?? [], rot: o.rot ?? 0,
});
export const HOUSES = [
  // row A, facing the fields; the gap in the middle is the threshing floor
  H('A1', -37, 20, 10, 6, 'thatch', { yard: { depth: 6, kind: 'wattle' }, wings: [{ side: 'E', w: 5, d: 3.6, kitchen: true }] }),
  H('A2', 17, 20, 9, 6, 'thatch', { yard: { depth: 5.5, kind: 'wattle' } }),
  H('A3', 34, 20.5, 11.5, 6.8, 'tile', { porch: 1.1, yard: { depth: 7, kind: 'wall' }, wings: [{ side: 'W', w: 5.5, d: 3.8, kitchen: true }] }),
  H('A4', 53, 19.5, 9, 6, 'thatch', { yard: { depth: 6, kind: 'wattle' } }),
  H('A5', 70, 20, 8.5, 5.6, 'thatch', { yard: null, detail: 0 }),
  // row B: the host's household second from the west
  H('B1', -53, 0, 9, 6, 'thatch', { yard: { depth: 6.5, kind: 'wattle' } }),
  H('B2', -32, 0, 11.5, 7, 'thatch', {
    porch: 1.4, detail: 2, h: 2.8,
    yard: { depth: 7.2, kind: 'wattle', gate: 0.62 },
    wings: [{ side: 'W', w: 5.6, d: 3.8, kitchen: true }],
  }),
  H('B3', -9, 0.5, 10, 6.4, 'tile', { yard: { depth: 6.5, kind: 'wall' } }),
  H('B4', 12, -0.5, 10, 6.2, 'thatch', { yard: { depth: 6, kind: 'wattle' }, wings: [{ side: 'E', w: 4.6, d: 3.4, kitchen: true }] }),
  H('B5', 34, 0, 12, 7, 'tile', { porch: 1.2, yard: { depth: 7.5, kind: 'wall' }, wings: [{ side: 'W', w: 5.5, d: 3.8, kitchen: true }, { side: 'E', w: 5.5, d: 3.8 }] }),
  H('B6', 56, 0.5, 9.5, 6, 'thatch', { yard: { depth: 6, kind: 'wattle' } }),
  H('B7', 75, -0.5, 8, 5.6, 'thatch', { yard: { depth: 5, kind: 'wattle' }, detail: 0 }),
  // row C
  H('C1', -45, -22, 9.5, 6, 'thatch', { yard: { depth: 6, kind: 'wattle' }, wings: [{ side: 'E', w: 4.4, d: 3.4, kitchen: true }] }),
  H('C2', -22, -21.5, 10.5, 6.4, 'tile', { yard: { depth: 6.2, kind: 'wall' } }),
  H('C3', 0, -22, 9, 6, 'thatch', { yard: { depth: 6, kind: 'wattle' } }),
  H('C4', 22, -22.5, 11, 6.6, 'thatch', { porch: 1.1, yard: { depth: 6.5, kind: 'wattle' }, wings: [{ side: 'W', w: 4.8, d: 3.5, kitchen: true }] }),
  H('C5', 45, -22, 10, 6.2, 'tile', { yard: { depth: 6.2, kind: 'wall' }, detail: 0 }),
  H('C6', 66, -21.5, 9, 6, 'thatch', { yard: { depth: 5.5, kind: 'wattle' }, detail: 0 }),
  // row D, against the mulberry and bamboo
  H('D1', -30, -44, 9.5, 6, 'thatch', { yard: { depth: 6, kind: 'wattle' }, detail: 0 }),
  H('D2', -7, -44.5, 10, 6.2, 'thatch', { yard: { depth: 6, kind: 'wattle' }, detail: 0, wings: [{ side: 'W', w: 4.4, d: 3.4, kitchen: true }] }),
  H('D3', 16, -44, 9, 6, 'tile', { yard: { depth: 6, kind: 'wall' }, detail: 0 }),
  H('D4', 40, -43.5, 9.5, 6, 'thatch', { yard: { depth: 5.5, kind: 'wattle' }, detail: 0 }),
];
{
  const r = new Rng(88);
  for (const h of HOUSES) {
    h.seed = r.next();
    h.rot = h.rot || (r.next() - 0.5) * 0.035; // the odd hall set a degree off the line
    h.h = h.h + (h.detail === 2 ? 0 : (r.next() - 0.5) * 0.3);
  }
}

// every building as one unit in its own frame (x along the front, z out of the front):
// cu, cv its centre in village coordinates, rot its turn within the village frame
export const UNITS = [];
export const YARDS = [];
export const CHIMNEYS = [];
for (const h of HOUSES) {
  // a porch needs headroom under the front eave, so those halls get a lower pitch
  const pitch = h.porch > 0 ? (h.roof === 'thatch' ? 0.56 : 0.48) : ROOF[h.roof].pitch;
  const hall = { house: h, kind: 'hall', cu: h.u, cv: h.v, rot: h.rot, w: h.w, d: h.d, h: h.h, roof: h.roof, pitch, porch: h.porch, detail: h.detail, seed: h.seed };
  UNITS.push(hall);
  const P = h.porch;
  if (h.yard) {
    const yw = h.w + 1.2;
    YARDS.push({ house: h, u0: h.u - yw / 2, u1: h.u + yw / 2, v0: h.v + h.d / 2 + P + 0.25, v1: h.v + h.d / 2 + P + h.yard.depth, kind: h.yard.kind, gate: h.yard.gate ?? 0.5 + (h.seed - 0.5) * 0.4 });
  }
  for (const wg of h.wings) {
    const yw = h.w + 1.2;
    const s = wg.side === 'W' ? -1 : 1;
    // the wing stands in the yard against its side, gable toward the hall, its front facing across the yard
    const cu = h.u + s * (yw / 2 - wg.d / 2 - 0.25);
    const cv = h.v + h.d / 2 + P + 0.6 + wg.w / 2;
    const u = { house: h, kind: wg.kitchen ? 'kitchen' : 'wing', cu, cv, rot: h.rot + (s < 0 ? Math.PI / 2 : -Math.PI / 2), w: wg.w, d: wg.d, h: 2.3, roof: h.roof, pitch: ROOF[h.roof].pitch * 0.92, porch: 0, detail: h.detail, seed: h.seed * 7.3 % 1 };
    UNITS.push(u);
    if (wg.kitchen) {
      // the stove's flue rises through the back of the kitchen at the gable away from the hall
      const lx = s * (wg.w / 2 - 0.7), lz = -wg.d / 2 + 0.3;
      const [uu, vv] = unitToVillage(u, lx, lz);
      CHIMNEYS.push({ house: h, u: uu, v: vv, lx, lz, unit: u, top: PLINTH + u.h + (wg.d / 2) * Math.tan(u.pitch) + 0.75 });
    }
  }
}
export function unitToVillage(unit, x, z) {
  const c = Math.cos(unit.rot), s = Math.sin(unit.rot);
  return [unit.cu + x * c + z * s, unit.cv - x * s + z * c];
}
export function villageToUnit(unit, u, v) {
  const du = u - unit.cu, dv = v - unit.cv, c = Math.cos(unit.rot), s = Math.sin(unit.rot);
  return [du * c - dv * s, du * s + dv * c];
}
export const unitWorldRot = (unit) => VROT + unit.rot;
export const ridgeY = (unit) => PLINTH + unit.h + (unit.d / 2) * Math.tan(unit.pitch) + ROOF[unit.roof].th + 0.25;
export const unitBox = (unit) => ({ x0: -unit.w / 2 - 0.9, x1: unit.w / 2 + 0.9, z0: -unit.d / 2 - 0.9, z1: unit.d / 2 + unit.porch + 0.9 });
export { PLINTH };

// ---------------------------------------------------------------- lanes, the square, wells, stacks
// (village coordinates; the main lane comes in from the field path by the old tree)
const LANES_UV = [
  [[-50, 31.5], [-46, 22], [-44, 14.3], [-10, 14.6], [8, 14.4], [40, 14.2], [82, 14]],
  [[-60, -8], [-20, -8.2], [20, -8], [60, -7.8], [82, -8]],
  [[-50, -30], [0, -30.3], [50, -30], [58, -30]],
  [[-42.6, 14.3], [-42.6, -8]],
  [[-55, -8], [-55.5, -30], [-50, -30]],
  [[-20.5, 14.5], [-20.5, -8.2]],
  [[25.2, 30], [25, 14.2], [25, -8], [33.5, -12], [33.5, -30]],
  [[65.5, 14], [65.5, -7.8]],
  [[55.5, -7.9], [55.5, -30]],
];
export const LANES = LANES_UV.map((l) => l.map(([u, v]) => toWorld(u, v)));
export const LANES_LOCAL = LANES_UV;
export const WELLS = [[1.2, 10.8], [-45.5, -10.4]].map(([u, v]) => ({ u, v, p: toWorld(u, v) }));
export const STACKS = [[-47, -14.5, 1.8], [4, -35.8, 1.5], [60, -13.6, 1.6], [12, 34, 2.1], [-18, 34, 1.7], [30, -35, 1.4]]
  .map(([u, v, r]) => ({ u, v, r, p: toWorld(u, v) }));
export const THRESH_UV = toLocal(THRESH.x, THRESH.z);

// ---------------------------------------------------------------- named places
const host = HOUSES.find((h) => h.id === 'B2');
const hostYard = YARDS.find((y) => y.house === host);
const W3 = (u, v, y) => { const [x, z] = toWorld(u, v); return [x, y, z]; };
export const ANCHORS = {
  tree: [BIG_TREE.x, 0, BIG_TREE.z],       // the old tree where the lane comes in from the fields
  gate: W3(-47, 25, 0),                    // the entrance to the village
  hostHall: W3(host.u, host.v, 0),
  hostDoor: W3(host.u, host.v + host.d / 2, 0),
  hostPorch: W3(host.u, host.v + host.d / 2 + host.porch * 0.55, PLINTH),
  hostYard: W3(host.u + 0.8, (hostYard.v0 + hostYard.v1) / 2, 0),
  hostGate: W3(hostYard.u0 + (hostYard.u1 - hostYard.u0) * hostYard.gate, hostYard.v1, 0),
  hostKitchen: W3(...unitToVillage(UNITS.find((u) => u.house === host && u.kind === 'kitchen'), 0, 1.9), 0),
  gather: W3(hostYard.u0 + (hostYard.u1 - hostYard.u0) * hostYard.gate + 3, 14.4, 0), // in the lane before the host's gate
  thresh: W3(THRESH_UV[0], THRESH_UV[1], 0),
};
// village-local helpers for placing cameras relative to the host's yard
export const hostUV = { u: host.u, v: host.v, d: host.d, porch: host.porch, yard: hostYard };
export const at = W3;

// ---------------------------------------------------------------- queries (ground bake, terrain colour, cameras)
export function unitAt(x, z, pad = 0) {
  const [u, v] = toLocal(x, z);
  for (const un of UNITS) {
    const [lx, lz] = villageToUnit(un, u, v);
    if (lx > -un.w / 2 - 0.4 - pad && lx < un.w / 2 + 0.4 + pad && lz > -un.d / 2 - 0.4 - pad && lz < un.d / 2 + un.porch + 0.15 + pad) return un;
  }
  return null;
}
export function yardAt(x, z, pad = 0) {
  const [u, v] = toLocal(x, z);
  for (const y of YARDS) if (u > y.u0 - pad && u < y.u1 + pad && v > y.v0 - pad && v < y.v1 + pad) return y;
  return null;
}
function segDist(px, pz, a, b) {
  const vx = b[0] - a[0], vz = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((px - a[0]) * vx + (pz - a[1]) * vz) / (vx * vx + vz * vz)));
  return Math.hypot(px - a[0] - vx * t, pz - a[1] - vz * t);
}
export function laneDist(x, z) {
  const [u, v] = toLocal(x, z);
  if (u < -75 || u > 95 || v < -45 || v > 45) return 1e9;
  let d = 1e9;
  for (const l of LANES_UV) for (let i = 0; i < l.length - 1; i++) d = Math.min(d, segDist(u, v, l[i], l[i + 1]));
  return d;
}
// the village ground: 1 inside a building, 0.8 in a yard, lanes by distance; for the grass and the earth colour
export function builtAt(x, z) {
  const [u, v] = toLocal(x, z);
  if (u < -80 || u > 100 || v < -60 || v > 50) return { house: null, yard: null, lane: 1e9 };
  return { house: unitAt(x, z, 0.3), yard: yardAt(x, z, 0.2), lane: laneDist(x, z) };
}

// segment (world) against every building's box: the ids of what stands in the way
export function sightBlocked(p, l) {
  const hits = [];
  const [pu, pv] = toLocal(p[0], p[2]), [lu, lv] = toLocal(l[0], l[2]);
  for (const un of UNITS) {
    const [ax, az] = villageToUnit(un, pu, pv), [bx, bz] = villageToUnit(un, lu, lv);
    const b = unitBox(un), top = ridgeY(un);
    // slab test in (x, y, z)
    let t0 = 0, t1 = 1;
    const A = [ax, p[1], az], B = [bx, l[1], bz], lo = [b.x0, -1, b.z0], hi = [b.x1, top, b.z1];
    let ok = true;
    for (let k = 0; k < 3 && ok; k++) {
      const d = B[k] - A[k];
      if (Math.abs(d) < 1e-9) { if (A[k] < lo[k] || A[k] > hi[k]) ok = false; continue; }
      let ta = (lo[k] - A[k]) / d, tb = (hi[k] - A[k]) / d;
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      if (t0 > t1) ok = false;
    }
    if (ok) hits.push(`${un.house.id}${un.kind === 'hall' ? '' : ':' + un.kind}@${t0.toFixed(2)}`);
  }
  return hits;
}

// sanity: nothing may stand in the fields, the pond or the lanes (checked in the console)
export function planReport(fieldAt, pondDist) {
  const bad = [];
  for (const un of UNITS) {
    const b = unitBox(un);
    for (const [x, z] of [[b.x0, b.z0], [b.x1, b.z0], [b.x0, b.z1], [b.x1, b.z1]]) {
      const [u, v] = unitToVillage(un, x, z), [wx, wz] = toWorld(u, v);
      if (fieldAt(wx, wz) || wz > -205 || pondDist(wx, wz) < 3) bad.push(`${un.house.id}:${un.kind} corner in field/pond at ${wx.toFixed(1)},${wz.toFixed(1)}`);
      if (laneDist(wx, wz) < 1.2) bad.push(`${un.house.id}:${un.kind} on a lane at ${wx.toFixed(1)},${wz.toFixed(1)}`);
    }
  }
  for (const y of YARDS) {
    for (const [u, v] of [[y.u0, y.v0], [y.u1, y.v0], [y.u0, y.v1], [y.u1, y.v1]]) {
      const [wx, wz] = toWorld(u, v);
      if (fieldAt(wx, wz) || wz > -205) bad.push(`${y.house.id} yard corner in the fields at ${wx.toFixed(1)},${wz.toFixed(1)}`);
      if (laneDist(wx, wz) < 1.0) bad.push(`${y.house.id} yard corner on a lane at ${wx.toFixed(1)},${wz.toFixed(1)}`);
    }
  }
  for (const s of [...STACKS, ...WELLS.map((w) => ({ ...w, r: 0.8 }))]) {
    const r = s.r ?? 0.8;
    if (unitAt(s.p[0], s.p[1], r)) bad.push(`stack/well ${s.u},${s.v} in a building`);
    if (laneDist(s.p[0], s.p[1]) < r + 1.2) bad.push(`stack/well ${s.u},${s.v} on a lane`);
    if (fieldAt(s.p[0], s.p[1])) bad.push(`stack/well ${s.u},${s.v} in the fields`);
  }
  // buildings overlapping each other (other than a hall and its own wings, which touch)
  for (let i = 0; i < UNITS.length; i++)
    for (let j = i + 1; j < UNITS.length; j++) {
      const a = UNITS[i], b = UNITS[j];
      if (a.house === b.house) continue;
      const d = Math.hypot(a.cu - b.cu, a.cv - b.cv);
      if (d < (Math.max(a.w, a.d) + Math.max(b.w, b.d)) / 2 + 0.5) bad.push(`${a.house.id}/${b.house.id} close: ${d.toFixed(1)}`);
    }
  return bad;
}
export const PADDY = PADDY_Y;
