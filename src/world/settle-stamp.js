// 聚落蓋進地圖與世界層的查詢（從 settlements.js 拆出來）：圖樣某格的代碼、生成一區時蓋進那一格、照區找聚落

import { gapToNest } from './nests.js';
import { FIELD, GROUND, INDOOR, INDOOR_OBJECTS, KEEP, OUTROAD, ROAD, WELL } from './settle-codes.js';

// 圖樣裡 (X, Y) 那格的代碼；不在圖樣裡回傳 null
export function settleCode(s, X, Y) {
  if (!s) return null;
  const i = X - s.x0;
  const j = Y - s.y0;
  if (i < 0 || j < 0 || i >= s.w || j >= s.h) return null;
  return s.layout.grid[j][i];
}

// 生成一區時把聚落蓋進那一格（terrain.js）：回傳 null（不在聚落裡或在牆外）或 { s 材質, k 覆蓋, o 物件編號（-1 沒有）}。
// ids：{ YARD 村莊的空地, SQUARE 城鎮的空地, ROAD, FLOOR 室內地板, DIRT 田裡的泥土, NONE } 地形編號。
// 牆、瞭望塔、樹下是聚落的空地；門與家具在室內地板上；井與攤位在路上；作物在田裡的泥土上
export function createSettleStamp(data, ids) {
  const { YARD, SQUARE, ROAD: RD, FLOOR, DIRT, NONE } = ids;
  return function stamp(s, X, Y) {
    const code = settleCode(s, X, Y);
    if (!code || code === KEEP) return null;
    const ground = data.settlements[s.kind].id === 'village' ? YARD : SQUARE;
    // 堡壘蓋在隘口：水排掉；山壁（keep）保留原本的高度，不整平
    if (data.settlements[s.kind].layout) return { ...stampCode(code, ground), w: NONE, keep: code === 'rampart-rock' };
    return stampCode(code, ground);
  };
  function stampCode(code, ground) {
    if (code === GROUND) return { s: ground, k: NONE, o: -1 };
    if (code === ROAD || code === OUTROAD) return { s: RD, k: NONE, o: -1 }; // 出入口外面那段也是路
    if (code === INDOOR) return { s: FLOOR, k: NONE, o: -1 };
    if (code === FIELD) return { s: DIRT, k: NONE, o: -1 };
    const under = INDOOR_OBJECTS.has(code)
      ? FLOOR
      : code === WELL || code === 'stall'
        ? RD
        : code === 'crops'
          ? DIRT
          : ground;
    return { s: under, k: NONE, o: data.objectIndex.get(code) };
  }
}

// 世界層的聚落查詢（world.js）：同據點，區被丟掉再生時不用為了問聚落重生整區
export function createSettleIndex(zone, zonesX, zonesY, zoneSize) {
  const cache = new Map();
  function settleOf(zx, zy) {
    if (zx < 0 || zy < 0 || zx >= zonesX || zy >= zonesY) return null;
    const key = zy * zonesX + zx;
    if (!cache.has(key)) cache.set(key, zone(zx, zy).settle ?? null);
    return cache.get(key);
  }
  // 離 (x, y) 不到 r 格（量到圖樣外緣）的聚落
  function settlesNear(x, y, r) {
    const out = [];
    for (let zy = Math.floor((y - r) / zoneSize); zy <= Math.floor((y + r) / zoneSize); zy++)
      for (let zx = Math.floor((x - r) / zoneSize); zx <= Math.floor((x + r) / zoneSize); zx++) {
        const s = settleOf(zx, zy);
        if (s && gapToNest(s, x, y) < r) out.push(s);
      }
    return out;
  }
  const settleById = (id) => {
    const [zx, zy] = id.split(',').map(Number);
    return settleOf(zx, zy);
  };
  return { settleOf, settlesNear, settleById, clearSettles: () => cache.clear() };
}
