// 目標、查看中的格子：底色只塗在腳下那一塊（樹幹那格、礦坑九格、生物佔的格子），往上疊的各層照地圖原本的畫法
// （下層往底色壓淡）重畫在底色上面，選定的東西照樣看得出高度，不會變成平的一塊。
// 底色剛好塗那幾格，不往四邊多塗，跟字對齊。
// placeOf(x, y, h, lift, px, tilt) → 那格（往上 lift 層，每層 px；tilt 是斜坡那層的坡向）畫在地圖區哪裡（stackview.js 給）

import { COLORS } from './colors.js';
import { fadeAt, groundHeight, objectLayers, UP, wallSouth } from './perspective.js';
import { dimColor, mixColor } from './shades.js';

const fade = (color, toward, j) => (j ? mixColor(color, toward, fadeAt(j)) : color);

export function drawMarks(mapView, world, objects, look, placeOf, { route, target, examined }) {
  for (const c of [examined, target]) {
    if (!c || !world.inside(c.x, c.y)) continue;
    const isTarget = target?.x === c.x && target?.y === c.y;
    const bg = isTarget ? (route?.reachable ? COLORS.target : COLORS.blocked) : COLORS.examined;
    const o = world.objectAt(c.x, c.y);
    const h0 = groundHeight(world.tierAt(c.x, c.y));
    // 斜坡：地圖把貼地那層多抬一層、往上坡那側偏（stackview.js 的 slopeTilt），標記照同樣的位置畫才對得齊
    const tiltOf = (x, y) => (wallSouth(world, x, y) ? undefined : look.slope?.(x, y)?.gx);
    // 腳下塗底色：剛好 w×h 格，從 (x, y) 往右下；tilt 是斜坡那層的偏移
    const paint = (x, y, w = 1, h = 1, tilt = undefined) => {
      const p = placeOf(x, y, h0, 0, undefined, tilt);
      mapView.paint(0, 0, p.px, p.py, bg, w, h);
    };
    // 往上第 lift 層畫一個字（只畫字，不塗底色）
    const ink = (x, y, lift, px, glyph, fg, w = 1, h = 1, tilt = undefined) => {
      const p = placeOf(x, y, h0, lift, px, tilt);
      mapView.drawShifted(0, 0, p.px, p.py, glyph, fg, null, w, h);
    };

    const cr = o < 0 ? world.creatureAt?.(c.x, c.y) : null;
    if (cr) {
      // 生物：佔地整塊塗底色，放大的字從地面往上疊，下層往底色壓淡（跟地圖上一樣）
      const a = cr.member;
      const cl = look.creature(cr);
      paint(a.x, a.y, cl.w, cl.h);
      for (let lift = 0; lift < cl.height; lift++)
        ink(a.x, a.y, lift, UP.minePx, cl.glyph, fade(cl.fg, bg, cl.height - 1 - lift), cl.w, cl.h);
      continue;
    }
    const tilt = tiltOf(c.x, c.y);
    if (o < 0) {
      const g = look.ground(c.x, c.y);
      paint(c.x, c.y, 1, 1, tilt);
      ink(c.x, c.y, 0, undefined, g.glyph, g.fg, 1, 1, tilt);
      continue;
    }
    const ol = look.object(c.x, c.y, o);
    if (ol.mine) {
      // 礦坑：九格的地面塗底色，再一層一層往上疊（同一層北邊先畫），下層往底色壓淡
      const a = world.anchorAt(c.x, c.y);
      const d = objects[o].sizes[0];
      const cells = [];
      for (let j = 0; j < d; j++) for (let i = 0; i < d; i++) cells.push({ x: a.x + i, y: a.y + j });
      for (const p of cells) paint(p.x, p.y);
      const looks = cells.map((p) => ({ ...p, ml: look.object(p.x, p.y, o) }));
      const layers = looks[0].ml.layers;
      for (let lift = 0; lift < layers; lift++)
        for (const { x, y, ml } of looks)
          if (ml.glyph !== ' ') ink(x, y, lift, UP.minePx, ml.glyph, fade(ml.fg, bg, layers - 1 - lift));
      continue;
    }
    // 樹、矮叢：腳下那格塗底色，樹幹與樹冠照地圖的壓淡與積雪重畫；斜坡上貼地那層照地圖抬高、偏移，往上的層不偏
    paint(c.x, c.y, 1, 1, tilt);
    const layers = objectLayers(objects[o], ol.isTrunk);
    if (!layers.length) ink(c.x, c.y, 0, undefined, ol.glyph, ol.fg, 1, 1, tilt);
    for (const l of layers) {
      const trunk = l.part === 'trunk';
      let color = trunk ? ol.trunkFg : ol.fg;
      const cap = ol.cap?.[l.j];
      if (cap) color = dimColor(mixColor(color, cap.color, cap.mix), cap.light);
      const fg = fade(color, bg, trunk ? Math.min(l.j, 1) : l.j);
      ink(c.x, c.y, l.dh, undefined, trunk ? ol.trunkGlyph : ol.glyph, fg, 1, 1, l.dh === 0 ? tilt : undefined);
    }
  }
}
