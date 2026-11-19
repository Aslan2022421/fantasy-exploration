// 村民（階段 7，先只有對話）：人數照聚落現在的人口標籤；種族人類 70%、矮人 15%、精靈 15%；名字照種族從字表組。
// 每人有一張床（照民房的順序分），位置由「種子＋這個人＋現在的時間」算出來，不寫紀錄、不進存檔：
// 每隔一段時間換一個去處，偶數段回家（小屋站在門內旁邊、大房子站在自己的床上）、奇數段到室外的路或空地，
// 照走一格 9 刻沿著圖樣裡的最短路走過去。
// 村民擋路；冒險者站的格子村民不會走上去

import { hash01 } from './noise.js';
import { walkable } from './settle-layouts.js';
import { popTagIndex } from './settlements.js';

export const VILLAGER = { period: [240, 720], moveTicks: 9 };
const RACES = [
  ['human', 0.7],
  ['dwarf', 0.85],
  ['elf', 1],
];

// 一個聚落現在住的人：[{ id, name, race, home（民房編號）}]
export function residentsOf(world, data, s) {
  const def = data.settlements[s.kind];
  const homes = s.layout.homes;
  if (!homes.length) return [];
  const tag = popTagIndex(world.settleState?.(s.id).pop ?? s.pop0, def);
  const [lo, hi] = def.residents[tag];
  const n = lo + Math.floor(hash01(world.seed, s.x0, s.y0, 9400 + tag) * (hi - lo + 1));
  // 床位：照民房的順序一張一張分（大房子住 2～3 人）；床不夠時從頭再分
  const beds = homes.flatMap((h, home) => h.beds.map((_, bed) => ({ home, bed })));
  const out = [];
  for (let i = 0; i < n; i++) {
    const r = hash01(world.seed, s.x0 + i, s.y0, 9410);
    const race = RACES.find(([, p]) => r < p)[0];
    const parts = data.races[data.raceIndex.get(race)]?.villager?.names ?? [['無'], ['名']];
    const a = parts[0][Math.floor(hash01(world.seed, s.x0 + i, s.y0, 9411) * parts[0].length)];
    const b = parts[1][Math.floor(hash01(world.seed, s.x0 + i, s.y0, 9412) * parts[1].length)];
    out.push({ id: `${s.id}#${i}`, i, name: `${a}${b}`, race, ...beds[i % beds.length] });
  }
  return out;
}

// 圖樣裡兩格之間的最短路（八方向，只走 walkable 的格子）：回傳不含起點的每一步 { i, j }；走不到回傳 []
function pathIn(layout, from, to) {
  const key = (c) => `${c.i},${c.j}`;
  const came = new Map([[key(from), null]]);
  const queue = [from];
  for (let q = 0; q < queue.length; q++) {
    const c = queue[q];
    if (c.i === to.i && c.j === to.j) {
      const out = [];
      for (let p = c; p && key(p) !== key(from); p = came.get(key(p))) out.push(p);
      return out.reverse();
    }
    for (let dj = -1; dj <= 1; dj++)
      for (let di = -1; di <= 1; di++) {
        const n = { i: c.i + di, j: c.j + dj };
        if (n.i < 0 || n.j < 0 || n.i >= layout.w || n.j >= layout.h || came.has(key(n))) continue;
        if (!walkable(layout.grid[n.j][n.i])) continue;
        came.set(key(n), c);
        queue.push(n);
      }
  }
  return [];
}

// 室外能站的格子（路與空地），第一次用到才列
const outdoorCache = new WeakMap();
function outdoors(layout) {
  let list = outdoorCache.get(layout);
  if (!list) {
    list = [];
    for (let j = 1; j < layout.h - 1; j++)
      for (let i = 1; i < layout.w - 1; i++) if (['road', 'ground'].includes(layout.grid[j][i])) list.push({ i, j });
    outdoorCache.set(layout, list);
  }
  return list;
}

// 第 k 段要去哪（圖樣裡的座標）
function spotOf(seed, s, v, k) {
  // 在家：小屋站在門內旁邊那一格，大房子站在自己的床上（舊版）
  const home = s.layout.homes[v.home];
  if (k % 2 === 0) return home.spot ?? home.beds[v.bed];
  const list = outdoors(s.layout);
  return list[Math.floor(hash01(seed, s.x0 + v.i, s.y0 + k, 9420) * list.length)];
}

// 這個人在 time 時站在哪（世界座標）；hero 是冒險者站的格子
export function villagerAt(seed, s, v, time, hero) {
  const [lo, hi] = VILLAGER.period;
  const period = lo + Math.floor(hash01(seed, s.x0 + v.i, s.y0, 9421) * (hi - lo + 1));
  const phase = Math.floor(hash01(seed, s.x0 + v.i, s.y0, 9422) * period);
  const t = Math.max(0, time) + phase;
  const k = Math.floor(t / period);
  const from = spotOf(seed, s, v, k - 1);
  const to = spotOf(seed, s, v, k);
  const steps = pathIn(s.layout, from, to);
  const n = Math.min(steps.length, Math.floor((t - k * period) / VILLAGER.moveTicks));
  const world = (c) => ({ x: s.x0 + c.i, y: s.y0 + c.j });
  const isHero = (c) => hero && s.x0 + c.i === hero.x && s.y0 + c.j === hero.y;
  for (const c of [n ? steps[n - 1] : from, n > 1 ? steps[n - 2] : from, from, steps[n], to])
    if (c && !isHero(c)) return world(c);
  return world(from);
}

// 世界加上村民：npcAt(x, y)、npcById(id)、npcsNear(x, y, r)；村民擋路。
// getClock()：{ time, hero }（現在的時間、冒險者站的格子）
export function withVillagers(world, data, getClock) {
  let clock = { time: -1, hx: 0, hy: 0 };
  const placed = new Map(); // 聚落 id → { cells: "x,y" → 村民, list }
  const fresh = () => {
    const { time, hero } = getClock();
    if (time !== clock.time || hero.x !== clock.hx || hero.y !== clock.hy) {
      clock = { time, hx: hero.x, hy: hero.y, hero };
      placed.clear();
    }
  };
  function peopleOf(s) {
    fresh();
    let p = placed.get(s.id);
    if (!p) {
      p = { cells: new Map(), list: [] };
      for (const v of residentsOf(world, data, s)) {
        const at = villagerAt(world.seed, s, v, clock.time, clock.hero);
        const it = { npc: true, id: `npc:${v.id}`, villager: v, settle: s, member: at, cells: [at] };
        p.list.push(it);
        if (!p.cells.has(`${at.x},${at.y}`)) p.cells.set(`${at.x},${at.y}`, it);
      }
      placed.set(s.id, p);
    }
    return p;
  }
  function npcAt(x, y) {
    const at = world.settleAt?.(x, y);
    if (!at?.inside) return null;
    return peopleOf(at.settle).cells.get(`${x},${y}`) ?? null;
  }
  function npcById(id) {
    const [sid] = id.slice(4).split('#');
    const s = world.settleById(sid);
    return s ? (peopleOf(s).list.find((it) => it.id === id) ?? null) : null;
  }
  return {
    ...world,
    npcAt,
    npcById,
    // (x, y) 附近 r 格內的村民：[{ id, cells }]（畫面比對誰動了用）
    npcsNear(x, y, r) {
      const out = [];
      for (const s of world.settlesNear(x, y, r))
        for (const it of peopleOf(s).list) out.push({ id: it.id, cells: it.cells });
      return out;
    },
    isPassable: (x, y) => world.isPassable(x, y) && !npcAt(x, y),
    cell(x, y) {
      const c = world.cell(x, y);
      return c && { ...c, npc: npcAt(x, y) };
    },
  };
}
