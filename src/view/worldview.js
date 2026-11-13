// 畫地圖區。亮度只看絕對高度（elevation.js）：高的永遠亮、低的永遠暗，跟冒險者站在哪一層無關；
// 層界的高側畫一排亮的崖邊、低側緊貼一條暗帶。水看深度，越深越暗；湖岸是比水高的崖邊。
// 網址加 ?flat 不畫崖邊與暗帶，留著對照用。
// 每格先畫地形層，有物件時把物件的字元疊在上面，背景仍用地面的。世界外畫深色。
// 路線、目標、查看中的格子疊在上面，最後畫冒險者

import { hash01 } from '../world/noise.js';
import { FLAT } from '../world/relief.js';
import { COLORS } from './colors.js';
import { EDGE_RIM, EDGE_SHADOW, edgeAt, tierLevel } from './elevation.js';
import { buildObjectShades, buildShadeTable, dimColor, rampGlyph } from './shades.js';

export const RIM_GLYPH = '#'; // 崖邊（照參考圖的一排 #）
const RIM_UP = 1; // 崖邊比所在那層亮幾級
const SHADOW_DIM = 0.45; // 崖下暗帶的亮度

export function createWorldView(mapView, world, data, { edges = true } = {}) {
  const { terrains, objects } = data;
  const shades = buildShadeTable(terrains); // { step, fg, bg }：[地形][明暗級數][立面]
  const objectFg = buildObjectShades(objects); // [物件][明暗級數][立面]
  const isWater = terrains.map((t) => t.id.endsWith('water'));

  function cellLook(x, y) {
    const t = world.terrainAt(x, y);
    // 水看深度（生成時算好的亮度級數）；陸地只看高度層
    const level = isWater[t] ? world.shadeAt(x, y) : tierLevel(world.tierAt(x, y));
    const edge = edges ? edgeAt(world, x, y) : 0;
    const a = hash01(world.seed, x, y, 101);
    const b = hash01(world.seed, x, y, 102);
    const look = {
      glyph: rampGlyph(terrains[t].ramp, shades.step[t][level][FLAT], a, b),
      fg: shades.fg[t][level][FLAT],
      bg: shades.bg[t][level][FLAT],
    };
    if (edge === EDGE_RIM) {
      const up = Math.min(7, level + RIM_UP);
      look.glyph = RIM_GLYPH;
      look.fg = shades.fg[t][up][FLAT];
    } else if (edge === EDGE_SHADOW) {
      look.fg = dimColor(look.fg, SHADOW_DIM);
      look.bg = dimColor(look.bg, SHADOW_DIM);
    }
    const o = world.objectAt(x, y);
    if (o >= 0) {
      look.glyph = objects[o].glyph;
      look.fg = objectFg[o][level][FLAT];
      if (edge === EDGE_SHADOW) look.fg = dimColor(look.fg, SHADOW_DIM);
    }
    return look;
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
        const look = cellLook(x, y);
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
