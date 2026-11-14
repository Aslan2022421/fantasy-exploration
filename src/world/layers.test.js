// 每格四層（地貌、地表材質、水文、生態覆蓋）的生成規則
import { expect, test } from 'vitest';
import { DATA } from '../data/load.js';
import { LAND } from './landform.js';
import { GEN, LAYER_NONE } from './terrain.js';
import { createWorld } from './world.js';

const SMALL = { zonesX: 3, zonesY: 3 }; // 3×3 區的小世界（96×96 建一次要 2 秒）

const world = createWorld(20261112, DATA, SMALL);
const MOUNTAIN = DATA.landformIndex.get('mountain');
const S = (id) => DATA.surfaceIndex.get(id);
const W = (id) => DATA.waterIndex.get(id);

test('沼澤在最低的陸地層、平坦；生態覆蓋只長在泥土與沙地；冰只在淺水上；高山積雪', () => {
  const counts = { swamp: 0, cover: 0 };
  const snowline = Math.round((LAND.mountain + GEN.treelineRange + 1) * 127.5) + 1;
  for (let zy = 0; zy < 3; zy++) {
    for (let zx = 0; zx < 3; zx++) {
      const z = world.zone(zx, zy);
      for (let i = 0; i < z.water.length; i++) {
        if (z.water[i] === W('swamp')) {
          counts.swamp++;
          expect(z.tier[i]).toBe(1);
          expect(z.slope[i]).toBeLessThan(GEN.swampSlope);
        }
        if (z.cover[i] !== LAYER_NONE) {
          counts.cover++;
          expect(z.water[i]).toBe(LAYER_NONE);
          expect([S('dirt'), S('sand')]).toContain(z.surface[i]);
        }
        if (z.surface[i] === S('ice')) expect(z.water[i]).toBe(W('shallow-water'));
        // 高山上的河是水（冷的地方結冰），只看陸地
        if (z.landform[i] === MOUNTAIN && z.height[i] > snowline && z.water[i] === LAYER_NONE)
          expect(z.surface[i]).toBe(S('snow'));
      }
    }
  }
  expect(counts.swamp).toBeGreaterThan(0);
  expect(counts.cover).toBeGreaterThan(0);
});

test('山峰只在山地，而且比周圍 peakRadius 格內都高；跨區也照樣算', () => {
  const r = GEN.peakRadius;
  let peaks = 0;
  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) {
      if (!world.peakAt(x, y)) continue;
      peaks++;
      expect(world.landformAt(x, y)).toBe(MOUNTAIN);
      const h = world.cell(x, y).height;
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          const c = (dx || dy) && world.cell(x + dx, y + dy);
          if (c) expect(c.height).toBeLessThanOrEqual(h); // 存成整數的高度可能捨入成一樣
        }
    }
  }
  expect(peaks).toBeGreaterThan(0);
});

test('沼澤走得過去，深水走不過去；地面顏色有水看水、結冰看冰', () => {
  let swamp = null;
  let deep = null;
  for (let y = 0; y < world.height && !(swamp && deep); y++) {
    for (let x = 0; x < world.width; x++) {
      const w = world.waterAt(x, y);
      if (!swamp && w === W('swamp') && world.objectAt(x, y) < 0) swamp = { x, y };
      if (!deep && w === W('deep-water')) deep = { x, y };
    }
  }
  expect(world.isPassable(swamp.x, swamp.y)).toBe(true);
  expect(world.isPassable(deep.x, deep.y)).toBe(false);
  expect(world.groundAt(swamp.x, swamp.y)).toBe(DATA.paletteBase.water + W('swamp'));
});
