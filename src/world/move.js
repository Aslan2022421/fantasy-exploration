// 移動：八個方向，撞到牆就留在原地

import { DIRS as ROT_DIRS } from 'rot-js';
import { isPassable } from './map.js';

// ROT.js 的八方向表依序是北、東北、東、東南、南、西南、西、西北
const NAMES = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
export const DIRS = Object.fromEntries(NAMES.map((name, i) => [name, ROT_DIRS[8][i]]));

export function tryMove(map, pos, dir) {
  const d = DIRS[dir];
  if (!d) return pos;
  const next = { x: pos.x + d[0], y: pos.y + d[1] };
  return isPassable(map, next.x, next.y) ? next : pos;
}
