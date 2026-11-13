// 畫地圖區。預設是全俯視透視（使用者選定，perspective.js）：相機在畫面中心正上方，
// 高的地形與物件把側面往中心拉，離中心越遠越長。網址加 ?leftdown 是前一版（光從右上照，
// 往左下拉側面與物件影子，extrude.js），加 ?flat 不畫側面，留著對照用。
// - 亮度：生成時算好的亮度級數（陸地看高度層＋坡向明暗，水看深度）
// - 樹冠：多格的樹右上亮、左下暗
// 頂面都畫在原位，滑鼠點哪格就是哪格。
// 每格先畫地形層，有物件時把物件的字元疊在上面，背景仍用地面的。世界外畫深色。
// 路線、目標、查看中的格子疊在上面，最後畫冒險者

import { PART_DARK, PART_LIT, PART_MID, PART_TRUNK } from '../world/footprint.js';
import { FLAT } from '../world/relief.js';
import { COLORS } from './colors.js';
import { inShadow, sideSource } from './extrude.js';
import { lookAt } from './glyphs.js';
import { perspectiveSource } from './perspective.js';
import { buildObjectShades, buildShadeTable, dimColor, mixColor } from './shades.js';

const SIDE_DIM = [0, 0.6, 0.5, 0.42]; // 側面離高處 1、2、3 格時的亮度
const SHADOW_DIM = 0.6; // 影子裡的亮度
const PART_FACTOR = { [PART_MID]: 1, [PART_LIT]: 1.25, [PART_DARK]: 0.65, [PART_TRUNK]: 0.8 }; // 樹冠各側的亮度
export const TRUNK_GLYPH = 'Φ'; // 樹幹：走不過去的那一格，跟樹冠分得出來
const MOUNTAIN_TINT = 0.5; // 山上的樹顏色往腳下材質靠幾成

// mode：'perspective' 全俯視透視（預設）、'leftdown' 往左下拉側面與影子（前一版）、'flat' 不畫側面
export function createWorldView(mapView, world, data, { mode = 'perspective' } = {}) {
  const { objects, surfaces } = data;
  const shades = buildShadeTable(data.palette); // { fg, bg }：[顏色來源][明暗級數][立面]
  const objectFg = buildObjectShades(objects); // [物件][明暗級數][立面]
  // 山上的樹：顏色往腳下的材質（岩石、碎石、雪）靠（使用者定），每種材質一張表
  const objectFgOn = surfaces.map((s) =>
    buildObjectShades(objects.map((o) => ({ ...o, color: mixColor(o.color, s.color, MOUNTAIN_TINT) }))),
  );
  const isMountain = data.landforms.map((l) => l.style === 'mountain');

  // 一格地面的樣子：字形與字元色看四層（glyphs.js），背景是地面的顏色，亮暗輔助高低與深淺
  function groundLook(x, y) {
    const level = world.shadeAt(x, y);
    const { glyph, ink } = lookAt(world, data, x, y);
    return {
      glyph,
      fg: shades.fg[ink][level][FLAT],
      bg: shades.bg[world.groundAt(x, y)][level][FLAT],
      level,
    };
  }

  // 物件的字元顏色（山上的樹往腳下材質靠）
  function objectFgAt(x, y, o, level) {
    const table = isMountain[world.landformAt(x, y)] ? objectFgOn[world.surfaceAt(x, y)] : objectFg;
    return table[o][level][FLAT];
  }

  // 全俯視透視：(cx, cy) 是畫面中心。被側面蓋到就畫側面，不然畫地面（＋物件）
  function perspectiveLook(x, y, cx, cy) {
    const o = world.objectAt(x, y);
    const side = perspectiveSource(world, objects, cx, cy, x, y, o >= 0);
    if (side) {
      const f = SIDE_DIM[side.k];
      if (side.kind === 'terrain') {
        const src = groundLook(side.x, side.y);
        return { glyph: src.glyph, fg: dimColor(src.fg, f), bg: dimColor(src.bg, f) };
      }
      const so = world.objectAt(side.x, side.y);
      const level = world.shadeAt(side.x, side.y);
      const look = groundLook(x, y);
      return { glyph: objects[so].glyph, fg: dimColor(objectFgAt(side.x, side.y, so, level), f), bg: look.bg };
    }
    return withObject(groundLook(x, y), x, y, o);
  }

  function withObject(look, x, y, o) {
    if (o < 0) return look;
    const part = world.objectPartAt(x, y);
    look.glyph = part === PART_TRUNK ? TRUNK_GLYPH : objects[o].glyph;
    look.fg = dimColor(objectFgAt(x, y, o, look.level), PART_FACTOR[part]);
    return look;
  }

  // 這一格最後的樣子（往左下拉的舊版）：側面蓋住整格；不然畫地面（＋物件），落在影子裡就調暗
  function leftDownLook(x, y) {
    const side = sideSource(world, x, y);
    if (side) {
      const src = groundLook(side.x, side.y);
      const f = SIDE_DIM[side.k];
      return { glyph: src.glyph, fg: dimColor(src.fg, f), bg: dimColor(src.bg, f) };
    }
    const o = world.objectAt(x, y);
    const look = withObject(groundLook(x, y), x, y, o);
    if (o < 0 && inShadow(world, objects, x, y)) {
      look.fg = dimColor(look.fg, SHADOW_DIM);
      look.bg = dimColor(look.bg, SHADOW_DIM);
    }
    return look;
  }

  function cellLook(x, y, cx, cy) {
    if (mode === 'perspective') return perspectiveLook(x, y, cx, cy);
    if (mode === 'leftdown') return leftDownLook(x, y);
    return withObject(groundLook(x, y), x, y, world.objectAt(x, y));
  }

  // overlay：{ route: {steps, reachable} | null, target, examined, player }
  function draw(screen, cam, { route, target, examined, player }) {
    const onRoute = new Set(route?.steps.map((s) => `${s.x},${s.y}`));
    const cx = cam.x + Math.floor(screen.cols / 2); // 相機在畫面中心正上方
    const cy = cam.y + Math.floor(screen.rows / 2);
    for (let vy = 0; vy < screen.rows; vy++) {
      for (let vx = 0; vx < screen.cols; vx++) {
        const x = cam.x + vx;
        const y = cam.y + vy;
        if (!world.inside(x, y)) {
          mapView.draw(vx, vy, ' ', COLORS.bg, COLORS.void);
          continue;
        }
        const look = cellLook(x, y, cx, cy);
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
