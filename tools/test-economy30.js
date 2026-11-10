// 第三十版的場景檢查：時間與經濟
// ---- 第三十版：時間與經濟（時鐘、休息、生活開支、經濟值、貨幣、採藥採礦委託、四種委託、世界裡的人的種族、力竭）----
let econChecks = 0;
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

  // 2. 怪物、士兵、事件照同一個時鐘：每 6 刻世界一回合（怪物、士兵各動一次；第三十六版之一，原本 10 刻），每 100 刻演算一次事件
  {
    const g = newGame(301);
    const ev = counter(FE.Events, 'tick');
    const wt = counter(FE.AI, 'worldTurn');
    const stt = counter(FE.AI, 'soldierTurn');
    const t0 = g.ticks;
    for (let i = 0; i < 37; i++) g.endTurn(false, 6, { exact: true });
    ok(g.ticks - t0 === 222 && wt.n === 37 && stt.n === 37, `222 刻：世界 ${wt.n} 回合、士兵 ${stt.n} 次（應該各 37）`);
    ok(ev.n === Math.floor(g.ticks / 100) - Math.floor(t0 / 100), `222 刻演算事件 ${ev.n} 次（應該每 100 刻一次）`);
    // 一個動作 25 刻（例如重甲走一步）：刻數累積，湊滿 6 刻就多動一次
    const w0 = wt.n;
    for (let i = 0; i < 4; i++) g.endTurn(false, 25, { exact: true });
    ok(wt.n - w0 === 16, `4 個 25 刻的動作，世界該走 16 回合，走了 ${wt.n - w0}`);
    ev.restore(); wt.restore(); stt.restore();
  }

  // 3. 野外短休：1 小時（100 刻，世界跑約 16 回合），回 1d10＋體質修正值，不花錢；旁邊有怪物不能休息；途中怪物貼上來就被打斷
  {
    const g = newGame(302);
    const p = g.player;
    const at = fieldSpot(g);
    Object.assign(p, { x: at.x, y: at.y, hp: 1, copper: 500 });
    const wt = counter(FE.AI, 'worldTurn');
    const t0 = g.ticks;
    g.rest();
    ok(g.ticks - t0 === 100 && wt.n >= 16 && wt.n <= 17 && p.copper === 500 && p.hp > 1 && p.hp <= 1 + 10, `短休：${g.ticks - t0} 刻、世界 ${wt.n} 回合、錢 ${p.copper}、生命 ${p.hp}`);
    wt.restore();
    // 旁邊有怪物：不能休息、不花時間
    const side = DIRS.find(([dx, dy]) => g.world.passable(p.x + dx, p.y + dy) && g.world.heightOk(p.x, p.y, p.x + dx, p.y + dy) && !g.world.npcAt(p.x + dx, p.y + dy));
    const m = g.spawnMonster({ type: 'DECAY', x: p.x + side[0], y: p.y + side[1], cells: [], scope: 2, data: {} });
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
      // 種族固定哥布林：上面挑位置時的視線用感知修正值 0 算，照環境隨機套的種族感知不一樣，可能看不到冒險者、不追上來（第三十三版之三（三））
      const c = g.spawnMonster({ type: 'DECAY', x: spot.x, y: spot.y, cells: [], scope: 2, data: {}, race: 'goblin' });
      Object.assign(c, { x: spot.x, y: spot.y, small: true });
      p.hp = 5;
      const t2 = g.ticks;
      g.rest();
      ok(g.ticks - t2 < 100 && /休息被怪物打斷/.test(g.log.map((l) => l.text).join('|')), `怪物追上來，短休該被打斷（花了 ${g.ticks - t2} 刻）`);
    }
  }

  // 4. 村莊長休：8 小時（800 刻，世界跑約 133 回合），生命回滿，照經濟標籤付生活開支，得到生活水準的效果
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
      p.equip.pick = FE.Gear.make('pick', 0, g.nextGearId++);
      p.equip.pick.dur = 10;
      p.equip.sickle = FE.Gear.make('sickle', 0, g.nextGearId++);
      p.equip.sickle.dur = 10;
      p.exhaust = 4;
      const wt = counter(FE.AI, 'worldTurn');
      const t0 = g.ticks;
      g.rest();
      wt.restore();
      const paid = 1000 - p.copper;
      tiers.push(paid);
      const rep = Math.round(200 * C.LIVING_REPAIR[tier]);
      ok(g.ticks - t0 === 800 && wt.n >= 133 && wt.n <= 134 && p.hp === p.maxHp, `長休：${g.ticks - t0} 刻、世界 ${wt.n} 回合、生命 ${p.hp}/${p.maxHp}`);
      const toolRep = C.LIVING_REPAIR[tier] ? Math.max(1, Math.round(50 * C.LIVING_REPAIR[tier])) : 0;
      ok(paid === C.LIVING_COST[tier] * 10 && p.equip.main.dur === 100 + rep && p.equip.pick.dur === 10 + toolRep && p.equip.sickle.dur === 10 + toolRep, `${FE.PROSPERITY[tier]}：付了 ${paid} 銅（應該 ${C.LIVING_COST[tier]} 銀）、長劍耐久 ${p.equip.main.dur}（應該 ${100 + rep}）、採集工具耐久 ${p.equip.pick.dur}/${p.equip.sickle.dur}`);
      ok(p.exhaust === 4 - C.LIVING_EXHAUSTION[tier], `${FE.PROSPERITY[tier]}長休後力竭 ${p.exhaust}（應該 ${4 - C.LIVING_EXHAUSTION[tier]}）`);
      ok(tier < 2 ? !p.lodging : p.lodging && p.lodging.villageId === v.id && p.lodging.bonus === C.LIVING_QUEST[tier], `${FE.PROSPERITY[tier]} 的委託獎勵加成 ${JSON.stringify(p.lodging)}`);
    }
    ok(tiers.join() === '10,30,50,100,300', `生活開支（銅）${tiers}`);
    // 錢不夠：降到荒蕪生活，付得出多少付多少（最多 1 銀）
    v.steading.prosperity = 2; v.econ = 50;
    for (const [have, pay] of [[40, 10], [12, 10], [0, 0]]) {
      p.copper = have;
      p.hp = 1;
      p.equip.main.dur = 100;
      p.exhaust = 3;
      g.rest();
      ok(have - p.copper === pay && p.equip.main.dur === 100 && !p.lodging && p.hp === p.maxHp && p.exhaust === 2, `普通的聚落錢只有 ${have} 銅：付了 ${have - p.copper}（應該 ${pay}），耐久 ${p.equip.main.dur}、力竭 ${p.exhaust}、加成 ${JSON.stringify(p.lodging)}`);
    }
    // 住宿加成：普通 +5% 只加在這個聚落的委託上
    p.copper = 1000;
    g.rest();
    const q = { copper: 200 };
    const base = Math.round(200 * FE.Steading.questEcon(v));
    ok(g.questPay(q, v.id) === Math.round(200 * FE.Steading.questEcon(v) * 1.05) && g.questPay(q, -1) === 200, `住宿加成：這裡 ${g.questPay(q, v.id)}（不加是 ${base}）、別處 ${g.questPay(q, -1)}`);
  }

  // 5. 倒下在聚落醒來也算一次長休（世界跑約 133 回合），不收錢
  {
    const g = newGame(304);
    const p = g.player;
    const at = fieldSpot(g);
    Object.assign(p, { x: at.x, y: at.y, copper: 777, exhaust: 2 });
    const m = g.spawnMonster({ type: 'DECAY', x: at.x + 30, y: at.y, cells: [], scope: 2, data: {} });
    const wt = counter(FE.AI, 'worldTurn');
    const t0 = g.ticks;
    g.die(m);
    g.endTurn(false);
    wt.restore();
    ok(g.world.villageAt(p.x, p.y) && p.hp === p.maxHp && p.copper === 777 && p.exhaust === 1 && g.ticks - t0 >= 800 && wt.n >= 133, `倒下醒來：在聚落 ${!!g.world.villageAt(p.x, p.y)}、生命 ${p.hp}/${p.maxHp}、錢 ${p.copper}、力竭 ${p.exhaust}、過了 ${g.ticks - t0} 刻、世界 ${wt.n} 回合`);
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
    for (const [x, y] of spots.slice(0, 12)) { const m = g.spawnMonster({ type: 'DECAY', x, y, cells: [], scope: 2, data: {} }); Object.assign(m, { x, y }); }
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
    const spawn0 = g.spawnMonster;
    g.spawnMonster = () => null; // 跨過整點時衰敗可能生出新怪物，這裡只量日子，先關掉
    g.endTurn(false, 10, { exact: true });
    ok(FE.Steading.econ(v) === 50 - nOld * C.ECON_MONSTER, `跨過一天扣 ${50 - FE.Steading.econ(v)}（應該 ${nOld}）`);
    g.endTurn(false, 10, { exact: true });
    ok(FE.Steading.econ(v) === 50 - nOld * C.ECON_MONSTER, '同一天不該再扣');
    g.spawnMonster = spawn0;
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
      const m = g.spawnMonster({ type: 'DECAY', x: p.x + 40, y: p.y, cells: [], scope: 2, data: {} });
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
      for (const o of g.world.npcs) { cnt[o.race]++; n++; } // 士兵與隊友的種族照職業套版（第三十六版之一），不在這個比例裡
      for (const o of g.soldiers) if (!o.race || !FE.PLAYER_RACES[o.race]) fail('時間與經濟 士兵沒有種族');
    }
    ok(n > 200 && Object.values(cnt).reduce((a, b) => a + b, 0) === n, `每個人都該有種族（${n} 人：${JSON.stringify(cnt)}）`);
    ok(Math.abs(cnt.human / n - 0.7) < 0.07 && Math.abs(cnt.dwarf / n - 0.15) < 0.05 && Math.abs(cnt.elf / n - 0.15) < 0.05, `種族比例 人類 ${(cnt.human / n).toFixed(2)}、矮人 ${(cnt.dwarf / n).toFixed(2)}、精靈 ${(cnt.elf / n).toFixed(2)}`);
    const g = newGame(309);
    const n0 = g.world.npcs[0];
    ok(g.talkOptions(n0).role.endsWith(FE.PLAYER_RACES[n0.race].name), `對話視窗的身分 ${g.talkOptions(n0).role}`);
  }

  // 11. 力竭：連續一整天沒有長休 +1 級；長休 −1 級；出手的 d20 −2×級數，走路照《D&D》速度每級少 5 呎換算；6 級倒下，醒來降到 5 級再照長休 −1
  {
    const g = newGame(310);
    const p = g.player;
    const at = fieldSpot(g);
    Object.assign(p, { x: at.x, y: at.y });
    p.awakeAt = g.ticks - (C.DAY_TICKS - 5);
    g.endTurn(false, 10, { exact: true });
    ok(p.exhaust === 1 && /一整天沒好好睡/.test(g.log.map((l) => l.text).join('|')), `一整天沒長休：力竭 ${p.exhaust}`);
    // 走一步多花的刻
    const free = DIRS.find(([dx, dy]) => g.world.passable(p.x + dx, p.y + dy) && g.world.heightOk(p.x, p.y, p.x + dx, p.y + dy) && !g.world.npcAt(p.x + dx, p.y + dy));
    const step = (lv) => { p.exhaust = lv; p.awakeAt = g.ticks; const t0 = g.ticks; g.move(free[0], free[1]); g.move(-free[0], -free[1]); return (g.ticks - t0) / 2; };
    const s0 = step(0), s1 = step(1), s3 = step(3);
    ok(s1 === Math.round(s0 * 1.2) && s3 === s0 * 2, `力竭照速度換算：0 級 ${s0}、1 級 ${s1}（應該 ${Math.round(s0 * 1.2)}）、3 級 ${s3}（應該 ${s0 * 2}）刻`);
    // 耐久：一半以下磨損（−1、名稱加 x），四分之一以下破損（−2、加 X）
    const sw = FE.Gear.make('sword', 0, 900);
    sw.dur = sw.max; const n0 = FE.Gear.name(sw), w0 = FE.Gear.wearPenalty(sw);
    sw.dur = Math.floor(sw.max * 0.4); const n1 = FE.Gear.name(sw), w1 = FE.Gear.wearPenalty(sw);
    sw.dur = Math.floor(sw.max * 0.2); const n2 = FE.Gear.name(sw), w2 = FE.Gear.wearPenalty(sw);
    ok(w0 === 0 && w1 === 1 && w2 === 2 && n0 === '長劍' && n1 === 'x長劍x' && n2 === 'X長劍X', `耐久懲罰 ${w0}/${w1}/${w2}、名稱 ${n0}/${n1}/${n2}`);
    p.exhaust = 0;
    // 聚落生活水準決定長休降低幾級
    g.wakeSpot();
    p.exhaust = 3; p.copper = 1000;
    const village = g.world.villageAt(p.x, p.y);
    g.rest();
    ok(p.exhaust === 3 - C.LIVING_EXHAUSTION[village.steading.prosperity] && p.awakeAt === g.ticks, `長休後力竭 ${p.exhaust}（聚落標籤 ${FE.PROSPERITY[village.steading.prosperity]}）`);
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
      const m = g.spawnMonster({ type: 'DECAY', x: p.x + free[0], y: p.y + free[1], cells: [], scope: 2, data: {} });
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

  // 12. 侵蝕拿掉了（第三十三版之三）：怪物放著、冒險者長休一晚（800 刻，含整點的事件），地面的生態區與高度一格都沒變，
  // 也沒有因此生出新的怪物（怪物只從負的穩定值生，離冒險者至少 DECAY_MIN_DIST 步）
  {
    let changed = 0, spawned = 0, nights = 0;
    for (let s = 0; s < 12; s++) {
      const g = new FE.Game(6100 + s);
      g.start();
      g.checkCreate = () => {};
      g.wakeSpot();
      g.worldState = 0;
      const p = g.player;
      // 放 4 隻怪物在冒險者 20 步內、聚落周圍的圈外（不追人，只徘徊）
      g.monsters = [];
      for (const ch of g.world.chunks) { ch.stab.fill(240); ch.debt = 0; }
      g.world.debt = 0;
      const spots = [];
      for (let dy = -20; dy <= 20; dy++) for (let dx = -20; dx <= 20; dx++) {
        const x = p.x + dx, y = p.y + dy;
        if (Math.abs(dx) + Math.abs(dy) <= 18 && g.world.passable(x, y) && !g.world.inBuffer(x, y) && !g.world.villageAt(x, y)) spots.push([x, y]);
      }
      const rr = FE.makeRng(s + 9);
      for (let k = 0; k < 4 && spots.length; k++) {
        const [x, y] = spots.splice(Math.floor(rr() * spots.length), 1)[0];
        const m = g.spawnMonster({ type: 'DECAY', x, y, cells: [], scope: 2, data: {} });
        if (m) Object.assign(m, { x, y, home: { x, y } });
      }
      if (!g.monsters.length) continue;
      const snap = () => g.world.chunks.map((chk) => chk.cells.map((row) => row.map((c) => c.biome + c.h + c.t).join()).join('|')).join('#');
      const before = snap();
      const n0 = g.monsters.length;
      p.copper = 1000;
      g.rest();
      nights++;
      if (snap() !== before) changed++;
      spawned += g.monsters.length - n0;
    }
    ok(nights >= 8 && changed === 0, `長休一晚地面不該變：${nights} 晚裡有 ${changed} 晚地面變了`);
    ok(spawned === 0, `穩定值都還是正的，長休一晚不該生出新的怪物（生了 ${spawned} 隻）`);
  }
}
UNITS.economy30 = () => { try { testEconomy30(); } catch (e) { fail('時間與經濟測試拋出例外：' + e.stack); } };
