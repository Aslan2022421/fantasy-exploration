// 聚落的輪廓與街道（settle-layouts.js 用）。外形照所在的地形挑（settlements.js 決定，使用者選 B）：
// - round 圓形：平地。橢圓再加兩道慢慢起伏的波（2 倍、3 倍角）；畫圓照使用者給的像素曲線示意圖，段長平順
// - long 長形：靠水的平地，沿著水岸拉長（圓角的長方，寬高比約 1.6）
// - square 方形：只有村莊，四角切掉的方框
// - terrain 照地形：旁邊有坡、山或水，牆內只取能蓋的格子（平、沒有水），貼著地形圍起來
// 取好牆內先抹平再取外圈一格當牆；外圈照八方向貼著牆內取，牆是邊靠邊連成一圈的，不留單格的凹凸
// - 出入口：朝道路來的方向（settlements.js 照路網算好角度），從中心沿那個角度走到牆，開 3 格寬的口，兩側各一座瞭望塔
// - 廣場：中心一圈圓的空地，正中一口井
// - 街道：廣場到每個出入口，中間插兩個往旁邊偏的點，磨圓後用四方向直線畫（段長平順），村莊 2 格寬、城鎮 3 格寬
// 只看種子＋錨點的雜湊，不看生成順序

import { hash01 } from './noise.js';
import { line4 } from './road-paint.js';

export const SHAPE = {
  margin: 3, // 牆離整塊圖樣的邊幾格（留給出入口外的路與瞭望塔）
  wave: [0.07, 0.05], // 2 倍角、3 倍角的波幅
  plaza: { village: 3, town: 5, city: 8 }, // 廣場半徑
  street: { village: 2, town: 3, city: 3 }, // 街道寬
  bend: 0.18, // 街道中間點往旁邊偏多少（佔那段長度）
  size: [0.82, 0.05], // 牆的大小：人口標籤 0 是 82%，每高一段加 5%
  long: 0.72, // 長形的短邊再縮成多少
  chamfer: 3, // 方形四角切掉幾格
};

// 外形在 (dx, dy)（已除以半徑）裡不裡面
function insideForm(form, dx, dy, i, j, cx, cy, rx, ry, p1, p2) {
  if (form === 'square')
    return Math.max(Math.abs(dx), Math.abs(dy)) <= 1 && Math.abs(i - cx) + Math.abs(j - cy) <= rx + ry - SHAPE.chamfer;
  if (form === 'long') return Math.abs(dx) ** 3 + Math.abs(dy) ** 3 <= 1 + 0.04 * Math.sin(3 * Math.atan2(dy, dx) + p2);
  const a = Math.atan2(dy, dx);
  return Math.hypot(dx, dy) <= 1 + SHAPE.wave[0] * Math.sin(2 * a + p1) + SHAPE.wave[1] * Math.sin(3 * a + p2);
}

const STEPS4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

// form：外形；ok：Uint8Array（1 是能蓋的格子，照地形的外形才看）；tag：開局的人口標籤（0～4，決定大小）
// 回傳 { inner: Uint8Array（1 是牆內）, ring: Uint8Array（1 是牆）, cx, cy, rx, ry }；照地形圍不出來回傳 null
export function wallShape(W, H, rnd, form = 'round', ok = null, tag = 4) {
  const cx = (W - 1) / 2;
  const cy = (H - 1) / 2;
  const k = Math.min(1, SHAPE.size[0] + SHAPE.size[1] * tag);
  // 長形：短的那一邊再縮（圖樣是橫的就扁、直的就瘦）
  const rx = (W / 2 - SHAPE.margin) * k * (form === 'long' && W < H ? SHAPE.long : 1);
  const ry = (H / 2 - SHAPE.margin) * k * (form === 'long' && W >= H ? SHAPE.long : 1);
  const p1 = rnd(11) * Math.PI * 2;
  const p2 = rnd(12) * Math.PI * 2;
  // 照地形：自己與周圍八格都能蓋（牆也落在能蓋的格子上）
  const good = (i, j) => {
    if (!ok) return true;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const a = i + dx;
        const b = j + dy;
        if (a < 0 || b < 0 || a >= W || b >= H || !ok[b * W + a]) return false;
      }
    return true;
  };
  let inner = new Uint8Array(W * H);
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++)
      inner[j * W + i] =
        insideForm(form, (i - cx) / rx, (j - cy) / ry, i, j, cx, cy, rx, ry, p1, p2) && good(i, j) ? 1 : 0;
  // 抹平兩次：周圍九格多數決，單格的凸出、凹口都拿掉（方形不抹，四角才是直的）
  for (let pass = 0; pass < (form === 'square' ? 0 : 2); pass++) {
    const next = new Uint8Array(W * H);
    for (let j = 1; j < H - 1; j++)
      for (let i = 1; i < W - 1; i++) {
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) n += inner[(j + dy) * W + i + dx];
        next[j * W + i] = n >= 5 && good(i, j) ? 1 : 0;
      }
    inner = next;
  }
  if (ok) {
    inner = component(inner, W, H, Math.round(cx), Math.round(cy));
    if (!inner) return null;
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

// 中心那一塊連在一起的牆內（四方向）；中心不在牆內回傳 null
function component(inner, W, H, ci, cj) {
  if (!inner[cj * W + ci]) return null;
  const out = new Uint8Array(W * H);
  const q = [cj * W + ci];
  out[q[0]] = 1;
  for (let h = 0; h < q.length; h++) {
    const i = q[h] % W;
    const j = (q[h] - i) / W;
    for (const [di, dj] of STEPS4) {
      const a = i + di;
      const b = j + dj;
      const c = b * W + a;
      if (a < 0 || b < 0 || a >= W || b >= H || out[c] || !inner[c]) continue;
      out[c] = 1;
      q.push(c);
    }
  }
  return out;
}

// 出入口：從中心沿 angle（弧度，0 是東、往南為正）走到牆，回傳 { angle, i, j（牆上那一格）, di, dj（往外、取最接近的四方向）}
export function gateToward(shape, W, H, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  let i = shape.cx;
  let j = shape.cy;
  for (let t = 0; t < W + H; t += 0.5) {
    i = Math.round(shape.cx + c * t);
    j = Math.round(shape.cy + s * t);
    if (i <= 0 || j <= 0 || i >= W - 1 || j >= H - 1 || shape.ring[j * W + i]) break;
  }
  const [di, dj] = Math.abs(c) >= Math.abs(s) ? [Math.sign(c), 0] : [0, Math.sign(s)];
  return { angle, i, j, di, dj };
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
