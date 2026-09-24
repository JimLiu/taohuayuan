// 其中往来种作，男女衣着，悉如外人。黄发垂髫，并怡然自乐。
// The people of the basin and their animals. Ambient life goes on wherever the camera is (planting,
// hoeing, ploughing behind a buffalo, carrying on the lanes, washing at the pond, the old sitting under the
// tree while the children run about it); each chapter of the fisherman's visit adds its own small cast.
// Every figure has its own phase and pace, so no two of them ever move together.
import * as THREE from 'three';
import { G } from '../core/shared.js';
import { lerp, clamp } from '../core/rng.js';
import { Crowd, CLOTH, SKIN, HAIR, STRAW, hashf, stand, walkCycle, follow, restPose, TAU } from './crowd.js';
import { Herd, gait, still, COATS } from './animals.js';
import { lookFisher } from './boat.js';
import { SkinnedFigure } from './skinned.js';
import { makeElder } from './elder.js';
import { surfaceHeight } from '../world/terrain.js';
import { FIELD_WORK, BED_Y } from '../world/fields.js';
import { fieldAt, pondDist, POND, BIG_TREE, THRESH, descentPoint } from '../world/layout.js';
import { LANES, WELLS, ANCHORS, toWorld, toLocal, VROT, PLINTH, hostUV } from '../world/villageplan.js';

const ss = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const n1 = (x) => { const i = Math.floor(x), f = x - i; return lerp(hashf(i * 0.37 + 11), hashf((i + 1) * 0.37 + 11), f * f * (3 - 2 * f)); };
const yawL = (du, dv) => Math.atan2(du, dv) + VROT; // facing a direction given in village (u, v)
const face = (p, x, z) => { p.yaw = Math.atan2(x - p.x, z - p.z); };

// ground under a foot: the mud under the water in a flooded plot, the rendered terrain elsewhere
const hcache = new Map();
function ground(x, z) {
  const f = fieldAt(x, z);
  if (f && f.flooded) return BED_Y;
  const kx = Math.round(x * 4), kz = Math.round(z * 4), k = kx * 100000 + kz;
  let h = hcache.get(k);
  if (h === undefined) {
    if (hcache.size > 40000) hcache.clear();
    h = surfaceHeight(kx / 4, kz / 4);
    hcache.set(k, h);
  }
  return h;
}

// ---------------------------------------------------------------- looks
const TOPS = [CLOTH.hemp, CLOTH.hempDark, CLOTH.grey, CLOTH.brown, CLOTH.indigoPale, CLOTH.ochre, CLOTH.indigo, CLOTH.hemp, CLOTH.greyDark];
const BOTS = [CLOTH.hempDark, CLOTH.greyDark, CLOTH.brownDark, CLOTH.brown, CLOTH.indigo];
const ROBES = [CLOTH.brownDark, CLOTH.greyDark, CLOTH.indigo, CLOTH.hempDark, CLOTH.brown, CLOTH.grey];
const KERCH = [CLOTH.hemp, CLOTH.indigoPale, CLOTH.white, CLOTH.grey, CLOTH.ochre];
let seedN = 1;
const rnd = () => hashf(seedN++ * 1.618 + 0.5);
const pick = (a) => a[Math.min(a.length - 1, Math.floor(rnd() * a.length))];
const dim = (c, k) => c.map((x) => x * k);

function lookMan(o = {}) {
  return { top: pick(TOPS), bottom: pick(BOTS), skin: pick(SKIN), hair: HAIR.black, bun: true, shoes: [0.3, 0.27, 0.24], ...o };
}
// in the fields: trousers rolled to the knee, barefoot, often a straw hat
function lookFarmer(o = {}) {
  const skin = pick(SKIN);
  const l = { top: pick(TOPS), bottom: pick(BOTS), skin, shin: skin, shoes: dim(skin, 0.85), hair: HAIR.black, bun: true };
  if (rnd() < 0.5) l.hat = STRAW;
  return { ...l, ...o };
}
function lookWoman(o = {}) {
  const robe = pick(ROBES);
  const l = { top: pick(TOPS), bottom: robe, skirt: robe, skin: pick(SKIN), hair: HAIR.black, bun: true, shoes: [0.28, 0.25, 0.22] };
  if (rnd() < 0.45) l.kerchief = pick(KERCH);
  return { ...l, ...o };
}
function lookElder(o = {}) {
  const hair = rnd() < 0.6 ? HAIR.pale : HAIR.grey;
  return lookMan({ hair, beard: true, top: pick([CLOTH.hemp, CLOTH.grey, CLOTH.brown, CLOTH.white, CLOTH.hempDark]), ...o });
}
function lookOldWoman(o = {}) { return lookWoman({ hair: HAIR.grey, kerchief: undefined, ...o }); }
// 垂髫: children with their hair hanging loose, no topknot
function lookChild(o = {}) {
  const skin = pick(SKIN);
  return { top: pick(TOPS), bottom: pick(BOTS), skin, shin: skin, shoes: dim(skin, 0.85), hair: HAIR.black, ...o };
}

// ---------------------------------------------------------------- pose pieces
const REST = restPose();
function reset(p) {
  const { x, y, z, yaw, headYaw } = p;
  Object.assign(p, REST);
  p.x = x; p.y = y; p.z = z; p.yaw = yaw; p.headYaw = headYaw;
}
// 跪坐: sitting back on the heels, the shins flat on the mat (no chairs in this age)
function kneel(p) { p.legL = p.legR = 1.07; p.kneeL = p.kneeR = 2.64; p.bob = -0.56; p.spread = 0.06; }
function sitOn(p) { p.legL = p.legR = 1.5; p.kneeL = p.kneeR = 1.5; p.bob = -0.37; p.spread = 0.13; }
function squat(p) { p.legL = p.legR = 1.75; p.kneeL = p.kneeR = 2.35; p.bob = -0.52; p.spread = 0.22; p.bend = 0.5; }
// talking with the hands, now and then
function talk(p, t, f, k = 1, side = 'R') {
  const g = t * f.tempo + f.ph * 5;
  const on = ss(0.45, 0.7, n1(g * 0.45 + f.id * 3.3)) * k;
  const a = 0.75 + 0.22 * Math.sin(g * 2.3), e = 1.25 + 0.35 * Math.sin(g * 1.7 + 1);
  if (side === 'R') { p.armR = lerp(p.armR, a, on); p.elbowR = lerp(p.elbowR, e, on); p.outR = lerp(p.outR, 0.25, on); }
  else { p.armL = lerp(p.armL, a, on); p.elbowL = lerp(p.elbowL, e, on); p.outL = lerp(p.outL, 0.25, on); }
  p.headPitch += Math.sin(g * 3.1) * 0.05 * k;
  p.headYaw += Math.sin(g * 0.9) * 0.08 * k;
}
function lookAt(p, x, y, z, k = 1, eye = 1.5) {
  // turn the head (then the upper body) toward a point
  let d = Math.atan2(x - p.x, z - p.z) - p.yaw;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  const h = clamp(d, -1.2, 1.2);
  p.headYaw = lerp(p.headYaw, h * 0.7, k);
  p.twist = lerp(p.twist, h * 0.3, k);
  p.headPitch = lerp(p.headPitch, Math.atan2(y - (p.y + eye), Math.hypot(x - p.x, z - p.z)), k);
}

// ---------------------------------------------------------------- ambient actions
function actPlant(t, p, f) {
  // 插秧: bent double in the water, a fist of seedlings in the left hand, the right dipping; straightening now and then
  reset(p);
  const q = t * f.tempo * 0.55 + f.ph;
  const w = (t * 0.045 * f.tempo + f.ph * 0.31) % 1;
  const up = ss(0, 0.05, w) * (1 - ss(0.11, 0.16, w));
  const dip = Math.max(0, Math.sin(q * TAU)) ** 2;
  p.bend = lerp(1.12, 0.1, up); p.lean = lerp(0.12, 0, up);
  p.legL = 0.18; p.legR = -0.1; p.kneeL = lerp(0.34, 0.05, up); p.kneeR = lerp(0.24, 0.05, up); p.spread = 0.1; p.bob = lerp(-0.05, 0, up);
  p.armR = lerp(1.05 + dip * 0.5, 0.15, up); p.elbowR = lerp(0.15 + (1 - dip) * 0.35, 0.3, up); p.outR = 0.1;
  p.armL = lerp(1.35, 0.55, up); p.elbowL = lerp(0.9, 1.4, up); p.outL = 0.14;
  p.headPitch = lerp(0.8, 0.05, up); p.headYaw = lerp(0, Math.sin(t * 0.37 + f.ph) * 0.7, up);
  p.prop = 'bundle'; p.propAt = 'L';
  // (weeding the wheat: both hands down among the stalks, nothing to hold)
  if (f.weed) { p.prop = null; p.armL = lerp(1.05 + (1 - dip) * 0.45, 0.2, up); p.elbowL = lerp(0.2 + dip * 0.3, 0.35, up); }
}
function actHoe(t, p, f) {
  // 锄: lift slowly overhead, bring it down fast, draw the earth back
  reset(p);
  const q = (t * f.tempo * 0.6 + f.ph) % 1;
  let g;
  if (q < 0.5) g = lerp(0.75, 3.5, ss(0, 0.5, q));
  else if (q < 0.6) { const k = (q - 0.5) / 0.1; g = lerp(3.5, 0.75, k * k); }
  else g = lerp(0.75, 0.6, Math.sin(ss(0.6, 1, q) * Math.PI));
  const k = clamp((g - 0.75) / 2.75, 0, 1);
  p.bend = lerp(0.6, 0.08, k); p.lean = 0.05;
  p.legL = 0.3; p.legR = -0.18; p.kneeL = 0.3; p.kneeR = 0.12; p.spread = 0.08; p.bob = -0.03;
  p.armR = lerp(1.27, 2.75, k); p.elbowR = lerp(0.1, 0.55, k); p.outR = 0.05;
  p.armL = lerp(1.17, 2.6, k); p.elbowL = lerp(0.2, 0.6, k); p.outL = 0.05;
  p.headPitch = lerp(0.2, -0.1, k);
  p.prop = 'hoe'; p.propAt = 'R'; p.propFrame = 'root';
  p.propRot = (f._rot ??= new THREE.Euler()).set(-g, 0, 0);
}
function actWash(t, p, f) {
  // 浣: squatting at the water's edge, scrubbing on a stone
  reset(p);
  squat(p);
  const g = t * f.tempo * 2.2 + f.ph;
  const w = (t * 0.05 + f.ph * 0.2) % 1, rest = ss(0, 0.05, w) * (1 - ss(0.12, 0.17, w));
  p.bend = lerp(0.75, 0.3, rest);
  p.armL = lerp(1.5 + Math.sin(g) * 0.18, 0.9, rest); p.elbowL = lerp(0.5 + Math.cos(g) * 0.2, 1.2, rest);
  p.armR = lerp(1.5 - Math.sin(g) * 0.18, 0.9, rest); p.elbowR = lerp(0.5 - Math.cos(g) * 0.2, 1.3, rest);
  p.outL = p.outR = 0.12;
  p.headPitch = lerp(-0.1, 0.3, rest); p.headYaw = rest * Math.sin(t * 0.5 + f.ph) * 0.8;
  p.prop2 = f.basket;
}
function actWell(t, p, f) {
  // drawing water: hand over hand on the rope, then the bucket set down, a rest
  reset(p);
  stand(p, t, f, 0.5);
  const q = (t * f.tempo * 0.09 + f.ph) % 1;
  if (q < 0.55) {
    const g = t * f.tempo * 3.2 + f.ph;
    p.bend = 0.25;
    p.armL = 1.35 + Math.sin(g) * 0.35; p.elbowL = 0.4 - Math.sin(g) * 0.3;
    p.armR = 1.35 - Math.sin(g) * 0.35; p.elbowR = 0.4 + Math.sin(g) * 0.3;
    p.outL = p.outR = 0.08; p.headPitch = -0.35;
  } else {
    p.prop = 'bucket'; p.propAt = 'R'; p.propFrame = 'root';
    p.armR = 0.12; p.elbowR = 0.1; p.outR = 0.2;
    talk(p, t, f, 0.6, 'L');
  }
}
function actElderSit(t, p, f) {
  reset(p);
  sitOn(p);
  p.bend = 0.12 + Math.sin(t * 0.3 + f.ph) * 0.03;
  p.armL = 0.55; p.elbowL = 0.9; p.armR = 0.5; p.elbowR = 0.95; p.outL = p.outR = 0.12;
  const look = Math.floor(t * 0.2 * f.tempo + f.ph * 3);
  p.headYaw = lerp(p.headYaw, (hashf(look + f.id * 13) - 0.5) * 1.1 + (f.lean0 ?? 0), 0.03);
  talk(p, t, f, 1, f.id % 2 ? 'L' : 'R');
  // laughing: a nod back, the shoulders shaking
  const lw = (t * 0.07 + f.ph) % 1, laugh = ss(0, 0.03, lw) * (1 - ss(0.08, 0.12, lw));
  p.headPitch += laugh * (0.3 + Math.sin(t * 14) * 0.05);
  p.bend -= laugh * 0.12;
}
function actChase(t, p, f) {
  // children running round and round, now one way, now the other
  reset(p);
  const dir = Math.sin(t * 0.09 + f.ph) > -0.2 ? 1 : -1;
  const a = (t * 2.1 / f.r) * f.tempo * dir + f.ph * 2 + f.lag;
  p.x = f.c[0] + Math.sin(a) * f.r; p.z = f.c[1] + Math.cos(a) * f.r * 0.8;
  p.y = ground(p.x, p.z);
  p.yaw = Math.atan2(Math.cos(a), -Math.sin(a) * 0.8) + (dir < 0 ? Math.PI : 0);
  walkCycle(p, t * 11 * f.tempo + f.ph, 1.15, 1);
  p.headPitch = 0.1;
}
function actHop(t, p, f) {
  // 跳房子 or just jumping for the joy of it
  reset(p);
  const q = (t * f.tempo * 1.4 + f.ph) % 1;
  const air = Math.sin(clamp((q - 0.25) / 0.6, 0, 1) * Math.PI);
  const crouch = q < 0.25 ? Math.sin(q / 0.25 * Math.PI) : 0;
  p.bob = air * 0.3 - crouch * 0.1;
  p.legL = p.legR = crouch * 0.6 + air * 0.25; p.kneeL = p.kneeR = crouch * 1.1 + air * 0.4;
  p.armL = p.armR = air * 2.2 + crouch * -0.3; p.outL = p.outR = 0.2 + air * 0.3; p.elbowL = p.elbowR = 0.2;
  p.bend = crouch * 0.3; p.headPitch = air * 0.2;
}
function actPlay(t, p, f) {
  // squatting over something in the dirt (ants, a beetle, pebbles), poking at it
  reset(p);
  squat(p);
  const g = t * f.tempo * 1.7 + f.ph;
  p.bend = 0.55; p.armR = 1.3 + Math.max(0, Math.sin(g)) * 0.3; p.elbowR = 0.3; p.outR = 0.1;
  p.armL = 0.7; p.elbowL = 1.4; p.headPitch = -0.15; p.headYaw = Math.sin(g * 0.3) * 0.2;
}
function carry(p, t, f) {
  // what a walker carries: a pole on the shoulder, a hoe on the shoulder, a basket on the arm
  const c = f.carry;
  if (c === 'pole') {
    p.prop = 'pole'; p.propAt = 'shoulder';
    p.propRot = (f._rot ??= new THREE.Euler()).set(Math.sin(t * 5.4 * f.tempo + f.ph) * 0.03, 0, 0);
    p.armR = 0.5; p.elbowR = 2.2; p.outR = 0.25;
  } else if (c === 'hoe') {
    p.prop = 'hoe'; p.propAt = 'shoulder'; p.propOff = 0.17;
    p.propRot = (f._rot ??= new THREE.Euler()).set(1.95, 0, 0);
    p.armR = 0.75; p.elbowR = 1.9; p.outR = 0.05;
  } else if (c === 'basket') {
    p.prop = 'basket'; p.propAt = 'L'; p.propFrame = 'root';
    p.armL = 0.35; p.elbowL = 1.4; p.outL = 0.3;
  } else if (c === 'bundle') {
    p.prop = 'bundle'; p.propAt = 'R'; p.propFrame = 'root';
  }
}
function actWalk(t, p, f) {
  reset(p);
  follow(p, t, f, f.path, f.speed ?? 1.05);
  p.y = ground(p.x, p.z);
  carry(p, t, f);
}

// ---------------------------------------------------------------- ploughing
// the team goes round a stadium: along the edge of the turned ground, a wide turn on the headland, back
// a furrow over, another turn. The man walks at s, the buffalo 2.7 m ahead; he faces the yoke, so the
// straight beam of the plough runs from his hands to the buffalo's neck.
function stadium(A, B, n, r) {
  const d = [B[0] - A[0], B[1] - A[1]], L = Math.hypot(d[0], d[1]);
  d[0] /= L; d[1] /= L;
  const T = 2 * L + 2 * Math.PI * r;
  return (s) => {
    s = ((s % T) + T) % T;
    if (s < L) return [A[0] + d[0] * s, A[1] + d[1] * s];
    s -= L;
    if (s < Math.PI * r) { const f = s / r; return [B[0] + n[0] * r + (-n[0] * Math.cos(f) + d[0] * Math.sin(f)) * r, B[1] + n[1] * r + (-n[1] * Math.cos(f) + d[1] * Math.sin(f)) * r]; }
    s -= Math.PI * r;
    if (s < L) return [B[0] + 2 * n[0] * r - d[0] * s, B[1] + 2 * n[1] * r - d[1] * s];
    s -= L;
    const f = s / r;
    return [A[0] + n[0] * r + (n[0] * Math.cos(f) - d[0] * Math.sin(f)) * r, A[1] + n[1] * r + (n[1] * Math.cos(f) - d[1] * Math.sin(f)) * r];
  };
}
const TEAM_GAP = 2.7;

// ---------------------------------------------------------------- animals
function wanderAt(a, t, speed) {
  // stateless wandering about a home spot: a new place every slot, walked to, then pottering there
  const T = a.slot, tt = t * a.tempo + a.ph * T, k = Math.floor(tt / T), w = tt - k * T;
  const P = (n) => [a.home[0] + (hashf(n * 1.71 + a.id * 9.13) - 0.5) * 2 * a.r, a.home[1] + (hashf(n * 2.93 + a.id * 4.37) - 0.5) * 2 * a.r];
  const A = P(k - 1), B = P(k), dx = B[0] - A[0], dz = B[1] - A[1], d = Math.hypot(dx, dz), wt = d / speed;
  const u = clamp(w / wt, 0, 1);
  return { x: A[0] + dx * u, z: A[1] + dz * u, yaw: Math.atan2(dx, dz), walking: w < wt, w: w - wt, dist: u * d };
}
function actHen(t, p, a) {
  still(p);
  const m = wanderAt(a, t, 0.55);
  p.x = m.x; p.z = m.z; p.y = ground(p.x, p.z);
  p.yaw = m.yaw + (m.walking ? 0 : Math.sin(Math.floor(m.w * 0.8) * 2.1 + a.id) * 0.9);
  if (m.walking) {
    gait(p, m.dist * 16, 1.2, 2);
    p.headPitch = Math.sin(m.dist * 16) * 0.12; p.pitch = -0.05;
  } else {
    // peck, peck, look about; now and then scratch backwards with one foot
    const q = (m.w * 1.3 + a.ph) % 3;
    const peck = q < 1.6 ? Math.max(0, Math.sin(q * 11)) : 0;
    p.pitch = -0.35 * (q < 1.6 ? 1 : 0.2); p.headPitch = -0.3 - peck * 0.9;
    if (q > 2.3) { p.legs[0] = Math.sin(q * 20) * 0.6; p.knees[0] = 0.5; }
    p.headYaw = q > 1.6 && q < 2.3 ? Math.sin(Math.floor(q * 6) * 1.7) * 0.6 : 0;
  }
  p.tail = 0;
}
function actDogWander(t, p, a) {
  still(p);
  const m = wanderAt(a, t, 1.1);
  p.x = m.x; p.z = m.z; p.y = ground(p.x, p.z); p.yaw = m.yaw;
  if (m.walking) { gait(p, m.dist * 5.5, 1); p.headPitch = -0.15; p.tail = -0.8; p.wag = Math.sin(t * 9) * 0.25; }
  else {
    // sniffing at the ground, or sitting to scratch, or just standing with the tail going
    const q = (m.w * 0.5 + a.ph) % 3;
    if (q < 1.4) { p.headPitch = -0.7 - Math.sin(t * 6) * 0.1; p.headYaw = Math.sin(t * 1.3) * 0.3; p.tail = -0.6; }
    else if (q < 2.2) { dogSit(p); p.headYaw = Math.sin(t * 0.7 + a.id) * 0.6; }
    else { p.headYaw = Math.sin(t * 0.8) * 0.5; p.tail = -1; p.wag = Math.sin(t * 11) * 0.45; }
  }
}
function dogSit(p) {
  p.pitch = 0.5; p.low = 0.1;
  p.legs[0] = p.legs[1] = -0.45; p.knees[0] = p.knees[1] = 0;
  p.legs[2] = p.legs[3] = 0.9; p.knees[2] = p.knees[3] = -1.9;
  p.headPitch = -0.35; p.tail = 0.4;
}
function dogLie(p, t, a) {
  p.low = 0.26; p.pitch = 0;
  p.legs[0] = p.legs[1] = 1.45; p.knees[0] = p.knees[1] = 0.1;
  p.legs[2] = p.legs[3] = 1.2; p.knees[2] = p.knees[3] = -2.2;
  const w = (t * 0.06 + a.ph) % 1;
  p.headPitch = w < 0.6 ? -0.25 : 0.1; p.headYaw = w < 0.6 ? 0.2 : Math.sin(t * 0.6) * 0.6;
  p.tail = 1.2; p.wag = w > 0.85 ? Math.sin(t * 8) * 0.3 : 0;
}

// ================================================================ the whole population
export function buildLife() {
  const crowd = new Crowd(130, 'villagers');
  const herd = new Herd({ buffalo: 4, dog: 8, hen: 34 }, 'animals');
  const group = new THREE.Group();
  group.name = 'life';
  group.add(crowd.group, herd.group);
  const S = { ch: null, u: 0, tau: 0, night: false };
  const person = (look, act, o = {}) => crowd.add({ look, act, ...o, skin: look.skinned ? new SkinnedFigure() : undefined });
  const put = (f, x, z, yaw, y) => { const p = f.pose; p.x = x; p.z = z; p.yaw = yaw; p.y = y ?? ground(x, z); return f; };
  const animal = (kind, act, o = {}) => {
    const a = herd.add({ kind, act, colors: o.colors ?? COATS[kind][0], ...o });
    a.ph ??= hashf(a.id * 5.3 + 2) * 10; a.tempo ??= 0.85 + hashf(a.id * 2.7) * 0.3;
    return a;
  };

  // ------------------------------------------------ in the fields
  for (const w of FIELD_WORK) {
    if (w.kind !== 'plant') continue;
    const P = w.plot, alongZ = P.rowsX; // the working edge runs along z when the rows run along x
    const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
    const n = len > 20 ? 4 : 3, start = hashf(P.seed * 13) * Math.max(0, len - n * 3);
    for (let i = 0; i < n; i++) {
      const s = start + i * (2.4 + hashf(P.seed * 7 + i) * 1.2) + 1;
      const k = Math.min(1, s / len);
      const off = 0.5 + hashf(P.seed * 3 + i) * 0.6;
      let x = lerp(w.a[0], w.b[0], k), z = lerp(w.a[1], w.b[1], k);
      if (alongZ) x += w.ahead * off; else z += w.ahead * off;
      // (facing the rows already planted, stepping back into the bare water)
      const yaw = alongZ ? (w.ahead > 0 ? -Math.PI / 2 : Math.PI / 2) : (w.ahead > 0 ? Math.PI : 0);
      const look = rnd() < 0.35 ? lookWoman({ skirt: undefined, shin: SKIN[0], shoes: dim(SKIN[0], 0.85) }) : lookFarmer();
      put(person(look, actPlant, { ambient: true }), x, z, yaw + (hashf(i + P.seed) - 0.5) * 0.5);
    }
  }
  // 种作: a gang weeding among the young rice, three more starting on the bare paddy beside it
  for (const [x, z, yaw] of [[110, -142, 0.2], [114.5, -146, -0.3], [119, -141.5, 0.1], [123, -147, 0.4], [135, -138.5, 3.0], [139.5, -139, 3.3], [144, -138.2, 3.1]]) {
    put(person(lookFarmer(), actPlant, { ambient: true }), x, z, yaw);
  }
  // and weeding the young wheat by the path, working away from it
  for (const [x, z, yaw] of [[111.5, -125.6, 0.15], [115, -124.2, -0.2], [118.6, -126.4, 0.3]]) {
    put(person(rnd() < 0.5 ? lookWoman({ skirt: undefined }) : lookFarmer(), actPlant, { ambient: true, weed: true }), x, z, yaw);
  }
  // hoeing the vegetable plots by the village and the fresh tilth
  for (const [x, z, yaw] of [[14, -196, 0.3], [30, -192, -0.2], [-14, -190, 0.8], [-9, -186, -0.5], [60, -185, 1.9], [78, -193, -1.2], [111, -178, 0.4], [58, -113, 1.4]]) {
    put(person(lookFarmer({ hat: rnd() < 0.4 ? STRAW : undefined }), actHoe, { ambient: true }), x, z, yaw);
  }
  // the ploughing teams
  const teams = [];
  for (const w of FIELD_WORK) {
    if (w.kind !== 'plough') continue;
    const dx = w.b[0] - w.a[0], dz = w.b[1] - w.a[1], L = Math.hypot(dx, dz);
    // (working the stretch at the end nearest the field path, where the walkers and the camera go by)
    const m = 3.2, run = Math.min(L - 2 * m, 13);
    const A = [w.a[0] + (dx / L) * m, w.a[1] + (dz / L) * m], B = [A[0] + (dx / L) * run, A[1] + (dz / L) * run];
    // (rowsX: the turned edge runs along x, so the next furrow is over in z)
    const path = stadium(A, B, w.plot.rowsX ? [0, w.ahead] : [w.ahead, 0], 2);
    const team = { path, speed: 0.55, s0: hashf(w.plot.seed * 5) * 100 };
    teams.push(team);
    const at = (t) => team.s0 + t * team.speed;
    const buffalo = animal('buffalo', (t, p) => {
      still(p);
      const s = at(t) + TEAM_GAP, q = path(s), q2 = path(s + 0.3);
      p.x = q[0]; p.z = q[1]; p.y = ground(p.x, p.z);
      p.yaw = Math.atan2(q2[0] - q[0], q2[1] - q[1]);
      gait(p, s * TAU / 1.6, 0.85);
      p.headPitch = -0.15 + Math.sin(s * TAU / 1.6 * 2) * 0.04;
      p.tail = 0.1; p.wag = Math.sin(t * 1.1 + 3) * 0.25;
    }, { colors: COATS.buffalo[teams.length % 2] });
    const plough = { kind: 'plough', at: [0, 0, 0], rot: null };
    person(lookFarmer({ hat: STRAW }), (t, p, f) => {
      reset(p);
      const s = at(t), q = path(s), b = buffalo.pose;
      p.x = q[0]; p.z = q[1]; p.y = ground(p.x, p.z);
      const yx = b.x + Math.sin(b.yaw) * 0.66, yz = b.z + Math.cos(b.yaw) * 0.66;
      face(p, yx, yz);
      walkCycle(p, s * TAU / 1.25, 0.6);
      p.bend = 0.22; p.lean = 0.04;
      p.armR = 0.92; p.armL = 0.92; p.elbowR = p.elbowL = 0.12; p.outR = p.outL = 0.03;
      p.headPitch = 0.05;
      p.prop2 = plough;
    }, { ambient: true });
  }
  // along the 阡陌: carriers, a woman with the midday basket, a man with his hoe
  const paths = [
    { path: [[-30, -132.2], [40, -132.2]], carry: 'pole', look: lookFarmer() },
    { path: [[0.2, -110], [0.2, -200]], carry: 'hoe', look: lookFarmer() },
    { path: [[104, -100], [104, -168]], carry: 'pole', look: lookFarmer() },
    { path: [[60, -132.2], [150, -132.2]], carry: 'basket', look: lookWoman() },
    { path: [[-104, -100], [-104, -200]], carry: 'basket', look: lookWoman() },
    { path: [[-56, -140], [-56, -200]], carry: 'hoe', look: lookFarmer() },
    { path: [[-150, -168.2], [-60, -168.2]], carry: null, look: lookMan() },
  ];
  for (const w of paths) person(w.look, actWalk, { ambient: true, path: w.path, carry: w.carry, pause: 5 + rnd() * 6, speed: 0.95 + rnd() * 0.2 });
  // the lanes of the village
  const laneFolk = [
    [0, 'pole', lookMan()], [0, 'basket', lookWoman()], [0, null, lookElder()], [1, 'basket', lookWoman()], [1, 'hoe', lookFarmer()],
    [2, null, lookMan()], [2, 'pole', lookFarmer()], [3, 'basket', lookWoman()], [5, null, lookWoman()], [6, 'hoe', lookMan()], [7, null, lookMan()],
  ];
  for (const [li, c, look] of laneFolk) person(look, actWalk, { ambient: true, path: LANES[li], carry: c, pause: 4 + rnd() * 8, speed: look.skirt ? 0.9 : 1.05 });
  // at the pond: women washing, facing the water
  const washAt = [];
  for (const ang of [2.1, 2.45, 3.4]) {
    // march out from the middle of the pond along a ray until the ground is dry underfoot
    let r = 5, x = 0, z = 0;
    for (; r < 60; r += 0.2) { x = POND.x + Math.sin(ang) * r; z = POND.z + Math.cos(ang) * r; if (pondDist(x, z) > 0.55) break; }
    washAt.push([x, z]);
  }
  for (const [x, z] of washAt) {
    const f = person(lookWoman({ kerchief: pick(KERCH) }), actWash, { ambient: true });
    put(f, x, z, Math.atan2(POND.x - x, POND.z - z));
    f.basket = { kind: 'basket', at: [0.55, 0.22, -0.25], rot: null };
  }
  // at the wells
  for (const [i, wl] of WELLS.entries()) {
    const [x, z] = wl.p, a = 0.7 + i * 2.1;
    const f = person(i ? lookWoman() : lookMan(), actWell, { ambient: true });
    put(f, x + Math.sin(a) * 0.95, z + Math.cos(a) * 0.95, a + Math.PI);
    const g = person(lookWoman(), (t, p, ff) => { reset(p); stand(p, t, ff); talk(p, t, ff, 0.8); p.prop = 'pole'; p.propAt = 'shoulder'; p.armR = 0.5; p.elbowR = 2.2; p.outR = 0.25; }, { ambient: true });
    put(g, x + Math.sin(a + 1.4) * 2.2, z + Math.cos(a + 1.4) * 2.2, a + 1.4 + Math.PI);
  }
  // 黄发垂髫 under the old tree
  const TX = BIG_TREE.x, TZ = BIG_TREE.z;
  // (the old folk sit round a spot beside the trunk; the children play further out, on the open side)
  const E = [2.6, 2.0];
  const seats = [[-1, 0.15], [-0.55, -0.8], [0.35, -0.95]];
  for (const [i, [sx, sz]] of seats.entries()) {
    const dx = E[0] + sx * 1.35, dz = E[1] + sz * 1.35, yaw = Math.atan2(-sx, -sz);
    const x = TX + dx, z = TZ + dz, y = ground(x, z);
    crowd.addStatic('seat', x - Math.sin(yaw) * 0.12, y, z - Math.cos(yaw) * 0.12, yaw);
    const look = i === 1 ? lookOldWoman() : lookElder();
    put(person(look, actElderSit, { ambient: true, stoop: 0.25, lean0: 0 }), x, z, yaw, y);
  }
  // and one of them up and sweeping the lane beside them (the reference's sculpted old monk, repainted)
  const elder = makeElder();
  const ex = TX + E[0] + 4.9, ez = TZ + E[1] + 0.7;
  elder.position.set(ex, ground(ex, ez) - 0.02, ez);
  elder.rotation.y = -1.45;
  group.add(elder);
  const kidC = [TX - 0.5, TZ + 6.0];
  for (let i = 0; i < 3; i++) person(lookChild(), actChase, { ambient: true, scale: 0.58 + rnd() * 0.08, c: kidC, r: 1.8, lag: i * 0.9 });
  put(person(lookChild(), actHop, { ambient: true, scale: 0.6 }), TX + 1.5, TZ + 5.2, 2.6);
  put(person(lookChild({ top: CLOTH.indigoPale }), actPlay, { ambient: true, scale: 0.55 }), TX + 0.8, TZ + 4.0, 2.4);
  put(person(lookChild(), actPlay, { ambient: true, scale: 0.62 }), TX + 2.0, TZ + 4.4, -2.6);

  // ------------------------------------------------ animals about the place
  const hens = (cx, cz, n, r) => {
    for (let i = 0; i < n; i++) {
      animal('hen', actHen, { home: [cx, cz], r, slot: 4 + rnd() * 4, colors: COATS.hen[Math.floor(rnd() * 4)], scale: i === 0 ? 1.2 : 0.9 + rnd() * 0.2 });
    }
  };
  hens(TX + 6.5, TZ + 1.5, 4, 2.6);
  hens(THRESH.x, THRESH.z, 6, 5);
  const hy = hostUV.yard, [hyx, hyz] = toWorld((hy.u0 + hy.u1) / 2 + 2.5, (hy.v0 + hy.v1) / 2 + 1.5);
  hens(hyx, hyz, 3, 1.6);
  for (const wl of WELLS) hens(wl.p[0] + 3, wl.p[1] - 2, 2, 2);
  hens(20, -202, 4, 3.5);
  hens(-62, -134.5, 2, 1.5);
  hens(66, -212, 3, 3);
  // dogs: one lying by the elders, one trotting the field path, others about the lanes
  const lying = animal('dog', (t, p, a) => { still(p); dogLie(p, t, a); }, { colors: COATS.dog[0] });
  put(lying, TX + 3.8, TZ - 0.5, -0.6);
  const trot = (path) => (t, p, a) => {
    still(p);
    const walking = follow(p, t, a, path, 1.5);
    p.y = ground(p.x, p.z);
    if (walking) { gait(p, t * 9 * a.tempo + a.ph, 1); p.headPitch = -0.1; p.tail = -0.8; p.wag = Math.sin(t * 8) * 0.2; }
    else { p.headPitch = -0.6; p.tail = -0.6; p.wag = Math.sin(t * 10) * 0.3; }
  };
  animal('dog', trot([[-46, -131.6], [-8, -131.6]]), { colors: COATS.dog[1], pause: 3 });
  animal('dog', actDogWander, { home: [THRESH.x - 4, THRESH.z + 3], r: 6, slot: 7, colors: COATS.dog[2] });
  animal('dog', actDogWander, { home: [ANCHORS.gather[0] + 4, ANCHORS.gather[2]], r: 4, slot: 6, colors: COATS.dog[0], scale: 0.9 });
  animal('dog', trot(LANES[1]), { colors: COATS.dog[1], pause: 6, scale: 1.1 });
  // a buffalo grazing by the pond with a child astride it
  const grazeHome = [POND.x + 22, POND.z + 16];
  const grazer = animal('buffalo', (t, p, a) => {
    still(p);
    const m = wanderAt(a, t, 0.35);
    p.x = m.x; p.z = m.z; p.y = ground(p.x, p.z); p.yaw = m.yaw;
    if (m.walking) { gait(p, m.dist * TAU / 1.6, 0.8); p.headPitch = -0.3; }
    else { p.headPitch = -0.95 + Math.sin(t * 0.8 + a.ph) * 0.08; p.pitch = -0.08; p.headYaw = Math.sin(t * 0.3) * 0.25; }
    p.tail = 0.1; p.wag = Math.sin(t * 1.3 + a.ph) * 0.35;
  }, { home: grazeHome, r: 5, slot: 14, colors: COATS.buffalo[1], skip: new Set(['yoke']) });
  const riderM = new THREE.Matrix4();
  person(lookChild(), (t, p, f) => {
    reset(p);
    const b = grazer.pose;
    f.parent = riderM.makeRotationY(b.yaw).setPosition(b.x, b.y + 1.02 + b.bob + 0.33, b.z);
    p.x = 0; p.z = -0.15; p.y = -0.82 * f.scale + 0.06; p.yaw = 0;
    p.legL = p.legR = 0.35; p.kneeL = p.kneeR = 0.7; p.spread = 0.95;
    p.armL = 0.5; p.elbowL = 1.0; p.armR = 0.3 + Math.max(0, Math.sin(t * 0.5)) * 1.8; p.elbowR = 0.3; p.outR = 0.35;
    p.bend = 0.1 + Math.sin(t * 1.7) * 0.03;
    p.headYaw = Math.sin(t * 0.4 + 1) * 0.6;
  }, { ambient: true, scale: 0.6 });

  // ================================================ the fisherman's visit
  const W = (u, v) => toWorld(u, v);
  const cast = (name, look, act, o = {}) => person(look, act, { cast: name, ...o });

  // ---- 问讯: met on the path below the cave; startled, then asking; he answers, pointing back up the hill
  {
    const FX = -0.4, FZ = -101.5;
    cast('问讯', lookFisher, (t, p, f) => {
      reset(p);
      const u = S.u;
      const w = ss(0, 0.2, u);
      p.x = FX; p.z = lerp(FZ + 1.4, FZ, w); p.y = ground(p.x, p.z); p.yaw = Math.PI;
      if (w < 1) walkCycle(p, t * 5.5, 0.9 * (1 - w)); else stand(p, t, f, 0.6);
      // (the villagers' startle stops him short)
      if (u > 0.22 && u < 0.4) { p.lean = -0.05; p.armL = p.armR = 0.3; p.elbowL = p.elbowR = 0.6; }
      // (具答之) answering, pointing back the way he came: turned at the waist, the arm up toward the mountain
      if (u > 0.64) talk(p, t, f, 1);
      const pt = ss(0.7, 0.76, u) * (1 - ss(0.93, 0.99, u));
      p.twist = lerp(p.twist, 1.0, pt); p.headYaw = lerp(p.headYaw, 0.9, pt);
      p.armR = lerp(p.armR, 2.0, pt); p.outR = lerp(p.outR, 0.55, pt); p.elbowR = lerp(p.elbowR, 0.1, pt);
      p.headPitch = lerp(p.headPitch, 0.25, pt);
    });
    const folk = [
      { look: lookFarmer({ hat: undefined }), at: [-1.5, -105], yaw: 0.25, carry: 'hoe', startle: 1 },
      { look: lookWoman(), at: [0.9, -105.6], yaw: -0.2, carry: 'basket', startle: 0.8 },
      { look: lookChild(), at: [1.7, -106.6], yaw: -0.35, scale: 0.6, startle: 1.2 },
    ];
    for (const d of folk) {
      cast('问讯', d.look, (t, p, f) => {
        reset(p);
        const u = S.u;
        const arrive = ss(0, 0.16, u);
        p.x = d.at[0]; p.z = lerp(d.at[1] - 1.6, d.at[1], arrive); p.y = ground(p.x, p.z); p.yaw = d.yaw;
        if (arrive < 1) walkCycle(p, t * 5.5 + f.ph, 0.9 * (1 - arrive)); else stand(p, t, f, 0.6);
        carry(p, t, f);
        // 乃大惊: drawing back, hands up, staring
        const st = ss(0.22, 0.27, u) * (1 - ss(0.42, 0.5, u)) * d.startle;
        p.lean = lerp(p.lean, -0.12, st); p.bend = lerp(p.bend, -0.08, st);
        p.legR = lerp(p.legR, -0.3, st); p.kneeR = lerp(p.kneeR, 0.15, st);
        if (d.carry !== 'hoe') { p.armL = lerp(p.armL, 1.0, st); p.elbowL = lerp(p.elbowL, 1.4, st); p.outL = lerp(p.outL, 0.3, st); }
        if (!d.carry) { p.armR = lerp(p.armR, 1.0, st); p.elbowR = lerp(p.elbowR, 1.4, st); }
        lookAt(p, FX, ground(FX, FZ) + 1.55, FZ, 0.6, 1.5 * (f.scale ?? 1));
        // 问所从来: the man asks, the others crane to listen
        if (u > 0.4) talk(p, t, f, d.carry === 'hoe' ? (u < 0.66 ? 1 : 0.25) : 0.3, 'L');
        if (d.scale) { p.headYaw += Math.sin(t * 2.3) * 0.1; }
        if (d.carry === 'hoe') { p.prop = 'hoe'; p.propAt = 'R'; p.propFrame = 'root'; p.propRot = (f._r2 ??= new THREE.Euler()).set(-3.05, 0, 0); p.armR = 0.55; p.elbowR = 0.9; p.propOff = 0; }
      }, { scale: d.scale, carry: d.carry });
    }
    const dog = animal('dog', (t, p, a) => {
      still(p);
      p.x = 2.4; p.z = -104.2; p.y = ground(p.x, p.z); p.yaw = -0.7;
      // barking: the head thrown up, the forelegs braced
      const b = Math.max(0, Math.sin(t * 7)) * (S.u > 0.18 && S.u < 0.55 ? 1 : 0.2);
      p.headPitch = 0.1 + b * 0.25; p.legs[0] = p.legs[1] = 0.2; p.pitch = 0.05 + b * 0.05;
      p.tail = -0.7; p.wag = Math.sin(t * 10) * 0.2;
    }, { colors: COATS.dog[2] });
    dog.cast = '问讯';
  }

  // ---- 作食: at the low table already set in the host's yard (village.js); wine poured, the chicken served, the wife to and fro
  {
    const TU = hostUV.u + 0.6, TV = hostUV.yard.v0 + 2.1, ty = ground(...W(TU, TV));
    // the guest on the mat at the table's west end, the host on the one along its house side
    const [fx, fz] = W(TU - 1.45, TV), [hx, hz] = W(TU + 0.15, TV - 1.05);
    const guest = cast('作食', lookFisher, (t, p, f) => {
      reset(p);
      kneel(p);
      // eating, bowing his thanks now and then
      const g = t * f.tempo * 0.8 + f.ph, eat = Math.max(0, Math.sin(g)) ** 2;
      p.armR = 0.7 + eat * 0.5; p.elbowR = 0.9 + eat * 1.1; p.outR = 0.12;
      p.armL = 0.55; p.elbowL = 1.2; p.outL = 0.12;
      const bow = ss(0.28, 0.4, S.u) * (1 - ss(0.62, 0.75, S.u));
      p.bend = 0.12 + bow * 0.35; p.headPitch = -0.12 - eat * 0.15;
      p.prop = 'cup'; p.propAt = 'R'; p.propFrame = 'root';
    });
    put(guest, fx, fz, yawL(1, 0), ty);
    const host = cast('作食', lookMan({ top: CLOTH.hemp, bottom: CLOTH.brownDark, beard: true }), (t, p, f) => {
      reset(p);
      kneel(p);
      // pouring from the jar, then lifting his cup to the guest
      const q = (t * 0.16 * f.tempo + f.ph) % 1;
      const pour = ss(0.05, 0.12, q) * (1 - ss(0.3, 0.36, q)), toast = ss(0.5, 0.56, q) * (1 - ss(0.72, 0.8, q));
      p.bend = 0.1 + pour * 0.35;
      p.armR = lerp(0.6, 1.25, pour); p.elbowR = lerp(1.0, 0.5, pour); p.outR = 0.12;
      p.armR = lerp(p.armR, 1.35, toast); p.elbowR = lerp(p.elbowR, 1.5, toast);
      p.armL = lerp(0.55, 0.9, toast); p.elbowL = lerp(1.1, 1.6, toast);
      talk(p, t, f, 1 - Math.max(pour, toast), 'L');
      p.prop = 'cup'; p.propAt = 'R'; p.propFrame = 'root';
    });
    put(host, hx, hz, yawL(0, 1), ty);
    // the wife between the kitchen and the table
    const [kx, , kz] = ANCHORS.hostKitchen, [ku, kv] = toLocal(kx, kz);
    const trip = [W(ku + 0.6, kv + 0.4), W(TU - 0.9, TV + 1.1)];
    cast('作食', lookWoman({ kerchief: CLOTH.hemp }), (t, p, f) => {
      reset(p);
      const walking = follow(p, t, f, trip, 0.8);
      p.y = ground(p.x, p.z);
      if (walking) { p.prop = 'tray'; p.propAt = 'R'; p.propFrame = 'root'; p.armR = p.armL = 0.95; p.elbowR = p.elbowL = 0.95; p.outR = p.outL = 0.02; }
      else talk(p, t, f, 0.6);
    }, { pause: 2.5, ph: 0.3 });
  }

  // ---- 咸来: the neighbours come along the lane and crowd about the host's gate
  {
    const GU = hostUV.yard.u0 + (hostUV.yard.u1 - hostUV.yard.u0) * hostUV.yard.gate, GV = hostUV.yard.v1;
    const [gx, gz] = W(GU, GV + 0.6);
    const fisher = cast('咸来', lookFisher, (t, p, f) => { reset(p); stand(p, t, f, 0.6); talk(p, t, f, 1); });
    put(fisher, gx - 0.45, gz, yawL(0, 1));
    const host = cast('咸来', lookMan({ top: CLOTH.hemp, bottom: CLOTH.brownDark, beard: true }), (t, p, f) => {
      reset(p); stand(p, t, f, 0.6); p.armL = 0.4; p.elbowL = 0.6; p.outL = 0.3; talk(p, t, f, 0.4);
    });
    put(host, ...W(GU + 0.7, GV + 0.35), yawL(0.4, 1));
    const who = [lookWoman(), lookMan(), lookElder(), lookWoman(), lookChild(), lookFarmer({ hat: undefined }), lookWoman(), lookChild(), lookMan()];
    who.forEach((look, i) => {
      const side = i % 3 === 1 ? -1 : 1; // most come down the lane from the east, a few from the west
      const ang = (i / (who.length - 1) - 0.5) * 2.3, r = 2.3 + (i % 3) * 0.7;
      const eu = GU + Math.sin(ang) * r * 1.3, ev = GV + 0.6 + Math.cos(ang) * r * 0.75 + 0.6;
      // (each in a lane of their own, the nearer setting out first, so nobody walks through anybody)
      const su = eu + side * (2.2 + (i % 4) * 0.7), sv = ev + [-0.5, 0, 0.5][i % 3];
      const [sx, sz] = W(su, sv), [ex, ez] = W(eu, ev);
      const d = Math.hypot(ex - sx, ez - sz), start = (i % 5) * 0.22 + hashf(i) * 0.15, sp = look.skirt ? 1.2 : 1.35;
      const child = look === who[4] || look === who[7];
      cast('咸来', look, (t, p, f) => {
        reset(p);
        const k = clamp((S.tau - start) * sp / d, 0, 1);
        p.x = lerp(sx, ex, k); p.z = lerp(sz, ez, k); p.y = ground(p.x, p.z);
        if (k > 0 && k < 1) { p.yaw = Math.atan2(ex - sx, ez - sz); walkCycle(p, t * 5.6 * sp + f.ph, child ? 1.1 : 0.95, child ? 0.5 : 0); }
        else {
          if (k >= 1) face(p, gx, gz); else p.yaw = Math.atan2(ex - sx, ez - sz);
          stand(p, t, f, 0.6);
          if (k >= 1) {
            lookAt(p, gx, ground(gx, gz) + 1.5, gz, 0.8, 1.5 * (f.scale ?? 1));
            talk(p, t, f, 0.7, i % 2 ? 'L' : 'R');
            // standing on tiptoe to see over the others
            if (child) { p.bob = Math.max(0, Math.sin(t * 3 + i)) * 0.06; p.headPitch += 0.15; }
          }
        }
        if (look === who[3]) { p.prop = 'basket'; p.propAt = 'L'; p.propFrame = 'root'; p.armL = 0.35; p.elbowL = 1.4; p.outL = 0.3; }
      }, { scale: child ? 0.6 : undefined, stoop: look === who[2] ? 0.3 : 0 });
    });
  }

  // ---- 叹惋: he kneels at the edge of the porch and tells of the world outside; they sigh and shake their heads
  {
    const PU = -32.5, PV = hostUV.v + hostUV.d / 2 + hostUV.porch * 0.55;
    const [px, pz] = W(PU, PV);
    const py = PLINTH;
    const teller = cast('叹惋', lookFisher, (t, p, f) => {
      reset(p); kneel(p);
      talk(p, t, f, 1, 'R'); talk(p, t + 3.1, f, 0.7, 'L');
      p.bend = 0.06 + Math.sin(t * 0.7) * 0.03;
      // (turning to take them all in)
      p.headYaw = Math.sin(t * 0.23 * f.tempo + f.ph) * 0.55; p.twist = p.headYaw * 0.3;
    });
    put(teller, px, pz, yawL(0, 1), py);
    const host = cast('叹惋', lookMan({ top: CLOTH.hemp, bottom: CLOTH.brownDark, beard: true }), (t, p, f) => {
      reset(p); kneel(p);
      p.armL = p.armR = 0.45; p.elbowL = p.elbowR = 1.1; p.outL = p.outR = 0.15;
      lookAt(p, px, py + 0.85, pz, 1, 0.9);
      const sigh = ss(0.8, 0.9, S.u);
      p.bend = 0.1 + sigh * (0.2 + Math.sin(t * 0.5) * 0.05); p.headPitch -= sigh * 0.3;
    });
    put(host, ...W(PU - 1.7, PV + 0.25), yawL(0.8, 0.5), py);
    // listeners: kneeling on the mats of the yard table (village.js) and below the porch, the rest standing about
    // (clear of the table itself, and of the line from the camera to him)
    const L = [
      { look: lookElder(), at: [-0.8, 1.33], kneel: true, react: 'shake' },
      { look: lookOldWoman(), at: [0.75, 1.83], kneel: true, react: 'mouth' },
      { look: lookMan(), at: [1.55, 1.98], kneel: true, react: 'bow' },
      { look: lookWoman(), at: [-0.35, 2.68], kneel: true, react: 'shake' },
      { look: lookElder({ hair: HAIR.grey }), at: [-1.9, 1.63], stoop: 0.3, react: 'eyes' },
      { look: lookFarmer({ hat: undefined }), at: [-2.2, 3.03], react: 'bow' },
      { look: lookWoman(), at: [-1.2, 4.23], react: 'mouth' },
      { look: lookChild(), at: [2.4, 1.03], scale: 0.62, react: 'look' },
      { look: lookMan(), at: [3.2, 1.73], react: 'shake' },
    ];
    for (const d of L) {
      const [x, z] = W(PU + d.at[0], PV + d.at[1]);
      const f = cast('叹惋', d.look, (t, p, f) => {
        reset(p);
        if (d.kneel) kneel(p); else stand(p, t, f, 0.4);
        p.armL = p.armR = d.kneel ? 0.45 : 0.1; p.elbowL = p.elbowR = d.kneel ? 1.0 : 0.25;
        lookAt(p, px, py + 0.9, pz, 1, (d.kneel ? 0.95 : 1.5) * (f.scale ?? 1));
        // 皆叹惋: as the telling goes on, each takes it in their own way
        const k = ss(0.62 + hashf(f.id) * 0.16, 0.76 + hashf(f.id) * 0.12, S.u);
        const g = t * f.tempo + f.ph;
        if (d.react === 'shake') { p.headYaw += Math.sin(g * 4.5) * 0.28 * k * (0.5 + 0.5 * Math.sin(g * 0.7)); p.headPitch -= 0.15 * k; }
        if (d.react === 'bow') { p.headPitch -= 0.45 * k; p.bend += 0.2 * k; }
        if (d.react === 'mouth') { p.armR = lerp(p.armR, 1.7, k); p.elbowR = lerp(p.elbowR, 2.3, k); p.outR = lerp(p.outR, 0.05, k); p.headPitch -= 0.1 * k; }
        if (d.react === 'eyes') { const w = Math.max(0, Math.sin(g * 0.6)); p.armL = lerp(p.armL, 1.6, k * w); p.elbowL = lerp(p.elbowL, 2.4, k * w); p.headPitch -= 0.25 * k; }
        if (d.react === 'look') { p.headYaw += Math.sin(g * 0.5) * 0.3; }
        if (d.kneel) p.bend += 0.08;
      }, { scale: d.scale, stoop: d.stoop });
      put(f, x, z, yawL(-d.at[0], -d.at[1]));
    }
  }

  // ---- 勿道: seen off at the foot of the path; the host stops, lifts a hand; the fisherman climbs on
  {
    const pathAt = (s) => { const a = descentPoint(s), b = descentPoint(s - 0.01); return { x: a.x, z: a.z, y: surfaceHeight(a.x, a.z), yaw: Math.atan2(b.x - a.x, b.z - a.z) }; };
    cast('勿道', lookFisher, (t, p, f) => {
      reset(p);
      const s = lerp(0.93, 0.66, ss(0.04, 1, S.u)), q = pathAt(s);
      p.x = q.x; p.y = q.y; p.z = q.z; p.yaw = q.yaw;
      walkCycle(p, S.tau * 5.2, 0.95);
      p.bend = 0.14;
      // one look back
      const back = ss(0.38, 0.46, S.u) * (1 - ss(0.66, 0.74, S.u));
      p.twist = back * 0.7; p.headYaw = back * 1.1;
      p.armL = lerp(p.armL, 1.4, back * 0.8); p.outL = lerp(p.outL, 0.5, back); p.elbowL = lerp(p.elbowL, 0.4, back);
    });
    cast('勿道', lookMan({ top: CLOTH.hemp, bottom: CLOTH.brownDark, beard: true }), (t, p, f) => {
      reset(p);
      const k = ss(0, 0.3, S.u), s = lerp(0.955, 0.875, k), q = pathAt(s);
      p.x = q.x + 0.7; p.y = surfaceHeight(q.x + 0.7, q.z); p.z = q.z; p.yaw = q.yaw;
      if (k < 1) walkCycle(p, S.tau * 5.2 + 1.3, 0.9 * (1 - ss(0.22, 0.3, S.u)));
      else stand(p, t, f, 0.4);
      // 不足为外人道也: stopping, turning up to call after him, a hand raised
      const stop = ss(0.24, 0.32, S.u);
      const fz = descentPoint(lerp(0.93, 0.66, ss(0.04, 1, S.u)));
      p.yaw = lerp(p.yaw, Math.atan2(fz.x - p.x, fz.z - p.z), stop);
      p.armR = lerp(p.armR, 2.2 + Math.sin(t * 5) * 0.12 * stop, stop); p.outR = lerp(p.outR, 0.3, stop); p.elbowR = lerp(p.elbowR, 0.5, stop);
      p.headPitch = lerp(p.headPitch, 0.3, stop);
    });
  }

  group.userData = {
    crowd, herd,
    update(t, camera, story, ch) {
      S.ch = ch?.name ?? null;
      S.u = story.u; S.tau = story.u * (ch?.dur ?? 1);
      S.night = G.uNight.value > 0.5;
      for (const f of crowd.figures) f.visible = f.cast ? f.cast === S.ch : !S.night;
      for (const a of herd.animals) a.visible = a.cast ? a.cast === S.ch : !S.night || a.kind === 'dog';
      elder.visible = !S.night;
      herd.update(t, camera);
      crowd.update(t, camera);
    },
  };
  return group;
}
