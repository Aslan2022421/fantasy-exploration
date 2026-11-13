import { expect, test } from 'vitest';
import { CLIMATE, createClimate } from './climate.js';
import { LAND } from './landform.js';

const { climateAt } = createClimate(20261112);

test('溫度隨高度下降：同一個位置，越高越冷', () => {
  const low = climateAt(50, 50, 0);
  const high = climateAt(50, 50, 0.6);
  expect(high.t).toBeCloseTo(low.t - CLIMATE.lapse * 0.6);
});

test('貼著水線的低地比較濕，高出 lowWetRange 以上就不加', () => {
  const shore = climateAt(80, 20, LAND.water);
  const far = climateAt(80, 20, LAND.water + CLIMATE.lowWetRange);
  const farther = climateAt(80, 20, LAND.water + CLIMATE.lowWetRange + 0.3);
  expect(shore.w - far.w).toBeCloseTo(CLIMATE.lowWet);
  expect(far.w).toBeCloseTo(farther.w);
});
