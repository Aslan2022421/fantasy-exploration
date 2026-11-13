import { expect, test } from 'vitest';
import { DATA } from '../data/load.js';
import { groundHeight, layerStep, objectLayers, STACK, shiftOf, TREE, wallRange } from './perspective.js';

// 測試用的小世界：tiers[y][x] 是高度層
function fakeWorld(tiers) {
  return {
    inside: (x, y) => y >= 0 && y < tiers.length && x >= 0 && x < tiers[0].length,
    tierAt: (x, y) => tiers[y]?.[x] ?? 0,
  };
}
const grid = (n, v) => Array.from({ length: n }, () => new Array(n).fill(v));
const obj = (id) => DATA.objects[DATA.objectIndex.get(id)];

test('錯開量：比原點高往外、低往內，離中心越遠越大，總量有上限；原點與畫面中心不動', () => {
  expect(layerStep(10)).toBeCloseTo(1.2);
  expect(layerStep(100)).toBe(STACK.maxStep);
  expect(shiftOf(20, 0, 0)).toEqual({ ox: 0, oy: 0 });
  expect(shiftOf(0, 0, 3)).toEqual({ ox: 0, oy: 0 });
  expect(shiftOf(20, 0, 2)).toEqual({ ox: 4, oy: 0 }); // 往外
  expect(shiftOf(20, 0, -2)).toEqual({ ox: -4, oy: 0 }); // 往內
  expect(shiftOf(0, -30, 2)).toEqual({ ox: 0, oy: -4 });
  expect(shiftOf(30, 0, 99)).toEqual({ ox: STACK.maxShift, oy: 0 });
});

test('牆：比往中心那一格高才有，從低處那層疊到自己底下一層；水邊遠側的岸有岸壁', () => {
  const t = grid(21, 1);
  t[10][3] = 0; // 中心左邊的水，再往左是岸
  t[10][16] = 3; // 中心右邊的台地
  const w = fakeWorld(t);
  expect(wallRange(w, 10, 10, 2, 10)).toEqual({ from: groundHeight(0), to: groundHeight(1) - 1 }); // 遠側的岸
  expect(wallRange(w, 10, 10, 4, 10)).toBeNull(); // 近側的岸：往中心那格一樣高
  expect(wallRange(w, 10, 10, 16, 10)).toEqual({ from: groundHeight(1), to: groundHeight(3) - 1 });
  expect(wallRange(w, 10, 10, 10, 10)).toBeNull();
});

test('樹：第 1 層地貌、第 2 層留空，樹葉離地 +2、+3，樹幹 +1～+4、頂端高過樹葉；矮叢實心 2 層', () => {
  const canopy = objectLayers(obj('broadleaf'), false);
  expect(canopy.map((l) => l.dh)).toEqual(TREE.leaves);
  expect(canopy.every((l) => l.part === 'leaf')).toBe(true);
  const trunk = objectLayers(obj('broadleaf'), true);
  expect(Math.max(...trunk.filter((l) => l.part === 'trunk').map((l) => l.dh))).toBeGreaterThan(
    Math.max(...TREE.leaves),
  );
  // 同高時樹幹在前、樹葉在後（樹葉蓋住樹幹）
  const at2 = trunk.filter((l) => l.dh === 2).map((l) => l.part);
  expect(at2).toEqual(['trunk', 'leaf']);
  expect(objectLayers(obj('shrub'), false).map((l) => [l.dh, l.part])).toEqual([
    [1, 'solid'],
    [2, 'solid'],
  ]);
  expect(objectLayers(null, false)).toEqual([]);
});
