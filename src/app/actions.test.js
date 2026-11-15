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
