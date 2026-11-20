// 製造、修理、熔煉、用掉補給品、裝備壞掉的紀錄寫成給玩家看的一行字；不是這幾種回傳 undefined

import { DATA } from '../data/load.js';

const SLOT_NAMES = { weapon: '主手', shield: '副手', armor: '身上' };
const UNITS = { mineral: '塊', wood: '段', plant: '株', animal: '份', metal: '個', supply: '份' };
const signed = (n) => (n < 0 ? `-${-n}` : `+${n}`);

export const itemName = (id) =>
  DATA.weapons[DATA.weaponIndex.get(id)]?.name ?? DATA.armors[DATA.armorIndex.get(id)]?.name ?? id;
export const materialName = (id) => DATA.materials[DATA.materialIndex.get(id)]?.name ?? id;

// { 鐵錠: 3, 松木: 1 } →「3 個鐵錠、1 段松木」
export function amounts(map) {
  return Object.entries(map ?? {})
    .filter(([, n]) => n > 0)
    .map(([id, n]) => `${n} ${UNITS[DATA.materials[DATA.materialIndex.get(id)]?.category] ?? '個'}${materialName(id)}`)
    .join('、');
}
export const madeName = (m) => (m.item ? itemName(m.item) : `${m.n} ${UNITS.metal}${materialName(m.material)}`);
const recipeName = (id) => {
  const r = DATA.recipes[DATA.recipeIndex.get(id)];
  return r ? (r.makes.item ? itemName(r.makes.item) : materialName(r.makes.material)) : id;
};

export function describeCraft(rec) {
  const d = rec.data ?? {};
  switch (rec.verb) {
    case 'craft': {
      const roll = d.dc <= 8 ? '' : `（擲 ${d.roll}${signed(d.mod)}＝${d.roll + d.mod} 對難度 ${d.dc}）`;
      if (d.ok)
        return `做出${d.made.item ? '' : ' '}${madeName(d.made)}${roll}，用掉${amounts({ ...d.spent, ...d.burned })}。`;
      if (d.lost) return `做${recipeName(d.recipe)}失敗了${roll}，弄壞了${amounts(d.spent)}。`;
      return `做${recipeName(d.recipe)}沒做成${roll}，白花了一倍的時間，材料還在。`;
    }
    case 'repair':
      return `修好了${itemName(d.item)}，用掉${amounts(d.spent)}。`;
    case 'smelt':
      return `把${itemName(d.item)}熔掉，拿回${amounts(d.got) || '一點渣，什麼都沒剩'}。`;
    case 'use':
      return `用了一份${materialName(d.material)}，回 ${d.heal} 點生命（擲 ${d.roll}），現在 ${d.hp}。`;
    case 'break':
      return `${SLOT_NAMES[d.slot] ?? ''}的${itemName(d.item)}壞掉了。`;
    default:
      return undefined;
  }
}
