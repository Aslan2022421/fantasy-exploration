import { describe, expect, test } from 'vitest';
import { DATA } from '../data/load.js';
import { PART_TRUNK, trunkCell } from './footprint.js';
import { LAND } from './landform.js';
import { mineLayers, PLACE } from './objects.js';
import { createWorld } from './world.js';

const SMALL = { zonesX: 3, zonesY: 3 };
const SEEDS = [20261112, 7, 31337];
const O = (id) => DATA.objectIndex.get(id);
const S = (id) => DATA.surfaceIndex.get(id);
const HERB = O('herb');
const toH = (v) => Math.round((v + 1) * 127.5); // 高度換成 0～255

// 中間那一區的每一格（鄰格可能跨到隔壁區，世界會自己生）
function* cells(world) {
  const Z = world.zoneSize;
  for (let y = Z; y < Z * 2; y++) for (let x = Z; x < Z * 2; x++) yield [x, y];
}

describe('物件層的資源來源', () => {
  const worlds = SEEDS.map((s) => createWorld(s, DATA, SMALL));
  let herbs = 0;

  test('礦坑：每區 0～2 處、整處在那一區裡、兩處隔得夠遠；佔 3×3 格，九格同一個高度層、沒有水也不是冰、走不過去；在谷地、山腳的低處，或平地區（不在山上）；層數在資料的範圍裡', () => {
    let mines = 0;
    for (const w of worlds) {
      const geo = w.geography;
      const coarse = (x, y) => {
        const i = Math.floor(x / 8);
        const j = Math.floor(y / 8);
        return i < 0 || j < 0 || i >= geo.W || j >= geo.H ? -1 : geo.elev[j * geo.W + i];
      };
      const perZone = new Map();
      for (let y = 0; y < w.height; y++)
        for (let x = 0; x < w.width; x++) {
          const o = w.objectAt(x, y);
          if (o < 0 || !DATA.objects[o].layers) continue;
          const a = w.anchorAt(x, y);
          if (a.x !== x || a.y !== y) continue;
          mines++;
          const Z = w.zoneSize;
          const zone = `${Math.floor(x / Z)},${Math.floor(y / Z)}`;
          expect(Math.floor((x + 2) / Z)).toBe(Math.floor(x / Z));
          expect(Math.floor((y + 2) / Z)).toBe(Math.floor(y / Z));
          const list = perZone.get(zone) ?? [];
          for (const b of list)
            expect(Math.max(Math.abs(b.x - x), Math.abs(b.y - y))).toBeGreaterThanOrEqual(PLACE.mineGap);
          list.push({ x, y });
          perZone.set(zone, list);
          for (let j = 0; j < 3; j++)
            for (let i = 0; i < 3; i++) {
              const c = { x: x + i, y: y + j };
              expect(w.objectAt(c.x, c.y)).toBe(o);
              expect(w.anchorAt(c.x, c.y)).toEqual(a);
              expect(w.tierAt(c.x, c.y)).toBe(w.tierAt(x, y));
              expect(w.waterAt(c.x, c.y)).toBe(-1);
              expect(w.surfaceAt(c.x, c.y)).not.toBe(S('ice'));
              expect(w.isPassable(c.x, c.y)).toBe(false);
            }
          expect(w.heightAt(x, y)).toBeLessThanOrEqual(toH(LAND.mountain + PLACE.valleyTop) + 1);
          const sides = [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ].filter(([dx, dy]) => {
            for (let k = 1; k <= PLACE.valleyReach; k++)
              if (coarse(x + dx * k * 8, y + dy * k * 8) > LAND.mountain + PLACE.valleyRise) return true;
            return false;
          }).length;
          if (sides === 0) {
            // 平地區：不在山上，生態要在 plainMines 的表裡
            expect(w.heightAt(x, y)).toBeLessThanOrEqual(toH(LAND.mountain) + 1);
            const biome = DATA.biomes[w.biomeAt(x + 1, y + 1)].id;
            expect(PLACE.plainMines.some((r) => r.biomes.includes(biome))).toBe(true);
          }
          const n = mineLayers(w.seed, DATA.objects[o], x, y);
          expect(n).toBeGreaterThanOrEqual(DATA.objects[o].layers[0]);
          expect(n).toBeLessThanOrEqual(DATA.objects[o].layers[1]);
        }
      for (const list of perZone.values()) expect(list.length).toBeLessThanOrEqual(PLACE.mineCount.length - 1);
    }
    expect(mines).toBeGreaterThan(0);
  });

  test('草本長在低處、靠近河或湖的泥土上', () => {
    for (const w of worlds) {
      for (const [x, y] of cells(w)) {
        if (w.objectAt(x, y) !== HERB) continue;
        herbs++;
        expect(w.surfaceAt(x, y)).toBe(S('dirt'));
        expect(w.tierAt(x, y)).toBeLessThanOrEqual(PLACE.herbMaxTier);
        let water = false;
        const r = PLACE.herbRange;
        for (let dy = -r; dy <= r; dy++)
          for (let dx = -r; dx <= r; dx++) if (w.waterAt(x + dx, y + dy) >= 0) water = true;
        expect(water).toBe(true);
      }
    }
    expect(herbs).toBeGreaterThan(0);
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
      if (DATA.objects[o].layers) continue; // 礦坑佔 2×2，見上面
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
