// 採集模擬：用 src/world/gather.js 的同一套規則，量兩件事
// 1. 各環境的產出不一樣：每種生態的礦脈、矮叢各讀 2000 處，數每種材料出現的比例
// 2. 某種礦越挖越少見：在溫帶森林一處接一處挖礦脈（照實際規則讀組成、挖到挖穿），每 20 次看鐵礦佔幾成
// 用法：node tools/sim-gather.mjs

import { RNG } from 'rot-js';
import { drawOne, readComposition } from '../src/world/gather.js';
import { loadData } from './data.mjs';

const data = loadData();
const def = (id) => data.objects[data.objectIndex.get(id)].gather;
const name = (m) => data.materials[data.materialIndex.get(m)].name;
const rng = RNG.clone().setSeed(20261114);

function share(counts) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([m, n]) => `${name(m)} ${((100 * n) / total).toFixed(0)}%`)
    .join('、');
}

console.log('一、各環境第一次挖、採到的材料（現存都是 0）');
for (const [src, tiers] of [
  ['vein', [3, 9]],
  ['shrub', [2]],
]) {
  for (const tier of tiers) {
    console.log(`  ${data.objects[data.objectIndex.get(src)].name}（高度層 ${tier}）`);
    for (const b of data.biomes) {
      const counts = {};
      for (let i = 0; i < 2000; i++) {
        const comp = readComposition(def(src), { biome: b.id, tier }, data, {}, rng);
        const m = drawOne(comp, data, {}, rng);
        if (m) counts[m] = (counts[m] ?? 0) + 1;
      }
      console.log(`    ${b.name.padEnd(5, '　')} ${share(counts)}`);
    }
  }
}

console.log('\n二、在溫帶森林連續挖礦脈（高度層 3），每 20 次的產出');
const vein = def('vein');
const stock = {};
let comp = null;
let left = 0;
let block = {};
for (let dig = 1; dig <= 200; dig++) {
  if (left <= 0) {
    comp = readComposition(vein, { biome: 'temperate-forest', tier: 3 }, data, stock, rng);
    left = rng.getUniformInt(vein.uses[0], vein.uses[1]);
  }
  left--;
  const m = drawOne(comp, data, stock, rng);
  const n = m ? rng.getUniformInt(vein.amount[0], vein.amount[1]) : 0;
  if (m) stock[m] = (stock[m] ?? 0) + n;
  block[m ?? 'none'] = (block[m ?? 'none'] ?? 0) + 1;
  if (dig % 20 === 0) {
    const iron = block['iron-ore'] ?? 0;
    const none = block.none ?? 0;
    console.log(
      `  第 ${String(dig - 19).padStart(3)}～${String(dig).padStart(3)} 次：鐵礦 ${String(iron).padStart(2)} 次（現存 ${String(stock['iron-ore'] ?? 0).padStart(2)}／上限 40）｜銅礦 ${String(block['copper-ore'] ?? 0).padStart(2)} 次（現存 ${String(stock['copper-ore'] ?? 0).padStart(2)}／60）｜沒挖到 ${none} 次`,
    );
    block = {};
  }
}
