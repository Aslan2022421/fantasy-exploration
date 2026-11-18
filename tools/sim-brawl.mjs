// 怪物打動物的量測：每種混食怪物對每種動物，一對一的勝率（雙方一開始就貼著、攻擊一律 9 刻、怪物先手；
// 會再生的照 foes.js 的 regenHp 補血）。看哪種怪物打得過哪種動物，平衡怪物與生態用。
// 用法：node tools/sim-brawl.mjs [每組幾場，預設 400]

import { RNG } from 'rot-js';
import { foeStats, regenHp } from '../src/world/foes.js';
import { resolveAttack } from '../src/world/rules.js';
import { loadData } from './data.mjs';

const data = loadData();
const RUNS = Number(process.argv[2] ?? 400);
const rng = RNG.clone().setSeed(20261118);

// a 先手；回傳 a 贏不贏
function duel(spA, spB) {
  const sides = [spA, spB].map((sp) => ({ sp, s: foeStats(sp), hp: foeStats(sp).hp, hurtAt: null, next: 0 }));
  sides[1].next = 1;
  for (let guard = 0; guard < 2000; guard++) {
    const me = sides[0].next <= sides[1].next ? sides[0] : sides[1];
    const you = me === sides[0] ? sides[1] : sides[0];
    const now = me.next;
    const r = resolveAttack(rng, {
      attack: me.s.attack,
      defense: you.s.defense,
      damage: me.s.damage,
      armor: you.s.armor,
    });
    you.hp = regenHp(you.sp, you.s.hp, you.hp, you.hurtAt, now) - r.damage;
    you.hurtAt = now;
    if (you.hp <= 0) return me === sides[0];
    me.next += me.s.attackTicks;
  }
  return false;
}

const monsters = data.species.filter((s) => s.diet === 'omnivore');
const animals = data.species.filter((s) => s.diet !== 'omnivore');
console.log(`一對一勝率（怪物先手，每組 ${RUNS} 場）`);
console.log(`動物　　　　 ${monsters.map((m) => m.name.padEnd(4, '　')).join(' ')}`);
for (const a of animals) {
  const cells = monsters.map((m) => {
    let w = 0;
    for (let i = 0; i < RUNS; i++) if (duel(m, a)) w++;
    return `${String(Math.round((w / RUNS) * 100)).padStart(5)}%  `;
  });
  console.log(`${a.name.padEnd(6, '　')} ${cells.join('')}`);
}
