// 地圖區：用字元表蓋印章（tiles.js：每種顏色先染一份再整格複製），畫在主畫布的地圖矩形裡

import { createTileset } from './tiles.js';

export function createMapView(image, ctx) {
  const tiles = createTileset(image);
  let s = null; // 目前的畫面配置

  return {
    canvas: ctx.canvas,
    resize(screen) {
      s = screen;
    },
    // 在地圖區第 (vx, vy) 格、再錯開 (ox, oy) 個字元像素（一格 8 個）畫一個字。bg 可省略，只畫字
    // 背景四邊各多塗 1 個字元像素：相鄰兩格錯開量四捨五入不同時，中間才不會露出細縫
    drawShifted(vx, vy, ox, oy, ch, fg, bg) {
      const k = s.tile / 8;
      const px = Math.round(s.map.x + vx * s.tile + ox * k); // 錯開量可以是小數，落到整數像素才不會糊
      const py = Math.round(s.map.y + vy * s.tile + oy * k);
      if (bg) {
        ctx.fillStyle = bg;
        ctx.fillRect(px - k, py - k, s.tile + 2 * k, s.tile + 2 * k);
      }
      tiles.draw(ctx, ch, px, py, s.tile, fg, null);
    },
    // 離屏圖層：寬 w、高 h 格的小畫布，畫法跟 drawShifted 一樣（座標從圖層左上角算），
    // 畫好之後用 blit 整張貼上來。格子大小（tile）變了圖層就不能用，呼叫的人看 layer.tile 自己丟掉
    layer(w, h) {
      const tile = s.tile;
      const k = tile / 8;
      const canvas = document.createElement('canvas');
      canvas.width = w * tile;
      canvas.height = h * tile;
      const g = canvas.getContext('2d');
      g.imageSmoothingEnabled = false;
      return {
        canvas,
        tile,
        drawShifted(vx, vy, ox, oy, ch, fg, bg) {
          const px = Math.round(vx * tile + ox * k);
          const py = Math.round(vy * tile + oy * k);
          if (bg) {
            g.fillStyle = bg;
            g.fillRect(px - k, py - k, tile + 2 * k, tile + 2 * k);
          }
          tiles.draw(g, ch, px, py, tile, fg, null);
        },
      };
    },
    // 把圖層貼到地圖區，左上角在 (gx, gy) 字元像素（可以是小數，落到整數像素）
    blit(layer, gx, gy) {
      const k = s.tile / 8;
      ctx.drawImage(layer.canvas, Math.round(s.map.x + gx * k), Math.round(s.map.y + gy * k));
    },
    tile: () => s.tile,
    // 畫一條線段：兩端是地圖區的字元像素，寬 width 個字元像素。
    // dash 是虛線的 [畫, 空]（字元像素），offset 是這段從虛線花紋的哪裡開始（接續上一段，花紋才連得起來）
    line(x1, y1, x2, y2, color, width, dash = null, offset = 0) {
      const k = s.tile / 8;
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1, Math.round(width * k));
      ctx.lineCap = 'butt';
      if (dash) {
        ctx.setLineDash(dash.map((d) => d * k));
        ctx.lineDashOffset = offset * k;
      }
      ctx.beginPath();
      ctx.moveTo(s.map.x + x1 * k, s.map.y + y1 * k);
      ctx.lineTo(s.map.x + x2 * k, s.map.y + y2 * k);
      ctx.stroke();
      ctx.restore();
    },
    // 整個地圖區塗成一個顏色
    fill(color) {
      ctx.fillStyle = color;
      ctx.fillRect(s.map.x, s.map.y, s.map.w, s.map.h);
    },
    // 在 fn 裡畫的東西只留在地圖區內（錯開的字不會畫到旁邊的訊息欄）
    clipped(fn) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(s.map.x, s.map.y, s.map.w, s.map.h);
      ctx.clip();
      try {
        fn();
      } finally {
        ctx.restore();
      }
    },
    // 滑鼠 → 地圖區第幾格；不在地圖區回傳 null
    cellAt(e) {
      const rect = ctx.canvas.getBoundingClientRect();
      const ratio = ctx.canvas.width / rect.width; // 畫面上一個 CSS 像素是畫布的幾個像素（置中、縮小都算進去）
      const px = (e.clientX - rect.left) * ratio - s.map.x;
      const py = (e.clientY - rect.top) * ratio - s.map.y;
      if (px < 0 || py < 0 || px >= s.map.w || py >= s.map.h) return null;
      // fx、fy：滑鼠在地圖區的位置，以字元像素計（一格 8 個），錯開的疊層要用它找點到哪格
      const k = s.tile / 8;
      return { x: Math.floor(px / s.tile), y: Math.floor(py / s.tile), fx: px / k, fy: py / k };
    },
  };
}
