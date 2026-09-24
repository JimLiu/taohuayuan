// 芳草鲜美: fresh spring grass around the eye, and a few small wild flowers in it.
// The ground under the grass is baked once into a float texture (the rendered mesh height, how much
// grass grows there, how short it is kept under the peach crowns, which side of the mountain), and
// two rings of instanced tufts follow the camera: dense and fine near, sparser and coarser beyond.
// Tufts sit on a world grid, so they don't swim as the camera moves.
import * as THREE from 'three';
import { Rng, clamp, smoothstep, lerp } from '../core/rng.js';
import { fbm2, perlin2 } from '../core/noise.js';
import { G, hook, TRANSLUCENT } from '../core/shared.js';
import {
  height, basinR, creekDist, WATER_OUT, FIELD_BOUNDS, PATHS_NS, PATHS_EW, DESCENT, polyDist, pondDist, CANALS,
  fieldAt, VILLAGE, THRESH, SRC, inMouthBox,
} from './layout.js';
import { canvas, bleed, tex } from './peach.js';
import { builtAt, toLocal } from './villageplan.js';

// the baked window: the creek valley outside and the whole basin floor, at 1 m
export const GROUND = { x0: -200, z0: -330, w: 400, h: 830 };

// the terrain mesh's own vertex heights, cached, so grass roots sit exactly on the drawn surface
function meshSampler() {
  const TX0 = -1000, TZ0 = -900, TT = 100;
  const cache = new Map();
  const hv = (x, z) => {
    const k = (Math.round(x * 8) + 16000) * 40000 + (Math.round(z * 8) + 16000);
    let v = cache.get(k);
    if (v === undefined) { v = height(x, z); cache.set(k, v); }
    return v;
  };
  const resOf = new Map();
  return (x, z, tileRes) => {
    const tx = TX0 + Math.floor((x - TX0) / TT) * TT, tz = TZ0 + Math.floor((z - TZ0) / TT) * TT;
    const tk = tx * 10000 + tz;
    let res = resOf.get(tk);
    if (res === undefined) { res = tileRes(tx + TT / 2, tz + TT / 2); resOf.set(tk, res); }
    const gi = Math.floor((x - tx) / res), gj = Math.floor((z - tz) / res);
    const x0 = tx + gi * res, z0 = tz + gj * res;
    const fx = (x - x0) / res, fz = (z - z0) / res;
    const hb = hv(x0 + res, z0), hc = hv(x0, z0 + res);
    if (fx + fz <= 1) { const ha = hv(x0, z0); return ha + fx * (hb - ha) + fz * (hc - ha); }
    const hd = hv(x0 + res, z0 + res);
    return hd + (1 - fx) * (hc - hd) + (1 - fz) * (hb - hd);
  };
}

function pathDist(x, z) {
  let d = 1e9;
  if (x > FIELD_BOUNDS.x0 - 2 && x < FIELD_BOUNDS.x1 + 2 && z < FIELD_BOUNDS.z0 + 2 && z > FIELD_BOUNDS.z1 - 30) {
    for (const px of PATHS_NS) d = Math.min(d, Math.abs(x - px) - (px === 0 ? 0.6 : 0));
    for (const pz of PATHS_EW) d = Math.min(d, Math.abs(z - pz));
  }
  if (z < -40 && z > -100 && x > -20 && x < 20) d = Math.min(d, polyDist(DESCENT, x, z).d - 0.2);
  return d;
}

// R: surface height, G: grass amount, B: how short (under the crowns, trodden), A: basin (1) or outside (0)
export function bakeGround(tileRes, blushFn) {
  const { x0, z0, w, h } = GROUND;
  const data = new Float32Array(w * h * 4);
  const hs = meshSampler();
  for (let j = 0; j < h; j++) {
    const z = z0 + j + 0.5;
    for (let i = 0; i < w; i++) {
      const x = x0 + i + 0.5;
      const o = (j * w + i) * 4;
      const r = basinR(x, z);
      const inBasin = r < 0.985 && z < -34;
      const outside = z > 36;
      let cd = 1e9;
      if (!inBasin) {
        if (!outside) { data[o] = height(x, z); continue; }
        cd = creekDist(x, z);
        if (cd > 75) { data[o] = height(x, z); continue; }
      }
      const y = hs(x, z, tileRes);
      data[o] = y;
      // slope from the neighbouring texels of the same surface
      const gx = hs(x + 0.7, z, tileRes) - y, gz = hs(x, z + 0.7, tileRes) - y;
      const slope = Math.hypot(gx, gz) / 0.7;
      let g = 1 - smoothstep(0.55, 0.95, slope);
      let short = 0;
      const n = fbm2(x * 0.09, z * 0.09, 2), n2 = perlin2(x * 0.41, z * 0.41);
      // patchy: thick clumps and thinner ground between them
      g *= 0.55 + 0.45 * smoothstep(-0.45, 0.35, n + n2 * 0.35);
      if (inBasin) {
        g *= 1 - smoothstep(20, 34, y);                       // up into the forested slopes
        g *= 1 - smoothstep(0.93, 0.985, r);
        if (y < -0.12) g = 0;                                  // pond and canals
        const pd = pathDist(x, z);
        g *= smoothstep(0.2, 1.3, pd + n2 * 0.25);
        short = Math.max(short, 1 - smoothstep(0.4, 2.2, pd));
        if (fieldAt(x, z)) g = 0;                             // the crops are their own thing
        const pn = pondDist(x, z);
        if (pn < 2.5) g *= smoothstep(-0.3, 2.5, pn);
        for (const cn of CANALS) { const d = polyDist(cn, x, z).d; if (d < 1.6) g *= smoothstep(0.5, 1.6, d); }
        // the village: trampled short between the houses, bare in the yards and under the buildings, worn lanes
        const [vu, vv] = toLocal(x, z);
        const vil = 1 - smoothstep(0.75, 1.1, Math.hypot((vu - 10) / 78, (vv + 8) / 44) + n * 0.25);
        g *= 1 - vil * 0.45;
        short = Math.max(short, vil * 0.85);
        if (vil > 0) {
          const b = builtAt(x, z);
          if (b.house) g = 0;
          else if (b.yard) g *= 0.1;
          if (b.lane < 3) { g *= smoothstep(0.9, 2.6, b.lane + n2 * 0.4); short = 1; }
        }
        const th = Math.hypot(x - THRESH.x, z - THRESH.z);
        if (th < THRESH.r + 1.5) g *= smoothstep(THRESH.r - 0.5, THRESH.r + 1.5, th);
      } else {
        if (y < WATER_OUT + 0.02) g = 0;
        g *= smoothstep(0.1, 1.2, cd);                         // wet margin: sparse
        g *= 1 - smoothstep(WATER_OUT + 11, WATER_OUT + 22, y); // mountain forest above
        if (Math.hypot(x - SRC.x, z - SRC.z) < SRC.r + 2.5) g *= 0.4;
        if (inMouthBox(x, z, -2)) g = 0;
        // kept short where the petals fall thickest, so they lie on top
        const b = blushFn(x, y, z);
        short = Math.max(short, smoothstep(0.1, 0.7, b));
        g *= 1 - 0.35 * smoothstep(0.3, 0.9, b);
      }
      data[o + 1] = clamp(g, 0, 1);
      data[o + 2] = clamp(short, 0, 1);
      data[o + 3] = inBasin ? 1 : 0;
    }
  }
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.FloatType);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  const sample = (x, z) => {
    const fx = clamp(x - x0 - 0.5, 0, w - 1.001), fz = clamp(z - z0 - 0.5, 0, h - 1.001);
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    const at = (a, b, c) => data[((b) * w + a) * 4 + c];
    const bl = (c) => lerp(lerp(at(i, j, c), at(i + 1, j, c), u), lerp(at(i, j + 1, c), at(i + 1, j + 1, c), u), v);
    return { y: bl(0), grass: bl(1), short: bl(2), basin: bl(3) };
  };
  return { tex: t, data, sample };
}

export const GROUND_GLSL = /* glsl */ `
  uniform sampler2D uGround;
  uniform vec4 uGroundRect; // x0, z0, w, h
  vec4 groundAt(vec2 xz) { return texture2D(uGround, (xz - uGroundRect.xy) / uGroundRect.zw); }
`;

// ------------------------------------------------------------------ tuft geometry
// 7 blades, 3 segments each; everything about the shape is decided in the vertex shader
function tuftGeometry(blades = 9) {
  const P = [], B = [], I = [];
  const rng = new Rng(55);
  for (let b = 0; b < blades; b++) {
    const a = rng.range(0, 6.28), r = Math.sqrt(rng.next()) * 0.1;
    const bx = Math.cos(a) * r, bz = Math.sin(a) * r;
    const ang = rng.range(0, 6.28), rnd = rng.next();
    const base = P.length / 3;
    for (let s = 0; s <= 3; s++) {
      const t = s / 3;
      if (s < 3) {
        P.push(bx, 0, bz, bx, 0, bz);
        B.push(t, -1, ang, rnd, t, 1, ang, rnd);
      } else {
        P.push(bx, 0, bz);
        B.push(1, 0, ang, rnd);
      }
    }
    for (let s = 0; s < 2; s++) {
      const a0 = base + s * 2;
      I.push(a0, a0 + 1, a0 + 2, a0 + 1, a0 + 3, a0 + 2);
    }
    I.push(base + 4, base + 5, base + 6);
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(P.length).fill(0), 3));
  g.setAttribute('aBlade', new THREE.Float32BufferAttribute(B, 4));
  g.setIndex(I);
  return g;
}

function gridCells(n) {
  const a = new Float32Array(n * n * 2);
  let k = 0;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { a[k++] = i - n / 2; a[k++] = j - n / 2; }
  return new THREE.InstancedBufferAttribute(a, 2);
}

function grassMaterial(ground, ring) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: false, side: THREE.DoubleSide, roughness: 0.78, metalness: 0 });
  m.userData.uniforms = {
    uGround: { value: ground.tex },
    uGroundRect: { value: new THREE.Vector4(GROUND.x0, GROUND.z0, GROUND.w, GROUND.h) },
    uRing: { value: new THREE.Vector4(...ring) }, // spacing, inner fade start, outer fade start, outer end
    uWide: { value: ring[4] },
  };
  return hook(m, 'grass-' + ring[0], (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
      attribute vec4 aBlade; attribute vec2 aCell;
      uniform vec4 uRing; uniform float uWide;
      varying vec3 vGCol; varying float vGT;
      ${GROUND_GLSL}`)
      .replace('#include <beginnormal_vertex>', `
      vec3 gP = vec3(0.0, -1e4, 0.0), gN = vec3(0.0, 1.0, 0.0);
      vGCol = vec3(0.0); vGT = aBlade.x;
      {
        float sp = uRing.x;
        vec2 cell = floor(cameraPosition.xz / sp) + aCell;
        float h1 = hash12(cell * 0.713 + 11.3), h2 = hash12(cell * 1.37 - 4.1), h3 = hash12(cell * 0.291 + 7.7);
        vec2 xz = (cell + vec2(h1, h2)) * sp;
        float dist = distance(xz, cameraPosition.xz);
        vec4 gr = groundAt(xz);
        float keep = step(h3, gr.y * 1.7) * step(uRing.y * 0.6, dist + 1.0);
        // grow in from the inner ring and sink away at the outer edge
        float grow = smoothstep(uRing.y - 3.0, uRing.y, dist) * (1.0 - smoothstep(uRing.z, uRing.w, dist));
        if (uRing.y < 0.5) grow = 1.0 - smoothstep(uRing.z, uRing.w, dist);
        float H = mix(0.11, 0.3, hash12(cell * 2.1 + 3.0)) * mix(1.0, 0.35, gr.z) * (0.7 + 0.5 * gr.y);
        H *= grow * keep;
        if (H > 0.004) {
          float t = aBlade.x, side = aBlade.y, ang = aBlade.z + h1 * 6.2832, rnd = aBlade.w;
          float bh = H * (0.6 + 0.55 * rnd);
          vec2 dir = vec2(cos(ang), sin(ang));
          float lean = 0.25 + 0.5 * fract(rnd * 7.3);
          vec3 root = vec3(xz.x + position.x * uWide * 1.4, gr.x - 0.02, xz.y + position.z * uWide * 1.4);
          vec3 wind = vec3(uWind.x, 0.0, uWind.y);
          float g = windGust(root);
          float sway = (0.18 + 0.22 * sin(uTime * 2.1 + dot(root.xz, vec2(0.7, 0.4)) + rnd * 6.0)) * g;
          vec3 bend = vec3(dir.x, 0.0, dir.y) * lean + wind * sway;
          vec3 up = vec3(0.0, 1.0, 0.0);
          vec3 p = root + up * bh * t * (1.0 - 0.25 * t * length(bend)) + bend * bh * t * t;
          vec3 tang = normalize(up * (1.0 - 0.5 * t * length(bend)) + bend * 2.0 * t);
          vec3 perp = normalize(vec3(-dir.y, 0.0, dir.x));
          float wdt = 0.011 * uWide * (1.0 - pow(t, 1.6)) * (0.8 + 0.4 * rnd);
          gP = p + perp * side * wdt;
          gN = normalize(mix(cross(perp, tang), up, 0.55));
          // colour: deep at the root, fresh yellow-green toward the tips; the basin a touch brighter
          float n = vnoise(xz * 0.21) * 0.6 + vnoise(xz * 1.3) * 0.4;
          vec3 root_c = mix(vec3(0.07, 0.14, 0.025), vec3(0.09, 0.16, 0.03), n);
          vec3 tip_c = mix(vec3(0.22, 0.38, 0.06), vec3(0.32, 0.44, 0.08), n) * mix(1.0, 1.06, gr.w);
          tip_c = mix(tip_c, vec3(0.3, 0.36, 0.12), fract(rnd * 3.7) * 0.25);
          vGCol = mix(root_c, tip_c, smoothstep(0.0, 0.9, t)) * mix(1.0, 0.82, gr.z);
        }
      }
      vec3 objectNormal = gN;`)
      .replace('#include <begin_vertex>', 'vec3 transformed = gP;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
      varying vec3 vGCol; varying float vGT;`)
      .replace('#include <color_fragment>', 'diffuseColor.rgb = vGCol;')
      .replace('#include <lights_fragment_begin>', `#include <lights_fragment_begin>
      {
        ${TRANSLUCENT}
        reflectedLight.directDiffuse += sunC * diffuseColor.rgb * (sunBack * 1.2 + sunWrap * 0.25) * vGT;
      }`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
      reflectedLight.indirectDiffuse *= mix(0.6, 1.0, vGT);`);
  });
}

// ------------------------------------------------------------------ wild flowers: few, small, pale
function flowerAtlas() {
  const S = 128, c = canvas(S * 4, S), ctx = c.getContext('2d');
  const star = (ox, n, r0, r1, col, eye) => {
    ctx.save();
    ctx.translate(ox + S / 2, S / 2);
    for (let i = 0; i < n; i++) {
      ctx.rotate((Math.PI * 2) / n);
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.ellipse(0, -r1 * 0.55, r0, r1 * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = eye;
    ctx.beginPath(); ctx.arc(0, 0, r0 * 0.7, 0, 7); ctx.fill();
    ctx.restore();
  };
  star(0, 5, 11, 58, 'rgb(246,244,236)', 'rgb(214,196,120)');       // chickweed-white
  star(S, 5, 16, 60, 'rgb(170,140,200)', 'rgb(236,226,236)');       // violet
  star(S * 2, 18, 5, 60, 'rgb(236,204,70)', 'rgb(222,178,52)');      // dandelion
  star(S * 3, 4, 14, 50, 'rgb(250,248,242)', 'rgb(200,210,150)');    // shepherd's purse
  bleed(ctx, c.width, c.height);
  return tex(c);
}

function wildFlowers(ground) {
  const n = 64; // 64 x 64 cells of 0.8 m around the eye
  const g = new THREE.InstancedBufferGeometry();
  // a stalk (thin vertical quad) and a head (flat quad facing up), both from one quad set
  const P = [-0.5, 0, 0, 0.5, 0, 0, -0.5, 1, 0, 0.5, 1, 0, -0.5, 0, -0.5, 0.5, 0, -0.5, -0.5, 0, 0.5, 0.5, 0, 0.5];
  const UV = [0, 0, 1, 0, 0, 1, 1, 1, 0, 0, 1, 0, 0, 1, 1, 1];
  const PART = [0, 0, 0, 0, 1, 1, 1, 1];
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(24).fill(0), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(PART, 1));
  g.setIndex([0, 1, 2, 1, 3, 2, 4, 6, 5, 5, 6, 7]);
  g.setAttribute('aCell', gridCells(n));
  g.instanceCount = n * n;
  const m = new THREE.MeshStandardMaterial({ map: flowerAtlas(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.6 });
  m.alphaToCoverage = true;
  m.userData.uniforms = {
    uGround: { value: ground.tex },
    uGroundRect: { value: new THREE.Vector4(GROUND.x0, GROUND.z0, GROUND.w, GROUND.h) },
  };
  hook(m, 'wildflowers', (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
      attribute vec2 aCell; attribute float aPart;
      ${GROUND_GLSL}`)
      .replace('#include <beginnormal_vertex>', `
      vec3 fP = vec3(0.0, -1e4, 0.0), fN = vec3(0.0, 1.0, 0.0);
      {
        float sp = 0.8;
        vec2 cell = floor(cameraPosition.xz / sp) + aCell;
        float h1 = hash12(cell * 0.53 + 2.1), h2 = hash12(cell * 1.91 - 8.3), h3 = hash12(cell * 0.37 + 5.5), h4 = hash12(cell * 3.3);
        vec2 xz = (cell + vec2(h1, h2)) * sp;
        vec4 gr = groundAt(xz);
        // in loose drifts: a few here and there, some small colonies
        float colony = smoothstep(0.55, 0.85, vnoise(xz * 0.12 + 4.0));
        float dens = gr.y * (1.0 - gr.z) * (0.025 + 0.25 * colony);
        float dist = distance(xz, cameraPosition.xz);
        float grow = 1.0 - smoothstep(18.0, 24.0, dist);
        if (h3 < dens && grow > 0.01) {
          float kind = floor(h4 * 4.0);
          // the violets and dandelions stay low; the white ones stand a little above the grass
          float stalk = (kind == 1.0 || kind == 2.0 ? 0.07 : 0.2) * (0.8 + 0.4 * h1) * grow;
          float head = (kind == 2.0 ? 0.034 : kind == 1.0 ? 0.026 : 0.018) * grow;
          vec3 root = vec3(xz.x, gr.x - 0.01, xz.y);
          float g = windGust(root);
          vec3 sw = vec3(uWind.x, 0.0, uWind.y) * (0.05 + 0.04 * sin(uTime * 2.3 + h2 * 20.0)) * g;
          vec3 top = root + vec3(0.0, stalk, 0.0) + sw * stalk * 3.0;
          float a = h2 * 6.2832;
          mat3 R = rotAxis(vec3(0.0, 1.0, 0.0), a);
          if (aPart < 0.5) {
            fP = mix(root, top, position.y) + R * vec3(position.x * 0.004, 0.0, 0.0);
            fN = R * vec3(0.0, 0.0, 1.0);
            vMapUv = vec2(0.02, 0.02); // (the stalk is drawn in the vertex colour below)
          } else {
            mat3 T = rotAxis(normalize(vec3(h1 - 0.5, 0.0, h3 - 0.5) + 0.001), (h4 - 0.5) * 0.6);
            fP = top + T * R * vec3(position.x, 0.0, position.z) * head;
            fN = T * vec3(0.0, 1.0, 0.0);
            vMapUv = vec2((kind + uv.x) / 4.0, uv.y);
          }
        }
      }
      vec3 objectNormal = fN;`)
      .replace('#include <begin_vertex>', 'vec3 transformed = fP;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <map_fragment>', `
      if (vMapUv.x < 0.03 && vMapUv.y < 0.03) diffuseColor.rgb = vec3(0.08, 0.16, 0.04);
      else { vec4 tc = texture2D(map, vMapUv); diffuseColor *= tc; }`);
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  mesh.layers.set(1);
  mesh.receiveShadow = true;
  mesh.name = 'wildflowers';
  return mesh;
}

export function buildGrass(ground) {
  const group = new THREE.Group();
  group.name = 'grass';
  // near: 0.33 m cells to 20 m; beyond: 0.9 m cells, wider tufts, out to 52 m
  const rings = [
    { sp: 0.3, n: 128, ring: [0.3, 0, 15.5, 19, 1.0] },
    { sp: 0.8, n: 132, ring: [0.8, 17, 42, 52, 1.9] },
  ];
  for (const r of rings) {
    const g = tuftGeometry();
    g.setAttribute('aCell', gridCells(r.n));
    g.instanceCount = r.n * r.n;
    const mesh = new THREE.Mesh(g, grassMaterial(ground, r.ring));
    mesh.frustumCulled = false;
    mesh.layers.set(1);
    mesh.receiveShadow = true;
    mesh.name = 'grass-' + r.sp;
    group.add(mesh);
  }
  group.add(wildFlowers(ground));
  group.userData.groundUniforms = {
    uGround: { value: ground.tex },
    uGroundRect: { value: new THREE.Vector4(GROUND.x0, GROUND.z0, GROUND.w, GROUND.h) },
  };
  return group;
}
