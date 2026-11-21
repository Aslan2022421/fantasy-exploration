// 世界地圖（M）的地圖本身：奇幻 ASCII 的畫法（使用者給的示意圖：黑底、字畫成的樹、水、路、聚落）。
// 兩頁同一種畫法，都是 96×96 個字，用遊戲原本的 CP437 字元表：
// - 附近：冒險者所在那一區與周圍八區，一個字代表 3×3 格（asciimap-cells.js 的 regionCell）
// - 整個世界：一個字代表一區（zoneCells）；只畫知道的區，聽過傳聞還沒去過的地方標 ?
// 地圖的字照「看哪一塊＋紀錄筆數（或知道的範圍）」快取；冒險者、怪物、選中的框每次重畫。
// 兩個 draw 都回傳 { f 版面, places 地圖上的地方 }，右欄（map-view.js）照 places 列清單

import { INK, joinRoads, regionCell, zoneCells } from './asciimap-cells.js';

const GRID = 96; // 地圖幾個字見方
export const LEGEND = [
  ['♣', '#5a9a52', '闊葉林'],
  ['↑', '#4f8a5a', '針葉林'],
  ['♠', '#3f8a4a', '雨林'],
  ['"', '#8fae62', '草原'],
  ['∙', INK.sand, '沙漠'],
  ['▲', INK.mountain, '山'],
  ['≈', INK.deep, '海、湖'],
  ['~', INK.shallow, '河、淺水'],
  ['─', INK.road, '路'],
  ['⌂', INK.village, '村莊'],
  ['■', INK.town, '城鎮'],
  ['◘', INK.city, '城市'],
  ['╫', INK.fort, '堡壘、要塞'],
  ['@', '#ffffff', '你'],
  ['?', INK.nest, '聽說過的地方'],
];
const UNKNOWN = { ch: ' ' };

export function createAsciiMap(world, data, tiles) {
  let cache = null;
  let zones = null;
  const placeCache = new Map(); // 區 → { settle, nest }（生出那一區才知道實際蓋了什麼）

  function render(key, cellAt, px) {
    if (cache?.key === key) return cache.canvas;
    const canvas = document.createElement('canvas');
    canvas.width = GRID * px;
    canvas.height = GRID * px;
    const g = canvas.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.fillStyle = INK.bg;
    g.fillRect(0, 0, canvas.width, canvas.height);
    const cells = [];
    for (let j = 0; j < GRID; j++) for (let i = 0; i < GRID; i++) cells.push({ ...cellAt(i, j) });
    joinRoads(cells, GRID); // 路連成線
    cells.forEach((c, k) => {
      if (c.ch !== ' ') tiles.draw(g, c.ch, (k % GRID) * px, Math.floor(k / GRID) * px, px, c.fg, null);
    });
    cache = { key, canvas };
    return canvas;
  }

  // 版面：地圖在左（字的大小是 8 的倍數），右邊留給清單與說明
  function frame(screen, body) {
    const px = Math.max(8, 8 * Math.floor(Math.min(body.w * 0.6, body.h) / (GRID * 8)));
    return { px, size: GRID * px, x: body.x, y: body.y, rx: body.x + GRID * px + screen.pad * 8 };
  }

  // 一個字的位置畫一個標記（黑框底）
  const mark = (ctx, f, i, j, ch, fg, bg) => {
    if (i < 0 || j < 0 || i >= GRID || j >= GRID) return;
    tiles.draw(ctx, ch, f.x + i * f.px, f.y + j * f.px, f.px, fg, bg);
  };
  // 選中的地方：那個字外面畫一圈亮框
  function highlight(ctx, f, i, j) {
    ctx.strokeStyle = '#ffd84a';
    ctx.lineWidth = Math.max(2, Math.floor(f.px / 4));
    ctx.strokeRect(f.x + (i - 2) * f.px, f.y + (j - 2) * f.px, f.px * 5, f.px * 5);
  }

  const zoneOf = (zx, zy) => {
    const k = `${zx},${zy}`;
    if (!placeCache.has(k)) placeCache.set(k, { settle: world.settleOf(zx, zy), nest: world.nestOf(zx, zy) });
    return placeCache.get(k);
  };
  const settlePlace = (s, i, j) => ({
    key: `s:${s.id}`,
    settle: s,
    name: s.name,
    kind: data.settlements[s.kind].name,
    zx: Math.floor(s.x0 / world.zoneSize),
    zy: Math.floor(s.y0 / world.zoneSize),
    i,
    j,
  });
  const nestPlace = (n, i, j) => ({
    key: `n:${n.id}`,
    nest: n,
    name: data.nests[n.kind].name,
    kind: '據點',
    zx: Math.floor(n.x0 / world.zoneSize),
    zy: Math.floor(n.y0 / world.zoneSize),
    i,
    j,
  });

  // 附近：冒險者所在那一區與周圍八區（288×288 格），一個字 3×3 格
  function drawRegion(ctx, screen, body, player, cam, stamp) {
    const Z = world.zoneSize;
    const n = (3 * Z) / GRID;
    const x0 = (Math.floor(player.x / Z) - 1) * Z;
    const y0 = (Math.floor(player.y / Z) - 1) * Z;
    const f = frame(screen, body);
    const img = render(
      `r:${x0},${y0},${f.px},${stamp}`,
      (i, j) => regionCell(world, data, x0 + i * n, y0 + j * n, n),
      f.px,
    );
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, f.x, f.y);
    const at = (x, y) => [Math.floor((x - x0) / n), Math.floor((y - y0) / n)];
    // 怪物（混食）
    for (let zy = y0 / Z; zy < y0 / Z + 3; zy++)
      for (let zx = x0 / Z; zx < x0 / Z + 3; zx++)
        for (const herd of world.herdsOf(zx, zy)) {
          const sp = data.species[herd.species];
          if (sp.diet !== 'omnivore') continue;
          for (const id of world.liveMembers(herd)) {
            const c = world.creatureById(id);
            if (c) mark(ctx, f, ...at(c.member.x, c.member.y), sp.glyph, INK.nest, INK.bg);
          }
        }
    // 主畫面看得到的範圍
    ctx.strokeStyle = 'rgba(246, 243, 222, 0.5)';
    ctx.lineWidth = 1;
    const [vx, vy] = at(cam.x, cam.y);
    ctx.strokeRect(f.x + vx * f.px + 0.5, f.y + vy * f.px + 0.5, (cam.w / n) * f.px, (cam.h / n) * f.px);
    mark(ctx, f, ...at(player.x, player.y), '@', '#ffffff', '#a8302a');
    const places = [];
    for (let zy = y0 / Z; zy < y0 / Z + 3; zy++)
      for (let zx = x0 / Z; zx < x0 / Z + 3; zx++) {
        const z = zoneOf(zx, zy);
        if (z.settle)
          places.push(settlePlace(z.settle, ...at(z.settle.x0 + z.settle.w / 2, z.settle.y0 + z.settle.h / 2)));
        if (z.nest) places.push(nestPlace(z.nest, ...at(z.nest.x0 + z.nest.w / 2, z.nest.y0 + z.nest.h / 2)));
      }
    return { f, places, cell: (i, j) => ({ x: x0 + i * n + 1, y: y0 + j * n + 1 }) };
  }

  // 整個世界：一個字一區；known：{ zones 知道的區, places 聽過的地方, version }
  function drawWorld(ctx, screen, body, player, known) {
    zones ??= zoneCells(world, data);
    const f = frame(screen, body);
    const seen = (zx, zy) => known.zones.has(`${zx},${zy}`);
    const img = render(`w:${f.px}:${known.version}`, (i, j) => (seen(i, j) ? zones(i, j) : UNKNOWN), f.px);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, f.x, f.y);
    const places = [];
    for (const k of known.zones) {
      const [zx, zy] = k.split(',').map(Number);
      if (zx < 0 || zy < 0 || zx >= world.zonesX || zy >= world.zonesY) continue;
      const z = zoneOf(zx, zy);
      if (z.settle) places.push(settlePlace(z.settle, zx, zy));
      if (z.nest) places.push(nestPlace(z.nest, zx, zy));
    }
    const heard = new Set();
    for (const p of known.places) {
      const k = `${p.zx},${p.zy}`;
      if (seen(p.zx, p.zy) || heard.has(k)) continue;
      heard.add(k);
      places.push({
        key: `h:${k}`,
        name: p.name,
        kind: '聽說過',
        heard: p.heard,
        zx: p.zx,
        zy: p.zy,
        i: p.zx,
        j: p.zy,
      });
      mark(ctx, f, p.zx, p.zy, '?', INK.nest, INK.bg);
    }
    const Z = world.zoneSize;
    mark(ctx, f, Math.floor(player.x / Z), Math.floor(player.y / Z), '@', '#ffffff', '#a8302a');
    return { f, places, cell: (i, j) => ({ x: i * Z + Z / 2, y: j * Z + Z / 2 }) };
  }

  return { drawRegion, drawWorld, highlight, tiles, GRID };
}
