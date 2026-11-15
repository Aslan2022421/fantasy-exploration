// 目標、查看中的格子：標底色。有物件時物件疊的每一層都標，標記跟著物件疊上去，不會留在地面跟物件分開。
// placeOf(x, y, h, lift, px) → 那格（往上 lift 層）畫在地圖區哪裡（stackview.js 給）

import { COLORS } from './colors.js';
import { groundHeight, objectLayers, UP } from './perspective.js';

export function drawMarks(mapView, world, objects, look, placeOf, { route, target, examined }) {
  for (const c of [examined, target]) {
    if (!c || !world.inside(c.x, c.y)) continue;
    const isTarget = target?.x === c.x && target?.y === c.y;
    const bg = isTarget ? (route?.reachable ? COLORS.target : COLORS.blocked) : COLORS.examined;
    const o = world.objectAt(c.x, c.y);
    const h0 = groundHeight(world.tierAt(c.x, c.y));
    const mark = (lift, glyph, fg, px, scale) => {
      const p = placeOf(c.x, c.y, h0, lift, px);
      mapView.drawShifted(0, 0, p.px, p.py, glyph, fg, bg, scale);
    };
    if (o < 0) {
      const g = look.ground(c.x, c.y);
      mark(0, g.glyph, g.fg);
      continue;
    }
    const ol = look.object(c.x, c.y, o);
    if (ol.big) {
      // 礦坑：大字的每一層都標
      for (let i = 0; i < ol.layers; i++) mark(i, ol.glyph, ol.fg, UP.bigPx, ol.big);
      continue;
    }
    if (ol.covered) {
      mark(0, ' ', null);
      continue;
    }
    const layers = objectLayers(objects[o], ol.isTrunk);
    if (!layers.some((l) => l.dh === 0)) mark(0, ' ', ol.fg); // 物件底下那格地面也標，跟上面幾層連成一塊
    for (const l of layers) {
      const trunk = l.part === 'trunk';
      mark(l.dh, trunk ? ol.trunkGlyph : ol.glyph, trunk ? ol.trunkFg : ol.fg);
    }
  }
}
