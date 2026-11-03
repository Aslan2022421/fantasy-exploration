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

  // 畫面狀態（不進存檔）：開著哪個視窗（小地圖也是視窗）、地圖的版面
  const ui = { win: null, bagDrop: false, bagOff: false, cell: 22, cols: 21, rows: 21, ox: 0, oy: 0, w: 0, h: 0, dpr: 1 };

  // ---- 配色：Canvas 畫的顏色全部讀 css/style.css 的變數，改色只改那裡 ----
  const P = {};
  const PAL_NAMES = [
    't-plain', 't-grass', 't-forest', 't-snow', 't-sand', 't-mount', 't-water', 't-rock', 't-stonewall', 't-woodwall', 't-house', 't-road', 't-market', 't-temple', 't-door', 't-bed', 't-furniture', 't-ruin', 't-relic',
    'void', 'hp', 'hp-mid', 'hp-low', 'bug', 'good', 'bad', 'world',
    'map-node-ore', 'map-node-herb', 'map-chest', 'map-item', 'map-ol-aim', 'map-aim-area', 'map-npc', 'map-smith', 'map-armorer', 'map-soldier', 'map-player-fg', 'map-player-bg',
    'map-mon-fg', 'map-mon-bg', 'map-mid-fg', 'map-mid-bg', 'map-boss-bg', 'map-glitch-fg', 'map-glitch-bg', 'map-ol-target', 'map-ol-hunt', 'map-ol-chase',
    'map-h0', 'map-h1', 'map-h2', 'map-h3', 'map-h4', 'map-village', 'map-town', 'map-indoor', 'map-road', 'map-quest', 'map-recipient',
    'm-plain', 'm-grassland', 'm-shrubland', 'm-forest', 'm-taiga', 'm-tundra', 'm-glacier', 'm-jungle', 'm-savanna', 'm-desert', 'm-marsh', 'm-swamp', 'm-mountain', 'm-lake', 'm-rock',
    'm-stonewall', 'm-woodwall', 'm-building', 'm-village', 'm-town', 'm-relic', 'm-flash', 'm-mon', 'm-boss', 'm-view', 'm-slot',
  ];
  function loadPalette() {
    const cs = getComputedStyle(document.documentElement);
    for (const n of PAL_NAMES) P[n] = cs.getPropertyValue('--' + n).trim() || '#888';
  }

  // ---- 版面：地圖填滿狀態列與下方列之間的空間 ----
  // 格數＝可用空間 ÷ 每格像素，寬高各取奇數（冒險者才在正中央）；短邊至少 VIEW_MIN 格，不夠就把格子縮小。
  // 格子大小只看視窗大小決定，不為了填滿再微調：底部、頂部內容變了高度差幾像素時，只增減格數，字不會跟著縮放
  function layout() {
    const wrap = $('mapwrap');
    const cv = $('map');
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    if (w <= 0 || h <= 0) return;
    const odd = (n) => Math.max(1, n % 2 ? n : n - 1);
    const cell = Math.max(8, Math.min(C.CELL_PX, Math.floor(Math.min(w, h) / C.VIEW_MIN)));
    const cols = odd(Math.floor(w / cell + 1e-6));
    const rows = odd(Math.floor(h / cell + 1e-6));
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

  // 地形字元要不要粗體（FE.TERRAIN 的 cls；顏色是同名的 CSS 變數）。底色越亮越高，聚落、室內、小路、有委託、收貨人各有底色，也都在 CSS 變數裡
  const TERRAIN_BOLD = new Set(['t-forest', 't-mount', 't-stonewall', 't-woodwall', 't-house', 't-market', 't-temple', 't-door', 't-relic']);

  function drawMap() {
    const cv = $('map');
    if (!ui.w) return;
    const ctx = cv.getContext('2d');
    const W = game.world;
    const p = game.player;
    const { cell, cols, rows, ox, oy } = ui;
    ctx.setTransform(ui.dpr, 0, 0, ui.dpr, 0, 0);
    ctx.fillStyle = P.void;
    ctx.fillRect(0, 0, ui.w, ui.h);
    const { x: camX, y: camY } = camera();

    // 先把實體和 BUG 的效果整理成查表，畫每一格時直接查
    const npcs = new Map(W.npcs.map((n) => [key(n.x, n.y), n]));
    const soldiers = new Map(game.soldiers.map((s) => [key(s.x, s.y), s]));
    const chests = new Map(W.chests.map((c) => [key(c.x, c.y), c]));
    // 地上的東西（擲出去的武器）
    const items = new Set(W.items.map((it) => key(it.x, it.y)));
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
    // 瞄準中的怪物（白框之外另一種顏色），範圍魔攻會波及的格子塗上底色
    const aimed = game.aimTarget();
    const area = new Set();
    if (aimed && game.aim.mode === 'spell') {
      const rad = FE.Char.attrMod(p, 'int') >= C.SPELL_BIG_INT ? C.SPELL_RADIUS[1] : C.SPELL_RADIUS[0];
      for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) area.add(key(aimed.x + dx, aimed.y + dy));
    }
    // 清除委託指定的小怪物（合體後就標合體怪物）
    const hunted = new Set();
    const hc = p.jobs.hunt ? p.jobs.hunt.monsterIds : [];
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
        const tcls = FE.TERRAIN[c.t].cls;
        let fg = P[tcls] || P['t-plain'];
        let bold = TERRAIN_BOLD.has(tcls);
        // 底色越亮越高；聚落、室內、路各有底色
        const vv = W.villageAt(x, y);
        const indoor = vv && FE.Steading.roomAt(vv, x, y) >= 0;
        let bg = c.t === '·' ? P['map-road'] : indoor ? P['map-indoor'] : vv ? (vv.kind === 'town' ? P['map-town'] : P['map-village']) : P['map-h' + c.h] || P['map-h0'];
        const baseBg = bg;
        let alpha = 1;
        const o = overlay.get(k);
        if (o) {
          if (o.glyph) glyph = o.glyph;
          if (o.cls === 'glitch') {
            fg = P['map-glitch-fg'];
            bg = P['map-glitch-bg'];
          } else if (o.cls === 'faded') alpha = 0.35;
        }
        let outline = null;
        let hpPct = -1;
        const nd = nodes.get(k);
        if (nd && FE.TERRAIN[c.t].pass) {
          glyph = FE.NODES[nd.kind].glyph;
          fg = P['map-node-' + nd.kind];
          bold = true;
        }
        if (items.has(k)) {
          glyph = ')';
          fg = P['map-item'];
          bold = true;
          alpha = 1;
        }
        if (area.has(k)) bg = P['map-aim-area'];
        if (chests.has(k)) {
          glyph = '$';
          fg = P['map-chest'];
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
          if (n.role === 'smith') fg = P['map-smith'];
          else if (n.role === 'armorer') fg = P['map-armorer'];
          else {
            fg = P['map-npc'];
            if (handIn(n)) bg = P['map-recipient'];
            else if (n.quest && !n.quest.accepted && !n.quest.done) bg = P['map-quest'];
          }
        }
        // 士兵：鋼灰色的 &，格子底下有血條
        const sol = soldiers.get(k);
        if (sol) {
          glyph = '&';
          fg = P['map-soldier'];
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
          if (m.boss) { fg = P['map-mid-fg']; bg = P['map-boss-bg']; }
          else if (m.tier === 'mid') { fg = P['map-mid-fg']; bg = P['map-mid-bg']; }
          else { fg = P['map-mon-fg']; bg = P['map-mon-bg']; }
          // 外框：目前的目標（白）＞清除委託指定（紫）＞正在追你（黃）
          outline = m === aimed ? P['map-ol-aim'] : m === target ? P['map-ol-target'] : hunted.has(m) ? P['map-ol-hunt'] : m.chase > 0 ? P['map-ol-chase'] : null;
          hpPct = Math.round((m.hp / m.maxHp) * 100);
        }
        if (p.x === x && p.y === y) {
          glyph = '@';
          fg = P['map-player-fg'];
          bg = P['map-player-bg'];
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
          ctx.fillStyle = hpPct > 60 ? P.hp : hpPct > 30 ? P['hp-mid'] : P['hp-low'];
          ctx.fillRect(px0 + pw * 0.1, py0 + ph - 1 - barH, (pw * 0.8 * hpPct) / 100, barH);
        }
        ctx.globalAlpha = 1;
      }
    }
  }

  // 小地圖（M 開的視窗）：冒險者附近 MINIMAP_W×MINIMAP_H 格，一格畫成 S×S 像素；白框是主畫面看得到的範圍
  // 按生態區上色（顏色是 CSS 的 --m-生態區），巨石另外畫深色
  function shade(hex, h) {
    const n = parseInt(hex.slice(1), 16);
    const f = 0.75 + h * 0.08; // 越高越亮
    const ch = (s) => Math.min(255, Math.round(((n >> s) & 255) * f));
    return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
  }

  function drawMinimap() {
    if (ui.win !== 'minimap') return;
    const cv = $('minimap');
    const W = game.world;
    const p = game.player;
    // 一格幾像素：視窗放得下的最大值（最多 4）
    const S = Math.max(1, Math.min(4, Math.floor((window.innerWidth - 80) / C.MINIMAP_W), Math.floor((window.innerHeight - 140) / C.MINIMAP_H)));
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
    ctx.fillStyle = P.void; // 還沒創出來的地方
    ctx.fillRect(0, 0, cv.width, cv.height);
    for (let y = y0; y < y0 + MH; y++) {
      for (let x = x0; x < x0 + MW; x++) {
        const c = W.cell(x, y);
        if (!c) continue;
        const base = c.t === '#' ? P['m-rock'] : P['m-' + c.biome] || '#444444';
        const vv = W.villageAt(x, y);
        // 地貌上的人造物（斷牆、立石、塔⋯⋯）畫成土黃色
        const relic = /[▓░ΠΘ†Ω‡+¤]/.test(c.t);
        const building = /[⌂∩♦]/.test(c.t);
        const wall = c.t === 'W' || c.t === 'w';
        ctx.fillStyle = wall ? (c.t === 'W' ? P['m-stonewall'] : P['m-woodwall']) : building ? P['m-building'] : vv ? (vv.kind === 'town' ? P['m-town'] : P['m-village']) : relic ? P['m-relic'] : shade(base, c.h);
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
    for (const ch of W.chests) dot(ch.x, ch.y, P['map-chest']);
    for (const n of W.npcs) {
      const target = handIn(n);
      dot(n.x, n.y, target ? P.good : n.role === 'smith' ? P['map-smith'] : n.role === 'armorer' ? P['map-armorer'] : P['map-npc'], target ? big : S);
    }
    // 地形重算的地方：亮紫色的點，100 刻後消失
    for (const s of game.soldiers) dot(s.x, s.y, P['map-soldier']);
    for (const f of game.flashes || []) if (f.until > (game.ticks || 0)) dot(f.x, f.y, P['m-flash'], big);
    for (const m of game.monsters) dot(m.x, m.y, m.tier !== 'small' ? P['m-boss'] : P['m-mon'], m.tier !== 'small' ? big : S);
    dot(p.x, p.y, P['map-player-fg'], big);
    const cam = camera();
    ctx.strokeStyle = P['m-view'];
    ctx.strokeRect((cam.x - x0) * S + 0.5, (cam.y - y0) * S + 0.5, C.VIEW_W * S - 1, C.VIEW_H * S - 1);
    // 下一塊會長在哪：離冒險者最近的邊界，用虛線框標出來
    const slot = W.nearestFrontier(p.x, p.y);
    if (slot) {
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = P['m-slot'];
      ctx.strokeRect((slot.cx * C.CHUNK_W - x0) * S + 0.5, (slot.cy * C.CHUNK_H - y0) * S + 0.5, C.CHUNK_W * S - 1, C.CHUNK_H * S - 1);
      ctx.setLineDash([]);
    }
  }

  // ---- 上方：一行狀態、生命與經驗兩條長條 ----

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
    // 名字與職業、時間（第幾天幾時）、世界狀態、錢（金銀銅），後面是戰鬥數字：攻擊力、物理／魔法減傷、閃避 %、格擋機率；最右邊是所在的地方
    $('stName').innerHTML = `<b>${esc(p.name)}</b>（${esc(FE.Char.cls(p).name)}）`;
    $('stTime').textContent = FE.clockText(game.ticks);
    const lvl = FE.Stability.state(game);
    $('stWorld').innerHTML = `世界 <b class="ws-${lvl}">${FE.Stability.names[lvl]}</b>`;
    $('stGold').textContent = FE.money(p.copper);
    const d = FE.Gear.playerDefense(p);
    $('stAtk').textContent = `傷害 ${game.attackText()}`;
    $('stPhys').textContent = `物理減傷 ${FE.Gear.physReduce(p)}`;
    $('stMagic').textContent = `魔法減傷 ${FE.Gear.magicReduce(p)}`;
    $('stDodge').textContent = `閃避 ${Math.round(d.dodge * 100)}%`;
    $('stBlock').textContent = `格擋 ${Math.round(d.block * 100)}%`;
    $('stLoad').textContent = game.loadTier() ? `超重 ${game.weight()} / ${game.carryLimit()} 磅` : '';
    $('stLoad').classList.toggle('hidden', !game.loadTier());
    const n = unseenReports();
    $('reportBadge').classList.toggle('hidden', n === 0);
    $('reportBadge').textContent = `⚠${n}`;

    // 兩條整寬長條：生命；等級與經驗值（只顯示這一級的進度，創世門檻由創世神決定，不顯示）
    $('hpText').textContent = `生命 ${p.hp} / ${p.maxHp}`;
    setBar('hpFill', p.hp, p.maxHp);
    const lo = FE.levelExp(game.level);
    const hi = FE.levelExp(game.level + 1);
    if (game.level >= C.LEVEL_MAX) {
      $('cpText').textContent = `Lv ${game.level} 經驗 ${game.exp}（最高等級）`;
      setBar('cpFill', 1, 1);
    } else {
      $('cpText').textContent = `Lv ${game.level} 經驗 ${game.exp - lo} / ${hi - lo}`;
      setBar('cpFill', game.exp - lo, hi - lo);
    }
  }

  // ---- 下方：狀態效果、目標、地點資訊、快捷列 ----

  // 怪物身上的狀態（倒地、削弱、侵擾），目標那一行與狀態效果用
  const monStates = (m) => [m.prone ? '倒地（下一回合不能動，打牠有優勢）' : '', m.sapped ? '削弱（下一次出手有劣勢）' : '', m.vexed ? '侵擾（你下一次打牠有優勢）' : ''].filter(Boolean);

  // 狀態效果：冒險者這邊的狀態（侵擾：你下一次打哪隻怪物有優勢）；沒有就寫「無」
  function drawEffects() {
    const vex = game.monsters.filter((m) => m.vexed && Math.abs(m.x - game.player.x) + Math.abs(m.y - game.player.y) <= C.SIGHT * 3);
    const fx = vex.map((m) => `侵擾：下一次打${m.name}有優勢`);
    const ex = game.player.exhaust || 0;
    if (ex) fx.push(`力竭 ${ex}：出手 −${C.EXHAUST_D20 * ex}，走路慢 ${Math.round((FE.Char.exhaustMoveMul(game.player) - 1) * 100)}%`);
    $('fxText').textContent = fx.length ? fx.join('　') : '無';
  }

  // 底部顯示的目標：瞄準中的、貼著的目前目標、長槍打得到的、還纏著你的那隻
  function focusMonster() {
    return game.aimTarget() || game.targetMonster() || game.reachTarget() || game.monsters.find((m) => m.id === game.battle.targetId) || null;
  }

  // 目標那一行：目前的目標（名字、血條、生命，後面是狀態、體型、異常、抗性）；瞄準中多寫距離與按鍵；沒有就寫「無」
  function drawTarget() {
    const p = game.player;
    const m = focusMonster();
    if (m) {
      const T = FE.BUG_TYPES[m.type];
      const st = monStates(m);
      let aim = '';
      if (game.aim && m === game.aimTarget()) {
        const r = game.rangedMode(true);
        const d = Math.abs(m.x - p.x) + Math.abs(m.y - p.y);
        const far = r && d > r.range[0];
        aim = `<span class="aim">瞄準（${game.aim.i + 1}/${game.aim.ids.length}）距離 ${d} 格${far ? '，超出正常射程（劣勢）' : ''}${game.adjacentMonsters().length ? '，貼著怪物（劣勢）' : ''}：Tab 換目標，F 或 Enter 出手，Esc 取消</span>`;
      }
      $('tgtText').innerHTML = `<span class="tname">${esc(m.name)}</span><span class="t-hp"><span class="bar"><i style="width:${Math.round((m.hp / m.maxHp) * 100)}%"></i></span>生命 ${m.hp} / ${m.maxHp}</span>${aim}${st.length ? `<span class="t-state">${esc(st.join('、'))}</span>` : ''}<span class="dim t-extra">體型 ${FE.sizeName(m)}　異常：${esc(T.name)}　抗性：${esc(FE.resistText(m, FE.Gear.clearLevel(p)))}</span>`;
    } else $('tgtText').textContent = '無';
    $('tgtText').className = m ? 'tgt' : '';
    // 快捷列：攻擊 <1>、重擊 <2>（冷卻中顯示剩幾回合、變暗）、撤退 <3>、射擊／施法 <F>、治療 <4>（牧師、聖騎士）、盾擊 <5>（戰士）
    const adj = game.targetMonster();
    const cls = FE.Char.cls(p);
    const cd = game.battle.cooldown;
    const hcd = game.battle.healCd || 0;
    const ranged = game.rangedMode(true);
    const can = {
      attack: !!adj || !!game.reachTarget(),
      deep: !!adj && cd <= 0,
      flee: !!adj,
      fire: !!ranged,
      heal: hcd <= 0 && p.hp < p.maxHp,
      bash: !!adj && !!FE.Gear.shieldOf(p),
      throw: !!game.throwMode(true),
    };
    document.querySelectorAll('#quick .qs[data-act]').forEach((b) => {
      b.disabled = !can[b.dataset.act];
    });
    // 用不上的格子不出現（第三十一版）：治療只有牧師、聖騎士，盾擊只有戰士，遠程要手上的武器射得出、丟得出（或會施法），投擲要手上有武器
    document.querySelector('#quick [data-act="heal"]').classList.toggle('hidden', !cls.heal);
    document.querySelector('#quick [data-act="bash"]').classList.toggle('hidden', !cls.bash);
    document.querySelector('#quick [data-act="fire"]').classList.toggle('hidden', !ranged);
    document.querySelector('#quick [data-act="throw"]').classList.toggle('hidden', !can.throw);
    document.querySelector('#quick [data-act="fire"] .qn').textContent = ranged && ranged.mode === 'spell' ? '施法' : ranged && ranged.mode === 'light' ? '神聖之光' : ranged && ranged.mode === 'throw' ? '投擲' : '射擊';
    document.querySelector('#quick [data-act="deep"] .qcd').textContent = adj && cd > 0 ? `冷卻 ${cd}` : '';
    document.querySelector('#quick [data-act="heal"] .qcd').textContent = hcd > 0 ? `冷卻 ${hcd}` : '';
    // 右下角的視窗按鈕：開著的那顆亮起來
    document.querySelectorAll('#quick .qw, #quick [data-win]').forEach((b) => b.classList.toggle('on', b.dataset.win === ui.win));
  }

  // 地點（第三十一版，照 Caves of Qud 放在頂部狀態列最右邊）：所在的聚落，或環境與在這裡出手的加減
  function drawPlace() {
    const W = game.world;
    const p = game.player;
    const v = W.villageAt(p.x, p.y);
    if (v) {
      $('stPlace').textContent = `${v.name}・${v.kind === 'town' ? '城鎮' : '村莊'}（安全區）`;
      return;
    }
    const b = FE.BIOMES[W.cell(p.x, p.y).biome];
    const lm = W.landmarkAt(p.x, p.y);
    $('stPlace').textContent = `${b.name}${lm ? '・' + lm.name : ''}（出手 ${b.hit > 0 ? '+' : ''}${b.hit || 0}）`;
  }

  // 這個村民現在可以交件或回報（地圖上綠底、小地圖上大綠點）：清完了的清除委託的委託人、送貨的收貨人、採藥採礦湊夠了的委託人
  function handIn(n) {
    const j = game.player.jobs;
    if (j.hunt && j.hunt.giverId === n.id && game.huntRemaining(j.hunt.monsterIds) === 0) return true;
    if (j.deliver && j.deliver.targetId === n.id) return true;
    return ['herb', 'ore'].some((k) => j[k] && j[k].giverId === n.id && game.bagCount(k) >= j[k].n);
  }

  // 委託視窗（Q，第三十一版從右側欄搬進視窗）：手上的委託，有的才列
  function drawQuest() {
    const j = game.player.jobs;
    const pay = (c) => `獎勵 經驗值 ${c.exp}、${FE.money(game.questPay(c, c.villageId))}`;
    const line = (k) => {
      const c = j[k];
      const head = `${FE.JOB_NAMES[k]}：`;
      if (k === 'hunt') {
        const left = game.huntRemaining(c.monsterIds);
        return head + esc(left ? `清掉${c.village}附近的小怪物，還剩 ${left} / ${c.total} 隻（紫框）。${pay(c)}` : `小怪物都清掉了，回${c.village}找委託人（綠底的 &）領獎勵`);
      }
      if (k === 'deliver') {
        const g = game.goodsFor(c);
        return head + esc(`把${g ? g.name : '東西'}送到${c.targetVillage}的${c.targetName}${c.steps ? `（約 ${c.steps} 步）` : ''}，收貨人是綠底的 &。${pay(c)}`);
      }
      const unit = k === 'herb' ? '份藥草' : '顆礦石';
      const have = game.bagCount(k);
      return head + esc(have >= c.n ? `${c.n} ${unit}湊齊了，拿回${c.village}給委託人（綠底的 &）。${pay(c)}` : `帶 ${c.n} ${unit}回${c.village}（背包裡有 ${have}）。${pay(c)}`);
    };
    const have = FE.JOB_KINDS.filter((k) => j[k]);
    $('questText').innerHTML = have.length ? have.map((k) => `<p>${line(k)}</p>`).join('') : '<p class="dim">手上沒有委託。紫底的 &amp; 有委託可以接。</p>';
  }

  // 右側欄的訊息紀錄：由上到下，最新的在最下面（放不下的從最上面切掉）
  function drawLog() {
    $('log').innerHTML = game.log
      .slice()
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

  // 聚落裡的人（村民、工匠、士兵）與種族，例如「艾德（鐵匠，矮人）、蜜拉（人類）⋯⋯」
  function residents(v) {
    const role = (n) => (n.role === 'smith' ? (v.kind === 'town' ? '武器匠，' : '鐵匠，') : n.role === 'armorer' ? '盔甲匠，' : n.role === 'soldier' ? '士兵，' : '');
    const list = game.world.npcs.filter((n) => n.villageId === v.id).concat(game.soldiers.filter((s) => s.villageId === v.id));
    return list.map((n) => `${n.name}（${role(n)}${FE.PLAYER_RACES[FE.npcRace(game.world, n)].name}）`).join('、') || '沒有人';
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
      <div class="row"><span>住一晚</span><span>${FE.money(C.LIVING_COST[s.prosperity] * C.SILVER)}（${FE.PROSPERITY[s.prosperity]}的生活${C.LIVING_REPAIR[s.prosperity] ? `，身上裝備的耐久回 ${Math.round(C.LIVING_REPAIR[s.prosperity] * 100)}%` : ''}${C.LIVING_QUEST[s.prosperity] ? `，這裡的委託獎勵 +${Math.round(C.LIVING_QUEST[s.prosperity] * 100)}%` : ''}）</span></div>
      <div class="row"><span>人口</span><span>${FE.POPULATION[s.population]}</span></div>
      <div class="row"><span>居民</span><span>${esc(residents(v))}</span></div>
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
      <p>負重 <b class="${tier ? 'over' : ''}">${game.weight()} / ${game.carryLimit()} 磅</b>（推拖上限 ${game.pushLimit()} 磅）${
        tier === 1 ? '　超過能背的重量：走一步要 60 刻' : tier === 2 ? '　超過推拖上限：不能移動、不能撤退，先丟掉東西' : ''
      }</p>
      <ul class="equipped">${slot('主手', p.equip.main)}${slot('副手', p.equip.off)}${slot('身上', p.equip.body)}</ul>
      <p><button data-dropmode class="${drop ? 'on' : ''}">${drop ? '現在是「丟掉」：選到的整疊直接消失（按 X 切回）' : '切到「丟掉」（X）'}</button>
      <button data-offmode class="${ui.bagOff ? 'on' : ''}">${ui.bagOff ? '現在武器放副手（雙持，按 V 切回）' : '武器改放副手（V）'}</button></p>
      <p class="dim">雙持：副手只能放以你的體型能單手拿的武器（每把武器標了單手、雙手或拿不動）。按 1 攻擊會主手、副手各出手一次，副手那一下不加屬性修正值；副手拿非輕型武器時那一下有劣勢、傷害骰降成 1d4；沒有迅切時這個動作多花 5 刻。重擊只用主手。副手拿了武器就不能拿盾牌；弓箭、輕弩要用兩手，體型不夠單手的武器也要用兩手。</p>`;
    $('backpack').innerHTML = list.length
      ? list
          .map((e, i) => {
            const can = drop ? e.id !== 'goods' : e.use;
            const act = drop ? '丟掉' : e.id === 'gear' ? (ui.bagOff && e.gear && FE.Gear.offOk(p, e.gear) ? '拿在副手' : e.grip === '拿不動' ? '拿不起來' : '穿上或拿起') : '使用';
            const note = e.id === 'gear' && !e.use && !drop ? '放在背包裡，撞上礦脈或藥草就會用' : can ? act : '';
            return `<li><button data-use="${i}" ${can ? '' : 'disabled'}><kbd>${i + 1}</kbd>${esc(e.name)}${e.n > 1 ? ` ×${e.n}` : ''}${
              e.info ? ` <span class="dim">（${esc(e.info)}）</span>` : ''
            }${note ? ` <span class="dim">【${esc(note)}】</span>` : ''}</button></li>`;
          })
          .join('')
      : '<li class="dim">背包是空的。</li>';
  }

  // 角色視窗用：主手武器的精通（用得上的才寫）
  function masteryLine() {
    const p = game.player;
    const m = p.equip.main ? FE.Char.mastery(p, p.equip.main) : null;
    return m ? `　精通時${FE.MASTERIES[m].name}（${FE.MASTERIES[m].desc}）` : '';
  }

  // 角色視窗（C）：職業與等級、生命與負重上限、六項屬性與修正值、各技能的等級與到下一級的進度、目前的加成
  function drawCharacter() {
    const p = game.player;
    const Ch = FE.Char;
    const c = Ch.cls(p);
    const sign = (n) => (n > 0 ? '+' : '') + n;
    const lo = FE.levelExp(game.level);
    const hi = FE.levelExp(game.level + 1);
    const attrRows = FE.ATTRS.map((a) => {
      const v = p.attr[a.key];
      return `<tr><td>${a.name}</td><td><b>${v}</b>${v >= C.ATTR_CAP ? ' <span class="dim">（上限）</span>' : ''}</td><td>${sign(Ch.mod(v))}</td><td class="dim">${esc(a.info)}</td></tr>`;
    }).join('');
    // 這項武器技能管哪些武器、學會哪些精通（一律要 5 級才會）
    const weaponsOf = (id) => Object.keys(FE.GEAR).filter((k) => FE.GEAR[k].cat === 'weapon' && (FE.GEAR[k].skill === id || FE.GEAR[k].meleeSkill === id));
    const effect = (id, lv) => {
      const hit = Math.floor(lv / C.SKILL_HIT_EVERY);
      const dmg = Math.floor(lv / C.SKILL_DMG_EVERY);
      if (id === 'fight') return `所有近戰出手（含徒手）命中 +${Math.floor(lv / C.FIGHT_HIT_EVERY)}，跟武器技能疊加`;
      if (id === 'shoot') return `所有遠程（射擊、投擲）命中 +${hit}`;
      if (id === 'misc') return `盾擊命中 +${hit}、傷害 +${dmg}`;
      if (id === 'bow' || id === 'crossbow') {
        const name = FE.GEAR[id === 'bow' ? 'bow' : 'crossbow'].name;
        const mas = FE.GEAR[id === 'bow' ? 'bow' : 'crossbow'].mastery;
        const unlock = lv >= FE.MASTERY_SKILL ? `；精通時${FE.MASTERIES[mas].name}` : `；${FE.MASTERY_SKILL} 級（精通）學會${FE.MASTERIES[mas].name}`;
        return `${name}射擊的傷害 +${dmg}${unlock}`;
      }
      if (FE.SKILLS[id].weapon) {
        const ws = weaponsOf(id).filter((k) => FE.GEAR[k].skill === id);
        const unlock = `；精通時：` + ws.map((k) => `${FE.MASTERIES[FE.GEAR[k].mastery].name}${lv >= FE.MASTERY_SKILL ? '' : `（${FE.MASTERY_SKILL} 級）`}`).join('、');
        return `${ws.map((k) => FE.GEAR[k].name).join('、')}：近戰命中 +${hit}、傷害 +${dmg}${FE.GEAR[ws[0]].thrown ? '（投擲只加傷害）' : ''}${id === 'staff' ? '；法師的範圍魔攻也算' : ''}${unlock}`;
      }
      if (id === 'dodge') return `閃避機率 +${lv}%`;
      if (id === 'shield') return `格擋機率 +${lv * 2}%`;
      // 輕甲、中甲、重甲：穿這一類時身上防具的重量打折、多花的刻減少
      const t = C.ARMOR_WEIGHT_MUL;
      const ticks = id === 'light' ? '輕甲本來不多花刻' : id === 'medium' ? (lv >= 5 ? '中甲不多花刻' : '中甲多 1 刻（5 級起不多花）') : lv >= 10 ? '重甲不多花刻' : lv >= 5 ? '重甲少 1 刻（10 級起不多花）' : '重甲多 2 刻（5 級起少 1 刻）';
      return `穿這一類時防具的重量 ×${t[Math.min(lv, t.length - 1)]}；${ticks}`;
    };
    const skillRows = Object.keys(FE.SKILLS).map((id) => {
      const s = p.skills[id];
      return `<tr><td>${FE.SKILLS[id].name}</td><td><b>${s.lv}</b> <span class="dim">${esc(FE.skillLevelName(s.lv))}</span></td><td>${Math.floor(s.n)} / ${Ch.skillNeed(s.lv)}</td><td class="dim">${esc(effect(id, s.lv))}</td></tr>`;
    }).join('');
    const d = FE.Gear.playerDefense(p);
    const con = Ch.attrMod(p, 'con');
    const heal = `1d10${con > 0 ? '+' + con : con < 0 ? con : ''}`; // 野外短休（第三十版）
    const tired = p.exhaust ? `　<b class="over">力竭 ${p.exhaust}</b>` : '';
    const R = FE.PLAYER_RACES[p.race] || FE.PLAYER_RACES.human;
    const body = `${R.name}　身高${FE.HEIGHTS[(p.height || 4) - 1]}、體格${FE.BUILDS[(p.build || 4) - 1]}　體型 ${Ch.sizeOf(p).toLocaleString('en-US')}`;
    $('charInfo').innerHTML = `
      <p><b>${esc(p.name)}</b>　${esc(c.name)}　Lv${game.level}　${game.level >= C.LEVEL_MAX ? `經驗值 ${game.exp}（最高等級）` : `經驗值 ${game.exp - lo} / ${hi - lo}`}${p.points > 0 ? `　<b class="over">還有 ${p.points} 點屬性沒加</b>` : ''}</p>
      <p>${esc(body)}${p.skillPack ? `　起始技能組合：${esc(p.skillPack)}` : ''}</p>
      <p>主手 ${p.equip.main ? esc(FE.Gear.name(p.equip.main)) : '空著'}　副手 ${p.equip.off ? esc(FE.Gear.name(p.equip.off)) : '空著'}${p.equip.off && FE.Gear.def(p.equip.off).cat === 'weapon' ? '（雙持）' : ''}　身上 ${p.equip.body ? esc(FE.Gear.name(p.equip.body)) : '空著'}</p>
      <p>生命 ${p.hp} / ${p.maxHp}　能背 ${game.carryLimit()} 磅、推拖上限 ${game.pushLimit()} 磅（目前 ${game.weight()} 磅）　走一步 ${Math.round(Ch.moveTicks(p) * Ch.exhaustMoveMul(p))} 刻　野外歇一小時回 ${heal}（最少 1）${tired}</p>
      <h3>屬性（修正值＝(屬性－10)÷2 無條件捨去，上限 ${C.ATTR_CAP}）</h3>
      <table class="stats"><tr><th>屬性</th><th>數值</th><th>修正值</th><th>用處</th></tr>${attrRows}</table>
      <h3>技能（用了就累積經驗，升到第 N 級要 ${C.SKILL_NEED_BASE}＋${C.SKILL_NEED_STEP}N 點，沒有上限；經驗倍率 ×${Ch.expFactor(p).toFixed(1)}）</h3>
      <table class="stats"><tr><th>技能</th><th>等級</th><th>到下一級</th><th>目前的效果</th></tr>${skillRows}</table>
      <h3>目前的數字</h3>
      <p>主手傷害 ${esc(game.attackText())}　近戰出手加減（不含地形與高處）${sign(FE.Gear.hitMod(p))}　暴擊 ${Ch.critMin(p, p.equip.main)}～20　攻擊一次 ${Ch.attackTicks(p, p.equip.main)} 刻${masteryLine()}　閃避 ${Math.round(d.dodge * 100)}%　物理傷害再減 ${Ch.conCut(p)}（體質）${d.blockMax ? `　格擋 ${Math.round(d.block * 100)}%、格擋值 ${d.blockMax}` : '　沒拿盾牌，不能格擋'}　向工匠買東西 ×${FE.Gear.buyFactor(game.chaMod()).toFixed(2)}、賣東西 ×${FE.Gear.sellFactor(game.chaMod()).toFixed(2)}</p>`;
  }

  // ---- 模態視窗：開新世界選職業與起始裝備、升級加點。開著的時候不能做別的事 ----
  // 選職業的畫面不需要遊戲（這時還沒有世界），選完才呼叫 onDone(職業, 挑的裝備)
  const classKeys = Object.keys(FE.CLASSES);
  const raceKeys = Object.keys(FE.PLAYER_RACES);
  // 建角的順序（第三十一版）：種族 → 人類自己加 2 點屬性 → 擲身高與體格 → 職業 → 起始技能 → 起始裝備（主手、身上、副手、補給）
  function startGroups() {
    return FE.startGroups(ui.start.cls);
  }
  const optLabel = (id) => FE.START_OPTS[id].label;
  const signed = (n) => (n > 0 ? '+' : '') + n;
  // 目前這個體型（種族、身高、體格）算出來的體型數字
  const startSize = () => FE.bodySize(ui.start.race, ui.start.height, ui.start.build);
  // 目前這一步左欄的選項（種族、人類加的屬性、體型的接受或重擲、職業，或這一組的起始裝備；拿不起來的武器不列出）
  const startList = () => {
    const s = ui.start;
    if (s.step === 'race') return raceKeys;
    if (s.step === 'bonus') return FE.ATTRS.map((a) => a.key);
    if (s.step === 'body') return ['accept', 'reroll'];
    if (s.step === 'class') return classKeys;
    if (s.step === 'skills') return s.skills.slots.map((x, i) => 's' + i).concat(['reroll', 'accept']);
    return FE.Char.groupOptions(startGroups()[s.gi], startSize());
  };
  // 擲身高與體格（各 1～7）
  const rollBody = () => {
    // 照種族的機率擲（第二十九版追加，FE.BODY_ODDS）
    const b = FE.Char.rollBody(ui.start.race, Math.random);
    ui.start.height = b.height;
    ui.start.build = b.build;
  };
  // 擲起始技能（5 格，鎖定的留著，其他重擲；偏高、偏低兩組機率表輪流）
  const rollSkills = () => {
    const s = ui.start;
    s.skills = FE.Char.rollSkills(s.cls, Math.random, s.skills);
  };
  const slotOf = (id) => ui.start.skills.slots[Number(id.slice(1))];

  // 右欄：游標那一項的詳細內容。種族看體型與加成；體型看身高、體格與每把武器拿不拿得動；職業看屬性、生命、負重、說明；裝備看數值、重量、說明
  function startDetail(id) {
    const s = ui.start;
    if (s.step === 'race') {
      const R = FE.PLAYER_RACES[id];
      const bonus = Object.keys(R.bonus || {}).map((k) => `${FE.ATTRS.find((a) => a.key === k).name} +${R.bonus[k]}`).join('、') || `自己加 ${R.free} 點`;
      return `<dl><dt>基本體型</dt><dd>${R.size.toLocaleString('en-US')}</dd><dt>屬性</dt><dd>${esc(bonus)}</dd></dl><p>${esc(R.desc)}</p>`;
    }
    if (s.step === 'bonus') {
      const a = FE.ATTRS.find((x) => x.key === id);
      const left = 2 - Object.values(s.bonus).reduce((n, v) => n + v, 0);
      return `<dl><dt>已加</dt><dd>${FE.ATTRS.map((x) => `${x.name} +${s.bonus[x.key] || 0}`).join('　')}</dd><dt>還能加</dt><dd>${left} 點</dd></dl><p>${esc(a.name)}：${esc(a.info)}</p><p class="dim">這 2 點加在職業的起始屬性上，上限 ${C.ATTR_CAP}。</p>`;
    }
    if (s.step === 'body') {
      const size = startSize();
      const R = FE.PLAYER_RACES[s.race];
      const weapons = Object.keys(FE.GEAR).filter((k) => FE.GEAR[k].cat === 'weapon');
      const rows = weapons
        .map((k) => {
          const g = { type: k, q: 0 };
          return `<dt>${esc(FE.GEAR[k].name)}</dt><dd>${FE.Char.GRIP_NAMES[FE.Char.grip({ size }, g)]}</dd>`;
        })
        .join('');
      return `<dl><dt>種族</dt><dd>${R.name}</dd><dt>身高</dt><dd>${FE.HEIGHTS[s.height - 1]}（${s.height} / 7）</dd><dt>體格</dt><dd>${FE.BUILDS[s.build - 1]}（${s.build} / 7）</dd><dt>體型</dt><dd>${size.toLocaleString('en-US')}</dd></dl><p class="dim">體型＝基本體型 ×（1＋0.05×（身高−4））×（1＋0.05×（體格−4））。不滿意可以重擲（R）。這個體型拿各種武器：</p><dl>${rows}</dl>`;
    }
    if (s.step === 'skills') {
      const rows = s.skills.slots.map((x) => `<dt>${esc(FE.SKILLS[x.id].name)}</dt><dd>${x.lv} 級（${esc(FE.skillLevelName(x.lv))}）${x.locked ? '　鎖定' : ''}</dd>`).join('');
      return `<dl>${rows}<dt>這次的手氣</dt><dd>${s.skills.high ? '偏高' : '偏低'}（下一次重擲${s.skills.high ? '偏低' : '偏高'}）</dd></dl><p class="dim">從全部技能擲 5 項，每項新手～精通（1～5 級），至少 1 項武器技能、1 項防具技能；${esc(FE.CLASSES[s.cls].name)}擅長的技能比較容易擲到。選一格可以鎖定或解鎖，重擲（R）只換沒鎖定的格子。沒擲到的技能都是涉獵（0 級），一樣用了就會練。下一步挑的武器、防具、盾牌，所屬的技能再 +1。</p>`;
    }
    if (s.step === 'class') {
      const c = FE.CLASSES[id];
      const tmp ={ cls: id, attr: Object.assign({}, c.attr) };
      // 顯示加上種族加成後的屬性（人類自己加的兩點也算進去）
      const R = FE.PLAYER_RACES[s.race];
      const add = Object.assign({}, R.bonus || {});
      for (const k of Object.keys(s.bonus || {})) add[k] = (add[k] || 0) + s.bonus[k];
      for (const k of Object.keys(add)) tmp.attr[k] = Math.min(C.ATTR_CAP, tmp.attr[k] + add[k]);
      const attrs = FE.ATTRS.map((a) => `<dt>${a.name}</dt><dd>${tmp.attr[a.key]}（修正值 ${signed(FE.Char.mod(tmp.attr[a.key]))}）${add[a.key] ? `<span class="dim">　含種族 +${add[a.key]}</span>` : ''}</dd>`).join('');
      return `<dl>${attrs}<dt>生命</dt><dd>${FE.Char.maxHp(tmp, 1)}</dd><dt>能背</dt><dd>${FE.Char.carryLimit(tmp)} 磅</dd><dt>固定給</dt><dd>${c.fixed.length ? c.fixed.map(optLabel).join('、') : '沒有，裝備都自己挑'}</dd></dl><p>${esc(c.desc)}</p>`;
    }
    const o = FE.START_OPTS[id];
    let rows = '';
    if (o.gear) {
      const g = FE.Gear.make(o.gear, 0, 0);
      const d = FE.Gear.def(g);
      const stat = FE.Gear.statText(g).split('、').filter((t) => !t.startsWith('重 ')).join('、');
      rows = `<dt>種類</dt><dd>${d.cat === 'weapon' ? '武器' : d.cat === 'shield' ? '盾牌' : '防具'}</dd><dt>數值</dt><dd>${esc(stat || '無')}</dd>${d.cat === 'weapon' ? `<dt>你拿起來</dt><dd>${FE.Char.GRIP_NAMES[FE.Char.grip({ size: startSize() }, g)]}</dd>` : ''}<dt>重量</dt><dd>${d.weight} 磅</dd>`;
    } else rows = `<dt>內容</dt><dd>${esc(o.label)}</dd>`;
    return `<dl>${rows}</dl><p>${esc(o.desc || '')}</p>`;
  }

  // 建角畫面（全螢幕）：左上角路徑、置中標題與副標、中間兩欄（左選項清單、右游標那一項的內容）、底部按鍵提示
  function drawStart() {
    const s = ui.start;
    const list = startList();
    if (s.cur >= list.length) s.cur = list.length - 1;
    const gear = s.step === 'gear';
    const g = gear ? startGroups()[s.gi] : null;
    const labelOf = (id) => {
      if (s.step === 'race') return FE.PLAYER_RACES[id].name;
      if (s.step === 'bonus') return `${FE.ATTRS.find((a) => a.key === id).name}　+${s.bonus[id] || 0}`;
      if (s.step === 'body') return id === 'accept' ? '接受這個體型' : '重擲身高與體格（R）';
      if (s.step === 'class') return FE.CLASSES[id].name;
      if (s.step === 'skills') {
        if (id === 'accept') return '接受這組起始技能';
        if (id === 'reroll') return '重擲沒鎖定的格子（R）';
        const x = slotOf(id);
        return `${FE.SKILLS[x.id].name}　${x.lv} 級（${FE.skillLevelName(x.lv)}）`;
      }
      return optLabel(id);
    };
    const rows = list
      .map((id, i) => {
        const slot = s.step === 'skills' && id[0] === 's' ? slotOf(id) : null;
        const got = (gear && s.sel.includes(id)) || (slot && slot.locked);
        return `<li data-pick="${id}" data-i="${i}" class="${i === s.cur ? 'cur' : ''} ${got ? 'got' : ''}"><span class="mk">${i === s.cur ? '&gt;' : ''}</span><span class="box">${gear || slot ? (got ? '[■]' : '[ ]') : ''}</span>${esc(labelOf(id))}</li>`;
      })
      .join('');
    const R = s.race ? FE.PLAYER_RACES[s.race] : null;
    let note = '';
    let title = '種族';
    let sub = '選種族';
    let path = '新世界';
    if (s.step === 'bonus') {
      const left = 2 - Object.values(s.bonus).reduce((n, v) => n + v, 0);
      title = '人類自己加的屬性';
      sub = '加 2 點屬性';
      path = `新世界 › ${R.name}`;
      note = `還能加 ${left} 點（兩點可以加在同一項，也可以分開加）。`;
    } else if (s.step === 'body') {
      title = '身高與體格';
      sub = '擲身高與體格';
      path = `新世界 › ${R.name}`;
      note = `身高${FE.HEIGHTS[s.height - 1]}、體格${FE.BUILDS[s.build - 1]}，體型 ${startSize().toLocaleString('en-US')}。`;
    } else if (s.step === 'class') {
      title = '職業';
      sub = '選職業';
      path = `新世界 › ${R.name}（${FE.HEIGHTS[s.height - 1]}、${FE.BUILDS[s.build - 1]}）`;
    } else if (s.step === 'skills') {
      title = '起始技能';
      sub = '擲起始技能';
      path = `新世界 › ${R.name} › ${FE.CLASSES[s.cls].name} › 起始技能`;
      note = '[■] 是鎖定的格子，重擲時不換。';
    } else if (gear) {
      const c = FE.CLASSES[s.cls];
      const have = s.picks.map(optLabel);
      title = `起始裝備　${g.name || '補給'}（第 ${s.gi + 1} / ${startGroups().length} 組）`;
      sub = '選起始裝備';
      path = `新世界 › ${R.name} › ${c.name} › 起始裝備`;
      note = `${g.pick > 1 ? `這一組從 ${list.length} 樣裡挑 ${g.pick} 樣，挑到 ${g.pick} 樣就進下一組。` : `這一組 ${list.length} 樣挑 1 樣。`}${list.length < g.of.length ? '（你的體型拿不起來的武器沒有列出。）' : ''}${c.fixed.length ? `<br>固定給：${c.fixed.map(optLabel).map(esc).join('、')}` : ''}${have.length ? `<br>已挑：${have.map(esc).join('、')}` : ''}<br>挑到的武器、防具、盾牌，所屬的技能 +1。`;
    }
    const cur = list[s.cur];
    $('modalBody').className = 'cc';
    $('modal').classList.add('full');
    $('modalBody').innerHTML = `
      <div class="cc-path">${esc(path)}</div>
      <h1>建立角色</h1>
      <div class="cc-sub">:${esc(sub)}:</div>
      <div class="cc-cols">
        <div class="frame"><span class="ft">${esc(title)}</span><div class="fb"><ul class="cc-list">${rows}</ul>${note ? `<p class="cc-note">${note}</p>` : ''}</div></div>
        <div class="frame"><span class="ft">${esc(labelOf(cur))}</span><div class="fb cc-detail">${startDetail(cur)}</div></div>
      </div>
      <div class="cc-keys">[Esc] 返回　[Enter／Space] 選擇　[R] ${s.step === 'body' || s.step === 'skills' ? '重擲' : '隨機'}　方向鍵移動　數字鍵直接選</div>`;
  }
  function startFinish() {
    const done = ui.start.done;
    const { cls, picks, race, bonus, height, build, skills } = ui.start;
    ui.start = null;
    $('modal').classList.add('hidden');
    done(cls, picks, { race, bonus, height, build }, skills);
  }
  // 選到某一項：種族（人類接著加兩點、其他種族直接擲體型）→ 加點 → 接受或重擲體型 → 職業 → 起始裝備
  function startChoose(id) {
    const s = ui.start;
    if (s.step === 'race') {
      if (!FE.PLAYER_RACES[id]) return;
      s.race = id;
      s.bonus = {};
      s.cur = 0;
      if (FE.PLAYER_RACES[id].free) s.step = 'bonus';
      else {
        s.step = 'body';
        rollBody();
      }
    } else if (s.step === 'bonus') {
      s.bonus[id] = (s.bonus[id] || 0) + 1;
      if (Object.values(s.bonus).reduce((n, v) => n + v, 0) >= 2) {
        s.step = 'body';
        s.cur = 0;
        rollBody();
      }
    } else if (s.step === 'body') {
      if (id === 'reroll') rollBody();
      else {
        s.step = 'class';
        s.cur = 0;
      }
    } else if (s.step === 'skills') {
      if (id === 'reroll') rollSkills();
      else if (id === 'accept') {
        s.step = 'gear';
        s.gi = 0;
        s.cur = 0;
        s.picks = [];
        s.sel = [];
      } else if (slotOf(id)) slotOf(id).locked = !slotOf(id).locked;
    } else if (s.step === 'class') {
      s.cls = id;
      s.step = 'skills';
      s.cur = 0;
      s.skills = null;
      rollSkills();
    } else {
      const g = startGroups()[s.gi];
      if (!startList().includes(id)) return;
      s.sel = s.sel.includes(id) ? s.sel.filter((x) => x !== id) : s.sel.concat(id);
      if (s.sel.length >= g.pick) {
        s.picks = s.picks.concat(s.sel);
        s.sel = [];
        s.gi++;
        s.cur = 0;
        if (s.gi >= startGroups().length) {
          startFinish();
          return;
        }
      }
    }
    drawStart();
  }
  function startBack() {
    const s = ui.start;
    if (s.step === 'race') return;
    if (s.step === 'bonus') {
      // 先把加的點數一點一點收回來，沒有了就回上一步
      const k = Object.keys(s.bonus).filter((x) => s.bonus[x] > 0).pop();
      if (k) s.bonus[k]--;
      else {
        s.step = 'race';
        s.cur = raceKeys.indexOf(s.race);
      }
    } else if (s.step === 'body') {
      if (FE.PLAYER_RACES[s.race].free) {
        s.step = 'bonus';
        const k = Object.keys(s.bonus).filter((x) => s.bonus[x] > 0).pop();
        if (k) s.bonus[k]--; // 回到加點，把最後一點收回來重加
      } else s.step = 'race';
      s.cur = 0;
    } else if (s.step === 'class') {
      s.step = 'body';
      s.cur = 0;
    } else if (s.step === 'skills') {
      s.step = 'class';
      s.cur = classKeys.indexOf(s.cls);
    } else if (s.sel.length) s.sel = [];
    else if (s.gi > 0) {
      s.gi--;
      s.picks = s.picks.filter((id) => !startGroups()[s.gi].of.includes(id));
    } else {
      // 回到起始技能（擲好的那組留著）
      s.step = 'skills';
      s.cur = 0;
    }
    drawStart();
  }

  // 升級加點：還有沒分配的屬性點就跳出來，選一項還沒到上限的屬性加 1 點（按 1～6 或點一下）
  function drawLevelUp() {
    const p = game.player;
    $('modalBody').className = 'win';
    $('modal').classList.remove('full');
    $('modalBody').innerHTML = `
      <h2>升到 Lv${game.level}　<span class="dim">選一項屬性加 1 點${p.points > 1 ? `（還有 ${p.points} 點）` : ''}</span></h2>
      <div class="winbody"><div class="dlg-opts">${FE.ATTRS.map((a, i) => {
        const v = p.attr[a.key];
        const full = v >= C.ATTR_CAP;
        const m0 = FE.Char.mod(v);
        const m1 = FE.Char.mod(v + 1);
        const note = full ? `已到上限 ${C.ATTR_CAP}` : `${v} → ${v + 1}${m1 !== m0 ? `，修正值 ${m0 > 0 ? '+' : ''}${m0} → ${m1 > 0 ? '+' : ''}${m1}` : `，修正值不變（${m0 > 0 ? '+' : ''}${m0}）`}`;
        return `<button data-attr="${a.key}" ${full ? 'disabled' : ''}><kbd>${i + 1}</kbd><b>${a.name}</b>　${esc(note)}<br><span class="dim">${esc(a.info)}</span></button>`;
      }).join('')}</div>
      <p class="dim dlg-hint">加完才能繼續。生命 ${p.hp} / ${p.maxHp}</p></div>`;
  }

  // 在聚落按 R 住一晚之前的確認視窗（第三十一版）：寫出這一晚的開支與效果
  function drawRestAsk() {
    const p = game.player;
    const v = game.world.villageAt(p.x, p.y);
    const k = v && v.steading ? v.steading.prosperity : 0;
    const fx = [C.LIVING_REPAIR[k] ? `身上裝備耐久回 ${Math.round(C.LIVING_REPAIR[k] * 100)}%` : '', C.LIVING_QUEST[k] ? `這裡的委託獎勵 +${Math.round(C.LIVING_QUEST[k] * 100)}%` : ''].filter(Boolean);
    $('modalBody').className = 'win';
    $('modal').classList.remove('full');
    $('modalBody').innerHTML = `
      <h2>住一晚（8 小時）</h2>
      <div class="winbody"><p>開支 <b>${FE.money(C.LIVING_COST[k] * C.SILVER)}</b>（經濟：${FE.PROSPERITY[k]}）　身上 ${FE.money(p.copper)}</p>
      <p>生命回滿、力竭 −1${fx.length ? '；' + fx.join('、') : ''}。</p>
      <p class="dim dlg-hint">Enter 住下　Esc 取消</p></div>`;
  }

  function drawModal() {
    const open = !!ui.start || !!ui.restAsk || (game && game.player && game.player.points > 0);
    $('modal').classList.toggle('hidden', !open);
    if (!open) return;
    if (ui.start) drawStart();
    else if (ui.restAsk) drawRestAsk();
    else drawLevelUp();
  }

  // 查看（滑鼠右鍵點地圖，第三十一版）：那一格的怪物、村民、工匠、士兵或地形
  function drawLook() {
    const L = ui.look;
    const el = $('lookInfo');
    if (!L) return;
    const W = game.world;
    const m = game.monsterAt(L.x, L.y);
    const n = W.npcAt(L.x, L.y) || game.soldierAt(L.x, L.y);
    const c = W.cell(L.x, L.y);
    if (m) {
      const T = FE.BUG_TYPES[m.type];
      const st = monStates(m);
      const chasing = game.battle.targetId === m.id ? '你的目標' : m.chase > 0 ? '正在追你' : '還沒發現你';
      el.innerHTML = `<p><b class="tname">${esc(m.name)}</b>　<span class="dim">${chasing}</span></p><dl><dt>生命</dt><dd>${m.hp} / ${m.maxHp}</dd><dt>體型</dt><dd>${FE.sizeName(m)}</dd><dt>異常</dt><dd>${esc(T.name)}</dd><dt>抗性</dt><dd>${esc(FE.resistText(m, FE.Gear.clearLevel(game.player)))}</dd><dt>攻擊力</dt><dd>${m.atk}</dd>${st.length ? `<dt>狀態</dt><dd>${esc(st.join('、'))}</dd>` : ''}</dl>${T.desc ? `<p class="dim">${esc(T.desc)}</p>` : ''}<div class="dlg-opts"><button data-look="target,${m.x},${m.y}">設成目標</button></div>`;
    } else if (n) {
      const role = n.role === 'smith' ? (W.villageAt(n.x, n.y) && W.villageAt(n.x, n.y).kind === 'town' ? '武器匠' : '鐵匠') : n.role === 'armorer' ? '盔甲匠' : n.role === 'soldier' ? '士兵' : '村民';
      const race = FE.PLAYER_RACES[FE.npcRace(W, n)];
      const quest = handIn(n) ? '可以交件或回報' : n.quest && !n.quest.accepted && !n.quest.done ? '有委託可以接' : '';
      const home = W.villageById ? W.villageById(n.villageId) : null;
      el.innerHTML = `<p><b>${esc(n.name)}</b>　<span class="dim">${role}・${race ? race.name : ''}${home ? `・${esc(home.name)}` : ''}</span></p>${quest ? `<p>${quest}</p>` : ''}<div class="dlg-opts"><button data-look="talk,${n.x},${n.y}">走過去對話</button></div>`;
    } else {
      const b = FE.BIOMES[c.biome];
      el.innerHTML = `<p><b>${esc(b.name)}</b>　<span class="dim">高度 ${c.h}</span></p><p>${b.hit ? `站在這裡出手 ${b.hit > 0 ? '+' : ''}${b.hit}` : '站在這裡出手沒有加減'}</p>`;
    }
  }
  // 地圖上滑鼠的位置換成世界座標
  function cellAt(clientX, clientY) {
    const r = $('map').getBoundingClientRect();
    const cam = camera();
    const gx = Math.floor((clientX - r.left - ui.ox) / ui.cell);
    const gy = Math.floor((clientY - r.top - ui.oy) / ui.cell);
    if (gx < 0 || gy < 0 || gx >= ui.cols || gy >= ui.rows) return null;
    return { x: cam.x + gx, y: cam.y + gy };
  }

  const WINDOWS = {
    legend: null,
    quests: drawQuest,
    look: drawLook,
    backpack: drawBackpack,
    character: drawCharacter,
    history: drawHistory,
    messages: drawLogAll,
    reports: drawReports,
    minimap: () => { drawMinimap(); drawSteading(); }, // 第三十一版：小地圖與聚落資訊合在同一個視窗（M、I）
    settings: null,
  };

  function drawWindow() {
    $('overlay').classList.toggle('hidden', !ui.win);
    for (const name of Object.keys(WINDOWS)) $('win-' + name).classList.toggle('hidden', name !== ui.win);
    // 右上角圖示列：開著的視窗那顆亮起來
    document.querySelectorAll('#iconbar .ib').forEach((b) => b.classList.toggle('on', b.dataset.win === ui.win));
    if (ui.win && WINDOWS[ui.win]) WINDOWS[ui.win]();
  }

  function update() {
    drawMap();
    drawStatus();
    drawEffects();
    drawTarget();
    drawPlace();
    drawLog();
    drawDialog();
    drawWindow();
    drawModal();
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
      loadPalette();
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
    // 在聚落按 R：先開確認視窗（restAsk）；回傳 true 表示開了視窗，還沒休息
    askRest() {
      if (!game.world.villageAt(game.player.x, game.player.y)) return false;
      ui.restAsk = true;
      update();
      return true;
    },
    restAsking: () => !!ui.restAsk,
    cellAt,
    // 滑鼠右鍵查看那一格（開查看視窗）
    look(x, y) {
      ui.look = { x, y };
      FE.UI.openWindow('look');
    },
    closeRestAsk() {
      ui.restAsk = false;
      update();
    },
    // 開新世界時選職業與起始裝備：選完呼叫 done(職業, 挑的裝備)
    startMenu(done) {
      ui.start = { step: 'race', race: null, bonus: {}, height: 4, build: 4, cls: null, gi: 0, cur: 0, picks: [], sel: [], done };
      $('modal').classList.remove('hidden');
      drawStart();
    },
    // 建角畫面開著時是不是吃掉這個鍵（方向鍵移游標、Enter／Space 選、R 隨機、數字直接選、Esc 回上一步）；回傳 true 表示已經處理
    startKey(k) {
      const s = ui.start;
      if (!s) return false;
      const list = startList();
      if (k === 'escape' || k === 'backspace') startBack();
      else if (k === 'arrowup' || k === 'w') {
        s.cur = (s.cur + list.length - 1) % list.length;
        drawStart();
      } else if (k === 'arrowdown' || k === 's') {
        s.cur = (s.cur + 1) % list.length;
        drawStart();
      } else if (k === 'enter' || k === ' ') startChoose(list[s.cur]);
      else if (k === 'r') {
        // 擲體型那一步是重擲；其他步驟是隨機：從還沒選的裡面抽一樣，等於選下去
        if (s.step === 'body' || s.step === 'skills') startChoose('reroll');
        else {
          const open = list.filter((id) => !s.sel.includes(id));
          startChoose(open[Math.floor(Math.random() * open.length)]);
        }
      } else if (/^[1-9]$/.test(k)) {
        const i = Number(k) - 1;
        if (list[i]) startChoose(list[i]);
      }
      return true;
    },
    startClick(target) {
      if (!ui.start || !target.closest) return;
      const b = target.closest('[data-pick]');
      if (b) startChoose(b.dataset.pick);
    },
    // 滑鼠移到哪一行，游標就跟到哪一行
    startHover(target) {
      if (!ui.start || !target.closest) return;
      const b = target.closest('[data-i]');
      if (b && Number(b.dataset.i) !== ui.start.cur) {
        ui.start.cur = Number(b.dataset.i);
        drawStart();
      }
    },
    // 有沒有跳出必須先處理的視窗（選職業、升級加點）
    modal: () => !!ui.start || !!(game && game.player && game.player.points > 0),
    win: () => ui.win,
    bagDrop: () => ui.bagDrop,
    bagOff: () => ui.bagOff,
    toggleBagOff() {
      ui.bagOff = !ui.bagOff;
      update();
    },
    toggleBagDrop() {
      ui.bagDrop = !ui.bagDrop;
      update();
    },
    openWindow(name) {
      ui.win = name;
      if (name === 'backpack') ui.bagDrop = ui.bagOff = false;
      if (name === 'reports' && game.reports.length) FE.store.save('fe.reportSeen', reportId(game.reports[0]));
      update();
    },
    closeWindow() {
      ui.win = null;
      update();
    },
  };
})();
