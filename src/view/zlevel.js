// Z 高度：以冒險者所在的高度層為準分四階，高處與低處一目了然（使用者定）。
// 鏡頭在所有東西上方往下看，越高越近、越亮：低兩層以上最暗、低一層暗、同一層中等、高一層以上最亮。
// 高處照樣畫出地面與物件（角色站在低處看不到高處，但畫面是給玩家看的）。
// 亮度只看相對高度，不用坡向漸層，高低不會糊在一起；層與層的交界另外畫一道暗色輪廓（outlineAt）。
// 這裡只算分類與輪廓，不碰畫布，可以在 Node 裡測

export const DEEP = 0; // 低兩層以上
export const BELOW = 1; // 低一層
export const SAME = 2; // 同一層
export const ABOVE = 3; // 高一層以上

// 每一階在畫面上的亮度級數（hillshade.js 的 0～7）
export const Z_LEVEL = { [DEEP]: 1, [BELOW]: 3, [SAME]: 5, [ABOVE]: 7 };

export function zClass(tier, playerTier) {
  const r = tier - playerTier;
  if (r >= 1) return ABOVE;
  if (r === 0) return SAME;
  if (r === -1) return BELOW;
  return DEEP;
}

// 這格比上下左右任何一格高，就是層界的高側，畫輪廓
export function outlineAt(world, x, y) {
  const t = world.tierAt(x, y);
  for (const [dx, dy] of [
    [0, 1],
    [0, -1],
    [1, 0],
    [-1, 0],
  ]) {
    const nx = x + dx;
    const ny = y + dy;
    if (world.inside(nx, ny) && world.tierAt(nx, ny) < t) return true;
  }
  return false;
}
