// 路網的幾何小工具（roads.js 用）：粗格之間的直線、Chaikin 磨圓、線段照區索引

// 兩個粗格之間直線經過的粗格（不含起點）
export function cellsBetween(a, b, W) {
  let x = a % W;
  let y = (a - x) / W;
  const bx = b % W;
  const by = (b - bx) / W;
  const out = [];
  while (x !== bx || y !== by) {
    const ex = Math.abs(bx - x);
    const ey = Math.abs(by - y);
    if (ex >= ey / 2) x += Math.sign(bx - x);
    if (ey >= ex / 2) y += Math.sign(by - y);
    out.push(y * W + x);
  }
  return out;
}

// Chaikin 磨圓：每段切掉兩端各四分之一，兩端點留著
export function chaikin(pts) {
  if (pts.length < 3) return pts;
  const out = [pts[0]];
  for (let k = 0; k < pts.length - 1; k++) {
    const [ax, ay] = pts[k];
    const [bx, by] = pts[k + 1];
    out.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25], [ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

// 每一區會碰到哪些線段（外接框加寬 3 格）
export function indexByZone(segments, zoneSize, zonesX, zonesY) {
  const map = new Map();
  segments.forEach((s, k) => {
    const pad = 3;
    const zx0 = Math.max(0, Math.floor((Math.min(s.ax, s.bx) - pad) / zoneSize));
    const zx1 = Math.min(zonesX - 1, Math.floor((Math.max(s.ax, s.bx) + pad) / zoneSize));
    const zy0 = Math.max(0, Math.floor((Math.min(s.ay, s.by) - pad) / zoneSize));
    const zy1 = Math.min(zonesY - 1, Math.floor((Math.max(s.ay, s.by) + pad) / zoneSize));
    for (let zy = zy0; zy <= zy1; zy++)
      for (let zx = zx0; zx <= zx1; zx++) {
        const key = `${zx},${zy}`;
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(k);
      }
  });
  return map;
}
