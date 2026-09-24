// The peach forest: 忽逢桃花林，夹岸数百步，中无杂树.
// Trees grow from a recursive branch model (the reference's sakura generator, reshaped for peach):
// a short leaning trunk, sometimes two or three stems, opens low into 3-5 spreading scaffold limbs
// that arc upward; secondary and fruiting wood carries the thin year-old shoots, and the flowers sit
// tight on those shoots, singly or in pairs, with buds toward the tips and a few young leaves.
// Close to the eye every flower is geometry (five cupped petals that open, stamens, sepals); further
// off, crossed cards painted with flowering twigs take over. A dozen templates are instanced along
// both banks with three bark LODs.
import * as THREE from 'three';
import { Rng, clamp, lerp, smoothstep } from '../core/rng.js';
import { perlin3, perlin2 } from '../core/noise.js';
import { G, hook, TRANSLUCENT } from '../core/shared.js';
import { height, creekX, creekHW, creekDist, forestMask, FOREST, WATER_OUT } from './layout.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
const perp = (d) => V().crossVectors(d, Math.abs(d.y) < 0.9 ? UP : V(1, 0, 0)).normalize();

// crossfade between flower geometry (near) and painted cards (far), metres from the crown centre
export const NEAR = new THREE.Vector2(13, 19);
const U = { uNear: { value: NEAR } };

// ------------------------------------------------------------------ textures
export function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
const rgb = (r, g, b, a = 1) => `rgba(${r | 0},${g | 0},${b | 0},${a})`;

// transparent texels take the mean opaque colour so mipmaps don't fringe dark. (A 2D canvas stores
// premultiplied colour and would drop it again at alpha 0, so the texture is made from the ImageData.)
export function bleed(ctx, w, h) {
  const im = ctx.getImageData(0, 0, w, h), d = im.data;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
  if (!n) return;
  r /= n; g /= n; b /= n;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3] / 255;
    if (a < 0.5) { d[i] = lerp(r, d[i], a * 2); d[i + 1] = lerp(g, d[i + 1], a * 2); d[i + 2] = lerp(b, d[i + 2], a * 2); }
  }
  ctx.putImageData(im, 0, 0);
  ctx.canvas._bled = im;
}
export function tex(c, srgb = true) {
  const t = new THREE.Texture(c._bled || c);
  t.needsUpdate = true;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

// one peach petal, base at the bottom centre, tip at the top: broad, round, a shallow notch,
// deep rose at the claw fading to pale blush, faint veins
function paintPetal(ctx, x0, y0, w, h, pal, rng) {
  ctx.save();
  ctx.translate(x0, y0);
  const cx = w / 2;
  ctx.beginPath();
  const N = 48;
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2;
    // polar outline around a centre at 58% height: obovate with a narrow claw
    const s = Math.sin(a), c = Math.cos(a);
    const up = c > 0 ? 1 : 0;
    let rx = w * 0.47, ry = up ? h * 0.4 : h * 0.56;
    let px = cx + s * rx * (up ? 1 : 0.55 + 0.45 * Math.pow(Math.abs(c), 0.1) * (1 - Math.abs(c) * 0.72));
    let py = h * 0.42 - c * ry;
    if (up) py += h * 0.045 * Math.exp(-Math.pow(s / 0.12, 2)) + h * 0.012 * Math.sin(a * 7 + rng.next());
    ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.save();
  ctx.clip();
  const gr = ctx.createRadialGradient(cx, h, 0, cx, h, h * 1.02);
  gr.addColorStop(0, rgb(...pal[0]));
  gr.addColorStop(0.26, rgb(...pal[1]));
  gr.addColorStop(0.62, rgb(...pal[2]));
  gr.addColorStop(1, rgb(...pal[3]));
  ctx.fillStyle = gr;
  ctx.fillRect(0, 0, w, h);
  // veins fanning from the claw
  ctx.lineWidth = Math.max(0.6, w * 0.006);
  for (let i = 0; i < 15; i++) {
    const a = (i / 14 - 0.5) * 1.5;
    ctx.strokeStyle = rgb(pal[0][0], pal[0][1], pal[0][2], 0.16 + rng.next() * 0.1);
    ctx.beginPath();
    ctx.moveTo(cx, h);
    const ex = cx + Math.sin(a) * w * 0.52, ey = h - Math.cos(a) * h * 0.92;
    ctx.quadraticCurveTo(cx + Math.sin(a) * w * 0.2, h * 0.55, ex, ey);
    ctx.stroke();
  }
  // soft sheen and faint mottling
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = rgb(255, 244, 248, 0.05 + rng.next() * 0.05);
    ctx.beginPath();
    ctx.arc(rng.range(0, w), rng.range(0, h * 0.8), rng.range(w * 0.02, w * 0.08), 0, 6.28);
    ctx.fill();
  }
  ctx.restore();
  ctx.restore();
}

// peach, not cherry: a warmer, deeper pink at the claw than sakura, but open and luminous toward the rim
const PETAL_PAL = [
  [[218, 96, 136], [238, 146, 176], [250, 198, 214], [255, 234, 240]],
  [[226, 112, 148], [244, 166, 192], [252, 212, 226], [255, 243, 247]],
];

// stamens: pale pink filaments fanning up, red and ochre anthers, a green-cream pistil
function paintStamens(ctx, x0, y0, w, h, rng) {
  ctx.save();
  ctx.translate(x0, y0);
  const cx = w / 2;
  for (let i = 0; i < 30; i++) {
    const a = (rng.next() - 0.5) * 1.9;
    const L = h * rng.range(0.62, 0.9);
    const ex = cx + Math.sin(a) * L * 0.62, ey = h - Math.cos(a * 0.8) * L;
    ctx.strokeStyle = rgb(252, 226, 232, 1);
    ctx.lineWidth = w * 0.017;
    ctx.beginPath();
    ctx.moveTo(cx + rng.range(-w * 0.03, w * 0.03), h);
    ctx.quadraticCurveTo(cx + Math.sin(a) * L * 0.2, h - L * 0.5, ex, ey);
    ctx.stroke();
    const ripe = rng.next();
    ctx.fillStyle = ripe < 0.55 ? rgb(196, 64, 58) : ripe < 0.85 ? rgb(222, 132, 70) : rgb(236, 196, 98);
    ctx.beginPath();
    ctx.ellipse(ex, ey, w * 0.036, w * 0.025, a, 0, 6.28);
    ctx.fill();
  }
  ctx.strokeStyle = rgb(206, 214, 150);
  ctx.lineWidth = w * 0.02;
  ctx.beginPath();
  ctx.moveTo(cx, h);
  ctx.lineTo(cx + w * 0.01, h * 0.28);
  ctx.stroke();
  ctx.fillStyle = rgb(214, 220, 150);
  ctx.beginPath();
  ctx.arc(cx + w * 0.01, h * 0.27, w * 0.025, 0, 6.28);
  ctx.fill();
  ctx.restore();
}

function paintSepal(ctx, x0, y0, w, h) {
  ctx.save();
  ctx.translate(x0, y0);
  ctx.beginPath();
  ctx.moveTo(w * 0.5, h * 0.04);
  ctx.bezierCurveTo(w * 0.95, h * 0.35, w * 0.9, h * 0.9, w * 0.5, h);
  ctx.bezierCurveTo(w * 0.1, h * 0.9, w * 0.05, h * 0.35, w * 0.5, h * 0.04);
  const g = ctx.createLinearGradient(0, h, 0, 0);
  g.addColorStop(0, rgb(104, 72, 44));
  g.addColorStop(0.5, rgb(134, 66, 60));
  g.addColorStop(1, rgb(150, 82, 78));
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();
}

function paintLeaf(ctx, x0, y0, w, h, light) {
  ctx.save();
  ctx.translate(x0, y0);
  ctx.beginPath();
  ctx.moveTo(w * 0.5, h);
  ctx.bezierCurveTo(w * 0.98, h * 0.7, w * 0.8, h * 0.2, w * 0.5, 0);
  ctx.bezierCurveTo(w * 0.2, h * 0.2, w * 0.02, h * 0.7, w * 0.5, h);
  const g = ctx.createLinearGradient(0, 0, w, 0);
  g.addColorStop(0, light ? rgb(150, 190, 84) : rgb(112, 158, 62));
  g.addColorStop(0.5, light ? rgb(176, 206, 104) : rgb(136, 178, 74));
  g.addColorStop(1, light ? rgb(140, 180, 78) : rgb(102, 146, 58));
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = rgb(196, 214, 140, 0.8);
  ctx.lineWidth = w * 0.03;
  ctx.beginPath();
  ctx.moveTo(w * 0.5, h);
  ctx.lineTo(w * 0.5, h * 0.06);
  ctx.stroke();
  ctx.restore();
}

// flower atlas: petal A | petal B | stamens | sepal | leaf, 256 px cells
let _petalCanvas = null;
export function petalCanvas() {
  if (_petalCanvas) return _petalCanvas;
  const c = canvas(128, 128), ctx = c.getContext('2d');
  paintPetal(ctx, 14, 4, 100, 120, PETAL_PAL[0], new Rng(5));
  bleed(ctx, 128, 128);
  return (_petalCanvas = c);
}
function flowerAtlas() {
  const S = 256, c = canvas(S * 5, S), ctx = c.getContext('2d'), rng = new Rng(77);
  paintPetal(ctx, 6, 2, S - 12, S - 4, PETAL_PAL[0], rng);
  paintPetal(ctx, S + 6, 2, S - 12, S - 4, PETAL_PAL[1], rng);
  paintStamens(ctx, S * 2, 0, S, S, rng);
  paintSepal(ctx, S * 3 + 40, 10, S - 80, S - 12);
  paintLeaf(ctx, S * 4 + 60, 4, S - 120, S - 6, true);
  bleed(ctx, c.width, c.height);
  return tex(c);
}

// a small painted flower for the cards: petals are the petal image, rotated about the centre, and the
// whole flower squashed to its view angle; buds are closed rose ovals in their brown sepals
function drawFlower(ctx, petal, x, y, R, rot, squash, open, deep, rng) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.scale(1, squash);
  if (open < 0.3) {
    ctx.fillStyle = rgb(108, 64, 50);
    ctx.beginPath(); ctx.ellipse(0, R * 0.35, R * 0.28, R * 0.22, 0, 0, 6.28); ctx.fill();
    const g = ctx.createLinearGradient(0, R * 0.4, 0, -R * 0.6);
    g.addColorStop(0, rgb(186, 60, 98)); g.addColorStop(1, rgb(232, 124, 158));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(0, -R * 0.08, R * 0.3, R * 0.5, 0, 0, 6.28); ctx.fill();
    ctx.restore();
    return;
  }
  const k = 0.55 + 0.45 * open;
  ctx.filter = `brightness(${(0.9 + rng.next() * 0.16 - deep * 0.08).toFixed(2)}) saturate(${(1 + deep * 0.35).toFixed(2)})`;
  const a0 = rng.range(0, 6.28);
  for (let i = 0; i < 5; i++) {
    ctx.save();
    ctx.rotate(a0 + i * 1.2566 + rng.range(-0.12, 0.12));
    ctx.drawImage(petal, -R * 0.46 * k, -R * 1.02 * k, R * 0.92 * k, R * 1.02 * k);
    ctx.restore();
  }
  ctx.filter = 'none';
  // stamens
  for (let i = 0; i < 16; i++) {
    const a = rng.range(0, 6.28), L = R * rng.range(0.28, 0.5) * k;
    ctx.strokeStyle = rgb(250, 226, 230, 0.9);
    ctx.lineWidth = Math.max(0.8, R * 0.03);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * L, Math.sin(a) * L); ctx.stroke();
    ctx.fillStyle = rng.next() < 0.6 ? rgb(192, 62, 58) : rgb(226, 150, 72);
    ctx.beginPath(); ctx.arc(Math.cos(a) * L, Math.sin(a) * L, Math.max(0.8, R * 0.05), 0, 6.28); ctx.fill();
  }
  ctx.fillStyle = rgb(170, 48, 80, 0.9);
  ctx.beginPath(); ctx.arc(0, 0, R * 0.1, 0, 6.28); ctx.fill();
  ctx.restore();
}

// card atlas: four 256x512 cells of flowering year-old shoot, base at the bottom. Cells 0-2 are
// mid-shoot segments, cell 3 is a tip with buds and a tuft of young leaves.
function cardAtlas() {
  const W = 256, H = 512, c = canvas(W * 4, H), ctx = c.getContext('2d'), rng = new Rng(4242);
  const pc = canvas(96, 112), pctx = pc.getContext('2d');
  paintPetal(pctx, 0, 0, 96, 112, PETAL_PAL[0], rng);
  const pc2 = canvas(96, 112), pctx2 = pc2.getContext('2d');
  paintPetal(pctx2, 0, 0, 96, 112, PETAL_PAL[1], rng);
  for (let cell = 0; cell < 4; cell++) {
    ctx.save();
    ctx.beginPath(); ctx.rect(cell * W, 0, W, H); ctx.clip();
    const cx = cell * W + W / 2, tip = cell === 3;
    const bend = rng.range(-14, 14);
    const twigX = (t) => cx + bend * Math.sin(t * Math.PI) + (tip ? bend * 0.5 * t : 0);
    const top = tip ? H * 0.16 : -10;
    // the twig: red-brown, thin, a glossy edge
    for (const [lw, col] of [[7, rgb(84, 40, 34)], [3, rgb(130, 70, 56)]]) {
      ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.lineCap = 'round';
      ctx.beginPath();
      for (let i = 0; i <= 20; i++) {
        const t = i / 20, y = H + 10 - t * (H + 10 - top);
        const lwT = tip ? lw * (1 - t * 0.55) : lw;
        ctx.lineWidth = lwT;
        i ? ctx.lineTo(twigX(t) + (lw < 5 ? -1.2 : 0), y) : ctx.moveTo(twigX(t), y);
      }
      ctx.stroke();
    }
    // nodes along the twig: 1-2 flowers each, sessile, facing all ways
    const flowers = [];
    let y = H - rng.range(10, 40);
    while (y > (tip ? H * 0.28 : 16)) {
      const t = (H + 10 - y) / (H + 10 - top);
      const n = rng.next() < 0.45 ? 2 : 1;
      const side0 = rng.sign();
      for (let j = 0; j < n; j++) {
        const side = j ? -side0 : side0;
        const budP = tip ? 0.25 + t * 0.6 : 0.1;
        const open = rng.next() < budP ? rng.range(0, 0.25) : rng.next() < 0.15 ? rng.range(0.45, 0.7) : rng.range(0.85, 1);
        const R = open < 0.3 ? rng.range(18, 24) : rng.range(40, 54);
        const off = open < 0.3 ? rng.range(6, 14) : rng.range(10, 44);
        flowers.push({ x: twigX(t) + side * off, y: y + rng.range(-8, 8), R, open, rot: rng.range(-0.6, 0.6) + (side > 0 ? 0.3 : -0.3),
          squash: rng.next() < 0.45 ? rng.range(0.85, 1) : rng.range(0.35, 0.8), deep: rng.next(), z: rng.next() });
      }
      y -= rng.range(24, 40);
    }
    if (tip) {
      // young leaves unfolding at the tip, a few buds among them
      for (let i = 0; i < 4; i++) {
        ctx.save();
        ctx.translate(twigX(1) + rng.range(-4, 4), top + 6);
        ctx.rotate(rng.range(-0.9, 0.9));
        paintLeaf(ctx, -14, -rng.range(60, 86), 28, rng.range(60, 86), rng.next() < 0.5);
        ctx.restore();
      }
    }
    flowers.sort((a, b) => a.z - b.z);
    for (const f of flowers) drawFlower(ctx, f.deep > 0.5 ? pc : pc2, f.x, f.y, f.R, f.rot, f.squash, f.open, f.deep, rng);
    ctx.restore();
  }
  bleed(ctx, c.width, c.height);
  return tex(c);
}

// bark: red-brown, glossy, horizontal lenticels, fissures on old wood; height drives a normal map
function barkTextures() {
  const W = 256, H = 512, rng = new Rng(99);
  const c = canvas(W, H), ctx = c.getContext('2d');
  const hc = canvas(W, H), hx = hc.getContext('2d');
  ctx.fillStyle = rgb(108, 74, 62); ctx.fillRect(0, 0, W, H);
  hx.fillStyle = rgb(128, 128, 128); hx.fillRect(0, 0, W, H);
  for (let i = 0; i < 900; i++) {
    const x = rng.range(0, W), y = rng.range(0, H), r = rng.range(4, 26), k = rng.range(0.8, 1.2);
    ctx.fillStyle = rgb(108 * k + rng.range(-8, 14), 74 * k, 62 * k, 0.2);
    ctx.beginPath(); ctx.ellipse(x, y, r, r * rng.range(1.2, 3), 0, 0, 6.28); ctx.fill();
  }
  // grey weathered patches
  for (let i = 0; i < 40; i++) {
    const x = rng.range(0, W), y = rng.range(0, H);
    ctx.fillStyle = rgb(132, 120, 110, 0.22);
    ctx.beginPath(); ctx.ellipse(x, y, rng.range(10, 40), rng.range(20, 80), 0, 0, 6.28); ctx.fill();
  }
  // fissures, vertical and wandering
  for (let i = 0; i < 26; i++) {
    let x = rng.range(0, W), y = rng.range(-40, H);
    const L = rng.range(40, 160), w = rng.range(1.5, 3.5);
    ctx.strokeStyle = rgb(44, 26, 24, 0.75); hx.strokeStyle = rgb(40, 40, 40);
    ctx.lineWidth = hx.lineWidth = w;
    ctx.beginPath(); hx.beginPath(); ctx.moveTo(x, y); hx.moveTo(x, y);
    for (let s = 0; s < 8; s++) { x += rng.range(-5, 5); y += L / 8; ctx.lineTo(x, y); hx.lineTo(x, y); }
    ctx.stroke(); hx.stroke();
  }
  // lenticels: short raised horizontal dashes, the mark of peach and cherry bark
  for (let i = 0; i < 520; i++) {
    const x = rng.range(-10, W), y = rng.range(0, H), L = rng.range(5, 20), th = rng.range(1.4, 3);
    ctx.fillStyle = rgb(176, 146, 124, rng.range(0.55, 0.9));
    ctx.fillRect(x, y, L, th);
    ctx.fillStyle = rgb(52, 30, 26, 0.5);
    ctx.fillRect(x, y + th, L, 1);
    hx.fillStyle = rgb(210, 210, 210);
    hx.fillRect(x, y, L, th);
  }
  // wrap the edges so the tube seams don't show
  const wrap = (cv) => { const t = cv.getContext('2d'); t.drawImage(cv, W - 12, 0, 12, H, -0, 0, 12, H); };
  wrap(c); wrap(hc);
  const map = tex(c);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  // normal map from the height field
  const hd = hx.getImageData(0, 0, W, H).data;
  const nc = canvas(W, H), nctx = nc.getContext('2d'), nim = nctx.createImageData(W, H), nd = nim.data;
  const hgt = (x, y) => hd[(((y + H) % H) * W + ((x + W) % W)) * 4] / 255;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = (hgt(x + 1, y) - hgt(x - 1, y)) * 2.2, dy = (hgt(x, y + 1) - hgt(x, y - 1)) * 2.2;
    const l = Math.hypot(dx, dy, 1), i = (y * W + x) * 4;
    nd[i] = (-dx / l * 0.5 + 0.5) * 255; nd[i + 1] = (dy / l * 0.5 + 0.5) * 255; nd[i + 2] = (1 / l * 0.5 + 0.5) * 255; nd[i + 3] = 255;
  }
  nctx.putImageData(nim, 0, 0);
  const nrm = tex(nc, false);
  nrm.wrapS = nrm.wrapT = THREE.RepeatWrapping;
  return { map, nrm };
}

// ------------------------------------------------------------------ tree model
const SPEC = {
  depth: 4,
  len: [0.85, 2.1, 1.45, 0.85, 0.42],
  radRatio: [0.62, 0.55, 0.46, 0.4],
  kids: [4, 4, 5, 6],
  start: [0.72, 0.24, 0.18, 0.1],
  angle: [0.98, 0.62, 0.64, 0.5],
  gnarl: [0.22, 0.3, 0.3, 0.24, 0.09],
  up: [0.0, 0.012, 0.03, 0.05, 0.1],
  droop: [0, 0.06, 0.08, 0.04, 0],
  spread: [0, 1.0, 0.35, 0.1, 0.0],
  segLen: [0.2, 0.26, 0.22, 0.16, 0.11],
};

function growTree(seed, size) {
  const rng = new Rng(seed);
  const branches = [];
  const base = V(0, -0.12, 0);
  const leanA = rng.range(0, 6.28), leanDir = V(Math.cos(leanA), 0, Math.sin(leanA));
  const sc = size;
  const D = SPEC.depth;

  function grow(p0, dir, len, rad, depth, flex0, stub, trunkKids) {
    const n = Math.max(3, Math.ceil(len / (SPEC.segLen[depth] * Math.max(0.7, sc))));
    const pts = [p0.clone()], rads = [rad], flex = [flex0];
    const p = p0.clone(), d = dir.clone();
    const rEnd = depth === D || stub ? rad * 0.38 : rad * 0.62;
    const ns = rng.range(0, 100);
    for (let i = 1; i <= n; i++) {
      const t = i / n, g = SPEC.gnarl[depth];
      d.x += perlin3(ns, i * 0.35, 0.5) * g * 1.5;
      d.y += perlin3(ns, i * 0.35, 7.5) * g * 0.8;
      d.z += perlin3(ns, i * 0.35, 13.5) * g * 1.5;
      d.y += SPEC.up[depth] - SPEC.droop[depth] * t * t;
      if (depth === 0) d.addScaledVector(leanDir, 0.04 * (1 - t));
      d.normalize();
      p.addScaledVector(d, len / n);
      pts.push(p.clone());
      rads.push(lerp(rad, rEnd, Math.pow(t, 0.9)));
      flex.push(flex0 + (len * t) / Math.max(0.05, rad * 40));
    }
    const me = { pts, rads, depth, flex, phase: rng.range(0, 6.28), stub, len };
    branches.push(me);
    if (depth >= D || stub) return;
    let nk = trunkKids ?? SPEC.kids[depth] + (rng.next() < 0.35 ? 1 : 0) - (rng.next() < 0.25 ? 1 : 0);
    const rot0 = rng.range(0, 6.28);
    const kid = (C, az, kDepth, angle, lenK) => {
      const L = C * n, i0 = Math.min(n - 1, Math.floor(L)), u = L - i0;
      const B = pts[i0].clone().lerp(pts[i0 + 1], u);
      const T = V().subVectors(pts[i0 + 1], pts[i0]).normalize();
      const X = perp(T).applyAxisAngle(T, az);
      const nd = T.clone().applyAxisAngle(X, angle);
      const out = V(B.x - base.x, 0, B.z - base.z);
      if (out.lengthSq() > 1e-4) { out.normalize(); nd.addScaledVector(out, SPEC.spread[kDepth]); }
      nd.normalize();
      const r0 = lerp(rads[i0], rads[i0 + 1], u);
      const kr = Math.max(0.0045, r0 * SPEC.radRatio[Math.min(depth, 3)] * rng.range(0.85, 1.1) * (kDepth === D ? 0.7 : 1));
      const isStub = kDepth >= 1 && kDepth <= 2 && rng.next() < 0.07;
      let kl = lenK * (isStub ? 0.16 : 1);
      grow(B, nd, kl, kDepth === D ? Math.min(kr, 0.0052) : kr, kDepth, lerp(flex[i0], flex[i0 + 1], u), isStub);
    };
    for (let k = 0; k < nk; k++) {
      const C = lerp(SPEC.start[depth], 1, (k + rng.range(0.1, 0.9)) / nk);
      const lenK = SPEC.len[depth + 1] * sc * rng.range(0.75, 1.2) * (1 - 0.3 * C * (depth > 0 ? 1 : 0));
      kid(C, rot0 + k * 2.39996 + rng.range(-0.4, 0.4), depth + 1, SPEC.angle[depth] * rng.range(0.75, 1.2), lenK);
    }
    // year-old shoots straight off the secondary and scaffold wood too
    if (depth === 2 || depth === 1) {
      const ex = depth === 2 ? rng.int(3, 6) : rng.int(1, 3);
      for (let k = 0; k < ex; k++)
        kid(rng.range(0.3, 0.95), rng.range(0, 6.28), D, SPEC.angle[3] * rng.range(0.8, 1.3), SPEC.len[D] * sc * rng.range(0.7, 1.2));
    }
  }

  // one to three stems from the root; each opens into the low scaffold limbs
  const stems = size > 0.95 && rng.next() < 0.5 ? rng.int(2, 3) : 1;
  for (let s = 0; s < stems; s++) {
    const a = leanA + (s / stems) * 6.28 + rng.range(-0.5, 0.5);
    const tilt = stems > 1 ? rng.range(0.25, 0.42) : rng.range(0.06, 0.18);
    const dir = V(Math.sin(tilt) * Math.cos(a), Math.cos(tilt), Math.sin(tilt) * Math.sin(a)).normalize();
    const o = base.clone().add(V(Math.cos(a) * 0.08 * (stems > 1 ? 1 : 0), 0, Math.sin(a) * 0.08 * (stems > 1 ? 1 : 0)));
    const tl = SPEC.len[0] * sc * rng.range(0.75, 1.25) * (stems > 1 ? 1.25 : 1);
    const tr = (stems > 1 ? 0.11 : 0.15) * sc;
    grow(o, dir, tl, tr, 0, 0, false, stems > 1 ? rng.int(2, 3) : rng.int(3, 5));
  }
  return { branches, base };
}

// sample a branch polyline at t in 0..1
export function sampleBranch(b, t) {
  const n = b.pts.length - 1, f = clamp(t, 0, 1) * n, i = Math.min(n - 1, Math.floor(f)), u = f - i;
  return {
    p: b.pts[i].clone().lerp(b.pts[i + 1], u),
    d: V().subVectors(b.pts[i + 1], b.pts[i]).normalize(),
    r: lerp(b.rads[i], b.rads[i + 1], u),
    flex: lerp(b.flex[i], b.flex[i + 1], u),
  };
}

// tube geometry for the bark, radial resolution by radius; lod drops the finest orders
export function barkGeometry(branches, base, lod) {
  const maxDepth = [4, 3, 2, 1][lod];
  const list = branches.filter((b) => b.depth <= maxDepth);
  const sides = (r, depth) => {
    const s = r > 0.12 ? 12 : r > 0.06 ? 8 : r > 0.025 ? 6 : r > 0.012 ? 4 : 3;
    return Math.max(3, lod === 0 ? s : lod === 1 ? Math.ceil(s * 0.75) : Math.ceil(s * 0.5));
  };
  const P = [], N = [], UV = [], W = [], I = [];
  let vi = 0;
  const d = V(), pn = V(), bn = V(), g = V();
  list.forEach((b, bi) => {
    const sd = sides(b.rads[0], b.depth);
    const step = lod >= 2 && b.pts.length > 4 ? 2 : 1;
    const idx = [];
    for (let i = 0; i < b.pts.length; i += step) idx.push(i);
    if (idx[idx.length - 1] !== b.pts.length - 1) idx.push(b.pts.length - 1);
    d.subVectors(b.pts[1], b.pts[0]).normalize();
    pn.copy(perp(d));
    let S = 0;
    const circ = 2 * Math.PI * b.rads[0], M = Math.max(1, Math.round(circ / 0.5));
    idx.forEach((i, k) => {
      if (k > 0) {
        const nd = V().subVectors(b.pts[Math.min(b.pts.length - 1, i + 1)], b.pts[idx[k - 1]]).normalize();
        const ax = V().crossVectors(d, nd), s = ax.length();
        if (s > 1e-6) pn.applyAxisAngle(ax.normalize(), Math.asin(Math.min(1, s)));
        d.copy(nd);
        S += b.pts[i].distanceTo(b.pts[idx[k - 1]]);
      }
      bn.crossVectors(d, pn).normalize();
      const r = b.rads[i], hy = b.pts[i].y - base.y;
      for (let j = 0; j <= sd; j++) {
        const a = (j / sd) * Math.PI * 2;
        let rr = r;
        if (b.depth === 0) {
          const fl = Math.exp(-Math.max(0, hy) * 3.2);
          rr *= 1 + fl * (0.5 + 0.5 * Math.sin(a * 4 + bi)) * 0.7;
          rr *= 1 + 0.08 * perlin2(Math.cos(a) * 2 + bi, S * 1.4 + Math.sin(a) * 2);
        } else rr *= 1 + 0.05 * Math.sin(a * 3 + S * 2);
        g.copy(pn).multiplyScalar(Math.cos(a)).addScaledVector(bn, Math.sin(a));
        P.push(b.pts[i].x + g.x * rr, b.pts[i].y + g.y * rr, b.pts[i].z + g.z * rr);
        N.push(g.x, g.y, g.z);
        UV.push((j / sd) * M, S / 1.1);
        W.push(b.flex[i], b.phase);
      }
      if (k < idx.length - 1) {
        const o = vi + k * (sd + 1);
        for (let j = 0; j < sd; j++) {
          const a0 = o + j, a1 = a0 + 1, b0 = a0 + sd + 1, b1 = b0 + 1;
          I.push(a0, b0, a1, a1, b0, b1);
        }
      }
    });
    vi += idx.length * (sd + 1);
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  geo.setAttribute('aWind', new THREE.Float32BufferAttribute(W, 2));
  geo.setIndex(vi > 65535 ? new THREE.Uint32BufferAttribute(I, 1) : new THREE.Uint16BufferAttribute(I, 1));
  geo.computeBoundingSphere();
  return geo;
}

// flowers, buds and young leaves along the shoots, and the cards that stand in for them at distance
function bloom(tree, seed, tint) {
  const rng = new Rng(seed * 7 + 3);
  const flowers = [], leaves = [], cards = [];
  const centre = V(), crown = tree.branches.filter((b) => b.depth >= 3);
  crown.forEach((b) => centre.add(b.pts[b.pts.length - 1]));
  centre.multiplyScalar(1 / Math.max(1, crown.length));
  let radius = 0.5;
  crown.forEach((b) => { radius = Math.max(radius, b.pts[b.pts.length - 1].distanceTo(centre)); });

  const addFlower = (s, open, b, t) => {
    const out = V(s.p.x - centre.x, 0, s.p.z - centre.z);
    if (out.lengthSq() > 1e-4) out.normalize();
    const X = perp(s.d).applyAxisAngle(s.d, rng.range(0, 6.28));
    const ax = X.clone().addScaledVector(UP, 0.5).addScaledVector(out, 0.35).addScaledVector(s.d, rng.range(-0.1, 0.35)).normalize();
    flowers.push({
      p: s.p.clone().addScaledVector(ax, s.r * 0.9), ax, open,
      scale: (open < 0.3 ? rng.range(0.85, 1.05) : rng.range(0.9, 1.15)),
      tint: clamp(tint + rng.range(-0.18, 0.18), 0, 1), flex: s.flex + 0.35, phase: b.phase,
    });
  };

  for (const b of tree.branches) {
    if (b.stub) continue;
    if (b.depth === SPEC.depth) {
      // shoot: nodes every 5-8 cm from just above its base to the tip
      let t = rng.range(0.06, 0.16);
      while (t < 0.985) {
        const s = sampleBranch(b, t);
        const tipZone = smoothstep(0.7, 1.0, t);
        const n = rng.next() < 0.45 ? 2 : 1;
        for (let j = 0; j < n; j++) {
          const r = rng.next();
          const open = r < 0.1 + tipZone * 0.55 ? rng.range(0, 0.22) : r < 0.26 + tipZone * 0.4 ? rng.range(0.4, 0.72) : rng.range(0.84, 1);
          addFlower(s, open, b, t);
        }
        t += rng.range(0.032, 0.052) / Math.max(0.2, b.len);
      }
      if (rng.next() < 0.3) {
        const s = sampleBranch(b, 1);
        for (let j = 0, nl = rng.int(2, 3); j < nl; j++) {
          const X = perp(s.d).applyAxisAngle(s.d, rng.range(0, 6.28));
          const dir = s.d.clone().addScaledVector(X, rng.range(0.4, 0.9)).normalize();
          leaves.push({ p: s.p.clone(), dir, roll: rng.range(0, 6.28), size: rng.range(0.035, 0.055), flex: s.flex + 0.4, phase: b.phase });
        }
      }
      // two crossed cards per ~0.36 m segment of shoot
      const segs = Math.max(1, Math.round(b.len / 0.36));
      for (let k = 0; k < segs; k++) {
        const a = sampleBranch(b, k / segs), e = sampleBranch(b, (k + 1) / segs);
        const len = a.p.distanceTo(e.p) * 1.12 + 0.04;
        const ph = rng.range(0, 6.28);
        for (let c = 0; c < 2; c++)
          cards.push({ a: a.p, e: e.p, len, w: 0.34, roll: ph + c * 1.5708, cell: k === segs - 1 ? 3 : rng.int(0, 2),
            flex: (a.flex + e.flex) * 0.5 + 0.3, phase: b.phase, flip: rng.next() < 0.5 });
      }
    } else if (b.depth === 3) {
      // spurs on the fruiting wood
      let t = rng.range(0.25, 0.4);
      while (t < 0.98) {
        const s = sampleBranch(b, t);
        const n = rng.next() < 0.35 ? 2 : 1;
        for (let j = 0; j < n; j++) addFlower(s, rng.next() < 0.14 ? rng.range(0, 0.22) : rng.range(0.8, 1), b, t);
        t += rng.range(0.08, 0.15) / Math.max(0.3, b.len);
      }
      const segs = Math.max(1, Math.round(b.len * 0.6 / 0.4));
      for (let k = 0; k < segs; k++) {
        const a = sampleBranch(b, 0.4 + 0.6 * k / segs), e = sampleBranch(b, 0.4 + 0.6 * (k + 1) / segs);
        cards.push({ a: a.p, e: e.p, len: a.p.distanceTo(e.p) * 1.1, w: 0.29, roll: rng.range(0, 6.28), cell: rng.int(0, 2),
          flex: (a.flex + e.flex) * 0.5 + 0.2, phase: b.phase, flip: rng.next() < 0.5 });
      }
    }
  }
  return { flowers, leaves, cards, centre, radius };
}

function cardGeometry(cards, centre, radius, tint) {
  const n = cards.length;
  const P = new Float32Array(n * 12), N = new Float32Array(n * 12), UVs = new Float32Array(n * 8);
  const C = new Float32Array(n * 12), W = new Float32Array(n * 8), I = new Uint32Array(n * 6);
  const ax = V(), side = V(), nrm = V(), mid = V(), out = V();
  const tc = [lerp(1.0, 0.96, tint), lerp(1.0, 0.9, tint), lerp(1.0, 0.94, tint)];
  cards.forEach((c, i) => {
    ax.subVectors(c.e, c.a).normalize();
    mid.addVectors(c.a, c.e).multiplyScalar(0.5);
    side.copy(perp(ax)).applyAxisAngle(ax, c.roll);
    nrm.crossVectors(ax, side).normalize();
    out.subVectors(mid, centre);
    const od = out.length() / radius;
    out.normalize();
    const sn = nrm.clone().multiplyScalar(0.35).addScaledVector(out, 0.65).addScaledVector(UP, 0.25).normalize();
    const ao = clamp(0.55 + 0.45 * od, 0.5, 1) * lerp(0.86, 1, clamp((mid.y - centre.y) / radius + 0.5, 0, 1));
    const c0 = (c.cell * 256) / 1024, c1 = ((c.cell + 1) * 256) / 1024;
    const corners = [[-1, 0], [1, 0], [1, 1], [-1, 1]];
    corners.forEach(([u, v], k) => {
      const j = i * 4 + k;
      const px = c.a.x + ax.x * (v * c.len - 0.02) + side.x * u * c.w * 0.5;
      const py = c.a.y + ax.y * (v * c.len - 0.02) + side.y * u * c.w * 0.5;
      const pz = c.a.z + ax.z * (v * c.len - 0.02) + side.z * u * c.w * 0.5;
      P.set([px, py, pz], j * 3);
      N.set([sn.x, sn.y, sn.z], j * 3);
      const uu = c.flip ? -u : u;
      UVs.set([lerp(c0, c1, uu * 0.5 + 0.5), v], j * 2);
      C.set([tc[0] * ao, tc[1] * ao, tc[2] * ao], j * 3);
      W.set([c.flex * (0.6 + 0.4 * v), c.phase], j * 2);
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

// ------------------------------------------------------------------ flower geometry (shared)
// positions are parameters (u across, v along); the vertex shader folds them into petals that open
const PL = 0.02, PW = 0.017, R0 = 0.003, SH = 0.0175, SW = 0.025, SL = 0.0075, SWD = 0.0055;
function flowerGeometry(simple = false) {
  const P = [], UVs = [], A = [], I = [];
  const cell = (k) => [k / 5, (k + 1) / 5];
  let vi = 0;
  const quad = (part, k, us, vs) => {
    const [c0, c1] = cell(k);
    for (const v of vs) for (const u of us) { P.push(u, v, 0); UVs.push(lerp(c0, c1, u * 0.5 + 0.5), v); A.push(part); }
    const nu = us.length;
    for (let j = 0; j < vs.length - 1; j++) for (let i = 0; i < nu - 1; i++) {
      const a = vi + j * nu + i, b = a + 1, c = a + nu, d = c + 1;
      I.push(a, b, d, a, d, c);
    }
    vi += us.length * vs.length;
  };
  for (let p = 0; p < 5; p++) quad(p, p % 2, simple ? [-1, 1] : [-1, 0, 1], [0, 1]);
  if (!simple) {
    quad(5, 2, [-1, 1], [0, 1]);
    quad(6, 2, [-1, 1], [0, 1]);
    for (let p = 0; p < 5; p++) quad(7 + p, 3, [-1, 1], [0, 1]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(P.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(UVs, 2));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(A, 1));
  g.setIndex(I);
  return g;
}

function leafGeometry() {
  const g = new THREE.BufferGeometry();
  // a leaf folded slightly along its midrib, base at the origin, pointing +y
  const P = [-0.5, 0, 0.1, 0, 0, 0, 0.5, 0, 0.1, -0.5, 1, 0.1, 0, 1, 0, 0.5, 1, 0.1];
  const UVs = [0.8, 0, 0.9, 0, 1, 0, 0.8, 1, 0.9, 1, 1, 1];
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0.2, 1, 0, 0, 1, 0, 0.2, 1, 0, 0.2, 1, 0, 0, 1, 0, 0.2, 1], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(UVs, 2));
  g.setIndex([0, 1, 4, 0, 4, 3, 1, 2, 5, 1, 5, 4]);
  return g;
}

// ------------------------------------------------------------------ materials
export const WIND_TREE = /* glsl */ `
  // world offset from the shared wind, carried back into this instance's local frame
  vec3 treeSway(vec3 wp0, vec3 treeO, float fl, float ph, mat3 M) {
    float tph = ph + hash12(treeO.xz * 0.37) * 6.2832;
    vec3 sw = windSway(wp0, 0.018 * fl * fl + 0.004 * fl, tph) * min(fl, 6.0) * 0.16;
    return transpose(M) * sw / dot(M[0], M[0]); // M is a uniformly scaled rotation here
  }
  // for instances with a non-uniform scale (leaves)
  vec3 treeSwayNU(vec3 wp0, vec3 treeO, float fl, float ph, mat3 M) {
    float tph = ph + hash12(treeO.xz * 0.37) * 6.2832;
    vec3 sw = windSway(wp0, 0.018 * fl * fl + 0.004 * fl, tph) * min(fl, 6.0) * 0.16;
    return inverse(M) * sw;
  }
  float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
`;

function barkMaterial(bt) {
  const m = new THREE.MeshStandardMaterial({ map: bt.map, normalMap: bt.nrm, roughness: 0.86, metalness: 0, color: new THREE.Color(1.05, 1, 0.98) });
  m.normalScale.set(1.1, 1.1);
  return hook(m, 'peach-bark', (sh) => {
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

function cardMaterial(map) {
  const m = new THREE.MeshStandardMaterial({ map, vertexColors: true, alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.7, metalness: 0 });
  m.alphaToCoverage = true;
  m.userData.uniforms = U;
  return hook(m, 'peach-cards', (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aWind;\nuniform vec2 uNear;\nvarying float vFade;\n' + WIND_TREE)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      {
        mat3 M = mat3(modelMatrix) * mat3(instanceMatrix);
        vec3 wp0 = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        vec3 treeO = instanceMatrix[3].xyz;
        transformed += treeSway(wp0, treeO, aWind.x, aWind.y, M);
        float g = windGust(wp0);
        transformed += transpose(M) * vec3(sin(uTime * 4.3 + aWind.y * 7.0 + wp0.x), sin(uTime * 3.1 + aWind.y * 5.0), cos(uTime * 5.1 + wp0.z)) * 0.012 * g / dot(M[0], M[0]);
        float dC = distance(cameraPosition, treeO + vec3(0.0, 2.2 * length(instanceMatrix[0].xyz), 0.0));
        vFade = uReflect > 0.5 ? 1.0 : smoothstep(uNear.x, uNear.y, dC);
      }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vFade;\nfloat ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }')
      .replace('#include <alphatest_fragment>', `#include <alphatest_fragment>
      if (ign(gl_FragCoord.xy) > vFade) discard;`)
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
      normal = normalize(vNormal);`)
      .replace('#include <lights_fragment_begin>', `#include <lights_fragment_begin>
      {
        ${TRANSLUCENT}
        reflectedLight.directDiffuse += sunC * diffuseColor.rgb * (sunBack * 2.4 + sunWrap * 0.35);
        // a crown full of thin petals glows: sky light passing through, a warm lift in the shade
        reflectedLight.indirectDiffuse *= vec3(1.12, 0.98, 0.95);
        totalEmissiveRadiance += diffuseColor.rgb * uAmbK * 0.12 * (1.0 - 0.7 * uNight);
      }`);
  });
}

function flowerMaterial(map) {
  const m = new THREE.MeshStandardMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.6, metalness: 0 });
  m.alphaToCoverage = true;
  m.userData.uniforms = U;
  return hook(m, 'peach-flower', (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
      attribute vec4 aFl;   // open, tint, flex, branch phase
      attribute float aPart;
      uniform vec2 uNear;
      varying float vFade, vOpen, vTint, vPart;
      ${WIND_TREE}`)
      .replace('#include <beginnormal_vertex>', `
      vec3 flP;
      float flJit = hash13(instanceMatrix[3].xyz * 91.7 + modelMatrix[3].xyz);
      vec3 objectNormal;
      {
        float part = aPart, open = aFl.x;
        vec3 Y = vec3(0.0, 1.0, 0.0);
        if (part < 4.5) {
          float ang = part * 1.2566 + flJit * 1.3;
          vec3 r = vec3(cos(ang), 0.0, sin(ang)), tg = vec3(-sin(ang), 0.0, cos(ang));
          float tilt = mix(0.14, 1.12 + 0.16 * sin(part * 2.1 + flJit * 9.0), open);
          vec3 dv = cos(tilt) * Y + sin(tilt) * r;
          vec3 pn = cross(tg, dv);
          float L = ${PL.toFixed(4)} * mix(0.66, 1.0, open);
          float W = ${PW.toFixed(4)} * mix(0.52, 1.0, open);
          flP = r * ${R0.toFixed(4)} + dv * position.y * L + tg * position.x * W * 0.5;
          flP += pn * position.x * position.x * W * (0.1 + 0.12 * open) * position.y;
          flP += Y * 0.0004 * part;
          objectNormal = normalize(pn - tg * position.x * 0.45);
        } else if (part < 6.5) {
          float a2 = (part - 5.0) * 1.5708 + flJit * 3.0;
          vec3 tg = vec3(cos(a2), 0.0, sin(a2));
          float so = smoothstep(0.35, 0.85, open);
          flP = tg * position.x * ${SW.toFixed(4)} * 0.5 * (0.5 + 0.5 * so) + Y * (position.y * ${SH.toFixed(4)} * so + 0.0012);
          objectNormal = normalize(cross(tg, Y) + Y * 0.6);
        } else {
          float ang = (part - 7.0) * 1.2566 + 0.628 + flJit * 1.3;
          vec3 r = vec3(cos(ang), 0.0, sin(ang)), tg = vec3(-sin(ang), 0.0, cos(ang));
          float tilt = mix(0.42, 2.05, smoothstep(0.3, 0.9, open));
          vec3 dv = cos(tilt) * Y + sin(tilt) * r;
          flP = r * ${R0.toFixed(4)} * 0.9 + dv * position.y * ${SL.toFixed(4)} + tg * position.x * ${SWD.toFixed(4)} * 0.5 - Y * 0.0008;
          objectNormal = cross(tg, dv);
        }
      }`)
      .replace('#include <begin_vertex>', `vec3 transformed = flP;
      {
        mat3 M = mat3(modelMatrix) * mat3(instanceMatrix);
        vec3 wp0 = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        vec3 treeO = modelMatrix[3].xyz;
        transformed += treeSway(wp0, treeO, aFl.z, aFl.w, M);
        float g = windGust(wp0);
        transformed += transpose(M) * vec3(sin(uTime * 5.3 + flJit * 40.0), sin(uTime * 4.1 + flJit * 23.0), cos(uTime * 6.1 + flJit * 31.0)) * 0.005 * g / dot(M[0], M[0]);
        vFade = 1.0 - smoothstep(uNear.x, uNear.y, distance(cameraPosition, treeO + vec3(0.0, 2.2 * length(modelMatrix[0].xyz), 0.0)));
        vOpen = aFl.x; vTint = aFl.y; vPart = aPart;
      }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
      varying float vFade, vOpen, vTint, vPart;
      float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
      if (vPart < 4.5) {
        diffuseColor.rgb *= mix(vec3(1.03, 1.0, 1.02), vec3(0.94, 0.76, 0.85), vTint);
        diffuseColor.rgb *= mix(vec3(0.8, 0.56, 0.68), vec3(1.0), smoothstep(0.0, 0.75, vOpen));
      }`)
      .replace('#include <alphatest_fragment>', `#include <alphatest_fragment>
      if (ign(gl_FragCoord.xy) > vFade) discard;`)
      .replace('#include <lights_fragment_begin>', `#include <lights_fragment_begin>
      {
        ${TRANSLUCENT}
        float thin = vPart < 4.5 ? 1.0 : 0.4;
        reflectedLight.directDiffuse += sunC * diffuseColor.rgb * (sunBack * 2.4 + sunWrap * 0.4) * thin;
        reflectedLight.indirectDiffuse *= vec3(1.12, 0.98, 0.95);
        totalEmissiveRadiance += diffuseColor.rgb * uAmbK * 0.12 * thin * (1.0 - 0.7 * uNight);
      }`);
  });
}

function leafMaterial(map) {
  const m = new THREE.MeshStandardMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.55, metalness: 0 });
  m.alphaToCoverage = true;
  m.userData.uniforms = U;
  return hook(m, 'peach-leaf', (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
      attribute vec2 aLf; uniform vec2 uNear; varying float vFade;
      ${WIND_TREE}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      {
        mat3 M = mat3(modelMatrix) * mat3(instanceMatrix);
        vec3 wp0 = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        vec3 treeO = modelMatrix[3].xyz;
        transformed += treeSwayNU(wp0, treeO, aLf.x, aLf.y, M);
        vFade = 1.0 - smoothstep(uNear.x, uNear.y, distance(cameraPosition, treeO + vec3(0.0, 2.2 * length(modelMatrix[0].xyz), 0.0)));
      }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
      varying float vFade;
      float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }`)
      .replace('#include <alphatest_fragment>', `#include <alphatest_fragment>
      if (ign(gl_FragCoord.xy) > vFade) discard;`)
      .replace('#include <lights_fragment_begin>', `#include <lights_fragment_begin>
      {
        ${TRANSLUCENT}
        reflectedLight.directDiffuse += sunC * diffuseColor.rgb * (sunBack * 1.8 + sunWrap * 0.3);
      }`);
  });
}

// ------------------------------------------------------------------ placement
// both banks, denser toward the water, set back so the creek ahead stays open
export function placeTrees() {
  const rng = new Rng(7331);
  const trees = [];
  const grid = new Map();
  const key = (x, z) => `${Math.floor(x / 12)},${Math.floor(z / 12)}`;
  const near = (x, z, r) => {
    const gx = Math.floor(x / 12), gz = Math.floor(z / 12);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const l = grid.get(`${gx + i},${gz + j}`);
      if (l) for (const t of l) if (Math.hypot(t.x - x, t.z - z) < Math.max(r, t.sp)) return true;
    }
    return false;
  };
  // a close rank of old, full trees along the water, their crowns reaching out over it; thinner and
  // younger further back, so the corridor reads as blossom from the boat and not as an orchard on a lawn
  const place = (x, z, side, bankRow) => {
    const fm = forestMask(x, z);
    if (!bankRow && rng.next() > fm * 1.15) return false;
    if (bankRow && fm < 0.2) return false;
    const y = height(x, z);
    if (y < WATER_OUT + 0.25 || y > WATER_OUT + 9) return false;
    const sl = Math.hypot(height(x + 1, z) - height(x - 1, z), height(x, z + 1) - height(x, z - 1)) * 0.5;
    if (sl > 0.6) return false;
    const cd = creekDist(x, z);
    if (cd < 1.5) return false;
    const r = rng.next(), bank = cd < 10;
    const tpl = bank ? (r < 0.62 ? 'big' : r < 0.94 ? 'mid' : 'small') : cd < 20 ? (r < 0.3 ? 'big' : r < 0.72 ? 'mid' : 'small') : (r < 0.15 ? 'big' : r < 0.55 ? 'mid' : 'small');
    const s = bank ? rng.range(1.45, 1.75) : cd < 20 ? rng.range(1.2, 1.45) : rng.range(1.0, 1.22);
    const sp = (tpl === 'big' ? 6.6 : tpl === 'mid' ? 5.4 : 4.2) * s * 0.9;
    if (near(x, z, sp * (bank ? 0.62 : 1.05))) return false;
    const t = { x, y, z, side, cd, sp: bank ? sp * 0.62 : sp, cls: tpl, rot: rng.range(0, 6.28), s, seed: rng.int(0, 1e6) };
    // lean toward the light over the water, never into the channel ahead
    const toward = side > 0 ? -1 : 1;
    t.lean = cd < 9 ? { x: toward * rng.range(0.06, 0.13), z: rng.range(-0.03, 0.03) } : { x: rng.range(-0.04, 0.04), z: rng.range(-0.04, 0.04) };
    trees.push(t);
    const k = key(x, z);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(t);
    return true;
  };
  // the two ranks along each bank, staggered
  for (const [lo, hi, step] of [[1.8, 5.0, [5.0, 7.0]], [6.5, 10.5, [6.0, 8.5]]])
    for (const side of [-1, 1]) {
      for (let z = FOREST.z0 - 6 + rng.range(0, 3); z < FOREST.z1 + 12; z += rng.range(step[0], step[1])) {
        for (let tries = 0; tries < 4; tries++) {
          const zz = z + rng.range(-1, 1);
          if (place(creekX(zz) + side * (creekHW(zz) + rng.range(lo, hi)), zz, side, true)) break;
        }
      }
    }
  // and the rest scattered back from the water
  for (let a = 0; a < 40000 && trees.length < 400; a++) {
    const z = rng.range(FOREST.z0 - 8, FOREST.z1 + 14);
    const side = rng.sign();
    const d = 8 + Math.pow(rng.next(), 1.4) * (FOREST.band - 2);
    place(creekX(z) + side * (creekHW(z) + d), z, side, false);
  }
  return trees;
}

// ------------------------------------------------------------------ build
const TEMPLATES = [
  ['big', 1.08], ['big', 1.02], ['big', 1.12],
  ['mid', 0.9], ['mid', 0.86], ['mid', 0.94], ['mid', 0.88], ['mid', 0.84],
  ['small', 0.68], ['small', 0.62], ['small', 0.72], ['small', 0.66],
];

export function buildPeachForest() {
  const group = new THREE.Group();
  group.name = 'peach-forest';
  const bt = barkTextures();
  const fAtlas = flowerAtlas();
  const cAtlas = cardAtlas();
  const barkMat = barkMaterial(bt);
  const cardMat = cardMaterial(cAtlas);
  const cardDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: cAtlas, alphaTest: 0.42 });
  const flMat = flowerMaterial(fAtlas);
  const lfMat = leafMaterial(fAtlas);
  const flGeoBase = flowerGeometry();
  const flGeoLo = flowerGeometry(true);
  const lfGeoBase = leafGeometry();

  const trees = placeTrees();
  const tpls = TEMPLATES.map(([cls, size], i) => {
    const seed = 101 + i * 37;
    const tree = growTree(seed, size);
    const tint = [0.25, 0.7, 0.45, 0.55, 0.3, 0.8, 0.5, 0.2, 0.6, 0.4, 0.75, 0.35][i];
    const bl = bloom(tree, seed, tint);
    const lods = [0, 1, 2, 3].map((l) => barkGeometry(tree.branches, tree.base, l));
    const cards = cardGeometry(bl.cards, bl.centre, bl.radius, tint);
    // far away: one card of each crossed pair, broader, so a crown keeps its mass at half the cost
    const cardsLo = cardGeometry(bl.cards.filter((c, k) => k % 2 === 0).map((c) => ({ ...c, w: c.w * 1.55 })), bl.centre, bl.radius, tint);
    // flower instances in template space
    const fg = flGeoBase.clone();
    const n = bl.flowers.length;
    const mats = new Float32Array(n * 16), aFl = new Float32Array(n * 4);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = V();
    bl.flowers.forEach((f, i) => {
      q.setFromUnitVectors(UP, f.ax);
      sc.setScalar(f.scale * 1.12);
      m4.compose(f.p, q, sc).toArray(mats, i * 16);
      aFl.set([f.open, f.tint, f.flex, f.phase], i * 4);
    });
    const aFlAttr = new THREE.InstancedBufferAttribute(aFl, 4);
    fg.setAttribute('aFl', aFlAttr);
    const fgLo = flGeoLo.clone();
    fgLo.setAttribute('aFl', aFlAttr);
    const fMatrix = new THREE.InstancedBufferAttribute(mats, 16);
    const lg = lfGeoBase.clone();
    const nl = bl.leaves.length;
    const lmats = new Float32Array(Math.max(1, nl) * 16), aLf = new Float32Array(Math.max(1, nl) * 2);
    bl.leaves.forEach((l, i) => {
      q.setFromUnitVectors(UP, l.dir);
      q.multiply(new THREE.Quaternion().setFromAxisAngle(UP, l.roll));
      sc.set(l.size * 0.45, l.size, l.size);
      m4.compose(l.p, q, sc).toArray(lmats, i * 16);
      aLf.set([l.flex, l.phase], i * 2);
    });
    lg.setAttribute('aLf', new THREE.InstancedBufferAttribute(aLf, 2));
    const lMatrix = new THREE.InstancedBufferAttribute(lmats, 16);
    const sphere = new THREE.Sphere(bl.centre.clone(), bl.radius + 0.5);
    return { cls, size, tree, bl, lods, cards, cardsLo, fg, fgLo, fMatrix, nFl: n, lg, lMatrix, nLf: nl, sphere, users: [] };
  });
  const byCls = { big: [0, 1, 2], mid: [3, 4, 5, 6, 7], small: [8, 9, 10, 11] };

  const q = new THREE.Quaternion(), sc = V();
  trees.forEach((t, i) => {
    const list = byCls[t.cls];
    t.tpl = list[(t.seed >>> 3) % list.length];
    const T = tpls[t.tpl];
    // lean is in world axes: rotate about y first, then tilt
    const qt = new THREE.Quaternion().setFromEuler(new THREE.Euler(t.lean.z, 0, -t.lean.x));
    const qy = new THREE.Quaternion().setFromAxisAngle(UP, t.rot);
    q.copy(qt).multiply(qy);
    sc.setScalar(t.s);
    t.matrix = new THREE.Matrix4().compose(V(t.x, t.y, t.z), q, sc);
    t.centre = T.bl.centre.clone().applyMatrix4(t.matrix);
    t.radius = T.bl.radius * t.s;
    T.users.push(t);
    // near-field flowers and leaves: an instanced mesh per tree that shares its template's buffers
    const fm = new THREE.InstancedMesh(T.fg, flMat, 0);
    fm.instanceMatrix = T.fMatrix;
    fm.count = T.nFl;
    fm.boundingSphere = T.sphere;
    fm.matrixAutoUpdate = false;
    fm.matrix.copy(t.matrix);
    fm.matrixWorldNeedsUpdate = true;
    fm.layers.set(1);
    fm.receiveShadow = true;
    fm.visible = false;
    fm.name = 'peach-flowers';
    const lm = new THREE.InstancedMesh(T.lg, lfMat, 0);
    lm.instanceMatrix = T.lMatrix;
    lm.count = T.nLf;
    lm.boundingSphere = T.sphere;
    lm.matrixAutoUpdate = false;
    lm.matrix.copy(t.matrix);
    lm.matrixWorldNeedsUpdate = true;
    lm.layers.set(1);
    lm.receiveShadow = true;
    lm.visible = false;
    t.fm = fm; t.lm = lm;
    group.add(fm, lm);
  });

  // instanced bark (three LODs) and cards per template
  const all = [];
  tpls.forEach((T, ti) => {
    const nU = Math.max(1, T.users.length);
    T.bark = T.lods.map((g, l) => {
      const m = new THREE.InstancedMesh(g, barkMat, nU);
      m.castShadow = l < 3; m.receiveShadow = true;
      m.count = 0; m.frustumCulled = false; m.name = `peach-bark-${ti}-${l}`;
      group.add(m);
      return m;
    });
    T.cardMeshes = [T.cards, T.cardsLo].map((g, l) => {
      const cm = new THREE.InstancedMesh(g, cardMat, nU);
      cm.customDepthMaterial = cardDepth;
      cm.castShadow = true; cm.receiveShadow = true;
      cm.frustumCulled = false; cm.name = `peach-cards-${ti}-${l}`;
      cm.count = 0;
      group.add(cm);
      return cm;
    });
    all.push(T);
  });

  let last = V(1e9, 0, 0);
  const cp = V();
  function update(camera, force = false) {
    camera.getWorldPosition(cp);
    if (!force && cp.distanceToSquared(last) < 0.25) return;
    last.copy(cp);
    for (const T of all) {
      const cnt = [0, 0, 0, 0], cc = [0, 0];
      for (const t of T.users) {
        const d = cp.distanceTo(t.centre);
        const l = d < 20 ? 0 : d < 48 ? 1 : d < 120 ? 2 : 3;
        T.bark[l].setMatrixAt(cnt[l]++, t.matrix);
        const cl = d < 64 + t.radius ? 0 : 1;
        T.cardMeshes[cl].setMatrixAt(cc[cl]++, t.matrix);
        const nearF = d - t.radius * 0.3 < NEAR.y + 1;
        t.fm.visible = t.lm.visible = nearF;
        // full flowers (stamens, sepals, cupped petals) only where they can be seen
        t.fm.geometry = d - t.radius < 6 ? T.fg : T.fgLo;
      }
      T.bark.forEach((m, l) => { m.count = cnt[l]; m.instanceMatrix.needsUpdate = true; });
      T.cardMeshes.forEach((m, l) => { m.count = cc[l]; m.instanceMatrix.needsUpdate = true; });
    }
  }

  group.userData = {
    trees, templates: tpls, update,
    stats: () => tpls.map((T) => ({ users: T.users.length, flowers: T.nFl, cards: T.bl.cards.length, tris: T.lods.map((g) => g.index.count / 3) })),
  };
  return group;
}

// how much peach canopy stands over a point (for fallen petals and the blush on the ground)
export function peachDensityFn(trees) {
  const grid = new Map();
  for (const t of trees) {
    const k = `${Math.floor(t.x / 10)},${Math.floor(t.z / 10)}`;
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(t);
  }
  return (x, y, z) => {
    const gx = Math.floor(x / 10), gz = Math.floor(z / 10);
    let s = 0;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const l = grid.get(`${gx + i},${gz + j}`);
      if (l) for (const t of l) {
        const cx = t.centre ? t.centre.x : t.x, cz = t.centre ? t.centre.z : t.z;
        const r = (t.radius || 3.5) * 1.1;
        const d = Math.hypot(x - cx, z - cz) / r;
        s += Math.exp(-d * d * 1.6) * (1 - smoothstep(1.5, 4, Math.abs(y - t.y)));
      }
    }
    return Math.min(1, s);
  };
}
