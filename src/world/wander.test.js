import { beforeAll, describe, expect, test } from 'vitest';
import { DATA } from '../data/load.js';
import { newGame } from './game.js';
import { herdOffset, WANDER } from './wander.js';

const SEED = 20261112;

describe('生物平常的遊蕩', () => {
  beforeAll(() => newGame(SEED), 30000);

  test('位置只看種子、群與時間：同一個時間一樣；時間往前走，有群換了位置；都在落腳處附近', () => {
    const g = newGame(SEED);
    const p = g.state.player;
    const herds = g.world.herdsNear(p.x, p.y, 200).map((h) => h.herd);
    expect(herds.length).toBeGreaterThan(0);
    let movedAny = false;
    for (const herd of herds) {
      const sp = DATA.species[herd.species];
      const r = WANDER[sp.diet].radius;
      for (const t of [0, 500, 1500, 4000]) {
        const a = herdOffset(SEED, herd, sp, t).now;
        expect(herdOffset(SEED, herd, sp, t).now).toEqual(a);
        expect(Math.max(Math.abs(a.x), Math.abs(a.y))).toBeLessThanOrEqual(r);
        if (a.x || a.y) movedAny = true;
      }
    }
    expect(movedAny).toBe(true);
  });

  test('換位置時一格一格走：相鄰兩個時間點最多差一格', () => {
    const g = newGame(SEED);
    const herd = g.world.herdsNear(g.state.player.x, g.state.player.y, 200)[0].herd;
    const sp = DATA.species[herd.species];
    let prev = herdOffset(SEED, herd, sp, 0).now;
    for (let t = 1; t < 3000; t++) {
      const now = herdOffset(SEED, herd, sp, t).now;
      expect(Math.max(Math.abs(now.x - prev.x), Math.abs(now.y - prev.y))).toBeLessThanOrEqual(1);
      prev = now;
    }
  });

  test('世界上的生物跟著時間走、不會站在冒險者身上；查得到的位置跟 creatureById 一致', () => {
    const g = newGame(SEED);
    for (let i = 0; i < 30; i++) g.move(['e', 'w'][i % 2]);
    const p = g.state.player;
    for (const c of g.world.creaturesNear(p.x, p.y, 60)) {
      expect(c.cells.some((x) => x.x === p.x && x.y === p.y)).toBe(false);
      expect(g.world.creatureAt(c.cells[0].x, c.cells[0].y)?.id).toBe(c.id);
    }
  });
});
