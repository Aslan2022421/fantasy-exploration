// 世界形狀：在局部的起伏（landform.js）底下墊一層整個世界尺度的高度，做出海、大陸、島與山脈。
// 三部分相加，都只看「種子＋座標」，一區一區生成照樣接得起來：
// 1. 模板（data/worldshape）：建世界時照權重擲一種，用幾團平滑的隆起疊出陸地的大樣子（大陸、雙大陸、半島、內海、群島）
// 2. 大陸起伏：很大的雜訊讓海岸線不規則；離世界邊緣越近越往下壓，邊緣一定是海
// 3. 板塊山脈：撒幾個板塊中心，兩塊交界的地方抬升成一條一條的山脈；每對板塊擲一次撞不撞
// 參數裡的長度都是世界寬的比例，3×3 區的小世界看起來跟 96×96 區的一樣，只是小

import { RNG } from 'rot-js';
import { streamSeed } from '../core/rng.js';
import { fbm, hash01, makeNoise } from './noise.js';

export const SHAPE = {
  sea: -1.1, // 完全沒有隆起的地方（深海；要夠深，局部起伏才不會在海裡冒出一堆小島）
  land: 0.04, // 隆起滿了的地方（平地）；加上局部起伏，低處剛好有幾個湖
  coast: [0.12, 0.6], // 隆起在這段之間從海過渡到陸地（越窄海岸越陡、越不碎）
  grid: 32, // 這一層先在每 32 格一點的粗格上算好，生成時雙線性內插（變化都在一百格以上，內插看不出來）
  noiseBase: 0.26, // 大陸起伏的波長（世界寬的比例，約 2400 格）
  noiseAmp: 0.25, // 大陸起伏加減多少隆起
  edge: 0.1, // 離世界邊緣這個比例以內開始往下壓
  edgeDrop: 1.2, // 壓到邊緣時隆起少掉多少
  plates: 12, // 板塊幾塊
  collide: 0.5, // 每對相鄰板塊撞成山脈的機率
  ridgeWidth: 0.02, // 山脈半寬（世界寬的比例，約 180 格）
  ridgeMinWidth: 16, // 小世界時山脈至少這麼寬（格）
  ridgeHeight: 0.6, // 山脈最高抬升多少
  warp: 0.02, // 板塊交界用雜訊推彎的幅度（世界寬的比例），山脈才不是直線
  warpBase: 0.08, // 推彎雜訊的波長（世界寬的比例）
};

const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

// 照權重擲一個模板，回傳 { id, blobs: [{ x, y, r, h }]（世界比例） }
export function rollShape(templates, rng) {
  const table = Object.fromEntries(templates.map((t) => [t.id, t.weight]));
  const id = rng.getWeightedValue(table);
  const t = templates.find((x) => x.id === id);
  const blobs = t.blobs.map((b) => ({
    x: b.x + (rng.getUniform() * 2 - 1) * t.jitter,
    y: b.y + (rng.getUniform() * 2 - 1) * t.jitter,
    r: b.r * (0.85 + rng.getUniform() * 0.3),
    h: b.h,
  }));
  if (t.random) {
    const [lo, hi] = t.random.area;
    const n = rng.getUniformInt(t.random.count[0], t.random.count[1]);
    for (let i = 0; i < n; i++) {
      blobs.push({
        x: lo + rng.getUniform() * (hi - lo),
        y: lo + rng.getUniform() * (hi - lo),
        r: t.random.r[0] + rng.getUniform() * (t.random.r[1] - t.random.r[0]),
        h: t.random.h,
      });
    }
  }
  return { id: t.id, blobs };
}

// templates 沒給（測試用的地形生成）時沒有世界形狀，高度只有局部起伏
export function createContinent(seed, templates, width, height) {
  if (!templates?.length) return { id: null, at: () => 0, plates: [] };
  const rng = RNG.clone().setSeed(streamSeed(seed, 'world:shape'));
  const shape = rollShape(templates, rng);
  const plates = Array.from({ length: SHAPE.plates }, () => ({ x: rng.getUniform(), y: rng.getUniform() }));
  const nShape = makeNoise(seed, 'world:continent');
  const nWarpX = makeNoise(seed, 'world:warp-x');
  const nWarpY = makeNoise(seed, 'world:warp-y');
  const size = Math.max(width, height);
  const ridgeW = Math.max(SHAPE.ridgeMinWidth / size, SHAPE.ridgeWidth);
  const collides = (a, b) => hash01(seed, Math.min(a, b), Math.max(a, b), 1201) < SHAPE.collide;

  // 隆起：0 是海、1 是滿的陸地（可以超過 1）
  function rise(u, v) {
    let s = 0;
    for (const b of shape.blobs) {
      const d = Math.hypot((u - b.x) * (width / size), (v - b.y) * (height / size)) / b.r;
      s += b.h * smooth(2 * (1 - d)); // 半徑一半以內是滿的，往外才慢慢降到 0
    }
    s += SHAPE.noiseAmp * fbm(nShape, u / SHAPE.noiseBase, v / SHAPE.noiseBase, 1, 3);
    const edge = Math.min(u, v, 1 - u, 1 - v);
    if (edge < SHAPE.edge) s -= SHAPE.edgeDrop * smooth(1 - edge / SHAPE.edge);
    return s;
  }

  // 板塊交界的山脈：離最近兩個板塊中心的平分線多遠；那一對有撞才抬升
  function ridge(u, v) {
    const wu = u + SHAPE.warp * fbm(nWarpX, u / SHAPE.warpBase, v / SHAPE.warpBase, 1, 2);
    const wv = v + SHAPE.warp * fbm(nWarpY, u / SHAPE.warpBase, v / SHAPE.warpBase, 1, 2);
    let a = -1;
    let b = -1;
    let da = Number.POSITIVE_INFINITY;
    let db = Number.POSITIVE_INFINITY;
    for (let i = 0; i < plates.length; i++) {
      const d = Math.hypot(wu - plates[i].x, wv - plates[i].y);
      if (d < da) {
        b = a;
        db = da;
        a = i;
        da = d;
      } else if (d < db) {
        b = i;
        db = d;
      }
    }
    if (b < 0 || !collides(a, b)) return 0;
    const gap = (db - da) / 2; // 到平分線的距離（近似）
    return SHAPE.ridgeHeight * smooth(1 - gap / ridgeW);
  }

  // 世界形狀這一層在 (u, v)（世界比例）的高度
  function exact(u, v) {
    const s = rise(u, v);
    const [c0, c1] = SHAPE.coast;
    const base = SHAPE.sea + (SHAPE.land - SHAPE.sea) * smooth((s - c0) / (c1 - c0));
    return base + ridge(u, v) * smooth(s * 2); // 海裡的交界只抬一點（島弧），陸地上才是完整的山脈
  }

  // 先在粗格上算好
  const G = SHAPE.grid;
  const gw = Math.ceil(width / G) + 1;
  const gh = Math.ceil(height / G) + 1;
  const grid = new Float32Array(gw * gh);
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) grid[j * gw + i] = exact((i * G) / width, (j * G) / height);

  function at(x, y) {
    const fx = Math.max(0, Math.min(gw - 1.001, x / G));
    const fy = Math.max(0, Math.min(gh - 1.001, y / G));
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    const tx = fx - i;
    const ty = fy - j;
    const k = j * gw + i;
    const top = grid[k] * (1 - tx) + grid[k + 1] * tx;
    const bottom = grid[k + gw] * (1 - tx) + grid[k + gw + 1] * tx;
    return top * (1 - ty) + bottom * ty;
  }

  return { id: shape.id, at, exact, plates };
}
