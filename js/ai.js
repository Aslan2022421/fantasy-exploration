// 怪物行動：冒險者每做一個動作，所有怪物各做一件事（移動一步或攻擊）。
// 所有怪物在自己的 B 點附近徘徊；會追人的怪物（m.small）看得到冒險者就追；貼在冒險者旁邊的怪物不管追不追人，在自己的回合攻擊（圍攻）；
// 怪物進不了聚落和它周圍那一圈；怪物每走進一格，那一格的穩定值減 STAB_STEP（第三十三版之三，侵蝕拿掉了）。
// 第三十五版之四：怪物、村民、士兵改八方向移動。
// 第三十六版之一：士兵是職業角色（出手照冒險者那一套，charAttack）；隊友與沒被操作的冒險者自動行動（partyTurn）；怪物也打隊友。
(function () {
  const C = FE.CONFIG;
  const DIRS8 = FE.DIRS8; // 第三十五版之四：八方向移動
  const dist = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)); // 八方向：斜走一步也算 1 格

  // 怪物能踏上的格子；聚落和它周圍那一圈是安全區，怪物進不去（追到圈邊就停）
  function free(game, x, y) {
    const w = game.world;
    if (!w.passable(x, y) || w.inBuffer(x, y)) return false;
    return !game.monsterAt(x, y) && !w.npcAt(x, y) && !w.chestAt(x, y) && !game.isPlayerAt(x, y) && !game.soldierAt(x, y);
  }

  // 怪物看不看得到冒險者：SIGHT 步以內、冒險者不在村莊裡，視線跟冒險者遠程同一套（combat.js 的 lineClear），
  // 門檻看這隻怪物數值塊的感知修正值（FE.SRD_WIS；第三十三版之一）
  function canSee(world, m, p) {
    if (dist(m, p) > C.SIGHT || world.inVillage(p.x, p.y)) return false;
    return FE.Combat.lineClear(world, m, p, FE.SRD_WIS[m.srd] || 0);
  }

  // 走到 arrived(x, y) 成立的格子的最短路的第一步
  function stepToward(game, m, arrived) {
    const prev = new Map([[m.x + ',' + m.y, null]]);
    const q = [[m.x, m.y]];
    for (let h = 0; h < q.length && h < 600; h++) {
      const [x, y] = q[h];
      if (arrived(x, y)) {
        let k = x + ',' + y;
        let step = null;
        while (prev.get(k) !== null) {
          step = k;
          k = prev.get(k);
        }
        return step ? step.split(',').map(Number) : null;
      }
      for (const [dx, dy] of DIRS8) {
        const nx = x + dx;
        const ny = y + dy;
        const nk = nx + ',' + ny;
        if (prev.has(nk) || !free(game, nx, ny) || !game.world.canStep(x, y, nx, ny)) continue; // 八方向+斜走規則（第三十五版之四）
        prev.set(nk, x + ',' + y);
        q.push([nx, ny]);
      }
    }
    return null;
  }

  // 貼在旁邊，而且中間不是斷崖，才算纏得上：斜走一步也是貼身（第三十五版之四）
  function touching(game, m, p) {
    return dist(m, p) === 1 && game.world.heightOk(m.x, m.y, p.x, p.y);
  }

  function giveUp(game, m) {
    if (m.chaseSteps >= C.CHASE_LIMIT && dist(m, game.player) <= C.SIGHT) {
      game.say(`${m.name}不追了，往回走。`, 'sys');
    }
    m.chase = 0;
    m.chaseSteps = 0;
    m.returning = true;
    m.returnTurns = 0;
  }

  // 怪物移動到 (x, y)：走進的那一格穩定值當下減 STAB_STEP（第三十三版之三，使用者定的；怪物每次移動都算）
  function moveTo(game, m, x, y) {
    m.x = x;
    m.y = y;
    game.world.addStab(x, y, -C.STAB_STEP);
    game.triggerTrap(m, x, y);
  }

  function burn(game, m) {
    if (!m.burning) return;
    const dmg = FE.randInt(game.rng, 1, 4);
    m.burning--;
    m.hp = Math.max(0, m.hp - dmg);
    if (dist(m, game.player) <= C.SIGHT) game.say(`${m.name}被火焰燒灼，受到 ${dmg} 點傷害。`, 'bad');
    if (m.hp <= 0 && game.monsters.includes(m)) game.defeat(m);
  }

  // 回生成點：回到徘徊範圍內就恢復正常；路被堵住太久，就改在當下的位置徘徊
  function returnHome(game, m) {
    const near = (x, y) => Math.abs(x - m.home.x) + Math.abs(y - m.home.y) <= C.WANDER_LEASH;
    if (!near(m.x, m.y)) {
      const s = stepToward(game, m, near);
      if (s) moveTo(game, m, s[0], s[1]);
      else if (++m.returnTurns > 20) m.home = { x: m.x, y: m.y };
    }
    if (near(m.x, m.y)) m.returning = false;
  }

  function wander(game, m) {
    if (game.rng() >= C.WANDER_CHANCE) return;
    const options = DIRS8.map(([dx, dy]) => [m.x + dx, m.y + dy]).filter(
      ([x, y]) => free(game, x, y) && game.world.canStep(m.x, m.y, x, y) && dist({ x, y }, m.home) <= (m.guard ? 1 : C.WANDER_LEASH) // 八方向，使用斜走規則（第三十五版之四）
    );
    if (!options.length) return;
    const [x, y] = FE.pick(game.rng, options);
    moveTo(game, m, x, y);
  }

  // 一群小怪物的難度評級（參考《奇幻探索物語》）：生命值＋單回合最高傷害＋數量
  function rating(group) {
    const maxDmg = (m) => m.atk + 1;
    return group.reduce((s, m) => s + m.hp + maxDmg(m), 0) + group.length;
  }

  // 合體：彼此在 MERGE_RADIUS 步以內、會追人的怪物（m.small）算一群；夠多隻、難度評級又超過冒險者生命上限
  // （門檻看世界狀態），就合成一隻中型怪物。打倒牠時，原本每隻怪物負責的錯一起修好。
  function tryMerge(game) {
    const smalls = game.monsters.filter((m) => m.small);
    const ratio = C.MERGE_RATIO * FE.Stability.mult(game, 'MERGE');
    const seen = new Set();
    for (const start of smalls) {
      if (seen.has(start)) continue;
      const group = [start];
      seen.add(start);
      for (let i = 0; i < group.length; i++) {
        for (const o of smalls) {
          if (!seen.has(o) && dist(o, group[i]) <= C.MERGE_RADIUS) {
            seen.add(o);
            group.push(o);
          }
        }
      }
      if (group.length < C.MERGE_MIN || rating(group) < ratio * game.player.maxHp) continue;
      // 正貼著冒險者的怪物不合體，免得打到一半牠不見了
      if (group.some((m) => touching(game, m, game.player))) continue;
      merge(game, group);
    }
  }

  function merge(game, group) {
    const counts = {};
    for (const m of group) counts[m.type] = (counts[m.type] || 0) + 1;
    const type = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
    const cx = group.reduce((s, m) => s + m.x, 0) / group.length;
    const cy = group.reduce((s, m) => s + m.y, 0) / group.length;
    // 落腳點挑群裡離中心最近的那一隻的位置（每隻都在圈外，所以也在圈外）
    let at = group.slice().sort((a, b) => dist(a, { x: cx, y: cy }) - dist(b, { x: cx, y: cy }))[0];
    game.monsters = game.monsters.filter((m) => !group.includes(m));
    if (game.world.inBuffer(at.x, at.y)) at = game.findFreeNear(at.x, at.y) || at;
    // 第三十三版之二：動盪、失序時有機率套上營地（失序的營地，清掉後留下遺留地點）；BUG 量配不上任何營地就照舊合成一隻。
    // 第三十三版之三：合進去的怪物身上的 bug 加總就是這一群的 BUG 量；營地配掉的不夠的零頭留在格子裡，合體怪物帶走全部
    const st = FE.Stability.state(game);
    const scope = group.reduce((s, m) => s + m.scope, 0);
    const bug = group.reduce((s, m) => s + m.bug, 0);
    if (C.CAMP_CHANCE[st] > 0 && game.rng() < C.CAMP_CHANCE[st]) {
      const pick = game.compose(at.x, at.y, bug, { camps: true, campaign: false });
      if (pick.camp) {
        const d = { type, x: at.x, y: at.y, cells: group.flatMap((m) => m.cells), scope, data: {} };
        const camp = game.spawnList(d, pick.list, null, { camp: pick.camp, origin: 'disorder' });
        if (camp.length) {
          for (const m of camp) m.members = group; // 最後倒下的那隻把合進來的錯一起修好
          game.spillDebt(camp[0].x, camp[0].y, bug - camp.reduce((s, m) => s + m.bug, 0));
          game.say(`${group.length} 隻怪物沒有清掉，聚成了一座${FE.CAMPS[pick.camp].name}！`, 'bug');
          return;
        }
        game.monsters.push(...group); // 放不下就放回去，下次再合
        return;
      }
    }
    const wl = FE.Stability.worldLevel(game);
    const big = FE.makeMonster(
      { type, x: at.x, y: at.y, cells: group.flatMap((m) => m.cells), scope: group.reduce((s, m) => s + m.scope, 0), data: {} },
      game.nextMonsterId++,
      wl
    );
    big.tier = 'mid'; // 合體生出的一律是中型怪物，就算加總的影響範圍不到 5
    // 種族看環境，AC、攻擊加值、傷害照那個種族中型怪物的數值塊（第三十三版，原本是群裡最高的攻擊力 +1、最多 9）；
    // 血量照舊是群裡的血量加總，最多 150（乘世界等級的加成）
    FE.dressMonster(big, game.world, game.rng);
    big.bug = bug; // 身上的 BUG 值是合進去的加總（dressMonster 換數值塊時會改成那個數值塊的值）
    big.maxHp = Math.min(Math.round(150 * FE.wlScale(wl, C.WL_BONUS.HP)), group.reduce((s, m) => s + m.maxHp, 0));
    big.hp = Math.min(big.maxHp, group.reduce((s, m) => s + m.hp, 0));
    big.exp = group.reduce((s, m) => s + m.exp, 0);
    big.compute = group.reduce((s, m) => s + m.compute, 0); // 合進去的怪物給的算力加總
    big.members = group;
    game.monsters.push(big);
    game.say(`${group.length} 隻怪物沒有清掉，合成了一隻${big.name}！`, 'bug');
  }

  // ---- 怪物的特性（第三十三版，照 SRD 5.2.1；群體戰術與易傷在 combat.js）----
  // 再生（沼澤巨魔，SRD 的 Troll 15 點、Troll Limb 5 點，第三十六版之一下修成 6 與 2）：每回合開頭回 regen 點生命；上一次被火或酸打到（m.noRegen）這一回合不回。
  // SRD 裡生命歸零還要「回合開頭沒有再生」才死，這一版照舊歸零就倒下
  function regenerate(game, m) {
    if (!m.regen) return;
    if (m.noRegen) {
      m.noRegen = false;
      return;
    }
    if (m.hp <= 0 || m.hp >= m.maxHp) return;
    const n = Math.min(m.regen, m.maxHp - m.hp);
    m.hp += n;
    if (dist(m, game.player) <= C.SIGHT) game.say(`${m.name}的傷口蠕動著長了回來（+${n}）。`, 'sys');
  }
  // 靈巧脫身（哥布林，SRD 的 Nimble Escape：附贈動作躲藏）：貼上冒險者的那一回合（剛移動，還不能出手）擲 d20＋潛行（SRD 的 Stealth +6）
  // 對冒險者的被動察覺（10＋感知修正值），到了就藏著，下一次出手有優勢（彎刀再多擲 1d4，見 combat.js）。SRD 的躲藏要有遮蔽，這一版不看地形
  function nimbleHide(game, m) {
    if (!FE.hasTrait(m, 'nimble') || m.hidden) return;
    const passive = 10 + FE.Char.attrMod(game.player, 'wis');
    if (FE.randInt(game.rng, 1, 20) + (m.stealth || 0) < passive) return;
    m.hidden = true;
    game.say(`${m.name}一閃身，躲進了你看不到的地方。`, 'bad');
  }

  // 每個怪物做一件事：貼在冒險者旁邊就攻擊，不然追人、回生成點或徘徊（移動一步）。
  // 回合開頭就貼著才攻擊，剛移動到旁邊的那一回合不攻擊（移動或攻擊擇一）。
  function worldTurn(game) {
    const p = game.player;
    const safe = game.world.inVillage(p.x, p.y);
    // 玩家操作的那一位以外的隊員（隊友、沒被操作的冒險者）與士兵：怪物貼著他們也會打
    const others = () => game.party().filter((c) => c !== p).concat(game.soldiers).filter((c) => game.isAlive(c));
    const before = new Map(game.monsters.map((m) => [m, m.x + ',' + m.y])); // 靈巧脫身看這一回合有沒有移動
    for (const m of game.monsters.slice()) {
      if (!game.monsters.includes(m)) continue; // 被反擊打倒了
      burn(game, m);
      if (!game.monsters.includes(m)) continue;
      FE.Combat.regenBlock(game, m);
      regenerate(game, m);
      // 倒地（失衡）：這一回合不能動，爬起來就過了
      if (m.prone) {
        m.prone = false;
        if (dist(m, p) <= C.SIGHT) game.say(`${m.name}從地上爬了起來。`, 'sys');
        continue;
      }
      if (!safe && touching(game, m, p)) {
        // 追人的怪物纏上之後一直記得冒險者；不追人、只徘徊的怪物也照樣攻擊
        if (m.small) {
          m.chase = C.CHASE_MEMORY;
          m.chaseSteps = 0;
          m.returning = false;
        }
        FE.Combat.resolveAttack(game, m, p, 'attack');
        if (game.fell) return; // 冒險者倒下了，已經回到醒來的地方
        continue;
      }
      // 緩速（鞭子、輕弩的精通）：下一次移動多花 6 刻，怪物 6 刻動一次，所以這一回合牠要移動的話就停在原地（攻擊不受影響）
      const allies = others();
      const soldierNear = allies.some((s) => touching(game, m, s));
      if (m.slowed > 0 && !soldierNear) {
        m.slowed--;
        continue;
      }
      // 纏上：冒險者設定的目標（撞上去設的）跟著冒險者走，保持貼著（路徑被擋就照追擊的走法盡量貼近），
      // 一直打到牠倒下、冒險者撤退成功或倒下才放開。冒險者在聚落裡時牠進不去，照平常行動，出來後再纏上。
      // 貼上之後的下一回合才攻擊（移動或攻擊擇一）
      if (!safe && m.id === game.battle.targetId) {
        const s = stepToward(game, m, (x, y) => Math.abs(x - p.x) + Math.abs(y - p.y) === 1 && game.world.heightOk(x, y, p.x, p.y));
        if (s) {
          moveTo(game, m, s[0], s[1]);
          if (!m.small) m.home = { x: m.x, y: m.y }; // 不追人的怪物放開之後就在這裡徘徊
        }
        if (m.small) {
          m.chase = C.CHASE_MEMORY;
          m.chaseSteps = 0;
          m.returning = false;
        }
        continue;
      }
      // 貼著士兵、隊友的怪物也會攻擊（照角色挨打的算法）；同時貼著幾位就打血量最少的
      if (allies.length) {
        const near = allies.filter((s) => touching(game, m, s)).sort((a, b) => a.hp - b.hp)[0];
        if (near) {
          FE.Combat.resolveAttack(game, m, near, 'attack');
          if (game.fell) return; // 沒被操作的冒險者被打倒了，已經回到醒來的地方
          continue;
        }
      }
      if (m.small && m.returning) {
        returnHome(game, m);
        continue;
      }
      if (m.small) {
        const sees = canSee(game.world, m, p);
        if (sees) m.chase = C.CHASE_MEMORY;
        else if (m.chase > 0) m.chase--;
        if (m.chase > 0) {
          const s = stepToward(game, m, (x, y) => Math.abs(x - p.x) + Math.abs(y - p.y) === 1 && game.world.heightOk(x, y, p.x, p.y));
          if (s) moveTo(game, m, s[0], s[1]);
          // 走不過去（冒險者在聚落周圍的圈裡，怪物追到圈邊）也算追了一步，追滿 CHASE_LIMIT 就回生成點
          m.chaseSteps++;
          // 沒纏上冒險者：追太多步，或看不到之後追丟了，就回生成點
          if (m.chaseSteps >= C.CHASE_LIMIT || m.chase === 0) giveUp(game, m);
          continue;
        }
      }
      wander(game, m);
    }
    // 靈巧脫身：這一回合移動之後貼著冒險者的哥布林，躲進冒險者的死角
    if (!safe) for (const m of game.monsters) if (before.has(m) && before.get(m) !== m.x + ',' + m.y && touching(game, m, p)) nimbleHide(game, m);

    tryMerge(game);
  }

  // 村民在自己的聚落裡走動，不出聚落，也不進別人的建築；走一走會回家，在家待一陣子再出門。
  // 鐵匠、武器匠、盔甲匠固定站在工坊裡；等著被招的人（第三十六版之二）站在原地等
  function npcTurn(game) {
    const w = game.world;
    for (const n of w.npcs) {
      if (FE.Gear.isShopkeeper(n) || n.role === 'recruit' || game.rng() >= C.NPC_MOVE_CHANCE) continue;
      const v = w.villageById(n.villageId);
      if (!v) continue;
      const open = (fx, fy, x, y) =>
        w.villageAt(x, y) === v && w.canStep(fx, fy, x, y) && FE.Steading.canWalk(v, n, x, y) && !w.npcAt(x, y) && !w.chestAt(x, y) && !game.isPlayerAt(x, y) && !game.soldierAt(x, y);
      if (n.home && n.mode === 'home') {
        const [hx, hy] = n.home.spot;
        if (n.x === hx && n.y === hy) {
          if (game.rng() < C.NPC_LEAVE_CHANCE) n.mode = 'out';
          continue;
        }
        const s = npcPath(n, hx, hy, open);
        if (s) [n.x, n.y] = s;
        else if (game.rng() < 0.2) n.mode = 'out'; // 路被堵住，先在外面走走
        continue;
      }
      const options = DIRS8.map(([dx, dy]) => [n.x + dx, n.y + dy]).filter(([x, y]) => open(n.x, n.y, x, y)); // 八方向（第三十五版之四）
      if (options.length) [n.x, n.y] = FE.pick(game.rng, options);
      if (n.home && game.rng() < C.NPC_HOME_CHANCE) n.mode = 'home';
    }
  }

  // 村民回家的最短路的第一步
  function npcPath(n, tx, ty, open) {
    const prev = new Map([[n.x + ',' + n.y, null]]);
    const q = [[n.x, n.y]];
    for (let h = 0; h < q.length && h < 2000; h++) {
      const [x, y] = q[h];
      if (x === tx && y === ty) {
        let k = x + ',' + y;
        let step = null;
        while (prev.get(k) !== null) {
          step = k;
          k = prev.get(k);
        }
        return step ? step.split(',').map(Number) : null;
      }
      for (const [dx, dy] of DIRS8) {
        const nx = x + dx;
        const ny = y + dy;
        const nk = nx + ',' + ny;
        if (prev.has(nk) || !open(x, y, nx, ny)) continue; // 八方向（第三十五版之四）
        prev.set(nk, x + ',' + y);
        q.push([nx, ny]);
      }
    }
    return null;
  }

  // ---- 士兵 ----
  // 士兵跟怪物照同一個時鐘（第三十版）：每 6 刻做一個動作（移動、出手或站著不動）；失序時冒險者的動作花兩倍的刻，士兵跟怪物一樣多動一次。
  // 平常：在自己的城鎮裡室外走動（跟村民一樣，不進建築）；在城外就走回城鎮。
  // 出城（第三十六版之二：每天照世界狀態擲，見 game.sortieDay；原本是失序就一律出城）：追打城外 16 格內衰敗生的小怪物（m.small）
  // 與牠們合成的中型怪物、營地（m.members，第三十六版之三），創世時與戰役的怪物一律不碰，免得冒險者解不出下一塊。
  // 附近沒有這些怪物（打完了或本來就沒有）就結束出城、走回城裡。
  // 士兵可以走進聚落周圍的圈，怪物不行。
  const inBuilding = (w, x, y) => {
    const v = w.villageAt(x, y);
    return !!v && FE.Steading.roomAt(v, x, y) >= 0;
  };

  function soldierTurn(game) {
    if (!game.soldiers.length) return;
    const w = game.world;
    const st = FE.Stability.stat(game);
    const k = (x, y) => x + ',' + y;
    // 被占住的格子：整理一次，找路時直接查。士兵另外記：找路時隊友只擋第一步，
    // 不然 3 位士兵在路上互相擋，最短路每回合換方向，整隊原地來回走
    const occ = new Set();
    for (const m of game.monsters) occ.add(k(m.x, m.y));
    for (const n of w.npcs) occ.add(k(n.x, n.y));
    for (const c of w.chests) occ.add(k(c.x, c.y));
    for (const c of game.party()) occ.add(k(c.x, c.y));
    const mates = new Set(game.soldiers.map((s) => k(s.x, s.y)));
    // 士兵打的：衰敗生的小怪物（m.small），以及小怪物沒清掉合成的中型怪物、失序聚成的營地（m.members；第三十六版之三，使用者選的：
    // 失序時小怪物幾乎一出現就合體，只打小怪物的話士兵出城就找不到目標）。創世時的怪物、戰役的怪物不歸士兵打，牠們旁邊的格子也不走（不然路過就被打倒）
    const isPrey = (m) => m.small || !!m.members;
    const danger = new Set();
    for (const m of game.monsters) if (!isPrey(m)) for (const [dx, dy] of DIRS8) danger.add(k(m.x + dx, m.y + dy)); // 八方向（第三十五版之四）
    const open = (x, y) => w.passable(x, y) && !occ.has(k(x, y)) && !inBuilding(w, x, y) && !danger.has(k(x, y));
    const free = (x, y) => open(x, y) && !mates.has(k(x, y));

    // 走到 goal(x, y) 成立的格子的最短路的第一步（第三十五版之四：八方向尋路）
    const stepToward = (s, goal) => {
      const prev = new Map([[k(s.x, s.y), null]]);
      const q = [[s.x, s.y]];
      for (let h = 0; h < q.length && h < C.SOLDIER_SEARCH; h++) {
        const [x, y] = q[h];
        if (h > 0 && goal(x, y)) {
          let key = k(x, y);
          let step = null;
          while (prev.get(key) !== null) {
            step = key;
            key = prev.get(key);
          }
          return step ? step.split(',').map(Number) : null;
        }
        for (const [dx, dy] of DIRS8) {
          const nx = x + dx;
          const ny = y + dy;
          const nk = k(nx, ny);
          if (prev.has(nk) || !(h === 0 ? free(nx, ny) : open(nx, ny)) || !w.canStep(x, y, nx, ny)) continue; // 八方向+斜走規則
          prev.set(nk, k(x, y));
          q.push([nx, ny]);
        }
      }
      return null;
    };
    const moveTo = (s, x, y) => {
      mates.delete(k(s.x, s.y));
      s.x = x;
      s.y = y;
      mates.add(k(x, y));
      actorPay(game, s, 'move'); // 第三十六版之四：照士兵自己的刻數
    };

    const preyCache = new Map();
    st.soldierSlots += game.soldiers.length;
    for (const s of game.soldiers.slice()) {
      if (!game.soldiers.includes(s)) continue;
      st.soldierActs++;
      FE.Combat.regenBlock(game, s);
      const v = w.villageById(s.villageId);
      if (!v) continue;
      if (!actorReady(s)) continue; // 第三十六版之四：上一個動作的刻還沒走完
      const oweBefore = s.owe;
      const home = (x, y) => w.villageAt(x, y) === v;
      // 城鎮外 16 格內衰敗生的小怪物（m.small），創世時的怪物不碰
      // （第三十二版小塊變成 24×24，不再用「城鎮所在那一塊」，改成跟原本 64×64 一塊差不多的範圍）
      let prey = null;
      if (game.sortieOn(v)) {
        const around = (m) => m.x >= v.x0 - 16 && m.x <= v.x1 + 16 && m.y >= v.y0 - 16 && m.y <= v.y1 + 16;
        if (!preyCache.has(v)) preyCache.set(v, game.monsters.filter((m) => isPrey(m) && around(m)));
        prey = preyCache.get(v).filter((m) => game.monsters.includes(m));
        if (!prey.length) v.sortieUntil = 0; // 打完了或附近沒有：結束出城，走回城裡
      }
      if (prey && prey.length) {
        const adj = prey.filter((m) => FE.Combat.adjacent(game, s, m)).sort((a, b) => a.hp - b.hp)[0];
        // 士兵比小怪物弱，要一起打才贏：同一座城鎮的士兵跟著第一位（隊長）走，
        // 隊長等其他人都跟到 2 步內，才往同一隻小怪物前進
        const squad = game.soldiers.filter((o) => o.villageId === s.villageId);
        const lead = squad[0];
        const near = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) <= 2;
        const gathered = squad.every((o) => o === lead || near(o, lead));
        const target = prey.slice().sort((a, b) => Math.abs(a.x - v.cx) + Math.abs(a.y - v.cy) - (Math.abs(b.x - v.cx) + Math.abs(b.y - v.cy)))[0];
        if (adj) {
          st.soldierAttacks++;
          charAttack(game, s, adj);
          actorPay(game, s, 'attack');
        } else if (s !== lead && target && !near(s, lead)) {
          const step = stepToward(s, (x, y) => Math.abs(x - lead.x) + Math.abs(y - lead.y) <= 1);
          if (step) moveTo(s, step[0], step[1]);
        } else if (s === lead && target && !gathered && (s.wait = (s.wait || 0) + 1) <= C.SOLDIER_GATHER_WAIT) {
          // 隊長原地等其他人；等太久（有人被擋住）就先走
        } else {
          if (s === lead) s.wait = 0;
          const at = new Set(target ? [k(target.x, target.y)] : []);
          const goal = (x, y) => DIRS8.some(([dx, dy]) => at.has(k(x + dx, y + dy)) && w.canStep(x, y, x + dx, y + dy)); // 八方向＋斜走規則（第三十五版之四）
          const step = target ? stepToward(s, goal) : null;
          if (step) moveTo(s, step[0], step[1]);
          else {
            // 打不到：在城鎮附近（聚落周圍的圈）巡邏；跑到圈外就走回來
            if (!w.inBuffer(s.x, s.y)) {
              const back = stepToward(s, (x, y) => w.inBuffer(x, y));
              if (back) moveTo(s, back[0], back[1]);
            } else if (game.rng() < C.SOLDIER_WANDER) {
              const opts = DIRS8.map(([dx, dy]) => [s.x + dx, s.y + dy]).filter(([x, y]) => free(x, y) && w.canStep(s.x, s.y, x, y) && w.inBuffer(x, y)); // 八方向+斜走規則（第三十五版之四）
              if (opts.length) {
                const [x, y] = FE.pick(game.rng, opts);
                moveTo(s, x, y);
              }
            }
          }
        }
      } else if (!home(s.x, s.y)) {
        // 沒在出城（或出城結束）：走回城鎮
        const back = stepToward(s, home);
        if (back) moveTo(s, back[0], back[1]);
      } else if (game.rng() < C.SOLDIER_WANDER) {
        // 在城鎮裡室外走動，不出城鎮
        const opts = DIRS8.map(([dx, dy]) => [s.x + dx, s.y + dy]).filter(([x, y]) => home(x, y) && free(x, y) && w.canStep(s.x, s.y, x, y)); // 八方向+斜走規則（第三十五版之四）
        if (opts.length) {
          const [x, y] = FE.pick(game.rng, opts);
          moveTo(s, x, y);
        }
      }
      if (!game.soldiers.includes(s)) continue; // 出手時被反擊打倒了
      if (s.owe === oweBefore) actorIdle(s); // 站著沒動：不把空下來的時間存起來
      const inside = home(s.x, s.y);
      if (s.in && !inside) st.sorties++;
      s.in = inside;
    }
  }

  // ---- 角色（士兵、隊友、沒被操作的冒險者）照自己的刻數行動（第三十六版之四，使用者選的）----
  // 原本每個世界回合（6 刻）一律動一次，冒險者卻要加防具多花的刻、失序 ×2，失序時穿鎖子甲的冒險者走一步 14 刻，士兵同時間走 2.3 步。
  // 改成跟冒險者同一套：走一步＝moveTicks（力量不到防具需求 9 刻、超重 36 刻、力竭照比例）＋防具多花的刻；出手、治療＝attackTicks＋防具多花的刻；失序 ×2。
  // c.owe 記著還欠幾刻：每個世界回合先減 6，還有欠的就這回合不動；動了把這個動作的刻數加上去；沒事做就歸零（不累積）。怪物照舊每 6 刻動一次
  function actCost(game, c, kind) {
    const chaos = FE.Stability.state(game) === 2 ? C.CHAOS_TIME : 1;
    let base;
    if (kind === 'attack') base = FE.Char.attackTicks(c, c.equip && c.equip.main);
    else {
      base = FE.Gear.loadTier(c) >= 1 ? C.OVER_MOVE_TICKS : FE.Char.strShort(c) ? Math.max(C.STR_REQ_TICKS, FE.Char.moveTicks(c)) : FE.Char.moveTicks(c);
      if (c.exhaust) base = Math.round(base * FE.Char.exhaustMoveMul(c));
    }
    return (base + FE.Gear.extraTicks(c)) * chaos;
  }
  // 這個世界回合輪不輪得到 c 動
  function actorReady(c) {
    c.owe = (c.owe || 0) - C.TICKS_MOVE;
    return c.owe <= 0;
  }
  // c 做了一個動作（kind：'move' 或 'attack'）
  function actorPay(game, c, kind) {
    c.owe = Math.max(c.owe || 0, -C.TICKS_MOVE) + actCost(game, c, kind);
  }
  // c 輪到了卻沒事做：欠的歸零，不把空下來的時間存起來
  function actorIdle(c) {
    if (c.owe < 0) c.owe = 0;
  }

  // ---- 角色（士兵、隊友）出手與隊友的自動行為（第三十六版之一）----
  // 角色打一隻怪物：拿弓箭而且目標在射程內看得到就射（士兵的箭用不完）；隊友法師、牧師放魔法攻擊、神聖攻擊；其他近戰（要貼著）。
  // 借用玩家出手的程式（game.strike、game.fireAt，asActor 把 player 暫時換成他、訊息改寫名字）；回傳有沒有出手
  function charAttack(game, ch, m) {
    return game.asActor(ch, () => {
      const soldier = ch.role === 'soldier';
      const w = ch.equip.main;
      const d = w && FE.GEAR[w.type];
      if (soldier && d && d.ammo) {
        const e = ch.bag.find((x) => x.id === d.ammo);
        if (e) e.n = Math.max(e.n, 5);
        else ch.bag.push({ id: d.ammo, name: FE.Gear.name({ type: d.ammo, q: 0 }), n: 5, q: 0 });
      }
      const cls = FE.Char.cls(ch);
      // 法師放魔法攻擊（bolt）、牧師放神聖攻擊（holy）；士兵一律用普通攻擊
      const kind = soldier ? 'shoot' : cls.spell ? 'bolt' : cls.light ? 'holy' : 'shoot';
      const rm = game.rangedMode(true, kind);
      const ok = rm && (rm.mode === 'shoot' || (!soldier && (FE.SPELLS[rm.mode] || rm.mode === 'spell' || rm.mode === 'light')));
      if (ok && FE.Combat.canShoot(game, ch, m, rm.range)) {
        if (game.fireAt(m, rm.mode === 'shoot' ? 'shoot' : rm.mode)) return true;
      }
      if (FE.Combat.adjacent(game, ch, m)) {
        game.strike('attack', m);
        return true;
      }
      return false;
    });
  }

  // 隊友與沒被操作的冒險者走路用的最短路第一步：能走、沒有人與怪物擋著、不進建築、不踩寶箱（隊友不開寶箱），可以穿過聚落周圍的圈
  function partyStep(game, ch, goal) {
    const w = game.world;
    const free = (x, y) => w.passable(x, y) && !game.monsterAt(x, y) && !w.npcAt(x, y) && !w.chestAt(x, y) && !game.isPlayerAt(x, y) && !game.soldierAt(x, y) && !inBuilding(w, x, y);
    const prev = new Map([[ch.x + ',' + ch.y, null]]);
    const q = [[ch.x, ch.y]];
    for (let h = 0; h < q.length && h < 1500; h++) {
      const [x, y] = q[h];
      if (h > 0 && goal(x, y)) {
        let key = x + ',' + y;
        let step = null;
        while (prev.get(key) !== null) {
          step = key;
          key = prev.get(key);
        }
        return step ? step.split(',').map(Number) : null;
      }
      for (const [dx, dy] of DIRS8) {
        const nx = x + dx;
        const ny = y + dy;
        const nk = nx + ',' + ny;
        if (prev.has(nk) || !free(nx, ny) || !w.canStep(x, y, nx, ny)) continue;
        prev.set(nk, x + ',' + y);
        q.push([nx, ny]);
      }
    }
    return null;
  }

  // 牧師隊友治療身邊（2 格內）生命最低的隊員（包括自己），1d8＋感知修正值，冷卻 HEAL_COOLDOWN 回合
  function mateHeal(game, ch) {
    const cd = ch.cd;
    if (!FE.Char.cls(ch).heal || cd.healCd > 0) return false;
    const hurt = game.party().filter((c) => c.hp > 0 && c.hp < c.maxHp * C.MATE_HEAL_BELOW && dist(ch, c) <= 2).sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
    if (!hurt) return false;
    cd.healCd = C.HEAL_COOLDOWN;
    const got = Math.min(hurt.maxHp - hurt.hp, Math.max(1, FE.rollDice(game.rng, C.HEAL_DIE, 1) + FE.Char.attrMod(ch, FE.Char.cls(ch).healAttr || 'cha')));
    hurt.hp += got;
    game.say(`${ch.name}低聲祈禱，${hurt === game.player ? '你' : hurt === ch ? '自己' : hurt.name}的傷口癒合了，生命回復 ${got}。`, 'good');
    return true;
  }

  // 隊友與沒被操作的冒險者，照自己的刻數行動（第三十六版之四，見 actCost）：牧師先治療；
  // 只打「貼著隊伍裡任何一位的怪物」與「操作的那位正在打的目標」（第三十六版之四，使用者選的；原本看到 8 格內的怪物就衝過去，隊友會自己跑去打大怪物）——
  // 近戰貼上去、遠程站著射；沒有這種怪物就跟在操作的那位身邊 2～3 格內（找得到路就走過去）。不進建築、不進聚落裡動手
  function partyTurn(game) {
    if (!game.mates.length) return;
    const w = game.world;
    const leader = game.player;
    const party = game.party();
    const actors = party.filter((c) => c !== leader);
    for (const ch of actors) {
      if (game.fell) return;
      if (!game.isAlive(ch) || ch.hp <= 0) continue;
      const cd = ch.cd || (ch.cd = { cooldown: 0, healCd: 0, spellCd: {} });
      if (cd.cooldown > 0) cd.cooldown--;
      if (cd.healCd > 0) cd.healCd--;
      for (const id of Object.keys(cd.spellCd)) if (cd.spellCd[id] > 0) cd.spellCd[id]--;
      FE.Combat.regenBlock(game, ch);
      if (!actorReady(ch)) continue;
      if (mateHeal(game, ch)) {
        actorPay(game, ch, 'attack');
        continue;
      }
      if (!w.inVillage(ch.x, ch.y)) {
        const engaged = (m) => party.some((c) => game.isAlive(c) && c.hp > 0 && dist(c, m) <= 1) || m.id === game.battle.targetId;
        const foes = game.monsters.filter((m) => engaged(m) && dist(ch, m) <= C.MATE_SIGHT && FE.Combat.lineClear(w, ch, m, 0));
        if (foes.length) {
          // 操作的那位的目標優先，再來是近的、血少的
          const rank = (a, b) => (a.id === game.battle.targetId ? -1 : b.id === game.battle.targetId ? 1 : dist(ch, a) - dist(ch, b) || a.hp - b.hp);
          foes.sort(rank);
          const adj = foes.filter((m) => FE.Combat.adjacent(game, ch, m))[0];
          if (charAttack(game, ch, adj || foes[0])) {
            actorPay(game, ch, 'attack');
            continue;
          }
          // 打不到：往那隻怪物靠過去（貼到旁邊）
          const t = foes[0];
          const s = partyStep(game, ch, (x, y) => Math.max(Math.abs(x - t.x), Math.abs(y - t.y)) === 1 && w.heightOk(x, y, t.x, t.y));
          if (s) {
            ch.x = s[0];
            ch.y = s[1];
            actorPay(game, ch, 'move');
            continue;
          }
        }
      }
      // 沒有要打的：跟在操作的那位身邊
      if (dist(ch, leader) > C.MATE_FOLLOW) {
        const s = partyStep(game, ch, (x, y) => Math.max(Math.abs(x - leader.x), Math.abs(y - leader.y)) <= C.MATE_FOLLOW - 1);
        if (s) {
          ch.x = s[0];
          ch.y = s[1];
          actorPay(game, ch, 'move');
          continue;
        }
      }
      actorIdle(ch);
    }
  }

  FE.AI = { worldTurn, canSee, npcTurn, soldierTurn, partyTurn, charAttack, partyStep, touching, free, regenerate, nimbleHide, stepToward, actCost, actorReady, actorPay, DIRS8 };
})();
