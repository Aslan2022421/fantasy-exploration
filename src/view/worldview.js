// 畫地圖區。照矮人要塞的看法分 Z 高度（zlevel.js）：以冒險者所在的高度層為準，
// 同一層正常、低一層變暗變疏、再低的最暗；高一層以上是一面實心的牆。
// 網址加 ?flat 改用絕對高度的亮度（不看冒險者在哪層），留著對照用。
// 每格先畫地形層，有物件時把物件的字元疊在上面，背景仍用地面的。世界外畫深色。
// 路線、目標、查看中的格子疊在上面，最後畫冒險者

import { hash01 } from '../world/noise.js';
import { FLAT } from '../world/relief.js';
import { COLORS } from './colors.js';
import { buildObjectShades, buildShadeTable, dimColor, rampGlyph } from './shades.js';
import { ABOVE, SAME, Z_LEVEL, zClass } from './zlevel.js';

export const WALL_GLYPH = '█';
const WALL_FG = 0.55; // 牆用地形色的幾成亮
const WALL_BG = 0.35;

export function createWorldView(mapView, world, data, { zlevels = true } = {}) {
  const { terrains, objects } = data;
  const shades = buildShadeTable(terrains); // { step, fg, bg }：[地形][明暗級數][立面]
  const objectFg = buildObjectShades(objects); // [物件][明暗級數][立面]
  const wallColor = terrains.map((_, i) => shades.fg[i][Z_LEVEL[SAME]][FLAT]); // 牆的基準色：該地形在同一層的亮度

  // 一格在亮度 level 下的樣子（字元依亮度從這種地形的階梯選；同一亮度每格用雜湊換字），有物件就疊上去
  function lookAt(x, y, level) {
    const t = world.terrainAt(x, y);
    const a = hash01(world.seed, x, y, 101);
    const b = hash01(world.seed, x, y, 102);
    const look = {
      glyph: rampGlyph(terrains[t].ramp, shades.step[t][level][FLAT], a, b),
      fg: shades.fg[t][level][FLAT],
      bg: shades.bg[t][level][FLAT],
    };
    const o = world.objectAt(x, y);
    if (o >= 0) {
      look.glyph = objects[o].glyph;
      look.fg = objectFg[o][level][FLAT];
    }
    return look;
  }

  function cellLook(x, y, playerTier) {
    if (!zlevels) return lookAt(x, y, world.shadeAt(x, y));
    const z = zClass(world.tierAt(x, y), playerTier);
    if (z === ABOVE) {
      const base = wallColor[world.terrainAt(x, y)];
      return { glyph: WALL_GLYPH, fg: dimColor(base, WALL_FG), bg: dimColor(base, WALL_BG) };
    }
    return lookAt(x, y, Z_LEVEL[z]);
  }

  // overlay：{ route: {steps, reachable} | null, target, examined, player }
  function draw(screen, cam, { route, target, examined, player }) {
    const onRoute = new Set(route?.steps.map((s) => `${s.x},${s.y}`));
    const playerTier = world.tierAt(player.x, player.y);
    for (let vy = 0; vy < screen.rows; vy++) {
      for (let vx = 0; vx < screen.cols; vx++) {
        const x = cam.x + vx;
        const y = cam.y + vy;
        if (!world.inside(x, y)) {
          mapView.draw(vx, vy, ' ', COLORS.bg, COLORS.void);
          continue;
        }
        const look = cellLook(x, y, playerTier);
        const isTarget = target?.x === x && target?.y === y;
        let bg = look.bg;
        if (examined?.x === x && examined?.y === y) bg = COLORS.examined;
        if (isTarget) bg = route?.reachable ? COLORS.target : COLORS.blocked;
        if (onRoute.has(`${x},${y}`) && !isTarget) mapView.draw(vx, vy, '•', COLORS.path, bg);
        else mapView.draw(vx, vy, look.glyph, look.fg, bg);
      }
    }
    mapView.draw(player.x - cam.x, player.y - cam.y, '@', COLORS.player, COLORS.bg);
  }

  return {
    draw,
    // 視窗格 → 世界格（點哪格就是哪格）；世界外回傳 null
    cellAt(cam, vx, vy) {
      const c = { x: cam.x + vx, y: cam.y + vy };
      return world.inside(c.x, c.y) ? c : null;
    },
    // 世界格 → 視窗格（路線標籤用）
    screenOf(cam, x, y) {
      return { vx: x - cam.x, vy: y - cam.y };
    },
  };
}
