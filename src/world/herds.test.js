import { describe, expect, test } from 'vitest';
import { DATA } from '../data/load.js';
import { HERD, habitatWeight, herdTargets, speciesFootprint } from './herds.js';
import { LAND } from './landform.js';
import { createWorld } from './world.js';

const SMALL = { zonesX: 3, zonesY: 3 };
const SEEDS = [20261112, 7, 31337, 99];
const worlds = SEEDS.map((s) => createWorld(s, DATA, SMALL));

function* allHerds(world) {
  for (let zy = 0; zy < world.zonesY; zy++)
    for (let zx = 0; zx < world.zonesX; zx++) for (const h of world.herdsOf(zx, zy)) yield { zx, zy, herd: h };
}

// 一群落腳處的環境（跟 herds.js 用同一套條件）
function envOf(world, x, y) {
  const c = world.cell(x, y);
  let water = 9;
  for (let r = 1; r <= 3 && water === 9; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const wc = world.cell(x + dx, y + dy);
        if (wc?.water && wc.water.style !== 'swamp') water = Math.min(water, r);
      }
  return {
    biome: c.biome.id,
    tier: world.tierAt(x, y),
    mountain: world.heightAt(x, y) > 0 && c.landform.id === 'mountain',
    water,
  };
}

describe('物種成群', () => {
  test('每區的群數不超過 numbers 記的目標；湖海的區沒有；沒有草食就沒有掠食', () => {
    let herds = 0;
    for (const w of worlds)
      for (let zy = 0; zy < w.zonesY; zy++)
        for (let zx = 0; zx < w.zonesX; zx++) {
          const list = w.herdsOf(zx, zy);
          const num = w.region(zx, zy).numbers;
          const count = (diet) => list.filter((h) => DATA.species[h.species].diet === diet).length;
          expect(count('herbivore')).toBeLessThanOrEqual(num.herbivores);
          expect(count('predator')).toBeLessThanOrEqual(num.predators);
          if (!count('herbivore')) expect(count('predator')).toBe(0);
          if (w.region(zx, zy).height < LAND.water) expect(list).toHaveLength(0);
          herds += list.length;
        }
    expect(herds).toBeGreaterThan(20);
  });

  test('目標群數在範圍裡，只看種子與區座標', () => {
    for (let zx = 0; zx < 30; zx++) {
      const t = herdTargets(1, zx, 2);
      expect(t.herbivores).toBeGreaterThanOrEqual(HERD.herbivores[0]);
      expect(t.herbivores).toBeLessThanOrEqual(HERD.herbivores[1]);
      expect(t.predators).toBeGreaterThanOrEqual(HERD.predators[0]);
      expect(t.predators).toBeLessThanOrEqual(HERD.predators[1]);
      expect(herdTargets(1, zx, 2)).toEqual(t);
    }
  });

  test('每隻整隻在那一區裡、佔的格子沒有水也沒有物件、同一個高度層、走得過去、彼此不重疊；一群的隻數在範圍裡', () => {
    for (const w of worlds) {
      const used = new Set();
      for (const { zx, zy, herd } of allHerds(w)) {
        const sp = DATA.species[herd.species];
        expect(herd.members.length).toBeGreaterThanOrEqual(1);
        expect(herd.members.length).toBeLessThanOrEqual(sp.count[1]);
        const Z = w.zoneSize;
        for (const m of herd.members) {
          const tier = w.tierAt(m.x, m.y);
          for (const [dx, dy] of speciesFootprint(sp.cells)) {
            const x = m.x + dx;
            const y = m.y + dy;
            expect(Math.floor(x / Z), `${sp.id} 的格子跨出那一區`).toBe(zx);
            expect(Math.floor(y / Z)).toBe(zy);
            expect(w.waterAt(x, y)).toBe(-1);
            expect(w.objectAt(x, y)).toBe(-1);
            expect(w.tierAt(x, y)).toBe(tier);
            expect(w.isPassable(x, y)).toBe(true);
            expect(used.has(`${x},${y}`), `${x},${y} 被兩隻佔了`).toBe(false);
            used.add(`${x},${y}`);
          }
        }
      }
    }
  });

  test('落腳處在物種的棲地裡、兩群至少隔 gap 格、離起點夠遠', () => {
    for (const w of worlds) {
      const start = w.geography.start;
      const leaders = new Map();
      for (const { zx, zy, herd } of allHerds(w)) {
        const sp = DATA.species[herd.species];
        const lead = herd.members[0];
        expect(habitatWeight(sp, envOf(w, lead.x, lead.y)), `${sp.id} 在 ${lead.x},${lead.y}`).toBeGreaterThan(0);
        expect(Math.max(Math.abs(lead.x - start.x), Math.abs(lead.y - start.y))).toBeGreaterThanOrEqual(
          HERD.startClear,
        );
        const key = `${zx},${zy}`;
        for (const o of leaders.get(key) ?? [])
          expect(Math.max(Math.abs(o.x - lead.x), Math.abs(o.y - lead.y))).toBeGreaterThanOrEqual(HERD.gap);
        leaders.set(key, [...(leaders.get(key) ?? []), lead]);
        for (const m of herd.members.slice(1)) {
          const d = Math.max(Math.abs(m.x - lead.x), Math.abs(m.y - lead.y));
          expect(d).toBeGreaterThanOrEqual(HERD.spread[0]);
          expect(d).toBeLessThanOrEqual(HERD.spread[1]);
        }
      }
    }
  });

  test('重生一次結果一樣（只看種子與座標，不看生成順序）', () => {
    const again = createWorld(SEEDS[0], DATA, SMALL);
    const order = [];
    for (let zy = 2; zy >= 0; zy--) for (let zx = 2; zx >= 0; zx--) order.push([zx, zy]); // 倒著生
    for (const [zx, zy] of order) expect(again.herdsOf(zx, zy)).toEqual(worlds[0].herdsOf(zx, zy));
  });

  test('不同地形遇到不同的生物：山上是山地的物種、沙漠與凍原的物種不重疊', () => {
    const byBiome = new Map();
    for (const w of worlds)
      for (const { herd } of allHerds(w)) {
        const sp = DATA.species[herd.species];
        const lead = herd.members[0];
        const e = envOf(w, lead.x, lead.y);
        if (e.mountain)
          expect(
            sp.habitat.some((r) => r.mountain === true),
            `${sp.id} 在山上`,
          ).toBe(true);
        else
          expect(
            sp.habitat.every((r) => r.mountain === true),
            `${sp.id} 在平地`,
          ).toBe(false);
        const set = byBiome.get(e.biome) ?? new Set();
        set.add(sp.id);
        byBiome.set(e.biome, set);
      }
    const desert = byBiome.get('desert') ?? new Set();
    const tundra = byBiome.get('tundra') ?? new Set();
    for (const id of desert) expect(tundra.has(id)).toBe(false);
    expect(byBiome.size).toBeGreaterThanOrEqual(3);
  });

  test('寒帶、山地、潮濕靠水的族群記下環境，數值塊會加答案', () => {
    for (const w of worlds)
      for (const { herd } of allHerds(w)) {
        expect(Object.keys(herd.env).sort()).toEqual(['cold', 'mountain', 'water']);
      }
  });
});

describe('佔格', () => {
  test('1 格、2 格橫排、4 格 2×2', () => {
    expect(speciesFootprint(1)).toEqual([[0, 0]]);
    expect(speciesFootprint(2)).toEqual([
      [0, 0],
      [1, 0],
    ]);
    expect(speciesFootprint(4)).toHaveLength(4);
  });
});
