// B 視窗：上方頁籤「裝備」（背包分類清單、換上、脫下、用補給品，gear-view.js）、「製作」（製造、修理、熔煉，craft-view.js）；
// Tab 或點頁籤換頁，← → 或點分類換篩選。回傳 windows.js 的 bag、bagKey、bagClick、bagTitle

import { CRAFT_FILTERS, craftRows, drawCraft, filtered } from '../view/craft-view.js';
import { drawGear, filteredGear, GEAR_FILTERS, gearChoices } from '../view/gear-view.js';
import { drawTabs, inside } from '../view/ui-kit.js';

const PAGES = ['裝備', '製作'];
const FILTERS = [GEAR_FILTERS, CRAFT_FILTERS];

export function bagWindow({ panels, game, data, actions }) {
  let page = 0;
  const ui = [
    { cursor: 0, filter: 0 },
    { cursor: 0, filter: 0 },
  ];
  let hits = { rows: [], filters: [], tabs: [] };
  // 這一頁能選的東西（照目前的篩選）
  const choices = () => {
    const st = game.state;
    return page === 0
      ? filteredGear(gearChoices(data, st.hero, st.bag), ui[0].filter)
      : filtered(craftRows(data, st, game.nearAnvil()), ui[1].filter);
  };
  const run = (c) => {
    if (!c) return;
    if (page === 0) {
      if (c.kind === 'equip') actions().bag('equip', c.id);
      else if (c.kind === 'unequip') actions().bag('unequip', c.slot);
      else if (c.kind === 'use') actions().bag('use', c.id);
    } else if (c.ok) actions().bag(c.kind, c.key);
  };
  const setFilter = (f) => {
    const n = FILTERS[page].length;
    ui[page].filter = (f + n) % n;
    ui[page].cursor = 0;
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
      hits = { rows: h.rows, filters: h.filters, tabs: t.hits };
    },
    bagTitle: () => '裝備與背包（B 或 Esc 關閉）',
    bagKey(code) {
      const list = choices();
      if (code === 'Tab') page = (page + 1) % PAGES.length;
      else if (code === 'ArrowLeft' || code === 'ArrowRight')
        setFilter(ui[page].filter + (code === 'ArrowLeft' ? -1 : 1));
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
