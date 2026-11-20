// 遊戲狀態的格式與「一筆紀錄怎麼改狀態」（apply）。狀態只由「種子＋紀錄」決定，這裡不擲骰，只照紀錄套

import { z } from 'zod';
import { applyCraft } from './craft-apply.js';
import { applyFight } from './fight.js';
import { applyGather } from './gather.js';
import { applyNest } from './nest-apply.js';
import { addWear } from './wear.js';

const Counts = z.record(z.string(), z.number());
export const StateSchema = z.object({
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
  nests: z.record(z.string(), z.object({}).passthrough()), // 動過的據點（nest-overlay.js）
  settles: z.record(z.string(), z.object({}).passthrough()), // 動過的聚落（settle-overlay.js）
});
export const emptyState = () => ({
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
  nests: {},
  settles: {},
});

// 一筆紀錄對狀態的影響；沒列到的動作（查看、決定路線、被擋住）不改變狀態
export function apply(state, rec) {
  switch (rec.verb) {
    case 'start':
      return { ...state, player: { ...rec.data.at }, time: rec.time, hero: rec.data.hero, hp: rec.data.hp };
    case 'move':
      return { ...state, player: { ...rec.data.to }, time: rec.time + rec.data.duration };
    case 'gather':
      return { ...applyGather(state, rec.data), time: rec.time + rec.data.duration };
    case 'spot':
      return { ...state, seen: { ...state.seen, [rec.data.species]: rec.id } };
    case 'equip': {
      // 換裝備：紀錄裡寫好換完的裝備欄與背包（耐久跟著那一件走；舊紀錄沒有就照舊）
      const d = rec.data;
      const hero = { ...state.hero, gear: d.gear, items: d.items };
      if (d.wear) Object.assign(hero, { wear: d.wear, itemWear: d.itemWear });
      return { ...state, hero, time: rec.time + d.duration };
    }
    case 'raise':
      return { ...state, hero: { ...state.hero, attrs: rec.data.attrs, points: rec.data.points } };
    default: {
      const next = applyCraft(state, rec) ?? applyFight(state, rec) ?? applyNest(state, rec) ?? state;
      // 出手、挨打磨到的裝備（wear.js）
      return rec.data?.wear ? addWear(next, rec.data.wear) : next;
    }
  }
}
