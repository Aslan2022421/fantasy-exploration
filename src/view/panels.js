// 文字面板：頂部狀態列、右側訊息欄、大視窗（H 紀錄、B 背包）、路線終點旁的步數。
// 都畫在疊在地圖上面的那張 canvas，用烘焙點陣字

import { COLORS } from './colors.js';
import { ellipsis, wrap } from './wrap.js';

const LABEL_BASE = 12; // 介面字的設計格（Fusion Pixel 12 像素）

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

    // 大視窗的外框與標題（蓋在地圖上）；回傳內容區 { x, y, w, h }
    windowBox(ctx, s, title) {
      const { map, pad, textScale, lineHeight } = s;
      const box = { x: map.x + pad * 2, y: map.y + pad * 2, w: map.w - pad * 4, h: map.h - pad * 4 };
      frame(ctx, box, COLORS.bg, COLORS.line2);
      font.drawText(ctx, title, box.x + pad * 2, box.y + pad, textScale, COLORS.head);
      const top = box.y + pad * 2 + lineHeight;
      return { x: box.x + pad * 2, y: top, w: box.w - pad * 4, h: box.y + box.h - pad - top };
    },

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

    // 一行字（左上角在 x, y）
    text(ctx, s, text, x, y, color = COLORS.text) {
      font.drawText(ctx, text, x, y, s.textScale, color);
    },

    // 地圖上的小標籤（路線終點的步數、懸停提示框）；(px, py) 是那格的左上角（實體像素）。
    // 字用介面字的一半（12 像素的整數倍），框比較矮，旁邊往上疊的樹冠才不會穿過字；描一圈框線跟地圖分開
    routeLabel(ctx, s, px, py, label, color) {
      const { pad, tile, map } = s;
      const scale = Math.max(1, s.textScale / 2);
      const lineHeight = (LABEL_BASE + 2) * scale;
      const w = font.measure(label, scale);
      let lx = px + tile + pad;
      if (lx + w + pad * 2 > map.x + map.w) lx = px - w - pad * 3;
      const ly = Math.max(map.y, py - lineHeight);
      frame(ctx, { x: lx - pad, y: ly, w: w + pad * 2, h: lineHeight }, COLORS.bg, COLORS.line2);
      font.drawText(ctx, label, lx, ly + scale, scale, color);
    },
  };
}
