// 疊層的幾種東西各自要放哪幾層（stackview.js 收進分塊再照高度畫）：生物、礦坑、山峰剪影，以及共用的壓淡。
// put(h, item) 把一項放進高度 h 那一層；item 的 ground、lift、px 決定錯開多少（stackview.js 的 offsetOf）

import { fadeAt, UP } from './perspective.js';
import { mixColor } from './shades.js';

export const PEAK_LAYER = 1000; // 山峰剪影畫在所有地形與物件之後

const fadeCache = new Map();
// a 往 b 壓淡 f（0 不變、1 變成 b）
export function fade(a, b, f) {
  if (!f) return a;
  const key = `${a}|${b}|${f}`;
  let out = fadeCache.get(key);
  if (!out) {
    out = mixColor(a, b, f);
    fadeCache.set(key, out);
  }
  return out;
}

// 生物（一隻）：一個字放大成 cl.w×cl.h 格，從地面往上疊 height 層（每層往上 minePx，跟地形一樣），
// 下面幾層往地面底色壓淡，只畫字
export function putCreature(cl, x, h0, bg, put) {
  for (let i = 0; i < cl.height; i++) {
    const fg = fade(cl.fg, bg, fadeAt(cl.height - 1 - i));
    put(h0 + i, { x, glyph: cl.glyph, fg, bg: null, ground: h0, lift: i, px: UP.minePx, w: cl.w, h2: cl.h });
  }
}

// 礦坑的一格：圖樣那個字從地面疊 ol.layers 層（每層往上 UP.minePx），下面幾層往地面底色壓淡；空白格不疊
export function putMine(ol, x, h0, bg, put) {
  if (ol.glyph === ' ') return;
  for (let i = 0; i < ol.layers; i++) {
    const fg = fade(ol.fg, bg, fadeAt(ol.layers - 1 - i));
    put(h0 + i, { x, glyph: ol.glyph, fg, bg: null, ground: h0, lift: i, px: UP.minePx });
  }
}

// 山峰剪影：以山峰那格為底邊中央，往上 rows 列的三角形。頂點 ▲，兩條稜線 / \，西面 /、東面 \、中線 ^；
// 底色塗滿，畫在所有地形之後，同一層裡南邊的後畫，前面的山蓋住後面的
export function putPeak(pk, x, h0, put) {
  for (let r = 0; r < pk.rows; r++) {
    for (let dx = -r; dx <= r; dx++) {
      let glyph = dx < 0 ? '/' : dx > 0 ? '\\' : '^';
      let fg = dx < 0 ? pk.west : pk.east;
      if (r === 0) glyph = '▲';
      if (r === 0 || Math.abs(dx) === r) fg = pk.edge;
      put(PEAK_LAYER, { x: x + dx, glyph, fg, bg: pk.bg, ground: h0, rowsUp: pk.rows - 1 - r });
    }
  }
}
