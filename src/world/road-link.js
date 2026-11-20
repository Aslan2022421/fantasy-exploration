// 道路接到聚落的出入口（road-paint.js 用）：
// - dropLoose：聚落附近的路拿掉後，碰不到區界的那幾截也拿掉（路都是從區外來的，碰不到區界的是懸空的）
// - linkGates：斷開的路頭一組一組接到朝那個方向開的出入口；route 找路（少踩水、拉直）
// - pruneSpurs：接好之後還有一頭沒接到東西的路剪掉

import { heap } from './gridtools.js';
import { line4, NEAR4 } from './road-paint.js';

const LINK = 120; // 路頭接到出入口，最多走幾格

// 連在一起（八方向）的路裡，碰不到區界的整塊拿掉
export function dropLoose(mark, size) {
  const seen = new Uint8Array(size * size);
  for (let s0 = 0; s0 < size * size; s0++) {
    if (!mark[s0] || seen[s0]) continue;
    const group = [s0];
    seen[s0] = 1;
    let border = false;
    for (let h = 0; h < group.length; h++) {
      const x = group[h] % size;
      const y = (group[h] - x) / size;
      if (x === 0 || y === 0 || x === size - 1 || y === size - 1) border = true;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          const j = ny * size + nx;
          if (nx < 0 || ny < 0 || nx >= size || ny >= size || seen[j] || !mark[j]) continue;
          seen[j] = 1;
          group.push(j);
        }
    }
    if (!border) for (const i of group) mark[i] = 0;
  }
}

// 接好出入口後，還有一頭沒接到東西的路（八方向只有一格相鄰的路；聚落的街道、出入口外那段也算）一格一格剪掉，區界上的不剪
export function pruneSpurs(z, mark, road) {
  const { size } = z;
  const linked = (i) => mark[i] || (z.site[i] && z.surface[i] === road);
  for (let changed = true; changed; ) {
    changed = false;
    for (let y = 1; y < size - 1; y++)
      for (let x = 1; x < size - 1; x++) {
        const i = y * size + x;
        if (!mark[i]) continue;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && linked(i + dy * size + dx)) n++;
        if (n <= 1) [mark[i], changed] = [0, true];
      }
  }
}

// 斷開的路頭（緊鄰拿掉的那段）與停在路網端點的路頭（end，聚落沒蓋在端點上時），一組一組接到出入口（route），記進 mark
export function linkGates(z, mark, cut, s, none, end) {
  const { size, x0, y0 } = z;
  const goals = [];
  const gates = [];
  for (const g of s.layout.gates) {
    const x = s.x0 + g.out.i - x0;
    const y = s.y0 + g.out.j - y0;
    if (x < 0 || y < 0 || x >= size || y >= size || z.site[y * size + x]) continue;
    goals.push(y * size + x);
    gates.push(g);
  }
  if (!goals.length) return;
  const head = new Uint8Array(size * size);
  for (let i = 0; i < size * size; i++) {
    if (!mark[i]) continue;
    const x = i % size;
    const y = (i - x) / size;
    const touch = ([dx, dy]) => {
      const nx = x + dx;
      const ny = y + dy;
      return nx >= 0 && ny >= 0 && nx < size && ny < size && cut[ny * size + nx] === 1;
    };
    if (NEAR4.some(touch)) head[i] = 1;
    if (end && Math.max(Math.abs(x0 + x - Math.floor(end[0])), Math.abs(y0 + y - Math.floor(end[1]))) <= 1) head[i] = 1;
  }
  for (let s0 = 0; s0 < size * size; s0++) {
    if (!head[s0]) continue;
    const group = [s0];
    head[s0] = 0;
    for (let h = 0; h < group.length; h++) {
      const x = group[h] % size;
      const y = (group[h] - x) / size;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= size || ny >= size || !head[ny * size + nx]) continue;
          head[ny * size + nx] = 0;
          group.push(ny * size + nx);
        }
    }
    // 照這組在聚落的哪個方向，走到角度最接近的出入口（每條來的路各接各的口）；走不到就接任何一個口
    const sx = s.x0 + (s.w - 1) / 2 - x0;
    const sy = s.y0 + (s.h - 1) / 2 - y0;
    const gx = group.reduce((a, c) => a + (c % size), 0) / group.length;
    const gy = group.reduce((a, c) => a + Math.floor(c / size), 0) / group.length;
    const ang = Math.atan2(gy - sy, gx - sx);
    const diff = (a) => Math.abs(Math.atan2(Math.sin(a - ang), Math.cos(a - ang)));
    const order = goals.map((goal, k) => ({ goal, d: diff(gates[k].angle) })).sort((a, b) => a.d - b.d);
    const path = route(z, group, [order[0].goal], none) ?? route(z, group, goals, none);
    if (!path) continue;
    for (let k = 0; k < path.length; k++) {
      const a = path[Math.max(0, k - 1)];
      const b = path[Math.min(path.length - 1, k + 1)];
      if (!z.site[path[k]]) mark[path[k]] ||= Math.abs((b % size) - (a % size)) >= 1 ? 1 : 2;
    }
  }
}

// 從一組格子走到 goals 裡任一格：四方向，一步 1、踏上水再加 WET（少架橋），穿不過圖樣、高低差超過 2 層走不過；
// 找到後拉直（能直接連過去、不多踩水就拿掉中間的轉折）。回傳經過的格子
const WET = 6;
function route(z, from, goals, none) {
  const { size } = z;
  const n = size * size;
  const dist = new Float32Array(n).fill(Number.POSITIVE_INFINITY);
  const prev = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  const goal = new Set(goals);
  const wet = (c) => (z.water[c] !== none ? 1 : 0);
  const open = heap();
  for (const i of from) {
    dist[i] = 0;
    open.push(0, i);
  }
  let end = -1;
  while (open.size) {
    const i = open.pop();
    if (done[i]) continue;
    done[i] = 1;
    if (goal.has(i)) {
      end = i;
      break;
    }
    if (dist[i] > LINK * 2) break;
    const x = i % size;
    const y = (i - x) / size;
    for (const [dx, dy] of NEAR4) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const j = ny * size + nx;
      if (done[j] || z.site[j] || Math.abs(z.tier[j] - z.tier[i]) > 2) continue;
      const d = dist[i] + 1 + WET * wet(j);
      if (d >= dist[j]) continue;
      dist[j] = d;
      prev[j] = i;
      open.push(d, j);
    }
  }
  if (end < 0) return null;
  const p = [];
  for (let c = end; c >= 0; c = prev[c]) p.push(c);
  p.reverse();
  // 拉直
  const wetSum = [0];
  for (const c of p) wetSum.push(wetSum.at(-1) + wet(c));
  const lineOf = (a, b) =>
    line4(a % size, Math.floor(a / size), b % size, Math.floor(b / size)).map(([x, y]) => y * size + x);
  const ok = (cells) => cells.every((c, k) => !z.site[c] && (!k || Math.abs(z.tier[c] - z.tier[cells[k - 1]]) <= 2));
  const out = [p[0]];
  for (let a = 0; a < p.length - 1; ) {
    let b = p.length - 1;
    let cells = null;
    for (; b > a + 1; b--) {
      cells = lineOf(p[a], p[b]);
      if (ok(cells) && cells.reduce((m, c) => m + wet(c), 0) <= wetSum[b + 1] - wetSum[a]) break;
      cells = null;
    }
    out.push(...(cells ?? [p[a], p[a + 1]]).slice(1));
    a = cells ? b : a + 1;
  }
  return out;
}
