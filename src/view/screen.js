// 畫面配置：格子大小用實體螢幕像素算，地圖格永遠是 8 的整數倍、文字永遠是 12 的整數倍，
// 不跟著 Windows 125%／150% 的縮放比例走，像素才不會糊。
// 版面：頂部一行狀態；下面左邊是地圖，右邊是訊息欄

const TILE_BASE = 8; // 字元表一格 8px
const TEXT_BASE = 12; // Fusion Pixel 的設計格 12px
const TILE_TARGET = 16; // 希望地圖格在畫面上大約多大（CSS px）
const TEXT_TARGET = 24; // 希望文字在畫面上大約多大（CSS px）
export const SIDE_CHARS = 20; // 右側訊息欄寬幾個全形字

// 在這個縮放比例下，基準大小要放大幾倍（至少 1 倍）
export function pixelScale(base, cssTarget, dpr) {
  return Math.max(1, Math.floor((cssTarget * dpr) / base));
}

// 地圖縮放（使用者要的縮放鍵）：在預設倍數上加減幾倍，最小 1 倍；文字欄不跟著變
export const MAP_ZOOM = { min: -3, max: 3 };

export function layout(cssWidth, cssHeight, dpr, zoom = 0) {
  const width = Math.floor(cssWidth * dpr);
  const height = Math.floor(cssHeight * dpr);
  const tile = TILE_BASE * Math.max(1, pixelScale(TILE_BASE, TILE_TARGET, dpr) + zoom);
  const textScale = pixelScale(TEXT_BASE, TEXT_TARGET, dpr);
  const pad = 4 * textScale;
  const lineHeight = (TEXT_BASE + 2) * textScale;
  const top = { x: 0, y: 0, w: width, h: lineHeight + pad };
  const sideW = Math.min(SIDE_CHARS * TEXT_BASE * textScale + pad * 2, Math.floor(width / 2));
  const cols = Math.max(1, Math.floor((width - sideW) / tile));
  const rows = Math.max(1, Math.floor((height - top.h) / tile));
  const map = { x: 0, y: top.h, w: cols * tile, h: rows * tile };
  const side = { x: map.w, y: top.h, w: width - map.w, h: height - top.h };
  return { dpr, width, height, tile, textScale, lineHeight, pad, cols, rows, top, map, side };
}

// 畫面跟著冒險者：盡量讓冒險者在中間，但不捲出地圖邊界
export function cameraOrigin(px, py, mapWidth, mapHeight, cols, rows) {
  const clamp = (v, max) => Math.max(0, Math.min(v, Math.max(0, max)));
  return {
    x: clamp(px - Math.floor(cols / 2), mapWidth - cols),
    y: clamp(py - Math.floor(rows / 2), mapHeight - rows),
  };
}
