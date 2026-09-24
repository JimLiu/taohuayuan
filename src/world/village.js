// 屋舍俨然: the village built from the plan. Rammed-earth walls in 0.33 m pours, timber fronts with lattice
// windows, thatch in grey-brown courses (a few better-off households under grey tile), wattle fences and
// brushwood gates, woodpiles, jars and tools. Everything is boxes on one geometry, one draw call.
import * as THREE from 'three';
import { Blocks, blocksMaterial, MAT, FLAG } from '../core/blocks.js';
import { Rng } from '../core/rng.js';
import { height } from './layout.js';
import {
  VC, VROT, UNITS, YARDS, WELLS, STACKS, CHIMNEYS, ROOF, PLINTH, THRESH_UV, toWorld, hostUV,
} from './villageplan.js';

const C = (hex) => new THREE.Color().setHex(hex, THREE.SRGBColorSpace);
const COL = {
  earth: [0x9b866c, 0xa38e74, 0x927f68, 0xa8957b],
  mud: 0xa38e72,        // mud plaster on wattle infill
  lime: 0xd2cab9,       // lime wash on the better houses
  post: 0x4e3d30,
  board: 0x6a5644,
  door: 0x57432f,
  stone: 0x8b887f,
  step: 0x98948a,
  thatch: [0x7b6f5c, 0x6f6553, 0x857863, 0x746a58],
  tile: [0x57585a, 0x5f5f60, 0x505153],
  bark: 0x5b4a3a,
  stick: 0x6d5c48,
  logs: 0x8a7253,
  jar: 0x4a3a2e,
  basket: 0x9a8662,
  cloth: [0x44506a, 0xb3aa94, 0x6c5a4a, 0x5d6b5a],
  straw: 0x8a7e66,
  mat: 0x9f906f,
  water: 0x1c2226,
};

// ---------------------------------------------------------------- one building in its own frame
function buildUnit(B, un, rng, lit) {
  const { w, d, h, porch, detail, pitch } = un;
  const R = ROOF[un.roof];
  const tp = Math.tan(pitch), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const P = PLINTH, t = 0.45;
  const y0 = P + h, Yr = y0 + (d / 2) * tp;
  const hall = un.kind === 'hall';
  const wallC = C(COL.earth[Math.floor(un.seed * 4) % 4]);
  const tiled = un.roof === 'tile';

  // plinth and step
  B.box(0, P / 2 - 0.2, porch / 2, w + 0.5, P + 0.4, d + 0.5 + porch, COL.stone, MAT.stone, { jit: 0.1 });
  if (hall) B.box(0, P * 0.3 - 0.1, d / 2 + porch + 0.45, 1.8, P * 0.6 + 0.2, 0.5, COL.step, MAT.stone);

  // rammed-earth back and side walls; the gables are two slabs cut along the roof line, sunk into the wall below
  B.box(0, P + h / 2, -d / 2 + t / 2, w, h, t, wallC, MAT.earth, { flags: FLAG.eave });
  for (const s of [-1, 1]) {
    B.box(s * (w / 2 - t / 2), P + h / 2, t / 2, t, h, d - t, wallC, MAT.earth, { flags: FLAG.eave });
    const D = (d / 2) * sp + 0.15, Ls = (d / 2) / cp;
    for (const f of [1, -1]) {
      // top face along the roof's underside from the ridge point down to the wall top
      const cz = f * ((Ls / 2) * cp - (D / 2) * sp), cy = Yr - (Ls / 2) * sp - (D / 2) * cp;
      B.box(s * (w / 2 - t / 2), cy, cz, t - (f > 0 ? 0.02 : 0.03), D, Ls, wallC, MAT.earth, { rx: pitch, ry: f < 0 ? Math.PI : 0, skip: [] });
    }
  }

  // the timber front: infill, posts, beam, sill; a door in the middle bay, lattice windows either side
  const zf = d / 2;
  const inW = w - 2 * t;
  const bays = w >= 8.5 ? 3 : 2;
  const mid = bays === 3 ? Math.min(2.6, inW * 0.38) : inW * 0.5;
  const postX = bays === 3 ? [-w / 2 + t / 2, -mid / 2, mid / 2, w / 2 - t / 2] : [-w / 2 + t / 2, (un.seed - 0.5) * 0.6, w / 2 - t / 2];
  B.box(0, P + h / 2, zf - 0.16, inW + 0.02, h, 0.14, tiled ? COL.lime : COL.mud, MAT.plaster, { flags: FLAG.eave });
  for (const x of postX) B.box(x, P + h / 2, zf - 0.07, 0.22, h, 0.2, COL.post, MAT.wood);
  B.box(0, y0 - 0.14, zf - 0.05, w - 0.1, 0.28, 0.24, COL.post, MAT.wood);
  B.box(0, P + 0.08, zf - 0.07, inW, 0.16, 0.2, COL.post, MAT.wood);
  const doorX = bays === 3 ? 0 : (postX[0] + postX[1]) / 2;
  const dw = hall ? (detail === 2 ? 1.55 : 1.35) : 1.0, dh = Math.min(2.1, h - 0.45);
  const open = detail === 2 || rng.chance(0.45);
  if (open) B.box(doorX, P + dh / 2 + 0.16, zf - 0.075, dw, dh, 0.1, 0, MAT.door, { flags: lit ? FLAG.lit : 0, skip: ['-y', '-z'] });
  else for (const s of [-1, 1]) B.box(doorX + s * dw / 4, P + dh / 2 + 0.16, zf - 0.07, dw / 2 - 0.012, dh, 0.08, COL.door, MAT.wood, { jit: 0.1 });
  // door frame
  for (const s of [-1, 1]) B.box(doorX + s * (dw / 2 + 0.05), P + dh / 2 + 0.16, zf - 0.04, 0.1, dh, 0.14, COL.post, MAT.wood);
  B.box(doorX, P + dh + 0.22, zf - 0.04, dw + 0.3, 0.12, 0.14, COL.post, MAT.wood);
  // windows
  const winX = bays === 3 ? [-(mid / 2 + (w / 2 - t - mid / 2) / 2), mid / 2 + (w / 2 - t - mid / 2) / 2] : [(postX[1] + postX[2]) / 2];
  const ww = bays === 3 ? Math.min(1.2, (w / 2 - t - mid / 2) * 0.6) : 0.8, wh = 0.8, wy = P + 1.55;
  for (const x of winX) {
    B.box(x, wy, zf - 0.075, ww, wh, 0.08, COL.post, MAT.window, { flags: lit ? FLAG.lit : 0, skip: ['-y', '-z'] });
    if (detail > 0) {
      B.box(x, wy + wh / 2 + 0.04, zf - 0.04, ww + 0.2, 0.08, 0.12, COL.post, MAT.wood);
      B.box(x, wy - wh / 2 - 0.05, zf - 0.02, ww + 0.24, 0.08, 0.18, COL.post, MAT.wood);
      for (const s of [-1, 1]) B.box(x + s * (ww / 2 + 0.04), wy, zf - 0.04, 0.07, wh, 0.12, COL.post, MAT.wood);
    }
  }
  // a small high vent in the back wall
  if (detail > 0 && hall) B.box(w * (un.seed - 0.5) * 0.4, y0 - 0.65, -d / 2 - 0.005, 0.55, 0.36, 0.04, COL.post, MAT.window, { flags: lit ? FLAG.lit : 0 });

  // porch posts and beam, under the front eave
  if (porch > 0) {
    const zp = zf + porch - 0.18;
    const yu = y0 - (porch - 0.18) * tp;
    for (const x of postX) {
      B.box(x, P + (yu - P) / 2, zp, 0.2, yu - P, 0.2, COL.post, MAT.wood);
      B.box(x, P + 0.06, zp, 0.36, 0.12, 0.36, COL.step, MAT.stone);
    }
    B.box(0, yu - 0.13, zp, w - 0.1, 0.26, 0.22, COL.post, MAT.wood);
    // tie beams from the porch posts back to the front wall
    for (const x of postX) B.box(x, yu - 0.1, zf + (porch - 0.18) / 2, 0.14, 0.16, porch - 0.18, COL.post, MAT.wood);
  }

  // roof: two slabs whose undersides pass through the ridge point, a cap over the V between them
  const o = tiled ? 0.55 : 0.72, ov = tiled ? 0.38 : 0.5, th = R.th;
  const W = w + 2 * ov;
  const roofC = C(tiled ? COL.tile[Math.floor(un.seed * 3) % 3] : COL.thatch[Math.floor(un.seed * 4) % 4]);
  const rmat = tiled ? MAT.tile : MAT.thatch;
  for (const f of [1, -1]) {
    const L = (d / 2 + (f > 0 ? porch : 0) + o) / cp;
    const cz = f * ((L / 2) * cp + (th / 2) * sp), cy = Yr - (L / 2) * sp + (th / 2) * cp;
    B.box(0, cy, cz, W, th, L, roofC, rmat, { rx: pitch, ry: f < 0 ? Math.PI : 0, skip: [] });
    if (!tiled && detail > 0) {
      // the thatch eave is thicker: a roll of straw along the lower edge
      const e = L - 0.2;
      const ez = f * (e * cp + 0.12 * sp), ey = Yr - e * sp + 0.02;
      B.box(0, ey, ez, W + 0.04, 0.3, 0.42, roofC, MAT.thatch, { rx: pitch, ry: f < 0 ? Math.PI : 0, skip: [] });
    }
  }
  if (tiled) {
    B.box(0, Yr + th * cp - 0.02, 0, W - 0.1, 0.26, 2 * th * sp + 0.34, C(0x3f4246), MAT.tile, { skip: [] });
    for (const s of [-1, 1]) B.box(s * (W / 2 - 0.2), Yr + th * cp + 0.2, 0, 0.3, 0.2, 0.42, C(0x3f4246), MAT.plain);
  } else {
    B.box(0, Yr + th * cp - 0.06, 0, W - 0.2, 0.42, 2 * th * sp + 0.46, roofC.clone().multiplyScalar(0.9), MAT.thatch, { skip: [] });
  }

  // rafter ends under the host's eaves (the low cameras see them)
  if (detail === 2) {
    for (const f of [1, -1]) {
      const zz = f * (d / 2 + (f > 0 ? porch : 0) + o * 0.5);
      const yy = y0 - (zz * f - d / 2) * tp - 0.06;
      for (let x = -W / 2 + 0.3; x < W / 2 - 0.2; x += 0.5) B.box(x, yy, zz, 0.08, 0.08, o + 0.2, COL.post, MAT.wood, { rx: f * pitch });
    }
  }
}

// ---------------------------------------------------------------- small things
function octo(B, x, y, z, r, hgt, col, mat, o = {}) {
  // a stepped round from three overlapping boxes, their tops a hair apart so they never fight
  const c = typeof col === 'number' ? C(col) : col.clone();
  if (o.jit) c.multiplyScalar(1 + (B.rng.next() - 0.5) * o.jit);
  const q = { ...o, jit: 0 };
  B.box(x, y + hgt / 2, z, 2 * r, hgt, 1.2 * r, c, mat, q);
  B.box(x, y + (hgt - 0.006) / 2, z, 1.2 * r, hgt - 0.006, 2 * r, c, mat, q);
  B.box(x, y + (hgt - 0.012) / 2, z, 1.7 * r, hgt - 0.012, 1.7 * r, c, mat, q);
}
function jar(B, x, z, s, rng) {
  octo(B, x, 0, z, 0.36 * s, 0.5 * s, COL.jar, MAT.plain, { jit: 0.15 });
  octo(B, x, 0.5 * s, z, 0.3 * s, 0.14 * s, COL.jar, MAT.plain);
  if (rng.chance(0.5)) B.box(x, 0.62 * s, z, 0.4 * s, 0.02, 0.4 * s, COL.water, MAT.plain);
}
function woodpile(B, x, z, len, ry = 0) {
  B.push(x, 0, z, ry);
  B.box(0, 0.5, 0, len, 1.0, 0.62, COL.logs, MAT.logs, { jit: 0.12 });
  B.box(0, 1.06, 0, len + 0.2, 0.1, 0.8, COL.bark, MAT.bark);   // bark slabs laid over the top
  B.pop();
}
function tool(B, x, z, ry, kind, rng) {
  // a hoe or a spade leaning back against a wall at local -z
  B.push(x, 0, z, ry);
  const lean = 0.28 + rng.next() * 0.08;
  B.box(0, 0.72, -0.12, 0.045, 1.5, 0.045, COL.stick, MAT.wood, { rx: -lean });
  if (kind === 0) B.box(0, 0.06, 0.12, 0.2, 0.03, 0.22, 0x4d4a47, MAT.plain, { rx: -lean });
  else B.box(0, 0.12, 0.08, 0.2, 0.26, 0.03, 0x4d4a47, MAT.plain, { rx: -lean });
  B.pop();
}
function basket(B, x, z, s = 1) {
  octo(B, x, 0, z, 0.26 * s, 0.3 * s, COL.basket, MAT.bark, { jit: 0.15 });
}
function rack(B, x, z, ry, rng) {
  // 晾架: two crossed-leg trestles and a bamboo pole, with cloth or greens hung to dry
  B.push(x, 0, z, ry);
  for (const e of [-1.3, 1.3]) for (const s of [-1, 1]) B.box(e, 0.8, s * 0.2, 0.05, 1.7, 0.05, COL.stick, MAT.wood, { rx: s * 0.26 });
  B.box(0, 1.55, 0, 2.8, 0.05, 0.05, 0x8d8a5c, MAT.wood);
  for (let i = 0; i < 3; i++) {
    const x2 = -0.8 + i * 0.8 + (rng.next() - 0.5) * 0.3;
    const c = rng.pick(COL.cloth), l = 0.5 + rng.next() * 0.4;
    B.box(x2, 1.55 - l / 2, 0, 0.55, l, 0.02, c, MAT.plain, { skip: ['-y'] });
  }
  B.pop();
}
function coop(B, x, z, ry) {
  B.push(x, 0, z, ry);
  B.box(0, 0.4, 0, 1.0, 0.8, 0.8, COL.board, MAT.wood);
  B.box(0, 0.25, 0.405, 0.3, 0.3, 0.02, 0x241c16, MAT.plain);
  B.box(0, 0.92, 0, 1.25, 0.18, 1.05, C(COL.thatch[1]), MAT.thatch, { rx: -0.2 });
  B.pop();
}
function mill(B, x, z) {
  octo(B, x, 0, z, 0.55, 0.5, COL.stone, MAT.stone);
  octo(B, x, 0.5, z, 0.46, 0.22, COL.stone, MAT.stone);
  octo(B, x, 0.72, z, 0.44, 0.2, COL.step, MAT.stone);
  B.box(x + 0.5, 0.85, z, 0.5, 0.05, 0.05, COL.stick, MAT.wood);
}

// ---------------------------------------------------------------- fences and yard walls (village frame: x = u, z = v)
function stickRun(B, x0, z0, x1, z1, rng, sparse, gap = null) {
  const L = Math.hypot(x1 - x0, z1 - z0), dx = (x1 - x0) / L, dz = (z1 - z0) / L;
  const ry = Math.atan2(dx, dz) - Math.PI / 2;  // local x along the run
  B.push(x0, 0, z0, ry);
  const inGap = (s) => gap && s > gap[0] && s < gap[1];
  // posts and two rails
  const np = Math.max(1, Math.round(L / 1.6));
  for (let i = 0; i <= np; i++) {
    const s = (i / np) * L;
    if (inGap(s)) continue;
    B.box(s, 0.62, 0, 0.09, 1.3, 0.09, COL.bark, MAT.bark, { rz: (rng.next() - 0.5) * 0.06, jit: 0.2 });
  }
  const segs = gap ? [[0, gap[0]], [gap[1], L]] : [[0, L]];
  for (const [a, b] of segs) {
    if (b - a < 0.05) continue;
    for (const y of [0.34, 0.86]) B.box((a + b) / 2, y, 0.05, b - a, 0.045, 0.045, COL.stick, MAT.wood);
    const sp = sparse ? 0.3 : 0.13;
    for (let s = a + sp / 2; s < b; s += sp * (0.8 + rng.next() * 0.4)) {
      const hh = 0.9 + rng.next() * 0.3;
      B.box(s, hh / 2, -0.03 + (rng.next() - 0.5) * 0.04, 0.035, hh, 0.035, COL.stick, MAT.wood, { rz: (rng.next() - 0.5) * 0.12, jit: 0.3 });
    }
  }
  B.pop();
}
function earthWallRun(B, x0, z0, x1, z1, rng, sparse, gap = null) {
  const L = Math.hypot(x1 - x0, z1 - z0), dx = (x1 - x0) / L, dz = (z1 - z0) / L;
  const ry = Math.atan2(dx, dz) - Math.PI / 2;
  B.push(x0, 0, z0, ry);
  const wc = C(COL.earth[rng.int(0, 3)]), cap = C(COL.thatch[rng.int(0, 3)]);
  const segs = gap ? [[0, gap[0]], [gap[1], L]] : [[0, L]];
  for (const [a, b] of segs) {
    if (b - a < 0.05) continue;
    B.box((a + b) / 2, 0.78, 0, b - a, 1.56, 0.38, wc, MAT.earth);
    for (const s of [-1, 1]) B.box((a + b) / 2, 1.6, s * 0.14, b - a + 0.06, 0.1, 0.34, cap, MAT.thatch, { rx: s * 0.45 });
  }
  B.pop();
}
// 柴门: two posts, and a gate of brushwood on two rails, swung open by `ang`
function gate(B, x, z, ry, width, ang, rng, wall) {
  B.push(x, 0, z, ry);
  for (const s of [-1, 1]) B.box(s * (width / 2 + 0.06), 0.9, 0, 0.13, 1.8, 0.13, COL.bark, MAT.bark);
  if (wall) {
    // a lintel and a small thatched hood over the gateway in an earth wall
    B.box(0, 1.86, 0, width + 0.5, 0.12, 0.16, COL.post, MAT.wood);
    for (const s of [-1, 1]) B.box(0, 2.08, s * 0.22, width + 0.9, 0.12, 0.5, C(COL.thatch[0]), MAT.thatch, { rx: s * 0.5 });
  }
  B.push(-width / 2, 0, 0, ang);   // swung in, toward the yard
  for (const y of [0.3, 0.95]) B.box(width / 2, y, 0.02, width - 0.06, 0.05, 0.05, COL.stick, MAT.wood);
  B.box(width / 2, 0.62, 0.02, width * 1.08, 0.05, 0.05, COL.stick, MAT.wood, { rz: Math.atan2(0.65, width) });
  for (let s = 0.08; s < width - 0.05; s += 0.11) {
    const hh = 1.1 + rng.next() * 0.25;
    B.box(s, hh / 2 + 0.05, 0.06, 0.03, hh, 0.03, COL.stick, MAT.wood, { rz: (rng.next() - 0.5) * 0.08, jit: 0.3 });
  }
  B.pop();
  B.pop();
}

// ---------------------------------------------------------------- the whole village
export function buildVillage() {
  const B = new Blocks(311);
  const rng = new Rng(1717);
  const ground = (u, v) => { const [x, z] = toWorld(u, v); return height(x, z); };

  // the village frame: x = u, z = v
  B.push(VC.x, 0, VC.z, VROT);

  for (const un of UNITS) {
    // base: the lowest ground under the footprint (the plinth goes into the ground anyway)
    const c = Math.cos(un.rot), s = Math.sin(un.rot);
    let base = 1e9;
    for (const [lx, lz] of [[-un.w / 2, -un.d / 2], [un.w / 2, -un.d / 2], [-un.w / 2, un.d / 2], [un.w / 2, un.d / 2], [0, 0]])
      base = Math.min(base, ground(un.cu + lx * c + lz * s, un.cv - lx * s + lz * c));
    un.base = base;
    B.base = base;
    const lit = un.house.detail === 2 || un.kind === 'kitchen' || rng.chance(0.7);
    B.push(un.cu, base, un.cv, un.rot);
    buildUnit(B, un, rng, lit);
    B.pop();
  }
  for (const ch of CHIMNEYS) {
    const un = ch.unit;
    B.base = un.base;
    B.push(un.cu, un.base, un.cv, un.rot);
    const wc = C(COL.earth[2]);
    B.box(ch.lx, (PLINTH + ch.top) / 2, ch.lz, 0.56, ch.top - PLINTH, 0.56, wc, MAT.earth);
    B.box(ch.lx, ch.top + 0.07, ch.lz, 0.74, 0.14, 0.74, C(0x5d5a55), MAT.stone);
    B.pop();
    ch.world = (() => { const [x, z] = toWorld(ch.u, ch.v); return [x, un.base + ch.top + 0.15, z]; })();
  }

  // yards: fences or earth walls with a gate in front; then what stands in them
  for (const y of YARDS) {
    const hs = y.house, hall = UNITS.find((u) => u.house === hs && u.kind === 'hall');
    const base = hall.base;
    B.base = base;
    B.push(0, base, 0, 0);
    const wall = y.kind === 'wall';
    const gw = hs.detail === 2 ? 1.5 : 1.3;
    const gs = (y.u1 - y.u0) * y.gate;
    const run = wall ? earthWallRun : stickRun;
    const sparse = hs.detail === 0;
    run(B, y.u0, y.v1, y.u1, y.v1, rng, sparse, [gs - gw / 2 - 0.15, gs + gw / 2 + 0.15]);
    // the sides reach back to the hall's flanks; a short return closes the gap to the side wall
    const vb = hs.v;
    run(B, y.u0, vb, y.u0, y.v1, rng, sparse);
    run(B, y.u1, vb, y.u1, y.v1, rng, sparse);
    run(B, y.u0, vb, hs.u - hs.w / 2 + 0.1, vb, rng, sparse);
    run(B, hs.u + hs.w / 2 - 0.1, vb, y.u1, vb, rng, sparse);
    const ang = hs.detail === 2 ? 1.25 : rng.chance(0.4) ? rng.range(0.2, 0.9) : 0;
    gate(B, y.u0 + gs, y.v1, 0, gw, ang, rng, wall);
    y.gateAt = [y.u0 + gs - gw / 2, y.u0 + gs + gw / 2];   // (for the walker: only a gate swung well open lets one in)
    y.gateOpen = ang > 1;

    if (hs.detail > 0) {
      // things kept in a yard, placed along its edges so the middle stays clear
      const kit = UNITS.find((u) => u.house === hs && u.kind === 'kitchen');
      const side = kit ? (kit.cu < hs.u ? 1 : -1) : rng.sign();   // the side without the kitchen
      const ex = side > 0 ? y.u1 - 0.7 : y.u0 + 0.7;
      woodpile(B, ex, (y.v0 + y.v1) / 2 + rng.range(-1, 1), rng.range(1.6, 2.6), Math.PI / 2);
      jar(B, hs.u + side * (hs.w / 2 - 0.9), y.v0 + 0.5, rng.range(0.9, 1.15), rng);
      if (rng.chance(0.7)) jar(B, hs.u + side * (hs.w / 2 - 1.8), y.v0 + 0.45, rng.range(0.7, 0.9), rng);
      tool(B, hs.u - side * (hs.w / 2 - 1.2), y.v0 + 0.05, 0, rng.int(0, 1), rng);
      if (rng.chance(0.6)) tool(B, hs.u - side * (hs.w / 2 - 1.6), y.v0 + 0.05, 0.1, rng.int(0, 1), rng);
      if (rng.chance(0.6)) basket(B, ex - side * 1.2, y.v1 - 0.8, rng.range(0.9, 1.2));
      if (rng.chance(0.45)) rack(B, (y.u0 + y.u1) / 2 + side * 1.5, y.v1 - 1.2, 0, rng);
      if (rng.chance(0.4)) coop(B, ex, y.v1 - 1.2, side > 0 ? -Math.PI / 2 : Math.PI / 2);
    }
    B.pop();
  }

  // the host's yard: the low table set in front of the porch, mats round it, a millstone by the kitchen
  {
    const hy = hostUV.yard;
    const hall = UNITS.find((u) => u.house.detail === 2 && u.kind === 'hall');
    B.base = hall.base;
    const tu = hostUV.u + 0.6, tv = hy.v0 + 2.1;
    B.push(tu, hall.base, tv, 0);
    B.box(0, 0.2, 0, 1.5, 0.4, 0.05, COL.board, MAT.wood);                   // apron front (under the top)
    B.box(0, 0.36, 0, 1.6, 0.06, 0.8, COL.board, MAT.wood);                   // top
    for (const sx of [-0.7, 0.7]) for (const sz of [-0.32, 0.32]) B.box(sx, 0.17, sz, 0.07, 0.34, 0.07, COL.post, MAT.wood);
    // a wine jar, cups and bowls
    octo(B, -0.5, 0.39, -0.1, 0.1, 0.22, COL.jar, MAT.plain);
    for (const [bx, bz] of [[-0.15, 0.18], [0.2, -0.15], [0.45, 0.2], [0.05, 0.05]]) octo(B, bx, 0.39, bz, 0.08, 0.06, 0x6b6456, MAT.plain);
    B.box(0.25, 0.4, 0.05, 0.36, 0.03, 0.24, 0x5e5044, MAT.wood);             // a dish (the chicken)
    for (const [mx, mz, r] of [[0, 1.0, 0], [0, -1.0, 0], [-1.4, 0, Math.PI / 2], [1.4, 0, Math.PI / 2]])
      B.box(mx, 0.012, mz, 1.1, 0.024, 0.75, COL.mat, MAT.mat, { ry: r });
    B.pop();
    B.push(0, hall.base, 0, 0);
    mill(B, hy.u0 + 5.2, hy.v1 - 1.4);
    B.pop();
  }

  // wells: a ring of stone, two posts and a windlass
  for (const wl of WELLS) {
    const base = ground(wl.u, wl.v);
    B.base = base;
    B.push(wl.u, base, wl.v, 0.3);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      B.box(Math.sin(a) * 0.62, 0.3, Math.cos(a) * 0.62, 0.52, 0.6, 0.22, COL.stone, MAT.stone, { ry: a, jit: 0.1 });
    }
    B.box(0, 0.05, 0, 0.95, 0.1, 0.95, COL.water, MAT.plain);
    for (const s of [-1, 1]) B.box(s * 0.85, 0.9, 0, 0.12, 1.8, 0.12, COL.bark, MAT.bark);
    B.box(0, 1.55, 0, 1.8, 0.1, 0.1, COL.stick, MAT.wood);
    B.box(0.2, 1.05, 0, 0.015, 1.0, 0.015, 0x6b6050, MAT.plain);
    octo(B, 0.2, 0.35, 0, 0.12, 0.2, COL.board, MAT.wood);
    B.pop();
  }

  // haystacks: grey-brown, last year's straw
  for (const st of STACKS) {
    const base = ground(st.u, st.v);
    B.base = base;
    B.push(st.u, base, st.v, rng.next());
    let y = 0;
    for (const [k, hgt] of [[1, 0.5], [0.97, 0.5], [0.88, 0.45], [0.72, 0.4], [0.5, 0.35], [0.26, 0.3]]) {
      octo(B, 0, y, 0, st.r * k, hgt, C(COL.straw), MAT.thatch, { jit: 0.08 });
      y += hgt;
    }
    B.box(0, y + 0.1, 0, 0.1, 0.4, 0.1, COL.stick, MAT.wood);
    B.pop();
  }

  // the threshing floor: a stone roller and a few baskets
  {
    const [tu, tv] = THRESH_UV;
    const base = ground(tu, tv);
    B.base = base;
    B.push(tu + 3, base, tv - 2, 0.6);
    B.box(0, 0.33, 0, 0.9, 0.62, 0.62, COL.stone, MAT.stone, { skip: [] });
    B.box(0, 0.33, 0, 0.9, 0.62, 0.62, COL.stone, MAT.stone, { rx: Math.PI / 4, skip: [] });
    for (const s of [-1, 1]) B.box(s * 0.52, 0.33, 0, 0.06, 0.12, 0.9, COL.post, MAT.wood);
    B.pop();
    B.push(tu, base, tv, 0);
    basket(B, -6, 3, 1.1); basket(B, -5.3, 3.5, 0.9);
    B.pop();
  }

  B.pop();
  const geo = B.geometry();
  const mesh = new THREE.Mesh(geo, blocksMaterial());
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.name = 'village';
  const g = new THREE.Group();
  g.name = 'village';
  g.add(mesh);
  g.userData = { mesh, chimneys: CHIMNEYS.map((c) => c.world) };
  return g;
}
