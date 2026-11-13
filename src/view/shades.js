// 每種地形在畫面上的樣子：字元、字元色、背景色都依「明暗級數×台地立面」先算好，畫的時候直接查表。
// - 地面（ramp）：字元依亮度從密度階梯選，地面是同一種紋理，亮暗才讀得出是光照在表面上
//   （參考 ASCII 立方體的「依亮度選字元」，換成 CP437 的密度字元）
// - 東西（樹、水）：保留自己的字元，只調顏色
// - 斷崖（岩壁）：直紋字元畫成立面，見 cliffLook
// - 背景也帶光，整格看得出亮暗
// 顏色有上限（地形數×明暗級數×4），字元表的染色快取（tiles.js 一種顏色一張，用到才染）不會無限長大

import { Color } from 'rot-js';
import { LEVELS, levelFactor } from '../world/hillshade.js';
import { FACE, FACE_FAR, FLAT, RIM } from '../world/relief.js';

// 由暗到亮的密度階梯，剛好 8 級對上明暗 8 級；都是 CP437 字元表裡的字
export const RAMP = [' ', '·', '∙', ':', '░', '▒', '▓', '█'];

const BG_DIM = 0.32; // 背景是地形色的幾成亮
const RELIEF_FACTOR = { [FLAT]: 1, [RIM]: 1.25, [FACE]: 0.42, [FACE_FAR]: 0.3 };
const RELIEF_STEP = { [FLAT]: 0, [RIM]: 1, [FACE]: -3, [FACE_FAR]: -4 }; // 地面字元在階梯上往上或往下幾格
const RAMP_SHIFT = -2; // 整體往暗的那頭移：平地（第 5 級）落在 :，最亮的坡到 ▒，不會整片塗滿
const RELIEFS = [FLAT, RIM, FACE, FACE_FAR];

function scale(rgb, f) {
  return Color.toHex(rgb.map((c) => Math.max(0, Math.min(255, Math.round(c * f)))));
}

// 斷崖：直紋字元一欄一欄交錯，看起來是直立的岩面；最上面一行用台地邊緣的亮度當崖頂，其餘用立面的暗度
export const CLIFF_GLYPHS = ['║', '│'];

export function cliffLook(shades, t, level, x, isTop) {
  const r = isTop ? RIM : FACE;
  return { glyph: CLIFF_GLYPHS[x & 1], fg: shades.fg[t][level][r], bg: shades.bg[t][level][r] };
}

// 地面在這個明暗級數與立面下用哪個字元
export function rampGlyph(level, relief) {
  return RAMP[Math.max(0, Math.min(RAMP.length - 1, level + RAMP_SHIFT + RELIEF_STEP[relief]))];
}

// 回傳 { glyph, fg, bg }，各是 [地形編號][明暗級數][立面]。
// 不套明暗的地形（水面）每一級、每種立面都一樣
export function buildShadeTable(terrains) {
  const glyph = [];
  const fg = [];
  const bg = [];
  for (const t of terrains) {
    const base = Color.fromString(t.color);
    const g = [];
    const f = [];
    const b = [];
    for (let level = 0; level < LEVELS; level++) {
      const gr = [];
      const fr = [];
      const br = [];
      for (const r of RELIEFS) {
        const k = t.shade ? levelFactor(level) * RELIEF_FACTOR[r] : 1;
        gr[r] = t.style === 'ramp' ? rampGlyph(level, r) : t.glyph;
        fr[r] = scale(base, k);
        br[r] = scale(base, BG_DIM * k);
      }
      g.push(gr);
      f.push(fr);
      b.push(br);
    }
    glyph.push(g);
    fg.push(f);
    bg.push(b);
  }
  return { glyph, fg, bg };
}

// 物件層的字元色：[物件編號][明暗級數][立面]。物件跟它腳下的地面受同一道光，
// 背景用地面的，所以樹底下仍看得到地面的光照
export function buildObjectShades(objects) {
  return objects.map((o) => {
    const base = Color.fromString(o.color);
    return Array.from({ length: LEVELS }, (_, level) => {
      const row = [];
      for (const r of RELIEFS) row[r] = scale(base, levelFactor(level) * RELIEF_FACTOR[r]);
      return row;
    });
  });
}
