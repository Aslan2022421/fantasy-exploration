// 瀏覽器入口：地圖與文字面板都畫在同一張畫布（#screen）
// 回合由 ROT.js 的排程與引擎管：輪到冒險者時才接受花時間的動作（actions.js）。網址加 ?nosave 用記憶體存檔

import fontUrl from '../../assets/fonts/fusion-pixel-12px-proportional-zh_tw.ttf';
import tilesUrl from '../../assets/tiles/cp437.png';
import { browserStore, memoryStore } from '../core/store.js';
import { createTurnLoop } from '../core/turns.js';
import { DATA } from '../data/load.js';
import { COLORS } from '../view/colors.js';
import { loadPixelFont } from '../view/font.js';
import { createMapView } from '../view/mapview.js';
import { createPanels } from '../view/panels.js';
import { cssSize, gridLabel, layout } from '../view/screen.js';
import { loadImage } from '../view/tiles.js';
import { createWorldMap } from '../view/worldmap.js';
import { createWorldView } from '../view/worldview.js';
import { logLines } from '../world/describe.js';
import { loadGame, newGame } from '../world/game.js';
import { describePlace, regionLabel } from '../world/place.js';
import { clockOf, dayOf } from '../world/rules.js';
import { talkLines } from '../world/talk.js';
import { createActions } from './actions.js';
import { runCreation } from './creation.js';
import { createGameWindows } from './game-windows.js';
import { createKeyboard } from './input.js';
import { showLoading } from './loading.js';
import { bindMapMouse, drawMapLabels } from './mouse.js';
import { createZoom } from './zoom.js';

const VERSION = '0.1.3';
const SAVE_KEY = 'world';
const SEED = 20261112;
const HELP = [
  '方向鍵／WASD 移動，同時按兩鍵斜走；數字鍵盤八方向。',
  '滑鼠指著地圖看是什麼；左鍵走過去；右鍵查看並選定目標，再點一下收起；空白鍵沿路線出發，走路中再按停下。',
  'Q 對目標動手：樹是伐木，矮叢、草本是採集，生物是攻擊，村民是說話；沒貼著會先走過去。撞上樹幹或生物會選定它，撞上村民是說話。',
  '每個動作（走一格、攻擊一次）花的時間看身高，生物看體型；你每做一個動作，生物照時間跟著動。R 休息 1 小時（每天一次）。',
  'C 角色，B 裝備與背包，M 世界地圖，H 看完整紀錄，Esc 選單（匯出試玩紀錄、重新建角）。＋／－ 放大縮小地圖。',
];

const params = new URLSearchParams(location.search);
const store = params.has('nosave') ? memoryStore() : browserStore();
// 測試用：網址加 ?class=rogue&race=dwarf 換預設角色（只在開新遊戲時有用）
const heroOptions = { race: params.get('race') ?? undefined, cls: params.get('class') ?? undefined };
const canvas = document.getElementById('screen');
const ctx = canvas.getContext('2d');

const [image, font] = await Promise.all([loadImage(tilesUrl), loadPixelFont(fontUrl, 'FusionPixel12TW')]);
const mapView = createMapView(image, ctx);
const panels = createPanels(font);

await showLoading(canvas, ctx, panels, '生成世界中');
const game = loadGame(store.load(SAVE_KEY, null)) ?? (await startNewGame());

// 開新遊戲：先建角（網址有 ?class= 或 ?race= 時跳過，用預設選擇），選完才生成世界
async function startNewGame() {
  if (params.has('class') || params.has('race')) return newGame(SEED, heroOptions);
  const choices = await runCreation({ canvas, ctx, panels, data: DATA });
  await showLoading(canvas, ctx, panels, '生成世界中');
  return newGame(SEED, { choices });
}

const turns = createTurnLoop();
turns.start();

let screen;
let hover = null; // 滑鼠指著的地圖格
let logScroll = 0;
let maxLogScroll = 0;

const player = () => game.state.player;
const world = game.world; // 疊上採過的格子的世界
const worldView = createWorldView(mapView, world, DATA);
const camera = () => worldView.focus(screen, player());
const worldMap = createWorldMap(world, DATA);
const windows = createGameWindows({
  panels,
  game,
  data: DATA,
  worldMap,
  actions: () => actions,
  entries,
  version: VERSION,
  // 清掉存檔重新載入：載入時沒有存檔就會進建角
  restart() {
    store.remove(SAVE_KEY);
    location.reload();
  },
});
const actions = createActions({
  game,
  turns,
  worldView,
  describe: describeCell,
  persist() {
    logScroll = 0;
    store.save(SAVE_KEY, game.serialize());
  },
  redraw: () => render(),
  talk: (npc) => npc && windows.talk(talkLines(world, DATA, npc)),
});

function entries() {
  return [
    ...HELP.map((text) => ({ time: null, text, color: COLORS.dim })),
    // 生物的回合播放中，訊息只顯示到播到的那一筆
    ...logLines(game.log.all().slice(0, actions.logUpTo ?? undefined)).map((l) => ({
      time: clockOf(l.time),
      text: l.text,
    })),
  ];
}

const layoutAt = (z) => layout(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1, z);
const zoom = createZoom(store, (z) => layoutAt(z).tile);

function resize() {
  screen = layoutAt(zoom.value);
  canvas.width = screen.width;
  canvas.height = screen.height;
  const css = cssSize(screen, window.innerWidth, window.innerHeight);
  canvas.style.width = `${css.w}px`;
  canvas.style.height = `${css.h}px`;
  mapView.resize(screen);
  render();
}

let frameRequested = false; // 相機還沒到位就在下一個畫面再畫一次

function render() {
  const cam = camera();
  const examined = actions.examined;
  const route = windows.open ? null : actions.shownPath();
  const target = actions.walking.at(-1) ?? (route ? examined : null);
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
  const s = game.state;
  const h = game.hero;
  const fight = s.combat ? '｜戰鬥中' : '';
  panels.status(
    ctx,
    screen,
    `Fantasy Exploration v${VERSION}｜第 ${dayOf(s.time) + 1} 天 ${clockOf(s.time)}｜生命 ${s.hp}/${h.hpMax}${fight}｜位置 ${p.x}, ${p.y}｜${where}｜${gridLabel(screen)}`,
  );
  maxLogScroll = panels.log(ctx, screen, entries(), logScroll);
  if (!windows.open) {
    const tip = hover && world.inside(hover.x, hover.y) ? { cell: hover, text: describeCell(hover) } : null;
    drawMapLabels({ ctx, screen, panels, worldView, cam, route, target, tip });
  }
  windows.draw(ctx, screen);
}

// 滑鼠 → 世界格：疊層錯開了，要用滑鼠的實際位置換算
function mapCellAt(e) {
  const v = mapView.cellAt(e);
  return v ? worldView.cellAt(camera(), v.x, v.y, v.fx, v.fy) : null;
}

function describeCell(cell) {
  if (cell.x === player().x && cell.y === player().y) return '你自己';
  return describePlace(world, cell.x, cell.y);
}

const keyboard = createKeyboard((dx, dy) => {
  if (windows.open) return;
  actions.step(dx, dy);
  render();
});

window.addEventListener('keydown', (e) => {
  // 生物的回合還在播放：先不接受任何鍵（一兩秒內播完）
  if (actions.busy) {
    e.preventDefault();
    return;
  }
  // Esc：自動走路中先停下；沒開視窗時打開選單
  if (e.code === 'Escape' && !windows.open && actions.walking.length) {
    e.preventDefault();
    actions.stop();
    render();
    return;
  }
  if (e.code === 'Escape' && !windows.open) windows.resetMenu();
  if (windows.key(e.code)) {
    e.preventDefault();
    actions.stop();
    render();
    return;
  }
  if (zoom.isKey(e)) {
    e.preventDefault();
    if (zoom.press(e)) resize();
    return;
  }
  if (e.code === 'KeyQ' || e.code === 'Space' || e.code === 'KeyR') {
    e.preventDefault();
    // 空白鍵：走路中停下；選定了目標、畫出路線時出發
    if (e.code === 'KeyQ') actions.actOnTarget();
    else if (e.code === 'KeyR') {
      if (!e.repeat && !windows.open) actions.rest();
    } else if (actions.walking.length) actions.stop();
    else if (!windows.open && !e.repeat) actions.startRoute();
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
    if (windows.open) {
      windows.scroll(lines);
      return render();
    }
    const rect = canvas.getBoundingClientRect(); // 畫布置中、可能被縮小，用實際位置與大小換算
    if ((e.clientX - rect.left) * (canvas.width / rect.width) >= screen.side.x) {
      logScroll = Math.max(0, Math.min(maxLogScroll, logScroll - lines));
      render();
    }
  },
  { passive: true },
);

// 大視窗開著時，滑鼠點的是視窗（B 頁選裝備、C 頁點 +）
canvas.addEventListener('click', (e) => {
  if (!windows.open || actions.busy) return;
  const rect = canvas.getBoundingClientRect();
  const k = canvas.width / rect.width;
  windows.click((e.clientX - rect.left) * k, (e.clientY - rect.top) * k, e.detail >= 2);
  render();
});

bindMapMouse(mapView.canvas, {
  cellAt: mapCellAt,
  hover(cell) {
    if (cell?.x === hover?.x && cell?.y === hover?.y) return;
    hover = cell;
    render();
  },
  leave() {
    hover = null;
    render();
  },
  // 右鍵：查看那一格兼選定成目標（訊息欄寫結果、地圖畫路線），再按同一格收起
  look(cell) {
    if (windows.open || actions.busy) return;
    actions.stop();
    actions.look(cell);
    render();
  },
  // 左鍵：直接走過去，查看開著也順便收起
  go(cell) {
    if (windows.open || actions.busy) return;
    actions.go(cell);
    render();
  },
});
window.addEventListener('resize', resize);
resize();

// 給測試與除錯看的狀態（Playwright 讀這裡）
window.__fe = {
  game,
  mapView,
  actions,
  get player() {
    return player();
  },
  get screen() {
    return screen;
  },
  get walking() {
    return actions.walking.length;
  },
  get window() {
    return windows.open;
  },
  version: VERSION,
};
