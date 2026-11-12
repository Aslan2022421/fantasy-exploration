// 畫面配置：格子大小用實體螢幕像素算，地圖格永遠是 8 的整數倍、文字永遠是 12 的整數倍，
// 不跟著 Windows 125%／150% 的縮放比例走，像素才不會糊

const TILE_BASE = 8; // 字元表一格 8px
const TEXT_BASE = 12; // Fusion Pixel 的設計格 12px
const TILE_TARGET = 16; // 希望地圖格在畫面上大約多大（CSS px）
const TEXT_TARGET = 24; // 希望文字在畫面上大約多大（CSS px）
const STATUS_LINES = 2;

// 在這個縮放比例下，基準大小要放大幾倍（至少 1 倍）
export function pixelScale(base, cssTarget, dpr) {
  return Math.max(1, Math.floor((cssTarget * dpr) / base));
}

export function layout(cssWidth, cssHeight, dpr) {
  const width = Math.floor(cssWidth * dpr);
  const height = Math.floor(cssHeight * dpr);
  const tile = TILE_BASE * pixelScale(TILE_BASE, TILE_TARGET, dpr);
  const textScale = pixelScale(TEXT_BASE, TEXT_TARGET, dpr);
  const lineHeight = (TEXT_BASE + 2) * textScale;
  const statusHeight = STATUS_LINES * lineHeight + 4 * textScale; // 底部留白，最後一行才不會貼邊被切
  const cols = Math.max(1, Math.floor(width / tile));
  const rows = Math.max(1, Math.floor((height - statusHeight) / tile));
  return { dpr, width, height, tile, textScale, lineHeight, cols, rows, statusTop: height - statusHeight };
}

// 畫面跟著冒險者：盡量讓冒險者在中間，但不捲出地圖邊界
export function cameraOrigin(px, py, mapWidth, mapHeight, cols, rows) {
  const clamp = (v, max) => Math.max(0, Math.min(v, Math.max(0, max)));
  return {
    x: clamp(px - Math.floor(cols / 2), mapWidth - cols),
    y: clamp(py - Math.floor(rows / 2), mapHeight - rows),
  };
}
