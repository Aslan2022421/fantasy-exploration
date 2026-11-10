// 第三十七版之一（V37.1）的場景檢查：火器技能、新精通（輕捷、順勢、蓄勢、回擺、致命、致死、齊射、後座、流血、眩暈、定身）、
// 怪物的抗性與標籤、推擊撞牆、失手、一優一劣（命中、暴擊、重擊、穿甲、攻擊刻數、冷卻、反擊、屬性需求）
let weaponChecks = 0;
function testWeapons371() {
  const ok = (cond, msg) => { weaponChecks++; if (!cond) fail('第三十七版之一 ' + msg); };
  useClasses('new');
  const Ch = FE.Char;
  const G = FE.Gear;
  const hook0 = FE.Combat.hook;
  const roll0 = FE.rollD20;

  // 一塊整平的空地（聚落圈外），冒險者站中間；中性角色（屬性都是 10、長劍）
  const g = new FE.Game(37101);
  g.start();
  g.checkCreate = () => {};
  g.monsters = [];
  g.soldiers = [];
  const w = g.world;
  let spot = null;
  const r = 6;
  w.forEachCell((x, y) => {
    if (spot || w.inBuffer(x, y) || !w.inBounds(x - r, y - r) || !w.inBounds(x + r, y + r)) return;
    for (let dy = -r; dy <= r; dy += 3) for (let dx = -r; dx <= r; dx += 3) if (w.inBuffer(x + dx, y + dy)) return;
    spot = { x, y };
  });
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { w.setCell(spot.x + dx, spot.y + dy, '.', 'plain'); w.setHeight(spot.x + dx, spot.y + dy, 0); }
  w.chests = [];
  w.nodes = [];
  const p = g.player;
  Object.assign(p, { x: spot.x, y: spot.y, hp: 1e6, maxHp: 1e6 });
  const mon = (dx, dy, opts) => {
    const m = FE.dressMonster(FE.makeMonster({ type: 'DECAY', x: spot.x + dx, y: spot.y + dy, cells: [], scope: 2, data: {} }, 37100 + g.monsters.length, 1), w);
    Object.assign(m, { home: { x: m.x, y: m.y }, small: false, hp: 1e6, maxHp: 1e6, ac: 10, toHit: 0, die: [1, 2], dmgBonus: 0 }, opts || {});
    g.monsters.push(m);
    return m;
  };
  const wield = (type, skillLv) => {
    p.equip.main = G.make(type, 0, g.nextGearId++);
    p.equip.main.dur = p.equip.main.max = 1e9;
    p.equip.off = null;
    const sk = FE.GEAR[type].skill;
    for (const k of Object.keys(p.skills)) p.skills[k] = { lv: 0, n: 0 };
    if (sk) p.skills[sk].lv = skillLv || 0;
    p.combo = null;
    p.lastTarget = null;
    p.backswing = false;
    p.moveRun = 0;
    return p.equip.main;
  };
  // 固定 d20 的結果（key：crit、hit、hard、miss），記下這一下的加值；亂數照給的清單，用完之後一律 fill
  let lastMod = null;
  const fixRoll = (key, margin) => {
    FE.rollD20 = (rng, mod, adv, critMin, ac) => {
      lastMod = mod;
      const n = key === 'crit' ? 20 : 10;
      const total = margin != null ? ac + margin : n + mod;
      return { n, dice: [n], adv: 0, mod, total, ac, key, name: FE.ROLL_BANDS.find((b) => b.key === key).name };
    };
  };
  const seq = (list, fill) => {
    const q = list.slice();
    g.rng = () => (q.length ? q.shift() : fill);
  };
  const rng0 = g.rng;
  let ev = [];
  FE.Combat.hook = (e) => ev.push(e);
  const hit = (m, kind, opts) => {
    ev = [];
    FE.Combat.resolveAttack(g, p, m, kind || 'attack', Object.assign({ noCounter: true }, opts || {}));
    return ev.find((e) => e.by === 'player' && e.d === m);
  };

  try {
    // 1. 火器：火槍、手槍練火器；技能表與分組
    ok(FE.GEAR.musket.skill === 'firearm' && FE.GEAR.pistol.skill === 'firearm' && FE.SKILLS.firearm && FE.SKILLS.firearm.weapon, '火槍、手槍該練火器');

    // 2. 屬性需求：不到就跟體型不夠一樣拿不起來；建角時不列出
    p.attr.dex = 12;
    ok(Ch.grip(p, G.make('rapier', 0, 1)) === 'none' && /敏捷 13/.test(Ch.cantWieldText(p, G.make('rapier', 0, 1))), '敏捷 12 拿不起刺劍（要 13）');
    p.attr.dex = 13;
    ok(Ch.grip(p, G.make('rapier', 0, 1)) !== 'none', '敏捷 13 拿得起刺劍');
    p.attr.dex = 10;
    p.attr.str = 14;
    ok(Ch.grip(p, G.make('greataxe', 0, 1)) === 'none' && Ch.grip(p, G.make('maul', 0, 1)) === 'none' && Ch.grip(p, G.make('greatclub', 0, 1)) !== 'none', '力量 14：巨斧、巨錘（15）拿不起，巨棒（13）拿得起');
    p.attr.str = 10;
    const opts = Ch.groupOptions(FE.START_GEAR_GROUPS[0], 70000, Object.assign({}, FE.CLASSES.warrior.attr));
    ok(!opts.includes('whip') && opts.includes('greataxe') && opts.includes('greatclub') && opts.includes('rapier'), `戰士（力量 15、敏捷 13）建角時不列鞭子（敏捷 15），巨斧、巨棒、刺劍照列`);
    const mopts = Ch.groupOptions(FE.START_GEAR_GROUPS[0], 70000, Object.assign({}, FE.CLASSES.mage.attr));
    ok(!mopts.includes('greataxe') && !mopts.includes('maul') && !mopts.includes('greatclub') && !mopts.includes('longbow') && mopts.includes('rapier'), '法師（力量 8）建角時不列巨斧、巨錘、巨棒、長弓');
    ok(!Ch.validPicks('warrior', ['whip', 'medium', 'shield', FE.CLASSES.warrior.groups[0].of[0]], 70000, FE.CLASSES.warrior.attr), '建角挑屬性不夠的武器該被擋下');

    // 3. 暴擊範圍、失手率、攻擊刻數、反擊機率、說明文字
    ok(Ch.critMin(p, G.make('scimitar', 0, 1)) === 19 && Ch.critMin(p, G.make('dagger', 0, 1)) === 19 && Ch.critMin(p, G.make('sword', 0, 1)) === 20, '彎刀、短刀暴擊範圍 +1');
    ok(Math.abs(Ch.fumbleRate(p, G.make('scimitar', 0, 1)) - 0.1) < 1e-9 && Ch.fumbleRate(p, G.make('sword', 0, 1)) === 0, '敏捷 10：彎刀失手率 10%、長劍 0');
    p.attr.dex = 14;
    ok(Math.abs(Ch.fumbleRate(p, G.make('scimitar', 0, 1)) - 0.06) < 1e-9, '敏捷 14（+2）：彎刀失手率 6%');
    p.attr.dex = 8;
    ok(Math.abs(Ch.fumbleRate(p, G.make('sword', 0, 1)) - 0.02) < 1e-9, '敏捷 8（−1）：長劍失手率 2%');
    p.attr.dex = 10;
    wield('dagger', 4);
    const t4 = Ch.attackTicks(p, p.equip.main);
    p.skills.knife.lv = 5;
    ok(t4 === 5 && Ch.attackTicks(p, p.equip.main) === 4, `短刀輕捷要刀術 5 級才少 1 刻：${t4} → ${Ch.attackTicks(p, p.equip.main)}`);
    ok(Ch.attackTicks(p, G.make('bow', 0, 1)) === 5 && Ch.attackTicks(p, G.make('musket', 0, 1)) === 9 && Ch.attackTicks(p, G.make('heavycrossbow', 0, 1)) === 9, '弓箭 −1 刻、火槍 +3、重弩 +2');
    wield('halberd', 0);
    const c0 = G.counterChance(p);
    wield('sword', 0);
    ok(Math.abs(c0 - G.counterChance(p) - 0.05) < 1e-9, `戟的反擊機率 +5%：${c0}`);
    ok(/優：命中 \+1/.test(G.statText({ type: 'shortsword', q: 0 })) && /劣：重擊冷卻 \+1/.test(G.statText({ type: 'shortsword', q: 0 })) && /輕捷/.test(G.statText({ type: 'shortsword', q: 0 })), `短劍的說明寫出精通與優劣：${G.statText({ type: 'shortsword', q: 0 })}`);
    ok(/力量要 15/.test(G.statText({ type: 'greataxe', q: 0 })), '巨斧的說明寫出力量需求');

    // 4. 怪物的抗性與標籤
    const sk = mon(1, 0);
    sk.race = 'skeleton';
    FE.statMonster(sk);
    Object.assign(sk, { hp: 1e6, maxHp: 1e6, ac: 10 });
    ok(FE.hasTag(sk, 'noBlood') && FE.hasTag(sk, 'noPoison') && FE.monsterResist(sk).bleed === 1, '骷髏不會流血、不受毒');
    ok(Math.abs(FE.monsterResist(sk).control - 0.1) < 1e-9 && FE.monsterResist(sk).move === 0, `骷髏（體質 15）控制抗性 10%、小怪物移動 0：${JSON.stringify(FE.monsterResist(sk))}`);
    sk.elite = true;
    sk.tier = 'mid';
    ok(Math.abs(FE.monsterResist(sk).control - 0.25) < 1e-9 && Math.abs(FE.monsterResist(sk).move - 0.25) < 1e-9, '菁英控制 +15%、中怪物移動 25%');
    sk.stunned = 1;
    ok(Math.abs(FE.monsterResist(sk).control - 0) < 1e-9 && Math.abs(FE.monsterResist(sk).move - 0) < 1e-9, '眩暈中控制、移動抗性各 −25 個百分點');
    sk.tier = 'big';
    sk.stunned = 0;
    ok(FE.monsterResist(sk).move === 1, '大怪物移動抗性 100%');
    g.monsters = [];

    // 5. 失手：命中後擲，失手傷害減半、精通不觸發、訊息寫失手
    const m = mon(1, 0);
    wield('scimitar', 5);
    fixRoll('hit');
    seq([0.99, 0.99, 0.99], 0.99);
    const e1 = hit(m);
    seq([0, 0.99, 0.99], 0.99);
    p.combo = null;
    p.lastTarget = m.id;
    const e2 = hit(m);
    ok(e1 && e2 && !e1.slip && e2.slip && e2.dmg === Math.ceil(e1.dmg / 2) && /失手/.test(g.log[0].text), `彎刀命中後失手：${e1 && e1.dmg} → ${e2 && e2.dmg}（${g.log[0].text}）`);

    // 6. 蓄勢（彎刀）：連續打同一目標第二下 +1×骰數、第三下起 +2×；做別的事就歸零
    wield('scimitar', 5);
    seq([], 0.5); // 失手率 10%：0.5 不會失手；骰子都擲中間值
    const d = [hit(m).dmg, hit(m).dmg, hit(m).dmg];
    g.endTurn(false); // 出手那個動作的收尾（蓄勢留著）
    g.endTurn(false); // 下一個動作不是出手：蓄勢歸零
    const d4 = hit(m).dmg;
    ok(d[1] === d[0] + 1 && d[2] === d[0] + 2 && d4 === d[0], `蓄勢：${d.join('、')}，做別的事後 ${d4}`);

    // 7. 順勢、回擺、齊射、後座、打貼身、原地出手、衝刺
    const m2 = mon(0, 1);
    wield('handaxe', 5); // 手斧：順勢；近戰命中 −1
    seq([], 0.5);
    hit(m);
    const base = lastMod;
    hit(m2);
    ok(lastMod === base + 1, `順勢：換目標 +1（${base} → ${lastMod}）`);
    wield('greatclub', 5);
    p.attr.str = 13;
    fixRoll('miss');
    hit(m);
    const b0 = lastMod;
    fixRoll('hit');
    hit(m);
    ok(lastMod === b0 + 1 && !p.backswing, `回擺：沒命中之後下一次 +1（${b0} → ${lastMod}）`);
    p.attr.str = 10;
    Object.assign(m, { x: spot.x + 1, y: spot.y }); // 巨棒的推擊把牠推開了，放回來
    wield('spear', 0);
    fixRoll('hit');
    hit(m);
    const s0 = lastMod;
    ok(s0 === (FE.BIOMES[w.cell(p.x, p.y).biome].hit || 0) + Ch.profile(p, p.equip.main, 'melee').hit - 1, `長槍打貼身的目標 −1：${s0}`);
    wield('lance', 0);
    p.attr.str = 13;
    p.moveRun = 0;
    seq([], 0.99);
    const still = hit(m);
    const lm0 = lastMod;
    p.moveRun = 2;
    const run = hit(m);
    ok(lastMod === lm0 + 1 && still && run && run.charge && run.dmg - Ch.profile(p, p.equip.main, 'melee').dmg === 2 * (still.dmg - Ch.profile(p, p.equip.main, 'melee').dmg), `騎槍：原地出手 −1、衝刺傷害骰擲兩次（${still && still.dmg} → ${run && run.dmg}）`);
    p.attr.str = 10;
    const far = mon(0, -2);
    wield('longbow', 5);
    p.attr.str = 13;
    g.bagAdd('arrow', 20, { q: 0 });
    hit(far, 'attack', { mode: 'shoot', weapon: p.equip.main, range: [9, 38], ammoQ: 0 });
    const v0 = lastMod;
    p.skills.bow.lv = 4;
    hit(far, 'attack', { mode: 'shoot', weapon: p.equip.main, range: [9, 38], ammoQ: 0 });
    ok(lastMod === v0 + 2, `齊射（長弓精通）：2 格內 −2（${v0} 對 ${lastMod}）`);
    p.attr.str = 10;
    wield('musket', 5);
    g.bagAdd('bullet', 10, { q: 0 });
    hit(far, 'attack', { mode: 'shoot', weapon: p.equip.main, range: [3, 8], ammoQ: 0 });
    const k0 = lastMod;
    p.attr.str = 14;
    hit(far, 'attack', { mode: 'shoot', weapon: p.equip.main, range: [3, 8], ammoQ: 0 });
    ok(lastMod === k0 + 2, `後座：力量修正值不到 +2 時 −2（${k0} → ${lastMod}）`);
    p.attr.str = 10;
    g.monsters = g.monsters.filter((o) => o !== far && o !== m2);

    // 8. 暴擊：致死（戰鎬 1d10 雙手 → d12，再多 1 顆）、暴擊加骰（戰斧）、重擊骰（巨劍擲 3 次）
    fixRoll('crit');
    seq([], 0.999);
    wield('warpick', 5);
    let e = hit(m);
    const dm = Ch.profile(p, p.equip.main, 'melee').dmg;
    ok(e && e.dmg === 12 * 2 + 12 + dm, `戰鎬致死：暴擊 2 顆 d12＋多 1 顆 d12（${e && e.dmg}）`);
    wield('waraxe', 0);
    e = hit(m);
    ok(e && e.dmg === 10 * 2 + 10 + Ch.profile(p, p.equip.main, 'melee').dmg, `戰斧暴擊多擲 1 顆武器骰（不用精通）：${e && e.dmg}`);
    p.attr.str = 13;
    wield('greatsword', 0);
    fixRoll('hit');
    e = hit(m, 'deep');
    ok(e && e.dmg === 6 * 2 * 3 + Ch.profile(p, p.equip.main, 'melee').dmg, `巨劍重擊傷害骰擲 3 次：${e && e.dmg}`);
    p.attr.str = 10;
    g.battle.cooldown = 0;
    wield('shortsword', 0);
    g.strike('deep', m);
    ok(g.battle.cooldown === C.DEEP_COOLDOWN + 1, `短劍重擊冷卻 +1：${g.battle.cooldown}`);
    g.battle.targetId = null;
    Object.assign(m, { x: spot.x + 1, y: spot.y });

    // 9. 短刀的劣勢：勉強命中放寬到高出 AC 不到 7
    wield('dagger', 0);
    fixRoll('hit', 6);
    e = hit(m);
    ok(e && e.key === 'hard', `短刀高出 AC 6 算勉強命中：${e && e.key}`);
    fixRoll('hit', 7);
    e = hit(m);
    ok(e && e.key === 'hit', '短刀高出 AC 7 算命中');

    // 10. 流血（短刀精通）：機率都中（亂數 0），每次行動受傷、30% 止血；骷髏不會流血
    fixRoll('hit');
    wield('dagger', 5);
    seq([0.5, 0.5], 0); // 失手（0.5 不中）、閃避；之後流血機率擲 0
    m.bleed = null;
    hit(m);
    ok(m.bleed && m.bleed.die.join() === '1,4', `短刀命中造成傷害後流血：${JSON.stringify(m.bleed)}`);
    wield('crossbow', 5);
    m.bleed = null;
    seq([0.5, 0.5], 0);
    hit(m, 'attack', { mode: 'shoot', weapon: p.equip.main, range: [5, 20], ammoQ: 0 });
    ok(m.bleed && m.bleed.die.join() === '1,6', '輕弩的流血是 1d6');
    m.x = spot.x + 5;
    m.y = spot.y + 5;
    const hp0 = m.hp;
    seq([], 0.99); // 擲 1d6 → 6；止血 0.99 不中
    FE.AI.worldTurn(g);
    ok(m.hp === hp0 - 6 && m.bleed, `流血每次行動受傷：${hp0 - m.hp}`);
    seq([0.99], 0); // 傷害擲 6；止血擲 0 → 止住
    FE.AI.worldTurn(g);
    ok(!m.bleed, '流血每次行動後 30% 止血');
    m.x = spot.x + 1;
    m.y = spot.y;
    const sk2 = mon(-1, 0);
    sk2.race = 'skeleton';
    FE.statMonster(sk2);
    Object.assign(sk2, { hp: 1e6, maxHp: 1e6, ac: 10, die: [1, 2], toHit: 0, dmgBonus: 0 });
    wield('dagger', 5);
    seq([0.5, 0.5], 0);
    hit(sk2);
    ok(!sk2.bleed, '骷髏不會流血');
    g.monsters = g.monsters.filter((o) => o !== sk2);

    // 11. 眩暈（投石索精通）：出手 −2、不能反擊；再中一次就停一次行動；定身（弓箭精通）：不能移動、閃避歸零
    wield('sling', 5);
    m.stunned = 0;
    seq([0.5, 0.5], 0);
    hit(m, 'attack', { mode: 'shoot', weapon: p.equip.main, range: [2, 8], ammoQ: 0 });
    ok(m.stunned === C.STUN_TURNS && !m.stunSkip, `投石索命中造成傷害後眩暈 2 次行動：${m.stunned}`);
    ev = [];
    seq([], 0.5);
    FE.rollD20 = roll0;
    const mm0 = m.toHit;
    FE.Combat.resolveAttack(g, m, p, 'attack', { noCounter: true });
    const me = ev.find((x) => x.by === 'monster');
    ok(me && me.mod === mm0 - C.STUN_D20, `眩暈中的怪物出手 −2：${me && me.mod}`);
    fixRoll('hit');
    seq([0.5, 0.5], 0);
    hit(m, 'attack', { mode: 'shoot', weapon: p.equip.main, range: [2, 8], ammoQ: 0 });
    ok(m.stunSkip, '眩暈中再中一次：下一次行動停下來');
    const x0 = m.x;
    seq([], 0.5);
    FE.AI.worldTurn(g);
    ok(!m.stunSkip && !(m.stunned > 0) && /愣在原地/.test(g.log.map((l) => l.text).join('')), '停下一次行動之後眩暈結束');
    wield('bow', 5);
    m.rooted = 0;
    seq([0.5, 0.5], 0);
    hit(m, 'attack', { mode: 'shoot', weapon: p.equip.main, range: [5, 20], ammoQ: 0 });
    ok(m.rooted === C.ROOT_TURNS && FE.monsterDef(m).dodge === 0, `弓箭命中造成傷害後定身 2 次行動，閃避歸零：${m.rooted}`);
    m.x = spot.x + 4;
    m.y = spot.y;
    g.battle.targetId = m.id;
    seq([], 0.5);
    FE.AI.worldTurn(g);
    ok(m.x === spot.x + 4 && m.rooted === 1, `定身的怪物不會跟上來：${m.x - spot.x}`);
    g.battle.targetId = null;
    m.x = spot.x + 1;
    m.y = spot.y;
    m.rooted = 0;
    void x0;

    // 12. 推擊撞牆：撞到擋路的東西停下，受 1d4 鈍擊並眩暈 1 次行動（長槍的推擊見 test-combat28）；大怪物推不動
    wield('warhammer', 5);
    m.stunned = 0;
    m.stunSkip = false;
    w.setCell(spot.x + 2, spot.y, '#', 'plain');
    seq([0.5, 0.5], 0.99);
    const hpB = m.hp;
    e = hit(m);
    ok(m.x === spot.x + 1 && m.stunned === 1 && hpB - m.hp === e.dmg + 4, `戰錘推擊撞上巨石：傷害 ${hpB - m.hp}（這一下 ${e.dmg}＋撞牆 4）、眩暈 ${m.stunned}`);
    w.setCell(spot.x + 2, spot.y, '.', 'plain');
    m.stunned = 0;
  } finally {
    FE.rollD20 = roll0;
    FE.Combat.hook = hook0;
    g.rng = rng0;
  }
}

UNITS.weapons371 = testWeapons371;
