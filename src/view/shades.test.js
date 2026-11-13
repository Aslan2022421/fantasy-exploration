import { expect, test } from 'vitest';
import { DATA } from '../data/load.js';
import { LEVELS, lightLevel } from '../world/hillshade.js';
import { FACE, FACE_FAR, FLAT, RIM } from '../world/relief.js';
import { cp437Index } from './cp437.js';
import { buildShadeTable, rampGlyph, rampStep } from './shades.js';

const RAMP = [' ', '.', '.,', ",'", '\'"', '"√'];
const terrains = [
  { id: 'grass', color: '#808080', shade: true, ramp: RAMP, glyph: '"' },
  { id: 'water', color: '#3b6f8f', shade: false, ramp: [' ', '-', '~', '≈'], glyph: '≈' },
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

test('實際資料：每種地形的字元階梯都在 CP437 字元表裡（空白只畫背景）', () => {
  for (const t of DATA.terrains) {
    expect(t.ramp.length, t.id).toBeGreaterThanOrEqual(2);
    for (const step of t.ramp)
      for (const ch of step) if (ch !== ' ') expect(cp437Index(ch), `${t.id} ${ch}`).toBeGreaterThan(0);
  }
});

test('依亮度選階：越亮越往密的那頭，立面比平地疏、台地邊緣比平地密', () => {
  const { step } = buildShadeTable(terrains);
  for (let i = 1; i < LEVELS; i++) expect(step[0][i][FLAT]).toBeGreaterThanOrEqual(step[0][i - 1][FLAT]);
  expect(step[0][5][FACE]).toBeLessThan(step[0][5][FLAT]);
  expect(step[0][5][RIM]).toBeGreaterThan(step[0][5][FLAT]);
  expect(rampStep(RAMP.length, 0, FACE_FAR)).toBe(0);
  expect(rampStep(RAMP.length, 7, RIM)).toBe(RAMP.length - 1);
});

test('同一階挑字、偏一階：不會超出階梯，同一階的字都用得到', () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const a = 0.5; // 不偏
    const b = i / 200;
    seen.add(rampGlyph(RAMP, 3, a, b));
  }
  expect(seen).toEqual(new Set([',', "'"]));
  expect(rampGlyph(RAMP, 0, 0.01, 0.5)).toBe(' '); // 往暗偏也停在第 0 階
  expect(RAMP.at(-1)).toContain(rampGlyph(RAMP, RAMP.length - 1, 0.99, 0.1)); // 往亮偏也停在最後一階
  expect(RAMP[2]).toContain(rampGlyph(RAMP, 3, 0.01, 0.5)); // 往暗偏一階
  expect(RAMP[4]).toContain(rampGlyph(RAMP, 3, 0.99, 0.5)); // 往亮偏一階
});

test('不套明暗的地形每一級、每種立面都是同一個顏色（降過彩度的原色）', () => {
  const { fg } = buildShadeTable(terrains);
  const colors = new Set(fg[1].flat());
  expect(colors.size).toBe(1);
  const [hex] = colors;
  const rgb = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  // 原色 #3b6f8f 的藍比紅多 84；降彩度後差距變小，但還是偏藍
  expect(rgb[2] - rgb[0]).toBeGreaterThan(0);
  expect(rgb[2] - rgb[0]).toBeLessThan(0x8f - 0x3b);
});

test('高度層越高越亮；坡向只微調', () => {
  expect(lightLevel(0, 5)).toBeLessThan(lightLevel(4, 5));
  expect(Math.abs(lightLevel(2, 0) - lightLevel(2, 5))).toBeLessThanOrEqual(2);
  expect(Math.abs(lightLevel(2, 7) - lightLevel(2, 5))).toBeLessThanOrEqual(1);
});
