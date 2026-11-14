import { expect, test } from 'vitest';
import { DATA } from '../data/load.js';
import { buildGeography, GEO } from './geography.js';
import { LAND } from './landform.js';
import { RIVER } from './riverbed.js';
import { createWorld } from './world.js';

const SMALL = { zonesX: 3, zonesY: 3 }; // 3×3 區的小世界（96×96 建一次要 2 秒）

// 一座圓錐形的山在正中央，往外越來越低，邊緣是水
const cone = (x, y) => 0.9 - Math.hypot(x - 128, y - 128) / 100;

function firstWithRivers() {
  for (let seed = 1; seed < 50; seed++) {
    const g = buildGeography(cone, seed, 256, 256);
    if (g.rivers > 0) return g;
  }
  return null;
}

test('河流從高處往下游流，一路流到水面或世界邊緣；水往低處流', () => {
  const g = firstWithRivers();
  expect(g).not.toBeNull();
  for (let i = 0; i < g.flow.length; i++) {
    if (!g.flow[i]) continue;
    let k = i;
    let steps = 0;
    while (g.down[k] >= 0 && g.elev[k] >= LAND.water && steps < 1000) {
      expect(g.filled[g.down[k]]).toBeLessThanOrEqual(g.filled[k] + 1e-6);
      k = g.down[k];
      steps++;
    }
    const x = k % g.W;
    const y = Math.floor(k / g.W);
    const atEdge = x === 0 || y === 0 || x === g.W - 1 || y === g.H - 1;
    expect(g.elev[k] < LAND.water || atEdge).toBe(true);
  }
});

test('濕度：離水近的比較濕；山的背風面（東邊）比迎風面（西邊）乾', () => {
  const g = buildGeography(cone, 1, 256, 256);
  expect(g.moistureAt(12, 128)).toBeGreaterThan(g.moistureAt(70, 128)); // 水邊 vs 離水遠
  expect(g.moistureAt(128 + 40, 128)).toBeLessThan(g.moistureAt(128 - 40, 128)); // 東邊被山擋住
});

test('連通：被一圈深水圍住的出生點，會開一條淺灘接到外面', () => {
  // 正中央是一座島，外面一圈深湖，再外面是陸地
  const island = (x, y) => {
    const d = Math.hypot(x - 128, y - 128);
    return d > 40 && d < 60 ? LAND.water - LAND.deepDepth - 0.2 : 0.1;
  };
  const g = buildGeography(island, 1, 256, 256);
  expect(g.fords).toBeGreaterThan(0);
  const { mask } = g.paint(0, 0, 256, 256);
  let fordInRing = 0;
  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 256; x++) {
      const d = Math.hypot(x + 0.5 - 128, y + 0.5 - 128);
      if (d > 42 && d < 58 && mask[y * 256 + x] === 3) fordInRing++;
    }
  }
  expect(fordInRing).toBeGreaterThan(0);
  expect(GEO.fordRadius).toBeGreaterThan(0);
});

test('畫進世界：河道是水，跟著地勢走（比旁邊的陸地低、最多低 2 層），高處也有河', () => {
  const world = createWorld(20261112, DATA, SMALL);
  const g = world.geography;
  const { mask } = g.paint(0, 0, world.width, world.height);
  let checked = 0;
  let high = 0;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] !== 1 && mask[i] !== 2) continue;
    const x = i % world.width;
    const y = Math.floor(i / world.width);
    if (x < 1 || y < 1 || x >= world.width - 1 || y >= world.height - 1) continue;
    expect(world.waterAt(x, y)).toBeGreaterThanOrEqual(0);
    const t = world.tierAt(x, y);
    if (t > 0) high++;
    let lowestLand = Number.POSITIVE_INFINITY;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (world.waterAt(x + dx, y + dy) < 0) lowestLand = Math.min(lowestLand, world.tierAt(x + dx, y + dy));
      }
    }
    if (lowestLand < Number.POSITIVE_INFINITY) {
      expect(t).toBeLessThan(lowestLand);
      expect(lowestLand - t).toBeLessThanOrEqual(RIVER.carve);
    }
    checked++;
  }
  expect(checked).toBeGreaterThan(100);
  expect(high).toBeGreaterThan(0);
});
