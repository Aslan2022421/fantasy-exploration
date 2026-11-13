// 比較頁用的畫法：同一塊地形用不同方式畫，讓使用者並排挑。只給 compare.html 用，不進遊戲。
// 每種畫法都是 draw(mapView, cam, cols, rows, centerTier)

import { EDGE_RIM, EDGE_SHADOW, edgeAt, tierLevel } from '../view/elevation.js';
import { glyphAt } from '../view/glyphs.js';
import { buildObjectShades, buildShadeTable, dimColor } from '../view/shades.js';
import { PART_DARK, PART_LIT, PART_MID, PART_TRUNK } from '../world/footprint.js';
import { LAND } from '../world/landform.js';
import { FLAT } from '../world/relief.js';

const VOID = '#06181a';
const PART = { [PART_MID]: 1, [PART_LIT]: 1.25, [PART_DARK]: 0.65, [PART_TRUNK]: 0.8 };
const REL = [1, 3, 5, 7]; // 相對亮度：更低、低一層、同層、高處

export function createVariants(world, data) {
  const { terrains, objects } = data;
  const shades = buildShadeTable(terrains);
  const objectFg = buildObjectShades(objects);
  const isWater = terrains.map((t) => t.id.endsWith('water'));

  const absLevel = (x, y) => {
    const t = world.terrainAt(x, y);
    return isWater[t] ? world.shadeAt(x, y) : tierLevel(world.tierAt(x, y));
  };
  const relLevel = (x, y, center) => {
    const r = world.tierAt(x, y) - center;
    return REL[r >= 1 ? 3 : r === 0 ? 2 : r === -1 ? 1 : 0];
  };

  // 一格在亮度 level 下的樣子（地面字元＋物件）
  function look(x, y, level) {
    const t = world.terrainAt(x, y);
    const out = {
      glyph: glyphAt(world, data, x, y),
      fg: shades.fg[t][level][FLAT],
      bg: shades.bg[t][level][FLAT],
    };
    const o = world.objectAt(x, y);
    if (o >= 0) {
      out.glyph = objects[o].glyph;
      out.fg = dimColor(objectFg[o][level][FLAT], PART[world.objectPartAt(x, y)]);
    }
    return out;
  }

  // 平面畫法：每格畫在原位，cellFn(x, y) 回傳樣子
  function flat(cellFn) {
    return (mv, cam, cols, rows, center) => {
      for (let vy = 0; vy < rows; vy++) {
        for (let vx = 0; vx < cols; vx++) {
          const x = cam.x + vx;
          const y = cam.y + vy;
          if (!world.inside(x, y)) mv.draw(vx, vy, ' ', VOID, VOID);
          else {
            const l = cellFn(x, y, center);
            mv.draw(vx, vy, l.glyph, l.fg, l.bg);
          }
        }
      }
    };
  }

  // 層界的處理方式
  function withEdges(x, y, l, level, kind) {
    const e = edgeAt(world, x, y);
    if (kind === 'rim#') {
      if (e === EDGE_RIM) {
        l.glyph = '#';
        l.fg = shades.fg[world.terrainAt(x, y)][Math.min(7, level + 1)][FLAT];
      } else if (e === EDGE_SHADOW) {
        l.fg = dimColor(l.fg, 0.45);
        l.bg = dimColor(l.bg, 0.45);
      }
    } else if (kind === 'thin') {
      if (e === EDGE_RIM) l.fg = shades.fg[world.terrainAt(x, y)][Math.min(7, level + 1)][FLAT];
      else if (e === EDGE_SHADOW) l.bg = dimColor(l.bg, 0.6);
    } else if (kind === 'shadow') {
      if (e === EDGE_SHADOW) {
        l.fg = dimColor(l.fg, 0.6);
        l.bg = dimColor(l.bg, 0.6);
      }
    }
    return l;
  }

  const absolute = (kind) =>
    flat((x, y) => {
      const level = absLevel(x, y);
      return withEdges(x, y, look(x, y, level), level, kind);
    });

  // 每層往上抬的斜投影（之前試過的版本）：一般層抬 2 行、山地多的層抬 1 行，空出處畫暗色側面
  const liftOf = (tier) => Math.min(tier, LAND.landTiers) * 2 + Math.max(0, tier - LAND.landTiers);
  function lifted(mv, cam, cols, rows) {
    const maxLift = liftOf(7);
    for (let vx = 0; vx < cols; vx++) {
      const x = cam.x + vx;
      let filled = rows;
      for (let y = cam.y + rows - 1 + maxLift; y >= cam.y && filled > 0; y--) {
        const base = y - cam.y;
        if (!world.inside(x, y)) {
          if (base < filled) {
            if (base >= 0) mv.draw(vx, base, ' ', VOID, VOID);
            filled = base;
          }
          continue;
        }
        const top = base - liftOf(world.tierAt(x, y));
        if (top >= filled) continue;
        const level = absLevel(x, y);
        const wall = shades.fg[world.terrainAt(x, y)][level][FLAT];
        for (let r = Math.min(base, filled - 1); r > top; r--) {
          if (r >= 0 && r < rows) mv.draw(vx, r, '▓', dimColor(wall, r === top + 1 ? 0.5 : 0.36), dimColor(wall, 0.25));
        }
        if (top >= 0 && top < rows) {
          const l = look(x, y, level);
          mv.draw(vx, top, l.glyph, l.fg, l.bg);
        }
        filled = top;
      }
    }
  }

  // 往左下拉側面與影子（之前試過的版本）
  function extruded(x, y) {
    const here = world.tierAt(x, y);
    for (let k = 1; k <= 3; k++) {
      const sx = x + k;
      const sy = y - k;
      if (!world.inside(sx, sy)) continue;
      const d = world.tierAt(sx, sy) - here;
      if (d > 0 && Math.min(3, 1 + d) >= k) {
        const src = look(sx, sy, absLevel(sx, sy));
        const f = [0, 0.6, 0.5, 0.42][k];
        return { glyph: src.glyph, fg: dimColor(src.fg, f), bg: dimColor(src.bg, f) };
      }
    }
    const l = look(x, y, absLevel(x, y));
    if (world.objectAt(x, y) < 0) {
      for (let k = 1; k <= 3; k++) {
        const o = world.objectAt(x + k, y - k);
        if (o >= 0 && objects[o].height >= k && world.tierAt(x + k, y - k) >= here) {
          return { glyph: '/', fg: dimColor(l.fg, 0.85), bg: dimColor(l.bg, 0.6) };
        }
      }
    }
    return l;
  }

  return [
    { name: 'A 往上抬的斜投影', draw: lifted },
    { name: 'B 相對亮度四階', draw: flat((x, y, c) => look(x, y, relLevel(x, y, c))) },
    { name: 'C 絕對亮度，不畫層界', draw: absolute('none') },
    { name: 'D 絕對亮度＋細崖線', draw: absolute('thin') },
    { name: 'E 絕對亮度＋只有崖下暗帶', draw: absolute('shadow') },
    { name: 'F 絕對亮度＋粗崖邊 # 與暗帶', draw: absolute('rim#') },
    { name: 'G 往左下拉側面與影子', draw: flat(extruded) },
  ];
}
