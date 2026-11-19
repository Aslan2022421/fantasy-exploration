import { describe, expect, test } from 'vitest';
import { playlogName } from '../app/playlog.js';
import { DATA } from '../data/load.js';
import { newGame } from '../world/game.js';
import { regionCell, zoneCells } from './asciimap-cells.js';

describe('世界地圖的字', () => {
  const game = newGame(20261112);
  const world = game.world;
  const home = world.startVillage;

  test('附近：聚落的牆畫 #、廣場與街道畫 ·；每一塊都有字與顏色', () => {
    const wall = [];
    for (let j = 0; j < home.h; j++)
      for (let i = 0; i < home.w; i++)
        if (home.layout.grid[j][i] === DATA.settlements[home.kind].wall) wall.push([i, j]);
    const [i, j] = wall[0];
    expect(regionCell(world, DATA, home.x0 + i, home.y0 + j, 1).ch).toBe('#');
    expect(regionCell(world, DATA, home.plaza.x, home.plaza.y, 1).ch).toBe('·');
    for (let k = 0; k < 20; k++) {
      const c = regionCell(world, DATA, home.x0 - 60 + k * 6, home.y0 - 40, 3);
      expect(typeof c.ch).toBe('string');
      expect(c.fg).toMatch(/^#/);
    }
  });

  test('總覽：起點那一區是村莊 ⌂，湖海的區是水', () => {
    const cells = zoneCells(world, DATA);
    const Z = world.zoneSize;
    expect(cells(Math.floor(home.x0 / Z), Math.floor(home.y0 / Z)).ch).toBe('⌂');
    expect(['≈', '~']).toContain(cells(0, 0).ch);
  });
});

test('試玩紀錄的檔名用匯出時的本地時間', () => {
  expect(playlogName(new Date(2026, 10, 14, 21, 5))).toBe('fantasy-exploration-20261114-2105.json');
});
