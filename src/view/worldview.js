// 畫地圖區（使用者挑定的樣子：往左下拉側面與影子、影子只調暗那一版）。
// - 亮度：生成時算好的亮度級數（陸地看高度層＋坡向明暗，水看深度）
// - 側面：光從右上照，比較高的地形往左下拉出 2～3 格的側面，用高處的字元、顏色調暗（extrude.js）
// - 影子：有高度的物件往左下投影子，影子只讓地面變暗；有物件的格子是被照亮的樹冠，不吃影子
// - 樹冠：多格的樹右上亮、左下暗
// 頂面都畫在原位，滑鼠點哪格就是哪格。網址加 ?flat 不畫側面與影子，留著對照用。
// 每格先畫地形層，有物件時把物件的字元疊在上面，背景仍用地面的。世界外畫深色。
// 路線、目標、查看中的格子疊在上面，最後畫冒險者

import { PART_DARK, PART_LIT, PART_MID } from '../world/footprint.js';
import { hash01 } from '../world/noise.js';
import { FLAT } from '../world/relief.js';
import { COLORS } from './colors.js';
import { inShadow, sideSource } from './extrude.js';
import { buildObjectShades, buildShadeTable, dimColor, rampGlyph } from './shades.js';

const SIDE_DIM = [0, 0.6, 0.5, 0.42]; // 側面離高處 1、2、3 格時的亮度
const SHADOW_DIM = 0.6; // 影子裡的亮度
const PART_FACTOR = { [PART_MID]: 1, [PART_LIT]: 1.25, [PART_DARK]: 0.65 }; // 樹冠各側的亮度

export function createWorldView(mapView, world, data, { extrude = true } = {}) {
  const { terrains, objects } = data;
  const shades = buildShadeTable(terrains); // { step, fg, bg }：[地形][明暗級數][立面]
  const objectFg = buildObjectShades(objects); // [物件][明暗級數][立面]

  // 一格地面的樣子（字元依亮度從這種地形的階梯選；同一亮度每格用雜湊換字）
  function groundLook(x, y) {
    const t = world.terrainAt(x, y);
    const level = world.shadeAt(x, y);
    const a = hash01(world.seed, x, y, 101);
    const b = hash01(world.seed, x, y, 102);
    return {
      glyph: rampGlyph(terrains[t].ramp, shades.step[t][level][FLAT], a, b),
      fg: shades.fg[t][level][FLAT],
      bg: shades.bg[t][level][FLAT],
      level,
    };
  }

  // 這一格最後的樣子：側面蓋住整格；不然畫地面（＋物件），落在影子裡就調暗
  function cellLook(x, y) {
    if (extrude) {
      const side = sideSource(world, x, y);
      if (side) {
        const src = groundLook(side.x, side.y);
        const f = SIDE_DIM[side.k];
        return { glyph: src.glyph, fg: dimColor(src.fg, f), bg: dimColor(src.bg, f) };
      }
    }
    const look = groundLook(x, y);
    const o = world.objectAt(x, y);
    if (o >= 0) {
      look.glyph = objects[o].glyph;
      look.fg = dimColor(objectFg[o][look.level][FLAT], PART_FACTOR[world.objectPartAt(x, y)]);
    } else if (extrude && inShadow(world, objects, x, y)) {
      look.fg = dimColor(look.fg, SHADOW_DIM);
      look.bg = dimColor(look.bg, SHADOW_DIM);
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
    // 視窗格 → 世界格（頂面都在原位，點哪格就是哪格）；世界外回傳 null
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
