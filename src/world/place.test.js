import { expect, test } from 'vitest';
import { DATA } from '../data/load.js';
import { describePlace, regionLabel } from './place.js';
import { createWorld, startPosition } from './world.js';

const world = createWorld(20261112, DATA);

test('查看一格寫出地形、生態、氣候與高度', () => {
  const p = startPosition(world);
  const text = describePlace(world, p.x, p.y);
  const c = world.cell(p.x, p.y);
  expect(text).toContain(c.terrain.name);
  expect(text).toContain(c.biome.name);
  expect(text).toMatch(/（(寒冷|溫和|炎熱)、(乾燥|普通|潮濕)），高度 \d+$/);
});

test('過不去的地形會註明', () => {
  let found = null;
  for (let y = 0; y < world.height && !found; y++)
    for (let x = 0; x < world.width && !found; x++) if (!world.isPassable(x, y)) found = { x, y };
  expect(describePlace(world, found.x, found.y)).toContain('過不去');
});

test('世界外沒有描述；狀態列寫出區座標與生態', () => {
  expect(describePlace(world, -1, 0)).toBeNull();
  expect(regionLabel(world, DATA, -1, 0)).toBe('');
  const label = regionLabel(world, DATA, 100, 5);
  expect(label).toMatch(/^區 1,0 /);
});
