// 台地與立面：把高度分成一階一階，從斜上方看，高一階的地面南側會露出一段立面。
// 某格北邊比它高一階，這格就畫成立面（暗）；高兩階以上，再往南一格也是立面（更暗）。
// 某格比南邊高一階，這格是台地的邊緣（稍亮）。只影響畫面，不影響走路與地形

export const FLAT = 0;
export const RIM = 1; // 台地邊緣
export const FACE = 2; // 立面，緊貼高處的那一行
export const FACE_FAR = 3; // 立面的第二行（高兩階以上才有）

export const TERRACE_STEP = 0.04; // 一階多高（高度 -1～1）

export const terraceOf = (h) => Math.floor(h / TERRACE_STEP);

// n2、n1：北邊第二格、第一格的高度；h：這格；s1：南邊那格
export function reliefOf(n2, n1, h, s1) {
  const here = terraceOf(h);
  if (terraceOf(n1) > here) return FACE;
  if (terraceOf(n2) > here + 1) return FACE_FAR;
  if (here > terraceOf(s1)) return RIM;
  return FLAT;
}
