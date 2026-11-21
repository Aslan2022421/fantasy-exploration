// B 的「製作」頁（照舊版的工匠畫面：上方分類篩選，右邊清單，左邊是選中那一項的資訊與操作）：
// 製造（配方）、修理（身上磨損的）、熔煉（背包裡的金屬裝備）、用掉補給品。
// craftRows 排出全部的項目；drawCraft 畫出來，回傳點擊範圍 { filters, rows }

import { checkCraft, planRepair, planSmelt } from '../world/craft.js';
import { amounts, itemName, madeName, materialName } from '../world/describe-craft.js';
import { heroStats } from '../world/hero.js';
import { SLOTS, wearText } from '../world/wear.js';
import { COLORS } from './colors.js';
import { drawButtons, drawHelp, drawList, split } from './ui-kit.js';

export const CRAFT_FILTERS = ['全部', '金屬錠', '武器', '護甲', '補給品', '修理', '熔煉'];
const HELP = 'Tab 換頁　← → 換分類　↑↓ 或滑鼠選　Enter 或點兩下 動手（花時間）　B 或 Esc 關閉';
const WHY = {
  busy: '戰鬥中不行。',
  anvil: '要貼著鐵砧（城鎮、城市的鐵匠舖，堡壘、要塞的工坊）。',
  materials: '材料不夠。',
  norecipe: '這件還做不出來，也修不了。',
  full: '生命是滿的，用不著。',
};
const CATEGORY = { wood: '木頭', plant: '植物', mineral: '礦石', metal: '金屬錠' };
const minutes = (ticks) => `約 ${Math.max(1, Math.round(ticks / 240))} 分鐘`;

function groupOf(data, r) {
  if (r.makes.material) return data.materials[data.materialIndex.get(r.makes.material)].category === 'metal' ? 1 : 4;
  return data.weaponIndex.has(r.makes.item) ? 2 : 3;
}

// 一項的材料清單：[{ name, have, need }]
function needList(data, state, r) {
  return [...r.needs, ...r.fuel].map((n) => {
    if (n.material) return { name: materialName(n.material), have: state.bag[n.material] ?? 0, need: n.n };
    const have = Math.max(
      0,
      ...data.materials.filter((m) => m.category === n.category).map((m) => state.bag[m.id] ?? 0),
    );
    return { name: `任一種${CATEGORY[n.category]}`, have, need: n.n };
  });
}

// 回傳 [{ kind, key, group, title, ok, why, info: [{ text, color }] }]；kind 是 game 的方法名
export function craftRows(data, state, anvil) {
  const out = [];
  const m = heroStats(data, state.hero).mods;
  const mod = (state.hero.skills.craft ?? 0) + Math.max(m.int, m.dex);
  for (const r of data.recipes) {
    const c = checkCraft(data, state, r.id, anvil);
    const chance = r.dc <= 8 ? 100 : Math.round((Math.max(0, Math.min(12, 13 - (r.dc - mod))) / 12) * 100);
    const info = [
      { text: '材料', color: COLORS.head },
      ...needList(data, state, r).map((n) => ({
        text: `　${n.name}　${n.have}／${n.need}`,
        color: n.have >= n.need ? COLORS.good : COLORS.bad,
      })),
      { text: ' ' },
      { text: `難度 ${r.dc}，你加 ${mod}，成功率 ${chance}%${r.dc <= 8 ? '（有材料就成功）' : ''}` },
      { text: `花 ${minutes(r.ticks)}；失敗時間加倍、材料不扣，擲出 1 損失一半`, color: COLORS.dim },
      {
        text: r.anvil ? (anvil ? '要鐵砧：旁邊就有。' : '要鐵砧：旁邊沒有。') : '不用鐵砧，到哪都能做。',
        color: r.anvil && !anvil ? COLORS.bad : COLORS.dim,
      },
    ];
    out.push({
      kind: 'craft',
      key: r.id,
      group: groupOf(data, r),
      title: madeName(r.makes),
      ok: !c.refused,
      why: WHY[c.refused],
      info,
    });
  }
  const h = state.hero;
  for (const s of SLOTS.filter((x) => (h.wear?.[x] ?? 0) > 0 && h.gear[x])) {
    const p = planRepair(data, state, s, anvil);
    const info = [
      { text: wearText(s, h.gear[s], h.wear[s]) },
      { text: p.refused ? '' : `花 ${amounts(p.spent)}，修回滿；${minutes(240)}` },
    ];
    out.push({
      kind: 'repair',
      key: s,
      group: 5,
      title: `修理${itemName(h.gear[s])}`,
      ok: !p.refused,
      why: WHY[p.refused],
      info,
    });
  }
  h.items.forEach((id, i) => {
    const p = planSmelt(data, state, i, anvil);
    if (p.refused === 'nometal') return;
    const info = [{ text: p.refused ? '' : `拿回 ${amounts(p.got) || '什麼都沒有'}，其餘的原料回到世界。` }];
    out.push({
      kind: 'smelt',
      key: i,
      group: 6,
      title: `熔掉${itemName(id)}`,
      ok: !p.refused,
      why: WHY[p.refused],
      info,
    });
  });
  const full = state.hp >= heroStats(data, h).hpMax;
  for (const mt of data.materials.filter((x) => x.category === 'supply' && state.bag[x.id] > 0)) {
    const info = [
      { text: `背包裡有 ${state.bag[mt.id]} 份。` },
      { text: `回 1D12＋醫療${mt.heal ? `＋${mt.heal}` : ''} 點生命，戰鬥外用。` },
    ];
    const why = full ? WHY.full : state.combat ? WHY.busy : null;
    out.push({ kind: 'use', key: mt.id, group: 4, title: `用${materialName(mt.id)}`, ok: !why, why, info });
  }
  return out;
}

// 篩選後的項目（filter 0 是全部）
export const filtered = (rows, filter) => (filter ? rows.filter((r) => r.group === filter) : rows);

// ui：{ cursor, filter }
export function drawCraft(ctx, s, panels, rows, ui, anvil, body) {
  const b = drawHelp(ctx, s, panels, body, HELP);
  const f = drawButtons(ctx, s, panels, b.x, b.y, CRAFT_FILTERS, ui.filter, { strong: false });
  const top = b.y + f.h + s.pad * 3;
  const { left, right } = split(ctx, s, { x: b.x, y: top, w: b.w, h: b.y + b.h - top }, 0.42);
  const list = filtered(rows, ui.filter);
  const cur = list[ui.cursor];
  // 左：選中那一項
  let y = left.y;
  panels.text(
    ctx,
    s,
    anvil ? '旁邊有鐵砧。' : '旁邊沒有鐵砧，金屬的做不了。',
    left.x,
    y,
    anvil ? COLORS.good : COLORS.dim,
  );
  y += s.lineHeight * 1.8;
  if (cur) {
    panels.text(ctx, s, cur.title, left.x, y, COLORS.head);
    y += s.lineHeight * 1.5;
    for (const line of cur.info) y += panels.para(ctx, s, line.text, left.x, y, left.w, line.color ?? COLORS.text);
    y += s.lineHeight;
    panels.para(
      ctx,
      s,
      cur.ok ? 'Enter 或點兩下動手。' : `做不了：${cur.why ?? ''}`,
      left.x,
      y,
      left.w,
      cur.ok ? COLORS.good : COLORS.bad,
    );
  } else panels.text(ctx, s, '這一類沒有東西。', left.x, y, COLORS.dim);
  // 右：清單（做得了的亮、做不了的暗）
  const shown = list.map((r) => ({
    text: r.title,
    color: r.ok ? COLORS.text : COLORS.dim,
    mark: r.ok ? '•' : '·',
    markColor: r.ok ? COLORS.good : COLORS.line2,
  }));
  const l = drawList(ctx, s, panels, right, shown, ui.cursor);
  return { filters: f.hits, rows: l.hits };
}
