import { expect, test } from 'vitest';
import { LEVELS } from '../world/hillshade.js';
import { FACE, FACE_FAR, FLAT, RIM } from '../world/relief.js';
import { cp437Index } from './cp437.js';
import { buildShadeTable, RAMP, rampGlyph } from './shades.js';

const terrains = [
  { id: 'grass', color: '#808080', shade: true, ramp: true, glyph: '"' },
  { id: 'water', color: '#3b6f8f', shade: false, ramp: false, glyph: '≈' },
  { id: 'tree', color: '#5f8a4a', shade: true, ramp: false, glyph: '♣' },
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

test('密度階梯的字元都在 CP437 字元表裡，由疏到密', () => {
  expect(RAMP).toHaveLength(LEVELS);
  // 空白只畫背景（tiles.js），其餘都要在字元表裡
  for (const ch of RAMP.slice(1)) expect(cp437Index(ch), ch).toBeGreaterThan(0);
  expect(RAMP[0]).toBe(' ');
});

test('地面依亮度選字元：越亮越密，立面比平地疏', () => {
  const { glyph } = buildShadeTable(terrains);
  const at = (ch) => RAMP.indexOf(ch);
  for (let i = 1; i < LEVELS; i++) expect(at(glyph[0][i][FLAT])).toBeGreaterThanOrEqual(at(glyph[0][i - 1][FLAT]));
  expect(at(glyph[0][5][FACE])).toBeLessThan(at(glyph[0][5][FLAT]));
  expect(at(glyph[0][5][RIM])).toBeGreaterThan(at(glyph[0][5][FLAT]));
  expect(rampGlyph(0, FACE_FAR)).toBe(' ');
});

test('東西保留自己的字元', () => {
  const { glyph } = buildShadeTable(terrains);
  expect(new Set(glyph[1].flat())).toEqual(new Set(['≈']));
  expect(new Set(glyph[2].flat())).toEqual(new Set(['♣']));
});

test('不套明暗的地形每一級、每種立面都是同一個顏色', () => {
  const { fg } = buildShadeTable(terrains);
  expect(new Set(fg[1].flat())).toEqual(new Set(['#3b6f8f']));
});
