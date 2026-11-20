// 跟村民說話：名字、種族，加兩三句從聚落現在的狀態讀出來的話（經濟的徵兆或標籤、附近據點的動靜），
// 再加最多兩則傳聞（rumors.js）。只讀狀態與紀錄，不擲骰；同樣的狀態說同樣的話

import { dirWord } from './rumors.js';
import { SETTLE } from './settlements.js';

const ECON_LINES = [
  '日子快過不下去了。',
  '日子緊巴巴的，勉強過得去。',
  '日子還算過得去。',
  '最近生意不錯，大家手頭都寬了些。',
  '這幾年大家都過得很好。',
];

// npc：withVillagers 的村民；extra：{ news: [{ text }] 傳聞, clearedBy(據點 id) 是誰讓那裡沒有怪物 }。
// 回傳 { title, lines: [字串] }
export function talkLines(world, data, npc, extra = {}) {
  const s = npc.settle;
  const v = npc.villager;
  const race = data.races[data.raceIndex.get(v.race)]?.name ?? '';
  const lines = [`「我是${v.name}，住在${s.name}。」`];
  const econ = world.settleEcon(s);
  lines.push(`「${econ.sign ? `最近${econ.sign.replace('村民', '大家')}。` : ECON_LINES[econ.tag]}」`);

  const c = { x: s.x0 + (s.w >> 1), y: s.y0 + (s.h >> 1) };
  let near = null;
  for (const n of world.nestsNear?.(c.x, c.y, SETTLE.rival + Math.max(s.w, s.h)) ?? []) {
    const d = Math.hypot(n.x0 - c.x, n.y0 - c.y);
    if (!near || d < near.d) near = { n, d };
  }
  if (!near) lines.push('「附近還算太平。」');
  else {
    const n = near.n;
    const def = data.nests[n.kind];
    const sp = data.species[data.speciesIndex.get(def.species)]?.name ?? '怪物';
    const where = `${dirWord(c, { x: n.x0 + (n.w >> 1), y: n.y0 + (n.h >> 1) })}的${def.name}`;
    const st = world.nestState(n.id);
    const tag = world.nestTag(n).mod;
    const who = extra.clearedBy?.(n.id);
    if (st.pop <= 0)
      lines.push(who ? `「${where}已經沒有怪物了，聽說是${who}清掉的。」` : `「${where}已經沒有怪物了。」`);
    else if (tag > 0) lines.push(`「${where}最近常有${sp}出沒，晚上別亂跑。」`);
    else if (tag < 0) lines.push(`「${where}最近安靜多了。」`);
    else lines.push(`「${where}住著${sp}，最好別靠近。」`);
  }
  for (const n of extra.news ?? []) lines.push(n.text);
  return { title: `${v.name}（${race}）`, lines };
}
