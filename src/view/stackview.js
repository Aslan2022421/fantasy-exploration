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
  liftUp,
  objectLayers,
  PLAYER_LAYERS,
  shiftUp,
  upShiftCells,
  wallSouth,
} from './perspective.js';
import { dimColor, mixColor } from './shades.js';

const CHUNK = 16; // 分塊邊長（格）
const MAX_CHUNKS = 160; // 快取最多留幾塊，超過丟最久沒用的
// 視野外壓暗：COLORS.dark 的 RGB。使用者說先關閉（on: false），程式留著
const SIGHT = { on: false, near: 9, far: 18, rgb: '8, 10, 12', alpha: 0.88 };
// 路線的亮度隨高度、線寬與虛線的 [畫, 空]（字元像素）
const PATH_LIGHT = { base: 0.75, perLayer: 0.025, max: 1.2, width: 1.5, dash: [3, 3], smooth: 2 };

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
      put(h0 + l.dh, { glyph: trunk ? ol.trunkGlyph : ol.glyph, fg, bg: null, ground: h0, lift: l.dh });
    }
  }

  function renderChunk(cx, cy) {
    const layer = mapView.layer(CHUNK, CHUNK);
    const x0 = cx * CHUNK;
    const y0 = cy * CHUNK;
    const buckets = [];
    const k = layer.tile / 8;
    const below = upShiftCells(k) + 1; // 東西往右上錯開，往下、往左多畫幾格
    for (let y = y0 - 1; y < y0 + CHUNK + below; y++) {
      for (let x = x0 - below; x <= x0 + CHUNK; x++) if (world.inside(x, y)) collect(x, y, buckets);
    }
    for (const list of buckets) {
      if (!list) continue;
      for (const it of list) {
        const { ox, oy } = shiftOf(it.ground ?? it.h, it.lift ?? 0, k);
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

  // 地面高度 h 的東西、再往上 lift 層（物件、冒險者）錯開多少字元像素
  function shiftOf(h, lift, k) {
    const a = shiftUp(h, k);
    const b = liftUp(lift, k);
    return { ox: a.ox + b.ox, oy: a.oy + b.oy };
  }

  // 世界格 (x, y) 的地面（或往上 lift 層）畫在地圖區哪裡（字元像素，左上角）
  function placeOf(f, x, y, h = groundHeight(world.tierAt(x, y)), lift = 0) {
    const { ox, oy } = shiftOf(h, lift, mapView.tile() / 8);
    return { px: (x - f.x) * 8 + ox, py: (y - f.y) * 8 + oy };
  }

  // 目標、查看中的格子：整格標底色，畫在那格地面錯開後的位置
  function drawMarks(f, { route, target, examined }) {
    for (const c of [examined, target]) {
      if (!c || !world.inside(c.x, c.y)) continue;
      const { px, py } = placeOf(f, c.x, c.y);
      const isTarget = target?.x === c.x && target?.y === c.y;
      const bg = isTarget ? (route?.reachable ? COLORS.target : COLORS.blocked) : COLORS.examined;
      const o = world.objectAt(c.x, c.y);
      const g = o >= 0 ? look.object(c.x, c.y, o) : look.ground(c.x, c.y);
      const trunk = o >= 0 && g.isTrunk;
      mapView.drawShifted(0, 0, px, py, trunk ? g.trunkGlyph : g.glyph, trunk ? g.trunkFg : g.fg, bg);
    }
  }

  // 路線（使用者要虛線）：從冒險者連到每一步的中心，跟著每格地面的高度錯開，
  // 越高的那段越亮（PATH_LIGHT），上下坡看得出來；虛線花紋一段接一段連下去
  function drawRoute(f, route, player) {
    if (!route?.steps.length) return;
    // 每一點的高度取前後 PATH_LIGHT.smooth 格的平均，爬坡時線慢慢升上去，不會在一格內突然折上去
    const cells = [player, ...route.steps];
    const raw = cells.map((c) => groundHeight(world.tierAt(c.x, c.y)));
    const r = PATH_LIGHT.smooth;
    const pts = cells.map((c, i) => {
      const near = raw.slice(Math.max(0, i - r), i + r + 1);
      const h = near.reduce((a, v) => a + v, 0) / near.length;
      const { px, py } = placeOf(f, c.x, c.y, h);
      return { x: px + 4, y: py + 4, h };
    });
    let walked = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const k = Math.min(PATH_LIGHT.max, PATH_LIGHT.base + PATH_LIGHT.perLayer * Math.max(a.h, b.h));
      mapView.line(a.x, a.y, b.x, b.y, dimColor(COLORS.path, k), PATH_LIGHT.width, PATH_LIGHT.dash, walked);
      walked += Math.hypot(b.x - a.x, b.y - a.y);
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
      mapView.fill(COLORS.dark);
      const cx0 = Math.max(0, Math.floor(f.x / CHUNK));
      const cy0 = Math.max(0, Math.floor(f.y / CHUNK));
      const cx1 = Math.min(Math.ceil(world.width / CHUNK) - 1, Math.floor((f.x + screen.cols) / CHUNK));
      const cy1 = Math.min(Math.ceil(world.height / CHUNK) - 1, Math.floor((f.y + screen.rows) / CHUNK));
      for (let cy = cy0; cy <= cy1; cy++) {
        for (let cx = cx0; cx <= cx1; cx++)
          mapView.blit(chunkAt(cx, cy), (cx * CHUNK - f.x) * 8, (cy * CHUNK - f.y) * 8);
      }
      // 視野外壓暗（使用者定）：以冒險者為中心，SIGHT.near 格內不變，到 SIGHT.far 格漸漸蓋上接近純黑的顏色；
      // 不完全蓋死，亮的山脊與牆還留一點輪廓。還沒有真的視野計算，先用距離
      const p0 = groundHeight(world.tierAt(player.x, player.y));
      const pc = placeOf(f, player.x, player.y, p0);
      if (SIGHT.on) mapView.vignette(pc.px + 4, pc.py + 4, SIGHT.near * 8, SIGHT.far * 8, SIGHT.rgb, SIGHT.alpha);
      drawMarks(f, overlay); // 目標、查看與路線畫在壓暗之上，遠處也看得到
      drawRoute(f, overlay.route, player);
      // 冒險者：疊 PLAYER_LAYERS 層，最底層就在腳下那格的地面上，往上每層照地形的間距（4 像素）錯開，
      // 看得出站在哪一格；不用樹的 8 像素（那樣頂層會跑到隔壁格）。只畫字，下層往腳下底色壓淡
      const pg = look.ground(player.x, player.y).bg;
      for (let i = 0; i < PLAYER_LAYERS; i++) {
        const fg = fade(COLORS.player, pg, fadeAt(PLAYER_LAYERS - 1 - i));
        const { px, py } = placeOf(f, player.x, player.y, p0 + i);
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
    const below = upShiftCells(mapView.tile() / 8) + 1;
    let best = null;
    for (let y = gy; y <= gy + below; y++) {
      for (let x = gx - below; x <= gx; x++) {
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

  // 相機該到哪（左上角，可以是小數）：冒險者那格的中心，加上腳下地面往上錯開的量，剛好落在地圖區正中間。
  // 不限制在世界裡，走到世界邊緣時外面是黑的，冒險者照樣在正中間（使用者要角色置中）
  function focus(screen, player) {
    const k = screen.tile / 8;
    const { ox, oy } = shiftUp(groundHeight(world.tierAt(player.x, player.y)), k);
    return {
      x: player.x + 0.5 + ox / 8 - screen.map.w / screen.tile / 2,
      y: player.y + 0.5 + oy / 8 - screen.map.h / screen.tile / 2,
    };
  }

  return { draw, cellAt, screenOf, focus, invalidate: () => chunks.clear() };
}
