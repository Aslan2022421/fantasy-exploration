// 高度分層與立面：把高度切成幾大層，越高的層越亮（亮度由高度決定，見 hillshade.js 的 lightLevel）。
// 從斜上方看，高一層的地面南側會露出一段立面：某格北邊比它高一層，這格就畫成立面（暗）；
// 高兩層以上，再往南一格也是立面（更暗）。某格比南邊高一層，這格是台地的邊緣（稍亮）。
// 只影響畫面，不影響走路與地形。層用的是高度較粗的那幾層雜訊，邊界才連成整齊的輪廓

export const FLAT = 0;
export const RIM = 1; // 台地邊緣
export const FACE = 2; // 立面，緊貼高處的那一行
export const FACE_FAR = 3; // 立面的第二行（高兩層以上才有）

export const TERRACE_STEP = 0.14; // 一層多高（高度 -1～1）
export const TIERS = 5; // 陸地分幾層亮度
const TIER_BASE = -2; // 第 0 層從 -0.28 起（淺水線附近），往上每 0.14 一層

export const terraceOf = (h) => Math.floor(h / TERRACE_STEP);

// 這格在第幾層（0 最低～TIERS-1 最高），用來決定亮度
export function tierOf(h) {
  return Math.max(0, Math.min(TIERS - 1, terraceOf(h) - TIER_BASE));
}

// n2、n1：北邊第二格、第一格的高度；h：這格；s1：南邊那格
export function reliefOf(n2, n1, h, s1) {
  const here = terraceOf(h);
  if (terraceOf(n1) > here) return FACE;
  if (terraceOf(n2) > here + 1) return FACE_FAR;
  if (here > terraceOf(s1)) return RIM;
  return FLAT;
}
