// 畫面層：只讀遊戲狀態、畫成 ASCII。地圖畫在 Canvas（滿版），其他是狀態列、下方列、對話視窗與按鍵視窗。
// 之後要換成圖塊，只改這一檔。
(function () {
  const C = FE.CONFIG;
  const $ = (id) => document.getElementById(id);
  const key = (x, y) => x + ',' + y;
  const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));
  let game = null;

  // 畫面狀態（不進存檔）：開著哪個視窗（小地圖也是視窗）、地圖的版面
  const ui = { win: null, bagIndex: null, bagDropConfirm: false, bagFilter: 'all', bagCollapsed: new Set(), bagOrder: [], bagScroll: false, shopSelection: null, shopContext: null, route: null, cell: 22, cols: 21, rows: 21, ox: 0, oy: 0, w: 0, h: 0, dpr: 1 };

  // ---- 配色：Canvas 畫的顏色全部讀 css/style.css 的變數，改色只改那裡 ----
  const P = {};
  const PAL_NAMES = [
    't-plain', 't-grass', 't-forest', 't-snow', 't-sand', 't-mount', 't-water', 't-rock', 't-stonewall', 't-woodwall', 't-house', 't-road', 't-market', 't-temple', 't-door', 't-bed', 't-furniture', 't-ruin', 't-relic',
    'void', 'hp', 'hp-mid', 'hp-low', 'bug', 'good', 'bad', 'world',
    'map-node-ore', 'map-node-herb', 'map-chest', 'map-item', 'map-ol-aim', 'map-aim-area', 'map-npc', 'map-smith', 'map-armorer', 'map-merchant', 'map-soldier', 'map-mate-fg', 'map-player-fg', 'map-player-bg',
    'map-mon-fg', 'map-mon-bg', 'map-mid-fg', 'map-mid-bg', 'map-boss-bg', 'map-glitch-fg', 'map-glitch-bg', 'map-ol-target', 'map-ol-hunt', 'map-ol-chase', 'map-walk', 'map-walk-bg',
    'map-h0', 'map-h1', 'map-h2', 'map-h3', 'map-h4', 'map-village', 'map-town', 'map-indoor', 'map-road', 'map-quest', 'map-recipient',
    'm-plain', 'm-grassland', 'm-shrubland', 'm-forest', 'm-taiga', 'm-tundra', 'm-glacier', 'm-jungle', 'm-savanna', 'm-desert', 'm-marsh', 'm-swamp', 'm-mountain', 'm-lake', 'm-rock',
    'm-stonewall', 'm-woodwall', 'm-building', 'm-village', 'm-town', 'm-relic', 'm-mon', 'm-boss', 'm-view', 'm-slot',
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
    // 建築的牆（第三十二版）：民房、神殿、市場與地貌的牆都照雙線接（門不算牆，牆在門口斷開，同 DF）
    const join = JOIN_WALLS[t] ? (o) => !!o && (!!JOIN_WALLS[o.t] || o.t === '▒') : (o) => !!o && o.t === t; // 窗也算牆
    const same = (dx, dy) => join(W.cell(x + dx, y + dy));
    const bits = (same(0, -1) ? 1 : 0) | (same(1, 0) ? 2 : 0) | (same(0, 1) ? 4 : 0) | (same(-1, 0) ? 8 : 0);
    return WALL_GLYPHS[JOIN_WALLS[t] ? 'W' : t][bits];
  }
  // 第三十二版：建築與地貌的牆畫成依相鄰的牆自動接起來的雙線框（照 Dwarf Fortress 砌好的牆）；地圖資料裡的代碼不變
  const JOIN_WALLS = { '⌂': 1, '∩': 1, '♦': 1, 'Θ': 1, '†': 1, 'Ω': 1 };
  // 畫面上的字元照 Dwarf Fortress〈Tilesets〉的用法（第三十二版）：地圖資料裡的代碼不變，只換畫出來的字。
  // 床 Θ、桌 ╤、櫃 π、鐵砧 σ（工坊的工作台）、祭壇 É、市場攤位 ■、巨石 ∞、立石 ■、墓碑換成石碑 ∩
  const SHOW = { '≡': 'Θ', 'π': '╤', '▌': 'π', '╤': 'σ', '¤': 'É', '#': '∞', 'Π': '■', '‡': '∩' };
  // 一格畫成什麼字：牆照相鄰自動接；門照 DF 木門 ║（城鎮與神殿用石門 ┼）；室內地板照 DF 砌好的地板 +；其他照 SHOW
  function showGlyph(W, x, y, c, vv, indoor) {
    if (WALL_GLYPHS[c.t] || JOIN_WALLS[c.t]) return wallGlyph(W, x, y, c.t);
    if (c.t === '+') return vv && vv.kind !== 'village' ? '┼' : '║'; // 城鎮、城市、堡壘、要塞都是石門（第三十四版）
    if (c.t === '.' && indoor) return '+';
    return SHOW[c.t] || c.t;
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
    const partyMap = new Map(game.party().filter((c) => c !== p).map((c) => [key(c.x, c.y), c])); // 隊伍裡沒被操作的那幾位
    const chests = new Map(W.chests.map((c) => [key(c.x, c.y), c]));
    // 地上的東西（擲出去的武器）
    const items = new Map(W.items.map((it) => [key(it.x, it.y), it]));
    // 採集點：採完還沒長回來的不畫（那一格就是普通地面）
    const nodes = new Map(W.nodes.filter((n) => !(n.regrowAt > (game.ticks || 0))).map((n) => [key(n.x, n.y), n]));
    const monsters = new Map(game.monsters.map((m) => [key(m.x, m.y), m]));
    const overlay = new Map();
    // 第三十三版之三（三）：錯的種類不再決定怪物，氣候錯位閃 * :、斷崖閃 ▲ ▼ 拿掉了；
    // 斷層照舊把走不到的區域畫淡、把要打通的路標出來（那是創世那處要修的錯，清光怪物時打通）
    for (const m of game.monsters) {
      if (m.type === 'UNREACHABLE') {
        for (const [x, y] of m.cells) overlay.set(key(x, y), { cls: 'faded' });
        for (const [x, y] of m.data.path) overlay.set(key(x, y), { cls: 'glitch' });
      }
    }
    const target = game.targetMonster();
    // 瞄準中的怪物（白框之外另一種顏色），範圍魔攻會波及的格子塗上底色
    const aimed = game.aimTarget();
    const area = new Set();
    if (aimed && (game.aim.mode === 'spell' || game.aim.mode === 'blast')) {
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

        const tcls = FE.TERRAIN[c.t].cls;
        let fg = P[tcls] || P['t-plain'];
        let bold = TERRAIN_BOLD.has(tcls);
        // 底色越亮越高；聚落、室內、路各有底色
        const vv = W.villageAt(x, y);
        const indoor = vv && FE.Steading.roomAt(vv, x, y) >= 0;
        let glyph = showGlyph(W, x, y, c, vv, indoor);
        if (c.t === '+' && W.isLocked(x, y)) glyph = '╫';
        let bg = c.t === '·' ? P['map-road'] : indoor ? P['map-indoor'] : vv ? (FE.Steading.townish(vv) ? P['map-town'] : P['map-village']) : P['map-h' + c.h] || P['map-h0'];
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
        const item = items.get(k);
        if (item) {
          glyph = item.trap ? (item.armed ? '^' : 'x') : ')';
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
          else if (n.role === 'merchant') fg = P['map-merchant'];
          else if (n.role === 'recruit') fg = P['map-mate-fg']; // 想找同伴的人（第三十六版之二）：用隊友的顏色
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
        // 隊友（與沒被操作的冒險者）：另一個顏色的 @，格子底下有血條
        const pm = partyMap.get(k);
        if (pm) {
          glyph = '@';
          fg = P['map-mate-fg'];
          bold = true;
          bg = baseBg;
          alpha = 1;
          hpPct = Math.round((pm.hp / pm.maxHp) * 100);
        }
        const m = monsters.get(k);
        if (m) {
          // 顯示種族的字母（第三十三版之二：異常種類只在世界底層，怪物身上不再閃異常的字元）
          const race = FE.RACES[m.race] || FE.RACES.goblin;
          glyph = race.glyph;
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
    // 第三十五版之三：滑鼠點出來、還沒出發的路線，畫在格子上面
    if (ui.route && ui.route.path.length) drawRoute(ctx, camX, camY);
  }

  // 路線預覽（第三十五版之三）：從冒險者連到目的地的虛線、目的地框，旁邊浮著「幾步・約幾刻」
  function drawRoute(ctx, camX, camY) {
    const r = ui.route;
    const S = ui.cell;
    const p = game.player;
    const cx = (x) => Math.round(ui.ox + (x - camX + 0.5) * S);
    const cy = (y) => Math.round(ui.oy + (y - camY + 0.5) * S);
    const [dx, dy] = r.path[r.path.length - 1];
    ctx.save();
    ctx.strokeStyle = P['map-walk'];
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(1, Math.round(S * 0.09));
    ctx.setLineDash([Math.max(3, Math.round(S * 0.22)), Math.max(2, Math.round(S * 0.16))]);
    ctx.beginPath();
    ctx.moveTo(cx(p.x), cy(p.y));
    for (const [x, y] of r.path) ctx.lineTo(cx(x), cy(y));
    ctx.stroke();
    // 目的地那一格框起來
    ctx.setLineDash([]);
    ctx.lineWidth = 2;
    ctx.strokeRect(Math.round(ui.ox + (dx - camX) * S) + 1, Math.round(ui.oy + (dy - camY) * S) + 1, S - 2, S - 2);
    ctx.restore();
    // 浮動的步數與刻數：放在目的地那一格上方，上方放不下就換到下面，左右與上下都不超出地圖
    const text = `${r.steps} 步・約 ${r.ticks} 刻`;
    const fs = Math.max(11, Math.min(16, Math.round(S * 0.6)));
    ctx.font = `${fs}px "Microsoft JhengHei", "Noto Sans TC", sans-serif`;
    const bw = ctx.measureText(text).width + 10;
    const bh = fs + 10;
    let bx = cx(dx) - bw / 2;
    let by = Math.round(ui.oy + (dy - camY) * S) - bh - 3;
    if (by < ui.oy) by = Math.round(ui.oy + (dy - camY + 1) * S) + 3;
    bx = clamp(bx, 2, Math.max(2, ui.w - bw - 2));
    by = clamp(by, 2, Math.max(2, ui.h - bh - 2));
    ctx.fillStyle = P['map-walk-bg'];
    ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = P['map-walk'];
    ctx.lineWidth = 1;
    ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
    ctx.fillStyle = P['map-walk'];
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, bx + bw / 2, by + bh / 2 + 0.5);
  }

  // 小地圖（M 開的視窗）：冒險者附近 MINIMAP_W×MINIMAP_H 格，一格畫成 S×S 像素；白框是主畫面看得到的範圍
  // 按生態區上色（顏色是 CSS 的 --m-生態區），巨石另外畫深色
  function shade(hex, h) {
    const n = parseInt(hex.slice(1), 16);
    const f = 0.75 + h * 0.08; // 越高越亮
    const ch = (s) => Math.min(255, Math.round(((n >> s) & 255) * f));
    return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
  }

  // 地圖（第三十二版重畫）：整個世界一次畫完（最大 288×288），一格幾像素照視窗放得下的整數倍；
  // 畫布照螢幕的實際像素畫（devicePixelRatio），不讓瀏覽器縮放，才不會糊。聚落與地貌標上名字；
  // 滑鼠移到哪裡，提示框寫那裡的地形、聚落、地貌、採集點與怪物；點聚落，下面的資訊換成那一座
  let mapView = null; // 最近一次畫的範圍與比例：{ x0, y0, S }
  function drawMinimap() {
    if (ui.win !== 'minimap') return;
    const cv = $('minimap');
    const W = game.world;
    const p = game.player;
    const b = W.bounds();
    const MW = b.x1 - b.x0;
    const MH = b.y1 - b.y0;
    const room = Math.max(200, ($('miniwrap').clientWidth || 680) - 4);
    // 照寬度決定（288 格寬是每格 2 像素）；比視窗高時視窗本身捲動，不再為了高度縮到每格 1 像素
    const S = Math.max(1, Math.min(6, Math.floor(room / MW), Math.max(2, Math.floor((window.innerHeight * 0.62) / MH))));
    const x0 = b.x0;
    const y0 = b.y0;
    mapView = { x0, y0, S };
    const dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(MW * S * dpr) || cv.height !== Math.round(MH * S * dpr)) {
      cv.width = Math.round(MW * S * dpr);
      cv.height = Math.round(MH * S * dpr);
      cv.style.width = MW * S + 'px';
      cv.style.height = MH * S + 'px';
      $('mapTip').classList.add('hidden'); // 地圖大小變了，舊的提示框位置不對
    }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = P.void; // 還沒創出來的地方
    ctx.fillRect(0, 0, MW * S, MH * S);
    for (let y = y0; y < y0 + MH; y++) {
      for (let x = x0; x < x0 + MW; x++) {
        const c = W.cell(x, y);
        if (!c) continue;
        const base = c.t === '#' ? P['m-rock'] : c.t === '█' ? P['m-mountain'] : P['m-' + c.biome] || '#444444'; // 山壁（第三十四版）畫山地的顏色
        const vv = W.villageAt(x, y);
        // 地貌上的人造物（斷牆、立石、塔⋯⋯）畫成土黃色
        const relic = /[▓░▒ΠΘ†Ω‡+¤≥≤]/.test(c.t);
        const building = /[⌂∩♦]/.test(c.t);
        const wall = c.t === 'W' || c.t === 'w';
        ctx.fillStyle = wall ? (c.t === 'W' ? P['m-stonewall'] : P['m-woodwall']) : building ? P['m-building'] : vv ? (FE.Steading.townish(vv) ? P['m-town'] : P['m-village']) : relic ? P['m-relic'] : shade(base, c.h);
        ctx.fillRect((x - x0) * S, (y - y0) * S, S, S);
      }
    }
    const px = (x) => (x - x0) * S + S / 2;
    const py = (y) => (y - y0) * S + S / 2;
    const dot = (x, y, color, size) => {
      const s2 = size || S;
      ctx.fillStyle = color;
      ctx.fillRect(px(x) - s2 / 2, py(y) - s2 / 2, s2, s2);
    };
    const big = Math.max(4, S + 2);
    for (const ch of W.chests) dot(ch.x, ch.y, P['map-chest'], Math.max(2, S));
    // 採集點：礦脈畫菱形、藥草畫小點，採完還沒長回來的不畫
    for (const nd of W.nodes) {
      if (nd.regrowAt > game.ticks) continue;
      if (nd.kind !== 'ore') { dot(nd.x, nd.y, P['map-node-herb'], Math.max(2, S)); continue; }
      const r = big / 2 + 1;
      ctx.fillStyle = P['map-node-ore'];
      ctx.beginPath();
      ctx.moveTo(px(nd.x), py(nd.y) - r); ctx.lineTo(px(nd.x) + r, py(nd.y)); ctx.lineTo(px(nd.x), py(nd.y) + r); ctx.lineTo(px(nd.x) - r, py(nd.y));
      ctx.closePath();
      ctx.fill();
    }
    for (const it of W.items) dot(it.x, it.y, P['map-item'], Math.max(2, S));
    for (const d of W.locks) dot(d.x, d.y, P['map-item'], Math.max(2, S));
    for (const n of W.npcs) {
      const target = handIn(n);
      dot(n.x, n.y, target ? P.good : n.role === 'smith' ? P['map-smith'] : n.role === 'armorer' ? P['map-armorer'] : n.role === 'merchant' ? P['map-merchant'] : n.role === 'recruit' ? P['map-mate-fg'] : P['map-npc'], target ? big : Math.max(2, S));
    }
    for (const sd of game.soldiers) dot(sd.x, sd.y, P['map-soldier'], Math.max(2, S));
    for (const c of game.party()) if (c !== p) dot(c.x, c.y, P['map-mate-fg'], Math.max(3, S + 1));
    for (const m of game.monsters) dot(m.x, m.y, m.tier !== 'small' ? P['m-boss'] : P['m-mon'], m.tier !== 'small' ? big : Math.max(3, S + 1));
    // 冒險者：白點加深色外框，一眼找得到
    ctx.fillStyle = '#000';
    ctx.fillRect(px(p.x) - big / 2 - 1, py(p.y) - big / 2 - 1, big + 2, big + 2);
    dot(p.x, p.y, P['map-player-fg'], big);
    const cam = camera();
    ctx.strokeStyle = P['m-view'];
    ctx.lineWidth = 1;
    ctx.strokeRect((cam.x - x0) * S + 0.5, (cam.y - y0) * S + 0.5, C.VIEW_W * S - 1, C.VIEW_H * S - 1);
    // 下一段會長在哪：這一圈裡離冒險者最近的那一邊，用虛線框標出來
    const slot = W.nextSegmentRect(p.x, p.y);
    if (slot) {
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = P['m-slot'];
      ctx.strokeRect((slot.x0 - x0) * S + 0.5, (slot.y0 - y0) * S + 0.5, (slot.x1 - slot.x0) * S - 1, (slot.y1 - slot.y0) * S - 1);
      ctx.setLineDash([]);
    }
    // 名字：聚落寫在上方（點選中的那一座框起來），地貌寫在下方；字有深色描邊，壓在地形上也看得清
    // 名字疊到先寫的名字時，往下挪到不疊為止
    const placed = [];
    const label = (text, x, y, color, size) => {
      ctx.font = `${size}px sans-serif`;
      const w = ctx.measureText(text).width + 4;
      const hit = () => placed.some((r) => Math.abs(r.x - x) * 2 < r.w + w && Math.abs(r.y - y) < size + 2);
      for (let i = 0; i < 6 && hit(); i++) y += size + 2;
      placed.push({ x, y, w });
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.strokeText(text, x, y);
      ctx.fillStyle = color;
      ctx.fillText(text, x, y);
    };
    for (const v of W.villages) {
      if (v.id === ui.mapSel) {
        ctx.strokeStyle = P['map-player-fg'];
        ctx.strokeRect((v.x0 - x0) * S - 1.5, (v.y0 - y0) * S - 1.5, (v.x1 - v.x0 + 1) * S + 3, (v.y1 - v.y0 + 1) * S + 3);
      }
      label(v.name, ((v.x0 + v.x1 + 1) / 2 - x0) * S, (v.y0 - y0) * S - 7, FE.Steading.townish(v) ? '#e0b0ff' : '#ffe08a', 12);
    }
    for (const l of W.landmarks) label(l.name, ((l.x0 + l.x1 + 1) / 2 - x0) * S, (l.y1 + 1 - y0) * S + 7, '#e8c890', 11);
  }

  // 地圖上某一格的大概狀況（滑鼠提示用）：沒創出來的地方寫明；其他寫地形、聚落、地貌、採集點、附近的怪物
  function mapCellInfo(x, y) {
    const W = game.world;
    const c = W.cell(x, y);
    const slot = W.nextSegmentRect(game.player.x, game.player.y);
    const inSlot = slot && x >= slot.x0 && x < slot.x1 && y >= slot.y0 && y < slot.y1;
    if (!c) return inSlot ? '還沒創出來（下一段會長在這裡）' : '還沒創出來';
    const out = [];
    const B = FE.BIOMES[c.biome];
    out.push(`<b>${esc(B ? B.name : c.biome)}</b>　高度 ${c.h}${c.t === '≈' ? '，水' : c.t === '#' ? '，巨石' : c.t === '█' ? '，山壁' : ''}`);
    const v = W.villageAt(x, y) || W.villages.find((o) => x >= o.x0 - 2 && x <= o.x1 + 2 && y >= o.y0 - 2 && y <= o.y1 + 2);
    if (v) out.push(`${esc(v.name)}（${FE.SETTLE_KINDS[v.kind]}${v.steading ? `，${FE.PROSPERITY[v.steading.prosperity]}、${FE.POPULATION[v.steading.population]}` : ''}）<span class="dim">點一下看詳細</span>`);
    const l = W.landmarkAt(x, y);
    if (l) out.push(esc(l.name));
    const near = (o, r) => Math.abs(o.x - x) <= r && Math.abs(o.y - y) <= r;
    const nodes = W.nodes.filter((n) => near(n, 1) && !(n.regrowAt > game.ticks));
    if (nodes.some((n) => n.kind === 'ore')) out.push('礦脈（要礦鎬）');
    if (nodes.some((n) => n.kind === 'herb')) out.push('藥草（要鐮刀）');
    if (W.isLocked(x, y)) out.push('上鎖的門');
    const item = W.itemsAt(x, y)[0];
    if (item && item.trap) out.push(`${FE.BAG_ITEMS[item.trap].name}${item.armed ? '（已布置）' : '（已觸發，可收起）'}`);
    const ms = game.monsters.filter((m) => near(m, 2));
    if (ms.length) {
      const names = {};
      for (const m of ms) names[m.name] = (names[m.name] || 0) + 1;
      out.push('怪物：' + Object.entries(names).map(([n, k]) => (k > 1 ? `${esc(n)} ×${k}` : esc(n))).join('、'));
    }
    if (inSlot) out.push('<span class="dim">下一段會長在這一帶</span>');
    if (x === game.player.x && y === game.player.y) out.push('你在這裡');
    return out.join('<br>');
  }
  const mapCellAt = (e) => {
    if (!mapView) return null;
    const r = $('minimap').getBoundingClientRect();
    return { x: mapView.x0 + Math.floor((e.clientX - r.left) / mapView.S), y: mapView.y0 + Math.floor((e.clientY - r.top) / mapView.S) };
  };
  function bindMap() {
    const cv = $('minimap');
    const tip = $('mapTip');
    cv.addEventListener('mousemove', (e) => {
      const at = mapCellAt(e);
      if (!at || !game) return;
      tip.innerHTML = mapCellInfo(at.x, at.y);
      tip.classList.remove('hidden');
      const wrap = $('miniwrap').getBoundingClientRect();
      const left = e.clientX - wrap.left + 14;
      tip.style.left = Math.min(left, wrap.width - tip.offsetWidth - 4) + 'px';
      tip.style.top = e.clientY - wrap.top + 14 + 'px';
    });
    cv.addEventListener('mouseleave', () => tip.classList.add('hidden'));
    cv.addEventListener('click', (e) => {
      const at = mapCellAt(e);
      if (!at || !game) return;
      const W = game.world;
      const v = W.villageAt(at.x, at.y) || W.villages.find((o) => at.x >= o.x0 - 2 && at.x <= o.x1 + 2 && at.y >= o.y0 - 2 && at.y <= o.y1 + 2);
      // 第三十七版：點聚落切到聚落頁看它的資訊；點空地什麼都不做
      if (!v) return;
      ui.mapSel = v.id;
      ui.win = 'steading';
      update();
    });
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
    $('stName').innerHTML = `<b>${esc(p.name)}</b>（${esc(FE.Char.cls(p).name)}${p === game.hero ? '' : `，隊友 Lv${p.lv}`}）`;
    $('stTime').textContent = FE.clockText(game.ticks);
    const lvl = FE.Stability.state(game);
    $('stWorld').innerHTML = `世界 <b class="ws-${lvl}">${FE.Stability.names[lvl]}</b>${game.veil ? '<span class="dim">（怪物遮蔽）</span>' : ''}`; // 怪物遮蔽中（第三十四版）在狀態列標出來
    $('stGold').textContent = FE.money(game.hero.copper);
    const d = FE.Gear.playerDefense(p);
    $('stAtk').textContent = `傷害 ${game.attackText()}`;
    $('stPhys').textContent = `物理減傷 ${FE.Gear.physReduce(p)}`;
    $('stMagic').textContent = `魔法減傷 ${FE.Gear.magicReduce(p)}`;
    // 第三十三版：AC（含法術的加護）寫在閃避前面
    // （加護照 game.wardAC 的規則算，但不叫它：它會順手結束穿了防具的魔法防禦）
    const ward = p.ward && !(FE.SPELLS[p.ward.id].unarmored && game.armored()) ? p.ward.ac : 0;
    $('stDodge').textContent = `AC ${FE.Gear.playerAC(p) + ward}　閃避 ${Math.round(d.dodge * 100)}%`;
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
    const who = p === game.hero ? '' : '冒險者 ';
    if (game.level >= C.LEVEL_MAX) {
      $('cpText').textContent = `${who}Lv ${game.level} 經驗 ${game.exp}（最高等級）`;
      setBar('cpFill', 1, 1);
    } else {
      $('cpText').textContent = `${who}Lv ${game.level} 經驗 ${game.exp - lo} / ${hi - lo}`;
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
    const wd = game.player.ward;
    if (wd) fx.push(`${FE.SPELLS[wd.id].name}：怪物出手 −${wd.ac}${wd.hp ? `、生命上限 +${wd.hp}` : ''}，還剩 ${Math.max(0, Math.ceil((wd.until - game.ticks) / 100))} 小時${wd.hits != null ? `或被打中 ${wd.hits} 次` : ''}`);
    if (ex) fx.push(`力竭 ${ex}：出手 −${C.EXHAUST_D20 * ex}，走路慢 ${Math.round((FE.Char.exhaustMoveMul(game.player) - 1) * 100)}%`);
    $('fxText').textContent = fx.length ? fx.join('　') : '無';
  }

  // 底部顯示的目標：瞄準中的、貼著的目前目標、長槍打得到的、還纏著你的那隻
  function focusMonster() {
    return game.aimTarget() || game.targetMonster() || game.reachTarget() || game.monsters.find((m) => m.id === game.battle.targetId) || null;
  }

  // 目標那一行：目前的目標（名字、血條、生命，後面是狀態與體型）；瞄準中多寫距離與按鍵；沒有就寫「無」
  function drawTarget() {
    const p = game.player;
    const m = focusMonster();
    if (m) {
      const st = monStates(m);
      let aim = '';
      if (game.aim && m === game.aimTarget()) {
        const r = game.rangedMode(true);
        const d = Math.max(Math.abs(m.x - p.x), Math.abs(m.y - p.y)); // 八方向：斜的算 1 格（第三十五版之四）
        const far = r && d > r.range[0];
        aim = `<span class="aim">瞄準（${game.aim.i + 1}/${game.aim.ids.length}）距離 ${d} 格${far ? '，超出正常射程（劣勢）' : ''}${game.adjacentMonsters().length ? '，貼著怪物（劣勢）' : ''}：Tab 換目標，F 或 Enter 出手，Esc 取消</span>`;
      }
      $('tgtText').innerHTML = `<span class="tname">${esc(m.name)}</span><span class="t-hp"><span class="bar"><i style="width:${Math.round((m.hp / m.maxHp) * 100)}%"></i></span>生命 ${m.hp} / ${m.maxHp}</span>${aim}${st.length ? `<span class="t-state">${esc(st.join('、'))}</span>` : ''}<span class="dim t-extra">體型 ${FE.sizeName(m)}　AC ${m.ac}</span>`;
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
    if (game.spellsOf().length) document.querySelector('#quick [data-act="fire"]').classList.remove('hidden');
    document.querySelector('#quick [data-act="fire"]').disabled = false;
    document.querySelector('#quick [data-act="fire"] .qn').textContent = game.spellsOf().length ? '施法' : ranged && ranged.mode === 'spell' ? '施法' : ranged && ranged.mode === 'light' ? '神聖之光' : ranged && ranged.mode === 'throw' ? '投擲' : '射擊';
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
      $('stPlace').textContent = `${v.name}・${FE.SETTLE_KINDS[v.kind]}（安全區）`;
      return;
    }
    const b = FE.BIOMES[W.cell(p.x, p.y).biome];
    const lm = W.landmarkAt(p.x, p.y);
    $('stPlace').textContent = `${b.name}${lm ? '・' + lm.name : ''}（出手 ${b.hit > 0 ? '+' : ''}${b.hit || 0}）`;
  }

  // 這個村民現在可以交件或回報（地圖上綠底、小地圖上大綠點）：清完了的清除委託的委託人、送貨的收貨人、採藥採礦湊夠了的委託人
  function handIn(n) {
    const j = game.hero.jobs;
    if (j.hunt && j.hunt.giverId === n.id && game.huntRemaining(j.hunt.monsterIds) === 0) return true;
    if (j.deliver && j.deliver.targetId === n.id) return true;
    return ['herb', 'ore'].some((k) => j[k] && j[k].giverId === n.id && game.bagCount(k) >= j[k].n);
  }

  // 委託視窗（Q，第三十一版從右側欄搬進視窗）：手上的委託，有的才列
  function drawQuest() {
    const j = game.hero.jobs;
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

  // 隊員欄（第三十六版之一，照 Blood & Chaos 的做法）：右側訊息欄上方，每位隊員一行：名字、職業、等級、生命條；正在操作的那位標出來，點一下就換成操作他（Tab 也行）。沒有隊友就不顯示
  function drawParty() {
    const el = $('party');
    const list = game.party();
    el.classList.toggle('hidden', list.length < 2);
    if (list.length < 2) {
      el.innerHTML = '';
      return;
    }
    el.innerHTML = list
      .map((c, i) => {
        const lv = c === game.hero ? game.level : c.lv;
        const pct = Math.max(0, Math.min(100, Math.round((c.hp / c.maxHp) * 100)));
        const cls = pct <= 25 ? 'low' : pct <= 50 ? 'mid' : '';
        return `<button class="pm${c === game.player ? ' on' : ''}" data-party="${i}" title="點一下換成操作${esc(c.name)}（Tab 換下一位）"><span class="pm-name">${c === game.player ? '▶ ' : ''}${esc(c.name)}</span><span class="pm-cls">${esc(FE.Char.cls(c).name)} Lv${lv}${c !== game.hero && c.points > 0 ? `<b class="over" title="有 ${c.points} 點屬性沒加，按 C 在角色視窗裡加"> ＋${c.points}</b>` : ''}</span><span class="pm-bar ${cls}"><i style="width:${pct}%"></i></span><span class="pm-hp">${c.hp}/${c.maxHp}</span></button>`;
      })
      .join('');
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
      ui.shopSelection = null;
      ui.shopContext = null;
      el.classList.add('hidden');
      return;
    }
    const shop = FE.Gear.shopOf(npc, game.world.villageById(npc.villageId));
    if (ui.shopContext !== npc.id) {
      ui.shopContext = npc.id;
      ui.shopSelection = null;
    }
    if (shop && (!game.talkPage || game.talkPage === 'main')) game.talkPage = 'buy';
    const page = game.talkPage || 'main';
    const family = shop ? ['buy', 'sell', 'repair', 'craft'].find((name) => page === name) : null;
    const t = game.talkOptions(npc);
    const trade = (o) => /^(buyItem|sellItem|repairItem|craftItem):/.test(o.id) || o.id === 'sellOre' || o.id === 'sellHerb';
    if (!shop || !family || (ui.shopSelection && (ui.shopSelection.page !== page || ui.shopSelection.npcId !== npc.id))) ui.shopSelection = null;
    const selected = ui.shopSelection && t.options.find((o) => o.id === ui.shopSelection.id);
    if (ui.shopSelection && !selected) ui.shopSelection = null;
    const items = shop ? t.options.map((o, i) => ({ o, i })).filter(({ o }) => trade(o)) : [];
    const actions = shop ? t.options.map((o, i) => ({ o, i })).filter(({ o }) => !trade(o)) : t.options.map((o, i) => ({ o, i }));
    const tabsOf = shop ? FE.Gear.SHOPS[shop].tabs || ['buy', 'sell', 'repair', 'craft'] : [];
    const tabs = shop && family
      ? `<nav class="shop-tabs" aria-label="工匠服務">${tabsOf
          .map((tab) => `<button data-shop-tab="${tab}" class="${family === tab ? 'on' : ''}">${{ buy: '買', sell: '賣', repair: '修理', craft: '打造' }[tab]}</button>`)
          .join('')}</nav>`
      : '';
    const balance = shop
      ? `<div class="shop-balance">持有 ${FE.money(game.player.copper)}　｜　${shop === 'merchant' ? `藥草 ${game.bagCount('herb')} 份` : `礦石 ${game.bagCount('ore')} 顆`}</div>`
      : '';
    const grid = items.length
      ? `<div class="shop-grid">${items
          .map(
            ({ o, i }) =>
              `<button class="shop-slot${o.disabled ? ' short' : ''}${selected && selected.id === o.id ? ' selected' : ''}" data-shop-item="${i}" title="${esc(`${o.label}：${o.info || o.note || ''}`)}"><span class="shop-slot-name">${esc(o.label)}</span><span class="shop-slot-note">${esc(o.note || '')}</span></button>`
          )
          .join('')}</div>`
      : family
        ? `<p class="shop-empty">${family === 'buy' ? '目前沒有可購買的物品。' : family === 'sell' ? (shop === 'merchant' ? '沒有藥草可以賣。' : '沒有可出售的裝備或礦石。') : family === 'repair' ? '沒有需要修理的裝備。' : '目前沒有可打造的裝備。'}</p>`
        : '';
    const detail = selected
      ? `<section class="shop-detail"><h3>${esc(selected.label)}</h3><p>${esc(selected.info || selected.note || '')}</p><div class="shop-detail-actions"><button data-shop-confirm ${selected.disabled ? 'disabled' : ''}>${selected.id === 'sellOre' || selected.id === 'sellHerb' ? '賣出' : { buyItem: '購買', sellItem: '賣出', repairItem: '修理', craftItem: '打造' }[selected.id.split(':')[0]]}</button><button data-shop-cancel>取消</button></div></section>`
      : '';
    const content = selected
      ? `<div class="shop-content has-selection">${detail}${grid}</div>`
      : `<div class="shop-content">${grid}</div>`;
    const nav = !shop && actions.length
      ? `<div class="dlg-opts shop-nav">${actions
          .map(
            ({ o, i }) =>
              `<button data-opt="${i}" ${o.disabled ? 'disabled' : ''}><kbd>${i + 1}</kbd>${esc(o.label)}${o.note ? ` <span class="dim">（${esc(o.note)}）</span>` : ''}</button>`
          )
          .join('')}</div>`
      : '';
    el.classList.remove('hidden');
    el.classList.toggle('shop-dialog', !!shop);
    el.innerHTML = shop
      ? `<div class="dlg-head"><b>${esc(t.name)}</b><span class="dim">${esc(t.role)}｜${esc(t.village)}</span></div>
        <div class="dlg-body"><p class="dlg-text">${esc(t.text)}</p>
        <header class="shop-head"><b>交易</b><button data-shop-close>離開</button></header>${tabs}${balance}${content}<p class="dim dlg-hint">${selected ? '確認交易或取消' : '點選商品查看資訊'}</p></div>`
      : `<div class="dlg-head"><b>${esc(t.name)}</b><span class="dim">${esc(t.role)}｜${esc(t.village)}</span></div>
        <div class="dlg-body"><p class="dlg-text">${esc(t.text)}</p>
        <div class="dlg-opts">${t.options
          .map(
            (o, i) =>
              `<button data-opt="${i}" ${o.disabled ? 'disabled' : ''}><kbd>${i + 1}</kbd>${esc(o.label)}${o.note ? ` <span class="dim">（${esc(o.note)}）</span>` : ''}</button>`
          )
          .join('')}</div>
        <p class="dim dlg-hint">按數字鍵選擇，Esc 關閉</p></div>`;
  }

  // ---- 按鍵視窗：同時只開一個 ----

  // 日誌（第三十七版，原本的世界歷史紀錄）：歷史紀錄，加上你到過的聚落與發現的地貌（照第幾天排，新的在上面）
  function drawJournal() {
    const W = game.world;
    const places = W.villages
      .filter((v) => v.visitDay)
      .map((v) => ({ day: v.visitDay, text: `到了${v.name}（${FE.SETTLE_KINDS[v.kind]}）` }))
      .concat(W.landmarks.filter((l) => l.found).map((l) => {
        const v = W.villageById(l.villageId);
        return { day: l.foundDay || 0, text: `發現了${v ? v.name + '附近的' : ''}${l.name}` };
      }))
      .sort((a, b) => b.day - a.day);
    $('journal').innerHTML = `<h3 style="margin-top:0">世界的歷史紀錄</h3><ol id="history"></ol>
      <h3>到過的地方</h3><ol class="journal-places">${places.length ? places.map((x) => `<li>${x.day ? `第 ${x.day} 天，` : ''}${esc(x.text)}</li>`).join('') : '<li class="dim">還沒有記下任何地方。</li>'}</ol>`;
    drawHistory();
  }

  function drawHistory() {
    const list = game.history.filter((h) => h.seed === game.seed);
    $('history').innerHTML = list.length
      ? list
          .map((h) =>
            h.kind === 'death'
              ? `<li>${esc(h.time)}｜第 ${h.day} 天，${esc(h.village)}的${esc(h.role)}${esc(h.name)}（${esc(h.cls)}）在${esc(h.where)}陣亡</li>`
              : h.kind === 'campaign'
              ? `<li>${esc(h.time)}｜第 ${h.seg} 段戰役（${esc(h.place)}，第 ${h.day} 天出現、第 ${h.cleared} 天清光）：${esc(h.player)}清除了${esc(h.content)}</li>`
              : `<li>${esc(h.time)}｜${esc(h.player)}擊敗了${esc(h.bug)}（第 ${h.chunk} 塊世界，影響 ${h.scope} 格）</li>`
          )
          .join('')
      : '<li class="dim">還沒有清光的戰役。</li>';
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
    const role = (n) => (n.role === 'smith' ? (FE.Steading.shopTown(v) ? '武器匠，' : '鐵匠，') : n.role === 'armorer' ? '盔甲匠，' : n.role === 'merchant' ? '商人，' : n.role === 'soldier' ? `士兵・${FE.Char.cls(n).name}，` : n.role === 'recruit' ? `${FE.RECRUIT_BACKGROUNDS[n.bg].name}・${FE.Char.cls(n).name}，` : '');
    const list = game.world.npcs.filter((n) => n.villageId === v.id).concat(game.soldiers.filter((s) => s.villageId === v.id));
    return list.map((n) => `${n.name}（${role(n)}${FE.PLAYER_RACES[FE.npcRace(game.world, n)].name}）`).join('、') || '沒有人';
  }

  // 聚落頁（第三十七版）：左邊列出世界上的聚落（你在的、最近的排前面），右邊是選中那座的資訊；
  // 沒選過就看所在的聚落，不在聚落裡看最近的那一座。在地圖上點聚落也會切到這一頁並選中它
  function drawSteadingPage() {
    const W = game.world;
    const p = game.hero || game.player;
    const dist = (a) => Math.abs(a.cx - p.x) + Math.abs(a.cy - p.y);
    const here = W.villageAt(p.x, p.y);
    const list = W.villages.filter((v) => v.steading).sort((a, b) => (a === here ? -1 : b === here ? 1 : dist(a) - dist(b)));
    if (ui.mapSel == null || !W.villageById(ui.mapSel)) ui.mapSel = list[0] ? list[0].id : null;
    const done = (p.done || {});
    const recruits = (v) => W.npcs.filter((n) => n.role === 'recruit' && n.villageId === v.id).length;
    $('steadingList').innerHTML = list
      .map((v) => {
        const sub = [FE.SETTLE_KINDS[v.kind], FE.PROSPERITY[v.steading.prosperity], v === here ? '你在這裡' : game.directionTo({ x0: v.cx, x1: v.cx + 1, y0: v.cy, y1: v.cy + 1 })];
        const extra = `${done[v.id] ? `完成委託 ${done[v.id]} 件` : ''}${recruits(v) ? `${done[v.id] ? '，' : ''}有人想找同伴` : ''}`;
        return `<li><button class="${v.id === ui.mapSel ? 'on' : ''}" data-steading="${v.id}">${esc(v.name)}<span class="st-sub">${esc(sub.join('・'))}</span>${extra ? `<span class="st-sub">${esc(extra)}</span>` : ''}</button></li>`;
      })
      .join('') || '<li class="dim">還沒有聚落。</li>';
    drawSteading();
  }

  // 聚落資訊：選中的聚落（ui.mapSel），沒有就看所在的聚落，不在聚落裡就是離冒險者最近的那一座
  function drawSteading() {
    const el = $('steading');
    const W = game.world;
    const p = game.player;
    const picked = ui.mapSel != null ? W.villageById(ui.mapSel) : null;
    let v = picked || W.villageAt(p.x, p.y);
    const inside = !picked && !!v;
    if (!v) {
      const dist = (a) => Math.abs(a.cx - p.x) + Math.abs(a.cy - p.y);
      v = W.villages.slice().sort((a, b) => dist(a) - dist(b))[0];
    }
    if (!v || !v.steading) {
      el.innerHTML = '<p class="dim">附近還沒有聚落。</p>';
      return;
    }
    const doneHere = ((game.hero && game.hero.done) || {})[v.id] || 0;
    const waiting = W.npcs.filter((n) => n.role === 'recruit' && n.villageId === v.id);
    const s = v.steading;
    const lm = W.landmarks.find((l) => l.villageId === v.id);
    const lmText = lm ? `${lm.name}，在${game.directionTo({ x0: lm.x0, x1: lm.x1 + 1, y0: lm.y0, y1: lm.y1 + 1 })}` : '沒有';
    const tags = FE.Steading.describe(W, v)
      .map((t) => `<li><b>${esc(t.text)}</b><span class="dim">　${esc(t.info)}</span></li>`)
      .join('');
    el.innerHTML = `
      <h3 style="margin-top:0">${esc(v.name)}（${FE.SETTLE_KINDS[v.kind]}）${inside || W.villageAt(p.x, p.y) === v ? '' : `<span class="dim">　你不在這裡，在${esc(game.directionTo({ x0: v.cx, x1: v.cx + 1, y0: v.cy, y1: v.cy + 1 }))}</span>`}</h3>
      <div class="row"><span>經濟</span><span>${FE.PROSPERITY[s.prosperity]}（裝備售價 ×${FE.Steading.shopFactor(v).toFixed(2)}）</span></div>
      <div class="row"><span>住一晚</span><span>${FE.money(C.LIVING_COST[s.prosperity] * C.SILVER)}（${FE.PROSPERITY[s.prosperity]}的生活，力竭降低 ${C.LIVING_EXHAUSTION[s.prosperity]} 級${C.LIVING_REPAIR[s.prosperity] ? `，裝備耐久回 ${Math.round(C.LIVING_REPAIR[s.prosperity] * 100)}%` : ''}${C.LIVING_QUEST[s.prosperity] ? `，這裡的委託獎勵 +${Math.round(C.LIVING_QUEST[s.prosperity] * 100)}%` : ''}）</span></div>
      <div class="row"><span>人口</span><span>${FE.POPULATION[s.population]}</span></div>
      <div class="row"><span>你完成的委託</span><span>${doneHere} 件${doneHere < C.RECRUIT_JOBS ? `（再 ${C.RECRUIT_JOBS - doneHere} 件起，這裡可能會來想找同伴的人）` : '（每再完成一件，這裡可能會來想找同伴的人）'}</span></div>
      <div class="row"><span>想找同伴的人</span><span>${waiting.length ? esc(waiting.map((n) => `${n.name}（${FE.RECRUIT_BACKGROUNDS[n.bg].name}・${FE.Char.cls(n).name}）`).join('、')) : '沒有'}</span></div>
      <div class="row"><span>居民</span><span>${esc(residents(v))}</span></div>
      <div class="row"><span>由來</span><span>${esc(s.option)}；${esc(s.problem)}</span></div>
      <ul class="tags">${tags}</ul>
      <div class="row"><span>附近的地貌</span><span>${esc(lmText)}</span></div>`;
  }

  // 背包：上面是目前的負重和穿著的裝備，下面選物品後在資訊區操作
  function drawBackpack() {
    const p = game.player;
    const G = FE.Gear;
    const list = game.bagList();
    if (ui.bagIndex != null && !list[ui.bagIndex]) {
      ui.bagIndex = null;
      ui.bagDropConfirm = false;
    }
    const selected = ui.bagIndex == null ? null : list[ui.bagIndex];
    const tier = game.loadTier();
    // 第三十七版：裝備格照人形排（上排主手、身上、副手，下排礦鎬、鐮刀），只放真的有用的五格（原本保留的六格空位不畫）。
    // 每格高 72px：欄位名與 14px 圖示同一列，物品名稱最多兩行，耐久單行（放不下就省略）；點一下卸下（算一個動作）
    const slot = (key, label, icon, g) =>
      `<button class="eq-slot eqs-${key}" data-unequip="${key}" ${g ? `title="${esc(G.name(g))}：${esc(G.statText(g))}（點一下卸下）"` : 'disabled'}>` +
      `<span class="eq-head">${SLOT_ICONS[icon]}<span>${label}</span></span>` +
      `<span class="eq-name">${g ? esc(G.name(g)) : '<span class="dim">空著</span>'}</span>` +
      `<span class="eq-dur">${g ? esc(G.durText(g)) : ''}</span></button>`;
    const worn = FE.Gear.equipped(p).reduce((s, g) => s + G.def(g).weight * (g === p.equip.body ? FE.Char.armorWeightMul(p) : 1), 0);
    $('bagInfo').innerHTML = `
      <p class="eq-weight">身上裝備 ${Math.round(worn * 100) / 100} 磅｜負重 <b class="${tier ? 'over' : ''}">${game.weight()} / ${game.carryLimit()} 磅</b>（推拖上限 ${game.pushLimit()} 磅）${
        tier === 1 ? '<br><b class="over">超過能背的重量：走一步要 36 刻</b>' : tier === 2 ? '<br><b class="over">超過推拖上限：不能移動、不能撤退，先丟掉東西</b>' : ''
      }</p>
      <div class="eq-doll">${slot('main', '主手', 'main', p.equip.main)}${slot('body', '身上', 'body', p.equip.body)}${slot('off', '副手', 'off', p.equip.off)}${slot('pick', '礦鎬', 'pick', p.equip.pick)}${slot('sickle', '鐮刀', 'sickle', p.equip.sickle)}</div>`;

    let detail = '<p class="dim">選一件物品查看資訊與可用操作。</p>';
    if (selected) {
      const isGear = !!selected.gear;
      const def = isGear ? G.def(selected.gear) : null;
      const isTool = isGear && def.cat === 'tool';
      const canEquip = isGear && !isTool && FE.Char.canWear(p, selected.gear) && (def.cat !== 'weapon' || FE.Char.grip(p, selected.gear) !== 'none');
      const canOff = isGear && G.offOk(p, selected.gear);
      const offBlocked = canOff && p.equip.main && G.twoHanded(p, p.equip.main);
      const itemName = `${selected.name}${selected.n > 1 ? ` ×${selected.n}` : ''}`;
      const actions = [];
      if (isTool) actions.push('<button data-bag-action="use">裝備採集工具</button>');
      else if (isGear && canEquip) actions.push('<button data-bag-action="use">穿上或拿起</button>');
      else if (!isGear && selected.use) actions.push('<button data-bag-action="use">使用</button>');
      if (canOff) actions.push(`<button data-bag-action="off" ${offBlocked ? 'disabled' : ''}>拿在副手</button>`);
      if (selected.id !== 'goods') actions.push('<button data-bag-action="drop">丟棄整疊</button>');
      const actionMarkup = ui.bagDropConfirm
        ? `<p>確定要丟掉「${esc(itemName)}」嗎？</p><div class="bag-actions"><button data-bag-action="confirmDrop">確認丟棄</button><button data-bag-action="cancelDrop">取消</button></div>`
        : actions.length
          ? `<div class="bag-actions">${actions.join('')}</div>`
          : '';
      const extra = isTool
        ? '<p class="dim">裝進對應的採集裝備欄後，才能用來採集；同類工具會換回背包。</p>'
        : selected.id === 'goods'
          ? '<p class="dim">這是受託運送的物品，不能丟棄或直接使用。</p>'
          : canOff && offBlocked
            ? '<p class="dim">主手武器需要用兩隻手拿，先換下後才能把武器放在副手。</p>'
            : canOff
              ? '<p class="dim">放在副手：副手出手不加屬性修正值；不是輕型武器時有劣勢、傷害骰降成 1d4，沒有迅切時這個動作多花 3 刻。副手拿了武器就不能拿盾牌。</p>'
              : '';
      detail = `<h3>${esc(itemName)}</h3>${selected.info ? `<p>${esc(selected.info)}</p>` : ''}${extra}${actionMarkup}`;
    }
    $('bagDetail').innerHTML = detail;

    // 第三十七版：右邊的分類清單。上方分類篩選（全部＋各類，只列有東西的類），每一類一組、標題寫總重，點標題收合；
    // 每一行寫名稱（太長換行、不截斷）、數量、簡短數字與重量。點一下選取、點兩下使用、右鍵選取並看操作（在左邊的資訊區）
    const raw = p.bag;
    const rows = list.map((e, i) => ({ e, i, cat: bagCat(e), w: G.itemWeight(raw[i]) }));
    const present = BAG_CATS.filter(([key]) => rows.some((r) => r.cat === key));
    if (ui.bagFilter !== 'all' && !present.some(([key]) => key === ui.bagFilter)) ui.bagFilter = 'all';
    const chip = (key, glyph, label, n) => `<button class="eq-chip${ui.bagFilter === key ? ' on' : ''}" data-bag-filter="${key}" title="${label}"><b>${glyph}</b><span>${label}</span>${n != null ? `<span class="dim">${n}</span>` : ''}</button>`;
    $('bagFilters').innerHTML = chip('all', '*', '全部', null) + present.map(([key, glyph, label]) => chip(key, glyph, label, rows.filter((r) => r.cat === key).length)).join('');
    const shown = present.filter(([key]) => ui.bagFilter === 'all' || ui.bagFilter === key);
    const fmtW = (w) => `${Math.round(w * 100) / 100} 磅`;
    const order = [];
    $('backpack').innerHTML = rows.length
      ? shown
          .map(([key, glyph, label]) => {
            const mine = rows.filter((r) => r.cat === key);
            const open = !ui.bagCollapsed.has(key);
            if (open) for (const r of mine) order.push(r.i);
            const head = `<button class="eq-group" data-bag-group="${key}" aria-expanded="${open}"><span class="eq-tog">[${open ? '−' : '+'}]</span><b>${glyph}</b> ${label}<span class="eq-gw">${fmtW(mine.reduce((s, r) => s + r.w, 0))}</span></button>`;
            const items = open
              ? mine
                  .map(({ e, i, w }) => {
                    // 簡短數字：重量已經寫在右邊，拿掉「重 N」；拿法（單手、雙手）跟武器特質重複時只寫一次
                    const base = e.gear ? G.statText(e.gear).replace(/、?重 [\d.]+/, '').replace(/^、/, '') : '';
                    const stat = e.gear ? `${e.grip && !base.split('、').includes(e.grip) ? e.grip + '、' : ''}${base}` : '';
                    return `<button class="eq-row${ui.bagIndex === i ? ' selected' : ''}" data-bag-select="${i}" aria-pressed="${ui.bagIndex === i}"><span class="eq-rn">${esc(e.name)}${e.n > 1 ? ` <span class="dim">×${e.n}</span>` : ''}${stat ? `<span class="eq-rs">${esc(stat)}</span>` : ''}</span><span class="eq-rw">${fmtW(w)}</span></button>`;
                  })
                  .join('')
              : '';
            return `<div class="eq-sec">${head}${items}</div>`;
          })
          .join('')
      : '<p class="dim">背包是空的。</p>';
    ui.bagOrder = order;
    $('bagTotal').innerHTML = `背包 ${fmtW(rows.reduce((s, r) => s + r.w, 0))}｜負重 <b class="${tier ? 'over' : ''}">${game.weight()} / ${game.carryLimit()} 磅</b>`;
    // 選中的那一行捲到看得見的地方
    const sel = $('backpack').querySelector('.eq-row.selected');
    if (sel && ui.bagScroll) {
      sel.scrollIntoView({ block: 'nearest' });
      ui.bagScroll = false;
    }
  }

  // 第三十七版：背包物品的分類 [key, 字元, 名稱]（字元是我們自己挑的 ASCII，不用 Qud 的圖示）
  const BAG_CATS = [
    ['weapon', ')', '武器'],
    ['armor', '[', '防具'],
    ['ammo', '/', '彈藥'],
    ['thrown', '~', '投擲物'],
    ['use', '!', '消耗品'],
    ['trap', '^', '陷阱'],
    ['tool', '(', '工具'],
    ['mat', '*', '素材'],
    ['goods', '&', '送貨'],
  ];
  function bagCat(e) {
    if (e.gear) {
      const c = FE.Gear.def(e.gear).cat;
      return c === 'weapon' ? 'weapon' : c === 'tool' ? 'tool' : 'armor'; // 防具與盾牌放一起
    }
    if (e.id === 'goods') return 'goods';
    if (FE.GEAR[e.id] && FE.GEAR[e.id].cat === 'ammo') return 'ammo';
    const b = FE.BAG_ITEMS[e.id] || {};
    if (b.ranged) return 'thrown';
    if (b.trap) return 'trap';
    if (e.id === 'herb' || e.id === 'ore') return 'mat';
    if (e.id === 'lock' || e.id === 'thievesTools' || e.id === 'crowbar') return 'tool';
    return 'use';
  }

  // 第三十七版：裝備格的 14px 圖示（自己畫的線條，不用 Qud 的圖）
  const svg14 = (d) => `<svg class="eq-ico" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
  const SLOT_ICONS = {
    main: svg14('<path d="M5 19L19 5M14 5h5v5M6.5 14.5l3 3M4 20l2-2"/>'),
    off: svg14('<path d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z"/>'),
    body: svg14('<path d="M8 3l-4 3 2 5h2v10h8V11h2l2-5-4-3-2 2h-4z"/>'),
    pick: svg14('<path d="M4 7c4-4 12-4 16 0M12 5v16"/>'),
    sickle: svg14('<path d="M6 20l4-4M10 16c-2-7 3-12 10-12-4 2-6 6-5 11"/>'),
  };

  // 角色視窗用：主手武器的精通（用得上的才寫）
  function masteryLine() {
    const p = game.player;
    const ms = p.equip.main ? FE.Char.masteries(p, p.equip.main) : [];
    return ms.length ? `　精通時${ms.map((k) => `${FE.MASTERIES[k].name}（${FE.MASTERIES[k].desc}）`).join('、')}` : '';
  }

  // 角色視窗（C）：職業與等級、生命與負重上限、六項屬性與修正值、各技能的等級與到下一級的進度、目前的加成
  // 角色視窗看的是隊伍裡的第幾位（第三十六版之三）：null 是目前操作的那位；換看的人不換操作，在聚落裡也能看
  function charViewed() {
    const list = game.party();
    if (ui.charView != null && list[ui.charView]) return list[ui.charView];
    ui.charView = null;
    return game.player;
  }

  // 畫看的那位：負重、出手數字這些函式都看 game.player，畫的時候暫時把 player 換成他（同隊友自動出手的 asActor），畫完換回來
  function drawCharacter() {
    const who = charViewed();
    const keep = game.player;
    game.player = who;
    try {
      drawCharacterOf(who, keep);
    } finally {
      game.player = keep;
    }
  }

  // p 是看的那位，ctl 是目前操作的那位
  function drawCharacterOf(p, ctl) {
    const Ch = FE.Char;
    const c = Ch.cls(p);
    const sign = (n) => (n > 0 ? '+' : '') + n;
    const lo = FE.levelExp(game.level);
    const hi = FE.levelExp(game.level + 1);
    // 隊友還有沒加的屬性點：屬性表多一欄「加 1」（冒險者的點數照舊跳升級加點視窗）
    const canAdd = p !== game.hero && p.points > 0;
    // 第三十七版：屬性改成六張卡片（數值大字、修正值、用處；隊友有點數時卡片上有「加 1」）
    const attrCards = FE.ATTRS.map((a) => {
      const v = p.attr[a.key];
      const m = Ch.mod(v);
      const add = canAdd ? `<button class="at-add" data-mate-attr="${a.key}"${v >= C.ATTR_CAP ? ' disabled' : ''}>加 1</button>` : '';
      return `<div class="at-card"><div class="at-top"><span class="at-name">${a.name}</span>${add}</div><div class="at-val"><b>${v}</b><span class="at-mod ${m > 0 ? 'pos' : m < 0 ? 'neg' : ''}">${sign(m)}</span>${v >= C.ATTR_CAP ? '<span class="dim at-cap">上限</span>' : ''}</div><div class="at-info">${esc(a.info)}</div></div>`;
    }).join('');
    // 隊員頁籤：隊伍有兩人以上才有；▶ 是目前操作的那位，＋N 是還有幾點屬性沒加
    const list = game.party();
    const tabs = list.length > 1
      ? `<div class="char-tabs">${list.map((m, i) => `<button class="char-tab${m === p ? ' on' : ''}" data-charview="${i}" title="${m === ctl ? '目前操作的人' : '看這一位（不換操作）'}">${m === ctl ? '▶ ' : ''}${esc(m.name)}<span class="dim">　${esc(Ch.cls(m).name)} Lv${m === game.hero ? game.level : m.lv}</span>${m !== game.hero && m.points > 0 ? `<b class="over">　＋${m.points}</b>` : ''}</button>`).join('')}<span class="dim char-tabs-hint">← → 換人看（不換操作）</span></div>`
      : '';
    // 這項武器技能管哪些武器、學會哪些精通（一律要 5 級才會）
    const weaponsOf = (id) => Object.keys(FE.GEAR).filter((k) => FE.GEAR[k].cat === 'weapon' && (FE.GEAR[k].skill === id || FE.GEAR[k].meleeSkill === id));
    const effect = (id, lv) => {
      const hit = lv <= 0 ? 0 : Math.min(C.PROF_MAX, C.PROF_BASE + Math.floor(lv / C.PROF_EVERY)); // 熟練加值（跟 char.js 的 lvHit 同一套）
      const dmg = Math.floor(lv / C.SKILL_DMG_EVERY);
      if (id === 'fight') return `所有近戰出手（含徒手）命中 +${Math.floor(lv / C.FIGHT_HIT_EVERY)}，跟武器技能疊加`;
      if (id === 'shoot') return `所有遠程（射擊、投擲）命中 +${hit}`;
      if (id === 'misc') return `盾擊命中 +${hit}、傷害 +${dmg}`;
      // 幾把武器學同一種精通時只寫一次（第三十七版之一：一把武器可以有好幾種精通）
      const masOf = (ws) => [...new Set(ws.flatMap((k) => [FE.GEAR[k].mastery].concat(FE.GEAR[k].moreMastery || [])))].map((k) => FE.MASTERIES[k].name);
      if (id === 'bow' || id === 'crossbow' || id === 'firearm') {
        const ws = weaponsOf(id).filter((k) => FE.GEAR[k].skill === id);
        const unlock = lv >= FE.MASTERY_SKILL ? `；精通時：${masOf(ws).join('、')}` : `；${FE.MASTERY_SKILL} 級（精通）學會${masOf(ws).join('、')}`;
        return `${ws.map((k) => FE.GEAR[k].name).join('、')}射擊的傷害 +${dmg}${unlock}`;
      }
      if (FE.SKILLS[id].weapon) {
        const ws = weaponsOf(id).filter((k) => FE.GEAR[k].skill === id);
        const masNames = masOf(ws);
        const unlock = `；精通時：` + masNames.join('、') + (lv >= FE.MASTERY_SKILL ? '' : `（${FE.MASTERY_SKILL} 級）`);
        return `${ws.map((k) => FE.GEAR[k].name).join('、')}：近戰命中 +${hit}、傷害 +${dmg}${FE.GEAR[ws[0]].thrown ? '（投擲只加傷害）' : ''}${id === 'staff' ? '；法師的範圍魔攻也算' : ''}${unlock}`;
      }
      if (id === 'dodge') return `閃避機率 +${lv}%`;
      if (id === 'shield') return `格擋機率 +${lv * 2}%`;
      // 輕甲、中甲、重甲：穿這一類時身上防具的重量打折、多花的刻減少
      const t = C.ARMOR_WEIGHT_MUL;
      const ticks = id === 'light' ? '輕甲本來不多花刻' : id === 'medium' ? (lv >= 5 ? '中甲不多花刻' : '中甲多 1 刻（5 級起不多花）') : lv >= 10 ? '重甲不多花刻' : lv >= 5 ? '重甲少 1 刻（10 級起不多花）' : '重甲多 2 刻（5 級起少 1 刻）';
      return `穿這一類時防具的重量 ×${t[Math.min(lv, t.length - 1)]}；${ticks}`;
    };
    // 第三十七版：技能改成分組的卡片（使用者要重新排版）：每張卡寫名稱、等級與等級名稱，下面一條經驗進度條加「幾／幾」，再下面是目前的效果；
    // 還沒練過（0 級）的卡片變淡
    const skillCard = (id) => {
      const s = p.skills[id];
      const need = Ch.skillNeed(s.lv);
      const pct = Math.max(0, Math.min(100, Math.round((s.n / need) * 100)));
      return `<div class="sk-card${s.lv > 0 ? '' : ' sk-zero'}"><div class="sk-top"><b>${FE.SKILLS[id].name}</b><span><b>${s.lv}</b> 級　<span class="dim">${esc(FE.skillLevelName(s.lv))}</span></span></div>` +
        `<div class="sk-bar" title="到下一級 ${Math.floor(s.n)} / ${need}"><i style="width:${pct}%"></i></div><div class="sk-exp">${Math.floor(s.n)} / ${need}</div>` +
        `<div class="sk-eff">${esc(effect(id, s.lv))}</div></div>`;
    };
    const SKILL_GROUPS = [
      ['近戰武器', ['sword', 'spear', 'knife', 'staff', 'axe', 'mace', 'whip']],
      ['遠程', ['bow', 'crossbow', 'firearm', 'shoot']],
      ['戰鬥', ['fight', 'misc', 'dodge', 'shield']],
      ['防具', ['light', 'medium', 'heavy']],
    ];
    const grouped = new Set(SKILL_GROUPS.flatMap(([, ids]) => ids));
    const rest = Object.keys(FE.SKILLS).filter((id) => !grouped.has(id));
    const skillHtml = SKILL_GROUPS.concat(rest.length ? [['其他', rest]] : [])
      .map(([title, ids]) => {
        const have = ids.filter((id) => FE.SKILLS[id] && p.skills[id]);
        return have.length ? `<h4 class="sk-group">${title}</h4><div class="sk-grid">${have.map(skillCard).join('')}</div>` : '';
      })
      .join('');
    const d = FE.Gear.playerDefense(p);
    const con = Ch.attrMod(p, 'con');
    const heal = `1d10${con > 0 ? '+' + con : con < 0 ? con : ''}`; // 野外短休（第三十版）
    const R = FE.PLAYER_RACES[p.race] || FE.PLAYER_RACES.human;
    // 隊友：背景與來自哪個聚落（第三十六版之二起招來的人有背景）
    const home = p !== game.hero ? game.world.villageById(p.villageId) : null;
    const origin = p !== game.hero ? `　${p.bg && FE.RECRUIT_BACKGROUNDS[p.bg] ? FE.RECRUIT_BACKGROUNDS[p.bg].name + '，' : ''}${home ? `來自${esc(home.name)}` : ''}` : '';
    const pointsNote = p.points > 0 ? `<div class="ch-alert">還有 ${p.points} 點屬性沒加${canAdd ? '，在下面的屬性卡片點「加 1」' : ''}</div>` : '';
    // 第三十七版：角色頁改成卡片排版（使用者要求跟技能卡片一致）：最上面是名字與等級（冒險者有經驗進度條），
    // 接著三張資訊卡（身體、裝備、狀態），再來是六張屬性卡、戰鬥數字的小格子，最後是技能
    const bar = (cur, max, cls) => `<div class="ch-bar ${cls || ''}"><i style="width:${max > 0 ? Math.max(0, Math.min(100, Math.round((cur / max) * 100))) : 0}%"></i></div>`;
    const kv = (k, v) => `<div class="ch-kv"><span>${k}</span><span>${v}</span></div>`;
    const isHero = p === game.hero;
    const lvLine = isHero
      ? game.level >= C.LEVEL_MAX
        ? `<div class="ch-exp"><span>Lv ${game.level}</span><span class="dim">經驗值 ${game.exp}（最高等級）</span></div>`
        : `<div class="ch-exp"><span>Lv ${game.level}</span><span class="dim">經驗值 ${game.exp - lo} / ${hi - lo}</span></div>${bar(game.exp - lo, hi - lo, 'exp')}`
      : `<div class="ch-exp"><span>Lv ${p.lv}</span><span class="dim">冒險者每升一級，隊友跟著升一級</span></div>`;
    const header = `<div class="ch-head"><div class="ch-id"><div class="ch-name">${esc(p.name)}</div><div class="dim">${esc(c.name)}・${esc(R.name)}${isHero ? '' : `・隊友${origin ? '・' + origin.trim() : ''}`}${p === ctl ? '' : '<span class="ch-tag">只是在看，沒有換操作</span>'}</div></div><div class="ch-lv">${lvLine}</div></div>${pointsNote}`;
    const gearName = (g) => (g ? esc(FE.Gear.name(g)) : '<span class="dim">空著</span>');
    const load = game.weight();
    const cards = `<div class="ch-cards">
      <div class="ch-card"><h4>身體</h4>${kv('種族', esc(R.name))}${kv('身高、體格', `${FE.HEIGHTS[(p.height || 4) - 1]}、${FE.BUILDS[(p.build || 4) - 1]}`)}${kv('體型', Ch.sizeOf(p).toLocaleString('en-US'))}${p.skillPack ? kv('起始技能', esc(p.skillPack)) : ''}</div>
      <div class="ch-card"><h4>裝備</h4>${kv('主手', gearName(p.equip.main))}${kv('副手', gearName(p.equip.off) + (p.equip.off && FE.Gear.def(p.equip.off).cat === 'weapon' ? '（雙持）' : ''))}${kv('身上', gearName(p.equip.body))}</div>
      <div class="ch-card"><h4>狀態</h4>
        ${kv('生命', `${p.hp} / ${p.maxHp}`)}${bar(p.hp, p.maxHp, 'hp')}
        ${kv('負重', `${load} / ${game.carryLimit()} 磅`)}${bar(load, game.carryLimit(), load > game.carryLimit() ? 'over' : 'load')}
        ${kv('推拖上限', `${game.pushLimit()} 磅`)}${kv('走一步', `${Math.round(Ch.moveTicks(p) * Ch.exhaustMoveMul(p))} 刻`)}${kv('野外歇一小時', `回 ${heal}（最少 1）`)}${p.exhaust ? kv('力竭', `<b class="over">${p.exhaust} 級</b>`) : ''}
      </div>
    </div>`;
    // 第三十七版之一：主手武器用得上的所有精通（SRD 那一種加新的幾種），以及一優一劣（不看技能等級，一直有）
    const ms = p.equip.main ? Ch.masteries(p, p.equip.main) : [];
    const ed = p.equip.main ? FE.Gear.edgeText(p.equip.main.type) : { pro: '', con: '' };
    const fumble = p.equip.main ? Ch.fumbleRate(p, p.equip.main) : 0;
    const tile = (k, v, note) => `<div class="ch-tile"><span class="dim">${k}</span><b>${v}</b>${note ? `<span class="dim ch-note">${note}</span>` : ''}</div>`;
    const numbers = `<div class="ch-tiles">
      ${tile('主手傷害', esc(game.attackText()))}
      ${tile('近戰出手加減', sign(FE.Gear.hitMod(p)), '不含地形與高處')}
      ${tile('AC', FE.Gear.playerAC(p))}
      ${tile('暴擊', `${Ch.critMin(p, p.equip.main)}～20`)}
      ${tile('攻擊一次', `${Ch.attackTicks(p, p.equip.main)} 刻`)}
      ${tile('閃避', `${Math.round(d.dodge * 100)}%`)}
      ${tile('物理傷害再減', Ch.conCut(p), '體質')}
      ${tile('格擋', d.blockMax ? `${Math.round(d.block * 100)}%` : '—', d.blockMax ? `格擋值 ${d.blockMax}` : '沒拿盾牌')}
      ${ms.length ? tile('精通', esc(ms.map((k) => FE.MASTERIES[k].name).join('、')), esc(ms.map((k) => `${FE.MASTERIES[k].name}：${FE.MASTERIES[k].desc}`).join('；'))) : ''}
      ${ed.pro || ed.con ? tile('武器的優劣', esc(`${ed.pro ? '優：' + ed.pro : ''}${ed.pro && ed.con ? '／' : ''}${ed.con ? '劣：' + ed.con : ''}`)) : ''}
      ${tile('失手率', `${Math.round(fumble * 100)}%`, '命中後擲，失手傷害減半；敏捷每點修正值 −2%')}
      ${isHero ? tile('向工匠買／賣', `×${FE.Gear.buyFactor(game.chaMod()).toFixed(2)}／×${FE.Gear.sellFactor(game.chaMod()).toFixed(2)}`, '魅力') : ''}
    </div>`;
    $('charInfo').innerHTML = `${tabs}${header}${cards}
      <h3 class="ch-sec">屬性<span class="dim">修正值＝(屬性－10)÷2 無條件捨去，上限 ${C.ATTR_CAP}</span></h3>
      <div class="at-grid">${attrCards}</div>
      <h3 class="ch-sec">戰鬥數字</h3>
      ${numbers}
      <h3 class="ch-sec">技能<span class="dim">用了就累積經驗，升到第 N 級要 ${C.SKILL_NEED_BASE}＋${C.SKILL_NEED_STEP}N 點，沒有上限；經驗倍率 ×${Ch.expFactor(p).toFixed(1)}</span></h3>
      ${skillHtml}`;
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
  // 目前挑的職業、種族加成算出來的起始屬性（第三十七版之一：武器有屬性需求，不到的不列出）；還沒挑完（人類兩點沒加完）就不看屬性
  const startAttrNow = () => {
    const s = ui.start;
    try {
      return s.cls ? FE.Char.startAttr(s.cls, { race: s.race, bonus: s.bonus || {}, height: s.height, build: s.build }) : undefined;
    } catch (e) {
      return undefined;
    }
  };
  // 目前這一步左欄的選項（種族、人類加的屬性、體型的接受或重擲、職業，或這一組的起始裝備；拿不起來的武器不列出）
  const startList = () => {
    const s = ui.start;
    if (s.step === 'race') return raceKeys;
    if (s.step === 'bonus') return FE.ATTRS.map((a) => a.key);
    if (s.step === 'body') return ['accept', 'reroll'];
    if (s.step === 'class') return classKeys;
    if (s.step === 'skills') return s.skills.slots.map((x, i) => 's' + i).concat(['reroll', 'accept']);
    return FE.Char.groupOptions(startGroups()[s.gi], startSize(), startAttrNow());
  };
  // 擲身高與體格（各 1～7）
  const rollBody = () => {
    // 照種族的機率擲（第二十九版追加，FE.BODY_ODDS）
    const b = FE.Char.rollBody(ui.start.race, Math.random);
    ui.start.height = b.height;
    ui.start.build = b.build;
  };
  // 擲起始技能（5 格，鎖定的留著，其他重擲；偏高、偏低兩組機率表輪流）。
  // 第一次擲不算；之後的重擲一個新世界最多 FE.SKILL_ROLL.rerolls 次，按 Esc 返回也不補回來，只有開新世界才重算（第三十二版）
  const rerollsLeft = () => FE.SKILL_ROLL.rerolls - (ui.start.rerolls || 0);
  const rollSkills = () => {
    const s = ui.start;
    if (s.skills) {
      if (rerollsLeft() <= 0 || s.skills.slots.every((x) => x.locked)) return; // 用完了，或全鎖了（重擲也不會換）
      s.rerolls = (s.rerolls || 0) + 1;
    }
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
      const weapons = Object.keys(FE.GEAR).filter((k) => FE.GEAR[k].cat === 'weapon' && (FE.GEAR[k].sold || FE.GEAR[k].drop));
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
      return `<dl>${rows}<dt>這次的手氣</dt><dd>${s.skills.high ? '偏高' : '偏低'}（下一次重擲${s.skills.high ? '偏低' : '偏高'}）</dd><dt>重擲</dt><dd>還剩 ${rerollsLeft()} / ${FE.SKILL_ROLL.rerolls} 次</dd></dl><p class="dim">從全部技能擲 5 項，每項新手～精通（1～5 級），至少 1 項武器技能、1 項防具技能；${esc(FE.CLASSES[s.cls].name)}擅長的技能比較容易擲到。選一格可以鎖定或解鎖，重擲（R）只換沒鎖定的格子；一個新世界最多重擲 ${FE.SKILL_ROLL.rerolls} 次，按 Esc 返回也不會補回來。沒擲到的技能都是涉獵（0 級），一樣用了就會練。下一步挑的武器、防具、盾牌，所屬的技能再 +1。</p>`;
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
      rows = `<dt>種類</dt><dd>${d.cat === 'weapon' ? '武器' : d.cat === 'shield' ? '盾牌' : '防具'}</dd><dt>數值</dt><dd>${esc(stat || '無')}</dd>${d.cat === 'weapon' ? `<dt>你拿起來</dt><dd>${FE.Char.GRIP_NAMES[FE.Char.grip({ size: startSize(), attr: startAttrNow() }, g)]}</dd>` : ''}<dt>重量</dt><dd>${d.weight} 磅</dd>`;
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
        if (id === 'reroll') return rerollsLeft() > 0 ? `重擲沒鎖定的格子（R，還剩 ${rerollsLeft()} 次）` : '重擲次數用完了';
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
      // 按 Esc 回來換職業時，擲過的起始技能照舊保留（不然回上一步再進來等於多擲一次）
      if (!s.skills) rollSkills();
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
    const p = game.hero;
    $('modalBody').className = 'win win-small'; // 小視窗，固定大小（第三十六版前整理）
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

  // 在聚落按 R 住一晚的選項視窗（第三十一版；第三十二版改成照對話視窗的數字選項）：
  // 每一級生活水準一個選項，最高到這個聚落的經濟等級，付不起的不能選；最便宜的一級永遠能選（錢不夠就付身上全部）；最後一項是不住
  function restOptions() {
    const p = game.player;
    const v = game.world.villageAt(p.x, p.y);
    const k = v && v.steading ? v.steading.prosperity : 0;
    const out = [];
    for (let lv = 0; lv <= k; lv++) {
      const cost = C.LIVING_COST[lv] * C.SILVER;
      const fx = [`力竭降低 ${C.LIVING_EXHAUSTION[lv]} 級`, C.LIVING_REPAIR[lv] ? `裝備耐久回 ${Math.round(C.LIVING_REPAIR[lv] * 100)}%` : '', C.LIVING_QUEST[lv] ? `這裡的委託獎勵 +${Math.round(C.LIVING_QUEST[lv] * 100)}%` : ''].filter(Boolean);
      const short = p.copper < cost;
      out.push({ id: String(lv), label: `${FE.PROSPERITY[lv]}的生活，付 ${FE.money(lv === 0 && short ? p.copper : cost)}`, desc: `生命回滿${fx.length ? '；' + fx.join('、') : ''}`, note: short ? (lv === 0 ? '錢不夠，付身上全部' : '錢不夠') : '', ok: lv === 0 || !short });
    }
    out.push({ id: 'leave', label: '不住了', desc: '', note: '', ok: true });
    return { v, k, out };
  }
  function drawRestAsk() {
    const p = game.player;
    const { v, k, out } = restOptions();
    $('modalBody').className = 'win win-small'; // 小視窗，固定大小（第三十六版前整理）
    $('modal').classList.remove('full');
    $('modalBody').innerHTML = `
      <h2>住一晚（8 小時）</h2>
      <div class="winbody"><p>${esc(v ? v.name : '')}　經濟：${FE.PROSPERITY[k]}　身上 ${FE.money(p.copper)}</p>
      <div class="dlg-opts">${out.map((o, i) => `<button data-rest="${o.id}" ${o.ok ? '' : 'disabled'}><kbd>${i + 1}</kbd><b>${esc(o.label)}</b>${o.note ? `　<span class="dim">${esc(o.note)}</span>` : ''}${o.desc ? `<br><span class="dim">${esc(o.desc)}</span>` : ''}</button>`).join('')}</div>
      <p class="dim dlg-hint">按數字選，Esc 取消</p></div>`;
  }

  // 施法的招式清單（第三十一版，法師、牧師、聖騎士按 F）：數字鍵選，冷卻中的不能選；手上有遠程武器另外列「射擊」
  function spellMenu() {
    const p = game.player;
    const list = game.spellsOf().map((id) => ({ id, sp: FE.SPELLS[id] }));
    const out = list.map(({ id, sp }) => {
      const cd = game.spellCd(id);
      const busy = sp.ward && p.ward;
      const note = cd > 0 ? `冷卻 ${cd}` : busy ? '效果還在' : sp.aim ? '要瞄準' : '';
      return { id, label: sp.name, desc: sp.desc, note, ok: !(cd > 0) && !busy };
    });
    const w = p.equip.main && FE.GEAR[p.equip.main.type];
    if (w && w.ammo) out.push({ id: 'shoot', label: '射擊', desc: `用${w.name}射擊`, note: '要瞄準', ok: true });
    return out;
  }
  function drawSpellMenu() {
    $('modalBody').className = 'win win-small'; // 小視窗，固定大小（第三十六版前整理）
    $('modal').classList.remove('full');
    $('modalBody').innerHTML = `<h2>施法 <span class="dim">（F）</span></h2><div class="winbody"><div class="dlg-opts">${spellMenu().map((o, i) => `<button data-spell="${o.id}" ${o.ok ? '' : 'disabled'}><kbd>${i + 1}</kbd><b>${esc(o.label)}</b>${o.note ? `　<span class="dim">${esc(o.note)}</span>` : ''}<br><span class="dim">${esc(o.desc)}</span></button>`).join('')}</div><p class="dim dlg-hint">按數字選，Esc 取消</p></div>`;
  }

  function drawModal() {
    const open = !!ui.start || !!ui.restAsk || !!ui.spellMenu || (game && game.hero && game.hero.points > 0);
    $('modal').classList.toggle('hidden', !open);
    if (!open) return;
    if (ui.start) drawStart();
    else if (ui.restAsk) drawRestAsk();
    else if (ui.spellMenu) drawSpellMenu();
    else drawLevelUp();
  }

  // 怪物的攻擊（第三十三版）：攻擊加值與傷害骰，例如「+4，1d6+2 揮砍」（世界等級的加成乘在擲出來的傷害上，這裡不寫）
  function monAttackText(m) {
    if (!m.die) return `傷害約 ${m.atk}`;
    const b = m.dmgBonus || 0;
    const extra = m.extraDie ? `＋${FE.Gear.dieText(m.extraDie)} ${FE.EXTRA_DMG_TYPES[m.extraType] || ''}` : ''; // 第三十三版之一：毒、死靈、寒冷、閃電
    return `${m.toHit >= 0 ? '+' : ''}${m.toHit}，${FE.Gear.dieText(m.die)}${b ? (b > 0 ? '+' : '') + b : ''} ${FE.DMG_TYPES[m.dmgType] || ''}${extra}`;
  }
  // 怪物的特性：群體戰術、靈巧脫身、易傷、再生
  function monTraitText(m) {
    const out = (m.traits || []).map((k) => FE.MONSTER_TRAITS[k]).filter(Boolean);
    for (const t of m.vuln || []) out.push(`怕${FE.DMG_TYPES[t] || FE.EXTRA_DMG_TYPES[t]}（傷害加倍）`);
    if (m.regen) out.push(`再生（每回合 ${m.regen} 點）`);
    return out.join('、');
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
      const st = monStates(m);
      const chasing = game.battle.targetId === m.id ? '你的目標' : m.chase > 0 ? '正在追你' : '還沒發現你';
      el.innerHTML = `<p><b class="tname">${esc(m.name)}</b>　<span class="dim">${chasing}</span></p><dl><dt>生命</dt><dd>${m.hp} / ${m.maxHp}</dd><dt>體型</dt><dd>${FE.sizeName(m)}</dd><dt>AC</dt><dd>${m.ac}</dd><dt>攻擊</dt><dd>${esc(monAttackText(m))}</dd>${monTraitText(m) ? `<dt>特性</dt><dd>${esc(monTraitText(m))}</dd>` : ''}${st.length ? `<dt>狀態</dt><dd>${esc(st.join('、'))}</dd>` : ''}</dl><div class="dlg-opts"><button data-look="target,${m.x},${m.y}">設成目標</button></div>`;
    } else if (n) {
      const role = n.role === 'smith' ? (FE.Steading.shopTown(W.villageById(n.villageId)) ? '武器匠' : '鐵匠') : n.role === 'armorer' ? '盔甲匠' : n.role === 'merchant' ? '商人' : n.role === 'soldier' ? `士兵（${FE.Char.cls(n).name}，Lv${n.lv}）` : n.role === 'recruit' ? `${FE.RECRUIT_BACKGROUNDS[n.bg].name}（${FE.Char.cls(n).name}）` : '村民';
      const race = FE.PLAYER_RACES[FE.npcRace(W, n)];
      const quest = handIn(n) ? '可以交件或回報' : n.role === 'recruit' ? '想找同伴' : n.quest && !n.quest.accepted && !n.quest.done ? '有委託可以接' : '';
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
    history: drawJournal,
    steading: drawSteadingPage,
    messages: drawLogAll,
    reports: drawReports,
    minimap: drawMinimap, // 第三十七版：聚落資訊移到聚落頁（I），地圖只畫地圖
    settings: null,
  };

  // 第三十七版：大視窗的頁籤（照順序），[視窗名, 頁籤名, 按鍵]
  const TABS = [['character', '角色', 'C'], ['backpack', '裝備', 'B'], ['quests', '委託', 'Q'], ['history', '日誌', 'H'], ['steading', '聚落', 'I'], ['minimap', '地圖', 'M'], ['messages', '訊息', 'J']];
  function drawTabs() {
    const html = TABS.map(([name, label, key]) => `<button class="${name === ui.win ? 'on' : ''}" data-tab="${name}">${label}<span class="k">${key}</span></button>`).join('');
    document.querySelectorAll('[data-tabs]').forEach((el) => {
      if (el.closest('.win') && !el.closest('.win').classList.contains('hidden')) el.innerHTML = html;
    });
  }

  function drawWindow() {
    $('overlay').classList.toggle('hidden', !ui.win);
    for (const name of Object.keys(WINDOWS)) $('win-' + name).classList.toggle('hidden', name !== ui.win);
    if (ui.win) drawTabs();
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
    drawParty();
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
      if (!ui.mapBound) { bindMap(); ui.mapBound = true; } // 地圖的滑鼠提示與點選聚落（開新世界時不重綁）
      ui.mapSel = null;
      ui.route = null; // 第三十五版之三：路線預覽不跨世界留著
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
    restOptions: () => restOptions().out,
    // 施法的招式清單：開、關、第 i 項
    openSpells() {
      ui.spellMenu = true;
      update();
    },
    spellsOpen: () => !!ui.spellMenu,
    closeSpells() {
      ui.spellMenu = false;
      update();
    },
    spellAt: (i) => spellMenu()[i] || null,
    cellAt,
    // 第三十五版之三：滑鼠點出來、還沒出發的路線（null 收掉）；只記狀態，重畫由呼叫端負責
    setRoute(r) {
      ui.route = r;
    },
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
    modal: () => !!ui.start || !!(game && game.hero && game.hero.points > 0),
    selectShopItem(i) {
      const npc = game.talking != null ? game.talkTarget(game.talking) : null;
      const o = npc && game.talkOptions(npc).options[i];
      if (!o || (!/^(buyItem|sellItem|repairItem|craftItem):/.test(o.id) && o.id !== 'sellOre')) return;
      ui.shopSelection = { id: o.id, page: game.talkPage, npcId: npc.id };
      update();
    },
    shopSelection: () => ui.shopSelection,
    shopConfirmIndex() {
      if (!ui.shopSelection) return -1;
      const npc = game.talking != null ? game.talkTarget(game.talking) : null;
      return npc ? game.talkOptions(npc).options.findIndex((o) => o.id === ui.shopSelection.id && !o.disabled) : -1;
    },
    clearShopSelection() {
      ui.shopSelection = null;
    },
    cancelShopItem() {
      this.clearShopSelection();
      update();
    },
    shopTab(tab) {
      if (!['buy', 'sell', 'repair', 'craft'].includes(tab) || !game || game.talking == null) return;
      ui.shopSelection = null;
      game.talkPage = tab;
      update();
    },
    shopActive() {
      const npc = game && game.talking != null ? game.talkTarget(game.talking) : null;
      return !!npc && !!FE.Gear.shopOf(npc, game.world.villageById(npc.villageId));
    },
    closeShop() {
      if (!this.shopActive()) return;
      game.closeTalk();
      update();
    },
    win: () => ui.win,
    selectedBagIndex: () => ui.bagIndex,
    bagDropConfirm: () => ui.bagDropConfirm,
    selectBagItem(i) {
      if (!Number.isInteger(i) || !game.bagList()[i]) return;
      ui.bagIndex = i;
      ui.bagDropConfirm = false;
      update();
    },
    // 第三十七版：裝備頁的分類篩選、收合分類、↑↓ 照畫面上的順序換選取
    bagFilter(key) {
      ui.bagFilter = key;
      update();
    },
    toggleBagGroup(key) {
      if (ui.bagCollapsed.has(key)) ui.bagCollapsed.delete(key);
      else ui.bagCollapsed.add(key);
      update();
    },
    bagMove(d) {
      const order = ui.bagOrder;
      if (!order.length) return;
      const at = order.indexOf(ui.bagIndex);
      const next = at < 0 ? (d > 0 ? 0 : order.length - 1) : Math.max(0, Math.min(order.length - 1, at + d));
      ui.bagIndex = order[next];
      ui.bagDropConfirm = false;
      ui.bagScroll = true;
      update();
    },
    askBagDrop() {
      const e = game.bagList()[ui.bagIndex];
      if (!e || e.id === 'goods') return;
      ui.bagDropConfirm = true;
      update();
    },
    cancelBagDrop() {
      ui.bagDropConfirm = false;
      update();
    },
    clearBagSelection() {
      ui.bagIndex = null;
      ui.bagDropConfirm = false;
    },
    openWindow(name) {
      ui.win = name;
      if (name === 'backpack') {
        ui.bagIndex = null;
        ui.bagDropConfirm = false;
      }
      if (name === 'reports' && game.reports.length) FE.store.save('fe.reportSeen', reportId(game.reports[0]));
      if (name === 'character') ui.charView = null; // 打開時先看目前操作的那位
      if (name === 'steading') ui.mapSel = null; // 按 I 或點頁籤：先看所在或最近的聚落（從地圖點聚落進來的不經過這裡）
      update();
    },
    // 聚落頁選一座聚落（第三十七版）
    pickSteading(id) {
      ui.mapSel = id;
      update();
    },
    // 角色視窗換看隊伍裡的第 i 位（第三十六版之三），或往前後 d 位（← →）；不換操作
    charView(i) {
      const list = game.party();
      if (!list[i]) return;
      ui.charView = i;
      update();
    },
    charStep(d) {
      const list = game.party();
      if (list.length < 2) return;
      const now = list.indexOf(charViewed());
      ui.charView = (now + d + list.length) % list.length;
      update();
    },
    charViewed: () => charViewed(),
    closeWindow() {
      ui.win = null;
      update();
    },
  };
})();
