// 比較頁：同一塊地形，好幾種畫法並排，讓使用者挑。只在開發伺服器開（/compare.html），不進遊戲與打包檔

import tilesUrl from '../../assets/tiles/cp437.png';
import { DATA } from '../data/load.js';
import { createMapView } from '../view/mapview.js';
import { createWorldView } from '../view/worldview.js';
import { createWorld } from '../world/world.js';
import { createVariants } from './variants.js';

const SMALL = { zonesX: 3, zonesY: 3 }; // 3×3 區的小世界（96×96 建一次要 2 秒）

const SEED = 20261112; // 跟遊戲同一個世界
const COLS = 44;
const ROWS = 28;
const TILE = 16;

const world = createWorld(SEED, DATA, SMALL);

// 使用者喜歡的那一版：畫法跟現在的遊戲一樣，只是樹一格一棵、沒有樹幹
const likedData = {
  ...DATA,
  objects: DATA.objects.map((o) => ({ ...o, sizes: [1], trunk: false })),
};
const likedWorld = createWorld(SEED, likedData, SMALL);

// 用遊戲本身的畫法（worldview.js）畫一張；冒險者放到畫面外
function gameDraw(w, data) {
  return (mv, cam, cols, rows) => {
    const view = createWorldView(mv, w, data);
    view.draw({ cols, rows }, cam, { route: null, target: null, examined: null, player: { x: -99, y: -99 } });
  };
}

const variants = [
  { name: 'H 現在的遊戲（多格樹冠、樹幹 Φ）', draw: gameDraw(world, DATA) },
  { name: 'I 你喜歡的那一版（樹一格一棵、沒有樹幹）', draw: gameDraw(likedWorld, likedData) },
  ...createVariants(world, DATA),
];

// 挑幾個地形有變化的地點：高度層種類多、有水、有山、有樹的分數高，彼此不重疊
function interestingSpots(count) {
  const spots = [];
  for (let y = 0; y + ROWS <= world.height; y += 14) {
    for (let x = 0; x + COLS <= world.width; x += 14) {
      const tiers = new Set();
      let water = 0;
      let mountain = 0;
      let trees = 0;
      for (let j = 0; j < ROWS; j += 2) {
        for (let i = 0; i < COLS; i += 2) {
          const c = world.cell(x + i, y + j);
          tiers.add(world.tierAt(x + i, y + j));
          if (c.water) water++;
          if (c.landform.style === 'mountain') mountain++;
          if (c.object) trees++;
        }
      }
      const score = tiers.size * 3 + (water > 5 ? 3 : 0) + (mountain > 5 ? 3 : 0) + (trees > 10 ? 2 : 0);
      spots.push({ x, y, score });
    }
  }
  spots.sort((a, b) => b.score - a.score);
  const picked = [];
  for (const s of spots) {
    if (picked.every((p) => Math.abs(p.x - s.x) >= COLS || Math.abs(p.y - s.y) >= ROWS)) picked.push(s);
    if (picked.length >= count) break;
  }
  return picked;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

const image = await loadImage(tilesUrl);
const spots = interestingSpots(6);
const grid = document.getElementById('grid');
const panels = variants.map((v) => {
  const box = document.createElement('figure');
  const canvas = document.createElement('canvas');
  canvas.width = COLS * TILE;
  canvas.height = ROWS * TILE;
  const caption = document.createElement('figcaption');
  caption.textContent = v.name;
  box.append(caption, canvas);
  grid.append(box);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const mv = createMapView(image, ctx);
  mv.resize({ map: { x: 0, y: 0, w: canvas.width, h: canvas.height }, tile: TILE, dpr: 1 });
  return { v, mv, ctx, canvas };
});

let current = 0;
function render() {
  const s = spots[current];
  const center = world.tierAt(s.x + (COLS >> 1), s.y + (ROWS >> 1)); // 相對亮度以畫面中心那格當冒險者
  for (const p of panels) {
    p.ctx.clearRect(0, 0, p.canvas.width, p.canvas.height);
    p.v.draw(p.mv, { x: s.x, y: s.y }, COLS, ROWS, center);
  }
  document.getElementById('where').textContent =
    `地點 ${current + 1}／${spots.length}：(${s.x}, ${s.y}) 起 ${COLS}×${ROWS} 格`;
}

document.getElementById('prev').onclick = () => {
  current = (current + spots.length - 1) % spots.length;
  render();
};
document.getElementById('next').onclick = () => {
  current = (current + 1) % spots.length;
  render();
};
render();
