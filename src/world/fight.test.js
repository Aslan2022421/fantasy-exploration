import { beforeAll, describe, expect, test } from 'vitest';
import { DATA } from '../data/load.js';
import { distanceTo } from './chase.js';
import { describeRecord } from './describe.js';
import { loadGame, newGame } from './game.js';
import { findPathNextTo, stepDirection } from './path.js';

const SEED = 20261112;

// 離起點最近的一群裡最近的那一隻
function nearestCreature(game) {
  const p = game.state.player;
  for (let r = 20; r <= 200; r += 20) {
    const list = game.world.herdsNear(p.x, p.y, r).sort((a, b) => a.near.d - b.near.d);
    if (list.length) return game.world.creatureAt(list[0].near.x, list[0].near.y);
  }
  return null;
}

// 一個動作一個動作打：貼著就攻擊，不然往目標走一格；直到戰鬥結束
function fightUntilDone(game, firstId, actions = 400) {
  let id = firstId;
  let started = false;
  for (let i = 0; i < actions; i++) {
    const target = game.world.creatureById(id) ?? game.world.creatureById(game.fight.liveFoes()[0] ?? '');
    if (!target) break;
    id = target.id;
    if (distanceTo(target.cells, game.state.player) <= 1) game.attack(id);
    else {
      const step = (findPathNextTo(game.world, game.state.player, target) ?? [])[0];
      if (!step || !game.move(stepDirection(game.state.player, step))) break;
    }
    if (game.state.combat) started = true;
    else if (started) break;
  }
}

describe('戰鬥', () => {
  beforeAll(() => newGame(SEED), 30000);

  test('對生物按 Q 就開戰，那一群一起加入；打到結束，紀錄寫出擲骰與總值', () => {
    const g = newGame(SEED);
    const cr = nearestCreature(g);
    fightUntilDone(g, cr.id);
    const verbs = g.log.all().map((r) => r.verb);
    expect(verbs).toContain('engage');
    expect(verbs).toContain('attack');
    expect(['victory', 'escape', 'down'].some((v) => verbs.includes(v))).toBe(true);
    const engage = g.log.all().find((r) => r.verb === 'engage');
    expect(engage.data.foes.map((f) => f.id)).toContain(cr.id);
    const hit = g.log.all().find((r) => r.verb === 'attack');
    expect(describeRecord(hit)).toMatch(/擲 \d+[+-]\d+＝\d+ 對防禦 \d+/);
  });

  test('倒下的生物從地圖上消失；存檔再讀檔、從頭重放結果一樣', () => {
    const g = newGame(SEED);
    fightUntilDone(g, nearestCreature(g).id);
    const dead = Object.entries(g.state.creatures).filter(([, c]) => c.dead);
    for (const [id] of dead) expect(g.world.creatureById(id)).toBeNull();
    const saved = structuredClone(g.serialize());
    expect(loadGame(saved)?.state).toEqual(g.state);
    expect(loadGame(saved, { fromCheckpoint: false })?.state).toEqual(g.state);
  });

  test('照時間輪流：冒險者攻擊花一個動作的刻數，之後每隻生物的下一個動作都排在現在以後；生物一次只走一格', () => {
    const g = newGame(SEED);
    const cr = nearestCreature(g);
    for (const s of findPathNextTo(g.world, g.state.player, cr)) if (!g.move(stepDirection(g.state.player, s))) break;
    const target = g.state.combat ? g.fight.liveFoes()[0] : cr.id;
    const t0 = g.state.time;
    const rec = g.attack(target);
    if (rec.refused) return; // 生物撲上來時沒貼著
    expect(g.state.time).toBe(t0 + g.hero.ticks);
    if (g.state.combat)
      for (const id of g.fight.liveFoes()) expect(g.state.combat.next[id]).toBeGreaterThanOrEqual(g.state.time);
    for (const r of g.log.all().filter((x) => x.verb === 'cmove'))
      expect(
        Math.max(Math.abs(r.data.to.x - r.data.from.x), Math.abs(r.data.to.y - r.data.from.y)),
      ).toBeLessThanOrEqual(1);
  });

  test('草食的那一群：只有被打的那隻還手，看得到的同伴逃開、越逃越遠', () => {
    const start = newGame(SEED).state.player;
    const herds = newGame(SEED)
      .world.herdsNear(start.x, start.y, 300)
      .filter((h) => DATA.species[h.herd.species].diet === 'herbivore' && h.herd.members.length > 2)
      .sort((a, b) => a.near.d - b.near.d)
      .slice(0, 8);
    let tested = false;
    for (const { herd } of herds) {
      const g = newGame(SEED);
      const cr = g.world.creatureById(`${herd.id}#0`);
      for (const s of findPathNextTo(g.world, g.state.player, cr) ?? [])
        if (!g.move(stepDirection(g.state.player, s))) break;
      if (g.state.combat || distanceTo(cr.cells, g.state.player) > 1) continue; // 半路被掠食生物撲上來、或走不到
      g.attack(cr.id);
      const engage = g.log.all().find((r) => r.verb === 'engage');
      expect(engage.data.foes.map((f) => f.id)).toEqual([cr.id]);
      for (const f of engage.data.flee) expect(f.id.startsWith(herd.id)).toBe(true);
      if (!engage.data.flee.length || !g.state.combat?.flee.length) continue;
      const id = g.state.combat.flee[0];
      const before = distanceTo(g.world.creatureById(id).cells, g.state.player);
      g.attack(cr.id);
      const now = g.world.creatureById(id);
      if (!g.state.combat?.flee.includes(id)) continue;
      expect(distanceTo(now.cells, g.state.player)).toBeGreaterThan(before);
      tested = true;
      break;
    }
    expect(tested).toBe(true);
  }, 60000);

  test('休息每天一次，戰鬥中不行', () => {
    const g = newGame(SEED);
    const rec = g.rest();
    expect(rec.verb).toBe('rest');
    expect(g.state.time).toBe(4 * 3600);
    expect(g.rest()).toEqual({ refused: 'today' });
  });
});
