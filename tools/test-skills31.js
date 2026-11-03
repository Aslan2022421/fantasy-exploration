// 第三十一版的場景檢查：施法（法杖加成、穿甲減值、範圍、推開、冷卻、三種防禦招）
let spellChecks = 0;
function testSpells31() {
  const ok = (cond, msg) => { spellChecks++; if (!cond) fail('施法 ' + msg); };
  useClasses('new');
  const mk = (seed, cls, picks) => {
    const g = new FE.Game(seed);
    g.start({ cls, picks });
    g.checkCreate = () => {};
    g.monsters = [];
    g.soldiers = [];
    // 冒險者放到聚落外的一塊空地
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
    return g;
  };
  const mon = (g, x, y) => {
    const m = FE.dressMonster(FE.makeMonster({ type: 'TERRAIN', x, y, cells: [], scope: 2, data: {} }, 9000 + g.monsters.length, 1), g.world);
    Object.assign(m, { home: { x, y }, hp: 1e6, maxHp: 1e6, atk: 2 });
    g.monsters.push(m);
    return m;
  };
  const Ch = FE.Char;

  // 招式名單
  ok(FE.CLASS_SPELLS.mage.join() === 'bolt,blast,ward' && FE.CLASS_SPELLS.priest.join() === 'holy,nova,bless' && FE.CLASS_SPELLS.paladin.join() === 'smite,guard', '各職業的招式');
  ok(new FE.Game(1).spellsOf && mk(801, 'warrior', ['sword', 'medium', 'shield', 'herb']).spellsOf().length === 0, '戰士沒有法術');

  // 法杖加成：法師拿法杖，命中加杖術（每 5 級 +1）與法杖品質，傷害加杖術（每 3 級 +1）；沒拿法杖沒有
  {
    const g = mk(802, 'mage', ['staff', 'robe', 'nooff', 'herb']);
    const p = g.player;
    p.attr.int = 16;
    p.skills.staff.lv = 6;
    p.equip.main.q = 2; // 精良：命中 +2
    const a = Ch.profile(p, null, 'bolt');
    ok(a.hit === 3 + 2 + 1 && a.dmg === 3 + 2 && a.skills.join() === 'staff' && a.type === 'magic' && a.die.join() === '1,8', `拿法杖的魔法攻擊：命中 ${a.hit}、傷害 ${a.dmg}`);
    p.equip.main = null;
    const b = Ch.profile(p, null, 'bolt');
    ok(b.hit === 3 && b.dmg === 3 && b.skills.length === 0, `沒拿法杖：命中 ${b.hit}、傷害 ${b.dmg}`);
    // 穿甲的施法減值：中甲 −2、重甲 −4；那一類甲 5 級減半、10 級歸零
    p.equip.body = FE.Gear.make('heavy', 0, g.nextGearId++);
    ok(Ch.castPenalty(p) === 4, '重甲施法 −4');
    p.skills.heavy.lv = 5;
    ok(Ch.castPenalty(p) === 2, '重甲 5 級減半');
    p.skills.heavy.lv = 10;
    ok(Ch.castPenalty(p) === 0, '重甲 10 級歸零');
    p.equip.body = FE.Gear.make('medium', 0, g.nextGearId++);
    ok(Ch.castPenalty(p) === 2 && Ch.profile(p, null, 'bolt').hit === 3 - 2, '中甲施法 −2');
    p.equip.body = FE.Gear.make('robe', 0, g.nextGearId++);
    ok(Ch.castPenalty(p) === 0, '衣袍沒有減值');
  }
  // 聖騎士的懲戒：不吃法杖、不受穿甲減值
  {
    const g = mk(803, 'paladin', ['staff', 'plate', 'nooff', 'herb']);
    const p = g.player;
    p.skills.staff.lv = 9;
    const a = Ch.profile(p, null, 'smite');
    ok(a.hit === Ch.attrMod(p, 'cha') && a.dmg === Ch.attrMod(p, 'cha') && a.die.join() === '1,4' && a.type === 'holy', `懲戒 1d4＋魅力，不吃法杖與穿甲：命中 ${a.hit}`);
  }

  // 大魔法攻擊：打目標與周圍 1 格（智力 +3 起 2 格），冷卻 3 回合
  {
    const g = mk(804, 'mage', ['staff', 'robe', 'nooff', 'herb']);
    const p = g.player;
    p.attr.int = 14;
    const t = mon(g, p.x + 4, p.y);
    const near = mon(g, p.x + 4, p.y + 1);
    const far = mon(g, p.x + 4, p.y + 3);
    let hits = { t: 0, near: 0, far: 0 };
    const hook0 = FE.Combat.hook;
    FE.Combat.hook = (e) => { if (e.by === 'player') { if (e.d === t) hits.t++; else if (e.d === near) hits.near++; else if (e.d === far) hits.far++; } };
    for (let i = 0; i < 5; i++) { Object.assign(t, { x: p.x + 4, y: p.y }); Object.assign(near, { x: p.x + 4, y: p.y + 1 }); Object.assign(far, { x: p.x + 4, y: p.y + 3 }); g.battle.spellCd = {}; g.aimStart('blast'); g.aim.i = g.aim.ids.indexOf(t.id); g.aimFire(); }
    FE.Combat.hook = hook0;
    ok(hits.t === 5 && hits.near === 5 && hits.far === 0, `大魔法攻擊的範圍：目標 ${hits.t}、旁邊 ${hits.near}、3 格外 ${hits.far}`);
    ok(g.spellCd('blast') === 3, '大魔法攻擊冷卻 3 回合');
  }
  // 大神聖攻擊：打周圍 1 格的怪物並推開 2 格（直線）；周圍沒有怪物不能放
  {
    const g = mk(805, 'priest', ['staff', 'robe', 'nooff', 'herb']);
    const p = g.player;
    ok(!g.cast('nova') && /打不到/.test(g.log[0].text), '周圍沒有怪物不能放大神聖攻擊');
    const m = mon(g, p.x + 1, p.y);
    m.ac = FE.ROLL_OLD_AC; // 這裡量的是打中就推開；第三十三版起怪物 AC 15，20 次裡打中的次數看運氣，AC 照第三十二版的分段（等於 AC 6）
    const t0 = g.turn;
    let pushed = 0;
    for (let i = 0; i < 20; i++) {
      m.x = p.x + 1; m.y = p.y;
      g.battle.spellCd = {};
      g.cast('nova');
      if (m.x === p.x + 3) pushed++;
    }
    ok(g.turn === t0 + 20 && pushed > 5, `大神聖攻擊打中就推開 2 格：${pushed}/20`);
  }

  // 防禦招
  {
    const g = mk(806, 'mage', ['staff', 'robe', 'nooff', 'herb']);
    const p = g.player;
    ok(g.cast('ward') && p.ward && p.ward.ac === 3 && g.wardAC() === 3, '魔法防禦 AC +3');
    ok(!g.cast('ward') && /效果結束才能再放/.test(g.log[0].text), '效果還在不能再放');
    // AC：第三十三版起加護真的加 AC（原本是怪物打冒險者的 d20 −3）；怪物出手的加值只有自己的攻擊加值
    const mods = [];
    const acs = [];
    const roll0 = FE.rollD20;
    FE.rollD20 = (r, mod, adv, crit, ac) => { mods.push(mod); acs.push(ac); return roll0(r, mod, adv, crit, ac); };
    const m = mon(g, p.x + 1, p.y);
    FE.Combat.resolveAttack(g, m, p, 'attack', { noCounter: true });
    FE.rollD20 = roll0;
    ok(mods[0] === m.toHit && acs[0] === FE.Gear.playerAC(p) + 3, `魔法防禦讓 AC +3：出手加值 ${mods[0]}、AC ${acs[0]}（沒加護 ${FE.Gear.playerAC(p)}）`);
    // 穿上防具就散掉
    p.equip.body = FE.Gear.make('light', 0, g.nextGearId++);
    ok(g.wardAC() === 0 && !p.ward, '魔法防禦穿上防具就散掉');
    // 穿著防具放不出來
    ok(!g.cast('ward') && /沒有效果/.test(g.log[0].text), '穿著防具放不出魔法防禦');
  }
  {
    const g = mk(807, 'priest', ['staff', 'robe', 'nooff', 'herb']);
    const p = g.player;
    p.attr.wis = 16;
    p.maxHp = p.hp = 30;
    g.cast('bless');
    ok(p.ward.ac === 2 && p.maxHp === 30 + 5 + 3 && p.hp === 38, `神聖加護：AC +2、生命上限與生命 +5＋感知修正值（${p.maxHp}）`);
    g.recalc();
    ok(p.maxHp === FE.Char.maxHp(p, g.level) + 8, '重算生命上限時加護的生命還在');
    // 8 小時後結束：上限扣回去，生命最少 1
    g.ticks = p.ward.until;
    g.afterTurn();
    ok(!p.ward && p.maxHp === FE.Char.maxHp(p, g.level) && p.hp >= 1 && p.hp <= p.maxHp, '8 小時後加護結束，生命上限扣回');
  }
  {
    const g = mk(808, 'paladin', ['sword', 'heavy', 'shield', 'herb']);
    const p = g.player;
    p.attr.cha = 14; // +2
    g.cast('guard');
    ok(p.ward.ac === 1 && p.ward.hits === 4 && p.ward.until - g.ticks <= 400, `守護：AC +1、被打中 2＋魅力修正值次、4 小時（${p.ward.hits} 次）`);
    for (let i = 0; i < 3; i++) g.wardHit();
    ok(!!p.ward, '被打中 3 次守護還在');
    g.wardHit();
    ok(!p.ward, '被打中 4 次守護結束');
  }
  // 按 F 的招式清單：存檔讀回來，加護與冷卻還在
  {
    const g = mk(809, 'priest', ['staff', 'robe', 'nooff', 'herb']);
    g.cast('bless');
    FE.Save.save(g);
    const back = FE.Save.load();
    ok(back && back.game && back.game.player.ward && back.game.player.ward.id === 'bless', '存檔讀回來加護還在');
  }
  useClasses('legacy');
}
UNITS.spells31 = () => { try { testSpells31(); } catch (e) { fail('施法測試拋出例外：' + e.stack); } };
