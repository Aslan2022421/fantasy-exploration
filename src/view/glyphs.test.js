import { expect, test } from 'vitest';
import { DATA } from '../data/load.js';
import { cp437Index } from './cp437.js';
import { cellGlyph, DUNE_STEEP, MOUNTAIN_MARK, RELIEF, RELIEF_STEPS, reliefGlyph } from './glyphs.js';

const base = { water: null, surface: 'relief', mountain: false, peak: false, cover: null, slope: 0, a: 0.5, b: 0.5 };
const glyphs = (over = {}) => {
  const seen = new Set();
  for (let i = 0; i < 100; i++) seen.add(cellGlyph({ ...base, a: i / 100, ...over }).glyph);
  return seen;
};

test('起伏：越陡越密，空白 → . → · → ∙', () => {
  expect(reliefGlyph(0)).toBe(' ');
  expect(reliefGlyph(RELIEF_STEPS[0])).toBe('.');
  expect(reliefGlyph(RELIEF_STEPS[1])).toBe('·');
  expect(reliefGlyph(255)).toBe('∙');
  expect(RELIEF).toEqual([' ', '.', '·', '∙']);
});

test('山地：山峰是 ▲；其餘一部分畫 ^、剩下露出材質，顏色取材質', () => {
  const m = { mountain: true, b: 0.9 }; // a 留給 glyphs() 掃
  expect(cellGlyph({ ...base, ...m, peak: true })).toEqual({ glyph: '▲', ink: 'surface' });
  expect(cellGlyph({ ...base, ...m, b: MOUNTAIN_MARK - 0.01 })).toEqual({ glyph: '^', ink: 'surface' });
  expect(glyphs({ ...m, surface: 'rock' })).toContain('■');
  expect(glyphs({ ...m, surface: 'gravel' })).toContain('°');
  expect(glyphs({ ...m, slope: 255 })).toEqual(new Set(['∙'])); // 雪露出起伏點
});

test('材質：沙地平坦處空白與波紋、坡陡是沙丘；岩石 ■、碎石 °', () => {
  expect(glyphs({ surface: 'sand' })).toEqual(new Set([' ', '-', '~']));
  expect(cellGlyph({ ...base, surface: 'sand', slope: DUNE_STEEP }).glyph).toBe('^');
  expect(glyphs({ surface: 'rock' })).toContain('■');
  expect(glyphs({ surface: 'gravel' })).toContain('°');
});

test('水文：深水大多空白、偶爾 ≈；淺水與沼澤是 - 與 ~；結冰的淺水是冰面', () => {
  expect(glyphs({ water: 'deep' })).toEqual(new Set([' ', '≈']));
  expect(glyphs({ water: 'shallow' })).toEqual(new Set(['-', '~']));
  expect(glyphs({ water: 'swamp' })).toEqual(new Set(['-', '~']));
  expect(cellGlyph({ ...base, water: 'swamp' }).ink).toBe('water');
  expect(glyphs({ water: 'shallow', surface: 'ice' })).toEqual(new Set(['═', ' ']));
});

test('疊放順序：水文 > 生態覆蓋 > 山地 > 材質', () => {
  expect(cellGlyph({ ...base, water: 'shallow', cover: ',' }).ink).toBe('water');
  expect(cellGlyph({ ...base, cover: ',', mountain: true })).toEqual({ glyph: ',', ink: 'cover' });
  expect(cellGlyph({ ...base, mountain: true, surface: 'gravel', b: 0 }).glyph).toBe('^');
  expect(cellGlyph({ ...base, cover: ',', peak: true, mountain: true }).ink).toBe('cover');
});

test('實際資料：四層用到的字元都在 CP437 字元表裡，覆蓋一種一個字、不重複', () => {
  for (const t of DATA.terrains) {
    for (const ch of [t.glyph, ...(t.glyphs ?? [])])
      if (ch !== ' ') expect(cp437Index(ch), `${t.id} ${ch}`).toBeGreaterThan(0);
  }
  const coverGlyphs = DATA.covers.map((c) => c.glyph);
  expect(new Set(coverGlyphs).size).toBe(coverGlyphs.length);
});
