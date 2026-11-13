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
  glyph: Glyph, // 說明與圖例裡的代表字；style 是 glyph 時也是地圖上畫的字
  color: Color,
  passable: z.boolean(),
  shade: z.boolean(), // 要不要套地形明暗（水面不套）
  // 畫法：
  // ramp  地面，依亮度從密度階梯選字元，地面是統一的紋理、光照才讀得出來；
  // glyph 用自己的字元（水面）
  style: z.enum(['ramp', 'glyph']),
  tile: z.string().nullable(), // 預留給圖塊模式
});

export const ObjectSchema = z.object({
  id: Id,
  name: z.string().min(1),
  glyph: Glyph,
  color: Color,
  passable: z.boolean(),
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
