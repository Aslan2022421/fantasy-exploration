// 路線：從冒險者連到每一步中心的虛線，跟著地面高度錯開，越高越亮。
// 每一點的高度取前後幾格的平均：爬坡時線慢慢升上去，從高山下來時落差攤成一段長斜坡，不會在岩壁那裡突然折下去
// （代價是線跟格子差幾個像素）

import { COLORS } from './colors.js';
import { groundHeight } from './perspective.js';
import { dimColor } from './shades.js';

// 亮度隨高度、線寬、虛線的 [畫, 空]（字元像素）、高度取前後幾格平均
export const PATH_LIGHT = { base: 0.75, perLayer: 0.025, max: 1.2, width: 1.5, dash: [3, 3], smooth: 5 };

// placeOf(x, y, h)：世界格 (x, y) 在高度 h 時畫在地圖區哪裡（字元像素，左上角）
export function drawRoute(mapView, world, placeOf, route, player) {
  if (!route?.steps.length) return;
  const cells = [player, ...route.steps];
  const raw = cells.map((c) => groundHeight(world.tierAt(c.x, c.y)));
  const r = PATH_LIGHT.smooth;
  const pts = cells.map((c, i) => {
    const near = raw.slice(Math.max(0, i - r), i + r + 1);
    const h = near.reduce((a, v) => a + v, 0) / near.length;
    const { px, py } = placeOf(c.x, c.y, h);
    return { x: px + 4, y: py + 4, h };
  });
  let walked = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const k = Math.min(PATH_LIGHT.max, PATH_LIGHT.base + PATH_LIGHT.perLayer * Math.max(a.h, b.h));
    mapView.line(a.x, a.y, b.x, b.y, dimColor(COLORS.path, k), PATH_LIGHT.width, PATH_LIGHT.dash, walked);
    walked += Math.hypot(b.x - a.x, b.y - a.y);
  }
}
