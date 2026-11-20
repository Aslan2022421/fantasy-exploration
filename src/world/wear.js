// 耐久（階段 9，數字沿用舊版）：武器 200、盾牌 100、護甲 150；無護甲沒有耐久。
// 冒險者的 sheet 記用掉多少：wear { weapon, shield, armor }（身上的三格），itemWear [⋯]（跟背包的 items 一一對應）；
// 沒記的當 0。剩一半以下「磨損」傷害或減免 −1，四分之一以下「破損」−2；用到上限就壞掉（craft.js 記一筆 break）

export const DURABILITY = { weapon: 200, shield: 100, armor: 150 };
export const SLOTS = ['weapon', 'shield', 'armor'];
const NONE = 'no-armor';

// 這件裝備的耐久上限（放在 slot 那一格）；沒有耐久回傳 0
export const maxOf = (slot, id) => (!id || id === NONE ? 0 : DURABILITY[slot]);

// 用掉 used、上限 max：減幾點
export function penalty(used, max) {
  if (!max) return 0;
  const left = (max - used) / max;
  return left <= 0.25 ? 2 : left <= 0.5 ? 1 : 0;
}

// 身上那一格現在減幾點
export const slotPenalty = (sheet, slot) => penalty(sheet.wear?.[slot] ?? 0, maxOf(slot, sheet.gear[slot]));

// 剩下的耐久文字：「耐久 150/200（磨損）」；沒有耐久回傳 null
export function wearText(slot, id, used = 0) {
  const max = maxOf(slot, id);
  if (!max) return null;
  const p = penalty(used, max);
  return `耐久 ${max - used}/${max}${p === 2 ? '（破損）' : p === 1 ? '（磨損）' : ''}`;
}

// 一次攻擊或挨打要磨哪幾格：冒險者出手磨武器；被打中而護甲擋下傷害磨護甲；沒被打中而拿著盾牌磨盾牌
export function wearFor(sheet, { attacking = false, hit = false } = {}) {
  const has = (slot) => maxOf(slot, sheet.gear[slot]) > 0;
  if (attacking) return has('weapon') ? { weapon: 1 } : null;
  if (hit) return has('armor') ? { armor: 1 } : null;
  return has('shield') ? { shield: 1 } : null;
}

// 套上磨損（紀錄的 data.wear）
export function addWear(state, wear) {
  const h = state.hero;
  const next = { ...(h.wear ?? {}) };
  for (const [slot, n] of Object.entries(wear)) next[slot] = (next[slot] ?? 0) + n;
  return { ...state, hero: { ...h, wear: next } };
}

// 用到上限的格子：[slot]
export const brokenSlots = (sheet) =>
  SLOTS.filter((slot) => {
    const max = maxOf(slot, sheet.gear[slot]);
    return max > 0 && (sheet.wear?.[slot] ?? 0) >= max;
  });
