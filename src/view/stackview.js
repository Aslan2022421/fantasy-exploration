// 多層次視差堆疊的畫法（perspective.js 算層、錯開量與壓淡，這裡照高度由低到高畫上畫布）。
// - 相機平滑緩衝：相機位置與原點（角色腳下的高度）都是小數，每畫一次往目標靠近一點；
//   還沒到位時 draw 回傳 true，呼叫的人下一個畫面再畫一次
// - 每格收集要畫的東西（地面、牆、物件各層、玩家），照高度分桶，低的先畫、高的後畫
// - 先在原位鋪一層地面底色，錯開後露出來的縫是附近地面的顏色，不是地圖外的深色
// - 牆的下層往低處那格的底色壓淡，物件與玩家的下層往腳下的底色壓淡
// 路線、目標都畫在那格地面錯開後的位置；滑鼠點格子時，找畫面上那一點最上面的地面是哪一格

import { COLORS } from './colors.js';
import {
  approach,
  fadeAt,
  groundHeight,
  MAX_SHIFT_CELLS,
  objectLayers,
  PLAYER_LAYERS,
  shiftOf,
  wallRange,
} from './perspective.js';
import { mixColor } from './shades.js';

const MARGIN = MAX_SHIFT_CELLS + 1; // 地圖區外多收幾格，錯開與相機在半路上時邊緣才補得滿
const PICK = MAX_SHIFT_CELLS + 1; // 點格子時往四周找幾格

const fadeCache = new Map();
// a 往 b 壓淡 f（0 不變、1 變成 b）
function fade(a, b, f) {
  if (!f) return a;
  const key = `${a}|${b}|${f}`;
  let out = fadeCache.get(key);
  if (!out) {
    out = mixColor(a, b, f);
    fadeCache.set(key, out);
  }
  return out;
}

// look：{ ground(x, y) → { glyph, fg, bg }, object(x, y, o) → { glyph, fg, trunkGlyph, trunkFg, isTrunk } }
export function createStackView(mapView, world, objects, look, { now = () => performance.now() } = {}) {
  let view = null; // { x, y 相機左上（小數）, R 原點高度（小數）, t 上次畫的時間 }
  let frame = null; // 上一次畫的位置：點格子、路線標籤用

  function collect(x, y, f, buckets) {
    const g = look.ground(x, y);
    const o = world.objectAt(x, y);
    const at = { x, y };
    const h0 = groundHeight(world.tierAt(x, y));
    const glyph = o >= 0 ? ' ' : g.glyph;
    const put = (h, item) => {
      if (!buckets[h]) buckets[h] = [];
      buckets[h].push({ ...at, h, ...item });
    };
    const wall = wallRange(world, f.cx, f.cy, x, y);
    if (wall) {
      const lowBg = look.ground(wall.low.x, wall.low.y).bg;
      for (let h = wall.from; h <= wall.to; h++) {
        const k = fadeAt(h0 - h);
        put(h, { glyph, fg: fade(g.fg, lowBg, k), bg: fade(g.bg, lowBg, k) });
      }
    }
    put(h0, { glyph, fg: g.fg, bg: g.bg });
    if (o < 0) return;
    const ol = look.object(x, y, o);
    const layers = objectLayers(objects[o], ol.isTrunk);
    if (!layers.length) put(h0, { glyph: ol.glyph, fg: ol.fg, bg: null });
    for (const l of layers) {
      const trunk = l.part === 'trunk';
      const fg = fade(trunk ? ol.trunkFg : ol.fg, g.bg, fadeAt(l.j));
      put(h0 + l.dh, { glyph: trunk ? ol.trunkGlyph : ol.glyph, fg, bg: null });
    }
  }

  // 世界格 (x, y) 高度 h 的東西畫在哪：相對地圖區的字元像素（左上角）
  function placeOf(f, x, y, h) {
    const { ox, oy } = shiftOf(x - f.cx, y - f.cy, h - f.R);
    return { px: (x - f.x) * 8 + ox, py: (y - f.y) * 8 + oy };
  }

  function drawAt(f, x, y, h, glyph, fg, bg) {
    const { px, py } = placeOf(f, x, y, h);
    mapView.drawShifted(0, 0, px, py, glyph, fg, bg);
  }

  // 路線、目標、查看中的格子：畫在那格地面錯開後的位置，蓋過疊層
  function drawMarks(f, { route, target, examined }) {
    const marks = new Map();
    for (const s of route?.steps ?? []) marks.set(`${s.x},${s.y}`, s);
    for (const c of [examined, target]) if (c) marks.set(`${c.x},${c.y}`, c);
    for (const { x, y } of marks.values()) {
      if (!world.inside(x, y)) continue;
      const h = groundHeight(world.tierAt(x, y));
      const isTarget = target?.x === x && target?.y === y;
      const isExamined = examined?.x === x && examined?.y === y;
      let bg = look.ground(x, y).bg;
      if (isExamined) bg = COLORS.examined;
      if (isTarget) bg = route?.reachable ? COLORS.target : COLORS.blocked;
      if (isTarget || isExamined) {
        const o = world.objectAt(x, y);
        const g = o >= 0 ? look.object(x, y, o) : look.ground(x, y);
        const trunk = o >= 0 && g.isTrunk;
        drawAt(f, x, y, h, trunk ? g.trunkGlyph : g.glyph, trunk ? g.trunkFg : g.fg, bg);
      } else drawAt(f, x, y, h, '•', COLORS.path, bg);
    }
  }

  // 畫一次。cam 是相機該到的位置（整數），相機與原點會平滑地靠過去；還沒到位回傳 true
  function draw(screen, cam, overlay) {
    const { player } = overlay;
    const R = groundHeight(world.tierAt(player.x, player.y));
    const t = now();
    if (!view) view = { x: cam.x, y: cam.y, R, t };
    const dt = Math.min(100, t - view.t);
    view = { x: approach(view.x, cam.x, dt), y: approach(view.y, cam.y, dt), R: approach(view.R, R, dt), t };
    const f = {
      x: view.x,
      y: view.y,
      cx: view.x + Math.floor(screen.cols / 2), // 相機在畫面中心正上方
      cy: view.y + Math.floor(screen.rows / 2),
      R: view.R,
    };
    frame = f;
    const x0 = Math.floor(f.x);
    const y0 = Math.floor(f.y);
    const buckets = [];
    const under = [];
    for (let y = y0 - MARGIN; y < y0 + screen.rows + MARGIN; y++) {
      for (let x = x0 - MARGIN; x < x0 + screen.cols + MARGIN; x++) {
        if (!world.inside(x, y)) continue;
        under.push({ x, y, bg: look.ground(x, y).bg });
        collect(x, y, f, buckets);
      }
    }
    // 玩家：從腳下地面往上疊 PLAYER_LAYERS 層，只畫字，下層往腳下底色壓淡
    const pg = look.ground(player.x, player.y).bg;
    const p0 = groundHeight(world.tierAt(player.x, player.y));
    for (let dh = 1; dh <= PLAYER_LAYERS; dh++) {
      const h = p0 + dh;
      if (!buckets[h]) buckets[h] = [];
      buckets[h].push({
        x: player.x,
        y: player.y,
        h,
        glyph: '@',
        fg: fade(COLORS.player, pg, fadeAt(PLAYER_LAYERS - dh)),
        bg: null,
      });
    }
    mapView.clipped(() => {
      mapView.fill(COLORS.void);
      for (const u of under) mapView.drawShifted(0, 0, (u.x - f.x) * 8, (u.y - f.y) * 8, ' ', null, u.bg);
      for (const list of buckets) {
        if (!list) continue;
        for (const it of list) drawAt(f, it.x, it.y, it.h, it.glyph, it.fg, it.bg);
      }
      drawMarks(f, overlay);
    });
    return view.x !== cam.x || view.y !== cam.y || view.R !== R;
  }

  // 視窗格 → 世界格：滑鼠那一點（fx、fy 是地圖區的字元像素，沒給就用那格中心）最上面的地面是哪一格。
  // 找不到就用相機原位推算的那格；世界外回傳 null
  function cellAt(cam, vx, vy, fx = vx * 8 + 4, fy = vy * 8 + 4) {
    const f = frame ?? { x: cam.x, y: cam.y, cx: cam.x, cy: cam.y, R: 0 };
    const gx = Math.floor(f.x + fx / 8);
    const gy = Math.floor(f.y + fy / 8);
    let best = null;
    for (let y = gy - PICK; y <= gy + PICK; y++) {
      for (let x = gx - PICK; x <= gx + PICK; x++) {
        if (!world.inside(x, y)) continue;
        const h = groundHeight(world.tierAt(x, y));
        const { px, py } = placeOf(f, x, y, h);
        if (fx < px || fx >= px + 8 || fy < py || fy >= py + 8) continue;
        if (!best || h >= best.h) best = { x, y, h };
      }
    }
    const c = best ?? { x: gx, y: gy };
    return world.inside(c.x, c.y) ? { x: c.x, y: c.y } : null;
  }

  // 世界格 → 視窗格（路線標籤用，可以是小數）：跟著那格地面錯開
  function screenOf(cam, x, y) {
    const f = frame ?? { x: cam.x, y: cam.y, cx: cam.x, cy: cam.y, R: 0 };
    const { px, py } = placeOf(f, x, y, groundHeight(world.tierAt(x, y)));
    return { vx: px / 8, vy: py / 8 };
  }

  return { draw, cellAt, screenOf };
}
