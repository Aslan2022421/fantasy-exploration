// 攻防判定：冒險者、怪物與士兵共用同一套流程（使用者給的流程圖：命中→失手→閃避→暴擊→格擋→反擊）。
// 第二十八版：傷害改用骰子、優勢與劣勢、傷害種類、精通、遠程與範圍攻擊（射程、視線）。
// 遊戲內的文字一律叫「怪物」；訊息只寫擲骰結果與看得到的後果。
(function () {
  const C = FE.CONFIG;
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const isPlayer = (game, o) => o === game.player;
  const isSoldier = (o) => !!o && o.role === 'soldier';
  const dist = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  const HITS = ['crit', 'hit', 'hard']; // d20 判定「命中」的三段（被閃開也算命中，只是吃一半傷害）

  // 防禦數字：冒險者看身上的防具（閃避）和副手的盾牌（格擋機率與格擋值，沒拿盾牌是 0，見 gear.js 的 playerDefense），
  // 怪物看世界等級（bugs.js 的 monsterDef；防禦主要是數值塊的 AC），士兵閃避、格擋、反擊都是 0
  function defense(game, o) {
    if (isPlayer(game, o)) return FE.Gear.playerDefense(o);
    if (isSoldier(o)) return { dodge: 0, counter: 0, block: 0, blockMax: 0 };
    return FE.monsterDef(o);
  }

  // AC（第三十三版）：冒險者看身上的防具、敏捷與盾牌（gear.js 的 playerAC），再加法術的加護（魔法防禦、神聖加護、守護，game.wardAC）；
  // 怪物看 SRD 數值塊（bugs.js 的 statMonster），士兵照小怪物（soldierStats）；沒有的當 10
  function acOf(game, o) {
    if (isPlayer(game, o)) return FE.Gear.playerAC(o) + (game.wardAC ? game.wardAC() : 0);
    return o.ac != null ? o.ac : C.BASE_AC;
  }

  // 目前的格擋值：沒設過就是滿的。格擋值扣掉吸收的傷害，每回合回最大值的一部分
  function currentBlock(o, max) {
    if (o.block == null || !Number.isFinite(o.block)) o.block = max;
    return Math.min(o.block, max);
  }
  function regenBlock(game, o) {
    const d = defense(game, o);
    if (d.blockMax > 0) o.block = Math.min(d.blockMax, currentBlock(o, d.blockMax) + d.blockMax * C.BLOCK_REGEN);
  }

  // 傷害種類對防守方減傷的影響（只有冒險者有防具；怪物和士兵目前沒有減傷，到第三十一版才有）。
  // type：slash 揮砍（打中甲、重甲時多擋 1 點）、pierce 穿刺（無視 pierce 比例的物理減傷，無條件捨去）、
  // blunt 鈍擊（無視一半物理減傷，無條件進位）、magic／holy 只看魔法減傷；沒給（怪物的攻擊）照一般物理減傷。回傳要扣幾點
  function reduction(game, D, type, pierce) {
    if (!isPlayer(game, D)) return 0;
    if (type === 'magic' || type === 'holy') return FE.Gear.magicReduce(D);
    const phys = FE.Gear.physReduce(D);
    if (type === 'slash') return phys + (D.equip.body && (FE.GEAR[D.equip.body.type].cls === 'medium' || FE.GEAR[D.equip.body.type].cls === 'heavy') ? 1 : 0);
    if (type === 'pierce') return phys - Math.floor(phys * (pierce || 0));
    if (type === 'blunt') return phys - Math.ceil(phys / 2);
    return phys;
  }

  // 傷害（還沒算閃避、抗性、格擋、減傷）。times 是傷害骰擲幾次：暴擊、重擊各讓次數加倍。
  // 冒險者：骰子＋傷害加值（見 char.js 的 profile），徒手固定 BARE_DMG，最少 1；冒險者的反擊是固定值（gear.js 的 counterDamage，暴擊算兩次）。
  // 怪物與士兵（第三十三版）：照 SRD 數值塊的傷害骰（暴擊時骰子擲兩次）＋傷害加值，有優勢時再加 advDie（哥布林的彎刀），
  // 再乘世界等級的攻擊加成、四捨五入，至少 1；狂亂把這個數字變成 0～兩倍之間忽高忽低。
  // 沒有傷害骰的（場景檢查直接設 m.atk、m.die = null）照第三十二版的攻擊力算：攻擊力 ±1，狂亂 0～兩倍，暴擊時擲兩次加總
  function baseDamage(game, A, prof, times, opts, adv) {
    const r = game.rng;
    if (isPlayer(game, A) && opts && opts.counter) return FE.Gear.counterDamage(A) * times;
    if (isPlayer(game, A)) {
      if (prof.fixedDamage != null) return prof.fixedDamage;
      const raw = prof.die ? FE.rollDice(r, prof.die, times) : C.BARE_DMG * times;
      return Math.max(1, raw + prof.dmg);
    }
    if (A.die) {
      let n = FE.rollDice(r, A.die, times) + (A.dmgBonus || 0);
      if (adv > 0 && A.advDie) n += FE.rollDice(r, A.advDie, times);
      if (A.extraDie) n += FE.rollDice(r, A.extraDie, times); // 每次命中都多擲的（毒、死靈、寒冷、閃電；第三十三版之一），暴擊也擲兩次
      n = Math.round(Math.max(1, n) * FE.wlScale(A.wl, C.WL_BONUS.ATK));
      return Math.max(1, n);
    }
    let sum = 0;
    for (let i = 0; i < times; i++) sum += FE.randInt(r, Math.max(1, A.atk - 1), A.atk + 1);
    return sum;
  }

  // 貼在旁邊，而且中間不是斷崖，才打得到
  function adjacent(game, a, b) {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1 && game.world.heightOk(a.x, a.y, b.x, b.y);
  }

  // 視線（冒險者遠程、怪物看冒險者共用）：沿直線看過去，中間的地形擋多少（見 SIGHT_BLOCK）累積起來。
  // 擋 1 的（巨石、牆、建築）、比兩端都高出 2 階以上的山丘、還沒創出來的空缺，一格就擋死；
  // 樹、家具這些半擋的累積到門檻才擋，門檻＝1＋感知修正值×SIGHT_WIS_STEP（最低 SIGHT_LIMIT_MIN，沒有上限；第三十三版之一）。怪物不擋
  function lineClear(world, a, b, wis = 0) {
    const top = Math.max(world.cell(a.x, a.y).h, world.cell(b.x, b.y).h);
    const limit = Math.max(C.SIGHT_LIMIT_MIN, 1 + wis * C.SIGHT_WIS_STEP);
    let block = 0;
    let x = a.x;
    let y = a.y;
    const dx = Math.abs(b.x - x);
    const dy = -Math.abs(b.y - y);
    const sx = x < b.x ? 1 : -1;
    const sy = y < b.y ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      if (x === b.x && y === b.y) return true;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y += sy;
      }
      if (x === b.x && y === b.y) return true;
      const c = world.cell(x, y);
      if (!c) return false;
      const s = C.SIGHT_BLOCK[c.t] || 0;
      if (s >= 1 || c.h >= top + 2) return false;
      block += s;
      if (block >= limit) return false;
    }
  }

  // 冒險者遠程打得到這隻怪物嗎：在最遠射程內、視線沒被擋住（range 是 [正常, 最遠]；感知越高越看得穿樹林）
  function canShoot(game, p, m, range) {
    return dist(p, m) <= range[1] && lineClear(game.world, p, m, FE.Char.attrMod(p, 'wis'));
  }

  // 推擊：把目標從攻擊方直線推開最多 n 格，下一格走不過去（擋路的地形、斷崖、別的怪物、村民、士兵、寶箱、聚落周圍的圈）就停。回傳推了幾格
  function push(game, A, D, n) {
    const sx = Math.sign(D.x - A.x);
    const sy = Math.sign(D.y - A.y);
    if (sx && sy) return 0; // 只推上下左右的直線
    let moved = 0;
    for (let i = 0; i < n; i++) {
      const nx = D.x + sx;
      const ny = D.y + sy;
      if (!FE.AI.free(game, nx, ny) || !game.world.heightOk(D.x, D.y, nx, ny)) break;
      D.x = nx;
      D.y = ny;
      moved++;
    }
    return moved;
  }

  // A 對 D 出手一次。kind 是 'attack' 或 'deep'（重擊）。攻擊方與防守方可以是冒險者、怪物、士兵（怪物與士兵互打）。
  // opts（冒險者出手時）：
  //   mode：melee（近戰，預設；觸及也是）、shoot（弓箭）、throw（投擲）、spell（法師的範圍魔攻）、bash（戰士盾擊）
  //   weapon：這一下用的武器（雙持時副手的短刀；null 是徒手；沒給就是主手）、off：雙持時副手那一下（傷害不加正的屬性修正值）
  //   range：遠程的 [正常射程, 最遠射程]、ammoQ：射出去的箭的品質（穿甲看它）
  //   holy：這一下命中時多 1d8 神聖傷害（牧師，每個動作只有第一下命中的那一次）
  //   noWear／noTrain：範圍魔攻的第二隻以後不再磨損法杖、不再練技能（一個動作只算一次）
  //   cleave：順劈（巨斧）的第二隻：不加屬性修正值，也不再磨損、練技能
  // opts.noCounter：這一下不觸發反擊（反擊本身、趁機攻擊）；opts.counter／opts.opportunity 只影響訊息與統計。
  // 傷害、倒下（怪物走 game.defeat、冒險者走 game.die、士兵走 game.soldierDown）都在這裡處理；回傳這一下的結果。
  function resolveAttack(game, A, D, kind, opts) {
    opts = opts || {};
    const r = game.rng;
    const aP = isPlayer(game, A);
    const aS = isSoldier(A);
    const dP = isPlayer(game, D);
    const dS = isSoldier(D);
    const cA = game.world.cell(A.x, A.y);
    const cD = game.world.cell(D.x, D.y);
    const mode = aP ? opts.mode || 'melee' : null;
    const ranged = mode === 'shoot' || mode === 'throw' || mode === 'item' || mode === 'spell' || mode === 'light' || !!(FE.SPELLS[mode] && FE.SPELLS[mode].aim);
    // 冒險者這一下用的武器（反擊用主手）與算法；先記下，免得這一下把武器磨壞了找不到
    const wpn = aP ? (opts.counter ? A.equip.main : opts.weapon !== undefined ? opts.weapon : A.equip.main) : null;
    const prof = aP ? opts.item ? FE.Char.itemProfile(A, opts.item) : FE.Char.profile(A, mode === 'bash' ? null : wpn, opts.counter ? 'melee' : mode, opts.cleave ? 'cleave' : !!opts.off) : null;
    if (prof && opts.ammoQ !== undefined) prof.pierce = FE.QUALITIES[opts.ammoQ].pierce; // 射出去的箭：穿甲看箭矢的品質

    // 1. 擲 d20：加減值＝冒險者站的地形（怪物與士兵不吃地形）＋冒險者這一下的命中加減（品質、屬性、技能、超重）＋高處加值；
    // 怪物與士兵加自己的攻擊加值（SRD 數值塊，第三十三版）。d20＋加值到對方的 AC 才命中（acOf；法術的加護算在 AC 裡）
    // 力竭（第三十版）：冒險者出手的 d20 每級 −2
    let mod = aP ? (FE.BIOMES[cA.biome].hit || 0) + prof.hit - C.EXHAUST_D20 * (A.exhaust || 0) : A.toHit || 0;
    if (cA.h > cD.h) mod += C.HIGH_GROUND;
    else if (cA.h < cD.h) mod -= C.HIGH_GROUND;
    // 優勢與劣勢：各自有幾個來源，兩者同時有就抵消（擲一次）
    const adv = [];
    const dis = [];
    if (D.prone) adv.push('倒地');
    if (aP && D.vexed) adv.push('侵擾');
    if (A.sapped && !opts.cling) dis.push('削弱');
    if (prof && prof.heavy && !opts.counter) dis.push('重型');
    if (prof && prof.offClumsy) dis.push('副手不順手');
    if (aP && ranged && opts.range && dist(A, D) > opts.range[0]) dis.push('超出正常射程');
    if (aP && ranged && game.adjacentMonsters().length) dis.push('貼著怪物');
    // 怪物的特性（第三十三版，照 SRD 5.2.1）：
    //   群體戰術：目標旁邊（八個方向貼著，SRD 的 5 呎）有這隻以外的怪物同伴，出手有優勢
    //   靈巧脫身：哥布林貼上來時躲進死角（ai.js 的 nimbleHide），藏著的下一次出手有優勢（用掉就沒了）
    const isMon = !aP && !aS;
    if (isMon && FE.hasTrait(A, 'pack') && game.monsters.some((o) => o !== A && o.hp > 0 && Math.max(Math.abs(o.x - D.x), Math.abs(o.y - D.y)) === 1)) adv.push('群體戰術');
    if (isMon && A.hidden && !opts.cling) adv.push('靈巧脫身');
    const advState = adv.length && dis.length ? 0 : adv.length ? 1 : dis.length ? -1 : 0;
    // opts.cling：纏著冒險者的目標趁冒險者移開或換目標時出手，不擲 d20 命中，只看冒險者的閃避（閃開就沒事），
    // 沒閃開照一般傷害，不暴擊、不格擋，護甲照扣
    const ac = acOf(game, D);
    const roll = opts.cling ? { n: 0, dice: [], adv: 0, key: 'hit', name: '命中' } : FE.rollD20(r, mod, advState, aP ? FE.Char.critMin(A, mode === 'bash' ? null : wpn) : 20, ac);
    // 削弱與侵擾用掉了：削弱的目標下一次擲 d20 出手有劣勢；侵擾讓冒險者下一次打牠有優勢
    if (!opts.cling) A.sapped = false;
    if (aP) D.vexed = false;
    if (!opts.cling) A.hidden = false; // 靈巧脫身的藏身處，出手就露出來了
    const dd = defense(game, D);
    const hitKey = HITS.includes(roll.key);
    const dmgType = prof ? prof.type : null;
    // 易傷與再生看的傷害種類：冒險者看這一下的算法，怪物與士兵看數值塊（怪物打冒險者的減傷照舊不分種類，見 reduction）
    const hitType = prof ? prof.type : A.dmgType || null;
    let vulnerable = false;

    let dmg = 0;
    let dodged = false;
    let crit = false;
    let resisted = false;
    let absorbed = 0;
    let reduced = 0;
    let holy = 0;
    let conCut = 0;
    let grazed = false;
    const deep = kind === 'deep' ? 2 : 1; // 重擊：傷害骰擲兩次
    // 冒險者挨打時，扣身上防具的減傷（照攻擊方的傷害種類），扣完至少吃 1 點；
    // 物理傷害（不是魔法、神聖）在防具減完之後再減體質修正值÷2（捨去），一樣至少吃 1 點（第二十九版）
    const armor = () => {
      if (dP && dmg > 1) {
        const cut = reduction(game, D, dmgType, prof ? prof.pierce : 0);
        if (cut > 0) {
          reduced = Math.min(cut, dmg - 1);
          dmg -= reduced;
        }
      }
      if (dP && dmg > 1 && dmgType !== 'magic' && dmgType !== 'holy') {
        const c = FE.Char.conCut(D);
        if (c > 0) {
          conCut = Math.min(c, dmg - 1);
          dmg -= conCut;
        }
      }
    };
    if (opts.cling) {
      dodged = r() < dd.dodge;
      dmg = dodged ? 0 : baseDamage(game, A, prof, 1, opts, advState);
      armor();
    } else if (roll.key !== 'miss') {
      // 2. 沒命中就沒有傷害；失手與命中都讓防守方擲閃避
      // 減半：一般無條件進位；冒險者固定 1 點的反擊減半後最少 0（無條件捨去）
      const half = (n) => (aP && opts.counter ? Math.floor(n / 2) : Math.ceil(n / 2));
      dodged = r() < dd.dodge;
      if (roll.key === 'fumble') {
        dmg = dodged ? 0 : half(baseDamage(game, A, prof, deep, opts, advState)); // 失手：閃開沒傷害，沒閃開吃一半
      } else if (dodged) {
        dmg = half(baseDamage(game, A, prof, deep, opts, advState)); // 命中但被閃開：吃一半
      } else {
        crit = roll.key === 'crit';
        dmg = baseDamage(game, A, prof, deep * (crit ? 2 : 1), opts, advState); // 沒閃開：暴擊時傷害骰擲兩次加總
      }
      // 易傷（第三十三版，骷髏怕鈍擊）：暴擊之後、抗性之前，這種傷害加倍
      if (dmg > 0 && !dP && !dS && D.vuln && D.vuln.includes(hitType)) {
        dmg *= 2;
        vulnerable = true;
      }
      // 抗性在暴擊之後、格擋之前減半（冒險者打怪物時）
      if (aP && dmg > 0 && FE.isResisted(D, kind, prof.clear)) {
        dmg = half(dmg);
        resisted = true;
      }
      // 格擋：成功就用格擋值吸收傷害
      if (dmg > 0 && dd.blockMax > 0 && r() < dd.block) {
        const cur = Math.floor(currentBlock(D, dd.blockMax));
        absorbed = Math.min(cur, dmg);
        if (absorbed > 0) {
          D.block = currentBlock(D, dd.blockMax) - absorbed;
          dmg -= absorbed;
        }
      }
      // 防具：冒險者挨打時，格擋之後還剩的傷害扣身上防具的減傷，扣完至少吃 1 點
      armor();
      // 神聖：牧師這一下命中時，目標多受 1d8 神聖傷害（只看魔法減傷，至少 1 點；不受閃避、抗性、格擋影響）
      if (aP && opts.holy && hitKey && !opts.counter) {
        holy = Math.max(1, FE.rollDice(r, C.HOLY_DIE, 1) - reduction(game, D, 'holy', 0));
        dmg += holy;
      }
    } else if (aP && !opts.counter && prof.mastery === 'graze' && !prof.off && prof.attr > 0) {
      // 擦掠（巨劍）：沒命中時照樣造成等於屬性修正值的傷害（修正值是正數才有；副手那一下、順劈的第二隻沒有）
      dmg = prof.attr;
      grazed = true;
    }

    // 磨損：冒險者出手一次磨這一下用的武器一次（盾擊磨盾牌），格擋成功一次磨盾牌一次，挨打時防具減傷有作用一次磨身上防具一次
    // （每次磨損的機率＝1÷品質價值倍率，見 gear.js 的 wear）
    const armorId = dP ? FE.Char.armorSkillId(D) : null; // 防具磨壞前先記下穿的是哪一類
    const wornOut = aP && !opts.noWear ? (mode === 'bash' ? FE.Gear.shieldOf(A) : wpn) : null;
    if (wornOut) FE.Gear.wear(game, wornOut);
    if (dP && absorbed > 0 && FE.Gear.shieldOf(D)) FE.Gear.wear(game, FE.Gear.shieldOf(D));
    if (dP && reduced > 0 && D.equip.body) FE.Gear.wear(game, D.equip.body);
    // 技能用了就成長：武器出手一次（打中沒打中都算；遠程另外算射擊）、閃開一次、格擋成功一次各練一次；反擊、盾擊、徒手不練
    // 第二十九版：出手命中 10 點經驗、沒命中 5 點；閃開一次、格擋成功一次、穿著防具被打中而且防具擋下了傷害各 10 點（再乘智力的倍率）
    if (aP && !opts.counter && !opts.noTrain) for (const s of prof.skills) FE.Char.useSkill(game, s, hitKey ? C.SKILL_EXP_HIT : C.SKILL_EXP_MISS);
    if (dP && dodged) FE.Char.useSkill(game, 'dodge', C.SKILL_EXP_DODGE);
    if (dP && dmg > 0 && game.wardHit) game.wardHit(); // 守護：被打中幾次就結束
    if (dP && absorbed > 0) FE.Char.useSkill(game, 'shield', C.SKILL_EXP_BLOCK);
    if (dP && reduced > 0 && armorId) FE.Char.useSkill(game, armorId, C.SKILL_EXP_ARMOR); // 穿哪一類就練哪一項（輕甲、中甲、重甲）

    // 傷害與倒下：倒下的處理（經驗值、修好地形、醒來）等這一下的訊息寫完才做，訊息才會先寫打了多少、再寫倒下
    let killed = false;
    let fall = null;
    if (dmg > 0) {
      if (dP) {
        D.hp -= dmg;
        if (D.hp <= 0) {
          killed = true;
          fall = () => game.die(A);
        }
      } else if (dS) {
        D.hp -= dmg;
        if (D.hp <= 0) {
          killed = true;
          fall = () => game.soldierDown(D, A);
        }
      } else {
        D.hp = Math.max(0, D.hp - dmg);
        // 再生（沼澤巨魔）：被火或酸打到，下一回合不回（REGEN_STOP）
        if (D.regen && C.REGEN_STOP.includes(hitType)) D.noRegen = true;
        if (D.hp <= 0 && game.monsters.includes(D)) {
          killed = true;
          fall = () => game.defeat(D, aS ? A : null); // 士兵打倒的怪物，冒險者不拿經驗值也不拿算力
        }
      }
    }
    const alive = !killed && (dP || (dS ? game.soldiers.includes(D) : game.monsters.includes(D)));

    // 精通：冒險者這一下命中、目標還活著時才有效果（怪物沒有精通）
    const effects = [];
    const mastery = aP && !opts.counter ? prof.mastery : null;
    if (mastery && hitKey && alive && !dP && !dS) {
      if (mastery === 'sap') {
        D.sapped = true;
        effects.push('牠被削弱了，下一次出手有劣勢');
      } else if (mastery === 'vex' && dmg > 0) {
        D.vexed = true;
        effects.push('你抓到了牠的空隙，下一次打牠有優勢');
      } else if (mastery === 'topple' && !D.prone && r() < C.TOPPLE_BASE + prof.attr * C.TOPPLE_PER) {
        D.prone = true;
        effects.push('牠失去平衡倒在地上');
      } else if (mastery === 'push' && !D.boss) {
        const n = push(game, A, D, C.PUSH_DIST);
        if (n > 0) effects.push(`牠被推開了 ${n} 格`);
      } else if (mastery === 'slow' && dmg > 0) {
        // 緩速：命中且造成傷害後，目標下一次移動多花 10 刻（怪物 10 刻動一次，所以牠下一次移動晚一回合，見 ai.js）
        D.slowed = C.SLOW_TURNS;
        effects.push('牠的腳步慢了下來');
      }
    }

    // 訊息：一次攻擊一行。士兵與怪物互打時，只有離冒險者在視野內才寫，免得訊息洗版
    const p = game.player;
    const near = (o) => Math.abs(o.x - p.x) + Math.abs(o.y - p.y) <= C.SIGHT;
    if (aP || dP || near(A) || near(D)) {
      const aName = aP ? '你' : aS ? '士兵' : A.name;
      const dName = dP ? '你' : dS ? '士兵' : D.name;
      const pD = dP ? '你' : dS ? '他' : '牠';
      const wName = wpn ? FE.Gear.name(wpn) : '';
      const heads = {
        shoot: `你用${wpn ? FE.GEAR[wpn.type].name : '武器'}射向${dName}`,
        throw: `你把${wName}擲向${dName}`,
        item: `你把${opts.item ? opts.item.name : '物品'}擲向${dName}`,
        spell: `魔力炸開，波及${dName}`,
        light: `你放出神聖之光，照向${dName}`,
        bash: `你用盾牌撞向${dName}`,
      };
      const head = opts.counter
        ? `${aName}反擊`
        : opts.opportunity
          ? `${aName}趁你轉身出手`
          : aP
            ? heads[mode] || (kind === 'deep' ? `你對${dName}使出重擊` : opts.cleave ? `你順勢劈向${dName}` : opts.off ? `你用副手攻擊${dName}` : `你攻擊${dName}`)
            : `${aName}攻擊${dName}`;
      // 勉強命中（比 AC 高不到 5）的「對方必定反擊」只罰冒險者：怪物與士兵勉強命中只寫「勉強命中」
      // 反擊與趁機攻擊本身不能再被反擊，也只寫「勉強命中」；遠程打不貼著的目標也不會被反擊
      const rollName = roll.key === 'hard' && (!aP || opts.counter || opts.opportunity || opts.noForced || !adjacent(game, A, D)) ? '勉強命中' : roll.name;
      const advTxt = roll.adv ? `${roll.adv > 0 ? '優勢' : '劣勢'}：${roll.dice.join('、')}，` : adv.length && dis.length ? '優勢與劣勢抵消，' : '';
      // 優勢的來源寫在前面（群體戰術、靈巧脫身這類只有怪物有的，玩家才看得懂為什麼）
      const why = roll.adv > 0 && adv.length ? `${adv.join('、')}，` : '';
      const tag = `（${why}${advTxt}擲出 ${roll.n}${mod ? (mod > 0 ? '+' : '') + mod : ''} 對 AC ${roll.ac == null ? ac : roll.ac}：${rollName}）`;
      let text;
      if (opts.cling) {
        text = `${aName}緊緊纏著你，趁你${opts.clingWord || '移開'}出手，${dodged ? '被你閃開了' : `造成 ${dmg} 點傷害${reduced > 0 ? `（護甲擋下 ${reduced} 點）` : ''}${conCut > 0 ? `（你硬挺過去，又少受 ${conCut} 點）` : ''}`}。`;
      } else if (roll.key === 'miss') {
        text = grazed ? `${head}${tag}，沒有打中，但擦傷了${pD}，造成 ${dmg} 點傷害。` : `${head}${tag}，沒有打中。`;
      } else {
        const parts = [];
        if (roll.key === 'fumble') parts.push('失手了');
        if (dodged) parts.push(`${pD}閃開了`);
        else if (roll.key === 'fumble') parts.push(`${pD}沒閃開`);
        if (roll.key === 'fumble' ? !dodged : dodged) parts.push('只受到一半的傷害');
        if (crit) parts.push('暴擊，傷害骰擲兩次');
        let tail = dmg > 0 ? `造成 ${dmg} 點傷害` : absorbed > 0 ? '傷害全被擋下' : '沒有造成傷害';
        if (holy > 0) tail += `（其中 ${holy} 點是神聖之力）`;
        if (vulnerable) tail += '（正中弱點，傷害加倍）';
        if (resisted) tail += '（有抗性，傷害減半）';
        if (absorbed > 0 && dmg > 0) tail += `（${pD}格擋，擋下 ${absorbed} 點）`;
        if (reduced > 0) tail += `（護甲擋下 ${reduced} 點）`;
        if (conCut > 0) tail += `（你硬挺過去，又少受 ${conCut} 點）`;
        text = `${head}${tag}，${parts.concat(tail, effects).join('，')}。`;
      }
      game.say(text, dmg > 0 ? (aP ? 'good' : dP ? 'bad' : 'sys') : 'sys');
    }
    if (fall) fall();

    // 6. 反擊：防守方還活著、還貼著，冒險者出手擲出 6～10 時怪物必定反擊，不然擲反擊機率；反擊只能一次，反擊打出的那一下不能再被反擊。
    // 「必定反擊」只罰冒險者：怪物與士兵擲出 6～10 只是命中，對方照自己的反擊機率擲。士兵不反擊（反擊機率 0）
    let countered = false;
    if (alive && !dS && !opts.noCounter && adjacent(game, A, D) && ((aP && roll.key === 'hard' && !opts.noForced) || r() < dd.counter)) countered = true;
    // 必定反擊（擲出 6～10）是不是這一下觸發的；雙持時主手已經觸發就不再觸發第二次（opts.noForced）
    const forced = countered && aP && roll.key === 'hard' && !opts.noForced;
    if (FE.Combat.hook) {
      FE.Combat.hook({
        by: aP ? 'player' : aS ? 'soldier' : 'monster', kind, mode, key: roll.key, adv: roll.adv, dice: roll.dice, n: roll.n, mod, dodged, crit, blocked: absorbed > 0, resisted, vulnerable, advWhy: adv.slice(), ac, reduced, conCut, grazed, dmg, holy,
        dmgType, mastery: mastery && hitKey && alive ? mastery : null, effects, weapon: wpn, off: !!opts.off,
        counter: !!opts.counter, opportunity: !!opts.opportunity, cling: !!opts.cling, countered, killed, a: A, d: D,
      });
    }
    if (countered) resolveAttack(game, D, A, 'attack', { noCounter: true, counter: true });
    return { dmg, killed, roll, forced, hit: hitKey && !opts.cling, holy };
  }

  FE.Combat = { resolveAttack, defense, regenBlock, currentBlock, adjacent, reduction, lineClear, canShoot, push, dist, DIRS, hook: null };
})();
