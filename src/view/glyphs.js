// 地面的字形與顏色。字元原則：語意優先、形狀輔助、顏色補充；一個字元只代表一件事，
// 意思相同、材質不同時靠顏色分（^ 是隆起的高處：沙黃色是沙丘、灰色是山地）。
// 一格四層都有東西時只畫最上面那層的字元，顏色跟著那一層：
//   水文 > 物件 > 生態覆蓋 > 地貌（山地的 ^ ▲）> 地表材質 > 起伏點
// 物件由 stackview.js 疊上去；這裡管其餘幾層。背景永遠是地面（水或材質）的顏色。
// - 起伏：空白 → . → · → ∙，由平地到有起伏，依坡度選（泥土、雪，以及岩石、碎石沒露出的地方）
// - 水文：深水大多空白、偶爾 ≈；淺水與沼澤是 - 與 ~（沼澤墨綠色）；結冰的淺水是冰面 ═
// - 材質：沙地平坦處空白、-、~，坡陡是沙丘 ^；岩石 ■、碎石 °
// - 地貌：山峰（山地裡附近最高的一格）是 ▲；其餘山地只有一部分格子畫 ^，
//   剩下的露出材質（雪是起伏點、陡坡岩石 ■、緩坡碎石 °），陡不陡交給材質
// - 覆蓋：資料裡每種一個字元（, ' " : ; * τ Γ |）
// 同一種樣子裡挑哪個字，用座標的雜湊決定，畫面不會閃。這裡只算字形，不碰畫布，可以在 Node 裡測

import { hash01 } from '../world/noise.js';

export const RELIEF = [' ', '.', '·', '∙'];
// 坡度門檻：只有比較陡的地方才畫起伏點，平地空著
export const RELIEF_STEPS = [69, 85, 100];
export const MOUNTAIN_MARK = 0.3; // 非山峰的山地格畫 ^ 的比例
export const ROCK_MARK = 0.25; // 岩石格畫 ■ 的比例
export const DUNE_STEEP = 55; // 沙地坡度到這裡以上是沙丘 ^

export function reliefGlyph(slope) {
  let i = 0;
  while (i < RELIEF_STEPS.length && slope >= RELIEF_STEPS[i]) i++;
  return RELIEF[i];
}

// 水文的字形：style 是水文資料的 style，a 是這格的雜湊（0～1）
export function waterGlyph(style, a) {
  if (style === 'deep') return a < 0.12 ? '≈' : ' ';
  return a < 0.5 ? '-' : '~';
}

// 地表材質的字形
export function surfaceGlyph(style, slope, a) {
  switch (style) {
    case 'sand':
      if (slope >= DUNE_STEEP) return '^';
      return a < 0.6 ? ' ' : a < 0.85 ? '-' : '~';
    case 'rock':
      return a < ROCK_MARK ? '■' : reliefGlyph(slope);
    case 'gravel':
      return a < 0.5 ? '°' : reliefGlyph(slope);
    case 'ice':
      return a < 0.4 ? '═' : ' ';
    default:
      return reliefGlyph(slope);
  }
}

// 一格（不含物件）的字形與字元顏色。c：{ water（水文 style 或 null）, surface（材質 style）,
// mountain（是不是山地）, peak（是不是山峰）, cover（覆蓋的字元或 null）, slope,
// a（挑材質字元的雜湊）, b（決定山地這格畫不畫 ^ 的雜湊，跟 a 分開，免得 ^ 吃掉 ■ 與 °）}。
// 回傳 'water' | 'cover' | 'surface' 告訴呼叫的人字元顏色取哪一層
export function cellGlyph(c) {
  if (c.water && c.surface !== 'ice') return { glyph: waterGlyph(c.water, c.a), ink: 'water' };
  if (c.surface === 'ice') return { glyph: surfaceGlyph('ice', 0, c.a), ink: 'surface' };
  if (c.cover) return { glyph: c.cover, ink: 'cover' };
  if (c.peak) return { glyph: '▲', ink: 'surface' };
  if (c.mountain && c.b < MOUNTAIN_MARK) return { glyph: '^', ink: 'surface' };
  return { glyph: surfaceGlyph(c.surface, c.slope, c.a), ink: 'surface' };
}

// 世界上 (x, y) 那格地面的樣子：{ glyph, ink（字元色，data.palette 的索引） }
export function lookAt(world, data, x, y) {
  const w = world.waterAt(x, y);
  const s = world.surfaceAt(x, y);
  const k = world.coverAt(x, y);
  const r = cellGlyph({
    water: w >= 0 ? data.waters[w].style : null,
    surface: data.surfaces[s].style,
    mountain: data.landforms[world.landformAt(x, y)].style === 'mountain',
    peak: world.peakAt(x, y),
    cover: k >= 0 ? data.covers[k].glyph : null,
    slope: world.slopeAt(x, y),
    a: hash01(world.seed, x, y, 103),
    b: hash01(world.seed, x, y, 104),
  });
  const base = data.paletteBase;
  const ink = r.ink === 'water' ? base.water + w : r.ink === 'cover' ? base.cover + k : base.surface + s;
  return { glyph: r.glyph, ink };
}
