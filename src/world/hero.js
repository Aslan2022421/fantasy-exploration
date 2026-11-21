// 冒險者：建角的選擇（choices）組成 sheet，寫進開局紀錄（只放 id 與數字）；各種數值由這裡從 sheet 算出來。
// 建角順序照規則草案第三章：種族 → 擲身高、體格 → 職業 → 職業的 2 點 → 背景 → 職業技能 → 裝備。
// 屬性由種族決定（總和 60），職業的 2 點只能加在職業的兩項主要屬性（使用者定）

import { attrMod, d12 } from './rules.js';
import { slotPenalty } from './wear.js';

export const HEIGHTS = ['矮小', '中等', '高大'];
export const PHYSIQUES = ['瘦小', '普通', '結實', '魁梧'];
// 每個動作（走一格、攻擊一次、換裝備）花幾刻，看身高（使用者定）；戰鬥內外都一樣
export const ACTION_TICKS = [12, 9, 6];
export const START_HP = [14, 18, 22, 26];
export const CLASS_POINTS = 2;
// 主手空著（武器壞掉）：規則草案沒有徒手，比匕首（−2）再弱一點（提議）
export const UNARMED = {
  id: null,
  name: '徒手',
  category: 'unarmed',
  damage: -3,
  type: 'blunt',
  finesse: false,
  twoHanded: false,
  armorBreak: 0,
  traits: [],
};
export const MAX_ATTR = 20;

const get = (list, index, id) => list[index.get(id)];
export const raceOf = (data, id) => get(data.races, data.raceIndex, id) ?? data.races[0];
export const classOf = (data, id) => get(data.classes, data.classIndex, id) ?? data.classes[0];

// 1d12 落在種族表的哪一格
export function bodyIndex(table, roll) {
  const i = table.findIndex((r) => r && roll >= r[0] && roll <= r[1]);
  return i < 0 ? table.findIndex(Boolean) : i;
}

export const rollBody = (rng) => ({ height: d12(rng), physique: d12(rng) });

// 這個職業的技能步驟要選幾項、從哪些選：背景已經有的不能再選；不夠選就開放其他還沒學的技能（規則草案第四章）
export function skillOptions(data, cls, background, race) {
  const c = classOf(data, cls);
  const bg = data.backgrounds[data.backgroundIndex.get(background)];
  const have = new Set(bg?.skills ?? []);
  const need = 2 + (raceOf(data, race).extraSkill ? 1 : 0);
  let options = c.skillChoices.filter((s) => !have.has(s));
  if (options.length < need)
    options = [...options, ...data.skills.map((s) => s.id).filter((s) => !have.has(s) && !options.includes(s))];
  return { need, options };
}

// choices：{ race, cls, rolls: { height, physique }, bonus: { 屬性: 點數 }, background, skills: [職業技能], weapon, armor, shield }
export function buildSheet(data, choices) {
  const r = raceOf(data, choices.race);
  const c = classOf(data, choices.cls);
  const bg = data.backgrounds[data.backgroundIndex.get(choices.background)] ?? null;
  const attrs = { ...r.attrs };
  for (const [k, n] of Object.entries(choices.bonus ?? {})) attrs[k] = Math.min(MAX_ATTR, attrs[k] + n);
  const skills = {};
  for (const s of [...(bg?.skills ?? []), ...(choices.skills ?? [])]) skills[s] = 1;
  // 起始裝備：拿在手上的是選的那把；pick all 的其他武器放背包；雙手武器配盾牌時盾牌放背包
  const weapon = choices.weapon ?? c.kit.weapons[0];
  const items = c.kit.pick === 'all' ? c.kit.weapons.filter((w) => w !== weapon) : [];
  const shieldId = c.kit.shield && choices.shield ? data.armors.find((a) => a.kind === 'shield')?.id : null;
  const twoHanded = get(data.weapons, data.weaponIndex, weapon)?.twoHanded;
  if (shieldId && twoHanded) items.push(shieldId);
  return {
    race: r.id,
    cls: c.id,
    background: bg?.id ?? null,
    level: 1,
    attrs,
    skills, // 技能 → 等級（初學 1、專家 2、大師 3）
    gear: { weapon, armor: choices.armor ?? c.kit.armors[0], shield: twoHanded ? null : shieldId },
    items, // 背包裡的裝備（id）
    height: bodyIndex(r.height, choices.rolls.height),
    physique: bodyIndex(r.physique, choices.rolls.physique),
    rolls: { ...choices.rolls },
    points: 0, // 還沒加的屬性點（升級時給，屬性後面出現＋）
  };
}

// 不走建角畫面時（網址 ?class=&race=、測試）的預設選擇：主要屬性各 +1、清單前面的技能、第一組裝備、能帶盾牌就帶
export function defaultChoices(data, { race, cls } = {}, rng) {
  const r = raceOf(data, race);
  const c = classOf(data, cls);
  const background = data.backgrounds[0]?.id ?? null;
  const { need, options } = skillOptions(data, c.id, background, r.id);
  return {
    race: r.id,
    cls: c.id,
    rolls: rollBody(rng),
    bonus: Object.fromEntries(c.mainAttrs.map((k) => [k, 1])),
    background,
    skills: options.slice(0, need),
    weapon: c.kit.weapons[0],
    armor: c.kit.armors[0],
    shield: c.kit.shield,
  };
}

export const presetHero = (data, options, rng) => buildSheet(data, defaultChoices(data, options, rng));

// 換上背包裡的一件裝備：回傳新的 sheet；不能換回傳 { refused }。
// 武器換主手（雙手武器會把盾牌收進背包）；護甲換身上；盾牌換副手（拿雙手武器時不行）
// 耐久跟著那一件走：背包裡的記在 itemWear（跟 items 一一對應），身上的記在 wear（wear.js）
export function equip(data, sheet, id) {
  if (!sheet.items.includes(id)) return { refused: 'gone' };
  const items = [...sheet.items];
  const itemWear = items.map((_, i) => sheet.itemWear?.[i] ?? 0);
  const at = items.indexOf(id);
  const used = itemWear[at];
  items.splice(at, 1);
  itemWear.splice(at, 1);
  const gear = { ...sheet.gear };
  const wear = { ...(sheet.wear ?? {}) };
  const stow = (slot) => {
    items.push(gear[slot]);
    itemWear.push(wear[slot] ?? 0);
  };
  const put = (slot) => {
    gear[slot] = id;
    wear[slot] = used;
  };
  const weapon = get(data.weapons, data.weaponIndex, id);
  const armor = get(data.armors, data.armorIndex, id);
  if (weapon) {
    if (gear.weapon) stow('weapon');
    put('weapon');
    if (weapon.twoHanded && gear.shield) {
      stow('shield');
      gear.shield = null;
      wear.shield = 0;
    }
  } else if (armor?.kind === 'shield') {
    if (get(data.weapons, data.weaponIndex, gear.weapon)?.twoHanded) return { refused: 'twohand' };
    if (gear.shield) stow('shield');
    put('shield');
  } else if (armor) {
    if (gear.armor && gear.armor !== 'no-armor') stow('armor');
    put('armor');
  } else return { refused: 'gone' };
  return { ...sheet, gear, items, itemWear, wear };
}

// 脫下身上那一格（weapon、shield、armor）放回背包，耐久跟著走；空的格子回傳 { refused }
export function unequip(sheet, slot) {
  const id = sheet.gear[slot];
  if (!id || id === 'no-armor') return { refused: 'empty' };
  const items = [...sheet.items, id];
  const itemWear = [...sheet.items.map((_, i) => sheet.itemWear?.[i] ?? 0), sheet.wear?.[slot] ?? 0];
  return {
    ...sheet,
    gear: { ...sheet.gear, [slot]: null },
    items,
    itemWear,
    wear: { ...(sheet.wear ?? {}), [slot]: 0 },
  };
}

// 加 1 點屬性（升級的點數）：沒有點數或到 20 回傳 { refused }
export function raise(sheet, attr) {
  if (!(sheet.points > 0)) return { refused: 'points' };
  if (sheet.attrs[attr] >= MAX_ATTR) return { refused: 'max' };
  return { ...sheet, attrs: { ...sheet.attrs, [attr]: sheet.attrs[attr] + 1 }, points: sheet.points - 1 };
}

// 從 sheet 算出戰鬥要用的數字
export function heroStats(data, sheet) {
  const c = classOf(data, sheet.cls);
  const m = Object.fromEntries(Object.entries(sheet.attrs).map(([k, v]) => [k, attrMod(v)]));
  const weapon = get(data.weapons, data.weaponIndex, sheet.gear.weapon) ?? UNARMED;
  const armor = get(data.armors, data.armorIndex, sheet.gear.armor) ?? get(data.armors, data.armorIndex, 'no-armor');
  // 雙手武器佔兩手，盾牌不能用
  const shield = sheet.gear.shield && !weapon.twoHanded ? get(data.armors, data.armorIndex, sheet.gear.shield) : null;
  const skill = (id) => (sheet.skills[id] ?? 0) + (armor.penalties[id] ?? 0);
  const ranged = weapon.range != null;
  const fine = weapon.finesse ? Math.max(m.str, m.dex) : m.str;
  const training = c.training && c.training === weapon.category ? 1 : 0;
  // 磨損、破損：武器傷害、護甲減免、盾牌防禦各減 1、2（wear.js），最少 0
  const shieldDef = Math.max(0, (shield?.defense ?? 0) - (shield ? slotPenalty(sheet, 'shield') : 0));
  const dodge = 7 + m.dex + skill('athletics') + shieldDef;
  const parry = 7 + fine + skill('melee') + shieldDef;
  return {
    mods: m,
    weapon,
    armor,
    shield,
    ranged,
    range: weapon.range ?? 1,
    attack: (ranged ? m.dex + skill('ranged') : fine + skill('melee')) + training,
    damage: weapon.damage + (ranged ? 0 : fine) - slotPenalty(sheet, 'weapon'),
    reduction: Math.max(0, armor.reduction - slotPenalty(sheet, 'armor')),
    dodge,
    parry,
    // 被近戰打時自動用較高的；被遠程打只能閃避
    defense: (vsRanged) => (vsRanged ? dodge : Math.max(dodge, parry)),
    sneak: c.sneak ?? 0,
    hpMax: START_HP[sheet.physique] + c.hpPerLevel * (sheet.level - 1),
    ticks: ACTION_TICKS[sheet.height],
  };
}
