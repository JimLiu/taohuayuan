// Voxel people: every figure is a dozen boxes on a small skeleton (pelvis, torso, head, two arms of two
// parts, two legs of two parts, a robe skirt, a hat), drawn as one InstancedMesh per part for the whole
// crowd, so fifty villagers cost the same draw calls as one. Each figure's pose is computed on the CPU
// every frame from its own action, phase and tempo: nobody moves in step with anybody else.
import * as THREE from 'three';
import { hook } from '../core/shared.js';
import { lerp, clamp } from '../core/rng.js';

// proportions of a grown man (metres); children and elders scale and stoop from these
export const BODY = { hip: 0.82, hipX: 0.1, thigh: 0.42, shin: 0.42, torso: 0.56, shX: 0.2, ua: 0.29, fa: 0.27, head: 0.24 };

// undyed hemp, greys, browns and a faded indigo: plain country cloth, no reds
export const CLOTH = {
  hemp: [0.67, 0.63, 0.54], hempDark: [0.55, 0.51, 0.43], grey: [0.5, 0.5, 0.48], greyDark: [0.36, 0.36, 0.35],
  brown: [0.48, 0.39, 0.3], brownDark: [0.34, 0.28, 0.22], indigo: [0.3, 0.34, 0.44], indigoPale: [0.46, 0.5, 0.58],
  ochre: [0.58, 0.5, 0.37], white: [0.74, 0.72, 0.66],
};
export const SKIN = [[0.78, 0.6, 0.46], [0.72, 0.54, 0.4], [0.82, 0.66, 0.52], [0.66, 0.5, 0.38]];
export const HAIR = { black: [0.1, 0.09, 0.08], grey: [0.56, 0.55, 0.52], pale: [0.78, 0.74, 0.62] };
export const STRAW = [0.56, 0.5, 0.4]; // grey-brown, never golden

// a box with its pivot at `py` (0: bottom face at the pivot, 1: top face), shaded darker toward its base
function box(w, h, d, py = 0, taper = 1, dark = 0.8) {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  g.deleteAttribute('uv');
  const P = g.attributes.position, C = new Float32Array(P.count * 3);
  for (let i = 0; i < P.count; i++) {
    const y = P.getY(i), t = y / h + 0.5;
    // (taper narrows the far end: robes flare, limbs thin toward the hand)
    const k = lerp(1, taper, py > 0.5 ? 1 - t : t);
    P.setX(i, P.getX(i) * k);
    P.setZ(i, P.getZ(i) * k);
    P.setY(i, y + h * (0.5 - py));
    const s = lerp(dark, 1, t);
    C.set([s, s, s], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(C, 3));
  g.computeVertexNormals();
  return g;
}
function cone(r, h, seg = 10) {
  const g = new THREE.ConeGeometry(r, h, seg, 1, false).toNonIndexed();
  g.deleteAttribute('uv');
  g.translate(0, h / 2, 0);
  const n = g.attributes.position.count, C = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const s = lerp(0.72, 1, g.attributes.position.getY(i) / h); C.set([s, s, s], i * 3); }
  g.setAttribute('color', new THREE.BufferAttribute(C, 3));
  g.computeVertexNormals();
  return g;
}

// the part list: geometry in the part's own frame, pivot at its joint
const B = BODY;
const PARTS = {
  torso: () => box(0.34, B.torso, 0.21, 0, 0.9),
  head: () => box(0.19, B.head, 0.2, 0, 1, 0.9),
  hair: () => {                                           // the top and back of the head, or a kerchief
    const back = box(0.2, 0.14, 0.05, 1, 1, 0.9);
    back.translate(0, 0, -0.085);
    return merge([box(0.2, 0.09, 0.21, 0, 1, 0.9), back]);
  },
  eyes: () => merge([-1, 1].map((s) => box(0.036, 0.022, 0.012, 0, 1, 1).translate(s * 0.045, 0, 0))),
  belt: () => box(0.35, 0.055, 0.226, 0, 1, 0.9),         // the sash at the waist
  bun: () => box(0.09, 0.08, 0.09, 0, 0.8, 0.9),          // 髻, or a child's tuft
  beard: () => box(0.12, 0.12, 0.05, 1, 0.6, 0.9),
  ua: () => box(0.1, B.ua, 0.1, 1, 0.9),
  fa: () => box(0.085, B.fa, 0.085, 1, 0.85),
  hand: () => box(0.07, 0.08, 0.06, 1, 1, 0.9),
  thigh: () => box(0.13, B.thigh, 0.14, 1, 0.85),
  shin: () => box(0.1, B.shin, 0.11, 1, 0.9),
  foot: () => box(0.09, 0.06, 0.2, 0, 1, 0.8),
  skirt: () => box(0.34, 0.62, 0.24, 1, 1.35, 0.75),      // the lower robe, flaring to the knees
  cape: () => box(0.44, 0.56, 0.3, 1, 1.5, 0.75),          // 蓑衣: a straw cape over the shoulders
  hat: () => cone(0.34, 0.16, 16),                        // 斗笠
};

// ---------------------------------------------------------------- props held or carried
export const PROPS = {
  hoe: () => {
    // the hand near the top of the handle; the blade at the far end, turned back toward the digger
    const h = box(0.035, 1.3, 0.035, 0.5, 1, 0.85);
    h.translate(0, -0.45, 0);
    const b = box(0.18, 0.2, 0.035, 1, 1, 0.8);
    b.translate(0, -1.02, -0.05);
    return merge([tint(h, [0.5, 0.4, 0.3]), tint(b, [0.4, 0.4, 0.42])]);
  },
  pole: () => {
    // 扁担 across the shoulder with a basket at each end
    // (along z, on the shoulder: one basket ahead, one behind)
    const p = tint(box(0.05, 0.04, 1.6, 0.5, 1, 0.9), [0.55, 0.45, 0.32]);
    const parts = [p];
    for (const s of [-1, 1]) {
      const rope = tint(box(0.015, 0.62, 0.015, 1, 1, 1), [0.5, 0.46, 0.38]);
      rope.translate(0, 0, s * 0.72);
      const bk = tint(box(0.36, 0.28, 0.36, 1, 0.8, 0.75), STRAW);
      bk.translate(0, -0.6, s * 0.72);
      parts.push(rope, bk);
    }
    const g = merge(parts);
    g.translate(0.17, 0.04, 0);
    return g;
  },
  basket: () => tint(box(0.34, 0.2, 0.26, 1, 0.8, 0.75), STRAW),
  punt: () => tint(box(0.04, 4.2, 0.04, 0.5, 1, 0.9), [0.55, 0.47, 0.34]).translate(0, -0.9, 0), // (hand 1.2 m from the top)
  cup: () => tint(box(0.06, 0.05, 0.06, 0, 0.8, 0.9), [0.4, 0.36, 0.32]),
  bundle: () => tint(box(0.1, 0.3, 0.1, 1, 1.4, 0.8), [0.36, 0.5, 0.24]),   // a fist of rice seedlings
  cloth: () => tint(box(0.3, 0.02, 0.22, 1, 1, 0.9), CLOTH.white),         // washing, over the arm
  bucket: () => tint(box(0.26, 0.28, 0.26, 1, 0.9, 0.75), [0.46, 0.38, 0.29]),
  tray: () => {
    // a wooden tray of bowls and a wine jar, carried level in both hands
    const b = tint(box(0.4, 0.03, 0.28, 1, 1, 0.9), [0.42, 0.32, 0.23]);
    b.translate(0, 0.02, 0.12);
    const j = tint(box(0.1, 0.16, 0.1, 0, 0.7, 0.85), [0.38, 0.35, 0.3]); j.translate(0.1, 0.01, 0.14);
    const w1 = tint(box(0.12, 0.05, 0.12, 0, 1.3, 0.9), [0.62, 0.58, 0.5]); w1.translate(-0.08, 0.01, 0.1);
    return merge([b, j, w1]);
  },
  // ---- things set down (drawn as statics or in a figure's root frame)
  plough: () => {
    // 直辕犁 in the ploughman's frame: the handle at his hands, the share in the furrow a metre ahead,
    // the straight beam rising forward to the yoke on the buffalo's neck
    const wood = [0.42, 0.33, 0.24];
    const beam = tint(box(0.07, 0.07, 2.56, 0.5, 1, 0.85), wood);
    beam.rotateX(-0.39).translate(0, 0.94, 2.17);
    const sole = tint(box(0.08, 0.07, 0.6, 0, 1, 0.8), [0.36, 0.28, 0.2]); sole.translate(0, 0, 1.02);
    const share = tint(box(0.16, 0.04, 0.22, 0, 0.5, 0.9), [0.36, 0.36, 0.38]); share.translate(0, 0.01, 1.4);
    const post = tint(box(0.06, 0.5, 0.06, 0, 1, 0.85), wood); post.translate(0, 0.04, 1.08);
    const handle = tint(box(0.055, 0.95, 0.055, 0.5, 1, 0.85), wood);
    handle.rotateX(-0.42).translate(0, 0.48, 0.64);
    const grip = tint(box(0.34, 0.045, 0.045, 0.5, 1, 0.9), wood); grip.translate(0, 0.9, 0.44);
    return merge([beam, sole, share, post, handle, grip]);
  },
  seat: () => tint(box(0.5, 0.38, 0.42, 0, 0.92, 0.7), [0.5, 0.49, 0.46]),   // a stone to sit on
};
function tint(g, c) {
  const C = g.attributes.color;
  for (let i = 0; i < C.count; i++) C.setXYZ(i, C.getX(i) * c[0], C.getY(i) * c[1], C.getZ(i) * c[2]);
  return g;
}
function merge(gs) {
  let n = 0;
  for (const g of gs) n += g.attributes.position.count;
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'color']) {
    const a = new Float32Array(n * 3);
    let o = 0;
    for (const g of gs) { a.set(g.attributes[name].array, o); o += g.attributes[name].array.length; }
    out.setAttribute(name, new THREE.BufferAttribute(a, 3));
  }
  return out;
}

// ---------------------------------------------------------------- a pose
// angles in radians; arm/leg "fwd" swings the limb forward, "out" away from the body; knee and elbow bend
export function restPose() {
  return {
    x: 0, y: 0, z: 0, yaw: 0, bob: 0, lean: 0,
    bend: 0, twist: 0, roll: 0, headYaw: 0, headPitch: 0,
    armL: 0.05, armR: 0.05, outL: 0.08, outR: 0.08, elbowL: 0.15, elbowR: 0.15,
    legL: 0, legR: 0, kneeL: 0, kneeR: 0, spread: 0.02,
    prop: null, propAt: 'R', propRot: null, propFrame: null, propOff: 0, prop2: null,
  };
}

const M = THREE.Matrix4, V3 = THREE.Vector3;
const EYES = [0.12, 0.1, 0.09];
const _t = new M(), _r = new M(), _p = new V3();
const rx = (a) => _r.makeRotationX(a), ry = (a) => _r.makeRotationY(a), rz = (a) => _r.makeRotationZ(a);
const tr = (x, y, z) => _t.makeTranslation(x, y, z);

export class Crowd {
  // look: which parts each figure wears is decided per figure (a robe, a beard, a bun, a hat, a cape)
  constructor(max, name = 'crowd') {
    this.group = new THREE.Group();
    this.group.name = name;
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0 });
    this.mat = hook(mat, 'crowd');
    // 蓑衣 and 斗笠: tiers of straw lapped downward, each darker where the one above covers it
    this.straw = hook(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }), 'crowd-straw', (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vPart;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPart = position;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vPart;')
        .replace('#include <color_fragment>', `#include <color_fragment>
        {
          float ang = atan(vPart.x, vPart.z);
          float tier = fract(-vPart.y * 11.0 + vnoise(vec2(ang * 3.0, 0.0)) * 0.3);
          float streak = vnoise(vec2(ang * 22.0 + vPart.x * 40.0, vPart.y * 5.0));
          diffuseColor.rgb *= mix(0.66, 1.08, smoothstep(0.05, 0.85, tier)) * (0.8 + 0.34 * streak);
        }`);
    });
    this.max = max;
    this.meshes = {};
    const counts = { ua: 2, fa: 2, hand: 2, thigh: 2, shin: 2, foot: 2 };
    for (const [k, make] of Object.entries(PARTS)) {
      const m = new THREE.InstancedMesh(make(), k === 'cape' || k === 'hat' ? this.straw : this.mat, max * (counts[k] ?? 1));
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false; m.castShadow = true; m.receiveShadow = true;
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(m.instanceMatrix.count * 3), 3);
      m.instanceColor.setUsage(THREE.DynamicDrawUsage);
      m.count = 0; m.name = `${name}-${k}`;
      this.meshes[k] = m;
      this.group.add(m);
    }
    this.props = {};
    for (const [k, make] of Object.entries(PROPS)) {
      const m = new THREE.InstancedMesh(make(), this.mat, max);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false; m.castShadow = true; m.receiveShadow = true;
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
      m.instanceColor.setUsage(THREE.DynamicDrawUsage);
      m.count = 0; m.name = `${name}-prop-${k}`;
      this.props[k] = m;
      this.group.add(m);
    }
    this.figures = [];
    this.statics = [];
    this._c = new THREE.Color();
    this._m = { root: new M(), pelvis: new M(), torso: new M(), neck: new M(), a: new M(), b: new M(), c: new M() };
  }

  // fig: { look: { top, bottom, skin, hair, hat?, skirt?, beard?, bun?, cape?, kerchief? }, scale, stoop, act(t, pose, fig) }
  add(fig) {
    fig.pose = restPose();
    fig.visible = fig.visible ?? true;
    fig.id = this.figures.length;
    fig.ph ??= hashf(fig.id * 7.7 + 1) * 100;
    fig.tempo ??= 0.85 + hashf(fig.id * 3.1 + 5) * 0.3;
    // (a figure with a sculpted body, SkinnedFigure, is drawn by it instead of by the boxes)
    if (fig.skin) this.group.add(fig.skin.root);
    this.figures.push(fig);
    return fig;
  }

  // a prop set down in the world (a table, a mat, a stone seat), drawn while show() says so
  addStatic(kind, x, y, z, yaw = 0, show = () => true) {
    const m = new M().makeRotationY(yaw).setPosition(x, y, z);
    this.statics.push({ kind, m, show });
  }

  _put(kind, mat, color) {
    const m = this.meshes[kind] ?? this.props[kind];
    if (m.count >= m.instanceMatrix.count) return;
    const i = m.count++;
    m.setMatrixAt(i, mat);
    m.setColorAt(i, this._c.setRGB(color[0], color[1], color[2]));
  }

  update(t, camera) {
    for (const m of Object.values(this.meshes)) m.count = 0;
    for (const m of Object.values(this.props)) m.count = 0;
    const cp = camera.position;
    const { root, pelvis, torso, neck, a, b, c } = this._m;
    for (const st of this.statics) if (st.show()) this._put(st.kind, st.m, [1, 1, 1]);
    for (const f of this.figures) {
      if (f.skin) f.skin.root.visible = false;
      if (!f.visible) continue;
      const p = f.pose;
      f.act(t, p, f);
      if (f.hidden) continue;
      const L = f.look, s = f.scale ?? 1;
      if (f.skin) { this._skinned(f, p, s, cp); continue; }
      // the whole figure: placed, turned, bobbing (on a boat: in the boat's frame)
      root.makeTranslation(p.x, p.y + p.bob, p.z);
      if (f.parent) root.premultiply(f.parent);
      const e = root.elements;
      if ((e[12] - cp.x) ** 2 + (e[14] - cp.z) ** 2 > 380 * 380) continue;
      root.multiply(ry(p.yaw)).multiply(_t.makeScale(s, s, s));
      pelvis.copy(root).multiply(tr(0, B.hip, 0)).multiply(rx(p.lean));
      // legs
      for (const side of [-1, 1]) {
        const fwd = side < 0 ? p.legL : p.legR, knee = side < 0 ? p.kneeL : p.kneeR;
        a.copy(pelvis).multiply(tr(side * B.hipX, 0, 0)).multiply(rz(side * p.spread)).multiply(rx(-fwd));
        this._put('thigh', a, L.bottom);
        b.copy(a).multiply(tr(0, -B.thigh, 0)).multiply(rx(knee));
        this._put('shin', b, L.shin ?? L.bottom);
        c.copy(b).multiply(tr(0, -B.shin, 0.03)).multiply(rx(fwd - knee - p.lean));
        this._put('foot', c, L.shoes ?? [0.3, 0.27, 0.24]);
      }
      if (L.skirt) {
        a.copy(pelvis).multiply(tr(0, 0.05, 0)).multiply(rx(-(Math.max(p.legL, p.legR) * 0.55 + Math.min(p.legL, p.legR) * 0.25)));
        this._put('skirt', a, L.skirt);
      }
      // torso, bending at the waist (the stoop of the old is a standing bend)
      torso.copy(pelvis).multiply(ry(p.twist)).multiply(rx(p.bend + (f.stoop ?? 0))).multiply(rz(p.roll));
      this._put('torso', torso, L.top);
      a.copy(torso).multiply(tr(0, 0.03, 0));
      this._put('belt', a, L.belt ?? (f._belt ??= L.bottom.map((c) => c * 0.72)));
      if (L.cape) { a.copy(torso).multiply(tr(0, B.torso + 0.02, -0.01)); this._put('cape', a, L.cape); }
      // head
      neck.copy(torso).multiply(tr(0, B.torso + 0.02, 0.01)).multiply(ry(p.headYaw)).multiply(rx(-p.headPitch - (f.stoop ?? 0) * 0.6));
      this._put('head', neck, L.skin);
      a.copy(neck).multiply(tr(0, 0.135, 0.1));
      this._put('eyes', a, EYES);
      a.copy(neck).multiply(tr(0, B.head - 0.06, -0.005));
      this._put('hair', a, L.kerchief ?? L.hair);
      if (L.bun) { a.copy(neck).multiply(tr(0, B.head + 0.02, -0.03)); this._put('bun', a, L.hair); }
      if (L.beard) { a.copy(neck).multiply(tr(0, 0.08, 0.1)); this._put('beard', a, L.hair); }
      if (L.hat) { a.copy(neck).multiply(tr(0, B.head - 0.02, 0)); this._put('hat', a, L.hat); }
      // arms
      for (const side of [-1, 1]) {
        const fwd = side < 0 ? p.armL : p.armR, out = side < 0 ? p.outL : p.outR, el = side < 0 ? p.elbowL : p.elbowR;
        a.copy(torso).multiply(tr(side * B.shX, B.torso - 0.07, 0)).multiply(rz(side * out)).multiply(rx(-fwd));
        this._put('ua', a, L.top);
        b.copy(a).multiply(tr(0, -B.ua, 0)).multiply(rx(-el));
        this._put('fa', b, L.top);
        c.copy(b).multiply(tr(0, -B.fa, 0));
        this._put('hand', c, L.skin);
        // what the hand holds, turned as the action asks
        if (p.prop && (p.propAt === (side < 0 ? 'L' : 'R'))) {
          c.multiply(tr(0, -0.05, 0));
          // held in the hand, but turned in the body's frame (a pole that stays upright while the arm swings)
          if (p.propFrame === 'root') { _p.setFromMatrixPosition(c); c.extractRotation(root).setPosition(_p); }
          if (p.propRot) c.multiply(_r.makeRotationFromEuler(p.propRot));
          this._put(p.prop, c, [1, 1, 1]);
        }
      }
      if (p.prop && p.propAt === 'shoulder') {
        a.copy(torso).multiply(tr(p.propOff ?? 0, B.torso + 0.01, 0));
        if (p.propRot) a.multiply(_r.makeRotationFromEuler(p.propRot));
        this._put(p.prop, a, [1, 1, 1]);
      }
      if (p.prop2) {
        a.copy(root).multiply(tr(...p.prop2.at));
        if (p.prop2.rot) a.multiply(_r.makeRotationFromEuler(p.prop2.rot));
        this._put(p.prop2.kind, a, [1, 1, 1]);
      }
    }
    for (const m of [...Object.values(this.meshes), ...Object.values(this.props)]) {
      m.visible = m.count > 0; // (an empty part costs no draw call, in any pass)
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  // a sculpted figure: its bones follow the pose, and what it holds goes in its own hand
  _skinned(f, p, s, cp) {
    const sk = f.skin, { root, a, c } = this._m;
    root.makeTranslation(p.x, p.y + p.bob * sk.legK, p.z);
    if (f.parent) root.premultiply(f.parent);
    const e = root.elements;
    if ((e[12] - cp.x) ** 2 + (e[14] - cp.z) ** 2 > 380 * 380) return;
    root.multiply(ry(p.yaw)).multiply(_t.makeScale(s, s, s));
    sk.drive(p, f, root);
    sk.root.visible = true;
    if (p.prop && (p.propAt === 'L' || p.propAt === 'R')) {
      sk.handMatrix(p.propAt === 'L' ? -1 : 1, c);
      c.multiply(tr(0, -0.05, 0));
      if (p.propFrame === 'root') { _p.setFromMatrixPosition(c); c.extractRotation(root).setPosition(_p); }
      if (p.propRot) c.multiply(_r.makeRotationFromEuler(p.propRot));
      this._put(p.prop, c, [1, 1, 1]);
    }
    if (p.prop && p.propAt === 'shoulder') {
      a.copy(root).multiply(tr(0, B.hip * sk.legK, 0)).multiply(rx(p.lean)).multiply(ry(p.twist)).multiply(rx(p.bend + (f.stoop ?? 0))).multiply(rz(p.roll));
      a.multiply(tr(p.propOff ?? 0, B.torso + 0.01, 0));
      if (p.propRot) a.multiply(_r.makeRotationFromEuler(p.propRot));
      this._put(p.prop, a, [1, 1, 1]);
    }
    if (p.prop2) {
      a.copy(root).multiply(tr(...p.prop2.at));
      if (p.prop2.rot) a.multiply(_r.makeRotationFromEuler(p.prop2.rot));
      this._put(p.prop2.kind, a, [1, 1, 1]);
    }
  }
}

// ---------------------------------------------------------------- actions
// Every action writes into the pose; t is the scene clock, f.ph the figure's own phase, f.tempo its pace.
const TAU = Math.PI * 2;
export const hashf = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

export function stand(p, t, f, k = 1) {
  const b = t * 0.9 * f.tempo + f.ph;
  p.bob = 0; p.lean = 0; p.bend = 0.03 * k; p.twist = Math.sin(b * 0.37) * 0.06 * k;
  p.legL = p.legR = 0; p.kneeL = p.kneeR = 0.04; p.spread = 0.03;
  p.armL = 0.06 + Math.sin(b) * 0.02; p.armR = 0.06 + Math.sin(b + 1) * 0.02;
  p.outL = p.outR = 0.1; p.elbowL = p.elbowR = 0.2;
  // looking about now and then
  const look = Math.floor(t * 0.25 * f.tempo + f.ph * 3);
  p.headYaw = lerp(p.headYaw, (hashf(look + f.id * 13) - 0.5) * 1.2, 0.03);
  p.headPitch = Math.sin(b * 0.5) * 0.05;
}

export function walkCycle(p, ph, amp = 1, run = 0) {
  const s = Math.sin(ph), c = Math.cos(ph);
  p.legL = s * 0.42 * amp; p.legR = -s * 0.42 * amp;
  p.kneeL = Math.max(0, -c) * 0.75 * amp + 0.06; p.kneeR = Math.max(0, c) * 0.75 * amp + 0.06;
  p.armL = -s * 0.32 * amp + run * 0.3; p.armR = s * 0.32 * amp + run * 0.3;
  p.elbowL = p.elbowR = 0.25 + run * 1.1;
  p.outL = p.outR = 0.08;
  p.bob = Math.abs(Math.cos(ph)) * 0.03 * amp - 0.015 - run * 0.03;
  p.bend = 0.04 + run * 0.15; p.twist = s * 0.08 * amp; p.lean = 0;
}

// walk along a polyline, back and forth, pausing at the ends; returns true while walking
export function follow(p, t, f, path, speed = 1.1) {
  if (!path._len) {
    path._seg = [];
    let L = 0;
    for (let i = 0; i < path.length - 1; i++) { const l = Math.hypot(path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1]); path._seg.push(l); L += l; }
    path._len = L;
  }
  const v = speed * f.tempo, pause = f.pause ?? 3, T = path._len / v + pause;
  const u = (t + f.ph * 7.3) % (2 * T), back = u > T, w = back ? u - T : u;
  let dist = Math.min(w * v, path._len), walking = w * v < path._len;
  if (back) dist = path._len - dist;
  let i = 0;
  while (i < path._seg.length - 1 && dist > path._seg[i]) { dist -= path._seg[i]; i++; }
  const k = clamp(dist / path._seg[i], 0, 1);
  const [ax, az] = path[i], [bx, bz] = path[i + 1];
  p.x = lerp(ax, bx, k); p.z = lerp(az, bz, k);
  const yaw = Math.atan2(bx - ax, bz - az) + (back ? Math.PI : 0);
  p.yaw = walking ? yaw : p.yaw;
  if (walking) walkCycle(p, (t * v * 5.2) + f.ph * 9); else stand(p, t, f);
  return walking;
}
export const turnTo = (p, x, z) => { p.yaw = Math.atan2(x - p.x, z - p.z); };
export { TAU };
