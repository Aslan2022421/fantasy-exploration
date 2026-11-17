// 遊戲世界：狀態只由「種子＋紀錄」決定。
// 每個動作先寫成一筆紀錄，再用 apply 套到狀態上；讀檔時把紀錄照做一遍，結果一定跟當初一樣。
// 每隔 CHECKPOINT_EVERY 筆存一次檢查點（狀態＋各條亂數），讀檔從最近的檢查點接著做。
// 地圖不存：世界用種子重生（world.js），所以存檔只有種子、紀錄與檢查點。
// 地形生成一改，舊紀錄就對不上新地圖：存檔記下世界版本（WORLD_VERSION），不同就不讀；
// 讀出來冒險者站在走不過去的格子上，也當成不相容

import { RNG } from 'rot-js';
import { z } from 'zod';
import { createLog, RecordSchema } from '../core/records.js';
import { createStreams, diceSeed, streamSeed } from '../core/rng.js';
import { DATA } from '../data/load.js';
import { withChanges } from './changes.js';
import { withCreatures } from './creatures.js';
import { applyFight, createFight } from './fight.js';
import { applyGather, planGather, sourceAt, touches } from './gather.js';
import { heroStats, presetHero } from './hero.js';
import { tryMove } from './move.js';
import { createWorld, startPosition, WORLD_VERSION } from './world.js';

// 3：加上世界版本；4：狀態加上背包、現存數量、採過的格子；5：狀態加上見過的物種；
// 6：時間改成刻（1 刻＝0.25 秒）、狀態加上冒險者、生命、戰鬥、動過的生物、休息
export const SAVE_FORMAT = 6;
export const SIGHT_RANGE = 10; // 走到離一群生物幾格內，算第一次見到那個物種
export const CHECKPOINT_EVERY = 100;
const GATHER_TICKS = 4; // 採集資料的時間單位是「中等身高走一格」＝4 刻
const PLAYER = 'player';

const Counts = z.record(z.string(), z.number());
const StateSchema = z.object({
  player: z.object({ x: z.number(), y: z.number() }),
  time: z.number(), // 刻
  bag: Counts, // 背包：材料 → 幾個
  stock: Counts, // 現存數量（算上限用）：採到的都算，之後消耗了才扣
  cells: z.record(z.string(), z.object({}).passthrough()), // 採過的格子（changes.js）
  seen: z.record(z.string(), z.number()), // 見過的物種 → 第一次見到是哪一筆紀錄
  hero: z.object({}).passthrough().nullable(), // 冒險者的 sheet（hero.js）
  hp: z.number(),
  creatures: z.record(z.string(), z.object({}).passthrough()), // 動過的生物（creatures.js）
  combat: z.object({}).passthrough().nullable(), // 戰鬥中（fight.js）
  restDay: z.number(), // 哪一天休息過
});
const emptyState = () => ({
  player: { x: 0, y: 0 },
  time: 0,
  bag: {},
  stock: {},
  cells: {},
  seen: {},
  hero: null,
  hp: 0,
  creatures: {},
  combat: null,
  restDay: -1,
});
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
      return { ...state, player: { ...rec.data.at }, time: rec.time, hero: rec.data.hero, hp: rec.data.hp };
    case 'move': {
      const moved = { ...state, player: { ...rec.data.to }, time: rec.time + rec.data.duration };
      return state.combat ? { ...moved, combat: { ...state.combat, moved: state.combat.moved + 1 } } : moved;
    }
    case 'gather':
      return { ...applyGather(state, rec.data), time: rec.time + rec.data.duration };
    case 'spot':
      return { ...state, seen: { ...state.seen, [rec.data.species]: rec.id } };
    default:
      return applyFight(state, rec) ?? state;
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
  const world = withCreatures(
    withChanges(baseWorld, DATA, () => state.cells),
    DATA,
    () => state.creatures,
  );

  function record(entry) {
    const rec = log.append({ time: state.time, actor: PLAYER, ...entry });
    state = apply(state, rec);
    if ((rec.id + 1) % CHECKPOINT_EVERY === 0) {
      lastCheckpoint = { at: rec.id, state: structuredClone(state), rng: rng.snapshot() };
    }
    return rec;
  }

  // 每一筆的骰子用「主種子＋這筆紀錄的編號」開，讀檔從檢查點接著做也一樣
  const fight = createFight({
    world,
    data: DATA,
    state: () => state,
    record,
    dice: (tag) => RNG.clone().setSeed(diceSeed(seed, `${tag}:${log.size}`)),
    startAt: log.get(0).data.at,
  });

  return {
    seed,
    world,
    log,
    rng,
    get state() {
      return state;
    },
    get hero() {
      return heroStats(DATA, state.hero);
    },
    fight,
    // 移動一步；擋住（或戰鬥中這回合走完了）回傳 null，不記錄。
    // 平常走一格花的時間看身高；戰鬥中移動不花時間，回合結束才算 1 回合
    move(dir, cause = null) {
      const from = state.player;
      const h = heroStats(DATA, state.hero);
      if (state.combat && state.combat.moved >= h.speed) return null;
      const to = tryMove(world, from, dir);
      if (to.x === from.x && to.y === from.y) return null;
      const duration = state.combat ? 0 : h.stepTicks;
      const rec = record({ verb: 'move', data: { from, to, dir, duration }, cause });
      // 走到離一群生物 SIGHT_RANGE 格內，第一次見到這個物種就記一筆（起因是這一步，不花時間）
      for (const { herd, near } of world.herdsNear(to.x, to.y, SIGHT_RANGE)) {
        const id = DATA.species[herd.species].id;
        if (state.seen[id] !== undefined) continue;
        record({
          verb: 'spot',
          target: { x: near.x, y: near.y },
          data: { species: id, herd: herd.id, count: herd.members.length },
          cause: rec.id,
        });
      }
      fight.afterMove(rec.id);
      return rec;
    },
    // 做不到的事記一筆（不改狀態）：reason 是 range、attacked、moves、combat、today、gone
    refuse(reason, target = null, cause = null) {
      return record({ verb: 'refuse', target, data: { reason }, cause });
    },
    // 攻擊一隻生物（不在戰鬥中就先開戰）；打不到回傳 { refused }
    attack: (id, cause = null) => fight.attack(id, cause),
    // 戰鬥中結束這一回合，生物接著動
    endTurn: (cause = null) => fight.endTurn(cause),
    rest: (cause = null) => fight.rest(cause),
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
      if (state.combat || !src || !touches(src, p)) return null;
      const dice = RNG.clone().setSeed(diceSeed(seed, `gather:${log.size}`));
      const data = planGather(world, DATA, state, src, dice);
      return record({
        verb: 'gather',
        target: { x: src.x, y: src.y },
        data: { ...data, duration: data.duration * GATHER_TICKS },
        cause,
      });
    },
    serialize() {
      return { format: SAVE_FORMAT, world: WORLD_VERSION, seed, records: log.all(), checkpoint: lastCheckpoint };
    },
  };
}

// options：{ race, cls } 換預設角色（測試用，建角畫面在 v0.1.2）
export function newGame(seed, options = {}) {
  const { rng, world } = build(seed);
  const log = createLog();
  const hero = presetHero(DATA, options, RNG.clone().setSeed(streamSeed(seed, 'hero')));
  const hp = heroStats(DATA, hero).hpMax;
  const at = startPosition(world);
  const rec = log.append({ time: 0, actor: PLAYER, verb: 'start', data: { at, hero, hp } });
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
