// 進入點：讀檔或建立新世界、接鍵盤與按鈕。網址加 ?seed=數字 可以開指定的世界。
(function () {
  const params = new URLSearchParams(location.search);
  const urlSeed = parseInt(params.get('seed'), 10);

  // 開發測試用：網址加 ?nosave 就不讀也不寫存檔，不會蓋掉正在玩的進度
  if (params.has('nosave')) {
    FE.Save.save = () => {};
    FE.Save.load = () => null;
    FE.Save.clearAll = () => {};
    FE.store.save = () => {};
    FE.store.remove = () => {};
  }

  // 有存檔、而且網址沒指定別的世界，就接著上次玩；不然開新世界，先跳出視窗選職業與起始裝備（選完才生出世界）
  const saved = FE.Save.load();
  let game;
  let ready = false; // 遊戲開始了沒有（選職業的視窗開著時還沒有）
  const resume = saved && saved.game && (!Number.isFinite(urlSeed) || urlSeed === saved.game.seed);
  if (resume) {
    game = saved.game;
    game.say('讀取存檔，接著上次的進度。', 'sys');
  } else {
    game = new FE.Game(Number.isFinite(urlSeed) ? urlSeed : Math.floor(Math.random() * 1e9));
  }

  // 怪物遮蔽（第三十四版，給專心測地形與聚落用）：設定視窗的開關，記在這台瀏覽器（fe.veil，不進存檔）；網址加 ?nomonsters 也能打開。
  // 在開局之前就套上，開局那一大塊也不生怪物
  let veil = params.has('nomonsters') || !!FE.store.load('fe.veil', false);
  game.setVeil(veil);

  // 試玩紀錄：每個動作記一筆（動作、位置、生命、等級、武器、世界狀態、這個動作新增的訊息），
  // 存在這台瀏覽器（fe.playlog，最多留最近 PLAYLOG_MAX 筆），設定視窗可以匯出成檔案給開發者分析；不上傳
  const PLAYLOG_MAX = 5000;
  let playlog = FE.store.load('fe.playlog', []);
  function record(label, logBefore) {
    const p = game.player;
    const msgs = [];
    for (const l of game.log) {
      if (l === logBefore) break;
      msgs.push(l.text);
    }
    playlog.push({
      t: game.turn, k: game.ticks || 0, a: label, x: p.x, y: p.y, hp: p.hp, mhp: p.maxHp, lv: game.level, exp: game.exp,
      wpn: p.equip.main ? FE.Gear.name(p.equip.main) : '徒手', atk: game.attackText(), body: p.equip.body ? FE.Gear.name(p.equip.body) : '', g: game.hero.copper, ex: p.exhaust, ws: game.worldState, ch: game.world.chunks.length, mon: game.monsters.length,
      m: msgs.reverse(),
    });
    if (playlog.length > PLAYLOG_MAX) playlog = playlog.slice(-PLAYLOG_MAX);
    FE.store.save('fe.playlog', playlog);
  }

  function dispatch(label, fn) {
    const logBefore = game.log[0];
    game.guard(label, fn);
    record(label, logBefore);
    FE.Save.save(game);
    FE.UI.update();
  }

  // ---- 滑鼠自動行走（第三十一版）：左鍵點地圖上的一格，照最短路一步一步走過去；按空白鍵（或任何鍵）停下 ----
  // 點的是村民、工匠或士兵：走到他旁邊再開對話。途中看到新的怪物、有怪物貼上來、開了視窗或對話，就停下
  // 第三十五版之三：左鍵改成兩段式。點一次只把路線畫出來（虛線、目的地框與浮動的「幾步・約幾刻」），
  // 再點同一格或按空白鍵才出發；點別格換路線，按其他鍵、開視窗、對話、瞄準都會把路線收掉
  let walk = null;
  let route = null; // 畫出來、還沒出發的路線：{ path, npc, tx, ty, steps, ticks }
  const WALK_MS = 90;
  // 第三十七版之一：寶箱都上了鎖，撞上去是開鎖，自動行走繞開
  const blockedAt = (x, y) => game.monsterAt(x, y) || game.world.npcAt(x, y) || game.soldierAt(x, y) || game.world.chestAt(x, y);
  // 從冒險者走到 (tx, ty) 的路（不含起點）；goalAdj 時走到它旁邊就算到。只走能走、高度接得上、沒人擋的格子，最多搜 4000 格
  function findPath(tx, ty, goalAdj) {
    const p = game.player;
    const W = game.world;
    const key = (x, y) => x + ',' + y;
    const prev = new Map([[key(p.x, p.y), null]]);
    const q = [[p.x, p.y]];
    // 第三十五版之四：八方向尋路；goalAdj 時走到斜向相鄰也算到了
    const done = (x, y) => (goalAdj ? Math.max(Math.abs(x - tx), Math.abs(y - ty)) === 1 && W.heightOk(x, y, tx, ty) : x === tx && y === ty);
    for (let h = 0; h < q.length && q.length < 4000; h++) {
      const [x, y] = q[h];
      if (done(x, y)) {
        const path = [];
        for (let k = key(x, y); prev.get(k); k = prev.get(k)) path.unshift(k.split(',').map(Number));
        return path;
      }
      for (const [dx, dy] of FE.DIRS8) {
        const nx = x + dx;
        const ny = y + dy;
        if (prev.has(key(nx, ny)) || !W.inBounds(nx, ny) || !W.canStep(x, y, nx, ny) || blockedAt(nx, ny)) continue; // 八方向＋斜走規則（第三十五版之四）
        prev.set(key(nx, ny), key(x, y));
        q.push([nx, ny]);
      }
    }
    return null;
  }
  const seenMonsters = () => game.monsters.filter((m) => Math.max(Math.abs(m.x - game.player.x), Math.abs(m.y - game.player.y)) <= FE.CONFIG.SIGHT).length;
  function stopWalk(why) {
    if (!walk) return;
    clearInterval(walk.timer);
    walk = null;
    if (why) {
      game.say(why, 'sys');
      FE.UI.update();
    }
  }
  // 這條路大約走幾刻：照 move 與 endTurn 的算法加起來（超重、力量不到防具需求、身上的防具、力竭、失序）
  function pathTicks(path) {
    const p = game.player;
    const cfg = FE.CONFIG;
    const base = FE.Gear.loadTier(p) >= 1 ? cfg.OVER_MOVE_TICKS : FE.Char.strShort(p) ? Math.max(cfg.STR_REQ_TICKS, FE.Char.moveTicks(p)) : FE.Char.moveTicks(p);
    const tired = FE.Char.exhaustMoveMul(p);
    const extra = FE.Gear.extraTicks(p);
    const chaos = FE.Stability.state(game) === 2 ? cfg.CHAOS_TIME : 1;
    return path.length * (Math.round(base * tired) + extra) * chaos;
  }
  // 把路線收掉（出發前改做別的事都用得到）；回傳 true 表示本來有路線
  function clearRoute() {
    if (!route) return false;
    route = null;
    FE.UI.setRoute(null);
    return true;
  }
  function cancelRoute() {
    if (clearRoute()) FE.UI.update();
  }
  // 第一段：算出最短路，畫出來，先不走
  // adj：走到它旁邊就算到（寶箱、上鎖的門這種站不上去的目標用）
  function showRoute(tx, ty, npc, adj) {
    stopWalk();
    const path = findPath(tx, ty, !!npc || !!adj);
    if (!path) {
      clearRoute();
      game.say('走不到那裡。', 'sys');
      FE.UI.update();
      return;
    }
    route = { path, npc, tx, ty, steps: path.length, ticks: pathTicks(path) };
    FE.UI.setRoute(route);
    FE.UI.update();
  }
  // 第二段：從畫好的路線出發（空白鍵或再點同一格）
  function startRoute() {
    if (!route) return;
    const r = route;
    clearRoute();
    startWalk(r.path, r.npc);
  }
  function startWalk(path, npc) {
    walk = { path: path.slice(), npc, seen: seenMonsters(), timer: null };
    const step = () => {
      if (!walk || game.talking != null || FE.UI.win() || game.hero.points > 0) return stopWalk();
      if (!walk.path.length) {
        const n = walk.npc;
        stopWalk();
        if (n) dispatch('對話', () => game.openTalk(n));
        return;
      }
      const [x, y] = walk.path.shift();
      const p = game.player;
      if (blockedAt(x, y)) return stopWalk('有東西擋住了路，停了下來。');
      dispatch('移動', () => game.move(x - p.x, y - p.y, { noTalk: true }));
      if (game.player.x !== x || game.player.y !== y) return stopWalk();
      const now = seenMonsters();
      if (game.adjacentMonsters().length || now > walk.seen) return stopWalk('看到怪物，停下腳步。');
      walk.seen = now;
    };
    walk.timer = setInterval(step, WALK_MS);
    step();
  }
  // 直接出發（查看視窗的「走過去對話」用，不經過路線預覽）
  function walkTo(tx, ty, npc) {
    stopWalk();
    clearRoute();
    const path = findPath(tx, ty, !!npc);
    if (!path) {
      game.say('走不到那裡。', 'sys');
      FE.UI.update();
      return;
    }
    startWalk(path, npc);
  }

  // 選了招式清單的第 i 項：要瞄準的進入瞄準（F 或 Enter 出手），其他的直接施放
  function pickSpell(i) {
    const o = FE.UI.spellAt(i);
    if (!o || !o.ok) return;
    FE.UI.closeSpells();
    if (o.id === 'shoot') {
      game.aimStart('shoot');
      FE.UI.update();
    } else if (FE.SPELLS[o.id].aim) {
      game.aimStart(o.id);
      FE.UI.update();
    } else dispatch('施法：' + o.id, () => game.cast(o.id));
  }
  document.getElementById('modal').addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-spell]');
    if (b && !b.disabled) pickSpell([...b.parentNode.children].indexOf(b));
    const r = e.target.closest && e.target.closest('[data-rest]');
    if (r && !r.disabled) pickRest(r.dataset.rest);
  });
  // 住一晚的選項：生活水準 0～4（字串），leave 不住
  function pickRest(id) {
    FE.UI.closeRestAsk();
    if (id !== 'leave') dispatch('休息', () => game.rest(Number(id)));
  }

  const DIRS = {
    arrowup: [0, -1], arrowdown: [0, 1], arrowleft: [-1, 0], arrowright: [1, 0],
    w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0],
  };
  // 第三十五版之四點一：斜走改成同時按兩個方向鍵（W＋D、↑＋→⋯⋯），或數字鍵盤的 7、9、1、3（8、2、4、6 是上下左右，NumLock 開關都一樣）；
  // 拿掉第三十五版之四的 Shift＋Q／E／Z／C。先按下的方向鍵等 CHORD_MS 看第二個鍵來不來，來了就斜走一步；兩個鍵一起按住連發時一直斜走
  const NUMPAD = { Numpad7: [-1, -1], Numpad8: [0, -1], Numpad9: [1, -1], Numpad4: [-1, 0], Numpad6: [1, 0], Numpad1: [-1, 1], Numpad2: [0, 1], Numpad3: [1, 1] };
  const CHORD_MS = 60;
  const held = new Set(); // 按住中的方向鍵（DIRS 的鍵名）
  let chord = null;       // 先按下的方向鍵在等第二個鍵：{ timer, dir }
  // 按住的方向鍵合起來的方向（相反的兩個鍵互相抵消）
  const heldDir = () => {
    let dx = 0;
    let dy = 0;
    for (const h of held) {
      dx += DIRS[h][0];
      dy += DIRS[h][1];
    }
    return [Math.sign(dx), Math.sign(dy)];
  };
  const step = ([dx, dy]) => {
    if (dx || dy) dispatch('移動', () => game.move(dx, dy, { noTalk: true }));
  };
  function dirKey(e, k) {
    held.add(k);
    const [dx, dy] = heldDir();
    if (chord) {
      // 第二個鍵在等待時間內來了：照兩個鍵合起來的方向走一步
      clearTimeout(chord.timer);
      chord = null;
      step(dx || dy ? [dx, dy] : DIRS[k]);
      return;
    }
    // 按住連發，或另一個方向鍵早就按住了：照合起來的方向馬上走
    if (e.repeat || (dx && dy)) {
      step(dx || dy ? [dx, dy] : DIRS[k]);
      return;
    }
    const dir = DIRS[k];
    chord = {
      dir,
      timer: setTimeout(() => {
        chord = null;
        const [hx, hy] = heldDir();
        step(hx || hy ? [hx, hy] : dir); // 很快就放開了的話，照原本那個鍵走
      }, CHORD_MS),
    };
  }
  document.addEventListener('keyup', (e) => held.delete(e.key.toLowerCase()));
  window.addEventListener('blur', () => held.clear());
  // 1 攻擊、2 重擊、3 撤退、4 治療（牧師、聖騎士）、5 盾擊（戰士）、6 撤離、7 閃避、F 遠程（射擊、投擲、施法、神聖之光：先進入瞄準）、T 投擲（任何武器）
  const ACTS = { 1: 'attack', 2: 'deep', 3: 'flee', 4: 'heal', 5: 'bash', f: 'fire', t: 'throw' }; // 第三十一版：撤退與撤離合併成 3 逃跑，主動閃避拿掉
  // 按鍵視窗：同時只開一個
  // 第三十七版：角色 C、裝備 B、委託 Q、日誌 H、聚落 I、地圖 M、訊息 J 是同一個大視窗的頁籤（按另一頁的字母就換頁，同一個字母關掉）；圖例 L、錯誤報告 ` 各自一個視窗
  const WINDOW_KEYS = { l: 'legend', h: 'history', j: 'messages', b: 'backpack', c: 'character', m: 'minimap', q: 'quests', i: 'steading', '`': 'reports' };

  // 在對話視窗裡選第 i 個選項（選項本身不再花動作）
  function choose(i) {
    const npc = game.talking != null ? game.talkTarget(game.talking) : null;
    if (!npc) {
      game.closeTalk();
      FE.UI.update();
      return;
    }
    FE.UI.clearShopSelection();
    dispatch('對話', () => game.choose(npc, i));
  }

  // 背包：先選物品，再執行資訊區提供的操作
  function bagAction(action) {
    const i = FE.UI.selectedBagIndex();
    if (i == null || !game.bagList()[i]) return;
    if (action === 'drop') {
      FE.UI.askBagDrop();
      return;
    }
    if (action === 'cancelDrop') {
      FE.UI.cancelBagDrop();
      return;
    }
    if (action === 'confirmDrop') {
      if (!FE.UI.bagDropConfirm()) return;
      FE.UI.clearBagSelection();
      dispatch('背包：丟棄', () => game.dropItem(i));
      return;
    }
    if (action === 'use' || action === 'off') {
      FE.UI.clearBagSelection();
      dispatch(action === 'off' ? '背包：拿在副手' : '背包', () => game.useItem(i, action === 'off'));
      if (game.aim) FE.UI.closeWindow();
    }
  }

  // 換人操作（Tab 或點隊員欄）：i 沒給就換下一位；換了不花時間，存一次檔
  function switchParty(i) {
    stopWalk();
    clearRoute();
    if (game.cycleControl(i)) FE.Save.save(game);
    FE.UI.update();
  }
  // 角色視窗（第三十六版之三）：點頁籤換看的人；點「加 1」替那位隊友加屬性點
  document.getElementById('charInfo').addEventListener('click', (e) => {
    if (!ready) return;
    const tab = e.target.closest && e.target.closest('[data-charview]');
    if (tab) {
      FE.UI.charView(Number(tab.dataset.charview));
      return;
    }
    const add = e.target.closest && e.target.closest('[data-mate-attr]');
    if (add && !add.disabled) {
      const m = FE.UI.charViewed();
      dispatch('隊友加點', () => game.spendMatePoint(m, add.dataset.mateAttr));
    }
  });
  document.getElementById('party').addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-party]');
    if (b && ready && game.talking == null && !FE.UI.win() && !game.aim) switchParty(Number(b.dataset.party));
  });

  function toggleWindow(name) {
    cancelRoute();
    if (FE.UI.win() === name) FE.UI.closeWindow();
    else FE.UI.openWindow(name);
  }

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.code === 'Backquote' ? '`' : e.key.toLowerCase();
    // 開新世界的選職業視窗（這時還沒有世界）：數字鍵選，Esc 回上一步
    if (!ready) {
      if (FE.UI.startKey(k)) e.preventDefault();
      return;
    }
    // 畫好的路線還沒出發：空白鍵直接出發（村民、工匠就是走過去開對話）；其他鍵把路線收掉，照那個鍵本來的功能走
    if (route) {
      if (k === ' ') {
        e.preventDefault();
        startRoute();
        return;
      }
      cancelRoute();
    }
    // 自動行走中：空白鍵（或任何鍵）停下
    if (walk) {
      e.preventDefault();
      stopWalk('你停下了腳步。');
      return;
    }
    // 升級加點視窗開著：只能按 1～6 選屬性，其他鍵都不作用
    if (game.hero.points > 0) {
      e.preventDefault();
      if (/^[1-6]$/.test(k)) dispatch('升級加點', () => game.spendPoint(FE.ATTRS[Number(k) - 1].key));
      return;
    }
    // 施法的招式清單開著：數字鍵選招，Esc 取消
    if (FE.UI.spellsOpen()) {
      e.preventDefault();
      if (k === 'escape') FE.UI.closeSpells();
      else if (/^[1-9]$/.test(k)) pickSpell(Number(k) - 1);
      return;
    }
    // 住一晚的選項視窗開著：數字選生活水準或不住，Esc 不住，其他鍵不作用
    if (FE.UI.restAsking()) {
      e.preventDefault();
      if (/^[1-9]$/.test(k)) {
        const o = FE.UI.restOptions()[Number(k) - 1];
        if (o && o.ok) pickRest(o.id);
      } else if (k === 'escape') pickRest('leave');
      return;
    }
    // 在輸入框裡打字時只認 Esc（關掉設定視窗）
    if (e.target.tagName === 'INPUT') {
      if (k === 'escape') {
        e.target.blur();
        FE.UI.closeWindow();
      }
      return;
    }
    if (k === 'f9') {
      e.preventDefault();
      dispatch('F9 測試', () => {
        throw new Error('模擬執行錯誤（F9 測試鍵）');
      });
      return;
    }
    // 對話視窗開著：工匠交易只用滑鼠選取，Enter 確認、Esc 取消或離開；其他對話沿用數字鍵
    if (game.talking != null) {
      const shopSelection = FE.UI.shopSelection();
      if (FE.UI.shopActive()) {
        e.preventDefault();
        if (shopSelection && k === 'escape') FE.UI.cancelShopItem();
        else if (shopSelection && k === 'enter') {
          const i = FE.UI.shopConfirmIndex();
          if (i >= 0) choose(i);
        } else if (!shopSelection && k === 'escape') FE.UI.closeShop();
        return;
      }
      if (shopSelection && k === 'escape') {
        e.preventDefault();
        FE.UI.cancelShopItem();
      } else if (shopSelection && k === 'enter') {
        e.preventDefault();
        const i = FE.UI.shopConfirmIndex();
        if (i >= 0) choose(i);
      } else if (shopSelection) {
        e.preventDefault();
      } else if (k === 'escape') {
        e.preventDefault();
        game.talkBack();
        FE.UI.update();
      } else if (/^[1-9]$/.test(k)) {
        e.preventDefault();
        choose(Number(k) - 1);
      } else if (DIRS[k] || k === 'r') {
        e.preventDefault();
      }
      return;
    }
    // 瞄準中（按了 F）：Tab 換目標，F 或 Enter 出手，Esc 取消；其他鍵不作用
    if (game.aim) {
      e.preventDefault();
      if (k === 'tab') {
        game.aimNext();
        FE.UI.update();
      } else if (k === 'f' || k === 't' || k === 'enter') {
        dispatch('戰鬥：遠程', () => game.aimFire());
      } else if (k === 'escape') {
        game.aimCancel();
        FE.UI.update();
      }
      return;
    }
    // Tab：換下一位操作（冒險者 → 隊友 1 → 隊友 2 → ⋯⋯ → 冒險者；第三十六版之一）。不花時間；視窗開著時不作用
    if (k === 'tab') {
      e.preventDefault();
      if (!FE.UI.win()) switchParty();
      return;
    }
    if (k === 'escape') {
      e.preventDefault();
      if (FE.UI.win() === 'backpack' && FE.UI.bagDropConfirm()) FE.UI.cancelBagDrop();
      else if (FE.UI.win()) FE.UI.closeWindow();
      else FE.UI.openWindow('settings');
      return;
    }
    if (WINDOW_KEYS[k]) {
      e.preventDefault();
      toggleWindow(WINDOW_KEYS[k]);
      return;
    }
    if (k === '-' || k === '_' || k === '=' || k === '+') {
      e.preventDefault();
      zoom += k === '-' || k === '_' ? -1 : 1;
      applyZoom();
      return;
    }
    // 裝備頁開著：↑↓ 照畫面上的順序換選取（第三十七版，取代數字鍵），Enter 執行一般操作，Delete 丟棄並要求確認
    if (FE.UI.win() === 'backpack' && (k === 'arrowup' || k === 'arrowdown')) {
      e.preventDefault();
      FE.UI.bagMove(k === 'arrowup' ? -1 : 1);
      return;
    }
    if (FE.UI.win() === 'backpack' && k === 'enter') {
      e.preventDefault();
      bagAction(FE.UI.bagDropConfirm() ? 'confirmDrop' : 'use');
      return;
    }
    if (FE.UI.win() === 'backpack' && k === 'delete') {
      e.preventDefault();
      bagAction('drop');
      return;
    }
    // 角色視窗開著：← → 換看隊伍裡的另一位（第三十六版之三，不換操作）
    if (FE.UI.win() === 'character' && (k === 'arrowleft' || k === 'arrowright')) {
      e.preventDefault();
      FE.UI.charStep(k === 'arrowleft' ? -1 : 1);
      return;
    }
    // 視窗開著時，方向鍵與戰鬥鍵都不作用
    if (FE.UI.win()) return;
    // 數字鍵盤走八方向（看 e.code，放在戰鬥鍵之前，不然 NumLock 開著時 1、3 會被當成攻擊、逃跑）
    if (NUMPAD[e.code]) {
      e.preventDefault();
      step(NUMPAD[e.code]);
      return;
    }
    if (ACTS[k]) {
      e.preventDefault();
      // F 只是進入瞄準，不算動作、不存檔
      if (ACTS[k] === 'fire' && game.spellsOf().length) {
        FE.UI.openSpells();
        return;
      }
      if (ACTS[k] === 'fire' || ACTS[k] === 'throw') {
        game.act(ACTS[k]);
        FE.UI.update();
        return;
      }
      dispatch('戰鬥：' + ACTS[k], () => game.act(ACTS[k]));
    } else if (DIRS[k]) {
      e.preventDefault();
      dirKey(e, k);
    } else if (k === 'r') {
      e.preventDefault();
      if (!FE.UI.askRest()) dispatch('休息', () => game.rest());
    }
  });

  // 建角與升級加點的視窗（蓋在所有東西上面，開著的時候別的按鈕都點不到）；建角畫面滑鼠移到哪行，游標跟到哪行
  document.getElementById('modal').addEventListener('mouseover', (e) => {
    if (!ready) FE.UI.startHover(e.target);
  });
  document.getElementById('modal').addEventListener('click', (e) => {
    if (!ready) {
      FE.UI.startClick(e.target);
      return;
    }
    const b = e.target.closest && e.target.closest('[data-attr]');
    if (b && !b.disabled) dispatch('升級加點', () => game.spendPoint(b.dataset.attr));
  });

  document.getElementById('dialog').addEventListener('click', (e) => {
    const close = e.target.closest && e.target.closest('[data-shop-close]');
    if (close) {
      FE.UI.closeShop();
      return;
    }
    const tab = e.target.closest && e.target.closest('[data-shop-tab]');
    if (tab) {
      FE.UI.shopTab(tab.dataset.shopTab);
      return;
    }
    const cancel = e.target.closest && e.target.closest('[data-shop-cancel]');
    if (cancel) {
      FE.UI.cancelShopItem();
      return;
    }
    const confirm = e.target.closest && e.target.closest('[data-shop-confirm]');
    if (confirm && !confirm.disabled) {
      const i = FE.UI.shopConfirmIndex();
      if (i >= 0) choose(i);
      return;
    }
    const item = e.target.closest && e.target.closest('[data-shop-item]');
    if (item) {
      FE.UI.selectShopItem(Number(item.dataset.shopItem));
      return;
    }
    const b = e.target.closest && e.target.closest('[data-opt]');
    if (b && !b.disabled) choose(Number(b.dataset.opt));
  });

  // 底部快捷列：攻擊、重擊、撤退、射擊／施法、治療、盾擊。瞄準中再點射擊就是出手
  document.getElementById('quick').addEventListener('click', (e) => {
    // 右下角的視窗按鈕：背包、角色、地圖
    const wb = e.target.closest && e.target.closest('[data-win]');
    if (wb) {
      if (ready && game.talking == null && game.hero.points <= 0) toggleWindow(wb.dataset.win);
      return;
    }
    const b = e.target.closest && e.target.closest('[data-act]');
    const act = b && b.dataset.act;
    if (!act || b.disabled || !ready || game.talking != null || FE.UI.win()) return;
    cancelRoute(); // 從快捷列出手也算不走路了
    if (act === 'fire' && !game.aim && game.spellsOf().length) {
      FE.UI.openSpells();
      return;
    }
    if (act === 'fire' || act === 'throw') {
      if (game.aim) dispatch('戰鬥：遠程', () => game.aimFire());
      else {
        game.act(act);
        FE.UI.update();
      }
      return;
    }
    game.aimCancel();
    dispatch('戰鬥：' + act, () => game.act(act));
  });

  // 地圖上的滑鼠（第三十一版）：右鍵查看那一格；左鍵點怪物把牠設成目標（不出手、不算動作，同撞上去）
  document.getElementById('map').addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (!ready || game.talking != null || game.hero.points > 0) return;
    const c = FE.UI.cellAt(e.clientX, e.clientY);
    cancelRoute();
    if (c) FE.UI.look(c.x, c.y);
  });
  document.getElementById('map').addEventListener('click', (e) => {
    if (!ready || game.talking != null || FE.UI.win() || game.hero.points > 0) return;
    const c = FE.UI.cellAt(e.clientX, e.clientY);
    if (!c) return;
    const m = game.monsterAt(c.x, c.y);
    const n = game.world.npcAt(c.x, c.y) || game.soldierAt(c.x, c.y);
    // 瞄準中（按了 F 或選了要瞄準的招）：點射程內的怪物就對牠出手，點別的地方取消瞄準
    if (game.aim) {
      cancelRoute();
      const i = m ? game.aim.ids.indexOf(m.id) : -1;
      if (i >= 0) {
        game.aim.i = i;
        dispatch('戰鬥：遠程', () => game.aimFire());
      } else {
        game.aimCancel();
        FE.UI.update();
      }
      return;
    }
    if (walk) stopWalk();
    const same = !!(route && route.tx === c.x && route.ty === c.y);
    const o = !m && !n ? game.objAt(c.x, c.y) : null;
    if (m) {
      // 點怪物只是設成目標（不出手、不算動作），順手把路線收掉
      cancelRoute();
      game.battle.targetId = m.id;
      game.battle.obj = null;
      FE.UI.update();
    } else if (o && !same) {
      // V37.1 試玩後：點寶箱、上鎖的門、採集點：設成目標，同時畫出走到它旁邊的路線（再點一次出發），到了按 1 開鎖或採集
      game.setObjTarget(o);
      if (game.objTargetNear()) cancelRoute();
      else showRoute(c.x, c.y, null, o.kind !== 'node');
      FE.UI.update();
    } else if (n) {
      // 村民、工匠、士兵：第一段畫路線，點同一個人第二段才走過去開對話
      if (same) startRoute();
      else showRoute(n.x, n.y, n);
    } else if (c.x !== game.player.x || c.y !== game.player.y) {
      if (same) startRoute();
      else showRoute(c.x, c.y, null);
    } else cancelRoute(); // 點自己腳下：收掉路線
  });
  // 查看視窗裡的按鈕：對話（走過去）、設成目標
  document.getElementById('win-look').addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-look]');
    if (!b) return;
    const [kind, x, y] = b.dataset.look.split(',');
    FE.UI.closeWindow();
    if (kind === 'talk') {
      const n = game.world.npcAt(+x, +y) || game.soldierAt(+x, +y);
      if (n) walkTo(n.x, n.y, n);
    } else if (kind === 'target') {
      const m = game.monsterAt(+x, +y);
      if (m) {
        game.battle.targetId = m.id;
        game.battle.obj = null;
      }
      FE.UI.update();
    } else if (kind === 'obj') {
      game.setObjTarget(game.objAt(+x, +y)); // V37.1 試玩後：寶箱、上鎖的門、採集點
      FE.UI.update();
    }
  });

  document.getElementById('dpad').addEventListener('click', (e) => {
    const dir = e.target.dataset && e.target.dataset.dir;
    if (!dir || game.talking != null || FE.UI.win()) return;
    if (dir === 'rest') {
      if (!FE.UI.askRest()) dispatch('休息', () => game.rest());
    }
    else dispatch('移動', () => game.move(DIRS[dir][0], DIRS[dir][1], { noTalk: true }));
  });

  // 視窗：右上角的圖示列開關各視窗；設定裡也有各視窗的按鈕；點視窗外面或「Esc 關閉」關掉
  document.getElementById('iconbar').addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-win]');
    if (b && ready && game.talking == null && game.hero.points <= 0) toggleWindow(b.dataset.win);
  });
  document.getElementById('overlay').addEventListener('click', (e) => {
    // 第三十七版：大視窗的頁籤、聚落頁左邊的聚落清單
    const tab = e.target.closest && e.target.closest('[data-tab]');
    if (tab) {
      FE.UI.openWindow(tab.dataset.tab);
      return;
    }
    const st = e.target.closest && e.target.closest('[data-steading]');
    if (st) {
      FE.UI.pickSteading(Number(st.dataset.steading));
      return;
    }
    // 裝備頁：分類篩選、收合分類
    const filter = e.target.closest && e.target.closest('[data-bag-filter]');
    if (filter) {
      FE.UI.bagFilter(filter.dataset.bagFilter);
      return;
    }
    const group = e.target.closest && e.target.closest('[data-bag-group]');
    if (group) {
      FE.UI.toggleBagGroup(group.dataset.bagGroup);
      return;
    }
    const select = e.target.closest && e.target.closest('[data-bag-select]');
    const action = e.target.closest && e.target.closest('[data-bag-action]');
    const unequip = e.target.closest && e.target.closest('[data-unequip]');
    if (unequip && !unequip.disabled) {
      dispatch('卸下裝備', () => game.unequip(unequip.dataset.unequip));
      return;
    }
    if (select) FE.UI.selectBagItem(Number(select.dataset.bagSelect));
    else if (action && !action.disabled) bagAction(action.dataset.bagAction);
    else if (e.target.id === 'overlay' || (e.target.dataset && 'close' in e.target.dataset)) FE.UI.closeWindow();
    else if (e.target.dataset && e.target.dataset.open) FE.UI.openWindow(e.target.dataset.open);
  });

  // 裝備頁（第三十七版）：點兩下物品＝一般操作（使用、穿上或拿起）；右鍵＝選取並在左邊看可用的操作
  document.getElementById('overlay').addEventListener('dblclick', (e) => {
    const row = e.target.closest && e.target.closest('[data-bag-select]');
    if (!row || !ready) return;
    FE.UI.selectBagItem(Number(row.dataset.bagSelect));
    bagAction('use');
  });
  document.getElementById('overlay').addEventListener('contextmenu', (e) => {
    const row = e.target.closest && e.target.closest('[data-bag-select]');
    if (!row || !ready) return;
    e.preventDefault();
    FE.UI.selectBagItem(Number(row.dataset.bagSelect));
  });

  document.getElementById('playerName').addEventListener('change', (e) => {
    const name = e.target.value.trim() || '冒險者';
    game.hero.name = name;
    FE.store.save('fe.name', name);
    FE.Save.save(game);
    FE.UI.update();
  });

  // 畫面縮放：地圖滿版，縮放改的是每格的像素大小（格數跟著變）。記在這台瀏覽器（不進存檔）
  const SIZES = FE.CONFIG.CELL_SIZES;
  let zoom = FE.store.load('fe.cell', FE.CONFIG.CELL_DEFAULT);
  function applyZoom() {
    zoom = Math.max(0, Math.min(SIZES.length - 1, Math.round(Number(zoom)) || 0));
    FE.CONFIG.CELL_PX = SIZES[zoom];
    FE.store.save('fe.cell', zoom);
    document.getElementById('zoomText').textContent = `每格 ${SIZES[zoom]} 像素`;
    FE.UI.relayout();
    FE.UI.update();
  }
  document.getElementById('win-settings').addEventListener('click', (e) => {
    const d = e.target.dataset && Number(e.target.dataset.zoom);
    if (d) {
      zoom += d; // ＋ 是放大（每格變大、格數變少），－ 是縮小（格數變多）
      applyZoom();
    }
  });

  const veilBox = document.getElementById('veil');
  veilBox.checked = veil;
  veilBox.addEventListener('change', () => {
    veil = veilBox.checked;
    FE.store.save('fe.veil', veil);
    game.setVeil(veil);
    if (!ready) return; // 還在建角：開局時就照這個設定
    game.say(veil ? '怪物遮蔽打開了：怪物都看不見，也不會再出現。' : '怪物遮蔽關掉了，怪物回到了世界上。', 'sys');
    FE.Save.save(game);
    FE.UI.update();
  });

  // 網址保留 ?nomonsters（開新世界時也照樣遮蔽）
  const freshSeed = () => '?seed=' + Math.floor(Math.random() * 1e9) + (params.has('nomonsters') ? '&nomonsters' : '');

  document.getElementById('newWorld').addEventListener('click', () => {
    location.search = freshSeed();
  });

  document.getElementById('clearSave').addEventListener('click', () => {
    FE.Save.clearAll();
    location.search = freshSeed();
  });

  // 匯出試玩紀錄：下載成 JSON 檔（檔名帶台北時間），附上世界種子與版本
  document.getElementById('exportPlaylog').addEventListener('click', () => {
    const stamp = FE.nowTaipei().replace(/[\/: ]/g, '-');
    const data = { version: FE.CONFIG.SAVE_VERSION, seed: game.seed, exported: FE.nowTaipei(), actions: playlog };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
    a.download = `fe-playlog-${stamp}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  function launch() {
    ready = true;
    FE.game = game;
    FE.Save.save(game);
    FE.UI.init(game);
    applyZoom();
  }
  if (resume) launch();
  else {
    FE.UI.startMenu((cls, picks, body, skills) => {
      game.start({ cls, picks, body, skills });
      if (saved && saved.stale) game.say('遊戲版本更新，舊存檔、歷史紀錄與錯誤報告已清除，從新世界開始。', 'sys');
      launch();
    });
  }
})();
