// H 視窗的另外三頁（紀錄那一頁在 main.js）：世界歷史、生涯、圖鑑。內容從 chronicle.js 算，排成 [{ time, text, color }]

import { fill } from '../world/event-facts.js';
import { foeStats, foeText } from '../world/foes.js';
import { regionLabel } from '../world/place.js';
import { clockOf, dayOf } from '../world/rules.js';
import { COLORS } from './colors.js';

export const HISTORY_TABS = ['紀錄', '世界歷史', '生涯', '圖鑑'];
const DIETS = { herbivore: '草食', predator: '掠食', omnivore: '混食' };
const stamp = (t) => `第 ${dayOf(t) + 1} 天 ${clockOf(t).slice(0, 5)}`;
const note = (text, color = COLORS.dim) => ({ time: null, text, color });

// 世界歷史：寫進世界的事件，冒險者寫成「一位精靈遊俠」
export function worldHistory(chronicle) {
  const rows = chronicle.events
    .filter((e) => e.def.world)
    .map((e) => ({ time: stamp(e.time), text: fill(e.def.history, { ...e.facts, hero: `一位${e.facts.hero}` }) }));
  return rows.length ? rows : [note('還沒有發生值得記下來的事。')];
}

// 生涯：統計＋自己的年表（冒險者寫成「你」）
export function lifePage(chronicle, state) {
  const s = chronicle.stats();
  const killed = Object.values(s.kills).reduce((a, b) => a + b, 0);
  const rows = [
    note(`${chronicle.hero}。現在是${stamp(state.time)}。`, COLORS.text),
    note(`走了 ${s.moves} 步，到過 ${s.zones} 區。`, COLORS.text),
    note(
      `打倒 ${killed} 隻生物（${Object.keys(s.kills).length} 種），打贏 ${s.fights} 場戰鬥，倒下 ${s.downs} 次。`,
      COLORS.text,
    ),
    note(`清光 ${s.clears} 處據點，打開 ${s.chests} 個寶箱，採集 ${s.gathers} 次。`, COLORS.text),
    note(`見過 ${Object.keys(s.firstSeen).length} 種生物，跟村民說過 ${s.talks} 次話。`, COLORS.text),
    note(' '),
    note('年表'),
  ];
  const life = chronicle.events.filter((e) => e.def.life);
  for (const e of life) rows.push({ time: stamp(e.time), text: fill(e.def.history, { ...e.facts, hero: '你' }) });
  if (!life.length) rows.push(note('還沒有。'));
  return rows;
}

// 圖鑑：見過的物種，照第一次見到的順序；只寫看過的（在哪裡、一群幾隻），打倒過的再寫食性、體型與數值
export function bestiary(chronicle, world, data) {
  const s = chronicle.stats();
  const seen = Object.entries(s.firstSeen).sort((a, b) => a[1].time - b[1].time);
  if (!seen.length) return [note('還沒有見過任何生物。')];
  const rows = [];
  for (const [id, first] of seen) {
    const sp = data.species[data.speciesIndex.get(id)];
    if (!sp) continue;
    rows.push({ time: null, text: `${sp.glyph}　${sp.name}`, color: sp.color });
    const where = first.at ? regionLabel(world, data, first.at.x, first.at.y) : '';
    rows.push(note(`　第一次看到：${stamp(first.time)}，${where}，一群 ${first.count} 隻。`, COLORS.text));
    const k = s.kills[id];
    if (k) {
      const st = foeStats(sp);
      rows.push(note(`　打倒 ${k} 隻。${DIETS[sp.diet]}。生命約 ${st.hp}，${foeText(st)}。`, COLORS.text));
    } else rows.push(note('　還沒打倒過，看不出牠有多強。'));
  }
  return rows;
}
