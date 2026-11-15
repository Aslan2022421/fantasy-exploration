// 往上疊的畫法。錯開量只看高度（perspective.js），跟相機無關，所以地圖可以先畫好存起來：
// 世界切成 CHUNK×CHUNK 的分塊，每塊畫一次存成離屏圖層，之後只貼圖；相機位置是小數，每個畫面往目標靠近一點。
// - 分塊裡照高度由低到高畫（地面、牆、物件各層），同高時北邊先畫；東西會往右上錯開進隔壁的分塊，
//   所以畫一塊時連它下面幾列、左邊幾欄也一起畫
// - 牆的下層往低處那格的底色壓淡，物件的下層往腳下的底色壓淡
// - 冒險者、路線、目標每個畫面另外畫；冒險者附近比他頭頂高的樹冠再補畫一次，站在樹冠下會被蓋住
// 地圖內容改變時要呼叫 invalidate() 丟掉快取；只改了幾格（採集）用 invalidateCells

import { COLORS } from './colors.js';
import { drawMarks } from './marks.js';
import {
  approach,
  fadeAt,
  groundHeight,
  liftUp,
  objectLayers,
  PLAYER_LAYERS,
  shiftUp,
  slopeTilt,
  upShiftCells,
  wallSouth,
} from './perspective.js';
import { drawRoute } from './route.js';
import { dimColor, mixColor } from './shades.js';
import { fade, putCreature, putMine, putPeak } from './stackitems.js';

const CHUNK = 16; // 分塊邊長（格）
const MAX_CHUNKS = 160; // 快取最多留幾塊，超過丟最久沒用的
const PEAK_SPAN = 5; // 山峰剪影最多往上幾列、往左右幾格（worldview.js 的 PEAK.maxRows）
const COVER = { below: 3, left: 1 }; // 會蓋到冒險者的樹冠：往南幾格、往西幾格裡的

// look：{ ground(x, y) → { glyph, fg, bg }, object(x, y, o) → { glyph, fg, trunkGlyph, trunkFg, isTrunk }
// 或礦坑那一格的 { mine: true, glyph, fg, layers 疊幾層 }
export function createStackView(mapView, world, objects, look, { now = () => performance.now() } = {}) {
  const chunks = new Map(); // "cx,cy" → 圖層
  let view = null; // { x, y 相機左上（小數）, t 上次畫的時間 }

  function collect(x, y, buckets) {
    const g = look.ground(x, y);
    const o = world.objectAt(x, y);
    const cr = o < 0 ? world.creatureAt?.(x, y) : null;
    const h0 = groundHeight(world.tierAt(x, y));
    const glyph = o >= 0 || cr ? ' ' : g.glyph;
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
    // 斜坡（不是牆、不是山、不是水）：底下一層壓淡，上面一層往上坡那側偏，看得出往哪邊斜
    const slope = wall ? null : look.slope(x, y);
    if (slope) {
      put(h0, { glyph, fg: fade(g.fg, g.bg, fadeAt(1)), bg: g.bg });
      put(h0 + 1, { glyph, fg: g.fg, bg: g.bg, ground: h0, tilt: slope.gx });
    } else if (g.rise && o < 0) {
      // 山坡的 / \ 往上疊 rise 層（只畫字、不塗底色），下面幾層壓淡，像樹幹那樣立起來
      put(h0, { glyph, fg: fade(g.fg, g.bg, fadeAt(g.rise)), bg: g.bg });
      for (let i = 1; i <= g.rise; i++) put(h0 + i, { glyph, fg: fade(g.fg, g.bg, fadeAt(g.rise - i)), bg: null });
    } else put(h0, { glyph, fg: g.fg, bg: g.bg });
    const pk = look.peak?.(x, y);
    if (pk) putPeak(pk, x, h0, put);
    if (cr) {
      // 一隻只畫一個字：在錨點那格放大蓋滿佔地，其他格只留地面底色
      if (cr.member.x === x && cr.member.y === y) putCreature(look.creature(cr), x, h0, g.bg, put);
      return;
    }
    if (o < 0) return;
    const ol = look.object(x, y, o);
    if (ol.mine) {
      putMine(ol, x, h0, g.bg, put);
      return;
    }
    const layers = objectLayers(objects[o], ol.isTrunk);
    // 貼地的物件（矮叢、草本、樹樁）畫在地面最上面那層：斜坡多疊的那層有底色，畫在它下面會被蓋掉
    const flat = slope ? { h: h0 + 1, tilt: slope.gx } : { h: h0 };
    if (!layers.length) put(flat.h, { glyph: ol.glyph, fg: ol.fg, bg: null, ground: h0, tilt: flat.tilt });
    for (const l of layers) {
      const trunk = l.part === 'trunk';
      let color = trunk ? ol.trunkFg : ol.fg;
      const cap = ol.cap?.[l.j]; // 雪地或山上的樹：頂端幾層往地形顏色靠、越上面越亮
      if (cap) color = dimColor(mixColor(color, cap.color, cap.mix), cap.light);
      const fg = fade(color, g.bg, fadeAt(trunk ? Math.min(l.j, 1) : l.j)); // 樹幹最多壓淡一級，根部貼地看得到
      const item = {
        glyph: trunk ? ol.trunkGlyph : ol.glyph,
        fg,
        bg: null,
        ground: h0,
        lift: l.dh,
      };
      if (l.dh === 0) put(flat.h, { ...item, tilt: flat.tilt });
      else put(h0 + l.dh, { ...item, leaf: l.part === 'leaf' });
    }
  }

  // 這一項畫在哪：地面高度、往上幾層（物件），斜坡那層再往上坡偏；山峰剪影再往上整列
  function offsetOf(it, k) {
    const s = shiftOf(it.ground ?? it.h, it.lift ?? 0, k, it.px);
    if (it.rowsUp) s.oy -= it.rowsUp * 8;
    if (it.tilt === undefined) return s;
    const t = slopeTilt(it.tilt, k);
    return { ox: s.ox + t.ox, oy: s.oy + t.oy };
  }

  function renderChunk(cx, cy) {
    const layer = mapView.layer(CHUNK, CHUNK);
    const x0 = cx * CHUNK;
    const y0 = cy * CHUNK;
    const buckets = [];
    const k = layer.tile / 8;
    const below = upShiftCells(k) + 1; // 東西往右上錯開，往下、往左多畫幾格
    // 山峰剪影往上、往左右各延伸最多 PEAK_SPAN 格，旁邊分塊裡的山峰也要收進來
    for (let y = y0 - 1; y < y0 + CHUNK + below + PEAK_SPAN; y++) {
      for (let x = x0 - below; x <= x0 + CHUNK + PEAK_SPAN; x++) if (world.inside(x, y)) collect(x, y, buckets);
    }
    for (const list of buckets) {
      if (!list) continue;
      for (const it of list) {
        const { ox, oy } = offsetOf(it, k);
        layer.drawShifted(it.x - x0, it.y - y0, ox, oy, it.glyph, it.fg, it.bg, it.w, it.h2);
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
  function shiftOf(h, lift, k, px) {
    const a = shiftUp(h, k);
    const b = liftUp(lift, k, px);
    return { ox: a.ox + b.ox, oy: a.oy + b.oy };
  }

  // 世界格 (x, y) 的地面（或往上 lift 層）畫在地圖區哪裡（字元像素，左上角）
  function placeOf(f, x, y, h = groundHeight(world.tierAt(x, y)), lift = 0, px = undefined) {
    const { ox, oy } = shiftOf(h, lift, mapView.tile() / 8, px);
    return { px: (x - f.x) * 8 + ox, py: (y - f.y) * 8 + oy };
  }

  // 斜坡那層再加的偏移（跟 offsetOf 一樣）：tilt 沒給就不偏
  function tilted(p, tilt) {
    if (tilt === undefined) return p;
    const t = slopeTilt(tilt, mapView.tile() / 8);
    return { px: p.px + t.ox, py: p.py + t.oy };
  }

  // 冒險者附近比他頭頂高的樹冠，在冒險者之後再畫一次。樹冠往右上錯開，會蓋到冒險者的是他那格與南邊、西邊幾格的
  function coverPlayer(f, player, top) {
    const near = [];
    for (let y = player.y; y <= player.y + COVER.below; y++) {
      for (let x = player.x - COVER.left; x <= player.x; x++) if (world.inside(x, y)) collect(x, y, near);
    }
    for (const list of near) {
      if (!list) continue;
      for (const it of list) {
        if (!it.leaf || it.h <= top) continue;
        const { px, py } = placeOf(f, it.x, it.y, it.ground, it.lift);
        mapView.drawShifted(0, 0, px, py, it.glyph, it.fg, null);
      }
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
      drawMarks(
        mapView,
        world,
        objects,
        look,
        (x, y, h, lift, px, tilt) => tilted(placeOf(f, x, y, h, lift, px), tilt),
        overlay,
      );
      drawRoute(mapView, world, (x, y, h) => placeOf(f, x, y, h), overlay.route, player);
      // 冒險者疊 PLAYER_LAYERS 層，最底層在腳下那格的地面上，往上照地形的間距錯開；只畫字，下層往腳下底色壓淡
      const p0 = groundHeight(world.tierAt(player.x, player.y));
      const pg = look.ground(player.x, player.y).bg;
      for (let i = 0; i < PLAYER_LAYERS; i++) {
        const fg = fade(COLORS.player, pg, fadeAt(PLAYER_LAYERS - 1 - i));
        const { px, py } = placeOf(f, player.x, player.y, p0 + i);
        mapView.drawShifted(0, 0, px, py, '@', fg, null);
      }
      coverPlayer(f, player, p0 + PLAYER_LAYERS - 1);
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

  // 相機該到哪（左上角，可以是小數）：冒險者那格（含腳下地面往上錯開的量）落在地圖區正中間。
  // 不限制在世界裡，走到世界邊緣時外面是黑的
  function focus(screen, player) {
    const k = screen.tile / 8;
    const { ox, oy } = shiftUp(groundHeight(world.tierAt(player.x, player.y)), k);
    return {
      x: player.x + 0.5 + ox / 8 - screen.map.w / screen.tile / 2,
      y: player.y + 0.5 + oy / 8 - screen.map.h / screen.tile / 2,
    };
  }

  // 這幾格變了（採集）：丟掉它們所在與周圍的分塊。東西會錯開進隔壁分塊，所以連周圍一起丟
  function invalidateCells(cells) {
    for (const { x, y } of cells) {
      const cx = Math.floor(x / CHUNK);
      const cy = Math.floor(y / CHUNK);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) chunks.delete(`${cx + dx},${cy + dy}`);
    }
  }

  return { draw, cellAt, screenOf, focus, invalidate: () => chunks.clear(), invalidateCells };
}
