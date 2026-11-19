import { beforeAll, describe, expect, test } from 'vitest';
import { DATA } from '../data/load.js';
import { describeRecord } from './describe.js';
import { loadGame, newGame } from './game.js';
import { CHEST, fortRows, LAYOUT_SIZE } from './nest-layouts.js';
import { gapToNest, NEST, rangeOf, tagOf } from './nests.js';

const SEED = 20261112;
const defOf = (n) => DATA.nests[n.kind];

// 讀檔時把起點換到 at，後面接上 extra 這幾筆紀錄（存檔只有種子＋紀錄）
function gameAt(at, extra = []) {
  const saved = structuredClone(newGame(SEED).serialize());
  saved.records[0].data.at = at;
  saved.records.push(...extra.map((r, i) => ({ id: i + 1, time: 0, actor: 'player', cause: null, ...r })));
  saved.checkpoint = null;
  return loadGame(saved);
}

// n 附近走得過去、離圖樣外緣剛好 d 格的一格
function spotOutside(world, n, d) {
  for (let x = n.x0 - d; x < n.x0 + n.w + d; x++)
    for (const y of [n.y0 - d, n.y0 + n.h - 1 + d]) if (world.isPassable(x, y)) return { x, y };
  return null;
}

let nests = [];
beforeAll(() => {
  const g = newGame(SEED);
  const p = g.state.player;
  nests = g.world.nestsNear(p.x, p.y, 400);
}, 60000);

describe('據點的圖樣', () => {
  test('廢棄的堡壘照舊版圖樣 39×25（更破爛），墓地、陰暗的沼澤是村莊的大小 29×19，都有一個寶箱', () => {
    const rows = fortRows();
    expect(rows).toHaveLength(25);
    for (const r of rows) expect([...r]).toHaveLength(39);
    expect(LAYOUT_SIZE).toEqual({ fort: { w: 39, h: 25 }, graveyard: { w: 29, h: 19 }, swamp: { w: 39, h: 25 } });
    for (const n of nests.slice(0, 6)) {
      expect(n.grid).toHaveLength(n.h);
      expect(n.grid.flat().filter((c) => c === CHEST)).toHaveLength(1);
    }
  });

  test('標籤每兩成一段、修正 −2～+2；範圍 2～20 格，人口 0 沒有範圍', () => {
    expect(tagOf(0, 90).name).toBe('殘存');
    expect(tagOf(45, 90)).toEqual({ name: '穩定', mod: 0 });
    expect(tagOf(90, 90)).toEqual({ name: '氾濫', mod: 2 });
    expect(rangeOf(0, 90)).toBe(0);
    expect(rangeOf(1, 90)).toBe(2);
    expect(rangeOf(90, 90)).toBe(20);
  });
});

describe('據點的放置', () => {
  test('起點附近有據點；每處整塊在自己那一區裡、離起點夠遠、彼此至少隔 64 格，住的怪物棲地符合', () => {
    const start = newGame(SEED).state.player;
    expect(nests.length).toBeGreaterThan(0);
    for (const n of nests) {
      const zs = 96;
      expect(Math.floor(n.x0 / zs)).toBe(n.zx);
      expect(Math.floor((n.x0 + n.w - 1) / zs)).toBe(n.zx);
      expect(Math.floor(n.y0 / zs)).toBe(n.zy);
      expect(Math.floor((n.y0 + n.h - 1) / zs)).toBe(n.zy);
      expect(gapToNest(n, start.x, start.y)).toBeGreaterThanOrEqual(NEST.startClear);
      for (const m of nests)
        if (m !== n) expect(Math.max(Math.abs(m.x0 - n.x0), Math.abs(m.y0 - n.y0))).toBeGreaterThanOrEqual(40);
    }
  });

  test('據點那群是住的怪物、站在圖樣外；動物的群離圖樣外緣至少 24 格', () => {
    const g = newGame(SEED);
    for (const n of nests.slice(0, 8)) {
      const herds = g.world.herdsOf(n.zx, n.zy);
      const mine = herds.find((h) => h.nest === n.id);
      expect(DATA.species[mine.species].id).toBe(defOf(n).species);
      for (const m of mine.members) expect(gapToNest(n, m.x, m.y)).toBeGreaterThanOrEqual(2);
      for (const h of herds.filter((x) => !x.nest))
        for (const m of h.members) expect(gapToNest(n, m.x, m.y)).toBeGreaterThanOrEqual(NEST.avoid);
    }
  });

  test('範圍裡的格子換色：墓地光禿的泥土；堡壘、沼澤保留原本的地形、只壓暗；查看寫據點名稱與標籤', () => {
    const g = newGame(SEED);
    for (const n of nests.slice(0, 6)) {
      const r = g.world.nestRange(n);
      const x = n.x0 - 1;
      const y = n.y0 + (n.h >> 1);
      if (r < 1 || g.world.waterAt(x, y) >= 0) continue;
      if (defOf(n).ground === 'dark') {
        expect(g.world.surfaceAt(x, y)).toBe(g.world.base.surfaceAt(x, y));
        expect(g.world.tintAt(x, y)).toBeLessThan(1);
      } else expect(DATA.surfaces[g.world.surfaceAt(x, y)].id).toBe('dirt');
      expect(g.world.cell(x, y).nest.nest.id).toBe(n.id);
    }
  }, 30000);
});

describe('據點跟著冒險者的動作變', () => {
  test('看到據點時擲一次 D12 對抗，隔不到 1 小時不再擲；人口照輸贏增減；存讀檔一樣', () => {
    const n = nests[0];
    const g = gameAt(spotOutside(newGame(SEED).world, n, 6));
    for (let i = 0; i < 6; i++) g.move(i % 2 ? 'n' : 's') ?? g.move(i % 2 ? 'e' : 'w');
    const rolls = g.log.all().filter((r) => r.verb === 'nestroll' && r.data.nest === n.id);
    expect(rolls).toHaveLength(1);
    const d = rolls[0].data;
    expect(d.win).toBe(d.roll + d.mod > d.opp + d.oppMod);
    const step = Math.round(defOf(n).popMax * NEST.share);
    expect(Math.abs(d.pop - d.before)).toBeLessThanOrEqual(step * 2);
    expect(g.state.nests[n.id].pop).toBe(d.pop);
    expect(describeRecord(rolls[0])).toMatch(/據點擲 \d+[+-]\d+＝\d+ 對 \d+[+-]\d+＝\d+/);
    const saved = structuredClone(g.serialize());
    expect(loadGame(saved)?.state).toEqual(g.state);
  }, 60000);

  test('外面那群全倒：記一筆清光；過 4,800 刻重生新的一群（舊的倒下紀錄清掉）', () => {
    const w0 = newGame(SEED).world;
    const n = nests.find((x) => w0.herdsOf(x.zx, x.zy).some((h) => h.nest === x.id));
    const herd = w0.herdsOf(n.zx, n.zy).find((h) => h.nest === n.id);
    const size = Math.min(herd.members.length, n.pop0);
    let pop = n.pop0;
    // 把外面那群一隻一隻打倒（冒險者的攻擊紀錄，套用時只看寫好的結果）
    const kills = herd.members.slice(0, size).map((m, i) => {
      pop -= 1;
      return {
        verb: 'attack',
        target: `${herd.id}#${i}`,
        data: { hit: true, damage: 99, hp: 0, duration: 9, at: m, nest: { id: n.id, pop } },
      };
    });
    const g = gameAt(spotOutside(w0, n, 30), kills);
    expect(g.world.liveMembers(herd)).toHaveLength(0);
    g.move('n') ?? g.move('s');
    expect(g.log.all().some((r) => r.verb === 'nestclear')).toBe(true);
    expect(g.state.nests[n.id].pop).toBe(n.pop0 - size);
    g.rest(); // 1 小時，超過重生的時間
    const spawn = g.log.all().find((r) => r.verb === 'nestspawn');
    expect(spawn).toBeTruthy();
    expect(Object.keys(g.state.creatures).some((id) => id.startsWith(`${herd.id}#`))).toBe(false);
    expect(g.world.liveMembers(herd).length).toBe(Math.min(herd.members.length, n.pop0 - size));
  }, 60000);

  test('寶箱：貼著按 Q 打開，擲 1D12＋標籤修正對表，東西進背包；開過就不能再開', () => {
    const w0 = newGame(SEED).world;
    const n = nests[0];
    const c = n.chest;
    let at = null;
    for (const [dx, dy] of [
      [0, 1],
      [0, -1],
      [1, 0],
      [-1, 0],
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1],
    ])
      if (!at && w0.isPassable(c.x + dx, c.y + dy)) at = { x: c.x + dx, y: c.y + dy };
    const g = gameAt(at);
    expect(g.sourceAt(c)?.chest).toBe(n.id);
    const rec = g.gather(c);
    expect(rec.verb).toBe('open');
    expect(rec.data.total).toBe(rec.data.roll + rec.data.mod);
    const got = Object.entries(rec.data.got);
    if (rec.data.item) expect(g.state.hero.items).toContain(rec.data.item);
    else for (const [m, k] of got) expect(g.state.bag[m]).toBe(k);
    expect(describeRecord(rec)).toMatch(/打開.+的寶箱：擲/);
    expect(g.sourceAt(c)).toBeNull();
    expect(g.gather(c)).toBeNull();
    expect(DATA.objects[g.world.objectAt(c.x, c.y)].id).toBe('nest-chest-open');
  }, 60000);
});
