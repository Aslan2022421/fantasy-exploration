// 地形生成：每格分四層＋物件層。
// - 地貌：平原、丘陵、高原、山地，看高度、高度層與坡度，山地另標山峰；水文：深水、淺水（landform.js）、
//   河流與淺灘（geography.js 在整個世界上先算好）、沼澤（低窪、平坦、潮濕的地方積水）
// - 地表材質看氣候（climate.js）、坡度與是否在山上；生態覆蓋照生態的 cover，水邊長蘆葦，交界是混合植被
// 生成順序是地貌 → 水文 → 材質 → 生態。只看「種子＋座標」與世界的地理，任何順序生出來都一樣

import { placeBridges } from './bridges.js';
import { CLIMATE, createClimate } from './climate.js';
import { createContinent } from './continent.js';
import { createCoverPicker } from './cover.js';
import { MAX_SIZE, PART_MID } from './footprint.js';
import { GEO } from './geography.js';
import { createHerdPlacer } from './herds.js';
import { gradient, lightLevel, shadeLevel } from './hillshade.js';
import { createLandform, LAND, WATER_DEEP, WATER_NONE, WATER_SHALLOW } from './landform.js';
import { createNestPlanner, createNestStamp } from './nests.js';
import { createObjectPlacer } from './objects.js';
import { isPeak } from './peak.js';
import { applyGeography } from './riverbed.js';
import { createSettlePlanner, createSettleStamp } from './settlements.js';
import { bandOf, GEN, SLOPE_SCALE, TEMP_BANDS, WET_BANDS, waterLevel } from './terrain-params.js';

export { bandOf, GEN, SLOPE_SCALE, TEMP_BANDS, WET_BANDS, waterLevel };

const NONE = 255; // 水文、覆蓋沒有東西時存這個

// size：{ width, height } 世界的大小（格）。有給才墊世界形狀（continent.js）、算緯度；測試只看局部時不給
export function createTerrainGen(seed, data, size = null) {
  const shape = size ? createContinent(seed, data.worldShapes, size.width, size.height) : null;
  const land = createLandform(seed, shape?.id ? shape.at : null);
  const { climateAt, setMoisture } = createClimate(seed, size?.height);
  let geo = null; // 世界的地理（geography.js：河流、淺灘、濕度），世界建好後由 setGeography 接上
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
  const placer = createObjectPlacer(seed, data, { ROCK, DIRT, ICE, SHALLOW, DEEP, NONE }, GEN.treelineRange);
  const planHerds = createHerdPlacer(seed, data, { NONE });
  const planNest = createNestPlanner(seed, data, { NONE, SWAMP, ICE });
  const [YARD, SQUARE, ROAD, FLOOR, FLAG, CAVE] = ['yard', 'square', 'road', 'floor', 'flagstone', 'cave-floor'].map(
    sf,
  );
  const bridgeIds = { ew: data.objectIndex.get('bridge-ew'), ns: data.objectIndex.get('bridge-ns') };
  const stampNest = createNestStamp(data, { FLAG, DIRT, ROAD, CAVE, REEDS, SWAMP, NONE });
  const planSettle = createSettlePlanner(seed, data, { NONE, SWAMP, ICE });
  const stampSettle = createSettleStamp(data, { YARD, SQUARE, ROAD, FLOOR, NONE });
  let herdTargets = null; // (zx, zy) → { herbivores, predators }，建世界時由 world.js 接上；沒接就不放生物
  let settlePlan = null; // (zx, zy) → 'village' | 'town' | null，建世界時由 world.js 接上；沒接就沒有聚落
  let startZone = null; // 起點那一區 { zx, zy }（村莊在整區裡找位置）
  const covers = data.biomes.map((b) => b.cover.map((c) => [cv(c.cover), c.density]));
  const pickCover = createCoverPicker(
    seed,
    covers,
    { NONE, DIRT, SAND, SHALLOW, SWAMP, REEDS, MIXED },
    { reeds: GEN.reeds, mixed: GEN.mixed },
  );

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
    const objectAnchor = new Uint8Array(n); // 這格的物件錨點在左上幾格（objects.js 的 anchorOffset）
    const shade = new Uint8Array(n);
    const slope = new Uint8Array(n); // 坡度（每格高度差×SLOPE_SCALE，0～255）
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
        anchors[c] = placer.anchorAt(X, Y, bAll[c], wAll[c], sAll[c], g.h[c], slAll[c]);
      }
    }
    const z = {
      G,
      E,
      size,
      gx0: x0 - E,
      gy0: y0 - E,
      h: g.h,
      tier: g.tier,
      sAll,
      wAll,
      tBand,
      wBand,
      biome: bAll,
      anchors,
      // 世界地理粗格的高度（找谷地周圍的山用，objects.js）；沒接地理時沒有
      coarse: geo
        ? (x, y) => {
            const i = Math.floor(x / GEO.cell);
            const j = Math.floor(y / GEO.cell);
            return i < 0 || j < 0 || i >= geo.W || j >= geo.H ? -1 : geo.elev[j * geo.W + i];
          }
        : null,
    };
    // 聚落（settlements.js）與據點（nests.js）：一區最多一樣，整塊圖樣在這一區裡，直接蓋進物件層與地面
    const kind = settlePlan?.(zx, zy);
    const isStart = startZone?.zx === zx && startZone?.zy === zy;
    const settle = kind ? planSettle(z, zx, zy, kind, isStart) : null;
    const nest = settle ? null : planNest(z, zx, zy, geo?.start);
    const zc = { sAll, wAll, bAll, G }; // 生態覆蓋看的格子（cover.js）
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
        slope[i] = g.water[c] === WATER_NONE ? slAll[c] : 0;
        landform[i] = landformOf(h, tier[i], slope[i]);
        peak[i] = landform[i] === MOUNTAIN && isPeak(g.h, c, G, GEN.peakRadius) ? 1 : 0;
        water[i] = wAll[c];
        surface[i] = sAll[c];
        cover[i] = pickCover(zc, c, X, Y);
        const n = settle ? stampSettle(settle, X, Y) : stampNest(nest, X, Y, wAll[c] !== NONE);
        if (n?.s != null) {
          surface[i] = n.s;
          cover[i] = n.k;
          if (n.w != null) water[i] = n.w; // 沼澤的積水
        }
        if (n?.o >= 0) {
          object[i] = n.o + 1;
          objectPart[i] = PART_MID;
        } else if (!n) {
          const placed = placer.objectAt(z, c, X, Y); // 物件層（objects.js）
          if (placed) {
            object[i] = placed.object + 1;
            objectPart[i] = placed.part;
            objectAnchor[i] = placed.anchor;
          }
        }
        if (g.water[c] === WATER_NONE) {
          const grad = gradient(hAt(c));
          shade[i] = lightLevel(tier[i], shadeLevel(grad.dx, grad.dy), landform[i] === MOUNTAIN);
        } else shade[i] = waterLevel(h);
      }
    }

    placeBridges(object, g, G, E, size, x0, y0, bridgeIds); // 橋：河上每隔一段一座（bridges.js）

    // 物種成群（herds.js）：物件層生完才放，避開樹與礦坑；據點的那群怪物也在這裡放，動物的群離據點遠一點
    const herds = planHerds({
      ...z,
      zx,
      zy,
      object,
      swamp: SWAMP,
      start: geo?.start,
      target: herdTargets?.(zx, zy),
      nest,
      settle,
    });

    return {
      zx,
      zy,
      size,
      herds,
      nest,
      settle,
      height,
      landform,
      peak,
      surface,
      water,
      cover,
      object,
      objectPart,
      objectAnchor,
      shade,
      slope,
      tier,
      biome,
    };
  }

  function setGeography(x) {
    geo = x;
    setMoisture(x.moistureAt);
  }

  // 建世界時由 world.js 接上：每區的生物群數、哪幾區放聚落與起點那一區
  const setHerdTargets = (fn) => (herdTargets = fn);
  const setSettlePlan = (fn, start) => ([settlePlan, startZone] = [fn, start]);
  const env = { heightAt: land.heightAt, landform: land, climateAt, biomeAt, shape };
  return { genZone, setGeography, setHerdTargets, setSettlePlan, ...env };
}

export { NONE as LAYER_NONE };
