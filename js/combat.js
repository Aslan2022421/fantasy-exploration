// 攻防判定：冒險者、隊友、士兵與怪物共用同一套流程（使用者給的流程圖：命中→失手→閃避→暴擊→格擋→反擊）。
// 第三十六版之一：冒險者、隊友、士兵都是有裝備欄的「角色」（isChar），出手與挨打照冒險者那一套（AC、熟練加值、武器骰、防具減傷）；
// 訊息裡的「你」只指玩家操作的那一位（you）；技能只有冒險者與隊友練（士兵不升級），磨損只算冒險者的裝備。
// 第二十八版：傷害改用骰子、優勢與劣勢、傷害種類、精通、遠程與範圍攻擊（射程、視線）。
// 遊戲內的文字一律叫「怪物」；訊息只寫擲骰結果與看得到的後果。
(function () {
  const C = FE.CONFIG;
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const isChar = (o) => !!o && !!o.equip;
  const isSoldier = (o) => !!o && o.role === 'soldier';
  // 玩家操作的那一位（訊息寫「你」）：隊友或冒險者自動行動的那一下不算（game.autoAct）
  const isYou = (game, o) => o === game.player && !game.autoAct;
  const trains = (o) => isChar(o) && !isSoldier(o); // 練技能：冒險者、隊友
  const dist = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)); // 第三十五版之四：八方向，斜走一步算 1 格
  const HITS = ['crit', 'hit', 'hard']; // d20 判定「命中」的三段（被閃開也算命中，只是吃一半傷害）

  // 防禦數字：角色（冒險者、隊友、士兵）看身上的防具（閃避）和副手的盾牌（格擋機率與格擋值，沒拿盾牌是 0，見 gear.js 的 playerDefense），
  // 怪物看世界等級（bugs.js 的 monsterDef；防禦主要是數值塊的 AC）
  function defense(game, o) {
    if (isChar(o)) return FE.Gear.playerDefense(o);
    return FE.monsterDef(o);
  }

  // AC（第三十三版）：角色看身上的防具、敏捷與盾牌（gear.js 的 playerAC），再加法術的加護（魔法防禦、神聖加護、守護，game.wardAC）；
  // 怪物看 SRD 數值塊（bugs.js 的 statMonster）；沒有的當 10
  function acOf(game, o) {
    if (isChar(o)) return FE.Gear.playerAC(o) + (game.wardAC ? game.wardAC(o) : 0);
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

  // 傷害種類對防守方減傷的影響（只有角色有防具；怪物沒有減傷）。
  // type：slash 揮砍（打中甲、重甲時多擋 1 點）、pierce 穿刺（無視 pierce 比例的物理減傷，無條件捨去）、
  // blunt 鈍擊（無視一半物理減傷，無條件進位）、magic／holy 只看魔法減傷；沒給（怪物的攻擊）照一般物理減傷。回傳要扣幾點
  function reduction(game, D, type, pierce) {
    if (!isChar(D)) return 0;
    if (type === 'magic' || type === 'holy') return FE.Gear.magicReduce(D);
    const phys = FE.Gear.physReduce(D);
    if (type === 'slash') return phys + (D.equip.body && (FE.GEAR[D.equip.body.type].cls === 'medium' || FE.GEAR[D.equip.body.type].cls === 'heavy') ? 1 : 0);
    if (type === 'pierce') return phys - Math.floor(phys * (pierce || 0));
    if (type === 'blunt') return phys - Math.ceil(phys / 2);
    return phys;
  }

  // 傷害（還沒算閃避、抗性、格擋、減傷）。times 是傷害骰擲幾次：暴擊、重擊各讓次數加倍。
  // 角色：骰子＋傷害加值（見 char.js 的 profile），徒手固定 BARE_DMG，最少 1；角色的反擊是固定值（gear.js 的 counterDamage，暴擊算兩次）。
  // 怪物（第三十三版）：照 SRD 數值塊的傷害骰（暴擊時骰子擲兩次）＋傷害加值，有優勢時再加 advDie（哥布林的彎刀），
  // 再乘世界等級的攻擊加成、四捨五入，至少 1；狂亂把這個數字變成 0～兩倍之間忽高忽低。
  // 沒有傷害骰的（場景檢查直接設 m.atk、m.die = null）照第三十二版的攻擊力算：攻擊力 ±1，狂亂 0～兩倍，暴擊時擲兩次加總
  function baseDamage(game, A, prof, times, opts, adv) {
    const r = game.rng;
    if (isChar(A) && opts && opts.counter) return FE.Gear.counterDamage(A) * times;
    if (isChar(A)) {
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

  // 貼在旁邊，而且中間不是斷崖，才打得到；斜向相鄰也算貼身（第三十五版之四）
  function adjacent(game, a, b) {
    return dist(a, b) === 1 && game.world.heightOk(a.x, a.y, b.x, b.y);
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

  // 推擊：把目標從攻擊方直線推開最多 n 格，下一格走不過去（擋路的地形、斷崖、別的怪物、村民、士兵、隊友、寶箱、聚落周圍的圈）就停。回傳推了幾格；
  // info 有給的話，撞到擋路的東西停下時 info.blocked 是 true（第三十七版之一：推擊撞牆的傷害與眩暈看它）
  function push(game, A, D, n, info) {
    const sx = Math.sign(D.x - A.x);
    const sy = Math.sign(D.y - A.y);
    if (sx && sy) return 0; // 只推上下左右的直線
    let moved = 0;
    for (let i = 0; i < n; i++) {
      const nx = D.x + sx;
      const ny = D.y + sy;
      if (!FE.AI.free(game, nx, ny) || !game.world.heightOk(D.x, D.y, nx, ny)) {
        if (info) info.blocked = true;
        break;
      }
      D.x = nx;
      D.y = ny;
      moved++;
    }
    return moved;
  }
  // 推不推得動（第三十七版之一，取代原本寫死的「大型推不動」）：怪物照移動抗性擲（100% 一定推不動、0 一定推得動，都不擲骰）；角色一律推得動
  function pushResisted(game, D) {
    if (isChar(D)) return false;
    const res = FE.monsterResist(D).move;
    return res >= 1 || (res > 0 && game.rng() < res);
  }
  // 眩暈（第三十七版之一）：n 次行動出手 d20 −2、不能反擊、控制與移動抗性 −25 個百分點；眩暈中再中一次，就跳過下一次行動，之後眩暈結束。
  // 回傳 'skip'（再中一次）或 'on'
  function stun(m, n) {
    if (m.stunned > 0) {
      m.stunSkip = true;
      return 'skip';
    }
    m.stunned = n;
    return 'on';
  }
  const STUN_TEXT = { on: '牠被打得頭暈眼花', skip: '牠暈得站不穩，下一次行動會停下來' };
  // 角色做完一個動作（冒險者的 endTurn、士兵與隊友的 actorPay）：這個動作沒有出手，蓄勢歸零；走了一格，連續移動的格數 +1，不然歸零（衝刺、原地出手看它）
  function afterAction(c, moved) {
    if (!c.attacked) c.combo = null;
    c.attacked = false;
    c.moveRun = moved ? (c.moveRun || 0) + 1 : 0;
  }

  // A 對 D 出手一次。kind 是 'attack' 或 'deep'（重擊）。攻擊方與防守方可以是冒險者、隊友、士兵、怪物。
  // opts（角色出手時）：mode 等只有角色看；
  //   mode：melee（近戰，預設；觸及也是）、shoot（弓箭）、throw（投擲）、spell（法師的範圍魔攻）、bash（戰士盾擊）
  //   weapon：這一下用的武器（雙持時副手的短刀；null 是徒手；沒給就是主手）、off：雙持時副手那一下（傷害不加正的屬性修正值）
  //   range：遠程的 [正常射程, 最遠射程]、ammoQ：射出去的箭的品質（穿甲看它）
  //   holy：這一下命中時多 1d8 神聖傷害（牧師，每個動作只有第一下命中的那一次）
  //   noWear／noTrain：範圍魔攻的第二隻以後不再磨損法杖、不再練技能（一個動作只算一次）
  //   cleave：順劈（巨斧）的第二隻：不加屬性修正值，也不再磨損、練技能
  // opts.noCounter：這一下不觸發反擊（反擊本身、趁機攻擊）；opts.counter／opts.opportunity 只影響訊息與統計。
  // 傷害、倒下（怪物走 game.defeat、冒險者走 game.die、隊友走 game.mateDown、士兵走 game.soldierDown）都在這裡處理；回傳這一下的結果。
  function resolveAttack(game, A, D, kind, opts) {
    opts = opts || {};
    const r = game.rng;
    const aP = isChar(A);     // 攻擊方是角色（用角色的算法）
    const aS = isSoldier(A);
    const dP = isChar(D);
    const dS = isSoldier(D);
    const aY = isYou(game, A); // 攻擊方是玩家操作的那一位（訊息寫「你」、勉強命中才會被必定反擊）
    const dY = isYou(game, D);
    const hero = game.hero || game.player;
    const nameOf = (o, y) => (y ? '你' : isSoldier(o) ? `士兵${o.name}` : isChar(o) ? o.name : o.name);
    const cA = game.world.cell(A.x, A.y);
    const cD = game.world.cell(D.x, D.y);
    const mode = aP ? opts.mode || 'melee' : null;
    const ranged = mode === 'shoot' || mode === 'throw' || mode === 'item' || mode === 'spell' || mode === 'light' || !!(FE.SPELLS[mode] && FE.SPELLS[mode].aim);
    // 冒險者這一下用的武器（反擊用主手）與算法；先記下，免得這一下把武器磨壞了找不到
    const wpn = aP ? (opts.counter ? A.equip.main : opts.weapon !== undefined ? opts.weapon : A.equip.main) : null;
    const prof = aP ? opts.item ? FE.Char.itemProfile(A, opts.item) : FE.Char.profile(A, mode === 'bash' ? null : wpn, opts.counter ? 'melee' : mode, opts.cleave ? 'cleave' : !!opts.off) : null;
    const edge = (prof && prof.edge) || {}; // 這把武器的一優一劣（第三十七版之一；不看技能等級，一直有）
    // 射出去的箭：穿甲看箭矢的品質（弓箭的劣勢把品質的穿甲減半），再加武器一優一劣的穿甲
    if (prof && opts.ammoQ !== undefined) prof.pierce = Math.min(1, FE.QUALITIES[opts.ammoQ].pierce * (edge.halfQ ? 0.5 : 1) + (edge.pierce || 0));
    // 第三十七版之一：角色自己出手（反擊不算）才看的精通與一優一劣：順勢、蓄勢、回擺、衝刺、原地出手、打貼身的目標
    const track = aP && !opts.counter;
    const mOn = (k) => track && !!prof.masteries && prof.masteries.includes(k);
    const nth = track && A.combo && A.combo.id === D.id ? A.combo.n + 1 : 1; // 連續打同一個目標的第幾下（蓄勢）
    const charge = track && !!edge.charge && (A.moveRun || 0) >= C.CHARGE_STEPS; // 衝刺（騎槍）：連續走了 2 格以上的第一下

    // 1. 擲 d20：加減值＝冒險者站的地形（怪物與士兵不吃地形）＋冒險者這一下的命中加減（品質、屬性、技能、超重）＋高處加值；
    // 怪物加自己的攻擊加值（SRD 數值塊，第三十三版）。d20＋加值到對方的 AC 才命中（acOf；法術的加護算在 AC 裡）
    // 力竭（第三十版）：冒險者出手的 d20 每級 −2
    let mod = aP ? (FE.BIOMES[cA.biome].hit || 0) + prof.hit - C.EXHAUST_D20 * (A.exhaust || 0) : A.toHit || 0;
    if (cA.h > cD.h) mod += C.HIGH_GROUND;
    else if (cA.h < cD.h) mod -= C.HIGH_GROUND;
    // 第三十七版之一：一優一劣（打貼身的目標、原地出手）與精通（順勢、回擺、齊射、後座）的命中加減；眩暈中的怪物出手 −2
    if (track) {
      if (mode === 'melee' && edge.closeHit && dist(A, D) === 1) mod += edge.closeHit;
      if (edge.stillHit && !(A.moveRun > 0)) mod += edge.stillHit;
      if (mOn('sweep') && A.lastTarget != null && A.lastTarget !== D.id) mod += C.SWEEP_HIT;
      if (mOn('backswing') && A.backswing) mod += C.BACKSWING_HIT;
      if (mOn('volley') && ranged && dist(A, D) <= C.VOLLEY_DIST) mod -= C.VOLLEY_D20;
      if (mOn('kickback') && FE.Char.attrMod(A, 'str') < C.KICKBACK_STR) mod -= C.KICKBACK_D20;
    }
    if (!aP && A.stunned > 0) mod -= C.STUN_D20;
    // 優勢與劣勢：各自有幾個來源，兩者同時有就抵消（擲一次）
    const adv = [];
    const dis = [];
    if (D.prone) adv.push('倒地');
    if (aP && D.vexed) adv.push('侵擾');
    if (A.sapped && !opts.cling) dis.push('削弱');
    if (prof && prof.heavy && !opts.counter) dis.push('重型');
    if (prof && prof.offClumsy) dis.push('副手不順手');
    if (aP && ranged && opts.range && dist(A, D) > opts.range[0]) dis.push('超出正常射程');
    if (aP && ranged && game.adjacentMonsters(A).length) dis.push('貼著怪物');
    // 怪物的特性（第三十三版，照 SRD 5.2.1）：（冒險者、隊友、士兵不是怪物，沒有）
    //   群體戰術：目標旁邊（八個方向貼著，SRD 的 5 呎）有這隻以外的怪物同伴，出手有優勢
    //   靈巧脫身：哥布林貼上來時躲進死角（ai.js 的 nimbleHide），藏著的下一次出手有優勢（用掉就沒了）
    const isMon = !aP;
    if (isMon && FE.hasTrait(A, 'pack') && game.monsters.some((o) => o !== A && o.hp > 0 && Math.max(Math.abs(o.x - D.x), Math.abs(o.y - D.y)) === 1)) adv.push('群體戰術');
    if (isMon && A.hidden && !opts.cling) adv.push('靈巧脫身');
    const advState = adv.length && dis.length ? 0 : adv.length ? 1 : dis.length ? -1 : 0;
    // opts.cling：纏著冒險者的目標趁冒險者移開或換目標時出手，不擲 d20 命中，只看冒險者的閃避（閃開就沒事），
    // 沒閃開照一般傷害，不暴擊、不格擋，護甲照扣
    const ac = acOf(game, D);
    let roll = opts.cling ? { n: 0, dice: [], adv: 0, key: 'hit', name: '命中' } : FE.rollD20(r, mod, advState, aP ? FE.Char.critMin(A, mode === 'bash' ? null : wpn) : 20, ac);
    // 短刀的劣勢（第三十七版之一）：勉強命中的範圍放寬到「到 AC、高不到 hardMargin」
    if (edge.hardMargin && roll.key === 'hit' && Number.isFinite(roll.total) && roll.total - roll.ac < edge.hardMargin) {
      roll = Object.assign({}, roll, { key: 'hard', name: FE.ROLL_BANDS.find((b) => b.key === 'hard').name });
    }
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
    let absorbed = 0;
    let reduced = 0;
    let holy = 0;
    let conCut = 0;
    let grazed = false;
    // 重擊：傷害骰擲兩次（巨劍、長柄刀、巨錘、巨棒的優勢是 3 次）；衝刺再加倍
    const deep = (kind === 'deep' ? edge.deepDice || 2 : 1) * (charge ? 2 : 1);
    // 失手（第三十七版之一）：角色命中後擲那把武器的失手率，失手就傷害減半（跟被閃開同時只減半一次）、精通效果都不觸發
    const slip = track && hitKey && !opts.cling && prof.fumble > 0 && r() < prof.fumble;
    const mLive = (k) => mOn(k) && !slip;
    // 角色這一下的傷害：times 次武器骰（baseDamage），暴擊時再加一優一劣的暴擊加骰、致命（多 1 顆）、致死（骰面升一階再多 1 顆），
    // 加蓄勢（連續打同一個目標的第二下 +1×骰數、第三下起 +2×骰數）與後座（+1）。反擊、徒手、固定傷害照 baseDamage
    const hitDamage = (times, isCrit) => {
      if (!track || !prof.die || prof.fixedDamage != null) return baseDamage(game, A, prof, times, opts, advState);
      let p2 = prof;
      let faces = prof.die[1];
      let extra = 0;
      if (isCrit) {
        if (mLive('fatal')) {
          faces = C.DIE_STEPS.find((f) => f > faces) || Math.max(faces, C.DIE_STEPS[C.DIE_STEPS.length - 1]);
          p2 = Object.assign({}, prof, { die: [prof.die[0], faces] });
          extra++;
        }
        if (mLive('deadly')) extra++;
        extra += edge.critDie || 0;
      }
      let n = baseDamage(game, A, p2, times, opts, advState);
      if (extra) n += FE.rollDice(r, [extra, faces], 1);
      if (mLive('forceful') && nth >= 2) n += (nth >= 3 ? 2 : 1) * prof.die[0];
      if (mLive('kickback')) n += C.KICKBACK_DMG;
      return n;
    };
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
        dmg = dodged ? 0 : half(hitDamage(deep, false)); // 擲出 1 的失手：閃開沒傷害，沒閃開吃一半
      } else {
        // 沒閃開：暴擊時傷害骰擲兩次加總；命中但被閃開、或命中後失手（第三十七版之一）：吃一半（兩個都有也只減半一次）
        crit = roll.key === 'crit' && !dodged;
        dmg = hitDamage(deep * (crit ? 2 : 1), crit);
        if (dodged || slip) dmg = half(dmg);
      }
      // 易傷（第三十三版，骷髏怕鈍擊）：暴擊之後、格擋之前，這種傷害加倍
      if (dmg > 0 && !dP && D.vuln && D.vuln.includes(hitType)) {
        dmg *= 2;
        vulnerable = true;
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
    // （每次磨損的機率＝1÷品質價值倍率，見 gear.js 的 wear）。只算冒險者本人的裝備，隊友與士兵的裝備不磨損
    const armorId = dP ? FE.Char.armorSkillId(D) : null; // 防具磨壞前先記下穿的是哪一類
    const wornOut = A === hero && !opts.noWear ? (mode === 'bash' ? FE.Gear.shieldOf(A) : wpn) : null;
    if (wornOut) FE.Gear.wear(game, wornOut);
    if (D === hero && absorbed > 0 && FE.Gear.shieldOf(D)) FE.Gear.wear(game, FE.Gear.shieldOf(D));
    if (D === hero && reduced > 0 && D.equip.body) FE.Gear.wear(game, D.equip.body);
    // 技能用了就成長：武器出手一次（打中沒打中都算；遠程另外算射擊）、閃開一次、格擋成功一次各練一次；反擊、盾擊、徒手不練
    // 第二十九版：出手命中 10 點經驗、沒命中 5 點；閃開一次、格擋成功一次、穿著防具被打中而且防具擋下了傷害各 10 點（再乘智力的倍率）
    if (trains(A) && !opts.counter && !opts.noTrain) for (const s of prof.skills) FE.Char.useSkill(game, s, hitKey ? C.SKILL_EXP_HIT : C.SKILL_EXP_MISS, A);
    if (trains(D) && dodged) FE.Char.useSkill(game, 'dodge', C.SKILL_EXP_DODGE, D);
    if (dP && dmg > 0 && game.wardHit) game.wardHit(D); // 守護：被打中幾次就結束
    if (trains(D) && absorbed > 0) FE.Char.useSkill(game, 'shield', C.SKILL_EXP_BLOCK, D);
    if (trains(D) && reduced > 0 && armorId) FE.Char.useSkill(game, armorId, C.SKILL_EXP_ARMOR, D); // 穿哪一類就練哪一項（輕甲、中甲、重甲）

    // 傷害與倒下：倒下的處理（經驗值、修好地形、醒來）等這一下的訊息寫完才做，訊息才會先寫打了多少、再寫倒下
    let killed = false;
    let fall = null;
    if (dmg > 0) {
      if (dP) {
        D.hp -= dmg;
        if (D.hp <= 0) {
          killed = true;
          fall = D === hero ? () => game.die(A) : dS ? () => game.soldierDown(D, A) : () => game.mateDown(D, A);
        }
      } else {
        D.hp = Math.max(0, D.hp - dmg);
        // 再生（沼澤巨魔）：被火或酸打到，下一回合不回（REGEN_STOP）
        if (D.regen && C.REGEN_STOP.includes(hitType)) D.noRegen = true;
        if (D.hp <= 0 && game.monsters.includes(D)) {
          killed = true;
          fall = () => game.defeat(D, aS ? A : null); // 士兵打倒的怪物，冒險者不拿經驗值也不拿算力（隊友打倒的照冒險者打倒的算）
        }
      }
    }
    let alive = !killed && (dP ? game.isAlive(D) : game.monsters.includes(D));

    // 精通：冒險者這一下命中、目標還活著時才有效果（怪物沒有精通）；第三十七版之一起一把武器可以有好幾種（prof.masteries），命中後失手就都不觸發。
    // 流血、眩暈、定身照機率擲：chance＋出手屬性修正值×5%＋（技能等級−5）×1%＋品質清除等級×2%，最高 50%，再乘（1−目標的抗性，bugs.js 的 FE.monsterResist）
    const effects = [];
    const mastery = aP && !opts.counter ? prof.mastery : null;
    const proc = (k, resist) => {
      const lv = FE.Char.skillLv(A, prof.wskill);
      const c = Math.max(0, Math.min(C.PROC_MAX, FE.MASTERIES[k].chance + prof.attr * C.PROC_ATTR + (lv - C.PROC_SKILL_FROM) * C.PROC_SKILL + prof.clear * C.PROC_CLEAR)) * (1 - resist);
      return c > 0 && r() < c;
    };
    const live = track && !slip && hitKey && alive && !dP ? prof.masteries || [] : [];
    for (const k of live) {
      if (k === 'sap') {
        D.sapped = true;
        effects.push('牠被削弱了，下一次出手有劣勢');
      } else if (k === 'vex' && dmg > 0) {
        D.vexed = true;
        effects.push('你抓到了牠的空隙，下一次打牠有優勢');
      } else if (k === 'topple' && !D.prone && r() < C.TOPPLE_BASE + prof.attr * C.TOPPLE_PER + (edge.topple || 0)) {
        D.prone = true;
        effects.push('牠失去平衡倒在地上');
      } else if (k === 'push' && !pushResisted(game, D)) {
        const info = {};
        const n = push(game, A, D, C.PUSH_DIST, info);
        if (n > 0) effects.push(`牠被推開了 ${n} 格`);
        // 撞到擋路的東西停下：受 1d4 鈍擊並眩暈 1 次行動（第三十七版之一）
        if (info.blocked) {
          const b = FE.rollDice(r, C.PUSH_BUMP_DIE, 1);
          D.hp = Math.max(0, D.hp - b);
          effects.push(`牠撞上擋路的東西，受到 ${b} 點傷害，${STUN_TEXT[stun(D, C.PUSH_BUMP_STUN)]}`);
          if (D.hp <= 0 && game.monsters.includes(D)) {
            killed = true;
            alive = false;
            fall = () => game.defeat(D, aS ? A : null);
            break;
          }
        }
      } else if (k === 'slow' && dmg > 0) {
        // 緩速：命中且造成傷害後，目標下一次移動多花 6 刻（怪物 6 刻動一次，所以牠下一次移動晚一回合，見 ai.js）
        D.slowed = C.SLOW_TURNS;
        effects.push('牠的腳步慢了下來');
      } else if (k === 'bleed' && dmg > 0 && proc(k, FE.monsterResist(D).bleed)) {
        // 流血：每次行動受 1d4（弩是 1d6）＋武器品質的命中加值，每次行動後 30% 止血（ai.js）；再中不疊加，取平均比較高的
        const nb = { die: ((wpn && FE.GEAR[wpn.type].bleedDie) || C.BLEED_DIE).slice(), bonus: prof.qHit || 0, soldier: aS };
        const avg = (b) => (b.die[0] * (b.die[1] + 1)) / 2 + b.bonus;
        if (!D.bleed || avg(nb) > avg(D.bleed)) D.bleed = nb;
        effects.push('牠的傷口血流不止');
      } else if (k === 'stun' && dmg > 0 && proc(k, FE.monsterResist(D).control)) {
        effects.push(STUN_TEXT[stun(D, C.STUN_TURNS)]);
      } else if (k === 'root' && dmg > 0 && proc(k, FE.monsterResist(D).move)) {
        // 定身：接下來 2 次行動不能移動（攻擊照常），閃避歸零（bugs.js 的 monsterDef）
        D.rooted = Math.max(D.rooted || 0, C.ROOT_TURNS);
        effects.push('牠被釘在原地，動彈不得');
      }
    }
    // 記下這一下（順勢看上一下的目標、蓄勢看連續打同一個目標幾下、回擺看上一下有沒有命中；做了出手以外的事由 afterAction 歸零）
    if (track) {
      A.combo = { id: D.id, n: nth };
      A.lastTarget = D.id;
      A.backswing = !hitKey;
      A.attacked = true;
    }

    // 訊息：一次攻擊一行。隊友、士兵與怪物互打時，只有離玩家操作的那一位在視野內才寫，免得訊息洗版
    const p = game.player;
    const near = (o) => dist(o, p) <= C.SIGHT; // 八方向（第三十五版之四）
    if (aY || dY || near(A) || near(D)) {
      const aName = nameOf(A, aY);
      const dName = nameOf(D, dY);
      const pD = dY ? '你' : dP ? '他' : '牠';
      const wName = wpn ? FE.Gear.name(wpn) : '';
      const heads = aY ? {
        shoot: `你用${wpn ? FE.GEAR[wpn.type].name : '武器'}射向${dName}`,
        throw: `你把${wName}擲向${dName}`,
        item: `你把${opts.item ? opts.item.name : '物品'}擲向${dName}`,
        spell: `魔力炸開，波及${dName}`,
        light: `你放出神聖之光，照向${dName}`,
        bash: `你用盾牌撞向${dName}`,
      } : {
        shoot: `${aName}用${wpn ? FE.GEAR[wpn.type].name : '武器'}射向${dName}`,
        throw: `${aName}把${wName}擲向${dName}`,
        spell: `${aName}的魔力炸開，波及${dName}`,
        light: `${aName}放出神聖之光，照向${dName}`,
        bash: `${aName}用盾牌撞向${dName}`,
      };
      heads.bolt = aY ? `你射出魔力，打向${dName}` : `${aName}射出魔力，打向${dName}`;
      heads.holy = aY ? `你放出神聖之光，照向${dName}` : `${aName}放出神聖之光，照向${dName}`;
      const head = opts.counter
        ? `${aName}反擊`
        : opts.opportunity
          ? `${aName}趁${dY ? '你' : dName}轉身出手`
          : aP
            ? heads[mode] || (aY ? (kind === 'deep' ? `你對${dName}使出重擊` : opts.cleave ? `你順勢劈向${dName}` : opts.off ? `你用副手攻擊${dName}` : `你攻擊${dName}`) : `${aName}攻擊${dName}`)
            : `${aName}攻擊${dName}`;
      // 勉強命中（比 AC 高不到 5）的「對方必定反擊」只罰冒險者：怪物與士兵勉強命中只寫「勉強命中」
      // 反擊與趁機攻擊本身不能再被反擊，也只寫「勉強命中」；遠程打不貼著的目標也不會被反擊
      const rollName = roll.key === 'hard' && (!aY || opts.counter || opts.opportunity || opts.noForced || !adjacent(game, A, D)) ? '勉強命中' : roll.name;
      const advTxt = roll.adv ? `${roll.adv > 0 ? '優勢' : '劣勢'}：${roll.dice.join('、')}，` : adv.length && dis.length ? '優勢與劣勢抵消，' : '';
      // 優勢的來源寫在前面（群體戰術、靈巧脫身這類只有怪物有的，玩家才看得懂為什麼）
      const why = roll.adv > 0 && adv.length ? `${adv.join('、')}，` : '';
      const tag = `（${why}${advTxt}擲出 ${roll.n}${mod ? (mod > 0 ? '+' : '') + mod : ''} 對 AC ${roll.ac == null ? ac : roll.ac}：${rollName}）`;
      let text;
      if (opts.cling) {
        text = `${aName}緊緊纏著${dY ? '你' : dName}，趁${dY ? '你' : pD}${opts.clingWord || '移開'}出手，${dodged ? `被${dY ? '你' : pD}閃開了` : `造成 ${dmg} 點傷害${reduced > 0 ? `（護甲擋下 ${reduced} 點）` : ''}${conCut > 0 ? `（${dY ? '你' : pD}硬挺過去，又少受 ${conCut} 點）` : ''}`}。`;
      } else if (roll.key === 'miss') {
        text = grazed ? `${head}${tag}，沒有打中，但擦傷了${pD}，造成 ${dmg} 點傷害。` : `${head}${tag}，沒有打中。`;
      } else {
        const parts = [];
        if (roll.key === 'fumble') parts.push('失手了');
        if (slip) parts.push('手一滑失手了');
        if (dodged) parts.push(`${pD}閃開了`);
        else if (roll.key === 'fumble') parts.push(`${pD}沒閃開`);
        if (roll.key === 'fumble' ? !dodged : dodged || slip) parts.push('只受到一半的傷害');
        if (charge) parts.push('衝刺，傷害骰擲兩次');
        if (crit) parts.push('暴擊，傷害骰擲兩次');
        let tail = dmg > 0 ? `造成 ${dmg} 點傷害` : absorbed > 0 ? '傷害全被擋下' : '沒有造成傷害';
        if (holy > 0) tail += `（其中 ${holy} 點是神聖之力）`;
        if (vulnerable) tail += '（正中弱點，傷害加倍）';
        if (absorbed > 0 && dmg > 0) tail += `（${pD}格擋，擋下 ${absorbed} 點）`;
        if (reduced > 0) tail += `（護甲擋下 ${reduced} 點）`;
        if (conCut > 0) tail += `（${pD}硬挺過去，又少受 ${conCut} 點）`;
        text = `${head}${tag}，${parts.concat(tail, effects).join('，')}。`;
      }
      game.say(text, dmg > 0 ? (aP ? 'good' : dP ? 'bad' : 'sys') : 'sys');
    }
    if (fall) fall();

    // 6. 反擊：防守方還活著、還貼著，冒險者出手擲出 6～10 時怪物必定反擊，不然擲反擊機率；反擊只能一次，反擊打出的那一下不能再被反擊。
    // 「必定反擊」只罰玩家操作的那一位：怪物、士兵與自動行動的隊友擲出 6～10 只是命中，對方照自己的反擊機率擲
    let countered = false;
    // 眩暈中的怪物不能反擊（第三十七版之一）
    if (alive && !opts.noCounter && !(D.stunned > 0) && adjacent(game, A, D) && ((aY && roll.key === 'hard' && !opts.noForced) || r() < dd.counter)) countered = true;
    // 必定反擊（擲出 6～10）是不是這一下觸發的；雙持時主手已經觸發就不再觸發第二次（opts.noForced）
    const forced = countered && aY && roll.key === 'hard' && !opts.noForced;
    if (FE.Combat.hook) {
      FE.Combat.hook({
        by: aS ? 'soldier' : aP ? (A === hero ? 'player' : 'mate') : 'monster', kind, mode, key: roll.key, adv: roll.adv, dice: roll.dice, n: roll.n, mod, dodged, crit, blocked: absorbed > 0, vulnerable, advWhy: adv.slice(), ac, reduced, conCut, grazed, dmg, holy,
        dmgType, mastery: mastery && hitKey && alive && !slip ? mastery : null, effects, weapon: wpn, off: !!opts.off,
        counter: !!opts.counter, opportunity: !!opts.opportunity, cling: !!opts.cling, countered, killed, a: A, d: D, slip, charge, nth,
      });
    }
    if (countered) resolveAttack(game, D, A, 'attack', { noCounter: true, counter: true });
    return { dmg, killed, roll, forced, hit: hitKey && !opts.cling, holy, slip };
  }

  FE.Combat = { resolveAttack, defense, regenBlock, currentBlock, adjacent, reduction, lineClear, canShoot, push, pushResisted, stun, afterAction, dist, DIRS, hook: null };
})();
