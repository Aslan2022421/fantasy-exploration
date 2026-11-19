// 把道路畫進一區（terrain.js 生一區時用）：
// - 照路網的線段（roads.js）：大道寬 3 格、小路寬 1 格；地面換成路、生態覆蓋拿掉、樹拿掉（礦坑不動）
// - 路經過有水的格子（河）蓋成木橋，橫著過河 ═、直著過河 ║；只有路過河才有橋
// - 聚落、據點的圖樣不畫（牆不會被路切開）；這一區有聚落時，把伸到聚落附近、斷在那裡的路頭接到最近的出入口
// 只看這一區自己的格子與全世界共用的路網，任何順序生出來都一樣

import { segDist } from './gridtools.js';
import { MAIN } from './roads.js';

const WIDTH = { [MAIN]: 1.25, 1: 0.55 }; // 離線段幾格內算路
const LINK = 80; // 路頭接到出入口，最多走幾格

// z：{ size, x0, y0, surface, cover, object, objectPart, water, tier, site（1 是聚落、據點的圖樣）}
// ids：{ ROAD 路的材質, NONE, EW, NS 兩種橋的物件編號, PART_MID }；keep(o)：這個物件不拿掉（礦坑）
// settle：這一區的聚落（可能是 null）
export function paintRoads(roads, z, ids, keep, settle) {
  const { size, x0, y0 } = z;
  const segs = roads?.byZone.get(z.zoneKey) ?? [];
  const mark = new Int8Array(size * size); // 0 不是路；1 橫向的路；2 直向的路
  for (const k of segs) {
    const s = roads.segments[k];
    const r = WIDTH[s.kind] ?? WIDTH[1];
    const dir = Math.abs(s.bx - s.ax) >= Math.abs(s.by - s.ay) ? 1 : 2;
    const xa = Math.max(0, Math.floor(Math.min(s.ax, s.bx) - r - 1) - x0);
    const xb = Math.min(size - 1, Math.ceil(Math.max(s.ax, s.bx) + r + 1) - x0);
    const ya = Math.max(0, Math.floor(Math.min(s.ay, s.by) - r - 1) - y0);
    const yb = Math.min(size - 1, Math.ceil(Math.max(s.ay, s.by) + r + 1) - y0);
    for (let y = ya; y <= yb; y++)
      for (let x = xa; x <= xb; x++)
        if (segDist(x0 + x + 0.5, y0 + y + 0.5, s.ax, s.ay, s.bx, s.by) <= r) mark[y * size + x] ||= dir;
  }
  const lay = (i, dir) => {
    if (z.site[i]) return false;
    const o = z.object[i] - 1;
    if (o >= 0 && keep(o)) return false;
    if (z.water[i] !== ids.NONE) {
      z.object[i] = (dir === 1 ? ids.EW : ids.NS) + 1;
      z.objectPart[i] = ids.PART_MID;
      return true;
    }
    z.surface[i] = ids.ROAD;
    z.cover[i] = ids.NONE;
    z.object[i] = 0;
    return true;
  };
  for (let i = 0; i < size * size; i++) if (mark[i]) lay(i, mark[i]);
  if (settle) linkGates(z, mark, settle, lay);
}

// 聚落附近斷掉的路頭（區界上的不算）接到最近的出入口：廣度優先，走得過去（高低差 2 層以內）、不穿過圖樣，水上蓋橋
function linkGates(z, mark, s, lay) {
  const { size, x0, y0 } = z;
  const L = s.layout;
  const goal = new Set();
  for (let j = 0; j < L.h; j++)
    for (let i = 0; i < L.w; i++) {
      const edge = i === 0 || j === 0 || i === L.w - 1 || j === L.h - 1;
      const code = L.grid[j][i];
      if (!edge || (code !== 'road' && code !== 'outroad')) continue;
      // 出入口外面那一格（圖樣外、這一區裡）
      const ox = s.x0 + i + (i === 0 ? -1 : i === L.w - 1 ? 1 : 0) - x0;
      const oy = s.y0 + j + (j === 0 ? -1 : j === L.h - 1 ? 1 : 0) - y0;
      if (ox >= 0 && oy >= 0 && ox < size && oy < size && !z.site[oy * size + ox]) goal.add(oy * size + ox);
    }
  if (!goal.size) return;
  const near = (x, y) => {
    const dx = Math.max(s.x0 - x0 - x, 0, x - (s.x0 + L.w - 1 - x0));
    const dy = Math.max(s.y0 - y0 - y, 0, y - (s.y0 + L.h - 1 - y0));
    return Math.max(dx, dy);
  };
  // 路頭：離圖樣 3 格內、或離這一區中心（路網的節點）3 格內的路；連在一起的算一組，每組接一次
  const isRoad = (i) => mark[i] && !z.site[i];
  const c0 = size >> 1;
  const head = new Uint8Array(size * size);
  for (let i = 0; i < size * size; i++) {
    if (!isRoad(i)) continue;
    const x = i % size;
    const y = (i - x) / size;
    if (near(x, y) <= 3 || Math.max(Math.abs(x - c0), Math.abs(y - c0)) <= 3) head[i] = 1;
  }
  for (let s0 = 0; s0 < size * size; s0++) {
    if (!head[s0]) continue;
    const group = [s0];
    head[s0] = 0;
    for (let h = 0; h < group.length; h++) {
      const x = group[h] % size;
      const y = (group[h] - x) / size;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= size || ny >= size || !head[ny * size + nx]) continue;
          head[ny * size + nx] = 0;
          group.push(ny * size + nx);
        }
    }
    if (group.some((i) => goal.has(i))) continue; // 已經接到出入口
    const path = bfs(z, group, goal);
    if (path)
      for (const c of path) {
        mark[c] ||= 1;
        lay(c, 1);
      }
  }
}

// 從一組格子（多個起點）走到 goal 裡任一格的最短路（四方向）
function bfs(z, from, goal) {
  const { size } = z;
  const prev = new Map(from.map((i) => [i, -1]));
  const q = [...from];
  for (let h = 0; h < q.length && h < LINK * LINK; h++) {
    const i = q[h];
    if (goal.has(i)) {
      const out = [];
      for (let c = i; c >= 0; c = prev.get(c)) out.push(c);
      return out.length <= LINK ? out : null;
    }
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
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const j = ny * size + nx;
      if (prev.has(j) || z.site[j] || Math.abs(z.tier[j] - z.tier[i]) > 2) continue;
      prev.set(j, i);
      q.push(j);
    }
  }
  return null;
}
