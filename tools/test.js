// 合併測試（每一版都用這支）：node tools/test.js
// 生成統計（40 個種子各創 17 塊）＋3 個種子各 1500 個動作的單人機器人模擬＋一組「只走路不打怪」的對照
// ＋「四人等效」模擬（機器人每做 4 個動作，世界才走 1 回合；3 個種子各至少 3000 個動作、至少創出 15 塊）。
// 檢查：室內走得通、住戶碰得到、聚落周圍沒有怪物（嚴格）、出入口、戰鬥判定、世界狀態、創世耗時、
// 創世門檻（清光一塊的內容一定解得出下一塊）、世界等級加成、城鎮出現時機、士兵的行為、
// 背包與送貨物品、買工具、採集、藥草、礦石改良、怪物出手擲 6～10 不讓冒險者必定反擊。
// 另外量測：各世界等級機器人打倒小怪物、中型怪物平均用了幾下，以及武器等級的中間值（校準怪物血量的世界等級加成用）。
// 只跑四人等效模擬（調數字用）：node tools/test.js sim4
const UNIT_ONLY = process.argv[2] === 'unit'; // 只跑場景測試（創世門檻、世界等級、士兵、對話），不跑生成統計和模擬
const SIM4_ONLY = process.argv[2] === 'sim4' || UNIT_ONLY;
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..', 'js') + path.sep;
global.window = global;
for (const f of ['config', 'rng', 'world', 'checker', 'bugs', 'steading', 'combat', 'stability', 'events', 'ai', 'game', 'save']) {
  vm.runInThisContext(fs.readFileSync(ROOT + f + '.js', 'utf8'), { filename: f + '.js' });
  if (f === 'rng') {
    const mem = new Map();
    FE.store = { load: (k, d) => (mem.has(k) ? mem.get(k) : d), save: (k, v) => mem.set(k, v), remove: (k) => mem.delete(k) };
  }
}
const C = FE.CONFIG;
// 調數字用：FE_CFG='{"CREATION_SHARE":0.4}' 暫時蓋掉設定，FE_SEEDS='777,20201' 只跑這些種子的四人等效模擬
if (process.env.FE_CFG) Object.assign(C, JSON.parse(process.env.FE_CFG));
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIRS8 = DIRS.concat([[1, 1], [1, -1], [-1, 1], [-1, -1]]);
const key = (x, y) => x + ',' + y;
const problems = [];
const fail = (msg) => {
  if (problems.length < 200) problems.push(msg);
  problems.count = (problems.count || 0) + 1;
};

// 從 starts 走得到的格子（不看村民、怪物）
function flood(w, starts, limit) {
  const seen = new Set();
  const q = [];
  for (const [x, y] of starts) if (w.passable(x, y)) { seen.add(key(x, y)); q.push([x, y]); }
  for (let h = 0; h < q.length; h++) {
    const [x, y] = q[h];
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (seen.has(key(nx, ny)) || !w.canStep(x, y, nx, ny)) continue;
      if (limit && !limit(nx, ny)) continue;
      seen.add(key(nx, ny));
      q.push([nx, ny]);
    }
  }
  return seen;
}

// 室內走得通：每棟建築從門外那一格走得到室內每一格能走的地方；地貌從外圍走得到畫上去的每一格能走的地方
function checkInteriors(game, tag) {
  const w = game.world;
  for (const v of w.villages) {
    v.buildings.forEach((b, i) => {
      const box = (x, y) => x >= b.x0 - 1 && x <= b.x1 + 1 && y >= b.y0 - 1 && y <= b.y1 + 1;
      const outs = [];
      for (const [x, y] of b.doors) for (const [dx, dy] of DIRS) if (FE.Steading.roomAt(v, x + dx, y + dy) < 0 && w.passable(x + dx, y + dy)) outs.push([x + dx, y + dy]);
      if (!outs.length) fail(`${tag} ${v.name} 建築${i}(${b.kind}) 門外沒有路`);
      const seen = flood(w, outs, box);
      for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) {
        if (FE.Steading.roomAt(v, x, y) === i && w.passable(x, y) && !seen.has(key(x, y))) fail(`${tag} ${v.name} 建築${i}(${b.kind}) 室內 (${x},${y}) 走不到`);
      }
      if (b.kind === 'house' && !b.spots[0]) fail(`${tag} 小屋沒有住戶站的格子`);
      if (b.kind === 'house' || b.kind === 'smithy') {
        const inner = b.doors.map(([x, y]) => DIRS.map(([dx, dy]) => [x + dx, y + dy]).find(([nx, ny]) => FE.Steading.roomAt(v, nx, ny) === i));
        if (!b.spots[0] || !inner.some((c) => c && Math.abs(c[0] - b.spots[0][0]) + Math.abs(c[1] - b.spots[0][1]) === 1)) fail(`${tag} ${v.name} ${b.kind} 站人的格子沒貼著門內`);
        if (inner.some((c) => c && w.cell(c[0], c[1]).t !== '.')) fail(`${tag} ${v.name} ${b.kind} 門內那一格不是空的`);
      }
    });
  }
  for (const l of w.landmarks) {
    const box = (x, y) => x >= l.x0 - 1 && x <= l.x1 + 1 && y >= l.y0 - 1 && y <= l.y1 + 1;
    const ring = [];
    for (let y = l.y0 - 1; y <= l.y1 + 1; y++) for (let x = l.x0 - 1; x <= l.x1 + 1; x++) if (x < l.x0 || x > l.x1 || y < l.y0 || y > l.y1) ring.push([x, y]);
    const seen = flood(w, ring, box);
    // 只看地貌畫上去的格子；圖樣裡的 . 保留原本的地形，那些格子走不走得到歸檢查器（斷層）管
    const art = FE.LANDMARKS[l.kind].art;
    for (let y = l.y0; y <= l.y1; y++) for (let x = l.x0; x <= l.x1; x++) {
      if (art[y - l.y0][x - l.x0] === '.') continue;
      if (w.passable(x, y) && !seen.has(key(x, y))) fail(`${tag} 地貌${l.name} (${x},${y}) 走不到`);
    }
  }
}

// 住戶碰得到：從聚落中央走得到每個村民身邊，也走得到他家站的那一格；聚落裡每一格能走的地方都走得到
const cutOff = [];
function checkResidents(game, tag) {
  const w = game.world;
  const fromSpawn = flood(w, [[w.spawn.x, w.spawn.y]]);
  for (const v of w.villages) if (!fromSpawn.has(key(v.cx, v.cy))) cutOff.push(`${tag} ${v.name}`);
  const reaches = new Map(w.villages.map((v) => [v.id, flood(w, [[v.cx, v.cy]], (x, y) => w.villageAt(x, y) === v)]));
  for (const v of w.villages) {
    const reach = reaches.get(v.id);
    for (let y = v.y0; y <= v.y1; y++) for (let x = v.x0; x <= v.x1; x++) {
      if (w.villageAt(x, y) === v && w.passable(x, y) && !reach.has(key(x, y))) fail(`${tag} ${v.name} (${x},${y}) 聚落裡走不到`);
    }
  }
  for (const n of w.npcs) {
    const v = w.villageById(n.villageId);
    const reach = reaches.get(v.id);
    if (!DIRS.some(([dx, dy]) => reach.has(key(n.x + dx, n.y + dy)) && w.heightOk(n.x, n.y, n.x + dx, n.y + dy))) fail(`${tag} ${v.name} ${n.name}(${n.role}) 碰不到`);
    if (n.role === 'smith') continue;
    if (!n.home) { fail(`${tag} ${v.name} ${n.name} 沒有家`); continue; }
    if (!reach.has(key(n.home.spot[0], n.home.spot[1]))) fail(`${tag} ${v.name} ${n.name} 家裡站的格子走不到`);
    if (FE.Steading.roomAt(v, n.x, n.y) >= 0 && FE.Steading.roomAt(v, n.x, n.y) !== n.home.b) fail(`${tag} ${v.name} ${n.name} 跑進別人的建築`);
  }
  const beds = new Set();
  for (const n of w.npcs) if (n.home && n.home.bed) {
    const k = n.villageId + ':' + n.home.b + ':' + n.home.bed.join(',');
    if (beds.has(k)) fail(`${tag} 床位重複 ${k}`);
    beds.add(k);
  }
}

// 聚落周圍沒有怪物（嚴格）：任何時刻、任何怪物（含生成點）都不在任何聚落的圈內
let bufferViolations = 0;
function checkBuffer(game, tag) {
  for (const m of game.monsters) {
    if (game.world.inBuffer(m.x, m.y)) { bufferViolations++; fail(`${tag} 怪物 ${m.name} 站在圈內 (${m.x},${m.y})`); }
    if (game.world.inBuffer(m.home.x, m.home.y)) { bufferViolations++; fail(`${tag} 怪物 ${m.name} 的生成點在圈內`); }
  }
}

// ---- 戰鬥統計 ----
// 量測：on 時才記（機器人模擬）；kills[世界等級] = { small: [幾下...], mid: [...] }，weapon[世界等級] = [每個動作時的武器等級...]
const measure = { on: false, hits: new Map(), kills: {}, weapon: {} };
const combat = { player: {}, monster: {}, soldier: {}, soldierHits: 0, onSoldier: 0, dodged: 0, blocked: 0, resisted: 0, crit: 0, counters: 0, opportunity: 0, opportunityHit: 0, chain: 0, negative: 0, events: 0, pdmg: 0, mdmg: 0, pn: 0, mn: 0 };
FE.Combat.hook = (e) => {
  combat.events++;
  const t = combat[e.by];
  t[e.key] = (t[e.key] || 0) + 1;
  if (e.dodged) combat.dodged++;
  if (e.blocked) combat.blocked++;
  if (e.resisted) combat.resisted++;
  if (e.crit) combat.crit++;
  if (e.counter) combat.counters++;
  if (e.opportunity) { combat.opportunity++; if (e.dmg > 0) combat.opportunityHit++; }
  if (e.counter && e.countered) { combat.chain++; fail('反擊又被反擊'); }
  if (e.opportunity && e.countered) { combat.chain++; fail('趁機攻擊觸發了反擊'); }
  if (!(e.dmg >= 0)) { combat.negative++; fail(`傷害不是非負數：${e.dmg}`); }
  if (e.by === 'player') { combat.pdmg += e.dmg; combat.pn++; } else if (e.by === 'monster') { combat.mdmg += e.dmg; combat.mn++; }
  // 量測：冒險者自己出手（不含反擊）打同一隻怪物幾下；冒險者打倒牠時記下（世界等級看怪物生成時的 wl）
  if (measure.on && e.by === 'player') {
    if (!e.counter) measure.hits.set(e.d.id, (measure.hits.get(e.d.id) || 0) + 1);
    if (e.killed) {
      const tier = e.d.tier === 'small' ? 'small' : 'mid';
      const r = measure.kills[e.d.wl] || (measure.kills[e.d.wl] = { small: [], mid: [] });
      r[tier].push(measure.hits.get(e.d.id) || 0);
      measure.hits.delete(e.d.id);
    }
  }
  // 士兵：只打事件與侵蝕生的小怪物（m.small），從不碰創世時的怪物；不反擊；怪物打士兵也走同一套判定
  if (e.by === 'soldier') {
    combat.soldierHits++;
    if (!e.d.small || e.d.role === 'soldier') fail(`士兵攻擊了不該碰的對象：${e.d.name}（small=${e.d.small}）`);
    if (e.counter) fail('士兵反擊了');
  }
  if (e.d && e.d.role === 'soldier') {
    combat.onSoldier++;
    if (e.countered) fail('士兵被打時觸發了他的反擊');
  }
};

// ---- 生成統計 ----
const stats = { village: [], town: [], landmarks: 0, landmarkMiss: 0, ms: [], short: [], gateBugs: 0, townGaps: [], firstTowns: [], soldiers: 0 };
const geo = { w: [], h: [], area: [], open: [], nearBlock: 0, count: 0 };
const GEN_SEEDS = SIM4_ONLY ? 0 : 40;
for (let seed = 1; seed <= GEN_SEEDS; seed++) {
  const game = new FE.Game(seed * 7919);
  game.start();
  for (let i = 0; i < 16; i++) {
    const t = Date.now();
    game.createChunk(false);
    stats.ms.push(Date.now() - t);
  }
  const w = game.world;
  // 城鎮出現時機：世界等級 3 才開始，第一座就在世界等級剛好達到 3 的那一塊，之後每隔 4 或 5 塊一座；第 1 塊是村莊
  const townChunks = w.villages.filter((v) => v.kind === 'town').map((v) => w.chunkNumber(v.cx, v.cy)).sort((a, b) => a - b);
  let firstTown = 1;
  while (FE.worldLevelFor(firstTown) < C.TOWN_FIRST_LEVEL) firstTown++;
  if (townChunks[0] !== firstTown) fail(`生成 seed${seed} 第一座城鎮在第 ${townChunks[0]} 塊（應該是第 ${firstTown} 塊）`);
  stats.firstTowns.push(townChunks[0]);
  for (let i = 1; i < townChunks.length; i++) {
    const gap = townChunks[i] - townChunks[i - 1];
    stats.townGaps.push(gap);
    if (gap !== 4 && gap !== 5) fail(`生成 seed${seed} 兩座城鎮隔了 ${gap} 塊`);
  }
  if (w.villages[0].kind !== 'village') fail(`生成 seed${seed} 第 1 塊不是村莊`);
  // 士兵：每座城鎮固定 3 位，站在自己城鎮的室外，數值以同世界等級的小怪物為準
  for (const v of w.villages) {
    const mine = game.soldiers.filter((s) => s.villageId === v.id);
    if (v.kind !== 'town') { if (mine.length) fail(`生成 seed${seed} 村莊 ${v.name} 有士兵`); continue; }
    const want = 3;
    if (C.SOLDIER_PER_TOWN !== 3 || mine.length !== want) fail(`生成 seed${seed} ${v.name} 有 ${mine.length} 位士兵，應該固定是 ${want}`);
    stats.soldiers += mine.length;
    for (const s of mine) {
      if (w.villageAt(s.x, s.y) !== v || FE.Steading.roomAt(v, s.x, s.y) >= 0 || !w.passable(s.x, s.y)) fail(`生成 seed${seed} ${v.name} 士兵站的位置不對 (${s.x},${s.y})`);
      const wl = s.wl;
      const base = FE.makeMonster({ type: 'TERRAIN', x: 0, y: 0, cells: [], scope: 2 }, 0, wl);
      if (s.maxHp !== Math.max(1, Math.round(base.maxHp * 0.9)) || s.atk !== Math.max(1, base.atk - 1) || s.hp !== s.maxHp) fail(`生成 seed${seed} 士兵數值不對 hp ${s.hp}/${s.maxHp} atk ${s.atk}（基準 ${base.maxHp}/${base.atk}）`);
    }
  }
  for (const v of w.villages) {
    const want = (v.kind === 'town' ? C.TOWN_HOUSES : C.VILLAGE_HOUSES)[v.steading.population];
    const kinds = v.buildings.map((b) => b.kind);
    const houses = kinds.filter((k) => k === 'house' || k === 'big').length;
    const beds = v.buildings.reduce((s, b) => s + b.beds.length, 0);
    const needTemple = v.kind === 'town' && (FE.Steading.isHoly(v) || FE.Steading.has(v, '信仰'));
    const needMarket = v.kind === 'town' && FE.Steading.has(v, '市場');
    const s = {
      houses, want, beds, big: kinds.filter((k) => k === 'big').length,
      smithy: kinds.includes('smithy'), temple: !needTemple || kinds.includes('temple'), market: !needMarket || kinds.includes('market'),
      entrances: v.entrances, villagers: w.npcs.filter((n) => n.villageId === v.id && n.role !== 'smith').length,
    };
    stats[v.kind].push(s);
    // 民房沒蓋齊、床位少於上限：使用者決定當作可接受的粗糙，只統計；村民沒有家才算錯（checkResidents）
    if (houses < want) stats.short.push(`seed${seed} ${v.name} 民房 ${houses}/${want}`);
    if (!s.smithy) fail(`生成 seed${seed} ${v.name} 沒有工坊`);
    if (!s.temple || !s.market) fail(`生成 seed${seed} ${v.name} 少了神殿或市場`);
    if (beds < (v.kind === 'town' ? C.TOWN_MAX_NPC : C.VILLAGE_MAX_NPC)) stats.short.push(`seed${seed} ${v.name} 床位 ${beds}`);
    if (!w.passable(w.spawn.x, w.spawn.y)) fail(`生成 seed${seed} 出生點站不了`);
    // 出入口：聚落裡的路碰到聚落外面能走的格子
    const opens = [];
    let maskCells = 0, openCells = 0;
    for (let y = v.y0; y <= v.y1; y++) for (let x = v.x0; x <= v.x1; x++) {
      if (w.villageAt(x, y) !== v) continue;
      maskCells++;
      if (w.cell(x, y).t === '.' && FE.Steading.roomAt(v, x, y) < 0) openCells++;
      if (w.cell(x, y).t === '·' && DIRS.some(([dx, dy]) => !w.villageAt(x + dx, y + dy) && w.passable(x + dx, y + dy))) opens.push([x, y]);
    }
    const groups = [];
    const seen = new Set();
    const openKeys = new Set(opens.map((o) => key(...o)));
    for (const c of opens) {
      if (seen.has(key(...c))) continue;
      const g = [c]; seen.add(key(...c));
      for (let i = 0; i < g.length; i++) for (const [dx, dy] of DIRS8) {
        const n = [g[i][0] + dx, g[i][1] + dy];
        if (openKeys.has(key(...n)) && !seen.has(key(...n))) { seen.add(key(...n)); g.push(n); }
      }
      groups.push(g);
    }
    // 出入口不足要有一隻斷層怪物負責（打倒時開一個出入口）
    const gateBug = game.monsters.some((m) => m.data && m.data.villageId === v.id);
    if (gateBug) stats.gateBugs++;
    if ((groups.length < 3 && !gateBug) || groups.length > 4) fail(`生成 seed${seed} ${v.name} 量到的出入口 ${groups.length} 個`);
    // 規格是「每座至少 3 個、每個寬至少 3 格」：走道鋪成路之後，走道貼著出入口時量起來會寬 4～5 格，也可能多出一個口，都合規格
    for (const g of groups) if (g.length < 3) fail(`生成 seed${seed} ${v.name} 出入口寬 ${g.length}`);
    const out = flood(w, opens);
    let outside = 0;
    for (const k of out) { const [x, y] = k.split(',').map(Number); if (!w.inBuffer(x, y)) outside++; }
    if (outside < 10) fail(`生成 seed${seed} ${v.name} 出入口走不出去`);
    s.groups = groups.length;
    // 外形：外接矩形、空地比例、靠水或巨石
    s.gw = v.x1 - v.x0 + 1; s.gh = v.y1 - v.y0 + 1;
    s.garea = s.gw * s.gh / (v.kind === 'town' ? C.TOWN_W * C.TOWN_H : C.VILLAGE_W * C.VILLAGE_H);
    s.gopen = openCells / maskCells;
    geo.count++;
    // 貼著外牆（8 鄰）的水或巨石格數，3 格以上算靠著
    let touch = 0;
    for (let y = v.y0 - 1; y <= v.y1 + 1; y++) for (let x = v.x0 - 1; x <= v.x1 + 1; x++) {
      const c = w.cell(x, y);
      if (!c || w.villageAt(x, y) || (c.t !== '≈' && c.t !== '#')) continue;
      if (DIRS8.some(([dx, dy]) => w.villageAt(x + dx, y + dy))) touch++;
    }
    if (touch >= 3) geo.nearBlock++;
    s.kind = v.kind;
  }
  stats.landmarks += w.landmarks.length;
  stats.landmarkMiss += w.villages.length - w.landmarks.length;
  checkInteriors(game, `生成 seed${seed}`);
  checkResidents(game, `生成 seed${seed}`);
  checkBuffer(game, `生成 seed${seed}`);
}

// ---- 機器人模擬 ----
function botStep(game, rng, goal, lazy) {
  const w = game.world;
  const p = game.player;
  const adj = game.adjacentMonsters();
  // 血量低又有藥草就先吃（戰鬥中也能吃）
  if (p.hp < p.maxHp * (adj.length ? 0.3 : 0.4) && game.bagCount('herb')) return game.eatHerb();
  if (adj.length) {
    if (p.hp < p.maxHp * 0.25) return game.act('flee');
    if (!lazy) {
      const m = game.targetMonster();
      return game.act(game.battle.cooldown === 0 && m && m.hp > p.atk + 3 ? 'deep' : 'attack');
    }
  }
  let tgt = lazy ? null : goal.get();
  if (!adj.length && p.hp < p.maxHp * 0.4) {
    // 血量低：在聚落裡休息一次就回滿；不在聚落裡就先走回最近的聚落（對照組只在原地休息）
    if (lazy) { if (rng() < 0.8) return game.rest(); }
    else if (w.inVillage(p.x, p.y)) return game.rest();
    else {
      const near = w.villages.slice().sort((a, b) => Math.abs(a.cx - p.x) + Math.abs(a.cy - p.y) - (Math.abs(b.cx - p.x) + Math.abs(b.cy - p.y)))[0];
      if (near) tgt = { x: near.cx, y: near.cy };
    }
  }
  if (tgt) {
    const prev = new Map([[key(p.x, p.y), null]]);
    const q = [[p.x, p.y]];
    for (let h = 0; h < q.length && h < 6000; h++) {
      const [x, y] = q[h];
      if (Math.abs(x - tgt.x) + Math.abs(y - tgt.y) === 1 && w.heightOk(x, y, tgt.x, tgt.y)) {
        let k = key(x, y);
        let step = null;
        while (prev.get(k) !== null) { step = k; k = prev.get(k); }
        const [sx, sy] = step ? step.split(',').map(Number) : [tgt.x, tgt.y];
        return game.move(sx - p.x, sy - p.y);
      }
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (prev.has(key(nx, ny)) || !w.canStep(x, y, nx, ny) || game.monsterAt(nx, ny) || w.npcAt(nx, ny) || game.soldierAt(nx, ny)) continue;
        prev.set(key(nx, ny), key(x, y));
        q.push([nx, ny]);
      }
    }
    goal.drop();
  }
  // 懶惰的對照組：只在世界裡亂走，不碰怪物（撞上去才是攻擊），一直往同一個方向走一陣子
  const opts = DIRS.filter(([dx, dy]) => !lazy || (!game.monsterAt(p.x + dx, p.y + dy) && w.passable(p.x + dx, p.y + dy) && w.heightOk(p.x, p.y, p.x + dx, p.y + dy)));
  const [dx, dy] = opts.length ? FE.pick(rng, opts) : FE.pick(rng, DIRS);
  return game.move(dx, dy);
}

// 機器人在對話視窗裡的選擇：能交件、回報就交，能接委託就接，錢夠就改良武器，不然離開（走新的對話介面）
const dlgStats = { opened: 0, accept: 0, report: 0, deliver: 0, improve: 0, buyPick: 0, buySickle: 0, leave: 0 };
function botTalk(game) {
  const npc = game.talkTarget(game.talking);
  if (!npc) { game.closeTalk(); return; }
  const t = game.talkOptions(npc);
  dlgStats.opened++;
  const idx = (id) => t.options.findIndex((o) => o.id === id && !o.disabled);
  // 改良優先；改良不了（錢或礦石不夠）時才買礦鎬、鐮刀
  let pick = ['report', 'deliver', 'accept', 'improve', 'buyPick', 'buySickle'].find((id) => idx(id) >= 0) || 'leave';
  if (pick === 'leave') dlgStats.leave++; else dlgStats[pick]++;
  game.choose(npc, t.options.findIndex((o) => o.id === pick));
  if (game.talking != null) fail('對話選完沒有關掉');
}

// 模擬一個機器人玩家。opts：
//   steps：動作數（單人模擬）；lazy：只走路不打怪；
//   worldEvery：機器人每做幾個動作，世界（怪物、事件、侵蝕、士兵）才走 1 回合（四人等效是 4）；
//   minActions／untilChunks／maxActions：四人等效用，至少 minActions 個動作而且創出 untilChunks 塊才停，最多 maxActions；
//   scale：暫時改 PLAYER_COMPUTE_SCALE（查「四人等效」的另一種讀法用）
const soldierCalls = { n: 0 };
const soldierTurn0 = FE.AI.soldierTurn;
FE.AI.soldierTurn = (g) => { soldierCalls.n++; return soldierTurn0(g); };
function simulate(seed, opts) {
  opts = opts || {};
  const lazy = !!opts.lazy;
  const scale0 = C.PLAYER_COMPUTE_SCALE;
  if (opts.scale != null) C.PLAYER_COMPUTE_SCALE = opts.scale;
  const game = new FE.Game(seed);
  game.start();
  game.worldEvery = opts.worldEvery || 1;
  const rng = FE.makeRng(seed + 1);
  soldierCalls.n = 0;
  let endCalls = 0;
  const end0 = game.endTurn.bind(game);
  game.endTurn = (a, b) => { endCalls++; end0(a, b); };
  // 士兵打倒的怪物：冒險者不拿經驗值也不拿算力，也不掉寶箱
  const defeat0 = game.defeat.bind(game);
  game.defeat = (m, by) => {
    const before = [game.exp, game.creation, game.compute, game.world.chests.length];
    defeat0(m, by);
    if (by && by.role === 'soldier' && (game.exp !== before[0] || game.creation !== before[1] || game.compute !== before[2] || game.world.chests.length !== before[3])) {
      fail(`模擬 seed${seed} 士兵打倒的怪物給了冒險者獎勵`);
    }
  };
  const sinfo = new Map();      // 士兵 id → 是不是在城外
  const townCount = new Map();  // 城鎮 id → 上一個動作後的士兵人數
  let target = null;
  let enteredHouse = 0;
  let deaths = 0;
  const die0 = game.die.bind(game);
  game.die = (m) => { deaths++; die0(m); };
  const goal = {
    get() {
      const w = game.world;
      const p = game.player;
      if (target && target.kind === 'npc' && !w.npcById(target.id)) target = null;
      if (target && target.kind === 'mon' && !game.monsters.some((m) => m.id === target.id)) target = null;
      if (target && target.kind === 'node' && !w.nodes.some((n) => n.id === target.id && game.nodeAt(n.x, n.y) === n)) target = null;
      if (!target || rng() < 0.01) {
        const c = p.carrying;
        // 採集：有礦鎬又缺改良要的礦石，去挖最近的礦脈；有鐮刀、藥草少於 3 份，割附近的藥草
        const near = (kind, r) => w.nodes.filter((n) => n.kind === kind && game.nodeAt(n.x, n.y) === n && Math.abs(n.x - p.x) + Math.abs(n.y - p.y) < r)
          .sort((a, b) => Math.abs(a.x - p.x) + Math.abs(a.y - p.y) - (Math.abs(b.x - p.x) + Math.abs(b.y - p.y)))[0];
        const ore = game.bagCount('pick') && game.bagCount('ore') < game.oreNeeded() ? near('ore', 120) : null;
        const herb = !ore && game.bagCount('sickle') && game.bagCount('herb') < 3 ? near('herb', 16) : null;
        if (c && c.kind !== 'hunt' && w.npcById(c.targetId)) target = { kind: 'npc', id: c.targetId };
        else if (ore || herb) target = { kind: 'node', id: (ore || herb).id };
        else if (rng() < 0.3) {
          const ns = w.npcs.filter((n) => Math.abs(n.x - p.x) + Math.abs(n.y - p.y) < 80);
          if (ns.length) target = { kind: 'npc', id: FE.pick(rng, ns).id };
        } else {
          const ms = game.monsters.filter((m) => Math.abs(m.x - p.x) + Math.abs(m.y - p.y) < 60).sort((a, b) => Math.abs(a.x - p.x) + Math.abs(a.y - p.y) - (Math.abs(b.x - p.x) + Math.abs(b.y - p.y)));
          // 創世時的怪物才是推進世界的內容（創世門檻算的是牠們），事件與侵蝕生的小怪物會自己追上來、打架時順便清掉：
          // 先找最近的創世怪物，沒有才找最近的別種怪物
          const prog = ms.filter((m) => !m.small && !m.members);
          const pick = prog.length ? prog[0] : ms[0];
          if (pick) target = { kind: 'mon', id: pick.id };
        }
      }
      if (!target) return null;
      const o = target.kind === 'npc' ? w.npcById(target.id) : target.kind === 'node' ? w.nodes.find((n) => n.id === target.id) : game.monsters.find((m) => m.id === target.id);
      return o ? { x: o.x, y: o.y } : null;
    },
    drop() { target = null; },
  };
  const before = game.reports.length;
  const totals = [];
  const lv = [0, 0, 0];
  const first = [null, null, null];
  const firstWL = [null, null, null]; // 第一次進動盪、失序時的世界等級
  const byWL = {};                    // 世界等級 → { n: 動作數, s: [安穩, 動盪, 失序] 的動作數 }
  measure.on = !lazy;
  measure.hits.clear();
  const stopAt = (i) => (opts.untilChunks ? i >= opts.maxActions || (i >= opts.minActions && game.world.chunks.length >= opts.untilChunks) : i >= opts.steps);
  let i = 0;
  for (; !stopAt(i); i++) {
    const p = game.player;
    let talked = false;
    const stateBefore = FE.Stability.state(game);
    game.guard('bot', () => {
      botStep(game, rng, goal, lazy);
      if (game.talking != null) { talked = true; botTalk(game); }
    });
    const v = game.world.villageAt(p.x, p.y);
    if (v && FE.Steading.roomAt(v, p.x, p.y) >= 0) enteredHouse++;
    if (talked && target && target.kind === 'npc') target = null;
    checkBuffer(game, `模擬 seed${seed} 第${i}步`);
    for (const n of game.world.npcs) {
      const nv = game.world.villageById(n.villageId);
      if (game.world.villageAt(n.x, n.y) !== nv && n.role !== 'smith') fail(`模擬 seed${seed} ${n.name} 走出聚落`);
      const r = FE.Steading.roomAt(nv, n.x, n.y);
      if (n.role !== 'smith' && r >= 0 && (!n.home || n.home.b !== r)) fail(`模擬 seed${seed} ${n.name} 進了別人的建築`);
    }
    const L = FE.Stability.state(game);
    lv[L]++;
    const wl = FE.Stability.worldLevel(game);
    const rec = byWL[wl] || (byWL[wl] = { n: 0, s: [0, 0, 0], chaosAt: null });
    if (measure.on) (measure.weapon[wl] || (measure.weapon[wl] = [])).push(p.weaponLv);
    rec.n++;
    rec.s[L]++;
    if (L > 0 && first[L] === null) { first[L] = i + 1; firstWL[L] = wl; }
    if (L > 1 && first[1] === null) { first[1] = i + 1; firstWL[1] = wl; }
    totals.push(FE.Stability.total(game));
    if (process.env.FE_DIAG && i % Number(process.env.FE_DIAG) === 0) {
      const ms = game.monsters;
      const sum = (a) => a.reduce((s, m) => s + m.scope, 0);
      console.log(`  [診斷 seed${seed} 第${i}步] 塊 ${game.world.chunks.length} 等級 ${wl} 狀態 ${L} 總 ${sum(ms)}｜創世怪 ${ms.filter((m) => !m.small && !m.members).length} 隻 ${sum(ms.filter((m) => !m.small && !m.members))}｜追人怪 ${ms.filter((m) => m.small).length} 隻 ${sum(ms.filter((m) => m.small))}｜合體 ${ms.filter((m) => m.members).length} 隻 ${sum(ms.filter((m) => m.members))}｜修補力 ${game.compute.toFixed(0)} 創世力 ${game.creation.toFixed(0)}/${game.nextChunkAt.toFixed(0)}`);
    }

    // 士兵：從不進建築；只在失序時出城（回到動盪或安穩後走回來）；陣亡後要等回到安穩才補回
    const disorderNow = stateBefore === 2 || L === 2;
    for (const s of game.soldiers) {
      const v = game.world.villageById(s.villageId);
      if (!v || s.hp <= 0 || s.hp > s.maxHp) fail(`模擬 seed${seed} 士兵狀態不對`);
      const sv = game.world.villageAt(s.x, s.y);
      if (sv && FE.Steading.roomAt(sv, s.x, s.y) >= 0) fail(`模擬 seed${seed} 士兵進了建築`);
      const inside = game.world.villageAt(s.x, s.y) === v;
      const wasOut = sinfo.get(s.id);
      if (!inside && wasOut === undefined) {
        // 這個動作才剛出城（新補回或剛創出的士兵一開始都在城裡）
        if (!disorderNow) fail(`模擬 seed${seed} 第${i}步 士兵在非失序時出城（前 ${stateBefore}，後 ${L}）`);
      }
      if (!inside) sinfo.set(s.id, true); else sinfo.delete(s.id);
    }
    for (const v of game.world.villages) {
      if (v.kind !== 'town') continue;
      const n = game.soldiers.filter((s) => s.villageId === v.id).length;
      const quota = C.SOLDIER_PER_TOWN;
      const prev = townCount.get(v.id);
      if (prev !== undefined && n > prev && (L !== 0 || n !== quota)) fail(`模擬 seed${seed} 第${i}步 ${v.name} 士兵補回的時機不對（狀態 ${L}，${prev}→${n}，應有 ${quota}）`);
      if (L === 0 && n < quota) fail(`模擬 seed${seed} 第${i}步 世界安穩了 ${v.name} 還沒補回士兵 ${n}/${quota}`);
      townCount.set(v.id, n);
    }
  }
  const steps = i;
  measure.on = false;
  const syncCalls = soldierCalls.n; // 存檔讀回來的遊戲還會再玩幾步，先記下這個遊戲的士兵回合數
  checkInteriors(game, `模擬 seed${seed}`);
  checkResidents(game, `模擬 seed${seed}`);
  // 存檔：存起來再讀回來，狀態一致，而且讀回來的遊戲還能玩
  FE.Save.save(game);
  const back = FE.Save.load();
  if (!back || !back.game) fail(`存檔 seed${seed} 讀不回來`);
  else {
    const g2 = back.game;
    if (g2.worldState !== game.worldState || g2.monsters.length !== game.monsters.length || (g2.fixed || []).length !== (game.fixed || []).length || g2.battle.cooldown !== game.battle.cooldown) fail(`存檔 seed${seed} 讀回來的狀態不一致`);
    if (g2.soldiers.length !== game.soldiers.length || g2.creation !== game.creation || g2.nextChunkAt !== game.nextChunkAt || g2.world.nextTownAt !== game.world.nextTownAt) fail(`存檔 seed${seed} 士兵或創世力讀回來不一致`);
    const e0 = g2.reports.length;
    for (let i = 0; i < 30; i++) g2.guard('bot', () => { botStep(g2, rng, goal, true); if (g2.talking != null) botTalk(g2); });
    if (g2.reports.length !== e0) fail(`存檔 seed${seed} 讀回來玩出執行錯誤`);
  }
  // 士兵跟冒險者同步：世界每走一回合，士兵就做一個動作；每位士兵每回合只做一件事
  const st = FE.Stability.stat(game);
  const ticks = Math.floor(endCalls / (opts.worldEvery || 1));
  if (syncCalls !== ticks) fail(`模擬 seed${seed} 士兵回合 ${syncCalls} 次，應該是 ${ticks} 次（冒險者動作 ${endCalls}）`);
  if (st.soldierActs !== st.soldierSlots) fail(`模擬 seed${seed} 士兵動作 ${st.soldierActs} 次，應該是 ${st.soldierSlots} 次`);
  if (st.soldierAttacks > st.soldierActs) fail(`模擬 seed${seed} 士兵出手 ${st.soldierAttacks} 次，比動作還多`);
  C.PLAYER_COMPUTE_SCALE = scale0;
  const sorted = totals.slice().sort((a, b) => a - b);
  const pct = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
  const perWL = Object.keys(byWL).map(Number).sort((a, b) => a - b).map((w) => {
    const r = byWL[w];
    return `Lv${w}:${r.n}動作(${r.s.map((n) => Math.round((100 * n) / r.n)).join('/')})`;
  }).join(' ');
  return {
    seed, lazy, worldEvery: opts.worldEvery || 1, actions: steps, chunks: game.world.chunks.length, worldLevel: FE.Stability.worldLevel(game),
    villages: game.world.villages.length, level: game.level, monsters: game.monsters.length,
    faults: game.reports.length - before, faultMsgs: game.reports.slice(0, 3).map((r) => r.message), steps: game.player.steps, deaths,
    indoorSteps: enteredHouse, stateShare: lv.map((n) => (n / steps).toFixed(2)).join('/'),
    firstUnrest: first[1], firstUnrestWL: firstWL[1], firstChaos: first[2], firstChaosWL: firstWL[2],
    perWorldLevel: perWL,
    bugTotal: `min${pct(0)} p50 ${pct(0.5)} p90 ${pct(0.9)} max${pct(1)}`, recur: st.recur, sabotage: st.sabotage,
    soldiers: `出動 ${st.sorties} 次、出手 ${st.soldierAttacks}、清掉 ${st.soldierKills} 隻、陣亡 ${st.soldierDeaths}、補回 ${st.refills}`,
    weapon: `Lv${game.player.weaponLv}（攻擊力 ${game.player.atk}）`, bag: game.player.bag.map((e) => `${e.name}×${e.n}`).join(' '),
  };
}

const sim = [];
const SEEDS = (process.env.FE_SEEDS || '20201,777,314159').split(',').map(Number);
if (!SIM4_ONLY) for (const seed of SEEDS) sim.push(simulate(seed, { steps: 1500 }));
const lazySim = SIM4_ONLY ? null : simulate(20201, { steps: 1500, lazy: true });
// 四人等效：機器人每做 4 個動作，世界才走 1 回合（冒險者算力照常，已乘 PLAYER_COMPUTE_SCALE）
const MAX_ACTIONS = Number(process.env.FE_MAX || 8000);
// 四人等效：機器人每做 4 個動作世界才走 1 回合（四個人的清怪力），每個動作的算力不乘 4（四個人各出一份，一回合合計 4 份）
const sim4 = UNIT_ONLY ? [] : SEEDS.map((seed) => simulate(seed, { worldEvery: 4, scale: 1, minActions: 3000, untilChunks: 15, maxActions: MAX_ACTIONS }));

// ---- 對話視窗的邏輯（game.talkOptions／choose） ----
// 撞上村民或武器匠：打開對話，算一個動作、不算步數、不當成攻擊；選項不再額外花動作
let dlgChecks = 0;
function testDialogs() {
  const ok = (cond, msg) => { dlgChecks++; if (!cond) fail('對話 ' + msg); };
  const g = new FE.Game(4242);
  g.start();
  const villagers = () => g.world.npcs.filter((n) => n.role !== 'smith');
  for (let i = 0; i < 15 && (villagers().length < 3 || !g.world.npcs.some((n) => n.role === 'smith')); i++) g.createChunk(false);
  const vs = villagers();
  const smith = g.world.npcs.find((n) => n.role === 'smith');
  ok(vs.length >= 3 && !!smith, `村民不夠（${vs.length}）`);
  if (vs.length < 3 || !smith) return;
  g.monsters = g.monsters.filter((m) => !m.small); // 留創世時的怪物，確認對話不會打到牠們
  // 走到 npc 旁邊再撞上去；回傳撞之前的狀態
  const bump = (npc) => {
    const w = g.world;
    const side = DIRS.find(([dx, dy]) => w.passable(npc.x + dx, npc.y + dy) && w.heightOk(npc.x + dx, npc.y + dy, npc.x, npc.y) && !w.npcAt(npc.x + dx, npc.y + dy) && !g.monsterAt(npc.x + dx, npc.y + dy) && !g.soldierAt(npc.x + dx, npc.y + dy));
    ok(!!side, `${npc.name} 旁邊沒有空位`);
    g.player.x = npc.x + side[0];
    g.player.y = npc.y + side[1];
    g.talking = null;
    const before = { turn: g.turn, steps: g.player.steps, x: g.player.x, y: g.player.y, ev: combat.events, hp: g.monsters.map((m) => m.hp).join(), php: g.player.hp };
    g.guard('test', () => g.move(-side[0], -side[1]));
    ok(g.talking === npc.id, `撞上 ${npc.name} 沒有打開對話`);
    ok(g.turn === before.turn + 1, '打開對話不是一個動作');
    ok(g.player.steps === before.steps, '打開對話不該算步數');
    ok(g.player.x === before.x && g.player.y === before.y, '對話時冒險者被移動了');
    ok(combat.events === before.ev && g.monsters.map((m) => m.hp).join() === before.hp, '對話被當成攻擊');
    return before;
  };
  const opt = (npc, id) => g.talkOptions(npc).options.findIndex((o) => o.id === id);
  const ids = (npc) => g.talkOptions(npc).options.map((o) => o.id).join('/');
  const pick = (npc, id) => {
    const i = opt(npc, id);
    ok(i >= 0, `${npc.name} 沒有選項 ${id}（有 ${ids(npc)}）`);
    const turn = g.turn;
    let r = null;
    g.guard('test', () => { r = g.choose(npc, i); });
    ok(g.turn === turn, `選「${id}」不該再花動作`);
    return r;
  };
  const [a, b, c] = vs;

  // 閒聊：沒有委託的村民，只有「離開」
  a.quest = null;
  bump(a);
  ok(ids(a) === 'leave', `閒聊的選項是 ${ids(a)}`);
  ok(g.talkOptions(a).text.length > 0 && g.talkOptions(a).text === g.talkOptions(a).text, '閒話是空的，或同一場對話裡每次不一樣');
  ok(pick(a, 'leave').close && g.talking === null, '離開沒有關掉對話');

  // 武器匠：錢不夠時選項寫差多少，選了不改良；錢夠就改良，攻擊力加 1～2
  bump(smith);
  const sv = g.world.villageById(smith.villageId);
  const price = g.smithPrice(sv);
  g.player.gold = price - 7;
  let o = g.talkOptions(smith).options[opt(smith, 'improve')];
  ok(o.disabled && o.note.includes('還差 7'), `錢不夠的說明：${o.note}`);
  const atk0 = g.player.atk;
  ok(!pick(smith, 'improve').close && g.talking === smith.id && g.player.atk === atk0, '錢不夠時不該改良或關掉對話');
  g.player.gold = price + 5;
  ok(pick(smith, 'improve').close && g.talking === null, '改良後沒有關掉對話');
  ok(g.player.atk - atk0 >= 1 && g.player.atk - atk0 <= 2 && g.player.weaponLv === 1 && g.player.gold === 5, `改良結果 atk ${atk0}→${g.player.atk}、金幣 ${g.player.gold}`);
  ok(g.talkOptions(smith).text.includes(`Lv${g.player.weaponLv}`), '武器匠的對話沒寫目前的武器 Lv');

  // 送貨委託：不接，之後回來還接得到；接下；交件優先於接委託；手上有委託時別人的委託不能接
  b.quest = FE.makeQuest(g.world, g.rng, b, c);
  bump(b);
  ok(ids(b) === 'accept/decline', `委託的選項是 ${ids(b)}`);
  ok(pick(b, 'decline').close && !b.quest.accepted && !g.player.carrying, '不接之後委託或手上的狀態不對');
  FE.Save.save(g);
  const back = FE.Save.load();
  const b2 = back && back.game && back.game.world.npcById(b.id);
  ok(!!b2 && b2.quest && !b2.quest.accepted, '不接的委託存檔讀不回來');
  bump(b);
  ok(ids(b) === 'accept/decline', '不接之後回來沒有再問一次');
  pick(b, 'accept');
  ok(b.quest.accepted && g.player.carrying && g.player.carrying.targetId === c.id, '接下後手上沒有委託');
  // 送貨的物品放進背包（委託資料照舊，手上不再記物品）
  const goods = g.goodsFor(g.player.carrying);
  ok(!!goods && goods.name === b.quest.item && goods.n === 1 && g.player.carrying.item === undefined, `接下送貨後背包裡沒有要送的東西（${JSON.stringify(g.player.bag)}）`);
  bump(b);
  ok(ids(b) === 'leave', `接下後再找委託人：${ids(b)}`);
  g.closeTalk();
  const third = vs[3];
  if (third) {
    third.quest = FE.makeQuest(g.world, g.rng, third, a);
    bump(third);
    ok(ids(third) === 'leave', `手上有委託時別人的委託：${ids(third)}`);
    g.closeTalk();
  }
  c.quest = FE.makeQuest(g.world, g.rng, c, a); // 收貨人自己也有委託，貨照樣交得出去
  const gold0 = g.player.gold;
  const exp0 = g.exp;
  const car = g.player.carrying;
  bump(c);
  ok(ids(c) === 'deliver/leave', `收貨人的選項是 ${ids(c)}`);
  pick(c, 'deliver');
  ok(!g.player.carrying && b.quest.done && g.player.gold === gold0 + car.gold && g.exp === exp0 + car.exp, '交件後狀態不對');
  ok(!g.player.bag.some((e) => e.id === 'goods'), '交件後要送的東西還在背包裡');
  bump(c);
  ok(ids(c) === 'accept/decline', `交件後收貨人自己的委託：${ids(c)}`);
  g.closeTalk();

  // 清除委託：接下後小怪物沒清完只有「離開」，清完才能回報領獎勵
  const mon = g.monsters[0];
  if (mon) {
    a.quest = { kind: 'hunt', monsterIds: [mon.id], total: 1, village: '測試村', exp: 20, gold: 15, accepted: false, done: false };
    bump(a);
    ok(ids(a) === 'accept/decline', `清除委託的選項是 ${ids(a)}`);
    pick(a, 'accept');
    ok(g.player.carrying && g.player.carrying.kind === 'hunt', '接下清除委託後手上沒有委託');
    bump(a);
    ok(ids(a) === 'leave', `小怪物沒清完：${ids(a)}`);
    g.closeTalk();
    g.monsters = g.monsters.filter((m) => m !== mon);
    const gold1 = g.player.gold;
    const exp1 = g.exp;
    bump(a);
    ok(ids(a) === 'report/leave', `小怪物清完：${ids(a)}`);
    pick(a, 'report');
    ok(a.quest.done && !g.player.carrying && g.player.gold === gold1 + 15 && g.exp === exp1 + 20, '回報後狀態不對');
  }
  // 沒有開著的對話時，choose 不會拋例外
  g.talking = null;
  ok(g.choose(a, 99).close === false, '選不存在的選項該什麼都不做');
}
try { testDialogs(); } catch (e) { fail('對話測試拋出例外：' + e.stack); }

// ---- 創世門檻：清光一塊世界的內容（不含途中動作）累積的創世力一定夠解出下一塊 ----
let creationChecks = 0;
function testCreation() {
  const ok = (cond, msg) => { creationChecks++; if (!cond) fail('創世門檻 ' + msg); };
  const S = C.PLAYER_COMPUTE_SCALE * C.CREATION_SHARE;
  for (const seed of [11, 222, 3333, 44444]) {
    const g = new FE.Game(seed);
    g.start();
    g.checkCreate = () => {}; // 手動控制，殺怪時不要自己創出下一塊
    for (let k = 0; k < 7; k++) {
      const ids0 = new Set(k > 0 ? g.monsters.map((m) => m.id) : []);
      const prev = k > 0 ? g.nextChunkAt : 0;
      if (k > 0) g.createChunk(false);
      const chunk = g.world.chunks[g.world.chunks.length - 1];
      const newM = g.monsters.filter((m) => !ids0.has(m.id));
      const delta = g.nextChunkAt - prev;
      const mp = newM.reduce((s, m) => s + m.compute, 0) * S;
      const qs = g.world.npcs.filter((n) => FE.inRect(chunk, n.x, n.y) && n.quest).map((n) => n.quest);
      const qAll = qs.reduce((s, q) => s + q.compute, 0) * S;
      ok(delta >= mp - 1e-6 && delta <= mp + qAll + 1e-6, `seed${seed} 第 ${k + 1} 塊門檻 ${delta.toFixed(1)} 不在 [${mp.toFixed(1)}, ${(mp + qAll).toFixed(1)}] 之間`);
      ok(newM.every((m) => m.compute > 0 && m.exp > 0), `seed${seed} 第 ${k + 1} 塊有怪物沒有算力或經驗值`);
      // 真的把這塊的怪物都打倒、任務都完成：累計創世力要夠解出下一塊
      for (const m of newM) {
        const c0 = g.creation;
        g.defeat(m);
        ok(g.creation - c0 >= m.compute * S - 1e-6, `seed${seed} 打倒 ${m.name} 只給了 ${(g.creation - c0).toFixed(2)}，應該是 ${(m.compute * S).toFixed(2)}`);
      }
      for (const q of qs) g.earn(q.compute);
      ok(g.creation >= g.nextChunkAt - 1e-6, `seed${seed} 清光第 ${k + 1} 塊後創世力 ${g.creation.toFixed(1)} < 門檻 ${g.nextChunkAt.toFixed(1)}`);
    }
  }
  // 每個動作的算力：移動、出手各 1，乘上 PLAYER_COMPUTE_SCALE，一半進創世力；修補力另外有虛擬算力
  const g = new FE.Game(99);
  g.start();
  g.checkCreate = () => {};
  g.monsters = [];
  const c0 = g.creation;
  const r0 = g.compute;
  g.player.hp = g.player.maxHp;
  const sides = DIRS.filter(([dx, dy]) => g.world.passable(g.player.x + dx, g.player.y + dy) && g.world.heightOk(g.player.x, g.player.y, g.player.x + dx, g.player.y + dy) && !g.world.npcAt(g.player.x + dx, g.player.y + dy));
  g.move(sides[0][0], sides[0][1]);
  ok(Math.abs(g.creation - c0 - C.COMPUTE_PER_MOVE * C.PLAYER_COMPUTE_SCALE * C.CREATION_SHARE) < 1e-9, `走一步的創世力 ${g.creation - c0}`);
  const repairStep = g.compute - r0;
  ok(Math.abs(repairStep - (C.COMPUTE_PER_MOVE * C.PLAYER_COMPUTE_SCALE * (1 - C.CREATION_SHARE) + C.VIRTUAL_REPAIR)) < 1e-9, `走一步的修補力 ${repairStep}`);
  const c1 = g.creation;
  g.rest();
  ok(g.creation === c1, '休息不該增加創世力');
  const e0 = g.exp;
  g.addExp(1000);
  ok(g.creation === c1 && g.exp === e0 + 1000, '經驗值不該影響創世力');
}
try { testCreation(); } catch (e) { fail('創世門檻測試拋出例外：' + e.stack); }

// ---- 世界等級：隱藏，每 3 塊升一級；怪物與世界狀態的加成 ----
let wlChecks = 0;
function testWorldLevel() {
  const ok = (cond, msg) => { wlChecks++; if (!cond) fail('世界等級 ' + msg); };
  const P = C.CHUNKS_PER_WORLD_LEVEL;
  const lvOf = [[1, 1], [P, 1], [P + 1, 2], [2 * P, 2], [2 * P + 1, 3], [3 * P + 1, 4], [4 * P + 1, 5], [5 * P + 1, 6]];
  for (const [n, wl] of lvOf) ok(FE.worldLevelFor(n) === wl, `${n} 塊應該是等級 ${wl}，算出 ${FE.worldLevelFor(n)}`);
  ok(C.MERGE_RATIO === 1.5, '合體門檻基準不是 1.5');
  const mk = (wl, scope, type) => FE.makeMonster({ type: type || 'TERRAIN', x: 0, y: 0, cells: [], scope }, 1, wl);
  const a = mk(1, 4);
  const b = mk(4, 4);
  ok(b.maxHp === Math.round(a.maxHp * (1 + 3 * C.WL_BONUS.HP)) && b.atk === Math.round(a.atk * 1.3), `等級 4 的血量／攻擊力 ${b.maxHp}/${b.atk}（等級 1 是 ${a.maxHp}/${a.atk}）`);
  ok(b.exp === Math.round(a.exp * 1.3) && Math.abs(b.compute - Math.round(a.compute * 1.3 * 10) / 10) < 1e-9, `等級 4 的經驗值／算力 ${b.exp}/${b.compute}`);
  ok(a.compute === 3 && mk(1, 6).compute === 11, `等級 1 的算力 ${a.compute}／${mk(1, 6).compute}（小怪物 3、影響範圍 6 的中型怪物 8＋3）`);
  const da = FE.monsterDef(a);
  const db = FE.monsterDef(b);
  ok(Math.abs(db.dodge - da.dodge - 0.03) < 1e-9 && Math.abs(db.block - da.block - 0.03) < 1e-9 && db.blockMax - da.blockMax === 3, '防禦的世界等級加成不對');
  const g = new FE.Game(31337);
  g.start();
  g.worldState = 0;
  ok(FE.Stability.worldLevel(g) === 1 && FE.Stability.maxScope(g) === 3, `等級 1 的影響範圍上限 ${FE.Stability.maxScope(g)}`);
  while (g.world.chunks.length < 4 * P + 1) g.createChunk(false);
  g.monsters = [];
  g.worldState = 0;
  ok(FE.Stability.worldLevel(g) === 5, `${4 * P + 1} 塊的世界等級 ${FE.Stability.worldLevel(g)}`);
  ok(FE.Stability.maxScope(g) === Math.round(3 * 1.4) && Math.abs(FE.Stability.scale(g, 'CORRUPT') - 1.4) < 1e-9, '等級 5 的影響範圍上限或侵蝕頻率不對');
  // 世界狀態的分界跟著升高：整體 BUG 值是第一個分界的 1.15 倍，在等級 1 是動盪，在等級 5（分界 ×1.4）還是安穩
  const cut0 = C.STATE_CUTS[0];
  const g1 = new FE.Game(1);
  g1.start();
  g1.monsters = [{ scope: Math.round(cut0 * 1.15), x: 0, y: 0 }];
  FE.Stability.update(g1, true);
  g.monsters = [{ scope: Math.round(cut0 * 1.15), x: 0, y: 0 }];
  g.worldState = 0;
  FE.Stability.update(g, true);
  ok(g1.worldState === 1 && g.worldState === 0, `分界：等級 1 狀態 ${g1.worldState}、等級 5 狀態 ${g.worldState}`);
  g.monsters = [{ scope: Math.round(cut0 * 1.45), x: 0, y: 0 }];
  FE.Stability.update(g, true);
  ok(g.worldState === 1, `等級 5 整體 BUG 值是第一個分界的 1.45 倍，應該動盪，狀態 ${g.worldState}`);
  g.monsters = [];
  FE.Stability.update(g, true);
}
try { testWorldLevel(); } catch (e) { fail('世界等級測試拋出例外：' + e.stack); }

// ---- 士兵：場景測試 ----
let soldierChecks = 0;
function testSoldiers() {
  const ok = (cond, msg) => { soldierChecks++; if (!cond) fail('士兵 ' + msg); };
  const g = new FE.Game(5150);
  g.start();
  for (let i = 0; i < 12 && !g.world.villages.some((v) => v.kind === 'town'); i++) g.createChunk(false);
  const town = g.world.villages.find((v) => v.kind === 'town');
  ok(!!town, '12 塊內沒有城鎮');
  if (!town) return;
  const w = g.world;
  const mine = () => g.soldiers.filter((s) => s.villageId === town.id);
  const quota = g.soldierQuota(town);
  ok(mine().length === quota && quota === 3, `城鎮的士兵 ${mine().length} 位，應該固定是 3（quota ${quota}）`);
  g.checkCreate = () => {};
  g.monsters = [];
  g.player.x = town.cx;
  g.player.y = town.cy;
  g.player.hp = g.player.maxHp;
  const stat = FE.Stability.stat(g);

  // 安穩：士兵在城鎮裡室外走動，不出城鎮
  for (let i = 0; i < 80; i++) g.rest();
  ok(mine().every((s) => w.villageAt(s.x, s.y) === town && FE.Steading.roomAt(town, s.x, s.y) < 0), '安穩時士兵跑出城鎮或進了建築');

  // 失序：場上有一隻事件生的小怪物（m.small，血量 1）跟一隻創世時的怪物；士兵只打前一隻
  const reach = flood(w, [[mine()[0].x, mine()[0].y]]);
  const chunk = w.chunkAt(town.cx, town.cy);
  const cand = [...reach].map((k) => k.split(',').map(Number)).filter(([x, y]) => !w.inBuffer(x, y) && w.chunkAt(x, y) === chunk && w.passable(x, y))
    .sort((a, b) => Math.abs(a[0] - town.cx) + Math.abs(a[1] - town.cy) - (Math.abs(b[0] - town.cx) + Math.abs(b[1] - town.cy)));
  ok(cand.length > 20, '城鎮外面找不到放怪物的地方');
  const put = ([x, y], small) => {
    const m = g.spawnMonster({ type: 'TERRAIN', x, y, cells: [[x, y]], scope: 2, data: {} }, null);
    m.small = small;
    return m;
  };
  const prey = put(cand[0], true);
  const bystander = put(cand.find(([x, y]) => Math.abs(x - cand[0][0]) + Math.abs(y - cand[0][1]) === 2) || cand[4], false);
  prey.hp = 1;
  const saved = C.STATE_CUTS.slice();
  C.STATE_CUTS = [1, 2];
  FE.Stability.update(g, true);
  ok(g.worldState === 2, `強制失序沒成功，狀態 ${g.worldState}`);
  const exp0 = g.exp;
  const cr0 = g.creation;
  const chests0 = w.chests.length;
  let left = false;
  for (let i = 0; i < 300 && g.monsters.includes(prey); i++) {
    g.rest();
    if (mine().some((s) => w.villageAt(s.x, s.y) !== town)) left = true;
    if (!mine().length) break;
  }
  ok(left, '失序時士兵沒有出城');
  ok(!g.monsters.includes(prey) || !mine().length, '士兵沒有打倒事件生的小怪物');
  ok(g.exp === exp0 && g.creation === cr0 && w.chests.length === chests0, '士兵打倒的怪物給了冒險者經驗值、創世力或寶箱');
  ok(g.monsters.includes(bystander) && bystander.hp === bystander.maxHp, '士兵碰了創世時的怪物');
  ok(stat.soldierKills >= (g.monsters.includes(prey) ? 0 : 1), '士兵清掉的數量沒有記下來');
  // 公平的一戰：滿血的小怪物，看整隊士兵打不打得贏（只統計，不算錯）
  if (g.monsters.includes(bystander)) g.monsters = g.monsters.filter((m) => m !== bystander);
  const fair = put(cand[2] || cand[0], true);
  C.STATE_CUTS = [0.5, 1];
  FE.Stability.update(g, true);
  g.soldiers = g.soldiers.filter((o) => o.villageId !== town.id); // 換一隊滿血、站在城鎮裡的士兵
  g.refillSoldiers();
  let rounds = 0;
  for (; rounds < 300 && g.monsters.includes(fair) && mine().length; rounds++) g.rest();
  console.log(`士兵公平一戰：${mine().length ? '' : '全隊陣亡，'}${g.monsters.includes(fair) ? '沒打倒' : '打倒了'}（${rounds} 回合，士兵 ${quota} 位，小怪物血量 ${fair.maxHp}）`);

  // 陣亡的士兵：失序中不補，回到安穩才補回原本的人數；其他的走回城鎮
  C.STATE_CUTS = [1, 2];
  g.monsters = [{ scope: 20, x: 0, y: 0 }];
  FE.Stability.update(g, true);
  const full = mine().length === quota;
  if (!full) g.refillSoldiers();
  const victim = mine()[0];
  g.soldierDown(victim, null);
  FE.Stability.update(g, true);
  ok(mine().length === quota - 1 && g.worldState === 2, `陣亡後失序中人數 ${mine().length}（應該 ${quota - 1}）`);
  C.STATE_CUTS = saved;
  g.monsters = [];
  FE.Stability.update(g, true);
  ok(g.worldState === 0 && mine().length === quota, `回到安穩後士兵 ${mine().length}/${quota}（狀態 ${g.worldState}）`);
  for (let i = 0; i < 200; i++) g.rest();
  ok(mine().every((s) => w.villageAt(s.x, s.y) === town), '回到安穩後士兵沒有走回城鎮');

  // 對話：撞上士兵開對話視窗，一句閒話；選「離開」關掉
  const s = mine()[0];
  const side = DIRS.find(([dx, dy]) => w.passable(s.x + dx, s.y + dy) && w.heightOk(s.x + dx, s.y + dy, s.x, s.y) && !w.npcAt(s.x + dx, s.y + dy) && !g.soldierAt(s.x + dx, s.y + dy) && FE.Steading.roomAt(town, s.x + dx, s.y + dy) < 0);
  ok(!!side, '士兵旁邊沒有空位');
  if (side) {
    g.player.x = s.x + side[0];
    g.player.y = s.y + side[1];
    g.talking = null;
    const turn0 = g.turn;
    g.guard('test', () => g.move(-side[0], -side[1]));
    ok(g.talking === s.id && g.turn === turn0 + 1, '撞上士兵沒有打開對話（算一個動作）');
    const t = g.talkOptions(g.talkTarget(g.talking));
    ok(t.role === '士兵' && t.options.length === 1 && t.options[0].id === 'leave' && t.text.length > 0, `士兵的對話內容不對：${t.role}／${t.options.map((o) => o.id)}`);
    g.choose(g.talkTarget(g.talking), 0);
    ok(g.talking === null, '離開沒有關掉士兵的對話');
  }
  C.STATE_CUTS = saved;
}
try { testSoldiers(); } catch (e) { fail('士兵測試拋出例外：' + e.stack); }

// ---- 背包、工具、採集、藥草、礦石改良、艱難選擇只罰冒險者：場景測試 ----
let bagChecks = 0;
function testBackpack() {
  const ok = (cond, msg) => { bagChecks++; if (!cond) fail('背包 ' + msg); };
  // 找一個有礦坑（礦脈）的世界
  let g = null;
  for (let seed = 1; seed < 400 && !g; seed++) {
    const t = new FE.Game(seed * 131);
    t.start();
    for (let i = 0; i < 6 && !t.world.nodes.some((n) => n.kind === 'ore'); i++) t.createChunk(false);
    if (t.world.nodes.some((n) => n.kind === 'ore') && t.world.nodes.some((n) => n.kind === 'herb')) g = t;
  }
  ok(!!g, '找不到有礦脈和藥草的世界');
  if (!g) return;
  const w = g.world;
  const p = g.player;
  g.checkCreate = () => {};
  g.monsters = [];

  // 疊放：同一種東西疊在一起；送貨的物品另外放，不跟採來的藥草疊
  g.bagAdd('herb', 1);
  g.bagAdd('herb', 2);
  g.bagAdd('goods', 1, { name: '藥草', giverId: 777 });
  ok(p.bag.filter((e) => e.id === 'herb').length === 1 && g.bagCount('herb') === 3, `藥草沒有疊放：${JSON.stringify(p.bag)}`);
  ok(g.bagEntry('goods', 777) && g.bagEntry('goods', 777).n === 1 && g.bagList().length === 2, '送貨的物品沒有另外放');
  ok(!g.bagList().find((e) => e.id === 'goods').use && g.bagList().find((e) => e.id === 'herb').use, '只有藥草能直接用');
  ok(g.bagTake('herb', 5) === false && g.bagCount('herb') === 3, '不夠時不該拿出來');
  p.bag = [];

  // 買工具：錢不夠時選項寫差多少、選了不買；錢夠就買，已有的不再出現
  const smith = w.npcs.find((n) => n.role === 'smith');
  const ids = () => g.talkOptions(smith).options.map((o) => o.id);
  const opt = (id) => g.talkOptions(smith).options.find((o) => o.id === id);
  const pick = (id) => g.choose(smith, g.talkOptions(smith).options.findIndex((o) => o.id === id));
  p.gold = C.TOOL_PRICE - 1;
  ok(opt('buyPick') && opt('buyPick').disabled && opt('buyPick').note.includes('還差 1 金幣') && opt('buySickle').disabled, `錢不夠時買工具的選項：${JSON.stringify(opt('buyPick'))}`);
  g.talking = smith.id;
  pick('buyPick');
  ok(!g.bagCount('pick') && p.gold === C.TOOL_PRICE - 1, '錢不夠還是買到了礦鎬');
  p.gold = C.TOOL_PRICE * 2 + 5;
  pick('buyPick');
  ok(g.bagCount('pick') === 1 && p.gold === C.TOOL_PRICE + 5 && !ids().includes('buyPick') && ids().includes('buySickle'), `買礦鎬之後 ${ids()}，金幣 ${p.gold}`);
  pick('buySickle');
  ok(g.bagCount('sickle') === 1 && p.gold === 5 && !ids().includes('buySickle'), `買鐮刀之後 ${ids()}，金幣 ${p.gold}`);
  g.bagAdd('pick', 0);
  ok(g.bagCount('pick') === 1, '工具重複了');

  // 採集：沒工具時照常走過去、訊息寫需要什麼；有工具時撞上去就採，不移動，得到 1～2 份，算一個動作、產生跟移動一樣的算力；
  // 採完那一格變回普通地面，2000 刻後長回來
  const S = C.PLAYER_COMPUTE_SCALE * C.CREATION_SHARE;
  const besides = (n) => DIRS.find(([dx, dy]) => w.canStep(n.x + dx, n.y + dy, n.x, n.y) && w.passable(n.x + dx, n.y + dy) && !w.npcAt(n.x + dx, n.y + dy) && !g.soldierAt(n.x + dx, n.y + dy) && !g.nodeAt(n.x + dx, n.y + dy) && !w.chestAt(n.x + dx, n.y + dy));
  for (const kind of ['herb', 'ore']) {
    const def = FE.NODES[kind];
    const toolName = FE.BAG_ITEMS[def.tool].name;
    const node = w.nodes.find((n) => n.kind === kind && besides(n) && !w.chestAt(n.x, n.y));
    ok(!!node, `找不到旁邊能站的${def.name}`);
    if (!node) continue;
    const [dx, dy] = besides(node);
    // 沒有工具
    const tool = p.bag.find((e) => e.id === def.tool);
    p.bag = p.bag.filter((e) => e !== tool);
    p.x = node.x + dx; p.y = node.y + dy;
    g.move(-dx, -dy);
    const said = g.log.slice(0, 5).find((l) => l.text.includes(`需要${toolName}`));
    ok(p.x === node.x && p.y === node.y && !!said && !g.bagCount(def.item), `沒有${toolName}時：位置 (${p.x},${p.y})、訊息「${g.log.slice(0, 3).map((l) => l.text).join('／')}」`);
    // 有工具
    p.bag.push(tool);
    p.x = node.x + dx; p.y = node.y + dy;
    const t0 = g.turn, c0 = g.creation, n0 = g.bagCount(def.item), steps0 = p.steps;
    g.move(-dx, -dy);
    const got = g.bagCount(def.item) - n0;
    ok(p.x === node.x + dx && p.y === node.y + dy && got >= 1 && got <= 2 && g.turn === t0 + 1 && p.steps === steps0, `有${toolName}時：得到 ${got} 份、回合 ${g.turn - t0}、位置 (${p.x},${p.y})`);
    ok(Math.abs(g.creation - c0 - C.COMPUTE_PER_GATHER * S) < 1e-9 && C.COMPUTE_PER_GATHER === 0.15, `採集的創世力 ${g.creation - c0}`);
    ok(!g.nodeAt(node.x, node.y) && node.regrowAt > g.ticks - 50, `${def.name}採完沒有變回普通地面`);
    // 採完的那一格走得過去，不會再採
    const n1 = g.bagCount(def.item);
    g.move(-dx, -dy);
    ok(p.x === node.x && p.y === node.y && g.bagCount(def.item) === n1, `採完的${def.name}那一格沒有變回普通地面`);
    // 存檔讀回來，採完的狀態還在
    FE.Save.save(g);
    const back = FE.Save.load();
    const bn = back && back.game && back.game.world.nodes.find((o) => o.id === node.id);
    ok(!!bn && bn.regrowAt === node.regrowAt && !back.game.nodeAt(node.x, node.y) && back.game.bagCount(def.item) === n1, '採集點或背包的狀態存檔讀不回來');
    // 2000 刻後長回來
    g.ticks = node.regrowAt - 1;
    ok(!g.nodeAt(node.x, node.y), `${def.name}還不到 2000 刻就長回來`);
    g.ticks = node.regrowAt;
    ok(g.nodeAt(node.x, node.y) === node && node.regrowAt - C.REGROW_TICKS <= node.regrowAt, `${def.name}到了 2000 刻沒有長回來`);
  }

  // 吃藥草：回生命上限的 25%（無條件進位），算一個動作，戰鬥中也能吃；滿血不吃
  p.bag = p.bag.filter((e) => e.id !== 'herb');
  g.bagAdd('herb', 3);
  p.maxHp = 30;
  p.hp = 10;
  let t0 = g.turn;
  g.useItem(g.bagList().findIndex((e) => e.id === 'herb'));
  ok(p.hp === 18 && g.bagCount('herb') === 2 && g.turn === t0 + 1, `吃藥草後 生命 ${p.hp}、藥草 ${g.bagCount('herb')}、回合 ${g.turn - t0}`);
  p.hp = p.maxHp;
  t0 = g.turn;
  g.eatHerb();
  ok(g.bagCount('herb') === 2 && g.turn === t0, '滿血時不該吃藥草');
  // 戰鬥中：旁邊有怪物也能吃
  const side = DIRS.find(([dx, dy]) => w.canStep(p.x, p.y, p.x + dx, p.y + dy) && !w.npcAt(p.x + dx, p.y + dy) && !g.nodeAt(p.x + dx, p.y + dy));
  if (side && !w.inVillage(p.x, p.y)) {
    const m = g.spawnMonster({ type: 'TERRAIN', x: p.x + side[0], y: p.y + side[1], cells: [], scope: 1, data: {} }, null);
    Object.assign(m, { x: p.x + side[0], y: p.y + side[1], home: { x: p.x + side[0], y: p.y + side[1] }, atk: 0 });
    p.hp = 5;
    t0 = g.turn;
    const fighting = g.adjacentMonsters().includes(m);
    g.eatHerb();
    ok(fighting && p.hp >= 5 + Math.ceil(p.maxHp * C.HERB_HEAL) - 3 && g.turn === t0 + 1 && g.bagCount('herb') === 1, `戰鬥中吃藥草：生命 ${p.hp}、藥草 ${g.bagCount('herb')}`);
    g.monsters = [];
  }

  // 礦石改良：Lv5 以下不用礦石；Lv5→6 一顆，之後每級多一顆；缺礦石不能改，金幣照舊要付
  p.bag = p.bag.filter((e) => e.id !== 'ore');
  const sv = w.villageById(smith.villageId);
  const improve = () => { g.talking = smith.id; return g.choose(smith, g.talkOptions(smith).options.findIndex((o) => o.id === 'improve')); };
  p.weaponLv = 4;
  p.gold = 10000;
  ok(g.oreNeeded() === 0 && !opt('improve').disabled, 'Lv4 改良不該要礦石');
  improve();
  ok(p.weaponLv === 5 && g.bagCount('ore') === 0, `Lv4 改良後 Lv${p.weaponLv}`);
  ok(g.oreNeeded() === 1 && opt('improve').disabled && opt('improve').note.includes('1 顆礦石') && g.talkOptions(smith).text.includes('還差 1 顆礦石'), `Lv5 沒礦石：${JSON.stringify(opt('improve'))}／${g.talkOptions(smith).text}`);
  let gold0 = p.gold;
  improve();
  ok(p.weaponLv === 5 && p.gold === gold0, 'Lv5 沒礦石還是改良了');
  g.bagAdd('ore', 1);
  gold0 = p.gold;
  const price5 = g.smithPrice(sv);
  improve();
  ok(p.weaponLv === 6 && g.bagCount('ore') === 0 && p.gold === gold0 - price5, `Lv5→6：Lv${p.weaponLv}、礦石 ${g.bagCount('ore')}、金幣少了 ${gold0 - p.gold}（應該 ${price5}）`);
  g.bagAdd('ore', 1);
  ok(g.oreNeeded() === 2 && opt('improve').disabled && g.talkOptions(smith).text.includes('還差 1 顆礦石'), `Lv6 要 2 顆礦石：${g.oreNeeded()}`);
  improve();
  ok(p.weaponLv === 6 && g.bagCount('ore') === 1, 'Lv6 礦石不夠還是改良了');
  g.bagAdd('ore', 1);
  improve();
  ok(p.weaponLv === 7 && g.bagCount('ore') === 0 && g.oreNeeded() === 3, `Lv6→7 後 Lv${p.weaponLv}、礦石 ${g.bagCount('ore')}`);

  // 艱難選擇只罰冒險者：怪物出手擲出 6～10 時冒險者不會必定反擊；冒險者擲出 6～10 時怪物必定反擊
  g.monsters = [];
  const at = DIRS.map(([dx, dy]) => [p.x + dx, p.y + dy]).find(([x, y]) => w.canStep(p.x, p.y, x, y) && !w.npcAt(x, y));
  const m = g.spawnMonster({ type: 'UNREACHABLE', x: at[0], y: at[1], cells: [], scope: 2, data: {} }, null);
  Object.assign(m, { x: at[0], y: at[1], atk: 1, maxHp: 1e6, hp: 1e6 });
  const hook0 = FE.Combat.hook;
  const seen = { mHard: 0, mHardCountered: 0, pHard: 0, pHardCountered: 0 };
  FE.Combat.hook = (e) => {
    if (e.by === 'monster' && e.key === 'hard' && !e.counter) { seen.mHard++; if (e.countered) seen.mHardCountered++; }
    if (e.by === 'player' && e.key === 'hard' && !e.counter) { seen.pHard++; if (e.countered) seen.pHardCountered++; }
  };
  const counter0 = C.PLAYER_COUNTER;
  C.PLAYER_COUNTER = 0;
  for (let i = 0; i < 600; i++) {
    p.hp = p.maxHp = 1e6;
    m.hp = 1e6;
    FE.Combat.resolveAttack(g, m, p, 'attack');
    FE.Combat.resolveAttack(g, p, m, 'attack');
  }
  C.PLAYER_COUNTER = counter0;
  FE.Combat.hook = hook0;
  ok(seen.mHard > 50 && seen.mHardCountered === 0, `怪物擲出 6～10 ${seen.mHard} 次，冒險者反擊了 ${seen.mHardCountered} 次（反擊機率設成 0，應該是 0）`);
  ok(seen.pHard > 50 && seen.pHardCountered === seen.pHard, `冒險者擲出 6～10 ${seen.pHard} 次，怪物只反擊了 ${seen.pHardCountered} 次（應該每次都反擊）`);
  const line = g.log.find((l) => l.text.startsWith(m.name + '攻擊你') && /擲出 ([6-9]|10)：/.test(l.text));
  ok(!line || !line.text.includes('必定反擊'), `怪物擲出 6～10 的訊息還寫著必定反擊：${line && line.text}`);
}
try { testBackpack(); } catch (e) { fail('背包測試拋出例外：' + e.stack); }

// ---- 報告 ----
const avg = (a, f) => (a.length ? (a.reduce((s, x) => s + f(x), 0) / a.length).toFixed(2) : '-');
const rate = (a, f) => `${a.filter(f).length}/${a.length}`;
for (const k of ['village', 'town']) {
  const a = stats[k];
  console.log(`${k}: ${a.length} 座｜民房蓋齊 ${rate(a, (s) => s.houses >= s.want)}｜工坊 ${rate(a, (s) => s.smithy)}｜神殿與市場 ${rate(a, (s) => s.temple && s.market)}｜出入口（量到）${avg(a, (s) => s.groups)}｜平均民房 ${avg(a, (s) => s.houses)}（8 格 ${avg(a, (s) => s.big)}）｜床 ${avg(a, (s) => s.beds)}｜村民 ${avg(a, (s) => s.villagers)}`);
  console.log(`  外形：平均外接矩形 ${avg(a, (s) => s.gw)}×${avg(a, (s) => s.gh)}（工作範圍 ${k === 'town' ? C.TOWN_W + '×' + C.TOWN_H : C.VILLAGE_W + '×' + C.VILLAGE_H}），佔工作範圍 ${avg(a, (s) => s.garea)}，牆內空地（走道與零碎空地）佔聚落 ${avg(a, (s) => s.gopen)}`);
}
console.log(`貼著外牆有 3 格以上水或巨石的聚落：${geo.nearBlock}/${geo.count}`);
console.log(`地貌 ${stats.landmarks}，沒放成 ${stats.landmarkMiss}｜每塊創世平均 ${avg(stats.ms, (x) => x)} ms，最慢 ${Math.max(...stats.ms)} ms`);
console.log(`出入口不足、生出斷層怪物的聚落：${stats.gateBugs} 座｜民房或床位沒蓋齊（可接受的粗糙）：${stats.short.length} 件`);
const countOf = (a) => a.reduce((m, x) => ((m[x] = (m[x] || 0) + 1), m), {});
if (!SIM4_ONLY) {
  console.log(`城鎮：第一座都在第 ${JSON.stringify(countOf(stats.firstTowns))} 塊｜之後相隔 ${JSON.stringify(countOf(stats.townGaps))} 塊（次數）｜士兵共 ${stats.soldiers} 位`);
  console.log(`創世門檻檢查 ${creationChecks} 項｜世界等級檢查 ${wlChecks} 項｜士兵場景檢查 ${soldierChecks} 項`);
}
for (const s of sim) console.log('單人模擬', JSON.stringify(s));
if (lazySim) console.log('對照（只走路不打怪）', JSON.stringify(lazySim));
for (const s of sim4) console.log('四人等效（世界每 4 個動作走 1 回合，每個動作的算力不乘 4）', JSON.stringify(s));
console.log(`背包、工具、採集、藥草、礦石改良、艱難選擇的場景檢查 ${bagChecks} 項`);
// 量測：各世界等級（怪物生成時的）機器人打倒小怪物、中型怪物平均用了幾下（冒險者自己出手的次數，不含反擊），
// 以及機器人在那個世界等級時的武器等級中間值（單人與四人等效模擬合計）。目標：小怪物約 3 下、中型怪物約 6 下
{
  const med = (a) => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[Math.floor((b.length - 1) / 2)] : '-'; };
  const mean = (a) => (a.length ? (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) : '-');
  const wls = [...new Set(Object.keys(measure.kills).concat(Object.keys(measure.weapon)).map(Number))].sort((a, b) => a - b);
  console.log(`怪物血量的世界等級加成 ${C.WL_BONUS.HP}（每級）｜各世界等級：武器等級中間值、打倒小怪物平均幾下（隻數）、中型怪物平均幾下（隻數）`);
  for (const wl of wls) {
    const k = measure.kills[wl] || { small: [], mid: [] };
    console.log(`  世界等級 ${wl}：武器 Lv${med(measure.weapon[wl] || [])}｜小怪物 ${mean(k.small)} 下（${k.small.length}）｜中型怪物 ${mean(k.mid)} 下（${k.mid.length}）`);
  }
}
console.log(`對話：邏輯檢查 ${dlgChecks} 項｜機器人開了 ${dlgStats.opened} 次對話（接委託 ${dlgStats.accept}、交件 ${dlgStats.deliver}、回報 ${dlgStats.report}、改良武器 ${dlgStats.improve}、買礦鎬 ${dlgStats.buyPick}、買鐮刀 ${dlgStats.buySickle}、離開 ${dlgStats.leave}）`);
console.log(`聚落周圍的怪物（任何時刻、含生成點）：違規 ${bufferViolations} 次`);
const pct = (n, d) => (d ? (100 * n / d).toFixed(1) + '%' : '-');
const dist = (t) => { const n = Object.values(t).reduce((a, b) => a + b, 0); return ['crit', 'hit', 'hard', 'miss', 'fumble'].map((k) => `${k} ${pct(t[k] || 0, n)}`).join('、') + `（共 ${n}）`; };
console.log(`戰鬥：判定 ${combat.events} 次｜冒險者出手 ${dist(combat.player)}｜怪物出手 ${dist(combat.monster)}`);
console.log(`  閃避 ${combat.dodged}、格擋 ${combat.blocked}、暴擊 ${combat.crit}、抗性 ${combat.resisted}、反擊 ${combat.counters}（連鎖 ${combat.chain}）、趁機攻擊 ${combat.opportunity}（打中 ${combat.opportunityHit}）、負傷害 ${combat.negative}｜平均每下 冒險者 ${(combat.pdmg / combat.pn).toFixed(2)}、怪物 ${(combat.mdmg / combat.mn).toFixed(2)}`);
console.log(`從出生點走不到的聚落（世界的斷層）：${cutOff.length} 次 ${cutOff.slice(0, 5).join('、')}`);
console.log(`問題 ${problems.count || 0} 件`);
for (const p of problems) console.log('  ', p);
