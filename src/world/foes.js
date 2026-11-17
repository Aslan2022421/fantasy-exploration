// 生物換成規則草案的怪物欄位（HP、Attack、Defense、Armor、Damage、速度），用階段 4 的數值塊（data/blocks.js）。
// 比例拿規則草案的森林狼對照階段 4 的狼來定：狼換出來 HP 15、Attack +3、Defense +3

import { buildBlock } from '../data/blocks.js';

const ATTACK_BY_DIE = { 4: 1, 6: 2, 8: 3, 10: 4, 12: 5 };
const DAMAGE_BY_DIE = { 4: -4, 6: -3, 8: -2, 10: -1, 12: 0 }; // 讓 1d12 的平均接近原本的骰子
const DEFENSE_BY_SIZE = { tiny: 5, small: 4, human: 3, large: 2, huge: 1 }; // 越大越好打中
export const FOE_SPEED = 6; // 每回合幾格（之後依物種填）

export function foeStats(sp, env = {}) {
  const b = buildBlock(sp.answers, env);
  return {
    hp: Math.ceil(b.hp * 2.5),
    attack: ATTACK_BY_DIE[b.die],
    defense: 7 + DEFENSE_BY_SIZE[sp.answers.size],
    damage: DAMAGE_BY_DIE[b.die] + b.bonus,
    armor: b.armor,
    speed: FOE_SPEED,
  };
}

const signed = (n) => (n < 0 ? `-${-n}` : `+${n}`);

// 懸停與查看用：「生命 15/15，攻擊 +3，防禦 10，護甲 1，傷害 1d12-2」
export function foeText(stats, hp = stats.hp) {
  const dmg = stats.damage ? signed(stats.damage) : '';
  return `生命 ${hp}/${stats.hp}，攻擊 ${signed(stats.attack)}，防禦 ${stats.defense}，護甲 ${stats.armor}，傷害 1d12${dmg}`;
}
