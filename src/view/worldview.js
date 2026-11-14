// 畫地圖區：每一格長什麼樣子（字、字色、底色）在這裡決定，往上疊與相機交給 stackview.js。
// 字形看四層（glyphs.js），顏色查 shades.js 先算好的表；亮度是生成時算好的級數（陸地看高度層＋坡向，水看深度）

import { PART_DARK, PART_LIT, PART_MID, PART_TRUNK } from '../world/footprint.js';
import { lookAt } from './glyphs.js';
import { mountainRing, mountainRingFactor, RING, SLOPE_STACK } from './perspective.js';
import { averageColor, buildObjectShades, buildShadeTable, dimColor, mixColor } from './shades.js';
import { createStackView } from './stackview.js';

const PART_FACTOR = { [PART_MID]: 1, [PART_LIT]: 1.25, [PART_DARK]: 0.65 }; // 樹冠右上亮、左下暗
const TRUNK_GLYPH = 'Φ';
const WOOD = '#6b5638'; // 樹幹往這個木頭色靠
const MOUNTAIN_TINT = 0.5; // 山上的樹顏色往腳下材質靠幾成
const SOFTEN = 0.6; // 交界的底色往周圍平均靠幾成
const ROCK_INK = 0.65; // 山上岩石、碎石字元的亮度
// 疊層回饋：貼地資源（矮叢、草本）還能採時微微發亮、採過壓暗；被岩壁整圈圍住的岩壁壓暗，外圈是亮的
const GLOW = 1.3;
const PICKED = 0.5;
const INNER_WALL = 0.55;
// 岩壁、礦脈跟著山一圈一圈變亮：山腳（和山以外的露頭）low，第 RING.full 圈以上 high，跟山地本身的明暗一起往上走
const WALL_RING = { low: 0.6, high: 1.15 };

export function createWorldView(mapView, world, data) {
  const { objects, surfaces } = data;
  const shades = buildShadeTable(data.palette); // { fg, bg }：[顏色來源][明暗級數]
  const objectFg = buildObjectShades(objects); // [物件][明暗級數]
  const objectFgOn = surfaces.map((s) =>
    buildObjectShades(objects.map((o) => ({ ...o, color: mixColor(o.color, s.color, MOUNTAIN_TINT) }))),
  );
  const lowFg = buildObjectShades(objects.map((o) => ({ ...o, color: o.baseColor ?? o.color }))); // 頂層以下的顏色
  const isRocky = objects.map((o) => o.gather?.action === 'mine');
  const isGround = objects.map((o) => o.gather?.action === 'pick');
  // 八格都是岩壁或礦脈：在一整片岩壁的裡面
  const inner = (x, y) => {
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && !isRocky[world.objectAt(x + dx, y + dy)]) return false;
    return true;
  };
  // 岩壁在這個高度的亮度；取到 0.05 一級，染色表才不會多出太多種顏色
  const wallRing = (x, y) => {
    const f = Math.min(1, mountainRing(world.heightAt(x, y)) / RING.full);
    return Math.round((WALL_RING.low + (WALL_RING.high - WALL_RING.low) * f) * 20) / 20;
  };
  // 物件本身的亮暗回饋：{ top 頂層, low 頂層以下 }。岩壁整個跟著高度；礦脈只有下面的岩石層跟著高度，
  // 頂層的礦脈色不壓暗，山腳的礦脈才認得出來
  function feedback(x, y, o) {
    if (isRocky[o]) {
      const k = inner(x, y) ? INNER_WALL : 1;
      const ring = wallRing(x, y);
      return { top: objects[o].baseColor ? k : ring * k, low: ring * k };
    }
    if (isGround[o]) {
      const k = world.changeAt?.(x, y)?.picked ? PICKED : GLOW;
      return { top: k, low: k };
    }
    return { top: 1, low: 1 };
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
      fg = dimColor(fg, ringInk(x, y) * (isStone[world.surfaceAt(x, y)] ? ROCK_INK : 1));
    }
    return { glyph, fg, bg: softBg(x, y), level };
  }

  // 物件那格：樹葉或矮叢的字與顏色、樹幹的字與顏色、頂層以下的顏色（礦脈）；山上的樹顏色往腳下材質靠
  function objectLook(x, y, o) {
    const part = world.objectPartAt(x, y);
    const table = isMountain[world.landformAt(x, y)] ? objectFgOn[world.surfaceAt(x, y)] : objectFg;
    const level = world.shadeAt(x, y);
    const base = table[o][level];
    const isTrunk = part === PART_TRUNK;
    const k = feedback(x, y, o);
    return {
      glyph: objects[o].glyph,
      fg: dimColor(base, PART_FACTOR[isTrunk ? PART_MID : part] * k.top),
      lowFg: objects[o].baseColor ? dimColor(lowFg[o][level], k.low) : null,
      trunkGlyph: TRUNK_GLYPH,
      trunkFg: mixColor(dimColor(base, 0.8), WOOD, 0.6),
      isTrunk,
    };
  }

  // 斜坡：坡度到 SLOPE_STACK.min、不是水也不是山，回傳 { gx 東邊減西邊的高度 }，不然 null
  function slopeLook(x, y) {
    if (world.waterAt(x, y) >= 0 || isMountain[world.landformAt(x, y)]) return null;
    if (world.slopeAt(x, y) < SLOPE_STACK.min) return null;
    return { gx: world.heightAt(x + 1, y) - world.heightAt(x - 1, y) };
  }

  return createStackView(mapView, world, objects, { ground: groundLook, object: objectLook, slope: slopeLook });
}
