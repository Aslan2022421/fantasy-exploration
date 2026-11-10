// 生成統計：各種子創出多塊世界，量聚落、地貌、城鎮、創世耗時
// ---- 生成統計 ----
const stats = { village: [], town: [], city: [], fort: [], fortress: [], ruins: 0, landmarks: 0, landmarkMiss: 0, ms: [], short: [], gateBugs: 0, townGaps: [], firstTowns: [], soldiers: 0, cliffs: 0, walls: 0, nodes: 0, nodeMiss: 0, passes: 0, passMiss: 0, worlds: 0 };
const geo = { w: [], h: [], area: [], open: [], nearBlock: 0, count: 0 };
const GEN_SEEDS = 40;
function runGen(seedLo, seedHi) {
for (let seed = seedLo; seed <= seedHi; seed++) {
  const game = new FE.Game(seed * 7919);
  game.start();
  verifyReach = seed === 1; // 新舊可達性比對只在一個種子上跑（第二十九版；原本前 5 個種子）
  for (let i = 0; i < 16; i++) {
    const t = hr();
    const m0 = reachCheck.fullMs;
    game.createChunk(false);
    // 創世耗時不含比對舊檢查花的時間
    stats.ms.push(hr() - t - (reachCheck.fullMs - m0));
  }
  verifyReach = false;
  const w = game.world;
  // 第三十四版：地形全是坡（兩格都能走、高度差 2 以上的相鄰格是 0；山壁擋路，另計格數）、採集點都走得到、隘口
  const reach = FE.Checker.reachable(w);
  let cliffs = 0;
  w.forEachCell((x, y, c) => {
    if (c.t === '█') stats.walls++;
    if (!FE.TERRAIN[c.t].pass) return;
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      const o = w.cell(x + dx, y + dy);
      if (o && FE.TERRAIN[o.t].pass && Math.abs(o.h - c.h) >= 2) cliffs++;
    }
  });
  stats.cliffs += cliffs;
  if (cliffs) fail(`生成 seed${seed} 相鄰高度差 2 以上的格子 ${cliffs} 對`);
  const lost = w.nodes.filter((n) => !w.passable(n.x, n.y) || !reach.at(n.x, n.y));
  stats.nodes += w.nodes.length;
  stats.nodeMiss += lost.length;
  if (lost.length) fail(`生成 seed${seed} 採集點走不到 ${lost.length} 個，例如 ${lost[0].kind} (${lost[0].x},${lost[0].y})`);
  stats.passes += (w.passes || []).length;
  stats.passMiss += w.passMiss || 0;
  stats.worlds++;
  // 城鎮出現時機（第三十二版照圈算）：蓋城鎮的那一段創出時世界等級至少 3，之後至少隔 4 段（4 或 5 段；最外圈放不下就再等）；開局是村莊
  const towns = w.villages.filter((v) => v.kind === 'town' || v.kind === 'city').sort((a, b) => a.region - b.region); // 城市算在城鎮的間隔裡（第三十四版）
  for (const t of towns) if (t.wl < C.TOWN_FIRST_LEVEL) fail(`生成 seed${seed} ${t.name} 在世界等級 ${t.wl} 就蓋了`);
  if (towns.length) stats.firstTowns.push(towns[0].region);
  for (let i = 1; i < towns.length; i++) {
    const gap = towns[i].region - towns[i - 1].region;
    stats.townGaps.push(gap);
    if (gap < 4) fail(`生成 seed${seed} 兩座城鎮只隔了 ${gap} 段`);
  }
  if (w.villages[0].kind !== 'village') fail(`生成 seed${seed} 開局不是村莊`);
  // 士兵：城鎮、堡壘各 3 位，城市、要塞各 6 位，站在自己聚落的室外，是職業角色套版（第三十六版之一）；每個聚落有隱形人口數，落在範圍的人口標籤那一段
  for (const v of w.villages) {
    const mine = game.soldiers.filter((s) => s.villageId === v.id);
    if (!C.SOLDIER_COUNT[v.kind]) { if (mine.length) fail(`生成 seed${seed} ${v.kind} ${v.name} 有士兵`); continue; }
    const want = C.SOLDIER_COUNT[v.kind];
    if (mine.length !== want && !(v.kind === 'fortress' && mine.length >= 3 && mine.length <= 6)) fail(`生成 seed${seed} ${v.name} 有 ${mine.length} 位士兵，應該固定是 ${want}`); // 堡壘加蓋成要塞時原有的 3 位，另 3 位照補員規則慢慢補
    stats.soldiers += mine.length;
    for (const s of mine) {
      if (w.villageAt(s.x, s.y) !== v || FE.Steading.roomAt(v, s.x, s.y) >= 0 || !w.passable(s.x, s.y)) fail(`生成 seed${seed} ${v.name} 士兵站的位置不對 (${s.x},${s.y})`);
      if (!s.equip || !FE.CLASSES[s.cls] || s.lv !== FE.soldierLevel(s.wl) || s.hp !== s.maxHp || s.maxHp !== FE.Char.maxHp(s, s.lv) || s.die) fail(`生成 seed${seed} 士兵不是職業角色套版 cls ${s.cls} lv ${s.lv} hp ${s.hp}/${s.maxHp}`);
    }
  }
  for (const v of w.villages) {
    const [lo, hi] = C.POP_RANGE[v.kind];
    const a = lo + ((hi - lo) * v.steading.population) / 5;
    const b = lo + ((hi - lo) * (v.steading.population + 1)) / 5;
    const named = w.npcs.filter((n) => n.villageId === v.id).length + game.soldiers.filter((s) => s.villageId === v.id).length;
    if (!(v.pop >= named && v.pop <= hi && ((v.pop >= Math.round(a) && v.pop <= Math.round(b)) || v.pop === named))) fail(`生成 seed${seed} ${v.name}（${v.kind}）人口 ${v.pop} 不在 ${a}～${b}（範圍 ${lo}～${hi}，有名字的 ${named}）`);
  }
  stats.ruins += w.landmarks.filter((l) => l.kind === 'fort').length;
  for (const v of w.villages) {
    const laid = v.kind === 'village' || v.kind === 'town'; // 排版的聚落；城市、堡壘、要塞照圖樣蓋（第三十四版）
    if (!laid) checkPlan(game, v, `生成 seed${seed}`);
    const want = laid ? (v.kind === 'town' ? C.TOWN_HOUSES : C.VILLAGE_HOUSES)[v.steading.population] : 0;
    const kinds = v.buildings.map((b) => b.kind);
    const houses = kinds.filter((k) => k === 'house' || k === 'big').length;
    const beds = v.buildings.reduce((s, b) => s + b.beds.length, 0);
    const needTemple = v.kind === 'town' && (FE.Steading.isHoly(v) || FE.Steading.has(v, '信仰'));
    const needMarket = v.kind === 'town' && FE.Steading.has(v, '市場');
    const s = {
      houses, want, beds, big: kinds.filter((k) => k === 'big').length,
      smithy: kinds.includes('smithy'), temple: !needTemple || kinds.includes('temple'), market: !needMarket || kinds.includes('market'),
      armory: v.kind !== 'town' || kinds.includes('armory'),
      entrances: v.entrances, villagers: w.npcs.filter((n) => n.villageId === v.id && !FE.Gear.isShopkeeper(n)).length,
    };
    // 工匠：每個聚落一位鐵匠（城鎮、城市、堡壘、要塞裡叫武器匠），這四種另有一位盔甲匠；村莊沒有盔甲匠；每個聚落一位商人（第三十六版之一）
    const smiths = w.npcs.filter((n) => n.villageId === v.id && n.role === 'smith').length;
    const armorers = w.npcs.filter((n) => n.villageId === v.id && n.role === 'armorer').length;
    const merchants = w.npcs.filter((n) => n.villageId === v.id && n.role === 'merchant').length;
    if (smiths !== 1 || armorers !== (FE.Steading.shopTown(v) ? 1 : 0) || merchants !== 1) fail(`生成 seed${seed} ${v.name} 工匠 ${smiths} 位鐵匠／武器匠、${armorers} 位盔甲匠、${merchants} 位商人`);
    if (FE.Steading.shopTown(v)) {
      const am = w.npcs.find((n) => n.villageId === v.id && n.role === 'armorer');
      const bi = v.buildings.findIndex((b) => b.kind === 'armory');
      if (am && bi >= 0 && FE.Steading.roomAt(v, am.x, am.y) !== bi) fail(`生成 seed${seed} ${v.name} 盔甲匠沒站在盔甲匠工坊裡`);
    }
    stats[v.kind].push(s);
    // 民房沒蓋齊、床位少於上限：使用者決定當作可接受的粗糙，只統計；村民沒有家才算錯（checkResidents）
    if (houses < want) stats.short.push(`seed${seed} ${v.name} 民房 ${houses}/${want}`);
    if (!s.smithy) fail(`生成 seed${seed} ${v.name} 沒有工坊`);
    if (!laid) { s.groups = v.entrances; s.kind = v.kind; continue; } // 圖樣聚落的出入口、大小在 checkPlan 查
    if (!s.armory) stats.noArmory = (stats.noArmory || 0) + 1; // 城鎮沒蓋成盔甲匠工坊（可接受的粗糙，盔甲匠改站在廣場旁）
    if (!s.temple || !s.market) fail(`生成 seed${seed} ${v.name} 少了神殿或市場`);
    if (beds < (v.kind === 'town' ? C.TOWN_MAX_NPC : C.VILLAGE_MAX_NPC)) stats.short.push(`seed${seed} ${v.name} 床位 ${beds}`);
    if (!w.passable(w.spawn.x, w.spawn.y)) fail(`生成 seed${seed} 出生點站不了`);
    // 出入口：聚落裡的路碰到聚落外面能走的格子
    const opens = [];
    let maskCells = 0, openCells = 0;
    for (let y = v.y0; y <= v.y1; y++) for (let x = v.x0; x <= v.x1; x++) {
      if (w.villageAt(x, y) !== v) continue;
      maskCells++;
      if (w.cell(x, y).t === '.' && FE.Steading.roomAt(v, x, y) < 0) openCells++;
      if (w.cell(x, y).t === '·' && DIRS.some(([dx, dy]) => !w.villageAt(x + dx, y + dy) && w.passable(x + dx, y + dy))) opens.push([x, y]);
    }
    const groups = [];
    const seen = new Set();
    const openKeys = new Set(opens.map((o) => key(...o)));
    for (const c of opens) {
      if (seen.has(key(...c))) continue;
      const g = [c]; seen.add(key(...c));
      for (let i = 0; i < g.length; i++) for (const [dx, dy] of DIRS8) {
        const n = [g[i][0] + dx, g[i][1] + dy];
        if (openKeys.has(key(...n)) && !seen.has(key(...n))) { seen.add(key(...n)); g.push(n); }
      }
      groups.push(g);
    }
    // 出入口不足要有一隻斷層怪物負責（打倒時開一個出入口）
    const gateBug = game.monsters.some((m) => m.data && m.data.villageId === v.id);
    if (gateBug) stats.gateBugs++;
    if ((groups.length < (v.kind === 'town' ? 4 : 3) && !gateBug) || groups.length > 4) fail(`生成 seed${seed} ${v.kind} ${v.name} 量到的出入口 ${groups.length} 個`);
    // 規格是「每座至少 3 個、每個寬至少 3 格」：走道鋪成路之後，走道貼著出入口時量起來會寬 4～5 格，也可能多出一個口，都合規格
    for (const g of groups) if (g.length < 3) fail(`生成 seed${seed} ${v.name} 出入口寬 ${g.length}`);
    const out = flood(w, opens);
    let outside = 0;
    for (const k of out) { const [x, y] = k.split(',').map(Number); if (!w.inBuffer(x, y)) outside++; }
    if (outside < 10) fail(`生成 seed${seed} ${v.name} 出入口走不出去`);
    s.groups = groups.length;
    // 外形：外接矩形、空地比例、靠水或巨石
    s.gw = v.x1 - v.x0 + 1; s.gh = v.y1 - v.y0 + 1;
    s.garea = s.gw * s.gh / (v.kind === 'town' ? C.TOWN_W * C.TOWN_H : C.VILLAGE_W * C.VILLAGE_H);
    s.gopen = openCells / maskCells;
    geo.count++;
    // 貼著外牆（8 鄰）的水或巨石格數，3 格以上算靠著
    let touch = 0;
    for (let y = v.y0 - 1; y <= v.y1 + 1; y++) for (let x = v.x0 - 1; x <= v.x1 + 1; x++) {
      const c = w.cell(x, y);
      if (!c || w.villageAt(x, y) || (c.t !== '≈' && c.t !== '#')) continue;
      if (DIRS8.some(([dx, dy]) => w.villageAt(x + dx, y + dy))) touch++;
    }
    if (touch >= 3) geo.nearBlock++;
    s.kind = v.kind;
  }
  stats.landmarks += w.landmarks.length;
  stats.landmarkMiss += w.villages.length - w.landmarks.length;
  checkInteriors(game, `生成 seed${seed}`);
  checkResidents(game, `生成 seed${seed}`);
  checkBuffer(game, `生成 seed${seed}`);
}
}


// 第三十四版：照圖樣蓋的聚落（城市、堡壘、要塞）。大小照圖樣（堡壘 45×29、要塞 45×58、城市 90×29，直放時寬高對調）、
// 出入口的數量（堡壘與要塞 2 個城門、城市 6 個）、每個出入口走得出去；堡壘與要塞在隘口上：記成一處隘口、
// 城門（╪）開在窄路的兩頭並接著路（城門外 3 格是路）、兩側貼著山壁（█）
function checkPlan(game, v, tag) {
  const w = game.world;
  const size = { fort: [45, 29], fortress: [45, 58], city: [90, 29] }[v.kind];
  const [fw, fh] = v.rot ? [size[1], size[0]] : size;
  const f = v.flat;
  if (f.x1 - f.x0 + 1 !== fw || f.y1 - f.y0 + 1 !== fh) fail(`${tag} ${v.kind} ${v.name} 大小 ${f.x1 - f.x0 + 1}×${f.y1 - f.y0 + 1}，應該是 ${fw}×${fh}`);
  const wantExits = v.kind === 'city' ? 6 : 2;
  if (v.entrances !== wantExits || (v.exitDirs || []).length !== wantExits) fail(`${tag} ${v.kind} ${v.name} 出入口 ${v.entrances} 個，應該是 ${wantExits}`);
  // 每個出入口外的路走得出去（不穿過聚落，走到離聚落外框「周圍的圈＋3 格」以外，或還沒長出來的地方）
  const D = w.bufferWidth(v) + 3;
  (v.exitDirs || []).forEach(([dx, dy], k) => {
    const c = v.exitAt[k];
    const sx = dx > 0 ? f.x1 + 3 : dx < 0 ? f.x0 - 3 : c;
    const sy = dy > 0 ? f.y1 + 3 : dy < 0 ? f.y0 - 3 : c;
    const seen = new Set([key(sx, sy)]);
    const q = [[sx, sy]];
    let out = false;
    for (let h = 0; h < q.length && !out; h++) {
      const [x, y] = q[h];
      if (Math.max(v.x0 - x, x - v.x1, v.y0 - y, y - v.y1) >= D) out = true;
      for (const [ax, ay] of DIRS) {
        const nx = x + ax, ny = y + ay;
        if (!w.cell(nx, ny)) { out = true; break; }
        if (seen.has(key(nx, ny)) || w.villageAt(nx, ny) === v || !w.canStep(x, y, nx, ny)) continue;
        seen.add(key(nx, ny));
        q.push([nx, ny]);
      }
    }
    if (!out) fail(`${tag} ${v.kind} ${v.name} 往 (${dx},${dy}) 的出入口走不出去`);
    if (v.kind !== 'city') {
      // 城門：出入口那一段的牆上是 3 格 ╪；城門外一直到圖樣外 3 格都是路
      const gate = [];
      for (let y = f.y0; y <= f.y1; y++) for (let x = f.x0; x <= f.x1; x++) if (w.cell(x, y).t === '╪') gate.push([x, y]);
      if (gate.length !== (v.kind === 'fortress' ? 9 : 6)) fail(`${tag} ${v.kind} ${v.name} 城門 ${gate.length} 格（堡壘兩頭各 3 格、要塞中間的隔牆再 3 格）`);
      for (const o of [-1, 0, 1]) {
        const x = dx > 0 ? f.x1 + 3 : dx < 0 ? f.x0 - 3 : c + o;
        const y = dy > 0 ? f.y1 + 3 : dy < 0 ? f.y0 - 3 : c + o;
        if (w.cell(x, y) && w.cell(x, y).t !== '·' && w.cell(x, y).t !== '≈') fail(`${tag} ${v.kind} ${v.name} 城門外的路斷了 (${x},${y}) 是 ${w.cell(x, y).t}`);
      }
    }
  });
  if (v.kind === 'fort' || v.kind === 'fortress') {
    const pass = (w.passes || []).find((p) => p.fort === v.id);
    if (!pass) fail(`${tag} ${v.kind} ${v.name} 沒有記成隘口`);
    // 兩側貼著山壁：圖樣兩側那一欄（或一列）全是 █，外面再接出去的山壁或湖至少 1 格
    const side = v.rot ? [[f.y0, 0], [f.y1, 0]] : [[f.x0, 0], [f.x1, 0]];
    for (const [edge] of side) {
      let wall = 0;
      const n = v.rot ? fw : fh;
      for (let i = 0; i < n; i++) {
        const [x, y] = v.rot ? [f.x0 + i, edge] : [edge, f.y0 + i];
        if (w.cell(x, y).t === '█') wall++;
      }
      if (wall !== n) fail(`${tag} ${v.kind} ${v.name} 側邊的山壁只有 ${wall}/${n} 格`);
    }
    stats.fortWall = (stats.fortWall || 0) + (pass ? pass.len : 0);
  }
}
