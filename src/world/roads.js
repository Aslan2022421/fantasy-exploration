// 道路網（建世界時一次算好，跟河一樣在地理粗格上算，每一區照線段畫進去；見 design/PLAN.md「道路」）：
// - 節點是聚落（建世界時排好的區，取那一區的中心；起點村莊用它的廣場）
// - 大道：城鎮之間連成相對鄰近圖（a、b 之間沒有別的城鎮同時離兩邊都更近，就連），有環、不會連得太密
// - 小路：村莊照離最近的城鎮由近到遠，一座一座接到「已經在路網上、最近的那座聚落」，最遠 VILLAGE_REACH 區
// - 尋路：A*，平地便宜、坡越陡越貴、山地很貴、湖海走不過去、跨河加一點；已經有路的粗格打折，後來的路會沿用，匯成幹道
// - 每條路的粗格中心連成折線，用 Chaikin 磨圓兩次，存成線段（世界座標）
// 只看種子與地理，任何順序生出來的區都畫得一樣

import { GEO } from './geography.js';
import { AROUND, heap } from './gridtools.js';
import { LAND } from './landform.js';

export const ROADS = {
  slope: 60, // 高度差每 1 加多少成本（乘距離）
  mountain: 5, // 山地加多少
  peak: 20, // 高過山地門檻 0.15 再加多少
  river: 1.5, // 走進有河的粗格加多少
  bigRiver: 5, // 走進幹流（要架橋）加多少
  reuse: 0.35, // 已經有路的粗格，成本乘多少
  villageReach: 6, // 村莊最遠接到幾區外的聚落
  maxNodes: 200000, // 一次尋路最多看幾格
  greed: 1.8, // 尋路估計值的倍數
};
export const MAIN = 2;
export const MINOR = 1;

// geo：地理；plan(zx, zy)：那一區排好的聚落；home：起點村莊（可能是 null）
export function buildRoads(geo, plan, zonesX, zonesY, zoneSize, home) {
  const { W, H, elev, flow } = geo;
  const C = GEO.cell;
  const Zc = zoneSize / C;
  const n = W * H;
  const water = (i) => elev[i] < LAND.water;
  const road = new Uint8Array(n);

  // 節點：每座聚落一個粗格（落在水裡就找最近的陸地）
  const nodes = [];
  for (let zy = 0; zy < zonesY; zy++)
    for (let zx = 0; zx < zonesX; zx++) {
      const kind = plan(zx, zy);
      if (!kind) continue;
      let gx = Math.floor((zx + 0.5) * Zc);
      let gy = Math.floor((zy + 0.5) * Zc);
      if (home && Math.floor(home.x0 / zoneSize) === zx && Math.floor(home.y0 / zoneSize) === zy) {
        gx = Math.floor(home.plaza.x / C);
        gy = Math.floor(home.plaza.y / C);
      }
      const cell = nearestLand(gx, gy, Math.floor(Zc / 2));
      if (cell >= 0) nodes.push({ zx, zy, kind, cell });
    }
  function nearestLand(gx, gy, r) {
    for (let d = 0; d <= r; d++)
      for (let dy = -d; dy <= d; dy++)
        for (let dx = -d; dx <= d; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== d) continue;
          const x = gx + dx;
          const y = gy + dy;
          if (x >= 0 && y >= 0 && x < W && y < H && !water(y * W + x)) return y * W + x;
        }
    return -1;
  }

  // A*：回傳經過的粗格（含兩端），走不到回傳 null
  const g = new Float32Array(n);
  const seen = new Int32Array(n);
  const prev = new Int32Array(n);
  let stamp = 0;
  const cost = (i, j, diag) => {
    let c = (diag ? Math.SQRT2 : 1) * (1 + ROADS.slope * Math.abs(elev[j] - elev[i]));
    if (elev[j] > LAND.mountain) c += ROADS.mountain + (elev[j] > LAND.mountain + 0.15 ? ROADS.peak : 0);
    if (flow[j] >= GEO.deepFlow) c += ROADS.bigRiver;
    else if (flow[j] > 0) c += ROADS.river;
    return road[j] ? c * ROADS.reuse : c;
  };
  function findPath(a, b) {
    stamp++;
    const bx = b % W;
    const by = (b - bx) / W;
    // 估計值乘 ROADS.greed（大於 1，不保證最短，但搜的格子少很多；路本來就不必是最短的）
    const h = (i) => Math.hypot((i % W) - bx, Math.floor(i / W) - by) * ROADS.greed;
    const open = heap();
    g[a] = 0;
    seen[a] = stamp;
    prev[a] = -1;
    open.push(h(a), a);
    let count = 0;
    while (open.size && count++ < ROADS.maxNodes) {
      const i = open.pop();
      if (i === b) {
        const out = [];
        for (let k = b; k >= 0; k = prev[k]) out.push(k);
        return out.reverse();
      }
      const x = i % W;
      const y = (i - x) / W;
      for (const [dx, dy] of AROUND) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (water(j)) continue;
        const ng = g[i] + cost(i, j, dx && dy);
        if (seen[j] === stamp && ng >= g[j]) continue;
        seen[j] = stamp;
        g[j] = ng;
        prev[j] = i;
        open.push(ng + h(j), j);
      }
    }
    return null;
  }

  const paths = [];
  const link = (a, b, kind) => {
    const p = findPath(a.cell, b.cell);
    if (!p) return false;
    for (const i of p) road[i] = Math.max(road[i], kind);
    paths.push({ cells: p, kind });
    return true;
  };
  const zd = (a, b) => Math.hypot(a.zx - b.zx, a.zy - b.zy);

  // 大道：城鎮的相對鄰近圖
  const towns = nodes.filter((s) => s.kind === 'town');
  for (let i = 0; i < towns.length; i++)
    for (let j = i + 1; j < towns.length; j++) {
      const d = zd(towns[i], towns[j]);
      const blocked = towns.some((c, k) => k !== i && k !== j && Math.max(zd(towns[i], c), zd(towns[j], c)) < d);
      if (!blocked) link(towns[i], towns[j], MAIN);
    }

  // 小路：村莊由離城鎮近到遠，接到已經在路網上、最近的聚落
  const joined = [...towns];
  if (!joined.length && nodes.length) joined.push(nodes[0]);
  const villages = nodes
    .filter((s) => s.kind !== 'town' && !joined.includes(s))
    .map((s) => ({ s, d: Math.min(...towns.map((t) => zd(s, t)), Number.POSITIVE_INFINITY) }))
    .sort((a, b) => a.d - b.d)
    .map((o) => o.s);
  for (const v of villages) {
    const near = joined
      .map((t) => ({ t, d: zd(v, t) }))
      .filter((o) => o.d <= ROADS.villageReach)
      .sort((a, b) => a.d - b.d);
    for (const { t } of near.slice(0, 2)) {
      if (link(v, t, MINOR)) {
        joined.push(v);
        break;
      }
    }
  }

  // 折線磨圓、切成線段（世界座標）
  const segments = [];
  const lines = []; // 每條路一條折線（總覽畫路用）
  for (const { cells, kind } of paths) {
    let pts = cells.map((i) => [(i % W) * C + C / 2, Math.floor(i / W) * C + C / 2]);
    for (let it = 0; it < 2; it++) pts = chaikin(pts);
    lines.push({ pts, kind });
    for (let k = 1; k < pts.length; k++)
      segments.push({ ax: pts[k - 1][0], ay: pts[k - 1][1], bx: pts[k][0], by: pts[k][1], kind });
  }
  return { segments, lines, byZone: indexByZone(segments, zoneSize, zonesX, zonesY), count: paths.length };
}

// Chaikin 磨圓：每段切掉兩端各四分之一，兩端點留著
function chaikin(pts) {
  if (pts.length < 3) return pts;
  const out = [pts[0]];
  for (let k = 0; k < pts.length - 1; k++) {
    const [ax, ay] = pts[k];
    const [bx, by] = pts[k + 1];
    out.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25], [ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

// 每一區會碰到哪些線段（外接框加寬 3 格）
function indexByZone(segments, zoneSize, zonesX, zonesY) {
  const map = new Map();
  segments.forEach((s, k) => {
    const pad = 3;
    const zx0 = Math.max(0, Math.floor((Math.min(s.ax, s.bx) - pad) / zoneSize));
    const zx1 = Math.min(zonesX - 1, Math.floor((Math.max(s.ax, s.bx) + pad) / zoneSize));
    const zy0 = Math.max(0, Math.floor((Math.min(s.ay, s.by) - pad) / zoneSize));
    const zy1 = Math.min(zonesY - 1, Math.floor((Math.max(s.ay, s.by) + pad) / zoneSize));
    for (let zy = zy0; zy <= zy1; zy++)
      for (let zx = zx0; zx <= zx1; zx++) {
        const key = `${zx},${zy}`;
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(k);
      }
  });
  return map;
}
