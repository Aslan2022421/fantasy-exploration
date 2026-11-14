// 尋路：八方向的 A*（ROT.js），用在滑鼠點地圖時走過去。跨區照走，路過的區用到才生。
// 找到之後把路線拉直（步數不變），看起來不會先斜走到底再直走

import { Path } from 'rot-js';

// 回傳從起點（不含）到終點（含）的每一步；走不到或點在原地回傳空陣列
export function findPath(world, from, to) {
  if (from.x === to.x && from.y === to.y) return [];
  if (!world.isPassable(to.x, to.y)) return [];
  const astar = new Path.AStar(to.x, to.y, (x, y) => world.isPassable(x, y), { topology: 8 });
  const steps = [];
  astar.compute(from.x, from.y, (x, y) => steps.push({ x, y }));
  if (steps.length === 0) return [];
  return straighten(world, from, steps.slice(1));
}

// 走到 to 旁邊（八方向相鄰）：to 本身可以走不過去（岩壁、樹幹）。ROT.js 的 A* 從終點往回找，終點那格不檢查能不能走，
// 所以直接拿 to 當終點，再去掉最後一步。已經在旁邊回傳 []，走不到回傳 null
export function findPathNextTo(world, from, to) {
  if (Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y)) <= 1) return [];
  const astar = new Path.AStar(to.x, to.y, (x, y) => world.isPassable(x, y), { topology: 8 });
  const steps = [];
  astar.compute(from.x, from.y, (x, y) => steps.push({ x, y }));
  if (steps.length < 2) return null;
  return straighten(world, from, steps.slice(1, -1));
}

// 從 a 到 b 的八方向直線（每步主軸走一格、副軸平均分配），步數＝兩點的切比雪夫距離
export function lineSteps(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const n = Math.max(Math.abs(dx), Math.abs(dy));
  const out = [];
  for (let i = 1; i <= n; i++) out.push({ x: a.x + Math.round((dx * i) / n), y: a.y + Math.round((dy * i) / n) });
  return out;
}

// 路線拉直：A* 找到的路線步數不變，斜走與直走穿插開來、貼近起點到終點的直線，不會先斜走到底再直走。整段拉直走得通就換掉，走不通就從中間切開兩半各自拉直
export function straighten(world, from, steps) {
  if (steps.length <= 1) return steps;
  const to = steps[steps.length - 1];
  if (Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y)) === steps.length) {
    const line = lineSteps(from, to);
    if (line.every((c) => world.isPassable(c.x, c.y))) return line;
  }
  if (steps.length <= 2) return steps;
  const mid = Math.floor(steps.length / 2);
  return [...straighten(world, from, steps.slice(0, mid)), ...straighten(world, steps[mid - 1], steps.slice(mid))];
}

// 兩格之間的方向（相鄰格才有意義）
export function stepDirection(from, to) {
  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);
  const ns = dy < 0 ? 'n' : dy > 0 ? 's' : '';
  const we = dx < 0 ? 'w' : dx > 0 ? 'e' : '';
  return ns + we || null;
}
