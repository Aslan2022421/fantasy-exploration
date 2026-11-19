// 聚落圖樣裡從廣場走得到的格子（測試與村民走路用）：廣度優先，八方向

import { walkable } from './settle-codes.js';

export function reachable(layout, from = layout.plaza) {
  const seen = new Set([`${from.i},${from.j}`]);
  const queue = [from];
  for (let q = 0; q < queue.length; q++) {
    const c = queue[q];
    for (let dj = -1; dj <= 1; dj++)
      for (let di = -1; di <= 1; di++) {
        const i = c.i + di;
        const j = c.j + dj;
        const key = `${i},${j}`;
        if (seen.has(key) || i < 0 || j < 0 || i >= layout.w || j >= layout.h) continue;
        if (!walkable(layout.grid[j][i])) continue;
        seen.add(key);
        queue.push({ i, j });
      }
  }
  return seen;
}
