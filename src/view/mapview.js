// 地圖區：用字元表蓋印章（tiles.js：每種顏色先染一份再整格複製），畫在主畫布的地圖矩形裡。
// 試過改用 ROT.js 的 Display，每走一步整張重畫要 0.27～0.96 秒（它每畫一格就重新染色），
// 這個做法只要 0.02～0.03 秒，所以換回來；介面照舊（draw、cellAt、resize）

import { createTileset } from './tiles.js';

export function createMapView(image, ctx) {
  const tiles = createTileset(image);
  let s = null; // 目前的畫面配置

  return {
    canvas: ctx.canvas,
    resize(screen) {
      s = screen;
    },
    // 在地圖區第 (vx, vy) 格畫一個字
    draw(vx, vy, ch, fg, bg) {
      tiles.draw(ctx, ch, s.map.x + vx * s.tile, s.map.y + vy * s.tile, s.tile, fg, bg);
    },
    // 同上，但再錯開 (ox, oy) 個字元像素（一格 8 個；放大時跟著放大，點陣不糊）。bg 可省略，只畫字
    drawShifted(vx, vy, ox, oy, ch, fg, bg) {
      const k = s.tile / 8;
      tiles.draw(ctx, ch, s.map.x + vx * s.tile + ox * k, s.map.y + vy * s.tile + oy * k, s.tile, fg, bg);
    },
    // 滑鼠 → 地圖區第幾格；不在地圖區回傳 null
    cellAt(e) {
      const rect = ctx.canvas.getBoundingClientRect();
      const px = (e.clientX - rect.left) * s.dpr - s.map.x;
      const py = (e.clientY - rect.top) * s.dpr - s.map.y;
      if (px < 0 || py < 0 || px >= s.map.w || py >= s.map.h) return null;
      return { x: Math.floor(px / s.tile), y: Math.floor(py / s.tile) };
    },
  };
}
