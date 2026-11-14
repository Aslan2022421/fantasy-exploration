import { RNG } from 'rot-js';
import { describe, expect, test } from 'vitest';
import { DATA } from '../data/load.js';
import { PART_TRUNK } from './footprint.js';
import { gradient, lightLevel, shadeLevel } from './hillshade.js';
import { LAND, landTierOf, MAX_TIER, WATER_DEEP, WATER_NONE, WATER_SHALLOW } from './landform.js';
import { createTerrainGen, GEN, LAYER_NONE, waterLevel } from './terrain.js';
import { createWorld, startPosition, ZONE_SIZE } from './world.js';

const SMALL = { zonesX: 3, zonesY: 3 }; // 3×3 區的小世界（96×96 建一次要 2 秒）

const SEED = 20261112;
const Z = ZONE_SIZE;
const LAYERS = ['landform', 'surface', 'water', 'cover'];
const MOUNTAIN = DATA.landformIndex.get('mountain');
const S = (id) => DATA.surfaceIndex.get(id);
const W = (id) => DATA.waterIndex.get(id);
const ROCKY = new Set(['rock-wall', 'vein'].map((id) => DATA.objectIndex.get(id))); // 長在岩石上的物件

describe('只看種子＋座標', () => {
  test('生成順序不同，同一區的內容完全一樣', () => {
    const a = createWorld(SEED, DATA, SMALL);
    const b = createWorld(SEED, DATA, SMALL);
    const order = [
      [0, 0],
      [2, 1],
      [1, 1],
    ];
    const za = order.map(([x, y]) => a.zone(x, y));
    const zb = [...order].reverse().map(([x, y]) => b.zone(x, y));
    zb.reverse();
    for (let i = 0; i < order.length; i++) {
      for (const k of LAYERS) expect(za[i][k]).toEqual(zb[i][k]);
      expect(za[i].height).toEqual(zb[i].height);
      expect(za[i].shade).toEqual(zb[i].shade);
      expect(za[i].object).toEqual(zb[i].object);
      expect(za[i].objectAnchor).toEqual(zb[i].objectAnchor);
    }
  });

  test('不同種子生出不同的地形', () => {
    const a = createWorld(SEED, DATA, SMALL).zone(1, 1).surface;
    const b = createWorld(SEED + 1, DATA, SMALL).zone(1, 1).surface;
    expect(a).not.toEqual(b);
  });

  test('生世界不會動到全域亂數', () => {
    RNG.setSeed(42);
    const before = RNG.getState().join();
    createWorld(SEED, DATA, SMALL).zone(0, 0);
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

  test('多格物件跨區也接得上：換一個區的大小去生，重疊的地方地形、物件、樹冠分側完全一樣', () => {
    const big = gen.genZone(0, 0, 2 * Z); // 0～191
    const small = gen.genZone(1, 0, Z); // 96～191
    let objects = 0;
    for (let y = 0; y < Z; y++) {
      for (let x = 0; x < Z; x++) {
        const s = y * Z + x;
        const b = y * 2 * Z + (Z + x);
        for (const k of LAYERS) expect(small[k][s], k).toBe(big[k][b]);
        expect(small.object[s]).toBe(big.object[b]);
        expect(small.objectPart[s]).toBe(big.objectPart[b]);
        if (small.object[s]) objects++;
      }
    }
    expect(objects).toBeGreaterThan(0);
  });

  test('邊上的高度層，等於單獨算那幾格的結果', () => {
    const z = gen.genZone(1, 1, Z);
    const tierAt = (x, y) => gen.landform.cellAt(x, y).tier;
    for (let x = 0; x < Z; x += 5) {
      for (const y of [0, 1, Z - 1]) {
        const X = Z + x;
        const Y = Z + y;
        const i = y * Z + x;
        expect(z.tier[i]).toBe(tierAt(X, Y));
      }
    }
  });

  test('邊上的明暗等於用全域高度直接算的結果（陸地看高度層與坡向，水看深度）', () => {
    const z = gen.genZone(1, 0, Z);
    for (let y = 0; y < Z; y += 5) {
      for (const x of [0, Z - 1]) {
        const X = Z + x;
        const c = gen.landform.cellAt(X, y);
        let want;
        if (c.water === WATER_NONE) {
          const g = gradient((dx, dy) => Math.fround(gen.heightAt(X + dx, y + dy)));
          want = lightLevel(c.tier, shadeLevel(g.dx, g.dy));
        } else want = waterLevel(c.h);
        expect(z.shade[y * Z + x]).toBe(want);
      }
    }
  });
});

describe('世界的形狀', () => {
  const world = createWorld(SEED, DATA, SMALL);

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
    expect(world.landformAt(-1, -1)).toBe(-1);
    expect(world.waterAt(-1, -1)).toBe(-1);
    expect(world.groundAt(-1, -1)).toBe(-1);
  });

  test('區用到才生', () => {
    const w = createWorld(SEED, DATA, SMALL);
    expect(w.generatedZones()).toBe(0);
    w.isPassable(Z + 3, Z + 3);
    expect(w.generatedZones()).toBe(1);
  });

  test('生過的區最多留 64 區，丟掉的再生一次結果一樣', () => {
    const w = createWorld(SEED, DATA, { zonesX: 10, zonesY: 10 });
    const first = w.zone(0, 0).surface.slice();
    for (let zy = 0; zy < 10; zy++) for (let zx = 0; zx < 10; zx++) w.zone(zx, zy);
    expect(w.generatedZones()).toBe(64);
    expect(w.zone(0, 0).surface).toEqual(first);
  }, 15000); // 要生 100 多區，單獨跑約 3 秒，全部測試平行跑時會慢好幾倍

  test('多個種子的起點都能走、在最大那塊陸地上（離地理算好的起點粗格不遠）', () => {
    for (let s = 1; s <= 10; s++) {
      const w = createWorld(s * 7919, DATA, SMALL);
      const p = startPosition(w);
      expect(w.isPassable(p.x, p.y)).toBe(true);
      const g = w.geography.start;
      expect(Math.max(Math.abs(p.x - g.x), Math.abs(p.y - g.y))).toBeLessThan(24);
    }
  });

  // 只看湖海：這裡的 gen 沒接世界的地理，生出來的區沒有河（河跟著地勢走，見 geography.test.js）
  test('湖海的水面在第 0 層、陸地在第 1 層以上；淺水一定在深水旁邊', () => {
    const gen = createTerrainGen(SEED, DATA);
    const R = LAND.shallowRange;
    const deepId = W('deep-water');
    const shallowId = W('shallow-water');
    let shallow = 0;
    for (let zy = 0; zy < 3; zy++) {
      for (let zx = 0; zx < 3; zx++) {
        const z = gen.genZone(zx, zy, Z);
        for (let i = 0; i < z.water.length; i++) {
          const isWater = z.water[i] === deepId || z.water[i] === shallowId;
          if (isWater) expect(z.tier[i]).toBe(0);
          else expect(z.tier[i]).toBeGreaterThanOrEqual(1);
          if (z.water[i] !== shallowId || shallow++ > 50) continue;
          const X = zx * Z + (i % Z);
          const Y = zy * Z + Math.floor(i / Z);
          let near = false;
          for (let dy = -R; dy <= R && !near; dy++)
            for (let dx = -R; dx <= R; dx++) if (gen.landform.cellAt(X + dx, Y + dy).water === WATER_DEEP) near = true;
          expect(near).toBe(true);
        }
      }
    }
    expect(shallow).toBeGreaterThan(0);
    expect(WATER_SHALLOW).not.toBe(WATER_DEEP);
  });

  test('山地會比它所在的大地形層再高幾層，最高不超過 MAX_TIER', () => {
    let above = 0;
    for (let zy = 0; zy < 3; zy++) {
      for (let zx = 0; zx < 3; zx++) {
        const z = world.zone(zx, zy);
        for (let i = 0; i < z.tier.length; i++) {
          expect(z.tier[i]).toBeLessThanOrEqual(MAX_TIER);
          if (z.landform[i] === MOUNTAIN && z.tier[i] > LAND.landTiers) above++;
          if (z.landform[i] !== MOUNTAIN) expect(z.tier[i]).toBeLessThanOrEqual(LAND.landTiers);
        }
      }
    }
    expect(above).toBeGreaterThan(0);
    expect(landTierOf(0.5, 0.3)).toBeLessThanOrEqual(LAND.landTiers); // 不是山地就不加層
    expect(landTierOf(0.5, LAND.mountain + 0.01)).toBe(LAND.landTiers + 1);
  });

  test('物件不長在水裡、岩石與冰上；山地越高樹越少，高過樹線就沒有；物件層跟地形層分開', () => {
    const treeline = Math.round((LAND.mountain + GEN.treelineRange + 1) * 127.5); // 換成 0～255 的高度
    const low = Math.round((LAND.mountain + 0.05 + 1) * 127.5);
    let objects = 0;
    const band = { lowCells: 0, lowTrees: 0, highCells: 0, highTrees: 0 };
    for (let zy = 0; zy < 3; zy++) {
      for (let zx = 0; zx < 3; zx++) {
        const z = world.zone(zx, zy);
        for (let i = 0; i < z.object.length; i++) {
          const onMountain = z.landform[i] === MOUNTAIN;
          if (onMountain) {
            const lowBand = z.height[i] <= low;
            band[lowBand ? 'lowCells' : 'highCells']++;
            if (z.object[i]) band[lowBand ? 'lowTrees' : 'highTrees']++;
          }
          if (!z.object[i]) continue;
          objects++;
          expect(z.water[i]).toBe(LAYER_NONE);
          if (ROCKY.has(z.object[i] - 1)) {
            expect(z.surface[i]).toBe(S('rock')); // 岩壁與礦脈只長在岩石上
            continue;
          }
          expect([S('rock'), S('ice')]).not.toContain(z.surface[i]);
          if (onMountain) expect(z.height[i]).toBeLessThanOrEqual(treeline + 1);
        }
      }
    }
    expect(objects).toBeGreaterThan(0);
    expect(band.lowTrees).toBeGreaterThan(0); // 山地上有樹
    expect(band.highTrees / Math.max(1, band.highCells)).toBeLessThan(band.lowTrees / band.lowCells);
    for (const t of DATA.terrains) expect(DATA.objectIndex.has(t.id)).toBe(false);
  });

  test('樹幹那一格走不過去，樹冠其他格走得過去；矮叢沒有樹幹', () => {
    const z = world.zone(1, 1);
    const shrub = DATA.objectIndex.get('shrub');
    let trunks = 0;
    let canopy = 0;
    for (let i = 0; i < z.object.length; i++) {
      if (!z.object[i] || ROCKY.has(z.object[i] - 1)) continue;
      const x = Z + (i % Z);
      const y = Z + Math.floor(i / Z);
      if (z.objectPart[i] === PART_TRUNK) {
        trunks++;
        expect(z.object[i] - 1).not.toBe(shrub);
        expect(world.isPassable(x, y)).toBe(false);
      } else {
        canopy++;
        expect(world.isPassable(x, y)).toBe(true);
      }
    }
    expect(trunks).toBeGreaterThan(0);
    expect(canopy).toBeGreaterThan(trunks);
  });

  test('每格樹冠附近 3 格內都有同種、同高度層的樹幹（樹冠不跨層，也不會沒有根）', () => {
    const z = world.zone(1, 1);
    let checked = 0;
    for (let i = 0; i < z.object.length && checked < 400; i++) {
      const o = z.object[i];
      if (!o || !DATA.objects[o - 1].trunk || z.objectPart[i] === PART_TRUNK) continue;
      const x = i % Z;
      const y = Math.floor(i / Z);
      if (x < 3 || y < 3 || x > Z - 4 || y > Z - 4) continue; // 邊上的樹幹可能在隔壁區
      let found = false;
      for (let dy = -3; dy <= 3 && !found; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          const j = (y + dy) * Z + (x + dx);
          if (z.object[j] === o && z.objectPart[j] === PART_TRUNK && z.tier[j] === z.tier[i]) found = true;
        }
      }
      expect(found, `(${x}, ${y})`).toBe(true);
      checked++;
    }
    expect(checked).toBeGreaterThan(50);
  });

  test('格子的資訊', () => {
    const p = startPosition(world);
    const c = world.cell(p.x, p.y);
    expect(c.surface.passable).toBe(true);
    expect(c.landform).toBeTruthy();
    expect(c.height).toBeGreaterThanOrEqual(0);
    expect(c.height).toBeLessThanOrEqual(255);
    expect(c.shade).toBeGreaterThanOrEqual(0);
    expect(c.shade).toBeLessThan(8);
  });
});
