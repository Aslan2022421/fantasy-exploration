// 世界分兩層：世界層一格＝一個局部區域（每格又分地形層與物件層，見 terrain.js）。世界層一開始整個算好（每區的氣候與生態標籤），
// 局部區域用到才生，最近用過的 64 區留著。全世界共用一套格子座標，跨區時無縫走過去。
// 地圖不進存檔：讀檔時用種子重生，再把紀錄套回去

import { PART_TRUNK } from './footprint.js';
import { buildGeography } from './geography.js';
import { creatureCells } from './herds.js';
import { LAND } from './landform.js';
import { createNestIndex } from './nests.js';
import { anchorOffset } from './objects.js';
import { findForts } from './passes.js';
import { buildRegions } from './regions.js';
import { buildRoads } from './roads.js';
import { createSettleIndex, settlementPlan } from './settlements.js';
import { createTerrainGen, LAYER_NONE } from './terrain.js';

export { startPosition } from './start.js';

// 世界版本：改了地形生成（landform.js、terrain.js、地形或生態資料）就加一，舊存檔自動作廢
export const WORLD_VERSION = 40;// 25：生物佔格擋路（物種成群）；26：混食的怪物成群；27：據點；28：村莊與城鎮；29：聚落照舊版排法；30：橋、據點重做；31：聚落與據點整平；32：整平處是平原、出入口外的路；33：道路；34：路改成邊靠邊；35：聚落改成圓牆；36：城鎮放不下改放村莊；37：聚落外形照地形、出入口朝路、路拉直不並排；38：路加寬、路邊清空；39：堡壘、要塞、城市；40：圖樣裡不留山峰

// 世界層寬幾區：建世界（地理＋世界層）約 2 秒；區用到才生，一區約 25 毫秒
export const ZONES_X = 96;
export const ZONES_Y = 96;
export const ZONE_SIZE = 96; // 一區的邊長（格）
const MAX_ZONES = 64; // 生過的區最多留幾區（一區十幾萬位元組，走遍 96×96 區會吃掉上 GB）

export function createWorld(seed, data, { zonesX = ZONES_X, zonesY = ZONES_Y, zoneSize = ZONE_SIZE } = {}) {
  const width = zonesX * zoneSize;
  const height = zonesY * zoneSize;
  const gen = createTerrainGen(seed, data, { width, height });
  // 先在整個世界的粗格上算地理（河流、淺灘、濕度），之後每一區都照著畫
  const geography = buildGeography(gen.heightAt, seed, width, height);
  gen.setGeography(geography);

  // 世界層：每區的氣候與生態標籤、生物群數（regions.js）
  const regions = buildRegions(gen, seed, data, zonesX, zonesY, zoneSize);
  gen.setHerdTargets((zx, zy) => regions[zy * zonesX + zx].numbers);
  // 聚落（settlements.js）：哪幾區放村莊、城鎮先照種子定好；起點那一區一定是村莊
  const start0 = geography.start;
  const startZone = start0
    ? { zx: Math.floor(start0.x / zoneSize), zy: Math.floor(start0.y / zoneSize) }
    : { zx: zonesX >> 1, zy: zonesY >> 1 };
  // 能放聚落的區：陸地、不是整片山（山裡排了也放不下，路還會白白通過去）
  const isLand = (zx, zy) => {
    const h = regions[zy * zonesX + zx].height;
    return h >= LAND.water && h <= LAND.mountain;
  };
  const settlePlan = settlementPlan(seed, zonesX, zonesY, isLand, startZone);
  gen.setSettlePlan(settlePlan, startZone);

  const zones = new Map(); // "zx,zy" → 生好的區
  let last = null; // 查格子是最常做的事：先看是不是跟上一次同一區

  const inside = (x, y) => x >= 0 && y >= 0 && x < width && y < height;

  function zone(zx, zy) {
    const key = `${zx},${zy}`;
    let z = zones.get(key);
    if (z) {
      zones.delete(key); // 重新放到最後＝最近用過
    } else {
      z = gen.genZone(zx, zy, zoneSize);
      if (zones.size >= MAX_ZONES) zones.delete(zones.keys().next().value); // 丟最久沒用的，要用時再生（結果一樣）
    }
    zones.set(key, z);
    return z;
  }

  // 一格在所屬區裡的位置；世界外回傳 -1
  function locate(x, y) {
    if (!inside(x, y)) return -1;
    const zx = Math.floor(x / zoneSize);
    const zy = Math.floor(y / zoneSize);
    if (!last || last.zx !== zx || last.zy !== zy) last = zone(zx, zy);
    return (y - zy * zoneSize) * zoneSize + (x - zx * zoneSize);
  }

  const orNull = (list, v) => (v === LAYER_NONE ? null : list[v]);

  // 這格上的生物：{ id（群 id＃第幾隻）, herd, member（那一隻的錨點）, species（data.species 的編號）, cells（那一隻佔的格子）}
  // 或 null。這是種子生出來的原樣；戰鬥後的位置、生命、倒下由 creatures.js 疊上去。
  // 每區第一次問時把整區的生物攤成格子對照表
  function creatureAt(x, y) {
    const i = locate(x, y);
    if (i < 0) return null;
    if (!last.creatures) {
      last.creatures = new Map();
      for (const herd of last.herds)
        herd.members.forEach((member, m) => {
          const cells = creatureCells(data.species[herd.species], member);
          const id = `${herd.id}#${m}`;
          for (const c of cells)
            last.creatures.set(c.y * zoneSize + c.x, { id, herd, member, species: herd.species, cells });
        });
    }
    return last.creatures.get(y * zoneSize + x) ?? null;
  }

  // 據點（nests.js）：nestOf(zx, zy)、nestsNear(x, y, r)、nestById(id)
  const nestIndex = createNestIndex(zone, zonesX, zonesY, zoneSize);
  const settleIndex = createSettleIndex(zone, zonesX, zonesY, zoneSize);

  // 起點改到起點村莊的廣場（井的南邊一格）。起點那一區的生物群照起點放，起點換了就整個重生一次
  // 道路網（roads.js）要知道起點村莊在哪，算好後已經生過的區（起點那一區）丟掉重生
  // 起點村莊的位置與廣場不看路網，重生之後出入口照路來的方向重開
  const home0 = settleIndex.settleOf(startZone.zx, startZone.zy);
  if (home0) geography.start = { ...home0.plaza };
  const roads = buildRoads(geography, settlePlan, zonesX, zonesY, zoneSize, home0);
  gen.setRoads(roads);
  // 堡壘、要塞（passes.js）：路網算好之後找隘口，放進沒排聚落的區
  const forts = findForts(geography, roads, settlePlan, zoneSize);
  const kindAt = (zx, zy) => settlePlan(zx, zy) ?? forts.get(`${zx},${zy}`)?.kind ?? null;
  gen.setSettlePlan(kindAt, startZone, forts);
  zones.clear();
  last = null;
  settleIndex.clearSettles();

  // 離 (x, y) 不到 r 格（切比雪夫）的生物群：[{ herd, species, near: 最近那隻的錨點 }]
  function herdsNear(x, y, r) {
    const out = [];
    const z0 = { x: Math.max(0, Math.floor((x - r) / zoneSize)), y: Math.max(0, Math.floor((y - r) / zoneSize)) };
    const z1 = {
      x: Math.min(zonesX - 1, Math.floor((x + r) / zoneSize)),
      y: Math.min(zonesY - 1, Math.floor((y + r) / zoneSize)),
    };
    for (let zy = z0.y; zy <= z1.y; zy++)
      for (let zx = z0.x; zx <= z1.x; zx++)
        for (const herd of zone(zx, zy).herds) {
          let near = null;
          for (const m of herd.members) {
            const d = Math.max(Math.abs(m.x - x), Math.abs(m.y - y));
            if (d < r && (!near || d < near.d)) near = { ...m, d };
          }
          if (near) out.push({ herd, species: herd.species, near });
        }
    return out;
  }

  // 不看生物的走得過去（生物會移動、倒下，由 creatures.js 另外疊）
  function groundPassable(x, y) {
    const i = locate(x, y);
    if (i < 0) return false;
    const w = last.water[i];
    const o = last.object[i];
    // 橋上走得過去，底下是深水也一樣
    if (w !== LAYER_NONE && !data.waters[w].passable && !(o && data.objects[o - 1].bridge)) return false;
    if (!data.surfaces[last.surface[i]].passable) return false;
    if (!o) return true;
    return data.objects[o - 1].passable && last.objectPart[i] !== PART_TRUNK;
  }

  function cell(x, y) {
    const i = locate(x, y);
    if (i < 0) return null;
    const o = last.object[i];
    return {
      landform: data.landforms[last.landform[i]],
      peak: last.peak[i] === 1,
      surface: data.surfaces[last.surface[i]],
      water: orNull(data.waters, last.water[i]),
      cover: orNull(data.covers, last.cover[i]),
      object: o ? data.objects[o - 1] : null,
      creature: creatureAt(x, y),
      trunk: o ? last.objectPart[i] === PART_TRUNK : false,
      biome: data.biomes[last.biome[i]],
      height: last.height[i],
      shade: last.shade[i],
    };
  }

  return {
    seed,
    width,
    height,
    zoneSize,
    zonesX,
    zonesY,
    regions,
    geography, // 世界的地理（河流、淺灘、濕度），世界地圖、除錯與量測用
    shape: gen.shape?.id ?? null, // 這個世界擲到的形狀模板（data/worldshape）
    climateAt: gen.climateAt, // (x, y, 高度) → { t 溫度, w 濕度 }
    biomeIndexOf: gen.biomeAt, // (溫度, 濕度) → 生態編號（data.biomes 的索引）
    region: (zx, zy) => regions[zy * zonesX + zx] ?? null,
    regionAt: (x, y) => (inside(x, y) ? regions[Math.floor(y / zoneSize) * zonesX + Math.floor(x / zoneSize)] : null),
    zone,
    // 一區的物種群（herds.js）：[{ id, species（data.species 的編號）, members: [{ x, y }]（各隻的錨點）, env }]
    creatureAt,
    herdsNear,
    ...nestIndex,
    ...settleIndex,
    // 起點的村莊（冒險者從這裡出發）；用到才生那一區
    get startVillage() {
      return settleIndex.settleOf(startZone.zx, startZone.zy) ?? null;
    },
    roads, // 道路網（roads.js）：{ segments, byZone }，總覽畫路用
    settlementKind: kindAt, // (zx, zy) → 排好要放的聚落種類或 null（不用生出那一區；放不下時實際會退一級）
    herdsOf: (zx, zy) => (zx < 0 || zy < 0 || zx >= zonesX || zy >= zonesY ? [] : zone(zx, zy).herds),
    generatedZones: () => zones.size,
    inside,
    cell,
    // 四層各自的編號（data.landforms／surfaces／waters／covers 的索引）；世界外或沒有東西是 -1
    landformAt(x, y) {
      const i = locate(x, y);
      return i < 0 ? -1 : last.landform[i];
    },
    // 高度（0～255，-1～1 換算過來）；世界外是 0
    heightAt(x, y) {
      const i = locate(x, y);
      return i < 0 ? 0 : last.height[i];
    },
    // 是不是山峰（山地裡附近最高的一格）
    peakAt(x, y) {
      const i = locate(x, y);
      return i >= 0 && last.peak[i] === 1;
    },
    surfaceAt(x, y) {
      const i = locate(x, y);
      return i < 0 ? -1 : last.surface[i];
    },
    waterAt(x, y) {
      const i = locate(x, y);
      return i < 0 || last.water[i] === LAYER_NONE ? -1 : last.water[i];
    },
    coverAt(x, y) {
      const i = locate(x, y);
      return i < 0 || last.cover[i] === LAYER_NONE ? -1 : last.cover[i];
    },
    // 這格地面的顏色來源（data.palette 的索引）：有水是水，不然是材質；結冰的淺水是冰。世界外是 -1
    groundAt(x, y) {
      const i = locate(x, y);
      if (i < 0) return -1;
      const w = last.water[i];
      if (w === LAYER_NONE || data.surfaces[last.surface[i]].style === 'ice') return last.surface[i];
      return data.paletteBase.water + w;
    },
    shadeAt(x, y) {
      const i = locate(x, y);
      return i < 0 ? 0 : last.shade[i];
    },
    // 生態編號（data.biomes 的索引）；世界外是 -1
    biomeAt(x, y) {
      const i = locate(x, y);
      return i < 0 ? -1 : last.biome[i];
    },
    // 坡度（terrain.js 的 SLOPE_SCALE 倍，0～255）；水面與世界外是 0
    slopeAt(x, y) {
      const i = locate(x, y);
      return i < 0 ? 0 : last.slope[i];
    },
    // 高度層：湖海 0、陸地 1～4、山地往上到 MAX_TIER（landform.js），河比兩岸低一層；世界外是 0
    tierAt(x, y) {
      const i = locate(x, y);
      return i < 0 ? 0 : last.tier[i];
    },
    // 這格在樹冠的哪一側（footprint.js 的 PART_MID、PART_LIT、PART_DARK）
    objectPartAt(x, y) {
      const i = locate(x, y);
      return i < 0 ? 0 : last.objectPart[i];
    },
    // 物件層：物件編號（data.objects 的索引）；沒有物件或世界外是 -1
    objectAt(x, y) {
      const i = locate(x, y);
      return i < 0 ? -1 : last.object[i] - 1;
    },
    // 這格的物件從哪一格長出來（錨點，多格的樹是左上角那格）；沒有物件回傳 null
    anchorAt(x, y) {
      const i = locate(x, y);
      if (i < 0 || !last.object[i]) return null;
      const { k, j } = anchorOffset(last.objectAnchor[i]);
      return { x: x - k, y: y - j };
    },
    // 水文、材質與物件都走得過去才算；樹幹那一格走不過去（樹冠其他格照物件的 passable）；生物那幾格擋路
    isPassable(x, y) {
      return groundPassable(x, y) && !creatureAt(x, y);
    },
    groundPassable,
  };
}
