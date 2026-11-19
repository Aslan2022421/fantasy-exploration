// 地形生成的參數與分帶（terrain.js 用；調比例時改這裡；大地形與水的參數在 landform.js 的 LAND）

import { LEVELS } from './hillshade.js';
import { LAND } from './landform.js';

export const GEN = {
  treelineRange: 0.2, // 山地高出山地門檻這麼多就沒有樹（中間線性變少），也是雪線
  band: 0.1, // 溫度、濕度超過 ±這個值才算寒冷／炎熱、乾燥／潮濕
  waterShadeStep: 0.05, // 水每深這麼多暗一級
  // 坡度門檻（SLOPE_SCALE 倍；陸地約一半在 39 以下）
  hillSlope: 55, // 以上是丘陵
  gravelSlope: 95, // 山地以外坡度到這裡露出碎石（量過：非山地陸地約 6% 在這以上）
  rockSlope: 110, // 到這裡露出裸岩（約 2%）
  mountainRock: 45, // 山上坡度到這裡是岩石（以下是碎石）
  peakRadius: 3, // 山地格比周圍這麼多格內都高，才算山峰（不能超過 genZone 的外圍 E）
  swampSlope: 39, // 沼澤要比這個平
  swampWet: 0.18, // 濕度高於這個、又在最低的陸地層才積水成沼澤
  reeds: 0.12, // 緊鄰淺水或沼澤的泥土長蘆葦的機率
  mixed: 0.15, // 生態交界長混合植被的機率
};

export const SLOPE_SCALE = 4000; // 坡度存成整數時放大的倍數

export const TEMP_BANDS = ['cold', 'mild', 'hot'];
export const WET_BANDS = ['dry', 'normal', 'wet'];

export function bandOf(v) {
  return v < -GEN.band ? 0 : v > GEN.band ? 2 : 1;
}

// 水面的亮度級數：越深越暗（淺灘第 6 級，往下每 waterShadeStep 暗一級，最暗第 1 級）
export function waterLevel(h) {
  const depth = LAND.water - h;
  return Math.max(1, Math.min(LEVELS - 2, LEVELS - 2 - Math.floor(depth / GEN.waterShadeStep)));
}
