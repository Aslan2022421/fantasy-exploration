// 每種地形與物件在畫面上的顏色：字元色、背景色都依「明暗級數×台地立面」先算好，畫的時候直接查表。
// 顏色代表材質；亮暗輔助表現高低、深淺（使用者定）。字形另外由 glyphs.js 決定。
// 背景也帶光，整格看得出亮暗。
// 顏色有上限（地形數×明暗級數×4），字元表的染色快取（tiles.js 一種顏色一張，用到才染）不會無限長大

import { Color } from 'rot-js';
import { LEVELS, levelFactor } from '../world/hillshade.js';
import { FACE, FACE_FAR, FLAT, RIM } from '../world/relief.js';

const BG_DIM = 0.32; // 背景是地形色的幾成亮（使用者挑定的那一版）
const RELIEF_FACTOR = { [FLAT]: 1, [RIM]: 1.25, [FACE]: 0.42, [FACE_FAR]: 0.3 };
const RELIEFS = [FLAT, RIM, FACE, FACE_FAR];
// 彩度只留幾成：地形種類仍靠色相分辨，但畫面上最強的差異是亮暗（高低）
export const SATURATION = 0.55;

function scale(rgb, f) {
  return Color.toHex(rgb.map((c) => Math.max(0, Math.min(255, Math.round(c * f)))));
}

// 把畫面上的顏色再調暗（側面、影子用）。結果快取起來，種類有上限，字元表的染色快取不會無限長大
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

// 兩個顏色混合：f 是 b 佔幾成
export function mixColor(a, b, f) {
  return Color.toHex(Color.interpolate(Color.fromString(a), Color.fromString(b), f));
}

// 往同亮度的灰色拉，彩度剩 SATURATION
export function desaturate(rgb) {
  const gray = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
  return rgb.map((c) => gray + (c - gray) * SATURATION);
}

// 回傳 { fg, bg }，各是 [地形編號][明暗級數][立面]。不套明暗的地形每一級都一樣
export function buildShadeTable(terrains) {
  const fg = [];
  const bg = [];
  for (const t of terrains) {
    const base = desaturate(Color.fromString(t.color));
    const f = [];
    const b = [];
    for (let level = 0; level < LEVELS; level++) {
      const fr = [];
      const br = [];
      for (const r of RELIEFS) {
        const k = t.shade ? levelFactor(level) * RELIEF_FACTOR[r] : 1;
        fr[r] = scale(base, k);
        br[r] = scale(base, BG_DIM * k);
      }
      f.push(fr);
      b.push(br);
    }
    fg.push(f);
    bg.push(b);
  }
  return { fg, bg };
}

// 物件層的字元色：[物件編號][明暗級數][立面]。物件跟它腳下的地面受同一道光，
// 背景用地面的，所以樹底下仍看得到地面的光照
export function buildObjectShades(objects) {
  return objects.map((o) => {
    const base = desaturate(Color.fromString(o.color));
    return Array.from({ length: LEVELS }, (_, level) => {
      const row = [];
      for (const r of RELIEFS) row[r] = scale(base, levelFactor(level) * RELIEF_FACTOR[r]);
      return row;
    });
  });
}
