// 聚落的圖樣（舊專案的排法簡化，見 design/PLAN.md「聚落」）：
// - 外牆沿整塊圖樣的外框（村莊木牆、城鎮石牆，畫的時候接成框）；出入口每個寬 3 格，開在四邊正中間
// - 中央小廣場，正中一口井；3 格寬的大路從廣場通到每個出入口；城鎮另有小巷（上下各一條橫的、左右各一條直的）
// - 民房：外框 5×4、室內 3×2，牆不貼外牆（留一格走道）、彼此不相貼；門開在靠路那一邊，室內放床與桌子
// - 城鎮另有一座神殿或市場（只是建築）
// 每格是一個代碼：GROUND（整平的泥土）、ROAD（路）、INDOOR（室內木地板）或物件的 id。
// 只看種子＋錨點的雜湊與呼叫的人給的「哪幾邊能開出入口」，不看生成順序

import { hash01 } from './noise.js';

export const GROUND = 'ground';
export const ROAD = 'road';
export const INDOOR = 'indoor';
export const WELL = 'town-well';
export const DOOR = 'door';
export const BED = 'bed';
export const TABLE = 'table';
const HOUSE = 'house';

// 走得過去的代碼
const WALKABLE = new Set([GROUND, ROAD, INDOOR, DOOR, BED]);
export const walkable = (code) => WALKABLE.has(code);

const PLAZA = { village: [3, 2], town: [4, 3] }; // 廣場往左右、上下各幾格
const HOUSE_SIZE = { w: 5, h: 4 };
const HALL_SIZE = { temple: { w: 6, h: 5, doors: 1 }, market: { w: 7, h: 4, doors: 2 } };

// def：聚落資料；tag：開局的人口標籤（0～4，決定民房幾間）；canOpen(side)：那一邊外面能不能開出入口（不朝湖開）。
// 開不出最少的出入口數（村莊 3、城鎮 3）回傳 null
export function buildSettlement(def, seed, x0, y0, tag, canOpen) {
  const W = def.w;
  const H = def.h;
  const cx = W >> 1;
  const cy = H >> 1;
  const r = (k) => hash01(seed, x0, y0, 9200 + k);
  const grid = Array.from({ length: H }, (_, j) =>
    Array.from({ length: W }, (_, i) => (i === 0 || j === 0 || i === W - 1 || j === H - 1 ? def.wall : GROUND)),
  );
  const set = (i, j, code) => {
    grid[j][i] = code;
  };

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

  // 大路：3 格寬，從廣場通到出入口（連同牆上那 3 格）
  for (const side of gates) {
    if (side === 'west' || side === 'east') {
      const [a, b] = side === 'west' ? [0, cx - px] : [cx + px, W - 1];
      for (let i = a; i <= b; i++) for (let j = cy - 1; j <= cy + 1; j++) set(i, j, ROAD);
    } else {
      const [a, b] = side === 'north' ? [0, cy - py] : [cy + py, H - 1];
      for (let j = a; j <= b; j++) for (let i = cx - 1; i <= cx + 1; i++) set(i, j, ROAD);
    }
  }

  // 城鎮的小巷：上下各一條橫的、左右各一條直的（1 格寬，不碰外牆的走道）
  if (def.id === 'town') {
    const ys = [Math.round((cy - py) / 2), H - 1 - Math.round((cy - py) / 2)];
    const xs = [Math.round((cx - px) / 2), W - 1 - Math.round((cx - px) / 2)];
    for (const j of ys) for (let i = 2; i < W - 2; i++) if (grid[j][i] === GROUND) set(i, j, ROAD);
    for (const i of xs) for (let j = 2; j < H - 2; j++) if (grid[j][i] === GROUND) set(i, j, ROAD);
  }

  // 一棟建築能不能放在 (hx, hy)：外框裡都是空地、不貼外牆；周圍一圈不是別的建築或外牆（路可以）
  const taken = new Set(); // 建築佔的格子
  const fits = (hx, hy, w, h) => {
    if (hx < 2 || hy < 2 || hx + w > W - 2 || hy + h > H - 2) return false;
    for (let j = hy - 1; j <= hy + h; j++)
      for (let i = hx - 1; i <= hx + w; i++) {
        const inner = i >= hx && i < hx + w && j >= hy && j < hy + h;
        if (inner && grid[j][i] !== GROUND) return false;
        if (!inner && (taken.has(`${i},${j}`) || grid[j][i] === def.wall)) return false;
      }
    return true;
  };
  // 離最近的路幾格（外框貼著路是 1）
  const roadGap = (hx, hy, w, h) => {
    let best = 99;
    for (let j = 1; j < H - 1; j++)
      for (let i = 1; i < W - 1; i++) {
        if (grid[j][i] !== ROAD) continue;
        const d = Math.max(Math.max(hx - i, 0, i - (hx + w - 1)), Math.max(hy - j, 0, j - (hy + h - 1)));
        if (d < best) best = d;
      }
    return best;
  };
  // 候選位置：貼著路的優先，再照離廣場近、雜湊排
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

  // 蓋一棟：牆、室內、門（開在靠路的那一邊正中；doors 2 時對邊再開一個）
  const build = (hx, hy, w, h, wall, doors) => {
    for (let j = hy; j < hy + h; j++)
      for (let i = hx; i < hx + w; i++) {
        const edge = i === hx || j === hy || i === hx + w - 1 || j === hy + h - 1;
        set(i, j, edge ? wall : INDOOR);
        taken.add(`${i},${j}`);
      }
    const mids = [
      { side: 'north', i: hx + (w >> 1), j: hy, oi: 0, oj: -1 },
      { side: 'south', i: hx + (w >> 1), j: hy + h - 1, oi: 0, oj: 1 },
      { side: 'west', i: hx, j: hy + ((h - 1) >> 1), oi: -1, oj: 0 },
      { side: 'east', i: hx + w - 1, j: hy + ((h - 1) >> 1), oi: 1, oj: 0 },
    ];
    const outside = (m) => grid[m.j + m.oj][m.i + m.oi];
    mids.sort((a, b) => (outside(a) === ROAD ? 0 : 1) - (outside(b) === ROAD ? 0 : 1));
    const opp = { north: 'south', south: 'north', west: 'east', east: 'west' };
    const chosen = [mids[0]];
    if (doors > 1) chosen.push(mids.find((m) => m.side === opp[mids[0].side]));
    for (const m of chosen) set(m.i, m.j, DOOR);
    return chosen.map((m) => ({ i: m.i, j: m.j, in: { i: m.i - m.oi, j: m.j - m.oj } }));
  };

  // 城鎮的公共建築（神殿或市場），蓋在最靠近廣場的位置
  let hall = null;
  if (def.halls?.length) {
    const kind = def.halls[Math.floor(r(3) * def.halls.length)];
    const { w, h, doors } = HALL_SIZE[kind];
    const at = spots(w, h, 9230).find((s) => fits(s.hx, s.hy, w, h));
    if (at) {
      build(at.hx, at.hy, w, h, kind, doors);
      hall = { kind, x: at.hx, y: at.hy, w, h };
    }
  }

  // 民房：間數照開局的人口標籤
  const homes = [];
  const want2 = def.houses[tag];
  const { w: hw, h: hh } = HOUSE_SIZE;
  for (const s of spots(hw, hh, 9240)) {
    if (homes.length >= want2) break;
    if (!fits(s.hx, s.hy, hw, hh)) continue;
    const [door] = build(s.hx, s.hy, hw, hh, HOUSE, 1);
    // 室內：門內那格空著，離門最遠的放床，其次放桌子
    const inside = [];
    for (let j = s.hy + 1; j < s.hy + hh - 1; j++) for (let i = s.hx + 1; i < s.hx + hw - 1; i++) inside.push({ i, j });
    const far = (c) => Math.max(Math.abs(c.i - door.in.i), Math.abs(c.j - door.in.j));
    const ranked = [...inside].sort((a, b) => far(b) - far(a) || a.j - b.j || a.i - b.i);
    const bed = ranked[0];
    set(bed.i, bed.j, BED);
    set(ranked[1].i, ranked[1].j, TABLE);
    homes.push({ door: { i: door.i, j: door.j }, bed, inside: inside.filter((c) => grid[c.j][c.i] !== TABLE) });
  }

  return { grid, w: W, h: H, plaza: { i: cx, j: cy + 1 }, gates, homes, hall };
}

// 圖樣裡從廣場走得到的格子（測試與村民走路用）：廣度優先，八方向
export function reachable(layout, from = layout.plaza) {
  const seen = new Set([`${from.i},${from.j}`]);
  const queue = [from];
  for (let q = 0; q < queue.length; q++) {
    const c = queue[q];
    for (let dj = -1; dj <= 1; dj++)
      for (let di = -1; di <= 1; di++) {
        const i = c.i + di;
        const j = c.j + dj;
        const key = `${i},${j}`;
        if (seen.has(key) || i < 0 || j < 0 || i >= layout.w || j >= layout.h) continue;
        if (!walkable(layout.grid[j][i])) continue;
        seen.add(key);
        queue.push({ i, j });
      }
  }
  return seen;
}
