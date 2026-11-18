// 據點的紀錄寫成給玩家看的一行字：擲骰與總值都寫出來

import { DATA } from '../data/load.js';

const UNITS = { mineral: '塊', wood: '段', plant: '株', animal: '份' };
const signed = (n) => (n < 0 ? `-${-n}` : `+${n}`);
const nestDef = (id) => DATA.nests[DATA.nestIndex.get(id)];
const nestName = (id) => nestDef(id)?.name ?? id;
const speciesName = (nestId) => {
  const sp = nestDef(nestId)?.species;
  return DATA.species[DATA.speciesIndex.get(sp)]?.name ?? '怪物';
};
const itemName = (id) =>
  DATA.weapons[DATA.weaponIndex.get(id)]?.name ?? DATA.armors[DATA.armorIndex.get(id)]?.name ?? id;
function gotText(d) {
  if (d.item) return `一件${itemName(d.item)}`;
  return Object.entries(d.got)
    .map(([id, n]) => {
      const m = DATA.materials[DATA.materialIndex.get(id)];
      return `${n} ${UNITS[m?.category] ?? '個'}${m?.name ?? id}`;
    })
    .join('、');
}

// 不是據點的動詞回傳 undefined
export function describeNest(rec) {
  const d = rec.data ?? {};
  switch (rec.verb) {
    case 'nestroll': {
      const roll = `據點擲 ${d.roll}${signed(d.mod)}＝${d.roll + d.mod} 對 ${d.opp}${signed(d.oppMod)}＝${d.opp + d.oppMod}`;
      const how = d.pop === d.before ? '看起來沒什麼變化' : d.win ? '範圍擴大了' : '範圍縮小了';
      return `${nestName(d.kind)}${how}（${roll}），${d.tag}。`;
    }
    case 'nestclear':
      return `${nestName(d.kind)}外面那群${speciesName(d.kind)}被清光了。`;
    case 'nestspawn':
      return `${nestName(d.kind)}又出來一群${speciesName(d.kind)}（${d.size} 隻）。`;
    case 'open':
      return `打開${nestName(d.kind)}的寶箱：擲 ${d.roll}${signed(d.mod)}＝${d.total}，得到${gotText(d)}。`;
    default:
      return undefined;
  }
}
