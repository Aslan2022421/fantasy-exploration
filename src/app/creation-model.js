// 建角的流程（不碰畫面，可在 Node 裡測）：八個步驟，每一步一份選項清單（creation-steps.js），選完往下一步；
// 改了前面的選擇，後面不合用的才要重選（路徑列可以點回已經走過的步驟）。
// 順序照規則草案第三章；屬性看種族、職業的 2 點加在主要屬性（使用者定）

import { buildSheet, CLASS_POINTS, classOf, defaultChoices, heroStats, raceOf, skillOptions } from '../world/hero.js';
import { REROLLS, STEP_ROWS, stepRandom } from './creation-steps.js';

export { REROLLS };
export const STEPS = [
  { id: 'race', name: '種族' },
  { id: 'body', name: '身高體格' },
  { id: 'class', name: '職業' },
  { id: 'points', name: '職業加點' },
  { id: 'background', name: '背景' },
  { id: 'skills', name: '技能' },
  { id: 'gear', name: '裝備' },
  { id: 'summary', name: '總覽' },
];

export function createCreation(data, rng) {
  const c = {
    race: null,
    rolls: null,
    rerolls: REROLLS,
    cls: null,
    bonus: {},
    background: null,
    skills: [],
    weapon: null,
    armor: null,
    shield: false,
  };
  let step = 0;
  let cursor = 0;
  let done = null;

  const kit = () => classOf(data, c.cls).kit;
  const spent = () => Object.values(c.bonus).reduce((a, b) => a + b, 0);
  const skillNeed = () => skillOptions(data, c.cls, c.background, c.race);

  // 每一步選完了沒有
  const valid = {
    race: () => !!c.race,
    body: () => !!c.rolls,
    class: () => !!c.cls,
    points: () => spent() === CLASS_POINTS,
    background: () => !!c.background,
    skills: () => {
      const { need, options } = skillNeed();
      return c.skills.length === need && c.skills.every((s) => options.includes(s));
    },
    gear: () => !!c.cls && kit().weapons.includes(c.weapon) && kit().armors.includes(c.armor),
    summary: () => true,
  };
  // 走得到的最遠一步：第一個還沒選好的
  const reach = () => {
    const i = STEPS.findIndex((s) => !valid[s.id]());
    return i < 0 ? STEPS.length - 1 : i;
  };
  const go = (i) => {
    step = Math.max(0, Math.min(i, reach()));
    cursor = 0;
  };

  const choices = () => ({
    race: c.race,
    cls: c.cls,
    rolls: c.rolls,
    bonus: c.bonus,
    background: c.background,
    skills: c.skills,
    weapon: c.weapon,
    armor: c.armor,
    shield: c.shield,
  });

  const env = {
    data,
    c,
    rng,
    kit,
    spent,
    skillNeed,
    next: () => go(step + 1),
    finish: () => {
      done = choices();
    },
    setClass(id) {
      if (c.cls === id) return;
      c.cls = id;
      c.bonus = {};
      c.skills = [];
      const k = kit();
      c.weapon = k.weapons[0];
      c.armor = k.armors[0];
      c.shield = k.shield;
    },
  };
  const rows = () => STEP_ROWS[STEPS[step].id](env);

  // 選到哪就算到哪：還沒選職業時只有種族的屬性；選了職業之後，沒選的照預設補上算出攻擊、防禦
  function preview() {
    if (!c.race) return null;
    if (!c.cls || !c.rolls) return { attrs: { ...raceOf(data, c.race).attrs }, sheet: null, stats: null };
    const fixed = { getUniform: () => 0, getUniformInt: (a) => a };
    const merged = {
      ...defaultChoices(data, { race: c.race, cls: c.cls }, fixed),
      rolls: c.rolls,
      bonus: c.bonus,
      weapon: c.weapon,
      armor: c.armor,
      shield: c.shield,
    };
    if (c.background) merged.background = c.background;
    if (valid.skills()) merged.skills = c.skills;
    const sheet = buildSheet(data, merged);
    return { attrs: sheet.attrs, sheet, stats: heroStats(data, sheet) };
  }

  return {
    get step() {
      return step;
    },
    get cursor() {
      return cursor;
    },
    get done() {
      return done;
    },
    get state() {
      return c;
    },
    reach,
    rows,
    preview,
    choices,
    race: () => (c.race ? raceOf(data, c.race) : null),
    cls: () => (c.cls ? classOf(data, c.cls) : null),
    move(d) {
      const n = rows().length;
      cursor = (cursor + d + n) % n;
    },
    point(i) {
      if (i >= 0 && i < rows().length) cursor = i;
    },
    act(i = cursor) {
      const r = rows()[i];
      if (!r || (r.off && !r.on)) return;
      cursor = i;
      r.act();
    },
    plus(i = cursor) {
      rows()[i]?.add?.();
    },
    minus(i = cursor) {
      rows()[i]?.sub?.();
    },
    back() {
      if (step > 0) go(step - 1);
    },
    goto(i) {
      if (i <= reach()) go(i);
    },
    // R：這一步隨機選（身高體格那一步是重擲）
    random() {
      const before = step;
      const at = stepRandom(STEPS[step].id, env);
      if (at != null && step === before) cursor = at;
    },
  };
}
