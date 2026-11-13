// 地點的文字：右鍵查看一格、狀態列顯示目前在哪一區

import { CLIMATE_NAMES } from './labels.js';

// 查看一格：「草地。溫帶森林（溫和、普通），高度 132」；世界外回傳 null
export function describePlace(world, x, y) {
  const c = world.cell(x, y);
  if (!c) return null;
  const b = c.biome;
  const climate = `${CLIMATE_NAMES[b.temperature]}、${CLIMATE_NAMES[b.moisture]}`;
  const blocked = c.terrain.passable ? '' : '，過不去';
  return `${c.terrain.name}${blocked}。${b.name}（${climate}），高度 ${c.height}`;
}

// 狀態列：「區 1,1 溫帶森林」（世界層那一區的生態，不是腳下那一格的）
export function regionLabel(world, data, x, y) {
  const r = world.regionAt(x, y);
  if (!r) return '';
  const biome = data.biomes.find((b) => b.id === r.biome);
  return `區 ${r.zx},${r.zy} ${biome?.name ?? r.biome}`;
}
