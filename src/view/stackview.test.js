import { expect, test } from 'vitest';
import { groundHeight, shiftOf } from './perspective.js';
import { createStackView } from './stackview.js';

// 31×31 的小世界，全是第 1 層，y 20～24 是第 4 層的台地
const N = 31;
const tiers = Array.from({ length: N }, () => new Array(N).fill(1));
for (let y = 20; y <= 24; y++) for (let x = 0; x < N; x++) tiers[y][x] = 4;
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
  drawShifted: (vx, vy, ox, oy, ch, _fg, bg) => drawn.push({ vx, vy, ox, oy, ch, bg }),
};
const look = { ground: () => ({ glyph: '.', fg: '#fff', bg: '#000' }), object: () => null };
const view = createStackView(mapView, world, [], look);
const cam = { x: 0, y: 0 };
const draw = (player) => {
  drawn.length = 0;
  view.draw({ cols: N, rows: N }, cam, { player });
};

test('同一格的錯開量只看高度：角色走到哪都一樣（畫面不會游動）', () => {
  const at = () => drawn.find((d) => d.vx === 5 && d.vy === 10 && d.bg === '#000');
  draw({ x: 15, y: 15 });
  const a = at();
  draw({ x: 3, y: 22 });
  expect(at()).toEqual(a);
  expect(a.oy).toBe(shiftOf(groundHeight(1)).oy);
});

test('冒險者從腳下地面往上疊兩層，只畫字', () => {
  draw({ x: 15, y: 22 });
  const p = drawn.filter((d) => d.ch === '@');
  expect(p.map((d) => d.oy)).toEqual([shiftOf(groundHeight(4) + 1).oy, shiftOf(groundHeight(4) + 2).oy]);
  expect(p.every((d) => d.bg === null)).toBe(true);
});

test('點畫面上看到台地頂面的那一格，選到的是台地那格；平地點哪格就是哪格', () => {
  draw({ x: 15, y: 15 });
  // 第 4 層往上錯開 16 像素＝兩格：台地 y=20 的頂面畫在畫面第 18 列
  expect(view.cellAt(cam, 7, 18)).toEqual({ x: 7, y: 20 });
  // 第 1 層往上錯開 4 像素：點畫面上 y=5 那格地面的中心（40 - 4 + 4）
  expect(view.cellAt(cam, 7, 5, 60, 40)).toEqual({ x: 7, y: 5 });
});
