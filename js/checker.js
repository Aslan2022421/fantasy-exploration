// 檢查器：掃世界找錯，回傳 BUG 描述 { type, x, y, cells, scope, data }。
// x, y 是怪物站的位置（B 點），cells 是受影響的格子，scope 是影響範圍。
(function () {
  const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const DIRS8 = DIRS4.concat([[1, 1], [1, -1], [-1, 1], [-1, -1]]);
  const key = (x, y) => x + ',' + y;
  const unkey = (k) => k.split(',').map(Number);

  function components(set, dirs) {
    const seen = new Set();
    const out = [];
    for (const k of set) {
      if (seen.has(k)) continue;
      const comp = [];
      const stack = [k];
      seen.add(k);
      while (stack.length) {
        const [x, y] = unkey(stack.pop());
        comp.push([x, y]);
        for (const [dx, dy] of dirs) {
          const nk = key(x + dx, y + dy);
          if (set.has(nk) && !seen.has(nk)) {
            seen.add(nk);
            stack.push(nk);
          }
        }
      }
      out.push(comp);
    }
    return out;
  }

  function pickStandable(world, cells) {
    const ok = cells.filter(([x, y]) => world.passable(x, y) && !world.npcAt(x, y) && !world.chestAt(x, y));
    const list = ok.length ? ok : cells;
    return list[Math.floor(list.length / 2)];
  }

  const isConflict = FE.isClimateConflict;

  // 範圍 r 再往外一圈的每一格（新區塊四邊都可能跟舊區塊接縫），沒創出來的格子跳過
  function eachCellAround(world, r, fn) {
    for (let y = r.y0 - 1; y <= r.y1; y++) {
      for (let x = r.x0 - 1; x <= r.x1; x++) {
        const c = world.cell(x, y);
        if (c) fn(x, y, c);
      }
    }
  }

  // 地形錯位：冷的生態區跟熱的直接接在一起（例如苔原貼著沙漠）
  function findTerrain(world, r, covered) {
    const conflict = new Set();
    eachCellAround(world, r, (x, y, c) => {
      {
        for (const [dx, dy] of DIRS4) {
          const n = world.cell(x + dx, y + dy);
          if (n && isConflict(c.biome, n.biome)) {
            conflict.add(key(x, y));
            break;
          }
        }
      }
    });
    for (const k of covered) conflict.delete(k);
    return components(conflict, DIRS8).map((cells) => {
      const [x, y] = pickStandable(world, cells);
      return { type: 'TERRAIN', x, y, cells, scope: cells.length, data: {} };
    });
  }

  // 斷崖：兩格都能站，高度卻差 2 階以上（自然地形只有坡，斷崖一定是算錯了）
  function findCliffs(world, r, covered) {
    const bad = new Set();
    eachCellAround(world, r, (x, y) => {
      if (!world.passable(x, y)) return;
      for (const [dx, dy] of DIRS4) {
        const nx = x + dx;
        const ny = y + dy;
        if (world.passable(nx, ny) && !world.heightOk(x, y, nx, ny)) {
          bad.add(key(x, y));
          break;
        }
      }
    });
    for (const k of covered) bad.delete(k);
    return components(bad, DIRS8).map((cells) => {
      const [x, y] = pickStandable(world, cells);
      // 斷崖兩側的格子都會被抓到，影響範圍只算一半，不然每片斷崖都成了大型怪物
      return { type: 'CLIFF', x, y, cells, scope: Math.ceil(cells.length / 2), data: {} };
    });
  }

  // 從出生點走得到的格子（全世界一格一格走，舊做法；第二十五版起只給測試對照新做法用，見 FE.Checker.full）。
  // 回傳的物件跟 reachable() 一樣有 at(x, y) 與 has('x,y')
  function reachableFull(world) {
    const seen = new Set();
    const s = world.spawn;
    if (s && world.passable(s.x, s.y)) {
      const q = [[s.x, s.y]];
      seen.add(key(s.x, s.y));
      for (let h = 0; h < q.length; h++) {
        const [x, y] = q[h];
        for (const [dx, dy] of DIRS4) {
          const nx = x + dx;
          const ny = y + dy;
          const nk = key(nx, ny);
          if (!seen.has(nk) && world.canStep(x, y, nx, ny)) {
            seen.add(nk);
            q.push([nx, ny]);
          }
        }
      }
    }
    // （舊做法沒有 rootAt，測試只用 at）
    return { at: (x, y) => seen.has(key(x, y)), has: (k) => seen.has(k), size: seen.size };
  }

  // 從出生點走得到的格子（第二十五版起）：每塊區塊各自算一次「區塊內互相走得通的連通塊」（ch._cc，那一塊有格子的
  // 走得過去或高度被改過才重算，World.setCell／setHeight 會記），再把相鄰區塊邊上走得通的連通塊併起來，
  // 從出生點所在的連通塊走得到的就是走得到。世界變大，創世時只需重算新的那一塊（和被改到的區塊），不必整個世界再走一遍。
  // 同一個世界狀態（每塊區塊的版本和出生點都沒變）只算一次，快取在 world._reach。
  // 回傳的物件是當下的快照：at(x, y) 問這一格走不走得到，has('x,y') 是舊介面的相容寫法
  function chunkComps(ch) {
    const ver = ch.ver || 0;
    if (ch._cc && ch._cc.ver === ver) return ch._cc;
    const W = FE.CONFIG.CHUNK_W;
    const H = FE.CONFIG.CHUNK_H;
    const n = W * H;
    const pass = new Uint8Array(n);
    const hgt = new Int8Array(n);
    for (let y = 0; y < H; y++) {
      const row = ch.cells[y];
      for (let x = 0; x < W; x++) {
        pass[y * W + x] = FE.TERRAIN[row[x].t].pass ? 1 : 0;
        hgt[y * W + x] = row[x].h;
      }
    }
    const label = new Int32Array(n).fill(-1);
    const stack = new Int32Array(n);
    let count = 0;
    let sp = 0;
    const push = (j, k) => {
      if (pass[k] && label[k] < 0 && Math.abs(hgt[j] - hgt[k]) <= 1) {
        label[k] = count;
        stack[sp++] = k;
      }
    };
    for (let i = 0; i < n; i++) {
      if (!pass[i] || label[i] >= 0) continue;
      label[i] = count;
      stack[sp++] = i;
      while (sp) {
        const j = stack[--sp];
        const x = j % W;
        if (x < W - 1) push(j, j + 1);
        if (x > 0) push(j, j - 1);
        if (j + W < n) push(j, j + W);
        if (j - W >= 0) push(j, j - W);
      }
      count++;
    }
    ch._cc = { ver, label, n: count };
    return ch._cc;
  }

  function reachable(world) {
    const chunks = world.chunks;
    const s = world.spawn;
    const comps = chunks.map(chunkComps);
    const sig = chunks.map((c, i) => c.cx + ':' + c.cy + ':' + comps[i].ver).join(',') + '|' + (s ? s.x + ',' + s.y : '');
    if (world._reach && world._reach.sig === sig) return world._reach.info;
    const W = FE.CONFIG.CHUNK_W;
    const H = FE.CONFIG.CHUNK_H;
    const bases = [];
    let total = 0;
    chunks.forEach((c, i) => {
      c._ri = i;
      bases.push(total);
      total += comps[i].n;
    });
    const parent = new Int32Array(total);
    for (let i = 0; i < total; i++) parent[i] = i;
    const find = (a) => {
      while (parent[a] !== a) {
        parent[a] = parent[parent[a]];
        a = parent[a];
      }
      return a;
    };
    const union = (a, b) => {
      a = find(a);
      b = find(b);
      if (a !== b) parent[a] = b;
    };
    // 相鄰區塊的邊：兩邊的格子都走得過去、高度差在 1 以內，就把兩個連通塊併起來
    for (let i = 0; i < chunks.length; i++) {
      const ch = chunks[i];
      const east = world.chunkMap.get(ch.cx + 1 + ',' + ch.cy);
      if (east) {
        const a = comps[i].label;
        const b = comps[east._ri].label;
        for (let y = 0; y < H; y++) {
          const la = a[y * W + W - 1];
          const lb = b[y * W];
          if (la >= 0 && lb >= 0 && Math.abs(ch.cells[y][W - 1].h - east.cells[y][0].h) <= 1) union(bases[i] + la, bases[east._ri] + lb);
        }
      }
      const south = world.chunkMap.get(ch.cx + ',' + (ch.cy + 1));
      if (south) {
        const a = comps[i].label;
        const b = comps[south._ri].label;
        for (let x = 0; x < W; x++) {
          const la = a[(H - 1) * W + x];
          const lb = b[x];
          if (la >= 0 && lb >= 0 && Math.abs(ch.cells[H - 1][x].h - south.cells[0][x].h) <= 1) union(bases[i] + la, bases[south._ri] + lb);
        }
      }
    }
    // 出生點所在的連通塊
    let root = -1;
    const labels = comps.map((c) => c.label);
    if (s) {
      const sc = world.chunkAt(s.x, s.y);
      if (sc) {
        const l = labels[sc._ri][(s.y - sc.y0) * W + (s.x - sc.x0)];
        if (l >= 0) root = find(bases[sc._ri] + l);
      }
    }
    const info = {
      at(x, y) {
        const ch = world.chunkAt(x, y);
        if (!ch || root < 0) return false;
        const l = labels[ch._ri][(y - ch.y0) * W + (x - ch.x0)];
        return l >= 0 && find(bases[ch._ri] + l) === root;
      },
      has(k) {
        const i = k.indexOf(',');
        return info.at(Number(k.slice(0, i)), Number(k.slice(i + 1)));
      },
      // 這一格所在的連通塊（走得通的一整片）的編號；走不過去的格子是 -1。兩格編號相同就走得到彼此
      rootAt(x, y) {
        const ch = world.chunkAt(x, y);
        if (!ch) return -1;
        const l = labels[ch._ri][(y - ch.y0) * W + (x - ch.x0)];
        return l >= 0 ? find(bases[ch._ri] + l) : -1;
      },
    };
    world._reach = { sig, info };
    return info;
  }

  // 從被圍住的區域往外找最短的路，接到走得到的地方。
  // gate 是路口（走得到的那一格），cells 是中間要打通的格子。
  function bridgePath(world, cells, reached) {
    const prev = new Map();
    const q = [];
    for (const [x, y] of cells) {
      prev.set(key(x, y), null);
      q.push([x, y]);
    }
    for (let h = 0; h < q.length; h++) {
      const [x, y] = q[h];
      for (const [dx, dy] of DIRS4) {
        const nx = x + dx;
        const ny = y + dy;
        const nk = key(nx, ny);
        if (!world.inBounds(nx, ny) || prev.has(nk)) continue;
        prev.set(nk, key(x, y));
        if (reached.at(nx, ny)) {
          const path = [];
          let k = key(x, y);
          while (prev.get(k) !== null) {
            path.push(unkey(k));
            k = prev.get(k);
          }
          // path 從路口旁一路排到被圍住那一區的旁邊；comp 是被圍住那一區接上的格子
          return { gate: [nx, ny], cells: path, comp: unkey(k) };
        }
        q.push([nx, ny]);
      }
    }
    return null;
  }

  // 斷層的核心：eachCell(fn) 依序給要看的格子（fn(x, y)），reached 是 { at(x, y) }，走得到的格子不算。
  // 一片走不到的區域從出生點走不到、又沒有怪物負責，就生成一隻斷層（路口、打通的路見 bridgePath）。
  // 結果依「區域裡創世順序最早的一格」（區塊、列、欄）排序，區域的格子也從那一格開始走，所以只掃一部分格子時，
  // 掃到的區域跟掃整個世界的結果一模一樣（格子、順序、路口都相同）
  function unreachableIn(world, covered, reached, eachCell) {
    const seen = new Set();
    const found = [];
    const flood = (sx, sy) => {
      const visited = new Set([key(sx, sy)]);
      const cells = [];
      const stack = [[sx, sy]];
      while (stack.length) {
        const [cx, cy] = stack.pop();
        cells.push([cx, cy]);
        for (const [dx, dy] of DIRS4) {
          const nx = cx + dx;
          const ny = cy + dy;
          const nk = key(nx, ny);
          if (world.canStep(cx, cy, nx, ny) && !reached.at(nx, ny) && !visited.has(nk)) {
            visited.add(nk);
            stack.push([nx, ny]);
          }
        }
      }
      return cells;
    };
    // 創世順序的先後：區塊的創世順序，再來是列、欄
    const before = (a, b) => {
      const ia = world.chunkAt(a[0], a[1]).index;
      const ib = world.chunkAt(b[0], b[1]).index;
      return ia !== ib ? ia < ib : a[1] !== b[1] ? a[1] < b[1] : a[0] < b[0];
    };
    eachCell((x, y) => {
      if (seen.has(key(x, y)) || !world.passable(x, y) || reached.at(x, y)) return;
      let cells = flood(x, y);
      for (const [cx, cy] of cells) seen.add(key(cx, cy));
      let first = cells[0];
      for (const c of cells) if (before(c, first)) first = c;
      if (first !== cells[0]) cells = flood(first[0], first[1]);
      if (cells.some(([cx, cy]) => covered.has(key(cx, cy)))) return;
      const hasEntity = cells.some(([cx, cy]) => world.npcAt(cx, cy) || world.chestAt(cx, cy));
      if (cells.length < 3 && !hasEntity) return; // 一兩格的小凹洞不算
      const path = bridgePath(world, cells, reached);
      if (!path) return;
      found.push({
        first,
        bug: {
          type: 'UNREACHABLE',
          x: path.gate[0],
          y: path.gate[1],
          cells,
          scope: cells.length,
          data: { path: path.cells, ends: [path.gate, path.comp] },
        },
      });
    });
    found.sort((a, b) => (before(a.first, b.first) ? -1 : 1));
    return found.map((f) => f.bug);
  }

  // 斷層：可以走的區域，從出生點卻走不到（被岩石、水或斷崖圍住）。
  // 第二十五版起只看新解出來的那一塊再往外一圈（接縫），不再掃整個世界；走得到走不到看 reachable() 的快取
  function findUnreachable(world, covered, r) {
    const reached = reachable(world);
    return unreachableIn(world, covered, reached, (fn) => {
      for (let y = r.y0 - 1; y <= r.y1; y++) for (let x = r.x0 - 1; x <= r.x1; x++) fn(x, y);
    });
  }

  // 出入口不足：聚落能走出去的出入口少於 3 個（外面被巨石、水擋住，或排版開不出來）。
  // 包裝成斷層，打倒時在外牆上打開一個寬 3 格的出入口
  function findGates(world, r, monsters) {
    const bugs = [];
    for (const v of world.villages) {
      if (!v.mask || !FE.inRect(r, v.cx, v.cy)) continue;
      if (monsters.some((m) => m.data && m.data.villageId === v.id)) continue;
      const own = (x, y) => world.villageAt(x, y) === v;
      // 出入口：聚落裡的路，旁邊就是聚落外面能走的格子；8 方向相連的算同一個
      const opens = new Set();
      for (let y = v.y0; y <= v.y1; y++) {
        for (let x = v.x0; x <= v.x1; x++) {
          if (!own(x, y) || world.cell(x, y).t !== '·') continue;
          if (DIRS4.some(([dx, dy]) => !own(x + dx, y + dy) && world.passable(x + dx, y + dy))) opens.add(key(x, y));
        }
      }
      if (components(opens, DIRS8).length >= 3) continue;
      // 挑一段外牆：連續 3 格，裡面是聚落能走的地方，外面能走
      const isWall = (x, y) => own(x, y) && (world.cell(x, y).t === 'W' || world.cell(x, y).t === 'w');
      const spots = [];
      for (let y = v.y0; y <= v.y1; y++) {
        for (let x = v.x0; x <= v.x1; x++) {
          for (const [dx, dy] of DIRS4) {
            // (dx, dy) 是往外的方向，沿牆的方向跟它垂直
            const [ax, ay] = [dy, dx];
            const line = [-1, 0, 1].map((o) => [x + ax * o, y + ay * o]);
            const ok = line.every(([lx, ly]) => {
              const inside = [lx - dx, ly - dy];
              const outside = [lx + dx, ly + dy];
              return isWall(lx, ly) && own(...inside) && world.passable(...inside) && !own(...outside) && world.passable(...outside);
            });
            if (ok) spots.push({ line, out: [x + dx * 2, y + dy * 2] });
          }
        }
      }
      if (!spots.length) continue;
      const s = spots[Math.floor(spots.length / 2)];
      bugs.push({
        type: 'UNREACHABLE',
        x: s.out[0],
        y: s.out[1],
        cells: s.line,
        scope: 6,
        data: { villageId: v.id, path: s.line },
      });
    }
    return bugs;
  }

  // 數值暴走：寶箱金幣是負數或 NaN
  function checkChest(c) {
    if (Number.isFinite(c.gold) && c.gold >= 0) return null;
    const scope = Number.isFinite(c.gold) ? Math.min(10, Math.max(1, Math.ceil(-c.gold / 4))) : 8;
    return { type: 'VALUE', x: c.x, y: c.y, cells: [[c.x, c.y]], scope, data: { chestId: c.id, value: c.gold } };
  }

  // 懸空指標：任務指向不存在的村民
  function checkNpc(world, n) {
    if (!n.quest || n.quest.done || n.quest.kind === 'hunt' || world.npcById(n.quest.targetId)) return null;
    return {
      type: 'REFERENCE',
      x: n.x,
      y: n.y,
      cells: [[n.x, n.y]],
      scope: 4,
      data: { npcId: n.id, missingId: n.quest.targetId, missingName: n.quest.targetName },
    };
  }

  function findValue(world, r) {
    return world.chests.filter((c) => FE.inRect(r, c.x, c.y)).map(checkChest).filter(Boolean);
  }

  function findReference(world, r) {
    return world.npcs.filter((n) => FE.inRect(r, n.x, n.y)).map((n) => checkNpc(world, n)).filter(Boolean);
  }

  // 新世界解出來時跑一次。已經有怪物負責的格子不重複抓。
  // 每種會蓋一片格子的錯，已經有怪物負責的格子
  function coveredBy(monsters, type, extra) {
    const set = new Set(extra || []);
    for (const m of monsters) {
      if (m.type === type) for (const [x, y] of m.cells) set.add(key(x, y));
      if (m.members) for (const o of m.members) if (o.type === type) for (const [x, y] of o.cells) set.add(key(x, y));
    }
    return set;
  }

  // r 是新解出來那一塊的範圍。unreachable(covered) 找斷層：遊戲用只看新的一塊附近的做法，測試的 full.scan 換成全世界的舊做法
  function scanWith(world, r, monsters, unreachable) {
    // 被斷崖圍住的區域交給斷崖怪物負責（修好斷崖就接通了），不再另外算成斷層
    const cliffs = findCliffs(world, r, coveredBy(monsters, 'CLIFF'));
    const cliffCells = cliffs.flatMap((d) => d.cells.map(([x, y]) => key(x, y)));
    return [].concat(
      findTerrain(world, r, coveredBy(monsters, 'TERRAIN')),
      cliffs,
      unreachable(coveredBy(monsters, 'UNREACHABLE', coveredBy(monsters, 'CLIFF', cliffCells))),
      findGates(world, r, monsters),
      findValue(world, r),
      findReference(world, r)
    );
  }
  const scan = (world, r, monsters) => scanWith(world, r, monsters, (covered) => findUnreachable(world, covered, r));

  // 整個世界找還沒有怪物負責的地形錯位與斷崖（侵蝕、地形重算造成的）
  function findGlitches(world, monsters, dormant) {
    const b = world.bounds();
    return [].concat(
      findTerrain(world, b, coveredBy(monsters, 'TERRAIN', dormant)),
      findCliffs(world, b, coveredBy(monsters, 'CLIFF', dormant))
    );
  }

  // full：舊做法（整個世界走一遍、整個世界掃一遍），只給測試對照新做法用，遊戲本身不呼叫
  const full = {
    reachable: reachableFull,
    findUnreachable: (world, covered) => unreachableIn(world, covered, reachableFull(world), (fn) => world.forEachCell(fn)),
    scan: (world, r, monsters) =>
      scanWith(world, r, monsters, (covered) => unreachableIn(world, covered, reachableFull(world), (fn) => world.forEachCell(fn))),
  };

  FE.Checker = { scan, reachable, checkChest, checkNpc, findGlitches, full };
})();
