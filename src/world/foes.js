// 生物換成規則草案的怪物欄位（HP、Attack、Defense、Armor、Damage），用階段 4 的數值塊（data/blocks.js）。
// 比例拿規則草案的森林狼對照階段 4 的狼來定：狼換出來 HP 15、Attack +3、Defense +3。
// 每個動作花幾刻照冒險者「身高決定速度」的規則換到體型

import { buildBlock } from '../data/blocks.js';

const ATTACK_BY_DIE = { 4: 1, 6: 2, 8: 3, 10: 4, 12: 5 };
const DAMAGE_BY_DIE = { 4: -4, 6: -3, 8: -2, 10: -1, 12: 0 }; // 讓 1d12 的平均接近原本的骰子
const DEFENSE_BY_SIZE = { tiny: 5, small: 4, human: 3, large: 2, huge: 1 }; // 越大越好打中
// 小型對矮小 12 刻、跟人差不多對中等 9 刻、貨車大小以上對高大 6 刻
const TICKS_BY_SIZE = { tiny: 12, small: 12, human: 9, large: 6, huge: 6 };

export function foeStats(sp, env = {}) {
  const b = buildBlock(sp.answers, env);
  return {
    hp: Math.ceil(b.hp * 2.5),
    attack: ATTACK_BY_DIE[b.die],
    defense: 7 + DEFENSE_BY_SIZE[sp.answers.size],
    damage: DAMAGE_BY_DIE[b.die] + b.bonus,
    armor: b.armor,
    ticks: TICKS_BY_SIZE[sp.answers.size],
  };
}

const signed = (n) => (n < 0 ? `-${-n}` : `+${n}`);

// 懸停與查看用：「生命 15/15，攻擊 +3，防禦 10，護甲 1，傷害 1d12-2，每個動作 9 刻」
export function foeText(stats, hp = stats.hp) {
  const dmg = stats.damage ? signed(stats.damage) : '';
  return `生命 ${hp}/${stats.hp}，攻擊 ${signed(stats.attack)}，防禦 ${stats.defense}，護甲 ${stats.armor}，傷害 1d12${dmg}，每個動作 ${stats.ticks} 刻`;
}
