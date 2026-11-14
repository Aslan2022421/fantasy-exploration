import { describe, expect, test } from 'vitest';
import { cp437Index } from '../view/cp437.js';
import { buildData } from './build.js';
import { DATA } from './load.js';

const surface = (id, extra = {}) => ({
  layer: 'surface',
  id,
  name: '地',
  glyph: '.',
  color: '#ffffff',
  passable: true,
  style: 'relief',
  glyphs: ['.'],
  tile: null,
  ...extra,
});
const cover = (id) => ({ layer: 'cover', id, name: '草', glyph: ',', color: '#00ff00', tile: null });
const biome = (id, extra = {}) => ({
  id,
  name: '生態',
  temperature: 'mild',
  moisture: 'normal',
  flora: [],
  cover: [],
  ...extra,
});

describe('實際的資料', () => {
  test('載入成功，四層與生態都有', () => {
    for (const k of ['landforms', 'surfaces', 'waters', 'covers']) expect(DATA[k].length, k).toBeGreaterThan(0);
    expect(DATA.biomes).toHaveLength(9);
    expect(DATA.terrains).toHaveLength(
      DATA.landforms.length + DATA.surfaces.length + DATA.waters.length + DATA.covers.length,
    );
  });

  test('調色盤依序是材質、水文、覆蓋', () => {
    const { palette, paletteBase: b } = DATA;
    expect(palette[b.surface].id).toBe(DATA.surfaces[0].id);
    expect(palette[b.water].id).toBe(DATA.waters[0].id);
    expect(palette[b.cover].id).toBe(DATA.covers[0].id);
    expect(palette).toHaveLength(DATA.surfaces.length + DATA.waters.length + DATA.covers.length);
  });

  test('每種地形與物件的字元都在 CP437 字元表裡', () => {
    for (const t of [...DATA.terrains, ...DATA.objects])
      expect(cp437Index(t.glyph), `${t.id} 的字元 ${t.glyph}`).toBeGreaterThan(0);
  });

  test('物件都有，樹與矮叢在物件層', () => {
    expect(DATA.objects.map((o) => o.id)).toEqual(expect.arrayContaining(['spruce', 'maple', 'oak', 'palm', 'shrub']));
  });

  test('溫度帶×濕度帶九格各有一種生態；草地與沼澤不是生態也不是材質', () => {
    const keys = new Set(DATA.biomes.map((b) => `${b.temperature}:${b.moisture}`));
    expect(keys.size).toBe(9);
    expect(DATA.waterIndex.has('swamp')).toBe(true);
    expect(DATA.biomes.some((b) => b.id === 'swamp')).toBe(false);
    expect(DATA.surfaceIndex.has('grass')).toBe(false);
  });
});

describe('資料檢查抓得到錯', () => {
  test('id 重複', () => {
    expect(() => buildData({ terrain: { a: [surface('dirt'), surface('dirt')] }, biome: {} })).toThrow(/id 重複/);
  });

  test('生態的覆蓋找不到', () => {
    const files = {
      terrain: { a: [surface('dirt')] },
      biome: { b: [biome('x', { cover: [{ cover: 'lava', density: 0.1 }] })] },
    };
    expect(() => buildData(files)).toThrow(/找不到生態覆蓋：lava/);
  });

  test('欄位不合規格；layer 決定要哪些欄位', () => {
    expect(() => buildData({ terrain: { a: [surface('dirt', { color: 'green' })] }, biome: {} })).toThrow(/#rrggbb/);
    expect(() => buildData({ terrain: { a: [{ ...cover('x'), layer: 'lava' }] }, biome: {} })).toThrow();
  });

  test('生態的 flora 要引用物件，引用覆蓋不算', () => {
    const files = {
      terrain: { a: [cover('grass')] },
      object: {},
      biome: { b: [biome('x', { flora: [{ object: 'grass', density: 0.1 }] })] },
    };
    expect(() => buildData(files)).toThrow(/找不到物件：grass/);
  });

  test('多個檔案合併、跨檔引用，各層編號各自算', () => {
    const files = {
      terrain: { a: [surface('dirt')], b: [cover('moss'), surface('sand')] },
      biome: { c: [biome('x', { cover: [{ cover: 'moss', density: 0.5 }] })] },
    };
    const d = buildData(files);
    expect(d.surfaces.map((t) => t.id)).toEqual(['dirt', 'sand']);
    expect(d.surfaceIndex.get('sand')).toBe(1);
    expect(d.coverIndex.get('moss')).toBe(0);
  });
});
