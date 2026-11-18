// 生物換成規則草案的怪物欄位（HP、Attack、Defense、Armor、Damage、Speed），用階段 4 的數值塊（data/blocks.js）。
// 比例拿規則草案的森林狼對照階段 4 的狼來定：狼換出來 HP 15、Attack +3、Defense +3。
// 速度每種生物自己寫（資料的 moveTicks：走一格幾刻），只管走路；攻擊一律 ATTACK_TICKS 刻

import { buildBlock } from '../data/blocks.js';

const ATTACK_BY_DIE = { 4: 1, 6: 2, 8: 3, 10: 4, 12: 5 };
const DAMAGE_BY_DIE = { 4: -4, 6: -3, 8: -2, 10: -1, 12: 0 }; // 讓 1d12 的平均接近原本的骰子
const DEFENSE_BY_SIZE = { tiny: 5, small: 4, human: 3, large: 2, huge: 1 }; // 越大越好打中
export const ATTACK_TICKS = 9; // 生物攻擊一次幾刻

export function foeStats(sp, env = {}) {
  const b = buildBlock(sp.answers, env);
  return {
    hp: Math.ceil(b.hp * 2.5),
    attack: ATTACK_BY_DIE[b.die],
    defense: 7 + DEFENSE_BY_SIZE[sp.answers.size],
    damage: DAMAGE_BY_DIE[b.die] + b.bonus,
    armor: b.armor,
    moveTicks: sp.moveTicks,
    attackTicks: ATTACK_TICKS,
  };
}

// 再生：受傷後每 every 刻回 amount 生命，回到滿為止；hp 是上次受傷後剩的、hurtAt 是那一刻。
// 用時間算，不另外寫紀錄（遊戲還沒有火焰傷害，「受火那段停止」先不判定）
export function regenHp(sp, max, hp, hurtAt, time) {
  const regen = sp.traits?.find((t) => t.id === 'regenerate');
  if (hp == null || !regen || hurtAt == null || hp <= 0) return hp;
  const ticks = Math.max(0, time - hurtAt);
  return Math.min(max, hp + Math.floor(ticks / regen.every) * regen.amount);
}

const signed = (n) => (n < 0 ? `-${-n}` : `+${n}`);

// 右鍵查看用：「攻擊 +3，防禦 10，護甲 1，傷害 1d12-2，走一格 6 刻」
export function foeText(stats) {
  const dmg = stats.damage ? signed(stats.damage) : '';
  return `攻擊 ${signed(stats.attack)}，防禦 ${stats.defense}，護甲 ${stats.armor}，傷害 1d12${dmg}，走一格 ${stats.moveTicks} 刻`;
}
