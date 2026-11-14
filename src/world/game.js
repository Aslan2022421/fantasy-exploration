// 遊戲世界：狀態只由「種子＋紀錄」決定。
// 每個動作先寫成一筆紀錄，再用 apply 套到狀態上；讀檔時把紀錄照做一遍，結果一定跟當初一樣。
// 每隔 CHECKPOINT_EVERY 筆存一次檢查點（狀態＋各條亂數），讀檔從最近的檢查點接著做。
// 地圖不存：世界用種子重生（world.js），所以存檔只有種子、紀錄與檢查點。
// 地形生成一改，舊紀錄就對不上新地圖：存檔記下世界版本（WORLD_VERSION），不同就不讀；
// 讀出來冒險者站在走不過去的格子上，也當成不相容

import { RNG } from 'rot-js';
import { z } from 'zod';
import { createLog, RecordSchema } from '../core/records.js';
import { createStreams, streamSeed } from '../core/rng.js';
import { DATA } from '../data/load.js';
import { withChanges } from './changes.js';
import { applyGather, planGather, sourceAt } from './gather.js';
import { tryMove } from './move.js';
import { createWorld, startPosition, WORLD_VERSION } from './world.js';

export const SAVE_FORMAT = 4; // 3：加上世界版本；4：狀態加上背包、現存數量、採過的格子
export const CHECKPOINT_EVERY = 100;
const PLAYER = 'player';

const Counts = z.record(z.string(), z.number());
const StateSchema = z.object({
  player: z.object({ x: z.number(), y: z.number() }),
  time: z.number(),
  bag: Counts, // 背包：材料 → 幾個
  stock: Counts, // 現存數量（算上限用）：採到的都算，之後消耗了才扣
  cells: z.record(z.string(), z.object({}).passthrough()), // 採過的格子（changes.js）
});
const emptyState = () => ({ player: { x: 0, y: 0 }, time: 0, bag: {}, stock: {}, cells: {} });
export const SaveSchema = z.object({
  format: z.literal(SAVE_FORMAT),
  world: z.literal(WORLD_VERSION),
  seed: z.number(),
  records: z.array(RecordSchema),
  checkpoint: z
    .object({ at: z.number(), state: StateSchema, rng: z.record(z.string(), z.array(z.number())) })
    .nullable(),
});

// 一筆紀錄對狀態的影響；沒列到的動作（查看、決定路線、被擋住）不改變狀態
export function apply(state, rec) {
  switch (rec.verb) {
    case 'start':
      return { ...state, player: { ...rec.data.at }, time: rec.time };
    case 'move':
      return { ...state, player: { ...rec.data.to }, time: rec.time + rec.data.duration };
    case 'gather':
      return { ...applyGather(state, rec.data), time: rec.time + rec.data.duration };
    default:
      return state;
  }
}

// 世界只由種子決定、建好後不會被改（區的快取除外），同一個種子重用上一次建好的（96×96 區建一次要 2 秒）
let lastWorld = null;
function build(seed) {
  if (lastWorld?.seed !== seed) lastWorld = createWorld(seed, DATA);
  return { rng: createStreams(seed), world: lastWorld };
}

function makeGame(seed, rng, baseWorld, log, initialState, checkpoint) {
  let state = initialState;
  let lastCheckpoint = checkpoint;
  const world = withChanges(baseWorld, DATA, () => state.cells);

  function record(entry) {
    const rec = log.append({ time: state.time, actor: PLAYER, ...entry });
    state = apply(state, rec);
    if ((rec.id + 1) % CHECKPOINT_EVERY === 0) {
      lastCheckpoint = { at: rec.id, state: structuredClone(state), rng: rng.snapshot() };
    }
    return rec;
  }

  return {
    seed,
    world,
    log,
    rng,
    get state() {
      return state;
    },
    // 移動一步；擋住回傳 null，不記錄
    move(dir, cause = null) {
      const from = state.player;
      const to = tryMove(world, from, dir);
      if (to.x === from.x && to.y === from.y) return null;
      return record({ verb: 'move', data: { from, to, dir, duration: 1 }, cause });
    },
    plan(to, steps) {
      return record({ verb: 'plan', target: to, data: { steps } });
    },
    examine(at, what) {
      return record({ verb: 'examine', target: at, data: { what } });
    },
    blocked(cause) {
      return record({ verb: 'blocked', data: {}, cause });
    },
    // 這格能不能採：回傳那處來源（樹冠會換成樹幹那格）或 null
    sourceAt: (at) => sourceAt(world, DATA, at.x, at.y),
    // 採 at 那處來源一次：要站在旁邊（或上面）。不能採回傳 null，不記錄。
    // 每次採集的骰子用「主種子＋這筆紀錄的編號」開，讀檔從檢查點接著做也一樣
    gather(at, cause = null) {
      const src = sourceAt(world, DATA, at.x, at.y);
      const p = state.player;
      if (!src || Math.max(Math.abs(src.x - p.x), Math.abs(src.y - p.y)) > 1) return null;
      const dice = RNG.clone().setSeed(streamSeed(seed, `gather:${log.size}`));
      return record({
        verb: 'gather',
        target: { x: src.x, y: src.y },
        data: planGather(world, DATA, state, src, dice),
        cause,
      });
    },
    serialize() {
      return { format: SAVE_FORMAT, world: WORLD_VERSION, seed, records: log.all(), checkpoint: lastCheckpoint };
    },
  };
}

export function newGame(seed) {
  const { rng, world } = build(seed);
  const log = createLog();
  const rec = log.append({ time: 0, actor: PLAYER, verb: 'start', data: { at: startPosition(world) } });
  return makeGame(seed, rng, world, log, apply(emptyState(), rec), null);
}

// 讀檔：格式不對回傳 null（呼叫端開新遊戲）。fromCheckpoint 為 false 時一律從頭重放（測試用）
export function loadGame(saved, { fromCheckpoint = true } = {}) {
  const parsed = SaveSchema.safeParse(saved);
  if (!parsed.success) return null;
  const { seed, records, checkpoint } = parsed.data;
  const { rng, world } = build(seed);
  let state = emptyState();
  let from = 0;
  const useCheckpoint = fromCheckpoint && checkpoint && checkpoint.at < records.length;
  if (useCheckpoint) {
    state = structuredClone(checkpoint.state);
    rng.restore(checkpoint.rng);
    from = checkpoint.at + 1;
  }
  for (let i = from; i < records.length; i++) state = apply(state, records[i]);
  const game = makeGame(seed, rng, world, createLog(records), state, useCheckpoint ? checkpoint : null);
  // 保險：套完紀錄後冒險者站在走不過去的格子上，表示紀錄跟這張地圖對不上，當成不相容
  if (!game.world.isPassable(state.player.x, state.player.y)) return null;
  return game;
}
