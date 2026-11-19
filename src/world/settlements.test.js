import { expect, test } from 'vitest';
import { DATA } from '../data/load.js';
import { apply, newGame } from './game.js';
import { reachable, walkable } from './settle-layouts.js';
import { popTagIndex, SETTLE, settlementPlan } from './settlements.js';
import { residentsOf } from './villagers.js';

const game = newGame(20261112);
const world = game.world;
const home = world.startVillage;
const defOf = (s) => DATA.settlements[s.kind];

test('城鎮彼此相隔 6 區以上，起點那一區一定是村莊', () => {
  const plan = settlementPlan(7, 40, 40, () => true, { zx: 20, zy: 20 });
  const towns = [];
  let villages = 0;
  for (let zy = 0; zy < 40; zy++)
    for (let zx = 0; zx < 40; zx++) {
      if (plan(zx, zy) === 'town') towns.push({ zx, zy });
      if (plan(zx, zy) === 'village') villages++;
    }
  expect(plan(20, 20)).toBe('village');
  expect(towns.length).toBeGreaterThan(0);
  expect(villages).toBeGreaterThan(1600 * SETTLE.village * 0.7);
  for (const a of towns)
    for (const b of towns)
      if (a !== b) expect(Math.max(Math.abs(a.zx - b.zx), Math.abs(a.zy - b.zy))).toBeGreaterThanOrEqual(6);
});

test('冒險者從起點村莊的廣場出發，走得出村莊', () => {
  expect(home).toBeTruthy();
  const p = game.state.player;
  expect(world.settleAt(p.x, p.y)?.settle.id).toBe(home.id);
  // 從起點走（不穿過生物），走得到離圖樣 30 格外
  const seen = new Set([`${p.x},${p.y}`]);
  const queue = [p];
  let out = false;
  for (let q = 0; q < queue.length && !out && q < 60000; q++) {
    const c = queue[q];
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const n = { x: c.x + dx, y: c.y + dy };
        const k = `${n.x},${n.y}`;
        if (seen.has(k) || !world.groundPassable(n.x, n.y)) continue;
        seen.add(k);
        queue.push(n);
        const gx = Math.max(home.x0 - n.x, 0, n.x - (home.x0 + home.w - 1));
        const gy = Math.max(home.y0 - n.y, 0, n.y - (home.y0 + home.h - 1));
        if (Math.max(gx, gy) >= 30) out = true;
      }
  }
  expect(out).toBe(true);
}, 60000);

test('圖樣：從廣場走得到每一格能走的地方、每個出入口與每間民房的床', () => {
  const list = [home];
  let town = null;
  for (let zy = 30; zy < 66 && (list.length < 8 || !town); zy++)
    for (let zx = 30; zx < 66 && (list.length < 8 || !town); zx++) {
      const s = world.settleOf(zx, zy);
      if (!s || s === home) continue;
      if (defOf(s).id === 'town') town ??= s;
      else if (list.length < 8) list.push(s);
    }
  if (town) list.push(town);
  expect(list.some((s) => defOf(s).id === 'town')).toBe(true);
  for (const s of list) {
    const L = s.layout;
    const seen = reachable(L);
    for (let j = 0; j < L.h; j++)
      for (let i = 0; i < L.w; i++) if (walkable(L.grid[j][i])) expect(seen.has(`${i},${j}`)).toBe(true);
    expect(L.gates.length).toBeGreaterThanOrEqual(3);
    expect(L.homes.length).toBeGreaterThan(0);
    expect(L.homes.length).toBeLessThanOrEqual(defOf(s).houses[popTagIndex(s.pop0, defOf(s))]);
    for (const h of L.homes) expect(L.grid[h.bed.j][h.bed.i]).toBe('bed');
  }
}, 60000);

test('聚落是安全區：範圍裡沒有生物群的落腳處，冒險者在裡面', () => {
  const p = game.state.player;
  expect(world.inSettleArea(p.x, p.y)).toBe(true);
  for (const { herd } of world.herdsNear(p.x, p.y, 60))
    for (const m of herd.members) expect(world.inSettleArea(m.x, m.y)).toBe(false);
});

test('經濟：採光附近兩成資源點出現徵兆，四成經濟降一段', () => {
  const s = home;
  const e0 = world.settleEcon(s, {});
  expect(e0.total).toBeGreaterThan(10);
  expect(e0.sign).toBeNull();
  expect(e0.tag).toBe(Math.floor(defOf(s).econStart / 20));
  // 照 settle-overlay.js 數到的資源點，直接寫「採光了」的格子
  const keys = [];
  const R = SETTLE.sources;
  for (let y = s.y0 - R; y < s.y0 + s.h + R; y++)
    for (let x = s.x0 - R; x < s.x0 + s.w + R; x++) {
      const o = world.base.objectAt(x, y);
      if (o >= 0 && DATA.objects[o].gather?.action === 'pick') keys.push(`${x},${y}`);
    }
  const cellsFor = (n) => Object.fromEntries(keys.slice(0, n).map((k) => [k, { o: 0, picked: true }]));
  const at = (share) => world.settleEcon(s, cellsFor(Math.ceil(e0.total * share)));
  expect(at(0.2).sign).toContain('草藥');
  expect(at(0.2).tag).toBe(e0.tag);
  if (keys.length >= Math.ceil(e0.total * 0.4)) expect(at(0.4).tag).toBe(Math.max(0, e0.tag - 1));
});

test('村民：人數照人口標籤，站在圖樣裡能走的格子，擋路；貼著才能說話', () => {
  const s = home;
  const def = defOf(s);
  const people = residentsOf(world, DATA, s);
  const [lo, hi] = def.residents[popTagIndex(s.pop0, def)];
  expect(people.length).toBeGreaterThanOrEqual(lo);
  expect(people.length).toBeLessThanOrEqual(hi);
  const near = world.npcsNear(s.x0, s.y0, 5);
  expect(near.length).toBe(people.length);
  for (const v of near) {
    const c = v.cells[0];
    expect(walkable(s.layout.grid[c.y - s.y0][c.x - s.x0])).toBe(true);
    expect(world.isPassable(c.x, c.y)).toBe(false);
  }
  const v = near[0];
  const p = game.state.player;
  const far = Math.max(Math.abs(v.cells[0].x - p.x), Math.abs(v.cells[0].y - p.y)) > 1;
  if (far) expect(game.talk(v.id)).toBeNull();
});

test('據點對抗的對手是聚落時，紀錄裡寫好的聚落人口套進狀態', () => {
  const state = { ...game.state, nests: {}, settles: {} };
  const rec = { verb: 'nestroll', time: 5, data: { nest: '1,1', pop: 10, size: 3, settle: home.id, settlePop: 33 } };
  const next = apply(state, rec);
  expect(next.settles[home.id].pop).toBe(33);
  expect(world.settleTag(home)).toBeTruthy();
});
