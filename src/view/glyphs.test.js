import { expect, test } from 'vitest';
import { DATA } from '../data/load.js';
import { cp437Index } from './cp437.js';
import { DUNE_STEEP, MOUNTAIN_STEEP, RELIEF, RELIEF_STEPS, reliefGlyph, STYLES, terrainGlyph } from './glyphs.js';

const base = { slope: 0, temperature: 'mild', moisture: 'normal', edge: false, a: 0.5, b: 0.9 };
const glyphs = (style, over = {}) => {
  const seen = new Set();
  for (let i = 0; i < 100; i++) seen.add(terrainGlyph({ ...base, style, a: i / 100, ...over }));
  return seen;
};

test('起伏：越陡越密，空白 → . → · → ∙', () => {
  expect(reliefGlyph(0)).toBe(' ');
  expect(reliefGlyph(RELIEF_STEPS[0])).toBe('.');
  expect(reliefGlyph(RELIEF_STEPS[1])).toBe('·');
  expect(reliefGlyph(255)).toBe('∙');
  expect(RELIEF).toEqual([' ', '.', '·', '∙']);
});

test('山地：坡陡是山坡 ▲，其餘是山地 ^', () => {
  expect(terrainGlyph({ ...base, style: 'mountain', slope: MOUNTAIN_STEEP })).toBe('▲');
  expect(terrainGlyph({ ...base, style: 'mountain', slope: MOUNTAIN_STEEP - 1 })).toBe('^');
});

test('沙地：平坦處是空白與波紋，坡陡出現沙丘 ^', () => {
  expect(glyphs('sand')).toEqual(new Set([' ', '-', '~']));
  expect(terrainGlyph({ ...base, style: 'sand', slope: DUNE_STEEP })).toBe('^');
});

test('水：深水大多空白、偶爾 ≈；淺水是 - 與 ~', () => {
  expect(glyphs('deep-water')).toEqual(new Set([' ', '≈']));
  expect(glyphs('shallow-water')).toEqual(new Set(['-', '~']));
});

test('草地：植被看溫度與濕度；生態交界出現混合植被 ;；很陡的草坡看得出起伏', () => {
  expect(glyphs('grass', { moisture: 'dry' })).toEqual(new Set([',', "'"]));
  expect(glyphs('grass', { moisture: 'wet' })).toEqual(new Set(['"', "'"]));
  expect(glyphs('grass', { temperature: 'cold', moisture: 'wet' })).toContain(':');
  expect(terrainGlyph({ ...base, style: 'grass', edge: true, b: 0.1 })).toBe(';');
  expect(terrainGlyph({ ...base, style: 'grass', slope: 255 })).toBe('∙');
});

test('雪地只有起伏；泥地有起伏、零星碎葉，寒冷時長苔蘚', () => {
  for (const g of glyphs('snow', { slope: 60 })) expect(RELIEF).toContain(g);
  expect(glyphs('mud')).toContain(',');
  expect(glyphs('mud', { temperature: 'cold' })).toContain(':');
});

test('實際資料：每種地形的 style 都有規則，用到的字元都在 CP437 字元表裡', () => {
  for (const t of DATA.terrains) {
    expect(STYLES, t.id).toContain(t.style);
    for (const ch of t.glyphs) if (ch !== ' ') expect(cp437Index(ch), `${t.id} ${ch}`).toBeGreaterThan(0);
  }
});
