// 整個世界的總覽（M 再按 Tab）：羊皮紙地圖的畫法（使用者給的示意圖：奇幻世界的地圖集）。
// - 陸地是米色平塗，海是灰青色；海岸線照地理粗格的高度雙線性內插、取水線，畫成平滑的深褐描邊，
//   海這一側沿海岸再描兩圈淡淡的水紋線
// - 河：匯流到 RIVER_MIN 條源頭以上的河，從源頭沿著往下游的方向畫線到海，越下游越粗
// - 山地：在格點上取樣（每點錯開一點），山地夠高的地方畫一個小山峰符號，越高越大，由北往南畫、南邊的蓋住北邊的
// - 城鎮：圓圈加名字（村莊不標）；冒險者畫紅點；外面一圈雙線框，左下角一個羅盤
// 底圖照大小快取（96×96 區的世界第一次約 1 秒，城鎮名字要生出那一區），標記每次重畫

import { Color } from 'rot-js';
import { LAND } from '../world/landform.js';
import { hash01 } from '../world/noise.js';

export const ATLAS = {
  paper: '#ebdfc1', // 陸地
  shore: '#e0d1ab', // 陸地貼著海岸的一圈，略深
  sea: '#a8bab3',
  ripple: '#8ea69e', // 海岸外的水紋線
  coast: '#4a3a28', // 海岸線
  river: '#5f7f8a',
  ink: '#4e3e2a', // 山的線條、框、字
  shade: '#c9b48c', // 山背光那一面
  town: '#a8432f',
  player: '#c8302a',
  frame: '#3a2c1e',
};
export const RIVER_MIN = 4; // 匯流到幾條源頭以上才畫
const MOUNT = { gap: 0.02, full: 0.25 }; // 高出山地門檻 gap 才畫符號，再高 full 時最大

const rgb = (hex) => Color.fromString(hex);
const clamp01 = (v) => Math.max(0, Math.min(1, v));

// 地理粗格的高度，雙線性內插：(gx, gy) 是粗格座標（可以是小數，粗格中心在 .5）
export function elevAt(geo, gx, gy) {
  const x = Math.max(0, Math.min(geo.W - 1.001, gx - 0.5));
  const y = Math.max(0, Math.min(geo.H - 1.001, gy - 0.5));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const e = (i, j) => geo.elev[(y0 + j) * geo.W + x0 + i];
  return (e(0, 0) * (1 - fx) + e(1, 0) * fx) * (1 - fy) + (e(0, 1) * (1 - fx) + e(1, 1) * fx) * fy;
}

// 太小的內陸水塘併進陸地：不碰地圖邊、面積不到 POND 比例的水，畫出來只是滿地描了邊的小點
const POND = 1 / 8000;
function dropPonds(land, size) {
  const seen = new Uint8Array(size * size);
  const limit = Math.max(30, size * size * POND);
  for (let s = 0; s < size * size; s++) {
    if (land[s] || seen[s]) continue;
    const cells = [s];
    seen[s] = 1;
    let edge = false;
    for (let h = 0; h < cells.length; h++) {
      const i = cells[h];
      const x = i % size;
      const y = (i - x) / size;
      if (x === 0 || y === 0 || x === size - 1 || y === size - 1) edge = true;
      for (const j of [i - 1, i + 1, i - size, i + size]) {
        if (j < 0 || j >= size * size || seen[j] || land[j]) continue;
        if ((j === i - 1 && x === 0) || (j === i + 1 && x === size - 1)) continue;
        seen[j] = 1;
        cells.push(j);
      }
    }
    if (!edge && cells.length < limit) for (const i of cells) land[i] = 1;
  }
}

// size×size 的陸地遮罩（1 是陸地）與離海岸的距離（陸地、海兩邊各自量，像素）
export function landMask(geo, size) {
  const land = new Uint8Array(size * size);
  for (let py = 0; py < size; py++)
    for (let px = 0; px < size; px++)
      land[py * size + px] =
        elevAt(geo, ((px + 0.5) * geo.W) / size, ((py + 0.5) * geo.H) / size) >= LAND.water ? 1 : 0;
  dropPonds(land, size);
  // 兩趟倒角距離：到另一種（陸地到海、海到陸地）的距離
  const dist = new Float32Array(size * size).fill(1e9);
  for (let i = 0; i < size * size; i++) {
    const x = i % size;
    const y = (i - x) / size;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < size && ny < size && land[ny * size + nx] !== land[i]) dist[i] = 0;
    }
  }
  const pass = (from, to, step, nbs) => {
    for (let i = from; i !== to; i += step) {
      const x = i % size;
      const y = (i - x) / size;
      for (const [dx, dy, c] of nbs) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        const j = ny * size + nx;
        if (land[j] === land[i] && dist[j] + c < dist[i]) dist[i] = dist[j] + c;
      }
    }
  };
  pass(0, size * size, 1, [
    [-1, 0, 1],
    [0, -1, 1],
    [-1, -1, Math.SQRT2],
    [1, -1, Math.SQRT2],
  ]);
  pass(size * size - 1, -1, -1, [
    [1, 0, 1],
    [0, 1, 1],
    [1, 1, Math.SQRT2],
    [-1, 1, Math.SQRT2],
  ]);
  return { land, dist };
}

// 底圖：陸地、海、海岸線、水紋、河、山
function drawBase(world, size) {
  const geo = world.geography;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d');
  const { land, dist } = landMask(geo, size);
  const img = g.createImageData(size, size);
  const C = Object.fromEntries(Object.entries(ATLAS).map(([k, v]) => [k, rgb(v)]));
  const line = Math.max(1, size / 700); // 線的粗細跟著地圖大小
  for (let i = 0; i < size * size; i++) {
    const d = dist[i];
    let c;
    if (land[i]) c = d < line * 1.2 ? C.coast : d < line * 5 ? C.shore : C.paper;
    else if (Math.abs(d - line * 5) < line * 0.6 || Math.abs(d - line * 11) < line * 0.5) c = C.ripple;
    else c = C.sea;
    img.data.set([c[0], c[1], c[2], 255], i * 4);
  }
  g.putImageData(img, 0, 0);

  // 河：每段從粗格中心畫到下游那格的中心
  const s = size / geo.W;
  g.strokeStyle = ATLAS.river;
  g.lineCap = 'round';
  for (let i = 0; i < geo.W * geo.H; i++) {
    const f = geo.flow[i];
    const d = geo.down[i];
    if (f < RIVER_MIN || d < 0 || geo.elev[i] < LAND.water) continue;
    g.lineWidth = Math.min(2.6, 0.5 + 0.35 * Math.log2(f)) * line;
    g.beginPath();
    g.moveTo(((i % geo.W) + 0.5) * s, (Math.floor(i / geo.W) + 0.5) * s);
    g.lineTo(((d % geo.W) + 0.5) * s, (Math.floor(d / geo.W) + 0.5) * s);
    g.stroke();
  }

  // 山：格點取樣，由北往南畫；每個符號先塗紙色蓋住後面的，再畫背光面與輪廓
  const gap = Math.max(8, size / 80);
  for (let y = gap / 2; y < size; y += gap * 0.8)
    for (let x = gap / 2; x < size; x += gap) {
      const jx = x + (hash01(world.seed, x | 0, y | 0, 7701) - 0.5) * gap * 0.6;
      const jy = y + (hash01(world.seed, x | 0, y | 0, 7702) - 0.5) * gap * 0.4;
      const e = elevAt(geo, (jx * geo.W) / size, (jy * geo.H) / size);
      const k = (e - LAND.mountain - MOUNT.gap) / MOUNT.full;
      if (k < 0) continue;
      const h = gap * (0.7 + 0.8 * clamp01(k));
      const w = h * 1.3;
      g.fillStyle = ATLAS.paper;
      g.beginPath();
      g.moveTo(jx - w / 2, jy);
      g.lineTo(jx, jy - h);
      g.lineTo(jx + w / 2, jy);
      g.closePath();
      g.fill();
      g.fillStyle = ATLAS.shade;
      g.beginPath();
      g.moveTo(jx, jy - h);
      g.lineTo(jx + w / 2, jy);
      g.lineTo(jx + w * 0.08, jy);
      g.closePath();
      g.fill();
      g.strokeStyle = ATLAS.ink;
      g.lineWidth = line;
      g.beginPath();
      g.moveTo(jx - w / 2, jy);
      g.lineTo(jx, jy - h);
      g.lineTo(jx + w / 2, jy);
      g.stroke();
    }
  return canvas;
}

// 羅盤：八角星，北邊那角塗滿，上面寫「北」
function compass(ctx, panels, screen, x, y, r) {
  ctx.strokeStyle = ATLAS.ink;
  ctx.fillStyle = ATLAS.ink;
  ctx.lineWidth = 1;
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4 - Math.PI / 2;
    const len = k % 2 ? r * 0.55 : r;
    const side = (a2) => [x + Math.cos(a2) * r * 0.18, y + Math.sin(a2) * r * 0.18];
    ctx.beginPath();
    ctx.moveTo(...side(a - Math.PI / 2));
    ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    ctx.lineTo(...side(a + Math.PI / 2));
    ctx.closePath();
    if (k === 0) ctx.fill();
    else ctx.stroke();
  }
  panels.text(ctx, screen, '北', x - panels.measure('北', screen) / 2, y - r - screen.lineHeight, ATLAS.ink);
}

// 畫在大視窗的內容區：地圖置左、正方形、盡量大（留一行寫說明）
export function drawMapWindow(ctx, screen, body, map, panels, player, caption) {
  const size = Math.floor(Math.min(body.w, body.h - screen.lineHeight));
  const ox = body.x;
  const oy = body.y;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(map.image(size), ox, oy);
  const at = (x, y) => map.pixelOf(x, y, size);

  // 城鎮：圓圈加名字，名字寫在右邊（疊到先寫的就往下挪）
  const placed = [];
  const r = Math.max(3, size / 220);
  for (const t of map.towns()) {
    const p = at(t.x, t.y);
    ctx.fillStyle = ATLAS.paper;
    ctx.strokeStyle = ATLAS.ink;
    ctx.lineWidth = Math.max(1, r / 3);
    ctx.beginPath();
    ctx.arc(ox + p.px, oy + p.py, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = ATLAS.town;
    ctx.beginPath();
    ctx.arc(ox + p.px, oy + p.py, r / 2, 0, Math.PI * 2);
    ctx.fill();
    const w = panels.measure(t.name, screen);
    let lx = ox + p.px + r + screen.pad;
    let ly = oy + p.py - screen.lineHeight / 2;
    if (lx + w > ox + size) lx = ox + p.px - r - screen.pad - w;
    for (
      let k = 0;
      k < 4 && placed.some((q) => Math.abs(q.y - ly) < screen.lineHeight && lx < q.x + q.w && q.x < lx + w);
      k++
    )
      ly += screen.lineHeight;
    placed.push({ x: lx, y: ly, w });
    panels.text(ctx, screen, t.name, lx, ly, ATLAS.ink);
  }

  // 冒險者：紅點描深色邊
  const p = at(player.x, player.y);
  const dot = Math.max(4, size / 160);
  ctx.fillStyle = ATLAS.frame;
  ctx.beginPath();
  ctx.arc(ox + p.px, oy + p.py, dot + 1.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = ATLAS.player;
  ctx.beginPath();
  ctx.arc(ox + p.px, oy + p.py, dot, 0, Math.PI * 2);
  ctx.fill();

  // 外框：雙線；左下角羅盤
  ctx.strokeStyle = ATLAS.frame;
  ctx.lineWidth = 3;
  ctx.strokeRect(ox + 1.5, oy + 1.5, size - 3, size - 3);
  ctx.lineWidth = 1;
  ctx.strokeRect(ox + 7.5, oy + 7.5, size - 15, size - 15);
  compass(ctx, panels, screen, ox + size * 0.08, oy + size * 0.9, size * 0.045);
  panels.text(ctx, screen, caption, ox, oy + size + screen.pad);
}

// 瀏覽器裡用：底圖同樣大小只畫一次；城鎮的位置與名字第一次用到時算（要生出那一區）
export function createWorldMap(world) {
  let cache = null;
  let towns = null;
  return {
    image(size) {
      if (cache?.width !== size) cache = drawBase(world, size);
      return cache;
    },
    // 城鎮：[{ x, y（圖樣中心）, name }]
    towns() {
      if (!towns) {
        towns = [];
        for (let zy = 0; zy < world.zonesY; zy++)
          for (let zx = 0; zx < world.zonesX; zx++) {
            if (world.settlementKind?.(zx, zy) !== 'town') continue;
            const s = world.settleOf(zx, zy);
            if (s) towns.push({ x: s.x0 + s.w / 2, y: s.y0 + s.h / 2, name: s.name });
          }
      }
      return towns;
    },
    // 世界格 (x, y) 落在 size 大小的地圖上哪個像素
    pixelOf: (x, y, size) => ({ px: (x / world.width) * size, py: (y / world.height) * size }),
  };
}
