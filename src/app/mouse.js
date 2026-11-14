// 地圖上的滑鼠：
// - 懸停：在那格旁邊顯示一個小提示框，寫那裡是什麼
// - 右鍵：查看那一格兼選定成目標，訊息欄寫出查看結果，地圖上畫出走過去的路線；再按同一格收起
// - 左鍵：走過去。不管有沒有畫出路線、查看有沒有開著，都直接走
// 這裡只接事件、換算成地圖格，要做什麼由 main.js 給的 handlers 決定

import { COLORS } from '../view/colors.js';

// handlers：{ cellAt(e) → 地圖格或 null, hover(cell), leave(), look(cell), go(cell) }
export function bindMapMouse(canvas, handlers) {
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const cell = handlers.cellAt(e);
    if (cell) handlers.look(cell);
  });
  canvas.addEventListener('mousemove', (e) => handlers.hover(handlers.cellAt(e)));
  canvas.addEventListener('mouseleave', () => handlers.leave());
  canvas.addEventListener('click', (e) => {
    const cell = handlers.cellAt(e);
    if (cell) handlers.go(cell);
  });
}

// 懸停提示的文字：查看結果的第一句（例如「細草，泥土，平原」）
export function tooltipText(description) {
  return description.split('。')[0];
}

// 地圖上的小標籤：路線終點的「幾步／走不到」，以及懸停那格旁邊的提示框（tip：{ cell, text } 或 null）
export function drawMapLabels({ ctx, screen, panels, worldView, cam, route, target, tip }) {
  const place = (c) => {
    const at = worldView.screenOf(cam, c.x, c.y);
    return { px: screen.map.x + at.vx * screen.tile, py: screen.map.y + at.vy * screen.tile };
  };
  const same = tip && target && tip.cell.x === target.x && tip.cell.y === target.y;
  if (route && target) {
    const { px, py } = place(target);
    let label = !route.reachable ? '走不到' : route.steps.length ? `${route.steps.length} 步` : '就在旁邊';
    if (same) label += `｜${tooltipText(tip.text)}`; // 懸停的正是終點：合成一個框，不疊在一起
    panels.routeLabel(ctx, screen, px, py, label, route.reachable ? COLORS.path : COLORS.text);
  }
  if (tip && !(same && route)) {
    const { px, py } = place(tip.cell);
    panels.routeLabel(ctx, screen, px, py, tooltipText(tip.text), COLORS.text);
  }
}
