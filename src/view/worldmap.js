// 整個世界的總覽（M 再按 Tab）：整個世界在地理粗格（geography.js，8×8 格一個）上的樣子，一個粗格一個點。
// 配色照舊專案的小地圖（css 的 --m-*，跟附近地圖 regionmap.js 同一組）：
// - 湖海依深淺兩種藍，海岸線照粗格；河只畫幹流（匯流到 GEO.deepFlow 以上），縮小時一個像素蓋到的粗格有幹流就畫河，河不會斷
// - 陸地照區畫：一區一塊，顏色是那一區的多數生態、照平均高度分五級越高越亮（0.75＋每級 0.08）；山地多的區整塊畫山（由灰往白）
// - 聚落照建世界時排好的位置畫點（村莊黃色小點、城鎮紫色大點）
// 粗格的顏色第一次打開時算一次（96×96 區的世界約 130 萬個粗格），之後只依視窗大小重新縮放

import { Color } from 'rot-js';
import { GEO } from '../world/geography.js';
import { LAND } from '../world/landform.js';
import { GEN } from '../world/terrain.js';
import { OLD_BIOME } from './regionmap.js';

export const MAP_COLORS = {
  deep: '#3a6a8e',
  shallow: '#4f82a6',
  river: '#4f82a6',
  rock: '#7f8c8a',
  snow: '#d4e0de',
  land: '#566a69', // 生態沒有顏色時
  village: '#ffe08a',
  town: '#e0b0ff',
  mark: '#c9bb7a', // 冒險者所在那一區的框
  player: '#ffffff',
  outline: '#080a0c', // 標記外圈的深色邊
};
const ZONE_MOUNTAIN = 0.35; // 一區的陸地裡山地多過這麼多，整區畫成山

const rgb = (hex) => Color.fromString(hex);
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const biomeHex = (b) => (b ? (OLD_BIOME[b.id] ?? b.mapColor ?? MAP_COLORS.land) : MAP_COLORS.land);

// 一個粗格的顏色 [r, g, b]：elev 高度、flow 河的流量、biome 生態（data.biomes 的一筆）
export function coarseColor(elev, flow, biome) {
  if (elev < LAND.water) return rgb(elev < LAND.water - LAND.deepDepth ? MAP_COLORS.deep : MAP_COLORS.shallow);
  if (flow > 0) return rgb(MAP_COLORS.river);
  if (elev > LAND.mountain) {
    const f = clamp01((elev - LAND.mountain) / GEN.treelineRange);
    return Color.interpolate(rgb(MAP_COLORS.rock), rgb(MAP_COLORS.snow), f * f);
  }
  const level = Math.min(4, Math.floor(clamp01((elev - LAND.water) / (LAND.mountain - LAND.water)) * 5));
  return rgb(biomeHex(biome)).map((v) => Math.min(255, Math.round(v * (0.75 + level * 0.08))));
}

// 整個世界每個粗格的顏色：RGBA，寬 geo.W、高 geo.H。
// 陸地照「區」畫：一區看成一塊地圖格，顏色是那一區的多數生態（山地多過 ZONE_MOUNTAIN 的區整塊是山），亮度照那一區的平均高度；
// 海岸線照粗格畫，河只畫匯流到 GEO.deepFlow 以上的幹流。粗格各自算的話山與支流散成滿地雜點
export function coarseImage(world, data) {
  const geo = world.geography;
  const C = world.width / geo.W;
  const N = geo.W * geo.H;
  const Zc = Math.max(1, Math.round(world.zoneSize / C)); // 一區幾個粗格
  const ZW = Math.ceil(geo.W / Zc);
  const ZH = Math.ceil(geo.H / Zc);
  const nb = data.biomes.length;
  const count = new Int32Array(ZW * ZH * nb);
  const land = new Int32Array(ZW * ZH);
  const mountain = new Int32Array(ZW * ZH);
  const elev = new Float64Array(ZW * ZH);
  for (let i = 0; i < N; i++) {
    const h = geo.elev[i];
    if (h < LAND.water) continue;
    const x = i % geo.W;
    const y = (i - x) / geo.W;
    const z = Math.floor(y / Zc) * ZW + Math.floor(x / Zc);
    land[z]++;
    elev[z] += h;
    if (h > LAND.mountain) {
      mountain[z]++;
      continue;
    }
    const { t, w } = world.climateAt(x * C + C / 2, y * C + C / 2, h);
    count[z * nb + world.biomeIndexOf(t, w)]++;
  }
  // 每區連同周圍八區一起投票（自己那區兩票），生態與山地收成一大片，不會一區一區交錯成棋盤
  const zoneColor = [];
  const votes = new Float64Array(nb);
  for (let zy = 0; zy < ZH; zy++)
    for (let zx = 0; zx < ZW; zx++) {
      const z = zy * ZW + zx;
      if (!land[z]) continue;
      votes.fill(0);
      let L = 0;
      let Mt = 0;
      let E = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = zx + dx;
          const ny = zy + dy;
          if (nx < 0 || ny < 0 || nx >= ZW || ny >= ZH) continue;
          const k = ny * ZW + nx;
          const wgt = dx || dy ? 1 : 2;
          L += land[k] * wgt;
          Mt += mountain[k] * wgt;
          E += elev[k] * wgt;
          for (let b = 0; b < nb; b++) votes[b] += count[k * nb + b] * wgt;
        }
      const mean = E / L; // 平均高度也連周圍一起算，亮度不會一區一區跳
      if (Mt / L >= ZONE_MOUNTAIN) {
        zoneColor[z] = coarseColor(Math.max(mean, LAND.mountain + 0.001), 0, null);
        continue;
      }
      let best = 0;
      for (let b = 1; b < nb; b++) if (votes[b] > votes[best]) best = b;
      zoneColor[z] = coarseColor(Math.min(mean, LAND.mountain), 0, data.biomes[best]);
    }
  const out = new Uint8ClampedArray(N * 4);
  for (let i = 0; i < N; i++) {
    const h = geo.elev[i];
    const x = i % geo.W;
    const y = (i - x) / geo.W;
    let c;
    if (h < LAND.water) c = coarseColor(h, 0, null);
    else if (geo.flow[i] >= GEO.deepFlow) c = rgb(MAP_COLORS.river);
    else c = zoneColor[Math.floor(y / Zc) * ZW + Math.floor(x / Zc)];
    out.set([c[0], c[1], c[2], 255], i * 4);
  }
  return out;
}

// 畫在大視窗的內容區：地圖置左、正方形、盡量大（留一行寫說明）；冒險者所在的區框起來、冒險者畫一個亮點
export function drawMapWindow(ctx, screen, body, map, panels, player, caption) {
  const size = Math.floor(Math.min(body.w, body.h - screen.lineHeight));
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(map.image(size), body.x, body.y);
  // 世界很大、一區在地圖上只有十來個像素：區的方框外再描一圈深色，冒險者那點也描深色邊，花紋上才看得出來
  const zone = map.zoneRect(player, size);
  const w = Math.max(2, screen.pad / 2);
  const box = (pad, color) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.strokeRect(body.x + zone.x - pad, body.y + zone.y - pad, zone.w + pad * 2, zone.h + pad * 2);
  };
  box(w * 2, MAP_COLORS.outline);
  box(w, MAP_COLORS.mark);
  const p = map.pixelOf(player.x, player.y, size);
  const dot = Math.max(5, screen.pad * 1.5);
  const at = (d) => [body.x + Math.floor(p.px - d / 2), body.y + Math.floor(p.py - d / 2), d, d];
  ctx.fillStyle = MAP_COLORS.outline;
  ctx.fillRect(...at(dot + w * 2));
  ctx.fillStyle = MAP_COLORS.player;
  ctx.fillRect(...at(dot));
  // 聚落：建世界時排好的區畫一個點（村莊黃、城鎮紫）
  const zs = size / map.zonesX;
  for (const m of map.settlements()) {
    const d = m.kind === 'town' ? Math.max(4, Math.round(zs * 0.6)) : Math.max(2, Math.round(zs * 0.25));
    const cx = body.x + Math.floor((m.zx + 0.5) * zs - d / 2);
    const cy = body.y + Math.floor((m.zy + 0.5) * zs - d / 2);
    ctx.fillStyle = MAP_COLORS.outline;
    ctx.fillRect(cx - 1, cy - 1, d + 2, d + 2);
    ctx.fillStyle = m.kind === 'town' ? MAP_COLORS.town : MAP_COLORS.village;
    ctx.fillRect(cx, cy, d, d);
  }
  panels.text(ctx, screen, caption, body.x, body.y + size + screen.pad);
}

// 瀏覽器裡用：回傳 size×size 的圖層（最近鄰縮放，不糊），同樣大小只做一次
export function createWorldMap(world, data) {
  const geo = world.geography;
  let base = null;
  let cache = null;
  let marks = null;
  return {
    zonesX: world.zonesX,
    // 建世界時排好要放聚落的區：[{ zx, zy, kind }]
    settlements() {
      if (!marks) {
        marks = [];
        for (let zy = 0; zy < world.zonesY; zy++)
          for (let zx = 0; zx < world.zonesX; zx++) {
            const kind = world.settlementKind?.(zx, zy);
            if (kind) marks.push({ zx, zy, kind });
          }
      }
      return marks;
    },
    image(size) {
      if (cache?.width === size) return cache;
      base ??= coarseImage(world, data);
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      const img = ctx.createImageData(size, size);
      const river = rgb(MAP_COLORS.river);
      for (let py = 0; py < size; py++) {
        const gy0 = Math.min(geo.H - 1, Math.floor((py * geo.H) / size));
        const gy1 = Math.max(gy0 + 1, Math.min(geo.H, Math.floor(((py + 1) * geo.H) / size)));
        for (let px = 0; px < size; px++) {
          const gx0 = Math.min(geo.W - 1, Math.floor((px * geo.W) / size));
          const gx1 = Math.max(gx0 + 1, Math.min(geo.W, Math.floor(((px + 1) * geo.W) / size)));
          let wet = false;
          for (let gy = gy0; gy < gy1 && !wet; gy++)
            for (let gx = gx0; gx < gx1 && !wet; gx++) {
              const i = gy * geo.W + gx;
              wet = geo.flow[i] >= GEO.deepFlow && geo.elev[i] >= LAND.water;
            }
          const o = (py * size + px) * 4;
          if (wet) img.data.set([...river, 255], o);
          else {
            const s = (gy0 * geo.W + gx0) * 4;
            img.data.set(base.subarray(s, s + 4), o);
          }
        }
      }
      ctx.putImageData(img, 0, 0);
      cache = canvas;
      return canvas;
    },
    // 世界格 (x, y) 落在 size 大小的地圖上哪個像素
    pixelOf: (x, y, size) => ({ px: (x / world.width) * size, py: (y / world.height) * size }),
    // (x, y) 所在的那一區在地圖上的方框
    zoneRect(p, size) {
      const Z = world.zoneSize;
      const zx = Math.floor(p.x / Z) * Z;
      const zy = Math.floor(p.y / Z) * Z;
      const s = size / world.width;
      return { x: Math.floor(zx * s), y: Math.floor(zy * s), w: Math.ceil(Z * s), h: Math.ceil(Z * s) };
    },
  };
}
