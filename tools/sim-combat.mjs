// 戰鬥量測：1 級的預設角色對每種生物單挑，以及對一整群（物種隻數範圍的中間值）的勝率、出手次數、剩下的生命。
// 簡化：生物一開始就全部貼著冒險者，不算走位；冒險者每次打最弱的那一隻。
// 照時間輪流：冒險者每個動作的刻數看身高；生物貼著打，攻擊一律 9 刻（速度只管走路，這裡用不到）；同時到時冒險者先。
// 用法：node tools/sim-combat.mjs [職業，預設 warrior] [每種幾場，預設 400] [身高 0 矮小／1 中等／2 高大，預設 1]

import { RNG } from 'rot-js';
import { foeStats, regenHp } from '../src/world/foes.js';
import { heroStats, presetHero } from '../src/world/hero.js';
import { resolveAttack } from '../src/world/rules.js';
import { loadData } from './data.mjs';

const data = loadData();
const cls = process.argv[2] ?? 'warrior';
const RUNS = Number(process.argv[3] ?? 400);
const height = Number(process.argv[4] ?? 1);
const rng = RNG.clone().setSeed(20261117);

// 體格固定「普通」（生命 18），只看規則本身
const sheet = { ...presetHero(data, { cls }, rng), physique: 1, height };
const hero = heroStats(data, sheet);

// sp：物種（會再生的照 foes.js 的 regenHp 補血）
function fight(stats, count, sp) {
  let hp = hero.hpMax;
  let heroNext = 0;
  let swings = 0;
  const foes = Array.from({ length: count }, () => ({ hp: stats.hp, next: 0, hurtAt: null }));
  const hpNow = (f, now) => regenHp(sp, stats.hp, f.hp, f.hurtAt, now);
  for (let guard = 0; guard < 5000; guard++) {
    const live = foes.filter((f) => f.hp > 0);
    if (!live.length) return { win: true, swings, hpLeft: hp };
    const soonest = live.reduce((a, b) => (b.next < a.next ? b : a));
    if (heroNext <= soonest.next) {
      const target = live.sort((a, b) => hpNow(a, heroNext) - hpNow(b, heroNext))[0];
      const r = resolveAttack(rng, {
        attack: hero.attack,
        defense: stats.defense,
        damage: hero.damage,
        armor: stats.armor,
      });
      target.hp = hpNow(target, heroNext) - r.damage;
      target.hurtAt = heroNext;
      heroNext += hero.ticks;
      swings++;
    } else {
      const r = resolveAttack(rng, {
        attack: stats.attack,
        defense: hero.defense(false),
        damage: stats.damage,
        armor: hero.reduction,
      });
      hp -= r.damage;
      soonest.next += stats.attackTicks; // 貼著打，不走路
      if (hp <= 0) return { win: false, swings };
    }
  }
  return { win: false, swings };
}

function measure(stats, count, sp) {
  let wins = 0;
  let swings = 0;
  let left = 0;
  for (let i = 0; i < RUNS; i++) {
    const r = fight(stats, count, sp);
    if (r.win) {
      wins++;
      left += r.hpLeft;
    }
    swings += r.swings;
  }
  return {
    rate: Math.round((wins / RUNS) * 100),
    swings: (swings / RUNS).toFixed(1),
    left: wins ? (left / wins).toFixed(1) : '-',
  };
}

console.log(
  `${sheet.race} ${cls}（每個動作 ${hero.ticks} 刻）：生命 ${hero.hpMax}，攻擊 +${hero.attack}，傷害 1d12+${hero.damage}，防禦 ${hero.defense(false)}，減免 ${hero.reduction}；每種 ${RUNS} 場`,
);
console.log('物種　　　　生命 攻擊 防禦 護甲 傷害 走｜單挑：勝率 出手 剩血｜一群幾隻：勝率 出手 剩血');
for (const sp of data.species) {
  const s = foeStats(sp);
  const n = Math.ceil((sp.count[0] + sp.count[1]) / 2);
  const one = measure(s, 1, sp);
  const pack = measure(s, n, sp);
  const name = sp.name.padEnd(5, '　');
  const col = (v, w = 4) => String(v).padStart(w);
  console.log(
    `${name} ${col(s.hp)} ${col(s.attack)} ${col(s.defense)} ${col(s.armor)} ${col(s.damage)} ${col(s.moveTicks, 3)}｜${col(one.rate)}% ${col(one.swings)} ${col(one.left)}｜${n} 隻：${col(pack.rate, 3)}% ${col(pack.swings)} ${col(pack.left)}`,
  );
}
