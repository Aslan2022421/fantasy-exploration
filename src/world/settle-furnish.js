// 房間裡的家具照用途擺（settle-layouts.js 用）：
// - 門內那一格空著；住戶站的格子（小屋）貼著它
// - 床靠在離門最遠的牆角；櫃子靠牆、放在床邊；桌子放在房間中間、不貼門；椅子貼著桌子（神殿裡排在門與祭壇之間，小屋裡靠在床或櫃子旁）
// - 祭壇在門對面那面牆的正中；攤位靠牆、離門的走道遠；木桶放牆角
// - 每放一件擋路的家具都確認室內（四方向）還連在一起，不行就換下一個候選格
// 同分時用雜湊挑，不看生成順序

import { BED, BLOCKING } from './settle-codes.js';

const ORDER = ['altar', BED, 'cabinet', 'table', 'chair', 'stall', 'barrel'];
const STEPS4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

// cells：室內每一格 { i, j }；inners：門內那一格（可能兩格）；items：家具代碼；wantSpot：要不要留住戶站的格子；
// tie(c, k)：同分時的雜湊。回傳 { placed: [{ i, j, code }], spot } 或 null（擺不下）
export function furnishRoom(cells, inners, items, wantSpot, tie) {
  const key = (c) => `${c.i},${c.j}`;
  const inside = new Set(cells.map(key));
  const innerKeys = new Set(inners.map(key));
  const walls = (c) => STEPS4.filter(([di, dj]) => !inside.has(`${c.i + di},${c.j + dj}`)).length;
  const fromDoor = (c) => Math.min(...inners.map((d) => Math.abs(c.i - d.i) + Math.abs(c.j - d.j)));
  const near = (a, b) => Math.abs(a.i - b.i) + Math.abs(a.j - b.j) === 1;
  const mid = {
    i: cells.reduce((s, c) => s + c.i, 0) / cells.length,
    j: cells.reduce((s, c) => s + c.j, 0) / cells.length,
  };
  const used = new Map(); // key → 代碼
  const placed = [];

  let spot = null;
  if (wantSpot) {
    const cand = cells
      .filter((c) => !innerKeys.has(key(c)) && inners.some((d) => near(c, d)))
      .sort((a, b) => tie(a, 1) - tie(b, 1));
    if (!cand.length) return null;
    spot = cand[0];
    used.set(key(spot), 'spot');
  }

  const ofCode = (code) => placed.filter((p) => p.code === code);
  // 每種家具的分數（越小越好）；回傳 null 表示這格不行
  const score = {
    [BED]: (c) => (walls(c) ? -fromDoor(c) * 10 - walls(c) * 3 : null),
    cabinet: (c) => (walls(c) ? (ofCode(BED).some((b) => near(b, c)) ? 0 : 6) - fromDoor(c) : null),
    table: (c) => (fromDoor(c) <= 1 && cells.length > 6 ? null : walls(c) * 5 + Math.hypot(c.i - mid.i, c.j - mid.j)),
    chair: (c) => {
      const altar = ofCode('altar')[0];
      if (altar) return Math.abs(Math.abs(c.i - altar.i) + Math.abs(c.j - altar.j) - 2) * 5 + walls(c);
      const tables = ofCode('table');
      if (tables.length) return tables.some((t) => near(t, c)) ? fromDoor(c) : null;
      const by = placed.some((p) => (p.code === BED || p.code === 'cabinet') && near(p, c));
      return walls(c) ? (by ? 0 : 4) : null;
    },
    altar: (c) => (walls(c) ? -fromDoor(c) * 10 + Math.hypot(c.i - mid.i, c.j - mid.j) : null),
    stall: (c) => (walls(c) ? -fromDoor(c) * 10 - walls(c) : null),
    barrel: (c) => (walls(c) >= 2 ? -fromDoor(c) : walls(c) ? 5 - fromDoor(c) : null),
  };

  // 擋路的家具放下去之後，空著的格子（含門內）要四方向連在一起
  const stillOpen = () => {
    const open = cells.filter((c) => !BLOCKING.has(used.get(key(c))));
    const set = new Set(open.map(key));
    const seen = new Set([key(open[0])]);
    const q = [open[0]];
    for (let h = 0; h < q.length; h++)
      for (const [di, dj] of STEPS4) {
        const k = `${q[h].i + di},${q[h].j + dj}`;
        if (set.has(k) && !seen.has(k)) {
          seen.add(k);
          q.push({ i: q[h].i + di, j: q[h].j + dj });
        }
      }
    return seen.size === set.size;
  };

  const sorted = [...items].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
  for (let n = 0; n < sorted.length; n++) {
    const code = sorted[n];
    const cand = cells
      .filter((c) => !innerKeys.has(key(c)) && !used.has(key(c)))
      .map((c) => ({ c, s: score[code](c) }))
      .filter((o) => o.s != null)
      .sort((a, b) => a.s - b.s || tie(a.c, 10 + n) - tie(b.c, 10 + n));
    let ok = false;
    for (const { c } of cand) {
      used.set(key(c), code);
      if (!BLOCKING.has(code) || stillOpen()) {
        placed.push({ ...c, code });
        ok = true;
        break;
      }
      used.delete(key(c));
    }
    if (!ok && code === BED) return null; // 床一定要擺得下；其他家具擺不下就省掉
  }
  return { placed, spot };
}
