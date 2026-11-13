// 台地與立面：比較這格與南北鄰格的高度層（landform.js 的 tier）。
// 從斜上方看，高一層的地面南側會露出一段立面：某格北邊比它高，這格就是立面（暗）；
// 北邊第二格高兩層以上，這格是第二行立面（更暗）。某格比南邊高，這格是台地的邊緣（稍亮）。
// 只影響畫面，不影響走路與地形

export const FLAT = 0;
export const RIM = 1; // 台地邊緣
export const FACE = 2; // 立面，緊貼高處的那一行
export const FACE_FAR = 3; // 立面的第二行（高兩層以上才有）

// n2、n1：北邊第二格、第一格的高度層；here：這格；s1：南邊那格
export function reliefOf(n2, n1, here, s1) {
  if (n1 > here) return FACE;
  if (n2 > here + 1) return FACE_FAR;
  if (here > s1) return RIM;
  return FLAT;
}
