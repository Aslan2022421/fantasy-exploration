// 量聚落：起點周圍 (2r+1)² 區裡，每 100 個陸地區有幾座村莊、城鎮、據點；有幾處據點的對手是聚落；
// 起點村莊走不走得出去（從廣場走到離圖樣 30 格外）。用法：node tools/measure-settles.mjs [種子] [往外幾區]

import { LAND } from '../src/world/landform.js';
import { gapBetweenRects, SETTLE } from '../src/world/settlements.js';
import { createWorld, startPosition } from '../src/world/world.js';
import { loadData } from './data.mjs';

const data = loadData();
const seed = Number(process.argv[2] ?? 20261112);
const R = Number(process.argv[3] ?? 8);
const t0 = performance.now();
const world = createWorld(seed, data);
const home = world.startVillage;
const sz = Math.floor(home.x0 / world.zoneSize);
const szy = Math.floor(home.y0 / world.zoneSize);
let land = 0;
const count = { village: 0, town: 0, nest: 0, rival: 0 };
const nests = [];
const settles = [];
for (let zy = szy - R; zy <= szy + R; zy++)
  for (let zx = sz - R; zx <= sz + R; zx++) {
    const r = world.region(zx, zy);
    if (!r || r.height < LAND.water) continue;
    land++;
    const s = world.settleOf(zx, zy);
    if (s) {
      count[data.settlements[s.kind].id]++;
      settles.push(s);
    }
    const n = world.nestOf(zx, zy);
    if (n) nests.push(n);
  }
count.nest = nests.length;
for (const n of nests) if (settles.some((s) => gapBetweenRects(n, s) < SETTLE.rival)) count.rival++;
const per = (n) => ((n / land) * 100).toFixed(1);
console.log(`種子 ${seed}，起點周圍 ${2 * R + 1}×${2 * R + 1} 區，陸地 ${land} 區`);
console.log(
  `每 100 個陸地區：村莊 ${per(count.village)}、城鎮 ${per(count.town)}、據點 ${per(count.nest)}；對手是聚落的據點 ${count.rival}/${count.nest}`,
);
console.log(
  `起點村莊 ${home.name}：外形 ${home.layout.form}，出入口 ${home.layout.gates.length} 個，民房 ${home.layout.homes.length} 間`,
);

// 起點走不走得出去：不看生物，只看地面
const p = startPosition(world);
const seen = new Set([`${p.x},${p.y}`]);
const queue = [p];
let reached = 0;
for (let q = 0; q < queue.length && q < 200000; q++) {
  const c = queue[q];
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const n = { x: c.x + dx, y: c.y + dy };
      const k = `${n.x},${n.y}`;
      if (seen.has(k) || !world.groundPassable(n.x, n.y)) continue;
      seen.add(k);
      queue.push(n);
      const gx = Math.max(home.x0 - n.x, 0, n.x - (home.x0 + home.w - 1));
      const gy = Math.max(home.y0 - n.y, 0, n.y - (home.y0 + home.h - 1));
      reached = Math.max(reached, Math.max(gx, gy));
    }
}
console.log(`從起點走得到離村莊最遠 ${reached} 格（搜尋上限 20 萬格）`);
console.log(`耗時 ${Math.round(performance.now() - t0)} 毫秒`);
