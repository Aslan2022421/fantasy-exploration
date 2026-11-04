// 第三十四版（地形與聚落）的場景檢查：怪物遮蔽開關前後的行為、存檔讀回一致、聚落出口被擋時打通（不鋪湖面）、
// 堡壘與隘口、要塞與城市的大小與出口（聚落那幾項見 testSettle34）。生成統計那邊另外量相鄰高度差、採集點、出入口（test-gen.js）
let terrainChecks = 0;

// ---- 怪物遮蔽 ----
function testVeil34() {
  const ok = (cond, msg) => { terrainChecks++; if (!cond) fail('怪物遮蔽 ' + msg); };
  // 1. 開局前就打開：開局那一大塊與之後創世都不生怪物（一定要生的也不生），整體 BUG 值不往上加，每小時也不掉、不生衰敗的怪物
  {
    const g = new FE.Game(4242);
    g.setVeil(true);
    g.start();
    ok(g.allMonsters().length === 0 && !Object.keys(g.world.campaigns).length, `開局生了 ${g.allMonsters().length} 隻怪物`);
    const t0 = FE.Stability.total(g);
    for (let i = 0; i < 4; i++) g.createChunk(false);
    ok(g.allMonsters().length === 0, `創世生了 ${g.allMonsters().length} 隻怪物`);
    const t1 = FE.Stability.total(g);
    ok(t1 <= t0, `創世之後整體 BUG 值從 ${t0} 變 ${t1}`);
    for (let h = 0; h < 72; h++) FE.Events.tick(g);
    ok(g.allMonsters().length === 0 && FE.Stability.total(g) <= t1, `三天後怪物 ${g.allMonsters().length} 隻、整體 BUG 值 ${t1} → ${FE.Stability.total(g)}`);
    // 一個動作最多長一段（門檻只剩任務的算力）
    const n0 = g.world.regions;
    g.creation = g.nextChunkAt + 1e6;
    g.checkCreate();
    ok(g.world.regions === n0 + 1, `遮蔽時一個動作長了 ${g.world.regions - n0} 段`);
  }
  // 2. 玩到一半打開：怪物收起來（不顯示、碰不到、不行動），整體 BUG 值照算；關掉後原封不動放回來；存檔照樣存著
  {
    const g = new FE.Game(4242);
    g.start();
    const snap = (list) => list.map((m) => [m.id, m.x, m.y, m.hp].join()).sort().join('|');
    const before = snap(g.monsters);
    const n = g.monsters.length;
    const tot = FE.Stability.total(g);
    const m0 = g.monsters[0];
    ok(n > 0, '開局沒有怪物，量不到遮蔽');
    g.setVeil(true);
    ok(g.monsters.length === 0 && g.veiled.length === n && FE.Stability.total(g) === tot, `打開後畫面上 ${g.monsters.length} 隻、收起來 ${g.veiled.length}/${n} 隻、整體 BUG 值 ${tot} → ${FE.Stability.total(g)}`);
    ok(!g.monsterAt(m0.x, m0.y), '收起來的怪物還擋路或碰得到');
    for (let i = 0; i < 40; i++) FE.AI.worldTurn(g);
    const debt0 = g.world.debt;
    for (let h = 0; h < 48; h++) FE.Events.tick(g);
    ok(g.world.debt <= debt0 && g.allMonsters().length === n, `遮蔽兩天後欠的量 ${debt0} → ${g.world.debt}、怪物 ${g.allMonsters().length}/${n}`);
    ok(snap(g.veiled) === before, '收起來的怪物動過了');
    FE.Save.save(g);
    const r = FE.Save.load();
    ok(r && r.game && r.game.monsters.length === n && !r.game.veil, `遮蔽時存檔，讀回來 ${r && r.game ? r.game.monsters.length : '-'}/${n} 隻`);
    g.setVeil(false);
    ok(g.veiled.length === 0 && snap(g.monsters) === before, '關掉後怪物沒有原封不動放回來');
    ok(FE.Stability.total(g) === tot, `關掉後整體 BUG 值 ${tot} → ${FE.Stability.total(g)}`);
    // 關掉後恢復正常：創世照樣生怪物
    const k0 = g.monsters.length;
    g.createChunk(false);
    ok(g.monsters.length > k0, '關掉後創世不生怪物');
  }
}

// ---- 存檔讀回一致：地形、聚落、地貌、採集點、隘口 ----
function testSave34() {
  const ok = (cond, msg) => { terrainChecks++; if (!cond) fail('存檔讀回 ' + msg); };
  const g = new FE.Game(31337);
  g.start();
  for (let i = 0; i < 10; i++) g.createChunk(false);
  FE.Save.save(g);
  const r = FE.Save.load();
  ok(r && r.game, '讀不回來');
  if (!r || !r.game) return;
  const a = g.world;
  const b = r.game.world;
  let diff = 0;
  a.forEachCell((x, y, c) => {
    const o = b.cell(x, y);
    if (!o || o.t !== c.t || o.h !== c.h || o.biome !== c.biome || a.stab(x, y) !== b.stab(x, y)) diff++;
  });
  ok(diff === 0 && a.chunks.length === b.chunks.length, `有 ${diff} 格不一樣（小塊 ${a.chunks.length}/${b.chunks.length}）`);
  const same = (k) => JSON.stringify(a[k]) === JSON.stringify(b[k]);
  for (const k of ['villages', 'landmarks', 'nodes', 'npcs', 'passes', 'passPlan', 'chests']) ok(same(k), `${k} 不一樣`);
  ok(JSON.stringify(g.monsters) === JSON.stringify(r.game.monsters), '怪物不一樣');
  ok(a.debt === b.debt, `欠的量 ${a.debt}/${b.debt}`);
  // 讀回來接著長，跟沒存過的長得一樣（passPlan、預留的小塊都接得上）
  g.createChunk(false);
  r.game.createChunk(false);
  let diff2 = 0;
  a.forEachCell((x, y, c) => {
    const o = b.cell(x, y);
    if (!o || o.t !== c.t || o.h !== c.h) diff2++;
  });
  ok(diff2 === 0 && JSON.stringify(a.passes) === JSON.stringify(b.passes), `讀回來再長一段，有 ${diff2} 格不一樣`);
}

// ---- 聚落出口被擋：鋪路打通（openExits），不把湖面鋪成路 ----
function testExits34() {
  const ok = (cond, msg) => { terrainChecks++; if (!cond) fail('聚落出口 ' + msg); };
  const g = new FE.Game(777);
  g.start();
  const w = g.world;
  const v = w.villages[0];
  // 在出入口外的路盡頭再往外，繞聚落一圈擺 2 格厚的山壁（離整平過的工作範圍 5～6 格），每個出入口都被擋住
  const f = v.flat;
  const exits = v.exitDirs || [];
  ok(exits.length >= 3, `開局的村莊只有 ${exits.length} 個出入口`);
  const ring = [];
  for (let y = f.y0 - 6; y <= f.y1 + 6; y++) {
    for (let x = f.x0 - 6; x <= f.x1 + 6; x++) {
      const d = Math.max(f.x0 - x, x - f.x1, f.y0 - y, y - f.y1);
      if ((d === 5 || d === 6) && w.cell(x, y)) ring.push([x, y]);
    }
  }
  for (const [x, y] of ring) w.setCell(x, y, '█', w.cell(x, y).biome);
  FE.World.openExits(w, v);
  ok(v.exitFixed >= 1, `出入口都被擋住，卻沒有打通（exitFixed ${v.exitFixed}）`);
  // 打通之後每個出入口都走得出去：從路的盡頭（工作範圍外三格）不穿過聚落，走得到離聚落外框「周圍的圈＋3 格」以外
  const D = w.bufferWidth(v) + 3;
  const walkOut = (sx, sy) => {
    const seen = new Set([sx + ',' + sy]);
    const q = [[sx, sy]];
    for (let h = 0; h < q.length; h++) {
      const [x, y] = q[h];
      if (Math.max(v.x0 - x, x - v.x1, v.y0 - y, y - v.y1) >= D) return true;
      for (const [ax, ay] of DIRS) {
        const nx = x + ax, ny = y + ay;
        if (seen.has(nx + ',' + ny) || w.villageAt(nx, ny) === v || !w.canStep(x, y, nx, ny)) continue;
        seen.add(nx + ',' + ny);
        q.push([nx, ny]);
      }
    }
    return false;
  };
  for (const [dx, dy] of exits) {
    const ex = dx > 0 ? f.x1 + 3 : dx < 0 ? f.x0 - 3 : v.cx;
    const ey = dy > 0 ? f.y1 + 3 : dy < 0 ? f.y0 - 3 : v.cy;
    ok(walkOut(ex, ey), `往 (${dx},${dy}) 的出口打通後還是走不出去`);
  }
  // 換成湖：一格都不鋪
  for (const [x, y] of ring) w.setCell(x, y, '≈', 'lake');
  FE.World.openExits(w, v);
  const paved = ring.filter(([x, y]) => w.cell(x, y).t !== '≈').length;
  ok(paved === 0, `湖面鋪成了路 ${paved} 格`);
  // 選址：朝湖的方向不開出入口（exitViable 往外多看聚落圈＋3 格）
  const viable = FE.Steading.exitViable(w, v);
  ok(viable.every((o) => o === false), `四面外面都是湖，exitViable 還說開得出去：${viable}`);
}

// ---- 堡壘、要塞、城市（照圖樣蓋的聚落）與堡壘廢墟 ----
// 世界種子 158380 長滿 288×288（出生點不動）時有城市、要塞與堡壘廢墟（第三十四版量到的；規則改了沒有就要換種子）
function testSettle34() {
  const ok = (cond, msg) => { terrainChecks++; if (!cond) fail('堡壘與城市 ' + msg); };
  const g = new FE.Game(158380);
  g.start();
  g.checkCreate = () => {};
  for (let i = 0; i < 16; i++) g.createChunk(false);
  const w = g.world;
  const kinds = (k) => w.villages.filter((v) => v.kind === k);
  ok(kinds('city').length >= 1 && kinds('fortress').length >= 1, `種子 158380 沒有城市或要塞（城市 ${kinds('city').length}、要塞 ${kinds('fortress').length}），要換種子`);
  ok(w.landmarks.some((l) => l.kind === 'fort'), '種子 158380 沒有堡壘廢墟，要換種子');
  const n0 = problems.length;
  for (const v of w.villages) if (v.kind === 'city' || v.kind === 'fort' || v.kind === 'fortress') checkPlan(g, v, '場景');
  terrainChecks += w.villages.length;
  ok(problems.length === n0, '圖樣聚落的大小、出入口、城門、山壁有問題（見上面）');
  // 城市：兩座城鎮的工匠與士兵（武器匠、盔甲匠各一位站在工坊裡，士兵 6 位），住的人有家
  for (const v of kinds('city')) {
    const folk = w.npcs.filter((n) => n.villageId === v.id);
    const smith = folk.find((n) => n.role === 'smith');
    const arm = folk.find((n) => n.role === 'armorer');
    ok(!!smith && FE.Steading.roomAt(v, smith.x, smith.y) >= 0 && v.buildings[FE.Steading.roomAt(v, smith.x, smith.y)].kind === 'smithy', `${v.name} 的武器匠沒站在工坊裡`);
    ok(!!arm && FE.Steading.roomAt(v, arm.x, arm.y) >= 0 && v.buildings[FE.Steading.roomAt(v, arm.x, arm.y)].kind === 'armory', `${v.name} 的盔甲匠沒站在盔甲匠工坊裡`);
    ok(folk.filter((n) => n.role === 'villager').every((n) => n.home), `${v.name} 有村民沒有家`);
    ok(g.soldiers.filter((s) => s.villageId === v.id).length === 2 * C.SOLDIER_PER_TOWN, `${v.name} 的士兵 ${g.soldiers.filter((s) => s.villageId === v.id).length} 位`);
    ok(['temple', 'market', 'keep', 'tower', 'smithy', 'armory'].every((k) => v.buildings.some((b) => b.kind === k)), `${v.name} 少了神殿、市場、城堡、塔樓或工坊：${[...new Set(v.buildings.map((b) => b.kind))]}`);
  }
  // 堡壘與要塞：鐵匠站在工坊、村民住兵營；城門接窄路，不走窄路要繞很遠
  for (const v of kinds('fort').concat(kinds('fortress'))) {
    const folk = w.npcs.filter((n) => n.villageId === v.id);
    const smith = folk.find((n) => n.role === 'smith');
    ok(!!smith && FE.Steading.roomAt(v, smith.x, smith.y) >= 0, `${v.name} 的鐵匠沒站在工坊裡`);
    ok(folk.filter((n) => n.role === 'villager').every((n) => n.home && v.buildings[n.home.b].kind === 'big'), `${v.name} 有村民沒住在兵營`);
    const f = v.flat;
    const [d0, d1] = v.exitDirs;
    const end = ([dx, dy], k) => [dx > 0 ? f.x1 + 3 : dx < 0 ? f.x0 - 3 : v.exitAt[k], dy > 0 ? f.y1 + 3 : dy < 0 ? f.y0 - 3 : v.exitAt[k]];
    const a = end(d0, 0);
    const b = end(d1, 1);
    const open = w.stepGrid([a], 600).at(b[0], b[1]);
    // 把城門堵起來再量（量完放回去）
    const gates = [];
    for (let y = f.y0; y <= f.y1; y++) for (let x = f.x0; x <= f.x1; x++) if (w.cell(x, y).t === '╪') gates.push([x, y]);
    for (const [x, y] of gates) w.setCell(x, y, '█', 'plain');
    const shut = w.stepGrid([a], 600).at(b[0], b[1]);
    for (const [x, y] of gates) w.setCell(x, y, '╪', 'plain');
    ok(open > 0 && open <= (v.kind === 'fortress' ? 70 : 40), `${v.name} 穿過城門 ${open} 步`);
    ok(shut < 0 || shut >= open + 30, `${v.name} 城門堵住時繞 ${shut} 步（穿過城門 ${open} 步）`);
    g.stat34 = (g.stat34 || []).concat([[v.kind, open, shut]]);
  }
  // 堡壘廢墟：39×25（或直放 25×39），從外圍走得到裡面每一格（checkInteriors 也查）
  for (const l of w.landmarks.filter((o) => o.kind === 'fort')) {
    const W = l.x1 - l.x0 + 1, H = l.y1 - l.y0 + 1;
    ok((W === 39 && H === 25) || (W === 25 && H === 39), `堡壘廢墟 ${W}×${H}`);
  }
  checkInteriors(g, '堡壘與城市場景');
  checkResidents(g, '堡壘與城市場景');
}

UNITS.terrain34 = () => {
  try {
    testVeil34();
    testSave34();
    testExits34();
    testSettle34();
  } catch (e) {
    fail('第三十四版場景測試拋出例外：' + e.stack);
  }
};
