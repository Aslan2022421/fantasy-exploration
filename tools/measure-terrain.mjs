// 地形量測：多個種子各生一個 3×3 區的小世界並全部展開，量各地形的比例、起點那區走得到的比例、每個世界有幾種生態、
// 明暗級數的分布、生成時間。調 src/world/terrain.js 的 GEN 參數時用。
// 用法：node tools/measure-terrain.mjs [種子數，預設 20]

import { readdirSync, readFileSync } from 'node:fs';
import { buildData } from '../src/data/build.js';
import { createWorld, startPosition } from '../src/world/world.js';

const root = new URL('../', import.meta.url);
function readKind(kind) {
  const dir = new URL(`data/${kind}/`, root);
  const files = {};
  for (const f of readdirSync(dir))
    if (f.endsWith('.json')) files[f] = JSON.parse(readFileSync(new URL(f, dir), 'utf8'));
  return files;
}
const data = buildData({ terrain: readKind('terrain'), object: readKind('object'), biome: readKind('biome') });

const SEEDS = Number(process.argv[2] ?? 20);
const O = data.objects;
// 四層各自的比例：[資料裡的條目, 生成結果的欄位]
const LAYERS = [
  ['地貌', data.landforms, 'landform'],
  ['材質', data.surfaces, 'surface'],
  ['水文', data.waters, 'water'],
  ['生態覆蓋', data.covers, 'cover'],
];
const counts = LAYERS.map(([, list]) => new Array(list.length).fill(0));
const objectCounts = new Array(O.length).fill(0);
const shade = new Array(8).fill(0);
const reach = [];
const biomeKinds = [];
const regionBiomes = {};
const zoneMs = [];
let firstMs = 0;
let cells = 0;

// 起點那區裡，從起點八方向走得到的格子佔那區能走格子的比例
function reachable(world, start) {
  const Z = world.zoneSize;
  const zx = Math.floor(start.x / Z);
  const zy = Math.floor(start.y / Z);
  const inZone = (x, y) => Math.floor(x / Z) === zx && Math.floor(y / Z) === zy;
  const seen = new Set([`${start.x},${start.y}`]);
  const stack = [start];
  while (stack.length) {
    const p = stack.pop();
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = p.x + dx;
        const y = p.y + dy;
        const k = `${x},${y}`;
        if (seen.has(k) || !inZone(x, y) || !world.isPassable(x, y)) continue;
        seen.add(k);
        stack.push({ x, y });
      }
    }
  }
  let passable = 0;
  for (let y = zy * Z; y < (zy + 1) * Z; y++)
    for (let x = zx * Z; x < (zx + 1) * Z; x++) if (world.isPassable(x, y)) passable++;
  return seen.size / passable;
}

for (let s = 1; s <= SEEDS; s++) {
  const seed = s * 104729;
  const world = createWorld(seed, data, { zonesX: 3, zonesY: 3 });
  for (let zy = 0; zy < world.zonesY; zy++) {
    for (let zx = 0; zx < world.zonesX; zx++) {
      const t0 = performance.now();
      const z = world.zone(zx, zy);
      const ms = performance.now() - t0;
      if (s === 1 && zx === 0 && zy === 0) firstMs = ms;
      else zoneMs.push(ms);
      for (let i = 0; i < z.surface.length; i++) {
        LAYERS.forEach(([, list, key], k) => {
          if (z[key][i] < list.length) counts[k][z[key][i]]++;
        });
        if (z.object[i]) objectCounts[z.object[i] - 1]++;
        shade[z.shade[i]]++;
      }
      cells += z.surface.length;
    }
  }
  reach.push(reachable(world, startPosition(world)));
  const kinds = new Set(world.regions.map((r) => r.biome));
  biomeKinds.push(kinds.size);
  for (const r of world.regions) regionBiomes[r.biome] = (regionBiomes[r.biome] ?? 0) + 1;
}

const pct = (n, d) => `${((100 * n) / d).toFixed(1)}%`;
const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
console.log(`種子 ${SEEDS} 個，每個 ${3}×${3} 區、共 ${cells} 格\n`);
LAYERS.forEach(([name, list], k) => {
  console.log(`${name}比例：${list.map((t, i) => `${t.name} ${pct(counts[k][i], cells)}`).join('、')}`);
});
const blocked = data.waters.reduce((n, t, i) => n + (t.passable ? 0 : counts[2][i]), 0);
console.log(`不能走的水 ${pct(blocked, cells)}`);
console.log('物件比例（佔全部格子）：');
for (let i = 0; i < O.length; i++) console.log(`  ${O[i].name}（${O[i].id}）${pct(objectCounts[i], cells)}`);
reach.sort((a, b) => a - b);
console.log(`\n起點那區走得到的比例：最低 ${pct(reach[0], 1)}、中位 ${pct(reach[Math.floor(reach.length / 2)], 1)}`);
console.log(`每個世界的生態種類（世界層 9 區）：平均 ${avg(biomeKinds).toFixed(1)}、最少 ${Math.min(...biomeKinds)}`);
console.log(
  `世界層各生態出現次數：${Object.entries(regionBiomes)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${v}`)
    .join('、')}`,
);
const shadeTotal = shade.reduce((a, b) => a + b, 0);
console.log(`\n明暗級數分布（0 暗～7 亮）：${shade.map((n) => pct(n, shadeTotal)).join(' ')}`);
zoneMs.sort((a, b) => a - b);
console.log(
  `\n一區生成：第一區 ${firstMs.toFixed(1)} 毫秒；之後平均 ${avg(zoneMs).toFixed(1)}、最慢 ${zoneMs.at(-1).toFixed(1)} 毫秒`,
);
