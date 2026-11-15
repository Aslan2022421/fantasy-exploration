// 畫地圖區：每一格長什麼樣子（字、字色、底色）在這裡決定，往上疊與相機交給 stackview.js。
// 字形看四層（glyphs.js），顏色查 shades.js 先算好的表；亮度是生成時算好的級數（陸地看高度層＋坡向，水看深度）

import { PART_DARK, PART_LIT, PART_MID, PART_TRUNK } from '../world/footprint.js';
import { layersNow } from '../world/gather.js';
import { lookAt } from './glyphs.js';
import { mountainRing, mountainRingFactor, SLOPE_STACK } from './perspective.js';
import { averageColor, buildObjectShades, buildShadeTable, dimColor, mixColor } from './shades.js';
import { createStackView } from './stackview.js';

const PART_FACTOR = { [PART_MID]: 1, [PART_LIT]: 1.25, [PART_DARK]: 0.65 }; // 樹冠右上亮、左下暗
const WOOD = '#6b5638'; // 樹幹往這個木頭色靠
const MOUNTAIN_TINT = 0.5; // 山上的樹顏色往腳下材質靠幾成
const SOFTEN = 0.6; // 交界的底色往周圍平均靠幾成
const ROCK_INK = 0.65; // 山上岩石、碎石字元的亮度
// 山坡兩面：光從右上照，東坡（\）是受光面、西坡（/）是背光面，一座山看得出亮暗兩面
const FACE = { '/': 0.6, '\\': 1.05 };
const FACE_RISE = 2; // 山坡的 / \ 往上多疊幾層（stackview.js），坡面像立起來
// 雪地或山上的樹：由頂往下三層各往地形顏色靠幾成、再調亮多少（頂端最像積雪、最亮，往下漸漸回到樹的顏色）
const CAP = [
  [0.6, 1.25],
  [0.4, 1.12],
  [0.2, 1],
];
// 山峰剪影：第 minRing 圈以上、radius 格內最高的山峰才畫；高 minRows 列起，每 ringsPerRow 圈多一列，最多 maxRows 列
export const PEAK = { minRing: 2, radius: 6, minRows: 3, ringsPerRow: 3, maxRows: 5, edge: 1.2, body: 0.18 };
// 疊層回饋：貼地資源（矮叢、草本）還能採時微微發亮、採過壓暗
const GLOW = 1.3;
const PICKED = 0.5;
const ACCENT = 0.7; // 礦坑圖樣裡的點綴字（accent）比主體暗多少
const MINE_BG = 0.12; // 礦坑佔的格子，底色往大類顏色靠幾成

export function createWorldView(mapView, world, data) {
  const { objects, surfaces } = data;
  const shades = buildShadeTable(data.palette); // { fg, bg }：[顏色來源][明暗級數]
  const objectFg = buildObjectShades(objects); // [物件][明暗級數]
  const objectFgOn = surfaces.map((s) =>
    buildObjectShades(objects.map((o) => ({ ...o, color: mixColor(o.color, s.color, MOUNTAIN_TINT) }))),
  );
  const creatureFg = buildObjectShades(data.species); // [物種][明暗級數]
  const isGround = objects.map((o) => o.gather?.action === 'pick');
  // 物件本身的亮暗回饋（乘在字色上）
  function feedback(x, y, o) {
    if (isGround[o]) return world.changeAt?.(x, y)?.picked ? PICKED : GLOW;
    return 1;
  }
  const isMountain = data.landforms.map((l) => l.style === 'mountain');
  const isStone = surfaces.map((s) => s.style === 'rock' || s.style === 'gravel');

  const rawBg = (x, y) => shades.bg[world.groundAt(x, y)][world.shadeAt(x, y)];
  // 山地一圈一圈往上變亮，放在字色上；取到 0.05 一級，染色表才不會多出太多種顏色
  const ringInk = (x, y) => Math.round(mountainRingFactor(world.heightAt(x, y)) * 20) / 20;

  // 周圍八格的底色跟自己不一樣時往九格的平均靠，雪線、山的一圈一圈、湖岸才不會是一格一格的方塊
  function softBg(x, y) {
    const own = rawBg(x, y);
    const all = [own];
    let differs = false;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if ((!dx && !dy) || !world.inside(x + dx, y + dy)) continue;
        const b = rawBg(x + dx, y + dy);
        if (b !== own) differs = true;
        all.push(b);
      }
    }
    return differs ? mixColor(own, averageColor(all), SOFTEN) : own;
  }

  function groundLook(x, y) {
    const level = world.shadeAt(x, y);
    const { glyph, ink } = lookAt(world, data, x, y);
    let fg = shades.fg[ink][level];
    if (isMountain[world.landformAt(x, y)]) {
      const face = FACE[glyph] ?? (isStone[world.surfaceAt(x, y)] ? ROCK_INK : 1);
      fg = dimColor(fg, ringInk(x, y) * face);
    }
    // 礦坑佔的格子：地形的底色往大類的顏色靠一點，九格看得出是一整處，亮暗還是跟著腳下的地形
    const o = world.objectAt(x, y);
    const bg = o >= 0 && objects[o].layers ? mixColor(softBg(x, y), objects[o].color, MINE_BG) : softBg(x, y);
    return { glyph, fg, bg, level, rise: FACE[glyph] ? FACE_RISE : 0 };
  }

  // 物件那格：樹葉或矮叢的字與顏色、樹幹的字與顏色；山上的樹顏色往腳下材質靠
  function objectLook(x, y, o) {
    if (objects[o].layers) return mineLook(x, y, o);
    const part = world.objectPartAt(x, y);
    const table = isMountain[world.landformAt(x, y)] ? objectFgOn[world.surfaceAt(x, y)] : objectFg;
    const level = world.shadeAt(x, y);
    const base = table[o][level];
    const isTrunk = part === PART_TRUNK;
    return {
      glyph: objects[o].glyph,
      fg: dimColor(base, PART_FACTOR[isTrunk ? PART_MID : part] * feedback(x, y, o)),
      trunkGlyph: objects[o].glyph, // 整根用樹種那一類的字（針葉樹 ↑、闊葉樹 ♣、硬木闊葉樹 ♠、棕櫚類 Y）
      trunkFg: mixColor(dimColor(base, 0.8), WOOD, 0.6),
      isTrunk,
      cap: snowCap(x, y), // 雪地或山上的樹，頂端幾層往地形顏色靠（stackview.js）
    };
  }

  // 生物那一格：物種的字與顏色，疊 height 層（物種資料自己寫的 2～3 層）
  function creatureLook(x, y, cr) {
    const sp = data.species[cr.species];
    return { glyph: sp.glyph, fg: creatureFg[cr.species][world.shadeAt(x, y)], height: sp.height };
  }

  // 礦坑的一格：畫資料 pattern 裡這一格的字（accent 的字暗一點），九格一起疊現在剩下的層數（越挖越矮）；
  // 顏色分大類，不往腳下材質靠
  function mineLook(x, y, o) {
    const def = objects[o];
    const a = world.anchorAt(x, y);
    const glyph = [...(def.pattern[y - a.y] ?? '')][x - a.x] ?? ' ';
    const fg = objectFg[o][world.shadeAt(x, y)];
    return {
      mine: true,
      glyph,
      fg: def.accent?.includes(glyph) ? dimColor(fg, ACCENT) : fg,
      layers: layersNow(world, def, a.x, a.y),
    };
  }

  // 雪地或山上的樹頂：回傳 [{ 第 j 層（由頂往下）的顏色往哪個色靠、靠幾成、再調亮多少 }]，不然 null
  function snowCap(x, y) {
    const snow = surfaces[world.surfaceAt(x, y)].id === 'snow';
    if (!snow && !isMountain[world.landformAt(x, y)]) return null;
    const ground = groundLook(x, y).fg;
    return CAP.map(([mix, light]) => ({ color: ground, mix, light }));
  }

  // 山峰剪影（stackview.js 畫）：夠高（第 PEAK.minRing 圈以上）、又是附近 PEAK.radius 格內最高的山峰，
  // 回傳 { rows 幾列高, west 西面字色, east 東面字色, edge 稜線字色, bg 底色 }，不然 null。
  // 越高的山剪影越大；底色塗滿，前面（南邊）的山會蓋住後面的
  function peakLook(x, y) {
    if (!world.peakAt(x, y)) return null;
    const h = world.heightAt(x, y);
    const ring = mountainRing(h);
    if (ring < PEAK.minRing) return null;
    const R = PEAK.radius;
    for (let dy = -R; dy <= R; dy++)
      for (let dx = -R; dx <= R; dx++) if ((dx || dy) && world.heightAt(x + dx, y + dy) > h) return null;
    const g = groundLook(x, y);
    return {
      rows: Math.min(PEAK.maxRows, PEAK.minRows + Math.floor(ring / PEAK.ringsPerRow)),
      west: dimColor(g.fg, FACE['/']),
      east: dimColor(g.fg, FACE['\\']),
      edge: dimColor(g.fg, PEAK.edge),
      bg: mixColor(g.bg, g.fg, PEAK.body), // 山體的底色比地面亮一點，看得出是一整塊
    };
  }

  // 斜坡：坡度到 SLOPE_STACK.min、不是水也不是山，回傳 { gx 東邊減西邊的高度 }，不然 null
  function slopeLook(x, y) {
    if (world.waterAt(x, y) >= 0 || isMountain[world.landformAt(x, y)]) return null;
    if (world.slopeAt(x, y) < SLOPE_STACK.min) return null;
    return { gx: world.heightAt(x + 1, y) - world.heightAt(x - 1, y) };
  }

  return createStackView(mapView, world, objects, {
    ground: groundLook,
    object: objectLook,
    creature: creatureLook,
    slope: slopeLook,
    peak: peakLook,
  });
}
