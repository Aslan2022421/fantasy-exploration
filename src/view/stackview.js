// 疊層的畫法（perspective.js 算層與錯開量，這裡照高度由低到高畫上畫布）。
// 每格收集要畫的東西（地面、牆、物件各層），照高度分桶，低的先畫、高的後畫；同高時北邊先畫、南邊後畫。
// 東西都往上錯開，所以地圖區下方多收幾列，畫面底部才補得滿。
// 冒險者、路線、目標都畫在那格地面錯開後的位置；滑鼠點格子時，找畫面上那一點最上面的地面是哪一格

import { COLORS } from './colors.js';
import { dimAt, groundHeight, MAX_SHIFT_CELLS, objectLayers, shiftOf, wallRange } from './perspective.js';
import { dimColor } from './shades.js';

const BELOW = MAX_SHIFT_CELLS + 1; // 地圖區下方多收幾列

// look：{ ground(x, y) → { glyph, fg, bg }, object(x, y, o) → { glyph, fg, trunkGlyph, trunkFg, isTrunk } }
export function createStackView(mapView, world, objects, look) {
  let lastCam = null; // 上一次畫的相機，點格子時用

  const groundShift = (x, y) => shiftOf(groundHeight(world.tierAt(x, y)));

  function collect(x, y, cam, buckets) {
    const g = look.ground(x, y);
    const o = world.objectAt(x, y);
    const at = { vx: x - cam.x, vy: y - cam.y };
    const h0 = groundHeight(world.tierAt(x, y));
    const glyph = o >= 0 ? ' ' : g.glyph;
    const put = (h, item) => {
      if (!buckets[h]) buckets[h] = [];
      buckets[h].push({ ...at, h, ...item });
    };
    const wall = wallRange(world, x, y);
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
  function drawMarks(cam, { route, target, examined }) {
    const marks = new Map();
    for (const s of route?.steps ?? []) marks.set(`${s.x},${s.y}`, s);
    for (const c of [examined, target]) if (c) marks.set(`${c.x},${c.y}`, c);
    for (const { x, y } of marks.values()) {
      if (!world.inside(x, y)) continue;
      const { ox, oy } = groundShift(x, y);
      const isTarget = target?.x === x && target?.y === y;
      const isExamined = examined?.x === x && examined?.y === y;
      let bg = look.ground(x, y).bg;
      if (isExamined) bg = COLORS.examined;
      if (isTarget) bg = route?.reachable ? COLORS.target : COLORS.blocked;
      const vx = x - cam.x;
      const vy = y - cam.y;
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
    lastCam = cam;
    const buckets = [];
    for (let vy = -1; vy < screen.rows + BELOW; vy++) {
      for (let vx = -1; vx <= screen.cols; vx++) {
        const x = cam.x + vx;
        const y = cam.y + vy;
        if (world.inside(x, y)) collect(x, y, cam, buckets);
      }
    }
    mapView.clipped(() => {
      mapView.fill(COLORS.void);
      for (const list of buckets) {
        if (!list) continue;
        for (const it of list) {
          const { ox, oy } = shiftOf(it.h);
          mapView.drawShifted(it.vx, it.vy, ox, oy, it.glyph, it.fg, it.bg);
        }
      }
      drawMarks(cam, overlay);
      const p = groundShift(player.x, player.y);
      mapView.drawShifted(player.x - cam.x, player.y - cam.y, p.ox, p.oy, '@', COLORS.player, COLORS.bg);
    });
  }

  // 視窗格 → 世界格：滑鼠那一點（fy 是字元像素，沒給就用那格中心；只往上錯開，用不到 fx）
  // 最上面的地面是哪一格。找不到就用原位那格；世界外回傳 null
  function cellAt(cam, vx, vy, _fx, py = vy * 8 + 4) {
    let best = null;
    if (lastCam && lastCam.x === cam.x && lastCam.y === cam.y) {
      // 東西只往上錯開，所以只要往下找
      for (let y = cam.y + vy; y <= cam.y + vy + BELOW; y++) {
        const x = cam.x + vx;
        if (!world.inside(x, y)) continue;
        const h = groundHeight(world.tierAt(x, y));
        const top = (y - cam.y) * 8 + shiftOf(h).oy;
        if (py < top || py >= top + 8) continue;
        if (!best || h >= best.h) best = { x, y, h };
      }
    }
    const c = best ?? { x: cam.x + vx, y: cam.y + vy };
    return world.inside(c.x, c.y) ? { x: c.x, y: c.y } : null;
  }

  // 世界格 → 視窗格（路線標籤用）：跟著那格地面錯開，取最近的整格
  function screenOf(cam, x, y) {
    return { vx: x - cam.x, vy: y - cam.y + Math.round(groundShift(x, y).oy / 8) };
  }

  return { draw, cellAt, screenOf };
}
