// 地點的文字：右鍵查看一格、狀態列顯示目前在哪一區

import { CLIMATE_NAMES } from './labels.js';

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
  let what;
  if (c.object) what = `${c.object.name}${c.trunk ? '的樹幹' : ''}，長在${ground}上${landform}`;
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
