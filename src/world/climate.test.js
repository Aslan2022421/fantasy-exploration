import { expect, test } from 'vitest';
import { CLIMATE, createClimate } from './climate.js';

test('溫度以高度為主：同一個位置，越高越冷', () => {
  const { climateAt } = createClimate(20261112);
  const low = climateAt(50, 50, 0);
  const high = climateAt(50, 50, 0.6);
  expect(high.t).toBeCloseTo(low.t - CLIMATE.lapse * 0.6);
});

test('濕度加上地理模擬的修正（離水近、背風面）', () => {
  const c = createClimate(20261112);
  const before = c.climateAt(80, 20, 0).w;
  c.setMoisture(() => 0.3);
  expect(c.climateAt(80, 20, 0).w).toBeCloseTo(before + 0.3);
});
