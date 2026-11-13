// 多層次視差堆疊（使用者定）：高的東西同一個字疊好幾層做出體積，從畫面中心（相機）往外錯開，
// 角色一走，周圍的高處跟著轉，有視差。為了不頭暈、不像凹凸鏡（前幾版的教訓）：
// - 原點是角色腳下的高度，同高的地面不錯開，走路時地面不動；換高度層時原點平滑過渡（stackview.js）
// - 相機平滑緩衝：相機與原點都往目標慢慢靠過去，不一步跳到位
// - 限制最大偏移：錯開量隨離中心的距離長大，但有上限，角色附近看得到視差，遠處角落不會被拉長變形
// - 每層之間錯開的距離是前一版的一半（使用者定）
// - 下面幾層的顏色往地面底色壓淡，不往黑色壓，牆與樹幹不會變成一條條突兀的色塊
// 高度用「層」算（groundHeight）；樹（使用者定）：樹幹在下（離地 +1～+3，Φ、木頭色），樹葉只在最頂層（+4），
// 連地貌共 5 層；矮叢實心疊 2 層；玩家疊 2 層。
// 這裡只算層、錯開量與壓淡的比例，不碰畫布，可以在 Node 裡測

import { LAND } from '../world/landform.js';

export const STACK = {
  tierLayers: 2, // 陸地每個高度層算幾層
  stepPerCell: 0.06, // 離中心每一格，每差一層多錯開幾個字元像素（一格 8 個）
  maxStep: 1, // 每差一層最多錯開幾個字元像素
  maxShift: 6, // 錯開量上限（字元像素）：遠處角落不會拉長變形
  maxWall: 8, // 牆最多疊幾層
  fade: [0, 0.35, 0.6, 0.75, 0.85], // 由頂往下各層往地面底色壓淡多少（頂層不壓；5 層）
};

// 相機平滑緩衝：每過 tau 毫秒，離目標的距離剩約 37%；離太遠（瞬移、讀檔）直接跳過去
export const LERP = { tau: 90, snap: 8, settle: 0.01 };

// 山地逐圈的底色亮度（使用者要的「逐圈顏色變深」）：山腳那圈 foot、往上每圈變亮，第 full 圈以上全亮
export const RING = { foot: 0.75, full: 10 };

// 高度 height（0～255）的山地格在第幾圈、底色乘多少；不是山地的呼叫的人自己略過
export function mountainRingFactor(height) {
  const h = height / 127.5 - 1;
  const ring = Math.max(0, Math.floor((h - LAND.mountain) / LAND.mountainStep));
  return RING.foot + (1 - RING.foot) * Math.min(1, ring / RING.full);
}

// 離地幾層：樹幹在下、樹葉在頂（使用者定；原本樹葉在 +2、樹幹疊到 +4 露出樹頂，看起來不像樹）
export const TREE = { trunk: [1, 2, 3], leaves: [4] };

// 玩家、NPC、怪物依體型疊 2～3 層、佔 1、2、4 格（使用者定）；現在只有玩家，疊 2 層
export const PLAYER_LAYERS = 2;

export const fadeAt = (j) => STACK.fade[Math.min(j, STACK.fade.length - 1)];
// 地面高度（層）：陸地第 1～4 層每層算 tierLayers 層；再往上是山地一圈一圈加的，每圈算 1 層
export const groundHeight = (tier) =>
  tier <= LAND.landTiers ? tier * STACK.tierLayers : LAND.landTiers * STACK.tierLayers + (tier - LAND.landTiers);
export const MAX_SHIFT_CELLS = Math.ceil(STACK.maxShift / 8); // 錯開最多幾格

// 離中心 dist 格時，每差一層錯開幾個字元像素
export function layerStep(dist) {
  return Math.min(STACK.maxStep, dist * STACK.stepPerCell);
}

// 比原點高 dh 層的東西錯開多少（可以是小數）：正的往外、負的往內，總量不超過 maxShift。
// (dx, dy) 是這格減畫面中心（可以是小數，相機在半路上時）
export function shiftOf(dx, dy, dh) {
  const dist = Math.hypot(dx, dy);
  if (dist === 0 || dh === 0) return { ox: 0, oy: 0 };
  const s = Math.max(-STACK.maxShift, Math.min(STACK.maxShift, dh * layerStep(dist)));
  return { ox: (dx / dist) * s, oy: (dy / dist) * s };
}

// 往上疊（預設；使用者選 B 的平行投影，試過 45 度斜上方，再要疊法更直）：錯開量只看高度，跟在畫面哪裡、相機在哪都無關，
// 畫面是 100% 靜止的平行投影，走路時整張圖只平移。高的東西露出朝南的一面，往右微微偏 lean 倍、露一點西面。
// 每高一層往上錯開 px 個「螢幕像素」、往右 px×lean，不跟著地圖縮放變（使用者定：原本用字元像素，
// 預設大小每層只錯 2 像素，要放到最大才看得出立體）；總量最多 maxPx 螢幕像素，最高的山頂會被壓平一點
// 物件（樹、矮叢）從腳下地面往上的每一層錯開 objPx 螢幕像素，比地形大一倍（冒險者不用，照地形的間距）：
// 預設大小（一格 16 像素）樹幹頂端（離地 4 層）約錯開兩格（使用者定）
export const UP = { px: 4, maxPx: 64, objPx: 8, maxLift: 4, lean: 0.25 };

// 格子放大 k 倍（一個字元像素是 k 個螢幕像素）時，錯開最多幾格（地面加上物件）
export const upShiftCells = (k) => Math.ceil((UP.maxPx + UP.maxLift * UP.objPx) / k / 8);

// 物件從腳下地面往上 dh 層，再多錯開多少字元像素
export function liftUp(dh, k = 1) {
  const s = (Math.min(UP.maxLift, Math.max(0, dh)) * UP.objPx) / k;
  return { ox: s * UP.lean || 0, oy: -s || 0 };
}

// 高度 h（層，原點是水面）錯開多少字元像素（可以是小數）：{ ox 往右（正）, oy 往上（負）}；k 是格子放大倍數
export function shiftUp(h, k = 1) {
  const s = Math.min(UP.maxPx, Math.max(0, h) * UP.px) / k;
  return { ox: s * UP.lean || 0, oy: -s || 0 }; // || 0 把 -0 變 0
}

// 往斜上方疊時的牆：比南、西、西南三格裡最低的那格高才有，從那格的高度疊上來。
// 回傳 { from, to, low（最低那格的座標）}，不然 null
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

// 這格的牆：比往中心那一格高時，回傳 { from, to, low }（要疊的高度範圍含頭尾、低處那格的座標），不然 null
export function wallRange(world, cx, cy, x, y) {
  const dx = x - cx;
  const dy = y - cy;
  const m = Math.max(Math.abs(dx), Math.abs(dy));
  if (m < 0.5) return null;
  const nx = x - Math.round(dx / m);
  const ny = y - Math.round(dy / m);
  if (!world.inside(nx, ny)) return null;
  const top = groundHeight(world.tierAt(x, y));
  const low = groundHeight(world.tierAt(nx, ny));
  if (top <= low) return null;
  return { from: Math.max(low, top - STACK.maxWall), to: top - 1, low: { x: nx, y: ny } };
}

// 物件這格要疊的層：[{ dh（離地幾層）, part: 'trunk' | 'leaf' | 'solid', j（離那部分頂端幾層，決定壓淡）}]。
// 樹幹在下、樹葉在頂；樹冠其他格只有頂層的樹葉，底下空著
export function objectLayers(object, isTrunk) {
  if (!object?.height) return [];
  if (!object.trunk) {
    const n = Math.min(object.height, STACK.fade.length);
    return Array.from({ length: n }, (_, i) => ({ dh: i + 1, part: 'solid', j: n - 1 - i }));
  }
  const top = (list) => list[list.length - 1];
  const out = [];
  if (isTrunk) for (const dh of TREE.trunk) out.push({ dh, part: 'trunk', j: top(TREE.trunk) - dh });
  for (const dh of TREE.leaves) out.push({ dh, part: 'leaf', j: top(TREE.leaves) - dh });
  return out.sort((a, b) => a.dh - b.dh);
}
