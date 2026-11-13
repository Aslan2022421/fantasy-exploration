import { expect, test } from 'vitest';
import { FACE, FACE_FAR, FLAT, RIM, reliefOf } from './relief.js';

test('平地', () => {
  expect(reliefOf(2, 2, 2, 2)).toBe(FLAT);
});

test('北邊高一層：這格是立面', () => {
  expect(reliefOf(3, 3, 2, 2)).toBe(FACE);
});

test('北邊第二格高兩層：第二行立面', () => {
  expect(reliefOf(4, 2, 2, 2)).toBe(FACE_FAR);
});

test('南邊低一層：這格是台地邊緣', () => {
  expect(reliefOf(3, 3, 3, 2)).toBe(RIM);
});

test('又是立面又是邊緣時算立面', () => {
  expect(reliefOf(4, 4, 3, 2)).toBe(FACE);
});
