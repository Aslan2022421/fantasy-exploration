import { RNG } from 'rot-js';
import { describe, expect, test } from 'vitest';
import { DATA } from '../data/load.js';
import { foeStats } from './foes.js';
import { heroStats, presetHero } from './hero.js';
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
  test('預設的人類戰士：攻擊 +4、格擋 11、傷害 +2、鱗甲減免 3、每個動作 12／9／6 刻', () => {
    const sheet = presetHero(DATA, {}, RNG.clone().setSeed(1));
    const h = heroStats(DATA, sheet);
    expect(sheet).toMatchObject({ race: 'human', cls: 'warrior', level: 1 });
    expect(sheet.skills).toMatchObject({ melee: 1, athletics: 1, perception: 1 }); // 人類多一項
    expect(h).toMatchObject({ attack: 4, damage: 2, reduction: 3, parry: 11, dodge: 10 });
    expect(h.defense(false)).toBe(11);
    expect(h.defense(true)).toBe(10); // 遠程只能閃避
    expect(h.ticks).toBe([12, 9, 6][sheet.height]);
    expect([14, 18, 22, 26]).toContain(h.hpMax);
  });

  test('盜賊用靈巧武器取敏捷，有背襲；遊俠拿長弓是遠程', () => {
    const rogue = heroStats(DATA, presetHero(DATA, { cls: 'rogue' }, RNG.clone().setSeed(1)));
    expect(rogue).toMatchObject({ attack: 2, damage: 1, sneak: 4, ranged: false });
    const ranger = heroStats(DATA, presetHero(DATA, { cls: 'ranger' }, RNG.clone().setSeed(1)));
    expect(ranger).toMatchObject({ ranged: true, range: 20, attack: 3, damage: 0 });
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
