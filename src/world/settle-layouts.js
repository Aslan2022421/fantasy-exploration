// 聚落的圖樣（照使用者給的城鎮示意圖：不規則的圓形木柵、瞭望塔、彎彎的街道、大小不一的房子、田、樹叢）：
// 1. 輪廓、出入口、廣場、街道（settle-shape.js）
// 2. 建築：城鎮先蓋鎮公所、神殿、兵營，再來旅店、酒館（村莊夠大才有旅店），最後民房；外框不貼牆、彼此不相貼，
//    貼著街道的位置優先；門開在靠街那一邊，門外不是街就鋪一條巷子接到最近的街；家具照用途擺（settle-furnish.js）。
//    民房的床位不夠住滿時改蓋大房子
// 3. 田（一排作物一排泥土）、樹叢，放在剩下的空地
// 4. 城鎮廣場的外圈擺市場攤位
// 每格是一個代碼：GROUND（聚落裡的空地）、ROAD（街道、巷子、廣場）、INDOOR（室內地板）、FIELD（田裡的泥土）、
// KEEP（牆外，保留原本的地形）、OUTROAD（出入口外的路）或物件的 id。只看種子＋錨點的雜湊與「哪幾邊能開出入口」

import { BED, FIELD, GROUND, INDOOR, KEEP, OUTROAD, ROAD, WELL, walkable } from './settle-codes.js';
import { furnishRoom } from './settle-furnish.js';
import { gateAt, makeRnd, SHAPE, STEPS4, streetPath, wallShape, widen } from './settle-shape.js';
import { reachable } from './settle-walls.js';

export * from './settle-codes.js';
export { reachable };

// 建築：牆的物件、室內寬高、門數、家具；spot 是住戶站的格子（貼著門內那一格）；home 是有人住
const BUILDINGS = {
  house: { wall: 'house', w: 3, h: 2, doors: 1, spot: true, home: true, items: ['bed', 'cabinet', 'chair'] },
  big: { wall: 'house', w: 4, h: 3, doors: 1, home: true, items: ['table', 'cabinet', 'chair', 'chair'] },
  hall: { wall: 'hall', w: 7, h: 4, doors: 1, items: ['table', 'table', 'chair', 'chair', 'chair', 'cabinet'] },
  temple: { wall: 'temple', w: 5, h: 4, doors: 1, items: ['altar', 'chair', 'chair', 'chair', 'chair'] },
  barracks: { wall: 'barracks', w: 7, h: 3, doors: 1, items: ['bed', 'bed', 'bed', 'bed', 'bed', 'cabinet'] },
  inn: { wall: 'inn', w: 6, h: 4, doors: 1, items: ['bed', 'bed', 'bed', 'table', 'chair', 'chair', 'barrel'] },
  tavern: {
    wall: 'tavern',
    w: 6,
    h: 4,
    doors: 1,
    items: ['table', 'table', 'chair', 'chair', 'chair', 'chair', 'barrel'],
  },
};
// 公共建築：城鎮全有；村莊人口標籤到「穩定」以上才有旅店
const PUBLIC = { town: ['hall', 'temple', 'barracks', 'inn', 'tavern'], village: ['inn'] };
const FIELDS = { village: [2, 3], town: [2, 3] }; // 幾塊田
const GROVES = { village: [2, 3], town: [2, 4] }; // 幾叢樹
const GROVE_TREES = ['oak', 'maple', 'birch'];

// def：聚落資料；tag：開局的人口標籤（0～4）；canOpen(side)：那一邊外面能不能開出入口（不朝湖開）。開不出 3 個回傳 null
export function buildSettlement(def, seed, x0, y0, tag, canOpen) {
  const W = def.w;
  const H = def.h;
  const rnd = makeRnd(seed, x0, y0);
  const shape = wallShape(W, H, rnd);
  const { inner, ring, cx, cy } = shape;
  const at = (i, j) => j * W + i;
  const grid = Array.from({ length: H }, (_, j) =>
    Array.from({ length: W }, (_, i) => (inner[at(i, j)] ? GROUND : ring[at(i, j)] ? def.wall : KEEP)),
  );
  const set = (i, j, code) => {
    if (i >= 0 && j >= 0 && i < W && j < H) grid[j][i] = code;
  };
  const get = (i, j) => (i >= 0 && j >= 0 && i < W && j < H ? grid[j][i] : null);
  const kind = def.id === 'town' ? 'town' : 'village';
  const door = kind === 'village' ? 'door' : 'stone-door';

  // 出入口：東西兩邊優先，南北的順序照雜湊
  const [glo, ghi] = def.gates;
  const want = glo + Math.floor(rnd(1) * (ghi - glo + 1));
  const order = rnd(2) < 0.5 ? ['west', 'east', 'north', 'south'] : ['west', 'east', 'south', 'north'];
  const sides = order.filter((s) => canOpen(s)).slice(0, want);
  if (sides.length < Math.min(3, want)) return null;
  const gates = sides.map((s) => gateAt(shape, W, H, s));

  // 廣場與井
  const pr = SHAPE.plaza[kind];
  for (let j = cy - pr; j <= cy + pr; j++)
    for (let i = cx - pr; i <= cx + pr; i++) if (Math.hypot(i - cx, j - cy) <= pr + 0.3) set(i, j, ROAD);
  set(cx, cy, WELL);

  // 街道與出入口：口 3 格寬，從牆往外打通到圖樣的邊；兩側瞭望塔
  const tower = `${kind}-tower`;
  gates.forEach((g, k) => {
    const street = streetPath([cx + g.di * pr, cy + g.dj * pr], [g.i, g.j], rnd, 20 + k * 5);
    for (const [i, j] of widen(street, SHAPE.street[kind])) if (inner[at(i, j)] && get(i, j) !== WELL) set(i, j, ROAD);
    for (let w = -1; w <= 1; w++)
      for (let d = 0; ; d++) {
        const i = g.i + g.di * d + (g.dj ? w : 0);
        const j = g.j + g.dj * d + (g.di ? w : 0);
        if (i < 0 || j < 0 || i >= W || j >= H) break;
        set(i, j, get(i, j) === KEEP ? OUTROAD : ROAD);
        // 口往內接到街道
        for (let back = 1; back <= 3; back++) {
          const bi = g.i - g.di * back + (g.dj ? w : 0);
          const bj = g.j - g.dj * back + (g.di ? w : 0);
          if (get(bi, bj) === GROUND) set(bi, bj, ROAD);
        }
      }
    for (const w of [-2, 2]) {
      const i = g.i + (g.dj ? w : 0);
      const j = g.j + (g.di ? w : 0);
      if (ring[at(i, j)]) set(i, j, tower);
    }
  });
  // 城鎮在四個斜角的牆上再各一座
  if (kind === 'town')
    for (const [sx, sy] of [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ]) {
      let i = cx;
      let j = cy;
      while (i > 0 && j > 0 && i < W - 1 && j < H - 1 && !ring[at(i, j)]) {
        i += sx;
        j += sy;
      }
      if (ring[at(i, j)] && get(i, j) === def.wall) set(i, j, tower);
    }

  // 建築：放得下＝外框都是空地、外圍一圈不是別的建築或牆
  const taken = new Uint8Array(W * H);
  const fits = (hx, hy, w, h) => {
    for (let j = hy - 1; j <= hy + h; j++)
      for (let i = hx - 1; i <= hx + w; i++) {
        const inside = i >= hx && i < hx + w && j >= hy && j < hy + h;
        const c = get(i, j);
        if (inside && c !== GROUND) return false;
        if (!inside && (c === null || taken[at(i, j)] || c === def.wall || c === tower || c === KEEP)) return false;
      }
    return true;
  };
  const roadGap = (hx, hy, w, h) => {
    let best = 99;
    for (let j = Math.max(0, hy - 4); j < Math.min(H, hy + h + 4); j++)
      for (let i = Math.max(0, hx - 4); i < Math.min(W, hx + w + 4); i++) {
        if (grid[j][i] !== ROAD) continue;
        const d = Math.max(Math.max(hx - i, 0, i - (hx + w - 1)), Math.max(hy - j, 0, j - (hy + h - 1)));
        best = Math.min(best, d);
      }
    return best;
  };
  const spotsFor = (w, h, salt, nearCenter) => {
    const out = [];
    for (let hy = 1; hy + h < H; hy++)
      for (let hx = 1; hx + w < W; hx++) {
        if (!inner[at(hx, hy)] || !inner[at(hx + w - 1, hy + h - 1)]) continue;
        const far = Math.hypot(hx + w / 2 - cx, hy + h / 2 - cy);
        const gap = Math.min(roadGap(hx, hy, w, h), 5);
        out.push({ hx, hy, key: gap * 100 + (nearCenter ? far * 2 : 0) + rnd(salt + hx * 131 + hy) * 30 });
      }
    return out.sort((a, b) => a.key - b.key);
  };

  const doorsOut = [];
  const build = (hx, hy, b, beds, salt) => {
    const w = b.w + 2;
    const h = b.h + 2;
    for (let j = hy; j < hy + h; j++)
      for (let i = hx; i < hx + w; i++) {
        const edge = i === hx || j === hy || i === hx + w - 1 || j === hy + h - 1;
        set(i, j, edge ? b.wall : INDOOR);
        taken[at(i, j)] = 1;
      }
    const mids = [
      { i: hx + (w >> 1), j: hy, oi: 0, oj: -1 },
      { i: hx + (w >> 1), j: hy + h - 1, oi: 0, oj: 1 },
      { i: hx, j: hy + ((h - 1) >> 1), oi: -1, oj: 0 },
      { i: hx + w - 1, j: hy + ((h - 1) >> 1), oi: 1, oj: 0 },
    ];
    // 門開在離街道最近的那一邊
    const toRoad = (m) => roadGap(m.i + m.oi, m.j + m.oj, 1, 1);
    mids.sort((a, c) => toRoad(a) - toRoad(c));
    const m = mids[0];
    set(m.i, m.j, door);
    doorsOut.push({ i: m.i + m.oi, j: m.j + m.oj });
    const cells = [];
    for (let j = hy + 1; j < hy + h - 1; j++) for (let i = hx + 1; i < hx + w - 1; i++) cells.push({ i, j });
    const items = [...b.items, ...Array(beds).fill(BED)];
    const r = furnishRoom(cells, [{ i: m.i - m.oi, j: m.j - m.oj }], items, !!b.spot, (c, k) =>
      rnd(salt + c.i * 31 + c.j * 7 + k),
    );
    if (r) for (const p of r.placed) set(p.i, p.j, p.code);
    const bedCells = (r?.placed ?? []).filter((p) => p.code === BED).map(({ i, j }) => ({ i, j }));
    return { cells, beds: bedCells, spot: r?.spot ?? null };
  };
  const place = (b, salt, nearCenter, beds = 0) => {
    const w = b.w + 2;
    const h = b.h + 2;
    const s = spotsFor(w, h, salt, nearCenter).find((o) => fits(o.hx, o.hy, w, h));
    return s ? build(s.hx, s.hy, b, beds, salt + 1) : null;
  };

  const publics = kind === 'town' ? PUBLIC.town : tag >= 2 ? PUBLIC.village : [];
  // 旅店、兵營有床的也住人（旅店老闆、士兵），床位算進去
  const homes = [];
  let bedsSoFar = 0;
  for (let k = 0; k < publics.length; k++) {
    const h = place(BUILDINGS[publics[k]], 1000 + k * 50, true);
    if (!h?.beds.length) continue;
    bedsSoFar += h.beds.length;
    homes.push({ beds: h.beds, spot: null, inside: h.cells.filter((c) => walkable(grid[c.j][c.i])) });
  }

  // 民房：間數照開局的人口標籤；床位要夠住滿這個標籤最多的人數，不夠時改蓋大房子（2～3 張床）
  const count = def.houses[tag];
  const need = def.residents[tag][1];
  for (let n = 0; homes.length < count && n < count * 2; n++) {
    const left = count - homes.length;
    const short = need - bedsSoFar;
    const big = short > left;
    const b = BUILDINGS[big ? 'big' : 'house'];
    const extra = big ? Math.max(2, Math.min(3, short - (left - 1))) : 0;
    const h = place(b, 2000 + n * 37, false, extra);
    if (!h) {
      if (!big) break;
      continue;
    }
    if (!h.beds.length) continue;
    bedsSoFar += h.beds.length;
    homes.push({ beds: h.beds, spot: h.spot, inside: h.cells.filter((c) => walkable(grid[c.j][c.i])) });
  }
  // 民房蓋不滿、床位還不夠：再找地方蓋大房子（3 張床）補到夠
  for (let n = 0; bedsSoFar < need && n < 6; n++) {
    const h = place(BUILDINGS.big, 2600 + n * 41, false, 3);
    if (!h) break;
    bedsSoFar += h.beds.length;
    homes.push({ beds: h.beds, spot: h.spot, inside: h.cells.filter((c) => walkable(grid[c.j][c.i])) });
  }

  // 巷子：門外不是街，就鋪一條接到最近的街（四方向，只走空地）
  for (const d of doorsOut) lane(d);
  function lane(d) {
    const key = (c) => c.j * W + c.i;
    const prev = new Map([[key(d), -1]]);
    const q = [d];
    for (let h = 0; h < q.length; h++) {
      const c = q[h];
      if (grid[c.j][c.i] === ROAD) {
        for (let k = key(c); k >= 0; k = prev.get(k)) {
          const i = k % W;
          const j = (k - i) / W;
          if (grid[j][i] === GROUND) grid[j][i] = ROAD;
        }
        return;
      }
      for (const [di, dj] of STEPS4) {
        const n = { i: c.i + di, j: c.j + dj };
        const code = get(n.i, n.j);
        if ((code !== GROUND && code !== ROAD) || prev.has(key(n))) continue;
        prev.set(key(n), key(c));
        q.push(n);
      }
    }
  }

  fieldsAndGroves(grid, W, H, kind, rnd, inner);
  // 城鎮廣場外圈擺市場攤位（不擋住街道的口：只放在外圈、兩旁都是廣場的格子）
  if (kind === 'town')
    for (let j = cy - pr; j <= cy + pr; j++)
      for (let i = cx - pr; i <= cx + pr; i++) {
        const d = Math.hypot(i - cx, j - cy);
        if (d < pr - 1.2 || d > pr - 0.4 || (i + j) % 3 || grid[j][i] !== ROAD) continue;
        const ok = STEPS4.every(([di, dj]) => [ROAD, WELL].includes(get(i + di, j + dj)));
        if (ok) set(i, j, 'stall');
      }
  return { grid, w: W, h: H, plaza: { i: cx, j: cy + 1 }, gates: sides, homes };
}

// 田（一排作物、一排泥土）與樹叢：在剩下的空地上找放得下的地方（外圍留一格空地）
function fieldsAndGroves(grid, W, H, kind, rnd, inner) {
  const free = (i, j) => i > 0 && j > 0 && i < W - 1 && j < H - 1 && inner[j * W + i] && grid[j][i] === GROUND;
  const clear = (x, y, w, h) => {
    for (let j = y - 1; j <= y + h; j++) for (let i = x - 1; i <= x + w; i++) if (!free(i, j)) return false;
    return true;
  };
  const tryPlace = (w, h, salt, fill) => {
    for (let t = 0; t < 200; t++) {
      const x = 1 + Math.floor(rnd(salt + t * 2) * (W - w - 2));
      const y = 1 + Math.floor(rnd(salt + t * 2 + 1) * (H - h - 2));
      if (!clear(x, y, w, h)) continue;
      fill(x, y);
      return true;
    }
    return false;
  };
  const [flo, fhi] = FIELDS[kind];
  const fields = flo + Math.floor(rnd(70) * (fhi - flo + 1));
  for (let f = 0; f < fields; f++) {
    const w = 6 + Math.floor(rnd(71 + f) * 5);
    const h = 3 + Math.floor(rnd(81 + f) * 3);
    tryPlace(w, h, 3000 + f * 400, (x, y) => {
      for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) grid[j][i] = (j - y) % 2 ? FIELD : 'crops';
    });
  }
  const [glo, ghi] = GROVES[kind];
  const groves = glo + Math.floor(rnd(90) * (ghi - glo + 1));
  for (let g = 0; g < groves; g++) {
    const tree = GROVE_TREES[Math.floor(rnd(91 + g) * GROVE_TREES.length)];
    tryPlace(4, 3, 5000 + g * 400, (x, y) => {
      for (let j = y; j < y + 3; j++)
        for (let i = x; i < x + 4; i++) if ((i + j) % 2 === 0 && rnd(6000 + i * 17 + j) < 0.8) grid[j][i] = tree;
    });
  }
}
