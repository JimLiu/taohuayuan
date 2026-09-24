// Shared uniforms and GLSL: one wind field, one atmosphere, one sun, used by every material.
// (Pattern borrowed from the Sakura River Valley reference: patch three's fog chunks so every
// built-in material gets aerial perspective, and inject the same uniforms into all programs.)
import * as THREE from 'three';

export const SUN_DIR = new THREE.Vector3(0.84, 0.54, 0.08).normalize();

export const G = {
  uTime: { value: 0 },
  uSunDir: { value: SUN_DIR.clone() },
  uSunCol: { value: new THREE.Vector3(3.2, 2.85, 2.35) },
  uFogCool: { value: new THREE.Vector3(0.62, 0.72, 0.8) },
  uFogWarm: { value: new THREE.Vector3(0.98, 0.9, 0.78) },
  uFogParams: { value: new THREE.Vector4(0.0016, 0.028, 0, 0.00018) }, // density, falloff, base y, haze
  uWind: { value: new THREE.Vector4(-0.55, -0.83, 1, 0) },              // dir.xy (toward the mountain), strength
  uGust: { value: new THREE.Vector4(0, 0, 0, 0) },                      // front pos along wind, strength, width
  uReflect: { value: 0 },
  uMist: { value: 1 },
  uAmbK: { value: new THREE.Vector3(1, 1, 1) },
  uNight: { value: 0 },
  uSunVis: { value: 1 },
  uSkyZen: { value: new THREE.Vector3(0.3, 0.46, 0.66) },
  uSkyUp: { value: new THREE.Vector3(0.58, 0.7, 0.8) },
  uCloudLit: { value: new THREE.Vector3(1.25, 1.2, 1.12) },
  uCloudShade: { value: new THREE.Vector3(0.62, 0.66, 0.74) },
  uHorizonGlow: { value: new THREE.Vector3(1.0, 0.86, 0.7) },
  uPetalAmt: { value: 1 },
  uPetalStorm: { value: 0 }, // 桃花满天飞: the whole air full of petals where the story passes under the trees
  uCreekTex: { value: null },
  uLampOn: { value: 0 },
  uWaterLv: { value: new THREE.Vector2(8.0, -0.2) }, // outside creek, basin water
};

export const COMMON = /* glsl */ `
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uFogCool;
uniform vec3 uFogWarm;
uniform vec4 uFogParams;
uniform vec4 uWind;
uniform vec4 uGust;
uniform float uReflect;
uniform float uMist;
uniform vec3 uAmbK;
uniform float uNight, uSunVis, uPetalAmt, uPetalStorm, uLampOn;
uniform vec3 uSkyZen, uSkyUp, uCloudLit, uCloudShade, uHorizonGlow;
uniform sampler2D uCreekTex;
uniform vec2 uWaterLv;

float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash13(vec3 p3){ p3 = fract(p3 * .1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash12(i), hash12(i+vec2(1,0)), u.x), mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), u.x), u.y); }
float fbm3(vec2 p){ return vnoise(p)*0.55 + vnoise(p*2.03+7.1)*0.28 + vnoise(p*4.11-3.7)*0.17; }

// creek centre x and half width by z (z in -100..1300)
vec2 creekAt(float z){ return texture2D(uCreekTex, vec2(clamp((z + 100.0) / 1400.0, 0.0, 1.0), 0.5)).xy; }
// 1 inside the peach forest corridor, fading at its ends and sides
float forestMaskGL(vec2 xz){
  vec2 c = creekAt(xz.y);
  float d = abs(xz.x - c.x) - c.y;
  float along = smoothstep(52.0, 70.0, xz.y) * (1.0 - smoothstep(377.0, 403.0, xz.y)); // FOREST.z1 - 8 .. + 18
  return along * (1.0 - smoothstep(28.0, 44.0, d));
}

// one wind field: a steady breeze plus a travelling gust front (uGust) that the director can fire,
// so branch tips and petals lean the same way at the same moment
// uGust: front position along the wind (now), strength, width, speed (m/s), so the front at an
// earlier time t is uGust.x - uGust.w * (uTime - t): petals can ask how hard it blew when they let go
float windGustAt(vec3 wp, float t){
  vec2 d = uWind.xy;
  float along = dot(wp.xz, d);
  float g = 0.5 + 0.35 * sin(t * 0.5 - along * 0.05) * (0.6 + 0.4 * sin(t * 0.19 + wp.x * 0.013 - wp.z * 0.011));
  float front = along - (uGust.x - uGust.w * (uTime - t));
  g += uGust.y * exp(-front * front / max(uGust.z * uGust.z, 1.0));
  return max(g, 0.06) * uWind.z;
}
float windGust(vec3 wp){ return windGustAt(wp, uTime); }
vec3 windSway(vec3 wp, float flex, float phase){
  float g = windGust(wp);
  float t = uTime;
  float s = sin(t * 1.3 + phase + dot(wp.xz, uWind.xy) * 0.09) * 0.5 + sin(t * 2.2 + phase * 1.9) * 0.2;
  vec3 dir = vec3(uWind.x, 0.0, uWind.y);
  vec3 side = vec3(-uWind.y, 0.0, uWind.x);
  return (dir * (0.45 + s) * g + side * sin(t * 1.6 + phase * 2.3) * 0.16 * g) * flex;
}

vec3 skyFogColor(vec3 rd){
  float s = max(dot(rd, uSunDir), 0.0);
  float warm = clamp(pow(s, 2.5) * 0.9 + 0.08, 0.0, 1.0);
  vec3 c = mix(uFogCool, uFogWarm, warm);
  c += uSunCol * (pow(s, 12.0) * 0.035 + pow(s, 90.0) * 0.08) * uSunVis;
  return c;
}

// aerial perspective: exponential height fog + distance haze + low morning mist banks
vec3 applyAtmosphere(vec3 col, vec3 wp){
  // (in the reflection pass cameraPosition is the mirrored eye: the straight line to wp has the reflected path's length)
  vec3 ro = cameraPosition;
  vec3 dv = wp - ro;
  float dist = length(dv);
  vec3 rd = dv / max(dist, 1e-3);
  float fall = uFogParams.y;
  float k = fall * dv.y;
  float fh = uFogParams.x * exp(-fall * (ro.y - uFogParams.z)) * dist * (abs(k) > 1e-3 ? (1.0 - exp(-k)) / k : 1.0);
  // mist: a thin layer lying on the basin floor and along the creek, breaking into drifting banks
  float base = wp.z < 30.0 ? 0.0 : 8.0;
  float my = clamp(1.0 - (wp.y - base) / 9.0, 0.0, 1.0);
  vec2 mp = wp.xz * 0.018 + vec2(uTime * 0.012, uTime * 0.02);
  float mn = vnoise(mp) * 1.25 - 0.4 + vnoise(mp * 3.1) * 0.2;
  float mist = uMist * my * my * max(mn, 0.0) * min(max(dist - 25.0, 0.0), 260.0) * 0.0032;
  // and where a chapter thickens it, a low veil lying right on the water, a few metres deep
  float low = clamp(1.0 - (wp.y - base) / 3.5, 0.0, 1.0);
  mist += max(uMist - 1.0, 0.0) * low * low * max(mn + 0.3, 0.0) * min(max(dist - 10.0, 0.0), 160.0) * 0.004;
  float haze = uFogParams.w * dist;
  float T = exp(-(fh + haze + mist));
  vec3 fc = skyFogColor(normalize(vec3(rd.x, max(rd.y, -0.05), rd.z)));
  fc += uSunCol * 0.03 * mist * pow(max(dot(rd, uSunDir), 0.0), 3.0);
  return col * T + fc * (1.0 - T);
}

mat3 rotAxis(vec3 a, float ang){ float s = sin(ang), c = cos(ang), oc = 1.0 - c;
  return mat3(oc*a.x*a.x + c, oc*a.x*a.y + a.z*s, oc*a.z*a.x - a.y*s,
              oc*a.x*a.y - a.z*s, oc*a.y*a.y + c, oc*a.y*a.z + a.x*s,
              oc*a.z*a.x + a.y*s, oc*a.y*a.z - a.x*s, oc*a.z*a.z + c); }
`;

let patched = false;
export function patchChunks() {
  if (patched) return;
  patched = true;
  const s = THREE.ShaderChunk;
  s.common = s.common + '\n' + COMMON;
  s.fog_pars_vertex = '#ifdef USE_FOG\n varying vec3 vFogWP;\n#endif';
  s.fog_vertex = `#ifdef USE_FOG
    vec4 fogWP = vec4(transformed, 1.0);
    #ifdef USE_BATCHING
      fogWP = batchingMatrix * fogWP;
    #endif
    #ifdef USE_INSTANCING
      fogWP = instanceMatrix * fogWP;
    #endif
    vFogWP = (modelMatrix * fogWP).xyz;
  #endif`;
  s.fog_pars_fragment = '#ifdef USE_FOG\n varying vec3 vFogWP;\n#endif';
  s.fog_fragment = '#ifdef USE_FOG\n gl_FragColor.rgb = applyAtmosphere(gl_FragColor.rgb, vFogWP);\n#endif';
  // capture the sun's direct light for translucency on petals and leaves
  s.lights_pars_begin = s.lights_pars_begin + '\nvec3 gSunColor = vec3(0.0);\nvec3 gSunDir = vec3(0.0, 1.0, 0.0);\n';
  const key = 'getDirectionalLightInfo( directionalLight, directLight );';
  const e = s.lights_fragment_begin.indexOf(key);
  if (e > 0) {
    const a = s.lights_fragment_begin.slice(0, e), b = s.lights_fragment_begin.slice(e);
    s.lights_fragment_begin = a + b.replace('RE_Direct(', 'if ( UNROLLED_LOOP_INDEX == 0 ) { gSunColor = directLight.color; gSunDir = directLight.direction; }\n\t\tRE_Direct(');
  }
}

// light that passes through thin petals / leaves toward the eye
export const TRANSLUCENT = /* glsl */ `
  vec3 sunLv = gSunDir;
  vec3 sunC = gSunColor;
  float sunBack = pow(saturate(dot(-normalize(vViewPosition), sunLv)), 4.0);
  float sunWrap = saturate(dot(-normal, sunLv) * 0.6 + 0.4);
`;

// attach the shared uniforms (and an optional shader edit) to a built-in material
export function hook(mat, key, edit) {
  mat.onBeforeCompile = (sh, r) => {
    Object.assign(sh.uniforms, G);
    if (mat.userData.uniforms) Object.assign(sh.uniforms, mat.userData.uniforms);
    edit && edit(sh, r);
  };
  mat.customProgramCacheKey = () => key;
  return mat;
}

export function hookAll(root) {
  root.traverse((o) => {
    if (!o.material) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (m.isShaderMaterial) continue;
      if (!m.onBeforeCompile || m.onBeforeCompile === THREE.Material.prototype.onBeforeCompile) hook(m, 'plain');
    }
  });
}

// uniforms for a ShaderMaterial that uses COMMON (fog: true lets three pass fog defines; we don't use them)
export const withG = (u = {}) => ({ ...G, ...u });
