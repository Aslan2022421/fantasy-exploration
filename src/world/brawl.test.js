import { beforeAll, describe, expect, test } from 'vitest';
import { DATA } from '../data/load.js';
import { gapBetween } from './chase.js';
import { describeRecord } from './describe.js';
import { regenHp } from './foes.js';
import { loadGame, newGame } from './game.js';
import { HERD } from './herds.js';

const SEED = 20261112;
const sp = (id) => DATA.species[DATA.speciesIndex.get(id)];

// 起點附近的混食怪物群（據點那群），旁邊（落腳處 40 格內）有別種生物的
function monsterPairs(world, at, r = 400) {
  const herds = world.herdsNear(at.x, at.y, r);
  const out = [];
  for (const m of herds) {
    if (DATA.species[m.herd.species].diet !== 'omnivore') continue;
    const home = m.herd.members[0];
    for (const o of world.herdsNear(home.x, home.y, 40)) {
      if (o.herd.species === m.herd.species) continue;
      out.push({ monster: m.herd, other: o.herd });
    }
  }
  return out;
}

// 讀檔時把起點換到 at（存檔只有種子＋紀錄，起點寫在第一筆）
function gameAt(at) {
  const saved = structuredClone(newGame(SEED).serialize());
  saved.records[0].data.at = at;
  return loadGame(saved);
}

// 冒險者附近、走得過去、離 home 剛好 d 格的一格
function spotNear(game, home, d) {
  for (let dy = -d; dy <= d; dy++)
    for (let dx = -d; dx <= d; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== d) continue;
      const p = { x: home.x + dx, y: home.y + dy };
      if (game.world.isPassable(p.x, p.y)) return p;
    }
  return null;
}

describe('怪物（混食）', () => {
  beforeAll(() => newGame(SEED), 30000);

  test('三種怪物都在資料裡，都是混食；巨魔會再生', () => {
    for (const id of ['goblin', 'skeleton', 'troll']) expect(sp(id).diet).toBe('omnivore');
    expect(sp('troll').traits).toEqual([{ id: 'regenerate', amount: 3, every: 24 }]);
    expect(HERD.omnivores).toBeUndefined(); // 怪物只從據點出來
  });

  test('巨魔受傷後每 24 刻回 3 生命，回到滿為止；沒受過傷、倒下的不回', () => {
    const t = sp('troll');
    expect(regenHp(t, 50, 20, 100, 100)).toBe(20);
    expect(regenHp(t, 50, 20, 100, 123)).toBe(20);
    expect(regenHp(t, 50, 20, 100, 124)).toBe(23);
    expect(regenHp(t, 50, 20, 100, 100 + 24 * 50)).toBe(50);
    expect(regenHp(t, 50, 0, 100, 1000)).toBe(0);
    expect(regenHp(t, 50, null, null, 1000)).toBe(null);
    expect(regenHp(sp('wolf'), 15, 5, 0, 1000)).toBe(5);
  });

  test('世界裡有混食的怪物群，都是據點的那群', () => {
    const g = newGame(SEED);
    const p = g.state.player;
    const monsters = g.world.herdsNear(p.x, p.y, 600).filter((h) => DATA.species[h.herd.species].diet === 'omnivore');
    expect(monsters.length).toBeGreaterThan(0);
    for (const h of monsters) expect(h.herd.nest).toBeTruthy();
  }, 60000);

  test('冒險者看得到時，怪物撲向別種生物、寫進紀錄；存讀檔結果一樣', () => {
    const g0 = newGame(SEED);
    const pairs = monsterPairs(g0.world, g0.state.player);
    expect(pairs.length).toBeGreaterThan(0);
    let tested = false;
    // 動物會避開據點，怪物碰上動物要等兩邊都遊蕩到彼此附近：挑兩群落腳處最近的先試
    const gap = ({ monster, other }) =>
      Math.max(
        Math.abs(monster.members[0].x - other.members[0].x),
        Math.abs(monster.members[0].y - other.members[0].y),
      );
    pairs.sort((a, b) => gap(a) - gap(b));
    for (const { monster, other } of pairs.slice(0, 12)) {
      const mid = {
        x: (monster.members[0].x + other.members[0].x) >> 1,
        y: (monster.members[0].y + other.members[0].y) >> 1,
      };
      const at = spotNear(g0, mid, 6) ?? spotNear(g0, mid, 9);
      if (!at) continue;
      const g = gameAt(at);
      if (!g) continue;
      // 冒險者在兩群中間來回走，讓時間往前、兩邊遊蕩到彼此附近
      for (let i = 0; i < 160; i++) {
        const dir = i % 2 ? 'n' : 's';
        if (!g.move(dir)) g.move(i % 2 ? 'e' : 'w');
        if (g.log.all().some((r) => r.verb === 'attack' && r.data?.victim)) break;
      }
      const hit = g.log.all().find((r) => r.verb === 'attack' && r.data?.victim);
      if (!hit) continue;
      const engage = g.log.all().find((r) => r.verb === 'engage' && r.data.brawl);
      expect(engage).toBeTruthy();
      expect(describeRecord(engage)).toMatch(/撲向/);
      expect(describeRecord(hit)).toMatch(/擲 \d+[+-]\d+＝\d+ 對防禦 \d+/);
      expect(sp(hit.data.species).diet).toBe('omnivore');
      expect(hit.data.victim).not.toBe(hit.data.species);
      expect(g.state.creatures[hit.target].hurtAt).toBe(hit.time);
      const saved = structuredClone(g.serialize());
      expect(loadGame(saved)?.state).toEqual(g.state);
      expect(loadGame(saved, { fromCheckpoint: false })?.state).toEqual(g.state);
      tested = true;
      expect(other).toBeTruthy();
      break;
    }
    expect(tested).toBe(true);
  }, 120000);

  test('冒險者看不到的地方不打：離怪物很遠時，怪物不會撲向別種生物', () => {
    const g0 = newGame(SEED);
    const [{ monster }] = monsterPairs(g0.world, g0.state.player);
    const at = spotNear(g0, monster.members[0], 40);
    const g = gameAt(at);
    for (let i = 0; i < 10; i++) g.move(i % 2 ? 'n' : 's');
    for (const r of g.log.all().filter((x) => x.verb === 'engage' && x.data.brawl)) {
      const f = r.data.foes[0];
      expect(gapBetween([{ x: f.x, y: f.y }], [g.state.player])).toBeLessThanOrEqual(24);
    }
  }, 60000);
});
