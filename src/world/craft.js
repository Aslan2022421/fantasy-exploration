// 製造、修理、熔煉、用掉補給品、裝備壞掉（階段 9）：算好要寫進紀錄的 data（craft-apply.js 照紀錄套）。
// 上限的帳（gather.js 的「現存數量」）：做進成品裡的材料照算；燒掉的燃料、用掉的補給品、壞掉或熔掉讓出的原料扣掉，
// 原料在礦坑、樹、草叢又會出現。成品回推原料照「做它的第一個配方」；「任一種木頭」扣現存最多的那種

import { heroStats } from './hero.js';
import { d12 } from './rules.js';
import { maxOf } from './wear.js';

export const REPAIR_SHARE = 0.25; // 修理花做它的主料的幾成（無條件進位）
export const SMELT_SHARE = 0.5; // 熔煉拿回金屬錠的幾成（無條件捨去）
export const REPAIR_TICKS = 240;
export const SMELT_TICKS = 240;
export const USE_TICKS = 60;

const recipeFor = (data, makes) =>
  data.recipes.find((r) => (makes.item ? r.makes.item === makes.item : r.makes.material === makes.material)) ?? null;
const add = (map, id, n) => {
  if (n) map[id] = (map[id] ?? 0) + n;
  return map;
};
const isRaw = (data, id) => !!data.materials[data.materialIndex.get(id)]?.cap;

// 一類材料裡挑一種：pickFrom 那份數量（背包或現存）最多的；一樣多照 id 排
function pickCategory(data, category, pickFrom, need = 0) {
  const ids = data.materials.filter((m) => m.category === category).map((m) => m.id);
  const ok = ids.filter((id) => (pickFrom[id] ?? 0) >= need);
  const list = ok.length ? ok : ids;
  return list.sort((a, b) => (pickFrom[b] ?? 0) - (pickFrom[a] ?? 0) || a.localeCompare(b))[0];
}

// 配方的材料換成實際的材料 id：{ id: 數量 }（category 從 pickFrom 挑）
function resolve(data, needs, pickFrom, times = 1) {
  const out = {};
  for (const n of needs) add(out, n.material ?? pickCategory(data, n.category, pickFrom, n.n * times), n.n * times);
  return out;
}

// 成品（{ item } 或 { material }）n 個回推成採來的原料：{ 原料: 數量 }；回推不了（沒有配方的裝備）回傳 {}
export function rawOf(data, makes, n, stock) {
  if (makes.material && isRaw(data, makes.material)) return { [makes.material]: n };
  const r = recipeFor(data, makes);
  if (!r) return {};
  const out = {};
  for (const [id, k] of Object.entries(resolve(data, r.needs, stock))) {
    const sub = rawOf(data, { material: id }, (k * n) / r.makes.n, stock);
    for (const [m, v] of Object.entries(sub)) add(out, m, v);
  }
  for (const m of Object.keys(out)) out[m] = Math.ceil(out[m]);
  return out;
}

const has = (bag, need) => Object.entries(need).every(([id, n]) => (bag[id] ?? 0) >= n);
const minus = (a, b) => {
  const out = { ...a };
  for (const [id, n] of Object.entries(b)) out[id] = Math.max(0, (out[id] ?? 0) - n);
  return Object.fromEntries(Object.entries(out).filter(([, n]) => n > 0));
};

// 貼著（八方向 1 格內）有沒有鐵砧
export function nearAnvil(world, data, p) {
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) if (data.objects[world.objectAt(p.x + dx, p.y + dy)]?.id === 'anvil') return true;
  return false;
}

// 能不能做：回傳 { recipe, spend, burn } 或 { refused: 'combat' | 'anvil' | 'materials' }
export function checkCraft(data, state, recipeId, anvil) {
  const r = data.recipes[data.recipeIndex.get(recipeId)];
  if (!r) return { refused: 'gone' };
  if (state.combat) return { refused: 'busy' };
  if (r.anvil && !anvil) return { refused: 'anvil' };
  const spend = resolve(data, r.needs, state.bag);
  const burn = resolve(data, r.fuel, state.bag);
  const all = { ...spend };
  for (const [id, n] of Object.entries(burn)) add(all, id, n);
  if (!has(state.bag, all)) return { refused: 'materials' };
  return { recipe: r, spend, burn };
}

// 製造：擲 1D12＋工藝等級＋（智力、敏捷取高的修正值），達到難度成功；難度 8 有材料就直接成功。
// 失敗：時間多花一倍、材料不扣；擲出 1 又失敗：做進去的材料損失一半（無條件進位）、燃料照燒
export function planCraft(data, state, recipeId, anvil, rng) {
  const c = checkCraft(data, state, recipeId, anvil);
  if (c.refused) return c;
  const r = c.recipe;
  const m = heroStats(data, state.hero).mods;
  const mod = (state.hero.skills.craft ?? 0) + Math.max(m.int, m.dex);
  const roll = d12(rng);
  const ok = r.dc <= 8 || roll + mod >= r.dc;
  const lost = !ok && roll === 1;
  const spent = ok
    ? c.spend
    : lost
      ? Object.fromEntries(Object.entries(c.spend).map(([id, n]) => [id, Math.ceil(n / 2)]))
      : {};
  return {
    recipe: r.id,
    roll,
    mod,
    dc: r.dc,
    ok,
    lost,
    spent,
    burned: ok || lost ? c.burn : {},
    made: ok ? r.makes : null,
    duration: ok ? r.ticks : r.ticks * 2,
  };
}

// 修理身上那一格：花主料的兩成五（無條件進位），修回滿；金屬的要鐵砧。沒有配方的（還做不出來的皮甲）修不了
export function planRepair(data, state, slot, anvil) {
  const id = state.hero.gear[slot];
  const used = state.hero.wear?.[slot] ?? 0;
  if (!maxOf(slot, id) || !used) return { refused: 'fine' };
  if (state.combat) return { refused: 'busy' };
  const r = recipeFor(data, { item: id });
  if (!r) return { refused: 'norecipe' };
  if (r.anvil && !anvil) return { refused: 'anvil' };
  const main = r.needs[0];
  const spent = resolve(data, [{ ...main, n: Math.ceil(main.n * REPAIR_SHARE) }], state.bag);
  if (!has(state.bag, spent)) return { refused: 'materials' };
  return {
    slot,
    item: id,
    spent,
    released: rawOf(data, { material: Object.keys(spent)[0] }, Object.values(spent)[0], state.stock),
    duration: REPAIR_TICKS,
  };
}

// 熔煉背包裡第 index 件金屬裝備：拿回做它的金屬錠的一半（無條件捨去），其餘的原料讓出上限；要鐵砧
export function planSmelt(data, state, index, anvil) {
  const id = state.hero.items[index];
  const r = id && recipeFor(data, { item: id });
  const metal = r?.needs.filter((n) => data.materials[data.materialIndex.get(n.material)]?.category === 'metal') ?? [];
  if (!metal.length) return { refused: 'nometal' };
  if (state.combat) return { refused: 'busy' };
  if (!anvil) return { refused: 'anvil' };
  const got = {};
  for (const n of metal) add(got, n.material, Math.floor(n.n * SMELT_SHARE));
  let back = {};
  for (const [m, n] of Object.entries(got)) back = { ...back, ...rawOf(data, { material: m }, n, state.stock) };
  const released = minus(rawOf(data, { item: id }, 1, state.stock), back);
  return { index, item: id, got, released, duration: SMELT_TICKS };
}

// 用掉一份補給品（繃帶、草藥膏）：回 1D12＋醫療等級＋補給品自己的加值，不超過上限；戰鬥中不行
export function planUse(data, state, material, rng) {
  const m = data.materials[data.materialIndex.get(material)];
  if (m?.category !== 'supply' || !(state.bag[material] > 0)) return { refused: 'gone' };
  if (state.combat) return { refused: 'busy' };
  const max = heroStats(data, state.hero).hpMax;
  if (state.hp >= max) return { refused: 'full' };
  const roll = d12(rng);
  const heal = roll + (state.hero.skills.medicine ?? 0) + (m.heal ?? 0);
  return {
    material,
    roll,
    heal,
    hp: Math.min(max, state.hp + heal),
    released: rawOf(data, { material }, 1, state.stock),
    duration: USE_TICKS,
  };
}

// 身上那一格壞掉：裝備消失，做它的原料讓出上限
export const planBreak = (data, state, slot) => {
  const item = state.hero.gear[slot];
  return { slot, item, released: rawOf(data, { item }, 1, state.stock) };
};
