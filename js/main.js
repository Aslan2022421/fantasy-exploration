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

  // 有存檔、而且網址沒指定別的世界，就接著上次玩
  const saved = FE.Save.load();
  let game;
  if (saved && saved.game && (!Number.isFinite(urlSeed) || urlSeed === saved.game.seed)) {
    game = saved.game;
    game.say('讀取存檔，接著上次的進度。', 'sys');
  } else {
    game = new FE.Game(Number.isFinite(urlSeed) ? urlSeed : Math.floor(Math.random() * 1e9));
    game.start();
    if (saved && saved.stale) game.say('遊戲版本更新，舊存檔、歷史紀錄與錯誤報告已清除，從新世界開始。', 'sys');
  }
  FE.game = game;
  FE.Save.save(game);

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
      wpn: p.equip.main ? FE.Gear.name(p.equip.main) : '徒手', atk: game.playerAtk(), body: p.equip.body ? FE.Gear.name(p.equip.body) : '', g: p.gold, ws: game.worldState, ch: game.world.chunks.length, mon: game.monsters.length,
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

  const DIRS = {
    arrowup: [0, -1], arrowdown: [0, 1], arrowleft: [-1, 0], arrowright: [1, 0],
    w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0],
  };
  const ACTS = { 1: 'attack', 2: 'deep', 3: 'flee' };
  // 按鍵視窗：同時只開一個
  const WINDOW_KEYS = { l: 'legend', h: 'history', j: 'messages', i: 'steading', b: 'backpack', '`': 'reports' };

  // 在對話視窗裡選第 i 個選項（選項本身不再花動作）
  function choose(i) {
    const npc = game.talking != null ? game.talkTarget(game.talking) : null;
    if (!npc) {
      game.closeTalk();
      FE.UI.update();
      return;
    }
    dispatch('對話', () => game.choose(npc, i));
  }

  // 背包裡選第 i 樣：平常是用（吃藥草、穿上或拿起裝備），切到「丟掉」就是丟掉
  function useBag(i) {
    if (FE.UI.bagDrop()) dispatch('背包：丟掉', () => game.dropItem(i));
    else dispatch('背包', () => game.useItem(i));
  }

  function toggleWindow(name) {
    if (FE.UI.win() === name) FE.UI.closeWindow();
    else FE.UI.openWindow(name);
  }

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.code === 'Backquote' ? '`' : e.key.toLowerCase();
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
    // 對話視窗開著：數字鍵只選選項，Esc 回上一層（工匠的對話）或關掉，方向鍵不移動，也不會出手攻擊
    if (game.talking != null) {
      if (k === 'escape') {
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
    if (k === 'escape') {
      e.preventDefault();
      if (FE.UI.win()) FE.UI.closeWindow();
      else FE.UI.openWindow('settings');
      return;
    }
    if (WINDOW_KEYS[k]) {
      e.preventDefault();
      toggleWindow(WINDOW_KEYS[k]);
      return;
    }
    if (k === 'm') {
      e.preventDefault();
      FE.UI.toggleMinimap();
      return;
    }
    if (k === '-' || k === '_' || k === '=' || k === '+') {
      e.preventDefault();
      zoom += k === '-' || k === '_' ? -1 : 1;
      applyZoom();
      return;
    }
    // 背包視窗開著：數字鍵選第幾樣東西（吃藥草、穿上或拿起裝備算一個動作；丟掉不算），X 切換「丟掉」
    if (FE.UI.win() === 'backpack' && k === 'x') {
      e.preventDefault();
      FE.UI.toggleBagDrop();
      return;
    }
    if (FE.UI.win() === 'backpack' && /^[1-9]$/.test(k)) {
      e.preventDefault();
      useBag(Number(k) - 1);
      return;
    }
    // 視窗開著時，方向鍵與戰鬥鍵都不作用
    if (FE.UI.win()) return;
    if (ACTS[k]) {
      e.preventDefault();
      dispatch('戰鬥：' + ACTS[k], () => game.act(ACTS[k]));
    } else if (DIRS[k]) {
      e.preventDefault();
      dispatch('移動', () => game.move(DIRS[k][0], DIRS[k][1]));
    } else if (k === 'r') {
      e.preventDefault();
      dispatch('休息', () => game.rest());
    }
  });

  document.getElementById('dialog').addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-opt]');
    if (b && !b.disabled) choose(Number(b.dataset.opt));
  });

  document.getElementById('target').addEventListener('click', (e) => {
    const act = e.target.dataset && e.target.dataset.act;
    if (act && game.talking == null && !FE.UI.win()) dispatch('戰鬥：' + act, () => game.act(act));
  });

  document.getElementById('dpad').addEventListener('click', (e) => {
    const dir = e.target.dataset && e.target.dataset.dir;
    if (!dir || game.talking != null || FE.UI.win()) return;
    if (dir === 'rest') dispatch('休息', () => game.rest());
    else dispatch('移動', () => game.move(DIRS[dir][0], DIRS[dir][1]));
  });

  // 視窗：右上角的 ☰ 開設定；設定裡有各視窗的按鈕；點視窗外面或「Esc 關閉」關掉
  document.getElementById('btnMenu').addEventListener('click', () => toggleWindow('settings'));
  document.getElementById('btnMini').addEventListener('click', () => FE.UI.toggleMinimap());
  document.getElementById('overlay').addEventListener('click', (e) => {
    const use = e.target.closest && e.target.closest('[data-use]');
    if (e.target.closest && e.target.closest('[data-dropmode]')) FE.UI.toggleBagDrop();
    else if (use && !use.disabled) useBag(Number(use.dataset.use));
    else if (e.target.id === 'overlay' || (e.target.dataset && 'close' in e.target.dataset)) FE.UI.closeWindow();
    else if (e.target.dataset && e.target.dataset.open) FE.UI.openWindow(e.target.dataset.open);
  });

  document.getElementById('playerName').addEventListener('change', (e) => {
    const name = e.target.value.trim() || '冒險者';
    game.player.name = name;
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

  const freshSeed = () => '?seed=' + Math.floor(Math.random() * 1e9);

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

  FE.UI.init(game);
  applyZoom();
})();
