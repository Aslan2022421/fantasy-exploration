// H 視窗：上方頁籤（紀錄、世界歷史、生涯、圖鑑），內容照頁畫（資料在 chronicle-view.js）。
// 紀錄、世界歷史是捲動的年表；生涯是數字卡加自己的年表；圖鑑左邊是選中物種的資訊、右邊是見過的清單。
// 回傳 { tabs, rows（圖鑑清單的點擊範圍）, maxScroll }

import { bestiary, HISTORY_TABS, lifePage, worldHistory } from './chronicle-view.js';
import { COLORS } from './colors.js';
import { drawHelp, drawList, drawTabs, drawTile, split } from './ui-kit.js';

const HELP = {
  scroll: 'Tab 或點頁籤換頁　滾輪或 ↑↓ 捲動　H 或 Esc 關閉',
  bestiary: 'Tab 或點頁籤換頁　↑↓ 或滑鼠選物種　H 或 Esc 關閉',
};

// ui：{ tab, scroll: [各頁捲到哪], cursor（圖鑑選第幾種）}；entries() 是紀錄頁的內容
export function drawHistory(ctx, s, panels, env, ui, body) {
  const { game, world, data, entries } = env;
  const t = drawTabs(ctx, s, panels, body, HISTORY_TABS, ui.tab);
  const out = { tabs: t.hits, rows: [], maxScroll: 0 };
  if (ui.tab === 3) {
    const b = drawHelp(ctx, s, panels, t.body, HELP.bestiary);
    const list = bestiary(game.chronicle, world, data);
    const { left, right } = split(ctx, s, b, 0.45);
    const total = data.species.length;
    panels.text(ctx, s, `見過 ${list.length}／${total} 種`, right.x, right.y, COLORS.head);
    const listRect = { ...right, y: right.y + s.lineHeight * 1.8, h: right.h - s.lineHeight * 1.8 };
    const rows = list.map((sp) => ({
      text: sp.name,
      mark: sp.glyph,
      markColor: sp.color,
      note: sp.kills ? `打倒 ${sp.kills}` : '',
    }));
    out.rows = drawList(ctx, s, panels, listRect, rows, ui.cursor).hits;
    const cur = list[Math.min(ui.cursor, list.length - 1)];
    if (!cur) {
      panels.text(ctx, s, '還沒有見過任何生物。走近一群生物就會記下來。', left.x, left.y, COLORS.dim);
      return out;
    }
    panels.text(ctx, s, `${cur.glyph}　${cur.name}`, left.x, left.y, cur.color);
    let y = left.y + s.lineHeight * 1.8;
    for (const line of cur.info) y += panels.para(ctx, s, line.text, left.x, y, left.w, line.color ?? COLORS.text);
    return out;
  }
  const b = drawHelp(ctx, s, panels, t.body, HELP.scroll);
  if (ui.tab === 2) {
    const life = lifePage(game.chronicle, game.state);
    panels.text(ctx, s, life.title, b.x, b.y, COLORS.head);
    // 數字卡：一列 6 張
    const per = 6;
    const gap = s.pad * 3;
    const tw = Math.floor((b.w - gap * (per - 1)) / per);
    const th = s.lineHeight * 2 + s.pad * 2;
    const ty = b.y + s.lineHeight * 1.6;
    life.tiles.forEach(([label, value], i) => {
      const rect = { x: b.x + (i % per) * (tw + gap), y: ty + Math.floor(i / per) * (th + gap), w: tw, h: th };
      drawTile(ctx, s, panels, rect, label, value);
    });
    const rowsTop = ty + Math.ceil(life.tiles.length / per) * (th + gap) + s.lineHeight * 0.5;
    panels.text(ctx, s, '你的年表', b.x, rowsTop, COLORS.head);
    const rect = { x: b.x, y: rowsTop + s.lineHeight * 1.5, w: b.w, h: b.y + b.h - rowsTop - s.lineHeight * 1.5 };
    out.maxScroll = panels.lines(ctx, s, rect, life.rows, ui.scroll[2]);
    return out;
  }
  const rows = ui.tab === 0 ? entries() : worldHistory(game.chronicle);
  out.maxScroll = panels.lines(ctx, s, b, rows, ui.scroll[ui.tab]);
  return out;
}
