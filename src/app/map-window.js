// M 視窗：Tab 或點頁籤換頁（附近、整個世界）；↑↓ 或點清單選地方；點地圖：點到地方就選它，
// 點到別的地方就在右欄寫那一區是什麼。回傳 windows.js 的 map、mapKey、mapClick、mapTitle

import { drawMap, MAP_TABS } from '../view/map-view.js';
import { inside } from '../view/ui-kit.js';
import { regionLabel } from '../world/place.js';

export function mapWindow(env) {
  const ui = { tab: 0, cursor: 0, clicked: null };
  let hits = { tabs: [], rows: [], map: null, places: [] };
  const show = (tab) => {
    ui.tab = tab;
    ui.cursor = 0;
    ui.clicked = null;
  };

  return {
    map(c, s, body) {
      hits = drawMap(c, s, env.panels, env, ui, body);
      ui.cursor = Math.max(0, Math.min(ui.cursor, hits.places.length - 1));
    },
    mapTitle: () => '世界地圖（M 或 Esc 關閉）',
    mapKey(code) {
      const n = hits.places.length;
      if (code === 'Tab') show((ui.tab + 1) % MAP_TABS.length);
      else if ((code === 'ArrowUp' || code === 'ArrowDown') && n) {
        ui.cursor = (ui.cursor + (code === 'ArrowUp' ? -1 : 1) + n) % n;
        ui.clicked = null;
      } else return false;
      return true;
    },
    mapClick(x, y) {
      const tab = hits.tabs.find((r) => inside(r.rect, x, y));
      if (tab) return show(tab.i);
      const row = hits.rows.find((r) => inside(r.rect, x, y));
      if (row) {
        ui.cursor = row.i;
        ui.clicked = null;
        return;
      }
      const f = hits.map?.f;
      if (!f || x < f.x || y < f.y || x >= f.x + f.size || y >= f.y + f.size) return;
      const i = Math.floor((x - f.x) / f.px);
      const j = Math.floor((y - f.y) / f.px);
      // 點到地方（三個字以內）就選它
      let best = -1;
      let bd = 3;
      hits.places.forEach((p, k) => {
        const d = Math.max(Math.abs(p.i - i), Math.abs(p.j - j));
        if (d <= bd) [best, bd] = [k, d];
      });
      if (best >= 0) {
        ui.cursor = best;
        ui.clicked = null;
        return;
      }
      const cell = hits.map.cell(i, j);
      const known = ui.tab === 0 || env.game.chronicle.known().zones.has(`${i},${j}`);
      ui.clicked = known ? regionLabel(env.world, env.data, cell.x, cell.y) : '還沒去過，不知道那裡有什麼。';
    },
  };
}
