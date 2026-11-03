// 合併測試（每一版都用這支）：node tools/test.js
// 生成統計（40 個種子各創 17 塊）＋3 個種子各 1500 個動作的單人機器人模擬＋一組「只走路不打怪」的對照
// ＋「四人等效」模擬（機器人每做 4 個動作，世界才走 1 回合；3 個種子各至少 3000 個動作、至少創出 15 塊）。
// 檢查：室內走得通、住戶碰得到、聚落周圍沒有怪物（嚴格）、出入口、戰鬥判定、世界狀態、創世耗時、
// 創世門檻（清光一塊的內容一定解得出下一塊）、世界等級加成、城鎮出現時機、士兵的行為、
// 背包與送貨物品、買工具、採集、藥草、怪物出手擲 6～10 不讓冒險者必定反擊、
// 第二十五版：新的可達性檢查跟全世界檢查的結果一致、品質倍率與四捨五入、清除等級與抗性門檻、防具減傷至少吃 1 點、
// 磨損與壞掉、鐵匠／武器匠／盔甲匠的買修打造賣、盾牌歸盔甲匠、負重兩段減值、打造與掉落的品質範圍。
// 機器人會買防具與盾牌、穿上、耐久低時回去修、錢夠時換更好的品質、超重時賣礦石或丟東西。
// 另外量測：競技場（各職業、世界等級 1～7、角色等級 1／5／10／15 打倒小怪物、中型怪物平均用了幾下和被打一下的平均傷害，校準怪物血量的世界等級加成用）、
// 沒有防具與穿重甲時冒險者平均每下受到多少傷害。
// 第二十九版：種族與體型、技能經驗、屬性效果、升級表、擴充武器第一批與弩矢、負重改磅數的場景檢查在 testGrowth29。
// 只跑四人等效模擬（調數字用）：node tools/test.js sim4
// 第二十九版：測試分成很多項「工作」（生成統計的種子區間、每一場模擬、每一組場景檢查、競技場量測），
// 用子行程同時跑（同時幾個看環境變數 FE_JOBS，預設 4），最後把各項結果合起來印報告，並印出每一段耗時。
//   node tools/test.js          全測
//   node tools/test.js quick    快測：只跑場景檢查、競技場量測加一個種子的短模擬
//   node tools/test.js sim4     只跑四人等效模擬
//   node tools/test.js unit     只跑場景檢查
//   node tools/test.js arena    只跑競技場量測（各職業、世界等級、角色等級打倒怪物要幾下）
const ARGV = process.argv.slice(2);
const JOB = ARGV[0] === '--job' ? ARGV[1] : null; // 子行程：只跑這一項工作，結果用 process.send 交回主行程
const MODE = JOB ? process.env.FE_MODE || 'full' : ARGV[0] || 'full';
const UNIT_ONLY = MODE === 'unit'; // 只跑場景測試（創世門檻、世界等級、士兵、對話），不跑生成統計和模擬
const SIM4_ONLY = MODE === 'sim4' || UNIT_ONLY || MODE === 'arena';
const QUICK = MODE === 'quick';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const cp = require('child_process');
const ROOT = path.join(__dirname, '..', 'js') + path.sep;
global.window = global;
for (const f of ['config', 'rng', 'world', 'checker', 'bugs', 'steading', 'char', 'gear', 'combat', 'stability', 'events', 'ai', 'game', 'save']) {
  vm.runInThisContext(fs.readFileSync(ROOT + f + '.js', 'utf8'), { filename: f + '.js' });
  if (f === 'rng') {
    const mem = new Map();
    FE.store = { load: (k, d) => (mem.has(k) ? mem.get(k) : d), save: (k, v) => mem.set(k, v), remove: (k) => mem.delete(k) };
  }
}
const C = FE.CONFIG;
// 四職業的起始屬性：第二十九版追加改成《D&D》標準陣列 15、14、13、12、10、8；
// 場景檢查裡大多數數字（傷害加值、格擋值、價錢、生命⋯⋯）是照舊的 16、15、13、12、9、8 排的，所以場景檢查預設用舊的，
// 只有明確測起始屬性的地方才用 useClasses('new') 換成新的。競技場與機器人模擬一律用新的
// 第二十九版再追加（六個職業、精通一律要技能 5 級）：場景檢查預設用「舊的四職業」（第二十九版追加前的定義，單位數字才對得上），
// 並把精通門檻設成 0 級（舊測試裡戰士、遊俠一開始就會精通）；明確測新職業、新精通的地方用 useClasses('new') 換回真的。競技場與機器人模擬一律用新的
const NEW_CLASSES = FE.CLASSES;
const OLD_CLASSES = {
  warrior: { name: '戰士', base: 10, attr: { str: 16, dex: 13, con: 15, int: 9, wis: 12, cha: 8 }, desc: '', fixed: ['medium'], groups: [{ pick: 1, of: ['sword', 'spear', 'shortspear'] }, { pick: 2, of: ['shield', 'herb', 'gold'] }], primary: 'str', bash: true, pool: ['fight', 'melee'] },
  ranger: { name: '遊俠', base: 8, attr: { str: 12, dex: 16, con: 13, int: 8, wis: 15, cha: 9 }, desc: '', fixed: ['light'], groups: [{ pick: 1, of: ['bow', 'dagger', 'shortspear', 'spear'] }], primary: 'dex', pool: ['shoot', 'fight'] },
  mage: { name: '法師', base: 4, attr: { str: 8, dex: 13, con: 12, int: 16, wis: 15, cha: 9 }, desc: '', fixed: ['robe'], groups: [{ pick: 1, of: ['staff', 'dagger'] }, { pick: 1, of: ['herb', 'gold'] }], primary: 'int', spell: true, pool: ['dodge'] },
  priest: { name: '牧師', base: 8, attr: { str: 13, dex: 8, con: 15, int: 9, wis: 12, cha: 16 }, desc: '', fixed: [], groups: [{ pick: 1, of: ['medium', 'shield'] }, { pick: 1, of: ['staff', 'sword'] }, { pick: 1, of: ['herb', 'gold'] }], primary: 'wis', holy: true, heal: true, pool: ['shield'] },
};
const useClasses = (which) => {
  FE.CLASSES = which === 'new' ? NEW_CLASSES : OLD_CLASSES;
  FE.MASTERY_SKILL = which === 'new' ? 5 : 0;
};
// 第二十六版：沒指定職業的 game.start() 給中性角色（場景測試與對照組用）：六項屬性都是 10（修正值 0）、沒有技能、
// 裝備照第二十五版（普通長劍、沒有防具與盾牌）、背包空的、沒有金幣，生命上限 30、能背 150 磅（力量 10）、普通體型的人類（70,000），
// 這樣舊的場景檢查（傷害、閃避 10%、出手加減⋯⋯）數字不變。要測職業就明確傳 { cls, picks }
function neutralChar(g) {
  const p = g.player;
  p.cls = 'warrior';
  p.attr = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
  p.skills = FE.Char.freshSkills();
  p.points = 0;
  p.race = 'human';
  p.height = 4;
  p.build = 4;
  p.size = 70000;
  p.equip = { main: FE.Gear.make('sword', 0, g.nextGearId++), off: null, body: null };
  p.block = null;
  p.copper = 0;
  p.bag = [];
  p.maxHp = p.hp = FE.Char.maxHp(p, 1);
}
// 第三十版：舊的場景檢查一次做幾百個動作，時間會過好幾天；那些檢查不是在測力竭，所以不讓冒險者累（awakeAt 一直跟著時鐘走）。
// 力竭本身在 testEconomy30 測，機器人模擬照真的規則
let NO_TIRE = false;
const advance0 = FE.Game.prototype.advance;
FE.Game.prototype.advance = function (t, interrupt) {
  if (NO_TIRE && this.player) this.player.awakeAt = this.ticks;
  return advance0.call(this, t, interrupt);
};
const start0 = FE.Game.prototype.start;
FE.Game.prototype.start = function (opts) {
  start0.call(this, opts);
  if (!(opts && opts.cls)) neutralChar(this);
};
// 調數字用：FE_CFG='{"CREATION_SHARE":0.4}' 暫時蓋掉設定，FE_SEEDS='777,20201' 只跑這些種子的四人等效模擬
if (process.env.FE_CFG) Object.assign(C, JSON.parse(process.env.FE_CFG));
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIRS8 = DIRS.concat([[1, 1], [1, -1], [-1, 1], [-1, -1]]);
const key = (x, y) => x + ',' + y;
const UNITS = {}; // 場景檢查：每一組是一項工作，可以在不同子行程同時跑
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
// 量測：on 時才記（機器人模擬）；cond 是對照組的名字（'none' 沒有防具、'heavy' 穿重甲），armorCmp[cond] = 怪物出手打冒險者的次數與總傷害
// （第二十九版起，打倒怪物要幾下和各職業被打一下的傷害改在競技場量，見 runArena，不再從世界模擬統計）
const measure = { on: false, cond: null, armorCmp: {} };
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
const GEN_SEEDS = 40;
function runGen(seedLo, seedHi) {
for (let seed = seedLo; seed <= seedHi; seed++) {
  const game = new FE.Game(seed * 7919);
  game.start();
  verifyReach = seed === 1; // 新舊可達性比對只在一個種子上跑（第二十九版；原本前 5 個種子）
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
}

// ---- 機器人模擬 ----
// 裝備的好壞（機器人用）：武器看傷害骰的平均再看品質，防具看物理減傷再看魔法減傷與品質，盾牌看品質
const slotOf = (g) => ({ weapon: 'main', shield: 'off', armor: 'body' })[FE.GEAR[g.type].cat] || null;
function gearScore(g) {
  const d = FE.GEAR[g.type];
  if (d.cat === 'weapon') return (d.die[0] * (d.die[1] + 1)) / 2 * 10 + g.q;
  if (d.cat === 'armor') return d.phys * 10 + d.magic + g.q * 0.1;
  return 10 + g.q;
}
// 機器人整理裝備：超重太多（走不動）就先丟沒用的裝備、礦石、多的藥草；有比身上好的就穿上（一個動作）。
// game.botNoArmor 是對照組用的：不穿防具也不拿盾牌。回傳 true 表示做了一個動作
let botDrops = 0; // 機器人因為超重丟掉東西的次數（量「正常玩法下多常超重」用）
function botGear(game) {
  const p = game.player;
  const noArmor = !!game.botNoArmor;
  // 第二十八版：機器人只換同一種武器（品質比較好的），不換掉職業的武器（遊俠的弓箭、法師的法杖）
  const wearable = (g) => FE.Char.canWear(p, g) && !(FE.GEAR[g.type].str > p.attr.str); // 野蠻人不穿中甲重甲；力量不夠的防具走路會變慢，機器人不穿
  const better = (g, s) => (s === 'body' && !wearable(g) ? false : !p.equip[s] || (s === 'main' ? g.type === p.equip.main.type && g.q > p.equip.main.q : gearScore(g) > gearScore(p.equip[s])));
  const junk = () => p.bag.findIndex((e) => {
    if (e.id !== 'gear') return false;
    const s = slotOf(e.gear);
    if (!s) return false;
    if (noArmor && s !== 'main') return true;
    return !!p.equip[s] && !better(e.gear, s);
  });
  // 第二十九版：超過能背的重量（走一步 60 刻）就先丟沒用的東西；超過推拖上限（走不動）丟到沒東西可丟，才卸掉身上的盾牌或防具
  while (game.loadTier() >= 1) {
    let i = junk();
    if (i < 0) i = p.bag.findIndex((e) => e.id === 'ore');
    if (i < 0) i = p.bag.findIndex((e) => e.id === 'herb' && e.n > 3);
    if (i >= 0) botDrops++;
    if (i < 0 && game.loadTier() < 2) break;
    if (i < 0) {
      // 負重上限小的職業（法師 6、牧師 11）背不動全套：還是走不動，就把身上最重的盾牌或防具卸掉（玩家會自己挑輕的帶）
      const heavy = [p.equip.off, p.equip.body].filter(Boolean).sort((a, b) => FE.GEAR[b.type].weight - FE.GEAR[a.type].weight)[0];
      if (!heavy) break;
      game.removeGear(heavy);
      continue;
    }
    game.dropItem(i);
  }
  const i = p.bag.findIndex((e) => {
    if (e.id !== 'gear') return false;
    const s = slotOf(e.gear);
    if (!s || (noArmor && s !== 'main')) return false;
    // 拿著雙手武器時不拿盾牌（拿不了）
    if (s === 'off' && p.equip.main && FE.Gear.twoHanded(p, p.equip.main)) return false;
    // 主手空著（壞掉了）：撿起背包裡的任何武器
    return better(e.gear, s);
  });
  if (i >= 0) {
    game.useItem(i);
    return true;
  }
  return false;
}

// 機器人開新世界時挑的起始裝備（選項 id）：戰士長劍、盾牌、2 份藥草；遊俠弓箭（附 20 支箭）；法師法杖、2 份藥草；牧師中甲、長劍、2 份藥草
const BOT_PICKS = {
  warrior: ['sword', 'shield', 'herb'],
  ranger: ['dagger'],            // 弓箭與一捆箭是固定給的
  mage: ['herb'],                // 法杖是固定給的
  priest: ['shield', 'herb'],    // 鱗甲與硬頭錘是固定給的
  paladin: ['sword', 'herb'],    // 鎖子甲與盾牌是固定給的
  barbarian: ['greataxe', 'herb'], // 皮甲是固定給的；不能穿中甲、重甲
};
const BOT_CLASSES = Object.keys(BOT_PICKS);
// 機器人照職業挑種族（第二十九版）：戰士、牧師矮人（體質 +2），遊俠精靈（敏捷 +2），法師人類（兩點都加智力）；身高、體格都取普通（4、4）
const BOT_BODY = {
  warrior: { race: 'dwarf', bonus: {}, height: 4, build: 4 },
  ranger: { race: 'elf', bonus: {}, height: 4, build: 4 },
  mage: { race: 'human', bonus: { int: 2 }, height: 4, build: 4 },
  priest: { race: 'dwarf', bonus: {}, height: 4, build: 4 },
  paladin: { race: 'dwarf', bonus: {}, height: 4, build: 4 },
  barbarian: { race: 'human', bonus: { str: 2 }, height: 4, build: 4 }, // 70,000 的人類拿得起巨斧（雙手）
};

// 機器人升級加點：照職業的主屬性（戰士力量、遊俠敏捷、法師智力、牧師感知）和體質輪流加，一個加到 18 就改加另一個，兩個都滿了加別的。
// 輪到誰看已經花掉幾點（現在六項屬性的總和減去起始的總和）：偶數點加主屬性，奇數點加體質
function botPoints(game) {
  const p = game.player;
  const c = FE.CLASSES[p.cls];
  while (p.points > 0) {
    const sum = (a) => FE.ATTRS.reduce((s, x) => s + a[x.key], 0);
    const want = (sum(p.attr) - sum(c.attr)) % 2 === 0 ? [c.primary, 'con'] : ['con', c.primary];
    const key = want.concat(FE.ATTRS.map((a) => a.key)).find((k) => p.attr[k] < C.ATTR_CAP);
    if (!key || !game.spendPoint(key)) break;
  }
}

function botStep(game, rng, goal, lazy) {
  const w = game.world;
  const p = game.player;
  botPoints(game);
  const adj = game.adjacentMonsters();
  // 超重太多會走不動、跑不掉，先處理；旁邊沒有怪物時順便換上比較好的裝備
  if (game.loadTier() >= 1 || !adj.length) {
    if (botGear(game)) return;
  }
  const cls = FE.Char.cls(p);
  // 牧師：生命一半以下、治療沒在冷卻就治療自己（按 4）
  if (!lazy && cls.heal && p.hp < p.maxHp * 0.5 && !(game.battle.healCd > 0)) return game.act('heal');
  // 血量低又有藥草就先吃（戰鬥中也能吃）
  if (p.hp < p.maxHp * (adj.length ? 0.3 : 0.4) && game.bagCount('herb')) return game.eatHerb();
  if (adj.length && p.hp < p.maxHp * 0.25) return game.act('flee');
  let tgt = lazy ? null : goal.get();
  // 遠程（遊俠的弓箭、法師拿法杖的範圍魔攻）：貼著怪物就射貼著的（有劣勢）；不然要找的怪物在正常射程內、看得到就射，不然走近
  const rm = !lazy && !game.world.inVillage(p.x, p.y) ? game.rangedMode(true) : null;
  if (rm && rm.mode !== 'throw') {
    const list = game.shootTargets(rm.range);
    const near = list.filter((m) => Math.abs(m.x - p.x) + Math.abs(m.y - p.y) <= rm.range[0]);
    const t = adj.length ? game.targetMonster() : near.find((m) => tgt && m.x === tgt.x && m.y === tgt.y) || near.find((m) => m.chase > 0 || m.id === game.battle.targetId);
    if (t && game.fireAt(t)) return;
  }
  if (adj.length && !lazy) {
    // 撞上怪物只設目標、不出手；先把目前的目標撞一下設好，再按 1／2 出手
    const m = game.targetMonster();
    if (m) game.move(m.x - p.x, m.y - p.y);
    // 戰士拿盾牌：偶爾盾擊（按 5）
    if (cls.bash && FE.Gear.shieldOf(p) && rng() < 0.25) return game.act('bash');
    return game.act(game.battle.cooldown === 0 && m && m.hp > 8 ? 'deep' : 'attack');
  }
  // 第三十版：累了（有力竭，或醒著快一整天）也回聚落長休（付生活開支）
  const tired = !lazy && ((p.exhaust || 0) >= 1 || game.ticks - (p.awakeAt || 0) >= C.DAY_TICKS * 0.8);
  if (!adj.length && (p.hp < p.maxHp * 0.4 || tired)) {
    // 血量低：在聚落裡長休一次就回滿；不在聚落裡就先走回最近的聚落（對照組只在原地短休）
    if (lazy) { if (rng() < 0.8) return game.rest(); }
    else if (w.inVillage(p.x, p.y)) return game.rest();
    else {
      const near = w.villages.slice().sort((a, b) => Math.abs(a.cx - p.x) + Math.abs(a.cy - p.y) - (Math.abs(b.cx - p.x) + Math.abs(b.cy - p.y)))[0];
      if (near) tgt = { x: near.cx, y: near.cy, home: true };
    }
  }
  if (tgt) {
    // 回聚落休息：走到任何一格聚落就停，找路看得遠一點（聚落可能在好幾塊世界外）
    const prev = new Map([[key(p.x, p.y), null]]);
    const q = [[p.x, p.y]];
    for (let h = 0; h < q.length && h < (tgt.home ? 40000 : 6000); h++) {
      const [x, y] = q[h];
      if (tgt.home ? h > 0 && w.inVillage(x, y) : Math.abs(x - tgt.x) + Math.abs(y - tgt.y) === 1 && w.heightOk(x, y, tgt.x, tgt.y)) {
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
  const NAV = (o) => ['buy', 'repair', 'craft', 'sell'].includes(o.id) || o.id.startsWith('cat:') || o.id.startsWith('qual:') || o.id.startsWith('craftCat:');
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
  const twoH = FE.Gear.twoHanded(p, p.equip.main); // 雙手拿武器（弓箭、體型不夠單手的）的不買盾牌
  const sells = (type) => Object.values(S.buy).some((a) => a.includes(type));
  const ammoOf = p.equip.main ? FE.GEAR[p.equip.main.type].ammo : null; // 拿弓或輕弩的：要買哪種彈藥
  const do_ = (id, stat) => { const ok = shopDo(game, npc, id); if (ok && stat) dlgStats[stat]++; return ok; };
  const price = (type, q) => FE.Gear.shopPrice(type, q, v, game.chaMod());
  const rank = (s) => (p.equip[s] ? gearScore(p.equip[s]) : 0);
  // 打造：缺盾牌、防具比現有的差，或主手還是普通品質時，礦石夠、工錢夠就打
  const cha = game.chaMod();
  // 背得動才買、才打造（法師背不了一整套）
  const fits = (type) => game.weight() + FE.GEAR[type].weight <= game.carryLimit();
  const craftable = (type) => fits(type) && S.craft.includes(type) && FE.Gear.craftQuote(type, v, cha).ore <= game.bagCount('ore') && FE.Gear.craftQuote(type, v, cha).fee <= p.copper;
  // 穿得了的防具（野蠻人不穿中甲重甲、力量不夠需求的不穿），好的排前面
  const armorTypes = Object.keys(FE.GEAR)
    .filter((t) => FE.GEAR[t].cat === 'armor' && t !== 'mrobe' && t !== 'robe' && FE.Char.canWear(p, { type: t }) && !(FE.GEAR[t].str > p.attr.str))
    .sort((a, b) => gearScore({ type: b, q: 0 }) - gearScore({ type: a, q: 0 }));
  if (!noArmor) {
    for (const type of armorTypes) {
      if (craftable(type) && gearScore({ type, q: 0 }) > rank('body')) { do_('craftItem:' + type, 'craft'); break; }
    }
    if (!twoH && !p.equip.off && !p.bag.some((e) => e.id === 'gear' && FE.GEAR[e.gear.type].cat === 'shield') && craftable('shield')) do_('craftItem:shield', 'craft');
  }
  if (p.equip.main && p.equip.main.q === 0 && craftable(p.equip.main.type) && game.bagCount('ore') >= 6) do_('craftItem:' + p.equip.main.type, 'craft');
  if (game.bagCount('ore') && !p.jobs.ore && do_('sellOre', 'sellOre')) { /* 礦石全賣（手上有採礦委託時留著交件） */ }
  // 修：磨損到四成以下的先修（都一次修到完整）
  for (let round = 0; round < 4; round++) {
    const worn = game.allGear().find((g) => S.repair.includes(FE.GEAR[g.type].cat) && g.dur < g.max * 0.4);
    if (!worn || !do_('repairItem:' + worn.id, 'repair')) break;
  }
  // 買：工具、盾牌、防具（比現有的好的才買，先挑好品質）、換更好品質的武器
  for (const tool of ['pick', 'sickle']) if (!game.toolOf(tool) && price(tool, 0) <= p.copper && fits(tool)) do_(`buyItem:${tool}:0`, 'buy');
  // 拿弓箭的：箭矢不到 40 支就買（先挑好品質），最多買 3 捆
  if (ammoOf && sells(ammoOf)) {
    for (let k = 0; k < 3 && game.bagCount(ammoOf) < 40; k++) {
      const q = S.quals.slice().reverse().find((qq) => price(ammoOf, qq) <= p.copper);
      if (q === undefined || !do_(`buyItem:${ammoOf}:${q}`, 'buy')) break;
    }
  }
  const qs = S.quals.slice().reverse();
  if (!noArmor) {
    if (!twoH && !p.equip.off && !p.bag.some((e) => e.id === 'gear' && FE.GEAR[e.gear.type].cat === 'shield') && sells('shield') && fits('shield')) {
      const q = qs.find((qq) => price('shield', qq) <= p.copper);
      if (q !== undefined) do_(`buyItem:shield:${q}`, 'buy');
    }
    if (armorTypes.some(sells)) {
      let best = null;
      for (const type of armorTypes) {
        if (!sells(type) || !fits(type)) continue;
        const q = qs.find((qq) => price(type, qq) <= p.copper);
        if (q === undefined) continue;
        if (gearScore({ type, q }) > Math.max(rank('body'), ...p.bag.filter((e) => e.id === 'gear' && FE.GEAR[e.gear.type].cat === 'armor').map((e) => gearScore(e.gear)))) { best = { type, q }; break; }
      }
      if (best) do_(`buyItem:${best.type}:${best.q}`, 'buy');
    }
  }
  if (p.equip.main && sells(p.equip.main.type) && p.equip.main.q < S.quals[S.quals.length - 1] && !p.bag.some((e) => e.id === 'gear' && FE.GEAR[e.gear.type].cat === 'weapon' && e.gear.q > p.equip.main.q)) {
    const q = S.quals[S.quals.length - 1];
    if (price(p.equip.main.type, q) <= p.copper) do_(`buyItem:${p.equip.main.type}:${q}`, 'buy');
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
const dlgStats = { opened: 0, accept: 0, report: 0, deliver: 0, 'hand:herb': 0, 'hand:ore': 0, craft: 0, repair: 0, buy: 0, sell: 0, sellOre: 0, leave: 0 };
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
  // 第三十版：四種委託各接一個，能交的先交（採藥、採礦交背包裡的）
  const pick = ['report', 'deliver', 'hand:herb', 'hand:ore', 'accept'].find((id) => idx(id) >= 0) || 'leave';
  if (pick === 'leave') dlgStats.leave++; else dlgStats[pick]++;
  game.choose(npc, t.options.findIndex((o) => o.id === pick));
  if (game.talking != null) fail('對話選完沒有關掉');
}

// 模擬一個機器人玩家。opts：
//   steps：動作數（單人模擬）；lazy：只走路不打怪；
//   worldEvery：世界（怪物、士兵）比時鐘再慢幾倍（四人等效是 4：機器人做 4 個動作的時間，世界才走 1 回合）；
//   minActions／untilChunks／maxActions：四人等效用，至少 minActions 個動作而且創出 untilChunks 塊才停，最多 maxActions；
//   scale：暫時改 PLAYER_COMPUTE_SCALE（查「四人等效」的另一種讀法用）
let stuckFixes = 0; // 機器人被村民夾住、等村民走開的次數
// 第三十版：士兵跟怪物照同一個時鐘，世界每走一回合（worldTurn）士兵就做一個動作（冒險者在那一回合倒下時不做）
const soldierCalls = { n: 0, world: 0 };
const soldierTurn0 = FE.AI.soldierTurn;
FE.AI.soldierTurn = (g) => { soldierCalls.n++; return soldierTurn0(g); };
const worldTurn0 = FE.AI.worldTurn;
FE.AI.worldTurn = (g) => { soldierCalls.world++; return worldTurn0(g); };
function simulate(seed, opts) {
  opts = opts || {};
  const lazy = !!opts.lazy;
  const scale0 = C.PLAYER_COMPUTE_SCALE;
  if (opts.scale != null) C.PLAYER_COMPUTE_SCALE = opts.scale;
  const game = new FE.Game(seed);
  // opts.cls：指定職業的模擬，起始裝備照 BOT_PICKS 挑；沒指定就是中性角色（對照組、只走路不打怪的那組）
  game.start(opts.cls ? { cls: opts.cls, picks: BOT_PICKS[opts.cls], body: BOT_BODY[opts.cls], skills: FE.Char.rollSkills(opts.cls, FE.Char.startMainSkill(opts.cls, BOT_PICKS[opts.cls]), FE.makeRng(seed + 77)) } : undefined);
  let overActs = 0; // 超過能背的重量（走一步 60 刻）的動作數
  let maxJobs = 0;  // 同時手上最多幾個委託（第三十版）
  let maxLoad = 0;
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
  soldierCalls.world = 0;
  let endCalls = 0;
  const end0 = game.endTurn.bind(game);
  game.endTurn = (a, b, c) => { endCalls++; return end0(a, b, c); };
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
        const J = p.jobs;
        // 採集：有礦鎬、礦石少於 4 顆（有採礦委託就挖到夠交，不超重），去挖最近的礦脈；有鐮刀、藥草少於 3 份（有採藥委託就割到夠交），割附近的藥草
        const dist = (o) => Math.abs(o.x - p.x) + Math.abs(o.y - p.y);
        const near = (kind, r) => w.nodes.filter((n) => n.kind === kind && game.nodeAt(n.x, n.y) === n && dist(n) < r).sort((a, b) => dist(a) - dist(b))[0];
        const oreWant = Math.max(4, J.ore ? J.ore.n : 0);
        const herbWant = Math.max(3, J.herb ? J.herb.n : 0);
        const ore = game.toolOf('pick') && game.bagCount('ore') < oreWant && game.loadTier() === 0 ? near('ore', 120) : null;
        const herb = !ore && game.toolOf('sickle') && game.bagCount('herb') < herbWant ? near('herb', J.herb ? 60 : 16) : null;
        // 去工匠那裡：裝備磨損到四成以下、有礦石可賣、缺工具、缺防具或盾牌而且錢夠（第三十版：錢用銅記帳，門檻照舊是 5、20、25 銀）
        const worn = FE.Gear.equipped(p).some((g) => g.dur < g.max * 0.4);
        const S_ = C.SILVER;
        const bowLow = p.equip.main && FE.GEAR[p.equip.main.type].ammo && game.bagCount(FE.GEAR[p.equip.main.type].ammo) < 10 && p.copper >= 5 * S_;
        const needShop = worn || bowLow || (game.bagCount('ore') >= 3 && !J.ore) || (p.copper >= 20 * S_ && (!game.toolOf('pick') || !game.toolOf('sickle'))) || (!game.botNoArmor && p.copper >= 25 * S_ && (!p.equip.body || (!p.equip.off && !FE.Gear.twoHanded(p, p.equip.main))));
        const shopkeeper = needShop && game.turn - (game.botShopAt === undefined ? -1e9 : game.botShopAt) > 120 ? w.npcs.filter((n) => FE.Gear.isShopkeeper(n) && dist(n) < 200).sort((a, b) => dist(a) - dist(b))[0] : null;
        // 交件：送貨的收貨人、清完的清除委託、湊夠了的採藥採礦委託的委託人
        const handTo = J.deliver && w.npcById(J.deliver.targetId) ? J.deliver.targetId
          : J.hunt && game.huntRemaining(J.hunt.monsterIds) === 0 && w.npcById(J.hunt.giverId) ? J.hunt.giverId
          : ['herb', 'ore'].map((k) => J[k] && game.bagCount(k) >= J[k].n && w.npcById(J[k].giverId) ? J[k].giverId : null).find(Boolean);
        if (handTo) target = { kind: 'npc', id: handTo };
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
    if (game.loadTier() >= 1) overActs++;
    maxJobs = Math.max(maxJobs, game.jobList().length);
    if (game.jobList().some((j) => !FE.JOB_KINDS.includes(j.kind) || p.jobs[j.kind] !== j)) fail(`模擬 seed${seed} 第${i}步 手上的委託放錯格子`);
    if (!(p.copper >= 0) || !Number.isInteger(p.copper)) fail(`模擬 seed${seed} 第${i}步 錢 ${p.copper} 不合法`);
    if (!((p.exhaust || 0) >= 0 && p.exhaust < C.EXHAUST_MAX)) fail(`模擬 seed${seed} 第${i}步 動作結束時力竭 ${p.exhaust}`);
    maxLoad = Math.max(maxLoad, game.weight() / game.carryLimit());
    const wl = FE.Stability.worldLevel(game);
    const rec = byWL[wl] || (byWL[wl] = { n: 0, s: [0, 0, 0], chaosAt: null });
    if (opts.cond === 'heavy' && p.equip.body) p.equip.body.dur = p.equip.body.max;
    // 裝備的狀態永遠合法：耐久在 1～上限之間、穿的位置對、重量算得出來
    for (const g of FE.Gear.equipped(p)) if (!(g.dur >= 1 && g.dur <= g.max)) fail(`模擬 seed${seed} 第${i}步 ${FE.Gear.name(g)} 耐久 ${g.dur}/${g.max}`);
    if ((p.equip.main && FE.GEAR[p.equip.main.type].cat !== 'weapon') || (p.equip.off && !['shield', 'weapon'].includes(FE.GEAR[p.equip.off.type].cat)) || (p.equip.body && FE.GEAR[p.equip.body.type].cat !== 'armor')) fail(`模擬 seed${seed} 第${i}步 裝備穿錯位置`);
    if (!Number.isFinite(game.weight())) fail(`模擬 seed${seed} 重量算不出來`);
    // 角色的狀態永遠合法：生命上限照公式、屬性不超過上限、沒分配的點數不是負的、技能等級 0～20 而且次數沒超過門檻
    if (p.maxHp !== FE.Char.maxHp(p, game.level) || p.hp > p.maxHp || p.hp < 1) fail(`模擬 seed${seed} 第${i}步 生命 ${p.hp}/${p.maxHp}，公式是 ${FE.Char.maxHp(p, game.level)}`);
    if (FE.ATTRS.some((a) => !(p.attr[a.key] >= 1 && p.attr[a.key] <= C.ATTR_CAP)) || !(p.points >= 0)) fail(`模擬 seed${seed} 第${i}步 屬性或點數不合法`);
    for (const k of Object.keys(FE.SKILLS)) {
      const s = p.skills[k];
      if (!(s.lv >= 0) || !(s.n >= 0) || s.n >= FE.Char.skillNeed(s.lv)) fail(`模擬 seed${seed} 第${i}步 技能 ${k} 狀態不合法 ${JSON.stringify(s)}`);
    }
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
  const syncCalls = soldierCalls.n; // 存檔讀回來的遊戲還會再玩幾步，先記下這個遊戲的士兵回合數與世界回合數
  const worldCalls = soldierCalls.world;
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
  // 士兵跟怪物照同一個時鐘（第三十版）：世界每走一回合，士兵就做一個動作（冒險者在那一回合倒下時不做）；每位士兵每回合只做一件事；
  // 世界回合數＝經過的刻÷10÷worldEvery（零頭與倒下時沒走完的回合不算）
  const st = FE.Stability.stat(game);
  if (syncCalls > worldCalls || worldCalls - syncCalls > deaths) fail(`模擬 seed${seed} 士兵回合 ${syncCalls} 次，世界回合 ${worldCalls} 次（倒下 ${deaths} 次）`);
  const clockTurns = game.ticks / C.TICKS_MOVE / (opts.worldEvery || 1);
  if (worldCalls > clockTurns + 1 || worldCalls < clockTurns - deaths - 2) fail(`模擬 seed${seed} 世界回合 ${worldCalls} 次，時鐘 ${game.ticks} 刻應該約 ${clockTurns.toFixed(1)} 次`);
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
    seed, cls: opts.cls || '中性', lazy, cond: opts.cond || null, worldEvery: opts.worldEvery || 1, actions: steps, chunks: game.world.chunks.length, worldLevel: FE.Stability.worldLevel(game),
    villages: game.world.villages.length, level: game.level, monsters: game.monsters.length,
    faults: game.reports.length - before, faultMsgs: game.reports.slice(0, 3).map((r) => r.message), steps: game.player.steps, deaths,
    indoorSteps: enteredHouse, stateShare: lv.map((n) => (n / steps).toFixed(2)).join('/'),
    firstUnrest: first[1], firstUnrestWL: firstWL[1], firstChaos: first[2], firstChaosWL: firstWL[2],
    perWorldLevel: perWL,
    bugTotal: `min${pct(0)} p50 ${pct(0.5)} p90 ${pct(0.9)} max${pct(1)}`, recur: st.recur, sabotage: st.sabotage,
    soldiers: `出動 ${st.sorties} 次、出手 ${st.soldierAttacks}、清掉 ${st.soldierKills} 隻、陣亡 ${st.soldierDeaths}、補回 ${st.refills}`,
    // 第三十版：時間與經濟
    days: +(game.ticks / C.DAY_TICKS).toFixed(1), longRests: st.longRests, restPaid: st.restPaid, shortRests: st.shortRests,
    econUp: st.econUp, econDown: st.econDown, exhaustMax: st.exhaustMax, jobs: Object.assign({}, st.jobs), jobsMax: maxJobs,
    econEnd: game.world.villages.map((v) => `${v.name}${FE.PROSPERITY[v.steading.prosperity]}${Math.round(FE.Steading.econ(v))}`).join(' '),
    money: game.player.copper,
    hp: `${game.player.maxHp}（Lv${game.level}）`,
    attr: FE.ATTRS.map((a) => `${a.name}${game.player.attr[a.key]}`).join(' '),
    skills: Object.keys(FE.SKILLS).map((k) => `${FE.SKILLS[k].name}${game.player.skills[k].lv}`).join(' '),
    char: `${FE.PLAYER_RACES[game.player.race].name}（體型 ${game.player.size}）Lv${game.level} 經驗值 ${game.exp}`,
    skillExp: Object.keys(FE.SKILLS).filter((k) => game.player.skills[k].lv > 0 || game.player.skills[k].n > 0).map((k) => { const s = game.player.skills[k]; let t = s.n; for (let l = 0; l < s.lv; l++) t += FE.Char.skillNeed(l); return `${FE.SKILLS[k].name}${Math.round(t)}`; }).join(' '),
    weapon: `${game.player.equip.main ? FE.Gear.name(game.player.equip.main) : '徒手'}（${game.attackText()}）${game.bagCount('arrow') ? `、箭矢 ${game.bagCount('arrow')}` : ''}`,
    armor: `${game.player.equip.body ? FE.Gear.name(game.player.equip.body) : '無'}／${game.player.equip.off ? FE.Gear.name(game.player.equip.off) : '無盾'}`,
    weight: `${game.weight()}/${game.carryLimit()}`,
    over: `超過能背 ${overActs} 個動作（${(100 * overActs / Math.max(1, steps)).toFixed(1)}%），最重時是能背的 ${(maxLoad * 100).toFixed(0)}%`,
    overActs,
    bag: game.bagList().map((e) => `${e.name}${e.n > 1 ? '×' + e.n : ''}`).join(' '),
  };
}

const SEEDS = (process.env.FE_SEEDS || '20201,777,314159').split(',').map(Number);
// 單人模擬與四人等效模擬：四個職業每個都跑（每個種子各一場）
// 四人等效：機器人每做 4 個動作，世界才走 1 回合（冒險者算力照常，已乘 PLAYER_COMPUTE_SCALE）
const MAX_ACTIONS = Number(process.env.FE_MAX || 8000);
// 四人等效：機器人每做 4 個動作世界才走 1 回合（四個人的清怪力），每個動作的算力不乘 4（四個人各出一份，一回合合計 4 份）
// 四人等效的模擬每次創世也跟舊的全世界檢查比對（這時的地形被侵蝕、修復、重算改過，驗證連通性快取有跟著更新）；
// 第二十九版起新舊比對只在一個種子上跑（第一個職業的第一個種子）
// 防具對照組：同樣的種子、同樣的動作數，一組不穿防具、一組穿重甲（都不拿盾牌），看冒險者平均每下受到多少傷害
const SIM_CMP_STEPS = Number(process.env.FE_CMP || 1500);

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
  ok(sv.kind === 'village' && g.talkOptions(smith).role.startsWith('鐵匠・') && ['人類', '矮人', '精靈'].some((r) => g.talkOptions(smith).role.endsWith(r)), `村莊的工匠是 ${g.talkOptions(smith).role}（第三十版起寫種族）`);
  ok(ids(smith) === 'buy/repair/craft/sellOre/sell/leave', `鐵匠的選項是 ${ids(smith)}`);
  g.player.copper = 0;
  pick(smith, 'buy');
  ok(g.talkPage === 'buy' && ids(smith) === 'cat:blade/cat:axe/cat:pole/cat:ranged/cat:armor/cat:tool/back', `買的分類是 ${ids(smith)}`);
  pick(smith, 'cat:blade');
  ok(ids(smith) === 'buyItem:sword:0/buyItem:shortsword:0/buyItem:dagger:0/back', `劍與刀的選項是 ${ids(smith)}`);
  pick(smith, 'back');
  pick(smith, 'cat:pole');
  ok(ids(smith) === 'buyItem:spear:0/buyItem:shortspear:0/buyItem:staff:0/back', `長柄與法杖的選項是 ${ids(smith)}`);
  pick(smith, 'back');
  pick(smith, 'cat:ranged');
  ok(ids(smith) === 'buyItem:bow:0/buyItem:arrow:0/back', `弓弩與彈藥的選項是 ${ids(smith)}`);
  pick(smith, 'back');
  pick(smith, 'cat:blade');
  const price = FE.Gear.shopPrice('sword', 0, sv);
  g.player.copper = price - 7;
  const o = g.talkOptions(smith).options[opt(smith, 'buyItem:sword:0')];
  ok(o.disabled && o.note === '還差 7 銅', `錢不夠的說明：${o.note}`);
  const bag0 = g.player.bag.length;
  ok(!pick(smith, 'buyItem:sword:0').close && g.talking === smith.id && g.player.bag.length === bag0 && g.player.copper === price - 7, '錢不夠時不該買到或關掉對話');
  g.player.copper = price + 5;
  const turn0 = g.turn;
  ok(!pick(smith, 'buyItem:sword:0').close && g.talking === smith.id && g.turn === turn0, '買完對話該還開著、不花動作');
  ok(g.player.copper === 5 && g.player.bag.some((e) => e.id === 'gear' && e.gear.type === 'sword' && e.gear.q === 0 && e.gear.dur === 200), `買到之後 金幣 ${g.player.copper}、背包 ${JSON.stringify(g.player.bag.map((e) => e.gear && e.gear.type))}`);
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
  ok(pick(b, 'decline').close && !b.quest.accepted && !g.player.jobs.deliver, '不接之後委託或手上的狀態不對');
  FE.Save.save(g);
  const back = FE.Save.load();
  const b2 = back && back.game && back.game.world.npcById(b.id);
  ok(!!b2 && b2.quest && !b2.quest.accepted, '不接的委託存檔讀不回來');
  bump(b);
  ok(ids(b) === 'accept/decline', '不接之後回來沒有再問一次');
  pick(b, 'accept');
  ok(b.quest.accepted && g.player.jobs.deliver && g.player.jobs.deliver.targetId === c.id, '接下後手上沒有委託');
  // 送貨的物品放進背包（委託資料照舊，手上不再記物品）
  const goods = g.goodsFor(g.player.jobs.deliver);
  ok(!!goods && goods.name === b.quest.item && goods.n === 1 && g.player.jobs.deliver.item === undefined, `接下送貨後背包裡沒有要送的東西（${JSON.stringify(g.player.bag)}）`);
  bump(b);
  ok(ids(b) === 'leave', `接下後再找委託人：${ids(b)}`);
  g.closeTalk();
  const third = vs[3];
  if (third) {
    // 第三十版：每種委託同時只能接一個；手上有送貨委託時，別人的送貨委託不能接
    third.quest = FE.makeQuest(g.world, g.rng, third, a);
    bump(third);
    ok(ids(third) === 'leave' && /已經有送貨委託/.test(g.talkOptions(third).text), `手上有送貨委託時別人的送貨委託：${ids(third)}「${g.talkOptions(third).text}」`);
    g.closeTalk();
  }
  c.quest = FE.makeQuest(g.world, g.rng, c, a); // 收貨人自己也有委託，貨照樣交得出去
  const gold0 = g.player.copper;
  const exp0 = g.exp;
  const car = g.player.jobs.deliver;
  bump(c);
  ok(ids(c) === 'deliver/leave', `收貨人的選項是 ${ids(c)}`);
  const pay0 = g.questPay(car, car.villageId);
  pick(c, 'deliver');
  ok(!g.player.jobs.deliver && b.quest.done && g.player.copper === gold0 + pay0 && g.exp === exp0 + car.exp, '交件後狀態不對');
  ok(!g.player.bag.some((e) => e.id === 'goods'), '交件後要送的東西還在背包裡');
  bump(c);
  ok(ids(c) === 'accept/decline', `交件後收貨人自己的委託：${ids(c)}`);
  g.closeTalk();

  // 清除委託：接下後小怪物沒清完只有「離開」，清完才能回報領獎勵
  const mon = g.monsters[0];
  if (mon) {
    a.quest = { kind: 'hunt', monsterIds: [mon.id], total: 1, village: '測試村', exp: 20, copper: 150, accepted: false, done: false };
    bump(a);
    ok(ids(a) === 'accept/decline', `清除委託的選項是 ${ids(a)}`);
    pick(a, 'accept');
    ok(g.player.jobs.hunt && g.player.jobs.hunt.kind === 'hunt', '接下清除委託後手上沒有委託');
    bump(a);
    ok(ids(a) === 'leave', `小怪物沒清完：${ids(a)}`);
    g.closeTalk();
    g.monsters = g.monsters.filter((m) => m !== mon);
    const gold1 = g.player.copper;
    const exp1 = g.exp;
    bump(a);
    ok(ids(a) === 'report/leave', `小怪物清完：${ids(a)}`);
    const pay1 = Math.round(150 * FE.Steading.questEcon(g.world.villageById(a.villageId)));
    pick(a, 'report');
    ok(a.quest.done && !g.player.jobs.hunt && g.player.copper === gold1 + pay1 && g.exp === exp1 + 20, `回報後狀態不對（錢 ${g.player.copper - gold1}，應該 ${pay1}：15 銀×經濟標籤倍率）`);
  }
  // 沒有開著的對話時，choose 不會拋例外
  g.talking = null;
  ok(g.choose(a, 99).close === false, '選不存在的選項該什麼都不做');
}
UNITS.dialogs = () => { try { testDialogs(); } catch (e) { fail('對話測試拋出例外：' + e.stack); } };

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
UNITS.creation = () => { try { testCreation(); } catch (e) { fail('創世門檻測試拋出例外：' + e.stack); } };

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
UNITS.worldlevel = () => { try { testWorldLevel(); } catch (e) { fail('世界等級測試拋出例外：' + e.stack); } };

// ---- 士兵：場景測試 ----
let soldierChecks = 0;
function testSoldiers() {
  const ok = (cond, msg) => { soldierChecks++; if (!cond) fail('士兵 ' + msg); };
  // 種子 5150 在第二十五版城鎮多蓋盔甲匠工坊、排版改變之後，3 位士兵出城會在 1 格寬的通道卡成一列（隊長被隊友擋在後面），
  // 這個場景測的是出城清怪，所以換用 5151（士兵卡住的情形留給第三十版重寫士兵時處理）
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
  // 等一個動作（10 刻，世界與士兵走一回合）；第三十版起休息是 1 小時以上，改用「閃避」
  const wait = () => { g.player.awakeAt = g.ticks; g.act('dodge'); };

  // 安穩：士兵在城鎮裡室外走動，不出城鎮
  for (let i = 0; i < 80; i++) wait();
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
    wait();
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
  for (; rounds < 300 && g.monsters.includes(fair) && mine().length; rounds++) wait();
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
  for (let i = 0; i < 200; i++) wait();
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
    ok(t.role === `士兵・${FE.PLAYER_RACES[s.race].name}` && t.options.length === 1 && t.options[0].id === 'leave' && t.text.length > 0, `士兵的對話內容不對：${t.role}／${t.options.map((o) => o.id)}`);
    g.choose(g.talkTarget(g.talking), 0);
    ok(g.talking === null, '離開沒有關掉士兵的對話');
  }
  C.STATE_CUTS = saved;
}
UNITS.soldiers = () => { try { testSoldiers(); } catch (e) { fail('士兵測試拋出例外：' + e.stack); } };

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
  const TP = C.TOOL_PRICE * C.SILVER; // 工具 20 銀＝200 銅（第三十版起用銅記帳）
  p.copper = TP - 1;
  ok(toolOpt('buyItem:pick:0') && toolOpt('buyItem:pick:0').disabled && toolOpt('buyItem:pick:0').note.includes('還差 1 銅') && toolOpt('buyItem:sickle:0').disabled, `錢不夠時買工具的選項：${JSON.stringify(toolOpt('buyItem:pick:0'))}`);
  toolPick('buyItem:pick:0');
  ok(!g.toolOf('pick') && p.copper === TP - 1, '錢不夠還是買到了礦鎬');
  p.copper = TP * 2 + 5;
  toolPick('buyItem:pick:0');
  ok(!!g.toolOf('pick') && g.toolOf('pick').dur === 50 && p.copper === TP + 5 && toolIds().includes('buyItem:pick:0') && toolIds().includes('buyItem:sickle:0'), `買礦鎬之後 ${toolIds()}，錢 ${p.copper}（買過的工具選項該還在）`);
  toolPick('buyItem:sickle:0');
  ok(!!g.toolOf('sickle') && p.copper === 5 && toolIds().includes('buyItem:sickle:0'), `買鐮刀之後 ${toolIds()}，錢 ${p.copper}`);
  // 工具可以重複買，每一把各自有耐久；採集用耐久最低的那一把，壞了換下一把
  p.copper = 1000;
  toolPick('buyItem:pick:0');
  g.talkPage = 'main';
  const picks = () => p.bag.filter((e) => e.id === 'gear' && e.gear.type === 'pick').map((e) => e.gear);
  ok(picks().length === 2 && p.copper === 1000 - TP, `礦鎬該有 2 把（${picks().length}）`);
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
UNITS.backpack = () => { try { testBackpack(); } catch (e) { fail('背包測試拋出例外：' + e.stack); } };

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
    const phys = { heavy: [3, 4, 4, 5, 5, 6, 9], medium: [2, 2, 3, 3, 4, 4, 6], light: [0, 0, 0, 0, 0, 0, 0], robe: [0, 0, 0, 0, 0, 0, 0] };
    const shield = [4, 5, 6, 6, 7, 8, 12];
    ok(Q.length === 7 && Q.map((q) => q.name).join('') === '普通做工好精良優秀卓越傑作傳說物' && Q.map((q) => q.sym).join('|') === '|-|+|*|≡|☼|', `品質的名字或符號 ${Q.map((q) => q.sym + q.name)}`);
    for (let i = 0; i <= 6; i++) {
      ok(Q[i].value === mult[i] && Q[i].hit === hit[i] && near(Q[i].pierce, pierce[i]) && near(Q[i].armor, armorMult[i]) && Q[i].clear === i, `品質 ${i} 的數值 ${JSON.stringify(Q[i])}`);
      ok(G.shopPrice('sword', i, plain) === swordPrice[i] * C.SILVER, `長劍品質 ${i} 的價錢 ${G.shopPrice('sword', i, plain)} 銅（應該 ${swordPrice[i]} 銀）`);
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
    // 第三十版：價錢的數字是銀，算出來是銅（乘 10 之後才四捨五入）
    ok(G.shopPrice('sword', 0, poorMarket) === Math.round(300 * 1.6 * 0.9) && G.shopPrice('heavy', 1, poorMarket) === Math.round(870 * 1.1 * 1.6 * 0.9), `荒蕪有市場的價錢 ${G.shopPrice('sword', 0, poorMarket)}`);
    ok(G.shopPrice('pick', 0, poorMarket) === 200 && G.shopPrice('sickle', 0, plain) === 200, '礦鎬、鐮刀該固定 20 銀（200 銅）');
    ok(FE.money(0) === '0 銅' && FE.money(352) === '3 金 5 銀 2 銅' && FE.money(1005) === '10 金 5 銅' && FE.money(70) === '7 銀', `錢的寫法 ${FE.money(352)}／${FE.money(1005)}／${FE.money(70)}`);
    // 資料：武器、防具、盾牌、重量、價錢
    const W = FE.GEAR;
    // 第二十八版：武器的傷害骰、傷害種類、特質、精通、重量、價錢
    const wd = (t) => [W[t].die.join('d'), W[t].type, W[t].mastery, W[t].weight, W[t].price].join('/');
    // 第二十九版：重量改磅數；沒有近戰武器有「雙手」標籤（弓、輕弩射擊才一律雙手）
    ok(wd('sword') === '1d8/slash/sap/3/30' && W.sword.versatile === 10 && !W.sword.twoHand && W.sword.skill === 'sword' && W.sword.grip.join() === '52500,57500', `長劍 ${wd('sword')}`);
    ok(wd('spear') === '1d10/pierce/push/18/25' && W.spear.heavy && W.spear.reach && !W.spear.twoHand && !W.spear.versatile && W.spear.skill === 'spear' && W.spear.grip.join() === '62500,77500', `長槍 ${wd('spear')}`);
    ok(wd('shortspear') === '1d6/pierce/sap/3/20' && W.shortspear.versatile === 8 && W.shortspear.thrown.join() === '4,12' && W.shortspear.ore === 3 && W.shortspear.dur === 200 && W.shortspear.sold && W.shortspear.drop && W.shortspear.skill === 'spear' && W.shortspear.grip.join() === '5000,47500', `短矛 ${wd('shortspear')}`);
    ok(wd('dagger') === '1d4/pierce/nick/1/15' && W.dagger.finesse && W.dagger.light && W.dagger.thrown.join() === '4,12' && W.dagger.skill === 'knife' && W.dagger.grip.join() === '5000,27500', `短刀 ${wd('dagger')}`);
    ok(wd('bow') === '1d6/pierce/vex/2/30' && W.bow.ammo === 'arrow' && W.bow.range.join() === '5,20' && W.bow.twoHand && W.bow.sold && W.bow.drop && !W.bow.ore && W.bow.skill === 'bow' && W.bow.meleeSkill === 'sword' && W.bow.grip.join() === '15000,0', `弓箭 ${wd('bow')}`);
    ok(wd('staff') === '1d6/blunt/topple/4/30' && W.staff.versatile === 8 && W.staff.sold && W.staff.drop && !W.staff.ore && W.staff.skill === 'staff' && W.staff.grip.join() === '5000,47500', `法杖 ${wd('staff')}`);
    // 擴充武器第一批（價格、打造、重量、特質、精通、技能、體型門檻）
    const nw = (t) => [W[t].die.join('d'), W[t].type, W[t].mastery, W[t].skill, W[t].weight, W[t].price, W[t].ore || 0, W[t].grip.join('-')].join('/');
    ok(nw('shortsword') === '1d6/pierce/vex/sword/2/20/3/32500-37500' && W.shortsword.finesse && W.shortsword.light && W.shortsword.sold && W.shortsword.drop, `短劍 ${nw('shortsword')}`);
    ok(nw('waraxe') === '1d8/slash/topple/axe/4/25/3/42500-47500' && W.waraxe.versatile === 10, `戰斧 ${nw('waraxe')}`);
    ok(nw('greataxe') === '1d12/slash/cleave/axe/7/45/5/62500-77500' && W.greataxe.heavy, `巨斧 ${nw('greataxe')}`);
    ok(nw('greatsword') === '2d6/slash/graze/sword/6/50/5/62500-77500' && W.greatsword.heavy, `巨劍 ${nw('greatsword')}`);
    ok(nw('club') === '1d6/blunt/sap/mace/4/15/3/32500-37500', `硬頭錘 ${nw('club')}`);
    ok(nw('warhammer') === '1d8/blunt/push/mace/5/30/3/32500-37500' && W.warhammer.versatile === 10, `戰錘 ${nw('warhammer')}`);
    ok(nw('whip') === '1d4/slash/slow/whip/3/10/0/22500-27500' && W.whip.finesse && W.whip.reach && !W.whip.ore, `鞭子 ${nw('whip')}`);
    ok(nw('crossbow') === '1d8/pierce/slow/crossbow/5/35/0/15000-0' && W.crossbow.ammo === 'bolt' && W.crossbow.range.join() === '5,20' && W.crossbow.loading && W.crossbow.twoHand && W.crossbow.meleeSkill === 'mace' && !W.crossbow.ore, `輕弩 ${nw('crossbow')}`);
    ok(Object.values(W).filter((d) => d.cat === 'weapon' && d.twoHand).length === 2 && Object.values(W).every((d) => d.cat !== 'weapon' || (d.sold && d.drop)), '只有弓和輕弩有雙手標籤；所有武器都販售、都會掉落');
    ok(FE.BAG_ITEMS.arrow.bundle === 20 && FE.BAG_ITEMS.arrow.weight === 1 && W.arrow.cat === 'ammo' && W.arrow.price === 5 && W.arrow.bundle === 20 && W.arrow.sold && W.arrow.drop, '箭矢資料不對');
    ok(FE.BAG_ITEMS.bolt.bundle === 20 && FE.BAG_ITEMS.bolt.weight === 1.5 && W.bolt.cat === 'ammo' && W.bolt.price === 5 && W.bolt.bundle === 20 && W.bolt.sold && W.bolt.drop, '弩矢資料不對（一捆 20 支、1.5 磅、價格 5）');
    // 第二十九版追加：防具換成十二件（類別、物理／魔法減傷、力量需求、重量、價格、隱匿劣勢）
    const arm = (t) => [W[t].cls, W[t].phys, W[t].magic, W[t].str || 0, W[t].weight, W[t].price, !!W[t].stealth, W[t].ticks].join('/');
    const wantArm = {
      padded: 'light/0/1/0/8/22/true/0', light: 'light/0/1/0/10/32/false/0', studded: 'light/1/1/0/13/67/false/0',
      hide: 'medium/1/2/0/12/32/false/1', chainshirt: 'medium/1/2/0/20/71/false/1', medium: 'medium/2/2/0/45/71/true/1', breastplate: 'medium/2/2/0/20/200/false/1', halfplate: 'medium/2/2/0/40/274/true/1',
      ringmail: 'heavy/2/1/0/40/55/true/2', heavy: 'heavy/3/1/13/50/87/true/2', splint: 'heavy/3/1/15/55/141/true/2', plate: 'heavy/4/1/15/60/387/true/2',
    };
    ok(Object.entries(wantArm).every(([t, s]) => arm(t) === s), `防具的數字：${Object.keys(wantArm).filter((t) => arm(t) !== wantArm[t]).map((t) => t + ' ' + arm(t))}`);
    ok(W.heavy.name === '鎖子甲' && W.medium.name === '鱗甲' && W.light.name === '皮甲' && W.padded.name === '布甲' && W.studded.name === '鑲釘皮甲' && W.hide.name === '厚皮甲' && W.chainshirt.name === '鎖子襯衫' && W.breastplate.name === '胸甲' && W.halfplate.name === '半身板甲' && W.ringmail.name === '環甲' && W.splint.name === '條板甲' && W.plate.name === '全身板甲', '防具的名字（舊的輕甲→皮甲、中甲→鱗甲、重甲→鎖子甲）');
    ok(Object.values(W).filter((d) => d.cat === 'armor' && d.desc).length === 12 && Object.values(W).every((d) => d.cat !== 'armor' || d.dodge === undefined), '十二件防具都有一句說明，舊的 dodge 欄拿掉了');
    ok(W.robe.phys === 0 && W.robe.magic === 1 && W.robe.weight === 4 && W.robe.price === 10 && W.mrobe.phys === 0 && W.mrobe.magic === 3 && W.mrobe.sold === false, '衣袍的數字');
    ok(W.shield.block === 0.25 && W.shield.value === 4 && W.shield.weight === 6 && W.shield.price === 32, '盾牌的數字');
    ok(W.sword.dur === 200 && W.shield.dur === 100 && W.heavy.dur === 150 && W.pick.dur === 50 && W.sickle.dur === 50 && W.pick.weight === 10 && W.sickle.weight === 2, '耐久或工具重量不對');
    ok(FE.BAG_ITEMS.ore.weight === 10 && FE.BAG_ITEMS.herb.weight === 0.5 && FE.BAG_ITEMS.goods.weight === 5 && g.carryLimit() === 150 && g.pushLimit() === 300 && C.ORE_PRICE === 5, '礦石、藥草、送貨物品的重量或中性角色的負重上限不對（力量 10：能背 150、推拖 300 磅）');
    ok(W.robe.weight === 4 && W.mrobe.weight === 4 && W.shield.weight === 6 && W.sword.weight === 3 && W.spear.weight === 18 && W.shortspear.weight === 3 && W.dagger.weight === 1 && W.bow.weight === 2 && W.staff.weight === 4 && W.arrow.weight === 1, '裝備的重量（磅）不對');
    // 起始：普通長劍、沒有防具、沒有副手
    const g2 = newGame(12);
    const q = g2.player;
    ok(q.equip.main && q.equip.main.type === 'sword' && q.equip.main.q === 0 && !q.equip.off && !q.equip.body && g2.attackText() === '1d10 揮砍' && G.name(q.equip.main) === '長劍', `起始裝備不是普通長劍（${g2.attackText()}）`);
    ok(G.playerDefense(q).block === 0 && G.playerDefense(q).blockMax === 0 && near(G.playerDefense(q).dodge, 0.1), '沒拿盾牌時格擋機率該是 0');
    ok(G.name(G.make('sword', 1, 1)) === '-做工好-長劍' && G.name(G.make('heavy', 5, 1)) === '☼傑作☼鎖子甲' && G.name(G.make('light', 3, 1)) === '*優秀*皮甲' && G.name(G.make('medium', 4, 1)) === '≡卓越≡鱗甲' && G.name(G.make('shield', 2, 1)) === '+精良+盾牌', '裝備名字的品質符號');
    // 盾牌與重甲的其他數字
    q.equip.body = G.make('heavy', 0, 99);
    ok(near(G.playerDefense(q).dodge, 0.1) && G.extraTicks(q) === 2, '重甲每個動作多 2 刻（閃避不再另外扣 5%）');
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
    ok(p.equip.main === null && g.attackText() === `${C.BARE_DMG} 鈍擊` && g.log[0].text.includes('壞掉'), '穿著的劍耐久到 0 沒有消失');
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
    g.econ = () => {}; // 這一段只測價錢：在聚落花錢不改經濟值（經濟值的升降在 testEconomy30 測）
    const smith = w.npcs.find((n) => n.villageId === vil.id && n.role === 'smith');
    const wsmith = w.npcs.find((n) => n.villageId === town.id && n.role === 'smith');
    const armorer = w.npcs.find((n) => n.villageId === town.id && n.role === 'armorer');
    ok(!!smith && !!wsmith && !!armorer && !w.npcs.some((n) => n.villageId === vil.id && n.role === 'armorer'), '村莊該只有鐵匠，城鎮有武器匠和盔甲匠');
    const role = (n) => { g.talking = n.id; g.talkPage = 'main'; return g.talkOptions(n).role.split('・')[0]; }; // 第三十版起身分後面寫種族
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
    // 第二十九版：村莊鐵匠加短劍、戰斧、硬頭錘、戰錘；城鎮武器匠再加巨斧、巨劍、鞭子、輕弩和弩矢
    const WEAPONS_V = ['sword', 'spear', 'shortspear', 'dagger', 'bow', 'staff', 'arrow', 'shortsword', 'waraxe', 'club', 'warhammer'];
    const WEAPONS = WEAPONS_V.concat(['greataxe', 'greatsword', 'whip', 'crossbow', 'bolt']);
    ok(WEAPONS_V.concat(['padded', 'light', 'hide', 'chainshirt', 'ringmail', 'robe', 'shield', 'pick', 'sickle']).every((t) => has(sSmith, t, 0)) && sSmith.length === 20 && !has(sSmith, 'heavy', 0) && !has(sSmith, 'medium', 0) && !has(sSmith, 'greataxe', 0) && !has(sSmith, 'whip', 0) && !has(sSmith, 'crossbow', 0), `鐵匠賣的東西 ${sSmith}`);
    ok(WEAPONS.every((t) => has(sW, t, 0) && has(sW, t, 1)) && has(sW, 'pick', 0) && has(sW, 'sickle', 0) && sW.length === 34, `武器匠賣的東西 ${sW}`);
    ok(['padded', 'light', 'studded', 'hide', 'chainshirt', 'medium', 'breastplate', 'halfplate', 'ringmail', 'heavy', 'splint', 'plate', 'robe', 'shield'].every((t) => has(sA, t, 0) && has(sA, t, 1)) && sA.length === 28, `盔甲匠賣的東西 ${sA}`);
    ok(![...sSmith, ...sW, ...sA].some((id) => /:(mrobe):/.test(id)), '商店不該賣魔法衣袍');
    ok(![...sSmith, ...sW, ...sA].some((id) => /:[3-6]$/.test(id) || /:[2]$/.test(id)), '商店只賣普通與做工好');
    // 買：價錢＝原價×品質×經濟，扣金幣、東西進背包、不花動作
    p.bag = [];
    p.copper = 100000;
    const buy = (n, t, q) => { const g0 = p.copper, t0 = g.turn; const r = shopDo(g, n, `buyItem:${t}:${q}`); return { r, spent: g0 - p.copper, turns: g.turn - t0 }; };
    // 第三十版：錢用銅記帳（價錢數字是銀，乘 10）；在聚落花錢會讓經濟值上升，所以先記下買之前的價錢倍率
    let eT = econ(town);
    let b = buy(wsmith, 'sword', 1);
    ok(b.r && b.spent === Math.round(300 * 1.1 * eT) && b.turns === 0 && p.bag.some((e) => e.id === 'gear' && e.gear.type === 'sword' && e.gear.q === 1), `武器匠買做工好長劍 花了 ${b.spent}，應該 ${Math.round(300 * 1.1 * eT)}`);
    eT = econ(town);
    b = buy(armorer, 'shield', 1);
    ok(b.r && b.spent === Math.round(320 * 1.1 * eT), `盔甲匠買做工好盾牌 花了 ${b.spent}`);
    const eV = econ(vil);
    b = buy(smith, 'ringmail', 0);
    ok(b.r && b.spent === Math.round(550 * eV), `鐵匠買環甲 花了 ${b.spent}，應該 ${Math.round(550 * eV)}`);
    ok(!buy(smith, 'heavy', 0).r && !buy(smith, 'plate', 0).r, '村莊鐵匠不賣鎖子甲、全身板甲');
    ok(!buy(smith, 'sword', 1).r && !buy(wsmith, 'heavy', 0).r && !buy(armorer, 'sword', 0).r && !buy(wsmith, 'shield', 0).r, '店裡不賣的東西買到了（鐵匠做工好、武器匠賣防具、盔甲匠賣武器）');
    b = buy(smith, 'pick', 0);
    ok(b.r && b.spent === 200 && buy(smith, 'pick', 0).r && p.bag.filter((e) => e.id === 'gear' && e.gear.type === 'pick').length === 2, `礦鎬 20 銀、已有的還能再買（花了 ${b.spent}）`);
    // 錢不夠：選項寫還差多少
    p.copper = Math.round(550 * econ(vil)) - 9;
    open(smith);
    g.choose(smith, g.talkOptions(smith).options.findIndex((o) => o.id === 'buy'));
    g.choose(smith, g.talkOptions(smith).options.findIndex((o) => o.id === 'cat:armor'));
    const heavyOpt = g.talkOptions(smith).options.find((o) => o.id === 'buyItem:ringmail:0');
    ok(heavyOpt.disabled && heavyOpt.note === '還差 9 銅', `買環甲錢不夠的說明：${heavyOpt.note}`);

    // 賣礦石：一顆 5 銀
    p.bag = [];
    g.bagAdd('ore', 7);
    p.copper = 0;
    ok(shopDo(g, smith, 'sellOre') && p.copper === 350 && g.bagCount('ore') === 0, `賣 7 顆礦石 得到 ${p.copper} 銅`);
    // 賣裝備：半價×剩餘耐久比例；鐵匠收所有的，武器匠只收武器，盔甲匠只收防具與盾牌
    const gs = G.make('sword', 2, g.nextGearId++); gs.dur = 50;
    const ga = G.make('medium', 3, g.nextGearId++); ga.dur = 75;
    const gh = G.make('shield', 0, g.nextGearId++);
    for (const x of [gs, ga, gh]) g.bagAddGear(x);
    ok(G.sellPrice(gs) === Math.round(300 * 1.2 * 0.5 * (50 / 200)) && G.sellPrice(ga) === Math.round(710 * 1.333 * 0.5 * 0.5) && G.sellPrice(gh) === Math.round(320 * 0.5), `賣回價 ${G.sellPrice(gs)}／${G.sellPrice(ga)}／${G.sellPrice(gh)}`);
    ok(!shopDo(g, wsmith, `sellItem:${ga.id}`) && !shopDo(g, wsmith, `sellItem:${gh.id}`) && !shopDo(g, armorer, `sellItem:${gs.id}`), '武器匠收了防具、盔甲匠收了武器');
    p.copper = 0;
    ok(shopDo(g, wsmith, `sellItem:${gs.id}`) && p.copper === G.sellPrice(gs) && !p.bag.some((e) => e.gear === gs), '武器匠沒有收武器');
    p.copper = 0;
    ok(shopDo(g, armorer, `sellItem:${ga.id}`) && shopDo(g, armorer, `sellItem:${gh.id}`) && p.copper === G.sellPrice(ga) + G.sellPrice(gh), '盔甲匠沒有收防具與盾牌');
    p.equip.main.dur = 200;
    open(smith);
    ok(!g.talkOptions(smith).options.some((o) => o.id === `sellItem:${p.equip.main.id}`), '穿在身上的不該能賣');

    // 修復：村莊鐵匠一次修回損失的一半、城鎮的武器匠與盔甲匠修到完整，各修自己那一類（盾牌歸盔甲匠）
    const fee = (item, restore, v, tool) => Math.max(1, Math.round((restore / item.max) * G.value(item) * C.SILVER * 1 * (tool ? 1 : econ(v))));
    p.copper = 100000;
    p.bag = [];
    const sw1 = p.equip.main; sw1.dur = 100;
    let g0 = p.copper;
    ok(shopDo(g, smith, `repairItem:${sw1.id}`) && sw1.dur === 200 && g0 - p.copper === fee(sw1, 100, vil), `鐵匠修長劍到完整：耐久 ${sw1.dur}（應該 200）、花了 ${g0 - p.copper}（應該 ${fee(sw1, 100, vil)}）`);
    p.equip.off = G.make('shield', 1, g.nextGearId++); p.equip.off.dur = 20;
    p.equip.body = G.make('heavy', 0, g.nextGearId++); p.equip.body.dur = 10;
    const tl = G.make('pick', 0, g.nextGearId++); tl.dur = 10; g.bagAddGear(tl);
    g0 = p.copper;
    ok(shopDo(g, smith, `repairItem:${p.equip.off.id}`) && p.equip.off.dur === 100 && g0 - p.copper === fee(p.equip.off, 80, vil), `鐵匠修盾牌到完整：耐久 ${p.equip.off.dur}（應該 100）`);
    g0 = p.copper;
    ok(shopDo(g, smith, `repairItem:${p.equip.body.id}`) && p.equip.body.dur === 150, `鐵匠修重甲到完整：耐久 ${p.equip.body.dur}`);
    ok(shopDo(g, smith, `repairItem:${tl.id}`) && tl.dur === 50 && g0 - p.copper >= fee(tl, 40, vil, true), `鐵匠修礦鎬到完整：耐久 ${tl.dur}（應該 50）`);
    // 接下來測城鎮的工匠，把耐久再磨掉
    sw1.dur = 100; p.equip.off.dur = 20; p.equip.body.dur = 10; tl.dur = 10;
    // 城鎮：武器匠（武器、工具）修到完整，看不到盾牌與防具；盔甲匠相反
    const optIds = (n, page) => { open(n); g.talkPage = page; return g.talkOptions(n).options.map((o) => o.id); };
    const wr = optIds(wsmith, 'repair');
    const ar = optIds(armorer, 'repair');
    ok(wr.includes(`repairItem:${sw1.id}`) && wr.includes(`repairItem:${tl.id}`) && !wr.includes(`repairItem:${p.equip.off.id}`) && !wr.includes(`repairItem:${p.equip.body.id}`), `武器匠的修復選項 ${wr}`);
    ok(ar.includes(`repairItem:${p.equip.off.id}`) && ar.includes(`repairItem:${p.equip.body.id}`) && !ar.includes(`repairItem:${sw1.id}`) && !ar.includes(`repairItem:${tl.id}`), `盔甲匠的修復選項 ${ar}`);
    g0 = p.copper;
    ok(shopDo(g, wsmith, `repairItem:${sw1.id}`) && sw1.dur === 200 && g0 - p.copper === fee(sw1, 100, town), `武器匠修長劍到完整：耐久 ${sw1.dur}`);
    ok(!shopDo(g, wsmith, `repairItem:${p.equip.off.id}`), '武器匠修了盾牌');
    g0 = p.copper;
    const sh0 = p.equip.off;
    ok(shopDo(g, armorer, `repairItem:${sh0.id}`) && sh0.dur === 100 && g0 - p.copper === fee(sh0, 80, town), `盔甲匠修盾牌到完整：耐久 ${sh0.dur}`);
    ok(shopDo(g, armorer, `repairItem:${p.equip.body.id}`) && p.equip.body.dur === 150, `盔甲匠修重甲到完整：耐久 ${p.equip.body.dur}`);
    // 費用至少 1 銅：只差 1 點耐久（長劍原價 30 銀＝300 銅，修 1/200 是 1.5 銅×經濟倍率）
    sw1.dur = 199;
    g0 = p.copper;
    const fee1 = fee(sw1, 1, town);
    ok(shopDo(g, wsmith, `repairItem:${sw1.id}`) && g0 - p.copper === fee1 && fee1 >= 1 && sw1.dur === 200, `只差 1 點耐久的修復費該是 ${fee1} 銅，量到 ${g0 - p.copper}`);
    // 錢不夠：寫還差多少
    sw1.dur = 100;
    p.copper = 2;
    const ro = (open(wsmith), g.talkPage = 'repair', g.talkOptions(wsmith).options.find((o) => o.id === `repairItem:${sw1.id}`));
    ok(ro.disabled && /^耐久 100 \/ 200，還差 (\d+ 金 )?(\d+ 銀 )?\d+ 銅$|^耐久 100 \/ 200，還差 (\d+ 金 ?)?(\d+ 銀)?$/.test(ro.note), `修復錢不夠的說明：${ro.note}`);
    g.talkPage = 'main';

    // 打造：村莊鐵匠什麼都能打（衣袍除外），城鎮武器匠只打武器、盔甲匠只打防具與盾牌
    // 第二十九版：打造也分類（劍與刀、斧與錘、長柄與法杖、防具與盾牌），一層最多 8 項；只有一類時直接列
    const craftIds = (n) => {
      const top = optIds(n, 'craft');
      const cats = top.filter((i) => i.startsWith('craftCat:'));
      if (!cats.length) return top.filter((i) => i.startsWith('craftItem:')).map((i) => i.slice(10)).sort().join(',');
      return cats.flatMap((c) => optIds(n, 'craft:' + c.slice(9)).filter((i) => i.startsWith('craftItem:')).map((i) => i.slice(10))).sort().join(',');
    };
    const sorted = (s) => s.split(',').sort().join(',');
    ok(craftIds(smith) === sorted('sword,spear,shortspear,dagger,shortsword,waraxe,club,warhammer,padded,light,hide,chainshirt,ringmail,shield') && craftIds(wsmith) === sorted('sword,spear,shortspear,dagger,shortsword,waraxe,club,warhammer,greataxe,greatsword') && craftIds(armorer) === sorted('padded,light,studded,hide,chainshirt,medium,breastplate,halfplate,ringmail,heavy,splint,plate,shield'), `可打造 ${craftIds(smith)}／${craftIds(wsmith)}／${craftIds(armorer)}`);
    ok(optIds(smith, 'craft').join() === 'craftCat:blade,craftCat:pole,craftCat:axe,craftCat:armor,back' && optIds(wsmith, 'craft').join() === 'craftCat:blade,craftCat:pole,craftCat:axe,back' && optIds(armorer, 'craft').join() === 'craftCat:armorL,craftCat:armorM,craftCat:armorH,craftCat:shieldC,back', `打造的分類 ${optIds(smith, 'craft')}／${optIds(wsmith, 'craft')}／${optIds(armorer, 'craft')}`);
    ok([smith, wsmith, armorer].every((n) => { const cats = optIds(n, 'craft').filter((i) => i.startsWith('craftCat:')); return optIds(n, 'craft').length <= 9 && cats.every((c) => optIds(n, 'craft:' + c.slice(9)).length <= 9); }), '打造每一層該最多 9 個選項（按得到）');
    const need = { sword: 3, spear: 3, shortspear: 3, dagger: 3, heavy: 5, medium: 4, light: 2, shield: 2, shortsword: 3, waraxe: 3, club: 3, warhammer: 3, greataxe: 5, greatsword: 5, padded: 2, studded: 3, hide: 3, chainshirt: 4, breastplate: 5, halfplate: 5, ringmail: 5, splint: 6, plate: 7 };
    for (const [t, n] of Object.entries(need)) {
      const cq = G.craftQuote(t, vil);
      ok(cq.ore === n && cq.fee === Math.round(FE.GEAR[t].price * C.SILVER * 0.5 * econ(vil)), `${t} 打造要 ${cq.ore} 顆礦石＋${cq.fee}（應該 ${n} 顆＋${Math.round(FE.GEAR[t].price * C.SILVER * 0.5 * econ(vil))}）`);
    }
    // 礦石或金幣不夠：寫還差多少，不能打
    p.bag = [];
    g.bagAdd('ore', 4);
    p.copper = G.craftQuote('heavy', town).fee - 2;
    open(armorer); g.talkPage = 'craft:armorH';
    const co = g.talkOptions(armorer).options.find((o) => o.id === 'craftItem:heavy');
    ok(co.disabled && co.note === '還差 2 銅、1 顆礦石', `打造鎖子甲錢和礦石都不夠的說明：${co.note}`);
    ok(!shopDo(g, armorer, 'craftItem:heavy') && g.bagCount('ore') === 4, '不夠還是打造了');
    // 打造的品質範圍：村莊普通～精良（每高一級機率減半），城鎮做工好～優秀
    const crafted = (n, v, type, runs) => {
      const hist = {};
      for (let i = 0; i < runs; i++) {
        p.bag = [];
        g.bagAdd('ore', need[type]);
        p.copper = 100000;
        const gold0 = p.copper;
        if (!shopDo(g, n, `craftItem:${type}`)) { fail('裝備 打造沒成功'); return hist; }
        const e = p.bag.find((x) => x.id === 'gear');
        hist[e.gear.q] = (hist[e.gear.q] || 0) + 1;
        if (i === 0) ok(g.bagCount('ore') === 0 && gold0 - p.copper === G.craftQuote(type, v).fee && e.gear.type === type && e.gear.dur === e.gear.max, `打造後礦石 ${g.bagCount('ore')}、工錢 ${gold0 - p.copper}`);
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

  // 6. 負重（第二十九版，《D&D》2024 的磅數）：能背＝力量值×15 磅，推拖上限＝力量值×30 磅，範圍內沒有減值；
  //    超過能背：移動一步 60 刻；超過推拖上限：不能移動、不能撤退（還能丟東西、出手）；拿掉原本兩段超重的出手減值與多花的刻
  {
    const g = newGame(16);
    const p = g.player;
    p.bag = [];
    // 起始長劍 3 磅（中性角色力量 10：能背 150、推拖上限 300）；礦石每顆 10 磅、藥草每份 0.5 磅，湊出指定的總重
    const setOre = (w) => {
      p.bag = [];
      const rest = w - 3;
      const ore = Math.floor(rest / 10);
      g.bagAdd('ore', ore);
      const herb = Math.round((rest - ore * 10) / 0.5);
      if (herb) g.bagAdd('herb', herb);
      return g.weight();
    };
    ok(g.carryLimit() === 150 && g.pushLimit() === 300, `中性角色能背 ${g.carryLimit()}、推拖上限 ${g.pushLimit()}（應該 150、300）`);
    ok(setOre(150) === 150 && g.loadTier() === 0, `剛好能背不算超重（${g.weight()}）`);
    ok(setOre(150.5) === 150.5 && g.loadTier() === 1, `超過能背 0.5：tier ${g.loadTier()}`);
    ok(setOre(300) === 300 && g.loadTier() === 1, `剛好推拖上限還是第一段：tier ${g.loadTier()}`);
    ok(setOre(300.5) === 300.5 && g.loadTier() === 2, `超過推拖上限 0.5：tier ${g.loadTier()}`);
    // 範圍內（含第一段、第二段）沒有出手減值、不多花刻
    ok([100, 150, 200, 300, 350].every((w) => { setOre(w); return G.hitMod(p) === 0 && G.extraTicks(p) === 0; }), '超重不該再有出手減值或每個動作多花的刻');
    // 藥草 0.5 一份；浮點誤差不該讓剛好上限變成超重
    p.bag = [];
    g.bagAdd('ore', 14);
    g.bagAdd('herb', 14);
    ok(g.weight() === 150 && g.loadTier() === 0, `礦石 14＋藥草 14 共 3＋140＋7＝${g.weight()}`);
    // 第一段：走一步 60 刻（其他動作照常 10 刻）
    setOre(160);
    const side = DIRS.find(([dx, dy]) => g.world.canStep(p.x, p.y, p.x + dx, p.y + dy) && !g.world.npcAt(p.x + dx, p.y + dy) && !g.nodeAt(p.x + dx, p.y + dy));
    const t0 = g.ticks, x0 = p.x, y0 = p.y;
    g.move(side[0], side[1]);
    ok(g.ticks - t0 === 60 && (p.x !== x0 || p.y !== y0), `超過能背走一步花 ${g.ticks - t0} 刻（應該 60）`);
    const t1 = g.ticks;
    g.act('dodge'); // 第三十版起休息是 1 小時或 8 小時，改用「閃避」當作一般的動作
    ok(g.ticks - t1 === 10, `超過能背其他動作還是 ${g.ticks - t1} 刻（應該 10）`);
    p.equip.main = G.make('sword', 3, g.nextGearId++);
    ok(G.hitMod(p) === 3, `超重第一段、優秀劍的出手加減 ${G.hitMod(p)}（應該 +3，沒有減值）`);
    p.equip.main = G.make('sword', 0, g.nextGearId++);
    // 第二段：不能移動、不能撤退；可以丟東西、可以打；丟掉就能動
    setOre(310);
    const px = p.x, py = p.y, turn0 = g.turn, tk0 = g.ticks;
    g.move(-side[0], -side[1]);
    ok(p.x === px && p.y === py && g.turn === turn0 && g.ticks === tk0 && g.log[0].text.includes('丟掉'), `超重太多還是走動了或沒提示（${g.log[0].text}）`);
    const m = FE.dressMonster(FE.makeMonster({ type: 'TERRAIN', x: px + side[0], y: py + side[1], cells: [], scope: 2, data: {} }, 903, 1), g.world);
    Object.assign(m, { home: { x: m.x, y: m.y }, atk: 0, maxHp: 1e6, hp: 1e6 });
    g.monsters = [m];
    g.flee();
    ok(p.x === px && p.y === py && g.turn === turn0 && /跑不動/.test(g.log[0].text), `超重太多還是撤退了（${g.log[0].text}）`);
    // 出手擲 d20 的加減：地形（整平的空地 +1）＋武器品質的命中加值；超重沒有減值，還是能出手
    const mods = [];
    const roll0 = FE.rollD20;
    FE.rollD20 = (r, mod) => { mods.push(mod); return roll0(r, mod); };
    p.hp = p.maxHp = 1e6;
    const modAt = (w) => { setOre(w); mods.length = 0; FE.Combat.resolveAttack(g, p, m, 'attack', { noCounter: true }); return mods[0]; };
    const m0 = modAt(120);
    const m1 = modAt(200);
    const m2 = modAt(310);
    FE.rollD20 = roll0;
    ok(m0 === 1 && m1 === 1 && m2 === 1, `出手加減：沒超重 ${m0}、超過能背 ${m1}、超過推拖上限 ${m2}（都應該是 1，沒有減值）`);
    setOre(310);
    g.monsters = [];
    const dropIdx = p.bag.findIndex((e) => e.id === 'ore');
    const tk1 = g.turn;
    g.dropItem(dropIdx);
    ok(g.turn === tk1 && g.loadTier() === 0 && g.weight() === 10, `丟掉之後該不花動作、重量回到 10（${g.weight()}）`);
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
      for (let i = 0; i < actions; i++) g.act('dodge'); // 一般的動作（第三十版起休息要 1 小時以上）
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
    const spear = G.make('shortspear', 2, g.nextGearId++);
    g.bagAddGear(spear);
    const t0 = g.turn, steps0 = p.steps;
    g.useItem(p.bag.findIndex((e) => e.gear === spear));
    ok(p.equip.main === spear && p.bag.some((e) => e.gear === sword0) && !p.bag.some((e) => e.gear === spear) && g.turn === t0 + 1 && p.steps === steps0, '拿起短矛：主手該換成短矛、長劍放回背包、算一個動作、不算步數');
    ok(g.attackText() === '1d8 穿刺' && g.log.some((l) => l.text.includes('拿起了+精良+短矛')), `拿起短矛後（副手空著，可雙手）傷害 ${g.attackText()}`);
    const sh = G.make('shield', 0, g.nextGearId++);
    const arm = G.make('medium', 4, g.nextGearId++);
    g.bagAddGear(sh); g.bagAddGear(arm);
    g.useItem(p.bag.findIndex((e) => e.gear === sh));
    g.useItem(p.bag.findIndex((e) => e.gear === arm));
    ok(p.equip.off === sh && p.equip.body === arm && g.attackText() === '1d6 穿刺', `盾牌該穿在副手、防具穿在身上；副手拿了盾牌就不能用可雙手的大骰子（${g.attackText()}）`);
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
    // 長槍沒有「雙手」標籤，看體型：體型 70,000 的中性角色（62,500 能拿、77,500 才能單手）只能雙手拿，不能配盾；體型 80,000 就能單手配盾
    const sp2 = G.make('spear', 0, g.nextGearId++);
    g.bagAddGear(sp2);
    g.useItem(p.bag.findIndex((e) => e.gear === sp2));
    g.useItem(p.bag.findIndex((e) => e.gear === sh2));
    ok(p.equip.main === sp2 && p.equip.off === null && g.log[0].text.includes('兩隻手'), `體型 70,000 拿長槍只能雙手，不能配盾：${g.log[0].text}`);
    p.size = 80000;
    g.useItem(p.bag.findIndex((e) => e.gear === sh2));
    ok(p.equip.main === sp2 && p.equip.off === sh2, `體型 80,000 拿長槍可以單手配盾：${g.log[0].text}`);
    p.size = 70000;
    p.equip.off = null;
    g.bagAddGear(sh2);
    g.useItem(p.bag.findIndex((e) => e.gear === bow));
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
    // 箭矢掉一捆，疊進背包的箭矢裡（當成 { type: 'arrow', q } 算）
    const bagGear = () => p.bag.filter((e) => e.id === 'gear' || e.id === 'arrow' || e.id === 'bolt').map((e) => (e.id === 'arrow' || e.id === 'bolt' ? { type: e.id, q: e.q, n: e.n } : e.gear));
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
    ok([...types].every((t) => FE.GEAR[t].drop) && !types.has('pick') && ['sword', 'spear', 'shortspear', 'dagger', 'bow', 'staff', 'arrow', 'bolt', 'shortsword', 'waraxe', 'greataxe', 'greatsword', 'club', 'warhammer', 'whip', 'crossbow', 'heavy', 'medium', 'light', 'robe', 'mrobe', 'shield'].every((t) => types.has(t)), `掉落的種類 ${[...types]}（新武器照現有規則會掉落）`);
    // 箭矢掉一捆 20 支
    {
      let arrows = null;
      for (let i = 0; i < 4000 && !arrows; i++) { p.bag = []; g.dropGear(mid()); arrows = p.bag.find((e) => e.id === 'arrow'); }
      ok(arrows && arrows.n === 20 && arrows.q >= 1 && arrows.q <= 3 && g.log.some((l) => l.text.includes('一捆 20 支的')), `掉落的箭矢該是一捆 20 支：${JSON.stringify(arrows)}`);
    }
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
      g.world.chests.push({ id: 9000 + i, x: 0, y: 0, copper: 50 });
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

  // 13. 纏上：撞上怪物設目標；往後退時目標一定出手一下（不擲 d20，只看閃避）並跟上來；換目標舊目標出手；撤退成功才解除
  {
    const g = newGame(23);
    for (let i = 0; i < 2; i++) g.createChunk(false);
    g.monsters = [];
    const w = g.world;
    const p = g.player;
    // 找一塊 7×5 的空地：全部走得過去、高度平、不在聚落和它周圍的圈裡（怪物進不去）
    const b = w.bounds();
    let spot = null;
    for (let y = b.y0; y < b.y1 - 5 && !spot; y++) {
      for (let x = b.x0; x < b.x1 - 7 && !spot; x++) {
        let good = true;
        for (let dy = 0; dy < 5 && good; dy++) for (let dx = 0; dx < 7 && good; dx++) {
          const c = w.cell(x + dx, y + dy);
          good = !!c && w.passable(x + dx, y + dy) && !w.inBuffer(x + dx, y + dy) && w.heightOk(x, y, x + dx, y + dy) && !w.chestAt(x + dx, y + dy) && !g.nodeAt(x + dx, y + dy);
        }
        if (good) spot = { x, y };
      }
    }
    ok(!!spot, '找不到 7×5 的空地');
    if (spot) {
      const mk = (id, x, y) => {
        const m = FE.dressMonster(FE.makeMonster({ type: 'TERRAIN', x, y, cells: [[x, y]], scope: 2, data: {} }, id, 1), w);
        Object.assign(m, { home: { x, y }, atk: 3, maxHp: 1e9, hp: 1e9 });
        return m;
      };
      const wander0 = C.WANDER_CHANCE;
      const dodge0 = C.PLAYER_DODGE;
      const flee0 = C.FLEE_FAIL;
      C.WANDER_CHANCE = 0;
      const cx = spot.x + 3, cy = spot.y + 2;
      const touching = (a) => Math.abs(a.x - p.x) + Math.abs(a.y - p.y) === 1;
      const events = [];
      let rolls = 0;
      const roll0 = FE.rollD20;
      FE.rollD20 = (r, mod) => { rolls++; return roll0(r, mod); };
      FE.Combat.hook = (e) => { if (e.by === 'monster' && e.d === p) events.push(e); };
      const reset = (ms) => { p.x = cx; p.y = cy; p.hp = p.maxHp = 1e6; p.block = null; g.monsters = ms; g.battle.targetId = null; events.length = 0; rolls = 0; };

      // A. 撞上怪物只設目標；往後退時目標一定出手（閃避 0 時一定打中、閃避 100% 時一定沒事），不擲 d20，然後跟上來
      const m1 = mk(910, cx + 1, cy);
      reset([m1]);
      C.PLAYER_DODGE = 0;
      let t0 = g.turn;
      g.move(1, 0);
      ok(g.battle.targetId === m1.id && g.turn === t0 && events.length === 0, '撞上怪物只該設目標');
      for (let step = 0; step < 3; step++) {
        const hp0 = p.hp;
        events.length = 0;
        rolls = 0;
        t0 = g.turn;
        g.move(-1, 0);
        const cling = events.filter((e) => e.cling);
        ok(g.turn === t0 + 1 && cling.length === 1 && cling[0].dmg >= 2 && p.hp < hp0 && rolls === 0, `後退第 ${step + 1} 步：目標出手 ${cling.length} 次、傷害 ${cling[0] && cling[0].dmg}、擲 d20 ${rolls} 次`);
        ok(touching(m1) && g.battle.targetId === m1.id, `後退第 ${step + 1} 步後目標沒有跟上來（目標 ${m1.x},${m1.y}，你 ${p.x},${p.y}）`);
      }
      ok(g.log.slice(0, 8).some((l) => l.text.includes('緊緊纏著你，趁你後退出手') && !l.text.includes('BUG')), '纏上的訊息不對');
      C.PLAYER_DODGE = 1;
      const hp1 = p.hp;
      events.length = 0;
      g.move(-1, 0);
      ok(events.some((e) => e.cling && e.dmg === 0 && e.dodged) && p.hp === hp1, '閃避 100% 時目標的這一下該沒事');
      C.PLAYER_DODGE = dodge0;

      // B. 換目標算一個動作，原目標趁隙出手一下（只看閃避），之後新目標纏上、舊目標回到一般行為
      const a = mk(911, cx + 1, cy);
      const c2 = mk(912, cx - 1, cy);
      reset([a, c2]);
      C.PLAYER_DODGE = 0;
      g.move(1, 0);
      t0 = g.turn;
      g.move(-1, 0);
      const swap = events.filter((e) => e.cling && e.a === a);
      ok(g.battle.targetId === c2.id && g.turn === t0 + 1 && swap.length === 1 && swap[0].dmg > 0, `換目標：回合 +${g.turn - t0}、原目標出手 ${swap.length} 次`);
      events.length = 0;
      g.move(0, -1);
      g.move(0, -1);
      ok(touching(c2) && !touching(a) && g.battle.targetId === c2.id, '換目標後新目標該纏上、舊目標不再跟著');
      C.PLAYER_DODGE = dodge0;

      // C. 撤退失敗不解除纏上，撤退成功才解除
      const f = mk(913, cx + 1, cy);
      reset([f]);
      g.move(1, 0);
      C.FLEE_FAIL = 1;
      g.flee();
      ok(g.battle.targetId === f.id, '撤退失敗不該解除纏上');
      C.FLEE_FAIL = 0;
      g.flee();
      ok(g.battle.targetId === null && !touching(f), '撤退成功該解除纏上');
      C.FLEE_FAIL = flee0;

      FE.rollD20 = roll0;
      C.WANDER_CHANCE = wander0;
      C.PLAYER_DODGE = dodge0;
      FE.Combat.hook = hook0;
    }
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
    // 第三十版：寶箱的錢存成銅（數字照舊是銀，乘 10）
    ok(max <= 250 && max >= 200 && max % 10 === 0 && bad > 800 && bad < 2400 && neg > 2000, `創世寶箱的錢：最大 ${max} 銅（減半後應該 ≤25 銀）、NaN ${bad}、負數 ${neg}`);
    const g = newGame(22);
    const drop = (m, n) => {
      const out = [];
      for (let i = 0; i < n; i++) {
        g.world.chests = [];
        g.dropChest(m);
        if (g.world.chests.length) out.push(g.world.chests[0].copper / C.SILVER);
      }
      return out;
    };
    const mid = FE.makeMonster({ type: 'TERRAIN', x: g.player.x + 3, y: g.player.y, cells: [], scope: 6 }, 1, 1);
    const small = FE.makeMonster({ type: 'TERRAIN', x: g.player.x + 3, y: g.player.y, cells: [], scope: 2 }, 2, 1);
    small.small = true;
    const dm = drop(mid, 300);
    const ds = drop(small, 600);
    ok(Math.abs(dm.length / 300 - C.DROP_BIG_CHANCE) < 0.12 && C.DROP_BIG_CHANCE === 0.5, `中型怪物掉寶箱的比例 ${(dm.length / 300).toFixed(2)}（應該約 0.5）`);
    ok(Math.abs(ds.length / 600 - C.DROP_SMALL_CHANCE) < 0.07 && C.DROP_SMALL_CHANCE === 0.2, `小怪物掉寶箱的比例 ${(ds.length / 600).toFixed(2)}（應該約 0.2）`);
    ok(dm.length > 0 && Math.min(...dm) >= 14 && Math.max(...dm) <= 16, `中型怪物的寶箱金幣 ${Math.min(...dm)}～${Math.max(...dm)}（原本 27～32，減半後 14～16）`);
    ok(ds.length > 0 && Math.min(...ds) >= 3 && Math.max(...ds) <= 8, `小怪物的寶箱金幣 ${Math.min(...ds)}～${Math.max(...ds)}（原本 5～15，減半後 3～8）`);
    // 第三十版：掉落拆成三種幣、總值不變；小怪物多銅與銀（不出金），中型怪物與寶箱多銀、偶爾有金
    const parse = (t) => { let s = 0; for (const [, n, u] of t.matchAll(/(\d+) (金|銀|銅)/g)) s += Number(n) * (u === '金' ? 100 : u === '銀' ? 10 : 1); return s; };
    let goldSeen = 0, smallGold = 0, smallCopper = 0, coinOk = true;
    for (let i = 0; i < 2000; i++) {
      const v = 30 + (i % 300);
      const big = g.coins(v * 10, false);
      const sm = g.coins(v, true);
      if (parse(big) !== v * 10 || parse(sm) !== v) coinOk = false;
      if (/金/.test(big)) goldSeen++;
      if (/金/.test(sm)) smallGold++;
      const cu = /(\d+) 銅/.exec(sm);
      if (cu && Number(cu[1]) >= 10) smallCopper++;
    }
    ok(coinOk, '拆成三種幣之後總值變了');
    ok(goldSeen > 300 && goldSeen < 900 && smallGold === 0 && smallCopper > 1500, `中型怪物與寶箱出金 ${goldSeen}/2000 次（約三成）、小怪物出金 ${smallGold} 次、小怪物銅幣 10 枚以上 ${smallCopper}/2000 次`);
    ok(g.coins(0, false) === '裡面沒有錢', `空的寶箱寫 ${g.coins(0, false)}`);
  }

  // 怪物一定打得到：被抬到四面斷崖的台子上，回合結束時腳下的高度改成跟旁邊一樣；本來就接得上的不動
  {
    const g = newGame(23);
    const w = g.world;
    const p = g.player;
    let spot = null;
    w.forEachCell((x, y) => {
      if (spot || Math.abs(x - p.x) + Math.abs(y - p.y) < 4 || w.inBuffer(x, y) || !w.passable(x, y)) return;
      if ([[1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dy]) => w.passable(x + dx, y + dy))) spot = { x, y };
    });
    const m = g.spawnMonster({ type: 'TERRAIN', x: spot.x, y: spot.y, cells: [], scope: 2, data: {} }, null);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) w.setHeight(m.x + dx, m.y + dy, 0);
    w.setHeight(m.x, m.y, 2);
    g.unstrand();
    ok(w.cell(m.x, m.y).h === 0, `被抬上台子的怪物滑下來（腳下高度 ${w.cell(m.x, m.y).h}，應該是 0）`);
    w.setHeight(m.x, m.y, 1);
    g.unstrand();
    ok(w.cell(m.x, m.y).h === 1, '高度接得上的怪物腳下不動');
    w.setHeight(m.x, m.y, 2);
    g.endTurn(false);
    ok([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => w.heightOk(m.x, m.y, m.x + dx, m.y + dy)), '回合結束時怪物旁邊一定有一格高度接得上');
  }
  FE.Combat.hook = hook0;
}
UNITS.gear = () => { try { testGear(); } catch (e) { fail('裝備測試拋出例外：' + e.stack); } };

// ---- 第二十六版：職業、六項屬性、生命與負重、升級加點、各項屬性的效果、技能用了就成長：場景測試 ----
let charChecks = 0;
function testCharacter() {
  const ok = (cond, msg) => { charChecks++; if (!cond) fail('角色 ' + msg); };
  const near = (a, b, eps) => Math.abs(a - b) <= (eps === undefined ? 1e-9 : eps);
  const G = FE.Gear;
  const Ch = FE.Char;
  const hook0 = FE.Combat.hook;
  const mk = (seed, cls, picks) => { const g = new FE.Game(seed); g.start({ cls, picks }); g.checkCreate = () => {}; g.monsters = []; return g; };
  const keys = FE.ATTRS.map((a) => a.key);
  const uses = (p, id) => { const s = p.skills[id]; let t = s.n; for (let l = 0; l < s.lv; l++) t += Ch.skillNeed(l); return t; };
  const arena = (g, type) => {
    const p = g.player;
    const m = FE.dressMonster(FE.makeMonster({ type, x: p.x + 1, y: p.y, cells: [[p.x + 1, p.y]], scope: 2, data: {} }, 900, 1), g.world);
    m.home = { x: m.x, y: m.y };
    m.maxHp = m.hp = 1e9;
    m.atk = 1;
    g.monsters = [m];
    return m;
  };
  const combos = (arr, k) => (k === 0 ? [[]] : arr.flatMap((x, i) => combos(arr.slice(i + 1), k - 1).map((r) => [x].concat(r))));
  const product = (lists) => lists.reduce((acc, l) => acc.flatMap((a) => l.map((x) => a.concat(x))), [[]]);

  // 1. 修正值：(屬性－10)÷2 無條件捨去，9 和 8 都算 -1
  ok([[1, -5], [8, -1], [9, -1], [10, 0], [11, 0], [12, 1], [13, 1], [14, 2], [15, 2], [16, 3], [17, 3], [18, 4]].every(([v, m]) => Ch.mod(v) === m), '修正值的算法不對');

  // 2. 四個職業的起始屬性、生命、負重
  const want = {
    warrior: { attr: [15, 13, 14, 10, 12, 8], hp: 36, carry: 225, base: 10 },
    ranger: { attr: [12, 15, 13, 8, 14, 10], hp: 31, carry: 180, base: 8 },
    mage: { attr: [8, 13, 12, 15, 14, 10], hp: 24, carry: 120, base: 4 },
    priest: { attr: [13, 10, 14, 8, 15, 12], hp: 33, carry: 195, base: 8 },
    paladin: { attr: [14, 10, 13, 8, 12, 15], hp: 34, carry: 210, base: 10 },
    barbarian: { attr: [14, 13, 15, 8, 12, 10], hp: 40, carry: 210, base: 12 },
  };
  useClasses('new');
  ok(Object.keys(FE.CLASSES).join() === 'warrior,ranger,mage,priest,paladin,barbarian', '職業該是戰士、遊俠、法師、牧師、聖騎士、野蠻人'); // 起始屬性是《D&D》標準陣列 15、14、13、12、10、8，照各職業的高低順序排
  for (const [cls, w] of Object.entries(want)) {
    const g = mk(21, cls);
    const p = g.player;
    ok(keys.map((k) => p.attr[k]).join() === w.attr.join(), `${cls} 的起始屬性 ${keys.map((k) => p.attr[k])}`);
    ok(p.attr.str + p.attr.dex + p.attr.con + p.attr.int + p.attr.wis + p.attr.cha === 72 && w.attr.slice().sort((a, b) => b - a).join() === '15,14,13,12,10,8', `${cls} 的屬性該是 15、14、13、12、10、8 排列`);
    ok(p.maxHp === w.hp && p.hp === w.hp && g.level === 1, `${cls} 的起始生命 ${p.maxHp}（應該 ${w.hp}）`);
    ok(g.carryLimit() === w.carry && g.pushLimit() === w.carry * 2 && FE.CLASSES[cls].base === w.base && FE.CLASSES[cls].carry === undefined, `${cls} 的負重上限 ${g.carryLimit()}（應該 力量值×15＝${w.carry}），推拖上限 ${g.pushLimit()}`);
    ok(Object.keys(FE.SKILLS).every((k) => p.skills[k].lv === 0 && p.skills[k].n === 0) && p.points === 0, `${cls} 的技能該全是 0 級`);
  }
  // 種族加值疊在新的起始屬性上：矮人戰士體質 14+2、精靈遊俠敏捷 15+2、人類法師加 2 點到智力 15+2；生命、負重跟著算
  {
    const dw = new FE.Game(1);
    dw.start({ cls: 'warrior', body: { race: 'dwarf', bonus: {}, height: 4, build: 4 } });
    const el = new FE.Game(1);
    el.start({ cls: 'ranger', body: { race: 'elf', bonus: {}, height: 4, build: 4 } });
    const hu = new FE.Game(1);
    hu.start({ cls: 'mage', body: { race: 'human', bonus: { int: 2 }, height: 4, build: 4 } });
    ok(dw.player.attr.con === 16 && dw.player.maxHp === Math.floor((10 + 16) * 1.5) && dw.carryLimit() === 225, `矮人戰士體質 ${dw.player.attr.con}、生命 ${dw.player.maxHp}、能背 ${dw.carryLimit()}`);
    ok(el.player.attr.dex === 17 && el.player.maxHp === 31 && el.carryLimit() === 180, `精靈遊俠敏捷 ${el.player.attr.dex}`);
    ok(hu.player.attr.int === 17 && hu.player.maxHp === 24 && hu.carryLimit() === 120, `人類法師智力 ${hu.player.attr.int}`);
  }
  useClasses('legacy');

  // 3. 起始裝備：固定的一定有，自己挑的每一種挑法都對；品質都是普通
  const wantCombos = { warrior: 9, ranger: 4, mage: 4, priest: 8 };
  for (const [cls, c] of Object.entries(FE.CLASSES)) {
    const all = product(c.groups.map((gr) => combos(gr.of, gr.pick)));
    ok(all.length === wantCombos[cls], `${cls} 的起始裝備挑法有 ${all.length} 種（應該 ${wantCombos[cls]}）`);
    for (const picks of all) {
      const flat = picks;
      ok(Ch.validPicks(cls, flat), `${cls} ${flat} 該是合法的挑法`);
      const g = mk(22, cls, flat);
      const p = g.player;
      const ids = c.fixed.concat(flat);
      const gears = ids.filter((id) => FE.START_OPTS[id].gear).map((id) => FE.START_OPTS[id].gear);
      const weapons = gears.filter((t) => FE.GEAR[t].cat === 'weapon');
      const armors = gears.filter((t) => FE.GEAR[t].cat === 'armor');
      const shields = gears.filter((t) => FE.GEAR[t].cat === 'shield');
      ok(weapons.length === 1 && p.equip.main && p.equip.main.type === weapons[0] && p.equip.main.q === 0 && p.equip.main.dur === p.equip.main.max, `${cls} ${flat} 主手該是 ${weapons}`);
      ok((armors.length ? p.equip.body && p.equip.body.type === armors[0] && p.equip.body.q === 0 : !p.equip.body), `${cls} ${flat} 身上該是 ${armors}`);
      // 雙手拿的武器（弓箭，或體型不夠單手的長槍）跟盾牌一起挑：盾牌放進背包。中性角色體型 70,000：長槍只能雙手（77,500 才能單手）
      const two = Ch.grip(p, p.equip.main) === 'two';
      ok(two === (weapons[0] === 'spear' || weapons[0] === 'bow'), `${cls} ${flat} 的 ${weapons[0]} 拿法 ${Ch.grip(p, p.equip.main)}`);
      ok((shields.length ? (two ? !p.equip.off && p.bag.some((e) => e.gear && e.gear.type === 'shield') : p.equip.off && p.equip.off.type === 'shield' && p.equip.off.q === 0) : !p.equip.off), `${cls} ${flat} 副手該是 ${two ? '空著（盾牌在背包）' : shields}`);
      ok(g.bagCount('herb') === (ids.includes('herb') ? 2 : 0) && p.copper === (ids.includes('gold') ? 200 : 0) && p.bag.every((e) => e.id === 'herb' || (e.id === 'arrow' && weapons[0] === 'bow') || (e.gear && e.gear.type === 'shield' && two)), `${cls} ${flat} 的藥草 ${g.bagCount('herb')}、金幣 ${p.copper}、背包 ${p.bag.map((e) => e.name)}`);
      ok(g.bagCount('arrow') === (weapons[0] === 'bow' ? 20 : 0), `${cls} ${flat} 的箭矢 ${g.bagCount('arrow')}（弓箭附一捆 20 支）`);
    }
  }
  // 固定給的裝備
  ok(mk(23, 'warrior').player.equip.body.type === 'medium' && mk(23, 'ranger').player.equip.body.type === 'light' && mk(23, 'mage').player.equip.body.type === 'robe' && mk(23, 'priest', ['shield', 'sword', 'gold']).player.equip.body === null, '固定給的防具不對（戰士中甲、遊俠輕甲、法師一般衣袍、牧師沒有固定的）');
  ok(mk(23, 'ranger').player.equip.main.type === 'bow' && ['bow', 'dagger', 'shortspear', 'spear'].every((t) => mk(23, 'ranger', [t]).player.equip.main.type === t) && !Ch.validPicks('ranger', ['sword']), '遊俠的武器四選一：弓箭、短刀、短矛、長槍');
  ok(['sword', 'spear', 'shortspear'].every((t) => Ch.validPicks('warrior', [t, 'herb', 'gold'])), '戰士原本的長槍選項，長槍、短矛都能選');
  ok(mk(23, 'mage', ['staff', 'gold']).player.equip.main.type === 'staff' && mk(23, 'mage', ['staff', 'gold']).attackText() === '1d8-1 鈍擊', `法師拿法杖（副手空著 1d8，力量 -1）：${mk(23, 'mage', ['staff', 'gold']).attackText()}`);
  // 不合法的挑法：挑多、挑少、挑到別組的、重複、不是清單
  ok(!Ch.validPicks('warrior', ['sword', 'spear', 'shield', 'herb']) && !Ch.validPicks('warrior', ['sword', 'shield']) && !Ch.validPicks('warrior', ['sword', 'shield', 'herb', 'gold']) &&
    !Ch.validPicks('warrior', ['sword', 'herb', 'herb']) && !Ch.validPicks('warrior', ['dagger', 'herb', 'gold']) && !Ch.validPicks('ranger', ['bow', 'dagger']) && !Ch.validPicks('mage', ['staff']) &&
    !Ch.validPicks('priest', ['medium', 'shield', 'sword', 'gold']) && !Ch.validPicks('warrior', 'sword') && !Ch.validPicks('none', []), '不合法的挑法該被擋下');
  let threw = false;
  try { new FE.Game(1).start({ cls: 'warrior', picks: ['sword', 'spear'] }); } catch (e) { threw = true; }
  ok(threw, '不合法的挑法該讓開新世界失敗（不生出世界）');
  // 每個選項 id 都對得到資料；第二十八版起法杖、弓箭、箭矢、短矛商店有賣、寶箱與怪物會掉；弓箭、法杖、箭矢不能打造
  ok(Object.values(FE.CLASSES).every((c) => c.fixed.concat(...c.groups.map((gr) => gr.of)).every((id) => FE.START_OPTS[id])) && Object.values(FE.START_OPTS).every((o) => !o.gear || FE.GEAR[o.gear]), '起始裝備的選項資料對不上');
  const sellsAt = (s, t) => Object.values(s.buy).some((a) => a.includes(t));
  ok(['staff', 'bow', 'arrow', 'shortspear'].every((t) => FE.Gear.DROP_TYPES.includes(t) && sellsAt(G.SHOPS.blacksmith, t) && sellsAt(G.SHOPS.weaponsmith, t)) && Object.values(G.SHOPS).every((s) => !s.craft.includes('staff') && !s.craft.includes('bow') && !s.craft.includes('arrow') && !s.craft.includes('whip') && !s.craft.includes('crossbow')), '法杖、弓箭、箭矢、短矛該賣該掉；弓箭、法杖、箭矢、鞭子、輕弩不能打造');

  // 4. 生命公式與升級：每升一級加「職業基礎÷2＋體質修正值」，每次照公式重算，體質加點時前面的等級一起補上
  for (const [cls, w] of Object.entries(want).filter(([c]) => FE.CLASSES[c])) {
    const g = mk(24, cls);
    const p = g.player;
    const per = (con) => Math.floor(w.base / 2) + Ch.mod(con);
    const hpAt = (con, lv) => Math.floor((w.base + con) * 1.5) + (lv - 1) * per(con);
    let con = p.attr.con;
    p.hp = 5;
    g.addExp(FE.levelExp(2));
    ok(g.level === 2 && p.points === 0 && p.maxHp === hpAt(con, 2) && p.hp === 5 + per(con), `${cls} 升到 2 級：生命上限 ${p.maxHp}（應該 ${hpAt(con, 2)}）、目前 ${p.hp}、點數 ${p.points}（2 級沒有點數）`);
    g.addExp(FE.levelExp(4));
    ok(g.level === 4 && p.points === 1 && p.maxHp === hpAt(con, 4), `${cls} 升到 4 級：點數 ${p.points}（4 級有 1 點）`);
    const hp0 = p.hp;
    const max0 = p.maxHp;
    ok(g.spendPoint('con') && p.attr.con === con + 1 && p.points === 0, `${cls} 體質加點失敗`);
    con++;
    ok(p.maxHp === hpAt(con, 4) && p.hp === hp0 + (p.maxHp - max0), `${cls} 體質加到 ${con}：生命上限 ${p.maxHp}（應該 ${hpAt(con, 4)}）`);
    // 一口氣升兩級（5、6 級沒有點數）
    g.addExp(FE.levelExp(6));
    ok(g.level === 6 && p.points === 0 && p.maxHp === hpAt(con, 6), `${cls} 升到 6 級：生命上限 ${p.maxHp}（應該 ${hpAt(con, 6)}），點數 ${p.points}`);
    p.points = 4;
    const m1 = p.maxHp;
    const h1 = p.hp;
    for (let i = 0; i < 4; i++) { if (p.attr.con < C.ATTR_CAP) { g.spendPoint('con'); con++; } }
    ok(p.attr.con === Math.min(C.ATTR_CAP, con) && p.maxHp === hpAt(p.attr.con, 6) && p.hp === h1 + (p.maxHp - m1), `${cls} 體質連加：生命上限 ${p.maxHp}（應該 ${hpAt(p.attr.con, 6)}）`);
    // 倒下、休息之後生命上限不變
    g.die({ name: '怪物', hp: 1, maxHp: 2 });
    ok(p.hp === p.maxHp && p.maxHp === hpAt(p.attr.con, 6), `${cls} 倒下後生命回滿 ${p.hp}/${p.maxHp}`);
  }
  // 戰士的例子：15 體質升到 5 級是 37＋4×7＝65，體質加到 16 之後是 39＋4×8＝71
  {
    const g = mk(25, 'warrior');
    g.addExp(FE.levelExp(5));
    ok(g.player.maxHp === 37 + 4 * 7, `戰士 5 級的生命上限 ${g.player.maxHp}（應該 65）`);
    g.player.hp = 10;
    g.spendPoint('con');
    ok(g.player.maxHp === 39 + 4 * 8 && g.player.hp === 16, `戰士 5 級體質 16：生命上限 ${g.player.maxHp}（應該 71）、目前 ${g.player.hp}（應該 16）`);
  }
  // 升級時整體的訊息要說得出來
  {
    const g = mk(25, 'mage');
    g.addExp(FE.levelExp(2));
    ok(g.log.some((l) => /升到 Lv2/.test(l.text) && !/屬性/.test(l.text)), '2 級沒有點數，訊息不該提屬性');
    g.addExp(FE.levelExp(4));
    ok(g.log.some((l) => /升到 Lv4/.test(l.text) && /1 點屬性/.test(l.text)) && g.log.some((l) => /升到 Lv3/.test(l.text) && !/屬性/.test(l.text)), '4 級的訊息提到可以加屬性，3 級不提');
    // 加點只在 4、8、12、16、19 級
    const g8 = mk(25, 'mage');
    const ptsAt = [];
    for (let L = 2; L <= 20; L++) { const before = g8.player.points; g8.addExp(FE.levelExp(L) - g8.exp); ptsAt.push(g8.player.points - before); }
    ok(C.LEVEL_POINT_AT.join() === '4,8,12,16,19' && ptsAt.map((n, i) => (n ? i + 2 : 0)).filter(Boolean).join() === '4,8,12,16,19' && g8.player.points === 5, `加點的等級：${ptsAt.map((n, i) => (n ? i + 2 : 0)).filter(Boolean)}`);
  }

  // 5. 加點：每升一級 1 點，只能加還沒到 18 的屬性
  {
    const g = mk(26, 'warrior');
    const p = g.player;
    ok(!g.spendPoint('str') && p.attr.str === 16, '沒有點數不該能加');
    p.points = 3;
    p.attr.str = 17;
    ok(g.spendPoint('str') && p.attr.str === 18 && p.points === 2, '力量 17 該加得到 18');
    ok(!g.spendPoint('str') && p.attr.str === 18 && p.points === 2, '力量 18 不該再加，點數也不該被吃掉');
    ok(!g.spendPoint('luck') && p.points === 2, '不存在的屬性不該能加');
    ok(g.spendPoint('int') && p.attr.int === 10 && p.points === 1, '智力要能加點');
    ok(g.spendPoint('wis') && p.attr.wis === 13 && p.points === 0, '感知要能加點');
    // 六項都到上限，沒地方加的點數不留
    for (const k of keys) p.attr[k] = 18;
    p.points = 2;
    g.dropLostPoints();
    ok(p.points === 0, '六項屬性都到上限時，沒地方加的點數該清掉');
    // 升級時六項都滿，點數不累積（不會留著跳出加不了的視窗）
    g.addExp(FE.levelExp(g.level + 1));
    ok(p.points === 0 && g.level === 2, '六項都滿時升級不該留點數');
    // 沒存好的點數存檔後還在（讀檔後視窗會再跳出來）
    const g2 = mk(27, 'priest');
    g2.addExp(FE.levelExp(8));
    ok(g2.player.points === 2, '一口氣升到 8 級該有 2 點（4、8 級）');
    FE.Save.save(g2);
    const back = FE.Save.load();
    ok(back && back.game && back.game.player.points === 2 && back.game.player.cls === 'priest' && back.game.player.maxHp === g2.player.maxHp &&
      JSON.stringify(back.game.player.attr) === JSON.stringify(g2.player.attr) && JSON.stringify(back.game.player.skills) === JSON.stringify(g2.player.skills), '存檔讀回來，職業、屬性、技能、沒加的點數該一樣');
    // 舊版本的存檔讀不了
    FE.store.save('fe.save', { version: C.SAVE_VERSION - 1, data: {} });
    const old = FE.Save.load();
    ok(C.SAVE_VERSION === 19 && old && old.stale === true && FE.store.load('fe.save', null) === null, '舊版本的存檔該清掉、回報 stale');
  }

  // 6. 力量：近戰傷害加修正值（可為負，最少 1）；長劍 1d8（副手空著 1d10）；短刀靈巧取力量與敏捷較高者，不再減半；重擊傷害骰擲兩次
  {
    const g = mk(30, 'warrior', ['sword', 'herb', 'gold']);
    const p = g.player;
    const m = arena(g, 'CLIFF');
    m.type = 'RUNTIME'; // 碎裂：沒有閃避、格擋、抗性
    const range = (n, kind) => {
      const seen = [];
      FE.Combat.hook = (e) => { if (e.by === 'player' && (e.key === 'hit' || e.key === 'hard') && !e.dodged && !e.crit && !e.blocked && !e.resisted && !e.counter) seen.push(e.dmg); };
      if (p.equip.main) p.equip.main.dur = p.equip.main.max = 1e9;
      // 每一下都把技能歸零，免得量到一半技能升級、傷害跟著變
      for (let i = 0; i < n; i++) { p.hp = p.maxHp = 1e9; p.skills = Ch.freshSkills(); FE.Combat.resolveAttack(g, p, m, kind || 'attack', { noCounter: true }); }
      FE.Combat.hook = hook0;
      return [Math.min(...seen), Math.max(...seen)];
    };
    ok(Ch.dmgBonus(p) === 3, `戰士力量 16 的傷害加值 ${Ch.dmgBonus(p)}`);
    let r = range(800);
    ok(r[0] === 4 && r[1] === 13, `力量 16（+3）拿長劍、副手空著（1d10）的傷害該是 4～13，量到 ${r}`);
    p.equip.off = G.make('shield', 0, g.nextGearId++);
    r = range(800);
    ok(r[0] === 4 && r[1] === 11, `副手拿盾牌時長劍是 1d8：4～11，量到 ${r}`);
    p.equip.off = null;
    p.attr.str = 8;
    r = range(800);
    ok(r[0] === 1 && r[1] === 9, `力量 8（-1）拿長劍 1d10-1 該是 1～9（最少 1），量到 ${r}`);
    p.equip.main = G.make('dagger', 0, g.nextGearId++);
    p.attr.str = 1; // 修正值 -5，但短刀取力量與敏捷較高者（敏捷 13 是 +1）：1d4＋1 ＝ 2～5
    r = range(500);
    ok(r[0] === 2 && r[1] === 5, `力量 1、敏捷 13 拿短刀該是 2～5（靈巧取較高者，不再減半），量到 ${r}`);
    p.attr.str = 16;
    p.attr.dex = 13; // 力量 +3 較高：4～7
    r = range(500);
    ok(r[0] === 4 && r[1] === 7, `力量 16 拿短刀該是 4～7，量到 ${r}`);
    p.attr.str = 1;
    p.attr.dex = 1; // 兩個都 -5：最少 1
    r = range(300);
    ok(r[0] === 1 && r[1] === 1, `力量、敏捷都 1 拿短刀傷害該是最少 1，量到 ${r}`);
    p.attr.dex = 13;
    p.attr.str = 12;
    // 重擊：傷害骰擲兩次加總，再加一次修正值。長劍副手空著 2d10＋1 ＝ 3～21
    p.equip.main = G.make('sword', 0, g.nextGearId++);
    r = range(3000, 'deep');
    ok(r[0] === 3 && r[1] === 21, `力量 12（+1）長劍重擊該是 2d10+1 ＝ 3～21，量到 ${r}`);
    // 徒手：固定 1＋力量修正值，最少 1
    p.equip.main = null;
    p.attr.str = 16;
    r = range(200);
    ok(r[0] === 4 && r[1] === 4, `徒手力量 16 該是 1＋3 ＝ 4，量到 ${r}`);
    p.attr.str = 12;
    p.equip.main = G.make('sword', 0, g.nextGearId++);
    // 反擊固定 1 點，不加力量
    p.attr.str = 18;
    const cs = [];
    FE.Combat.hook = (e) => { if (e.by === 'player' && e.counter && (e.key === 'hit' || e.key === 'hard') && !e.dodged && !e.crit && !e.resisted) cs.push(e.dmg); };
    for (let i = 0; i < 100; i++) FE.Combat.resolveAttack(g, p, m, 'attack', { noCounter: true, counter: true });
    FE.Combat.hook = hook0;
    ok(cs.length > 0 && cs.every((d) => d === C.COUNTER_DAMAGE), '反擊該固定 1 點，不加力量');
    // 法師拿法杖近戰：1d6 鈍擊（副手空著 1d8）加力量（力量 8 → -1）
    const gm = mk(31, 'mage', ['staff', 'gold']);
    const pm = gm.player;
    const mm = arena(gm, 'RUNTIME');
    const sm = [];
    FE.Combat.hook = (e) => { if (e.by === 'player' && (e.key === 'hit' || e.key === 'hard') && !e.dodged && !e.crit && !e.blocked && !e.resisted && !e.counter) sm.push(e.dmg); };
    pm.equip.main.dur = pm.equip.main.max = 1e9;
    for (let i = 0; i < 600; i++) { pm.hp = pm.maxHp = 1e9; pm.skills = Ch.freshSkills(); FE.Combat.resolveAttack(gm, pm, mm, 'attack', { noCounter: true }); }
    FE.Combat.hook = hook0;
    ok(Math.min(...sm) === 1 && Math.max(...sm) === 7, `法師拿法杖近戰該是 1d8-1 ＝ 1～7，量到 ${Math.min(...sm)}～${Math.max(...sm)}`);
  }
  // 盾牌的格擋值：戰士加力量修正值，其他職業只照盾牌與品質
  {
    const w = mk(32, 'warrior', ['sword', 'shield', 'herb']).player;
    const pr = mk(32, 'priest', ['shield', 'sword', 'gold']).player;
    ok(G.playerDefense(w).blockMax === 4 + 3 && near(G.playerDefense(w).block, 0.25), `戰士拿盾牌格擋值 ${G.playerDefense(w).blockMax}（應該 4＋力量修正值 3）`);
    ok(G.playerDefense(pr).blockMax === 4 && near(G.playerDefense(pr).block, 0.25), `牧師拿盾牌格擋值 ${G.playerDefense(pr).blockMax}（應該 4，不吃力量）`);
    w.equip.off = G.make('shield', 2, 70);
    pr.equip.off = G.make('shield', 2, 71);
    ok(G.playerDefense(w).blockMax === 6 + 3 && G.playerDefense(pr).blockMax === 6, `精良盾牌：戰士 ${G.playerDefense(w).blockMax}（應該 9）、牧師 ${G.playerDefense(pr).blockMax}（應該 6）`);
    w.equip.off = null;
    ok(G.playerDefense(w).blockMax === 0 && G.playerDefense(w).block === 0, '沒拿盾牌不能格擋');
  }

  // 7. 敏捷：出手 d20 加修正值（跟品質、地形、高處疊加）；閃避每點修正值 +2%（PLAYER_DODGE 10% 為基準，再加技能、扣防具，最低 0）
  {
    const g = mk(33, 'ranger', ['shortspear']);
    const p = g.player;
    const m = arena(g, 'RUNTIME');
    const tag = () => { const l = g.log.find((x) => /擲出/.test(x.text)); const r = /擲出 \d+([+-]\d+)?：/.exec(l.text); return r && r[1] ? Number(r[1]) : 0; };
    const roll = () => { p.hp = p.maxHp = 1e9; p.equip.main.dur = p.equip.main.max = 1e9; FE.Combat.resolveAttack(g, p, m, 'attack', { noCounter: true }); return tag(); };
    p.attr.dex = 10;
    const base = roll();
    ok(G.hitMod(p) === 0, `敏捷 10 的出手加減該是 0，量到 ${G.hitMod(p)}`);
    p.attr.dex = 16;
    ok(roll() - base === 3 && G.hitMod(p) === 3, `敏捷 16（+3）該讓擲骰多 3：${roll() - base}`);
    p.attr.dex = 8;
    ok(roll() - base === -1 && G.hitMod(p) === -1, '敏捷 8（-1）該讓擲骰少 1');
    // 跟品質、技能、超重疊加
    p.attr.dex = 16;
    p.equip.main = G.make('spear', 2, g.nextGearId++); // 精良 +2
    p.skills.spear.lv = 10; // 長槍練的是槍術，+2；格鬥 10 級再 +1
    p.skills.fight.lv = 10;
    ok(G.hitMod(p) === 3 + 2 + 2 + 1 && roll() - base === 8, `敏捷 +3、精良 +2、槍術 10 級 +2、格鬥 10 級 +1 該疊成 +8：${roll() - base}`);
    p.attr.dex = 10;
    p.equip.main = G.make('spear', 0, g.nextGearId++);
    p.skills.spear.lv = 0;
    p.skills.fight.lv = 0;
    g.bagAdd('ore', Math.ceil((g.carryLimit() + 1 - g.weight()) / 10)); // 超過能背（第二十九版：超重不再扣出手 d20）
    ok(g.loadTier() === 1 && G.hitMod(p) === 0, `超重不該再扣出手：${G.hitMod(p)}`);
    p.bag = [];
    // 閃避
    const d = (q) => G.playerDefense(q).dodge;
    const mkp = (dex, body, armorLv, dodgeLv) => { const q = mk(34, 'ranger').player; q.attr.dex = dex; q.equip.body = body ? G.make(body, 0, 99) : null; if (body) q.skills[FE.GEAR[body].cls].lv = armorLv || 0; q.skills.dodge.lv = dodgeLv || 0; return q; };
    ok(near(d(mkp(10)), 0.10) && near(d(mkp(16)), 0.16) && near(d(mkp(13)), 0.12) && near(d(mkp(8)), 0.08), `閃避隨敏捷：${d(mkp(10))}、${d(mkp(16))}、${d(mkp(13))}、${d(mkp(8))}`);
    ok(near(d(mkp(16, 'light')), 0.16) && near(d(mkp(16, 'studded')), 0.16) && near(d(mkp(8, 'light')), 0.08), '輕甲的敏捷加減全照算（包含負的）');
    ok(near(d(mkp(16, 'medium')), 0.14) && near(d(mkp(14, 'hide')), 0.14) && near(d(mkp(13, 'medium')), 0.12) && near(d(mkp(8, 'medium')), 0.08), '中甲的敏捷加成最多 +2 點修正值，負的照扣');
    ok(near(d(mkp(16, 'heavy')), 0.10) && near(d(mkp(8, 'heavy')), 0.10) && near(d(mkp(16, 'plate')), 0.10), '重甲敏捷不加也不扣');
    ok(near(d(mkp(16, null, 0, 5)), 0.21) && near(d(mkp(10, null, 0, 20)), 0.30), '閃避技能每級該加 1%');
    ok(near(d(mkp(16, 'heavy', 14)), 0.10) && near(d(mkp(16, 'heavy', 0, 5)), 0.15), '重甲穿多高的技能都不改敏捷的閃避');
    ok(d(mkp(1)) === 0 && d(mkp(1, 'heavy')) === 0.10, `閃避最低 0：${d(mkp(1))}、重甲 ${d(mkp(1, 'heavy'))}`);
  }

  // 8. 體質：休息回復加修正值（最少 1），村莊住一晚回滿不變
  {
    const outside = (g) => {
      const w = g.world;
      for (const ch of w.chunks) for (let y = 0; y < ch.cells.length; y++) for (let x = 0; x < ch.cells[y].length; x++) {
        const X = ch.x0 + x, Y = ch.y0 + y;
        if (w.passable(X, Y) && !w.villageAt(X, Y) && !w.inBuffer(X, Y)) return { x: X, y: Y };
      }
      return null;
    };
    for (const [cls, con, heal] of [['warrior', 15, 3], ['ranger', 13, 2], ['mage', 12, 2], ['priest', 15, 3], ['mage', 10, 1], ['mage', 8, 1]]) {
      const g = mk(35, cls);
      const p = g.player;
      p.attr.con = con;
      g.recalc();
      const at = outside(g);
      p.x = at.x;
      p.y = at.y;
      // 第三十版：野外短休回 1d10＋體質修正值（最少 1）；跑 40 次看範圍
      g.monsters = [];
      const mod = heal - 1;
      const got = [];
      for (let k = 0; k < 60 && got.length < 40; k++) {
        p.hp = 1;
        g.monsters = [];
        g.rest();
        if (/歇了一個小時/.test(g.log[0].text)) got.push(p.hp - 1); // 事件生出的怪物貼上來打斷的不算
      }
      ok(Math.min(...got) >= Math.max(1, 1 + mod) && Math.min(...got) <= Math.max(1, 3 + mod) && Math.max(...got) <= 10 + mod && Math.max(...got) >= 8 + mod, `${cls} 體質 ${con} 短休該回 1d10${mod >= 0 ? '+' : ''}${mod}（最少 1），量到 ${Math.min(...got)}～${Math.max(...got)}`);
    }
    const g = mk(35, 'mage');
    g.player.hp = 1;
    g.rest();
    ok(g.player.hp === g.player.maxHp, '在村莊裡休息該回滿');
  }

  // 9. 魅力：向工匠買東西 −5%／點、賣東西 +5%／點（疊在聚落價錢倍率上）、修復費與打造工錢照買價、委託金幣 +5%／點
  {
    const plain = { kind: 'village', steading: { prosperity: 2, tags: [] } };
    const poor = { kind: 'village', steading: { prosperity: 0, tags: [] } }; // 荒蕪 ×1.6
    // 第三十版：錢用銅記帳，下面的數字是銅（原本的銀 ×10，乘完才四捨五入）
    ok(G.shopPrice('sword', 0, plain, 0) === 300 && G.shopPrice('sword', 0, plain) === 300, '魅力 0 價錢不變');
    ok(G.shopPrice('sword', 0, plain, 3) === Math.round(300 * 0.85) && G.shopPrice('sword', 0, plain, -1) === Math.round(300 * 1.05) && G.shopPrice('sword', 0, plain, 2) === 270, `買價：魅力 +3 ${G.shopPrice('sword', 0, plain, 3)}、-1 ${G.shopPrice('sword', 0, plain, -1)}`);
    ok(G.shopPrice('heavy', 1, poor, 3) === Math.round(870 * 1.1 * 1.6 * 0.85), '魅力疊在聚落經濟倍率上');
    ok(G.shopPrice('pick', 0, plain, 3) === Math.round(200 * 0.85) && G.shopPrice('pick', 0, plain, 0) === 200, '礦鎬、鐮刀也看魅力，不看經濟');
    const sw = G.make('sword', 0, 1);
    ok(G.sellPrice(sw, 0) === 150 && G.sellPrice(sw, 3) === Math.round(150 * 1.15) && G.sellPrice(sw, -1) === Math.round(150 * 0.95), `賣價：${G.sellPrice(sw, 3)}`);
    ok(G.orePrice(3, 0) === 150 && G.orePrice(3, 3) === Math.round(150 * 1.15) && G.orePrice(3) === 150, '礦石賣價');
    sw.dur = 100;
    ok(G.repairQuote(sw, plain, 0).cost === 150 && G.repairQuote(sw, plain, 3).cost === Math.round(150 * 0.85) && G.repairQuote(sw, plain, 3).restore === 100, `修復費：${G.repairQuote(sw, plain, 3).cost}`);
    ok(G.craftQuote('sword', plain, 0).fee === 150 && G.craftQuote('sword', plain, 3).fee === Math.round(150 * 0.85) && G.craftQuote('sword', plain, 3).ore === 3, `打造工錢：${G.craftQuote('sword', plain, 3).fee}`);
    // 真的在工匠那裡買賣修造
    for (const [cls, picks, cha] of [['priest', ['shield', 'sword', 'gold'], 3], ['warrior', ['sword', 'herb', 'gold'], -1]]) {
      const g = mk(36, cls, picks);
      const p = g.player;
      ok(g.chaMod() === cha, `${cls} 的魅力修正值 ${g.chaMod()}`);
      const smith = g.world.npcs.find((n) => FE.Gear.isShopkeeper(n));
      const v = g.world.villageById(smith.villageId);
      p.copper = 1000;
      ok(shopDo(g, smith, 'buyItem:sword:0') && p.copper === 1000 - G.shopPrice('sword', 0, v, cha), `${cls} 買劍花了 ${1000 - p.copper}（應該 ${G.shopPrice('sword', 0, v, cha)}）`);
      const spare = p.bag.find((e) => e.id === 'gear' && e.gear.type === 'sword').gear;
      p.copper = 0;
      ok(shopDo(g, smith, 'sellItem:' + spare.id) && p.copper === G.sellPrice(spare, cha), `${cls} 賣劍得到 ${p.copper}（應該 ${G.sellPrice(spare, cha)}）`);
      g.bagAdd('ore', 3);
      p.copper = 0;
      ok(shopDo(g, smith, 'sellOre') && p.copper === G.orePrice(3, cha), `${cls} 賣 3 顆礦石得到 ${p.copper}（應該 ${G.orePrice(3, cha)}）`);
      p.equip.main.dur = 100;
      p.copper = 1000;
      const q = G.repairQuote(p.equip.main, v, cha);
      ok(shopDo(g, smith, 'repairItem:' + p.equip.main.id) && p.copper === 1000 - q.cost, `${cls} 修劍花了 ${1000 - p.copper}（應該 ${q.cost}）`);
      g.bagAdd('ore', 3);
      p.copper = 1000;
      ok(shopDo(g, smith, 'craftItem:sword') && p.copper === 1000 - G.craftQuote('sword', v, cha).fee && g.bagCount('ore') === 0, `${cls} 打造花了 ${1000 - p.copper}（應該 ${G.craftQuote('sword', v, cha).fee}）`);
      // 委託的金錢獎勵（第三十版：再乘委託人聚落的經濟標籤倍率）
      const npc = g.world.npcs.find((n) => !FE.Gear.isShopkeeper(n));
      const nv = g.world.villageById(npc.villageId);
      p.copper = 0;
      p.lodging = null;
      p.jobs.hunt = { kind: 'hunt', giverId: npc.id, villageId: npc.villageId, monsterIds: [], total: 1, village: '某村', exp: 1, copper: 100, compute: 0 };
      const want = Math.round(100 * FE.Steading.questEcon(nv) * (1 + 0.05 * cha));
      const t = g.talkOptions(npc);
      const idx = t.options.findIndex((o) => o.id === 'report');
      ok(idx >= 0 && t.options[idx].note.includes(FE.money(want)), `${cls} 回報選項的獎勵寫 ${idx >= 0 && t.options[idx].note}（應該 ${FE.money(want)}）`);
      g.choose(npc, idx);
      ok(p.copper === want, `${cls} 領到 ${p.copper} 銅（應該 ${want}）`);
    }
    // 送貨委託交件也加成
    {
      const g = mk(37, 'priest', ['shield', 'sword', 'gold']);
      const p = g.player;
      const npcs = g.world.npcs.filter((n) => !FE.Gear.isShopkeeper(n));
      const giver = npcs[0];
      const target = npcs[1] || npcs[0];
      p.jobs.deliver = { kind: 'deliver', giverId: giver.id, villageId: giver.villageId, targetId: target.id, targetName: target.name, targetVillage: '某村', steps: 10, exp: 1, copper: 200, compute: 0 };
      p.lodging = null;
      g.bagAdd('goods', 1, { name: '信', giverId: giver.id });
      const t = g.talkOptions(target);
      const idx = t.options.findIndex((o) => o.id === 'deliver');
      p.copper = 0;
      ok(idx >= 0, '收貨人該有交件的選項');
      const want = Math.round(200 * FE.Steading.questEcon(g.world.villageById(giver.villageId)) * 1.15);
      g.choose(target, idx);
      ok(p.copper === want, `魅力 +3 的送貨獎勵 20 銀（乘經濟標籤）該是 ${want} 銅，量到 ${p.copper}`);
    }
    // 智力管法師的範圍魔攻（命中、傷害、範圍），感知管射程與暴擊；近戰的命中與傷害不受影響
    const g = mk(38, 'mage');
    const p = g.player;
    const snap = () => JSON.stringify([p.maxHp, g.carryLimit(), G.playerDefense(p), G.hitMod(p), Ch.dmgBonus(p), g.chaMod()]);
    const s0 = snap();
    const sp0 = Ch.profile(p, p.equip.main, 'spell');
    p.attr.int = 18;
    p.attr.wis = 14;
    const sp1 = Ch.profile(p, p.equip.main, 'spell');
    ok(snap() === s0, '智力、感知不該改近戰與防禦的數字');
    ok(sp1.hit - sp0.hit === 1 && sp1.dmg - sp0.dmg === 1 && Ch.critMin(p, p.equip.main) === 19 && Ch.range(p, [5, 20]).join() === '7,22', `智力 18 的魔攻命中、傷害各 +1，感知 14 的暴擊 19、射程 +2：${sp1.hit - sp0.hit}、${sp1.dmg - sp0.dmg}、${Ch.critMin(p, p.equip.main)}、${Ch.range(p, [5, 20])}`);
  }

  // 10. 負重上限跟著力量重算
  {
    const g = mk(39, 'mage');
    const p = g.player;
    const lim = g.carryLimit();
    ok(lim === 120 && g.pushLimit() === 240, `法師（力量 8）能背 ${lim}、推拖上限 ${g.pushLimit()}（應該 120、240）`);
    p.bag = [];
    g.bagAdd('ore', Math.ceil((lim + 1 - g.weight()) / 10));
    ok(g.loadTier() === 1, `法師超過能背該是第一段：${g.loadTier()}`);
    g.bagAdd('ore', 12);
    ok(g.loadTier() === 2, `超過推拖上限該是第二段：${g.loadTier()}`);
    p.attr.str = 16; // 負重只看力量值，不看職業與修正值
    ok(g.carryLimit() === 240 && g.pushLimit() === 480, `力量 16 的法師能背 ${g.carryLimit()}（應該 240）`);
    p.bag = [];
    p.attr.str = 18;
    ok(g.carryLimit() === 270 && g.pushLimit() === 540, `力量 18 的法師能背 ${g.carryLimit()}（應該 270）`);
    const w = mk(39, 'warrior').player;
    w.attr.str = 18;
    ok(Ch.carryLimit(w) === 270 && Ch.carryLimit(mk(39, 'warrior').player) === 240, '力量 18 的戰士能背 270，力量 16 是 240（跟職業無關）');
  }

  // 11. 技能（第二十九版，照 Dwarf Fortress）：升到第 N 級要 400＋100N 點經驗，等級沒有上限，15 級以上是傳奇
  {
    ok(Ch.skillNeed(0) === 500 && Ch.skillNeed(1) === 600 && Ch.skillNeed(14) === 1900 && Ch.skillNeed(19) === 2400, `升級門檻不對：${Ch.skillNeed(0)}、${Ch.skillNeed(1)}、${Ch.skillNeed(14)}`);
    ok(Object.keys(FE.SKILLS).join() === 'sword,spear,knife,staff,axe,mace,whip,bow,crossbow,misc,fight,shoot,dodge,light,medium,heavy,shield' && C.SKILL_MAX === undefined, '技能名單不對（劍術、槍術、刀術、杖術、斧術、錘術、鞭術、弓術、弩術、雜物使用、格鬥、射擊、閃避、輕甲、中甲、重甲、盾牌使用）');
    ok(FE.SKILLS.sword.name === '劍術' && FE.SKILLS.spear.name === '槍術' && FE.SKILLS.knife.name === '刀術' && FE.SKILLS.staff.name === '杖術' && FE.SKILLS.axe.name === '斧術' && FE.SKILLS.mace.name === '錘術' &&FE.SKILLS.whip.name === '鞭術' && FE.SKILLS.bow.name === '弓術' && FE.SKILLS.crossbow.name === '弩術' && FE.SKILLS.misc.name === '雜物使用' && FE.SKILLS.fight.name === '格鬥' && FE.SKILLS.shoot.name === '射擊' && FE.SKILLS.light.name === '輕甲' && FE.SKILLS.medium.name === '中甲' && FE.SKILLS.heavy.name === '重甲', '技能的名字不對');
    ok(FE.SKILL_LEVELS.join() === '涉獵,新手,尚可,稱職,熟練,精熟,有天分,老練,專家,職業級,卓越,傑出,大師,高階大師,宗師,傳奇' && FE.skillLevelName(15) === '傳奇' && FE.skillLevelName(16) === '傳奇 +1' && FE.skillLevelName(30) === '傳奇 +15' && FE.skillLevelName(0) === '涉獵' && FE.skillLevelName(7) === '老練', '等級名稱不對');
    const g = mk(40, 'warrior');
    const p = g.player;
    ok(Ch.expFactor(p) === 0.9, `戰士智力 9（-1）：技能經驗 ×${Ch.expFactor(p)}（應該 0.9）`);
    p.attr.int = 10;
    for (let i = 0; i < 49; i++) Ch.useSkill(g, 'sword', 10);
    ok(p.skills.sword.lv === 0 && p.skills.sword.n === 490, `49 次命中（490 點）還是 0 級：${p.skills.sword.lv}，${p.skills.sword.n}`);
    Ch.useSkill(g, 'sword', 10);
    ok(p.skills.sword.lv === 1 && p.skills.sword.n === 0 && /劍術.*1 級.*新手/.test(g.log[0].text), `500 點升 1 級：${p.skills.sword.lv}，訊息「${g.log[0].text}」`);
    for (let i = 0; i < 59; i++) Ch.useSkill(g, 'sword', 10);
    ok(p.skills.sword.lv === 1 && p.skills.sword.n === 590, '1 級升 2 級要 600 點');
    Ch.useSkill(g, 'sword', 10);
    ok(p.skills.sword.lv === 2 && p.skills.sword.n === 0 && /尚可/.test(g.log[0].text), '600 點升 2 級');
    // 沒有上限：一直升，15 級以上是傳奇；一次給很多經驗可以連升
    let total = 0;
    for (let l = 2; l < 30; l++) total += Ch.skillNeed(l);
    Ch.useSkill(g, 'sword', total);
    ok(p.skills.sword.lv === 30 && p.skills.sword.n === 0 && g.log.some((l) => /傳奇 \+15/.test(l.text)), `沒有等級上限：${p.skills.sword.lv}`);
    let t15 = 0;
    for (let l = 0; l < 15; l++) t15 += Ch.skillNeed(l);
    ok(t15 === 18000, `升到 15 級共要 ${t15} 點經驗（應該 18000）`);
    // 智力修正值：每點 ±10%，最少 ×0.5
    const iq = (v) => { p.attr.int = v; p.skills.dodge = { lv: 0, n: 0 }; Ch.useSkill(g, 'dodge', 10); return p.skills.dodge.n; };
    ok(iq(10) === 10 && iq(12) === 11 && iq(18) === 14 && iq(8) === 9 && iq(3) === 6 && iq(1) === 5, `智力對經驗的倍率：10→${iq(10)}、12→${iq(12)}、18→${iq(18)}、8→${iq(8)}、3→${iq(3)}、1→${iq(1)}（每點 ±10%，最少 ×0.5）`);
    // 加成：武器技能命中每 5 級 +1、傷害每 3 級 +1（只算主手武器那一項）
    const q = mk(41, 'warrior').player;
    const bonus = (lv) => { q.skills.sword.lv = lv; return [Ch.skillHit(q), Ch.skillDmg(q)]; };
    ok(bonus(0).join() === '0,0' && bonus(2).join() === '0,0' && bonus(3).join() === '0,1' && bonus(4).join() === '0,1' && bonus(5).join() === '1,1' && bonus(6).join() === '1,2' && bonus(10).join() === '2,3' && bonus(15).join() === '3,5' && bonus(20).join() === '4,6' && bonus(40).join() === '8,13', '武器技能的命中與傷害加成不對');
    q.skills.sword.lv = 20;
    q.equip.main = G.make('dagger', 0, 80);
    ok(Ch.skillHit(q) === 0 && Ch.skillDmg(q) === 0 && Ch.weaponSkill(q) === 'knife', '短刀練刀術，不吃劍術');
    q.equip.main = null;
    ok(Ch.skillHit(q) === 0 && Ch.dmgBonus(q) === Ch.attrMod(q, 'str') && Ch.weaponSkill(q) === null, '空手沒有武器技能');
    // 格鬥：所有近戰出手都練（含徒手），命中每 10 級 +1，跟武器技能疊加；徒手只吃格鬥
    q.skills.fight.lv = 25;
    ok(Ch.fightHit(q) === 2 && Ch.profile(q, null, 'melee').hit === Ch.attrMod(q, 'dex') + 2 && Ch.profile(q, null, 'melee').skills.join() === 'fight', '徒手只吃格鬥（25 級命中 +2）');
    q.equip.main = G.make('sword', 0, 79);
    q.skills.sword.lv = 10;
    q.skills.fight.lv = 10;
    ok(Ch.profile(q, q.equip.main, 'melee').hit === Ch.attrMod(q, 'dex') + 2 + 1 && Ch.profile(q, q.equip.main, 'melee').skills.join() === 'sword,fight', '格鬥 10 級＋劍術 10 級的近戰命中該疊成 +3');
    q.skills.fight.lv = 0;
    q.equip.main = G.make('bow', 0, 81);
    ok(Ch.weaponSkill(q) === 'bow' && Ch.weaponSkill(q, undefined, 'melee') === 'sword', '弓箭射擊練弓術，拿弓近戰練劍術');
    // 遠程：武器技能只加傷害，命中看射擊（每 5 級 +1）
    q.skills.bow.lv = 9;
    q.skills.shoot.lv = 10;
    const sh = Ch.profile(q, q.equip.main, 'shoot');
    ok(sh.dmg === Ch.attrMod(q, 'dex') + 3 && sh.hit === Ch.attrMod(q, 'dex') + 2 && sh.skills.join() === 'bow,shoot', `弓箭 9 級傷害 +3、射擊 10 級命中 +2：傷害 ${sh.dmg}、命中 ${sh.hit}`);
    q.equip.main = G.make('dagger', 0, 83);
    q.skills.knife.lv = 6;
    const th = Ch.profile(q, q.equip.main, 'throw');
    const best = Math.max(Ch.attrMod(q, 'str'), Ch.attrMod(q, 'dex'));
    ok(th.dmg === best + 2 && th.hit === best + 2 && th.skills.join() === 'knife,shoot', `投擲短刀：傷害吃刀術（+2）、命中吃射擊（+2）：傷害 ${th.dmg}、命中 ${th.hit}`);
    q.equip.main = G.make('staff', 0, 82);
    ok(Ch.weaponSkill(q) === 'staff', '法杖練杖術');
    // 實際的傷害加成：劍術 6 級 → 傷害 +2、命中 +1
    const g2 = mk(42, 'warrior', ['sword', 'herb', 'gold']);
    const p2 = g2.player;
    p2.skills.sword.lv = 6;
    p2.attr.str = 10;
    const m = arena(g2, 'RUNTIME');
    const seen = [];
    FE.Combat.hook = (e) => { if (e.by === 'player' && (e.key === 'hit' || e.key === 'hard') && !e.dodged && !e.crit && !e.blocked && !e.resisted) seen.push(e.dmg); };
    for (let i = 0; i < 400; i++) { p2.hp = p2.maxHp = 1e9; p2.equip.main.dur = p2.equip.main.max = 1e9; p2.skills.sword = { lv: 6, n: 0 }; FE.Combat.resolveAttack(g2, p2, m, 'attack', { noCounter: true }); }
    FE.Combat.hook = hook0;
    ok(Math.min(...seen) === 1 + 2 && Math.max(...seen) === 10 + 2, `長劍 6 級（副手空著 1d10）傷害該 +2：量到 ${Math.min(...seen)}～${Math.max(...seen)}`);
    p2.skills.sword = { lv: 6, n: 0 };
    ok(G.hitMod(p2) === 1 + 1, `劍術 6 級命中該 +1（再加敏捷 13 的 +1）：${G.hitMod(p2)}`);
  }
  // 技能怎麼算用一次
  {
    const g = mk(43, 'warrior', ['sword', 'shield', 'herb']);
    const p = g.player;
    const m = arena(g, 'RUNTIME');
    p.equip.main.dur = p.equip.main.max = 1e9;
    p.attr.int = 10; // 智力修正值 0：經驗倍率 ×1
    // 出手命中一次 10 點、沒命中 5 點（反擊不算）：近戰出手練武器技能與格鬥
    let hits = 0;
    let miss = 0;
    FE.Combat.hook = (e) => { if (e.by === 'player' && !e.counter) { if (e.key === 'crit' || e.key === 'hit' || e.key === 'hard') hits++; else miss++; } };
    const gained = () => hits * C.SKILL_EXP_HIT + miss * C.SKILL_EXP_MISS;
    const zero = (...ids) => Object.keys(FE.SKILLS).every((k) => ids.includes(k) || uses(p, k) === 0);
    for (let i = 0; i < 50; i++) { p.hp = p.maxHp = 1e9; FE.Combat.resolveAttack(g, p, m, 'attack', { noCounter: true }); }
    ok(hits > 10 && miss > 0 && uses(p, 'sword') === gained() && uses(p, 'fight') === gained() && zero('sword', 'fight'), `出手 50 次（命中 ${hits}、沒命中 ${miss}），劍術與格鬥各 ${gained()} 點：${uses(p, 'sword')}、${uses(p, 'fight')}`);
    for (let i = 0; i < 10; i++) FE.Combat.resolveAttack(g, p, m, 'deep', { noCounter: true });
    ok(uses(p, 'sword') === gained() && uses(p, 'fight') === gained(), `重擊也算：${uses(p, 'sword')}／${gained()}`);
    const before = uses(p, 'sword');
    for (let i = 0; i < 10; i++) FE.Combat.resolveAttack(g, p, m, 'attack', { noCounter: true, counter: true });
    ok(uses(p, 'sword') === before, '反擊不算練技能');
    const sword = p.equip.main;
    // 徒手：只練格鬥
    p.equip.main = null;
    for (let i = 0; i < 10; i++) FE.Combat.resolveAttack(g, p, m, 'attack', { noCounter: true });
    ok(uses(p, 'sword') === before && uses(p, 'fight') === gained() && zero('sword', 'fight'), `徒手出手只練格鬥：劍術 ${uses(p, 'sword')}（應該不變 ${before}）、格鬥 ${uses(p, 'fight')}（應該 ${gained()}）`);
    // 拿弓近戰練劍術與格鬥（不練弓術）；射擊練弓術與射擊
    p.equip.main = G.make('bow', 0, g.nextGearId++);
    p.equip.main.dur = p.equip.main.max = 1e9;
    const t1 = gained();
    const f1 = uses(p, 'fight');
    const sw1 = uses(p, 'sword');
    for (let i = 0; i < 10; i++) FE.Combat.resolveAttack(g, p, m, 'attack', { noCounter: true });
    ok(uses(p, 'bow') === 0 && uses(p, 'sword') - sw1 === gained() - t1 && uses(p, 'fight') - f1 === gained() - t1 && uses(p, 'shoot') === 0, `拿弓近戰練劍術與格鬥（不練弓術）：弓術 ${uses(p, 'bow')}、劍術 +${uses(p, 'sword') - sw1}、格鬥 +${uses(p, 'fight') - f1}（應該各 +${gained() - t1}）`);
    // 拿弩近戰練重錘術
    p.equip.main = G.make('crossbow', 0, g.nextGearId++);
    p.equip.main.dur = p.equip.main.max = 1e9;
    const h0 = gained();
    for (let i = 0; i < 10; i++) FE.Combat.resolveAttack(g, p, m, 'attack', { noCounter: true });
    ok(uses(p, 'mace') === gained() - h0 && uses(p, 'crossbow') === 0, `拿弩近戰練錘術：錘術 ${uses(p, 'mace')}（應該 ${gained() - h0}）、弩術 ${uses(p, 'crossbow')}`);
    // 射擊：弓術（管傷害）＋射擊（管命中）；弩射擊練弩術＋射擊
    p.equip.main = G.make('bow', 0, g.nextGearId++);
    const s0 = gained();
    for (let i = 0; i < 7; i++) FE.Combat.resolveAttack(g, p, m, 'attack', { noCounter: true, mode: 'shoot', range: [5, 20] });
    ok(uses(p, 'bow') === gained() - s0 && uses(p, 'shoot') === gained() - s0 && uses(p, 'bow') >= 35, `射擊 7 次：弓術 ${uses(p, 'bow')}、射擊 ${uses(p, 'shoot')}（應該各 ${gained() - s0}）`);
    p.equip.main = G.make('crossbow', 0, g.nextGearId++);
    const s1 = gained();
    for (let i = 0; i < 5; i++) FE.Combat.resolveAttack(g, p, m, 'attack', { noCounter: true, mode: 'shoot', range: [5, 20] });
    ok(uses(p, 'crossbow') === gained() - s1 && uses(p, 'shoot') === gained() - s0 && uses(p, 'bow') === s1 - s0, `弩射擊練弩術與射擊：弩術 ${uses(p, 'crossbow')}、射擊 ${uses(p, 'shoot')}（累積應該 ${gained() - s0}）`);
    // 投擲也練射擊（短刀練刀術）
    p.equip.main = G.make('dagger', 0, g.nextGearId++);
    p.equip.main.dur = p.equip.main.max = 1e9;
    const s2 = gained();
    const sh2 = uses(p, 'shoot');
    for (let i = 0; i < 4; i++) FE.Combat.resolveAttack(g, p, m, 'attack', { noCounter: true, mode: 'throw', range: [4, 12] });
    ok(uses(p, 'knife') === gained() - s2 && uses(p, 'shoot') - sh2 === gained() - s2, `投擲 4 次：刀術 ${uses(p, 'knife')}、射擊 +${uses(p, 'shoot') - sh2}（應該各 ${gained() - s2}）`);
    // 盾擊：練雜物使用與格鬥（不練盾牌使用）
    const f0 = uses(p, 'fight');
    const b0 = gained();
    for (let i = 0; i < 5; i++) FE.Combat.resolveAttack(g, p, m, 'attack', { noCounter: true, mode: 'bash' });
    ok(uses(p, 'misc') === gained() - b0 && uses(p, 'fight') - f0 === gained() - b0 && uses(p, 'shield') === 0, `盾擊 5 次：雜物使用 ${uses(p, 'misc')}、格鬥 +${uses(p, 'fight') - f0}（應該各 ${gained() - b0}）、盾牌使用 ${uses(p, 'shield')}`);
    // 法師的範圍魔攻練杖術（不練射擊、格鬥）
    const mageG = mk(46, 'mage', ['staff', 'gold']);
    const mp = mageG.player;
    mp.attr.int = 10;
    const mm = arena(mageG, 'RUNTIME');
    FE.Combat.hook = hook0;
    for (let i = 0; i < 6; i++) FE.Combat.resolveAttack(mageG, mp, mm, 'attack', { noCounter: true, mode: 'spell', range: [5, 20] });
    ok(uses(mp, 'staff') >= 30 && uses(mp, 'staff') <= 60 && uses(mp, 'fight') === 0 && uses(mp, 'shoot') === 0, `範圍魔攻練杖術：${uses(mp, 'staff')}，格鬥 ${uses(mp, 'fight')}、射擊 ${uses(mp, 'shoot')}`);
    FE.Combat.hook = null;
    p.equip.main = sword;
    // 閃避：閃開一次算一次（含趁機、纏上的那一下）；盾牌使用：格擋成功一次算一次
    let dodged = 0;
    let blocked = 0;
    FE.Combat.hook = (e) => { if (e.d === p && e.by === 'monster') { if (e.dodged) dodged++; if (e.blocked) blocked++; } };
    for (let i = 0; i < 800; i++) {
      p.hp = p.maxHp = 1e9;
      p.equip.off.dur = p.equip.off.max = 1e9;
      p.block = null; // 格擋值每下都從滿的開始，不然很快就吸收不了
      FE.Combat.resolveAttack(g, m, p, 'attack', { noCounter: true, ...(i % 7 === 0 ? { cling: true, clingWord: '後退' } : {}) });
    }
    FE.Combat.hook = hook0;
    ok(dodged > 20 && uses(p, 'dodge') === dodged * C.SKILL_EXP_DODGE, `閃開 ${dodged} 次，閃避技能經驗 ${uses(p, 'dodge')}（應該 ${dodged * 10}）`);
    ok(blocked > 20 && uses(p, 'shield') === blocked * C.SKILL_EXP_BLOCK, `格擋成功 ${blocked} 次，盾牌使用經驗 ${uses(p, 'shield')}（應該 ${blocked * 10}）`);
    // 閃避技能每級 +1%，盾牌使用每級 +2%
    const base = mk(44, 'warrior', ['sword', 'shield', 'herb']).player;
    const dBase = G.playerDefense(base);
    base.skills.dodge.lv = 7;
    base.skills.shield.lv = 5;
    const dSk = G.playerDefense(base);
    ok(near(dSk.dodge - dBase.dodge, 0.07) && near(dSk.block - dBase.block, 0.10) && dSk.blockMax === dBase.blockMax, `閃避 7 級 +7%、盾牌使用 5 級 +10%：${dSk.dodge - dBase.dodge}、${dSk.block - dBase.block}`);
  }
  // 穿甲（第二十九版）：穿著防具被打中而且防具擋下傷害時 10 點經驗；身上防具的重量照 DF 表打折；
  // 5 級起中甲不多花刻、重甲少 1 刻，10 級起重甲不多花刻；輕甲、中甲、重甲各練各的（第二十九版追加）
  {
    const g = mk(45, 'warrior', ['sword', 'herb', 'gold']); // 固定中甲
    const p = g.player;
    p.attr.int = 10;
    const m = arena(g, 'RUNTIME');
    m.atk = 5;
    let armorHits = 0;
    FE.Combat.hook = (e) => { if (e.d === p && e.by === 'monster' && e.reduced > 0) armorHits++; };
    const hitMe = (n) => { for (let i = 0; i < n; i++) { p.hp = p.maxHp = 1e9; p.equip.body.dur = p.equip.body.max = 1e9; FE.Combat.resolveAttack(g, m, p, 'attack', { noCounter: true }); } };
    hitMe(300);
    ok(armorHits > 50 && uses(p, 'medium') === armorHits * C.SKILL_EXP_ARMOR && uses(p, 'light') === 0 && uses(p, 'heavy') === 0, `穿中甲被打中、防具擋下傷害 ${armorHits} 次，中甲經驗 ${uses(p, 'medium')}（應該 ${armorHits * 10}），輕甲 ${uses(p, 'light')}、重甲 ${uses(p, 'heavy')} 該是 0`);
    const a1 = uses(p, 'medium');
    p.equip.body = G.make('robe', 0, 90); // 衣袍擋不住物理傷害（物理減傷 0），不算
    for (let i = 0; i < 200; i++) { p.hp = p.maxHp = 1e9; p.equip.body.dur = 1e9; FE.Combat.resolveAttack(g, m, p, 'attack', { noCounter: true }); }
    ok(uses(p, 'medium') === a1 && uses(p, 'light') === 0, '防具沒擋下傷害（衣袍物理減傷 0）不練穿甲');
    p.equip.body = null;
    for (let i = 0; i < 100; i++) { p.hp = p.maxHp = 1e9; FE.Combat.resolveAttack(g, m, p, 'attack', { noCounter: true }); }
    ok(uses(p, 'medium') === a1 && uses(p, 'light') === 0 && uses(p, 'heavy') === 0, '沒穿防具不練穿甲');
    FE.Combat.hook = hook0;
    // 走路、休息不再練穿甲
    p.equip.body = G.make('heavy', 0, 91);
    for (let i = 0; i < 30; i++) g.endTurn(false);
    ok(uses(p, 'medium') === a1 && uses(p, 'heavy') === 0, '穿甲不再靠做動作練');
    // 穿輕甲被打中練輕甲、穿重甲練重甲，各練各的
    for (const [type, id] of [['light', 'light'], ['heavy', 'heavy'], ['studded', 'light'], ['ringmail', 'heavy'], ['hide', 'medium']]) {
      p.equip.body = G.make(type, 0, 94);
      const before = ['light', 'medium', 'heavy'].map((k) => uses(p, k));
      let got = 0;
      FE.Combat.hook = (e) => { if (e.d === p && e.by === 'monster' && e.reduced > 0) got++; };
      hitMe(200);
      FE.Combat.hook = hook0;
      const after = ['light', 'medium', 'heavy'].map((k) => uses(p, k));
      const idx = ['light', 'medium', 'heavy'].indexOf(id);
      if (FE.GEAR[type].phys > 0) ok(got > 20 && after[idx] - before[idx] === got * C.SKILL_EXP_ARMOR && after.every((x, i) => i === idx || x === before[i]), `${FE.GEAR[type].name} 只練${FE.SKILLS[id].name}：+${after[idx] - before[idx]}（擋下 ${got} 次）`);
      else ok(got === 0 && after.every((x, i) => x === before[i]), `${FE.GEAR[type].name} 物理減傷 0，擋不下傷害，不練穿甲`);
    }
    m.atk = 5;
    // 重量：身上防具照那一類穿甲技能打折（DF 表），背包裡的不打折
    const mul = [1, 1, 0.8125, 0.75, 0.6875, 0.625, 0.5625, 0.5, 0.4375, 0.375, 0.3125, 0.25, 0.1875, 0.125, 0.0625, 0];
    p.bag = [];
    p.equip = { main: null, off: null, body: G.make('heavy', 0, 92) };
    ok(mul.every((x, lv) => { p.skills.heavy.lv = lv; return near(G.weightOf(p), 50 * x, 0.01) && near(Ch.armorWeightMul(p), x); }) && (p.skills.heavy.lv = 40, near(G.weightOf(p), 0) && near(Ch.armorWeightMul(p), 0)), '重甲的減重：0～1 級 ×1、2 級 ×0.8125⋯⋯14 級 ×0.0625、15 級以上 ×0');
    p.skills.heavy.lv = 0;
    p.skills.medium.lv = 15;
    ok(near(G.weightOf(p), 50), `中甲練到 15 級，身上穿的是重甲，重量不打折：${G.weightOf(p)}`);
    p.skills.heavy.lv = 10;
    g.bagAddGear(G.make('medium', 0, 93));
    ok(near(G.weightOf(p), 50 * 0.3125 + 45, 0.01), `背包裡的防具不打折：${G.weightOf(p)}`);
    p.bag = [];
    p.skills.medium.lv = 0;
    // 刻數：不看超重（負重夠）
    const ticksOf = (type, lv) => {
      p.equip.body = G.make(type, 0, 92);
      const id = FE.ARMOR_SKILL[FE.GEAR[type].cls];
      for (const k of ['light', 'medium', 'heavy']) p.skills[k] = { lv: k === id ? lv : 0, n: 0 };
      const t0 = g.ticks || 0;
      g.endTurn(false);
      return g.ticks - t0;
    };
    ok(ticksOf('medium', 0) === 11 && ticksOf('medium', 4) === 11 && ticksOf('medium', 5) === 10 && ticksOf('medium', 20) === 10, '中甲：0～4 級多 1 刻，5 級起不多花');
    ok(ticksOf('heavy', 0) === 12 && ticksOf('heavy', 4) === 12 && ticksOf('heavy', 5) === 11 && ticksOf('heavy', 9) === 11 && ticksOf('heavy', 10) === 10 && ticksOf('heavy', 20) === 10, '重甲：0～4 級多 2 刻、5～9 級多 1 刻、10 級起不多花');
    ok(ticksOf('light', 0) === 10, '輕甲不多花刻');
    ok(ticksOf('hide', 0) === 11 && ticksOf('hide', 5) === 10 && ticksOf('ringmail', 0) === 12 && ticksOf('ringmail', 10) === 10, '厚皮甲照中甲、環甲照重甲算多花的刻');
    // 一種穿甲技能的等級不影響另一種：中甲 20 級穿重甲照樣多 2 刻
    p.equip.body = G.make('heavy', 0, 93);
    p.skills.medium = { lv: 20, n: 0 };
    p.skills.heavy = { lv: 0, n: 0 };
    { const t0 = g.ticks || 0; g.endTurn(false); ok(g.ticks - t0 === 12, `中甲 20 級穿重甲該多 2 刻：${g.ticks - t0}`); }
    p.skills.medium = { lv: 0, n: 0 };
    p.skills.dodge = { lv: 0, n: 0 };
    ok(near(G.playerDefense(p).dodge, C.PLAYER_DODGE) && (p.skills.heavy.lv = 15, near(G.playerDefense(p).dodge, C.PLAYER_DODGE)), '重甲不加也不扣敏捷的閃避（穿甲技能不影響）');
  }
  // 12. 短刀是靈巧武器（力量與敏捷取較高者）；雙持：副手只能拿輕型武器，按 1 兩下各擲一次、不扣減值，副手不加正的修正值，重擊只用主手
  {
    const outside = (g) => {
      const w = g.world;
      for (const ch of w.chunks) for (let y = 0; y < ch.cells.length; y++) for (let x = 0; x < ch.cells[y].length; x++) {
        const X = ch.x0 + x, Y = ch.y0 + y;
        if (w.passable(X, Y) && !w.villageAt(X, Y) && !w.inBuffer(X, Y) && w.passable(X + 1, Y) && w.heightOk(X, Y, X + 1, Y)) return { x: X, y: Y };
      }
      return null;
    };
    const setup = () => {
      const g = mk(50, 'ranger', ['dagger']);
      const p = g.player;
      const at = outside(g);
      p.x = at.x; p.y = at.y;
      const m = arena(g, 'RUNTIME');
      m.type = 'RUNTIME';
      m.atk = 0;
      p.equip.main.dur = p.equip.main.max = 1000;
      return { g, p, m };
    };
    const lines = (g, re) => g.log.filter((l) => re.test(l.text));
    const modOf = (l) => { const r = /擲出 \d+([+-]\d+)?：/.exec(l.text); return r && r[1] ? Number(r[1]) : 0; };
    // 重擊：短刀傷害骰擲兩次＋較高修正值，不再減半。遊俠敏捷 16（+3）、力量 12（+1）：2d4＋3 ＝ 5～11
    {
      const { g, p, m } = setup();
      const seen = [];
      FE.Combat.hook = (e) => { if (e.by === 'player' && (e.key === 'hit' || e.key === 'hard') && !e.dodged && !e.crit && !e.blocked && !e.resisted && !e.counter) seen.push(e.dmg); };
      for (let i = 0; i < 1500; i++) { p.hp = p.maxHp = 1e9; p.equip.main.dur = 1000; p.skills = Ch.freshSkills(); FE.Combat.resolveAttack(g, p, m, 'deep', { noCounter: true }); }
      FE.Combat.hook = hook0;
      ok(Math.min(...seen) === 5 && Math.max(...seen) === 11, `短刀重擊該是 2d4+3 ＝ 5～11，量到 ${Math.min(...seen)}～${Math.max(...seen)}`);
    }
    // 雙持的一般攻擊：兩下各擲一次、不扣減值，各算一次短刀技能、各磨損一次；副手那一下不加正的屬性修正值（負的照扣）；
    // 有迅切（遊俠一開始就會）不多花刻，沒有就多 5 刻
    {
      const { g, p, m } = setup();
      p.hp = p.maxHp = 1e9;
      const ms0 = FE.MASTERY_SKILL;
      FE.MASTERY_SKILL = 5; // 第二十九版追加：精通一律要技能 5 級
      p.skills.knife = { lv: 5, n: 0 };
      g.strike('attack', m);
      const base = modOf(lines(g, /^你攻擊/)[0]);
      const u0 = uses(p, 'knife');
      p.equip.off = G.make('dagger', 0, g.nextGearId++);
      p.equip.off.dur = p.equip.off.max = 1000;
      const d0 = p.equip.main.dur;
      g.log.length = 0;
      const t0 = g.ticks;
      g.strike('attack', m);
      const a = lines(g, /^你攻擊/);
      const b = lines(g, /^你用副手攻擊/);
      ok(a.length === 1 && b.length === 1, `雙持按 1 該主手、副手各出手一次：${a.length}、${b.length}`);
      ok(a.length && b.length && modOf(a[0]) === base && modOf(b[0]) === base, `雙持兩下的擲骰不扣減值：單手 ${base}、主手 ${a.length && modOf(a[0])}、副手 ${b.length && modOf(b[0])}`);
      ok(uses(p, 'knife') - u0 >= 2 * C.SKILL_EXP_MISS * Ch.expFactor(p) - 1e-6 && uses(p, 'knife') - u0 <= 2 * C.SKILL_EXP_HIT * Ch.expFactor(p) + 1e-6, `兩把各算一次刀術（命中 10 點、沒命中 5 點）：${uses(p, 'knife') - u0}`);
      ok(p.equip.main.dur === d0 - 1 && p.equip.off.dur === 999, `兩把各磨損一次：主手 ${d0 - p.equip.main.dur}、副手 ${1000 - p.equip.off.dur}`);
      ok(g.ticks - t0 === Math.max(C.ATTACK_TICKS_MIN, C.ATTACK_TICKS.light - Ch.attrMod(p, 'dex')), `有迅切的雙持不多花刻：${g.ticks - t0}`);
      // 沒有迅切（當成法師、短刀技能 0 級）：多 5 刻
      p.cls = 'mage';
      p.skills.knife = { lv: 0, n: 0 };
      const t1 = g.ticks;
      g.strike('attack', m);
      ok(g.ticks - t1 === Math.max(C.ATTACK_TICKS_MIN, C.ATTACK_TICKS.light - Ch.attrMod(p, 'dex')) + C.DUAL_TICKS, `沒有迅切的雙持多 5 刻：${g.ticks - t1}`);
      p.skills.knife = { lv: 5, n: 0 };
      const t2 = g.ticks;
      g.strike('attack', m);
      ok(g.ticks - t2 === Math.max(C.ATTACK_TICKS_MIN, C.ATTACK_TICKS.light - Ch.attrMod(p, 'dex')), `法師短刀 5 級學會迅切，不多花刻：${g.ticks - t2}`);
      FE.MASTERY_SKILL = ms0;
      p.cls = 'ranger';
      // 副手那一下的傷害：遊俠力量 12、敏捷 16，主手 1d4+3 ＝ 4～7，副手 1d4 ＝ 1～4；兩項都 6（-2）時副手 1d4-2 最少 1 ＝ 1～2
      const dmgs = { main: [], off: [] };
      FE.Combat.hook = (e) => { if (e.by === 'player' && (e.key === 'hit' || e.key === 'hard') && !e.dodged && !e.crit && !e.blocked && !e.resisted && !e.counter) dmgs[e.off ? 'off' : 'main'].push(e.dmg); };
      for (let i = 0; i < 400; i++) { p.hp = p.maxHp = 1e9; p.skills = Ch.freshSkills(); p.equip.main.dur = p.equip.off.dur = 1000; g.battle.targetId = m.id; g.strike('attack', m); }
      const rng = (a) => [Math.min(...a), Math.max(...a)].join('～');
      ok(rng(dmgs.main) === '4～7' && rng(dmgs.off) === '1～4', `雙持傷害：主手 ${rng(dmgs.main)}（應該 4～7）、副手 ${rng(dmgs.off)}（應該 1～4）`);
      p.attr.str = 6;
      p.attr.dex = 6;
      dmgs.off = [];
      for (let i = 0; i < 400; i++) { p.hp = p.maxHp = 1e9; p.skills = Ch.freshSkills(); p.equip.main.dur = p.equip.off.dur = 1000; g.strike('attack', m); }
      FE.Combat.hook = hook0;
      ok(rng(dmgs.off) === '1～2', `修正值 -2 時副手照扣：${rng(dmgs.off)}（應該 1～2）`);
      p.attr.str = 12;
      p.attr.dex = 16;
      // 重擊只用主手
      g.log.length = 0;
      g.battle.cooldown = 0;
      const u1 = uses(p, 'knife');
      const od = p.equip.off.dur;
      g.strike('deep', m);
      const dl = lines(g, /^你對.*重擊/);
      ok(dl.length === 1 && lines(g, /^你用副手/).length === 0 && modOf(dl[0]) === base - 1 && uses(p, 'knife') - u1 <= C.SKILL_EXP_HIT * Ch.expFactor(p) + 1e-6 && uses(p, 'knife') > u1 && p.equip.off.dur === od, `重擊只用主手：${dl.length} 行、擲骰 ${dl.length && modOf(dl[0])}（單手 ${base}，技能重設後少刀術 5 級的 1）`);
      // 副手也吃自己的命中加值（品質）
      p.equip.off = G.make('dagger', 3, g.nextGearId++);
      p.equip.off.dur = p.equip.off.max = 1000;
      g.log.length = 0;
      g.battle.cooldown = 0;
      g.strike('attack', m);
      const a2 = lines(g, /^你攻擊/)[0];
      const b2 = lines(g, /^你用副手攻擊/)[0];
      ok(a2 && b2 && modOf(b2) - modOf(a2) === 3, `副手優秀短刀的命中加值 +3：主手 ${a2 && modOf(a2)}、副手 ${b2 && modOf(b2)}`);
    }
    // 目標在第一下倒下，第二下就不出手
    {
      const { g, p, m } = setup();
      p.equip.off = G.make('dagger', 0, g.nextGearId++);
      p.equip.off.dur = p.equip.off.max = 1000;
      let early = 0;
      let both = 0;
      let bad = 0;
      let ev = [];
      FE.Combat.hook = (e) => { if (e.by === 'player') ev.push(e); };
      for (let i = 0; i < 300; i++) {
        p.hp = p.maxHp = 1e9;
        const t = arena(g, 'RUNTIME');
        t.hp = 1;
        ev = [];
        g.battle.targetId = null;
        g.strike('attack', t);
        const main = ev.filter((e) => !e.counter);
        if (main[0] && main[0].killed) { if (main.length !== 1) bad++; early++; } else if (main.length === 2) both++;
        else if (main.length !== 2) bad++;
      }
      FE.Combat.hook = hook0;
      ok(early > 20 && both > 20 && bad === 0, `第一下打倒就不出第二下：第一下倒 ${early} 次、兩下都出 ${both} 次、不對 ${bad} 次`);
    }
    // 一個動作內擲出 6～10 的「必定反擊」最多觸發一次：主手觸發過，副手擲出 6～10 只算命中；主手沒觸發，副手照常觸發
    {
      const { g, p, m } = setup();
      m.type = 'CLIFF'; // 沒有自己的反擊機率，反擊只可能來自必定反擊
      p.equip.off = G.make('dagger', 0, g.nextGearId++);
      let ev = [];
      FE.Combat.hook = (e) => { if (e.by === 'player' && !e.counter) ev.push(e); };
      let firstThenHard = 0;
      let freshHard = 0;
      let bad = 0;
      let wordBad = 0;
      for (let i = 0; i < 600; i++) {
        p.hp = p.maxHp = 1e9;
        p.equip.main.dur = p.equip.main.max = 1000;
        p.equip.off.dur = p.equip.off.max = 1000;
        m.hp = m.maxHp = 1e9;
        ev = [];
        g.log.length = 0;
        g.strike('attack', m);
        if (ev.length !== 2) { bad++; continue; }
        const [a, b] = ev;
        const forcedA = a.key === 'hard' && a.countered;
        if (a.key === 'hard' && !a.countered) bad++;
        if (forcedA && b.key === 'hard') {
          firstThenHard++;
          if (b.countered) bad++;
          const bl = g.log.find((l) => /^你用副手攻擊/.test(l.text));
          if (!bl || /必定反擊/.test(bl.text) || !/命中/.test(bl.text)) wordBad++;
        } else if (!forcedA && b.key === 'hard') {
          freshHard++;
          if (!b.countered) bad++;
        } else if (b.countered) bad++;
      }
      FE.Combat.hook = hook0;
      ok(firstThenHard > 10 && freshHard > 10 && bad === 0 && wordBad === 0, `必定反擊最多一次：主手觸發後副手 6～10 ${firstThenHard} 次、主手沒觸發副手 6～10 ${freshHard} 次、不對 ${bad}、訊息不對 ${wordBad}`);
    }
    // 副手短刀與盾牌互斥；弓箭佔兩手；非短刀的武器不能放副手
    {
      const g = mk(51, 'warrior', ['sword', 'shield', 'herb']);
      const p = g.player;
      const dag = G.make('dagger', 0, g.nextGearId++);
      g.bagAddGear(dag);
      g.equipItem(p.bag.find((e) => e.gear === dag), true);
      ok(p.equip.off === dag && p.bag.some((e) => e.gear && e.gear.type === 'shield') && !G.shieldOf(p) && G.playerDefense(p).blockMax === 0, '副手拿短刀，盾牌該放回背包、不能格擋');
      const sh = p.bag.find((e) => e.gear && e.gear.type === 'shield');
      g.equipItem(sh);
      ok(p.equip.off && p.equip.off.type === 'shield' && p.bag.some((e) => e.gear === dag), '副手拿盾牌，短刀該放回背包');
      const sw2 = G.make('sword', 0, g.nextGearId++);
      g.bagAddGear(sw2);
      g.equipItem(p.bag.find((e) => e.gear === sw2), true);
      ok(p.equip.off === sw2 && p.bag.some((e) => e.gear && e.gear.type === 'shield'), '長劍也能放副手（暫時弓箭以外都可以），盾牌放回背包');
      p.equip.main = G.make('bow', 0, g.nextGearId++);
      const t0 = g.turn;
      g.equipItem(p.bag.find((e) => e.gear === dag), true);
      ok(p.equip.off === sw2 && g.turn === t0 && p.bag.some((e) => e.gear === dag), '拿著弓箭不能把短刀放副手');
      // 拿弓箭時副手的短刀放回背包
      p.equip.main = p.equip.main.type === 'bow' ? G.make('sword', 0, g.nextGearId++) : p.equip.main;
      p.equip.off = G.make('dagger', 0, g.nextGearId++);
      const bow = G.make('bow', 0, g.nextGearId++);
      g.bagAddGear(bow);
      g.equipItem(p.bag.find((e) => e.gear === bow));
      ok(p.equip.main === bow && p.equip.off === null, '拿弓箭時副手的短刀該放回背包');
    }
  }
  FE.Combat.hook = hook0;
}
UNITS.character = () => { try { testCharacter(); } catch (e) { fail('角色測試拋出例外：' + e.stack); } };

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
UNITS.reach = () => { try { testReach(); } catch (e) { fail('可達性測試拋出例外：' + e.stack); } };

// ---- 第二十八版：戰鬥（骰子、特質、優勢與劣勢、精通、暴擊、傷害種類、射程與視線、彈藥回收、投擲、神聖、治療、盾擊、速度、範圍魔攻、瞄準）：場景測試 ----
let combatChecks = 0;
function testCombat28() {
  const ok = (cond, msg) => { combatChecks++; if (!cond) fail('戰鬥 ' + msg); };
  const G = FE.Gear;
  const Ch = FE.Char;
  const hook0 = FE.Combat.hook;
  const spread = (a) => (a.length ? `${Math.min(...a)}～${Math.max(...a)}` : '沒有');
  const uses = (p, id) => { const s = p.skills[id]; let t = s.n; for (let l = 0; l < s.lv; l++) t += Ch.skillNeed(l); return t; };
  // 一塊平地：離聚落夠遠，31×31 格都改成同高度的空地，冒險者站在中央
  const arena = (seed, cls, picks) => {
    const g = new FE.Game(seed);
    g.start({ cls, picks });
    g.checkCreate = () => {};
    for (let i = 0; i < 3; i++) g.createChunk(false);
    g.monsters = [];
    g.soldiers = [];
    const w = g.world;
    const R = 15;
    let c = null;
    for (const ch of w.chunks) {
      const x = ch.x0 + 32, y = ch.y0 + 32;
      let clean = true;
      for (let dy = -R - 2; dy <= R + 2 && clean; dy++) for (let dx = -R - 2; dx <= R + 2; dx++) if (w.inBuffer(x + dx, y + dy) || !w.inBounds(x + dx, y + dy)) { clean = false; break; }
      if (clean) { c = { x, y }; break; }
    }
    if (!c) return null;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) { w.setCell(c.x + dx, c.y + dy, '.', 'plain'); w.setHeight(c.x + dx, c.y + dy, 1); }
    const inside = (o) => Math.abs(o.x - c.x) <= R && Math.abs(o.y - c.y) <= R;
    w.nodes = w.nodes.filter((n) => !inside(n));
    w.chests = w.chests.filter((n) => !inside(n));
    w.landmarks = w.landmarks.filter((l) => !(l.x1 >= c.x - R && l.x0 <= c.x + R && l.y1 >= c.y - R && l.y0 <= c.y + R));
    const p = g.player;
    p.x = c.x;
    p.y = c.y;
    p.hp = p.maxHp = 1e6;
    for (const it of FE.Gear.equipped(p)) it.dur = it.max = 1e6;
    g.worldEvery = 1e9; // 世界不走（怪物不移動、不出手），要看怪物的回合就直接叫 FE.AI.worldTurn
    return { g, p, c, w };
  };
  const mon = (g, x, y, type) => {
    const m = FE.dressMonster(FE.makeMonster({ type: type || 'RUNTIME', x, y, cells: [[x, y]], scope: 2, data: {} }, g.nextMonsterId++, 1), g.world);
    Object.assign(m, { x, y, home: { x, y }, maxHp: 1e9, hp: 1e9, atk: 1 });
    g.monsters.push(m);
    return m;
  };
  const events = (fn) => {
    const ev = [];
    FE.Combat.hook = (e) => ev.push(e);
    try { fn(); } finally { FE.Combat.hook = hook0; }
    return ev;
  };
  const clean = (e) => (e.key === 'hit' || e.key === 'hard') && !e.dodged && !e.crit && !e.blocked && !e.resisted && !e.counter;

  // 1. 骰子與 d20：傷害骰的範圍；優勢取高、劣勢取低；暴擊門檻
  {
    const r = FE.makeRng(5);
    const a = [], b = [];
    for (let i = 0; i < 4000; i++) { a.push(FE.rollDice(r, [1, 8], 1)); b.push(FE.rollDice(r, [1, 10], 2)); }
    ok(spread(a) === '1～8' && spread(b) === '2～20', `擲骰範圍 1d8 ${spread(a)}、2d10 ${spread(b)}`);
    let hi = 0, lo = 0, bad = 0;
    for (let i = 0; i < 3000; i++) {
      const u = FE.rollD20(r, 0, 1), d = FE.rollD20(r, 0, -1), n = FE.rollD20(r, 0, 0);
      if (u.dice.length !== 2 || u.n !== Math.max(...u.dice) || d.dice.length !== 2 || d.n !== Math.min(...d.dice) || n.dice.length !== 1) bad++;
      hi += u.n; lo += d.n;
    }
    ok(bad === 0 && hi / 3000 > 13 && lo / 3000 < 8, `優勢取高、劣勢取低：平均 ${(hi / 3000).toFixed(1)}／${(lo / 3000).toFixed(1)}、不對 ${bad}`);
    let c19 = 0, c19b = 0;
    for (let i = 0; i < 4000; i++) { const x = FE.rollD20(r, 0, 0, 19); if (x.n === 19 && x.key === 'crit') c19++; const y = FE.rollD20(r, 0, 0); if (y.n === 19 && y.key === 'crit') c19b++; }
    ok(c19 > 100 && c19b === 0, `暴擊門檻 19 時擲出 19 是暴擊（${c19}），平常不是（${c19b}）`);
  }

  // 2. 暴擊：擲出 20 暴擊，傷害骰擲兩次；感知 +2 起 19；短刀再擴大 1
  {
    const A = arena(281, 'warrior', ['sword', 'shield', 'herb']);
    ok(!!A, '找不到空地');
    if (!A) return;
    const { g, p } = A;
    p.attr.str = 10;
    p.attr.wis = 12;
    ok(Ch.critMin(p, p.equip.main) === 20, `感知 12 的暴擊門檻 ${Ch.critMin(p, p.equip.main)}`);
    p.attr.wis = 14;
    ok(Ch.critMin(p, p.equip.main) === 19 && Ch.critMin(p, G.make('dagger', 0, 1)) === 18, `感知 14：長劍 19、短刀 18（${Ch.critMin(p, p.equip.main)}／${Ch.critMin(p, G.make('dagger', 0, 1))}）`);
    p.attr.wis = 12;
    ok(Ch.critMin(p, G.make('dagger', 0, 1)) === 19, '短刀平常 19 就暴擊');
    const m = mon(g, p.x + 1, p.y);
    const ev = events(() => { for (let i = 0; i < 3000; i++) { p.skills = Ch.freshSkills(); FE.Combat.resolveAttack(g, p, m, 'attack', { noCounter: true }); } });
    const crits = ev.filter((e) => e.by === 'player' && e.crit && !e.blocked && !e.resisted);
    ok(crits.length > 50 && crits.every((e) => e.n === 20) && Math.min(...crits.map((e) => e.dmg)) >= 2 && Math.max(...crits.map((e) => e.dmg)) <= 16 && Math.max(...crits.map((e) => e.dmg)) > 8, `長劍（拿盾牌 1d8）暴擊擲兩次：${spread(crits.map((e) => e.dmg))}，擲出 ${[...new Set(crits.map((e) => e.n))]}`);
    ok(g.log.some((l) => l.text.includes('暴擊，傷害骰擲兩次')), '暴擊的訊息該寫傷害骰擲兩次');
    // 怪物暴擊：攻擊力照舊，擲兩次加總
    p.equip.off = null;
    p.equip.body = null;
    const mev = events(() => { for (let i = 0; i < 3000; i++) { p.hp = 1e6; m.atk = 3; FE.Combat.resolveAttack(g, m, p, 'attack', { noCounter: true }); } });
    const mc = mev.filter((e) => e.by === 'monster' && e.crit && !e.blocked && !e.reduced);
    ok(mc.length > 30 && Math.max(...mc.map((e) => e.dmg)) <= 8 && Math.max(...mc.map((e) => e.dmg)) > 4, `怪物（攻擊力 3）暴擊擲兩次加總：${spread(mc.map((e) => e.dmg))}`);
  }

  // 3. 傷害種類：揮砍打中甲重甲多擋 1；穿刺照穿甲比例無視一部分（捨去）；鈍擊無視一半（進位）；魔法、神聖只看魔法減傷
  {
    const A = arena(282, 'warrior', ['sword', 'herb', 'gold']);
    const { g, p } = A;
    p.equip.body = G.make('heavy', 0, 1); // 物理 3、魔法 1
    const R = (t, pc) => FE.Combat.reduction(g, p, t, pc);
    ok(R(null) === 3 && R('slash') === 4 && R('pierce', 0) === 3 && R('pierce', 0.5) === 2 && R('pierce', 0.3) === 3 && R('blunt') === 1 && R('magic') === 1 && R('holy') === 1, `重甲：一般 ${R(null)}、揮砍 ${R('slash')}、穿刺 ${R('pierce', 0.5)}、鈍擊 ${R('blunt')}、魔法 ${R('magic')}`);
    p.equip.body = G.make('studded', 0, 2); // 鑲釘皮甲：物理 1
    ok(R('slash') === 1 && R('blunt') === 0 && R('pierce', 0.5) === 1, `輕甲：揮砍不多擋 ${R('slash')}、鈍擊 ${R('blunt')}`);
    p.equip.body = G.make('medium', 0, 3);
    ok(R('slash') === 3, `中甲揮砍多擋 1：${R('slash')}`);
    p.equip.body = G.make('mrobe', 0, 4);
    ok(R('magic') === 3 && R('holy') === 3 && R(null) === 0, '魔法衣袍只擋魔法與神聖');
    const m = mon(g, p.x + 1, p.y);
    ok(FE.Combat.reduction(g, m, 'slash') === 0, '怪物目前沒有減傷');
    // 武器的傷害種類寫進判定
    const kinds = {};
    for (const t of ['sword', 'spear', 'shortspear', 'dagger', 'staff']) {
      p.equip.main = G.make(t, 0, 10);
      p.equip.main.dur = 1e6;
      const ev = events(() => FE.Combat.resolveAttack(g, p, m, 'attack', { noCounter: true }));
      kinds[t] = ev[0].dmgType;
    }
    ok(kinds.sword === 'slash' && kinds.spear === 'pierce' && kinds.shortspear === 'pierce' && kinds.dagger === 'pierce' && kinds.staff === 'blunt', `武器的傷害種類 ${JSON.stringify(kinds)}`);
  }

  // 4. 重型：長槍近戰力量不到 13 有劣勢；可雙手；輕型才能放副手
  {
    const A = arena(283, 'warrior', ['spear', 'herb', 'gold']);
    const { g, p } = A;
    const m = mon(g, p.x + 1, p.y);
    const advs = (n) => events(() => { for (let i = 0; i < n; i++) FE.Combat.resolveAttack(g, p, m, 'attack', { noCounter: true }); }).filter((e) => e.by === 'player').map((e) => e.adv);
    p.attr.str = 12;
    ok(advs(30).every((a) => a === -1) && Ch.profile(p, p.equip.main, 'melee').heavy, '力量 12 拿長槍該有劣勢');
    p.attr.str = 13;
    ok(advs(30).every((a) => a === 0), '力量 13 拿長槍沒有劣勢');
    ok(g.log.some((l) => /劣勢：\d+、\d+，擲出/.test(l.text)), '劣勢的訊息該寫出兩顆骰子');
    // 可雙手：短矛副手空著 1d8、拿盾牌 1d6；投擲一律 1d6
    p.equip.main = G.make('shortspear', 0, 20);
    ok(Ch.profile(p, p.equip.main, 'melee').die.join() === '1,8' && Ch.profile(p, p.equip.main, 'throw').die.join() === '1,6', '短矛：副手空著 1d8，投擲 1d6');
    p.equip.off = G.make('shield', 0, 21);
    ok(Ch.profile(p, p.equip.main, 'melee').die.join() === '1,6', '短矛：拿盾牌 1d6');
    // 副手：暫時弓箭以外的武器都能放副手；弓箭選「放副手」照樣拿在主手
    p.equip.off = null;
    const ss = G.make('shortspear', 0, 22);
    g.bagAddGear(ss);
    g.equipItem(p.bag.find((e) => e.gear === ss), true);
    ok(p.equip.off === ss, '短矛選「放副手」該拿在副手');
    // 副手拿非輕型武器：那一下有劣勢、傷害骰 1d4；短刀（輕型）照常
    const offP = Ch.profile(p, ss, 'melee', true);
    const dagP = Ch.profile(p, G.make('dagger', 0, 24), 'melee', true);
    ok(offP.offClumsy && offP.die.join() === '1,4' && !dagP.offClumsy && dagP.die.join() === '1,4', '副手非輕型武器：劣勢＋1d4；短刀不受影響');
    const bw = G.make('bow', 0, 23);
    g.bagAddGear(bw);
    g.equipItem(p.bag.find((e) => e.gear === bw), true);
    ok(p.equip.main === bw && !p.equip.off, '弓箭選「放副手」該拿在主手，副手的東西放回背包');
  }

  // 5. 觸及：長槍按 1 時旁邊沒有目標，打直線 2 格外、中間是空格的目標；中間有東西、斜的都打不到；不會被反擊
  {
    const A = arena(284, 'warrior', ['spear', 'herb', 'gold']);
    const { g, p } = A;
    const m = mon(g, p.x + 2, p.y);
    m.type = 'TERRAIN'; // 反擊機率 10%，貼著才會反擊
    // 推擊會把牠推開，每次出手前放回 2 格外
    let ev = events(() => { for (let i = 0; i < 40; i++) { m.x = p.x + 2; m.y = p.y; g.battle.targetId = null; g.act('attack'); } });
    const pe = ev.filter((e) => e.by === 'player');
    ok(pe.length === 40 && pe.every((e) => e.d === m) && !pe.some((e) => e.countered) && !ev.some((e) => e.counter), `長槍打 2 格外：出手 ${pe.length} 次、被反擊 ${pe.filter((e) => e.countered).length} 次`);
    const blocker = mon(g, p.x + 1, p.y + 1); // 斜前方：不在中間、也沒貼著冒險者，不擋
    m.x = p.x + 2; m.y = p.y;
    ev = events(() => { g.battle.targetId = null; g.act('attack'); });
    ok(ev.some((e) => e.by === 'player' && e.d === m), '斜的怪物不擋觸及');
    g.monsters = g.monsters.filter((o) => o !== blocker);
    g.world.setCell(p.x + 1, p.y, '#', 'plain');
    const t0 = g.turn;
    ev = events(() => g.act('attack'));
    ok(!ev.some((e) => e.by === 'player') && g.turn === t0, '中間是巨石就打不到');
    g.world.setCell(p.x + 1, p.y, '.', 'plain');
    m.x = p.x + 2; m.y = p.y + 1;
    ev = events(() => g.act('attack'));
    ok(!ev.some((e) => e.by === 'player'), '斜的不算直線');
    // 劍沒有觸及
    m.x = p.x + 2; m.y = p.y;
    p.equip.main = G.make('sword', 0, 30);
    ev = events(() => g.act('attack'));
    ok(!ev.some((e) => e.by === 'player'), '長劍打不到 2 格外');
    // 雙持：主手長槍把目標推開後，副手那一下不出手（副手只打貼著的目標）；打倒的訊息寫在攻擊訊息後面
    p.equip.main = G.make('spear', 0, 31);
    p.equip.off = G.make('shortspear', 0, 32);
    p.equip.main.dur = p.equip.off.dur = 1e9;
    p.hp = p.maxHp = 1e9;
    // 事件裡的 a、d 是活的物件，位置要在出手當下記下來
    let pushes = 0;
    let offN = 0;
    let far = 0;
    const hk = FE.Combat.hook;
    FE.Combat.hook = (e) => {
      if (e.by !== 'player') return;
      if (!e.off && (e.effects || []).some((t) => t.includes('推開'))) pushes++;
      if (e.off) {
        offN++;
        if (Math.abs(e.a.x - e.d.x) + Math.abs(e.a.y - e.d.y) !== 1) far++;
      }
    };
    for (let i = 0; i < 60; i++) { m.x = p.x + 1; m.y = p.y; m.hp = m.maxHp = 1e6; g.battle.targetId = null; g.act('attack'); }
    FE.Combat.hook = hk;
    const offEv = { length: offN };
    ok(pushes > 0 && offEv.length > 0 && far === 0, `推開後副手不該出手（推開 ${pushes} 次、副手 ${offEv.length} 次、其中不貼著 ${far} 次）`);
    p.equip.off = null;
    m.x = p.x + 1; m.y = p.y; m.hp = 1;
    g.battle.targetId = null;
    g.act('attack');
    const iHit = g.log.findIndex((l) => /^你攻擊/.test(l.text));
    const iDown = g.log.findIndex((l) => l.text.includes('倒下了'));
    ok(iHit >= 0 && iDown >= 0 && iDown < iHit, '打倒的訊息該寫在攻擊訊息後面（log 新的在前）');
  }

  // 6. 射程、視線、優勢與劣勢：遊俠感知 15（+2）弓箭 7／22 格；超出正常射程有劣勢、超出最遠打不到；中間有巨石、樹打不到；旁邊貼著怪物有劣勢
  {
    const A = arena(285, 'ranger', ['bow']);
    const { g, p } = A;
    const r = g.rangedMode(true);
    ok(r && r.mode === 'shoot' && r.range.join() === '7,22', `遊俠弓箭的射程 ${r && r.range}`);
    const near = mon(g, p.x + 6, p.y);
    const far = mon(g, p.x + 9, p.y + 3);
    // 侵擾會讓下一次有優勢，每次射之前清掉
    const shot = (m) => { m.vexed = false; const ev = events(() => g.fireAt(m)); return ev.find((e) => e.by === 'player'); };
    let e = shot(near);
    ok(e && e.adv === 0 && e.mode === 'shoot', `正常射程內沒有優劣：${e && e.adv}`);
    e = shot(far);
    ok(e && e.adv === -1, `超出正常射程有劣勢：${e && e.adv}`);
    // 最遠射程：手動算看看（空地只有 31×31，22 格外在空地外面，只檢查 canShoot 的距離判斷）
    ok(FE.Combat.canShoot(g, p, { x: p.x + 15, y: p.y }, [7, 14]) === false && FE.Combat.canShoot(g, p, { x: p.x + 14, y: p.y }, [7, 14]) === true, '超出最遠射程打不到');
    // 視線：巨石、樹、建築的牆都擋；水不擋
    for (const [t, blocks] of [['#', true], ['♣', true], ['⌂', true], ['≈', false]]) {
      g.world.setCell(p.x + 3, p.y, t, 'plain');
      ok(FE.Combat.canShoot(g, p, near, r.range) === !blocks, `中間是「${t}」${blocks ? '該擋住' : '不該擋'}`);
    }
    g.world.setCell(p.x + 3, p.y, '.', 'plain');
    // 中間隔著高出 2 階的山丘也打不到
    g.world.setHeight(p.x + 3, p.y, 3);
    ok(!FE.Combat.canShoot(g, p, near, r.range), '隔著山丘打不到');
    g.world.setHeight(p.x + 3, p.y, 1);
    // 旁邊貼著怪物：遠程有劣勢
    const adj = mon(g, p.x, p.y + 1);
    e = shot(near);
    ok(e && e.adv === -1, `貼著怪物時射擊有劣勢：${e && e.adv}`);
    g.monsters = g.monsters.filter((o) => o !== adj);
    // 優勢與劣勢抵消：目標倒地（優勢）＋超出正常射程（劣勢）＝擲一次
    far.prone = true;
    e = shot(far);
    ok(e && e.adv === 0 && e.dice.length === 1, '優勢與劣勢同時有該抵消，只擲一次');
    far.prone = false;
    // 村莊裡不能出手
    const v = g.world.villages[0];
    p.x = v.cx; p.y = v.cy;
    const t0 = g.turn;
    g.act('fire');
    ok(!g.aim && g.turn === t0 && g.log[0].text.includes('不能動手'), '聚落裡按 F 該不能出手');
  }

  // 7. 彈藥：每射一次用掉 1 支；目標倒下或冒險者脫離戰鬥，撿回用掉的一半（捨去）；沒有箭不能射；一捆 20 支重 1
  {
    const A = arena(286, 'ranger', ['bow']);
    const { g, p } = A;
    ok(g.bagCount('arrow') === 20 && Math.abs(G.weightOf(p) - (2 + 1 + 10)) < 1e-9, `遊俠起始 20 支箭，重 1（弓 2、輕甲 10，負重 ${G.weightOf(p)}）`);
    const m = mon(g, p.x + 4, p.y);
    for (let i = 0; i < 5; i++) g.fireAt(m);
    ok(g.bagCount('arrow') === 15 && m.arrows && Object.values(m.arrows).reduce((s, n) => s + n, 0) === 5, `射 5 箭剩 ${g.bagCount('arrow')}`);
    m.hp = 1;
    let guard = 0;
    while (g.monsters.includes(m) && guard++ < 50) g.fireAt(m);
    const shot = 5 + guard;
    ok(!g.monsters.includes(m) && g.bagCount('arrow') === 20 - shot + Math.floor(shot / 2), `打倒時撿回一半：射了 ${shot} 支，剩 ${g.bagCount('arrow')}（應該 ${20 - shot + Math.floor(shot / 2)}）`);
    // 脫離戰鬥：射了 3 支，冒險者走遠（離牠超過 8 格）就撿回 1 支
    const m2 = mon(g, p.x + 4, p.y + 2);
    const a0 = g.bagCount('arrow');
    for (let i = 0; i < 3; i++) g.fireAt(m2);
    p.x -= 10;
    g.endTurn(false);
    ok(g.bagCount('arrow') === a0 - 3 + 1 && !m2.arrows, `脫離戰鬥撿回一半：${g.bagCount('arrow')}（應該 ${a0 - 2}）`);
    p.x += 10;
    // 沒有箭
    p.bag = p.bag.filter((e) => e.id !== 'arrow');
    const t0 = g.turn;
    ok(!g.fireAt(m2) && g.turn === t0 && g.log[0].text.includes('沒有箭矢'), '沒有箭不能射');
    // 拿著弓箭按 1 是拿弓打人：1d4 鈍擊＋力量修正值
    m2.x = p.x + 1; m2.y = p.y;
    const ev = events(() => { for (let i = 0; i < 40; i++) g.act('attack'); });
    const pe = ev.filter((e) => e.by === 'player' && clean(e));
    const sm = Ch.attrMod(p, 'str');
    ok(pe.length > 5 && pe.every((e) => e.dmg >= Math.max(1, 1 + sm) && e.dmg <= Math.max(1, 4 + sm) && e.dmgType === 'blunt'), `拿弓箭按 1 是 1d4 鈍擊＋力量：${spread(pe.map((e) => e.dmg))}`);
    // 箭矢分品質：買來的一捆疊進同品質的；射擊先用品質高的
    g.bagAddGear(G.make('arrow', 2, 99));
    g.bagAdd('arrow', 3, { q: 0 });
    ok(g.bagCount('arrow') === 23 && p.bag.filter((e) => e.id === 'arrow').length === 2 && g.takeArrow() === 2, '箭矢分品質疊放，先用品質高的');
  }

  // 8. 投擲：短刀、短矛擲出去，掉在目標那格（副手的短刀換到主手）；走過去撿回來；存檔讀得回來
  {
    const A = arena(287, 'ranger', ['dagger']);
    const { g, p, w } = A;
    const d1 = p.equip.main;
    const d2 = G.make('dagger', 0, g.nextGearId++);
    p.equip.off = d2;
    const m = mon(g, p.x + 3, p.y);
    const r = g.rangedMode(true);
    ok(r.mode === 'throw' && r.range.join() === '6,14', `短刀投擲 4／12 格＋感知 2：${r.range}`);
    const ev = events(() => g.fireAt(m));
    const e = ev.find((x) => x.by === 'player');
    ok(e && e.mode === 'throw' && p.equip.main === d1 && !p.equip.off && w.items.length === 1 && w.items[0].gear === d2 && w.items[0].x === m.x && w.items[0].y === m.y, '擲出的短刀該掉在目標那格，先擲副手的，主手的留著');
    ok(uses(p, 'knife') > 0 && uses(p, 'knife') === uses(p, 'shoot') && uses(p, 'fight') === 0, `投擲算刀術也算射擊（不算格鬥）：${uses(p, 'knife')}、${uses(p, 'shoot')}`);
    g.fireAt(m);
    ok(!p.equip.main && w.items.length === 2 && g.rangedMode(true) === null, '兩把都擲出去，手上空了');
    // 存檔讀回來，地上的東西還在
    FE.Save.save(g);
    const back = FE.Save.load();
    ok(back && back.game && back.game.world.items.length === 2 && back.game.world.items[0].gear.type === 'dagger', '地上的東西存檔讀不回來');
    // 走過去撿回來：主手空著就拿在主手，第二把放背包
    g.monsters = [];
    p.x = m.x - 1;
    g.move(1, 0);
    ok(p.x === m.x && w.items.length === 0 && p.equip.main && p.equip.main.type === 'dagger' && p.bag.filter((x) => x.gear && x.gear.type === 'dagger').length === 1, `走過去撿回來：主手 ${p.equip.main && p.equip.main.type}、背包 ${p.bag.map((x) => x.name)}`);
    // 短矛也能擲；長劍不行
    p.equip.main = G.make('shortspear', 0, g.nextGearId++);
    ok(g.rangedMode(true).mode === 'throw' && g.rangedMode(true).range.join() === '6,14', '短矛能擲');
    p.equip.main = G.make('sword', 0, g.nextGearId++);
    ok(g.rangedMode(true) === null, '長劍不能遠程');
    // 投擲的傷害用近戰的屬性（短刀靈巧取較高者）
    ok(Ch.profile(p, G.make('shortspear', 0, 1), 'throw').dmg === Ch.attrMod(p, 'str') && Ch.profile(p, G.make('dagger', 0, 1), 'throw').dmg === Math.max(Ch.attrMod(p, 'str'), Ch.attrMod(p, 'dex')), '投擲的傷害用近戰的屬性');
  }

  // 9. 精通：削弱、侵擾、失衡、推擊；法師、牧師要那把武器的技能 5 級才會
  {
    const A = arena(288, 'warrior', ['sword', 'herb', 'gold']);
    const { g, p } = A;
    const m = mon(g, p.x + 1, p.y);
    // 削弱：命中後目標下一次出手有劣勢（用掉就沒了）
    let guard = 0;
    while (!m.sapped && guard++ < 50) FE.Combat.resolveAttack(g, p, m, 'attack', { noCounter: true });
    ok(m.sapped && g.log.some((l) => l.text.includes('削弱')), '長劍命中後該削弱目標');
    let ev = events(() => FE.Combat.resolveAttack(g, m, p, 'attack', { noCounter: true }));
    ok(ev[0].adv === -1 && !m.sapped, `被削弱的怪物下一次出手有劣勢：${ev[0].adv}`);
    ev = events(() => FE.Combat.resolveAttack(g, m, p, 'attack', { noCounter: true }));
    ok(ev[0].adv === 0, '削弱只管下一次');
    // 推擊：長槍命中把目標直線推開 2 格；擋住就停；大型怪物推不動
    p.equip.main = G.make('spear', 0, g.nextGearId++);
    p.equip.main.dur = 1e6;
    const push = () => { const x0 = m.x; m.x = p.x + 1; m.y = p.y; let n = 0; let e; do { e = events(() => FE.Combat.resolveAttack(g, p, m, 'attack', { noCounter: true })).find((x) => x.by === 'player'); m.sapped = false; } while (!(e.key === 'crit' || e.key === 'hit' || e.key === 'hard') && n++ < 50); return m.x - (p.x + 1); };
    ok(push() === 2, `長槍推擊推開 2 格：${m.x - p.x - 1}`);
    g.world.setCell(p.x + 3, p.y, '#', 'plain');
    ok(push() === 1, '推到巨石前面就停');
    g.world.setCell(p.x + 3, p.y, '.', 'plain');
    m.boss = true;
    ok(push() === 0, '大型怪物推不動');
    m.boss = false;
    // 失衡：法杖（戰士一開始就會）命中後 30%＋力量修正值×5% 讓目標倒地；倒地的下一回合不能動，打牠有優勢
    p.equip.main = G.make('staff', 0, g.nextGearId++);
    p.equip.main.dur = 1e6;
    m.x = p.x + 1; m.y = p.y;
    let hits = 0, prone = 0;
    for (let i = 0; i < 600; i++) {
      m.prone = false;
      const e = events(() => FE.Combat.resolveAttack(g, p, m, 'attack', { noCounter: true })).find((x) => x.by === 'player');
      m.sapped = false;
      if (['crit', 'hit', 'hard'].includes(e.key)) { hits++; if (m.prone) prone++; }
    }
    const want = C.TOPPLE_BASE + Ch.attrMod(p, 'str') * C.TOPPLE_PER;
    ok(Math.abs(prone / hits - want) < 0.07, `失衡的機率 ${(prone / hits).toFixed(2)}（應該約 ${want.toFixed(2)}）`);
    m.prone = true;
    ev = events(() => FE.Combat.resolveAttack(g, p, m, 'attack', { noCounter: true }));
    ok(ev.find((x) => x.by === 'player').adv === 1, '打倒地的目標有優勢');
    m.prone = true;
    const hp0 = p.hp;
    g.battle.targetId = m.id;
    ev = events(() => FE.AI.worldTurn(g));
    ok(!ev.some((e) => e.by === 'monster') && !m.prone && p.hp === hp0, '倒地的怪物下一回合不能動');
    ev = events(() => FE.AI.worldTurn(g));
    ok(ev.some((e) => e.by === 'monster' && e.d === p), '爬起來之後照常攻擊');
    // 法師、牧師要那把武器的技能 5 級；戰士、遊俠一開始就會
    const mg = arena(289, 'mage', ['staff', 'gold']);
    const pm = mg.p;
    // 第二十九版追加：精通一律要該武器的技能 5 級，不分職業（舊測試用的 MASTERY_SKILL = 0 在這裡換回 5）
    const ms0 = FE.MASTERY_SKILL;
    FE.MASTERY_SKILL = 5;
    pm.skills.staff.lv = 0;
    pm.skills.sword.lv = 0;
    ok(Ch.mastery(pm, pm.equip.main) === null, '法師一開始不會法杖的精通');
    pm.skills.staff.lv = 5;
    ok(Ch.mastery(pm, pm.equip.main) === 'topple' && Ch.mastery(pm, G.make('sword', 0, 1)) === null, '法杖技能 5 級學會失衡，長劍還不會');
    const rg = arena(290, 'ranger', ['bow']).p;
    rg.skills.bow.lv = 4;
    ok(Ch.mastery(rg, G.make('bow', 0, 1)) === null, '遊俠弓術 4 級也還沒有精通');
    rg.skills.bow.lv = 5;
    ok(Ch.mastery(rg, G.make('bow', 0, 1)) === 'vex', '遊俠弓術 5 級才有侵擾');
    const wr5 = arena(291, 'warrior', ['sword', 'herb', 'gold']).p;
    wr5.skills.sword.lv = 0;
    ok(Ch.mastery(wr5, G.make('sword', 0, 1)) === null, '戰士也要劍術 5 級才有削弱');
    FE.MASTERY_SKILL = ms0;
    // 侵擾：射中且有傷害後，冒險者下一次打牠有優勢
    const R = arena(291, 'ranger', ['bow']);
    const mv = mon(R.g, R.p.x + 3, R.p.y);
    guard = 0;
    while (!mv.vexed && guard++ < 50) R.g.fireAt(mv);
    ok(mv.vexed, '射中後該侵擾目標');
    ev = events(() => R.g.fireAt(mv));
    ok(ev.find((x) => x.by === 'player').adv === 1, '被侵擾的目標，下一次射牠有優勢');
  }

  // 10. 神聖（牧師）：每個動作第一下命中時多 1d8 神聖傷害；雙持只算第一下命中的；治療按 4
  {
    const A = arena(292, 'priest', ['medium', 'sword', 'herb']);
    const { g, p } = A;
    const m = mon(g, p.x + 1, p.y);
    const ev = events(() => { for (let i = 0; i < 300; i++) { p.skills = Ch.freshSkills(); g.battle.targetId = m.id; g.act('attack'); } }).filter((e) => e.by === 'player');
    const hit = ev.filter((e) => ['crit', 'hit', 'hard'].includes(e.key));
    ok(hit.length > 100 && hit.every((e) => e.holy >= 1 && e.holy <= 8 && e.dmg > e.holy) && ev.filter((e) => !['crit', 'hit', 'hard'].includes(e.key)).every((e) => e.holy === 0), `牧師命中時多 1d8 神聖：${spread(hit.map((e) => e.holy))}`);
    ok(g.log.some((l) => l.text.includes('是神聖之力')), '訊息該寫出神聖之力');
    // 雙持：一個動作最多一次
    p.equip.main = G.make('dagger', 0, g.nextGearId++);
    p.equip.off = G.make('dagger', 0, g.nextGearId++);
    p.equip.main.dur = p.equip.off.dur = 1e6;
    let twice = 0, both = 0;
    for (let i = 0; i < 300; i++) {
      const e2 = events(() => { g.battle.targetId = m.id; g.act('attack'); }).filter((e) => e.by === 'player' && !e.counter);
      if (e2.length === 2 && e2.every((e) => ['crit', 'hit', 'hard'].includes(e.key))) both++;
      if (e2.filter((e) => e.holy > 0).length > 1) twice++;
    }
    ok(both > 30 && twice === 0, `雙持兩下都命中 ${both} 次，神聖只算一次（多算 ${twice} 次）`);
    // 不是牧師沒有神聖
    const W = arena(293, 'warrior', ['sword', 'herb', 'gold']);
    const mw = mon(W.g, W.p.x + 1, W.p.y);
    const we = events(() => { for (let i = 0; i < 50; i++) { W.g.battle.targetId = mw.id; W.g.act('attack'); } });
    ok(we.every((e) => !e.holy), '戰士沒有神聖傷害');
    // 治療：1d8＋魅力修正值（牧師魅力 16 是 +3），冷卻 3 回合，只治自己，算一個動作；滿血不用
    g.monsters = [];
    p.maxHp = 100;
    const got = [];
    for (let i = 0; i < 200; i++) {
      p.hp = 50;
      g.battle.healCd = 0;
      const t0 = g.turn;
      g.act('heal');
      if (g.turn !== t0 + 1 || g.battle.healCd !== C.HEAL_COOLDOWN - 0) { fail('戰鬥 治療該算一個動作並開始冷卻'); break; }
      got.push(p.hp - 50);
    }
    ok(spread(got) === '4～11', `治療回 1d8+3：${spread(got)}`);
    p.hp = 50;
    const t1 = g.turn;
    g.act('heal');
    ok(p.hp === 50 && g.turn === t1 && g.log[0].text.includes('冷卻') === false && /還要 \d 回合/.test(g.log[0].text), `冷卻中不能治療：${g.log[0].text}`);
    g.beginAction(); g.beginAction(); g.beginAction();
    ok(g.battle.healCd === 0, `做了 3 個動作冷卻歸 0：${g.battle.healCd}`);
    p.hp = p.maxHp;
    const t2 = g.turn;
    g.act('heal');
    ok(g.turn === t2, '滿血不用治療');
    p.hp = 99;
    g.act('heal');
    ok(p.hp === 100, '治療不超過生命上限');
    W.p.hp = 10;
    const t3 = W.g.turn;
    W.g.act('heal');
    ok(W.p.hp === 10 && W.g.turn === t3, '只有牧師會治療');
  }

  // 11. 盾擊（戰士拿盾牌按 5）：1d4 鈍擊＋力量修正值，算一個動作；沒有精通、不算技能；沒盾牌、不是戰士不行
  {
    const A = arena(294, 'warrior', ['sword', 'shield', 'herb']);
    const { g, p } = A;
    const m = mon(g, p.x + 1, p.y);
    const ev = events(() => { for (let i = 0; i < 300; i++) { p.skills = Ch.freshSkills(); g.battle.targetId = m.id; g.act('bash'); m.sapped = false; } }).filter((e) => e.by === 'player');
    const sk = Ch.freshSkills();
    p.skills = sk;
    g.battle.targetId = m.id;
    g.act('bash');
    const cl = ev.filter(clean);
    ok(ev.length === 300 && ev.every((e) => e.mode === 'bash' && e.dmgType === 'blunt' && !e.mastery) && spread(cl.map((e) => e.dmg)) === `${1 + 3}～${4 + 3}`, `盾擊 1d4+3 鈍擊：${spread(cl.map((e) => e.dmg))}`);
    ok(Object.entries(p.skills).every(([k, s]) => (k === 'misc' || k === 'fight' || k === 'dodge' || k === 'shield' || k === 'armor') || (s.lv === 0 && s.n === 0)) && p.skills.misc.n > 0 && p.skills.fight.n === p.skills.misc.n, '盾擊練雜物使用與格鬥，不練武器技能');
    ok(!m.sapped && g.log.some((l) => l.text.startsWith('你用盾牌撞向')), '盾擊沒有精通，訊息寫用盾牌撞');
    p.equip.off = null;
    const t0 = g.turn;
    g.act('bash');
    ok(g.turn === t0, '沒拿盾牌不能盾擊');
    const P = arena(295, 'priest', ['shield', 'sword', 'gold']);
    mon(P.g, P.p.x + 1, P.p.y);
    const t1 = P.g.turn;
    P.g.act('bash');
    ok(P.g.turn === t1, '不是戰士不能盾擊');
  }

  // 12. 速度：攻擊動作輕型 8、一般 10、重型 12，減敏捷修正值，最少 6；防具多花的刻照舊疊加；移動 10 刻
  {
    const A = arena(296, 'warrior', ['sword', 'herb', 'gold']);
    const { g, p } = A;
    p.equip.body = null;
    const m = mon(g, p.x + 1, p.y);
    const dt = (fn) => { const t = g.ticks; fn(); return g.ticks - t; };
    const hit = () => { g.battle.targetId = m.id; g.act('attack'); };
    p.attr.dex = 13; // +1
    const tw = {};
    for (const t of ['dagger', 'sword', 'spear']) { p.equip.main = G.make(t, 0, g.nextGearId++); p.equip.main.dur = 1e6; tw[t] = dt(hit); }
    ok(tw.dagger === 7 && tw.sword === 9 && tw.spear === 11, `敏捷 13 的攻擊刻：短刀 ${tw.dagger}、長劍 ${tw.sword}、長槍 ${tw.spear}`);
    p.attr.dex = 18; // +4
    p.equip.main = G.make('dagger', 0, g.nextGearId++);
    ok(dt(hit) === 6, '最少 6 刻');
    p.attr.dex = 6; // -2
    p.equip.main = G.make('sword', 0, g.nextGearId++);
    ok(dt(hit) === 12, '敏捷 -2 的長劍 12 刻');
    p.equip.body = G.make('heavy', 0, g.nextGearId++);
    ok(dt(hit) === 14, '重甲再多 2 刻');
    p.equip.body = null;
    g.monsters = [];
    ok(dt(() => g.move(1, 0)) === 12, '移動 10 刻減敏捷修正值（敏捷 6 是 -2，所以 12 刻）');
  }

  // 13. 法師的範圍魔攻：打目標與周圍 1 格（智力 +3 起 2 格）所有怪物，每隻各擲命中（加智力），1d6＋智力 魔法；法杖只磨一次、技能只練一次
  {
    const A = arena(297, 'mage', ['staff', 'gold']);
    const { g, p } = A;
    p.attr.int = 14; // +2
    const c = mon(g, p.x + 5, p.y);
    const diag = mon(g, p.x + 6, p.y + 1);
    const two = mon(g, p.x + 7, p.y);
    const w0 = p.equip.main.dur = p.equip.main.max = 1000;
    let ev = events(() => g.fireAt(c)).filter((e) => e.by === 'player');
    ok(ev.length === 2 && ev[0].d === c && ev[1].d === diag && ev.every((e) => e.mode === 'spell' && e.dmgType === 'magic'), `智力 +2 打周圍 1 格：打到 ${ev.length} 隻`);
    ok(p.equip.main.dur >= w0 - 1 && (uses(p, 'staff') === 6 || uses(p, 'staff') === 12) && uses(p, 'fight') === 0, `法杖只磨一次（${w0 - p.equip.main.dur}）、杖術只練一次（命中 10 點或沒命中 5 點，智力 +2 ×1.2：${uses(p, 'staff')}）`);
    p.attr.int = 16; // +3
    ev = events(() => g.fireAt(c)).filter((e) => e.by === 'player');
    ok(ev.length === 3, `智力 +3 起打周圍 2 格：打到 ${ev.length} 隻`);
    p.attr.int = 14;
    const dm = [];
    let hitMods = new Set();
    for (let i = 0; i < 300; i++) {
      p.skills = Ch.freshSkills();
      const e = events(() => g.fireAt(c)).filter((x) => x.by === 'player' && x.d === c);
      for (const x of e) { if (clean(x)) dm.push(x.dmg); hitMods.add(x.mod); }
    }
    ok(spread(dm) === '3～8', `範圍魔攻 1d6+2：${spread(dm)}`);
    ok([...hitMods].every((x) => x === Ch.profile(p, p.equip.main, 'spell').hit + FE.BIOMES.plain.hit), `命中加智力：${[...hitMods]}`);
    // 別的職業拿法杖不能施法
    const W = arena(298, 'priest', ['medium', 'staff', 'gold']);
    ok(W.g.rangedMode(true) === null, '牧師拿法杖不能施法');
  }

  // 14. 瞄準：F 自動選最近、看得到的怪物（不算動作）；Tab 換目標；F／Enter 出手；Esc 取消
  {
    const A = arena(299, 'ranger', ['bow']);
    const { g, p } = A;
    const a = mon(g, p.x + 6, p.y);
    const b = mon(g, p.x + 3, p.y + 1);
    const hidden = mon(g, p.x - 4, p.y);
    g.world.setCell(p.x - 2, p.y, '#', 'plain');
    const t0 = g.turn;
    g.act('fire');
    ok(g.aim && g.aimTarget() === b && g.turn === t0 && g.aim.ids.length === 2 && !g.aim.ids.includes(hidden.id), `F 選最近的看得到的怪物：${g.aimTarget() && g.aimTarget().id}`);
    g.aimNext();
    ok(g.aimTarget() === a, 'Tab 換下一個');
    g.aimNext();
    ok(g.aimTarget() === b, 'Tab 繞回第一個');
    g.aimCancel();
    ok(!g.aim && g.turn === t0, 'Esc 取消，不算動作');
    g.act('fire');
    g.aimNext();
    const n0 = g.bagCount('arrow');
    const ev = events(() => g.aimFire());
    ok(!g.aim && g.turn === t0 + 1 && g.bagCount('arrow') === n0 - 1 && ev.some((e) => e.by === 'player' && e.d === a) && g.battle.targetId === a.id, '出手打瞄準的那隻，算一個動作');
    g.monsters = [hidden];
    g.act('fire');
    ok(!g.aim && g.log[0].text.includes('看不到怪物'), '射程內看不到怪物時不進瞄準');
  }

  // 15. 商店的箭矢：一捆 20 支、5 金幣（乘品質與經濟），買了疊進背包
  {
    const g = new FE.Game(300);
    g.start({ cls: 'ranger', picks: ['bow'] });
    const smith = g.world.npcs.find((n) => n.role === 'smith');
    const v = g.world.villageById(smith.villageId);
    const p = g.player;
    p.copper = 1000;
    const pr = G.shopPrice('arrow', 0, v, g.chaMod());
    ok(pr === Math.round(50 * FE.Steading.shopFactor(v) * G.buyFactor(g.chaMod())) && shopDo(g, smith, 'buyItem:arrow:0') && g.bagCount('arrow') === 40 && p.copper === 1000 - pr, `買一捆箭：${pr} 銅，箭 ${g.bagCount('arrow')}`);
    ok(g.log.some((l) => l.text.includes('一捆 20 支的箭矢')), '買箭的訊息');
  }

  // 16. 第二十九版再追加：六個職業的起始裝備與能力、牧師的神聖之光、聖騎士的神聖與治療、野蠻人的穿著限制
  {
    useClasses('new');
    const combos = (arr, k) => (k === 0 ? [[]] : arr.flatMap((x, i) => combos(arr.slice(i + 1), k - 1).map((r) => [x].concat(r))));
    const product = (lists) => lists.reduce((acc, l) => acc.flatMap((a) => l.map((x) => a.concat(x))), [[]]);
    const spec = {
      warrior: { fixed: ['medium'], groups: [[1, 'sword,waraxe,shortspear,spear'], [2, 'shield,herb,gold']], n: 12, body: 'medium' },
      ranger: { fixed: ['light', 'bow'], groups: [[1, 'dagger,shortsword']], n: 2, body: 'light' },
      mage: { fixed: ['robe', 'staff'], groups: [[1, 'dagger,herb']], n: 2, body: 'robe' },
      priest: { fixed: ['medium', 'club'], groups: [[1, 'shield,staff'], [1, 'herb,gold']], n: 4, body: 'medium' },
      paladin: { fixed: ['heavy', 'shield'], groups: [[1, 'sword,warhammer,shortspear'], [1, 'herb,gold']], n: 6, body: 'heavy' },
      barbarian: { fixed: ['light'], groups: [[1, 'greataxe,waraxe'], [1, 'shortspear,herb']], n: 4, body: 'light' },
    };
    for (const [cls, s] of Object.entries(spec)) {
      const c = FE.CLASSES[cls];
      ok(c.fixed.join() === s.fixed.join() && c.groups.map((gr) => `${gr.pick}:${gr.of}`).join('|') === s.groups.map(([n, of]) => `${n}:${of}`).join('|'), `${cls} 的固定裝備與可挑的 ${c.fixed}／${c.groups.map((gr) => gr.of)}`);
      const all = product(c.groups.map((gr) => combos(gr.of, gr.pick)));
      ok(all.length === s.n, `${cls} 的起始挑法 ${all.length} 種（應該 ${s.n}）`);
      for (const picks of all) {
        const g = new FE.Game(430);
        g.start({ cls, picks });
        const p = g.player;
        const have = [p.equip.main, p.equip.off, p.equip.body].concat(p.bag.map((e) => e.gear)).filter(Boolean).map((x) => x.type);
        const want = c.fixed.concat(picks).map((id) => FE.START_OPTS[id].gear).filter(Boolean);
        ok(p.equip.body && p.equip.body.type === s.body && want.every((t) => have.includes(t)) && have.length === want.length, `${cls} ${picks} 的起始裝備 ${have}（應該 ${want}）`);
        ok(g.bagCount('herb') === (picks.includes('herb') ? 2 : 0) && p.copper === (picks.includes('gold') ? 200 : 0), `${cls} ${picks} 的藥草與 20 銀`);
      }
    }

    // 治療：牧師加感知修正值、聖騎士加魅力修正值，1d8，最少 1，冷卻 3 回合
    const healSpread = (cls, picks, attr) => {
      const { g, p } = arena(431, cls, picks);
      Object.assign(p.attr, attr);
      p.maxHp = 1000;
      const got = [];
      for (let i = 0; i < 300; i++) { p.hp = 500; g.battle.healCd = 0; g.act('heal'); got.push(p.hp - 500); }
      return spread(got);
    };
    ok(healSpread('priest', ['shield', 'herb'], { wis: 16, cha: 8 }) === '4～11', `牧師治療 1d8＋感知修正值 +3：${healSpread('priest', ['shield', 'herb'], { wis: 16, cha: 8 })}`);
    ok(healSpread('priest', ['shield', 'herb'], { wis: 10, cha: 18 }) === '1～8', '牧師治療不看魅力');
    ok(healSpread('paladin', ['sword', 'herb'], { cha: 16, wis: 8 }) === '4～11', `聖騎士治療 1d8＋魅力修正值 +3：${healSpread('paladin', ['sword', 'herb'], { cha: 16, wis: 8 })}`);
    ok(healSpread('paladin', ['sword', 'herb'], { cha: 10, wis: 18 }) === '1～8', '聖騎士治療不看感知');
    {
      const { g, p } = arena(432, 'warrior', ['sword', 'shield', 'herb']);
      p.hp = 5;
      const t0 = g.turn;
      g.act('heal');
      ok(p.hp === 5 && g.turn === t0 && g.log[0].text.includes('牧師和聖騎士'), '戰士不會治療');
      ok(FE.CLASSES.mage.heal === undefined && FE.CLASSES.barbarian.heal === undefined && FE.CLASSES.ranger.heal === undefined, '只有牧師、聖騎士有治療');
    }

    // 聖騎士：每個動作第一下命中多 1d8 神聖傷害；牧師沒有
    {
      const { g, p } = arena(433, 'paladin', ['sword', 'herb']);
      const m = mon(g, p.x + 1, p.y);
      const ev = events(() => { for (let i = 0; i < 300; i++) { p.hp = p.maxHp = 1e6; p.equip.main.dur = p.equip.main.max = 1e6; g.battle.targetId = m.id; g.strike('attack', m); } }).filter((e) => e.by === 'player' && !e.counter);
      const hits = ev.filter((e) => e.key === 'hit' || e.key === 'hard' || e.key === 'crit');
      ok(hits.length > 100 && hits.every((e) => e.holy >= 1 && e.holy <= 8) && ev.filter((e) => !hits.includes(e)).every((e) => e.holy === 0), `聖騎士命中多 1d8 神聖傷害：${spread(hits.map((e) => e.holy))}`);
      ok(g.rangedMode(true) === null, '聖騎士拿長劍按 F 不能遠程');
      const pr = arena(434, 'priest', ['shield', 'herb']);
      const m2 = mon(pr.g, pr.p.x + 1, pr.p.y);
      const ev2 = events(() => { for (let i = 0; i < 200; i++) { pr.p.hp = pr.p.maxHp = 1e6; pr.p.equip.main.dur = pr.p.equip.main.max = 1e6; pr.g.battle.targetId = m2.id; pr.g.strike('attack', m2); } }).filter((e) => e.by === 'player' && !e.counter);
      ok(ev2.length > 100 && ev2.every((e) => e.holy === 0), '牧師沒有命中的神聖附加傷害（那是聖騎士的）');
    }

    // 牧師的神聖之光（按 F）：1d8 神聖傷害加感知修正值，命中加感知修正值，射程 5／20 加感知修正值，不用武器、不練技能、不丟武器
    {
      const { g, p, w } = arena(435, 'priest', ['staff', 'gold']);
      p.attr.wis = 14;
      p.skills = Ch.freshSkills();
      const club = p.equip.main;
      const r = g.rangedMode(true);
      ok(r && r.mode === 'light' && r.range.join() === '7,22', `神聖之光射程 5／20 加感知修正值 +2：${r && r.range}`);
      const pf = Ch.profile(p, null, 'light');
      ok(pf.type === 'holy' && pf.die.join() === '1,8' && pf.dmg === 2 && pf.hit === 2 && pf.mastery === null && pf.skills.length === 0, '神聖之光的算法：1d8 神聖、傷害與命中各加感知修正值');
      const m = mon(g, p.x + 3, p.y);
      const t0 = g.turn;
      const ev = events(() => { for (let i = 0; i < 300; i++) { p.hp = p.maxHp = 1e6; g.fireAt(m); } }).filter((e) => e.by === 'player');
      const cl = ev.filter((e) => (e.key === 'hit' || e.key === 'hard') && !e.dodged && !e.crit && !e.resisted);
      ok(g.turn === t0 + 300 && ev.length === 300 && ev.every((e) => e.mode === 'light' && e.dmgType === 'holy' && e.holy === 0) && spread(cl.map((e) => e.dmg)) === '3～10', `神聖之光 1d8+2：${spread(cl.map((e) => e.dmg))}`);
      ok(Object.keys(FE.SKILLS).every((k) => uses(p, k) === 0) && p.equip.main === club && w.items.length === 0, '神聖之光不練技能、不丟武器');
      p.attr.wis = 8;
      ok(g.rangedMode(true).range.join() === '4,19', '感知修正值 -1 射程縮 1');
      p.equip.main = null;
      ok(g.rangedMode(true).mode === 'light', '手上沒有武器也能放神聖之光');
      const wr = arena(436, 'warrior', ['sword', 'shield', 'herb']);
      ok(wr.g.rangedMode(true) === null && arena(437, 'mage', ['herb']).g.rangedMode(true).mode === 'spell', '戰士按 F 不能遠程、法師拿法杖是範圍魔攻');
    }

    // 野蠻人不能穿中甲、重甲（輕甲、衣袍、盾牌可以）
    {
      const { g, p } = arena(438, 'barbarian', ['greataxe', 'herb']);
      const can = (t) => Ch.canWear(p, G.make(t, 0, 1));
      ok(!can('medium') && !can('hide') && !can('breastplate') && !can('heavy') && !can('ringmail') && !can('plate') && can('light') && can('padded') && can('studded') && can('robe') && can('mrobe') && can('shield'), '野蠻人只穿得了輕甲、衣袍、盾牌');
      g.bagAddGear(G.make('medium', 0, g.nextGearId++));
      const body0 = p.equip.body;
      const t0 = g.turn;
      g.equipItem(p.bag.find((e) => e.gear && e.gear.type === 'medium'));
      ok(p.equip.body === body0 && g.turn === t0 && g.log[0].text.includes('不能穿'), `野蠻人穿中甲被擋下：${g.log[0].text}`);
      const pal = arena(439, 'paladin', ['sword', 'herb']);
      ok(Ch.canWear(pal.p, G.make('plate', 0, 1)) && Ch.canWear(arena(440, 'warrior', ['sword', 'shield', 'herb']).p, G.make('heavy', 0, 1)), '其他職業穿什麼都行');
    }

    // 投擲（按 T）：所有武器都能丟，副手的武器先丟，射程一律 4／12 加感知修正值，掉在目標那格；有投擲特質的照武器骰並練那項技能，其他是 1d4 鈍擊，弓和輕弩 1 點；都練射擊
    {
      const { g, p, w } = arena(441, 'warrior', ['sword', 'shield', 'herb']);
      p.attr.wis = 10;
      p.attr.str = 10;
      p.attr.dex = 10;
      p.skills = Ch.freshSkills();
      const target = () => { g.monsters = []; return mon(g, p.x + 3, p.y); };
      const throwOnce = (weapon, off) => {
        p.equip.main = weapon;
        p.equip.off = off || null;
        w.items.length = 0;
        const m = target();
        const ev = events(() => g.fireAt(m, 'throw')).filter((e) => e.by === 'player');
        return { m, ev: ev[0] };
      };
      const sample = (type, n) => {
        const dmgs = [];
        for (let i = 0; i < n; i++) {
          p.hp = p.maxHp = 1e6;
          p.skills = Ch.freshSkills(); // 技能練起來會加傷害，每次都從 0 級開始
          const r = throwOnce(G.make(type, 0, g.nextGearId++));
          if (r.ev && (r.ev.key === 'hit' || r.ev.key === 'hard') && !r.ev.dodged && !r.ev.crit && !r.ev.resisted) dmgs.push(r.ev.dmg);
        }
        return spread(dmgs);
      };
      const rm = g.rangedMode(true, 'throw');
      ok(rm.mode === 'throw' && rm.range.join() === '4,12', `投擲射程 4／12 加感知修正值 0：${rm.range}`);
      p.attr.wis = 14;
      ok(g.rangedMode(true, 'throw').range.join() === '6,14', '感知修正值 +2 射程 6／14');
      p.attr.wis = 10;
      ok(g.rangedMode(true) === null, '長劍按 F 不能遠程（要按 T 丟）');
      // 傷害
      ok(sample('sword', 300) === '1～4', `丟長劍是臨時武器 1d4：${sample('sword', 300)}`);
      ok(sample('shortspear', 300) === '1～6', `丟短矛照自己的 1d6：${sample('shortspear', 300)}`);
      ok(sample('dagger', 300) === '1～4', `丟短刀照自己的 1d4：${sample('dagger', 300)}`);
      ok(sample('greataxe', 300) === '1～4', `丟巨斧也是臨時武器 1d4：${sample('greataxe', 300)}`);
      ok(sample('bow', 200) === '1～1' && sample('crossbow', 200) === '1～1', '丟弓和輕弩只有 1 點');
      // 擲出去的武器掉在目標那格；練的技能
      p.skills = Ch.freshSkills();
      let r = throwOnce(G.make('sword', 0, g.nextGearId++));
      ok(w.items.length === 1 && w.items[0].x === r.m.x && w.items[0].y === r.m.y && w.items[0].gear.type === 'sword' && !p.equip.main, '丟出去的長劍掉在目標那格，手上空了');
      ok(uses(p, 'sword') === 0 && uses(p, 'fight') === 0 && uses(p, 'shoot') > 0, `丟長劍只練射擊：劍術 ${uses(p, 'sword')}、射擊 ${uses(p, 'shoot')}`);
      p.skills = Ch.freshSkills();
      r = throwOnce(G.make('shortspear', 0, g.nextGearId++));
      ok(uses(p, 'spear') === uses(p, 'shoot') && uses(p, 'spear') > 0 && uses(p, 'fight') === 0, `丟短矛練槍術和射擊：槍術 ${uses(p, 'spear')}、射擊 ${uses(p, 'shoot')}`);
      p.skills = Ch.freshSkills();
      r = throwOnce(G.make('club', 0, g.nextGearId++));
      ok(uses(p, 'mace') === 0 && uses(p, 'shoot') > 0, '丟硬頭錘不練錘術');
      // 副手拿武器先丟副手
      const main = G.make('sword', 0, g.nextGearId++);
      const off = G.make('dagger', 0, g.nextGearId++);
      p.equip.main = main;
      p.equip.off = off;
      ok(g.rangedMode(true, 'throw').slot === 'off', '副手拿著武器，先丟副手的');
      r = throwOnce(main, off);
      ok(p.equip.main === main && !p.equip.off && w.items.length === 1 && w.items[0].gear === off, '丟出去的是副手的短刀，主手的長劍留著');
      // 副手是盾牌就丟主手；兩手都空沒有東西可丟
      p.equip.main = G.make('sword', 0, g.nextGearId++);
      p.equip.off = G.make('shield', 0, g.nextGearId++);
      ok(g.rangedMode(true, 'throw').slot === 'main', '副手是盾牌，丟主手的');
      p.equip.main = null;
      ok(g.rangedMode(true, 'throw') === null, '手上沒有武器沒東西可丟');
      // 走過去撿回來
      g.monsters = [];
      p.equip.off = null;
      const sword = G.make('sword', 0, g.nextGearId++);
      r = throwOnce(sword);
      p.x = r.m.x - 1;
      g.monsters = [];
      g.move(1, 0);
      ok(w.items.length === 0 && (p.equip.main === sword || p.bag.some((e) => e.gear === sword)), '走過去把丟出去的武器撿回來');
    }

    // 護甲（第二十九版再追加）：力量不到需求走一步 15 刻、潛行劣勢只是標記、各店賣的防具
    {
      const { g, p } = arena(442, 'warrior', ['sword', 'shield', 'herb']);
      p.skills = Ch.freshSkills();
      p.attr.dex = 10;
      const stepTicks = () => { const t0 = g.ticks; g.move(1, 0); return g.ticks - t0; };
      const walk = (type, str) => { p.equip.body = G.make(type, 0, g.nextGearId++); p.attr.str = str; return stepTicks(); };
      ok(walk('heavy', 12) === 15 + 2 && walk('heavy', 13) === 10 + 2, `鎖子甲要力量 13：不夠走一步 15 刻（加防具多花的 2 刻），夠了 10 刻：${walk('heavy', 12)}／${walk('heavy', 13)}`);
      ok(walk('splint', 14) === 15 + 2 && walk('splint', 15) === 10 + 2 && walk('plate', 14) === 15 + 2 && walk('plate', 15) === 10 + 2, '條板甲、全身板甲要力量 15');
      ok(walk('ringmail', 8) === 10 + 2 && walk('medium', 8) === 10 + 1 && walk('light', 8) === 10, '環甲、中甲、輕甲沒有力量需求');
      p.attr.str = 12;
      p.equip.body = G.make('heavy', 0, g.nextGearId++);
      p.attr.dex = 18; // 敏捷高走路只要 6 刻，力量不夠還是 15 刻（取較大的）
      ok(stepTicks() === 15 + 2, '力量不夠的 15 刻跟敏捷的步數取較大的');
      const stealth = Object.keys(FE.GEAR).filter((k) => FE.GEAR[k].cat === 'armor' && FE.GEAR[k].stealth).sort().join();
      ok(stealth === 'halfplate,heavy,medium,padded,plate,ringmail,splint', `潛行劣勢的防具：${stealth}`);
      // 描述：每件防具一句說明，戰鬥數字不受標記影響
      ok(Object.keys(FE.GEAR).filter((k) => FE.GEAR[k].cat === 'armor' && k !== 'mrobe' && k !== 'robe').every((k) => FE.GEAR[k].desc && FE.GEAR[k].desc.length > 8 && !/D&D|龍與地下城/.test(FE.GEAR[k].desc)), '每件防具都有一句遊戲內的說明');
      // 商店
      const S = G.SHOPS;
      const armorBuy = (s) => Object.values(S[s].buy).flat().filter((t) => FE.GEAR[t].cat === 'armor' && t !== 'robe' && t !== 'mrobe').sort().join();
      ok(armorBuy('blacksmith') === 'chainshirt,hide,light,padded,ringmail', `村莊鐵匠賣的防具：${armorBuy('blacksmith')}`);
      ok(Object.values(S.blacksmith.buy).flat().includes('shield') && S.blacksmith.craft.includes('shield'), '村莊鐵匠賣盾牌');
      const allArmor = Object.keys(FE.GEAR).filter((k) => FE.GEAR[k].cat === 'armor' && k !== 'robe' && k !== 'mrobe').sort().join();
      ok(armorBuy('armorer') === allArmor && S.armorer.craft.slice().sort().join() === (allArmor + ',shield').split(',').sort().join(), `城鎮盔甲匠什麼防具都賣、都能打造：${armorBuy('armorer')}`);
      ok(!Object.values(S.weaponsmith.buy).flat().some((t) => FE.GEAR[t].cat === 'armor'), '城鎮武器匠不賣防具');
    }
    useClasses('legacy');
  }
}
UNITS.combat28 = () => { try { testCombat28(); } catch (e) { fail('戰鬥測試拋出例外：' + e.stack); } };

// ---- 工作：子行程各跑一項，主行程把結果合起來 ----
// ---- 等級 L 角色與競技場（第二十九版）----
// 技能等級取多少算「合理」：看機器人實際打出來的比例（戰士、法師單人 1500 個動作與四人等效 8000 個動作，各 2 個種子）：
// 主武器技能的經驗約是角色累計經驗值的 2.5 倍、格鬥（近戰）或射擊（遠程）約 3 倍、穿甲約 2.5 倍（有穿中甲或重甲才算）、
// 閃避約 0.5 倍、盾牌使用約 0.6 倍（有拿盾牌才算）。等級 L 的角色就拿 `FE.levelExp(L)` 乘這些倍率，換成技能等級
const SKILL_PER_EXP = { main: 2.5, fight: 3, armor: 2.5, dodge: 0.5, shield: 0.6 };
// 累積這麼多技能經驗是幾級
function skillLevelFor(exp) {
  let lv = 0;
  while (exp >= FE.Char.skillNeed(lv)) exp -= FE.Char.skillNeed(lv++);
  return lv;
}
// 世界等級對應的裝備品質（機器人的武器靠買、打造、掉落，品質大約隨世界等級升到做工好～優秀）：1→普通、2～3→做工好、4～5→精良、6 以上→優秀
const qualityForWL = (wl) => Math.min(3, Math.floor(wl / 2));
// 建立「等級 L 角色」：開新世界時挑職業的機器人起始裝備與種族，屬性點照職業主屬性與體質輪流分配（L−1 點，同 botPoints），
// 技能練到合理等級，裝備（武器、身上的防具、盾牌）照世界等級給對應品質。回傳新遊戲；level 1、wl 1 就是剛開局的角色
function makeLevelChar(cls, level, wl, seed) {
  const game = new FE.Game(seed || 9001);
  const picks = FE.Char.validPicks(cls, BOT_PICKS[cls]) ? BOT_PICKS[cls] : FE.Char.defaultPicks(cls); // 舊職業定義下（場景檢查）機器人的挑法不一定合法
  game.start({ cls, picks, body: BOT_BODY[cls] });
  game.level = level;
  game.exp = FE.levelExp(level);
  const p = game.player;
  p.points = C.LEVEL_POINT_AT.filter((l) => l <= level).length * C.LEVEL_POINTS; // 升到 4、8、12、16、19 級才有點數
  botPoints(game);
  p.hp = p.maxHp;
  const q = qualityForWL(wl);
  for (const g of FE.Gear.equipped(p)) g.q = q;
  const c = FE.CLASSES[cls];
  const E = FE.levelExp(level);
  const lv = (k) => ({ lv: skillLevelFor(E * SKILL_PER_EXP[k]), n: 0 });
  const w = p.equip.main ? FE.GEAR[p.equip.main.type] : null;
  p.skills.dodge = lv('dodge');
  if (p.equip.off && FE.GEAR[p.equip.off.type].cat === 'shield') p.skills.shield = lv('shield');
  const aid = FE.Char.armorSkillId(p);
  if (aid && aid !== 'light') p.skills[aid] = lv('armor'); // 輕甲幾乎擋不下傷害（皮甲物理減傷 0），機器人也練不起來，不給
  if (w) {
    p.skills[w.skill] = lv('main');
    if (w.ammo) p.skills.shoot = lv('fight');
    else p.skills.fight = lv('fight');
  }
  if (c.spell) p.skills.staff = lv('main');
  return game;
}
// 競技場：把冒險者放在一塊整平的空地上（聚落的圈外），怪物也直接放上去對打；關掉創世、掉落、經驗值，免得量測途中角色變了
function arenaGame(cls, level, wl, seed) {
  const game = makeLevelChar(cls, level, wl, seed);
  const w = game.world;
  const p = game.player;
  let spot = null;
  w.forEachCell((x, y) => {
    if (spot || w.inBuffer(x, y) || !w.passable(x, y)) return;
    if (!w.inBounds(x - 6, y - 6) || !w.inBounds(x + 6, y + 6)) return;
    for (let dy = -6; dy <= 6; dy += 3) for (let dx = -6; dx <= 6; dx += 3) if (w.inBuffer(x + dx, y + dy)) return;
    spot = { x, y };
  });
  for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
    w.setCell(spot.x + dx, spot.y + dy, '.', 'plain');
    w.setHeight(spot.x + dx, spot.y + dy, 0);
  }
  game.monsters = [];
  game.world.chests = [];
  p.x = spot.x;
  p.y = spot.y;
  game.checkCreate = () => {};
  game.addExp = () => {};
  game.dropChest = () => {};
  game.dropGear = () => {};
  game.defeat = (m) => { game.monsters = game.monsters.filter((o) => o !== m); if (game.battle.targetId === m.id) game.battle.targetId = null; };
  return game;
}
const ARENA_TYPES = process.env.FE_ARENA_TYPES ? process.env.FE_ARENA_TYPES.split(',') : ['TERRAIN', 'UNREACHABLE', 'VALUE', 'REFERENCE', 'CLIFF']; // 各種異常輪流，不含碎裂；FE_ARENA_TYPES 可以指定只量哪幾種（查哪一種異常拖慢下數用）
const ARENA_SCOPE = { small: [2, 4], mid: [6, 10] };
function arenaMonster(game, tier, wl, i, dx) {
  const p = game.player;
  const sc = ARENA_SCOPE[tier][i % 2];
  const m = FE.dressMonster(FE.makeMonster({ type: ARENA_TYPES[i % ARENA_TYPES.length], x: p.x + dx, y: p.y, cells: [], scope: sc, data: {} }, 700000 + i, wl), game.world);
  m.home = { x: m.x, y: m.y };
  game.monsters = [m];
  return m;
}
// 一場對打：打到怪物倒下，數冒險者自己出手幾下（遠程的職業站在 3 格外射，牠被設成目標後會纏上來；貼身的職業貼著打）。冒險者每下都補滿血
function arenaFight(game, tier, wl, i) {
  const p = game.player;
  const ranged = game.rangedMode(true);
  const m = arenaMonster(game, tier, wl, i, ranged ? 3 : 1);
  let n = 0;
  game.battle.cooldown = 0;
  const maxHp = p.maxHp;
  p.maxHp = 1e9; // 對打時冒險者不會倒下（倒下會被送回聚落，後面就打不下去了）
  for (; n < 200 && game.monsters.includes(m); n++) {
    p.hp = p.maxHp;
    for (const g of FE.Gear.equipped(p)) g.dur = g.max;
    if (game.bagCount('arrow') < 5) game.bagAdd('arrow', 20);
    const rm = game.rangedMode(true);
    if (rm && rm.mode !== 'throw' && game.shootTargets(rm.range).includes(m)) game.fireAt(m);
    else {
      game.battle.targetId = m.id;
      game.act(game.battle.cooldown === 0 && m.hp > 8 ? 'deep' : 'attack');
    }
  }
  p.maxHp = maxHp;
  p.hp = maxHp;
  if (n >= 200) fail(`競技場 ${game.player.cls} 打不倒 ${m.name}（世界等級 ${wl}）：怪物 ${m.hp}/${m.maxHp}，相對位置 ${m.x - p.x},${m.y - p.y}，${game.log.slice(0, 2).map((l) => l.text).join('｜')}`);
  game.monsters = [];
  return n;
}
// 被怪物打一下：怪物貼著冒險者出手 N 次，量平均傷害與打中比例（技能、耐久每次還原，免得量測途中變強）
function arenaTaken(game, tier, wl, N, i0) {
  const p = game.player;
  const m = arenaMonster(game, tier, wl, i0, 1);
  const skills = JSON.stringify(p.skills);
  let dmg = 0;
  let hit = 0;
  const maxHp = p.maxHp;
  p.maxHp = 1e9;
  for (let i = 0; i < N; i++) {
    p.hp = p.maxHp;
    p.block = null;
    for (const g of FE.Gear.equipped(p)) g.dur = g.max;
    const r = FE.Combat.resolveAttack(game, m, p, 'attack', { noCounter: true });
    dmg += r.dmg;
    if (r.dmg > 0) hit++;
    if (i % 25 === 24) p.skills = JSON.parse(skills);
  }
  p.skills = JSON.parse(skills);
  p.maxHp = maxHp;
  p.hp = maxHp;
  game.monsters = [];
  return { n: N, dmg, hit };
}
// 競技場量測：每個職業、世界等級 1～7、角色等級 1／5／10／15，量打倒小怪物、中型怪物各要幾下和被打一下的平均傷害。
// 結果放在 arenaData[職業][角色等級][世界等級]：{ small: { n 場數, sum 總下數 }, mid: {...}, takenSmall: { n, dmg, hit }, takenMid: {...} }
const ARENA_LEVELS = [1, 5, 10, 15];
function runArena(cls) {
  const levels = QUICK ? [1, 15] : ARENA_LEVELS;
  const wls = QUICK ? [1, 4, 7] : [1, 2, 3, 4, 5, 6, 7];
  const trials = QUICK ? 10 : 40;
  const out = (arenaData[cls] = {});
  const hook0 = FE.Combat.hook;
  FE.Combat.hook = null; // 競技場的判定不算進戰鬥統計
  for (const L of levels) {
    out[L] = {};
    for (const wl of wls) {
      const game = arenaGame(cls, L, wl, 9001 + BOT_CLASSES.indexOf(cls));
      const cell = (out[L][wl] = { small: { n: 0, sum: 0 }, mid: { n: 0, sum: 0 }, takenSmall: { n: 0, dmg: 0, hit: 0 }, takenMid: { n: 0, dmg: 0, hit: 0 } });
      const snap = JSON.stringify(game.player.skills);
      for (const tier of ['small', 'mid']) {
        for (let i = 0; i < trials; i++) {
          game.player.skills = JSON.parse(snap);
          const k = arenaFight(game, tier, wl, i);
          cell[tier].n++;
          cell[tier].sum += k;
        }
        game.player.skills = JSON.parse(snap);
        const t = arenaTaken(game, tier, wl, trials * 10, 0);
        Object.assign(cell[tier === 'small' ? 'takenSmall' : 'takenMid'], t);
      }
    }
  }
  FE.Combat.hook = hook0;
}

// ---- 第二十九版：種族與體型、技能經驗、屬性效果、升級門檻、擴充武器第一批、負重：場景測試 ----
function testGrowth29() {
  const ok = (cond, msg) => { growthChecks++; if (!cond) fail('角色與成長 ' + msg); };
  const near = (a, b, eps) => Math.abs(a - b) <= (eps === undefined ? 1e-9 : eps);
  const G = FE.Gear;
  const Ch = FE.Char;
  const hook0 = FE.Combat.hook;
  const uses = (p, id) => { const s = p.skills[id]; let t = s.n; for (let l = 0; l < s.lv; l++) t += Ch.skillNeed(l); return t; };
  const spread = (a) => (a.length ? `${Math.min(...a)}～${Math.max(...a)}` : '沒有');
  const events = (fn) => {
    const ev = [];
    FE.Combat.hook = (e) => ev.push(e);
    try { fn(); } finally { FE.Combat.hook = hook0; }
    return ev;
  };
  const mkg = (seed, cls, picks, body) => { const g = new FE.Game(seed); g.start({ cls, picks, body }); g.checkCreate = () => {}; g.monsters = []; g.soldiers = []; return g; };
  const body = (race, height, build, bonus) => ({ race, bonus: bonus || {}, height: height || 4, build: build || 4 });
  // 競技場：平地、世界不走（怪物不自己動），冒險者站中央
  const arena = (cls, seed) => {
    const g = arenaGame(cls || 'warrior', 1, 1, seed || 9100);
    g.worldEvery = 1e9;
    const p = g.player;
    p.hp = p.maxHp = 1e6;
    p.attr = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
    p.skills = Ch.freshSkills();
    p.equip = { main: null, off: null, body: null };
    p.bag = [];
    p.size = 70000;
    return g;
  };
  const mon = (g, x, y, type) => {
    const m = FE.dressMonster(FE.makeMonster({ type: type || 'RUNTIME', x, y, cells: [[x, y]], scope: 2, data: {} }, g.nextMonsterId++, 1), g.world);
    Object.assign(m, { x, y, home: { x, y }, maxHp: 1e9, hp: 1e9, atk: 1 });
    g.monsters.push(m);
    return m;
  };
  const gear = (type, q) => G.make(type, q || 0, 5000 + Math.floor(Math.random() * 1e6));

  // 1. 種族與體型：體型＝基本體型 ×（1＋0.05×（身高−4））×（1＋0.05×（體格−4））
  {
    const R = FE.PLAYER_RACES;
    ok(Object.keys(R).join() === 'human,dwarf,elf' && R.human.name === '人類' && R.dwarf.name === '矮人' && R.elf.name === '精靈', '種族是人類、矮人、精靈');
    ok(R.human.size === 70000 && R.human.free === 2 && !R.human.bonus && R.dwarf.size === 60000 && R.dwarf.bonus.con === 2 && R.elf.size === 60000 && R.elf.bonus.dex === 2, '人類 70,000 自己加 2 點、矮人 60,000 體質 +2、精靈 60,000 敏捷 +2');
    ok(FE.HEIGHTS.join() === '非常矮,矮,略矮,普通,略高,高,非常高' && FE.BUILDS.join() === '非常瘦弱,瘦,略瘦,普通,略壯,壯碩,非常魁梧', '身高 1～7 與體格 1～7 的描述');
    let bad = 0;
    for (const race of Object.keys(R)) for (let h = 1; h <= 7; h++) for (let b = 1; b <= 7; b++) {
      if (FE.bodySize(race, h, b) !== Math.round(R[race].size * (1 + 0.05 * (h - 4)) * (1 + 0.05 * (b - 4)))) bad++;
    }
    ok(bad === 0 && FE.bodySize('human', 4, 4) === 70000 && FE.bodySize('human', 1, 1) === 50575 && FE.bodySize('human', 7, 7) === 92575 && FE.bodySize('dwarf', 4, 4) === 60000 && FE.bodySize('elf', 7, 1) === 58650 && FE.bodySize('dwarf', 1, 1) === 43350, `體型公式（49 種組合不對 ${bad} 種）`);
  }

  // 2. 建角：種族的屬性加成、人類自己加 2 點（同一項或分兩項，上限 18）
  {
    const dw = mkg(1, 'warrior', undefined, body('dwarf')).player;
    ok(dw.race === 'dwarf' && dw.size === 60000 && dw.attr.con === 17 && dw.attr.str === 16 && dw.height === 4 && dw.build === 4 && dw.maxHp === Math.floor((10 + 17) * 1.5), `矮人戰士體質 15+2＝17，生命 ${dw.maxHp}`);
    const el = mkg(1, 'ranger', undefined, body('elf', 5, 3)).player;
    ok(el.race === 'elf' && el.attr.dex === 18 && el.height === 5 && el.build === 3 && el.size === FE.bodySize('elf', 5, 3), `精靈遊俠敏捷 16+2＝18：${el.attr.dex}`);
    const h1 = mkg(1, 'warrior', undefined, body('human', 4, 4, { str: 2 })).player;
    ok(h1.attr.str === 18 && h1.attr.dex === 13 && h1.size === 70000, `人類兩點加同一項：力量 ${h1.attr.str}`);
    const h2 = mkg(1, 'mage', undefined, body('human', 4, 4, { str: 1, int: 1 })).player;
    ok(h2.attr.str === 9 && h2.attr.int === 17, `人類兩點分兩項：力量 ${h2.attr.str}、智力 ${h2.attr.int}`);
    const bad = (b) => { try { mkg(1, 'warrior', undefined, b); return false; } catch (e) { return true; } };
    ok(bad(body('human', 4, 4, { str: 1 })) && bad(body('human', 4, 4, { str: 3 })) && bad(body('human', 4, 4, { str: 1, luck: 1 })) && bad(body('human', 4, 4, {})) && bad({ race: 'human', bonus: { str: 2 }, height: 0, build: 4 }) && bad({ race: 'human', bonus: { str: 2 }, height: 4, build: 8 }) && bad(body('orc', 4, 4)), '人類少加、多加、加到不存在的屬性，或身高體格不在 1～7，都該不能開局');
    const neutral = mkg(1, 'warrior').player;
    ok(neutral.race === 'human' && neutral.size === 70000 && neutral.attr.str === 16, '沒給體型的測試角色是普通體型的人類');
    // 起始屬性不超過上限
    ok(['warrior', 'ranger', 'mage', 'priest'].every((c) => ['human', 'dwarf', 'elf'].every((r) => Object.values(mkg(2, c, undefined, body(r, 4, 4, r === 'human' ? { con: 2 } : {})).player.attr).every((v) => v <= C.ATTR_CAP))), '起始屬性都不超過 18');
  }

  // 3. 武器門檻（能拿／能單手）：不到「能拿」拿不動，到「能單手」單手，兩個門檻之間只能雙手；弓與輕弩射擊一律雙手
  {
    const T = {
      sword: [52500, 57500], spear: [62500, 77500], greataxe: [62500, 77500], greatsword: [62500, 77500], shortspear: [5000, 47500], staff: [5000, 47500],
      dagger: [5000, 27500], shortsword: [32500, 37500], club: [32500, 37500], warhammer: [32500, 37500], waraxe: [42500, 47500], whip: [22500, 27500],
    };
    let bad = [];
    for (const [t, [can, one]] of Object.entries(T)) {
      const g = gear(t);
      const at = (size) => Ch.grip({ size }, g);
      if (at(can - 1) !== 'none' || at(can) !== (one <= can ? 'one' : 'two') || at(one - 1) !== (one - 1 >= can ? 'two' : 'none') || at(one) !== 'one' || at(one + 20000) !== 'one') bad.push(t);
      if (FE.GEAR[t].grip.join() !== [can, one].join()) bad.push(t + ' 資料');
    }
    ok(bad.length === 0, `各武器的門檻不對：${bad}`);
    for (const t of ['bow', 'crossbow']) ok(Ch.grip({ size: 14999 }, gear(t)) === 'none' && Ch.grip({ size: 15000 }, gear(t)) === 'two' && Ch.grip({ size: 99999 }, gear(t)) === 'two', `${t} 15,000 能拿，射擊一律雙手`);
    ok(Ch.grip({ size: 5000 }, null) === 'one' && !FE.GEAR.sword.twoHand && !FE.GEAR.spear.twoHand && !FE.GEAR.waraxe.twoHand, '近戰武器沒有「雙手」標籤');
    // 人類最小體型 50,575 拿不起長劍（52,500）；矮人 60,000 剛好單手長劍；人類 70,000 拿長槍只能雙手
    ok(Ch.grip({ size: FE.bodySize('human', 1, 1) }, gear('sword')) === 'none' && Ch.grip({ size: 60000 }, gear('sword')) === 'one' && Ch.grip({ size: 70000 }, gear('spear')) === 'two' && Ch.grip({ size: 70000 }, gear('greatsword')) === 'two' && Ch.grip({ size: 92575 }, gear('greatsword')) === 'one', '體型與長劍、長槍、巨劍的拿法');
    ok(G.gripText({ size: 60000 }, gear('sword')) === '單手' && G.gripText({ size: 55000 }, gear('sword')) === '雙手' && G.gripText({ size: 50000 }, gear('sword')) === '拿不動', '背包標示的單手、雙手、拿不動');
  }

  // 4. 裝備：拿不動的武器裝備時出訊息；只能雙手的武器佔兩手；副手只能放自己體型能單手拿的武器
  {
    const g = mkg(3, 'warrior', ['shortspear', 'shield', 'herb']);
    const p = g.player;
    p.size = 50000; // 長劍 52,500 拿不起來
    const sw = gear('sword');
    g.bagAddGear(sw);
    const t0 = g.turn;
    const main0 = p.equip.main;
    g.useItem(p.bag.findIndex((e) => e.gear === sw));
    ok(p.equip.main === main0 && g.turn === t0 && /拿不起來/.test(g.log[0].text) && p.bag.some((e) => e.gear === sw), `拿不動的長劍：主手 ${p.equip.main && p.equip.main.type}、${g.log[0].text}`);
    ok(g.bagList().find((e) => e.gear === sw).grip === '拿不動' && /拿不動/.test(g.bagList().find((e) => e.gear === sw).info), '背包標出「拿不動」');
    p.size = 55000; // 長劍 52,500 能拿、57,500 才能單手：只能雙手
    ok(g.bagList().find((e) => e.gear === sw).grip === '雙手', '背包標出「雙手」');
    ok(p.equip.off && p.equip.off.type === 'shield', '起始：短矛（5,000／47,500）單手配盾牌');
    g.useItem(p.bag.findIndex((e) => e.gear === sw));
    ok(p.equip.main === sw && p.equip.off === null && p.bag.some((e) => e.gear && e.gear.type === 'shield') && g.turn === t0 + 1, '雙手拿長劍時副手的盾牌放回背包、算一個動作');
    const sh = p.bag.find((e) => e.gear && e.gear.type === 'shield');
    const t1 = g.turn;
    g.equipItem(sh);
    ok(p.equip.off === null && g.turn === t1 && /兩隻手/.test(g.log[0].text), '雙手拿著長劍不能拿盾牌');
    p.size = 60000; // 單手了
    g.equipItem(sh);
    ok(p.equip.off === sh.gear && p.equip.main === sw, '體型夠大，長劍單手配盾牌');
    // 副手：能單手拿的武器才放得上去
    ok(G.offOk(p, gear('dagger')) && G.offOk(p, gear('sword')) && !G.offOk(p, gear('greatsword')) && !G.offOk(p, gear('bow')) && !G.offOk(p, gear('crossbow')) && !G.offOk(p, gear('shield')), '體型 60,000：短刀、長劍放得上副手，巨劍、弓、弩、盾牌放不上（盾牌走自己的規則）');
    p.size = 25000;
    ok(!G.offOk(p, gear('dagger')) && !G.offOk(p, gear('whip')) && !G.offOk(p, gear('shortspear')), '體型 25,000 的副手：短刀（要 27,500 才能單手）、鞭子（27,500）、短矛（47,500）都不行');
    p.size = 27500;
    ok(G.offOk(p, gear('dagger')) && G.offOk(p, gear('whip')) && !G.offOk(p, gear('shortspear')), '體型 27,500 短刀、鞭子可以放副手，短矛還不行');
    // 把拿不動的武器放副手：不行
    const g2 = mkg(4, 'ranger', ['dagger']);
    const p2 = g2.player;
    p2.size = 30000;
    const sw2 = gear('shortsword');
    g2.bagAddGear(sw2);
    const t2 = g2.turn;
    g2.equipItem(g2.player.bag.find((e) => e.gear === sw2), true);
    ok(p2.equip.off === null && p2.equip.main.type === 'dagger' && g2.turn === t2 && p2.bag.some((e) => e.gear === sw2), '短劍（32,500 才能拿）體型 30,000 拿不起來，主手、副手都放不上去');
    // 體型夠大：副手放上去、不用先換主手
    p2.size = 40000;
    g2.equipItem(p2.bag.find((e) => e.gear === sw2), true);
    ok(p2.equip.off === sw2 && p2.equip.main.type === 'dagger', '體型 40,000：短劍單手，放得上副手，雙持');
  }

  // 5. 起始裝備：拿不起來的選項不列出，也不能挑
  {
    const small = FE.bodySize('dwarf', 1, 1); // 43,350
    const warrior = FE.CLASSES.warrior;
    ok(Ch.groupOptions(warrior.groups[0], small).join() === 'shortspear' && Ch.groupOptions(warrior.groups[0], 70000).join() === 'sword,spear,shortspear' && Ch.groupOptions(warrior.groups[1], small).join() === 'shield,herb,gold', `戰士在 43,350 的體型只剩短矛可挑：${Ch.groupOptions(warrior.groups[0], small)}`);
    ok(Ch.groupOptions(FE.CLASSES.ranger.groups[0], small).join() === 'bow,dagger,shortspear' && Ch.groupOptions(FE.CLASSES.priest.groups[1], small).join() === 'staff', `遊俠少了長槍、牧師只剩法杖：${Ch.groupOptions(FE.CLASSES.ranger.groups[0], small)}／${Ch.groupOptions(FE.CLASSES.priest.groups[1], small)}`);
    ok(!Ch.validPicks('warrior', ['sword', 'herb', 'gold'], small) && Ch.validPicks('warrior', ['shortspear', 'herb', 'gold'], small) && Ch.validPicks('warrior', ['sword', 'herb', 'gold'], 60000) && Ch.validPicks('warrior', ['sword', 'herb', 'gold']), '挑拿不起來的起始武器不合法');
    ok(Ch.defaultPicks('warrior', small)[0] === 'shortspear' && Ch.defaultPicks('priest', small)[1] === 'staff', '預設挑法也只挑拿得起來的');
    const g = new FE.Game(5);
    g.start({ cls: 'warrior', body: body('dwarf', 1, 1) });
    ok(g.player.equip.main.type === 'shortspear' && g.player.size === small, '體型小的戰士預設拿短矛開局');
    let threw = false;
    try { new FE.Game(5).start({ cls: 'warrior', picks: ['sword', 'herb', 'gold'], body: body('dwarf', 1, 1) }); } catch (e) { threw = true; }
    ok(threw, '體型小的矮人硬挑長劍開局要失敗');
    // 體型剛好只能雙手拿長槍的人（人類 70,000）：長槍配盾，盾放背包
    const g3 = mkg(6, 'warrior', ['spear', 'shield', 'herb'], body('human', 4, 4, { str: 2 }));
    ok(g3.player.equip.main.type === 'spear' && g3.player.equip.off === null && g3.player.bag.some((e) => e.gear && e.gear.type === 'shield'), '70,000 的人類拿長槍只能雙手，盾牌放進背包');
    const g4 = mkg(6, 'warrior', ['spear', 'shield', 'herb'], body('human', 6, 6, { str: 2 })); // 70,000×1.1×1.1＝84,700
    ok(g4.player.size === 84700 && g4.player.equip.off && g4.player.equip.off.type === 'shield', '84,700 的人類單手拿長槍，可以配盾');
  }

  // 6. 敏捷：移動刻數＝10 減敏捷修正值，最少 8（被扭曲的地面還是 30）
  {
    const g = arena('warrior', 9101);
    const p = g.player;
    let dir = 1;
    const dt = (dex) => { p.attr.dex = dex; const t0 = g.ticks; g.move(dir, 0); dir = -dir; return g.ticks - t0; }; // 左右來回走，免得走出整平的範圍
    ok(dt(10) === 10 && dt(8) === 11 && dt(12) === 9 && dt(14) === 8 && dt(16) === 8 && dt(18) === 8 && dt(6) === 12, `走一步的刻數：敏捷 10→${dt(10)}、8→${dt(8)}、12→${dt(12)}、14→${dt(14)}、18→${dt(18)}`);
    ok(Ch.moveTicks({ attr: { dex: 16 } }) === 8 && Ch.moveTicks({ attr: { dex: 11 } }) === 10, 'Char.moveTicks');
    // 怪物每 10 刻動一次：走 5 步（敏捷 14，每步 8 刻）怪物動 4 次
    p.attr.dex = 14;
    let turns = 0;
    const w0 = FE.AI.worldTurn;
    FE.AI.worldTurn = (gg) => { turns++; return w0(gg); };
    g.worldEvery = 1;
    g.tickAcc = 0;
    for (let i = 0; i < 5; i++) g.move(i % 2 ? -1 : 1, 0);
    FE.AI.worldTurn = w0;
    ok(turns === 4, `敏捷 14 走 5 步（40 刻）怪物動 ${turns} 次（應該 4）`);
  }

  // 7. 體質：受到的物理傷害在防具減完之後再減（體質修正值÷2，捨去），至少吃 1 點
  {
    const g = arena('warrior', 9102);
    const p = g.player;
    const m = mon(g, p.x + 1, p.y);
    m.atk = 10;
    const dmgs = (con, body) => {
      p.attr.con = con;
      p.equip.body = body ? gear(body) : null;
      const seen = [];
      const ev = events(() => { for (let i = 0; i < 800; i++) { p.hp = p.maxHp = 1e6; if (p.equip.body) p.equip.body.dur = 1e6; FE.Combat.resolveAttack(g, m, p, 'attack', { noCounter: true }); } });
      for (const e of ev) if (e.by === 'monster' && (e.key === 'hit' || e.key === 'hard') && !e.dodged && !e.crit && !e.blocked) seen.push([e.dmg, e.reduced, e.conCut]);
      return seen;
    };
    const lo = (a) => Math.min(...a.map((x) => x[0]));
    const hi = (a) => Math.max(...a.map((x) => x[0]));
    ok(lo(dmgs(10)) === 9 && hi(dmgs(10)) === 11, `體質 10：atk 10 的傷害 ${lo(dmgs(10))}～${hi(dmgs(10))}`);
    ok(lo(dmgs(14)) === 8 && hi(dmgs(14)) === 10, `體質 14（+2 → 減 1）：${lo(dmgs(14))}～${hi(dmgs(14))}（應該 8～10）`);
    ok(lo(dmgs(18)) === 7 && hi(dmgs(18)) === 9, `體質 18（+4 → 減 2）：${lo(dmgs(18))}～${hi(dmgs(18))}（應該 7～9）`);
    ok(lo(dmgs(13)) === 9 && lo(dmgs(15)) === 8 && lo(dmgs(8)) === 9, '體質 13（+1）減 0、15（+2）減 1、8（-1）不加傷害');
    const heavy = dmgs(18, 'heavy'); // 重甲物理減傷 3，再減體質 2
    ok(lo(heavy) === 4 && hi(heavy) === 6 && heavy.every((x) => x[1] === 3 && x[2] === 2), `重甲＋體質 18：${lo(heavy)}～${hi(heavy)}（應該 4～6）`);
    // 至少吃 1 點
    m.atk = 1;
    const tiny = dmgs(18, 'heavy');
    ok(tiny.length > 0 && lo(tiny) >= 1, `傷害很小時至少吃 1 點：最少 ${lo(tiny)}`);
    // 訊息提到體質擋下
    const g2 = arena('warrior', 9103);
    const p2 = g2.player;
    p2.attr.con = 18;
    const m2 = mon(g2, p2.x + 1, p2.y);
    m2.atk = 10;
    for (let i = 0; i < 60; i++) { p2.hp = p2.maxHp = 1e6; FE.Combat.resolveAttack(g2, m2, p2, 'attack', { noCounter: true }); }
    ok(g2.log.some((l) => /硬挺過去/.test(l.text)), '訊息有寫體質多擋下幾點');
  }

  // 8. 升級門檻：《D&D》第五版經驗表 ÷10，最高 20 級
  {
    const want = [0, 30, 90, 270, 650, 1400, 2300, 3400, 4800, 6400, 8500, 10000, 12000, 14000, 16500, 19500, 22500, 26500, 30500, 35500];
    ok(want.every((x, i) => FE.levelExp(i + 1) === x) && C.LEVEL_MAX === 20, `升級經驗表：${[...Array(20)].map((_, i) => FE.levelExp(i + 1))}`);
    const g = mkg(7, 'warrior');
    g.addExp(29);
    ok(g.level === 1, '29 點還是 1 級');
    g.addExp(1);
    ok(g.level === 2 && g.player.points === 0, '30 點升 2 級（2 級沒有屬性點）');
    g.addExp(60);
    ok(g.level === 3 && g.exp === 90, '累計 90 點升 3 級');
    g.addExp(35500 - 90);
    ok(g.level === 20 && g.player.points === 5, `累計 35,500 點升到 20 級：${g.level}、點數 ${g.player.points}（4、8、12、16、19 級各 1 點）`);
    g.addExp(100000);
    ok(g.level === 20 && g.exp === 135500, `20 級是上限，經驗值還是累積：${g.level}`);
    ok(g.player.maxHp === FE.Char.maxHp(g.player, 20), '20 級生命上限照公式');
    ok(g.monsters.length === 0 && C.LEVEL_FIRST === undefined && C.LEVEL_STEP === undefined, '舊的升級公式設定拿掉了');
  }

  // 9. 擴充武器第一批：骰子、特質
  {
    const g = arena('warrior', 9104);
    const p = g.player;
    p.attr = { str: 14, dex: 14, con: 10, int: 10, wis: 10, cha: 10 }; // 力量、敏捷 +2
    p.size = 95000; // 什麼都能單手拿
    const prof = (t, mode, off) => Ch.profile(p, gear(t), mode || 'melee', off);
    ok(prof('waraxe').die.join() === '1,10' && prof('waraxe').type === 'slash' && prof('waraxe').dmg === 2, '戰斧 1d8 揮砍，副手空著 1d10，加力量');
    p.equip.off = gear('shield');
    ok(prof('waraxe').die.join() === '1,8', '戰斧拿著盾牌 1d8');
    p.equip.off = null;
    ok(prof('warhammer').die.join() === '1,10' && prof('warhammer').type === 'blunt' && prof('club').die.join() === '1,6' && prof('club').type === 'blunt', '戰錘 1d8（雙手 1d10）鈍擊，硬頭錘 1d6 鈍擊');
    ok(prof('shortsword').die.join() === '1,6' && prof('shortsword').type === 'pierce' && prof('greataxe').die.join() === '1,12' && prof('greatsword').die.join() === '2,6', '短劍 1d6 穿刺、巨斧 1d12、巨劍 2d6');
    ok(prof('whip').die.join() === '1,4' && prof('whip').type === 'slash', '鞭子 1d4 揮砍');
    ok(prof('crossbow', 'shoot').die.join() === '1,8' && prof('crossbow', 'shoot').type === 'pierce' && prof('crossbow', 'shoot').dmg === 2, '輕弩 1d8 穿刺，射擊加敏捷');
    ok(prof('crossbow', 'melee').die.join() === '1,4' && prof('crossbow', 'melee').type === 'blunt' && prof('crossbow', 'melee').skills.join() === 'mace,fight' && prof('bow', 'melee').skills.join() === 'sword,fight', '拿弩近戰 1d4 鈍擊算錘術，拿弓近戰算劍術');
    // 靈巧：短劍、鞭子取力量與敏捷較高者；重型：巨斧、巨劍近戰力量不到 13 有劣勢
    p.attr.str = 8; p.attr.dex = 16;
    ok(prof('shortsword').dmg === 3 && prof('shortsword').hit === 3 && prof('whip').dmg === 3 && prof('waraxe').dmg === -1, '短劍、鞭子靈巧取較高的修正值');
    ok(prof('greatsword').heavy && prof('greataxe').heavy && !prof('waraxe').heavy, '力量 8：巨劍、巨斧有劣勢');
    p.attr.str = 13;
    ok(!prof('greatsword').heavy && !prof('greataxe').heavy, '力量 13：巨劍、巨斧沒有劣勢');
    ok(FE.GEAR.shortsword.light && !FE.GEAR.whip.light && Ch.attackTicks(p, gear('shortsword')) === 6 && Ch.attackTicks(p, gear('whip')) === 7 && Ch.attackTicks(p, gear('greataxe')) === 9, '短劍輕型（8 刻減敏捷，最少 6）；鞭子一般（10 刻減敏捷＝7）；巨斧重型（12 刻減敏捷＝9）');
    // 特質標籤
    ok(G.statText(gear('crossbow')).includes('裝填') && G.statText(gear('crossbow')).includes('雙手') && G.statText(gear('crossbow')).includes('弩矢') && G.statText(gear('whip')).includes('觸及') && G.statText(gear('waraxe')).includes('可雙手'), `輕弩寫了裝填、雙手、弩矢：${G.statText(gear('crossbow'))}`);
    ok(FE.MASTERIES.cleave.name === '順劈' && FE.MASTERIES.graze.name === '擦掠' && FE.MASTERIES.slow.name === '緩速', '新精通的名字');
    ok(FE.GEAR.shortsword.mastery === 'vex' && FE.GEAR.waraxe.mastery === 'topple' && FE.GEAR.greataxe.mastery === 'cleave' && FE.GEAR.greatsword.mastery === 'graze' && FE.GEAR.club.mastery === 'sap' && FE.GEAR.warhammer.mastery === 'push' && FE.GEAR.whip.mastery === 'slow' && FE.GEAR.crossbow.mastery === 'slow', '新武器的精通：侵擾、失衡、順劈、擦掠、削弱、推擊、緩速、緩速');
    // 鞭子觸及
    p.equip.main = gear('whip');
    const m = mon(g, p.x + 2, p.y);
    ok(g.reachTarget() === m, '鞭子打得到直線 2 格外');
  }

  // 10. 順劈（巨斧）：命中後順手打目標旁邊、也貼著冒險者的另一隻怪物，這一下不加屬性修正值，一個動作最多一次
  {
    const g = arena('warrior', 9105);
    const p = g.player;
    p.attr.str = 16; // +3
    p.size = 95000;
    p.equip.main = gear('greataxe');
    p.equip.main.dur = p.equip.main.max = 1e9;
    let pairs = 0;
    let singles = 0;
    let bad = 0;
    const first = [];
    const second = [];
    for (let i = 0; i < 500; i++) {
      p.hp = p.maxHp = 1e6;
      p.skills = Ch.freshSkills();
      g.monsters = [];
      const m1 = mon(g, p.x + 1, p.y);
      const m2 = mon(g, p.x, p.y + 1);
      const m3 = mon(g, p.x + 5, p.y);
      const m4 = mon(g, p.x - 1, p.y); // 貼著冒險者，但離第一隻有 2 格
      g.battle.targetId = null;
      const ev = events(() => g.strike('attack', m1)).filter((e) => e.by === 'player');
      const clean = (e) => (e.key === 'hit' || e.key === 'hard') && !e.dodged && !e.blocked && !e.resisted;
      const hit = ev[0] && (ev[0].key === 'hit' || ev[0].key === 'hard' || ev[0].key === 'crit');
      if (!hit) {
        singles++;
        if (ev.length !== 1) bad++;
      } else if (ev.length !== 2 || ev[1].d !== m2 || ev[0].d !== m1) bad++;
      else {
        pairs++;
        if (clean(ev[1])) second.push(ev[1].dmg);
      }
      if (ev[0] && clean(ev[0])) first.push(ev[0].dmg);
      // 一個動作最多一次、不打第三隻、不打離第一隻太遠的；順劈不另外練技能（智力 10 倍率 ×1：這個動作只有 5 或 10 點）
      if (m3.hp !== 1e9 || m4.hp !== 1e9) bad++;
      const gain = uses(p, 'axe');
      if (gain !== 10 && gain !== 5) bad++;
    }
    ok(pairs > 100 && singles > 20 && bad === 0, `順劈：命中後順手打到旁邊 ${pairs} 次、沒命中 ${singles} 次、不對 ${bad}`);
    ok(second.length > 50 && Math.min(...second) >= 1 && Math.max(...second) <= 12 && (second.some((d) => d <= 3)), `順劈那一下不加力量修正值：1d12 ＝ ${spread(second)}`);
    ok(first.length > 50 && Math.min(...first) >= 4 && Math.max(...first) <= 15, `第一下 1d12＋3 ＝ ${spread(first)}`);
    // 沒有精通（法師、斧術不到 5 級）：不順劈
    const gm = arena('mage', 9106);
    const pm = gm.player;
    pm.attr.str = 16;
    pm.size = 95000;
    pm.equip.main = gear('greataxe');
    pm.equip.main.dur = pm.equip.main.max = 1e9;
    const ms0 = FE.MASTERY_SKILL;
    FE.MASTERY_SKILL = 5; // 精通一律要技能 5 級（舊測試預設是 0）
    let cleaved = 0;
    for (let i = 0; i < 100; i++) {
      pm.hp = pm.maxHp = 1e6;
      pm.skills = Ch.freshSkills();
      gm.monsters = [];
      const a = mon(gm, pm.x + 1, pm.y);
      mon(gm, pm.x, pm.y + 1);
      if (events(() => gm.strike('attack', a)).filter((e) => e.by === 'player').length > 1) cleaved++;
    }
    ok(cleaved === 0, `法師斧術不到 5 級不會順劈（${cleaved} 次）`);
    pm.skills.axe = { lv: 5, n: 0 };
    let cleaved2 = 0;
    for (let i = 0; i < 100; i++) {
      pm.hp = pm.maxHp = 1e6;
      gm.monsters = [];
      const a = mon(gm, pm.x + 1, pm.y);
      mon(gm, pm.x, pm.y + 1);
      if (events(() => gm.strike('attack', a)).filter((e) => e.by === 'player').length > 1) cleaved2++;
    }
    ok(cleaved2 > 20, `斧術 5 級起法師也會順劈（${cleaved2} 次）`);
    FE.MASTERY_SKILL = ms0;
    // 長劍沒有順劈
    p.equip.main = gear('sword');
    p.equip.main.dur = 1e9;
    let n2 = 0;
    for (let i = 0; i < 100; i++) { p.hp = p.maxHp = 1e6; g.monsters = []; const a = mon(g, p.x + 1, p.y); mon(g, p.x, p.y + 1); if (events(() => g.strike('attack', a)).filter((e) => e.by === 'player').length > 1) n2++; }
    ok(n2 === 0, '長劍不會順劈');
  }

  // 11. 擦掠（巨劍）：沒命中時照樣造成等於屬性修正值的傷害（修正值是正數才有）
  {
    const g = arena('warrior', 9107);
    const p = g.player;
    p.size = 95000;
    p.equip.main = gear('greatsword');
    p.equip.main.dur = p.equip.main.max = 1e9;
    const run = (str, opts) => {
      p.attr.str = str;
      const m = mon(g, p.x + 1, p.y);
      g.monsters = [m];
      return events(() => { for (let i = 0; i < 400; i++) { m.hp = 1e9; p.hp = p.maxHp = 1e6; p.skills = Ch.freshSkills(); FE.Combat.resolveAttack(g, p, m, 'attack', Object.assign({ noCounter: true }, opts || {})); } });
    };
    const miss = (ev) => ev.filter((e) => e.by === 'player' && e.key === 'miss');
    let ev = run(16);
    ok(miss(ev).length > 20 && miss(ev).every((e) => e.dmg === 3 && e.grazed), `力量 16（+3）沒命中也擦傷 3 點：${spread(miss(ev).map((e) => e.dmg))}`);
    ok(ev.filter((e) => e.key === 'fumble').every((e) => !e.grazed), '失手（擲出 1）不是擦掠');
    ev = run(10);
    ok(miss(ev).length > 20 && miss(ev).every((e) => e.dmg === 0 && !e.grazed), '修正值 0 沒有擦傷');
    ev = run(8);
    ok(miss(ev).every((e) => e.dmg === 0), '修正值是負數沒有擦傷，也不倒扣');
    // 擦傷的訊息、可以打倒怪物
    p.attr.str = 16;
    const m = mon(g, p.x + 1, p.y);
    g.monsters = [m];
    m.hp = 2;
    let killed = false;
    for (let i = 0; i < 600 && !killed; i++) {
      m.hp = 2;
      g.monsters = [m];
      p.skills = Ch.freshSkills();
      const ev2 = events(() => FE.Combat.resolveAttack(g, p, m, 'attack', { noCounter: true }));
      if (ev2[0].key === 'miss' && ev2[0].killed) killed = true;
    }
    ok(killed && g.log.some((l) => /沒有打中，但擦傷了牠/.test(l.text)), '擦傷也能打倒怪物，訊息有寫');
    // 副手那一下不加屬性修正值，所以沒有擦傷
    ev = run(16, { off: true });
    ok(miss(ev).length > 20 && miss(ev).every((e) => e.dmg === 0), '副手那一下沒有擦傷');
    // 其他武器沒有擦掠
    p.equip.main = gear('sword');
    p.equip.main.dur = 1e9;
    ev = run(16);
    ok(miss(ev).every((e) => e.dmg === 0), '長劍沒有擦掠');
  }

  // 12. 緩速（鞭子、輕弩）：命中且造成傷害後，目標下一次移動多花 10 刻
  {
    const g = arena('warrior', 9108);
    const p = g.player;
    p.size = 95000;
    p.attr.str = 16;
    p.equip.main = gear('whip');
    p.equip.main.dur = p.equip.main.max = 1e9;
    let done = false;
    for (let i = 0; i < 200 && !done; i++) {
      g.monsters = [];
      p.hp = p.maxHp = 1e6;
      const m = mon(g, p.x + 2, p.y);
      m.atk = 1;
      g.worldEvery = 1e9;
      g.battle.targetId = m.id;
      g.act('attack'); // 鞭子觸及：打直線 2 格外的目標
      if (m.slowed > 0) {
        done = true;
        ok(m.hp < 1e9 && m.x === p.x + 2, '緩速：命中造成傷害後目標被緩速');
        FE.AI.worldTurn(g); // 目標纏上冒險者，要往前走，但這一回合被緩速，停在原地
        ok(m.x === p.x + 2 && !(m.slowed > 0), `被緩速的這一回合不移動：x ${m.x - p.x}`);
        FE.AI.worldTurn(g);
        ok(m.x === p.x + 1, `下一回合照常往前走：x ${m.x - p.x}`);
        ok(g.log.some((l) => /腳步慢了下來/.test(l.text)), '訊息有寫腳步慢了下來');
      }
    }
    ok(done, '鞭子打了 200 次都沒有緩速');
    // 沒有命中、或不是緩速精通的武器不會緩速
    p.equip.main = gear('sword');
    p.equip.main.dur = 1e9;
    let slowed = 0;
    const m2 = mon(g, p.x + 1, p.y);
    g.monsters = [m2];
    for (let i = 0; i < 100; i++) { m2.hp = 1e9; p.hp = p.maxHp = 1e6; FE.Combat.resolveAttack(g, p, m2, 'attack', { noCounter: true }); if (m2.slowed > 0) slowed++; }
    ok(slowed === 0, '長劍不會緩速');
  }

  // 13. 輕弩與弩矢：射擊用弩矢（不是箭矢），一個動作只射一次；弩矢分品質、回收一半、一捆 20 支 1.5 磅
  {
    const g = arena('ranger', 9109);
    const p = g.player;
    p.size = 70000;
    p.equip.main = gear('crossbow');
    p.equip.main.dur = p.equip.main.max = 1e9;
    p.bag = [];
    ok(g.rangedMode(true) === null && /弩矢/.test((g.rangedMode(), g.log[0].text)), `沒有弩矢不能射：${g.log[0].text}`);
    g.bagAdd('arrow', 20);
    ok(g.rangedMode(true) === null, '只有箭矢，輕弩不能射');
    g.bagAdd('bolt', 20, { q: 0 });
    g.bagAdd('bolt', 5, { q: 2 });
    const r = g.rangedMode(true);
    ok(r && r.mode === 'shoot' && r.range.join() === '5,20', `輕弩射程 5／20：${r && r.range}`);
    ok(g.bagCount('bolt') === 25 && p.bag.filter((e) => e.id === 'bolt').length === 2 && g.takeArrow('bolt') === 2 && g.bagCount('arrow') === 20 && g.bagCount('bolt') === 24, '弩矢分品質疊放，先用品質高的，不動箭矢');
    ok(near(G.weightOf(p), 5 + 1 * (20 / 20) + 1.5 * (24 / 20)), `重量：輕弩 5＋箭矢一捆 1＋弩矢 ${24 / 20} 捆×1.5＝${G.weightOf(p)}`);
    // 一個動作射一次：用掉 1 支弩矢、1 次判定、1 個動作
    const m = mon(g, p.x + 4, p.y);
    p.attr.dex = 14;
    const n0 = g.bagCount('bolt');
    const t0 = g.turn;
    const ev = events(() => g.fireAt(m)).filter((e) => e.by === 'player');
    ok(ev.length === 1 && ev[0].mode === 'shoot' && g.bagCount('bolt') === n0 - 1 && g.turn === t0 + 1 && g.bagCount('arrow') === 20, `輕弩一個動作射一次：判定 ${ev.length}、弩矢 ${n0} → ${g.bagCount('bolt')}`);
    ok(m.bolts && Object.values(m.bolts).reduce((s, n) => s + n, 0) === 1 && !m.arrows, '射出去的弩矢記在怪物身上（m.bolts）');
    // 打倒時撿回一半（捨去）
    for (let i = 0; i < 5; i++) { g.monsters = [m]; m.hp = 1e9; g.fireAt(m); }
    const before = g.bagCount('bolt');
    const spent = Object.values(m.bolts).reduce((s, n) => s + n, 0);
    g.recoverArrows(m);
    ok(g.bagCount('bolt') === before + Math.floor(spent / 2) && !m.bolts && g.log.some((l) => /撿回了 \d+ 支弩矢/.test(l.text)), `撿回一半弩矢：射出 ${spent}，撿回 ${g.bagCount('bolt') - before}`);
    // 弓箭還是用箭矢，有弩矢沒箭矢不能射
    p.equip.main = gear('bow');
    p.bag = [];
    g.bagAdd('bolt', 10);
    ok(g.rangedMode(true) === null, '弓箭不能用弩矢');
    // 拿弩近戰：1d4 鈍擊
    p.equip.main = gear('crossbow');
    const mm = mon(g, p.x + 1, p.y);
    g.monsters = [mm];
    const ev2 = events(() => { for (let i = 0; i < 200; i++) { mm.hp = 1e9; p.hp = p.maxHp = 1e6; FE.Combat.resolveAttack(g, p, mm, 'attack', { noCounter: true }); } });
    ok(ev2.every((e) => e.dmgType === 'blunt' && e.mastery === null), '拿弩近戰是鈍擊、沒有精通');
  }

  // 14. 商店：村莊鐵匠賣箭矢不賣弩矢和輕弩；城鎮武器匠賣弩矢；弩矢一捆 5 金幣
  {
    const g = new FE.Game(9110);
    g.start({ cls: 'ranger', picks: ['bow'] });
    g.checkCreate = () => {};
    for (let i = 0; i < 14 && !g.world.villages.some((v) => v.kind === 'town'); i++) g.createChunk(false);
    g.monsters = [];
    const w = g.world;
    const town = w.villages.find((v) => v.kind === 'town');
    const wsmith = w.npcs.find((n) => n.villageId === town.id && n.role === 'smith');
    const smith = w.npcs.find((n) => n.role === 'smith' && w.villageById(n.villageId).kind === 'village');
    const p = g.player;
    p.copper = 1000;
    const pr = G.shopPrice('bolt', 0, town, g.chaMod());
    ok(pr === Math.round(50 * FE.Steading.shopFactor(town) * G.buyFactor(g.chaMod())), `弩矢一捆的價錢 ${pr} 銅`);
    ok(shopDo(g, wsmith, 'buyItem:bolt:0') && g.bagCount('bolt') === 20 && p.copper === 1000 - pr && g.log.some((l) => /一捆 20 支的弩矢/.test(l.text)), '武器匠賣弩矢，買了疊進背包');
    ok(shopDo(g, wsmith, 'buyItem:bolt:1') && p.bag.filter((e) => e.id === 'bolt').length === 2 && g.bagCount('bolt') === 40, '做工好的弩矢另外疊放');
    ok(!shopDo(g, smith, 'buyItem:bolt:0') && !shopDo(g, smith, 'buyItem:crossbow:0') && shopDo(g, wsmith, 'buyItem:crossbow:0'), '村莊鐵匠不賣弩矢和輕弩，城鎮武器匠賣');
    ok(!shopDo(g, wsmith, 'craftItem:crossbow') && !shopDo(g, wsmith, 'craftItem:whip') && shopDo(g, smith, 'buyItem:waraxe:0') === true, '輕弩、鞭子不能打造；村莊鐵匠賣戰斧');
  }

  // 15. 負重：重量改磅數、能背＝力量值×15、推拖上限＝力量值×30
  {
    const g = mkg(11, 'warrior');
    const p = g.player;
    // 戰士起始：中甲 45＋長劍 3＋盾牌 6（預設挑法長劍、盾牌、2 份藥草 1）
    p.bag = [];
    p.equip = { main: gear('sword'), off: gear('shield'), body: gear('medium') };
    ok(near(G.weightOf(p), 3 + 6 + 45), `戰士裝備 長劍 3＋盾牌 6＋中甲 45＝${G.weightOf(p)}`);
    g.bagAdd('herb', 2);
    g.bagAdd('ore', 3);
    g.bagAdd('goods', 1, { name: '舊地圖', giverId: 1 });
    g.bagAddGear(gear('spear'));
    g.bagAddGear(gear('pick'));
    g.bagAddGear(gear('sickle'));
    g.bagAddGear(gear('heavy'));
    g.bagAddGear(gear('robe'));
    ok(near(G.weightOf(p), 54 + 2 * 0.5 + 3 * 10 + 5 + 18 + 10 + 2 + 50 + 4), `藥草 0.5、礦石 10、送貨 5、長槍 18、礦鎬 10、鐮刀 2、鎖子甲 50、衣袍 4：${G.weightOf(p)}`);
    p.attr.str = 16;
    ok(g.carryLimit() === 240 && g.pushLimit() === 480 && Ch.carryLimit({ attr: { str: 9 } }) === 135, '力量 16 能背 240、推拖 480；力量 9 能背 135（看力量值不看修正值）');
    // 超過推拖上限不能移動但能丟東西、能出手
    p.bag = [];
    g.bagAdd('ore', 49);
    ok(g.loadTier() === 2, `重量 ${g.weight()} 超過推拖上限 480`);
  }

  // 16. 等級 L 角色（測試用的輔助函式）
  {
    const g = makeLevelChar('warrior', 10, 4, 9120);
    const p = g.player;
    const c = FE.CLASSES.warrior;
    const start = Object.values(c.attr).reduce((s, v) => s + v, 0) + 2; // 矮人體質 +2
    ok(g.level === 10 && g.exp === FE.levelExp(10) && p.points === 0 && Object.values(p.attr).reduce((s, v) => s + v, 0) === start + 2, `10 級角色：屬性總和 ${Object.values(p.attr).reduce((s, v) => s + v, 0)}（應該 ${start + 2}，4、8 級各 1 點）`);
    ok(p.attr.str === 17 && p.attr.con === 18 && p.maxHp === Ch.maxHp(p, 10) && p.hp === p.maxHp, `主屬性力量加到 18：${p.attr.str}，生命 ${p.hp}/${p.maxHp}`);
    ok(p.equip.main.q === qualityForWL(4) && p.equip.body.q === 2 && p.equip.off.q === 2 && qualityForWL(1) === 0 && qualityForWL(6) === 3, `世界等級 4 的裝備品質 ${p.equip.main.q}`);
    // 10 級累計經驗 6,400：劍術 ×2.5＝16,000 → 13 級、格鬥 ×3＝19,200 → 15 級、穿甲（中甲）13 級、閃避 ×0.5＝3,200 → 4 級、盾牌使用 ×0.6＝3,840 → 5 級
    ok(p.skills.sword.lv === 13 && p.skills.fight.lv === 15 && p.skills.medium.lv === 13 && p.skills.light.lv === 0 && p.skills.heavy.lv === 0 && p.skills.dodge.lv === 4 && p.skills.shield.lv === 5 && p.skills.bow.lv === 0, `技能：劍術 ${p.skills.sword.lv}、格鬥 ${p.skills.fight.lv}、中甲 ${p.skills.medium.lv}、閃避 ${p.skills.dodge.lv}、盾牌使用 ${p.skills.shield.lv}`);
    ok(skillLevelFor(0) === 0 && skillLevelFor(499) === 0 && skillLevelFor(500) === 1 && skillLevelFor(1100) === 2 && skillLevelFor(18000) === 15, '經驗換技能等級');
    useClasses('new'); // 新遊俠的主手是弓；起始技能是隨機抽的，只看弓術、射擊（換算來的）與不在遊俠技能名單裡的項目
    const gr = makeLevelChar('ranger', 5, 1, 9123).player;
    useClasses('legacy');
    ok(gr.equip.main.type === 'bow' && gr.skills.bow.lv === skillLevelFor(650 * 2.5) && gr.skills.shoot.lv === skillLevelFor(650 * 3) && gr.skills.medium.lv === 0 && gr.skills.heavy.lv === 0 && gr.skills.shield.lv === 0, `遊俠 5 級（主手 ${gr.equip.main && gr.equip.main.type}）：弓術 ${gr.skills.bow.lv}、射擊 ${gr.skills.shoot.lv}，沒穿中重甲、沒拿盾牌`);
    const g1 = makeLevelChar('mage', 1, 1, 9121);
    ok(g1.level === 1 && g1.player.points === 0 && g1.player.skills.staff.lv === 0 && g1.player.equip.main.q === 0, '1 級角色就是剛開局的樣子');
    // 競技場：打一場一定打得完
    const A = arenaGame('warrior', 1, 1, 9122);
    const n = arenaFight(A, 'small', 1, 0);
    ok(n >= 1 && n < 60 && A.monsters.length === 0, `競技場打倒小怪物用 ${n} 下`);
  }

  // 16b. 撤離（按 6）與閃避（按 7）：各花一個動作；撤離管到下一個動作之前走開不被趁機攻擊、纏上的目標不趁隙出手；閃避管到下一個動作之前打你的攻擊都有劣勢
  {
    const g = arena('warrior', 9130);
    const p = g.player;
    p.equip.main = gear('sword');
    const step = (disengage) => {
      g.monsters = [];
      p.x = g.world.spawn ? p.x : p.x;
      const m = mon(g, p.x + 1, p.y);
      const o = mon(g, p.x, p.y + 1); // 貼著、但不是目標的另一隻（趁機攻擊的對象）
      m.atk = o.atk = 3;
      g.battle.targetId = m.id;
      if (disengage) g.disengage();
      const t = g.turn;
      const ev = events(() => { for (let i = 0; i < 1; i++) g.move(-1, 0); });
      return { ev, m, o, turn: t };
    };
    const t0 = g.turn;
    g.disengage();
    ok(g.turn === t0 + 1 && g.battle.disengage === true && g.ticks > 0, '撤離花一個動作');
    g.rest();
    ok(!g.battle.disengage, '下一個動作之後撤離就結束了');
    // 沒撤離：走開時纏上的目標一定趁隙出手（cling），另一隻貼著的有機率趁機攻擊
    let cling = 0;
    let opp = 0;
    for (let i = 0; i < 60; i++) { p.x = p.x > 0 ? p.x : p.x; const r = step(false); cling += r.ev.filter((e) => e.cling).length; opp += r.ev.filter((e) => e.opportunity).length; g.player.hp = g.player.maxHp = 1e6; p.x += 1; }
    ok(cling > 30 && opp > 5, `沒撤離：趁隙 ${cling} 次、趁機攻擊 ${opp} 次`);
    // 撤離之後走開：兩種都沒有
    let cling2 = 0;
    let opp2 = 0;
    let moved = 0;
    for (let i = 0; i < 60; i++) { const x0 = p.x; const r = step(true); cling2 += r.ev.filter((e) => e.cling || e.opportunity).length; if (p.x === x0 - 1) moved++; p.x += 1; p.hp = p.maxHp = 1e6; }
    ok(cling2 === 0 && moved === 60, `撤離之後走開：被攻擊 ${cling2} 次、走開 ${moved}/60`);
    // 撤離只管到下一個動作之前：走一步之後再走開（又貼上另一隻）就沒保護了
    g.monsters = [];
    const m1 = mon(g, p.x + 1, p.y);
    g.battle.targetId = m1.id;
    g.disengage();
    g.move(-1, 0);
    ok(!g.battle.disengage && !g.prevStance.dod, '走開之後撤離就結束了');
    // 撤離的纏上照舊：牠還是會跟上來
    FE.AI.worldTurn(g);
    ok(Math.abs(m1.x - p.x) + Math.abs(m1.y - p.y) === 1 || Math.abs(m1.x - p.x) + Math.abs(m1.y - p.y) === 2, '纏上的目標還是會跟上來');
    // 閃避：所有打你的攻擊都有劣勢（擲兩次取低）
    g.monsters = [];
    const mm = mon(g, p.x + 1, p.y);
    mm.atk = 2;
    const adv = (n) => events(() => { for (let i = 0; i < n; i++) { p.hp = p.maxHp = 1e6; FE.Combat.resolveAttack(g, mm, p, 'attack', { noCounter: true }); } }).filter((e) => e.by === 'monster');
    ok(adv(50).every((e) => e.adv === 0), '平常怪物出手沒有優劣勢');
    const t1 = g.turn;
    g.dodgeStance();
    ok(g.turn === t1 + 1 && g.battle.dodge === true, '閃避花一個動作');
    const e1 = adv(80);
    ok(e1.every((e) => e.adv === -1 && e.dice.length === 2), '閃避：打你的攻擊都擲兩次取低（劣勢）');
    // 你自己出手不受影響
    const mine = events(() => { for (let i = 0; i < 20; i++) { mm.hp = 1e9; FE.Combat.resolveAttack(g, p, mm, 'attack', { noCounter: true }); } }).filter((e) => e.by === 'player');
    ok(mine.every((e) => e.adv === 0), '閃避不影響你自己出手');
    g.move(-1, 0);
    mm.x = p.x + 1;
    mm.y = p.y;
    ok(!g.battle.dodge && adv(30).every((e) => e.adv === 0), '下一個動作之後閃避就結束了');
    // 快捷鍵：act('disengage')／act('dodge')
    const t2 = g.turn;
    g.act('disengage');
    g.act('dodge');
    ok(g.turn === t2 + 2 && g.battle.dodge && !g.battle.disengage, '按 6、7 就是這兩個動作');
    // 存檔不會把狀態弄壞
    FE.Save.save(g);
    ok(!!FE.Save.load().game, '有撤離、閃避狀態時存檔讀得回來');
  }

  // 17. 存檔：種族、身高、體格、體型與技能經驗（小數）都存得回來
  {
    const g = mkg(12, 'priest', undefined, body('dwarf', 6, 2));
    const p = g.player;
    p.skills.sword = { lv: 3, n: 123.45 };
    FE.Save.save(g);
    const back = FE.Save.load();
    const q = back && back.game && back.game.player;
    ok(!!q && q.race === 'dwarf' && q.height === 6 && q.build === 2 && q.size === FE.bodySize('dwarf', 6, 2) && q.skills.sword.lv === 3 && q.skills.sword.n === 123.45 && q.attr.con === p.attr.con, '存檔讀回來，種族與體型、技能經驗都在');
  }

  // 18. 第二十九版再追加：身高與體格的機率、起始技能（精熟＋專精／全面）、技能合併與穿甲拆分
  {
    useClasses('new');
    // 身高、體格的機率：每項加起來 100；大量抽樣跟表差不到 1.5 個百分點；體型公式不變
    const odds = FE.BODY_ODDS;
    ok(Object.keys(odds).join() === 'human,dwarf,elf' && Object.values(odds).every((o) => o.height.length === 7 && o.build.length === 7 && o.height.reduce((s, x) => s + x, 0) === 100 && o.build.reduce((s, x) => s + x, 0) === 100), '三個種族的身高、體格機率各 7 項、加起來 100');
    ok(odds.human.height.join() === '8,13,19,22,18,12,8' && odds.human.build.join() === '9,14,20,21,17,12,7' && odds.dwarf.height.join() === '24,27,20,13,9,5,2' && odds.dwarf.build.join() === '3,6,11,17,23,24,16' && odds.elf.height.join() === '2,6,12,18,25,22,15' && odds.elf.build.join() === '21,28,22,14,8,5,2', '各種族的機率表');
    const rng = FE.makeRng(2026);
    for (const race of Object.keys(odds)) {
      const N = 40000;
      const cnt = { height: Array(8).fill(0), build: Array(8).fill(0) };
      for (let i = 0; i < N; i++) { const b = Ch.rollBody(race, rng); cnt.height[b.height]++; cnt.build[b.build]++; }
      const dev = (k) => Math.max(...odds[race][k].map((pct, i) => Math.abs(cnt[k][i + 1] / N * 100 - pct)));
      ok(dev('height') < 1.5 && dev('build') < 1.5 && cnt.height[0] === 0 && cnt.build[0] === 0, `${race} 身高偏差 ${dev('height').toFixed(2)}、體格偏差 ${dev('build').toFixed(2)}（百分點）`);
    }
    ok(FE.rollOdds(() => 0, [8, 13, 19]) === 1 && FE.rollOdds(() => 0.999999, [8, 13, 19]) === 3 && FE.rollOdds(() => 0.2, [8, 13, 19]) === 2, 'rollOdds 照機率切段');
    ok(FE.bodySize('human', 4, 4) === 70000 && FE.bodySize('dwarf', 4, 4) === 60000 && near(FE.bodySize('human', 7, 1), 70000 * 1.15 * 0.85, 1e-6), '體型公式不變');

    // 技能合併與拆分
    ok(Object.keys(FE.SKILLS).join() === 'sword,spear,knife,staff,axe,mace,whip,bow,crossbow,misc,fight,shoot,dodge,light,medium,heavy,shield', '技能名單：槍術、錘術合併，穿甲拆成輕甲、中甲、重甲');
    ok(FE.GEAR.spear.skill === 'spear' && FE.GEAR.shortspear.skill === 'spear' && FE.GEAR.club.skill === 'mace' && FE.GEAR.warhammer.skill === 'mace' && FE.GEAR.crossbow.meleeSkill === 'mace', '短矛、長槍都算槍術；硬頭錘、戰錘、拿弩近戰都算錘術');
    ok(FE.ARMOR_SKILL.light === 'light' && FE.ARMOR_SKILL.medium === 'medium' && FE.ARMOR_SKILL.heavy === 'heavy', '防具類別對應輕甲、中甲、重甲');
    // 傷害骰從武器來，技能只給加值
    {
      const p = mkg(450, 'warrior', ['sword', 'herb', 'gold']).player;
      const d0 = Ch.profile(p, gear('sword'), 'melee').die.join();
      p.skills.sword.lv = 15;
      ok(Ch.profile(p, gear('sword'), 'melee').die.join() === d0 && d0 === '1,10', '劍術等級不改傷害骰（副手空著的長劍 1d10）');
    }

    // 職業的技能池
    const pools = {
      warrior: 'fight,medium,heavy,shield,dodge,sword,spear,knife,staff,axe,mace,whip',
      ranger: 'shoot,dodge,fight,knife,sword,light',
      mage: 'dodge,shoot,knife,fight',
      priest: 'shield,medium,fight,dodge',
      paladin: 'shield,medium,heavy,fight,sword,spear,knife,staff,axe,mace,whip',
      barbarian: 'fight,dodge,light,shoot,sword,spear,knife,staff,axe,mace,whip',
    };
    const poolOf = (cls) => [...new Set(FE.CLASSES[cls].pool.flatMap((t) => (t === 'melee' ? FE.MELEE_SKILLS : [t])))].sort().join();
    for (const [cls, s] of Object.entries(pools)) ok(poolOf(cls) === s.split(',').sort().join(), `${cls} 的技能池 ${poolOf(cls)}`);

    // 起始技能：精熟（5）的是起始主手武器那一項；專精＝熟練（4）×2＋稱職（3）×3、全面＝稱職×6；池子不夠有幾項給幾項
    ok(FE.SKILL_PACKS.focus.name === '專精' && FE.SKILL_PACKS.focus.levels.join() === '4,4,3,3,3' && FE.SKILL_PACKS.broad.name === '全面' && FE.SKILL_PACKS.broad.levels.join() === '3,3,3,3,3,3' && FE.START_MAIN_LEVEL === 5, '起始技能組合的資料');
    const mains = { warrior: ['sword', 'herb', 'gold'], ranger: ['dagger'], mage: ['herb'], priest: ['shield', 'herb'], paladin: ['warhammer', 'herb'], barbarian: ['greataxe', 'herb'] };
    const wantMain = { warrior: 'sword', ranger: 'bow', mage: 'staff', priest: 'mace', paladin: 'mace', barbarian: 'axe' };
    for (const cls of Object.keys(pools)) {
      const main = Ch.startMainSkill(cls, mains[cls]);
      ok(main === wantMain[cls], `${cls} 的起始主手武器技能 ${main}（應該 ${wantMain[cls]}）`);
      const pool = poolOf(cls).split(',');
      let bad = 0;
      const seen = new Set();
      for (let i = 0; i < 300; i++) {
        for (const key of ['focus', 'broad', undefined]) {
          const r = Ch.rollSkills(cls, main, rng, key);
          const lv = r.levels;
          const drawn = Object.keys(lv).filter((k) => k !== main);
          const pack = FE.SKILL_PACKS[r.pack];
          const want = pack.levels.slice(0, Math.min(pack.levels.length, pool.filter((k) => k !== main).length)).slice().sort().join();
          if (lv[main] !== 5 || drawn.some((k) => !pool.includes(k)) || new Set(drawn).size !== drawn.length || drawn.map((k) => lv[k]).sort().join() !== want || (key && r.pack !== key) || r.name !== pack.name) bad++;
          for (const k of drawn) seen.add(k);
        }
      }
      ok(bad === 0, `${cls} 起始技能不對 ${bad} 次`);
      ok(pool.filter((k) => k !== main).every((k) => seen.has(k)), `${cls} 池裡每一項都有機會抽到`);
    }
    {
      // 池子夠大（遊俠 6、戰士不含主手 11）：專精抽 5 項、全面抽 6 項；池子小（法師 4、牧師 4）：有幾項給幾項
      const lens = (cls, key) => Object.keys(Ch.rollSkills(cls, Ch.startMainSkill(cls, mains[cls]), rng, key).levels).length;
      ok(lens('ranger', 'focus') === 1 + 5 && lens('ranger', 'broad') === 1 + 6 && lens('warrior', 'focus') === 1 + 5 && lens('warrior', 'broad') === 1 + 6, '池子夠大，專精 5 項、全面 6 項（外加精熟那項）');
      ok(lens('mage', 'focus') === 1 + 4 && lens('mage', 'broad') === 1 + 4 && lens('priest', 'focus') === 1 + 4 && lens('priest', 'broad') === 1 + 4, '池子只有 4 項，就給 4 項');
      // 專精：熟練給前兩項抽到的、稱職給後面的；法師池子 4 項時專精是熟練 2、稱職 2
      const mr = Ch.rollSkills('mage', 'staff', rng, 'focus').levels;
      ok(Object.values(mr).sort().join() === '3,3,4,4,5', `法師專精：${JSON.stringify(mr)}`);
      // 兩種組合各約一半
      let focus = 0;
      for (let i = 0; i < 2000; i++) if (Ch.rollSkills('warrior', 'sword', rng).pack === 'focus') focus++;
      ok(focus > 900 && focus < 1100, `專精／全面各約 50%：專精 ${focus} / 2000`);
      // 戰士起始主手是長劍時，抽到的武器技能不會再出現劍術 5 級以外的值
      const wr = Ch.rollSkills('warrior', 'sword', rng, 'broad').levels;
      ok(wr.sword === 5, '精熟那項不被池子的抽樣蓋掉');
    }
    // 起始技能放進角色：技能等級照抽的結果、其餘涉獵（0 級）、記著組合名稱、存檔讀得回來
    {
      const sk = Ch.rollSkills('ranger', 'bow', FE.makeRng(77), 'focus');
      const g = new FE.Game(451);
      g.start({ cls: 'ranger', picks: ['dagger'], skills: sk });
      const p = g.player;
      ok(Object.keys(FE.SKILLS).every((k) => p.skills[k].lv === (sk.levels[k] || 0) && p.skills[k].n === 0) && p.skillPack === '專精', `起始技能放進角色：${Object.keys(FE.SKILLS).map((k) => k + p.skills[k].lv)}`);
      FE.Save.save(g);
      const back = FE.Save.load();
      ok(back && back.game && back.game.player.skillPack === '專精' && back.game.player.skills.bow.lv === 5, '存檔讀回來，技能組合名稱還在');
      const g2 = new FE.Game(452);
      g2.start({ cls: 'warrior', picks: ['sword', 'herb', 'gold'] });
      ok(!g2.player.skillPack && Object.keys(FE.SKILLS).every((k) => g2.player.skills[k].lv === 0), '沒給起始技能（測試用）都是 0 級');
      ok(Ch.rollSkills('warrior', 'sword', FE.makeRng(5), 'focus').levels.bow === undefined, '池子外的技能抽不到');
    }
    useClasses('legacy');
  }
  FE.Combat.hook = hook0;
}
UNITS.growth29 = () => { try { testGrowth29(); } catch (e) { fail('角色與成長測試拋出例外：' + e.stack); } };

// ---- 第三十版：時間與經濟（時鐘、休息、生活開支、經濟值、貨幣、採藥採礦委託、四種委託、世界裡的人的種族、力竭）----
let econChecks = 0;
const corruptCal = {}; // 侵蝕校準：CORRUPT_CHANCE → { nights, monsters, corrupt }
function testEconomy30() {
  const ok = (cond, msg) => { econChecks++; if (!cond) fail('時間與經濟 ' + msg); };
  // 新遊戲：清掉怪物、不再創世；冒險者放在出生的村莊中央的路上
  const newGame = (seed, cls) => {
    const g = new FE.Game(seed);
    g.start(cls ? { cls, picks: BOT_PICKS[cls], body: BOT_BODY[cls] } : undefined);
    g.checkCreate = () => {};
    g.monsters = [];
    g.wakeSpot();
    return g;
  };
  const fieldSpot = (g) => {
    const w = g.world;
    const p = g.player;
    let best = null;
    for (const ch of w.chunks) for (let y = ch.y0; y < ch.y1; y++) for (let x = ch.x0; x < ch.x1; x++) {
      if (!w.passable(x, y) || w.villageAt(x, y) || w.inBuffer(x, y) || w.npcAt(x, y) || w.chestAt(x, y) || g.nodeAt(x, y)) continue;
      const d = Math.abs(x - p.x) + Math.abs(y - p.y);
      if (!best || d < best.d) best = { x, y, d };
    }
    return best;
  };
  const counter = (obj, key) => { let n = 0; const f0 = obj[key]; obj[key] = function () { n++; return f0.apply(this, arguments); }; return { get n() { return n; }, restore() { obj[key] = f0; } }; };

  // 1. 時鐘：一刻 36 秒、一小時 100 刻、一天 2,400 刻；狀態列寫「第 3 天 14 時」
  ok(C.HOUR_TICKS === 100 && C.DAY_TICKS === 2400 && C.HOUR_TICKS * 36 === 3600, '時鐘的數字');
  ok(FE.clockText(0) === '第 1 天 0 時' && FE.clockText(2 * 2400 + 1400) === '第 3 天 14 時' && FE.clockText(2399) === '第 1 天 23 時', `時間的寫法 ${FE.clockText(2 * 2400 + 1400)}`);

  // 2. 怪物、士兵、事件照同一個時鐘：每 10 刻世界一回合（怪物、士兵各動一次），每 100 刻演算一次事件
  {
    const g = newGame(301);
    const ev = counter(FE.Events, 'tick');
    const wt = counter(FE.AI, 'worldTurn');
    const stt = counter(FE.AI, 'soldierTurn');
    const t0 = g.ticks;
    for (let i = 0; i < 37; i++) g.endTurn(false, 10, { exact: true });
    ok(g.ticks - t0 === 370 && wt.n === 37 && stt.n === 37, `370 刻：世界 ${wt.n} 回合、士兵 ${stt.n} 次（應該各 37）`);
    ok(ev.n === Math.floor(g.ticks / 100) - Math.floor(t0 / 100), `370 刻演算事件 ${ev.n} 次（應該每 100 刻一次）`);
    // 一個動作 25 刻（例如重甲走一步）：刻數累積，湊滿 10 刻就多動一次
    const w0 = wt.n;
    for (let i = 0; i < 4; i++) g.endTurn(false, 25, { exact: true });
    ok(wt.n - w0 === 10, `4 個 25 刻的動作，世界該走 10 回合，走了 ${wt.n - w0}`);
    ev.restore(); wt.restore(); stt.restore();
  }

  // 3. 野外短休：1 小時（100 刻，世界跑 10 回合），回 1d10＋體質修正值，不花錢；旁邊有怪物不能休息；途中怪物貼上來就被打斷
  {
    const g = newGame(302);
    const p = g.player;
    const at = fieldSpot(g);
    Object.assign(p, { x: at.x, y: at.y, hp: 1, copper: 500 });
    const wt = counter(FE.AI, 'worldTurn');
    const t0 = g.ticks;
    g.rest();
    ok(g.ticks - t0 === 100 && wt.n === 10 && p.copper === 500 && p.hp > 1 && p.hp <= 1 + 10, `短休：${g.ticks - t0} 刻、世界 ${wt.n} 回合、錢 ${p.copper}、生命 ${p.hp}`);
    wt.restore();
    // 旁邊有怪物：不能休息、不花時間
    const side = DIRS.find(([dx, dy]) => g.world.passable(p.x + dx, p.y + dy) && g.world.heightOk(p.x, p.y, p.x + dx, p.y + dy) && !g.world.npcAt(p.x + dx, p.y + dy));
    const m = g.spawnMonster({ type: 'TERRAIN', x: p.x + side[0], y: p.y + side[1], cells: [], scope: 2, data: {} });
    m.x = p.x + side[0]; m.y = p.y + side[1];
    const t1 = g.ticks;
    g.rest();
    ok(g.ticks === t1 && g.log[0].text.includes('旁邊有怪物'), '旁邊有怪物還能休息');
    // 會追人的怪物在 4 步外：休息途中追上來，休息被打斷，沒回生命
    g.monsters = [];
    const far = fieldSpot(g);
    let spot = null;
    for (let dy = -6; dy <= 6 && !spot; dy++) for (let dx = -6; dx <= 6 && !spot; dx++) {
      const x = p.x + dx, y = p.y + dy;
      if (Math.abs(dx) + Math.abs(dy) === 4 && g.world.passable(x, y) && !g.world.inBuffer(x, y) && FE.AI.canSee(g.world, { x, y }, p)) spot = { x, y };
    }
    if (spot && far) {
      const c = g.spawnMonster({ type: 'TERRAIN', x: spot.x, y: spot.y, cells: [], scope: 2, data: {} });
      Object.assign(c, { x: spot.x, y: spot.y, small: true });
      p.hp = 5;
      const t2 = g.ticks;
      g.rest();
      ok(g.ticks - t2 < 100 && /休息被怪物打斷/.test(g.log.map((l) => l.text).join('|')), `怪物追上來，短休該被打斷（花了 ${g.ticks - t2} 刻）`);
    }
  }

  // 4. 村莊長休：8 小時（800 刻，世界跑 80 回合），生命回滿，照經濟標籤付生活開支，得到生活水準的效果
  {
    const g = newGame(303);
    const p = g.player;
    const v = g.world.villageAt(p.x, p.y);
    ok(!!v, '醒來的地方不在聚落裡');
    const tiers = [];
    for (let tier = 0; tier <= 4; tier++) {
      v.steading.prosperity = tier;
      v.econ = tier * C.ECON_STEP + C.ECON_STEP / 2;
      p.copper = 1000;
      p.hp = 1;
      p.equip.main.dur = 100;
      const wt = counter(FE.AI, 'worldTurn');
      const t0 = g.ticks;
      g.rest();
      wt.restore();
      const paid = 1000 - p.copper;
      tiers.push(paid);
      const rep = Math.round(200 * C.LIVING_REPAIR[tier]);
      ok(g.ticks - t0 === 800 && wt.n === 80 && p.hp === p.maxHp, `長休：${g.ticks - t0} 刻、世界 ${wt.n} 回合、生命 ${p.hp}/${p.maxHp}`);
      ok(paid === C.LIVING_COST[tier] * 10 && p.equip.main.dur === 100 + rep, `${FE.PROSPERITY[tier]}：付了 ${paid} 銅（應該 ${C.LIVING_COST[tier]} 銀）、長劍耐久 ${p.equip.main.dur}（應該 ${100 + rep}）`);
      ok(tier < 2 ? !p.lodging : p.lodging && p.lodging.villageId === v.id && p.lodging.bonus === C.LIVING_QUEST[tier], `${FE.PROSPERITY[tier]} 的委託獎勵加成 ${JSON.stringify(p.lodging)}`);
    }
    ok(tiers.join() === '30,60,150,300,300', `生活開支（銅）${tiers}`);
    // 錢不夠：住最便宜的那一級（荒蕪的效果），付得出多少付多少（最多 3 銀）
    v.steading.prosperity = 2; v.econ = 50;
    for (const [have, pay] of [[100, 30], [12, 12], [0, 0]]) {
      p.copper = have;
      p.hp = 1;
      p.equip.main.dur = 100;
      g.rest();
      ok(have - p.copper === pay && p.equip.main.dur === 100 && !p.lodging && p.hp === p.maxHp, `普通的聚落錢只有 ${have} 銅：付了 ${have - p.copper}（應該 ${pay}），耐久 ${p.equip.main.dur}、加成 ${JSON.stringify(p.lodging)}`);
    }
    // 住宿加成：普通 +5% 只加在這個聚落的委託上
    p.copper = 1000;
    g.rest();
    const q = { copper: 200 };
    const base = Math.round(200 * FE.Steading.questEcon(v));
    ok(g.questPay(q, v.id) === Math.round(200 * FE.Steading.questEcon(v) * 1.05) && g.questPay(q, -1) === 200, `住宿加成：這裡 ${g.questPay(q, v.id)}（不加是 ${base}）、別處 ${g.questPay(q, -1)}`);
  }

  // 5. 倒下在聚落醒來也算一次長休（世界跑 80 回合），不收錢
  {
    const g = newGame(304);
    const p = g.player;
    const at = fieldSpot(g);
    Object.assign(p, { x: at.x, y: at.y, copper: 777, exhaust: 2 });
    const m = g.spawnMonster({ type: 'TERRAIN', x: at.x + 30, y: at.y, cells: [], scope: 2, data: {} });
    const wt = counter(FE.AI, 'worldTurn');
    const t0 = g.ticks;
    g.die(m);
    g.endTurn(false);
    wt.restore();
    ok(g.world.villageAt(p.x, p.y) && p.hp === p.maxHp && p.copper === 777 && p.exhaust === 1 && g.ticks - t0 >= 800 && wt.n >= 80, `倒下醒來：在聚落 ${!!g.world.villageAt(p.x, p.y)}、生命 ${p.hp}/${p.maxHp}、錢 ${p.copper}、力竭 ${p.exhaust}、過了 ${g.ticks - t0} 刻、世界 ${wt.n} 回合`);
  }

  // 6. 經濟值：初始在標籤那一段的中間；在這裡花錢每 10 銀 +1、完成委託 +3、24 步內每隻怪物每天 −1；標籤改變時出訊息，物價跟著標籤
  {
    const g = newGame(305);
    const p = g.player;
    const v = g.world.villageAt(p.x, p.y);
    const tier0 = v.steading.prosperity;
    ok(FE.Steading.econ(v) === tier0 * 20 + 10, `初始經濟值 ${FE.Steading.econ(v)}（標籤 ${FE.PROSPERITY[tier0]}）`);
    const f0 = FE.Steading.shopFactor(v);
    const r0 = g.compute;
    g.spend(v, 1000); // 100 銀：經濟值 +10，修補力 +100÷20＝5 點單人份量（×4×0.5）
    ok(Math.abs(FE.Steading.econ(v) - (tier0 * 20 + 20)) < 1e-9 && v.steading.prosperity === Math.min(4, tier0 + 1), `花 100 銀之後經濟值 ${FE.Steading.econ(v)}、標籤 ${FE.PROSPERITY[v.steading.prosperity]}`);
    ok(/日子好過了些/.test(g.log[0].text) && FE.Steading.shopFactor(v) < f0, `標籤升級的訊息「${g.log[0].text}」、價錢倍率 ${f0} → ${FE.Steading.shopFactor(v)}`);
    ok(Math.abs(g.compute - Math.min(C.COMPUTE_CAP, r0 + 5 * C.PLAYER_COMPUTE_SCALE * (1 - C.CREATION_SHARE) * FE.Stability.mult(g, 'COMPUTE'))) < 1e-9, `花 100 銀換的修補力 ${g.compute - r0}`);
    const c0 = g.creation;
    g.spend(v, 400);
    ok(g.creation === c0, '花錢不該進創世力');
    // 委託 +3
    const e1 = FE.Steading.econ(v);
    const npc = g.world.npcs.find((n) => n.villageId === v.id && !FE.Gear.isShopkeeper(n));
    p.jobs.herb = { kind: 'herb', giverId: npc.id, villageId: v.id, n: 1, exp: 1, copper: 10, compute: 0 };
    g.finishJob(npc, p.jobs.herb, '委託完成');
    ok(Math.abs(FE.Steading.econ(v) - Math.min(100, e1 + 3)) < 1e-9 && g.player.jobs.herb === null, `完成委託後經濟值 ${FE.Steading.econ(v)}（原本 ${e1}）`);
    // 每天：24 步內每有 1 隻怪物 −1
    v.econ = 50; v.steading.prosperity = 2;
    const box = (x, y) => Math.max(v.x0 - x, 0, x - v.x1) + Math.max(v.y0 - y, 0, y - v.y1);
    const spots = [];
    for (let y = v.y0 - 30; y <= v.y1 + 30 && spots.length < 25; y++) for (let x = v.x0 - 30; x <= v.x1 + 30 && spots.length < 25; x++) {
      if (g.world.passable(x, y) && !g.world.inBuffer(x, y) && box(x, y) <= 20 && box(x, y) >= 10) spots.push([x, y]);
    }
    g.monsters = [];
    for (const [x, y] of spots.slice(0, 12)) { const m = g.spawnMonster({ type: 'TERRAIN', x, y, cells: [], scope: 2, data: {} }); Object.assign(m, { x, y }); }
    const near = g.monsters.filter((m) => box(m.x, m.y) <= C.HUNT_RADIUS).length;
    const others = g.world.villages.filter((o) => o !== v).map((o) => FE.Steading.econ(o));
    g.econDay();
    ok(near >= 10 && FE.Steading.econ(v) === 50 - near && v.steading.prosperity === Math.floor((50 - near) / 20), `一天後經濟值 ${FE.Steading.econ(v)}（附近 ${near} 隻怪物）、標籤 ${FE.PROSPERITY[v.steading.prosperity]}`);
    ok(near < 10 || g.log.some((l) => /日子難過了起來/.test(l.text)), '經濟標籤降級沒出訊息');
    // 時間跨過一天才扣：放著過 2,400 刻扣一次
    v.econ = 50; v.steading.prosperity = 2;
    g.ticks = C.DAY_TICKS * 5 - 5;
    p.awakeAt = g.ticks;
    g.monsters = g.monsters.filter((m) => box(m.x, m.y) <= C.HUNT_RADIUS).slice(0, 3);
    for (const m of g.monsters) { m.prone = true; m.small = false; } // 怪物不動
    const nOld = g.monsters.length;
    g.worldEvery = 1e9; // 世界不走（怪物不移動），只看日子
    g.endTurn(false, 10, { exact: true });
    ok(FE.Steading.econ(v) === 50 - nOld * C.ECON_MONSTER, `跨過一天扣 ${50 - FE.Steading.econ(v)}（應該 ${nOld}）`);
    g.endTurn(false, 10, { exact: true });
    ok(FE.Steading.econ(v) === 50 - nOld * C.ECON_MONSTER, '同一天不該再扣');
    g.worldEvery = 1;
    // 上下限 0～100
    v.econ = 1; FE.Steading.addEcon(v, -50); ok(v.econ === 0 && v.steading.prosperity === 0, `經濟值下限 ${v.econ}`);
    v.econ = 99; FE.Steading.addEcon(v, 50); ok(v.econ === 100 && v.steading.prosperity === 4, `經濟值上限 ${v.econ}、標籤 ${FE.PROSPERITY[v.steading.prosperity]}`);
    // 委託的金錢照委託人聚落的經濟標籤：荒蕪 ×0.8、貧窮 ×0.9、普通 ×1、繁盛與富裕 ×1.2
    p.lodging = null;
    const pays = [0, 1, 2, 3, 4].map((t) => { v.steading.prosperity = t; return g.questPay({ copper: 100 }, v.id); });
    ok(pays.join() === '80,90,100,120,120', `委託金錢的經濟倍率 ${pays}`);
    // 在工匠那裡花錢也算進這個聚落的經濟值
    v.econ = 50; v.steading.prosperity = 2;
    const smith = g.world.npcs.find((n) => n.villageId === v.id && n.role === 'smith');
    p.copper = 10000;
    const pr = FE.Gear.shopPrice('sword', 0, v, g.chaMod());
    ok(shopDo(g, smith, 'buyItem:sword:0') && Math.abs(FE.Steading.econ(v) - (50 + pr / 100)) < 1e-9, `買長劍（${pr} 銅）後經濟值 ${FE.Steading.econ(v)}`);
  }

  // 7. 貨幣：內部用銅記帳，寫成「3 金 5 銀 2 銅」（零的省略）；硬幣沒有重量
  {
    const g = newGame(306);
    const w0 = g.weight();
    g.player.copper = 123456;
    ok(g.weight() === w0 && FE.money(123456) === '1234 金 5 銀 6 銅' && FE.money(5) === '5 銅' && FE.money(100) === '1 金', `錢的寫法與重量 ${FE.money(123456)}`);
  }

  // 8. 採藥、採礦委託：帶 5～10 份藥草、3～6 顆礦石交給委託人（背包裡的，舊的也能交）；獎勵＝基本＋材料本身的價錢；算力一半創世、一半修補
  {
    const g = newGame(307);
    const p = g.player;
    const v = g.world.villageAt(p.x, p.y);
    v.econ = 50; v.steading.prosperity = 2;
    const ns = g.world.npcs.filter((n) => n.villageId === v.id && !FE.Gear.isShopkeeper(n));
    const seen = { herb: [], ore: [] };
    for (let i = 0; i < 200; i++) {
      const kind = i % 2 ? 'herb' : 'ore';
      FE.Events.gatherQuest(g, ns[0], kind);
      const q = ns[0].quest;
      const G = C.GATHER_QUEST[kind];
      const f = FE.Steading.rewardFactor(v);
      seen[kind].push(q.n);
      if (q.kind !== kind || q.copper !== Math.round((10 + G.value * q.n) * f * 10) || q.compute !== G.compute + G.computePer * q.n || q.exp !== Math.round((15 + q.n) * f)) ok(false, `${kind} 委託的數字 ${JSON.stringify(q)}`);
    }
    ok(Math.min(...seen.herb) === 5 && Math.max(...seen.herb) === 10 && Math.min(...seen.ore) === 3 && Math.max(...seen.ore) === 6, `採藥 ${Math.min(...seen.herb)}～${Math.max(...seen.herb)} 份、採礦 ${Math.min(...seen.ore)}～${Math.max(...seen.ore)} 顆`);
    // 接下、湊不夠不能交、湊夠了交出去（舊的也算），拿到錢與算力
    const giver = ns[0];
    giver.quest = { kind: 'herb', n: 6, village: v.name, exp: 21, copper: 220, compute: 6, accepted: false, done: false };
    g.talking = giver.id;
    const ids = () => g.talkOptions(giver).options.map((o) => o.id).join('/');
    ok(ids() === 'accept/decline' && /6 份藥草/.test(g.talkOptions(giver).text), `採藥委託的選項 ${ids()}「${g.talkOptions(giver).text}」`);
    g.choose(giver, 0);
    ok(p.jobs.herb && p.jobs.herb.n === 6 && giver.quest.accepted, '接下採藥委託後手上沒有');
    g.bagAdd('herb', 4);
    g.talking = giver.id;
    ok(ids() === 'leave' && /還差 2 份藥草/.test(g.talkOptions(giver).text), `藥草不夠：${ids()}「${g.talkOptions(giver).text}」`);
    g.bagAdd('herb', 3);
    const cr0 = g.creation, cu0 = p.copper, e0 = g.exp;
    p.lodging = null;
    const want = g.questPay(p.jobs.herb, v.id);
    g.talking = giver.id;
    ok(ids() === 'hand:herb/leave', `藥草湊夠了：${ids()}`);
    g.choose(giver, 0);
    ok(!p.jobs.herb && giver.quest.done && g.bagCount('herb') === 1 && p.copper - cu0 === want && want === 220 && g.exp - e0 === 21, `交藥草：剩 ${g.bagCount('herb')} 份、錢 +${p.copper - cu0}（應該 ${want}）、經驗值 +${g.exp - e0}`);
    ok(Math.abs(g.creation - cr0 - 6 * C.PLAYER_COMPUTE_SCALE * C.CREATION_SHARE) < 1e-9, `採藥委託的創世力 ${g.creation - cr0}`);
    // 採礦一樣
    giver.quest = { kind: 'ore', n: 3, village: v.name, exp: 18, copper: 250, compute: 6, accepted: false, done: false };
    g.talking = giver.id; g.choose(giver, 0);
    g.bagAdd('ore', 3);
    g.talking = giver.id;
    ok(ids() === 'hand:ore/leave', `礦石湊夠了：${ids()}`);
    g.choose(giver, 0);
    ok(!p.jobs.ore && g.bagCount('ore') === 0, '交礦石之後還有');
    // 不算進創世門檻：事件生的委託在創世時不存在，createChunk 只算新區塊裡已有的任務；檢查器不把它們當成懸空指標
    giver.quest = { kind: 'ore', n: 3, village: v.name, exp: 18, copper: 250, compute: 6, accepted: false, done: false };
    ok(FE.Checker.checkNpc(g.world, giver) === null, '採礦委託被檢查器當成懸空指標');
  }

  // 9. 委託分四種，每種同時只能接一個（最多同時四個）
  {
    const g = newGame(308);
    const p = g.player;
    const v = g.world.villageAt(p.x, p.y);
    const ns = g.world.npcs.filter((n) => !FE.Gear.isShopkeeper(n));
    ok(ns.length >= 2, '村民不夠');
    if (ns.length >= 2) {
      const [a, b] = ns;
      const accept = (n, q) => { n.quest = q; g.talking = n.id; const i = g.talkOptions(n).options.findIndex((o) => o.id === 'accept'); if (i >= 0) g.choose(n, i); g.closeTalk(); return i >= 0; };
      ok(accept(a, { kind: 'herb', n: 5, village: v.name, exp: 1, copper: 1, compute: 0, accepted: false, done: false }), '接不了採藥委託');
      ok(!accept(b, { kind: 'herb', n: 5, village: v.name, exp: 1, copper: 1, compute: 0, accepted: false, done: false }), '已經有採藥委託還能再接一個');
      ok(accept(b, { kind: 'ore', n: 3, village: v.name, exp: 1, copper: 1, compute: 0, accepted: false, done: false }), '有採藥委託時接不了採礦委託');
      const m = g.spawnMonster({ type: 'TERRAIN', x: p.x + 40, y: p.y, cells: [], scope: 2, data: {} });
      const c = ns[2] || a;
      c.quest = null;
      ok(accept(c, { kind: 'hunt', monsterIds: [m ? m.id : -1], total: 1, village: v.name, exp: 1, copper: 1, compute: 0, accepted: false, done: false }), '有採藥採礦委託時接不了清除委託');
      const d = ns[3] || b;
      d.quest = null;
      ok(accept(d, FE.makeQuest(g.world, g.rng, d, a)), '有三種委託時接不了送貨委託');
      ok(g.jobList().length === 4 && g.jobList().map((j) => j.kind).join() === 'hunt,deliver,herb,ore', `手上的委託 ${g.jobList().map((j) => j.kind)}`);
      FE.Save.save(g);
      const back = FE.Save.load();
      ok(back && back.game && back.game.jobList().length === 4, '四個委託存檔讀不回來');
    }
  }

  // 10. 世界裡的人的種族：人類 70%、矮人 15%、精靈 15%；寫在對話視窗
  {
    const cnt = { human: 0, dwarf: 0, elf: 0 };
    let n = 0;
    for (let s = 0; s < 30; s++) {
      const g = new FE.Game(4000 + s);
      g.start();
      for (let k = 0; k < 3; k++) g.createChunk(false);
      for (const o of g.world.npcs.concat(g.soldiers)) { cnt[o.race]++; n++; }
    }
    ok(n > 200 && Object.values(cnt).reduce((a, b) => a + b, 0) === n, `每個人都該有種族（${n} 人：${JSON.stringify(cnt)}）`);
    ok(Math.abs(cnt.human / n - 0.7) < 0.07 && Math.abs(cnt.dwarf / n - 0.15) < 0.05 && Math.abs(cnt.elf / n - 0.15) < 0.05, `種族比例 人類 ${(cnt.human / n).toFixed(2)}、矮人 ${(cnt.dwarf / n).toFixed(2)}、精靈 ${(cnt.elf / n).toFixed(2)}`);
    const g = newGame(309);
    const n0 = g.world.npcs[0];
    ok(g.talkOptions(n0).role.endsWith(FE.PLAYER_RACES[n0.race].name), `對話視窗的身分 ${g.talkOptions(n0).role}`);
  }

  // 11. 力竭：連續一整天沒有長休 +1 級；長休 −1 級；出手的 d20 −2×級數，走一步多 1 刻×級數；6 級倒下，醒來降到 5 級再照長休 −1
  {
    const g = newGame(310);
    const p = g.player;
    const at = fieldSpot(g);
    Object.assign(p, { x: at.x, y: at.y });
    p.awakeAt = g.ticks - (C.DAY_TICKS - 5);
    g.endTurn(false, 10, { exact: true });
    ok(p.exhaust === 1 && /一整天沒好好睡/.test(g.log.map((l) => l.text).join('|')), `一整天沒長休：力竭 ${p.exhaust}`);
    // 走一步多花的刻
    const free = DIRS.find(([dx, dy]) => g.world.passable(p.x + dx, p.y + dy) && g.world.heightOk(p.x, p.y, p.x + dx, p.y + dy) && !g.world.npcAt(p.x + dx, p.y + dy) && !g.isHardGround(p.x + dx, p.y + dy));
    const step = (lv) => { p.exhaust = lv; p.awakeAt = g.ticks; const t0 = g.ticks; g.move(free[0], free[1]); g.move(-free[0], -free[1]); return (g.ticks - t0) / 2; };
    const s0 = step(0), s3 = step(3);
    ok(s3 - s0 === 3, `力竭 3 走一步多 ${s3 - s0} 刻（應該 3）`);
    p.exhaust = 0;
    // 長休 −1
    g.wakeSpot();
    p.exhaust = 3; p.copper = 1000;
    g.rest();
    ok(p.exhaust === 2 && p.awakeAt === g.ticks, `長休後力竭 ${p.exhaust}（應該 2）`);
    // 6 級倒下：在聚落醒來，5 級再照長休 −1 → 4 級，不收錢
    const at2 = fieldSpot(g);
    Object.assign(p, { x: at2.x, y: at2.y, exhaust: 5, copper: 321 });
    p.awakeAt = g.ticks - (C.DAY_TICKS - 5);
    const t0 = g.ticks;
    g.endTurn(false, 10, { exact: true });
    ok(p.exhaust === 4 && g.world.villageAt(p.x, p.y) && p.hp === p.maxHp && p.copper === 321 && g.ticks - t0 >= 800 && /累得倒了下去/.test(g.log.map((l) => l.text).join('|')), `力竭 6 級：醒來力竭 ${p.exhaust}、在聚落 ${!!g.world.villageAt(p.x, p.y)}、錢 ${p.copper}、過了 ${g.ticks - t0} 刻`);
  }
  // 力竭時出手的 d20：每級 −2
  {
    const g = newGame(311);
    const p = g.player;
    const at = fieldSpot(g);
    Object.assign(p, { x: at.x, y: at.y });
    const free = DIRS.find(([dx, dy]) => g.world.passable(p.x + dx, p.y + dy) && g.world.heightOk(p.x, p.y, p.x + dx, p.y + dy) && g.world.cell(p.x + dx, p.y + dy).h === g.world.cell(p.x, p.y).h && !g.world.npcAt(p.x + dx, p.y + dy));
    if (free) {
      const m = g.spawnMonster({ type: 'TERRAIN', x: p.x + free[0], y: p.y + free[1], cells: [], scope: 2, data: {} });
      Object.assign(m, { x: p.x + free[0], y: p.y + free[1], hp: 999, maxHp: 999 });
      const d20 = FE.rollD20;
      const mods = {};
      for (const lv of [0, 1, 3]) {
        p.exhaust = lv;
        FE.rollD20 = function (r, mod) { if (mods[lv] === undefined) mods[lv] = mod; return d20.apply(this, arguments); };
        FE.Combat.resolveAttack(g, p, m, 'attack', {});
        FE.rollD20 = d20;
      }
      ok(mods[1] - mods[0] === -2 && mods[3] - mods[0] === -6, `力竭的出手 d20：0 級 ${mods[0]}、1 級 ${mods[1]}、3 級 ${mods[3]}`);
    }
  }

  // 12. 侵蝕校準：長休一晚（80 回合），聚落附近（冒險者 20 步內、圈外）的怪物每隻侵蝕幾次。舊的 0.012 與現在的數字各量一次
  {
    const chances = [0.012, C.CORRUPT_CHANCE];
    const c0 = C.CORRUPT_CHANCE;
    for (const ch of chances) {
      C.CORRUPT_CHANCE = ch;
      const r = corruptCal[ch] || (corruptCal[ch] = { nights: 0, monsters: 0, corrupt: 0, tiles: 0 });
      for (let s = 0; s < 40; s++) {
        const g = new FE.Game(6100 + s);
        g.start();
        g.checkCreate = () => {};
        g.wakeSpot();
        g.worldState = 0;
        const p = g.player;
        // 放 4 隻怪物在冒險者 20 步內（侵蝕的範圍）、聚落周圍的圈外（不追人，只徘徊）
        g.monsters = [];
        const spots = [];
        for (let dy = -20; dy <= 20; dy++) for (let dx = -20; dx <= 20; dx++) {
          const x = p.x + dx, y = p.y + dy;
          if (Math.abs(dx) + Math.abs(dy) <= C.CORRUPT_RANGE - 2 && g.world.passable(x, y) && !g.world.inBuffer(x, y) && !g.world.villageAt(x, y)) spots.push([x, y]);
        }
        const rr = FE.makeRng(s + 9);
        for (let k = 0; k < 4 && spots.length; k++) {
          const [x, y] = spots.splice(Math.floor(rr() * spots.length), 1)[0];
          const m = g.spawnMonster({ type: 'TERRAIN', x, y, cells: [], scope: 2, data: {} });
          if (m) Object.assign(m, { x, y, home: { x, y } });
        }
        if (!g.monsters.length) continue;
        const st = FE.Stability.stat(g);
        st.corrupt = 0;
        const evTick = FE.Events.tick;
        FE.Events.tick = () => {}; // 只量侵蝕，不讓檢查器把扭曲的地面變成新的怪物
        const before = g.world.chunks.reduce((n, chk) => n + chk.cells.flat().filter((c) => c.biome === 'tundra' || c.biome === 'desert').length, 0);
        p.copper = 1000;
        g.rest();
        const after = g.world.chunks.reduce((n, chk) => n + chk.cells.flat().filter((c) => c.biome === 'tundra' || c.biome === 'desert').length, 0);
        FE.Events.tick = evTick;
        r.nights++;
        r.monsters += g.monsters.length;
        r.corrupt += st.corrupt;
        r.tiles += after - before;
      }
    }
    C.CORRUPT_CHANCE = c0;
    const per = (ch) => corruptCal[ch].corrupt / Math.max(1, corruptCal[ch].monsters);
    ok(per(C.CORRUPT_CHANCE) >= 1 && per(C.CORRUPT_CHANCE) <= 2, `長休一晚每隻附近怪物侵蝕 ${per(C.CORRUPT_CHANCE).toFixed(2)} 次（應該 1～2）`);
  }
}
UNITS.economy30 = () => { try { testEconomy30(); } catch (e) { fail('時間與經濟測試拋出例外：' + e.stack); } };
const simResults = []; // 這個行程跑過的模擬結果
const arenaData = {};  // 競技場量測（每個職業一項工作）
let growthChecks = 0;
const jobSecs = [];    // 主行程：每項工作的耗時
function runJob(id) {
  const [kind, a, b] = id.split(':');
  const steps = QUICK ? 1000 : 1500;
  if (kind === 'gen') {
    const [lo, hi] = a.split('-').map(Number);
    runGen(lo, hi);
  } else if (kind === 'sim') simResults.push(simulate(Number(b), { steps, cls: a }));
  else if (kind === 'lazy') simResults.push(simulate(SEEDS[0], { steps, lazy: true }));
  else if (kind === 'sim4') {
    simResults.push(simulate(Number(b), { worldEvery: 4, scale: 1, minActions: QUICK ? 2000 : 3000, untilChunks: QUICK ? 8 : 15, maxActions: QUICK ? 4000 : MAX_ACTIONS, verifyReach: a === BOT_CLASSES[0] && Number(b) === SEEDS[0], cls: a }));
  } else if (kind === 'cmp') simResults.push(simulate(Number(b), { steps: SIM_CMP_STEPS, cond: a }));
  else if (kind === 'unit') { useClasses('legacy'); NO_TIRE = a !== 'economy30'; UNITS[a](); NO_TIRE = false; }
  else if (kind === 'arena') { NO_TIRE = true; runArena(a); NO_TIRE = false; } // 競技場量的是幾下打倒，不讓角色累
  else throw new Error('不認得的工作 ' + id);
}
// 這個行程累積的所有結果（交給主行程合併）
function collectState() {
  return {
    problems, pcount: problems.count || 0,
    stats, geo, reachCheck, bufferViolations, cutOff, stuckFixes, dlgStats, combat,
    measure: { armorCmp: measure.armorCmp },
    checks: { dlg: dlgChecks, creation: creationChecks, wl: wlChecks, soldier: soldierChecks, bag: bagChecks, gear: gearChecks, char: charChecks, reach: reachChecks, combat: combatChecks, growth: growthChecks, econ: econChecks },
    corruptCal,
    botDrops,
    sims: simResults, arena: arenaData,
  };
}
// 把子行程的結果加進主行程：數字相加、陣列接起來、物件逐項合
function mergeDeep(dst, src) {
  for (const k of Object.keys(src)) {
    const v = src[k];
    if (Array.isArray(v)) dst[k] = (dst[k] || []).concat(v);
    else if (v && typeof v === 'object') mergeDeep(dst[k] || (dst[k] = {}), v);
    else if (typeof v === 'number') dst[k] = (dst[k] || 0) + v;
    else dst[k] = v;
  }
}
function mergeState(part) {
  for (const p of part.problems) if (problems.length < 200) problems.push(p);
  problems.count = (problems.count || 0) + part.pcount;
  mergeDeep(stats, part.stats);
  mergeDeep(geo, part.geo);
  mergeDeep(reachCheck, part.reachCheck);
  mergeDeep(dlgStats, part.dlgStats);
  mergeDeep(combat, part.combat);
  mergeDeep(measure.armorCmp, part.measure.armorCmp);
  bufferViolations += part.bufferViolations;
  stuckFixes += part.stuckFixes;
  botDrops += part.botDrops;
  cutOff.push(...part.cutOff);
  const c = part.checks;
  dlgChecks += c.dlg; creationChecks += c.creation; wlChecks += c.wl; soldierChecks += c.soldier; bagChecks += c.bag;
  gearChecks += c.gear; charChecks += c.char; reachChecks += c.reach; combatChecks += c.combat; growthChecks += c.growth; econChecks += c.econ;
  mergeDeep(corruptCal, part.corruptCal);
  simResults.push(...part.sims);
  mergeDeep(arenaData, part.arena);
}
// 工作清單：重的排前面，同時跑 FE_JOBS 個（預設 4）
function buildJobs() {
  const jobs = [];
  const add = (id, w) => jobs.push({ id, w });
  const units = ['gear', 'character', 'combat28', 'growth29', 'economy30', 'dialogs', 'creation', 'worldlevel', 'soldiers', 'backpack', 'reach'];
  if (MODE === 'arena') {
    for (const cls of BOT_CLASSES) add('arena:' + cls, 30);
    return jobs;
  }
  if (!SIM4_ONLY) {
    if (QUICK) {
      for (const cls of BOT_CLASSES) add(`sim:${cls}:${SEEDS[0]}`, 20);
      add('sim4:warrior:' + SEEDS[0], 40);
      add('sim4:mage:' + SEEDS[0], 40);
      add('gen:1-4', 30);
    } else {
      for (let lo = 1; lo <= GEN_SEEDS; lo += 10) add(`gen:${lo}-${lo + 9}`, 40);
      for (const cls of BOT_CLASSES) for (const seed of SEEDS) add(`sim:${cls}:${seed}`, 30);
      add('lazy', 20);
    }
  }
  if (!UNIT_ONLY && !QUICK) for (const cls of BOT_CLASSES) for (const seed of SEEDS) add(`sim4:${cls}:${seed}`, 100);
  if (!SIM4_ONLY && !QUICK) for (const cond of ['none', 'heavy']) for (const seed of SEEDS) add(`cmp:${cond}:${seed}`, 20);
  if (MODE !== 'sim4') for (const u of units) add('unit:' + u, u === 'gear' || u === 'character' || u === 'combat28' ? 60 : 10);
  if (MODE !== 'sim4') for (const cls of BOT_CLASSES) add('arena:' + cls, 30);
  return jobs.sort((x, y) => y.w - x.w);
}
if (JOB) {
  // 子行程：跑一項工作，把結果交回主行程後結束
  const t0 = Date.now();
  runJob(JOB);
  if (process.send) process.send({ id: JOB, ms: Date.now() - t0, state: collectState() }, () => process.exit(0));
  else {
    // 直接叫起來（不經主行程）：只印這一項的耗時、模擬結果和問題，調數字、查單項用
    for (const s of simResults) console.log(JSON.stringify(s));
    if (Object.keys(corruptCal).length) console.log('侵蝕校準', JSON.stringify(corruptCal));
    console.log(`耗時 ${((Date.now() - t0) / 1000).toFixed(1)} 秒｜問題 ${problems.count || 0} 件`);
    for (const p of problems) console.log('  ', p);
  }
} else {
  const T0 = Date.now();
  const jobs = buildJobs();
  const N = Math.max(1, Number(process.env.FE_JOBS) || 4);
  let next = 0;
  let running = 0;
  let failed = 0;
  const finish = () => {
    // 全部跑完：印報告
    const wall = Date.now() - T0;
    report(wall);
  };
  const launch = () => {
    while (running < N && next < jobs.length) {
      const job = jobs[next++];
      running++;
      const child = cp.fork(__filename, ['--job', job.id], { env: Object.assign({}, process.env, { FE_MODE: MODE }) });
      let got = false;
      child.on('message', (m) => {
        got = true;
        mergeState(m.state);
        jobSecs.push([m.id, m.ms]);
      });
      child.on('exit', (code) => {
        running--;
        if (!got) {
          failed++;
          fail(`工作 ${job.id} 沒有交回結果（結束碼 ${code}）`);
        }
        if (next < jobs.length) launch();
        else if (running === 0) finish();
      });
    }
  };
  if (!jobs.length) finish();
  else launch();
}

// ---- 報告 ----
function report(wall) {
const bySeed = (a, b) => (a.cls === b.cls ? a.seed - b.seed : BOT_CLASSES.indexOf(a.cls) - BOT_CLASSES.indexOf(b.cls));
const sim = simResults.filter((s) => !s.lazy && s.worldEvery === 1 && !s.cond && s.cls !== '中性').sort(bySeed);
const lazySim = simResults.find((s) => s.lazy) || null;
const sim4 = simResults.filter((s) => s.worldEvery > 1).sort(bySeed);
const avg =(a, f) => (a.length ? (a.reduce((s, x) => s + f(x), 0) / a.length).toFixed(2) : '-');
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
console.log(`背包、工具、採集、藥草、艱難選擇的場景檢查 ${bagChecks} 項｜裝備與物品的場景檢查 ${gearChecks} 項｜角色（職業、屬性、生命與負重、加點、技能）的場景檢查 ${charChecks} 項｜可達性快取的場景檢查 ${reachChecks} 項｜戰鬥（第二十八版）的場景檢查 ${combatChecks} 項｜角色與成長（第二十九版）的場景檢查 ${growthChecks} 項`);
// 競技場量測（第二十九版，取代原本從世界模擬統計的下數）：每個職業、角色等級 1／5／10／15、世界等級 1～7，
// 把角色（屬性點照主屬性分配、技能練到合理等級、裝備品質照世界等級）和怪物直接放在一塊空地對打，量打倒小怪物、中型怪物各要幾下
// （冒險者自己出手的次數，不含反擊；遠程職業站在 3 格外射）和被怪物打一下的平均傷害。目標：小怪物約 3 下、中型怪物約 6 下
{
  const mean = (c, t) => (c[t].n ? (c[t].sum / c[t].n).toFixed(1) : '-');
  const taken = (c, t) => (c[t].n ? (c[t].dmg / c[t].n).toFixed(2) : '-');
  const hitDmg = (c, t) => (c[t].n ? (c[t].dmg / Math.max(1, c[t].hit)).toFixed(2) : '-');
  const levels = QUICK ? [1, 15] : ARENA_LEVELS;
  const wls = QUICK ? [1, 4, 7] : [1, 2, 3, 4, 5, 6, 7];
  const trialsText = QUICK ? 10 : 40;
  console.log(`競技場量測（每格 ${trialsText} 場對打；怪物血量的世界等級加成 ${C.WL_BONUS.HP}／級；技能經驗照機器人實測的比例（主武器 ×${SKILL_PER_EXP.main}、格鬥或射擊 ×${SKILL_PER_EXP.fight}、穿甲 ×${SKILL_PER_EXP.armor}、閃避 ×${SKILL_PER_EXP.dodge}、盾牌使用 ×${SKILL_PER_EXP.shield} 角色累計經驗值）；裝備品質隨世界等級）：打倒小怪物／中型怪物平均幾下`);
  for (const cls of BOT_CLASSES) {
    const a = arenaData[cls];
    if (!a) continue;
    console.log(`  【${FE.CLASSES[cls].name}】世界等級：${wls.join('　')}`);
    for (const L of levels) {
      if (!a[L]) continue;
      console.log(`    角色等級 ${String(L).padStart(2)}：` + wls.map((wl) => `${mean(a[L][wl], 'small')}／${mean(a[L][wl], 'mid')}`).join('　'));
    }
  }
  console.log('  被怪物打一下平均受到的傷害（小怪物／中型怪物；括號是命中時）：');
  for (const cls of BOT_CLASSES) {
    const a = arenaData[cls];
    if (!a) continue;
    console.log(`  【${FE.CLASSES[cls].name}】世界等級：${wls.join('　')}`);
    for (const L of levels) {
      if (!a[L]) continue;
      console.log(`    角色等級 ${String(L).padStart(2)}：` + wls.map((wl) => `${taken(a[L][wl], 'takenSmall')}／${taken(a[L][wl], 'takenMid')}（${hitDmg(a[L][wl], 'takenSmall')}／${hitDmg(a[L][wl], 'takenMid')}）`).join('　'));
    }
  }
  // 各職業：四人等效模擬第一次進動盪、失序時的世界等級（每個種子一場）
  console.log('四人等效第一次進動盪／失序時的世界等級：' + BOT_CLASSES.map((cls) => `${FE.CLASSES[cls].name} ${sim4.filter((s) => s.cls === cls).map((s) => `${s.firstUnrestWL == null ? '無' : s.firstUnrestWL}/${s.firstChaosWL == null ? '無' : s.firstChaosWL}`).join('、')}`).join('｜'));
  console.log('模擬結束時的技能等級（單人 1500 動作／四人等效）：');
  for (const cls of BOT_CLASSES) for (const s of sim.concat(sim4).filter((x) => x.cls === cls)) console.log(`    ${FE.CLASSES[cls].name} seed${s.seed} ${s.worldEvery > 1 ? '四人等效' : '單人'}（${s.actions} 個動作）：${s.skills}｜${s.attr}｜生命 ${s.hp}｜負重 ${s.weight}｜${s.over}`);
  {
    const all = sim.concat(sim4);
    const o = all.reduce((t, s) => t + s.overActs, 0);
    const n = all.reduce((t, s) => t + s.actions, 0);
    console.log(`正常玩法（機器人）下超過能背的重量：${o} / ${n} 個動作（${(100 * o / Math.max(1, n)).toFixed(2)}%）｜機器人因為超重丟東西 ${botDrops} 次`);
  }
  // 防具對照：同樣的種子、動作數，沒有防具 vs 穿重甲（都不拿盾牌），冒險者被怪物打一下平均受到多少傷害
  const cmp = measure.armorCmp;
  const line = (c, name) => (cmp[c] ? `${name} 每下 ${(cmp[c].dmg / cmp[c].n).toFixed(2)} 點傷害（怪物出手 ${cmp[c].n} 次、打中 ${cmp[c].hit} 次、命中時平均 ${(cmp[c].dmg / Math.max(1, cmp[c].hit)).toFixed(2)}）` : `${name} -`);
  console.log(`防具對照（${SEEDS.length} 個種子各 ${SIM_CMP_STEPS} 個動作，單人）：${line('none', '沒有防具')}｜${line('heavy', '穿重甲')}${cmp.none && cmp.heavy ? `｜重甲是沒防具的 ${((cmp.heavy.dmg / cmp.heavy.n) / (cmp.none.dmg / cmp.none.n) * 100).toFixed(0)}%` : ''}`);
}
// 第三十版：時間與經濟
{
  console.log(`時間與經濟（第三十版）的場景檢查 ${econChecks} 項`);
  const cal = Object.keys(corruptCal).sort((a, b) => a - b).map((k) => { const r = corruptCal[k]; return `每回合 ${k}：${r.nights} 晚、附近怪物 ${r.monsters} 隻、侵蝕 ${r.corrupt} 次（每隻 ${(r.corrupt / Math.max(1, r.monsters)).toFixed(2)} 次、每晚多出 ${(r.tiles / Math.max(1, r.nights)).toFixed(1)} 格扭曲地面）`; });
  if (cal.length) console.log(`  侵蝕校準（長休一晚 80 回合）：${cal.join('｜')}`);
  const all = sim.concat(sim4);
  if (all.length) {
    for (const s of all) console.log(`  ${FE.CLASSES[s.cls] ? FE.CLASSES[s.cls].name : s.cls} seed${s.seed} ${s.worldEvery > 1 ? '四人等效' : '單人'}（${s.actions} 動作、${s.days} 天）：長休 ${s.longRests} 次、平均每次付 ${FE.money(s.longRests ? s.restPaid / s.longRests : 0)}、短休 ${s.shortRests}｜經濟標籤 升 ${s.econUp}、降 ${s.econDown}（結束時 ${s.econEnd}）｜力竭最高 ${s.exhaustMax} 級｜完成委託 清除 ${s.jobs.hunt}、送貨 ${s.jobs.deliver}、採藥 ${s.jobs.herb}、採礦 ${s.jobs.ore}，同時最多 ${s.jobsMax} 個｜身上 ${FE.money(s.money)}`);
    const sum = (k) => all.reduce((a, s) => a + s[k], 0);
    console.log(`  合計：長休 ${sum('longRests')} 次、平均每次付 ${FE.money(sum('longRests') ? sum('restPaid') / sum('longRests') : 0)}｜經濟標籤 升 ${sum('econUp')} 次、降 ${sum('econDown')} 次｜力竭最高 ${Math.max(...all.map((s) => s.exhaustMax))} 級`);
  }
}
console.log(`對話：邏輯檢查 ${dlgChecks} 項｜機器人開了 ${dlgStats.opened} 次對話（接委託 ${dlgStats.accept}、交件 ${dlgStats.deliver}、交藥草 ${dlgStats['hand:herb']}、交礦石 ${dlgStats['hand:ore']}、回報 ${dlgStats.report}；工匠那裡買 ${dlgStats.buy}、修 ${dlgStats.repair}、打造 ${dlgStats.craft}、賣礦石 ${dlgStats.sellOre}、賣裝備 ${dlgStats.sell}；離開 ${dlgStats.leave}）`);
console.log(`聚落周圍的怪物（任何時刻、含生成點）：違規 ${bufferViolations} 次｜機器人被村民夾在屋裡、等村民走開 ${stuckFixes} 次`);
const pct = (n, d) => (d ? (100 * n / d).toFixed(1) + '%' : '-');
const dist = (t) => { const n = Object.values(t).reduce((a, b) => a + b, 0); return ['crit', 'hit', 'hard', 'miss', 'fumble'].map((k) => `${k} ${pct(t[k] || 0, n)}`).join('、') + `（共 ${n}）`; };
console.log(`戰鬥：判定 ${combat.events} 次｜冒險者出手 ${dist(combat.player)}｜怪物出手 ${dist(combat.monster)}`);
console.log(`  閃避 ${combat.dodged}、格擋 ${combat.blocked}、暴擊 ${combat.crit}、抗性 ${combat.resisted}、反擊 ${combat.counters}（連鎖 ${combat.chain}）、趁機攻擊 ${combat.opportunity}（打中 ${combat.opportunityHit}）、負傷害 ${combat.negative}｜平均每下 冒險者 ${(combat.pdmg / combat.pn).toFixed(2)}、怪物 ${(combat.mdmg / combat.mn).toFixed(2)}`);
console.log(`從出生點走不到的聚落（世界的斷層）：${cutOff.length} 次 ${cutOff.slice(0, 5).join('、')}`);
console.log(`問題 ${problems.count || 0} 件`);
for (const p of problems) console.log('  ', p);
// 各項工作的耗時（秒，子行程各自量的）和全部的牆鐘時間
{
  const secs = (ms) => (ms / 1000).toFixed(1);
  const group = (re) => jobSecs.filter(([id]) => re.test(id)).reduce((s, [, ms]) => s + ms, 0);
  console.log(`耗時：全部 ${secs(wall)} 秒（同時 ${Math.max(1, Number(process.env.FE_JOBS) || 4)} 個子行程；各項加總 ${secs(jobSecs.reduce((s, [, ms]) => s + ms, 0))} 秒）｜生成統計 ${secs(group(/^gen/))}｜單人模擬 ${secs(group(/^(sim|lazy):/))}｜四人等效 ${secs(group(/^sim4/))}｜防具對照 ${secs(group(/^cmp/))}｜場景檢查 ${secs(group(/^unit/))}｜競技場 ${secs(group(/^arena/))}（加總是各工作的秒數相加）`);
  console.log('  各項：' + jobSecs.slice().sort((a, b) => b[1] - a[1]).map(([id, ms]) => `${id} ${secs(ms)}`).join('、'));
}
}
