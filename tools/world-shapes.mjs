// 世界形狀量測：多個種子各建一個完整的 96×96 區世界，量陸地、山地、河、建世界的時間，
// 並把世界地圖（跟遊戲 M 鍵同一套顏色）存成 PNG。調 src/world/continent.js 的 SHAPE 時用。
// 用法：node tools/world-shapes.mjs <輸出資料夾> [種子數，預設 6]

import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { coarseImage } from '../src/view/worldmap.js';
import { LAND } from '../src/world/landform.js';
import { createWorld } from '../src/world/world.js';
import { loadData } from './data.mjs';

const out = process.argv[2];
const SEEDS = Number(process.argv[3] ?? 6);
if (!out) {
  console.log('用法：node tools/world-shapes.mjs <輸出資料夾> [種子數]');
  process.exit(1);
}
mkdirSync(out, { recursive: true });
const data = loadData();

// 最簡單的 PNG：RGBA、不分行濾波
function png(w, h, rgba) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, body) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(body.length);
    const tb = Buffer.concat([Buffer.from(type), body]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(tb));
    return Buffer.concat([len, tb, c]);
  };
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) Buffer.from(rgba.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const pct = (a, b) => `${((100 * a) / Math.max(1, b)).toFixed(1)}%`;
for (let s = 0; s < SEEDS; s++) {
  const seed = s === 0 ? 20261112 : 1000 + s * 7919;
  const t0 = performance.now();
  const w = createWorld(seed, data);
  const buildMs = performance.now() - t0;
  const geo = w.geography;
  let land = 0;
  let mountain = 0;
  for (const h of geo.elev) {
    if (h >= LAND.water) land++;
    if (h > LAND.mountain) mountain++;
  }
  const img = coarseImage(w, data);
  // 起點畫成白色十字
  const sx = Math.floor(geo.start.x / 8);
  const sy = Math.floor(geo.start.y / 8);
  for (let d = -6; d <= 6; d++)
    for (const [x, y] of [
      [sx + d, sy],
      [sx, sy + d],
    ])
      if (x >= 0 && y >= 0 && x < geo.W && y < geo.H) img.set([255, 255, 255, 255], (y * geo.W + x) * 4);
  writeFileSync(`${out}/world-${seed}.png`, png(geo.W, geo.H, img));
  const t1 = performance.now();
  for (let i = 0; i < 20; i++) w.zone(40 + i, 48);
  const zoneMs = (performance.now() - t1) / 20;
  console.log(
    `種子 ${seed}｜${w.shape}｜陸地 ${pct(land, geo.elev.length)}｜山地佔陸地 ${pct(mountain, land)}｜河段 ${geo.rivers}｜淺灘 ${geo.fords}｜建世界 ${(buildMs / 1000).toFixed(1)} 秒｜一區 ${zoneMs.toFixed(0)} 毫秒`,
  );
}
