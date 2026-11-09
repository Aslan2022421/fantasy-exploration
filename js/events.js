// 事件：冒險者做事時累積修補力（不顯示），每 100 刻（遊戲裡的一小時，第三十版）拿目前的修補力維持世界。
// 第三十三版之三：每小時先讓每一格的穩定值往下掉、負格子欠夠多就生怪物（stability.js 的 decay、spawnDecay），再花修補力演算委託事件，
// 最後用剩下的修補力補冒險者身邊最負的格子（mend）。地形重算、檢查器抓侵蝕壞掉的地面、復發、破壞都拿掉了。
(function () {
  const C = FE.CONFIG;

  const dist = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)); // 八方向（第三十五版之四）

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
      copper: Math.round((C.HUNT_GOLD_BASE + C.HUNT_GOLD_PER * ids.length) * f) * C.SILVER, // 單位是銅（數字照舊是銀）；領的時候再乘經濟標籤與魅力
      compute: C.COMPUTE_HUNT + C.COMPUTE_HUNT_PER * ids.length, // 完成時給的算力（單人份量）
      accepted: false,
      done: false,
    };
    game.say(`${best.v.name}的${best.giver.name}想請人清掉村莊附近的 ${ids.length} 隻小怪物。`, 'npc');
    return true;
  }

  // 採藥、採礦委託（第三十版）：帶幾份藥草或幾顆礦石交給委託人（交背包裡的，舊的也能交）。
  // 經驗值＝基本 15＋每份 1；金錢＝基本 10 銀＋材料本身的價錢（藥草一份 2 銀、礦石一顆 5 銀），再乘「需求（冒險者）」；
  // 算力 3＋每份 0.5（藥草）或每顆 1（礦石）。由事件生出，不算進創世門檻
  function gatherQuest(game, giver, kind) {
    const G = C.GATHER_QUEST[kind];
    const v = game.world.villageById(giver.villageId);
    const n = FE.randInt(game.rng, G.n[0], G.n[1]);
    const f = FE.Steading.rewardFactor(v);
    giver.quest = {
      kind,
      n,
      village: v ? v.name : '',
      exp: Math.round((C.QUEST_EXP + C.GATHER_QUEST_EXP_PER * n) * f),
      copper: Math.round((C.QUEST_GOLD + G.value * n) * f * C.SILVER),
      compute: G.compute + G.computePer * n,
      accepted: false,
      done: false,
    };
    game.say(`${v ? v.name + '的' : ''}${giver.name}想要 ${n} ${kind === 'herb' ? '份藥草' : '顆礦石'}。`, 'npc');
  }

  // 村民有了新的委託。村莊周遭有小怪物時優先發清除委託；不然一半機率發採藥或採礦委託（各一半），其餘發送貨委託。
  // 送貨委託的收貨人一定是碰得到的村民（第二十五版起不再指向不存在的人）。
  function questEvent(game, canReach) {
    const w = game.world;
    const p = game.player;
    const free = (n) => !FE.Gear.isShopkeeper(n) &&!game.monsterAt(n.x, n.y) && canReach(n.x, n.y);
    const givers = w.npcs.filter((n) => (!n.quest || n.quest.done) && free(n));
    if (!givers.length) return null;
    if (huntQuest(game, givers)) return {};
    givers.sort((a, b) => dist(a, p) - dist(b, p));
    const giver = FE.pick(game.rng, givers.slice(0, 3));
    // 採藥、採礦委託只在世界上有那種採集點時才發（第三十二版修：原本沒有礦坑也會發採礦委託，根本做不到）
    const kinds = ['herb', 'ore'].filter((k) => w.nodes.some((n) => n.kind === k));
    if (kinds.length && game.rng() < C.GATHER_QUEST_CHANCE) {
      gatherQuest(game, giver, kinds.length > 1 ? (game.rng() < 0.5 ? 'herb' : 'ore') : kinds[0]);
      return {};
    }

    // 收貨人可以在別的村莊，路程越遠獎勵越多；有誓約或貿易關係的聚落，一半機率優先送過去
    const v = w.villageById(giver.villageId);
    let targets = w.npcs.filter((n) => n.id !== giver.id && free(n));
    const rel = FE.Steading.related(v);
    const toRelated = targets.filter((n) => rel.includes(n.villageId));
    if (toRelated.length && game.rng() < 0.5) targets = toRelated;
    if (!targets.length) return null;
    giver.quest = FE.makeQuest(w, game.rng, giver, FE.pick(game.rng, targets));
    game.say(`${v ? v.name + '的' : ''}${giver.name}有了新的委託。`, 'npc');
    return {};
  }

  // 事件做得成就回傳物件，做不成回傳 null。第三十三版之三：事件不再生出算錯的地面或怪物（地形重算拿掉了），
  // 送貨委託的收貨人一定存在，所以也不會有懸空指標。寶箱不由事件生成：只在創世時固定放置，另外由怪物掉落
  const KINDS = { quest: questEvent };

  // 算力夠付哪些事件就從裡面挑，付不起或挑的都做不成就停，剩下的算力補冒險者身邊最負的格子
  function tick(game) {
    const reach = FE.Checker.reachable(game.world);
    const canReach = (x, y) => reach.at(x, y);
    // 怪物遮蔽（第三十四版）：穩定值不往下掉、不生衰敗的怪物（整體 BUG 值不往上加）；委託事件與修補照常
    if (!game.veil) {
      FE.Stability.decay(game, reach);
      FE.Stability.spawnDecay(game, reach);
    }
    for (let guard = 0; guard < 5; guard++) {
      const kinds = Object.keys(KINDS).filter((k) => game.compute >= C.EVENT_COST[k]);
      if (!kinds.length) break;
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
        done = true;
        break;
      }
      if (!done) break;
    }
    FE.Stability.mend(game);
  }

  FE.Events = { tick, gatherQuest };
})();
