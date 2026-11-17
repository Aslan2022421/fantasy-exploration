// 戰鬥的紀錄怎麼改狀態（fight.js 先算好結果寫成紀錄，這裡只照紀錄套，重放時不再擲骰）。
// combat：{ foes 打的, flee 逃的, next 各自下一個動作的時間, seen 各自最後看到冒險者的位置, ambush 這一下是不是伏擊 }

import { TICKS_PER_HOUR } from './rules.js';

const PLAYER = 'player';

export function applyFight(state, rec) {
  const d = rec.data;
  const c = state.combat;
  const setCreature = (id, patch) => ({ ...state.creatures, [id]: { ...state.creatures[id], ...patch } });
  // 生物做完一個動作：牠的下一個動作往後排；看到冒險者就記下位置
  const later = (id) => ({
    ...c,
    next: { ...c.next, [id]: c.next[id] + d.ticks },
    seen: d.seenAt ? { ...c.seen, [id]: d.seenAt } : c.seen,
  });
  switch (rec.verb) {
    case 'engage': {
      // 開戰或中途加入：foes 是要打的、flee 是要逃的；都從現在起排、最後看到冒險者的位置是現在的位置
      const creatures = { ...state.creatures };
      const all = [...d.foes, ...(d.flee ?? [])];
      for (const f of all) creatures[f.id] = creatures[f.id] ?? { x: f.x, y: f.y, hp: f.hp };
      const base = c ?? { foes: [], flee: [], next: {}, seen: {}, ambush: d.ambush };
      const fighting = new Set(d.foes.map((f) => f.id));
      const next = { ...base.next };
      const seen = { ...base.seen };
      for (const f of all) {
        if (next[f.id] === undefined) next[f.id] = rec.time;
        seen[f.id] = { ...state.player };
      }
      return {
        ...state,
        creatures,
        combat: {
          ...base,
          foes: [...base.foes.filter((id) => !fighting.has(id)), ...fighting],
          flee: [...base.flee.filter((id) => !fighting.has(id)), ...(d.flee ?? []).map((f) => f.id)],
          next,
          seen,
        },
      };
    }
    case 'attack':
      if (rec.actor === PLAYER)
        return {
          ...state,
          time: state.time + d.duration,
          creatures: setCreature(rec.target, { hp: d.hp, ...(d.hp <= 0 ? { dead: true } : {}) }),
          combat: c && { ...c, ambush: false },
        };
      return { ...state, hp: d.hp, combat: later(rec.actor) };
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
