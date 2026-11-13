// 畫地圖區。預設是全俯視透視（使用者選定，perspective.js）：相機在畫面中心正上方，
// 高的地形與物件同一個字疊好幾層，往中心錯開幾個像素，離中心越遠錯得越開。網址加 ?leftdown 是前一版（光從右上照，
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
import { layerOffset, MAX_LAYERS, objectLayers, STACK, terrainLayers } from './perspective.js';
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

  // 全俯視透視的第一遍：地面畫在原位（有物件時只畫背景），要疊層的記進 stacks 等第二遍
  function drawGround(vx, vy, x, y, cx, cy, stacks) {
    const g = groundLook(x, y);
    const o = world.objectAt(x, y);
    const glyph = o >= 0 ? ' ' : g.glyph;
    mapView.draw(vx, vy, glyph, g.fg, g.bg);
    const at = { vx, vy, dx: x - cx, dy: y - cy };
    const tl = terrainLayers(world, cx, cy, x, y);
    if (tl) stacks.terrain.push({ ...at, layers: tl, glyph, fg: g.fg, bg: g.bg });
    if (o < 0) return;
    const look = withObject({ ...g }, x, y, o);
    const ol = objectLayers(objects[o]);
    if (ol) stacks.object.push({ ...at, layers: ol, glyph: look.glyph, fg: look.fg, bg: null });
    else mapView.draw(vx, vy, look.glyph, look.fg);
  }

  // 第二遍：先地形再物件，各自由最底層畫到頂層（頂層在原位、最亮），近處的底層不會蓋掉別格的頂
  function drawStacks(stacks) {
    for (const list of [stacks.terrain, stacks.object]) {
      for (let j = MAX_LAYERS - 1; j >= 0; j--) {
        const f = STACK.dims[j];
        for (const s of list) {
          if (s.layers - 1 < j) continue;
          const { ox, oy } = layerOffset(s.dx, s.dy, j);
          const bg = s.bg && (j ? dimColor(s.bg, f) : s.bg);
          mapView.drawShifted(s.vx, s.vy, ox, oy, s.glyph, j ? dimColor(s.fg, f) : s.fg, bg);
        }
      }
    }
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
    const cx = cam.x + Math.floor(screen.cols / 2); // 相機在畫面中心正上方
    const cy = cam.y + Math.floor(screen.rows / 2);
    const stacks = mode === 'perspective' ? { terrain: [], object: [] } : null;
    for (let vy = 0; vy < screen.rows; vy++) {
      for (let vx = 0; vx < screen.cols; vx++) {
        const x = cam.x + vx;
        const y = cam.y + vy;
        if (!world.inside(x, y)) mapView.draw(vx, vy, ' ', COLORS.bg, COLORS.void);
        else if (stacks) drawGround(vx, vy, x, y, cx, cy, stacks);
        else {
          const look = cellLook(x, y);
          mapView.draw(vx, vy, look.glyph, look.fg, look.bg);
        }
      }
    }
    if (stacks) drawStacks(stacks);
    drawMarks(screen, cam, overlay);
    const { player } = overlay;
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
