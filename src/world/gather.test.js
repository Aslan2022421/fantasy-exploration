import { RNG } from 'rot-js';
import { beforeAll, describe, expect, test } from 'vitest';
import { DATA } from '../data/load.js';
import { CHECKPOINT_EVERY, loadGame, newGame } from './game.js';
import { capFactor, envAt, readComposition, weightsFor } from './gather.js';
import { findPathNextTo, stepDirection } from './path.js';

const SEED = 20261112;
const O = (id) => DATA.objectIndex.get(id);
const def = (id) => DATA.objects[O(id)].gather;
const rng = (s) => RNG.clone().setSeed(s);
const TREES = DATA.objects.filter((o) => o.trunk).map((o) => o.id); // 各樹種

// 從冒險者往外一圈一圈找最近一處能採的 id（id 可以是一串，任一種都算；給 test 判斷的條件）
function nearest(game, id, test = () => true) {
  const p = game.state.player;
  const want = new Set([id].flat().map(O));
  for (let r = 1; r < 400; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const at = { x: p.x + dx, y: p.y + dy };
        if (!want.has(game.world.objectAt(at.x, at.y))) continue;
        const src = game.sourceAt(at);
        if (src && test(src) && findPathNextTo(game.world, p, src)) return src;
      }
    }
  }
  return null;
}

function walkNextTo(game, src) {
  for (const step of findPathNextTo(game.world, game.state.player, src))
    expect(game.move(stepDirection(game.state.player, step))).not.toBeNull();
}

describe('上限與組成', () => {
  test('上限係數：沒有時是 1，一半時是 1/4，到上限是 0', () => {
    expect(capFactor(0, 40)).toBe(1);
    expect(capFactor(20, 40)).toBe(0.25);
    expect(capFactor(40, 40)).toBe(0);
    expect(capFactor(55, 40)).toBe(0);
  });

  test('產出權重照環境加總：生態不符的列不算，高度層不夠的列不算', () => {
    const vein = def('vein');
    expect(weightsFor(vein, { biome: 'taiga', tier: 3 })).toEqual({ stone: 20, 'ice-crystal': 30, 'iron-ore': 25 });
    expect(weightsFor(vein, { biome: 'desert', tier: 9 })).toEqual({
      stone: 20,
      'copper-ore': 30,
      quartz: 50,
      'gold-ore': 8,
    });
  });

  test('地理條件：幾格內有河或湖、高度層範圍、在不在山地；沒寫的條件不限', () => {
    const vein = def('vein');
    const base = { biome: 'taiga', tier: 3, mountain: true };
    expect(weightsFor(vein, { ...base, waterDist: 2 })['gold-ore']).toBe(6); // 河邊的礦脈有砂金
    expect(weightsFor(vein, { ...base, waterDist: 4 })['gold-ore']).toBeUndefined();
    const toy = {
      yields: [
        { maxTier: 2, weights: { stone: 1 } },
        { mountain: false, weights: { quartz: 1 } },
      ],
    };
    expect(weightsFor(toy, { tier: 2, mountain: false })).toEqual({ stone: 1, quartz: 1 });
    expect(weightsFor(toy, { tier: 3, mountain: true })).toEqual({});
  });

  test('讀組成：抽幾種照 kinds、不重複；到上限的材料讀不出來', () => {
    const vein = def('vein');
    for (let s = 0; s < 50; s++) {
      const comp = readComposition(vein, { biome: 'taiga', tier: 3 }, DATA, {}, rng(s));
      const n = Object.keys(comp).length;
      expect(n).toBeGreaterThanOrEqual(2);
      expect(n).toBeLessThanOrEqual(3);
      const capped = readComposition(vein, { biome: 'taiga', tier: 3 }, DATA, { 'ice-crystal': 20 }, rng(s));
      expect(capped['ice-crystal']).toBeUndefined();
    }
  });
});

describe('在世界裡採', () => {
  beforeAll(() => newGame(SEED), 30000);

  test('砍樹：一次砍倒，樹幹變成能走的樹樁、整棵樹冠消失，木頭看樹種', () => {
    const g = newGame(SEED);
    const src = nearest(g, TREES);
    const species = DATA.objects[src.object];
    const canopy = [];
    for (let dy = -3; dy <= 3; dy++)
      for (let dx = -3; dx <= 3; dx++) {
        const a = g.world.anchorAt(src.x + dx, src.y + dy);
        const t = g.world.anchorAt(src.x, src.y);
        if (a && a.x === t.x && a.y === t.y && !(dx === 0 && dy === 0)) canopy.push({ x: src.x + dx, y: src.y + dy });
      }
    expect(g.world.isPassable(src.x, src.y)).toBe(false);
    walkNextTo(g, src);
    const rec = g.gather(src);
    expect(rec.data.action).toBe('chop');
    expect(rec.data.done).toBe('stump');
    expect(g.world.objectAt(src.x, src.y)).toBe(O('stump'));
    expect(g.world.isPassable(src.x, src.y)).toBe(true);
    for (const c of canopy) expect(g.world.objectAt(c.x, c.y)).toBe(-1);
    const wood = species.gather.yields[0].weights;
    expect(Object.keys(g.state.bag)).toEqual(Object.keys(wood));
    expect(g.state.time).toBe(rec.time + 6);
  });

  test('挖岩壁：挖兩次才穿，穿了變成能走的碎石坑；組成第一次讀出來後固定', () => {
    const g = newGame(SEED);
    const src = nearest(g, 'rock-wall');
    walkNextTo(g, src);
    const first = g.gather(src);
    expect(first.data.read).not.toBeNull();
    expect(first.data.done).toBeNull();
    expect(g.world.isPassable(src.x, src.y)).toBe(false);
    const second = g.gather(src);
    expect(second.data.read).toBeNull();
    expect(second.data.done).toBe('pit');
    expect(g.world.objectAt(src.x, src.y)).toBe(O('pit'));
    expect(g.world.isPassable(src.x, src.y)).toBe(true);
    expect(g.gather(src)).toBeNull(); // 碎石坑不能再挖
  });

  test('來源的環境：離河或湖的距離照八方向一圈一圈量，超過產出表用到的最遠距離算 Infinity', () => {
    const g = newGame(SEED);
    const src = nearest(g, 'vein');
    const env = envAt(g.world, DATA, src.def, src.x, src.y);
    expect(env.biome).toBe(DATA.biomes[g.world.biomeAt(src.x, src.y)].id);
    let d = Number.POSITIVE_INFINITY;
    for (let dy = -3; dy <= 3; dy++)
      for (let dx = -3; dx <= 3; dx++) {
        const w = g.world.waterAt(src.x + dx, src.y + dy);
        if (w >= 0 && DATA.waters[w].style !== 'swamp') d = Math.min(d, Math.max(Math.abs(dx), Math.abs(dy)));
      }
    expect(env.waterDist).toBe(d);
  });

  test('採矮叢：採過的留在原地、不能再採；不在旁邊不能採', () => {
    const g = newGame(SEED);
    const src = nearest(g, 'shrub');
    if (Math.max(Math.abs(src.x - g.state.player.x), Math.abs(src.y - g.state.player.y)) > 1)
      expect(g.gather(src)).toBeNull();
    walkNextTo(g, src);
    const rec = g.gather(src);
    expect(rec.data.action).toBe('pick');
    expect(rec.data.done).toBe('picked');
    expect(g.world.objectAt(src.x, src.y)).toBe(O('shrub'));
    expect(g.world.changeAt(src.x, src.y).picked).toBe(true);
    expect(g.sourceAt(src)).toBeNull();
  });

  test('採集寫進紀錄：存讀檔、從檢查點重放、從頭重放，狀態都一樣；同樣的操作兩次結果一樣', () => {
    const play = () => {
      const g = newGame(SEED);
      for (const id of ['rock-wall', 'shrub', TREES]) {
        const src = nearest(g, id);
        if (!src) continue;
        walkNextTo(g, src);
        while (g.gather(src));
      }
      // 來回走到跨過檢查點
      for (let i = 0; g.log.size <= CHECKPOINT_EVERY + 5 && i < 1000; i++) g.move(['e', 'w', 'n', 's'][i % 4]);
      return g;
    };
    const g = play();
    expect(g.log.size).toBeGreaterThan(CHECKPOINT_EVERY); // 跨過檢查點
    expect(Object.keys(g.state.bag).length).toBeGreaterThan(0);
    const saved = structuredClone(g.serialize());
    const a = loadGame(saved);
    const b = loadGame(saved, { fromCheckpoint: false });
    expect(a.state).toEqual(g.state);
    expect(b.state).toEqual(g.state);
    expect(play().log.all()).toEqual(g.log.all());
  });
});
