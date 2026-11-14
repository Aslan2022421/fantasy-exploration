import { describe, expect, test } from 'vitest';
import { DATA } from '../data/load.js';
import { mountainRing } from '../view/perspective.js';
import { PART_TRUNK, trunkCell } from './footprint.js';
import { LAND } from './landform.js';
import { PLACE } from './objects.js';
import { createWorld } from './world.js';

const SMALL = { zonesX: 3, zonesY: 3 };
const SEEDS = [20261112, 7, 31337];
const O = (id) => DATA.objectIndex.get(id);
const S = (id) => DATA.surfaceIndex.get(id);
const WALL = O('rock-wall');
const VEIN = O('vein');
const HERB = O('herb');
const ROCKY = new Set([WALL, VEIN]);
const toH = (v) => Math.round((v + 1) * 127.5); // 高度換成 0～255

// 中間那一區的每一格（鄰格可能跨到隔壁區，世界會自己生）
function* cells(world) {
  const Z = world.zoneSize;
  for (let y = Z; y < Z * 2; y++) for (let x = Z; x < Z * 2; x++) yield [x, y];
}

describe('物件層的資源來源', () => {
  const worlds = SEEDS.map((s) => createWorld(s, DATA, SMALL));
  const count = { [WALL]: 0, [VEIN]: 0, [HERB]: 0 };

  test('岩壁與礦脈：山上長在平台與山谷（東西兩邊同一圈，不壓在畫 / \\ 的山坡上），山以外長在岩石上；成片，礦脈在山腳或山以外', () => {
    for (const w of worlds) {
      for (const [x, y] of cells(w)) {
        const o = w.objectAt(x, y);
        if (!ROCKY.has(o)) continue;
        count[o]++;
        const h = w.heightAt(x, y);
        if (h > toH(LAND.mountain) + 1) {
          expect(mountainRing(w.heightAt(x - 1, y))).toBe(mountainRing(h));
          expect(mountainRing(w.heightAt(x + 1, y))).toBe(mountainRing(h));
        } else if (h < toH(LAND.mountain) - 1) expect(w.surfaceAt(x, y)).toBe(S('rock'));
        expect(w.isPassable(x, y)).toBe(false);
        const linked = [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ].some(([dx, dy]) => ROCKY.has(w.objectAt(x + dx, y + dy)));
        expect(linked).toBe(true);
        if (o !== VEIN || w.heightAt(x, y) <= toH(LAND.mountain)) continue;
        let foot = false;
        const r = PLACE.footRange;
        for (let dy = -r; dy <= r; dy++)
          for (let dx = -r; dx <= r; dx++)
            if (w.waterAt(x + dx, y + dy) < 0 && w.heightAt(x + dx, y + dy) <= toH(LAND.mountain) + 1) foot = true;
        expect(foot).toBe(true);
      }
    }
    expect(count[WALL]).toBeGreaterThan(0);
    expect(count[VEIN]).toBeGreaterThan(0);
  });

  test('草本長在低處、靠近河或湖的泥土上', () => {
    for (const w of worlds) {
      for (const [x, y] of cells(w)) {
        if (w.objectAt(x, y) !== HERB) continue;
        count[HERB]++;
        expect(w.surfaceAt(x, y)).toBe(S('dirt'));
        expect(w.tierAt(x, y)).toBeLessThanOrEqual(PLACE.herbMaxTier);
        let water = false;
        const r = PLACE.herbRange;
        for (let dy = -r; dy <= r; dy++)
          for (let dx = -r; dx <= r; dx++) if (w.waterAt(x + dx, y + dy) >= 0) water = true;
        expect(water).toBe(true);
      }
    }
    expect(count[HERB]).toBeGreaterThan(0);
  });

  test('樹種：同一類用同一個字、有類名；山上長的樹都是松樹', () => {
    const trees = DATA.objects.filter((o) => o.trunk);
    for (const t of trees) expect(t.family).toBeTruthy();
    const glyphOf = {};
    for (const t of trees) {
      glyphOf[t.family] ??= t.glyph;
      expect(t.glyph).toBe(glyphOf[t.family]);
    }
    const pine = O('pine');
    let onMountain = 0;
    for (const w of worlds) {
      for (const [x, y] of cells(w)) {
        const o = w.objectAt(x, y);
        if (o < 0 || !DATA.objects[o].trunk || w.heightAt(x, y) <= toH(LAND.mountain) + 1) continue;
        expect(o).toBe(pine);
        onMountain++;
      }
    }
    expect(onMountain).toBeGreaterThan(0);
  });

  test('樹冠的錨點往右下找得到同一棵樹的樹幹；單格物件的錨點是自己', () => {
    const w = worlds[0];
    let checked = 0;
    for (const [x, y] of cells(w)) {
      const o = w.objectAt(x, y);
      if (o < 0) continue;
      const a = w.anchorAt(x, y);
      if (!DATA.objects[o].trunk) {
        expect(a).toEqual({ x, y });
        continue;
      }
      const tc = trunkCell(DATA.objects[o].sizes[0]);
      expect(w.objectAt(a.x + tc.i, a.y + tc.j)).toBe(o);
      expect(w.objectPartAt(a.x + tc.i, a.y + tc.j)).toBe(PART_TRUNK);
      checked++;
    }
    expect(checked).toBeGreaterThan(100);
  });
});
