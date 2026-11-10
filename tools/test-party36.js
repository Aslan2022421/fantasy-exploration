// 第三十六版之一（V36.1）的場景檢查：時鐘 6 刻、隱形人口數、士兵的職業套版與補員、隊友（招募、跟隨、跟著升級、自動戰鬥、Tab 切換操作、陣亡）、商人
let partyChecks = 0;
function testParty36() {
  const ok = (cond, msg) => { partyChecks++; if (!cond) fail('第三十六版之一 ' + msg); };
  useClasses('new');
  const Ch = FE.Char;
  const dist = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  const hook0 = FE.Combat.hook;

  // 一塊整平的空地（聚落圈外，半徑 r），冒險者站中間；回傳 { g, c }
  function field(seed, cls, r) {
    r = r || 14;
    const g = new FE.Game(seed);
    g.start(cls ? { cls, picks: FE.Char.defaultPicks(cls) } : { cls: 'warrior', picks: ['sword', 'medium', 'shield', 'herb'] });
    g.checkCreate = () => {};
    g.monsters = [];
    g.soldiers = [];
    const w = g.world;
    let spot = null;
    w.forEachCell((x, y) => {
      if (spot || w.inBuffer(x, y) || !w.passable(x, y) || !w.inBounds(x - r, y - r) || !w.inBounds(x + r, y + r)) return;
      for (let dy = -r; dy <= r; dy += 4) for (let dx = -r; dx <= r; dx += 4) if (w.inBuffer(x + dx, y + dy)) return;
      spot = { x, y };
    });
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { w.setCell(spot.x + dx, spot.y + dy, '.', 'plain'); w.setHeight(spot.x + dx, spot.y + dy, 0); }
    w.chests = [];
    w.nodes = [];
    Object.assign(g.player, { x: spot.x, y: spot.y });
    g.player.hp = g.player.maxHp = 1e6;
    return { g, c: spot };
  }
  const mon = (g, x, y, opts) => {
    const m = FE.dressMonster(FE.makeMonster({ type: 'DECAY', x, y, cells: [], scope: 2, data: {} }, 9000 + g.monsters.length, 1), g.world);
    Object.assign(m, { home: { x, y }, small: false, hp: 60, maxHp: 60, ac: 8, toHit: 0, die: [1, 2], dmgBonus: 0, race: 'goblin' }, opts || {});
    g.monsters.push(m);
    return m;
  };
  // 隊友：照職業套版建一位，放在 (x, y)，來自這個世界的第一個聚落
  const addMate = (g, cls, x, y, lv) => {
    const v = g.world.villages[0];
    const m = Ch.makeLevelChar(g, cls, lv || 5, 1, '隊友' + (g.mates.length + 1));
    Object.assign(m, { id: g.world.nextId++, role: 'mate', villageId: v.id, x, y });
    m.hp = m.maxHp = 1e5;
    g.mates.push(m);
    return m;
  };

  // ---- 1. 時鐘：走一格 6 刻，其他刻數 ×0.6；所有人一樣 ----
  function clock() {
    ok(C.TICKS_MOVE === 6 && C.MOVE_TICKS_MIN === 5 && C.ATTACK_TICKS.light === 5 && C.ATTACK_TICKS.normal === 6 && C.ATTACK_TICKS.heavy === 7 && C.ATTACK_TICKS_MIN === 4 && C.OVER_MOVE_TICKS === 36 && C.STR_REQ_TICKS === 9 && C.DUAL_TICKS === 3, '刻數：走 6、敏捷最少 5、攻擊 5／6／7 最少 4、超重 36、力量不到 9、雙持 3');
    ok(C.HOUR_TICKS === 100 && C.DAY_TICKS === 2400 && C.SHORT_REST_TICKS === 100 && C.LONG_REST_TICKS === 800 && C.EVENT_TICKS === 100, '一小時 100 刻、一天 2,400 刻、休息與事件時間不變');
    ok(Math.round(10 * 0.6) === C.TICKS_MOVE && Math.round(8 * 0.6) === C.MOVE_TICKS_MIN && Math.round(60 * 0.6) === C.OVER_MOVE_TICKS && Math.round(15 * 0.6) === C.STR_REQ_TICKS && Math.round(5 * 0.6) === C.DUAL_TICKS, '刻數照 ×0.6');
    // 世界每 6 刻走一回合：怪物、士兵、隊友各動一次
    const { g, c } = field(36001);
    addMate(g, 'warrior', c.x + 1, c.y);
    const n = { w: 0, s: 0, p: 0 };
    const w0 = FE.AI.worldTurn, s0 = FE.AI.soldierTurn, p0 = FE.AI.partyTurn;
    FE.AI.worldTurn = (gg) => { n.w++; return w0(gg); };
    FE.AI.soldierTurn = (gg) => { n.s++; return s0(gg); };
    FE.AI.partyTurn = (gg) => { n.p++; return p0(gg); };
    g.tickAcc = 0;
    g.advance(60);
    FE.AI.worldTurn = w0; FE.AI.soldierTurn = s0; FE.AI.partyTurn = p0;
    ok(n.w === 10 && n.s === 10 && n.p === 10, `60 刻世界該走 10 回合（怪物、士兵、隊友各 10 次）：${n.w}／${n.s}／${n.p}`);
    // 隊友走一格也是 6 刻：他自己每個世界回合動一次
    const m = addMate(g, 'warrior', c.x + 10, c.y);
    const x0 = m.x;
    g.advance(6);
    ok(m.x === x0 - 1, `隊友每 6 刻走一格：${x0} → ${m.x}`);
  }

  // ---- 2. 隱形人口數 ----
  function population() {
    const { g } = field(36002);
    // 範圍：村莊 40～120、城鎮 150～400、堡壘 80～150，要塞、城市各是兩倍；人口標籤把範圍分成五段
    const R = { village: [40, 120], town: [150, 400], fort: [80, 150], fortress: [160, 300], city: [300, 800] };
    ok(Object.keys(R).every((k) => C.POP_RANGE[k][0] === R[k][0] && C.POP_RANGE[k][1] === R[k][1]), '人口範圍');
    ok(C.POP_RATE.join() === '-0.02,-0.01,0,0.01,0.02', '每天增減的比例');
    let bad = '';
    const mean = {};
    for (const kind of Object.keys(R)) {
      for (let tag = 0; tag <= 4; tag++) {
        const [lo, hi] = R[kind];
        const a = lo + ((hi - lo) * tag) / 5;
        const b = lo + ((hi - lo) * (tag + 1)) / 5;
        let sum = 0;
        for (let id = 1000; id < 1060; id++) {
          const v = { id, kind, steading: { population: tag } };
          const p = g.initPop(v);
          sum += p;
          if (p < Math.round(a) || p > Math.round(b)) bad = `${kind} 標籤 ${tag} 人口 ${p} 不在 ${a}～${b}`;
        }
        mean[kind + tag] = sum / 60;
      }
      ok(mean[kind + '0'] < mean[kind + '2'] && mean[kind + '2'] < mean[kind + '4'], `${kind} 的人口標籤越高人口越多`);
    }
    ok(!bad, `人口落在範圍裡標籤那一段：${bad}`);
    // 同一個聚落擲過就記著
    const v1 = { id: 1001, kind: 'town', steading: { population: 3 } };
    ok(g.initPop(v1) === g.initPop(v1), '人口擲過就記著');
    // 每天增減：照標籤（大舉遷出 −2%、縮減 −1%、穩定 0、成長 +1%、急速發展 +2%），取整，不超出範圍的上限、不少過有名字的人
    const v = g.world.villages[0];
    const named = g.namedCount(v);
    const day = (tag, pop) => { v.steading.population = tag; v.pop = pop; g.popDay(); return v.pop; };
    ok(day(4, 100) === 102 && day(3, 100) === 101 && day(2, 100) === 100 && day(1, 100) === 99 && day(0, 100) === 98, `每天增減：${[4, 3, 2, 1, 0].map((t) => day(t, 100))}`);
    ok(day(4, 120) === 120 && day(4, 119) === 120, '人口不超出範圍的上限');
    ok(day(0, named) === named && day(0, named + 1) >= named, '人口不低於有名字的人數');
    // 死一個少一個（不補回）：士兵與隊友陣亡
    const t = field(36003);
    const gt = t.g;
    const vt = gt.world.villages[0];
    gt.initPop(vt);
    vt.pop = gt.namedCount(vt) + 30;
    const s = FE.Char.makeLevelChar(gt, 'warrior', 1, 1, '兵');
    Object.assign(s, { id: 99001, role: 'soldier', villageId: vt.id, x: vt.cx, y: vt.cy, wl: 1 });
    gt.soldiers.push(s);
    const p0 = vt.pop;
    gt.soldierDown(s, null);
    ok(vt.pop === p0 - 1 && gt.history[0].kind === 'death' && gt.history[0].role === '士兵', `士兵陣亡人口 −1：${p0} → ${vt.pop}`);
  }

  // ---- 3. 士兵：職業套版、補員 ----
  function soldiers() {
    const { g, c } = field(36004);
    const v = g.world.villages[0];
    v.kind = 'town'; // 借用第一個聚落當城鎮用（只看士兵的規則）
    // 誰有士兵
    ok(g.soldierQuota({ kind: 'town' }) === 3 && g.soldierQuota({ kind: 'fort' }) === 3 && g.soldierQuota({ kind: 'city' }) === 6 && g.soldierQuota({ kind: 'fortress' }) === 6 && g.soldierQuota({ kind: 'village' }) === 0, '士兵名額：城鎮、堡壘 3，城市、要塞 6，村莊 0');
    // 等級＝1＋（世界等級－1）×2
    ok([1, 2, 3, 4, 5].map(FE.soldierLevel).join() === '1,3,5,7,9', '士兵等級');
    g.initPop(v);
    v.pop = g.namedCount(v) + 500;
    g.world.ringsDone = 3; // 世界等級 4
    const made = [];
    for (let i = 0; i < 60; i++) {
      const s = g.spawnSoldier(v, [v.cx, v.cy]);
      made.push(s);
      g.soldiers = g.soldiers.filter((o) => o !== s);
    }
    const classes = new Set(made.map((s) => s.cls));
    ok(classes.size >= 5, `士兵的職業隨機（60 位裡有 ${classes.size} 種）`);
    ok(made.every((s) => s.lv === 7 && s.role === 'soldier' && s.equip && s.skills && s.attr && s.hp === s.maxHp && s.maxHp === Ch.maxHp(s, 7) && !s.die && !s.toHit), '士兵是職業角色（等級 7、有裝備欄與技能、不用怪物的數值塊）');
    ok(typeof FE.soldierStats === 'undefined', '拿掉以小哥布林為準的士兵數值（soldierStats）');
    // 裝備品質照世界等級（4→精良）
    ok(made.every((s) => FE.Gear.equipped(s).every((e) => e.q === FE.qualityForWL(4))) && FE.qualityForWL(4) === 2, '士兵的裝備品質照世界等級');
    // 屬性、技能、裝備跟 makeLevelChar 同一套
    const s0 = made[0];
    const twin = Ch.makeLevelChar(g, s0.cls, 7, 4, 'x');
    ok(JSON.stringify(twin.attr) === JSON.stringify(s0.attr) && twin.maxHp === s0.maxHp && twin.equip.main.type === s0.equip.main.type, '士兵的屬性、裝備照 makeLevelChar 那一套');
    // 技能（使用者定的）：隨機 5 項、每項至少 1 級、城鎮最高 5 級，一定含主手武器的技能
    const has = (s) => Object.keys(s.skills).filter((k) => s.skills[k].lv > 0);
    ok(made.every((s) => has(s).length === 5 && has(s).every((k) => s.skills[k].lv >= 1 && s.skills[k].lv <= 5) && s.skills[FE.GEAR[s.equip.main.type].skill].lv >= 1), '士兵的技能：隨機 5 項、1～5 級（城鎮）、含主手武器的技能');
    ok(made.some((s) => has(s).some((k) => s.skills[k].lv === 5)) && made.some((s) => has(s).some((k) => s.skills[k].lv === 1)), '士兵的技能等級在 1～5 之間都擲得到');
    v.kind = 'city';
    const cityS = g.spawnSoldier(v, [v.cx, v.cy]);
    g.soldiers = g.soldiers.filter((o) => o !== cityS);
    v.kind = 'town';
    ok(has(cityS).length === 5 && has(cityS).every((k) => cityS.skills[k].lv >= 1 && cityS.skills[k].lv <= 10) && C.SOLDIER_SKILL_CAP.city === 10 && C.SOLDIER_SKILL_CAP.fortress === 10 && C.SOLDIER_SKILL_CAP.fort === 5, '城市、要塞的士兵技能最高 10 級，堡壘 5 級');
    // 士兵出手、挨打照冒險者那一套：怪物打士兵，AC 看防具與敏捷；士兵自己不練技能
    const sol = made.find((s) => s.cls === 'warrior');
    Object.assign(sol, { x: c.x + 4, y: c.y }); // 聚落外的空地（聚落裡不能動手）
    g.soldiers.push(sol);
    const skills0 = JSON.stringify(sol.skills);
    let ev = null;
    FE.Combat.hook = (e) => { if (e.d === sol) ev = e; };
    g.monsters = [];
    const m = mon(g, sol.x + 1, sol.y, { toHit: 100 });
    FE.Combat.resolveAttack(g, m, sol, 'attack', { noCounter: true });
    FE.Combat.hook = hook0;
    ok(ev && ev.ac === FE.Gear.playerAC(sol) && ev.reduced >= 0, `怪物打士兵照角色的 AC：${ev && ev.ac}（應該 ${FE.Gear.playerAC(sol)}）`);
    // 士兵出手：打的是衰敗生的小怪物，不給冒險者經驗值；技能不變
    m.small = true;
    m.hp = 1;
    m.maxHp = 1;
    const exp0 = g.exp;
    FE.Combat.hook = null;
    for (let i = 0; i < 40 && g.monsters.includes(m); i++) FE.AI.charAttack(g, sol, m);
    FE.Combat.hook = hook0;
    ok(!g.monsters.includes(m) && g.exp === exp0, '士兵打倒小怪物，冒險者不拿經驗值');
    ok(JSON.stringify(sol.skills) === skills0, '士兵自己不升級、不練技能');
    g.soldiers = g.soldiers.filter((o) => o !== sol);
    // 補員：缺額每天擲一次，機率照人口標籤（10%、25%、50%、75%、100%），人口歸零就不補
    const quota = 3;
    g.world.ringsDone = 0;
    g.initPop(v);
    for (let tag = 0; tag <= 4; tag++) {
      v.steading.population = tag;
      v.pop = g.namedCount(v) + 10;
      g.soldiers = g.soldiers.filter((s) => s.villageId !== v.id);
      for (let i = 0; i < quota - 1; i++) g.spawnSoldier(v, [v.cx, v.cy]);
      let hit = 0;
      const N = 1500;
      for (let i = 0; i < N; i++) {
        const s = g.refillSoldier(v);
        if (s) {
          hit++;
          g.soldiers = g.soldiers.filter((o) => o !== s);
        }
      }
      const want = C.SOLDIER_REFILL[tag];
      ok(Math.abs(hit / N - want) < 0.045, `${FE.POPULATION[tag]}補員機率 ${(hit / N).toFixed(3)}（應該約 ${want}）`);
    }
    // 人口裡沒有名字的人用完了就不補
    v.steading.population = 4;
    v.pop = g.namedCount(v);
    ok(!g.refillSoldier(v) && !g.spawnSoldier(v, [v.cx, v.cy]), '沒有名字的人用完了不補士兵');
    // 補進來的是新的人：新名字（不跟別的士兵重複）、職業、等級
    v.pop = g.namedCount(v) + 10;
    g.soldiers = g.soldiers.filter((s) => s.villageId !== v.id);
    const ns = [];
    for (let i = 0; i < 3; i++) ns.push(g.spawnSoldier(v, [v.cx, v.cy]));
    ok(new Set(ns.map((s) => s.name)).size === 3 && ns.every((s) => s.hp === s.maxHp), '補進來的士兵是新的人（名字不重複）');
  }

  // ---- 4. 隊友 ----
  function party() {
    // 4a. 招募的條件與結果
    {
      // 第三十六版之二：招募改成生成想找同伴的人（role 'recruit'），士兵不能招
      const { g } = field(36005);
      const v = g.world.villages[0];
      v.kind = 'town';
      v.steading.prosperity = 2;
      g.initPop(v);
      v.pop = g.namedCount(v) + 100;
      for (let i = 0; i < 3; i++) g.spawnSoldier(v, [v.cx + i, v.cy]);
      const h = g.hero;
      // 機率＝種類的基本機率 × 經濟標籤的倍率
      const near = (a, b) => Math.abs(a - b) < 1e-9;
      ok(near(g.recruitChance(v), 0.35), `城鎮、普通：${g.recruitChance(v)}（應該 0.35）`);
      ok(near(g.recruitChance({ kind: 'village', steading: { prosperity: 0 } }), 0.1) && near(g.recruitChance({ kind: 'fortress', steading: { prosperity: 4 } }), 0.75) && near(g.recruitChance({ kind: 'fort', steading: { prosperity: 1 } }), 0.2625), '村莊荒蕪 10%、要塞富裕 75%、堡壘貧窮 26.25%');
      const rng0 = g.rng;
      const always = () => 0;
      g.rng = always;
      ok(g.rollRecruits(v).length === 0, '沒完成委託不會來人');
      h.done = { [v.id]: 4 };
      ok(g.rollRecruits(v).length === 0, '同一個聚落完成 4 件委託還不會來人');
      h.done = { [v.id + 1]: 9 };
      ok(g.rollRecruits(v).length === 0, '別的聚落完成的委託不算（每個聚落各自計數）');
      h.done = { [v.id]: 5 };
      g.rng = () => 0.999;
      ok(g.rollRecruits(v).length === 0, '沒擲中就不會來人');
      g.rng = always;
      const named0 = g.namedCount(v);
      const got = g.rollRecruits(v);
      g.rng = rng0;
      const r = got[0];
      const doorNear = (x, y) => v.buildings.some((b) => b.doors.some(([dx, dy]) => Math.max(Math.abs(dx - x), Math.abs(dy - y)) <= 1));
      ok(got.length >= 1 && r.role === 'recruit' && FE.RECRUIT_BACKGROUNDS[r.bg] && FE.CLASSES[r.cls] && r.until === g.ticks + C.RECRUIT_DAYS * C.DAY_TICKS, `完成 5 件後擲中，來了 ${got.length} 位想找同伴的人（背景 ${r && r.bg}、職業 ${r && r.cls}）`);
      ok(got.every((o) => g.world.villageAt(o.x, o.y) === v && FE.Steading.roomAt(v, o.x, o.y) < 0 && !doorNear(o.x, o.y)), '想找同伴的人站在聚落室外、不貼著門口');
      ok(g.namedCount(v) === named0 + got.length, '想找同伴的人從人口裡取（算有名字的人）');
      for (let i = 0; i < 5; i++) { g.rng = always; g.rollRecruits(v); }
      g.rng = rng0;
      ok(g.recruitsAt(v).length <= C.RECRUIT_MAX.town && C.RECRUIT_MAX.town === 2 && C.RECRUIT_MAX.village === 1 && C.RECRUIT_MAX.fortress === 3, `城鎮同時待著的最多 2 位（現在 ${g.recruitsAt(v).length}）`);
      // 對話：士兵沒有「邀他同行」，想找同伴的人有
      g.level = 6;
      ok(!g.talkOptions(g.soldiers[0]).options.some((o) => o.id === 'recruit'), '士兵不能招');
      const t = g.talkOptions(r);
      ok(t.options.some((o) => o.id === 'recruit' && o.label === '邀他同行' && !o.disabled) && t.role.startsWith(FE.RECRUIT_BACKGROUNDS[r.bg].name + '（') && t.text.includes(v.name), `對話有「邀他同行」，稱呼是背景（${t.role}）`);
      // 邀他同行：等級＝冒險者等級－1，職業、名字不變，從聚落裡離開
      const cls = r.cls, name = r.name;
      g.talking = r.id;
      g.choose(r, t.options.findIndex((o) => o.id === 'recruit'));
      const m1 = g.mates[0];
      ok(g.mates.length === 1 && m1.name === name && m1.cls === cls && m1.role === 'mate' && m1.lv === 5 && m1.villageId === v.id && m1.bg === r.bg, `招到隊友：${g.mates.map((m) => `${m.name} Lv${m.lv} ${m.cls}`)}`);
      ok(!g.world.npcs.includes(r) && g.soldiers.filter((o) => o.villageId === v.id).length === 3, '招到的人離開聚落，士兵名額不受影響');
      const lvs = Object.values(m1.skills).map((x) => (x && x.lv) || 0).filter((x) => x > 0);
      ok(m1.equip && m1.skills && m1.hp === m1.maxHp && lvs.length === 5 && lvs.every((x) => x <= C.SOLDIER_SKILL_CAP.town), `隊友是職業角色，技能 ${lvs.length} 項（${lvs}）、不超過城鎮上限 ${C.SOLDIER_SKILL_CAP.town}`);
      // 等級最少 1
      g.level = 1;
      const spawnOne = () => { g.rng = always; g.world.npcs = g.world.npcs.filter((o) => !(o.role === 'recruit' && o.villageId === v.id)); const x = g.rollRecruits(v)[0]; g.rng = rng0; return x; };
      const m2 = g.recruit(spawnOne());
      ok(m2 && m2.lv === 1, `冒險者 1 級時隊友 ${m2 && m2.lv} 級（最少 1）`);
      // 上限 3 位
      g.recruit(spawnOne());
      const r4 = spawnOne();
      const t4 = g.talkOptions(r4);
      ok(g.mates.length === 3 && !g.canRecruit(r4) && g.recruit(r4) === null && t4.options.find((o) => o.id === 'recruit').disabled, '隊伍最多 3 位隊友（滿了「邀他同行」灰掉）');
      // 待滿 7 天沒被招就離開；人口不變
      const pop0 = v.pop;
      g.ticks = r4.until;
      g.recruitDay(v);
      ok(!g.world.npcs.includes(r4) && v.pop === pop0, '想找同伴的人 7 天後離開聚落（人口不變）');
      // 神聖聚落比較常是牧師（權重 3，其他 1）
      const holy0 = FE.Steading.isHoly;
      FE.Steading.isHoly = () => true;
      let pri = 0;
      const N = 1200;
      v.pop = 1e6;
      for (let i = 0; i < N; i++) { const x = g.spawnRecruit(v); if (x) { if (x.cls === 'priest') pri++; g.world.npcs = g.world.npcs.filter((o) => o !== x); } }
      FE.Steading.isHoly = holy0;
      const nCls = Object.keys(FE.TEMPLATE_PICKS).filter((k) => FE.CLASSES[k]).length;
      const want = C.RECRUIT_HOLY_PRIEST / (C.RECRUIT_HOLY_PRIEST + nCls - 1);
      ok(Math.abs(pri / N - want) < 0.05, `神聖聚落的牧師比例 ${(pri / N).toFixed(3)}（應該約 ${want.toFixed(3)}）`);
      // 委託不會發給想找同伴的人，也不會指定他們當收貨人
      const r5 = spawnOne();
      r5.quest = null;
      ok(g.world.npcs.filter((n) => n.role === 'recruit').every((n) => !n.quest), '想找同伴的人身上沒有委託');
      // 隊友跟著升級：冒險者每升一級，隊友升一級（生命照職業加、屬性點照主屬性與體質輪流）
      g.level = 5;
      g.mates = g.mates.map((m) => Object.assign(Ch.makeLevelChar(g, m.cls, 4, 1, m.name), { id: m.id, role: 'mate', villageId: m.villageId, x: m.x, y: m.y }));
      const mm = g.mates[0];
      const hp0 = mm.maxHp;
      g.exp = FE.levelExp(5);
      g.addExp(FE.levelExp(6) - g.exp);
      ok(g.level === 6 && g.mates.every((m) => m.lv === 5), `冒險者升到 6 級，隊友跟著升到 5 級：${g.mates.map((m) => m.lv)}`);
      ok(mm.maxHp > hp0 && mm.hp === mm.maxHp && mm.maxHp === Ch.maxHp(mm, 5), `隊友升級生命上限增加（${hp0} → ${mm.maxHp}），照職業算法`);
      // 隊友的屬性點：到了 8 級才有 1 點（第三十六版之三：留給玩家在角色視窗裡加，不自動分配）
      g.level = 8;
      g.mates = g.mates.map((m) => Object.assign(Ch.makeLevelChar(g, m.cls, 7, 1, m.name), { id: m.id, role: 'mate', villageId: m.villageId, x: m.x, y: m.y }));
      const attrSum = (a) => FE.ATTRS.reduce((s, x) => s + a[x.key], 0);
      const before = g.mates.map((m) => attrSum(m.attr));
      g.exp = FE.levelExp(9) - 1;
      g.addExp(1);
      ok(g.level === 9 && g.mates.every((m, i) => m.lv === 8 && attrSum(m.attr) === before[i] && m.points === 1), `8 級多 1 點屬性、留著給玩家加：${g.mates.map((m) => `點數 ${m.points}`)}`);
      ok(/有 1 點屬性可以加/.test(g.log.slice(0, 8).map((x) => x.text).join('')), '隊友升級時提示有點數可以加');
      // 玩家替隊友加：加體質生命上限跟著重算；沒點數、別人的隊友、到上限都不能加
      const mp = g.mates[0];
      const con0 = mp.attr.con, hpMax0 = mp.maxHp;
      ok(g.spendMatePoint(mp, 'con') && mp.attr.con === con0 + 1 && mp.points === 0 && mp.maxHp === Ch.maxHp(mp, mp.lv), `替隊友加體質：${con0} → ${mp.attr.con}，生命上限 ${hpMax0} → ${mp.maxHp}`);
      ok(!g.spendMatePoint(mp, 'str'), '沒點數就不能加');
      ok(!g.spendMatePoint({ points: 1, attr: { str: 10 } }, 'str'), '不是隊友就不能加');
      const m2p = g.mates[1];
      m2p.attr.str = C.ATTR_CAP;
      ok(!g.spendMatePoint(m2p, 'str') && m2p.points === 1, '到上限的屬性不能加，點數留著');
      // 第三十六版之二：村莊沒有士兵，但招得到人（基本機率 20%）
      ok(g.soldierQuota({ kind: 'village' }) === 0 && C.RECRUIT_BASE.village === 0.2, '村莊沒有士兵，但想找同伴的人照樣會來');
    }

    // 4b. 跟隨：平常自動跟在操作的那位身邊 2～3 格內
    {
      const { g, c } = field(36006);
      const m = addMate(g, 'warrior', c.x + 11, c.y + 3);
      g.advance(6 * 30);
      ok(dist(m, g.player) <= 3, `隊友跟了過來：離 ${dist(m, g.player)} 格`);
      g.player.x = c.x - 10;
      g.advance(6 * 40);
      ok(dist(m, g.player) <= 3 && dist(m, g.player) >= 1, `冒險者走遠，隊友再跟上：離 ${dist(m, g.player)} 格`);
      // 不進建築、不踩寶箱
      ok(!g.world.chestAt(m.x, m.y), '隊友沒有踩上寶箱');
    }

    // 4c. 自動戰鬥：近戰貼上去打、遠程站開射、牧師治療生命最低的隊員；怪物也打隊友
    {
      const { g, c } = field(36007);
      const warrior = addMate(g, 'warrior', c.x + 2, c.y);
      const m = mon(g, c.x + 5, c.y);
      const evs = [];
      FE.Combat.hook = (e) => { if (e.by === 'mate') evs.push(e); };
      // 第三十六版之四：看到但沒跟隊伍交戰、也不是冒險者目標的怪物，隊友不去打
      g.advance(6 * 20);
      ok(evs.length === 0 && dist(warrior, m) > 1, `隊友不主動衝去打沒交戰的怪物（出手 ${evs.length} 下，離怪物 ${dist(warrior, m)} 格）`);
      g.battle.targetId = m.id; // 冒險者把牠設成目標：隊友一起打
      const exp0 = g.exp, cr0 = g.creation;
      m.exp = 7;
      g.advance(6 * 60);
      FE.Combat.hook = hook0;
      ok(evs.length > 0 && evs.every((e) => e.a === warrior), `近戰隊友自動打怪（${evs.length} 下）`);
      ok(!g.monsters.includes(m) ? g.exp > exp0 && g.creation >= cr0 : m.hp < m.maxHp, '隊友打倒怪物，經驗值照冒險者打倒的算');
      ok(JSON.stringify(Object.values(warrior.skills).map((s) => s.lv + ':' + s.n)) !== JSON.stringify(Object.values(Ch.makeLevelChar(g, 'warrior', 5, 1, 'x').skills).map((s) => s.lv + ':' + s.n)), '隊友技能照用照練');
    }
    {
      const { g, c } = field(36008, 'ranger');
      const ranger = addMate(g, 'ranger', c.x, c.y + 1);
      const m = mon(g, c.x + 4, c.y + 1);
      const arrows0 = ranger.bag.find((e) => e.id === 'arrow').n;
      const hero0 = g.hero.bag.length;
      g.battle.targetId = m.id; // 第三十六版之四：冒險者的目標才射（或貼著隊伍的怪物）
      const rx = ranger.x, ry = ranger.y;
      g.advance(6 * 8);
      // 怪物被射之後會朝冒險者走過來，最後可能貼著隊伍；要看的是隊友自己沒走過去、一直用射的
      ok(m.hp < m.maxHp && ranger.bag.find((e) => e.id === 'arrow').n < arrows0 && ranger.x === rx && ranger.y === ry, `遠程隊友站著射：怪物 ${m.hp}/${m.maxHp}、箭 ${ranger.bag.find((e) => e.id === 'arrow').n}、隊友沒移動`);
      ok(g.hero.bag.length === hero0, '隊友用自己背包的箭，不動冒險者的');
    }
    {
      const { g, c } = field(36009);
      g.player.maxHp = 30;
      g.player.hp = 3;
      const priest = addMate(g, 'priest', c.x + 1, c.y);
      priest.hp = priest.maxHp = 40;
      g.advance(6 * 3);
      ok(g.hero.hp > 3, `牧師隊友治療生命最低的隊員：冒險者 ${g.hero.hp}/30`);
      ok(priest.cd && priest.cd.healCd >= 0, '牧師隊友有自己的治療冷卻');
    }
    {
      const { g, c } = field(36010);
      const warrior = addMate(g, 'warrior', c.x + 1, c.y);
      warrior.hp = warrior.maxHp = 60;
      g.player.x = c.x - 12; // 冒險者離得遠，怪物只貼著隊友
      const m = mon(g, c.x + 2, c.y, { toHit: 100, die: [1, 3], dmgBonus: 1, hp: 1e6, maxHp: 1e6 });
      warrior.x = c.x + 1;
      g.advance(6 * 4);
      ok(warrior.hp < 60, `怪物打隊友：生命 ${warrior.hp}/60`);
    }

    // 4c2. 第三十六版之四：士兵、隊友照自己的刻數行動（走一步＝moveTicks＋防具多花的刻，出手＝attackTicks＋防具；失序 ×2）
    {
      const { g, c } = field(36012);
      const hv = addMate(g, 'paladin', c.x + 1, c.y); // 聖騎士：重甲
      const cost0 = FE.AI.actCost(g, hv, 'move');
      ok(cost0 === FE.Char.moveTicks(hv) + FE.Gear.extraTicks(hv) && FE.Gear.extraTicks(hv) > 0, `重甲隊友走一步 ${cost0} 刻（${FE.Char.moveTicks(hv)}＋防具 ${FE.Gear.extraTicks(hv)}）`);
      const st0 = FE.Stability.state;
      FE.Stability.state = () => 2;
      const cost2 = FE.AI.actCost(g, hv, 'move');
      ok(cost2 === cost0 * C.CHAOS_TIME, `失序時 ×${C.CHAOS_TIME}：${cost2} 刻`);
      // 一直有事做時，平均每個動作花的刻接近 cost：跑 600 個世界回合（3,600 刻）數動了幾次
      const probe = { owe: 0 };
      let acts = 0;
      for (let i = 0; i < 600; i++) if (FE.AI.actorReady(probe)) { acts++; probe.owe = Math.max(probe.owe, -C.TICKS_MOVE) + cost2; }
      const per = (600 * C.TICKS_MOVE) / acts;
      ok(Math.abs(per - cost2) <= 1, `失序時重甲角色平均 ${per.toFixed(1)} 刻動一次（應該約 ${cost2}）`);
      FE.Stability.state = st0;
      // 出手：attackTicks＋防具多花的刻
      ok(FE.AI.actCost(g, hv, 'attack') === FE.Char.attackTicks(hv, hv.equip.main) + FE.Gear.extraTicks(hv), `重甲隊友出手 ${FE.AI.actCost(g, hv, 'attack')} 刻`);
    }

    // 4d. Tab 換人操作：冒險者 → 隊友 1 → 隊友 2 → 冒險者；被操作的那位吃按鍵，沒被操作的照自動行為走
    {
      const { g, c } = field(36011, 'ranger');
      const hero = g.hero;
      const m1 = addMate(g, 'warrior', c.x + 1, c.y + 2);
      const m2 = addMate(g, 'ranger', c.x - 1, c.y + 2);
      ok(g.player === hero && g.cycleControl() && g.player === m1 && g.cycleControl() && g.player === m2 && g.cycleControl() && g.player === hero, 'Tab：冒險者 → 隊友 1 → 隊友 2 → 冒險者');
      ok(g.cycleControl(2) && g.player === m2 && g.cycleControl(0) && g.player === hero, '點隊員欄直接換人');
      g.cycleControl();
      // 移動：動的是隊友 1，不是冒險者
      const hx = hero.x, hy = hero.y;
      const t0 = g.ticks;
      const x0 = m1.x;
      g.move(1, 0, { noTalk: true });
      ok(m1.x === x0 + 1 && hero.x === hx && hero.y === hy && g.ticks - t0 >= C.MOVE_TICKS_MIN, `被操作的隊友走了一步（${x0} → ${m1.x}），冒險者沒動`);
      // 跟隊友換位置
      const t = g.player;
      g.cycleControl(0);
      const mate1pos = { x: m1.x, y: m1.y };
      const heroAt = { x: hero.x, y: hero.y };
      // 把隊友 1 放在冒險者右邊一格，往右走進去：兩個人換位置
      m1.x = hero.x + 1; m1.y = hero.y;
      m2.x = hero.x - 5; m2.y = hero.y + 5;
      g.move(1, 0, { noTalk: true });
      ok(hero.x === heroAt.x + 1 && m1.x === heroAt.x && m1.y === heroAt.y, '走進隊友那一格，兩個人換位置');
      // 攻擊：按 1 打的是被操作的那位旁邊的怪物，用他自己的武器與技能
      g.cycleControl(); // 隊友 1（戰士）
      m1.x = c.x + 6; m1.y = c.y - 6;
      hero.x = c.x - 6; hero.y = c.y + 6; m2.x = c.x - 5; m2.y = c.y + 6;
      const m = mon(g, m1.x + 1, m1.y);
      m.hp = m.maxHp = 1e6;
      const evs = [];
      FE.Combat.hook = (e) => { if (e.by === 'mate' && !e.counter) evs.push(e); };
      const tk = g.ticks;
      g.battle.targetId = m.id;
      g.act('attack');
      FE.Combat.hook = hook0;
      ok(evs.length === 1 && evs[0].a === m1 && g.ticks - tk >= Ch.attackTicks(m1, m1.equip.main), `按 1：被操作的隊友出手（${evs.length} 下，花 ${g.ticks - tk} 刻）`);
      ok(JSON.stringify(m.hp) !== JSON.stringify(1e6) || evs[0].key === 'miss', '打到的是那隻怪物');
      // 逃跑：成功率照被操作的那位的敏捷，走的是他
      const keep = [C.FLEE_MIN, C.FLEE_MAX];
      C.FLEE_MIN = C.FLEE_MAX = 1;
      const px = m1.x, py = m1.y;
      g.flee();
      C.FLEE_MIN = keep[0]; C.FLEE_MAX = keep[1];
      ok(dist({ x: px, y: py }, m1) >= 2, `按 3：被操作的隊友逃開（${dist({ x: px, y: py }, m1)} 格）`);
      // 遠程：隊友 2 是遊俠，F 射擊用他自己的箭
      g.monsters = [];
      g.cycleControl(); // 隊友 2
      ok(g.player === m2, '換到隊友 2');
      const m3 = mon(g, m2.x + 4, m2.y);
      const arrows = m2.bag.find((e) => e.id === 'arrow').n;
      const heroArrows = hero.bag.filter((e) => e.id === 'arrow').reduce((s, e) => s + e.n, 0);
      ok(g.fireAt(m3, 'shoot') && m2.bag.find((e) => e.id === 'arrow').n === arrows - 1 && hero.bag.filter((e) => e.id === 'arrow').reduce((s, e) => s + e.n, 0) === heroArrows, '按 F：被操作的隊友用自己的箭射擊');
      // 沒被操作的冒險者與隊友 1 照自動行為走：怪物靠近冒險者時冒險者自己打
      g.monsters = [];
      g.cycleControl(); // 回到冒險者？（隊友 2 之後是冒險者）
      ok(g.player === hero, '換回冒險者');
      // 倒下操作權回到冒險者
      g.cycleControl(); // 隊友 1
      m1.hp = 1;
      const killer = mon(g, m1.x + 1, m1.y, { toHit: 100, die: [3, 6], dmgBonus: 5, hp: 1e6, maxHp: 1e6 });
      g.advance(6);
      ok(!g.mates.includes(m1) && g.player === hero, `被操作的隊友倒下就是死了，操作權回到冒險者：隊友 ${g.mates.length} 位、操作 ${g.player.name}`);
    }

    // 4e. 陣亡寫進歷史紀錄，原本聚落的人口 −1，從隊伍拿掉；冒險者倒下隊友不陣亡、一起在最近的聚落醒來
    {
      const { g, c } = field(36012);
      const v = g.world.villages[0];
      g.initPop(v);
      v.pop = g.namedCount(v) + 20;
      const m = addMate(g, 'mage', c.x + 1, c.y);
      m.hp = 1;
      m.maxHp = 100;
      m.name = '蒂娜';
      const keeper = addMate(g, 'warrior', c.x - 1, c.y);
      g.player.x = c.x - 12;
      const pop0 = v.pop;
      mon(g, c.x + 2, c.y, { toHit: 100, die: [3, 6], dmgBonus: 5, hp: 1e6, maxHp: 1e6 });
      g.advance(6 * 4);
      ok(!g.mates.includes(m), '隊友被打倒就是死了，從隊伍拿掉');
      const rec = g.history[0];
      ok(rec && rec.kind === 'death' && rec.role === '隊友' && rec.name === '蒂娜' && rec.cls === FE.CLASSES.mage.name && rec.village.includes(v.name), `歷史紀錄：${JSON.stringify(rec)}`);
      ok(v.pop === pop0 - 1, `原本聚落的人口 −1：${pop0} → ${v.pop}`);
      // 冒險者倒下：照現在的規則在最近的聚落醒來、不給懲罰；隊友不陣亡、一起出現在那個聚落
      g.monsters = [];
      const hist0 = g.history.length;
      const mates0 = g.mates.slice();
      g.hero.hp = 1;
      keeper.hp = keeper.maxHp - 5;
      Object.assign(g.player, { x: c.x, y: c.y });
      mon(g, g.player.x + 1, g.player.y, { toHit: 100, die: [3, 6], dmgBonus: 20, hp: 1e6, maxHp: 1e6 });
      g.guard('test', () => { g.beginAction(); g.endTurn(false); });
      const hv = g.world.villageAt(g.hero.x, g.hero.y);
      ok(!!hv && g.hero.hp === g.hero.maxHp, `冒險者倒下在聚落醒來（${hv && hv.name}），生命回滿`);
      ok(g.mates.length === mates0.length && g.mates.every((mm, i) => mm === mates0[i]) && g.history.length === hist0, '冒險者倒下隊友不陣亡、歷史紀錄沒新增');
      ok(g.mates.every((mm) => g.world.villageAt(mm.x, mm.y) === hv && mm.hp === mm.maxHp), '隊友一起出現在那個聚落、長休回滿');
    }

    // 4f. 存檔讀回一致：隊伍、隊員、人口、委託計數、商人
    {
      const { g, c } = field(36013);
      const v = g.world.villages[0];
      g.initPop(v);
      g.hero.done = { [v.id]: 7 };
      const m1 = addMate(g, 'mage', c.x + 1, c.y);
      const m2 = addMate(g, 'priest', c.x - 1, c.y);
      m1.hp = 12;
      g.cycleControl(); // 操作隊友 1
      FE.Save.save(g);
      const back = FE.Save.load();
      const h = back && back.game;
      ok(!!h, '存檔讀得回來');
      if (h) {
        ok(h.mates.length === 2 && h.mates[0].name === m1.name && h.mates[0].hp === 12 && h.mates[1].cls === 'priest' && h.hero === h.party()[0] && h.player === h.mates[0], `隊伍讀回一致：${h.mates.map((m) => m.name)}，操作 ${h.player.name}`);
        ok(h.hero.done[v.id] === 7 && h.world.villages[0].pop === v.pop && h.world.npcs.filter((n) => n.role === 'merchant').length === g.world.npcs.filter((n) => n.role === 'merchant').length, '委託計數、人口、商人讀回一致');
        ok(JSON.stringify(h.mates[0].skills) === JSON.stringify(m1.skills) && JSON.stringify(h.mates[0].equip) === JSON.stringify(m1.equip), '隊員的裝備與技能讀回一致');
      }
    }
  }

  // ---- 5. 商人：每個聚落一位，賣消耗品、陷阱、開鎖工具、裝備包；收購藥草；鐵匠、武器匠、盔甲匠不賣那些 ----
  function merchants() {
    const g = new FE.Game(36014);
    g.start();
    g.checkCreate = () => {};
    for (let i = 0; i < 14; i++) g.createChunk(false);
    const w = g.world;
    ok(w.villages.length >= 3, '世界裡聚落不夠');
    for (const v of w.villages) {
      const ms = w.npcs.filter((n) => n.villageId === v.id && n.role === 'merchant');
      ok(ms.length === 1 && FE.Gear.isShopkeeper(ms[0]) && FE.Gear.shopOf(ms[0], v) === 'merchant', `${v.name} 有一位商人`);
      const mm = ms[0];
      ok(w.passable(mm.x, mm.y) && w.villageAt(mm.x, mm.y) === v && FE.Steading.roomAt(v, mm.x, mm.y) >= 0, `${v.name} 的商人住在市場或民房裡`);
      const b = v.buildings[FE.Steading.roomAt(v, mm.x, mm.y)];
      ok(b && (b.kind === 'market' || b.kind === 'house' || b.kind === 'big'), `${v.name} 的商人在 ${b && b.kind}（市場、民房，堡壘與要塞沒有民房，在兵營）`);
    }
    const v = w.villages[0];
    const merchant = w.npcs.find((n) => n.villageId === v.id && n.role === 'merchant');
    const smith = w.npcs.find((n) => n.villageId === v.id && n.role === 'smith');
    const p = g.player;
    p.copper = 100000;
    // 商品
    const S = FE.Gear.SHOPS;
    const merchantIds = Object.values(S.merchant.buy).flat().sort().join();
    ok(merchantIds === ['potion', 'acid', 'alchemistFire', 'holyWater', 'oil', 'caltrops', 'bearings', 'huntingTrap', 'lock', 'thievesTools', 'crowbar', 'pack_gathering', 'pack_supply', 'pack_archer', 'pack_thrower'].sort().join(), `商人賣的東西 ${merchantIds}`);
    const others = ['blacksmith', 'weaponsmith', 'armorer'].flatMap((k) => Object.values(S[k].buy).flat());
    ok(!others.some((id) => ['potion', 'acid', 'alchemistFire', 'holyWater', 'oil', 'caltrops', 'bearings', 'huntingTrap', 'lock', 'thievesTools', 'crowbar'].includes(id) || id.startsWith('pack_')), '鐵匠、武器匠、盔甲匠不賣消耗品、陷阱、開鎖工具與裝備包');
    ok(S.blacksmith.buy.tool.join() === 'pick,sickle' && S.weaponsmith.buy.tool.join() === 'pick,sickle' && S.blacksmith.buy.ranged.includes('arrow'), '工匠只留武器、防具、彈藥、礦鎬與鐮刀');
    ok(S.merchant.repair.length === 0 && S.merchant.craft.length === 0 && S.merchant.sell.length === 0 && S.merchant.tabs.join() === 'buy,sell', '商人沒有修理、打造');
    ok(shopDo(g, merchant, 'buyItem:potion:0') && g.bagCount('potion') === 1 && !shopDo(g, smith, 'buyItem:potion:0'), '向商人買治療藥水，鐵匠買不到');
    // 收購藥草：一份 1 銀
    g.bagAdd('herb', 5);
    const c0 = p.copper;
    ok(shopDo(g, merchant, 'sellHerb') && g.bagCount('herb') === 0 && p.copper - c0 === FE.Gear.herbPrice(5, g.chaMod()) && FE.Gear.herbPrice(5, 0) === 5 * C.SILVER, `賣 5 份藥草得 ${p.copper - c0} 銅（一份 1 銀）`);
    const t = g.talkOptions(merchant);
    ok(t.role.startsWith('商人・') && t.name === merchant.name, `商人的對話：${t.role}`);
  }
  // 事件演算會讓格子往下掉、生出新的怪物，擾亂場景
  const tick0 = FE.Events.tick;
  FE.Events.tick = () => {};
  try {
    clock();
    population();
    soldiers();
    party();
    merchants();
  } finally {
    FE.Events.tick = tick0;
    FE.Combat.hook = hook0;
  }
}
UNITS.party36 = () => {
  try { testParty36(); } catch (e) { fail('第三十六版之一測試拋出例外：' + e.stack); }
};
