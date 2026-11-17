// 冒險者用的資料（技能、武器、護甲、種族、職業、背景）：合併、檢查引用，回傳要併進 DATA 的欄位。
// merge 由 build.js 傳進來（同一套合併與 id 重複檢查）

import {
  ArmorSchema,
  ATTRS,
  BackgroundSchema,
  ClassSchema,
  RaceSchema,
  SkillSchema,
  WeaponSchema,
} from './hero-schemas.js';

const indexOf = (list) => new Map(list.map((t, i) => [t.id, i]));

export function buildHeroData(files, merge, errors) {
  const skills = merge(files.skill ?? {}, SkillSchema, '技能', errors);
  const weapons = merge(files.weapon ?? {}, WeaponSchema, '武器', errors);
  const armors = merge(files.armor ?? {}, ArmorSchema, '護甲', errors);
  const races = merge(files.race ?? {}, RaceSchema, '種族', errors);
  const classes = merge(files.class ?? {}, ClassSchema, '職業', errors);
  const backgrounds = merge(files.background ?? {}, BackgroundSchema, '背景', errors);
  const skillIndex = indexOf(skills);
  const weaponIndex = indexOf(weapons);
  const armorIndex = indexOf(armors);
  const isArmor = (id) => armors[armorIndex.get(id)]?.kind === 'armor';

  for (const a of armors)
    for (const s of Object.keys(a.penalties))
      if (!skillIndex.has(s)) errors.push(`護甲 ${a.id} 的懲罰找不到技能：${s}`);
  for (const r of races) {
    const sum = ATTRS.reduce((n, k) => n + (r.attrs[k] ?? 0), 0);
    if (ATTRS.some((k) => r.attrs[k] == null) || sum !== 60)
      errors.push(`種族 ${r.id} 的屬性要六項、總和 60（現在 ${sum}）`);
  }
  for (const c of classes) {
    for (const s of c.skillChoices) if (!skillIndex.has(s)) errors.push(`職業 ${c.id} 找不到技能：${s}`);
    for (const w of c.kit.weapons) if (!weaponIndex.has(w)) errors.push(`職業 ${c.id} 的武器找不到：${w}`);
    for (const a of c.kit.armors) if (!isArmor(a)) errors.push(`職業 ${c.id} 的護甲找不到：${a}`);
  }
  if (!armors.some((a) => a.kind === 'shield') && classes.some((c) => c.kit.shield))
    errors.push('有職業可以帶盾牌，但護甲資料裡沒有盾牌');
  for (const b of backgrounds)
    for (const s of b.skills) if (!skillIndex.has(s)) errors.push(`背景 ${b.id} 找不到技能：${s}`);
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
    backgrounds,
    backgroundIndex: indexOf(backgrounds),
  };
}
