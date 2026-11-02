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
            const cr = p.carrying;
            const carrying =
              cr && (cr.kind === 'hunt' ? cr.giverId === n.id && game.huntRemaining(cr.monsterIds) === 0 : cr.targetId === n.id);
            fg = P['map-npc'];
            if (carrying) bg = P['map-recipient'];
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
    const c = p.carrying;
    for (const ch of W.chests) dot(ch.x, ch.y, P['map-chest']);
    for (const n of W.npcs) {
      const target = c && (c.kind === 'hunt' ? c.giverId === n.id && game.huntRemaining(c.monsterIds) === 0 : c.targetId === n.id);
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
    // 名字與職業、時間（刻）、世界狀態、金幣，後面是戰鬥數字：攻擊力、物理／魔法減傷、閃避 %、格擋機率
    $('stName').innerHTML = `<b>${esc(p.name)}</b>（${esc(FE.Char.cls(p).name)}）`;
    $('stTime').textContent = `${game.ticks || 0} 刻`;
    const lvl = FE.Stability.state(game);
    $('stWorld').innerHTML = `世界 <b class="ws-${lvl}">${FE.Stability.names[lvl]}</b>`;
    $('stGold').textContent = `金幣 ${p.gold}`;
    const d = FE.Gear.playerDefense(p);
    $('stAtk').textContent = `傷害 ${game.attackText()}`;
    $('stPhys').textContent = `物理減傷 ${FE.Gear.physReduce(p)}`;
    $('stMagic').textContent = `魔法減傷 ${FE.Gear.magicReduce(p)}`;
    $('stDodge').textContent = `閃避 ${Math.round(d.dodge * 100)}%`;
    $('stBlock').textContent = `格擋 ${Math.round(d.block * 100)}%`;
    $('stLoad').textContent = game.loadTier() ? `超重 ${game.weight()} / ${game.carryLimit()}` : '';
    $('stLoad').classList.toggle('hidden', !game.loadTier());
    const n = unseenReports();
    $('reportBadge').classList.toggle('hidden', n === 0);
    $('reportBadge').textContent = `⚠${n}`;

    // 兩條整寬長條：生命；等級與經驗值（只顯示這一級的進度，創世門檻由創世神決定，不顯示）
    $('hpText').textContent = `生命 ${p.hp} / ${p.maxHp}`;
    setBar('hpFill', p.hp, p.maxHp);
    const lo = FE.levelExp(game.level);
    const hi = FE.levelExp(game.level + 1);
    $('cpText').textContent = `Lv ${game.level} 經驗 ${game.exp - lo} / ${hi - lo}`;
    setBar('cpFill', game.exp - lo, hi - lo);
  }

  // ---- 下方：狀態效果、目標、地點資訊、快捷列 ----

  // 怪物身上的狀態（倒地、削弱、侵擾），目標那一行與狀態效果用
  const monStates = (m) => [m.prone ? '倒地（下一回合不能動，打牠有優勢）' : '', m.sapped ? '削弱（下一次出手有劣勢）' : '', m.vexed ? '侵擾（你下一次打牠有優勢）' : ''].filter(Boolean);

  // 狀態效果：冒險者這邊的狀態（侵擾：你下一次打哪隻怪物有優勢）；沒有就寫「無」
  function drawEffects() {
    const vex = game.monsters.filter((m) => m.vexed && Math.abs(m.x - game.player.x) + Math.abs(m.y - game.player.y) <= C.SIGHT * 3);
    $('fxText').textContent = vex.length ? vex.map((m) => `侵擾：下一次打${m.name}有優勢`).join('　') : '無';
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
    // 快捷列：攻擊 <1>、重擊 <2>（冷卻中顯示剩幾回合、變暗）、撤退 <3>、射擊／施法 <F>、治療 <4>（牧師）、盾擊 <5>（戰士）
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
    };
    document.querySelectorAll('#quick .qs').forEach((b) => {
      b.disabled = !can[b.dataset.act];
    });
    document.querySelector('#quick [data-act="heal"]').classList.toggle('hidden', !cls.heal);
    document.querySelector('#quick [data-act="bash"]').classList.toggle('hidden', !cls.bash);
    document.querySelector('#quick [data-act="fire"] .qn').textContent = ranged && ranged.mode === 'spell' ? '施法' : ranged && ranged.mode === 'throw' ? '投擲' : '射擊';
    document.querySelector('#quick [data-act="deep"] .qcd').textContent = adj && cd > 0 ? `冷卻 ${cd}` : '';
    document.querySelector('#quick [data-act="heal"] .qcd').textContent = hcd > 0 ? `冷卻 ${hcd}` : '';
  }

  // 地點資訊（左下）：所在的聚落，或環境的簡短資訊
  function drawPlace() {
    const el = $('place');
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
      ${game.targetMonster() ? '' : '<p class="t-extra dim">旁邊沒有怪物。撞上怪物只會把牠設成目標，按 1 攻擊、2 重擊；拿弓箭、短刀、短矛（法師拿法杖）按 F 遠程出手。</p>'}`;
  }

  function drawQuest() {
    const c = game.player.carrying;
    let text = '任務：目前沒有。去找頭上帶紫底 & 的村民。';
    if (c && c.kind === 'hunt') {
      const left = game.huntRemaining(c.monsterIds);
      text = left
        ? `任務：清掉${c.village}附近的小怪物，還剩 ${left} / ${c.total} 隻（紫框）。獎勵 經驗值 ${c.exp}、金幣 ${game.questGold(c.gold)}`
        : `任務：小怪物都清掉了，回${c.village}找委託人（綠底的 &）領獎勵`;
    } else if (c) {
      const g = game.goodsFor(c);
      text = `任務：把${g ? g.name : '東西'}送到${c.targetVillage}的${c.targetName}${c.steps ? `（約 ${c.steps} 步）` : ''}，收貨人是綠底的 &。獎勵 經驗值 ${c.exp}、金幣 ${game.questGold(c.gold)}`;
    }
    $('questText').textContent = text;
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
      <p>負重 <b class="${tier ? 'over' : ''}">${game.weight()} / ${game.carryLimit()}</b>${
        tier === 1 ? '　超重：每個動作多 2 刻、出手 -1' : tier === 2 ? '　超重太多：不能移動、不能撤退、出手 -2，先丟掉東西' : ''
      }</p>
      <ul class="equipped">${slot('主手', p.equip.main)}${slot('副手', p.equip.off)}${slot('身上', p.equip.body)}</ul>
      <p><button data-dropmode class="${drop ? 'on' : ''}">${drop ? '現在是「丟掉」：選到的整疊直接消失（按 X 切回）' : '切到「丟掉」（X）'}</button>
      <button data-offmode class="${ui.bagOff ? 'on' : ''}">${ui.bagOff ? '現在武器放副手（雙持，按 V 切回）' : '武器改放副手（V）'}</button></p>
      <p class="dim">雙持：副手只能拿輕型武器（短刀）。按 1 攻擊會主手、副手各出手一次，副手那一下不加屬性修正值；沒有迅切時這個動作多花 5 刻。重擊只用主手。副手拿了短刀就不能拿盾牌；長槍、弓箭要用兩手。</p>`;
    $('backpack').innerHTML = list.length
      ? list
          .map((e, i) => {
            const can = drop ? e.id !== 'goods' : e.use;
            const act = drop ? '丟掉' : e.id === 'gear' ? (ui.bagOff && e.gear && FE.Gear.offOk(FE.Gear.def(e.gear)) ? '拿在副手' : '穿上或拿起') : '使用';
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
    return m ? `　精通${FE.MASTERIES[m].name}（${FE.MASTERIES[m].desc}）` : '';
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
    const effect = (id, lv) => {
      const mas = FE.GEAR[id] && FE.GEAR[id].mastery;
      const unlock = mas && !c.mastery ? (lv >= FE.MASTERY_SKILL ? `；精通${FE.MASTERIES[mas].name}` : `；${FE.MASTERY_SKILL} 級學會精通${FE.MASTERIES[mas].name}`) : '';
      if (id === 'bow') return `射擊的傷害 +${Math.floor(lv / C.SKILL_DMG_EVERY)}${unlock}`;
      if (id === 'shoot') return `射擊、投擲的命中 +${Math.floor(lv / C.SKILL_HIT_EVERY)}`;
      if (FE.SKILLS[id].weapon) return `近戰命中 +${Math.floor(lv / C.SKILL_HIT_EVERY)}、傷害 +${Math.floor(lv / C.SKILL_DMG_EVERY)}${id !== 'staff' && FE.GEAR[id].thrown ? '（投擲只加傷害）' : ''}${unlock}`;
      if (id === 'dodge') return `閃避機率 +${lv}%`;
      if (id === 'shield') return `格擋機率 +${lv * 2}%`;
      return lv >= 20 ? '中甲、重甲都不多花刻，重甲不再扣閃避' : lv >= 10 ? '中甲、重甲都不多花刻' : lv >= 5 ? '中甲不多花刻，重甲少 1 刻' : '中甲多 1 刻、重甲多 2 刻';
    };
    const skillRows = Object.keys(FE.SKILLS).map((id) => {
      const s = p.skills[id];
      const prog = s.lv >= C.SKILL_MAX ? '最高等級' : `${s.n} / ${Ch.skillNeed(s.lv)}`;
      return `<tr><td>${FE.SKILLS[id].name}</td><td><b>${s.lv}</b></td><td>${prog}</td><td class="dim">${effect(id, s.lv)}</td></tr>`;
    }).join('');
    const d = FE.Gear.playerDefense(p);
    const heal = Math.max(1, C.REST_HEAL + Ch.attrMod(p, 'con'));
    $('charInfo').innerHTML = `
      <p><b>${esc(p.name)}</b>　${esc(c.name)}　Lv${game.level}　經驗值 ${game.exp - lo} / ${hi - lo}${p.points > 0 ? `　<b class="over">還有 ${p.points} 點屬性沒加</b>` : ''}</p>
      <p>主手 ${p.equip.main ? esc(FE.Gear.name(p.equip.main)) : '空著'}　副手 ${p.equip.off ? esc(FE.Gear.name(p.equip.off)) : '空著'}${p.equip.off && FE.Gear.def(p.equip.off).cat === 'weapon' ? '（雙持）' : ''}　身上 ${p.equip.body ? esc(FE.Gear.name(p.equip.body)) : '空著'}</p>
      <p>生命 ${p.hp} / ${p.maxHp}　負重上限 ${game.carryLimit()}（目前 ${game.weight()}）　休息一次回復 ${heal}</p>
      <h3>屬性（修正值＝(屬性－10)÷2 無條件捨去，上限 ${C.ATTR_CAP}）</h3>
      <table class="stats"><tr><th>屬性</th><th>數值</th><th>修正值</th><th>用處</th></tr>${attrRows}</table>
      <h3>技能（用了就成長，0～${C.SKILL_MAX} 級）</h3>
      <table class="stats"><tr><th>技能</th><th>等級</th><th>到下一級</th><th>目前的效果</th></tr>${skillRows}</table>
      <h3>目前的數字</h3>
      <p>主手傷害 ${esc(game.attackText())}　近戰出手加減（不含地形與高處）${sign(FE.Gear.hitMod(p))}　暴擊 ${Ch.critMin(p, p.equip.main)}～20　攻擊一次 ${Ch.attackTicks(p, p.equip.main)} 刻${masteryLine()}　閃避 ${Math.round(d.dodge * 100)}%${d.blockMax ? `　格擋 ${Math.round(d.block * 100)}%、格擋值 ${d.blockMax}` : '　沒拿盾牌，不能格擋'}　向工匠買東西 ×${FE.Gear.buyFactor(game.chaMod()).toFixed(2)}、賣東西 ×${FE.Gear.sellFactor(game.chaMod()).toFixed(2)}</p>`;
  }

  // ---- 模態視窗：開新世界選職業與起始裝備、升級加點。開著的時候不能做別的事 ----
  // 選職業的畫面不需要遊戲（這時還沒有世界），選完才呼叫 onDone(職業, 挑的裝備)
  const classKeys = Object.keys(FE.CLASSES);
  function startGroups() {
    return FE.CLASSES[ui.start.cls].groups;
  }
  const optLabel = (id) => FE.START_OPTS[id].label;
  const signed = (n) => (n > 0 ? '+' : '') + n;
  // 目前這一步左欄的選項（職業，或這一組的起始裝備）
  const startList = () => (ui.start.step === 'class' ? classKeys : startGroups()[ui.start.gi].of);

  // 右欄：游標那一項的詳細內容。職業看屬性、生命、負重、說明；裝備看數值、重量、說明
  function startDetail(id) {
    if (ui.start.step === 'class') {
      const c = FE.CLASSES[id];
      const tmp = { cls: id, attr: c.attr };
      const attrs = FE.ATTRS.map((a) => `<dt>${a.name}</dt><dd>${c.attr[a.key]}（修正值 ${signed(FE.Char.mod(c.attr[a.key]))}）</dd>`).join('');
      return `<dl>${attrs}<dt>生命</dt><dd>${FE.Char.maxHp(tmp, 1)}</dd><dt>負重上限</dt><dd>${FE.Char.carryLimit(tmp)}</dd><dt>固定給</dt><dd>${c.fixed.length ? c.fixed.map(optLabel).join('、') : '沒有，裝備都自己挑'}</dd></dl><p>${esc(c.desc)}</p>`;
    }
    const o = FE.START_OPTS[id];
    let rows = '';
    if (o.gear) {
      const g = FE.Gear.make(o.gear, 0, 0);
      const d = FE.Gear.def(g);
      const stat = FE.Gear.statText(g).split('、').filter((t) => !t.startsWith('重 ')).join('、');
      rows = `<dt>種類</dt><dd>${d.cat === 'weapon' ? '武器' : d.cat === 'shield' ? '盾牌' : '防具'}</dd><dt>數值</dt><dd>${esc(stat || '無')}</dd><dt>重量</dt><dd>${d.weight}</dd>`;
    } else rows = `<dt>內容</dt><dd>${esc(o.label)}</dd>`;
    return `<dl>${rows}</dl><p>${esc(o.desc || '')}</p>`;
  }

  // 建角畫面（全螢幕）：左上角路徑、置中標題與副標、中間兩欄（左選項清單、右游標那一項的內容）、底部按鍵提示
  function drawStart() {
    const s = ui.start;
    const list = startList();
    if (s.cur >= list.length) s.cur = list.length - 1;
    const isClass = s.step === 'class';
    const g = isClass ? null : startGroups()[s.gi];
    const attr = isClass ? 'data-cls' : 'data-gear';
    const rows = list
      .map((id, i) => {
        const got = !isClass && s.sel.includes(id);
        const label = isClass ? FE.CLASSES[id].name : optLabel(id);
        return `<li ${attr}="${id}" data-i="${i}" class="${i === s.cur ? 'cur' : ''} ${got ? 'got' : ''}"><span class="mk">${i === s.cur ? '&gt;' : ''}</span><span class="box">${got ? '[■]' : '[ ]'}</span>${esc(label)}</li>`;
      })
      .join('');
    let note = '';
    let title = '職業';
    let path = '新世界';
    if (!isClass) {
      const c = FE.CLASSES[s.cls];
      const have = s.picks.map(optLabel);
      title = `起始裝備　第 ${s.gi + 1} / ${startGroups().length} 組`;
      path = `新世界 › ${c.name} › 起始裝備`;
      note = `${g.pick > 1 ? `這一組從 ${g.of.length} 樣裡挑 ${g.pick} 樣，挑到 ${g.pick} 樣就進下一組。` : `這一組 ${g.of.length} 樣挑 1 樣。`}${c.fixed.length ? `<br>固定給：${c.fixed.map(optLabel).map(esc).join('、')}` : ''}${have.length ? `<br>已挑：${have.map(esc).join('、')}` : ''}`;
    }
    const cur = list[s.cur];
    const curName = isClass ? FE.CLASSES[cur].name : optLabel(cur);
    $('modalBody').className = 'cc';
    $('modal').classList.add('full');
    $('modalBody').innerHTML = `
      <div class="cc-path">${esc(path)}</div>
      <h1>建立角色</h1>
      <div class="cc-sub">${isClass ? ':選職業:' : ':選起始裝備:'}</div>
      <div class="cc-cols">
        <div class="frame"><span class="ft">${esc(title)}</span><div class="fb"><ul class="cc-list">${rows}</ul>${note ? `<p class="cc-note">${note}</p>` : ''}</div></div>
        <div class="frame"><span class="ft">${esc(curName)}</span><div class="fb cc-detail">${startDetail(cur)}</div></div>
      </div>
      <div class="cc-keys">[Esc] 返回　[Enter／Space] 選擇　[R] 隨機　方向鍵移動　數字鍵直接選</div>`;
  }
  function startFinish() {
    const done = ui.start.done;
    const { cls, picks } = ui.start;
    ui.start = null;
    $('modal').classList.add('hidden');
    done(cls, picks);
  }
  function startChoose(id) {
    const s = ui.start;
    if (s.step === 'class') {
      s.cls = id;
      s.step = 'gear';
      s.gi = 0;
      s.cur = 0;
      s.picks = [];
      s.sel = [];
    } else {
      const g = startGroups()[s.gi];
      if (!g.of.includes(id)) return;
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
    if (s.step === 'class') return;
    if (s.sel.length) s.sel = [];
    else if (s.gi > 0) {
      s.gi--;
      s.picks = s.picks.filter((id) => !startGroups()[s.gi].of.includes(id));
    } else {
      s.step = 'class';
      s.cur = classKeys.indexOf(s.cls);
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

  function drawModal() {
    const open = !!ui.start || (game && game.player && game.player.points > 0);
    $('modal').classList.toggle('hidden', !open);
    if (!open) return;
    if (ui.start) drawStart();
    else drawLevelUp();
  }

  const WINDOWS = {
    legend: null,
    backpack: drawBackpack,
    character: drawCharacter,
    history: drawHistory,
    messages: drawLogAll,
    steading: drawSteading,
    reports: drawReports,
    minimap: drawMinimap,
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
    drawQuest();
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
    // 開新世界時選職業與起始裝備：選完呼叫 done(職業, 挑的裝備)
    startMenu(done) {
      ui.start = { step: 'class', cls: null, gi: 0, cur: 0, picks: [], sel: [], done };
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
        // 隨機：從還沒選的裡面抽一樣，等於選下去
        const open = list.filter((id) => !s.sel.includes(id));
        startChoose(open[Math.floor(Math.random() * open.length)]);
      } else if (/^[1-9]$/.test(k)) {
        const i = Number(k) - 1;
        if (list[i]) startChoose(list[i]);
      }
      return true;
    },
    startClick(target) {
      if (!ui.start || !target.closest) return;
      const b = target.closest('[data-cls],[data-gear]');
      if (b) startChoose(b.dataset.cls || b.dataset.gear);
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
