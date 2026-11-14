// 地形生成：每格分四層（使用者定）＋物件層。
// - 地貌：平原、丘陵、高原、山地，看高度、高度層與坡度，山地另標山峰；水文：深水、淺水（landform.js）、
//   河流與淺灘（geography.js 在整個世界上先算好）、沼澤（低窪、平坦、潮濕的地方積水）
// - 地表材質看氣候（climate.js）、坡度與是否在山上；生態覆蓋照生態的 cover，水邊長蘆葦，交界是混合植被
// 生成順序是地貌 → 水文 → 材質 → 生態。只看「種子＋座標」與世界的地理，任何順序生出來都一樣

import { CLIMATE, createClimate } from './climate.js';
import { inFootprint, MAX_SIZE, meanArea, PART_TRUNK, partOf, trunkCell } from './footprint.js';
import { gradient, LEVELS, lightLevel, shadeLevel } from './hillshade.js';
import { createLandform, LAND, WATER_DEEP, WATER_NONE, WATER_SHALLOW } from './landform.js';
import { fbm, hash01, makeNoise } from './noise.js';
import { isPeak } from './peak.js';
import { reliefOf } from './relief.js';
import { applyGeography } from './riverbed.js';

// 生成的參數（調比例時改這裡；大地形與水的參數在 landform.js 的 LAND）
export const GEN = {
  floraBase: 24, // 樹叢成片的大小
  treelineRange: 0.2, // 山地高出山地門檻這麼多就沒有樹（中間線性變少），也是雪線
  band: 0.1, // 溫度、濕度超過 ±這個值才算寒冷／炎熱、乾燥／潮濕
  waterShadeStep: 0.05, // 水每深這麼多暗一級
  // 坡度門檻（SLOPE_SCALE 倍；陸地約一半在 39 以下）
  hillSlope: 55, // 以上是丘陵
  gravelSlope: 95, // 山地以外坡度到這裡露出碎石（量過：非山地陸地約 6% 在這以上）
  rockSlope: 110, // 到這裡露出裸岩（約 2%）
  mountainRock: 45, // 山上坡度到這裡是岩石（以下是碎石）
  peakRadius: 3, // 山地格比周圍這麼多格內都高，才算山峰（不能超過 genZone 的外圍 E）
  swampSlope: 39, // 沼澤要比這個平
  swampWet: 0.18, // 濕度高於這個、又在最低的陸地層才積水成沼澤
  reeds: 0.12, // 緊鄰淺水或沼澤的泥土長蘆葦的機率（覆蓋全部乘 0.3，地面才空得出來，使用者同意）
  mixed: 0.15, // 生態交界長混合植被的機率
};

export const SLOPE_SCALE = 4000; // 坡度存成整數時放大的倍數

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

const NONE = 255; // 水文、覆蓋沒有東西時存這個

export function createTerrainGen(seed, data) {
  const land = createLandform(seed);
  const { climateAt, setMoisture } = createClimate(seed);
  let geo = null; // 世界的地理（geography.js：河流、淺灘、濕度），世界建好後由 setGeography 接上
  const nFlora = makeNoise(seed, 'terrain:flora');
  const need = (index, kind) => (name) => {
    if (!index.has(name)) throw new Error(`地形生成需要的${kind}不在資料裡：${name}`);
    return index.get(name);
  };
  const lf = need(data.landformIndex, '地貌');
  const sf = need(data.surfaceIndex, '地表材質');
  const wt = need(data.waterIndex, '水文');
  const cv = need(data.coverIndex, '生態覆蓋');
  const PLAIN = lf('plain');
  const HILLS = lf('hills');
  const PLATEAU = lf('plateau');
  const MOUNTAIN = lf('mountain');
  const DIRT = sf('dirt');
  const SAND = sf('sand');
  const ROCK = sf('rock');
  const GRAVEL = sf('gravel');
  const SNOW = sf('snow');
  const ICE = sf('ice');
  const DEEP = wt('deep-water');
  const SHALLOW = wt('shallow-water');
  const SWAMP = wt('swamp');
  const REEDS = cv('reeds');
  const MIXED = cv('mixed');

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
  const flora = data.biomes.map((b) => b.flora.map((f) => [objectId(f.object), f.density]));
  const covers = data.biomes.map((b) => b.cover.map((c) => [cv(c.cover), c.density]));

  const biomeAt = (temp, wet) => biomeGrid[bandOf(temp) * 3 + bandOf(wet)];

  // 地貌：h 高度、tier 高度層、slope 坡度
  function landformOf(h, tier, slope) {
    if (h > LAND.mountain) return MOUNTAIN;
    if (slope >= GEN.hillSlope) return HILLS;
    if (tier >= LAND.landTiers) return PLATEAU;
    return PLAIN;
  }

  // 水文：kind 是 landform.js 的水；沼澤是最低的陸地層裡平坦又潮濕的地方
  function waterOf(kind, tier, slope, wet) {
    if (kind === WATER_DEEP) return DEEP;
    if (kind === WATER_SHALLOW) return SHALLOW;
    if (tier === 1 && slope < GEN.swampSlope && wet > GEN.swampWet) return SWAMP;
    return NONE;
  }

  // 地表材質：t、w 是溫度帶與濕度帶，temp 是溫度本身（很冷才積雪，climate.js）
  function surfaceOf(water, h, slope, t, w, temp) {
    const frozen = temp < CLIMATE.snowTemp;
    if (water === SHALLOW && t === 0) return ICE; // 寒帶的淺水結冰
    if (water !== NONE) return DIRT; // 水底與沼澤的泥
    if (h > LAND.mountain) {
      if (frozen || h > LAND.mountain + GEN.treelineRange) return SNOW;
      return slope >= GEN.mountainRock ? ROCK : GRAVEL;
    }
    if (t === 0) return frozen ? SNOW : DIRT; // 寒帶沒那麼冷是凍土
    if (t === 2 && w === 0) return SAND;
    if (slope >= GEN.rockSlope) return ROCK;
    if (slope >= GEN.gravelSlope) return GRAVEL;
    return DIRT;
  }

  // 植物長得出來的地方：沒有水、不是岩石或冰
  const canGrow = (water, surface) => water === NONE && surface !== ROCK && surface !== ICE;

  // 物件層的錨點：這格是不是一棵物件的左上角，回傳 { object, size, turn } 或 null。撒的機率除以平均佔地，
  // 樹變大後林子不會跟著變密；山地越高樹越少，高出 treelineRange 就沒有樹（使用者定）
  const objectArea = data.objects.map((o) => meanArea(o.sizes, o.canopy));
  function anchorAt(x, y, biome, water, surface, h) {
    if (!canGrow(water, surface)) return null;
    const line = h > LAND.mountain ? Math.max(0, 1 - (h - LAND.mountain) / GEN.treelineRange) : 1;
    if (line <= 0) return null;
    const list = flora[biome];
    const m = Math.min(1, Math.max(0, 0.5 + 1.5 * fbm(nFlora, x, y, GEN.floraBase, 2)));
    for (let i = 0; i < list.length; i++) {
      const [object, density] = list[i];
      if (hash01(seed, x, y, i) < (Math.min(1, density * 2 * m) * line) / objectArea[object]) {
        const sizes = data.objects[object].sizes;
        const size = sizes[Math.floor(hash01(seed, x, y, 50 + i) * sizes.length)];
        return { object, size, turn: hash01(seed, x, y, 60 + i) < 0.5 }; // turn：對邊兩片的樹冠是上下還是左右
      }
    }
    return null;
  }

  // 生一區：(zx, zy) 是區座標，size 是邊長。外圍多算 PAD 圈（明暗、坡度要看鄰格，樹的錨點可能在區外左上方），再多一圈 E
  function genZone(zx, zy, size) {
    const n = size * size;
    const height = new Uint8Array(n);
    const landform = new Uint8Array(n);
    const peak = new Uint8Array(n); // 1 是山峰（山地裡附近最高的一格）
    const surface = new Uint8Array(n);
    const water = new Uint8Array(n).fill(NONE); // 水文編號，NONE 是沒有水
    const cover = new Uint8Array(n).fill(NONE); // 生態覆蓋編號，NONE 是沒有
    const object = new Uint8Array(n); // 物件層：物件編號＋1，0 是沒有
    const objectPart = new Uint8Array(n); // 這格在樹冠的哪一側（footprint.js 的 PART_*）
    const shade = new Uint8Array(n);
    const slope = new Uint8Array(n); // 坡度（每格高度差×SLOPE_SCALE，0～255）
    const relief = new Uint8Array(n);
    const tier = new Uint8Array(n); // 高度層：水 0、陸地 1～4，山地最高 MAX_TIER
    const biome = new Uint8Array(n);
    const PAD = Math.max(2, MAX_SIZE - 1);
    const E = PAD + 1;
    const G = size + E * 2;
    const x0 = zx * size;
    const y0 = zy * size;
    const g = land.grid(x0 - E, y0 - E, G, G);
    if (geo) applyGeography(g, x0 - E, y0 - E, G, geo, land.macroAt); // 河道、淺灘畫進高度格
    const N = G * G;
    const bAll = new Uint8Array(N);
    const tBand = new Uint8Array(N);
    const wBand = new Uint8Array(N);
    const slAll = new Uint8Array(N);
    const wAll = new Uint8Array(N).fill(NONE);
    const sAll = new Uint8Array(N);
    const anchors = new Array(N).fill(null);
    const hAt = (c) => (dx, dy) => g.h[c + dy * G + dx];
    for (let y = 0; y < G; y++) {
      for (let x = 0; x < G; x++) {
        const c = y * G + x;
        const X = x0 + x - E;
        const Y = y0 + y - E;
        const { t, w } = climateAt(X, Y, g.h[c]);
        bAll[c] = biomeAt(t, w);
        tBand[c] = bandOf(t);
        wBand[c] = bandOf(w);
        if (x === 0 || y === 0 || x === G - 1 || y === G - 1) continue; // 最外圈只當鄰格用
        const grad = gradient(hAt(c));
        slAll[c] = Math.min(255, Math.round(Math.hypot(grad.dx, grad.dy) * SLOPE_SCALE));
        wAll[c] = waterOf(g.water[c], g.tier[c], slAll[c], w);
        sAll[c] = surfaceOf(wAll[c], g.h[c], slAll[c], tBand[c], wBand[c], t);
        anchors[c] = anchorAt(X, Y, bAll[c], wAll[c], sAll[c], g.h[c]);
      }
    }
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const c = (y + E) * G + (x + E);
        const h = g.h[c];
        const i = y * size + x;
        const X = x0 + x;
        const Y = y0 + y;
        height[i] = Math.round((Math.max(-1, Math.min(1, h)) + 1) * 127.5);
        biome[i] = bAll[c];
        tier[i] = g.tier[c];
        relief[i] = reliefOf(g.tier[c - 2 * G], g.tier[c - G], g.tier[c], g.tier[c + G]);
        slope[i] = g.water[c] === WATER_NONE ? slAll[c] : 0;
        landform[i] = landformOf(h, tier[i], slope[i]);
        peak[i] = landform[i] === MOUNTAIN && isPeak(g.h, c, G, GEN.peakRadius) ? 1 : 0;
        water[i] = wAll[c];
        surface[i] = sAll[c];
        cover[i] = coverAt(c, X, Y);
        // 物件：往左上找會蓋到這格的錨點。使用者定：樹冠底下要是平地（樹幹被破壞後樹冠消失，露出的是平地），
        // 所以樹冠只長在跟樹幹同一個高度層、而且長得出植物的格子上；樹幹那格本身也要長得出來。
        // 樹幹永遠露出來（它是樹冠的根）；其餘重疊時取雜湊最小的那棵
        if (canGrow(wAll[c], sAll[c])) {
          let best = null;
          for (let j = 0; j < MAX_SIZE; j++) {
            for (let k = 0; k < MAX_SIZE; k++) {
              const ac = c - j * G - k;
              const a = anchors[ac];
              if (!a || !inFootprint(k, j, a.size, data.objects[a.object].canopy, a.turn)) continue;
              const tc = trunkCell(a.size);
              const tci = ac + tc.j * G + tc.i;
              if (!canGrow(wAll[tci], sAll[tci]) || g.tier[tci] !== g.tier[c]) continue;
              const isTrunk = data.objects[a.object].trunk && k === tc.i && j === tc.j;
              const rank = isTrunk ? -1 : hash01(seed, X - k, Y - j, 77);
              if (!best || rank < best.rank) best = { a, rank, i: k, j, isTrunk };
            }
          }
          if (best) {
            object[i] = best.a.object + 1;
            objectPart[i] = best.isTrunk ? PART_TRUNK : partOf(best.i, best.j, best.a.size);
          }
        }
        if (g.water[c] === WATER_NONE) {
          const grad = gradient(hAt(c));
          shade[i] = lightLevel(tier[i], shadeLevel(grad.dx, grad.dy), landform[i] === MOUNTAIN);
        } else shade[i] = waterLevel(h);
      }
    }

    // 生態覆蓋：只長在泥土與沙地上。緊鄰淺水或沼澤的泥土長蘆葦；生態交界是混合植被；其餘照生態的 cover
    function coverAt(c, X, Y) {
      const s = sAll[c];
      if (wAll[c] !== NONE || (s !== DIRT && s !== SAND)) return NONE;
      const a = hash01(seed, X, Y, 101);
      const b = hash01(seed, X, Y, 102);
      let wet = false;
      let edge = false;
      for (const d of [1, -1, G, -G]) {
        if (wAll[c + d] === SHALLOW || wAll[c + d] === SWAMP) wet = true;
        if (bAll[c + d] !== bAll[c]) edge = true;
      }
      if (wet && s === DIRT && b < GEN.reeds) return REEDS;
      const list = covers[bAll[c]];
      if (edge && list.length && b < GEN.mixed) return MIXED;
      let sum = 0;
      for (const [k, density] of list) {
        sum += density;
        if (a < sum) return k;
      }
      return NONE;
    }

    return {
      zx,
      zy,
      size,
      height,
      landform,
      peak,
      surface,
      water,
      cover,
      object,
      objectPart,
      shade,
      slope,
      relief,
      tier,
      biome,
    };
  }

  function setGeography(x) {
    geo = x;
    setMoisture(x.moistureAt);
  }

  return { genZone, heightAt: land.heightAt, landform: land, climateAt, biomeAt, setGeography };
}

export { NONE as LAYER_NONE };
