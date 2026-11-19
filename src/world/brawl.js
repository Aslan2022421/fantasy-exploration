// 混食的怪物打其他生物（見 design/PLAN.md「戰鬥」的混食性）：只在冒險者看得到的地方發生，看不到的地方不寫紀錄。
// - 不在戰鬥中的混食怪物：10 格內、牠自己看得到、冒險者也看得到的不同種族生物（冒險者也算），挑最近的撲上去
// - 戰鬥中每次輪到牠，重挑一次最近的目標（冒險者靠得比牠正在打的那隻近，就轉過來打冒險者）
// - 被打的照自己的食性反應，跟被冒險者打時一樣：草食的只有被打的那隻還手、看得到的同伴逃開；掠食和混食的看得到的都還手
// - 冒險者看不到其中一方，那一隻就停在當下（leave，照狀態擺著）
// 判定跟冒險者一樣：1D12＋攻擊 ≥ 對方的防禦值，傷害減護甲（rules.js 的 resolveAttack）

import { chaseSteps, distanceTo, gapBetween, nearestCell } from './chase.js';
import { visibleFrom } from './fov.js';
import { resolveAttack } from './rules.js';

export const PLAYER = 'player';

// ctx：fight.js 給的 { world, data, st, foe, entry, seenIn, inCombat, record, dice, step, leave, range }
export function createBrawl(ctx) {
  const { world, data, st, foe, entry, seenIn, inCombat, record, dice, step, leave, range, nestLoss } = ctx;
  const spOf = (f) => data.species[f.species];
  const enemies = (a, b) => spOf(a).id !== spOf(b).id;
  // 冒險者在聚落裡（安全區）：怪物不把他當目標
  const heroSafe = () => !!world.inSettleArea?.(st().player.x, st().player.y);

  // 戰鬥中的混食怪物現在要打誰：冒險者（看得到時）、戰鬥裡不同種族的生物、牠原本的目標，挑最近的；同樣近時冒險者優先
  function pickAim(f, view) {
    const c = st().combat;
    let best = null;
    let bestD = Number.POSITIVE_INFINITY;
    if (seenIn(view, f.cells) && !heroSafe()) {
      best = PLAYER;
      bestD = distanceTo(f.cells, st().player);
    }
    const ids = new Set([...c.foes, ...c.flee]);
    if (c.target?.[f.id] && c.target[f.id] !== PLAYER) ids.add(c.target[f.id]);
    for (const id of ids) {
      if (id === f.id) continue;
      const t = foe(id);
      if (!t || !enemies(f, t) || !seenIn(view, t.cells)) continue;
      const d = gapBetween(f.cells, t.cells);
      if (d < bestD) {
        best = id;
        bestD = d;
      }
    }
    return best;
  }

  // 打一隻生物：貼著就打，不然往牠走一格；任一方冒險者看不到就停下
  function act(f, aimId, view, cause) {
    const t = foe(aimId);
    if (!t) return leave(f, 'done', cause);
    if (!seenIn(view, t.cells) || !seenIn(view, f.cells)) return leave(f, 'unseen', cause);
    if (gapBetween(f.cells, t.cells) <= 1) return hit(f, t, view, cause);
    const goal = nearestCell(f.cells, t.cells);
    const to = chaseSteps(world, spOf(f), f.id, f.member, goal, st().player)[0];
    return step(f, to ?? f.member, null, cause, aimId);
  }

  function hit(f, t, view, cause) {
    const res = resolveAttack(dice('maul'), {
      attack: f.stats.attack,
      defense: t.stats.defense,
      damage: f.stats.damage,
      armor: t.stats.armor,
    });
    const hp = Math.max(0, t.hp - res.damage);
    const rec = record({
      verb: 'attack',
      actor: f.id,
      target: t.id,
      // at：被打的那隻現在的位置（牠還在遊蕩、沒進狀態時要記下來）
      data: {
        ...res,
        hp,
        species: spOf(f).id,
        victim: spOf(t).id,
        ticks: f.stats.attackTicks,
        aim: t.id,
        at: t.member,
        cells: t.cells,
        ...nestLoss(t, hp),
      },
      cause,
    });
    if (hp > 0) answer(t, f, view, rec.id);
    return rec;
  }

  // 被打的生物還沒在戰鬥中：照自己的食性反應（同伴要在牠附近、冒險者看得到才算）
  function answer(t, f, view, cause) {
    if (inCombat(t.id)) return;
    const mates = world
      .liveMembers(t.herd)
      .filter((id) => id !== t.id && !inCombat(id))
      .filter((id) => {
        const m = foe(id);
        return m && gapBetween(m.cells, t.cells) <= range && seenIn(view, m.cells);
      });
    const herbivore = spOf(t).diet === 'herbivore';
    const fighters = herbivore ? [t.id] : [t.id, ...mates];
    record({
      verb: 'engage',
      data: {
        foes: fighters.map((id) => entry(id, { target: f.id, aimSpecies: spOf(f).id })),
        flee: herbivore ? mates.map((id) => entry(id, { from: f.id })) : [],
        ambush: false,
        join: true,
        brawl: true,
        answer: true,
      },
      cause,
    });
  }

  // 不在戰鬥中的混食怪物找目標。heroView 是冒險者看得到的格子；near 是冒險者附近的生物（第一次用到才算）。
  // 同一群同時撲上來的合寫一筆：撲向冒險者的一筆、撲向別的生物的一筆（訊息不洗版）
  function spot(herd, heroView, near, cause) {
    const p = st().player;
    const atHero = [];
    const atPrey = [];
    for (const id of world.liveMembers(herd)) {
      if (inCombat(id)) continue;
      const f = foe(id);
      if (!f || !seenIn(heroView, f.cells)) continue;
      let aim = null;
      let best = Number.POSITIVE_INFINITY;
      const toHero = distanceTo(f.cells, p);
      if (toHero <= range && !heroSafe()) {
        aim = PLAYER;
        best = toHero;
      }
      let own = null;
      for (const o of near()) {
        if (o.id === id) continue;
        const t = foe(o.id);
        if (!t || !enemies(f, t) || !seenIn(heroView, t.cells)) continue;
        const d = gapBetween(f.cells, t.cells);
        if (d > range || d >= best) continue;
        own ??= visibleFrom(world, data, f.member, range);
        if (!seenIn(own, t.cells)) continue;
        aim = t.id;
        best = d;
      }
      if (aim === PLAYER) atHero.push(entry(id, { target: PLAYER }));
      else if (aim) atPrey.push(entry(id, { target: aim, aimSpecies: spOf(foe(aim)).id }));
    }
    for (const [foes, brawl] of [
      [atHero, false],
      [atPrey, true],
    ])
      if (foes.length)
        record({ verb: 'engage', data: { foes, flee: [], ambush: false, join: !!st().combat, brawl }, cause });
  }

  return { pickAim, act, spot };
}
