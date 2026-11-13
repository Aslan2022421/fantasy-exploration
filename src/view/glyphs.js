// 地形的字形（使用者定的原則）：字形代表「地表長什麼樣」，顏色代表「是什麼材質」，亮度輔助（高低、深淺）。
// - 起伏：空白 → . → · → ∙，由平地到有起伏，所有陸地共用，依坡度選
// - 植被（草地）：, 碎葉、細草；' 稀疏草叢；" 較高的草叢；: 苔蘚；; 混合植被
// - 波紋：空白、-、~、≈。深藍色是水，沙黃色是沙地
// - 高起：^ 沙黃色是沙丘；山地坡陡用實心三角 ▲（山坡），其餘用線三角 ^（山地）
// 每種地形用哪一套寫在資料的 style；同一種樣子裡挑哪個字，用座標的雜湊決定，畫面不會閃。
// 這裡只算字形，不碰畫布，可以在 Node 裡測

import { hash01 } from '../world/noise.js';

export const RELIEF = [' ', '.', '·', '∙'];
export const RELIEF_STEPS = [39, 55, 69]; // 坡度門檻（量過：陸地約一半在 39 以下）
export const MOUNTAIN_STEEP = 45; // 山地坡度到這裡以上是山坡 ▲
export const DUNE_STEEP = 55; // 沙地坡度到這裡以上是沙丘 ^

export function reliefGlyph(slope) {
  let i = 0;
  while (i < RELIEF_STEPS.length && slope >= RELIEF_STEPS[i]) i++;
  return RELIEF[i];
}

// 草地的植被：看生態的溫度與濕度。a 是這格的雜湊（0～1）
function vegetation(temperature, moisture, a) {
  if (temperature === 'cold' && moisture === 'wet') return a < 0.5 ? ':' : ',';
  if (moisture === 'wet') return a < 0.6 ? '"' : "'";
  if (moisture === 'dry') return a < 0.6 ? ',' : "'";
  return a < 0.45 ? "'" : a < 0.8 ? ',' : '"';
}

// c：{ style, slope, temperature, moisture, edge（是不是生態交界）, a、b（這格的兩個雜湊值） }
export function terrainGlyph(c) {
  switch (c.style) {
    case 'grass':
      if (c.slope >= RELIEF_STEPS[2]) return reliefGlyph(c.slope); // 很陡的草坡看得出起伏
      if (c.edge && c.b < 0.5) return ';'; // 生態交界是混合植被
      return vegetation(c.temperature, c.moisture, c.a);
    case 'mud':
      if (c.temperature === 'cold' && c.a < 0.3) return ':'; // 寒冷的泥地長苔蘚
      if (c.a < 0.15) return ','; // 零星碎葉
      return reliefGlyph(c.slope);
    case 'snow':
      return reliefGlyph(c.slope); // 雪面平滑，只有起伏
    case 'sand':
      if (c.slope >= DUNE_STEEP) return '^';
      return c.a < 0.6 ? ' ' : c.a < 0.85 ? '-' : '~';
    case 'mountain':
      return c.slope >= MOUNTAIN_STEEP ? '▲' : '^';
    case 'deep-water':
      return c.a < 0.12 ? '≈' : ' ';
    case 'shallow-water':
      return c.a < 0.5 ? '-' : '~';
    default:
      return '?';
  }
}

export const STYLES = ['grass', 'mud', 'snow', 'sand', 'mountain', 'deep-water', 'shallow-water'];

// 世界上 (x, y) 那格地面的字形（遊戲畫面與比較頁共用）
export function glyphAt(world, data, x, y) {
  const t = data.terrains[world.terrainAt(x, y)];
  const bi = world.biomeAt(x, y);
  const biome = data.biomes[bi];
  let edge = false;
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]) {
    const n = world.biomeAt(x + dx, y + dy);
    if (n >= 0 && n !== bi) edge = true;
  }
  return terrainGlyph({
    style: t.style,
    slope: world.slopeAt(x, y),
    temperature: biome.temperature,
    moisture: biome.moisture,
    edge,
    a: hash01(world.seed, x, y, 101),
    b: hash01(world.seed, x, y, 102),
  });
}
