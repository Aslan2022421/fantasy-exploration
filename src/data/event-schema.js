// 事件種類（data/event）：認得出開頭與結局的一筆紀錄（verb＋when 的條件），配上照結局、照誰來說而不同的文字範本。
// 範本裡的 {名字} 換成這件事的細節（event-facts.js 算），每個動詞能用的名字列在 FACT_KEYS；
// {hero}（一位精靈遊俠）每種都能用，{dir}（東邊、附近）只在傳聞裡有（說的人在哪個聚落才算得出方向）

import { z } from 'zod';

export const FACT_KEYS = {
  nestclear: ['place', 'monster'],
  nestspawn: ['place', 'monster', 'size'],
  nestroll: ['place', 'monster', 'tag', 'who', 'win', 'tagChanged'],
  open: ['place', 'item'],
  settletag: ['settle', 'from', 'to'],
  attack: ['species', 'big'],
  down: [],
  spot: ['species', 'count'],
};
export const COMMON_KEYS = ['hero'];
export const RUMOR_KEYS = ['dir'];

export const EventSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  verb: z.enum(Object.keys(FACT_KEYS)),
  when: z.record(z.string(), z.union([z.boolean(), z.string(), z.number()])).default({}),
  world: z.boolean().default(true), // 寫進世界歷史
  life: z.boolean().default(false), // 寫進冒險者的生涯年表
  spread: z.boolean().default(true), // 會傳到聚落變成傳聞
  history: z.string().min(1), // 年表上的一句
  seen: z.array(z.string().min(1)).default([]), // 傳聞：離得近（同區、隔壁區）的人，像親眼看到
  heard: z.array(z.string().min(1)).default([]), // 傳聞：離得遠，聽來的
  wrong: z.array(z.string().min(1)).default([]), // 傳聞：聽錯的說法（離得遠時有機會說成這樣）
});

const slots = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);

// 範本只能用這個動詞有的名字；when 的條件也一樣；會傳的事件要有傳聞的句子
export function checkEvents(events, errors) {
  for (const e of events) {
    const keys = new Set([...FACT_KEYS[e.verb], ...COMMON_KEYS]);
    for (const k of Object.keys(e.when))
      if (!keys.has(k)) errors.push(`事件 ${e.id}：條件 ${k} 不是 ${e.verb} 有的細節`);
    for (const k of slots(e.history))
      if (!keys.has(k)) errors.push(`事件 ${e.id}：年表的 {${k}} 不是 ${e.verb} 有的細節`);
    for (const t of [...e.seen, ...e.heard, ...e.wrong])
      for (const k of slots(t))
        if (!keys.has(k) && !RUMOR_KEYS.includes(k)) errors.push(`事件 ${e.id}：傳聞的 {${k}} 不是 ${e.verb} 有的細節`);
    if (e.spread && !e.seen.length && !e.heard.length) errors.push(`事件 ${e.id}：會傳出去，卻沒有傳聞的句子`);
  }
}
