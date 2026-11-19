// 文字面板：頂部狀態列、右側訊息欄、大視窗（H 紀錄、B 背包）、路線終點旁的步數。
// 都畫在疊在地圖上面的那張 canvas，用烘焙點陣字

import { COLORS } from './colors.js';
import { ellipsis, wrap } from './wrap.js';

// entries：[{ time, text, color }]；time 是 null 的是說明文字（不是紀錄）
function visualLines(font, entries, width, scale) {
  const out = [];
  const measure = (ch) => font.measure(ch, scale);
  for (const e of entries) {
    const prefix = e.time == null ? '' : `${e.time}　`;
    const indent = font.measure(prefix, scale);
    wrap(e.text, width - indent, measure).forEach((text, i) => {
      out.push({ prefix: i === 0 ? prefix : '', indent, text, color: e.color ?? COLORS.text });
    });
  }
  return out;
}

function drawLine(ctx, font, line, x, y, scale) {
  if (line.prefix) font.drawText(ctx, line.prefix, x, y, scale, COLORS.dim);
  font.drawText(ctx, line.text, x + line.indent, y, scale, line.color);
}

function frame(ctx, rect, fill, border) {
  ctx.fillStyle = fill;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  if (border) {
    ctx.strokeStyle = border;
    ctx.lineWidth = 1;
    ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);
  }
}

// 奇幻感的外框：雙線框（兩圈細線），標題嵌在上框線中間，兩端各一個 ☼
function ornateFrame(ctx, font, rect, title, scale, pad) {
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  const gap = Math.max(2, Math.round(scale * 1.5));
  ctx.strokeStyle = COLORS.line2;
  ctx.lineWidth = Math.max(1, Math.floor(scale / 2));
  for (const d of [0, gap]) ctx.strokeRect(rect.x + d + 0.5, rect.y + d + 0.5, rect.w - d * 2 - 1, rect.h - d * 2 - 1);
  if (!title) return;
  const label = `☼ ${title} ☼`;
  const w = font.measure(label, scale);
  const x = rect.x + Math.floor((rect.w - w) / 2);
  const h = 12 * scale;
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(x - pad * 2, rect.y, w + pad * 4, gap + 2);
  font.drawText(ctx, label, x, rect.y - Math.floor(h / 2) + gap, scale, COLORS.head);
}

// 分隔線：細線，正中間「• ♦ •」
function ornateRule(ctx, font, x, y, w, scale, pad) {
  const mark = '•  ♦  •';
  const mw = font.measure(mark, scale);
  const mx = x + Math.floor((w - mw) / 2);
  const ly = y + Math.floor(6 * scale);
  ctx.fillStyle = COLORS.line2;
  ctx.fillRect(x, ly, mx - pad * 2 - x, Math.max(1, Math.floor(scale / 2)));
  ctx.fillRect(mx + mw + pad * 2, ly, x + w - (mx + mw + pad * 2), Math.max(1, Math.floor(scale / 2)));
  font.drawText(ctx, mark, mx, y, scale, COLORS.line2);
}

export function createPanels(font) {
  return {
    status(ctx, s, text) {
      const { top, pad, textScale } = s;
      frame(ctx, top, COLORS.bg);
      ctx.fillStyle = COLORS.line;
      ctx.fillRect(0, top.h - 1, top.w, 1);
      const fitted = ellipsis(text, top.w - pad * 2, (ch) => font.measure(ch, textScale));
      font.drawText(ctx, fitted, pad, pad / 2, textScale, COLORS.text);
    },

    // 最新的在下面；scroll 是往上捲了幾行。回傳最多能捲幾行
    log(ctx, s, entries, scroll) {
      const { side, pad, textScale, lineHeight } = s;
      frame(ctx, side, COLORS.bg);
      ctx.fillStyle = COLORS.line2;
      ctx.fillRect(side.x, side.y, 1, side.h);
      const lines = visualLines(font, entries, side.w - pad * 2, textScale);
      const visible = Math.max(1, Math.floor((side.h - pad * 2) / lineHeight));
      const maxScroll = Math.max(0, lines.length - visible);
      const start = Math.max(0, lines.length - visible - Math.min(scroll, maxScroll));
      lines.slice(start, start + visible).forEach((line, i) => {
        drawLine(ctx, font, line, side.x + pad, side.y + pad + i * lineHeight, textScale);
      });
      return maxScroll;
    },

    // 大視窗的外框與標題（蓋在地圖上）：雙線框，標題嵌在上框線中間；回傳內容區 { x, y, w, h }
    windowBox(ctx, s, title) {
      const { map, pad, textScale, lineHeight } = s;
      const box = { x: map.x + pad * 3, y: map.y + pad * 4, w: map.w - pad * 6, h: map.h - pad * 7 };
      ornateFrame(ctx, font, box, title, textScale, pad);
      const top = box.y + pad * 3 + Math.floor(lineHeight / 2);
      return { x: box.x + pad * 4, y: top, w: box.w - pad * 8, h: box.y + box.h - pad * 2 - top };
    },

    // 整張畫布的雙線外框（建角畫面）；回傳內容區
    screenBox(ctx, s, title) {
      const { pad, textScale, lineHeight } = s;
      ctx.fillStyle = COLORS.dark;
      ctx.fillRect(0, 0, s.width, s.height);
      const box = { x: pad * 6, y: pad * 6, w: s.width - pad * 12, h: s.height - pad * 12 };
      ornateFrame(ctx, font, box, title, textScale, pad);
      const top = box.y + pad * 3 + Math.floor(lineHeight / 2);
      return { x: box.x + pad * 6, y: top, w: box.w - pad * 12, h: box.y + box.h - pad * 3 - top };
    },

    // 分隔線（一行高）
    rule(ctx, s, x, y, w) {
      ornateRule(ctx, font, x, y, w, s.textScale, s.pad);
    },

    // 細線框（建角的欄、裝備格）
    box(ctx, rect, fill = COLORS.bg, border = COLORS.line) {
      frame(ctx, rect, fill, border);
    },

    measure: (text, s) => font.measure(text, s.textScale),

    // 大視窗（H 紀錄、B 背包、Esc 選單）：內容從上往下排；scroll 是往下捲了幾行。回傳最多能捲幾行
    window(ctx, s, title, entries, scroll) {
      const { textScale, lineHeight } = s;
      const body = this.windowBox(ctx, s, title);
      const lines = visualLines(font, entries, body.w, textScale);
      const visible = Math.max(1, Math.floor(body.h / lineHeight));
      const maxScroll = Math.max(0, lines.length - visible);
      const start = Math.min(scroll, maxScroll);
      lines.slice(start, start + visible).forEach((line, i) => {
        drawLine(ctx, font, line, body.x, body.y + i * lineHeight, textScale);
      });
      return maxScroll;
    },

    // 小視窗（跟村民說話）：地圖中間偏下，寬度是地圖的一半，高度照內容
    dialog(ctx, s, title, lines) {
      const { map, pad, textScale, lineHeight } = s;
      const w = Math.floor(map.w / 2);
      const body = visualLines(
        font,
        lines.map((text) => ({ time: null, text })),
        w - pad * 8,
        textScale,
      );
      const h = body.length * lineHeight + pad * 7 + lineHeight;
      const box = { x: map.x + Math.floor((map.w - w) / 2), y: map.y + Math.floor(map.h * 0.55), w, h };
      ornateFrame(ctx, font, box, title, textScale, pad);
      const top = box.y + pad * 3 + Math.floor(lineHeight / 2);
      body.forEach((line, i) => {
        drawLine(ctx, font, line, box.x + pad * 4, top + i * lineHeight, textScale);
      });
    },

    // 一行字（左上角在 x, y）
    text(ctx, s, text, x, y, color = COLORS.text) {
      font.drawText(ctx, text, x, y, s.textScale, color);
    },

    // 地圖上的小標籤（路線終點的步數、懸停提示框）；(px, py) 是那格的左上角（實體像素）。
    // 字跟介面字一樣大；描一圈框線跟地圖分開
    // 地圖上那格旁邊的單行小框：先放右邊、放不下放左邊，整個框不超出地圖
    routeLabel(ctx, s, px, py, label, color) {
      const { pad, tile, map, lineHeight, textScale: scale } = s;
      const w = font.measure(label, scale);
      let lx = px + tile + pad;
      if (lx + w + pad * 2 > map.x + map.w) lx = px - w - pad * 3;
      lx = Math.max(map.x + pad, Math.min(lx, map.x + map.w - w - pad));
      const ly = Math.max(map.y, py - lineHeight);
      frame(ctx, { x: lx - pad, y: ly, w: w + pad * 2, h: lineHeight }, COLORS.bg, COLORS.line2);
      font.drawText(ctx, label, lx, ly + scale, scale, color);
    },
  };
}
