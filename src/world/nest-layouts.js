// 據點中心的圖樣（C 做法：中心放物件、周圍換色）。每格是一個代碼：
// - 物件的 id（data/object/nest.json，擋不擋路、疊幾層照物件資料）
// - FLOOR：地面整平成據點的地（堡壘是碎石，其餘是泥土），生態覆蓋拿掉；REEDS：泥土上長蘆葦
// - KEEP：保留原本的地形
// 廢棄的堡壘照舊專案的堡壘廢墟圖樣（39×25，使用者在第三十四版定的），再弄得更破爛：
// 南邊城門的一座門樓塌掉、兵營沒了屋頂只剩斷牆、庭院多散一些碎片；寶箱放在主堡裡。
// 墓地、陰暗的沼澤是村莊的大小（29×19），照種子＋錨點的雜湊排，不看生成順序

import { hash01 } from './noise.js';

export const FLOOR = 'floor';
export const REEDS = 'reeds';
export const KEEP = 'keep';
export const CHEST = 'nest-chest';

// 舊專案的堡壘廢墟（old-v37.1 的 js/plans.js）：W 石牆、o 室內地板、X 塔樓的樓梯、+ 門、░ 碎石地的庭院、
// ▓ 斷牆、▒ 崩一半的牆、≥ ≤ 碎片、# 倒下的石柱、O 井、π 桌、╥ 寶座、≡ 床、" 草、. 外面
const OLD_RUIN = [
  'WWWWW.............................WWWWW',
  'WoooW.............................WoooW',
  'WoXoWWW▓▓░≤▓WWWWWWWWWWWWWWWWWWWWWWWoXoW',
  'WoooW░░░░░░░░░░░░░░░░░░░░░░░░░░░░░WoooW',
  'WWW+W░░░░░░░░░░░░░░░░░░░░░░░░░≤░░░W+WWW',
  '..W░░░░░░░░░W+WWWWWWWWWWWWW░░░░░░░░░W..',
  '..W░░≥░░░░░░WoooWoooooooooW░░░░░░░░░W..',
  '..W░░░░░░░░░WoXoWoooooπ╥ooW░░░░░░░░░W..',
  '..W░░░░░░░░░WoooWoooooooooW░░░░░░░░░W..',
  '..W░≤░░░░░░░WWWWWoooooooooW░░░░░░░░░▓..',
  '..W░░░░░░░░░Wooooooo≡oooooW░░░░""░░░▓..',
  '..W░░░░░░░░░Wooooooooooo≡oW░░░░░░░░░░≥.',
  '..W░░░""░░░░Wooooooooooooo▒░░░░░░░░░▒..',
  '..W░░░░░░░░░WWWWWWW+WWWW▓░W░░░░░░░░░▓..',
  '..W░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░W..',
  '..▒░░░░░░░░░░░░░░░░░░░░░░░WWW+WWWW░░W..',
  '..▓░░░░░O░░░░░░░░#░░░░░░░░WooooooW░░W..',
  '..▓░░░░░░░░░░░░░░░░░░≥░░░░WooooooW░░W..',
  '..W░░░░░░##░░░░░░░░░░░░░░░Wo≤ooooW░░W..',
  '..W░░░░░░░░░░░░░░░░░░░░░░░W+WWWWWW░░W..',
  'WWW+W░░░░░░░░W+WWW░░░W+WWW░░░░░░░░▓▓▓▓▓',
  'WoooW░░░░░░░░WoooW░░░WoooW░░░░░░░░▓▓▓▓▓',
  'WoXoWWWWWWWWWWoXoW░░░WoXoWWWWWWWWW▓▓▓▓▓',
  'WoooW........WoooW░≥░WoooW........▓▓▓▓▓',
  'WWWWW........WWWWW░░░WWWWW........▓▓▓▓.',
];

// 更破爛：[x, y, 從這格起往右蓋上的字]
const RUIN_PATCHES = [
  // 南邊城門東側的門樓整座塌掉
  [21, 20, '▓≥▒░▓'],
  [21, 21, '▒░≤░▓'],
  [21, 22, '▓▒░▒▓WW▓▒'],
  [21, 23, '░≤▒░▒'],
  [21, 24, '▓▒▓░▓'],
  // 兵營沒了屋頂，牆崩成斷牆
  [27, 15, '▓▒W░░W▓W'],
  [27, 16, 'W░░≥░░░▒'],
  [27, 17, '▒░░░░≤░W'],
  [27, 18, 'W░≤░░░░▓'],
  [27, 19, 'W░▓▒W▓▒W'],
  // 庭院多散一些碎片與崩牆
  [8, 3, '≥'],
  [20, 4, '▒'],
  [30, 8, '≤'],
  [6, 14, '▒'],
  [24, 16, '≥'],
  [12, 18, '≤'],
  [30, 3, '▓'],
  // 寶箱放在主堡裡，寶座旁邊
  [24, 8, 'Æ'],
];

const FORT_CODE = {
  W: 'ruin-wall',
  '▓': 'broken-wall',
  '▒': 'crumbled-wall',
  '≥': 'rubble',
  '≤': 'rubble-low',
  '#': 'fallen-pillar',
  O: 'well',
  π: 'ruin-table',
  '╥': 'ruin-throne',
  '≡': 'ruin-bed',
  Æ: CHEST,
  o: FLOOR,
  X: FLOOR,
  '+': FLOOR,
  '░': FLOOR,
  '"': KEEP,
  '.': KEEP,
};

export function fortRows() {
  const rows = OLD_RUIN.map((r) => [...r]);
  for (const [x, y, s] of RUIN_PATCHES)
    [...s].forEach((ch, i) => {
      rows[y][x + i] = ch;
    });
  return rows.map((r) => r.join(''));
}

const FORT = fortRows().map((r) => [...r].map((ch) => FORT_CODE[ch]));

export const LAYOUT_SIZE = { fort: { w: 39, h: 25 }, graveyard: { w: 29, h: 19 }, swamp: { w: 29, h: 19 } };

// 墓地：墓碑排成幾排，中間留一條直路一條橫路；四角與邊上零星的枯樹；正中央是石棺（寶箱）
function graveyard(seed, x0, y0) {
  const { w, h } = LAYOUT_SIZE.graveyard;
  const cx = w >> 1;
  const cy = h >> 1;
  const rows = [2, 4, 6, 12, 14, 16];
  const grid = [];
  for (let j = 0; j < h; j++) {
    const row = [];
    for (let i = 0; i < w; i++) {
      const r = hash01(seed, x0 + i, y0 + j, 8101);
      const corner = (i === 0 || i === w - 1) && (j === 0 || j === h - 1);
      const edge = i === 0 || j === 0 || i === w - 1 || j === h - 1;
      let code = FLOOR;
      if (i === cx && j === cy) code = CHEST;
      else if (corner || (edge && r < 0.08)) code = 'dead-tree';
      else if (rows.includes(j) && i % 2 === 0 && i > 1 && i < w - 2 && Math.abs(i - cx) > 1 && r < 0.8)
        code = 'tombstone';
      row.push(code);
    }
    grid.push(row);
  }
  return grid;
}

// 陰暗的沼澤：枯樹散成幾叢、兩三堆骨堆，最大那堆（第一堆）旁邊放寶箱；其餘的泥地四成長蘆葦
function swamp(seed, x0, y0) {
  const { w, h } = LAYOUT_SIZE.swamp;
  const pick = (k, lo, hi) => lo + Math.floor(hash01(seed, x0, y0, 8200 + k) * (hi - lo + 1));
  const clumps = Array.from({ length: 4 }, (_, k) => ({ x: pick(2 * k, 3, w - 4), y: pick(2 * k + 1, 3, h - 4) }));
  const piles = Array.from({ length: 3 }, (_, k) => ({ x: pick(20 + 2 * k, 4, w - 6), y: pick(21 + 2 * k, 3, h - 4) }));
  const grid = [];
  for (let j = 0; j < h; j++) {
    const row = [];
    for (let i = 0; i < w; i++) {
      const r = hash01(seed, x0 + i, y0 + j, 8301);
      let code = r < 0.4 ? REEDS : FLOOR;
      if (clumps.some((c) => Math.max(Math.abs(c.x - i), Math.abs(c.y - j)) <= 2) && r < 0.5) code = 'dead-tree';
      if (piles.some((p) => p.x === i && p.y === j)) code = 'bones';
      else if (piles.some((p, k) => Math.max(Math.abs(p.x - i), Math.abs(p.y - j)) === 1 && r < (k ? 0.3 : 0.6)))
        code = 'bones';
      row.push(code);
    }
    grid.push(row);
  }
  // 寶箱在第一堆骨堆的右邊（那格與它右邊一格空出來，走得到）
  const c = { x: piles[0].x + 2, y: piles[0].y };
  grid[c.y][c.x] = CHEST;
  if (c.x + 1 < w) grid[c.y][c.x + 1] = FLOOR;
  return grid;
}

// 一處據點的圖樣：[列][行] 的代碼；(x0, y0) 是左上角的世界座標（墓地、沼澤照它的雜湊排）
export function buildLayout(kind, seed, x0, y0) {
  if (kind === 'fort') return FORT;
  if (kind === 'graveyard') return graveyard(seed, x0, y0);
  return swamp(seed, x0, y0);
}

// 圖樣裡寶箱的位置（相對左上角）
export function chestIn(grid) {
  for (let j = 0; j < grid.length; j++) {
    const i = grid[j].indexOf(CHEST);
    if (i >= 0) return { i, j };
  }
  return null;
}
