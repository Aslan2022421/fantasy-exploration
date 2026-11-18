// 據點的紀錄怎麼改狀態（nest-watch.js 先算好結果寫成紀錄，這裡只照紀錄套，重放時不再擲骰）。
// nests：{ 據點 id: { pop, size, rolledAt, clearedAt, opened } }；生物倒下時扣人口的那一筆在 fight-apply.js

export function applyNest(state, rec) {
  const d = rec.data;
  const nest = (patch) => ({ ...state.nests, [d.nest]: { ...state.nests[d.nest], ...patch } });
  switch (rec.verb) {
    case 'nestroll':
      return { ...state, nests: nest({ pop: d.pop, size: d.size, rolledAt: rec.time }) };
    case 'nestclear':
      return { ...state, nests: nest({ clearedAt: rec.time }) };
    case 'nestspawn': {
      // 新的一群：舊的那群（打過、倒下的）從狀態拿掉，照種子重新出來
      const old = (id) => id.startsWith(`${d.herd}#`);
      const creatures = Object.fromEntries(Object.entries(state.creatures).filter(([id]) => !old(id)));
      // 戰鬥裡還記著舊那群（都倒下了）的編號也拿掉，新的一群才不會一出來就算在戰鬥裡
      const c = state.combat;
      const combat = c && { ...c, foes: c.foes.filter((id) => !old(id)), flee: c.flee.filter((id) => !old(id)) };
      return { ...state, creatures, combat, nests: nest({ size: d.size, clearedAt: null }) };
    }
    case 'open': {
      const bag = { ...state.bag };
      const stock = { ...state.stock };
      for (const [m, n] of Object.entries(d.got)) {
        bag[m] = (bag[m] ?? 0) + n;
        stock[m] = (stock[m] ?? 0) + n;
      }
      const hero = d.item ? { ...state.hero, items: [...state.hero.items, d.item] } : state.hero;
      return { ...state, bag, stock, hero, nests: nest({ opened: true }), time: rec.time + d.duration };
    }
    default:
      return null;
  }
}
