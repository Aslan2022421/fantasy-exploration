import { expect, test } from 'vitest';
import { LIFT, liftOf, MOUNTAIN_LIFT, pick, screenOf, topRow } from './oblique.js';

// 測試用的小世界：tiers[y][x] 是高度層
function fakeWorld(tiers) {
  return {
    inside: (x, y) => y >= 0 && y < tiers.length && x >= 0 && x < tiers[0].length,
    tierAt: (x, y) => tiers[y]?.[x] ?? 0,
  };
}
const cam = { x: 0, y: 0 };

test('高一層，頂面往上抬 LIFT 行', () => {
  expect(topRow(10, 0, 0)).toBe(10);
  expect(topRow(10, 2, 0)).toBe(10 - 2 * LIFT);
  expect(topRow(10, 1, 4)).toBe(6 - LIFT);
});

test('山地多出來的層每層只抬 MOUNTAIN_LIFT 行', () => {
  expect(liftOf(4)).toBe(4 * LIFT);
  expect(liftOf(5)).toBe(4 * LIFT + MOUNTAIN_LIFT);
  expect(liftOf(7)).toBe(4 * LIFT + 3 * MOUNTAIN_LIFT);
  expect(topRow(20, 6, 0)).toBe(20 - liftOf(6));
});

test('平地：點哪格就是哪格', () => {
  const w = fakeWorld([
    [0, 0],
    [0, 0],
  ]);
  expect(pick(w, cam, 1, 1)).toEqual({ x: 1, y: 1 });
  expect(screenOf(w, cam, 1, 1)).toEqual({ vx: 1, vy: 1 });
});

test('抬高的格子：點它的頂面或側面都選到它；它擋住的後面那格選不到', () => {
  // 第 5 列那格高 1 層：頂面在第 5-LIFT 列，側面蓋到第 5 列
  const rows = Array.from({ length: 8 }, () => [0]);
  rows[5][0] = 1;
  const w = fakeWorld(rows);
  const top = 5 - LIFT;
  expect(pick(w, cam, 0, top)).toEqual({ x: 0, y: 5 }); // 頂面
  expect(pick(w, cam, 0, 5)).toEqual({ x: 0, y: 5 }); // 側面
  expect(pick(w, cam, 0, top - 1)).toEqual({ x: 0, y: top - 1 }); // 再往上是北邊的平地
  expect(screenOf(w, cam, 0, 5)).toEqual({ vx: 0, vy: top });
});

test('世界外選不到', () => {
  const w = fakeWorld([[0]]);
  expect(pick(w, cam, 3, 0)).toBeNull();
});
