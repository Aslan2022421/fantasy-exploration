// 第二十九版的場景檢查：角色與成長
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
    Object.assign(m, { x, y, home: { x, y }, maxHp: 1e9, hp: 1e9, atk: 1, die: null, ac: FE.ROLL_OLD_AC }); // die: null：照固定的攻擊力算傷害；ac：AC 照第三十二版的分段（等於 AC 6），量出手加減與傷害時命中率跟原本一樣（第三十三版起怪物用 SRD 的數值）
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

  // 16b. 逃跑（第三十一版，按 3，取代撤退與撤離）：成功率看敏捷與貼身的怪物數；成功跳到離怪物 2 格以上、最多 2＋敏捷修正值格，不被趁機攻擊
  {
    const g = arena('warrior', 9130);
    const p = g.player;
    p.equip.main = gear('sword');
    const lim = [C.FLEE_MIN, C.FLEE_MAX];
    const setup = (n) => {
      g.monsters = [];
      // 四周整平（第三十三版之二：怪物配置改了，冒險者站的地方旁邊可能有高低差，貼身的怪物就不算貼著）
      for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) if (g.world.cell(p.x + dx, p.y + dy)) { g.world.setCell(p.x + dx, p.y + dy, '.', 'plain'); g.world.setHeight(p.x + dx, p.y + dy, 0); }
      const ms = [[1, 0], [0, 1], [-1, 0], [0, -1]].slice(0, n).map(([dx, dy]) => mon(g, p.x + dx, p.y + dy));
      for (const m of ms) m.atk = 3;
      g.battle.targetId = ms[0].id;
      return ms;
    };
    // 成功率：敏捷修正值 0、貼身 1 隻 80%；每多 1 隻 −15%
    const rate = (n, dex) => {
      p.attr.dex = 10 + dex * 2;
      let won = 0;
      for (let i = 0; i < 400; i++) {
        const x0 = p.x, y0 = p.y;
        setup(n);
        p.hp = p.maxHp = 1e6;
        g.flee();
        if (p.x !== x0 || p.y !== y0) won++;
        p.x = x0; p.y = y0;
      }
      return won / 400;
    };
    const r1 = rate(1, 0);
    const r3 = rate(3, 0);
    const rd = rate(1, 3);
    ok(Math.abs(r1 - 0.8) < 0.07 && Math.abs(r3 - 0.5) < 0.08 && Math.abs(rd - 0.95) < 0.04, `逃跑成功率：1 隻 ${r1}、3 隻 ${r3}、敏捷 +3 ${rd}`);
    // 成功：離所有怪物 2 格以上，最多 2＋敏捷修正值格；沒有趁機攻擊；甩掉目標；花的刻照走的格數
    C.FLEE_MIN = C.FLEE_MAX = 1;
    p.attr.dex = 10;
    const x0 = p.x, y0 = p.y;
    setup(2);
    const t0 = g.ticks;
    const ev = events(() => g.flee());
    const far = Math.min(...g.monsters.map((m) => Math.max(Math.abs(m.x - p.x), Math.abs(m.y - p.y))));
    const moved = Math.max(Math.abs(p.x - x0), Math.abs(p.y - y0)); // 第三十五版之四：八方向，斜走一步算 1 格
    ok(far >= 2 && moved >= 2 && moved <= 2 && g.battle.targetId === null, `逃跑成功：離怪物 ${far} 格、走 ${moved} 格（敏捷 10 最多 2 格）`);
    ok(!ev.some((e) => e.cling || e.opportunity), '逃跑時不會被趁機攻擊');
    ok(g.ticks - t0 >= 2 * FE.Char.moveTicks(p), `逃跑花的刻照走的格數：${g.ticks - t0}`);
    // 失敗：留在原地、算一個動作
    C.FLEE_MIN = C.FLEE_MAX = 0;
    p.x = x0; p.y = y0;
    setup(1);
    const turn0 = g.turn;
    g.flee();
    ok(p.x === x0 && p.y === y0 && g.turn === turn0 + 1, '逃跑失敗：留在原地、花一個動作');
    // 旁邊沒有怪物：不算動作
    g.monsters = [];
    const turn1 = g.turn;
    g.flee();
    ok(g.turn === turn1 && /不需要逃跑/.test(g.log[0].text), '旁邊沒有怪物不用逃跑');
    // 快捷鍵 3 是逃跑；6、7 拿掉了
    ok(typeof g.disengage === 'undefined' && typeof g.dodgeStance === 'undefined', '撤離與主動閃避拿掉了');
    [C.FLEE_MIN, C.FLEE_MAX] = lim;
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

    // 起始技能（第三十一版）：從全部技能擲 5 格、新手～精通（1～5 級），至少 1 項武器技能、1 項防具技能，不重複；
    // 偏高、偏低兩組輪流；鎖定的格子重擲時不變；本職業的池子加權
    {
      const R = FE.SKILL_ROLL;
      ok(R.slots === 5 && R.high.length === 5 && R.low.length === 5 && R.high.concat(R.low).every((r) => r.length === 5 && r.reduce((a, b) => a + b, 0) === 100), '起始技能機率表的資料（兩組各 5 行、每行 5 級合計 100%）');
      const isW = (k) => FE.SKILLS[k].weapon && k !== 'misc';
      const isA = (k) => !!FE.ARMOR_SKILL[k];
      let bad = 0;
      const seen = new Set();
      for (const cls of Object.keys(pools)) {
        let prev = null;
        for (let i = 0; i < 300; i++) {
          const r = Ch.rollSkills(cls, rng, prev);
          const ids = r.slots.map((x) => x.id);
          if (ids.length !== 5 || new Set(ids).size !== 5 || !ids.some(isW) || !ids.some(isA) || r.slots.some((x) => !(x.lv >= 1 && x.lv <= 5)) || (prev && r.high === prev.high)) bad++;
          for (const k of ids) seen.add(k);
          prev = r;
        }
      }
      ok(bad === 0, `起始技能不對 ${bad} 次（5 格、不重複、保底武器與防具、1～5 級、偏高偏低輪流）`);
      ok(Object.keys(FE.SKILLS).every((k) => seen.has(k)), '全部技能都有機會擲到（不分職業）');
      // 鎖定：鎖住的格子重擲後不變，其他格子照樣保底
      const r1 = Ch.rollSkills('mage', FE.makeRng(9));
      r1.slots[0].locked = true;
      r1.slots[2].locked = true;
      let keepBad = 0;
      let prev = r1;
      for (let i = 0; i < 200; i++) {
        const r = Ch.rollSkills('mage', rng, prev);
        if (r.slots[0].id !== r1.slots[0].id || r.slots[0].lv !== r1.slots[0].lv || r.slots[2].id !== r1.slots[2].id || !r.slots.map((x) => x.id).some(isW) || !r.slots.map((x) => x.id).some(isA)) keepBad++;
        prev = r;
      }
      ok(keepBad === 0, `鎖定的格子重擲後不變 ${keepBad}`);
      // 偏高組平均比偏低組高；本職業的池子比較常擲到（戰士的斧術 vs 法師的斧術）
      let hi = 0, hn = 0, lo = 0, ln = 0, wAxe = 0, mAxe = 0;
      for (let i = 0; i < 2000; i++) {
        const r = Ch.rollSkills('warrior', rng);
        for (const x of r.slots) if (r.high) { hi += x.lv; hn++; } else { lo += x.lv; ln++; }
        if (r.levels.axe) wAxe++;
        if (Ch.rollSkills('mage', rng).levels.axe) mAxe++;
      }
      ok(hi / hn > lo / ln + 0.5, `偏高組平均 ${(hi / hn).toFixed(2)}、偏低組 ${(lo / ln).toFixed(2)}`);
      ok(wAxe > mAxe * 1.15, `本職業池子加權：戰士擲到斧術 ${wAxe}、法師 ${mAxe}`);
    }
    // 起始技能放進角色：技能等級照擲的結果，挑到的武器、防具、盾牌所屬技能 +1，其餘涉獵；存檔讀得回來
    {
      useClasses('new');
      const sk = Ch.rollSkills('ranger', FE.makeRng(77));
      const picks = ['bow', 'light', 'nooff', 'herb'];
      const g = new FE.Game(451);
      g.start({ cls: 'ranger', picks, skills: sk });
      const p = g.player;
      const plus = Ch.startPlusOne(picks);
      ok(plus.join() === 'bow,light', `挑到的裝備所屬技能：${plus}`);
      ok(Object.keys(FE.SKILLS).every((k) => p.skills[k].lv === (sk.levels[k] || 0) + (plus.includes(k) ? 1 : 0) && p.skills[k].n === 0), `起始技能放進角色：${Object.keys(FE.SKILLS).map((k) => k + p.skills[k].lv)}`);
      ok(p.equip.main.type === 'bow' && p.equip.body.type === 'light' && !p.equip.off && g.bagCount('arrow') === 20, '遊俠挑弓、皮甲、副手空著，附 20 支箭');
      FE.Save.save(g);
      const back = FE.Save.load();
      ok(back && back.game && back.game.player.skills.bow.lv === p.skills.bow.lv, '存檔讀回來，技能等級還在');
      const g3 = new FE.Game(453);
      g3.start({ cls: 'warrior', picks: ['crossbow', 'plate', 'shield', 'gold'], skills: Ch.rollSkills('warrior', FE.makeRng(3)) });
      ok(g3.bagCount('bolt') === 20 && g3.player.equip.body.type === 'plate' && !g3.player.equip.off, '挑輕弩附 20 支弩矢、全部防具都能挑、雙手武器時盾牌放背包');
      ok(FE.Char.validPicks('mage', ['greatsword', 'heavy', 'nooff', 'herb']) && !FE.Char.validPicks('mage', ['staff', 'herb']), '每個職業都能挑全部武器與防具（主手、身上、副手、補給各一組）');
      const g2 = new FE.Game(452);
      g2.start({ cls: 'warrior', picks: ['sword', 'medium', 'shield', 'herb'] });
      ok(Object.keys(FE.SKILLS).every((k) => g2.player.skills[k].lv === 0), '沒給起始技能（測試用）都是 0 級，也不加那 1 級');
      useClasses('legacy');
    }
    useClasses('legacy');
  }
  FE.Combat.hook = hook0;
}
UNITS.growth29 = () => { try { testGrowth29(); } catch (e) { fail('角色與成長測試拋出例外：' + e.stack); } };

