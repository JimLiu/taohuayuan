// 良田: the plots between the 阡陌, in spring only. Flooded paddies waiting for seedlings (and some
// being planted), seedlings standing in rows in the water, drilled rows of jade-green wheat, fresh
// tilth half ploughed, raised beds of greens by the village. Nothing golden.
// Far off each plot is one flat surface whose shader paints its rows, furrows and beds (the wheat a
// low green block whose top ripples when the wind passes); close by, a ring of instanced crops that
// follows the camera stands on exactly the same grid as the painted rows.
import * as THREE from 'three';
import { Rng } from '../core/rng.js';
import { hook, TRANSLUCENT } from '../core/shared.js';
import { FIELDS, PADDY_Y } from './layout.js';

const TYPE = { paddy: 1, seedlings: 2, wheat: 3, tilth: 4, greens: 5 };
export const DRY_Y = 0.1;                  // floor of the dry plots (layout.height)
export const BED_Y = PADDY_Y - 0.13;       // mud under the paddy water
export const WHEAT_TOP = DRY_Y + 0.56;
const WHEAT_INSET = 0.6;

// per-plot choices: which way the rows run, how far the ploughing or transplanting has got
for (const p of FIELDS) {
  const r = new Rng(Math.floor(p.seed * 1e6) + 7);
  const long = p.x1 - p.x0 > p.z1 - p.z0;
  p.rowsX = r.next() < 0.8 ? long : !long;
  p.variant = r.int(0, 3);
  p.flip = r.next() < 0.5 ? 1 : 0;
  p.done = 1;
  if (p.type === 'tilth' && r.next() < 0.6) p.done = r.range(0.3, 0.75);
  if (p.type === 'seedlings' && r.next() < 0.4) p.done = r.range(0.3, 0.7);
}

// where work is going on (for the people in the fields): the ploughman walks along the edge of the
// turned ground; the planters stand along the edge of the planted rows, facing the bare water
export const FIELD_WORK = FIELDS.filter((p) => p.done < 1).map((p) => {
  if (p.type === 'tilth') {
    const [a0, a1] = p.rowsX ? [p.z0, p.z1] : [p.x0, p.x1];
    const c = p.flip ? a1 - p.done * (a1 - a0) : a0 + p.done * (a1 - a0);
    const [b0, b1] = p.rowsX ? [p.x0 + 1.5, p.x1 - 1.5] : [p.z0 + 1.5, p.z1 - 1.5];
    return { kind: 'plough', plot: p, a: p.rowsX ? [b0, c] : [c, b0], b: p.rowsX ? [b1, c] : [c, b1], ahead: p.flip ? -1 : 1 };
  }
  const [a0, a1] = p.rowsX ? [p.x0, p.x1] : [p.z0, p.z1];
  const c = p.flip ? a1 - p.done * (a1 - a0) : a0 + p.done * (a1 - a0);
  const [b0, b1] = p.rowsX ? [p.z0 + 1.2, p.z1 - 1.2] : [p.x0 + 1.2, p.x1 - 1.2];
  return { kind: 'plant', plot: p, a: p.rowsX ? [c, b0] : [b0, c], b: p.rowsX ? [c, b1] : [b1, c], ahead: p.flip ? -1 : 1 };
});

// ------------------------------------------------------------------ the field map, for the crop ring
// R: type (a seedling plot's unplanted part reads as bare paddy), G: seed, B: distance in from the plot edge,
// A: rows along x (1) or z (0), plus 2 x variant
export const FMAP = { x0: -180, z0: -206, w: 760, h: 252, res: 0.5 };
function bakeFieldMap() {
  const { x0, z0, w, h, res } = FMAP;
  const data = new Float32Array(w * h * 4);
  for (const p of FIELDS) {
    const i0 = Math.max(0, Math.floor((p.x0 - x0) / res)), i1 = Math.min(w - 1, Math.ceil((p.x1 - x0) / res));
    const j0 = Math.max(0, Math.floor((p.z0 - z0) / res)), j1 = Math.min(h - 1, Math.ceil((p.z1 - z0) / res));
    for (let j = j0; j <= j1; j++) {
      const z = z0 + (j + 0.5) * res;
      if (z <= p.z0 || z >= p.z1) continue;
      for (let i = i0; i <= i1; i++) {
        const x = x0 + (i + 0.5) * res;
        if (x <= p.x0 || x >= p.x1) continue;
        let type = TYPE[p.type];
        if (p.type === 'seedlings' && p.done < 1) {
          const [a0, a1] = p.rowsX ? [p.x0, p.x1] : [p.z0, p.z1];
          let f = ((p.rowsX ? x : z) - a0) / (a1 - a0);
          if (p.flip) f = 1 - f;
          if (f > p.done) type = TYPE.paddy;
        }
        const o = (j * w + i) * 4;
        data[o] = type;
        data[o + 1] = p.seed;
        data[o + 2] = Math.min(x - p.x0, p.x1 - x, z - p.z0, p.z1 - z);
        data[o + 3] = (p.rowsX ? 1 : 0) + 2 * p.variant;
      }
    }
  }
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.FloatType);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}

// ------------------------------------------------------------------ plot surfaces
const PLOT_VARY = /* glsl */ `
  attribute vec4 aPlot;   // type, seed, rows along x, part (0 flat, 1 wheat top, 2 skirt top edge, 3 skirt foot)
  attribute vec4 aBounds; // x0, z0, x1, z1
  attribute vec2 aExt;    // how far the work has got, flip + 2 x variant
  varying vec4 vPlot; varying vec4 vBounds; varying vec2 vExt;`;
const PLOT_FRAG = /* glsl */ `
  varying vec4 vPlot; varying vec4 vBounds; varying vec2 vExt;
  // fraction of the plot along one axis, counted from the end where the work began
  float workFrac(float c, float a0, float a1) { float f = (c - a0) / (a1 - a0); return mod(vExt.y, 2.0) > 0.5 ? 1.0 - f : f; }`;

function addQuadGrid(A, x0, z0, x1, z1, y, step, plot, part) {
  const nx = Math.max(1, Math.round((x1 - x0) / step)), nz = Math.max(1, Math.round((z1 - z0) / step));
  const base = A.pos.length / 3;
  for (let j = 0; j <= nz; j++)
    for (let i = 0; i <= nx; i++) {
      A.pos.push(x0 + (x1 - x0) * i / nx, y, z0 + (z1 - z0) * j / nz);
      A.nor.push(0, 1, 0);
      A.push(plot, part);
    }
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const a = base + j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
      A.idx.push(a, c, b, b, c, d);
    }
}
// a vertical strip from (ax,az) to (bx,bz), facing (nx,nz)
function addSkirt(A, ax, az, bx, bz, nx, nz, y0, y1, plot) {
  const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(L / 2));
  const base = A.pos.length / 3;
  for (let i = 0; i <= n; i++) {
    const x = ax + (bx - ax) * i / n, z = az + (bz - az) * i / n;
    A.pos.push(x, y1, z, x, y0, z);
    A.nor.push(nx, 0, nz, nx, 0, nz);
    A.push(plot, 2);
    A.push(plot, 3);
  }
  for (let i = 0; i < n; i++) {
    const a = base + i * 2, b = a + 1, c = a + 2, d = a + 3;
    // wind so the face points along (nx, nz)
    if ((bx - ax) * nz - (bz - az) * nx > 0) A.idx.push(a, b, c, c, b, d); else A.idx.push(a, c, b, c, d, b);
  }
}
function arrays() {
  const A = { pos: [], nor: [], plot: [], bounds: [], ext: [], idx: [] };
  A.push = (p, part) => {
    A.plot.push(TYPE[p.type], p.seed, p.rowsX ? 1 : 0, part);
    A.bounds.push(p.x0, p.z0, p.x1, p.z1);
    A.ext.push(p.done, p.flip + 2 * p.variant);
  };
  A.geometry = () => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(A.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(A.nor, 3));
    g.setAttribute('aPlot', new THREE.Float32BufferAttribute(A.plot, 4));
    g.setAttribute('aBounds', new THREE.Float32BufferAttribute(A.bounds, 4));
    g.setAttribute('aExt', new THREE.Float32BufferAttribute(A.ext, 2));
    g.setIndex(A.idx);
    g.computeBoundingSphere();
    return g;
  };
  return A;
}

const vertPass = (sh) => {
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\n' + PLOT_VARY)
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPlot = aPlot; vBounds = aBounds; vExt = aExt;');
};

// the paddies: a hand of water over the mud, the sky and the hills in it, seedlings in rows
function paddyMaterial(refl) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 });
  m.userData.uniforms = refl;
  return hook(m, 'paddy', (sh) => {
    vertPass(sh);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
      ${PLOT_FRAG}
      uniform sampler2D uRefl; uniform mat4 uTexMat; uniform float uHasRefl;
      float pRip(vec2 p) {
        float t = uTime;
        return vnoise(p * 0.9 + vec2(t * 0.11, -t * 0.07)) * 0.6 + vnoise(p * 2.3 - vec2(t * 0.19, t * 0.13)) * 0.4;
      }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
      vec3 pRefl = vec3(0.0), pGlint = vec3(0.0);
      float pF = 0.0, pCov = 0.0;
      {
        vec3 wp3 = vFogWP; vec2 wp = wp3.xz;
        float type = floor(vPlot.x + 0.5);
        bool rowsX = vPlot.z > 0.5;
        float dist = distance(cameraPosition, wp3);
        vec3 V = normalize(cameraPosition - wp3);
        vec3 mud = mix(vec3(0.07, 0.056, 0.038), vec3(0.105, 0.085, 0.056), vnoise(wp * 0.4 + vPlot.y * 9.0));
        // still water; a breath of wind; cat's-paws where a gust runs over it
        float g = windGust(wp3);
        float e = 0.08;
        float h0 = pRip(wp), hx = pRip(wp + vec2(e, 0.0)), hz = pRip(wp + vec2(0.0, e));
        float amp = (0.03 + 0.16 * smoothstep(0.65, 1.3, g)) * (1.0 - 0.7 * smoothstep(40.0, 300.0, dist));
        vec3 n = normalize(vec3(-(hx - h0) / e * amp, 1.0, -(hz - h0) / e * amp));
        float ndv = max(dot(n, V), 0.0);
        pF = 0.05 + 0.95 * pow(1.0 - ndv, 5.0);
        vec3 R = reflect(-V, n);
        pRefl = skyFogColor(normalize(vec3(R.x, abs(R.y), R.z)));
        if (uHasRefl > 0.5) {
          vec4 rc = uTexMat * vec4(wp3, 1.0);
          pRefl = texture2D(uRefl, rc.xy / rc.w + n.xz * 0.03).rgb;
        }
        pGlint = uSunCol * uSunVis * pow(max(dot(R, uSunDir), 0.0), 500.0) * 3.0;
        if (type == 2.0) {
          // seedlings on a 25 cm grid: drawn here from afar, the real clumps take over close by
          float planted = step(workFrac(rowsX ? wp.x : wp.y, rowsX ? vBounds.x : vBounds.y, rowsX ? vBounds.z : vBounds.w), vExt.x);
          vec2 q = wp / 0.25;
          float w = max(fwidth(q.x), fwidth(q.y));
          float dotc = 1.0 - smoothstep(0.26 - w, 0.26 + w, length(fract(q) - 0.5));
          float cov = mix(dotc, 0.21, smoothstep(0.12, 0.35, w));
          cov = clamp(cov * (1.0 + 3.0 * pow(1.0 - V.y, 2.0)), 0.0, 1.0);   // low down, the rows close up
          pCov = cov * planted * smoothstep(19.0, 25.0, dist);
        }
        vec3 sd = mix(vec3(0.15, 0.29, 0.05), vec3(0.21, 0.35, 0.07), vnoise(wp * 0.5));
        diffuseColor.rgb = mix(mud, sd, pCov);
      }`)
      .replace('#include <opaque_fragment>', `
      outgoingLight = mix(outgoingLight, pRefl, pF * (1.0 - pCov)) + pGlint * (1.0 - pCov);
      #include <opaque_fragment>`);
  });
}

// dry plots: furrowed tilth, beds of greens, the wheat block
function dryMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
  m.polygonOffset = true;
  m.polygonOffsetFactor = -1;
  m.polygonOffsetUnits = -2;
  return hook(m, 'dryfields', (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + PLOT_VARY)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      vPlot = aPlot; vBounds = aBounds; vExt = aExt;
      if (aPlot.w > 0.5 && aPlot.w < 2.5) {
        // the wheat top: a little uneven, and pressed down where the gust runs through it
        vec3 wq = (modelMatrix * vec4(transformed, 1.0)).xyz;
        float g = windGust(wq);
        transformed.y += (vnoise(wq.xz * 0.35) - 0.5) * 0.07 - 0.09 * smoothstep(0.6, 1.3, g);
      }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
      ${PLOT_FRAG}
      float bedH(float acr) { float b = fract(acr / 1.5); return 0.08 * (1.0 - smoothstep(0.24, 0.333, abs(b - 0.3333))); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
      vec3 fNw = vec3(0.0, 1.0, 0.0);
      float fUseN = 1.0;
      {
        vec3 wp3 = vFogWP; vec2 wp = wp3.xz;
        float type = floor(vPlot.x + 0.5), seed = vPlot.y, part = vPlot.w;
        bool rowsX = vPlot.z > 0.5;
        float variant = floor(vExt.y * 0.5 + 0.01);
        float acr = rowsX ? wp.y : wp.x, alo = rowsX ? wp.x : wp.y;
        vec3 acv = rowsX ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
        float dist = distance(cameraPosition, wp3);
        float n1 = vnoise(wp * 0.23 + seed * 17.0), n2 = vnoise(wp * 2.3 + 5.0);
        float fine = 1.0 - smoothstep(0.1, 0.4, fwidth(wp.x * 9.0));
        float n3 = mix(0.5, vnoise(wp * 9.0), fine);
        vec3 dryS = vec3(0.25, 0.165, 0.095), wetS = vec3(0.11, 0.075, 0.045);
        vec3 col;
        if (type == 4.0) {
          // tilth: furrows half a metre apart, the crests drying pale, the troughs dark and moist;
          // beyond the ploughed part last year's stubble and the first weeds
          float ploughed = step(workFrac(acr, rowsX ? vBounds.y : vBounds.x, rowsX ? vBounds.w : vBounds.z), vExt.x);
          float ph = acr / 0.5;
          float aa = 1.0 - smoothstep(0.2, 0.55, fwidth(ph));
          float s = sin(ph * 6.2832);
          vec3 turned = mix(wetS, dryS, mix(0.45, 0.5 + 0.5 * s, aa) * (0.75 + 0.35 * n1));
          turned *= 0.82 + 0.36 * n3;
          vec3 stub = mix(vec3(0.3, 0.25, 0.14), vec3(0.17, 0.22, 0.08), smoothstep(0.35, 0.75, n2 * 0.6 + n1 * 0.4));
          col = mix(stub, turned, ploughed);
          float slope = 0.05 * cos(ph * 6.2832) * 12.566 * aa * ploughed;
          fNw = normalize(vec3(0.0, 1.0, 0.0) - acv * slope);
        } else if (type == 5.0) {
          // greens on raised beds, two rows to a bed; the gutters between them dark
          float b = fract(acr / 1.5);
          float aaB = 1.0 - smoothstep(0.05, 0.25, fwidth(acr / 1.5));
          float onBed = 1.0 - smoothstep(0.22, 0.3, abs(b - 0.3333));
          col = mix(wetS * 1.1, dryS * 0.9, mix(0.65, onBed, aaB)) * (0.85 + 0.3 * n3);
          float slope = (bedH(acr + 0.03) - bedH(acr - 0.03)) / 0.06 * aaB;
          fNw = normalize(vec3(0.0, 1.0, 0.0) - acv * slope);
          vec3 leafC = variant == 1.0 ? vec3(0.2, 0.36, 0.06) : variant == 2.0 ? vec3(0.07, 0.19, 0.06) : variant == 3.0 ? vec3(0.17, 0.32, 0.06) : vec3(0.06, 0.17, 0.05);
          float cov;
          if (variant == 2.0) {
            // scallions: unbroken lines along the rows
            float q = acr / 0.5;
            float w = fwidth(q);
            cov = mix(1.0 - smoothstep(0.1 - w, 0.1 + w, abs(fract(q) - 0.5)), 0.2, smoothstep(0.2, 0.6, w));
          } else {
            vec2 q = wp / 0.5;
            float w = max(fwidth(q.x), fwidth(q.y));
            float r = variant == 3.0 ? 0.16 : 0.36;
            float blob = 1.0 - smoothstep(r - w, r + w, length(fract(q) - 0.5) * (1.0 + 0.25 * (n2 - 0.5)));
            cov = mix(blob, 3.1416 * r * r, smoothstep(0.25, 0.6, w));
          }
          cov *= mix(0.67, onBed, aaB);
          col = mix(col, leafC * (0.8 + 0.4 * n1), cov);
        } else {
          // the wheat: a jade block; the gust runs over it as a paler wave
          float g = windGust(wp3);
          vec3 jade = mix(vec3(0.1, 0.225, 0.08), vec3(0.16, 0.31, 0.105), n1);
          jade = mix(jade, vec3(0.22, 0.35, 0.13), (n2 - 0.3) * 0.4);
          if (part < 1.5) {
            float ph = acr / 0.25;
            float aa = 1.0 - smoothstep(0.2, 0.5, fwidth(ph));
            float row = 0.5 + 0.5 * cos(ph * 6.2832);
            col = jade * (0.88 + 0.24 * mix(0.5, row, aa)) * (0.9 + 0.2 * n3);
            col *= 1.0 + 0.4 * smoothstep(0.55, 1.25, g);
            fNw = normalize(vec3((n2 - 0.5) * 0.35, 1.0, (n1 - 0.5) * 0.35));
          } else {
            float vy = clamp((wp3.y - ${DRY_Y.toFixed(2)}) / ${(WHEAT_TOP - DRY_Y).toFixed(2)}, 0.0, 1.0);
            col = jade * mix(0.3, 0.8, vy) * (0.75 + 0.5 * vnoise(vec2((alo + acr) * 13.0, wp3.y * 4.0)));
            fUseN = 0.0;
          }
          // close by the real blades stand in its place
          float keep = smoothstep(15.0, 21.0, dist);
          if (hash12(floor(wp3.xz * 22.0) + floor(wp3.y * 22.0) * 7.1) > keep) discard;
        }
        diffuseColor.rgb = col;
      }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      if (fUseN > 0.5) normal = normalize((viewMatrix * vec4(fNw, 0.0)).xyz);`);
  });
}

// ------------------------------------------------------------------ the crop ring
// blades: t along the blade, side (-1 / 1, 0 at the tip), blade index, random
function cropGeometry(blades) {
  const P = [], B = [], I = [];
  const rng = new Rng(77 + blades);
  for (let b = 0; b < blades; b++) {
    const rnd = rng.next();
    const base = P.length / 3;
    for (let s = 0; s <= 3; s++) {
      const t = s / 3;
      if (s < 3) { P.push(0, 0, 0, 0, 0, 0); B.push(t, -1, b, rnd, t, 1, b, rnd); }
      else { P.push(0, 0, 0); B.push(1, 0, b, rnd); }
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
  g.setAttribute('aB', new THREE.Float32BufferAttribute(B, 4));
  g.setIndex(I);
  return g;
}

function cropMaterial(map, ring, blades) {
  const m = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.8, metalness: 0 });
  m.userData.uniforms = {
    uFieldMap: { value: map },
    uFieldRect: { value: new THREE.Vector4(FMAP.x0, FMAP.z0, FMAP.w * FMAP.res, FMAP.h * FMAP.res) },
    uRing: { value: new THREE.Vector4(...ring) }, // spacing, inner fade end, outer fade start, outer end
    uWide: { value: ring[4] },
    uBlades: { value: blades },
  };
  return hook(m, 'crops-' + ring[0], (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
      attribute vec4 aB; attribute vec2 aCell;
      uniform vec4 uRing; uniform float uWide, uBlades;
      uniform sampler2D uFieldMap; uniform vec4 uFieldRect;
      varying vec3 vCCol; varying float vCT;`)
      .replace('#include <beginnormal_vertex>', `
      vec3 cP = vec3(0.0, -1e4, 0.0), cN = vec3(0.0, 1.0, 0.0);
      vCCol = vec3(0.0); vCT = aB.x;
      {
        float sp = uRing.x;
        vec2 cell = floor(cameraPosition.xz / sp) + aCell;
        vec2 cc = (cell + 0.5) * sp;
        vec4 fm = texture2D(uFieldMap, (cc - uFieldRect.xy) / uFieldRect.zw);
        float type = floor(fm.r + 0.5), e = fm.b;
        bool rowsX = mod(fm.a, 2.0) > 0.5;
        float variant = floor(fm.a * 0.5 + 0.01);
        float dist = distance(cc, cameraPosition.xz);
        float grow = 1.0 - smoothstep(uRing.z, uRing.w, dist);
        if (uRing.y > 0.5) grow *= smoothstep(uRing.y - 2.0, uRing.y, dist);
        float t = aB.x, side = aB.y, bi = aB.z, rnd = aB.w;
        bool far = uWide > 1.5;
        vec2 al = rowsX ? vec2(1.0, 0.0) : vec2(0.0, 1.0), ac = rowsX ? vec2(0.0, 1.0) : vec2(1.0, 0.0);
        float h1 = hash12(cell * 0.713 + 11.3), h2 = hash12(cell * 1.37 - 4.1), h3 = hash12(cell * 0.291 + 7.7);
        float r1 = hash12(cell * 2.9 + bi * 1.37), r2 = hash12(cell * 0.61 - bi * 2.11);
        float H = 0.0, Wd = 0.0, lean = 0.0, rootY = ${DRY_Y.toFixed(3)}, leaf = 0.0, upMix = 0.55;
        vec2 root = cc, dir = vec2(1.0, 0.0);
        vec3 rc = vec3(0.0), tc = vec3(0.0);
        if (type == 2.0 && e > 0.75) {
          // seedlings: a clump every 25 cm, fanned out a little
          rootY = ${BED_Y.toFixed(3)};
          vec2 sub = far ? (vec2(mod(bi, 2.0), mod(floor(bi * 0.5), 2.0)) - 0.5) * 0.25 : vec2(0.0);
          vec2 clump = cc + sub + (vec2(hash12(cell + sub * 7.0), hash12(cell * 1.3 - sub * 5.0)) - 0.5) * 0.04;
          float a = bi * 2.39996 + h1 * 6.2832;
          dir = vec2(cos(a), sin(a));
          root = clump + dir * 0.012;
          H = mix(0.3, 0.42, h2) * (0.8 + 0.3 * r1);
          Wd = 0.006; lean = 0.15 + 0.25 * r2;
          rc = vec3(0.06, 0.13, 0.03); tc = mix(vec3(0.26, 0.42, 0.07), vec3(0.34, 0.49, 0.1), h3);
        } else if (type == 3.0 && e > 0.7) {
          // wheat: drilled rows 25 cm apart, the blades close along each row
          float rowOff = far ? (mod(bi, 2.0) - 0.5) * 0.25 : 0.0;
          root = cc + ac * (rowOff + (r2 - 0.5) * 0.035) + al * (r1 - 0.5) * sp;
          float a = r2 * 6.2832 + r1 * 3.0;
          dir = vec2(cos(a), sin(a));
          // (leaves arching out from the stems, not sticks)
          H = mix(0.46, 0.62, h2) * (0.85 + 0.25 * r1);
          Wd = 0.011; lean = 0.22 + 0.4 * r2 * r2;
          rc = vec3(0.045, 0.11, 0.04); tc = mix(vec3(0.15, 0.3, 0.1), vec3(0.24, 0.38, 0.14), h3 * 0.6 + r1 * 0.4);
        } else if (type == 5.0 && e > 0.7) {
          if (variant == 2.0) {
            // scallions: upright, in unbroken lines
            float ca = floor(dot(cc, ac) / sp);
            bool onRow = far || mod(ca, 2.0) < 0.5;
            vec2 pos = cc + (far ? vec2(0.0) : ac * 0.125) + al * (r1 - 0.5) * sp + ac * (r2 - 0.5) * 0.03;
            float b = fract(dot(pos, ac) / 1.5);
            if (onRow && abs(b - 0.3333) < 0.22) {
              root = pos;
              float a = r2 * 6.2832; dir = vec2(cos(a), sin(a));
              H = mix(0.22, 0.34, h2); Wd = 0.005; lean = 0.05 + 0.1 * r2;
              rc = vec3(0.12, 0.17, 0.08); tc = vec3(0.1, 0.27, 0.1);
            }
          } else {
            // rosettes on a 50 cm grid, two rows to a bed
            bool keepC = far || (mod(cell.x, 2.0) < 0.5 && mod(cell.y, 2.0) < 0.5);
            vec2 cen = far ? cc : cc + 0.125;
            float b = fract(dot(cen, ac) / 1.5);
            if (keepC && abs(b - 0.3333) < 0.22) {
              float a = bi / uBlades * 6.2832 + h1 * 6.2832 + r1 * 0.5;
              dir = vec2(cos(a), sin(a));
              root = cen + dir * 0.015;
              leaf = 1.0; upMix = 0.3;
              if (variant == 3.0) { H = mix(0.06, 0.09, h2); Wd = 0.018; lean = 0.6; }
              else if (variant == 1.0) { H = mix(0.13, 0.18, h2); Wd = 0.05; lean = 0.55; }
              else { H = mix(0.15, 0.22, h2); Wd = 0.045; lean = 0.75 - 0.3 * fract(bi * 0.37); }
              H *= 0.85 + 0.3 * r2;
              rc = variant == 0.0 ? vec3(0.16, 0.24, 0.12) : vec3(0.1, 0.2, 0.05);
              tc = variant == 1.0 ? vec3(0.2, 0.37, 0.06) : variant == 3.0 ? vec3(0.17, 0.33, 0.06) : vec3(0.05, 0.16, 0.045);
            }
          }
        }
        H *= grow;
        if (H > 0.004) {
          vec3 R3 = vec3(root.x, rootY, root.y);
          float gw = windGust(R3);
          float flex = leaf > 0.5 ? 0.2 : 1.0;
          float sway = (0.14 + 0.2 * sin(uTime * 2.0 + dot(R3.xz, vec2(0.7, 0.4)) + rnd * 6.0)) * gw * flex;
          vec3 bend = vec3(dir.x, 0.0, dir.y) * lean + vec3(uWind.x, 0.0, uWind.y) * sway;
          vec3 up = vec3(0.0, 1.0, 0.0);
          float bl = length(bend);
          vec3 p = R3 + up * H * t * (1.0 - 0.25 * t * bl) + bend * H * t * t;
          vec3 tang = normalize(up * (1.0 - 0.5 * t * bl) + bend * 2.0 * t);
          vec3 perp = normalize(vec3(-dir.y, 0.0, dir.x));
          float prof = leaf > 0.5 ? sin(3.1416 * min(t * 1.1, 1.0)) + 0.12 : 1.0 - pow(t, 1.6);
          float wdt = Wd * (leaf > 0.5 ? 1.0 : uWide) * prof * (0.8 + 0.4 * rnd);
          cP = p + perp * side * wdt;
          cN = normalize(mix(cross(perp, tang), up, upMix));
          vCCol = mix(rc, tc, smoothstep(0.0, 0.9, t));
        }
      }
      vec3 objectNormal = cN;`)
      .replace('#include <begin_vertex>', 'vec3 transformed = cP;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
      varying vec3 vCCol; varying float vCT;`)
      .replace('#include <color_fragment>', 'diffuseColor.rgb = vCCol;')
      .replace('#include <lights_fragment_begin>', `#include <lights_fragment_begin>
      {
        ${TRANSLUCENT}
        reflectedLight.directDiffuse += sunC * diffuseColor.rgb * (sunBack * 1.1 + sunWrap * 0.22) * vCT;
      }`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
      reflectedLight.indirectDiffuse *= mix(0.55, 1.0, vCT);`);
  });
}

function gridCells(n) {
  const a = new Float32Array(n * n * 2);
  let k = 0;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { a[k++] = i - n / 2; a[k++] = j - n / 2; }
  return new THREE.InstancedBufferAttribute(a, 2);
}

// ------------------------------------------------------------------ build
export function buildFarmland() {
  const group = new THREE.Group();
  group.name = 'fields';

  // uniforms the planar reflection fills (shared with the pond's)
  const reflUniforms = { uRefl: { value: null }, uTexMat: { value: new THREE.Matrix4() }, uHasRefl: { value: 0 } };

  const W = arrays(), D = arrays();
  for (const p of FIELDS) {
    if (p.flooded) addQuadGrid(W, p.x0, p.z0, p.x1, p.z1, PADDY_Y, 1e9, p, 0);
    else if (p.type === 'wheat') {
      const i = WHEAT_INSET, x0 = p.x0 + i, x1 = p.x1 - i, z0 = p.z0 + i, z1 = p.z1 - i;
      addQuadGrid(D, x0, z0, x1, z1, WHEAT_TOP, 2, p, 1);
      addSkirt(D, x0, z0, x1, z0, 0, -1, DRY_Y - 0.04, WHEAT_TOP, p);
      addSkirt(D, x1, z1, x0, z1, 0, 1, DRY_Y - 0.04, WHEAT_TOP, p);
      addSkirt(D, x0, z1, x0, z0, -1, 0, DRY_Y - 0.04, WHEAT_TOP, p);
      addSkirt(D, x1, z0, x1, z1, 1, 0, DRY_Y - 0.04, WHEAT_TOP, p);
    } else addQuadGrid(D, p.x0, p.z0, p.x1, p.z1, DRY_Y + 0.05, 1e9, p, 0);
  }
  const paddies = new THREE.Mesh(W.geometry(), paddyMaterial(reflUniforms));
  paddies.name = 'paddies';
  paddies.receiveShadow = true;
  const dry = new THREE.Mesh(D.geometry(), dryMaterial());
  dry.name = 'dryfields';
  dry.receiveShadow = true;
  group.add(dry);

  // the crop ring: 25 cm cells to 13 m, 50 cm cells (clumps of four) out to 25 m
  const map = bakeFieldMap();
  const crops = new THREE.Group();
  crops.name = 'crops';
  for (const r of [
    { n: 104, blades: 7, ring: [0.25, 0, 11, 13, 1.0] },
    { n: 100, blades: 12, ring: [0.5, 12, 22, 25, 1.6] },
  ]) {
    const g = cropGeometry(r.blades);
    g.setAttribute('aCell', gridCells(r.n));
    g.instanceCount = r.n * r.n;
    const mesh = new THREE.Mesh(g, cropMaterial(map, r.ring, r.blades));
    mesh.frustumCulled = false;
    mesh.layers.set(1);
    mesh.receiveShadow = true;
    crops.add(mesh);
  }
  group.add(crops);

  // the ring only draws when the eye is down among the fields
  let bx0 = Infinity, bx1 = -Infinity, bz0 = Infinity, bz1 = -Infinity;
  for (const p of FIELDS) { bx0 = Math.min(bx0, p.x0); bx1 = Math.max(bx1, p.x1); bz0 = Math.min(bz0, p.z0); bz1 = Math.max(bz1, p.z1); }
  group.userData = {
    paddies, reflUniforms, map,
    update(camera) {
      const c = camera.position;
      const dx = Math.max(bx0 - c.x, 0, c.x - bx1), dz = Math.max(bz0 - c.z, 0, c.z - bz1);
      crops.visible = Math.hypot(dx, dz) < 26 && c.y < 22;
    },
  };
  return group;
}
