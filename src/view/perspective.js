// 疊層的幾何：高的東西同一個字疊好幾層做出體積，全部往畫面上方錯開（平行投影，錯開量只看高度，跟相機無關）。
// 這裡只算層數、錯開量與壓淡的比例，不碰畫布；畫在 stackview.js

import { LAND } from '../world/landform.js';

export const STACK = {
  tierLayers: 2, // 陸地每個高度層算幾層（山地每圈 1 層）
  maxWall: 8, // 牆最多疊幾層
  fade: [0, 0.35, 0.6, 0.75, 0.85], // 由頂往下各層往地面底色壓淡多少
};

// 相機平滑捲動：每過 tau 毫秒，離目標的距離剩約 37%；離 snap 格以上直接跳過去
export const LERP = { tau: 90, snap: 8, settle: 0.01 };

// 山地一圈一圈往上變亮：山腳那圈 foot，第 full 圈以上全亮
export const RING = { foot: 0.75, full: 10 };

// 錯開量（螢幕像素，不跟地圖縮放變）：地形每層往上 px、往右 leanPx，總量最多 maxPx；
// 物件從腳下地面垂直往上每層 objPx（objLeanPx 0：樹、礦脈等物件不往右偏），最多 maxLift 層
export const UP = { px: 4, leanPx: 1, maxPx: 64, objPx: 8, objLeanPx: 0, maxLift: 5 };

// 斜坡（坡度 min 以上、不是山也不是水）多疊一層，往上坡那側左右偏 leanPx 螢幕像素
export const SLOPE_STACK = { min: 69, leanPx: 2 };

export const PLAYER_LAYERS = 2;

// 高度 height（0～255）的山地格，字色乘多少
export function mountainRingFactor(height) {
  const h = height / 127.5 - 1;
  const ring = Math.max(0, Math.floor((h - LAND.mountain) / LAND.mountainStep));
  return RING.foot + (1 - RING.foot) * Math.min(1, ring / RING.full);
}

export const fadeAt = (j) => STACK.fade[Math.min(j, STACK.fade.length - 1)];

// 地面高度（層）：陸地第 1～4 層每層 tierLayers 層，山地往上每圈 1 層
export const groundHeight = (tier) =>
  tier <= LAND.landTiers ? tier * STACK.tierLayers : LAND.landTiers * STACK.tierLayers + (tier - LAND.landTiers);

// 格子放大 k 倍（一個字元像素是 k 個螢幕像素）時，錯開最多幾格（地面加上物件）
export const upShiftCells = (k) => Math.ceil((UP.maxPx + UP.maxLift * UP.objPx) / k / 8);

// 高度 h（層，原點是水面）錯開多少字元像素：{ ox 往右, oy 往上（負）}
export function shiftUp(h, k = 1) {
  const n = Math.min(UP.maxPx / UP.px, Math.max(0, h));
  return { ox: (n * UP.leanPx) / k || 0, oy: (-n * UP.px) / k || 0 }; // || 0 把 -0 變 0
}

// 物件從腳下地面往上 dh 層，再多錯開多少字元像素
export function liftUp(dh, k = 1) {
  const n = Math.min(UP.maxLift, Math.max(0, dh));
  return { ox: (n * UP.objLeanPx) / k || 0, oy: (-n * UP.objPx) / k || 0 };
}

// 斜坡那層再錯開多少字元像素：往上一層，往上坡方向（gx：東邊減西邊的高度）左右偏
export function slopeTilt(gx, k = 1) {
  const side = gx > 0 ? 1 : gx < 0 ? -1 : 0;
  return { ox: (side * SLOPE_STACK.leanPx) / k || 0, oy: -UP.px / k };
}

// 牆：比南、西、西南三格裡最低的那格高才有，從那格的高度疊上來。回傳 { from, to, low（最低那格）}，不然 null
export function wallSouth(world, x, y) {
  let low = null;
  for (const [nx, ny] of [
    [x, y + 1],
    [x - 1, y],
    [x - 1, y + 1],
  ]) {
    if (!world.inside(nx, ny)) continue;
    const h = groundHeight(world.tierAt(nx, ny));
    if (!low || h < low.h) low = { x: nx, y: ny, h };
  }
  const top = groundHeight(world.tierAt(x, y));
  if (!low || top <= low.h) return null;
  return { from: Math.max(low.h, top - STACK.maxWall), to: top - 1, low: { x: low.x, y: low.y } };
}

// 往目標靠近一步：dt 毫秒過去後的新值；離目標夠近或太遠就直接到位
export function approach(cur, target, dt) {
  const d = target - cur;
  if (Math.abs(d) <= LERP.settle || Math.abs(d) >= LERP.snap) return target;
  return cur + d * (1 - Math.exp(-dt / LERP.tau));
}

// 物件這格要疊的層：[{ dh 離地幾層, part: 'trunk' | 'leaf' | 'solid', j 離那部分頂端幾層（決定壓淡）}]。
// 樹疊 height 層：樹幹那格從離地 1 層疊到 height-1，最頂層是樹冠；旁邊的樹冠只有頂層一片。
// 沒有樹幹的（矮叢）：height 1 平畫在地面上，更高才往上疊
export function objectLayers(object, isTrunk) {
  if (!object?.height) return [];
  const top = object.height;
  if (!object.trunk) {
    if (top <= 1) return [{ dh: 0, part: 'solid', j: 0 }];
    const n = Math.min(top, STACK.fade.length);
    return Array.from({ length: n }, (_, i) => ({ dh: i + 1, part: 'solid', j: n - 1 - i }));
  }
  const out = [];
  if (isTrunk) for (let dh = 1; dh < top; dh++) out.push({ dh, part: 'trunk', j: top - 1 - dh });
  out.push({ dh: top, part: 'leaf', j: 0 });
  return out;
}
