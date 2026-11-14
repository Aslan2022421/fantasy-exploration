// 世界分兩層：世界層一格＝一個局部區域（每格又分地形層與物件層，見 terrain.js）。世界層一開始整個算好（每區的氣候與生態標籤），
// 局部區域用到才生，最近用過的 64 區留著。全世界共用一套格子座標，跨區時無縫走過去。
// 地圖不進存檔：讀檔時用種子重生，再把紀錄套回去

import { PART_TRUNK } from './footprint.js';
import { buildGeography } from './geography.js';
import { bandOf, createTerrainGen, LAYER_NONE, TEMP_BANDS, WET_BANDS } from './terrain.js';

// 世界版本：改了地形生成（landform.js、terrain.js、地形或生態資料）就加一，舊存檔自動作廢
export const WORLD_VERSION = 13; // 13：世界放大到 96×96 區；淺灘不接海中的小島

// 世界層寬幾區（使用者定 96×96）：建世界（地理＋世界層）約 2 秒；區用到才生，一區約 25 毫秒
export const ZONES_X = 96;
export const ZONES_Y = 96;
export const ZONE_SIZE = 96; // 一區的邊長（格）
const SAMPLES = 8; // 世界層每區取 8×8 個點平均
const MAX_ZONES = 64; // 生過的區最多留幾區（一區十幾萬位元組，走遍 96×96 區會吃掉上 GB）

export function createWorld(seed, data, { zonesX = ZONES_X, zonesY = ZONES_Y, zoneSize = ZONE_SIZE } = {}) {
  const gen = createTerrainGen(seed, data);
  const width = zonesX * zoneSize;
  const height = zonesY * zoneSize;
  // 先在整個世界的粗格上算地理（河流、淺灘、濕度），之後每一區都照著畫
  const geography = buildGeography(gen.heightAt, seed, width, height);
  gen.setGeography(geography);

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
          const hh = gen.heightAt(x, y);
          const c = gen.climateAt(x, y, hh);
          t += c.t;
          w += c.w;
          h += hh;
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
    geography, // 世界的地理（河流、淺灘、濕度），除錯與量測用
    region: (zx, zy) => regions[zy * zonesX + zx] ?? null,
    regionAt: (x, y) => (inside(x, y) ? regions[Math.floor(y / zoneSize) * zonesX + Math.floor(x / zoneSize)] : null),
    zone,
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
    // 水文、材質與物件都走得過去才算；樹幹那一格走不過去（樹冠其他格照物件的 passable）
    isPassable(x, y) {
      const i = locate(x, y);
      if (i < 0) return false;
      const w = last.water[i];
      if (w !== LAYER_NONE && !data.waters[w].passable) return false;
      if (!data.surfaces[last.surface[i]].passable) return false;
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
