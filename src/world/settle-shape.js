// 聚落的輪廓與街道（settle-layouts.js 用；照使用者給的示意圖：不規則的圓形木柵、彎彎的街道）：
// - 牆內：橢圓再加兩道慢慢起伏的波（2 倍、3 倍角），先抹平再取外圈一格當牆；外圈照八方向貼著牆內取，
//   牆是邊靠邊連成一圈的，轉彎處段長照曲線平順變化，不留單格的凹凸
// - 出入口：從中心往東西南北走到牆，那裡開 3 格寬的口，口的兩側各一座瞭望塔；城鎮在四個斜角再各一座
// - 廣場：中心一圈圓的空地，正中一口井
// - 街道：廣場到每個出入口，中間插兩個往旁邊偏的點，磨圓後用四方向直線畫（段長平順），村莊 2 格寬、城鎮 3 格寬
// 只看種子＋錨點的雜湊，不看生成順序

import { hash01 } from './noise.js';
import { line4 } from './road-paint.js';

export const SHAPE = {
  margin: 3, // 牆離整塊圖樣的邊幾格（留給出入口外的路與瞭望塔）
  wave: [0.07, 0.05], // 2 倍角、3 倍角的波幅
  plaza: { village: 3, town: 5 }, // 廣場半徑
  street: { village: 2, town: 3 }, // 街道寬
  bend: 0.18, // 街道中間點往旁邊偏多少（佔那段長度）
};

const STEPS4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

// 回傳 { inner: Uint8Array（1 是牆內）, ring: Uint8Array（1 是牆）, cx, cy, rx, ry }
export function wallShape(W, H, rnd) {
  const cx = (W - 1) / 2;
  const cy = (H - 1) / 2;
  const rx = W / 2 - SHAPE.margin;
  const ry = H / 2 - SHAPE.margin;
  const p1 = rnd(11) * Math.PI * 2;
  const p2 = rnd(12) * Math.PI * 2;
  let inner = new Uint8Array(W * H);
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const dx = (i - cx) / rx;
      const dy = (j - cy) / ry;
      const a = Math.atan2(dy, dx);
      const R = 1 + SHAPE.wave[0] * Math.sin(2 * a + p1) + SHAPE.wave[1] * Math.sin(3 * a + p2);
      inner[j * W + i] = Math.hypot(dx, dy) <= R ? 1 : 0;
    }
  // 抹平兩次：周圍九格多數決，單格的凸出、凹口都拿掉
  for (let pass = 0; pass < 2; pass++) {
    const next = new Uint8Array(W * H);
    for (let j = 1; j < H - 1; j++)
      for (let i = 1; i < W - 1; i++) {
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) n += inner[(j + dy) * W + i + dx];
        next[j * W + i] = n >= 5 ? 1 : 0;
      }
    inner = next;
  }
  const ring = new Uint8Array(W * H);
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      if (inner[j * W + i]) continue;
      let touch = false;
      for (let dy = -1; dy <= 1 && !touch; dy++)
        for (let dx = -1; dx <= 1 && !touch; dx++) {
          const a = i + dx;
          const b = j + dy;
          touch = a >= 0 && b >= 0 && a < W && b < H && inner[b * W + a] === 1;
        }
      if (touch) ring[j * W + i] = 1;
    }
  return { inner, ring, cx: Math.round(cx), cy: Math.round(cy), rx, ry };
}

// 出入口：從中心往 side 那一邊走到牆，回傳 { side, i, j（牆上那一格）, di, dj（往外的方向）}
export function gateAt(shape, W, H, side) {
  const [di, dj] = { west: [-1, 0], east: [1, 0], north: [0, -1], south: [0, 1] }[side];
  let i = shape.cx;
  let j = shape.cy;
  while (i > 0 && j > 0 && i < W - 1 && j < H - 1 && !shape.ring[j * W + i]) {
    i += di;
    j += dj;
  }
  return { side, i, j, di, dj };
}

// 街道：a 到 b，中間兩個點往旁邊偏、磨圓後用四方向直線畫；回傳經過的格子 [[i, j]]（寬 1，呼叫的人再加寬）
export function streetPath(a, b, rnd, salt) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const off = (k) => (rnd(salt + k) - 0.5) * 2 * SHAPE.bend * len;
  let pts = [
    a,
    [a[0] + dx / 3 + nx * off(1), a[1] + dy / 3 + ny * off(1)],
    [a[0] + (2 * dx) / 3 + nx * off(2), a[1] + (2 * dy) / 3 + ny * off(2)],
    b,
  ];
  for (let it = 0; it < 3; it++) {
    const out = [pts[0]];
    for (let k = 0; k < pts.length - 1; k++) {
      const [ax, ay] = pts[k];
      const [bx, by] = pts[k + 1];
      out.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25], [ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
    }
    out.push(pts[pts.length - 1]);
    pts = out;
  }
  const cells = [];
  for (let k = 1; k < pts.length; k++) {
    const seg = line4(
      Math.round(pts[k - 1][0]),
      Math.round(pts[k - 1][1]),
      Math.round(pts[k][0]),
      Math.round(pts[k][1]),
    );
    cells.push(...(k > 1 ? seg.slice(1) : seg));
  }
  return cells;
}

// 加寬：寬 2 往右、下各加一格；寬 3 往四邊各加一格
export function widen(cells, width) {
  const out = [...cells];
  if (width >= 2) for (const [i, j] of cells) out.push([i + 1, j], [i, j + 1]);
  if (width >= 3) for (const [i, j] of cells) out.push([i - 1, j], [i, j - 1]);
  return out;
}

export { STEPS4 };

// 種子＋錨點的雜湊（呼叫的人用）
export const makeRnd = (seed, x0, y0) => (k) => hash01(seed, x0, y0, 9500 + k);
