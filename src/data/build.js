// 從 data/ 的檔案內容組出遊戲用的資料。
// 檢查三件事：每筆符合規格、同類型 id 不重複、引用找得到對象；有錯就整批丟出，不讓遊戲帶著壞資料跑。
// 這裡不讀檔：遊戲由 load.js 用 Vite 載入，Node 的工具腳本自己讀 JSON 再交進來

import { z } from 'zod';
import { BiomeSchema, ObjectSchema, TerrainSchema } from './schemas.js';

// files：{ 檔名: 條目陣列 }。回傳 [條目⋯⋯]，順序照檔名再照檔內順序（地形的編號就是這個順序）
function merge(files, schema, kind, errors) {
  const out = [];
  for (const name of Object.keys(files).sort()) {
    const parsed = z.array(schema).safeParse(files[name]);
    if (!parsed.success) {
      for (const issue of parsed.error.issues)
        errors.push(`${kind} ${name} [${issue.path.join('.')}]：${issue.message}`);
      continue;
    }
    out.push(...parsed.data);
  }
  const seen = new Set();
  for (const item of out) {
    if (seen.has(item.id)) errors.push(`${kind} 的 id 重複：${item.id}`);
    seen.add(item.id);
  }
  return out;
}

export function buildData({ terrain, object = {}, biome }) {
  const errors = [];
  const terrains = merge(terrain, TerrainSchema, '地形', errors);
  const objects = merge(object, ObjectSchema, '物件', errors);
  const biomes = merge(biome, BiomeSchema, '生態', errors);
  const terrainIndex = new Map(terrains.map((t, i) => [t.id, i]));
  const objectIndex = new Map(objects.map((o, i) => [o.id, i]));
  for (const b of biomes) {
    if (!terrainIndex.has(b.ground)) errors.push(`生態 ${b.id} 的 ground 找不到地形：${b.ground}`);
    for (const f of b.flora)
      if (!objectIndex.has(f.object)) errors.push(`生態 ${b.id} 的 flora 找不到物件：${f.object}`);
  }
  if (errors.length) throw new Error(`資料有錯：\n${errors.join('\n')}`);
  return { terrains, terrainIndex, objects, objectIndex, biomes };
}
