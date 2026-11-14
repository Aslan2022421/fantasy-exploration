import { describe, expect, test } from 'vitest';
import { CANVAS, canvasScale, cssSize, gridLabel, layout, MAP_AREA } from './screen.js';

describe('畫面配置：固定 1920×1080，整數倍放大', () => {
  test.each([
    [1920, 1080, 1, 1], // 1080p 剛好 1 倍
    [1920, 1080, 2, 2], // 4K 剛好 2 倍
    [1536, 864, 1.25, 1], // 125% 縮放的 1080p 筆電，全螢幕剛好 1 倍
    [960, 540, 1, 1], // 比畫布小也至少 1 倍（網頁上整張縮小）
  ])('視窗 %s×%s、縮放 %s 時放大 %s 倍', (w, h, dpr, k) => {
    expect(canvasScale(w, h, dpr)).toBe(k);
    const s = layout(w, h, dpr);
    expect(s.width).toBe(CANVAS.w * k);
    expect(s.height).toBe(CANVAS.h * k);
    expect(s.tile).toBe(24 * k); // 預設每格 24
    expect(s.textScale).toBe(2 * k); // 介面字 24 像素
  });

  test('版面：頂部 24、右邊訊息欄 352，地圖區 1568×1056；每格 24 時約 65×44 格', () => {
    const s = layout(1920, 1080, 1);
    expect(s.top.h).toBe(24);
    expect(s.side.w).toBe(352);
    expect(s.map).toMatchObject({ w: MAP_AREA.w, h: MAP_AREA.h });
    expect(s.top.h + s.map.h).toBe(s.height);
    expect(s.map.w + s.side.w).toBe(s.width);
  });

  test('地圖縮放：一格一次加減 8 像素（16、24、32、40），地圖區大小不變；文字不跟著變', () => {
    const tiles = [-1, 0, 1, 2].map((z) => layout(1920, 1080, 1, z).tile);
    expect(tiles).toEqual([16, 24, 32, 40]);
    expect(layout(1920, 1080, 1, -5).tile).toBe(16);
    expect(layout(1920, 1080, 1, 1).map).toEqual(layout(1920, 1080, 1).map);
    expect(layout(1920, 1080, 1, 1).textScale).toBe(layout(1920, 1080, 1).textScale);
  });

  test('G 鍵顯示的可視格數：整格數與每格畫布像素，放大倍數不影響', () => {
    expect(gridLabel(layout(1920, 1080, 1))).toBe('可視 65×44 格、每格 24 像素');
    expect(gridLabel(layout(1920, 1080, 2))).toBe('可視 65×44 格、每格 24 像素');
    expect(gridLabel(layout(1920, 1080, 1, -1))).toBe('可視 98×66 格、每格 16 像素');
  });

  test('網頁上的大小：放得下就照實體像素，視窗太小就整張縮小', () => {
    expect(cssSize(layout(1920, 1080, 1), 1920, 1080)).toEqual({ w: 1920, h: 1080 });
    expect(cssSize(layout(1536, 864, 1.25), 1536, 864)).toEqual({ w: 1536, h: 864 });
    expect(cssSize(layout(960, 540, 1), 960, 540)).toEqual({ w: 960, h: 540 });
  });
});
