// 一筆紀錄 → 事件的細節（data/event 的範本用 {名字} 取）與發生的位置。
// 能用的名字照 event-schema.js 的 FACT_KEYS；不是事件的紀錄回傳 null

import { DATA } from '../data/load.js';
import { gotText } from './describe-nest.js';
import { tagOf } from './nests.js';

const BIG = ['large', 'huge']; // 貨車大小以上
const nestDef = (kind) => DATA.nests[DATA.nestIndex.get(kind)];
const speciesOf = (id) => DATA.species[DATA.speciesIndex.get(id)];
const monsterOf = (def) => speciesOf(def?.species)?.name ?? '怪物';

// 冒險者在傳聞裡的樣子：「精靈遊俠」（沒有名字，用種族與職業稱呼）
export function heroLabel(sheet) {
  const race = DATA.races[DATA.raceIndex.get(sheet?.race)]?.name ?? '';
  const cls = DATA.classes[DATA.classIndex.get(sheet?.cls)]?.name ?? '冒險者';
  return `${race}${cls}`;
}

// 回傳 { at: {x, y}, facts } 或 null
export function factsOf(rec) {
  const d = rec.data ?? {};
  switch (rec.verb) {
    case 'nestclear':
    case 'nestspawn':
    case 'nestroll':
    case 'open': {
      const def = nestDef(d.kind);
      const facts = { place: def?.name ?? d.kind, monster: monsterOf(def), nest: d.nest };
      if (rec.verb === 'nestspawn') facts.size = d.size;
      if (rec.verb === 'open') facts.item = gotText(d);
      if (rec.verb === 'nestroll') {
        facts.win = d.win;
        facts.tag = d.tag;
        facts.tagChanged = !!def && tagOf(d.before, def.popMax).name !== d.tag;
        facts.who = d.settleName ? `${d.settleName}的衛兵` : '一隊路過的冒險者';
      }
      return { at: rec.target, facts };
    }
    case 'settletag':
      return { at: rec.target, facts: { settle: d.name, settleId: d.settle, from: d.from, to: d.to } };
    case 'attack': {
      // 只算冒險者打倒的
      if (rec.actor !== 'player' || d.hp > 0 || !d.cells?.length) return null;
      const sp = speciesOf(d.species);
      return { at: d.cells[0], facts: { species: sp?.name ?? d.species, big: BIG.includes(sp?.answers.size) } };
    }
    case 'down':
      return { at: d.from, facts: {} };
    case 'spot':
      return { at: rec.target, facts: { species: speciesOf(d.species)?.name ?? d.species, count: d.count } };
    default:
      return null;
  }
}

// 這筆紀錄符合哪一種事件（條件 when 的每一項都要相等），沒有回傳 null
export function matchEvent(rec, facts) {
  for (const e of DATA.events)
    if (e.verb === rec.verb && Object.entries(e.when).every(([k, v]) => facts[k] === v)) return e;
  return null;
}

// 範本的 {名字} 換成細節；找不到的名字照原樣留著（資料檢查已經擋掉）
export const fill = (text, facts) => text.replace(/\{(\w+)\}/g, (m, k) => (facts[k] == null ? m : String(facts[k])));
