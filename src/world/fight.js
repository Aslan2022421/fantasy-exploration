// 戰鬥（規則草案第七章轉成遊戲版，見 design/PLAN.md「戰鬥」）：開戰、一步一步照時間輪流、逃開與跟丟、結束、倒下、休息。
// 每個動作花幾刻：冒險者走一格、攻擊一次都看身高；生物走一格看自己的速度、攻擊一律 9 刻。冒險者每做完一個動作，
// 時間往前走，下一個動作時間比現在早的生物就一個一個動（同時到時冒險者先），所以存檔時一定停在冒險者要動的時候。
// 視線：看得到這場戰鬥的才有反應。草食的那一群只有被打的那隻還手，其他看得到的逃開；掠食的看得到的都上來打。
// 打的生物看得到冒險者就往他走，看不到就往最後看到他的地方走，走到了還看不到就跟丟、離開戰鬥。
// 每一步都先算好結果再寫成紀錄（狀態怎麼改在 fight-apply.js）。休息「每天一次」的天照時鐘算（rules.js 的 dayOf）

import { chaseSteps, distanceTo, fleeStep, touching } from './chase.js';
import { foeStats } from './foes.js';
import { visibleFrom } from './fov.js';
import { creatureCells } from './herds.js';
import { heroStats } from './hero.js';
import { d12, dayOf, resolveAttack, TICKS_PER_HOUR } from './rules.js';

export { applyFight } from './fight-apply.js';

export const ENGAGE_RANGE = 10; // 看得到這場戰鬥的距離：掠食生物撲上來、同群有反應
export const ESCAPE_RANGE = 20; // 生物看得到冒險者的距離；打的都離超過這麼遠算脫離，逃的超過就停下
const PLAYER = 'player';

// env：{ world, data, state()（現在的狀態）, record(entry), dice(tag)（這一筆的骰子）, startAt（起點）}
export function createFight(env) {
  const { world, data } = env;
  const st = () => env.state();
  const hero = () => heroStats(data, st().hero);

  function foe(id) {
    const info = world.creatureById(id);
    if (!info) return null;
    const stats = foeStats(data.species[info.species], info.herd.env);
    return { ...info, stats, hp: info.hp ?? stats.hp };
  }
  const liveFoes = () => (st().combat?.foes ?? []).filter((id) => world.creatureById(id));
  const inCombat = (id) => !!st().combat && (st().combat.foes.includes(id) || st().combat.flee.includes(id));
  const seenIn = (set, cells) => cells.some((c) => set.has(`${c.x},${c.y}`));
  const entry = (id) => {
    const f = foe(id);
    return { id, x: f.member.x, y: f.member.y, hp: f.hp, species: data.species[f.species].id };
  };

  // 一群裡現在看得到冒險者、還沒在戰鬥中的（10 格內）
  function watchers(herd, view) {
    const p = st().player;
    return world
      .liveMembers(herd)
      .filter((id) => !inCombat(id) && distanceTo(foe(id).cells, p) <= ENGAGE_RANGE && seenIn(view, foe(id).cells));
  }

  // target 被冒險者打到：草食的只有牠還手、看得到的同伴逃開；掠食的看得到的都加入
  function provoke(target, ambush, cause) {
    const f = foe(target);
    const view = visibleFrom(world, data, st().player, ENGAGE_RANGE);
    const others = watchers(f.herd, view).filter((id) => id !== target);
    const herbivore = data.species[f.species].diet === 'herbivore';
    const fighters = herbivore ? [target] : [target, ...others];
    const fleeing = herbivore ? others : [];
    return env.record({
      verb: 'engage',
      data: { foes: fighters.map(entry), flee: fleeing.map(entry), ambush, join: !!st().combat },
      cause,
    });
  }

  // 冒險者做完一個動作之後：時間到了的生物一個一個動；再看有沒有掠食生物看到冒險者加入；最後看結束沒
  function advance(cause) {
    let view = null;
    const sees = () => {
      view ??= visibleFrom(world, data, st().player, ESCAPE_RANGE);
      return view;
    };
    for (let guard = 0; guard < 200 && st().combat; guard++) {
      const { next, foes, flee } = st().combat;
      const due = [...foes, ...flee].filter((id) => next[id] < st().time && world.creatureById(id));
      if (!due.length) break;
      const id = due.reduce((a, b) => (next[b] < next[a] ? b : a)); // 同時的照加入順序
      if (flee.includes(id)) fleeAction(id, sees(), cause);
      else fightAction(id, sees(), cause);
    }
    if (!st().combat) return;
    joinPredators(cause);
    const p = st().player;
    const live = liveFoes();
    if (!live.length || !live.some((id) => distanceTo(foe(id).cells, p) <= ESCAPE_RANGE))
      env.record({ verb: 'escape', data: {}, cause });
  }

  // 打的生物：看得到冒險者就追他、貼著就咬；看不到就往最後看到他的地方走，到了還看不到就跟丟
  function fightAction(id, view, cause) {
    const f = foe(id);
    const p = st().player;
    const sees = seenIn(view, f.cells);
    if (sees && touching(f.cells, p)) return creatureAttack(f, cause);
    const target = sees ? p : st().combat.seen[id];
    if (!sees && touching(f.cells, target)) return leave(f, 'lost', cause);
    const sp = data.species[f.species];
    const to = chaseSteps(world, sp, id, f.member, target, p)[0];
    if (!to && !sees) return leave(f, 'lost', cause);
    step(f, to ?? f.member, sees ? { ...p } : null, cause);
  }

  // 逃的生物：離冒險者超過 ESCAPE_RANGE 或看不到他就停下，不然往遠處走一步
  function fleeAction(id, view, cause) {
    const f = foe(id);
    const p = st().player;
    if (distanceTo(f.cells, p) > ESCAPE_RANGE || !seenIn(view, f.cells)) return leave(f, 'fled', cause);
    step(f, fleeStep(world, data.species[f.species], id, f.member, p) ?? f.member, null, cause);
  }

  function step(f, to, seenAt, cause) {
    const sp = data.species[f.species];
    env.record({
      verb: 'cmove',
      actor: f.id,
      // path：走過的格子（畫面逐格播放用）；cells：起點與終點佔的格子（丟畫面快取用）
      data: {
        from: f.member,
        to,
        path: [to],
        species: sp.id,
        ticks: f.stats.moveTicks,
        seenAt,
        cells: [...f.cells, ...creatureCells(sp, to)],
      },
      cause,
    });
  }

  function leave(f, reason, cause) {
    env.record({ verb: 'leave', actor: f.id, data: { reason, species: data.species[f.species].id }, cause });
  }

  function creatureAttack(f, cause) {
    const h = hero();
    const res = resolveAttack(env.dice('bite'), {
      attack: f.stats.attack,
      defense: h.defense(false),
      damage: f.stats.damage,
      armor: h.reduction,
    });
    const hp = Math.max(0, st().hp - res.damage);
    const species = data.species[f.species].id;
    const p = { ...st().player };
    const rec = env.record({
      verb: 'attack',
      actor: f.id,
      target: PLAYER,
      data: { ...res, hp, species, ticks: f.stats.attackTicks, seenAt: p },
      cause,
    });
    if (hp <= 0) env.record({ verb: 'down', data: { at: env.startAt, from: p, hp: h.hpMax }, cause: rec.id });
  }

  // 附近看得到冒險者的掠食生物撲上來（不在戰鬥中時開戰，在戰鬥中時加入）
  function joinPredators(cause) {
    const p = st().player;
    let view = null;
    for (const { herd } of world.herdsNear(p.x, p.y, ENGAGE_RANGE + 4)) {
      if (data.species[herd.species].diet !== 'predator') continue;
      view ??= visibleFrom(world, data, p, ENGAGE_RANGE);
      const ids = watchers(herd, view);
      if (!ids.length) continue;
      env.record({
        verb: 'engage',
        data: { foes: ids.map(entry), flee: [], ambush: false, join: !!st().combat },
        cause,
      });
    }
  }

  return {
    hero,
    foe,
    liveFoes,
    // 冒險者走了一步之後：戰鬥中讓生物跟上；不在戰鬥中就看有沒有掠食生物看到他
    afterMove(cause) {
      if (st().combat) return advance(cause);
      joinPredators(cause);
      return null;
    },
    // 冒險者攻擊一隻生物（花一個動作的刻數）。牠還沒在打（不在戰鬥中，或在逃）就先惹上牠；
    // 不在戰鬥中時是伏擊：這一下對方防禦值 −2、盜賊背襲。打不到（太遠、看不到）回傳 { refused }
    attack(id, cause) {
      const f = foe(id);
      if (!f) return { refused: 'gone' };
      const h = hero();
      const p = st().player;
      const dist = distanceTo(f.cells, p);
      if (h.ranged) {
        const seen = visibleFrom(world, data, p, h.range);
        if (dist > h.range || !seenIn(seen, f.cells)) return { refused: 'range' };
      } else if (dist > 1) return { refused: 'range' };
      if (!st().combat?.foes.includes(id)) provoke(id, !st().combat, cause);
      const first = st().combat.ambush;
      const res = resolveAttack(env.dice('strike'), {
        attack: h.attack,
        defense: f.stats.defense - (first ? 2 : 0),
        damage: h.damage,
        armor: Math.max(0, f.stats.armor - h.weapon.armorBreak),
        bonus: first ? h.sneak : 0,
      });
      const hp = Math.max(0, f.hp - res.damage);
      const species = data.species[f.species].id;
      const detail = { ...res, hp, species, sneak: first && h.sneak > 0 && res.hit, cells: f.cells, duration: h.ticks };
      const rec = env.record({ verb: 'attack', target: id, data: detail, cause });
      if (!liveFoes().length) env.record({ verb: 'victory', data: {}, cause: rec.id });
      else advance(rec.id);
      return rec;
    },
    // 休息 1 小時：回 1D12＋意志修正 HP，每天一次；戰鬥中不行
    rest(cause) {
      const s = st();
      if (s.combat) return { refused: 'combat' };
      const day = dayOf(s.time);
      if (s.restDay === day) return { refused: 'today' };
      const h = hero();
      const roll = d12(env.dice('rest'));
      const heal = Math.max(0, roll + h.mods.wil);
      const hp = Math.min(h.hpMax, s.hp + heal);
      return env.record({ verb: 'rest', data: { roll, heal, hp, day, duration: TICKS_PER_HOUR }, cause });
    },
  };
}
