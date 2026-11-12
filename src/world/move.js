// 移動：八個方向，撞到牆就留在原地

import { isPassable } from './map.js';

export const DIRS = {
  n: [0, -1],
  s: [0, 1],
  w: [-1, 0],
  e: [1, 0],
  nw: [-1, -1],
  ne: [1, -1],
  sw: [-1, 1],
  se: [1, 1],
};

export function tryMove(map, pos, dir) {
  const d = DIRS[dir];
  if (!d) return pos;
  const next = { x: pos.x + d[0], y: pos.y + d[1] };
  return isPassable(map, next.x, next.y) ? next : pos;
}
