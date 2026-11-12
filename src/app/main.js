// 瀏覽器入口：地圖用 ROT.js Display（#stage 裡的 canvas），文字面板畫在上面那張 #overlay
// 回合由 ROT.js 的排程與引擎管：輪到冒險者時才接受花時間的動作。網址加 ?nosave 用記憶體存檔

import fontUrl from '../../assets/fonts/fusion-pixel-12px-proportional-zh_tw.ttf';
import tilesUrl from '../../assets/tiles/cp437.png';
import { browserStore, memoryStore } from '../core/store.js';
import { createTurnLoop } from '../core/turns.js';
import { COLORS } from '../view/colors.js';
import { loadPixelFont } from '../view/font.js';
import { createMapView } from '../view/mapview.js';
import { createPanels } from '../view/panels.js';
import { cameraOrigin, layout } from '../view/screen.js';
import { logLines } from '../world/describe.js';
import { loadGame, newGame } from '../world/game.js';
import { tileAt, WALL } from '../world/map.js';
import { findPath, stepDirection } from '../world/path.js';
import { createKeyboard } from './input.js';

const VERSION = '0.1.0';
const SAVE_KEY = 'world';
const SEED = 20261112;
const STEP_MS = 70; // 滑鼠點擊後自動走，每一步間隔
const HELP = [
  '方向鍵／WASD 移動，同時按兩鍵斜走；數字鍵盤八方向。',
  '左鍵點地圖走過去，空白鍵停下；右鍵查看，再點一下收起。',
  'H 看完整紀錄。',
];

const params = new URLSearchParams(location.search);
const store = params.has('nosave') ? memoryStore() : browserStore();
const overlay = document.getElementById('overlay');
const ctx = overlay.getContext('2d');

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

const [image, font] = await Promise.all([loadImage(tilesUrl), loadPixelFont(fontUrl, 'FusionPixel12TW')]);
const mapView = createMapView(image);
document.getElementById('stage').appendChild(mapView.canvas);
const panels = createPanels(font);

store.remove('stage0'); // 階段 0 的舊存檔格式不同，不再讀
const game = loadGame(store.load(SAVE_KEY, null)) ?? newGame(SEED);
const turns = createTurnLoop();
turns.start();

let screen;
let hover = null; // 滑鼠指著的地圖格
let walking = []; // 自動走剩下的路線
let walkPlan = null; // 這次自動走是哪一筆「決定」引起的
let walkTimer = null;
let examined = null; // 右鍵查看中的那一格
let historyOpen = false;
let logScroll = 0;
let historyScroll = 0;
let maxLogScroll = 0;
let maxHistoryScroll = 0;

const player = () => game.state.player;
const save = () => store.save(SAVE_KEY, game.serialize());
const camera = () => cameraOrigin(player().x, player().y, game.map.width, game.map.height, screen.cols, screen.rows);

// 花時間的動作：輪到冒險者才做，做完把回合交回排程
function act(fn) {
  if (!turns.playersTurn) return null;
  const rec = fn();
  if (rec) {
    turns.endTurn(rec.data.duration ?? 1);
    examined = null;
    logScroll = 0;
    save();
  }
  return rec;
}

function note(fn) {
  fn();
  logScroll = 0;
  save();
}

function entries() {
  return [
    ...HELP.map((text) => ({ time: null, text, color: COLORS.dim })),
    ...logLines(game.log.all()).map((l) => ({ time: l.time, text: l.text })),
  ];
}

function resize() {
  screen = layout(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1);
  overlay.width = screen.width;
  overlay.height = screen.height;
  overlay.style.width = `${screen.width / screen.dpr}px`;
  overlay.style.height = `${screen.height / screen.dpr}px`;
  mapView.resize(screen.tile, screen.cols, screen.rows);
  const c = mapView.canvas.style;
  c.left = '0px';
  c.top = `${screen.map.y / screen.dpr}px`;
  c.width = `${screen.map.w / screen.dpr}px`;
  c.height = `${screen.map.h / screen.dpr}px`;
  render();
}

// 要畫的路線：走路中顯示剩下的路，否則顯示滑鼠指著的地方怎麼走
function shownPath() {
  if (walking.length) return { steps: walking, reachable: true };
  if (!hover || historyOpen) return null;
  const steps = findPath(game.map, player(), hover);
  return { steps, reachable: steps.length > 0 };
}

function render() {
  const { cols, rows, tile, map } = screen;
  const cam = camera();
  const route = shownPath();
  const onRoute = new Set(route?.steps.map((s) => `${s.x},${s.y}`));
  const target = walking.at(-1) ?? (route ? hover : null);
  for (let vy = 0; vy < rows; vy++) {
    for (let vx = 0; vx < cols; vx++) {
      const x = cam.x + vx;
      const y = cam.y + vy;
      if (x >= game.map.width || y >= game.map.height) {
        mapView.draw(vx, vy, ' ', COLORS.bg, COLORS.void);
        continue;
      }
      const isWall = tileAt(game.map, x, y) === WALL;
      let bg = COLORS.bg;
      if (examined?.x === x && examined?.y === y) bg = COLORS.examined;
      if (target?.x === x && target?.y === y) bg = route?.reachable ? COLORS.target : COLORS.blocked;
      if (onRoute.has(`${x},${y}`) && !(target?.x === x && target?.y === y)) mapView.draw(vx, vy, '•', COLORS.path, bg);
      else mapView.draw(vx, vy, isWall ? '#' : '·', isWall ? COLORS.rock : COLORS.floor, bg);
    }
  }
  const p = player();
  mapView.draw(p.x - cam.x, p.y - cam.y, '@', COLORS.player, COLORS.bg);

  ctx.clearRect(0, 0, overlay.width, overlay.height);
  panels.status(ctx, screen, `Fantasy Exploration v${VERSION}｜第 ${game.state.time} 回合｜位置 ${p.x}, ${p.y}`);
  maxLogScroll = panels.log(ctx, screen, entries(), logScroll);
  if (route && target && !historyOpen) {
    const label = route.reachable ? `${route.steps.length} 步` : '走不到';
    const px = map.x + (target.x - cam.x) * tile;
    const py = map.y + (target.y - cam.y) * tile;
    panels.routeLabel(ctx, screen, px, py, label, route.reachable ? COLORS.path : COLORS.text);
  }
  if (historyOpen) maxHistoryScroll = panels.history(ctx, screen, entries(), historyScroll);
}

function stopWalking() {
  clearInterval(walkTimer);
  walkTimer = null;
  walking = [];
  walkPlan = null;
}

function startWalking(steps, to) {
  stopWalking();
  note(() => {
    walkPlan = game.plan(to, steps.length).id;
  });
  walking = steps.slice();
  walkTimer = setInterval(() => {
    if (!turns.playersTurn) return; // 還沒輪到，下一拍再走
    const step = walking.shift();
    const rec = step && act(() => game.move(stepDirection(player(), step), walkPlan));
    if (step && !rec) note(() => game.blocked(walkPlan));
    if (!rec || walking.length === 0) stopWalking();
    render();
  }, STEP_MS);
}

function closeExamine() {
  if (!examined) return false;
  examined = null;
  render();
  return true;
}

// 畫面上的格子 → 地圖上的格子
function mapCellAt(e) {
  const v = mapView.cellAt(e);
  if (!v) return null;
  const cam = camera();
  const cell = { x: cam.x + v.x, y: cam.y + v.y };
  return cell.x < game.map.width && cell.y < game.map.height ? cell : null;
}

function describeCell(cell) {
  if (cell.x === player().x && cell.y === player().y) return '你自己';
  return tileAt(game.map, cell.x, cell.y) === WALL ? '岩石，過不去' : '空地';
}

const keyboard = createKeyboard((dx, dy) => {
  if (historyOpen) return;
  stopWalking();
  act(() => game.move(stepDirection(player(), { x: player().x + dx, y: player().y + dy })));
  render();
});

function scrollHistory(delta) {
  historyScroll = Math.max(0, Math.min(maxHistoryScroll, historyScroll + delta));
  render();
}

window.addEventListener('keydown', (e) => {
  if (historyOpen) {
    const scrollKeys = { ArrowUp: -1, ArrowDown: 1, PageUp: -10, PageDown: 10 };
    if (e.code === 'Escape' || e.code === 'KeyH') historyOpen = false;
    else if (scrollKeys[e.code]) return scrollHistory(scrollKeys[e.code]);
    e.preventDefault();
    render();
    return;
  }
  if (e.code === 'KeyH') {
    stopWalking();
    historyOpen = true;
    historyScroll = Number.MAX_SAFE_INTEGER; // 打開時捲到最新
    render();
    historyScroll = maxHistoryScroll;
    render();
    return;
  }
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
window.addEventListener(
  'wheel',
  (e) => {
    const lines = Math.sign(e.deltaY) * 3;
    if (historyOpen) return scrollHistory(lines);
    if (e.clientX * screen.dpr >= screen.side.x) {
      logScroll = Math.max(0, Math.min(maxLogScroll, logScroll - lines));
      render();
    }
  },
  { passive: true },
);

mapView.canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const cell = mapCellAt(e);
  if (!cell || historyOpen) return;
  stopWalking();
  if (examined?.x === cell.x && examined?.y === cell.y) return closeExamine();
  examined = cell;
  note(() => game.examine(cell, describeCell(cell)));
  render();
});
mapView.canvas.addEventListener('mousemove', (e) => {
  const cell = mapCellAt(e);
  if (cell?.x === hover?.x && cell?.y === hover?.y) return;
  hover = cell;
  if (!walking.length) render();
});
mapView.canvas.addEventListener('mouseleave', () => {
  hover = null;
  if (!walking.length) render();
});
mapView.canvas.addEventListener('click', (e) => {
  if (historyOpen || closeExamine()) return; // 查看還開著時，這一下只是收起來
  const cell = mapCellAt(e);
  if (!cell) return;
  const steps = findPath(game.map, player(), cell);
  if (steps.length) startWalking(steps, cell);
});
window.addEventListener('resize', resize);
resize();

// 給測試與除錯看的狀態（Playwright 讀這裡）
window.__fe = {
  game,
  mapView,
  get player() {
    return player();
  },
  get screen() {
    return screen;
  },
  get walking() {
    return walking.length;
  },
  get historyOpen() {
    return historyOpen;
  },
  version: VERSION,
};
