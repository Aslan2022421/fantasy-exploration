import { expect, test } from 'vitest';
import { DATA } from '../data/load.js';
import { describePlace, groundName, regionLabel } from './place.js';
import { createWorld, startPosition } from './world.js';

const world = createWorld(20261112, DATA);

test('查看一格寫出地面、地貌、生態、氣候與高度', () => {
  const p = startPosition(world);
  const text = describePlace(world, p.x, p.y);
  const c = world.cell(p.x, p.y);
  expect(text).toContain(groundName(c));
  expect(text).toContain(c.landform.name);
  expect(text).toContain(c.biome.name);
  expect(text).toMatch(/（(寒冷|溫和|炎熱)、(乾燥|普通|潮濕)），高度 \d+$/);
});

test('有物件時先寫物件，再寫它長在哪種地面上', () => {
  let found = null;
  for (let y = 100; y < 200 && !found; y++)
    for (let x = 100; x < 200 && !found; x++) if (world.objectAt(x, y) >= 0) found = { x, y };
  const c = world.cell(found.x, found.y);
  expect(describePlace(world, found.x, found.y)).toMatch(
    new RegExp(`^${c.object.name}(的樹幹)?，長在${groundName(c)}上`),
  );
});

test('有生態覆蓋時寫在地面前面', () => {
  let found = null;
  for (let y = 100; y < 200 && !found; y++)
    for (let x = 100; x < 200 && !found; x++)
      if (world.coverAt(x, y) >= 0 && world.objectAt(x, y) < 0) found = { x, y };
  const c = world.cell(found.x, found.y);
  expect(describePlace(world, found.x, found.y)).toMatch(new RegExp(`^${c.cover.name}，${c.surface.name}，`));
});

test('過不去的地方會註明', () => {
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
