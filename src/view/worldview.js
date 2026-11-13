// 畫地圖區。預設是往上疊（使用者選 B，perspective.js 算層、stackview.js 畫）：高的東西同一個字疊好幾層，
// 全部往畫面上方錯開，每高一層錯開一樣的量；地形邊緣疊成朝南的牆；相機平滑捲動。
// 網址加 ?parallax 是多層次視差堆疊（parallaxview.js，會頓、會頭暈，留著對照），?leftdown 是更早的版本
// （光從右上照，往左下拉側面與物件影子，extrude.js），加 ?flat 不畫側面，這兩種頂面都在原位。
// - 亮度：生成時算好的亮度級數（陸地看高度層＋坡向明暗，水看深度）
// - 樹冠：多格的樹右上亮、左下暗
// 每格先畫地形層，有物件時把物件的字元疊在上面，背景仍用地面的。世界外畫深色。
// 路線、目標、查看中的格子疊在上面，最後畫冒險者

import { PART_DARK, PART_LIT, PART_MID, PART_TRUNK } from '../world/footprint.js';
import { FLAT } from '../world/relief.js';
import { COLORS } from './colors.js';
import { inShadow, sideSource } from './extrude.js';
import { lookAt } from './glyphs.js';
import { createParallaxView } from './parallaxview.js';
import { mountainRingFactor } from './perspective.js';
import { buildObjectShades, buildShadeTable, dimColor, mixColor } from './shades.js';
import { createStackView } from './stackview.js';

const SIDE_DIM = [0, 0.6, 0.5, 0.42]; // 側面離高處 1、2、3 格時的亮度
const SHADOW_DIM = 0.6; // 影子裡的亮度
const PART_FACTOR = { [PART_MID]: 1, [PART_LIT]: 1.25, [PART_DARK]: 0.65, [PART_TRUNK]: 0.8 }; // 樹冠各側的亮度
export const TRUNK_GLYPH = 'Φ'; // 樹幹：走不過去的那一格，跟樹冠分得出來
const MOUNTAIN_TINT = 0.5; // 山上的樹顏色往腳下材質靠幾成

// mode：'perspective' 往上疊（預設）、'parallax' 多層次視差堆疊、'leftdown' 往左下拉側面與影子、'flat' 不畫側面
export function createWorldView(mapView, world, data, { mode = 'perspective' } = {}) {
  const stacked = mode === 'perspective' || mode === 'parallax';
  const { objects, surfaces } = data;
  const shades = buildShadeTable(data.palette); // { fg, bg }：[顏色來源][明暗級數][立面]
  const objectFg = buildObjectShades(objects); // [物件][明暗級數][立面]
  // 山上的樹：顏色往腳下的材質（岩石、碎石、雪）靠（使用者定），每種材質一張表
  const objectFgOn = surfaces.map((s) =>
    buildObjectShades(objects.map((o) => ({ ...o, color: mixColor(o.color, s.color, MOUNTAIN_TINT) }))),
  );
  const isMountain = data.landforms.map((l) => l.style === 'mountain');

  // 一格地面的樣子：字形與字元色看四層（glyphs.js），背景是地面的顏色，亮暗輔助高低與深淺
  // 山地的底色逐圈變亮、往山腳變深（perspective.js 的 RING）；只調背景，字元顏色不多出新的染色表
  function groundLook(x, y) {
    const level = world.shadeAt(x, y);
    const { glyph, ink } = lookAt(world, data, x, y);
    let bg = shades.bg[world.groundAt(x, y)][level][FLAT];
    if (isMountain[world.landformAt(x, y)]) bg = dimColor(bg, mountainRingFactor(world.heightAt(x, y)));
    return { glyph, fg: shades.fg[ink][level][FLAT], bg, level };
  }

  // 物件的字元顏色（山上的樹往腳下材質靠）
  function objectFgAt(x, y, o, level) {
    const table = isMountain[world.landformAt(x, y)] ? objectFgOn[world.surfaceAt(x, y)] : objectFg;
    return table[o][level][FLAT];
  }

  // 物件那格的樣子（疊層用）：樹葉或矮叢的字與顏色、樹幹的字與顏色
  function objectLook(x, y, o) {
    const part = world.objectPartAt(x, y);
    const base = objectFgAt(x, y, o, world.shadeAt(x, y));
    const isTrunk = part === PART_TRUNK;
    return {
      glyph: objects[o].glyph,
      fg: dimColor(base, PART_FACTOR[isTrunk ? PART_MID : part]),
      trunkGlyph: TRUNK_GLYPH,
      trunkFg: dimColor(base, PART_FACTOR[PART_TRUNK]),
      isTrunk,
    };
  }
  const createStack = mode === 'parallax' ? createParallaxView : createStackView;
  const stack = createStack(mapView, world, objects, { ground: groundLook, object: objectLook });

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

  function cellLook(x, y) {
    if (mode === 'leftdown') return leftDownLook(x, y);
    return withObject(groundLook(x, y), x, y, world.objectAt(x, y));
  }

  // 路線、目標、查看中的格子：整格平畫在最上面（蓋過疊層）
  function drawMarks(screen, cam, { route, target, examined }) {
    const marks = new Map();
    for (const s of route?.steps ?? []) marks.set(`${s.x},${s.y}`, s);
    for (const c of [examined, target]) if (c) marks.set(`${c.x},${c.y}`, c);
    for (const { x, y } of marks.values()) {
      const vx = x - cam.x;
      const vy = y - cam.y;
      if (vx < 0 || vy < 0 || vx >= screen.cols || vy >= screen.rows || !world.inside(x, y)) continue;
      const look = cellLook(x, y);
      const isTarget = target?.x === x && target?.y === y;
      let bg = look.bg;
      if (examined?.x === x && examined?.y === y) bg = COLORS.examined;
      if (isTarget) bg = route?.reachable ? COLORS.target : COLORS.blocked;
      if (isTarget || (examined?.x === x && examined?.y === y)) mapView.draw(vx, vy, look.glyph, look.fg, bg);
      else mapView.draw(vx, vy, '•', COLORS.path, bg);
    }
  }

  // overlay：{ route: {steps, reachable} | null, target, examined, player }
  function draw(screen, cam, overlay) {
    if (stacked) return stack.draw(screen, cam, overlay); // true：相機還在半路上

    for (let vy = 0; vy < screen.rows; vy++) {
      for (let vx = 0; vx < screen.cols; vx++) {
        const x = cam.x + vx;
        const y = cam.y + vy;
        if (!world.inside(x, y)) mapView.draw(vx, vy, ' ', COLORS.bg, COLORS.void);
        else {
          const look = cellLook(x, y);
          mapView.draw(vx, vy, look.glyph, look.fg, look.bg);
        }
      }
    }
    drawMarks(screen, cam, overlay);
    const { player } = overlay;
    mapView.draw(player.x - cam.x, player.y - cam.y, '@', COLORS.player, COLORS.bg);
    return false;
  }

  return {
    draw,
    // 視窗格 → 世界格；世界外回傳 null。全俯視透視時找畫面上那一點最上面的地面
    cellAt(cam, vx, vy, fx, fy) {
      if (stacked) return stack.cellAt(cam, vx, vy, fx, fy);
      const c = { x: cam.x + vx, y: cam.y + vy };
      return world.inside(c.x, c.y) ? c : null;
    },
    // 世界格 → 視窗格（路線標籤用）
    screenOf(cam, x, y) {
      if (stacked) return stack.screenOf(cam, x, y);
      return { vx: x - cam.x, vy: y - cam.y };
    },
  };
}
