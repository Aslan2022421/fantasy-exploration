import { expect, test } from 'vitest';
import { ABOVE, BELOW, DEEP, SAME, Z_LEVEL, zClass } from './zlevel.js';

test('以冒險者的高度層為準分成同層、低一層、更低、高一層以上', () => {
  expect(zClass(2, 2)).toBe(SAME);
  expect(zClass(1, 2)).toBe(BELOW);
  expect(zClass(0, 2)).toBe(DEEP);
  expect(zClass(0, 5)).toBe(DEEP);
  expect(zClass(3, 2)).toBe(ABOVE);
  expect(zClass(7, 2)).toBe(ABOVE);
});

test('亮度只有三階，而且分得開：同層最亮、越低越暗', () => {
  expect(Z_LEVEL[SAME]).toBeGreaterThan(Z_LEVEL[BELOW]);
  expect(Z_LEVEL[BELOW]).toBeGreaterThan(Z_LEVEL[DEEP]);
  expect(Z_LEVEL[SAME] - Z_LEVEL[BELOW]).toBeGreaterThanOrEqual(2);
  expect(Z_LEVEL[BELOW] - Z_LEVEL[DEEP]).toBeGreaterThanOrEqual(2);
});
