// 資料規格（Zod）：data/ 底下每種類型的條目長什麼樣
// 引用一律只認 id；id 寫在條目裡，拆檔、搬檔都不影響引用。
// 地圖每格分四層：地貌（地勢、高度、坡度）、地表材質（外觀與通行）、水文（水體）、
// 生態覆蓋（地面長什麼）；另有物件層，是站在地面上、會變成資源的東西（樹、矮叢、草本、岩壁、礦脈），
// 以及採光之後留下的樹樁、碎石坑。
// 地貌、材質、水文、覆蓋都放在 data/terrain，用 layer 分；生態群落在 data/biome；採得到的材料在 data/material

import { z } from 'zod';

const Id = z.string().regex(/^[a-z][a-z0-9-]*$/, 'id 只能用小寫英文、數字與連字號');
const Color = z.string().regex(/^#[0-9a-f]{6}$/, '顏色寫成 #rrggbb');
const Glyph = z.string().length(1); // 地圖上的字元，必須在 CP437 表裡（另由資料檢查確認）

// 四層共用：glyph 是說明與圖例裡的代表字，glyphs 是這一種會用到的字元（檢查與圖例用；空白只畫背景）
const layerBase = { id: Id, name: z.string().min(1), glyph: Glyph, tile: z.string().nullable() };

// 字形規則在 src/view/glyphs.js
export const TerrainSchema = z.discriminatedUnion('layer', [
  // 地貌：沒有自己的顏色（顏色來自材質）。relief 用起伏點；mountain 用 ^ 與 ▲
  z.object({
    ...layerBase,
    layer: z.literal('landform'),
    style: z.enum(['relief', 'mountain']),
    glyphs: z.array(Glyph).min(1),
  }),
  // 地表材質：relief 起伏點、sand 波紋與沙丘、rock 裸岩 ■、gravel 碎石 °、ice 冰面 ═
  z.object({
    ...layerBase,
    layer: z.literal('surface'),
    color: Color,
    passable: z.boolean(),
    style: z.enum(['relief', 'sand', 'rock', 'gravel', 'ice']),
    glyphs: z.array(Glyph).min(1),
  }),
  // 水文：deep 深水、shallow 淺水、swamp 沼澤（墨綠色的水文字元）
  z.object({
    ...layerBase,
    layer: z.literal('water'),
    color: Color,
    passable: z.boolean(),
    style: z.enum(['deep', 'shallow', 'swamp']),
    glyphs: z.array(Glyph).min(1),
  }),
  // 生態覆蓋：地面長的草、苔、花、樹苗等，一種一個字元、一個顏色
  z.object({ ...layerBase, layer: z.literal('cover'), color: Color }),
]);

// 材料：採集得到的東西（礦物、木頭、植物，之後的動物部位）。cap 是全世界的上限，玩家看不到；
// 物理屬性都是選填，用到的階段才填：hardness 莫氏硬度（挖礦花的時間看它）、density 密度 g/cm³、
// ignition 燃點 °C、edible 能不能吃、value 基本價值；source 寫數值的出處
export const MaterialSchema = z.object({
  id: Id,
  name: z.string().min(1),
  category: z.enum(['mineral', 'wood', 'plant', 'animal']),
  cap: z.number().int().positive(),
  hardness: z.number().positive().optional(),
  density: z.number().positive().optional(),
  ignition: z.number().optional(),
  edible: z.boolean().optional(),
  value: z.number().nonnegative().optional(),
  source: z.string().optional(),
});

const Range = z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]);

// 採集：action 決定動作（mine 挖礦、chop 伐木、pick 採集）；mine 的時間看產出材料的硬度，其餘用 time。
// uses 一處能採幾次、amount 每次幾個、kinds 組成有幾種（第一次採時讀出來，之後固定）。
// yields 是產出的權重表：條件都符合的列加總。條件是生態 biomes、高度層 minTier～maxTier、在不在山地 mountain、
// nearWater 格內有河或湖（不算沼澤）；沒寫的條件不限。after 是採光之後留下的物件 id，
// 或 picked（物件留著、壓暗，不能再採）
const GatherSchema = z.object({
  action: z.enum(['mine', 'chop', 'pick']),
  time: z.number().int().positive().optional(),
  uses: Range,
  amount: Range,
  kinds: Range,
  after: z.union([z.literal('picked'), Id]),
  yields: z
    .array(
      z.object({
        biomes: z.array(Id).optional(),
        minTier: z.number().int().optional(),
        maxTier: z.number().int().optional(),
        mountain: z.boolean().optional(),
        nearWater: z.number().int().min(1).max(8).optional(),
        weights: z.record(Id, z.number().positive()),
      }),
    )
    .min(1),
});

export const ObjectSchema = z.object({
  id: Id,
  name: z.string().min(1),
  glyph: Glyph,
  color: Color,
  baseColor: Color.optional(), // 疊層時頂層以下的顏色（礦脈頂層是礦脈色、下面是岩石色）；沒有就跟 color 一樣
  passable: z.boolean(),
  // 疊幾層：樹的樹幹往上疊、最頂層是樹冠；1 層是平的，不疊
  height: z.number().int().min(0).max(5),
  trunk: z.boolean(), // 有樹幹：樹冠正中間那一格是樹幹，走不過去；樹冠其他格照 passable
  // 佔地多大（直徑幾格），每棵從這裡用雜湊挑一個；重複寫的數字比較常出現（例如 4 格的老樹只寫一次）
  sizes: z.array(z.number().int().min(1).max(4)).min(1),
  // 樹冠的形狀：round 是一團（直徑 3 時是九宮格，旁邊貼 8 邊），cross 是十字（旁邊貼 4 邊），
  // pair 是對邊兩片（左右或上下，每棵用雜湊挑）
  canopy: z.enum(['round', 'cross', 'pair']).default('round'),
  tile: z.string().nullable(),
  gather: GatherSchema.optional(), // 能採的才有
});

export const BAND = z.enum(['cold', 'mild', 'hot']);
export const WETNESS = z.enum(['dry', 'normal', 'wet']);

const Share = z.number().min(0).max(1);

export const BiomeSchema = z.object({
  id: Id,
  name: z.string().min(1),
  temperature: BAND,
  moisture: WETNESS,
  mapColor: Color.optional(), // 世界地圖（M）上的顏色；沒有就畫灰色
  flora: z.array(z.object({ object: Id, density: Share })), // 依序撒的物件與密度
  cover: z.array(z.object({ cover: Id, density: Share })), // 泥土與沙地上長的生態覆蓋，各佔幾成
});
