// 道路網（建世界時一次算好，跟河一樣在地理粗格上算，每一區照線段畫進去；見 design/PLAN.md「道路」）：
// - 節點是聚落（建世界時排好的區，取那一區的中心；起點村莊用它的廣場）
// - 大道：城鎮之間連成相對鄰近圖（a、b 之間沒有別的城鎮同時離兩邊都更近，就連），有環、不會連得太密
// - 小路：村莊照離最近的城鎮由近到遠，一座一座接到「已經在路網上、最近的那座聚落」，最遠 VILLAGE_REACH 區
// - 尋路：A*，平地便宜、坡越陡越貴、山地很貴、湖海走不過去；從岸上踏進河很貴（一條路少過幾次河，橋不會一座接一座），
//   沿著河走也加一點；已經有路的粗格打折，後來的路會沿用，匯成幹道
// - 拉直：沿著找到的路，能直接連過去、而且直線的成本不比原路貴多少，就拿掉中間的點（不會繞彎、不會多過一次河）
// - 已經有路的粗格是共用的：一條新路只畫沒有路的那幾段，兩端接到既有的路上（最近的那一點），不會兩條路並排走
// - 拉直後的折線用 Chaikin 磨圓兩次，存成線段（世界座標）
// 只看種子與地理，任何順序生出來的區都畫得一樣

import { GEO } from './geography.js';
import { AROUND, heap } from './gridtools.js';
import { LAND } from './landform.js';
import { cellsBetween, chaikin, indexByZone } from './road-geom.js';

export const ROADS = {
  slope: 60, // 高度差每 1 加多少成本（乘距離）
  mountain: 5, // 山地加多少
  peak: 20, // 高過山地門檻 0.15 再加多少
  river: 1.5, // 走進有河的粗格加多少
  bigRiver: 5, // 走進幹流（要架橋）加多少
  cross: 12, // 從沒有河的粗格踏進有河的粗格再加多少（過一次河）
  bigCross: 30, // 踏進幹流再加多少
  straight: 1.08, // 拉直：直線成本最多是原路的幾倍
  reuse: 0.5, // 已經有路的粗格，成本乘多少
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
    if (flow[j] >= GEO.deepFlow) c += ROADS.bigRiver + (flow[i] > 0 ? 0 : ROADS.bigCross);
    else if (flow[j] > 0) c += ROADS.river + (flow[i] > 0 ? 0 : ROADS.cross);
    return road[j] ? c * ROADS.reuse : c;
  };
  // 兩個粗格之間直線（八方向）的成本；碰到湖海回傳無限大
  const lineCost = (a, b) => {
    let x = a % W;
    let y = (a - x) / W;
    const bx = b % W;
    const by = (b - bx) / W;
    let sum = 0;
    let i = a;
    while (x !== bx || y !== by) {
      const dx = Math.sign(bx - x);
      const dy = Math.sign(by - y);
      // 往目標的方向走一步：斜走或沿著差得多的那一軸
      const ex = Math.abs(bx - x);
      const ey = Math.abs(by - y);
      const sx = ex >= ey / 2 ? dx : 0;
      const sy = ey >= ex / 2 ? dy : 0;
      x += sx;
      y += sy;
      const j = y * W + x;
      if (water(j)) return Number.POSITIVE_INFINITY;
      sum += cost(i, j, sx && sy);
      i = j;
    }
    return sum;
  };
  // 拉直：從頭開始，能直接連到越遠的點越好（最多看 48 格內），直線成本不比原路貴 ROADS.straight 倍
  function straighten(p) {
    const acc = [0];
    for (let k = 1; k < p.length; k++) {
      const dx = Math.abs((p[k] % W) - (p[k - 1] % W));
      const dy = Math.abs(Math.floor(p[k] / W) - Math.floor(p[k - 1] / W));
      acc.push(acc[k - 1] + cost(p[k - 1], p[k], dx && dy));
    }
    const out = [p[0]];
    for (let a = 0; a < p.length - 1; ) {
      let b = Math.min(p.length - 1, a + 48);
      for (; b > a + 1; b--) if (lineCost(p[a], p[b]) <= (acc[b] - acc[a]) * ROADS.straight + 0.5) break;
      out.push(p[b]);
      a = b;
    }
    return out;
  }
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

  const segments = [];
  const lines = []; // 每條路一條折線（總覽畫路用）
  let count = 0;
  // 線段照經過的粗格索引起來（接路時只看附近的）
  const near = new Map();
  const index = (s, k) => {
    const a = Math.floor(s.ay / C) * W + Math.floor(s.ax / C);
    const b = Math.floor(s.by / C) * W + Math.floor(s.bx / C);
    for (const i of [a, ...cellsBetween(a, b, W)]) {
      if (!near.has(i)) near.set(i, []);
      near.get(i).push(k);
    }
  };
  // 既有的路上離 (px, py) 最近的一點（世界座標；只看周圍 5×5 粗格裡的線段）
  const nearestOnRoads = (px, py) => {
    let best = null;
    const gx = Math.floor(px / C);
    const gy = Math.floor(py / C);
    const list = [];
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) list.push(...(near.get((gy + dy) * W + gx + dx) ?? []));
    for (const k of list) {
      const s = segments[k];
      if (Math.min(s.ax, s.bx) - C * 2 > px || Math.max(s.ax, s.bx) + C * 2 < px) continue;
      if (Math.min(s.ay, s.by) - C * 2 > py || Math.max(s.ay, s.by) + C * 2 < py) continue;
      const vx = s.bx - s.ax;
      const vy = s.by - s.ay;
      const t = Math.max(0, Math.min(1, ((px - s.ax) * vx + (py - s.ay) * vy) / (vx * vx + vy * vy || 1)));
      const q = [s.ax + vx * t, s.ay + vy * t];
      const d = Math.hypot(q[0] - px, q[1] - py);
      if (!best || d < best.d) best = { d, q };
    }
    return best?.q ?? [px, py];
  };
  const draw = (cells, kind, snapA, snapB) => {
    let pts = cells.map((i) => [(i % W) * C + C / 2, Math.floor(i / W) * C + C / 2]);
    if (snapA) pts[0] = nearestOnRoads(...pts[0]);
    if (snapB) pts[pts.length - 1] = nearestOnRoads(...pts[pts.length - 1]);
    for (let it = 0; it < 2; it++) pts = chaikin(pts);
    lines.push({ pts, kind });
    for (let k = 1; k < pts.length; k++) {
      const s = { ax: pts[k - 1][0], ay: pts[k - 1][1], bx: pts[k][0], by: pts[k][1], kind };
      index(s, segments.length);
      segments.push(s);
    }
  };
  // 一段沒有路的：拉直、記成有路（後來的路沿用）、畫出來
  const lay = (run, kind, snapA, snapB) => {
    const p = straighten(run);
    for (let k = 1; k < p.length; k++)
      for (const i of cellsBetween(p[k - 1], p[k], W)) road[i] = Math.max(road[i], kind);
    road[p[0]] = Math.max(road[p[0]], kind);
    draw(p, kind, snapA, snapB);
  };
  const link = (a, b, kind) => {
    const found = findPath(a.cell, b.cell);
    if (!found) return false;
    count++;
    const had = found.map((i) => road[i] > 0);
    let run = [];
    let snapA = false;
    for (let k = 0; k < found.length; k++) {
      if (!had[k]) {
        if (!run.length && k > 0) [run, snapA] = [[found[k - 1]], true];
        run.push(found[k]);
      } else if (run.length) {
        run.push(found[k]);
        lay(run, kind, snapA, true);
        [run, snapA] = [[], false];
      }
    }
    if (run.length >= 2) lay(run, kind, snapA, false);
    return true;
  };
  const zd = (a, b) => Math.hypot(a.zx - b.zx, a.zy - b.zy);

  // 大道：城鎮的相對鄰近圖
  const towns = nodes.filter((s) => s.kind === 'town' || s.kind === 'city'); // 城市也是大道的節點
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
    .filter((s) => !towns.includes(s) && !joined.includes(s))
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

  // 每座聚落的節點（路網在那一區的端點；聚落沒蓋在它上面時，road-paint.js 從這裡接到出入口）
  const ends = new Map(
    nodes.map((n) => [`${n.zx},${n.zy}`, [(n.cell % W) * C + C / 2, Math.floor(n.cell / W) * C + C / 2]]),
  );
  // cells：粗格上有沒有路（隘口判斷要塞時用，passes.js）
  return { segments, lines, ends, cells: road, byZone: indexByZone(segments, zoneSize, zonesX, zonesY), count };
}
