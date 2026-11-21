// 資料規格（Zod）：data/ 底下每種類型的條目長什麼樣
// 引用一律只認 id；id 寫在條目裡，拆檔、搬檔都不影響引用。
// 地圖每格分四層：地貌（地勢、高度、坡度）、地表材質（外觀與通行）、水文（水體）、
// 生態覆蓋（地面長什麼）；另有物件層，是站在地面上、會變成資源的東西（樹、矮叢、草本、礦坑），
// 以及砍倒之後留下的樹樁。
// 地貌、材質、水文、覆蓋都放在 data/terrain，用 layer 分；生態群落在 data/biome；採得到的材料在 data/material

import { z } from 'zod';

export const Id = z.string().regex(/^[a-z][a-z0-9-]*$/, 'id 只能用小寫英文、數字與連字號');
export const Color = z.string().regex(/^#[0-9a-f]{6}$/, '顏色寫成 #rrggbb');
export const Glyph = z.string().length(1); // 地圖上的字元，必須在 CP437 表裡（另由資料檢查確認）

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
  // 地表材質：relief 起伏點、sand 波紋與沙丘、rock 裸岩 ■、gravel 碎石 °、ice 冰面 ═；
  // 聚落裡的 road 路 ·、floor 室內地板 +、yard 聚落裡的空地（空白）；bg 是固定的底色（聚落用，不照明暗換算）
  z.object({
    ...layerBase,
    layer: z.literal('surface'),
    color: Color,
    bg: Color.optional(),
    passable: z.boolean(),
    style: z.enum(['relief', 'sand', 'rock', 'gravel', 'ice', 'road', 'floor', 'yard']),
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
// 材料：mineral、wood、plant、animal 是採來的（有上限 cap）；metal（金屬錠）、supply（繃帶、草藥膏）是做出來的，
// 不算上限（做它的原料還算著），supply 的 heal 是用掉時多回幾點生命
export const MaterialSchema = z.object({
  id: Id,
  name: z.string().min(1),
  category: z.enum(['mineral', 'wood', 'plant', 'animal', 'metal', 'supply']),
  cap: z.number().int().positive().optional(),
  heal: z.number().int().optional(),
  hardness: z.number().positive().optional(),
  density: z.number().positive().optional(),
  ignition: z.number().optional(),
  edible: z.boolean().optional(),
  value: z.number().nonnegative().optional(),
  source: z.string().optional(),
});

export const Range = z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]);

// 採集：action 決定動作（mine 挖礦、chop 伐木、pick 採集）；mine 的時間看產出材料的硬度，其餘用 time。
// uses 一處能採幾次、amount 每次幾個、kinds 組成有幾種（第一次採時讀出來，之後固定）。
// yields 是產出的權重表：條件都符合的列加總。條件是生態 biomes、高度層 minTier～maxTier、在不在山地 mountain、
// nearWater 格內有河或湖（不算沼澤）；沒寫的條件不限。after 是採光之後留下的物件 id（樹樁）、
// 地表材質 id（礦坑挖空，佔的每一格地表換成它、物件拿掉），或 picked（物件留著、壓暗，不能再採）
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
  family: z.string().min(1).optional(), // 類名：同一類用同一個字（針葉樹 ↑、闊葉樹 ♣⋯⋯），樹種靠顏色與層數分
  glyph: Glyph,
  color: Color,
  passable: z.boolean(),
  // 疊幾層：樹的樹幹往上疊、最頂層是樹冠；1 層是平的，不疊
  height: z.number().int().min(0).max(6),
  // 每層往上錯開幾螢幕像素（沒寫照物件的預設，perspective.js 的 UP.objPx）；室內的家具疊得密一點
  stackPx: z.number().int().min(1).max(8).optional(),
  bridge: z.boolean().optional(), // 橋：底下是走不過去的水也能走

  // 礦坑：每處疊幾層（表現有多大），從錨點的雜湊在範圍裡挑；越挖越矮，這時 gather.uses 是每層挖幾次
  layers: z.tuple([z.number().int().min(1).max(5), z.number().int().min(1).max(5)]).optional(),
  // 礦坑佔的每一格畫什麼：一列一個字串，從錨點（左上）往右下；空白是不畫字。accent 裡的字畫暗一點
  pattern: z.array(z.string()).optional(),
  accent: z.string().optional(),
  trunk: z.boolean(), // 有樹幹：樹冠正中間那一格是樹幹，走不過去；樹冠其他格照 passable
  // 佔地多大（直徑幾格），每棵從這裡用雜湊挑一個；重複寫的數字比較常出現（例如 4 格的老樹只寫一次）
  sizes: z.array(z.number().int().min(1).max(4)).min(1),
  // 樹冠的形狀：round 是一團（直徑 3 時是九宮格，旁邊貼 8 邊），cross 是十字（旁邊貼 4 邊），
  // pair 是對邊兩片（左右或上下，每棵用雜湊挑）
  canopy: z.enum(['round', 'cross', 'pair']).default('round'),
  tile: z.string().nullable(),
  gather: GatherSchema.optional(), // 能採的才有
  // 牆：畫的時候照上下左右相鄰的牆接成框，true 是雙線（╔═╗）、single 是單線（┌─┐）；資料裡的字只是預設
  join: z.union([z.boolean(), z.literal('single')]).optional(),
});

// 聚落（階段 7）：村莊、城鎮。w×h 是整塊圖樣（含外牆）；wall 是外牆的物件；gates 出入口幾個；
// houses 是民房幾間、residents 是住幾人（兩者都照人口標籤五段，從大舉遷出到急速發展）；
// pop 是隱藏人口的範圍；rangeBase 是範圍的基本半徑；econStart 是開局的經濟值（0～100）；
// 公共建築照種類寫在 src/world/settle-layouts.js；名字從 names 挑一個再加 suffix；
// layout 有寫的照固定圖樣蓋（堡壘、要塞，src/world/fort-layouts.js），houses 不用
export const SettlementSchema = z.object({
  id: Id,
  name: z.string().min(1),
  layout: z.enum(['fort', 'fortress']).optional(),
  w: z.number().int().min(15),
  h: z.number().int().min(11),
  wall: Id,
  gates: z.tuple([z.number().int().min(2).max(4), z.number().int().min(2).max(4)]),
  houses: z.array(z.number().int().min(1)).length(5),
  residents: z.array(z.tuple([z.number().int().min(1), z.number().int().min(1)])).length(5),
  pop: z.tuple([z.number().int().min(1), z.number().int().min(1)]),
  rangeBase: z.number().int().min(1),
  econStart: z.number().int().min(0).max(100),
  suffix: z.string().min(1),
  names: z.array(z.string().min(1)).min(1),
});

// 據點（階段 6）：怪物的窩。layout 是中心圖樣（src/world/nest-layouts.js）；ground 是周圍換色的樣子；
// popMax 是隱藏人口的上限；chest 是寶箱的表：擲 1D12＋標籤修正，落在哪一列（upTo 是這列到幾為止），
// 從 options 裡用骰子挑一個（材料給 count 範圍裡的數量，裝備給一件）
const ChestOption = z.union([
  z.object({ material: Id, count: z.tuple([z.number().int().min(1), z.number().int().min(1)]) }),
  z.object({ wood: z.literal(true), count: z.tuple([z.number().int().min(1), z.number().int().min(1)]) }), // 附近的木材
  z.object({ item: Id }),
]);
export const NestSchema = z.object({
  id: Id,
  name: z.string().min(1),
  species: Id,
  layout: z.enum(['fort', 'graveyard', 'swamp']),
  ground: z.enum(['gravel', 'bare', 'reeds', 'dark']), // dark：保留原本的地形，只把顏色壓暗
  popMax: z.number().int().min(1),
  chest: z.array(z.object({ upTo: z.number().int(), options: z.array(ChestOption).min(1) })).min(1),
});

// 世界形狀的模板（src/world/continent.js）：建世界時照 weight 擲一種，用幾團平滑的隆起疊出陸地。
// 位置、半徑都是世界寬高的比例（0～1）；h 是隆起的高度，負的是往下挖（內海、海峽）；
// jitter 是每團位置隨機偏移最多多少；random 是另外隨機撒幾團（群島）
const Unit = z.number().min(0).max(1);
export const WorldShapeSchema = z.object({
  id: Id,
  name: z.string().min(1),
  weight: z.number().positive(),
  jitter: Unit.default(0),
  blobs: z.array(z.object({ x: Unit, y: Unit, r: z.number().positive(), h: z.number() })),
  random: z
    .object({
      count: Range,
      r: z.tuple([z.number().positive(), z.number().positive()]),
      area: z.tuple([Unit, Unit]),
      h: z.number(),
    })
    .optional(),
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
  resource: z.string().min(1).optional(), // 聚落的資源標籤：周圍最多這種生態時寫什麼（例如木材）
  flora: z.array(z.object({ object: Id, density: Share })), // 依序撒的物件與密度
  cover: z.array(z.object({ cover: Id, density: Share })), // 泥土與沙地上長的生態覆蓋，各佔幾成
});
