// 生物的走位：追（往目標走到佔的任一格貼著目標）與逃（往離冒險者更遠的那一格走一步）。
// 佔好幾格的生物，每一步整隻都要放得下（地面走得過去、沒有別的生物、不是冒險者那格），錨點那一步的高低差也要過得去

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
const MAX_NODES = 8000; // 大約半徑 45 格的空地；找不到就原地等

export const cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
export const touching = (cells, p) => cells.some((c) => cheb(c, p) <= 1);
export const distanceTo = (cells, p) => Math.min(...cells.map((c) => cheb(c, p)));
// 兩隻（各自佔的格子）之間最近差幾格；貼著是 1
export const gapBetween = (a, b) => Math.min(...b.map((c) => distanceTo(a, c)));
// b 佔的格子裡離 a 最近的那一格（追一隻佔好幾格的生物時，往這格走）
export const nearestCell = (a, b) => b.reduce((best, c) => (distanceTo(a, c) < distanceTo(a, best) ? c : best));

// 錨點放在 anchor 時，這隻（id 是 self）整隻放不放得下；hero 是冒險者站的格子
function fitsAt(world, sp, self, anchor, hero) {
  return creatureCells(sp, anchor).every((c) => {
    if (c.x === hero.x && c.y === hero.y) return false;
    if (!world.groundPassable(c.x, c.y)) return false;
    const other = world.creatureAt(c.x, c.y);
    return !other || other.id === self;
  });
}

// 從錨點 from 往 target 走，走到佔的任一格貼著 target 為止（廣度優先）。回傳不含起點的每一步錨點；走不到回傳 []
export function chaseSteps(world, sp, self, from, target, hero = target) {
  const key = (c) => `${c.x},${c.y}`;
  const came = new Map([[key(from), null]]);
  const queue = [from];
  for (let i = 0; i < queue.length && came.size < MAX_NODES; i++) {
    const cur = queue[i];
    if (touching(creatureCells(sp, cur), target)) {
      const out = [];
      for (let c = cur; c && key(c) !== key(from); c = came.get(key(c))) out.push(c);
      return out.reverse();
    }
    for (const [dx, dy] of STEPS) {
      const n = { x: cur.x + dx, y: cur.y + dy };
      if (came.has(key(n)) || !canStep(world, cur, n) || !fitsAt(world, sp, self, n, hero)) continue;
      came.set(key(n), cur);
      queue.push(n);
    }
  }
  return [];
}

// 逃：相鄰八格裡離威脅（冒險者或打牠的生物）最遠、又比現在遠的那一格；沒有就回傳 null（被逼到角落）
export function fleeStep(world, sp, self, from, threat, hero = threat) {
  let best = null;
  let bestD = distanceTo(creatureCells(sp, from), threat);
  for (const [dx, dy] of STEPS) {
    const n = { x: from.x + dx, y: from.y + dy };
    if (!canStep(world, from, n) || !fitsAt(world, sp, self, n, hero)) continue;
    const d = distanceTo(creatureCells(sp, n), threat);
    if (d > bestD) {
      best = n;
      bestD = d;
    }
  }
  return best;
}
