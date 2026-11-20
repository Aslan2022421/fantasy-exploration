// 世界地圖（M）：奇幻 ASCII 的畫法（使用者給的示意圖：黑底、字畫成的樹、水、路、聚落，旁邊一欄編號圖例）。
// 兩頁同一種畫法，都是 96×96 個字，用遊戲原本的 CP437 字元表：
// - 附近（M）：冒險者所在那一區與周圍八區，一個字代表 3×3 格（asciimap-cells.js 的 regionCell）
// - 總覽（Tab）：整個世界，一個字代表一區（zoneCells）
// 地圖上畫冒險者 @、附近的怪物；聚落與據點標編號，右邊一欄列出編號對應的名字與圖例。
// 地圖的字照「看哪一塊＋紀錄筆數」快取，標記每次重畫

import { INK, joinRoads, regionCell, zoneCells } from './asciimap-cells.js';

const GRID = 96; // 地圖幾個字見方
const LEGEND = [
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
];

export function createAsciiMap(world, data, tiles) {
  let cache = null;
  let zones = null;
  const townNames = new Map();

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

  // 畫面配置：地圖在左（字的大小是 8 的倍數），圖例在右
  function frame(screen, body) {
    const px = Math.max(8, 8 * Math.floor(Math.min(body.w * 0.7, body.h - screen.lineHeight * 2) / (GRID * 8)));
    return { px, size: GRID * px, lx: body.x + GRID * px + screen.pad * 6 };
  }

  // 一個字的位置畫一個標記（黑框底）
  const mark = (ctx, ox, oy, px, i, j, ch, fg, bg) => {
    if (i < 0 || j < 0 || i >= GRID || j >= GRID) return;
    tiles.draw(ctx, ch, ox + i * px, oy + j * px, px, fg, bg);
  };
  // 編號：畫在地圖上那一格旁邊（深底小框），回傳圖例的一行
  const tag = (ctx, screen, panels, ox, oy, px, i, j, n) => {
    if (i < 0 || j < 0 || i >= GRID || j >= GRID) return;
    const t = String(n);
    const w = panels.measure(t, screen) + 2;
    const x = ox + (i + 1) * px;
    const y = oy + j * px - screen.lineHeight / 2;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.fillRect(x, y, w, screen.lineHeight);
    panels.text(ctx, screen, t, x + 1, y, '#f6f3de');
  };

  function legend(ctx, screen, panels, x, y, title, rows, extra = []) {
    panels.text(ctx, screen, title, x, y, '#f6f3de');
    let ly = y + screen.lineHeight * 1.5;
    for (const r of rows) {
      panels.text(ctx, screen, r, x, ly);
      ly += screen.lineHeight;
    }
    ly += screen.lineHeight / 2;
    for (const [ch, fg, name] of [...LEGEND, ...extra]) {
      tiles.draw(ctx, ch, x, ly + 2, 16, fg, null);
      panels.text(ctx, screen, name, x + 24, ly);
      ly += screen.lineHeight;
    }
  }

  // 附近：冒險者所在那一區與周圍八區（288×288 格），一個字 3×3 格
  function drawRegion(ctx, screen, body, panels, player, cam, stamp, caption) {
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
    ctx.drawImage(img, body.x, body.y);
    const at = (x, y) => [Math.floor((x - x0) / n), Math.floor((y - y0) / n)];
    // 怪物（混食）
    for (let zy = y0 / Z; zy < y0 / Z + 3; zy++)
      for (let zx = x0 / Z; zx < x0 / Z + 3; zx++)
        for (const herd of world.herdsOf(zx, zy)) {
          const sp = data.species[herd.species];
          if (sp.diet !== 'omnivore') continue;
          for (const id of world.liveMembers(herd)) {
            const c = world.creatureById(id);
            if (c) mark(ctx, body.x, body.y, f.px, ...at(c.member.x, c.member.y), sp.glyph, INK.nest, INK.bg);
          }
        }
    // 主畫面看得到的範圍
    ctx.strokeStyle = 'rgba(246, 243, 222, 0.5)';
    ctx.lineWidth = 1;
    const [vx, vy] = at(cam.x, cam.y);
    ctx.strokeRect(body.x + vx * f.px + 0.5, body.y + vy * f.px + 0.5, (cam.w / n) * f.px, (cam.h / n) * f.px);
    mark(ctx, body.x, body.y, f.px, ...at(player.x, player.y), '@', '#ffffff', '#a8302a');
    // 編號：聚落與據點
    const rows = [];
    let k = 1;
    for (let zy = y0 / Z; zy < y0 / Z + 3; zy++)
      for (let zx = x0 / Z; zx < x0 / Z + 3; zx++) {
        const s = world.settleOf(zx, zy);
        if (s) {
          tag(ctx, screen, panels, body.x, body.y, f.px, ...at(s.x0 + s.w / 2, s.y0), k);
          rows.push(`${k++}　${s.name}（${data.settlements[s.kind].name}）`);
        }
        const nst = world.nestOf(zx, zy);
        if (nst) {
          tag(ctx, screen, panels, body.x, body.y, f.px, ...at(nst.x0 + nst.w / 2, nst.y0), k);
          rows.push(`${k++}　${data.nests[nst.kind].name}`);
        }
      }
    legend(ctx, screen, panels, f.lx, body.y, '附近', rows);
    panels.text(ctx, screen, caption, body.x, body.y + f.size + screen.pad);
  }

  // 總覽：整個世界，一個字一區；只畫知道的區（known.zones：走過的區加周圍一圈），
  // 聽過傳聞、還沒去過的據點與聚落標「?」（known.places）；編號只標知道的、離冒險者最近的 TOWNS 座城鎮
  const TOWNS = 12;
  const UNKNOWN = { ch: ' ' };
  function drawWorld(ctx, screen, body, panels, player, caption, known) {
    zones ??= zoneCells(world, data);
    const f = frame(screen, body);
    const seen = (zx, zy) => known.zones.has(`${zx},${zy}`);
    const img = render(`w:${f.px}:${known.version}`, (i, j) => (seen(i, j) ? zones(i, j) : UNKNOWN), f.px);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, body.x, body.y);
    const Z = world.zoneSize;
    const pz = [Math.floor(player.x / Z), Math.floor(player.y / Z)];
    const towns = [];
    for (let zy = 0; zy < world.zonesY; zy++)
      for (let zx = 0; zx < world.zonesX; zx++)
        if (seen(zx, zy) && ['town', 'city'].includes(world.settlementKind?.(zx, zy)))
          towns.push({ zx, zy, d: Math.hypot(zx - pz[0], zy - pz[1]) });
    towns.sort((a, b) => a.d - b.d);
    // 排了城鎮、實際放不下改成村莊的不算（要生出那一區才知道，名字記著）
    const rows = [];
    for (const t of towns) {
      if (rows.length >= TOWNS) break;
      const key = `${t.zx},${t.zy}`;
      if (!townNames.has(key)) {
        const s = world.settleOf(t.zx, t.zy);
        townNames.set(key, s && ['town', 'city'].includes(data.settlements[s.kind].id) ? s.name : null);
      }
      if (!townNames.get(key)) continue;
      tag(ctx, screen, panels, body.x, body.y, f.px, t.zx, t.zy, rows.length + 1);
      rows.push(`${rows.length + 1}　${townNames.get(key)}`);
    }
    for (const p of known.places)
      if (!seen(p.zx, p.zy)) mark(ctx, body.x, body.y, f.px, p.zx, p.zy, '?', INK.nest, INK.bg);
    mark(ctx, body.x, body.y, f.px, pz[0], pz[1], '@', '#ffffff', '#a8302a');
    legend(ctx, screen, panels, f.lx, body.y, `知道的城鎮、城市（最近 ${rows.length} 座）`, rows, [
      ['?', INK.nest, '聽說過的地方'],
    ]);
    panels.text(ctx, screen, caption, body.x, body.y + f.size + screen.pad);
  }

  return { drawRegion, drawWorld };
}
