// 戰鬥量測：1 級的預設角色對每種生物單挑，以及對一整群（物種隻數範圍的中間值）的勝率與回合數。
// 簡化：生物一開始就全部貼著冒險者，不算走位；冒險者每回合打最弱的那一隻；先攻照規則擲。
// 用法：node tools/sim-combat.mjs [職業，預設 warrior] [每種幾場，預設 400]

import { RNG } from 'rot-js';
import { foeStats } from '../src/world/foes.js';
import { heroStats, presetHero } from '../src/world/hero.js';
import { d12, resolveAttack } from '../src/world/rules.js';
import { loadData } from './data.mjs';

const data = loadData();
const cls = process.argv[2] ?? 'warrior';
const RUNS = Number(process.argv[3] ?? 400);
const rng = RNG.clone().setSeed(20261117);

// 體格固定「普通」（生命 18），只看規則本身
const sheet = { ...presetHero(data, { cls }, rng), physique: 1 };
const hero = heroStats(data, sheet);

function fight(stats, count) {
  let hp = hero.hpMax;
  const foes = Array.from({ length: count }, () => ({ hp: stats.hp, init: d12(rng) }));
  const heroInit = d12(rng) + hero.initiative;
  for (let round = 1; round <= 60; round++) {
    const heroTurn = () => {
      const live = foes.filter((f) => f.hp > 0).sort((a, b) => a.hp - b.hp);
      if (!live.length) return;
      const r = resolveAttack(rng, {
        attack: hero.attack,
        defense: stats.defense,
        damage: hero.damage,
        armor: stats.armor,
      });
      live[0].hp -= r.damage;
    };
    const foeTurn = (f) => {
      if (f.hp <= 0 || hp <= 0) return;
      const r = resolveAttack(rng, {
        attack: stats.attack,
        defense: hero.defense(false),
        damage: stats.damage,
        armor: hero.reduction,
      });
      hp -= r.damage;
    };
    for (const f of foes.filter((x) => x.init > heroInit)) foeTurn(f);
    if (hp > 0) heroTurn();
    for (const f of foes.filter((x) => x.init <= heroInit)) foeTurn(f);
    if (hp <= 0) return { win: false, round };
    if (foes.every((f) => f.hp <= 0)) return { win: true, round, hpLeft: hp };
  }
  return { win: false, round: 60 };
}

function measure(stats, count) {
  let wins = 0;
  let rounds = 0;
  let left = 0;
  for (let i = 0; i < RUNS; i++) {
    const r = fight(stats, count);
    if (r.win) {
      wins++;
      left += r.hpLeft;
    }
    rounds += r.round;
  }
  return {
    rate: Math.round((wins / RUNS) * 100),
    rounds: (rounds / RUNS).toFixed(1),
    left: wins ? (left / wins).toFixed(1) : '-',
  };
}

console.log(
  `${sheet.race} ${cls}：生命 ${hero.hpMax}，攻擊 +${hero.attack}，傷害 1d12+${hero.damage}，防禦 ${hero.defense(false)}，減免 ${hero.reduction}；每種 ${RUNS} 場`,
);
console.log('物種　　　　生命 攻擊 防禦 護甲 傷害｜單挑：勝率 回合 剩血｜一群幾隻：勝率 回合 剩血');
for (const sp of data.species) {
  const s = foeStats(sp);
  const n = Math.ceil((sp.count[0] + sp.count[1]) / 2);
  const one = measure(s, 1);
  const pack = measure(s, n);
  const name = sp.name.padEnd(5, '　');
  console.log(
    `${name} ${String(s.hp).padStart(4)} ${String(s.attack).padStart(4)} ${String(s.defense).padStart(4)} ${String(s.armor).padStart(4)} ${String(s.damage).padStart(4)}｜${String(one.rate).padStart(4)}% ${one.rounds.padStart(4)} ${one.left.padStart(4)}｜${n} 隻：${String(pack.rate).padStart(3)}% ${pack.rounds.padStart(4)} ${pack.left.padStart(4)}`,
  );
}
