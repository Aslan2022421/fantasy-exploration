// 配方（data/recipe）：材料 → 成品。needs 是做進成品裡的（壞掉或用掉時才讓出上限），fuel 是燒掉的（做的當下就讓出）；
// 材料寫 material（指定一種）或 category（那一類任一種，例如任何木頭）。
// 難度照規則草案第十一章：修理普通物品 8、製作普通物品 8、專業物品 11、複雜裝備 14、特殊物品 17。
// anvil：要貼著鐵砧（城鎮、城市的鐵匠舖，堡壘、要塞的工坊）

import { z } from 'zod';

const Need = z
  .object({
    material: z.string().optional(),
    category: z.enum(['wood', 'plant', 'mineral', 'metal']).optional(),
    n: z.number().int().positive(),
  })
  .refine((x) => !!x.material !== !!x.category, '材料要寫 material 或 category 其中一個');

export const RecipeSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  makes: z
    .object({ item: z.string().optional(), material: z.string().optional(), n: z.number().int().positive().default(1) })
    .refine((x) => !!x.item !== !!x.material, '成品要寫 item 或 material 其中一個'),
  needs: z.array(Need).min(1),
  fuel: z.array(Need).default([]),
  dc: z.union([z.literal(8), z.literal(11), z.literal(14), z.literal(17)]),
  ticks: z.number().int().positive(), // 做一次花幾刻
  anvil: z.boolean().default(false),
});

// 引用都要找得到；採來的材料要有上限
export function checkRecipes(recipes, { materialIndex, materials, weaponIndex, armorIndex }, errors) {
  for (const m of materials)
    if (['mineral', 'wood', 'plant', 'animal'].includes(m.category) && !m.cap) errors.push(`材料 ${m.id} 沒有上限 cap`);
  for (const r of recipes) {
    const { item, material } = r.makes;
    if (item && !weaponIndex.has(item) && !armorIndex.has(item)) errors.push(`配方 ${r.id} 的成品找不到：${item}`);
    if (material && !materialIndex.has(material)) errors.push(`配方 ${r.id} 的成品找不到：${material}`);
    for (const n of [...r.needs, ...r.fuel])
      if (n.material && !materialIndex.has(n.material)) errors.push(`配方 ${r.id} 的材料找不到：${n.material}`);
  }
}
