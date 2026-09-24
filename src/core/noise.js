// Gradient noise for terrain, rocks and voxel masses (JS side; the shaders have their own value noise).
const P = new Uint8Array(512);
(() => {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  let s = 1337;
  for (let i = 255; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  for (let i = 0; i < 512; i++) P[i] = p[i & 255];
})();

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const G2 = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];

export function perlin2(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const X = xi & 255, Y = yi & 255;
  const g = (ix, iy, dx, dy) => {
    const v = G2[P[P[ix] + iy] & 7];
    return v[0] * dx + v[1] * dy;
  };
  const u = fade(xf), v = fade(yf);
  const a = g(X, Y, xf, yf), b = g(X + 1, Y, xf - 1, yf);
  const c = g(X, Y + 1, xf, yf - 1), d = g(X + 1, Y + 1, xf - 1, yf - 1);
  return (a + u * (b - a) + v * (c + u * (d - c) - a - u * (b - a))) * 0.7071;
}

export function fbm2(x, y, oct = 4, lac = 2.03, gain = 0.5) {
  let a = 1, f = 1, s = 0, n = 0;
  for (let i = 0; i < oct; i++) {
    s += a * perlin2(x * f + i * 17.1, y * f - i * 9.3);
    n += a; a *= gain; f *= lac;
  }
  return s / n;
}

// ridged noise: sharp crests for the mountain ring
export function ridge2(x, y, oct = 4) {
  let a = 1, f = 1, s = 0, n = 0, w = 1;
  for (let i = 0; i < oct; i++) {
    let r = 1 - Math.abs(perlin2(x * f + i * 31.7, y * f + i * 11.3) * 1.6);
    r = r * r * w;
    w = Math.min(1, r * 1.8);
    s += a * r; n += a; a *= 0.5; f *= 2.1;
  }
  return s / n;
}

const G3 = [[1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],[1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],[0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1]];
export function perlin3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const X = xi & 255, Y = yi & 255, Z = zi & 255;
  const g = (ix, iy, iz, dx, dy, dz) => {
    const v = G3[P[P[P[ix] + iy] + iz] % 12];
    return v[0] * dx + v[1] * dy + v[2] * dz;
  };
  const u = fade(xf), v = fade(yf), w = fade(zf);
  const l = (a, b, t) => a + t * (b - a);
  return l(
    l(l(g(X, Y, Z, xf, yf, zf), g(X + 1, Y, Z, xf - 1, yf, zf), u),
      l(g(X, Y + 1, Z, xf, yf - 1, zf), g(X + 1, Y + 1, Z, xf - 1, yf - 1, zf), u), v),
    l(l(g(X, Y, Z + 1, xf, yf, zf - 1), g(X + 1, Y, Z + 1, xf - 1, yf, zf - 1), u),
      l(g(X, Y + 1, Z + 1, xf, yf - 1, zf - 1), g(X + 1, Y + 1, Z + 1, xf - 1, yf - 1, zf - 1), u), v),
    w);
}

export function fbm3(x, y, z, oct = 3) {
  let a = 1, f = 1, s = 0, n = 0;
  for (let i = 0; i < oct; i++) {
    s += a * perlin3(x * f, y * f, z * f);
    n += a; a *= 0.5; f *= 2.02;
  }
  return s / n;
}
