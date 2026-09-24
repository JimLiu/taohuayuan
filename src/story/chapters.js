// 循文入境: the whole of 《桃花源记》 as a sequence of shots. Each chapter carries its line of the text,
// a plain gloss, a camera path cam(u) for u in 0..1, the time of day, scripted gusts, and where the boat is.
// Two narrative cuts (郡下, 刘子骥) are paper cards, as a handscroll would pass over them in a line of text.
import { creekX, WATER_OUT as W, EXIT, ENTRY, BIG_TREE, THRESH } from '../world/layout.js';
import { at } from '../world/villageplan.js';
import { passagePoint, TUNNEL_LEN as LEN } from '../world/tunnel.js';

const lerp = (a, b, t) => a + (b - a) * t;
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const L3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];

// Catmull-Rom through keys [[u, pos, look], ...]; the look is interpolated as a direction so the camera turns, not slides
function keys(K) {
  const cr = (p0, p1, p2, p3, t) => {
    const t2 = t * t, t3 = t2 * t;
    return p1.map((_, i) => 0.5 * (2 * p1[i] + (-p0[i] + p2[i]) * t + (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * t2 + (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * t3));
  };
  const dirs = K.map((k) => norm(sub(k[2], k[1])));
  return (u) => {
    let i = 0;
    while (i < K.length - 2 && u > K[i + 1][0]) i++;
    const t = Math.min(1, Math.max(0, (u - K[i][0]) / (K[i + 1][0] - K[i][0])));
    const g = (j) => K[Math.min(K.length - 1, Math.max(0, j))];
    const p = cr(g(i - 1)[1], g(i)[1], g(i + 1)[1], g(i + 2)[1], t);
    const dj = (j) => dirs[Math.min(K.length - 1, Math.max(0, j))];
    const d = norm(cr(dj(i - 1), dj(i), dj(i + 1), dj(i + 2), t));
    return { p, l: add(p, d, 60) };
  };
}

// Durations here are the pace each move was made for; the recitation sets how long a shot actually lasts
// (see director.js). A shorter window plays the first part of the move at this pace, unless span: 1 says the
// whole move must be seen, and then u runs 0..1 over the recitation's window.

// a point on the creek (water level + up), shifted sideways
const cp = (z, up = 0, side = 0) => [creekX(z) + side, W + up, z];
// camera trailing a boat on the creek at z (the boat heading upstream, -z)
const trail = (z, back, up, ahead, side = 0, lookUp = 1.2) => ({ p: cp(z + back, up, side), l: cp(z - ahead, lookUp) });
const eye = (s, h = 1.55) => { const q = passagePoint(s); return [q.x, q.y + h, q.z]; };

export const PANO = { p: [EXIT.x + 0.2, EXIT.y + 1.62, EXIT.z + 2.2], l: [22, 1, -205] };
// (a step forward from it while the view sinks in)
const PANO2 = [EXIT.x + 0.25, EXIT.y + 1.72, EXIT.z + 1.3];
const moored = { z: 55, moored: true, visible: true };

export const CHAPTERS = [
  // ———————————————————————————————— 缘溪行
  {
    name: '捕鱼', orig: '晋太元中，武陵人捕鱼为业。', gloss: '东晋太元年间，武陵郡有个人以打鱼为生。', brief: '东晋太元年间，武陵有个渔人。',
    dur: 11, time: 'morning',
    cam: keys([[0, [creekX(930) + 34, 46, 935], cp(760, 0)], [1, [creekX(890) + 22, 36, 880], cp(700, 2)]]),
    boat: (u) => ({ z: lerp(812, 786, u), visible: true }),
  },
  {
    name: '缘溪', orig: '缘溪行，忘路之远近。', gloss: '他沿着溪水划船前行，忘记了走了多远的路。', brief: '沿溪划船，忘了走了多远。',
    dur: 12, mist: 1.8,
    cam: keys([[0, [18, 16, 512], cp(505, 0.5)], [0.5, [12, 24, 520], cp(470, 1)], [1, [6, 36, 530], cp(380, 3)]]),
    boat: (u) => ({ z: lerp(508, 468, u), visible: true }),
  },
  {
    name: '逢林', orig: '忽逢桃花林，夹岸数百步，', gloss: '忽然遇见一片桃花林，生长在溪水两岸，长达几百步。', brief: '忽遇桃林，夹着两岸，长达数百步。',
    dur: 6, span: 1, gusts: [0.2], storm: 0.75, mist: 2.6,
    // low over the water just behind the boat as it slides in under the first crowns (the reference's river shot)
    cam: (u) => {
      const z = lerp(394, 373, u);
      return trail(z, lerp(8.5, 7.5, u), lerp(2.5, 2.1, u), 40, lerp(0.8, 0.3, u), lerp(2.6, 2.3, u));
    },
    boat: (u) => ({ z: lerp(394, 373, u), visible: true }),
  },
  {
    name: '落英', orig: '中无杂树，芳草鲜美，落英缤纷。', gloss: '林中没有别的树，花草鲜嫩美丽，落花纷纷扬扬。', brief: '林中没有杂树，芳草鲜美，落花纷飞。',
    dur: 14, gusts: [0.15, 0.6], storm: 1, mist: 2,
    // on the east bank among the trees, petals underfoot, the creek glinting beyond
    cam: (u) => {
      const z = lerp(258.8, 254.6, u);
      const p = [lerp(21.0, 22.5, u), 0, z];
      const l = [lerp(12, 7, u), W + lerp(1.2, 2.6, ss(0.45, 1, u)), lerp(236, 230, u)];
      return { p, l, above: lerp(1.15, 1.4, u) };
    },
    boat: (u) => ({ z: lerp(250, 244, u), visible: true }),
  },
  {
    name: '穷林', orig: '渔人甚异之。复前行，欲穷其林。', gloss: '渔人对此感到非常惊异，又继续向前划去，想走到林子的尽头。', brief: '渔人很惊异，又往前划，想走到林子尽头。',
    dur: 12, storm: 0.6, gusts: [0.35], mist: 2.2,
    cam: (u) => trail(lerp(206, 172, u), lerp(9, 10.5, u), lerp(2.3, 3.2, u), 45, -0.6, 2.4),
    boat: (u) => ({ z: lerp(206, 170, u), visible: true }),
  },
  {
    name: '得山', orig: '林尽水源，便得一山，', gloss: '桃林在溪水的源头处到了尽头，眼前便出现一座山。', brief: '林子在溪水源头处到了头，见到一座山。',
    dur: 7, span: 1,
    cam: keys([[0, cp(122, 5, 2), [0, 16, 40]], [1, cp(96, 15, -3), [2, 26, 30]]]),
    boat: (u) => ({ z: lerp(80, 62, u), visible: true }),
  },
  {
    name: '小口', orig: '山有小口，仿佛若有光。', gloss: '山上有个小洞口，里面隐隐约约好像有光亮。', brief: '山上有个小洞口，隐约像有光亮。',
    dur: 6, span: 1,
    cam: keys([[0, [11, 12.5, 70], [ENTRY.x, ENTRY.y + 1.3, ENTRY.z]], [1, [6.2, 10.3, 47.5], [ENTRY.x - 0.3, ENTRY.y + 1.2, ENTRY.z - 3]]]),
    boat: () => ({ ...moored, man: 'look' }),
  },
  {
    name: '舍船', orig: '便舍船，从口入。', gloss: '渔人便下了船，从洞口走进去。', brief: '于是下船，从洞口走进去。',
    dur: 4.5, span: 1, ease: 0.25, inside: true, exposure: (u) => 1 + 0.9 * ss(0.4, 1, u),
    cam: keys([[0, [6.6, ENTRY.y + 1.62, 45.5], eye(2, 1.4)], [0.5, eye(-2.2), eye(5, 1.4)], [1, eye(4.5), eye(11, 1.35)]]),
    boat: () => moored,
  },
  {
    name: '极狭', orig: '初极狭，才通人。', gloss: '起初洞口很窄，仅容一人通过。', brief: '起初洞很窄，只容一人通过。',
    dur: 4.6, span: 1, inside: true, fov: 58, ease: 0, petals: 0.15, exposure: 2.1,
    cam: (u) => { const s = lerp(4.5, 16.5, u); return { p: eye(s), l: eye(s + 6, 1.4) }; },
    boat: () => moored,
  },
  {
    name: '开朗', orig: '复行数十步，豁然开朗。', gloss: '又走了几十步，眼前突然变得开阔明亮。', brief: '又走几十步，眼前忽然开阔明亮。',
    dur: 14.5, span: 1, dip: 'dark', inside: true, ease: 0, petals: 0, exposure: (u) => (u < 0.3 ? 2.1 : 1),
    cam: (u) => {
      // the last dozen steps toward the light, slowing as the view opens (豁然开朗 at u 0.34); then it sinks in
      const s = lerp(LEN - 12, LEN - 2.2, ss(0, 0.36, u));
      const p = L3(L3(eye(s, 1.55), PANO.p, ss(0.3, 0.55, u)), PANO2, ss(0.55, 1, u));
      const ahead = eye(Math.min(s + 6, LEN + 4), 1.45);
      const d0 = norm(sub(ahead, p)), d1 = norm(sub(PANO.l, p));
      const k = ss(0.28, 0.52, u);
      return { p, l: add(p, norm(L3(d0, d1, k)), 60), fov: lerp(58, 50, ss(0.32, 0.6, u)) };
    },
    boat: () => moored,
  },
  // ———————————————————————————————— 豁然开朗
  {
    name: '平旷', orig: '土地平旷，屋舍俨然，', gloss: '这里土地平坦开阔，房屋整整齐齐。', brief: '土地平坦开阔，房屋整整齐齐。',
    dur: 26.7, span: 1, inside: true,
    // (rising to the right of the old pine by the cave mouth, not through it), then out over the fields to the village
    cam: keys([[0, PANO2, PANO.l], [0.25, [1.5, 19.5, -50.5], [24, 1, -210]], [0.6, [0, 34, -72], [34, 0, -232]], [1, [10, 30, -112], [38, 2, -246]]]),
    boat: () => moored,
  },
  {
    name: '良田', orig: '有良田、美池、桑竹之属。', gloss: '有肥沃的田地、美丽的池塘，以及桑树、竹子之类。', brief: '有良田、美池和桑竹之类。',
    dur: 13,
    cam: keys([[0, [-22, 26, -96], [-74, -0.3, -206]], [0.55, [-70, 18, -138], [-74, 0, -230]], [1, [-104, 15, -164], [-30, 6, -318]]]),
  },
  {
    name: '阡陌', orig: '阡陌交通，鸡犬相闻。', gloss: '田间小路交错相通，村落间鸡鸣狗叫之声彼此都能听到。', brief: '田间小路交错相通，鸡鸣狗叫处处可闻。',
    dur: 12,
    cam: keys([[0, [-128, 2.4, -131], [-40, 1.2, -132]], [0.6, [-72, 2.2, -131], [0, 1, -136]], [1, [-50, 3.2, -128], [10, 1, -176]]]),
  },
  {
    name: '种作', orig: '其中往来种作，男女衣着，悉如外人。', gloss: '人们来来往往耕种劳作，男女的穿戴，和桃源外的人完全一样。', brief: '人们往来耕作，衣着和外面的人一样。',
    dur: 13,
    cam: keys([[0, [66, 6.5, -108], [112, 0.6, -148]], [1, [104, 4.6, -120], [140, 0.6, -172]]]),
  },
  {
    name: '怡然', orig: '黄发垂髫，并怡然自乐。', gloss: '老人和孩子们，都安闲快乐，自得其乐。', brief: '老人和孩子都安闲快乐。',
    dur: 12,
    cam: (u) => {
      const a = lerp(0.5, 1.35, u), r = lerp(15, 12, u);
      return { p: [BIG_TREE.x + Math.sin(a) * r, 3.4, BIG_TREE.z + Math.cos(a) * r], l: [BIG_TREE.x, 1.5, BIG_TREE.z] };
    },
  },
  // ———————————————————————————————— 见渔人
  {
    name: '问讯', orig: '见渔人，乃大惊，问所从来。具答之。', gloss: '他们看见渔人，非常惊讶，问他从哪里来。渔人详细地作了回答。', brief: '见了渔人大吃一惊，问他从哪来；他一一作答。',
    dur: 12,
    cam: keys([[0, [4.8, 2.5, -93], [-0.6, 1.5, -104]], [1, [2.8, 2.2, -96], [-0.8, 1.5, -104]]]),
  },
  {
    name: '作食', orig: '便要还家，设酒杀鸡作食。', gloss: '便邀请渔人到自己家里，摆酒杀鸡做饭来款待他。', brief: '便邀他到家里，摆酒杀鸡做饭。',
    dur: 12, time: ['morning', 'noon'],
    // through the gap in the front row, over the host's fence: the table in the yard, the kitchen smoking
    cam: keys([[0, at(-20, 21, 6.5), at(-33, 7.5, 1.0)], [1, at(-23.5, 17.5, 4.6), at(-33.5, 7, 1.2)]]),
  },
  {
    name: '咸来', orig: '村中闻有此人，咸来问讯。', gloss: '村里的人听说来了这么一个人，都来打听消息。', brief: '村里人听说来了这个人，都来打听。',
    dur: 11, time: 'noon',
    // down the lane to the host's gate, where the neighbours gather
    cam: keys([[0, at(-9, 19.5, 3.2), at(-29, 12.5, 1.2)], [1, at(-15, 17.5, 3.6), at(-30, 12, 1.2)]]),
  },
  {
    name: '避秦', orig: '自云先世避秦时乱，率妻子邑人来此绝境，不复出焉，遂与外人间隔。',
    gloss: '他们自己说祖先为躲避秦时的战乱，带领妻子儿女和乡邻来到这与世隔绝的地方，再也没有出去，于是和外面的人断绝了往来。', brief: '说祖先为避秦乱来到这绝境，从此与外界隔绝。',
    dur: 15, time: 'noon',
    cam: (u) => {
      // from the middle of the basin, turning slowly: the mountains close round on every side
      const a = lerp(-2.2, 0.35, u);
      const p = [THRESH.x, lerp(16, 34, u), THRESH.z];
      return { p, l: [p[0] + Math.sin(a) * 100, p[1] + lerp(4, 10, u), p[2] + Math.cos(a) * 100], fov: 56 };
    },
  },
  {
    name: '叹惋', orig: '问今是何世，乃不知有汉，无论魏晋。此人一一为具言所闻，皆叹惋。',
    gloss: '问现在是什么朝代，他们竟不知道有过汉朝，更不必说魏朝和晋朝了。渔人把自己知道的事一一详细告诉他们，他们都感叹惋惜。', brief: '竟不知有汉朝，更别说魏晋；听他讲了都叹惋。',
    dur: 18.2, span: 1, time: ['noon', 'noon', 'dusk'],
    // in the yard, facing the porch where they sit and listen
    cam: keys([[0, at(-26.6, 11.2, 3.0), at(-32.5, 4.6, 1.4)], [1, at(-27.6, 9.8, 2.6), at(-32.8, 4.4, 1.4)]]),
  },
  {
    name: '停数日', orig: '余人各复延至其家，皆出酒食。停数日，辞去。', gloss: '其余的人又各自邀请渔人到自己家中，都拿出酒饭来款待。渔人停留了几天，才告辞离开。', brief: '各家轮流请他吃喝；住了几天，告辞离开。',
    dur: 18, time: ['dusk', 'night', 'night', 'dawn', 'noon', 'dusk', 'night', 'dawn', 'morning'],
    cam: keys([[0, [150, 42, -160], [45, 0, -252]], [1, [128, 36, -150], [25, 0, -242]]]),
  },
  {
    name: '勿道', orig: '此中人语云：“不足为外人道也。”', gloss: '这里的人叮嘱他说：“这里的事情不值得对外面的人说啊。”', brief: '临别叮嘱：“不值得对外人说。”',
    dur: 11, time: 'morning',
    cam: keys([[0, [4.6, 2.9, -97], [0.2, 1.6, -84]], [0.45, [3.8, 3.6, -93], [-0.6, 4.5, -72]], [1, [2.2, 6.2, -80], [EXIT.x, EXIT.y + 1.6, EXIT.z]]]),
  },
  // ———————————————————————————————— 既出
  {
    name: '志之', orig: '既出，得其船，便扶向路，处处志之。', gloss: '渔人出来以后，找到了他的船，就顺着来时的路回去，处处都做了标记。', brief: '出来找到船，沿旧路回去，处处做记号。',
    dur: 12.7, span: 1, time: 'morning', inside: true, ease: 0.3,
    exposure: (u) => (u < 0.42 ? 2.1 : u < 0.5 ? 3.2 : 1),
    cam: keys([
      [0, eye(10), eye(-4, 1.2)], [0.44, eye(0.6), eye(-10, 0.9)],
      [0.56, [ENTRY.x + 0.6, ENTRY.y + 2.2, ENTRY.z + 4.5], cp(55, 0.4)],
      [0.74, [ENTRY.x + 2.6, ENTRY.y + 3.6, ENTRY.z + 10], cp(57, 0.5)],
      [1, [ENTRY.x + 4.5, ENTRY.y + 5.2, ENTRY.z + 16], cp(72, 0.6)],
    ]),
    // (he is at the boat when the glare clears) untying the stern rope, turning the bow off the bank, away downstream
    boat: (u) => ({
      z: lerp(55, 76, ss(0.74, 1, u)), visible: true, moored: u < 0.72, man: u < 0.47 ? 'none' : u < 0.72 ? 'untie' : 'punt',
      turn: ss(0.72, 0.88, u), bank: 1 - ss(0.72, 0.9, u), down: true,
    }),
  },
  {
    name: '郡下', orig: '及郡下，诣太守，说如此。', gloss: '到了武陵郡城，他去拜见太守，报告了这番经历。', brief: '到了郡城，拜见太守，说了这番经历。',
    dur: 7, cut: true, time: 'overcast',
    cam: () => trail(150, 16, 3.2, 40, -2),
    boat: () => ({ visible: false }),
  },
  {
    name: '遂迷', orig: '太守即遣人随其往，寻向所志，遂迷，不复得路。', gloss: '太守立即派人跟着他前往，寻找先前所做的标记，结果迷失了方向，再也找不到那条路。', brief: '太守派人跟他去找记号，却迷了路。',
    dur: 15, time: 'overcast',
    cam: (u) => {
      const z = lerp(150, 118, u);
      const t = trail(z, 16, 3.2, 40, -2);
      const yaw = Math.sin(u * 5.2) * 0.55 * ss(0.15, 0.6, u);
      const d = sub(t.l, t.p), c = Math.cos(yaw), s = Math.sin(yaw);
      return { p: t.p, l: add(t.p, [d[0] * c - d[2] * s, d[1], d[0] * s + d[2] * c]) };
    },
    boat: (u) => ({ z: lerp(150, 118, u) - 6, visible: true, crew: 2 }),
  },
  {
    name: '子骥', orig: '南阳刘子骥，高尚士也，闻之，欣然规往。未果，寻病终。', gloss: '南阳人刘子骥，是一位志向高洁的隐士，听到这件事，高兴地计划前往。没有实现，不久就病死了。', brief: '高士刘子骥听说后欣然计划前往，未成便病逝。',
    dur: 9, cut: true, time: 'morning',
    cam: () => ({ p: cp(222, 1.1, 1.5), l: cp(212, 0.1, 1) }),
    boat: () => ({ visible: false }),
  },
  {
    name: '问津', orig: '后遂无问津者。', gloss: '此后就再也没有探访桃花源的人了。', brief: '此后再没有人探访了。',
    dur: 5.6, span: 1, time: 'morning', gusts: [0.2], storm: 0.5,
    cam: keys([[0, cp(222, 1.1, 1.5), cp(212, 0.1, 1)], [0.45, cp(230, 3.5, 2.5), cp(196, 2, 0)], [1, cp(252, 14, 6), [4, 30, 30]]]),
    boat: () => ({ visible: false }),
  },
  {
    name: '终', orig: '', cutText: '桃花源记', gloss: '陶渊明',
    dur: 5, cut: true, end: true,
    cam: () => ({ p: cp(330, 58, 10), l: [4, 40, 30] }),
    boat: () => ({ visible: false }),
  },
];
