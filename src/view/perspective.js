// 疊層（使用者選定 C）：高的東西同一個字疊好幾層做出體積，全部往畫面上方疊，每高一層往上錯開一樣的量，
// 跟在畫面哪裡無關。走路時每一格的錯開量都不變，畫面只是平移，不會游動、沒有凹凸鏡感
// （試過以角色為中心往外錯開的透視，離中心越遠錯越開，看起來像凹凸鏡、會頭暈，已取代）。
// - 高度用「層」算：每個高度層（tier）是 tierLayers 層；原點是水面（第 0 層），比原點高幾層就往上錯開幾層
// - 地形：比南邊那一格高的格子，從低處那一層疊到自己底下一層，看起來是一面朝南的牆。
//   低窪的水在原點，北岸露出岸壁
// - 樹（使用者定）：第 1 層是地貌、第 2 層留空，樹葉在第 3、4 層（離地 +2、+3），
//   樹幹 Φ 從離地 +1 疊到 +4，頂端露出樹冠；矮叢實心疊 2 層
// 畫的時候照高度由低到高，同高時北邊先畫、南邊後畫。這裡只算層與錯開量，不碰畫布，可以在 Node 裡測

export const STACK = {
  tierLayers: 2, // 每個高度層算幾層
  step: 2, // 每高一層往上錯開幾個字元像素（一格 8 個）
  maxShift: 32, // 錯開量上限（字元像素，四格）
  maxWall: 8, // 牆最多疊幾層
  dims: [1, 0.85, 0.7, 0.55, 0.45], // 由頂往下各層的亮度
};

export const TREE = { trunk: [1, 2, 3, 4], leaves: [2, 3] }; // 離地幾層

export const dimAt = (j) => STACK.dims[Math.min(j, STACK.dims.length - 1)];
export const groundHeight = (tier) => tier * STACK.tierLayers;
export const MAX_SHIFT_CELLS = Math.ceil(STACK.maxShift / 8); // 錯開最多幾格

// 高度 h（層）的東西往上錯開幾個字元像素
export function shiftOf(h) {
  return { ox: 0, oy: -Math.min(STACK.maxShift, Math.max(0, h) * STACK.step) || 0 }; // || 0 把 -0 變 0
}

// 這格的牆：比南邊那一格高時，回傳要疊的高度範圍 { from, to }（含頭尾），不然 null
export function wallRange(world, x, y) {
  if (!world.inside(x, y + 1)) return null;
  const top = groundHeight(world.tierAt(x, y));
  const low = groundHeight(world.tierAt(x, y + 1));
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
