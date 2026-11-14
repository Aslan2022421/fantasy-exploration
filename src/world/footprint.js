// 多格物件的佔地：一棵樹有一個錨點（左上角），從錨點往右下長出直徑 d 格的一團（接近圓形）。
// 樹冠的哪一側亮：光從右上照，右上那半亮、左下那半暗，中間一條是中間色。
// 純函式，可以在 Node 裡測

export const MAX_SIZE = 4;

export const PART_MID = 0;
export const PART_LIT = 1; // 右上，被照到
export const PART_DARK = 2; // 左下，背光
export const PART_TRUNK = 3; // 樹幹：樹冠正中間那一格，有樹幹的物件在這格擋路

// 直徑 d 的樹冠，樹幹在哪一格（相對錨點）；偶數直徑取中心偏右下那格
export function trunkCell(d) {
  const m = Math.floor(d / 2);
  return { i: m, j: m };
}

// (i, j) 是相對錨點的位置（0～d-1）；在不在直徑 d 的那一團裡。
// shape：round 接近圓形（直徑 3 是九宮格，樹幹旁邊貼 8 邊）；cross 是十字（旁邊貼 4 邊，只用在奇數直徑）
export function inFootprint(i, j, d, shape = 'round') {
  if (i < 0 || j < 0 || i >= d || j >= d) return false;
  const c = (d - 1) / 2;
  if (shape === 'cross' && d % 2 === 1) return i === c || j === c;
  const r = d / 2 + 0.1;
  return (i - c) ** 2 + (j - c) ** 2 <= r * r;
}

// 直徑 d 那一團有幾格
export function areaOf(d, shape = 'round') {
  let n = 0;
  for (let j = 0; j < d; j++) for (let i = 0; i < d; i++) if (inFootprint(i, j, d, shape)) n++;
  return n;
}

// 一組大小平均佔幾格（用來換算撒錨點的機率，讓樹變大後林子的密度不會跟著暴增）
export function meanArea(sizes, shape = 'round') {
  return sizes.reduce((s, d) => s + areaOf(d, shape), 0) / sizes.length;
}

// (i, j) 在直徑 d 的樹冠裡屬於哪一側
export function partOf(i, j, d) {
  if (d <= 1) return PART_MID;
  const c = (d - 1) / 2;
  const v = i - c - (j - c); // 往右、往上越大
  if (v > 0.5) return PART_LIT;
  if (v < -0.5) return PART_DARK;
  return PART_MID;
}
