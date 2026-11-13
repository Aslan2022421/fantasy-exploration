// 側面與影子（照使用者給的參考圖）：光從右上照，有高度的東西往左下拉出 2～3 格。
// - 地形：一格比左下的格子高，它的側面就畫進左下那幾格（高一層拉 2 格、高兩層以上拉 3 格），
//   用高處地形自己的字元、顏色調暗，看起來是一面往左下斜的牆
// - 物件：有高度（樹 3、矮叢 2）的物件把影子投到左下那幾格，影子只讓那幾格變暗
// 頂面都畫在原位，所以滑鼠點哪格就是哪格。這裡只算「這一格被誰蓋到」，不碰畫布，可以在 Node 裡測

export const SIDE_MAX = 3;

// 高出 d 層時側面拉幾格
export function sideLength(d) {
  return d <= 0 ? 0 : Math.min(SIDE_MAX, 1 + d);
}

// (x, y) 有沒有被右上方哪一格的側面蓋到：回傳 { x, y, k }（k 是距離幾格），沒有回傳 null。
// 離得近的優先（近的牆擋在遠的前面）
export function sideSource(world, x, y) {
  const here = world.tierAt(x, y);
  for (let k = 1; k <= SIDE_MAX; k++) {
    const sx = x + k;
    const sy = y - k;
    if (!world.inside(sx, sy)) continue;
    if (sideLength(world.tierAt(sx, sy) - here) >= k) return { x: sx, y: sy, k };
  }
  return null;
}

// (x, y) 有沒有落在右上方物件的影子裡：物件要夠高（高度 ≥ 距離），而且不比這格低
export function inShadow(world, objects, x, y) {
  const here = world.tierAt(x, y);
  for (let k = 1; k <= SIDE_MAX; k++) {
    const sx = x + k;
    const sy = y - k;
    if (!world.inside(sx, sy)) continue;
    const o = world.objectAt(sx, sy);
    if (o >= 0 && objects[o].height >= k && world.tierAt(sx, sy) >= here) return true;
  }
  return false;
}
