// 第三十三版的場景檢查：怪物數值照 SRD 5.2.1（數值塊、生命算式）、AC 命中（分段、冒險者的 AC、閃避）、
// 怪物特性（群體戰術、靈巧脫身、再生、易傷）、同一對聚落只有一種關係
let monChecks = 0;
function testMonsters33() {
  const ok = (cond, msg) => { monChecks++; if (!cond) fail('怪物 ' + msg); };
  const near = (a, b, eps) => Math.abs(a - b) <= eps;
  const hook0 = FE.Combat.hook;
  useClasses('new'); // 現行的六個職業（場景檢查預設是舊的職業定義）
  // 冒險者放到聚落外的一塊整平的空地（同 test-skills31）
  const mk = (seed, cls, picks) => {
    const g = new FE.Game(seed);
    g.start(cls ? { cls, picks } : undefined);
    g.checkCreate = () => {};
    g.monsters = [];
    g.soldiers = [];
    const w = g.world;
    let spot = null;
    w.forEachCell((x, y) => {
      if (spot || w.inBuffer(x, y) || !w.passable(x, y) || !w.inBounds(x - 4, y - 4) || !w.inBounds(x + 4, y + 4)) return;
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) if (w.inBuffer(x + dx, y + dy)) return;
      spot = { x, y };
    });
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { w.setCell(spot.x + dx, spot.y + dy, '.', 'plain'); w.setHeight(spot.x + dx, spot.y + dy, 0); }
    Object.assign(g.player, { x: spot.x, y: spot.y });
    g.player.hp = g.player.maxHp = 1e6;
    g.worldState = 0;
    return g;
  };
  // 指定種族與分級的怪物（不看環境）
  const mon = (g, x, y, race, tier, type) => {
    const m = FE.makeMonster({ type: type || 'TERRAIN', x, y, cells: [], scope: tier === 'mid' ? 6 : 2, data: {}, race: race || 'goblin' }, g.nextMonsterId++, 1);
    Object.assign(m, { home: { x, y } });
    g.monsters.push(m);
    return m;
  };
  const events = (fn) => {
    const ev = [];
    FE.Combat.hook = (e) => ev.push(e);
    fn();
    FE.Combat.hook = hook0;
    return ev;
  };

  // 1. 數值塊：9 個種族各有小怪物與中型怪物；生命照（面數＋體質值）×1.5 捨去，每多一級加 面數÷2＋體質修正值
  {
    const want = {
      goblin: ['Goblin Warrior', 30, 'Goblin Boss', 39], bugbear: ['Bugbear Warrior', 56, 'Bugbear Stalker', 87],
      werewolf: ['Wolf', 35, 'Werewolf', 93], yeti: ['Ape', 45, 'Polar Bear', 71], lizardfolk: ['Sahuagin Warrior', 45, 'Allosaurus', 80],
      gnoll: ['Gnoll Warrior', 48, 'Giant Hyena', 71], skeleton: ['Skeleton', 40, 'Minotaur Skeleton', 72],
      troll: ['Troll Limb', 33, 'Troll', 125], kobold: ['Kobold Warrior', 26, 'White Dragon Wyrmling', 57],
    };
    ok(Object.keys(FE.MONSTER_BLOCKS).sort().join() === Object.keys(FE.RACES).sort().join(), '每個種族都要有數值塊');
    for (const race of Object.keys(want)) {
      const [sName, sHp, mName, mHp] = want[race];
      const s = FE.monsterBlock(race, 'small');
      const d = FE.monsterBlock(race, 'mid');
      ok(s.srd === sName && d.srd === mName && FE.monsterBlock(race, 'big') === d, `${FE.RACES[race].name}的數值塊：${s.srd}／${d.srd}`);
      ok(FE.monsterHp(s) === sHp && FE.monsterHp(d) === mHp, `${FE.RACES[race].name}的生命 ${FE.monsterHp(s)}／${FE.monsterHp(d)}（應該 ${sHp}／${mHp}）`);
      for (const b of [s, d]) ok(b.ac >= 10 && b.hd[0] >= 1 && b.die[0] >= 1 && Number.isInteger(b.hit) && FE.DMG_TYPES[b.type], `${b.srd} 的欄位不齊`);
    }
    const proposed = Object.values(FE.MONSTER_BLOCKS).flatMap((r) => [r.small, r.mid]).filter((b) => b.proposed).map((b) => b.srd).sort().join();
    ok(proposed === ['Allosaurus', 'Ape', 'Giant Hyena', 'Polar Bear', 'Sahuagin Warrior', 'White Dragon Wyrmling', 'Wolf'].join(), `標成提議的代用數值塊：${proposed}`);
    // 套到怪物身上：AC、攻擊加值、傷害、生命乘異常倍率與世界等級加成
    const g = mk(3301);
    const t = mon(g, 0, 0, 'troll', 'mid', 'CLIFF');
    ok(t.ac === 15 && t.toHit === 7 && t.die.join() === '2,6' && t.dmgBonus === 4 && t.regen === 15 && t.maxHp === Math.round(125 * 1.2) && t.hp === t.maxHp, `沼澤巨魔（斷崖）：AC ${t.ac}、+${t.toHit}、${t.die}+${t.dmgBonus}、生命 ${t.maxHp}`);
    const k = FE.makeMonster({ type: 'UNREACHABLE', x: 0, y: 0, cells: [], scope: 2, race: 'kobold' }, 1, 4);
    ok(k.maxHp === Math.round(26 * 1.3 * (1 + 3 * C.WL_BONUS.HP)) && k.dmgBonus === 1 && k.ac === 14, `狗頭人（斷層、世界等級 4）：生命 ${k.maxHp}、傷害加值 ${k.dmgBonus}`);
    // 看環境換種族：數值塊跟著換
    const m = FE.makeMonster({ type: 'TERRAIN', x: 0, y: 0, cells: [], scope: 2 }, 2, 1);
    m.race = 'skeleton';
    FE.statMonster(m);
    ok(m.ac === 14 && m.toHit === 5 && m.vuln.join() === 'blunt' && m.maxHp === 40, `換成骷髏：AC ${m.ac}、生命 ${m.maxHp}`);
    // 成群的跟班照帶頭那隻的種族
    const g2 = new FE.Game(3302);
    g2.start();
    const groups = {};
    for (const o of g2.monsters) (groups[o.group] = groups[o.group] || []).push(o);
    const bad = g2.monsters.filter((o) => { const b = FE.monsterBlock(o.race, o.tier); return o.ac !== b.ac || o.toHit !== b.hit || o.srd !== b.srd; });
    ok(g2.monsters.length > 0 && bad.length === 0 && Object.values(groups).every((a) => a.every((o) => o.race === a[0].race)), `開局的怪物數值照種族與分級：不對 ${bad.length} 隻`);
  }

  // 2. AC 命中的分段：擲 20 暴擊、擲 1 失手；其他 d20＋加值比 AC 高 5 以上命中、0～4 勉強命中、不到沒命中
  {
    const fixed = (n) => () => (n - 1) / 20 + 0.001; // FE.randInt(rng, 1, 20) 擲出 n
    const R = (n, mod, ac, critMin) => FE.rollD20(fixed(n), mod, 0, critMin, ac).key;
    ok(R(20, -50, 30) === 'crit' && R(1, 50, 5) === 'fumble', '擲 20 一定暴擊、擲 1 一定失手');
    ok(R(10, 4, 14) === 'hard' && R(10, 4, 10) === 'hard' && R(10, 4, 9) === 'hit' && R(10, 4, 15) === 'miss' && R(2, 0, 2) === 'hard', `分段：${R(10, 4, 14)}、${R(10, 4, 10)}、${R(10, 4, 9)}、${R(10, 4, 15)}`);
    ok(R(19, 0, 30, 19) === 'crit' && R(19, 0, 30) === 'miss', '暴擊門檻 19 照舊');
    ok(R(10, 0) === 'hard' && R(11, 0) === 'hit' && R(5, 0) === 'miss', '沒給 AC 照第三十二版的分段（等於 AC 6）');
    const r = FE.rollD20(fixed(12), 3, 0, 20, 13);
    ok(r.total === 15 && r.ac === 13 && r.name === '勉強命中，對方必定反擊', `回傳總點數與 AC：${r.total}、${r.ac}`);
  }

  // 3. 實際出手：怪物 d20＋攻擊加值對冒險者的 AC；冒險者勉強命中時怪物必定反擊；閃避在命中後再擲，閃開吃一半
  {
    const g = mk(3303, 'warrior', ['sword', 'shield', 'herb']);
    const p = g.player;
    const m = mon(g, p.x + 1, p.y, 'gnoll', 'small');
    m.hp = m.maxHp = 1e9;
    const ac = FE.Gear.playerAC(p);
    ok(ac === 14 + Math.min(2, FE.Char.attrMod(p, 'dex')) + 2, `戰士鱗甲＋盾牌的 AC ${ac}`);
    const ev = events(() => { for (let i = 0; i < 4000; i++) { p.hp = 1e6; p.block = null; for (const x of FE.Gear.equipped(p)) x.dur = x.max; FE.Combat.resolveAttack(g, m, p, 'attack', { noCounter: true }); } });
    const hitRate = ev.filter((e) => e.key === 'crit' || e.key === 'hit' || e.key === 'hard').length / ev.length;
    const expect = (Math.min(19, 21 - (ac - m.toHit)) - 1) / 20 + 0.05; // 2～19 裡到 AC 的，加上擲 20
    ok(ev.every((e) => e.ac === ac && e.mod === m.toHit) && near(hitRate, expect, 0.03), `豺狼人 +${m.toHit} 打 AC ${ac}：命中率 ${hitRate.toFixed(3)}（應該約 ${expect.toFixed(3)}）`);
    // 冒險者勉強命中：怪物必定反擊
    const pe = events(() => { for (let i = 0; i < 1500; i++) { p.hp = 1e6; p.equip.main.dur = p.equip.main.max; m.hp = 1e9; FE.Combat.resolveAttack(g, p, m, 'attack'); } }).filter((e) => e.by === 'player' && !e.counter);
    const hard = pe.filter((e) => e.key === 'hard');
    ok(hard.length > 50 && hard.every((e) => e.countered) && pe.every((e) => e.ac === m.ac), `勉強命中 ${hard.length} 次，怪物反擊 ${hard.filter((e) => e.countered).length} 次`);
    ok(pe.every((e) => e.key === 'crit' || e.key === 'fumble' || (e.key === 'miss') === (e.n + e.mod < m.ac)), '冒險者出手照 AC 判定');
    // 閃避：只看技能；閃開吃一半（命中之後才擲）
    p.skills.dodge.lv = 0;
    ok(FE.Gear.playerDefense(p).dodge === 0, '沒練閃避時閃避 0');
    p.skills.dodge.lv = 12;
    ok(near(FE.Gear.playerDefense(p).dodge, 0.12, 1e-9), '閃避技能 12 級＝12%');
    m.die = [1, 1];
    m.dmgBonus = 9; // 每下固定 10 點
    p.equip.off = null;
    p.equip.body = null;
    p.attr.con = 10;
    const pd0 = C.PLAYER_DODGE;
    C.PLAYER_DODGE = 1;
    const de = events(() => { for (let i = 0; i < 400; i++) { p.hp = 1e6; FE.Combat.resolveAttack(g, m, p, 'attack', { noCounter: true }); } });
    C.PLAYER_DODGE = pd0;
    const hits = de.filter((e) => e.key === 'hit' || e.key === 'hard');
    ok(hits.length > 50 && hits.every((e) => e.dodged && e.dmg === 5) && de.filter((e) => e.key === 'miss').every((e) => !e.dodged && e.dmg === 0), `閃開只吃一半（10 → 5）：${[...new Set(hits.map((e) => e.dmg))].join('、')}`);
    ok(de.filter((e) => e.key === 'fumble').every((e) => e.dodged && e.dmg === 0), '失手照舊：閃開就沒傷害');
  }

  // 4. 加護真的加 AC：神聖加護 +2
  {
    const g = mk(3304, 'priest', ['staff', 'robe', 'nooff', 'herb']);
    const p = g.player;
    const m = mon(g, p.x + 1, p.y, 'goblin', 'small');
    const base = FE.Gear.playerAC(p);
    g.cast('bless');
    const ev = events(() => FE.Combat.resolveAttack(g, m, p, 'attack', { noCounter: true }));
    ok(ev[0].ac === base + 2, `神聖加護 AC +2：${ev[0].ac}（原本 ${base}）`);
  }

  // 5. 群體戰術：目標旁邊（八個方向）有別的怪物，出手有優勢；狼人、狗頭人有，哥布林沒有
  {
    const g = mk(3305, 'warrior', ['sword', 'shield', 'herb']);
    const p = g.player;
    const wolf = mon(g, p.x + 1, p.y, 'werewolf', 'small');
    const advOf = (A) => events(() => { for (let i = 0; i < 40; i++) { p.hp = 1e6; FE.Combat.resolveAttack(g, A, p, 'attack', { noCounter: true }); } });
    ok(advOf(wolf).every((e) => e.adv === 0), '旁邊沒有同伴時沒有優勢');
    const pal = mon(g, p.x - 1, p.y + 1, 'goblin', 'small'); // 斜對角也算
    const ev = advOf(wolf);
    ok(ev.every((e) => e.adv === 1 && e.advWhy.includes('群體戰術')) && g.log.some((l) => /群體戰術，優勢/.test(l.text)), '同伴貼著目標（斜對角）時有優勢，訊息寫出來');
    ok(advOf(pal).every((e) => e.adv === 0), '哥布林沒有群體戰術');
    const kob = mon(g, p.x, p.y + 1, 'kobold', 'small');
    ok(advOf(kob).every((e) => e.adv === 1), '狗頭人有群體戰術');
    g.monsters = [kob, mon(g, p.x + 3, p.y, 'goblin', 'small')];
    ok(advOf(kob).every((e) => e.adv === 0), '同伴不貼著目標就沒有');
    ok(FE.monsterBlock('werewolf', 'mid').traits.includes('pack') && !FE.monsterBlock('kobold', 'mid').traits.includes('pack'), '狼人中型有、狗頭人中型（代用的白龍幼龍）沒有');
  }

  // 6. 靈巧脫身：哥布林貼上來的那一回合擲潛行，到了就藏著，下一次出手有優勢（彎刀多 1d4），出手後露出來
  {
    const g = mk(3306, 'warrior', ['sword', 'shield', 'herb']);
    const p = g.player;
    p.attr.wis = 10;
    const gob = mon(g, p.x + 2, p.y, 'goblin', 'small');
    gob.stealth = 100;
    g.battle.targetId = gob.id; // 纏上：牠會走過來貼著
    FE.AI.worldTurn(g);
    ok(FE.AI.touching(g, gob, p) && gob.hidden === true && g.log.some((l) => l.text.includes('躲進了你看不到的地方')), '哥布林貼上來的那一回合藏起來');
    const ev = events(() => FE.AI.worldTurn(g));
    const a = ev.find((e) => e.a === gob && e.d === p);
    ok(a && a.adv === 1 && a.advWhy.includes('靈巧脫身') && !gob.hidden, '藏著的下一次出手有優勢，出手後露出來');
    // 優勢時彎刀多 1d4：1d6+2 → 有優勢 4～12
    const seen = [];
    FE.Combat.hook = (e) => { if (e.a === gob && e.key === 'hit' && !e.dodged && !e.blocked) seen.push(e.dmg + e.reduced + e.conCut); }; // 還原防具與體質擋下的
    for (let i = 0; i < 400; i++) { gob.hidden = true; p.hp = 1e6; p.block = null; FE.Combat.resolveAttack(g, gob, p, 'attack', { noCounter: true }); }
    FE.Combat.hook = hook0;
    ok(seen.length > 30 && Math.min(...seen) >= 4 && Math.max(...seen) <= 12 && Math.max(...seen) > 8, `有優勢的彎刀 1d6+2+1d4：${Math.min(...seen)}～${Math.max(...seen)}`);
    // 潛行不夠就藏不了；不是哥布林不會藏
    gob.hidden = false;
    gob.stealth = -100;
    FE.AI.nimbleHide(g, gob);
    ok(!gob.hidden, '潛行沒到被動察覺就藏不了');
    const kob = mon(g, p.x, p.y - 1, 'kobold', 'small');
    kob.stealth = 100;
    FE.AI.nimbleHide(g, kob);
    ok(!kob.hidden, '沒有靈巧脫身的怪物不會藏');
  }

  // 7. 再生：每回合開頭回 regen 點（不超過上限）；被火或酸打到，下一回合不回
  {
    const g = mk(3307);
    const t = mon(g, g.player.x + 3, g.player.y, 'troll', 'mid');
    t.hp = t.maxHp - 40;
    FE.AI.regenerate(g, t);
    ok(t.hp === t.maxHp - 25, `沼澤巨魔每回合回 15：${t.maxHp - t.hp}`);
    t.hp = t.maxHp - 3;
    FE.AI.regenerate(g, t);
    ok(t.hp === t.maxHp, '回到上限為止');
    const limb = mon(g, g.player.x + 3, g.player.y + 2, 'troll', 'small');
    limb.hp -= 10;
    FE.AI.regenerate(g, limb);
    ok(limb.maxHp - limb.hp === 5, '小沼澤巨魔（Troll Limb）每回合回 5');
    // 火：拿一隻傷害種類設成火的怪物去打牠
    const fire = mon(g, t.x + 1, t.y, 'goblin', 'small');
    Object.assign(fire, { dmgType: 'fire', toHit: 100 });
    t.hp = t.maxHp - 40;
    for (let i = 0; i < 20 && !t.noRegen; i++) FE.Combat.resolveAttack(g, fire, t, 'attack', { noCounter: true });
    const hp0 = t.hp;
    ok(t.noRegen === true, '被火打到記下來');
    FE.AI.regenerate(g, t);
    ok(t.hp === hp0 && !t.noRegen, '被火打到的下一回合不回');
    FE.AI.regenerate(g, t);
    ok(t.hp === hp0 + 15, '再下一回合照常回');
    fire.dmgType = 'slash';
    t.noRegen = false;
    for (let i = 0; i < 20; i++) FE.Combat.resolveAttack(g, fire, t, 'attack', { noCounter: true });
    ok(!t.noRegen, '其他傷害不影響再生');
    // 世界的回合裡會回
    t.hp = t.maxHp - 30;
    g.monsters = [t];
    FE.AI.worldTurn(g);
    ok(t.hp === t.maxHp - 15, `世界的回合裡再生：${t.maxHp - t.hp}`);
  }

  // 8. 易傷：骷髏被鈍擊打中傷害加倍，揮砍、穿刺不加倍
  {
    const g = mk(3308, 'warrior', ['sword', 'shield', 'herb']);
    const p = g.player;
    const sk = mon(g, p.x + 1, p.y, 'skeleton', 'small');
    sk.ac = FE.ROLL_OLD_AC;
    const run = (type) => {
      p.equip.main = FE.Gear.make(type, 0, g.nextGearId++);
      return events(() => { for (let i = 0; i < 300; i++) { sk.hp = sk.maxHp = 1e6; p.hp = 1e6; p.equip.main.dur = p.equip.main.max; FE.Combat.resolveAttack(g, p, sk, 'attack', { noCounter: true }); } }).filter((e) => e.by === 'player');
    };
    const club = run('club');
    const hitC = club.filter((e) => (e.key === 'hit' || e.key === 'hard') && !e.dodged && !e.blocked && !e.resisted);
    const str = FE.Char.attrMod(p, 'str');
    ok(hitC.length > 50 && hitC.every((e) => e.vulnerable && e.dmg % 2 === 0) && Math.max(...hitC.map((e) => e.dmg)) > 4 + str, `硬頭錘（鈍擊）打骷髏傷害加倍：${Math.min(...hitC.map((e) => e.dmg))}～${Math.max(...hitC.map((e) => e.dmg))}`);
    ok(g.log.some((l) => l.text.includes('正中弱點')), '訊息寫出弱點');
    ok(run('sword').every((e) => !e.vulnerable) && run('spear').every((e) => !e.vulnerable), '揮砍、穿刺不加倍');
    const gob = mon(g, p.x, p.y + 1, 'goblin', 'small');
    gob.ac = FE.ROLL_OLD_AC;
    p.equip.main = FE.Gear.make('club', 0, g.nextGearId++);
    const ge = events(() => { for (let i = 0; i < 100; i++) { gob.hp = 1e6; FE.Combat.resolveAttack(g, p, gob, 'attack', { noCounter: true }); } });
    ok(ge.every((e) => !e.vulnerable), '哥布林不怕鈍擊');
  }

  // 9. 同一對聚落只會有一種關係（兩個方向合起來看）
  {
    let pairs = 0;
    let bad = 0;
    for (const seed of [11, 12, 13]) {
      const g = new FE.Game(seed * 7919);
      g.start();
      for (let i = 0; i < 16; i++) g.createChunk(false);
      const kinds = {};
      for (const v of g.world.villages) {
        for (const t of v.steading.tags) {
          if (!['誓約關係', '貿易關係', '敵對關係'].includes(t.k) || t.rel == null) continue;
          const k = [v.id, t.rel].sort((a, b) => a - b).join('-');
          (kinds[k] = kinds[k] || new Set()).add(t.k);
          if (t.rel === v.id) bad++;
        }
      }
      for (const s of Object.values(kinds)) { pairs++; if (s.size > 1) bad++; }
    }
    ok(pairs > 30 && bad === 0, `聚落之間的關係：${pairs} 對，同一對有兩種關係（或對自己）${bad} 對`);
    // 人工：A 對 B 已經是敵對，B 擲出誓約時不能挑 A；擲出敵對可以
    const a = { id: 1, kind: 'village', steading: { tags: [{ k: '敵對關係', rel: 2 }] } };
    const relTo = (k) => FE.Steading.relOk([], 2, a, k);
    ok(!relTo('誓約關係') && !relTo('貿易關係') && relTo('敵對關係'), '對方已經敵對，這邊只能是敵對');
    ok(!FE.Steading.relOk([{ k: '貿易關係', rel: 1 }], 2, a, '敵對關係'), '這邊已經有關係就不能再加');
  }
  FE.Combat.hook = hook0;
  useClasses('legacy');
}
UNITS.monsters33 = () => { try { testMonsters33(); } catch (e) { fail('怪物測試拋出例外：' + e.stack); } };
