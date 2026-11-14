import { expect, test } from 'vitest';
import { drawMapLabels, tooltipText } from './mouse.js';

test('懸停提示只取查看結果的第一句', () => {
  expect(tooltipText('細草，泥土，平原。溫帶森林（溫和、普通），高度 132')).toBe('細草，泥土，平原');
  expect(tooltipText('你自己')).toBe('你自己');
});

test('地圖標籤：有路線時標步數，有懸停時在那格旁邊出提示框', () => {
  const calls = [];
  const panels = { routeLabel: (_ctx, _s, px, py, text) => calls.push({ px, py, text }) };
  const worldView = { screenOf: (_cam, x, y) => ({ vx: x, vy: y }) };
  const screen = { map: { x: 0, y: 24 }, tile: 24 };
  drawMapLabels({
    ctx: null,
    screen,
    panels,
    worldView,
    cam: null,
    route: { steps: [1, 2, 3], reachable: true },
    target: { x: 2, y: 1 },
    tip: { cell: { x: 5, y: 5 }, text: '細草，泥土，平原。溫帶森林' },
  });
  expect(calls).toEqual([
    { px: 48, py: 48, text: '3 步' },
    { px: 120, py: 144, text: '細草，泥土，平原' },
  ]);
});

test('懸停的正是路線終點：合成一個框', () => {
  const calls = [];
  const panels = { routeLabel: (_ctx, _s, px, py, text) => calls.push({ px, py, text }) };
  const worldView = { screenOf: (_cam, x, y) => ({ vx: x, vy: y }) };
  drawMapLabels({
    ctx: null,
    screen: { map: { x: 0, y: 0 }, tile: 24 },
    panels,
    worldView,
    cam: null,
    route: { steps: new Array(18), reachable: true },
    target: { x: 2, y: 1 },
    tip: { cell: { x: 2, y: 1 }, text: '雪，山地。凍原' },
  });
  expect(calls.map((c) => c.text)).toEqual(['18 步｜雪，山地']);
});
