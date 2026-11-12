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
