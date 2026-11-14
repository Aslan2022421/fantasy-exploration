// 採集模擬：用 src/world/gather.js 的同一套規則，量各環境的產出：
// 每種生態的矮叢讀 2000 處，數每種材料出現的比例
// 用法：node tools/sim-gather.mjs

import { RNG } from 'rot-js';
import { drawOne, readComposition } from '../src/world/gather.js';
import { loadData } from './data.mjs';

const data = loadData();
const name = (m) => data.materials[data.materialIndex.get(m)].name;
const rng = RNG.clone().setSeed(20261114);

function share(counts) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([m, n]) => `${name(m)} ${((100 * n) / total).toFixed(0)}%`)
    .join('、');
}

const shrub = data.objects[data.objectIndex.get('shrub')];
console.log(`各生態第一次採${shrub.name}的材料（高度層 2，現存都是 0）`);
for (const b of data.biomes) {
  const counts = {};
  const env = { biome: b.id, tier: 2, mountain: false, waterDist: Number.POSITIVE_INFINITY };
  for (let i = 0; i < 2000; i++) {
    const comp = readComposition(shrub.gather, env, data, {}, rng);
    const m = drawOne(comp, data, {}, rng);
    if (m) counts[m] = (counts[m] ?? 0) + 1;
  }
  console.log(`  ${b.name.padEnd(5, '　')} ${share(counts)}`);
}
