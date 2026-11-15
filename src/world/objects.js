// 物件層的生成：
// - 樹、矮叢照生態撒錨點，多格的樹冠互相讓位（樹幹永遠露出來，其餘取雜湊最小的那棵）；現在的樹都只佔一格
// - 山上平坦的台階（平台）樹線放寬，高山的台階上也有幾棵樹
// - 草本長在低處（高度層 1～2）、溫和或炎熱、不乾燥、靠近河或湖的泥土上
// - 礦坑每區 0～2 處，一處佔 3×3 格、整處落在那一區裡；先找谷地（三面有山或兩側相對有山的低處），
//   不夠再找山腳的低處；兩種都沒有的平地區，照生態決定有幾處、偏哪一類，高度層高的（丘陵、高原）先挑。
//   九格要在同一個高度層、沒有水也不是冰；疊幾層照資料的 layers 挑
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
  mineCount: [1, 2, 1], // 一區有 0、1、2 處礦坑的權重
  mineStep: 4, // 找礦坑位置時，候選的錨點每幾格取一個
  mineGap: 24, // 同一區的兩處礦坑至少隔幾格
  // 礦坑大類：w 權重；perSide 周圍每多一面有山，權重多乘幾成（金屬礦偏多山的地方）；cold 寒帶權重乘幾倍
  mineKinds: {
    'stone-mine': { w: 5 },
    'metal-mine': { w: 3.5, perSide: 1 },
    'crystal-mine': { w: 1.5, cold: 3 },
  },
  // 平地區（沒有谷地也沒有山腳）的礦坑照那一區中央的生態：count 一區 0、1、2 處的權重，kinds 大類權重。
  // 寒帶有古老岩盤露出、沙漠岩石外露，礦多；森林與草原的地面被土蓋住，礦少、多半是石礦
  plainMines: [
    {
      biomes: ['tundra', 'taiga', 'moss-forest'],
      count: [1, 2, 1],
      kinds: { 'stone-mine': 2, 'metal-mine': 4, 'crystal-mine': 3 },
    },
    { biomes: ['desert'], count: [1, 2, 1], kinds: { 'stone-mine': 5, 'metal-mine': 4, 'crystal-mine': 0.5 } },
    { biomes: ['savanna'], count: [2, 1, 0], kinds: { 'stone-mine': 2, 'metal-mine': 5, 'crystal-mine': 0.5 } },
    { biomes: ['grassland'], count: [3, 1, 0], kinds: { 'stone-mine': 6, 'metal-mine': 1, 'crystal-mine': 0.5 } },
    {
      biomes: ['temperate-forest', 'temperate-rainforest', 'rainforest'],
      count: [3, 1, 0],
      kinds: { 'stone-mine': 6, 'metal-mine': 1, 'crystal-mine': 0.5 },
    },
  ],
  footBelow: 0.1, // 山腳的低處：地面最低到山地門檻再低這麼多
  valleyTop: 0.1, // 谷地與山腳的地面最高只到山地門檻再高這麼多
  valleyRise: 0.1, // 周圍要有比山地門檻高這麼多的山
  valleyReach: 3, // 往東南西北各看幾個地理粗格（一格 8 格）找山
  valleySides: 3, // 三面有山（山凹）；兩側相對有山（山谷）也算
};

const MINE_SIZE = 3; // 礦坑佔 3×3 格

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
    .map(([id, k]) => ({ object: data.objectIndex.get(id), ...k }));

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

  // 這格周圍的山：往東南西北各看 valleyReach 個地理粗格（一格 8 格，一區自己的格子看不了那麼遠）有沒有山。
  // 回傳 { sides 幾面有山, valley 是不是谷地（三面有山或兩側相對有山）}；太高、或不是谷地也不是山腳的低處回傳 null
  function mountainsAround(z, X, Y, c) {
    if (z.h[c] > LAND.mountain + PLACE.valleyTop) return null;
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
    const valley = sides >= PLACE.valleySides || (hit[0] && hit[1]) || (hit[2] && hit[3]);
    if (valley) return { sides, valley };
    if (sides >= 1 && z.h[c] >= LAND.mountain - PLACE.footBelow) return { sides, valley };
    return null;
  }

  // 錨點 ac 的 3×3 放得下：九格同一個高度層、沒有水也不是冰
  function mineFits(z, ac) {
    for (let j = 0; j < MINE_SIZE; j++)
      for (let i = 0; i < MINE_SIZE; i++) {
        const k = ac + j * z.G + i;
        if (z.wAll[k] !== NONE || z.sAll[k] === ICE || z.tier[k] !== z.tier[ac]) return false;
      }
    return true;
  }

  // 照權重表 [{ w }] 用 r（0～1）挑一個，回傳索引
  function pickWeighted(list, r) {
    let left = r * list.reduce((s, x) => s + x, 0);
    for (let i = 0; i < list.length; i++) {
      left -= list[i];
      if (left < 0) return i;
    }
    return list.length - 1;
  }

  // 平地區用哪一列規則（照生態）；沒有對到的生態回傳 null（不放）
  const plainRule = (biome) => PLACE.plainMines.find((r) => r.biomes.includes(data.biomes[biome]?.id)) ?? null;

  // 一區的礦坑：回傳 Map（區內格號 → 物件層的那一格）。只看這一區自己的格子與世界地理，不看生成順序
  function planMines(z) {
    const map = new Map();
    if (!mineKinds.length || !z.coarse) return map;
    const X0 = z.gx0 + z.E;
    const Y0 = z.gy0 + z.E;
    const valley = [];
    const foot = [];
    const plain = [];
    for (let y = 0; y + MINE_SIZE <= z.size; y += PLACE.mineStep)
      for (let x = 0; x + MINE_SIZE <= z.size; x += PLACE.mineStep) {
        const ac = (y + z.E) * z.G + x + z.E;
        if (!mineFits(z, ac)) continue;
        const X = X0 + x;
        const Y = Y0 + y;
        const m = mountainsAround(z, X, Y, ac);
        const c = { ac, X, Y, sides: m?.sides ?? 0, rank: hash01(seed, X, Y, 311) };
        if (m) (m.valley ? valley : foot).push(c);
        else if (z.h[ac] <= LAND.mountain) plain.push(c); // 平地區不放在山上
      }
    // 有谷地或山腳就照 mineCount；整區都是平地就照中央的生態
    const center = (z.E + (z.size >> 1)) * z.G + z.E + (z.size >> 1);
    const rule = valley.length || foot.length ? null : plainRule(z.biome[center]);
    if (!valley.length && !foot.length && !rule) return map;
    const want = pickWeighted(rule ? rule.count : PLACE.mineCount, hash01(seed, X0, Y0, 310));
    if (!want) return map;
    const byRank = (a, b) => a.rank - b.rank;
    const byHeight = (a, b) => z.tier[b.ac] - z.tier[a.ac] || a.rank - b.rank; // 平地區高度層高的先挑
    const pool = rule ? plain.sort(byHeight) : [...valley.sort(byRank), ...foot.sort(byRank)];
    const picked = [];
    for (const c of pool) {
      if (picked.length >= want) break;
      if (picked.every((p) => Math.max(Math.abs(p.X - c.X), Math.abs(p.Y - c.Y)) >= PLACE.mineGap)) picked.push(c);
    }
    for (const c of picked) {
      const weights = rule
        ? mineKinds.map((k) => rule.kinds[data.objects[k.object].id] ?? 0)
        : mineKinds.map((k) => k.w * (1 + (k.perSide ?? 0) * c.sides) * (k.cold && z.tBand[c.ac] === 0 ? k.cold : 1));
      const object = mineKinds[pickWeighted(weights, hash01(seed, c.X, c.Y, 302))].object;
      for (let j = 0; j < MINE_SIZE; j++)
        for (let i = 0; i < MINE_SIZE; i++)
          map.set(c.ac + j * z.G + i, { object, part: PART_MID, anchor: i * MAX_SIZE + j });
    }
    return map;
  }

  function mineAt(z, c) {
    z.mines ??= planMines(z);
    return z.mines.get(c) ?? null;
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
  // z 是一區生成時共用的格子（G×G，左上角是世界座標 gx0, gy0；這一區從第 E 格起、邊長 size）：
  // 高度 h、高度層 tier、材質、水文、溫度帶、濕度帶、生態 biome、錨點，
  // coarse(x, y) 是世界地理粗格的高度（沒接地理時沒有）
  function objectAt(z, c, X, Y) {
    return mineAt(z, c) ?? floraAt(z, c, X, Y) ?? herbAt(z, c, X, Y);
  }

  return { anchorAt, objectAt };
}

// 錨點編碼 → 往左上幾格
export function anchorOffset(code) {
  return { k: Math.floor(code / MAX_SIZE), j: code % MAX_SIZE };
}
