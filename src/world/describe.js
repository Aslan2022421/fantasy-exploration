// 把紀錄寫成給玩家看的一行字。連續、同方向、同起因的移動併成一行；戰鬥的在 describe-fight.js

import { DATA } from '../data/load.js';
import { describeFight } from './describe-fight.js';

const UNITS = { mineral: '塊', wood: '段', plant: '株', animal: '份' };

// 採集：「挖金屬礦，挖到 2 塊鐵礦。」「砍倒闊葉樹，得到 3 段闊葉木。」「採下矮叢，得到 1 株寒地漿果。」
function gatherText(d) {
  const obj = DATA.objects[DATA.objectIndex.get(d.object)]?.name ?? d.object;
  const verb = { mine: d.done ? '挖空' : '挖', chop: '砍倒', pick: '採下' }[d.action];
  if (!d.got) return `${verb}${obj}，什麼都沒${d.action === 'mine' ? '挖到' : '得到'}。`;
  const m = DATA.materials[DATA.materialIndex.get(d.got.material)];
  const got = `${d.got.amount} ${UNITS[m?.category] ?? '個'}${m?.name ?? d.got.material}`;
  return `${verb}${obj}，${d.action === 'mine' ? '挖到' : '得到'} ${got}。`;
}

const speciesName = (id) => DATA.species[DATA.speciesIndex.get(id)]?.name ?? id;

const DIR_NAMES = { n: '北', ne: '東北', e: '東', se: '東南', s: '南', sw: '西南', w: '西', nw: '西北' };

export function describeRecord(rec) {
  const d = rec.data ?? {};
  switch (rec.verb) {
    case 'start':
      return '來到這片土地。';
    case 'move':
      return `往${DIR_NAMES[d.dir] ?? '?'}走`;
    case 'plan':
      return `決定走到 (${rec.target.x}, ${rec.target.y})，共 ${d.steps} 步`;
    case 'examine':
      return `查看 (${rec.target.x}, ${rec.target.y})：${d.what}`;
    case 'blocked':
      return '有東西擋住了路，停了下來。';
    case 'gather':
      return gatherText(d);
    case 'spot':
      return `遠遠看見${speciesName(d.species)}（一群 ${d.count} 隻）。`;
    default: {
      const text = describeFight(rec);
      return text === undefined ? rec.verb : text;
    }
  }
}

// 紀錄 → 顯示用的行：{ time, text }；連續同方向、同起因的移動併成「往東走 3 步」
export function logLines(records) {
  const lines = [];
  let run = null;
  for (const rec of records) {
    const sameRun =
      run &&
      rec.verb === 'move' &&
      run.rec.verb === 'move' &&
      rec.data.dir === run.rec.data.dir &&
      rec.cause === run.rec.cause;
    if (sameRun) {
      run.count++;
      run.line.text = `${describeRecord(run.rec)} ${run.count} 步`;
      continue;
    }
    const text = describeRecord(rec);
    if (text === null) continue; // 不寫出來的紀錄（生物移動）
    const line = { time: rec.time, text, verb: rec.verb };
    lines.push(line);
    run = rec.verb === 'move' ? { rec, count: 1, line } : null;
  }
  return lines;
}
