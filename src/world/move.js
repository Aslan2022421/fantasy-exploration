// 移動：八個方向，擋住就留在原地；跟腳下差 3 層以上的落差也走不過去（climb.js）

import { DIRS as ROT_DIRS } from 'rot-js';
import { canStep } from './climb.js';

// ROT.js 的八方向表依序是北、東北、東、東南、南、西南、西、西北
const NAMES = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
export const DIRS = Object.fromEntries(NAMES.map((name, i) => [name, ROT_DIRS[8][i]]));

// world 要有 isPassable(x, y)；有 tierAt(x, y) 才看高低差
export function tryMove(world, pos, dir) {
  const d = DIRS[dir];
  if (!d) return pos;
  const next = { x: pos.x + d[0], y: pos.y + d[1] };
  return world.isPassable(next.x, next.y) && canStep(world, pos, next) ? next : pos;
}
