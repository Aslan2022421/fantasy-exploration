import { expect, test } from 'vitest';
import { ABOVE, BELOW, DEEP, outlineAt, SAME, Z_LEVEL, zClass } from './zlevel.js';

test('以冒險者的高度層為準分四階：更低、低一層、同層、高處', () => {
  expect(zClass(2, 2)).toBe(SAME);
  expect(zClass(1, 2)).toBe(BELOW);
  expect(zClass(0, 2)).toBe(DEEP);
  expect(zClass(0, 5)).toBe(DEEP);
  expect(zClass(3, 2)).toBe(ABOVE);
  expect(zClass(7, 2)).toBe(ABOVE);
});

test('越高越亮，每一階都分得開（至少差 2 級）', () => {
  const order = [DEEP, BELOW, SAME, ABOVE].map((z) => Z_LEVEL[z]);
  for (let i = 1; i < order.length; i++) expect(order[i] - order[i - 1]).toBeGreaterThanOrEqual(2);
});

test('比上下左右任何一格高的格子畫輪廓，平地與低側不畫', () => {
  const tiers = [
    [1, 1, 1],
    [1, 2, 1],
    [1, 1, 1],
  ];
  const world = {
    inside: (x, y) => y >= 0 && y < 3 && x >= 0 && x < 3,
    tierAt: (x, y) => tiers[y][x],
  };
  expect(outlineAt(world, 1, 1)).toBe(true);
  expect(outlineAt(world, 0, 0)).toBe(false);
  expect(outlineAt(world, 1, 0)).toBe(false);
});
