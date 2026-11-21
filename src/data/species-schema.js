// 物種與數值塊的資料規格（Zod）：從 schemas.js 拆出來，id、顏色、字元、範圍的寫法共用 schemas.js 的

import { z } from 'zod';
import { Color, Glyph, Id, Range } from './schemas.js';

// 物種：照 Dungeon World 的建怪問答（組織、體型、防禦、著稱、攻擊、描述）答出來，數值塊由 blocks.js 換算。
// 疊幾層（height）與佔幾格（cells）每個物種自己寫，跟樹種一樣，不由問答的體型決定；
// count 是一群幾隻（照舊專案各族的範圍）；habitat 是棲地的權重表，條件的寫法同採集的 yields（沒寫的不限）：
// 生態 biomes、高度層 minTier～maxTier、在不在山地 mountain、幾格內有河或湖 nearWater（最多 3）；條件都符合的列加總
export const ORGANIZATIONS = ['horde', 'group', 'solitary'];
export const SIZE_ANSWERS = ['tiny', 'small', 'human', 'large', 'huge'];
export const ARMOR_ANSWERS = ['flesh', 'hide', 'scale', 'bone', 'magic'];
export const KNOWN_ANSWERS = ['strength', 'offense', 'defense', 'piercing', 'endurance', 'trickery', 'divine', 'magic'];
export const ATTACK_MARKS = ['vicious', 'reach', 'weak', 'pierce-metal', 'tear-metal', 'ignore-armor', 'near', 'far'];
export const DESCRIBE_ANSWERS = [
  'devious',
  'organized',
  'intelligent',
  'cautious',
  'hoarder',
  'planar',
  'vital',
  'construct',
  'terrifying',
  'amorphous',
  'ancient',
  'pacifist',
];
export const FOOTPRINTS = ['1x1', '2x1', '2x2', '3x2'];
export const ADAPTATIONS = ['climb', 'swim', 'amphibious', 'fly', 'cold-hardy', 'constrict'];

export const AnswersSchema = z.object({
  organization: z.enum(ORGANIZATIONS),
  size: z.enum(SIZE_ANSWERS),
  armor: z.enum(ARMOR_ANSWERS),
  known: z.array(z.enum(KNOWN_ANSWERS)).default([]),
  attack: z.object({ form: z.string().min(1), marks: z.array(z.enum(ATTACK_MARKS)).default([]) }),
  describe: z.array(z.enum(DESCRIBE_ANSWERS)).default([]),
  adaptations: z.array(z.enum(ADAPTATIONS)).default([]),
});

// 食性：草食被打會逃、掠食看到冒險者就撲上來、混食會攻擊跟自己不同種族的生物（冒險者也算）
export const DIETS = ['herbivore', 'predator', 'omnivore'];
// 特性：再生照 amount／every 刻回生命；其他只寫在查看說明裡（遊戲還沒有疲勞、恐懼、中毒）
const TraitSchema = z.discriminatedUnion('id', [
  z.object({ id: z.literal('regenerate'), amount: z.number().int().positive(), every: z.number().int().positive() }),
  z.object({ id: z.literal('no-fatigue') }),
  z.object({ id: z.literal('fearless') }),
  z.object({ id: z.literal('poison-immune') }),
]);

export const SpeciesSchema = z
  .object({
    id: Id,
    name: z.string().min(1),
    glyph: Glyph,
    color: Color,
    tile: z.string().nullable(),
    diet: z.enum(DIETS),
    traits: z.array(TraitSchema).default([]),
    height: z.number().int().min(2).max(3),
    footprint: z.enum(FOOTPRINTS), // 寬×高幾格，一隻只畫一個字、放大蓋滿
    moveTicks: z.union([z.literal(6), z.literal(9), z.literal(12)]), // 走一格幾刻：快 6、普通 9、慢 12（只管走路）
    count: Range,
    answers: AnswersSchema,
    instinct: z.string().min(1),
    moves: z.array(z.string().min(1)).min(1),
    habitat: z
      .array(
        z.object({
          biomes: z.array(Id).optional(),
          minTier: z.number().int().optional(),
          maxTier: z.number().int().optional(),
          mountain: z.boolean().optional(),
          nearWater: z.number().int().min(1).max(3).optional(),
          swamp: z.number().int().min(1).max(3).optional(), // 幾格內有沼澤（沼澤是水文，不是生態）
          weight: z.number().positive(),
        }),
      )
      .min(1),
    source: z.string().min(1), // SRD 5.2.1 的原名
  })
  .refine((s) => s.count[0] >= 1 && s.count[0] <= s.count[1], { message: 'count 要 1 以上、前面不大於後面' });

// 換算出來的數值塊（blocks.js）：資料檢查時每個物種的每種環境變體都要過這一關
export const BlockSchema = z.object({
  organization: z.enum(ORGANIZATIONS),
  die: z.union([z.literal(4), z.literal(6), z.literal(8), z.literal(10), z.literal(12)]),
  bonus: z.number().int(),
  roll: z.enum(['normal', 'best', 'worst']),
  hp: z.number().int().min(1),
  armor: z.number().int().min(0),
  piercing: z.number().int().min(0),
  range: z.array(z.enum(['hand', 'close', 'reach', 'near', 'far'])).min(1),
  tags: z.array(z.string()),
  adaptations: z.array(z.enum(ADAPTATIONS)),
  form: z.string().min(1),
});
