// B 視窗：上方頁籤「裝備」（換上背包裡的裝備，gear-view.js）、「製作」（製造、修理、熔煉、補給品，craft-view.js）；
// Tab 或點頁籤換頁，製作頁 ← → 或點分類換篩選。回傳 windows.js 的 bag、bagKey、bagClick、bagTitle

import { CRAFT_FILTERS, craftRows, drawCraft, filtered } from '../view/craft-view.js';
import { drawGear, gearItems } from '../view/gear-view.js';
import { drawTabs, inside } from '../view/ui-kit.js';

const PAGES = ['裝備', '製作'];

export function bagWindow({ panels, game, data, actions }) {
  let page = 0;
  const ui = [{ cursor: 0 }, { cursor: 0, filter: 0 }];
  let hits = { rows: [], filters: [], tabs: [] };
  const rows = () => filtered(craftRows(data, game.state, game.nearAnvil()), ui[1].filter);
  // 這一頁能選的東西：裝備頁是背包裡的裝備 id，製作頁是篩選後的項目
  const choices = () => (page === 0 ? gearItems(data, game.state.hero) : rows());
  const run = (choice) => {
    if (!choice) return;
    if (page === 0) actions().bag('equip', choice);
    else if (choice.ok) actions().bag(choice.kind, choice.key);
  };
  const setFilter = (f) => {
    ui[1].filter = (f + CRAFT_FILTERS.length) % CRAFT_FILTERS.length;
    ui[1].cursor = 0;
  };

  return {
    bag(c, s, body) {
      const n = choices().length;
      ui[page].cursor = Math.max(0, Math.min(ui[page].cursor, n - 1));
      const t = drawTabs(c, s, panels, body, PAGES, page);
      const h =
        page === 0
          ? drawGear(c, s, panels, data, game.state, ui[0], t.body)
          : drawCraft(c, s, panels, craftRows(data, game.state, game.nearAnvil()), ui[1], game.nearAnvil(), t.body);
      hits = { rows: h.rows, filters: h.filters ?? [], tabs: t.hits };
    },
    bagTitle: () => '裝備與背包（B 或 Esc 關閉）',
    bagKey(code) {
      const list = choices();
      if (code === 'Tab') page = (page + 1) % PAGES.length;
      else if (page === 1 && (code === 'ArrowLeft' || code === 'ArrowRight'))
        setFilter(ui[1].filter + (code === 'ArrowLeft' ? -1 : 1));
      else if (code === 'ArrowUp' || code === 'ArrowDown') {
        if (list.length)
          ui[page].cursor = (ui[page].cursor + (code === 'ArrowUp' ? -1 : 1) + list.length) % list.length;
      } else if (code === 'Enter' || code === 'NumpadEnter') run(list[ui[page].cursor]);
      else return false;
      return true;
    },
    bagClick(x, y, double) {
      const tab = hits.tabs.find((r) => inside(r.rect, x, y));
      if (tab) {
        page = tab.i;
        return;
      }
      const f = hits.filters.find((r) => inside(r.rect, x, y));
      if (f) return setFilter(f.i);
      const row = hits.rows.find((r) => inside(r.rect, x, y));
      if (!row) return;
      ui[page].cursor = row.i;
      if (double) run(choices()[row.i]);
    },
  };
}
