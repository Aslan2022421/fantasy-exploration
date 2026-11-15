import { beforeAll, describe, expect, test } from 'vitest';
import { DATA } from '../data/load.js';
import { describeRecord } from './describe.js';
import { loadGame, newGame, SIGHT_RANGE } from './game.js';
import { findPathNextTo, stepDirection } from './path.js';
import { describePlace } from './place.js';

const SEED = 20261112;

// 離冒險者最近的一群（往外找，半徑逐步放大）
function nearestHerd(game) {
  const p = game.state.player;
  for (let r = 20; r <= 200; r += 20) {
    const list = game.world.herdsNear(p.x, p.y, r).sort((a, b) => a.near.d - b.near.d);
    if (list.length) return list[0];
  }
  return null;
}

function walkTo(game, herd) {
  const cr = game.world.creatureAt(herd.near.x, herd.near.y);
  const steps = findPathNextTo(game.world, game.state.player, { x: cr.member.x, y: cr.member.y, cells: cr.cells });
  for (const s of steps) if (!game.move(stepDirection(game.state.player, s))) break;
  return cr;
}

describe('看見生物', () => {
  beforeAll(() => newGame(SEED), 30000);

  test('走到離一群 SIGHT_RANGE 格內，第一次見到那個物種記一筆 spot，起因是那一步，不花時間', () => {
    const g = newGame(SEED);
    const herd = nearestHerd(g);
    expect(herd).not.toBeNull();
    walkTo(g, herd);
    const id = DATA.species[herd.species].id;
    expect(g.state.seen[id]).toBeDefined();
    const rec = g.log.get(g.state.seen[id]);
    expect(rec.verb).toBe('spot');
    expect(g.log.get(rec.cause).verb).toBe('move');
    expect(rec.data).toMatchObject({ species: id, herd: herd.herd.id });
    expect(rec.data.count).toBe(herd.herd.members.length);
    expect(describeRecord(rec)).toContain(DATA.species[herd.species].name);
    // 同一物種不再記第二次
    expect(g.log.all().filter((r) => r.verb === 'spot' && r.data.species === id)).toHaveLength(1);
  });

  test('存檔再讀檔、從頭重放，見過的物種一樣', () => {
    const g = newGame(SEED);
    walkTo(g, nearestHerd(g));
    const saved = structuredClone(g.serialize());
    expect(loadGame(saved)?.state).toEqual(g.state);
    expect(loadGame(saved, { fromCheckpoint: false })?.state).toEqual(g.state);
    expect(Object.keys(g.state.seen).length).toBeGreaterThanOrEqual(1);
  });

  test('生物那幾格擋路，走不過去；移動被擋住不記；查看寫出數值塊與本能', () => {
    const g = newGame(SEED);
    const herd = nearestHerd(g);
    const cr = g.world.creatureAt(herd.near.x, herd.near.y);
    for (const c of cr.cells) expect(g.world.isPassable(c.x, c.y)).toBe(false);
    const text = describePlace(g.world, cr.member.x, cr.member.y);
    const sp = DATA.species[cr.species];
    expect(text.startsWith(`${sp.name}（一群 ${cr.herd.members.length} 隻，d`)).toBe(true);
    expect(text).toContain(`本能：${sp.instinct}`);
  });

  test('戰鬥還沒做：對生物動手記一筆 refuse，不改狀態', () => {
    const g = newGame(SEED);
    const before = structuredClone(g.state);
    const herd = nearestHerd(g);
    const cr = g.world.creatureAt(herd.near.x, herd.near.y);
    const rec = g.refuse(cr.member, DATA.species[cr.species].id);
    expect(rec.verb).toBe('refuse');
    expect(g.state).toEqual(before);
    expect(describeRecord(rec)).toContain('還不能對');
  });

  test('視野的距離是 10 格', () => {
    expect(SIGHT_RANGE).toBe(10);
  });
});
