// 斜投影（2.5D）：從南邊斜上方看下去。每一格依高度層往上抬 LIFT 行，抬起來空出的地方畫成側面；
// 由北往南一列一列畫，南邊（前面）抬高的格子會蓋住北邊（後面）的東西。
// 這裡只做座標換算，不碰畫布，可以在 Node 裡測

export const LIFT = 2; // 高一層，畫面上往上抬幾行（1 行時牆太矮，看起來像條紋）
export const MAX_TIER = 4;
export const MAX_LIFT = MAX_TIER * LIFT;

// 世界格 (x, y) 的頂面畫在視窗第幾列（可能超出視窗）
export function topRow(y, tier, camY) {
  return y - camY - tier * LIFT;
}

// 世界格 (x, y) 的頂面在視窗裡的位置
export function screenOf(world, cam, x, y) {
  return { vx: x - cam.x, vy: topRow(y, world.tierAt(x, y), cam.y) };
}

// 視窗第 (vx, vy) 格看到的是哪一個世界格：那一欄裡由南往北找，
// 第一個「頂面或側面蓋住這一列」的格子就是（南邊的會蓋住北邊的）。看到世界外回傳 null
export function pick(world, cam, vx, vy) {
  const x = cam.x + vx;
  for (let y = cam.y + vy + MAX_LIFT; y >= cam.y + vy; y--) {
    if (!world.inside(x, y)) continue;
    const top = topRow(y, world.tierAt(x, y), cam.y);
    if (top <= vy && vy <= y - cam.y) return { x, y };
  }
  return null;
}
