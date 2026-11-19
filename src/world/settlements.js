// 聚落（村莊、城鎮，階段 7）：放在哪、圖樣、隱藏人口與標籤、範圍。見 design/PLAN.md「聚落」。
// - 哪幾區放什麼（settlementPlan）：建世界時照種子與區座標擲，陸地區 15% 村莊、4% 城鎮（城鎮彼此相隔 6 區以上），
//   起點那一區一定是村莊。一區最多放一樣：放了聚落就不放據點
// - 放置（createSettlePlanner）：同據點，中心落在那一區正中間的方塊裡、整塊在自己那一區裡；平坦（高低最多差一層）、
//   沒有水、冰、山；靠水的位置優先；出入口那一邊外面有湖就不開。起點那一區在整區裡找、照離區中心近排
// - 人口：隱藏，存在遊戲狀態的 settles；沒動過的照種子擲開局的人口。標籤照人口在範圍裡的位置分五段

import { LAND } from './landform.js';
import { gapToNest } from './nests.js';
import { hash01 } from './noise.js';
import { buildSettlement, GROUND, INDOOR, INDOOR_OBJECTS, KEEP, ROAD, WELL } from './settle-layouts.js';

export const SETTLE = {
  village: 0.15, // 陸地區放村莊的機率
  town: 0.04, // 陸地區放城鎮的機率
  townGap: 6, // 城鎮彼此至少相隔幾區
  core: 32, // 中心落在一區正中間這麼大的方塊裡
  step: 4, // 候選的中心每幾格取一個
  rangeSpan: 8, // 人口滿時範圍再多幾格
  waterNear: 12, // 圖樣外幾格內有水算「靠水」
  exitLook: 3, // 出入口外面看到範圍再多幾格，有湖就不朝這邊開
  avoid: 24, // 動物的群離圖樣外緣至少幾格
  sources: 32, // 經濟看圖樣外幾格內的資源點
  rival: 48, // 據點離聚落幾格內，對抗的對手換成聚落
  loss: 0.05, // 據點贏而且自然 12：聚落人口減上限的幾成
};

// 人口標籤：對抗時的修正
export const POP_TAGS = [
  { name: '大舉遷出', mod: -2 },
  { name: '縮減', mod: -1 },
  { name: '穩定', mod: 0 },
  { name: '成長', mod: 1 },
  { name: '急速發展', mod: 2 },
];
export const ECON_TAGS = ['荒蕪', '貧窮', '普通', '繁盛', '富裕'];

// 人口在範圍裡的位置（0～1，超出範圍夾住）
export const popShare = (pop, def) => Math.max(0, Math.min(1, (pop - def.pop[0]) / (def.pop[1] - def.pop[0])));
export const popTagIndex = (pop, def) => Math.min(4, Math.floor(popShare(pop, def) * 5));
export const rangeOfSettle = (pop, def) => def.rangeBase + Math.round(popShare(pop, def) * SETTLE.rangeSpan);

export function startPop(seed, s, def) {
  const [lo, hi] = def.pop;
  return Math.round(lo + (hi - lo) * hash01(seed, s.x0, s.y0, 9301));
}

// 建世界時決定每一區放什麼：回傳 (zx, zy) → 'village' | 'town' | null。
// isLand(zx, zy) 看那一區是不是陸地；startZone 是起點那一區（一定是村莊）
export function settlementPlan(seed, zonesX, zonesY, isLand, startZone) {
  const plan = new Map();
  const towns = [];
  const cands = [];
  for (let zy = 0; zy < zonesY; zy++)
    for (let zx = 0; zx < zonesX; zx++) {
      if (!isLand(zx, zy)) continue;
      const r = hash01(seed, zx, zy, 9300);
      if (r < SETTLE.town) cands.push({ zx, zy, r });
      else if (r < SETTLE.town + SETTLE.village) plan.set(zy * zonesX + zx, 'village');
    }
  // 城鎮：雜湊小的先放，跟已經放的城鎮太近就改放村莊
  cands.sort((a, b) => a.r - b.r);
  for (const c of cands) {
    const near = towns.some((t) => Math.max(Math.abs(t.zx - c.zx), Math.abs(t.zy - c.zy)) < SETTLE.townGap);
    if (near) plan.set(c.zy * zonesX + c.zx, 'village');
    else {
      towns.push(c);
      plan.set(c.zy * zonesX + c.zx, 'town');
    }
  }
  if (startZone) plan.set(startZone.zy * zonesX + startZone.zx, 'village');
  return (zx, zy) => plan.get(zy * zonesX + zx) ?? null;
}

// ids：地形編號 { NONE, SWAMP, ICE }
export function createSettlePlanner(seed, data, ids) {
  const { NONE, ICE } = ids;
  const kinds = new Map((data.settlements ?? []).map((d, k) => [d.id, { k, def: d }]));

  // z：一區生成時共用的格子（terrain.js 的 genZone）；kind：'village' | 'town'；start：這區是不是起點那一區
  return function planSettle(z, zx, zy, kind, start) {
    const entry = kinds.get(kind);
    if (!entry) return null;
    const { def, k } = entry;
    const g = (x, y) => (y + z.E) * z.G + (x + z.E);
    const inGrid = (x, y) => x >= -z.E + 1 && y >= -z.E + 1 && x < z.size + z.E - 1 && y < z.size + z.E - 1;
    const X0 = zx * z.size;
    const Y0 = zy * z.size;
    const W = def.w;
    const H = def.h;

    const fits = (x, y) => {
      if (x < 0 || y < 0 || x + W > z.size || y + H > z.size) return false;
      let lo = 99;
      let hi = -1;
      for (let j = 0; j < H; j++)
        for (let i = 0; i < W; i++) {
          const c = g(x + i, y + j);
          if (z.wAll[c] !== NONE || z.sAll[c] === ICE || z.h[c] > LAND.mountain) return false;
          lo = Math.min(lo, z.tier[c]);
          hi = Math.max(hi, z.tier[c]);
          if (hi - lo > 1) return false;
        }
      return true;
    };
    // 湖、河（不含沼澤）
    const lake = (x, y) => inGrid(x, y) && z.wAll[g(x, y)] !== NONE && z.wAll[g(x, y)] !== ids.SWAMP;
    // 靠水：圖樣外 3～waterNear 格內有湖或河
    const nearWater = (x, y) => {
      const R = SETTLE.waterNear;
      for (let j = y - R; j < y + H + R; j++)
        for (let i = x - R; i < x + W + R; i++) {
          if (i >= x - 2 && i < x + W + 2 && j >= y - 2 && j < y + H + 2) continue;
          if (lake(i, j)) return true;
        }
      return false;
    };
    // 出入口那一邊：從牆往外 3 格寬、看到最大範圍再多 exitLook 格，有湖就不開
    const canOpen = (x, y) => (side) => {
      const L = def.rangeBase + SETTLE.rangeSpan + SETTLE.exitLook;
      const cx = x + (W >> 1);
      const cy = y + (H >> 1);
      for (let d = 1; d <= L; d++)
        for (let w = -1; w <= 1; w++) {
          const [i, j] =
            side === 'west'
              ? [x - d, cy + w]
              : side === 'east'
                ? [x + W - 1 + d, cy + w]
                : side === 'north'
                  ? [cx + w, y - d]
                  : [cx + w, y + H - 1 + d];
          if (lake(i, j)) return false;
        }
      return true;
    };

    const spots = [];
    if (start) {
      for (let y = 0; y + H <= z.size; y += 2)
        for (let x = 0; x + W <= z.size; x += 2) {
          const d = Math.abs(x + W / 2 - z.size / 2) + Math.abs(y + H / 2 - z.size / 2);
          spots.push({ x, y, rank: d + hash01(seed, X0 + x, Y0 + y, 9302) });
        }
    } else {
      const half = z.size >> 1;
      const r = SETTLE.core >> 1;
      for (let y = half - r; y < half + r; y += SETTLE.step)
        for (let x = half - r; x < half + r; x += SETTLE.step)
          spots.push({ x: x - (W >> 1), y: y - (H >> 1), rank: hash01(seed, X0 + x, Y0 + y, 9302) });
    }
    spots.sort((a, b) => a.rank - b.rank);
    // 放得下的裡面，靠水的優先（看前 12 個放得下的就好，不然太慢）
    const ok = [];
    for (const s of spots) {
      if (ok.length >= 12) break;
      if (fits(s.x, s.y)) ok.push(s);
    }
    ok.sort((a, b) => (nearWater(b.x, b.y) ? 1 : 0) - (nearWater(a.x, a.y) ? 1 : 0));

    for (const s of ok) {
      const x0 = X0 + s.x;
      const y0 = Y0 + s.y;
      const base = { x0, y0 };
      const pop0 = startPop(seed, base, def);
      const layout = buildSettlement(def, seed, x0, y0, popTagIndex(pop0, def), canOpen(s.x, s.y));
      if (!layout) continue;
      const name = `${def.names[Math.floor(hash01(seed, x0, y0, 9303) * def.names.length)]}${def.suffix}`;
      return {
        id: `${zx},${zy}`,
        kind: k,
        zx,
        zy,
        x0,
        y0,
        w: W,
        h: H,
        name,
        layout,
        pop0,
        plaza: { x: x0 + layout.plaza.i, y: y0 + layout.plaza.j },
      };
    }
    return null;
  };
}

// 圖樣裡 (X, Y) 那格的代碼；不在圖樣裡回傳 null
export function settleCode(s, X, Y) {
  if (!s) return null;
  const i = X - s.x0;
  const j = Y - s.y0;
  if (i < 0 || j < 0 || i >= s.w || j >= s.h) return null;
  return s.layout.grid[j][i];
}

// 生成一區時把聚落蓋進那一格（terrain.js）：回傳 null（不在聚落裡或在牆外）或 { s 材質, k 覆蓋, o 物件編號（-1 沒有）}。
// ids：{ YARD 村莊的空地, SQUARE 城鎮的空地, ROAD, FLOOR 室內地板, NONE } 地形編號。
// 牆下是聚落的空地；門與家具在室內地板上；井在路上
export function createSettleStamp(data, ids) {
  const { YARD, SQUARE, ROAD: RD, FLOOR, NONE } = ids;
  return function stamp(s, X, Y) {
    const code = settleCode(s, X, Y);
    if (!code || code === KEEP) return null;
    const ground = data.settlements[s.kind].id === 'village' ? YARD : SQUARE;
    if (code === GROUND) return { s: ground, k: NONE, o: -1 };
    if (code === ROAD) return { s: RD, k: NONE, o: -1 };
    if (code === INDOOR) return { s: FLOOR, k: NONE, o: -1 };
    const under = INDOOR_OBJECTS.has(code) ? FLOOR : code === WELL ? RD : ground;
    return { s: under, k: NONE, o: data.objectIndex.get(code) };
  };
}

// 世界層的聚落查詢（world.js）：同據點，區被丟掉再生時不用為了問聚落重生整區
export function createSettleIndex(zone, zonesX, zonesY, zoneSize) {
  const cache = new Map();
  function settleOf(zx, zy) {
    if (zx < 0 || zy < 0 || zx >= zonesX || zy >= zonesY) return null;
    const key = zy * zonesX + zx;
    if (!cache.has(key)) cache.set(key, zone(zx, zy).settle ?? null);
    return cache.get(key);
  }
  // 離 (x, y) 不到 r 格（量到圖樣外緣）的聚落
  function settlesNear(x, y, r) {
    const out = [];
    for (let zy = Math.floor((y - r) / zoneSize); zy <= Math.floor((y + r) / zoneSize); zy++)
      for (let zx = Math.floor((x - r) / zoneSize); zx <= Math.floor((x + r) / zoneSize); zx++) {
        const s = settleOf(zx, zy);
        if (s && gapToNest(s, x, y) < r) out.push(s);
      }
    return out;
  }
  const settleById = (id) => {
    const [zx, zy] = id.split(',').map(Number);
    return settleOf(zx, zy);
  };
  return { settleOf, settlesNear, settleById, clearSettles: () => cache.clear() };
}

// 聚落範圍可能蓋到的區塊：圖樣加上最大範圍（畫面丟快取用；城鎮的基本 12＋rangeSpan）
export function settleArea(s) {
  const r = 12 + SETTLE.rangeSpan;
  return { x0: s.x0 - r, y0: s.y0 - r, x1: s.x0 + s.w - 1 + r, y1: s.y0 + s.h - 1 + r };
}

// 兩塊圖樣（矩形）之間差幾格（切比雪夫）
export function gapBetweenRects(a, b) {
  const dx = Math.max(a.x0 - (b.x0 + b.w - 1), 0, b.x0 - (a.x0 + a.w - 1));
  const dy = Math.max(a.y0 - (b.y0 + b.h - 1), 0, b.y0 - (a.y0 + a.h - 1));
  return Math.max(dx, dy);
}
