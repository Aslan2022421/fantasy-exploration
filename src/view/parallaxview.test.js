import { expect, test } from 'vitest';
import { createParallaxView } from './parallaxview.js';
import { LERP } from './perspective.js';

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
  drawShifted: (_vx, _vy, px, py, ch, _fg, bg) => drawn.push({ px, py, ch, bg }),
};
const look = { ground: () => ({ glyph: '.', fg: '#ffffff', bg: '#000000' }), object: () => null };
let clock = 0;
const view = createParallaxView(mapView, world, [], look, { now: () => clock });
const screen = { cols: N, rows: N };
const draw = (cam, player) => {
  drawn.length = 0;
  return view.draw(screen, cam, { player });
};

test('跟角色同高的地面不錯開；比角色高的台地往外錯開，點畫面上看到的台地頂面選到台地那格', () => {
  draw({ x: 0, y: 0 }, { x: 30, y: 30 });
  const flat = drawn.find((d) => d.ch === '.' && d.px === 40 * 8 && d.py === 30 * 8);
  expect(flat).toBeTruthy(); // 第 1 層、原位
  expect(view.cellAt({ x: 0, y: 0 }, 40, 30)).toEqual({ x: 40, y: 30 });
  // 台地 x=55 往右錯開（上限 6 像素），點它右邊那格的左半邊，選到的是 55
  expect(view.cellAt({ x: 0, y: 0 }, 56, 30, 56 * 8 + 2, 30 * 8 + 4)).toEqual({ x: 55, y: 30 });
});

test('冒險者從腳下地面往上疊兩層，只畫字', () => {
  draw({ x: 0, y: 0 }, { x: 30, y: 30 });
  const p = drawn.filter((d) => d.ch === '@');
  expect(p).toHaveLength(2);
  expect(p.every((d) => d.bg === null)).toBe(true);
});

test('相機平滑緩衝：相機目標一變，先走一段、還沒到位回傳 true，時間夠了才到位', () => {
  draw({ x: 0, y: 0 }, { x: 30, y: 30 });
  clock += 16;
  expect(draw({ x: 1, y: 0 }, { x: 31, y: 30 })).toBe(true);
  const half = drawn.find((d) => d.ch === '@');
  expect(half.px).toBeGreaterThan(30 * 8); // 還沒追上
  let frames = 1;
  while (draw({ x: 1, y: 0 }, { x: 31, y: 30 }) && frames < 100) {
    clock += 16;
    frames++;
  }
  expect(frames * 16).toBeLessThan(LERP.tau * 8); // 大約半秒內到位
});
