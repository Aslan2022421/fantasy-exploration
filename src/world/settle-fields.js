// 聚落裡的田與樹叢（settle-layouts.js 最後一步）：在剩下的空地上找放得下的地方（外圍留一格空地）
// 田一排作物、一排泥土；樹叢 4×3，隔格種、偶爾空一棵

import { FIELD, GROUND } from './settle-codes.js';

const FIELDS = { village: [2, 3], town: [2, 3] }; // 幾塊田
const GROVES = { village: [2, 3], town: [2, 4] }; // 幾叢樹
const GROVE_TREES = ['oak', 'maple', 'birch'];

export function fieldsAndGroves(grid, W, H, kind, rnd, inner) {
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
