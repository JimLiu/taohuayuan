// Fine voxel-style building blocks: every house, fence, woodpile and jar is a set of boxes, each carrying
// its face coordinates in metres and a material code, so one shader can draw rammed-earth layers, thatch
// courses, tile channels, wood grain, stone coursing and window lattices at a fixed physical scale, with
// a crisp bevel line on every edge. The whole village is one geometry and one draw call.
import * as THREE from 'three';
import { hook } from './shared.js';
import { Rng } from './rng.js';

export const MAT = { plain: 0, earth: 1, thatch: 2, wood: 3, stone: 4, window: 5, tile: 6, plaster: 7, door: 8, logs: 9, mat: 10, bark: 11 };
export const FLAG = { eave: 1, lit: 2 };

const FACES = [
  // normal, u axis, v axis (the box's local axes); v is up on the four sides
  [[1, 0, 0], [0, 0, -1], [0, 1, 0]],
  [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
  [[0, 1, 0], [-1, 0, 0], [0, 0, 1]],   // on a roof slab turned about x, v runs down the slope
  [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
  [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
  [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
];
const FACE_KEYS = ['+x', '-x', '+y', '-y', '+z', '-z'];

const _m = new THREE.Matrix4(), _r = new THREE.Matrix4(), _n = new THREE.Matrix3(), _v = new THREE.Vector3(), _c = new THREE.Color();

export class Blocks {
  constructor(seed = 1) {
    this.rng = new Rng(seed);
    this.pos = []; this.nor = []; this.col = []; this.face = []; this.info = [];
    this.stack = [new THREE.Matrix4()];
    this.base = 0;   // ground height under whatever is being built (for the contact shadow)
    this.seed = 0;
  }
  get m() { return this.stack[this.stack.length - 1]; }
  // enter a frame translated by (x, y, z) and turned by ry about the vertical
  push(x = 0, y = 0, z = 0, ry = 0) {
    _m.makeRotationY(ry).setPosition(x, y, z);
    this.stack.push(this.m.clone().multiply(_m));
    return this;
  }
  pop() { this.stack.pop(); return this; }

  // a box centred at (x, y, z) in the current frame, size (sx, sy, sz), turned by o.rx/o.ry/o.rz (applied x, then y);
  // col a THREE.Color (linear) or hex; mat a MAT code; o.skip a list of faces to leave out; o.jit colour jitter
  box(x, y, z, sx, sy, sz, col, mat = 0, o = {}) {
    if (![x, y, z, sx, sy, sz].every(Number.isFinite)) { console.warn('Blocks.box: bad input', x, y, z, sx, sy, sz, mat, new Error().stack); return this; }
    const M = _m.makeTranslation(x, y, z);
    if (o.ry) M.multiply(_r.makeRotationY(o.ry));
    if (o.rz) M.multiply(_r.makeRotationZ(o.rz));
    if (o.rx) M.multiply(_r.makeRotationX(o.rx));
    const W = this.m.clone().multiply(M);
    _n.getNormalMatrix(W);
    const c = typeof col === 'number' ? _c.setHex(col, THREE.SRGBColorSpace) : _c.copy(col);
    if (o.jit) { const k = 1 + (this.rng.next() - 0.5) * o.jit; c.r *= k; c.g *= k; c.b *= k; }
    const skip = o.skip ?? (o.rx || o.rz ? [] : ['-y']);
    const h = [sx / 2, sy / 2, sz / 2], S = [sx, sy, sz];
    const seed = o.seed ?? (this.seed = (this.seed * 1.618 + 0.137) % 1);
    const flags = o.flags ?? 0;
    for (let f = 0; f < 6; f++) {
      if (skip.includes(FACE_KEYS[f])) continue;
      const [N, U, V] = FACES[f];
      const su = Math.abs(U[0]) * S[0] + Math.abs(U[1]) * S[1] + Math.abs(U[2]) * S[2];
      const sv = Math.abs(V[0]) * S[0] + Math.abs(V[1]) * S[1] + Math.abs(V[2]) * S[2];
      _v.set(N[0], N[1], N[2]).applyMatrix3(_n).normalize();
      const nx = _v.x, ny = _v.y, nz = _v.z;
      const corner = (a, b) => {
        // a, b in {0, 1}: position along U and V from the face's lower corner
        const p = [0, 0, 0];
        for (let k = 0; k < 3; k++) p[k] = N[k] * h[k] + U[k] * (a - 0.5) * su + V[k] * (b - 0.5) * sv;
        _v.set(p[0], p[1], p[2]).applyMatrix4(W);
        this.pos.push(_v.x, _v.y, _v.z);
        this.nor.push(nx, ny, nz);
        this.col.push(c.r, c.g, c.b);
        this.face.push(a * su, b * sv, su, sv);
        this.info.push(mat, this.base, flags, seed);
      };
      // two triangles, counter-clockwise seen from outside
      corner(0, 0); corner(1, 0); corner(1, 1);
      corner(0, 0); corner(1, 1); corner(0, 1);
    }
    return this;
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aFace', new THREE.Float32BufferAttribute(this.face, 4));
    g.setAttribute('aInfo', new THREE.Float32BufferAttribute(this.info, 4));
    g.computeBoundingSphere();
    return g;
  }
}

let material = null;
export function blocksMaterial() {
  if (material) return material;
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
  hook(m, 'blocks', (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aFace;\nattribute vec4 aInfo;\nvarying vec4 vFace;\nvarying vec4 vInfo;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFace = aFace;\nvInfo = aInfo;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vFace;\nvarying vec4 vInfo;')
      .replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
      vec3 bBump = vec3(0.0, 0.0, 1.0);
      float bRough = 0.9;
      vec3 bGlow = vec3(0.0);
      {
        float mt = floor(vInfo.x + 0.5);
        float seed = vInfo.w;
        float flags = vInfo.z;
        vec2 uv = vFace.xy, sz = vFace.zw;
        vec3 wN = normalize((vec4(vNormal, 0.0) * viewMatrix).xyz);
        float vert = 1.0 - smoothstep(0.35, 0.6, abs(wN.y));
        float ed = min(min(uv.x, sz.x - uv.x), min(uv.y, sz.y - uv.y));
        float aa = max(fwidth(uv.x), fwidth(uv.y));
        float fine = 1.0 - smoothstep(0.012, 0.05, aa);     // how well a 2 cm detail is resolved here
        float base = vFogWP.y - vInfo.y;
        vec3 col = diffuseColor.rgb;
        float lineK = 0.2, rimK = 0.07;

        if (mt == 1.0) {
          // 夯土 rammed earth: 0.33 m pours, each a little different, the joints pressed in. Laid out in
          // world units (along the wall, height above the house's ground) so every wall and gable of a house
          // shares its pours, and the gable slabs sunk into the walls continue them without a seam
          vec2 q = vert > 0.5 ? vec2(dot(vFogWP.xz, normalize(vec2(-wN.z, wN.x) + 1e-5)), base) : vFogWP.xz;
          float ly = q.y / 0.33 + 0.12 * vnoise(vec2(q.x * 0.7, 1.7));
          float li = floor(ly), lf = fract(ly);
          float n = fbm3(q * vec2(1.6, 4.0) + li * 7.13);
          float big = fbm3(q * vec2(0.3, 0.5) + 3.1);
          col *= (0.82 + 0.14 * hash12(vec2(li, 3.3)) + 0.12 * vnoise(vec2(q.x * 0.25, li * 1.7)))
               * (0.86 + 0.28 * n) * (0.88 + 0.24 * big);
          float j = (1.0 - smoothstep(0.0, 0.085, lf)) * vert * (0.55 + 0.45 * vnoise(vec2(q.x * 2.5, li)));
          col *= (1.0 - 0.24 * j * fine) * (1.0 + 0.05 * smoothstep(0.84, 1.0, lf) * vert);
          float pit = step(0.955, hash12(floor(q * 16.0) + li * 3.1)) * fine;
          col *= 1.0 - pit * 0.22;
          col = mix(col * vec3(0.74, 0.74, 0.76), col, smoothstep(0.05, 0.55, base));   // splash at the foot
          col *= 1.0 - 0.08 * smoothstep(0.55, 0.85, vnoise(vec2(q.x * 5.0, 2.3))) * smoothstep(2.2, 3.2, base) * vert; // rain streaks
          bBump = vec3(0.0, j * 0.5 * vert + (n - 0.5) * 0.25, 1.0);
          lineK = 0.0; rimK = 0.0;   // earth has soft arrises; the light on each face is enough
        } else if (mt == 2.0) {
          // 茅草 thatch: straw along the slope, laid in courses whose lower lips cast a thin shadow
          if (wN.y > 0.25) {
            float sx = uv.x * 30.0;
            float si = floor(sx);
            float straw = hash12(vec2(si, floor(uv.y * 2.3 + hash12(vec2(si, 3.0)) * 5.0)));
            float band = vnoise(vec2(uv.x * 2.2 + seed * 13.0, uv.y * 0.35));        // weathering runs down the slope
            float patchN = fbm3(uv * vec2(0.35, 0.5) + seed * 7.0);                  // patches re-thatched at other times
            float cy = uv.y / 0.34 + 0.35 * vnoise(vec2(uv.x * 1.6, seed * 5.0));
            float cf = fract(cy);
            float shade = smoothstep(0.0, 0.3, cf);
            col *= (0.84 + 0.26 * mix(0.5, straw, fine)) * mix(0.84, 1.0, shade) * (0.8 + 0.36 * band) * (0.88 + 0.24 * patchN);
            col *= mix(1.05, 0.84, smoothstep(0.55, 1.0, uv.y / sz.y));             // darker toward the dripping eave
            bBump = vec3((straw - 0.5) * 0.3 * fine + (band - 0.5) * 0.5, (1.0 - shade) * 0.35, 1.0);
            float age = smoothstep(0.5, 0.85, fbm3(vFogWP.xz * 0.45 + seed * 11.0));
            col = mix(col, col * vec3(0.72, 0.82, 0.62), age * 0.55);                          // moss on old straw
          } else {
            // the cut butt ends at the eaves and verges
            vec2 q = floor(uv * vec2(38.0, 30.0));
            float d = hash12(q + seed * 13.0);
            col *= mix(0.62, 1.0, mix(0.6, d, fine)) * (wN.y < -0.2 ? 0.7 : 0.85);
          }
          lineK = 0.05; rimK = 0.02;
          bRough = 0.95;
        } else if (mt == 3.0 || mt == 11.0) {
          // wood: grain along the longer side of each face; bark is coarser and darker
          vec2 g = sz.x > sz.y ? uv : uv.yx;
          float k = mt == 11.0 ? 14.0 : 36.0;
          float grain = vnoise(vec2(g.x * 1.4 + seed * 9.0, g.y * k));
          col *= 0.8 + 0.34 * mix(0.5, grain, fine);
          if (mt == 11.0) col *= 0.85 + 0.2 * step(0.5, fract(g.x * 3.0 + grain));
          bBump = vec3(0.0, (grain - 0.5) * 0.2, 1.0);
          if (sz.x < sz.y) bBump.xy = bBump.yx;
          bRough = 0.85;
        } else if (mt == 4.0) {
          // stone: coursed rubble, 0.3 m courses, irregular lengths, recessed joints
          float rh = 0.28;
          float row = floor(uv.y / rh);
          float cx = uv.x / (0.42 + 0.16 * hash12(vec2(row, seed * 7.0))) + hash12(vec2(row, seed)) * 3.0;
          float ci = floor(cx);
          vec2 f = vec2(fract(cx) * 0.45, fract(uv.y / rh) * rh);
          float jd = min(min(f.x, 0.45 - f.x), min(f.y, rh - f.y));
          float mo = 1.0 - smoothstep(0.008, 0.028, jd);
          float t = hash12(vec2(ci, row) + seed * 5.0);
          col *= (0.8 + 0.3 * t) * (1.0 - 0.4 * mo * fine) * (0.92 + 0.16 * vnoise(uv * 9.0));
          bBump = vec3(0.0, 0.0, 1.0) + vec3((f.x < 0.225 ? 1.0 : -1.0), (f.y < rh * 0.5 ? 1.0 : -1.0), 0.0) * mo * 0.4;
          bRough = 0.82;
        } else if (mt == 5.0 || mt == 8.0) {
          // 窗 lattice window / open doorway: dark interior by day, lamplight at night
          float lit = mod(flags, 4.0) >= 2.0 ? 1.0 : 0.0;
          float fl = 1.0 + 0.12 * sin(uTime * 7.3 + seed * 40.0) * sin(uTime * 2.9 + seed * 17.0);
          vec3 lamp = vec3(1.0, 0.55, 0.24) * uLampOn * lit * fl;
          if (mt == 5.0) {
            float sp = 0.14, bw = 0.03;
            vec2 cell = abs(fract(uv / sp + 0.5) - 0.5) * sp;
            float bar = 1.0 - smoothstep(bw * 0.5 - aa, bw * 0.5 + aa, min(cell.x, cell.y));
            bar = max(bar, 1.0 - smoothstep(0.05 - aa, 0.05 + aa, ed));
            bar = mix(0.45, bar, fine);
            vec3 hole = mix(vec3(0.03, 0.028, 0.026), vec3(0.3, 0.27, 0.22), step(0.6, seed)); // some windows papered
            col = mix(hole, col, bar);
            bGlow = lamp * 2.2 * (1.0 - bar);
          } else {
            float depth = smoothstep(0.0, sz.y, uv.y);
            col = vec3(0.035, 0.03, 0.028) * (1.0 + 0.6 * (1.0 - depth));
            bGlow = lamp * mix(1.6, 0.5, depth);
          }
          lineK = 0.0; rimK = 0.0;
          bRough = 1.0;
        } else if (mt == 6.0) {
          // 瓦 grey tiles: pan and cover rows down the slope, 0.2 m courses
          if (wN.y > 0.25) {
            float px = uv.x / 0.24, fx = fract(px);
            float crest = cos(fx * 6.2832) * 0.5 + 0.5;
            float cf = fract(uv.y / 0.2);
            col *= mix(0.72, 1.08, crest) * mix(0.8, 1.0, smoothstep(0.0, 0.22, cf));
            col *= 0.9 + 0.2 * hash12(vec2(floor(px), floor(uv.y / 0.2)) + seed * 9.0);
            col = mix(col, col * vec3(0.8, 0.9, 0.72), 0.4 * smoothstep(0.55, 0.85, fbm3(vFogWP.xz * 0.5 + seed * 3.0)));
            bBump = vec3(sin(fx * 6.2832) * 0.8 * fine, (1.0 - smoothstep(0.0, 0.22, cf)) * 0.4, 1.0);
          } else {
            float fx = fract(uv.x / 0.24);
            col *= mix(0.55, 0.95, smoothstep(0.1, 0.5, abs(fx - 0.5) * 2.0));
          }
          lineK = 0.08;
          bRough = 0.8;
        } else if (mt == 7.0) {
          // lime-washed plaster, worn and stained low down
          col *= 0.9 + 0.14 * fbm3(uv * 1.6 + seed * 7.0);
          col = mix(col * vec3(0.7, 0.66, 0.6), col, smoothstep(0.1, 0.9, base));
          col *= 1.0 - 0.1 * smoothstep(0.6, 0.9, vnoise(vec2(uv.x * 4.0, seed * 5.0))) * smoothstep(sz.y - 0.9, sz.y, uv.y) * vert;
        } else if (mt == 9.0) {
          // a stack of split firewood: log ends on the faces across the grain, bark along it
          if (vert > 0.5) {
            vec2 c = uv / 0.15;
            vec2 ci = floor(c);
            vec2 f = fract(c) - 0.5 + (vec2(hash12(ci + seed), hash12(ci + 3.7)) - 0.5) * 0.18;
            float r = length(f);
            float lg = 1.0 - smoothstep(0.4 - aa * 6.0, 0.47, r);
            vec3 endc = col * 1.35 * (0.92 + 0.08 * sin(r * 48.0));
            col = mix(col * 0.28, endc, lg);
            bBump = vec3(f * 0.6 * lg, 1.0);
          } else {
            col *= 0.7 + 0.3 * vnoise(uv * vec2(3.0, 20.0));
          }
        } else if (mt == 10.0) {
          // 席 a woven mat
          float w = step(0.5, fract((uv.x + uv.y) * 12.0)) * 0.5 + step(0.5, fract((uv.x - uv.y) * 12.0)) * 0.5;
          col *= 0.86 + 0.18 * mix(0.5, w, fine);
        }

        // the bevel: a dark hairline on every edge, softening at distance
        float line = 1.0 - smoothstep(0.012 - aa, 0.012 + aa, ed);
        float rim = 1.0 - smoothstep(0.0, 0.05 + aa, ed);
        col *= 1.0 - (line * lineK + rim * rimK) * fine;
        // contact shadow at the foot and under the eaves
        col *= mix(0.6, 1.0, smoothstep(0.0, 0.85, base));
        if (mod(flags, 2.0) >= 1.0) col *= mix(1.0, 0.68, smoothstep(sz.y - 0.9, sz.y, uv.y) * vert);
        diffuseColor.rgb = col;
      }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = bRough;')
      .replace('#include <normal_fragment_maps>', /* glsl */ `#include <normal_fragment_maps>
      {
        vec3 q0 = dFdx(-vViewPosition), q1 = dFdy(-vViewPosition);
        vec2 st0 = dFdx(vFace.xy), st1 = dFdy(vFace.xy);
        vec3 N = normal;
        vec3 q1p = cross(q1, N), q0p = cross(N, q0);
        vec3 T = q1p * st0.x + q0p * st1.x, B = q1p * st0.y + q0p * st1.y;
        float det = max(dot(T, T), dot(B, B));
        float sc = det == 0.0 ? 0.0 : inversesqrt(det);
        vec3 nb = normalize(T * (bBump.x * sc) + B * (bBump.y * sc) + N * bBump.z);
        normal = (bBump.x == 0.0 && bBump.y == 0.0) ? normal : nb;
      }`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += bGlow;');
  });
  material = m;
  return m;
}
