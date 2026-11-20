// 階段 9：製造、修理、熔煉、補給品、耐久與上限的帳（守恆）
import { RNG } from 'rot-js';
import { expect, test } from 'vitest';
import { DATA } from '../data/load.js';
import { planBreak, planCraft, planRepair, planSmelt, planUse, rawOf } from './craft.js';
import { apply } from './game-state.js';
import { equip, heroStats, presetHero } from './hero.js';
import { addWear, brokenSlots, DURABILITY } from './wear.js';

const hero = presetHero(DATA, { race: 'human', cls: 'warrior' }, RNG.clone().setSeed(1));
const base = (bag, stock = bag) => ({ bag: { ...bag }, stock: { ...stock }, hero, hp: 5, combat: null, time: 0 });
let id = 0;
const run = (state, verb, data) =>
  apply(state, { id: id++, time: state.time, actor: 'player', verb, target: null, data, cause: null });
const rng = (seed) => RNG.clone().setSeed(Math.imul(seed + 1, 2654435761) >>> 0); // 小的種子打散開來

test('長劍回推成原料：3 個鐵錠＝6 塊鐵礦，加 1 段木頭（扣現存最多的那種）', () => {
  expect(rawOf(DATA, { item: 'longsword' }, 1, { 'oak-wood': 3, 'pine-wood': 1 })).toEqual({
    'iron-ore': 6,
    'oak-wood': 1,
  });
});

test('鐵錠要鐵砧與材料；燒掉的煤讓出上限，做進鐵錠的鐵礦還算著', () => {
  const s = base({ 'iron-ore': 2, coal: 1 });
  expect(planCraft(DATA, s, 'iron-ingot', false, rng(1)).refused).toBe('anvil');
  expect(planCraft(DATA, base({ 'iron-ore': 1, coal: 1 }), 'iron-ingot', true, rng(1)).refused).toBe('materials');
  const plan = planCraft(DATA, s, 'iron-ingot', true, rng(1));
  expect(plan.ok).toBe(true); // 難度 8 有材料就成功
  const after = run(s, 'craft', plan);
  expect(after.bag).toMatchObject({ 'iron-ore': 0, coal: 0, 'iron-ingot': 1 });
  expect(after.stock).toMatchObject({ 'iron-ore': 2, coal: 0 });
  expect(after.time).toBe(plan.duration);
});

test('難度高的會失敗：沒做成材料不扣、時間加倍；擲 1 失敗損失一半材料', () => {
  const s = base({ 'iron-ingot': 3, 'oak-wood': 1 });
  const plans = Array.from({ length: 60 }, (_, i) => planCraft(DATA, s, 'longsword', true, rng(i)));
  const fail = plans.find((p) => !p.ok && !p.lost);
  expect(fail.spent).toEqual({});
  expect(fail.duration).toBe(DATA.recipes[DATA.recipeIndex.get('longsword')].ticks * 2);
  const lost = plans.find((p) => p.lost);
  if (lost) expect(lost.spent).toEqual({ 'iron-ingot': 2, 'oak-wood': 1 });
  expect(plans.some((p) => p.ok)).toBe(true);
});

test('守恆：採到的鐵礦做成長劍還算著上限，長劍壞掉才讓出；煤做鐵錠時就讓出', () => {
  let s = base({ 'iron-ore': 6, coal: 3, 'oak-wood': 1 });
  for (let i = 0; i < 3; i++) s = run(s, 'craft', planCraft(DATA, s, 'iron-ingot', true, rng(i)));
  let p = planCraft(DATA, s, 'longsword', true, rng(7));
  for (let k = 8; !p.ok; k++) p = planCraft(DATA, s, 'longsword', true, rng(k));
  s = run(s, 'craft', p);
  expect(s.stock).toMatchObject({ 'iron-ore': 6, coal: 0, 'oak-wood': 1 });
  expect(s.hero.items.at(-1)).toBe('longsword');
  s = { ...s, hero: equip(DATA, s.hero, 'longsword') };
  s = addWear(s, { weapon: DURABILITY.weapon });
  expect(brokenSlots(s.hero)).toEqual(['weapon']);
  s = run(s, 'break', planBreak(DATA, s, 'weapon'));
  expect(s.hero.gear.weapon).toBe(null);
  expect(s.stock).toMatchObject({ 'iron-ore': 0, 'oak-wood': 0 });
  expect(heroStats(DATA, s.hero).weapon.name).toBe('徒手');
});

test('耐久：剩一半傷害 −1、四分之一 −2；換裝時耐久跟著那一件走', () => {
  const h0 = heroStats(DATA, hero).damage;
  const worn = (n) => heroStats(DATA, { ...hero, wear: { weapon: n } }).damage;
  expect(worn(99)).toBe(h0);
  expect(worn(100)).toBe(h0 - 1);
  expect(worn(150)).toBe(h0 - 2);
  const sheet = { ...hero, items: ['dagger'], itemWear: [30], wear: { weapon: 120 } };
  const next = equip(DATA, sheet, 'dagger');
  expect(next.wear.weapon).toBe(30);
  expect(next.itemWear).toEqual([120]);
});

test('修理花主料的兩成五、修回滿；熔煉拿回一半金屬錠；繃帶回生命、用掉的亞麻讓出上限', () => {
  const s = {
    ...base({ 'iron-ingot': 1, flax: 2 }),
    hero: { ...hero, gear: { ...hero.gear, weapon: 'longsword' }, wear: { weapon: 50 } },
  };
  const r = planRepair(DATA, s, 'weapon', true);
  expect(r.spent).toEqual({ 'iron-ingot': 1 });
  expect(run(s, 'repair', r).hero.wear.weapon).toBe(0);
  expect(planRepair(DATA, s, 'weapon', false).refused).toBe('anvil');
  const withSword = { ...s, hero: { ...s.hero, items: ['longsword'] }, stock: { 'iron-ore': 6, 'oak-wood': 1 } };
  const m = planSmelt(DATA, withSword, 0, true);
  expect(m.got).toEqual({ 'iron-ingot': 1 });
  expect(m.released).toEqual({ 'iron-ore': 4, 'oak-wood': 1 });
  const b = run(
    base({ bandage: 1 }, { flax: 2 }),
    'use',
    planUse(DATA, base({ bandage: 1 }, { flax: 2 }), 'bandage', rng(3)),
  );
  expect(b.hp).toBeGreaterThan(5);
  expect(b.stock.flax).toBe(0);
  expect(b.bag.bandage).toBe(0);
});
