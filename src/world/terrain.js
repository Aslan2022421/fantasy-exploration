// 地形生成：高度、溫度、濕度三層雜訊 → 每格的生態與地形，加上明暗與台地立面。
// 只看「種子＋座標」，一區可以單獨生，任何順序生出來都一樣

import { gradient, shadeLevel } from './hillshade.js';
import { fbm, hash01, makeNoise } from './noise.js';
import { reliefOf } from './relief.js';

// 生成的參數（調比例時改這裡）
export const GEN = {
  heightBase: 128, // 高度最粗那層的波長（格）
  heightOctaves: 5,
  climateBase: 144, // 溫度、濕度最粗那層的波長，約 1.5 區
  tempOctaves: 2,
  wetOctaves: 3,
  floraBase: 24, // 樹叢成片的大小
  band: 0.1, // 溫度、濕度超過 ±這個值才算寒冷／炎熱、乾燥／潮濕
  deepWater: -0.34, // 高度低於這個是深水
  shallowWater: -0.24, // 低於這個是淺水
  wetWaterShift: 0.08, // 越濕水面越高（潮濕 +1 時水線抬高這麼多）
  mountain: 0.42, // 高度高於這個是山地
  wallSlope: 0.034, // 坡度（每格高度差）超過這個、又在高處，就是岩壁
  wallMinHeight: 0.28,
  terraceOctaves: 3, // 台地的分階只看高度較粗的幾層，等高線才連成線，不會到處是零碎的立面
};

export const TEMP_BANDS = ['cold', 'mild', 'hot'];
export const WET_BANDS = ['dry', 'normal', 'wet'];

export function bandOf(v) {
  return v < -GEN.band ? 0 : v > GEN.band ? 2 : 1;
}

export function createTerrainGen(seed, data) {
  const nHeight = makeNoise(seed, 'terrain:height');
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
  const WALL = id('rock-wall');

  // 溫度帶×濕度帶 → 生態（資料裡的編號）；每格都有，九格要齊
  const biomeGrid = [];
  for (let t = 0; t < 3; t++) {
    for (let w = 0; w < 3; w++) {
      const b = data.biomes.findIndex((x) => x.temperature === TEMP_BANDS[t] && x.moisture === WET_BANDS[w]);
      if (b < 0) throw new Error(`缺少生態：${TEMP_BANDS[t]}×${WET_BANDS[w]}`);
      biomeGrid[t * 3 + w] = b;
    }
  }
  const flora = data.biomes.map((b) => ({
    ground: id(b.ground),
    list: b.flora.map((f) => [id(f.terrain), f.density]),
  }));

  const heightAt = (x, y) => fbm(nHeight, x, y, GEN.heightBase, GEN.heightOctaves);
  const terraceHeightAt = (x, y) => fbm(nHeight, x, y, GEN.heightBase, GEN.terraceOctaves);
  const tempAt = (x, y) => fbm(nTemp, x, y, GEN.climateBase, GEN.tempOctaves);
  const wetAt = (x, y) => fbm(nWet, x, y, GEN.climateBase, GEN.wetOctaves);
  const biomeAt = (temp, wet) => biomeGrid[bandOf(temp) * 3 + bandOf(wet)];

  // 一格的地形：h 高度、slope 坡度、biome 生態編號、wet 濕度
  function classify(x, y, h, slope, biome, wet) {
    const shift = GEN.wetWaterShift * wet;
    if (h < GEN.deepWater + shift) return DEEP;
    if (h < GEN.shallowWater + shift) return SHALLOW;
    if (h > GEN.wallMinHeight && slope > GEN.wallSlope) return WALL;
    if (h > GEN.mountain) return MOUNTAIN;
    const f = flora[biome];
    const m = Math.min(1, Math.max(0, 0.5 + 1.5 * fbm(nFlora, x, y, GEN.floraBase, 2)));
    for (let i = 0; i < f.list.length; i++) {
      const [terrain, density] = f.list[i];
      if (hash01(seed, x, y, i) < Math.min(1, density * 2 * m)) return terrain;
    }
    return f.ground;
  }

  // 生一區：(zx, zy) 是區座標，size 是邊長。外圍多算兩圈高度，明暗、坡度與立面在邊上也正確
  function genZone(zx, zy, size) {
    const n = size * size;
    const height = new Uint8Array(n);
    const terrain = new Uint8Array(n);
    const shade = new Uint8Array(n);
    const relief = new Uint8Array(n);
    const biome = new Uint8Array(n);
    const PAD = 2;
    const B = size + PAD * 2;
    const x0 = zx * size;
    const y0 = zy * size;
    const hb = new Float32Array(B * B);
    for (let y = 0; y < B; y++) for (let x = 0; x < B; x++) hb[y * B + x] = heightAt(x0 + x - PAD, y0 + y - PAD);
    // 台地用的粗高度：只需要這格與正北兩格、正南一格
    const tb = new Float32Array(B * B);
    for (let y = 0; y < B; y++) {
      for (let x = PAD; x < B - PAD; x++) tb[y * B + x] = terraceHeightAt(x0 + x - PAD, y0 + y - PAD);
    }
    const tat = (x, y, dy) => tb[(y + PAD + dy) * B + (x + PAD)];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const at = (dx, dy) => hb[(y + PAD + dy) * B + (x + PAD + dx)];
        const h = at(0, 0);
        const g = gradient(at);
        const X = x0 + x;
        const Y = y0 + y;
        const wet = wetAt(X, Y);
        const b = biomeAt(tempAt(X, Y), wet);
        const i = y * size + x;
        height[i] = Math.round((Math.max(-1, Math.min(1, h)) + 1) * 127.5);
        biome[i] = b;
        terrain[i] = classify(X, Y, h, Math.hypot(g.dx, g.dy), b, wet);
        shade[i] = shadeLevel(g.dx, g.dy);
        relief[i] = reliefOf(tat(x, y, -2), tat(x, y, -1), tat(x, y, 0), tat(x, y, 1));
      }
    }
    return { zx, zy, size, height, terrain, shade, relief, biome };
  }

  return { genZone, heightAt, terraceHeightAt, tempAt, wetAt, biomeAt };
}
