import { expect, test } from 'vitest';
import { tryMove } from './move.js';
import { findPath, lineSteps, stepDirection } from './path.js';

// 測試用的小地圖：只要有 isPassable，跟真正的世界一樣用
const map = (rows) => ({
  isPassable: (x, y) => y >= 0 && y < rows.length && x >= 0 && x < rows[0].length && rows[y][x] !== '#',
});

test('空地斜走，步數是兩軸距離的較大者', () => {
  const m = map(['.....', '.....', '.....', '.....', '.....']);
  const path = findPath(m, { x: 0, y: 0 }, { x: 4, y: 2 });
  expect(path).toHaveLength(4);
  expect(path.at(-1)).toEqual({ x: 4, y: 2 });
});

test('空地上的路線拉直：斜走與直走穿插，不會先斜走到底再直走，步數不變', () => {
  const m = map(Array.from({ length: 12 }, () => '.'.repeat(12)));
  const path = findPath(m, { x: 0, y: 0 }, { x: 10, y: 4 });
  expect(path).toHaveLength(10);
  expect(path).toEqual(lineSteps({ x: 0, y: 0 }, { x: 10, y: 4 }));
  // 每一步離起點到終點的直線不超過半格
  for (const c of path) expect(Math.abs(c.y - (c.x * 4) / 10)).toBeLessThanOrEqual(0.5);
});

test('拉直時繞不過牆的那段照原路走，每一步都還是相鄰的格子', () => {
  const m = map(['......', '..##..', '..##..', '......']);
  const from = { x: 0, y: 1 };
  const path = findPath(m, from, { x: 5, y: 2 });
  let pos = from;
  for (const step of path) {
    expect(Math.max(Math.abs(step.x - pos.x), Math.abs(step.y - pos.y))).toBe(1);
    expect(m.isPassable(step.x, step.y)).toBe(true);
    pos = step;
  }
  expect(pos).toEqual({ x: 5, y: 2 });
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
