// 世界加上「現在的生物」：生物群照種子生成在落腳處（herds.js、world.js）；平常照時間在附近遊蕩（wander.js，不寫紀錄）；
// 打過的（戰鬥中的移動、受傷、倒下）記在遊戲狀態的 creatures（{ 生物 id: { x, y（錨點）, hp, dead } }），照狀態擺、不再遊蕩。
// 這裡把兩者疊上去，讓走路、尋路、查看、畫面看到同一個樣子。
// 生物 id 是「群 id＃第幾隻」，群 id 是「區 x,區 y:第幾群」

import { foeStats, regenHp } from './foes.js';
import { creatureCells } from './herds.js';
import { wanderAt } from './wander.js';

// 從生物 id 找回牠那一群
export function herdOf(world, id) {
  const herdId = id.split('#')[0];
  const [zx, zy] = herdId.split(':')[0].split(',').map(Number);
  return world.herdsOf(zx, zy).find((h) => h.id === herdId) ?? null;
}

// getCreatures()：狀態裡打過的生物；getClock()：{ time, hero }（現在的時間、冒險者站的格子）；
// getNests()：狀態裡的據點（world 是疊過據點的世界，nest-overlay.js）。
// 據點那一群（herd.nest）：出來幾隻看據點狀態的 size（沒有就照人口截），編號超過的當作不在；
// 遊蕩半徑照據點現在的範圍＋4。動物遊蕩時不走進據點的圖樣與範圍
export function withCreatures(world, data, getCreatures, getClock, getNests = () => null) {
  let builtFrom = null;
  let moved = new Map(); // 格子編號 → 打過、還活著的那一隻（照狀態擺）
  let clock = { time: -1, hx: 0, hy: 0 }; // 遊蕩的位置是照這個時間與冒險者位置算的
  const wandering = new Map(); // 區編號 → { cs, ns, cells: 格子編號 → 那一隻 }（這一區的群現在遊蕩到哪）
  const idx = (x, y) => y * world.width + x;

  // 這一群現在出來幾隻（據點那群看狀態，其他是全部）
  function herdSize(herd) {
    if (!herd.nest || !world.nestState) return herd.members.length;
    const s = world.nestState(herd.nest);
    return Math.min(herd.members.length, s.size ?? s.pop);
  }
  // 聚落的圖樣與範圍誰都不進去（安全區）；動物另外避開據點
  const inSettle = (x, y) => !!world.inSettleArea?.(x, y);
  const animalAvoid = (x, y) => inSettle(x, y) || !!world.inNestArea?.(x, y);
  function wanderOpts(herd, sp) {
    if (herd.nest && world.nestRange)
      return { radius: world.nestRange(world.nestById(herd.nest)) + 4, avoid: inSettle };
    if (sp.diet !== 'omnivore') return { avoid: animalAvoid };
    return { avoid: inSettle };
  }
  const memberOf = (id) => Number(id.split('#')[1]);

  // hp 是現在的生命：會再生的照上次受傷到現在的時間補回來（ch 是狀態裡那一隻，沒打過是 undefined）
  const info = (id, herd, member, ch) => {
    const sp = data.species[herd.species];
    const hp = ch ? regenHp(sp, foeStats(sp, herd.env).hp, ch.hp, ch.hurtAt, getClock().time) : null;
    return { id, herd, member, species: herd.species, cells: creatureCells(sp, member), hp };
  };

  let builtNests = null;
  function overlay() {
    const cs = getCreatures();
    const ns = getNests();
    if (cs !== builtFrom || ns !== builtNests) {
      builtFrom = cs;
      builtNests = ns;
      moved = new Map();
      for (const [id, ch] of Object.entries(cs)) {
        if (ch.dead) continue;
        const herd = herdOf(world, id);
        if (!herd || memberOf(id) >= herdSize(herd)) continue;
        const it = info(id, herd, { x: ch.x, y: ch.y }, ch);
        for (const c of it.cells) moved.set(idx(c.x, c.y), it);
      }
    }
    return cs;
  }

  // 時間或冒險者的位置變了，遊蕩的位置全部作廢
  function freshClock() {
    const { time, hero } = getClock();
    if (time !== clock.time || hero.x !== clock.hx || hero.y !== clock.hy) {
      clock = { time, hx: hero.x, hy: hero.y, hero };
      wandering.clear();
    }
  }

  // 一區的群現在遊蕩到哪（打過的生物變了也重算）
  function zoneMap(zx, zy, cs) {
    const zk = zy * world.zonesX + zx;
    const ns = getNests();
    let map = wandering.get(zk);
    if (map && map.cs === cs && map.ns === ns) return map.cells;
    map = { cs, ns, cells: new Map() };
    for (const herd of world.herdsOf(zx, zy)) {
      const sp = data.species[herd.species];
      const size = herdSize(herd);
      const opts = wanderOpts(herd, sp);
      herd.members.forEach((_, m) => {
        const id = `${herd.id}#${m}`;
        if (cs[id] || m >= size) return;
        const it = info(id, herd, wanderAt(world, sp, herd, m, clock.time, clock.hero, opts));
        for (const c of it.cells) map.cells.set(idx(c.x, c.y), it);
      });
    }
    wandering.set(zk, map);
    return map.cells;
  }

  // 遊蕩最遠會跨到隔壁區，所以看自己這一區與周圍八區的群
  function creatureAt(x, y) {
    const cs = overlay();
    if (!world.inside(x, y)) return null;
    const k = idx(x, y);
    const o = moved.get(k);
    if (o) return creatureById(o.id); // 重拿一次：會再生的生命跟著時間變

    freshClock();
    const zx = Math.floor(x / world.zoneSize);
    const zy = Math.floor(y / world.zoneSize);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const it = zoneMap(zx + dx, zy + dy, cs).get(k);
        if (it) return it;
      }
    return null;
  }

  function creatureById(id) {
    const ch = overlay()[id];
    if (ch?.dead) return null;
    const herd = herdOf(world, id);
    const m = memberOf(id);
    if (!herd || m >= herdSize(herd)) return null;
    if (ch) return info(id, herd, { x: ch.x, y: ch.y }, ch);
    const { time, hero } = getClock();
    const sp = data.species[herd.species];
    return info(id, herd, wanderAt(world, sp, herd, m, time, hero, wanderOpts(herd, sp)));
  }

  return {
    ...world,
    creatureAt,
    creatureById,
    // 一群裡還活著的每一隻（據點那群只算出來的那幾隻）
    liveMembers(herd) {
      const cs = overlay();
      const size = herdSize(herd);
      return herd.members.map((_, m) => `${herd.id}#${m}`).filter((id, m) => m < size && !cs[id]?.dead);
    },
    // (x, y) 附近 r 格內的區裡所有活著的生物：[{ id, cells }]（畫面比對誰動了用）
    creaturesNear(x, y, r) {
      const out = [];
      const z0x = Math.floor((x - r) / world.zoneSize);
      const z1x = Math.floor((x + r) / world.zoneSize);
      const z0y = Math.floor((y - r) / world.zoneSize);
      const z1y = Math.floor((y + r) / world.zoneSize);
      for (let zy = z0y; zy <= z1y; zy++)
        for (let zx = z0x; zx <= z1x; zx++)
          for (const herd of world.herdsOf(zx, zy))
            for (const id of this.liveMembers(herd)) {
              const it = creatureById(id);
              if (it) out.push({ id, cells: it.cells });
            }
      return out;
    },
    isPassable: (x, y) => world.groundPassable(x, y) && !creatureAt(x, y),
    cell(x, y) {
      const c = world.cell(x, y);
      return c && { ...c, creature: creatureAt(x, y) };
    },
  };
}
