// 渔人: the fisherman is the reference scene's boatman, a sculpted and skinned figure in a 斗笠 and a 蓑衣
// (assets-src/web/ref/boatman.msh). Its own texture did not come with it, so the figure is painted here by region
// (hat, straw cape, hemp jacket, trousers, leg wraps, skin), from its bones' weights and its rest shape.
// It is driven by the same pose as the voxel figures: each frame the box rig's joint frames are worked out
// just as Crowd does, and every bone is turned to match its part, so all the fisherman's actions (poling,
// looking, stooping to the rope, walking, sitting at the table) carry over unchanged.
import * as THREE from 'three';
import { loadSKN } from '../core/msh.js';
import { hook } from '../core/shared.js';
import { clamp, lerp } from '../core/rng.js';
import { BODY, SKIN, HAIR } from './crowd.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const ss = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// the palette: plain undyed and grey-brown country stuff, straw that has weathered grey
const PAINT = {
  hat: [0.56, 0.5, 0.4], cape: [0.47, 0.43, 0.34], jacket: [0.57, 0.53, 0.44], trousers: [0.32, 0.33, 0.37],
  belt: [0.3, 0.27, 0.23], wraps: [0.66, 0.63, 0.55], sole: [0.46, 0.41, 0.33], skin: SKIN[0], hair: HAIR.black,
};

let SRC = null;
export async function loadBoatman() {
  if (SRC) return SRC;
  const s = await loadSKN(new URL('../assets/ref/boatman.mshz', import.meta.url).href);
  paint(s);
  SRC = s;
  return s;
}

function paint(s) {
  const g = s.geometry, P = g.attributes.position, SI = g.attributes.skinIndex, SW = g.attributes.skinWeight;
  const idx = (n) => s.bones.findIndex((b) => b.name === n);
  const group = {};
  const put = (names, k) => { for (const n of names) group[idx(n)] = k; };
  put(['neck', 'Head', 'head_end', 'headfront'], 'head');
  put(['Spine02', 'Spine01', 'Spine', 'LeftShoulder', 'RightShoulder'], 'spine');
  put(['LeftArm', 'LeftForeArm', 'RightArm', 'RightForeArm'], 'arm');
  put(['LeftHand', 'RightHand', 'LFing1', 'LFing2', 'LThumb', 'RFing1', 'RFing2', 'RThumb'], 'hand');
  put(['Hips'], 'hips');
  put(['LeftUpLeg', 'RightUpLeg'], 'thigh');
  put(['LeftLeg', 'RightLeg'], 'shin');
  put(['LeftFoot', 'LeftToeBase', 'RightFoot', 'RightToeBase'], 'foot');
  const spine = idx('Spine');
  const C = new Float32Array(P.count * 3), straw = new Float32Array(P.count), cape = new Float32Array(P.count);
  const w = {};
  for (let i = 0; i < P.count; i++) {
    for (const k in w) w[k] = 0;
    let wSpine = 0;
    for (let j = 0; j < 4; j++) {
      const b = SI.getComponent(i, j), q = SW.getComponent(i, j), k = group[b] ?? 'spine';
      w[k] = (w[k] ?? 0) + q;
      if (b === spine) wSpine += q;
    }
    let top = 'spine', best = -1;
    for (const k in w) if (w[k] > best) { best = w[k]; top = k; }
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    let c = PAINT.jacket, st = 0;
    if (top === 'head') {
      const r = Math.hypot(x, z - 0.01);
      // (the hat stays on: the sculpt's head under it is only roughed out)
      if ((y > 1.5 && r > 0.135) || (y > 1.575 && r > 0.118) || y > 1.63) { c = PAINT.hat; st = 1; }
      else if (z < -0.02 && y > 1.47) c = PAINT.hair;
      else c = PAINT.skin;
    } else if (top === 'hand') c = PAINT.skin;
    else if (top === 'foot') c = y < 0.035 ? PAINT.sole : PAINT.skin;
    else if (top === 'shin') c = y < 0.44 ? PAINT.wraps : PAINT.trousers;
    else if (top === 'thigh') c = PAINT.trousers;
    else if (top === 'hips') c = y > 0.94 ? PAINT.belt : PAINT.trousers;
    else if (top === 'arm') c = PAINT.jacket;
    else if (y < 1.02 && y > 0.94) c = PAINT.belt;
    // the mino: what stands off the torso over the shoulders and back (the reference's own cape mask)
    const S = Math.hypot(x / 0.2, (z - 0.01) / 0.14);
    const k = Math.min(1, wSpine * 1.6) * ss(1, 1.45, S) * (1 - ss(1.3, 1.47, y));
    cape[i] = k * (0.2 + 0.8 * ss(1.35, 0.85, y));
    const m = ss(0.35, 0.6, k);
    if (m > 0) { c = c.map((v, j) => lerp(v, PAINT.cape[j], m)); st = Math.max(st, m); }
    C.set(c, i * 3);
    straw[i] = st;
  }
  g.setAttribute('color', new THREE.BufferAttribute(C, 3));
  g.setAttribute('aStraw', new THREE.BufferAttribute(straw, 1));
  g.setAttribute('aCape', new THREE.BufferAttribute(cape, 1));
}

function boatmanMaterial() {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
  return hook(mat, 'boatman', (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute float aStraw, aCape; varying float vStraw; varying vec3 vBind;`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n vStraw = aStraw; vBind = position;')
      .replace('#include <skinning_vertex>', `#include <skinning_vertex>
      // the straws of the mino stir in the wind
      if (aCape > 0.001) {
        float ph = uTime * 3.1 + position.y * 11.0 + position.x * 7.0 + position.z * 5.0;
        transformed += vec3(sin(ph), 0.3 * sin(ph * 1.7 + 1.0), cos(ph * 1.3)) * (0.003 + 0.006 * uWind.z) * aCape;
      }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vStraw; varying vec3 vBind;')
      .replace('#include <color_fragment>', `#include <color_fragment>
      {
        // straw: tiers lapped downward, streaked along the stalks (the hat's run out from its crown)
        vec3 b = vBind;
        float hatK = step(1.5, b.y) * step(0.1, length(b.xz));
        float ang = atan(b.x, b.z - 0.01);
        float r = length(vec2(b.x, b.z - 0.01));
        float tier = fract(mix(-b.y * 13.0, r * 26.0, hatK) + vnoise(vec2(ang * 3.0, 0.0)) * 0.3);
        float streak = vnoise(vec2(ang * mix(34.0, 60.0, hatK), mix(b.y * 6.0, r * 3.0, hatK)));
        float strawK = mix(0.72, 1.08, smoothstep(0.05, 0.85, tier)) * (0.8 + 0.34 * streak);
        // cloth: a faint weave and wear
        float cloth = 0.93 + 0.1 * vnoise(b.xy * 90.0) + 0.05 * vnoise(b.zy * 23.0);
        diffuseColor.rgb *= mix(cloth, strawK, vStraw);
      }`);
  });
}

// ---------------------------------------------------------------- the box rig's frames, as Crowd builds them
const B = BODY;
const _q = new THREE.Quaternion();
const X = V(1, 0, 0), Y = V(0, 1, 0), Z = V(0, 0, 1);
const rot = (q, axis, a) => q.multiply(_q.setFromAxisAngle(axis, a));
const ARM_MAX = 1.5;

// rotations of the parts in the figure's own frame; side -1 is the figure's -x side
function frames(p, f, F) {
  const st = f.stoop ?? 0;
  F.pelvis.identity(); rot(F.pelvis, X, p.lean);
  for (const side of [-1, 1]) {
    const k = side < 0 ? 0 : 1;
    const fwd = side < 0 ? p.legL : p.legR, knee = side < 0 ? p.kneeL : p.kneeR;
    rot(rot(F.thigh[k].copy(F.pelvis), Z, side * p.spread), X, -fwd);
    rot(F.shin[k].copy(F.thigh[k]), X, knee);
    rot(F.foot[k].copy(F.shin[k]), X, fwd - knee - p.lean);
  }
  rot(rot(rot(F.torso.copy(F.pelvis), Y, p.twist), X, p.bend + st), Z, p.roll);
  rot(rot(F.neck.copy(F.torso), Y, p.headYaw), X, -p.headPitch - st * 0.6);
  for (const side of [-1, 1]) {
    const k = side < 0 ? 0 : 1;
    // (an arm raised much above the shoulder drags the mino's straw up with it: the sculpt's cape is one skin with the arm)
    const fwd = Math.min(side < 0 ? p.armL : p.armR, ARM_MAX), out = side < 0 ? p.outL : p.outR, el = side < 0 ? p.elbowL : p.elbowR;
    rot(rot(F.ua[k].copy(F.torso), Z, side * out), X, -fwd);
    rot(F.fa[k].copy(F.ua[k]), X, -el);
  }
  F.spine[0].slerpQuaternions(F.pelvis, F.torso, 0.35);
  F.spine[1].slerpQuaternions(F.pelvis, F.torso, 0.7);
  F.neck0.slerpQuaternions(F.torso, F.neck, 0.4);
  return F;
}
const newFrames = () => {
  const q = () => new THREE.Quaternion();
  return { pelvis: q(), torso: q(), neck: q(), neck0: q(), spine: [q(), q()], thigh: [q(), q()], shin: [q(), q()], foot: [q(), q()], ua: [q(), q()], fa: [q(), q()] };
};

// ---------------------------------------------------------------- one skinned figure
export class SkinnedFigure {
  constructor() {
    const s = SRC;
    if (!s) throw new Error('loadBoatman() first');
    this.root = new THREE.Group();
    this.root.name = 'fisherman';
    this.root.matrixAutoUpdate = false;
    const holder = new THREE.Group();
    holder.scale.setScalar(0.01); // the bones are in centimetres, the mesh in metres
    this.root.add(holder);
    const bones = s.bones.map((b) => {
      const o = new THREE.Bone();
      o.name = b.name;
      o.position.fromArray(b.t); o.quaternion.fromArray(b.r); o.scale.fromArray(b.s);
      return o;
    });
    s.bones.forEach((b, i) => (b.parent >= 0 ? bones[b.parent] : holder).add(bones[i]));
    this.mat = boatmanMaterial();
    const mesh = new THREE.SkinnedMesh(s.geometry, this.mat);
    mesh.name = 'fisherman-mesh';
    mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = true;
    this.root.add(mesh);
    mesh.bind(new THREE.Skeleton(bones, s.bones.map((b) => new THREE.Matrix4().fromArray(b.ibm))), new THREE.Matrix4());
    this.mesh = mesh;
    this.bones = bones;
    this.parentOf = s.bones.map((b) => b.parent);
    this.rest = bones.map((b) => b.quaternion.clone());
    const by = Object.fromEntries(bones.map((b, i) => [b.name, i]));
    this.by = by;
    // (the box's -x side is the figure's anatomical right: it faces +z)
    const sideName = (k) => (k === 0 ? 'Right' : 'Left');
    // bone -> which frame drives it
    this.map = new Map();
    const set = (name, get) => this.map.set(by[name], get);
    set('Hips', (F) => F.pelvis);
    set('Spine02', (F) => F.spine[0]);
    set('Spine01', (F) => F.spine[1]);
    set('Spine', (F) => F.torso);
    set('neck', (F) => F.neck0);
    set('Head', (F) => F.neck);
    for (const k of [0, 1]) {
      const n = sideName(k);
      set(n + 'UpLeg', (F) => F.thigh[k]);
      set(n + 'Leg', (F) => F.shin[k]);
      set(n + 'Foot', (F) => F.foot[k]);
      set(n + 'Arm', (F) => F.ua[k]);
      set(n + 'ForeArm', (F) => F.fa[k]);
      set(n + 'Hand', (F) => F.fa[k]);
    }
    this.hand = [by.RightHand, by.LeftHand];
    // legs a little longer than the box figure's: crouches and kneels drop the hips in proportion
    this.root.updateMatrixWorld(true);
    const hp = bones[by.LeftUpLeg].getWorldPosition(V());
    this.legK = hp.y / B.hip;
    this._calibrate();
    this.F = newFrames();
    this.wq = bones.map(() => new THREE.Quaternion());
    this._v = V(); this._t = V(); this._s = V(); this._rq = new THREE.Quaternion();
  }

  // offsets from each driven part's frame to its bone, taken with the box rig at rest; the limbs are
  // first swung from the sculpt's A-pose onto the box rest pose (arms down at the sides, legs straight)
  _calibrate() {
    const { bones, by } = this;
    const F = frames(Object.assign({}, restPoseLite()), {}, newFrames());
    const world = (i) => bones[i].getWorldQuaternion(new THREE.Quaternion());
    const setWorld = (i, q) => {
      const pq = bones[i].parent.getWorldQuaternion(new THREE.Quaternion()).invert();
      bones[i].quaternion.copy(pq.multiply(q));
      bones[i].updateMatrixWorld(true);
    };
    const align = (name, child, frame) => {
      const i = by[name], a = bones[i].getWorldPosition(V()), b = bones[by[child]].getWorldPosition(V());
      const d0 = b.sub(a).normalize(), d1 = V(0, -1, 0).applyQuaternion(frame);
      setWorld(i, new THREE.Quaternion().setFromUnitVectors(d0, d1).multiply(world(i)));
    };
    this.root.updateMatrixWorld(true);
    for (const k of [0, 1]) {
      const n = k === 0 ? 'Right' : 'Left';
      align(n + 'Arm', n + 'ForeArm', F.ua[k]);
      align(n + 'ForeArm', n + 'Hand', F.fa[k]);
      align(n + 'UpLeg', n + 'Leg', F.thigh[k]);
      align(n + 'Leg', n + 'Foot', F.shin[k]);
    }
    this.off = new Map();
    for (const [i, get] of this.map) this.off.set(i, get(F).clone().invert().multiply(world(i)));
    for (let i = 0; i < bones.length; i++) bones[i].quaternion.copy(this.rest[i]);
  }

  // pose the figure: `root` is the figure's frame (placed, turned, scaled; on the boat, in its frame)
  drive(p, f, root) {
    this.root.matrix.copy(root);
    this.root.matrixWorldNeedsUpdate = true;
    const F = frames(p, f, this.F), { bones, wq, parentOf } = this;
    for (let i = 0; i < bones.length; i++) {
      const pi = parentOf[i];
      const get = this.map.get(i);
      if (get) {
        wq[i].copy(get(F)).multiply(this.off.get(i));
        if (pi >= 0) bones[i].quaternion.copy(_q.copy(wq[pi]).invert().multiply(wq[i]));
        else bones[i].quaternion.copy(wq[i]);
      } else {
        bones[i].quaternion.copy(this.rest[i]);
        wq[i].copy(pi >= 0 ? wq[pi] : _q.identity()).multiply(bones[i].quaternion);
      }
    }
  }

  // where the hand grips, for a held prop: the box hand's frame, moved to this figure's hand
  handMatrix(side, out) {
    const k = side < 0 ? 0 : 1;
    this.root.updateMatrixWorld(true);
    const pos = this.bones[this.hand[k]].getWorldPosition(this._v);
    this.root.matrix.decompose(this._t, this._rq, this._s);
    this._rq.multiply(this.F.fa[k]);
    return out.compose(pos, this._rq, this._s);
  }
}

function restPoseLite() {
  return { lean: 0, bend: 0, twist: 0, roll: 0, headYaw: 0, headPitch: 0, armL: 0.05, armR: 0.05, outL: 0.08, outR: 0.08,
    elbowL: 0.15, elbowR: 0.15, legL: 0, legR: 0, kneeL: 0, kneeR: 0, spread: 0.02 };
}
