// 目標、查看中的格子：標底色。有物件時物件疊的每一層都標，標記跟著物件疊上去，不會留在地面跟物件分開。
// placeOf(x, y, h, lift) → 那格（往上 lift 層）畫在地圖區哪裡（stackview.js 給）

import { COLORS } from './colors.js';
import { groundHeight, objectLayers, UP } from './perspective.js';

export function drawMarks(mapView, world, objects, look, placeOf, { route, target, examined }) {
  for (const c of [examined, target]) {
    if (!c || !world.inside(c.x, c.y)) continue;
    const isTarget = target?.x === c.x && target?.y === c.y;
    const bg = isTarget ? (route?.reachable ? COLORS.target : COLORS.blocked) : COLORS.examined;
    const o = world.objectAt(c.x, c.y);
    const h0 = groundHeight(world.tierAt(c.x, c.y));
    const mark = (lift, glyph, fg) => {
      const p = placeOf(c.x, c.y, h0, lift);
      mapView.drawShifted(0, 0, p.px, p.py, glyph, fg, bg);
    };
    const cr = o < 0 ? world.creatureAt?.(c.x, c.y) : null;
    if (cr) {
      // 生物：那一隻佔的每一格、疊的每一層都標，標記跟著生物疊上去
      for (const cell of cr.cells) {
        const cl = look.creature(cell.x, cell.y, cr);
        for (let lift = 0; lift < cl.height; lift++) {
          const p = placeOf(cell.x, cell.y, h0, lift, UP.minePx);
          mapView.drawShifted(0, 0, p.px, p.py, cl.glyph, cl.fg, lift === 0 ? bg : null);
        }
      }
      continue;
    }
    if (o < 0) {
      const g = look.ground(c.x, c.y);
      mark(0, g.glyph, g.fg);
      continue;
    }
    const ol = look.object(c.x, c.y, o);
    if (ol.mine) {
      // 礦坑：只標佔的那幾格的地面（畫最底層的字），上面疊的層不塗
      const a = world.anchorAt(c.x, c.y);
      const d = objects[o].sizes[0];
      for (let j = 0; j < d; j++)
        for (let i = 0; i < d; i++) {
          const x = a.x + i;
          const y = a.y + j;
          const ml = look.object(x, y, o);
          const p = placeOf(x, y, h0, 0);
          mapView.drawShifted(0, 0, p.px, p.py, ml.glyph, ml.fg, bg);
        }
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
