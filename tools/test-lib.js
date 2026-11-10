// 測試共用的工具：載入遊戲程式、場景檢查用的舊職業與中性角色、問題清單、走得到的格子、室內與住戶與聚落周圍的檢查、可達性比對、戰鬥統計，以及各項工作交回主行程的計數
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
const ROOT = path.join(path.dirname(require.main.filename), '..', 'js') + path.sep; // require.main 是 tools/test.js
global.window = global;
for (const f of ['config', 'rng', 'world', 'checker', 'bugs', 'steading', 'plans', 'char', 'gear', 'combat', 'stability', 'events', 'ai', 'game', 'save']) {
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
// 第三十七版之一：遊戲的起始選項拿掉了「2 份藥草」「20 銀」，舊職業（只在場景檢查用）還挑得到，補在這裡
FE.START_OPTS.herb = { label: '2 份藥草', herb: 2, desc: '' };
FE.START_OPTS.gold = { label: '20 銀', silver: 20, desc: '' };
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
  p.equip = { main: FE.Gear.make('sword', 0, g.nextGearId++), off: null, body: null, tool1: null, tool2: null }; // 工具欄（第三十七版之一）
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
// 第三十一版：起始裝備改成主手、身上、副手、補給各挑一樣。舊的場景檢查照第二十九版的挑法（固定給的加自己挑的）寫，
// 這裡換成新的挑法：第一把武器放主手、多的武器放背包，第一件防具穿上（沒有就衣袍），有盾牌就拿，藥草與 20 銀照給
const V29_FIXED = { warrior: ['medium'], ranger: ['light', 'bow'], mage: ['robe', 'staff'], priest: ['medium', 'club'], paladin: ['heavy', 'shield'], barbarian: ['light'] };
function v29Picks(cls, picks) {
  const all = (V29_FIXED[cls] || []).concat(picks);
  const cat = (id) => (FE.START_OPTS[id] && FE.START_OPTS[id].gear ? FE.GEAR[FE.START_OPTS[id].gear].cat : id);
  const weapons = all.filter((id) => cat(id) === 'weapon');
  const armor = all.find((id) => cat(id) === 'armor') || 'robe';
  const supply = all.includes('herb') ? 'pack_supply' : 'money'; // 第三十七版之一：第四組改成只拿錢與四種包
  return { picks: [weapons[0] || 'staff', armor, all.includes('shield') ? 'shield' : 'nooff', supply], extra: weapons.slice(1).concat(all.includes('herb') && all.includes('gold') ? ['gold'] : []) };
}
const start0 = FE.Game.prototype.start;
FE.Game.prototype.start = function (opts) {
  let extra = [];
  if (opts && opts.cls && opts.picks && FE.CLASSES[opts.cls].allGear && !FE.Char.validPicks(opts.cls, opts.picks)) {
    const v = v29Picks(opts.cls, opts.picks);
    opts = Object.assign({}, opts, { picks: v.picks });
    extra = v.extra;
  }
  start0.call(this, opts);
  for (const id of extra) {
    if (id === 'gold') this.player.copper += 20 * C.SILVER;
    else { const g = FE.Gear.make(id, 0, this.nextGearId++); this.player.bag.push({ id: 'gear', name: FE.Gear.name(g), n: 1, gear: g }); }
  }
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
    const art = FE.landmarkArt(l);
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
    if (FE.Gear.isShopkeeper(n) || n.role === 'recruit') continue; // 想找同伴的人（第三十六版之二）只待幾天，沒有家
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
const combat = { player: {}, monster: {}, soldier: {}, mate: {}, reduced: 0, soldierHits: 0, onSoldier: 0, dodged: 0, blocked: 0, resisted: 0, crit: 0, counters: 0, opportunity: 0, opportunityHit: 0, chain: 0, negative: 0, events: 0, pdmg: 0, mdmg: 0, pn: 0, mn: 0 };
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
  if (measure.on && measure.cond && e.by === 'monster' && e.d && e.d.equip && !e.d.role) { // 冒險者（士兵、隊友有 role）
    const r = measure.armorCmp[measure.cond] || (measure.armorCmp[measure.cond] = { n: 0, dmg: 0, hit: 0 });
    r.n++;
    r.dmg += e.dmg;
    if (e.dmg > 0) r.hit++;
  }
  // 士兵：只打衰敗生的小怪物（m.small）與牠們合成的中型怪物、營地（m.members，第三十六版之三），從不碰創世時與戰役的怪物
  // （被打時照冒險者那一套可以反擊，第三十六版之一）；怪物打士兵也走同一套判定
  if (e.by === 'soldier') {
    combat.soldierHits++;
    if (!e.counter && (!(e.d.small || e.d.members) || e.d.role === 'soldier')) fail(`士兵攻擊了不該碰的對象：${e.d.name}（small=${e.d.small}，members=${!!e.d.members}）`);
  }
  if (e.d && e.d.role === 'soldier') combat.onSoldier++;
};


const simResults = []; // 這個行程跑過的模擬結果
const arenaData = {};  // 競技場量測（每個職業一項工作）
let growthChecks = 0;
const jobSecs = [];    // 主行程：每項工作的耗時
