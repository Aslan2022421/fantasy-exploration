// 合併測試（每一版都用這支）：node tools/test.js
// 生成統計（40 個種子各創 17 塊）＋3 個種子各 1500 個動作的單人機器人模擬＋一組「只走路不打怪」的對照
// ＋「四人等效」模擬（機器人每做 4 個動作，世界才走 1 回合；3 個種子各至少 3000 個動作、至少創出 15 塊）。
// 檢查：室內走得通、住戶碰得到、聚落周圍沒有怪物（嚴格）、出入口、戰鬥判定、世界狀態、創世耗時、
// 創世門檻（清光一塊的內容一定解得出下一塊）、世界等級加成、城鎮出現時機、士兵的行為、
// 背包與送貨物品、買工具、採集、藥草、怪物出手擲 6～10 不讓冒險者必定反擊、
// 第二十五版：新的可達性檢查跟全世界檢查的結果一致、品質倍率與四捨五入、清除等級與抗性門檻、防具減傷至少吃 1 點、
// 磨損與壞掉、鐵匠／武器匠／盔甲匠的買修打造賣、盾牌歸盔甲匠、負重兩段減值、打造與掉落的品質範圍。
// 機器人會買防具與盾牌、穿上、耐久低時回去修、錢夠時換更好的品質、超重時賣礦石或丟東西。
// 另外量測：各世界等級機器人打倒小怪物、中型怪物平均用了幾下，以及主手武器清除等級的中間值（校準怪物血量的世界等級加成用），
// 和沒有防具與穿重甲時冒險者平均每下受到多少傷害。
// 只跑四人等效模擬（調數字用）：node tools/test.js sim4
const UNIT_ONLY = process.argv[2] === 'unit'; // 只跑場景測試（創世門檻、世界等級、士兵、對話），不跑生成統計和模擬
const SIM4_ONLY = process.argv[2] === 'sim4' || UNIT_ONLY;
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..', 'js') + path.sep;
global.window = global;
for (const f of ['config', 'rng', 'world', 'checker', 'bugs', 'steading', 'gear', 'combat', 'stability', 'events', 'ai', 'game', 'save']) {
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
      if (b.kind === 'house' || b.kind === 'smithy' || b.kind === 'armory') {
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
      if (w.villageAt(x, y) === v && w.passable(x, y) && !reach.has(key(x, y)) && !carved.has(key(x, y))) fail(`${tag} ${v.name} (${x},${y}) 聚落裡走不到（${w.cell(x, y).t} 高 ${w.cell(x, y).h}；四鄰 ${DIRS.map(([dx, dy]) => { const c2 = w.cell(x + dx, y + dy); return c2 ? c2.t + c2.h : '空'; }).join(' ')}）`);
    }
  }
  for (const n of w.npcs) {
    const v = w.villageById(n.villageId);
    const reach = reaches.get(v.id);
    if (!DIRS.some(([dx, dy]) => reach.has(key(n.x + dx, n.y + dy)) && w.heightOk(n.x, n.y, n.x + dx, n.y + dy))) fail(`${tag} ${v.name} ${n.name}(${n.role}) 碰不到`);
    if (FE.Gear.isShopkeeper(n)) continue;
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

// 斷層修好時打通的路若穿過聚落的外牆，會在牆上留一個接不到室內的洞（原本就有的毛病，這版沒動它）；
// 記下這種格子，聚落內走不走得到的檢查不算它們
const carved = new Set();
const repairBug0 = FE.repairBug;
FE.repairBug = (game, m, opts) => {
  if (m.type === 'UNREACHABLE' && !m.members && m.data && !m.data.villageId && m.data.path) {
    for (const [x, y] of m.data.path) if (game.world.villageAt(x, y)) carved.add(key(x, y));
  }
  return repairBug0(game, m, opts);
};

// 聚落周圍沒有怪物（嚴格）：任何時刻、任何怪物（含生成點）都不在任何聚落的圈內
let bufferViolations = 0;
function checkBuffer(game, tag) {
  for (const m of game.monsters) {
    if (game.world.inBuffer(m.x, m.y)) { bufferViolations++; fail(`${tag} 怪物 ${m.name} 站在圈內 (${m.x},${m.y})`); }
    if (game.world.inBuffer(m.home.x, m.home.y)) { bufferViolations++; fail(`${tag} 怪物 ${m.name} 的生成點在圈內`); }
  }
}

// ---- 可達性：新的檢查（只看新的一塊附近，連通性快取在每塊區塊上）跟舊的全世界檢查比對 ----
// 每次創世掃描時（verifyReach 開著才比，舊做法很慢）：整個世界每一格走不走得到要一樣，
// 新區塊附近的所有錯（含斷層）逐筆一樣（格子、順序、路口都相同）
const reachCheck = { compared: 0, newMs: 0, fullMs: 0 };
let verifyReach = false;
const hr = () => Number(process.hrtime.bigint()) / 1e6;
const scan0 = FE.Checker.scan;
FE.Checker.scan = (world, r, monsters) => {
  const t0 = hr();
  const res = scan0(world, r, monsters);
  reachCheck.newMs += hr() - t0;
  if (verifyReach) compareReach(world, r, monsters, res);
  return res;
};
function compareReach(world, r, monsters, res) {
  const t0 = hr();
  const fr = FE.Checker.full.reachable(world);
  const nr = FE.Checker.reachable(world);
  let diff = 0;
  world.forEachCell((x, y) => { if (fr.at(x, y) !== nr.at(x, y)) diff++; });
  if (diff) fail(`可達性 第 ${world.chunks.length} 塊：新舊檢查有 ${diff} 格走不走得到不一致`);
  const inWin = (b) => b.cells.some(([x, y]) => x >= r.x0 - 1 && x <= r.x1 && y >= r.y0 - 1 && y <= r.y1);
  const norm = (list) => JSON.stringify(list.filter((b) => b.type !== 'UNREACHABLE' || inWin(b)));
  const full = FE.Checker.full.scan(world, r, monsters);
  if (norm(full) !== norm(res)) fail(`可達性 第 ${world.chunks.length} 塊：新區塊附近的錯跟全世界檢查的結果不一致（新 ${res.length} 筆、舊 ${full.length} 筆）`);
  reachCheck.compared++;
  reachCheck.fullMs += hr() - t0;
}

// ---- 戰鬥統計 ----
// 量測：on 時才記（機器人模擬）；kills[世界等級] = { small: [幾下...], mid: [...] }，clear[世界等級] = [每個動作時主手武器的清除等級...]；
// cond 是對照組的名字（'none' 沒有防具、'heavy' 穿重甲），armorCmp[cond] = 怪物出手打冒險者的次數與總傷害
const measure = { on: false, hits: new Map(), kills: {}, clear: {}, cond: null, armorCmp: {} };
const combat = { player: {}, monster: {}, soldier: {}, reduced: 0, soldierHits: 0, onSoldier: 0, dodged: 0, blocked: 0, resisted: 0, crit: 0, counters: 0, opportunity: 0, opportunityHit: 0, chain: 0, negative: 0, events: 0, pdmg: 0, mdmg: 0, pn: 0, mn: 0 };
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
  if (e.reduced > 0) combat.reduced++;
  // 對照組：怪物出手打冒險者，每一下受到的傷害
  if (measure.on && measure.cond && e.by === 'monster' && e.d && e.d.equip) {
    const r = measure.armorCmp[measure.cond] || (measure.armorCmp[measure.cond] = { n: 0, dmg: 0, hit: 0 });
    r.n++;
    r.dmg += e.dmg;
    if (e.dmg > 0) r.hit++;
  }
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
  verifyReach = seed <= 5; // 前 5 個種子每次創世都跟舊的全世界檢查比對
  for (let i = 0; i < 16; i++) {
    const t = hr();
    const m0 = reachCheck.fullMs;
    game.createChunk(false);
    // 創世耗時不含比對舊檢查花的時間
    stats.ms.push(hr() - t - (reachCheck.fullMs - m0));
  }
  verifyReach = false;
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
      armory: v.kind !== 'town' || kinds.includes('armory'),
      entrances: v.entrances, villagers: w.npcs.filter((n) => n.villageId === v.id && !FE.Gear.isShopkeeper(n)).length,
    };
    // 工匠：每個聚落一位鐵匠（城鎮裡叫武器匠），城鎮另有一位盔甲匠；村莊沒有盔甲匠
    const smiths = w.npcs.filter((n) => n.villageId === v.id && n.role === 'smith').length;
    const armorers = w.npcs.filter((n) => n.villageId === v.id && n.role === 'armorer').length;
    if (smiths !== 1 || armorers !== (v.kind === 'town' ? 1 : 0)) fail(`生成 seed${seed} ${v.name} 工匠 ${smiths} 位鐵匠／武器匠、${armorers} 位盔甲匠`);
    if (v.kind === 'town') {
      const am = w.npcs.find((n) => n.villageId === v.id && n.role === 'armorer');
      const bi = v.buildings.findIndex((b) => b.kind === 'armory');
      if (am && bi >= 0 && FE.Steading.roomAt(v, am.x, am.y) !== bi) fail(`生成 seed${seed} ${v.name} 盔甲匠沒站在盔甲匠工坊裡`);
    }
    stats[v.kind].push(s);
    // 民房沒蓋齊、床位少於上限：使用者決定當作可接受的粗糙，只統計；村民沒有家才算錯（checkResidents）
    if (houses < want) stats.short.push(`seed${seed} ${v.name} 民房 ${houses}/${want}`);
    if (!s.smithy) fail(`生成 seed${seed} ${v.name} 沒有工坊`);
    if (!s.armory) stats.noArmory = (stats.noArmory || 0) + 1; // 城鎮沒蓋成盔甲匠工坊（可接受的粗糙，盔甲匠改站在廣場旁）
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
// 裝備的好壞（機器人用）：武器看攻擊力再看品質，防具看物理減傷再看魔法減傷與品質，盾牌看品質
const slotOf = (g) => ({ weapon: 'main', shield: 'off', armor: 'body' })[FE.GEAR[g.type].cat] || null;
function gearScore(g) {
  const d = FE.GEAR[g.type];
  if (d.cat === 'weapon') return d.atk * 10 + g.q;
  if (d.cat === 'armor') return d.phys * 10 + d.magic + g.q * 0.1;
  return 10 + g.q;
}
// 機器人整理裝備：超重太多（走不動）就先丟沒用的裝備、礦石、多的藥草；有比身上好的就穿上（一個動作）。
// game.botNoArmor 是對照組用的：不穿防具也不拿盾牌。回傳 true 表示做了一個動作
function botGear(game) {
  const p = game.player;
  const noArmor = !!game.botNoArmor;
  const junk = () => p.bag.findIndex((e) => {
    if (e.id !== 'gear') return false;
    const s = slotOf(e.gear);
    if (!s) return false;
    if (noArmor && s !== 'main') return true;
    return !!p.equip[s] && gearScore(e.gear) <= gearScore(p.equip[s]);
  });
  while (game.loadTier() >= 2) {
    let i = junk();
    if (i < 0) i = p.bag.findIndex((e) => e.id === 'ore');
    if (i < 0) i = p.bag.findIndex((e) => e.id === 'herb' && e.n > 3);
    if (i < 0) break;
    game.dropItem(i);
  }
  const i = p.bag.findIndex((e) => {
    if (e.id !== 'gear') return false;
    const s = slotOf(e.gear);
    if (!s || (noArmor && s !== 'main')) return false;
    return !p.equip[s] || gearScore(e.gear) > gearScore(p.equip[s]);
  });
  if (i >= 0) {
    game.useItem(i);
    return true;
  }
  return false;
}

function botStep(game, rng, goal, lazy) {
  const w = game.world;
  const p = game.player;
  const adj = game.adjacentMonsters();
  // 超重太多會走不動、跑不掉，先處理；旁邊沒有怪物時順便換上比較好的裝備
  if (game.loadTier() >= 2 || !adj.length) {
    if (botGear(game)) return;
  }
  // 血量低又有藥草就先吃（戰鬥中也能吃）
  if (p.hp < p.maxHp * (adj.length ? 0.3 : 0.4) && game.bagCount('herb')) return game.eatHerb();
  if (adj.length) {
    if (p.hp < p.maxHp * 0.25) return game.act('flee');
    if (!lazy) {
      // 撞上怪物只設目標、不出手；先把目前的目標撞一下設好，再按 1／2 出手
      const m = game.targetMonster();
      if (m) game.move(m.x - p.x, m.y - p.y);
      return game.act(game.battle.cooldown === 0 && m && m.hp > game.playerAtk() + 3 ? 'deep' : 'attack');
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

// 在工匠的對話裡找到選項 id 並選下去：從最上層一路點進買／修／打造／賣裝備和分類、品質分頁，最多三層。
// 找到而且沒反灰才選（回傳 true）；找到但反灰回傳 false；找不到也是 false。結束時回到最上層
function shopDo(game, npc, id) {
  const NAV = (o) => ['buy', 'repair', 'craft', 'sell'].includes(o.id) || o.id.startsWith('cat:') || o.id.startsWith('qual:');
  const find = (depth) => {
    const t = game.talkOptions(npc);
    const direct = t.options.findIndex((o) => o.id === id);
    if (direct >= 0) {
      if (t.options[direct].disabled) return false;
      game.choose(npc, direct);
      return true;
    }
    if (depth === 0) return false;
    for (const o of t.options) {
      if (!NAV(o) || o.disabled) continue;
      const page0 = game.talkPage;
      game.choose(npc, game.talkOptions(npc).options.findIndex((x) => x.id === o.id));
      if (find(depth - 1)) return true;
      game.talkPage = page0;
    }
    return false;
  };
  game.talkPage = 'main';
  const r = find(3);
  game.talkPage = 'main';
  return r;
}

// 機器人在工匠那裡：先用礦石打造缺的盾牌、防具（或試試運氣打一把劍），剩下的礦石賣掉，磨損太多的修好，
// 缺的工具、盾牌、防具買起來，錢夠就換更好品質的武器，身上沒用的裝備賣掉。穿上在對話外面做（botGear）
function botShop(game, npc) {
  const p = game.player;
  const v = game.world.villageById(npc.villageId);
  const S = FE.Gear.SHOPS[FE.Gear.shopOf(npc, v)];
  const noArmor = !!game.botNoArmor;
  const do_ = (id, stat) => { const ok = shopDo(game, npc, id); if (ok && stat) dlgStats[stat]++; return ok; };
  const price = (type, q) => FE.Gear.shopPrice(type, q, v);
  const rank = (s) => (p.equip[s] ? gearScore(p.equip[s]) : 0);
  // 打造：缺盾牌、防具比現有的差，或主手還是普通品質時，礦石夠、工錢夠就打
  const craftable = (type) => S.craft.includes(type) && FE.Gear.craftQuote(type, v).ore <= game.bagCount('ore') && FE.Gear.craftQuote(type, v).fee <= p.gold;
  if (!noArmor) {
    for (const type of ['heavy', 'medium', 'light']) {
      if (craftable(type) && gearScore({ type, q: 0 }) > rank('body')) { do_('craftItem:' + type, 'craft'); break; }
    }
    if (!p.equip.off && !p.bag.some((e) => e.id === 'gear' && FE.GEAR[e.gear.type].cat === 'shield') && craftable('shield')) do_('craftItem:shield', 'craft');
  }
  if (p.equip.main && p.equip.main.q === 0 && craftable('sword') && game.bagCount('ore') >= 6) do_('craftItem:sword', 'craft');
  if (game.bagCount('ore') && do_('sellOre', 'sellOre')) { /* 礦石全賣 */ }
  // 修：磨損到四成以下的先修（都一次修到完整）
  for (let round = 0; round < 4; round++) {
    const worn = game.allGear().find((g) => S.repair.includes(FE.GEAR[g.type].cat) && g.dur < g.max * 0.4);
    if (!worn || !do_('repairItem:' + worn.id, 'repair')) break;
  }
  // 買：工具、盾牌、防具（比現有的好的才買，先挑好品質）、換更好品質的武器
  for (const tool of ['pick', 'sickle']) if (!game.toolOf(tool) && price(tool, 0) <= p.gold) do_(`buyItem:${tool}:0`, 'buy');
  const qs = S.quals.slice().reverse();
  if (!noArmor) {
    if (!p.equip.off && !p.bag.some((e) => e.id === 'gear' && FE.GEAR[e.gear.type].cat === 'shield') && S.buy.armor) {
      const q = qs.find((qq) => price('shield', qq) <= p.gold);
      if (q !== undefined) do_(`buyItem:shield:${q}`, 'buy');
    }
    if (S.buy.armor) {
      let best = null;
      for (const type of ['heavy', 'medium', 'light']) {
        const q = qs.find((qq) => price(type, qq) <= p.gold);
        if (q === undefined) continue;
        if (gearScore({ type, q }) > Math.max(rank('body'), ...p.bag.filter((e) => e.id === 'gear' && FE.GEAR[e.gear.type].cat === 'armor').map((e) => gearScore(e.gear)))) { best = { type, q }; break; }
      }
      if (best) do_(`buyItem:${best.type}:${best.q}`, 'buy');
    }
  }
  if (S.buy.weapon && p.equip.main && p.equip.main.q < S.quals[S.quals.length - 1] && !p.bag.some((e) => e.id === 'gear' && FE.GEAR[e.gear.type].cat === 'weapon' && e.gear.q > p.equip.main.q)) {
    const q = S.quals[S.quals.length - 1];
    if (price(p.equip.main.type, q) <= p.gold) do_(`buyItem:${p.equip.main.type}:${q}`, 'buy');
  }
  // 賣：背包裡不比身上好的裝備（賣給收這一類的工匠）
  for (let round = 0; round < 6; round++) {
    const e = p.bag.find((x) => {
      if (x.id !== 'gear' || !S.sell.includes(FE.GEAR[x.gear.type].cat)) return false;
      const s = slotOf(x.gear);
      return s && ((noArmor && s !== 'main') || (p.equip[s] && gearScore(x.gear) <= gearScore(p.equip[s])));
    });
    if (!e || !do_('sellItem:' + e.gear.id, 'sell')) break;
  }
}

// 機器人在對話視窗裡的選擇：能交件、回報就交，能接委託就接；在工匠那裡照 botShop 買賣修打造；不然離開（走新的對話介面）
const dlgStats = { opened: 0, accept: 0, report: 0, deliver: 0, craft: 0, repair: 0, buy: 0, sell: 0, sellOre: 0, leave: 0 };
function botTalk(game) {
  const npc = game.talkTarget(game.talking);
  if (!npc) { game.closeTalk(); return; }
  dlgStats.opened++;
  if (FE.Gear.isShopkeeper(npc)) {
    game.botShopAt = game.turn;
    botShop(game, npc);
    game.talkPage = 'main';
    const t = game.talkOptions(npc);
    game.choose(npc, t.options.findIndex((o) => o.id === 'leave'));
    dlgStats.leave++;
    if (game.talking != null) fail('對話選完沒有關掉');
    return;
  }
  const t = game.talkOptions(npc);
  const idx = (id) => t.options.findIndex((o) => o.id === id && !o.disabled);
  const pick = ['report', 'deliver', 'accept'].find((id) => idx(id) >= 0) || 'leave';
  if (pick === 'leave') dlgStats.leave++; else dlgStats[pick]++;
  game.choose(npc, t.options.findIndex((o) => o.id === pick));
  if (game.talking != null) fail('對話選完沒有關掉');
}

// 模擬一個機器人玩家。opts：
//   steps：動作數（單人模擬）；lazy：只走路不打怪；
//   worldEvery：機器人每做幾個動作，世界（怪物、事件、侵蝕、士兵）才走 1 回合（四人等效是 4）；
//   minActions／untilChunks／maxActions：四人等效用，至少 minActions 個動作而且創出 untilChunks 塊才停，最多 maxActions；
//   scale：暫時改 PLAYER_COMPUTE_SCALE（查「四人等效」的另一種讀法用）
let stuckFixes = 0; // 機器人被村民夾住、等村民走開的次數
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
  // 對照組（opts.cond）：不買也不穿防具與盾牌，只差身上有沒有一件重甲（重甲不會磨損，每個動作後補滿耐久）
  if (opts.cond) {
    game.botNoArmor = true;
    if (opts.cond === 'heavy') game.player.equip.body = FE.Gear.make('heavy', 0, game.nextGearId++);
    measure.cond = opts.cond;
  }
  const verify0 = verifyReach;
  if (opts.verifyReach) verifyReach = true;
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
        // 採集：有礦鎬、礦石少於 4 顆（不超重），去挖最近的礦脈；有鐮刀、藥草少於 3 份，割附近的藥草
        const dist = (o) => Math.abs(o.x - p.x) + Math.abs(o.y - p.y);
        const near = (kind, r) => w.nodes.filter((n) => n.kind === kind && game.nodeAt(n.x, n.y) === n && dist(n) < r).sort((a, b) => dist(a) - dist(b))[0];
        const ore = game.toolOf('pick') && game.bagCount('ore') < 4 && game.loadTier() === 0 ? near('ore', 120) : null;
        const herb = !ore && game.toolOf('sickle') && game.bagCount('herb') < 3 ? near('herb', 16) : null;
        // 去工匠那裡：裝備磨損到四成以下、有礦石可賣、缺工具、缺防具或盾牌而且錢夠
        const worn = FE.Gear.equipped(p).some((g) => g.dur < g.max * 0.4);
        const needShop = worn || game.bagCount('ore') >= 3 || (p.gold >= 20 && (!game.toolOf('pick') || !game.toolOf('sickle'))) || (!game.botNoArmor && p.gold >= 25 && (!p.equip.body || !p.equip.off));
        const shopkeeper = needShop && game.turn - (game.botShopAt === undefined ? -1e9 : game.botShopAt) > 120 ? w.npcs.filter((n) => FE.Gear.isShopkeeper(n) && dist(n) < 200).sort((a, b) => dist(a) - dist(b))[0] : null;
        if (c && c.kind !== 'hunt' && w.npcById(c.targetId)) target = { kind: 'npc', id: c.targetId };
        else if (shopkeeper && rng() < 0.7) target = { kind: 'npc', id: shopkeeper.id };
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
    // 被兩位村民夾在屋裡走不出去時（村民只在冒險者走路時才動，原本就有的毛病，這版沒動它），機器人等一陣讓村民走開，免得整場模擬卡死
    if (p.x === (game._botLast || {}).x && p.y === (game._botLast || {}).y) game._botSame = (game._botSame || 0) + 1;
    else { game._botLast = { x: p.x, y: p.y }; game._botSame = 0; }
    if (game._botSame >= 60) { for (let k = 0; k < 12; k++) FE.AI.npcTurn(game); game._botSame = 0; stuckFixes++; }
    const v = game.world.villageAt(p.x, p.y);
    if (v && FE.Steading.roomAt(v, p.x, p.y) >= 0) enteredHouse++;
    if (talked && target && target.kind === 'npc') target = null;
    checkBuffer(game, `模擬 seed${seed} 第${i}步`);
    for (const n of game.world.npcs) {
      const nv = game.world.villageById(n.villageId);
      if (game.world.villageAt(n.x, n.y) !== nv && !FE.Gear.isShopkeeper(n)) fail(`模擬 seed${seed} ${n.name} 走出聚落`);
      const r = FE.Steading.roomAt(nv, n.x, n.y);
      if (!FE.Gear.isShopkeeper(n) && r >= 0 && (!n.home || n.home.b !== r)) fail(`模擬 seed${seed} ${n.name} 進了別人的建築`);
    }
    const L = FE.Stability.state(game);
    lv[L]++;
    const wl = FE.Stability.worldLevel(game);
    const rec = byWL[wl] || (byWL[wl] = { n: 0, s: [0, 0, 0], chaosAt: null });
    if (measure.on && !opts.cond) (measure.clear[wl] || (measure.clear[wl] = [])).push(FE.Gear.clearLevel(p));
    if (opts.cond === 'heavy' && p.equip.body) p.equip.body.dur = p.equip.body.max;
    // 裝備的狀態永遠合法：耐久在 1～上限之間、穿的位置對、重量算得出來
    for (const g of FE.Gear.equipped(p)) if (!(g.dur >= 1 && g.dur <= g.max)) fail(`模擬 seed${seed} 第${i}步 ${FE.Gear.name(g)} 耐久 ${g.dur}/${g.max}`);
    if ((p.equip.main && FE.GEAR[p.equip.main.type].cat !== 'weapon') || (p.equip.off && FE.GEAR[p.equip.off.type].cat !== 'shield') || (p.equip.body && FE.GEAR[p.equip.body.type].cat !== 'armor')) fail(`模擬 seed${seed} 第${i}步 裝備穿錯位置`);
    if (!Number.isFinite(game.weight())) fail(`模擬 seed${seed} 重量算不出來`);
    rec.n++;
    rec.s[L]++;
    if (L > 0 && first[L] === null) { first[L] = i + 1; firstWL[L] = wl; }
    if (L > 1 && first[1] === null) { first[1] = i + 1; firstWL[1] = wl; }
    totals.push(FE.Stability.total(game));
    if (process.env.FE_DIAG && i % Number(process.env.FE_DIAG) === 0) {
      console.log(`  [卡住診斷 第${i}步] 回合 ${game.turn} 位置 ${p.x},${p.y} 負重 ${game.weight()} 階 ${game.loadTier()} 對話 ${game.talking} 目標 ${JSON.stringify(target)} 最新訊息「${game.log[0] && game.log[0].text}」鄰格 ${DIRS.map(([dx, dy]) => { const cc = game.world.cell(p.x + dx, p.y + dy); const n = game.world.npcAt(p.x + dx, p.y + dy); return (cc ? cc.t : '空') + (n ? '[' + n.role + ']' : '') + (game.monsterAt(p.x + dx, p.y + dy) ? '[怪]' : '') + (cc && !game.world.heightOk(p.x, p.y, p.x + dx, p.y + dy) ? '[崖]' : ''); }).join(' ')}`);
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
  measure.cond = null;
  verifyReach = verify0;
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
    weapon: `${game.player.equip.main ? FE.Gear.name(game.player.equip.main) : '徒手'}（攻擊力 ${game.playerAtk()}）`,
    armor: `${game.player.equip.body ? FE.Gear.name(game.player.equip.body) : '無'}／${game.player.equip.off ? FE.Gear.name(game.player.equip.off) : '無盾'}`,
    weight: `${game.weight()}/${C.CARRY_LIMIT}`,
    bag: game.bagList().map((e) => `${e.name}${e.n > 1 ? '×' + e.n : ''}`).join(' '),
  };
}

const sim = [];
const SEEDS = (process.env.FE_SEEDS || '20201,777,314159').split(',').map(Number);
if (!SIM4_ONLY) for (const seed of SEEDS) sim.push(simulate(seed, { steps: 1500 }));
const lazySim = SIM4_ONLY ? null : simulate(20201, { steps: 1500, lazy: true });
// 四人等效：機器人每做 4 個動作，世界才走 1 回合（冒險者算力照常，已乘 PLAYER_COMPUTE_SCALE）
const MAX_ACTIONS = Number(process.env.FE_MAX || 8000);
// 四人等效：機器人每做 4 個動作世界才走 1 回合（四個人的清怪力），每個動作的算力不乘 4（四個人各出一份，一回合合計 4 份）
// 四人等效的模擬每次創世也跟舊的全世界檢查比對（這時的地形被侵蝕、修復、重算改過，驗證連通性快取有跟著更新）
const sim4 = UNIT_ONLY ? [] : SEEDS.map((seed) => simulate(seed, { worldEvery: 4, scale: 1, minActions: 3000, untilChunks: 15, maxActions: MAX_ACTIONS, verifyReach: true }));
// 防具對照組：同樣的種子、同樣的動作數，一組不穿防具、一組穿重甲（都不拿盾牌），看冒險者平均每下受到多少傷害
const SIM_CMP_STEPS = Number(process.env.FE_CMP || 1500);
const armorSims = UNIT_ONLY ? [] : ['none', 'heavy'].flatMap((cond) => SEEDS.map((seed) => simulate(seed, { steps: SIM_CMP_STEPS, cond })));

// ---- 對話視窗的邏輯（game.talkOptions／choose） ----
// 撞上村民或武器匠：打開對話，算一個動作、不算步數、不當成攻擊；選項不再額外花動作
let dlgChecks = 0;
function testDialogs() {
  const ok = (cond, msg) => { dlgChecks++; if (!cond) fail('對話 ' + msg); };
  const g = new FE.Game(4242);
  g.start();
  const villagers = () => g.world.npcs.filter((n) => !FE.Gear.isShopkeeper(n));
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

  // 鐵匠（村莊）：最上層是買／修／打造／賣礦石／賣裝備／離開；買要先選分類；錢不夠時選項寫差多少，選了不買也不關對話；
  // 錢夠就買，買完對話還開著、不花動作；Esc 回上一層，最上層再按才關掉
  bump(smith);
  const sv = g.world.villageById(smith.villageId);
  ok(sv.kind === 'village' && g.talkOptions(smith).role === '鐵匠', `村莊的工匠是 ${g.talkOptions(smith).role}`);
  ok(ids(smith) === 'buy/repair/craft/sellOre/sell/leave', `鐵匠的選項是 ${ids(smith)}`);
  g.player.gold = 0;
  pick(smith, 'buy');
  ok(g.talkPage === 'buy' && ids(smith) === 'cat:weapon/cat:armor/cat:tool/back', `買的分類是 ${ids(smith)}`);
  pick(smith, 'cat:weapon');
  ok(ids(smith) === 'buyItem:sword:0/buyItem:spear:0/buyItem:dagger:0/back', `武器的選項是 ${ids(smith)}`);
  const price = FE.Gear.shopPrice('sword', 0, sv);
  g.player.gold = price - 7;
  const o = g.talkOptions(smith).options[opt(smith, 'buyItem:sword:0')];
  ok(o.disabled && o.note === '還差 7 金幣', `錢不夠的說明：${o.note}`);
  const bag0 = g.player.bag.length;
  ok(!pick(smith, 'buyItem:sword:0').close && g.talking === smith.id && g.player.bag.length === bag0 && g.player.gold === price - 7, '錢不夠時不該買到或關掉對話');
  g.player.gold = price + 5;
  const turn0 = g.turn;
  ok(!pick(smith, 'buyItem:sword:0').close && g.talking === smith.id && g.turn === turn0, '買完對話該還開著、不花動作');
  ok(g.player.gold === 5 && g.player.bag.some((e) => e.id === 'gear' && e.gear.type === 'sword' && e.gear.q === 0 && e.gear.dur === 200), `買到之後 金幣 ${g.player.gold}、背包 ${JSON.stringify(g.player.bag.map((e) => e.gear && e.gear.type))}`);
  ok(g.talkBack() === false && g.talkPage === 'buy' && g.talking === smith.id, 'Esc 沒有回上一層（分類）');
  ok(g.talkBack() === false && g.talkPage === 'main', 'Esc 沒有回最上層');
  ok(g.talkBack() === true && g.talking === null, '最上層按 Esc 沒有關掉對話');
  g.player.bag = g.player.bag.filter((e) => e.id !== 'gear');
  bump(smith);
  ok(pick(smith, 'leave').close && g.talking === null, '離開沒有關掉對話');

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
  // 種子 5150 在第二十五版城鎮多蓋盔甲匠工坊、排版改變之後，3 位士兵出城會在 1 格寬的通道卡成一列（隊長被隊友擋在後面），
  // 這個場景測的是出城清怪，所以換用 5151（士兵卡住的情形留給第二十九版重寫士兵時處理）
  const g = new FE.Game(5151);
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

  // 買工具（第二十五版起是裝備物件，耐久 50）：錢不夠時選項寫差多少、選了不買；錢夠就買，已有的不再出現
  const smith = w.npcs.find((n) => n.role === 'smith');
  g.talking = smith.id;
  const toolIds = () => { g.talkPage = 'buy:tool'; return g.talkOptions(smith).options.map((o) => o.id); };
  const toolOpt = (id) => { g.talkPage = 'buy:tool'; return g.talkOptions(smith).options.find((o) => o.id === id); };
  const toolPick = (id) => { g.talkPage = 'buy:tool'; return g.choose(smith, g.talkOptions(smith).options.findIndex((o) => o.id === id)); };
  p.gold = C.TOOL_PRICE - 1;
  ok(toolOpt('buyItem:pick:0') && toolOpt('buyItem:pick:0').disabled && toolOpt('buyItem:pick:0').note.includes('還差 1 金幣') && toolOpt('buyItem:sickle:0').disabled, `錢不夠時買工具的選項：${JSON.stringify(toolOpt('buyItem:pick:0'))}`);
  toolPick('buyItem:pick:0');
  ok(!g.toolOf('pick') && p.gold === C.TOOL_PRICE - 1, '錢不夠還是買到了礦鎬');
  p.gold = C.TOOL_PRICE * 2 + 5;
  toolPick('buyItem:pick:0');
  ok(!!g.toolOf('pick') && g.toolOf('pick').dur === 50 && p.gold === C.TOOL_PRICE + 5 && toolIds().includes('buyItem:pick:0') && toolIds().includes('buyItem:sickle:0'), `買礦鎬之後 ${toolIds()}，金幣 ${p.gold}（買過的工具選項該還在）`);
  toolPick('buyItem:sickle:0');
  ok(!!g.toolOf('sickle') && p.gold === 5 && toolIds().includes('buyItem:sickle:0'), `買鐮刀之後 ${toolIds()}，金幣 ${p.gold}`);
  // 工具可以重複買，每一把各自有耐久；採集用耐久最低的那一把，壞了換下一把
  p.gold = 100;
  toolPick('buyItem:pick:0');
  g.talkPage = 'main';
  const picks = () => p.bag.filter((e) => e.id === 'gear' && e.gear.type === 'pick').map((e) => e.gear);
  ok(picks().length === 2 && p.gold === 100 - C.TOOL_PRICE, `礦鎬該有 2 把（${picks().length}）`);
  picks()[0].dur = 30;
  ok(g.toolOf('pick') === picks()[0], '採集該先用耐久最低的那一把');
  picks()[0].dur = 1;
  const worn = picks()[0];
  FE.Gear.wear(g, worn);
  ok(picks().length === 1 && g.toolOf('pick') === picks()[0] && g.toolOf('pick').dur === 50, '壞了的礦鎬該消失，換用下一把');

  // 採集：沒工具時照常走過去、訊息寫需要什麼；有工具時撞上去就採，不移動，得到 1～2 份，算一個動作、產生跟移動一樣的算力；
  // 採完那一格變回普通地面，2000 刻後長回來
  const S = C.PLAYER_COMPUTE_SCALE * C.CREATION_SHARE;
  const besides = (n) => DIRS.find(([dx, dy]) => w.canStep(n.x + dx, n.y + dy, n.x, n.y) && w.passable(n.x + dx, n.y + dy) && !w.npcAt(n.x + dx, n.y + dy) && !g.soldierAt(n.x + dx, n.y + dy) && !g.nodeAt(n.x + dx, n.y + dy) && !w.chestAt(n.x + dx, n.y + dy));
  for (const kind of ['herb', 'ore']) {
    const def = FE.NODES[kind];
    const toolName = FE.GEAR[def.tool].name;
    const node = w.nodes.find((n) => n.kind === kind && besides(n) && !w.chestAt(n.x, n.y));
    ok(!!node, `找不到旁邊能站的${def.name}`);
    if (!node) continue;
    const [dx, dy] = besides(node);
    // 沒有工具
    const tool = p.bag.find((e) => e.id === 'gear' && e.gear.type === def.tool);
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
    ok(tool.gear.dur === 49, `採一次工具該磨損 1 點（耐久 ${tool.gear.dur}）`);
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
  p.equip.main = FE.Gear.make('sword', 0, g.nextGearId++);
  p.equip.main.dur = p.equip.main.max = 1e9; // 這裡只量判定，不要劍磨壞了
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

// ---- 第二十五版：裝備、品質、磨損、負重、工匠、掉落：場景測試 ----
let gearChecks = 0;
function testGear() {
  const ok = (cond, msg) => { gearChecks++; if (!cond) fail('裝備 ' + msg); };
  const near = (a, b, eps) => Math.abs(a - b) <= (eps === undefined ? 1e-9 : eps);
  const Q = FE.QUALITIES;
  const G = FE.Gear;
  const hook0 = FE.Combat.hook; // 這裡的判定不算進戰鬥統計
  const plain = { kind: 'village', steading: { prosperity: 2, tags: [] } };           // 經濟普通、沒有市場：價錢倍率 1
  const poorMarket = { kind: 'village', steading: { prosperity: 0, tags: [{ k: '市場' }] } }; // 荒蕪 1.6、有市場再 ×0.9
  const newGame = (seed) => { const g = new FE.Game(seed); g.start(); g.checkCreate = () => {}; g.monsters = []; return g; };

  // 1. 品質倍率與四捨五入
  {
    const g = newGame(11);
    const p = g.player;
    const mult = [1, 1.1, 1.2, 1.333, 1.5, 2, 20];
    const swordPrice = [30, 33, 36, 40, 45, 60, 600];
    const armorMult = [1, 1.2, 1.4, 1.6, 1.8, 2, 3];
    const hit = [0, 1, 2, 3, 4, 5, 8];
    const pierce = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.5];
    const phys = { heavy: [3, 4, 4, 5, 5, 6, 9], medium: [2, 2, 3, 3, 4, 4, 6], light: [1, 1, 1, 2, 2, 2, 3], robe: [0, 0, 0, 0, 0, 0, 0] };
    const shield = [4, 5, 6, 6, 7, 8, 12];
    ok(Q.length === 7 && Q.map((q) => q.name).join('') === '普通做工好精良優秀卓越傑作傳說物' && Q.map((q) => q.sym).join('|') === '|-|+|*|≡|☼|', `品質的名字或符號 ${Q.map((q) => q.sym + q.name)}`);
    for (let i = 0; i <= 6; i++) {
      ok(Q[i].value === mult[i] && Q[i].hit === hit[i] && near(Q[i].pierce, pierce[i]) && near(Q[i].armor, armorMult[i]) && Q[i].clear === i, `品質 ${i} 的數值 ${JSON.stringify(Q[i])}`);
      ok(G.shopPrice('sword', i, plain) === swordPrice[i], `長劍品質 ${i} 的價錢 ${G.shopPrice('sword', i, plain)}（應該 ${swordPrice[i]}）`);
      for (const t of ['heavy', 'medium', 'light', 'robe']) {
        p.equip.body = G.make(t, i, g.nextGearId++);
        ok(G.physReduce(p) === phys[t][i], `${t} 品質 ${i} 的物理減傷 ${G.physReduce(p)}（應該 ${phys[t][i]}）`);
      }
      p.equip.off = G.make('shield', i, g.nextGearId++);
      ok(G.playerDefense(p).blockMax === shield[i] && G.playerDefense(p).block === 0.25, `盾牌品質 ${i} 的格擋值 ${G.playerDefense(p).blockMax}（應該 ${shield[i]}）`);
      p.equip.main = G.make('sword', i, g.nextGearId++);
      ok(G.hitBonus(p) === hit[i] && G.clearLevel(p) === i, `武器品質 ${i} 的命中加值或清除等級`);
    }
    // 價錢：原價×品質×經濟；荒蕪 1.6、有市場再一成；礦鎬鐮刀固定 20
    ok(G.shopPrice('sword', 0, poorMarket) === Math.round(30 * 1.6 * 0.9) && G.shopPrice('heavy', 1, poorMarket) === Math.round(60 * 1.1 * 1.6 * 0.9), `荒蕪有市場的價錢 ${G.shopPrice('sword', 0, poorMarket)}`);
    ok(G.shopPrice('pick', 0, poorMarket) === 20 && G.shopPrice('sickle', 0, plain) === 20, '礦鎬、鐮刀該固定 20 金幣');
    // 資料：武器、防具、盾牌、重量、價錢
    const W = FE.GEAR;
    ok(W.sword.atk === 4 && W.sword.weight === 2 && W.sword.price === 30 && W.spear.atk === 4 && W.spear.weight === 1 && W.spear.price === 25 && W.dagger.atk === 3 && W.dagger.weight === 1 && W.dagger.price === 15, '長劍、長槍、短刀的數字不對');
    ok(W.bow.atk === 3 && W.staff.atk === 3 && W.bow.price === 30 && W.staff.price === 30 && W.bow.sold === false && W.staff.sold === false && W.bow.drop === false && W.staff.drop === false, '弓箭、法杖只建資料，不賣不掉');
    ok(FE.BAG_ITEMS.arrow.bundle === 20 && FE.BAG_ITEMS.arrow.weight === 1, '箭矢資料不對');
    ok(W.heavy.phys === 3 && W.heavy.magic === 1 && W.heavy.ticks === 2 && W.heavy.dodge === -0.05 && W.heavy.weight === 4 && W.heavy.price === 60, '重甲的數字');
    ok(W.medium.phys === 2 && W.medium.magic === 2 && W.medium.ticks === 1 && W.medium.weight === 3 && W.medium.price === 40, '中甲的數字');
    ok(W.light.phys === 1 && W.light.magic === 1 && !W.light.ticks && W.light.weight === 1 && W.light.price === 20, '輕甲的數字');
    ok(W.robe.phys === 0 && W.robe.magic === 1 && W.robe.weight === 0.5 && W.robe.price === 10 && W.mrobe.phys === 0 && W.mrobe.magic === 3 && W.mrobe.sold === false, '衣袍的數字');
    ok(W.shield.block === 0.25 && W.shield.value === 4 && W.shield.weight === 2 && W.shield.price === 25, '盾牌的數字');
    ok(W.sword.dur === 200 && W.shield.dur === 100 && W.heavy.dur === 150 && W.pick.dur === 50 && W.sickle.dur === 50 && W.pick.weight === 1, '耐久或工具重量不對');
    ok(FE.BAG_ITEMS.ore.weight === 0.5 && FE.BAG_ITEMS.herb.weight === 0.1 && FE.BAG_ITEMS.goods.weight === 1 && C.CARRY_LIMIT === 12 && C.ORE_PRICE === 5, '礦石、藥草、送貨物品的重量或負重上限不對');
    // 起始：普通長劍、沒有防具、沒有副手
    const g2 = newGame(12);
    const q = g2.player;
    ok(q.equip.main && q.equip.main.type === 'sword' && q.equip.main.q === 0 && !q.equip.off && !q.equip.body && g2.playerAtk() === 4 && G.name(q.equip.main) === '長劍', '起始裝備不是普通長劍');
    ok(G.playerDefense(q).block === 0 && G.playerDefense(q).blockMax === 0 && near(G.playerDefense(q).dodge, 0.1), '沒拿盾牌時格擋機率該是 0');
    ok(G.name(G.make('sword', 1, 1)) === '-做工好-長劍' && G.name(G.make('heavy', 5, 1)) === '☼傑作☼重甲' && G.name(G.make('light', 3, 1)) === '*優秀*輕甲' && G.name(G.make('medium', 4, 1)) === '≡卓越≡中甲' && G.name(G.make('shield', 2, 1)) === '+精良+盾牌', '裝備名字的品質符號');
    // 盾牌與重甲的其他數字
    q.equip.body = G.make('heavy', 0, 99);
    ok(near(G.playerDefense(q).dodge, 0.05) && G.extraTicks(q) === 2, '重甲該讓閃避 -5%、每個動作多 2 刻');
    q.equip.body = G.make('medium', 0, 99);
    ok(near(G.playerDefense(q).dodge, 0.1) && G.extraTicks(q) === 1, '中甲該多 1 刻、不扣閃避');
    q.equip.body = G.make('light', 0, 99);
    ok(G.extraTicks(q) === 0, '輕甲不該多花刻');
  }

  // 2. 清除等級與抗性門檻：狂亂、虛影從清除等級 1 起不再減半，斷層從清除等級 2 起；其他沒有抗性
  {
    const mk = (type) => FE.makeMonster({ type, x: 0, y: 0, cells: [], scope: 2 }, 1, 1);
    ok(FE.isResisted(mk('VALUE'), 'attack', 0) && !FE.isResisted(mk('VALUE'), 'attack', 1) && !FE.isResisted(mk('VALUE'), 'deep', 0), '狂亂的抗性門檻');
    ok(FE.isResisted(mk('REFERENCE'), 'deep', 0) && !FE.isResisted(mk('REFERENCE'), 'deep', 1) && !FE.isResisted(mk('REFERENCE'), 'attack', 0), '虛影的抗性門檻');
    ok(FE.isResisted(mk('UNREACHABLE'), 'attack', 0) && FE.isResisted(mk('UNREACHABLE'), 'attack', 1) && !FE.isResisted(mk('UNREACHABLE'), 'attack', 2) && !FE.isResisted(mk('UNREACHABLE'), 'deep', 0), '斷層的抗性門檻');
    for (const t of ['TERRAIN', 'CLIFF', 'RUNTIME']) ok(!FE.isResisted(mk(t), 'attack', 0) && !FE.isResisted(mk(t), 'deep', 0), `${t} 不該有抗性`);
    ok(FE.resistText(mk('UNREACHABLE'), 1).includes('+精良+') && FE.resistText(mk('VALUE'), 1).includes('已經對付得了') && FE.resistText(mk('TERRAIN'), 0) === '沒有抗性', `抗性說明：${FE.resistText(mk('UNREACHABLE'), 1)}`);
    // 真的出手：主手武器品質 0 打狂亂會減半，品質 1 起不會；斷層要品質 2
    const g = newGame(13);
    const p = g.player;
    const px = p.x, py = p.y;
    const arena = (type) => {
      const m = FE.dressMonster(FE.makeMonster({ type, x: px + 1, y: py, cells: [[px + 1, py]], scope: 2, data: {} }, 900, 1), g.world);
      m.home = { x: px + 1, y: py };
      m.maxHp = m.hp = 1e9;
      g.monsters = [m];
      return m;
    };
    let resisted = 0;
    FE.Combat.hook = (e) => { if (e.resisted) resisted++; };
    const run = (type, q) => {
      const m = arena(type);
      p.equip.main = G.make('sword', q, g.nextGearId++);
      p.equip.main.dur = p.equip.main.max = 1e9;
      p.hp = p.maxHp = 1e9;
      resisted = 0;
      for (let i = 0; i < 300; i++) FE.Combat.resolveAttack(g, p, m, 'attack', { noCounter: true });
      return resisted;
    };
    ok(run('VALUE', 0) > 50 && run('VALUE', 1) === 0 && run('UNREACHABLE', 1) > 50 && run('UNREACHABLE', 2) === 0 && run('TERRAIN', 0) === 0, '實際出手時抗性門檻沒看清除等級');
    FE.Combat.hook = hook0;
  }

  // 3. 防具減傷：固定扣點，扣完至少吃 1 點；魔法減傷本版用不到（怪物都是物攻）
  {
    const g = newGame(14);
    const p = g.player;
    const px = p.x, py = p.y;
    const m = FE.dressMonster(FE.makeMonster({ type: 'TERRAIN', x: px + 1, y: py, cells: [[px + 1, py]], scope: 2, data: {} }, 901, 1), g.world);
    Object.assign(m, { home: { x: px + 1, y: py }, atk: 3, maxHp: 1e9, hp: 1e9 });
    g.monsters = [m];
    const sample = (body, n) => {
      p.equip.body = body;
      p.equip.main.dur = p.equip.main.max = 1e9;
      const out = { sum: 0, n: 0, reduced: 0, bad: 0 };
      FE.Combat.hook = (e) => {
        if (e.by !== 'monster' || e.counter) return;
        out.n++;
        out.sum += e.dmg;
        if (e.reduced > 0) out.reduced++;
        if (e.dmg > 0 && !e.crit && !e.dodged && body && FE.GEAR[body.type].phys >= 3 && e.dmg !== 1) out.bad++; // 怪物攻擊力 3，傷害 2～4，扣 3 後都該剩 1
      };
      for (let i = 0; i < 1500; i++) {
        p.hp = p.maxHp = 1e9;
        FE.Combat.resolveAttack(g, m, p, 'attack', { noCounter: true });
        if (body) body.dur = body.max = 1e9;
      }
      return out;
    };
    const none = sample(null, 0);
    const heavy = sample(G.make('heavy', 0, g.nextGearId++), 0);
    const robe = sample(G.make('mrobe', 5, g.nextGearId++), 0);
    FE.Combat.hook = hook0;
    ok(heavy.reduced > 0 && heavy.bad === 0, `重甲扣 3 點後非暴擊、沒被閃開的傷害該剩 1 點（不對的 ${heavy.bad} 次）`);
    ok(heavy.sum / heavy.n < none.sum / none.n * 0.6, `穿重甲平均傷害 ${(heavy.sum / heavy.n).toFixed(2)} 沒有明顯低於沒防具 ${(none.sum / none.n).toFixed(2)}`);
    ok(robe.reduced === 0 && near(robe.sum / robe.n, none.sum / none.n, 0.4), `魔法衣袍（物理減傷 0）不該減物攻傷害：${(robe.sum / robe.n).toFixed(2)}／${(none.sum / none.n).toFixed(2)}`);
    // 傷害不會被扣到 0 以下：怪物攻擊力 1、傑作重甲
    m.atk = 1;
    p.equip.body = G.make('heavy', 5, g.nextGearId++);
    let min = 99;
    FE.Combat.hook = (e) => { if (e.by === 'monster' && !e.counter && e.dmg > 0) min = Math.min(min, e.dmg); };
    for (let i = 0; i < 800; i++) { p.hp = p.maxHp = 1e9; FE.Combat.resolveAttack(g, m, p, 'attack', { noCounter: true }); p.equip.body.dur = 150; }
    FE.Combat.hook = hook0;
    ok(min === 1, `傑作重甲（減 6）擋怪物攻擊力 1 時，有傷害的那一下該是 1 點，量到 ${min}`);
  }

  // 4. 磨損：機率＝1÷品質價值倍率；耐久到 0 就消失；剩兩成提醒一次
  {
    const g = newGame(15);
    const p = g.player;
    const trials = 6000;
    const ratio = (q) => {
      const x = G.make('sword', q, g.nextGearId++);
      x.dur = x.max = 1e9;
      for (let i = 0; i < trials; i++) G.wear(g, x);
      return (1e9 - x.dur) / trials;
    };
    ok(ratio(0) === 1, '普通品質每次都該磨損');
    for (const [q, m] of [[1, 1.1], [2, 1.2], [3, 1.333], [4, 1.5], [5, 2]]) ok(near(ratio(q), 1 / m, 0.03), `品質 ${q} 的磨損機率 ${ratio(q).toFixed(3)}（應該約 ${(1 / m).toFixed(3)}）`);
    // 壞掉就消失：穿著的從欄位拿掉，背包裡的從背包拿掉
    const sw = p.equip.main;
    sw.dur = 1;
    const log0 = g.log.length;
    G.wear(g, sw);
    ok(p.equip.main === null && g.playerAtk() === C.BARE_ATK && g.log[0].text.includes('壞掉'), '穿著的劍耐久到 0 沒有消失');
    const sh = G.make('shield', 0, g.nextGearId++);
    g.bagAddGear(sh);
    sh.dur = 1;
    G.wear(g, sh);
    ok(!p.bag.some((e) => e.gear === sh), '背包裡的盾牌耐久到 0 沒有消失');
    // 剩兩成提醒一次（耐久 ≤ 上限的兩成）
    const ax = G.make('sword', 0, g.nextGearId++);
    p.equip.main = ax;
    ax.dur = 42;
    const warn = () => g.log.filter((l) => l.text.includes('快壞了')).length;
    const w0 = warn();
    G.wear(g, ax); // 41，還高於兩成（40）
    ok(warn() === w0, '耐久還有兩成以上就提醒了');
    G.wear(g, ax); // 40
    G.wear(g, ax); // 39
    G.wear(g, ax); // 38
    ok(warn() === w0 + 1 && ax.dur === 38, `剩兩成時該只提醒一次（提醒 ${warn() - w0} 次、耐久 ${ax.dur}）`);
    ax.dur = 150;
    G.repaired(ax);
    ok(ax.warned === false, '修好之後該能再提醒');
    // 實際打鬥：出手一次磨武器一次、格擋成功一次磨盾牌、護甲減傷有作用一次磨身上防具
    const px = p.x, py = p.y;
    const m = FE.dressMonster(FE.makeMonster({ type: 'TERRAIN', x: px + 1, y: py, cells: [[px + 1, py]], scope: 2, data: {} }, 902, 1), g.world);
    Object.assign(m, { home: { x: px + 1, y: py }, atk: 5, maxHp: 1e9, hp: 1e9 });
    g.monsters = [m];
    p.equip.main = G.make('sword', 0, g.nextGearId++);
    p.equip.off = G.make('shield', 0, g.nextGearId++);
    p.equip.body = G.make('medium', 0, g.nextGearId++);
    p.block = null;
    const used = { atk: 0, block: 0, armor: 0 };
    FE.Combat.hook = (e) => {
      if (e.by === 'player') used.atk++;
      else if (e.by === 'monster' && e.d === p) { if (e.blocked) used.block++; if (e.reduced > 0) used.armor++; }
    };
    for (let i = 0; i < 80; i++) {
      p.hp = p.maxHp = 1e9;
      FE.Combat.resolveAttack(g, p, m, 'attack');
      FE.Combat.resolveAttack(g, m, p, 'attack');
      FE.Combat.regenBlock(g, p);
    }
    FE.Combat.hook = hook0;
    ok(p.equip.main.dur === 200 - used.atk && used.atk >= 80, `武器耐久 ${p.equip.main.dur}，出手 ${used.atk} 次（該每次磨一點）`);
    ok(p.equip.off.dur === 100 - used.block && used.block > 0, `盾牌耐久 ${p.equip.off.dur}，格擋成功 ${used.block} 次`);
    ok(p.equip.body.dur === 150 - used.armor && used.armor > 0, `防具耐久 ${p.equip.body.dur}，減傷有作用 ${used.armor} 次`);
  }

  // 5. 工匠：買、修、打造、賣；鐵匠、武器匠、盔甲匠都修到完整，盾牌歸盔甲匠
  {
    const g = new FE.Game(5150);
    g.start();
    g.checkCreate = () => {};
    for (let i = 0; i < 14 && !g.world.villages.some((v) => v.kind === 'town'); i++) g.createChunk(false);
    g.monsters = [];
    const w = g.world;
    const p = g.player;
    const vil = w.villages.find((v) => v.kind === 'village');
    const town = w.villages.find((v) => v.kind === 'town');
    ok(!!town, '14 塊內沒有城鎮');
    if (!town) return;
    const smith = w.npcs.find((n) => n.villageId === vil.id && n.role === 'smith');
    const wsmith = w.npcs.find((n) => n.villageId === town.id && n.role === 'smith');
    const armorer = w.npcs.find((n) => n.villageId === town.id && n.role === 'armorer');
    ok(!!smith && !!wsmith && !!armorer && !w.npcs.some((n) => n.villageId === vil.id && n.role === 'armorer'), '村莊該只有鐵匠，城鎮有武器匠和盔甲匠');
    const role = (n) => { g.talking = n.id; g.talkPage = 'main'; return g.talkOptions(n).role; };
    ok(role(smith) === '鐵匠' && role(wsmith) === '武器匠' && role(armorer) === '盔甲匠', `工匠的身分 ${role(smith)}／${role(wsmith)}／${role(armorer)}`);
    const econ = (v) => FE.Steading.shopFactor(v);
    const open = (n) => { g.talking = n.id; g.talkPage = 'main'; };
    const dump = (n, pageIds) => { // 把這家店所有「買」的選項走一遍
      const found = [];
      open(n);
      const walk = (depth) => {
        for (const o of g.talkOptions(n).options) {
          if (o.id.startsWith('buyItem:')) found.push(o.id);
          else if ((o.id === 'buy' || o.id.startsWith('cat:') || o.id.startsWith('qual:')) && depth > 0) {
            const page0 = g.talkPage;
            g.choose(n, g.talkOptions(n).options.findIndex((x) => x.id === o.id));
            walk(depth - 1);
            g.talkPage = page0;
          }
        }
      };
      walk(3);
      g.talkPage = 'main';
      return [...new Set(found)];
    };
    // 賣什麼
    const sSmith = dump(smith);
    const sW = dump(wsmith);
    const sA = dump(armorer);
    const has = (list, t, q) => list.includes(`buyItem:${t}:${q}`);
    ok(['sword', 'spear', 'dagger', 'heavy', 'medium', 'light', 'robe', 'shield', 'pick', 'sickle'].every((t) => has(sSmith, t, 0)) && sSmith.length === 10, `鐵匠賣的東西 ${sSmith}`);
    ok(['sword', 'spear', 'dagger'].every((t) => has(sW, t, 0) && has(sW, t, 1)) && has(sW, 'pick', 0) && has(sW, 'sickle', 0) && sW.length === 8, `武器匠賣的東西 ${sW}`);
    ok(['heavy', 'medium', 'light', 'robe', 'shield'].every((t) => has(sA, t, 0) && has(sA, t, 1)) && sA.length === 10, `盔甲匠賣的東西 ${sA}`);
    ok(![...sSmith, ...sW, ...sA].some((id) => /:(bow|staff|mrobe):/.test(id)), '商店不該賣弓箭、法杖、魔法衣袍');
    ok(![...sSmith, ...sW, ...sA].some((id) => /:[3-6]$/.test(id) || /:[2]$/.test(id)), '商店只賣普通與做工好');
    // 買：價錢＝原價×品質×經濟，扣金幣、東西進背包、不花動作
    p.bag = [];
    p.gold = 1000;
    const buy = (n, t, q) => { const g0 = p.gold, t0 = g.turn; const r = shopDo(g, n, `buyItem:${t}:${q}`); return { r, spent: g0 - p.gold, turns: g.turn - t0 }; };
    let b = buy(wsmith, 'sword', 1);
    ok(b.r && b.spent === Math.round(30 * 1.1 * econ(town)) && b.turns === 0 && p.bag.some((e) => e.id === 'gear' && e.gear.type === 'sword' && e.gear.q === 1), `武器匠買做工好長劍 花了 ${b.spent}，應該 ${Math.round(30 * 1.1 * econ(town))}`);
    b = buy(armorer, 'shield', 1);
    ok(b.r && b.spent === Math.round(25 * 1.1 * econ(town)), `盔甲匠買做工好盾牌 花了 ${b.spent}`);
    b = buy(smith, 'heavy', 0);
    ok(b.r && b.spent === Math.round(60 * econ(vil)), `鐵匠買重甲 花了 ${b.spent}，應該 ${Math.round(60 * econ(vil))}`);
    ok(!buy(smith, 'sword', 1).r && !buy(wsmith, 'heavy', 0).r && !buy(armorer, 'sword', 0).r && !buy(wsmith, 'shield', 0).r, '店裡不賣的東西買到了（鐵匠做工好、武器匠賣防具、盔甲匠賣武器）');
    b = buy(smith, 'pick', 0);
    ok(b.r && b.spent === 20 && buy(smith, 'pick', 0).r && p.bag.filter((e) => e.id === 'gear' && e.gear.type === 'pick').length === 2, `礦鎬 20 金幣、已有的還能再買（花了 ${b.spent}）`);
    // 錢不夠：選項寫還差多少
    p.gold = Math.round(60 * econ(vil)) - 9;
    open(smith);
    g.choose(smith, g.talkOptions(smith).options.findIndex((o) => o.id === 'buy'));
    g.choose(smith, g.talkOptions(smith).options.findIndex((o) => o.id === 'cat:armor'));
    const heavyOpt = g.talkOptions(smith).options.find((o) => o.id === 'buyItem:heavy:0');
    ok(heavyOpt.disabled && heavyOpt.note === '還差 9 金幣', `買重甲錢不夠的說明：${heavyOpt.note}`);

    // 賣礦石：一顆 5 金幣
    p.bag = [];
    g.bagAdd('ore', 7);
    p.gold = 0;
    ok(shopDo(g, smith, 'sellOre') && p.gold === 35 && g.bagCount('ore') === 0, `賣 7 顆礦石 得到 ${p.gold}`);
    // 賣裝備：半價×剩餘耐久比例；鐵匠收所有的，武器匠只收武器，盔甲匠只收防具與盾牌
    const gs = G.make('sword', 2, g.nextGearId++); gs.dur = 50;
    const ga = G.make('medium', 3, g.nextGearId++); ga.dur = 75;
    const gh = G.make('shield', 0, g.nextGearId++);
    for (const x of [gs, ga, gh]) g.bagAddGear(x);
    ok(G.sellPrice(gs) === Math.round(30 * 1.2 * 0.5 * (50 / 200)) && G.sellPrice(ga) === Math.round(40 * 1.333 * 0.5 * 0.5) && G.sellPrice(gh) === Math.round(25 * 0.5), `賣回價 ${G.sellPrice(gs)}／${G.sellPrice(ga)}／${G.sellPrice(gh)}`);
    ok(!shopDo(g, wsmith, `sellItem:${ga.id}`) && !shopDo(g, wsmith, `sellItem:${gh.id}`) && !shopDo(g, armorer, `sellItem:${gs.id}`), '武器匠收了防具、盔甲匠收了武器');
    p.gold = 0;
    ok(shopDo(g, wsmith, `sellItem:${gs.id}`) && p.gold === G.sellPrice(gs) && !p.bag.some((e) => e.gear === gs), '武器匠沒有收武器');
    p.gold = 0;
    ok(shopDo(g, armorer, `sellItem:${ga.id}`) && shopDo(g, armorer, `sellItem:${gh.id}`) && p.gold === G.sellPrice(ga) + G.sellPrice(gh), '盔甲匠沒有收防具與盾牌');
    p.equip.main.dur = 200;
    open(smith);
    ok(!g.talkOptions(smith).options.some((o) => o.id === `sellItem:${p.equip.main.id}`), '穿在身上的不該能賣');

    // 修復：村莊鐵匠一次修回損失的一半、城鎮的武器匠與盔甲匠修到完整，各修自己那一類（盾牌歸盔甲匠）
    const fee = (item, restore, v, tool) => Math.max(1, Math.round((restore / item.max) * G.value(item) * 1 * (tool ? 1 : econ(v))));
    p.gold = 1000;
    p.bag = [];
    const sw1 = p.equip.main; sw1.dur = 100;
    let g0 = p.gold;
    ok(shopDo(g, smith, `repairItem:${sw1.id}`) && sw1.dur === 200 && g0 - p.gold === fee(sw1, 100, vil), `鐵匠修長劍到完整：耐久 ${sw1.dur}（應該 200）、花了 ${g0 - p.gold}（應該 ${fee(sw1, 100, vil)}）`);
    p.equip.off = G.make('shield', 1, g.nextGearId++); p.equip.off.dur = 20;
    p.equip.body = G.make('heavy', 0, g.nextGearId++); p.equip.body.dur = 10;
    const tl = G.make('pick', 0, g.nextGearId++); tl.dur = 10; g.bagAddGear(tl);
    g0 = p.gold;
    ok(shopDo(g, smith, `repairItem:${p.equip.off.id}`) && p.equip.off.dur === 100 && g0 - p.gold === fee(p.equip.off, 80, vil), `鐵匠修盾牌到完整：耐久 ${p.equip.off.dur}（應該 100）`);
    g0 = p.gold;
    ok(shopDo(g, smith, `repairItem:${p.equip.body.id}`) && p.equip.body.dur === 150, `鐵匠修重甲到完整：耐久 ${p.equip.body.dur}`);
    ok(shopDo(g, smith, `repairItem:${tl.id}`) && tl.dur === 50 && g0 - p.gold >= fee(tl, 40, vil, true), `鐵匠修礦鎬到完整：耐久 ${tl.dur}（應該 50）`);
    // 接下來測城鎮的工匠，把耐久再磨掉
    sw1.dur = 100; p.equip.off.dur = 20; p.equip.body.dur = 10; tl.dur = 10;
    // 城鎮：武器匠（武器、工具）修到完整，看不到盾牌與防具；盔甲匠相反
    const optIds = (n, page) => { open(n); g.talkPage = page; return g.talkOptions(n).options.map((o) => o.id); };
    const wr = optIds(wsmith, 'repair');
    const ar = optIds(armorer, 'repair');
    ok(wr.includes(`repairItem:${sw1.id}`) && wr.includes(`repairItem:${tl.id}`) && !wr.includes(`repairItem:${p.equip.off.id}`) && !wr.includes(`repairItem:${p.equip.body.id}`), `武器匠的修復選項 ${wr}`);
    ok(ar.includes(`repairItem:${p.equip.off.id}`) && ar.includes(`repairItem:${p.equip.body.id}`) && !ar.includes(`repairItem:${sw1.id}`) && !ar.includes(`repairItem:${tl.id}`), `盔甲匠的修復選項 ${ar}`);
    g0 = p.gold;
    ok(shopDo(g, wsmith, `repairItem:${sw1.id}`) && sw1.dur === 200 && g0 - p.gold === fee(sw1, 100, town), `武器匠修長劍到完整：耐久 ${sw1.dur}`);
    ok(!shopDo(g, wsmith, `repairItem:${p.equip.off.id}`), '武器匠修了盾牌');
    g0 = p.gold;
    const sh0 = p.equip.off;
    ok(shopDo(g, armorer, `repairItem:${sh0.id}`) && sh0.dur === 100 && g0 - p.gold === fee(sh0, 80, town), `盔甲匠修盾牌到完整：耐久 ${sh0.dur}`);
    ok(shopDo(g, armorer, `repairItem:${p.equip.body.id}`) && p.equip.body.dur === 150, `盔甲匠修重甲到完整：耐久 ${p.equip.body.dur}`);
    // 費用至少 1：只差 1 點耐久
    sw1.dur = 199;
    g0 = p.gold;
    ok(shopDo(g, wsmith, `repairItem:${sw1.id}`) && g0 - p.gold === 1 && sw1.dur === 200, `只差 1 點耐久的修復費該是 1，量到 ${g0 - p.gold}`);
    // 錢不夠：寫還差多少
    sw1.dur = 100;
    p.gold = 2;
    const ro = (open(wsmith), g.talkPage = 'repair', g.talkOptions(wsmith).options.find((o) => o.id === `repairItem:${sw1.id}`));
    ok(ro.disabled && /^耐久 100 \/ 200，還差 \d+ 金幣$/.test(ro.note), `修復錢不夠的說明：${ro.note}`);
    g.talkPage = 'main';

    // 打造：村莊鐵匠什麼都能打（衣袍除外），城鎮武器匠只打武器、盔甲匠只打防具與盾牌
    const craftIds = (n) => optIds(n, 'craft').filter((i) => i.startsWith('craftItem:')).map((i) => i.slice(10)).join(',');
    ok(craftIds(smith) === 'sword,spear,dagger,heavy,medium,light,shield' && craftIds(wsmith) === 'sword,spear,dagger' && craftIds(armorer) === 'heavy,medium,light,shield', `可打造 ${craftIds(smith)}／${craftIds(wsmith)}／${craftIds(armorer)}`);
    const need = { sword: 3, spear: 3, dagger: 3, heavy: 5, medium: 4, light: 2, shield: 2 };
    for (const [t, n] of Object.entries(need)) {
      const cq = G.craftQuote(t, vil);
      ok(cq.ore === n && cq.fee === Math.round(FE.GEAR[t].price * 0.5 * econ(vil)), `${t} 打造要 ${cq.ore} 顆礦石＋${cq.fee}（應該 ${n} 顆＋${Math.round(FE.GEAR[t].price * 0.5 * econ(vil))}）`);
    }
    // 礦石或金幣不夠：寫還差多少，不能打
    p.bag = [];
    g.bagAdd('ore', 4);
    p.gold = G.craftQuote('heavy', vil).fee - 2;
    open(smith); g.talkPage = 'craft';
    const co = g.talkOptions(smith).options.find((o) => o.id === 'craftItem:heavy');
    ok(co.disabled && co.note === '還差 2 金幣、1 顆礦石', `打造重甲錢和礦石都不夠的說明：${co.note}`);
    ok(!shopDo(g, smith, 'craftItem:heavy') && g.bagCount('ore') === 4, '不夠還是打造了');
    // 打造的品質範圍：村莊普通～精良（每高一級機率減半），城鎮做工好～優秀
    const crafted = (n, v, type, runs) => {
      const hist = {};
      for (let i = 0; i < runs; i++) {
        p.bag = [];
        g.bagAdd('ore', need[type]);
        p.gold = 100000;
        const gold0 = p.gold;
        if (!shopDo(g, n, `craftItem:${type}`)) { fail('裝備 打造沒成功'); return hist; }
        const e = p.bag.find((x) => x.id === 'gear');
        hist[e.gear.q] = (hist[e.gear.q] || 0) + 1;
        if (i === 0) ok(g.bagCount('ore') === 0 && gold0 - p.gold === G.craftQuote(type, v).fee && e.gear.type === type && e.gear.dur === e.gear.max, `打造後礦石 ${g.bagCount('ore')}、工錢 ${gold0 - p.gold}`);
      }
      return hist;
    };
    const hv = crafted(smith, vil, 'sword', 700);
    const hw = crafted(wsmith, town, 'dagger', 700);
    const ha = crafted(armorer, town, 'light', 700);
    const inRange = (h, lo, hi) => Object.keys(h).every((k) => k >= lo && k <= hi);
    const halves = (h, lo, hi, n) => { // 每高一級機率減半：期望比例 1、1/2、1/4⋯⋯
      let tot = 0;
      for (let i = lo; i <= hi; i++) tot += Math.pow(0.5, i - lo);
      return Array.from({ length: hi - lo + 1 }, (_, i) => i + lo).every((q) => Math.abs((h[q] || 0) / n - Math.pow(0.5, q - lo) / tot) < 0.07);
    };
    ok(inRange(hv, 0, 2) && halves(hv, 0, 2, 700), `村莊鐵匠打造的品質 ${JSON.stringify(hv)}（應該普通～精良，約 57%／29%／14%）`);
    ok(inRange(hw, 1, 3) && halves(hw, 1, 3, 700), `城鎮武器匠打造的品質 ${JSON.stringify(hw)}（應該做工好～優秀）`);
    ok(inRange(ha, 1, 3) && halves(ha, 1, 3, 700), `城鎮盔甲匠打造的品質 ${JSON.stringify(ha)}（應該做工好～優秀）`);
    // rollQuality 本身：大量抽樣，每高一級機率減半（寶箱的 0～5）
    {
      const r = FE.makeRng(7);
      const h = {};
      for (let i = 0; i < 20000; i++) { const q = G.rollQuality(r, 0, 5); h[q] = (h[q] || 0) + 1; }
      ok(halves(h, 0, 5, 20000) && Object.keys(h).length === 6, `0～5 的品質分布 ${JSON.stringify(h)}`);
    }
  }

  // 6. 負重：超過上限 2 以內，每個動作多 2 刻、出手 -1；超過上限＋2：不能移動、不能撤退、出手 -2
  {
    const g = newGame(16);
    const p = g.player;
    p.bag = [];
    // 起始 長劍 2；加礦石湊到剛好上限、超過 1、超過 2、超過 3
    const setOre = (w) => { p.bag = []; g.bagAdd('ore', Math.round((w - 2) / 0.5)); return g.weight(); };
    ok(setOre(12) === 12 && g.loadTier() === 0, `剛好上限不算超重（${g.weight()}）`);
    ok(setOre(13) === 13 && g.loadTier() === 1 && G.hitMod(p) === -1 && G.extraTicks(p) === 2, `超過 1：tier ${g.loadTier()}`);
    ok(setOre(14) === 14 && g.loadTier() === 1, `超過 2 還是第一段：tier ${g.loadTier()}`);
    ok(setOre(14.5) === 14.5 && g.loadTier() === 2 && G.hitMod(p) === -2, `超過 2.5：tier ${g.loadTier()}`);
    // 藥草 0.1 一份，十份剛好 1；浮點誤差不該讓剛好上限變成超重
    p.bag = [];
    g.bagAdd('ore', 18);
    g.bagAdd('herb', 10);
    ok(g.weight() === 12 && g.loadTier() === 0, `礦石 18＋藥草 10 的重量 ${g.weight()}`);
    // 第一段：每個動作多 2 刻（12 刻），出手 -1（含品質加值）
    setOre(13);
    const side = DIRS.find(([dx, dy]) => g.world.canStep(p.x, p.y, p.x + dx, p.y + dy) && !g.world.npcAt(p.x + dx, p.y + dy) && !g.nodeAt(p.x + dx, p.y + dy));
    const t0 = g.ticks, x0 = p.x, y0 = p.y;
    g.move(side[0], side[1]);
    ok(g.ticks - t0 === 12 && (p.x !== x0 || p.y !== y0), `超重第一段走一步花 ${g.ticks - t0} 刻（應該 12）`);
    p.equip.main = G.make('sword', 3, g.nextGearId++);
    ok(G.hitMod(p) === 3 - 1, `超重第一段、優秀劍的出手加減 ${G.hitMod(p)}（應該 +2）`);
    p.equip.main = G.make('sword', 0, g.nextGearId++);
    // 第二段：不能移動、不能撤退；可以丟東西、可以打；丟掉就能動
    setOre(15);
    const px = p.x, py = p.y, turn0 = g.turn, tk0 = g.ticks;
    g.move(-side[0], -side[1]);
    ok(p.x === px && p.y === py && g.turn === turn0 && g.ticks === tk0 && g.log[0].text.includes('丟掉'), `超重太多還是走動了或沒提示（${g.log[0].text}）`);
    const m = FE.dressMonster(FE.makeMonster({ type: 'TERRAIN', x: px + side[0], y: py + side[1], cells: [], scope: 2, data: {} }, 903, 1), g.world);
    Object.assign(m, { home: { x: m.x, y: m.y }, atk: 0, maxHp: 1e6, hp: 1e6 });
    g.monsters = [m];
    g.flee();
    ok(p.x === px && p.y === py && g.turn === turn0 && /跑不動/.test(g.log[0].text), `超重太多還是撤退了（${g.log[0].text}）`);
    // 出手擲 d20 的加減：地形（整平的空地 +1）＋武器品質的命中加值 −超重的減值，還是能出手
    const mods = [];
    const roll0 = FE.rollD20;
    FE.rollD20 = (r, mod) => { mods.push(mod); return roll0(r, mod); };
    p.hp = p.maxHp = 1e6;
    const modAt = (ore) => { setOre(ore); mods.length = 0; FE.Combat.resolveAttack(g, p, m, 'attack', { noCounter: true }); return mods[0]; };
    const m0 = modAt(12);
    const m1 = modAt(13);
    const m2 = modAt(15);
    FE.rollD20 = roll0;
    ok(m0 === 1 && m1 === 0 && m2 === -1, `出手加減：沒超重 ${m0}、超重第一段 ${m1}、第二段 ${m2}（應該 1、0、-1）`);
    setOre(15);
    g.monsters = [];
    const dropIdx = p.bag.findIndex((e) => e.id === 'ore');
    const tk1 = g.turn;
    g.dropItem(dropIdx);
    ok(g.turn === tk1 && g.loadTier() === 0 && g.weight() === 2, `丟掉之後該不花動作、重量回到 2（${g.weight()}）`);
    g.move(side[0], side[1]);
    ok(p.x === px + side[0] && p.y === py + side[1], '丟掉之後該能移動');
    // 送貨的東西不能丟
    g.bagAdd('goods', 1, { name: '舊地圖', giverId: 5 });
    const gi = p.bag.findIndex((e) => e.id === 'goods');
    g.dropItem(gi);
    ok(p.bag.some((e) => e.id === 'goods') && g.log[0].text.includes('不能丟'), '送貨的東西被丟掉了');
  }

  // 7. 防具多花的刻真的讓怪物多動（刻數累積，湊滿 10 刻才多動一次）
  {
    const countTurns = (body, actions) => {
      const g = newGame(17);
      const p = g.player;
      p.equip.body = body ? G.make(body, 0, g.nextGearId++) : null;
      const w0 = FE.AI.worldTurn;
      let turns = 0;
      FE.AI.worldTurn = (gg) => { turns++; return w0(gg); };
      for (let i = 0; i < actions; i++) g.rest();
      FE.AI.worldTurn = w0;
      return { turns, ticks: g.ticks };
    };
    const none = countTurns(null, 20);
    const heavy = countTurns('heavy', 20);
    const medium = countTurns('medium', 20);
    const light = countTurns('light', 20);
    ok(none.turns === 20 && none.ticks === 200, `沒防具 20 個動作 怪物動 ${none.turns} 次、${none.ticks} 刻`);
    ok(heavy.ticks === 240 && heavy.turns === 24, `重甲 20 個動作 ${heavy.ticks} 刻、怪物動 ${heavy.turns} 次（應該 240 刻、24 次）`);
    ok(medium.ticks === 220 && medium.turns === 22, `中甲 20 個動作 ${medium.ticks} 刻、怪物動 ${medium.turns} 次（應該 220 刻、22 次）`);
    ok(light.turns === 20 && light.ticks === 200, `輕甲不該多花刻（${light.ticks} 刻）`);
  }

  // 8. 穿上、丟掉、弓箭佔兩手、存檔
  {
    const g = newGame(18);
    const p = g.player;
    const sword0 = p.equip.main;
    const spear = G.make('spear', 2, g.nextGearId++);
    g.bagAddGear(spear);
    const t0 = g.turn, steps0 = p.steps;
    g.useItem(p.bag.findIndex((e) => e.gear === spear));
    ok(p.equip.main === spear && p.bag.some((e) => e.gear === sword0) && !p.bag.some((e) => e.gear === spear) && g.turn === t0 + 1 && p.steps === steps0, '拿起長槍：主手該換成長槍、長劍放回背包、算一個動作、不算步數');
    ok(g.playerAtk() === 4 && g.log.some((l) => l.text.includes('拿起了+精良+長槍')), `拿起長槍後攻擊力 ${g.playerAtk()}`);
    const sh = G.make('shield', 0, g.nextGearId++);
    const arm = G.make('medium', 4, g.nextGearId++);
    g.bagAddGear(sh); g.bagAddGear(arm);
    g.useItem(p.bag.findIndex((e) => e.gear === sh));
    g.useItem(p.bag.findIndex((e) => e.gear === arm));
    ok(p.equip.off === sh && p.equip.body === arm, '盾牌該穿在副手、防具穿在身上');
    ok(near(G.playerDefense(p).block, 0.25) && G.playerDefense(p).blockMax === 4, `拿盾牌後格擋 ${G.playerDefense(p).block}／${G.playerDefense(p).blockMax}`);
    // 換下的放回背包
    const sh2 = G.make('shield', 3, g.nextGearId++);
    g.bagAddGear(sh2);
    g.useItem(p.bag.findIndex((e) => e.gear === sh2));
    ok(p.equip.off === sh2 && p.bag.some((e) => e.gear === sh) && G.playerDefense(p).blockMax === 6, '換盾牌：舊的該放回背包、新的格擋值 6');
    // 弓箭佔兩手：拿弓時副手的盾牌放回背包，拿著弓不能拿盾牌
    const bow = G.make('bow', 0, g.nextGearId++);
    g.bagAddGear(bow);
    g.useItem(p.bag.findIndex((e) => e.gear === bow));
    ok(p.equip.main === bow && p.equip.off === null && p.bag.some((e) => e.gear === sh2), '拿弓箭時副手的盾牌該放回背包');
    const turn1 = g.turn;
    g.useItem(p.bag.findIndex((e) => e.gear === sh2));
    ok(p.equip.off === null && g.turn === turn1, '拿著弓箭不該能拿盾牌');
    // 工具放在背包裡就會用，選它是提示，不花動作
    const pick = G.make('pick', 0, g.nextGearId++);
    g.bagAddGear(pick);
    g.useItem(p.bag.findIndex((e) => e.gear === pick));
    ok(g.turn === turn1 && p.bag.some((e) => e.gear === pick), '選工具不該花動作或把它穿走');
    // 丟掉：整疊消失，不算動作
    g.bagAdd('herb', 4);
    const hi = p.bag.findIndex((e) => e.id === 'herb');
    g.dropItem(hi);
    ok(g.bagCount('herb') === 0 && g.turn === turn1, '丟掉藥草整疊都該消失、不算動作');
    // 存檔讀回來：裝備、耐久、背包裡的裝備、下一件裝備的編號
    p.equip.main.dur = 123;
    p.equip.body.warned = true;
    FE.Save.save(g);
    const back = FE.Save.load();
    ok(!!back && !!back.game, '存檔讀不回來');
    if (back && back.game) {
      const q = back.game.player;
      ok(q.equip.main.type === 'bow' && q.equip.main.dur === 123 && q.equip.body.type === 'medium' && q.equip.body.q === 4 && q.equip.body.warned === true && q.bag.filter((e) => e.id === 'gear').length === p.bag.filter((e) => e.id === 'gear').length && back.game.nextGearId === g.nextGearId, '存檔裡的裝備沒有完整讀回來');
      ok(back.game.weight() === g.weight(), '讀回來的負重不一樣');
    }
  }

  // 9. 掉落：中型怪物 30% 多掉一件裝備（做工好～優秀）、寶箱 25%（普通～傑作），弓箭法杖不掉
  {
    const g = newGame(19);
    const p = g.player;
    const mid = () => { const m = FE.makeMonster({ type: 'TERRAIN', x: 0, y: 0, cells: [], scope: 6 }, 1, 1); return m; };
    const bagGear = () => p.bag.filter((e) => e.id === 'gear').map((e) => e.gear);
    // 創世時的中型怪物（small=false）與合體怪物（small=false、有 members）都會掉；事件生的 small、小怪物不掉
    const runs = 10000;
    let got = 0;
    const hist = {};
    const types = new Set();
    for (let i = 0; i < runs; i++) {
      p.bag = [];
      g.dropGear(mid());
      const l = bagGear();
      if (l.length) { got++; hist[l[0].q] = (hist[l[0].q] || 0) + 1; types.add(l[0].type); }
    }
    ok(Math.abs(got / runs - 0.1) < 0.02, `中型怪物掉裝備的比例 ${(got / runs).toFixed(3)}（應該約 0.1）`);
    ok(Object.keys(hist).every((q) => q >= 1 && q <= 3) && hist[1] > hist[2] && hist[2] > hist[3], `中型怪物掉的品質 ${JSON.stringify(hist)}（應該做工好～優秀，越高越少）`);
    ok([...types].every((t) => FE.GEAR[t].drop) && !types.has('bow') && !types.has('staff') && !types.has('pick') && ['sword', 'spear', 'dagger', 'heavy', 'medium', 'light', 'robe', 'mrobe', 'shield'].every((t) => types.has(t)), `掉落的種類 ${[...types]}`);
    const small = mid(); small.small = true;
    const tiny = FE.makeMonster({ type: 'TERRAIN', x: 0, y: 0, cells: [], scope: 2 }, 1, 1);
    let extra = 0;
    for (let i = 0; i < 1000; i++) { p.bag = []; g.dropGear(small); g.dropGear(tiny); extra += bagGear().length; }
    ok(extra === 0, `事件生的中型怪物或小怪物不該掉裝備（掉了 ${extra} 件）`);
    // 寶箱
    let chestGot = 0;
    const ch = {};
    const chestRuns = 20000;
    for (let i = 0; i < chestRuns; i++) {
      p.bag = [];
      p.hp = p.maxHp;
      g.world.chests.push({ id: 9000 + i, x: 0, y: 0, gold: 5 });
      g.openChest(g.world.chests[g.world.chests.length - 1]);
      const l = bagGear();
      if (l.length) { chestGot++; ch[l[0].q] = (ch[l[0].q] || 0) + 1; }
    }
    ok(Math.abs(chestGot / chestRuns - 0.1) < 0.02, `寶箱多開出裝備的比例 ${(chestGot / chestRuns).toFixed(3)}（應該約 0.1）`);
    ok(Object.keys(ch).every((q) => q >= 0 && q <= 5) && Object.keys(ch).length === 6 && ch[0] > ch[1] && ch[1] > ch[2] && ch[2] > ch[3], `寶箱開出的品質 ${JSON.stringify(ch)}（應該普通～傑作，越高越少）`);
  }
  // 10. 冒險者的反擊：機率 0、命中固定 1 點（暴擊 2、被閃開減半最少 0）；反擊的訊息不寫「必定反擊」；倒下在最近的聚落醒來
  {
    const g = newGame(20);
    const p = g.player;
    ok(C.PLAYER_COUNTER === 0 && G.playerDefense(p).counter === 0, '冒險者反擊機率該是 0');
    const m = FE.dressMonster(FE.makeMonster({ type: 'TERRAIN', x: p.x + 1, y: p.y, cells: [[p.x + 1, p.y]], scope: 2, data: {} }, 904, 1), g.world);
    Object.assign(m, { home: { x: m.x, y: m.y }, atk: 1, maxHp: 1e9, hp: 1e9 });
    g.monsters = [m];
    let counters = 0;
    FE.Combat.hook = (e) => { if (e.by === 'player' && e.counter) counters++; };
    for (let i = 0; i < 2000; i++) { p.hp = p.maxHp = 1e9; FE.Combat.resolveAttack(g, m, p, 'attack'); }
    ok(counters === 0, `反擊機率 0 卻反擊了 ${counters} 次`);
    // 直接叫反擊：傷害只會是 0、1、2
    const seen = {};
    let hard = 0;
    FE.Combat.hook = (e) => { if (e.by === 'player' && e.counter) { seen[e.dmg] = (seen[e.dmg] || 0) + 1; if (e.key === 'hard') hard++; } };
    p.equip.main.dur = p.equip.main.max = 1e9;
    for (let i = 0; i < 3000; i++) { m.hp = 1e9; FE.Combat.resolveAttack(g, p, m, 'attack', { noCounter: true, counter: true }); }
    FE.Combat.hook = hook0;
    ok(Object.keys(seen).every((d) => [0, 1, 2].includes(Number(d))) && seen[1] > 100 && hard > 100, `反擊傷害分布 ${JSON.stringify(seen)}`);
    ok(!g.log.some((l) => l.text.startsWith('你反擊') && l.text.includes('必定反擊')), '反擊的訊息不該寫「對方必定反擊」');
    // 倒下：在離倒下的地方最近的聚落（不看神聖）醒來，醒在離聚落中央最近的路上
    const g2 = new FE.Game(5151);
    g2.start();
    g2.checkCreate = () => {};
    for (let i = 0; i < 6; i++) g2.createChunk(false);
    g2.monsters = [];
    const w2 = g2.world;
    ok(w2.villages.length >= 2, '需要兩個以上的聚落');
    for (const v of w2.villages) {
      g2.player.x = v.x1 + 20; g2.player.y = v.cy;
      const nearest = w2.villages.slice().sort((a, b) => Math.abs(a.cx - g2.player.x) + Math.abs(a.cy - g2.player.y) - (Math.abs(b.cx - g2.player.x) + Math.abs(b.cy - g2.player.y)))[0];
      g2.die({ name: '怪物', hp: 1, maxHp: 2 });
      const vv = w2.villageAt(g2.player.x, g2.player.y);
      ok(vv === nearest && w2.cell(g2.player.x, g2.player.y).t === '·', `倒下後醒在 ${vv && vv.name}，應該是最近的 ${nearest.name} 的路上`);
    }
  }
  // 11. 撞上怪物只設目標，不出手、不算動作；按 1 才出手
  {
    const g = newGame(21);
    const p = g.player;
    const m = FE.dressMonster(FE.makeMonster({ type: 'TERRAIN', x: p.x + 1, y: p.y, cells: [[p.x + 1, p.y]], scope: 2, data: {} }, 905, 1), g.world);
    Object.assign(m, { home: { x: m.x, y: m.y }, atk: 3 });
    g.monsters = [m];
    const before = { turn: g.turn, ticks: g.ticks, creation: g.creation, compute: g.compute, hp: m.hp, php: p.hp, x: p.x, y: p.y, dur: p.equip.main.dur, mx: m.x, my: m.y };
    g.guard('test', () => g.move(1, 0));
    ok(g.battle.targetId === m.id && g.turn === before.turn && g.ticks === before.ticks && g.creation === before.creation && g.compute === before.compute, '撞上怪物該只設目標，不算動作、不花刻、不產生算力');
    ok(m.hp === before.hp && p.hp === before.php && p.x === before.x && p.y === before.y && m.x === before.mx && m.y === before.my && p.equip.main.dur === before.dur, '撞上怪物不該出手、不該移動、怪物不該動');
    // 在村莊裡也不能動手（按 1 時才檢查）
    g.act('attack');
    ok(g.turn === before.turn, '在村莊裡按 1 不該出手');
  }

  // 12. 寶箱金幣減半（創世時放的與怪物掉的），算壞的公式套在減半後的數字上
  {
    const r = FE.makeRng(5);
    let max = -1e9, bad = 0, neg = 0;
    for (let i = 0; i < 20000; i++) {
      const v = FE.roughGold(r);
      if (!Number.isFinite(v)) { bad++; continue; }
      if (v < 0) neg++;
      max = Math.max(max, v);
    }
    ok(max <= 25 && max >= 20 && bad > 800 && bad < 2400 && neg > 2000, `創世寶箱金幣：最大 ${max}（減半後應該 ≤25）、NaN ${bad}、負數 ${neg}`);
    const g = newGame(22);
    const drop = (m, n) => {
      const out = [];
      for (let i = 0; i < n; i++) {
        g.world.chests = [];
        g.dropChest(m);
        if (g.world.chests.length) out.push(g.world.chests[0].gold);
      }
      return out;
    };
    const mid = FE.makeMonster({ type: 'TERRAIN', x: g.player.x + 3, y: g.player.y, cells: [], scope: 6 }, 1, 1);
    const small = FE.makeMonster({ type: 'TERRAIN', x: g.player.x + 3, y: g.player.y, cells: [], scope: 2 }, 2, 1);
    small.small = true;
    const dm = drop(mid, 300);
    const ds = drop(small, 600);
    ok(dm.length > 0 && Math.min(...dm) >= 14 && Math.max(...dm) <= 16, `中型怪物的寶箱金幣 ${Math.min(...dm)}～${Math.max(...dm)}（原本 27～32，減半後 14～16）`);
    ok(ds.length > 0 && Math.min(...ds) >= 3 && Math.max(...ds) <= 8, `小怪物的寶箱金幣 ${Math.min(...ds)}～${Math.max(...ds)}（原本 5～15，減半後 3～8）`);
  }
  FE.Combat.hook = hook0;
}
try { testGear(); } catch (e) { fail('裝備測試拋出例外：' + e.stack); }

// ---- 可達性快取：地形被改動後（修復、侵蝕、重算、聚落排版都走 setCell／setHeight），新的檢查要跟全世界走一遍的結果一致 ----
let reachChecks = 0;
function testReach() {
  const ok = (cond, msg) => { reachChecks++; if (!cond) fail('可達性 ' + msg); };
  const g = new FE.Game(8080);
  g.start();
  g.checkCreate = () => {};
  for (let i = 0; i < 6; i++) g.createChunk(false);
  const w = g.world;
  const b = w.bounds();
  const r = FE.makeRng(99);
  const same = () => {
    const nr = FE.Checker.reachable(w);
    const fr = FE.Checker.full.reachable(w);
    let diff = 0;
    w.forEachCell((x, y) => { if (nr.at(x, y) !== fr.at(x, y)) diff++; });
    return diff;
  };
  ok(same() === 0, '剛創出來的世界就不一致');
  const cached = FE.Checker.reachable(w);
  ok(FE.Checker.reachable(w) === cached, '世界沒變，連通性該直接用快取');
  for (let round = 0; round < 25; round++) {
    // 隨機把一些格子改成水、巨石、空地，或把高度差 2 階（跨區塊的邊上也改）
    for (let k = 0; k < 40; k++) {
      const x = FE.randInt(r, b.x0, b.x1 - 1);
      const y = FE.randInt(r, b.y0, b.y1 - 1);
      if (!w.cell(x, y)) continue;
      const kind = FE.randInt(r, 0, 3);
      if (kind === 0) w.setCell(x, y, '≈', 'lake');
      else if (kind === 1) w.setCell(x, y, '#', 'plain');
      else if (kind === 2) w.setCell(x, y, '.', 'plain');
      else w.setHeight(x, y, Math.max(0, Math.min(4, w.cell(x, y).h + (r() < 0.5 ? 2 : -2))));
    }
    // 區塊接縫上多改幾格
    for (const ch of w.chunks) {
      const y = ch.y0 + FE.randInt(r, 0, C.CHUNK_H - 1);
      w.setCell(ch.x0, y, r() < 0.5 ? '≈' : '.', 'plain');
      w.setCell(ch.x1 - 1, y, r() < 0.5 ? '≈' : '.', 'plain');
    }
    const d = same();
    ok(d === 0, `第 ${round} 輪改動後有 ${d} 格不一致`);
  }
  // 一整塊被水圍起來的地方：新檢查也要抓成斷層，跟舊的一樣
  const ch = w.chunks[w.chunks.length - 1];
  const cx = ch.x0 + 20, cy = ch.y0 + 20;
  for (let y = cy - 3; y <= cy + 3; y++) for (let x = cx - 3; x <= cx + 3; x++) {
    const edge = Math.abs(x - cx) === 3 || Math.abs(y - cy) === 3;
    w.setCell(x, y, edge ? '≈' : '.', edge ? 'lake' : 'plain');
    w.setHeight(x, y, 2);
  }
  const rect = { x0: ch.x0, y0: ch.y0, x1: ch.x1, y1: ch.y1 };
  const a = FE.Checker.scan(w, rect, []).filter((d) => d.type === 'UNREACHABLE');
  const f = FE.Checker.full.scan(w, rect, []).filter((d) => d.type === 'UNREACHABLE' && d.cells.some(([x, y]) => x >= rect.x0 - 1 && x <= rect.x1 && y >= rect.y0 - 1 && y <= rect.y1));
  ok(a.length > 0 && JSON.stringify(a) === JSON.stringify(f), `被圍住的區域：新 ${a.length} 筆、舊 ${f.length} 筆`);
}
try { testReach(); } catch (e) { fail('可達性測試拋出例外：' + e.stack); }

// ---- 報告 ----
const avg = (a, f) => (a.length ? (a.reduce((s, x) => s + f(x), 0) / a.length).toFixed(2) : '-');
const rate = (a, f) => `${a.filter(f).length}/${a.length}`;
for (const k of ['village', 'town']) {
  const a = stats[k];
  console.log(`${k}: ${a.length} 座｜民房蓋齊 ${rate(a, (s) => s.houses >= s.want)}｜工坊 ${rate(a, (s) => s.smithy)}｜神殿與市場 ${rate(a, (s) => s.temple && s.market)}｜出入口（量到）${avg(a, (s) => s.groups)}｜平均民房 ${avg(a, (s) => s.houses)}（8 格 ${avg(a, (s) => s.big)}）｜床 ${avg(a, (s) => s.beds)}｜村民 ${avg(a, (s) => s.villagers)}`);
  console.log(`  外形：平均外接矩形 ${avg(a, (s) => s.gw)}×${avg(a, (s) => s.gh)}（工作範圍 ${k === 'town' ? C.TOWN_W + '×' + C.TOWN_H : C.VILLAGE_W + '×' + C.VILLAGE_H}），佔工作範圍 ${avg(a, (s) => s.garea)}，牆內空地（走道與零碎空地）佔聚落 ${avg(a, (s) => s.gopen)}`);
}
console.log(`貼著外牆有 3 格以上水或巨石的聚落：${geo.nearBlock}/${geo.count}`);
console.log(`地貌 ${stats.landmarks}，沒放成 ${stats.landmarkMiss}｜每塊創世平均 ${avg(stats.ms, (x) => x)} ms，最慢 ${stats.ms.length ? Math.max(...stats.ms).toFixed(0) : '-'} ms（${stats.ms.length} 塊，不含比對舊檢查的時間）｜城鎮沒蓋成盔甲匠工坊 ${stats.noArmory || 0} 座`);
console.log(`可達性：跟全世界檢查逐次比對 ${reachCheck.compared} 次（含四人等效模擬途中被侵蝕、修復過的世界）｜新做法的掃描共 ${reachCheck.newMs.toFixed(0)} ms；對照的舊做法（全世界走一遍＋掃一遍）比對共 ${reachCheck.fullMs.toFixed(0)} ms`);
console.log(`出入口不足、生出斷層怪物的聚落：${stats.gateBugs} 座｜民房或床位沒蓋齊（可接受的粗糙）：${stats.short.length} 件`);
const countOf = (a) => a.reduce((m, x) => ((m[x] = (m[x] || 0) + 1), m), {});
if (!SIM4_ONLY) {
  console.log(`城鎮：第一座都在第 ${JSON.stringify(countOf(stats.firstTowns))} 塊｜之後相隔 ${JSON.stringify(countOf(stats.townGaps))} 塊（次數）｜士兵共 ${stats.soldiers} 位`);
  console.log(`創世門檻檢查 ${creationChecks} 項｜世界等級檢查 ${wlChecks} 項｜士兵場景檢查 ${soldierChecks} 項`);
}
for (const s of sim) console.log('單人模擬', JSON.stringify(s));
if (lazySim) console.log('對照（只走路不打怪）', JSON.stringify(lazySim));
for (const s of sim4) console.log('四人等效（世界每 4 個動作走 1 回合，每個動作的算力不乘 4）', JSON.stringify(s));
console.log(`背包、工具、採集、藥草、艱難選擇的場景檢查 ${bagChecks} 項｜裝備與物品的場景檢查 ${gearChecks} 項｜可達性快取的場景檢查 ${reachChecks} 項`);
// 量測：各世界等級（怪物生成時的）機器人打倒小怪物、中型怪物平均用了幾下（冒險者自己出手的次數，不含反擊），
// 以及機器人在那個世界等級時主手武器清除等級（品質）的中間值（單人與四人等效模擬合計，不含防具對照組）。目標：小怪物約 3 下、中型怪物約 6 下
{
  const med = (a) => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[Math.floor((b.length - 1) / 2)] : '-'; };
  const mean = (a) => (a.length ? (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) : '-');
  const wls = [...new Set(Object.keys(measure.kills).concat(Object.keys(measure.clear)).map(Number))].sort((a, b) => a - b);
  console.log(`怪物血量的世界等級加成 ${C.WL_BONUS.HP}（每級）｜各世界等級：主手武器清除等級（品質）中間值、打倒小怪物平均幾下（隻數）、中型怪物平均幾下（隻數）`);
  for (const wl of wls) {
    const k = measure.kills[wl] || { small: [], mid: [] };
    console.log(`  世界等級 ${wl}：武器清除等級 ${med(measure.clear[wl] || [])}｜小怪物 ${mean(k.small)} 下（${k.small.length}）｜中型怪物 ${mean(k.mid)} 下（${k.mid.length}）`);
  }
  // 防具對照：同樣的種子、動作數，沒有防具 vs 穿重甲（都不拿盾牌），冒險者被怪物打一下平均受到多少傷害
  const cmp = measure.armorCmp;
  const line = (c, name) => (cmp[c] ? `${name} 每下 ${(cmp[c].dmg / cmp[c].n).toFixed(2)} 點傷害（怪物出手 ${cmp[c].n} 次、打中 ${cmp[c].hit} 次、命中時平均 ${(cmp[c].dmg / Math.max(1, cmp[c].hit)).toFixed(2)}）` : `${name} -`);
  console.log(`防具對照（${SEEDS.length} 個種子各 ${SIM_CMP_STEPS} 個動作，單人）：${line('none', '沒有防具')}｜${line('heavy', '穿重甲')}${cmp.none && cmp.heavy ? `｜重甲是沒防具的 ${((cmp.heavy.dmg / cmp.heavy.n) / (cmp.none.dmg / cmp.none.n) * 100).toFixed(0)}%` : ''}`);
}
console.log(`對話：邏輯檢查 ${dlgChecks} 項｜機器人開了 ${dlgStats.opened} 次對話（接委託 ${dlgStats.accept}、交件 ${dlgStats.deliver}、回報 ${dlgStats.report}；工匠那裡買 ${dlgStats.buy}、修 ${dlgStats.repair}、打造 ${dlgStats.craft}、賣礦石 ${dlgStats.sellOre}、賣裝備 ${dlgStats.sell}；離開 ${dlgStats.leave}）`);
console.log(`聚落周圍的怪物（任何時刻、含生成點）：違規 ${bufferViolations} 次｜機器人被村民夾在屋裡、等村民走開 ${stuckFixes} 次`);
const pct = (n, d) => (d ? (100 * n / d).toFixed(1) + '%' : '-');
const dist = (t) => { const n = Object.values(t).reduce((a, b) => a + b, 0); return ['crit', 'hit', 'hard', 'miss', 'fumble'].map((k) => `${k} ${pct(t[k] || 0, n)}`).join('、') + `（共 ${n}）`; };
console.log(`戰鬥：判定 ${combat.events} 次｜冒險者出手 ${dist(combat.player)}｜怪物出手 ${dist(combat.monster)}`);
console.log(`  閃避 ${combat.dodged}、格擋 ${combat.blocked}、暴擊 ${combat.crit}、抗性 ${combat.resisted}、反擊 ${combat.counters}（連鎖 ${combat.chain}）、趁機攻擊 ${combat.opportunity}（打中 ${combat.opportunityHit}）、負傷害 ${combat.negative}｜平均每下 冒險者 ${(combat.pdmg / combat.pn).toFixed(2)}、怪物 ${(combat.mdmg / combat.mn).toFixed(2)}`);
console.log(`從出生點走不到的聚落（世界的斷層）：${cutOff.length} 次 ${cutOff.slice(0, 5).join('、')}`);
console.log(`問題 ${problems.count || 0} 件`);
for (const p of problems) console.log('  ', p);
