// Z 高度（照矮人要塞的看法，使用者定）：以冒險者所在的高度層為準，畫面同時看三個高度。
// - 同一層：正常亮度
// - 低一層：從上往下看，明顯變暗、字元變疏；再低的都歸到最暗那一階
// - 高一層以上：在這一層看過去是一面實心的牆
// 亮度只看相對高度，分三階，不用坡向的漸層，高低不會糊在一起。
// 這裡只算「這格相對冒險者是哪一種」，不碰畫布，可以在 Node 裡測

export const SAME = 0;
export const BELOW = 1; // 低一層
export const DEEP = 2; // 低兩層以上
export const ABOVE = 3; // 高一層以上：牆

// 每一種在畫面上的亮度級數（hillshade.js 的 0～7）；牆另外畫
export const Z_LEVEL = { [SAME]: 6, [BELOW]: 3, [DEEP]: 1 };

export function zClass(tier, playerTier) {
  const r = tier - playerTier;
  if (r >= 1) return ABOVE;
  if (r === 0) return SAME;
  if (r === -1) return BELOW;
  return DEEP;
}
