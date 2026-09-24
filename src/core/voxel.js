// Voxel meshing for rocks, the cave, houses, villagers and animals: a dense grid of palette indices
// becomes faces between solid and empty cells, with per-vertex ambient occlusion, a per-voxel tint and
// a soft bevel line on every face so blocks read as crafted pieces rather than noise.
import * as THREE from 'three';
import { hash3 } from './rng.js';
import { hook } from './shared.js';

export class VoxelGrid {
  constructor(nx, ny, nz, size = 1, origin = [0, 0, 0]) {
    this.nx = nx; this.ny = ny; this.nz = nz;
    this.size = size;
    this.ox = origin[0]; this.oy = origin[1]; this.oz = origin[2];
    this.d = new Uint8Array(nx * ny * nz);
    this.outside = 0; // value (or fn(i,j,k)) for cells beyond the grid: 0 empty, a solid id buries the edges
  }
  inside(i, j, k) { return i >= 0 && j >= 0 && k >= 0 && i < this.nx && j < this.ny && k < this.nz; }
  get(i, j, k) {
    if (this.inside(i, j, k)) return this.d[(k * this.ny + j) * this.nx + i];
    return typeof this.outside === 'function' ? this.outside(i, j, k) : this.outside;
  }
  set(i, j, k, v) { if (this.inside(i, j, k)) this.d[(k * this.ny + j) * this.nx + i] = v; }
  // world position of a cell centre
  wx(i) { return this.ox + (i + 0.5) * this.size; }
  wy(j) { return this.oy + (j + 0.5) * this.size; }
  wz(k) { return this.oz + (k + 0.5) * this.size; }
  fill(fn) {
    for (let k = 0; k < this.nz; k++) for (let j = 0; j < this.ny; j++) for (let i = 0; i < this.nx; i++) {
      const v = fn(this.wx(i), this.wy(j), this.wz(k), i, j, k);
      if (v) this.d[(k * this.ny + j) * this.nx + i] = v;
    }
    return this;
  }
  // integer-cell box, inclusive of lo, exclusive of hi
  box(i0, j0, k0, i1, j1, k1, v) {
    for (let k = Math.max(0, k0); k < Math.min(this.nz, k1); k++)
      for (let j = Math.max(0, j0); j < Math.min(this.ny, j1); j++)
        for (let i = Math.max(0, i0); i < Math.min(this.nx, i1); i++) this.d[(k * this.ny + j) * this.nx + i] = v;
    return this;
  }
}

// face frames: normal, and u,v spanning the face with u x v = n so corners wind outward
const DIRS = [
  { n: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1] },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { n: [0, 1, 0], u: [0, 0, 1], v: [1, 0, 0] },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { n: [0, 0, -1], u: [0, 1, 0], v: [1, 0, 0] },
];
const CORNERS = [[0, 0], [1, 0], [1, 1], [0, 1]];
const AO = [0.52, 0.7, 0.86, 1.0];

/**
 * palette: array indexed by voxel id of [r,g,b] (linear) or {c:[r,g,b], jitter}
 * opts.light(x,y,z,nx,ny,nz) -> 0..1 baked light (cave depth), optional
 * opts.skip(i,j,k,dir) -> true to omit a face (e.g. faces buried under terrain)
 * opts.faceShade: per-direction multipliers, a hint of the soft stylised lighting
 */
export function meshVoxels(grid, palette, opts = {}) {
  const { light = null, skip = null, jitter = 0.07, seed = 0 } = opts;
  const P = [], N = [], C = [], F = [], Lt = [], I = [];
  const s = grid.size;
  const solid = (i, j, k) => grid.get(i, j, k) !== 0;
  let vi = 0;
  for (let k = 0; k < grid.nz; k++) for (let j = 0; j < grid.ny; j++) for (let i = 0; i < grid.nx; i++) {
    const id = grid.d[(k * grid.ny + j) * grid.nx + i];
    if (!id) continue;
    const pe = palette[id];
    const base = Array.isArray(pe) ? pe : pe.c;
    const jit = Array.isArray(pe) ? jitter : pe.jitter ?? jitter;
    const h = hash3(i + seed * 131, j, k);
    const tint = 1 + (h - 0.5) * 2 * jit;
    const warm = (hash3(k, i + 7, j + seed) - 0.5) * jit * 0.5;
    for (let d = 0; d < 6; d++) {
      const { n, u, v } = DIRS[d];
      const ni = i + n[0], nj = j + n[1], nk = k + n[2];
      if (solid(ni, nj, nk)) continue;
      if (skip && skip(i, j, k, d)) continue;
      const px = i + (n[0] > 0 ? 1 : 0), py = j + (n[1] > 0 ? 1 : 0), pz = k + (n[2] > 0 ? 1 : 0);
      const ao = [];
      for (let c = 0; c < 4; c++) {
        const [a, b] = CORNERS[c];
        const su = a ? 1 : -1, sv = b ? 1 : -1;
        const s1 = solid(ni + u[0] * su, nj + u[1] * su, nk + u[2] * su) ? 1 : 0;
        const s2 = solid(ni + v[0] * sv, nj + v[1] * sv, nk + v[2] * sv) ? 1 : 0;
        const cc = solid(ni + u[0] * su + v[0] * sv, nj + u[1] * su + v[1] * sv, nk + u[2] * su + v[2] * sv) ? 1 : 0;
        ao.push(s1 && s2 ? 0 : 3 - (s1 + s2 + cc));
        const x = grid.ox + (px + u[0] * a + v[0] * b) * s;
        const y = grid.oy + (py + u[1] * a + v[1] * b) * s;
        const z = grid.oz + (pz + u[2] * a + v[2] * b) * s;
        P.push(x, y, z);
        N.push(n[0], n[1], n[2]);
        const k2 = AO[ao[c]] * tint;
        C.push(base[0] * k2 * (1 + warm), base[1] * k2, base[2] * k2 * (1 - warm));
        F.push(a, b);
        if (light) Lt.push(light(x, y, z, n[0], n[1], n[2]));
      }
      // flip the diagonal toward the brighter pair so AO gradients don't crease
      if (ao[0] + ao[2] < ao[1] + ao[3]) I.push(vi + 1, vi + 2, vi + 3, vi + 1, vi + 3, vi);
      else I.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
      vi += 4;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  g.setAttribute('aFace', new THREE.Float32BufferAttribute(F, 2));
  g.setAttribute('aLight', new THREE.Float32BufferAttribute(light ? Lt : new Array(vi).fill(1), 1));
  g.setIndex(vi > 65535 ? new THREE.Uint32BufferAttribute(I, 1) : new THREE.Uint16BufferAttribute(I, 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

// the shared voxel material: vertex colours, a soft bevel line that fades with distance, baked cave light
const cache = new Map();
export function voxelMaterial({ bevel = 0.1, rough = 0.9, key = 'vox', emissive = null } = {}) {
  const ck = `${key}:${bevel}:${rough}`;
  if (cache.has(ck)) return cache.get(ck);
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: rough, metalness: 0 });
  if (emissive) m.emissive = new THREE.Color(emissive);
  m.userData.uniforms = { uBevel: { value: bevel } };
  hook(m, ck, (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aFace;\nattribute float aLight;\nvarying vec2 vFace;\nvarying float vLight;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFace = aFace;\nvLight = aLight;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uBevel;\nvarying vec2 vFace;\nvarying float vLight;')
      .replace('#include <color_fragment>', `#include <color_fragment>
      {
        vec2 e2 = min(vFace, 1.0 - vFace);
        float ed = min(e2.x, e2.y);
        float aa = fwidth(ed);
        float line = 1.0 - smoothstep(uBevel * 0.35 - aa, uBevel * 0.35 + aa, ed);
        float rim = 1.0 - smoothstep(0.0, uBevel + aa, ed);
        float fade = 1.0 - smoothstep(0.06, 0.22, aa);
        diffuseColor.rgb *= 1.0 - (line * 0.07 + rim * 0.05) * fade;
        diffuseColor.rgb *= vLight;
      }`);
  });
  cache.set(ck, m);
  return m;
}

// build a small model from boxes in cell units: [[i0,j0,k0,i1,j1,k1,id], ...]
export function gridFromBoxes(boxes, size, pivot = [0, 0, 0]) {
  let i1 = 0, j1 = 0, k1 = 0;
  for (const b of boxes) { i1 = Math.max(i1, b[3]); j1 = Math.max(j1, b[4]); k1 = Math.max(k1, b[5]); }
  const g = new VoxelGrid(i1, j1, k1, size, [-pivot[0] * size, -pivot[1] * size, -pivot[2] * size]);
  for (const b of boxes) g.box(b[0], b[1], b[2], b[3], b[4], b[5], b[6]);
  return g;
}
