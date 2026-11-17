// C 角色視窗的內容：種族、職業、身高體格、屬性、技能、裝備，以及算出來的攻擊、防禦、傷害

import { HEIGHTS, heroStats, PHYSIQUES } from '../world/hero.js';

const ATTR_NAMES = { str: '力量', dex: '敏捷', int: '智力', per: '感知', wil: '意志', cha: '魅力' };
const RANKS = ['無訓練', '初學', '專家', '大師'];
const TYPES = { slash: '斬', pierce: '刺', blunt: '鈍' };
const signed = (n) => (n < 0 ? `-${-n}` : `+${n}`);

export function sheetEntries(state, data) {
  const s = state.hero;
  const h = heroStats(data, s);
  const race = data.races[data.raceIndex.get(s.race)];
  const cls = data.classes[data.classIndex.get(s.cls)];
  const skills = Object.entries(s.skills)
    .map(([id, r]) => `${data.skills[data.skillIndex.get(id)]?.name ?? id} ${RANKS[r]}（${signed(r)}）`)
    .join('、');
  const penalties = Object.entries(h.armor.penalties)
    .map(([id, v]) => `${data.skills[data.skillIndex.get(id)]?.name ?? id} ${signed(v)}`)
    .join('、');
  const gear = [
    `${h.weapon.name}（傷害 ${signed(h.weapon.damage)}，${TYPES[h.weapon.type]}${h.ranged ? `，射程 ${h.range} 格` : ''}）`,
    `${h.armor.name}（減免 ${h.armor.reduction}${penalties ? `，${penalties}` : ''}）`,
    ...(h.shield ? [`${h.shield.name}（防禦 ${signed(h.shield.defense)}）`] : []),
  ].join('、');
  const lines = [
    `${race.name}${cls.name}，${s.level} 級`,
    `身高 ${HEIGHTS[s.height]}（擲 ${s.rolls.height}）：每回合移動 ${h.speed} 格`,
    `體格 ${PHYSIQUES[s.physique]}（擲 ${s.rolls.physique}）：生命 ${state.hp}/${h.hpMax}`,
    `屬性：${Object.entries(ATTR_NAMES)
      .map(([k, n]) => `${n} ${s.attrs[k]}（${signed(h.mods[k])}）`)
      .join('、')}`,
    `技能：${skills || '沒有'}`,
    `裝備：${gear}`,
    `攻擊：1d12${signed(h.attack)}　傷害：1d12${signed(h.damage)}`,
    `防禦：閃避 ${h.dodge}、格擋 ${h.parry}（被近戰打時自動取高，被遠程打只能閃避）`,
    ...race.abilities.map((a) => `種族能力｜${a}`),
    ...cls.abilities.map((a) => `職業能力｜${a}`),
  ];
  return lines.map((text) => ({ time: null, text }));
}
