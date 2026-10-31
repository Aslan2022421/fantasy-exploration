// 事件：冒險者做事時累積修補力（不顯示），每隔幾步拿目前的修補力演算事件。
// 事件生成器跟世界生成器一樣粗糙，生成出錯的地方交給檢查器，抓到的變成怪物（影響範圍上限看世界狀態，3～6）。
(function () {
  const C = FE.CONFIG;

  const dist = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

  // 離村莊邊緣幾步
  const boxDist = (v, m) => Math.max(v.x0 - m.x, 0, m.x - v.x1) + Math.max(v.y0 - m.y, 0, m.y - v.y1);

  // 村莊周遭、還沒被別的清除委託指定的小怪物
  function smallsNear(game, v) {
    const taken = new Set();
    for (const n of game.world.npcs) {
      if (n.quest && n.quest.kind === 'hunt' && !n.quest.done) n.quest.monsterIds.forEach((id) => taken.add(id));
    }
    return game.monsters
      .filter((m) => m.small && !taken.has(m.id) && boxDist(v, m) <= C.HUNT_RADIUS)
      .sort((a, b) => boxDist(v, a) - boxDist(v, b));
  }

  // 清除委託：周遭小怪物越多，越可能發這種委託；挑小怪物最多的村莊。
  // 有「禍害」標籤的聚落多算兩隻，更常請人清除
  function huntQuest(game, givers) {
    const w = game.world;
    let best = null;
    for (const g of givers) {
      const v = w.villageById(g.villageId);
      if (!v) continue;
      const near = smallsNear(game, v);
      if (!near.length) continue;
      const weight = near.length + (FE.Steading.has(v, '禍害') ? 2 : 0);
      if (!best || weight > best.weight) best = { giver: g, v, near, weight };
    }
    if (!best || game.rng() >= Math.min(0.9, 0.3 + 0.2 * best.weight)) return false;
    const ids = best.near.slice(0, C.HUNT_MAX).map((m) => m.id);
    const f = FE.Steading.rewardFactor(best.v);
    best.giver.quest = {
      kind: 'hunt',
      monsterIds: ids,
      total: ids.length,
      village: best.v.name,
      exp: Math.round((C.HUNT_EXP_BASE + C.HUNT_EXP_PER * ids.length) * f),
      gold: Math.round((C.HUNT_GOLD_BASE + C.HUNT_GOLD_PER * ids.length) * f),
      compute: C.COMPUTE_HUNT + C.COMPUTE_HUNT_PER * ids.length, // 完成時給的算力（單人份量）
      accepted: false,
      done: false,
    };
    game.say(`${best.v.name}的${best.giver.name}想請人清掉村莊附近的 ${ids.length} 隻小怪物。`, 'npc');
    return true;
  }

  // 村民有了新的委託。村莊周遭有小怪物時優先發清除委託；
  // 送貨委託的收貨人一定是碰得到的村民（第二十五版起不再指向不存在的人）。
  function questEvent(game, canReach) {
    const w = game.world;
    const p = game.player;
    const free = (n) => !FE.Gear.isShopkeeper(n) &&!game.monsterAt(n.x, n.y) && canReach(n.x, n.y);
    const givers = w.npcs.filter((n) => (!n.quest || n.quest.done) && free(n));
    if (!givers.length) return null;
    if (huntQuest(game, givers)) return { found: null };
    givers.sort((a, b) => dist(a, p) - dist(b, p));
    const giver = FE.pick(game.rng, givers.slice(0, 3));

    // 收貨人可以在別的村莊，路程越遠獎勵越多；有誓約或貿易關係的聚落，一半機率優先送過去
    const v = w.villageById(giver.villageId);
    let targets = w.npcs.filter((n) => n.id !== giver.id && free(n));
    const rel = FE.Steading.related(v);
    const toRelated = targets.filter((n) => rel.includes(n.villageId));
    if (toRelated.length && game.rng() < 0.5) targets = toRelated;
    if (!targets.length) return null;
    giver.quest = FE.makeQuest(w, game.rng, giver, FE.pick(game.rng, targets));
    game.say(`${v ? v.name + '的' : ''}${giver.name}有了新的委託。`, 'npc');
    return { found: FE.Checker.checkNpc(w, giver) };
  }

  // 地形重算：創世神用算力把冒險者附近（5～12 步外）的一小塊地重新算一次。
  // 跟創世時一樣粗糙：一半機率蓋上一塊氣候印章，一半機率讓高度突然差 2 階；算錯的地方之後被檢查器抓成小怪物。
  function recomputeEvent(game) {
    const w = game.world;
    const p = game.player;
    for (let tries = 0; tries < 30; tries++) {
      const cx = p.x + FE.randInt(game.rng, -12, 12);
      const cy = p.y + FE.randInt(game.rng, -8, 8);
      const d = dist({ x: cx, y: cy }, p);
      if (d < 5 || d > 12 || !w.inBounds(cx, cy) || w.inBuffer(cx, cy) || w.landmarkAt(cx, cy)) continue;
      const stamp = game.rng() < 0.5;
      const biome = FE.pick(game.rng, FE.STAMP_BIOMES);
      const dh = game.rng() < 0.5 ? 2 : -2;
      const r = stamp ? 1.5 + game.rng() : 0.8 + game.rng() * 0.8;
      for (let y = Math.floor(cy - r); y <= cy + r; y++) {
        for (let x = Math.floor(cx - r); x <= cx + r; x++) {
          if (!w.inBounds(x, y) || (x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
          if (w.inBuffer(x, y) || w.landmarkAt(x, y) || game.isPlayerAt(x, y) || !w.passable(x, y)) continue;
          if (stamp) w.setCell(x, y, FE.BIOMES[biome].paint(game.rng, w.cell(x, y).h), biome);
          else w.setHeight(x, y, Math.max(0, Math.min(C.MAX_HEIGHT, w.cell(x, y).h + dh)));
        }
      }
      // 不寫進訊息框，改在小地圖上那塊地亮一個點，100 刻後消失
      game.flashes = (game.flashes || []).filter((f) => f.until > game.ticks);
      game.flashes.push({ x: cx, y: cy, until: (game.ticks || 0) + C.RECOMPUTE_FLASH_TICKS });
      return { found: null };
    }
    return null;
  }

  // 事件做得成就回傳 { found }，found 是檢查器抓到的錯（沒錯就是 null）；做不成回傳 null。
  // 寶箱不再由事件生成：只在創世時固定放置，另外由怪物掉落。
  const KINDS = { quest: questEvent, recompute: recomputeEvent };

  // 檢查器掃出被侵蝕或重算壞掉的地面（氣候錯位、斷崖），生成小怪物（數量有上限）
  function detectGlitches(game, canReach) {
    let spawned = 0;
    for (const d of FE.Checker.findGlitches(game.world, game.monsters, game.world.dormant)) {
      if (spawned >= C.CORRUPT_SPAWN_PER_TICK) return;
      if (game.monsters.filter((m) => m.small).length >= C.SMALL_CAP) return;
      d.scope = Math.min(d.scope, FE.Stability.maxScope(game));
      const m = game.spawnMonster(d, canReach);
      if (!m) continue;
      m.small = true;
      spawned++;
      game.say(`扭曲的地面冒出了一隻${m.name}。`, 'bug');
    }
  }

  // 算力夠付哪些事件就從裡面挑，付不起或挑的都做不成就停，剩下的算力留到下一次
  function tick(game) {
    const reach = FE.Checker.reachable(game.world);
    const canReach = (x, y) => reach.at(x, y);
    detectGlitches(game, canReach);
    // 世界動盪起，BUG 與系統爭鬥（失序時由城鎮的士兵出城清小怪物，見 ai.js 的 soldierTurn）
    FE.Stability.struggle(game, canReach);
    for (let guard = 0; guard < 5; guard++) {
      const kinds = Object.keys(KINDS).filter((k) => game.compute >= C.EVENT_COST[k]);
      if (!kinds.length) return;
      // 打亂順序，第一種做不成就換下一種
      for (let i = kinds.length - 1; i > 0; i--) {
        const j = Math.floor(game.rng() * (i + 1));
        [kinds[i], kinds[j]] = [kinds[j], kinds[i]];
      }
      let done = false;
      for (const k of kinds) {
        const result = KINDS[k](game, canReach);
        if (result === null) continue;
        game.compute -= C.EVENT_COST[k];
        const d = result.found;
        if (d) {
          d.scope = Math.min(d.scope, FE.Stability.maxScope(game));
          const m = game.spawnMonster(d, canReach);
          if (m) {
            m.small = true;
            game.say(`附近冒出了一隻${m.name}。`, 'bug');
          } else if (d.type === 'REFERENCE') {
            // 懸空指標放不下時，沒有怪物負責修這個任務；直接撤回，不然接了會永遠送不出去
            const n = game.world.npcById(d.data.npcId);
            if (n) n.quest = null;
          }
        }
        done = true;
        break;
      }
      if (!done) return;
    }
  }

  FE.Events = { tick };
})();
