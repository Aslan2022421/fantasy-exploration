// 據點（怪物的窩，階段 6）：放在哪、中心圖樣、隱藏人口與標籤、範圍。見 design/PLAN.md「據點」。
// - 放置：每個陸地區有 NEST.chance 的機率放一處，中心落在這一區正中間 NEST.core×NEST.core 的方塊裡，
//   整個中心圖樣一定在這一區裡（生成一區時直接蓋進物件層，不用看隔壁區）；兩區的據點自然相隔 64 格以上。
//   種類看中心那格住得下哪種怪物（物種的棲地條件），整塊圖樣要放得下（沒有湖與河、沒有冰、不在山上、高低最多差一層；
//   陰暗的沼澤可以蓋在沼澤上）。離起點太近的不放。只看種子＋這一區的格子，不看生成順序
// - 人口：隱藏，存在遊戲狀態的 nests；還沒動過的照種子擲開局的人口。標籤照人口佔上限的比例分五段
// - 範圍：從中心圖樣的外緣往外量，半徑＝2＋人口比例×18（人口 0 就沒有範圍）

import { habitatWeight } from './herds.js';
import { LAND } from './landform.js';
import {
  buildLayout,
  CAVE,
  CHEST,
  chestIn,
  FLOOR,
  KEEP,
  REEDS as LAYOUT_REEDS,
  LAYOUT_SIZE,
  PATH,
  POOL,
} from './nest-layouts.js';
import { hash01 } from './noise.js';

export const NEST = {
  chance: 0.25, // 一個陸地區放據點的機率
  core: 32, // 中心落在一區正中間這麼大的方塊裡
  step: 4, // 候選的中心每幾格取一個
  startClear: 40, // 離起點至少幾格（量到圖樣的外緣）
  rangeBase: 2, // 有人口時範圍至少幾格
  rangeSpan: 18, // 人口滿時再多幾格（最大 20）
  popStart: [0.4, 0.7], // 開局的人口佔上限幾成
  avoid: 24, // 動物的群離圖樣外緣至少幾格
  respawn: 4800, // 清光後幾刻重生新的一群（遊戲裡 20 分鐘）
  rollEvery: 14400, // 看到時擲對抗，至少隔幾刻（1 小時）
  share: 0.1, // 對抗贏輸一次，人口增減上限的幾成（自然 12 加倍）
  worldMod: -1, // 世界系統的修正（附近沒有聚落時的對手）
  sight: 20, // 冒險者幾格內看得到中心才擲
};

// 標籤：人口佔上限的比例，每兩成一段；對抗時的修正
export const NEST_TAGS = [
  { name: '殘存', mod: -2 },
  { name: '衰退', mod: -1 },
  { name: '穩定', mod: 0 },
  { name: '壯大', mod: 1 },
  { name: '氾濫', mod: 2 },
];

export function tagOf(pop, max) {
  return NEST_TAGS[Math.min(4, Math.floor((pop / max) * 5))];
}

// 範圍半徑：從圖樣外緣往外幾格
export function rangeOf(pop, max) {
  if (pop <= 0) return 0;
  return Math.min(NEST.rangeBase + NEST.rangeSpan, NEST.rangeBase + Math.round((pop / max) * NEST.rangeSpan));
}

// (x, y) 到據點圖樣（矩形）的切比雪夫距離；在圖樣裡是 0
export function gapToNest(nest, x, y) {
  const dx = Math.max(nest.x0 - x, 0, x - (nest.x0 + nest.w - 1));
  const dy = Math.max(nest.y0 - y, 0, y - (nest.y0 + nest.h - 1));
  return Math.max(dx, dy);
}

// 據點範圍可能蓋到的區塊：圖樣加上最大範圍（畫面丟快取用）
export function nestArea(n) {
  const r = NEST.rangeBase + NEST.rangeSpan;
  return { x0: n.x0 - r, y0: n.y0 - r, x1: n.x0 + n.w - 1 + r, y1: n.y0 + n.h - 1 + r };
}

// 開局的人口（還沒有任何紀錄動過時）
export function startPop(seed, nest, def) {
  const [lo, hi] = NEST.popStart;
  return Math.round(def.popMax * (lo + (hi - lo) * hash01(seed, nest.x0, nest.y0, 9003)));
}

// ids：地形編號 { NONE, SWAMP, ICE }
export function createNestPlanner(seed, data, ids) {
  const { NONE, SWAMP, ICE } = ids;
  const kinds = (data.nests ?? []).map((n, k) => ({ k, def: n, sp: data.species[data.speciesIndex.get(n.species)] }));
  const biomeIds = data.biomes.map((b) => b.id);

  // z：一區生成時共用的格子（terrain.js 的 genZone）；start 是起點的世界座標
  return function planNest(z, zx, zy, start) {
    if (!kinds.length || hash01(seed, zx, zy, 9001) >= NEST.chance) return null;
    const g = (x, y) => (y + z.E) * z.G + (x + z.E); // 區內座標 → G×G 的編號
    const X0 = zx * z.size;
    const Y0 = zy * z.size;
    const dist = (x, y, test) => {
      for (let r = 1; r <= 3; r++)
        for (let dy = -r; dy <= r; dy++)
          for (let dx = -r; dx <= r; dx++)
            if (Math.max(Math.abs(dx), Math.abs(dy)) === r && test(z.wAll[g(x + dx, y + dy)])) return r;
      return 9;
    };
    // 中心格的環境，跟成群放置用同一種寫法（herds.js 的 habitatWeight）
    const envAt = (x, y) => {
      const c = g(x, y);
      return {
        biome: biomeIds[z.biome[c]],
        tier: z.tier[c],
        mountain: z.h[c] > LAND.mountain,
        water: dist(x, y, (w) => w !== NONE && w !== SWAMP),
        swamp: dist(x, y, (w) => w === SWAMP),
      };
    };
    // 整塊圖樣放得下：沒有湖與河（沼澤只有陰暗的沼澤可以）、沒有冰、不在山上、高低最多差一層
    const fits = (x, y, w, h, swampOk) => {
      if (x < 0 || y < 0 || x + w > z.size || y + h > z.size) return false;
      let lo = 99;
      let hi = -1;
      for (let j = 0; j < h; j++)
        for (let i = 0; i < w; i++) {
          const c = g(x + i, y + j);
          const water = z.wAll[c];
          if (water !== NONE && !(swampOk && water === SWAMP)) return false;
          if (z.sAll[c] === ICE || z.h[c] > LAND.mountain) return false;
          lo = Math.min(lo, z.tier[c]);
          hi = Math.max(hi, z.tier[c]);
          if (hi - lo > 1) return false;
        }
      return true;
    };

    const half = z.size >> 1;
    const r = NEST.core >> 1;
    const spots = [];
    for (let y = half - r; y < half + r; y += NEST.step)
      for (let x = half - r; x < half + r; x += NEST.step)
        spots.push({ x, y, rank: hash01(seed, X0 + x, Y0 + y, 9002) });
    spots.sort((a, b) => a.rank - b.rank);

    for (const s of spots) {
      const env = envAt(s.x, s.y);
      const ok = [];
      for (const kind of kinds) {
        const w = habitatWeight(kind.sp, env);
        if (w <= 0) continue;
        const { w: W, h: H } = LAYOUT_SIZE[kind.def.layout];
        const x = s.x - (W >> 1);
        const y = s.y - (H >> 1);
        if (!fits(x, y, W, H, kind.def.layout === 'swamp')) continue;
        if (start && gapToNest({ x0: X0 + x, y0: Y0 + y, w: W, h: H }, start.x, start.y) < NEST.startClear) continue;
        ok.push({ kind, x, y, W, H, w });
      }
      if (!ok.length) continue;
      let left = hash01(seed, X0 + s.x, Y0 + s.y, 9004) * ok.reduce((t, o) => t + o.w, 0);
      let pick = ok[ok.length - 1];
      for (const o of ok) {
        left -= o.w;
        if (left < 0) {
          pick = o;
          break;
        }
      }
      const x0 = X0 + pick.x;
      const y0 = Y0 + pick.y;
      const grid = buildLayout(pick.kind.def.layout, seed, x0, y0);
      // 整塊整平到圖樣裡最低的那一層（放得下的條件是高低最多差一層），牆與圍欄才不會在層界錯開
      let tier = 99;
      for (let j = 0; j < pick.H; j++)
        for (let i = 0; i < pick.W; i++) tier = Math.min(tier, z.tier[g(pick.x + i, pick.y + j)]);
      const chest = chestIn(grid);
      const nest = {
        id: `${zx},${zy}`,
        kind: pick.kind.k,
        zx,
        zy,
        x0,
        y0,
        w: pick.W,
        h: pick.H,
        grid,
        tier,
        chest: { x: x0 + chest.i, y: y0 + chest.j },
        env: { cold: z.tBand[g(s.x, s.y)] === 0, mountain: false, water: false },
        dry: z.wBand[g(s.x, s.y)] === 0,
        wet: z.wBand[g(s.x, s.y)] === 2,
      };
      nest.pop0 = startPop(seed, nest, pick.kind.def);
      return nest;
    }
    return null;
  };
}

// 圖樣裡 (X, Y) 那格的代碼；不在圖樣裡回傳 null
export function nestCode(nest, X, Y) {
  if (!nest) return null;
  const i = X - nest.x0;
  const j = Y - nest.y0;
  if (i < 0 || j < 0 || i >= nest.w || j >= nest.h) return null;
  return nest.grid[j][i] ?? KEEP;
}

// 生成一區時把據點蓋進那一格（terrain.js）。ids：{ FLAG 石板地, DIRT, ROAD, CAVE 洞窟地面, REEDS, SWAMP 沼澤水, NONE } 地形編號。
// 回傳 null（不是據點或保留原本的地形，照常放物件）；有水的格子回傳 {}（水留著、不放物件）；
// 不然 { s 材質, k 覆蓋, o 物件編號（-1 沒有）, w 水文（有積水才有）}：地面整平（堡壘是石板地、其餘泥土），
// 覆蓋拿掉或長蘆葦，物件照圖樣
export function createNestStamp(data, ids) {
  const { FLAG, DIRT, ROAD, CAVE: CAVE_FLOOR, REEDS, SWAMP, NONE } = ids;
  return function stamp(nest, X, Y, wet) {
    const code = nestCode(nest, X, Y);
    if (!code || code === KEEP) return null;
    // 原本有水（只會是沼澤的積水，湖河放不下據點）：空地照舊積水；岩丘、洞窟、樹這類東西把水排掉再蓋
    const plain = code === FLOOR || code === LAYOUT_REEDS || code === PATH || code === POOL;
    if (wet && plain) return {};
    const drain = wet ? { w: NONE } : {};
    const ground = data.nests[nest.kind].layout === 'fort' ? FLAG : DIRT;
    if (code === CAVE) return { s: CAVE_FLOOR, k: NONE, o: -1, ...drain };
    if (code === FLOOR) return { s: ground, k: NONE, o: -1 };
    if (code === LAYOUT_REEDS) return { s: DIRT, k: REEDS, o: -1 };
    if (code === PATH) return { s: ROAD, k: NONE, o: -1 };
    if (code === POOL) return { s: DIRT, k: NONE, o: -1, w: SWAMP };
    // 墓室與洞窟裡的寶箱、石門放在洞窟般的暗地面上
    const under = code === CHEST || code === 'stone-door' ? CAVE_FLOOR : ground;
    return { s: under, k: NONE, o: data.objectIndex.get(code), ...drain };
  };
}

// 世界層的據點查詢（world.js）：zone(zx, zy) 生一區；據點只看種子，另外記一份，區被丟掉再生時不用為了問據點重生整區
export function createNestIndex(zone, zonesX, zonesY, zoneSize) {
  const cache = new Map();
  function nestOf(zx, zy) {
    if (zx < 0 || zy < 0 || zx >= zonesX || zy >= zonesY) return null;
    const key = zy * zonesX + zx;
    if (!cache.has(key)) cache.set(key, zone(zx, zy).nest ?? null);
    return cache.get(key);
  }
  // 離 (x, y) 不到 r 格（量到圖樣外緣）的據點
  function nestsNear(x, y, r) {
    const out = [];
    for (let zy = Math.floor((y - r) / zoneSize); zy <= Math.floor((y + r) / zoneSize); zy++)
      for (let zx = Math.floor((x - r) / zoneSize); zx <= Math.floor((x + r) / zoneSize); zx++) {
        const n = nestOf(zx, zy);
        if (n && gapToNest(n, x, y) < r) out.push(n);
      }
    return out;
  }
  // 據點 id 是「區 x,區 y」
  const nestById = (id) => {
    const [zx, zy] = id.split(',').map(Number);
    return nestOf(zx, zy);
  };
  return { nestOf, nestsNear, nestById };
}
