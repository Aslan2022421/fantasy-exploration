// 怪物行動：冒險者每做一個動作，所有怪物各做一件事（移動一步或攻擊）。
// 所有怪物在自己的 B 點附近徘徊；會追人的怪物（m.small）看得到冒險者就追；貼在冒險者旁邊的怪物不管追不追人，在自己的回合攻擊（圍攻）；
// 怪物進不了聚落和它周圍那一圈；怪物會侵蝕周遭的地面。
(function () {
  const C = FE.CONFIG;
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const dist = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

  // 怪物能踏上的格子；聚落和它周圍那一圈是安全區，怪物進不去（追到圈邊就停）
  function free(game, x, y) {
    const w = game.world;
    if (!w.passable(x, y) || w.inBuffer(x, y)) return false;
    return !game.monsterAt(x, y) && !w.npcAt(x, y) && !w.chestAt(x, y) && !game.isPlayerAt(x, y) && !game.soldierAt(x, y);
  }

  // 沿直線看過去，中間的地形擋住的量累積到 1 就看不到；冒險者在村莊裡時看不到。
  // 中間有比兩端都高出 2 階以上的地方（隔著山丘），也看不到。
  function canSee(world, m, p) {
    if (dist(m, p) > C.SIGHT || world.inVillage(p.x, p.y)) return false;
    const top = Math.max(world.cell(m.x, m.y).h, world.cell(p.x, p.y).h);
    let x = m.x;
    let y = m.y;
    const dx = Math.abs(p.x - x);
    const dy = -Math.abs(p.y - y);
    const sx = x < p.x ? 1 : -1;
    const sy = y < p.y ? 1 : -1;
    let err = dx + dy;
    let block = 0;
    for (;;) {
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y += sy;
      }
      if (x === p.x && y === p.y) return true;
      const c = world.cell(x, y);
      // 視線穿過還沒創出來的空缺（世界不一定是方的）就看不到
      if (!c) return false;
      block +=(C.SIGHT_BLOCK[c.t] || 0) + (c.h >= top + 2 ? 1 : 0);
      if (block >= 1) return false;
    }
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
      for (const [dx, dy] of DIRS) {
        const nx = x + dx;
        const ny = y + dy;
        const nk = nx + ',' + ny;
        if (prev.has(nk) || !free(game, nx, ny) || !game.world.heightOk(x, y, nx, ny)) continue;
        prev.set(nk, x + ',' + y);
        q.push([nx, ny]);
      }
    }
    return null;
  }

  // 貼在旁邊，而且中間不是斷崖，才算纏得上
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

  // 回生成點：回到徘徊範圍內就恢復正常；路被堵住太久，就改在當下的位置徘徊
  function returnHome(game, m) {
    const near = (x, y) => Math.abs(x - m.home.x) + Math.abs(y - m.home.y) <= C.WANDER_LEASH;
    if (!near(m.x, m.y)) {
      const s = stepToward(game, m, near);
      if (s) [m.x, m.y] = s;
      else if (++m.returnTurns > 20) m.home = { x: m.x, y: m.y };
    }
    if (near(m.x, m.y)) m.returning = false;
  }

  function wander(game, m) {
    if (game.rng() >= C.WANDER_CHANCE) return;
    const options = DIRS.map(([dx, dy]) => [m.x + dx, m.y + dy]).filter(
      ([x, y]) => free(game, x, y) && game.world.heightOk(m.x, m.y, x, y) && dist({ x, y }, m.home) <= C.WANDER_LEASH
    );
    if (!options.length) return;
    [m.x, m.y] = FE.pick(game.rng, options);
  }

  // 侵蝕：在怪物附近弄出一對直接相鄰的苔原和沙漠。下一次演算事件時，檢查器會把它抓成小怪物。
  function corrupt(game, m) {
    const w = game.world;
    for (let tries = 0; tries < 10; tries++) {
      const x = m.x + FE.randInt(game.rng, -2, 2);
      const y = m.y + FE.randInt(game.rng, -2, 2);
      const [dx, dy] = FE.pick(game.rng, DIRS);
      if (!free(game, x, y) || !free(game, x + dx, y + dy)) continue;
      if (w.landmarkAt(x, y) || w.landmarkAt(x + dx, y + dy) || w.inBuffer(x, y) || w.inBuffer(x + dx, y + dy)) continue;
      w.setCell(x, y, '.', 'tundra');
      w.setCell(x + dx, y + dy, ':', 'desert');
      if (dist(m, game.player) <= C.SIGHT) game.say(`${m.name}侵蝕了周遭的地面。`, 'bug');
      return;
    }
  }

  // 一群小怪物的難度評級（參考《奇幻探索物語》）：生命值＋單回合最高傷害＋數量
  function rating(group) {
    const maxDmg = (m) => (m.type === 'VALUE' ? m.atk * 2 : m.atk + 1);
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
    const wl = FE.Stability.worldLevel(game);
    const big = FE.makeMonster(
      { type, x: at.x, y: at.y, cells: group.flatMap((m) => m.cells), scope: group.reduce((s, m) => s + m.scope, 0), data: {} },
      game.nextMonsterId++,
      wl
    );
    big.tier = 'mid'; // 合體生出的一律是中型怪物，就算加總的影響範圍不到 5
    FE.dressMonster(big, game.world);
    big.maxHp = Math.min(Math.round(150 * FE.wlScale(wl, C.WL_BONUS.HP)), group.reduce((s, m) => s + m.maxHp, 0));
    big.hp = Math.min(big.maxHp, group.reduce((s, m) => s + m.hp, 0));
    big.atk = Math.min(Math.round(9 * FE.wlScale(wl, C.WL_BONUS.ATK)), Math.max(...group.map((m) => m.atk)) + 1);
    big.exp = group.reduce((s, m) => s + m.exp, 0);
    big.compute = group.reduce((s, m) => s + m.compute, 0); // 合進去的怪物給的算力加總
    big.members = group;
    game.monsters.push(big);
    game.say(`${group.length} 隻怪物沒有清掉，合成了一隻${big.name}！`, 'bug');
  }

  // 每個怪物做一件事：貼在冒險者旁邊就攻擊，不然追人、回生成點或徘徊（移動一步）。
  // 回合開頭就貼著才攻擊，剛移動到旁邊的那一回合不攻擊（移動或攻擊擇一）。
  function worldTurn(game) {
    const p = game.player;
    const safe = game.world.inVillage(p.x, p.y);
    for (const m of game.monsters.slice()) {
      if (!game.monsters.includes(m)) continue; // 被反擊打倒了
      FE.Combat.regenBlock(game, m);
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
      // 纏上：冒險者設定的目標（撞上去設的）跟著冒險者走，保持貼著（路徑被擋就照追擊的走法盡量貼近），
      // 一直打到牠倒下或冒險者撤退成功；拉開超過 CLING_LOSE 步就放開。貼上之後的下一回合才攻擊（移動或攻擊擇一）
      if (!safe && m.id === game.battle.targetId) {
        if (dist(m, p) > C.CLING_LOSE) {
          game.battle.targetId = null;
        } else {
          const s = stepToward(game, m, (x, y) => Math.abs(x - p.x) + Math.abs(y - p.y) === 1 && game.world.heightOk(x, y, p.x, p.y));
          if (s) {
            [m.x, m.y] = s;
            if (!m.small) m.home = { x: m.x, y: m.y }; // 不追人的怪物放開之後就在這裡徘徊
          }
          if (m.small) {
            m.chase = C.CHASE_MEMORY;
            m.chaseSteps = 0;
            m.returning = false;
          }
          continue;
        }
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
          if (s) [m.x, m.y] = s;
          // 走不過去（冒險者在聚落周圍的圈裡，怪物追到圈邊）也算追了一步，追滿 CHASE_LIMIT 就回生成點
          m.chaseSteps++;
          // 沒纏上冒險者：追太多步，或看不到之後追丟了，就回生成點
          if (m.chaseSteps >= C.CHASE_LIMIT || m.chase === 0) giveUp(game, m);
          continue;
        }
      }
      wander(game, m);
    }

    const smallCount = game.monsters.filter((m) => m.small).length;
    // 只有冒險者附近的怪物會侵蝕；不然整個世界的怪物一起侵蝕，怪物會越生越多。世界越亂侵蝕越勤
    if (smallCount < C.SMALL_CAP) {
      const chance = C.CORRUPT_CHANCE * FE.Stability.mult(game, 'CORRUPT') * FE.Stability.scale(game, 'CORRUPT');
      for (const m of game.monsters) {
        if (dist(m, p) <= C.CORRUPT_RANGE && game.rng() < chance) corrupt(game, m);
      }
    }

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
      const options = DIRS.map(([dx, dy]) => [n.x + dx, n.y + dy]).filter(([x, y]) => open(n.x, n.y, x, y));
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
      for (const [dx, dy] of DIRS) {
        const nx = x + dx;
        const ny = y + dy;
        const nk = nx + ',' + ny;
        if (prev.has(nk) || !open(x, y, nx, ny)) continue;
        prev.set(nk, x + ',' + y);
        q.push([nx, ny]);
      }
    }
    return null;
  }

  // ---- 士兵 ----
  // 冒險者每做一個動作，士兵做一個動作（移動、出手或站著不動）；失序時怪物動兩次，士兵仍只動一次。
  // 安穩、動盪：在自己的城鎮裡室外走動（跟村民一樣，不進建築）；在城外就走回城鎮。
  // 失序：出城，追打該塊世界裡事件與侵蝕生的小怪物（m.small）；創世時的怪物一律不碰，免得冒險者解不出下一塊。
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
    for (const m of game.monsters) if (!m.small) for (const [dx, dy] of DIRS) danger.add(k(m.x + dx, m.y + dy));
    const open = (x, y) => w.passable(x, y) && !occ.has(k(x, y)) && !inBuilding(w, x, y) && !danger.has(k(x, y));
    const free = (x, y) => open(x, y) && !mates.has(k(x, y));

    // 走到 goal(x, y) 成立的格子的最短路的第一步
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
        for (const [dx, dy] of DIRS) {
          const nx = x + dx;
          const ny = y + dy;
          const nk = k(nx, ny);
          if (prev.has(nk) || !(h === 0 ? free(nx, ny) : open(nx, ny)) || !w.heightOk(x, y, nx, ny)) continue;
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
        // 該塊世界裡事件與侵蝕生的小怪物（m.small），創世時的怪物不碰
        const chunk = w.chunkAt(v.cx, v.cy);
        if (!preyCache.has(chunk)) preyCache.set(chunk, game.monsters.filter((m) => m.small && w.chunkAt(m.x, m.y) === chunk));
        const prey = preyCache.get(chunk).filter((m) => game.monsters.includes(m));
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
          const goal = (x, y) => DIRS.some(([dx, dy]) => at.has(k(x + dx, y + dy)) && w.heightOk(x, y, x + dx, y + dy));
          const step = target ? stepToward(s, goal) : null;
          if (step) moveTo(s, step[0], step[1]);
          else {
            // 打不到：在城鎮附近（聚落周圍的圈）巡邏；跑到圈外就走回來
            if (!w.inBuffer(s.x, s.y)) {
              const back = stepToward(s, (x, y) => w.inBuffer(x, y));
              if (back) moveTo(s, back[0], back[1]);
            } else if (game.rng() < C.SOLDIER_WANDER) {
              const opts = DIRS.map(([dx, dy]) => [s.x + dx, s.y + dy]).filter(([x, y]) => free(x, y) && w.heightOk(s.x, s.y, x, y) && w.inBuffer(x, y));
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
        const opts = DIRS.map(([dx, dy]) => [s.x + dx, s.y + dy]).filter(([x, y]) => home(x, y) && free(x, y) && w.heightOk(s.x, s.y, x, y));
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

  FE.AI = { worldTurn, canSee, npcTurn, soldierTurn, touching };
})();
