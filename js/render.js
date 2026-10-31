// 畫面層：只讀遊戲狀態、畫成 ASCII。地圖畫在 Canvas（滿版），其他是狀態列、下方列、對話視窗與按鍵視窗。
// 之後要換成圖塊，只改這一檔。
(function () {
  const C = FE.CONFIG;
  const $ = (id) => document.getElementById(id);
  const key = (x, y) => x + ',' + y;
  const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
  const flicker = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));
  let game = null;

  // 畫面狀態（不進存檔）：開著哪個視窗、小地圖收起或打開（記在這台瀏覽器）、地圖的版面
  const ui = { win: null, bagDrop: false, mini: FE.store.load('fe.minimap', true), cell: 22, cols: 21, rows: 21, ox: 0, oy: 0, w: 0, h: 0, dpr: 1 };

  // ---- 版面：地圖填滿狀態列與下方列之間的空間 ----
  // 格數＝可用空間 ÷ 每格像素，寬高各取奇數（冒險者才在正中央）；短邊至少 VIEW_MIN 格，不夠就把格子縮小
  function layout() {
    const wrap = $('mapwrap');
    const cv = $('map');
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    if (w <= 0 || h <= 0) return;
    const odd = (n) => Math.max(1, n % 2 ? n : n - 1);
    let cell = Math.min(C.CELL_PX, Math.min(w, h) / C.VIEW_MIN);
    const cols = odd(Math.floor(w / cell + 1e-6));
    const rows = odd(Math.floor(h / cell + 1e-6));
    cell = Math.min(w / cols, h / rows); // 取好格數後讓格子盡量填滿，仍是正方形
    const dpr = window.devicePixelRatio || 1;
    cv.style.width = w + 'px';
    cv.style.height = h + 'px';
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    Object.assign(ui, { cell, cols, rows, w, h, dpr, ox: (w - cols * cell) / 2, oy: (h - rows * cell) / 2 });
    C.VIEW_W = cols;
    C.VIEW_H = rows;
  }

  // 攝影機跟隨：冒險者平常在畫面正中央，地形跟著移動；走近世界邊緣時鏡頭停住，
  // 換成冒險者往畫面邊緣走，畫面上不會露出世界以外的空白
  function camera() {
    const W = game.world;
    const p = game.player;
    const VW = C.VIEW_W;
    const VH = C.VIEW_H;
    // 世界不一定是方的：鏡頭停在所有區塊的外框邊上，外框裡還沒創出來的空缺畫成空白
    const b = W.bounds();
    const axis = (pos, view, lo, hi) => {
      // 畫面比世界還寬（大螢幕）時，把世界放在畫面中間
      if (hi - lo < view) return lo - Math.floor((view - (hi - lo)) / 2);
      return clamp(pos - Math.floor(view / 2), lo, hi - view);
    };
    return { x: axis(p.x, VW, b.x0, b.x1), y: axis(p.y, VH, b.y0, b.y1) };
  }

  // 外牆照矮人要塞蓋出來的牆畫：看上下左右哪邊也是牆，自動接成轉角（石牆雙線、木牆單線）
  const WALL_GLYPHS = {
    W: ['■', '║', '═', '╚', '║', '║', '╔', '╠', '═', '╝', '═', '╩', '╗', '╣', '╦', '╬'],
    w: ['■', '│', '─', '└', '│', '│', '┌', '├', '─', '┘', '─', '┴', '┐', '┤', '┬', '┼'],
  };
  function wallGlyph(W, x, y, t) {
    const same = (dx, dy) => {
      const c = W.cell(x + dx, y + dy);
      return c && c.t === t;
    };
    const bits = (same(0, -1) ? 1 : 0) | (same(1, 0) ? 2 : 0) | (same(0, 1) ? 4 : 0) | (same(-1, 0) ? 8 : 0);
    return WALL_GLYPHS[t][bits];
  }

  // 地形字元的顏色（FE.TERRAIN 的 cls → 文字顏色與粗體）、底色（越亮越高）、各種特殊底色
  const TERRAIN_FG = {
    't-plain': ['#6e7681'], 't-grass': ['#3fb950'], 't-forest': ['#2ea043', true], 't-snow': ['#f0f6fc'], 't-sand': ['#d29922'],
    't-mount': ['#adbac7', true], 't-water': ['#388bfd'], 't-rock': ['#5a6270'], 't-stonewall': ['#c9ced6', true], 't-woodwall': ['#b5865a', true],
    't-house': ['#d6a46b', true], 't-road': ['#8b7a5e'], 't-market': ['#e3b341', true], 't-temple': ['#d2a8ff', true], 't-door': ['#f0c674', true],
    't-bed': ['#a5b4fc'], 't-furniture': ['#c9a26b'], 't-ruin': ['#9a8f7c'], 't-relic': ['#e3c07a', true],
  };
  const NODE_FG = { ore: '#56d4dd', herb: '#c3e88d' }; // 礦脈青色、藥草淺綠
  const HEIGHT_BG = ['#070a0e', '#0e131a', '#151c26', '#1e2733', '#283442'];
  const BG = { village: '#1c2333', town: '#2a2140', indoor: '#2a2218', road: '#3a3122', glitch: '#2d1214', hasQuest: '#4a1d3a', recipient: '#1a4d2a' };

  function drawMap() {
    const cv = $('map');
    if (!ui.w) return;
    const ctx = cv.getContext('2d');
    const W = game.world;
    const p = game.player;
    const { cell, cols, rows, ox, oy } = ui;
    ctx.setTransform(ui.dpr, 0, 0, ui.dpr, 0, 0);
    ctx.fillStyle = '#010409';
    ctx.fillRect(0, 0, ui.w, ui.h);
    const { x: camX, y: camY } = camera();

    // 先把實體和 BUG 的效果整理成查表，畫每一格時直接查
    const npcs = new Map(W.npcs.map((n) => [key(n.x, n.y), n]));
    const soldiers = new Map(game.soldiers.map((s) => [key(s.x, s.y), s]));
    const chests = new Map(W.chests.map((c) => [key(c.x, c.y), c]));
    // 採集點：採完還沒長回來的不畫（那一格就是普通地面）
    const nodes = new Map(W.nodes.filter((n) => !(n.regrowAt > (game.ticks || 0))).map((n) => [key(n.x, n.y), n]));
    const monsters = new Map(game.monsters.map((m) => [key(m.x, m.y), m]));
    const overlay = new Map();
    for (const m of game.monsters) {
      if (m.type === 'TERRAIN') {
        for (const [x, y] of m.cells) overlay.set(key(x, y), { glyph: flicker(['*', ':']), cls: 'glitch' });
      } else if (m.type === 'CLIFF') {
        for (const [x, y] of m.cells) overlay.set(key(x, y), { glyph: flicker(['▲', '▼']), cls: 'glitch' });
      } else if (m.type === 'UNREACHABLE') {
        for (const [x, y] of m.cells) overlay.set(key(x, y), { cls: 'faded' });
        for (const [x, y] of m.data.path) overlay.set(key(x, y), { cls: 'glitch' });
      }
    }
    const target = game.targetMonster();
    // 清除委託指定的小怪物（合體後就標合體怪物）
    const hunted = new Set();
    const hc = p.carrying && p.carrying.kind === 'hunt' ? p.carrying.monsterIds : [];
    for (const m of game.monsters) {
      if (hc.includes(m.id) || (m.members && m.members.some((o) => hc.includes(o.id)))) hunted.add(m);
    }

    const fontSize = Math.max(8, Math.round(cell * 0.72));
    const fontOf = (bold) => `${bold ? 'bold ' : ''}${fontSize}px Consolas, "Courier New", monospace`;
    let curFont = '';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const barH = Math.max(2, Math.round(cell * 0.12));

    for (let gy = 0; gy < rows; gy++) {
      for (let gx = 0; gx < cols; gx++) {
        const x = camX + gx;
        const y = camY + gy;
        if (!W.inBounds(x, y)) continue; // 世界以外或還沒創出來的空缺：空白
        const k = key(x, y);
        const c = W.cell(x, y);
        // 格子的像素範圍：邊緣取整，相鄰的格子才不會露縫
        const px0 = Math.round(ox + gx * cell);
        const py0 = Math.round(oy + gy * cell);
        const pw = Math.round(ox + (gx + 1) * cell) - px0;
        const ph = Math.round(oy + (gy + 1) * cell) - py0;

        let glyph = WALL_GLYPHS[c.t] ? wallGlyph(W, x, y, c.t) : c.t;
        const tfg = TERRAIN_FG[FE.TERRAIN[c.t].cls] || ['#6e7681'];
        let fg = tfg[0];
        let bold = !!tfg[1];
        // 底色越亮越高；聚落、室內、路各有底色
        const vv = W.villageAt(x, y);
        const indoor = vv && FE.Steading.roomAt(vv, x, y) >= 0;
        let bg = c.t === '·' ? BG.road : indoor ? BG.indoor : vv ? (vv.kind === 'town' ? BG.town : BG.village) : HEIGHT_BG[c.h] || HEIGHT_BG[0];
        const baseBg = bg;
        let alpha = 1;
        const o = overlay.get(k);
        if (o) {
          if (o.glyph) glyph = o.glyph;
          if (o.cls === 'glitch') {
            fg = '#ff7b72';
            bg = BG.glitch;
          } else if (o.cls === 'faded') alpha = 0.35;
        }
        let outline = null;
        let hpPct = -1;
        const nd = nodes.get(k);
        if (nd && FE.TERRAIN[c.t].pass) {
          glyph = FE.NODES[nd.kind].glyph;
          fg = NODE_FG[nd.kind];
          bold = true;
        }
        if (chests.has(k)) {
          glyph = '$';
          fg = '#e3b341';
          bold = true;
          bg = baseBg;
          alpha = 1;
        }
        const n = npcs.get(k);
        if (n) {
          glyph = '&';
          bold = true;
          bg = baseBg;
          alpha = 1;
          if (n.role === 'smith') fg = '#79c0ff';
          else if (n.role === 'armorer') fg = '#ffa657';
          else {
            const cr = p.carrying;
            const carrying =
              cr && (cr.kind === 'hunt' ? cr.giverId === n.id && game.huntRemaining(cr.monsterIds) === 0 : cr.targetId === n.id);
            fg = '#f778ba';
            if (carrying) bg = BG.recipient;
            else if (n.quest && !n.quest.accepted && !n.quest.done) bg = BG.hasQuest;
          }
        }
        // 士兵：鋼灰色的 &，格子底下有血條
        const sol = soldiers.get(k);
        if (sol) {
          glyph = '&';
          fg = '#b8c0cc';
          bold = true;
          bg = baseBg;
          alpha = 1;
          hpPct = Math.round((sol.hp / sol.maxHp) * 100);
        }
        const m = monsters.get(k);
        if (m) {
          // 平常顯示種族的字母，異常發作時閃出異常的字元（數字、亂碼、問號⋯⋯）
          const race = FE.RACES[m.race] || FE.RACES.goblin;
          glyph = Math.random() < 0.6 ? race.glyph : flicker(FE.BUG_TYPES[m.type].glyphs);
          bold = true;
          alpha = 1;
          if (m.boss) { fg = '#fff'; bg = '#5a0b0e'; }
          else if (m.tier === 'mid') { fg = '#fff'; bg = '#8e1519'; }
          else { fg = '#0d1117'; bg = '#ff7b72'; }
          // 外框：目前的目標（白）＞清除委託指定（紫）＞正在追你（黃）
          outline = m === target ? '#fff' : hunted.has(m) ? '#d2a8ff' : m.chase > 0 ? '#e3b341' : null;
          hpPct = Math.round((m.hp / m.maxHp) * 100);
        }
        if (p.x === x && p.y === y) {
          glyph = '@';
          fg = '#fff';
          bg = '#1f6feb';
          bold = true;
          alpha = 1;
          outline = null;
          hpPct = -1;
        }

        ctx.globalAlpha = alpha;
        ctx.fillStyle = bg;
        ctx.fillRect(px0, py0, pw, ph);
        if (glyph !== ' ') {
          const f = fontOf(bold);
          if (f !== curFont) {
            ctx.font = f;
            curFont = f;
          }
          ctx.fillStyle = fg;
          ctx.fillText(glyph, px0 + pw / 2, py0 + ph / 2 + 1);
        }
        if (outline) {
          ctx.strokeStyle = outline;
          ctx.lineWidth = 2;
          ctx.strokeRect(px0 + 1, py0 + 1, pw - 2, ph - 2);
        }
        // 血條：格子底下一條細線，綠、黃、紅跟著剩下的血量變
        if (hpPct >= 0) {
          ctx.fillStyle = hpPct > 60 ? '#3fb950' : hpPct > 30 ? '#e3b341' : '#f85149';
          ctx.fillRect(px0 + pw * 0.1, py0 + ph - 1 - barH, (pw * 0.8 * hpPct) / 100, barH);
        }
        ctx.globalAlpha = 1;
      }
    }
  }

  // 小地圖（疊在地圖右上角）：冒險者附近 MINIMAP_W×MINIMAP_H 格，一格畫成 S×S 像素；白框是主畫面看得到的範圍
  // 按生態區上色，巨石另外畫深色
  const MINI_COLORS = {
    plain: '#5b6470', grassland: '#4f9a4f', shrubland: '#7f8f45', forest: '#2d7a35', taiga: '#2f7a62', tundra: '#93b3c0',
    glacier: '#e8f1f8', jungle: '#1f8a34', savanna: '#b8973f', desert: '#d6a537', marsh: '#3c9690', swamp: '#3f6e55',
    mountain: '#8b8f99', lake: '#2f6fd6',
  };
  function shade(hex, h) {
    const n = parseInt(hex.slice(1), 16);
    const f = 0.75 + h * 0.08; // 越高越亮
    const ch = (s) => Math.min(255, Math.round(((n >> s) & 255) * f));
    return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
  }

  function drawMinimap() {
    const cv = $('minimap');
    cv.classList.toggle('hidden', !ui.mini);
    if (!ui.mini) return;
    const W = game.world;
    const p = game.player;
    const S = window.innerWidth < 520 ? 1 : 2;
    const MW = C.MINIMAP_W;
    const MH = C.MINIMAP_H;
    const b = W.bounds();
    const x0 = clamp(p.x - Math.floor(MW / 2), b.x0, Math.max(b.x0, b.x1 - MW));
    const y0 = clamp(p.y - Math.floor(MH / 2), b.y0, Math.max(b.y0, b.y1 - MH));
    if (cv.width !== MW * S) {
      cv.width = MW * S;
      cv.height = MH * S;
    }
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#010409'; // 還沒創出來的地方
    ctx.fillRect(0, 0, cv.width, cv.height);
    for (let y = y0; y < y0 + MH; y++) {
      for (let x = x0; x < x0 + MW; x++) {
        const c = W.cell(x, y);
        if (!c) continue;
        const base = c.t === '#' ? '#262b33' : MINI_COLORS[c.biome] || '#444444';
        const vv = W.villageAt(x, y);
        // 地貌上的人造物（斷牆、立石、塔⋯⋯）畫成土黃色
        const relic = /[▓░ΠΘ†Ω‡+¤]/.test(c.t);
        const building = /[⌂∩♦]/.test(c.t);
        const wall = c.t === 'W' || c.t === 'w';
        ctx.fillStyle = wall ? (c.t === 'W' ? '#c9ced6' : '#a0784a') : building ? '#d6a46b' : vv ? (vv.kind === 'town' ? '#8a5fb0' : '#3b4a6b') : relic ? '#b8956a' : shade(base, c.h);
        ctx.fillRect((x - x0) * S, (y - y0) * S, S, S);
      }
    }
    const dot = (x, y, color, size) => {
      if (x < x0 || x >= x0 + MW || y < y0 || y >= y0 + MH) return;
      const s = size || S;
      ctx.fillStyle = color;
      ctx.fillRect((x - x0) * S - (s - S) / 2, (y - y0) * S - (s - S) / 2, s, s);
    };
    const big = S === 1 ? 3 : 5;
    const c = p.carrying;
    for (const ch of W.chests) dot(ch.x, ch.y, '#e3b341');
    for (const n of W.npcs) {
      const target = c && (c.kind === 'hunt' ? c.giverId === n.id && game.huntRemaining(c.monsterIds) === 0 : c.targetId === n.id);
      dot(n.x, n.y, target ? '#3fb950' : n.role === 'smith' ? '#79c0ff' : n.role === 'armorer' ? '#ffa657' : '#f778ba', target ? big : S);
    }
    // 地形重算的地方：亮紫色的點，100 刻後消失
    for (const s of game.soldiers) dot(s.x, s.y, '#b8c0cc');
    for (const f of game.flashes || []) if (f.until > (game.ticks || 0)) dot(f.x, f.y, '#e879f9', big);
    for (const m of game.monsters) dot(m.x, m.y, m.tier !== 'small' ? '#ff4040' : '#ff7b72', m.tier !== 'small' ? big : S);
    dot(p.x, p.y, '#ffffff', big);
    const cam = camera();
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.strokeRect((cam.x - x0) * S + 0.5, (cam.y - y0) * S + 0.5, C.VIEW_W * S - 1, C.VIEW_H * S - 1);
    // 下一塊會長在哪：離冒險者最近的邊界，用虛線框標出來
    const slot = W.nearestFrontier(p.x, p.y);
    if (slot) {
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = 'rgba(210,168,255,0.8)';
      ctx.strokeRect((slot.cx * C.CHUNK_W - x0) * S + 0.5, (slot.cy * C.CHUNK_H - y0) * S + 0.5, C.CHUNK_W * S - 1, C.CHUNK_H * S - 1);
      ctx.setLineDash([]);
    }
  }

  // ---- 上方狀態列 ----

  // 環境：生態區名稱、高度、在這裡出手的擲骰加減
  function envText(c) {
    const b = FE.BIOMES[c.biome];
    const hit = b.hit ? `，出手 ${b.hit > 0 ? '+' : ''}${b.hit}` : '';
    return `${b.name}，高度 ${c.h}${hit}`;
  }

  function setBar(id, value, max) {
    $(id).style.width = Math.max(0, Math.min(100, (value / max) * 100)) + '%';
  }

  // 還沒看過的錯誤報告有幾份（開過錯誤報告視窗就算看過）
  const reportId = (r) => r.time + '|' + r.turn + '|' + r.message;
  function unseenReports() {
    const seen = FE.store.load('fe.reportSeen', null);
    const i = game.reports.findIndex((r) => reportId(r) === seen);
    return i < 0 ? game.reports.length : i;
  }

  function drawStatus() {
    const p = game.player;
    const W = game.world;
    $('stName').textContent = p.name;
    $('hpText').textContent = `${p.hp} / ${p.maxHp}`;
    setBar('hpFill', p.hp, p.maxHp);
    // 經驗值條只顯示這一級的進度；創世門檻由創世神決定，不顯示
    const lo = FE.levelExp(game.level);
    const hi = FE.levelExp(game.level + 1);
    $('lvText').textContent = game.level;
    $('cpText').textContent = `${game.exp - lo} / ${hi - lo}`;
    setBar('cpFill', game.exp - lo, hi - lo);
    // 主手武器的名字（含品質符號）與攻擊力；超重時標出負重
    const main = p.equip.main;
    $('stWeapon').textContent =
      `武器 ${main ? FE.Gear.name(main) : '徒手'}（攻擊力 ${game.playerAtk()}）` + (game.loadTier() ? `　超重 ${game.weight()} / ${C.CARRY_LIMIT}` : '');
    $('stGold').textContent = `金幣 ${p.gold}`;
    const n = unseenReports();
    $('reportBadge').classList.toggle('hidden', n === 0);
    $('reportBadge').textContent = `⚠${n}`;

    const v = W.villageAt(p.x, p.y);
    const lm = W.landmarkAt(p.x, p.y);
    const lvl = FE.Stability.state(game);
    $('stWorld').innerHTML = `世界 <b style="color:${['#3fb950', '#e3b341', '#f85149'][lvl]}">${FE.Stability.names[lvl]}</b>`;
    $('stTime').textContent = `${game.ticks || 0} 刻`;
    $('stWhere').textContent = v ? `${v.name}（${v.kind === 'town' ? '城鎮' : '村莊'}）` : `第 ${W.chunkNumber(p.x, p.y)} 塊世界`;
    $('stEnv').textContent = envText(W.cell(p.x, p.y)) + (lm ? `，${lm.name}` : '');
  }

  // ---- 下方列 ----

  // 目標：貼著的怪物或目前的目標；旁邊沒有怪物時改顯示所在聚落或環境的簡短資訊
  function drawTarget() {
    const el = $('target');
    const m = game.targetMonster();
    if (m) {
      const T = FE.BUG_TYPES[m.type];
      const cd = game.battle.cooldown;
      el.innerHTML = `
        <div class="t-head"><b>目標：${esc(m.name)}</b><span class="dim">體型 ${FE.sizeName(m)}</span></div>
        <div class="t-hp"><div class="bar"><i style="width:${Math.round((m.hp / m.maxHp) * 100)}%"></i></div><span>${m.hp} / ${m.maxHp}</span></div>
        <p class="t-extra">異常：${esc(T.name)}　抗性：${esc(FE.resistText(m, FE.Gear.clearLevel(game.player)))}</p>
        <div class="actions">
          <button data-act="attack">1 攻擊</button>
          <button data-act="deep" ${cd > 0 ? 'disabled' : ''}>2 重擊${cd > 0 ? `（${cd}）` : ''}</button>
          <button data-act="flee">3 撤退</button>
        </div>`;
      return;
    }
    const W = game.world;
    const p = game.player;
    const v = W.villageAt(p.x, p.y);
    if (v && v.steading) {
      const s = v.steading;
      el.innerHTML = `
        <div class="t-head"><b style="color:var(--accent)">${esc(v.name)}（${v.kind === 'town' ? '城鎮' : '村莊'}）</b><span class="dim">安全區</span></div>
        <p>經濟 ${FE.PROSPERITY[s.prosperity]}　人口 ${FE.POPULATION[s.population]}</p>
        <p class="t-extra dim">裝備售價是原價的 ${FE.Steading.shopFactor(v).toFixed(2)} 倍。按 I 看聚落資訊，撞上村民或工匠可以對話、買賣、修理。</p>`;
      return;
    }
    const c = W.cell(p.x, p.y);
    const b = FE.BIOMES[c.biome];
    const lm = W.landmarkAt(p.x, p.y);
    el.innerHTML = `
      <div class="t-head"><b style="color:var(--accent)">${esc(b.name)}</b><span class="dim">高度 ${c.h}</span></div>
      <p>${b.hit ? `在這裡出手 ${b.hit > 0 ? '+' : ''}${b.hit}` : '在這裡出手沒有加減'}${lm ? `，${esc(lm.name)}` : ''}</p>
      <p class="t-extra dim">旁邊沒有怪物。撞上怪物就是攻擊牠。</p>`;
  }

  function drawQuest() {
    const c = game.player.carrying;
    let text = '任務：目前沒有。去找頭上帶紫底 & 的村民。';
    if (c && c.kind === 'hunt') {
      const left = game.huntRemaining(c.monsterIds);
      text = left
        ? `任務：清掉${c.village}附近的小怪物，還剩 ${left} / ${c.total} 隻（紫框）。獎勵 經驗值 ${c.exp}、金幣 ${c.gold}`
        : `任務：小怪物都清掉了，回${c.village}找委託人（綠底的 &）領獎勵`;
    } else if (c) {
      const g = game.goodsFor(c);
      text = `任務：把${g ? g.name : '東西'}送到${c.targetVillage}的${c.targetName}${c.steps ? `（約 ${c.steps} 步）` : ''}，收貨人是綠底的 &。獎勵 經驗值 ${c.exp}、金幣 ${c.gold}`;
    }
    $('questText').textContent = text;
  }

  // 最近 3 行訊息，最新的在最下面
  function drawLog() {
    $('log').innerHTML = game.log
      .slice(0, 3)
      .reverse()
      .map((l) => `<li class="log-${l.kind}">${esc(l.text)}</li>`)
      .join('');
  }

  // ---- 對話視窗：蓋在地圖中間 ----
  function drawDialog() {
    const el = $('dialog');
    const npc = game.talking != null ? game.talkTarget(game.talking) : null;
    if (!npc) {
      game.talking = null;
      el.classList.add('hidden');
      return;
    }
    const t = game.talkOptions(npc);
    el.classList.remove('hidden');
    el.innerHTML = `
      <div class="dlg-head"><b>${esc(t.name)}</b><span class="dim">${esc(t.role)}｜${esc(t.village)}</span></div>
      <p class="dlg-text">${esc(t.text)}</p>
      <div class="dlg-opts">${t.options
        .map(
          (o, i) =>
            `<button data-opt="${i}" ${o.disabled ? 'disabled' : ''}><kbd>${i + 1}</kbd>${esc(o.label)}${o.note ? ` <span class="dim">（${esc(o.note)}）</span>` : ''}</button>`
        )
        .join('')}</div>
      <p class="dim dlg-hint">按數字鍵選擇，Esc ${game.talkPage && game.talkPage !== 'main' ? '返回上一層' : '關閉'}</p>`;
  }

  // ---- 按鍵視窗：同時只開一個 ----

  function drawHistory() {
    const list = game.history.filter((h) => h.seed === game.seed);
    $('history').innerHTML = list.length
      ? list
          .map((h) => `<li>${esc(h.time)}｜${esc(h.player)}擊敗了${esc(h.bug)}（第 ${h.chunk} 塊世界，影響 ${h.scope} 格）</li>`)
          .join('')
      : '<li class="dim">還沒有人打倒大型怪物。</li>';
  }

  function drawReports() {
    $('reports').innerHTML = game.reports.length
      ? game.reports
          .map(
            (r) =>
              `<li><b>${esc(r.time)}</b>｜種子 ${r.seed}｜第 ${r.turn} 回合｜動作 ${esc(r.action)}｜位置（${r.x}, ${r.y}）<br>${esc(r.message)}${
                r.stack ? `<pre>${esc(r.stack)}</pre>` : ''
              }</li>`
          )
          .join('')
      : '<li class="dim">目前沒有錯誤報告。</li>';
  }

  function drawLogAll() {
    const el = $('logAll');
    el.innerHTML = game.log
      .slice()
      .reverse()
      .map((l) => `<li class="log-${l.kind}">${esc(l.text)}</li>`)
      .join('');
    el.parentNode.scrollTop = el.parentNode.scrollHeight;
  }

  // 聚落資訊：所在的聚落，不在聚落裡就是離冒險者最近的那一座
  function drawSteading() {
    const el = $('steading');
    const W = game.world;
    const p = game.player;
    let v = W.villageAt(p.x, p.y);
    const inside = !!v;
    if (!v) {
      const dist = (a) => Math.abs(a.cx - p.x) + Math.abs(a.cy - p.y);
      v = W.villages.slice().sort((a, b) => dist(a) - dist(b))[0];
    }
    if (!v || !v.steading) {
      el.innerHTML = '<p class="dim">附近還沒有聚落。</p>';
      return;
    }
    const s = v.steading;
    const lm = W.landmarks.find((l) => l.villageId === v.id);
    const lmText = lm ? `${lm.name}，在${game.directionTo({ x0: lm.x0, x1: lm.x1 + 1, y0: lm.y0, y1: lm.y1 + 1 })}` : '沒有';
    const tags = FE.Steading.describe(W, v)
      .map((t) => `<li><b>${esc(t.text)}</b><span class="dim">　${esc(t.info)}</span></li>`)
      .join('');
    el.innerHTML = `
      <h3 style="margin-top:0">${esc(v.name)}（${v.kind === 'town' ? '城鎮' : '村莊'}）${inside ? '' : `<span class="dim">　你不在這裡，這是離你最近的聚落，在${esc(game.directionTo({ x0: v.cx, x1: v.cx + 1, y0: v.cy, y1: v.cy + 1 }))}</span>`}</h3>
      <div class="row"><span>經濟</span><span>${FE.PROSPERITY[s.prosperity]}（裝備售價 ×${FE.Steading.shopFactor(v).toFixed(2)}）</span></div>
      <div class="row"><span>人口</span><span>${FE.POPULATION[s.population]}</span></div>
      <div class="row"><span>由來</span><span>${esc(s.option)}；${esc(s.problem)}</span></div>
      <ul class="tags">${tags}</ul>
      <div class="row"><span>附近的地貌</span><span>${esc(lmText)}</span></div>`;
  }

  // 背包：上面是目前的負重和穿著的裝備（主手、副手、身上），下面列出每樣東西與數量，按數字選：
  // 藥草是吃、裝備是穿上或拿起（算一個動作，換下的放回背包）；按 X 或點按鈕切到「丟掉」，選到的整疊直接消失
  function drawBackpack() {
    const p = game.player;
    const G = FE.Gear;
    const list = game.bagList();
    const drop = ui.bagDrop;
    const tier = game.loadTier();
    const slot = (label, g) =>
      `<li><span class="dim">${label}</span> ${g ? `${esc(G.name(g))} <span class="dim">（${esc(G.statText(g))}、${esc(G.durText(g))}）</span>` : '<span class="dim">空著</span>'}</li>`;
    $('bagInfo').innerHTML = `
      <p>負重 <b class="${tier ? 'over' : ''}">${game.weight()} / ${C.CARRY_LIMIT}</b>${
        tier === 1 ? '　超重：每個動作多 2 刻、出手 -1' : tier === 2 ? '　超重太多：不能移動、不能撤退、出手 -2，先丟掉東西' : ''
      }</p>
      <ul class="equipped">${slot('主手', p.equip.main)}${slot('副手', p.equip.off)}${slot('身上', p.equip.body)}</ul>
      <p><button data-dropmode class="${drop ? 'on' : ''}">${drop ? '現在是「丟掉」：選到的整疊直接消失（按 X 切回）' : '切到「丟掉」（X）'}</button></p>`;
    $('backpack').innerHTML = list.length
      ? list
          .map((e, i) => {
            const can = drop ? e.id !== 'goods' : e.use;
            const act = drop ? '丟掉' : e.id === 'gear' ? '穿上或拿起' : '使用';
            const note = e.id === 'gear' && !e.use && !drop ? '放在背包裡，撞上礦脈或藥草就會用' : can ? act : '';
            return `<li><button data-use="${i}" ${can ? '' : 'disabled'}><kbd>${i + 1}</kbd>${esc(e.name)}${e.n > 1 ? ` ×${e.n}` : ''}${
              e.info ? ` <span class="dim">（${esc(e.info)}）</span>` : ''
            }${note ? ` <span class="dim">【${esc(note)}】</span>` : ''}</button></li>`;
          })
          .join('')
      : '<li class="dim">背包是空的。</li>';
  }

  const WINDOWS = {
    legend: null,
    backpack: drawBackpack,
    history: drawHistory,
    messages: drawLogAll,
    steading: drawSteading,
    reports: drawReports,
    settings: null,
  };

  function drawWindow() {
    $('overlay').classList.toggle('hidden', !ui.win);
    for (const name of Object.keys(WINDOWS)) $('win-' + name).classList.toggle('hidden', name !== ui.win);
    if (ui.win && WINDOWS[ui.win]) WINDOWS[ui.win]();
  }

  function update() {
    drawMap();
    drawMinimap();
    drawStatus();
    drawTarget();
    drawQuest();
    drawLog();
    drawDialog();
    drawWindow();
  }

  function relayout() {
    layout();
    if (game) {
      drawMap();
      drawMinimap();
    }
  }

  FE.UI = {
    init(g) {
      game = g;
      $('seed').textContent = `世界種子 ${g.seed}`;
      $('playerName').value = g.player.name;
      layout();
      if (window.ResizeObserver) new ResizeObserver(relayout).observe($('mapwrap'));
      window.addEventListener('resize', relayout);
      setInterval(drawMap, C.GLITCH_MS);
      update();
    },
    update,
    relayout,
    win: () => ui.win,
    bagDrop: () => ui.bagDrop,
    toggleBagDrop() {
      ui.bagDrop = !ui.bagDrop;
      update();
    },
    openWindow(name) {
      ui.win = name;
      if (name === 'backpack') ui.bagDrop = false;
      if (name === 'reports' && game.reports.length) FE.store.save('fe.reportSeen', reportId(game.reports[0]));
      update();
    },
    closeWindow() {
      ui.win = null;
      update();
    },
    toggleMinimap() {
      ui.mini = !ui.mini;
      FE.store.save('fe.minimap', ui.mini);
      drawMinimap();
    },
  };
})();
