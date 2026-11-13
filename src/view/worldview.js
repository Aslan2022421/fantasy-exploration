// 畫地圖區。兩種畫法：
// - 斜投影（預設）：每格依高度層往上抬，抬起來空出的地方畫側面，由北往南畫，前面蓋住後面（oblique.js）
// - 俯視（網址加 ?flat）：每格畫在自己的位置，只靠亮度分高低，留著對照用
// 每格先畫地形層，有物件時把物件的字元疊在上面，背景仍用地面的。世界外畫深色。
// 路線、目標、查看中的格子畫在頂面上；冒險者最後畫，永遠看得到

import { hash01 } from '../world/noise.js';
import { FACE, FACE_FAR, FLAT } from '../world/relief.js';
import { COLORS } from './colors.js';
import { MAX_LIFT, pick, screenOf, topRow } from './oblique.js';
import { buildObjectShades, buildShadeTable, buildWallShades, rampGlyph } from './shades.js';

export function createWorldView(mapView, world, data, { oblique = true } = {}) {
  const { terrains, objects } = data;
  const shades = buildShadeTable(terrains); // { step, fg, bg }：[地形][明暗級數][立面]
  const objectFg = buildObjectShades(objects); // [物件][明暗級數][立面]
  const walls = buildWallShades(terrains); // [地形][側面第幾行]

  // 頂面這一格的樣子。斜投影時立面由真的側面表現，地面不再另外塗暗
  function topLook(x, y) {
    const t = world.terrainAt(x, y);
    const level = world.shadeAt(x, y);
    let relief = world.reliefAt(x, y);
    if (oblique && (relief === FACE || relief === FACE_FAR)) relief = FLAT;
    // 同一亮度的格子也不全用同一個字：每格兩個雜湊值決定偏不偏一階、同一階挑哪個字
    const a = hash01(world.seed, x, y, 101);
    const b = hash01(world.seed, x, y, 102);
    const look = {
      glyph: rampGlyph(terrains[t].ramp, shades.step[t][level][relief], a, b),
      fg: shades.fg[t][level][relief],
      bg: shades.bg[t][level][relief],
    };
    const o = world.objectAt(x, y);
    if (o >= 0) {
      look.glyph = objects[o].glyph;
      look.fg = objectFg[o][level][relief];
    }
    return look;
  }

  // overlay：{ route: {steps, reachable} | null, target, examined, player }
  function draw(screen, cam, { route, target, examined, player }) {
    const onRoute = new Set(route?.steps.map((s) => `${s.x},${s.y}`));
    const put = (vx, vy, glyph, fg, bg) => {
      if (vx >= 0 && vy >= 0 && vx < screen.cols && vy < screen.rows) mapView.draw(vx, vy, glyph, fg, bg);
    };

    function drawTop(x, y, vx, vy) {
      const look = topLook(x, y);
      const isTarget = target?.x === x && target?.y === y;
      let bg = look.bg;
      if (examined?.x === x && examined?.y === y) bg = COLORS.examined;
      if (isTarget) bg = route?.reachable ? COLORS.target : COLORS.blocked;
      if (onRoute.has(`${x},${y}`) && !isTarget) put(vx, vy, '•', COLORS.path, bg);
      else put(vx, vy, look.glyph, look.fg, bg);
    }

    if (!oblique) {
      for (let vy = 0; vy < screen.rows; vy++) {
        for (let vx = 0; vx < screen.cols; vx++) {
          const x = cam.x + vx;
          const y = cam.y + vy;
          if (world.inside(x, y)) drawTop(x, y, vx, vy);
          else put(vx, vy, ' ', COLORS.bg, COLORS.void);
        }
      }
    } else {
      // 由南往北畫（前面先畫），每一欄記住已經畫到第幾列；後面的格子只補還沒畫的列，
      // 被前面抬高的格子擋住的部分就不畫。效果跟「由北往南、後畫蓋前畫」一樣，但每格只畫一次。
      // 要從視窗下方 MAX_LIFT 列開始，那些格子抬高後會進到視窗裡
      for (let vx = 0; vx < screen.cols; vx++) {
        const x = cam.x + vx;
        let filled = screen.rows; // 這一欄從這一列往下都畫好了
        for (let y = cam.y + screen.rows - 1 + MAX_LIFT; y >= cam.y && filled > 0; y--) {
          const base = y - cam.y; // 這格原本那一列
          if (!world.inside(x, y)) {
            if (base < filled) {
              put(vx, base, ' ', COLORS.bg, COLORS.void);
              filled = base;
            }
            continue;
          }
          const top = topRow(y, world.tierAt(x, y), cam.y);
          if (top >= filled) continue; // 整格都被前面擋住
          const t = world.terrainAt(x, y);
          // 側面：頂面下方到原本那一列，緊貼頂面的那行較亮
          for (let r = Math.min(base, filled - 1); r > top; r--) {
            const w = walls[t][r === top + 1 ? 0 : 1];
            put(vx, r, w.glyph, w.fg, w.bg);
          }
          drawTop(x, y, vx, top);
          filled = top;
        }
      }
    }
    const p = oblique ? screenOf(world, cam, player.x, player.y) : { vx: player.x - cam.x, vy: player.y - cam.y };
    put(p.vx, p.vy, '@', COLORS.player, COLORS.bg);
  }

  return {
    draw,
    // 視窗格 → 世界格（滑鼠用）；看到世界外回傳 null
    cellAt(cam, vx, vy) {
      if (oblique) return pick(world, cam, vx, vy);
      const c = { x: cam.x + vx, y: cam.y + vy };
      return world.inside(c.x, c.y) ? c : null;
    },
    // 世界格 → 視窗格（路線標籤用）
    screenOf(cam, x, y) {
      return oblique ? screenOf(world, cam, x, y) : { vx: x - cam.x, vy: y - cam.y };
    },
  };
}
