import { expect, test } from 'vitest';
import { DATA } from '../data/load.js';
import { buildFort, FORT_ROWS } from './fort-layouts.js';
import { newGame } from './game.js';
import { reachable, walkable } from './settle-layouts.js';

const def = (id) => DATA.settlements.find((d) => d.id === id);

test('堡壘、要塞的圖樣：照舊版 45×29、45×58；兩個城門朝外；轉 90 度寬高對調；從廣場走得到每一格能走的地方', () => {
  expect(FORT_ROWS.fort).toHaveLength(29);
  expect(FORT_ROWS.fortress).toHaveLength(58);
  for (const rows of Object.values(FORT_ROWS)) for (const r of rows) expect([...r]).toHaveLength(45);
  for (const id of ['fort', 'fortress'])
    for (const turn of [false, true]) {
      const L = buildFort(def(id), turn);
      expect([L.w, L.h]).toEqual(turn ? [FORT_ROWS[id].length, 45] : [45, FORT_ROWS[id].length]);
      expect(L.gates).toHaveLength(2);
      for (const g of L.gates) {
        const outside = g.out.i < 0 || g.out.j < 0 || g.out.i >= L.w || g.out.j >= L.h;
        expect(outside).toBe(true);
      }
      const beds = L.homes.reduce((n, h) => n + h.beds.length, 0);
      expect(beds).toBe(id === 'fort' ? 10 : 20);
      const seen = reachable(L);
      for (let j = 0; j < L.h; j++)
        for (let i = 0; i < L.w; i++)
          if (walkable(L.grid[j][i])) expect(seen.has(`${i},${j}`), `${id} ${i},${j}`).toBe(true);
    }
});

test('兩翼的山壁：沿著跟路垂直的方向往外拉，碰到水就停', () => {
  const L = buildFort(def('fort'), false, { before: 10, after: 6, wet: (i) => i === 3 });
  expect(L.w).toBe(45 + 16);
  const mid = L.grid[29 >> 1];
  expect(mid.slice(4, 10).every((c) => c === 'rampart-rock')).toBe(true);
  expect(mid[3]).toBe('keep');
  expect(mid.slice(55).every((c) => c === 'rampart-rock')).toBe(true);
});

test('世界上的堡壘、要塞放在隘口：城門外接著路', () => {
  const world = newGame(20261112).world.base;
  const road = DATA.surfaceIndex.get('road');
  const home = world.geography.start;
  let best = null;
  for (let zy = 0; zy < world.zonesY; zy++)
    for (let zx = 0; zx < world.zonesX; zx++) {
      const k = world.settlementKind(zx, zy);
      if (k !== 'fort' && k !== 'fortress') continue;
      const d = Math.hypot(zx * 96 - home.x, zy * 96 - home.y);
      if (!best || d < best.d) best = { zx, zy, d };
    }
  expect(best).toBeTruthy();
  const s = world.settleOf(best.zx, best.zy);
  expect(DATA.settlements[s.kind].layout).toBeTruthy();
  for (const g of s.layout.gates) {
    const x = s.x0 + g.out.i;
    const y = s.y0 + g.out.j;
    const o = world.objectAt(x, y);
    expect(world.surfaceAt(x, y) === road || (o >= 0 && DATA.objects[o].bridge)).toBe(true);
  }
}, 60000);
