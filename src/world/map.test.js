import { RNG } from 'rot-js';
import { expect, test } from 'vitest';
import { createMap, isPassable, startPosition, tileAt, WALL } from './map.js';
import { tryMove } from './move.js';

const rng = (seed) => RNG.clone().setSeed(seed);

test('同一個種子生出同一張地圖', () => {
  expect(createMap(30, 20, rng(7)).cells).toEqual(createMap(30, 20, rng(7)).cells);
});

test('生地圖不會動到全域亂數', () => {
  const before = RNG.getState().join();
  createMap(30, 20, rng(7));
  expect(RNG.getState().join()).toBe(before);
});

test('邊界都是牆，地圖外也算牆', () => {
  const map = createMap(30, 20, rng(7));
  for (let x = 0; x < 30; x++) {
    expect(tileAt(map, x, 0)).toBe(WALL);
    expect(tileAt(map, x, 19)).toBe(WALL);
  }
  expect(isPassable(map, -1, 5)).toBe(false);
});

test('起點走得進去', () => {
  const map = createMap(80, 50, rng(20261112));
  const p = startPosition(map);
  expect(isPassable(map, p.x, p.y)).toBe(true);
});

test('撞牆留在原地，斜走可以走', () => {
  const map = {
    width: 3,
    height: 3,
    cells: [
      ['.', '#', '.'],
      ['.', '.', '.'],
      ['.', '.', '.'],
    ],
  };
  expect(tryMove(map, { x: 1, y: 1 }, 'n')).toEqual({ x: 1, y: 1 });
  expect(tryMove(map, { x: 1, y: 1 }, 'ne')).toEqual({ x: 2, y: 0 });
  expect(tryMove(map, { x: 1, y: 1 }, 'bad')).toEqual({ x: 1, y: 1 });
});
