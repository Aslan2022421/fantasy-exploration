import { expect, test } from 'vitest';
import { FACE, FACE_FAR, FLAT, RIM, reliefOf, TERRACE_STEP } from './relief.js';

const s = TERRACE_STEP;

test('平地', () => {
  expect(reliefOf(0.01, 0.01, 0.01, 0.01)).toBe(FLAT);
});

test('北邊高一階：這格是立面', () => {
  expect(reliefOf(s * 1.5, s * 1.5, s * 0.5, s * 0.5)).toBe(FACE);
});

test('北邊第二格高兩階：第二行立面', () => {
  expect(reliefOf(s * 2.5, s * 0.5, s * 0.5, s * 0.5)).toBe(FACE_FAR);
});

test('南邊低一階：這格是台地邊緣', () => {
  expect(reliefOf(s * 1.5, s * 1.5, s * 1.5, s * 0.5)).toBe(RIM);
});

test('又是立面又是邊緣時算立面', () => {
  expect(reliefOf(s * 2.5, s * 2.5, s * 1.5, s * 0.5)).toBe(FACE);
});
