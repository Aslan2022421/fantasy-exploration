import { Color } from 'rot-js';
import { describe, expect, test } from 'vitest';
import { playlogName } from '../app/playlog.js';
import { DATA } from '../data/load.js';
import { LAND } from '../world/landform.js';
import { createWorld } from '../world/world.js';
import { coarseColor, coarseImage, MAP_COLORS } from './worldmap.js';

const rgb = (hex) => Color.fromString(hex);

describe('世界地圖', () => {
  test('湖海分深淺、河是河的藍、山越高越白、陸地是生態的顏色', () => {
    const forest = DATA.biomes.find((b) => b.id === 'temperate-forest');
    expect(coarseColor(LAND.water - 0.2, 0, null)).toEqual(rgb(MAP_COLORS.deep));
    expect(coarseColor(LAND.water - 0.01, 0, null)).toEqual(rgb(MAP_COLORS.shallow));
    expect(coarseColor(0, 3, forest)).toEqual(rgb(MAP_COLORS.river));
    const low = coarseColor(LAND.mountain + 0.01, 0, null);
    const high = coarseColor(LAND.mountain + 0.19, 0, null);
    expect(high[0]).toBeGreaterThan(low[0]);
    const plain = coarseColor(0, 0, forest);
    expect(plain).not.toEqual(
      coarseColor(
        0,
        0,
        DATA.biomes.find((b) => b.id === 'desert'),
      ),
    );
  });

  test('每個粗格一個點，大小照地理的粗格；每個生態都有地圖顏色', () => {
    const w = createWorld(7, DATA, { zonesX: 3, zonesY: 3 });
    const img = coarseImage(w, DATA);
    expect(img.length).toBe(w.geography.W * w.geography.H * 4);
    expect(img[3]).toBe(255);
    for (const b of DATA.biomes) expect(b.mapColor).toMatch(/^#/);
  });
});

test('試玩紀錄的檔名用匯出時的本地時間', () => {
  expect(playlogName(new Date(2026, 10, 14, 21, 5))).toBe('fantasy-exploration-20261114-2105.json');
});
