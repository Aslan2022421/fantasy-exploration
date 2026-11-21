// M 視窗：上方頁籤（附近、整個世界），左邊地圖（asciimap.js），右邊是地圖上的地方清單、選中那個地方的現況、圖例。
// 點地圖上的地方或清單選它，選中的在地圖上框起來。回傳 { tabs, rows, map: { f, places, cell } }

import { placeSummary, regionLabel } from '../world/place.js';
import { LEGEND } from './asciimap.js';
import { INK } from './asciimap-cells.js';
import { COLORS } from './colors.js';
import { drawHelp, drawList, drawTabs } from './ui-kit.js';

export const MAP_TABS = ['附近', '整個世界'];
const HELP = 'Tab 或點頁籤換頁　↑↓ 或點地圖、清單選地方　M 或 Esc 關閉';
const DIRS = ['東', '東南', '南', '西南', '西', '西北', '北', '東北'];
const GLYPH = {
  村莊: ['⌂', INK.village],
  城鎮: ['■', INK.town],
  城市: ['◘', INK.city],
  堡壘: ['╫', INK.fort],
  要塞: ['╫', INK.fort],
};

// 從冒險者那一區看過去：「東北 3 區」「這一區」
function whereFrom(p, pz) {
  const dx = p.zx - pz.zx;
  const dy = p.zy - pz.zy;
  if (!dx && !dy) return '這一區';
  const dir = DIRS[(Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) % 8];
  return `${dir} ${Math.max(Math.abs(dx), Math.abs(dy))} 區`;
}

// env：{ game, world, data, asciiMap, camera() }；ui：{ tab, cursor, clicked（點到沒有地方的那格的說明）}
export function drawMap(ctx, s, panels, env, ui, body) {
  const { game, world, data, asciiMap } = env;
  const t = drawTabs(ctx, s, panels, body, MAP_TABS, ui.tab);
  const b = drawHelp(ctx, s, panels, t.body, HELP);
  const p = game.state.player;
  const map =
    ui.tab === 0
      ? asciiMap.drawRegion(ctx, s, b, p, env.camera(), game.log.size)
      : asciiMap.drawWorld(ctx, s, b, p, game.chronicle.known());
  const pz = { zx: Math.floor(p.x / world.zoneSize), zy: Math.floor(p.y / world.zoneSize) };
  const places = map.places.map((pl) => ({ ...pl, where: whereFrom(pl, pz) }));
  places.sort((a, c) => Math.hypot(a.zx - pz.zx, a.zy - pz.zy) - Math.hypot(c.zx - pz.zx, c.zy - pz.zy));
  const cur = places[Math.min(ui.cursor, places.length - 1)];
  if (cur) asciiMap.highlight(ctx, map.f, cur.i, cur.j);

  const rx = map.f.rx;
  const rw = b.x + b.w - rx;
  let y = b.y;
  panels.text(ctx, s, `你在${regionLabel(world, data, p.x, p.y)}`, rx, y, COLORS.text);
  y += s.lineHeight * 1.6;
  panels.text(ctx, s, `地圖上的地方（${places.length}）`, rx, y, COLORS.head);
  y += s.lineHeight * 1.4;
  const listH = Math.min(places.length, 8) * Math.round(s.lineHeight * 1.3) || s.lineHeight;
  const rows = places.map((pl) => {
    const [mark, markColor] = pl.heard
      ? ['?', INK.nest]
      : pl.nest
        ? ['☼', INK.nest]
        : (GLYPH[pl.kind] ?? ['⌂', INK.village]);
    return { text: `${pl.name}`, mark, markColor, note: pl.where };
  });
  const l = drawList(ctx, s, panels, { x: rx, y, w: rw, h: listH }, rows, ui.cursor);
  if (!places.length) panels.text(ctx, s, '附近沒有聚落或據點。', rx, y, COLORS.dim);
  y += listH + s.lineHeight;

  // 選中的地方（或點到的那一格）
  const info = ui.clicked
    ? [ui.clicked]
    : cur
      ? [`${cur.name}（${cur.kind}，${cur.where}）`, cur.heard ? `還沒去過，只聽說過。` : placeSummary(world, cur)]
      : [];
  info.forEach((line, i) => {
    y += panels.para(ctx, s, line, rx, y, rw, i ? COLORS.text : COLORS.head);
  });
  y += s.lineHeight;

  // 圖例：兩欄
  const colW = Math.floor(rw / 2);
  const rowsLeft = Math.ceil(LEGEND.length / 2);
  LEGEND.forEach(([ch, fg, name], i) => {
    const lx = rx + (i < rowsLeft ? 0 : colW);
    const ly = y + (i % rowsLeft) * s.lineHeight;
    if (ly + s.lineHeight > b.y + b.h) return;
    asciiMap.tiles.draw(ctx, ch, lx, ly + 2, 16, fg, null);
    panels.text(ctx, s, name, lx + 24, ly);
  });
  return { tabs: t.hits, rows: l.hits, map, places };
}
