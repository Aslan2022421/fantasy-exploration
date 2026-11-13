// 氣候：溫度、濕度。底子是兩張雜訊圖，再照地形調整（使用者要隨機有真實地貌的邏輯）：
// - 溫度隨高度下降：越高越冷，雪與凍原會長在山上和高地，低地平原比較暖
// - 濕度看離水多近：貼著水線的低地比較濕（用高度近似，不真的量到水的距離）
// - 積雪只在很冷的地方：寒帶但沒那麼冷的是凍土（泥土加苔蘚、稀疏草叢），冰原和草原之間才有過渡
// 只看「種子＋座標＋那格的高度」，任何一格都能單獨算

import { LAND } from './landform.js';
import { fbm, makeNoise } from './noise.js';

export const CLIMATE = {
  base: 144, // 溫度、濕度最粗那層的波長，約 1.5 區
  tempOctaves: 2,
  wetOctaves: 3,
  lapse: 0.5, // 高度每高 1，溫度降多少（高度 -1～1：水線 -0.34、平地約 0、山地 0.42 以上）
  lowWet: 0.2, // 貼著水線的低地最多加多少濕度
  lowWetRange: 0.25, // 高出水線這麼多以上就不加
  snowTemp: -0.3, // 溫度低於這個才積雪
};

export function createClimate(seed) {
  const nTemp = makeNoise(seed, 'terrain:temperature');
  const nWet = makeNoise(seed, 'terrain:moisture');
  const tempNoise = (x, y) => fbm(nTemp, x, y, CLIMATE.base, CLIMATE.tempOctaves);
  const wetNoise = (x, y) => fbm(nWet, x, y, CLIMATE.base, CLIMATE.wetOctaves);

  // (x, y) 這格的 { t 溫度, w 濕度 }，h 是這格的高度（landform.js 的 heightAt）
  function climateAt(x, y, h) {
    const low = Math.min(1, Math.max(0, 1 - (h - LAND.water) / CLIMATE.lowWetRange));
    return { t: tempNoise(x, y) - CLIMATE.lapse * h, w: wetNoise(x, y) + CLIMATE.lowWet * low };
  }

  return { climateAt, tempNoise, wetNoise };
}
