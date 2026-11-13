// 高低（使用者定）：亮度只看絕對高度，高的永遠亮、低的永遠暗，跟冒險者站在哪一層無關，
// 同一座山從哪裡看都一樣。層與層的交界照參考圖畫：高的那一側是一排亮的崖邊（被照到），
// 低的那一側緊貼一條暗帶（崖下的陰影）——亮的在上、暗的在下。
// 這裡只算分類，不碰畫布，可以在 Node 裡測

import { MAX_TIER } from '../world/landform.js';

export const EDGE_NONE = 0;
export const EDGE_RIM = 1; // 崖邊：比旁邊某格高
export const EDGE_SHADOW = 2; // 崖下：比旁邊某格低

// 陸地第 1～7 層對到亮度級數 2～7（hillshade.js 的 0～7）；第 0 層是水，水另外看深度
export function tierLevel(tier) {
  return Math.min(7, 1 + Math.round((tier * 6) / MAX_TIER));
}

const AROUND = [
  [0, 1],
  [0, -1],
  [1, 0],
  [-1, 0],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

// 這格在層界的哪一側：比周圍八格裡任一格高是崖邊；不是崖邊但比任一格低是崖下
export function edgeAt(world, x, y) {
  const t = world.tierAt(x, y);
  let lower = false;
  let higher = false;
  for (const [dx, dy] of AROUND) {
    const nx = x + dx;
    const ny = y + dy;
    if (!world.inside(nx, ny)) continue;
    const n = world.tierAt(nx, ny);
    if (n < t) lower = true;
    else if (n > t) higher = true;
  }
  if (lower) return EDGE_RIM;
  if (higher) return EDGE_SHADOW;
  return EDGE_NONE;
}
