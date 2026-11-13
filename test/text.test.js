// 字的檢查：畫面上會出現的中文都要在 Fusion Pixel 字型裡，否則會畫成空白
// 檢查的來源：資料的名稱、labels.js，以及程式碼裡的字串（去掉註解）

import { readdirSync, readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { DATA } from '../src/data/load.js';
import { cp437Index } from '../src/view/cp437.js';
import { CLIMATE_NAMES } from '../src/world/labels.js';
import { fontCodepoints } from './cmap.js';

const root = new URL('../', import.meta.url);
const font = fontCodepoints(readFileSync(new URL('assets/fonts/fusion-pixel-12px-proportional-zh_tw.ttf', root)));

function sourceFiles(dir) {
  const out = [];
  for (const e of readdirSync(new URL(dir, root), { withFileTypes: true })) {
    const p = `${dir}${e.name}`;
    if (e.isDirectory()) out.push(...sourceFiles(`${p}/`));
    else if (e.name.endsWith('.js') && !e.name.endsWith('.test.js') && e.name !== 'cp437.js') out.push(p);
  }
  return out;
}

// 程式碼裡字串字面值的內容（先拿掉 // 與 /* */ 註解）
function stringsIn(code) {
  const noComments = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
  return [...noComments.matchAll(/'([^'\n]*)'|"([^"\n]*)"|`([^`]*)`/g)].map((m) => m[1] ?? m[2] ?? m[3]);
}

test('畫面上的中文都在介面字型裡', () => {
  const texts = [
    ...DATA.terrains.map((t) => t.name),
    ...DATA.objects.map((o) => o.name),
    ...DATA.biomes.map((b) => b.name),
    ...Object.values(CLIMATE_NAMES),
    ...sourceFiles('src/').flatMap((f) => stringsIn(readFileSync(new URL(f, root), 'utf8'))),
  ];
  const missing = new Set();
  for (const t of texts)
    for (const ch of t) if (ch.codePointAt(0) > 0x7f && !font.has(ch.codePointAt(0))) missing.add(ch);
  // 地圖字元（@、•、地形字元等）走 CP437 字元表，不靠介面字型
  for (const ch of [...missing]) if (cp437Index(ch) > 0) missing.delete(ch);
  expect([...missing].join('')).toBe('');
});
