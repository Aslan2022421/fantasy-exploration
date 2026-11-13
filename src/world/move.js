// 移動：八個方向，擋住就留在原地

import { DIRS as ROT_DIRS } from 'rot-js';

// ROT.js 的八方向表依序是北、東北、東、東南、南、西南、西、西北
const NAMES = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
export const DIRS = Object.fromEntries(NAMES.map((name, i) => [name, ROT_DIRS[8][i]]));

// world 只要有 isPassable(x, y)
export function tryMove(world, pos, dir) {
  const d = DIRS[dir];
  if (!d) return pos;
  const next = { x: pos.x + d[0], y: pos.y + d[1] };
  return world.isPassable(next.x, next.y) ? next : pos;
}
