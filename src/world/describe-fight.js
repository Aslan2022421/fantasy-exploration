// 戰鬥的紀錄寫成給玩家看的一行字：擲骰與總值都寫出來，看得出為什麼打中、為什麼沒打中

import { DATA } from '../data/load.js';

const sp = (id) => DATA.species[DATA.speciesIndex.get(id)];
const nameOf = (id) => sp(id)?.name ?? id;
const signed = (n) => (n < 0 ? `-${-n}` : `+${n}`);

const REFUSE = {
  range: '搆不到。近戰要貼著對方，遠程要看得到、在射程內。',
  combat: '戰鬥中不能休息。',
  twohand: '拿著雙手武器，不能用盾牌。',
  today: '今天已經休息過了。',
  gone: '對方已經不在了。',
};

function rollText(d) {
  return `擲 ${d.roll}${signed(d.total - d.roll)}＝${d.total} 對防禦 ${d.defense}`;
}

function attackText(rec) {
  const d = rec.data;
  const player = rec.actor === 'player';
  const foe = nameOf(d.species);
  const head = player ? `你攻擊${foe}` : `${foe}${sp(d.species)?.answers.attack.form ?? '攻擊'}你`;
  if (!d.hit) return `${head}：${rollText(d)}，沒打中。`;
  const crit = d.crit ? '致命攻擊！' : '';
  const sneak = d.sneak ? '（背襲）' : '';
  const left = player ? (d.hp <= 0 ? `${foe}倒下了。` : `${foe}剩 ${d.hp} 生命。`) : `你剩 ${d.hp} 生命。`;
  return `${head}：${rollText(d)}，命中。${crit}傷害 ${d.damage}${sneak}，${left}`;
}

function engageText(d) {
  const names = d.foes.map((f) => nameOf(f.species));
  const who = [...new Set(names)].join('、');
  const fled = d.flee?.length ? `其他 ${d.flee.length} 隻${nameOf(d.flee[0].species)}四散逃開。` : '';
  if (d.ambush) return `你趁${who}沒察覺先出手！${fled}`;
  if (d.join && d.foes.length === 1 && !d.flee?.length) return `${who}被惹火了，轉頭攻擊你！`;
  if (d.join) return `又有${who}（${names.length} 隻）加入了！${fled}`;
  return `${who}（${names.length} 隻）撲了上來！${fled}`;
}

// 不是戰鬥的動詞回傳 undefined；生物移動不寫（回傳 null）
export function describeFight(rec) {
  const d = rec.data ?? {};
  switch (rec.verb) {
    case 'engage':
      return engageText(d);
    case 'attack':
      return attackText(rec);
    case 'cmove':
      return null;
    case 'leave':
      return d.reason === 'fled' ? `${nameOf(d.species)}逃遠了。` : `${nameOf(d.species)}跟丟了你。`;
    case 'victory':
      return '戰鬥結束，敵人都倒下了。';
    case 'escape':
      return '你甩開了敵人，脫離戰鬥。';
    case 'down':
      return '你倒下了……醒來時回到了起點。';
    case 'rest':
      return `休息 1 小時，回復 ${d.heal} 生命（擲 ${d.roll}${signed(d.heal - d.roll)}），現在 ${d.hp} 生命。`;
    case 'refuse':
      return REFUSE[d.reason] ?? '做不到。';
    default:
      return undefined;
  }
}
