// 戰鬥（規則草案第七章轉成遊戲版，見 design/PLAN.md「戰鬥」）：開戰、先攻、每回合移動與攻擊、生物的回合、結束、倒下、休息。
// 每一步都先算好結果再寫成紀錄；applyFight 只照紀錄改狀態，重放時不再擲骰。
// 休息「每天一次」的天照時鐘算（rules.js 的 dayOf，開局是早上 8 點）。
// 生物的回合在冒險者按空白鍵結束回合時一口氣算完，所以存檔時一定停在冒險者的回合

import { chaseSteps, cheb, distanceTo, touching } from './chase.js';
import { foeStats } from './foes.js';
import { visibleFrom } from './fov.js';
import { creatureCells } from './herds.js';
import { heroStats } from './hero.js';
import { d12, dayOf, resolveAttack, TICKS_PER_HOUR, TICKS_PER_ROUND } from './rules.js';

export const ENGAGE_RANGE = 10; // 掠食生物在幾格內、看得到就撲上來
export const ESCAPE_RANGE = 20; // 回合結束時離所有敵人超過幾格算脫離
const PLAYER = 'player';

// 一筆紀錄對狀態的影響（戰鬥相關的動詞）；不是這些動詞回傳 null
export function applyFight(state, rec) {
  const d = rec.data;
  const setCreature = (id, patch) => ({ ...state.creatures, [id]: { ...state.creatures[id], ...patch } });
  switch (rec.verb) {
    case 'engage': {
      const creatures = { ...state.creatures };
      for (const f of d.foes) creatures[f.id] = creatures[f.id] ?? { x: f.x, y: f.y, hp: f.hp };
      const combat = { foes: d.foes.map((f) => f.id), order: d.order, round: 1, moved: 0, attacked: false };
      return { ...state, creatures, combat: { ...combat, ambush: d.ambush } };
    }
    case 'attack':
      if (rec.actor === PLAYER)
        return {
          ...state,
          creatures: setCreature(rec.target, { hp: d.hp, ...(d.hp <= 0 ? { dead: true } : {}) }),
          combat: { ...state.combat, attacked: true },
        };
      return { ...state, hp: d.hp };
    case 'cmove':
      return { ...state, creatures: setCreature(rec.actor, { x: d.to.x, y: d.to.y }) };
    case 'round':
      return {
        ...state,
        time: state.time + TICKS_PER_ROUND,
        combat: { ...state.combat, round: d.round, moved: 0, attacked: false },
      };
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

  // 開戰：這些生物加入，擲先攻排順序。伏擊時冒險者排第一；先攻平手冒險者先，生物照 id 順序
  function engage(ids, ambush, cause) {
    const dice = env.dice('engage');
    const h = hero();
    const init = { [PLAYER]: d12(dice) + h.initiative };
    for (const id of ids) init[id] = d12(dice);
    const rank = (id) => (id === PLAYER ? 0 : 1 + ids.indexOf(id));
    const order = [PLAYER, ...ids].sort((a, b) => {
      if (ambush && (a === PLAYER || b === PLAYER)) return a === PLAYER ? -1 : 1;
      return init[b] - init[a] || rank(a) - rank(b);
    });
    const foes = ids.map((id) => {
      const f = foe(id);
      return { id, x: f.member.x, y: f.member.y, hp: f.hp, species: data.species[f.species].id };
    });
    const rec = env.record({ verb: 'engage', data: { foes, order, init, ambush }, cause });
    if (!ambush) runCreatures(0, rec.id);
    return rec;
  }

  // 冒險者在 at 那一格之後輪到誰：從 order 的 from 開始讓生物一個一個動，回合結束時看要不要脫離，直到又輪到冒險者
  function runCreatures(from, cause) {
    let i = from;
    for (let guard = 0; guard < 64 && st().combat; guard++) {
      const order = st().combat.order;
      if (i >= order.length) {
        if (endOfRound(cause)) return;
        i = 0;
        continue;
      }
      if (order[i] === PLAYER) return;
      creatureTurn(order[i], cause);
      i++;
    }
  }

  // 回合結束：敵人全倒（不會到這裡，攻擊時就結束了）或全都離超過 ESCAPE_RANGE 格就脫離；否則下一回合
  function endOfRound(cause) {
    const p = st().player;
    const near = liveFoes().some((id) => distanceTo(foe(id).cells, p) <= ESCAPE_RANGE);
    if (!near) {
      env.record({ verb: 'escape', data: {}, cause });
      return true;
    }
    env.record({ verb: 'round', data: { round: st().combat.round + 1 }, cause });
    return false;
  }

  function creatureTurn(id, cause) {
    const f = foe(id);
    if (!f) return;
    const p = st().player;
    let cells = f.cells;
    if (!touching(cells, p)) {
      const sp = data.species[f.species];
      const steps = chaseSteps(world, sp, id, f.member, p).slice(0, f.stats.speed);
      if (steps.length) {
        const to = steps.at(-1);
        cells = creatureCells(sp, to);
        env.record({
          verb: 'cmove',
          actor: id,
          // path：走過的每一格錨點（畫面逐格播放用）；cells：起點與終點佔的格子（丟畫面快取用）
          data: { from: f.member, to, path: steps, species: sp.id, cells: [...f.cells, ...cells] },
          cause,
        });
      }
    }
    if (touching(cells, p)) creatureAttack(f, cause);
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
    const rec = env.record({ verb: 'attack', actor: f.id, target: PLAYER, data: { ...res, hp, species }, cause });
    if (hp <= 0) env.record({ verb: 'down', data: { at: env.startAt, from: st().player, hp: h.hpMax }, cause: rec.id });
  }

  return {
    hero,
    foe,
    liveFoes,
    // 平常走一步之後：10 格內看得到冒險者的掠食生物，整群撲上來
    afterMove(cause) {
      if (st().combat) return null;
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
    // 冒險者攻擊一隻生物。不在戰鬥中就先開戰（伏擊）。打不到（太遠、這回合打過了）回傳 { refused }
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
      const c = st().combat;
      if (c.attacked) return { refused: 'attacked' };
      const first = c.ambush && c.round === 1;
      const res = resolveAttack(env.dice('strike'), {
        attack: h.attack,
        defense: f.stats.defense - (first ? 2 : 0),
        damage: h.damage,
        armor: Math.max(0, f.stats.armor - h.weapon.armorBreak),
        bonus: first ? h.sneak : 0,
      });
      const hp = Math.max(0, f.hp - res.damage);
      const species = data.species[f.species].id;
      const detail = { ...res, hp, species, sneak: first && h.sneak > 0 && res.hit, cells: f.cells };
      const rec = env.record({ verb: 'attack', target: id, data: detail, cause });
      if (!liveFoes().length) env.record({ verb: 'victory', data: {}, cause: rec.id });
      return rec;
    },
    // 冒險者結束這一回合：輪到後面的生物，直到又輪到冒險者（或戰鬥結束）
    endTurn(cause) {
      const c = st().combat;
      if (!c) return false;
      runCreatures(c.order.indexOf(PLAYER) + 1, cause);
      return true;
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
    cheb,
  };
}
