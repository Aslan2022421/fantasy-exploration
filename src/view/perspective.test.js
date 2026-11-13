import { expect, test } from 'vitest';
import { PERSPECTIVE, perspectiveSource, sideLengthAt } from './perspective.js';

// 測試用的小世界：tiers[y][x] 是高度層，objs[y][x] 是物件編號（-1 沒有）
function fakeWorld(tiers, objs = null) {
  return {
    inside: (x, y) => y >= 0 && y < tiers.length && x >= 0 && x < tiers[0].length,
    tierAt: (x, y) => tiers[y]?.[x] ?? 0,
    objectAt: (x, y) => objs?.[y]?.[x] ?? -1,
  };
}
const grid = (n, v) => Array.from({ length: n }, () => new Array(n).fill(v));
const N = 61;
const C = 30; // 畫面中心

test('側面長度：離中心越遠、高出越多越長，最多 max 格，不高就沒有', () => {
  expect(sideLengthAt(20, 0, PERSPECTIVE.terrain)).toBe(0);
  expect(sideLengthAt(2, 1, PERSPECTIVE.terrain)).toBe(0); // 正下方看不到側面
  expect(sideLengthAt(20, 1, PERSPECTIVE.terrain)).toBe(1);
  expect(sideLengthAt(30, 2, PERSPECTIVE.terrain)).toBe(PERSPECTIVE.max);
});

test('高處的側面往畫面中心那一側拉，四個方向都一樣', () => {
  for (const [ux, uy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]) {
    const t = grid(N, 1);
    const hx = C + ux * 28;
    const hy = C + uy * 28;
    t[hy][hx] = 3; // 高兩層、離中心 28 格：側面 3 格
    const w = fakeWorld(t);
    expect(perspectiveSource(w, [], C, C, hx - ux, hy - uy, false)).toMatchObject({ x: hx, y: hy, k: 1 });
    expect(perspectiveSource(w, [], C, C, hx - 3 * ux, hy - 3 * uy, false)).toMatchObject({ k: 3, kind: 'terrain' });
    expect(perspectiveSource(w, [], C, C, hx - 4 * ux, hy - 4 * uy, false)).toBeNull();
    expect(perspectiveSource(w, [], C, C, hx + ux, hy + uy, false)).toBeNull(); // 外側不是側面
  }
});

test('物件的側面只蓋沒有物件、不比它高的格子', () => {
  const t = grid(N, 1);
  const objs = grid(N, -1);
  objs[C][C + 25] = 0; // 樹高 3、離中心 25 格
  const objects = [{ height: 3 }];
  const w = fakeWorld(t, objs);
  expect(perspectiveSource(w, objects, C, C, C + 24, C, false)).toMatchObject({ kind: 'object', k: 1 });
  expect(perspectiveSource(w, objects, C, C, C + 24, C, true)).toBeNull(); // 這格自己有物件
  t[C][C + 24] = 2;
  expect(perspectiveSource(w, objects, C, C, C + 24, C, false)).toBeNull(); // 這格比樹腳高
});

test('畫面中心那格沒有側面', () => {
  const t = grid(N, 1);
  t[C - 1][C] = 4;
  expect(perspectiveSource(fakeWorld(t), [], C, C, C, C, false)).toBeNull();
});
