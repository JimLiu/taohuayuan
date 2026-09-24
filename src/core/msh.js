// Readers for the two compact mesh formats of the reference scene (Sakura River Valley):
//   MSH1: one or more static meshes, positions and uvs quantised to 16 bits inside a box, normals to 8
//   SKN1: one skinned mesh with its bones (rest TRS, inverse bind matrix, name) and a JSON extension
// As published they are gzipped (.mshz, made by tools/optimize-assets.sh) and opened here with the browser's own
// DecompressionStream; a server that already undid the gzip on the way, or a plain .msh, is read as it comes.
import * as THREE from 'three';

const al = (a) => (a + 3) & -4;

export function parseMSH(buf) {
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x3148534d) throw new Error('bad mesh');
  const n = dv.getUint32(4, true), out = [];
  let o = 8;
  for (let k = 0; k < n; k++) {
    const nv = dv.getUint32(o, true), ni = dv.getUint32(o + 4, true);
    const f = (i) => dv.getFloat32(o + 8 + i * 4, true);
    const mn = [f(0), f(1), f(2)], mx = [f(3), f(4), f(5)], uv0 = [f(6), f(7)], uv1 = [f(8), f(9)];
    o += 48;
    const P = new Uint16Array(buf, o, nv * 3); o += al(nv * 6);
    const N = new Int8Array(buf, o, nv * 3); o += al(nv * 3);
    const U = new Uint16Array(buf, o, nv * 2); o += al(nv * 4);
    const big = nv >= 65536;
    const I = big ? new Uint32Array(buf, o, ni) : new Uint16Array(buf, o, ni); o += al(ni * (big ? 4 : 2));
    out.push(build(nv, P, N, U, mn, mx, uv0, uv1, big ? new Uint32Array(I) : new Uint16Array(I)));
  }
  return out;
}

export function parseSKN(buf) {
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x314e4b53) throw new Error('bad skin');
  const nv = dv.getUint32(4, true), ni = dv.getUint32(8, true), nb = dv.getUint32(12, true);
  const f = (i) => dv.getFloat32(16 + i * 4, true);
  const mn = [f(0), f(1), f(2)], mx = [f(3), f(4), f(5)], uv0 = [f(6), f(7)], uv1 = [f(8), f(9)];
  let o = 56;
  const bones = [];
  for (let b = 0; b < nb; b++) {
    const parent = dv.getInt32(o, true); o += 4;
    const P = []; for (let i = 0; i < 10; i++, o += 4) P.push(dv.getFloat32(o, true));
    const ibm = []; for (let i = 0; i < 16; i++, o += 4) ibm.push(dv.getFloat32(o, true));
    let name = ''; for (let i = 0; i < 16; i++) { const c = dv.getUint8(o + i); if (c) name += String.fromCharCode(c); }
    o += 16;
    bones.push({ parent, t: P.slice(0, 3), r: P.slice(3, 7), s: P.slice(7, 10), ibm, name });
  }
  const P = new Uint16Array(buf, o, nv * 3); o += al(nv * 6);
  const N = new Int8Array(buf, o, nv * 3); o += al(nv * 3);
  const U = new Uint16Array(buf, o, nv * 2); o += al(nv * 4);
  const SI = new Uint8Array(buf, o, nv * 4); o += nv * 4;
  const SW = new Uint8Array(buf, o, nv * 4); o += nv * 4;
  const big = nv >= 65536;
  const I = big ? new Uint32Array(buf, o, ni) : new Uint16Array(buf, o, ni); o += al(ni * (big ? 4 : 2));
  let ext = null;
  if (o + 4 <= buf.byteLength) {
    const L = dv.getUint32(o, true);
    ext = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, o + 4, L)));
  }
  const g = build(nv, P, N, U, mn, mx, uv0, uv1, big ? new Uint32Array(I) : new Uint16Array(I));
  const W = new Float32Array(nv * 4);
  for (let i = 0; i < nv * 4; i++) W[i] = SW[i] / 255;
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(SI), 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(W, 4));
  return { geometry: g, bones, ext };
}

function build(nv, P, N, U, mn, mx, uv0, uv1, index) {
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
  for (let i = 0; i < nv; i++) {
    for (let k = 0; k < 3; k++) {
      pos[i * 3 + k] = mn[k] + (P[i * 3 + k] / 65535) * (mx[k] - mn[k]);
      nor[i * 3 + k] = N[i * 3 + k] / 127;
    }
    for (let k = 0; k < 2; k++) uv[i * 2 + k] = uv0[k] + (U[i * 2 + k] / 65535) * (uv1[k] - uv0[k]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

async function fetchBuf(url) {
  let r;
  try { r = await fetch(url); } catch { throw new Error(`无法连接，未能取得 ${url}`); }
  if (!r.ok) throw new Error(`资源缺失：${url}（${r.status}）`);
  const buf = await r.arrayBuffer();
  const b = new Uint8Array(buf, 0, 2);
  if (b[0] !== 0x1f || b[1] !== 0x8b) return buf;
  if (typeof DecompressionStream === 'undefined') throw new Error('浏览器版本过旧，无法解压模型文件（需要 Chrome 80、Safari 16.4、Firefox 113 或更新版本）');
  return new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}
export async function loadMSH(url) { return parseMSH(await fetchBuf(url)); }
export async function loadSKN(url) { return parseSKN(await fetchBuf(url)); }
