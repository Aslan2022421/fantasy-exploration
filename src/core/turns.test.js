import { expect, test } from 'vitest';
import { createTurnLoop } from './turns.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

test('開始後輪到冒險者，時間從 0 起算', () => {
  const t = createTurnLoop();
  t.start();
  expect(t.playersTurn).toBe(true);
  expect(t.time).toBe(0);
});

test('做完動作就交回，時間照花費往前走，又輪到冒險者', async () => {
  const t = createTurnLoop();
  t.start();
  expect(t.endTurn(1)).toBe(true);
  expect(t.playersTurn).toBe(false);
  await tick();
  expect(t.playersTurn).toBe(true);
  expect(t.time).toBe(1);
  t.endTurn(3);
  await tick();
  expect(t.time).toBe(4);
});

test('還沒輪到時不能交回', () => {
  const t = createTurnLoop();
  expect(t.endTurn(1)).toBe(false);
});
