// 释义: a few words of the text worth stopping on (tapped in the captions), and the things of the scene that
// the text names (tapped in the view): each with its line of the original and a short note.

// the words, by the chapter whose line they are read in
export const KEYWORDS = [
  { w: '缘', in: '缘溪', note: '沿着，顺着。' },
  { w: '落英缤纷', in: '落英', note: '英：花。缤纷：繁多交杂的样子。落花纷纷飘洒。' },
  { w: '仿佛', in: '小口', note: '隐隐约约，看不真切。' },
  { w: '豁然开朗', in: '开朗', note: '豁然：开阔敞亮的样子。由狭窄幽暗忽然变得开阔明亮。' },
  { w: '俨然', in: '平旷', note: '整齐的样子。（今多作“好像”讲，此处不同。）' },
  { w: '阡陌交通', in: '阡陌', note: '阡陌：田间小路，南北为阡、东西为陌。交通：交错相通，不是今天的“交通”。' },
  { w: '黄发垂髫', in: '怡然', note: '黄发：老人发白转黄，指老人；垂髫：孩童垂下的短发，指孩子。' },
  { w: '要', in: '作食', note: '通“邀”，邀请。' },
  { w: '妻子', in: '避秦', note: '妻子和儿女（古今异义）。' },
  { w: '绝境', in: '避秦', note: '与外界隔绝的地方，不是“绝望的境地”。' },
  { w: '无论', in: '叹惋', note: '更不必说（古今异义）。' },
  { w: '志', in: '志之', note: '做标记。' },
  { w: '诣', in: '郡下', note: '到……去，多指拜见尊长。' },
  { w: '问津', in: '问津', note: '津：渡口。问津：打听渡口，引申为探访、过问。' },
];

// the scene's things, as the text has them (where each is in the world: landmarks.js)
export const LANDMARKS = {
  boat: { name: '渔舟', orig: '晋太元中，武陵人捕鱼为业。……便舍船，从口入。', note: '武陵渔人的小船。他缘溪而上，在山前舍船入洞；出来时“得其船”，循原路回去。' },
  forest: { name: '桃花林', orig: '忽逢桃花林，夹岸数百步，中无杂树，芳草鲜美，落英缤纷。', note: '夹溪两岸只有桃树，“中无杂树”；春日落花铺满溪岸与水面。' },
  creek: { name: '溪', orig: '缘溪行，忘路之远近。', note: '渔人沿这条溪水逆流而上，走得忘了远近，才遇见桃林。' },
  mountain: { name: '山', orig: '林尽水源，便得一山，山有小口，仿佛若有光。', note: '桃林在溪水源头处到了尽头，一座山挡在面前。' },
  mouth: { name: '小口', orig: '山有小口，仿佛若有光。便舍船，从口入。初极狭，才通人。', note: '山脚的小洞口，窄得只容一人通过，里面隐约透出光亮。' },
  exit: { name: '洞口', orig: '复行数十步，豁然开朗。', note: '走出幽暗的山洞，眼前忽然一片开阔明亮。' },
  fields: { name: '良田', orig: '土地平旷，屋舍俨然，有良田、美池、桑竹之属。', note: '平坦开阔的田地，春水初平，秧苗新绿。' },
  paths: { name: '阡陌', orig: '阡陌交通，鸡犬相闻。其中往来种作……', note: '田间小路纵横相通；人们在其间往来耕作。' },
  pond: { name: '美池', orig: '有良田、美池、桑竹之属。', note: '村边的池塘，水面映着天光与岸边的桑竹。' },
  houses: { name: '屋舍', orig: '土地平旷，屋舍俨然。……便要还家，设酒杀鸡作食。', note: '房舍排列整齐；村人邀渔人到家中，摆酒杀鸡款待。' },
  tree: { name: '村口大树', orig: '黄发垂髫，并怡然自乐。', note: '老人在树下闲坐，孩子们在一旁嬉戏，都安闲自得。' },
  hills: { name: '四面群山', orig: '自云先世避秦时乱，率妻子邑人来此绝境，不复出焉，遂与外人间隔。', note: '群山合抱，只有那条窄洞相通，所以说是“绝境”。' },
};
