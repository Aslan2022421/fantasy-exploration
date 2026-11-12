// 遊戲世界：狀態只由「種子＋紀錄」決定。
// 每個動作先寫成一筆紀錄，再用 apply 套到狀態上；讀檔時把紀錄照做一遍，結果一定跟當初一樣。
// 每隔 CHECKPOINT_EVERY 筆存一次檢查點（狀態＋各條亂數），讀檔從最近的檢查點接著做

import { z } from 'zod';
import { createLog, RecordSchema } from '../core/records.js';
import { createStreams } from '../core/rng.js';
import { createMap, startPosition } from './map.js';
import { tryMove } from './move.js';

export const SAVE_FORMAT = 1;
export const CHECKPOINT_EVERY = 100;
const MAP_WIDTH = 80;
const MAP_HEIGHT = 50;
const PLAYER = 'player';

const StateSchema = z.object({ player: z.object({ x: z.number(), y: z.number() }), time: z.number() });
export const SaveSchema = z.object({
  format: z.literal(SAVE_FORMAT),
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
    default:
      return state;
  }
}

function build(seed) {
  const rng = createStreams(seed);
  const map = createMap(MAP_WIDTH, MAP_HEIGHT, rng.get('world'));
  return { rng, map };
}

function makeGame(seed, rng, map, log, initialState, checkpoint) {
  let state = initialState;
  let lastCheckpoint = checkpoint;

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
    map,
    log,
    rng,
    get state() {
      return state;
    },
    // 移動一步；撞牆回傳 null，不記錄
    move(dir, cause = null) {
      const from = state.player;
      const to = tryMove(map, from, dir);
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
    serialize() {
      return { format: SAVE_FORMAT, seed, records: log.all(), checkpoint: lastCheckpoint };
    },
  };
}

export function newGame(seed) {
  const { rng, map } = build(seed);
  const log = createLog();
  const rec = log.append({ time: 0, actor: PLAYER, verb: 'start', data: { at: startPosition(map) } });
  return makeGame(seed, rng, map, log, apply({ player: { x: 0, y: 0 }, time: 0 }, rec), null);
}

// 讀檔：格式不對回傳 null（呼叫端開新遊戲）。fromCheckpoint 為 false 時一律從頭重放（測試用）
export function loadGame(saved, { fromCheckpoint = true } = {}) {
  const parsed = SaveSchema.safeParse(saved);
  if (!parsed.success) return null;
  const { seed, records, checkpoint } = parsed.data;
  const { rng, map } = build(seed);
  let state = { player: { x: 0, y: 0 }, time: 0 };
  let from = 0;
  const useCheckpoint = fromCheckpoint && checkpoint && checkpoint.at < records.length;
  if (useCheckpoint) {
    state = structuredClone(checkpoint.state);
    rng.restore(checkpoint.rng);
    from = checkpoint.at + 1;
  }
  for (let i = from; i < records.length; i++) state = apply(state, records[i]);
  return makeGame(seed, rng, map, createLog(records), state, useCheckpoint ? checkpoint : null);
}
