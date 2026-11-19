// 遊戲裡的大視窗內容（windows.js 管開關，這裡管每個視窗畫什麼、按鍵與滑鼠做什麼）：
// H 紀錄、B 裝備與背包、C 角色、M 世界地圖、Esc 選單（匯出試玩紀錄、重新建角）

import { COLORS } from '../view/colors.js';
import { drawGear, gearItems } from '../view/gear-view.js';
import { REGION } from '../view/regionmap.js';
import { drawSheet } from '../view/sheet.js';
import { drawMapWindow } from '../view/worldmap.js';
import { regionLabel } from '../world/place.js';
import { downloadPlaylog } from './playlog.js';
import { createWindows } from './windows.js';

const inside = (r, x, y) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;

// actions() 回傳 actions.js 的物件（視窗先建、actions 後建，所以用函式取）；entries() 是紀錄視窗的內容；
// restart() 清掉存檔重新開始
// regionMap：附近地圖（regionmap.js）；camera()：主畫面左上角的世界格與看得到幾×幾格
export function createGameWindows({
  panels,
  game,
  data,
  worldMap,
  regionMap,
  camera,
  actions,
  entries,
  version,
  restart,
}) {
  let mapWhole = false; // M 現在看的是整個世界（Tab 切換）
  let exported = null; // 這次打開選單後匯出的檔名
  let restartArmed = false; // 選單裡按過一次「重新建角」，再按一次才清掉存檔
  const gearUi = { cursor: 0 }; // B 頁背包清單的游標
  let gearHits = { rows: [] };
  let sheetHits = { plus: [] };
  const world = game.world;

  const windows = createWindows(panels, {
    history: entries,
    bag: (c, s, body) => {
      gearUi.cursor = Math.max(0, Math.min(gearUi.cursor, gearItems(data, game.state.hero).length - 1));
      gearHits = drawGear(c, s, panels, data, game.state, gearUi, body);
    },
    bagKey(code) {
      const items = gearItems(data, game.state.hero);
      if (code === 'ArrowUp' || code === 'ArrowDown') {
        if (items.length) gearUi.cursor = (gearUi.cursor + (code === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
      } else if (code === 'Enter' || code === 'NumpadEnter') {
        if (items[gearUi.cursor]) actions().equip(items[gearUi.cursor]);
      } else return false;
      return true;
    },
    bagClick(x, y, double) {
      const row = gearHits.rows.find((r) => inside(r.rect, x, y));
      if (!row) return;
      gearUi.cursor = row.i;
      if (double) actions().equip(row.id);
    },
    sheet: (c, s, body) => {
      sheetHits = drawSheet(c, s, panels, data, game.state, body);
    },
    sheetClick(x, y) {
      const hit = sheetHits.plus.find((p) => inside(p.rect, x, y));
      if (hit) actions().raise(hit.attr);
    },
    // M：先看附近（舊版的小地圖畫法），Tab 切到整個世界
    map: (c, s, body) => {
      const p = game.state.player;
      const where = `你在${regionLabel(world, data, p.x, p.y)}`;
      if (mapWhole) {
        const label = `${where}｜整個世界 ${world.zonesX}×${world.zonesY} 區，方框是你所在的區｜Tab 看附近`;
        drawMapWindow(c, s, body, worldMap, panels, p, label);
        return;
      }
      const label = `${where}｜附近 ${REGION.zones}×${REGION.zones} 區，白框是畫面看得到的範圍｜Tab 看整個世界`;
      regionMap.draw(c, s, body, panels, p, camera(), game.log.size, label);
    },
    mapKey(code) {
      if (code !== 'Tab') return false;
      mapWhole = !mapWhole;
      return true;
    },
    menu: () => [
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
