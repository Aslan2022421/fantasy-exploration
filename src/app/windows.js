// 大視窗（H 紀錄、B 背包）：同一時間只開一個，按自己的鍵或 Esc 關掉；方向鍵、PageUp／PageDown、滾輪捲動。
// 紀錄打開時捲到最新，背包從頭看

const WINDOWS = {
  KeyH: { name: 'history', title: '紀錄（H 或 Esc 關閉，滾輪或方向鍵捲動）', fromEnd: true },
  KeyB: { name: 'bag', title: '背包（B 或 Esc 關閉）', fromEnd: false },
};
const SCROLL_KEYS = { ArrowUp: -1, ArrowDown: 1, PageUp: -10, PageDown: 10 };

// content：{ history() → entries, bag() → entries }
export function createWindows(panels, content) {
  let open = null; // WINDOWS 裡的一個
  let scroll = 0;
  let maxScroll = 0;

  return {
    get open() {
      return open?.name ?? null;
    },
    // 回傳 true 表示這個鍵由視窗處理了
    key(code) {
      if (open) {
        if (code === 'Escape' || WINDOWS[code] === open) open = null;
        else if (WINDOWS[code]) {
          open = WINDOWS[code];
          scroll = open.fromEnd ? Number.MAX_SAFE_INTEGER : 0;
        } else if (SCROLL_KEYS[code]) this.scroll(SCROLL_KEYS[code]);
        return true;
      }
      if (!WINDOWS[code]) return false;
      open = WINDOWS[code];
      scroll = open.fromEnd ? Number.MAX_SAFE_INTEGER : 0;
      return true;
    },
    scroll(delta) {
      scroll = Math.max(0, Math.min(maxScroll, scroll + delta));
    },
    draw(ctx, screen) {
      if (!open) return;
      maxScroll = panels.window(ctx, screen, open.title, content[open.name](), Math.min(scroll, 1e9));
      scroll = Math.min(scroll, maxScroll);
    },
  };
}
