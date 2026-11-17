// 冒險者：v0.1.1 用職業的預設角色（建角畫面在 v0.1.2）。身高、體格在種族表上各擲 1d12。
// sheet 是寫進開局紀錄的資料（只放 id 與數字），各種數值由這裡從 sheet 算出來

import { attrMod, d12 } from './rules.js';

export const HEIGHTS = ['矮小', '中等', '高大'];
export const PHYSIQUES = ['瘦小', '普通', '結實', '魁梧'];
const SPEED = [4, 6, 8]; // 每回合幾格（6、9、12 公尺，1 格＝1.5 公尺）
const STEP_TICKS = [6, 4, 3]; // 平常走一格幾刻（24 刻÷每回合格數）
const START_HP = [14, 18, 22, 26];
const EXTRA_SKILLS = ['perception', 'athletics', 'survival']; // 人類多才：照順序挑第一個還沒有的

// 1d12 落在種族表的哪一格
function pick(table, roll) {
  const i = table.findIndex((r) => r && roll >= r[0] && roll <= r[1]);
  return i < 0 ? table.findIndex(Boolean) : i;
}

export function presetHero(data, { race = 'human', cls = 'warrior' } = {}, rng) {
  const r = data.races[data.raceIndex.get(race)] ?? data.races[0];
  const c = data.classes[data.classIndex.get(cls)] ?? data.classes[0];
  const heightRoll = d12(rng);
  const physiqueRoll = d12(rng);
  const skills = Object.fromEntries(c.preset.skills.map((s) => [s, 1]));
  if (r.extraSkill) {
    const extra = EXTRA_SKILLS.find((s) => !skills[s]);
    if (extra) skills[extra] = 1;
  }
  return {
    race: r.id,
    cls: c.id,
    level: 1,
    attrs: { ...c.preset.attrs },
    skills, // 技能 → 等級（初學 1、專家 2、大師 3）
    gear: { ...c.preset.gear },
    height: pick(r.height, heightRoll),
    physique: pick(r.physique, physiqueRoll),
    rolls: { height: heightRoll, physique: physiqueRoll },
  };
}

// 從 sheet 算出戰鬥要用的數字
export function heroStats(data, sheet) {
  const c = data.classes[data.classIndex.get(sheet.cls)];
  const m = Object.fromEntries(Object.entries(sheet.attrs).map(([k, v]) => [k, attrMod(v)]));
  const weapon = data.weapons[data.weaponIndex.get(sheet.gear.weapon)];
  const armor = data.armors[data.armorIndex.get(sheet.gear.armor)];
  const shield = sheet.gear.shield ? data.armors[data.armorIndex.get(sheet.gear.shield)] : null;
  const skill = (id) => (sheet.skills[id] ?? 0) + (armor.penalties[id] ?? 0);
  const ranged = weapon.range != null;
  const fine = weapon.finesse ? Math.max(m.str, m.dex) : m.str;
  const training = c.training && c.training === weapon.category ? 1 : 0;
  const shieldDef = shield?.defense ?? 0;
  const dodge = 7 + m.dex + skill('athletics') + shieldDef;
  const parry = 7 + (weapon.finesse ? Math.max(m.str, m.dex) : m.str) + skill('melee') + shieldDef;
  return {
    mods: m,
    weapon,
    armor,
    shield,
    ranged,
    range: weapon.range ?? 1,
    attack: (ranged ? m.dex + skill('ranged') : fine + skill('melee')) + training,
    damage: weapon.damage + (ranged ? 0 : fine),
    reduction: armor.reduction,
    dodge,
    parry,
    // 被近戰打時自動用較高的；被遠程打只能閃避
    defense: (vsRanged) => (vsRanged ? dodge : Math.max(dodge, parry)),
    sneak: c.sneak ?? 0,
    hpMax: START_HP[sheet.physique] + c.hpPerLevel * (sheet.level - 1),
    speed: SPEED[sheet.height],
    stepTicks: STEP_TICKS[sheet.height],
    initiative: m.dex,
  };
}
