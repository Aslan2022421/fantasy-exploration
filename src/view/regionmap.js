// 附近地圖（M 打開的第一頁，照舊專案的小地圖畫法）：冒險者所在那一區與周圍八區（288×288 格，舊專案整個世界的大小），
// 一格畫成 S×S 像素：
// - 地面照生態的顏色（舊專案 css 的 --m-*），高度層越高越亮（0.75＋每層 0.08）；湖海、河是藍、沼澤墨綠、山地灰、雪地與冰白
// - 聚落：外牆照石牆、木牆的顏色，建築的牆是房屋色，牆內其餘是村莊或城鎮的顏色；據點的建物（牆、墓碑、岩丘、樹⋯⋯）是土黃色；橋是木頭色
// - 點：礦坑（菱形）、還沒開的寶箱、村民、怪物；冒險者白點加黑框；白框是主畫面看得到的範圍
// - 名字：聚落寫在上方（村莊黃、城鎮紫），據點寫在下方
// 地面那張圖照「中間那一區＋每格幾像素＋紀錄筆數」快取，點與框每次重畫

import { Color } from 'rot-js';

export const REGION = { zones: 3 };

// 舊專案 css 的 --m-*（old-v37.1），生態對過來：沒有的照最接近的
export const OLD_BIOME = {
  tundra: '#8fa9b0',
  taiga: '#3d6f62',
  'moss-forest': '#3d6f62',
  grassland: '#5d8a52',
  'temperate-forest': '#3d6f48',
  'temperate-rainforest': '#31804a',
  desert: '#c0a560',
  savanna: '#a8914a',
  rainforest: '#31804a',
};
const M = {
  plain: '#566a69',
  lake: '#4f82a6',
  deep: '#3a6a8e',
  swamp: '#4d6e5c',
  mountain: '#7f8c8a',
  glacier: '#d4e0de',
  stonewall: '#b6c4c0',
  woodwall: '#a98458',
  building: '#c49a66',
  village: '#3d6a6c',
  town: '#7a6aa0',
  relic: '#a8916a',
  ore: '#6fc2c2',
  chest: '#d4bd7a',
  npc: '#c58aa5',
  mon: '#c4685a',
  player: '#f6f3de',
  view: 'rgba(246, 243, 222, 0.6)',
  void: '#000000',
};
const LABEL = { village: '#ffe08a', town: '#e0b0ff', nest: '#e8c890' };

const rgb = (hex) => Color.fromString(hex);
const shade = (hex, h) => rgb(hex).map((v) => Math.min(255, Math.round(v * (0.75 + Math.min(4, h) * 0.08))));

export function createRegionMap(world, data) {
  const biomeColor = data.biomes.map((b) => OLD_BIOME[b.id] ?? b.mapColor ?? M.plain);
  const waterKind = data.waters.map((w) => (w.style === 'swamp' ? M.swamp : w.style === 'deep' ? M.deep : M.lake));
  const isMountain = data.landforms.map((l) => l.style === 'mountain');
  const isIce = data.surfaces.map((s) => s.id === 'snow' || s.style === 'ice');
  const objColor = new Map();
  for (const id of ['palisade']) objColor.set(data.objectIndex.get(id), M.woodwall);
  for (const id of ['town-wall']) objColor.set(data.objectIndex.get(id), M.stonewall);
  for (const id of ['house', 'temple', 'market']) objColor.set(data.objectIndex.get(id), M.building);
  for (const id of ['bridge-ew', 'bridge-ns']) objColor.set(data.objectIndex.get(id), M.woodwall);
  const nestObjects = new Set(
    data.objects
      .map((o, k) => [o, k])
      .filter(([o]) => !o.gather && !o.bridge && !objColor.has(data.objectIndex.get(o.id)))
      .map(([, k]) => k),
  );
  let cache = null;

  // 一格的顏色 [r, g, b]
  function cellColor(x, y) {
    if (!world.inside(x, y)) return rgb(M.void);
    const tier = world.tierAt(x, y);
    const o = world.objectAt(x, y);
    if (o >= 0 && objColor.has(o)) return rgb(objColor.get(o));
    // 聚落牆內：家具與井算建築，其餘（空地、路、室內）是村莊或城鎮的顏色；牆外保留的地形照下面的生態畫
    const s = world.settleAt?.(x, y);
    const code = s?.inside ? s.settle.layout.grid[y - s.settle.y0][x - s.settle.x0] : null;
    if (code && code !== 'keep') {
      if (o >= 0) return rgb(M.building);
      return rgb(data.settlements[s.settle.kind].id === 'town' ? M.town : M.village);
    }
    if (o >= 0 && nestObjects.has(o)) return rgb(M.relic);
    const w = world.waterAt(x, y);
    if (w >= 0 && !isIce[world.surfaceAt(x, y)]) return shade(waterKind[w], 2);
    if (isIce[world.surfaceAt(x, y)]) return shade(M.glacier, Math.min(4, tier));
    if (isMountain[world.landformAt(x, y)]) return shade(M.mountain, Math.min(4, tier - 3));
    return shade(biomeColor[world.biomeAt(x, y)], tier - 1);
  }

  // 這一頁看哪一塊：冒險者所在那一區為中心的 REGION.zones×REGION.zones 區
  function area(player) {
    const Z = world.zoneSize;
    const half = REGION.zones >> 1;
    const x0 = (Math.floor(player.x / Z) - half) * Z;
    const y0 = (Math.floor(player.y / Z) - half) * Z;
    return { x0, y0, n: REGION.zones * Z };
  }

  function baseImage(a, S, stamp) {
    const key = `${a.x0},${a.y0},${S},${stamp}`;
    if (cache?.key === key) return cache.canvas;
    const canvas = document.createElement('canvas');
    canvas.width = a.n * S;
    canvas.height = a.n * S;
    const g = canvas.getContext('2d');
    const img = g.createImageData(a.n, a.n);
    for (let j = 0; j < a.n; j++)
      for (let i = 0; i < a.n; i++) {
        const [r, gg, b] = cellColor(a.x0 + i, a.y0 + j);
        img.data.set([r, gg, b, 255], (j * a.n + i) * 4);
      }
    // 一格一像素畫好再整張放大（最近鄰，不糊）
    const small = document.createElement('canvas');
    small.width = a.n;
    small.height = a.n;
    small.getContext('2d').putImageData(img, 0, 0);
    g.imageSmoothingEnabled = false;
    g.drawImage(small, 0, 0, a.n * S, a.n * S);
    cache = { key, canvas };
    return canvas;
  }

  // 畫在大視窗的內容區。cam：主畫面左上角的世界格與看得到幾×幾格 { x, y, w, h }；stamp：紀錄筆數（變了才重畫地面）
  function draw(ctx, screen, body, panels, player, cam, stamp, caption) {
    const a = area(player);
    const S = Math.max(1, Math.floor(Math.min(body.w, body.h - screen.lineHeight * 2) / a.n));
    const ox = body.x;
    const oy = body.y;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(baseImage(a, S, stamp), ox, oy);
    const px = (x) => ox + (x - a.x0) * S + S / 2;
    const py = (y) => oy + (y - a.y0) * S + S / 2;
    const inArea = (x, y) => x >= a.x0 && y >= a.y0 && x < a.x0 + a.n && y < a.y0 + a.n;
    const dot = (x, y, color, size) => {
      if (!inArea(x, y)) return;
      ctx.fillStyle = color;
      ctx.fillRect(Math.round(px(x) - size / 2), Math.round(py(y) - size / 2), size, size);
    };
    const diamond = (x, y, color, r) => {
      if (!inArea(x, y)) return;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(px(x), py(y) - r);
      ctx.lineTo(px(x) + r, py(y));
      ctx.lineTo(px(x), py(y) + r);
      ctx.lineTo(px(x) - r, py(y));
      ctx.closePath();
      ctx.fill();
    };
    const big = Math.max(4, S + 2);
    const Z = world.zoneSize;
    const zones = [];
    for (let zy = a.y0 / Z; zy < (a.y0 + a.n) / Z; zy++)
      for (let zx = a.x0 / Z; zx < (a.x0 + a.n) / Z; zx++) zones.push([zx, zy]);

    // 礦坑（錨點）、寶箱、村民、怪物
    for (let j = 0; j < a.n; j += 1)
      for (let i = 0; i < a.n; i += 1) {
        const x = a.x0 + i;
        const y = a.y0 + j;
        const o = world.objectAt(x, y);
        if (o < 0 || !data.objects[o].layers) continue;
        const an = world.anchorAt(x, y);
        if (an.x === x && an.y === y) diamond(x + 1, y + 1, M.ore, big / 2 + 1);
      }
    const labels = [];
    for (const [zx, zy] of zones) {
      const n = world.nestOf(zx, zy);
      if (n) {
        if (!world.nestState(n.id).opened) dot(n.chest.x, n.chest.y, M.chest, Math.max(2, S));
        labels.push({
          text: data.nests[n.kind].name,
          x: n.x0 + n.w / 2,
          y: n.y0 + n.h,
          below: true,
          color: LABEL.nest,
        });
      }
      const s = world.settleOf(zx, zy);
      if (s) {
        const town = data.settlements[s.kind].id === 'town';
        labels.push({
          text: s.name,
          x: s.x0 + s.w / 2,
          y: s.y0,
          below: false,
          color: town ? LABEL.town : LABEL.village,
        });
      }
      for (const herd of world.herdsOf(zx, zy)) {
        if (data.species[herd.species].diet !== 'omnivore') continue;
        for (const id of world.liveMembers(herd)) {
          const c = world.creatureById(id);
          if (c) dot(c.member.x, c.member.y, M.mon, Math.max(3, S + 1));
        }
      }
    }
    for (const v of world.npcsNear?.(a.x0 + a.n / 2, a.y0 + a.n / 2, a.n) ?? [])
      dot(v.cells[0].x, v.cells[0].y, M.npc, Math.max(2, S));

    // 主畫面看得到的範圍、冒險者
    ctx.strokeStyle = M.view;
    ctx.lineWidth = 1;
    ctx.strokeRect(
      Math.round(ox + (cam.x - a.x0) * S) + 0.5,
      Math.round(oy + (cam.y - a.y0) * S) + 0.5,
      Math.round(cam.w * S) - 1,
      Math.round(cam.h * S) - 1,
    );
    ctx.fillStyle = '#000000';
    ctx.fillRect(Math.round(px(player.x) - big / 2 - 1), Math.round(py(player.y) - big / 2 - 1), big + 2, big + 2);
    dot(player.x, player.y, M.player, big);

    // 名字：聚落在上方、據點在下方；底下墊深色，壓在地形上也看得清；疊到先寫的就往下挪
    const lh = screen.lineHeight;
    const placed = [];
    for (const l of labels) {
      const w = panels.measure(l.text, screen) + screen.pad * 2;
      let lx = Math.round(ox + (l.x - a.x0) * S - w / 2);
      let ly = Math.round(oy + (l.y - a.y0) * S + (l.below ? screen.pad : -lh - screen.pad));
      for (let k = 0; k < 6 && placed.some((r) => Math.abs(r.x - lx) * 2 < r.w + w && Math.abs(r.y - ly) < lh); k++)
        ly += lh;
      lx = Math.max(ox, Math.min(lx, ox + a.n * S - w));
      ly = Math.max(oy, Math.min(ly, oy + a.n * S - lh));
      placed.push({ x: lx, y: ly, w });
      ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
      ctx.fillRect(lx, ly, w, lh);
      panels.text(ctx, screen, l.text, lx + screen.pad, ly, l.color);
    }
    panels.text(ctx, screen, caption, ox, oy + a.n * S + screen.pad);
  }

  return { draw, area };
}
