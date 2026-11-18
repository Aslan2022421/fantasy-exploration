// 據點的量測：起點周圍一塊區域裡，陸地區有幾成放了據點、各種類的比例、開局的人口與範圍、外面那群幾隻。
// 用法：node tools/measure-nests.mjs [種子，預設 20261112] [往外幾區，預設 6]

import { rangeOf } from '../src/world/nests.js';
import { createWorld, startPosition } from '../src/world/world.js';
import { loadData } from './data.mjs';

const data = loadData();
const seed = Number(process.argv[2] ?? 20261112);
const R = Number(process.argv[3] ?? 6);
const t0 = performance.now();
const world = createWorld(seed, data);
const start = startPosition(world);
const zx0 = Math.floor(start.x / world.zoneSize);
const zy0 = Math.floor(start.y / world.zoneSize);
let land = 0;
const kinds = {};
for (let zy = zy0 - R; zy <= zy0 + R; zy++)
  for (let zx = zx0 - R; zx <= zx0 + R; zx++) {
    const r = world.region(zx, zy);
    if (!r || r.numbers.herbivores === 0) continue; // 湖海的區
    land++;
    const n = world.nestOf(zx, zy);
    if (!n) continue;
    const def = data.nests[n.kind];
    const herd = world.herdsOf(zx, zy).find((h) => h.nest === n.id);
    kinds[def.name] ??= { count: 0, pop: 0, range: 0, herd: 0 };
    const k = kinds[def.name];
    k.count++;
    k.pop += n.pop0 / def.popMax;
    k.range += rangeOf(n.pop0, def.popMax);
    k.herd += herd ? Math.min(herd.members.length, n.pop0) : 0;
  }
const total = Object.values(kinds).reduce((s, k) => s + k.count, 0);
console.log(
  `種子 ${seed}，起點周圍 ${2 * R + 1}×${2 * R + 1} 區：陸地 ${land} 區，據點 ${total} 處（${((total / land) * 100).toFixed(0)}%）`,
);
for (const [name, k] of Object.entries(kinds))
  console.log(
    `${name}：${k.count} 處；開局人口平均 ${((k.pop / k.count) * 100).toFixed(0)}% 上限，範圍平均 ${(k.range / k.count).toFixed(1)} 格，外面那群平均 ${(k.herd / k.count).toFixed(1)} 隻`,
  );
console.log(`花了 ${((performance.now() - t0) / 1000).toFixed(1)} 秒`);
