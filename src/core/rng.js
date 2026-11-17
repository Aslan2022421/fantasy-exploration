// 亂數分流：每條用途各自 clone 一份 ROT.js 的亂數，彼此不干擾。
// 種子由主種子推出；狀態可以存起來當檢查點，讀檔時不用從頭重放

import { RNG } from 'rot-js';

export const STREAMS = ['world', 'species', 'gather', 'combat'];

// 主種子＋用途 → 這條亂數的種子（同樣輸入永遠同樣結果）
export function streamSeed(seed, name) {
  let h = seed >>> 0;
  for (const ch of name) h = (Math.imul(h ^ ch.codePointAt(0), 2654435761) + 0x9e3779b9) >>> 0;
  return h;
}

// 每一筆紀錄的骰子（採集、戰鬥）用的種子：名字只差最後一個數字（gather:41、gather:42），
// streamSeed 算出來的種子差得不夠開，ROT.js 開出來的第一顆骰會連著好幾次一樣，所以再打散一次（murmur3 的收尾）
export function diceSeed(seed, name) {
  let h = streamSeed(seed, name);
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0 || 1;
}

export function createStreams(seed) {
  const streams = {};
  for (const name of STREAMS) streams[name] = RNG.clone().setSeed(streamSeed(seed, name));
  return {
    get: (name) => streams[name],
    snapshot: () => Object.fromEntries(STREAMS.map((n) => [n, streams[n].getState()])),
    restore(snap) {
      for (const n of STREAMS) if (snap?.[n]) streams[n].setState(snap[n]);
    },
  };
}
