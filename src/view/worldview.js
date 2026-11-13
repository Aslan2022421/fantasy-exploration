// 畫地圖區：先畫地形層（字元、顏色依明暗與台地立面），有物件時把物件的字元疊在上面，
// 背景仍用地面的，樹底下看得到地面的光照。世界外畫深色。
// 路線、目標、查看中的格子疊在上面，最後畫冒險者

import { COLORS } from './colors.js';
import { buildObjectShades, buildShadeTable, cliffLook } from './shades.js';

export function createWorldView(mapView, world, data) {
  const { terrains, objects } = data;
  const shades = buildShadeTable(terrains); // { glyph, fg, bg }：[地形][明暗級數][立面]
  const objectFg = buildObjectShades(objects); // [物件][明暗級數][立面]
  const cliff = terrains.map((t) => t.style === 'cliff');

  // 地形層這一格的樣子；斷崖的北邊那格不是斷崖，這格就是崖頂
  function terrainLook(x, y, t, level, relief) {
    if (cliff[t]) return cliffLook(shades, t, level, x, world.terrainAt(x, y - 1) !== t);
    return { glyph: shades.glyph[t][level][relief], fg: shades.fg[t][level][relief], bg: shades.bg[t][level][relief] };
  }

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
        const level = world.shadeAt(x, y);
        const relief = world.reliefAt(x, y);
        const look = terrainLook(x, y, world.terrainAt(x, y), level, relief);
        const o = world.objectAt(x, y);
        if (o >= 0) {
          look.glyph = objects[o].glyph;
          look.fg = objectFg[o][level][relief];
        }
        const isTarget = target?.x === x && target?.y === y;
        let bg = look.bg;
        if (examined?.x === x && examined?.y === y) bg = COLORS.examined;
        if (isTarget) bg = route?.reachable ? COLORS.target : COLORS.blocked;
        if (onRoute.has(`${x},${y}`) && !isTarget) {
          mapView.draw(vx, vy, '•', COLORS.path, bg);
          continue;
        }
        mapView.draw(vx, vy, look.glyph, look.fg, bg);
      }
    }
    mapView.draw(player.x - cam.x, player.y - cam.y, '@', COLORS.player, COLORS.bg);
  }

  return { draw };
}
