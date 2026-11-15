// 物種量測：多個種子各生一個 3×3 區的小世界並全部展開，量每區幾群、每群幾隻、各生態遇到哪些物種、
// 山上與水邊的物種、一區的生成時間。調 src/world/herds.js 的 HERD 與 data/species 時用。
// 用法：node tools/measure-species.mjs [種子數，預設 12]

import { blockText, buildBlock } from '../src/data/blocks.js';
import { createWorld } from '../src/world/world.js';
import { loadData } from './data.mjs';

const data = loadData();
const SEEDS = Number(process.argv[2] ?? 12);
const SMALL = { zonesX: 3, zonesY: 3 };

let zones = 0;
let landZones = 0;
let herds = 0;
let members = 0;
const bySpecies = new Map(); // 物種 id → { herds, members }
const byBiome = new Map(); // 生態 id → Map(物種 id → 群數)
const perZoneSpecies = [];
const perZoneHerds = [];
const diet = { herbivore: 0, predator: 0 };
const startMs = [];

for (let s = 0; s < SEEDS; s++) {
  const seed = 1000 + s * 7919;
  const t0 = performance.now();
  const w = createWorld(seed, data, SMALL);
  startMs.push(performance.now() - t0);
  for (let zy = 0; zy < w.zonesY; zy++)
    for (let zx = 0; zx < w.zonesX; zx++) {
      zones++;
      const list = w.herdsOf(zx, zy);
      if (w.region(zx, zy).height >= -0.34) {
        landZones++;
        perZoneHerds.push(list.length);
        perZoneSpecies.push(new Set(list.map((h) => h.species)).size);
      }
      for (const h of list) {
        const sp = data.species[h.species];
        const lead = h.members[0];
        const c = w.cell(lead.x, lead.y);
        const key = c.landform.id === 'mountain' ? '（山地）' : c.biome.id;
        herds++;
        members += h.members.length;
        diet[sp.diet]++;
        const e = bySpecies.get(sp.id) ?? { herds: 0, members: 0 };
        e.herds++;
        e.members += h.members.length;
        bySpecies.set(sp.id, e);
        const m = byBiome.get(key) ?? new Map();
        m.set(sp.id, (m.get(sp.id) ?? 0) + 1);
        byBiome.set(key, m);
      }
    }
}

const mean = (a) => (a.reduce((x, y) => x + y, 0) / a.length).toFixed(2);
console.log(`${SEEDS} 個種子、${zones} 區（陸地 ${landZones} 區）`);
console.log(
  `陸地每區群數 平均 ${mean(perZoneHerds)}，每區物種數 平均 ${mean(perZoneSpecies)}，每群平均 ${(members / herds).toFixed(2)} 隻`,
);
console.log(`草食 ${diet.herbivore} 群、掠食 ${diet.predator} 群；建世界 平均 ${mean(startMs)} 毫秒`);
console.log('\n各生態遇到的物種（群數）：');
for (const [biome, m] of [...byBiome].sort()) {
  const row = [...m]
    .sort((a, b) => b[1] - a[1])
    .map(([id, n]) => `${data.species[data.speciesIndex.get(id)].name}${n}`);
  console.log(`  ${biome}：${row.join('、')}`);
}
console.log(
  '\n沒出現過的物種：',
  data.species
    .filter((s) => !bySpecies.has(s.id))
    .map((s) => s.name)
    .join('、') || '沒有',
);
console.log('\n各物種的數值塊（沒加環境）：');
for (const sp of data.species)
  console.log(`  ${sp.name}（${sp.footprint} ${sp.height} 層）${blockText(buildBlock(sp.answers))}`);

// 一區生成多花多少時間（有物種跟沒有物種）
const withSp = createWorld(1000, data, SMALL);
const none = createWorld(1000, { ...data, species: [] }, SMALL);
const time = (w) => {
  const t0 = performance.now();
  for (let zy = 0; zy < 3; zy++) for (let zx = 0; zx < 3; zx++) w.zone(zx, zy);
  return (performance.now() - t0) / 9;
};
console.log(`\n一區生成：有物種 ${time(withSp).toFixed(1)} 毫秒，沒有物種 ${time(none).toFixed(1)} 毫秒`);
