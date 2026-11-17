// 冒險者用的資料（技能、武器、護甲、種族、職業）：合併、檢查引用，回傳要併進 DATA 的欄位。
// merge 由 build.js 傳進來（同一套合併與 id 重複檢查）

import { ArmorSchema, ClassSchema, RaceSchema, SkillSchema, WeaponSchema } from './hero-schemas.js';

const indexOf = (list) => new Map(list.map((t, i) => [t.id, i]));

export function buildHeroData(files, merge, errors) {
  const skills = merge(files.skill ?? {}, SkillSchema, '技能', errors);
  const weapons = merge(files.weapon ?? {}, WeaponSchema, '武器', errors);
  const armors = merge(files.armor ?? {}, ArmorSchema, '護甲', errors);
  const races = merge(files.race ?? {}, RaceSchema, '種族', errors);
  const classes = merge(files.class ?? {}, ClassSchema, '職業', errors);
  const skillIndex = indexOf(skills);
  const weaponIndex = indexOf(weapons);
  const armorIndex = indexOf(armors);

  for (const a of armors)
    for (const s of Object.keys(a.penalties))
      if (!skillIndex.has(s)) errors.push(`護甲 ${a.id} 的懲罰找不到技能：${s}`);
  for (const c of classes) {
    for (const s of [...c.skillChoices, ...c.preset.skills])
      if (!skillIndex.has(s)) errors.push(`職業 ${c.id} 找不到技能：${s}`);
    const { weapon, armor, shield } = c.preset.gear;
    if (!weaponIndex.has(weapon)) errors.push(`職業 ${c.id} 的武器找不到：${weapon}`);
    if (armors[armorIndex.get(armor)]?.kind !== 'armor') errors.push(`職業 ${c.id} 的護甲找不到：${armor}`);
    if (shield && armors[armorIndex.get(shield)]?.kind !== 'shield')
      errors.push(`職業 ${c.id} 的盾牌找不到：${shield}`);
    const sum = Object.values(c.preset.attrs).reduce((a, b) => a + b, 0);
    if (Object.keys(c.preset.attrs).length !== 6 || sum !== 60)
      errors.push(`職業 ${c.id} 的預設屬性要六項、總和 60（現在 ${sum}）`);
  }
  return {
    skills,
    skillIndex,
    weapons,
    weaponIndex,
    armors,
    armorIndex,
    races,
    raceIndex: indexOf(races),
    classes,
    classIndex: indexOf(classes),
  };
}
