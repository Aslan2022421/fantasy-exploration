// 尋路：八方向的 A*，用在滑鼠點地圖時走過去。跨區照走，路過的區用到才生。
// 每一步要走得過去（isPassable），也不能跨過 3 層以上的落差（climb.js），所以不用 ROT.js 的 A*（它只看格子、不看兩格之間）。
// 找到之後把路線拉直（步數不變），看起來不會先斜走到底再直走

import { canStep } from './climb.js';

const STEPS = [
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
];
const MAX_NODES = 60000; // 最多展開幾格，找不到就當走不到（點到很遠或被圍住的地方時不會卡住）

const cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

// 最小堆積：[f, 序號, 格子]
function heapPush(h, item) {
  h.push(item);
  let i = h.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (h[p][0] < item[0] || (h[p][0] === item[0] && h[p][1] <= item[1])) break;
    h[i] = h[p];
    i = p;
  }
  h[i] = item;
}
function heapPop(h) {
  const top = h[0];
  const last = h.pop();
  if (h.length) {
    let i = 0;
    for (;;) {
      const l = i * 2 + 1;
      const r = l + 1;
      let m = i;
      const less = (a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
      if (l < h.length && less(h[l], m === i ? last : h[m])) m = l;
      if (r < h.length && less(h[r], m === i ? last : h[m])) m = r;
      if (m === i) break;
      h[i] = h[m];
      i = m;
    }
    h[i] = last;
  }
  return top;
}

// A*：從 from 走到 done(格子) 為真的地方；h(格子) 是估計還要幾步。回傳不含起點的每一步，找不到回傳 null
function search(world, from, done, h) {
  const key = (c) => `${c.x},${c.y}`;
  const came = new Map([[key(from), null]]);
  const cost = new Map([[key(from), 0]]);
  const open = [];
  let seq = 0;
  heapPush(open, [h(from), seq++, from]);
  while (open.length && came.size < MAX_NODES) {
    const [, , cur] = heapPop(open);
    if (done(cur)) {
      const out = [];
      for (let c = cur; c && key(c) !== key(from); c = came.get(key(c))) out.push(c);
      return out.reverse();
    }
    const g = cost.get(key(cur)) + 1;
    for (const [dx, dy] of STEPS) {
      const n = { x: cur.x + dx, y: cur.y + dy };
      const k = key(n);
      if ((cost.get(k) ?? Number.POSITIVE_INFINITY) <= g) continue;
      if (!world.isPassable(n.x, n.y) || !canStep(world, cur, n)) continue;
      cost.set(k, g);
      came.set(k, cur);
      heapPush(open, [g + h(n), seq++, n]);
    }
  }
  return null;
}

// 回傳從起點（不含）到終點（含）的每一步；走不到或點在原地回傳空陣列
export function findPath(world, from, to) {
  if (from.x === to.x && from.y === to.y) return [];
  if (!world.isPassable(to.x, to.y)) return [];
  const steps = search(
    world,
    from,
    (c) => c.x === to.x && c.y === to.y,
    (c) => cheb(c, to),
  );
  return steps ? straighten(world, from, steps) : [];
}

// 走到 to 旁邊（八方向相鄰）：to 本身可以走不過去（樹幹）。to 佔好幾格（礦坑，to.cells）時走到任一格旁邊。
// 已經在旁邊回傳 []，走不到回傳 null
export function findPathNextTo(world, from, to) {
  const cells = to.cells ?? [to];
  const near = (c) => cells.some((t) => cheb(c, t) <= 1);
  if (near(from)) return [];
  const steps = search(world, from, near, (c) => Math.max(0, Math.min(...cells.map((t) => cheb(c, t))) - 1));
  return steps ? straighten(world, from, steps) : null;
}

// 從 a 到 b 的八方向直線（每步主軸走一格、副軸平均分配），步數＝兩點的切比雪夫距離
export function lineSteps(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const n = Math.max(Math.abs(dx), Math.abs(dy));
  const out = [];
  for (let i = 1; i <= n; i++) out.push({ x: a.x + Math.round((dx * i) / n), y: a.y + Math.round((dy * i) / n) });
  return out;
}

// 路線拉直：A* 找到的路線步數不變，斜走與直走穿插開來、貼近起點到終點的直線，不會先斜走到底再直走。
// 整段拉直走得通（每格走得過去、每一步的高低差都在範圍內）就換掉，走不通就從中間切開兩半各自拉直
export function straighten(world, from, steps) {
  if (steps.length <= 1) return steps;
  const to = steps[steps.length - 1];
  if (cheb(to, from) === steps.length) {
    const line = lineSteps(from, to);
    if (line.every((c, i) => world.isPassable(c.x, c.y) && canStep(world, i ? line[i - 1] : from, c))) return line;
  }
  if (steps.length <= 2) return steps;
  const mid = Math.floor(steps.length / 2);
  return [...straighten(world, from, steps.slice(0, mid)), ...straighten(world, steps[mid - 1], steps.slice(mid))];
}

// 兩格之間的方向（相鄰格才有意義）
export function stepDirection(from, to) {
  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);
  const ns = dy < 0 ? 'n' : dy > 0 ? 's' : '';
  const we = dx < 0 ? 'w' : dx > 0 ? 'e' : '';
  return ns + we || null;
}
