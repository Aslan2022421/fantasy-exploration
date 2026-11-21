// 聚落的圖樣（照使用者給的城鎮示意圖：木柵、瞭望塔、彎彎的街道、大小不一的房子、田、樹叢）：
// 1. 輪廓（外形照地形挑）、出入口（朝道路來的方向）、廣場、街道（settle-shape.js）
// 2. 建築：城鎮先蓋鎮公所、神殿、兵營、鐵匠舖，再來旅店、酒館（村莊夠大才有旅店），最後民房；外框不貼牆、彼此不相貼，
//    貼著街道的位置優先；門開在靠街那一邊，門外不是街就鋪一條巷子接到最近的街；家具照用途擺（settle-furnish.js）。
//    民房的床位不夠住滿時改蓋大房子
// 3. 田（一排作物一排泥土）、樹叢，放在剩下的空地（settle-fields.js）
// 4. 城鎮廣場的外圈擺市場攤位
// 每格是一個代碼：GROUND（聚落裡的空地）、ROAD（街道、巷子、廣場）、INDOOR（室內地板）、FIELD（田裡的泥土）、
// KEEP（牆外，保留原本的地形）、OUTROAD（出入口外的路）或物件的 id。只看種子＋錨點的雜湊與 opts

import { BUILDINGS, PUBLIC } from './settle-buildings.js';
import { BED, GROUND, INDOOR, KEEP, OUTROAD, ROAD, WELL, walkable } from './settle-codes.js';
import { fieldsAndGroves } from './settle-fields.js';
import { furnishRoom } from './settle-furnish.js';
import { gateToward, makeRnd, SHAPE, STEPS4, streetPath, wallShape, widen } from './settle-shape.js';
import { keepPockets, reachable } from './settle-walls.js';

export * from './settle-codes.js';
export { reachable };

const SIDES = { east: 0, south: Math.PI / 2, west: Math.PI, north: -Math.PI / 2 };

// def：聚落資料；tag：開局的人口標籤（0～4）；opts：{ w, h（圖樣大小，長形可能轉成直的）, form 外形, ok（能蓋的格子，
// 照地形的外形用；也擋住出入口外的路）, entries（道路來的角度）, canOpen(side)（沒有路時，那一邊能不能開）}。圍不出來回傳 null
export function buildSettlement(def, seed, x0, y0, tag, opts) {
  const W = opts.w;
  const H = opts.h;
  const rnd = makeRnd(seed, x0, y0);
  // 村莊的牆不照人口縮（人口只決定蓋幾間），城鎮、城市照人口標籤
  const village = def.id === 'village';
  const shape = wallShape(W, H, rnd, opts.form, opts.form === 'terrain' ? opts.ok : null, village ? 4 : tag);
  if (!shape) return null;
  const { inner, ring, cx, cy } = shape;
  const at = (i, j) => j * W + i;
  const grid = Array.from({ length: H }, (_, j) =>
    Array.from({ length: W }, (_, i) => (inner[at(i, j)] ? GROUND : ring[at(i, j)] ? def.wall : KEEP)),
  );
  const set = (i, j, code) => {
    if (i >= 0 && j >= 0 && i < W && j < H) grid[j][i] = code;
  };
  const get = (i, j) => (i >= 0 && j >= 0 && i < W && j < H ? grid[j][i] : null);
  const kind = def.id === 'village' ? 'village' : def.id === 'city' ? 'city' : 'town';
  const door = kind === 'village' ? 'door' : 'stone-door';

  // 出入口：朝道路來的方向；附近沒有路就照雜湊開一個（不朝湖開）。挨得太近的併成一個
  let angles = opts.entries ?? [];
  if (!angles.length) {
    const order = rnd(2) < 0.5 ? ['west', 'east', 'north', 'south'] : ['east', 'south', 'west', 'north'];
    angles = [SIDES[order.find((s) => opts.canOpen(s)) ?? order[0]]];
  }
  const canBuild = (i, j) => !opts.ok || i < 0 || j < 0 || i >= W || j >= H || opts.ok[j * W + i];
  const gates = [];
  for (const a of angles) {
    // 口外那一格是水或陡坡，就往兩旁轉一點再找
    let g = gateToward(shape, W, H, a);
    for (const turn of [0, 0.25, -0.25, 0.5, -0.5, 0.75, -0.75]) {
      const t = gateToward(shape, W, H, a + turn);
      if (!canBuild(t.i + t.di, t.j + t.dj) || !canBuild(t.i + 2 * t.di, t.j + 2 * t.dj)) continue;
      g = t;
      break;
    }
    if (!gates.some((o) => Math.abs(o.i - g.i) + Math.abs(o.j - g.j) < 6)) gates.push(g);
  }

  // 廣場與井
  const pr = SHAPE.plaza[kind];
  for (let j = cy - pr; j <= cy + pr; j++)
    for (let i = cx - pr; i <= cx + pr; i++) if (Math.hypot(i - cx, j - cy) <= pr + 0.3) set(i, j, ROAD);
  set(cx, cy, WELL);

  // 街道與出入口：口 3 格寬，從牆往外打通到圖樣的邊；兩側瞭望塔
  const tower = `${kind}-tower`;
  gates.forEach((g, k) => {
    const from = [cx + Math.round(Math.cos(g.angle) * pr), cy + Math.round(Math.sin(g.angle) * pr)];
    const street = streetPath(from, [g.i, g.j], rnd, 20 + k * 5);
    for (const [i, j] of widen(street, SHAPE.street[kind])) if (inner[at(i, j)] && get(i, j) !== WELL) set(i, j, ROAD);
    // 口往外打通：牆外那段是路，碰到圖樣的邊或不能蓋的格子（水、陡坡）就停；g.out 是路要接到的那一格
    g.out = { i: g.i + g.di, j: g.j + g.dj };
    for (let w = -1; w <= 1; w++)
      for (let d = 0; ; d++) {
        const i = g.i + g.di * d + (g.dj ? w : 0);
        const j = g.j + g.dj * d + (g.di ? w : 0);
        if (i < 0 || j < 0 || i >= W || j >= H) break;
        if (get(i, j) === KEEP && !canBuild(i, j)) break;
        set(i, j, get(i, j) === KEEP ? OUTROAD : ROAD);
        if (w === 0) g.out = { i: i + g.di, j: j + g.dj };
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
  if (kind !== 'village')
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

  // 建築：放得下＝外框都是空地、外圍一圈不是聚落的牆；可以跟別的建築貼著（沿街排成一排），
  // 但四邊的正中間至少有一邊外面是空地或路（門開得出去）
  const taken = new Uint8Array(W * H);
  const free = (i, j) => (get(i, j) === GROUND || get(i, j) === ROAD) && !taken[at(i, j)];
  const fits = (hx, hy, w, h) => {
    for (let j = hy - 1; j <= hy + h; j++)
      for (let i = hx - 1; i <= hx + w; i++) {
        const inside = i >= hx && i < hx + w && j >= hy && j < hy + h;
        const c = get(i, j);
        if (inside && (c !== GROUND || taken[at(i, j)] || doorsOut.some((d) => d.i === i && d.j === j))) return false;
        if (!inside && (c === null || c === def.wall || c === tower || c === KEEP)) return false;
      }
    const mx = hx + (w >> 1);
    const my = hy + ((h - 1) >> 1);
    return free(mx, hy - 1) || free(mx, hy + h) || free(hx - 1, my) || free(hx + w, my);
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
    // 民房的材質：村莊多木屋，城鎮、城市多灰泥與石屋
    const mats = kind === 'village' ? [0, 1, 1, 2] : [0, 2, 2, 3, 3];
    const wall = b.walls ? b.walls[mats[Math.floor(rnd(salt + 7) * mats.length)]] : b.wall;
    for (let j = hy; j < hy + h; j++)
      for (let i = hx; i < hx + w; i++) {
        const edge = i === hx || j === hy || i === hx + w - 1 || j === hy + h - 1;
        set(i, j, edge ? wall : INDOOR);
        taken[at(i, j)] = 1;
      }
    const mids = [
      { i: hx + (w >> 1), j: hy, oi: 0, oj: -1 },
      { i: hx + (w >> 1), j: hy + h - 1, oi: 0, oj: 1 },
      { i: hx, j: hy + ((h - 1) >> 1), oi: -1, oj: 0 },
      { i: hx + w - 1, j: hy + ((h - 1) >> 1), oi: 1, oj: 0 },
    ];
    // 門開在離街道最近、外面沒被別的建築擋住的那一邊
    const toRoad = (m) => (free(m.i + m.oi, m.j + m.oj) ? 0 : 1000) + roadGap(m.i + m.oi, m.j + m.oj, 1, 1);
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

  // 村莊先蓋民房（住得下人最要緊），鐵匠舖、穀倉在民房之後有空間才蓋
  const publics = kind !== 'village' ? PUBLIC[kind] : tag >= 2 ? ['inn'] : [];
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
    // 民房照雜湊挑大小（5×4、6×3、4×3），床位不夠才蓋大房子；放不下就換下一種，連最小的都放不下才停
    const first = Math.floor(rnd(2100 + n * 13) * 3);
    const sizes = big
      ? ['big', 'house2', 'house']
      : [0, 1, 2].map((k) => ['house2', 'house3', 'house'][(first + k) % 3]);
    if (!big) sizes.push('house');
    const extra = big ? Math.max(2, Math.min(4, short - (left - 1))) : 0;
    let h = null;
    for (const size of sizes) {
      // 床位不夠時，民房多放床：小屋多一張，中型多兩張
      const more = size === 'big' ? extra : short > 0 ? (size === 'house' ? 1 : 2) : 0;
      h = place(BUILDINGS[size], 2000 + n * 37, false, more);
      if (h) break;
    }
    if (!h) break;
    if (!h.beds.length) continue;
    bedsSoFar += h.beds.length;
    homes.push({ beds: h.beds, spot: h.spot, inside: h.cells.filter((c) => walkable(grid[c.j][c.i])) });
  }
  // 民房蓋不滿、床位還不夠：再找地方蓋大房子（3 張床）補到夠，放不下就退到中型（2 張）、小屋
  for (let n = 0; bedsSoFar < need && n < 8; n++) {
    let h = null;
    for (const [size, more] of [
      ['big', 4],
      ['house2', 1],
      ['house3', 1],
      ['house', 1],
    ]) {
      h = place(BUILDINGS[size], 2600 + n * 41, false, more);
      if (h) break;
    }
    if (!h) break;
    bedsSoFar += h.beds.length;
    homes.push({ beds: h.beds, spot: h.spot, inside: h.cells.filter((c) => walkable(grid[c.j][c.i])) });
  }

  if (kind === 'village')
    PUBLIC.village.forEach((b, k) => {
      place(BUILDINGS[b], 3000 + k * 53, true);
    });

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
  if (kind !== 'village')
    for (let j = cy - pr; j <= cy + pr; j++)
      for (let i = cx - pr; i <= cx + pr; i++) {
        const d = Math.hypot(i - cx, j - cy);
        if (d < pr - 1.2 || d > pr - 0.4 || (i + j) % 3 || grid[j][i] !== ROAD) continue;
        const ok = STEPS4.every(([di, dj]) => [ROAD, WELL].includes(get(i + di, j + dj)));
        if (ok) set(i, j, 'stall');
      }
  return keepPockets({ grid, w: W, h: H, plaza: { i: cx, j: cy + 1 }, gates, homes, form: opts.form });
}
