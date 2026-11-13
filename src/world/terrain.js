// 地形生成：大地形與水（landform.js）、溫度、濕度 → 每格的生態、地形層與物件層，加上明暗與台地立面。
// 只看「種子＋座標」，一區可以單獨生，任何順序生出來都一樣

import { gradient, LEVELS, lightLevel, shadeLevel } from './hillshade.js';
import { createLandform, LAND, WATER_DEEP, WATER_NONE, WATER_SHALLOW } from './landform.js';
import { fbm, hash01, makeNoise } from './noise.js';
import { reliefOf } from './relief.js';

// 生成的參數（調比例時改這裡；大地形與水的參數在 landform.js 的 LAND）
export const GEN = {
  climateBase: 144, // 溫度、濕度最粗那層的波長，約 1.5 區
  tempOctaves: 2,
  wetOctaves: 3,
  floraBase: 24, // 樹叢成片的大小
  band: 0.1, // 溫度、濕度超過 ±這個值才算寒冷／炎熱、乾燥／潮濕
  mountain: 0.42, // 高度高於這個是山地
  waterShadeStep: 0.05, // 水每深這麼多暗一級
};

export const TEMP_BANDS = ['cold', 'mild', 'hot'];
export const WET_BANDS = ['dry', 'normal', 'wet'];

export function bandOf(v) {
  return v < -GEN.band ? 0 : v > GEN.band ? 2 : 1;
}

// 水面的亮度級數：越深越暗（淺灘第 6 級，往下每 waterShadeStep 暗一級，最暗第 1 級）
export function waterLevel(h) {
  const depth = LAND.water - h;
  return Math.max(1, Math.min(LEVELS - 2, LEVELS - 2 - Math.floor(depth / GEN.waterShadeStep)));
}

export function createTerrainGen(seed, data) {
  const land = createLandform(seed);
  const nTemp = makeNoise(seed, 'terrain:temperature');
  const nWet = makeNoise(seed, 'terrain:moisture');
  const nFlora = makeNoise(seed, 'terrain:flora');
  const T = data.terrainIndex;
  const id = (name) => {
    if (!T.has(name)) throw new Error(`地形生成需要的地形不在資料裡：${name}`);
    return T.get(name);
  };
  const DEEP = id('deep-water');
  const SHALLOW = id('shallow-water');
  const MOUNTAIN = id('mountain');

  // 溫度帶×濕度帶 → 生態（資料裡的編號）；每格都有，九格要齊
  const biomeGrid = [];
  for (let t = 0; t < 3; t++) {
    for (let w = 0; w < 3; w++) {
      const b = data.biomes.findIndex((x) => x.temperature === TEMP_BANDS[t] && x.moisture === WET_BANDS[w]);
      if (b < 0) throw new Error(`缺少生態：${TEMP_BANDS[t]}×${WET_BANDS[w]}`);
      biomeGrid[t * 3 + w] = b;
    }
  }
  const objectId = (name) => {
    if (!data.objectIndex.has(name)) throw new Error(`物件生成需要的物件不在資料裡：${name}`);
    return data.objectIndex.get(name);
  };
  const flora = data.biomes.map((b) => ({
    ground: id(b.ground),
    list: b.flora.map((f) => [objectId(f.object), f.density]),
  }));

  const tempAt = (x, y) => fbm(nTemp, x, y, GEN.climateBase, GEN.tempOctaves);
  const wetAt = (x, y) => fbm(nWet, x, y, GEN.climateBase, GEN.wetOctaves);
  const biomeAt = (temp, wet) => biomeGrid[bandOf(temp) * 3 + bandOf(wet)];

  // 地形層：water 水的種類、h 高度、biome 生態編號
  function classify(water, h, biome) {
    if (water === WATER_DEEP) return DEEP;
    if (water === WATER_SHALLOW) return SHALLOW;
    if (h > GEN.mountain) return MOUNTAIN;
    return flora[biome].ground;
  }

  // 物件層：只撒在該生態的平地上。回傳物件編號＋1，0 是沒有物件
  function placeObject(x, y, biome, terrain) {
    const f = flora[biome];
    if (terrain !== f.ground) return 0;
    const m = Math.min(1, Math.max(0, 0.5 + 1.5 * fbm(nFlora, x, y, GEN.floraBase, 2)));
    for (let i = 0; i < f.list.length; i++) {
      const [object, density] = f.list[i];
      if (hash01(seed, x, y, i) < Math.min(1, density * 2 * m)) return object + 1;
    }
    return 0;
  }

  // 生一區：(zx, zy) 是區座標，size 是邊長。外圍多算兩圈，明暗、坡度與立面在邊上也正確
  function genZone(zx, zy, size) {
    const n = size * size;
    const height = new Uint8Array(n);
    const terrain = new Uint8Array(n);
    const object = new Uint8Array(n); // 物件層：物件編號＋1，0 是沒有
    const shade = new Uint8Array(n);
    const relief = new Uint8Array(n);
    const tier = new Uint8Array(n); // 高度層：水 0、陸地 1～4；亮度與斜投影抬高幾行都看它
    const biome = new Uint8Array(n);
    const PAD = 2;
    const B = size + PAD * 2;
    const x0 = zx * size;
    const y0 = zy * size;
    const g = land.grid(x0 - PAD, y0 - PAD, B, B);
    const k = (x, y) => (y + PAD) * B + (x + PAD);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const c = k(x, y);
        const h = g.h[c];
        const X = x0 + x;
        const Y = y0 + y;
        const b = biomeAt(tempAt(X, Y), wetAt(X, Y));
        const i = y * size + x;
        height[i] = Math.round((Math.max(-1, Math.min(1, h)) + 1) * 127.5);
        biome[i] = b;
        tier[i] = g.tier[c];
        relief[i] = reliefOf(g.tier[c - 2 * B], g.tier[c - B], g.tier[c], g.tier[c + B]);
        terrain[i] = classify(g.water[c], h, b);
        object[i] = placeObject(X, Y, b, terrain[i]);
        if (g.water[c] === WATER_NONE) {
          const grad = gradient((dx, dy) => g.h[c + dy * B + dx]);
          shade[i] = lightLevel(tier[i], shadeLevel(grad.dx, grad.dy));
        } else shade[i] = waterLevel(h);
      }
    }
    return { zx, zy, size, height, terrain, object, shade, relief, tier, biome };
  }

  return { genZone, heightAt: land.heightAt, landform: land, tempAt, wetAt, biomeAt };
}
