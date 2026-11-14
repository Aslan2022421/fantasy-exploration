// 多層次地理模擬（使用者定）：在世界層的粗格子上先算整個世界的地理，生一區時再照著畫進那 96×96 格。
// 一區自己只看「種子＋座標」算不出河往哪流、哪裡被隔開，所以這些要先在整個世界上算好：
// 1. 高度圖：每個粗格取中心的高度（landform.js 的 heightAt）
// 2. 填窪與流向：從世界邊緣與湖海往內「淹水」（priority flood），每格記下水從哪一格流出去；
//    窪地被填平，水一定找得到出口，永遠往低處流
// 3. 河流：高處（GEO.source 以上）挑幾格當水源，沿流向一路流到湖海或世界邊緣；匯流越多河越寬，夠寬中間是深水
// 4. 濕度：離河、湖越近越濕；山的背風面（盛行風由西往東，山的東側）比較乾
// 5. 連通：從世界中央（出生點附近）出發，被深水隔開的陸地，從要跨最少深水的地方開一條淺灘接過來（海中的島不接）
// 畫進區域時（applyGeography）：河道是水（第 0 層），兩岸自然變成高度層的牆，看起來是挖下去的河谷
// ROT.js 沒有淹水、洪水填充與有成本的尋路，這幾個自己寫（都只在粗格上算，世界 96×96 區也只有約一百萬格）

import { AROUND, heap, linkRegions, segDist } from './gridtools.js';
import { LAND, WATER_DEEP, WATER_NONE, WATER_SHALLOW } from './landform.js';
import { hash01 } from './noise.js';

export const GEO = {
  cell: 8, // 粗格邊長（格）
  source: 0.6, // 高度在這以上的粗格可以當水源
  sourceChance: 0.15, // 每個高處粗格當水源的機率
  minRiver: 4, // 河至少流過幾個粗格才留下（太短的只是山上的小水窪）
  deepFlow: 6, // 匯流到這麼多條源頭，河中間是深水
  riverWidth: 0.8, // 源頭的河寬（半徑，格）；0.71 以下斜著流時兩格只靠角相連，看起來斷斷續續
  riverGrow: 0.6, // 匯流每翻一倍，半徑加多少
  wetRange: 10, // 離水幾個粗格以內會變濕
  wetBonus: 0.25, // 緊貼水邊最多加多少濕度（0.35 時潮濕的生態佔一半以上）
  shadowRange: 6, // 往上風（西邊）看幾個粗格找山
  shadowPerHeight: 0.8, // 西邊的山每高出 1，濕度少多少
  shadowMax: 0.35, // 背風面最多少多少濕度
  fordRadius: 1.2, // 淺灘寬（半徑，格）
  fordMax: 4, // 淺灘最多跨幾個粗格的深水；再寬的（海中的島）不接
  fordMinLand: 4, // 陸地至少幾個粗格才接
};

const MASK_RIVER = 1;
const MASK_DEEP = 2;
const MASK_FORD = 3;

// heightAt(x, y)：格子座標的高度；width、height：世界大小（格）
export function buildGeography(heightAt, seed, width, height) {
  const C = GEO.cell;
  const W = Math.ceil(width / C);
  const H = Math.ceil(height / C);
  const n = W * H;
  const center = (i) => ({ x: (i % W) * C + C / 2, y: Math.floor(i / W) * C + C / 2 });
  const elev = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const c = center(i);
    elev[i] = heightAt(c.x, c.y);
  }
  const isWater = (i) => elev[i] < LAND.water;
  const isDeep = (i) => elev[i] < LAND.water - LAND.deepDepth;
  // 鄰格寫進共用的 nb，回傳個數（熱迴圈裡不新建陣列）
  const nb = new Int32Array(8);
  const neighbors = (i) => {
    const x = i % W;
    const y = (i - x) / W;
    let m = 0;
    for (const [dx, dy] of AROUND) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < W && ny < H) nb[m++] = ny * W + nx;
    }
    return m;
  };

  // 2. 填窪與流向：從邊緣與水面往內淹，每格的「下游」是淹到它的那一格
  const down = new Int32Array(n).fill(-1);
  const filled = new Float32Array(n);
  const seen = new Uint8Array(n);
  const q = heap();
  for (let i = 0; i < n; i++) {
    const x = i % W;
    const y = Math.floor(i / W);
    if (isWater(i) || x === 0 || y === 0 || x === W - 1 || y === H - 1) {
      seen[i] = 1;
      filled[i] = elev[i];
      q.push(elev[i], i);
    }
  }
  while (q.size) {
    const i = q.pop();
    for (let t = 0, m = neighbors(i); t < m; t++) {
      const j = nb[t];
      if (seen[j]) continue;
      seen[j] = 1;
      filled[j] = Math.max(elev[j], filled[i]);
      down[j] = i;
      q.push(filled[j], j);
    }
  }

  // 3. 河流：從高處的水源沿下游走到水面或邊緣，路過的粗格累計流量
  const flow = new Uint16Array(n);
  for (let i = 0; i < n; i++) {
    if (isWater(i) || elev[i] < GEO.source) continue;
    if (hash01(seed, i % W, Math.floor(i / W), 901) >= GEO.sourceChance) continue;
    const path = [];
    for (let k = i; k >= 0 && !isWater(k); k = down[k]) path.push(k);
    if (path.length < GEO.minRiver) continue;
    for (const k of path) flow[k]++;
  }
  // 河段：每個有流量的粗格連到它的下游；半徑隨流量變大，夠大中間是深水
  const segments = [];
  for (let i = 0; i < n; i++) {
    if (!flow[i] || down[i] < 0) continue;
    const a = center(i);
    const b = center(down[i]);
    const r = GEO.riverWidth + GEO.riverGrow * Math.log2(flow[i]);
    segments.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y, r, deep: flow[i] >= GEO.deepFlow, kind: MASK_RIVER });
  }

  // 4. 濕度：離水（湖海與河）的粗格距離，加上背風面
  const dist = new Uint16Array(n).fill(0xffff);
  const bfs = [];
  for (let i = 0; i < n; i++) {
    if (isWater(i) || flow[i]) {
      dist[i] = 0;
      bfs.push(i);
    }
  }
  for (let h = 0; h < bfs.length; h++) {
    const i = bfs[h];
    for (let t = 0, m = neighbors(i); t < m; t++) {
      const j = nb[t];
      if (dist[j] !== 0xffff) continue;
      dist[j] = dist[i] + 1;
      bfs.push(j);
    }
  }
  const moist = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const wet = GEO.wetBonus * Math.max(0, 1 - dist[i] / GEO.wetRange);
    const x = i % W;
    let up = 0;
    for (let k = 1; k <= GEO.shadowRange && x - k >= 0; k++) up = Math.max(up, elev[i - k] - elev[i]);
    moist[i] = wet - Math.min(GEO.shadowMax, GEO.shadowPerHeight * up);
  }

  // 5. 連通：被深水（深湖、深河）隔開的陸地，從最近的地方開一條淺灘接過來
  const blocked = (i) => isDeep(i) || flow[i] >= GEO.deepFlow;
  let start = Math.floor(H / 2) * W + Math.floor(W / 2);
  if (blocked(start)) start = bfsNearest(start, (i) => !blocked(i)) ?? start;
  const fords = linkRegions(W, H, blocked, start, { maxCross: GEO.fordMax, minSize: GEO.fordMinLand }).map(([k, j]) => {
    const a = center(k);
    const b = center(j);
    return { ax: a.x, ay: a.y, bx: b.x, by: b.y, r: GEO.fordRadius, deep: false, kind: MASK_FORD };
  });
  segments.push(...fords);

  function bfsNearest(from, ok) {
    const seenB = new Uint8Array(n);
    const list = [from];
    seenB[from] = 1;
    for (let h = 0; h < list.length; h++) {
      if (ok(list[h])) return list[h];
      for (let t = 0, m = neighbors(list[h]); t < m; t++) {
        const j = nb[t];
        if (seenB[j]) continue;
        seenB[j] = 1;
        list.push(j);
      }
    }
    return null;
  }

  // 河段照所在的粗格分桶，畫一區時只看附近的
  const buckets = new Map();
  segments.forEach((s, id) => {
    const pad = s.r + 1;
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

  // 一塊矩形（左上 x0, y0，寬 w、高 h）裡每格是不是河、深河或淺灘
  function paint(x0, y0, w, h) {
    const mask = new Uint8Array(w * h);
    const ids = new Set();
    for (let cy = Math.floor(y0 / C) - 1; cy <= Math.floor((y0 + h) / C) + 1; cy++) {
      for (let cx = Math.floor(x0 / C) - 1; cx <= Math.floor((x0 + w) / C) + 1; cx++) {
        for (const id of buckets.get(cy * (W + 2) + cx) ?? []) ids.add(id);
      }
    }
    const order = [...ids].sort((a, b) => segments[a].kind - segments[b].kind); // 淺灘最後畫，蓋過深河
    for (const id of order) {
      const s = segments[id];
      const pad = s.r + 1;
      const xa = Math.max(x0, Math.floor(Math.min(s.ax, s.bx) - pad));
      const xb = Math.min(x0 + w - 1, Math.ceil(Math.max(s.ax, s.bx) + pad));
      const ya = Math.max(y0, Math.floor(Math.min(s.ay, s.by) - pad));
      const yb = Math.min(y0 + h - 1, Math.ceil(Math.max(s.ay, s.by) + pad));
      for (let y = ya; y <= yb; y++) {
        for (let x = xa; x <= xb; x++) {
          const d = segDist(x + 0.5, y + 0.5, s.ax, s.ay, s.bx, s.by);
          if (d > s.r) continue;
          const k = (y - y0) * w + (x - x0);
          if (s.kind === MASK_FORD) mask[k] = MASK_FORD;
          else if (mask[k] !== MASK_FORD) mask[k] = Math.max(mask[k], s.deep && d <= s.r - 1 ? MASK_DEEP : MASK_RIVER);
        }
      }
    }
    return mask;
  }

  // 濕度修正：粗格中心之間雙線性內插
  function moistureAt(x, y) {
    const fx = Math.max(0, Math.min(W - 1.001, x / C - 0.5));
    const fy = Math.max(0, Math.min(H - 1.001, y / C - 0.5));
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const tx = fx - ix;
    const ty = fy - iy;
    const at = (a, b) => moist[Math.min(H - 1, b) * W + Math.min(W - 1, a)];
    const top = at(ix, iy) * (1 - tx) + at(ix + 1, iy) * tx;
    const bottom = at(ix, iy + 1) * (1 - tx) + at(ix + 1, iy + 1) * tx;
    return top * (1 - ty) + bottom * ty;
  }

  return {
    W,
    H,
    elev,
    filled,
    down,
    flow,
    segments,
    rivers: segments.length - fords.length,
    fords: fords.length,
    paint,
    moistureAt,
  };
}

// 把河道與淺灘畫進一塊高度格（landform.js 的 grid 結果，左上 gx0, gy0、邊長 G）：
// 河道是水、第 0 層、高度壓到水線以下；淺灘把深水改成淺水
export function applyGeography(g, gx0, gy0, G, geo) {
  const mask = geo.paint(gx0, gy0, G, G);
  for (let c = 0; c < mask.length; c++) {
    const m = mask[c];
    if (!m) continue;
    if (m === MASK_FORD) {
      if (g.water[c] === WATER_DEEP) g.water[c] = WATER_SHALLOW;
      continue;
    }
    const deep = m === MASK_DEEP;
    if (g.water[c] === WATER_NONE || deep) g.water[c] = deep ? WATER_DEEP : WATER_SHALLOW;
    g.tier[c] = 0;
    g.h[c] = Math.min(g.h[c], LAND.water - (deep ? LAND.deepDepth + 0.02 : 0.02));
  }
}
