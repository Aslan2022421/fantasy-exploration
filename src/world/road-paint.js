// 把道路畫進一區（terrain.js 生一區時用）：
// - 照路網的線段（roads.js）：中心線每一步邊靠邊、段長平順（line4）；大道 3 格寬、小路 2 格寬（使用者選 A）；
//   地面換成路、生態覆蓋拿掉、樹拿掉（礦坑不動）；路兩旁緊鄰的一格不留樹與樹叢（使用者選 D）
// - 路經過有水的格子（河）蓋成木橋，橫著過河 ═、直著過河 ║；只有路過河才有橋
// - 這一區有聚落：圖樣外 NEAR 格內的路拿掉（區界上的留著），斷開的每個路頭接到朝那個方向開的出入口，
//   少踩水、拉直；路不會停在牆邊或穿過聚落；出入口是照路來的方向開的（roadEntries，settlements.js 放聚落時用）
// 只看這一區自己的格子與全世界共用的路網，任何順序生出來都一樣

import { dropLoose, headGroups, linkGates, pruneSpurs } from './road-link.js';
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
export const WIDTH = { main: 3, minor: 2 }; // 大道、小路幾格寬
const SPREAD = {
  2: [
    [0, 0],
    [1, 0],
    [0, 1],
  ],
  3: [
    [0, 0],
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ],
};

// 格子 (X, Y) 離矩形 r（{ x0, y0, w, h }）差幾格（切比雪夫，裡面是 0）
const gapTo = (r, X, Y) =>
  Math.max(Math.max(r.x0 - X, 0, X - (r.x0 + r.w - 1)), Math.max(r.y0 - Y, 0, Y - (r.y0 + r.h - 1)));

// 中心線（paintRoads 與 roadEntries 共用）：照路網的線段畫進這一區，矩形 r（聚落的圖樣）外 NEAR 格內的拿掉
// （區界上的留著，隔壁區畫過來的路才接得上），拿掉之後碰不到區界的那幾截（穿過聚落、通到路網端點的尾巴）也拿掉。
// 回傳 { mark（0 不是路；1 橫向；2 直向）, wide（那格的寬度）, edge（區外緊鄰的中心線）, cut（拿掉的格子）}
function centerline(roads, zoneKey, x0, y0, size, r) {
  const mark = new Int8Array(size * size);
  const wide = new Int8Array(size * size);
  const edge = [];
  const put = (X, Y, dir, w) => {
    const x = X - x0;
    const y = Y - y0;
    if (x >= 0 && y >= 0 && x < size && y < size) {
      mark[y * size + x] ||= dir;
      wide[y * size + x] = Math.max(wide[y * size + x], w);
    } else if (x >= -1 && y >= -1 && x <= size && y <= size) edge.push([x, y, dir, w]);
  };
  for (const k of roads?.byZone.get(zoneKey) ?? []) {
    const s = roads.segments[k];
    const dir = Math.abs(s.bx - s.ax) >= Math.abs(s.by - s.ay) ? 1 : 2;
    const w = s.kind === MAIN ? WIDTH.main : WIDTH.minor;
    // 每一步都跟上一格邊靠邊（不會只靠角碰角），橫直交錯照斜率平均分配，段長平順
    for (const [X, Y] of line4(Math.floor(s.ax), Math.floor(s.ay), Math.floor(s.bx), Math.floor(s.by)))
      put(X, Y, dir, w);
  }
  const cut = new Uint8Array(size * size);
  if (r) {
    for (let y = 1; y < size - 1; y++)
      for (let x = 1; x < size - 1; x++) {
        const i = y * size + x;
        if (mark[i] && gapTo(r, x0 + x, y0 + y) <= NEAR) [mark[i], cut[i]] = [0, 1];
      }
    dropLoose(mark, size);
  }
  return { mark, wide, edge, cut };
}

// 道路從哪些角度靠近矩形 r（世界座標；zone 是這一區 { x0, y0, size }）：照畫路的同一套中心線，
// 每組要接出入口的路頭（headGroups）從 r 的中心看過去的角度；差不到 0.5 弧度的併成一個。回傳角度的陣列（0 是東、往南為正）
export function roadEntries(roads, zoneKey, r, zone) {
  const { x0, y0, size } = zone;
  const { mark, cut } = centerline(roads, zoneKey, x0, y0, size, r);
  const cx = r.x0 + (r.w - 1) / 2 - x0;
  const cy = r.y0 + (r.h - 1) / 2 - y0;
  const angles = headGroups(mark, cut, size, x0, y0, roads?.ends?.get(zoneKey)).map((g) => {
    const gx = g.reduce((a, c) => a + (c % size), 0) / g.length;
    const gy = g.reduce((a, c) => a + Math.floor(c / size), 0) / g.length;
    return Math.atan2(gy - cy, gx - cx);
  });
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

// 畫路要用的編號與判斷（terrain.js 建一次）：base 是 { ROAD, NONE, PART_MID }，加上兩種橋、礦坑（keep）、樹與樹叢（verge）
export function roadIdsFor(data, base) {
  const [EW, NS] = ['bridge-ew', 'bridge-ns'].map((id) => data.objectIndex.get(id));
  const keep = data.objects.map((o) => !!o.layers);
  const verge = data.objects.map((o) => !!o.trunk || o.id === 'shrub');
  return { ...base, EW, NS, keep: (o) => keep[o], verge: (o) => verge[o] };
}

// z：{ size, x0, y0, surface, cover, object, objectPart, water, tier, site（1 是聚落、據點的圖樣）}
// ids：{ ROAD 路的材質, NONE, EW, NS 兩種橋的物件編號, PART_MID, keep(o)：這個物件不拿掉（礦坑）,
// verge(o)：路邊要清掉的物件（樹、樹叢）}；settle：這一區的聚落（可能是 null）
// 先只記中心線（拿掉聚落附近的、接出入口、剪路尾都在中心線上做），最後才照寬度鋪開
export function paintRoads(roads, z, ids, settle) {
  const keep = ids.keep ?? (() => false);
  const verge = ids.verge ?? (() => false);
  const { size, x0, y0 } = z;
  const { mark, wide, edge, cut } = centerline(roads, z.zoneKey, x0, y0, size, settle);
  if (settle) {
    linkGates(z, mark, cut, settle, ids.NONE, roads?.ends?.get(z.zoneKey));
    pruneSpurs(z, mark, ids.ROAD);
  }
  // 照寬度鋪開：寬 2 往右、下各加一格（斜段的階梯也一起填滿），寬 3 往四邊各加一格
  const road = new Int8Array(size * size);
  const spread = (x, y, dir, w) => {
    for (const [dx, dy] of SPREAD[w]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < size && ny < size) road[ny * size + nx] ||= dir;
    }
  };
  for (let i = 0; i < size * size; i++)
    if (mark[i]) spread(i % size, Math.floor(i / size), mark[i], wide[i] || WIDTH.minor);
  for (const [x, y, dir, w] of edge) spread(x, y, dir, w);
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
  for (let i = 0; i < size * size; i++) if (road[i]) lay(i, road[i]);
  // 路邊清出一格：兩旁緊鄰的樹、樹叢拿掉（疊高的樹才不會蓋到路上）
  for (let i = 0; i < size * size; i++) {
    if (!road[i]) continue;
    const x = i % size;
    const y = (i - x) / size;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        const j = ny * size + nx;
        const o = z.object[j] - 1;
        if (!road[j] && !z.site[j] && o >= 0 && verge(o)) z.object[j] = 0;
      }
  }
}
