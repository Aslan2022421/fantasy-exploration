// 背包視窗的內容：照分類分組（礦物、木材、植物、動物部位），同一種疊成一行「鐵礦　3 塊」。
// 只排文字，畫在 panels.window

import { COLORS } from './colors.js';

const GROUPS = [
  ['mineral', '礦物', '塊'],
  ['wood', '木材', '段'],
  ['plant', '植物', '株'],
  ['animal', '動物部位', '份'],
];

// bag：{ 材料 id: 數量 }；回傳 panels 用的 entries（time 是 null，不畫時間）
export function bagEntries(bag, data) {
  const out = [];
  for (const [category, title, unit] of GROUPS) {
    const items = data.materials.filter((m) => m.category === category && bag[m.id] > 0);
    if (!items.length) continue;
    if (out.length) out.push({ time: null, text: ' ' });
    out.push({ time: null, text: title, color: COLORS.head });
    for (const m of items) out.push({ time: null, text: `　${m.name}　${bag[m.id]} ${unit}` });
  }
  if (!out.length) out.push({ time: null, text: '背包是空的。', color: COLORS.dim });
  return out;
}
