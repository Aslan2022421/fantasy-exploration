import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { CHORD_MS, createKeyboard } from './input.js';

let steps;
let kb;
beforeEach(() => {
  vi.useFakeTimers();
  steps = [];
  kb = createKeyboard((dx, dy) => steps.push([dx, dy]));
});
afterEach(() => vi.useRealTimers());

test('數字鍵盤馬上走，不等第二個鍵', () => {
  expect(kb.keydown('Numpad9')).toBe(true);
  expect(steps).toEqual([[1, -1]]);
});

test('只按一個方向鍵：等一下才走直線', () => {
  kb.keydown('ArrowUp');
  expect(steps).toEqual([]);
  vi.advanceTimersByTime(CHORD_MS);
  expect(steps).toEqual([[0, -1]]);
});

test('時間內按第二個方向鍵：斜走一步，不會先走直線', () => {
  kb.keydown('ArrowUp');
  vi.advanceTimersByTime(20);
  kb.keydown('ArrowRight');
  vi.advanceTimersByTime(CHORD_MS * 2);
  expect(steps).toEqual([[1, -1]]);
});

test('WASD 也能組合，按住連發一直斜走', () => {
  kb.keydown('KeyS');
  kb.keydown('KeyA');
  kb.keydown('KeyA', true);
  kb.keydown('KeyA', true);
  expect(steps).toEqual([
    [-1, 1],
    [-1, 1],
    [-1, 1],
  ]);
});

test('很快放開的話照原本那個鍵走；放開後再按又是直線', () => {
  kb.keydown('ArrowLeft');
  kb.keyup('ArrowLeft');
  vi.advanceTimersByTime(CHORD_MS);
  expect(steps).toEqual([[-1, 0]]);
});

test('不是移動鍵就不管', () => {
  expect(kb.keydown('KeyQ')).toBe(false);
  vi.advanceTimersByTime(CHORD_MS);
  expect(steps).toEqual([]);
});
