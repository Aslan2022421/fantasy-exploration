import { expect, test } from 'vitest';
import { groundHeight, LERP, liftUp, shiftUp } from './perspective.js';
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
  line: (x1, y1, x2, y2, color, _w, dash, offset) => drawn.push({ line: true, x1, y1, x2, y2, color, dash, offset }),
  vignette: (cx, cy, r0, r1) => drawn.push({ vignette: true, cx, cy, r0, r1 }),
  drawShifted: (_vx, _vy, px, py, ch, _fg, bg) => drawn.push({ px, py, ch, bg }),
};
const look = { ground: () => ({ glyph: '.', fg: '#ffffff', bg: '#000000' }), object: () => null };
let clock = 0;
const view = createStackView(mapView, world, [], look, { now: () => clock });
const screen = { cols: 20, rows: 20 };
const K = 16 / 8; // 假的 mapView 一格 16 像素
const draw = (cam, player, route = null) => {
  drawn.length = 0;
  return view.draw(screen, cam, { player, route });
};

test('路線是線：從冒險者連到每一步，跟著地面高度錯開，爬上台地那段比較亮', () => {
  const steps = [
    { x: 10, y: 18 },
    { x: 10, y: 19 },
    { x: 10, y: 20 },
  ];
  draw({ x: 0, y: 0 }, { x: 10, y: 17 }, { steps, reachable: true });
  const lines = drawn.filter((d) => d.line);
  expect(lines).toHaveLength(3);
  expect(drawn.some((d) => d.ch === '•')).toBe(false);
  const s4 = shiftUp(groundHeight(4), K);
  expect(lines[2].y2).toBe(20 * 8 + s4.oy + 4); // 終點在台地頂面錯開後的中心
  expect(lines[2].color).not.toBe(lines[0].color);
  expect(lines.every((l) => l.dash?.length === 2)).toBe(true); // 虛線
  expect(lines[1].offset).toBeGreaterThan(lines[0].offset); // 花紋接續上一段
});

test('樹與冒險者往上每層錯得比地形多：預設大小（一格 16 像素）離地 4 層約兩格', () => {
  const s = liftUp(4, K);
  expect(s.ox * K).toBeCloseTo(32); // 32 螢幕像素＝兩格
  expect(liftUp(4, K).ox).toBeGreaterThan(shiftUp(4, K).ox);
});

test('視野外壓暗：以冒險者為中心', () => {
  draw({ x: 0, y: 0 }, { x: 10, y: 10 });
  const v = drawn.find((d) => d.vignette);
  const s1 = shiftUp(groundHeight(1), K);
  expect(v).toMatchObject({ cx: 10 * 8 + s1.ox + 4, cy: 10 * 8 + s1.oy + 4 });
  expect(v.r1).toBeGreaterThan(v.r0);
});

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
  const g = shiftUp(groundHeight(4), K);
  const at = (dh) => ({ px: 10 * 8 + g.ox + liftUp(dh, K).ox, py: 22 * 8 + g.oy + liftUp(dh, K).oy });
  expect(p.map((d) => ({ px: d.px, py: d.py }))).toEqual([at(1), at(2)]);
  expect(shiftUp(3, K).ox).toBeGreaterThan(0); // 往右
  expect(shiftUp(3, K).oy).toBeLessThan(0); // 往上
  expect(p.every((d) => d.bg === null)).toBe(true);
});

test('點畫面上看到台地頂面的那一點，選到台地那格；平地點哪格就是哪格', () => {
  draw({ x: 0, y: 0 }, { x: 10, y: 10 });
  const s4 = shiftUp(groundHeight(4), K); // 台地 (5, 20) 的頂面畫在這裡
  expect(view.cellAt({ x: 0, y: 0 }, 0, 0, 5 * 8 + s4.ox + 1, 20 * 8 + s4.oy + 1)).toEqual({ x: 5, y: 20 });
  const s1 = shiftUp(groundHeight(1), K);
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
