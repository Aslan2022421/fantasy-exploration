// 第二十六版的場景檢查：職業、屬性、生命與負重、加點、技能
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
    m.die = null; // 照固定的攻擊力算傷害（第三十三版起怪物用 SRD 的傷害骰）
    m.ac = FE.ROLL_OLD_AC; // 這裡量的是出手加減與傷害，AC 照第三十二版的分段（等於 AC 6），命中率跟原本一樣
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
    ok(C.SAVE_VERSION === 23 && old && old.stale === true && FE.store.load('fe.save', null) === null, '舊版本的存檔該清掉、回報 stale');
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
    // 反擊是固定值（第三十一版：一般武器 4 點，照技能加），不加力量
    p.attr.str = 18;
    const cs = [];
    FE.Combat.hook = (e) => { if (e.by === 'player' && e.counter && (e.key === 'hit' || e.key === 'hard') && !e.dodged && !e.crit && !e.resisted) cs.push(e.dmg); };
    for (let i = 0; i < 100; i++) FE.Combat.resolveAttack(g, p, m, 'attack', { noCounter: true, counter: true });
    FE.Combat.hook = hook0;
    ok(cs.length > 0 && cs.every((d) => d === G.counterDamage(p)) && G.counterDamage(p) === 4, '反擊是固定值（長劍 4 點），不加力量');
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

  // 7. 敏捷：出手 d20 加修正值（跟品質、地形、高處疊加）；第三十三版起敏捷加 AC（照防具類別），閃避只剩技能
  {
    const g = mk(33, 'ranger', ['shortspear']);
    const p = g.player;
    const m = arena(g, 'RUNTIME');
    const tag = () => { const l = g.log.find((x) => /擲出/.test(x.text)); const r = /擲出 \d+([+-]\d+)? 對 AC \d+：/.exec(l.text); return r && r[1] ? Number(r[1]) : 0; };
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
    p.skills.spear.lv = 10; // 長槍練的是槍術，熟練加值 +4（第三十三版之一）；格鬥 10 級再 +1
    p.skills.fight.lv = 10;
    ok(G.hitMod(p) === 3 + 2 + 4 + 1 && roll() - base === 10, `敏捷 +3、精良 +2、槍術 10 級熟練 +4、格鬥 10 級 +1 該疊成 +10：${roll() - base}`);
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
    // 第三十三版：敏捷不再加閃避，改加 AC（照 SRD 5.2.1 的防具表）；閃避只剩技能（每級 1%，基本 0）
    const ac = (q) => G.playerAC(q);
    ok([10, 16, 13, 8, 1].every((x) => d(mkp(x)) === 0), `閃避不隨敏捷：${[10, 16, 13, 8, 1].map((x) => d(mkp(x))).join('、')}`);
    ok(ac(mkp(10)) === 10 && ac(mkp(16)) === 13 && ac(mkp(13)) === 11 && ac(mkp(8)) === 9, `沒穿防具的 AC＝10＋敏捷：${ac(mkp(10))}、${ac(mkp(16))}、${ac(mkp(13))}、${ac(mkp(8))}`);
    ok(ac(mkp(16, 'light')) === 14 && ac(mkp(16, 'studded')) === 15 && ac(mkp(8, 'light')) === 10 && ac(mkp(16, 'padded')) === 14, '輕甲的敏捷全照算（包含負的）：皮甲、布甲 11、鑲釘皮甲 12');
    ok(ac(mkp(16, 'medium')) === 16 && ac(mkp(14, 'hide')) === 14 && ac(mkp(13, 'chainshirt')) === 14 && ac(mkp(8, 'medium')) === 13 && ac(mkp(18, 'halfplate')) === 17 && ac(mkp(10, 'breastplate')) === 14, '中甲的敏捷最多 +2，負的照扣：厚皮甲 12、鎖子襯衫 13、鱗甲與胸甲 14、半身板甲 15');
    ok(ac(mkp(16, 'heavy')) === 16 && ac(mkp(8, 'heavy')) === 16 && ac(mkp(16, 'plate')) === 18 && ac(mkp(16, 'ringmail')) === 14 && ac(mkp(16, 'splint')) === 17, '重甲敏捷不加也不扣：環甲 14、鎖子甲 16、條板甲 17、全身板甲 18');
    { const r1 = mkp(10); r1.equip.body = G.make('robe', 0, 97); const r2 = mkp(16); r2.equip.body = G.make('mrobe', 0, 96); ok(ac(r1) === 10 && ac(r2) === 13, '衣袍算沒穿防具（10＋敏捷）'); }
    { const q = mkp(16, 'heavy'); q.equip.off = G.make('shield', 0, 98); ok(ac(q) === 18, `盾牌 AC +2：${ac(q)}`); q.equip.body.q = 5; q.equip.off.q = 5; ok(ac(q) === 18, '品質不加 AC'); }
    ok(near(d(mkp(16, null, 0, 5)), 0.05) && near(d(mkp(10, null, 0, 20)), 0.20), '閃避技能每級該加 1%');
    ok(near(d(mkp(16, 'heavy', 14)), 0) && near(d(mkp(16, 'heavy', 0, 5)), 0.05), '穿甲技能不改閃避');
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
    ok(FE.SKILL_LEVELS.join() === '涉獵,新手,尚可,稱職,熟練,精通,天才,老練,專家,專精,卓越,傑出,大師,英雄,宗師,傳奇' && FE.skillLevelName(15) === '傳奇' && FE.skillLevelName(16) === '傳奇 +1' && FE.skillLevelName(30) === '傳奇 +15' && FE.skillLevelName(0) === '涉獵' && FE.skillLevelName(7) === '老練', '等級名稱不對');
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
    // 加成：武器技能命中是熟練加值（1～4 級 +2、每 5 級再 +1、最多 +6，0 級沒有；第三十三版之一）、傷害每 3 級 +1（只算主手武器那一項）
    const q = mk(41, 'warrior').player;
    const bonus = (lv) => { q.skills.sword.lv = lv; return [Ch.skillHit(q), Ch.skillDmg(q)]; };
    ok(bonus(0).join() === '0,0' && bonus(2).join() === '2,0' && bonus(3).join() === '2,1' && bonus(4).join() === '2,1' && bonus(5).join() === '3,1' && bonus(6).join() === '3,2' && bonus(10).join() === '4,3' && bonus(15).join() === '5,5' && bonus(20).join() === '6,6' && bonus(40).join() === '6,13', '武器技能的命中與傷害加成不對');
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
    ok(Ch.profile(q, q.equip.main, 'melee').hit === Ch.attrMod(q, 'dex') + 4 + 1 && Ch.profile(q, q.equip.main, 'melee').skills.join() === 'sword,fight', '格鬥 10 級＋劍術 10 級（熟練 +4）的近戰命中該疊成 +5');
    q.skills.fight.lv = 0;
    q.equip.main = G.make('bow', 0, 81);
    ok(Ch.weaponSkill(q) === 'bow' && Ch.weaponSkill(q, undefined, 'melee') === 'sword', '弓箭射擊練弓術，拿弓近戰練劍術');
    // 遠程：武器技能只加傷害，命中看射擊的熟練加值
    q.skills.bow.lv = 9;
    q.skills.shoot.lv = 10;
    const sh = Ch.profile(q, q.equip.main, 'shoot');
    ok(sh.dmg === Ch.attrMod(q, 'dex') + 3 && sh.hit === Ch.attrMod(q, 'dex') + 4 && sh.skills.join() === 'bow,shoot', `弓箭 9 級傷害 +3、射擊 10 級熟練 +4：傷害 ${sh.dmg}、命中 ${sh.hit}`);
    q.equip.main = G.make('dagger', 0, 83);
    q.skills.knife.lv = 6;
    const th = Ch.profile(q, q.equip.main, 'throw');
    const best = Math.max(Ch.attrMod(q, 'str'), Ch.attrMod(q, 'dex'));
    ok(th.dmg === best + 2 && th.hit === best + 4 && th.skills.join() === 'knife,shoot', `投擲短刀：傷害吃刀術（+2）、命中吃射擊（熟練 +4）：傷害 ${th.dmg}、命中 ${th.hit}`);
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
    ok(G.hitMod(p2) === 3 + 1, `劍術 6 級熟練 +3（再加敏捷 13 的 +1）：${G.hitMod(p2)}`);
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
    const pd0 = C.PLAYER_DODGE;
    C.PLAYER_DODGE = 0.1; // 第三十三版起基本閃避是 0（閃避只剩技能）；這裡量的是「閃開就練」，先給 10%
    for (let i = 0; i < 800; i++) {
      p.hp = p.maxHp = 1e9;
      p.equip.off.dur = p.equip.off.max = 1e9;
      p.block = null; // 格擋值每下都從滿的開始，不然很快就吸收不了
      FE.Combat.resolveAttack(g, m, p, 'attack', { noCounter: true, ...(i % 7 === 0 ? { cling: true, clingWord: '後退' } : {}) });
    }
    C.PLAYER_DODGE = pd0;
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
      // 站的地方整平成平地（地形與高低差會加減命中，第三十二版世界變了，找到的位置不一定是平地）
      for (const dx of [0, 1]) { g.world.setCell(p.x + dx, p.y, '.', 'plain'); g.world.setHeight(p.x + dx, p.y, g.world.cell(p.x, p.y).h); }
      const m = arena(g, 'RUNTIME');
      g.worldState = 0; // 第三十二版開局 96×96，有的種子一開局就動盪；這裡只測出手
      m.type = 'RUNTIME';
      m.atk = 0;
      p.equip.main.dur = p.equip.main.max = 1000;
      return { g, p, m };
    };
    const lines = (g, re) => g.log.filter((l) => re.test(l.text));
    const modOf = (l) => { const r = /擲出 \d+([+-]\d+)? 對 AC \d+：/.exec(l.text); return r && r[1] ? Number(r[1]) : 0; };
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
      ok(dl.length === 1 && lines(g, /^你用副手/).length === 0 && modOf(dl[0]) === base - 3 && uses(p, 'knife') - u1 <= C.SKILL_EXP_HIT * Ch.expFactor(p) + 1e-6 && uses(p, 'knife') > u1 && p.equip.off.dur === od, `重擊只用主手：${dl.length} 行、擲骰 ${dl.length && modOf(dl[0])}（單手 ${base}，技能重設後少刀術 5 級的熟練 +3）`);
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
        t.hp = i % 2 ? 1 : 1e9; // 一半一下就倒、一半打不倒（命中加值高時幾乎不落空，只靠血量 1 量不到「兩下都出」）
        ev = [];
        g.battle.targetId = null;
        g.strike('attack', t);
        const main = ev.filter((e) => !e.counter);        if (main[0] && main[0].killed) { if (main.length !== 1) bad++; early++; } else if (main.length === 2) both++;
        else if (main.length !== 2) bad++;
      }
      FE.Combat.hook = hook0;
      ok(early > 20 && both > 20 && bad === 0, `第一下打倒就不出第二下：第一下倒 ${early} 次、兩下都出 ${both} 次、不對 ${bad} 次`);
    }
    // 一個動作內擲出 6～10 的「必定反擊」最多觸發一次：主手觸發過，副手擲出 6～10 只算命中；主手沒觸發，副手照常觸發
    {
      const { g, p, m } = setup();
      m.type = 'CLIFF'; // 沒有自己的反擊機率，反擊只可能來自必定反擊
      m.ac = 10 + G.hitMod(p); // 讓擲 0～4 落在勉強命中（第三十三版之一有熟練加值後勉強命中變少，量不到兩下都勉強命中）
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

