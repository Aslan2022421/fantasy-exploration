import { expect, test } from 'vitest';
import { inShadow, SIDE_MAX, sideLength, sideSource } from './extrude.js';

// 測試用的小世界：tiers[y][x] 是高度層，objs[y][x] 是物件編號（-1 沒有）
function fakeWorld(tiers, objs = null) {
  return {
    inside: (x, y) => y >= 0 && y < tiers.length && x >= 0 && x < tiers[0].length,
    tierAt: (x, y) => tiers[y]?.[x] ?? 0,
    objectAt: (x, y) => objs?.[y]?.[x] ?? -1,
  };
}
const flat = (w, h, v = 1) => Array.from({ length: h }, () => new Array(w).fill(v));

test('高一層拉 2 格、高兩層以上拉 3 格，最多 SIDE_MAX', () => {
  expect(sideLength(0)).toBe(0);
  expect(sideLength(-1)).toBe(0);
  expect(sideLength(1)).toBe(2);
  expect(sideLength(2)).toBe(3);
  expect(sideLength(5)).toBe(SIDE_MAX);
});

test('高處的側面畫進左下的格子', () => {
  const t = flat(6, 6, 1);
  t[1][4] = 2; // 高一層：拉 2 格
  const w = fakeWorld(t);
  expect(sideSource(w, 3, 2)).toEqual({ x: 4, y: 1, k: 1 });
  expect(sideSource(w, 2, 3)).toEqual({ x: 4, y: 1, k: 2 });
  expect(sideSource(w, 1, 4)).toBeNull(); // 第 3 格超過長度
  expect(sideSource(w, 5, 2)).toBeNull(); // 右下不是左下
});

test('樹的影子往左下拉樹高那麼多格，比樹高的地方不吃影子', () => {
  const t = flat(6, 6, 1);
  const objs = flat(6, 6, -1);
  objs[1][4] = 0; // 物件 0 高 3
  const objects = [{ height: 3 }];
  expect(inShadow(fakeWorld(t, objs), objects, 3, 2)).toBe(true);
  expect(inShadow(fakeWorld(t, objs), objects, 1, 4)).toBe(true);
  expect(inShadow(fakeWorld(t, objs), objects, 0, 5)).toBe(false); // 第 4 格
  t[4][1] = 3; // 這格比樹高
  expect(inShadow(fakeWorld(t, objs), objects, 1, 4)).toBe(false);
  expect(inShadow(fakeWorld(t, objs), [{ height: 1 }], 2, 3)).toBe(false); // 矮的物件影子短
});
