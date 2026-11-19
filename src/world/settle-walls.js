// 聚落圖樣的後段處理：家具不切開室內的檢查、只留用得到的小巷、沿建築圍外牆、出入口往外打通、從廣場走得到的格子

import { GROUND, KEEP, OUTROAD, ROAD, WELL, walkable } from './settle-codes.js';

// 四方向連通（擋路的家具不能把室內切開）
export function connected(cells) {
  if (!cells.length) return true;
  const set = new Set(cells.map((c) => `${c.i},${c.j}`));
  const seen = new Set([`${cells[0].i},${cells[0].j}`]);
  const q = [cells[0]];
  for (let h = 0; h < q.length; h++)
    for (const [di, dj] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const k = `${q[h].i + di},${q[h].j + dj}`;
      if (set.has(k) && !seen.has(k)) {
        seen.add(k);
        q.push({ i: q[h].i + di, j: q[h].j + dj });
      }
    }
  return seen.size === set.size;
}

// 小巷只留用得到的那一段：從每道門外那一格走最短路到大路或廣場，路上的格子都當成路（舊版）；
// 沒走到的小巷收回成空地
export function keepUsedRoads(grid, W, H, main, doorsOut) {
  const used = new Set();
  const key = (i, j) => `${i},${j}`;
  for (const d of doorsOut) {
    const came = new Map([[key(d.i, d.j), null]]);
    const q = [d];
    let end = null;
    for (let h = 0; h < q.length && !end; h++) {
      const c = q[h];
      if (main.has(key(c.i, c.j))) end = c;
      for (const [di, dj] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const n = { i: c.i + di, j: c.j + dj };
        if (n.i < 1 || n.j < 1 || n.i >= W - 1 || n.j >= H - 1 || came.has(key(n.i, n.j))) continue;
        if (grid[n.j][n.i] !== ROAD && grid[n.j][n.i] !== GROUND) continue;
        came.set(key(n.i, n.j), c);
        q.push(n);
      }
    }
    for (let c = end; c; c = came.get(key(c.i, c.j))) used.add(key(c.i, c.j));
  }
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const k = key(i, j);
      if (used.has(k) && !main.has(k)) grid[j][i] = ROAD;
      else if (grid[j][i] === ROAD && !main.has(k)) grid[j][i] = GROUND;
    }
}

// 出入口：從大路的盡頭往外，把走道、外牆、牆外的格子打通成 3 格寬的路，一直到工作範圍的邊
export function gateOut(grid, W, H, gates, cx, cy) {
  for (const side of gates) {
    const [di, dj] = { west: [-1, 0], east: [1, 0], north: [0, -1], south: [0, 1] }[side];
    for (let w = -1; w <= 1; w++) {
      let i = cx + (dj ? w : 0);
      let j = cy + (di ? w : 0);
      while (i >= 0 && j >= 0 && i < W && j < H) {
        const c = grid[j][i];
        if (c !== ROAD && c !== WELL) grid[j][i] = c === KEEP ? OUTROAD : ROAD;
        i += di;
        j += dj;
      }
    }
  }
}

// 外牆：路、廣場、建築往外一格是走道，走道外面一圈是牆；圍起來的零碎空地算在裡面，其餘是牆外（KEEP）。
// 工作範圍的邊上只有大路那 3 格開著（出入口），其餘的走道換成牆
export function enclose(grid, W, H, wall) {
  const inner = Array.from({ length: H }, () => Array(W).fill(false));
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      if (grid[j][i] === GROUND) continue;
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          const a = i + di;
          const b = j + dj;
          if (a >= 0 && b >= 0 && a < W && b < H) inner[b][a] = true;
        }
    }
  // 從工作範圍的邊往裡灌，灌不到的空地是圍起來的，算在裡面
  const out = Array.from({ length: H }, () => Array(W).fill(false));
  const q = [];
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++)
      if ((i === 0 || j === 0 || i === W - 1 || j === H - 1) && !inner[j][i]) {
        out[j][i] = true;
        q.push([i, j]);
      }
  for (let h = 0; h < q.length; h++) {
    const [i, j] = q[h];
    for (let dj = -1; dj <= 1; dj++)
      for (let di = -1; di <= 1; di++) {
        const a = i + di;
        const b = j + dj;
        if (a < 0 || b < 0 || a >= W || b >= H || out[b][a] || inner[b][a]) continue;
        out[b][a] = true;
        q.push([a, b]);
      }
  }
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (!out[j][i]) inner[j][i] = true;
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const edge = i === 0 || j === 0 || i === W - 1 || j === H - 1;
      if (inner[j][i]) {
        if (edge && grid[j][i] !== ROAD) grid[j][i] = wall;
        continue;
      }
      let touch = false;
      for (let dj = -1; dj <= 1 && !touch; dj++)
        for (let di = -1; di <= 1 && !touch; di++) {
          const a = i + di;
          const b = j + dj;
          touch = a >= 0 && b >= 0 && a < W && b < H && inner[b][a];
        }
      grid[j][i] = touch ? wall : KEEP;
    }
}

// 圖樣裡從廣場走得到的格子（測試與村民走路用）：廣度優先，八方向
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
