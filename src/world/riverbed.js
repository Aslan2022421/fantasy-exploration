// 河道怎麼畫進格子（geography.js 算好河段之後）：
// - paint：一塊矩形裡哪些格子是河、深河、淺灘，以及河面的高度。河段是粗格中心連到下游中心的直線，
//   畫的時候把每格的位置用低頻雜訊推開一點（RIVER.warp），河道才會彎，不是一段一段的直線
// - applyGeography：河跟著地勢走：河面比兩岸低一層，高山上的河就在高處流，到低地才接進湖海。
//   世界的地理算出來的河面高度比兩岸低很多時，最多往下挖 RIVER.carve 層，就是河谷

import { AROUND, segDist, segT } from './gridtools.js';
import { LAND, landTierOf, WATER_DEEP, WATER_NONE, WATER_SHALLOW } from './landform.js';
import { fbm, makeNoise } from './noise.js';

export const RIVER = {
  warp: 2.5, // 河道最多被推開幾格
  warpBase: 20, // 推開的雜訊波長（格）
  carve: 2, // 河面最多比兩岸最低處低幾個高度層
};

export const MASK_RIVER = 1;
export const MASK_DEEP = 2;
export const MASK_FORD = 3;

// segments：{ ax, ay, bx, by, r 半徑, deep, kind, la, lb（兩端的河面高度，淺灘沒有） }；C 是粗格邊長
export function makePainter(segments, W, C, seed) {
  const nx = makeNoise(seed, 'geo:warp-x');
  const ny = makeNoise(seed, 'geo:warp-y');
  const buckets = new Map();
  segments.forEach((s, id) => {
    const pad = s.r + 1 + RIVER.warp;
    const cx0 = Math.floor((Math.min(s.ax, s.bx) - pad) / C);
    const cx1 = Math.floor((Math.max(s.ax, s.bx) + pad) / C);
    const cy0 = Math.floor((Math.min(s.ay, s.by) - pad) / C);
    const cy1 = Math.floor((Math.max(s.ay, s.by) + pad) / C);
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const key = cy * (W + 2) + cx;
        if (!buckets.has(key)) buckets.set(key, new Set());
        buckets.get(key).add(id);
      }
    }
  });

  // 一塊矩形（左上 x0, y0，寬 w、高 h）：mask 每格是不是河、深河或淺灘；level 河面高度（不是河是 Infinity）
  return function paint(x0, y0, w, h) {
    const mask = new Uint8Array(w * h);
    const level = new Float32Array(w * h).fill(Number.POSITIVE_INFINITY);
    const ids = new Set();
    for (let cy = Math.floor(y0 / C) - 1; cy <= Math.floor((y0 + h) / C) + 1; cy++) {
      for (let cx = Math.floor(x0 / C) - 1; cx <= Math.floor((x0 + w) / C) + 1; cx++) {
        for (const id of buckets.get(cy * (W + 2) + cx) ?? []) ids.add(id);
      }
    }
    if (!ids.size) return { mask, level };
    // 每格推開後的位置
    const px = new Float32Array(w * h);
    const py = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const X = x0 + x;
        const Y = y0 + y;
        const k = y * w + x;
        px[k] = X + 0.5 + RIVER.warp * fbm(nx, X, Y, RIVER.warpBase, 2);
        py[k] = Y + 0.5 + RIVER.warp * fbm(ny, X, Y, RIVER.warpBase, 2);
      }
    }
    const order = [...ids].sort((a, b) => segments[a].kind - segments[b].kind); // 淺灘最後畫，蓋過深河
    for (const id of order) {
      const s = segments[id];
      const pad = s.r + 1 + RIVER.warp;
      const xa = Math.max(x0, Math.floor(Math.min(s.ax, s.bx) - pad));
      const xb = Math.min(x0 + w - 1, Math.ceil(Math.max(s.ax, s.bx) + pad));
      const ya = Math.max(y0, Math.floor(Math.min(s.ay, s.by) - pad));
      const yb = Math.min(y0 + h - 1, Math.ceil(Math.max(s.ay, s.by) + pad));
      for (let y = ya; y <= yb; y++) {
        for (let x = xa; x <= xb; x++) {
          const k = (y - y0) * w + (x - x0);
          const d = segDist(px[k], py[k], s.ax, s.ay, s.bx, s.by);
          if (d > s.r) continue;
          if (s.kind === MASK_FORD) {
            mask[k] = MASK_FORD;
            continue;
          }
          if (mask[k] !== MASK_FORD) mask[k] = Math.max(mask[k], s.deep && d <= s.r - 1 ? MASK_DEEP : MASK_RIVER);
          const t = segT(px[k], py[k], s.ax, s.ay, s.bx, s.by);
          level[k] = Math.min(level[k], s.la + (s.lb - s.la) * t);
        }
      }
    }
    return { mask, level };
  };
}

// 把河道與淺灘畫進一塊高度格（landform.js 的 grid 結果，左上 gx0, gy0、邊長 G）。macroAt 是大地形高度（算高度層用）。
// 河面的高度層＝世界地理算出的河面高度換成的層，但不高過兩岸最低處減一層、不低過兩岸最低處減 RIVER.carve 層；
// 落到第 0 層的就是低地的河，高度照湖海壓到水線以下。淺灘把深水改成淺水
export function applyGeography(g, gx0, gy0, G, geo, macroAt) {
  const { mask, level } = geo.paint(gx0, gy0, G, G);
  const before = g.tier.slice();
  for (let c = 0; c < mask.length; c++) {
    const m = mask[c];
    if (!m) continue;
    if (m === MASK_FORD) {
      if (g.water[c] === WATER_DEEP) g.water[c] = WATER_SHALLOW;
      continue;
    }
    const deep = m === MASK_DEEP;
    if (g.water[c] === WATER_NONE || deep) g.water[c] = deep ? WATER_DEEP : WATER_SHALLOW;
    const x = c % G;
    const y = (c - x) / G;
    let bank = before[c];
    for (const [dx, dy] of AROUND) {
      const X = x + dx;
      const Y = y + dy;
      if (X >= 0 && Y >= 0 && X < G && Y < G) bank = Math.min(bank, before[Y * G + X]);
    }
    const lv = level[c];
    const flowTier = lv < LAND.water ? 0 : landTierOf(macroAt(gx0 + x, gy0 + y), lv);
    const tier = Math.max(0, Math.min(bank - 1, Math.max(flowTier, bank - RIVER.carve)));
    g.tier[c] = tier;
    if (tier === 0) g.h[c] = Math.min(g.h[c], LAND.water - (deep ? LAND.deepDepth + 0.02 : 0.02));
  }
}
