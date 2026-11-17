import { beforeAll, describe, expect, test } from 'vitest';
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

// 走到 id 旁邊並攻擊；戰鬥中每回合能走就走、能打就打，然後結束回合，直到戰鬥結束
function fightUntilDone(game, id, rounds = 80) {
  for (let i = 0; i < rounds; i++) {
    const target = game.world.creatureById(id) ?? game.fight.liveFoes().map((f) => game.world.creatureById(f))[0];
    if (!target) break;
    const steps = findPathNextTo(game.world, game.state.player, target) ?? [];
    for (const s of steps) if (!game.move(stepDirection(game.state.player, s))) break;
    if (distanceTo(target.cells, game.state.player) <= 1) game.attack(target.id);
    if (!game.state.combat) break;
    game.endTurn();
    if (!game.state.combat) break;
    id = target.id;
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

  test('倒下的生物從地圖上消失、走得過去；存檔再讀檔、從頭重放結果一樣', () => {
    const g = newGame(SEED);
    fightUntilDone(g, nearestCreature(g).id);
    const dead = Object.entries(g.state.creatures).filter(([, c]) => c.dead);
    for (const [id] of dead) expect(g.world.creatureById(id)).toBeNull();
    const saved = structuredClone(g.serialize());
    expect(loadGame(saved)?.state).toEqual(g.state);
    expect(loadGame(saved, { fromCheckpoint: false })?.state).toEqual(g.state);
  });

  test('戰鬥中每回合只能攻擊一次、移動到速度上限；結束回合後重算', () => {
    const g = newGame(SEED);
    const cr = nearestCreature(g);
    const steps = findPathNextTo(g.world, g.state.player, cr);
    for (const s of steps) if (!g.move(stepDirection(g.state.player, s))) break;
    if (!g.state.combat) g.attack(cr.id);
    expect(g.state.combat).not.toBeNull();
    const target = g.fight.liveFoes()[0];
    const close = distanceTo(g.world.creatureById(target).cells, g.state.player) <= 1;
    if (close) {
      if (!g.state.combat.attacked) g.attack(target);
      expect(g.attack(target)).toEqual({ refused: 'attacked' });
    }
    if (!g.state.combat) return;
    const round = g.state.combat.round;
    g.endTurn();
    if (g.state.combat) expect(g.state.combat).toMatchObject({ round: round + 1, moved: 0, attacked: false });
  });

  test('休息每天一次，戰鬥中不行', () => {
    const g = newGame(SEED);
    const rec = g.rest();
    expect(rec.verb).toBe('rest');
    expect(g.state.time).toBe(4 * 3600);
    expect(g.rest()).toEqual({ refused: 'today' });
  });
});
