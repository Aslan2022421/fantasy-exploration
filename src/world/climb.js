// 高低差：每格地面有幾層高（跟畫面疊層同一套：陸地每個高度層 2 層、山地往上每圈 1 層）。
// 相鄰兩格差 1～2 層走得過去，差 3 層以上是爬不上去也跳不下去的落差
import { LAND } from './landform.js';

export const CLIMB = { tierLayers: 2, maxStep: 2 };

// 高度層 tier 的地面有幾層高（水面是 0）
export const groundLayers = (tier) =>
  tier <= LAND.landTiers ? tier * CLIMB.tierLayers : LAND.landTiers * CLIMB.tierLayers + (tier - LAND.landTiers);

// 從 a 走到相鄰的 b，高低差在 maxStep 層以內才行；沒有高度的地圖（測試用的小地圖）都算可以
export function canStep(world, a, b) {
  if (!world.tierAt) return true;
  return Math.abs(groundLayers(world.tierAt(a.x, a.y)) - groundLayers(world.tierAt(b.x, b.y))) <= CLIMB.maxStep;
}
