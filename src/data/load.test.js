import { describe, expect, test } from 'vitest';
import { cp437Index } from '../view/cp437.js';
import { buildData } from './build.js';
import { DATA } from './load.js';

const terrain = (id, extra = {}) => ({
  id,
  name: '地',
  glyph: '.',
  color: '#ffffff',
  passable: true,
  shade: true,
  ramp: true,
  tile: null,
  ...extra,
});
const biome = (id, extra = {}) => ({
  id,
  name: '生態',
  temperature: 'mild',
  moisture: 'normal',
  ground: 'grass',
  flora: [],
  ...extra,
});

describe('實際的資料', () => {
  test('載入成功，地形與生態都有', () => {
    expect(DATA.terrains.length).toBeGreaterThan(0);
    expect(DATA.biomes).toHaveLength(9);
  });

  test('每種地形的字元都在 CP437 字元表裡', () => {
    for (const t of DATA.terrains) expect(cp437Index(t.glyph), `${t.id} 的字元 ${t.glyph}`).toBeGreaterThan(0);
  });

  test('溫度帶×濕度帶九格各有一種生態', () => {
    const keys = new Set(DATA.biomes.map((b) => `${b.temperature}:${b.moisture}`));
    expect(keys.size).toBe(9);
  });
});

describe('資料檢查抓得到錯', () => {
  test('id 重複', () => {
    expect(() => buildData({ terrain: { a: [terrain('grass'), terrain('grass')] }, biome: {} })).toThrow(/id 重複/);
  });

  test('引用找不到對象', () => {
    const files = { terrain: { a: [terrain('grass')] }, biome: { b: [biome('x', { ground: 'lava' })] } };
    expect(() => buildData(files)).toThrow(/找不到地形：lava/);
  });

  test('欄位不合規格', () => {
    expect(() => buildData({ terrain: { a: [terrain('grass', { color: 'green' })] }, biome: {} })).toThrow(/#rrggbb/);
  });

  test('多個檔案合併、跨檔引用', () => {
    const files = { terrain: { a: [terrain('grass')], b: [terrain('sand')] }, biome: { c: [biome('x')] } };
    const d = buildData(files);
    expect(d.terrains.map((t) => t.id)).toEqual(['grass', 'sand']);
    expect(d.terrainIndex.get('sand')).toBe(1);
  });
});
