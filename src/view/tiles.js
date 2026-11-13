// 地圖字元表：一張 128×128 的白字透明底 PNG，畫的時候先依顏色染一份，再整格複製
// 直接複製像素，所以 Windows 與 macOS 畫出來一樣

import { cp437Index } from './cp437.js';

const CELL = 8;

// 載入一張圖（字元表 PNG），載好才 resolve
export function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

export function createTileset(image) {
  const tinted = new Map();

  function sheetFor(color) {
    let sheet = tinted.get(color);
    if (!sheet) {
      sheet = document.createElement('canvas');
      sheet.width = image.width;
      sheet.height = image.height;
      const g = sheet.getContext('2d');
      g.drawImage(image, 0, 0);
      g.globalCompositeOperation = 'source-in';
      g.fillStyle = color;
      g.fillRect(0, 0, sheet.width, sheet.height);
      tinted.set(color, sheet);
    }
    return sheet;
  }

  // 在 (px, py) 畫一格，size 是畫面上一格的實體像素（8 的倍數）
  function draw(ctx, ch, px, py, size, color, background) {
    if (background) {
      ctx.fillStyle = background;
      ctx.fillRect(px, py, size, size);
    }
    const index = cp437Index(ch);
    if (index <= 0 || ch === ' ') return;
    const sx = (index % 16) * CELL;
    const sy = Math.floor(index / 16) * CELL;
    ctx.drawImage(sheetFor(color), sx, sy, CELL, CELL, px, py, size, size);
  }

  return { draw };
}
