import { RNG } from 'rot-js';
import { describe, expect, test } from 'vitest';
import { DATA } from '../data/load.js';
import { gradient, shadeLevel } from './hillshade.js';
import { FACE, FACE_FAR, reliefOf } from './relief.js';
import { createTerrainGen } from './terrain.js';
import { createWorld, startPosition, ZONE_SIZE } from './world.js';

const SEED = 20261112;
const Z = ZONE_SIZE;

describe('只看種子＋座標', () => {
  test('生成順序不同，同一區的內容完全一樣', () => {
    const a = createWorld(SEED, DATA);
    const b = createWorld(SEED, DATA);
    const order = [
      [0, 0],
      [2, 1],
      [1, 1],
    ];
    const za = order.map(([x, y]) => a.zone(x, y));
    const zb = [...order].reverse().map(([x, y]) => b.zone(x, y));
    zb.reverse();
    for (let i = 0; i < order.length; i++) {
      expect(za[i].terrain).toEqual(zb[i].terrain);
      expect(za[i].height).toEqual(zb[i].height);
      expect(za[i].shade).toEqual(zb[i].shade);
    }
  });

  test('不同種子生出不同的地形', () => {
    const a = createWorld(SEED, DATA).zone(1, 1).terrain;
    const b = createWorld(SEED + 1, DATA).zone(1, 1).terrain;
    expect(a).not.toEqual(b);
  });

  test('生世界不會動到全域亂數', () => {
    RNG.setSeed(42);
    const before = RNG.getState().join();
    createWorld(SEED, DATA).zone(0, 0);
    expect(RNG.getState().join()).toBe(before);
  });
});

describe('區與區的交界', () => {
  const gen = createTerrainGen(SEED, DATA);

  test('交界兩側的高度都跟同一張雜訊直接算的一樣', () => {
    const left = gen.genZone(0, 1, Z);
    const right = gen.genZone(1, 1, Z);
    const direct = (x, y) => Math.round((Math.max(-1, Math.min(1, Math.fround(gen.heightAt(x, y)))) + 1) * 127.5);
    for (let y = 0; y < Z; y += 7) {
      expect(left.height[y * Z + (Z - 1)]).toBe(direct(Z - 1, Z + y));
      expect(right.height[y * Z]).toBe(direct(Z, Z + y));
    }
  });

  test('邊上的台地立面等於用全域高度直接算的結果', () => {
    const z = gen.genZone(1, 1, Z);
    const t = (x, y) => Math.fround(gen.terraceHeightAt(x, y));
    for (let x = 0; x < Z; x += 5) {
      for (const y of [0, 1, Z - 1]) {
        const X = Z + x;
        const Y = Z + y;
        expect(z.relief[y * Z + x]).toBe(reliefOf(t(X, Y - 2), t(X, Y - 1), t(X, Y), t(X, Y + 1)));
      }
    }
  });

  test('邊上的明暗等於用全域高度直接算的結果', () => {
    const z = gen.genZone(1, 0, Z);
    for (let y = 0; y < Z; y += 5) {
      for (const x of [0, Z - 1]) {
        const X = Z + x;
        const g = gradient((dx, dy) => Math.fround(gen.heightAt(X + dx, y + dy)));
        expect(z.shade[y * Z + x]).toBe(shadeLevel(g.dx, g.dy));
      }
    }
  });
});

describe('世界的形狀', () => {
  const world = createWorld(SEED, DATA);

  test('世界層 3×3、每區都有氣候與生態標籤', () => {
    expect(world.regions).toHaveLength(9);
    const biomeIds = new Set(DATA.biomes.map((b) => b.id));
    for (const r of world.regions) {
      expect(biomeIds.has(r.biome)).toBe(true);
      expect(['cold', 'mild', 'hot']).toContain(r.climate.temperature);
      expect(['dry', 'normal', 'wet']).toContain(r.climate.moisture);
    }
  });

  test('世界外不能走，查不到格子', () => {
    expect(world.isPassable(-1, 5)).toBe(false);
    expect(world.isPassable(world.width, 5)).toBe(false);
    expect(world.cell(5, world.height)).toBeNull();
    expect(world.terrainAt(-1, -1)).toBe(-1);
  });

  test('區用到才生', () => {
    const w = createWorld(SEED, DATA);
    expect(w.generatedZones()).toBe(0);
    w.isPassable(Z + 3, Z + 3);
    expect(w.generatedZones()).toBe(1);
  });

  test('多個種子的起點都能走、都在中間那區', () => {
    for (let s = 1; s <= 10; s++) {
      const w = createWorld(s * 7919, DATA);
      const p = startPosition(w);
      expect(w.isPassable(p.x, p.y)).toBe(true);
      expect(w.regionAt(p.x, p.y)).toBe(w.region(1, 1));
    }
  });

  test('岩壁只長在台階立面上', () => {
    const wall = DATA.terrainIndex.get('rock-wall');
    let walls = 0;
    for (let zy = 0; zy < 3; zy++) {
      for (let zx = 0; zx < 3; zx++) {
        const z = world.zone(zx, zy);
        for (let i = 0; i < z.terrain.length; i++) {
          if (z.terrain[i] !== wall) continue;
          walls++;
          expect([FACE, FACE_FAR]).toContain(z.relief[i]);
        }
      }
    }
    expect(walls).toBeGreaterThan(0);
  });

  test('物件只撒在該生態的平地上；物件層跟地形層分開', () => {
    let objects = 0;
    for (let zy = 0; zy < 3; zy++) {
      for (let zx = 0; zx < 3; zx++) {
        const z = world.zone(zx, zy);
        for (let i = 0; i < z.object.length; i++) {
          if (!z.object[i]) continue;
          objects++;
          const ground = DATA.terrainIndex.get(DATA.biomes[z.biome[i]].ground);
          expect(z.terrain[i]).toBe(ground);
        }
      }
    }
    expect(objects).toBeGreaterThan(0);
    for (const t of DATA.terrains) expect(DATA.objectIndex.has(t.id)).toBe(false);
  });

  test('格子的資訊', () => {
    const p = startPosition(world);
    const c = world.cell(p.x, p.y);
    expect(c.terrain.passable).toBe(true);
    expect(c.height).toBeGreaterThanOrEqual(0);
    expect(c.height).toBeLessThanOrEqual(255);
    expect(c.shade).toBeGreaterThanOrEqual(0);
    expect(c.shade).toBeLessThan(8);
  });
});
