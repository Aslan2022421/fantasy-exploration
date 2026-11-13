import { expect, test } from 'vitest';
import { createStackView } from './stackview.js';

// 61×61 的小世界，全是第 1 層，右邊 x 55～58 是第 4 層的台地；角色站在正中間
const N = 61;
const tiers = Array.from({ length: N }, () => new Array(N).fill(1));
for (let y = 0; y < N; y++) for (let x = 55; x <= 58; x++) tiers[y][x] = 4;
const world = {
  inside: (x, y) => x >= 0 && y >= 0 && x < N && y < N,
  tierAt: (x, y) => tiers[y]?.[x] ?? 0,
  objectAt: () => -1,
};
const drawn = [];
const mapView = {
  fill() {},
  clipped: (fn) => fn(),
  draw() {},
  drawShifted: (vx, vy, ox, oy, _ch, _fg, bg) => drawn.push({ vx, vy, ox, oy, bg }),
};
const look = { ground: () => ({ glyph: '.', fg: '#fff', bg: '#000' }), object: () => null };
const view = createStackView(mapView, world, [], look);
const cam = { x: 0, y: 0 };
view.draw({ cols: N, rows: N }, cam, { player: { x: 30, y: 30 } });

test('比角色高的台地往外錯開，點畫面上看到台地頂面的那一格，選到的是台地那格', () => {
  const top = drawn.find((d) => d.vx === 55 && d.vy === 30 && d.bg === '#000');
  expect(top.ox).toBeGreaterThan(0); // 在畫面中心右邊，往右錯開
  expect(view.cellAt(cam, 56, 30)).toEqual({ x: 55, y: 30 });
});

test('跟角色同一層的格子在原位，點哪格就是哪格', () => {
  expect(view.cellAt(cam, 31, 30)).toEqual({ x: 31, y: 30 });
  expect(view.cellAt(cam, 30, 30)).toEqual({ x: 30, y: 30 });
});
