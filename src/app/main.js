// 瀏覽器入口：地圖與文字面板都畫在同一張畫布（#screen）
// 回合由 ROT.js 的排程與引擎管：輪到冒險者時才接受花時間的動作。網址加 ?nosave 用記憶體存檔

import fontUrl from '../../assets/fonts/fusion-pixel-12px-proportional-zh_tw.ttf';
import tilesUrl from '../../assets/tiles/cp437.png';
import { browserStore, memoryStore } from '../core/store.js';
import { createTurnLoop } from '../core/turns.js';
import { DATA } from '../data/load.js';
import { COLORS } from '../view/colors.js';
import { loadPixelFont } from '../view/font.js';
import { createMapView } from '../view/mapview.js';
import { createPanels } from '../view/panels.js';
import { cameraOrigin, layout } from '../view/screen.js';
import { loadImage } from '../view/tiles.js';
import { createWorldView } from '../view/worldview.js';
import { logLines } from '../world/describe.js';
import { loadGame, newGame } from '../world/game.js';
import { findPath, stepDirection } from '../world/path.js';
import { describePlace, regionLabel } from '../world/place.js';
import { createKeyboard } from './input.js';
import { createZoom } from './zoom.js';

const VERSION = '0.1.0';
const SAVE_KEY = 'world';
const SEED = 20261112;
const STEP_MS = 70; // 滑鼠點擊後自動走，每一步間隔
const HELP = [
  '方向鍵／WASD 移動，同時按兩鍵斜走；數字鍵盤八方向。',
  '左鍵點地圖走過去，空白鍵停下；右鍵查看，再點一下收起。',
  'H 看完整紀錄。＋／－ 放大縮小地圖。',
];

const params = new URLSearchParams(location.search);
const store = params.has('nosave') ? memoryStore() : browserStore();
const canvas = document.getElementById('screen');
const ctx = canvas.getContext('2d');

const [image, font] = await Promise.all([loadImage(tilesUrl), loadPixelFont(fontUrl, 'FusionPixel12TW')]);
const mapView = createMapView(image, ctx);
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
const world = game.world;
// ?parallax 看多層次視差堆疊，?leftdown 看往左下拉側面與影子，?flat 不畫側面
const MODES = ['flat', 'leftdown', 'parallax'];
const viewMode = MODES.find((m) => params.has(m)) ?? 'perspective';
const worldView = createWorldView(mapView, world, DATA, { mode: viewMode });
const camera = () => cameraOrigin(player().x, player().y, world.width, world.height, screen.cols, screen.rows);

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

const layoutAt = (z) => layout(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1, z);
const zoom = createZoom(store, (z) => layoutAt(z).tile);

function resize() {
  screen = layoutAt(zoom.value);
  canvas.width = screen.width;
  canvas.height = screen.height;
  canvas.style.width = `${screen.width / screen.dpr}px`;
  canvas.style.height = `${screen.height / screen.dpr}px`;
  mapView.resize(screen);
  render();
}

// 要畫的路線：走路中顯示剩下的路，否則顯示滑鼠指著的地方怎麼走
function shownPath() {
  if (walking.length) return { steps: walking, reachable: true };
  if (!hover || historyOpen) return null;
  const steps = findPath(world, player(), hover);
  return { steps, reachable: steps.length > 0 };
}

let frameRequested = false; // 相機平滑緩衝：還沒到位就在下一個畫面再畫一次

function render() {
  const { tile, map } = screen;
  const cam = camera();
  const route = shownPath();
  const target = walking.at(-1) ?? (route ? hover : null);
  const p = player();
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const moving = worldView.draw(screen, cam, { route, target, examined, player: p });
  if (moving && !frameRequested) {
    frameRequested = true;
    requestAnimationFrame(() => {
      frameRequested = false;
      render();
    });
  }

  const where = regionLabel(world, DATA, p.x, p.y);
  panels.status(
    ctx,
    screen,
    `Fantasy Exploration v${VERSION}｜第 ${game.state.time} 回合｜位置 ${p.x}, ${p.y}｜${where}`,
  );
  maxLogScroll = panels.log(ctx, screen, entries(), logScroll);
  if (route && target && !historyOpen) {
    const label = route.reachable ? `${route.steps.length} 步` : '走不到';
    const at = worldView.screenOf(cam, target.x, target.y);
    const px = map.x + at.vx * tile;
    const py = map.y + at.vy * tile;
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

// 畫面上的格子 → 地圖上的格子（疊層時錯開的格子由 worldView 用滑鼠的實際位置換算）
function mapCellAt(e) {
  const v = mapView.cellAt(e);
  return v ? worldView.cellAt(camera(), v.x, v.y, v.fx, v.fy) : null;
}

function describeCell(cell) {
  if (cell.x === player().x && cell.y === player().y) return '你自己';
  return describePlace(world, cell.x, cell.y);
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
  if (zoom.isKey(e)) {
    e.preventDefault();
    if (zoom.press(e)) resize();
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
  const steps = findPath(world, player(), cell);
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
