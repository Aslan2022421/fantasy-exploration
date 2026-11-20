// 製造、修理、熔煉、用掉補給品、裝備壞掉的紀錄怎麼改狀態（craft.js 先算好，這裡只照紀錄套）。
// bag 是背包、stock 是現存數量（算上限用，見 gather.js）；不是這幾種動詞回傳 null

const take = (map, spend, floor = false) => {
  const out = { ...map };
  for (const [id, n] of Object.entries(spend ?? {}))
    out[id] = floor ? Math.max(0, (out[id] ?? 0) - n) : (out[id] ?? 0) - n;
  return out;
};
const give = (map, got) => {
  const out = { ...map };
  for (const [id, n] of Object.entries(got ?? {})) out[id] = (out[id] ?? 0) + n;
  return out;
};
const wearList = (h) => h.items.map((_, i) => h.itemWear?.[i] ?? 0);

export function applyCraft(state, rec) {
  const d = rec.data;
  const h = state.hero;
  const done = rec.time + (d.duration ?? 0);
  switch (rec.verb) {
    case 'craft': {
      // 做成功：做進去的照算上限；燒掉的燃料、擲 1 損失的材料讓出上限
      let bag = take(take(state.bag, d.spent), d.burned);
      const stock = take(take(state.stock, d.burned, true), d.lost ? d.spent : {}, true);
      let hero = h;
      if (d.made?.material) bag = give(bag, { [d.made.material]: d.made.n });
      if (d.made?.item) hero = { ...h, items: [...h.items, d.made.item], itemWear: [...wearList(h), 0] };
      return { ...state, bag, stock, hero, time: done };
    }
    case 'repair':
      return {
        ...state,
        bag: take(state.bag, d.spent),
        stock: take(state.stock, d.released, true),
        hero: { ...h, wear: { ...(h.wear ?? {}), [d.slot]: 0 } },
        time: done,
      };
    case 'smelt': {
      const items = [...h.items];
      const itemWear = wearList(h);
      items.splice(d.index, 1);
      itemWear.splice(d.index, 1);
      return {
        ...state,
        bag: give(state.bag, d.got),
        stock: take(state.stock, d.released, true),
        hero: { ...h, items, itemWear },
        time: done,
      };
    }
    case 'use':
      return {
        ...state,
        bag: take(state.bag, { [d.material]: 1 }),
        stock: take(state.stock, d.released, true),
        hp: d.hp,
        time: done,
      };
    case 'break':
      return {
        ...state,
        stock: take(state.stock, d.released, true),
        hero: { ...h, gear: { ...h.gear, [d.slot]: null }, wear: { ...(h.wear ?? {}), [d.slot]: 0 } },
      };
    default:
      return null;
  }
}
