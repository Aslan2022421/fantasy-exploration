// 物種成群出現：每區有幾群草食、幾群掠食，各群的落腳處與成員位置。
// 只看「種子＋區座標」與這一區自己的格子，不看生成順序與玩家位置，讀檔重生結果一樣；生物的位置不進存檔。
// - 每區草食、掠食各幾群由 herdTargets 擲（建世界時記進每區的 numbers）；沒有草食的區不放掠食
// - 一群先挑落腳處：候選每 HERD.step 格取一個，照雜湊排名，要放得下、離別群與起點夠遠；
//   再看那格的環境（生態、高度層、在不在山地、離水多遠），照物種的棲地權重抽一種；所以同一區山上是山羊、水邊是鱷魚
// - 一群幾隻：物種自己的範圍；乾燥的地方取下半、潮濕的取上半；15% 只有落單的 1 隻；成員散在落腳處周圍 2～5 格
// - 每隻佔 1、2、4 格（2 格橫排、4 格是 2×2），錨點在左上；整隻要在這一區裡、同一個高度層、沒有水、沒有物件

import { RNG } from 'rot-js';
import { streamSeed } from '../core/rng.js';
import { LAND } from './landform.js';
import { hash01 } from './noise.js';

export const HERD = {
  herbivores: [2, 4], // 一區草食幾群
  predators: [0, 2], // 一區掠食幾群
  step: 4, // 候選的落腳處每幾格取一個
  gap: 16, // 兩群的落腳處至少隔幾格
  startClear: 14, // 離起點幾格內不放
  soloChance: 0.15, // 一群只有落單 1 隻的機率
  spread: [2, 5], // 成員散在落腳處周圍幾格
  tries: 16, // 每個成員最多試幾次
};

// 一隻佔的格子（相對錨點）：1 格、2 格橫排、4 格 2×2
export function speciesFootprint(cells) {
  return cells === 1
    ? [[0, 0]]
    : cells === 2
      ? [
          [0, 0],
          [1, 0],
        ]
      : [
          [0, 0],
          [1, 0],
          [0, 1],
          [1, 1],
        ];
}

// 錨點在 (x, y) 的那一隻佔哪幾格（世界座標）
export const creatureCells = (sp, { x, y }) => speciesFootprint(sp.cells).map(([dx, dy]) => ({ x: x + dx, y: y + dy }));

// 一區的目標群數（記進世界層每區的 numbers）：只看種子與區座標
export function herdTargets(seed, zx, zy) {
  const pick = ([lo, hi], salt) => lo + Math.floor(hash01(seed, zx, zy, salt) * (hi - lo + 1));
  return { herbivores: pick(HERD.herbivores, 4101), predators: pick(HERD.predators, 4102) };
}

// 這個環境下，這個物種的棲地權重（0 是不能住）。cell：{ biome 生態 id, tier, mountain, water 離水幾格（沒有水很大）}
export function habitatWeight(sp, cell) {
  let w = 0;
  for (const r of sp.habitat) {
    if (r.biomes && !r.biomes.includes(cell.biome)) continue;
    if (r.minTier != null && cell.tier < r.minTier) continue;
    if (r.maxTier != null && cell.tier > r.maxTier) continue;
    if (r.mountain != null && r.mountain !== cell.mountain) continue;
    if (r.nearWater != null && cell.water > r.nearWater) continue;
    w += r.weight;
  }
  return w;
}

// ids：{ NONE } 水文沒有東西時存的值
export function createHerdPlacer(seed, data, { NONE }) {
  const species = data.species ?? [];
  const biomeIds = data.biomes.map((b) => b.id);
  const feet = species.map((s) => speciesFootprint(s.cells));

  // ctx：一區生完之後的格子。G×G 的陣列（含外圍 E 圈）：biome 生態、h 高度、tier 高度層、wAll 水文、sAll 材質、tBand、wBand；
  // object 是這一區自己的物件層（size×size）；start 是起點的格子座標；target 是 { herbivores, predators }
  return function planHerds(ctx) {
    const { zx, zy, size, E, G, target } = ctx;
    if (!species.length || !target) return [];
    const x0 = zx * size;
    const y0 = zy * size;
    const g = (x, y) => (y + E) * G + (x + E); // 區內座標 → G×G 的編號

    // 離水幾格（最多看 3 格，沒有水回傳 9）；只算湖與河，不算沼澤
    const waterDist = (x, y) => {
      for (let r = 1; r <= 3; r++)
        for (let dy = -r; dy <= r; dy++)
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            const w = ctx.wAll[g(x + dx, y + dy)];
            if (w !== NONE && w !== ctx.swamp) return r;
          }
      return 9;
    };
    const envAt = (x, y) => {
      const c = g(x, y);
      return {
        biome: biomeIds[ctx.biome[c]],
        tier: ctx.tier[c],
        mountain: ctx.h[c] > LAND.mountain,
        water: waterDist(x, y),
        cold: ctx.tBand[c] === 0,
        dry: ctx.wBand[c] === 0,
        wet: ctx.wBand[c] === 2,
      };
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

    const slots = [
      ...Array.from({ length: target.herbivores }, () => 'herbivore'),
      ...Array.from({ length: target.predators }, () => 'predator'),
    ];
    for (let s = 0; s < slots.length; s++) {
      const diet = slots[s];
      if (diet === 'predator' && !herds.some((h) => species[h.species].diet === 'herbivore')) break; // 沒有草食就不放掠食
      const rng = RNG.clone().setSeed(streamSeed(seed, `herd:${zx},${zy}:${s}`));
      const ranked = spots
        .map(([x, y]) => ({ x, y, rank: hash01(seed, x0 + x, y0 + y, 4200 + s) }))
        .sort((a, b) => a.rank - b.rank);
      for (const spot of ranked) {
        const X = x0 + spot.x;
        const Y = y0 + spot.y;
        if (Math.max(Math.abs(X - sx), Math.abs(Y - sy)) < HERD.startClear) continue;
        if (herds.some((h) => Math.max(Math.abs(h.members[0].x - X), Math.abs(h.members[0].y - Y)) < HERD.gap))
          continue;
        const env = envAt(spot.x, spot.y);
        const weights = {};
        species.forEach((sp, k) => {
          const w = sp.diet === diet ? habitatWeight(sp, env) : 0;
          if (w > 0 && fits(k, spot.x, spot.y)) weights[k] = w;
        });
        if (!Object.keys(weights).length) continue;
        const k = Number(rng.getWeightedValue(weights));
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
        break;
      }
    }
    return herds;
  };
}
