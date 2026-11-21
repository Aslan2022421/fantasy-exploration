// 歷史與傳聞：紀錄 → 事件（data/event）、傳聞照距離與時間傳到聚落
import { expect, test } from 'vitest';
import { createLog } from '../core/records.js';
import { DATA } from '../data/load.js';
import { bestiary, lifePage, worldHistory } from '../view/chronicle-view.js';
import { createChronicle } from './chronicle.js';
import { NEWS, newsFor } from './rumors.js';

const Z = 96;
const fort = DATA.nests.find((n) => n.id === 'fort') ?? DATA.nests[0];
const hero = { race: DATA.races[0].id, cls: DATA.classes[0].id };

function logWith(entries) {
  const log = createLog();
  log.append({ time: 0, actor: 'player', verb: 'start', data: { at: { x: 10, y: 10 }, hero, hp: 10 } });
  for (const e of entries) log.append({ actor: 'player', ...e });
  return log;
}
// 據點在第 (5, 0) 區的正中間
const clear = (time) => ({
  time,
  verb: 'nestclear',
  target: { x: 5 * Z + 48, y: 48 },
  data: { nest: 'n1', kind: fort.id },
});
const settleAt = (zx, zy) => ({ id: `s${zx},${zy}`, x0: zx * Z + 30, y0: zy * Z + 30, w: 36, h: 36 });

test('清光據點是一件事件，寫進世界歷史與生涯；冒險者在傳聞裡是「一位種族職業」', () => {
  const ch = createChronicle(logWith([clear(100)]), Z);
  expect(ch.events).toHaveLength(1);
  const e = ch.events[0];
  expect(e.def.id).toBe('nest-cleared');
  expect(e.def.world && e.def.life).toBe(true);
  expect(e.facts.place).toBe(fort.name);
  expect(e.facts.hero).toBe(`${DATA.races[0].name}${DATA.classes[0].name}`);
  expect(ch.clearedBy('n1')).toBe(`一位${e.facts.hero}`);
});

test('傳聞照距離與時間傳到：隔 d 區要等 max(1, d)×perZone 刻，最遠 maxZones 區', () => {
  const ch = createChronicle(logWith([clear(100)]), Z);
  const near = settleAt(5, 1); // 隔壁區
  expect(newsFor(ch, near, 'npc:a#0', 100 + NEWS.perZone - 1, Z)).toHaveLength(0);
  expect(newsFor(ch, near, 'npc:a#0', 100 + NEWS.perZone, Z)).toHaveLength(1);
  const three = settleAt(2, 0); // 隔 3 區
  expect(newsFor(ch, three, 'npc:a#0', 100 + 3 * NEWS.perZone - 1, Z)).toHaveLength(0);
  expect(newsFor(ch, three, 'npc:a#0', 100 + 3 * NEWS.perZone, Z)).toHaveLength(1);
  const far = settleAt(5, NEWS.maxZones + 1);
  expect(newsFor(ch, far, 'npc:a#0', 10 ** 7, Z)).toHaveLength(0);
});

test('傳聞的說法：近的照 seen、遠的照 heard 或 wrong；同一個人講同一件事永遠同一句；最多兩則、最新的先', () => {
  const def = DATA.events.find((e) => e.id === 'nest-cleared');
  const ch = createChronicle(logWith([clear(100)]), Z);
  const near = newsFor(ch, settleAt(5, 1), 'npc:a#0', 10 ** 6, Z)[0].text;
  expect(near).toContain(fort.name);
  expect(near).toMatch(/邊|附近/);
  const far = newsFor(ch, settleAt(1, 0), 'npc:a#0', 10 ** 6, Z)[0].text;
  expect(far).not.toBe(near);
  expect(newsFor(ch, settleAt(1, 0), 'npc:a#0', 10 ** 6, Z)[0].text).toBe(far);
  expect(def.heard.length + def.wrong.length).toBeGreaterThan(0);
  const many = createChronicle(logWith([clear(100), clear(200), clear(300)]), Z);
  const got = newsFor(many, settleAt(5, 1), 'npc:a#0', 10 ** 6, Z);
  expect(got.map((n) => n.id)).toEqual([3, 2]);
});

test('會傳的事件每一句範本都填得滿（沒有留下 {名字}）', () => {
  const ch = createChronicle(logWith([clear(100)]), Z);
  for (let i = 0; i < 40; i++)
    for (const n of newsFor(ch, settleAt(5 - (i % 4), 1), `npc:x#${i}`, 10 ** 6, Z)) expect(n.text).not.toMatch(/\{/);
});

test('H 的世界歷史寫「一位種族職業」、生涯寫「你」，統計數得出清光幾處', () => {
  const ch = createChronicle(logWith([clear(100)]), Z);
  const hist = worldHistory(ch).map((r) => r.text);
  expect(hist[0]).toBe('第 1 天'); // 照天分段
  expect(hist[1]).toBe(
    `● 一位${ch.hero}清光了${fort.name}外面那群${DATA.species[DATA.speciesIndex.get(fort.species)].name}。`,
  );
  const life = lifePage(ch, { time: 200 });
  expect(life.rows.some((r) => r.text.startsWith('● 你清光了'))).toBe(true);
  expect(life.tiles).toContainEqual(['清光據點', 1]);
  expect(bestiary(ch, null, DATA)).toEqual([]);
});

test('走過的區加周圍一圈算知道；說話時聽到的傳聞記在紀錄裡，地圖照那筆標出地方', () => {
  const log = logWith([
    clear(100),
    { time: 200, verb: 'move', data: { from: { x: 10, y: 10 }, to: { x: 100, y: 10 }, dir: 'e', duration: 6 } },
    { time: 300, verb: 'talk', target: { x: 0, y: 0 }, data: { npc: 'npc:a#0', heard: [1] } },
  ]);
  const k = createChronicle(log, Z).known();
  expect(k.zones.has('0,0') && k.zones.has('1,0') && k.zones.has('2,1')).toBe(true);
  expect(k.zones.has('3,0')).toBe(false);
  expect(k.places).toMatchObject([{ zx: 5, zy: 0, name: fort.name }]);
});
