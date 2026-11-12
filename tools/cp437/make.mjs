// 從 PxPlus IBM BIOS 字型轉出 CP437 字元表：128×128、白字透明底、8px 一格
// 做法：先用 64px 大字描，再每 8×8 取中心點縮回 8px（直接用 8px 描會因反鋸齒變粗）
// 用法：npm run tiles

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { CP437 } from '../../src/view/cp437.js';

const here = dirname(fileURLToPath(import.meta.url));
const fontB64 = readFileSync(join(here, 'PxPlus_IBM_BIOS.ttf')).toString('base64');
const out = join(here, '..', '..', 'assets', 'tiles', 'cp437.png');

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
const result = await page.evaluate(
  async ({ fontB64, CP437 }) => {
    const face = new FontFace(
      'PxBios',
      Uint8Array.from(atob(fontB64), (c) => c.charCodeAt(0)),
    );
    await face.load();
    document.fonts.add(face);
    const BIG = 64;
    const hi = document.createElement('canvas');
    hi.width = hi.height = 16 * BIG;
    const h = hi.getContext('2d', { willReadFrequently: true });
    h.font = `${BIG}px "PxBios"`;
    h.fillStyle = '#fff';
    h.textBaseline = 'alphabetic';
    const asc = Math.round(h.measureText('█').actualBoundingBoxAscent);
    CP437.forEach((c, i) => {
      if (c !== ' ') h.fillText(c, (i % 16) * BIG, Math.floor(i / 16) * BIG + asc);
    });
    const hd = h.getImageData(0, 0, hi.width, hi.height).data;
    const sheet = document.createElement('canvas');
    sheet.width = sheet.height = 128;
    const g = sheet.getContext('2d');
    const img = g.createImageData(128, 128);
    let partial = 0;
    for (let y = 0; y < 128; y++) {
      for (let x = 0; x < 128; x++) {
        const a = hd[((y * 8 + 4) * hi.width + (x * 8 + 4)) * 4 + 3];
        if (a > 0 && a < 255) partial++;
        const p = (y * 128 + x) * 4;
        img.data[p] = img.data[p + 1] = img.data[p + 2] = 255;
        img.data[p + 3] = a >= 128 ? 255 : 0;
      }
    }
    g.putImageData(img, 0, 0);
    return { png: sheet.toDataURL('image/png'), partial };
  },
  { fontB64, CP437 },
);
await browser.close();
writeFileSync(out, Buffer.from(result.png.split(',')[1], 'base64'));
console.log(`寫出 ${out}（取樣點半透明 ${result.partial} 個，0 表示對齊）`);
