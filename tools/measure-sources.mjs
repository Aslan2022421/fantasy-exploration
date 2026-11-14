// 資源來源量測：多個種子各生一個 3×3 區的小世界並全部展開，量岩壁、礦脈、草本、樹與矮叢有多少、
// 岩石格子有幾成變成岩壁、各生態裡的來源數量。調 src/world/objects.js 的 PLACE 參數時用。
// 用法：node tools/measure-sources.mjs [種子數，預設 10]

import { envAt } from '../src/world/gather.js';
import { createWorld } from '../src/world/world.js';
import { loadData } from './data.mjs';

const data = loadData();
const SEEDS = Number(process.argv[2] ?? 10);
const ROCK = data.surfaceIndex.get('rock');
const kinds = ['rock-wall', 'vein', 'herb', 'shrub', ...data.objects.filter((o) => o.trunk).map((o) => o.id)];
const idOf = Object.fromEntries(kinds.map((k) => [data.objectIndex.get(k), k]));

let land = 0;
let rock = 0;
const total = Object.fromEntries(kinds.map((k) => [k, 0]));
const byBiome = {}; // 生態 → { 陸地格, 各種來源 }
let veinsByWater = 0; // 3 格內有河或湖的礦脈（產砂金）

for (let s = 0; s < SEEDS; s++) {
  const w = createWorld(1000 + s * 7919, data, { zonesX: 3, zonesY: 3 });
  for (let y = 0; y < w.height; y++) {
    for (let x = 0; x < w.width; x++) {
      if (w.waterAt(x, y) >= 0) continue;
      land++;
      const b = data.biomes[w.biomeAt(x, y)].name;
      byBiome[b] ??= { land: 0 };
      byBiome[b].land++;
      if (w.surfaceAt(x, y) === ROCK) rock++;
      const o = w.objectAt(x, y);
      const k = idOf[o];
      if (!k) continue;
      // 多格的樹只數樹幹那格（一棵算一次）
      if (data.objects[o].trunk && w.anchorAt(x, y) && w.isPassable(x, y)) continue;
      total[k]++;
      byBiome[b][k] = (byBiome[b][k] ?? 0) + 1;
      if (k === 'vein' && envAt(w, data, data.objects[o].gather, x, y).waterDist <= 3) veinsByWater++;
    }
  }
}

const pct = (a, b) => `${((100 * a) / Math.max(1, b)).toFixed(2)}%`;
const perZone = (n) => (n / SEEDS / 9).toFixed(1);
console.log(`${SEEDS} 個種子，每個 3×3 區`);
console.log(
  `陸地 ${land} 格，岩石 ${pct(rock, land)}；岩石格子變成岩壁或礦脈 ${pct(total['rock-wall'] + total.vein, rock)}`,
);
console.log('每區平均：');
for (const k of kinds)
  console.log(`  ${k.padEnd(10)} ${perZone(total[k]).padStart(8)}  （陸地的 ${pct(total[k], land)}）`);
console.log(`礦脈佔岩壁加礦脈的 ${pct(total.vein, total['rock-wall'] + total.vein)}`);
console.log(`3 格內有河或湖的礦脈 ${pct(veinsByWater, total.vein)}`);
console.log('各生態（每 1 萬格陸地）：');
for (const [b, c] of Object.entries(byBiome)) {
  const per = (k) => (((c[k] ?? 0) * 10000) / c.land).toFixed(1).padStart(6);
  console.log(
    `  ${b.padEnd(6, '　')} 陸地 ${String(c.land).padStart(7)}｜岩壁${per('rock-wall')} 礦脈${per('vein')} 草本${per('herb')} 矮叢${per('shrub')}`,
  );
}
