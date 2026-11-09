// 怪物行動：冒險者每做一個動作，所有怪物各做一件事（移動一步或攻擊）。
// 所有怪物在自己的 B 點附近徘徊；會追人的怪物（m.small）看得到冒險者就追；貼在冒險者旁邊的怪物不管追不追人，在自己的回合攻擊（圍攻）；
// 怪物進不了聚落和它周圍那一圈；怪物每走進一格，那一格的穩定值減 STAB_STEP（第三十三版之三，侵蝕拿掉了）。
// 第三十五版之四：怪物、村民、士兵改八方向移動。
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
    if (game.rng() >= C.WANDER_CHANCE) return;      const options = DIRS8.map(([dx, dy]) => [m.x + dx, m.y + dy]).filter(
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
  } /* ---- 怪物的特性（第三十三版，照 SRD 5.2.1；群體戰術與易傷在 combat.js）----
  // 再生（沼澤巨魔，SRD 的 Troll 15 點、Troll Limb 5 點）：每回合開頭回 regen 點生命；上一次被火或酸打到（m.noRegen）這一回合不回。
  // SRD 裡生命歸零還要「回合開頭沒有再生」才死，這一版照舊歸零就倒下 */
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
      // 緩速（鞭子、輕弩的精通）：下一次移動多花 10 刻，怪物 10 刻動一次，所以這一回合牠要移動的話就停在原地（攻擊不受影響）
      const soldierNear = game.soldiers.length > 0 && game.soldiers.some((s) => touching(game, m, s));
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
      // 貼著士兵的怪物也會攻擊（士兵算防守方，閃避格擋都是 0）；同時貼著幾位就打血量最少的
      if (game.soldiers.length) {
        const near = game.soldiers.filter((s) => touching(game, m, s)).sort((a, b) => a.hp - b.hp)[0];
        if (near) {
          FE.Combat.resolveAttack(game, m, near, 'attack');
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
  // 鐵匠、武器匠、盔甲匠固定站在工坊裡
  function npcTurn(game) {
    const w = game.world;
    for (const n of w.npcs) {
      if (FE.Gear.isShopkeeper(n) || game.rng() >= C.NPC_MOVE_CHANCE) continue;
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
  // 士兵跟怪物照同一個時鐘（第三十版）：每 10 刻做一個動作（移動、出手或站著不動）；失序時冒險者的動作花兩倍的刻，士兵跟怪物一樣多動一次。
  // 安穩、動盪：在自己的城鎮裡室外走動（跟村民一樣，不進建築）；在城外就走回城鎮。
  // 失序：出城，追打該塊世界裡衰敗生的小怪物（m.small）；創世時的怪物一律不碰，免得冒險者解不出下一塊。
  // 打不到（沒有目標或走不到）就在城鎮附近巡邏。士兵可以走進聚落周圍的圈，怪物不行。
  const inBuilding = (w, x, y) => {
    const v = w.villageAt(x, y);
    return !!v && FE.Steading.roomAt(v, x, y) >= 0;
  };

  function soldierTurn(game) {
    if (!game.soldiers.length) return;
    const w = game.world;
    const st = FE.Stability.stat(game);
    const disorder = FE.Stability.state(game) === 2;
    const k = (x, y) => x + ',' + y;
    // 被占住的格子：整理一次，找路時直接查。士兵另外記：找路時隊友只擋第一步，
    // 不然 3 位士兵在路上互相擋，最短路每回合換方向，整隊原地來回走
    const occ = new Set();
    for (const m of game.monsters) occ.add(k(m.x, m.y));
    for (const n of w.npcs) occ.add(k(n.x, n.y));
    for (const c of w.chests) occ.add(k(c.x, c.y));
    occ.add(k(game.player.x, game.player.y));
    const mates = new Set(game.soldiers.map((s) => k(s.x, s.y)));
    // 創世時的怪物、合體怪物不歸士兵打，牠們旁邊的格子也不走（不然路過就被打倒）
    const danger = new Set();
    for (const m of game.monsters) if (!m.small) for (const [dx, dy] of DIRS8) danger.add(k(m.x + dx, m.y + dy)); // 八方向（第三十五版之四）
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
    };

    const preyCache = new Map();
    st.soldierSlots += game.soldiers.length;
    for (const s of game.soldiers.slice()) {
      if (!game.soldiers.includes(s)) continue;
      st.soldierActs++;
      const v = w.villageById(s.villageId);
      if (!v) continue;
      const home = (x, y) => w.villageAt(x, y) === v;
      if (disorder) {
        // 城鎮外 16 格內衰敗生的小怪物（m.small），創世時的怪物不碰
        // （第三十二版小塊變成 24×24，不再用「城鎮所在那一塊」，改成跟原本 64×64 一塊差不多的範圍）
        const around = (m) => m.x >= v.x0 - 16 && m.x <= v.x1 + 16 && m.y >= v.y0 - 16 && m.y <= v.y1 + 16;
        if (!preyCache.has(v)) preyCache.set(v, game.monsters.filter((m) => m.small && around(m)));
        const prey = preyCache.get(v).filter((m) => game.monsters.includes(m));
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
          FE.Combat.resolveAttack(game, s, adj, 'attack');
        } else if (s !== lead && target && !near(s, lead)) {
          const step = stepToward(s, (x, y) => Math.abs(x - lead.x) + Math.abs(y - lead.y) <= 1);
          if (step) moveTo(s, step[0], step[1]);
        } else if (s === lead && target && !gathered && (s.wait = (s.wait || 0) + 1) <= C.SOLDIER_GATHER_WAIT) {
          // 隊長原地等其他人；等太久（有人被擋住）就先走
        } else {
          if (s === lead) s.wait = 0;
          const at = new Set(target ? [k(target.x, target.y)] : []);
          const goal = (x, y) =>          DIRS8.some(([dx, dy]) => at.has(k(x + dx, y + dy)) && w.canStep(x, y, x + dx, y + dy)) // 八方向+斜走規則（第三十五版之四）;
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
        // 回到動盪或安穩：走回城鎮
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
      const inside = home(s.x, s.y);
      if (s.in && !inside) st.sorties++;
      s.in = inside;
    }
  }

  FE.AI = { worldTurn, canSee, npcTurn, soldierTurn, touching, free, regenerate, nimbleHide, stepToward, DIRS8 };
})();

