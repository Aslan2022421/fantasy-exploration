// B 視窗：Tab 在「裝備」（換上背包裡的裝備，gear-view.js）與「製作」（製造、修理、熔煉、補給品，craft-view.js）兩頁切換。
// 回傳 windows.js 的 bag、bagKey、bagClick、bagTitle

import { craftRows, drawCraft, pickable } from '../view/craft-view.js';
import { drawGear, gearItems } from '../view/gear-view.js';

const inside = (r, x, y) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
const PAGES = ['裝備', '製作'];

export function bagWindow({ panels, game, data, actions }) {
  let page = 0;
  const ui = [{ cursor: 0 }, { cursor: 0 }];
  let hits = { rows: [] };
  const rows = () => craftRows(data, game.state, game.nearAnvil());
  // 這一頁能選的東西：裝備頁是背包裡的裝備 id，製作頁是能動手的列
  const choices = () => {
    if (page === 0) return gearItems(data, game.state.hero);
    const r = rows();
    return pickable(r).map((i) => r[i]);
  };
  const run = (choice) => {
    if (!choice) return;
    if (page === 0) actions().bag('equip', choice);
    else actions().bag(choice.kind, choice.key);
  };

  return {
    bag(c, s, body) {
      const n = choices().length;
      ui[page].cursor = Math.max(0, Math.min(ui[page].cursor, n - 1));
      hits =
        page === 0
          ? drawGear(c, s, panels, data, game.state, ui[0], body)
          : drawCraft(c, s, panels, rows(), ui[1], game.nearAnvil(), body);
    },
    bagTitle: () => `裝備與背包｜${PAGES[page]}（Tab 換頁：${PAGES.join('／')}）`,
    bagKey(code) {
      const list = choices();
      if (code === 'Tab') page = (page + 1) % PAGES.length;
      else if (code === 'ArrowUp' || code === 'ArrowDown') {
        if (list.length)
          ui[page].cursor = (ui[page].cursor + (code === 'ArrowUp' ? -1 : 1) + list.length) % list.length;
      } else if (code === 'Enter' || code === 'NumpadEnter') run(list[ui[page].cursor]);
      else return false;
      return true;
    },
    bagClick(x, y, double) {
      const row = hits.rows.find((r) => inside(r.rect, x, y));
      if (!row) return;
      ui[page].cursor = row.i;
      if (double) run(choices()[row.i]);
    },
  };
}
