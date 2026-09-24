// 落英缤纷: fallen and falling peach petals, in layers.
//  - shed: every tree lets petals go from its crown; more let go when the wind rises (the release
//    time is checked against the same gust field that bends the branch tips), and a passing gust
//    pushes the ones in the air the same way.
//  - drift: a fine, sparse haze of petals far and mid-distance, only over the forest corridor.
//  - near: a handful of petals turning slowly in wide spirals close to the eye.
//  - water: petals riding the creek, thicker along the slack water by the banks.
//  - settled: petals lying under the trees, in drift lines at the water's edge and in the spring pool.
// No sparkle and no confetti: pale, realistic-size petals, slow tumbling, lit like the flowers.
import * as THREE from 'three';
import { Rng, clamp, smoothstep, lerp } from '../core/rng.js';
import { fbm2, perlin2 } from '../core/noise.js';
import { G, hook, TRANSLUCENT } from '../core/shared.js';
import { height, creekX, creekHW, creekDist, creekDir, WATER_OUT, SRC, FOREST } from './layout.js';
import { petalCanvas, canvas, bleed, tex } from './peach.js';
import { surfaceHeight } from './terrain.js';

// a small cupped petal: 2 across x 3 along, base at v=0
function petalGeometry(simple = false) {
  const P = [], UV = [], I = [];
  const rows = simple ? 2 : 3;
  for (let c = 0; c < rows; c++) for (let l = 0; l <= 1; l++) {
    const v = c / (rows - 1);
    const w = (l - 0.5) * 0.82 * (0.55 + 0.45 * Math.sin(v * Math.PI * 0.9 + 0.2));
    P.push(w, v - 0.5, -((l - 0.5) ** 2) * 0.3 + (v - 0.5) ** 2 * 0.12);
    UV.push(l, v);
  }
  for (let c = 0; c < rows - 1; c++) {
    const a = c * 2;
    I.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(P.length).fill(0).map((_, i) => (i % 3 === 2 ? 1 : 0)), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  g.setIndex(I);
  return g;
}

function petalTexture() {
  const t = tex(petalCanvas());
  t.anisotropy = 4;
  return t;
}

// fallen petals seen from above, 4 x 2 cells of 512 px, each about a metre of ground:
// 0-2 gathered drifts (dense heart, thinning out), 3-5 loose scatter, 6-7 strand lines left by the water
function scatterAtlas() {
  const S = 512, c = canvas(S * 4, S * 2), ctx = c.getContext('2d'), rng = new Rng(4242);
  const src = petalCanvas();
  // a few tinted and aged versions of the petal
  const tints = [[255, 236, 240, 0.0], [255, 214, 224, 0.22], [236, 128, 160, 0.22], [214, 150, 150, 0.2], [176, 136, 112, 0.34]];
  const sprites = tints.map(([r, g, b, a]) => {
    const k = canvas(128, 128), x = k.getContext('2d');
    x.drawImage(src, 0, 0);
    x.globalCompositeOperation = 'source-atop';
    x.fillStyle = `rgba(${r},${g},${b},${a})`;
    x.fillRect(0, 0, 128, 128);
    return k;
  });
  const drop = (cx, cy, size) => {
    const k = rng.next();
    const sp = sprites[k < 0.42 ? 0 : k < 0.7 ? 1 : k < 0.84 ? 2 : k < 0.94 ? 3 : 4];
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rng.range(0, 6.28));
    // foreshortened: many lie tilted or curled
    ctx.scale(size * rng.range(0.55, 1.0), size);
    ctx.drawImage(sp, -0.5, -0.5, 1, 1);
    ctx.restore();
  };
  const P = 17; // a petal is ~3.4 cm on a metre-wide cell
  for (let cell = 0; cell < 8; cell++) {
    const ox = (cell % 4) * S, oy = Math.floor(cell / 4) * S;
    ctx.save();
    ctx.beginPath(); ctx.rect(ox, oy, S, S); ctx.clip();
    const drift = cell < 3, strand = cell >= 6;
    const n = drift ? 700 + cell * 150 : strand ? 520 : 150 + (cell - 3) * 70;
    for (let i = 0; i < n; i++) {
      let x, y;
      if (drift) {
        // an irregular heap: a couple of lobes, dense at the heart
        const lobe = rng.int(0, 2);
        const lx = [0.5, 0.36, 0.64][lobe], ly = [0.5, 0.42, 0.6][lobe], sd = [0.13, 0.09, 0.1][lobe];
        x = lx + rng.gauss() * sd; y = ly + rng.gauss() * sd * 1.2;
      } else if (strand) {
        // a wavy line along the cell's long axis (v), a few petals wide, with gaps
        y = rng.next();
        if (Math.sin(y * 17 + cell) > 0.75 && rng.next() < 0.7) continue;
        x = 0.5 + Math.sin(y * 9.4 + cell * 2) * 0.09 + rng.gauss() * 0.06;
      } else {
        x = rng.next(); y = rng.next();
      }
      // keep clear of the cell edges so the quads never show a border
      const e = Math.min(x, 1 - x, y, 1 - y);
      if (e < 0.02 || rng.next() > smoothstep(0.02, 0.14, e)) continue;
      drop(ox + x * S, oy + y * S, P * rng.range(0.8, 1.25));
    }
    ctx.restore();
  }
  bleed(ctx, c.width, c.height);
  const t = tex(c);
  t.anisotropy = 8;
  return t;
}

// shared material shell: the system's vertex code sets ptP (world position) and ptN (world normal),
// plus vFade for a dithered fade; lighting, shadows and atmosphere are the standard ones
function petalMaterial(map, key, head, body, uniforms = {}, texSize = null) {
  const m = new THREE.MeshStandardMaterial({ map, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.6, metalness: 0 });
  m.alphaToCoverage = true;
  m.userData.uniforms = uniforms;
  return hook(m, key, (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
      varying float vFade, vTone;
      ${head}`)
      .replace('#include <beginnormal_vertex>', `
      vec3 ptP, ptN;
      vFade = 1.0; vTone = 1.0;
      { ${body} }
      vec3 objectNormal = ptN;`)
      .replace('#include <begin_vertex>', 'vec3 transformed = ptP;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
      varying float vFade, vTone;
      float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }`)
      .replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb *= vTone;')
      .replace('#include <alphatest_fragment>', `${texSize ? `
      {
        // mip levels average the petals' alpha away: sharpen it back as the texture minifies
        vec2 ts = vMapUv * vec2(${texSize[0].toFixed(1)}, ${texSize[1].toFixed(1)});
        float lod = 0.5 * log2(max(dot(dFdx(ts), dFdx(ts)), dot(dFdy(ts), dFdy(ts))));
        diffuseColor.a *= 1.0 + max(lod, 0.0) * 0.35;
      }` : ''}
      #include <alphatest_fragment>
      if (vFade < 0.01 || ign(gl_FragCoord.xy) > vFade) discard;`)
      .replace('#include <lights_fragment_begin>', `#include <lights_fragment_begin>
      {
        ${TRANSLUCENT}
        reflectedLight.directDiffuse += sunC * diffuseColor.rgb * (sunBack * 1.6 + sunWrap * 0.3);
        // thin petals glow with the light through them (as the blossom cards do)
        totalEmissiveRadiance += diffuseColor.rgb * uAmbK * 0.14 * (1.0 - 0.7 * uNight);
      }`);
  });
}

function mesh(geo, mat, name, count) {
  geo.instanceCount = count;
  const m = new THREE.Mesh(geo, mat);
  m.frustumCulled = false;
  m.name = name;
  m.layers.set(1); // not in the water reflection
  m.receiveShadow = true;
  return m;
}

const SIZE = 0.036; // a peach petal is about 2 cm; a little larger reads as petals at a few metres

export function buildPetals(trees) {
  const group = new THREE.Group();
  group.name = 'petals';
  const map = petalTexture();
  const atlas = scatterAtlas();
  const rng = new Rng(808);

  // ---------------------------------------------------------------- shed from the crowns
  {
    const per = 80;
    const n = trees.length * per;
    const orig = new Float32Array(n * 4), seed = new Float32Array(n * 4), axis = new Float32Array(n * 4);
    let k = 0;
    for (const t of trees) {
      const c = t.centre, r = t.radius;
      for (let i = 0; i < per; i++, k++) {
        const a = rng.range(0, 6.28), d = Math.sqrt(rng.next()) * r * 0.85;
        const x = c.x + Math.cos(a) * d, z = c.z + Math.sin(a) * d;
        const y = c.y + rng.range(-1.1, 1.3);
        orig.set([x, y, z, Math.max(surfaceHeight(x, z), WATER_OUT) + 0.04], k * 4);
        seed.set([rng.next(), rng.next(), rng.next(), rng.next()], k * 4);
        const v = new THREE.Vector3(rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)).normalize();
        axis.set([v.x, v.y, v.z, rng.range(0.6, 1.3)], k * 4);
      }
    }
    const g = petalGeometry();
    g.setAttribute('aOrig', new THREE.InstancedBufferAttribute(orig, 4));
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
    g.setAttribute('aAxis', new THREE.InstancedBufferAttribute(axis, 4));
    const mat = petalMaterial(map, 'petals-shed', 'attribute vec4 aOrig, aSeed, aAxis;', `
      float fallH = max(aOrig.y - aOrig.w, 0.5);
      float vfall = 0.72 + aSeed.w * 0.45;
      float dur = fallH / vfall;
      float cyc = dur + 1.5 + aSeed.z * 6.0;
      float life = mod(uTime + aSeed.x * 97.0, cyc);
      float k = clamp(life / dur, 0.0, 1.0);
      // let go more often when it was blowing at the moment of release
      float gRel = windGustAt(aOrig.xyz, uTime - life);
      float relOn = step(aSeed.y, smoothstep(0.25, 0.95, gRel) * 0.9 + 0.08 + uPetalStorm * 0.5);
      vec3 wind = vec3(uWind.x, 0.0, uWind.y);
      float air = min(life, dur);
      // carried by the wind it has met so far (a coarse integral, so a passing gust pushes and doesn't pull back)
      float gm = (gRel + windGustAt(aOrig.xyz, uTime - life + air * 0.5) + windGustAt(aOrig.xyz, uTime - life + air)) / 3.0;
      vec3 p = aOrig.xyz + wind * air * (0.3 + 0.85 * gm);
      p += vec3(sin(air * 1.7 + aSeed.y * 20.0), 0.0, cos(air * 1.3 + aSeed.z * 20.0)) * 0.35 * (1.0 - k * 0.7);
      p.y = mix(aOrig.y, aOrig.w, k) + sin(air * 2.3 + aSeed.w * 9.0) * 0.08 * (1.0 - k);
      float t = air * aAxis.w;
      mat3 R = rotAxis(aAxis.xyz, t * 2.2 + aSeed.w * 6.28);
      // they vanish as they touch down: the settled layer is what lies on the ground
      float d = distance(cameraPosition, p);
      float sc = ${SIZE.toFixed(3)} * (0.85 + aSeed.w * 0.35) * clamp(1.0 + (d - 6.0) * 0.035, 1.0, 2.6);
      sc *= smoothstep(0.0, 0.3, life) * (1.0 - smoothstep(dur - 0.35, dur, life)) * relOn * uPetalAmt;
      ptP = p + R * (position * sc);
      ptN = R * vec3(0.0, 0.0, 1.0);
      vFade = 1.0 - smoothstep(90.0, 130.0, d);
      vTone = 0.9 + aSeed.w * 0.2;
      if (sc < 1e-5) ptP = vec3(0.0, -1e4, 0.0);`);
    group.add(mesh(g, mat, 'petals-shed', n));
  }

  // ---------------------------------------------------------------- fine drift over the forest corridor
  {
    const n = 3600;
    const seed = new Float32Array(n * 4), axis = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      seed.set([rng.next(), rng.next(), rng.next(), rng.next()], i * 4);
      const v = new THREE.Vector3(rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)).normalize();
      axis.set([v.x, v.y, v.z, rng.range(0.6, 1.3)], i * 4);
    }
    const g = petalGeometry(true);
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
    g.setAttribute('aAxis', new THREE.InstancedBufferAttribute(axis, 4));
    const mat = petalMaterial(map, 'petals-drift', 'attribute vec4 aSeed, aAxis; uniform vec3 uBox;', `
      vec3 wind = vec3(uWind.x, 0.0, uWind.y);
      vec3 p = aSeed.xyz * uBox;
      float t = uTime * aAxis.w;
      float g = windGust(cameraPosition + p - uBox * 0.5);
      p += wind * uTime * (0.55 + aSeed.w * 0.5) * (0.75 + 0.35 * g);
      p.y -= uTime * (0.45 + aSeed.w * 0.4);
      p.x += sin(t * 1.3 + aSeed.w * 30.0) * 0.8; p.z += cos(t * 1.1 + aSeed.x * 20.0) * 0.8;
      vec3 lo = cameraPosition - uBox * vec3(0.5, 0.35, 0.5);
      vec3 w = mod(p - lo, uBox) + lo;
      vec3 rel = (w - cameraPosition) / (uBox * 0.5);
      float edge = 1.0 - smoothstep(0.7, 1.0, max(abs(rel.x), abs(rel.z)));
      edge *= smoothstep(-0.7, -0.5, rel.y) * (1.0 - smoothstep(0.8, 1.0, rel.y));
      // only where the trees are, and never inside the hill or below the water
      float mask = forestMaskGL(w.xz) * uPetalAmt * step(${(WATER_OUT + 0.1).toFixed(1)}, w.y);
      float d = distance(cameraPosition, w);
      mask *= smoothstep(4.0, 10.0, d);
      mat3 R = rotAxis(aAxis.xyz, t * 1.8 + aSeed.w * 6.28);
      float sc = ${SIZE.toFixed(3)} * (0.8 + aSeed.w * 0.4) * clamp(1.0 + (d - 6.0) * 0.04, 1.0, 3.2) * edge * mask;
      ptP = w + R * (position * sc);
      ptN = R * vec3(0.0, 0.0, 1.0);
      vTone = 0.92 + aSeed.w * 0.16;
      if (sc < 1e-5) ptP = vec3(0.0, -1e4, 0.0);`, { uBox: { value: new THREE.Vector3(110, 26, 110) } }, [128, 128]);
    group.add(mesh(g, mat, 'petals-drift', n));
  }

  // ---------------------------------------------------------------- 桃花满天飞: the air full of petals
  // (as the reference's falling layer: a box of petals that travels with the eye, only over the trees,
  // thickened by the chapter's uPetalStorm; each petal switches on at its own storm level, so a light
  // storm is sparser rather than smaller)
  {
    const n = 13000;
    const seed = new Float32Array(n * 4), axis = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      seed.set([rng.next(), rng.next(), rng.next(), rng.next()], i * 4);
      const v = new THREE.Vector3(rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)).normalize();
      axis.set([v.x, v.y, v.z, rng.range(0.6, 1.4)], i * 4);
    }
    const g = petalGeometry(true);
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
    g.setAttribute('aAxis', new THREE.InstancedBufferAttribute(axis, 4));
    const mat = petalMaterial(map, 'petals-storm', 'attribute vec4 aSeed, aAxis; uniform vec3 uBox;', `
      float on = smoothstep(aSeed.y * 0.95, aSeed.y * 0.95 + 0.05, uPetalStorm) * uPetalAmt;
      vec3 wind = vec3(uWind.x, 0.0, uWind.y);
      vec3 p = vec3(aSeed.x, fract(aSeed.z * 7.31 + aSeed.w), aSeed.z) * uBox;
      float t = uTime * aAxis.w;
      float g = windGust(cameraPosition + p - uBox * 0.5);
      // carried on the wind (a gust sweeps them along), falling a little under a metre a second, fluttering
      p += wind * uTime * (1.0 + aSeed.w * 0.9) * (0.7 + 0.6 * g);
      p.y -= uTime * (0.5 + aSeed.w * 0.55);
      p.x += sin(t * 1.7 + aSeed.w * 30.0) * 0.7; p.z += cos(t * 1.3 + aSeed.x * 20.0) * 0.7;
      p.y += sin(t * 0.9 + aSeed.y * 40.0) * 0.35;
      vec3 lo = cameraPosition - uBox * vec3(0.5, 0.3, 0.5);
      vec3 w = mod(p - lo, uBox) + lo;
      vec3 rel = (w - cameraPosition) / (uBox * 0.5);
      float edge = 1.0 - smoothstep(0.72, 1.0, max(abs(rel.x), abs(rel.z)));
      edge *= smoothstep(-0.6, -0.45, rel.y) * (1.0 - smoothstep(1.1, 1.4, rel.y));
      float mask = forestMaskGL(w.xz) * step(${(WATER_OUT + 0.05).toFixed(2)}, w.y) * on;
      float d = distance(cameraPosition, w);
      mask *= smoothstep(0.7, 1.8, d);
      mat3 R = rotAxis(aAxis.xyz, t * 2.6 + aSeed.w * 6.28);
      float sc = ${(SIZE * 2.7).toFixed(3)} * (0.8 + aSeed.w * 0.5) * clamp(1.0 + (d - 5.0) * 0.05, 1.0, 3.0) * edge * mask;
      ptP = w + R * (position * sc);
      ptN = R * vec3(0.0, 0.0, 1.0);
      vTone = 0.88 + aSeed.w * 0.24;
      if (sc < 1e-5) ptP = vec3(0.0, -1e4, 0.0);`, { uBox: { value: new THREE.Vector3(58, 22, 58) } }, [128, 128]);
    group.add(mesh(g, mat, 'petals-storm', n));
  }

  // ---------------------------------------------------------------- a few slow spirals near the eye
  {
    const n = 28;
    const seed = new Float32Array(n * 4), axis = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      seed.set([rng.next(), rng.next(), rng.next(), rng.next()], i * 4);
      const v = new THREE.Vector3(rng.range(-1, 1), rng.range(-0.4, 0.4), rng.range(-1, 1)).normalize();
      axis.set([v.x, v.y, v.z, rng.range(0.5, 0.9)], i * 4);
    }
    const g = petalGeometry();
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
    g.setAttribute('aAxis', new THREE.InstancedBufferAttribute(axis, 4));
    const mat = petalMaterial(map, 'petals-near', 'attribute vec4 aSeed, aAxis; uniform vec3 uBox; uniform float uNearAmt;', `
      vec3 wind = vec3(uWind.x, 0.0, uWind.y);
      vec3 p = aSeed.xyz * uBox;
      float t = uTime * aAxis.w;
      p += wind * uTime * 0.35;
      p.y -= uTime * (0.22 + aSeed.w * 0.16);
      float ang = t * (1.1 + aSeed.w * 0.6) + aSeed.x * 6.28;
      float rr = 0.25 + aSeed.z * 0.3;
      p.x += cos(ang) * rr; p.z += sin(ang) * rr;
      vec3 lo = cameraPosition - uBox * vec3(0.5, 0.5, 0.5);
      vec3 w = mod(p - lo, uBox) + lo;
      vec3 rel = (w - cameraPosition) / (uBox * 0.5);
      float edge = (1.0 - smoothstep(0.6, 1.0, length(rel.xz))) * (1.0 - smoothstep(0.7, 1.0, abs(rel.y)));
      float d = distance(cameraPosition, w);
      edge *= smoothstep(0.45, 1.2, d);
      // occasional: each petal only flies part of the time
      float on = smoothstep(0.55, 0.7, sin(uTime * 0.13 + aSeed.y * 40.0) * 0.5 + 0.5);
      float mask = forestMaskGL(cameraPosition.xz) * uPetalAmt * uNearAmt * on;
      // a slow flip about the spiral, a leaf-like sway
      mat3 R = rotAxis(aAxis.xyz, ang * 0.7 + sin(t * 2.0) * 0.6);
      float sc = ${(SIZE * 1.05).toFixed(3)} * edge * mask;
      ptP = w + R * (position * sc);
      ptN = R * vec3(0.0, 0.0, 1.0);
      vTone = 0.95 + aSeed.w * 0.1;
      if (sc < 1e-5) ptP = vec3(0.0, -1e4, 0.0);`, { uBox: { value: new THREE.Vector3(9, 5, 9) }, uNearAmt: { value: 1 } });
    group.add(mesh(g, mat, 'petals-near', n));
  }

  // ---------------------------------------------------------------- riding the creek
  {
    const n = 8000;
    const seed = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const across = rng.next() < 0.55 ? rng.sign() * rng.range(0.62, 0.97) : rng.range(-0.7, 0.7);
      seed.set([rng.next(), across, rng.next(), rng.next()], i * 4);
    }
    const g = petalGeometry(true);
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
    const mat = petalMaterial(map, 'petals-water', 'attribute vec4 aSeed; uniform vec2 uZ;', `
      float across = aSeed.y;
      float speed = (0.12 + 0.55 * (1.0 - across * across)) * (0.8 + aSeed.w * 0.4);
      float span = uZ.y - uZ.x;
      float z = uZ.x + mod(aSeed.x * span + uTime * speed, span);
      vec2 cw = creekAt(z);
      // the channel narrows toward the spring: keep to the water
      float x = cw.x + across * cw.y * 0.97 + sin(uTime * 0.35 + aSeed.z * 30.0) * 0.18;
      float fade = smoothstep(0.0, 6.0, z - uZ.x) * (1.0 - smoothstep(span - 10.0, span, z - uZ.x));
      // thick in the forest reach, thinning as they float away downstream
      fade *= step(aSeed.z, 1.0 - smoothstep(${FOREST.z1 - 20}.0, ${FOREST.z1 + 140}.0, z) * 0.9);
      float rot = aSeed.z * 6.28 + uTime * (aSeed.w - 0.5) * 0.5;
      mat3 R = rotAxis(vec3(0.0, 1.0, 0.0), rot) * rotAxis(vec3(1.0, 0.0, 0.0), -1.5708 + (aSeed.w - 0.5) * 0.4);
      float bob = sin(uTime * 1.6 + aSeed.x * 40.0) * 0.006;
      vec3 w = vec3(x, ${WATER_OUT.toFixed(2)} + 0.018 + bob, z);
      float d = distance(cameraPosition, w);
      float sc = ${SIZE.toFixed(3)} * (0.85 + aSeed.w * 0.35) * clamp(1.0 + (d - 6.0) * 0.045, 1.0, 3.2) * fade * uPetalAmt;
      ptP = w + R * (position * sc);
      ptN = R * vec3(0.0, 0.0, 1.0);
      vFade = 1.0 - smoothstep(70.0, 110.0, d);
      vTone = 0.86 + aSeed.w * 0.2;
      if (sc < 1e-5) ptP = vec3(0.0, -1e4, 0.0);`, { uZ: { value: new THREE.Vector2(SRC.z + 6, FOREST.z1 + 170) } });
    group.add(mesh(g, mat, 'petals-water', n));
  }

  // ---------------------------------------------------------------- rafts: loose mats of petals carried on the water
  {
    const n = 700;
    const seed = new Float32Array(n * 4), shape = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      // most keep to the slack water along the banks
      const across = rng.next() < 0.7 ? rng.sign() * rng.range(0.55, 0.92) : rng.range(-0.55, 0.55);
      seed.set([rng.next(), across, rng.next(), rng.next()], i * 4);
      const w = rng.range(0.5, 1.3);
      // loose scatter, or strung out in lines along the current: never a heap, the water spreads them
      const strand = rng.next() < 0.35;
      shape.set([strand ? w * 0.6 : w, strand ? w * rng.range(1.6, 2.6) : w * rng.range(0.7, 1.4), strand ? rng.int(6, 7) : rng.int(3, 5), rng.range(0.85, 1.05)], i * 4);
    }
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, -0.5, 0.5, 0, -0.5, -0.5, 0, 0.5, 0.5, 0, 0.5], 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2));
    g.setIndex([0, 2, 1, 1, 2, 3]);
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
    g.setAttribute('aShape', new THREE.InstancedBufferAttribute(shape, 4));
    const mat = petalMaterial(atlas, 'petals-rafts', 'attribute vec4 aSeed, aShape; uniform vec2 uZ;', `
      float across = aSeed.y;
      float speed = (0.1 + 0.5 * (1.0 - across * across)) * (0.8 + aSeed.w * 0.4);
      float span = uZ.y - uZ.x;
      float z = uZ.x + mod(aSeed.x * span + uTime * speed, span);
      vec2 cw = creekAt(z);
      float x = cw.x + across * cw.y + sin(uTime * 0.21 + aSeed.z * 30.0) * 0.25;
      float fade = smoothstep(0.0, 8.0, z - uZ.x) * (1.0 - smoothstep(span - 14.0, span, z - uZ.x));
      fade *= step(aSeed.z, 1.0 - smoothstep(${FOREST.z1 - 30}.0, ${FOREST.z1 + 130}.0, z) * 0.95);
      // lined up with the current, turning a little where it eddies
      vec2 cw2 = creekAt(z + 2.0);
      float dir = atan(cw2.x - cw.x, 2.0);
      mat3 R = rotAxis(vec3(0.0, 1.0, 0.0), dir + sin(uTime * 0.07 + aSeed.w * 20.0) * 0.5 * abs(across));
      vec3 w = vec3(x, ${WATER_OUT.toFixed(2)} + 0.02, z);
      float cell = aShape.z;
      vMapUv = vec2((mod(cell, 4.0) + uv.x) / 4.0, 1.0 - (floor(cell / 4.0) + 1.0) / 2.0 + uv.y / 2.0);
      ptP = w + R * (position * vec3(aShape.x, 1.0, aShape.y) * fade * uPetalAmt);
      ptN = vec3(0.0, 1.0, 0.0);
      float d = distance(cameraPosition, w);
      vFade = 1.0 - smoothstep(80.0, 120.0, d);
      vTone = aShape.w;`, { uZ: { value: new THREE.Vector2(SRC.z + 8, FOREST.z1 + 160) } }, [2048, 1024]);
    group.add(mesh(g, mat, 'petals-rafts', n));
  }

  // ---------------------------------------------------------------- drifts: patches of fallen petals laid on the ground
  // (the texture carries hundreds of petals per square metre, which instances can't afford; the
  // single 3D petals below add the curl and the depth close up)
  {
    const W = G.uWind.value;
    const patches = [];
    for (const t of trees) {
      const c = t.centre, R = t.radius;
      const cx = c.x + W.x * 0.5, cz = c.z + W.y * 0.5;
      const n = Math.round(rng.range(4, 9) * Math.min(1.6, (R / 3.6) ** 2)) + 2;
      for (let i = 0; i < n; i++) {
        const heap = rng.next() < 0.45;
        const a = rng.range(0, 6.28), r = (heap ? rng.range(0.1, 0.8) : Math.sqrt(rng.next()) * 1.15) * R;
        const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
        if (creekDist(x, z) < 0.5) continue;
        const w = heap ? rng.range(0.6, 1.3) : rng.range(1.0, 1.9);
        patches.push({ x, z, w, l: w * rng.range(0.8, 1.3), rot: rng.range(0, 6.28), cell: heap ? rng.int(0, 2) : rng.int(3, 5), tone: rng.range(0.86, 1.04) });
      }
    }
    // strand lines at the waterline, in runs
    for (const side of [-1, 1]) {
      for (let z = FOREST.z0 - 6; z < FOREST.z1 + 36;) {
        const k = perlin2(z * 0.05 + side * 3, 1.7) * 0.5 + 0.5;
        const len = rng.range(1.2, 2.2);
        if (rng.next() < smoothstep(0.3, 0.7, k)) {
          let e = creekX(z) + side * creekHW(z) * 0.5;
          for (let i = 0; i < 160; i++, e += side * 0.1) if (height(e, z) > WATER_OUT) break;
          const d = creekDir(z);
          patches.push({ x: e + side * rng.range(-0.25, 0.15), z, w: rng.range(0.45, 0.8), l: len, rot: Math.atan2(-d.x, d.z) + rng.range(-0.15, 0.15), cell: rng.int(6, 7), tone: rng.range(0.9, 1.04) });
        }
        z += len * rng.range(0.7, 2.6) / (0.3 + k);
      }
    }
    // loose rafts turning slowly at the edge of the spring pool
    for (let i = 0; i < 10; i++) {
      const a = rng.range(0, 6.28), r = SRC.r * rng.range(0.55, 0.85);
      patches.push({ x: SRC.x + Math.cos(a) * r, z: SRC.z + Math.sin(a) * r, w: rng.range(0.7, 1.2), l: rng.range(0.7, 1.2), rot: rng.range(0, 6.28), cell: rng.int(3, 5), tone: 1 });
    }

    const mat = new THREE.MeshStandardMaterial({ map: atlas, vertexColors: true, alphaTest: 0.5, roughness: 0.72, metalness: 0,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
    mat.alphaToCoverage = true;
    hook(mat, 'petal-drifts', (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWP;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
        varying vec3 vWP;
        float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }`)
        // mip levels average the petals' alpha away: sharpen it back as the texture minifies
        .replace('#include <alphatest_fragment>', `
        {
          vec2 ts = vMapUv * vec2(2048.0, 1024.0);
          float lod = 0.5 * log2(max(dot(dFdx(ts), dFdx(ts)), dot(dFdy(ts), dFdy(ts))));
          diffuseColor.a *= 1.0 + max(lod, 0.0) * 0.35;
        }
        #include <alphatest_fragment>
        if (ign(gl_FragCoord.xy) > (1.0 - smoothstep(50.0, 78.0, distance(cameraPosition, vWP))) * uPetalAmt) discard;`);
    });

    const N = 4, CH = 40, cells = new Map();
    for (const p of patches) {
      const key = Math.floor(p.x / CH) + ':' + Math.floor(p.z / CH);
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(p);
    }
    const chunks = [];
    for (const list of cells.values()) {
      const pos = [], nor = [], uv = [], col = [], idx = [];
      for (const p of list) {
        const base = pos.length / 3;
        const ca = Math.cos(p.rot), sa = Math.sin(p.rot);
        const cu = (p.cell % 4) / 4, row = Math.floor(p.cell / 4);
        for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
          const u = i / N, v = j / N;
          const lx = (u - 0.5) * p.w, lz = (v - 0.5) * p.l;
          const x = p.x + lx * ca - lz * sa, z = p.z + lx * sa + lz * ca;
          pos.push(x, Math.max(surfaceHeight(x, z) + 0.016, WATER_OUT + 0.02), z);
          nor.push(0, 1, 0);
          uv.push(cu + u / 4, 1 - (row + 1) / 2 + v / 2);
          col.push(p.tone, p.tone, p.tone);
        }
        for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
          const a = base + j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1;
          idx.push(a, c, b, b, c, d);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.setIndex(idx);
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mat);
      m.name = 'petal-drifts';
      m.layers.set(1);
      m.receiveShadow = true;
      chunks.push(m);
      group.add(m);
    }
    group.userData.drifts = chunks;
    group.userData.driftCount = patches.length;
  }

  // ---------------------------------------------------------------- settled: under trees, along the edge, in the pool
  {
    const pts = [];
    const onGround = (x, z) => [x, Math.max(surfaceHeight(x, z), WATER_OUT) + 0.014, z, rng.next()];
    const W = G.uWind.value;
    for (const t of trees) {
      const c = t.centre, R = t.radius;
      // downwind of the crown a little more
      const cx = c.x + W.x * 0.6, cz = c.z + W.y * 0.6;
      // a thin uneven scatter over the drip area, broken by the grass...
      const n = Math.round(300 * Math.min(1.8, (R / 3.6) ** 2)); // (the big bank trees would otherwise lay ~1000 each)
      for (let i = 0; i < n; i++) {
        const a = rng.range(0, 6.28), r = Math.sqrt(rng.next()) * R * 1.35;
        const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
        const m = smoothstep(-0.25, 0.45, fbm2(x * 0.55, z * 0.55, 2) + 0.35 * perlin2(x * 2.3, z * 2.3)) * (1 - smoothstep(0.75, 1.35, r / R));
        if (rng.next() > m) continue;
        if (creekDist(x, z) < 0.1) continue;
        pts.push(onGround(x, z));
      }
      // ...and a few drifts where they gathered: in hollows, against the roots, on the lee side
      const clumps = rng.int(3, 7);
      for (let k = 0; k < clumps; k++) {
        const a = rng.range(0, 6.28), r = rng.range(0.2, 1.1) * R;
        const kx = cx + Math.cos(a) * r, kz = cz + Math.sin(a) * r;
        if (creekDist(kx, kz) < 0.4) continue;
        const sx = rng.range(0.18, 0.6), sz = sx * rng.range(0.5, 1.6), rot = rng.range(0, 3.14);
        const cnt = rng.int(40, 140);
        for (let i = 0; i < cnt; i++) {
          const u = rng.gauss() * sx, v = rng.gauss() * sz;
          const x = kx + u * Math.cos(rot) - v * Math.sin(rot), z = kz + u * Math.sin(rot) + v * Math.cos(rot);
          pts.push(onGround(x, z));
        }
      }
    }
    // drift lines at the water's edge, where the current sets them ashore: find the real waterline
    const edge = new Map();
    const waterline = (zq, side) => {
      const key = zq * 2 + (side > 0 ? 1 : 0);
      if (edge.has(key)) return edge.get(key);
      const cx = creekX(zq);
      let e = cx + side * creekHW(zq) * 0.5;
      for (let i = 0; i < 160; i++, e += side * 0.1) if (height(e, zq) > WATER_OUT) break;
      edge.set(key, e);
      return e;
    };
    for (let i = 0; i < 26000; i++) {
      const z = rng.range(FOREST.z0 - 6, FOREST.z1 + 40);
      const side = rng.sign();
      const k = smoothstep(0.35, 0.8, perlin2(z * 0.07 + (side > 0 ? 7 : 0), 3.3) * 0.5 + 0.5 + perlin2(z * 0.4, side * 5) * 0.25);
      if (rng.next() > k) continue;
      // a band a hand's width to a metre wide: mostly on the wet margin, some caught on the water
      const off = (rng.gauss() * 0.28 + 0.1) * (0.4 + k);
      const zq = Math.round(z * 2) / 2;
      const x = waterline(zq, side) + side * off;
      const y = Math.max(surfaceHeight(x, z) + 0.014, WATER_OUT + 0.016);
      pts.push([x, y, z, rng.next()]);
    }
    // the spring pool: a slow ring of petals on the still water
    for (let i = 0; i < 900; i++) {
      const a = rng.range(0, 6.28), r = SRC.r * Math.sqrt(rng.range(0.35, 1.05));
      const x = SRC.x + Math.cos(a) * r, z = SRC.z + Math.sin(a) * r;
      if (surfaceHeight(x, z) > WATER_OUT - 0.02) continue;
      pts.push([x, WATER_OUT + 0.016, z, rng.next()]);
    }

    // chunks of 40 m, so the ones behind the camera or far away aren't drawn at all
    const CH = 40, cells = new Map();
    for (const p of pts) {
      const key = Math.floor(p[0] / CH) + ':' + Math.floor(p[2] / CH);
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(p);
    }
    const mat = petalMaterial(map, 'petals-settled', 'attribute vec4 aP;', `
      float h = aP.w;
      mat3 R = rotAxis(vec3(0.0, 1.0, 0.0), h * 40.0) * rotAxis(vec3(1.0, 0.0, 0.0), -1.5708 + (fract(h * 17.0) - 0.5) * 0.5);
      float d = distance(cameraPosition, aP.xyz);
      float sc = ${SIZE.toFixed(3)} * (0.75 + fract(h * 13.0) * 0.5) * clamp(1.0 + (d - 10.0) * 0.02, 1.0, 1.6);
      // an occasional stir as a gust passes
      float g = windGust(aP.xyz);
      vec3 stir = vec3(uWind.x, 0.0, uWind.y) * max(0.0, g - 1.0) * 0.12 * step(0.7, fract(h * 29.0));
      ptP = aP.xyz + R * (position * sc) + stir;
      ptN = R * vec3(0.0, 0.0, 1.0);
      vFade = (1.0 - smoothstep(40.0, 62.0, d)) * uPetalAmt;
      // older petals pale and brown a little
      vTone = 0.82 + fract(h * 7.0) * 0.26;`);
    const chunks = [];
    for (const list of cells.values()) {
      const P = new Float32Array(list.length * 4);
      const box = new THREE.Box3();
      list.forEach((p, i) => { P.set(p, i * 4); box.expandByPoint(new THREE.Vector3(p[0], p[1], p[2])); });
      const g = petalGeometry(true);
      g.setAttribute('aP', new THREE.InstancedBufferAttribute(P, 4));
      g.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
      g.boundingSphere.radius += 0.5;
      const m = mesh(g, mat, 'petals-settled', list.length);
      m.frustumCulled = true;
      chunks.push(m);
      group.add(m);
    }
    group.userData.settledCount = pts.length;
    group.userData.update = (camera) => {
      for (const m of chunks) {
        const s = m.geometry.boundingSphere;
        m.visible = s.center.distanceTo(camera.position) - s.radius < 64;
      }
      for (const m of group.userData.drifts) {
        const s = m.geometry.boundingSphere;
        m.visible = s.center.distanceTo(camera.position) - s.radius < 80;
      }
    };
  }
  return group;
}
