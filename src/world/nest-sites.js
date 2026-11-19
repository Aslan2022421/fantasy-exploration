// 墓地與陰暗的沼澤的圖樣（nest-layouts.js 用；堡壘照舊專案的圖樣，在 nest-layouts.js）。
// 每格是一個代碼：物件的 id，或下面這幾種地面：
// - FLOOR：整平成據點的地（墓地是光禿的泥土、沼澤是泥土）；REEDS：泥土上長蘆葦
// - PATH：路；POOL：沼澤積水（走得過去）；CAVE：洞窟地面；KEEP：保留原本的地形
// 照種子＋錨點的雜湊排，不看生成順序

import { hash01 } from './noise.js';

export const FLOOR = 'floor';
export const REEDS = 'reeds';
export const KEEP = 'keep';
export const PATH = 'path';
export const POOL = 'pool';
export const CAVE = 'cave';
export const CHEST = 'nest-chest';

export const SITE_SIZE = { graveyard: { w: 29, h: 19 }, swamp: { w: 39, h: 25 } };

const blank = (w, h, code) => Array.from({ length: h }, () => Array(w).fill(code));

// 墓地：外圍一圈低矮的圍欄，南邊正中留 3 格入口；一條小路從入口通到北邊正中的墓室（石牆、石門，寶箱在裡面）；
// 每座墳是墓碑加南邊一格土堆，一排一排但有缺位、錯開；圍欄內側的角落零星幾棵枯樹
export function graveyard(seed, x0, y0) {
  const { w, h } = SITE_SIZE.graveyard;
  const cx = w >> 1;
  const r = (i, j, k) => hash01(seed, x0 + i, y0 + j, 8100 + k);
  const g = blank(w, h, FLOOR);
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) if (i === 0 || j === 0 || i === w - 1 || j === h - 1) g[j][i] = 'grave-fence';
  for (let i = cx - 1; i <= cx + 1; i++) g[h - 1][i] = PATH;

  // 墓室：外框 7×5，室內 5×3（洞窟般的暗地面），門在南邊正中，寶箱靠北牆正中
  const crypt = { x: cx - 3, y: 1, w: 7, h: 5 };
  for (let j = crypt.y; j < crypt.y + crypt.h; j++)
    for (let i = crypt.x; i < crypt.x + crypt.w; i++) {
      const edge = i === crypt.x || j === crypt.y || i === crypt.x + crypt.w - 1 || j === crypt.y + crypt.h - 1;
      g[j][i] = edge ? 'crypt-wall' : CAVE;
    }
  g[crypt.y + crypt.h - 1][cx] = 'stone-door';
  g[crypt.y + 1][cx] = CHEST;

  // 小路：門外到入口
  for (let j = crypt.y + crypt.h; j < h - 1; j++) g[j][cx] = PATH;

  // 墳：墓碑在上、土堆在下；每排從不同的偏移開始，三成的位置空著
  const rows = [2, 5, 8, 11, 14];
  rows.forEach((j, n) => {
    const shift = n % 2;
    for (let i = 2 + shift; i < w - 2; i += 2) {
      if (Math.abs(i - cx) <= 1) continue;
      if (j <= crypt.y + crypt.h && i >= crypt.x - 1 && i <= crypt.x + crypt.w) continue;
      if (r(i, j, 1) < 0.3) continue;
      g[j][i] = 'tombstone';
      g[j + 1][i] = 'grave-mound';
    }
  });

  // 枯樹：圍欄內側一圈的空地，少數幾棵
  for (let j = 1; j < h - 1; j++)
    for (let i = 1; i < w - 1; i++) {
      const inner = i === 1 || j === 1 || i === w - 2 || j === h - 2;
      if (inner && g[j][i] === FLOOR && r(i, j, 2) < 0.12) g[j][i] = 'dead-tree';
    }
  return g;
}

// 陰暗的沼澤（巨魔的據點）：開放的沼澤，跟堡壘一樣大（39×25），外緣一圈零零落落的沼澤樹與枯樹標出範圍，不圍起來；
// 北邊中間一座岩丘，裡面是洞窟（室內 7×3、洞口 3 格寬朝南，巨魔佔 2×1 進得去），寶箱靠洞底，骨堆散在洞裡與洞口兩側；
// 其餘是泥地，幾灘積水，三成多長蘆葦，零星幾棵沼澤樹
export function swamp(seed, x0, y0) {
  const { w, h } = SITE_SIZE.swamp;
  const cx = w >> 1;
  const r = (i, j, k) => hash01(seed, x0 + i, y0 + j, 8300 + k);
  const pick = (k, lo, hi) => lo + Math.floor(hash01(seed, x0, y0, 8200 + k) * (hi - lo + 1));
  const g = blank(w, h, FLOOR);

  // 岩丘與洞窟
  const cy = 8;
  const rx = 8.5;
  const ry = 6;
  const hollow = (i, j) => (Math.abs(i - cx) <= 3 && Math.abs(j - cy) <= 1) || (Math.abs(i - cx) <= 1 && j > cy);
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const e = ((i - cx) / rx) ** 2 + ((j - cy) / ry) ** 2;
      if (e > 1) continue;
      g[j][i] = hollow(i, j) ? CAVE : e > 0.55 ? 'cave-rock-low' : 'cave-rock';
    }
  g[cy - 1][cx] = CHEST;
  g[cy - 1][cx - 3] = 'bones';
  g[cy + 1][cx + 3] = 'bones';
  const mouth = cy + Math.ceil(ry); // 洞口外第一格
  for (const dx of [-3, 3]) if (g[mouth][cx + dx] === FLOOR) g[mouth][cx + dx] = 'bones';

  // 積水：五灘，避開岩丘周圍與洞口前那條路
  const nearCave = (i, j) =>
    ((i - cx) / (rx + 2)) ** 2 + ((j - cy) / (ry + 2)) ** 2 <= 1 || (Math.abs(i - cx) <= 2 && j > cy);
  for (let k = 0; k < 5; k++) {
    const px = pick(2 * k, 4, w - 5);
    const py = pick(2 * k + 1, 4, h - 4);
    const rad = 1.5 + hash01(seed, x0, y0, 8250 + k) * 1.8;
    for (let j = 1; j < h - 1; j++)
      for (let i = 1; i < w - 1; i++) {
        if (nearCave(i, j) || g[j][i] !== FLOOR) continue;
        const d = Math.hypot(i - px, (j - py) * 1.3) + (r(i, j, 3) - 0.5) * 1.2;
        if (d <= rad) g[j][i] = POOL;
      }
  }

  // 外緣兩格寬的帶子：零零落落的樹標出範圍；裡面零星幾棵沼澤樹，其餘泥地長蘆葦
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      if (g[j][i] !== FLOOR) continue;
      const edge = Math.min(i, j, w - 1 - i, h - 1 - j);
      const a = r(i, j, 4);
      if (edge <= 1 && a < (edge === 0 ? 0.5 : 0.22)) g[j][i] = r(i, j, 5) < 0.55 ? 'bog-tree' : 'dead-tree';
      else if (edge > 1 && !nearCave(i, j) && a < 0.035) g[j][i] = 'bog-tree';
      else if (a > 0.62) g[j][i] = REEDS;
    }
  return g;
}
