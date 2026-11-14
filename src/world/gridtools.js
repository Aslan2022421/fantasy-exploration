// 格子上常用的小工具：二元堆積、八個鄰格、點到線段的距離（geography.js 用）

// 小的二元堆積：照 key 由小到大取出
export function heap() {
  const keys = [];
  const vals = [];
  return {
    get size() {
      return keys.length;
    },
    push(k, v) {
      let i = keys.length;
      keys.push(k);
      vals.push(v);
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (keys[p] <= k) break;
        keys[i] = keys[p];
        vals[i] = vals[p];
        i = p;
      }
      keys[i] = k;
      vals[i] = v;
    },
    pop() {
      const top = vals[0];
      const lastK = keys.pop();
      const lastV = vals.pop();
      const len = keys.length;
      if (len) {
        let i = 0;
        for (;;) {
          const l = i * 2 + 1;
          const r = l + 1;
          let m = l;
          if (l >= len) break;
          if (r < len && keys[r] < keys[l]) m = r;
          if (keys[m] >= lastK) break;
          keys[i] = keys[m];
          vals[i] = vals[m];
          i = m;
        }
        keys[i] = lastK;
        vals[i] = lastV;
      }
      return top;
    },
  };
}

export const AROUND = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

// 連通（W×H 的格子，blocked(i) 是過不去的格子）：從 start 出發，每塊到不了的陸地找「要跨過最少格障礙」的路接回來。
// 只掃一遍（0-1 BFS：走陸地不花成本、跨一格障礙花 1），所以世界再大也只跟格數成正比。
// 要跨超過 maxCross 格、或小於 minSize 格的陸地不接（海中的小島不架橋）。
// 回傳要開淺灘的路段，每段是相鄰兩格 [a, b]
export function linkRegions(W, H, blocked, start, { maxCross, minSize }) {
  const n = W * H;
  const dist = new Int32Array(n).fill(-1);
  const prev = new Int32Array(n).fill(-1);
  const dq = new Int32Array(2 * n + 2);
  let head = n;
  let tail = n;
  dist[start] = 0;
  dq[tail++] = start;
  const done = new Uint8Array(n);
  while (head < tail) {
    const i = dq[head++];
    if (done[i]) continue;
    done[i] = 1;
    const x = i % W;
    const y = (i - x) / W;
    for (const [dx, dy] of AROUND) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      const cost = blocked(j) ? 1 : 0;
      const d = dist[i] + cost;
      if (dist[j] >= 0 && dist[j] <= d) continue;
      dist[j] = d;
      prev[j] = i;
      if (cost) dq[tail++] = j;
      else dq[--head] = j;
    }
  }
  // 陸地分塊；每塊取 dist 最小的一格當接口
  const comp = new Int32Array(n).fill(-1);
  const links = [];
  const linked = new Uint8Array(n);
  const stack = [];
  for (let s = 0; s < n; s++) {
    if (comp[s] >= 0 || blocked(s)) continue;
    comp[s] = s;
    stack.push(s);
    let size = 0;
    let best = s;
    while (stack.length) {
      const i = stack.pop();
      size++;
      if (dist[i] >= 0 && (dist[best] < 0 || dist[i] < dist[best])) best = i;
      const x = i % W;
      const y = (i - x) / W;
      for (const [dx, dy] of AROUND) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (comp[j] >= 0 || blocked(j)) continue;
        comp[j] = s;
        stack.push(j);
      }
    }
    if (dist[best] <= 0 || dist[best] > maxCross || size < minSize) continue;
    for (let k = best; dist[k] > 0 && prev[k] >= 0 && !linked[k]; k = prev[k]) {
      linked[k] = 1; // 跟別塊共用的路段只開一次
      links.push([k, prev[k]]);
    }
  }
  return links;
}

// 點 (px, py) 到線段 (a → b) 的距離
export function segDist(px, py, ax, ay, bx, by) {
  const t = segT(px, py, ax, ay, bx, by);
  return Math.hypot(px - (ax + t * (bx - ax)), py - (ay + t * (by - ay)));
}

// 點 (px, py) 投影到線段 (a → b) 上的位置：0 在 a、1 在 b
export function segT(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  return len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
}
