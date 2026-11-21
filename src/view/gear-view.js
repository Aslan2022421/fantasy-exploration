// B 的「裝備」頁（照舊版第三十七版的背包）：上方分類篩選；左邊三個裝備格（點了選中，可以脫下）與選中那一件的說明、
// 換上或脫下之後的差別；右邊是背包依分類分組的清單（身上、武器、防具、礦物、木材⋯⋯）。
// gearChoices 排出能選的東西，drawGear 畫出來，回傳點擊範圍 { filters, rows, slots }

import { equip, heroStats, unequip } from '../world/hero.js';
import { wearText } from '../world/wear.js';
import { COLORS } from './colors.js';
import { armorOf, itemText, signed, weaponOf } from './names.js';
import { drawButtons, drawHelp, drawList, split } from './ui-kit.js';

export const GEAR_FILTERS = ['全部', '身上', '武器', '防具', '材料', '補給品'];
const HELP = 'Tab 換頁　← → 換分類　↑↓ 或滑鼠選　Enter 或點兩下 換上、脫下、使用（花一個動作）　B 或 Esc 關閉';
const SLOT_NAMES = { weapon: '主手', shield: '副手', armor: '身上' };
const MATERIAL_GROUPS = [
  ['mineral', '礦物', '塊'],
  ['wood', '木材', '段'],
  ['plant', '植物', '株'],
  ['animal', '動物部位', '份'],
  ['metal', '金屬錠', '個'],
  ['supply', '補給品', '份'],
];

// 能選的東西：[{ kind, group 分組標題, filter 屬於哪個篩選, ... }]；kind 是 unequip、equip、use（補給品）、none（材料只看）
export function gearChoices(data, hero, bag) {
  const out = [];
  for (const slot of ['weapon', 'shield', 'armor']) {
    const id = hero.gear[slot];
    if (id && id !== 'no-armor') out.push({ kind: 'unequip', slot, id, group: '身上', filter: 1 });
  }
  hero.items.forEach((id, index) => {
    if (weaponOf(data, id)) out.push({ kind: 'equip', id, index, group: '武器', filter: 2 });
  });
  hero.items.forEach((id, index) => {
    if (!weaponOf(data, id) && armorOf(data, id)) out.push({ kind: 'equip', id, index, group: '防具', filter: 3 });
  });
  for (const [cat, title, unit] of MATERIAL_GROUPS)
    for (const m of data.materials.filter((x) => x.category === cat && bag[x.id] > 0))
      out.push({
        kind: cat === 'supply' ? 'use' : 'none',
        id: m.id,
        name: m.name,
        count: `${bag[m.id]} ${unit}`,
        group: title,
        filter: cat === 'supply' ? 5 : 4,
      });
  return out;
}
export const filteredGear = (list, filter) => (filter ? list.filter((c) => c.filter === filter) : list);

// 換上或脫下之後的差別：[「攻擊 1d12+2 → +3」⋯⋯]；不能換回傳原因
export function compare(data, hero, choice) {
  const next = choice.kind === 'unequip' ? unequip(hero, choice.slot) : equip(data, hero, choice.id);
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

function slotBox(ctx, s, panels, data, rect, label, id, note, wear, on) {
  panels.box(ctx, rect, on ? COLORS.panel2 : COLORS.bg, on ? COLORS.head : COLORS.line);
  const x = rect.x + s.pad * 2;
  panels.text(ctx, s, label, x, rect.y + s.pad, COLORS.dim);
  if (!id || id === 'no-armor')
    return panels.text(ctx, s, note ?? '（空）', x, rect.y + s.pad + s.lineHeight, COLORS.line2);
  const it = itemText(data, id);
  panels.text(ctx, s, wear ? `${it.name}　${wear}` : it.name, x, rect.y + s.pad + s.lineHeight, COLORS.head);
  panels.text(ctx, s, note ?? it.text, x, rect.y + s.pad + s.lineHeight * 2, note ? COLORS.bad : COLORS.text);
}

// 選中那一件：名稱、說明、耐久、換上或脫下之後的差別、能做什麼
function detail(ctx, s, panels, data, state, cur, x, y, w) {
  const hero = state.hero;
  if (!cur) return panels.text(ctx, s, '這一類沒有東西。', x, y, COLORS.dim);
  if (cur.kind === 'none' || cur.kind === 'use') {
    panels.text(ctx, s, `${cur.name}　${cur.count}`, x, y, COLORS.head);
    const hint = cur.kind === 'use' ? 'Enter 或點兩下使用（戰鬥外，回生命）。' : '材料：拿去 B 的「製作」頁用。';
    return panels.para(ctx, s, hint, x, y + s.lineHeight * 1.5, w, COLORS.dim);
  }
  const it = itemText(data, cur.id);
  const used = cur.kind === 'unequip' ? (hero.wear?.[cur.slot] ?? 0) : (hero.itemWear?.[cur.index] ?? 0);
  const slot =
    cur.kind === 'unequip'
      ? cur.slot
      : weaponOf(data, cur.id)
        ? 'weapon'
        : armorOf(data, cur.id)?.kind === 'shield'
          ? 'shield'
          : 'armor';
  panels.text(ctx, s, it.name, x, y, COLORS.head);
  let ly = y + s.lineHeight * 1.3;
  ly += panels.para(ctx, s, it.text, x, ly, w);
  const wt = wearText(slot, cur.id, used);
  if (wt) ly += panels.para(ctx, s, wt, x, ly, w, COLORS.dim);
  ly += s.lineHeight * 0.5;
  const c = compare(data, hero, cur);
  const verb = cur.kind === 'unequip' ? '脫下' : '換上';
  const lines = c.refused ? [c.refused] : c.lines.length ? [`${verb}之後：`, ...c.lines] : [`${verb}之後數字不變。`];
  lines.forEach((l, i) => {
    ly += panels.para(ctx, s, l, x, ly, w, c.refused ? COLORS.bad : i ? COLORS.good : COLORS.dim);
  });
  panels.para(ctx, s, `Enter 或點兩下${verb}（花一個動作）。`, x, ly + s.lineHeight * 0.5, w, COLORS.dim);
}

// ui：{ cursor, filter }
export function drawGear(ctx, s, panels, data, state, ui, body) {
  const hero = state.hero;
  const h = heroStats(data, hero);
  const b = drawHelp(ctx, s, panels, body, HELP);
  const f = drawButtons(ctx, s, panels, b.x, b.y, GEAR_FILTERS, ui.filter, { strong: false });
  const top = b.y + f.h + s.pad * 3;
  const { left, right } = split(ctx, s, { x: b.x, y: top, w: b.w, h: b.y + b.h - top }, 0.42);
  const list = filteredGear(gearChoices(data, hero, state.bag), ui.filter);
  const cur = list[ui.cursor];

  // 左：三個裝備格（點了選中那一件）
  const slotH = s.lineHeight * 3 + s.pad * 2;
  const slots = [];
  let y = left.y;
  for (const slot of ['weapon', 'shield', 'armor']) {
    const rect = { x: left.x, y, w: left.w, h: slotH };
    const id = hero.gear[slot];
    const note =
      slot === 'weapon' && !id ? '徒手' : slot === 'shield' && h.weapon.twoHanded && id ? '雙手武器，盾牌不能用' : null;
    const on = cur?.kind === 'unequip' && cur.slot === slot;
    slotBox(ctx, s, panels, data, rect, SLOT_NAMES[slot], id, note, wearText(slot, id, hero.wear?.[slot] ?? 0), on);
    slots.push({ rect, slot });
    y += slotH + s.pad * 2;
  }
  y += s.pad;
  panels.rule(ctx, s, left.x, y, left.w);
  detail(ctx, s, panels, data, state, cur, left.x, y + s.lineHeight * 1.5, left.w);

  // 右：依分類分組的清單
  const rows = [];
  let group = null;
  for (const c of list) {
    if (c.group !== group) {
      rows.push({ heading: c.group });
      group = c.group;
    }
    if (c.kind === 'none' || c.kind === 'use') rows.push({ text: c.name, note: c.count, color: COLORS.text });
    else {
      const it = itemText(data, c.id);
      const used = c.kind === 'unequip' ? (hero.wear?.[c.slot] ?? 0) : (hero.itemWear?.[c.index] ?? 0);
      const slot =
        c.kind === 'unequip'
          ? c.slot
          : weaponOf(data, c.id)
            ? 'weapon'
            : armorOf(data, c.id)?.kind === 'shield'
              ? 'shield'
              : 'armor';
      rows.push({
        text: it.name,
        note: wearText(slot, c.id, used) ?? '',
        mark: c.kind === 'unequip' ? '◘' : '•',
        markColor: c.kind === 'unequip' ? COLORS.head : COLORS.good,
      });
    }
  }
  if (!list.length) panels.text(ctx, s, '這一類沒有東西。', right.x, right.y, COLORS.dim);
  const l = drawList(ctx, s, panels, right, rows, ui.cursor);
  // 點裝備格：選中身上那一件（在目前的篩選裡找）
  const slotHits = slots
    .map((x) => ({ rect: x.rect, i: list.findIndex((c) => c.kind === 'unequip' && c.slot === x.slot) }))
    .filter((x) => x.i >= 0);
  return { filters: f.hits, rows: [...l.hits, ...slotHits] };
}
