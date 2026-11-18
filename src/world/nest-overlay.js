// 世界加上「據點現在的樣子」：中心圖樣在生成時就蓋進物件層（terrain.js），不會變；
// 會變的是周圍換色的範圍（跟著狀態裡的隱藏人口）與寶箱開了沒，記在遊戲狀態的 nests，這裡疊上去。
// nests：{ 據點 id: { pop 人口, size 外面那群出來幾隻, rolledAt 上次擲對抗, clearedAt 清光的時間, opened 寶箱開了 } }，
// 還沒動過的據點不在裡面，照種子算開局的人口（nests.js 的 startPop）。
// 範圍內只換顏色與覆蓋（堡壘是碎石、墓地是光禿的泥土、沼澤是泥土長蘆葦），不改能不能走

import { gapToNest, NEST, rangeOf, tagOf } from './nests.js';
import { hash01 } from './noise.js';

const SPILL = NEST.rangeBase + NEST.rangeSpan; // 範圍最多伸出圖樣這麼多格

export function withNests(world, data, getNests) {
  const GRAVEL = data.surfaceIndex.get('gravel');
  const DIRT = data.surfaceIndex.get('dirt');
  const REEDS = data.coverIndex.get('reeds');
  const CHEST = data.objectIndex.get('nest-chest');
  const CHEST_OPEN = data.objectIndex.get('nest-chest-open');

  // 據點現在的狀態（沒動過的照開局）
  function nestState(id) {
    const n = world.nestById(id);
    const s = getNests()[id] ?? {};
    return {
      pop: s.pop ?? n.pop0,
      size: s.size ?? null,
      rolledAt: s.rolledAt ?? null,
      clearedAt: s.clearedAt ?? null,
      opened: !!s.opened,
    };
  }
  const defOf = (n) => data.nests[n.kind];
  const rangeNow = (n) => rangeOf(nestState(n.id).pop, defOf(n).popMax);

  // 這格屬於哪個據點：{ nest, inside（在圖樣裡）, d（離圖樣外緣幾格）} 或 null。
  // 圖樣一定在自己那一區裡，範圍最多伸出 SPILL 格，所以只有靠近區界的格子要看隔壁區
  function nestAt(x, y) {
    if (!world.inside(x, y)) return null;
    const zs = world.zoneSize;
    const zx = Math.floor(x / zs);
    const zy = Math.floor(y / zs);
    const lx = x - zx * zs;
    const ly = y - zy * zs;
    const xs = [zx, ...(lx < SPILL ? [zx - 1] : []), ...(lx >= zs - SPILL ? [zx + 1] : [])];
    const ys = [zy, ...(ly < SPILL ? [zy - 1] : []), ...(ly >= zs - SPILL ? [zy + 1] : [])];
    for (const ny of ys)
      for (const nx of xs) {
        const n = world.nestOf(nx, ny);
        if (!n) continue;
        const d = gapToNest(n, x, y);
        if (d === 0) return { nest: n, inside: true, d };
        if (d <= rangeNow(n)) return { nest: n, inside: false, d };
      }
    return null;
  }

  // 範圍裡（圖樣外、沒有水）的格子換成什麼：{ s 材質, k 覆蓋（-1 沒有）} 或 null
  function ringLook(x, y) {
    const at = nestAt(x, y);
    if (!at || at.inside || world.waterAt(x, y) >= 0) return null;
    const ground = defOf(at.nest).ground;
    if (ground === 'gravel') return { s: GRAVEL, k: -1 };
    if (ground === 'bare') return { s: DIRT, k: -1 };
    return { s: DIRT, k: hash01(world.seed, x, y, 9101) < 0.3 ? REEDS : -1 };
  }

  const surfaceAt = (x, y) => ringLook(x, y)?.s ?? world.surfaceAt(x, y);
  const opened = (x, y) => {
    const at = nestAt(x, y);
    return at?.inside && at.nest.chest.x === x && at.nest.chest.y === y && nestState(at.nest.id).opened;
  };
  const objectAt = (x, y) => {
    const o = world.objectAt(x, y);
    return o === CHEST && opened(x, y) ? CHEST_OPEN : o;
  };

  return {
    ...world,
    nestAt,
    nestState,
    // 據點的範圍半徑（從圖樣外緣量）與標籤
    nestRange: rangeNow,
    nestTag: (n) => tagOf(nestState(n.id).pop, defOf(n).popMax),
    // (x, y) 在不在某個據點的圖樣或範圍裡（動物遊蕩時避開）
    inNestArea: (x, y) => !!nestAt(x, y),
    surfaceAt,
    objectAt,
    groundAt: (x, y) => ringLook(x, y)?.s ?? world.groundAt(x, y),
    coverAt(x, y) {
      const r = ringLook(x, y);
      return r ? r.k : world.coverAt(x, y);
    },
    cell(x, y) {
      const c = world.cell(x, y);
      if (!c) return c;
      const at = nestAt(x, y);
      if (!at) return c;
      const r = at.inside ? null : ringLook(x, y);
      const o = objectAt(x, y);
      return {
        ...c,
        ...(r ? { surface: data.surfaces[r.s], cover: r.k < 0 ? null : data.covers[r.k] } : {}),
        object: o < 0 ? null : data.objects[o],
        nest: at,
      };
    },
  };
}
