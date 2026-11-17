// 世界加上「戰鬥後的生物」：生物群照種子生成（herds.js、world.js），戰鬥造成的移動、受傷、倒下記在遊戲狀態的
// creatures（{ 生物 id: { x, y（錨點）, hp, dead } }，只記動過的），這裡疊上去，讓走路、尋路、查看、畫面看到同一個樣子。
// 生物 id 是「群 id＃第幾隻」，群 id 是「區 x,區 y:第幾群」

import { cellKey } from './changes.js';
import { creatureCells } from './herds.js';

// 從生物 id 找回牠那一群
export function herdOf(world, id) {
  const herdId = id.split('#')[0];
  const [zx, zy] = herdId.split(':')[0].split(',').map(Number);
  return world.herdsOf(zx, zy).find((h) => h.id === herdId) ?? null;
}

export function withCreatures(world, data, getCreatures) {
  let builtFrom = null;
  let moved = new Map(); // 格子 → 動過、還活著的那一隻

  function infoOf(id, ch) {
    const herd = herdOf(world, id);
    if (!herd) return null;
    const m = Number(id.split('#')[1]);
    const member = ch ? { x: ch.x, y: ch.y } : herd.members[m];
    const sp = data.species[herd.species];
    return { id, herd, member, species: herd.species, cells: creatureCells(sp, member), hp: ch?.hp ?? null };
  }

  function overlay() {
    const cs = getCreatures();
    if (cs !== builtFrom) {
      builtFrom = cs;
      moved = new Map();
      for (const [id, ch] of Object.entries(cs)) {
        if (ch.dead) continue;
        const info = infoOf(id, ch);
        if (info) for (const c of info.cells) moved.set(cellKey(c.x, c.y), info);
      }
    }
    return cs;
  }

  function creatureAt(x, y) {
    const cs = overlay();
    const o = moved.get(cellKey(x, y));
    if (o) return o;
    const b = world.creatureAt(x, y);
    if (!b || cs[b.id]) return null; // 動過的不在原位（還活著的在 moved 裡）
    return { ...b, hp: null };
  }

  return {
    ...world,
    creatureAt,
    // 一隻生物現在的樣子；倒下了回傳 null
    creatureById(id) {
      const ch = overlay()[id];
      if (ch?.dead) return null;
      return infoOf(id, ch);
    },
    // 一群裡還活著的每一隻
    liveMembers(herd) {
      const cs = overlay();
      return herd.members.map((_, m) => `${herd.id}#${m}`).filter((id) => !cs[id]?.dead);
    },
    isPassable: (x, y) => world.groundPassable(x, y) && !creatureAt(x, y),
    cell(x, y) {
      const c = world.cell(x, y);
      return c && { ...c, creature: creatureAt(x, y) };
    },
  };
}
