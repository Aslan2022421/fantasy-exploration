// 畫地圖區：視窗裡的每一格照地形畫字元，顏色依明暗級數；世界外畫深色。
// 路線、目標、查看中的格子疊在上面，最後畫冒險者

import { COLORS } from './colors.js';
import { buildShadeTable } from './shades.js';

export function createWorldView(mapView, world, terrains) {
  const shades = buildShadeTable(terrains); // { glyph, fg, bg }：[地形][明暗級數][立面]

  // overlay：{ route: {steps, reachable} | null, target, examined, player }
  function draw(screen, cam, { route, target, examined, player }) {
    const onRoute = new Set(route?.steps.map((s) => `${s.x},${s.y}`));
    for (let vy = 0; vy < screen.rows; vy++) {
      for (let vx = 0; vx < screen.cols; vx++) {
        const x = cam.x + vx;
        const y = cam.y + vy;
        if (!world.inside(x, y)) {
          mapView.draw(vx, vy, ' ', COLORS.bg, COLORS.void);
          continue;
        }
        const t = world.terrainAt(x, y);
        const level = world.shadeAt(x, y);
        const relief = world.reliefAt(x, y);
        const isTarget = target?.x === x && target?.y === y;
        let bg = shades.bg[t][level][relief];
        if (examined?.x === x && examined?.y === y) bg = COLORS.examined;
        if (isTarget) bg = route?.reachable ? COLORS.target : COLORS.blocked;
        if (onRoute.has(`${x},${y}`) && !isTarget) {
          mapView.draw(vx, vy, '•', COLORS.path, bg);
          continue;
        }
        mapView.draw(vx, vy, shades.glyph[t][level][relief], shades.fg[t][level][relief], bg);
      }
    }
    mapView.draw(player.x - cam.x, player.y - cam.y, '@', COLORS.player, COLORS.bg);
  }

  return { draw };
}
