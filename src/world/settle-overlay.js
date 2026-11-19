// 世界加上「聚落現在的樣子」：圖樣在生成時就蓋進物件層（terrain.js），不會變；
// 會變的是周圍換色的範圍（跟著狀態裡的隱藏人口）與經濟（照冒險者採光了附近幾成資源點）。
// settles：{ 聚落 id: { pop 人口 } }，還沒動過的不在裡面，照種子算開局的人口（settlements.js 的 startPop）。
// 範圍內換成泥土加稀疏草叢，不改能不能走；動物、怪物都不進來（creatures.js、chase.js、fight.js 看 inSettleArea）

import { PART_TRUNK } from './footprint.js';
import { gapToNest } from './nests.js';
import { hash01 } from './noise.js';
import { ECON_TAGS, POP_TAGS, popTagIndex, rangeOfSettle, SETTLE } from './settlements.js';

// 經濟：採光的比例到這些門檻，徵兆出現、經濟標籤降一段、再降一段
export const ECON_STEPS = { sign: 0.2, drop1: 0.4, drop2: 0.7 };
const SIGNS = {
  chop: '村民抱怨附近的樹越來越少',
  pick: '村民抱怨附近的草藥越來越難找',
  mine: '村民抱怨附近的礦坑快被挖空了',
};

// getSettles()：狀態裡的聚落；getCells()：狀態裡採過的格子（算經濟）
export function withSettlements(world, data, getSettles, getCells = () => ({})) {
  const DIRT = data.surfaceIndex.get('dirt');
  const GRASS = data.coverIndex.get('sparse-grass');
  const ROAD = data.surfaceIndex.get('road');
  const spill = Math.max(0, ...(data.settlements ?? []).map((d) => d.rangeBase + SETTLE.rangeSpan));
  const defOf = (s) => data.settlements[s.kind];

  function settleState(id) {
    const s = world.settleById(id);
    return { pop: getSettles()[id]?.pop ?? s.pop0 };
  }
  const rangeNow = (s) => rangeOfSettle(settleState(s.id).pop, defOf(s));

  // 這格屬於哪個聚落：{ settle, inside（在圖樣裡）, d（離圖樣外緣幾格）} 或 null
  function settleAt(x, y) {
    if (!world.inside(x, y)) return null;
    const zs = world.zoneSize;
    const zx = Math.floor(x / zs);
    const zy = Math.floor(y / zs);
    const lx = x - zx * zs;
    const ly = y - zy * zs;
    const xs = [zx, ...(lx < spill ? [zx - 1] : []), ...(lx >= zs - spill ? [zx + 1] : [])];
    const ys = [zy, ...(ly < spill ? [zy - 1] : []), ...(ly >= zs - spill ? [zy + 1] : [])];
    for (const ny of ys)
      for (const nx of xs) {
        const s = world.settleOf(nx, ny);
        if (!s) continue;
        const d = gapToNest(s, x, y);
        if (d === 0) return { settle: s, inside: true, d };
        if (d <= rangeNow(s)) return { settle: s, inside: false, d };
      }
    return null;
  }

  // 範圍裡（圖樣外、沒有水）的格子：泥土，三成長稀疏草叢
  function ringLook(x, y) {
    const at = settleAt(x, y);
    if (!at || at.inside || world.waterAt(x, y) >= 0 || world.surfaceAt(x, y) === ROAD) return null; // 路照舊是路
    return { s: DIRT, k: hash01(world.seed, x, y, 9310) < 0.3 ? GRASS : -1 };
  }

  // 經濟看的資源點：圖樣外 SETTLE.sources 格內能採的來源（樹看樹幹那格、礦坑看錨點），照沒採過的世界算一次記著
  const sourceSets = new Map();
  function sourcesOf(s) {
    let set = sourceSets.get(s.id);
    if (set) return set;
    set = new Map(); // "x,y" → 採集方式（chop、pick、mine）
    const base = world.base ?? world;
    const R = SETTLE.sources;
    for (let y = s.y0 - R; y < s.y0 + s.h + R; y++)
      for (let x = s.x0 - R; x < s.x0 + s.w + R; x++) {
        const o = base.objectAt(x, y);
        if (o < 0) continue;
        const def = data.objects[o];
        if (!def.gather) continue;
        if (def.layers) {
          const a = base.anchorAt(x, y);
          if (a.x !== x || a.y !== y) continue;
        } else if (def.trunk && base.objectPartAt(x, y) !== PART_TRUNK) continue;
        set.set(`${x},${y}`, def.gather.action);
      }
    sourceSets.set(s.id, set);
    return set;
  }

  // 經濟：{ tag 標籤編號, ratio 採光了幾成, total 資源點總數, sign 徵兆的文字或 null }。
  // 採光＝那處來源沒有剩下的次數（採過了、砍成樹樁、礦坑挖空）；照採過的格子直接算，不擲骰、不另寫紀錄
  function settleEcon(s, cells = getCells()) {
    const set = sourcesOf(s);
    const gone = { chop: 0, pick: 0, mine: 0 };
    let n = 0;
    for (const [key, ch] of Object.entries(cells)) {
      const action = set.get(key);
      if (!action || ch.left != null) continue;
      gone[action] = (gone[action] ?? 0) + 1;
      n++;
    }
    const ratio = set.size ? n / set.size : 0;
    const drops = ratio >= ECON_STEPS.drop2 ? 2 : ratio >= ECON_STEPS.drop1 ? 1 : 0;
    const base = Math.min(4, Math.floor(defOf(s).econStart / 20));
    const most = Object.entries(gone).sort((a, b) => b[1] - a[1])[0][0];
    return {
      tag: Math.max(0, base - drops),
      ratio,
      total: set.size,
      sign: ratio >= ECON_STEPS.sign ? SIGNS[most] : null,
    };
  }

  // 資源標籤：圖樣外 SETTLE.sources 格內最多的生態寫什麼（山地多過三成寫礦石）
  const resourceCache = new Map();
  function settleResource(s) {
    if (resourceCache.has(s.id)) return resourceCache.get(s.id);
    const count = new Map();
    let mountain = 0;
    let all = 0;
    const R = SETTLE.sources;
    for (let y = s.y0 - R; y < s.y0 + s.h + R; y += 2)
      for (let x = s.x0 - R; x < s.x0 + s.w + R; x += 2) {
        const b = world.biomeAt(x, y);
        if (b < 0 || world.waterAt(x, y) >= 0) continue;
        all++;
        if (data.landforms[world.landformAt(x, y)]?.style === 'mountain') mountain++;
        count.set(b, (count.get(b) ?? 0) + 1);
      }
    let text = '木材';
    if (all && mountain / all > 0.3) text = '礦石';
    else {
      const top = [...count.entries()].sort((a, b) => b[1] - a[1])[0];
      if (top) text = data.biomes[top[0]].resource ?? text;
    }
    resourceCache.set(s.id, text);
    return text;
  }

  return {
    ...world,
    settleAt,
    settleState,
    settleRange: rangeNow,
    settleTag: (s) => POP_TAGS[popTagIndex(settleState(s.id).pop, defOf(s))],
    settleEcon,
    econName: (i) => ECON_TAGS[i],
    settleResource,
    // (x, y) 在不在某個聚落的圖樣或範圍裡（安全區：生物不進來）
    inSettleArea: (x, y) => !!settleAt(x, y),
    surfaceAt: (x, y) => ringLook(x, y)?.s ?? world.surfaceAt(x, y),
    groundAt: (x, y) => ringLook(x, y)?.s ?? world.groundAt(x, y),
    coverAt(x, y) {
      const r = ringLook(x, y);
      return r ? r.k : world.coverAt(x, y);
    },
    cell(x, y) {
      const c = world.cell(x, y);
      if (!c) return c;
      const at = settleAt(x, y);
      if (!at) return c;
      const r = at.inside ? null : ringLook(x, y);
      return {
        ...c,
        ...(r ? { surface: data.surfaces[r.s], cover: r.k < 0 ? null : data.covers[r.k] } : {}),
        settle: at,
      };
    },
  };
}
