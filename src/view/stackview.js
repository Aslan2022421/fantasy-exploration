// 全俯視透視的畫法（perspective.js 算層與錯開量，這裡照高度由低到高畫上畫布）。
// 每格收集要畫的東西（地面、牆、物件各層），照高度分桶，低的先畫、高的後畫，高的蓋住低的。
// 地圖區外多收 MARGIN 格，錯開之後畫面邊緣才補得滿。
// 滑鼠點格子時，找畫面上那一點最上面的地面是哪一格（錯開後不一定是原位那格）

import { COLORS } from './colors.js';
import { dimAt, groundHeight, objectLayers, shiftOf, wallRange } from './perspective.js';
import { dimColor } from './shades.js';

const MARGIN = 2;
const ORIGIN = groundHeight(0); // 原點：水面那一層（使用者定）
const PICK = 2; // 點格子時往四周找幾格

// look：{ ground(x, y) → { glyph, fg, bg }, object(x, y, o) → { glyph, fg, trunkGlyph, trunkFg, isTrunk } }
export function createStackView(mapView, world, objects, look) {
  let frame = null; // 上一次畫的相機、畫面中心與原點，點格子時用

  function collect(x, y, f, buckets) {
    const g = look.ground(x, y);
    const o = world.objectAt(x, y);
    const at = { vx: x - f.cam.x, vy: y - f.cam.y, dx: x - f.cx, dy: y - f.cy };
    const h0 = groundHeight(world.tierAt(x, y));
    const glyph = o >= 0 ? ' ' : g.glyph;
    const put = (h, item) => {
      if (!buckets[h]) buckets[h] = [];
      buckets[h].push({ ...at, h, ...item });
    };
    const wall = wallRange(world, f.cx, f.cy, x, y);
    if (wall) {
      for (let h = wall.from; h <= wall.to; h++) {
        const d = dimAt(h0 - h);
        put(h, { glyph, fg: dimColor(g.fg, d), bg: dimColor(g.bg, d) });
      }
    }
    put(h0, { glyph, fg: g.fg, bg: g.bg });
    if (o < 0) return;
    const ol = look.object(x, y, o);
    const layers = objectLayers(objects[o], ol.isTrunk);
    if (!layers.length) put(h0, { glyph: ol.glyph, fg: ol.fg, bg: null });
    for (const l of layers) {
      const trunk = l.part === 'trunk';
      const fg = dimColor(trunk ? ol.trunkFg : ol.fg, dimAt(l.j));
      put(h0 + l.dh, { glyph: trunk ? ol.trunkGlyph : ol.glyph, fg, bg: null });
    }
  }

  // 路線、目標、查看中的格子：畫在那格地面錯開後的位置，蓋過疊層
  function drawMarks(f, { route, target, examined }) {
    const marks = new Map();
    for (const s of route?.steps ?? []) marks.set(`${s.x},${s.y}`, s);
    for (const c of [examined, target]) if (c) marks.set(`${c.x},${c.y}`, c);
    for (const { x, y } of marks.values()) {
      if (!world.inside(x, y)) continue;
      const { ox, oy } = shiftOf(x - f.cx, y - f.cy, groundHeight(world.tierAt(x, y)) - f.R);
      const isTarget = target?.x === x && target?.y === y;
      const isExamined = examined?.x === x && examined?.y === y;
      let bg = look.ground(x, y).bg;
      if (isExamined) bg = COLORS.examined;
      if (isTarget) bg = route?.reachable ? COLORS.target : COLORS.blocked;
      const vx = x - f.cam.x;
      const vy = y - f.cam.y;
      if (isTarget || isExamined) {
        const o = world.objectAt(x, y);
        const g = o >= 0 ? look.object(x, y, o) : look.ground(x, y);
        const trunk = o >= 0 && g.isTrunk;
        mapView.drawShifted(vx, vy, ox, oy, trunk ? g.trunkGlyph : g.glyph, trunk ? g.trunkFg : g.fg, bg);
      } else mapView.drawShifted(vx, vy, ox, oy, '•', COLORS.path, bg);
    }
  }

  function draw(screen, cam, overlay) {
    const { player } = overlay;
    const f = {
      cam,
      cx: cam.x + Math.floor(screen.cols / 2), // 相機在畫面中心正上方
      cy: cam.y + Math.floor(screen.rows / 2),
      R: ORIGIN, // 原點固定，角色換高度層時畫面不會跳
    };
    frame = f;
    const buckets = [];
    for (let vy = -MARGIN; vy < screen.rows + MARGIN; vy++) {
      for (let vx = -MARGIN; vx < screen.cols + MARGIN; vx++) {
        const x = cam.x + vx;
        const y = cam.y + vy;
        if (world.inside(x, y)) collect(x, y, f, buckets);
      }
    }
    mapView.clipped(() => {
      mapView.fill(COLORS.void);
      for (const list of buckets) {
        if (!list) continue;
        for (const it of list) {
          const { ox, oy } = shiftOf(it.dx, it.dy, it.h - f.R);
          mapView.drawShifted(it.vx, it.vy, ox, oy, it.glyph, it.fg, it.bg);
        }
      }
      drawMarks(f, overlay);
    });
    mapView.draw(player.x - cam.x, player.y - cam.y, '@', COLORS.player, COLORS.bg);
  }

  // 視窗格 → 世界格：畫面上那格中心點，最上面的地面是哪一格。找不到就用原位那格；世界外回傳 null
  function cellAt(cam, vx, vy) {
    const px = vx * 8 + 4;
    const py = vy * 8 + 4;
    let best = null;
    if (frame && frame.cam.x === cam.x && frame.cam.y === cam.y) {
      for (let y = cam.y + vy - PICK; y <= cam.y + vy + PICK; y++) {
        for (let x = cam.x + vx - PICK; x <= cam.x + vx + PICK; x++) {
          if (!world.inside(x, y)) continue;
          const h = groundHeight(world.tierAt(x, y));
          const { ox, oy } = shiftOf(x - frame.cx, y - frame.cy, h - frame.R);
          const left = (x - cam.x) * 8 + ox;
          const top = (y - cam.y) * 8 + oy;
          if (px < left || px >= left + 8 || py < top || py >= top + 8) continue;
          if (!best || h >= best.h) best = { x, y, h };
        }
      }
    }
    const c = best ?? { x: cam.x + vx, y: cam.y + vy };
    return world.inside(c.x, c.y) ? { x: c.x, y: c.y } : null;
  }

  return { draw, cellAt };
}
