// 全俯視透視（使用者選定）：相機懸在畫面中心正上方往下看。
// 高的東西頂面畫在原位，側面往畫面中心那一側拉出來（透視裡底部比頂部離中心近），
// 離中心越遠、高出越多，側面越長；正下方幾乎看不到側面。角色一走，相機跟著動，周圍的高處會跟著轉。
// - 地形：比鄰近格子高的地方，側面用高處的字元、顏色調暗，蓋住往中心那幾格
// - 物件：有高度（樹 3、矮叢 2）的物件，側面是物件自己的字元調暗，只蓋沒有物件的格子
// 頂面都在原位，滑鼠點哪格就是哪格。這裡只算「這一格被誰的側面蓋到」，不碰畫布，可以在 Node 裡測

export const PERSPECTIVE = {
  max: 3, // 側面最長幾格
  terrain: 0.05, // 地形每高一層、離中心每一格，側面長多少格（離中心 20 格、高一層約 1 格）
  object: 0.035, // 物件每一單位高度、離中心每一格（離中心 20 格的樹約 2 格）
};

// 離中心 dist 格、高出 rise 的東西，側面拉幾格
export function sideLengthAt(dist, rise, k) {
  if (rise <= 0) return 0;
  return Math.min(PERSPECTIVE.max, Math.round(dist * rise * k));
}

// (x, y) 有沒有被外側哪一格的側面蓋到；(cx, cy) 是畫面中心。
// 從這格沿「中心 → 這格」的方向往外找，近的優先（近的擋在遠的前面）。
// 回傳 { x, y, k, kind: 'terrain' | 'object' }，沒有回傳 null。hasObject：這格本身有沒有物件
export function perspectiveSource(world, objects, cx, cy, x, y, hasObject) {
  const dx = x - cx;
  const dy = y - cy;
  const m = Math.max(Math.abs(dx), Math.abs(dy));
  if (m === 0) return null;
  const here = world.tierAt(x, y);
  for (let k = 1; k <= PERSPECTIVE.max; k++) {
    const sx = x + Math.round((dx * k) / m);
    const sy = y + Math.round((dy * k) / m);
    if (!world.inside(sx, sy)) continue;
    const dist = Math.hypot(sx - cx, sy - cy);
    const tier = world.tierAt(sx, sy);
    if (sideLengthAt(dist, tier - here, PERSPECTIVE.terrain) >= k) return { x: sx, y: sy, k, kind: 'terrain' };
    if (hasObject || tier < here) continue;
    const o = world.objectAt(sx, sy);
    if (o >= 0 && sideLengthAt(dist, objects[o].height, PERSPECTIVE.object) >= k)
      return { x: sx, y: sy, k, kind: 'object' };
  }
  return null;
}
