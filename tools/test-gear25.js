// 第二十五版的場景檢查：裝備、品質、磨損、負重、工匠、掉落
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
  // 第三十二版開局 96×96，有的種子一開局就動盪：清掉怪物後世界狀態也歸零
  const newGame = (seed) => { const g = new FE.Game(seed); g.start(); g.checkCreate = () => {}; g.monsters = []; g.worldState = 0; return g; };

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
    const newRanged = ['musket', 'pistol', 'blowgun'];
    ok(W.bow.twoHand && W.crossbow.twoHand && newRanged.every((t) => W[t].sold && W[t].drop) && W.lance.sold && W.lance.drop, '弓弩雙手規則或第二批遠程武器、騎槍的販售與掉落');
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
    ok(G.playerDefense(q).block === 0 && G.playerDefense(q).blockMax === 0 && near(G.playerDefense(q).dodge, 0) && G.playerAC(q) === 10 + FE.Char.attrMod(q, 'dex'), '沒拿盾牌時格擋機率該是 0');
    ok(G.name(G.make('sword', 1, 1)) === '-做工好-長劍' && G.name(G.make('heavy', 5, 1)) === '☼傑作☼鎖子甲' && G.name(G.make('light', 3, 1)) === '*優秀*皮甲' && G.name(G.make('medium', 4, 1)) === '≡卓越≡鱗甲' && G.name(G.make('shield', 2, 1)) === '+精良+盾牌', '裝備名字的品質符號');
    // 盾牌與重甲的其他數字
    q.equip.body = G.make('heavy', 0, 99);
    ok(near(G.playerDefense(q).dodge, 0) && G.playerAC(q) === 16 && G.extraTicks(q) === 2, '重甲每個動作多 2 刻（閃避不再另外扣 5%）');
    q.equip.body = G.make('medium', 0, 99);
    ok(near(G.playerDefense(q).dodge, 0) && G.playerAC(q) === 14 + Math.min(2, FE.Char.attrMod(q, 'dex')) && G.extraTicks(q) === 1, '中甲該多 1 刻、不扣閃避');
    q.equip.body = G.make('light', 0, 99);
    ok(G.extraTicks(q) === 0, '輕甲不該多花刻');
  }

  // 3. 防具減傷：固定扣點，扣完至少吃 1 點；魔法減傷本版用不到（怪物都是物攻）
  {
    const g = newGame(14);
    const p = g.player;
    const px = p.x, py = p.y;
    const m = FE.dressMonster(FE.makeMonster({ type: 'DECAY', x: px + 1, y: py, cells: [[px + 1, py]], scope: 2, data: {} }, 901, 1), g.world);
    Object.assign(m, { home: { x: px + 1, y: py }, atk: 3, die: null, maxHp: 1e9, hp: 1e9 }); // die: null：照固定的攻擊力算傷害（第三十三版起怪物用 SRD 的傷害骰）
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
    const m = FE.dressMonster(FE.makeMonster({ type: 'DECAY', x: px + 1, y: py, cells: [[px + 1, py]], scope: 2, data: {} }, 902, 1), g.world);
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
    // 第三十四版：城鎮要四面開得出出入口，比較常等不到，從 5150 起找第一個長滿之前蓋得出城鎮的種子
    let g = null;
    for (let sd = 5150; sd < 5190 && !g; sd++) {
      const t = new FE.Game(sd);
      t.start();
      t.checkCreate = () => {};
      for (let i = 0; i < 16 && !t.world.villages.some((v) => v.kind === 'town'); i++) t.createChunk(false);
      if (t.world.villages.some((v) => v.kind === 'town')) g = t;
    }
    ok(!!g, '找不到蓋得出城鎮的世界');
    if (!g) return;
    g.monsters = [];
    const w = g.world;
    const p = g.player;
    const vil = w.villages.find((v) => v.kind === 'village');
    const town = w.villages.find((v) => v.kind === 'town');
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
    const dump = (n) => { // 把這家店所有「買」的選項走一遍
      const found = [];
      const visited = new Set();
      open(n);
      const walk = () => {
        const page = g.talkPage;
        if (visited.has(page)) return;
        visited.add(page);
        for (const o of g.talkOptions(n).options.slice()) {
          if (o.id.startsWith('buyItem:')) found.push(o.id);
          else if (o.id === 'buy' || o.id.startsWith('cat:') || o.id.startsWith('qual:') || o.id.startsWith('buyPage:')) {
            const page0 = g.talkPage;
            g.choose(n, g.talkOptions(n).options.findIndex((x) => x.id === o.id));
            walk();
            g.talkPage = page0;
          }
        }
      };
      walk();
      g.talkPage = 'main';
      return [...new Set(found)];
    };
    // 賣什麼
    const sSmith = dump(smith);
    const sW = dump(wsmith);
    const sA = dump(armorer);
    const has = (list, t, q) => list.includes(`buyItem:${t}:${q}`);
    const BLACKSMITH = ['sword', 'shortsword', 'dagger', 'scimitar', 'rapier', 'waraxe', 'club', 'warhammer', 'handaxe', 'lightHammer', 'woodclub', 'greatclub', 'flail', 'morningstar', 'warpick', 'maul', 'spear', 'shortspear', 'staff', 'javelin', 'glaive', 'halberd', 'trident', 'lance', 'bow', 'longbow', 'arrow', 'sling', 'slingBullet', 'potion', 'acid', 'alchemistFire', 'holyWater', 'oil', 'caltrops', 'bearings', 'huntingTrap', 'lock', 'thievesTools', 'crowbar', 'pack_gathering', 'pack_supply', 'pack_archer', 'pack_thrower', 'padded', 'light', 'hide', 'chainshirt', 'ringmail', 'robe', 'shield', 'pick', 'sickle'];
    const WEAPONSMITH = ['sword', 'shortsword', 'greatsword', 'dagger', 'scimitar', 'rapier', 'waraxe', 'greataxe', 'handaxe', 'club', 'warhammer', 'lightHammer', 'woodclub', 'greatclub', 'flail', 'morningstar', 'warpick', 'maul', 'spear', 'shortspear', 'staff', 'whip', 'javelin', 'glaive', 'halberd', 'trident', 'lance', 'bow', 'longbow', 'crossbow', 'handcrossbow', 'heavycrossbow', 'sling', 'arrow', 'bolt', 'slingBullet', 'musket', 'pistol', 'blowgun', 'bullet', 'needle', 'potion', 'acid', 'alchemistFire', 'holyWater', 'oil', 'caltrops', 'bearings', 'huntingTrap', 'lock', 'thievesTools', 'crowbar', 'pack_gathering', 'pack_supply', 'pack_archer', 'pack_thrower', 'pick', 'sickle'];
    const ARMORER = ['padded', 'light', 'studded', 'robe', 'hide', 'chainshirt', 'medium', 'breastplate', 'halfplate', 'ringmail', 'heavy', 'splint', 'plate', 'shield'];
    const exactTypes = (list) => [...new Set(list.map((id) => id.split(':')[1]))].sort();
    const allQ = (list, types, qualities) => types.every((t) => qualities.every((q) => has(list, t, q)));
    ok(exactTypes(sSmith).join() === BLACKSMITH.slice().sort().join() && sSmith.length === BLACKSMITH.length && allQ(sSmith, BLACKSMITH, [0]), `鐵匠賣的東西 ${sSmith}`);
    const weaponGear = WEAPONSMITH.filter((t) => FE.GEAR[t] && FE.GEAR[t].cat !== 'tool');
    const weaponTools = WEAPONSMITH.filter((t) => FE.GEAR[t] && FE.GEAR[t].cat === 'tool');
    ok(exactTypes(sW).join() === WEAPONSMITH.slice().sort().join() && sW.length === weaponGear.length * 2 + weaponTools.length + WEAPONSMITH.filter((t) => !FE.GEAR[t]).length && allQ(sW, weaponGear, [0, 1]) && allQ(sW, WEAPONSMITH.filter((t) => !weaponGear.includes(t) || weaponTools.includes(t)), [0]), `武器匠賣的東西 ${sW}`);
    ok(exactTypes(sA).join() === ARMORER.slice().sort().join() && sA.length === ARMORER.length * 2 && allQ(sA, ARMORER, [0, 1]), `盔甲匠賣的東西 ${sA}`);
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
    const heavyOpt = g.talkOptions(smith).options.find((o) => o.id === 'buyItem:ringmail:0');
    ok(heavyOpt.disabled && heavyOpt.info.includes('還差 9 銅'), `買環甲錢不夠的說明：${heavyOpt.info}`);

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
    ok(ro.disabled && /耐久 100 \/ 200/.test(ro.info) && ro.info.includes('還差'), `修復錢不夠的說明：${ro.info}`);
    g.talkPage = 'main';

    // 打造：村莊鐵匠什麼都能打（衣袍除外），城鎮武器匠只打武器、盔甲匠只打防具與盾牌
    // 打造頁完整列出工匠能做的配方，不再分分類或分頁
    const craftIds = (n) => {
      return optIds(n, 'craft').filter((i) => i.startsWith('craftItem:')).map((i) => i.slice(10)).sort().join(',');
    };
    const sorted = (s) => s.split(',').sort().join(',');
    ok(craftIds(smith) === sorted('sword,spear,shortspear,dagger,shortsword,waraxe,club,warhammer,padded,light,hide,chainshirt,ringmail,shield') && craftIds(wsmith) === sorted('sword,spear,shortspear,dagger,shortsword,waraxe,club,warhammer,greataxe,greatsword') && craftIds(armorer) === sorted('padded,light,studded,hide,chainshirt,medium,breastplate,halfplate,ringmail,heavy,splint,plate,shield'), `可打造 ${craftIds(smith)}／${craftIds(wsmith)}／${craftIds(armorer)}`);
    ok([smith, wsmith, armorer].every((n) => optIds(n, 'craft').every((i) => i.startsWith('craftItem:'))), '打造頁出現分類或分頁選項');
    const need = { sword: 3, spear: 3, shortspear: 3, dagger: 3, heavy: 5, medium: 4, light: 2, shield: 2, shortsword: 3, waraxe: 3, club: 3, warhammer: 3, greataxe: 5, greatsword: 5, padded: 2, studded: 3, hide: 3, chainshirt: 4, breastplate: 5, halfplate: 5, ringmail: 5, splint: 6, plate: 7 };
    for (const [t, n] of Object.entries(need)) {
      const cq = G.craftQuote(t, vil);
      ok(cq.ore === n && cq.fee === Math.round(FE.GEAR[t].price * C.SILVER * 0.5 * econ(vil)), `${t} 打造要 ${cq.ore} 顆礦石＋${cq.fee}（應該 ${n} 顆＋${Math.round(FE.GEAR[t].price * C.SILVER * 0.5 * econ(vil))}）`);
    }
    // 礦石或金幣不夠：寫還差多少，不能打
    p.bag = [];
    g.bagAdd('ore', 4);
    p.copper = G.craftQuote('heavy', town).fee - 2;
    open(armorer); g.talkPage = 'craft';
    const co = g.talkOptions(armorer).options.find((o) => o.id === 'craftItem:heavy');
    ok(co.disabled && co.info.includes('還差 2 銅、1 顆礦石'), `打造鎖子甲錢和礦石都不夠的說明：${co.info}`);
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
  //    超過能背：移動一步 36 刻；超過推拖上限：不能移動、不能撤退（還能丟東西、出手）；拿掉原本兩段超重的出手減值與多花的刻
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
    // 第一段：走一步 36 刻（其他動作照常 6 刻）
    setOre(160);
    const side = DIRS.find(([dx, dy]) => g.world.canStep(p.x, p.y, p.x + dx, p.y + dy) && !g.world.npcAt(p.x + dx, p.y + dy) && !g.nodeAt(p.x + dx, p.y + dy));
    const t0 = g.ticks, x0 = p.x, y0 = p.y;
    g.move(side[0], side[1]);
    ok(g.ticks - t0 === 36 && (p.x !== x0 || p.y !== y0), `超過能背走一步花 ${g.ticks - t0} 刻（應該 36）`);
    const t1 = g.ticks;
    g.beginAction(); g.endTurn(false); // 一般的動作（第三十一版起沒有主動閃避，直接過一個動作）
    ok(g.ticks - t1 === 6, `超過能背其他動作還是 ${g.ticks - t1} 刻（應該 6）`);
    p.equip.main = G.make('sword', 3, g.nextGearId++);
    ok(G.hitMod(p) === 3, `超重第一段、優秀劍的出手加減 ${G.hitMod(p)}（應該 +3，沒有減值）`);
    p.equip.main = G.make('sword', 0, g.nextGearId++);
    // 第二段：不能移動、不能撤退；可以丟東西、可以打；丟掉就能動
    setOre(310);
    const px = p.x, py = p.y, turn0 = g.turn, tk0 = g.ticks;
    g.move(-side[0], -side[1]);
    ok(p.x === px && p.y === py && g.turn === turn0 && g.ticks === tk0 && g.log[0].text.includes('丟掉'), `超重太多還是走動了或沒提示（${g.log[0].text}）`);
    const m = FE.dressMonster(FE.makeMonster({ type: 'DECAY', x: px + side[0], y: py + side[1], cells: [], scope: 2, data: {} }, 903, 1), g.world);
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

  // 7. 防具多花的刻真的讓怪物多動（刻數累積，湊滿 6 刻才多動一次）
  {
    const countTurns = (body, actions) => {
      const g = newGame(17);
      const p = g.player;
      p.equip.body = body ? G.make(body, 0, g.nextGearId++) : null;
      const w0 = FE.AI.worldTurn;
      let turns = 0;
      FE.AI.worldTurn = (gg) => { turns++; return w0(gg); };
      for (let i = 0; i < actions; i++) { g.beginAction(); g.endTurn(false); } // 一般的動作（第三十一版起沒有主動閃避，直接過一個動作）
      FE.AI.worldTurn = w0;
      return { turns, ticks: g.ticks };
    };
    const none = countTurns(null, 20);
    const heavy = countTurns('heavy', 20);
    const medium = countTurns('medium', 20);
    const light = countTurns('light', 20);
    ok(none.turns === 20 && none.ticks === 120, `沒防具 20 個動作 怪物動 ${none.turns} 次、${none.ticks} 刻`);
    ok(heavy.ticks === 160 && heavy.turns === 26, `重甲 20 個動作 ${heavy.ticks} 刻、怪物動 ${heavy.turns} 次（應該 160 刻、26 次）`);
    ok(medium.ticks === 140 && medium.turns === 23, `中甲 20 個動作 ${medium.ticks} 刻、怪物動 ${medium.turns} 次（應該 140 刻、23 次）`);
    ok(light.turns === 20 && light.ticks === 120, `輕甲不該多花刻（${light.ticks} 刻）`);
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
    // 採集工具必須裝備後才會用；裝備算一個動作
    const pick = G.make('pick', 0, g.nextGearId++);
    g.bagAddGear(pick);
    const toolTurn = g.turn;
    g.useItem(p.bag.findIndex((e) => e.gear === pick));
    ok(p.equip.pick === pick && !p.bag.some((e) => e.gear === pick) && g.toolOf('pick') === pick && g.turn === toolTurn + 1, '裝備礦鎬後才生效，並花一個動作');
    // 丟掉：整疊消失，不算動作
    g.bagAdd('herb', 4);
    const hi = p.bag.findIndex((e) => e.id === 'herb');
    g.dropItem(hi);
    ok(g.bagCount('herb') === 0 && g.turn === toolTurn + 1, '丟掉藥草整疊都該消失、不算動作');
    // 存檔讀回來：裝備、耐久、背包裡的裝備、下一件裝備的編號
    p.equip.main.dur = 123;
    p.equip.body.warned = true;
    FE.Save.save(g);
    const back = FE.Save.load();
    ok(!!back && !!back.game, '存檔讀不回來');
    if (back && back.game) {
      const q = back.game.player;
      ok(q.equip.main.type === 'bow' && q.equip.main.dur === 123 && q.equip.body.type === 'medium' && q.equip.body.q === 4 && q.equip.body.warned === true && q.equip.pick.type === 'pick' && q.bag.filter((e) => e.id === 'gear').length === p.bag.filter((e) => e.id === 'gear').length && back.game.nextGearId === g.nextGearId, '存檔裡的主手、身上與採集裝備沒有完整讀回來');
      ok(back.game.weight() === g.weight(), '讀回來的負重不一樣');
      const legacy = FE.store.load('fe.save', null);
      legacy.data.player.bag.push({ id: 'gear', name: G.name(p.equip.pick), n: 1, gear: legacy.data.player.equip.pick });
      delete legacy.data.player.equip.pick;
      delete legacy.data.player.equip.sickle;
      FE.store.save('fe.save', legacy);
      const migrated = FE.Save.load();
      ok(!!migrated && migrated.game.toolOf('pick') && !migrated.game.player.bag.some((e) => e.id === 'gear' && e.gear.type === 'pick'), '舊存檔的礦鎬遷移到裝備欄，不再留一份在背包');
    }
  }

  // 9. 掉落：中型怪物 30% 多掉一件裝備（做工好～優秀）、寶箱 25%（普通～傑作），弓箭法杖不掉
  {
    const g = newGame(19);
    const p = g.player;
    const mid = () => { const m = FE.makeMonster({ type: 'DECAY', x: 0, y: 0, cells: [], scope: 6 }, 1, 1); return m; };
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
    const tiny = FE.makeMonster({ type: 'DECAY', x: 0, y: 0, cells: [], scope: 2 }, 1, 1);
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
  // 10. 冒險者的反擊（第三十一版改）：沒穿甲、沒拿重型武器與盾牌時機率 0；傷害是固定值（長劍 4，暴擊 8、被閃開減半）；反擊的訊息不寫「必定反擊」；倒下在最近的聚落醒來
  {
    const g = newGame(20);
    const p = g.player;
    ok(G.playerDefense(p).counter === 0, '沒穿甲、沒拿重型武器與盾牌時，反擊機率該是 0');
    {
      // 反擊機率的來源：防具（技能照等級、練過才加敏捷）、重型武器、盾牌（技能＋品質），相加最多 50%；傷害是主手類別＋盾牌，照技能加到傳奇 ×1.5
      const q = { main: p.equip.main, off: p.equip.off, body: p.equip.body, skills: JSON.stringify(p.skills), dex: p.attr.dex };
      const near = (a, b) => Math.abs(a - b) < 1e-9;
      p.attr.dex = 16;
      p.equip.body = G.make('light', 0, g.nextGearId++);
      ok(near(G.counterChance(p), 0), '皮甲沒練過：不加敏捷，機率 0');
      p.skills.light.lv = 15;
      ok(near(G.counterChance(p), 0.15 + 0.03), `輕甲傳奇＋敏捷 16：${G.counterChance(p)}`);
      p.skills.light.lv = 5;
      ok(near(G.counterChance(p), 0.05 + 0.03), `輕甲 5 級：${G.counterChance(p)}`);
      p.equip.body = G.make('heavy', 0, g.nextGearId++);
      p.skills.heavy.lv = 15;
      ok(near(G.counterChance(p), 0.0375), `重甲傳奇不加敏捷：${G.counterChance(p)}`);
      p.equip.body = null;
      p.equip.main = G.make('greataxe', 0, g.nextGearId++);
      p.skills.axe.lv = 15;
      ok(near(G.counterChance(p), 0.12) && G.counterDamage(p) === 9, `巨斧傳奇：機率 ${G.counterChance(p)}、傷害 ${G.counterDamage(p)}`);
      p.equip.main = G.make('spear', 6, g.nextGearId++);
      p.skills.spear.lv = 15;
      p.equip.off = G.make('shield', 6, g.nextGearId++);
      p.skills.shield.lv = 15;
      p.equip.body = G.make('light', 0, g.nextGearId++);
      p.skills.light.lv = 15;
      p.attr.dex = 18;
      ok(near(G.counterChance(p), 0.5) && G.counterDamage(p) === 9 + 5, `全部疊滿最多 50%：${G.counterChance(p)}、傷害 ${G.counterDamage(p)}`);
      p.equip.main = G.make('dagger', 0, g.nextGearId++);
      p.equip.off = null;
      ok(G.counterDamage(p) === 3, `短刀（輕型）反擊 3 點：${G.counterDamage(p)}`);
      Object.assign(p.equip, { main: q.main, off: q.off, body: q.body });
      p.skills = JSON.parse(q.skills);
      p.attr.dex = q.dex;
    }
    const m = FE.dressMonster(FE.makeMonster({ type: 'DECAY', x: p.x + 1, y: p.y, cells: [[p.x + 1, p.y]], scope: 2, data: {} }, 904, 1), g.world);
    Object.assign(m, { home: { x: m.x, y: m.y }, atk: 1, maxHp: 1e9, hp: 1e9 });
    g.monsters = [m];
    let counters = 0;
    FE.Combat.hook = (e) => { if (e.by === 'player' && e.counter) counters++; };
    for (let i = 0; i < 2000; i++) { p.hp = p.maxHp = 1e9; FE.Combat.resolveAttack(g, m, p, 'attack'); }
    ok(counters === 0, `反擊機率 0 卻反擊了 ${counters} 次`);
    // 直接叫反擊：長劍 4 點（暴擊 8、被閃開減半、格擋吸收一部分），不會超過 8
    const seen = {};
    let hard = 0;
    FE.Combat.hook = (e) => { if (e.by === 'player' && e.counter) { seen[e.dmg] = (seen[e.dmg] || 0) + 1; if (e.key === 'hard') hard++; } };
    p.equip.main.dur = p.equip.main.max = 1e9;
    for (let i = 0; i < 3000; i++) { m.hp = 1e9; FE.Combat.resolveAttack(g, p, m, 'attack', { noCounter: true, counter: true }); }
    FE.Combat.hook = hook0;
    ok(Object.keys(seen).every((d) => Number(d) >= 0 && Number(d) <= 8) && seen[4] > 100 && hard > 100, `反擊傷害分布 ${JSON.stringify(seen)}`);
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
    const m = FE.dressMonster(FE.makeMonster({ type: 'DECAY', x: p.x + 1, y: p.y, cells: [[p.x + 1, p.y]], scope: 2, data: {} }, 905, 1), g.world);
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
      for (let x = b.x0; x < b.x1 - 8 && !spot; x++) {
        let good = true;
        for (let dy = 0; dy < 5 && good; dy++) for (let dx = 0; dx < 8 && good; dx++) {
          const c = w.cell(x + dx, y + dy);
          good = !!c && w.passable(x + dx, y + dy) && !w.inBuffer(x + dx, y + dy) && w.heightOk(x, y, x + dx, y + dy) && !w.chestAt(x + dx, y + dy) && !g.nodeAt(x + dx, y + dy);
        }
        if (good) spot = { x, y };
      }
    }
    ok(!!spot, '找不到 8×5 的空地'); // 第三十二版：加寬一格，往後退到第 4 步還在空地裡
    if (spot) {
      const mk = (id, x, y) => {
        const m = FE.dressMonster(FE.makeMonster({ type: 'DECAY', x, y, cells: [[x, y]], scope: 2, data: {} }, id, 1), w);
        Object.assign(m, { home: { x, y }, atk: 3, maxHp: 1e9, hp: 1e9 });
        return m;
      };
      const wander0 = C.WANDER_CHANCE;
      const dodge0 = C.PLAYER_DODGE;
      const flee0 = [C.FLEE_MIN, C.FLEE_MAX];
      C.WANDER_CHANCE = 0;
      const cx = spot.x + 4, cy = spot.y + 2;
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

      // C. 逃跑（第三十一版取代撤退）失敗不解除纏上，成功才解除
      const f = mk(913, cx + 1, cy);
      reset([f]);
      g.move(1, 0);
      C.FLEE_MIN = C.FLEE_MAX = 0;
      g.flee();
      ok(g.battle.targetId === f.id, '逃跑失敗不該解除纏上');
      C.FLEE_MIN = C.FLEE_MAX = 1;
      g.flee();
      ok(g.battle.targetId === null && !touching(f), '逃跑成功該解除纏上');
      [C.FLEE_MIN, C.FLEE_MAX] = flee0;

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
    const mid = FE.makeMonster({ type: 'DECAY', x: g.player.x + 3, y: g.player.y, cells: [], scope: 6 }, 1, 1);
    const small = FE.makeMonster({ type: 'DECAY', x: g.player.x + 3, y: g.player.y, cells: [], scope: 2 }, 2, 1);
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
    const m = g.spawnMonster({ type: 'DECAY', x: spot.x, y: spot.y, cells: [], scope: 2, data: {} }, null);
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
