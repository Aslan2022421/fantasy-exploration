// 世界種子：每開一局新遊戲隨機一個；網址加 ?seed=數字 指定（測試、重玩同一個世界）。讀檔照存檔裡的種子
export function newSeed(search = location.search) {
  const fixed = Number(new URLSearchParams(search).get('seed'));
  return Number.isInteger(fixed) && fixed > 0 ? fixed : crypto.getRandomValues(new Uint32Array(1))[0] >>> 1;
}
