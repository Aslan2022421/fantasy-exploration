// 隨遊戲附帶的素材都在、授權檔都在、字元表尺寸正確
import { existsSync, readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

const root = new URL('../', import.meta.url);
const at = (p) => new URL(p, root);

test('字型與授權檔都在', () => {
  for (const p of [
    'assets/fonts/fusion-pixel-12px-proportional-zh_tw.ttf',
    'assets/fonts/OFL-fusion-pixel.txt',
    'tools/cp437/PxPlus_IBM_BIOS.ttf',
    'tools/cp437/LICENSE-oldschool-pc-font-pack.txt',
    'CREDITS.md',
  ]) {
    expect(existsSync(at(p)), p).toBe(true);
  }
});

test('CP437 字元表是 128×128 的 PNG', () => {
  const png = readFileSync(at('assets/tiles/cp437.png'));
  expect(png.subarray(1, 4).toString()).toBe('PNG');
  expect(png.readUInt32BE(16)).toBe(128);
  expect(png.readUInt32BE(20)).toBe(128);
});
