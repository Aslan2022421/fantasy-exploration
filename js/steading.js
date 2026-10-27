// 聚落：參考《地城世界》（Dungeon World）的聚落規則。每個村莊與城鎮有經濟、人口和其他標籤，
// 村莊照使用者給的規則（預設＋隸屬王國選一＋問題選一），城鎮照規則書的城鎮規則。
// 防禦與兵力還沒有對應的玩法，相關的標籤、選項與問題先不做。
// 每個聚落附近另外放一處獨特的地貌（廢棄的堡壘、古老立石⋯⋯）。
(function () {
  const C = FE.CONFIG;

  FE.PROSPERITY = ['荒蕪', '貧窮', '普通', '繁盛', '富裕'];
  FE.POPULATION = ['大舉遷出', '縮減', '穩定', '成長', '急速發展'];

  // 聚落周圍最多的生態區出產什麼（暫用）
  const RESOURCES = {
    plain: '穀物', grassland: '穀物', shrubland: '草藥', forest: '木材', taiga: '木材', tundra: '毛皮', glacier: '毛皮',
    jungle: '香料', savanna: '獸皮', desert: '鹽', marsh: '魚', swamp: '泥炭', mountain: '鐵礦', lake: '魚',
  };
  // 工藝與它需要的資源、奇特的貨物、城鎮缺的物資（暫用）
  const CRAFTS = { 鍛鐵: '鐵礦', 釀酒: '穀物', 織布: '羊毛', 製陶: '黏土', 製革: '獸皮' };
  const EXOTICS = ['星鐵', '冰晶', '夜光苔', '龍骨'];
  const NEEDS = ['食物', '木材', '鐵礦'];

  // 標籤的說明，聚落面板用；有玩法效果的寫在後面
  const TAG_INFO = {
    資源: '這裡盛產',
    需求: '這裡缺',
    誓約關係: '與這個聚落立有誓約',
    貿易關係: '與這個聚落固定往來買賣',
    敵對關係: '與這個聚落不和',
    市場: '四方商人都來這裡交易；武器改良便宜一成',
    歷史: '這裡發生過重要的事',
    神聖: '受神明眷顧；附近倒下的冒險者會在這裡醒來',
    力量: '握有力量；附近倒下的冒險者會在這裡醒來',
    信仰: '居民十分虔誠',
    奇特: '有別處沒有的東西',
    重要人士: '住著有名的人物',
    禍害: '附近常有東西出沒；更常請人清除小怪物',
    無法地帶: '沒有人管事',
    工藝: '以這門手藝聞名',
    矮人族: '住著矮人',
    精靈族: '住著精靈',
  };

  // 村莊：預設 貧窮、穩定、資源、誓約關係
  const VILLAGE_OPTIONS = [
    { name: '豐富資源', apply: (s, x) => { s.prosperity++; x.add('資源', x.second()); x.rel('敵對關係'); } },
    { name: '主要道路', apply: (s, x) => { x.rel('貿易關係'); s.prosperity++; } },
    { name: '法師塔', apply: (s, x) => { x.add('重要人士', '法師'); x.add('禍害', '奧法生物'); } },
    { name: '宗教場所', apply: (s, x) => { x.add('神聖'); x.add('歷史'); } },
  ];
  const VILLAGE_PROBLEMS = [
    { name: '旱季', apply: (s, x) => x.add('需求', '食物') },
    { name: '虔誠', apply: (s, x) => { x.add('信仰'); x.rel('敵對關係'); } },
    { name: '怪物', apply: (s, x) => { x.add('禍害', '怪物'); x.add('需求', '冒險者'); } },
    { name: '兼併', apply: (s, x) => { s.population++; x.add('無法地帶'); } },
    { name: '偏僻', apply: (s, x) => { s.prosperity--; x.add(FE.pick(x.rng, ['矮人族', '精靈族'])); } },
  ];
  // 城鎮：預設 普通、穩定、貿易關係（兩個）；選項與問題的名稱是暫譯
  const TOWN_OPTIONS = [
    { name: '新興', apply: (s, x) => { s.population = 4; x.add('無法地帶'); } },
    { name: '交通要衝', apply: (s, x) => { x.add('市場'); s.prosperity++; } },
    { name: '宗教中心', apply: (s, x) => x.add('力量', '神聖') },
    { name: '工藝之城', apply: (s, x) => { const c = FE.pick(x.rng, Object.keys(CRAFTS)); x.add('工藝', c); x.add('資源', CRAFTS[c]); } },
  ];
  const TOWN_PROBLEMS = [
    { name: '物資不足', apply: (s, x) => { const n = FE.pick(x.rng, NEEDS); x.add('需求', n); x.rel('貿易關係', n); } },
    { name: '亡命之徒', apply: (s, x) => { x.add('重要人士', '亡命之徒'); x.rel('敵對關係'); } },
    { name: '壟斷市場', apply: (s, x) => { x.add('奇特', FE.pick(x.rng, EXOTICS)); x.rel('敵對關係'); } },
    { name: '疫病', apply: (s) => { s.population--; } },
    { name: '熱門聚會地', apply: (s, x) => { s.population++; x.add('無法地帶'); } },
  ];

  const RELATIONS = ['誓約關係', '貿易關係', '敵對關係'];

  // 聚落周圍（村莊整平過，看外面）最多的生態區
  function localBiome(world, v) {
    const count = {};
    for (let y = v.y0 - 6; y <= v.y1 + 6; y++) {
      for (let x = v.x0 - 6; x <= v.x1 + 6; x++) {
        const c = world.cell(x, y);
        if (c && !world.villageAt(x, y) && c.biome !== 'plain') count[c.biome] = (count[c.biome] || 0) + 1;
      }
    }
    return Object.keys(count).sort((a, b) => count[b] - count[a])[0] || 'plain';
  }

  // 跟另一個聚落的關係：優先挑還沒跟這裡有任何關係的聚落（免得同一個聚落又是誓約又是敵對），
  // 沒有的話挑還沒有同種關係的；還沒有別的聚落時先空著，等下一個聚落出現再補上
  function pickOther(world, rng, v, s, k) {
    const rels = s.tags.filter((t) => t.rel !== undefined);
    const any = new Set(rels.map((t) => t.rel));
    const same = new Set(rels.filter((t) => t.k === k).map((t) => t.rel));
    const others = world.villages.filter((o) => o.id !== v.id);
    const fresh = others.filter((o) => !any.has(o.id));
    const pool = fresh.length ? fresh : others.filter((o) => !same.has(o.id));
    return pool.length ? FE.pick(rng, pool).id : null;
  }

  function fillRelations(world, rng, v) {
    for (const o of world.villages) {
      if (o.id === v.id || !o.steading) continue;
      for (const t of o.steading.tags) {
        if (!RELATIONS.includes(t.k) || t.rel !== null) continue;
        if (o.steading.tags.some((u) => u.k === t.k && u.rel === v.id)) continue;
        t.rel = v.id;
      }
    }
  }

  function roll(world, rng, v) {
    const town = v.kind === 'town';
    const s = { prosperity: town ? 2 : 1, population: 2, tags: [], option: null, problem: null };
    const biome = localBiome(world, v);
    const res = RESOURCES[biome];
    const x = {
      rng,
      add(k, a) {
        if (!s.tags.some((t) => t.k === k && t.a === a)) s.tags.push(a === undefined ? { k } : { k, a });
      },
      rel(k, a) {
        const t = { k, rel: pickOther(world, rng, v, s, k) };
        if (a) t.a = a;
        s.tags.push(t);
      },
      // 豐富資源：另一樣出產，跟預設的資源不同
      second() {
        const pool = [...new Set(Object.values(RESOURCES))].filter((r) => r !== res);
        return FE.pick(rng, pool);
      },
    };
    if (town) {
      x.rel('貿易關係');
      x.rel('貿易關係');
    } else {
      x.add('資源', res);
      x.rel('誓約關係');
    }
    const opt = FE.pick(rng, town ? TOWN_OPTIONS : VILLAGE_OPTIONS);
    const prob = FE.pick(rng, town ? TOWN_PROBLEMS : VILLAGE_PROBLEMS);
    s.option = opt.name;
    s.problem = prob.name;
    opt.apply(s, x);
    prob.apply(s, x);
    s.prosperity = Math.max(0, Math.min(4, s.prosperity));
    s.population = Math.max(0, Math.min(4, s.population));
    v.steading = s;
    fillRelations(world, rng, v);
    return s;
  }

  const has = (v, k, a) => !!(v && v.steading && v.steading.tags.some((t) => t.k === k && (a === undefined || t.a === a)));

  // 人口決定住多少村民（不含武器匠）
  function villagerCount(rng, v) {
    const p = v.steading ? v.steading.population : 2;
    if (v.kind === 'town') return [4, 6, FE.randInt(rng, C.TOWN_VILLAGERS[0], C.TOWN_VILLAGERS[1]), 10, 11][p];
    return [1, 2, FE.randInt(rng, 3, 4), 5, 6][p];
  }

  // 經濟決定武器匠的價錢；有市場再便宜一成
  function smithFactor(v) {
    if (!v || !v.steading) return 1;
    const f = [1.6, 1.3, 1, 0.85, 0.7][v.steading.prosperity];
    return has(v, '市場') ? f * 0.9 : f;
  }

  // 需求（冒險者）：這裡的委託獎勵多五成
  const rewardFactor = (v) => (has(v, '需求', '冒險者') ? 1.5 : 1);

  const isHoly = (v) => has(v, '神聖') || has(v, '力量', '神聖');

  // 有關係的聚落（委託優先送到這些地方）
  function related(v) {
    if (!v || !v.steading) return [];
    return v.steading.tags.filter((t) => (t.k === '誓約關係' || t.k === '貿易關係') && t.rel !== null).map((t) => t.rel);
  }

  function tagText(world, t) {
    if (RELATIONS.includes(t.k)) {
      const o = t.rel !== null ? world.villageById(t.rel) : null;
      const who = o ? o.name : '遠方的聚落';
      return `${t.k}（${who}${t.a ? '，' + t.a : ''}）`;
    }
    return t.a ? `${t.k}（${t.a}）` : t.k;
  }

  // 聚落面板用：每個標籤一行，附說明
  function describe(world, v) {
    const s = v.steading;
    if (!s) return [];
    return s.tags.map((t) => {
      let info = TAG_INFO[t.k] || '';
      if (t.k === '資源' || t.k === '需求') info += t.a;
      if (t.k === '需求' && t.a === '冒險者') info += '；委託獎勵多五成';
      return { text: tagText(world, t), info };
    });
  }

  // ---- 聚落的外形 ----
  // 先在工作範圍（外框）裡排路、廣場、建築，再沿著「路＋廣場＋建築外牆」的外緣留一格走道，走道外面一圈蓋外牆
  // （城鎮 W 石牆、村莊 w 木牆，只是圍起來，不是防禦）。外牆貼著建築，所以會跟著建築凹凸，不是橢圓；
  // 走道與牆之間沒用到的零碎空地保留成空地，走不到的併進牆。排完聚落的範圍縮到外牆的外接矩形。
  // 水（≈）和巨石（#）是擋路的邊界：建築與小巷不蓋在上面，外牆只蓋在外面能走的地方（碰到水或巨石的那一側不蓋牆）；
  // 大路寬 3 格，從中央直接通出外牆，經過的巨石會清掉；出入口外的路鋪過外圍三圈的坡。
  // 建築都有外牆和門，門開在路邊：鐵匠工坊、城鎮的神殿或市場、民房。每蓋一棟都確認聚落裡能走的地方仍然連在一起。
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const BUILDING_WALLS = '⌂∩♦';
  // 排版用的格子：' ' 聚落外面、'.' 空地、'·' 路、W／w 外牆、',' 室內地板（寫進世界時換成 '.'）、'+' 門，
  // 其他是建築外牆與家具
  const WALK = new Set(['.', '·', ',', '+', '≡']);
  const BLOCKING = new Set(['π', '▌', '╤', '¤', '╥']);

  // 室內形狀：最小的房屋用俄羅斯方塊 J、L、O、S、T、Z（4 格，不用 I），8 格的房屋用兩條 I 並排（2×4）
  const TETROMINOES = [['#..', '###'], ['..#', '###'], ['##', '##'], ['.##', '##.'], ['###', '.#.'], ['##.', '.##']];
  const fromRows = (rows) => rows.flatMap((r, y) => [...r].map((ch, x) => (ch === '#' ? [x, y] : null)).filter(Boolean));
  const rectCells = (w, h) => Array.from({ length: w * h }, (_, i) => [i % w, Math.floor(i / w)]);
  // 旋轉、翻面後所有不同的擺法
  function orientations(cells) {
    const out = new Map();
    let cur = cells;
    for (let f = 0; f < 2; f++) {
      for (let r = 0; r < 4; r++) {
        cur = cur.map(([x, y]) => [-y, x]);
        const mx = Math.min(...cur.map((c) => c[0]));
        const my = Math.min(...cur.map((c) => c[1]));
        const norm = cur.map(([x, y]) => [x - mx, y - my]).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
        out.set(JSON.stringify(norm), norm);
      }
      cur = cur.map(([x, y]) => [-x, y]);
    }
    return [...out.values()];
  }

  // 建築：外牆字元、室內形狀、門數、家具。spot 是站人的格子（住戶、鐵匠），貼著門內那一格，進門就能對話；
  // 擋路的家具不能把室內切開；門內那一格一律空著。家具先只有符號，還沒有作用
  const BUILDINGS = {
    house: { wall: '⌂', shapes: TETROMINOES.flatMap((r) => orientations(fromRows(r))), doors: 1, spot: true, items: ['≡', '▌'] },
    big: { wall: '⌂', shapes: orientations(rectCells(4, 2)), doors: 1, items: ['π', '▌'] }, // 住 2～3 人，床另外加
    smithy: { wall: '⌂', shapes: orientations(rectCells(3, 2)), doors: 1, spot: true, items: ['╤'] },
    temple: { wall: '∩', shapes: orientations(rectCells(4, 3)), doors: 1, items: ['¤'] },
    market: { wall: '♦', shapes: orientations(rectCells(5, 2)), doors: 2, items: ['╥', '╥', '╥'] },
  };

  function shuffle(rng, arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  const ckey = (c) => c[0] + ',' + c[1];
  const adjacent = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) === 1;

  function connected(cells) {
    if (!cells.length) return true;
    const set = new Set(cells.map(ckey));
    const seen = new Set([ckey(cells[0])]);
    const q = [cells[0]];
    for (let h = 0; h < q.length; h++) {
      for (const [dx, dy] of DIRS) {
        const n = [q[h][0] + dx, q[h][1] + dy];
        if (set.has(ckey(n)) && !seen.has(ckey(n))) {
          seen.add(ckey(n));
          q.push(n);
        }
      }
    }
    return seen.size === set.size;
  }

  // 擺家具：門內那一格空著，站人的格子貼著它，擋路的家具不把室內切開
  function furnish(rng, cells, inners, def, beds) {
    const innerKeys = new Set(inners.map(ckey));
    const items = def.items.concat(Array(beds).fill('≡'));
    for (let tries = 0; tries < 40; tries++) {
      const free = shuffle(rng, cells.filter((c) => !innerKeys.has(ckey(c))));
      let spot = null;
      if (def.spot) {
        const i = free.findIndex((c) => inners.some((d) => adjacent(c, d)));
        if (i < 0) return null;
        spot = free.splice(i, 1)[0];
      }
      if (free.length < items.length) return null;
      const placed = items.map((ch, i) => [free[i][0], free[i][1], ch]);
      const blocked = new Set(placed.filter((p) => BLOCKING.has(p[2])).map(ckey));
      if (connected(cells.filter((c) => !blocked.has(ckey(c))))) return { placed, spot };
    }
    return null;
  }

  // 出入口可以開在哪些方向（東、西、南、北）：從中央往外鋪 3 格寬的通道，一直鋪到工作範圍外三格，通道上不能有水
  // （巨石可以，路經過時清掉）。外面被水擋住的方向就不開，換另一個方向
  function exitViable(world, box) {
    return DIRS.map(([dx, dy]) => {
      const lim = dx > 0 ? box.x1 + 3 : dx < 0 ? box.x0 - 3 : dy > 0 ? box.y1 + 3 : box.y0 - 3;
      for (let o = -1; o <= 1; o++) {
        let x = box.cx + (dy ? o : 0);
        let y = box.cy + (dx ? o : 0);
        while (dx ? (dx > 0 ? x <= lim : x >= lim) : dy > 0 ? y <= lim : y >= lim) {
          const c = world.cell(x, y);
          if (c && c.t === '≈') return false;
          x += dx;
          y += dy;
        }
      }
      return true;
    });
  }

  // 選址的評分：能開出至少 3 個出入口、中央沒有水，周圍有一段連續的水或巨石就加分（聚落靠水、靠巨石蓋），
  // 工作範圍裡擋路的格子太多則扣分（排不下內容）
  function siteScore(world, box, town) {
    let score = 0;
    const open = exitViable(world, box).filter(Boolean).length;
    if (open < 3) score -= 500;
    else if (town && open < 4) score -= 3;
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -5; dx <= 5; dx++) {
        const c = world.cell(box.cx + dx, box.cy + dy);
        if (c && c.t === '≈') score -= 300;
      }
    }
    const hx = (box.x1 - box.x0) / 2;
    const hy = (box.y1 - box.y0) / 2;
    const blocked = new Set();
    let inBox = 0;
    for (let y = box.y0 - 3; y <= box.y1 + 3; y++) {
      for (let x = box.x0 - 3; x <= box.x1 + 3; x++) {
        const c = world.cell(x, y);
        if (!c || (c.t !== '≈' && c.t !== '#')) continue;
        blocked.add(ckey([x, y]));
        if (x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1) inBox++;
      }
    }
    // 離中央夠遠的那一段（外緣）有連續 6 格以上的水或巨石，就算靠著
    let feature = 0;
    const seen = new Set();
    for (const k of blocked) {
      if (seen.has(k)) continue;
      const comp = [k.split(',').map(Number)];
      seen.add(k);
      for (let i = 0; i < comp.length; i++) {
        for (const [dx, dy] of DIRS) {
          const n = [comp[i][0] + dx, comp[i][1] + dy];
          if (blocked.has(ckey(n)) && !seen.has(ckey(n))) {
            seen.add(ckey(n));
            comp.push(n);
          }
        }
      }
      if (comp.some(([x, y]) => Math.abs(x - box.cx) > hx * 0.5 || Math.abs(y - box.cy) > hy * 0.5)) feature = Math.max(feature, comp.length);
    }
    if (feature >= 6) score += 6 + Math.min(feature, 24) * 0.25;
    return score - inBox * 0.15;
  }

  // 排一次聚落：路、廣場、建築，再沿著外緣留一格走道、走道外面蓋外牆。回傳排版結果，蓋不齊時 ok 是 false。
  // 座標都是工作範圍（外框）裡的相對座標；回傳的格子 ' ' 是聚落外面，其他是聚落（外牆、走道、路、建築）
  function plan(world, rng, v, want, cap, extra, viable) {
    const town = v.kind === 'town';
    const W = v.x1 - v.x0 + 1;
    const H = v.y1 - v.y0 + 1;
    const cx = v.cx - v.x0;
    const cy = v.cy - v.y0;
    const wall = town ? 'W' : 'w';
    const arms = town ? C.TOWN_ARMS : C.VILLAGE_ARMS;

    // 出入口：村莊東、西再加南北其中一個（隨機 3 或 4 個，3 個時南北隨機挑一邊），城鎮四個方向都開；外面被水擋住的方向換掉，至少 3 個
    const open = DIRS.filter((d, i) => viable[i]);
    let chosen;
    if (town) {
      chosen = open;
    } else {
      const ew = open.filter((d) => d[1] === 0);
      const ns = shuffle(rng, open.filter((d) => d[0] === 0));
      chosen = ew.concat(ns.slice(0, Math.max(0, (rng() < 0.5 ? 3 : 4) - ew.length)));
    }

    // 擋路的格子：1 巨石、2 水
    const blk = [];
    for (let y = 0; y < H; y++) {
      const row = [];
      for (let x = 0; x < W; x++) {
        const c = world.cell(v.x0 + x, v.y0 + y);
        row.push(!c || c.t === '≈' ? 2 : c.t === '#' ? 1 : 0);
      }
      blk.push(row);
    }
    // 排版用的格子：' ' 不能蓋東西（離工作範圍的邊兩格內，留給走道與外牆）、'X' 擋路或走不到、'G' 出入口預留、其他見 WALK／BUILDING_WALLS
    const g = Array.from({ length: H }, () => Array(W).fill(' '));
    for (let y = 2; y <= H - 3; y++) for (let x = 2; x <= W - 3; x++) g[y][x] = blk[y][x] ? 'X' : '.';
    const rkind = Array.from({ length: H }, () => Array(W).fill('')); // 'm' 大路與廣場、'l' 小巷
    const inR = (x, y) => x >= 2 && x <= W - 3 && y >= 2 && y <= H - 3;
    // force：大路與廣場經過巨石就清掉；小巷碰到水或巨石就斷開
    const road = (x, y, k, force) => {
      if (!inR(x, y) || (g[y][x] === 'X' && !force)) return;
      g[y][x] = '·';
      rkind[y][x] = k;
    };
    const pw = town ? 4 : 2;
    const ph = town ? 2 : 1;
    for (let dy = -ph; dy <= ph; dy++) for (let dx = -pw; dx <= pw; dx++) road(cx + dx, cy + dy, 'm', true);
    for (const [dx, dy] of chosen) {
      const len = dx ? arms[0] : arms[1];
      for (let i = 1; i <= len; i++) for (let o = -1; o <= 1; o++) road(cx + dx * i + (dy ? o : 0), cy + dy * i + (dx ? o : 0), 'm', true);
      // 出入口預留：大路盡頭外面的通道不蓋東西，之後外牆在這裡打開
      for (let i = len + 1; i < len + 6; i++) {
        for (let o = -1; o <= 1; o++) {
          const x = cx + dx * i + (dy ? o : 0);
          const y = cy + dy * i + (dx ? o : 0);
          if (inR(x, y) && g[y][x] !== '·') g[y][x] = 'G';
        }
      }
    }
    // 小巷：城鎮在大路上下各一條橫的、左右各一條直的，村莊一條直的
    const lane = (x, y) => {
      if (inR(x, y) && g[y][x] === '.') {
        g[y][x] = '·';
        rkind[y][x] = 'l';
      }
    };
    if (town) {
      const [lx, ly] = C.TOWN_LANE;
      for (const s of [-1, 1]) {
        for (let y = cy - ly; y <= cy + ly; y++) lane(cx + s * lx, y);
        for (let x = cx - arms[0] + 2; x <= cx + arms[0] - 2; x++) lane(x, cy + s * ly);
      }
    } else {
      const lx = cx + FE.pick(rng, [-C.VILLAGE_LANE, C.VILLAGE_LANE]);
      for (let y = cy - arms[1]; y <= cy + arms[1]; y++) lane(lx, y);
    }

    const at = (x, y) => (x < 0 || x >= W || y < 0 || y >= H ? ' ' : g[y][x]);
    const walk = (ch) => WALK.has(ch);
    // 從中央走得到的地方
    const flood = () => {
      const seen = new Set([cx + ',' + cy]);
      const q = [[cx, cy]];
      for (let h = 0; h < q.length; h++) {
        const [x, y] = q[h];
        for (const [dx, dy] of DIRS) {
          const k = x + dx + ',' + (y + dy);
          if (!seen.has(k) && walk(at(x + dx, y + dy))) {
            seen.add(k);
            q.push([x + dx, y + dy]);
          }
        }
      }
      return seen;
    };
    // 被水或巨石切開、從中央走不到的零碎空地不能蓋東西
    const reach0 = flood();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (walk(g[y][x]) && !reach0.has(x + ',' + y)) g[y][x] = 'X';

    const buildings = [];
    // 蓋一棟建築：在每種擺法、每個位置裡找外牆落在空地（或跟別棟共用外牆）、門外是路的地方；
    // 跟別棟共用越多外牆、越靠近中央越好。蓋了之後能走的地方要仍然連在一起
    const place = (kind, beds) => {
      const def = BUILDINGS[kind];
      const central = kind !== 'house' && kind !== 'big';
      const cands = [];
      for (const shape of def.shapes) {
        const bw = Math.max(...shape.map((c) => c[0])) + 1;
        const bh = Math.max(...shape.map((c) => c[1])) + 1;
        const inside = new Set(shape.map(([x, y]) => x + 1 + ',' + (y + 1)));
        // 門的位置：外牆上貼著室內的格子（不會是四角），門外那一格要是路
        const slots = [];
        for (const [x, y] of shape) {
          for (const [dx, dy] of DIRS) {
            const nx = x + 1 + dx;
            const ny = y + 1 + dy;
            if (nx === 0 || ny === 0 || nx === bw + 1 || ny === bh + 1) slots.push({ d: [nx, ny], inner: [x + 1, y + 1], out: [nx + dx, ny + dy] });
          }
        }
        for (let oy = 0; oy + bh + 2 <= H; oy++) {
          for (let ox = 0; ox + bw + 2 <= W; ox++) {
            // 先看門外有沒有路，沒有就不必量整塊地
            const doors = slots.filter((s) => g[oy + s.d[1]][ox + s.d[0]] === '.' && at(ox + s.out[0], oy + s.out[1]) === '·');
            if (doors.length < def.doors) continue;
            let ok = true;
            let shared = 0;
            for (let ly = 0; ly < bh + 2 && ok; ly++) {
              for (let lx = 0; lx < bw + 2; lx++) {
                const ch = g[oy + ly][ox + lx];
                if (ch === '.') continue;
                if (!inside.has(lx + ',' + ly) && BUILDING_WALLS.includes(ch)) {
                  shared++;
                  continue;
                }
                ok = false;
                break;
              }
            }
            if (!ok) continue;
            const dist = Math.abs(ox + bw / 2 + 1 - cx) + Math.abs(oy + bh / 2 + 1 - cy);
            cands.push({ shape, ox, oy, bw, bh, doors, score: shared * 2 + rng() * 4 - dist * (central ? 0.4 : 0.25) });
          }
        }
      }
      cands.sort((a, b) => b.score - a.score);
      for (const c of cands.slice(0, 30)) {
        const ds = shuffle(rng, c.doors.slice());
        const doors = [ds[0]];
        for (const d of ds) if (doors.length < def.doors && !doors.some((o) => ckey(o.inner) === ckey(d.inner))) doors.push(d);
        if (doors.length < def.doors) continue;
        const cells = c.shape.map(([x, y]) => [c.ox + x + 1, c.oy + y + 1]);
        const inners = doors.map((d) => [c.ox + d.inner[0], c.oy + d.inner[1]]);
        const fur = furnish(rng, cells, inners, def, beds);
        if (!fur) continue;
        const prev = [];
        const put = (x, y, ch) => {
          prev.push([x, y, g[y][x]]);
          g[y][x] = ch;
        };
        for (let ly = 0; ly < c.bh + 2; ly++) for (let lx = 0; lx < c.bw + 2; lx++) if (g[c.oy + ly][c.ox + lx] === '.') put(c.ox + lx, c.oy + ly, def.wall);
        for (const [x, y] of cells) put(x, y, ',');
        const doorCells = doors.map((d) => [c.ox + d.d[0], c.oy + d.d[1]]);
        for (const [x, y] of doorCells) put(x, y, '+');
        for (const [x, y, ch] of fur.placed) put(x, y, ch);
        // 能走的格子：原本的空地少了外牆和擋路家具佔掉的，多了室內地板、門、床
        let count = 0;
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (walk(g[y][x])) count++;
        if (flood().size === count) {
          const b = {
            kind,
            x0: c.ox,
            y0: c.oy,
            x1: c.ox + c.bw + 1,
            y1: c.oy + c.bh + 1,
            cells,
            doors: doorCells,
            beds: fur.placed.filter((p) => p[2] === '≡').map(([x, y]) => [x, y]),
            spots: fur.spot ? [fur.spot] : [],
          };
          // 8 格的房屋：住戶站在自己的床上
          if (kind === 'big') b.spots = b.beds.slice();
          buildings.push(b);
          return b;
        }
        for (let i = prev.length - 1; i >= 0; i--) g[prev[i][1]][prev[i][0]] = prev[i][2];
      }
      return null;
    };

    const smithy = place('smithy', 0);
    const extrasOk = extra.map((k) => place(k, 0)).every(Boolean);
    // 民房：床位至少要夠聚落住滿（村莊 6 人、城鎮 12 人）。剩下的都蓋小屋也不夠時就蓋 8 格的房屋
    let houses = 0;
    let bedCount = 0;
    for (let i = 0; i < want; i++) {
      const need = cap - bedCount - (want - i - 1);
      let b = null;
      if (need > 1 || rng() < 0.25) b = place('big', need > 1 ? Math.min(3, need) : FE.randInt(rng, 2, 3));
      if (!b) b = place('house', 0);
      if (!b) break;
      houses++;
      bedCount += b.beds.length;
    }

    // 小巷只留用得到的：從中央到每道門外那一格的最短路上的小巷留下，其他的收回成空地
    const pv = new Map([[cx + ',' + cy, null]]);
    const pq = [[cx, cy]];
    for (let h = 0; h < pq.length; h++) {
      for (const [dx, dy] of DIRS) {
        const nx = pq[h][0] + dx;
        const ny = pq[h][1] + dy;
        if (at(nx, ny) === '·' && !pv.has(nx + ',' + ny)) {
          pv.set(nx + ',' + ny, pq[h][0] + ',' + pq[h][1]);
          pq.push([nx, ny]);
        }
      }
    }
    const keep = new Set();
    for (const b of buildings) {
      for (const [x, y] of b.doors) {
        for (const [dx, dy] of DIRS) {
          let k = at(x + dx, y + dy) === '·' ? x + dx + ',' + (y + dy) : null;
          while (k && !keep.has(k)) {
            keep.add(k);
            k = pv.get(k);
          }
        }
      }
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (rkind[y][x] === 'l' && g[y][x] === '·' && !keep.has(x + ',' + y)) g[y][x] = '.';

    // 外形：1 路＋廣場＋建築（含外牆）、2 走道（外緣再留一格，鋪成路；使用者要求房屋與外牆之間不留空地）、3 外牆（走道外面一圈）。
    // 水和巨石不蓋走道也不蓋牆（碰到的那一側就以它們為界）
    const cls = Array.from({ length: H }, () => Array(W).fill(0));
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (!' .XG'.includes(g[y][x])) cls[y][x] = 1;
    const near = (x, y, test) => {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && x + dx >= 0 && x + dx < W && y + dy >= 0 && y + dy < H && test(cls[y + dy][x + dx])) return true;
      return false;
    };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (cls[y][x] === 0 && !blk[y][x] && near(x, y, (c) => c === 1)) cls[y][x] = 2;
    // 走道要從中央走得到，不然併進牆
    // 出入口：大路寬 3 格，直接通出走道與外牆（大路盡頭外的 2 格換成路）；外面的路（approach）鋪到工作範圍外三格，
    // 再鋪過外圍三圈的坡。外牆在這裡打開，出入口外面不能有走道或牆
    const approach = [];
    const openGaps = () => {
      approach.length = 0;
      for (const [dx, dy] of chosen) {
        const len = dx ? arms[0] : arms[1];
        for (let o = -1; o <= 1; o++) {
          for (let i = len + 1; ; i++) {
            const x = cx + dx * i + (dy ? o : 0);
            const y = cy + dy * i + (dx ? o : 0);
            if (x < -3 || x > W + 2 || y < -3 || y > H + 2) break;
            if (i <= len + 2) {
              g[y][x] = '·';
              cls[y][x] = 1;
            } else {
              if (x >= 0 && x < W && y >= 0 && y < H) cls[y][x] = 0;
              approach.push([x, y]);
            }
          }
        }
      }
    };
    openGaps();
    const reachAll = () => {
      const seen = new Set([cx + ',' + cy]);
      const sq = [[cx, cy]];
      for (let h = 0; h < sq.length; h++) {
        for (const [dx, dy] of DIRS) {
          const nx = sq[h][0] + dx;
          const ny = sq[h][1] + dy;
          if (nx < 0 || nx >= W || ny < 0 || ny >= H || seen.has(nx + ',' + ny)) continue;
          if (cls[ny][nx] === 2 || (cls[ny][nx] === 1 && walk(g[ny][nx]))) {
            seen.add(nx + ',' + ny);
            sq.push([nx, ny]);
          }
        }
      }
      return seen;
    };
    let seenP = reachAll();
    // 小巷、門被水或巨石、別棟的外牆隔開而走不到時，從那裡打一條走道接到走得到的地方
    for (let round = 0; round < 12; round++) {
      const lost = [];
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (cls[y][x] === 1 && walk(g[y][x]) && !seenP.has(x + ',' + y)) lost.push([x, y]);
      if (!lost.length) break;
      const prev = new Map(lost.map(([x, y]) => [x + ',' + y, null]));
      const bq = lost.slice();
      let hit = null;
      for (let h = 0; h < bq.length && !hit; h++) {
        for (const [dx, dy] of DIRS) {
          const nx = bq[h][0] + dx;
          const ny = bq[h][1] + dy;
          const nk = nx + ',' + ny;
          if (nx < 0 || nx >= W || ny < 0 || ny >= H || prev.has(nk)) continue;
          if (seenP.has(nk)) {
            hit = bq[h];
            break;
          }
          if ((cls[ny][nx] === 0 || cls[ny][nx] === 2) && !blk[ny][nx]) {
            prev.set(nk, bq[h][0] + ',' + bq[h][1]);
            bq.push([nx, ny]);
          }
        }
      }
      if (!hit) break;
      for (let k = hit[0] + ',' + hit[1]; k && prev.get(k) !== null; k = prev.get(k)) {
        const [px, py] = k.split(',').map(Number);
        cls[py][px] = 2;
      }
      seenP = reachAll();
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (cls[y][x] === 2 && !seenP.has(x + ',' + y)) cls[y][x] = 3;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (cls[y][x] === 0 && !blk[y][x] && near(x, y, (c) => c === 1 || c === 2)) cls[y][x] = 3;
    // 走道與牆圍起來、外面進不來的零碎空地併進牆：從外框邊緣往裡走得到的才是外面
    const outside = new Set();
    const oq = [];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if ((x === 0 || y === 0 || x === W - 1 || y === H - 1) && cls[y][x] === 0) {
          outside.add(x + ',' + y);
          oq.push([x, y]);
        }
      }
    }
    for (let h = 0; h < oq.length; h++) {
      for (const [dx, dy] of DIRS) {
        const nx = oq[h][0] + dx;
        const ny = oq[h][1] + dy;
        if (nx >= 0 && nx < W && ny >= 0 && ny < H && cls[ny][nx] === 0 && !outside.has(nx + ',' + ny)) {
          outside.add(nx + ',' + ny);
          oq.push([nx, ny]);
        }
      }
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (cls[y][x] === 0 && !blk[y][x] && !outside.has(x + ',' + y)) cls[y][x] = 3;

    // 出入口：大路寬 3 格，直接通出走道與外牆；外面的路（approach）鋪到工作範圍外三格，再鋪過外圍三圈的坡
    // 走道要從中央走得到，所以出入口在算走道之前先開好，算完牆之後再開一次（牆不能蓋進出入口外面）
    openGaps();

    const out = Array.from({ length: H }, (_, y) => Array.from({ length: W }, (_, x) => (cls[y][x] === 1 ? g[y][x] : cls[y][x] === 2 ? '·' : cls[y][x] === 3 ? wall : ' ')));
    // 最後確認：聚落裡每一格能走的地方都從中央走得到。走道走不到的併進牆；路、門、室內走不到就這次排版作廢
    const fin = new Set([cx + ',' + cy]);
    const fq = [[cx, cy]];
    for (let h = 0; h < fq.length; h++) {
      for (const [dx, dy] of DIRS) {
        const nx = fq[h][0] + dx;
        const ny = fq[h][1] + dy;
        if (nx >= 0 && nx < W && ny >= 0 && ny < H && !fin.has(nx + ',' + ny) && walk(out[ny][nx])) {
          fin.add(nx + ',' + ny);
          fq.push([nx, ny]);
        }
      }
    }
    let connected = true;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (!walk(out[y][x]) || fin.has(x + ',' + y)) continue;
        if (out[y][x] === '.') out[y][x] = wall;
        else connected = false;
      }
    }
    return { g: out, approach, entrances: chosen.length, buildings, houses, beds: bedCount, ok: connected && !!smithy && extrasOk && houses === want && bedCount >= cap && chosen.length >= 3 };
  }

  // 聚落排版：排不齊就換一組亂數重排，最多 6 次，取最好的一次。
  // 排完聚落的範圍（x0,y0,x1,y1）縮到外牆的外接矩形，mask、rooms、buildings 跟著換算；cx,cy 維持中央廣場
  function layout(world, rng, v) {
    const town = v.kind === 'town';
    const want = (town ? C.TOWN_HOUSES : C.VILLAGE_HOUSES)[v.steading ? v.steading.population : 2];
    const cap = town ? C.TOWN_MAX_NPC : C.VILLAGE_MAX_NPC;
    // 神殿、市場只蓋在城鎮（使用者決定村莊不蓋神殿）
    const extra = [];
    if (town && (isHoly(v) || has(v, '信仰'))) extra.push('temple');
    if (town && has(v, '市場')) extra.push('market');
    const viable = exitViable(world, v);
    let best = null;
    for (let attempt = 0; attempt < 6; attempt++) {
      const p = plan(world, rng, v, want, cap, extra, viable);
      p.score = (p.ok ? 1000 : 0) + p.houses * 10 + Math.min(p.beds, cap) + (p.buildings.some((b) => b.kind === 'smithy') ? 100 : 0) + p.entrances * 5;
      if (!best || p.score > best.score) best = p;
      if (p.ok) break;
    }
    const { g, approach, buildings } = best;
    const ox = v.x0;
    const oy = v.y0;
    if (!v.flat) v.flat = { x0: v.x0, y0: v.y0, x1: v.x1, y1: v.y1 };
    // 外牆的外接矩形（工作範圍裡的相對座標）
    let bx0 = Infinity;
    let by0 = Infinity;
    let bx1 = -Infinity;
    let by1 = -Infinity;
    for (let y = 0; y < g.length; y++) {
      for (let x = 0; x < g[y].length; x++) {
        if (g[y][x] === ' ') continue;
        bx0 = Math.min(bx0, x);
        bx1 = Math.max(bx1, x);
        by0 = Math.min(by0, y);
        by1 = Math.max(by1, y);
      }
    }
    const crop = (fn) => {
      const rows = [];
      for (let y = by0; y <= by1; y++) {
        let s = '';
        for (let x = bx0; x <= bx1; x++) s += fn(x, y);
        rows.push(s);
      }
      return rows;
    };
    const toWorld = ([x, y]) => [x + ox, y + oy];
    v.mask = crop((x, y) => (g[y][x] === ' ' ? ' ' : '#'));
    // rooms：每列一個字串，建築的室內與門標上建築的編號（A 起），其他是空白
    const rooms = g.map((row) => row.map(() => ' '));
    buildings.forEach((b, i) => {
      for (const [x, y] of b.cells.concat(b.doors)) rooms[y][x] = String.fromCharCode(65 + i);
    });
    v.rooms = crop((x, y) => rooms[y][x]);
    v.buildings = buildings.map((b) => ({
      kind: b.kind,
      x0: b.x0 + ox,
      y0: b.y0 + oy,
      x1: b.x1 + ox,
      y1: b.y1 + oy,
      doors: b.doors.map(toWorld),
      beds: b.beds.map(toWorld),
      spots: b.spots.map(toWorld),
    }));
    v.entrances = best.entrances;
    v.x0 = bx0 + ox;
    v.y0 = by0 + oy;
    v.x1 = bx1 + ox;
    v.y1 = by1 + oy;
    for (let y = 0; y < g.length; y++) {
      for (let x = 0; x < g[y].length; x++) {
        const ch = g[y][x];
        if (ch !== ' ') world.setCell(x + ox, y + oy, ch === ',' ? '.' : ch, 'plain');
      }
    }
    // 出入口外的路不算聚落，保留原本的生態區；還沒創出來的地方跳過
    for (const [lx, ly] of approach) {
      const [x, y] = toWorld([lx, ly]);
      const c = world.cell(x, y);
      if (c && !world.villageAt(x, y) && !world.landmarkAt(x, y)) world.setCell(x, y, '·', c.biome);
    }
  }

  // 這一格屬於聚落裡的哪棟建築（室內或門），不在建築裡是 -1
  function roomAt(v, x, y) {
    if (!v || !v.rooms) return -1;
    const row = v.rooms[y - v.y0];
    const ch = row ? row[x - v.x0] : undefined;
    return ch && ch !== ' ' ? ch.charCodeAt(0) - 65 : -1;
  }

  // 村民只走聚落裡的室外和自己家，不進別人的建築
  const canWalk = (v, npc, x, y) => {
    const r = roomAt(v, x, y);
    return r < 0 || (!!npc.home && npc.home.b === r);
  };

  // 每個村民有自己的家：挑還有空床的民房，先挑還沒住人的
  function freeHome(world, rng, v) {
    const homes = world.npcs.filter((n) => n.villageId === v.id && n.home && n.role !== 'smith').map((n) => n.home);
    const taken = new Set(homes.map((h) => h.b + ':' + ckey(h.bed)));
    const used = new Set(homes.map((h) => h.b));
    const slots = [];
    (v.buildings || []).forEach((b, i) => {
      if (b.kind !== 'house' && b.kind !== 'big') return;
      b.beds.forEach((bed, j) => {
        if (!taken.has(i + ':' + ckey(bed))) slots.push({ b: i, bed, spot: b.kind === 'house' ? b.spots[0] : b.spots[j] });
      });
    });
    const empty = slots.filter((s) => !used.has(s.b));
    return empty.length ? FE.pick(rng, empty) : slots.length ? FE.pick(rng, slots) : null;
  }

  // ---- 地貌 ----
  // 圖樣裡的 . 是保留原本的地形；~ 是依當地生態區長的樹；o 是室內地板（空地）
  // 法師塔、聖所、礦坑、堡壘是有外框的建築：外牆圍出室內，留門（+）、坑口或缺口
  const LANDMARKS = {
    fort: {
      name: '廢棄的堡壘',
      desc: '斷牆圍著一片碎石地，早就沒有人守了。',
      art: [
        '▓▓▓▓▓▓▓▓▓▓▓.',
        '▓░░░▓░░░░░▓.',
        '▓░░░+░░░░░░░',
        '▓▓+▓▓░░░░░▓.',
        '▓░░░▓▓▓+▓▓▓.',
        '▓░░░+░░░░░▓.',
        '▓▓▓▓▓▓▓▓░▓▓.',
        '........░...',
      ],
    },
    stones: {
      name: '古老立石',
      desc: '一圈比人還高的石柱，上面的刻紋已經看不清。',
      art: ['.Π.Π.', 'Π░░░Π', '░░░░░', 'Π░░░Π', '.Π.Π.'],
    },
    grove: {
      name: '古老森林',
      desc: '樹長得又高又密，連白天都很暗。',
      art: ['.~~~~~.', '~~~~~~~', '~~~~~~~', '~~~~~~~', '.~~~~~.'],
    },
    graves: {
      name: '墓地',
      desc: '一排排墓碑，有些名字已經被風磨平。',
      art: ['‡░‡░‡', '░░░░░', '‡░‡░‡'],
    },
    tower: {
      name: '法師塔',
      desc: '一座孤零零的高塔，門從裡面鎖著。',
      art: ['.ΘΘΘΘΘ.', 'ΘΘoooΘΘ', 'ΘoooooΘ', 'ΘΘoooΘΘ', '.ΘΘ+ΘΘ.', '..░░░..'],
    },
    shrine: {
      name: '聖所',
      desc: '碎石圍著一座石造祭壇，常有人來祈禱。',
      art: ['Π†††††Π', '.†o¤o†.', '.†ooo†.', '.††+††.', 'Π.░░░.Π'],
    },
    mine: {
      name: '礦坑',
      desc: '山壁上開著一個礦坑口，旁邊堆著碎石。',
      art: ['.#ΩΩΩ#.', '#ΩΩooΩ#', '.ΩoooΩ.', '.ΩΩoΩΩ.', '..░░░..'],
    },
  };
  FE.LANDMARKS = LANDMARKS;

  const TREE = { tundra: '↑', taiga: '↑', glacier: '↑', jungle: '♠', swamp: '♠' };

  // 聚落的標籤決定地貌：法師塔、神聖的地方、出產礦石的地方各有對應；其他隨機
  function landmarkKind(rng, v) {
    if (has(v, '重要人士', '法師')) return 'tower';
    if (isHoly(v)) return 'shrine';
    if (has(v, '資源', '鐵礦') || has(v, '資源', '石材')) return 'mine';
    return FE.pick(rng, ['fort', 'stones', 'grove', 'graves']);
  }

  // 從範圍外圍一圈（只在範圍和外圍裡走）走得到範圍裡每一格能走的地方
  function enclosedOk(world, x0, y0, x1, y1) {
    const inBox = (x, y) => x >= x0 - 1 && x <= x1 + 1 && y >= y0 - 1 && y <= y1 + 1;
    const seen = new Set();
    const q = [];
    for (let y = y0 - 1; y <= y1 + 1; y++) {
      for (let x = x0 - 1; x <= x1 + 1; x++) {
        if ((x < x0 || x > x1 || y < y0 || y > y1) && world.passable(x, y)) {
          seen.add(x + ',' + y);
          q.push([x, y]);
        }
      }
    }
    for (let h = 0; h < q.length; h++) {
      const [x, y] = q[h];
      for (const [dx, dy] of DIRS) {
        const nx = x + dx;
        const ny = y + dy;
        if (!inBox(nx, ny) || seen.has(nx + ',' + ny) || !world.canStep(x, y, nx, ny)) continue;
        seen.add(nx + ',' + ny);
        q.push([nx, ny]);
      }
    }
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (world.passable(x, y) && !seen.has(x + ',' + y)) return false;
    return true;
  }

  // 圖樣的字元畫成哪種地形
  const artGlyph = (ch, biome) => (ch === '~' ? TREE[biome] || '♣' : ch === 'o' ? '.' : ch);

  // 放在聚落外面 3～12 格、整塊落在這塊世界裡，不壓到水、湖、路、出生點；
  // 地貌不改高度，所以挑畫上去的格子之間沒有斷崖的位置（室內才走得通）
  function placeLandmark(world, rng, rect, v) {
    const kind = landmarkKind(rng, v);
    const L = LANDMARKS[kind];
    const H = L.art.length;
    const W = L.art[0].length;
    const s = world.spawn;
    const painted = (dx, dy) => dy >= 0 && dy < H && dx >= 0 && dx < W && L.art[dy][dx] !== '.';
    const ok = (x0, y0) => {
      // 離這塊世界的邊至少一格，門外才不會是還沒創出來的地方
      if (x0 <= rect.x0 || y0 <= rect.y0 || x0 + W >= rect.x1 || y0 + H >= rect.y1) return false;
      const gap = Math.max(v.x0 - (x0 + W - 1), x0 - v.x1, v.y0 - (y0 + H - 1), y0 - v.y1);
      if (gap < 3 || gap > 12) return false;
      for (let y = y0; y < y0 + H; y++) {
        for (let x = x0; x < x0 + W; x++) {
          const c = world.cell(x, y);
          if (c.t === '≈' || c.t === '·' || c.biome === 'lake' || world.landmarkAt(x, y) || world.villageAt(x, y) || (s && s.x === x && s.y === y)) return false;
          if (!painted(x - x0, y - y0)) continue;
          for (const [dx, dy] of [[1, 0], [0, 1]]) {
            if (painted(x - x0 + dx, y - y0 + dy) && Math.abs(c.h - world.cell(x + dx, y + dy).h) > 1) return false;
          }
        }
      }
      return true;
    };
    for (let tries = 0; tries < 120; tries++) {
      const x0 = FE.randInt(rng, v.x0 - 12 - W, v.x1 + 12);
      const y0 = FE.randInt(rng, v.y0 - 12 - H, v.y1 + 12);
      if (!ok(x0, y0)) continue;
      const prev = [];
      for (let dy = 0; dy < H; dy++) {
        for (let dx = 0; dx < W; dx++) {
          const ch = L.art[dy][dx];
          if (ch === '.') continue;
          const c = world.cell(x0 + dx, y0 + dy);
          prev.push([x0 + dx, y0 + dy, c.t]);
          world.setCell(x0 + dx, y0 + dy, artGlyph(ch, c.biome), c.biome);
        }
      }
      // 室內要走得通：從地貌外圍一圈走得到裡面每一格能走的地方（門外可能剛好是巨石或水）
      if (!enclosedOk(world, x0, y0, x0 + W - 1, y0 + H - 1)) {
        for (const [x, y, t] of prev) world.setCell(x, y, t, world.cell(x, y).biome);
        continue;
      }
      const lm = { id: world.nextId++, kind, name: L.name, villageId: v.id, x0, y0, x1: x0 + W - 1, y1: y0 + H - 1, found: false };
      world.landmarks.push(lm);
      return lm;
    }
    return null;
  }

  FE.Steading = {
    roll, layout, has, villagerCount, smithFactor, rewardFactor, isHoly, related, describe, tagText, placeLandmark,
    roomAt, canWalk, freeHome, siteScore, exitViable,
  };
})();
