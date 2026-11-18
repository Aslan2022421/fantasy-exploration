// 戰鬥的紀錄怎麼改狀態（fight.js 先算好結果寫成紀錄，這裡只照紀錄套，重放時不再擲骰）。
// combat：{ foes 打的, flee 逃的, next 各自下一個動作的時間, seen 各自最後看到冒險者的位置, ambush 這一下是不是伏擊,
//           target 各自在打誰（冒險者或另一隻生物）, from 逃的各自在逃誰, hero 冒險者有沒有牽涉在內 }
// 生物受傷記下時間 hurtAt（會再生的照它算現在的生命，foes.js 的 regenHp）

import { TICKS_PER_HOUR } from './rules.js';

const PLAYER = 'player';

export function applyFight(state, rec) {
  const d = rec.data;
  const c = state.combat;
  const setCreature = (id, patch) => ({ ...state.creatures, [id]: { ...state.creatures[id], ...patch } });
  // 受傷：還沒進狀態的（被怪物打的遊蕩生物）連位置一起記
  const hurt = (id) =>
    setCreature(id, {
      ...(state.creatures[id] ? {} : { x: d.at.x, y: d.at.y }),
      hp: d.hp,
      hurtAt: rec.time,
      ...(d.hp <= 0 ? { dead: true } : {}),
    });
  // 生物做完一個動作：牠的下一個動作往後排；看到冒險者就記下位置；換了目標就記下
  const later = (id) => ({
    ...c,
    next: { ...c.next, [id]: c.next[id] + d.ticks },
    seen: d.seenAt ? { ...c.seen, [id]: d.seenAt } : c.seen,
    target: d.aim !== undefined ? { ...c.target, [id]: d.aim } : c.target,
  });
  switch (rec.verb) {
    case 'engage': {
      // 開戰或中途加入：foes 是要打的、flee 是要逃的；都從現在起排、最後看到冒險者的位置是現在的位置
      const creatures = { ...state.creatures };
      const all = [...d.foes, ...(d.flee ?? [])];
      for (const f of all) creatures[f.id] = creatures[f.id] ?? { x: f.x, y: f.y, hp: f.hp };
      const base = c ?? { foes: [], flee: [], next: {}, seen: {}, target: {}, from: {}, hero: false };
      const fighting = new Set(d.foes.map((f) => f.id));
      const next = { ...base.next };
      const seen = { ...base.seen };
      const target = { ...base.target };
      const from = { ...base.from };
      for (const f of all) {
        if (next[f.id] === undefined) next[f.id] = rec.time;
        seen[f.id] = { ...state.player };
      }
      for (const f of d.foes) target[f.id] = f.target ?? PLAYER;
      for (const f of d.flee ?? []) from[f.id] = f.from ?? PLAYER;
      return {
        ...state,
        creatures,
        combat: {
          ...base,
          foes: [...base.foes.filter((id) => !fighting.has(id)), ...fighting],
          flee: [...base.flee.filter((id) => !fighting.has(id)), ...(d.flee ?? []).map((f) => f.id)],
          next,
          seen,
          target,
          from,
          ambush: d.ambush,
          hero: base.hero || d.foes.some((f) => (f.target ?? PLAYER) === PLAYER),
        },
      };
    }
    case 'attack':
      if (rec.actor === PLAYER)
        return {
          ...state,
          time: state.time + d.duration,
          creatures: hurt(rec.target),
          combat: c && { ...c, ambush: false, hero: true },
        };
      if (rec.target === PLAYER) return { ...state, hp: d.hp, combat: later(rec.actor) };
      return { ...state, creatures: hurt(rec.target), combat: later(rec.actor) }; // 生物打生物
    case 'cmove':
      return { ...state, creatures: setCreature(rec.actor, { x: d.to.x, y: d.to.y }), combat: later(rec.actor) };
    case 'leave': {
      // 逃遠了或跟丟了：不再算在戰鬥裡，停在原地
      const next = { ...c.next };
      delete next[rec.actor];
      return {
        ...state,
        combat: {
          ...c,
          foes: c.foes.filter((id) => id !== rec.actor),
          flee: c.flee.filter((id) => id !== rec.actor),
          next,
        },
      };
    }
    case 'victory':
    case 'escape':
      return { ...state, combat: null };
    case 'down':
      return { ...state, combat: null, player: { ...d.at }, hp: d.hp };
    case 'rest':
      return { ...state, hp: d.hp, restDay: d.day, time: state.time + (d.duration ?? TICKS_PER_HOUR) };
    default:
      return null;
  }
}
