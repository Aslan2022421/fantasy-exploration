import { expect, test } from 'vitest';
import { ellipsis, wrap } from './wrap.js';

// 假的字寬：全形 2、半形 1
const measure = (ch) => (/[　-￿]/.test(ch) ? 2 : 1);

test('照寬度換行', () => {
  expect(wrap('一二三四五六', 6, measure)).toEqual(['一二三', '四五六']);
});

test('標點不放行首', () => {
  expect(wrap('一二三。四五', 6, measure)).toEqual(['一二三。', '四五']);
});

test('中英混排照寬度算', () => {
  expect(wrap('ab一二cd', 4, measure)).toEqual(['ab一', '二cd']);
});

test('換行符號照換', () => {
  expect(wrap('一\n二', 10, measure)).toEqual(['一', '二']);
});

test('空字串回傳一行空的', () => {
  expect(wrap('', 10, measure)).toEqual(['']);
});

test('太長就截斷加刪節號', () => {
  expect(ellipsis('一二三四五', 7, measure)).toBe('一二三…'); // 假字寬裡「…」算半形 1
  expect(ellipsis('一二三四五', 6, measure)).toBe('一二…');
  expect(ellipsis('一二', 7, measure)).toBe('一二');
});
