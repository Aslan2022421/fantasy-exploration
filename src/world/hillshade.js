// 地形明暗（hillshade）：看一格周圍 3×3 的高度算出坡度與坡向，再跟光的方向合成亮度。
// 做法照 GIS 的 Horn 法（ArcGIS〈How Hillshade works〉、GDAL hillshade），光從左上照下來
// （方位角 315°、高度角 45°）。結果量化成 LEVELS 級，畫面依級數調字元顏色的亮度

export const LEVELS = 8;
export const Z_FACTOR = 16; // 高度放大倍數：高度是 -1～1，不放大的話坡幾乎看不出來
const ZENITH = Math.PI / 4; // 90° − 高度角 45°
const AZIMUTH = ((360 - 315 + 90) % 360) * (Math.PI / 180); // 換成數學角度

// 坡度的兩個分量（Horn 法的加權差分）；h(dx, dy) 回傳鄰格高度
export function gradient(h) {
  const a = h(-1, -1);
  const b = h(0, -1);
  const c = h(1, -1);
  const d = h(-1, 0);
  const f = h(1, 0);
  const g = h(-1, 1);
  const i = h(0, 1);
  const k = h(1, 1);
  return {
    dx: (c + 2 * f + k - (a + 2 * d + g)) / 8,
    dy: (g + 2 * i + k - (a + 2 * b + c)) / 8,
  };
}

// 坡度分量 → 明暗級數 0（最暗）～LEVELS-1（最亮）；平地落在 5
export function shadeLevel(dx, dy) {
  const zx = dx * Z_FACTOR;
  const zy = dy * Z_FACTOR;
  const slope = Math.atan(Math.hypot(zx, zy));
  const aspect = Math.atan2(zy, -zx);
  const v = Math.cos(ZENITH) * Math.cos(slope) + Math.sin(ZENITH) * Math.sin(slope) * Math.cos(AZIMUTH - aspect);
  return Math.min(LEVELS - 1, Math.floor(Math.max(0, v) * LEVELS));
}

// 每一級的亮度倍率：最暗 0.55、最亮 1.15，平地（第 5 級）約 0.98
export function levelFactor(level) {
  return 0.55 + level * (0.6 / (LEVELS - 1));
}
