import { RNG } from 'rot-js';
import { expect, test } from 'vitest';
import { DATA } from '../data/load.js';
import { buildSheet } from '../world/hero.js';
import { createCreation, STEPS } from './creation-model.js';

const at = (m, key) => m.rows().findIndex((r) => r.key === key);
const pick = (m, key) => m.act(at(m, key));

test('一步一步選完：種族 → 身高體格 → 職業 → 加點 → 背景 → 技能 → 裝備 → 總覽，得到能組成角色的選擇', () => {
  const m = createCreation(DATA, RNG.clone().setSeed(7));
  pick(m, 'dwarf');
  expect(STEPS[m.step].id).toBe('body');
  pick(m, 'ok');
  pick(m, 'warrior');
  expect(STEPS[m.step].id).toBe('points');
  m.plus(at(m, 'str'));
  m.plus(at(m, 'str'));
  m.plus(at(m, 'dex')); // 點數用完了，加不上去
  expect(m.state.bonus).toEqual({ str: 2 });
  pick(m, 'next');
  pick(m, 'hunter');
  pick(m, 'melee');
  pick(m, 'athletics');
  pick(m, 'perception'); // 矮人只能選 2 項
  expect(m.state.skills).toEqual(['melee', 'athletics']);
  pick(m, 'next');
  pick(m, 'w:battleaxe');
  pick(m, 'a:chain');
  pick(m, 'next');
  expect(STEPS[m.step].id).toBe('summary');
  pick(m, 'start');
  const sheet = buildSheet(DATA, m.done);
  expect(sheet).toMatchObject({ race: 'dwarf', cls: 'warrior', background: 'hunter' });
  expect(sheet.attrs.str).toBe(16);
  expect(sheet.gear).toMatchObject({ weapon: 'battleaxe', armor: 'chain', shield: 'shield' });
  expect(sheet.skills).toEqual({ survival: 1, tracking: 1, melee: 1, athletics: 1 });
});

test('身高體格可以一直重擲；路徑只能點回走過的步驟；改了背景，跟它重複的技能要重選', () => {
  const m = createCreation(DATA, RNG.clone().setSeed(3));
  pick(m, 'human');
  const seen = new Set();
  for (let i = 0; i < 12; i++) {
    pick(m, 'reroll');
    seen.add(`${m.state.rolls.height},${m.state.rolls.physique}`);
  }
  expect(seen.size).toBeGreaterThan(3); // 超過 3 次也照樣重擲
  m.goto(6);
  expect(STEPS[m.step].id).toBe('body'); // 後面還沒選，跳不過去
  pick(m, 'ok');
  pick(m, 'ranger');
  m.random();
  pick(m, 'next');
  pick(m, 'mercenary');
  m.random();
  expect(m.state.skills).toHaveLength(3); // 人類多才
  pick(m, 'next');
  m.goto(4); // 回到背景
  pick(m, 'hunter'); // 獵人給生存、追蹤：跟它重複的技能拿掉
  expect(m.state.skills.some((s) => ['survival', 'tracking'].includes(s))).toBe(false);
});

test('預覽：選了種族就看得到屬性；選了職業就算得出攻擊與防禦', () => {
  const m = createCreation(DATA, RNG.clone().setSeed(1));
  expect(m.preview()).toBeNull();
  pick(m, 'elf');
  expect(m.preview().attrs.dex).toBe(14);
  pick(m, 'ok');
  pick(m, 'rogue');
  expect(m.preview().stats.sneak).toBe(4);
});
