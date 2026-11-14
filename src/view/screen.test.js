import { describe, expect, test } from 'vitest';
import { CANVAS, cameraOrigin, canvasScale, cssSize, layout, MAP_GRID } from './screen.js';

describe('畫面配置：固定 960×540，整數倍放大', () => {
  test.each([
    [960, 540, 1, 1],
    [1920, 1080, 1, 2], // 1080p 剛好 2 倍
    [1920, 1080, 2, 4], // 4K 剛好 4 倍
    [1280, 800, 1.25, 1], // 1600×1000 實體像素，放不下 2 倍
    [800, 600, 1, 1], // 比畫布小也至少 1 倍
  ])('視窗 %s×%s、縮放 %s 時放大 %s 倍', (w, h, dpr, k) => {
    expect(canvasScale(w, h, dpr)).toBe(k);
    const s = layout(w, h, dpr);
    expect(s.width).toBe(CANVAS.w * k);
    expect(s.height).toBe(CANVAS.h * k);
    expect(s.tile).toBe(16 * k);
    expect(s.textScale).toBe(k);
  });

  test('預設地圖區 49×33 格（兩邊奇數，冒險者在正中間），頂部 12 像素，其餘是訊息欄', () => {
    const s = layout(1920, 1080, 1);
    expect(s.cols).toBe(MAP_GRID.cols);
    expect(s.rows).toBe(MAP_GRID.rows);
    expect(s.top.h + s.map.h).toBe(s.height);
    expect(s.map.w + s.side.w).toBe(s.width);
    expect(s.side.w).toBe((960 - 49 * 16) * 2);
  });

  test('地圖縮放：一格一次加減 8 像素（畫布像素），地圖區大小不變，看到的格數跟著變；文字不跟著變', () => {
    const base = layout(960, 540, 1);
    const big = layout(960, 540, 1, 1);
    const small = layout(960, 540, 1, -1);
    expect(big.tile).toBe(24);
    expect(small.tile).toBe(8);
    expect(layout(960, 540, 1, -5).tile).toBe(8);
    expect(big.map).toEqual(base.map);
    expect(small.cols).toBeGreaterThan(base.cols);
    expect(big.textScale).toBe(base.textScale);
  });

  test('網頁上的大小：放得下就照實體像素，視窗太小就整張縮小', () => {
    expect(cssSize(layout(1920, 1080, 1), 1920, 1080)).toEqual({ w: 1920, h: 1080 });
    expect(cssSize(layout(1920, 1080, 2), 1920, 1080)).toEqual({ w: 1920, h: 1080 });
    expect(cssSize(layout(480, 540, 1), 480, 540)).toEqual({ w: 480, h: 270 });
  });

  test('畫面跟著冒險者，但不捲出地圖', () => {
    expect(cameraOrigin(40, 25, 80, 50, 20, 10)).toEqual({ x: 30, y: 20 });
    expect(cameraOrigin(1, 1, 80, 50, 20, 10)).toEqual({ x: 0, y: 0 });
    expect(cameraOrigin(79, 49, 80, 50, 20, 10)).toEqual({ x: 60, y: 40 });
    expect(cameraOrigin(5, 5, 80, 50, 100, 60)).toEqual({ x: 0, y: 0 });
  });
});
