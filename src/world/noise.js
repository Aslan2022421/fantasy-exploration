// 地形用的雜訊與雜湊：結果只看「種子＋座標」，跟生成順序、玩家位置都無關，
// 所以任何一區、任何一格都能單獨算出來，區與區的交界也接得起來

import { Noise, RNG } from 'rot-js';
import { streamSeed } from '../core/rng.js';

// ROT.js 的 Simplex 預設 256 個梯度，每 256 個晶格單位就重複一次；給 4096 個，世界放大到 96×96 區也看不出重複
const GRADIENTS = 4096;

// Simplex 的建構子用全域亂數洗牌：先存下全域亂數，設成「種子＋用途」，建完再還原，
// 不影響別處，也不受別處影響
export function makeNoise(seed, purpose) {
  const saved = RNG.getState();
  RNG.setSeed(streamSeed(seed, purpose));
  const noise = new Noise.Simplex(GRADIENTS);
  RNG.setState(saved);
  return noise;
}

// 多層疊加：base 是最粗那層的波長（格），每層波長減半、振幅減半；回傳 -1～1
export function fbm(noise, x, y, base, octaves) {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let f = 1 / base;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise.get(x * f, y * f);
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}

// 每格的小變化：種子＋座標＋用途 → 0～1，同樣輸入永遠同樣結果
export function hash01(seed, x, y, salt) {
  let h = (seed ^ Math.imul(salt + 1, 0x27d4eb2d)) >>> 0;
  h = Math.imul(h ^ Math.imul(x | 0, 0x85ebca6b), 0xc2b2ae35);
  h = Math.imul(h ^ Math.imul(y | 0, 0x165667b1), 0x9e3779b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
