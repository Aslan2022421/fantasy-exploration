// 瀏覽器入口：載入字元表與字型，畫地圖與狀態列，處理按鍵
// 網址加 ?nosave 時用記憶體存檔，不碰使用者的存檔

import fontUrl from '../../assets/fonts/fusion-pixel-12px-proportional-zh_tw.ttf';
import tilesUrl from '../../assets/tiles/cp437.png';
import { browserStore, memoryStore } from '../core/store.js';
import { loadPixelFont } from '../view/font.js';
import { cameraOrigin, layout } from '../view/screen.js';
import { createTileset } from '../view/tiles.js';
import { createMap, startPosition, tileAt, WALL } from '../world/map.js';
import { tryMove } from '../world/move.js';
import { directionFor } from './input.js';

const VERSION = '0.1.0';
const SAVE_KEY = 'stage0';
const SEED = 20261112;
const COLORS = {
  background: '#0e2424',
  floor: '#365452',
  wall: '#8a9692',
  player: '#ffffff',
  text: '#cfdad7',
  dim: '#7f9592',
};

const params = new URLSearchParams(location.search);
const store = params.has('nosave') ? memoryStore() : browserStore();
const canvas = document.getElementById('screen');
const ctx = canvas.getContext('2d');

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

const [image, font] = await Promise.all([loadImage(tilesUrl), loadPixelFont(fontUrl, 'FusionPixel12TW')]);
const tiles = createTileset(image);
const map = createMap(80, 50, SEED);
const saved = store.load(SAVE_KEY, null);
let player = saved?.player ?? startPosition(map);
let screen;

function resize() {
  screen = layout(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1);
  canvas.width = screen.width;
  canvas.height = screen.height;
  canvas.style.width = `${screen.width / screen.dpr}px`;
  canvas.style.height = `${screen.height / screen.dpr}px`;
  ctx.imageSmoothingEnabled = false;
  render();
}

function render() {
  const { tile, cols, rows } = screen;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const cam = cameraOrigin(player.x, player.y, map.width, map.height, cols, rows);
  for (let vy = 0; vy < rows; vy++) {
    for (let vx = 0; vx < cols; vx++) {
      const x = cam.x + vx;
      const y = cam.y + vy;
      if (x >= map.width || y >= map.height) continue;
      const t = tileAt(map, x, y);
      const isWall = t === WALL;
      tiles.draw(ctx, isWall ? '#' : '·', vx * tile, vy * tile, tile, isWall ? COLORS.wall : COLORS.floor);
    }
  }
  tiles.draw(ctx, '@', (player.x - cam.x) * tile, (player.y - cam.y) * tile, tile, COLORS.player);

  const { textScale, lineHeight, statusTop } = screen;
  const pad = textScale;
  font.drawText(
    ctx,
    `幻想探索 v${VERSION}｜位置 ${player.x}, ${player.y}`,
    pad * 4,
    statusTop + pad,
    textScale,
    COLORS.text,
  );
  font.drawText(ctx, '方向鍵四方向、數字鍵盤八方向移動', pad * 4, statusTop + lineHeight + pad, textScale, COLORS.dim);
}

window.addEventListener('keydown', (e) => {
  const dir = directionFor(e.code);
  if (!dir) return;
  e.preventDefault();
  player = tryMove(map, player, dir);
  store.save(SAVE_KEY, { player });
  render();
});
window.addEventListener('resize', resize);
resize();

// 給測試與除錯看的狀態（Playwright 讀這裡）
window.__fe = {
  get player() {
    return player;
  },
  get screen() {
    return screen;
  },
  version: VERSION,
};
