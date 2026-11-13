import { expect, test } from 'vitest';
import { LEVELS } from '../world/hillshade.js';
import { FACE, FACE_FAR, FLAT, RIM } from '../world/relief.js';
import { buildShadeTable } from './shades.js';

const terrains = [
  { id: 'grass', color: '#808080', shade: true },
  { id: 'water', color: '#3b6f8f', shade: false },
];
const lum = (hex) => Number.parseInt(hex.slice(1, 3), 16);

test('越亮的級數顏色越亮，字元與背景都是', () => {
  const { fg, bg } = buildShadeTable(terrains);
  expect(fg[0]).toHaveLength(LEVELS);
  for (let i = 1; i < LEVELS; i++) {
    expect(lum(fg[0][i][FLAT])).toBeGreaterThanOrEqual(lum(fg[0][i - 1][FLAT]));
    expect(lum(bg[0][i][FLAT])).toBeGreaterThanOrEqual(lum(bg[0][i - 1][FLAT]));
  }
});

test('背景比字元暗；立面比平地暗、台地邊緣比平地亮', () => {
  const { fg, bg } = buildShadeTable(terrains);
  const l = 5;
  expect(lum(bg[0][l][FLAT])).toBeLessThan(lum(fg[0][l][FLAT]));
  expect(lum(fg[0][l][FACE])).toBeLessThan(lum(fg[0][l][FLAT]));
  expect(lum(fg[0][l][FACE_FAR])).toBeLessThan(lum(fg[0][l][FACE]));
  expect(lum(fg[0][l][RIM])).toBeGreaterThan(lum(fg[0][l][FLAT]));
});

test('不套明暗的地形每一級、每種立面都是同一個顏色', () => {
  const { fg } = buildShadeTable(terrains);
  expect(new Set(fg[1].flat())).toEqual(new Set(['#3b6f8f']));
});
