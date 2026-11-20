// 遊戲裡的大視窗內容（windows.js 管開關，這裡管每個視窗畫什麼、按鍵與滑鼠做什麼）：
// H 紀錄（Tab 換頁：紀錄、世界歷史、生涯、圖鑑）、B 裝備與背包（Tab 換頁：裝備、製作，bag-window.js）、C 角色、M 世界地圖、Esc 選單（匯出試玩紀錄、重新建角）

import { bestiary, HISTORY_TABS, lifePage, worldHistory } from '../view/chronicle-view.js';
import { COLORS } from '../view/colors.js';
import { drawSheet } from '../view/sheet.js';
import { regionLabel } from '../world/place.js';
import { bagWindow } from './bag-window.js';
import { downloadPlaylog } from './playlog.js';
import { createWindows } from './windows.js';

const inside = (r, x, y) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;

// actions() 回傳 actions.js 的物件（視窗先建、actions 後建，所以用函式取）；entries() 是紀錄視窗的內容；
// restart() 清掉存檔重新開始
// asciiMap：世界地圖（asciimap.js）；camera()：主畫面左上角的世界格與看得到幾×幾格
export function createGameWindows({ panels, game, data, asciiMap, camera, actions, entries, version, restart }) {
  let mapWhole = false; // M 現在看的是整個世界（Tab 切換）
  let exported = null; // 這次打開選單後匯出的檔名
  let restartArmed = false; // 選單裡按過一次「重新建角」，再按一次才清掉存檔
  let sheetHits = { plus: [] };
  const world = game.world;

  let tab = 0; // H 現在看哪一頁（HISTORY_TABS），Tab 換頁
  const pages = [
    entries,
    () => worldHistory(game.chronicle),
    () => lifePage(game.chronicle, game.state),
    () => bestiary(game.chronicle, world, data),
  ];

  const windows = createWindows(panels, {
    history: () => pages[tab](),
    historyKey(code) {
      if (code !== 'Tab') return false;
      tab = (tab + 1) % HISTORY_TABS.length;
      return true;
    },
    historyTitle: () => `${HISTORY_TABS[tab]}（Tab 換頁：${HISTORY_TABS.join('／')}｜H 或 Esc 關閉，滾輪或方向鍵捲動）`,
    historyFromEnd: () => tab < 2, // 紀錄與世界歷史捲到最新，生涯與圖鑑從頭看
    ...bagWindow({ panels, game, data, actions }),
    sheet: (c, s, body) => {
      sheetHits = drawSheet(c, s, panels, data, game.state, body);
    },
    sheetClick(x, y) {
      const hit = sheetHits.plus.find((p) => inside(p.rect, x, y));
      if (hit) actions().raise(hit.attr);
    },
    // M：先看附近，Tab 切到整個世界；兩頁都是奇幻 ASCII 的畫法
    map: (c, s, body) => {
      const p = game.state.player;
      const where = `你在${regionLabel(world, data, p.x, p.y)}`;
      if (mapWhole) {
        const label = `${where}｜整個世界 ${world.zonesX}×${world.zonesY} 區，一個字一區，只畫走過、看過的地方｜Tab 看附近`;
        asciiMap.drawWorld(c, s, body, panels, p, label, game.chronicle.known());
        return;
      }
      const label = `${where}｜附近 3×3 區，一個字 3×3 格，白框是畫面看得到的範圍｜Tab 看整個世界`;
      asciiMap.drawRegion(c, s, body, panels, p, camera(), game.log.size, label);
    },
    mapKey(code) {
      if (code !== 'Tab') return false;
      mapWhole = !mapWhole;
      return true;
    },
    menu: () => [
      {
        time: null,
        text: `這個世界的種子：${game.seed}（網址加 ?seed=${game.seed} 可以再開一次同一個世界）`,
        color: COLORS.dim,
      },
      { time: null, text: '1　匯出試玩紀錄（下載成 JSON 檔，交給 Claude 讀）' },
      ...(exported ? [{ time: null, text: `已匯出：${exported}`, color: COLORS.good }] : []),
      { time: null, text: '2　重新建角（開新遊戲）' },
      ...(restartArmed ? [{ time: null, text: '現在的存檔會被蓋掉。確定的話再按一次 2。', color: COLORS.bad }] : []),
    ],
    export: () => {
      exported = downloadPlaylog(game, version);
    },
    // 重新建角：按兩次 2 才算數
    restart: () => {
      if (restartArmed) restart();
      else restartArmed = true;
    },
  });

  // 打開選單時，上一次的匯出結果與重新建角的確認都清掉
  windows.resetMenu = () => {
    exported = null;
    restartArmed = false;
  };
  return windows;
}
