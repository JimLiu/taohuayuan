// Times of day as sets of the shared sky/sun/fog uniforms and the two lights; the journey blends
// between them (the guest's evening in the village, the days that pass, the morning he leaves, the search in the mist).
import { G } from '../core/shared.js';

const P = {
  // spring morning, thin mist lifting: the default
  morning: {
    // the sun just east of east, 33° up: over the lowest stretch of the east ridge as seen from the houses
    sunDir: [0.84, 0.54, 0.08], sunCol: [3.2, 2.85, 2.35], fogCool: [0.62, 0.72, 0.8], fogWarm: [0.98, 0.9, 0.78],
    zen: [0.2, 0.38, 0.68], up: [0.43, 0.59, 0.79], cloudLit: [1.25, 1.2, 1.12], cloudShade: [0.62, 0.66, 0.74],
    glow: [1.0, 0.86, 0.7], night: 0, sunVis: 1, mist: 1, fog: [0.0016, 0.00018], sunI: 3.0, hemiI: 1.1,
    hemiSky: [0.62, 0.72, 0.85], hemiGnd: [0.32, 0.3, 0.22], lamps: 0,
  },
  noon: {
    sunDir: [0.42, 0.78, 0.46], sunCol: [3.3, 3.1, 2.8], fogCool: [0.64, 0.74, 0.84], fogWarm: [0.94, 0.9, 0.84],
    zen: [0.26, 0.44, 0.7], up: [0.55, 0.69, 0.82], cloudLit: [1.3, 1.28, 1.24], cloudShade: [0.66, 0.7, 0.78],
    glow: [0.9, 0.86, 0.8], night: 0, sunVis: 1, mist: 0.3, fog: [0.0013, 0.00016], sunI: 3.2, hemiI: 1.15,
    hemiSky: [0.62, 0.72, 0.86], hemiGnd: [0.34, 0.32, 0.24], lamps: 0,
  },
  dusk: {
    sunDir: [-0.84, 0.13, 0.52], sunCol: [3.0, 1.75, 0.95], fogCool: [0.5, 0.52, 0.62], fogWarm: [1.02, 0.74, 0.52],
    zen: [0.2, 0.28, 0.48], up: [0.52, 0.52, 0.62], cloudLit: [1.3, 0.95, 0.72], cloudShade: [0.46, 0.44, 0.54],
    glow: [1.1, 0.66, 0.42], night: 0.08, sunVis: 1, mist: 0.8, fog: [0.0018, 0.0002], sunI: 2.2, hemiI: 0.75,
    hemiSky: [0.5, 0.52, 0.66], hemiGnd: [0.3, 0.24, 0.18], lamps: 0.6,
  },
  night: {
    // moonlight: cool, low, faint; the stars out; lamps in the windows
    sunDir: [-0.3, 0.55, -0.45], sunCol: [0.34, 0.42, 0.62], fogCool: [0.05, 0.065, 0.11], fogWarm: [0.075, 0.085, 0.13],
    zen: [0.015, 0.025, 0.06], up: [0.04, 0.06, 0.11], cloudLit: [0.16, 0.18, 0.25], cloudShade: [0.05, 0.06, 0.09],
    glow: [0.12, 0.13, 0.2], night: 1, sunVis: 0, mist: 0.9, fog: [0.0016, 0.00018], sunI: 0.55, hemiI: 0.22,
    hemiSky: [0.3, 0.38, 0.6], hemiGnd: [0.08, 0.08, 0.1], lamps: 1,
  },
  dawn: {
    sunDir: [0.9, 0.08, 0.3], sunCol: [2.6, 1.7, 1.2], fogCool: [0.5, 0.56, 0.66], fogWarm: [0.98, 0.78, 0.66],
    zen: [0.22, 0.32, 0.52], up: [0.54, 0.58, 0.68], cloudLit: [1.2, 0.98, 0.86], cloudShade: [0.5, 0.5, 0.6],
    glow: [1.05, 0.72, 0.56], night: 0.15, sunVis: 1, mist: 1.6, fog: [0.002, 0.00022], sunI: 1.8, hemiI: 0.7,
    hemiSky: [0.52, 0.58, 0.72], hemiGnd: [0.26, 0.24, 0.2], lamps: 0.3,
  },
  // the search: grey, sunless, the mist thick
  overcast: {
    sunDir: [0.5, 0.6, 0.3], sunCol: [1.1, 1.1, 1.08], fogCool: [0.7, 0.73, 0.75], fogWarm: [0.76, 0.77, 0.76],
    zen: [0.5, 0.55, 0.6], up: [0.64, 0.68, 0.7], cloudLit: [0.85, 0.87, 0.88], cloudShade: [0.66, 0.68, 0.7],
    glow: [0.7, 0.72, 0.72], night: 0, sunVis: 0, mist: 4, fog: [0.022, 0.004], sunI: 0.9, hemiI: 1.35,
    hemiSky: [0.7, 0.74, 0.78], hemiGnd: [0.36, 0.36, 0.32], lamps: 0,
  },
};
export const TIMES = Object.keys(P);

const ss = (k) => k * k * (3 - 2 * k);
// blend two states (names or state objects)
export function mixTime(a, b, t) {
  const A = typeof a === 'string' ? P[a] : a, B = typeof b === 'string' ? P[b] : b;
  const o = {};
  for (const k in A) o[k] = Array.isArray(A[k]) ? A[k].map((x, i) => x + (B[k][i] - x) * t) : A[k] + (B[k] - A[k]) * t;
  return o;
}
// a list of times spread over u in 0..1, e.g. ['noon','dusk','night','dawn','morning']
export function timeAt(spec, u) {
  if (typeof spec === 'string') return P[spec];
  const n = spec.length - 1;
  const f = Math.min(n - 1e-6, Math.max(0, u) * n), i = Math.floor(f);
  return mixTime(spec[i], spec[i + 1], ss(f - i));
}

export class Daylight {
  constructor(sun, hemi) {
    this.sun = sun;
    this.hemi = hemi;
    this.apply(P.morning);
  }
  apply(s) {
    this.state = s;
    G.uSunDir.value.set(...s.sunDir).normalize();
    G.uSunCol.value.set(...s.sunCol);
    G.uFogCool.value.set(...s.fogCool);
    G.uFogWarm.value.set(...s.fogWarm);
    G.uSkyZen.value.set(...s.zen);
    G.uSkyUp.value.set(...s.up);
    G.uCloudLit.value.set(...s.cloudLit);
    G.uCloudShade.value.set(...s.cloudShade);
    G.uHorizonGlow.value.set(...s.glow);
    G.uNight.value = s.night;
    G.uSunVis.value = s.sunVis;
    G.uLampOn.value = s.lamps;
    G.uMist.value = s.mist;
    G.uFogParams.value.x = s.fog[0];
    G.uFogParams.value.w = s.fog[1];
    // ambient scale for the hand-written shaders (ridges, water), 1 in the morning
    const k = s.hemiI / P.morning.hemiI;
    G.uAmbK.value.set(k * s.hemiSky[0] / P.morning.hemiSky[0], k * s.hemiSky[1] / P.morning.hemiSky[1], k * s.hemiSky[2] / P.morning.hemiSky[2]);
    const m = Math.max(...s.sunCol);
    this.sun.color.setRGB(s.sunCol[0] / m, s.sunCol[1] / m, s.sunCol[2] / m);
    this.sun.intensity = s.sunI;
    this.hemi.intensity = s.hemiI;
    this.hemi.color.setRGB(...s.hemiSky);
    this.hemi.groundColor.setRGB(...s.hemiGnd);
  }
  set(a, b = a, t = 0) { this.apply(mixTime(a, b, t)); }
}
