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

  // 從出生點走得到的格子
  function reachable(world) {
    const seen = new Set();
    const s = world.spawn;
    if (!s || !world.passable(s.x, s.y)) return seen;
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
    return seen;
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
        if (reached.has(nk)) {
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

  // 斷層：可以走的區域，從出生點卻走不到（被岩石、水或斷崖圍住）
  function findUnreachable(world, covered) {
    const reached = reachable(world);
    const seen = new Set();
    const bugs = [];
    world.forEachCell((x, y) => {
      {
        const k = key(x, y);
        if (!world.passable(x, y) || reached.has(k) || seen.has(k)) return;
        const cells = [];
        const stack = [[x, y]];
        seen.add(k);
        while (stack.length) {
          const [cx, cy] = stack.pop();
          cells.push([cx, cy]);
          for (const [dx, dy] of DIRS4) {
            const nx = cx + dx;
            const ny = cy + dy;
            const nk = key(nx, ny);
            if (world.canStep(cx, cy, nx, ny) && !reached.has(nk) && !seen.has(nk)) {
              seen.add(nk);
              stack.push([nx, ny]);
            }
          }
        }
        if (cells.some(([cx, cy]) => covered.has(key(cx, cy)))) return;
        const hasEntity = cells.some(([cx, cy]) => world.npcAt(cx, cy) || world.chestAt(cx, cy));
        if (cells.length < 3 && !hasEntity) return; // 一兩格的小凹洞不算
        const path = bridgePath(world, cells, reached);
        if (!path) return;
        bugs.push({
          type: 'UNREACHABLE',
          x: path.gate[0],
          y: path.gate[1],
          cells,
          scope: cells.length,
          data: { path: path.cells, ends: [path.gate, path.comp] },
        });
      }
    });
    return bugs;
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

  // r 是新解出來那一塊的範圍
  function scan(world, r, monsters) {
    // 被斷崖圍住的區域交給斷崖怪物負責（修好斷崖就接通了），不再另外算成斷層
    const cliffs = findCliffs(world, r, coveredBy(monsters, 'CLIFF'));
    const cliffCells = cliffs.flatMap((d) => d.cells.map(([x, y]) => key(x, y)));
    return [].concat(
      findTerrain(world, r, coveredBy(monsters, 'TERRAIN')),
      cliffs,
      findUnreachable(world, coveredBy(monsters, 'UNREACHABLE', coveredBy(monsters, 'CLIFF', cliffCells))),
      findGates(world, r, monsters),
      findValue(world, r),
      findReference(world, r)
    );
  }

  // 整個世界找還沒有怪物負責的地形錯位與斷崖（侵蝕、地形重算造成的）
  function findGlitches(world, monsters, dormant) {
    const b = world.bounds();
    return [].concat(
      findTerrain(world, b, coveredBy(monsters, 'TERRAIN', dormant)),
      findCliffs(world, b, coveredBy(monsters, 'CLIFF', dormant))
    );
  }

  FE.Checker = { scan, reachable, checkChest, checkNpc, findGlitches };
})();
