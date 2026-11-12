import { describe, expect, test } from 'vitest';
import { cameraOrigin, layout } from './screen.js';

describe('畫面配置', () => {
  test.each([
    [1, 16, 2],
    [1.25, 16, 2],
    [1.5, 24, 3],
    [2, 32, 4],
  ])('縮放 %s 時地圖格 %s、文字 %s 倍', (dpr, tile, textScale) => {
    const s = layout(1280, 800, dpr);
    expect(s.tile).toBe(tile);
    expect(s.textScale).toBe(textScale);
  });

  test('地圖格永遠是 8 的倍數', () => {
    for (const dpr of [1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3]) {
      expect(layout(1000, 700, dpr).tile % 8).toBe(0);
    }
  });

  test('地圖區域不壓到狀態列', () => {
    const s = layout(1280, 800, 1);
    expect(s.rows * s.tile).toBeLessThanOrEqual(s.statusTop);
  });

  test('畫面跟著冒險者，但不捲出地圖', () => {
    expect(cameraOrigin(40, 25, 80, 50, 20, 10)).toEqual({ x: 30, y: 20 });
    expect(cameraOrigin(1, 1, 80, 50, 20, 10)).toEqual({ x: 0, y: 0 });
    expect(cameraOrigin(79, 49, 80, 50, 20, 10)).toEqual({ x: 60, y: 40 });
    expect(cameraOrigin(5, 5, 80, 50, 100, 60)).toEqual({ x: 0, y: 0 });
  });
});
