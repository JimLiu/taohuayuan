// Where the text's things are in the world: what a tap on the view lands on. The boat, the big tree and the
// houses stand up off the ground and are met as rough spheres along the ray; everything else is known by
// where the ray meets the ground (or water).
import * as THREE from 'three';
import { surfaceHeight } from '../world/terrain.js';
import { creekX, creekHW, creekDist, forestMask, basinR, pondDist, fieldAt, EXIT, ENTRY, BIG_TREE, WATER_OUT, PATHS_NS, PATHS_EW, FIELD_BOUNDS } from '../world/layout.js';
import { UNITS, toWorld, unitToVillage, unitAt } from '../world/villageplan.js';
import { LANDMARKS } from './glossary.js';

const HOUSES = UNITS.map((un) => {
  const [x, z] = toWorld(...unitToVillage(un, 0, un.porch / 2));
  return new THREE.Sphere(new THREE.Vector3(x, surfaceHeight(x, z) + 2.4, z), Math.max(un.w, un.d + un.porch) * 0.55);
});
const TREE = new THREE.Sphere(new THREE.Vector3(BIG_TREE.x, surfaceHeight(BIG_TREE.x, BIG_TREE.z) + 6.5, BIG_TREE.z), 7);
const _p = new THREE.Vector3(), _s = new THREE.Sphere();

// ray: from the eye through the tap; hit: where it meets the ground, or null; boat: the story's boat state
export function landmarkAt(ray, hit, boat) {
  const far = hit ? ray.origin.distanceTo(hit) + 1.5 : 1200;
  let best = null, bt = far;
  const test = (sphere, key) => {
    if (!ray.intersectSphere(sphere, _p)) return;
    const t = ray.origin.distanceTo(_p);
    if (t < bt) { bt = t; best = key; }
  };
  const inBasin = ray.origin.z < -30;
  if (!inBasin && boat && boat.visible !== false) test(_s.set(new THREE.Vector3(creekX(boat.z), WATER_OUT + 0.8, boat.z), 4.2), 'boat');
  if (inBasin || ray.origin.y > 150) {
    test(TREE, 'tree');
    for (const h of HOUSES) test(h, 'houses');
  }
  if (best) return { key: best, ...LANDMARKS[best] };
  if (!hit) return null;
  const key = regionAt(hit.x, hit.y, hit.z);
  return key ? { key, ...LANDMARKS[key] } : null;
}

function regionAt(x, y, z) {
  if (Math.hypot(x - EXIT.x, z - EXIT.z) < 9 && Math.abs(y - EXIT.y) < 9) return 'exit';
  if (Math.hypot(x - ENTRY.x, z - ENTRY.z) < 11 && y < ENTRY.y + 12) return 'mouth';
  if (basinR(x, z) < 0.99 && z < -30) {
    if (pondDist(x, z) < 2) return 'pond';
    if (unitAt(x, z, 1)) return 'houses';
    const inFields = x > FIELD_BOUNDS.x0 && x < FIELD_BOUNDS.x1 && z < FIELD_BOUNDS.z0 && z > FIELD_BOUNDS.z1 - 4;
    if (inFields && (PATHS_NS.some((p) => Math.abs(x - p) < 2.4) || PATHS_EW.some((p) => Math.abs(z - p) < 2.4))) return 'paths';
    if (fieldAt(x, z) || inFields) return 'fields';
    if (y > 6) return 'hills';
    return null;
  }
  if (z > 40 && creekDist(x, z) < 0.6 && Math.abs(x - creekX(z)) < creekHW(z) + 1) return 'creek';
  if (forestMask(x, z) > 0.15) return 'forest';
  if (y > 24) return 'mountain';
  return null;
}
