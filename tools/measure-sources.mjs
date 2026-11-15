// 資源來源量測：多個種子各生一個 3×3 區的小世界並全部展開，量礦坑、草本、樹與矮叢有多少、
// 各生態裡的來源數量。調 src/world/objects.js 的 PLACE 參數時用。
// 用法：node tools/measure-sources.mjs [種子數，預設 10]

import { createWorld } from '../src/world/world.js';
import { loadData } from './data.mjs';

const data = loadData();
const SEEDS = Number(process.argv[2] ?? 10);
const mines = data.objects.filter((o) => o.layers).map((o) => o.id);
const kinds = [...mines, 'herb', 'shrub', ...data.objects.filter((o) => o.trunk).map((o) => o.id)];
const idOf = Object.fromEntries(kinds.map((k) => [data.objectIndex.get(k), k]));

let land = 0;
const total = Object.fromEntries(kinds.map((k) => [k, 0]));
const byBiome = {}; // 生態 → { 陸地格, 各種來源 }

for (let s = 0; s < SEEDS; s++) {
  const w = createWorld(1000 + s * 7919, data, { zonesX: 3, zonesY: 3 });
  for (let y = 0; y < w.height; y++) {
    for (let x = 0; x < w.width; x++) {
      if (w.waterAt(x, y) >= 0) continue;
      land++;
      const b = data.biomes[w.biomeAt(x, y)].name;
      byBiome[b] ??= { land: 0 };
      byBiome[b].land++;
      const o = w.objectAt(x, y);
      const k = idOf[o];
      if (!k) continue;
      // 多格的樹只數樹幹那格（一棵算一次）
      if (data.objects[o].trunk && w.anchorAt(x, y) && w.isPassable(x, y)) continue;
      // 礦坑只數錨點那格（一處算一次）
      if (data.objects[o].layers && (w.anchorAt(x, y).x !== x || w.anchorAt(x, y).y !== y)) continue;
      total[k]++;
      byBiome[b][k] = (byBiome[b][k] ?? 0) + 1;
    }
  }
}

const pct = (a, b) => `${((100 * a) / Math.max(1, b)).toFixed(2)}%`;
const perZone = (n) => (n / SEEDS / 9).toFixed(1);
console.log(`${SEEDS} 個種子，每個 3×3 區`);
console.log(`陸地 ${land} 格`);
console.log('每區平均：');
for (const k of kinds)
  console.log(`  ${k.padEnd(10)} ${perZone(total[k]).padStart(8)}  （陸地的 ${pct(total[k], land)}）`);
console.log('各生態（每 1 萬格陸地）：');
for (const [b, c] of Object.entries(byBiome)) {
  const per = (k) => (((c[k] ?? 0) * 10000) / c.land).toFixed(1).padStart(6);
  const mine = mines.map((k) => `${data.objects[data.objectIndex.get(k)].name}${per(k)}`).join(' ');
  console.log(
    `  ${b.padEnd(6, '　')} 陸地 ${String(c.land).padStart(7)}｜${mine} 草本${per('herb')} 矮叢${per('shrub')}`,
  );
}
