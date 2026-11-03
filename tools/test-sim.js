// 機器人模擬：機器人的裝備、加點、走路、買賣、對話，單人與四人等效模擬
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
// 單人模擬：每個職業每個種子各一場；四人等效模擬：每個職業一場，種子輪流用（見 test.js 的 buildJobs）
// 四人等效：機器人每做 4 個動作，世界才走 1 回合（冒險者算力照常，已乘 PLAYER_COMPUTE_SCALE）
const MAX_ACTIONS = Number(process.env.FE_MAX || 8000);
// 四人等效：機器人每做 4 個動作世界才走 1 回合（四個人的清怪力），每個動作的算力不乘 4（四個人各出一份，一回合合計 4 份）
// 四人等效的模擬每次創世也跟舊的全世界檢查比對（這時的地形被侵蝕、修復、重算改過，驗證連通性快取有跟著更新）；
// 第二十九版起新舊比對只在一個種子上跑（第一個職業的第一個種子）
// 防具對照組：同樣的種子、同樣的動作數，一組不穿防具、一組穿重甲（都不拿盾牌），看冒險者平均每下受到多少傷害
const SIM_CMP_STEPS = Number(process.env.FE_CMP || 1500);

