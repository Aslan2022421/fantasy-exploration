// 生態覆蓋：只長在泥土與沙地上。緊鄰淺水或沼澤的泥土長蘆葦；生態交界是混合植被；其餘照生態的 cover。
// 只看種子＋座標與上下左右四格（terrain.js 生一區時用）

import { hash01 } from './noise.js';

// covers：每個生態的 [覆蓋編號, 密度] 表；ids：地形編號 { NONE, DIRT, SAND, SHALLOW, SWAMP, REEDS, MIXED }；
// odds：{ reeds 長蘆葦的機率, mixed 交界長混合植被的機率 }
export function createCoverPicker(seed, covers, ids, odds) {
  const { NONE, DIRT, SAND, SHALLOW, SWAMP, REEDS, MIXED } = ids;
  // z：{ sAll 材質, wAll 水文, bAll 生態, G 一列幾格 }；c 是這格在 G×G 裡的編號
  return function coverAt(z, c, X, Y) {
    const s = z.sAll[c];
    if (z.wAll[c] !== NONE || (s !== DIRT && s !== SAND)) return NONE;
    const a = hash01(seed, X, Y, 101);
    const b = hash01(seed, X, Y, 102);
    let wet = false;
    let edge = false;
    for (const d of [1, -1, z.G, -z.G]) {
      if (z.wAll[c + d] === SHALLOW || z.wAll[c + d] === SWAMP) wet = true;
      if (z.bAll[c + d] !== z.bAll[c]) edge = true;
    }
    if (wet && s === DIRT && b < odds.reeds) return REEDS;
    const list = covers[z.bAll[c]];
    if (edge && list.length && b < odds.mixed) return MIXED;
    let sum = 0;
    for (const [k, density] of list) {
      sum += density;
      if (a < sum) return k;
    }
    return NONE;
  };
}
