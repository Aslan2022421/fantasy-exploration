// 堡壘、要塞的固定圖樣（交辦 4，照舊專案 old-v37.1 的 js/plans.js 搬過來，使用者照 Claude 的表定）：
// - 堡壘 45×29：四角塔樓（裡面有樓梯 X）、兩座城門（╪，3 格寬）各夾兩座門樓、主堡（寶座、祭壇）、兵營（10 張床）、
//   工坊（鐵砧、箱子、木桶）、井；兩側那欄 █ 是山壁，把隘口封住，只能從城門穿過
// - 要塞 45×58：兩座堡壘併起來，中間一道隔牆、一道內門
// - 城門朝路：圖樣的城門原本在南北，路是東西向的就轉 90 度
// 圖樣的字：W 外牆與建築的牆、, 室內地板、. 庭院、· 路、+ 門、X 樓梯、╪ 城門、O 井、≡ 床、π 桌、╥ 椅（寶座）、¤ 祭壇、
// ╤ 鐵砧、÷ 木桶、Æ 箱子、█ 山壁、空白是外面（保留原本的地形）

import { BED, GROUND, INDOOR, KEEP, ROAD, WELL, walkable } from './settle-codes.js';

const FORT_HALF = [
  '█WWWWW          WWWWW···WWWWW          WWWWW█',
  '█W,,,W          W,,,W···W,,,W          W,,,W█',
  '█W,X,WWWWWWWWWWWW,X,W╪╪╪W,X,WWWWWWWWWWWW,X,W█',
  '█W,,,W..........W,,,W···W,,,W..........W,,,W█',
  '█WWW+W..........W+WWW···W+WWW..........W+WWW█',
  '███W.................···.................W███',
  '███W.................···.................W███',
  '███W.................···..WWWWWWWWWWWWW..W███',
  '███W.W+WWWWWWWWWWW...···..W,≡,≡,≡,≡,≡,W..W███',
  '███W.W,,,W,,,,,,,W...···..W,,,,,,,,,,,W..W███',
  '███W.W,X,W,,,π╥,,W...···..+,,,,,,,,,,,W..W███',
  '███W.W,,,W,,,,,,,W...···..W,,,,,,,,,,,W..W███',
  '███W.WWWWW,,,,,,,W...···..W,≡,≡,≡,≡,≡,W..W███',
  '███W.W,,,,,,,,,,,+...···..WWWWWWWWWWWWW..W███',
  '███W.W,,,,,,,,,,,W...···.................W███',
  '███W.W,,,,,,,,,,,W...···.................W███',
  '███W.W,,,,,¤,,,,,W...···..WWWWWWWWW+WWW..W███',
  '███W.W,,,,,,,,,,,W...···..W,,,,,W,,,,,W..W███',
  '███W.WWWWWWWWWWWWW...···..W,,╤,,W,,╤,,W..W███',
  '███W.................···..+,,,,,W,Æ,,,W..W███',
  '███W.................···..W,,,,,W,,,Æ,W..W███',
  '███W...............O.···..W,,,÷,W,,,,,W..W███',
  '███W.................···..WWWWWWWWWWWWW..W███',
  '███W.................···.................W███',
];
const FORT_GATE = [
  '█WWW+W..........W+WWW···W+WWW..........W+WWW█',
  '█W,,,W..........W,,,W···W,,,W..........W,,,W█',
  '█W,X,WWWWWWWWWWWW,X,W╪╪╪W,X,WWWWWWWWWWWW,X,W█',
  '█W,,,W          W,,,W···W,,,W          W,,,W█',
  '█WWWWW          WWWWW···WWWWW          WWWWW█',
];
// 要塞中間的隔牆（兩座堡壘併起來的地方，內門在中間）
const FORTRESS_MID = [
  '███W.................···.................W███',
  '███W.................···.................W███',
  '█WWW+W..........W+WWW···W+WWW..........W+WWW█',
  '█W,,,W..........W,,,W···W,,,W..........W,,,W█',
  '█W,X,WWWWWWWWWWWW,X,W╪╪╪W,X,WWWWWWWWWWWW,X,W█',
  '█W,,,W..........W,,,W···W,,,W..........W,,,W█',
  '█WWWWW..........WWWWW···WWWWW..........WWWWW█',
  '███W.................···.................W███',
  '███W.................···.................W███',
  '███W.................···.................W███',
  '███W.................···.................W███',
  '███W.................···.................W███',
];

export const FORT_ROWS = {
  fort: [...FORT_HALF, ...FORT_GATE],
  fortress: [...FORT_HALF, ...FORTRESS_MID, ...FORT_HALF.slice(7), ...FORT_GATE],
};

// 圖樣的字 → 格子的代碼（W 換成這種聚落的牆）
const CODE = {
  ',': INDOOR,
  '.': GROUND,
  '·': ROAD,
  '+': 'stone-door',
  X: 'stairs',
  '╪': 'fort-gate',
  O: WELL,
  '≡': BED,
  π: 'table',
  '╥': 'chair',
  '¤': 'altar',
  '╤': 'anvil',
  '÷': 'barrel',
  Æ: 'crate',
  '█': 'rampart-rock',
  ' ': KEEP,
};

// 順時針轉 90 度：(i, j) 搬到 (h - 1 - j, i)
function rotate(rows) {
  const h = rows.length;
  const w = [...rows[0]].length;
  const chars = rows.map((r) => [...r]);
  return Array.from({ length: w }, (_, i) => Array.from({ length: h }, (_, j) => chars[h - 1 - j][i]).join(''));
}

// 兩翼的山壁：從圖樣兩側，沿著跟路垂直的方向往外拉 2 格厚的山壁（舊版：沿堡壘兩側拉山壁封住隘口），
// 前面拉 wing.before 格、後面拉 wing.after 格，碰到水（wing.wet(i, j)，鋪開後的座標）就停
export const WING = 32; // 一側最多拉幾格
function addWings(rows, turn, { before, after, wet }) {
  const grid = rows.map((r) => [...r]);
  const H = grid.length;
  const W = grid[0].length;
  if (!turn) {
    // 路南北向：往東西兩側拉
    const out = grid.map((r) => [...' '.repeat(before), ...r, ...' '.repeat(after)]);
    for (const j of [H >> 1, (H >> 1) + 1]) {
      for (let i = before - 1; i >= 0 && !wet(i, j); i--) out[j][i] = '█';
      for (let i = before + W; i < before + W + after && !wet(i, j); i++) out[j][i] = '█';
    }
    return out.map((r) => r.join(''));
  }
  // 路東西向：往南北兩側拉
  const blank = () => [...' '.repeat(W)];
  const out = [...Array.from({ length: before }, blank), ...grid, ...Array.from({ length: after }, blank)];
  for (const i of [W >> 1, (W >> 1) + 1]) {
    for (let j = before - 1; j >= 0 && !wet(i, j); j--) out[j][i] = '█';
    for (let j = before + H; j < before + H + after && !wet(i, j); j++) out[j][i] = '█';
  }
  return out.map((r) => r.join(''));
}

// def：聚落資料（layout 是 'fort' 或 'fortress'）；turn：路是東西向的就轉 90 度（城門朝東西）；wing：兩翼的山壁（addWings）
// 回傳跟 settle-layouts.js 一樣的圖樣 { grid, w, h, plaza, gates, homes, form }
export function buildFort(def, turn, wing = null) {
  let rows = FORT_ROWS[def.layout];
  if (turn) rows = rotate(rows);
  if (wing) rows = addWings(rows, turn, wing);
  const H = rows.length;
  const W = [...rows[0]].length;
  const grid = rows.map((r) => [...r].map((ch) => (ch === 'W' ? def.wall : CODE[ch])));
  // 城門：一排 ╪ 的中間那格，往圖樣外的方向（離邊近的那一邊）
  const gates = [];
  const seen = new Set();
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      if (grid[j][i] !== 'fort-gate' || seen.has(`${i},${j}`)) continue;
      const run = [];
      for (let k = 0; grid[j + (turn ? k : 0)]?.[i + (turn ? 0 : k)] === 'fort-gate'; k++) {
        const c = turn ? [i, j + k] : [i + k, j];
        run.push(c);
        seen.add(`${c[0]},${c[1]}`);
      }
      const [gi, gj] = run[run.length >> 1];
      // 圖樣中間那道內門不算出入口（兩邊都在圖樣裡）
      const [di, dj] = turn ? [gi < W / 2 ? -1 : 1, 0] : [0, gj < H / 2 ? -1 : 1];
      const edgeDist = turn ? (di < 0 ? gi : W - 1 - gi) : dj < 0 ? gj : H - 1 - gj;
      if (edgeDist > 4) continue;
      const out = { i: gi + di * (edgeDist + 1), j: gj + dj * (edgeDist + 1) };
      gates.push({ angle: Math.atan2(dj, di), i: gi, j: gj, di, dj, out });
    }
  // 住的人：兵營（兩張床以上的房間）的床；廣場是井南邊一格
  const homes = [];
  const room = new Set();
  let plaza = null;
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      if (grid[j][i] === WELL) plaza = { i, j: j + 1 };
      if (grid[j][i] !== BED || room.has(`${i},${j}`)) continue;
      // 這張床所在的房間（室內能走的格子連在一起）
      const cells = [{ i, j }];
      room.add(`${i},${j}`);
      for (let h = 0; h < cells.length; h++)
        for (const [di, dj] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const n = { i: cells[h].i + di, j: cells[h].j + dj };
          const code = grid[n.j]?.[n.i];
          if (room.has(`${n.i},${n.j}`) || !code || ![INDOOR, BED, 'chair'].includes(code)) continue;
          room.add(`${n.i},${n.j}`);
          cells.push(n);
        }
      const beds = cells.filter((c) => grid[c.j][c.i] === BED);
      homes.push({ beds, spot: null, inside: cells.filter((c) => walkable(grid[c.j][c.i])) });
    }
  return { grid, w: W, h: H, plaza: plaza ?? { i: W >> 1, j: H >> 1 }, gates, homes, form: def.layout };
}
