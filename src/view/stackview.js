// 往斜上方疊的畫法（預設；使用者選 B 再要斜上方）。錯開量只看高度（perspective.js 的 shiftUp），跟相機在哪無關，
// 所以地圖可以先畫好存起來：世界切成 CHUNK×CHUNK 的分塊，每塊畫一次存成離屏圖層，之後只貼圖。
// 相機平滑緩衝：相機位置是小數，每個畫面往目標靠近一點，整張圖只平移（不會頓、畫面裡沒有東西互相錯動）。
// - 分塊裡照高度由低到高畫（地面、牆、物件各層），同高時北邊先畫、南邊後畫；
//   東西會往右上錯開進隔壁的分塊，所以畫一塊時連它下面幾列、左邊幾欄也一起畫，超出的部分自然被裁掉
// - 牆的下層往低處那格的底色壓淡，物件的下層往腳下的底色壓淡
// - 冒險者、路線、目標每個畫面另外畫在最上面（不進快取），所以冒險者不會被樹擋住
// 地圖內容改變（之後砍樹之類）時要呼叫 invalidate() 丟掉快取

import { COLORS } from './colors.js';
import {
  approach,
  fadeAt,
  groundHeight,
  objectLayers,
  PLAYER_LAYERS,
  shiftUp,
  UP_SHIFT_CELLS,
  wallSouth,
} from './perspective.js';
import { mixColor } from './shades.js';

const CHUNK = 16; // 分塊邊長（格）
const BELOW = UP_SHIFT_CELLS + 1; // 畫一塊時往下、往左多畫幾格
const MAX_CHUNKS = 160; // 快取最多留幾塊，超過丟最久沒用的

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
  const chunks = new Map(); // "cx,cy" → 圖層
  let view = null; // { x, y 相機左上（小數）, t 上次畫的時間 }

  function collect(x, y, buckets) {
    const g = look.ground(x, y);
    const o = world.objectAt(x, y);
    const h0 = groundHeight(world.tierAt(x, y));
    const glyph = o >= 0 ? ' ' : g.glyph;
    const put = (h, item) => {
      if (!buckets[h]) buckets[h] = [];
      buckets[h].push({ x, y, h, ...item });
    };
    const wall = wallSouth(world, x, y);
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

  function renderChunk(cx, cy) {
    const layer = mapView.layer(CHUNK, CHUNK);
    const x0 = cx * CHUNK;
    const y0 = cy * CHUNK;
    const buckets = [];
    for (let y = y0 - 1; y < y0 + CHUNK + BELOW; y++) {
      for (let x = x0 - BELOW; x <= x0 + CHUNK; x++) if (world.inside(x, y)) collect(x, y, buckets);
    }
    for (const list of buckets) {
      if (!list) continue;
      for (const it of list) {
        const { ox, oy } = shiftUp(it.h);
        layer.drawShifted(it.x - x0, it.y - y0, ox, oy, it.glyph, it.fg, it.bg);
      }
    }
    return layer;
  }

  function chunkAt(cx, cy) {
    const key = `${cx},${cy}`;
    let layer = chunks.get(key);
    if (layer && layer.tile !== mapView.tile()) layer = null; // 格子大小變了
    if (layer)
      chunks.delete(key); // 重新放到最後＝最近用過
    else layer = renderChunk(cx, cy);
    chunks.set(key, layer);
    if (chunks.size > MAX_CHUNKS) chunks.delete(chunks.keys().next().value);
    return layer;
  }

  // 世界格 (x, y) 的地面畫在地圖區哪裡（字元像素，左上角）
  function placeOf(f, x, y, h = groundHeight(world.tierAt(x, y))) {
    const { ox, oy } = shiftUp(h);
    return { px: (x - f.x) * 8 + ox, py: (y - f.y) * 8 + oy };
  }

  // 路線、目標、查看中的格子：畫在那格地面錯開後的位置
  function drawMarks(f, { route, target, examined }) {
    const marks = new Map();
    for (const s of route?.steps ?? []) marks.set(`${s.x},${s.y}`, s);
    for (const c of [examined, target]) if (c) marks.set(`${c.x},${c.y}`, c);
    for (const { x, y } of marks.values()) {
      if (!world.inside(x, y)) continue;
      const { px, py } = placeOf(f, x, y);
      const isTarget = target?.x === x && target?.y === y;
      const isExamined = examined?.x === x && examined?.y === y;
      let bg = look.ground(x, y).bg;
      if (isExamined) bg = COLORS.examined;
      if (isTarget) bg = route?.reachable ? COLORS.target : COLORS.blocked;
      if (isTarget || isExamined) {
        const o = world.objectAt(x, y);
        const g = o >= 0 ? look.object(x, y, o) : look.ground(x, y);
        const trunk = o >= 0 && g.isTrunk;
        mapView.drawShifted(0, 0, px, py, trunk ? g.trunkGlyph : g.glyph, trunk ? g.trunkFg : g.fg, bg);
      } else mapView.drawShifted(0, 0, px, py, '•', COLORS.path, bg);
    }
  }

  // 畫一次。cam 是相機該到的位置（整數）；相機還在半路上回傳 true，呼叫的人下一個畫面再畫
  function draw(screen, cam, overlay) {
    const { player } = overlay;
    const t = now();
    if (!view) view = { x: cam.x, y: cam.y, t };
    const dt = Math.min(100, t - view.t);
    view = { x: approach(view.x, cam.x, dt), y: approach(view.y, cam.y, dt), t };
    const f = view;
    mapView.clipped(() => {
      mapView.fill(COLORS.void);
      const cx0 = Math.max(0, Math.floor(f.x / CHUNK));
      const cy0 = Math.max(0, Math.floor(f.y / CHUNK));
      const cx1 = Math.min(Math.ceil(world.width / CHUNK) - 1, Math.floor((f.x + screen.cols) / CHUNK));
      const cy1 = Math.min(Math.ceil(world.height / CHUNK) - 1, Math.floor((f.y + screen.rows) / CHUNK));
      for (let cy = cy0; cy <= cy1; cy++) {
        for (let cx = cx0; cx <= cx1; cx++)
          mapView.blit(chunkAt(cx, cy), (cx * CHUNK - f.x) * 8, (cy * CHUNK - f.y) * 8);
      }
      drawMarks(f, overlay);
      // 冒險者：從腳下地面往上疊 PLAYER_LAYERS 層，只畫字，下層往腳下底色壓淡
      const pg = look.ground(player.x, player.y).bg;
      const p0 = groundHeight(world.tierAt(player.x, player.y));
      for (let dh = 1; dh <= PLAYER_LAYERS; dh++) {
        const fg = fade(COLORS.player, pg, fadeAt(PLAYER_LAYERS - dh));
        const { px, py } = placeOf(f, player.x, player.y, p0 + dh);
        mapView.drawShifted(0, 0, px, py, '@', fg, null);
      }
    });
    return view.x !== cam.x || view.y !== cam.y;
  }

  // 視窗格 → 世界格：滑鼠那一點（fx、fy 是地圖區的字元像素，沒給就用那格中心）最上面的地面是哪一格。
  // 東西只往右上錯開，所以只往左下找；找不到就用原位那格；世界外回傳 null
  function cellAt(cam, vx, vy, fx = vx * 8 + 4, fy = vy * 8 + 4) {
    const f = view ?? cam;
    const gx = Math.floor(f.x + fx / 8);
    const gy = Math.floor(f.y + fy / 8);
    let best = null;
    for (let y = gy; y <= gy + BELOW; y++) {
      for (let x = gx - BELOW; x <= gx; x++) {
        if (!world.inside(x, y)) continue;
        const { px, py } = placeOf(f, x, y);
        if (fx < px || fx >= px + 8 || fy < py || fy >= py + 8) continue;
        const h = groundHeight(world.tierAt(x, y));
        if (!best || h >= best.h) best = { x, y, h };
      }
    }
    const c = best ?? { x: gx, y: gy };
    return world.inside(c.x, c.y) ? { x: c.x, y: c.y } : null;
  }

  // 世界格 → 視窗格（路線標籤用，可以是小數）
  function screenOf(cam, x, y) {
    const { px, py } = placeOf(view ?? cam, x, y);
    return { vx: px / 8, vy: py / 8 };
  }

  return { draw, cellAt, screenOf, invalidate: () => chunks.clear() };
}
