import { expect, test } from 'vitest';
import { DATA } from '../data/load.js';
import { newGame } from './game.js';

const game = newGame(20261112);
const world = game.world.base;
const home = game.world.startVillage;
const road = DATA.surfaceIndex.get('road');
const isRoad = (x, y) => {
  const o = world.objectAt(x, y);
  return world.surfaceAt(x, y) === road || (o >= 0 && !!DATA.objects[o].bridge);
};

test('路網：有大道也有小路；起點村莊有路從出入口通出去，走得出 40 格外', () => {
  expect(world.roads.count).toBeGreaterThan(0);
  expect(world.roads.lines.some((l) => l.kind === 2)).toBe(true);
  // 從起點村莊的出入口外沿著路走（只走路），走得到離村莊 40 格外
  const start = [];
  for (let y = home.y0 - 2; y < home.y0 + home.h + 2; y++)
    for (let x = home.x0 - 2; x < home.x0 + home.w + 2; x++) {
      const inBox = x >= home.x0 && y >= home.y0 && x < home.x0 + home.w && y < home.y0 + home.h;
      if (!inBox && isRoad(x, y)) start.push({ x, y });
    }
  expect(start.length).toBeGreaterThan(0);
  const seen = new Set(start.map((c) => `${c.x},${c.y}`));
  const q = [...start];
  let far = 0;
  for (let h = 0; h < q.length && h < 20000; h++) {
    const c = q[h];
    far = Math.max(far, Math.abs(c.x - home.plaza.x), Math.abs(c.y - home.plaza.y));
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const k = `${c.x + dx},${c.y + dy}`;
        if (seen.has(k) || !isRoad(c.x + dx, c.y + dy)) continue;
        seen.add(k);
        q.push({ x: c.x + dx, y: c.y + dy });
      }
  }
  expect(far).toBeGreaterThan(40);
}, 60000);

test('橋只在路過河的地方：每座橋旁邊都接著路或橋', () => {
  let bridges = 0;
  for (let y = home.y0 - 150; y < home.y0 + 150; y++)
    for (let x = home.x0 - 150; x < home.x0 + 150; x++) {
      const o = world.objectAt(x, y);
      if (o < 0 || !DATA.objects[o].bridge) continue;
      bridges++;
      expect(world.waterAt(x, y)).toBeGreaterThanOrEqual(0);
      let next = false;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) next ||= isRoad(x + dx, y + dy);
      expect(next).toBe(true);
    }
  expect(bridges).toBeGreaterThan(0);
}, 60000);
