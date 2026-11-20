// B 的「製作」頁：製造（配方）、修理（身上磨損的）、熔煉（背包裡的金屬裝備）、用掉補給品。
// craftRows 排出清單（能不能做、做不了的原因），drawCraft 畫出來並回傳點擊範圍 { rows: [{ rect, i }] }

import { checkCraft, planRepair, planSmelt } from '../world/craft.js';
import { amounts, itemName, madeName, materialName } from '../world/describe-craft.js';
import { heroStats } from '../world/hero.js';
import { SLOTS, wearText } from '../world/wear.js';
import { COLORS } from './colors.js';

const HELP = 'Tab 換頁　↑↓ 或滑鼠選　Enter 或點兩下 動手（花時間）　B 或 Esc 關閉';
const WHY = {
  busy: '戰鬥中不行',
  anvil: '要貼著鐵砧',
  materials: '材料不夠',
  norecipe: '還做不出來，修不了',
  nometal: '不是金屬',
  full: '生命是滿的',
};
const CATEGORY = { wood: '木頭', plant: '植物', mineral: '礦石', metal: '金屬錠' };

const needText = (r) =>
  [...r.needs, ...r.fuel]
    .map((n) => `${n.material ? materialName(n.material) : `任一種${CATEGORY[n.category]}`} ${n.n}`)
    .join('、');

// 回傳 [{ heading } 或 { kind, key, title, detail, ok, why }]；kind 是 game 的方法名
export function craftRows(data, state, anvil) {
  const rows = [{ heading: '製作' }];
  for (const r of data.recipes) {
    const c = checkCraft(data, state, r.id, anvil);
    rows.push({
      kind: 'craft',
      key: r.id,
      title: madeName(r.makes),
      detail: `${needText(r)}｜難度 ${r.dc}${r.dc <= 8 ? '（有材料就成功）' : ''}${r.anvil ? '｜要鐵砧' : ''}`,
      ok: !c.refused,
      why: WHY[c.refused],
    });
  }
  const h = state.hero;
  const repairs = SLOTS.filter((s) => (h.wear?.[s] ?? 0) > 0 && h.gear[s]);
  if (repairs.length) rows.push({ heading: '修理（身上的）' });
  for (const s of repairs) {
    const p = planRepair(data, state, s, anvil);
    const cost = p.refused ? '' : `｜花 ${amounts(p.spent)}`;
    rows.push({
      kind: 'repair',
      key: s,
      title: itemName(h.gear[s]),
      detail: `${wearText(s, h.gear[s], h.wear[s])}${cost}`,
      ok: !p.refused,
      why: WHY[p.refused],
    });
  }
  const smelts = h.items.map((id, i) => ({ id, i, p: planSmelt(data, state, i, anvil) }));
  const metal = smelts.filter((x) => x.p.refused !== 'nometal');
  if (metal.length) rows.push({ heading: '熔煉（背包裡的金屬裝備）' });
  for (const { id, i, p } of metal)
    rows.push({
      kind: 'smelt',
      key: i,
      title: itemName(id),
      detail: p.refused ? '' : `拿回 ${amounts(p.got) || '什麼都沒有'}`,
      ok: !p.refused,
      why: WHY[p.refused],
    });
  const supplies = data.materials.filter((m) => m.category === 'supply' && state.bag[m.id] > 0);
  if (supplies.length) rows.push({ heading: '補給品' });
  const full = state.hp >= heroStats(data, h).hpMax;
  for (const m of supplies)
    rows.push({
      kind: 'use',
      key: m.id,
      title: `${materialName(m.id)} ×${state.bag[m.id]}`,
      detail: `回 1D12＋醫療${m.heal ? `＋${m.heal}` : ''} 點生命（戰鬥外）`,
      ok: !full && !state.combat,
      why: full ? WHY.full : state.combat ? WHY.busy : null,
    });
  return rows;
}

// 能動手的那幾列（游標只走這些）
export const pickable = (rows) => rows.map((r, i) => (r.heading ? -1 : i)).filter((i) => i >= 0);

// ui：{ cursor }（第幾個能動手的列）
export function drawCraft(ctx, s, panels, rows, ui, anvil, body) {
  const picks = pickable(rows);
  const cur = picks[Math.min(ui.cursor, picks.length - 1)];
  panels.text(
    ctx,
    s,
    anvil ? '旁邊有鐵砧，金屬的也能做。' : '旁邊沒有鐵砧，只能做木頭、植物的東西。',
    body.x,
    body.y,
    anvil ? COLORS.good : COLORS.dim,
  );
  const rowH = Math.round(s.lineHeight * 1.25);
  const bottom = body.y + body.h - s.lineHeight * 2;
  // 游標那一列看得到：從它往前推一頁
  const perPage = Math.max(1, Math.floor((bottom - body.y - s.lineHeight * 1.5) / rowH));
  const start = Math.max(0, Math.min(cur ?? 0, rows.length) - perPage + 3);
  let y = body.y + s.lineHeight * 1.5;
  const hits = [];
  const titleW = Math.floor(body.w * 0.24);
  for (let i = start; i < rows.length && y + rowH <= bottom; i++) {
    const r = rows[i];
    if (r.heading) {
      panels.text(ctx, s, r.heading, body.x, y + Math.round((rowH - s.lineHeight) / 2), COLORS.head);
    } else {
      const rect = { x: body.x, y, w: body.w, h: rowH };
      if (i === cur) panels.box(ctx, rect, COLORS.panel2, COLORS.line2);
      const ty = y + Math.round((rowH - s.lineHeight) / 2);
      panels.text(ctx, s, r.title, body.x + s.pad * 2, ty, r.ok ? COLORS.text : COLORS.dim);
      const detail = r.ok ? r.detail : `${r.detail}${r.why ? `｜${r.why}` : ''}`;
      panels.text(ctx, s, detail, body.x + titleW, ty, r.ok ? COLORS.dim : COLORS.line2);
      hits.push({ rect, i: picks.indexOf(i) });
    }
    y += rowH;
  }
  panels.text(ctx, s, HELP, body.x, body.y + body.h - s.lineHeight, COLORS.dim);
  return { rows: hits };
}
