// 地點的文字：右鍵查看一格、狀態列顯示目前在哪一區

import { buildBlock } from '../data/blocks.js';
import { DATA } from '../data/load.js';
import { foeStats, foeText } from './foes.js';
import { CLIMATE_NAMES } from './labels.js';

// 生物：「狼（一群 4 隻，生命 15/15，攻擊 +3，防禦 10，護甲 1，傷害 1d12−2）。本能：⋯⋯；招式：⋯⋯」。
// 數值塊照當地的環境加答案（寒帶、山地、靠水）；第一句是懸停提示框用的
const ADAPTATION_NAMES = {
  climb: '善攀',
  swim: '會游',
  amphibious: '兩棲',
  fly: '飛行',
  'cold-hardy': '耐寒',
  constrict: '纏繞',
};

export function creatureText({ herd, species, hp }) {
  const sp = DATA.species[species];
  const adapt = buildBlock(sp.answers, herd.env)
    .adaptations.map((a) => ADAPTATION_NAMES[a])
    .join('、');
  const stats = foeStats(sp, herd.env);
  const head = `${sp.name}（一群 ${herd.members.length} 隻，${foeText(stats, hp ?? stats.hp)}）`;
  return `${head}。本能：${sp.instinct}；招式：${sp.moves.join('；')}${adapt ? `；特質：${adapt}` : ''}`;
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
    (!c.water || c.water.passable) && c.surface.passable && (!c.object || (c.object.passable && !c.trunk));
  const blocked = passable ? '' : '，過不去';
  const ground = groundName(c);
  const lake = c.water && c.water.style !== 'swamp';
  const landform = lake ? '' : `，${c.landform.name}`;
  if (c.creature) return `${creatureText(c.creature)}。${ground}${landform}。${b.name}（${climate}），高度 ${c.height}`;
  let what;
  const state = c.picked ? '（採過了）' : c.worked ? '（挖過了）' : '';
  // 植物（含樹樁）「長在」地上，礦坑「在」地上
  const grows = ['chop', 'pick'].includes(c.object?.gather?.action) || c.object?.id === 'stump';
  // 樹寫樹種與類名：「雲杉（針葉樹）」，同一個字的不同樹靠這裡分得出來
  const family = c.object?.family ? `（${c.object.family}）` : '';
  if (c.object) what = `${c.object.name}${family}${state}，${grows ? '長在' : '在'}${ground}上${landform}`;
  else what = `${c.cover ? `${c.cover.name}，` : ''}${ground}${landform}`;
  return `${what}${blocked}。${b.name}（${climate}），高度 ${c.height}`;
}

// 狀態列：「區 1,1 溫帶森林」（世界層那一區的生態，不是腳下那一格的）
export function regionLabel(world, data, x, y) {
  const r = world.regionAt(x, y);
  if (!r) return '';
  const biome = data.biomes.find((b) => b.id === r.biome);
  return `區 ${r.zx},${r.zy} ${biome?.name ?? r.biome}`;
}
