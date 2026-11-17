// 建角畫面：整張畫布、雙線框。最上面是路徑列（點得到走過的步驟），下面左欄是這一步的選項、右欄是說明與選完的樣子。
// 回傳點擊範圍 { rows: [{ rect, i, plus, minus }], path: [{ rect, i }] } 給 app/creation.js 用

import { attrMod } from '../world/rules.js';
import { COLORS } from './colors.js';
import { detailLines } from './creation-detail.js';
import { signed } from './names.js';
import { wrap } from './wrap.js';

const HELP = '↑↓ 或滑鼠選　Enter／空白鍵 確定　數字鍵 直接選　R 隨機　Esc 上一步';
const HELP_POINTS = '點 + 加一點、- 退回（鍵盤 ← →）　Enter 確定　R 隨機　Esc 上一步';

const inside = (r, x, y) => r && x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
export const hitRow = (hits, x, y) => hits.rows.find((r) => inside(r.rect, x, y)) ?? null;
export const hitPath = (hits, x, y) => hits.path.find((r) => inside(r.rect, x, y)) ?? null;
export const hitButton = (row, x, y) => (inside(row?.plus, x, y) ? 'plus' : inside(row?.minus, x, y) ? 'minus' : null);

function drawPath(ctx, s, panels, m, steps, x, y) {
  const out = [];
  const reach = m.reach();
  let cx = x;
  steps.forEach((st, i) => {
    if (i) {
      const sep = ' ▸ ';
      panels.text(ctx, s, sep, cx, y, COLORS.line2);
      cx += panels.measure(sep, s);
    }
    const label = i === m.step ? `〔${st.name}〕` : st.name;
    const w = panels.measure(label, s);
    const color = i === m.step ? COLORS.head : i <= reach ? COLORS.text : COLORS.line2;
    panels.text(ctx, s, label, cx, y, color);
    if (i <= reach && i !== m.step) out.push({ rect: { x: cx, y, w, h: s.lineHeight }, i });
    cx += w;
  });
  return out;
}

function drawRows(ctx, s, panels, m, area) {
  const out = [];
  const rowH = Math.round(s.lineHeight * 1.4);
  const textY = Math.round((rowH - s.lineHeight) / 2);
  const c = m.state;
  let y = area.y;
  let group = null;
  m.rows().forEach((r, i) => {
    if (r.group && r.group !== group) {
      group = r.group;
      panels.text(ctx, s, group, area.x, y + textY, COLORS.dim);
      y += rowH;
    }
    const rect = { x: area.x, y, w: area.w, h: rowH };
    if (i === m.cursor) panels.box(ctx, rect, COLORS.panel2, COLORS.line2);
    const color = r.off && !r.on ? COLORS.line2 : r.next ? COLORS.head : COLORS.text;
    // 可以多選或切換的（技能、裝備）畫 ◆／◇；一選就往下一步的（種族、職業、背景）只在選中的那項畫 ◆
    const toggle = r.skill || r.item;
    const mark = r.next || r.attr || r.key === 'ok' || r.key === 'reroll' ? '' : r.on ? '◆ ' : toggle ? '◇ ' : '　';
    const num = i < 9 ? `${i + 1}  ` : '   ';
    let label = `${num}${mark}${r.icon ? `${r.icon} ` : ''}${r.label}`;
    const hit = { rect, i };
    if (r.attr) {
      const base = m.race().attrs[r.attr];
      const v = base + (c.bonus[r.attr] ?? 0);
      label += `　${v}（${signed(attrMod(v))}）`;
      // 右邊的 - 與 + 按鈕
      const bw = panels.measure('[ + ]', s);
      hit.plus = { x: rect.x + rect.w - bw - s.pad * 2, y, w: bw, h: rowH };
      hit.minus = { x: hit.plus.x - bw - s.pad * 2, y, w: bw, h: rowH };
      panels.text(ctx, s, '[ - ]', hit.minus.x, y + textY, r.minus ? COLORS.text : COLORS.line2);
      panels.text(ctx, s, '[ + ]', hit.plus.x, y + textY, r.plus ? COLORS.good : COLORS.line2);
    }
    panels.text(ctx, s, label, rect.x + s.pad * 2, y + textY, color);
    out.push(hit);
    y += rowH;
  });
  return out;
}

function drawDetail(ctx, s, panels, data, m, stepId, area) {
  const measure = (ch) => panels.measure(ch, s);
  let y = area.y;
  for (const l of detailLines(data, m, stepId)) {
    for (const part of wrap(l.text, area.w, measure)) {
      if (y + s.lineHeight > area.y + area.h) return;
      panels.text(ctx, s, part, area.x, y, l.color ?? COLORS.text);
      y += s.lineHeight;
    }
  }
}

// steps：建角的步驟（app/creation-model.js 的 STEPS）
export function drawCreation(ctx, s, panels, data, m, steps) {
  const stepId = steps[m.step].id;
  const body = panels.screenBox(ctx, s, '建立角色');
  const path = drawPath(ctx, s, panels, m, steps, body.x, body.y);
  panels.rule(ctx, s, body.x, body.y + s.lineHeight, body.w);
  const top = body.y + s.lineHeight * 2 + s.pad * 2;
  const bottom = body.y + body.h - s.lineHeight;
  const leftW = Math.floor(body.w * 0.34);
  const gapX = s.pad * 8;
  const left = { x: body.x, y: top, w: leftW, h: bottom - top - s.pad * 2 };
  const right = { x: body.x + leftW + gapX, y: top, w: body.w - leftW - gapX, h: left.h };
  ctx.fillStyle = COLORS.line;
  ctx.fillRect(body.x + leftW + Math.floor(gapX / 2), top, Math.max(1, s.scale), left.h);
  const rows = drawRows(ctx, s, panels, m, left);
  drawDetail(ctx, s, panels, data, m, stepId, right);
  panels.text(ctx, s, stepId === 'points' ? HELP_POINTS : HELP, body.x, bottom, COLORS.dim);
  return { rows, path };
}
