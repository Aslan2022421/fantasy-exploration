// 冒險者用的資料規格：技能、武器、護甲、種族、職業（規則草案的第二～七章）

import { z } from 'zod';

const Id = z.string().regex(/^[a-z][a-z0-9-]*$/, 'id 只能用小寫英文、數字與連字號');
export const ATTRS = ['str', 'dex', 'int', 'per', 'wil', 'cha'];
const Attr = z.enum(ATTRS);
const Span = z.tuple([z.number().int().min(1).max(12), z.number().int().min(1).max(12)]);

export const SkillSchema = z.object({ id: Id, name: z.string().min(1), attrs: z.array(Attr).min(1) });

export const WeaponSchema = z.object({
  id: Id,
  name: z.string().min(1),
  category: Id, // 戰士的武器訓練選的類別
  damage: z.number().int(), // 武器傷害修正
  type: z.enum(['slash', 'pierce', 'blunt']),
  finesse: z.boolean().default(false), // 靈巧：攻擊、傷害、格擋可以用敏捷代替力量
  twoHanded: z.boolean().default(false),
  range: z.number().int().positive().optional(), // 有射程的是遠程武器（格）
  armorBreak: z.number().int().min(0).default(0), // 命中時對方的護甲減免少幾點
  traits: z.array(z.string()).default([]),
});

export const ArmorSchema = z.object({
  id: Id,
  name: z.string().min(1),
  kind: z.enum(['armor', 'shield']),
  reduction: z.number().int().min(0), // 傷害減免
  defense: z.number().int().min(0).default(0), // 盾牌的防禦值加成
  penalties: z.record(Id, z.number().int().max(0)).default({}), // 技能 → 修正（潛行 −1 等）
});

// 身高三格（矮小、中等、高大）、體格四格（瘦小、普通、結實、魁梧）：1d12 落在哪個範圍；null 是這個種族沒有
export const RaceSchema = z.object({
  id: Id,
  name: z.string().min(1),
  height: z.tuple([Span.nullable(), Span.nullable(), Span.nullable()]),
  physique: z.tuple([Span.nullable(), Span.nullable(), Span.nullable(), Span.nullable()]),
  extraSkill: z.boolean().default(false), // 人類的多才
  abilities: z.array(z.string()).default([]),
});

export const ClassSchema = z.object({
  id: Id,
  name: z.string().min(1),
  hpPerLevel: z.number().int().positive(),
  mainAttrs: z.array(Attr),
  skillChoices: z.array(Id).min(2),
  training: Id.optional(), // 戰士的武器訓練：類別
  sneak: z.number().int().positive().optional(), // 盜賊的背襲：額外傷害
  preset: z.object({
    attrs: z.record(Attr, z.number().int().min(1).max(20)),
    skills: z.array(Id),
    gear: z.object({ weapon: Id, armor: Id, shield: Id.optional() }),
  }),
  abilities: z.array(z.string()).default([]),
});
