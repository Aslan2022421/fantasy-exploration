// 資料規格（Zod）：data/ 底下每種類型的條目長什麼樣
// 引用一律只認 id；id 寫在條目裡，拆檔、搬檔都不影響引用。
// 地圖分兩層：地形層是地面本身（水、草地、山地⋯⋯）；物件層是站在地面上、會變成資源的東西（樹、草叢，之後的礦脈）

import { z } from 'zod';

const Id = z.string().regex(/^[a-z][a-z0-9-]*$/, 'id 只能用小寫英文、數字與連字號');
const Color = z.string().regex(/^#[0-9a-f]{6}$/, '顏色寫成 #rrggbb');
const Glyph = z.string().length(1); // 地圖上的字元，必須在 CP437 表裡（另由資料檢查確認）

export const TerrainSchema = z.object({
  id: Id,
  name: z.string().min(1),
  glyph: Glyph, // 說明與圖例裡的代表字
  color: Color,
  passable: z.boolean(),
  shade: z.boolean(), // 顏色要不要套明暗（水面不套）
  // 這種地形自己的字元階梯，由暗（疏）到亮（密）。畫的時候依亮度選一階；
  // 每一階可以寫好幾個字，各格用雜湊挑一個，同一亮度的地面不會排成規律的網點。空白只畫背景
  ramp: z.array(z.string().min(1)).min(2),
  tile: z.string().nullable(), // 預留給圖塊模式
});

export const ObjectSchema = z.object({
  id: Id,
  name: z.string().min(1),
  glyph: Glyph,
  color: Color,
  passable: z.boolean(),
  height: z.number().int().min(0).max(3), // 有多高（樹 3、矮叢 2）
  trunk: z.boolean(), // 有樹幹：樹冠正中間那一格是樹幹，走不過去（使用者定）；樹冠其他格照 passable
  // 佔地多大（直徑幾格），每棵從這裡用雜湊挑一個；重複寫的數字比較常出現（例如 4 格的老樹只寫一次）
  sizes: z.array(z.number().int().min(1).max(4)).min(1),
  tile: z.string().nullable(),
});

export const BAND = z.enum(['cold', 'mild', 'hot']);
export const WETNESS = z.enum(['dry', 'normal', 'wet']);

export const BiomeSchema = z.object({
  id: Id,
  name: z.string().min(1),
  temperature: BAND,
  moisture: WETNESS,
  ground: Id, // 平地鋪什麼地形
  flora: z.array(z.object({ object: Id, density: z.number().min(0).max(1) })), // 依序撒在平地上的物件與密度
});
