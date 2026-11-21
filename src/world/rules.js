// 判定的基本規則（規則草案第一、二章）：只用 D12、擲高為好，達到難度就成功。
// 純函式；rng 是 ROT.js 的 RNG（getUniformInt）

// 屬性值 → 屬性修正值：1 是 −5、2～3 是 −4，每 2 點一級，10～11 是 0，20 是 +5
export const attrMod = (v) => Math.floor((v - 10) / 2);

export const d12 = (rng) => rng.getUniformInt(1, 12);

// 時間：1 刻＝0.25 秒，1 回合（6 秒）＝24 刻
export const TICKS_PER_HOUR = 4 * 60 * 60;
export const TICKS_PER_DAY = 24 * TICKS_PER_HOUR;
const START_TICKS = 8 * TICKS_PER_HOUR; // 開局是第 1 天早上 8 點

// 第幾天（從 0 起）與時鐘「08:00:06」
export const dayOf = (ticks) => Math.floor((ticks + START_TICKS) / TICKS_PER_DAY);
export function clockOf(ticks) {
  const s = Math.floor((ticks + START_TICKS) / 4) % (24 * 3600);
  const two = (n) => String(n).padStart(2, '0');
  return `${two(Math.floor(s / 3600))}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}`;
}

// 一次攻擊：攻方擲 1D12＋攻擊修正，達到防禦值就命中；命中時傷害 1D12＋傷害修正 − 護甲減免（最低 0），
// 自然 12 而且命中是致命攻擊，多擲一顆 D12。bonus 是命中才加的額外傷害（背襲）
export function resolveAttack(rng, { attack, defense, damage, armor, bonus = 0 }) {
  const roll = d12(rng);
  const total = roll + attack;
  const hit = total >= defense;
  if (!hit) return { roll, total, defense, hit, crit: false, dice: [], damage: 0 };
  const crit = roll === 12;
  const dice = crit ? [d12(rng), d12(rng)] : [d12(rng)];
  const sum = dice.reduce((a, b) => a + b, 0);
  return { roll, total, defense, hit, crit, dice, damage: Math.max(0, sum + damage + bonus - armor) };
}
