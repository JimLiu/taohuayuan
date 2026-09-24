// 信步: when no story is playing the viewer goes where they like: along the creek under the peach trees,
// through the passage, down into the fields and between the houses, or up into the air above it all.
// Mouse: drag to look, wheel to step, double-click (double-tap) to walk to a spot, pinch / ctrl-wheel to zoom
// (the ui's gestures and keys are handed on here while no story plays).
// Keys: WASD or ↑↓ to walk, ← → to turn, Shift to hurry, E / Space to rise, Q / C to come down, 1–0 for the scenes.
// The feet follow the ground (or the water's surface), the passage's floor between its walls, and are kept
// out of the houses and off sheer rock; in the air the eye keeps its height over the ground below.
import * as THREE from 'three';
import { surfaceHeight } from '../world/terrain.js';
import { passageNear, passagePoint, halfW, hgt, TUNNEL_LEN as L } from '../world/tunnel.js';
import { basinR, inMouthBox, creekX, creekHW, WATER_OUT, POND_Y, BIG_TREE, EXIT } from '../world/layout.js';
import { UNITS, YARDS, WELLS, STACKS, LANES, toLocal, toWorld, villageToUnit, unitToVillage, ridgeY } from '../world/villageplan.js';
import { clamp, lerp, smoothstep } from '../core/rng.js';
import { PANO } from './chapters.js';

const EYE = 1.6;              // eye over the feet, walking
const WALK = 4.2, RUN = 13;   // m/s on foot; in the air faster the higher
const BODY = 0.35;            // kept clear of walls
const STEEP = 1.25;           // rise over run beyond which a slope is a wall on foot
const TOP = 420;              // highest the eye goes

// where there is something to walk among: the creek's valley (short of the slope wood, below) and the basin's
// floor with the slope down from the cave's mouth (the grass, flowers and trees are only grown there; the
// ring of hills round it is for seeing, not climbing); in the air the bounds are looser
function allowed(x, z, flying) {
  if (flying) return x > -620 && x < 660 && z > -660 && z < 960;
  if (z < 30) return basinR(x, z) < 0.86 || (Math.hypot(x - EXIT.x, z - EXIT.z) < 46 && surfaceHeight(x, z) < EXIT.y + 2);
  return z < 600 && Math.abs(x - creekX(z)) < 150;
}

// what the feet stand on in the open: the ground, or the water's surface (the creek and the pond can be walked)
function openGround(x, z) {
  const water = basinR(x, z) < 0.99 && z < -30 ? POND_Y : WATER_OUT;
  return Math.max(surfaceHeight(x, z), water);
}

// the passage around (x, z), if feet at height fy are in it (so the mountain above it doesn't count)
function passageAt(x, z, fy) {
  const P = passageNear(x, z);
  return P.s > -9 && P.s < L + 9 && Math.abs(P.lat) < halfW(P.s) + 0.4 && Math.abs(fy - P.floor) < 3 ? P : null;
}
// its floor, easing onto the ledges outside either mouth
function passageFloor(P, x, z) {
  const k = Math.max(smoothstep(-0.5, -3, P.s), smoothstep(L + 0.5, L + 3, P.s));
  return k > 0 ? lerp(P.floor, openGround(x, z), k) : P.floor;
}
const underRock = (P) => P.s > -0.5 && P.s < L + 0.5;

// the houses' walls: pushed out of any unit's footprint, in its own frame
const HOUSES = UNITS.map((unit) => ({ unit, top: ridgeY(unit) }));
function clearOfHouses(x, z) {
  if (x < -70 || x > 150 || z > -170 || z < -340) return [x, z];
  let [u, v] = toLocal(x, z);
  for (const { unit } of HOUSES) {
    let [lx, lz] = villageToUnit(unit, u, v);
    const hw = unit.w / 2 + BODY, hd = unit.d / 2 + BODY;
    if (Math.abs(lx) >= hw || Math.abs(lz) >= hd) continue;
    if (hw - Math.abs(lx) < hd - Math.abs(lz)) lx = lx < 0 ? -hw : hw;
    else lz = lz < 0 ? -hd : hd;
    [u, v] = unitToVillage(unit, lx, lz);
  }
  return toWorld(u, v);
}

// 篱笆、院墙: the yards' fences and earth walls (village frame), with a way in only where the gate stands open;
// made when first needed, since the gates are swung when the village is built
let FENCES = null;
function fences() {
  if (FENCES) return FENCES;
  FENCES = [];
  const seg = (a, b) => FENCES.push({ a, b, box: [Math.min(a[0], b[0]) - 1.5, Math.max(a[0], b[0]) + 1.5, Math.min(a[1], b[1]) - 1.5, Math.max(a[1], b[1]) + 1.5] });
  for (const y of YARDS) {
    const hs = y.house, vb = hs.v;
    if (y.gateOpen && y.gateAt) { seg([y.u0, y.v1], [y.gateAt[0], y.v1]); seg([y.gateAt[1], y.v1], [y.u1, y.v1]); }
    else seg([y.u0, y.v1], [y.u1, y.v1]);
    seg([y.u0, vb], [y.u0, y.v1]);
    seg([y.u1, vb], [y.u1, y.v1]);
    seg([y.u0, vb], [hs.u - hs.w / 2 + 0.1, vb]);
    seg([hs.u + hs.w / 2 - 0.1, vb], [y.u1, vb]);
  }
  return FENCES;
}
// out of the fences' reach (0.2 for the fence, the body besides), on the side the walker came from
function clearOfFences(x, z, px, pz) {
  if (x < -70 || x > 150 || z > -170 || z < -340) return [x, z];
  let [u, v] = toLocal(x, z);
  const [pu, pv] = toLocal(px, pz), R = 0.2 + BODY;
  for (const f of fences()) {
    if (u < f.box[0] || u > f.box[1] || v < f.box[2] || v > f.box[3]) continue;
    const [ax, az] = f.a, vx = f.b[0] - ax, vz = f.b[1] - az, l2 = vx * vx + vz * vz;
    const t = clamp(((u - ax) * vx + (v - az) * vz) / l2, 0, 1);
    const cx = ax + vx * t, cz = az + vz * t, d = Math.hypot(u - cx, v - cz);
    if (d >= R) continue;
    if (t > 0 && t < 1) {
      // along the run: back out square to it, on the side of the last step
      const n = Math.sqrt(l2), side = Math.sign(vx * (pv - az) - vz * (pu - ax)) || 1;
      u = cx - (vz / n) * side * R; v = cz + (vx / n) * side * R;
    } else if (d > 1e-6) { u = cx + ((u - cx) / d) * R; v = cz + ((v - cz) / d) * R; }
  }
  return toWorld(u, v);
}

// 树干、井、草垛、岸石: round things kept clear of, in a coarse grid (set by the app once the world is built);
// `top` for those low enough to step over
const POSTS = new Map();
const cellKey = (x, z) => `${Math.floor(x / 8)},${Math.floor(z / 8)}`;
function addPost(p) {
  const k = cellKey(p.x, p.z);
  if (!POSTS.has(k)) POSTS.set(k, []);
  POSTS.get(k).push(p);
}
for (const w of WELLS) addPost({ x: w.p[0], z: w.p[1], r: 1.0 });
for (const st of STACKS) addPost({ x: st.p[0], z: st.p[1], r: st.r * 1.05 });
function clearOfPosts(x, z, feet, extra) {
  const gx = Math.floor(x / 8), gz = Math.floor(z / 8);
  const push = (p) => {
    if (p.top !== undefined && feet > p.top - 0.45) return;
    const dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz), R = p.r + BODY;
    if (d >= R || d < 1e-6) return;
    x = p.x + (dx / d) * R; z = p.z + (dz / d) * R;
  };
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
    const l = POSTS.get(`${gx + i},${gz + j}`);
    if (l) l.forEach(push);
  }
  if (extra) extra.forEach(push);
  return [x, z];
}

// 山林: the slope wood is made to be seen across the valley, not walked in; the walker (and anyone flying low)
// is kept a good way out of it, in 4 m cells
const WOOD = new Set(), WC = 4, STANDOFF = 9, OVER_WOOD = 25;
const woodKey = (gx, gz) => (gx + 2000) * 4096 + (gz + 2000);
const inWood = (x, z) => WOOD.has(woodKey(Math.floor(x / WC), Math.floor(z / WC)));
function addWood(l) {
  const R = l.s * 1.15 + STANDOFF, g0 = Math.floor((l.x - R) / WC), g1 = Math.floor((l.x + R) / WC);
  const h0 = Math.floor((l.z - R) / WC), h1 = Math.floor((l.z + R) / WC);
  for (let gx = g0; gx <= g1; gx++) for (let gz = h0; gz <= h1; gz++)
    if (Math.hypot((gx + 0.5) * WC - l.x, (gz + 0.5) * WC - l.z) < R) WOOD.add(woodKey(gx, gz));
}

// 场景: the places along the way, in the text's order (a key each, 1..0, and the strip at the bottom); each with
// the words of the text it stands for. The second, on the creek in the peach wood, is where the viewer begins
// and comes back to.
const lane = LANES[0], lm = Math.floor(lane.length / 2);
export const HOME = 1;
export const FOREST = { p: () => [creekX(398), 0, 398], l: () => [creekX(358), WATER_OUT + 2.4, 358] };
export const PLACES = [
  { name: '缘溪行', q: '缘溪行，忘路之远近。', p: () => [creekX(345), 0, 345], l: () => [creekX(300), 10, 300] },
  { name: '桃花林', q: '忽逢桃花林，夹岸数百步，中无杂树，芳草鲜美，落英缤纷。', p: FOREST.p, l: FOREST.l },
  { name: '山有小口', q: '林尽水源，便得一山，山有小口，仿佛若有光。', p: () => [creekX(80) + creekHW(80) + 3, 0, 80], l: () => [creekX(50), 9.6, 48] },
  { name: '初极狭', q: '便舍船，从口入。初极狭，才通人。', p: () => { const q = passagePoint(9); return [q.x, q.y + EYE, q.z]; }, l: () => { const q = passagePoint(20); return [q.x, q.y + 1.3, q.z]; } },
  { name: '豁然开朗', q: '复行数十步，豁然开朗。土地平旷，屋舍俨然。', p: PANO.p, l: PANO.l },
  { name: '阡陌交通', q: '有良田、美池、桑竹之属。阡陌交通，鸡犬相闻。', p: [0.4, 0, -118], l: [26, 1.6, -215] },
  { name: '屋舍俨然', q: '其中往来种作，男女衣着，悉如外人。', p: [lane[lm][0], 0, lane[lm][1]], l: [lane[lm + 1][0], 1.6, lane[lm + 1][1]] },
  { name: '黄发垂髫', q: '黄发垂髫，并怡然自乐。', p: [3, 0, -196], l: [BIG_TREE.x, 2.2, BIG_TREE.z] },
  { name: '美池桑竹', q: '有良田、美池、桑竹之属。', p: [-44, 0, -186], l: [-74, 0, -208] },
  { name: '来此绝境', q: '率妻子邑人来此绝境，不复出焉，遂与外人间隔。', p: [55, 150, -20], l: [30, 0, -235] },
];
const val = (a) => (typeof a === 'function' ? a() : a);
const _v = new THREE.Vector3();
const MOVE = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE', 'KeyQ', 'KeyC', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight']);

export class Roam {
  constructor({ camera, canvas }) {
    this.camera = camera;
    this.canvas = canvas;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector2();
    this.yaw = 0; this.pitch = 0; this.ty = 0; this.tp = 0;
    this.fov = 50; this.tf = 50;
    this.alt = 0;                     // above the walking eye; > 0 is flying
    this.ground = 0;                  // what the feet are on now
    this.pass = null;                 // the passage, when in it
    this.dolly = 0;                   // wheel steps still to walk
    this.goal = null;                 // a double-clicked spot being walked to
    this.keys = new Set();
    this.fade = null;
    this.here = -1;                   // the place (of PLACES) the viewer is at, until they wander off from it
    this.hereAt = new THREE.Vector3();
    this.dipEl = document.getElementById('dip');
    // a ripple on the ground where a double-click sends the walker
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.7, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xfff8ec, transparent: true, opacity: 0, depthWrite: false, fog: false }));
    ring.renderOrder = 3;
    ring.visible = false;
    this.marker = ring;
    window.addEventListener('blur', () => this.keys.clear());
  }

  // ---------------------------------------------------------------- placing
  place(p, l, here = -1) {
    p = val(p); l = val(l);
    const [x, , z] = p;
    const P = passageAt(x, z, (p[1] || 0) - EYE);
    this.pass = P && Math.abs(p[1] - EYE - P.floor) < 1.5 ? P : null;
    this.ground = this.pass ? passageFloor(this.pass, x, z) : openGround(x, z);
    const y = p[1] > this.ground + 0.2 ? p[1] : this.ground + EYE;
    this.alt = this.pass ? 0 : Math.max(0, y - this.ground - EYE);
    this.pos.set(x, y, z);
    const d = new THREE.Vector3(l[0] - x, l[1] - y, l[2] - z).normalize();
    this.yaw = this.ty = Math.atan2(d.x, d.z);
    this.pitch = this.tp = Math.asin(clamp(d.y, -1, 1));
    this.vel.set(0, 0);
    this.dolly = 0;
    this.goal = null;
    this.fov = this.tf = 50;
    this._camera();
    this.here = here;
    this.hereAt.copy(this.pos);
  }
  // put down at place i at once, or (goPlace) under the paper
  placeNow(i) { this.place(PLACES[i].p, PLACES[i].l, i); }
  goPlace(i) {
    const pl = PLACES[i];
    if (!pl || this.fade) return;
    this.goal = null;
    this.fade = { t: 0, pl };
  }
  home() { this.goPlace(HOME); }
  release() { this.keys.clear(); this.dolly = 0; this.goal = null; this.vel.set(0, 0); }
  // what stands about that the world has made: tree trunks ({x, z, r}), boulders ({x, z, r, top}), the boat's hull,
  // the slope wood's clumps ({x, z, s})
  setObstacles({ posts = [], hull = null, wood = [] } = {}) {
    posts.forEach(addPost);
    wood.forEach(addWood);
    this.hull = hull;
  }
  // well above the ground: from up here the other side of the mountain can be seen
  aloft() { return this.pos.y > 45 || this.alt > 18; }

  // ---------------------------------------------------------------- input (dispatched by the ui)
  lookBy(dx, dy) {
    const k = 0.0034 * (this.fov / 50);
    this.ty -= dx * k;
    this.tp = clamp(this.tp - dy * k, -1.35, 1.35);
  }
  zoomBy(f) { this.tf = clamp(this.tf * f, 22, 70); }
  // the wheel steps forward and back
  wheel(dy) { this.dolly = clamp(this.dolly - dy * 0.03, -40, 40); this.goal = null; }
  keyDown(code) {
    if (!MOVE.has(code)) return false;
    this.keys.add(code);
    if (!code.startsWith('Shift')) this.goal = null;
    return true;
  }
  keyUp(code) { this.keys.delete(code); }
  get zoomed() { return Math.abs(this.tf - 50) > 0.5; }

  // where the ray under the pointer meets the ground (or water), or null past a kilometre / at the sky
  pick(cx, cy) {
    const r = this.canvas.getBoundingClientRect();
    const rc = new THREE.Raycaster();
    rc.setFromCamera(new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), this.camera);
    const o = rc.ray.origin, d = rc.ray.direction;
    const above = (t) => o.y + d.y * t - openGround(o.x + d.x * t, o.z + d.z * t);
    let t = 0.6;
    if (above(t) < 0) return null; // (in the passage, under the mountain)
    while (t < 1000) {
      const nt = t + Math.max(0.4, t * 0.025);
      if (above(nt) < 0) {
        let a = t, b = nt;
        for (let i = 0; i < 12; i++) { const m = (a + b) / 2; if (above(m) < 0) b = m; else a = m; }
        return new THREE.Vector3(o.x + d.x * a, 0, o.z + d.z * a).setY(openGround(o.x + d.x * a, o.z + d.z * a));
      }
      t = nt;
    }
    return null;
  }
  goTo(cx, cy) {
    const p = this.pick(cx, cy);
    if (!p) return;
    this.goal = { x: p.x, z: p.z };
    this.dolly = 0;
    this.marker.position.copy(p).add(new THREE.Vector3(0, 0.06, 0));
    this.marker.scale.setScalar(Math.max(1, p.distanceTo(this.pos) * 0.02));
    this.marker.userData.t = 0;
    this.marker.visible = true;
  }

  // ---------------------------------------------------------------- moving
  // one step to (x, z) if it can be taken; true if taken
  _try(x, z) {
    const flying = this.alt > 0.5;
    const fy = this.ground;
    let P = flying ? null : passageAt(x, z, fy);
    if (!P) {
      if (!allowed(x, z, flying)) return false;
      // not into the wood (but out of it, if somehow in it), unless well above it
      if (this.alt < OVER_WOOD && inWood(x, z) && !inWood(this.pos.x, this.pos.z)) return false;
    }
    if (P) {
      if (underRock(P)) {
        // between the walls
        const m = Math.max(0.05, halfW(P.s) - 0.3);
        const over = P.lat - clamp(P.lat, -m, m);
        if (over) {
          const q = passagePoint(P.s);
          x -= -q.dz * over; z -= q.dx * over;
          P = passageNear(x, z);
        }
      }
      this.pass = P;
      this.ground = passageFloor(P, x, z);
    } else {
      // the rock of the mouths is solid but for the way through
      if (inMouthBox(x, z) && Math.abs(fy - passageNear(x, z).floor) < 8) return false;
      if (this.alt < 5) [x, z] = clearOfHouses(x, z);
      if (this.alt < 2.5) {
        [x, z] = clearOfFences(x, z, this.pos.x, this.pos.z);
        [x, z] = clearOfPosts(x, z, this.ground + this.alt, this.boatPosts);
      }
      const g = openGround(x, z);
      if (!flying) {
        // a face too steep to walk up, judged a little way ahead (not over a single frame's few centimetres)
        const dx = x - this.pos.x, dz = z - this.pos.z, n = Math.hypot(dx, dz);
        if (n > 1e-4) {
          const ahead = openGround(this.pos.x + (dx / n) * 0.8, this.pos.z + (dz / n) * 0.8);
          if (ahead - this.ground > 0.8 * STEEP && g > this.ground) return false;
        }
      }
      this.pass = null;
      this.ground = g;
    }
    this.pos.x = x; this.pos.z = z;
    return true;
  }
  _move(dx, dz) {
    if (Math.abs(dx) + Math.abs(dz) < 1e-6) return true;
    // long steps in pieces (so walls and the passage's sides are met, not jumped)
    const n = Math.ceil(Math.hypot(dx, dz) / 0.4);
    for (let i = 0; i < n; i++) {
      const x = this.pos.x + dx / n, z = this.pos.z + dz / n;
      if (!this._try(x, z) && !this._try(x, this.pos.z) && !this._try(this.pos.x, z)) return false;
    }
    return true;
  }

  update(dt) {
    const K = this.keys, has = (...c) => c.some((k) => K.has(k));
    // the moored boat, as three rounds along its keel
    const H = this.hull;
    this.boatPosts = H && H.parent?.visible !== false && Math.abs(H.matrix.elements[14] - this.pos.z) < 12
      ? [-1.6, 0, 1.6].map((z) => { _v.set(0, 0, z).applyMatrix4(H.matrix); return { x: _v.x, z: _v.z, r: 0.62, top: _v.y + 0.5 }; })
      : null;
    if (this.fade) this._fade(dt);
    // look
    const turn = (has('ArrowRight') ? 1 : 0) - (has('ArrowLeft') ? 1 : 0);
    this.ty -= turn * 1.4 * dt;
    const k = 1 - Math.exp(-dt * 7);
    this.yaw += (this.ty - this.yaw) * k;
    this.pitch += (this.tp - this.pitch) * k;
    this.fov += (this.tf - this.fov) * k;
    // walking
    const fwd = (has('KeyW', 'ArrowUp') ? 1 : 0) - (has('KeyS', 'ArrowDown') ? 1 : 0);
    const side = (has('KeyD') ? 1 : 0) - (has('KeyA') ? 1 : 0);
    const rise = this.pass ? 0 : (has('KeyE', 'Space') ? 1 : 0) - (has('KeyQ', 'KeyC') ? 1 : 0);
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const fast = has('ShiftLeft', 'ShiftRight');
    const speed = (fast ? RUN : WALK) * (1 + this.alt / 22);
    let tx = 0, tz = 0;
    if (fwd || side) {
      const n = Math.hypot(fwd, side);
      tx = ((fx * fwd - fz * side) / n) * speed;
      tz = ((fz * fwd + fx * side) / n) * speed;
    } else if (this.goal) {
      const dx = this.goal.x - this.pos.x, dz = this.goal.z - this.pos.z, d = Math.hypot(dx, dz);
      if (d < 0.9) this.goal = null;
      else {
        const v = clamp(d * 0.9, 2.2, fast ? 40 : 22) * (1 + this.alt / 40);
        tx = (dx / d) * v; tz = (dz / d) * v;
        // coming down to walk there
        this.alt *= Math.exp(-dt * clamp(3 / Math.max(d, 1), 0.3, 3));
      }
    }
    const kv = 1 - Math.exp(-dt * 8);
    this.vel.x += (tx - this.vel.x) * kv;
    this.vel.y += (tz - this.vel.y) * kv;
    const step = this.dolly * (1 - Math.exp(-dt * 6));
    this.dolly -= step;
    const sk = step * (1 + this.alt / 18);
    const ok = this._move(this.vel.x * dt + fx * sk, this.vel.y * dt + fz * sk);
    if (!ok) { this.goal = null; this.dolly = 0; }
    // (wandered off from the place: no longer there)
    if (this.here >= 0 && this.pos.distanceTo(this.hereAt) > 24) this.here = -1;
    // up and down
    const eye = this.pass && underRock(this.pass) ? Math.min(EYE, hgt(this.pass.s) - 0.3) : EYE;
    // (come down over the wood no lower than well above it)
    const low = this.alt > 0.5 && inWood(this.pos.x, this.pos.z) ? Math.min(this.alt, OVER_WOOD) : 0;
    this.alt = this.pass ? 0 : clamp(this.alt + rise * (5 + this.alt * 0.9) * dt, low, Math.max(0, TOP - this.ground - eye));
    // the eye's height: over the ground (averaged more widely the higher it is, so it glides), never under it
    let g = this.ground;
    if (!this.pass) {
      const r = 0.7 + this.alt * 0.25;
      let s = 0;
      for (const [ox, oz] of [[r, 0], [-r, 0], [0, r], [0, -r]]) s += openGround(this.pos.x + ox, this.pos.z + oz);
      g = Math.max(g, (s + g) / 5);
    }
    const want = g + eye + this.alt;
    this.pos.y += (want - this.pos.y) * (1 - Math.exp(-dt * (this.alt > 2 ? 2.5 : 12)));
    this.pos.y = Math.max(this.pos.y, this.ground + Math.min(eye, 0.9));
    this._camera();
    // the marker ripples out and fades
    const M = this.marker;
    if (M.visible) {
      M.userData.t += dt;
      const t = M.userData.t;
      M.material.opacity = 0.7 * (1 - smoothstep(0.2, 1.4, t));
      M.scale.multiplyScalar(1 + dt * 0.9);
      if (t > 1.4) M.visible = false;
    }
    // the eye opening up in the dark of the passage
    const P = this.pass;
    return P ? 1 + 1.1 * smoothstep(0.5, 7, P.s) * (1 - smoothstep(L - 14, L - 3, P.s)) : 1;
  }
  _camera() {
    const cam = this.camera, p = this.pos;
    cam.position.copy(p);
    const cp = Math.cos(this.pitch);
    cam.lookAt(p.x + Math.sin(this.yaw) * cp, p.y + Math.sin(this.pitch), p.z + Math.cos(this.yaw) * cp);
    if (Math.abs(cam.fov - this.fov) > 1e-3) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
  }
  // a jump to a place: paper comes down, the view moves under it, the paper lifts
  _fade(dt) {
    const F = this.fade, IN = 0.45, OUT = 0.7;
    F.t += dt;
    if (!F.done) {
      this.dipEl.style.opacity = String(smoothstep(0, IN, F.t));
      if (F.t >= IN + 0.1) { this.place(F.pl.p, F.pl.l, PLACES.indexOf(F.pl)); F.done = true; F.t = 0; }
    } else {
      this.dipEl.style.opacity = String(1 - smoothstep(0, OUT, F.t));
      if (F.t >= OUT) { this.dipEl.style.opacity = '0'; this.fade = null; }
    }
  }
}
