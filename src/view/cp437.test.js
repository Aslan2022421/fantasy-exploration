import { describe, expect, test } from 'vitest';
import { CP437, cp437Index } from './cp437.js';

describe('CP437 對照表', () => {
  test('剛好 256 個字', () => {
    expect(CP437).toHaveLength(256);
  });

  test('常用字的格號對得上字碼', () => {
    expect(cp437Index('@')).toBe(0x40);
    expect(cp437Index('╬')).toBe(0xce);
    expect(cp437Index('█')).toBe(0xdb);
    expect(cp437Index('·')).toBe(0xfa);
  });

  test('不在表裡的字回傳 -1', () => {
    expect(cp437Index('國')).toBe(-1);
  });
});
