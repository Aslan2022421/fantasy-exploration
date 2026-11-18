// 據點跟著冒險者的動作變（見 design/PLAN.md「據點」）。冒險者每做完一個動作看一次附近的據點：
// - 外面那群全倒了：記一筆清光（人口在每隻倒下時已經扣過，標籤跟著換）
// - 清光後過了 NEST.respawn 刻、人口還沒用完：重生新的一群（舊的倒下紀錄清掉）
// - 看得到據點（圖樣任一格）、離上次擲隔了 NEST.rollEvery 刻：擲一次 D12 對抗（暫定：看到時才結算，加入劇情戰役時要再改）
//   據點 1D12＋標籤修正 對 世界系統 1D12＋NEST.worldMod，平手算世界系統贏；贏輸增減人口上限的 NEST.share，自然 12 加倍
// 寶箱：第一次打開才擲 1D12＋標籤修正，對據點資料的寶箱表
// 結果都先算好再寫成紀錄（狀態怎麼改在 nest-apply.js），骰子用「主種子＋紀錄編號」開

import { PART_TRUNK } from './footprint.js';
import { visibleFrom } from './fov.js';
import { NEST, nestArea, tagOf } from './nests.js';
import { d12 } from './rules.js';

export const OPEN_TICKS = 18; // 打開寶箱花幾刻
const WATCH = 48; // 冒險者幾格內的據點才看清光與重生

// env：{ world, data, state()（現在的狀態）, record(entry), dice(tag) }
export function createNestWatch(env) {
  const { world, data } = env;
  const st = () => env.state();
  const defOf = (n) => data.nests[n.kind];
  const herdOf = (n) => world.herdsOf(n.zx, n.zy).find((h) => h.nest === n.id) ?? null;
  const center = (n) => ({ x: n.x0 + (n.w >> 1), y: n.y0 + (n.h >> 1) });
  const area = nestArea; // 據點範圍可能變的區塊（畫面丟快取用）

  function cleared(n, s, cause) {
    const herd = herdOf(n);
    if (!herd || s.clearedAt != null || s.pop <= 0 || world.liveMembers(herd).length) return;
    // 一隻都沒出來過（人口 0、還沒生）不算清光
    if (!Object.keys(st().creatures).some((id) => id.startsWith(`${herd.id}#`))) return;
    env.record({ verb: 'nestclear', target: center(n), data: { nest: n.id, kind: defOf(n).id, area: area(n) }, cause });
  }

  function respawn(n, s, cause) {
    const herd = herdOf(n);
    if (!herd) return;
    const size = Math.min(herd.members.length, s.pop);
    env.record({
      verb: 'nestspawn',
      target: center(n),
      data: { nest: n.id, herd: herd.id, size, kind: defOf(n).id, area: area(n) },
      cause,
    });
  }

  function roll(n, s, cause) {
    const def = defOf(n);
    const dice = env.dice('nest');
    const tag = tagOf(s.pop, def.popMax);
    const a = d12(dice);
    const b = d12(dice);
    const win = a + tag.mod > b + NEST.worldMod;
    const crit = (win ? a : b) === 12;
    const step = Math.max(1, Math.round(def.popMax * NEST.share)) * (crit ? 2 : 1);
    const pop = Math.max(0, Math.min(def.popMax, s.pop + (win ? step : -step)));
    const herd = herdOf(n);
    env.record({
      verb: 'nestroll',
      target: center(n),
      data: {
        nest: n.id,
        kind: def.id,
        roll: a,
        mod: tag.mod,
        opp: b,
        oppMod: NEST.worldMod,
        win,
        before: s.pop,
        pop,
        // 外面那群第一次被看到時，出來幾隻就定下來（之後人口變了也不會憑空消失）
        size: s.size ?? Math.min(herd?.members.length ?? 0, s.pop),
        tag: tagOf(pop, def.popMax).name,
        area: area(n),
      },
      cause,
    });
  }

  return {
    // 冒險者做完一個動作之後
    afterAction(cause) {
      const s0 = st();
      const p = s0.player;
      for (const n of world.nestsNear(p.x, p.y, WATCH)) {
        const s = world.nestState(n.id);
        if (s.clearedAt == null) cleared(n, s, cause);
        else if (s.pop > 0 && st().time >= s.clearedAt + NEST.respawn) respawn(n, s, cause);
      }
      let view = null;
      for (const n of world.nestsNear(p.x, p.y, NEST.sight)) {
        const s = world.nestState(n.id);
        if (s.pop <= 0 || (s.rolledAt != null && st().time - s.rolledAt < NEST.rollEvery)) continue;
        view ??= visibleFrom(world, data, p, NEST.sight);
        let seen = false;
        for (let y = n.y0; y < n.y0 + n.h && !seen; y++)
          for (let x = n.x0; x < n.x0 + n.w && !seen; x++) seen = view.has(`${x},${y}`);
        if (seen) roll(n, s, cause);
      }
    },
    // 這格是不是還沒開的寶箱：回傳當成「來源」的樣子 { x, y, chest（據點 id）, cells } 或 null
    chestAt(x, y) {
      const at = world.nestAt?.(x, y);
      if (!at?.inside || at.nest.chest.x !== x || at.nest.chest.y !== y) return null;
      if (world.nestState(at.nest.id).opened) return null;
      return { x, y, chest: at.nest.id, cells: [{ x, y }] };
    },
    // 打開寶箱（要貼著、不在戰鬥中，呼叫的人先檢查）：擲 1D12＋標籤修正對寶箱表
    open(src, cause) {
      const n = world.nestById(src.chest);
      const def = defOf(n);
      const dice = env.dice('chest');
      const tag = tagOf(world.nestState(n.id).pop, def.popMax);
      const roll = d12(dice);
      const total = roll + tag.mod;
      const row = def.chest.find((r) => total <= r.upTo) ?? def.chest[def.chest.length - 1];
      const option = row.options[dice.getUniformInt(0, row.options.length - 1)];
      const got = {};
      let item = null;
      if (option.item) item = option.item;
      else {
        const material = option.wood ? nearbyWood(n) : option.material;
        got[material] = dice.getUniformInt(option.count[0], option.count[1]);
      }
      return env.record({
        verb: 'open',
        target: { x: src.x, y: src.y },
        data: {
          nest: n.id,
          kind: def.id,
          roll,
          mod: tag.mod,
          total,
          got,
          item,
          duration: OPEN_TICKS,
          cells: { [`${src.x},${src.y}`]: true },
        },
        cause,
      });
    },
  };

  // 據點附近最近的一棵樹砍得出什麼木材（陰暗的沼澤的寶箱用）；附近沒有樹給石塊
  function nearbyWood(n) {
    const c = center(n);
    for (let r = 1; r <= 30; r++)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const o = world.objectAt(c.x + dx, c.y + dy);
          if (o < 0 || world.objectPartAt(c.x + dx, c.y + dy) !== PART_TRUNK) continue;
          const yields = data.objects[o].gather?.yields?.[0]?.weights;
          if (yields) return Object.keys(yields)[0];
        }
    return 'stone';
  }
}
