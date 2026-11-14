import { expect, test } from 'vitest';
import { areaOf, inFootprint, meanArea, PART_DARK, PART_LIT, PART_MID, partOf, trunkCell } from './footprint.js';

test('直徑 1～4 的佔地格數：1、4、9、12（4 格的去掉四個角）', () => {
  expect([1, 2, 3, 4].map(areaOf)).toEqual([1, 4, 9, 12]);
  expect(inFootprint(0, 0, 4)).toBe(false);
  expect(inFootprint(1, 0, 4)).toBe(true);
  expect(inFootprint(4, 0, 4)).toBe(false);
});

test('樹冠形狀：直徑 3 的 round 是九宮格（旁邊 8 邊），cross 是十字（旁邊 4 邊）', () => {
  expect(areaOf(3)).toBe(9);
  expect(areaOf(3, 'cross')).toBe(5);
  expect(inFootprint(0, 0, 3, 'cross')).toBe(false);
  expect(inFootprint(1, 0, 3, 'cross')).toBe(true);
  expect(meanArea([3], 'cross')).toBe(5);
});

test('平均佔地照 sizes 裡出現的次數算', () => {
  expect(meanArea([1])).toBe(1);
  expect(meanArea([2, 4])).toBe(8);
});

test('樹幹在樹冠正中間，一定在樹冠裡', () => {
  for (const d of [1, 2, 3, 4]) {
    const t = trunkCell(d);
    expect(inFootprint(t.i, t.j, d), `直徑 ${d}`).toBe(true);
  }
  expect(trunkCell(3)).toEqual({ i: 1, j: 1 });
});

test('樹冠右上亮、左下暗、對角線上是中間色；一格的物件沒有分側', () => {
  expect(partOf(2, 0, 3)).toBe(PART_LIT);
  expect(partOf(0, 2, 3)).toBe(PART_DARK);
  expect(partOf(1, 1, 3)).toBe(PART_MID);
  expect(partOf(0, 0, 1)).toBe(PART_MID);
});
