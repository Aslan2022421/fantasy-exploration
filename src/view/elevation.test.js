import { expect, test } from 'vitest';
import { MAX_TIER } from '../world/landform.js';
import { EDGE_NONE, EDGE_RIM, EDGE_SHADOW, edgeAt, tierLevel } from './elevation.js';

test('亮度只看絕對高度：越高越亮，最高層到第 7 級', () => {
  for (let t = 2; t <= MAX_TIER; t++) expect(tierLevel(t)).toBeGreaterThanOrEqual(tierLevel(t - 1));
  expect(tierLevel(1)).toBeLessThan(tierLevel(4));
  expect(tierLevel(MAX_TIER)).toBe(7);
});

test('層界：高的一側是崖邊、低的一側是崖下，平地都不是', () => {
  const tiers = [
    [1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1],
    [1, 1, 2, 1, 1],
    [1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1],
  ];
  const world = { inside: (x, y) => y >= 0 && y < 5 && x >= 0 && x < 5, tierAt: (x, y) => tiers[y][x] };
  expect(edgeAt(world, 2, 2)).toBe(EDGE_RIM);
  expect(edgeAt(world, 1, 1)).toBe(EDGE_SHADOW); // 斜對角也算
  expect(edgeAt(world, 2, 3)).toBe(EDGE_SHADOW);
  expect(edgeAt(world, 0, 0)).toBe(EDGE_NONE);
});
