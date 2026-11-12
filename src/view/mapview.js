// 地圖區：ROT.js 的 Display（字元表模式）。
// Display 一律照圖片原本的格子大小畫，所以載入時先把 8px 的字元表放大成整數倍再交給它；
// 上色交給它的 tileColorize；滑鼠換格子用它的 eventToPosition；它只重畫有變動的格子

import { Display } from 'rot-js';
import { COLORS } from './colors.js';
import { CP437 } from './cp437.js';

const CELL = 8;

function scaledSheet(image, cell) {
  const k = cell / CELL;
  const sheet = document.createElement('canvas');
  sheet.width = image.width * k;
  sheet.height = image.height * k;
  const g = sheet.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.drawImage(image, 0, 0, sheet.width, sheet.height);
  return sheet;
}

function tileMapFor(cell) {
  const map = {};
  CP437.forEach((ch, i) => {
    if (!(ch in map)) map[ch] = [(i % 16) * cell, Math.floor(i / 16) * cell];
  });
  return map;
}

export function createMapView(image) {
  let cell = 0;
  const display = new Display({ layout: 'tile', tileColorize: true, bg: COLORS.bg, width: 1, height: 1 });
  const canvas = display.getContainer();

  return {
    display,
    canvas,
    // 換格子大小或格數（視窗大小、縮放比例改變時）
    resize(tile, cols, rows) {
      if (tile !== cell) {
        cell = tile;
        display.setOptions({
          tileSet: scaledSheet(image, tile),
          tileMap: tileMapFor(tile),
          tileWidth: tile,
          tileHeight: tile,
        });
      }
      display.setOptions({ width: cols, height: rows });
    },
    draw(x, y, ch, fg, bg) {
      display.draw(x, y, ch, fg, bg);
    },
    // 滑鼠 → 畫面上第幾格；不在地圖上回傳 null
    cellAt(e) {
      const [x, y] = display.eventToPosition(e);
      return x < 0 ? null : { x, y };
    },
  };
}
