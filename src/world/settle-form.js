// 聚落挑外形（settlements.js 的 planSettle 用；使用者選 B：照所在的地形挑）：
// - 能蓋的格子：沒有水、冰、山，高度落在最多格子的相鄰兩層裡
// - 圖樣的橢圓裡全都能蓋：靠水的拉長成長形（水在南北就橫著、在東西就直著），其餘是圓形；村莊有一成半是方形
// - 橢圓裡能蓋的有六成以上：照地形圍（貼著坡、山腳、水邊）
// - 整區都找不到六成的位置，降到三成半再找一次（聚落小一點）；再少就不放
// 只看這一區的格子與種子＋錨點的雜湊

import { LAND } from './landform.js';
import { hash01 } from './noise.js';

export const FORM = { terrain: 0.6, least: 0.35, square: 0.15 };

// z：一區生成時共用的格子；x, y：圖樣左上角（這一區裡的座標）；W, H：圖樣大小；ids：{ NONE, SWAMP, ICE }
// 回傳 { ok: Uint8Array, cover: 橢圓裡能蓋的比例 }
export function buildMask(z, x, y, W, H, ids) {
  const g = (i, j) => (y + j + z.E) * z.G + (x + i + z.E);
  const inEllipse = (i, j) => ((i - (W - 1) / 2) / (W / 2 - 1)) ** 2 + ((j - (H - 1) / 2) / (H / 2 - 1)) ** 2 <= 1;
  const usable = (c) => z.wAll[c] === ids.NONE && z.sAll[c] !== ids.ICE && z.h[c] <= LAND.mountain;
  const count = new Map();
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const c = g(i, j);
      if (inEllipse(i, j) && usable(c)) count.set(z.tier[c], (count.get(z.tier[c]) ?? 0) + 1);
    }
  let band = -1;
  let best = -1;
  for (const [t, n] of count) {
    const m = n + (count.get(t + 1) ?? 0);
    if (m > best) [band, best] = [t, m];
  }
  const ok = new Uint8Array(W * H);
  let inside = 0;
  let good = 0;
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const c = g(i, j);
      const t = z.tier[c];
      ok[j * W + i] = usable(c) && (t === band || t === band + 1) ? 1 : 0;
      if (!inEllipse(i, j)) continue;
      inside++;
      good += ok[j * W + i];
    }
  return { ok, cover: good / inside };
}

// 水在哪個方向多：'ns'（南北）、'ew'（東西）或 null（附近沒有水）；lake(i, j) 用這一區的座標
export function waterSide(x, y, W, H, R, lake) {
  let ns = 0;
  let ew = 0;
  for (let j = y - R; j < y + H + R; j++)
    for (let i = x - R; i < x + W + R; i++) {
      const out = i < x - 2 || i >= x + W + 2 || j < y - 2 || j >= y + H + 2;
      if (!out || !lake(i, j)) continue;
      const dx = Math.max(x - i, 0, i - (x + W - 1));
      const dy = Math.max(y - j, 0, j - (y + H - 1));
      if (dy >= dx) ns++;
      else ew++;
    }
  if (!ns && !ew) return null;
  return ns >= ew ? 'ns' : 'ew';
}

// 挑外形：回傳 { form, ok, x, y, w, h } 或 null。def：聚落資料；spot：{ x, y }（圖樣左上角）；
// fitsZone(x, y, w, h)：整塊在這一區裡；sideOf(x, y, w, h)：waterSide 的結果；min：照地形外形最少要多少能蓋
export function pickForm(z, def, spot, ids, seed, X0, Y0, fitsZone, sideOf, min = FORM.terrain) {
  const W = def.w;
  const H = def.h;
  const m = buildMask(z, spot.x, spot.y, W, H, ids);
  if (m.cover < min) return null;
  if (m.cover < 1) return { form: 'terrain', ok: m.ok, x: spot.x, y: spot.y, w: W, h: H };
  const side = sideOf(spot.x, spot.y, W, H);
  if (side === 'ew') {
    // 水在東西兩側：轉成直的長形（中心不動），放不下就照橫的
    const x = spot.x + ((W - H) >> 1);
    const y = spot.y + ((H - W) >> 1);
    if (fitsZone(x, y, H, W)) {
      const v = buildMask(z, x, y, H, W, ids);
      if (v.cover === 1) return { form: 'long', ok: v.ok, x, y, w: H, h: W };
    }
  }
  if (side) return { form: 'long', ok: m.ok, x: spot.x, y: spot.y, w: W, h: H };
  const square = def.id === 'village' && hash01(seed, X0 + spot.x, Y0 + spot.y, 9304) < FORM.square;
  return { form: square ? 'square' : 'round', ok: m.ok, x: spot.x, y: spot.y, w: W, h: H };
}
