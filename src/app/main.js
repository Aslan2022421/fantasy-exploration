// 瀏覽器入口：載入字元表與字型，畫地圖與狀態列，處理按鍵與滑鼠
// 網址加 ?nosave 時用記憶體存檔，不碰使用者的存檔

import fontUrl from '../../assets/fonts/fusion-pixel-12px-proportional-zh_tw.ttf';
import tilesUrl from '../../assets/tiles/cp437.png';
import { browserStore, memoryStore } from '../core/store.js';
import { loadPixelFont } from '../view/font.js';
import { cameraOrigin, layout } from '../view/screen.js';
import { createTileset } from '../view/tiles.js';
import { createMap, startPosition, tileAt, WALL } from '../world/map.js';
import { tryMove } from '../world/move.js';
import { findPath, stepDirection } from '../world/path.js';
import { createKeyboard } from './input.js';

const VERSION = '0.1.0';
const SAVE_KEY = 'stage0';
const SEED = 20261112;
const STEP_MS = 70; // 滑鼠點擊後自動走，每一步間隔
const COLORS = {
  background: '#0e2424',
  floor: '#365452',
  wall: '#8a9692',
  player: '#ffffff',
  path: '#e0bc62',
  target: '#4d4220',
  blocked: '#5c2424',
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
let hover = null; // 滑鼠指著的地圖格
let walking = []; // 自動走剩下的路線
let walkTimer = null;
let message = null; // 狀態列第二行的訊息（查看、被擋住）；沒有訊息時顯示操作說明
const HELP = '方向鍵／WASD 移動，同時按兩鍵斜走；數字鍵盤八方向｜左鍵走過去、空白鍵停｜右鍵查看';

function resize() {
  screen = layout(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1);
  canvas.width = screen.width;
  canvas.height = screen.height;
  canvas.style.width = `${screen.width / screen.dpr}px`;
  canvas.style.height = `${screen.height / screen.dpr}px`;
  render();
}

function camera() {
  return cameraOrigin(player.x, player.y, map.width, map.height, screen.cols, screen.rows);
}

// 要畫的路線：走路中顯示剩下的路，否則顯示滑鼠指著的地方怎麼走
function shownPath() {
  if (walking.length) return { steps: walking, reachable: true };
  if (!hover) return null;
  const steps = findPath(map, player, hover);
  return { steps, reachable: steps.length > 0 };
}

function render() {
  const { tile, cols, rows } = screen;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const cam = camera();
  const route = shownPath();
  const onRoute = new Set(route?.steps.map((s) => `${s.x},${s.y}`));
  const target = walking.at(-1) ?? hover;
  for (let vy = 0; vy < rows; vy++) {
    for (let vx = 0; vx < cols; vx++) {
      const x = cam.x + vx;
      const y = cam.y + vy;
      if (x >= map.width || y >= map.height) continue;
      const isWall = tileAt(map, x, y) === WALL;
      const isTarget = target && target.x === x && target.y === y;
      let bg = null;
      if (isTarget) bg = route?.reachable ? COLORS.target : COLORS.blocked;
      const px = vx * tile;
      const py = vy * tile;
      if (onRoute.has(`${x},${y}`) && !isTarget) {
        tiles.draw(ctx, '•', px, py, tile, COLORS.path, bg);
      } else {
        tiles.draw(ctx, isWall ? '#' : '·', px, py, tile, isWall ? COLORS.wall : COLORS.floor, bg);
      }
    }
  }
  tiles.draw(ctx, '@', (player.x - cam.x) * tile, (player.y - cam.y) * tile, tile, COLORS.player);

  const { textScale, lineHeight, statusTop } = screen;
  const pad = textScale;
  // 路線終點旁標出步數（舊專案兩段式走路的第一段，現在滑鼠指著就顯示）
  if (route && target) {
    const label = route.reachable ? `${route.steps.length} 步` : '走不到';
    const w = font.measure(label, textScale);
    let lx = (target.x - cam.x + 1) * tile + pad * 2;
    const ly = (target.y - cam.y) * tile - lineHeight;
    if (lx + w + pad * 4 > screen.cols * tile) lx = (target.x - cam.x) * tile - w - pad * 6;
    ctx.fillStyle = COLORS.background;
    ctx.fillRect(lx - pad * 2, ly, w + pad * 4, lineHeight);
    font.drawText(ctx, label, lx, ly + pad, textScale, route.reachable ? COLORS.path : COLORS.text);
  }
  font.drawText(
    ctx,
    `Fantasy Exploration v${VERSION}｜位置 ${player.x}, ${player.y}`,
    pad * 4,
    statusTop + pad,
    textScale,
    COLORS.text,
  );
  font.drawText(
    ctx,
    message ?? HELP,
    pad * 4,
    statusTop + lineHeight + pad,
    textScale,
    message ? COLORS.text : COLORS.dim,
  );
}

function moveTo(next) {
  if (next.x === player.x && next.y === player.y) return false;
  player = next;
  message = null;
  examined = null;
  store.save(SAVE_KEY, { player });
  return true;
}

function stopWalking() {
  clearInterval(walkTimer);
  walkTimer = null;
  walking = [];
}

function startWalking(steps) {
  stopWalking();
  walking = steps.slice();
  walkTimer = setInterval(() => {
    const step = walking.shift();
    const moved = step && moveTo(tryMove(map, player, stepDirection(player, step)));
    if (step && !moved) message = '有東西擋住了路，停了下來。';
    if (!moved || walking.length === 0) stopWalking();
    render();
  }, STEP_MS);
}

// 滑鼠位置 → 地圖格；不在地圖區域內回傳 null
function cellAt(e) {
  const rect = canvas.getBoundingClientRect();
  const vx = Math.floor(((e.clientX - rect.left) * screen.dpr) / screen.tile);
  const vy = Math.floor(((e.clientY - rect.top) * screen.dpr) / screen.tile);
  if (vx < 0 || vy < 0 || vx >= screen.cols || vy >= screen.rows) return null;
  const cam = camera();
  const x = cam.x + vx;
  const y = cam.y + vy;
  return x < map.width && y < map.height ? { x, y } : null;
}

// 右鍵查看那一格
function describe(cell) {
  if (cell.x === player.x && cell.y === player.y) return '你自己';
  return tileAt(map, cell.x, cell.y) === WALL ? '岩石，過不去' : '空地';
}

const keyboard = createKeyboard((dx, dy) => {
  stopWalking();
  moveTo(tryMove(map, player, stepDirection(player, { x: player.x + dx, y: player.y + dy })));
  render();
});

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' || e.code === 'Escape') {
    e.preventDefault();
    stopWalking();
    render();
    return;
  }
  if (keyboard.keydown(e.code, e.repeat)) e.preventDefault();
});
window.addEventListener('keyup', (e) => keyboard.keyup(e.code));
window.addEventListener('blur', () => keyboard.clear());
// 右鍵查看：再右鍵同一格、或左鍵點一下，就收起查看結果、回到操作說明
let examined = null; // 正在顯示查看結果的那一格
function closeExamine() {
  if (!examined) return false;
  examined = null;
  message = null;
  render();
  return true;
}
canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const cell = cellAt(e);
  if (!cell) return;
  stopWalking();
  if (examined && examined.x === cell.x && examined.y === cell.y) {
    closeExamine();
    return;
  }
  examined = cell;
  message = `查看 (${cell.x}, ${cell.y})：${describe(cell)}`;
  render();
});
canvas.addEventListener('mousemove', (e) => {
  const cell = cellAt(e);
  if (cell?.x === hover?.x && cell?.y === hover?.y) return;
  hover = cell;
  if (!walking.length) render();
});
canvas.addEventListener('mouseleave', () => {
  hover = null;
  if (!walking.length) render();
});
canvas.addEventListener('click', (e) => {
  if (closeExamine()) return; // 查看結果還開著時，這一下只是收起來，不走路
  const cell = cellAt(e);
  if (!cell) return;
  const steps = findPath(map, player, cell);
  if (steps.length) startWalking(steps);
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
  get walking() {
    return walking.length;
  },
  get message() {
    return message;
  },
  version: VERSION,
};
