import { expect, test } from 'vitest';
import { LEVELS } from '../world/hillshade.js';
import { buildShadeTable } from './shades.js';

const terrains = [
  { id: 'grass', color: '#808080', shade: true },
  { id: 'water', color: '#3b6f8f', shade: false },
];

test('每種地形 8 級，越亮的級數顏色越亮', () => {
  const table = buildShadeTable(terrains);
  expect(table[0]).toHaveLength(LEVELS);
  const lum = (hex) => Number.parseInt(hex.slice(1, 3), 16);
  for (let i = 1; i < LEVELS; i++) expect(lum(table[0][i])).toBeGreaterThanOrEqual(lum(table[0][i - 1]));
  expect(table[0][0]).not.toBe(table[0][LEVELS - 1]);
});

test('不套明暗的地形每一級都是原色', () => {
  const table = buildShadeTable(terrains);
  expect(new Set(table[1])).toEqual(new Set(['#3b6f8f']));
});

test('顏色種類有上限：地形數×8', () => {
  const table = buildShadeTable(terrains);
  expect(new Set(table.flat()).size).toBeLessThanOrEqual(terrains.length * LEVELS);
});
