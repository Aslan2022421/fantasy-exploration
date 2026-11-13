// 每種地形在畫面上的樣子：字元階梯的哪一階、字元色、背景色都依「明暗級數×台地立面」先算好，畫的時候直接查表。
// - 字元：每種地形有自己的階梯（data/terrain 的 ramp，由暗到亮），依亮度選一階，
//   參考 ASCII 立方體「依亮度選字元」的做法。同一階可以有幾個字，畫的時候每格用雜湊挑一個，
//   再隨機往上或往下偏一階，同一亮度的地面不會排成規律的網點（rampGlyph）
// - 背景也帶光，整格看得出亮暗
// 顏色有上限（地形數×明暗級數×4），字元表的染色快取（tiles.js 一種顏色一張，用到才染）不會無限長大

import { Color } from 'rot-js';
import { LEVELS, levelFactor } from '../world/hillshade.js';
import { FACE, FACE_FAR, FLAT, RIM } from '../world/relief.js';

const BG_DIM = 0.32; // 背景是地形色的幾成亮（使用者挑定的那一版）
const RELIEF_FACTOR = { [FLAT]: 1, [RIM]: 1.25, [FACE]: 0.42, [FACE_FAR]: 0.3 };
const RELIEF_STEP = { [FLAT]: 0, [RIM]: 1, [FACE]: -3, [FACE_FAR]: -4 }; // 在階梯上往上或往下幾階
const RAMP_SHIFT = -2; // 亮度第 2 級對到階梯第 0 階（空白），第 7 級對到最密的那階
const JITTER = 0.2; // 每格有兩成機率往暗偏一階、兩成往亮偏一階（使用者挑定的那一版）
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

// 這個明暗級數與立面落在長度 len 的階梯第幾階（0 最暗）
export function rampStep(len, level, relief) {
  const base = level + RAMP_SHIFT + RELIEF_STEP[relief];
  return Math.max(0, Math.min(len - 1, Math.round((base * (len - 1)) / 5)));
}

// 實際畫的字：step 是 rampStep 的結果；a、b 是這格的兩個雜湊值（0～1），
// a 決定偏不偏一階，b 決定同一階裡挑哪個字
export function rampGlyph(ramp, step, a, b) {
  let s = step;
  if (a < JITTER) s -= 1;
  else if (a > 1 - JITTER) s += 1;
  const chars = [...ramp[Math.max(0, Math.min(ramp.length - 1, s))]];
  return chars[Math.floor(b * chars.length)];
}

// 回傳 { step, fg, bg }，各是 [地形編號][明暗級數][立面]；step 是字元階梯的第幾階。
// 不套明暗的地形（水面）顏色每一級都一樣，字元仍依明暗選階
export function buildShadeTable(terrains) {
  const step = [];
  const fg = [];
  const bg = [];
  for (const t of terrains) {
    const base = desaturate(Color.fromString(t.color));
    const s = [];
    const f = [];
    const b = [];
    for (let level = 0; level < LEVELS; level++) {
      const sr = [];
      const fr = [];
      const br = [];
      for (const r of RELIEFS) {
        const k = t.shade ? levelFactor(level) * RELIEF_FACTOR[r] : 1;
        sr[r] = rampStep(t.ramp.length, level, r);
        fr[r] = scale(base, k);
        br[r] = scale(base, BG_DIM * k);
      }
      s.push(sr);
      f.push(fr);
      b.push(br);
    }
    step.push(s);
    fg.push(f);
    bg.push(b);
  }
  return { step, fg, bg };
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
