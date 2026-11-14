import { RNG } from 'rot-js';
import { expect, test } from 'vitest';
import { DATA } from '../data/load.js';
import { createContinent, rollShape, SHAPE } from './continent.js';
import { LAND } from './landform.js';

const S = 9216;

test('擲模板：同一顆骰子結果一樣；擲出來的一定是資料裡的模板', () => {
  for (let s = 0; s < 40; s++) {
    const a = rollShape(DATA.worldShapes, RNG.clone().setSeed(s));
    const b = rollShape(DATA.worldShapes, RNG.clone().setSeed(s));
    expect(a).toEqual(b);
    expect(DATA.worldShapes.map((t) => t.id)).toContain(a.id);
  }
});

test('世界邊緣一定是海；大陸模板的中間是陸地', () => {
  let continents = 0;
  for (let seed = 1; seed < 60 && continents < 3; seed++) {
    const c = createContinent(seed, DATA.worldShapes, S, S);
    for (const [x, y] of [
      [0, 0],
      [S / 2, 0],
      [S - 1, S / 2],
      [S / 3, S - 1],
    ])
      expect(c.at(x, y)).toBeLessThan(LAND.water - 0.3);
    if (c.id !== 'continent') continue;
    continents++;
    expect(c.at(S / 2, S / 2)).toBeGreaterThan(SHAPE.land - 0.3);
  }
  expect(continents).toBeGreaterThan(0);
});

test('粗格內插跟直接算差不多（變化都在一百格以上）', () => {
  const c = createContinent(7, DATA.worldShapes, S, S);
  for (let i = 0; i < 200; i++) {
    const x = ((i * 977) % S) + 0.5;
    const y = ((i * 613) % S) + 0.5;
    expect(Math.abs(c.at(x, y) - c.exact(x / S, y / S))).toBeLessThan(0.12);
  }
});

test('沒給模板（測試用的地形生成）時沒有世界形狀', () => {
  expect(createContinent(1, [], S, S).at(10, 10)).toBe(0);
});
