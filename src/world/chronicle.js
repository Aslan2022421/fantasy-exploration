// 從紀錄整理出來的歷史：事件（data/event 的種類）、冒險者的統計、走過的區、聽過的傳聞。
// 紀錄只增不改，所以每次用到時只看新增的那幾筆；不進存檔，讀檔後從頭算一次

import { factsOf, heroLabel, matchEvent } from './event-facts.js';

const zoneKey = (zx, zy) => `${zx},${zy}`;

// log：records.js 的紀錄；zoneSize：一區幾格
export function createChronicle(log, zoneSize) {
  let done = 0;
  let hero = '冒險者';
  const events = []; // { id 紀錄編號, def, time, at, zone: {zx, zy}, facts }
  const byId = new Map();
  const visited = new Set(); // 冒險者站過的區
  const heard = new Set(); // 聽過的傳聞（事件的紀錄編號）
  const kills = {}; // 物種 id → 冒險者打倒幾隻
  const firstSeen = {}; // 物種 id → { count, at, time }
  const lastHit = {}; // 據點 id → 最後是誰讓牠的怪物變少（清光時村民說得出是誰清的）
  const counts = { moves: 0, gathers: 0, talks: 0, chests: 0, downs: 0, clears: 0, fights: 0 };

  const visit = (p) => p && visited.add(zoneKey(Math.floor(p.x / zoneSize), Math.floor(p.y / zoneSize)));

  function take(rec) {
    const d = rec.data ?? {};
    switch (rec.verb) {
      case 'start':
        hero = heroLabel(d.hero);
        visit(d.at);
        break;
      case 'move':
        counts.moves++;
        visit(d.to);
        break;
      case 'gather':
        counts.gathers++;
        break;
      case 'talk':
        counts.talks++;
        for (const id of d.heard ?? []) heard.add(id);
        break;
      case 'open':
        counts.chests++;
        break;
      case 'down':
        counts.downs++;
        visit(d.at);
        break;
      case 'nestclear':
        counts.clears++;
        lastHit[d.nest] = `一位${hero}`;
        break;
      case 'victory':
        counts.fights++;
        break;
      case 'spot':
        firstSeen[d.species] ??= { count: d.count, at: rec.target, time: rec.time };
        break;
      case 'attack':
        if (rec.actor === 'player' && d.hp <= 0) kills[d.species] = (kills[d.species] ?? 0) + 1;
        if (rec.actor === 'player' && d.nest) lastHit[d.nest.id] = `一位${hero}`;
        break;
      case 'nestroll':
        if (!d.win && d.pop < d.before) lastHit[d.nest] = d.settleName ? `${d.settleName}的衛兵` : '一隊路過的冒險者';
        break;
      default:
    }
    const f = factsOf(rec);
    const def = f && matchEvent(rec, f.facts);
    if (!def || !f.at) return;
    const ev = {
      id: rec.id,
      def,
      time: rec.time,
      at: f.at,
      zone: { zx: Math.floor(f.at.x / zoneSize), zy: Math.floor(f.at.y / zoneSize) },
      facts: { ...f.facts, hero },
    };
    events.push(ev);
    byId.set(rec.id, ev);
  }

  function update() {
    for (; done < log.size; done++) take(log.get(done));
  }

  return {
    get events() {
      update();
      return events;
    },
    event(id) {
      update();
      return byId.get(id) ?? null;
    },
    get hero() {
      update();
      return hero;
    },
    stats() {
      update();
      return { ...counts, zones: visited.size, kills: { ...kills }, firstSeen: { ...firstSeen } };
    },
    clearedBy(nestId) {
      update();
      return lastHit[nestId] ?? null;
    },
    // 地圖上知道的地方：站過的區加上周圍一圈（看得到），以及聽過傳聞的事件發生的那一區；
    // version 變了地圖才重畫
    known() {
      update();
      const zones = new Set();
      for (const k of visited) {
        const [zx, zy] = k.split(',').map(Number);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) zones.add(zoneKey(zx + dx, zy + dy));
      }
      // 傳聞裡提到的據點、聚落
      const places = [...heard]
        .map((id) => byId.get(id))
        .filter((e) => e && (e.facts.place || e.facts.settle))
        .map((e) => e.zone);
      return { zones, places, version: `${visited.size}:${heard.size}` };
    },
  };
}
