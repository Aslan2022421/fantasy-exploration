// 世界狀態：整體 BUG 值＝整個世界還沒修好的量（第三十三版之三）＝所有怪物的 bug（牠的 blockValue，合體怪物是合進去的加總）
// ＋全世界負的穩定值的絕對值加總（world.debt）。每格有一個穩定值，正的不生怪物，負的生怪物，負的量就是 BUG 值，單位同 FE.blockValue。
// 兩個分界（config.js 的 STATE_CUTS，乘上世界等級的加成）把世界分成安穩、動盪、失序三級，沒有崩塌。
// 狀態越差：每小時格子往下掉得越快（STAB_DECAY）、更容易合體；動盪起修補力被吃掉；
// 失序時冒險者每個動作花兩倍的刻，城鎮的士兵出城清掉衰敗生的小怪物（ai.js 的 soldierTurn）。
// 世界狀態（game.worldState：0 安穩、1 動盪、2 失序）跟世界等級（隱藏，worldLevel(game)）是兩回事：
// 世界等級＝1＋長滿的圈數，每升一級怪物變強、創世時一處欠的量變多、狀態的分界變高。
// 遊戲內的文字只寫世界裡看得到的現象；整體 BUG 值與世界等級不顯示在畫面上，開發者在 console 用 FE.Stability.total(FE.game) 看。
//
// 每小時（events.js 的 tick，每 100 刻）依序：decay 每格往下掉 → spawnDecay 負格子連成的一片欠夠多就生一群怪物 → 委託事件 → mend 用剩下的修補力補冒險者身邊最負的格子。
(function () {
  const C = FE.CONFIG;
  const NAMES = ['安穩', '動盪', '失序'];
  const MSG = {
    up1: '世界開始動盪，各地越來越不穩，怪物越聚越多。',
    up2: '世界失序了！時間彷彿被拖慢，你每動一下，怪物都多動一次。',
    soldiers: '城鎮的士兵出動了，去清掃野外的怪物。',
    down1: '世界稍微穩了下來，但仍然動盪。',
    down0: '世界安穩了下來。',
  };
  const DIRS8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

  // 測試與開發者統計用，不進存檔
  const stat = (game) =>
    game._stab ||
    (game._stab = {
      soldierActs: 0, soldierSlots: 0, soldierAttacks: 0, soldierKills: 0, soldierDeaths: 0, sorties: 0, refills: 0,
      // 第三十三版之三：衰敗的小時數、每小時掉的量加總、從衰敗生出的群與隻數、修補力補回的穩定值
      decayHours: 0, decayTotal: 0, decayGroups: 0, decayMonsters: 0, mended: 0,
      // 第三十版：長休次數與付的錢（銅）、短休次數、經濟標籤升降次數、力竭最高到幾級
      longRests: 0, restPaid: 0, shortRests: 0, econUp: 0, econDown: 0, exhaustMax: 0, jobs: { hunt: 0, deliver: 0, herb: 0, ore: 0 },
    });
  const state = (game) => game.worldState || 0;
  // 第三十二版：世界等級＝1＋長滿的圈數（開局 1 級，長到 288×288 是 5 級）
  const worldLevel = (game) => 1 + (game.world.ringsDone || 0);
  const mult = (game, key) => C['STATE_' + key][state(game)];
  // 整體 BUG 值：怪物身上的 bug（寫著 m.bug；合體怪物是合進去的加總）＋全世界負的穩定值
  const total = (game) => game.allMonsters().reduce((s, m) => s + (m.bug || 0), 0) + game.world.debt; // 怪物遮蔽時收起來的也算（第三十四版）
  // 世界等級的加成倍率，例如 scale(game, 'CUTS')
  const scale = (game, key) => FE.wlScale(worldLevel(game), C.WL_BONUS[key]);

  // 往上用分界，往下要低於分界的幾成，免得在分界上來回跳；分界跟著世界等級變高
  function stateFor(sum, cur, cutScale) {
    let lv = cur || 0;
    const cut = (i) => C.STATE_CUTS[i] * cutScale;
    while (lv < 2 && sum >= cut(lv)) lv++;
    while (lv > 0 && sum < cut(lv - 1) * C.STATE_HYST) lv--;
    return lv;
  }

  // 重新量整體 BUG 值，狀態變了就在訊息框寫一行（quiet 時不寫）
  function update(game, quiet) {
    const was = state(game);
    const now = stateFor(total(game), was, scale(game, 'CUTS'));
    if (now !== was) {
      game.worldState = now;
      if (!quiet) {
        game.say(now === 2 ? MSG.up2 : now === 1 ? (was === 0 ? MSG.up1 : MSG.down1) : MSG.down0, 'world');
        if (now === 2 && game.soldiers && game.soldiers.length) game.say(MSG.soldiers, 'world');
      }
    }
  }

  // ---- 穩定值：每小時往下掉、生怪物、修補 ----

  // 衰敗影響到的格子：能走、從出生點走得到、不在聚落和它周圍那一圈、不在冷卻區（使用者定的：冷卻區與聚落圈不掉、不生怪物；
  // 水和巨石、走不到的格子不掉是 Claude 補的：那些格子沒有怪物站得上去，欠的量永遠還不掉）。
  // 逐格呼叫 fn(ch, i, x, y)，i 是格子在 ch.stab 裡的位置；needDebt 為真就只看有欠債的區塊
  function eachLive(game, reach, needDebt, fn) {
    const w = game.world;
    const W = C.CHUNK_W;
    const H = C.CHUNK_H;
    const calm = game.activeCalm();
    for (const ch of w.chunks) {
      if (needDebt && !ch.debt) continue;
      // 先挑出碰得到這一塊的聚落圈與冷卻區，逐格只查這幾個
      const vs = w.villages.filter((v) => {
        const B = w.bufferWidth(v);
        return v.x1 + B >= ch.x0 && v.x0 - B < ch.x1 && v.y1 + B >= ch.y0 && v.y0 - B < ch.y1;
      });
      const cs = calm.filter((c) => c.x + c.r >= ch.x0 && c.x - c.r < ch.x1 && c.y + c.r >= ch.y0 && c.y - c.r < ch.y1);
      for (let y = 0; y < H; y++) {
        const row = ch.cells[y];
        for (let x = 0; x < W; x++) {
          if (!FE.TERRAIN[row[x].t].pass) continue;
          const gx = ch.x0 + x;
          const gy = ch.y0 + y;
          if (cs.length && cs.some((c) => Math.max(Math.abs(gx - c.x), Math.abs(gy - c.y)) <= c.r)) continue;
          if (vs.length && w.inBuffer(gx, gy)) continue;
          if (!reach.at(gx, gy)) continue;
          fn(ch, y * W + x, gx, gy);
        }
      }
    }
  }

  // 每小時往下掉：每一格各自有 DECAY_CELL_CHANCE 的機率會掉，掉的量安穩 2、動盪 3～6、失序 6～12（每小時擲一次，全世界同一個值）。
  // 回傳這一小時掉的量
  function decay(game, reach) {
    const w = game.world;
    const [lo, hi] = C.STAB_DECAY[state(game)];
    const amt = lo === hi ? lo : FE.randInt(game.rng, lo, hi);
    const chance = C.DECAY_CELL_CHANCE;
    eachLive(game, reach, false, (ch, i) => {
      if (chance < 1 && game.rng() >= chance) return; // 每一格各自有 DECAY_CELL_CHANCE 的機率才掉
      const old = ch.stab[i];
      const v = Math.max(-C.STAB_LIMIT, old - amt);
      if (v === old) return;
      ch.stab[i] = v;
      const d = Math.max(0, -v) - Math.max(0, -old);
      ch.debt += d;
      w.debt += d;
    });
    const st = stat(game);
    st.decayHours++;
    st.decayTotal += amt;
    return amt;
  }

  // 衰敗生怪的速度：這一小時最多生幾群＝區塊數 × DECAY_GROUP_RATE（小數部分用 game.rng 照機率擲），不超過 DECAY_GROUPS_PER_HOUR。
  // 不限速的話格子一過 0 就一群接一群冒出來（開局區域不打怪時，後半個月一天 2～5 群）；照世界大小算，世界長大了能生的跟著變多
  function groupCap(game) {
    if (!C.DECAY_GROUP_RATE) return C.DECAY_GROUPS_PER_HOUR;
    const e = game.world.chunks.length * C.DECAY_GROUP_RATE;
    let n = Math.floor(e);
    if (game.rng() < e - n) n++;
    return Math.min(n, C.DECAY_GROUPS_PER_HOUR);
  }

  // 負格子連成的一片（8 方向相連），欠的量夠買那裡最便宜的一隻，就用整片欠的量當預算配一組怪物，生在那片裡走得到的格子；
  // 配掉的值從那片格子扣回（從生出來的地方往外，一格一格補到 0），零頭留著。不算已經有怪物負責的格子
  // （離某隻怪物的生成點 RESP_RADIUS 格以內，那隻怪物倒下時整片會補回起始值）。每小時最多 groupCap 群（照區塊數），欠最多的先。
  // 衰敗生的怪物 m.small＝true（會追人、會合體），動盪、失序時依 CAMP_CHANCE 套成營地（失序的營地，清掉後留下遺留地點，營地的怪物不追人）。
  // 回傳生了幾群
  function spawnDecay(game, reach) {
    const w = game.world;
    if (w.debt <= 0) return 0;
    const cap = groupCap(game);
    if (!cap) return 0;
    if (game.monsters.filter((m) => m.small).length >= C.DECAY_SMALL_CAP) return 0;
    const b = w.bounds();
    const GW = b.x1 - b.x0;
    const GH = b.y1 - b.y0;
    const at = (x, y) => (y - b.y0) * GW + (x - b.x0);
    // 怪物負責的範圍
    const resp = new Uint8Array(GW * GH);
    const R = C.RESP_RADIUS;
    for (const m of game.monsters) {
      const hx = m.home ? m.home.x : m.x;
      const hy = m.home ? m.home.y : m.y;
      for (let y = Math.max(b.y0, hy - R); y <= Math.min(b.y1 - 1, hy + R); y++) {
        for (let x = Math.max(b.x0, hx - R); x <= Math.min(b.x1 - 1, hx + R); x++) resp[at(x, y)] = 1;
      }
    }
    // 候選的格子：欠債、活的、沒有怪物負責
    const cand = new Uint8Array(GW * GH);
    let n = 0;
    eachLive(game, reach, true, (ch, i, x, y) => {
      if (ch.stab[i] >= 0 || resp[at(x, y)]) return;
      cand[at(x, y)] = 1;
      n++;
    });
    if (!n) return 0;
    // 8 方向連成一片，編號、各片欠多少
    const label = new Int32Array(GW * GH);
    const comps = [];
    const stack = new Int32Array(GW * GH);
    for (let s = 0; s < cand.length; s++) {
      if (!cand[s] || label[s]) continue;
      const id = comps.length + 1;
      const comp = { id, debt: 0, cells: [] };
      let sp = 0;
      stack[sp++] = s;
      label[s] = id;
      while (sp) {
        const j = stack[--sp];
        const x = b.x0 + (j % GW);
        const y = b.y0 + Math.floor(j / GW);
        comp.debt -= w.stab(x, y);
        comp.cells.push(j);
        for (const [dx, dy] of DIRS8) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < b.x0 || nx >= b.x1 || ny < b.y0 || ny >= b.y1) continue;
          const k = at(nx, ny);
          if (cand[k] && !label[k]) {
            label[k] = id;
            stack[sp++] = k;
          }
        }
      }
      comps.push(comp);
    }
    comps.sort((p, q) => q.debt - p.debt);
    const p = game.player;
    const st = state(game);
    // 生出來的怪物（帶頭的和跟班）都離冒險者至少 DECAY_MIN_DIST 步，而且在走得到的地方
    const canReach = (x, y) => reach.at(x, y) && Math.abs(x - p.x) + Math.abs(y - p.y) >= C.DECAY_MIN_DIST;
    // 已經有人或東西的格子
    const taken = new Set();
    for (const m of game.monsters) taken.add(m.x + ',' + m.y);
    for (const s of game.soldiers) taken.add(s.x + ',' + s.y);
    for (const c of game.mates) taken.add(c.x + ',' + c.y);
    if (game.hero) taken.add(game.hero.x + ',' + game.hero.y);
    for (const n of w.npcs) taken.add(n.x + ',' + n.y);
    for (const c of w.chests) taken.add(c.x + ',' + c.y);
    taken.add(p.x + ',' + p.y);
    let groups = 0;
    const floor = FE.cheapestValue(Object.keys(FE.MONSTER_BLOCKS)); // 任何地方最便宜的一隻，欠的量連這個都不到的片先略過
    for (const comp of comps) {
      if (groups >= cap) break;
      if (comp.debt < floor) break; // 已經照欠的量由多排到少
      // 在這一片裡隨機試幾格，挑得到「沒有人、沒有東西、離冒險者夠遠、欠的量買得起那裡最便宜的一隻」的
      let spot = null;
      for (let t = 0; t < 40 && !spot; t++) {
        const j = comp.cells[Math.floor(game.rng() * comp.cells.length)];
        const x = b.x0 + (j % GW);
        const y = b.y0 + Math.floor(j / GW);
        if (!canReach(x, y) || taken.has(x + ',' + y)) continue;
        if (comp.debt >= game.cheapestAt(x, y)) spot = [x, y];
      }
      if (!spot) continue;
      const camps = st > 0 && game.rng() < C.CAMP_CHANCE[st];
      const pick = game.compose(spot[0], spot[1], comp.debt, { camps, campaign: false });
      const d = { type: 'DECAY', x: spot[0], y: spot[1], cells: [], scope: 1, data: {} };
      const group = game.spawnList(d, pick.list, canReach, { camp: pick.camp, origin: 'disorder' });
      if (!group.length) continue;
      if (!pick.camp) for (const m of group) m.small = true;
      // 配掉的值從那片格子扣回：從帶頭那隻站的地方往外，一圈一圈把負的格子補到 0
      let left = Math.min(comp.debt, group.reduce((s, m) => s + m.bug, 0));
      const cx = group[0].x;
      const cy = group[0].y;
      const maxR = Math.max(GW, GH);
      const take = (x, y) => {
        if (left <= 0 || x < b.x0 || x >= b.x1 || y < b.y0 || y >= b.y1 || label[at(x, y)] !== comp.id) return;
        const v = w.stab(x, y);
        if (v >= 0) return;
        const t = Math.min(-v, left);
        w.addStab(x, y, t);
        left -= t;
      };
      for (let r = 0; r <= maxR && left > 0; r++) {
        if (r === 0) take(cx, cy);
        else {
          for (let d2 = -r; d2 <= r; d2++) {
            take(cx + d2, cy - r);
            take(cx + d2, cy + r);
            if (d2 > -r && d2 < r) {
              take(cx - r, cy + d2);
              take(cx + r, cy + d2);
            }
          }
        }
      }
      for (const m of group) taken.add(m.x + ',' + m.y);
      const s = stat(game);
      s.decayGroups++;
      s.decayMonsters += group.length;
      groups++;
      if (Math.abs(cx - p.x) + Math.abs(cy - p.y) <= C.HUNT_RADIUS * 2) {
        game.say(group.length > 1 ? `遠處的大地衰敗了下去，冒出了${group.length} 隻${group[0].name}等怪物。` : `遠處的大地衰敗了下去，冒出了一隻${group[0].name}。`, 'bug');
      }
    }
    return groups;
  }

  // 每小時事件做完之後剩下的修補力，拿去補冒險者 REPAIR_RANGE 步以內最負的格子：1 點修補力補 REPAIR_STAB_PER_COMPUTE 點穩定值，補到 0 為止，
  // 用掉的修補力扣掉。回傳補了多少點穩定值
  function mend(game) {
    if (!(game.compute > 0)) return 0;
    const w = game.world;
    const p = game.player;
    const per = C.REPAIR_STAB_PER_COMPUTE;
    const R = C.REPAIR_RANGE;
    const list = [];
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -(R - Math.abs(dy)); dx <= R - Math.abs(dy); dx++) {
        const v = w.stab(p.x + dx, p.y + dy);
        if (v < 0) list.push([v, p.x + dx, p.y + dy]);
      }
    }
    list.sort((a, c) => a[0] - c[0]);
    let healed = 0;
    for (const [v, x, y] of list) {
      const room = Math.floor(game.compute * per + 1e-9);
      if (room < 1) break;
      const heal = Math.min(-v, room);
      w.addStab(x, y, heal);
      game.compute = Math.max(0, game.compute - heal / per);
      healed += heal;
    }
    stat(game).mended += healed;
    return healed;
  }

  FE.Stability = { names: NAMES, state, worldLevel, scale, total, update, mult, decay, groupCap, spawnDecay, mend, stat };
})();
