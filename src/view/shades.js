// 每種地形的明暗色：先把 8 級亮度的顏色算好（ROT.js Color），畫的時候直接查表。
// 顏色固定只有「地形數×8」種，字元表的染色快取（tiles.js 一種顏色一張）不會無限長大

import { Color } from 'rot-js';
import { LEVELS, levelFactor } from '../world/hillshade.js';

// 回傳 table[地形編號][明暗級數] → '#rrggbb'；不套明暗的地形（水面）每一級都用原色
export function buildShadeTable(terrains) {
  return terrains.map((t) => {
    const base = Color.fromString(t.color);
    return Array.from({ length: LEVELS }, (_, level) => {
      if (!t.shade) return t.color;
      const f = levelFactor(level);
      return Color.toHex(base.map((c) => Math.max(0, Math.min(255, Math.round(c * f)))));
    });
  });
}
