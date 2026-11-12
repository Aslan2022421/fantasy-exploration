// 階段 0 的空地圖：邊界是牆，中間撒一些石頭，讓捲動看得出來
// 亂數暫時直接用 ROT.js 的全域亂數；階段 1 改成分流

import { RNG } from 'rot-js';

export const FLOOR = '.';
export const WALL = '#';

export function createMap(width, height, seed) {
  RNG.setSeed(seed);
  const cells = [];
  for (let y = 0; y < height; y++) {
    const row = [];
    for (let x = 0; x < width; x++) {
      const edge = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      row.push(edge || RNG.getUniform() < 0.08 ? WALL : FLOOR);
    }
    cells.push(row);
  }
  return { width, height, cells };
}

export function tileAt(map, x, y) {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return WALL;
  return map.cells[y][x];
}

export function isPassable(map, x, y) {
  return tileAt(map, x, y) !== WALL;
}

// 從地圖中央往外找第一個走得進去的格子當起點
export function startPosition(map) {
  const cx = Math.floor(map.width / 2);
  const cy = Math.floor(map.height / 2);
  for (let r = 0; r < Math.max(map.width, map.height); r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (isPassable(map, cx + dx, cy + dy)) return { x: cx + dx, y: cy + dy };
      }
    }
  }
  return { x: cx, y: cy };
}
