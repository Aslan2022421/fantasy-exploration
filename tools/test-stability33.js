// 第三十三版之三的場景檢查：穩定值。每格有穩定值，正的不生怪物，負的生怪物，負的量就是 BUG 值（單位同 FE.blockValue）
// 檢查：起始值、創世時一處欠的量守恆、每小時依狀態往下掉、怪物走進一格減 20、衰敗的格子生怪物（上限、不算冷卻區與聚落圈與怪物負責的範圍）、
// 清掉一群補回起始值、冷卻區不掉、修補力 1：10、侵蝕與地形重算拿掉、存檔讀回一致、獎勵不變、合體守恆
let stabChecks = 0;
function testStability33() {
  const ok = (cond, msg) => { stabChecks++; if (!cond) fail('穩定值 ' + msg); };
  const sumDebt = (g) => { let d = 0; for (const ch of g.world.chunks) for (const v of ch.stab) if (v < 0) d -= v; return d; };
  const newGame = (seed) => {
    const g = new FE.Game(seed);
    g.start();
    g.checkCreate = () => {};
    g.monsters = [];
    g.soldiers = [];
    g.worldState = 0;
    return g;
  };
  // 把全世界欠的量清成起始值（創世時留下的零頭不干擾）
  const reset = (g) => { g.world.forEachCell((x, y) => g.world.resetStab(x, y)); };
  // 找一塊空地（邊長 2r+1 的方框，離冒險者至少 minD 步、離 apart 裡的點至少 gap 步，周圍沒有聚落圈、地貌、斷崖），把框裡的地形鋪成能走的（高度不動），回傳中心
  const field = (g, r, o) => {
    o = o || {};
    const w = g.world;
    const p = g.player;
    const minD = o.minD == null ? 12 : o.minD;
    const gap = o.gap || 2 * r + 14;
    let found = null;
    w.forEachCell((x, y) => {
      if (found || (x + y) % 2) return;
      if (Math.abs(x - p.x) + Math.abs(y - p.y) < minD || (o.apart || []).some(([ax, ay]) => Math.abs(x - ax) + Math.abs(y - ay) < gap)) return;
      // o.margin：離世界的邊至少幾格（第三十四版：清怪那一項的空地落在世界的角落時，半徑外的格子全在世界外面，量不到）
      if (o.margin && [[-1, -1], [1, -1], [-1, 1], [1, 1]].some(([sx, sy]) => !w.inBounds(x + sx * o.margin, y + sy * o.margin))) return;
      for (let dy = -r - 1; dy <= r + 1; dy++) for (let dx = -r - 1; dx <= r + 1; dx++) {
        const cx = x + dx, cy = y + dy;
        if (!w.inBounds(cx, cy) || w.inBuffer(cx, cy) || w.landmarkAt(cx, cy) || w.inVillage(cx, cy)) return;
        if (dx < r + 1 && !w.heightOk(cx, cy, cx + 1, cy)) return;
        if (dy < r + 1 && !w.heightOk(cx, cy, cx, cy + 1)) return;
      }
      if (!FE.Checker.reachable(w).at(x, y)) return;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) w.setCell(x + dx, y + dy, '.', w.cell(x + dx, y + dy).biome);
      const reach = FE.Checker.reachable(w);
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (!reach.at(x + dx, y + dy)) return;
      found = [x, y];
    });
    return found;
  };
  const box = (c, r) => { const out = []; for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) out.push([c[0] + dx, c[1] + dy]); return out; };
  const total = (g) => g.monsters.reduce((s, m) => s + m.bug, 0) + g.world.debt;

  // 1. 起始值：平均 240、在 120～360 之間、成片（相鄰兩格差得小）；只看世界種子和座標，不碰任何亂數
  {
    let sum = 0, n = 0, lo = 1e9, hi = -1e9, rough = 0;
    for (const seed of [1, 2, 3, 4]) {
      for (let x = 0; x < 96; x++) for (let y = 0; y < 96; y++) {
        const v = FE.stabilityAt(seed * 7919, x, y);
        sum += v; n++; lo = Math.min(lo, v); hi = Math.max(hi, v);
        if (Math.abs(v - FE.stabilityAt(seed * 7919, x + 1, y)) > 30) rough++;
      }
    }
    ok(lo >= 120 && hi <= 360 && Math.abs(sum / n - 240) < 12, `起始值 ${lo}～${hi}，平均 ${(sum / n).toFixed(1)}`);
    ok(lo <= 140 && hi >= 340, `起始值要有接近兩端的地方：${lo}～${hi}`);
    ok(rough / n < 0.02, `起始值要成片：相鄰兩格差超過 30 的有 ${(100 * rough / n).toFixed(1)}%`);
    const g = new FE.Game(777);
    const s0 = g.rng.getState();
    for (let i = 0; i < 500; i++) FE.stabilityAt(777, i, i * 3);
    ok(g.rng.getState() === s0, '算起始值不該動 game.rng');
    g.start();
    const ch = g.world.chunks[0];
    ok(ch.stab instanceof Int16Array && ch.stab.length === C.CHUNK_W * C.CHUNK_H, '每塊區塊有一個整數陣列');
    ok(g.world.chunks.every((c) => c.stab.every((v, i) => v <= FE.stabilityAt(777, c.x0 + (i % C.CHUNK_W), c.y0 + Math.floor(i / C.CHUNK_W)))), '創世後的格子不該比起始值高');
  }

  // 2. 創世守恆：一處起始欠 400～2,000（世界等級 1，每升一級 +10%），配出的怪物各帶走 m.bug，零頭以負的穩定值留在格子；
  //    欠的量＝怪物 bug 加總＋留在格子的；全世界欠的量＝各處留在格子的加總
  {
    const recs = [];
    const sg0 = FE.Game.prototype.spawnGroup;
    FE.Game.prototype.spawnGroup = function (...a) { const r = sg0.apply(this, a); recs.push({ g: this, group: r, wl: FE.Stability.worldLevel(this) }); return r; };
    try {
      let groups = 0, split = 0, bad = 0, leftSum = 0;
      for (const seed of [11, 222, 3333]) {
        const g = new FE.Game(seed);
        g.start();
        for (let k = 0; k < 6; k++) g.createChunk(false);
        const mine = recs.filter((r) => r.g === g);
        const left = mine.reduce((t, r) => t + (r.group.left || 0), 0);
        ok(g.world.debt === sumDebt(g) && g.world.debt === left, `seed${seed} 全世界欠 ${g.world.debt}（逐格 ${sumDebt(g)}），各處留在格子的 ${left}`);
        ok(total(g) === mine.reduce((t, r) => t + (r.group.debt || 0), 0), `seed${seed} 整體 BUG 值 ${total(g)} 不等於各處欠的量加總`);
        for (const r of mine) {
          if (!r.group.length) continue;
          const placed = r.group.reduce((t, m) => t + m.bug, 0);
          groups++;
          leftSum += r.group.left;
          if (r.group.left > 0) split++;
          const hi = Math.round(C.SITE_DEBT[1] * FE.wlScale(r.wl, C.WL_BONUS.DEBT));
          if (r.group.debt !== placed + r.group.left || r.group.left < 0) { bad++; ok(false, `seed${seed} 這處欠 ${r.group.debt}，怪物 ${placed}、格子 ${r.group.left}`); }
          if (r.group.debt < C.SITE_DEBT[0] || r.group.debt > Math.max(hi, placed)) ok(false, `seed${seed} 這處欠的量 ${r.group.debt} 不在 ${C.SITE_DEBT[0]}～${hi}（世界等級 ${r.wl}）`);
          // 零頭在帶頭那隻周圍 10 格內，不在聚落圈裡
          const lead = r.group[0];
          let off = 0;
          for (let dy = -30; dy <= 30; dy++) for (let dx = -30; dx <= 30; dx++) if (r.group.left > 0 && g.world.stab(lead.x + dx, lead.y + dy) < 0 && Math.max(Math.abs(dx), Math.abs(dy)) > 10 && !r.group.some((m) => Math.max(Math.abs(m.x - lead.x - dx), Math.abs(m.y - lead.y - dy)) <= 10)) off++;
          if (off && recs.filter((q) => q.g === g).length === 1) ok(false, `seed${seed} 零頭離帶頭那隻太遠`);
        }
        for (const m of g.monsters) ok(!g.world.inBuffer(m.x, m.y), `seed${seed} 怪物站在聚落圈裡`);
        let inBuf = 0;
        g.world.forEachCell((x, y) => { if (g.world.stab(x, y) < 0 && g.world.inBuffer(x, y)) inBuf++; });
        ok(inBuf === 0, `seed${seed} 聚落圈裡有 ${inBuf} 格欠債`);
      }
      ok(groups >= 20 && bad === 0 && split >= 1, `創世 ${groups} 處，守恆不成立 ${bad} 處，有零頭的 ${split} 處（零頭共 ${leftSum}）`);
    } finally {
      FE.Game.prototype.spawnGroup = sg0;
    }
    // 隻數上限砍掉的部分也留在格子裡：同一處分別限 0、1 隻
    const g = newGame(4141);
    const at = field(g, 6);
    for (const room of [0, 1, 99]) {
      reset(g);
      g.monsters = [];
      const d0 = g.world.debt;
      const group = g.spawnGroup({ d: { type: 'DECAY', x: at[0], y: at[1], cells: [], scope: 3, data: {} }, must: false }, null, false, room);
      const placed = group.reduce((t, m) => t + m.bug, 0);
      ok(group.length <= room && group.debt === placed + group.left && g.world.debt - d0 === group.left && sumDebt(g) === g.world.debt, `限 ${room} 隻：生了 ${group.length} 隻（帶走 ${placed}），這處欠 ${group.debt}，格子 ${group.left}，全世界多了 ${g.world.debt - d0}`);
      if (room === 0) ok(group.left === group.debt && group.debt >= C.SITE_DEBT[0], `限 0 隻時欠的量全留在格子裡：${group.left}／${group.debt}`);
      if (room === 1) ok(group.left > 0, `限 1 隻時被砍掉的部分留在格子裡：${group.left}`);
    }
  }

  // 3. 每小時往下掉：安穩 2、動盪 3～6、失序 6～12（每小時擲一次，全世界同一個值）；冷卻區、聚落圈、水與巨石、走不到的格子不掉
  {
    const g = newGame(5151);
    const w = g.world;
    reset(g);
    const A = field(g, 3);
    const village = w.villages[0];
    let inCircle = null;
    w.forEachCell((x, y) => { if (!inCircle && w.inBuffer(x, y) && w.passable(x, y)) inCircle = [x, y]; });
    let rock = null;
    w.forEachCell((x, y) => { if (!rock && !w.passable(x, y)) rock = [x, y]; });
    const B = field(g, 3, { apart: [A] });
    g.world.calm.push({ x: B[0], y: B[1], r: 5, until: g.ticks + 100 * C.DAY_TICKS });
    ok(!!A && !!B && !!inCircle && !!rock && !!village, '找得到測試用的格子');
    const reach = FE.Checker.reachable(w);
    const ranges = [[2, 2], [3, 6], [6, 12]];
    ok(JSON.stringify(C.STAB_DECAY) === JSON.stringify(ranges), `掉的量的設定 ${JSON.stringify(C.STAB_DECAY)}`);
    for (const st of [0, 1, 2]) {
      g.worldState = st;
      const seen = new Set();
      let exact = true;
      for (let h = 0; h < 80; h++) {
        for (const [x, y] of [A, inCircle, rock, B]) w.setStab(x, y, 200);
        const amt = FE.Stability.decay(g, reach);
        seen.add(amt);
        if (w.stab(A[0], A[1]) !== 200 - amt) exact = false;
        if (w.stab(inCircle[0], inCircle[1]) !== 200 || w.stab(rock[0], rock[1]) !== 200 || w.stab(B[0], B[1]) !== 200) exact = false;
      }
      const lo = Math.min(...seen), hi = Math.max(...seen);
      ok(exact, `狀態 ${st}：掉的量要等於回傳的量，聚落圈、水與巨石、冷卻區不掉`);
      ok(lo >= ranges[st][0] && hi <= ranges[st][1] && (st === 0 ? seen.size === 1 : seen.size === ranges[st][1] - ranges[st][0] + 1), `狀態 ${st}：80 小時掉的量 ${[...seen].sort((a, b) => a - b)}，應該是 ${ranges[st]}`);
    }
    // 全世界同一個值：同一小時每一格掉一樣多
    g.worldState = 1;
    reset(g);
    const before = new Map();
    for (const [x, y] of box(A, 3)) before.set(x + ',' + y, w.stab(x, y));
    const amt = FE.Stability.decay(g, reach);
    ok(box(A, 3).every(([x, y]) => before.get(x + ',' + y) - w.stab(x, y) === amt), '同一小時每一格掉一樣多');
    // 掉到 0 以下就成了欠的量，w.debt 跟著
    w.setStab(A[0], A[1], 1);
    const d0 = w.debt;
    g.worldState = 0;
    FE.Stability.decay(g, reach);
    ok(w.stab(A[0], A[1]) === -1 && w.debt === d0 + 1 && w.debt === sumDebt(g), `掉到負的就是欠的量：${w.stab(A[0], A[1])}，全世界欠 ${w.debt}（逐格 ${sumDebt(g)}）`);
    // 冷卻區過期之後又掉
    g.ticks += 101 * C.DAY_TICKS;
    w.setStab(B[0], B[1], 200);
    FE.Stability.decay(g, FE.Checker.reachable(w));
    ok(w.stab(B[0], B[1]) === 198, `冷卻區過期後照掉：${w.stab(B[0], B[1])}`);
  }

  // 4. 怪物走進一格，那一格當下減 20（每次移動都算：徘徊、纏上冒險者）
  {
    const g = newGame(6161);
    const w = g.world;
    reset(g);
    const c = field(g, 8, { minD: 14 });
    ok(!!c, '找得到空地');
    const m = FE.makeMonster({ type: 'DECAY', x: c[0], y: c[1], cells: [], scope: 2, data: {}, race: 'goblin' }, g.nextMonsterId++, 1);
    Object.assign(m, { home: { x: c[0], y: c[1] } });
    g.monsters.push(m);
    const cells = box(c, 8);
    const deficit = () => cells.reduce((t, [x, y]) => t + FE.stabilityAt(w.seed, x, y) - w.stab(x, y), 0);
    ok(deficit() === 0 && C.STAB_STEP === 20, `一開始沒有差：${deficit()}`);
    const rng0 = g.rng;
    g.rng = () => 0; // 徘徊的機率一定過，挑第一個方向
    let moves = 0;
    for (let i = 0; i < 12; i++) {
      const at = m.x + ',' + m.y;
      FE.AI.worldTurn(g);
      if (m.x + ',' + m.y !== at) moves++;
    }
    g.rng = rng0;
    ok(moves >= 6 && deficit() === 20 * moves, `徘徊 ${moves} 步，格子共少了 ${deficit()}（應該 ${20 * moves}）`);
    // 纏上冒險者：冒險者的目標一直被追，每走一步減 20
    const before = deficit();
    Object.assign(g.player, { x: c[0] + 7, y: c[1] });
    g.battle.targetId = m.id;
    const m0 = moves;
    for (let i = 0; i < 6; i++) {
      const at = m.x + ',' + m.y;
      FE.AI.worldTurn(g);
      if (m.x + ',' + m.y !== at) moves++;
    }
    ok(moves - m0 >= 3 && deficit() - before === 20 * (moves - m0), `纏上冒險者走了 ${moves - m0} 步，格子又少了 ${deficit() - before}`);
    // 牠自己站的格子之外，沒有別的格子被動到
    ok(cells.every(([x, y]) => (FE.stabilityAt(w.seed, x, y) - w.stab(x, y)) % 20 === 0), '每格少的量都是 20 的倍數');
  }

  // 5. 衰敗的格子生怪物：負格子 8 方向連成一片，欠的量買得起那裡最便宜的一隻，就用欠的量當預算配一組，生在那片走得到的格子；
  //    配掉的值從那片格子扣回；每小時最多 DECAY_GROUPS_PER_HOUR 群；不算冷卻區、聚落圈、怪物負責的範圍
  {
    const g = newGame(7171);
    const w = g.world;
    reset(g);
    const p = g.player;
    const spots = [];
    for (let k = 0; k < 4; k++) spots.push(field(g, 4, { apart: spots, minD: 14 }));
    ok(spots.every(Boolean), '找得到四塊空地');
    const fillBox = (c, r, v) => { for (const [x, y] of box(c, r)) w.setStab(x, y, v); };
    const reachNow = () => FE.Checker.reachable(w);
    // 三片各欠 81 × 800，只准生 2 群
    for (const c of spots.slice(0, 3)) fillBox(c, 4, -800);
    const d0 = w.debt;
    ok(d0 === 3 * 81 * 800 && C.DECAY_GROUPS_PER_HOUR === 2, `三片欠的量 ${d0}、每小時最多 ${C.DECAY_GROUPS_PER_HOUR} 群`);
    const groups = FE.Stability.spawnDecay(g, reachNow());
    const fresh = g.monsters.slice();
    const paid = d0 - w.debt;
    ok(groups === 2, `三片都欠很多，只生 ${groups} 群（上限 2）`);
    ok(fresh.length >= 2 && fresh.every((m) => m.small && m.type === 'DECAY' && Math.abs(m.x - p.x) + Math.abs(m.y - p.y) >= C.DECAY_MIN_DIST), `衰敗生的怪物 m.small、離冒險者至少 ${C.DECAY_MIN_DIST} 步：${fresh.map((m) => `${m.name}(${m.small})`).join()}`);
    ok(paid === fresh.reduce((t, m) => t + m.bug, 0) && w.debt === sumDebt(g), `配掉的值從格子扣回：扣了 ${paid}，怪物帶走 ${fresh.reduce((t, m) => t + m.bug, 0)}`);
    ok(total(g) === d0, `整體 BUG 值不變（怪物帶走的＝格子少掉的）：${total(g)}／${d0}`);
    ok(fresh.every((m) => !w.inBuffer(m.x, m.y)), '衰敗生的怪物不在聚落圈裡');
    // 同一小時再生一次：已經有怪物負責的範圍（生成點 RESP_RADIUS 格內）不再算，輪到沒有怪物負責的那一片（或剩下的零頭）
    const again = FE.Stability.spawnDecay(g, reachNow());
    ok(again <= 2 && fresh.every((m) => g.monsters.includes(m)), `第二次又生了 ${again} 群，原本的怪物還在`);
    const homes = fresh.map((m) => m.home);
    ok(g.monsters.slice(fresh.length).every((m) => homes.every((h) => Math.max(Math.abs(m.home.x - h.x), Math.abs(m.home.y - h.y)) >= 1)), '新的怪物不是生在原本那群怪物的格子上');
    // 欠的量不夠買最便宜的一隻：不生
    g.monsters = [];
    reset(g);
    w.setStab(spots[3][0], spots[3][1], -(FE.cheapestValue(Object.keys(FE.MONSTER_BLOCKS)) - 10));
    ok(FE.Stability.spawnDecay(g, reachNow()) === 0 && g.monsters.length === 0, '欠的量不夠買最便宜的一隻，不生怪物');
    w.setStab(spots[3][0], spots[3][1], -3000);
    ok(FE.Stability.spawnDecay(g, reachNow()) === 1 && g.monsters.length >= 1, '單獨一格欠 3,000 夠買了');
    // 冷卻區、聚落圈裡的負格子不算
    g.monsters = [];
    reset(g);
    fillBox(spots[0], 4, -800);
    g.world.calm.push({ x: spots[0][0], y: spots[0][1], r: 6, until: g.ticks + 10 * C.DAY_TICKS });
    ok(FE.Stability.spawnDecay(g, reachNow()) === 0 && g.monsters.length === 0, '冷卻區裡的負格子不生怪物');
    g.world.calm = [];
    reset(g);
    let circle = null;
    w.forEachCell((x, y) => { if (!circle && w.inBuffer(x, y) && w.passable(x, y) && reachNow().at(x, y)) circle = [x, y]; });
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (w.inBuffer(circle[0] + dx, circle[1] + dy)) w.setStab(circle[0] + dx, circle[1] + dy, -2000);
    ok(FE.Stability.spawnDecay(g, reachNow()) === 0 && g.monsters.length === 0, '聚落圈裡的負格子不生怪物');
    // 已經有怪物負責的範圍不算：一隻怪物的生成點旁邊的負格子，不另外生
    reset(g);
    fillBox(spots[1], 4, -800);
    const guardM = FE.makeMonster({ type: 'DECAY', x: spots[1][0], y: spots[1][1], cells: [], scope: 2, data: {}, race: 'goblin' }, g.nextMonsterId++, 1);
    g.monsters.push(guardM);
    ok(FE.Stability.spawnDecay(g, reachNow()) === 0 && g.monsters.length === 1, '怪物負責的範圍裡的負格子不另外生怪物');
    g.monsters = [];
    // 生在走得到的格子：有一格走不到的負格子（水）不拿來生，也不算進預算
    reset(g);
    fillBox(spots[2], 4, -300);
    const sealed = spots[2];
    const rb = reachNow();
    ok(box(sealed, 4).every(([x, y]) => rb.at(x, y)), '測試的方框都走得到');
    // 動盪、失序時依 CAMP_CHANCE 套營地：全套營地、方框改成山地（食人魔營地、狗頭人部落），營地的怪物不追人，記進 world.camps
    for (const [x, y] of box(spots[2], 4)) w.setCell(x, y, '.', 'mountain');
    const camp0 = C.CAMP_CHANCE.slice();
    C.CAMP_CHANCE = [1, 1, 1];
    g.worldState = 2;
    let camped = false;
    for (let t = 0; t < 30 && !camped; t++) {
      g.monsters = [];
      g.world.camps = [];
      reset(g);
      fillBox(spots[2], 4, -800);
      FE.Stability.spawnDecay(g, reachNow());
      camped = g.world.camps.some((cp) => cp.origin === 'disorder') && g.monsters.length > 1 && g.monsters.every((m) => !m.small && m.type === 'DECAY');
      if (!camped && g.monsters.length) continue;
    }
    C.CAMP_CHANCE = camp0;
    g.worldState = 0;
    ok(camped, '失序、營地機率 100% 時，衰敗的格子欠夠多就套成失序的營地（營地的怪物不追人）');
    g.monsters = [];
    g.world.camps = [];
  }

  // 6. 清掉一群：那一帶半徑 CALM_RADIUS 的格子補回起始值，進冷卻區 5～7 天；冷卻區裡的格子不掉，區外照掉
  {
    const g = newGame(8181);
    const w = g.world;
    reset(g);
    const c = field(g, 3, { minD: 14, margin: C.CALM_RADIUS + 8 });
    const other = field(g, 3, { apart: [c], minD: 14, gap: 2 * C.CALM_RADIUS + 20 });
    const wide = box(c, C.CALM_RADIUS + 2).filter(([x, y]) => w.inBounds(x, y)); // 清掉之後要補的範圍比生怪物的空地大，空地外的格子是什麼地形都行
    ok(!!c && !!other, '找得到清怪用的空地');
    const reach = FE.Checker.reachable(w);
    const d = { type: 'DECAY', x: c[0], y: c[1], cells: [], scope: 1, data: {} };
    const group = g.spawnList(d, [['goblin', 'small'], ['goblin', 'small'], ['goblin', 'small']], (x, y) => reach.at(x, y), { origin: 'campaign' });
    ok(group.length === 3, `生了一群 ${group.length} 隻`);
    // 把方框和外面弄成各種舊值（正的、負的）
    const rr = FE.makeRng(5);
    for (const [x, y] of wide) w.setStab(x, y, Math.floor(rr() * 400) - 250);
    const startOf = ([x, y]) => FE.stabilityAt(w.seed, x, y);
    const inR = ([x, y], at) => Math.max(Math.abs(x - at.x), Math.abs(y - at.y)) <= C.CALM_RADIUS;
    g.defeat(group[0]);
    g.defeat(group[1]);
    ok(g.world.calm.length === 0 && wide.some((q) => w.stab(q[0], q[1]) !== startOf(q)), '還沒全倒，格子不補、也沒有冷卻區');
    const last = group[2];
    g.defeat(last);
    const cen = last.home;
    const inside = wide.filter((q) => inR(q, cen));
    ok(inside.every((q) => w.stab(q[0], q[1]) === startOf(q)), `全倒後半徑 ${C.CALM_RADIUS} 的格子補回起始值`);
    ok(wide.filter((q) => !inR(q, cen)).some((q) => w.stab(q[0], q[1]) !== startOf(q)), `半徑以外的格子不動（c ${c}、cen ${cen.x},${cen.y}、外面 ${wide.filter((q) => !inR(q, cen)).length} 格）`);
    ok(g.world.calm.length === 1 && g.isCalm(cen.x, cen.y) && w.debt === sumDebt(g), `進了冷卻區，全世界欠 ${w.debt}（逐格 ${sumDebt(g)}）`);
    // 冷卻區裡不掉，區外照掉
    const rch = FE.Checker.reachable(w);
    w.setStab(other[0], other[1], 200);
    g.worldState = 1;
    const amt = FE.Stability.decay(g, rch);
    ok(inside.every((q) => w.stab(q[0], q[1]) === startOf(q)) && w.stab(other[0], other[1]) === 200 - amt, `冷卻區裡的格子不掉，區外的掉了 ${amt}`);
    g.worldState = 0;
    // 冷卻區裡也不生怪物（先把半徑外隨手設的舊值清掉，不然那些負格子會合法地生怪物）
    reset(g);
    for (const q of inside.slice(0, 40)) w.setStab(q[0], q[1], -1000);
    const n0 = g.monsters.length;
    FE.Stability.spawnDecay(g, rch);
    ok(g.monsters.length === n0, '冷卻區裡欠債也不生怪物');
    // 單隻（沒有群）倒下也一樣
    reset(g);
    g.world.calm = [];
    const solo = g.spawnMonster({ type: 'DECAY', x: other[0], y: other[1], cells: [], scope: 1, data: {} }, null);
    w.setStab(other[0] + 1, other[1], -100);
    g.defeat(solo);
    ok(w.stab(other[0] + 1, other[1]) === FE.stabilityAt(w.seed, other[0] + 1, other[1]) && g.world.calm.length === 1, '單隻倒下也補回起始值、進冷卻區');
  }

  // 7. 修補力：每小時事件做完之後剩下的修補力，補冒險者 24 步內最負的格子，1 點修補力補 10 點穩定值，補到 0 為止，用掉的修補力扣掉
  {
    const g = newGame(9191);
    const w = g.world;
    reset(g);
    const p = g.player;
    const c = field(g, 3, { minD: 3 });
    // 把冒險者放到空地旁邊，24 步內放三個負格子，24 步外放一個更負的
    Object.assign(p, { x: c[0], y: c[1] });
    const near = [[c[0] + 1, c[1], -100], [c[0] + 2, c[1], -30], [c[0], c[1] + 3, -55]];
    for (const [x, y, v] of near) w.setStab(x, y, v);
    const far = [c[0] + 25, c[1]];
    w.setStab(far[0], far[1], -500);
    g.compute = 5;
    const healed = FE.Stability.mend(g);
    ok(C.REPAIR_STAB_PER_COMPUTE === 10 && C.REPAIR_RANGE === 24, '設定值 1 點補 10 點、24 步內');
    ok(healed === 50 && g.compute === 0 && w.stab(c[0] + 1, c[1]) === -50, `5 點修補力補了 ${healed} 點，剩 ${g.compute}，最負的格子 ${w.stab(c[0] + 1, c[1])}`);
    ok(w.stab(c[0] + 2, c[1]) === -30 && w.stab(c[0], c[1] + 3) === -55 && w.stab(far[0], far[1]) === -500, '先補最負的，其他的和 24 步外的不動');
    g.compute = 20;
    const d1 = w.debt;
    const healed2 = FE.Stability.mend(g);
    // 最負的是 -55（補 55）、-50（補 50）、-30（補 30），共 135 點，用掉 13.5；剩下的修補力 6.5 沒有可補的
    ok(healed2 === 135 && Math.abs(g.compute - 6.5) < 1e-9 && w.debt === d1 - 135 && near.every(([x, y]) => w.stab(x, y) === 0), `補到 0 為止：補了 ${healed2}，剩 ${g.compute}`);
    ok(w.stab(far[0], far[1]) === -500, '24 步外的格子不補');
    // 補到 0 為止，不補到正的
    ok(near.every(([x, y]) => w.stab(x, y) <= 0), '不補成正的');
    // 整點的流程：decay → 生怪物 → 委託事件 → 補。委託花掉的先扣，剩下的才補
    reset(g);
    w.setStab(c[0] + 1, c[1], -200);
    g.compute = 10;
    const ev0 = FE.Events.tick;
    g.worldState = 0;
    FE.Events.tick(g);
    ok(g.compute < 10 && w.stab(c[0] + 1, c[1]) >= -200 - 2, `整點的流程跑得通：修補力 ${g.compute.toFixed(1)}，格子 ${w.stab(c[0] + 1, c[1])}`);
  }

  // 8. 侵蝕、地形重算、檢查器抓壞掉的地面、復發、破壞都拿掉了：走路、站著、過整點，地面一格都不變，也不會因此在身邊生怪物
  {
    const g = newGame(1212);
    const w = g.world;
    reset(g);
    const p = g.player;
    ok(C.CORRUPT_CHANCE === undefined && C.EVENT_COST.recompute === undefined && FE.Checker.findGlitches === undefined && g.fixed === undefined && FE.Stability.struggle === undefined, '舊機制的設定與函式都拿掉了');
    const c = field(g, 6, { minD: 10 });
    for (const [x, y] of box(c, 6)) w.setHeight(x, y, 0);
    // 一對直接相鄰的苔原和沙漠（以前會被檢查器抓成小怪物）、一個斷崖：現在整點也不會生怪物
    w.setCell(c[0] + 5, c[1] + 5, '.', 'tundra');
    w.setCell(c[0] + 6, c[1] + 5, ':', 'desert');
    w.setHeight(c[0] - 5, c[1] - 5, 2);
    const mon = FE.makeMonster({ type: 'DECAY', x: c[0] + 3, y: c[1], cells: [], scope: 2, data: {}, race: 'goblin' }, g.nextMonsterId++, 1);
    Object.assign(mon, { home: { x: mon.x, y: mon.y } });
    g.monsters.push(mon);
    const snap = () => {
      const out = [];
      for (let dy = -40; dy <= 40; dy++) for (let dx = -40; dx <= 40; dx++) { const q = w.cell(c[0] + dx, c[1] + dy); out.push(q ? q.biome + q.h + q.t : '-'); }
      return out.join();
    };
    const before = snap();
    Object.assign(p, { x: c[0] - 1, y: c[1] });
    let mv = 0;
    for (let i = 0; i < 80; i++) {
      p.awakeAt = g.ticks;
      g.guard('test', () => g.move(i % 2 ? -1 : 1, 0)); // 左右走，過幾次整點
      mv++;
    }
    ok(g.ticks >= 800 && g.monsters.length === 1 && snap() === before, `走了 ${mv} 步（${g.ticks} 刻，過了 ${Math.floor(g.ticks / C.EVENT_TICKS)} 次整點），地面沒變、沒有新怪物（${g.monsters.length} 隻）`);
    for (let i = 0; i < 300; i++) FE.AI.worldTurn(g);
    ok(snap() === before && g.monsters.length === 1, '怪物放著 300 回合，不侵蝕周遭的地面');
  }

  // 9. 存檔：穩定值（含欠的量）存起來讀回來一模一樣，怪物身上的 bug 也在，大小合理
  {
    const g = newGame(3434);
    for (let k = 0; k < 5; k++) g.createChunk(false);
    g.worldState = 1;
    const reach = FE.Checker.reachable(g.world);
    for (let h = 0; h < 40; h++) FE.Stability.decay(g, reach);
    FE.Stability.spawnDecay(g, reach);
    for (const [x, y] of box([g.player.x + 3, g.player.y], 4)) g.world.setStab(x, y, 12345 - 6 * x - y);
    g.world.recountDebt();
    FE.Save.save(g);
    const raw = JSON.stringify(FE.store.load('fe.save', null));
    const back = FE.Save.load();
    ok(back && back.game, '讀得回來');
    if (back && back.game) {
      const g2 = back.game;
      const same = g2.world.chunks.length === g.world.chunks.length && g.world.chunks.every((ch, k) => ch.stab.every((v, j) => v === g2.world.chunks[k].stab[j]) && ch.debt === g2.world.chunks[k].debt);
      ok(same && g2.world.debt === g.world.debt && g2.world.debt === sumDebt(g2), `穩定值讀回來一致（欠 ${g.world.debt}／${g2.world.debt}）`);
      ok(g2.monsters.length === g.monsters.length && g2.monsters.every((m, k) => m.bug === g.monsters[k].bug) && total(g2) === total(g), '怪物的 bug、整體 BUG 值讀回來一致');
      g2.worldState = 1;
      FE.Stability.decay(g2, FE.Checker.reachable(g2.world));
      ok(g2.world.debt === sumDebt(g2), '讀回來的遊戲還能繼續掉');
    }
    const per = raw.length / g.world.chunks.length;
    ok(raw.length < 60000 * g.world.chunks.length && g.world.chunks.every((ch) => ch.stab.length === 576), `存檔 ${g.world.chunks.length} 塊 ${raw.length} 字元（每塊約 ${per.toFixed(0)}）`);
    ok(FE.CONFIG.SAVE_VERSION === 27, `存檔版本 ${FE.CONFIG.SAVE_VERSION}`);
  }

  // 10. 獎勵不變：經驗值、打倒時的算力、掉的錢照 m.scope＝max(1, round(blockValue ÷ REWARD_VALUE_PER_SCOPE))，跟格子的穩定值無關
  {
    const g = newGame(2323);
    const at = field(g, 5);
    const reach = FE.Checker.reachable(g.world);
    const group = g.spawnList({ type: 'DECAY', x: at[0], y: at[1], cells: [], scope: 1, data: {} }, [['ogre', 'mid'], ['goblin', 'small'], ['wolf', 'small']], (x, y) => reach.at(x, y), {});
    ok(C.REWARD_VALUE_PER_SCOPE === 200 && C.BUDGET_PER_SCOPE === undefined, '設定改名：BUDGET_PER_SCOPE → REWARD_VALUE_PER_SCOPE');
    let bad = '';
    for (const m of group) {
      const v = FE.blockValue(FE.monsterBlock(m.race, FE.blockKey(m)));
      const scope = Math.max(1, Math.round(v / 200));
      const wl = FE.Stability.worldLevel(g);
      if (m.scope !== scope || m.exp !== Math.round((4 + scope * 2) * FE.wlScale(wl, C.WL_BONUS.REWARD)) || m.compute !== FE.killCompute(m.tier, scope, wl) || m.bug !== Math.round(v)) bad += `${m.name} scope ${m.scope}（應該 ${scope}）bug ${m.bug}；`;
    }
    ok(group.length === 3 && !bad, `獎勵照 scope 算：${bad}`);
    ok(group[0].scope === 6 && group[1].scope === 1, `食人魔 scope ${group[0].scope}、哥布林 ${group[1].scope}`);
    ok(FE.blockValue(FE.monsterBlock('goblin', 'small')) === 165, '哥布林值 165');
    // 一群裡面倒下的怪物，經驗值照舊
    const exp0 = g.exp;
    g.defeat(group[1]);
    ok(g.exp - exp0 === group[1].exp, `打倒哥布林經驗值 ${g.exp - exp0}`);
  }

  // 11. 合體守恆：合進去的怪物 bug 加總＝合體怪物的 bug；整體 BUG 值不變
  {
    const g = newGame(4545);
    const c = field(g, 6, { minD: 20 });
    const reach = FE.Checker.reachable(g.world);
    const group = [];
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const m = g.spawnMonster({ type: 'DECAY', x: c[0] + dx, y: c[1] + dy, cells: [], scope: 1, data: {} }, (x, y) => reach.at(x, y));
      m.small = true;
      group.push(m);
    }
    const bug0 = group.reduce((t, m) => t + m.bug, 0);
    const t0 = total(g);
    g.player.maxHp = 1; // 難度評級夠高，一定合體
    Object.assign(g.player, { x: c[0] + 18, y: c[1] });
    FE.AI.worldTurn(g);
    const big = g.monsters.find((m) => m.members);
    ok(!!big && g.monsters.length === 1 && big.bug === bug0 && total(g) === t0, `合體：${group.length} 隻 bug ${bug0} → ${big ? big.bug : '沒合'}，整體 ${t0} → ${total(g)}`);
  }
}
UNITS.stability33 = () => {
  // 精確的檢查（每小時掉的量、冷卻區與聚落圈不掉）要每一格都掉，先把機率設成 1；機率本身另外在 testDecayChance 量。
  // 生怪的檢查（每小時最多 2 群）也先不限速（DECAY_GROUP_RATE 0）；限速另外在 testGroupRate 量
  const chance0 = C.DECAY_CELL_CHANCE;
  const rate0 = C.DECAY_GROUP_RATE;
  C.DECAY_CELL_CHANCE = 1;
  C.DECAY_GROUP_RATE = 0;
  try {
    testStability33();
    C.DECAY_CELL_CHANCE = chance0;
    C.DECAY_GROUP_RATE = rate0;
    testDecayChance();
    testGroupRate();
  } catch (e) { fail('穩定值測試拋出例外：' + e.stack); } finally { C.DECAY_CELL_CHANCE = chance0; C.DECAY_GROUP_RATE = rate0; }
};

// 衰敗生怪的速度（第三十三版之三（三））：每小時能生的群數＝區塊數 × DECAY_GROUP_RATE，小數部分照機率擲，最多 DECAY_GROUPS_PER_HOUR
function testGroupRate() {
  const ok = (cond, msg) => { stabChecks++; if (!cond) fail('穩定值 ' + msg); };
  ok(C.DECAY_GROUP_RATE > 0, `限速設定 ${C.DECAY_GROUP_RATE}`);
  const g = new FE.Game(6262);
  g.start();
  const n = g.world.chunks.length;
  const e = n * C.DECAY_GROUP_RATE;
  let sum = 0;
  let max = 0;
  const H = 20000;
  for (let h = 0; h < H; h++) {
    const c = FE.Stability.groupCap(g);
    sum += c;
    max = Math.max(max, c);
  }
  ok(Math.abs(sum / H - Math.min(e, C.DECAY_GROUPS_PER_HOUR)) < 0.01 && max <= Math.max(1, Math.ceil(e)) && max <= C.DECAY_GROUPS_PER_HOUR, `${n} 塊：每小時平均 ${(sum / H).toFixed(3)} 群（應為 ${e.toFixed(3)}），最多 ${max}`);
  // 欠很多也照速度生：開局的 16 塊整片欠債，100 小時生的群數接近 100 × 區塊數 × 速度，不是每小時 2 群
  g.monsters = [];
  const w = g.world;
  const reach = FE.Checker.reachable(w);
  w.forEachCell((x, y) => { if (w.passable(x, y) && !w.inBuffer(x, y)) w.setStab(x, y, -300); });
  let groups = 0;
  for (let h = 0; h < 100; h++) groups += FE.Stability.spawnDecay(g, reach);
  ok(groups <= Math.ceil(100 * e * 2) + 2 && groups < 100 * C.DECAY_GROUPS_PER_HOUR / 4, `整片欠債 100 小時生了 ${groups} 群（期望約 ${(100 * e).toFixed(1)}）`);
}

// 每小時只有少數格子往下掉：每一格各自有 DECAY_CELL_CHANCE 的機率會掉，掉的量照狀態、同一小時全世界一樣；動盪、失序的機率不另外加
function testDecayChance() {
  const ok = (cond, msg) => { stabChecks++; if (!cond) fail('穩定值 ' + msg); };
  ok(C.DECAY_CELL_CHANCE > 0 && C.DECAY_CELL_CHANCE < 1, `機率設定 ${C.DECAY_CELL_CHANCE}`);
  const g = new FE.Game(5151);
  g.start();
  g.monsters = [];
  const w = g.world;
  w.forEachCell((x, y) => w.setStab(x, y, 1000));
  const reach = FE.Checker.reachable(w);
  const live = [];
  w.forEachCell((x, y) => { if (w.passable(x, y) && !w.inBuffer(x, y) && reach.at(x, y)) live.push([x, y]); });
  for (const st of [0, 1, 2]) {
    g.worldState = st;
    w.forEachCell((x, y) => w.setStab(x, y, 1000));
    const amt = FE.Stability.decay(g, reach);
    const dropped = live.filter(([x, y]) => w.stab(x, y) !== 1000);
    const frac = dropped.length / live.length;
    ok(dropped.every(([x, y]) => w.stab(x, y) === 1000 - amt), `狀態 ${st}：掉的格子都掉同樣的量 ${amt}`);
    ok(Math.abs(frac - C.DECAY_CELL_CHANCE) < 0.02, `狀態 ${st}：${live.length} 格裡掉了 ${(100 * frac).toFixed(1)}%（機率 ${C.DECAY_CELL_CHANCE}）`);
  }
  // 不在「活的」範圍的格子不掉
  let rock = null;
  w.forEachCell((x, y) => { if (!rock && !w.passable(x, y)) rock = [x, y]; });
  w.setStab(rock[0], rock[1], 1000);
  for (let h = 0; h < 30; h++) FE.Stability.decay(g, reach);
  ok(w.stab(rock[0], rock[1]) === 1000, '水與巨石不掉');
  g.worldState = 0;
}
