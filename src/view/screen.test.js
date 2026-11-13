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

  test('地圖縮放：一次加減一倍，最小 1 倍，文字不跟著變', () => {
    expect(layout(1280, 800, 1, 1).tile).toBe(24);
    expect(layout(1280, 800, 1, -1).tile).toBe(8);
    expect(layout(1280, 800, 1, -3).tile).toBe(8);
    expect(layout(1280, 800, 1, 2).textScale).toBe(layout(1280, 800, 1).textScale);
  });

  test('頂部、地圖、訊息欄不重疊，也不超出畫面', () => {
    const s = layout(1280, 800, 1.25);
    expect(s.map.y).toBe(s.top.h);
    expect(s.side.x).toBe(s.map.w);
    expect(s.map.w + s.side.w).toBe(s.width);
    expect(s.map.y + s.map.h).toBeLessThanOrEqual(s.height);
    expect(s.side.w).toBeGreaterThan(0);
  });

  test('畫面很窄時訊息欄最多佔一半', () => {
    const s = layout(400, 600, 1);
    expect(s.side.w).toBeLessThan(200 + s.tile); // 地圖取整格後剩下的零頭也歸訊息欄
  });

  test('畫面跟著冒險者，但不捲出地圖', () => {
    expect(cameraOrigin(40, 25, 80, 50, 20, 10)).toEqual({ x: 30, y: 20 });
    expect(cameraOrigin(1, 1, 80, 50, 20, 10)).toEqual({ x: 0, y: 0 });
    expect(cameraOrigin(79, 49, 80, 50, 20, 10)).toEqual({ x: 60, y: 40 });
    expect(cameraOrigin(5, 5, 80, 50, 100, 60)).toEqual({ x: 0, y: 0 });
  });
});
