import { RNG } from 'rot-js';
import { describe, expect, test } from 'vitest';
import { DATA } from '../data/load.js';
import { foeStats } from './foes.js';
import { buildSheet, equip, heroStats, presetHero, raise, skillOptions } from './hero.js';
import { attrMod, clockOf, dayOf, resolveAttack, TICKS_PER_DAY } from './rules.js';

// 照順序回傳指定點數的假骰子
const fixed = (...rolls) => ({ getUniformInt: () => rolls.shift() });

describe('判定規則', () => {
  test('屬性修正值照規則草案的表', () => {
    const table = { 1: -5, 2: -4, 3: -4, 4: -3, 7: -2, 8: -1, 9: -1, 10: 0, 11: 0, 12: 1, 15: 2, 18: 4, 19: 4, 20: 5 };
    for (const [v, m] of Object.entries(table)) expect(attrMod(Number(v))).toBe(m);
  });

  test('攻擊：達到防禦值就命中，傷害扣護甲最低 0；自然 12 多擲一顆', () => {
    expect(resolveAttack(fixed(6), { attack: 4, defense: 11, damage: 2, armor: 1 })).toMatchObject({ hit: false });
    expect(resolveAttack(fixed(7, 5), { attack: 4, defense: 11, damage: 2, armor: 1 })).toMatchObject({
      total: 11,
      hit: true,
      damage: 6,
    });
    expect(resolveAttack(fixed(7, 1), { attack: 4, defense: 11, damage: -2, armor: 3 }).damage).toBe(0);
    const crit = resolveAttack(fixed(12, 3, 4), { attack: 0, defense: 10, damage: 0, armor: 0, bonus: 4 });
    expect(crit).toMatchObject({ crit: true, dice: [3, 4], damage: 11 });
  });

  test('時鐘：開局是第 1 天早上 8 點，16 小時後換天', () => {
    expect(clockOf(0)).toBe('08:00:00');
    expect(clockOf(24)).toBe('08:00:06');
    expect(dayOf(0)).toBe(0);
    expect(dayOf((TICKS_PER_DAY / 3) * 2)).toBe(1);
  });
});

describe('冒險者與生物的數字', () => {
  // 矮人戰士：力量 14＋2＝16（+3）、敏捷 6（−2）；傭兵背景給武器戰鬥、運動；長劍、鱗甲、盾牌
  const dwarfWarrior = {
    race: 'dwarf',
    cls: 'warrior',
    rolls: { height: 5, physique: 8 }, // 矮人身高 1～9 矮小、體格 6～10 結實
    bonus: { str: 2 },
    background: 'mercenary',
    skills: ['perception', 'influence'],
    weapon: 'longsword',
    armor: 'scale',
    shield: true,
  };

  test('建角：屬性看種族、職業的 2 點加在主要屬性；背景與職業的技能；身高體格照種族表', () => {
    const sheet = buildSheet(DATA, dwarfWarrior);
    expect(sheet.attrs).toEqual({ str: 16, dex: 6, int: 10, per: 8, wil: 13, cha: 9 });
    expect(sheet.skills).toEqual({ melee: 1, athletics: 1, perception: 1, influence: 1 });
    expect(sheet).toMatchObject({ height: 0, physique: 2, background: 'mercenary', points: 0, items: [] });
    const h = heroStats(DATA, sheet);
    // 攻擊＝力量 +3＋武器戰鬥 1＋武器訓練 1；格擋＝7＋3＋1＋盾 1；閃避＝7−2＋運動 1−0＋盾 1
    expect(h).toMatchObject({ attack: 5, damage: 3, reduction: 3, parry: 12, dodge: 7, ticks: 12, hpMax: 22 });
    expect(h.defense(false)).toBe(12);
    expect(h.defense(true)).toBe(7); // 遠程只能閃避
  });

  test('人類多才多選一項技能；背景給過的技能不能再選', () => {
    const { need, options } = skillOptions(DATA, 'warrior', 'mercenary', 'human');
    expect(need).toBe(3);
    expect(options).not.toContain('melee');
    expect(options).not.toContain('athletics');
    expect(skillOptions(DATA, 'warrior', 'mercenary', 'dwarf').need).toBe(2);
  });

  test('遊俠長弓與短劍都給：長弓拿在手上、短劍在背包；換上短劍花一個動作、長弓回背包', () => {
    const sheet = presetHero(DATA, { cls: 'ranger' }, RNG.clone().setSeed(1));
    expect(sheet.gear.weapon).toBe('longbow');
    expect(sheet.items).toEqual(['shortsword']);
    expect(heroStats(DATA, sheet)).toMatchObject({ ranged: true, range: 20 });
    const swapped = equip(DATA, sheet, 'shortsword');
    expect(swapped.gear.weapon).toBe('shortsword');
    expect(swapped.items).toEqual(['longbow']);
  });

  test('雙手武器佔兩手：換上時盾牌收進背包；拿著雙手武器不能換上盾牌', () => {
    const sheet = { ...buildSheet(DATA, dwarfWarrior), items: ['longbow'] };
    const bow = equip(DATA, sheet, 'longbow');
    expect(bow.gear).toMatchObject({ weapon: 'longbow', shield: null });
    expect(bow.items).toEqual(['longsword', 'shield']);
    expect(equip(DATA, bow, 'shield')).toEqual({ refused: 'twohand' });
  });

  test('升級的屬性點：有點數才能加，最多 20', () => {
    const sheet = { ...buildSheet(DATA, dwarfWarrior), points: 1 };
    expect(raise(sheet, 'dex')).toMatchObject({ attrs: { dex: 7 }, points: 0 });
    expect(raise({ ...sheet, points: 0 }, 'dex')).toEqual({ refused: 'points' });
    expect(raise({ ...sheet, attrs: { ...sheet.attrs, str: 20 } }, 'str')).toEqual({ refused: 'max' });
  });

  test('盜賊用靈巧武器取敏捷，有背襲', () => {
    const rogue = heroStats(DATA, presetHero(DATA, { cls: 'rogue', race: 'elf' }, RNG.clone().setSeed(1)));
    // 精靈敏捷 14＋1＝15（+2）；短劍 −1
    expect(rogue).toMatchObject({ damage: 1, sneak: 4, ranged: false });
  });

  test('狼換成規則草案的欄位：HP 15、Attack +3、防禦值 10、Damage -2、Armor 1；走一格看自己的速度，攻擊一律 9 刻', () => {
    const wolf = DATA.species[DATA.speciesIndex.get('wolf')];
    expect(foeStats(wolf)).toEqual({
      hp: 15,
      attack: 3,
      defense: 10,
      damage: -2,
      armor: 1,
      moveTicks: 6,
      attackTicks: 9,
    });
    const elephant = DATA.species[DATA.speciesIndex.get('elephant')];
    expect(foeStats(elephant)).toMatchObject({ moveTicks: 9, attackTicks: 9 });
  });
});
