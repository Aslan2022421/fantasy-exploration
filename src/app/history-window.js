// H 視窗：Tab 或點頁籤換頁（紀錄、世界歷史、生涯、圖鑑）；紀錄與世界歷史打開時捲到最新，生涯從頭看；
// 圖鑑 ↑↓ 或點清單選物種。回傳 windows.js 的 history、historyKey、historyClick、historyScroll、historyTitle、historyOpen

import { bestiary, HISTORY_TABS } from '../view/chronicle-view.js';
import { drawHistory } from '../view/history-view.js';
import { inside } from '../view/ui-kit.js';

const END = Number.MAX_SAFE_INTEGER;

export function historyWindow(env) {
  const ui = { tab: 0, scroll: [END, END, 0, 0], cursor: 0 };
  let hits = { tabs: [], rows: [], maxScroll: 0 };
  const show = (tab) => {
    ui.tab = tab;
    ui.scroll[tab] = tab < 2 ? END : 0;
  };
  const scroll = (d) => {
    ui.scroll[ui.tab] = Math.max(0, Math.min(hits.maxScroll, Math.min(ui.scroll[ui.tab], hits.maxScroll) + d));
  };
  const species = () => bestiary(env.game.chronicle, env.world, env.data).length;

  return {
    history(c, s, body) {
      if (ui.tab === 3) ui.cursor = Math.max(0, Math.min(ui.cursor, species() - 1));
      hits = drawHistory(c, s, env.panels, env, ui, body);
      ui.scroll[ui.tab] = Math.min(ui.scroll[ui.tab], hits.maxScroll);
    },
    historyOpen: () => show(ui.tab),
    historyTitle: () => '紀錄與歷史（H 或 Esc 關閉）',
    historyKey(code) {
      if (code === 'Tab') show((ui.tab + 1) % HISTORY_TABS.length);
      else if (code === 'ArrowUp' || code === 'ArrowDown') {
        const d = code === 'ArrowUp' ? -1 : 1;
        if (ui.tab === 3) {
          const n = species();
          if (n) ui.cursor = (ui.cursor + d + n) % n;
        } else scroll(d);
      } else if (code === 'PageUp' || code === 'PageDown') scroll(code === 'PageUp' ? -10 : 10);
      else return false;
      return true;
    },
    historyScroll: (d) => (ui.tab === 3 ? null : scroll(d)),
    historyClick(x, y) {
      const tab = hits.tabs.find((r) => inside(r.rect, x, y));
      if (tab) return show(tab.i);
      const row = hits.rows.find((r) => inside(r.rect, x, y));
      if (row) ui.cursor = row.i;
    },
  };
}
