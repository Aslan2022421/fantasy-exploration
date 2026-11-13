// 全俯視透視（使用者選定）：相機懸在畫面中心正上方往下看，高的東西用「疊層」做出體積。
// 同一個字疊好幾層：頂層在原位、最亮，往下每層往畫面中心錯開幾個字元像素、越來越暗
// （透視裡底部比頂部離中心近）。錯開的方向與距離看這格離畫面中心多遠，角色一走就跟著變，視差從這裡來。
// - 物件：樹 3 層、矮叢 2 層（物件的 height），只疊字
// - 地形：比往中心那一格高的邊緣，高一層疊 2 層、兩層以上 3 層，連背景一起疊，看起來是一面牆
// 頂面都在原位，滑鼠點哪格就是哪格。這裡只算層數與錯開量，不碰畫布，可以在 Node 裡測

export const STACK = {
  stepPerCell: 0.15, // 離中心每一格，每層多錯開幾個字元像素
  maxStep: 3, // 每層最多錯開幾個字元像素（一格 8 個）
  dims: [1, 0.8, 0.6, 0.45], // 由頂層往下各層的亮度
};
export const MAX_LAYERS = STACK.dims.length;

// 離中心 dist 格時，每層錯開幾個字元像素
export function layerStep(dist) {
  return Math.min(STACK.maxStep, dist * STACK.stepPerCell);
}

// 頂層往下第 j 層（頂層 j = 0）的錯開量：往畫面中心拉 j 層。(dx, dy) 是這格減畫面中心
export function layerOffset(dx, dy, j) {
  const dist = Math.hypot(dx, dy);
  if (dist === 0 || j === 0) return { ox: 0, oy: 0 };
  const d = j * layerStep(dist);
  return { ox: Math.round((-dx / dist) * d) || 0, oy: Math.round((-dy / dist) * d) || 0 }; // || 0 把 -0 變 0
}

// 地形這格要疊幾層：比往中心那一格高才疊（高一層 2 層、兩層以上 3 層），不然 0
export function terrainLayers(world, cx, cy, x, y) {
  const dx = x - cx;
  const dy = y - cy;
  const m = Math.max(Math.abs(dx), Math.abs(dy));
  if (m === 0) return 0;
  const nx = x - Math.round(dx / m);
  const ny = y - Math.round(dy / m);
  if (!world.inside(nx, ny)) return 0;
  const rise = world.tierAt(x, y) - world.tierAt(nx, ny);
  return rise <= 0 ? 0 : 1 + Math.min(rise, 2);
}

// 物件要疊幾層：物件的高度，最多 MAX_LAYERS；沒有高度的不疊
export function objectLayers(object) {
  return Math.min(MAX_LAYERS, object?.height ?? 0);
}
