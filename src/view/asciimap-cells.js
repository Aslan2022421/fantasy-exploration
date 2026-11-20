// 世界地圖（M）的奇幻 ASCII 畫法：每一格地圖字代表世界的一塊（附近：3×3 格；總覽：一區），這裡決定那一塊畫什麼字、什麼顏色。
// 只看世界（不碰畫布），可以在 Node 裡測。
// 路最後連成單線框字（joinRoads：─ │ ┌ ┼ …，接進聚落）
// 附近的一塊，照優先順序取：聚落（牆 # 、建築 ⌂、田 √、街道 ·）> 據點的建物（照物件的字）> 橋 > 路 >
//   水一半以上（深水 ≈、淺水與河 ~、沼澤 ~ 墨綠）> 樹（照樹種的字）> 山（山峰 ▲、其餘 ^，積雪白）> 生態覆蓋 > 地面（沙 ∙、其餘空白或淡淡的 .）
// 總覽的一區：水多是海 ≈，山多是山 ▲ ^，否則照周圍九區投票的生態（針葉 ↑、闊葉 ♣、雨林 ♠、草原 "、疏林草原 ,、沙漠 ∙、凍原 .），
//   有大道經過畫 ·，聚落畫 ⌂（村莊）■（城鎮）

import { GEO } from '../world/geography.js';
import { LAND } from '../world/landform.js';
import { hash01 } from '../world/noise.js';
import { MAIN } from '../world/roads.js';

export const INK = {
  bg: '#0b0d0e',
  wall: '#c9a874',
  building: '#d8c090',
  crops: '#b8b05a',
  road: '#d0b47a',
  deep: '#3f6f94',
  shallow: '#5f93b0',
  swamp: '#5d7a4a',
  mountain: '#9aa4a2',
  snow: '#e2eaea',
  ground: '#3c4038',
  sand: '#bfa868',
  village: '#f0d47a',
  town: '#d6a8f0',
  nest: '#c4685a',
};

// 生態在地圖上的字與顏色
const BIOME_GLYPH = {
  taiga: ['↑', '#4f8a5a'],
  'moss-forest': ['↑', '#5f8a6a'],
  'temperate-forest': ['♣', '#5a9a52'],
  'temperate-rainforest': ['♠', '#3f8a4a'],
  rainforest: ['♠', '#3a8a40'],
  grassland: ['"', '#8fae62'],
  savanna: [',', '#b0a060'],
  desert: ['∙', '#c0a560'],
  tundra: ['.', '#a3b0b0'],
};

// 附近：世界格 (x, y) 起、n×n 的一塊。回傳 { ch, fg }
export function regionCell(world, data, x, y, n) {
  let water = 0;
  let deep = 0;
  let swamp = 0;
  let mount = 0;
  let peak = false;
  let snow = 0;
  let tree = null;
  let road = false;
  let bridge = null;
  let site = null;
  let nestObj = null;
  const cover = new Map();
  let sand = 0;
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const X = x + i;
      const Y = y + j;
      if (!world.inside(X, Y)) continue;
      const s = world.settleAt?.(X, Y);
      if (s?.inside) {
        const code = s.settle.layout.grid[Y - s.settle.y0][X - s.settle.x0];
        const rank = settleRank(code, data.settlements[s.settle.kind]);
        if (rank && (!site || rank.p > site.p)) site = rank;
      }
      const o = world.objectAt(X, Y);
      const def = o >= 0 ? data.objects[o] : null;
      if (def?.bridge) bridge = def;
      const nest = world.nestAt?.(X, Y);
      if (nest?.inside && def && !def.gather && !nestObj) nestObj = def;
      if (def?.trunk && !tree) tree = def;
      if (data.surfaces[world.surfaceAt(X, Y)]?.id === 'road') road = true;
      const w = world.waterAt(X, Y);
      if (w >= 0) {
        water++;
        const st = data.waters[w].style;
        if (st === 'deep') deep++;
        if (st === 'swamp') swamp++;
      }
      if (data.landforms[world.landformAt(X, Y)]?.style === 'mountain') mount++;
      if (world.peakAt(X, Y)) peak = true;
      const sf = data.surfaces[world.surfaceAt(X, Y)];
      if (sf?.id === 'snow' || sf?.style === 'ice') snow++;
      if (sf?.style === 'sand') sand++;
      const k = world.coverAt(X, Y);
      if (k >= 0) cover.set(k, (cover.get(k) ?? 0) + 1);
    }
  const half = (n * n) / 2;
  if (site) return { ch: site.ch, fg: site.fg, joint: true };
  if (nestObj) return { ch: nestObj.glyph, fg: INK.nest };
  if (bridge) return { ch: bridge.glyph, fg: INK.road, road: true, keep: true };
  if (road) return { ch: '·', fg: INK.road, road: true };
  if (water >= half) {
    if (swamp >= water / 2) return { ch: '~', fg: INK.swamp };
    return deep >= water / 2 ? { ch: '≈', fg: INK.deep } : { ch: '~', fg: INK.shallow };
  }
  if (tree) return { ch: tree.glyph, fg: tree.color };
  if (mount >= half) return { ch: peak ? '▲' : '^', fg: snow >= half ? INK.snow : INK.mountain };
  if (cover.size) {
    const [k] = [...cover.entries()].sort((a, b) => b[1] - a[1])[0];
    const c = data.covers[k];
    return { ch: c.glyph, fg: c.color };
  }
  if (snow >= half) return { ch: '.', fg: INK.snow };
  if (sand >= half) return { ch: '∙', fg: INK.sand };
  return { ch: hash01(world.seed, x, y, 8800) < 0.25 ? '.' : ' ', fg: INK.ground };
}

// 聚落裡一格的代碼 → 地圖字（p 是優先順序，一塊裡取最大的）
function settleRank(code, def) {
  if (code === 'keep') return null;
  if (code === def.wall || code.endsWith('-tower')) return { p: 5, ch: '#', fg: INK.wall };
  if (['house', 'hall', 'temple', 'barracks', 'inn', 'tavern', 'market'].includes(code))
    return { p: 4, ch: '⌂', fg: INK.building };
  if (code === 'crops') return { p: 3, ch: '√', fg: INK.crops };
  if (code === 'road' || code === 'outroad' || code === 'town-well' || code === 'stall')
    return { p: 2, ch: '·', fg: INK.road };
  return { p: 1, ch: ' ', fg: INK.ground };
}

// 路連成線：看上下左右哪幾格也是路（或聚落），換成單線框字（─ │ ┌ ┼ …）；橋保留自己的字。cells 是 n×n 的陣列
const LINES = ['·', '│', '─', '└', '│', '│', '┌', '├', '─', '┘', '─', '┴', '┐', '┤', '┬', '┼'];
export function joinRoads(cells, n) {
  const linked = (i, j) => i >= 0 && j >= 0 && i < n && j < n && (cells[j * n + i].road || cells[j * n + i].joint);
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const c = cells[j * n + i];
      if (!c.road || c.keep) continue;
      const bits =
        (linked(i, j - 1) ? 1 : 0) |
        (linked(i + 1, j) ? 2 : 0) |
        (linked(i, j + 1) ? 4 : 0) |
        (linked(i - 1, j) ? 8 : 0);
      c.ch = LINES[bits];
    }
  return cells;
}

// 總覽：每一區一個字。回傳 (zx, zy) → { ch, fg }（第一次呼叫時整個算好）
export function zoneCells(world, data) {
  const geo = world.geography;
  const Zc = world.zoneSize / GEO.cell; // 一區幾個粗格
  const S = 4; // 每區取 S×S 個粗格
  const ZW = world.zonesX;
  const ZH = world.zonesY;
  const nb = data.biomes.length;
  const count = new Int32Array(ZW * ZH * nb);
  const stats = [];
  for (let zy = 0; zy < ZH; zy++)
    for (let zx = 0; zx < ZW; zx++) {
      let water = 0;
      let deep = 0;
      let mount = 0;
      let high = 0;
      for (let sy = 0; sy < S; sy++)
        for (let sx = 0; sx < S; sx++) {
          const gx = Math.floor(zx * Zc + ((sx + 0.5) * Zc) / S);
          const gy = Math.floor(zy * Zc + ((sy + 0.5) * Zc) / S);
          const i = gy * geo.W + gx;
          const h = geo.elev[i];
          if (h < LAND.water) {
            water++;
            if (h < LAND.water - LAND.deepDepth) deep++;
            continue;
          }
          if (h > LAND.mountain) {
            mount++;
            if (h > LAND.mountain + 0.15) high++;
            continue;
          }
          const { t, w } = world.climateAt(gx * GEO.cell + 4, gy * GEO.cell + 4, h);
          count[(zy * ZW + zx) * nb + world.biomeIndexOf(t, w)]++;
        }
      stats.push({ water, deep, mount, high });
    }
  const mainRoad = new Set();
  for (const s of world.roads?.segments ?? [])
    if (s.kind === MAIN) mainRoad.add(Math.floor(s.ay / world.zoneSize) * ZW + Math.floor(s.ax / world.zoneSize));
  const n = S * S;
  const out = [];
  for (let zy = 0; zy < ZH; zy++)
    for (let zx = 0; zx < ZW; zx++) {
      const z = zy * ZW + zx;
      const st = stats[z];
      const kind = world.settlementKind?.(zx, zy);
      let cell;
      if (kind === 'town') cell = { ch: '■', fg: INK.town, joint: true };
      else if (kind === 'village') cell = { ch: '⌂', fg: INK.village, joint: true };
      else if (st.water >= n * 0.6)
        cell = st.deep >= st.water / 2 ? { ch: '≈', fg: INK.deep } : { ch: '~', fg: INK.shallow };
      else if (st.mount >= (n - st.water) * 0.35)
        cell = { ch: st.high ? '▲' : '^', fg: st.high > 3 ? INK.snow : INK.mountain };
      else if (mainRoad.has(z)) cell = { ch: '·', fg: INK.road, road: true };
      else {
        // 生態：周圍九區投票（自己兩票），一區一區交錯的棋盤收成一大片
        const votes = new Float64Array(nb);
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const nx = zx + dx;
            const ny = zy + dy;
            if (nx < 0 || ny < 0 || nx >= ZW || ny >= ZH) continue;
            for (let b = 0; b < nb; b++) votes[b] += count[(ny * ZW + nx) * nb + b] * (dx || dy ? 1 : 2);
          }
        let best = 0;
        for (let b = 1; b < nb; b++) if (votes[b] > votes[best]) best = b;
        const [ch, fg] = BIOME_GLYPH[data.biomes[best].id] ?? ['.', INK.ground];
        cell = { ch, fg };
      }
      out.push(cell);
    }
  return (zx, zy) => out[zy * ZW + zx];
}
