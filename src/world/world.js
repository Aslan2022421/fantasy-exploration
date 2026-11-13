// 世界分兩層：世界層一格＝一個局部區域（每格又分地形層與物件層，見 terrain.js）。世界層一開始整個算好（每區的氣候與生態標籤），
// 局部區域用到才生、生過就留著。全世界共用一套格子座標，跨區時無縫走過去。
// 地圖不進存檔：讀檔時用種子重生，再把紀錄套回去

import { PART_TRUNK } from './footprint.js';
import { bandOf, createTerrainGen, TEMP_BANDS, WET_BANDS } from './terrain.js';

// 世界版本：改了地形生成（landform.js、terrain.js、地形或生態資料）就加一，舊存檔自動作廢
export const WORLD_VERSION = 5; // 5：每格存坡度（字形看地表起伏）

export const ZONES_X = 3; // 世界層寬幾區（之後要 96×96 只改這兩個數字）
export const ZONES_Y = 3;
export const ZONE_SIZE = 96; // 一區的邊長（格）
const SAMPLES = 8; // 世界層每區取 8×8 個點平均

export function createWorld(seed, data, { zonesX = ZONES_X, zonesY = ZONES_Y, zoneSize = ZONE_SIZE } = {}) {
  const gen = createTerrainGen(seed, data);
  const width = zonesX * zoneSize;
  const height = zonesY * zoneSize;

  // 世界層：每區的平均溫度、濕度、高度，以及由此得出的氣候與生態標籤。
  // numbers 是「每區幾個數字」的位置，各數字等用到的階段再加
  const regions = [];
  for (let zy = 0; zy < zonesY; zy++) {
    for (let zx = 0; zx < zonesX; zx++) {
      let t = 0;
      let w = 0;
      let h = 0;
      const step = zoneSize / SAMPLES;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const x = zx * zoneSize + (sx + 0.5) * step;
          const y = zy * zoneSize + (sy + 0.5) * step;
          t += gen.tempAt(x, y);
          w += gen.wetAt(x, y);
          h += gen.heightAt(x, y);
        }
      }
      const k = SAMPLES * SAMPLES;
      const temperature = t / k;
      const moisture = w / k;
      regions.push({
        zx,
        zy,
        temperature,
        moisture,
        height: h / k,
        climate: { temperature: TEMP_BANDS[bandOf(temperature)], moisture: WET_BANDS[bandOf(moisture)] },
        biome: data.biomes[gen.biomeAt(temperature, moisture)].id,
        numbers: {},
      });
    }
  }

  const zones = new Map(); // "zx,zy" → 生好的區
  let last = null; // 查格子是最常做的事：先看是不是跟上一次同一區

  const inside = (x, y) => x >= 0 && y >= 0 && x < width && y < height;

  function zone(zx, zy) {
    const key = `${zx},${zy}`;
    let z = zones.get(key);
    if (!z) {
      z = gen.genZone(zx, zy, zoneSize);
      zones.set(key, z);
    }
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

  function cell(x, y) {
    const i = locate(x, y);
    if (i < 0) return null;
    const t = data.terrains[last.terrain[i]];
    const o = last.object[i];
    return {
      terrain: t,
      object: o ? data.objects[o - 1] : null,
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
    region: (zx, zy) => regions[zy * zonesX + zx] ?? null,
    regionAt: (x, y) => (inside(x, y) ? regions[Math.floor(y / zoneSize) * zonesX + Math.floor(x / zoneSize)] : null),
    zone,
    generatedZones: () => zones.size,
    inside,
    cell,
    // 地形編號（data.terrains 的索引）；世界外是 -1
    terrainAt(x, y) {
      const i = locate(x, y);
      return i < 0 ? -1 : last.terrain[i];
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
    // 高度層：水 0、陸地 1～4（landform.js）；世界外是 0
    tierAt(x, y) {
      const i = locate(x, y);
      return i < 0 ? 0 : last.tier[i];
    },
    // 台地立面（relief.js 的 FLAT、RIM、FACE、FACE_FAR）
    reliefAt(x, y) {
      const i = locate(x, y);
      return i < 0 ? 0 : last.relief[i];
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
    // 地形與物件都走得過去才算；樹幹那一格走不過去（樹冠其他格照物件的 passable）
    isPassable(x, y) {
      const i = locate(x, y);
      if (i < 0 || !data.terrains[last.terrain[i]].passable) return false;
      const o = last.object[i];
      if (!o) return true;
      return data.objects[o - 1].passable && last.objectPart[i] !== PART_TRUNK;
    },
  };
}

// 起點：世界正中央，往外一圈一圈找第一個能走的格子
export function startPosition(world) {
  const cx = Math.floor(world.width / 2);
  const cy = Math.floor(world.height / 2);
  for (let r = 0; r < Math.max(world.width, world.height); r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (world.isPassable(cx + dx, cy + dy)) return { x: cx + dx, y: cy + dy };
      }
    }
  }
  return { x: cx, y: cy };
}
