// 起點：起點村莊的廣場（world.js 建世界時把 geography.start 換成那裡）；沒有村莊時是最大那塊陸地上
// 離世界中央最近的地方（geography.js 算好的粗格）。往外一圈一圈找第一個能走的格子
export function startPosition(world) {
  const s = world.geography?.start;
  const cx = Math.floor(s?.x ?? world.width / 2);
  const cy = Math.floor(s?.y ?? world.height / 2);
  for (let r = 0; r < Math.max(world.width, world.height); r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (world.isPassable(cx + dx, cy + dy)) return { x: cx + dx, y: cy + dy };
      }
    }
  }
  return { x: cx, y: cy };
}
