// 世界紀錄：所有互動都記一筆，照發生順序編號；每筆可以指出是哪一筆引起的（起因）
// 紀錄只增不改；世界的狀態由「種子＋紀錄從頭照做」得到

import { z } from 'zod';

export const RecordSchema = z.object({
  id: z.number().int().nonnegative(),
  time: z.number().nonnegative(), // 發生在時間軸上的哪個時間
  actor: z.string(), // 誰做的
  verb: z.string(), // 做了什麼
  target: z.unknown().nullable(), // 對誰或對哪裡
  data: z.record(z.string(), z.unknown()), // 這件事的細節
  cause: z.number().int().nonnegative().nullable(), // 起因是哪一筆
});

export function createLog(initial = []) {
  const records = [...initial];
  return {
    append({ time, actor, verb, target = null, data = {}, cause = null }) {
      const rec = { id: records.length, time, actor, verb, target, data, cause };
      records.push(rec);
      return rec;
    },
    get: (id) => records[id],
    all: () => records,
    get size() {
      return records.length;
    },
    // 從某一筆沿著起因往回找，回傳 [自己, 起因, 起因的起因⋯⋯]
    causeChain(id) {
      const chain = [];
      const seen = new Set();
      for (let r = records[id]; r && !seen.has(r.id); r = r.cause == null ? null : records[r.cause]) {
        seen.add(r.id);
        chain.push(r);
      }
      return chain;
    },
  };
}
