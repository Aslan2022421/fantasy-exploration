// 資料規格（Zod）：data/ 底下每種類型的條目長什麼樣
// 引用一律只認 id；id 寫在條目裡，拆檔、搬檔都不影響引用

import { z } from 'zod';

const Id = z.string().regex(/^[a-z][a-z0-9-]*$/, 'id 只能用小寫英文、數字與連字號');
const Color = z.string().regex(/^#[0-9a-f]{6}$/, '顏色寫成 #rrggbb');

export const TerrainSchema = z.object({
  id: Id,
  name: z.string().min(1),
  glyph: z.string().length(1), // 地圖上的字元，必須在 CP437 表裡（另由資料檢查確認）
  color: Color,
  passable: z.boolean(),
  shade: z.boolean(), // 要不要套地形明暗（水面不套）
  tile: z.string().nullable(), // 預留給圖塊模式
});

export const BAND = z.enum(['cold', 'mild', 'hot']);
export const WETNESS = z.enum(['dry', 'normal', 'wet']);

export const BiomeSchema = z.object({
  id: Id,
  name: z.string().min(1),
  temperature: BAND,
  moisture: WETNESS,
  ground: Id, // 平地鋪什麼地形
  flora: z.array(z.object({ terrain: Id, density: z.number().min(0).max(1) })), // 依序撒上的植物與密度
});
