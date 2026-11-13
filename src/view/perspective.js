// 全俯視透視（使用者選定）：相機懸在畫面中心正上方往下看，高的東西用「疊層」做出體積。
// - 高度用「層」算：每個高度層（tier）是 tierLayers 層，水面是第 0 層
// - 原點是角色所在的高度層：跟角色同高的在原位，比角色高的往外（離開畫面中心）錯開，比角色低的往內縮。
//   每差一層錯開 layerStep 個字元像素（一格 8 個），離中心越遠越大，總錯開量有上限
// - 地形：比往中心那一格高的邊緣，從低處那一層疊到自己底下一層，看起來是一面牆。
//   低窪的水整片往內縮，遠側的岸露出岸壁、近側的岸蓋住水邊（使用者同意的提議）
// - 樹（使用者定）：第 1 層是地貌、第 2 層留空，樹葉在第 3、4 層（離地 +2、+3），
//   樹幹 Φ 從離地 +1 疊到 +4，頂端露出樹冠；矮叢實心疊 2 層
// 畫的時候照高度由低到高，高的蓋住低的。這裡只算層與錯開量，不碰畫布，可以在 Node 裡測

export const STACK = {
  tierLayers: 2, // 每個高度層算幾層
  stepPerCell: 0.12, // 離中心每一格，每差一層多錯開幾個字元像素
  maxStep: 2, // 每差一層最多錯開幾個字元像素
  maxShift: 12, // 總錯開量上限（字元像素，一格半）
  maxWall: 8, // 牆最多疊幾層
  dims: [1, 0.85, 0.7, 0.55, 0.45], // 由頂往下各層的亮度
};

export const TREE = { trunk: [1, 2, 3, 4], leaves: [2, 3] }; // 離地幾層

export const dimAt = (j) => STACK.dims[Math.min(j, STACK.dims.length - 1)];
export const groundHeight = (tier) => tier * STACK.tierLayers;

// 離中心 dist 格時，每差一層錯開幾個字元像素
export function layerStep(dist) {
  return Math.min(STACK.maxStep, dist * STACK.stepPerCell);
}

// 比原點高 dh 層的東西錯開多少：正的往外、負的往內。(dx, dy) 是這格減畫面中心
export function shiftOf(dx, dy, dh) {
  const dist = Math.hypot(dx, dy);
  if (dist === 0 || dh === 0) return { ox: 0, oy: 0 };
  const s = Math.max(-STACK.maxShift, Math.min(STACK.maxShift, dh * layerStep(dist)));
  return { ox: Math.round((dx / dist) * s) || 0, oy: Math.round((dy / dist) * s) || 0 }; // || 0 把 -0 變 0
}

// 這格的牆：比往中心那一格高時，回傳要疊的高度範圍 { from, to }（含頭尾），不然 null
export function wallRange(world, cx, cy, x, y) {
  const dx = x - cx;
  const dy = y - cy;
  const m = Math.max(Math.abs(dx), Math.abs(dy));
  if (m === 0) return null;
  const nx = x - Math.round(dx / m);
  const ny = y - Math.round(dy / m);
  if (!world.inside(nx, ny)) return null;
  const top = groundHeight(world.tierAt(x, y));
  const low = groundHeight(world.tierAt(nx, ny));
  if (top <= low) return null;
  return { from: Math.max(low, top - STACK.maxWall), to: top - 1 };
}

// 物件這格要疊的層：[{ dh（離地幾層）, part: 'trunk' | 'leaf' | 'solid', j（離那部分頂端幾層，決定亮度）}]。
// 同高時先樹幹後樹葉，樹葉蓋住樹幹；樹幹最頂那層高過樹葉，露出來
export function objectLayers(object, isTrunk) {
  if (!object?.height) return [];
  if (!object.trunk) {
    const n = Math.min(object.height, STACK.dims.length);
    return Array.from({ length: n }, (_, i) => ({ dh: i + 1, part: 'solid', j: n - 1 - i }));
  }
  const top = (list) => list[list.length - 1];
  const out = [];
  if (isTrunk) for (const dh of TREE.trunk) out.push({ dh, part: 'trunk', j: top(TREE.trunk) - dh });
  for (const dh of TREE.leaves) out.push({ dh, part: 'leaf', j: top(TREE.leaves) - dh });
  return out.sort((a, b) => a.dh - b.dh);
}
