// 地點的文字：右鍵查看一格、狀態列顯示目前在哪一區

import { buildBlock } from '../data/blocks.js';
import { DATA } from '../data/load.js';
import { foeStats, foeText } from './foes.js';
import { CLIMATE_NAMES } from './labels.js';

// 生物：「狼（一群 4 隻，生命 15/15）。攻擊 +3，防禦 10，⋯⋯。本能：⋯⋯；招式：⋯⋯」。
// 數值塊照當地的環境加答案（寒帶、山地、靠水）；第一句是懸停提示框用的，只放一眼看得懂的，其餘留給右鍵查看
const ADAPTATION_NAMES = {
  climb: '善攀',
  swim: '會游',
  amphibious: '兩棲',
  fly: '飛行',
  'cold-hardy': '耐寒',
  constrict: '纏繞',
};

const DIET_NAMES = { herbivore: '草食', predator: '掠食', omnivore: '混食' };
const traitText = (t) =>
  ({
    regenerate: `再生（受傷後每 ${t.every} 刻回 ${t.amount} 生命，受火焰傷害那 ${t.every} 刻停止）`,
    'no-fatigue': '不會疲勞',
    fearless: '不會恐懼',
    'poison-immune': '不受一般毒素影響',
  })[t.id];

export function creatureText({ herd, species, hp }) {
  const sp = DATA.species[species];
  const adapt = buildBlock(sp.answers, herd.env)
    .adaptations.map((a) => ADAPTATION_NAMES[a])
    .join('、');
  const traits = (sp.traits ?? []).map(traitText).join('、');
  const stats = foeStats(sp, herd.env);
  const head = `${sp.name}（一群 ${herd.members.length} 隻，生命 ${hp ?? stats.hp}/${stats.hp}）`;
  const tail = [
    `食性：${DIET_NAMES[sp.diet]}`,
    `本能：${sp.instinct}`,
    `招式：${sp.moves.join('；')}`,
    ...(adapt ? [`特質：${adapt}`] : []),
    ...(traits ? [`特性：${traits}`] : []),
  ].join('；');
  return `${head}。${foeText(stats)}。${tail}`;
}

// 地面叫什麼：有水寫水文（結冰的淺水寫冰），不然寫材質
export function groundName(c) {
  return c.water && c.surface.style !== 'ice' ? c.water.name : c.surface.name;
}

// 查看一格，照四層寫：「細草，泥土，平原。溫帶森林（溫和、普通），高度 132」；
// 有物件時寫在最前面：「闊葉樹，長在泥土上，平原。⋯⋯」；深水、淺水不寫地貌；世界外回傳 null
export function describePlace(world, x, y) {
  const c = world.cell(x, y);
  if (!c) return null;
  const b = c.biome;
  const climate = `${CLIMATE_NAMES[b.temperature]}、${CLIMATE_NAMES[b.moisture]}`;
  const passable =
    (!c.water || c.water.passable || !!c.object?.bridge) &&
    c.surface.passable &&
    (!c.object || (c.object.passable && !c.trunk));
  const blocked = passable ? '' : '，過不去';
  const ground = groundName(c);
  const lake = c.water && c.water.style !== 'swamp';
  const landform = lake ? '' : `，${c.landform.name}`;
  if (c.creature) return `${creatureText(c.creature)}。${ground}${landform}。${b.name}（${climate}），高度 ${c.height}`;
  if (c.npc) return `${npcText(c.npc)}。可以說話（Q 或撞上去）。${settleText(world, c.settle)}`;
  let what;
  const state = c.picked ? '（採過了）' : c.worked ? '（挖過了）' : '';
  // 植物（含樹樁）「長在」地上，礦坑「在」地上
  const grows = ['chop', 'pick'].includes(c.object?.gather?.action) || c.object?.id === 'stump';
  // 樹寫樹種與類名：「雲杉（針葉樹）」，同一個字的不同樹靠這裡分得出來
  const family = c.object?.family ? `（${c.object.family}）` : '';
  if (c.object) what = `${c.object.name}${family}${state}，${grows ? '長在' : '在'}${ground}上${landform}`;
  else what = `${c.cover ? `${c.cover.name}，` : ''}${ground}${landform}`;
  return `${settleText(world, c.settle)}${nestText(world, c.nest)}${what}${blocked}。${b.name}（${climate}），高度 ${c.height}`;
}

// 村民：「艾德（人類，松鴉村的村民）」
function npcText(npc) {
  const race = DATA.races[DATA.raceIndex.get(npc.villager.race)]?.name ?? '';
  return `${npc.villager.name}（${race}，${npc.settle.name}的村民）`;
}

// 聚落的圖樣或範圍裡：「松鴉村。村莊，人口穩定，經濟貧窮，資源：木材。村民抱怨附近的樹越來越少。」
// 懸停框只取第一句（名字）；人口、經濟都只寫標籤
function settleText(world, at) {
  if (!at) return '';
  const s = at.settle;
  const def = DATA.settlements[s.kind];
  const econ = world.settleEcon(s);
  const sign = econ.sign ? `${econ.sign}。` : '';
  return `${s.name}。${def.name}，人口${world.settleTag(s).name}，經濟${world.econName(econ.tag)}，資源：${world.settleResource(s)}。${sign}`;
}

// 據點的圖樣或範圍裡：「廢棄的堡壘。哥布林的據點，壯大。」（懸停框只取第一句，只寫名字）；標籤就是徵兆，人口不寫
function nestText(world, at) {
  if (!at) return '';
  const def = DATA.nests[at.nest.kind];
  const sp = DATA.species[DATA.speciesIndex.get(def.species)];
  const empty = world.nestState(at.nest.id).pop <= 0;
  return `${def.name}。${sp.name}的據點，${empty ? '已經沒有怪物了' : world.nestTag(at.nest).name}。`;
}

// 世界地圖選中的地方（{ settle } 或 { nest }）：跟右鍵查看同一套句子
export const placeSummary = (world, p) => (p.settle ? settleText(world, p) : nestText(world, p));

// 狀態列：「區 1,1 溫帶森林」（世界層那一區的生態，不是腳下那一格的）
export function regionLabel(world, data, x, y) {
  const r = world.regionAt(x, y);
  if (!r) return '';
  const biome = data.biomes.find((b) => b.id === r.biome);
  return `區 ${r.zx},${r.zy} ${biome?.name ?? r.biome}`;
}
