// 氣候：溫度、濕度，生態用「溫度×濕度」查表（Whittaker 那種做法）：
// - 溫度以高度為主：越高越冷；緯度北冷南熱；再加一張變化很慢、幅度小的雜訊，低地也有一點冷熱差別
// - 濕度：底子是雜訊，再加上地理模擬算的修正（geography.js：離河湖越近越濕，山的背風面乾）
// - 積雪只在很冷的地方：寒帶但沒那麼冷的是凍土
// 只看「種子＋座標＋那格的高度」與世界的地理，任何一格都能單獨算

import { fbm, makeNoise } from './noise.js';

export const CLIMATE = {
  base: 144, // 濕度雜訊最粗那層的波長，約 1.5 區
  tempBase: 400, // 溫度雜訊的波長（很慢）
  tempOctaves: 2,
  wetOctaves: 3,
  tempAmp: 0.3, // 溫度雜訊乘多少（幅度小，高度才是主軸）
  lapse: 0.75, // 高度每高 1，溫度降多少（高度 -1～1：水線 -0.34、平地約 0、山地 0.42 以上）
  midHeight: 0.05, // 這個高度的溫度大約是溫和的中間
  wetAmp: 1, // 濕度雜訊乘多少
  snowTemp: -0.3, // 溫度低於這個才積雪
  latitude: 0.6, // 緯度：北邊界比中間冷這麼多、南邊界熱這麼多（世界中間不加減）
};

// worldHeight：世界有多高（格），有給才算緯度（北冷南熱）
export function createClimate(seed, worldHeight = 0) {
  const nTemp = makeNoise(seed, 'terrain:temperature');
  const nWet = makeNoise(seed, 'terrain:moisture');
  const tempNoise = (x, y) => fbm(nTemp, x, y, CLIMATE.tempBase, CLIMATE.tempOctaves);
  const wetNoise = (x, y) => fbm(nWet, x, y, CLIMATE.base, CLIMATE.wetOctaves);
  let moisture = () => 0; // 地理模擬的濕度修正，世界建好後由 setMoisture 接上

  // (x, y) 這格的 { t 溫度, w 濕度 }，h 是這格的高度（landform.js 的 heightAt）
  function climateAt(x, y, h) {
    const lat = worldHeight ? CLIMATE.latitude * 2 * (y / worldHeight - 0.5) : 0;
    const t = CLIMATE.tempAmp * tempNoise(x, y) - CLIMATE.lapse * (h - CLIMATE.midHeight) + lat;
    const w = CLIMATE.wetAmp * wetNoise(x, y) + moisture(x, y);
    return { t, w };
  }

  return {
    climateAt,
    tempNoise,
    wetNoise,
    setMoisture: (fn) => {
      moisture = fn;
    },
  };
}
