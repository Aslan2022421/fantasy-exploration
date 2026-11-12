import { RNG } from 'rot-js';
import { expect, test } from 'vitest';
import { createStreams, STREAMS } from './rng.js';

test('同一個主種子，每條亂數的結果都一樣', () => {
  const a = createStreams(42);
  const b = createStreams(42);
  for (const n of STREAMS) expect(a.get(n).getUniform()).toBe(b.get(n).getUniform());
});

test('四條亂數互不影響：用掉一條不改變另一條', () => {
  const a = createStreams(42);
  const b = createStreams(42);
  for (let i = 0; i < 50; i++) a.get('combat').getUniform();
  expect(a.get('world').getUniform()).toBe(b.get('world').getUniform());
});

test('四條亂數彼此不同', () => {
  const s = createStreams(42);
  const firsts = STREAMS.map((n) => s.get(n).getUniform());
  expect(new Set(firsts).size).toBe(STREAMS.length);
});

test('檢查點：存下狀態再還原，接下來的數字一樣', () => {
  const s = createStreams(7);
  s.get('gather').getUniform();
  const snap = structuredClone(s.snapshot());
  const next = s.get('gather').getUniform();
  const t = createStreams(7);
  t.restore(snap);
  expect(t.get('gather').getUniform()).toBe(next);
});

test('不動全域亂數', () => {
  const before = RNG.getState().join();
  createStreams(3).get('world').getUniform();
  expect(RNG.getState().join()).toBe(before);
});
