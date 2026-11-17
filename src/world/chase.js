// 生物往冒險者走：從錨點出發的廣度優先搜尋，走到佔的任一格貼著冒險者為止。
// 佔好幾格的生物，每一步整隻都要放得下（地面走得過去、沒有別的生物、不是冒險者那格），錨點那一步的高低差也要過得去。
// 回傳不含起點的每一步錨點；走不到回傳 []

import { canStep } from './climb.js';
import { creatureCells } from './herds.js';

const STEPS = [
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
];
const MAX_NODES = 8000; // 大約半徑 45 格的空地；找不到就這一回合不動

export const cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
export const touching = (cells, p) => cells.some((c) => cheb(c, p) <= 1);
export const distanceTo = (cells, p) => Math.min(...cells.map((c) => cheb(c, p)));

export function chaseSteps(world, sp, self, from, hero) {
  const fits = (anchor) =>
    creatureCells(sp, anchor).every((c) => {
      if (c.x === hero.x && c.y === hero.y) return false;
      if (!world.groundPassable(c.x, c.y)) return false;
      const other = world.creatureAt(c.x, c.y);
      return !other || other.id === self;
    });
  const key = (c) => `${c.x},${c.y}`;
  const came = new Map([[key(from), null]]);
  const queue = [from];
  for (let i = 0; i < queue.length && came.size < MAX_NODES; i++) {
    const cur = queue[i];
    if (touching(creatureCells(sp, cur), hero)) {
      const out = [];
      for (let c = cur; c && key(c) !== key(from); c = came.get(key(c))) out.push(c);
      return out.reverse();
    }
    for (const [dx, dy] of STEPS) {
      const n = { x: cur.x + dx, y: cur.y + dy };
      if (came.has(key(n)) || !canStep(world, cur, n) || !fits(n)) continue;
      came.set(key(n), cur);
      queue.push(n);
    }
  }
  return [];
}
