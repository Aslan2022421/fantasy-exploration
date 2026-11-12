import { expect, test } from 'vitest';
import { tryMove } from './move.js';
import { findPath, stepDirection } from './path.js';

const map = (rows) => ({ width: rows[0].length, height: rows.length, cells: rows.map((r) => [...r]) });

test('空地斜走，步數是兩軸距離的較大者', () => {
  const m = map(['.....', '.....', '.....', '.....', '.....']);
  const path = findPath(m, { x: 0, y: 0 }, { x: 4, y: 2 });
  expect(path).toHaveLength(4);
  expect(path.at(-1)).toEqual({ x: 4, y: 2 });
});

test('繞過牆，而且照路線一步步走得到終點', () => {
  const m = map(['.#...', '.#.#.', '.#.#.', '...#.']);
  const from = { x: 0, y: 0 };
  const to = { x: 4, y: 0 };
  const path = findPath(m, from, to);
  expect(path.length).toBeGreaterThan(0);
  let pos = from;
  for (const step of path) {
    pos = tryMove(m, pos, stepDirection(pos, step));
    expect(pos).toEqual(step);
  }
  expect(pos).toEqual(to);
});

test('點在牆上、走不到、點在原地都回傳空路線', () => {
  const m = map(['..#..', '..#..', '..#..']);
  expect(findPath(m, { x: 0, y: 0 }, { x: 2, y: 0 })).toEqual([]);
  expect(findPath(m, { x: 0, y: 0 }, { x: 4, y: 0 })).toEqual([]);
  expect(findPath(m, { x: 1, y: 1 }, { x: 1, y: 1 })).toEqual([]);
});

test('方向對得上', () => {
  expect(stepDirection({ x: 1, y: 1 }, { x: 2, y: 0 })).toBe('ne');
  expect(stepDirection({ x: 1, y: 1 }, { x: 0, y: 1 })).toBe('w');
  expect(stepDirection({ x: 1, y: 1 }, { x: 1, y: 1 })).toBe(null);
});
