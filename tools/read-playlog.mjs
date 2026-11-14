// 讀使用者匯出的試玩紀錄（Esc 選單 → 匯出試玩紀錄），寫出摘要：玩了多久、走了幾步、到過哪幾區、
// 每次採集挖到什麼、背包裡有什麼。只讀紀錄，不重建世界。
// 用法：node tools/read-playlog.mjs <檔案.json>

import { readFileSync } from 'node:fs';
import { loadData } from './data.mjs';

const file = process.argv[2];
if (!file) {
  console.log('用法：node tools/read-playlog.mjs <檔案.json>');
  process.exit(1);
}
const log = JSON.parse(readFileSync(file, 'utf8'));
const data = loadData();
const name = (m) => data.materials[data.materialIndex.get(m)]?.name ?? m;
const records = log.records;

const verbs = {};
const zones = new Set();
let lastTime = 0;
const gathers = [];
for (const r of records) {
  verbs[r.verb] = (verbs[r.verb] ?? 0) + 1;
  lastTime = Math.max(lastTime, r.time + (r.data?.duration ?? 0));
  const at = r.data?.to ?? r.data?.at;
  if (at) zones.add(`${Math.floor(at.x / 96)},${Math.floor(at.y / 96)}`);
  if (r.verb === 'gather') gathers.push(r);
}

console.log(`匯出：${log.exported ?? '?'}｜遊戲版本 ${log.version ?? '?'}｜世界版本 ${log.world}｜種子 ${log.seed}`);
console.log(`紀錄 ${records.length} 筆，遊戲時間 ${lastTime} 回合；到過 ${zones.size} 區`);
console.log(
  `動作：${Object.entries(verbs)
    .map(([v, n]) => `${v} ${n}`)
    .join('、')}`,
);

const got = {};
const byObject = {};
for (const g of gathers) {
  const d = g.data;
  byObject[d.object] = (byObject[d.object] ?? 0) + 1;
  if (d.got) got[d.got.material] = (got[d.got.material] ?? 0) + d.got.amount;
}
console.log(
  `採集 ${gathers.length} 次：${Object.entries(byObject)
    .map(([o, n]) => `${o} ${n}`)
    .join('、')}`,
);
console.log(
  `採到：${Object.entries(got)
    .map(([m, n]) => `${name(m)} ${n}`)
    .join('、')}`,
);
console.log('\n每次採集（時間｜位置｜來源｜讀出的組成｜這次得到｜採光後）：');
for (const g of gathers) {
  const d = g.data;
  const read = d.read ? Object.keys(d.read).map(name).join('、') : '';
  const out = d.got ? `${name(d.got.material)} ${d.got.amount}` : '沒有';
  console.log(`  ${g.time}｜${d.at.x},${d.at.y}｜${d.object}｜${read}｜${out}｜${d.done ?? ''}`);
}
