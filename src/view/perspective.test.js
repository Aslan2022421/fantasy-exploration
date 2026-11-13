import { expect, test } from 'vitest';
import { DATA } from '../data/load.js';
import { groundHeight, mountainRingFactor, objectLayers, STACK, shiftOf, TREE, wallRange } from './perspective.js';

// 測試用的小世界：tiers[y][x] 是高度層
function fakeWorld(tiers) {
  return {
    inside: (x, y) => y >= 0 && y < tiers.length && x >= 0 && x < tiers[0].length,
    tierAt: (x, y) => tiers[y]?.[x] ?? 0,
  };
}
const grid = (n, v) => Array.from({ length: n }, () => new Array(n).fill(v));
const obj = (id) => DATA.objects[DATA.objectIndex.get(id)];

test('錯開量只看高度：每高一層往上 step 像素，有上限；水面不動', () => {
  expect(shiftOf(0)).toEqual({ ox: 0, oy: 0 });
  expect(shiftOf(1).oy).toBe(-STACK.step);
  expect(shiftOf(groundHeight(2)).oy).toBe(-4 * STACK.step);
  expect(shiftOf(999).oy).toBe(-STACK.maxShift);
});

test('地面高度：陸地每層 2 層，山地每圈 1 層；山地底色往上一圈比一圈亮', () => {
  expect(groundHeight(4)).toBe(8);
  expect(groundHeight(5)).toBe(9);
  const at = (h) => Math.round((h + 1) * 127.5);
  expect(mountainRingFactor(at(0.43))).toBeCloseTo(0.75);
  expect(mountainRingFactor(at(0.63))).toBeGreaterThan(mountainRingFactor(at(0.5)));
  expect(mountainRingFactor(255)).toBe(1);
});

test('牆：比南邊那一格高才有，從低處那層疊到自己底下一層；湖的北岸有岸壁、南岸沒有', () => {
  const t = grid(9, 1);
  t[4][4] = 0; // 湖
  t[2][6] = 3; // 台地
  const w = fakeWorld(t);
  expect(wallRange(w, 4, 3)).toEqual({ from: groundHeight(0), to: groundHeight(1) - 1 }); // 北岸
  expect(wallRange(w, 4, 5)).toBeNull(); // 南岸
  expect(wallRange(w, 6, 2)).toEqual({ from: groundHeight(1), to: groundHeight(3) - 1 });
  expect(wallRange(w, 6, 1)).toBeNull(); // 台地北邊比它低，但牆只朝南
});

test('樹：第 1 層地貌、第 2 層留空，樹葉只在離地 +2，樹幹 +1～+4、頂端高過樹葉；矮叢實心 2 層', () => {
  const canopy = objectLayers(obj('broadleaf'), false);
  expect(canopy.map((l) => l.dh)).toEqual(TREE.leaves);
  expect(canopy.every((l) => l.part === 'leaf')).toBe(true);
  const trunk = objectLayers(obj('broadleaf'), true);
  expect(Math.max(...trunk.filter((l) => l.part === 'trunk').map((l) => l.dh))).toBeGreaterThan(
    Math.max(...TREE.leaves),
  );
  // 同高時樹幹在前、樹葉在後（樹葉蓋住樹幹）
  expect(trunk.filter((l) => l.dh === 2).map((l) => l.part)).toEqual(['trunk', 'leaf']);
  expect(objectLayers(obj('shrub'), false).map((l) => [l.dh, l.part])).toEqual([
    [1, 'solid'],
    [2, 'solid'],
  ]);
  expect(objectLayers(null, false)).toEqual([]);
});
