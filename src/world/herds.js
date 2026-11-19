// 物種成群出現：每區有幾群草食、掠食、混食，各群的落腳處與成員位置。
// 只看「種子＋區座標」與這一區自己的格子，不看生成順序與玩家位置，讀檔重生結果一樣；生物的位置不進存檔。
// - 每區草食、掠食各幾群由 herdTargets 擲（建世界時記進每區的 numbers）；沒有草食的區不放掠食
// - 一群：候選落腳處每 HERD.step 格取一個，照雜湊排名，離別群與起點要夠遠；每個物種各自找排名最前面、
//   棲地符合（生態、高度層、在不在山地、離水多遠）又放得下的一處，再照權重抽一種，這一區已經有的物種打折；
//   所以同一區山上是山羊、水邊是鱷魚
// - 一群幾隻：物種自己的範圍；乾燥的地方取下半、潮濕的取上半；15% 只有落單的 1 隻；成員散在落腳處周圍 2～5 格
// - 每隻佔 1×1、2×1、2×2、3×2 格（寬×高），錨點在左上；整隻要在這一區裡、同一個高度層、沒有水、沒有物件

import { RNG } from 'rot-js';
import { streamSeed } from '../core/rng.js';
import { LAND } from './landform.js';
import { gapToNest, NEST } from './nests.js';
import { hash01 } from './noise.js';

export const HERD = {
  herbivores: [2, 4], // 一區草食幾群
  predators: [0, 2], // 一區掠食幾群（混食的怪物只從據點出來，nests.js）
  step: 4, // 候選的落腳處每幾格取一個
  gap: 16, // 兩群的落腳處至少隔幾格
  startClear: 14, // 離起點幾格內不放
  soloChance: 0.15, // 一群只有落單 1 隻的機率
  spread: [2, 5], // 成員散在落腳處周圍幾格
  tries: 16, // 每個成員最多試幾次
  repeat: 0.3, // 這一區已經有的物種，再抽到的權重乘幾倍
};

// 佔地 '寬x高' → { w, h }
export function footprintSize(footprint) {
  const [w, h] = footprint.split('x').map(Number);
  return { w, h };
}

// 一隻佔的格子（相對錨點，左上起往右、往下）
export function speciesFootprint(footprint) {
  const { w, h } = footprintSize(footprint);
  const out = [];
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) out.push([i, j]);
  return out;
}

// 錨點在 (x, y) 的那一隻佔哪幾格（世界座標）
export const creatureCells = (sp, { x, y }) =>
  speciesFootprint(sp.footprint).map(([dx, dy]) => ({ x: x + dx, y: y + dy }));

// 一區的目標群數（記進世界層每區的 numbers）：只看種子與區座標
export function herdTargets(seed, zx, zy) {
  const pick = ([lo, hi], salt) => lo + Math.floor(hash01(seed, zx, zy, salt) * (hi - lo + 1));
  return { herbivores: pick(HERD.herbivores, 4101), predators: pick(HERD.predators, 4102) };
}

// 這個環境下，這個物種的棲地權重（0 是不能住）。
// cell：{ biome 生態 id, tier, mountain, water 離水幾格, swamp 離沼澤幾格（都是沒有時很大）}
export function habitatWeight(sp, cell) {
  let w = 0;
  for (const r of sp.habitat) {
    if (r.biomes && !r.biomes.includes(cell.biome)) continue;
    if (r.minTier != null && cell.tier < r.minTier) continue;
    if (r.maxTier != null && cell.tier > r.maxTier) continue;
    if (r.mountain != null && r.mountain !== cell.mountain) continue;
    if (r.nearWater != null && cell.water > r.nearWater) continue;
    if (r.swamp != null && (cell.swamp ?? 9) > r.swamp) continue;
    w += r.weight;
  }
  return w;
}

// ids：{ NONE } 水文沒有東西時存的值
export function createHerdPlacer(seed, data, { NONE }) {
  const species = data.species ?? [];
  const biomeIds = data.biomes.map((b) => b.id);
  const feet = species.map((s) => speciesFootprint(s.footprint));

  // ctx：一區生完之後的格子。G×G 的陣列（含外圍 E 圈）：biome 生態、h 高度、tier 高度層、wAll 水文、sAll 材質、tBand、wBand；
  // object 是這一區自己的物件層（size×size）；start 是起點的格子座標；target 是 { herbivores, predators }
  return function planHerds(ctx) {
    const { zx, zy, size, E, G, target } = ctx;
    if (!species.length || !target) return [];
    const x0 = zx * size;
    const y0 = zy * size;
    const g = (x, y) => (y + E) * G + (x + E); // 區內座標 → G×G 的編號

    // 離水幾格（最多看 3 格，沒有回傳 9）：湖與河一種、沼澤另一種
    const isLake = (w) => w !== NONE && w !== ctx.swamp;
    const isSwamp = (w) => w === ctx.swamp;
    const distTo = (x, y, test) => {
      for (let r = 1; r <= 3; r++)
        for (let dy = -r; dy <= r; dy++)
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            if (test(ctx.wAll[g(x + dx, y + dy)])) return r;
          }
      return 9;
    };
    const envAt = (x, y) => {
      const c = g(x, y);
      return {
        biome: biomeIds[ctx.biome[c]],
        tier: ctx.tier[c],
        mountain: ctx.h[c] > LAND.mountain,
        water: distTo(x, y, isLake),
        swamp: distTo(x, y, isSwamp),
        cold: ctx.tBand[c] === 0,
        dry: ctx.wBand[c] === 0,
        wet: ctx.wBand[c] === 2,
      };
    };

    const envCache = new Map(); // 落腳處 → 環境（離水幾格要掃周圍，每個候選只算一次）
    const envOf = (spot) => {
      const key = spot.y * size + spot.x;
      if (!envCache.has(key)) envCache.set(key, envAt(spot.x, spot.y));
      return envCache.get(key);
    };

    const taken = new Set(); // 已經有東西的格子（區內編號 y×size＋x）
    const fits = (k, x, y) => {
      const tier0 = ctx.tier[g(x, y)];
      for (const [dx, dy] of feet[k]) {
        const px = x + dx;
        const py = y + dy;
        if (px < 0 || py < 0 || px >= size || py >= size) return false;
        const c = g(px, py);
        if (ctx.wAll[c] !== NONE || !data.surfaces[ctx.sAll[c]].passable || ctx.tier[c] !== tier0) return false;
        if (ctx.object[py * size + px] || taken.has(py * size + px)) return false;
      }
      return true;
    };
    const occupy = (k, x, y) => {
      for (const [dx, dy] of feet[k]) taken.add((y + dy) * size + x + dx);
    };

    // 候選的落腳處
    const spots = [];
    for (let y = 0; y < size - 1; y += HERD.step) for (let x = 0; x < size - 1; x += HERD.step) spots.push([x, y]);
    const sx = ctx.start?.x ?? -1e9;
    const sy = ctx.start?.y ?? -1e9;
    const herds = [];

    // 怪物（混食）只從據點出來（nests.js）；動物的群離據點的圖樣外緣至少 NEST.avoid 格
    // 聚落（村莊、城鎮）也一樣避開
    const nest = ctx.nest;
    const nearNest = (X, Y) =>
      (nest && gapToNest(nest, X, Y) < NEST.avoid) || (ctx.settle && gapToNest(ctx.settle, X, Y) < NEST.avoid);
    const slots = [
      ...Array.from({ length: target.herbivores }, () => 'herbivore'),
      ...Array.from({ length: target.predators }, () => 'predator'),
    ];
    for (let s = 0; s < slots.length; s++) {
      const diet = slots[s];
      if (diet === 'predator' && !herds.some((h) => species[h.species].diet === 'herbivore')) continue; // 沒有草食就不放掠食
      const rng = RNG.clone().setSeed(streamSeed(seed, `herd:${zx},${zy}:${s}`));
      const ranked = spots
        .map(([x, y]) => ({ x, y, rank: hash01(seed, x0 + x, y0 + y, 4200 + s) }))
        .sort((a, b) => a.rank - b.rank);
      // 離起點夠遠、離別群夠遠的候選，照這個槽的雜湊排名
      const pool = ranked.filter((spot) => {
        const X = x0 + spot.x;
        const Y = y0 + spot.y;
        if (Math.max(Math.abs(X - sx), Math.abs(Y - sy)) < HERD.startClear) return false;
        if (nearNest(X, Y)) return false;
        return !herds.some((h) => Math.max(Math.abs(h.members[0].x - X), Math.abs(h.members[0].y - Y)) < HERD.gap);
      });
      // 每個物種各自找排名最前面、棲地符合又放得下的落腳處；這一區住得下的物種照權重抽一種
      // （水邊的鱷魚、山上的山羊不會因為落腳處少就永遠抽不到）
      const best = {};
      species.forEach((sp, k) => {
        if (sp.diet !== diet) return;
        for (const spot of pool) {
          const env = envOf(spot);
          const w = habitatWeight(sp, env);
          if (w > 0 && fits(k, spot.x, spot.y)) {
            best[k] = { spot, env, w };
            return;
          }
        }
      });
      {
        // 這一區已經有的物種權重打折，同一區才會有幾種不同的生物
        const weights = Object.fromEntries(
          Object.entries(best).map(([k, b]) => [
            k,
            b.w * (herds.some((h) => h.species === Number(k)) ? HERD.repeat : 1),
          ]),
        );
        if (!Object.keys(weights).length) continue;
        const k = Number(rng.getWeightedValue(weights));
        const { spot, env } = best[k];
        const X = x0 + spot.x;
        const Y = y0 + spot.y;
        const sp = species[k];
        const [lo, hi] = sp.count;
        const mid = Math.ceil((lo + hi) / 2);
        const range = env.dry ? [lo, mid] : env.wet ? [mid, hi] : [lo, hi];
        const want = rng.getUniform() < HERD.soloChance ? 1 : rng.getUniformInt(range[0], range[1]);
        const members = [{ x: X, y: Y }];
        occupy(k, spot.x, spot.y);
        for (let m = 1; m < want; m++) {
          for (let t = 0; t < HERD.tries; t++) {
            const r = rng.getUniformInt(HERD.spread[0], HERD.spread[1]);
            const dx = rng.getUniformInt(-r, r);
            const dy = Math.abs(dx) === r ? rng.getUniformInt(-r, r) : rng.getUniform() < 0.5 ? -r : r;
            const px = spot.x + dx;
            const py = spot.y + dy;
            if (px < 0 || py < 0 || px >= size || py >= size || !fits(k, px, py)) continue;
            if (nearNest(x0 + px, y0 + py)) continue;
            occupy(k, px, py);
            members.push({ x: x0 + px, y: y0 + py });
            break;
          }
        }
        herds.push({
          id: `${zx},${zy}:${s}`,
          species: k,
          members,
          // 當地的環境，數值塊照它加答案（data/blocks.js 的 envExtras）
          env: { cold: env.cold, mountain: env.mountain, water: env.wet && env.water <= 3 },
        });
      }
    }
    if (nest) {
      const herd = nestHerd(nest);
      if (herd) herds.push(herd);
    }
    return herds;

    // 據點外面那一群：散在圖樣外緣外 2～5 格，隻數照物種的範圍（乾燥取下半、潮濕取上半）。
    // 實際出來幾隻還要看隱藏人口（creatures.js 照狀態裡的 size 截）
    function nestHerd(n) {
      const def = data.nests[n.kind];
      const k = data.speciesIndex.get(def.species);
      const sp = species[k];
      const rng = RNG.clone().setSeed(streamSeed(seed, `nest:${n.id}`));
      const [lo, hi] = sp.count;
      const mid = Math.ceil((lo + hi) / 2);
      const range = n.dry ? [lo, mid] : n.wet ? [mid, hi] : [lo, hi];
      const want = rng.getUniformInt(range[0], range[1]);
      const ring = [];
      for (let y = n.y0 - 5; y < n.y0 + n.h + 5; y++)
        for (let x = n.x0 - 5; x < n.x0 + n.w + 5; x++) {
          const d = gapToNest(n, x, y);
          if (d >= 2) ring.push({ x, y, rank: hash01(seed, x, y, 4300) });
        }
      ring.sort((a, b) => a.rank - b.rank);
      const members = [];
      for (const p of ring) {
        if (members.length >= want) break;
        const px = p.x - x0;
        const py = p.y - y0;
        if (px < 0 || py < 0 || px >= size || py >= size || !fits(k, px, py)) continue;
        occupy(k, px, py);
        members.push({ x: p.x, y: p.y });
      }
      if (!members.length) return null;
      return { id: `${n.id}:n`, species: k, members, nest: n.id, env: n.env };
    }
  };
}
