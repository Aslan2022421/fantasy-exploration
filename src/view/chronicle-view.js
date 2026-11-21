// H 視窗後三頁的內容（從 chronicle.js 算）：世界歷史（照天分段的年表）、生涯（數字卡＋自己的年表）、圖鑑（見過的物種）。
// 這裡只排資料，畫在 history-view.js

import { fill } from '../world/event-facts.js';
import { foeStats, foeText } from '../world/foes.js';
import { regionLabel } from '../world/place.js';
import { clockOf, dayOf } from '../world/rules.js';
import { COLORS } from './colors.js';

export const HISTORY_TABS = ['紀錄', '世界歷史', '生涯', '圖鑑'];
const DIETS = { herbivore: '草食', predator: '掠食', omnivore: '混食' };
const SIZES = { tiny: '比家貓小', small: '半身人大小', human: '人的大小', large: '貨車大小', huge: '比貨車大' };
export const stamp = (t) => `第 ${dayOf(t) + 1} 天 ${clockOf(t).slice(0, 5)}`;
const note = (text, color = COLORS.dim) => ({ time: null, text, color });
// 年表上的標記顏色：據點的事紅、聚落的事黃、冒險者自己的白
const markColor = (e) => (e.facts.place ? COLORS.bad : e.facts.settle ? COLORS.head : COLORS.player);

// 事件照天分段：[{ 第 N 天（標題）}, { time: 08:12, text: ● 一句 }]
function timeline(events, hero) {
  const rows = [];
  let day = -1;
  for (const e of events) {
    const d = dayOf(e.time);
    if (d !== day) {
      if (rows.length) rows.push(note(' '));
      rows.push({ time: null, text: `第 ${d + 1} 天`, color: COLORS.head });
      day = d;
    }
    rows.push({
      time: clockOf(e.time).slice(0, 5),
      text: `● ${fill(e.def.history, { ...e.facts, hero: hero(e) })}`,
      color: markColor(e),
    });
  }
  return rows;
}

// 世界歷史：寫進世界的事件，冒險者寫成「一位精靈遊俠」
export function worldHistory(chronicle) {
  const rows = timeline(
    chronicle.events.filter((e) => e.def.world),
    (e) => `一位${e.facts.hero}`,
  );
  return rows.length ? rows : [note('還沒有發生值得記下來的事。')];
}

// 生涯：{ title, tiles: [[標題, 數字]], rows 自己的年表（冒險者寫成「你」）}
export function lifePage(chronicle, state) {
  const s = chronicle.stats();
  const killed = Object.values(s.kills).reduce((a, b) => a + b, 0);
  const tiles = [
    ['走了幾步', s.moves],
    ['到過幾區', s.zones],
    ['打倒幾隻', killed],
    ['打倒幾種', Object.keys(s.kills).length],
    ['打贏幾場', s.fights],
    ['倒下幾次', s.downs],
    ['清光據點', s.clears],
    ['打開寶箱', s.chests],
    ['採集幾次', s.gathers],
    ['見過幾種', Object.keys(s.firstSeen).length],
    ['說過幾次話', s.talks],
  ];
  const rows = timeline(
    chronicle.events.filter((e) => e.def.life),
    () => '你',
  );
  return {
    title: `${chronicle.hero}　現在是${stamp(state.time)}`,
    tiles,
    rows: rows.length ? rows : [note('還沒有值得記下來的事。')],
  };
}

// 圖鑑：見過的物種照第一次見到的順序，[{ id, glyph, color, name, kills, info: [{ text, color }] }]；
// 只寫看過的（在哪裡、一群幾隻、體型），打倒過的再寫食性與數值
export function bestiary(chronicle, world, data) {
  const s = chronicle.stats();
  return Object.entries(s.firstSeen)
    .sort((a, b) => a[1].time - b[1].time)
    .map(([id, first]) => {
      const sp = data.species[data.speciesIndex.get(id)];
      if (!sp) return null;
      const where = first.at && world ? regionLabel(world, data, first.at.x, first.at.y) : '';
      const k = s.kills[id] ?? 0;
      const info = [
        { text: `第一次看到：${stamp(first.time)}` },
        { text: `在哪裡：${where}` },
        { text: `一群 ${first.count} 隻，${SIZES[sp.answers.size] ?? ''}。` },
        { text: ' ' },
      ];
      if (k) {
        const st = foeStats(sp);
        info.push({ text: `打倒 ${k} 隻。${DIETS[sp.diet]}。`, color: COLORS.good });
        info.push({ text: `生命約 ${st.hp}，${foeText(st)}。` });
      } else info.push({ text: '還沒打倒過，看不出牠有多強。', color: COLORS.dim });
      return { id, glyph: sp.glyph, color: sp.color, name: sp.name, kills: k, info };
    })
    .filter(Boolean);
}
