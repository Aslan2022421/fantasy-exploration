// 第二十八版的場景檢查：戰鬥
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
    // 第三十二版開局是 96×96、怪物多，可能已經失序（動作花兩倍刻）：清掉怪物後世界狀態跟著更新
    FE.Stability.update(g, true);
    const w = g.world;
    const R = 15;
    let c = null;
    // 第三十二版小塊是 24×24：改成在整個世界每 6 格找一個 35×35 都不在聚落周圍的中心
    const B = w.bounds();
    const centers = [];
    for (let y = B.y0 + R + 2; y < B.y1 - R - 2; y += 6) for (let x = B.x0 + R + 2; x < B.x1 - R - 2; x += 6) centers.push({ x, y });
    for (const { x, y } of centers) {
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
    Object.assign(m, { x, y, home: { x, y }, maxHp: 1e9, hp: 1e9, atk: 1, die: null, ac: FE.ROLL_OLD_AC }); // die: null：照固定的攻擊力算傷害；ac：AC 照第三十二版的分段（等於 AC 6），量出手加減與傷害時命中率跟原本一樣（第三十三版起怪物用 SRD 的數值）
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
    // 訊息紀錄只留 40 則，最後 40 下剛好沒暴擊的機率約一成多（第三十四版改亂數順序後碰到）：途中每則訊息都記下來再查
    const said = [];
    const say0 = g.say;
    g.say = function (text, kind) { said.push(text); return say0.call(this, text, kind); };
    const ev = events(() => { for (let i = 0; i < 3000; i++) { p.skills = Ch.freshSkills(); FE.Combat.resolveAttack(g, p, m, 'attack', { noCounter: true }); } });
    g.say = say0;
    const crits = ev.filter((e) => e.by === 'player' && e.crit && !e.blocked && !e.resisted);
    ok(crits.length > 50 && crits.every((e) => e.n === 20) && Math.min(...crits.map((e) => e.dmg)) >= 2 && Math.max(...crits.map((e) => e.dmg)) <= 16 && Math.max(...crits.map((e) => e.dmg)) > 8, `長劍（拿盾牌 1d8）暴擊擲兩次：${spread(crits.map((e) => e.dmg))}，擲出 ${[...new Set(crits.map((e) => e.n))]}`);
    ok(said.some((t) => t.includes('暴擊，傷害骰擲兩次')), '暴擊的訊息該寫傷害骰擲兩次');
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
    const blocker = mon(g, p.x + 1, p.y + 1); // 第三十五版之四：斜走一步也算貼身，現在斜的會變成旁邊的目標
    m.x = p.x + 2; m.y = p.y;
    ev = events(() => { g.battle.targetId = null; g.act('attack'); });
    ok(ev.some((e) => e.by === 'player' && e.d === blocker), '斜的怪物現在算貼身被打到，觸及就不會用');
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
    // 視線：巨石、建築的牆一格就擋；水不擋；樹（0.5）累積到門檻才擋，門檻＝1＋0.5×感知修正值（第三十三版之一）
    for (const [t, blocks] of [['#', true], ['⌂', true], ['♣', false], ['≈', false]]) {
      g.world.setCell(p.x + 3, p.y, t, 'plain');
      ok(FE.Combat.canShoot(g, p, near, r.range) === !blocks, `中間是「${t}」${blocks ? '該擋住' : '不該擋'}`);
    }
    g.world.setCell(p.x + 3, p.y, '.', 'plain');
    const trees = (n) => { for (let i = 1; i <= 5; i++) g.world.setCell(p.x + i, p.y, i <= n ? '♣' : '.', 'plain'); return FE.Combat.canShoot(g, p, near, r.range); };
    const wis0 = p.attr.wis;
    // 感知 +2（門檻 2）：3 棵看得穿、4 棵擋住；感知 +0（門檻 1）：1 棵穿、2 棵擋；感知 −1（門檻 0.5）：1 棵就擋
    for (const [w, pass, stop] of [[15, 3, 4], [10, 1, 2], [8, 0, 1]]) {
      p.attr.wis = w;
      ok((pass === 0 || trees(pass)) && !trees(stop), `感知 ${w}：${pass} 棵樹該看得穿、${stop} 棵該擋住`);
    }
    // 感知沒有上限：+5（門檻 3.5）看得穿 5 棵樹
    p.attr.wis = 20;
    ok(trees(5), '感知 20 該看得穿 5 棵樹');
    p.attr.wis = wis0;
    trees(0);
    // 怪物看冒險者也同一套，門檻看數值塊的感知：狼（+1）看得穿 2 棵、哥布林戰士（−1）1 棵就擋
    {
      const look = (srd, n) => { for (let i = 1; i <= 5; i++) g.world.setCell(p.x + i, p.y, i <= n ? '♣' : '.', 'plain'); return FE.AI.canSee(g.world, { x: p.x + 6, y: p.y, srd }, p); };
      ok(look('Wolf', 2) && !look('Wolf', 3) && !look('Goblin Warrior', 1) && look('Goblin Warrior', 0), '怪物的視線門檻該看數值塊的感知修正值');
      look('Wolf', 0);
    }
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
    // 只量動作本身：每次量之前清掉侵蝕生出來的怪物、世界回到安穩（失序時動作花兩倍刻）、怪物放回旁邊（長槍會把牠推開）
    const dt = (fn) => { g.monsters = g.monsters.filter((o) => o === m); g.worldState = 0; Object.assign(m, { x: p.x + 1, y: p.y }); const t = g.ticks; fn(); return g.ticks - t; };
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
    // 第三十一版：每個職業都從全部武器與防具挑（主手、身上、副手），補給挑藥草或 20 銀；不再有固定給的裝備
    const weapons = Object.keys(FE.GEAR).filter((k) => FE.GEAR[k].cat === 'weapon' && FE.GEAR[k].sold);
    const armors = Object.keys(FE.GEAR).filter((k) => FE.GEAR[k].cat === 'armor' && FE.GEAR[k].sold);
    for (const cls of Object.keys(FE.CLASSES)) {
      const gs = FE.startGroups(cls);
      ok(FE.CLASSES[cls].fixed.length === 0 && gs.length === 4 && gs[0].of.slice().sort().join() === weapons.slice().sort().join() && gs[1].of.slice().sort().join() === armors.slice().sort().join() && gs[2].of.join() === 'shield,nooff' && gs[3].of.join() === 'herb,gold,pack_gathering,pack_supply,pack_archer,pack_thrower', `${cls} 的起始挑法：${gs.map((g) => g.of.length)}`);
      for (const picks of [['sword', 'medium', 'shield', 'herb'], ['dagger', 'robe', 'nooff', 'gold'], ['bow', 'light', 'nooff', 'herb']]) {
        const g = new FE.Game(430);
        g.start({ cls, picks });
        const p = g.player;
        const have = [p.equip.main, p.equip.off, p.equip.body].filter(Boolean).map((x) => x.type);
        const want = picks.map((id) => FE.START_OPTS[id].gear).filter(Boolean);
        ok(want.every((t) => have.includes(t)) && have.length === want.length, `${cls} ${picks} 的起始裝備 ${have}（應該 ${want}）`);
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

    // 牧師的神聖攻擊（第三十一版取代神聖之光，按 F 選）：1d8 神聖傷害加感知修正值，命中加感知修正值，射程 5／20 加感知修正值；
    // 沒拿法杖就沒有杖術加成、不練技能；穿中甲施法 −2；冷卻 1 回合（連兩下第二下放不出來）
    {
      const { g, p, w } = arena(435, 'priest', ['staff', 'gold']);
      p.attr.wis = 14;
      p.skills = Ch.freshSkills();
      const club = p.equip.main;
      const r = g.rangedMode(true);
      ok(r && r.mode === 'holy' && r.range.join() === '7,22', `神聖攻擊射程 5／20 加感知修正值 +2：${r && r.range}`);
      const pf = Ch.profile(p, null, 'holy');
      ok(pf.type === 'holy' && pf.die.join() === '1,8' && pf.dmg === 2 && pf.hit === 2 - 2 && pf.mastery === null && pf.skills.length === 0, `神聖攻擊的算法：1d8 神聖、傷害加感知修正值、命中加感知修正值再扣中甲 2（${pf.hit}）`);
      const m = mon(g, p.x + 3, p.y);
      const t0 = g.turn;
      const ev = events(() => { for (let i = 0; i < 300; i++) { p.hp = p.maxHp = 1e6; g.battle.spellCd = {}; g.fireAt(m); } }).filter((e) => e.by === 'player');
      const cl = ev.filter((e) => (e.key === 'hit' || e.key === 'hard') && !e.dodged && !e.crit && !e.resisted);
      ok(g.turn === t0 + 300 && ev.length === 300 && ev.every((e) => e.mode === 'holy' && e.dmgType === 'holy' && e.holy === 0) && spread(cl.map((e) => e.dmg)) === '3～10', `神聖攻擊 1d8+2：${spread(cl.map((e) => e.dmg))}`);
      ok(Object.keys(FE.SKILLS).every((k) => uses(p, k) === 0) && p.equip.main === club && w.items.length === 0, '沒拿法杖的神聖攻擊不練技能、不丟武器');
      g.battle.spellCd = {};
      g.fireAt(m);
      ok(g.spellCd('holy') === 1 && g.rangedMode(true) === null && !g.fireAt(m), '神聖攻擊冷卻 1 回合');
      g.battle.spellCd = {};
      p.attr.wis = 8;
      ok(g.rangedMode(true).range.join() === '4,19', '感知修正值 -1 射程縮 1');
      p.equip.main = null;
      ok(g.rangedMode(true).mode === 'holy', '手上沒有武器也能放神聖攻擊');
      const wr = arena(436, 'warrior', ['sword', 'shield', 'herb']);
      ok(wr.g.rangedMode(true) === null && arena(437, 'mage', ['herb']).g.rangedMode(true).mode === 'bolt', '戰士按 F 不能遠程、法師的單體法術是魔法攻擊');
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
      const armorBuy = (s) => Object.values(S[s].buy).flat().filter((t) => FE.GEAR[t] && FE.GEAR[t].cat === 'armor' && t !== 'robe' && t !== 'mrobe').sort().join();
      ok(armorBuy('blacksmith') === 'chainshirt,hide,light,padded,ringmail', `村莊鐵匠賣的防具：${armorBuy('blacksmith')}`);
      ok(Object.values(S.blacksmith.buy).flat().includes('shield') && S.blacksmith.craft.includes('shield'), '村莊鐵匠賣盾牌');
      const allArmor = Object.keys(FE.GEAR).filter((k) => FE.GEAR[k].cat === 'armor' && k !== 'robe' && k !== 'mrobe').sort().join();
      ok(armorBuy('armorer') === allArmor && S.armorer.craft.slice().sort().join() === (allArmor + ',shield').split(',').sort().join(), `城鎮盔甲匠什麼防具都賣、都能打造：${armorBuy('armorer')}`);
      ok(!Object.values(S.weaponsmith.buy).flat().some((t) => FE.GEAR[t] && FE.GEAR[t].cat === 'armor'), '城鎮武器匠不賣防具');
    }
    useClasses('legacy');
  }
}
UNITS.combat28 = () => { try { testCombat28(); } catch (e) { fail('戰鬥測試拋出例外：' + e.stack); } };
