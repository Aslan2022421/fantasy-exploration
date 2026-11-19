import { describe, expect, test } from 'vitest';
import { playlogName } from '../app/playlog.js';
import { DATA } from '../data/load.js';
import { LAND } from '../world/landform.js';
import { createWorld } from '../world/world.js';
import { elevAt, landMask } from './worldmap.js';

describe('世界總覽', () => {
  const w = createWorld(7, DATA, { zonesX: 3, zonesY: 3 });
  const geo = w.geography;

  test('高度照粗格雙線性內插：粗格中心就是那格的高度', () => {
    expect(elevAt(geo, 5.5, 7.5)).toBeCloseTo(geo.elev[7 * geo.W + 5]);
  });

  test('陸地遮罩與海岸距離：海岸兩邊距離是 0，往裡、往外越來越遠', () => {
    const size = 64;
    const { land, dist } = landMask(geo, size);
    const anyLand = land.some((v) => v === 1);
    const anySea = land.some((v) => v === 0);
    if (anyLand && anySea) expect(Math.min(...dist)).toBe(0);
    // 陸地格的高度在水線以上
    const i = land.indexOf(1);
    if (i >= 0) {
      const px = i % size;
      const py = (i - px) / size;
      expect(elevAt(geo, ((px + 0.5) * geo.W) / size, ((py + 0.5) * geo.H) / size)).toBeGreaterThanOrEqual(LAND.water);
    }
  });
});

test('試玩紀錄的檔名用匯出時的本地時間', () => {
  expect(playlogName(new Date(2026, 10, 14, 21, 5))).toBe('fantasy-exploration-20261114-2105.json');
});
