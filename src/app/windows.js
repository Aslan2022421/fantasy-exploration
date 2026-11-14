// 大視窗（H 紀錄、B 背包、M 地圖、Esc 選單）：同一時間只開一個，按自己的鍵或 Esc 關掉；
// 文字視窗用方向鍵、PageUp／PageDown、滾輪捲動。紀錄打開時捲到最新，其他從頭看。
// 地圖自己畫（custom）；選單的數字鍵執行選項（actions）

const WINDOWS = {
  KeyH: { name: 'history', title: '紀錄（H 或 Esc 關閉，滾輪或方向鍵捲動）', fromEnd: true },
  KeyB: { name: 'bag', title: '背包（B 或 Esc 關閉）' },
  KeyM: { name: 'map', title: '世界地圖（M 或 Esc 關閉）', custom: true },
  Escape: { name: 'menu', title: '選單（Esc 關閉）', actions: { Digit1: 'export', Numpad1: 'export' } },
};
const SCROLL_KEYS = { ArrowUp: -1, ArrowDown: 1, PageUp: -10, PageDown: 10 };

// content：每個視窗的內容。文字視窗是 name() → entries；custom 的是 name(ctx, screen, body) 自己畫；
// actions 指到的是 content 裡的函式
export function createWindows(panels, content) {
  let open = null; // WINDOWS 裡的一個
  let scroll = 0;
  let maxScroll = 0;

  const show = (w) => {
    open = w;
    scroll = w.fromEnd ? Number.MAX_SAFE_INTEGER : 0;
  };

  return {
    get open() {
      return open?.name ?? null;
    },
    // 回傳 true 表示這個鍵由視窗處理了（開著的時候所有鍵都由視窗處理）
    key(code) {
      if (!open) {
        if (!WINDOWS[code]) return false;
        show(WINDOWS[code]);
        return true;
      }
      if (code === 'Escape' || WINDOWS[code] === open) open = null;
      else if (open.actions?.[code]) content[open.actions[code]]();
      else if (WINDOWS[code]) show(WINDOWS[code]);
      else if (SCROLL_KEYS[code]) this.scroll(SCROLL_KEYS[code]);
      return true;
    },
    close() {
      open = null;
    },
    scroll(delta) {
      scroll = Math.max(0, Math.min(maxScroll, scroll + delta));
    },
    draw(ctx, screen) {
      if (!open) return;
      if (open.custom) {
        content[open.name](ctx, screen, panels.windowBox(ctx, screen, open.title));
        return;
      }
      maxScroll = panels.window(ctx, screen, open.title, content[open.name](), scroll);
      scroll = Math.min(scroll, maxScroll);
    },
  };
}
