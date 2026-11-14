import { expect, test } from 'vitest';
import { DATA } from '../data/load.js';
import {
  approach,
  fadeAt,
  groundHeight,
  LERP,
  layerStep,
  liftUp,
  mountainRingFactor,
  objectLayers,
  STACK,
  shiftOf,
  shiftUp,
  slopeTilt,
  UP,
  wallRange,
  wallSouth,
} from './perspective.js';

// 測試用的小世界：tiers[y][x] 是高度層
function fakeWorld(tiers) {
  return {
    inside: (x, y) => y >= 0 && y < tiers.length && x >= 0 && x < tiers[0].length,
    tierAt: (x, y) => tiers[y]?.[x] ?? 0,
  };
}
const grid = (n, v) => Array.from({ length: n }, () => new Array(n).fill(v));
const obj = (id) => DATA.objects[DATA.objectIndex.get(id)];

test('錯開量：比原點高往外、低往內，離中心越遠越大但有上限；原點與畫面中心不動', () => {
  expect(layerStep(10)).toBeCloseTo(0.6);
  expect(layerStep(100)).toBe(STACK.maxStep);
  expect(shiftOf(20, 0, 0)).toEqual({ ox: 0, oy: 0 });
  expect(shiftOf(0, 0, 3)).toEqual({ ox: 0, oy: 0 });
  expect(shiftOf(20, 0, 2).ox).toBeCloseTo(2); // 往外
  expect(shiftOf(20, 0, -2).ox).toBeCloseTo(-2); // 往內
  expect(shiftOf(0, -30, 99).oy).toBeCloseTo(-STACK.maxShift); // 遠處角落不會拉長
});

test('相機平滑緩衝：往目標靠近但不一步到位；夠近或太遠直接到位', () => {
  const next = approach(0, 1, LERP.tau);
  expect(next).toBeGreaterThan(0.5);
  expect(next).toBeLessThan(1);
  expect(approach(0.995, 1, 16)).toBe(1);
  expect(approach(0, 100, 16)).toBe(100);
});

test('下面幾層往地面底色壓淡，頂層不壓，越往下壓越多', () => {
  expect(fadeAt(0)).toBe(0);
  for (let j = 1; j < STACK.fade.length; j++) expect(fadeAt(j)).toBeGreaterThan(fadeAt(j - 1));
  expect(STACK.fade).toHaveLength(5);
});

test('地面高度：陸地每層 2 層，山地每圈 1 層；山地底色往上一圈比一圈亮', () => {
  expect(groundHeight(4)).toBe(8);
  expect(groundHeight(5)).toBe(9);
  const at = (h) => Math.round((h + 1) * 127.5);
  expect(mountainRingFactor(at(0.43))).toBeCloseTo(0.75);
  expect(mountainRingFactor(at(0.63))).toBeGreaterThan(mountainRingFactor(at(0.5)));
  expect(mountainRingFactor(255)).toBe(1);
});

test('牆：比往中心那一格高才有，記下低處那格；水邊遠側的岸有岸壁', () => {
  const t = grid(21, 1);
  t[10][3] = 0; // 中心左邊的水，再往左是岸
  t[10][16] = 3; // 中心右邊的台地
  const w = fakeWorld(t);
  expect(wallRange(w, 10, 10, 2, 10)).toEqual({ from: 0, to: groundHeight(1) - 1, low: { x: 3, y: 10 } });
  expect(wallRange(w, 10, 10, 4, 10)).toBeNull(); // 近側的岸
  expect(wallRange(w, 10, 10, 16, 10)).toMatchObject({ from: groundHeight(1), to: groundHeight(3) - 1 });
  expect(wallRange(w, 10, 10, 10, 10)).toBeNull();
});

test('往上錯開的量是固定螢幕像素、接近垂直：每層往上 px、往右只偏 1 像素，總量有上限', () => {
  for (const k of [1, 2, 3, 4]) {
    const s = shiftUp(2, k);
    expect(s.oy * k).toBeCloseTo(-2 * UP.px);
    expect(s.ox * k).toBeCloseTo(2 * UP.leanPx);
    expect(shiftUp(999, k).oy * k).toBeCloseTo(-UP.maxPx);
    expect(liftUp(4, k).oy * k).toBeCloseTo(-4 * UP.objPx); // 樹每層錯得比地形多
    expect(liftUp(4, k).ox * k).toBeCloseTo(4 * UP.objLeanPx);
  }
  expect(shiftUp(0, 2)).toEqual({ ox: 0, oy: 0 });
});

test('斜坡那層：往上一層，往上坡那側（東高往右、西高往左）偏', () => {
  expect(slopeTilt(5, 1).ox).toBeGreaterThan(0);
  expect(slopeTilt(-5, 1).ox).toBeLessThan(0);
  expect(slopeTilt(0, 1).ox).toBe(0);
  expect(slopeTilt(5, 1).oy).toBe(-UP.px);
});

test('往斜上方疊的牆：比南、西、西南最低那格高才有，從那格的高度疊上來', () => {
  const t = grid(9, 1);
  t[4][4] = 3; // 一格高台
  const w = fakeWorld(t);
  expect(wallSouth(w, 4, 4)).toEqual({ from: groundHeight(1), to: groundHeight(3) - 1, low: { x: 4, y: 5 } });
  t[4][3] = 0; // 西邊變成水，比南邊低
  expect(wallSouth(w, 4, 4)).toMatchObject({ from: 0, low: { x: 3, y: 4 } });
  expect(wallSouth(w, 5, 3)).toBeNull(); // 高台東北那格：南、西一樣高，西南比它高
});

test('樹：依種類疊層，樹幹那格從 1 疊到 height-1、頂層是樹冠；旁邊的樹冠只有頂層一片；矮叢平的不疊', () => {
  for (const id of ['broadleaf', 'conifer', 'palm']) {
    const o = obj(id);
    expect(o.height).toBeGreaterThanOrEqual(3);
    expect(o.height).toBeLessThanOrEqual(5);
    const trunk = objectLayers(o, true);
    expect(trunk.filter((l) => l.part === 'trunk').map((l) => l.dh)).toEqual(
      Array.from({ length: o.height - 1 }, (_, i) => i + 1),
    );
    expect(trunk.at(-1)).toMatchObject({ dh: o.height, part: 'leaf' });
    expect(objectLayers(o, false)).toEqual([{ dh: o.height, part: 'leaf', j: 0 }]);
  }
  expect(obj('conifer').canopy).toBe('cross');
  expect(obj('broadleaf').canopy).toBe('round');
  expect(objectLayers(obj('shrub'), false)).toEqual([{ dh: 0, part: 'solid', j: 0 }]);
  expect(objectLayers(null, false)).toEqual([]);
});
