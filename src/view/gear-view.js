// B 裝備頁：左邊三個裝備格（主手、副手、身上）與選中那一件的說明、換上之後的差別；右邊是背包清單
// （武器、防具可以選來換上；材料只列出來）。回傳點擊範圍 { rows: [{ rect, id }] }

import { equip, heroStats } from '../world/hero.js';
import { bagEntries } from './bag.js';
import { COLORS } from './colors.js';
import { armorOf, itemText, signed, weaponOf } from './names.js';

const HELP = '↑↓ 或滑鼠選　Enter 或點兩下 換上（花一個動作）　B 或 Esc 關閉';

// 背包裡能換上的裝備，武器在前、防具在後
export function gearItems(data, hero) {
  const weapons = hero.items.filter((id) => weaponOf(data, id));
  const armors = hero.items.filter((id) => !weaponOf(data, id) && armorOf(data, id));
  return [...weapons, ...armors];
}

// 換上 id 之後的差別：[「攻擊 1d12+2 → +3」⋯⋯]；不能換回傳原因
export function compare(data, hero, id) {
  const next = equip(data, hero, id);
  if (next.refused === 'twohand') return { refused: '拿著雙手武器，不能用盾牌。' };
  if (next.refused) return { refused: '這件不在背包裡。' };
  const a = heroStats(data, hero);
  const b = heroStats(data, next);
  const diff = (name, x, y, fmt = signed) => (x === y ? null : `${name} ${fmt(x)} → ${fmt(y)}`);
  const plain = (n) => `${n}`;
  return {
    lines: [
      diff('攻擊 1d12', a.attack, b.attack),
      diff('傷害 1d12', a.damage, b.damage),
      diff('閃避', a.dodge, b.dodge, plain),
      diff('格擋', a.parry, b.parry, plain),
      diff('減免', a.reduction, b.reduction, plain),
      a.range !== b.range ? `射程 ${a.range} → ${b.range} 格` : null,
    ].filter(Boolean),
  };
}

function slot(ctx, s, panels, data, rect, label, id, note) {
  panels.box(ctx, rect);
  const x = rect.x + s.pad * 2;
  panels.text(ctx, s, label, x, rect.y + s.pad, COLORS.dim);
  if (!id) return panels.text(ctx, s, note ?? '（空）', x, rect.y + s.pad + s.lineHeight, COLORS.line2);
  const it = itemText(data, id);
  panels.text(ctx, s, it.name, x, rect.y + s.pad + s.lineHeight, COLORS.head);
  panels.text(ctx, s, note ?? it.text, x, rect.y + s.pad + s.lineHeight * 2, note ? COLORS.bad : COLORS.text);
}

// ui：{ cursor }（背包清單裡游標在第幾件）
export function drawGear(ctx, s, panels, data, state, ui, body) {
  const hero = state.hero;
  const h = heroStats(data, hero);
  const leftW = Math.floor(body.w * 0.42);
  const gapX = s.pad * 8;
  const slotH = s.lineHeight * 3 + s.pad * 2;
  let y = body.y;
  const twoHanded = h.weapon.twoHanded && hero.gear.shield;
  slot(ctx, s, panels, data, { x: body.x, y, w: leftW, h: slotH }, '主手', hero.gear.weapon);
  y += slotH + s.pad * 2;
  const offNote = twoHanded ? '雙手武器，盾牌不能用' : null;
  slot(ctx, s, panels, data, { x: body.x, y, w: leftW, h: slotH }, '副手', hero.gear.shield, offNote);
  y += slotH + s.pad * 2;
  slot(ctx, s, panels, data, { x: body.x, y, w: leftW, h: slotH }, '身上', hero.gear.armor);
  y += slotH + s.pad * 3;
  panels.rule(ctx, s, body.x, y, leftW);
  y += s.lineHeight * 1.5;

  // 選中那一件的說明與換上之後的差別
  const items = gearItems(data, hero);
  const cur = items[Math.min(ui.cursor, items.length - 1)];
  if (cur) {
    const it = itemText(data, cur);
    panels.text(ctx, s, it.name, body.x, y, COLORS.head);
    panels.text(ctx, s, it.text, body.x, y + s.lineHeight, COLORS.text);
    const c = compare(data, hero, cur);
    const lines = c.refused ? [c.refused] : c.lines.length ? ['換上之後：', ...c.lines] : ['換上之後數字不變。'];
    lines.forEach((l, i) => {
      panels.text(
        ctx,
        s,
        l,
        body.x,
        y + s.lineHeight * (2.5 + i),
        c.refused ? COLORS.bad : i ? COLORS.good : COLORS.dim,
      );
    });
  } else panels.text(ctx, s, '背包裡沒有可以換上的裝備。', body.x, y, COLORS.dim);

  // 右邊：背包清單
  const rx = body.x + leftW + gapX;
  const rw = body.w - leftW - gapX;
  ctx.fillStyle = COLORS.line;
  ctx.fillRect(body.x + leftW + Math.floor(gapX / 2), body.y, Math.max(1, s.scale), body.h - s.lineHeight * 2);
  let ry = body.y;
  const rows = [];
  const heading = (t) => {
    panels.text(ctx, s, t, rx, ry, COLORS.head);
    ry += s.lineHeight * 1.2;
  };
  const rowH = Math.round(s.lineHeight * 1.3);
  const listRow = (id, i) => {
    const rect = { x: rx, y: ry, w: rw, h: rowH };
    if (i === ui.cursor) panels.box(ctx, rect, COLORS.panel2, COLORS.line2);
    const it = itemText(data, id);
    panels.text(
      ctx,
      s,
      `${it.name}　${it.text}`,
      rx + s.pad * 2,
      ry + Math.round((rowH - s.lineHeight) / 2),
      COLORS.text,
    );
    rows.push({ rect, id, i });
    ry += rowH;
  };
  const weapons = items.filter((id) => weaponOf(data, id));
  const armors = items.filter((id) => !weaponOf(data, id));
  if (weapons.length) heading('武器');
  for (const id of weapons) listRow(id, items.indexOf(id));
  if (armors.length) heading('防具');
  for (const id of armors) listRow(id, items.indexOf(id));
  if (!items.length) {
    panels.text(ctx, s, '背包裡沒有裝備。', rx, ry, COLORS.dim);
    ry += s.lineHeight * 1.2;
  }
  ry += s.lineHeight * 0.5;
  const materials = Object.values(state.bag).some((n) => n > 0) ? bagEntries(state.bag, data) : [];
  if (!materials.length) panels.text(ctx, s, '材料：沒有', rx, ry, COLORS.dim);
  for (const e of materials) {
    if (ry + s.lineHeight > body.y + body.h - s.lineHeight * 2) break;
    panels.text(ctx, s, e.text, rx, ry, e.color ?? COLORS.text);
    ry += s.lineHeight;
  }
  panels.text(ctx, s, HELP, body.x, body.y + body.h - s.lineHeight, COLORS.dim);
  return { rows };
}
