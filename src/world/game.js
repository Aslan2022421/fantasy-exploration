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
import { createChronicle } from './chronicle.js';
import { nearAnvil, planBreak, planCraft, planRepair, planSmelt, planUse } from './craft.js';
import { createFight } from './fight.js';
import { apply, emptyState, StateSchema } from './game-state.js';
import { planGather, sourceAt, touches } from './gather.js';
import { buildSheet, equip as equipSheet, heroStats, presetHero, raise as raiseSheet } from './hero.js';
import { tryMove } from './move.js';
import { createNestWatch } from './nest-watch.js';
import { overlayWorld } from './overlays.js';
import { newsFor } from './rumors.js';
import { createSettleWatch } from './settle-watch.js';
import { brokenSlots } from './wear.js';
import { createWorld, startPosition, WORLD_VERSION } from './world.js';

// 3：加上世界版本；4：狀態加上背包、現存數量、採過的格子；5：狀態加上見過的物種；
// 6：時間改成刻（1 刻＝0.25 秒）、狀態加上冒險者、生命、戰鬥、動過的生物、休息；
// 7：戰鬥改成照時間一步一步輪流（每個動作的刻數看身高、體型）；8：戰鬥加上逃的、最後看到冒險者的位置；
// 9：建角（冒險者加上背景、背包裡的裝備、屬性點）；10：混食的怪物打其他生物（戰鬥記各自在打誰、生物受傷的時間）；
// 11：據點（隱藏人口、擲對抗、清光與重生、寶箱）；12：聚落（隱藏人口）
export const SAVE_FORMAT = 12;
export const SIGHT_RANGE = 10; // 走到離一群生物幾格內，算第一次見到那個物種
export const CHECKPOINT_EVERY = 100;
export { apply };

export const SaveSchema = z.object({
  format: z.literal(SAVE_FORMAT),
  world: z.literal(WORLD_VERSION),
  seed: z.number(),
  records: z.array(RecordSchema),
  checkpoint: z
    .object({ at: z.number(), state: StateSchema, rng: z.record(z.string(), z.array(z.number())) })
    .nullable(),
});

const GATHER_TICKS = 4; // 採集資料的時間單位是「中等身高走一格」＝4 刻
const PLAYER = 'player';

// 世界只由種子決定、建好後不會被改（區的快取除外），同一個種子重用上一次建好的（96×96 區建一次要 2 秒）
let lastWorld = null;
function build(seed) {
  if (lastWorld?.seed !== seed) lastWorld = createWorld(seed, DATA);
  return { rng: createStreams(seed), world: lastWorld };
}

function makeGame(seed, rng, baseWorld, log, initialState, checkpoint) {
  let state = initialState;
  let lastCheckpoint = checkpoint;
  let shown = null; // 畫面逐格播放時暫時顯示的生物樣子（null＝照狀態）
  const world = overlayWorld(baseWorld, DATA, { state: () => state, creatures: () => shown ?? state.creatures });

  function record(entry) {
    const rec = log.append({ time: state.time, actor: PLAYER, ...entry });
    state = apply(state, rec);
    if ((rec.id + 1) % CHECKPOINT_EVERY === 0) {
      lastCheckpoint = { at: rec.id, state: structuredClone(state), rng: rng.snapshot() };
    }
    // 磨到上限的裝備壞掉，各記一筆（起因是這一下）
    if (rec.data?.wear)
      for (const slot of brokenSlots(state.hero))
        record({ verb: 'break', data: planBreak(DATA, state, slot), cause: rec.id });
    return rec;
  }
  const craftDice = () => RNG.clone().setSeed(diceSeed(seed, `craft:${log.size}`));
  // 製造、修理、熔煉、用掉補給品（craft.js）：做不到回傳 { refused }，做了記一筆
  const craftAct = (verb, plan, cause) => (plan.refused ? plan : after(record({ verb, data: plan, cause })));
  const anvil = () => nearAnvil(world, DATA, state.player);

  // 每一筆的骰子用「主種子＋這筆紀錄的編號」開，讀檔從檢查點接著做也一樣
  const fight = createFight({
    world,
    data: DATA,
    state: () => state,
    record,
    dice: (tag) => RNG.clone().setSeed(diceSeed(seed, `${tag}:${log.size}`)),
    startAt: log.get(0).data.at,
  });
  const nests = createNestWatch({
    world,
    data: DATA,
    state: () => state,
    record,
    dice: (tag) => RNG.clone().setSeed(diceSeed(seed, `${tag}:${log.size}`)),
  });
  // 歷史（事件、統計、走過的區）與傳聞：從紀錄算，不進存檔
  const chronicle = createChronicle(log, baseWorld.zoneSize);
  const news = (s, speaker) => newsFor(chronicle, s, speaker, state.time, baseWorld.zoneSize);
  const settles = createSettleWatch({ world, state: () => state, record, news });
  // 花時間的動作做完之後：據點看一次（清光、重生、看到時擲對抗）
  const after = (rec) => {
    if (rec && !rec.refused) nests.afterAction(rec.id);
    return rec;
  };

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
    // 畫面播放用：暫時讓世界照 creatures 顯示生物（只在播放中、不接受輸入時用），null 回到現在的狀態
    showCreatures(creatures) {
      shown = creatures;
    },
    fight,
    // 移動一步；擋住回傳 null，不記錄。走一格花的刻數看身高，戰鬥內外一樣；戰鬥中走完生物接著動
    move(dir, cause = null) {
      const from = state.player;
      const to = tryMove(world, from, dir);
      if (to.x === from.x && to.y === from.y) return null;
      const duration = heroStats(DATA, state.hero).ticks;
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
      return after(rec);
    },
    // 做不到的事記一筆（不改狀態）：reason 是 range、combat、today、gone
    refuse(reason, target = null, cause = null) {
      return record({ verb: 'refuse', target, data: { reason }, cause });
    },
    // 攻擊一隻生物（不在戰鬥中就先開戰），生物接著動；打不到回傳 { refused }
    attack: (id, cause = null) => after(fight.attack(id, cause)),
    rest: (cause = null) => after(fight.rest(cause)),
    // 換上背包裡的一件裝備，花一個動作的刻數（戰鬥中生物接著動）；不能換回傳 { refused }
    equip(item, cause = null) {
      const next = equipSheet(DATA, state.hero, item);
      if (next.refused) return next;
      const rec = record({
        verb: 'equip',
        target: null,
        data: {
          item,
          gear: next.gear,
          items: next.items,
          wear: next.wear,
          itemWear: next.itemWear,
          duration: heroStats(DATA, state.hero).ticks,
        },
        cause,
      });
      fight.afterMove(rec.id);
      return after(rec);
    },
    // 用掉一點升級的屬性點（不花時間）
    raise(attr) {
      const next = raiseSheet(state.hero, attr);
      if (next.refused) return next;
      return record({ verb: 'raise', data: { attr, attrs: next.attrs, points: next.points } });
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
    // 這格能不能採：回傳那處來源（樹冠會換成樹幹那格；據點還沒開的寶箱也算，Q 是打開）或 null
    sourceAt: (at) => nests.chestAt(at.x, at.y) ?? sourceAt(world, DATA, at.x, at.y),
    // 採 at 那處來源一次（寶箱是打開）：要站在旁邊（或上面）、不在戰鬥中。不能採回傳 null，不記錄。
    // 每次採集的骰子用「主種子＋這筆紀錄的編號」開，讀檔從檢查點接著做也一樣
    gather(at, cause = null) {
      const chest = nests.chestAt(at.x, at.y);
      if (chest) return state.combat || !touches(chest, state.player) ? null : after(nests.open(chest, cause));
      const src = sourceAt(world, DATA, at.x, at.y);
      const p = state.player;
      if (state.combat || !src || !touches(src, p)) return null;
      const dice = RNG.clone().setSeed(diceSeed(seed, `gather:${log.size}`));
      const data = planGather(world, DATA, state, src, dice);
      const before = data.done ? settles.econBefore(src) : [];
      const rec = record({
        verb: 'gather',
        target: { x: src.x, y: src.y },
        data: { ...data, duration: data.duration * GATHER_TICKS },
        cause,
      });
      settles.econAfter(before, rec.id);
      return after(rec);
    },
    // 跟村民說話（不花時間、不改狀態）：要貼著；回傳紀錄或 null
    talk: (id, cause = null) => settles.talk(id, cause),
    chronicle,
    nearAnvil: anvil,
    craft: (id, cause = null) => craftAct('craft', planCraft(DATA, state, id, anvil(), craftDice()), cause),
    repair: (slot, cause = null) => craftAct('repair', planRepair(DATA, state, slot, anvil()), cause),
    smelt: (index, cause = null) => craftAct('smelt', planSmelt(DATA, state, index, anvil()), cause),
    use: (material, cause = null) => craftAct('use', planUse(DATA, state, material, craftDice()), cause),
    // 村民說話的內容（talk.js 的 extra）：這個人現在會講的傳聞（說話不花時間，跟剛記下的那筆一樣），
    // 加上誰讓據點沒有怪物
    talkExtra(npc) {
      return { news: news(npc.settle, npc.id), clearedBy: (nestId) => chronicle.clearedBy(nestId) };
    },
    nests,
    serialize() {
      return { format: SAVE_FORMAT, world: WORLD_VERSION, seed, records: log.all(), checkpoint: lastCheckpoint };
    },
  };
}

// options：{ choices }（建角畫面選好的，hero.js 的 buildSheet）；或 { race, cls } 用預設選擇（網址捷徑、測試）
export function newGame(seed, options = {}) {
  const { rng, world } = build(seed);
  const log = createLog();
  const hero = options.choices
    ? buildSheet(DATA, options.choices)
    : presetHero(DATA, options, RNG.clone().setSeed(streamSeed(seed, 'hero')));
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
