// 畫面配置：固定 1920×1080 的畫布（使用者定；先試過 960×540），整張照整數倍放大到視窗裝得下的最大，置中、四周補黑邊；
// 視窗比畫布小時整張縮小塞進去。1080p 剛好 1 倍、4K 剛好 2 倍。
// 格子預設 24 像素＝8×8 字元表放大 3 倍（使用者定），介面字 24 像素（Fusion Pixel 12 像素放大 2 倍）。
// 版面：頂部 24 像素狀態列；下面左邊是地圖區 1568×1056（每格 24 時約 65×44 格），右邊是 352 像素的訊息欄
// （階段 1 使用者定的版面：頂部狀態列、左邊地圖、右邊訊息欄）

export const CANVAS = { w: 1920, h: 1080 };
const CELL = 24; // 預設一格（畫布像素）
const TILE_BASE = 8; // 字元表一格 8 像素
const TEXT_BASE = 12; // Fusion Pixel 的設計格 12 像素
const TEXT = 2; // 介面字放大幾倍
const TOP = 24; // 頂部狀態列高
const SIDE = 352; // 右邊訊息欄寬
export const MAP_AREA = { w: CANVAS.w - SIDE, h: CANVAS.h - TOP };

// 地圖縮放（使用者要的縮放鍵）：一格是字元表的幾倍，預設 3 倍（24 像素），一次加減 8 像素（16、24、32、40）。
// 地圖區的大小固定，放大時看到的格數變少；文字欄不跟著變
export const MAP_ZOOM = { min: -1, max: 2 };

// 視窗（CSS 像素）與縮放比例 → 畫布放大幾倍（至少 1 倍）
export function canvasScale(cssWidth, cssHeight, dpr) {
  const w = Math.floor(cssWidth * dpr);
  const h = Math.floor(cssHeight * dpr);
  return Math.max(1, Math.floor(Math.min(w / CANVAS.w, h / CANVAS.h)));
}

export function layout(cssWidth, cssHeight, dpr, zoom = 0) {
  const k = canvasScale(cssWidth, cssHeight, dpr);
  const width = CANVAS.w * k;
  const height = CANVAS.h * k;
  const tile = TILE_BASE * k * Math.max(2, CELL / TILE_BASE + zoom);
  const textScale = TEXT * k;
  const pad = 4 * k;
  const lineHeight = (TEXT_BASE + 2) * textScale;
  const top = { x: 0, y: 0, w: width, h: TOP * k };
  const mapW = MAP_AREA.w * k;
  const mapH = MAP_AREA.h * k;
  const cols = Math.ceil(mapW / tile);
  const rows = Math.ceil(mapH / tile);
  const map = { x: 0, y: top.h, w: mapW, h: mapH };
  const side = { x: mapW, y: top.h, w: width - mapW, h: height - top.h };
  return { dpr, scale: k, width, height, tile, textScale, lineHeight, pad, cols, rows, top, map, side };
}

// 給 G 鍵顯示：地圖區看得到幾×幾整格、一格是畫布的幾像素
export function gridLabel(s) {
  const full = (len) => Math.floor(len / s.tile);
  return `可視 ${full(s.map.w)}×${full(s.map.h)} 格、每格 ${s.tile / s.scale} 像素`;
}

// 畫布在網頁上的大小（CSS 像素）：通常就是實體像素除以縮放比例；
// 視窗比 960×540 還小時，整張縮小塞進去（這時不是整數倍，會有點糊）
export function cssSize(s, cssWidth, cssHeight) {
  const w = s.width / s.dpr;
  const h = s.height / s.dpr;
  const fit = Math.min(1, cssWidth / w, cssHeight / h);
  return { w: w * fit, h: h * fit };
}

// 畫面跟著冒險者：盡量讓冒險者在中間，但不捲出地圖邊界
export function cameraOrigin(px, py, mapWidth, mapHeight, cols, rows) {
  const clamp = (v, max) => Math.max(0, Math.min(v, Math.max(0, max)));
  return {
    x: clamp(px - Math.floor(cols / 2), mapWidth - cols),
    y: clamp(py - Math.floor(rows / 2), mapHeight - rows),
  };
}
