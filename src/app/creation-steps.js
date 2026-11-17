// 建角每一步的選項清單與 R 隨機（creation-model.js 用）。
// env：{ data, c（目前的選擇）, rng, next(), kit(), spent(), skillNeed(), setClass(id), finish() }
// 一行選項：{ key, label, icon, group, on（選中）, off（不能選）, attr / skill / item, next（下一步那一行）, act(), add(), sub() }

import { ATTR_NAMES } from '../view/names.js';
import { CLASS_POINTS, classOf, rollBody } from '../world/hero.js';

const pickOne = (rng, list) => list[Math.floor(rng.getUniform() * list.length)];

const race = ({ data, c, rng, next }) =>
  data.races.map((r) => ({
    key: r.id,
    icon: r.icon,
    label: r.name,
    on: c.race === r.id,
    act() {
      if (c.race !== r.id) {
        c.race = r.id;
        c.rolls = rollBody(rng);
        c.skills = []; // 人類多一項技能，換種族要重選
      }
      next();
    },
  }));

// 重擲不限次數（使用者定）
const body = ({ c, rng, next }) => [
  { key: 'ok', label: '就這樣', act: next },
  {
    key: 'reroll',
    label: '重擲',
    act() {
      c.rolls = rollBody(rng);
    },
  },
];

const cls = ({ data, c, setClass, next }) =>
  data.classes.map((k) => ({
    key: k.id,
    icon: k.icon,
    label: k.name,
    on: c.cls === k.id,
    act() {
      setClass(k.id);
      next();
    },
  }));

function points({ data, c, spent, next }) {
  const left = CLASS_POINTS - spent();
  return [
    ...classOf(data, c.cls).mainAttrs.map((a) => ({
      key: a,
      attr: a,
      label: ATTR_NAMES[a],
      plus: left > 0,
      minus: (c.bonus[a] ?? 0) > 0,
      add() {
        if (CLASS_POINTS - spent() > 0) c.bonus = { ...c.bonus, [a]: (c.bonus[a] ?? 0) + 1 };
      },
      sub() {
        if ((c.bonus[a] ?? 0) > 0) c.bonus = { ...c.bonus, [a]: c.bonus[a] - 1 };
      },
      act() {
        this.add();
      },
    })),
    { key: 'next', next: true, label: left ? `還有 ${left} 點` : '下一步', off: left > 0, act: () => left || next() },
  ];
}

const background = ({ data, c, next }) =>
  data.backgrounds.map((b) => ({
    key: b.id,
    label: b.name,
    on: c.background === b.id,
    act() {
      if (c.background !== b.id) {
        c.background = b.id;
        c.skills = c.skills.filter((s) => !b.skills.includes(s));
      }
      next();
    },
  }));

function skills({ data, c, skillNeed, next }) {
  const { need, options } = skillNeed();
  return [
    ...options.map((s) => ({
      key: s,
      skill: s,
      label: data.skills[data.skillIndex.get(s)].name,
      on: c.skills.includes(s),
      off: !c.skills.includes(s) && c.skills.length >= need,
      act() {
        if (c.skills.includes(s)) c.skills = c.skills.filter((x) => x !== s);
        else if (c.skills.length < need) c.skills = [...c.skills, s];
      },
    })),
    {
      key: 'next',
      next: true,
      label: c.skills.length < need ? `已選 ${c.skills.length}／${need}` : '下一步',
      off: c.skills.length < need,
      act: () => c.skills.length === need && next(),
    },
  ];
}

function gear({ data, c, kit, next }) {
  const k = kit();
  const out = k.weapons.map((w) => ({
    key: `w:${w}`,
    item: w,
    group: k.pick === 'all' ? '拿在手上（其餘放背包）' : '主手武器',
    label: data.weapons[data.weaponIndex.get(w)].name,
    on: c.weapon === w,
    act() {
      c.weapon = w;
    },
  }));
  for (const a of k.armors)
    out.push({
      key: `a:${a}`,
      item: a,
      group: '護甲',
      label: data.armors[data.armorIndex.get(a)].name,
      on: c.armor === a,
      act() {
        c.armor = a;
      },
    });
  if (k.shield)
    out.push({
      key: 'shield',
      item: data.armors.find((a) => a.kind === 'shield').id,
      group: '盾牌',
      label: c.shield ? '帶盾牌' : '不帶盾牌',
      on: c.shield,
      act() {
        c.shield = !c.shield;
      },
    });
  out.push({ key: 'next', next: true, label: '下一步', act: next });
  return out;
}

const summary = ({ finish }) => [{ key: 'start', next: true, label: '開始冒險', act: finish }];

export const STEP_ROWS = { race, body, class: cls, points, background, skills, gear, summary };

// R：這一步隨機選（身高體格那一步是重擲）；回傳要把游標移到哪一行（null 不動）
export function stepRandom(id, env) {
  const { data, c, rng } = env;
  if (id === 'summary') return null;
  if (id === 'body') {
    body(env)[1].act();
    return null;
  }
  if (id === 'points') {
    c.bonus = {};
    const main = classOf(data, c.cls).mainAttrs;
    for (let i = 0; i < CLASS_POINTS; i++) {
      const a = pickOne(rng, main);
      c.bonus = { ...c.bonus, [a]: (c.bonus[a] ?? 0) + 1 };
    }
    return null;
  }
  if (id === 'skills') {
    const { need, options } = env.skillNeed();
    const pool = [...options];
    c.skills = [];
    while (c.skills.length < need && pool.length)
      c.skills.push(pool.splice(Math.floor(rng.getUniform() * pool.length), 1)[0]);
    return null;
  }
  if (id === 'gear') {
    const k = env.kit();
    c.weapon = pickOne(rng, k.weapons);
    c.armor = pickOne(rng, k.armors);
    c.shield = k.shield && rng.getUniform() < 0.5;
    return null;
  }
  const list = STEP_ROWS[id](env);
  const pick = Math.floor(rng.getUniform() * list.length);
  list[pick].act();
  return pick;
}
