// 世界總覽的陸地（worldmap.js 用）：粗格高度的雙線性內插、陸地遮罩、太小的水塘併進陸地、離海岸的距離

import { LAND } from '../world/landform.js';

// 地理粗格的高度，雙線性內插：(gx, gy) 是粗格座標（可以是小數，粗格中心在 .5）
export function elevAt(geo, gx, gy) {
  const x = Math.max(0, Math.min(geo.W - 1.001, gx - 0.5));
  const y = Math.max(0, Math.min(geo.H - 1.001, gy - 0.5));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const e = (i, j) => geo.elev[(y0 + j) * geo.W + x0 + i];
  return (e(0, 0) * (1 - fx) + e(1, 0) * fx) * (1 - fy) + (e(0, 1) * (1 - fx) + e(1, 1) * fx) * fy;
}

// 太小的內陸水塘併進陸地：不碰地圖邊、面積不到 POND 比例的水，畫出來只是滿地描了邊的小點
const POND = 1 / 8000;
function dropPonds(land, size) {
  const seen = new Uint8Array(size * size);
  const limit = Math.max(30, size * size * POND);
  for (let s = 0; s < size * size; s++) {
    if (land[s] || seen[s]) continue;
    const cells = [s];
    seen[s] = 1;
    let edge = false;
    for (let h = 0; h < cells.length; h++) {
      const i = cells[h];
      const x = i % size;
      const y = (i - x) / size;
      if (x === 0 || y === 0 || x === size - 1 || y === size - 1) edge = true;
      for (const j of [i - 1, i + 1, i - size, i + size]) {
        if (j < 0 || j >= size * size || seen[j] || land[j]) continue;
        if ((j === i - 1 && x === 0) || (j === i + 1 && x === size - 1)) continue;
        seen[j] = 1;
        cells.push(j);
      }
    }
    if (!edge && cells.length < limit) for (const i of cells) land[i] = 1;
  }
}

// size×size 的陸地遮罩（1 是陸地）與離海岸的距離（陸地、海兩邊各自量，像素）
export function landMask(geo, size) {
  const land = new Uint8Array(size * size);
  for (let py = 0; py < size; py++)
    for (let px = 0; px < size; px++)
      land[py * size + px] =
        elevAt(geo, ((px + 0.5) * geo.W) / size, ((py + 0.5) * geo.H) / size) >= LAND.water ? 1 : 0;
  dropPonds(land, size);
  // 兩趟倒角距離：到另一種（陸地到海、海到陸地）的距離
  const dist = new Float32Array(size * size).fill(1e9);
  for (let i = 0; i < size * size; i++) {
    const x = i % size;
    const y = (i - x) / size;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < size && ny < size && land[ny * size + nx] !== land[i]) dist[i] = 0;
    }
  }
  const pass = (from, to, step, nbs) => {
    for (let i = from; i !== to; i += step) {
      const x = i % size;
      const y = (i - x) / size;
      for (const [dx, dy, c] of nbs) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        const j = ny * size + nx;
        if (land[j] === land[i] && dist[j] + c < dist[i]) dist[i] = dist[j] + c;
      }
    }
  };
  pass(0, size * size, 1, [
    [-1, 0, 1],
    [0, -1, 1],
    [-1, -1, Math.SQRT2],
    [1, -1, Math.SQRT2],
  ]);
  pass(size * size - 1, -1, -1, [
    [1, 0, 1],
    [0, 1, 1],
    [1, 1, Math.SQRT2],
    [-1, 1, Math.SQRT2],
  ]);
  return { land, dist };
}
