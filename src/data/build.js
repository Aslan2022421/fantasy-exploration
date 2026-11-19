// 從 data/ 的檔案內容組出遊戲用的資料。
// 檢查三件事：每筆符合規格、同類型 id 不重複、引用找得到對象；有錯就整批丟出，不讓遊戲帶著壞資料跑。
// 這裡不讀檔：遊戲由 load.js 用 Vite 載入，Node 的工具腳本自己讀 JSON 再交進來

import { z } from 'zod';
import { buildBlock, ENV_VARIANTS } from './blocks.js';
import { buildHeroData } from './build-hero.js';
import {
  BiomeSchema,
  BlockSchema,
  MaterialSchema,
  NestSchema,
  ObjectSchema,
  SettlementSchema,
  SpeciesSchema,
  TerrainSchema,
  WorldShapeSchema,
} from './schemas.js';

// files：{ 檔名: 條目陣列 }。回傳 [條目⋯⋯]，順序照檔名再照檔內順序（編號就是這個順序）
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

const indexOf = (list) => new Map(list.map((t, i) => [t.id, i]));

// 回傳的資料：
// - terrains：四層全部的條目（文字檢查等用）；landforms、surfaces、waters、covers 各層分開，編號是各層自己的
// - palette：畫面上有顏色的條目（材質、水文、覆蓋）排成一列，shades.js 依這個建顏色表；
//   paletteBase 是各層在 palette 裡的起點
export function buildData({
  terrain,
  object = {},
  biome,
  material = {},
  worldshape = {},
  species: speciesFiles = {},
  nest: nestFiles = {},
  settlement: settlementFiles = {},
  ...heroFiles
}) {
  const errors = [];
  const hero = buildHeroData(heroFiles, merge, errors);
  const worldShapes = merge(worldshape, WorldShapeSchema, '世界形狀', errors);
  const terrains = merge(terrain, TerrainSchema, '地形', errors);
  const objects = merge(object, ObjectSchema, '物件', errors);
  const biomes = merge(biome, BiomeSchema, '生態', errors);
  const materials = merge(material, MaterialSchema, '材料', errors);
  const materialIndex = indexOf(materials);
  const layer = (name) => terrains.filter((t) => t.layer === name);
  const landforms = layer('landform');
  const surfaces = layer('surface');
  checkGather(objects, indexOf(objects), indexOf(surfaces), materialIndex, indexOf(biomes), materials, errors);
  const waters = layer('water');
  const covers = layer('cover');
  const objectIndex = indexOf(objects);
  const coverIndex = indexOf(covers);
  for (const b of biomes) {
    for (const f of b.flora)
      if (!objectIndex.has(f.object)) errors.push(`生態 ${b.id} 的 flora 找不到物件：${f.object}`);
    for (const c of b.cover)
      if (!coverIndex.has(c.cover)) errors.push(`生態 ${b.id} 的 cover 找不到生態覆蓋：${c.cover}`);
  }
  const species = merge(speciesFiles, SpeciesSchema, '物種', errors);
  checkSpecies(species, indexOf(biomes), errors);
  const nests = merge(nestFiles, NestSchema, '據點', errors);
  checkNests(nests, indexOf(species), materialIndex, hero, errors);
  const settlements = merge(settlementFiles, SettlementSchema, '聚落', errors);
  for (const s of settlements)
    for (const o of [s.wall, ...(s.halls ?? [])])
      if (!objectIndex.has(o)) errors.push(`聚落 ${s.id} 的物件找不到：${o}`);
  if (errors.length) throw new Error(`資料有錯：\n${errors.join('\n')}`);
  const palette = [...surfaces, ...waters, ...covers].map((t) => ({ ...t, shade: true }));
  return {
    terrains,
    landforms,
    landformIndex: indexOf(landforms),
    surfaces,
    surfaceIndex: indexOf(surfaces),
    waters,
    waterIndex: indexOf(waters),
    covers,
    coverIndex,
    palette,
    paletteBase: { surface: 0, water: surfaces.length, cover: surfaces.length + waters.length },
    objects,
    objectIndex,
    biomes,
    materials,
    materialIndex,
    worldShapes,
    species,
    speciesIndex: indexOf(species),
    nests,
    nestIndex: indexOf(nests),
    settlements,
    settlementIndex: indexOf(settlements),
    ...hero,
  };
}

// 據點：住的物種、寶箱表裡的材料與裝備都要找得到；表的 upTo 由小到大
function checkNests(nests, speciesIndex, materialIndex, hero, errors) {
  for (const n of nests) {
    if (!speciesIndex.has(n.species)) errors.push(`據點 ${n.id} 的物種找不到：${n.species}`);
    let last = Number.NEGATIVE_INFINITY;
    for (const row of n.chest) {
      if (row.upTo <= last) errors.push(`據點 ${n.id} 的寶箱表 upTo 要由小到大`);
      last = row.upTo;
      for (const o of row.options) {
        if (o.material && !materialIndex.has(o.material)) errors.push(`據點 ${n.id} 的寶箱材料找不到：${o.material}`);
        if (o.item && !hero.weaponIndex.has(o.item) && !hero.armorIndex.has(o.item))
          errors.push(`據點 ${n.id} 的寶箱裝備找不到：${o.item}`);
      }
    }
  }
}

// 物種：棲地條件裡的生態要找得到；數值塊在每種環境變體下都要過 Zod，單獨找得到的錯就在這裡報
function checkSpecies(species, biomeIndex, errors) {
  for (const s of species) {
    for (const row of s.habitat)
      for (const b of row.biomes ?? []) if (!biomeIndex.has(b)) errors.push(`物種 ${s.id} 的棲地找不到生態：${b}`);
    for (const env of ENV_VARIANTS) {
      const r = BlockSchema.safeParse(buildBlock(s.answers, env));
      if (!r.success) errors.push(`物種 ${s.id} 的數值塊不合規格：${r.error.issues.map((i) => i.message).join('；')}`);
    }
  }
}

// 物件的採集規則：產出的材料、條件裡的生態、採光後留下的物件都要找得到；挖礦的時間看硬度，所以挖得到的材料要有硬度
function checkGather(objects, objectIndex, surfaceIndex, materialIndex, biomeIndex, materials, errors) {
  for (const o of objects) {
    const g = o.gather;
    if (!g) continue;
    if (g.after !== 'picked' && !objectIndex.has(g.after) && !surfaceIndex.has(g.after))
      errors.push(`物件 ${o.id} 的 after 找不到物件或地表材質：${g.after}`);
    if (g.action !== 'mine' && !g.time) errors.push(`物件 ${o.id} 不是挖礦，要寫 time`);
    for (const [name, [lo, hi]] of Object.entries({ uses: g.uses, amount: g.amount, kinds: g.kinds }))
      if (lo > hi || hi < 1) errors.push(`物件 ${o.id} 的 ${name} 範圍不對：${lo}～${hi}`);
    for (const row of g.yields) {
      for (const b of row.biomes ?? []) if (!biomeIndex.has(b)) errors.push(`物件 ${o.id} 的產出找不到生態：${b}`);
      for (const m of Object.keys(row.weights)) {
        if (!materialIndex.has(m)) errors.push(`物件 ${o.id} 的產出找不到材料：${m}`);
        else if (g.action === 'mine' && materials[materialIndex.get(m)].hardness == null)
          errors.push(`物件 ${o.id} 挖得到的材料 ${m} 要有硬度`);
      }
    }
  }
}
