// 大地形：高度分成「大地形」與「細節」兩部分；大地形底下再墊世界形狀（continent.js：海、大陸、山脈）。
// - 大地形：波長幾百格，決定盆地、台地這種一眼看得出的高低；高度層（tier）只看它，
//   一區裡通常只有兩三層，台階與側面只出現在大地形的邊緣
// - 細節：小起伏，只影響亮度、字元與山地，不切台階
// 水：全世界同一條水線（不隨濕度移動），湖海的水面固定在第 0 層，陸地從第 1 層起，湖岸會有一圈岸壁。
// 河流例外：河跟著地勢走，河面在兩岸低一層的高度（riverbed.js），高山上的河在高處流。
// 淺水只留在深水旁邊（RANGE 格內），零星的淺水窪改回陸地。
// 只看「種子＋座標」，任何一格都能單獨算出來（cellAt），一區用 grid 一次算一整片

import { fbm, makeNoise } from './noise.js';

export const LAND = {
  macroBase: 320, // 大地形最粗那層的波長（格）
  macroOctaves: 2,
  localAmp: 0.55, // 有世界形狀（continent.js）時，大地形縮成這麼大，山主要由板塊山脈來
  detailBase: 48, // 細節的波長
  detailOctaves: 3,
  detailAmp: 0.12, // 細節最多加減多少高度
  water: -0.34, // 水線：高度低於這個是水
  deepDepth: 0.07, // 水面下多深算深水
  shallowRange: 3, // 淺水要在深水幾格內，不然改回陸地
  tierStep: 0.22, // 大地形每高這麼多算一層
  landTiers: 4, // 陸地第 1～4 層
  mountain: 0.42, // 高度（含細節）高於這個是山地
  mountainStep: 0.04, // 山地從自己那層往上，用完整高度每這麼多再加一層
  mountainTiers: 14, // 山地最多再加幾層
};

export const MAX_TIER = LAND.landTiers + LAND.mountainTiers; // 18

// 這格的高度層：大地形的陸地層；山地再用完整高度往上一階一階加，山才會從高地上一圈一圈長出去
export function landTierOf(macro, h) {
  const base = Math.max(1, Math.min(LAND.landTiers, 1 + Math.floor((macro - LAND.water) / LAND.tierStep)));
  if (h <= LAND.mountain) return base;
  const extra = Math.min(LAND.mountainTiers, 1 + Math.floor((h - LAND.mountain) / LAND.mountainStep));
  return Math.min(MAX_TIER, base + extra);
}

export const WATER_NONE = 0;
export const WATER_SHALLOW = 1;
export const WATER_DEEP = 2;

// shapeAt(x, y)：世界形狀那一層的高度（continent.js）；沒給就只有局部起伏（測試用）
export function createLandform(seed, shapeAt = null) {
  const nMacro = makeNoise(seed, 'terrain:height');
  const nDetail = makeNoise(seed, 'terrain:detail');
  const local = (x, y) => fbm(nMacro, x, y, LAND.macroBase, LAND.macroOctaves);
  const macroAt = shapeAt ? (x, y) => shapeAt(x, y) + LAND.localAmp * local(x, y) : local;
  const heightAt = (x, y) => macroAt(x, y) + LAND.detailAmp * fbm(nDetail, x, y, LAND.detailBase, LAND.detailOctaves);
  const isDeep = (h) => h < LAND.water - LAND.deepDepth;

  // 一片矩形（左上 gx0, gy0，寬 w、高 hgt）裡每格的 { h 高度, water 水的種類, tier 高度層 }。
  // 為了判斷淺水旁有沒有深水，內部多算外圍 RANGE 格
  function grid(gx0, gy0, w, hgt) {
    const R = LAND.shallowRange;
    const W = w + 2 * R;
    const H = hgt + 2 * R;
    const hAll = new Float32Array(W * H);
    const deep = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const v = heightAt(gx0 + x - R, gy0 + y - R);
        hAll[y * W + x] = v;
        deep[y * W + x] = isDeep(v) ? 1 : 0;
      }
    }
    const h = new Float32Array(w * hgt);
    const water = new Uint8Array(w * hgt);
    const tier = new Uint8Array(w * hgt);
    for (let y = 0; y < hgt; y++) {
      for (let x = 0; x < w; x++) {
        const k = (y + R) * W + (x + R);
        const v = hAll[k];
        const i = y * w + x;
        h[i] = v;
        let kind = WATER_NONE;
        if (deep[k]) kind = WATER_DEEP;
        else if (v < LAND.water) {
          for (let dy = -R; dy <= R && kind === WATER_NONE; dy++)
            for (let dx = -R; dx <= R; dx++) if (deep[k + dy * W + dx]) kind = WATER_SHALLOW;
        }
        water[i] = kind;
        tier[i] = kind === WATER_NONE ? landTierOf(macroAt(gx0 + x, gy0 + y), v) : 0;
      }
    }
    return { h, water, tier };
  }

  // 單獨算一格（測試與除錯用；生一區時用 grid 比較快）
  function cellAt(x, y) {
    const g = grid(x, y, 1, 1);
    return { h: g.h[0], water: g.water[0], tier: g.tier[0] };
  }

  return { macroAt, heightAt, grid, cellAt };
}
