// 地圖縮放：+（= 鍵或數字鍵盤 +）放大、- 縮小，一次加減 8 像素，記在 store（介面偏好，不進存檔）。
// 按著 Ctrl／Cmd 時不攔，留給瀏覽器自己的縮放

import { MAP_ZOOM } from '../view/screen.js';

export const ZOOM_KEYS = { Equal: 1, NumpadAdd: 1, Minus: -1, NumpadSubtract: -1 };
const KEY = 'mapZoom';

// tileOf(zoom) 回傳那個縮放下地圖格的大小，用來判斷到底了沒（最小 1 倍）
export function createZoom(store, tileOf) {
  let zoom = Number(store.load(KEY, 0)) || 0;
  return {
    get value() {
      return zoom;
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
