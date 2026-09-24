import * as THREE from 'three';
import { G, patchChunks, hookAll, SUN_DIR } from './core/shared.js';
import { creekX, creekHW, creekDist, pondDist, basinR, EXIT, ENTRY } from './world/layout.js';
import { buildTerrain, tileRes, surfaceHeight } from './world/terrain.js';
import { buildSky, buildRidges } from './world/sky.js';
import { buildTunnel, passagePoint, TUNNEL_LEN } from './world/tunnel.js';
import { buildWater, WaterReflection } from './world/water.js';
import { buildPeachForest, peachDensityFn } from './world/peach.js';
import { buildPetals } from './world/petals.js';
import { bakeGround, buildGrass } from './world/grass.js';
import { buildFarmland } from './world/fields.js';
import { buildVillage } from './world/village.js';
import { buildSmoke } from './world/smoke.js';
import { buildFlora } from './world/flora.js';
import { buildBanks } from './world/banks.js';
import { buildMarkers } from './world/markers.js';
import { buildBoat } from './actors/boat.js';
import { buildLife } from './actors/people.js';
import { loadBoatman } from './actors/skinned.js';
import { loadElder } from './actors/elder.js';
import { Daylight } from './world/daylight.js';
import { Director } from './story/director.js';
import { AUDIO } from './story/narration.js';
import { Sound } from './audio/sound.js';
import { Captions } from './ui/captions.js';
import { UI } from './ui/ui.js';
import { FOREST, HOME } from './story/roam.js';

window.__boot = true; // (the page's script did arrive: see the guard in index.html)
const setLoad = (p, msg) => {
  const r = document.getElementById('loadRing');
  if (r) r.style.strokeDashoffset = String(1 - Math.max(0.015, Math.min(1, p)));
  if (msg) document.getElementById('loadMsg').textContent = msg;
};
const tick = () => new Promise((r) => setTimeout(r, 0));
// something the page cannot do without: said plainly on the loading screen, with a way to try again
function fatal(msg, retry = true) {
  const L = document.getElementById('load');
  if (!L) { alert(msg); return; }
  L.style.opacity = '1';
  document.getElementById('loadMsg').classList.add('hidden');
  document.getElementById('loadErr').classList.remove('hidden');
  document.getElementById('loadErrMsg').textContent = msg;
  const b = document.getElementById('btnReload');
  b.classList.toggle('hidden', !retry);
  b.onclick = () => location.reload();
}
// textures that fail to arrive leave their surfaces plain; the viewer is told once the scene is up
const missing = [];
THREE.DefaultLoadingManager.onError = (url) => { missing.push(url); console.warn('missing', url); };

function creekTexture() {
  const N = 1024, data = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    const z = -100 + (i / (N - 1)) * 1400;
    data[i * 4] = creekX(Math.max(z, 46));
    data[i * 4 + 1] = creekHW(Math.max(z, 46));
  }
  const t = new THREE.DataTexture(data, N, 1, THREE.RGBAFormat, THREE.FloatType);
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

export const VIEWS = {
  forest: { pos: FOREST.p, look: FOREST.l },
  panorama: { pos: [EXIT.x + 0.2, EXIT.y + 1.62, EXIT.z + 2.2], look: [22, 1, -205] },
  overview: { pos: [260, 320, 260], look: [0, 0, -120] },
  creek: { pos: [30, 14, 420], look: [0, 9, 250] },
};

async function boot() {
  patchChunks();
  const canvas = document.getElementById('c');
  const params = new URLSearchParams(location.search);
  // an opaque drawing buffer: alpha-to-coverage leaves write their alpha, and the page must not show through them
  const gl = params.has('nogl') ? null : canvas.getContext('webgl2', { alpha: false, antialias: true, powerPreference: 'high-performance', stencil: false, depth: true });
  if (!gl) {
    fatal('此浏览器或设备无法启用 WebGL 2，三维场景无法显示。请使用新版 Chrome、Edge、Safari 或 Firefox，并确认浏览器设置中已开启“硬件加速”。', false);
    return;
  }
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); fatal('图形设备中断（WebGL 上下文丢失），请重新加载页面。'); });
  const renderer = new THREE.WebGLRenderer({ canvas, context: gl, antialias: true, powerPreference: 'high-performance', stencil: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping; // keeps petal pinks and young greens from hue-shifting
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false; // once per frame, shared by the reflection and the main pass
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xffffff, 1, 2); // enables USE_FOG so the patched atmosphere runs
  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 8000);
  camera.layers.enable(1); // layer 1: drawn to screen but kept out of the water reflection

  G.uCreekTex.value = creekTexture();
  setLoad(0.05);

  const sun = new THREE.DirectionalLight(new THREE.Color(1.0, 0.93, 0.82), 3.0);
  sun.position.copy(SUN_DIR).multiplyScalar(300);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  Object.assign(sun.shadow.camera, { left: -140, right: 140, top: 140, bottom: -140, near: 10, far: 700 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.05;
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(new THREE.Color(0.62, 0.72, 0.85), new THREE.Color(0.32, 0.3, 0.22), 1.1);
  scene.add(hemi);

  scene.add(buildSky());
  scene.add(buildRidges());
  setLoad(0.15, '缘溪行，忘路之远近');
  await tick();
  let t0 = performance.now();
  const peach = buildPeachForest();
  console.log('peach', (performance.now() - t0).toFixed(0), 'ms', peach.userData.trees.length, 'trees');
  setLoad(0.3, '忽逢桃花林，夹岸数百步');
  await tick();
  const blush = peachDensityFn(peach.userData.trees);
  const terrain = buildTerrain(blush);
  scene.add(terrain, peach);
  t0 = performance.now();
  const ground = bakeGround(tileRes, blush);
  const grass = buildGrass(ground);
  Object.assign(terrain.userData.material.userData.uniforms, grass.userData.groundUniforms);
  scene.add(grass);
  console.log('ground+grass', (performance.now() - t0).toFixed(0), 'ms');
  t0 = performance.now();
  const petals = buildPetals(peach.userData.trees);
  scene.add(petals);
  console.log('petals', (performance.now() - t0).toFixed(0), 'ms', petals.userData.settledCount, 'settled');
  setLoad(0.5, '芳草鲜美，落英缤纷');
  await tick();
  t0 = performance.now();
  const tunnel = buildTunnel();
  scene.add(tunnel);
  console.log('tunnel', (performance.now() - t0).toFixed(0), 'ms');
  setLoad(0.6, '初极狭，才通人');
  await tick();
  const water = buildWater();
  scene.add(water);
  t0 = performance.now();
  const fields = buildFarmland();
  scene.add(fields);
  water.add(fields.userData.paddies); // hidden with the other water while the reflection renders
  water.userData.reflTargets.push(fields.userData.reflUniforms);
  console.log('fields', (performance.now() - t0).toFixed(0), 'ms');
  t0 = performance.now();
  const village = buildVillage();
  village.add(buildSmoke(village.userData.chimneys));
  scene.add(village);
  console.log('village', (performance.now() - t0).toFixed(0), 'ms', village.userData.mesh.geometry.attributes.position.count / 3, 'tris');
  t0 = performance.now();
  const flora = buildFlora();
  scene.add(flora);
  console.log('flora', (performance.now() - t0).toFixed(0), 'ms', flora.userData.trees.length, 'trees');
  t0 = performance.now();
  const banks = await buildBanks(peach.userData.trees);
  scene.add(banks);
  console.log('banks', (performance.now() - t0).toFixed(0), 'ms', banks.userData.rocks, 'rocks', banks.userData.ferns, 'ferns');
  const markers = buildMarkers(peach.userData.trees);
  scene.add(markers);
  await Promise.all([loadBoatman(), loadElder()]);
  const boat = buildBoat();
  scene.add(boat);
  t0 = performance.now();
  const life = buildLife();
  scene.add(life);
  console.log('life', (performance.now() - t0).toFixed(0), 'ms', life.userData.crowd.figures.length, 'people', life.userData.herd.animals.length, 'animals');
  // only one side of the mountain is ever in view: outside the cave the basin's things are put away, inside
  // the creek's (in the passage both stand; from high above, everything)
  const zones = {
    basin: [village, fields, fields.userData.paddies, flora.userData.zones.basin, life],
    creek: [peach, petals, flora.userData.zones.creek, banks, boat],
  };
  const cullZones = () => {
    // (while roaming high up, from where both sides of the mountain are in view)
    const p = camera.position, high = p.y > 150 || (!director.active && director.roam.aloft());
    const b = high || p.z < ENTRY.z + 2, c = high || p.z > EXIT.z + 4;
    for (const o of zones.basin) o.visible = b;
    for (const o of zones.creek) o.visible = c;
    tunnel.visible = high || (p.z > -80 && p.z < 130);
  };
  const reflection = new WaterReflection(renderer, water);

  hookAll(scene);

  const daylight = new Daylight(sun, hemi);
  const sound = new Sound(params.get('voice') || AUDIO.src);
  const captions = new Captions();
  const director = new Director({ camera, daylight, canvas, renderer, sound, captions });
  director.reduce = matchMedia('(prefers-reduced-motion: reduce)').matches || params.get('motion') === 'reduce';
  document.body.classList.toggle('reduce', director.reduce);
  scene.add(director.roam.marker);
  // what the walker keeps out of: the trunks, the boulders along the banks, the boat
  director.roam.setObstacles({
    posts: [
      ...peach.userData.trees.map((t) => ({ x: t.x + t.lean.x * 1.2, z: t.z + t.lean.z * 1.2, r: peach.userData.templates[t.tpl].tree.branches[0].rads[0] * t.s + 0.04 })),
      ...flora.userData.trees.map((t) => ({ x: t.x, z: t.z, r: (t.trunkR ?? 0.25) + 0.03 })),
      ...banks.userData.stones.map((s) => ({ x: s.x, z: s.z, r: s.r * 0.72, top: s.top })),
    ],
    hull: boat.userData.hull,
    wood: flora.userData.wood,
  });
  const setView = (v) => {
    const V = typeof v === 'string' ? VIEWS[v] : v;
    director.setBase(V.pos, V.look);
  };
  // (the viewer begins in the peach wood, on the creek)
  if (params.get('shot') && VIEWS[params.get('shot')]) setView(params.get('shot'));
  else director.roam.placeNow(HOME);

  const placeShadow = () => {
    const f = new THREE.Vector3();
    camera.getWorldDirection(f);
    const c = camera.position.clone().addScaledVector(f, 90);
    c.y = 0;
    sun.target.position.copy(c);
    sun.position.copy(G.uSunDir.value).multiplyScalar(350).add(c);
    sun.target.updateMatrixWorld();
  };

  // adaptive resolution: hold the frame rate by trading pixels, never above the screen's own density
  // (frames longer than 0.1 s are hitches — a shader compiling, the tab coming back — and don't count)
  let maxPR = Math.min(window.devicePixelRatio || 1, 2);
  let pr = Math.min(maxPR, 1.5), last = performance.now(), acc = 0, frames = 0;
  renderer.setPixelRatio(pr);
  const adapt = () => {
    const now = performance.now(), d = (now - last) / 1000;
    last = now;
    if (d > 0.1) return;
    acc += d; frames++;
    if (acc < 1.5) return;
    const fps = frames / acc;
    acc = 0; frames = 0;
    let next = pr;
    if (fps < 50) next = Math.max(0.7, pr * Math.sqrt(fps / 58));
    else if (fps > 58.5 && pr < maxPR) next = Math.min(maxPR, pr * 1.1);
    if (Math.abs(next - pr) > 0.03) {
      pr = next;
      renderer.setPixelRatio(pr);
      renderer.setSize(window.innerWidth, window.innerHeight, false);
    }
  };

  // 画质: 高 (the screen's own density up to 2, a 4096 shadow map, a half-size reflection) or 轻量 (at most
  // one pixel per CSS pixel, a 2048 shadow map, a third-size reflection); 动态: the world's motion, or held still;
  // 保存画面: the next frame, as a PNG
  let shotWanted = null;
  const app = {
    quality: 'high',
    motion: true,
    setQuality(q) {
      this.quality = q === 'lite' ? 'lite' : 'high';
      const lite = this.quality === 'lite';
      maxPR = Math.min(window.devicePixelRatio || 1, lite ? 1 : 2);
      pr = Math.min(lite ? 0.9 : 1.5, maxPR);
      renderer.setPixelRatio(pr);
      renderer.setSize(window.innerWidth, window.innerHeight, false);
      const sm = lite ? 2048 : 4096;
      if (sun.shadow.mapSize.x !== sm) {
        sun.shadow.mapSize.set(sm, sm);
        sun.shadow.map?.dispose();
        sun.shadow.map = null;
      }
      reflection.scale = lite ? 0.34 : 0.5;
    },
    setMotion(on) { this.motion = !!on; director.worldRate = on ? 1 : 0; },
    shot() { return new Promise((res) => { shotWanted = res; }); },
  };
  const ui = new UI({ director, sound, captions, app, canvas, camera });

  const resize = () => {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);

  // what the place sounds like from here (when the viewer has turned it on)
  const ambience = (dt) => {
    if (!sound.ambient) return;
    const p = camera.position, g = surfaceHeight(p.x, p.z), high = Math.max(0, p.y - Math.max(g, 0) - 4);
    const far = 1 - Math.min(1, high / 60);
    let water, birds = true;
    const inBasin = basinR(p.x, p.z) < 0.99 && p.z < -30;
    if (p.z < 40 && p.z > -50 && p.y < g - 2) { water = 0.12; birds = false; } // (in the passage: a drip, no birds)
    else if (inBasin) water = 0.25 + 0.5 * Math.max(0, 1 - Math.max(0, pondDist(p.x, p.z)) / 40);
    else water = 0.15 + 0.85 * Math.max(0, 1 - Math.max(0, creekDist(p.x, p.z)) / 45);
    const wind = 0.25 + 0.75 * (director.gust.on ? G.uGust.value.y : 0) + 0.3 * (1 - far);
    sound.update(dt, { water: water * far, wind: Math.min(1, wind), birds });
  };
  const timer = new THREE.Timer();
  let t = 0;
  const frame = () => {
    timer.update();
    const dt = Math.min(timer.getDelta(), 0.05);
    if (app.motion) t += dt;
    G.uTime.value = t;
    director.update(dt);
    ui.update(dt);
    ambience(dt);
    cullZones();
    placeShadow();
    peach.userData.update(camera);
    petals.userData.update(camera);
    fields.userData.update(camera);
    flora.userData.update(camera);
    markers.userData.update(director.story, director.chapters[director.story.chapter]?.name);
    if (boat.visible) boat.userData.update(t, director.story, camera);
    if (life.visible) life.userData.update(t, camera, director.story, director.chapters[director.story.chapter]);
    renderer.shadowMap.needsUpdate = true;
    reflection.update(scene, camera, G);
    renderer.render(scene, camera);
    if (shotWanted) { const r = shotWanted; shotWanted = null; canvas.toBlob((b) => r(b), 'image/png'); }
    adapt();
  };
  renderer.setAnimationLoop(frame);
  setLoad(1);
  setTimeout(() => {
    const l = document.getElementById('load');
    l.style.opacity = '0';
    setTimeout(() => l.remove(), 1300);
    document.getElementById('ui').classList.remove('hidden');
    ui.shown();
    canvas.focus({ preventScroll: true });
    if (missing.length) ui.toast(`有 ${missing.length} 个贴图未能加载，部分表面会显得平淡。`, 6000);
    if (params.has('ch')) director.start(Math.min(+params.get('ch') || 0, director.chapters.length - 1));
  }, 300);

  // (a handle for tests and the console; the whole THREE namespace only in development, where it keeps the build from shedding what goes unused)
  window.__t = { renderer, scene, camera, G, setView, director, roam: director.roam, ui, sound, captions, app, surfaceHeight, daylight, sun, hemi, peach, petals, fields, village, flora, markers, boat, life, VIEWS, passagePoint, TUNNEL_LEN, reflection,
    info: () => ({ calls: renderer.info.render.calls, tris: renderer.info.render.triangles, programs: renderer.info.programs.length, pr: renderer.getPixelRatio().toFixed(2) }) };
  if (import.meta.env.DEV) window.__t.THREE = THREE;
}

boot().catch((e) => {
  console.error(e);
  fatal(`场景加载失败：${e.message}。请检查网络后重新加载；若是直接双击打开的 index.html，请改为通过网页服务器打开（见 README「打开方式」）。`);
});
