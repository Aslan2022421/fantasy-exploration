// 尋路：八方向的 A*（ROT.js），用在滑鼠點地圖時走過去。跨區照走，路過的區用到才生

import { Path } from 'rot-js';

// 回傳從起點（不含）到終點（含）的每一步；走不到或點在原地回傳空陣列
export function findPath(world, from, to) {
  if (from.x === to.x && from.y === to.y) return [];
  if (!world.isPassable(to.x, to.y)) return [];
  const astar = new Path.AStar(to.x, to.y, (x, y) => world.isPassable(x, y), { topology: 8 });
  const steps = [];
  astar.compute(from.x, from.y, (x, y) => steps.push({ x, y }));
  if (steps.length === 0) return [];
  return steps.slice(1);
}

// 兩格之間的方向（相鄰格才有意義）
export function stepDirection(from, to) {
  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);
  const ns = dy < 0 ? 'n' : dy > 0 ? 's' : '';
  const we = dx < 0 ? 'w' : dx > 0 ? 'e' : '';
  return ns + we || null;
}
