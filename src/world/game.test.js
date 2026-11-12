import { describe, expect, test } from 'vitest';
import { CHECKPOINT_EVERY, loadGame, newGame } from './game.js';

const SEED = 20261112;

// 在空地上來回走，製造很多筆紀錄
function walkAround(game, n) {
  const dirs = ['e', 'w', 's', 'n', 'ne', 'sw'];
  let made = 0;
  for (let i = 0; made < n && i < n * 10; i++) if (game.move(dirs[i % dirs.length])) made++;
}

describe('世界紀錄', () => {
  test('開始遊戲就有第一筆紀錄', () => {
    const g = newGame(SEED);
    expect(g.log.get(0)).toMatchObject({ id: 0, verb: 'start', time: 0, cause: null });
  });

  test('移動記一筆、時間往前一格；撞牆不記', () => {
    const g = newGame(SEED);
    const rec = g.move('e') ?? g.move('w');
    expect(rec.verb).toBe('move');
    expect(g.state.time).toBe(1);
    expect(g.state.player).toEqual(rec.data.to);
    const size = g.log.size;
    for (let i = 0; i < 60; i++) g.move('n');
    expect(g.log.size).toBeLessThan(size + 60);
  });

  test('自動走的每一步都指回那次決定，順著起因找得到', () => {
    const g = newGame(SEED);
    const plan = g.plan({ x: 1, y: 1 }, 3);
    const step = g.move('e', plan.id) ?? g.move('w', plan.id);
    expect(g.log.causeChain(step.id).map((r) => r.verb)).toEqual(['move', 'plan']);
  });

  test('查看、決定路線不花時間', () => {
    const g = newGame(SEED);
    g.examine({ x: 3, y: 3 }, '空地');
    g.plan({ x: 3, y: 3 }, 5);
    expect(g.state.time).toBe(0);
  });
});

describe('存檔與重放', () => {
  test('存檔再讀檔，狀態一樣', () => {
    const g = newGame(SEED);
    walkAround(g, 30);
    const back = loadGame(structuredClone(g.serialize()));
    expect(back.state).toEqual(g.state);
    expect(back.log.size).toBe(g.log.size);
  });

  test('從檢查點重放和從頭重放，結果一樣', () => {
    const g = newGame(SEED);
    walkAround(g, CHECKPOINT_EVERY * 2 + 17);
    const saved = structuredClone(g.serialize());
    expect(saved.checkpoint).not.toBeNull();
    const a = loadGame(saved);
    const b = loadGame(saved, { fromCheckpoint: false });
    expect(a.state).toEqual(b.state);
    expect(a.rng.snapshot()).toEqual(b.rng.snapshot());
    expect(a.state).toEqual(g.state);
  });

  test('同一份紀錄重放兩次，結果完全一樣', () => {
    const g = newGame(SEED);
    walkAround(g, 50);
    const saved = structuredClone(g.serialize());
    expect(loadGame(saved, { fromCheckpoint: false }).state).toEqual(loadGame(saved, { fromCheckpoint: false }).state);
  });

  test('格式不對的存檔回傳 null', () => {
    expect(loadGame(null)).toBeNull();
    expect(loadGame({ format: 999, seed: 1, records: [], checkpoint: null })).toBeNull();
    expect(loadGame({ format: 1, seed: 1, records: [{ id: 'x' }], checkpoint: null })).toBeNull();
  });
});
