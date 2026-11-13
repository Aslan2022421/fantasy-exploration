// 地形生成：大地形與水（landform.js）、溫度、濕度 → 每格的生態、地形層與物件層，加上明暗與台地立面。
// 只看「種子＋座標」，一區可以單獨生，任何順序生出來都一樣

import { inFootprint, MAX_SIZE, meanArea, PART_TRUNK, partOf, trunkCell } from './footprint.js';
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
  treelineRange: 0.2, // 山地高出山地門檻這麼多就沒有樹（中間線性變少）
  band: 0.1, // 溫度、濕度超過 ±這個值才算寒冷／炎熱、乾燥／潮濕
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
    if (h > LAND.mountain) return MOUNTAIN;
    return flora[biome].ground;
  }

  // 植物長得出來的地面：該生態的平地，或山地（使用者定：山地上也有樹）
  const canGrow = (terrain, biome) => terrain === flora[biome].ground || terrain === MOUNTAIN;

  // 物件層的錨點：這格是不是一棵物件的左上角。回傳 { object, size } 或 null。
  // 物件依物種有大小（資料的 sizes），撒的機率除以平均佔地，樹變大後林子的密度不會跟著暴增。
  // 山地上越高樹越少，高出山地門檻 treelineRange 就沒有樹（使用者定：山地的高度決定樹多不多）
  const objectArea = data.objects.map((o) => meanArea(o.sizes));
  function anchorAt(x, y, biome, terrain, h) {
    const f = flora[biome];
    if (!canGrow(terrain, biome)) return null;
    const line = terrain === MOUNTAIN ? Math.max(0, 1 - (h - LAND.mountain) / GEN.treelineRange) : 1;
    if (line <= 0) return null;
    const m = Math.min(1, Math.max(0, 0.5 + 1.5 * fbm(nFlora, x, y, GEN.floraBase, 2)));
    for (let i = 0; i < f.list.length; i++) {
      const [object, density] = f.list[i];
      if (hash01(seed, x, y, i) < (Math.min(1, density * 2 * m) * line) / objectArea[object]) {
        const sizes = data.objects[object].sizes;
        return { object, size: sizes[Math.floor(hash01(seed, x, y, 50 + i) * sizes.length)] };
      }
    }
    return null;
  }

  // 生一區：(zx, zy) 是區座標，size 是邊長。外圍多算 PAD 圈：明暗、坡度與立面要看鄰格，
  // 多格物件的錨點可能在區外左上方（最遠 MAX_SIZE-1 格）
  function genZone(zx, zy, size) {
    const n = size * size;
    const height = new Uint8Array(n);
    const terrain = new Uint8Array(n);
    const object = new Uint8Array(n); // 物件層：物件編號＋1，0 是沒有
    const objectPart = new Uint8Array(n); // 這格在樹冠的哪一側（footprint.js 的 PART_*）
    const shade = new Uint8Array(n);
    const relief = new Uint8Array(n);
    const tier = new Uint8Array(n); // 高度層：水 0、陸地 1～4，山地最高 7
    const biome = new Uint8Array(n);
    const PAD = Math.max(2, MAX_SIZE - 1);
    const B = size + PAD * 2;
    const x0 = zx * size;
    const y0 = zy * size;
    const g = land.grid(x0 - PAD, y0 - PAD, B, B);
    // 先把整片（含外圍）的生態、地形、錨點算好
    const bAll = new Uint8Array(B * B);
    const tAll = new Uint8Array(B * B);
    const anchors = new Array(B * B).fill(null);
    for (let y = 0; y < B; y++) {
      for (let x = 0; x < B; x++) {
        const c = y * B + x;
        const X = x0 + x - PAD;
        const Y = y0 + y - PAD;
        bAll[c] = biomeAt(tempAt(X, Y), wetAt(X, Y));
        tAll[c] = classify(g.water[c], g.h[c], bAll[c]);
        anchors[c] = anchorAt(X, Y, bAll[c], tAll[c], g.h[c]);
      }
    }
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const c = (y + PAD) * B + (x + PAD);
        const h = g.h[c];
        const i = y * size + x;
        height[i] = Math.round((Math.max(-1, Math.min(1, h)) + 1) * 127.5);
        biome[i] = bAll[c];
        tier[i] = g.tier[c];
        relief[i] = reliefOf(g.tier[c - 2 * B], g.tier[c - B], g.tier[c], g.tier[c + B]);
        terrain[i] = tAll[c];
        // 物件：往左上找會蓋到這格的錨點。使用者定：樹冠底下要是平地（樹幹被破壞後樹冠消失，露出的是平地），
        // 所以樹冠只長在跟樹幹同一個高度層、而且長得出植物的格子上；樹幹那格本身也要長得出來。
        // 樹幹永遠露出來（它是樹冠的根）；其餘重疊時取雜湊最小的那棵
        if (canGrow(terrain[i], biome[i])) {
          let best = null;
          for (let j = 0; j < MAX_SIZE; j++) {
            for (let k = 0; k < MAX_SIZE; k++) {
              const ac = c - j * B - k;
              const a = anchors[ac];
              if (!a || !inFootprint(k, j, a.size)) continue;
              const tc = trunkCell(a.size);
              const tci = ac + tc.j * B + tc.i;
              if (!canGrow(tAll[tci], bAll[tci]) || g.tier[tci] !== g.tier[c]) continue;
              const isTrunk = data.objects[a.object].trunk && k === tc.i && j === tc.j;
              const rank = isTrunk ? -1 : hash01(seed, x0 + x - k, y0 + y - j, 77);
              if (!best || rank < best.rank) best = { a, rank, i: k, j, isTrunk };
            }
          }
          if (best) {
            object[i] = best.a.object + 1;
            objectPart[i] = best.isTrunk ? PART_TRUNK : partOf(best.i, best.j, best.a.size);
          }
        }
        if (g.water[c] === WATER_NONE) {
          const grad = gradient((dx, dy) => g.h[c + dy * B + dx]);
          shade[i] = lightLevel(tier[i], shadeLevel(grad.dx, grad.dy), terrain[i] === MOUNTAIN);
        } else shade[i] = waterLevel(h);
      }
    }
    return { zx, zy, size, height, terrain, object, objectPart, shade, relief, tier, biome };
  }

  return { genZone, heightAt: land.heightAt, landform: land, tempAt, wetAt, biomeAt };
}
