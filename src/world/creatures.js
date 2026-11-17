// 世界加上「現在的生物」：生物群照種子生成在落腳處（herds.js、world.js）；平常照時間在附近遊蕩（wander.js，不寫紀錄）；
// 打過的（戰鬥中的移動、受傷、倒下）記在遊戲狀態的 creatures（{ 生物 id: { x, y（錨點）, hp, dead } }），照狀態擺、不再遊蕩。
// 這裡把兩者疊上去，讓走路、尋路、查看、畫面看到同一個樣子。
// 生物 id 是「群 id＃第幾隻」，群 id 是「區 x,區 y:第幾群」

import { creatureCells } from './herds.js';
import { wanderAt } from './wander.js';

// 從生物 id 找回牠那一群
export function herdOf(world, id) {
  const herdId = id.split('#')[0];
  const [zx, zy] = herdId.split(':')[0].split(',').map(Number);
  return world.herdsOf(zx, zy).find((h) => h.id === herdId) ?? null;
}

// getCreatures()：狀態裡打過的生物；getClock()：{ time, hero }（現在的時間、冒險者站的格子）
export function withCreatures(world, data, getCreatures, getClock) {
  let builtFrom = null;
  let moved = new Map(); // 格子編號 → 打過、還活著的那一隻（照狀態擺）
  let clock = { time: -1, hx: 0, hy: 0 }; // 遊蕩的位置是照這個時間與冒險者位置算的
  const wandering = new Map(); // 區編號 → { cs, cells: 格子編號 → 那一隻 }（這一區的群現在遊蕩到哪）
  const idx = (x, y) => y * world.width + x;

  const info = (id, herd, member, hp) => ({
    id,
    herd,
    member,
    species: herd.species,
    cells: creatureCells(data.species[herd.species], member),
    hp,
  });

  function overlay() {
    const cs = getCreatures();
    if (cs !== builtFrom) {
      builtFrom = cs;
      moved = new Map();
      for (const [id, ch] of Object.entries(cs)) {
        if (ch.dead) continue;
        const herd = herdOf(world, id);
        if (!herd) continue;
        const it = info(id, herd, { x: ch.x, y: ch.y }, ch.hp);
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
    let map = wandering.get(zk);
    if (map && map.cs === cs) return map.cells;
    map = { cs, cells: new Map() };
    for (const herd of world.herdsOf(zx, zy)) {
      const sp = data.species[herd.species];
      herd.members.forEach((_, m) => {
        const id = `${herd.id}#${m}`;
        if (cs[id]) return;
        const it = info(id, herd, wanderAt(world, sp, herd, m, clock.time, clock.hero), null);
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
    if (o) return o;
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
    if (!herd) return null;
    if (ch) return info(id, herd, { x: ch.x, y: ch.y }, ch.hp);
    const { time, hero } = getClock();
    const m = Number(id.split('#')[1]);
    return info(id, herd, wanderAt(world, data.species[herd.species], herd, m, time, hero), null);
  }

  return {
    ...world,
    creatureAt,
    creatureById,
    // 一群裡還活著的每一隻
    liveMembers(herd) {
      const cs = overlay();
      return herd.members.map((_, m) => `${herd.id}#${m}`).filter((id) => !cs[id]?.dead);
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
