// 每種地形與物件在畫面上的顏色：字元色、背景色都依明暗級數先算好，畫的時候直接查表。
// 顏色代表材質，亮暗表現高低、深淺；字形另外由 glyphs.js 決定。
// 顏色種類有上限（地形數×明暗級數），字元表的染色快取（tiles.js 一種顏色一張，用到才染）不會無限長大

import { Color } from 'rot-js';
import { LEVELS, levelFactor } from '../world/hillshade.js';

const BG_DIM = 0.2; // 水的背景是地形色的幾成亮
// 陸地的背景只有少數幾種深色：地形色的 LAND_BG 成，明暗只分低、中、高三段，地形差異主要靠字的顏色
const LAND_BG = 0.13;
const landBand = (level) => (level <= 2 ? 0.85 : level <= 5 ? 1 : 1.15);
// 彩度只留幾成：地形種類靠色相分辨，畫面上最強的差異是亮暗
export const SATURATION = 0.55;

function scale(rgb, f) {
  return Color.toHex(rgb.map((c) => Math.max(0, Math.min(255, Math.round(c * f)))));
}

// 把顏色調暗 f 倍；結果快取起來
const dimCache = new Map();
export function dimColor(hex, f) {
  const key = `${hex}:${f}`;
  let out = dimCache.get(key);
  if (!out) {
    out = scale(Color.fromString(hex), f);
    dimCache.set(key, out);
  }
  return out;
}

// 陸地的底色（舊版的地圖配色）：不分材質，照高度層從暗到亮的青綠色階，底色越亮越高；地形差異靠字的顏色。
// 第 1～4 層照舊版的 map-h1～h4；山地再往上每圈往 LAND_TOP 靠一點（取到 0.1 一級，顏色種類不會太多）
export const LAND_RAMP = ['#081b1d', '#0b2426', '#0f2d30', '#143639', '#1a4044'];
const LAND_TOP = '#3a6466';
export function landBg(tier) {
  if (tier < LAND_RAMP.length) return LAND_RAMP[Math.max(0, tier)];
  const f = Math.min(1, Math.round(((tier - LAND_RAMP.length + 1) / 10) * 10) / 10);
  return mixColor(LAND_RAMP[LAND_RAMP.length - 1], LAND_TOP, f);
}

// 兩個顏色混合：f 是 b 佔幾成
export function mixColor(a, b, f) {
  return Color.toHex(Color.interpolate(Color.fromString(a), Color.fromString(b), f));
}

// 幾個顏色的平均
export function averageColor(hexes) {
  const sum = [0, 0, 0];
  for (const h of hexes) {
    const c = Color.fromString(h);
    for (let i = 0; i < 3; i++) sum[i] += c[i];
  }
  return Color.toHex(sum.map((v) => Math.round(v / hexes.length)));
}

// 往同亮度的灰色拉，彩度剩 SATURATION
export function desaturate(rgb) {
  const gray = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
  return rgb.map((c) => gray + (c - gray) * SATURATION);
}

// 回傳 { fg, bg }，各是 [地形編號][明暗級數]。不套明暗的地形每一級都一樣
export function buildShadeTable(terrains) {
  const fg = [];
  const bg = [];
  for (const t of terrains) {
    const base = desaturate(Color.fromString(t.color));
    const f = [];
    const b = [];
    for (let level = 0; level < LEVELS; level++) {
      const k = t.shade ? levelFactor(level) : 1;
      f.push(scale(base, k));
      // 資料寫了固定底色（聚落的空地、路、室內）就用它，只照高低分三段微調
      if (t.bg) b.push(scale(Color.fromString(t.bg), landBand(level)));
      else b.push(t.layer === 'water' ? scale(base, BG_DIM * k) : scale(base, LAND_BG * landBand(level)));
    }
    fg.push(f);
    bg.push(b);
  }
  return { fg, bg };
}

// 物件的字元色：[物件編號][明暗級數]。物件跟腳下的地面受同一道光
export function buildObjectShades(objects) {
  return objects.map((o) => {
    const base = desaturate(Color.fromString(o.color));
    return Array.from({ length: LEVELS }, (_, level) => scale(base, levelFactor(level)));
  });
}
