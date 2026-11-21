// 大視窗共用的介面零件（照舊版第三十七版、Caves of Qud 的物品畫面）：
// 上方一排頁籤、分類篩選列、可以選的清單、數字卡、最下面一行按鍵說明。都回傳點擊範圍，滑鼠點了交給視窗處理

import { COLORS } from './colors.js';

export const inside = (r, x, y) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;

// 一排按鈕（頁籤、篩選）：labels 照順序排，cur 那一個亮起來。回傳 { hits: [{ rect, i }], h 用掉的高度 }
export function drawButtons(ctx, s, panels, x, y, labels, cur, { strong = true } = {}) {
  const h = Math.round(s.lineHeight * 1.4);
  const hits = [];
  let bx = x;
  labels.forEach((label, i) => {
    const w = panels.measure(label, s) + s.pad * 6;
    const rect = { x: bx, y, w, h };
    const on = i === cur;
    panels.box(ctx, rect, on ? COLORS.panel2 : COLORS.bg, on ? (strong ? COLORS.head : COLORS.line2) : COLORS.line);
    panels.text(ctx, s, label, bx + s.pad * 3, y + Math.round((h - s.lineHeight) / 2), on ? COLORS.head : COLORS.dim);
    hits.push({ rect, i });
    bx += w + s.pad * 2;
  });
  return { hits, h };
}

// 視窗上方的頁籤：回傳 { hits, body: 頁籤下面剩下的內容區 }
export function drawTabs(ctx, s, panels, body, labels, cur) {
  const t = drawButtons(ctx, s, panels, body.x, body.y, labels, cur);
  const top = body.y + t.h + s.pad * 3;
  return { hits: t.hits, body: { x: body.x, y: top, w: body.w, h: body.y + body.h - top } };
}

// 最下面一行的按鍵說明，回傳上面剩下的內容區
export function drawHelp(ctx, s, panels, body, help) {
  panels.text(ctx, s, help, body.x, body.y + body.h - s.lineHeight, COLORS.dim);
  return { ...body, h: body.h - s.lineHeight * 2 };
}

// 左右兩欄：left 佔 share，中間一條細線。回傳 { left, right }
export function split(ctx, s, body, share) {
  const gap = s.pad * 8;
  const lw = Math.floor(body.w * share);
  ctx.fillStyle = COLORS.line;
  ctx.fillRect(body.x + lw + Math.floor(gap / 2), body.y, Math.max(2, s.scale), body.h);
  return {
    left: { x: body.x, y: body.y, w: lw, h: body.h },
    right: { x: body.x + lw + gap, y: body.y, w: body.w - lw - gap, h: body.h },
  };
}

// 可以選的清單：rows 是 [{ heading } 或 { text, note, color, mark, markColor }]；pick 是第幾個能選的列（不算標題）。
// 游標那一列會留在看得到的地方。回傳 { hits: [{ rect, i 第幾個能選的 }] }
export function drawList(ctx, s, panels, rect, rows, pick) {
  const rowH = Math.round(s.lineHeight * 1.3);
  const per = Math.max(1, Math.floor(rect.h / rowH));
  const pickRow = rows.findIndex((r, i) => !r.heading && rows.slice(0, i).filter((x) => !x.heading).length === pick);
  const start = Math.max(0, Math.min(rows.length - per, pickRow - Math.floor(per / 2)));
  const hits = [];
  let n = rows.slice(0, start).filter((r) => !r.heading).length;
  let y = rect.y;
  for (let i = start; i < rows.length && y + rowH <= rect.y + rect.h; i++, y += rowH) {
    const r = rows[i];
    const ty = y + Math.round((rowH - s.lineHeight) / 2);
    if (r.heading) {
      panels.text(ctx, s, r.heading, rect.x, ty, COLORS.head);
      continue;
    }
    const box = { x: rect.x, y, w: rect.w, h: rowH };
    if (n === pick) panels.box(ctx, box, COLORS.panel2, COLORS.line2);
    let x = rect.x + s.pad * 2;
    if (r.mark) {
      panels.text(ctx, s, r.mark, x, ty, r.markColor ?? COLORS.text);
      x += panels.measure('　', s);
    }
    panels.text(ctx, s, r.text, x, ty, r.color ?? COLORS.text);
    if (r.note) {
      const w = panels.measure(r.note, s);
      panels.text(ctx, s, r.note, rect.x + rect.w - w - s.pad * 2, ty, COLORS.dim);
    }
    hits.push({ rect: box, i: n });
    n++;
  }
  return { hits };
}

// 數字卡：上面小字標題、下面大一點的數字（用兩倍行高的位置），回傳卡片高度
export function drawTile(ctx, s, panels, rect, label, value, color = COLORS.head) {
  panels.box(ctx, rect, COLORS.bg, COLORS.line);
  panels.text(ctx, s, label, rect.x + s.pad * 2, rect.y + s.pad, COLORS.dim);
  panels.text(ctx, s, String(value), rect.x + s.pad * 2, rect.y + s.pad + s.lineHeight, color);
}
