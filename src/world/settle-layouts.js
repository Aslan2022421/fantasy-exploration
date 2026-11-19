// 聚落的圖樣（照舊專案第三十二版起的排法，見 design/PLAN.md「聚落」）：
// - 先在工作範圍（村莊 29×19、城鎮 45×29）裡排廣場、大路、小巷與建築，再沿著「路＋廣場＋建築」的外緣留一格走道，
//   走道外面一圈蓋外牆；外牆跟著建築凹凸，圍起來的零碎空地都算在裡面。牆外保留原本的地形
// - 出入口每個寬 3 格，開在四邊正中，大路從廣場直通出去（外牆在大路兩側斷開）
// - 中央小廣場，正中一口井；城鎮另有小巷（上下各一條橫的、左右各一條直的）
// - 建築的室內是長方形：民房 3×2（床、櫃子、椅子）、大房子 4×3（住 2～3 人，床另外加，多一張桌子）、
//   神殿 5×3（祭壇、椅子）、市場 5×2（兩個門、三個攤位、木桶）。門開在靠路那一邊，門內那一格空著，
//   擋路的家具不把室內切開。民房的床位不夠住滿時改蓋大房子
// 每格是一個代碼：GROUND（聚落裡的空地）、ROAD（路）、INDOOR（室內地板）、KEEP（牆外，保留原本的地形）或物件的 id。
// 只看種子＋錨點的雜湊與呼叫的人給的「哪幾邊能開出入口」，不看生成順序

import { hash01 } from './noise.js';
import { BED, BLOCKING, GROUND, INDOOR, ROAD, WELL, walkable } from './settle-codes.js';
import { connected, enclose, gateOut, keepUsedRoads } from './settle-walls.js';

export * from './settle-codes.js';
export { reachable } from './settle-walls.js';

const PLAZA = { village: [3, 2], town: [4, 3] }; // 廣場往左右、上下各幾格
const ROAD_LEN = { village: [10, 5], town: [18, 10] }; // 大路從中央往東西、南北鋪幾格
// 建築：牆的物件、室內寬高、門數、家具；spot 是住戶站的格子（貼著門內那一格）
const BUILDINGS = {
  house: { wall: 'house', w: 3, h: 2, doors: 1, spot: true, items: ['bed', 'cabinet', 'chair'] },
  big: { wall: 'house', w: 4, h: 3, doors: 1, items: ['table', 'cabinet', 'chair', 'chair'] },
  temple: { wall: 'temple', w: 5, h: 3, doors: 1, items: ['altar', 'chair', 'chair'] },
  market: { wall: 'market', w: 5, h: 2, doors: 2, items: ['stall', 'stall', 'stall', 'barrel'] },
};

// def：聚落資料；tag：開局的人口標籤（0～4，決定民房幾間）；canOpen(side)：那一邊外面能不能開出入口（不朝湖開）。
// 開不出 3 個出入口回傳 null
export function buildSettlement(def, seed, x0, y0, tag, canOpen) {
  const W = def.w;
  const H = def.h;
  const cx = W >> 1;
  const cy = H >> 1;
  const r = (k) => hash01(seed, x0, y0, 9200 + k);
  const grid = Array.from({ length: H }, () => Array(W).fill(GROUND));
  const set = (i, j, code) => {
    grid[j][i] = code;
  };
  const door = def.id === 'village' ? 'door' : 'stone-door'; // 村莊木門、城鎮石門

  // 出入口：東西兩邊優先，南北的順序照雜湊；數量照資料的範圍擲
  const [glo, ghi] = def.gates;
  const want = glo + Math.floor(r(1) * (ghi - glo + 1));
  const order = r(2) < 0.5 ? ['west', 'east', 'north', 'south'] : ['west', 'east', 'south', 'north'];
  const gates = order.filter((s) => canOpen(s)).slice(0, want);
  if (gates.length < Math.min(3, want)) return null;

  // 廣場與井
  const [px, py] = PLAZA[def.id] ?? PLAZA.village;
  for (let j = cy - py; j <= cy + py; j++) for (let i = cx - px; i <= cx + px; i++) set(i, j, ROAD);
  set(cx, cy, WELL);

  // 大路：3 格寬，從中央往出入口那一邊鋪固定長度（舊版：村莊東西 10、南北 5，城鎮 18、10），
  // 外牆圍好之後再從路的盡頭往外打通（gateOut）
  const [ex, ey] = ROAD_LEN[def.id] ?? ROAD_LEN.village;
  for (const side of gates) {
    if (side === 'west' || side === 'east') {
      const [a, b] = side === 'west' ? [cx - ex, cx] : [cx, cx + ex];
      for (let i = a; i <= b; i++) for (let j = cy - 1; j <= cy + 1; j++) set(i, j, ROAD);
    } else {
      const [a, b] = side === 'north' ? [cy - ey, cy] : [cy, cy + ey];
      for (let j = a; j <= b; j++) for (let i = cx - 1; i <= cx + 1; i++) set(i, j, ROAD);
    }
  }
  set(cx, cy, WELL);
  const main = new Set(); // 大路與廣場的格子
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (grid[j][i] === ROAD) main.add(`${i},${j}`);

  // 城鎮的小巷：上下各一條橫的、左右各一條直的（1 格寬，在大路的範圍裡）；蓋完建築後只留用得到的那一段
  if (def.id === 'town') {
    const ys = [Math.round((cy - py) / 2), H - 1 - Math.round((cy - py) / 2)];
    const xs = [Math.round((cx - px) / 2), W - 1 - Math.round((cx - px) / 2)];
    for (const j of ys) for (let i = cx - ex; i <= cx + ex; i++) if (grid[j][i] === GROUND) set(i, j, ROAD);
    for (const i of xs) for (let j = cy - ey; j <= cy + ey; j++) if (grid[j][i] === GROUND) set(i, j, ROAD);
  }

  // 一棟建築（外框 w×h）能不能放在 (hx, hy)：外框裡都是空地，離工作範圍的邊至少 2 格（留走道與外牆）；
  // 周圍一圈不是別的建築（路可以）
  const taken = new Set();
  const doorsOut = []; // 每道門外面那一格
  const fits = (hx, hy, w, h) => {
    if (hx < 2 || hy < 2 || hx + w > W - 2 || hy + h > H - 2) return false;
    for (let j = hy - 1; j <= hy + h; j++)
      for (let i = hx - 1; i <= hx + w; i++) {
        const inner = i >= hx && i < hx + w && j >= hy && j < hy + h;
        if (inner && grid[j][i] !== GROUND) return false;
        if (!inner && taken.has(`${i},${j}`)) return false;
      }
    return true;
  };
  const roadGap = (hx, hy, w, h) => {
    let best = 99;
    for (let j = 0; j < H; j++)
      for (let i = 0; i < W; i++) {
        if (grid[j][i] !== ROAD) continue;
        const d = Math.max(Math.max(hx - i, 0, i - (hx + w - 1)), Math.max(hy - j, 0, j - (hy + h - 1)));
        if (d < best) best = d;
      }
    return best;
  };
  // 候選位置：貼著路的優先，再照離廣場近、雜湊排（建築擠在中間，外牆才圍得緊）
  const spots = (w, h, salt) => {
    const out = [];
    for (let hy = 2; hy + h <= H - 2; hy++)
      for (let hx = 2; hx + w <= W - 2; hx++) {
        const gap = roadGap(hx, hy, w, h);
        const far = Math.abs(hx + w / 2 - cx) + Math.abs(hy + h / 2 - cy);
        out.push({ hx, hy, key: Math.min(gap, 4) * 1000 + far + hash01(seed, x0 + hx, y0 + hy, salt) });
      }
    return out.sort((a, b) => a.key - b.key);
  };

  // 蓋一棟：牆、室內、門（開在靠路那一邊正中；doors 2 時對邊再開一個）、家具。beds 是另外加幾張床
  const build = (hx, hy, b, beds, salt) => {
    const w = b.w + 2;
    const h = b.h + 2;
    for (let j = hy; j < hy + h; j++)
      for (let i = hx; i < hx + w; i++) {
        const edge = i === hx || j === hy || i === hx + w - 1 || j === hy + h - 1;
        set(i, j, edge ? b.wall : INDOOR);
        taken.add(`${i},${j}`);
      }
    const mids = [
      { side: 'north', i: hx + (w >> 1), j: hy, oi: 0, oj: -1 },
      { side: 'south', i: hx + (w >> 1), j: hy + h - 1, oi: 0, oj: 1 },
      { side: 'west', i: hx, j: hy + ((h - 1) >> 1), oi: -1, oj: 0 },
      { side: 'east', i: hx + w - 1, j: hy + ((h - 1) >> 1), oi: 1, oj: 0 },
    ];
    const outside = (m) => grid[m.j + m.oj][m.i + m.oi];
    mids.sort((a, c) => (outside(a) === ROAD ? 0 : 1) - (outside(c) === ROAD ? 0 : 1));
    const opp = { north: 'south', south: 'north', west: 'east', east: 'west' };
    const chosen = [mids[0]];
    if (b.doors > 1) chosen.push(mids.find((m) => m.side === opp[mids[0].side]));
    for (const m of chosen) {
      set(m.i, m.j, door);
      doorsOut.push({ i: m.i + m.oi, j: m.j + m.oj });
    }
    const inners = chosen.map((m) => ({ i: m.i - m.oi, j: m.j - m.oj })); // 門內那一格
    const cells = [];
    for (let j = hy + 1; j < hy + h - 1; j++) for (let i = hx + 1; i < hx + w - 1; i++) cells.push({ i, j });
    return { cells, ...furnish(cells, inners, b, beds, salt) };
  };

  // 擺家具：門內那一格空著，站人的格子貼著它，擋路的家具不把室內切開（照雜湊試幾種擺法）
  const furnish = (cells, inners, b, beds, salt) => {
    const key = (c) => `${c.i},${c.j}`;
    const isInner = (c) => inners.some((d) => d.i === c.i && d.j === c.j);
    const items = [...b.items, ...Array(beds).fill(BED)];
    for (let t = 0; t < 40; t++) {
      const free = cells
        .filter((c) => !isInner(c))
        .map((c) => ({ c, k: hash01(seed, x0 + c.i, y0 + c.j, salt + t) }))
        .sort((a, c) => a.k - c.k)
        .map((o) => o.c);
      let spot = null;
      if (b.spot) {
        const i = free.findIndex((c) => inners.some((d) => Math.abs(c.i - d.i) + Math.abs(c.j - d.j) === 1));
        if (i < 0) break;
        spot = free.splice(i, 1)[0];
      }
      if (free.length < items.length) break;
      const placed = items.map((code, i) => ({ ...free[i], code }));
      const blocked = new Set(placed.filter((p) => BLOCKING.has(p.code)).map(key));
      const open = cells.filter((c) => !blocked.has(key(c)));
      if (!connected(open)) continue;
      for (const p of placed) set(p.i, p.j, p.code);
      return { spot, beds: placed.filter((p) => p.code === BED).map(({ i, j }) => ({ i, j })) };
    }
    return { spot: null, beds: [] };
  };

  // 城鎮的公共建築（神殿或市場），蓋在最靠近廣場的位置
  let hall = null;
  if (def.halls?.length) {
    const kind = def.halls[Math.floor(r(3) * def.halls.length)];
    const b = BUILDINGS[kind];
    const at = spots(b.w + 2, b.h + 2, 9230).find((s) => fits(s.hx, s.hy, b.w + 2, b.h + 2));
    if (at) {
      build(at.hx, at.hy, b, 0, 9235);
      hall = { kind, x: at.hx, y: at.hy, w: b.w + 2, h: b.h + 2 };
    }
  }

  // 民房：間數照開局的人口標籤；床位要夠住滿這個標籤最多的人數，不夠時改蓋大房子（2～3 張床）
  const homes = [];
  const count = def.houses[tag];
  const need = def.residents[tag][1];
  let bedsSoFar = 0;
  for (const kind of ['big', 'house']) {
    const b = BUILDINGS[kind];
    for (const s of spots(b.w + 2, b.h + 2, 9240)) {
      if (homes.length >= count) break;
      const left = count - homes.length;
      const short = need - bedsSoFar;
      if (kind === 'big' && short <= left) break; // 剩下的每間一張床就夠了
      if (!fits(s.hx, s.hy, b.w + 2, b.h + 2)) continue;
      const extra = kind === 'big' ? Math.max(2, Math.min(3, short - (left - 1))) : 0;
      const h = build(s.hx, s.hy, b, extra, 9250 + homes.length * 50);
      if (!h.beds.length) continue;
      bedsSoFar += h.beds.length;
      homes.push({ beds: h.beds, spot: h.spot, inside: h.cells.filter((c) => walkable(grid[c.j][c.i])) });
    }
  }

  keepUsedRoads(grid, W, H, main, doorsOut);
  enclose(grid, W, H, def.wall);
  gateOut(grid, W, H, gates, cx, cy);
  return { grid, w: W, h: H, plaza: { i: cx, j: cy + 1 }, gates, homes, hall };
}
