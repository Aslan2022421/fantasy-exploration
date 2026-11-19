// 世界層：每區的平均溫度、濕度、高度，以及由此得出的氣候與生態標籤（world.js 建世界時算一次）。
// numbers 是「每區幾個數字」的位置，各數字等用到的階段再加

import { herdTargets } from './herds.js';
import { LAND } from './landform.js';
import { bandOf, TEMP_BANDS, WET_BANDS } from './terrain.js';

const SAMPLES = 8; // 每區取 8×8 個點平均

export function buildRegions(gen, seed, data, zonesX, zonesY, zoneSize) {
  const regions = [];
  const step = zoneSize / SAMPLES;
  const k = SAMPLES * SAMPLES;
  for (let zy = 0; zy < zonesY; zy++) {
    for (let zx = 0; zx < zonesX; zx++) {
      let t = 0;
      let w = 0;
      let h = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const x = zx * zoneSize + (sx + 0.5) * step;
          const y = zy * zoneSize + (sy + 0.5) * step;
          const hh = gen.heightAt(x, y);
          const c = gen.climateAt(x, y, hh);
          t += c.t;
          w += c.w;
          h += hh;
        }
      }
      const temperature = t / k;
      const moisture = w / k;
      // 湖海的區沒有陸上生物；其餘照種子與區座標擲，生區時 herds.js 依這個放
      const sea = h / k < LAND.water;
      const targets = sea ? { herbivores: 0, predators: 0 } : herdTargets(seed, zx, zy);
      regions.push({
        zx,
        zy,
        temperature,
        moisture,
        height: h / k,
        climate: { temperature: TEMP_BANDS[bandOf(temperature)], moisture: WET_BANDS[bandOf(moisture)] },
        biome: data.biomes[gen.biomeAt(temperature, moisture)].id,
        numbers: { herbivores: targets.herbivores, predators: targets.predators }, // 草食、掠食各幾群（目標）
      });
    }
  }
  return regions;
}
