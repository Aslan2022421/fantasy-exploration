// 大視窗（H 紀錄與歷史、B 裝備與背包、C 角色、M 地圖、Esc 選單）：同一時間只開一個，按自己的鍵或 Esc 關掉。
// 自己畫的視窗（custom）：content[name](ctx, screen, body) 畫，content[name + 'Key'](code) 接鍵、
// content[name + 'Click'](x, y, double) 接滑鼠、content[name + 'Scroll'](幾行) 接滾輪、
// content[name + 'Title']() 換標題、content[name + 'Open']() 在打開時呼叫。
// 文字視窗（Esc 選單）用方向鍵、PageUp／PageDown、滾輪捲動，數字鍵執行選項（actions）

const WINDOWS = {
  KeyH: { name: 'history', title: '紀錄與歷史', custom: true },
  KeyB: { name: 'bag', title: '裝備與背包', custom: true },
  KeyC: { name: 'sheet', title: '角色', custom: true },
  KeyM: { name: 'map', title: '世界地圖（M 或 Esc 關閉）', custom: true },
  Escape: {
    name: 'menu',
    title: '選單（Esc 關閉）',
    actions: { Digit1: 'export', Numpad1: 'export', Digit2: 'restart', Numpad2: 'restart' },
  },
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
    scroll = 0;
    content[`${w.name}Open`]?.();
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
      else if (open.custom && content[`${open.name}Key`]?.(code)) return true;
      else if (WINDOWS[code]) show(WINDOWS[code]);
      else if (SCROLL_KEYS[code]) this.scroll(SCROLL_KEYS[code]);
      return true;
    },
    // 滑鼠點在開著的視窗上（畫布像素）；double 是點兩下
    click(x, y, double) {
      if (open?.custom) content[`${open.name}Click`]?.(x, y, double);
    },
    close() {
      open = null;
    },
    // 跟村民說話的小視窗（沒有自己的鍵，Esc 關掉）：talk = { title, lines }
    talk(talk) {
      open = { name: 'talk', title: `${talk.title}（Esc 關閉）`, small: true, lines: talk.lines };
    },
    // 滾輪：自己畫的視窗交給 content[name + 'Scroll']
    scroll(delta) {
      if (open?.custom) content[`${open.name}Scroll`]?.(delta);
      else scroll = Math.max(0, Math.min(maxScroll, scroll + delta));
    },
    draw(ctx, screen) {
      if (!open) return;
      if (open.small) {
        panels.dialog(ctx, screen, open.title, open.lines);
        return;
      }
      const title = content[`${open.name}Title`]?.() ?? open.title;
      if (open.custom) {
        content[open.name](ctx, screen, panels.windowBox(ctx, screen, title));
        return;
      }
      maxScroll = panels.window(ctx, screen, title, content[open.name](), scroll);
      scroll = Math.min(scroll, maxScroll);
    },
  };
}
