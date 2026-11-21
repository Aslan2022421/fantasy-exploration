// 遊戲裡的大視窗內容（windows.js 管開關，這裡管每個視窗畫什麼、按鍵與滑鼠做什麼）：
// H 紀錄與歷史（history-window.js）、B 裝備與背包（bag-window.js）、M 世界地圖（map-window.js）都是上方頁籤加內容；
// C 角色、Esc 選單（匯出試玩紀錄、重新建角）

import { COLORS } from '../view/colors.js';
import { drawSheet } from '../view/sheet.js';
import { bagWindow } from './bag-window.js';
import { historyWindow } from './history-window.js';
import { mapWindow } from './map-window.js';
import { downloadPlaylog } from './playlog.js';
import { createWindows } from './windows.js';

const inside = (r, x, y) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;

// actions() 回傳 actions.js 的物件（視窗先建、actions 後建，所以用函式取）；entries() 是紀錄視窗的內容；
// restart() 清掉存檔重新開始
// asciiMap：世界地圖（asciimap.js）；camera()：主畫面左上角的世界格與看得到幾×幾格
export function createGameWindows({ panels, game, data, asciiMap, camera, actions, entries, version, restart }) {
  let exported = null; // 這次打開選單後匯出的檔名
  let restartArmed = false; // 選單裡按過一次「重新建角」，再按一次才清掉存檔
  let sheetHits = { plus: [] };
  const world = game.world;
  const env = { panels, game, world, data, entries, asciiMap, camera };

  const windows = createWindows(panels, {
    ...historyWindow(env),
    ...bagWindow({ panels, game, data, actions }),
    ...mapWindow(env),
    sheet: (c, s, body) => {
      sheetHits = drawSheet(c, s, panels, data, game.state, body);
    },
    sheetClick(x, y) {
      const hit = sheetHits.plus.find((p) => inside(p.rect, x, y));
      if (hit) actions().raise(hit.attr);
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
