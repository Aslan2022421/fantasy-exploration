// 物件層的生成：
// - 樹、矮叢照生態撒錨點，多格的樹冠互相讓位（樹幹永遠露出來，其餘取雜湊最小的那棵）；現在的樹都只佔一格
// - 山上平坦的台階（平台）樹線放寬，高山的台階上也有幾棵樹
// - 草本長在低處（高度層 1～2）、溫和或炎熱、不乾燥、靠近河或湖的泥土上
// - 礦坑長在山與山之間的谷地（低處、三面有山或兩側相對有山），一處佔 2×2 格，四格要在同一個高度層、
//   沒有水也不是冰；大類（石礦、金屬礦、晶礦）照權重挑，疊幾層照資料的 layers 挑
// 只看種子＋座標與周圍幾格，不看生成順序，跨區接得起來

import { inFootprint, MAX_SIZE, meanArea, PART_MID, PART_TRUNK, partOf, trunkCell } from './footprint.js';
import { LAND } from './landform.js';
import { fbm, hash01, makeNoise } from './noise.js';

export const PLACE = {
  floraBase: 24, // 樹叢成片的大小
  herbDensity: 0.08, // 符合條件的格子長草本的機率
  herbRange: 2, // 這麼多格內有河或湖
  herbMaxTier: 2, // 高度層到這裡為止才長草本
  ledgeSlope: 25, // 山上坡度（SLOPE_SCALE 倍）比這個平的算平台
  ledgeAbove: 0.35, // 高出山地門檻這麼多以內的平台，樹線放寬
  ledgeTrees: 0.4, // 平台上長樹的機率至少是平地的幾成
  mineDensity: 0.012, // 谷地裡每格當礦坑錨點的機率
  mineKinds: { 'stone-mine': 5, 'metal-mine': 3.5, 'crystal-mine': 1.5 }, // 礦坑大類的權重
  valleyTop: 0.1, // 谷地的地面最高只到山地門檻再高這麼多（山腳的低處）
  valleyRise: 0.1, // 周圍要有比山地門檻高這麼多的山
  valleyReach: 3, // 往東南西北各看幾個地理粗格（一格 8 格）找山
  valleySides: 3, // 三面有山（山凹）；兩側相對有山（山谷）也算
};

const MINE_SIZE = 2; // 礦坑佔 2×2 格

// 礦坑在錨點 (x, y) 疊幾層：照資料的 layers 範圍用雜湊挑（世界與畫面都用這個算，挖之前就看得到）
export function mineLayers(seed, def, x, y) {
  const [lo, hi] = def.layers;
  return lo + Math.floor(hash01(seed, x, y, 303) * (hi - lo + 1));
}

// ids：地形編號（ROCK、DIRT、ICE、SHALLOW、DEEP、NONE）；treelineRange：山地高出門檻多少就沒有樹
export function createObjectPlacer(seed, data, ids, treelineRange) {
  const { ROCK, DIRT, ICE, SHALLOW, DEEP, NONE } = ids;
  const nFlora = makeNoise(seed, 'terrain:flora');
  const objectId = (name) => {
    if (!data.objectIndex.has(name)) throw new Error(`物件生成需要的物件不在資料裡：${name}`);
    return data.objectIndex.get(name);
  };
  const flora = data.biomes.map((b) => b.flora.map((f) => [objectId(f.object), f.density]));
  const objectArea = data.objects.map((o) => meanArea(o.sizes, o.canopy));
  // 資料裡沒有的就不放（測試用的小資料只有幾種物件）
  const PINE = data.objectIndex.get('pine') ?? -1;
  const HERB = data.objectIndex.get('herb') ?? -1;
  const mineKinds = Object.entries(PLACE.mineKinds)
    .filter(([id]) => data.objectIndex.has(id))
    .map(([id, w]) => [data.objectIndex.get(id), w]);
  const mineTotal = mineKinds.reduce((s, [, w]) => s + w, 0);

  // 植物長得出來的地方：沒有水、不是岩石或冰
  const canGrow = (water, surface) => water === NONE && surface !== ROCK && surface !== ICE;

  // 這格是不是一棵物件的左上角，回傳 { object, size, turn } 或 null。撒的機率除以平均佔地，
  // 樹冠大的林子不會跟著變密；山地越高樹越少，高出 treelineRange 就沒有樹
  function anchorAt(x, y, biome, water, surface, h, slope) {
    if (!canGrow(water, surface)) return null;
    let line = h > LAND.mountain ? Math.max(0, 1 - (h - LAND.mountain) / treelineRange) : 1;
    // 山上平坦的台階（平台）樹線放寬：高出山地門檻 ledgeAbove 以內，平台至少照 ledgeTrees 的比例長樹
    if (h > LAND.mountain && slope < PLACE.ledgeSlope && h < LAND.mountain + PLACE.ledgeAbove)
      line = Math.max(line, PLACE.ledgeTrees);
    if (line <= 0) return null;
    const list = flora[biome];
    const m = Math.min(1, Math.max(0, 0.5 + 1.5 * fbm(nFlora, x, y, PLACE.floraBase, 2)));
    for (let i = 0; i < list.length; i++) {
      const [object, density] = list[i];
      if (hash01(seed, x, y, i) < (Math.min(1, density * 2 * m) * line) / objectArea[object]) {
        // 山上長的樹都是松樹（生態照山腳那片的，樹種換成耐高山的）
        const kind = h > LAND.mountain && data.objects[object].trunk && PINE >= 0 ? PINE : object;
        const sizes = data.objects[kind].sizes;
        const size = sizes[Math.floor(hash01(seed, x, y, 50 + i) * sizes.length)];
        return { object: kind, size, turn: hash01(seed, x, y, 60 + i) < 0.5 }; // turn：對邊兩片的樹冠是上下還是左右
      }
    }
    return null;
  }

  // 谷地：地面低（最高到山腳），往東南西北看，至少三個方向不遠處有山把它圍住，或兩側相對有山。
  // 周圍的山用世界地理的粗格高度看（geography.js，一格 8 格），一區自己的格子看不了那麼遠
  function valleyAt(z, X, Y, c) {
    if (!z.coarse || z.h[c] > LAND.mountain + PLACE.valleyTop) return false;
    const high = LAND.mountain + PLACE.valleyRise;
    const hit = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ].map(([dx, dy]) => {
      for (let k = 1; k <= PLACE.valleyReach; k++) if (z.coarse(X + dx * k * 8, Y + dy * k * 8) > high) return true;
      return false;
    });
    const sides = hit.filter(Boolean).length;
    return sides >= PLACE.valleySides || (hit[0] && hit[1]) || (hit[2] && hit[3]);
  }

  const mineRoll = (X, Y) => hash01(seed, X, Y, 301);

  // 錨點 ac（世界座標 X, Y）長不長礦坑：回傳物件編號或 -1。擲到的格子還要四格都能放、在谷地，
  // 而且是周圍一圈擲到的格子裡雜湊最小的（兩處不會疊在一起）
  function mineAnchor(z, ac, X, Y) {
    if (!mineKinds.length) return -1;
    z.mine ??= new Int16Array(z.G * z.G).fill(-2);
    if (z.mine[ac] !== -2) return z.mine[ac];
    let out = -1;
    const r = mineRoll(X, Y);
    if (r < PLACE.mineDensity) {
      const cells = [ac, ac + 1, ac + z.G, ac + z.G + 1];
      const fits = cells.every((k) => z.wAll[k] === NONE && z.sAll[k] !== ICE && z.tier[k] === z.tier[ac]);
      let lowest = true;
      for (let dy = -1; dy <= 1 && lowest; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const q = mineRoll(X + dx, Y + dy);
          if ((dx || dy) && q < PLACE.mineDensity && q < r) lowest = false;
        }
      if (fits && lowest && valleyAt(z, X, Y, ac)) {
        let pick = hash01(seed, X, Y, 302) * mineTotal;
        for (const [o, w] of mineKinds) {
          out = o;
          pick -= w;
          if (pick < 0) break;
        }
      }
    }
    z.mine[ac] = out;
    return out;
  }

  // 礦坑：往左上找 2×2 會蓋到這格的錨點
  function mineAt(z, c, X, Y) {
    for (let j = 0; j < MINE_SIZE; j++)
      for (let k = 0; k < MINE_SIZE; k++) {
        const o = mineAnchor(z, c - j * z.G - k, X - k, Y - j);
        if (o >= 0) return { object: o, part: PART_MID, anchor: k * MAX_SIZE + j };
      }
    return null;
  }

  // r 格內有沒有一格符合 test
  function near(z, c, r, test) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (test(c + dy * z.G + dx)) return true;
    return false;
  }

  // 樹與矮叢：往左上找會蓋到這格的錨點。樹冠只長在跟樹幹同一個高度層、長得出植物的格子上（樹冠底下是平地），
  // 樹幹那格本身也要長得出來
  function floraAt(z, c, X, Y) {
    if (!canGrow(z.wAll[c], z.sAll[c])) return null;
    let best = null;
    for (let j = 0; j < MAX_SIZE; j++) {
      for (let k = 0; k < MAX_SIZE; k++) {
        const ac = c - j * z.G - k;
        const a = z.anchors[ac];
        if (!a || !inFootprint(k, j, a.size, data.objects[a.object].canopy, a.turn)) continue;
        const tc = trunkCell(a.size);
        const tci = ac + tc.j * z.G + tc.i;
        if (!canGrow(z.wAll[tci], z.sAll[tci]) || z.tier[tci] !== z.tier[c]) continue;
        const isTrunk = data.objects[a.object].trunk && k === tc.i && j === tc.j;
        const rank = isTrunk ? -1 : hash01(seed, X - k, Y - j, 77);
        if (!best || rank < best.rank) best = { a, rank, k, j, isTrunk };
      }
    }
    if (!best) return null;
    const part = best.isTrunk ? PART_TRUNK : partOf(best.k, best.j, best.a.size);
    return { object: best.a.object, part, anchor: best.k * MAX_SIZE + best.j };
  }

  function herbAt(z, c, X, Y) {
    if (HERB < 0 || z.sAll[c] !== DIRT || z.wAll[c] !== NONE) return null;
    if (z.tier[c] < 1 || z.tier[c] > PLACE.herbMaxTier || z.tBand[c] < 1 || z.wBand[c] < 1) return null;
    if (hash01(seed, X, Y, 202) >= PLACE.herbDensity) return null;
    const water = (k) => z.wAll[k] === SHALLOW || z.wAll[k] === DEEP;
    if (!near(z, c, PLACE.herbRange, water)) return null;
    return { object: HERB, part: PART_MID, anchor: 0 };
  }

  // 這格的物件：{ object（data.objects 的編號）, part（footprint.js 的 PART_*）, anchor（錨點在左上幾格：k×MAX_SIZE＋j）} 或 null。
  // z 是一區生成時共用的格子（G×G，左上角是世界座標 gx0, gy0）：高度 h、高度層 tier、材質、水文、溫度帶、濕度帶、錨點，
  // coarse(x, y) 是世界地理粗格的高度（沒接地理時沒有）
  function objectAt(z, c, X, Y) {
    return mineAt(z, c, X, Y) ?? floraAt(z, c, X, Y) ?? herbAt(z, c, X, Y);
  }

  return { anchorAt, objectAt };
}

// 錨點編碼 → 往左上幾格
export function anchorOffset(code) {
  return { k: Math.floor(code / MAX_SIZE), j: code % MAX_SIZE };
}
