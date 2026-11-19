// 新寫進的紀錄動到哪些格子（畫面要丟掉快取的）：
// - 生物的移動、倒下（紀錄的 cells 是格子陣列）
// - 據點的人口變了（擲對抗、重生、外面那群倒下一隻），範圍跟著變：整塊據點（data.area）
// - 擲對抗的對手是聚落時，聚落的人口也可能變，範圍跟著變：整塊聚落

import { nestArea } from '../world/nests.js';
import { settleArea } from '../world/settlements.js';

const areaCells = (a) => {
  const out = [];
  for (let y = a.y0; y <= a.y1; y++) for (let x = a.x0; x <= a.x1; x++) out.push({ x, y });
  return out;
};

export function changedCells(game, fromId) {
  const world = game.world;
  const cells = [];
  for (let i = fromId; i < game.log.size; i++) {
    const rec = game.log.get(i);
    const d = rec.data;
    if (Array.isArray(d?.cells)) cells.push(...d.cells);
    if (d?.area) cells.push(...areaCells(d.area));
    else if (d?.nest?.id && world.nestById(d.nest.id)) cells.push(...areaCells(nestArea(world.nestById(d.nest.id))));
    if (d?.settle && rec.verb === 'nestroll') cells.push(...areaCells(settleArea(world.settleById(d.settle))));
  }
  return cells;
}
