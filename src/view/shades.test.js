import { expect, test } from 'vitest';
import { LEVELS, lightLevel } from '../world/hillshade.js';
import { buildShadeTable, mixColor } from './shades.js';

const terrains = [
  { id: 'grass', color: '#808080', shade: true },
  { id: 'water', color: '#3b6f8f', shade: false },
];
const lum = (hex) => Number.parseInt(hex.slice(1, 3), 16);

test('越亮的級數顏色越亮，字元與背景都是', () => {
  const { fg, bg } = buildShadeTable(terrains);
  expect(fg[0]).toHaveLength(LEVELS);
  for (let i = 1; i < LEVELS; i++) {
    expect(lum(fg[0][i])).toBeGreaterThanOrEqual(lum(fg[0][i - 1]));
    expect(lum(bg[0][i])).toBeGreaterThanOrEqual(lum(bg[0][i - 1]));
  }
});

test('背景比字元暗', () => {
  const { fg, bg } = buildShadeTable(terrains);
  expect(lum(bg[0][5])).toBeLessThan(lum(fg[0][5]));
});

test('不套明暗的地形每一級都是同一個顏色（降過彩度的原色）', () => {
  const { fg } = buildShadeTable(terrains);
  const colors = new Set(fg[1]);
  expect(colors.size).toBe(1);
  const [hex] = colors;
  const rgb = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  // 原色 #3b6f8f 的藍比紅多 84；降彩度後差距變小，但還是偏藍
  expect(rgb[2] - rgb[0]).toBeGreaterThan(0);
  expect(rgb[2] - rgb[0]).toBeLessThan(0x8f - 0x3b);
});

test('混色：兩端是原色，中間介於兩者', () => {
  expect(mixColor('#000000', '#ffffff', 0)).toBe('#000000');
  expect(mixColor('#000000', '#ffffff', 1)).toBe('#ffffff');
  expect(lum(mixColor('#000000', '#ffffff', 0.5))).toBeGreaterThan(100);
});

test('高度層越高越亮；坡向只微調', () => {
  expect(lightLevel(0, 5)).toBeLessThan(lightLevel(4, 5));
  expect(Math.abs(lightLevel(2, 0) - lightLevel(2, 5))).toBeLessThanOrEqual(2);
  expect(Math.abs(lightLevel(2, 7) - lightLevel(2, 5))).toBeLessThanOrEqual(1);
});
