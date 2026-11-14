// 世界地圖（M）：整個世界在地理粗格（geography.js，8×8 格一個）上的樣子，一個粗格一個點。
// - 湖海依深淺兩種藍，河（有流量的粗格）是亮一點的藍
// - 山地由灰往白，高過雪線是雪
// - 其餘陸地是生態的顏色（data/biome 的 mapColor），越高越亮一點
// 粗格的顏色第一次打開時算一次（96×96 區的世界約 130 萬個粗格），之後只依視窗大小重新縮放

import { Color } from 'rot-js';
import { LAND } from '../world/landform.js';
import { GEN } from '../world/terrain.js';

export const MAP_COLORS = {
  deep: '#1d3b5a',
  shallow: '#2f5f80',
  river: '#4f8fb8',
  rock: '#77776f',
  snow: '#d6dbde',
  land: '#6c6c66', // 生態沒寫 mapColor 時
  mark: '#c9bb7a', // 冒險者所在那一區的框
  player: '#ffffff',
  outline: '#080a0c', // 標記外圈的深色邊
};

const rgb = (hex) => Color.fromString(hex);
const clamp01 = (v) => Math.max(0, Math.min(1, v));

// 一個粗格的顏色 [r, g, b]：elev 高度、flow 河的流量、biome 生態（data.biomes 的一筆）
export function coarseColor(elev, flow, biome) {
  if (elev < LAND.water) return rgb(elev < LAND.water - LAND.deepDepth ? MAP_COLORS.deep : MAP_COLORS.shallow);
  if (flow > 0) return rgb(MAP_COLORS.river);
  if (elev > LAND.mountain) {
    const f = clamp01((elev - LAND.mountain) / GEN.treelineRange);
    return Color.interpolate(rgb(MAP_COLORS.rock), rgb(MAP_COLORS.snow), f * f);
  }
  const lift = 0.8 + 0.4 * clamp01((elev - LAND.water) / (LAND.mountain - LAND.water));
  return rgb(biome?.mapColor ?? MAP_COLORS.land).map((v) => Math.min(255, Math.round(v * lift)));
}

// 整個世界每個粗格的顏色：RGBA，寬 geo.W、高 geo.H
export function coarseImage(world, data) {
  const geo = world.geography;
  const C = world.width / geo.W;
  const out = new Uint8ClampedArray(geo.W * geo.H * 4);
  for (let i = 0; i < geo.W * geo.H; i++) {
    const x = (i % geo.W) * C + C / 2;
    const y = Math.floor(i / geo.W) * C + C / 2;
    const h = geo.elev[i];
    let biome = null;
    if (h >= LAND.water && !geo.flow[i] && h <= LAND.mountain) {
      const { t, w } = world.climateAt(x, y, h);
      biome = data.biomes[world.biomeIndexOf(t, w)];
    }
    const [r, g, b] = coarseColor(h, geo.flow[i], biome);
    out.set([r, g, b, 255], i * 4);
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
  panels.text(ctx, screen, caption, body.x, body.y + size + screen.pad);
}

// 瀏覽器裡用：回傳 size×size 的圖層（最近鄰縮放，不糊），同樣大小只做一次
export function createWorldMap(world, data) {
  const geo = world.geography;
  let base = null;
  let cache = null;
  return {
    image(size) {
      if (cache?.width === size) return cache;
      base ??= coarseImage(world, data);
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      const img = ctx.createImageData(size, size);
      for (let py = 0; py < size; py++) {
        const gy = Math.min(geo.H - 1, Math.floor((py * geo.H) / size));
        for (let px = 0; px < size; px++) {
          const gx = Math.min(geo.W - 1, Math.floor((px * geo.W) / size));
          const s = (gy * geo.W + gx) * 4;
          img.data.set(base.subarray(s, s + 4), (py * size + px) * 4);
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
