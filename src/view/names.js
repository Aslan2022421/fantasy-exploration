// 介面上共用的名稱與一行說明：屬性、技能等級、武器、護甲

export const ATTR_NAMES = { str: '力量', dex: '敏捷', int: '智力', per: '感知', wil: '意志', cha: '魅力' };
export const ATTR_ORDER = ['str', 'dex', 'int', 'per', 'wil', 'cha'];
export const RANKS = ['無訓練', '初學', '專家', '大師'];
const TYPES = { slash: '斬', pierce: '刺', blunt: '鈍' };

export const signed = (n) => (n < 0 ? `-${-n}` : `+${n}`);
export const skillName = (data, id) => data.skills[data.skillIndex.get(id)]?.name ?? id;
export const weaponOf = (data, id) => data.weapons[data.weaponIndex.get(id)] ?? null;
export const armorOf = (data, id) => data.armors[data.armorIndex.get(id)] ?? null;

// 「傷害 +0，斬，射程 20 格，雙手」
export function weaponText(w) {
  const parts = [`傷害 ${signed(w.damage)}`, TYPES[w.type]];
  if (w.range) parts.push(`射程 ${w.range} 格`);
  if (w.twoHanded) parts.push('雙手');
  if (w.finesse) parts.push('靈巧');
  if (w.armorBreak) parts.push(`破甲 ${w.armorBreak}`);
  return parts.join('，');
}

// 「減免 3，潛行 -1」或「防禦 +1」
export function armorText(data, a) {
  if (a.kind === 'shield') return `防禦 ${signed(a.defense)}`;
  const pen = Object.entries(a.penalties).map(([id, v]) => `${skillName(data, id)} ${signed(v)}`);
  return [`減免 ${a.reduction}`, ...pen].join('，');
}

// 一件裝備的名稱與說明（武器或護甲）
export function itemText(data, id) {
  const w = weaponOf(data, id);
  if (w) return { name: w.name, kind: 'weapon', text: weaponText(w) };
  const a = armorOf(data, id);
  if (a) return { name: a.name, kind: a.kind, text: armorText(data, a) };
  return { name: id, kind: null, text: '' };
}
