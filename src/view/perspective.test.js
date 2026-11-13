import { expect, test } from 'vitest';
import { DATA } from '../data/load.js';
import { layerOffset, layerStep, MAX_LAYERS, objectLayers, STACK, terrainLayers } from './perspective.js';

// 測試用的小世界：tiers[y][x] 是高度層
function fakeWorld(tiers) {
  return {
    inside: (x, y) => y >= 0 && y < tiers.length && x >= 0 && x < tiers[0].length,
    tierAt: (x, y) => tiers[y]?.[x] ?? 0,
  };
}
const grid = (n, v) => Array.from({ length: n }, () => new Array(n).fill(v));

test('每層錯開量：離中心越遠越大，最多 maxStep；頂層與畫面中心不錯開', () => {
  expect(layerStep(0)).toBe(0);
  expect(layerStep(10)).toBeCloseTo(1.5);
  expect(layerStep(100)).toBe(STACK.maxStep);
  expect(layerOffset(20, 0, 0)).toEqual({ ox: 0, oy: 0 });
  expect(layerOffset(0, 0, 2)).toEqual({ ox: 0, oy: 0 });
});

test('下層往畫面中心錯開，四個方向都一樣，越往下錯越多', () => {
  expect(layerOffset(20, 0, 1)).toEqual({ ox: -3, oy: 0 });
  expect(layerOffset(-20, 0, 2)).toEqual({ ox: 6, oy: 0 });
  expect(layerOffset(0, 20, 1)).toEqual({ ox: 0, oy: -3 });
  expect(layerOffset(0, -10, 2)).toEqual({ ox: 0, oy: 3 });
});

test('地形只在比往中心那一格高的邊緣疊：高一層 2 層、兩層以上 3 層', () => {
  const t = grid(21, 1);
  t[10][15] = 2;
  t[10][5] = 4;
  const w = fakeWorld(t);
  expect(terrainLayers(w, 10, 10, 15, 10)).toBe(2); // 往中心那格低一層
  expect(terrainLayers(w, 10, 10, 5, 10)).toBe(3);
  expect(terrainLayers(w, 10, 10, 16, 10)).toBe(0); // 往中心那格比較高
  expect(terrainLayers(w, 10, 10, 10, 10)).toBe(0); // 畫面中心
});

test('物件照高度疊層：資料裡的樹 3 層、矮叢 2 層，最多 MAX_LAYERS', () => {
  const h = Object.fromEntries(DATA.objects.map((o) => [o.id, objectLayers(o)]));
  expect(h.shrub).toBe(2);
  expect(h.broadleaf).toBe(3);
  expect(objectLayers({ height: 9 })).toBe(MAX_LAYERS);
  expect(objectLayers(null)).toBe(0);
});
