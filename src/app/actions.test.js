import { expect, test } from 'vitest';
import { DATA } from '../data/load.js';
import { newGame } from '../world/game.js';
import { findPathNextTo, stepDirection } from '../world/path.js';
import { createActions } from './actions.js';

test('選定礦坑後的路線：貼著佔的任一格就是到了，不標步數（跟 Q 一樣）', () => {
  const game = newGame(20261112);
  const p = game.state.player;
  let anchor = null;
  for (let r = 1; r < 200 && !anchor; r++)
    for (let dy = -r; dy <= r && !anchor; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const o = game.world.objectAt(p.x + dx, p.y + dy);
        if (o < 0 || !DATA.objects[o].layers) continue;
        anchor = game.world.anchorAt(p.x + dx, p.y + dy);
        break;
      }
  expect(anchor).not.toBeNull();
  // 走到礦坑右下角那格旁邊：離左上角的錨點至少 3 格
  const corner = { x: anchor.x + 2, y: anchor.y + 2 };
  for (const step of findPathNextTo(game.world, game.state.player, corner))
    game.move(stepDirection(game.state.player, step));
  const at = game.state.player;
  expect(Math.max(Math.abs(at.x - anchor.x), Math.abs(at.y - anchor.y))).toBeGreaterThan(1);
  const actions = createActions({
    game,
    turns: { playersTurn: true, endTurn() {} },
    worldView: { invalidateCells() {} },
    describe: () => '',
    persist() {},
    redraw() {},
  });
  actions.look(anchor);
  expect(actions.shownPath()).toEqual({ steps: [], reachable: true });
}, 30000);

test('按 Q 攻擊一下，生物照時間接著動，不用再按別的鍵', () => {
  const game = newGame(20261112);
  const p = game.state.player;
  let near = null;
  for (let r = 20; r <= 200 && !near; r += 20)
    near = game.world.herdsNear(p.x, p.y, r).sort((a, b) => a.near.d - b.near.d)[0] ?? null;
  const cr = game.world.creatureAt(near.near.x, near.near.y);
  // 起點在村莊裡，生物在 24 格外，走過去的時候牠會遊蕩：走到了再看一次，還沒貼著就再走
  for (let k = 0; k < 6; k++) {
    const now = game.world.creatureById(cr.id);
    const steps = now && findPathNextTo(game.world, game.state.player, now);
    if (!steps?.length) break;
    for (const step of steps) if (!game.move(stepDirection(game.state.player, step))) break;
  }
  // 交回排程之後要等下一拍才又輪到冒險者
  const turns = {
    playersTurn: true,
    endTurn() {
      this.playersTurn = false;
    },
  };
  const actions = createActions({
    game,
    turns,
    worldView: { invalidateCells() {} },
    describe: () => '',
    persist() {},
    redraw() {},
  });
  const target = game.world.creatureById(cr.id);
  actions.look({ x: target.member.x, y: target.member.y });
  actions.actOnTarget();
  const verbs = game.log.all().map((r) => r.verb);
  const at = verbs.lastIndexOf('attack');
  expect(at).toBeGreaterThan(0);
  // 冒險者那一下之後，生物接著動（走一格或出手），或戰鬥已經結束
  const first = game.log.all().findIndex((r) => r.verb === 'attack' && r.actor === 'player');
  const after = game.log.all().slice(first + 1);
  expect(after.some((r) => r.actor !== 'player' || ['victory', 'escape', 'down'].includes(r.verb))).toBe(true);
}, 30000);
