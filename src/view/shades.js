// 每種地形的明暗色：字元色與背景色都依「明暗級數×台地立面」先算好（ROT.js Color），畫的時候直接查表。
// 背景也帶光，整格看得出亮暗，不只靠字元那幾個像素。
// 顏色有上限（地形數×明暗級數×4），字元表的染色快取（tiles.js 一種顏色一張，用到才染）不會無限長大

import { Color } from 'rot-js';
import { LEVELS, levelFactor } from '../world/hillshade.js';
import { FACE, FACE_FAR, FLAT, RIM } from '../world/relief.js';

const BG_DIM = 0.32; // 背景是地形色的幾成亮
const RELIEF_FACTOR = { [FLAT]: 1, [RIM]: 1.25, [FACE]: 0.42, [FACE_FAR]: 0.3 };
const RELIEFS = [FLAT, RIM, FACE, FACE_FAR];

function scale(rgb, f) {
  return Color.toHex(rgb.map((c) => Math.max(0, Math.min(255, Math.round(c * f)))));
}

// 回傳 { fg, bg }，各是 [地形編號][明暗級數][立面] → '#rrggbb'。
// 不套明暗的地形（水面）每一級、每種立面都一樣
export function buildShadeTable(terrains) {
  const fg = [];
  const bg = [];
  for (const t of terrains) {
    const base = Color.fromString(t.color);
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
