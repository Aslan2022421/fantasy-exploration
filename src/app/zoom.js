// 地圖的顯示設定。縮放（使用者要的縮放鍵）：+（= 鍵或數字鍵盤 +）放大、- 縮小，一次一倍，記在 store（介面偏好，不進存檔）。
// 按著 Ctrl／Cmd 時不攔，留給瀏覽器自己的縮放

import { MAP_ZOOM } from '../view/screen.js';

export const ZOOM_KEYS = { Equal: 1, NumpadAdd: 1, Minus: -1, NumpadSubtract: -1 };
const KEY = 'mapZoom';

// tileOf(zoom) 回傳那個縮放下地圖格的大小，用來判斷到底了沒（最小 1 倍）
export function createZoom(store, tileOf) {
  let zoom = Number(store.load(KEY, 0)) || 0;
  let grid = false; // G 鍵：狀態列顯示現在看得到幾×幾格（使用者要的）
  return {
    get value() {
      return zoom;
    },
    get showGrid() {
      return grid;
    },
    // G 鍵切換顯示可視格數；是 G 鍵就回傳 true
    toggleGrid(e) {
      if (e.code !== 'KeyG' || e.ctrlKey || e.metaKey) return false;
      grid = !grid;
      return true;
    },
    // 這個按鍵是不是縮放鍵
    isKey: (e) => Boolean(ZOOM_KEYS[e.code]) && !e.ctrlKey && !e.metaKey,
    // 照按鍵縮放；格子大小真的變了才回傳 true
    press(e) {
      const next = Math.max(MAP_ZOOM.min, Math.min(MAP_ZOOM.max, zoom + ZOOM_KEYS[e.code]));
      if (tileOf(next) === tileOf(zoom)) return false;
      zoom = next;
      store.save(KEY, zoom);
      return true;
    },
  };
}
