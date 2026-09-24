// 渔舟: a small plank sampan with an arched mat awning, and the fisherman in his 斗笠 and 蓑衣 poling
// it along the creek. The director says where the boat is (story.boat: z, moored, visible, down, and
// the extras man / turn / bank / crew); this puts it on the water there, turned along the creek and
// rocking a little. Moored, it lies against the east bank below the cave, its stern tied to a stake.
import * as THREE from 'three';
import { VoxelGrid, meshVoxels, voxelMaterial } from '../core/voxel.js';
import { creekX, creekHW, creekDir, WATER_OUT } from '../world/layout.js';
import { surfaceHeight } from '../world/terrain.js';
import { Crowd, CLOTH, SKIN, HAIR, STRAW, stand } from './crowd.js';
import { SkinnedFigure } from './skinned.js';
import { clamp, lerp, smoothstep } from '../core/rng.js';

const L = 4.8, B = 1.18, VS = 0.06;
const SIDE = 1; // the moorings are on the east bank, the side the cave path comes down
const PAL = [null,
  { c: [0.4, 0.32, 0.24], jitter: 0.09 },  // 1 planking, weathered
  { c: [0.2, 0.17, 0.14], jitter: 0.05 },  // 2 below the waterline, wet and tarred
  { c: [0.52, 0.43, 0.32], jitter: 0.06 }, // 3 gunwale rail
  { c: [0.45, 0.37, 0.28], jitter: 0.1 },  // 4 floorboards, thwarts, the decked ends
  null, null,
  { c: [0.47, 0.43, 0.34], jitter: 0.1 },  // 7 the fish basket
];
const THWARTS = [-0.62, 0.6].map((s) => (s * L) / 2);

// the hull, local metres: bow toward +z, y = 0 at the waterline
function cell(x, y, z) {
  const s = z / (L / 2), a = Math.abs(s);
  // 鱼篓, a narrow-necked basket on the floor ahead of the awning
  const bd = Math.hypot(x - 0.24, z - 1.12);
  if (y > -0.06 && y < 0.34 && bd < 0.14 * (y > 0.22 ? 0.7 : 1)) return 7;
  if (a > 1) return 0;
  const bot = -0.15 + (0.36 * Math.max(0, a - 0.42) ** 2) / 0.3364;
  const top = 0.3 + 0.26 * s * s;
  if (y < bot || y > top) return 0;
  const hw0 = Math.max(0.16, (B / 2) * Math.sqrt(Math.max(0, 1 - a ** 3.2)));
  const hw = hw0 * (0.74 + 0.26 * Math.sqrt(clamp((y - bot) / (top - bot), 0, 1)));
  const ax = Math.abs(x), rail = y > top - 0.07;
  if (ax > hw + (rail ? 0.045 : 0)) return 0;
  const inner = ax < hw - VS * 1.2 && y > bot + VS * 1.2;
  if (inner) {
    if (a > 0.84 && y > top - 0.13) return 4;
    if (y < bot + 0.13) return 4;
    if (THWARTS.some((t) => Math.abs(z - t) < 0.06) && y > top - 0.16 && y < top - 0.07) return 4;
    return 0;
  }
  if (rail) return 3;
  return y < 0.02 ? 2 : 1;
}

// 篷: an arch of woven bamboo matting over the middle of the boat, on three bent ribs. Smooth, not voxel:
// a mat is a woven surface, and stepped it read as a stone vault.
const AW = { z0: -0.8, z1: 0.64, a: 0.63, b: 0.66, y0: 0.27, t: 0.035, ribs: [-0.76, -0.08, 0.6] };
function awningGeometry() {
  const NA = 26, NL = 30, P = [], N = [], C = [];
  const base = [0.5, 0.46, 0.38], rib = [0.3, 0.26, 0.21];
  const pt = (th, z, r) => {
    const ribK = AW.ribs.some((zr) => Math.abs(z - zr) < 0.03) ? 1 : 0;
    const k = r + ribK * 0.014;
    return [Math.cos(th) * AW.a * k, AW.y0 + Math.sin(th) * AW.b * k, z];
  };
  const nrm = (th, s) => { const nx = Math.cos(th) / AW.a, ny = Math.sin(th) / AW.b, l = Math.hypot(nx, ny); return [(nx / l) * s, (ny / l) * s, 0]; };
  const zs = [];
  for (let j = 0; j <= NL; j++) zs.push(AW.z0 + ((AW.z1 - AW.z0) * j) / NL);
  for (const zr of AW.ribs) zs.push(zr - 0.03, zr + 0.03);
  zs.sort((a, b) => a - b);
  const quad = (a, b, c, d, n, col) => {
    for (const v of [a, b, c, a, c, d]) { P.push(...v.p); N.push(...(v.n ?? n)); C.push(...col); }
  };
  for (const side of [1, -1]) {           // outer skin, then the inner (seen from under the awning)
    const r = side > 0 ? 1 : 1 - AW.t / AW.a;
    for (let j = 0; j < zs.length - 1; j++) {
      const za = zs[j], zb = zs[j + 1], zm = (za + zb) / 2;
      const isRib = AW.ribs.some((zr) => Math.abs(zm - zr) < 0.03);
      for (let i = 0; i < NA; i++) {
        const t0 = (Math.PI * i) / NA, t1 = (Math.PI * (i + 1)) / NA;
        // a twill of split bamboo: squares alternately lighter and darker, and a little uneven
        const h = Math.sin(i * 12.9898 + j * 78.233) * 43758.5453;
        const jit = 0.92 + (h - Math.floor(h)) * 0.14;
        const w = ((i + Math.floor(j / 1)) % 2 ? 1 : 0.84) * jit * (side > 0 ? 1 : 0.7);
        const col = isRib ? rib : [base[0] * w, base[1] * w, base[2] * w];
        const v = [[t0, za], [t1, za], [t1, zb], [t0, zb]].map(([th, z]) => ({ p: pt(th, z, r), n: nrm(th, side) }));
        if (side > 0) quad(v[0], v[1], v[2], v[3], null, col);
        else quad(v[0], v[3], v[2], v[1], null, col);
      }
    }
  }
  // the cut ends of the mat
  for (const [z, s] of [[AW.z0, -1], [AW.z1, 1]]) for (let i = 0; i < NA; i++) {
    const t0 = (Math.PI * i) / NA, t1 = (Math.PI * (i + 1)) / NA;
    const o0 = pt(t0, z, 1), o1 = pt(t1, z, 1), i0 = pt(t0, z, 1 - AW.t / AW.a), i1 = pt(t1, z, 1 - AW.t / AW.a);
    const n = [0, 0, s], col = rib;
    if (s > 0) quad({ p: o0 }, { p: o1 }, { p: i1 }, { p: i0 }, n, col);
    else quad({ p: o0 }, { p: i0 }, { p: i1 }, { p: o1 }, n, col);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  return g;
}

function hullGeometry() {
  const nx = Math.ceil(1.34 / VS), ny = Math.ceil(1.2 / VS), nz = Math.ceil((L + 0.12) / VS);
  const g = new VoxelGrid(nx, ny, nz, VS, [(-nx * VS) / 2, -0.18, (-nz * VS) / 2]);
  g.fill((x, y, z) => cell(x, y, z));
  return meshVoxels(g, PAL, { jitter: 0.08, seed: 5 });
}

export const lookFisher = { skinned: true, top: CLOTH.hempDark, bottom: [0.5, 0.46, 0.39], shin: SKIN[1], skin: SKIN[1], hair: HAIR.black, hat: STRAW, cape: [0.5, 0.45, 0.35], shoes: SKIN[1] };
const lookOfficer = (c) => ({ top: c, bottom: c, skirt: c, skin: SKIN[2], hair: HAIR.black, bun: true, shoes: [0.16, 0.15, 0.14] });

export function buildBoat() {
  const group = new THREE.Group();
  group.name = 'boat';
  const mat = voxelMaterial();
  const hull = new THREE.Group();
  hull.matrixAutoUpdate = false;
  const hm = new THREE.Mesh(hullGeometry(), mat);
  hm.castShadow = true; hm.receiveShadow = true;
  const aw = new THREE.Mesh(awningGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }));
  aw.castShadow = true; aw.receiveShadow = true;
  hull.add(hm, aw);
  // the pole, laid along the thwarts when he is ashore
  const wood = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.36, 0.3, 0.22), roughness: 0.85 });
  const pole = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, 4.2), wood);
  pole.position.set(-0.34, 0.33, -0.1);
  pole.rotation.set(0.03, 0.02, 0);
  pole.castShadow = true;
  hull.add(pole);
  group.add(hull);
  // mooring: a stake on the bank and the rope from the stern to it
  const stake = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 1.0, 6).translate(0, 0.5, 0), wood);
  stake.castShadow = true;
  const rope = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.025, 1).translate(0, 0, 0.5),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(0.5, 0.45, 0.36), roughness: 1 }));
  group.add(stake, rope);

  // the people aboard
  const crowd = new Crowd(4, 'boat-crowd');
  group.add(crowd.group);
  const st = { man: 'none', crew: 0, speed: 0, phase: 0 };
  const M = new THREE.Matrix4();
  const fisher = crowd.add({ look: lookFisher, skin: new SkinnedFigure(), act: (t, p, f) => actFisher(t, p, f, st) });
  const officers = [lookOfficer(CLOTH.greyDark), lookOfficer(CLOTH.indigo)].map((look, i) => crowd.add({
    look, act: (t, p, f) => {
      p.x = i ? 0.16 : -0.14; p.y = i ? 0.0 : 0.02; p.z = i ? 1.62 : 1.02;
      stand(p, t, f);
      // looking up and down the banks for the marks, and not finding them
      p.headYaw = Math.sin(t * 0.55 * f.tempo + f.ph) * 1.0;
      p.yaw = Math.sin(t * 0.23 + f.ph * 2) * 0.5;
      const point = Math.sin(t * 0.31 + f.ph * 5) > 0.55;
      p.armR = lerp(p.armR, point ? 1.35 : 0.06, 0.08);
      p.elbowR = point ? 0.1 : 0.2;
    },
  }));
  for (const f of [fisher, ...officers]) f.parent = M;

  let lastZ = null, tPrev = 0;
  const _v = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3();
  group.userData.update = (t, story, camera) => {
    const b = story.boat;
    group.visible = group.visible && b.visible !== false; // (after the zone culling)
    if (!group.visible) { lastZ = null; return; }
    const dt = Math.min(0.1, Math.max(0, t - tPrev)); tPrev = t;
    // speed along the creek (for the punting rhythm); a jump is a new shot, not speed
    if (lastZ != null && dt > 0 && Math.abs(b.z - lastZ) < 5) st.speed = lerp(st.speed, Math.abs(b.z - lastZ) / dt, Math.min(1, dt * 2));
    lastZ = b.z;
    st.man = b.man ?? (b.moored ? 'none' : 'punt');
    st.crew = b.crew ?? 0;
    // heading: upstream, or turned right round for the way home (turning the bow away from the bank)
    const d = creekDir(b.z), up = Math.atan2(-d.x, -d.z);
    const turn = b.turn ?? (b.down ? 1 : 0);
    const yaw = up + turn * Math.PI;
    const bank = b.bank ?? (b.moored ? 1 : 0);
    const lateral = SIDE * (creekHW(b.z) - 0.95) * bank + Math.sin(b.z * 0.041) * 0.35 * (1 - bank);
    const calm = b.moored && st.man === 'none' ? 0.45 : 1;
    const push = st.man === 'punt' ? Math.max(0, Math.sin(st.phase * Math.PI * 2)) : 0;
    const roll = (Math.sin(t * 0.83 + 1.3) * 0.016 + Math.sin(t * 1.9) * 0.006) * calm - push * 0.012;
    const pitch = Math.sin(t * 0.67) * 0.01 * calm - push * 0.008;
    const bob = Math.sin(t * 1.21) * 0.012 * calm;
    M.makeRotationFromEuler(new THREE.Euler(pitch, yaw, roll, 'YXZ'));
    M.setPosition(creekX(b.z) + lateral, WATER_OUT + bob, b.z);
    hull.matrix.copy(M);
    hull.matrixWorldNeedsUpdate = true;
    pole.visible = st.man === 'none';
    // the mooring rope, while tied
    const tied = !!b.moored;
    stake.visible = rope.visible = tied;
    if (tied) {
      _a.set(0, 0.42, -2.28).applyMatrix4(M);
      const sz = _a.z + 0.3, sx = creekX(sz) + SIDE * (creekHW(sz) + 0.55);
      stake.position.set(sx, surfaceHeight(sx, sz) - 0.25, sz);
      _b.set(sx, stake.position.y + 0.72, sz);
      rope.position.copy(_a);
      rope.scale.set(1, 1, _a.distanceTo(_b));
      rope.lookAt(_b);
    }
    fisher.visible = st.man !== 'none';
    for (const o of officers) o.visible = st.crew > 0;
    // punting rhythm: a stroke every couple of seconds, quicker when the boat is quicker
    const period = clamp(4.2 / Math.max(st.speed, 1.6), 1.3, 2.6);
    st.phase = (st.phase + dt / period) % 1;
    crowd.update(t, camera);
  };
  group.userData.crowd = crowd;
  group.userData.hull = hull;   // (its matrix: where the hull lies, for the walker to keep out of)
  return group;
}

// the fisherman: poling from the stern, standing at the bow looking at the cave, or stooping to the rope
const _e = new THREE.Euler();
function actFisher(t, p, f, st) {
  p.prop = null; p.propFrame = null; p.propRot = null;
  if (st.man === 'look') {
    // at the bow, the pole planted beside him, looking up at the little mouth in the hill
    p.x = 0.05; p.y = 0.02; p.z = 1.15; p.yaw = 0;
    stand(p, t, f, 0.5);
    p.headYaw = Math.sin(t * 0.3) * 0.12; p.headPitch = 0.2 + Math.sin(t * 0.5) * 0.03;
    p.armR = 0.55; p.elbowR = 1.05; p.outR = 0.3;
    p.prop = 'punt'; p.propAt = 'R'; p.propFrame = 'root'; p.propRot = _e.set(0.04, 0, 0.06);
    return;
  }
  if (st.man === 'untie') {
    // stooped over the stern, working the rope loose
    p.x = 0.1; p.y = 0.07; p.z = -1.7; p.yaw = Math.PI;
    const w = Math.sin(t * 5.5);
    p.bob = -0.18; p.lean = 0.15; p.bend = 0.85; p.twist = 0.1;
    p.legL = 0.55; p.legR = 0.2; p.kneeL = 1.0; p.kneeR = 0.7; p.spread = 0.08;
    p.armL = 1.1 + w * 0.08; p.armR = 1.0 - w * 0.08; p.elbowL = 0.5; p.elbowR = 0.6; p.outL = p.outR = 0.1;
    p.headYaw = 0; p.headPitch = -0.3;
    return;
  }
  // punting: plant the pole, walk the hands down it as the boat runs on, lift it clear and swing it forward
  const ph = st.phase, pushing = ph < 0.6;
  const e = pushing ? smoothstep(0, 1, ph / 0.6) : 1 - smoothstep(0, 1, (ph - 0.6) / 0.4);
  p.x = -0.05; p.y = 0.07; p.z = -1.55; p.yaw = 0.12;
  p.bob = -0.04 * e; p.lean = 0;
  p.bend = lerp(0.1, 0.45, e); p.twist = lerp(0.12, -0.18, e); p.roll = 0;
  p.legL = 0.3; p.legR = -0.2; p.kneeL = 0.16 + 0.2 * e; p.kneeR = 0.08 + 0.06 * e; p.spread = 0.06;
  p.armR = lerp(2.05, 0.6, e); p.elbowR = lerp(0.95, 0.25, e); p.outR = 0.3;
  p.armL = lerp(1.7, 0.4, e); p.elbowL = lerp(1.25, 0.5, e); p.outL = 0.02;
  p.headYaw = -0.1; p.headPitch = lerp(0.08, -0.12, e);
  p.prop = 'punt'; p.propAt = 'R'; p.propFrame = 'root';
  p.propRot = _e.set(pushing ? lerp(0.2, 0.5, ph / 0.6) : lerp(0.5, 0.2, smoothstep(0, 1, (ph - 0.6) / 0.4)), 0, 0.1);
}
