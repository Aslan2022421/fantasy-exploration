// 看不看得到：ROT.js 的 PreciseShadowcasting（八方向）。擋視線的是走不過去的物件與樹幹（樹冠、矮叢不擋），
// 生物不擋

import { FOV } from 'rot-js';
import { PART_TRUNK } from './footprint.js';

export function visibleFrom(world, data, from, radius) {
  const lightPasses = (x, y) => {
    if (x === from.x && y === from.y) return true;
    const o = world.objectAt(x, y);
    if (o < 0) return world.inside(x, y);
    return data.objects[o].passable && world.objectPartAt(x, y) !== PART_TRUNK;
  };
  const seen = new Set();
  new FOV.PreciseShadowcasting(lightPasses, { topology: 8 }).compute(from.x, from.y, radius, (x, y) =>
    seen.add(`${x},${y}`),
  );
  return seen;
}
