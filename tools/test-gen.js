// 生成統計：各種子創出多塊世界，量聚落、地貌、城鎮、創世耗時
// ---- 生成統計 ----
const stats = { village: [], town: [], landmarks: 0, landmarkMiss: 0, ms: [], short: [], gateBugs: 0, townGaps: [], firstTowns: [], soldiers: 0, cliffs: 0, walls: 0, nodes: 0, nodeMiss: 0, passes: 0, passMiss: 0, worlds: 0 };
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
  const towns = w.villages.filter((v) => v.kind === 'town').sort((a, b) => a.region - b.region);
  for (const t of towns) if (t.wl < C.TOWN_FIRST_LEVEL) fail(`生成 seed${seed} ${t.name} 在世界等級 ${t.wl} 就蓋了`);
  if (towns.length) stats.firstTowns.push(towns[0].region);
  for (let i = 1; i < towns.length; i++) {
    const gap = towns[i].region - towns[i - 1].region;
    stats.townGaps.push(gap);
    if (gap < 4) fail(`生成 seed${seed} 兩座城鎮只隔了 ${gap} 段`);
  }
  if (w.villages[0].kind !== 'village') fail(`生成 seed${seed} 開局不是村莊`);
  // 士兵：每座城鎮固定 3 位，站在自己城鎮的室外，數值以同世界等級的小怪物為準
  for (const v of w.villages) {
    const mine = game.soldiers.filter((s) => s.villageId === v.id);
    if (v.kind !== 'town') { if (mine.length) fail(`生成 seed${seed} 村莊 ${v.name} 有士兵`); continue; }
    const want = 3;
    if (C.SOLDIER_PER_TOWN !== 3 || mine.length !== want) fail(`生成 seed${seed} ${v.name} 有 ${mine.length} 位士兵，應該固定是 ${want}`);
    stats.soldiers += mine.length;
    for (const s of mine) {
      if (w.villageAt(s.x, s.y) !== v || FE.Steading.roomAt(v, s.x, s.y) >= 0 || !w.passable(s.x, s.y)) fail(`生成 seed${seed} ${v.name} 士兵站的位置不對 (${s.x},${s.y})`);
      const wl = s.wl;
      const base = FE.makeMonster({ type: 'TERRAIN', x: 0, y: 0, cells: [], scope: 2 }, 0, wl);
      if (s.maxHp !== Math.max(1, Math.round(base.maxHp * 0.9)) || s.atk !== Math.max(1, base.atk - 1) || s.hp !== s.maxHp || s.ac !== base.ac || s.toHit !== base.toHit || s.dmgBonus !== base.dmgBonus - 1) fail(`生成 seed${seed} 士兵數值不對 hp ${s.hp}/${s.maxHp} atk ${s.atk}（基準 ${base.maxHp}/${base.atk}）`);
    }
  }
  for (const v of w.villages) {
    const want = (v.kind === 'town' ? C.TOWN_HOUSES : C.VILLAGE_HOUSES)[v.steading.population];
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
    // 工匠：每個聚落一位鐵匠（城鎮裡叫武器匠），城鎮另有一位盔甲匠；村莊沒有盔甲匠
    const smiths = w.npcs.filter((n) => n.villageId === v.id && n.role === 'smith').length;
    const armorers = w.npcs.filter((n) => n.villageId === v.id && n.role === 'armorer').length;
    if (smiths !== 1 || armorers !== (v.kind === 'town' ? 1 : 0)) fail(`生成 seed${seed} ${v.name} 工匠 ${smiths} 位鐵匠／武器匠、${armorers} 位盔甲匠`);
    if (v.kind === 'town') {
      const am = w.npcs.find((n) => n.villageId === v.id && n.role === 'armorer');
      const bi = v.buildings.findIndex((b) => b.kind === 'armory');
      if (am && bi >= 0 && FE.Steading.roomAt(v, am.x, am.y) !== bi) fail(`生成 seed${seed} ${v.name} 盔甲匠沒站在盔甲匠工坊裡`);
    }
    stats[v.kind].push(s);
    // 民房沒蓋齊、床位少於上限：使用者決定當作可接受的粗糙，只統計；村民沒有家才算錯（checkResidents）
    if (houses < want) stats.short.push(`seed${seed} ${v.name} 民房 ${houses}/${want}`);
    if (!s.smithy) fail(`生成 seed${seed} ${v.name} 沒有工坊`);
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
    if ((groups.length < 3 && !gateBug) || groups.length > 4) fail(`生成 seed${seed} ${v.name} 量到的出入口 ${groups.length} 個`);
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

