// 採集：挖礦、伐木、採集共用一套規則（觀測時擲骰）。
// - 第一次採一處來源時，照它的環境（生態、高度層）讀出組成：從產出權重表抽 kinds 種，之後固定
// - 每次採從組成裡抽一種，權重乘上限係數＝（1 −現存／上限）²，越接近上限越少出現，到上限就不出現
// - 一處能採 uses 次，採光後照 after 換成別的物件（樹樁、碎石坑），或留著標成採過了
// 骰子由呼叫的人給（game.js 用「主種子＋紀錄編號」開一顆），算出來的結果整筆寫進紀錄，重放時只照紀錄套

import { MAX_SIZE, PART_TRUNK } from './footprint.js';

// 上限係數：現存 n、上限 cap
export const capFactor = (n, cap) => Math.max(0, 1 - n / cap) ** 2;

// 一處來源：(x, y) 指到的那格是哪一處（樹冠指到整棵樹，回傳樹幹那格）。不能採、採過了回傳 null
export function sourceAt(world, data, x, y) {
  const o = world.objectAt(x, y);
  if (o < 0) return null;
  const def = data.objects[o].gather;
  if (!def || world.changeAt?.(x, y)?.picked) return null;
  if (!data.objects[o].trunk || world.objectPartAt(x, y) === PART_TRUNK) return { x, y, object: o, def };
  const a = world.anchorAt(x, y);
  for (let j = 0; j < MAX_SIZE; j++) {
    for (let k = 0; k < MAX_SIZE; k++) {
      const tx = a.x + k;
      const ty = a.y + j;
      if (world.objectAt(tx, ty) !== o || world.objectPartAt(tx, ty) !== PART_TRUNK) continue;
      const ta = world.anchorAt(tx, ty);
      if (ta.x === a.x && ta.y === a.y) return { x: tx, y: ty, object: o, def };
    }
  }
  return null;
}

// 這處來源的環境符合產出表的哪幾列，加總成 { 材料: 權重 }
export function weightsFor(def, env) {
  const out = {};
  for (const row of def.yields) {
    if (row.biomes && !row.biomes.includes(env.biome)) continue;
    if (row.minTier != null && env.tier < row.minTier) continue;
    for (const [m, w] of Object.entries(row.weights)) out[m] = (out[m] ?? 0) + w;
  }
  return out;
}

// 權重表乘上限係數後抽一個；全部是 0 回傳 null
export function drawOne(weights, data, stock, rng) {
  const table = {};
  let sum = 0;
  for (const [m, w] of Object.entries(weights)) {
    const cap = data.materials[data.materialIndex.get(m)].cap;
    const v = w * capFactor(stock[m] ?? 0, cap);
    if (v > 0) {
      table[m] = v;
      sum += v;
    }
  }
  return sum > 0 ? rng.getWeightedValue(table) : null;
}

// 讀出組成：抽 kinds 種不重複的材料，記下各自原本的權重
export function readComposition(def, env, data, stock, rng) {
  const pool = weightsFor(def, env);
  const n = rng.getUniformInt(def.kinds[0], def.kinds[1]);
  const comp = {};
  for (let i = 0; i < n; i++) {
    const m = drawOne(pool, data, stock, rng);
    if (!m) break;
    comp[m] = pool[m];
    delete pool[m];
  }
  return comp;
}

// 挖礦花的時間看挖到的材料的硬度（什麼都沒挖到時看組成裡最硬的）；其餘用資料的 time
export function gatherTime(def, data, material, comp) {
  if (def.action !== 'mine') return def.time;
  const hard = (m) => data.materials[data.materialIndex.get(m)].hardness;
  const h = material ? hard(material) : Math.max(...Object.keys(comp).map(hard), 1);
  return Math.round(1 + h / 2);
}

// 採一次：回傳要寫進紀錄的 data。src 是 sourceAt 的結果，state 是遊戲狀態（cells、stock），
// world 是疊上變化的世界（找樹冠用），rng 是這一次的骰子
export function planGather(world, data, state, src, rng) {
  const { def } = src;
  const key = `${src.x},${src.y}`;
  const prev = state.cells[key];
  const env = { biome: data.biomes[world.biomeAt(src.x, src.y)].id, tier: world.tierAt(src.x, src.y) };
  const fresh = !prev || prev.left == null;
  const comp = fresh ? readComposition(def, env, data, state.stock, rng) : prev.comp;
  const left = fresh ? rng.getUniformInt(def.uses[0], def.uses[1]) : prev.left;
  const material = drawOne(comp, data, state.stock, rng);
  const amount = material ? rng.getUniformInt(def.amount[0], def.amount[1]) : 0;
  const remain = left - 1;
  const cells = { [key]: { o: src.object, left: remain, comp } };
  let done = null;
  if (remain <= 0) {
    if (def.after === 'picked') cells[key] = { o: src.object, picked: true };
    else {
      cells[key] = { o: data.objectIndex.get(def.after) };
      if (data.objects[src.object].trunk) Object.assign(cells, canopyOf(world, src));
    }
    done = def.after;
  }
  return {
    object: data.objects[src.object].id,
    action: def.action,
    at: { x: src.x, y: src.y },
    read: fresh ? comp : null, // 這次才讀出來的組成（寫成文字用）
    got: material ? { material, amount } : null,
    done,
    cells,
    duration: gatherTime(def, data, material, comp),
  };
}

// 砍倒的樹：同一棵（同一個錨點）的樹冠都消失
function canopyOf(world, src) {
  const out = {};
  const a = world.anchorAt(src.x, src.y);
  for (let j = 0; j < MAX_SIZE; j++) {
    for (let k = 0; k < MAX_SIZE; k++) {
      const x = a.x + k;
      const y = a.y + j;
      if (x === src.x && y === src.y) continue;
      if (world.objectAt(x, y) !== src.object) continue;
      const b = world.anchorAt(x, y);
      if (b && b.x === a.x && b.y === a.y) out[`${x},${y}`] = { o: -1 };
    }
  }
  return out;
}

// 套一筆採集紀錄：格子換成新的樣子，材料進背包、算進現存數量
export function applyGather(state, d) {
  const bag = { ...state.bag };
  const stock = { ...state.stock };
  if (d.got) {
    bag[d.got.material] = (bag[d.got.material] ?? 0) + d.got.amount;
    stock[d.got.material] = (stock[d.got.material] ?? 0) + d.got.amount;
  }
  return { ...state, cells: { ...state.cells, ...d.cells }, bag, stock };
}
