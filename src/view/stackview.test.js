import { expect, test } from 'vitest';
import { groundHeight, LERP, shiftUp } from './perspective.js';
import { createStackView } from './stackview.js';

// 40×40 的小世界，全是第 1 層，y 20～24 是第 4 層的台地
const N = 40;
const tiers = Array.from({ length: N }, () => new Array(N).fill(1));
for (let y = 20; y <= 24; y++) for (let x = 0; x < N; x++) tiers[y][x] = 4;
const world = {
  width: N,
  height: N,
  inside: (x, y) => x >= 0 && y >= 0 && x < N && y < N,
  tierAt: (x, y) => tiers[y]?.[x] ?? 0,
  objectAt: () => -1,
};
const drawn = [];
let layers = 0;
const mapView = {
  fill() {},
  clipped: (fn) => fn(),
  tile: () => 16,
  layer() {
    layers++;
    return { tile: 16, drawShifted() {} };
  },
  blit: (_layer, gx, gy) => drawn.push({ blit: true, gx, gy }),
  drawShifted: (_vx, _vy, px, py, ch, _fg, bg) => drawn.push({ px, py, ch, bg }),
};
const look = { ground: () => ({ glyph: '.', fg: '#ffffff', bg: '#000000' }), object: () => null };
let clock = 0;
const view = createStackView(mapView, world, [], look, { now: () => clock });
const screen = { cols: 20, rows: 20 };
const draw = (cam, player) => {
  drawn.length = 0;
  return view.draw(screen, cam, { player });
};

test('分塊只畫一次：相機沒動時再畫，不再重畫分塊，只貼圖', () => {
  draw({ x: 0, y: 0 }, { x: 10, y: 10 });
  const first = layers;
  expect(first).toBeGreaterThan(0);
  draw({ x: 0, y: 0 }, { x: 10, y: 10 });
  expect(layers).toBe(first);
  expect(drawn.some((d) => d.blit)).toBe(true);
});

test('冒險者從腳下地面往右上疊兩層、只畫字，錯開量只看高度', () => {
  draw({ x: 0, y: 0 }, { x: 10, y: 22 });
  const p = drawn.filter((d) => d.ch === '@');
  const at = (h) => ({ px: 10 * 8 + shiftUp(h).ox, py: 22 * 8 + shiftUp(h).oy });
  expect(p.map((d) => ({ px: d.px, py: d.py }))).toEqual([at(groundHeight(4) + 1), at(groundHeight(4) + 2)]);
  expect(shiftUp(3).ox).toBeGreaterThan(0); // 往右
  expect(shiftUp(3).oy).toBeLessThan(0); // 往上
  expect(p.every((d) => d.bg === null)).toBe(true);
});

test('點畫面上看到台地頂面的那一點，選到台地那格；平地點哪格就是哪格', () => {
  draw({ x: 0, y: 0 }, { x: 10, y: 10 });
  const s4 = shiftUp(groundHeight(4)); // 台地 (5, 20) 的頂面畫在這裡
  expect(view.cellAt({ x: 0, y: 0 }, 0, 0, 5 * 8 + s4.ox + 1, 20 * 8 + s4.oy + 1)).toEqual({ x: 5, y: 20 });
  const s1 = shiftUp(groundHeight(1));
  expect(view.cellAt({ x: 0, y: 0 }, 0, 0, 5 * 8 + s1.ox + 4, 5 * 8 + s1.oy + 4)).toEqual({ x: 5, y: 5 });
});

test('相機平滑緩衝：目標一變先走一段，還沒到位回傳 true，大約半秒內到位', () => {
  draw({ x: 0, y: 0 }, { x: 10, y: 10 });
  clock += 16;
  expect(draw({ x: 1, y: 0 }, { x: 11, y: 10 })).toBe(true);
  let frames = 1;
  while (draw({ x: 1, y: 0 }, { x: 11, y: 10 }) && frames < 100) {
    clock += 16;
    frames++;
  }
  expect(frames * 16).toBeLessThan(LERP.tau * 8);
});
