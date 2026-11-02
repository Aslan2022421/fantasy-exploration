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
  // 怪物看異常、分級與世界等級（bugs.js 的 monsterDef），士兵閃避、格擋、反擊都是 0
  function defense(game, o) {
    if (isPlayer(game, o)) return FE.Gear.playerDefense(o);
    if (isSoldier(o)) return { dodge: 0, counter: 0, block: 0, blockMax: 0 };
    return FE.monsterDef(o);
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
    if (type === 'slash') return phys + (D.equip.body && (D.equip.body.type === 'medium' || D.equip.body.type === 'heavy') ? 1 : 0);
    if (type === 'pierce') return phys - Math.floor(phys * (pierce || 0));
    if (type === 'blunt') return phys - Math.ceil(phys / 2);
    return phys;
  }

  // 傷害（還沒算閃避、抗性、格擋、減傷）。times 是傷害骰擲幾次：暴擊、重擊各讓次數加倍。
  // 冒險者：骰子＋傷害加值（見 char.js 的 profile），徒手固定 BARE_DMG，最少 1；冒險者的反擊固定 COUNTER_DAMAGE（暴擊擲兩次就是 2）。
  // 怪物與士兵照自己的攻擊力（狂亂忽高忽低），暴擊時擲兩次加總
  function baseDamage(game, A, prof, times, opts) {
    const r = game.rng;
    if (isPlayer(game, A) && opts && opts.counter) return C.COUNTER_DAMAGE * times;
    if (isPlayer(game, A)) {
      const raw = prof.die ? FE.rollDice(r, prof.die, times) : C.BARE_DMG * times;
      return Math.max(1, raw + prof.dmg);
    }
    let sum = 0;
    for (let i = 0; i < times; i++) sum += A.type === 'VALUE' ? FE.randInt(r, 0, A.atk * 2) : FE.randInt(r, Math.max(1, A.atk - 1), A.atk + 1);
    return sum;
  }

  // 貼在旁邊，而且中間不是斷崖，才打得到
  function adjacent(game, a, b) {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1 && game.world.heightOk(a.x, a.y, b.x, b.y);
  }

  // 遠程的視線：沿直線看過去，中間有牆、樹、巨石、建築、家具（任何會擋視線的東西，見 SIGHT_BLOCK）就打不到；
  // 中間隔著比兩端都高出 2 階以上的山丘也打不到；穿過還沒創出來的空缺也不行。怪物不擋
  function lineClear(world, a, b) {
    const top = Math.max(world.cell(a.x, a.y).h, world.cell(b.x, b.y).h);
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
      if (!c || (C.SIGHT_BLOCK[c.t] || 0) > 0 || c.h >= top + 2) return false;
    }
  }

  // 冒險者遠程打得到這隻怪物嗎：在最遠射程內、視線沒被擋住（range 是 [正常, 最遠]）
  function canShoot(game, p, m, range) {
    return dist(p, m) <= range[1] && lineClear(game.world, p, m);
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
    const ranged = mode === 'shoot' || mode === 'throw' || mode === 'spell';
    // 冒險者這一下用的武器（反擊用主手）與算法；先記下，免得這一下把武器磨壞了找不到
    const wpn = aP ? (opts.counter ? A.equip.main : opts.weapon !== undefined ? opts.weapon : A.equip.main) : null;
    const prof = aP ? FE.Char.profile(A, mode === 'bash' ? null : wpn, opts.counter ? 'melee' : mode, opts.cleave ? 'cleave' : !!opts.off) : null;
    if (prof && opts.ammoQ !== undefined) prof.pierce = FE.QUALITIES[opts.ammoQ].pierce; // 射出去的箭：穿甲看箭矢的品質

    // 1. 擲 d20：加減值＝冒險者站的地形（怪物與士兵不吃地形）＋冒險者這一下的命中加減（品質、屬性、技能、超重）＋高處加值
    let mod = aP ? (FE.BIOMES[cA.biome].hit || 0) + prof.hit : 0;
    if (cA.h > cD.h) mod += C.HIGH_GROUND;
    else if (cA.h < cD.h) mod -= C.HIGH_GROUND;
    // 優勢與劣勢：各自有幾個來源，兩者同時有就抵消（擲一次）
    const adv = [];
    const dis = [];
    if (D.prone) adv.push('倒地');
    if (aP && D.vexed) adv.push('侵擾');
    if (dP && game.battle.dodge) dis.push('閃避姿態');
    if (A.sapped && !opts.cling) dis.push('削弱');
    if (prof && prof.heavy && !opts.counter) dis.push('重型');
    if (prof && prof.offClumsy) dis.push('副手不順手');
    if (aP && ranged && opts.range && dist(A, D) > opts.range[0]) dis.push('超出正常射程');
    if (aP && ranged && game.adjacentMonsters().length) dis.push('貼著怪物');
    const advState = adv.length && dis.length ? 0 : adv.length ? 1 : dis.length ? -1 : 0;
    // opts.cling：纏著冒險者的目標趁冒險者移開或換目標時出手，不擲 d20 命中，只看冒險者的閃避（閃開就沒事），
    // 沒閃開照一般傷害，不暴擊、不格擋，護甲照扣
    const roll = opts.cling ? { n: 0, dice: [], adv: 0, key: 'hit', name: '命中' } : FE.rollD20(r, mod, advState, aP ? FE.Char.critMin(A, mode === 'bash' ? null : wpn) : 20);
    // 削弱與侵擾用掉了：削弱的目標下一次擲 d20 出手有劣勢；侵擾讓冒險者下一次打牠有優勢
    if (!opts.cling) A.sapped = false;
    if (aP) D.vexed = false;
    const dd = defense(game, D);
    const hitKey = HITS.includes(roll.key);
    const dmgType = prof ? prof.type : null;

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
      dmg = dodged ? 0 : baseDamage(game, A, prof, 1, opts);
      armor();
    } else if (roll.key !== 'miss') {
      // 2. 沒命中就沒有傷害；失手與命中都讓防守方擲閃避
      // 減半：一般無條件進位；冒險者固定 1 點的反擊減半後最少 0（無條件捨去）
      const half = (n) => (aP && opts.counter ? Math.floor(n / 2) : Math.ceil(n / 2));
      dodged = r() < dd.dodge;
      if (roll.key === 'fumble') {
        dmg = dodged ? 0 : half(baseDamage(game, A, prof, deep, opts)); // 失手：閃開沒傷害，沒閃開吃一半
      } else if (dodged) {
        dmg = half(baseDamage(game, A, prof, deep, opts)); // 命中但被閃開：吃一半
      } else {
        crit = roll.key === 'crit';
        dmg = baseDamage(game, A, prof, deep * (crit ? 2 : 1), opts); // 沒閃開：暴擊時傷害骰擲兩次加總
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
    const wornOut = aP && !opts.noWear ? (mode === 'bash' ? FE.Gear.shieldOf(A) : wpn) : null;
    if (wornOut) FE.Gear.wear(game, wornOut);
    if (dP && absorbed > 0 && FE.Gear.shieldOf(D)) FE.Gear.wear(game, FE.Gear.shieldOf(D));
    if (dP && reduced > 0 && D.equip.body) FE.Gear.wear(game, D.equip.body);
    // 技能用了就成長：武器出手一次（打中沒打中都算；遠程另外算射擊）、閃開一次、格擋成功一次各練一次；反擊、盾擊、徒手不練
    // 第二十九版：出手命中 10 點經驗、沒命中 5 點；閃開一次、格擋成功一次、穿著防具被打中而且防具擋下了傷害各 10 點（再乘智力的倍率）
    if (aP && !opts.counter && !opts.noTrain) for (const s of prof.skills) FE.Char.useSkill(game, s, hitKey ? C.SKILL_EXP_HIT : C.SKILL_EXP_MISS);
    if (dP && dodged) FE.Char.useSkill(game, 'dodge', C.SKILL_EXP_DODGE);
    if (dP && absorbed > 0) FE.Char.useSkill(game, 'shield', C.SKILL_EXP_BLOCK);
    if (dP && reduced > 0) FE.Char.useSkill(game, 'armor', C.SKILL_EXP_ARMOR);

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
        shoot: `你朝${dName}射了一箭`,
        throw: `你把${wName}擲向${dName}`,
        spell: `魔力炸開，波及${dName}`,
        bash: `你用盾牌撞向${dName}`,
      };
      const head = opts.counter
        ? `${aName}反擊`
        : opts.opportunity
          ? `${aName}趁你轉身出手`
          : aP
            ? heads[mode] || (kind === 'deep' ? `你對${dName}使出重擊` : opts.cleave ? `你順勢劈向${dName}` : opts.off ? `你用副手攻擊${dName}` : `你攻擊${dName}`)
            : `${aName}攻擊${dName}`;
      // 擲出 6～10 的「對方必定反擊」只罰冒險者：怪物與士兵擲出 6～10 只是命中
      // 反擊與趁機攻擊本身不能再被反擊，也只寫「命中」；遠程打不貼著的目標也不會被反擊
      const rollName = roll.key === 'hard' && (!aP || opts.counter || opts.opportunity || opts.noForced || !adjacent(game, A, D)) ? '命中' : roll.name;
      const advTxt = roll.adv ? `${roll.adv > 0 ? '優勢' : '劣勢'}：${roll.dice.join('、')}，` : adv.length && dis.length ? '優勢與劣勢抵消，' : '';
      const tag = `（${advTxt}擲出 ${roll.n}${mod ? (mod > 0 ? '+' : '') + mod : ''}：${rollName}）`;
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
        by: aP ? 'player' : aS ? 'soldier' : 'monster', kind, mode, key: roll.key, adv: roll.adv, dice: roll.dice, n: roll.n, mod, dodged, crit, blocked: absorbed > 0, resisted, reduced, conCut, grazed, dmg, holy,
        dmgType, mastery: mastery && hitKey && alive ? mastery : null, effects, weapon: wpn, off: !!opts.off,
        counter: !!opts.counter, opportunity: !!opts.opportunity, cling: !!opts.cling, countered, killed, a: A, d: D,
      });
    }
    if (countered) resolveAttack(game, D, A, 'attack', { noCounter: true, counter: true });
    return { dmg, killed, roll, forced, hit: hitKey && !opts.cling, holy };
  }

  FE.Combat = { resolveAttack, defense, regenBlock, currentBlock, adjacent, reduction, lineClear, canShoot, push, dist, DIRS, hook: null };
})();
