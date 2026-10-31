// 世界狀態：整體 BUG 值＝整個世界還沒修好的錯的影響範圍總和（所有怪物的 scope 加總，合體怪物用合體後的）。
// 兩個分界（config.js 的 STATE_CUTS，乘上世界等級的加成）把世界分成安穩、動盪、失序三級，沒有崩塌。
// 狀態越差：新錯越大、侵蝕越勤、新世界越粗糙、更容易合體；動盪起 BUG 與系統開始爭鬥（修好的錯復發、有東西被弄壞、修補力被吃掉）；
// 失序時冒險者每個動作花兩倍的刻，城鎮的士兵出城清掉事件與侵蝕生的小怪物（ai.js 的 soldierTurn）。
// 世界狀態（game.worldState：0 安穩、1 動盪、2 失序）跟世界等級（隱藏，worldLevel(game)）是兩回事：
// 世界等級＝1＋floor((創出的塊數－1)／3)，每升一級怪物變強、侵蝕變勤、狀態的分界變高。
// 遊戲內的文字只寫世界裡看得到的現象；整體 BUG 值與世界等級不顯示在畫面上，開發者在 console 用 FE.Stability.total(FE.game) 看。
(function () {
  const C = FE.CONFIG;
  const NAMES = ['安穩', '動盪', '失序'];
  const MSG = {
    up1: '世界開始動盪，地面上的異常越積越多。',
    up2: '世界失序了！時間彷彿被拖慢，你每動一下，怪物都多動一次。',
    soldiers: '城鎮的士兵出動了，去清掃野外的怪物。',
    down1: '世界稍微穩了下來，但仍然動盪。',
    down0: '世界安穩了下來。',
  };

  // 測試與開發者統計用，不進存檔
  const stat = (game) =>
    game._stab ||
    (game._stab = { recur: 0, sabotage: 0, soldierActs: 0, soldierSlots: 0, soldierAttacks: 0, soldierKills: 0, soldierDeaths: 0, sorties: 0, refills: 0 });
  const state = (game) => game.worldState || 0;
  const worldLevel = (game) => FE.worldLevelFor(game.world.chunks.length);
  const mult = (game, key) => C['STATE_' + key][state(game)];
  const total = (game) => game.monsters.reduce((s, m) => s + m.scope, 0);
  // 世界等級的加成倍率，例如 scale(game, 'CORRUPT')
  const scale = (game, key) => FE.wlScale(worldLevel(game), C.WL_BONUS[key]);

  // 往上用分界，往下要低於分界的幾成，免得在分界上來回跳；分界跟著世界等級變高
  function stateFor(sum, cur, cutScale) {
    let lv = cur || 0;
    const cut = (i) => C.STATE_CUTS[i] * cutScale;
    while (lv < 2 && sum >= cut(lv)) lv++;
    while (lv > 0 && sum < cut(lv - 1) * C.STATE_HYST) lv--;
    return lv;
  }

  // 重新量整體 BUG 值，狀態變了就在訊息框寫一行（quiet 時不寫）；回到安穩時補回陣亡的士兵
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
    if (state(game) === 0) game.refillSoldiers();
  }

  const maxScope = (game) => Math.round(C.STATE_MAX_SCOPE[state(game)] * scale(game, 'SCOPE'));

  // ---- 新世界的粗糙程度 ----
  // 每塊區塊的亂數只看世界種子和區塊座標，基本生成不變；創出新的一塊之後，另外依世界狀態用 game.rng 多蓋幾塊氣候印章或高度突變
  // （不落在聚落周圍的圈和地貌）。這是「依世界狀態額外加的粗糙」，沒有這些的世界跟同一個種子的基本樣子一樣
  function roughen(game, rect) {
    const w = game.world;
    const n = C.STATE_ROUGH[state(game)];
    let made = 0;
    for (let i = 0; i < n; i++) {
      for (let tries = 0; tries < 30; tries++) {
        const cx = FE.randInt(game.rng, rect.x0 + 2, rect.x1 - 3);
        const cy = FE.randInt(game.rng, rect.y0 + 2, rect.y1 - 3);
        if (w.inBuffer(cx, cy) || w.landmarkAt(cx, cy) || !w.passable(cx, cy)) continue;
        const stamp = game.rng() < 0.5;
        const biome = FE.pick(game.rng, FE.STAMP_BIOMES);
        const dh = game.rng() < 0.5 ? 2 : -2;
        const r = stamp ? 1.5 + game.rng() * 2 : 0.8 + game.rng() * 1.2;
        for (let y = Math.floor(cy - r); y <= cy + r; y++) {
          for (let x = Math.floor(cx - r); x <= cx + r; x++) {
            if (!FE.inRect(rect, x, y) || (x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
            if (w.inBuffer(x, y) || w.landmarkAt(x, y) || !w.passable(x, y)) continue;
            const c = w.cell(x, y);
            if (stamp) {
              if (c.biome !== 'lake' && c.h < 3) w.setCell(x, y, FE.BIOMES[biome].paint(game.rng, c.h), biome);
            } else {
              w.setHeight(x, y, Math.max(0, Math.min(C.MAX_HEIGHT, c.h + dh)));
            }
          }
        }
        made++;
        break;
      }
    }
    return made;
  }

  // ---- BUG 與系統爭鬥（動盪起） ----
  // 修好的地形錯位與斷崖記下來，之後可能復發
  function noteFix(game, m) {
    game.fixed = game.fixed || [];
    game.fixed.push({ type: m.type, cells: m.cells.slice(0, 40) });
    if (game.fixed.length > 40) game.fixed.shift();
  }

  function recur(game) {
    const w = game.world;
    if (!game.fixed || !game.fixed.length) return false;
    const rec = game.fixed.splice(Math.floor(game.rng() * game.fixed.length), 1)[0];
    const ok = (x, y) =>
      w.inBounds(x, y) && !w.inBuffer(x, y) && !w.landmarkAt(x, y) && w.passable(x, y) && !game.isPlayerAt(x, y) && !game.monsterAt(x, y);
    const cells = rec.cells.slice().sort(() => game.rng() - 0.5).slice(0, 12);
    for (const [x, y] of cells) {
      if (!ok(x, y)) continue;
      if (rec.type === 'TERRAIN') {
        const [dx, dy] = FE.pick(game.rng, [[1, 0], [-1, 0], [0, 1], [0, -1]]);
        if (!ok(x + dx, y + dy)) continue;
        // 再弄出一對直接相鄰的苔原和沙漠；之後照原流程被檢查器抓成小怪物
        w.setCell(x, y, '.', 'tundra');
        w.setCell(x + dx, y + dy, ':', 'desert');
      } else {
        const h = w.cell(x, y).h;
        let done = false;
        for (const dh of game.rng() < 0.5 ? [2, -2] : [-2, 2]) {
          const nh = Math.max(0, Math.min(C.MAX_HEIGHT, h + dh));
          const steep = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
            const n = w.cell(x + dx, y + dy);
            return n && w.passable(x + dx, y + dy) && Math.abs(n.h - nh) >= 2;
          });
          if (nh !== h && steep) {
            w.setHeight(x, y, nh);
            done = true;
            break;
          }
        }
        if (!done) continue;
      }
      stat(game).recur++;
      if (Math.abs(x - game.player.x) + Math.abs(y - game.player.y) <= 30) game.say('不久前才修好的地面，又裂開了。', 'bug');
      return true;
    }
    return false;
  }

  // 破壞系統的東西：把還沒開的寶箱金幣算壞（狂亂），當下就生出對應的小怪物。
  // 送貨委託不再被改成指向不存在的人（第二十五版：送貨就只是送貨，救人等之後的劇情委託）
  function sabotage(game, canReach) {
    const w = game.world;
    if (game.monsters.filter((m) => m.small).length >= C.SMALL_CAP) return false;
    const list = w.chests.filter((c) => !FE.Checker.checkChest(c));
    if (!list.length) return false;
    const c = FE.pick(game.rng, list);
    const old = c.gold;
    c.gold = -FE.randInt(game.rng, 6, 30);
    const d = FE.Checker.checkChest(c);
    d.scope = Math.min(d.scope, maxScope(game));
    const m = game.spawnMonster(d, canReach);
    if (!m) {
      c.gold = old;
      return false;
    }
    m.small = true;
    stat(game).sabotage++;
    game.say('某個寶箱裡的金幣忽然算不清了，一隻' + m.name + '冒了出來。', 'bug');
    return true;
  }

  // 每次演算事件：動盪起 BUG 與系統爭鬥
  function struggle(game, canReach) {
    if (!state(game)) return;
    if (game.rng() < mult(game, 'RECUR')) recur(game);
    if (game.rng() < mult(game, 'SABOTAGE')) sabotage(game, canReach);
  }

  FE.Stability = { names: NAMES, state, worldLevel, scale, total, update, mult, maxScope, roughen, noteFix, struggle, stat };
})();
