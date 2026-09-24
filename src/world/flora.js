// 桑竹之属: every tree in the story that is not a peach. Behind the village the mulberry orchard and the
// bamboo; willows along the pond and the canals; elms shading the back eaves (榆柳荫后檐); the old
// 槐 at the gate where the elders sit; a pine bough over the cave mouth that frames the first view;
// and, outside, the few trees along the creek beyond the peach wood (中无杂树: none among the peaches).
// The branching model is the peach forest's, with a spec per species; leaves are painted cards.
import * as THREE from 'three';
import { Rng, clamp, lerp, smoothstep } from '../core/rng.js';
import { perlin3, fbm2 } from '../core/noise.js';
import { hook, TRANSLUCENT } from '../core/shared.js';
import { canvas, bleed, tex, barkGeometry, sampleBranch, WIND_TREE } from './peach.js';
import {
  basinR, pondDist, CANALS, polyDist, fieldAt, PATHS_NS, PATHS_EW, FIELD_BOUNDS, DESCENT, THRESH,
  forestMask, inMouthBox, POND, BIG_TREE, creekDist, creekX, creekHW, EXIT, ENTRY, FLOOR, WATER_OUT, POND_Y,
} from './layout.js';
import { builtAt, unitAt, yardAt, WELLS, STACKS, toWorld, VROT, UNITS, unitToVillage } from './villageplan.js';
import { surfaceHeight, forestCover, mergeSimple } from './terrain.js';
import { CHAPTERS, PANO } from '../story/chapters.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
const perp = (d) => V().crossVectors(d, Math.abs(d.y) < 0.9 ? UP : V(1, 0, 0)).normalize();
const hsl = (h, s, l, a = 1) => `hsla(${h.toFixed(1)},${clamp(s, 0, 100).toFixed(1)}%,${clamp(l, 0, 100).toFixed(1)}%,${a})`;

// ------------------------------------------------------------------ foliage atlas
// eight 256x512 cells, the twig's base at the bottom: 槐 | 榆 (samaras) | 柳 x2 | 桑 | 竹 x2 | 松
const CELLS = 8, CW = 256, CH = 512;
export const CELL = { huai: 0, elm: 1, willow: 2, willow2: 3, mulberry: 4, bamboo: 5, bamboo2: 6, pine: 7 };

// a leaf with its base at the origin and its tip at (0, -len): 0 ovate, 1 lanceolate, 2 broad with a heart base
function leafPath(ctx, len, wid, shape) {
  ctx.beginPath();
  ctx.moveTo(0, 0);
  if (shape === 1) {
    ctx.bezierCurveTo(wid * 0.55, -len * 0.16, wid * 0.5, -len * 0.6, 0, -len);
    ctx.bezierCurveTo(-wid * 0.5, -len * 0.6, -wid * 0.55, -len * 0.16, 0, 0);
  } else if (shape === 2) {
    ctx.bezierCurveTo(wid * 0.22, wid * 0.08, wid * 0.62, -len * 0.06, wid * 0.52, -len * 0.44);
    ctx.bezierCurveTo(wid * 0.44, -len * 0.74, wid * 0.14, -len * 0.9, 0, -len);
    ctx.bezierCurveTo(-wid * 0.14, -len * 0.9, -wid * 0.44, -len * 0.74, -wid * 0.52, -len * 0.44);
    ctx.bezierCurveTo(-wid * 0.62, -len * 0.06, -wid * 0.22, wid * 0.08, 0, 0);
  } else {
    ctx.bezierCurveTo(wid * 0.64, -len * 0.18, wid * 0.56, -len * 0.72, 0, -len);
    ctx.bezierCurveTo(-wid * 0.56, -len * 0.72, -wid * 0.64, -len * 0.18, 0, 0);
  }
}
function leaf(ctx, x, y, ang, len, wid, shape, h, s, l, rib = true) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  leafPath(ctx, len, wid, shape);
  const g = ctx.createLinearGradient(-wid / 2, 0, wid / 2, 0);
  g.addColorStop(0, hsl(h, s, l * 0.84));
  g.addColorStop(0.47, hsl(h, s * 1.04, l * 1.08));
  g.addColorStop(0.53, hsl(h, s, l * 0.95));
  g.addColorStop(1, hsl(h, s * 0.94, l * 0.8));
  ctx.fillStyle = g;
  ctx.fill();
  if (rib && len > 16) {
    ctx.strokeStyle = hsl(h - 6, s * 0.6, Math.min(88, l * 1.35), 0.55);
    ctx.lineWidth = Math.max(0.8, wid * 0.045);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -len * 0.9); ctx.stroke();
  }
  ctx.restore();
}
// points along a gently bowed line
function bow(x0, y0, x1, y1, b, n = 16) {
  const pts = [];
  const nx = -(y1 - y0), ny = x1 - x0, nl = Math.hypot(nx, ny) || 1;
  for (let i = 0; i <= n; i++) {
    const t = i / n, k = Math.sin(t * Math.PI) * b;
    pts.push([lerp(x0, x1, t) + (nx / nl) * k, lerp(y0, y1, t) + (ny / nl) * k]);
  }
  return pts;
}
const along = (pts, t) => {
  const f = clamp(t, 0, 1) * (pts.length - 1), i = Math.min(pts.length - 2, Math.floor(f)), u = f - i;
  return [lerp(pts[i][0], pts[i + 1][0], u), lerp(pts[i][1], pts[i + 1][1], u)];
};
const dirAt = (pts, t) => {
  const f = clamp(t, 0, 1) * (pts.length - 1), i = Math.min(pts.length - 2, Math.floor(f));
  return Math.atan2(pts[i + 1][0] - pts[i][0], -(pts[i + 1][1] - pts[i][1]));
};
function twig(ctx, pts, w0, w1, col) {
  ctx.strokeStyle = col;
  ctx.lineCap = 'round';
  for (let i = 1; i < pts.length; i++) {
    ctx.lineWidth = lerp(w0, w1, i / (pts.length - 1));
    ctx.beginPath(); ctx.moveTo(pts[i - 1][0], pts[i - 1][1]); ctx.lineTo(pts[i][0], pts[i][1]); ctx.stroke();
  }
}

// 槐: the pinnate leaves just out, small fresh leaflets in pairs along each rachis
function compound(ctx, x, y, ang, L, rng) {
  const n = rng.int(4, 6), hue = rng.range(76, 90), sat = rng.range(40, 54), lig = rng.range(36, 47);
  const dx = Math.sin(ang), dy = -Math.cos(ang);
  ctx.strokeStyle = hsl(hue, sat * 0.7, lig * 0.9);
  ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + dx * L, y + dy * L); ctx.stroke();
  for (let i = 0; i < n; i++) {
    const t = 0.2 + (i / n) * 0.74;
    const px = x + dx * L * t, py = y + dy * L * t;
    for (const s of [-1, 1])
      leaf(ctx, px, py, ang + s * rng.range(0.95, 1.35), rng.range(22, 31), rng.range(11, 15), 0, hue + rng.range(-4, 4), sat, lig + rng.range(-6, 6));
  }
  leaf(ctx, x + dx * L, y + dy * L, ang + rng.range(-0.2, 0.2), 29, 14, 0, hue, sat, lig + 3);
}
function paintHuai(ctx, W, H, rng) {
  const pts = bow(W / 2 + rng.range(-10, 10), H + 6, W / 2 + rng.range(-30, 30), 36, rng.range(-24, 24));
  twig(ctx, pts, 6, 2, 'rgb(86,74,58)');
  let side = rng.sign();
  const items = [];
  for (let k = 0; k < 8; k++) {
    const t = 0.1 + k * 0.11 + rng.range(-0.03, 0.03);
    side = -side;
    items.push({ t, ang: dirAt(pts, t) + side * rng.range(0.45, 1.0), L: rng.range(100, 150) * (1 - t * 0.35), z: rng.next() });
  }
  items.sort((a, b) => a.z - b.z);
  for (const it of items) compound(ctx, ...along(pts, it.t), it.ang, it.L, rng);
  compound(ctx, ...pts[pts.length - 1], dirAt(pts, 1) + rng.range(-0.2, 0.2), 105, rng);
}
// 榆: in spring the elm is hung with its pale seed-coins (榆钱) before the leaves fill out
function paintElm(ctx, W, H, rng) {
  const main = bow(W / 2 + rng.range(-8, 8), H + 6, W / 2 + rng.range(-24, 24), 40, rng.range(-26, 26));
  twig(ctx, main, 6, 2, 'rgb(84,70,56)');
  const twigs = [main];
  for (let k = 0; k < 3; k++) {
    const t = 0.25 + k * 0.22;
    const [x, y] = along(main, t), a = dirAt(main, t) + (k % 2 ? 1 : -1) * rng.range(0.5, 0.9);
    const L = rng.range(120, 170);
    const p = bow(x, y, x + Math.sin(a) * L, y - Math.cos(a) * L, rng.range(-14, 14), 10);
    twig(ctx, p, 3.5, 1.5, 'rgb(90,76,60)');
    twigs.push(p);
  }
  for (const p of twigs) {
    for (let t = 0.15; t < 1.0; t += rng.range(0.12, 0.2)) {
      const [x, y] = along(p, t);
      if (rng.next() < 0.35) {
        leaf(ctx, x, y, dirAt(p, t) + rng.sign() * rng.range(0.6, 1.2), rng.range(30, 44), rng.range(16, 22), 0, rng.range(82, 92), 46, rng.range(34, 42));
        continue;
      }
      // a cluster of samaras: pale green discs, the seed a darker spot at the middle
      const n = rng.int(9, 16);
      for (let i = 0; i < n; i++) {
        const a = rng.range(0, 6.28), r = rng.range(3, 17);
        const cx = x + Math.cos(a) * r, cy = y + Math.sin(a) * r * 0.8 - 4, R = rng.range(7, 10);
        ctx.fillStyle = hsl(rng.range(64, 76), rng.range(40, 52), rng.range(56, 66));
        ctx.beginPath(); ctx.ellipse(cx, cy, R, R * rng.range(0.8, 1), rng.range(0, 3), 0, 6.28); ctx.fill();
        ctx.fillStyle = hsl(62, 36, 44, 0.8);
        ctx.beginPath(); ctx.arc(cx, cy, R * 0.28, 0, 6.28); ctx.fill();
      }
    }
  }
}
// 柳: three hanging strands (the card hangs from its base), narrow leaves pointing to the tip
function paintWillow(ctx, W, H, rng) {
  for (const [x0, top] of [[W * 0.3, rng.range(40, 140)], [W * 0.52, rng.range(10, 60)], [W * 0.72, rng.range(60, 200)]]) {
    const pts = bow(x0 + rng.range(-8, 8), H + 4, x0 + rng.range(-20, 20), top, rng.range(-10, 10), 20);
    twig(ctx, pts, 2.4, 1.2, 'rgb(118,112,64)');
    let side = 1;
    for (let t = 0.03; t < 1.0; t += rng.range(0.028, 0.04)) {
      side = -side;
      const [x, y] = along(pts, t);
      const l = rng.range(30, 40) * (1 - 0.4 * t);
      leaf(ctx, x, y, dirAt(pts, t) + side * rng.range(0.22, 0.5), l, l * 0.2, 1, rng.range(72, 84), rng.range(48, 60), rng.range(44, 55), false);
    }
  }
}
// 桑: a straight year's shoot with broad leaves on long stalks, the young ones folded at the tip
function paintMulberry(ctx, W, H, rng) {
  const pts = bow(W / 2 + rng.range(-6, 6), H + 6, W / 2 + rng.range(-16, 16), 30, rng.range(-8, 8));
  twig(ctx, pts, 6, 2.5, 'rgb(112,100,76)');
  let side = rng.sign();
  for (let t = 0.08; t < 0.86; t += rng.range(0.12, 0.16)) {
    side = -side;
    const [x, y] = along(pts, t);
    const a = dirAt(pts, t) + side * rng.range(1.0, 1.4);
    const ps = rng.range(12, 22), px = x + Math.sin(a) * ps, py = y - Math.cos(a) * ps;
    ctx.strokeStyle = 'rgb(120,140,70)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(px, py); ctx.stroke();
    const L = rng.range(78, 100) * (1 - 0.45 * t), bl = a + side * rng.range(0.1, 0.5);
    const hue = rng.range(84, 94), lig = rng.range(36, 44);
    leaf(ctx, px, py, bl, L, L * 0.86, 2, hue, 50, lig);
    // palmate veins from the stalk
    ctx.save(); ctx.translate(px, py); ctx.rotate(bl);
    ctx.strokeStyle = hsl(hue, 34, lig * 1.45, 0.5); ctx.lineWidth = 1;
    for (const v of [-0.55, 0, 0.55]) { ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.sin(v) * L * 0.4, -Math.cos(v) * L * 0.7); ctx.stroke(); }
    ctx.restore();
  }
  const [tx, ty] = pts[pts.length - 1];
  for (let i = 0; i < 4; i++) leaf(ctx, tx, ty + 8, rng.range(-0.7, 0.7), rng.range(26, 42), rng.range(16, 24), 2, rng.range(78, 86), 56, rng.range(48, 56));
}
// 竹: a spray of branchlets, each ending in a fan of long narrow leaves that droop
function paintBamboo(ctx, W, H, rng) {
  const main = bow(W / 2 + rng.range(-10, 10), H + 6, W / 2 + rng.range(-40, 40), 70, rng.range(-18, 18), 12);
  twig(ctx, main, 3.5, 1.5, 'rgb(108,120,70)');
  const tips = [[main[main.length - 1], dirAt(main, 1)]];
  for (let k = 0; k < 4; k++) {
    const t = 0.2 + k * 0.2 + rng.range(-0.04, 0.04);
    const [x, y] = along(main, t), a = dirAt(main, t) + (k % 2 ? 1 : -1) * rng.range(0.5, 1.0);
    const L = rng.range(70, 130);
    const p = bow(x, y, x + Math.sin(a) * L, y - Math.cos(a) * L, rng.range(-10, 10), 8);
    twig(ctx, p, 2, 1, 'rgb(108,120,70)');
    tips.push([p[p.length - 1], dirAt(p, 1)]);
  }
  for (const [[x, y], a] of tips) {
    const n = rng.int(4, 7);
    for (let i = 0; i < n; i++) {
      const yellow = rng.next() < 0.1;
      const ang = a + rng.range(-1.5, 1.5) + (rng.next() < 0.4 ? Math.PI * 0.8 * rng.sign() : 0);
      const L = rng.range(78, 112);
      leaf(ctx, x, y, ang, L, rng.range(11, 15), 1, yellow ? rng.range(52, 60) : rng.range(90, 104), yellow ? 38 : rng.range(32, 44), yellow ? 56 : rng.range(34, 46));
    }
  }
}
// 松: the needles in rounded fans (the pads of a painted pine), one at each shoot's end along a twig
function paintPine(ctx, W, H, rng) {
  const pts = bow(W / 2 + rng.range(-8, 8), H + 6, W / 2 + rng.range(-20, 20), 70, rng.range(-12, 12), 14);
  twig(ctx, pts, 7, 3, 'rgb(96,68,50)');
  const fans = [];
  for (let t = 0.3; t < 0.8; t += rng.range(0.14, 0.2)) {
    const [x, y] = along(pts, t), a = dirAt(pts, t) + rng.sign() * rng.range(0.5, 0.9), L = rng.range(26, 40);
    const ex = x + Math.sin(a) * L, ey = y - Math.cos(a) * L;
    twig(ctx, [[x, y], [ex, ey]], 3, 2, 'rgb(96,70,52)');
    fans.push([ex, ey, a, rng.range(34, 46)]);
  }
  fans.push([...pts[pts.length - 1], dirAt(pts, 1), 54]);
  for (const [x, y, a0, R] of fans) {
    // dark underside first, then the lit needles over it
    for (const [sh, lig, k] of [[0, 17, 1.0], [1, 29, 0.9]]) {
      const n = sh ? 34 : 26;
      for (let i = 0; i < n; i++) {
        const a = a0 + lerp(-1.55, 1.55, i / (n - 1)) + rng.range(-0.06, 0.06), L = R * k * rng.range(0.82, 1.0);
        ctx.strokeStyle = hsl(rng.range(110, 128), rng.range(26, 36), lig + rng.range(-4, 5));
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(x, y - (sh ? 2 : 0)); ctx.lineTo(x + Math.sin(a) * L, y - (sh ? 2 : 0) - Math.cos(a) * L); ctx.stroke();
      }
    }
  }
}

let _atlas = null;
function foliageAtlas() {
  if (_atlas) return _atlas;
  const c = canvas(CW * CELLS, CH), ctx = c.getContext('2d'), rng = new Rng(9090);
  const P = [paintHuai, paintElm, paintWillow, paintWillow, paintMulberry, paintBamboo, paintBamboo, paintPine];
  P.forEach((paint, i) => {
    ctx.save();
    ctx.beginPath(); ctx.rect(i * CW, 0, CW, CH); ctx.clip();
    ctx.translate(i * CW, 0);
    paint(ctx, CW, CH, rng);
    ctx.restore();
  });
  bleed(ctx, c.width, c.height);
  return (_atlas = tex(c));
}

// grey-brown bark with long furrows (elm, 槐, willow; mulberry and pine are tinted from it)
function barkTextures() {
  const W = 256, H = 512, rng = new Rng(4711);
  const c = canvas(W, H), ctx = c.getContext('2d');
  const hc = canvas(W, H), hx = hc.getContext('2d');
  ctx.fillStyle = 'rgb(118,108,96)'; ctx.fillRect(0, 0, W, H);
  hx.fillStyle = 'rgb(150,150,150)'; hx.fillRect(0, 0, W, H);
  for (let i = 0; i < 700; i++) {
    const x = rng.range(0, W), y = rng.range(0, H), r = rng.range(4, 20), k = rng.range(0.82, 1.18);
    ctx.fillStyle = `rgba(${(118 * k) | 0},${(106 * k) | 0},${(92 * k) | 0},0.25)`;
    ctx.beginPath(); ctx.ellipse(x, y, r * 0.6, r * rng.range(1.5, 4), 0, 0, 6.28); ctx.fill();
  }
  // furrows: long, wandering, joining; the ridges between them catch the light
  for (let i = 0; i < 44; i++) {
    let x = rng.range(0, W), y = rng.range(-60, H);
    const L = rng.range(90, 260), w = rng.range(2.5, 6);
    ctx.strokeStyle = 'rgba(46,38,32,0.85)'; hx.strokeStyle = 'rgb(20,20,20)';
    ctx.lineWidth = hx.lineWidth = w;
    ctx.beginPath(); hx.beginPath(); ctx.moveTo(x, y); hx.moveTo(x, y);
    for (let s = 0; s < 10; s++) { x += rng.range(-6, 6); y += L / 10; ctx.lineTo(x, y); hx.lineTo(x, y); }
    ctx.stroke(); hx.stroke();
  }
  // lichen
  for (let i = 0; i < 30; i++) {
    ctx.fillStyle = `rgba(${rng.range(130, 160) | 0},${rng.range(140, 160) | 0},${rng.range(110, 130) | 0},0.3)`;
    ctx.beginPath(); ctx.ellipse(rng.range(0, W), rng.range(0, H), rng.range(6, 18), rng.range(8, 24), 0, 0, 6.28); ctx.fill();
  }
  const wrap = (cv) => { const t = cv.getContext('2d'); t.drawImage(cv, W - 12, 0, 12, H, 0, 0, 12, H); };
  wrap(c); wrap(hc);
  const map = tex(c);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  const hd = hx.getImageData(0, 0, W, H).data;
  const nc = canvas(W, H), nctx = nc.getContext('2d'), nim = nctx.createImageData(W, H), nd = nim.data;
  const hgt = (x, y) => hd[(((y + H) % H) * W + ((x + W) % W)) * 4] / 255;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = (hgt(x + 1, y) - hgt(x - 1, y)) * 2.4, dy = (hgt(x, y + 1) - hgt(x, y - 1)) * 2.4;
    const l = Math.hypot(dx, dy, 1), i = (y * W + x) * 4;
    nd[i] = (-dx / l * 0.5 + 0.5) * 255; nd[i + 1] = (dy / l * 0.5 + 0.5) * 255; nd[i + 2] = (1 / l * 0.5 + 0.5) * 255; nd[i + 3] = 255;
  }
  nctx.putImageData(nim, 0, 0);
  const nrm = tex(nc, false);
  nrm.wrapS = nrm.wrapT = THREE.RepeatWrapping;
  return { map, nrm };
}

// ------------------------------------------------------------------ materials
function barkMaterial(bt, color) {
  const m = new THREE.MeshStandardMaterial({ map: bt.map, normalMap: bt.nrm, roughness: 0.9, metalness: 0, color });
  m.normalScale.set(1.2, 1.2);
  return hook(m, 'flora-bark', (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aWind;\n' + WIND_TREE)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      {
        mat3 M = mat3(modelMatrix) * mat3(instanceMatrix);
        vec3 wp0 = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        transformed += treeSway(wp0, instanceMatrix[3].xyz, aWind.x, aWind.y, M);
      }`);
  });
}

let _cardMat = null, _cardDepth = null;
function cardMaterial() {
  if (_cardMat) return _cardMat;
  const map = foliageAtlas();
  const m = new THREE.MeshStandardMaterial({ map, vertexColors: true, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.72, metalness: 0 });
  m.alphaToCoverage = true;
  _cardMat = hook(m, 'flora-cards', (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aWind;\n' + WIND_TREE)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      {
        mat3 M = mat3(modelMatrix) * mat3(instanceMatrix);
        vec3 wp0 = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        transformed += treeSway(wp0, instanceMatrix[3].xyz, aWind.x, aWind.y, M);
        float g = windGust(wp0);
        transformed += transpose(M) * vec3(sin(uTime * 3.7 + aWind.y * 7.0 + wp0.x), sin(uTime * 2.9 + aWind.y * 5.0), cos(uTime * 4.3 + wp0.z)) * 0.02 * g * min(aWind.x, 4.0) * 0.4 / dot(M[0], M[0]);
      }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <map_fragment>', `#include <map_fragment>
      {
        // thin leaves average away in the smaller mips: raise the alpha with the mip level
        vec2 dx = dFdx(vMapUv * vec2(${CW * CELLS}.0, ${CH}.0)), dy = dFdy(vMapUv * vec2(${CW * CELLS}.0, ${CH}.0));
        float lod = max(0.0, 0.5 * log2(max(dot(dx, dx), dot(dy, dy))));
        diffuseColor.a *= 1.0 + lod * 0.3;
      }`)
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
      normal = normalize(vNormal);`)
      .replace('#include <lights_fragment_begin>', `#include <lights_fragment_begin>
      {
        ${TRANSLUCENT}
        reflectedLight.directDiffuse += sunC * diffuseColor.rgb * (sunBack * 1.1 + sunWrap * 0.1);
      }`);
  });
  _cardDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: 0.45 });
  return _cardMat;
}

// ------------------------------------------------------------------ the branching model, per species
// (as the peach's: len/radius ratios/child counts/angles per order, gnarl and droop; plus the trunk)
const SPECIES = {
  // the elders' tree: a thick short bole, heavy spreading limbs, a broad dome
  huai: {
    depth: 4, trunk: { len: 2.7, rad: 0.46, stems: 1, kids: [5, 6], tilt: [0.0, 0.05] }, lean: 0.0,
    len: [2.7, 3.8, 2.4, 1.3, 0.62], radRatio: [0.6, 0.55, 0.5, 0.45], kids: [4, 4, 4, 5],
    start: [0.72, 0.28, 0.2, 0.15], angle: [0.9, 0.66, 0.62, 0.55], gnarl: [0.05, 0.2, 0.25, 0.24, 0.14],
    up: [0, 0.012, 0.012, 0.02, 0.04], droop: [0, 0.14, 0.14, 0.1, 0.06], spread: [0, 1.0, 0.35, 0.1, 0],
    segLen: [0.3, 0.34, 0.26, 0.2, 0.14], shorten: 0.35, taper: 0.62,
  },
  // 榆: taller, more upright, the crown open and ragged
  elm: {
    depth: 4, trunk: { len: 3.6, rad: 0.26, stems: 1, kids: [3, 5], tilt: [0.02, 0.1] }, lean: 0.03,
    len: [3.6, 3.4, 2.2, 1.1, 0.55], radRatio: [0.58, 0.55, 0.5, 0.45], kids: [4, 4, 4, 4],
    start: [0.6, 0.25, 0.2, 0.15], angle: [0.62, 0.62, 0.6, 0.55], gnarl: [0.08, 0.2, 0.24, 0.24, 0.14],
    up: [0.01, 0.03, 0.02, 0.02, 0.03], droop: [0, 0.06, 0.1, 0.1, 0.06], spread: [0, 0.6, 0.3, 0.1, 0],
    segLen: [0.34, 0.34, 0.26, 0.2, 0.14], shorten: 0.35, taper: 0.62,
  },
  // 柳: a stout leaning bole, a knuckled head, long whips rising then arching over
  willow: {
    depth: 3, trunk: { len: 2.6, rad: 0.3, stems: 1, kids: [8, 11], tilt: [0.05, 0.16] }, lean: 0.035,
    len: [2.6, 3.0, 1.9, 1.1], radRatio: [0.42, 0.5, 0.45], kids: [3, 4, 4],
    start: [0.86, 0.3, 0.3], angle: [0.5, 0.75, 0.7], gnarl: [0.12, 0.14, 0.16, 0.12],
    up: [0, 0.04, 0.0, -0.02], droop: [0, 0.2, 0.34, 0.4], spread: [0, 0.8, 0.3, 0.1],
    segLen: [0.3, 0.3, 0.22, 0.16], shorten: 0.25, taper: 0.62,
  },
  // 桑: a farm tree cut back every year, a low bole, fists of wood each sprouting straight shoots
  mulberry: {
    depth: 2, trunk: { len: 1.15, rad: 0.12, stems: 1, kids: [3, 4], tilt: [0.04, 0.16] }, lean: 0.05,
    len: [1.15, 0.75, 1.7], radRatio: [0.62, 0.3], kids: [3, 6],
    start: [0.9, 0.82], angle: [0.72, 0.3], gnarl: [0.18, 0.3, 0.05],
    up: [0, 0.02, 0.07], droop: [0, 0, 0], spread: [0, 0.9, 0.25],
    segLen: [0.2, 0.18, 0.2], shorten: 0, taper: 0.95,
  },
  // 松: a leaning cliff pine, limbs flung out level
  pine: {
    depth: 3, trunk: { len: 4.2, rad: 0.24, stems: 1, kids: [5, 6], tilt: [0.35, 0.45] }, lean: 0.1,
    len: [4.2, 3.2, 1.5, 0.7], radRatio: [0.45, 0.5, 0.45], kids: [5, 5, 5],
    start: [0.4, 0.2, 0.2], angle: [1.25, 0.8, 0.7], gnarl: [0.16, 0.22, 0.2, 0.12],
    up: [0.0, -0.01, 0.02, 0.04], droop: [0, 0.12, 0.06, 0.02], spread: [0, 0.3, 0.2, 0.1],
    segLen: [0.3, 0.3, 0.22, 0.14], shorten: 0.3, taper: 0.62,
  },
  // the framing pine: a tall leaning bole, long level limbs from its upper half
  bough: {
    depth: 3, trunk: { len: 8.0, rad: 0.3, stems: 1, kids: [5, 6], tilt: [0.3, 0.36] }, lean: 0.06,
    len: [8.0, 4.4, 1.8, 0.8], radRatio: [0.45, 0.5, 0.45], kids: [5, 5, 5],
    start: [0.5, 0.2, 0.2], angle: [1.05, 0.8, 0.7], gnarl: [0.1, 0.18, 0.2, 0.12],
    up: [0, 0.035, 0.03, 0.04], droop: [0, 0.05, 0.04, 0.02], spread: [0, 0.25, 0.2, 0.1],
    segLen: [0.35, 0.3, 0.22, 0.14], shorten: 0.35, taper: 0.62,
  },
};

function growTree(spec, seed, size, opt = {}) {
  const rng = new Rng(seed);
  const branches = [];
  const base = V(0, -0.15, 0);
  const leanA = opt.leanA ?? rng.range(0, 6.28), leanDir = V(Math.cos(leanA), 0, Math.sin(leanA));
  const D = spec.depth, sc = size;
  function grow(p0, dir, len, rad, depth, flex0, trunkKids) {
    const n = Math.max(3, Math.ceil(len / (spec.segLen[depth] * Math.max(0.7, sc))));
    const pts = [p0.clone()], rads = [rad], flex = [flex0];
    const p = p0.clone(), d = dir.clone();
    const rEnd = depth === D ? rad * 0.36 : rad * spec.taper;
    const ns = rng.range(0, 100);
    for (let i = 1; i <= n; i++) {
      const t = i / n, g = spec.gnarl[depth];
      d.x += perlin3(ns, i * 0.35, 0.5) * g * 1.5;
      d.y += perlin3(ns, i * 0.35, 7.5) * g * 0.8;
      d.z += perlin3(ns, i * 0.35, 13.5) * g * 1.5;
      d.y += spec.up[depth] - spec.droop[depth] * t * t;
      if (depth === 0) d.addScaledVector(leanDir, spec.lean * (1 - t));
      d.normalize();
      p.addScaledVector(d, len / n);
      pts.push(p.clone());
      rads.push(lerp(rad, rEnd, Math.pow(t, 0.9)));
      flex.push(flex0 + (len * t) / Math.max(0.05, rad * 40));
    }
    const me = { pts, rads, depth, flex, phase: rng.range(0, 6.28), len };
    branches.push(me);
    if (depth >= D) return;
    const nk = trunkKids ?? spec.kids[depth] + (rng.next() < 0.35 ? 1 : 0) - (rng.next() < 0.25 ? 1 : 0);
    const rot0 = rng.range(0, 6.28);
    for (let k = 0; k < nk; k++) {
      const C = lerp(spec.start[depth], 1, (k + rng.range(0.1, 0.9)) / nk);
      const L = C * n, i0 = Math.min(n - 1, Math.floor(L)), u = L - i0;
      const B = pts[i0].clone().lerp(pts[i0 + 1], u);
      const T = V().subVectors(pts[i0 + 1], pts[i0]).normalize();
      const X = perp(T).applyAxisAngle(T, rot0 + k * 2.39996 + rng.range(-0.4, 0.4));
      const nd = T.clone().applyAxisAngle(X, spec.angle[depth] * rng.range(0.75, 1.2));
      const out = V(B.x - base.x, 0, B.z - base.z);
      if (out.lengthSq() > 1e-4) { out.normalize(); nd.addScaledVector(out, spec.spread[depth + 1]); }
      nd.normalize();
      const r0 = lerp(rads[i0], rads[i0 + 1], u);
      const kr = Math.max(0.006, r0 * spec.radRatio[Math.min(depth, spec.radRatio.length - 1)] * rng.range(0.85, 1.1));
      const kl = spec.len[depth + 1] * sc * rng.range(0.75, 1.2) * (1 - spec.shorten * C * (depth > 0 ? 1 : 0));
      grow(B, nd, kl, depth + 1 === D ? Math.min(kr, 0.014) : kr, depth + 1, lerp(flex[i0], flex[i0 + 1], u));
    }
  }
  const T = spec.trunk;
  const tilt = rng.range(T.tilt[0], T.tilt[1]);
  const dir = V(Math.sin(tilt) * Math.cos(leanA), Math.cos(tilt), Math.sin(tilt) * Math.sin(leanA)).normalize();
  grow(base.clone(), dir, T.len * sc * rng.range(0.85, 1.15), T.rad * sc, 0, 0, rng.int(T.kids[0], T.kids[1]));
  return { branches, base, rng };
}

// ------------------------------------------------------------------ leaves on the wood
// cards: { a, e, w, roll, cell, flex, dflex, phase, flip, nrm? }
function foliage(tree, kind, rng, dense = 1) {
  const cards = [];
  const D = Math.max(...tree.branches.map((b) => b.depth));
  const pair = (a, e, w, cell, flex, phase, o = {}) => {
    const roll = rng.range(0, 6.28);
    for (let c = 0; c < (o.single ? 1 : 2); c++)
      cards.push({ a, e, w, roll: roll + c * 1.5708, cell, flex, dflex: o.dflex ?? 0.4, phase, flip: rng.next() < 0.5, nrm: o.nrm });
  };
  for (const b of tree.branches) {
    if (kind === 'huai' || kind === 'elm') {
      if (b.depth < D - 2) continue;
      // leafy sprays along the twigs and the outer ends of the limbs that carry them: a full crown
      // (dense: a field tree in full sun, leafy deeper into its crown)
      const t0 = b.depth === D ? 0.05 : b.depth === D - 1 ? (dense > 1 ? 0.15 : 0.4) : (dense > 1 ? 0.4 : 0.7);
      const step = (kind === 'huai' ? 0.34 : 0.4) / dense, L = kind === 'huai' ? 1.25 : 1.1;
      const segs = Math.max(1, Math.round((b.len * (1 - t0)) / step));
      for (let k = 0; k < segs; k++) {
        const s0 = sampleBranch(b, lerp(t0, 1, k / segs)), s1 = sampleBranch(b, lerp(t0, 1, (k + 1) / segs));
        const d = V().subVectors(s1.p, s0.p).normalize();
        // sprays turn outward and a little up, as leaves reach for the light at the crown's skin
        const out = V(s0.p.x, 0, s0.p.z).normalize().multiplyScalar(0.5);
        d.add(out).add(V(rng.range(-0.3, 0.3), rng.range(0.05, 0.35), rng.range(-0.3, 0.3))).normalize();
        pair(s0.p, s0.p.clone().addScaledVector(d, L * rng.range(0.85, 1.15)), L * 0.66, kind === 'huai' ? CELL.huai : CELL.elm, s0.flex + 0.3, b.phase);
      }
    } else if (kind === 'willow') {
      // 柳丝: strands hang from the whips every few hand-spans, longest from the outer arcs
      if (b.depth < 2) continue;
      for (let t = rng.range(0.05, 0.2); t < 1; t += 0.13 / Math.max(0.4, b.len)) {
        const s = sampleBranch(b, t);
        const L = Math.min(rng.range(1.5, 3.4) * (0.6 + 0.4 * t), s.p.y - 0.8);
        if (L < 0.5) continue;
        const e = s.p.clone().add(V(rng.range(-0.15, 0.15), -L, rng.range(-0.15, 0.15)));
        pair(s.p, e, 0.55, rng.next() < 0.5 ? CELL.willow : CELL.willow2, s.flex + 0.4, b.phase, { dflex: 3.2 });
      }
    } else if (kind === 'mulberry') {
      if (b.depth < D) continue;
      const segs = Math.max(1, Math.round(b.len / 0.5));
      for (let k = 0; k < segs; k++) {
        const s0 = sampleBranch(b, k / segs), s1 = sampleBranch(b, (k + 1) / segs);
        pair(s0.p, s1.p.clone().addScaledVector(V().subVectors(s1.p, s0.p).normalize(), 0.15), 0.46, CELL.mulberry, s0.flex + 0.2, b.phase);
      }
    } else if (kind === 'pine') {
      // tufts facing the sky along the outer wood, the pads of a painted pine
      if (b.depth < D - 1) continue;
      const t0 = b.depth === D ? 0.2 : 0.6;
      for (let t = t0; t < 1; t += 0.3 / Math.max(0.3, b.len)) {
        const s = sampleBranch(b, t);
        const d = s.d.clone(); d.y *= 0.3; d.normalize();
        const e = s.p.clone().addScaledVector(d, 0.8);
        cards.push({ a: s.p, e, w: 0.7, roll: 0, cell: CELL.pine, flex: s.flex + 0.2, dflex: 0.3, phase: b.phase, flip: rng.next() < 0.5, nrm: UP, flat: true });
        pair(s.p, e, 0.55, CELL.pine, s.flex + 0.2, b.phase, { single: true });
      }
    }
  }
  return cards;
}

function crownOf(tree) {
  const tips = tree.branches.filter((b) => b.depth >= tree.branches.reduce((m, b2) => Math.max(m, b2.depth), 0) - 1).map((b) => b.pts[b.pts.length - 1]);
  const centre = V();
  tips.forEach((p) => centre.add(p));
  centre.multiplyScalar(1 / Math.max(1, tips.length));
  let radius = 0.5, top = 0;
  for (const b of tree.branches) for (const p of b.pts) { radius = Math.max(radius, Math.hypot(p.x - centre.x, p.z - centre.z)); top = Math.max(top, p.y); }
  return { centre, radius, top };
}

function cardGeometry(cards, centre, radius, tint) {
  const n = cards.length;
  const P = new Float32Array(n * 12), N = new Float32Array(n * 12), UVs = new Float32Array(n * 8);
  const C = new Float32Array(n * 12), W = new Float32Array(n * 8), I = new Uint32Array(n * 6);
  const ax = V(), side = V(), nrm = V(), mid = V(), out = V();
  cards.forEach((c, i) => {
    ax.subVectors(c.e, c.a);
    const len = ax.length();
    ax.normalize();
    mid.addVectors(c.a, c.e).multiplyScalar(0.5);
    if (c.flat) side.crossVectors(ax, UP).normalize();
    else side.copy(perp(ax)).applyAxisAngle(ax, c.roll);
    nrm.crossVectors(ax, side).normalize();
    out.subVectors(mid, centre);
    const od = out.length() / radius;
    out.y *= 0.6;
    out.normalize();
    const sn = c.nrm ? c.nrm.clone().addScaledVector(out, 0.3).normalize() : nrm.clone().multiplyScalar(0.3).addScaledVector(out, 0.7).addScaledVector(UP, 0.3).normalize();
    const ao = clamp(0.5 + 0.5 * od, 0.45, 1) * lerp(0.82, 1, clamp((mid.y - centre.y) / radius + 0.5, 0, 1));
    const c0 = c.cell / CELLS, c1 = (c.cell + 1) / CELLS;
    [[-1, 0], [1, 0], [1, 1], [-1, 1]].forEach(([u, v], k) => {
      const j = i * 4 + k;
      P.set([
        c.a.x + ax.x * (v * len - 0.03) + side.x * u * c.w * 0.5,
        c.a.y + ax.y * (v * len - 0.03) + side.y * u * c.w * 0.5,
        c.a.z + ax.z * (v * len - 0.03) + side.z * u * c.w * 0.5,
      ], j * 3);
      N.set([sn.x, sn.y, sn.z], j * 3);
      UVs.set([lerp(c0, c1, (c.flip ? -u : u) * 0.5 + 0.5), v], j * 2);
      C.set([tint[0] * ao, tint[1] * ao, tint[2] * ao], j * 3);
      W.set([c.flex + v * c.dflex, c.phase], j * 2);
    });
    I.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(UVs, 2));
  g.setAttribute('color', new THREE.BufferAttribute(C, 3));
  g.setAttribute('aWind', new THREE.BufferAttribute(W, 2));
  g.setIndex(new THREE.BufferAttribute(I, 1));
  g.computeBoundingSphere();
  return g;
}

// a template: one grown tree, its bark at four levels of detail and its leaf cards
function template(kind, seed, size, tint, opt = {}) {
  const spec = opt.spec ?? SPECIES[kind];
  let tree = growTree(spec, seed, size, opt);
  if (opt.tries) {
    // a landmark tree: of several growths keep the broadest crown that stands squarely over its trunk
    let best = -1e9;
    for (let k = 0; k < opt.tries; k++) {
      const t = growTree(spec, seed + k * 101, size, opt), c = crownOf(t);
      const score = c.radius - 2.5 * Math.hypot(c.centre.x, c.centre.z) - 0.3 * Math.max(0, c.top - (opt.cap ?? 1e9));
      if (score > best) { best = score; tree = t; }
    }
  }
  if (opt.cap) {
    // keep the crown under a given height (the old tree must not tower over the village)
    const { top } = crownOf(tree);
    if (top > opt.cap) {
      const k = opt.cap / top;
      for (const b of tree.branches) { b.pts.forEach((p) => p.multiplyScalar(k)); b.rads = b.rads.map((r) => r * Math.sqrt(k)); b.len *= k; }
    }
  }
  const cr = crownOf(tree);
  const cards = foliage(tree, kind, tree.rng, opt.dense);
  // far off, half the sprays, each a little larger, carry the same crown (willow strands only widen:
  // longer ones would reach the ground)
  const far = cards.length > 400 && kind !== 'pine'
    ? cards.filter((c, i) => (i >> 1) % 2 === 0).map((c) => kind === 'willow'
      ? { ...c, w: c.w * 1.7 }
      : { ...c, w: c.w * 1.35, e: c.a.clone().lerp(c.e, 1.2) })
    : null;
  return {
    kind, tree, ...cr,
    lods: [0, 1, 2, 3].map((l) => barkGeometry(tree.branches, tree.base, l)),
    cards: cardGeometry(cards, cr.centre, cr.radius, tint),
    cardsFar: far && cardGeometry(far, cr.centre, cr.radius, tint),
    nCards: cards.length,
    users: [],
  };
}

// ------------------------------------------------------------------ where a tree may stand in the basin
const inFieldZone = (x, z) => x > FIELD_BOUNDS.x0 - 3 && x < FIELD_BOUNDS.x1 + 3 && z < FIELD_BOUNDS.z0 + 3 && z > FIELD_BOUNDS.z1 - 3;
export function groundFree(x, z, r = 1.2) {
  if (forestMask(x, z) > 0.01) return false;           // 中无杂树
  if (inMouthBox(x, z, -3)) return false;
  for (const [dx, dz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) if (fieldAt(x + dx, z + dz)) return false;
  if (inFieldZone(x, z)) {
    for (const px of PATHS_NS) if (Math.abs(x - px) < r + 1.4) return false;
    for (const pz of PATHS_EW) if (Math.abs(z - pz) < r + 1.4) return false;
  }
  const b = builtAt(x, z);
  if (b.house || b.yard || b.lane < r + 1.3) return false;
  if (unitAt(x, z, r + 0.4) || yardAt(x, z, r)) return false;
  if (pondDist(x, z) < r + 0.6) return false;
  for (const c of CANALS) if (polyDist(c, x, z).d < r + 1.6) return false;
  if (polyDist(DESCENT, x, z).d < r + 2.6) return false;
  if (Math.hypot(x - THRESH.x, z - THRESH.z) < THRESH.r + r + 2) return false;
  for (const w of WELLS) if (Math.hypot(x - w.p[0], z - w.p[1]) < r + 2.2) return false;
  for (const s of STACKS) if (Math.hypot(x - s.p[0], z - s.p[1]) < s.r + r + 1.6) return false;
  return true;
}

// ------------------------------------------------------------------ bamboo
// culms are templates in metres (a gentle lean and an arching top), instanced with only a turn and a
// slight scale; the node rings are drawn in the shader from the length along the culm
function culmGeometry(H, R, bend, rng, sides = 5) {
  const segs = Math.max(10, Math.round(H / 0.55));
  const P = [], N = [], UVs = [], W = [], I = [];
  const phase = rng.range(0, 6.28);
  const pt = (t) => V(bend * H * Math.pow(t, 2.4), H * t - bend * bend * H * 0.35 * Math.pow(t, 3), 0);
  let S = 0, prev = pt(0);
  for (let i = 0; i <= segs; i++) {
    const t = i / segs, c = pt(t);
    S += c.distanceTo(prev); prev = c;
    const d = V().subVectors(pt(Math.min(1, t + 0.01)), pt(Math.max(0, t - 0.01))).normalize();
    const nx = perp(d), bx = V().crossVectors(d, nx);
    const r = R * lerp(1, 0.42, Math.pow(t, 1.3)) * (t < 0.05 ? 1.1 : 1);
    for (let j = 0; j <= sides; j++) {
      const a = (j / sides) * 6.2832, g = nx.clone().multiplyScalar(Math.cos(a)).addScaledVector(bx, Math.sin(a));
      P.push(c.x + g.x * r, c.y + g.y * r, c.z + g.z * r);
      N.push(g.x, g.y, g.z);
      UVs.push(j / sides, S);
      W.push(5.2 * t * t, phase);
    }
    if (i < segs) for (let j = 0; j < sides; j++) {
      const a = i * (sides + 1) + j, b = a + sides + 1;
      I.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(UVs, 2));
  g.setAttribute('aWind', new THREE.Float32BufferAttribute(W, 2));
  g.setIndex(I);
  g.computeBoundingSphere();
  // branches from the nodes of the upper two thirds, two to a node on alternate sides, each a spray
  // that rises and then hangs: from a distance the grove is a feathery mass with culms showing below
  const cards = [];
  let az = rng.range(0, 6.28);
  for (let t = 0.34; t < 0.96; t += 0.5 / H) {
    const p = pt(t), d = V().subVectors(pt(t + 0.01), p).normalize();
    az += Math.PI * rng.range(0.7, 1.3);
    for (let k = 0; k < 2; k++) {
      const a = az + k * Math.PI + rng.range(-0.5, 0.5);
      const out = V(Math.cos(a), 0, Math.sin(a));
      const L = rng.range(1.3, 2.1) * lerp(1.0, 0.6, t);
      const dir = d.clone().multiplyScalar(0.5).addScaledVector(out, 0.85).add(V(0, -0.15, 0)).normalize();
      cards.push({ a: p, e: p.clone().addScaledVector(dir, L), w: L * 0.62, roll: rng.range(-0.5, 0.5), cell: rng.next() < 0.5 ? CELL.bamboo : CELL.bamboo2, flex: 5.2 * t * t + 0.2, dflex: 1.2, phase, flip: rng.next() < 0.5 });
      if (rng.next() < 0.6) cards.push({ a: p, e: p.clone().addScaledVector(dir, L * 0.9), w: L * 0.55, roll: 1.4 + rng.range(-0.3, 0.3), cell: CELL.bamboo2, flex: 5.2 * t * t + 0.2, dflex: 1.2, phase, flip: rng.next() < 0.5 });
    }
  }
  const top = pt(1), td = V().subVectors(top, pt(0.97)).normalize();
  for (let k = 0; k < 3; k++) cards.push({ a: pt(0.93), e: top.clone().addScaledVector(td, 0.9), w: 0.8, roll: k * 1.05, cell: CELL.bamboo, flex: 5.4, dflex: 1.0, phase, flip: k === 1 });
  return { culm: g, cards: cardGeometry(cards, V(bend * H * 0.5, H * 0.66, 0), Math.max(1.6, bend * H * 0.5 + 1.2), [0.56, 0.7, 0.62]), height: H };
}

function culmMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0 });
  return hook(m, 'flora-culm', (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aWind;\nvarying float vS;\n' + WIND_TREE)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      vS = uv.y;
      {
        mat3 M = mat3(modelMatrix) * mat3(instanceMatrix);
        vec3 wp0 = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        transformed += treeSway(wp0, instanceMatrix[3].xyz, aWind.x, aWind.y, M);
      }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vS;')
      .replace('#include <color_fragment>', `#include <color_fragment>
      {
        // the culm green, a waxy bloom just under each node, the node ring itself a little proud and darker
        float sp = 0.34 + 0.02 * sin(vS * 0.7);
        float f = fract(vS / sp);
        float ring = 1.0 - smoothstep(0.0, 0.035, min(f, 1.0 - f));
        float bloomK = smoothstep(0.86, 0.99, f) * 0.25;
        diffuseColor.rgb *= (1.0 - 0.32 * ring) * (1.0 + bloomK) * (0.92 + 0.12 * vnoise(vec2(vS * 3.0, vFogWP.x)));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.64, 0.6) * diffuseColor.g * 1.4, bloomK);
        diffuseColor.rgb *= mix(0.7, 1.0, smoothstep(0.0, 1.2, vS));
      }`);
  });
}


// ------------------------------------------------------------------ the lower slope wood
// Where the forest comes down to the fields and the meadows the canopy is solid: rounded crowns of
// broadleaf and the darker spires of evergreens, lying on the slope where the terrain shader paints its
// crowns. Higher up the painted canopy carries on alone.
export function cameraSamples() {
  const out = [{ p: PANO.p, l: PANO.l }];
  for (const ch of CHAPTERS) {
    if (!ch.cam) continue;
    for (let u = 0; u <= 1.0001; u += 0.05) {
      let c;
      try { c = ch.cam(u); } catch (e) { continue; }
      if (c && c.p && c.l) out.push({ p: c.p, l: c.l });
    }
  }
  return out;
}
export function segSphere(p, l, maxL, c, r) {
  const dx = l[0] - p[0], dy = l[1] - p[1], dz = l[2] - p[2], L = Math.hypot(dx, dy, dz) || 1;
  const t = clamp(((c.x - p[0]) * dx + (c.y - p[1]) * dy + (c.z - p[2]) * dz) / L, 0, Math.min(L, maxL));
  return Math.hypot(p[0] + (dx / L) * t - c.x, p[1] + (dy / L) * t - c.y, p[2] + (dz / L) * t - c.z) < r;
}

function lumpGeometry(kind) {
  let g;
  if (kind === 'broad') {
    g = new THREE.IcosahedronGeometry(1, 1);
    const P = g.attributes.position;
    for (let i = 0; i < P.count; i++) {
      const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
      const k = 1 + 0.26 * perlin3(x * 1.9 + 3.1, y * 1.9, z * 1.9 - 1.7) + 0.1 * perlin3(x * 4.3, y * 4.3 + 2.2, z * 4.3);
      P.setXYZ(i, x * k, y * k * 0.78 + 0.62, z * k);
    }
  } else {
    const a = new THREE.ConeGeometry(1, 1.9, 7, 1, false), b = new THREE.ConeGeometry(0.72, 1.6, 7, 1, false);
    a.translate(0, 1.15, 0); b.translate(0, 2.25, 0);
    for (const q of [a, b]) q.deleteAttribute('uv');
    g = mergeSimple([a.toNonIndexed(), b.toNonIndexed()]);
  }
  g.deleteAttribute('uv');
  // shade the underside: the crowns darken toward the ground they shadow
  const P = g.attributes.position, C = new Float32Array(P.count * 3);
  for (let i = 0; i < P.count; i++) {
    const k = lerp(0.5, 1.08, smoothstep(0.1, kind === 'broad' ? 1.5 : 2.9, P.getY(i)));
    C.set([k, k, k], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(C, 3));
  g.computeBoundingSphere();
  return g;
}

function lumpMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  return hook(m, 'flora-lump', (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      {
        // leaf masses on the crown: dappled at a few scales
        vec3 q = vFogWP * vec3(1.1, 1.4, 1.1);
        float n = vnoise(q.xz + q.y * 0.7) * 0.6 + vnoise(q.xz * 2.7 - q.y) * 0.4;
        diffuseColor.rgb *= 0.78 + 0.42 * n;
      }`);
  });
}

function buildSlopeWood(zg) {
  const rng = new Rng(2626);
  const cams = cameraSamples();
  const S = 5.0;
  const lumps = [];
  const regions = [
    { basin: true, x0: -260, x1: 290, z0: -490, z1: -30 },
    { basin: false, x0: -330, x1: 330, z0: 40, z1: 1000 },
  ];
  for (const R of regions) for (let x = R.x0; x < R.x1; x += S) for (let z = R.z0; z < R.z1; z += S) {
    const px = x + rng.range(0, S), pz = z + rng.range(0, S);
    const r = basinR(px, pz);
    if (R.basin ? r < 0.72 || r > 1.35 : creekDist(px, pz) > 250 || r < 1.1) continue;
    const f = forestCover(px, pz);
    // a closed canopy where the wood is established; at its fringe only a few clumps step out
    const clump = fbm2(px * 0.03 + 5.1, pz * 0.03 - 2.3, 2);
    const keep = f.w > 0.45 ? 0.2 + 0.8 * smoothstep(0.45, 0.7, f.w) : f.w > 0.25 && clump > 0.25 ? 0.5 : 0;
    if (rng.next() > keep) continue;
    if (f.y > (R.basin ? FLOOR : WATER_OUT) + 70) continue;
    if (inMouthBox(px, pz, -8) || forestMask(px, pz) > 0.01) continue; // (中无杂树)
    if (Math.hypot(px - EXIT.x, pz - EXIT.z) < 24 || Math.hypot(px - ENTRY.x, pz - ENTRY.z) < 24) continue;
    // (as the terrain shader paints them: outside, mostly dark conifer)
    const ever = rng.next() < (R.basin ? 0.28 + 0.42 * smoothstep(30, 150, f.y) : 0.62 + 0.3 * smoothstep(20, 120, f.y));
    const s = ever ? rng.range(1.8, 2.7) : rng.range(2.8, 4.4);
    const hy = ever ? (R.basin ? rng.range(1.2, 1.7) : rng.range(1.45, 2.1)) : rng.range(0.9, 1.25);
    const c = { x: px, y: f.y - 0.4, z: pz, s, hy, ever, col: f.c };
    // clear of every camera in the story and of what it looks at
    const cc = V(px, f.y + s * hy * (ever ? 1.4 : 0.7), pz), cr = s * 1.1;
    let blocked = false;
    for (const k of cams) {
      if (Math.abs(k.p[0] - px) > 90 || Math.abs(k.p[2] - pz) > 90) continue;
      if (Math.hypot(k.p[0] - px, k.p[2] - pz) < cr + 6 || segSphere(k.p, k.l, 70, cc, cr + 0.5)) { blocked = true; break; }
    }
    if (!blocked) lumps.push(c);
  }
  // instanced in 100 m chunks (so whole chunks drop out of the view, the shadow and the reflection)
  const geos = { broad: lumpGeometry('broad'), ever: lumpGeometry('ever') };
  const mat = lumpMaterial();
  const chunks = new Map();
  for (const l of lumps) {
    const key = `${l.z < 0 ? 'basin' : 'creek'},${Math.floor(l.x / 100)},${Math.floor(l.z / 100)},${l.ever ? 'ever' : 'broad'}`;
    if (!chunks.has(key)) chunks.set(key, []);
    chunks.get(key).push(l);
  }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
  for (const [key, L] of chunks) {
    const kind = key.endsWith('ever') ? 'ever' : 'broad';
    const im = new THREE.InstancedMesh(geos[kind], mat, L.length);
    L.forEach((l, i) => {
      q.setFromAxisAngle(UP, rng.range(0, 6.28));
      m4.compose(V(l.x, l.y, l.z), q, V(l.s * rng.range(0.9, 1.1), l.s * l.hy, l.s * rng.range(0.9, 1.1)));
      im.setMatrixAt(i, m4);
      // the painted canopy's colour at that spot, tinted as the shader tints its crowns
      const t = l.ever ? (l.z > 30 ? [0.55, 0.7, 0.8] : [0.74, 0.86, 0.92]) : lerp(1, 1.2, rng.next()) > 1.1 ? [1.18, 1.14, 0.86] : [1, 1, 1];
      const k = rng.range(0.9, 1.15) * 1.1;
      col.setRGB(l.col[0] * t[0] * k, l.col[1] * t[1] * k, l.col[2] * t[2] * k);
      im.setColorAt(i, col);
    });
    im.castShadow = true; im.receiveShadow = true;
    im.computeBoundingSphere();
    im.name = 'flora-wood';
    zg[key.split(',')[0]].add(im);
  }
  return lumps;
}

// ------------------------------------------------------------------ reeds
// 芦苇 in spring: new green blades from a forearm to a man's height at the water's edge, among a few of
// last year's stalks gone grey (no plumes: they are long blown away)
function reedGeometry(rng) {
  const P = [], N = [], C = [], W = [], I = [];
  const blades = rng.int(22, 30);
  for (let b = 0; b < blades; b++) {
    const old = rng.next() < 0.2;
    const a = rng.range(0, 6.28), r0 = rng.range(0, 0.3);
    const x0 = Math.cos(a) * r0, z0 = Math.sin(a) * r0, dx = Math.cos(a), dz = Math.sin(a);
    const H = old ? rng.range(1.6, 2.4) : rng.range(0.8, 1.9);
    const lean = old ? rng.range(0.02, 0.1) : rng.range(0.08, 0.35), bend = old ? 0 : rng.range(0.15, 0.55);
    const w0 = old ? 0.018 : rng.range(0.034, 0.055);
    const face = a + rng.range(-0.9, 0.9), sx = -Math.sin(face), sz = Math.cos(face);
    const col = old ? [0.46, 0.44, 0.39] : [rng.range(0.27, 0.34), rng.range(0.42, 0.5), rng.range(0.15, 0.2)];
    const ph = rng.range(0, 6.28), base = P.length / 3, S = 4;
    const nx = dx * 0.35, nz = dz * 0.35, nl = Math.hypot(nx, 0.9, nz);
    for (let k = 0; k <= S; k++) {
      const t = k / S;
      const out = (lean * t + bend * t * t * 0.5) * H, y = H * (t - bend * t * t * t * 0.3);
      const w = w0 * (1 - t * 0.92), cx = x0 + dx * out, cz = z0 + dz * out;
      P.push(cx - sx * w, y, cz - sz * w, cx + sx * w, y, cz + sz * w);
      const sh = lerp(0.5, 1.05, t), tip = old ? 1 : lerp(1, 1.22, t * t);
      for (let s = 0; s < 2; s++) {
        N.push(nx / nl, 0.9 / nl, nz / nl);
        C.push(col[0] * sh * tip, col[1] * sh * tip, col[2] * sh);
        W.push(t * t * (old ? 0.5 : 1), ph);
      }
    }
    for (let k = 0; k < S; k++) { const i = base + k * 2; I.push(i, i + 1, i + 3, i, i + 3, i + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  g.setAttribute('aWind', new THREE.Float32BufferAttribute(W, 2));
  g.setIndex(I);
  return g;
}

function reedMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.8, metalness: 0 });
  return hook(m, 'flora-reed', (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aWind;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      {
        mat3 M = mat3(modelMatrix) * mat3(instanceMatrix);
        vec3 wp0 = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        vec3 sw = windSway(wp0, aWind.x * 0.5, aWind.y + hash12(instanceMatrix[3].xz) * 6.2832);
        transformed += transpose(M) * sw / dot(M[0], M[0]);
      }`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_begin>', `#include <lights_fragment_begin>
      {
        ${TRANSLUCENT}
        reflectedLight.directDiffuse += sunC * diffuseColor.rgb * sunBack * 0.9;
      }`);
  });
}

function buildReeds(zg, trees) {
  const rng = new Rng(4545);
  const cams = cameraSamples();
  const pts = [];
  const grid = new Set();
  const tryAt = (x, z, lo, hi) => {
    const y = surfaceHeight(x, z);
    if (y < lo || y > hi) return;
    const k = `${Math.round(x / 0.75)},${Math.round(z / 0.75)}`;
    if (grid.has(k)) return;
    // in patches, with open water's edge between them
    if (fbm2(x * 0.09 + 1.3, z * 0.09 - 4.1, 2) < -0.02) return;
    if (fieldAt(x, z) || inMouthBox(x, z, -2)) return;
    if (polyDist(DESCENT, x, z).d < 3) return;
    const b = builtAt(x, z);
    if (b.house || b.yard || b.lane < 2) return;
    for (const t of trees) if (Math.abs(t.x - x) < 1.2 && Math.abs(t.z - z) < 1.2) return;
    for (const c of cams) {
      if (Math.abs(c.p[0] - x) > 30 || Math.abs(c.p[2] - z) > 30) continue;
      if (Math.hypot(c.p[0] - x, c.p[2] - z) < 3 || segSphere(c.p, c.l, 25, V(x, y + 1, z), 1.6)) return;
    }
    grid.add(k);
    pts.push({ x, y, z });
  };
  // the pond's margin and the canals' (the shallows and the wet foot of the bank)
  for (let i = 0; i < 16000; i++) {
    const x = POND.x + rng.range(-42, 42), z = POND.z + rng.range(-34, 34);
    const d = pondDist(x, z);
    if (d > -3 && d < 4) tryAt(x, z, POND_Y - 0.3, POND_Y + 0.45);
  }
  for (const c of CANALS) for (let i = 0; i < c.length - 1; i++) {
    const [ax, az] = c[i], [bx, bz] = c[i + 1], L = Math.hypot(bx - ax, bz - az);
    for (let d = 0; d < L; d += 0.6) for (const side of [-1, 1]) {
      const off = rng.range(0.9, 2.4), tx = (bx - ax) / L, tz = (bz - az) / L;
      const x = ax + tx * d - tz * off * side, z = az + tz * d + tx * off * side;
      if (basinR(x, z) < 0.97) tryAt(x, z, POND_Y - 0.3, POND_Y + 0.45);
    }
  }
  // the creek below the peach wood (none among the peaches, where the grass is short and the petals lie)
  for (let z = 345; z < 990; z += 0.7) for (const side of [-1, 1]) {
    const x = creekX(z) + side * (creekHW(z) + rng.range(-1.4, 1.2));
    if (forestMask(x, z) < 0.01) tryAt(x, z, WATER_OUT - 0.35, WATER_OUT + 0.5);
  }
  const geos = [0, 1, 2, 3].map(() => reedGeometry(rng));
  const mat = reedMaterial();
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
  const byG = geos.map(() => []), meshes = [];
  for (const p of pts) byG[rng.int(0, 3)].push(p);
  byG.forEach((L, k) => {
    // in 60 m chunks, dropped by the frustum and beyond a hundred and fifty metres
    const chunks = new Map();
    for (const p of L) {
      const key = `${Math.floor(p.x / 60)},${Math.floor(p.z / 60)}`;
      if (!chunks.has(key)) chunks.set(key, []);
      chunks.get(key).push(p);
    }
    for (const C of chunks.values()) {
      const im = new THREE.InstancedMesh(geos[k], mat, C.length);
      C.forEach((p, i) => {
        q.setFromAxisAngle(UP, rng.range(0, 6.28));
        const s = rng.range(0.75, 1.2);
        im.setMatrixAt(i, m4.compose(V(p.x, p.y - 0.05, p.z), q, V(s, s * rng.range(0.85, 1.15), s)));
      });
      im.receiveShadow = true;
      im.computeBoundingSphere();
      im.name = 'flora-reeds';
      zg[C[0].z < 0 ? 'basin' : 'creek'].add(im);
      meshes.push(im);
    }
  });
  return { count: pts.length, meshes };
}

// ------------------------------------------------------------------ the plan
// the orchard and the groves stand behind row D; in village coordinates (u along the rows, v to the fronts)
// the pine that frames the panorama: root offscreen on the hill left of the exit
export const BOUGH = { x: -8, z: -48, dy: -0.3, rot: 0.6, seed: 77, size: 0.9 };

const ORCHARD = { u0: -60, u1: 58, v0: -76, v1: -53, row: 4.2, step: 3.6 };
const GROVES = [
  // u, v, radius (u), radius (v), culms
  [-44, -96, 22, 12, 300],
  [2, -100, 20, 11, 260],
  [44, -94, 20, 12, 280],
  [78, -64, 10, 16, 170],
  [-74, -40, 8, 14, 120],
  [-84, -84, 12, 10, 150],
  [86, -20, 7, 10, 80],
];

function place(list, sp, x, z) {
  for (const t of list) if (Math.hypot(t.x - x, t.z - z) < (sp + t.sp) / 2) return false;
  return true;
}

// ------------------------------------------------------------------ outside: the creek below the peach wood
// 缘溪行: downstream of the peach wood the banks are open meadow, a willow leaning over the water here and
// there, knots of elm and 槐 standing out in the grass; none among the peaches, none in any camera's way
function creekTrees(trees, T) {
  const rng = new Rng(3131);
  const cams = cameraSamples();
  cams.push({ p: [30, 14, 420], l: [0, 9, 250] }); // the 'creek' still
  const clear = (x, z, tpl, s) => {
    const y = surfaceHeight(x, z);
    const c = V(x, y + tpl.centre.y * s, z), r = tpl.radius * s + 1.5;
    for (const k of cams) {
      if (Math.abs(k.p[2] - z) > 400) continue;
      if (Math.hypot(k.p[0] - x, k.p[2] - z) < r + 5) return false;
      if (segSphere(k.p, k.l, 1e9, c, r)) return false;
    }
    return true;
  };
  const e = 2;
  const slope = (x, z) => Math.hypot(surfaceHeight(x + e, z) - surfaceHeight(x - e, z), surfaceHeight(x, z + e) - surfaceHeight(x, z - e)) / (2 * e);
  const ok = (x, z) => forestMask(x, z) < 0.002 && basinR(x, z) > 1.1 && !inMouthBox(x, z, -6)
    && creekDist(x, z) > 1.8 && slope(x, z) < 0.38 && surfaceHeight(x, z) > WATER_OUT + 0.3
    && forestCover(x, z).w < 0.3; // (the wood on the slopes is the lumps' own)
  const Z0 = 352, Z1 = 990;
  let willows = 0, others = 0;
  // willows on the banks, in twos and threes with long open reaches between
  for (let z = Z0; z < Z1; z += rng.range(2.5, 5)) for (const side of [-1, 1]) {
    if (fbm2(z * 0.011 + side * 3.7, side * 1.3, 2) < 0.02 || rng.next() < 0.4) continue;
    const x = creekX(z) + side * (creekHW(z) + rng.range(2.2, 4.5));
    const tpl = T.willow[rng.int(0, T.willow.length - 1)], s = rng.range(0.95, 1.15);
    if (!ok(x, z) || !place(trees, 10, x, z) || !clear(x, z, tpl, s)) continue;
    trees.push({ kind: 'willow', x, z, rot: -(side > 0 ? Math.PI : 0) + rng.range(-0.8, 0.8), s, tpl, sp: 10, out: true });
    willows++;
  }
  // knots of broadleaf trees out on the meadow, and a few standing alone
  for (let g = 0; g < 900 && others < 90; g++) {
    const z = rng.range(Z0, Z1), side = rng.sign();
    const x = creekX(z) + side * (creekHW(z) + rng.range(7, 150));
    if (!ok(x, z)) continue;
    const m = rng.next() < 0.2 ? 1 : rng.int(3, 7), R = 2 + m * 1.3;
    const huai = rng.next() < 0.3;
    for (let k = 0, made = 0; k < m * 5 && made < m; k++) {
      const a = rng.range(0, 6.28), r = R * Math.sqrt(rng.next());
      const tx = x + Math.cos(a) * r, tz = z + Math.sin(a) * r;
      const list = huai && rng.next() < 0.7 ? T.huai : T.elm;
      // crowded, the crowns of a knot of trees grow into one another
      const tpl = list[rng.int(0, list.length - 1)], s = rng.range(0.85, 1.15), sp = tpl.radius * s * 0.85;
      if (!ok(tx, tz) || creekDist(tx, tz) < 5 || !place(trees, sp, tx, tz) || !clear(tx, tz, tpl, s)) continue;
      trees.push({ kind: tpl.kind, x: tx, z: tz, rot: rng.range(0, 6.28), s, tpl, sp, out: true });
      made++; others++;
    }
  }
  return { willows, others };
}

export function buildFlora() {
  const group = new THREE.Group();
  group.name = 'flora';
  // what grows in the basin and what grows outside: only one side of the mountain is ever in view
  const zg = { basin: new THREE.Group(), creek: new THREE.Group() };
  zg.basin.name = 'flora-basin'; zg.creek.name = 'flora-creek';
  group.add(zg.basin, zg.creek);
  const bt = barkTextures();
  const cardMat = cardMaterial();
  const barks = {
    mulberry: barkMaterial(bt, new THREE.Color(1.02, 0.96, 0.84)),
    willow: barkMaterial(bt, new THREE.Color(0.9, 0.86, 0.78)),
    elm: barkMaterial(bt, new THREE.Color(0.86, 0.8, 0.74)),
    huai: barkMaterial(bt, new THREE.Color(0.78, 0.72, 0.66)),
    pine: barkMaterial(bt, new THREE.Color(0.98, 0.78, 0.64)),
  };
  const trees = [];   // every tree with a trunk: { kind, x, y, z, rot, s, tpl, centre, radius, top, trunkR }

  // greedy spacing over shuffled candidates: { x, z, sp, ... } -> accepted into trees
  const accept = (cands, rng, max, make) => {
    for (let i = cands.length - 1; i > 0; i--) { const j = Math.floor(rng.next() * (i + 1)); [cands[i], cands[j]] = [cands[j], cands[i]]; }
    let n = 0;
    for (const c of cands) {
      if (n >= max) break;
      if (!place(trees, c.sp, c.x, c.z)) continue;
      trees.push(make(c));
      n++;
    }
    return n;
  };

  // --- 柳: round the pond and along the canals, each leaning out over the water
  const wilT = [0, 1, 2, 3].map((i) => template('willow', 901 + i * 31, 1.12 + i * 0.07, [0.86, 0.96, 0.7], { leanA: 0 }));
  {
    const rng = new Rng(733);
    const mk = (c) => ({ kind: 'willow', x: c.x, z: c.z, rot: -c.toWater + rng.range(-0.35, 0.35), s: rng.range(0.9, 1.12), tpl: wilT[rng.int(0, 3)], sp: c.sp });
    const pond = [];
    for (let i = 0; i < 1500; i++) {
      const x = POND.x + rng.range(-46, 46), z = POND.z + rng.range(-36, 36);
      const d = pondDist(x, z);
      if (d < 2.6 || d > 5.2 || !groundFree(x, z, 0.9)) continue;
      pond.push({ x, z, sp: 11, toWater: Math.atan2(POND.z - z, POND.x - x) });
    }
    accept(pond, rng, 9, mk);
    CANALS.forEach((c, ci) => {
      const cands = [];
      for (let i = 0; i < c.length - 1; i++) {
        const [ax, az] = c[i], [bx, bz] = c[i + 1], L = Math.hypot(bx - ax, bz - az);
        const tx = (bx - ax) / L, tz = (bz - az) / L;
        for (let d = 0; d < L; d += 2) for (const side of [-1, 1]) {
          const off = rng.range(2.7, 4.2);
          const x = ax + tx * d - tz * off * side, z = az + tz * d + tx * off * side;
          // along the field canal only west of the village front, where it cannot hide the houses
          if (ci === 1 && x > -30) continue;
          if (polyDist(c, x, z).d < 2.6 || !groundFree(x, z, 0.9) || basinR(x, z) > 0.9) continue;
          cands.push({ x, z, sp: 12, toWater: Math.atan2(-tx * side, tz * side) });
        }
      }
      accept(cands, rng, ci === 0 ? 9 : ci === 1 ? 2 : 6, mk);
    });
  }

  // --- 槐: the old tree at the village gate, broad and low enough not to stand over the roofs
  const huaiT = template('huai', 4242, 1.3, [0.72, 0.84, 0.62], { cap: 9, leanA: 0.9, tries: 24 });
  trees.push({ kind: 'huai', x: BIG_TREE.x, z: BIG_TREE.z, rot: 0.4, s: 1, tpl: huaiT, sp: 8 });

  // --- 榆: behind the houses (榆柳荫后檐) and at the corners of the village
  const elmT = [0, 1, 2].map((i) => template('elm', 1201 + i * 13, 0.92 + i * 0.08, [0.9, 0.96, 0.82]));
  {
    const rng = new Rng(1717);
    const cands = [];
    for (const un of UNITS) {
      if (un.kind !== 'hall') continue;
      for (let k = 0; k < 6; k++) {
        const [u, v] = unitToVillage(un, rng.range(-un.w * 0.6, un.w * 0.6), -un.d / 2 - rng.range(3.0, 5.0));
        const [x, z] = toWorld(u, v);
        if (groundFree(x, z, 1.1)) cands.push({ x, z, sp: 13 });
      }
    }
    for (let i = 0; i < 400; i++) {
      const side = rng.int(0, 2);
      const u = side === 0 ? rng.range(-84, -66) : side === 1 ? rng.range(80, 96) : rng.range(-70, 80);
      const v = side === 2 ? rng.range(-52, -48) : rng.range(-48, 36);
      const [x, z] = toWorld(u, v);
      if (groundFree(x, z, 1.1)) cands.push({ x, z, sp: 13 });
    }
    accept(cands, rng, 12, (c) => ({ kind: 'elm', x: c.x, z: c.z, rot: rng.range(0, 6.28), s: rng.range(0.9, 1.08), tpl: elmT[rng.int(0, 2)], sp: c.sp }));
  }

  // --- 松: one old pine on the hillside beside the cave mouth, its limbs reaching into the top corner of
  // the first view of the basin (the rock and a bough frame the picture, as a painter would)
  const pineT = template('pine', BOUGH.seed, BOUGH.size, [0.66, 0.76, 0.66], { leanA: 0, spec: SPECIES.bough });
  trees.push({ kind: 'pine', x: BOUGH.x, z: BOUGH.z, rot: BOUGH.rot, s: 1, tpl: pineT, sp: 4, dy: BOUGH.dy });

  // --- 桑: rows across the orchard, a tree every few paces, some missing, the rows not ruler-straight
  const mulT = [0, 1, 2, 3].map((i) => template('mulberry', 311 + i * 17, 0.9 + i * 0.07, [0.8, 0.88, 0.76]));
  {
    const rng = new Rng(515);
    for (let v = ORCHARD.v0; v <= ORCHARD.v1; v += ORCHARD.row) {
      for (let u = ORCHARD.u0 + rng.range(0, 2); u <= ORCHARD.u1; u += ORCHARD.step + rng.range(-0.3, 0.3)) {
        if (rng.next() < 0.1) continue;
        const [x, z] = toWorld(u + rng.range(-0.3, 0.3), v + rng.range(-0.3, 0.3));
        if (!groundFree(x, z, 1.0) || !place(trees, 2, x, z)) continue;
        trees.push({ kind: 'mulberry', x, z, rot: rng.range(0, 6.28), s: rng.range(0.9, 1.1), tpl: mulT[rng.int(0, 3)], sp: 2 });
      }
    }
  }

  // --- outside, along the creek below the peach wood
  const outT = {
    // (the creek's willows stand straighter than the pond's, which lean right out over the water)
    willow: [0, 1, 2].map((i) => template('willow', 951 + i * 37, 1.08 + i * 0.08, [0.86, 0.96, 0.7], {
      leanA: 0, spec: { ...SPECIES.willow, lean: 0.012, trunk: { ...SPECIES.willow.trunk, tilt: [0.02, 0.08] } },
    })),
    elm: [0, 1, 2].map((i) => template('elm', 1301 + i * 19, 1.15 + i * 0.1, [0.88, 0.97, 0.8], { dense: 1.5, tries: 8 })),
    huai: [0, 1].map((i) => template('huai', 4401 + i * 23, 1.05 + i * 0.1, [0.78, 0.9, 0.68], { dense: 1.2, tries: 6 })),
  };
  group.userData.creek = creekTrees(trees, outT);

  // --- the trees with trunks: instanced bark (LOD by distance) and cards per template
  const all = [];
  const byTpl = new Map();
  for (const t of trees) {
    t.y = surfaceHeight(t.x, t.z) + (t.dy ?? 0);
    const q = new THREE.Quaternion().setFromAxisAngle(UP, t.rot);
    t.matrix = new THREE.Matrix4().compose(V(t.x, t.y, t.z), q, V(t.s, t.s, t.s));
    t.centre = t.tpl.centre.clone().applyMatrix4(t.matrix);
    t.radius = t.tpl.radius * t.s;
    t.top = t.y + t.tpl.top * t.s;
    t.trunkR = t.tpl.tree.branches[0].rads[0] * t.s;
    if (!byTpl.has(t.tpl)) byTpl.set(t.tpl, []);
    byTpl.get(t.tpl).push(t);
  }
  for (const [T, users] of byTpl) {
    const n = users.length, zone = zg[users.every((t) => t.out) ? 'creek' : 'basin'];
    const bark = T.lods.map((g, l) => {
      const m = new THREE.InstancedMesh(g, barks[T.kind], n);
      m.castShadow = l < 3; m.receiveShadow = true;
      m.count = 0; m.frustumCulled = false; m.name = `flora-bark-${T.kind}-${l}`;
      zone.add(m);
      return m;
    });
    // leaves: the full crown near, the lighter one far (the bound covers every user either way)
    const cards = [T.cards, T.cardsFar].filter(Boolean).map((g, l) => {
      const cm = new THREE.InstancedMesh(g, cardMat, n);
      cm.customDepthMaterial = _cardDepth;
      cm.castShadow = true; cm.receiveShadow = true;
      users.forEach((t, i) => cm.setMatrixAt(i, t.matrix));
      cm.instanceMatrix.needsUpdate = true;
      cm.computeBoundingSphere();
      cm.name = `flora-cards-${T.kind}${l ? '-far' : ''}`;
      zone.add(cm);
      return cm;
    });
    all.push({ T, users, bark, cards });
  }

  // --- 竹: groves of culms, thick in the middle and thinning at the edge
  const culmMat = culmMaterial();
  {
    const rng = new Rng(8080);
    const tpls = [];
    for (let i = 0; i < 8; i++) tpls.push(culmGeometry(rng.range(6.5, 11), rng.range(0.035, 0.05), rng.range(0.05, 0.16), rng));
    const inst = tpls.map(() => []);
    for (const [gu, gv, ru, rv, count] of GROVES) {
      let made = 0;
      for (let a = 0; a < count * 6 && made < count; a++) {
        const r = Math.sqrt(rng.next()), th = rng.range(0, 6.28);
        if (rng.next() > 1.15 - r) continue;                  // thinner toward the edge
        const u = gu + Math.cos(th) * r * ru, v = gv + Math.sin(th) * r * rv;
        const [x, z] = toWorld(u, v);
        if (!groundFree(x, z, 0.4) || basinR(x, z) > 0.86 || !place(trees, 1, x, z)) continue;
        const k = rng.int(0, tpls.length - 1);
        // outer culms lean out of the grove, the tops arching away from its middle
        const toOut = Math.atan2(-(Math.sin(th)), Math.cos(th)) - VROT;
        const rot = r > 0.55 ? toOut + rng.range(-0.5, 0.5) : rng.range(0, 6.28);
        const s = rng.range(0.85, 1.1) * lerp(1.05, 0.8, r * r);
        const m = new THREE.Matrix4().compose(V(x, surfaceHeight(x, z) - 0.05, z), new THREE.Quaternion().setFromAxisAngle(UP, rot), V(s, s, s));
        const age = rng.next();
        const col = new THREE.Color().setRGB(lerp(0.34, 0.52, age), lerp(0.46, 0.5, age), lerp(0.22, 0.28, age));
        inst[k].push({ m, col, x, z, top: tpls[k].height * s });
        made++;
      }
    }
    tpls.forEach((T, k) => {
      const L = inst[k];
      if (!L.length) return;
      const cm = new THREE.InstancedMesh(T.culm, culmMat, L.length);
      const lm = new THREE.InstancedMesh(T.cards, cardMat, L.length);
      lm.customDepthMaterial = _cardDepth;
      L.forEach((c, i) => { cm.setMatrixAt(i, c.m); cm.setColorAt(i, c.col); lm.setMatrixAt(i, c.m); });
      cm.castShadow = lm.castShadow = true;
      cm.receiveShadow = lm.receiveShadow = true;
      cm.computeBoundingSphere(); lm.computeBoundingSphere();
      cm.name = 'flora-culms'; lm.name = 'flora-bamboo-leaves';
      zg.basin.add(cm, lm);
    });
    group.userData.culms = inst.flat();
  }

  // (the slope wood is for seeing across the valley; the walker is kept out of it)
  group.userData.wood = buildSlopeWood(zg);
  group.userData.woodCount = group.userData.wood.length;
  const reeds = buildReeds(zg, trees);
  group.userData.reedCount = reeds.count;

  const last = V(1e9, 0, 0), cp = V();
  function update(camera, force = false) {
    camera.getWorldPosition(cp);
    if (!force && cp.distanceToSquared(last) < 0.25) return;
    last.copy(cp);
    for (const m of reeds.meshes) {
      const s = m.boundingSphere;
      m.visible = s.center.distanceTo(cp) - s.radius < 150;
    }
    for (const { users, bark, cards } of all) {
      const cnt = [0, 0, 0, 0], cc = [0, 0];
      for (const t of users) {
        const d = cp.distanceTo(t.centre) - t.radius;
        const l = d < 22 ? 0 : d < 60 ? 1 : d < 160 ? 2 : 3;
        bark[l].setMatrixAt(cnt[l]++, t.matrix);
        if (cards.length > 1) { const f = d < 70 ? 0 : 1; cards[f].setMatrixAt(cc[f]++, t.matrix); }
      }
      bark.forEach((m, l) => { m.count = cnt[l]; m.instanceMatrix.needsUpdate = true; });
      if (cards.length > 1) cards.forEach((m, f) => { m.count = cc[f]; m.instanceMatrix.needsUpdate = true; });
    }
  }
  update(new THREE.Object3D(), true);

  group.userData = {
    ...group.userData, trees, update, zones: zg,
    stats: () => all.map(({ T, users }) => ({ kind: T.kind, users: users.length, cards: T.nCards, tris: T.lods.map((g) => g.index.count / 3) })),
  };
  return group;
}
