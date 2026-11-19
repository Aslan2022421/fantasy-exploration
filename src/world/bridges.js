// 橋：河上每隔一段架一座木橋，深水河也過得去。
// 在世界座標每 BRIDGE.every 格的一條橫線、一條直線上（離區界 BRIDGE.offset 格，不會被區界切開），
// 沿著線找一段連續的河水（河道標記裡有水的格子）：要有深水、長度不超過 BRIDGE.maxLen、兩端都是陸地，
// 整段在這一區裡，就整段蓋成橋（橫線上的橋東西向 ═、直線上的南北向 ║）。
// 只看種子生出來的地形（landform.js 的高度格與 riverbed.js 的河道標記），任何順序生出來都一樣

import { WATER_DEEP, WATER_NONE } from './landform.js';

export const BRIDGE = { every: 48, offset: 24, maxLen: 8 };

const onLine = (v) => ((v % BRIDGE.every) + BRIDGE.every) % BRIDGE.every === BRIDGE.offset;

// 把橋蓋進一區的物件層（object 是「物件編號＋1」的陣列，已經有物件的格子不蓋）；ids：{ ew, ns } 兩種橋的物件編號
export function placeBridges(object, g, G, E, size, x0, y0, ids) {
  for (const b of bridgeCells(g, G, E, size, x0, y0)) {
    const i = b.y * size + b.x;
    if (!object[i]) object[i] = (b.dir === 'ew' ? ids.ew : ids.ns) + 1;
  }
}

// g：一區的高度格（有 water、river）；G 是它的邊長、E 是外圍幾格；(x0, y0) 是這一區左上的世界座標。
// 回傳 [{ x, y（區內座標）, dir: 'ew' | 'ns' }]
export function bridgeCells(g, G, E, size, x0, y0) {
  if (!g.river) return [];
  const at = (x, y) => (y + E) * G + (x + E);
  const river = (x, y) => g.river[at(x, y)] && g.water[at(x, y)] !== WATER_NONE;
  const land = (x, y) => g.water[at(x, y)] === WATER_NONE;
  const out = [];
  // along(k) 給線上第 k 格的區內座標
  const scan = (along, dir) => {
    for (let k = 1; k < size - 1; k++) {
      const [x, y] = along(k);
      if (!river(x, y)) continue;
      let end = k;
      while (end + 1 < size - 1 && river(...along(end + 1))) end++;
      const len = end - k + 1;
      let deep = false;
      for (let m = k; m <= end; m++) deep ||= g.water[at(...along(m))] === WATER_DEEP;
      const closed = land(...along(k - 1)) && land(...along(end + 1));
      if (deep && closed && len <= BRIDGE.maxLen)
        for (let m = k; m <= end; m++) {
          const [bx, by] = along(m);
          out.push({ x: bx, y: by, dir });
        }
      k = end;
    }
  };
  for (let y = 0; y < size; y++) if (onLine(y0 + y)) scan((k) => [k, y], 'ew');
  for (let x = 0; x < size; x++) if (onLine(x0 + x)) scan((k) => [x, k], 'ns');
  return out;
}
