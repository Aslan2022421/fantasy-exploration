// 戰鬥（規則草案第七章轉成遊戲版，見 design/PLAN.md「戰鬥」）：開戰、一步一步照時間輪流、結束、倒下、休息。
// 每個動作（走一格、攻擊一次）花幾刻：冒險者看身高、生物看體型。冒險者每做完一個動作，時間往前走，
// 下一個動作時間比現在早的生物就一個一個動（同時到時冒險者先），所以存檔時一定停在冒險者要動的時候。
// 每一步都先算好結果再寫成紀錄；applyFight 只照紀錄改狀態，重放時不再擲骰。
// 休息「每天一次」的天照時鐘算（rules.js 的 dayOf，開局是早上 8 點）。

import { chaseSteps, distanceTo, touching } from './chase.js';
import { foeStats } from './foes.js';
import { visibleFrom } from './fov.js';
import { creatureCells } from './herds.js';
import { heroStats } from './hero.js';
import { d12, dayOf, resolveAttack, TICKS_PER_HOUR } from './rules.js';

export const ENGAGE_RANGE = 10; // 掠食生物在幾格內、看得到就撲上來
export const ESCAPE_RANGE = 20; // 輪到冒險者時離所有敵人都超過幾格算脫離
const PLAYER = 'player';

// 一筆紀錄對狀態的影響（戰鬥相關的動詞）；不是這些動詞回傳 null
export function applyFight(state, rec) {
  const d = rec.data;
  const setCreature = (id, patch) => ({ ...state.creatures, [id]: { ...state.creatures[id], ...patch } });
  // 生物做完一個動作：牠的下一個動作往後排
  const later = (id) => ({ ...state.combat, next: { ...state.combat.next, [id]: state.combat.next[id] + d.ticks } });
  switch (rec.verb) {
    case 'engage': {
      const creatures = { ...state.creatures };
      for (const f of d.foes) creatures[f.id] = creatures[f.id] ?? { x: f.x, y: f.y, hp: f.hp };
      const next = Object.fromEntries(d.foes.map((f) => [f.id, rec.time]));
      return { ...state, creatures, combat: { foes: d.foes.map((f) => f.id), next, ambush: d.ambush } };
    }
    case 'attack':
      if (rec.actor === PLAYER)
        return {
          ...state,
          time: state.time + d.duration,
          creatures: setCreature(rec.target, { hp: d.hp, ...(d.hp <= 0 ? { dead: true } : {}) }),
          combat: state.combat && { ...state.combat, ambush: false },
        };
      return { ...state, hp: d.hp, combat: later(rec.actor) };
    case 'cmove':
      return { ...state, creatures: setCreature(rec.actor, { x: d.to.x, y: d.to.y }), combat: later(rec.actor) };
    case 'victory':
    case 'escape':
      return { ...state, combat: null };
    case 'down':
      return { ...state, combat: null, player: { ...d.at }, hp: d.hp };
    case 'rest':
      return { ...state, hp: d.hp, restDay: d.day, time: state.time + d.duration };
    default:
      return null;
  }
}

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

  // 開戰：這些生物加入，下一個動作排在現在（同時到時冒險者先，所以冒險者先動一次）
  function engage(ids, ambush, cause) {
    const foes = ids.map((id) => {
      const f = foe(id);
      return { id, x: f.member.x, y: f.member.y, hp: f.hp, species: data.species[f.species].id };
    });
    return env.record({ verb: 'engage', data: { foes, ambush }, cause });
  }

  // 冒險者做完一個動作之後：下一個動作時間比現在早的生物照先後一個一個動，直到都排到現在以後；
  // 然後看冒險者有沒有甩開所有敵人
  function advance(cause) {
    for (let guard = 0; guard < 200 && st().combat; guard++) {
      const { next, foes } = st().combat;
      const due = foes.filter((id) => next[id] < st().time && world.creatureById(id));
      if (!due.length) break;
      const id = due.reduce((a, b) => (next[b] < next[a] ? b : a)); // 同時的照加入順序
      creatureAction(id, cause);
    }
    const c = st().combat;
    if (!c) return;
    const p = st().player;
    if (!liveFoes().some((id) => distanceTo(foe(id).cells, p) <= ESCAPE_RANGE))
      env.record({ verb: 'escape', data: {}, cause });
  }

  // 生物的一個動作：貼著就咬，不然往冒險者走一格
  function creatureAction(id, cause) {
    const f = foe(id);
    const p = st().player;
    if (touching(f.cells, p)) return creatureAttack(f, cause);
    const sp = data.species[f.species];
    const to = chaseSteps(world, sp, id, f.member, p)[0] ?? f.member; // 走不到就原地等
    env.record({
      verb: 'cmove',
      actor: id,
      // path：走過的格子（畫面逐格播放用）；cells：起點與終點佔的格子（丟畫面快取用）
      data: {
        from: f.member,
        to,
        path: [to],
        species: sp.id,
        ticks: f.stats.ticks,
        cells: [...f.cells, ...creatureCells(sp, to)],
      },
      cause,
    });
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
    const rec = env.record({
      verb: 'attack',
      actor: f.id,
      target: PLAYER,
      data: { ...res, hp, species, ticks: f.stats.ticks },
      cause,
    });
    if (hp <= 0) env.record({ verb: 'down', data: { at: env.startAt, from: st().player, hp: h.hpMax }, cause: rec.id });
  }

  return {
    hero,
    foe,
    liveFoes,
    // 冒險者走了一步之後：戰鬥中讓生物跟上；不在戰鬥中就看 10 格內有沒有看得到冒險者的掠食生物，整群撲上來
    afterMove(cause) {
      if (st().combat) return advance(cause);
      const p = st().player;
      let seen = null;
      for (const { herd } of world.herdsNear(p.x, p.y, ENGAGE_RANGE + 4)) {
        if (data.species[herd.species].diet !== 'predator') continue;
        const ids = world.liveMembers(herd);
        const close = ids.filter((id) => distanceTo(foe(id).cells, p) <= ENGAGE_RANGE);
        if (!close.length) continue;
        seen ??= visibleFrom(world, data, p, ENGAGE_RANGE);
        if (close.some((id) => foe(id).cells.some((c) => seen.has(`${c.x},${c.y}`)))) return engage(ids, false, cause);
      }
      return null;
    },
    // 冒險者攻擊一隻生物（花一個動作的刻數）。不在戰鬥中就先開戰（伏擊：這一下對方防禦值 −2、盜賊背襲）。
    // 打不到（太遠、看不到）回傳 { refused }
    attack(id, cause) {
      const f = foe(id);
      if (!f) return { refused: 'gone' };
      const h = hero();
      const p = st().player;
      const dist = distanceTo(f.cells, p);
      if (h.ranged) {
        const seen = visibleFrom(world, data, p, h.range);
        if (dist > h.range || !f.cells.some((c) => seen.has(`${c.x},${c.y}`))) return { refused: 'range' };
      } else if (dist > 1) return { refused: 'range' };
      if (!st().combat) engage(world.liveMembers(f.herd), true, cause);
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
