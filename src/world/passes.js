// 隘口與守隘口的堡壘、要塞（交辦 4，使用者照 Claude 的推薦定）：建世界時路網算好之後找一次
// - 隘口：路線上每 PASS.step 格看一次，路兩側（垂直方向）PASS.side 個粗格內都碰到山（高過山地門檻），而這一點本身不是山；
//   連續的併成一處，取中間那一點與路在那裡的方向
// - 每處隘口都放（大道上的先放、夾得越長的先放）；兩座至少隔 PASS.spacing 區，排了聚落的區不放；
//   沿著隘口從中間往兩頭找整塊放得進一區、城門外還留 PASS.gate 格的那一點，找不到就不放
// - 要塞：在粗格的路網上把這處隘口拿掉，路網斷成兩塊、兩塊都有聚落（只靠這條路相通）；其餘是堡壘
// 只看種子與地理，任何順序生出來都一樣

import { GEO } from './geography.js';
import { LAND } from './landform.js';

export const PASS = { side: 3, step: 8, spacing: 4, gate: 4 };

// geo：地理；roads：路網（roads.js，含粗格的路 cells 與節點 ends）；plan(zx, zy)：排好的聚落
// 回傳 Map（"zx,zy" → { zx, zy, x, y（隘口那一點，世界座標）, turn（路是東西向：圖樣轉 90 度）, kind: 'fort' | 'fortress' }）
export function findForts(geo, roads, plan, zoneSize) {
  const C = GEO.cell;
  const { W, H, elev } = geo;
  const high = (x, y) => {
    const i = Math.floor(x / C);
    const j = Math.floor(y / C);
    return i < 0 || j < 0 || i >= W || j >= H || elev[j * W + i] > LAND.mountain;
  };
  const found = [];
  for (const { pts, kind } of roads.lines) {
    let run = null;
    const close = () => {
      if (run) found.push({ ...run.list[run.list.length >> 1], kind, n: run.list.length, list: run.list });
      run = null;
    };
    for (let k = 1; k < pts.length; k++) {
      const [ax, ay] = pts[k - 1];
      const [bx, by] = pts[k];
      const len = Math.hypot(bx - ax, by - ay) || 1;
      const nx = -(by - ay) / len;
      const ny = (bx - ax) / len;
      for (let t = 0; t < len; t += PASS.step) {
        const x = ax + ((bx - ax) * t) / len;
        const y = ay + ((by - ay) * t) / len;
        let sides = 0;
        for (const s of [1, -1])
          for (let d = 1; d <= PASS.side; d++)
            if (high(x + s * nx * d * C, y + s * ny * d * C)) {
              sides++;
              break;
            }
        if (sides === 2 && !high(x, y)) {
          run ??= { list: [] };
          run.list.push({ x, y, dx: bx - ax, dy: by - ay });
        } else close();
      }
    }
    close();
  }
  found.sort((a, b) => b.kind - a.kind || b.n - a.n || a.y - b.y || a.x - b.x);
  const chosen = [];
  for (const p of found) {
    const kind = splits(roads, geo, p) ? 'fortress' : 'fort';
    const turn = Math.abs(p.dx) > Math.abs(p.dy);
    // 圖樣在世界上的寬高（轉 90 度時對調）；沿著這處隘口從中間往兩頭找，整塊放得進一區、城門外還留 PASS.gate 格的那一點
    const [w0, h0] = SIZE[kind];
    const [w, h] = turn ? [h0, w0] : [w0, h0];
    const mid = p.list.length >> 1;
    const order = p.list.map((q, k) => ({ q, d: Math.abs(k - mid) })).sort((a, b) => a.d - b.d);
    for (const { q } of order) {
      const zx = Math.floor(q.x / zoneSize);
      const zy = Math.floor(q.y / zoneSize);
      if (plan(zx, zy)) continue;
      if (chosen.some((o) => Math.max(Math.abs(o.zx - zx), Math.abs(o.zy - zy)) < PASS.spacing)) continue;
      const x0 = Math.round(q.x) - zx * zoneSize - (w >> 1);
      const y0 = Math.round(q.y) - zy * zoneSize - (h >> 1);
      const [mx, my] = turn ? [PASS.gate, 0] : [0, PASS.gate];
      if (x0 < mx || y0 < my || x0 + w > zoneSize - mx || y0 + h > zoneSize - my) continue;
      chosen.push({ zx, zy, x: Math.round(q.x), y: Math.round(q.y), turn, kind });
      break;
    }
  }
  return new Map(chosen.map((c) => [`${c.zx},${c.zy}`, c]));
}
const SIZE = { fort: [45, 29], fortress: [45, 58] }; // 圖樣沒轉時的寬高（fort-layouts.js）

// 把隘口那一點（周圍一圈粗格）從路網拿掉，兩頭的路還連不連得到；連不到、兩邊各有聚落就是只靠這條路相通
function splits(roads, geo, p) {
  const C = GEO.cell;
  const { W, H } = geo;
  const cells = roads.cells;
  const gx = Math.floor(p.x / C);
  const gy = Math.floor(p.y / C);
  const blocked = (i) => Math.max(Math.abs((i % W) - gx), Math.abs(Math.floor(i / W) - gy)) <= 1;
  const len = Math.hypot(p.dx, p.dy) || 1;
  // 隘口兩頭：沿著路往前、往後 3 個粗格附近的路
  const sideCell = (s) => {
    const cx = Math.floor((p.x + (s * 3 * C * p.dx) / len) / C);
    const cy = Math.floor((p.y + (s * 3 * C * p.dy) / len) / C);
    for (let r = 0; r <= 2; r++)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          const i = (cy + dy) * W + cx + dx;
          if (cx + dx >= 0 && cy + dy >= 0 && cx + dx < W && cy + dy < H && cells[i] && !blocked(i)) return i;
        }
    return -1;
  };
  const a = sideCell(1);
  const b = sideCell(-1);
  if (a < 0 || b < 0) return false;
  const nodes = new Set([...roads.ends.values()].map(([x, y]) => Math.floor(y / C) * W + Math.floor(x / C)));
  const flood = (start) => {
    const seen = new Set([start]);
    const q = [start];
    let node = nodes.has(start);
    for (let h = 0; h < q.length; h++) {
      const x = q[h] % W;
      const y = (q[h] - x) / W;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          const j = ny * W + nx;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H || seen.has(j) || !cells[j] || blocked(j)) continue;
          seen.add(j);
          q.push(j);
          if (nodes.has(j)) node = true;
        }
    }
    return { seen, node };
  };
  const fa = flood(a);
  if (fa.seen.has(b)) return false;
  return fa.node && flood(b).node;
}
