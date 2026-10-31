// 攻防判定：冒險者、怪物與士兵共用同一套流程（使用者給的流程圖：命中→失手→閃避→暴擊→格擋→反擊）。
// 遊戲內的文字一律叫「怪物」；訊息只寫擲骰結果與看得到的後果。
(function () {
  const C = FE.CONFIG;
  const isPlayer = (game, o) => o === game.player;
  const isSoldier = (o) => !!o && o.role === 'soldier';

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

  // 冒險者一般攻擊＝主手武器的攻擊力＋0～3，重擊＝攻擊力×2＋1～5（品質不加傷害）；怪物與士兵照自己的攻擊力（狂亂忽高忽低）
  // 冒險者的反擊（opts.counter）固定造成 COUNTER_DAMAGE 點，不看武器
  function baseDamage(game, A, kind, opts) {
    const r = game.rng;
    if (isPlayer(game, A) && opts && opts.counter) return C.COUNTER_DAMAGE;
    if (isPlayer(game, A)) {
      const atk = FE.Gear.atkOf(A);
      return kind === 'deep' ? atk * 2 + FE.randInt(r, 1, 5) : atk + FE.randInt(r, 0, 3);
    }
    return A.type === 'VALUE' ? FE.randInt(r, 0, A.atk * 2) : FE.randInt(r, Math.max(1, A.atk - 1), A.atk + 1);
  }

  // 貼在旁邊，而且中間不是斷崖，才打得到
  function adjacent(game, a, b) {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1 && game.world.heightOk(a.x, a.y, b.x, b.y);
  }

  // A 對 D 出手一次。kind 是 'attack' 或 'deep'（重擊）。攻擊方與防守方可以是冒險者、怪物、士兵（怪物與士兵互打）。
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

    // 1. 擲 d20：加減值＝冒險者站的地形（怪物與士兵不吃地形）＋冒險者主手武器的品質命中加值（超重時扣 1 或 2）＋高處加值
    let mod = aP ? (FE.BIOMES[cA.biome].hit || 0) + FE.Gear.hitMod(A) : 0;
    if (cA.h > cD.h) mod += C.HIGH_GROUND;
    else if (cA.h < cD.h) mod -= C.HIGH_GROUND;
    const roll = FE.rollD20(r, mod);
    const dd = defense(game, D);

    let dmg = 0;
    let dodged = false;
    let crit = false;
    let resisted = false;
    let absorbed = 0;
    let reduced = 0;
    if (roll.key !== 'miss') {
      // 2. 沒命中就沒有傷害；失手與命中都讓防守方擲閃避
      const base = baseDamage(game, A, kind, opts);
      // 減半：一般無條件進位；冒險者固定 1 點的反擊減半後最少 0（無條件捨去）
      const half = (n) => (aP && opts.counter ? Math.floor(n / 2) : Math.ceil(n / 2));
      dodged = r() < dd.dodge;
      if (roll.key === 'fumble') {
        dmg = dodged ? 0 : half(base); // 失手：閃開沒傷害，沒閃開吃一半
      } else if (dodged) {
        dmg = half(base); // 命中但被閃開：吃一半
      } else {
        crit = roll.key === 'crit';
        dmg = crit ? base * 2 : base; // 沒閃開：暴擊加倍
      }
      // 抗性在暴擊之後、格擋之前減半（冒險者打怪物時）
      if (aP && dmg > 0 && FE.isResisted(D, kind, FE.Gear.clearLevel(A))) {
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
      // 防具：冒險者挨打時，格擋之後還剩的傷害固定扣身上防具的物理減傷（怪物目前都是物攻），扣完至少吃 1 點
      if (dP && dmg > 0) {
        const cut = FE.Gear.physReduce(D);
        if (cut > 0 && dmg > 1) {
          reduced = Math.min(cut, dmg - 1);
          dmg -= reduced;
        }
      }
    }

    // 訊息：一次攻擊一行。士兵與怪物互打時，只有離冒險者在視野內才寫，免得訊息洗版
    const p = game.player;
    const near = (o) => Math.abs(o.x - p.x) + Math.abs(o.y - p.y) <= C.SIGHT;
    if (aP || dP || near(A) || near(D)) {
      const aName = aP ? '你' : aS ? '士兵' : A.name;
      const dName = dP ? '你' : dS ? '士兵' : D.name;
      const pD = dP ? '你' : dS ? '他' : '牠';
      const head = opts.counter
        ? `${aName}反擊`
        : opts.opportunity
          ? `${aName}趁你轉身出手`
          : aP
            ? kind === 'deep' ? `你對${dName}使出重擊` : `你攻擊${dName}`
            : `${aName}攻擊${dName}`;
      // 擲出 6～10 的「對方必定反擊」只罰冒險者：怪物與士兵擲出 6～10 只是命中
      // 反擊與趁機攻擊本身不能再被反擊，也只寫「命中」
      const rollName = roll.key === 'hard' && (!aP || opts.counter || opts.opportunity) ? '命中' : roll.name;
      const tag = `（擲出 ${roll.n}${mod ? (mod > 0 ? '+' : '') + mod : ''}：${rollName}）`;
      let text;
      if (roll.key === 'miss') {
        text = `${head}${tag}，沒有打中。`;
      } else {
        const parts = [];
        if (roll.key === 'fumble') parts.push('失手了');
        if (dodged) parts.push(`${pD}閃開了`);
        else if (roll.key === 'fumble') parts.push(`${pD}沒閃開`);
        if (roll.key === 'fumble' ? !dodged : dodged) parts.push('只受到一半的傷害');
        if (crit) parts.push('暴擊，傷害加倍');
        let tail = dmg > 0 ? `造成 ${dmg} 點傷害` : absorbed > 0 ? '傷害全被擋下' : '沒有造成傷害';
        if (resisted) tail += '（有抗性，傷害減半）';
        if (absorbed > 0 && dmg > 0) tail += `（${pD}格擋，擋下 ${absorbed} 點）`;
        if (reduced > 0) tail += `（護甲擋下 ${reduced} 點）`;
        text = `${head}${tag}，${parts.concat(tail).join('，')}。`;
      }
      game.say(text, dmg > 0 ? (aP ? 'good' : dP ? 'bad' : 'sys') : 'sys');
    }

    // 磨損：冒險者出手一次磨主手武器一次，格擋成功一次磨盾牌一次，挨打時防具減傷有作用一次磨身上防具一次
    // （每次磨損的機率＝1÷品質價值倍率，見 gear.js 的 wear）
    if (aP && A.equip.main) FE.Gear.wear(game, A.equip.main);
    if (dP && absorbed > 0 && FE.Gear.shieldOf(D)) FE.Gear.wear(game, FE.Gear.shieldOf(D));
    if (dP && reduced > 0 && D.equip.body) FE.Gear.wear(game, D.equip.body);

    // 傷害與倒下
    let killed = false;
    if (dmg > 0) {
      if (dP) {
        D.hp -= dmg;
        if (D.hp <= 0) {
          killed = true;
          game.die(A);
        }
      } else if (dS) {
        D.hp -= dmg;
        if (D.hp <= 0) {
          killed = true;
          game.soldierDown(D, A);
        }
      } else {
        D.hp = Math.max(0, D.hp - dmg);
        if (D.hp <= 0 && game.monsters.includes(D)) {
          killed = true;
          game.defeat(D, aS ? A : null); // 士兵打倒的怪物，冒險者不拿經驗值也不拿算力
        }
      }
    }

    // 6. 反擊：防守方還活著、還貼著，冒險者出手擲出 6～10 時怪物必定反擊，不然擲反擊機率；反擊只能一次，反擊打出的那一下不能再被反擊。
    // 「必定反擊」只罰冒險者：怪物與士兵擲出 6～10 只是命中，對方照自己的反擊機率擲。士兵不反擊（反擊機率 0）
    const alive = !killed && (dP || (dS ? game.soldiers.includes(D) : game.monsters.includes(D)));
    let countered = false;
    if (alive && !dS && !opts.noCounter && adjacent(game, A, D) && ((aP && roll.key === 'hard') || r() < dd.counter)) countered = true;
    if (FE.Combat.hook) {
      FE.Combat.hook({
        by: aP ? 'player' : aS ? 'soldier' : 'monster', kind, key: roll.key, dodged, crit, blocked: absorbed > 0, resisted, reduced, dmg,
        counter: !!opts.counter, opportunity: !!opts.opportunity, countered, killed, a: A, d: D,
      });
    }
    if (countered) resolveAttack(game, D, A, 'attack', { noCounter: true, counter: true });
    return { dmg, killed, roll };
  }

  FE.Combat = { resolveAttack, defense, regenBlock, currentBlock, adjacent, hook: null };
})();
