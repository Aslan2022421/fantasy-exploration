// 把道路畫進一區（terrain.js 生一區時用）：
// - 照路網的線段（roads.js）：中心線每一步邊靠邊、段長平順（line4）；大道往四邊各加一格、寬 3 格，小路寬 1 格；
//   地面換成路、生態覆蓋拿掉、樹拿掉（礦坑不動）
// - 路經過有水的格子（河）蓋成木橋，橫著過河 ═、直著過河 ║；只有路過河才有橋
// - 這一區有聚落：圖樣外 NEAR 格內的路拿掉（區界上的留著），斷開的每個路頭接到朝那個方向開的出入口，
//   少踩水、拉直；路不會停在牆邊或穿過聚落；出入口是照路來的方向開的（roadEntries，settlements.js 放聚落時用）
// 只看這一區自己的格子與全世界共用的路網，任何順序生出來都一樣

import { dropLoose, linkGates, pruneSpurs } from './road-link.js';
import { MAIN } from './roads.js';

export const NEAR4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

// 兩格之間的四方向直線：每一步只走橫或直，照「到下一個橫格、下一個直格的進度」誰先到就走誰，
// 橫直的段長平均分配（不會 2,1,2,1 那樣忽長忽短）；回傳經過的每一格（含兩端）
export function line4(xa, ya, xb, yb) {
  const dx = Math.abs(xb - xa);
  const dy = Math.abs(yb - ya);
  const sx = xb > xa ? 1 : -1;
  const sy = yb > ya ? 1 : -1;
  const out = [[xa, ya]];
  let x = xa;
  let y = ya;
  for (let ix = 0, iy = 0; ix < dx || iy < dy; ) {
    if (iy >= dy || (ix < dx && (0.5 + ix) / dx < (0.5 + iy) / dy)) {
      x += sx;
      ix++;
    } else {
      y += sy;
      iy++;
    }
    out.push([x, y]);
  }
  return out;
}

export const NEAR = 2; // 圖樣外幾格內的路拿掉，改接到出入口

// 格子 (X, Y) 離矩形 r（{ x0, y0, w, h }）差幾格（切比雪夫，裡面是 0）
const gapTo = (r, X, Y) =>
  Math.max(Math.max(r.x0 - X, 0, X - (r.x0 + r.w - 1)), Math.max(r.y0 - Y, 0, Y - (r.y0 + r.h - 1)));

// 道路從哪些角度靠近矩形 r（世界座標）：路的中心線跨進（或跨出）離 r NEAR 格內的那一步，外面那一格從 r 的中心看過去的角度；
// 只擦過、沒進到 NEAR 格內的路不算（那條路不會被拿掉，也就不用接）。差不到 0.5 弧度的併成一個。回傳角度的陣列（0 是東、往南為正）
// zone：這一區的範圍 { x0, y0, size }
export function roadEntries(roads, zoneKey, r, zone) {
  const cx = r.x0 + (r.w - 1) / 2;
  const cy = r.y0 + (r.h - 1) / 2;
  const angles = [];
  for (const k of roads?.byZone.get(zoneKey) ?? []) {
    const s = roads.segments[k];
    let prev = null;
    for (const [X, Y] of line4(Math.floor(s.ax), Math.floor(s.ay), Math.floor(s.bx), Math.floor(s.by))) {
      const inside = gapTo(r, X, Y) <= NEAR;
      if (prev && prev.inside !== inside) {
        const [ox, oy] = inside ? [prev.X, prev.Y] : [X, Y];
        angles.push(Math.atan2(oy - cy, ox - cx));
      }
      prev = { X, Y, inside };
    }
  }
  // 路網在這一區的端點落在 NEAR 格外（聚落沒蓋在它上面），而且通到端點的路沒先經過聚落：路停在那裡，朝它開一個口
  const end = roads?.ends?.get(zoneKey);
  if (end && gapTo(r, Math.floor(end[0]), Math.floor(end[1])) > NEAR && !passesBy(roads, end, r, zone))
    angles.push(Math.atan2(end[1] - cy, end[0] - cx));
  if (!angles.length) return [];
  angles.sort((a, b) => a - b);
  const groups = [[angles[0]]];
  for (let k = 1; k < angles.length; k++) {
    if (angles[k] - angles[k - 1] < 0.5) groups.at(-1).push(angles[k]);
    else groups.push([angles[k]]);
  }
  // 頭尾跨過 ±π 的併起來
  if (groups.length > 1 && angles[0] + 2 * Math.PI - angles.at(-1) < 0.5) groups[0].push(...groups.pop());
  return groups.map((g) =>
    Math.atan2(
      g.reduce((a, b) => a + Math.sin(b), 0),
      g.reduce((a, b) => a + Math.cos(b), 0),
    ),
  );
}

// 通到端點 end 的路，從端點往回走、出這一區之前，有沒有經過矩形 r 的 NEAR 格內
function passesBy(roads, end, r, zone) {
  const inZone = (X, Y) => X >= zone.x0 && Y >= zone.y0 && X < zone.x0 + zone.size && Y < zone.y0 + zone.size;
  for (const { pts } of roads.lines) {
    const head = Math.hypot(pts[0][0] - end[0], pts[0][1] - end[1]) < 1;
    const tail = Math.hypot(pts.at(-1)[0] - end[0], pts.at(-1)[1] - end[1]) < 1;
    if (!head && !tail) continue;
    const p = head ? pts : [...pts].reverse();
    for (let k = 1; k < p.length; k++)
      for (const [X, Y] of line4(
        Math.floor(p[k - 1][0]),
        Math.floor(p[k - 1][1]),
        Math.floor(p[k][0]),
        Math.floor(p[k][1]),
      )) {
        if (!inZone(X, Y)) return false;
        if (gapTo(r, X, Y) <= NEAR) return true;
      }
  }
  return false;
}

// z：{ size, x0, y0, surface, cover, object, objectPart, water, tier, site（1 是聚落、據點的圖樣）}
// ids：{ ROAD 路的材質, NONE, EW, NS 兩種橋的物件編號, PART_MID }；keep(o)：這個物件不拿掉（礦坑）
// settle：這一區的聚落（可能是 null）
export function paintRoads(roads, z, ids, keep, settle) {
  const { size, x0, y0 } = z;
  const segs = roads?.byZone.get(z.zoneKey) ?? [];
  const mark = new Int8Array(size * size); // 0 不是路；1 橫向的路；2 直向的路
  const put = (X, Y, dir) => {
    const x = X - x0;
    const y = Y - y0;
    if (x >= 0 && y >= 0 && x < size && y < size) mark[y * size + x] ||= dir;
  };
  for (const k of segs) {
    const s = roads.segments[k];
    const dir = Math.abs(s.bx - s.ax) >= Math.abs(s.by - s.ay) ? 1 : 2;
    // 中心線：每一步都跟上一格邊靠邊（不會只靠角碰角），橫直交錯照斜率平均分配，段長平順
    for (const [X, Y] of line4(Math.floor(s.ax), Math.floor(s.ay), Math.floor(s.bx), Math.floor(s.by))) {
      put(X, Y, dir);
      if (s.kind === MAIN) for (const [dx, dy] of NEAR4) put(X + dx, Y + dy, dir); // 大道往四邊各多一格，3 格寬
    }
  }
  // 聚落附近的路拿掉（區界上的留著，隔壁區畫過來的路才接得上）
  const cut = new Uint8Array(size * size);
  if (settle)
    for (let y = 1; y < size - 1; y++)
      for (let x = 1; x < size - 1; x++) {
        const i = y * size + x;
        if (mark[i] && gapTo(settle, x0 + x, y0 + y) <= NEAR) [mark[i], cut[i]] = [0, 1];
      }
  // 拿掉之後碰不到區界的那幾截（路穿過聚落後、通到路網端點的尾巴）也拿掉：路都是從區外來的，碰不到區界的是懸空的
  if (settle) dropLoose(mark, size);
  const lay = (i, dir) => {
    if (z.site[i]) return false;
    const o = z.object[i] - 1;
    if (o >= 0 && keep(o)) return false;
    if (z.water[i] !== ids.NONE) {
      z.object[i] = (dir === 1 ? ids.EW : ids.NS) + 1;
      z.objectPart[i] = ids.PART_MID;
      return true;
    }
    z.surface[i] = ids.ROAD;
    z.cover[i] = ids.NONE;
    z.object[i] = 0;
    return true;
  };
  if (settle) {
    linkGates(z, mark, cut, settle, ids.NONE, roads?.ends?.get(z.zoneKey));
    pruneSpurs(z, mark, ids.ROAD);
  }
  for (let i = 0; i < size * size; i++) if (mark[i]) lay(i, mark[i]);
}
