// 第三十四版：照圖樣蓋的聚落與地貌（圖樣照第三十四版草稿第 4 節，使用者定的；草稿原文在 v34-terrain-draft 分支的 討論-v34-地形.md）：
// 堡壘廢墟（地貌，39×25）、堡壘（守隘口，45×29）、要塞（兩座堡壘併起來，45×58）、城市（兩座城鎮併起來，90×29）。
// 村莊與城鎮照舊由 steading.js 的 layout 排版；這裡的四種是固定圖樣，可以轉 90 度（隘口、這一段是左右兩邊時）。
// 圖樣的字是地圖資料的代碼：W 石牆（畫面照雙線自動接）、. 庭院（室外的空地）、, 室內地板、· 路、+ 門、X 塔樓裡的樓梯、╪ 城門、
// O 井、≡ 床、π 桌、╥ 椅（主堡裡當寶座）、¤ 祭壇、╤ 鐵砧、÷ 木桶、Æ 箱子、■ 攤位、█ 山壁（貼著堡壘兩側的隘口山壁）、空白是外面（保留原本的地形）。
// 堡壘廢墟是地貌，照 LANDMARKS 的寫法：. 保留原本的地形、o 室內地板，其他是廢墟的字（▓ 斷牆、░ 碎石地、▒ 崩一半的牆、≥ ≤ 碎片、# 倒下的石柱）。
// 圖樣從草稿的畫轉成代碼時（Claude 做的）：草稿的塔樓沒有門，每座塔都在面向庭院的那一側開一道門；堡壘外牆與山壁之間的空隙填成山壁（不然是走不到的凹洞）；
// 廢墟東南角塌掉的塔樓裡被斷牆圍住的碎石地填成斷牆
(function () {
  const C = FE.CONFIG;
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  const PLANS = {
    ruin: [
      'WWWWW.............................WWWWW',
      'WoooW.............................WoooW',
      'WoXoWWW▓▓░≤▓WWWWWWWWWWWWWWWWWWWWWWWoXoW',
      'WoooW░░░░░░░░░░░░░░░░░░░░░░░░░░░░░WoooW',
      'WWW+W░░░░░░░░░░░░░░░░░░░░░░░░░≤░░░W+WWW',
      '..W░░░░░░░░░W+WWWWWWWWWWWWW░░░░░░░░░W..',
      '..W░░≥░░░░░░WoooWoooooooooW░░░░░░░░░W..',
      '..W░░░░░░░░░WoXoWoooooπ╥ooW░░░░░░░░░W..',
      '..W░░░░░░░░░WoooWoooooooooW░░░░░░░░░W..',
      '..W░≤░░░░░░░WWWWWoooooooooW░░░░░░░░░▓..',
      '..W░░░░░░░░░Wooooooo≡oooooW░░░░""░░░▓..',
      '..W░░░░░░░░░Wooooooooooo≡oW░░░░░░░░░░≥.',
      '..W░░░""░░░░Wooooooooooooo▒░░░░░░░░░▒..',
      '..W░░░░░░░░░WWWWWWW+WWWW▓░W░░░░░░░░░▓..',
      '..W░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░W..',
      '..▒░░░░░░░░░░░░░░░░░░░░░░░WWW+WWWW░░W..',
      '..▓░░░░░O░░░░░░░░#░░░░░░░░WooooooW░░W..',
      '..▓░░░░░░░░░░░░░░░░░░≥░░░░WooooooW░░W..',
      '..W░░░░░░##░░░░░░░░░░░░░░░Wo≤ooooW░░W..',
      '..W░░░░░░░░░░░░░░░░░░░░░░░W+WWWWWW░░W..',
      'WWW+W░░░░░░░░W+WWW░░░W+WWW░░░░░░░░▓▓▓▓▓',
      'WoooW░░░░░░░░WoooW░░░WoooW░░░░░░░░▓▓▓▓▓',
      'WoXoWWWWWWWWWWoXoW░░░WoXoWWWWWWWWW▓▓▓▓▓',
      'WoooW........WoooW░≥░WoooW........▓▓▓▓▓',
      'WWWWW........WWWWW░░░WWWWW........▓▓▓▓.',
    ],
    fort: [
      '█WWWWW          WWWWW···WWWWW          WWWWW█',
      '█W,,,W          W,,,W···W,,,W          W,,,W█',
      '█W,X,WWWWWWWWWWWW,X,W╪╪╪W,X,WWWWWWWWWWWW,X,W█',
      '█W,,,W..........W,,,W···W,,,W..........W,,,W█',
      '█WWW+W..........W+WWW···W+WWW..........W+WWW█',
      '███W.................···.................W███',
      '███W.................···.................W███',
      '███W.................···..WWWWWWWWWWWWW..W███',
      '███W.W+WWWWWWWWWWW...···..W,≡,≡,≡,≡,≡,W..W███',
      '███W.W,,,W,,,,,,,W...···..W,,,,,,,,,,,W..W███',
      '███W.W,X,W,,,π╥,,W...···..+,,,,,,,,,,,W..W███',
      '███W.W,,,W,,,,,,,W...···..W,,,,,,,,,,,W..W███',
      '███W.WWWWW,,,,,,,W...···..W,≡,≡,≡,≡,≡,W..W███',
      '███W.W,,,,,,,,,,,+...···..WWWWWWWWWWWWW..W███',
      '███W.W,,,,,,,,,,,W...···.................W███',
      '███W.W,,,,,,,,,,,W...···.................W███',
      '███W.W,,,,,¤,,,,,W...···..WWWWWWWWW+WWW..W███',
      '███W.W,,,,,,,,,,,W...···..W,,,,,W,,,,,W..W███',
      '███W.WWWWWWWWWWWWW...···..W,,╤,,W,,╤,,W..W███',
      '███W.................···..+,,,,,W,Æ,,,W..W███',
      '███W.................···..W,,,,,W,,,Æ,W..W███',
      '███W...............O.···..W,,,÷,W,,,,,W..W███',
      '███W.................···..WWWWWWWWWWWWW..W███',
      '███W.................···.................W███',
      '█WWW+W..........W+WWW···W+WWW..........W+WWW█',
      '█W,,,W..........W,,,W···W,,,W..........W,,,W█',
      '█W,X,WWWWWWWWWWWW,X,W╪╪╪W,X,WWWWWWWWWWWW,X,W█',
      '█W,,,W          W,,,W···W,,,W          W,,,W█',
      '█WWWWW          WWWWW···WWWWW          WWWWW█',
    ],
    fortress: [
      '█WWWWW          WWWWW···WWWWW          WWWWW█',
      '█W,,,W          W,,,W···W,,,W          W,,,W█',
      '█W,X,WWWWWWWWWWWW,X,W╪╪╪W,X,WWWWWWWWWWWW,X,W█',
      '█W,,,W..........W,,,W···W,,,W..........W,,,W█',
      '█WWW+W..........W+WWW···W+WWW..........W+WWW█',
      '███W.................···.................W███',
      '███W.................···.................W███',
      '███W.................···..WWWWWWWWWWWWW..W███',
      '███W.W+WWWWWWWWWWW...···..W,≡,≡,≡,≡,≡,W..W███',
      '███W.W,,,W,,,,,,,W...···..W,,,,,,,,,,,W..W███',
      '███W.W,X,W,,,π╥,,W...···..+,,,,,,,,,,,W..W███',
      '███W.W,,,W,,,,,,,W...···..W,,,,,,,,,,,W..W███',
      '███W.WWWWW,,,,,,,W...···..W,≡,≡,≡,≡,≡,W..W███',
      '███W.W,,,,,,,,,,,+...···..WWWWWWWWWWWWW..W███',
      '███W.W,,,,,,,,,,,W...···.................W███',
      '███W.W,,,,,,,,,,,W...···.................W███',
      '███W.W,,,,,¤,,,,,W...···..WWWWWWWWW+WWW..W███',
      '███W.W,,,,,,,,,,,W...···..W,,,,,W,,,,,W..W███',
      '███W.WWWWWWWWWWWWW...···..W,,╤,,W,,╤,,W..W███',
      '███W.................···..+,,,,,W,Æ,,,W..W███',
      '███W.................···..W,,,,,W,,,Æ,W..W███',
      '███W...............O.···..W,,,÷,W,,,,,W..W███',
      '███W.................···..WWWWWWWWWWWWW..W███',
      '███W.................···.................W███',
      '███W.................···.................W███',
      '███W.................···.................W███',
      '█WWW+W..........W+WWW···W+WWW..........W+WWW█',
      '█W,,,W..........W,,,W···W,,,W..........W,,,W█',
      '█W,X,WWWWWWWWWWWW,X,W╪╪╪W,X,WWWWWWWWWWWW,X,W█',
      '█W,,,W..........W,,,W···W,,,W..........W,,,W█',
      '█WWWWW..........WWWWW···WWWWW..........WWWWW█',
      '███W.................···.................W███',
      '███W.................···.................W███',
      '███W.................···.................W███',
      '███W.................···.................W███',
      '███W.................···.................W███',
      '███W.................···..WWWWWWWWWWWWW..W███',
      '███W.W+WWWWWWWWWWW...···..W,≡,≡,≡,≡,≡,W..W███',
      '███W.W,,,W,,,,,,,W...···..W,,,,,,,,,,,W..W███',
      '███W.W,X,W,,,π╥,,W...···..+,,,,,,,,,,,W..W███',
      '███W.W,,,W,,,,,,,W...···..W,,,,,,,,,,,W..W███',
      '███W.WWWWW,,,,,,,W...···..W,≡,≡,≡,≡,≡,W..W███',
      '███W.W,,,,,,,,,,,+...···..WWWWWWWWWWWWW..W███',
      '███W.W,,,,,,,,,,,W...···.................W███',
      '███W.W,,,,,,,,,,,W...···.................W███',
      '███W.W,,,,,¤,,,,,W...···..WWWWWWWWW+WWW..W███',
      '███W.W,,,,,,,,,,,W...···..W,,,,,W,,,,,W..W███',
      '███W.WWWWWWWWWWWWW...···..W,,╤,,W,,╤,,W..W███',
      '███W.................···..+,,,,,W,Æ,,,W..W███',
      '███W.................···..W,,,,,W,,,Æ,W..W███',
      '███W...............O.···..W,,,÷,W,,,,,W..W███',
      '███W.................···..WWWWWWWWWWWWW..W███',
      '███W.................···.................W███',
      '█WWW+W..........W+WWW···W+WWW..........W+WWW█',
      '█W,,,W..........W,,,W···W,,,W..........W,,,W█',
      '█W,X,WWWWWWWWWWWW,X,W╪╪╪W,X,WWWWWWWWWWWW,X,W█',
      '█W,,,W          W,,,W···W,,,W          W,,,W█',
      '█WWWWW          WWWWW···WWWWW          WWWWW█',
    ],
    city: [
      '                     ···                                          ···                     ',
      ' WWWWWWWWWWWWWWWWWWWW···WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW···WWWWWWWWWWWWWWWWWWWW ',
      ' W...................···..........................................···...................W ',
      ' W.WWWWW.WWWWW.......···..........W+WWWWWWWWWWWWWWWW+WWW..........···......WWWWW.WWWWW..W ',
      ' W.W,,,W.W,,,W.......···..........W,,,W,,,,,,,,,,,,W,,,W..........···......W,,,W.W,,,W..W ',
      ' W.W,,,W.W,,,W.......···..........W,X,W,,,,,,,,,,,,W,X,W..........···......W,,,W.W,,,W..W ',
      ' W.WW+WW.WW+WW.WWWWWW···..........W,,,W,,,,,╥╥,,,,,W,,,W....WWWWWW···......WW+WW.WW+WW..W ',
      ' W.............W,,,,W···WWWWW.....WWWWW,,,,,,,,,,,,WWWWW....W,,,,W···WWWWW..............W ',
      ' W.WWWWW.WWWWW.W,¤,,W···W╤,ÆW.........W,,,,¤,,,,,,,W........W,¤,,W···W╤,ÆW.WWWWW.WWWWW..W ',
      ' W.W,,,W.W,,,W.W╥,╥,W···W,,,W.........W,,,,,,,,,,,,W........W╥,╥,W···W,,,W.W,,,W.W,,,W..W ',
      ' W.W,,,W.W,,,W.W,,,,W···W,,,W.........WWWWWW++WWWWWW........W,,,,W···W,,,W.W,,,W.W,,,W..W ',
      ' W.WW+WW.WW+WW.WWW+WW···WW+WW...............··..............WWW+WW···WW+WW.WW+WW.WW+WW..W ',
      ' W................·········.................··.................·········................W ',
      '··························································································',
      '··························································································',
      '··························································································',
      ' W................·········.................··.................·········................W ',
      ' W.WW+WW.WW+WW..WW+WW···W+WW+W..............··...............WW+WW···W+WW+W.WW+WW.WW+WW.W ',
      ' W.W,,,W.W,,,W..W,,,W···W,,,,W....WWWW+WWWWW+WWWWW+WWWWW.....W,,,W···W,,,,W.W,,,W.W,,,W.W ',
      ' W.W,,,W.W,,,W..W,,,W···W,■,■W....W,,,,,,,,,,,,,,,,,,,,W.....W,,,W···W,■,■W.W,,,W.W,,,W.W ',
      ' W.WWWWW.WWWWW..W╤,÷W···WWWWWW....W,,,,,,,,,,,,,,,,,,,,W.....W╤,÷W···WWWWWW.WWWWW.WWWWW.W ',
      ' W..............WWWWW···..........W,,■,,■,,■,,■,,■,,■,,W.....WWWWW···...................W ',
      ' W.WW+WW.WW+WW.......···..........W,,,,,,,,,,,,,,,,,,,,W..........···.......WW+WW.WW+WW.W ',
      ' W.W,,,W.W,,,W.......···..........W,,,,,,,,,,,,,,,,,,,,W..........···.......W,,,W.W,,,W.W ',
      ' W.W,,,W.W,,,W.......···..........WWWWWWWWWWWWWWWWWWWWWW..........···.......W,,,W.W,,,W.W ',
      ' W.WWWWW.WWWWW.......···..........................................···.......WWWWW.WWWWW.W ',
      ' W...................···..........................................···...................W ',
      ' WWWWWWWWWWWWWWWWWWWW···WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW···WWWWWWWWWWWWWWWWWWWW ',
      '                     ···                                          ···                     ',
    ],  };

  // 圖樣順時針轉 90 度：原本 (x, y) 搬到 (h - 1 - y, x)
  function rotate(rows) {
    const h = rows.length;
    const w = rows[0].length;
    const out = [];
    for (let x = 0; x < w; x++) {
      let s = '';
      for (let y = h - 1; y >= 0; y--) s += rows[y][x];
      out.push(s);
    }
    return out;
  }

  // 室內：地板與房間裡的家具、樓梯（井在室外）
  const INDOOR = new Set([',', '≡', 'π', '╥', '¤', '╤', '÷', 'Æ', '■', 'X']);

  // 解析一個圖樣：建築（連在一起的室內格子，加上貼著的門）、出入口（圖樣邊上的路，同一邊連著的算一個）。結果快取
  const cache = new Map();
  function get(kind, rot) {
    const k = kind + (rot ? ':r' : '');
    if (cache.has(k)) return cache.get(k);
    const rows = rot ? rotate(PLANS[kind]) : PLANS[kind];
    const h = rows.length;
    const w = rows[0].length;
    const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? ' ' : rows[y][x]);
    const seen = new Set();
    const buildings = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!INDOOR.has(at(x, y)) || seen.has(x + ',' + y)) continue;
        const cells = [[x, y]];
        seen.add(x + ',' + y);
        for (let i = 0; i < cells.length; i++) {
          for (const [dx, dy] of DIRS) {
            const nx = cells[i][0] + dx;
            const ny = cells[i][1] + dy;
            if (INDOOR.has(at(nx, ny)) && !seen.has(nx + ',' + ny)) {
              seen.add(nx + ',' + ny);
              cells.push([nx, ny]);
            }
          }
        }
        const doors = [];
        const dk = new Set();
        for (const [cx, cy] of cells) {
          for (const [dx, dy] of DIRS) {
            const nx = cx + dx;
            const ny = cy + dy;
            if (at(nx, ny) === '+' && !dk.has(nx + ',' + ny)) {
              dk.add(nx + ',' + ny);
              doors.push([nx, ny]);
            }
          }
        }
        const items = cells.map(([cx, cy]) => at(cx, cy));
        const n = (ch) => items.filter((c) => c === ch).length;
        // 房間的用途看裡面的東西（Claude 定的）：樓梯是塔樓；攤位是市場（城市的市場與大市集）；鐵砧加箱子是盔甲匠工坊、鐵砧是鐵匠工坊；
        // 兩張床以上是兵營（住人，跟 8 格的民房一樣站在自己的床上）；祭壇在大房間（30 格以上）是主堡、小房間是神殿；只有箱子是倉庫；什麼都沒有是民房（蓋的時候再擺床、櫃、椅）
        let kind = 'house';
        if (n('X')) kind = 'tower';
        else if (n('■')) kind = 'market';
        else if (n('╤') && n('Æ')) kind = 'armory';
        else if (n('╤')) kind = 'smithy';
        else if (n('≡') >= 2) kind = 'big';
        else if (n('¤')) kind = cells.length >= 30 ? 'keep' : 'temple';
        else if (n('Æ')) kind = 'store';
        const xs = cells.map((c) => c[0]);
        const ys = cells.map((c) => c[1]);
        buildings.push({
          kind, cells, doors,
          x0: Math.min(...xs) - 1, y0: Math.min(...ys) - 1, x1: Math.max(...xs) + 1, y1: Math.max(...ys) + 1,
          beds: cells.filter(([cx, cy]) => at(cx, cy) === '≡'),
          plain: items.every((c) => c === ','), // 空房間（民房）：蓋的時候擺家具
        });
      }
    }
    // 出入口：圖樣四邊上的路，同一邊連在一起的一段是一個出入口；c 是那一段中間的座標（南北出入口是 x，東西出入口是 y）
    const exits = [];
    const sides = [
      [[0, -1], (i) => [i, 0], w],
      [[0, 1], (i) => [i, h - 1], w],
      [[-1, 0], (i) => [0, i], h],
      [[1, 0], (i) => [w - 1, i], h],
    ];
    for (const [d, pos, len] of sides) {
      let run = [];
      for (let i = 0; i <= len; i++) {
        const p = i < len ? pos(i) : null;
        if (p && at(p[0], p[1]) === '·') run.push(i);
        else if (run.length) {
          exits.push({ d, c: run[Math.floor(run.length / 2)] });
          run = [];
        }
      }
    }
    const plan = { kind, rot: !!rot, rows, w, h, buildings, exits };
    cache.set(k, plan);
    return plan;
  }

  // 照圖樣把聚落蓋進世界：v.x0、v.y0 是圖樣左上角（工作範圍），v.rot 是轉 90 度。蓋完 v 的範圍縮到聚落（mask）的外接矩形，
  // mask、rooms、buildings 照 steading.js 的 layout 一樣記；民房照 layout 的規則擺床、櫃、椅；出入口外的路鋪到圖樣外三格
  function stamp(world, rng, v) {
    const P = get(v.kind, v.rot);
    const ox = v.x0;
    const oy = v.y0;
    if (!v.flat) v.flat = { x0: v.x0, y0: v.y0, x1: v.x1, y1: v.y1 };
    const g = P.rows.map((r) => [...r]);
    // 民房擺家具（跟 layout 一樣：床、物品櫃、椅，門內那一格空著，住戶站的格子貼著它）
    const B = FE.Steading.BUILDINGS;
    const buildings = P.buildings.map((b) => {
      const o = { kind: b.kind, x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1, cells: b.cells, doors: b.doors, beds: b.beds.slice(), spots: [] };
      if (b.kind === 'house' && b.plain) {
        const inners = b.doors.map(([dx, dy]) => b.cells.find(([cx, cy]) => Math.abs(cx - dx) + Math.abs(cy - dy) === 1)).filter(Boolean);
        const fur = FE.Steading.furnish(rng, b.cells, inners.slice(0, 1), B.house, 0);
        if (fur) {
          for (const [x, y, ch] of fur.placed) g[y][x] = ch;
          o.beds = fur.placed.filter((p) => p[2] === '≡').map(([x, y]) => [x, y]);
          o.spots = fur.spot ? [fur.spot] : [];
        }
      } else if (b.kind === 'big') {
        o.spots = o.beds.slice(); // 兵營：住戶站在自己的床上
      } else if (b.kind === 'smithy' || b.kind === 'armory') {
        // 工匠站在門內那一格旁邊的空地
        const free = (x, y) => g[y][x] === ',';
        const [dx, dy] = b.doors[0] || b.cells[0];
        const inner = b.cells.find(([cx, cy]) => Math.abs(cx - dx) + Math.abs(cy - dy) === 1) || b.cells[0];
        const spot = b.cells.find(([cx, cy]) => free(cx, cy) && Math.abs(cx - inner[0]) + Math.abs(cy - inner[1]) === 1) || inner;
        o.spots = [spot];
      }
      return o;
    });
    // 寫進世界：空白保留原本的地形；山壁保留生態區；其他是聚落（整平的空地）
    for (let y = 0; y < P.h; y++) {
      for (let x = 0; x < P.w; x++) {
        const ch = g[y][x];
        if (ch === ' ') continue;
        const c = world.cell(x + ox, y + oy);
        if (!c) continue;
        if (ch === '█') world.setCell(x + ox, y + oy, '█', c.biome);
        else world.setCell(x + ox, y + oy, ch === ',' ? '.' : ch, 'plain');
      }
    }
    // 外接矩形、mask、rooms
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    const inMask = (x, y) => g[y][x] !== ' ' && g[y][x] !== '█';
    for (let y = 0; y < P.h; y++) {
      for (let x = 0; x < P.w; x++) {
        if (!inMask(x, y)) continue;
        bx0 = Math.min(bx0, x);
        bx1 = Math.max(bx1, x);
        by0 = Math.min(by0, y);
        by1 = Math.max(by1, y);
      }
    }
    const rooms = g.map((row) => row.map(() => ' '));
    buildings.forEach((b, i) => {
      for (const [x, y] of b.cells.concat(b.doors)) rooms[y][x] = String.fromCharCode(65 + i);
    });
    const crop = (fn) => {
      const out = [];
      for (let y = by0; y <= by1; y++) {
        let s = '';
        for (let x = bx0; x <= bx1; x++) s += fn(x, y);
        out.push(s);
      }
      return out;
    };
    v.mask = crop((x, y) => (inMask(x, y) ? '#' : ' '));
    v.rooms = crop((x, y) => rooms[y][x]);
    const toWorld = ([x, y]) => [x + ox, y + oy];
    v.buildings = buildings.map((b) => ({
      kind: b.kind, x0: b.x0 + ox, y0: b.y0 + oy, x1: b.x1 + ox, y1: b.y1 + oy,
      doors: b.doors.map(toWorld), beds: b.beds.map(toWorld), spots: b.spots.map(toWorld),
    }));
    v.entrances = P.exits.length;
    v.exitDirs = P.exits.map((e) => e.d);
    v.exitAt = P.exits.map((e) => (e.d[0] ? oy + e.c : ox + e.c)); // 出入口那一段中間的座標（World 的 openExits 用）
    // 出入口外的路：從圖樣的邊再往外鋪 3 格（3 格寬），不蓋到別的聚落與地貌
    for (const e of P.exits) {
      const [dx, dy] = e.d;
      for (let i = 1; i <= 3; i++) {
        for (let o = -1; o <= 1; o++) {
          const x = dx > 0 ? ox + P.w - 1 + i : dx < 0 ? ox - i : ox + e.c + o;
          const y = dy > 0 ? oy + P.h - 1 + i : dy < 0 ? oy - i : oy + e.c + o;
          const c = world.cell(x, y);
          if (c && c.t !== '≈' && !world.villageAt(x, y) && !world.landmarkAt(x, y)) world.setCell(x, y, '·', c.biome);
        }
      }
    }
    v.x0 = bx0 + ox;
    v.y0 = by0 + oy;
    v.x1 = bx1 + ox;
    v.y1 = by1 + oy;
  }

  // 圖樣的出入口都開得出去：每個出入口外 3 格寬的通道，從圖樣的邊一直看到外面「聚落周圍的圈＋6 格」，不能有水或山壁（還沒長出來的格子看將來會不會是湖）。
  // 跟 steading.js 的 exitViable 同一個道理（出口不朝湖開）；圖樣的出入口固定，所以只回答全部開不開得出去
  function exitsViable(world, kind, rot, box) {
    const P = get(kind, rot);
    const far = C.SETTLE_BUFFER[kind] + 6;
    for (const e of P.exits) {
      const [dx, dy] = e.d;
      for (let i = 1; i <= far; i++) {
        for (let o = -1; o <= 1; o++) {
          const x = dx > 0 ? box.x0 + P.w - 1 + i : dx < 0 ? box.x0 - i : box.x0 + e.c + o;
          const y = dy > 0 ? box.y0 + P.h - 1 + i : dy < 0 ? box.y0 - i : box.y0 + e.c + o;
          const c = world.cell(x, y);
          if (c ? c.t === '≈' || c.t === '█' : FE.futureLake(world, x, y)) return false;
        }
      }
    }
    return true;
  }

  FE.Plans = { PLANS, get, rotate, stamp, exitsViable };
})();
