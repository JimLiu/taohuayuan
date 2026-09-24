// 鸡犬相闻: water buffalo at the plough, village dogs, hens and a cock or two scratching about the yards.
// Same scheme as the people: every animal is a handful of boxes on a small rig, one InstancedMesh per piece
// for the whole herd, the pose worked out on the CPU each frame from the animal's own phase and pace.
import * as THREE from 'three';
import { hook } from '../core/shared.js';
import { lerp } from '../core/rng.js';

function box(w, h, d, oy = 0, oz = 0, taper = 1) {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  g.deleteAttribute('uv');
  const P = g.attributes.position, C = new Float32Array(P.count * 3);
  for (let i = 0; i < P.count; i++) {
    const t = P.getY(i) / h + 0.5;
    if (taper !== 1) { const k = lerp(taper, 1, t); P.setX(i, P.getX(i) * k); P.setZ(i, P.getZ(i) * k); }
    P.setY(i, P.getY(i) + oy);
    P.setZ(i, P.getZ(i) + oz);
    const s = lerp(0.78, 1, t);
    C.set([s, s, s], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(C, 3));
  g.computeVertexNormals();
  return g;
}

// piece: [name, parent, geometry, offset [x,y,z], rotation [x,y,z], colour key]
// parents: body, head, leg0..leg3 (upper, pivot at the hip, hanging), shin0..shin3, tail
const SPECIES = {
  buffalo: {
    H: 1.02, legs: [[-0.26, 0.62], [0.26, 0.62], [-0.26, -0.62], [0.26, -0.62]], upper: 0.36, lower: 0.34,
    head: [0, 0.12, 0.88], tail: [0, 0.3, -0.86],
    pieces: [
      ['body', 'body', box(0.74, 0.66, 1.7), [0, 0, 0], [0, 0, 0], 'main'],
      ['hump', 'body', box(0.5, 0.18, 0.5), [0, 0.36, 0.45], [0, 0, 0], 'main'],
      ['neck', 'body', box(0.44, 0.44, 0.5), [0, 0.1, 0.8], [-0.35, 0, 0], 'main'],
      ['head', 'head', box(0.34, 0.36, 0.56, -0.08, 0.22), [0, 0, 0], [0, 0, 0], 'main'],
      ['muzzle', 'head', box(0.28, 0.2, 0.14), [0, -0.2, 0.52], [0, 0, 0], 'light'],
      ['hornL', 'head', box(0.07, 0.07, 0.5, 0, 0, 0.5), [-0.22, 0.12, 0.02], [0.2, -0.9, 0.4], 'dark'],
      ['hornR', 'head', box(0.07, 0.07, 0.5, 0, 0, 0.5), [0.22, 0.12, 0.02], [0.2, 0.9, -0.4], 'dark'],
      ['ear', 'head', box(0.5, 0.05, 0.1), [0, 0.02, -0.02], [0, 0, 0], 'main'],
      ['upper', 'leg', box(0.17, 0.38, 0.19, -0.17), [0, 0, 0], [0, 0, 0], 'main'],
      ['lower', 'shin', box(0.12, 0.36, 0.12, -0.17), [0, 0, 0], [0, 0, 0], 'dark'],
      ['tail', 'tail', box(0.05, 0.7, 0.05, -0.35, 0, 0.6), [0, 0, 0], [0, 0, 0], 'dark'],
      ['yoke', 'body', box(0.9, 0.08, 0.1), [0, 0.42, 0.66], [0, 0, 0], 'wood'],
    ],
  },
  dog: {
    H: 0.42, legs: [[-0.08, 0.22], [0.08, 0.22], [-0.08, -0.2], [0.08, -0.2]], upper: 0.17, lower: 0.2,
    head: [0, 0.14, 0.32], tail: [0, 0.1, -0.3],
    pieces: [
      ['body', 'body', box(0.24, 0.26, 0.6), [0, 0, 0], [0, 0, 0], 'main'],
      ['chest', 'body', box(0.25, 0.22, 0.2), [0, -0.03, 0.22], [0, 0, 0], 'light'],
      ['head', 'head', box(0.2, 0.19, 0.2, 0, 0.02), [0, 0, 0], [0, 0, 0], 'main'],
      ['snout', 'head', box(0.1, 0.09, 0.14), [0, -0.05, 0.16], [0, 0, 0], 'light'],
      ['earL', 'head', box(0.06, 0.09, 0.04), [-0.07, 0.12, -0.02], [0, 0, -0.2], 'dark'],
      ['earR', 'head', box(0.06, 0.09, 0.04), [0.07, 0.12, -0.02], [0, 0, 0.2], 'dark'],
      ['upper', 'leg', box(0.07, 0.19, 0.08, -0.08), [0, 0, 0], [0, 0, 0], 'main'],
      ['lower', 'shin', box(0.055, 0.21, 0.06, -0.1), [0, 0, 0], [0, 0, 0], 'light'],
      ['tail', 'tail', box(0.05, 0.26, 0.05, 0.12, 0, 0.6), [0, 0, 0], [0, 0, 0], 'main'],
    ],
  },
  hen: {
    H: 0.24, legs: [[-0.04, 0], [0.04, 0]], upper: 0.1, lower: 0.08,
    head: [0, 0.1, 0.12], tail: [0, 0.06, -0.12],
    pieces: [
      ['body', 'body', box(0.18, 0.18, 0.26, 0, 0, 0.85), [0, 0, 0], [0, 0, 0], 'main'],
      ['head', 'head', box(0.08, 0.1, 0.09, 0.03), [0, 0, 0], [0, 0, 0], 'main'],
      ['comb', 'head', box(0.02, 0.05, 0.07), [0, 0.1, 0], [0, 0, 0], 'comb'],
      ['wattle', 'head', box(0.02, 0.04, 0.02), [0, -0.01, 0.05], [0, 0, 0], 'comb'],
      ['beak', 'head', box(0.03, 0.025, 0.05), [0, 0.03, 0.065], [0, 0, 0], 'beak'],
      ['upper', 'leg', box(0.035, 0.1, 0.04, -0.05), [0, 0, 0], [0, 0, 0], 'main'],
      ['lower', 'shin', box(0.015, 0.09, 0.015, -0.045), [0, 0, 0], [0, 0, 0], 'beak'],
      ['tail', 'tail', box(0.05, 0.16, 0.1, 0.07, -0.03, 0.7), [0, 0, 0], [-0.3, 0, 0], 'dark'],
    ],
  },
};

const M = THREE.Matrix4;
const _r = new M(), _t = new M(), _e = new THREE.Euler();
const tr = (x, y, z) => _t.makeTranslation(x, y, z);
const rx = (a) => _r.makeRotationX(a);

export class Herd {
  constructor(counts, name = 'herd') {
    this.group = new THREE.Group();
    this.group.name = name;
    this.mat = hook(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 }), 'herd');
    this.sp = {};
    for (const [k, n] of Object.entries(counts)) {
      const S = SPECIES[k], meshes = [];
      for (const [pn, parent, geo, off, rot, ck] of S.pieces) {
        const per = parent === 'leg' || parent === 'shin' ? S.legs.length : 1;
        const m = new THREE.InstancedMesh(geo, this.mat, n * per);
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * per * 3), 3);
        m.frustumCulled = false; m.castShadow = true; m.receiveShadow = true;
        m.count = 0; m.name = `${name}-${k}-${pn}`;
        this.group.add(m);
        meshes.push({ m, name: pn, parent, off, rot: new M().makeRotationFromEuler(_e.set(...rot)), ck });
      }
      this.sp[k] = { S, meshes };
    }
    this.animals = [];
    this._m = { root: new M(), body: new M(), head: new M(), tail: new M(), leg: new M(), shin: new M(), a: new M() };
    this._c = new THREE.Color();
  }
  add(a) {
    a.id = this.animals.length;
    a.pose = { x: 0, y: 0, z: 0, yaw: 0, bob: 0, pitch: 0, roll: 0, headPitch: 0, headYaw: 0, legs: [0, 0, 0, 0], knees: [0, 0, 0, 0], tail: 0, wag: 0, low: 0 };
    a.visible ??= true;
    this.animals.push(a);
    return a;
  }
  _put(e, mat) {
    const { m } = e;
    if (m.count >= m.instanceMatrix.count) return;
    const i = m.count++;
    this._m.a.multiplyMatrices(mat, tr(...e.off)).multiply(e.rot);
    m.setMatrixAt(i, this._m.a);
    const c = e.col;
    m.setColorAt(i, this._c.setRGB(c[0], c[1], c[2]));
  }
  update(t, camera) {
    for (const { meshes } of Object.values(this.sp)) for (const e of meshes) e.m.count = 0;
    const cp = camera.position;
    const { root, body, head, tail, leg, shin } = this._m;
    for (const a of this.animals) {
      if (!a.visible) continue;
      const p = a.pose;
      a.act(t, p, a);
      if (a.hidden) continue;
      if ((p.x - cp.x) ** 2 + (p.z - cp.z) ** 2 > 300 * 300) continue;
      const { S, meshes } = this.sp[a.kind];
      const s = a.scale ?? 1;
      root.makeTranslation(p.x, p.y, p.z).multiply(_r.makeRotationY(p.yaw)).multiply(_t.makeScale(s, s, s));
      body.copy(root).multiply(tr(0, S.H + p.bob - p.low, 0)).multiply(rx(-p.pitch)).multiply(_r.makeRotationZ(p.roll));
      head.copy(body).multiply(tr(...S.head)).multiply(_r.makeRotationY(p.headYaw)).multiply(rx(-p.headPitch));
      tail.copy(body).multiply(tr(...S.tail)).multiply(_r.makeRotationZ(p.wag)).multiply(rx(p.tail));
      for (const e of meshes) {
        if (a.skip?.has(e.name)) continue;
        e.col = a.colors[e.ck] ?? a.colors.main;
        if (e.parent === 'body') this._put(e, body);
        else if (e.parent === 'head') this._put(e, head);
        else if (e.parent === 'tail') this._put(e, tail);
      }
      // legs: swing at the hip, bend at the knee (hind knees bend the other way)
      for (const e of meshes) e.col = a.colors[e.ck] ?? a.colors.main;
      S.legs.forEach(([lx, lz], i) => {
        const hind = lz < 0 && S.legs.length === 4;
        leg.copy(body).multiply(tr(lx, -(S.H - S.upper - S.lower), lz)).multiply(rx(-p.legs[i]));
        shin.copy(leg).multiply(tr(0, -S.upper, 0)).multiply(rx((hind ? -1 : 1) * p.knees[i]));
        for (const e of meshes) {
          if (e.parent === 'leg') this._put(e, leg);
          else if (e.parent === 'shin') this._put(e, shin);
        }
      });
    }
    for (const { meshes } of Object.values(this.sp)) for (const e of meshes) {
      e.m.visible = e.m.count > 0;
      e.m.instanceMatrix.needsUpdate = true;
      e.m.instanceColor.needsUpdate = true;
    }
  }
}

// ---------------------------------------------------------------- gaits
export function gait(p, ph, amp = 1, n = 4) {
  // a walk: diagonal pairs, each foot lifted (knee bent) while it swings forward
  const off = n === 4 ? [0, Math.PI, Math.PI, 0] : [0, Math.PI];
  for (let i = 0; i < 4; i++) {
    const q = ph + (off[i] ?? 0);
    p.legs[i] = Math.sin(q) * 0.38 * amp;
    p.knees[i] = Math.max(0, Math.cos(q)) * 0.6 * amp;
  }
  p.bob = Math.abs(Math.sin(ph)) * 0.02 * amp;
  p.roll = Math.sin(ph) * 0.02 * amp;
}
export function still(p) {
  for (let i = 0; i < 4; i++) { p.legs[i] = 0; p.knees[i] = 0; }
  p.bob = 0; p.roll = 0; p.low = 0; p.pitch = 0;
}

export const COATS = {
  buffalo: [{ main: [0.27, 0.27, 0.28], dark: [0.16, 0.16, 0.17], light: [0.42, 0.4, 0.38], wood: [0.42, 0.33, 0.24] },
    { main: [0.33, 0.31, 0.3], dark: [0.18, 0.17, 0.17], light: [0.46, 0.43, 0.4], wood: [0.42, 0.33, 0.24] }],
  dog: [{ main: [0.56, 0.45, 0.31], dark: [0.4, 0.31, 0.22], light: [0.72, 0.64, 0.52] },
    { main: [0.2, 0.19, 0.18], dark: [0.14, 0.13, 0.13], light: [0.72, 0.7, 0.66] },
    { main: [0.66, 0.6, 0.5], dark: [0.5, 0.42, 0.32], light: [0.8, 0.77, 0.7] }],
  hen: [{ main: [0.5, 0.37, 0.25], dark: [0.3, 0.24, 0.18], comb: [0.55, 0.25, 0.21], beak: [0.62, 0.52, 0.34] },
    { main: [0.8, 0.77, 0.7], dark: [0.62, 0.6, 0.55], comb: [0.55, 0.25, 0.21], beak: [0.62, 0.52, 0.34] },
    { main: [0.36, 0.28, 0.22], dark: [0.16, 0.18, 0.16], comb: [0.58, 0.24, 0.2], beak: [0.6, 0.5, 0.32] },
    { main: [0.62, 0.5, 0.36], dark: [0.42, 0.33, 0.24], comb: [0.55, 0.25, 0.21], beak: [0.62, 0.52, 0.34] }],
};
