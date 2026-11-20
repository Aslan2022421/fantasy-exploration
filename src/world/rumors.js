// 村民的傳聞：事件照距離與時間傳到聚落（使用者定：照走路的速度）。
// 事件那一區跟聚落那一區隔 d 區（切比雪夫距離），過了 max(1, d)×NEWS.perZone 刻才傳到；最遠 NEWS.maxZones 區。
// 說法照距離挑：同區、隔壁區像親眼看到（seen），更遠是聽來的（heard），聽來的有 NEWS.wrong 的機會說錯（wrong）；
// 挑哪一句看「事件＋說話的人」，同一個人講同一件事永遠同一句

import { fill } from './event-facts.js';
import { hash01 } from './noise.js';

export const NEWS = {
  perZone: 576, // 每遠一區多等幾刻：一區 96 格 × 6 刻（高大身高走一格），約 2.4 分鐘
  maxZones: 8,
  count: 2, // 一個人最多講幾則
  wrong: 0.2,
};

const DIRS = ['東', '東南', '南', '西南', '西', '西北', '北', '東北'];
const NEAR = 12; // 這麼近說「附近」

// from → to 大致在哪個方向：「東邊」；很近是「附近」
export function dirWord(from, to) {
  if (Math.hypot(to.x - from.x, to.y - from.y) <= NEAR) return '附近';
  const a = Math.atan2(to.y - from.y, to.x - from.x);
  return `${DIRS[(Math.round(a / (Math.PI / 4)) + 8) % 8]}邊`;
}

// 字串 → 整數（給雜湊用）
function strHash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

// settle：聽的人住的聚落；speaker：說話的人（村民 id）；now：現在幾刻。回傳 [{ id 事件, text }]，最新的先
export function newsFor(chronicle, settle, speaker, now, zoneSize) {
  const c = { x: settle.x0 + (settle.w >> 1), y: settle.y0 + (settle.h >> 1) };
  const sz = { zx: Math.floor(c.x / zoneSize), zy: Math.floor(c.y / zoneSize) };
  const out = [];
  const events = chronicle.events;
  for (let i = events.length - 1; i >= 0 && out.length < NEWS.count; i--) {
    const e = events[i];
    if (!e.def.spread || e.facts.settleId === settle.id) continue; // 自己聚落的日子不用聽別人說
    const d = Math.max(Math.abs(e.zone.zx - sz.zx), Math.abs(e.zone.zy - sz.zy));
    if (d > NEWS.maxZones || now < e.time + Math.max(1, d) * NEWS.perZone) continue;
    const salt = strHash(speaker);
    const far = d > 1 || !e.def.seen.length;
    let pool = far ? e.def.heard : e.def.seen;
    if (far && e.def.wrong.length && hash01(salt, e.id, 1, 7) < NEWS.wrong) pool = e.def.wrong;
    if (!pool.length) pool = e.def.seen;
    const line = pool[Math.floor(hash01(salt, e.id, 2, 7) * pool.length)];
    out.push({ id: e.id, text: fill(line, { ...e.facts, dir: dirWord(c, e.at) }) });
  }
  return out;
}
