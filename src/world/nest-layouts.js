// 據點中心的圖樣（C 做法：中心放物件、周圍換色）。每格是一個代碼：
// - 物件的 id（data/object/nest.json，擋不擋路、疊幾層照物件資料）
// - FLOOR：地面整平成據點的地（堡壘是石板地，其餘是泥土），生態覆蓋拿掉；REEDS：泥土上長蘆葦；其他地面代碼見 nest-sites.js
// - KEEP：保留原本的地形
// 廢棄的堡壘照舊專案的堡壘廢墟圖樣（39×25，使用者在第三十四版定的），再弄得更破爛：
// 南邊城門的一座門樓塌掉、兵營沒了屋頂只剩斷牆、庭院多散一些碎片；寶箱放在主堡裡。
// 墓地（29×19）與陰暗的沼澤（39×25）在 nest-sites.js，照種子＋錨點的雜湊排，不看生成順序

import { CHEST, FLOOR, graveyard, KEEP, SITE_SIZE, swamp } from './nest-sites.js';
import { hash01 } from './noise.js';

export { CAVE, CHEST, FLOOR, KEEP, PATH, POOL, REEDS } from './nest-sites.js';

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
  // 東南角塔整座塌掉：大多是走得過去的碎片與崩牆，只剩幾截斷牆
  [34, 20, '▓≥▒░▓'],
  [34, 21, '≤░≥▒░'],
  [34, 22, '▒░≤░▓'],
  [34, 23, '▓≤░▒.'],
  [34, 24, '░▒≥▓.'],
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

export const LAYOUT_SIZE = { fort: { w: 39, h: 25 }, ...SITE_SIZE };

// 廢棄的堡壘每處不一樣：照雜湊左右、上下翻轉，再多塌幾段牆（只變成走得過去的崩牆、碎片，不會把路堵死）
function fortVariant(seed, x0, y0) {
  let rows = FORT.map((r) => [...r]);
  if (hash01(seed, x0, y0, 9601) < 0.5) rows = rows.map((r) => r.reverse());
  if (hash01(seed, x0, y0, 9602) < 0.5) rows.reverse();
  return rows.map((r, j) =>
    r.map((c, i) => {
      if (c !== 'ruin-wall') return c;
      const h = hash01(seed, x0 + i, y0 + j, 9603);
      return h < 0.08 ? 'crumbled-wall' : h < 0.13 ? 'rubble' : c;
    }),
  );
}

// 一處據點的圖樣：[列][行] 的代碼；(x0, y0) 是左上角的世界座標（都照它的雜湊排）
export function buildLayout(kind, seed, x0, y0) {
  if (kind === 'fort') return fortVariant(seed, x0, y0);
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
