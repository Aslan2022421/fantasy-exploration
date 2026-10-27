// 遊戲狀態與規則：移動、對話、回合制戰鬥、等級與創世、村莊、執行時錯誤的處理。
// 遊戲內的文字一律叫「怪物」，不出現 BUG。
(function () {
  const C = FE.CONFIG;
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  // 升到第 level 級要的累計經驗值
  FE.levelExp = (level) => (level <= 1 ? 0 : (level - 1) * C.LEVEL_FIRST + (C.LEVEL_STEP * (level - 2) * (level - 1)) / 2);

  class Game {
    constructor(seed) {
      this.seed = seed;
      this.rng = FE.makeRng((seed ^ 0x9e3779b9) >>> 0);
      this.world = new FE.World(seed);
      this.monsters = [];
      this.nextMonsterId = 1;
      this.log = [];
      this.turn = 0;
      this.ticks = 0;        // 經過的時間（刻）
      this.exp = 0;          // 累計經驗值，只增不減；只管冒險者的等級
      this.level = 1;
      this.creation = 0;     // 創世力（不顯示）：累計的算力裡進創世的那一份
      this.nextChunkAt = 0;  // 創世力累計到這裡，創世神解出下一塊（不顯示）
      this.compute = 0;      // 修補力（不顯示）：算力裡進修補的那一份，用來演算事件、維持穩定
      this.battle = { targetId: null, cooldown: 0 }; // 目前的目標與重擊冷卻
      this.worldState = 0;   // 世界狀態：0 安穩、1 動盪、2 失序（stability.js）；世界等級另外算，見 FE.Stability.worldLevel
      this.soldiers = [];    // 城鎮的士兵（role 'soldier'），不在 world.npcs 裡
      this.worldEvery = 1;   // 冒險者每做幾個動作，世界（怪物、士兵）才走一回合；平常是 1，測試的「四人等效」模擬用 4（不進存檔）
      this.worldClock = 0;
      this.soldierClock = 0;
      this.fixed = [];       // 修好的地形錯位與斷崖，動盪時可能復發
      this.fell = false;     // 這一個動作裡冒險者倒下了
      this.talking = null;   // 對話視窗開著時，對方的 id（不進存檔）
      this.player = null;
      this.history = FE.store.load('fe.history', []);
      this.reports = FE.store.load('fe.reports', []);
    }

    start() {
      this.say('創世神正在創世。你是冒險者：走遍世界、打倒怪物、完成任務，世界會跟著長下去。', 'sys');
      this.createChunk(true);
      const s = this.world.spawn;
      this.player = {
        x: s.x,
        y: s.y,
        hp: C.PLAYER_MAX_HP,
        maxHp: C.PLAYER_MAX_HP,
        atk: C.PLAYER_ATK,
        weaponLv: 0,
        block: C.BLOCK_BASE,
        gold: 0,
        carrying: null,
        name: FE.store.load('fe.name', '冒險者'),
        steps: 0,
      };
      this.lastSafe = { x: s.x, y: s.y };
    }

    say(text, kind) {
      this.log.unshift({ text, kind: kind || 'sys' });
      if (this.log.length > 40) this.log.length = 40;
    }

    // ---- 世界與怪物 ----

    // 創世時替這塊世界的每隻怪物配好「打倒時給的算力」、每個任務配好「完成時給的算力」，
    // 加總後乘 PLAYER_COMPUTE_SCALE 與 CREATION_SHARE，就是到下一塊要累積的創世力。
    // 清光這塊世界，一定解得出下一塊；途中的移動、出手、清掉事件與侵蝕生的怪物，都會讓它更快。
    // 新的一塊長在離冒險者最近的邊界上（第一塊在原點）
    createChunk(first) {
      let cx = 0;
      let cy = 0;
      if (!first) {
        const at = this.player || this.world.spawn;
        const slot = this.world.nearestFrontier(at.x, at.y);
        cx = slot.cx;
        cy = slot.cy;
      }
      const { index, rect, village } = this.world.addChunk(cx, cy);
      // 新聚落的周圍那一圈可能伸進舊的區塊：已經在那裡的怪物挪到圈外
      // （站在圈外、但生成點在圈內的，生成點改成現在站的位置）
      const bad = (m) => this.world.inBuffer(m.x, m.y) || this.world.inBuffer(m.home.x, m.home.y);
      if (village && this.monsters.some(bad)) {
        const reach = FE.Checker.reachable(this.world);
        for (const m of this.monsters) {
          if (!bad(m)) continue;
          if (!this.world.inBuffer(m.x, m.y)) {
            m.home = { x: m.x, y: m.y };
            continue;
          }
          const free = this.findFreeNear(m.x, m.y, (x, y) => reach.has(x + ',' + y));
          if (free) Object.assign(m, { x: free.x, y: free.y, home: { x: free.x, y: free.y } });
        }
      }
      // 世界越亂，新的一塊越粗糙：依世界狀態額外多蓋幾塊氣候印章或高度突變（基本生成不變）
      FE.Stability.roughen(this, rect);
      const inChunk = (n) => FE.inRect(rect, n.x, n.y);
      const found = FE.Checker.scan(this.world, rect, this.monsters);
      // 斷層蟲先放，牠負責的區域打通後就走得到，區域裡的怪物和村民才算碰得到
      found.sort((a, b) => (a.type === 'UNREACHABLE' ? 0 : 1) - (b.type === 'UNREACHABLE' ? 0 : 1));
      const reach = FE.Checker.reachable(this.world);
      const pending = new Set();
      const canReach = (x, y) => {
        const k = x + ',' + y;
        if (reach.has(k) || pending.has(k)) return true;
        return DIRS.some(([dx, dy]) => reach.has(x + dx + ',' + (y + dy)) && this.world.heightOk(x, y, x + dx, y + dy));
      };
      const spawned = [];
      for (const d of found) {
        const m = this.spawnMonster(d, canReach);
        if (!m) {
          // 放不下的地形錯位記起來，之後檢查侵蝕時不把它當成新的
          if (d.type === 'TERRAIN' || d.type === 'CLIFF') for (const [x, y] of d.cells) this.world.dormant.add(x + ',' + y);
          continue;
        }
        spawned.push(m);
        if (m.type === 'UNREACHABLE') for (const [x, y] of m.cells) pending.add(x + ',' + y);
      }
      // 收貨人不存在、懸空指標又放不下的任務直接撤回，不然接了會永遠送不出去
      for (const n of this.world.npcs) {
        if (!inChunk(n) || !FE.Checker.checkNpc(this.world, n)) continue;
        if (!spawned.some((m) => m.type === 'REFERENCE' && m.data.npcId === n.id)) n.quest = null;
      }
      // 任務算進門檻的條件：給任務的人碰得到；收貨人存在就要碰得到，不存在就要有懸空指標負責把他放回來
      const quests = this.world.npcs
        .filter((n) => inChunk(n) && n.quest && canReach(n.x, n.y))
        .filter((n) => {
          const t = this.world.npcById(n.quest.targetId);
          if (t) return canReach(t.x, t.y);
          return spawned.some((m) => m.type === 'REFERENCE' && m.data.npcId === n.id);
        })
        .map((n) => n.quest);
      const content = spawned.reduce((s, m) => s + m.compute, 0) + quests.reduce((s, q) => s + q.compute, 0);
      this.nextChunkAt = (first ? 0 : this.nextChunkAt) + content * C.PLAYER_COMPUTE_SCALE * C.CREATION_SHARE;
      // 城鎮的士兵（住幾位看人口）
      if (village && village.kind === 'town') {
        for (let i = 0; i < this.soldierQuota(village); i++) this.spawnSoldier(village);
      }

      const mids = spawned.filter((m) => m.tier !== 'small').length;
      const where = first ? '' : this.directionTo(rect);
      const head = first ? '第 1 塊世界誕生了，' : `創世神在你的${where}解出第 ${index + 1} 塊世界，`;
      const vtext = village
        ? (village.kind === 'town' ? `大城鎮${village.name}建在這塊世界` : `${village.name}在這塊世界`) +
          `（${FE.PROSPERITY[village.steading.prosperity]}、${FE.POPULATION[village.steading.population]}），`
        : '';
      this.say(`${head}${vtext}出現 ${spawned.length} 隻怪物${mids ? `（其中 ${mids} 隻中型怪物）` : ''}、${quests.length} 個任務。`, 'world');
      FE.Stability.update(this, first);
    }

    // 一塊區域在冒險者的哪個方位（八方位）
    directionTo(rect) {
      const p = this.player;
      const dx = (rect.x0 + rect.x1) / 2 - p.x;
      const dy = (rect.y0 + rect.y1) / 2 - p.y;
      const ang = (Math.atan2(dy, dx) * 180) / Math.PI; // 0 是東，90 是南（畫面往下）
      const names = ['東方', '東南方', '南方', '西南方', '西方', '西北方', '北方', '東北方'];
      return names[(Math.round(ang / 45) + 8) % 8];
    }

    monsterAt(x, y) {
      return this.monsters.find((m) => m.x === x && m.y === y) || null;
    }

    soldierAt(x, y) {
      return this.soldiers.find((s) => s.x === x && s.y === y) || null;
    }

    // ---- 士兵 ----
    // 只有城鎮有。住幾位看人口（大舉遷出、縮減 1 位，穩定、成長 2 位，急速發展 3 位）。
    // 數值以同世界等級的小怪物為準，不升級；被打倒就消失，要等世界回到安穩，該城鎮才補回原本的人數。
    soldierQuota(v) {
      return C.SOLDIER_COUNT[v.steading ? v.steading.population : 2];
    }

    // 在城鎮室外的空地放一位士兵；沒位置放就不放
    spawnSoldier(v) {
      const w = this.world;
      const spots = [];
      for (let y = v.y0; y <= v.y1; y++) {
        for (let x = v.x0; x <= v.x1; x++) {
          if (w.villageAt(x, y) !== v || !w.passable(x, y) || FE.Steading.roomAt(v, x, y) >= 0) continue;
          if (w.npcAt(x, y) || w.chestAt(x, y) || this.soldierAt(x, y) || this.isPlayerAt(x, y)) continue;
          spots.push([x, y]);
        }
      }
      if (!spots.length) return null;
      const [x, y] = FE.pick(this.rng, spots);
      const s = Object.assign(
        { id: w.nextId++, name: FE.pickName(w, this.rng), role: 'soldier', villageId: v.id, x, y, wl: FE.Stability.worldLevel(this), in: true },
        FE.soldierStats(FE.Stability.worldLevel(this))
      );
      this.soldiers.push(s);
      return s;
    }

    // 世界回到安穩，陣亡的士兵補回原本的人數
    refillSoldiers() {
      for (const v of this.world.villages) {
        if (v.kind !== 'town') continue;
        const lack = this.soldierQuota(v) - this.soldiers.filter((s) => s.villageId === v.id).length;
        for (let i = 0; i < lack; i++) {
          if (this.spawnSoldier(v)) FE.Stability.stat(this).refills++;
        }
      }
    }

    // 士兵被打倒：消失，不再補到世界回到安穩為止
    soldierDown(s, by) {
      this.soldiers = this.soldiers.filter((o) => o !== s);
      FE.Stability.stat(this).soldierDeaths++;
      const p = this.player;
      if (Math.abs(s.x - p.x) + Math.abs(s.y - p.y) <= C.SIGHT) this.say(`士兵被${by ? by.name : '怪物'}打倒了。`, 'bug');
    }

    // 對話的對象：村民、武器匠或士兵
    talkTarget(id) {
      return this.world.npcById(id) || this.soldiers.find((s) => s.id === id) || null;
    }

    isPlayerAt(x, y) {
      return !!this.player && this.player.x === x && this.player.y === y;
    }

    // 找附近能放怪物的空地：不在聚落和它周圍那一圈裡；canReach(x, y) 給了就要冒險者碰得到
    findFreeNear(x0, y0, canReach) {
      const w = this.world;
      for (let r = 1; r <= 40; r++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            const x = x0 + dx;
            const y = y0 + dy;
            if (!w.passable(x, y) || this.monsterAt(x, y) || this.isPlayerAt(x, y) || w.inBuffer(x, y)) continue;
            if (w.npcAt(x, y) || w.chestAt(x, y) || this.soldierAt(x, y)) continue;
            if (canReach && !canReach(x, y)) continue;
            return { x, y };
          }
        }
      }
      return null;
    }

    spawnMonster(d, canReach) {
      let { x, y } = d;
      const blocked = this.monsterAt(x, y) || this.isPlayerAt(x, y) || this.soldierAt(x, y) || this.world.inBuffer(x, y);
      if (blocked || (canReach && !canReach(x, y))) {
        const free = this.findFreeNear(x, y, canReach);
        if (!free) return null;
        x = free.x;
        y = free.y;
      }
      // 新生成的怪物照生成當下的世界等級套用加成
      const m = FE.dressMonster(FE.makeMonster(Object.assign({}, d, { x, y }), this.nextMonsterId++, FE.Stability.worldLevel(this)), this.world);
      this.monsters.push(m);
      return m;
    }

    // 經驗值只管冒險者的等級；創世改看算力（earn）
    addExp(n) {
      if (n <= 0) return;
      this.exp += n;
      const p = this.player;
      while (p && this.exp >= FE.levelExp(this.level + 1)) {
        this.level++;
        p.maxHp += C.LEVEL_HP;
        p.hp += C.LEVEL_HP;
        this.say(`升到 Lv${this.level}！生命上限 +${C.LEVEL_HP}（現在 ${p.maxHp}）。`, 'world');
      }
    }

    // 冒險者做事得到的算力（raw 是單人份量）：乘上 PLAYER_COMPUTE_SCALE（單人先當成四位玩家，之後做多人時改回 1），
    // 一份進創世力，其餘進修補力。opts.repairOnly：只進修補力（休息）
    earn(raw, opts) {
      if (!(raw > 0)) return;
      const total = raw * C.PLAYER_COMPUTE_SCALE;
      if (!(opts && opts.repairOnly)) this.creation += total * C.CREATION_SHARE;
      this.addRepair(total * (1 - C.CREATION_SHARE));
      this.checkCreate();
    }

    // 創世力累積到門檻就解出下一塊（可能連續解出幾塊）。
    // 新的一塊沒有怪物也沒有任務時，門檻不會往後推，會連續往下創；設上限避免無窮迴圈
    checkCreate() {
      for (let i = 0; i < 10 && this.creation >= this.nextChunkAt; i++) this.createChunk(false);
    }

    // ---- 冒險者行動 ----
    // 回合骨架：冒險者每一回合只做一件事（移動一步，或一個行動：攻擊、重擊、撤退、休息、對話），
    // 接著所有怪物各做一件事（移動一步或攻擊）。戰鬥中世界不暫停，貼著的怪物都會攻擊（圍攻）。

    // 貼在冒險者旁邊（高度差 1 以內）的怪物
    adjacentMonsters() {
      const p = this.player;
      return this.monsters.filter((m) => FE.AI.touching(this, m, p));
    }

    // 目前的目標：撞上去或上一次攻擊的那隻，還貼著就是；不然旁邊血量最少的；旁邊沒有怪物就是 null
    targetMonster() {
      const adj = this.adjacentMonsters();
      if (!adj.length) return null;
      return adj.find((m) => m.id === this.battle.targetId) || adj.slice().sort((a, b) => a.hp - b.hp)[0];
    }

    // 每做一個動作，重擊的冷卻少一回合
    beginAction() {
      if (this.battle.cooldown > 0) this.battle.cooldown--;
    }

    // 累積修補力：世界越亂，創世神分到演算事件的修補力越少（創世力不受影響）
    addRepair(n) {
      this.compute = Math.min(C.COMPUTE_CAP, this.compute + n * FE.Stability.mult(this, 'COMPUTE'));
    }

    move(dx, dy) {
      const p = this.player;
      const nx = p.x + dx;
      const ny = p.y + dy;
      if (!this.world.inBounds(nx, ny)) {
        this.say('那邊是還沒創出來的世界。走遍世界、打倒怪物，創世神會在離你最近的邊界解出下一塊。', 'sys');
        return;
      }
      // 隔著斷崖（高度差 2 以上）碰不到對面，也過不去
      if (!this.world.heightOk(p.x, p.y, nx, ny)) {
        this.say('這裡是斷崖，太陡了過不去。', 'sys');
        return;
      }
      const m = this.monsterAt(nx, ny);
      if (m) {
        // 撞上怪物就是攻擊牠，並把牠設成目前的目標
        this.strike('attack', m);
        return;
      }
      const npc = this.world.npcAt(nx, ny) || this.soldierAt(nx, ny);
      if (npc) {
        // 對話不移動，算一個動作但不算步數；打開對話視窗，選項在視窗裡選（村民、武器匠、士兵都一樣）
        this.openTalk(npc);
        return;
      }
      if (!this.world.passable(nx, ny)) return;
      this.beginAction();
      const leaving = this.adjacentMonsters();
      p.x = nx;
      p.y = ny;
      this.discover();
      // 趁機攻擊：從貼著的怪物旁走開，那隻怪物有機率白打一下（走判定流程，但這一下不觸發反擊）
      for (const o of leaving) {
        if (!this.monsters.includes(o) || FE.AI.touching(this, o, p) || this.rng() >= C.OPPORTUNITY_CHANCE) continue;
        FE.Combat.resolveAttack(this, o, p, 'attack', { noCounter: true, opportunity: true });
        if (this.fell) {
          this.fell = false; // 倒下了，已經回到醒來的地方
          this.turn++;
          return;
        }
      }
      const chest = this.world.chestAt(nx, ny);
      if (chest) {
        // 數值暴走體徘徊離開後，寶箱還是壞的，要打倒牠才修得好
        if (FE.Checker.checkChest(chest)) this.say('寶箱被怪物的力量封住了，打不開。', 'sys');
        else this.openChest(chest);
      }
      if (this.isHardGround(nx, ny)) {
        this.say(`這裡的地面被異常扭曲過，很難走，這一步花了 ${C.TICKS_HARD} 刻。`, 'sys');
        this.endTurn(true, C.TICKS_HARD);
      } else {
        this.endTurn();
      }
    }

    // 冒險者做完一個動作：每個動作都附帶一點虛擬的修補力；移動才累積步數與算力。
    // 時間用「刻」算（參考矮人要塞）：動作花幾刻，怪物每 10 刻行動一次；失序時每個動作的刻加倍，怪物多動一次。
    // 士兵跟冒險者同步：冒險者每做一個動作，士兵做一個動作（失序時怪物動兩次，士兵仍只動一次）
    endTurn(moved, ticks) {
      const chaos = FE.Stability.state(this) === 2 ? C.CHAOS_TIME : 1;
      const t = (ticks || C.TICKS_MOVE) * chaos;
      this.turn++;
      this.ticks = (this.ticks || 0) + t;
      const p = this.player;
      FE.Combat.regenBlock(this, p);
      this.addRepair(C.VIRTUAL_REPAIR);
      if (moved !== false) {
        p.steps++;
        this.earn(C.COMPUTE_PER_MOVE);
        if (p.steps % C.EVENT_EVERY === 0) FE.Events.tick(this);
        if (p.steps % C.NPC_MOVE_EVERY === 0) FE.AI.npcTurn(this);
      }
      // 平常 worldEvery 是 1：每個動作世界走一回合。測試的「四人等效」模擬用 4：每 4 個動作世界才走 1 回合
      this.soldierClock += 1 / this.worldEvery;
      if (this.soldierClock >= 1) {
        this.soldierClock -= 1;
        FE.AI.soldierTurn(this);
      }
      this.worldClock += Math.max(1, Math.round(t / C.TICKS_MOVE)) / this.worldEvery;
      while (this.worldClock >= 1 && !this.fell) {
        this.worldClock -= 1;
        FE.AI.worldTurn(this);
      }
      if (this.fell) this.worldClock -= Math.floor(this.worldClock); // 冒險者倒下了，沒走完的回合不補
      this.fell = false;
      FE.Stability.update(this);
    }

    // 攻擊目前的目標（撞上去或按 1、2）：一個動作，打完所有怪物各做一件事
    strike(kind, m) {
      const p = this.player;
      // 村莊是安全區：站在聚落裡（包括邊緣）不能對外面的怪物動手
      if (this.world.inVillage(p.x, p.y)) {
        this.say('在村莊和城鎮裡不能動手，先走出去。', 'sys');
        return;
      }
      this.beginAction();
      this.battle.targetId = m.id;
      // 打怪的過程是在提供算力給創世神：每次出手跟走一步一樣累積算力（經驗值與打倒怪物的算力等打倒才結算）
      this.earn(C.COMPUTE_PER_ATTACK);
      if (kind === 'deep') this.battle.cooldown = 3;
      FE.Combat.resolveAttack(this, p, m, kind);
      this.endTurn(false);
    }

    // 被怪物的異常扭曲過的地面（氣候錯位、斷崖影響的格子）很難走
    isHardGround(x, y) {
      const hit = (m) => (m.type === 'TERRAIN' || m.type === 'CLIFF') && m.cells.some(([cx, cy]) => cx === x && cy === y);
      return this.monsters.some((m) => hit(m) || (m.members && m.members.some(hit)));
    }

    // 休息：回 1 點生命，在村莊裡休息就回滿；只把修補力存起來（不進創世力），事件照移動步數演算。旁邊有怪物時不能休息
    rest() {
      if (this.adjacentMonsters().length) {
        this.say('旁邊有怪物，沒辦法休息。', 'sys');
        return;
      }
      this.beginAction();
      const p = this.player;
      const v = this.world.villageAt(p.x, p.y);
      if (v) {
        p.hp = p.maxHp;
        this.say(`你在${v.name}好好休息了一晚，生命回滿。`, 'good');
      } else {
        p.hp = Math.min(p.maxHp, p.hp + C.REST_HEAL);
        this.say(`你休息了一下，生命回復 ${C.REST_HEAL}。`, 'sys');
      }
      this.earn(C.REST_COMPUTE, { repairOnly: true });
      this.endTurn(false);
    }

    openChest(chest) {
      const p = this.player;
      const gold = Math.max(0, chest.gold | 0);
      p.gold += gold;
      p.hp = Math.min(p.maxHp, p.hp + 5);
      this.world.chests = this.world.chests.filter((c) => c !== chest);
      this.say(`打開寶箱：金幣 +${gold}，生命回復 5。`, 'good');
    }

    // 清除委託指定的小怪物還剩幾隻；合體了的話，合體怪物還在就算還在
    huntRemaining(ids) {
      return ids.filter((id) => this.monsters.some((m) => m.id === id || (m.members && m.members.some((o) => o.id === id)))).length;
    }

    // 武器改良的價錢跟著聚落的經濟走：越富裕越便宜，有市場再便宜一成
    smithPrice(v) {
      const base = C.SMITH_PRICE + C.SMITH_PRICE_STEP * this.player.weaponLv;
      return Math.round(base * FE.Steading.smithFactor(v));
    }

    // ---- 對話 ----
    // 撞上村民或武器匠就打開對話視窗（畫面在 render.js，按鍵在 main.js）：打開算一個動作，不算步數，
    // 怪物各做一件事；在對話裡選選項不再花動作（改良武器也一樣，一次對話改良一次，改完關掉）。
    // 對話開著時 game.talking 記著對方的 id（不進存檔）

    openTalk(npc) {
      this.beginAction();
      this.talking = npc.id;
      this.endTurn(false);
    }

    // 對話的內容：{ name, role, village, text, options: [{ id, label, note, disabled }] }
    talkOptions(npc) {
      const p = this.player;
      const q = npc.quest;
      const c = p.carrying;
      const v = this.world.villageById(npc.villageId);
      const leave = { id: 'leave', label: '離開' };
      const out = (text, options) => ({
        name: npc.name,
        role: npc.role === 'smith' ? '武器匠' : npc.role === 'soldier' ? '士兵' : '村民',
        village: v ? v.name : '',
        text,
        options,
      });
      // 士兵只有一句閒話
      if (npc.role === 'soldier') return out(FE.SOLDIER_LINES[(npc.id + this.turn) % FE.SOLDIER_LINES.length], [leave]);
      if (npc.role === 'smith') {
        const price = this.smithPrice(v);
        const short = price - p.gold;
        return out(
          `你的武器是 Lv${p.weaponLv}，攻擊力 ${p.atk}。改良一級要 ${price} 金幣，改良後攻擊力會加 1～2。你身上有 ${p.gold} 金幣。`,
          [{ id: 'improve', label: '改良', note: short > 0 ? `還差 ${short} 金幣` : `${price} 金幣`, disabled: short > 0 }, leave]
        );
      }
      if (c && c.kind === 'hunt' && c.giverId === npc.id) {
        const left = this.huntRemaining(c.monsterIds);
        if (left > 0) return out(`附近還有 ${left} 隻小怪物，拜託了。`, [leave]);
        return out('村子外面安靜多了，謝謝你。', [{ id: 'report', label: '回報，領取獎勵', note: `經驗值 +${c.exp}、金幣 +${c.gold}` }, leave]);
      }
      // 先處理交件，再處理接委託：收貨人身上自己也有委託時，貨照樣交得出去
      if (c && c.kind !== 'hunt' && c.targetId === npc.id) {
        return out(`你是把${c.item}送來的人吧？`, [{ id: 'deliver', label: '交給他', note: `經驗值 +${c.exp}、金幣 +${c.gold}` }, leave]);
      }
      if (q && q.kind === 'hunt' && !q.accepted && !q.done) {
        if (c) return out('你手上已經有委託了，辦完再來找我。', [leave]);
        return out(`${q.village}附近冒出了 ${q.total} 隻小怪物，可以幫忙清掉嗎？清完回來找我。`, [
          { id: 'accept', label: '接下', note: `經驗值 +${q.exp}、金幣 +${q.gold}` },
          { id: 'decline', label: '不接' },
        ]);
      }
      if (q && q.kind === 'hunt' && q.accepted && !q.done) return out('村子附近的小怪物還在。', [leave]);
      if (q && !q.accepted && !q.done) {
        if (c) return out('你手上已經有東西要送了，送完再來找我。', [leave]);
        const line = FE.fill(q.line, { giver: npc.name, target: q.targetName, village: q.targetVillage, item: q.item }).replace(/^[^：]*：/, '');
        return out(line, [
          { id: 'accept', label: '接下', note: `經驗值 +${q.exp}、金幣 +${q.gold}` },
          { id: 'decline', label: '不接' },
        ]);
      }
      if (q && q.accepted && !q.done) return out(`${q.targetVillage}的${q.targetName}還在等${q.item}。`, [leave]);
      // 閒話：用村民的 id 和回合數挑，對話開著時不會變
      return out(FE.IDLE_LINES[(npc.id + this.turn) % FE.IDLE_LINES.length], [leave]);
    }

    // 選第 i 個選項；回傳 { close } 說明對話要不要關。不接的委託留在村民身上，之後回來還接得到
    choose(npc, i) {
      const t = this.talkOptions(npc);
      const o = t.options[i];
      if (!o) return { close: false };
      const p = this.player;
      const q = npc.quest;
      const c = p.carrying;
      let close = true;
      if (o.id === 'improve') {
        const price = this.smithPrice(this.world.villageById(npc.villageId));
        if (p.gold < price) {
          this.say(`${npc.name}：把武器改良一級要 ${price} 金幣，你現在有 ${p.gold}。`, 'npc');
          close = false;
        } else {
          const gain = FE.randInt(this.rng, 1, 2);
          p.gold -= price;
          p.atk += gain;
          p.weaponLv++;
          this.say(`${npc.name}幫你改良了武器：武器 Lv${p.weaponLv}，攻擊力 +${gain}（現在 ${p.atk}），花了 ${price} 金幣。`, 'good');
        }
      } else if (o.id === 'report') {
        if (q) q.done = true;
        this.say(`${npc.name}：村子外面安靜多了，謝謝你。`, 'npc');
        this.say(`委託完成：經驗值 +${c.exp}、金幣 +${c.gold}。`, 'good');
        p.gold += c.gold;
        p.carrying = null;
        this.addExp(c.exp);
        this.earn(c.compute); // 完成委託的算力
      } else if (o.id === 'deliver') {
        const giver = this.world.npcById(c.giverId);
        if (giver && giver.quest) giver.quest.done = true;
        const { exp, gold, item, compute } = c;
        this.say(`${npc.name}：謝謝你把${item}送來。`, 'npc');
        this.say(`任務完成：經驗值 +${exp}、金幣 +${gold}。`, 'good');
        p.gold += gold;
        p.carrying = null;
        this.addExp(exp);
        this.earn(compute);
      } else if (o.id === 'accept') {
        q.accepted = true;
        if (q.kind === 'hunt') {
          p.carrying = { kind: 'hunt', giverId: npc.id, monsterIds: q.monsterIds, total: q.total, village: q.village, exp: q.exp, gold: q.gold, compute: q.compute };
          this.say(`${npc.name}：${q.village}附近冒出了 ${q.total} 隻小怪物，可以幫忙清掉嗎？清完回來找我。`, 'npc');
        } else {
          p.carrying = {
            giverId: npc.id,
            targetId: q.targetId,
            targetName: q.targetName,
            targetVillage: q.targetVillage,
            item: q.item,
            steps: q.steps,
            exp: q.exp,
            gold: q.gold,
            compute: q.compute,
          };
          this.say(FE.fill(q.line, { giver: npc.name, target: q.targetName, village: q.targetVillage, item: q.item }), 'npc');
        }
      } else if (o.id === 'decline') {
        this.say(`${npc.name}：好，需要的時候再來找我。`, 'npc');
      }
      if (close) this.talking = null;
      return { close };
    }

    closeTalk() {
      this.talking = null;
    }

    // ---- 回合制戰鬥 ----
    // 攻防判定在 combat.js。方向鍵撞上怪物就是攻擊牠並設成目標；按 1、2 打目前的目標（要貼著）；3 撤退。

    // 從冒險者走得到的地方，找最近一格離那隻怪物超過視野、旁邊也沒有別的怪物的空地
    findRetreat(m) {
      const w = this.world;
      const p = this.player;
      const seen = new Set([p.x + ',' + p.y]);
      const q = [[p.x, p.y]];
      for (let h = 0; h < q.length; h++) {
        const [x, y] = q[h];
        const far = Math.abs(x - m.x) + Math.abs(y - m.y) > C.SIGHT;
        const safe = !this.monsters.some((o) => Math.abs(o.x - x) + Math.abs(o.y - y) <= 1);
        if (far && safe && !w.chestAt(x, y)) return { x, y };
        for (const [dx, dy] of DIRS) {
          const nx = x + dx;
          const ny = y + dy;
          const k = nx + ',' + ny;
          if (seen.has(k) || !w.canStep(x, y, nx, ny) || this.monsterAt(nx, ny) || w.npcAt(nx, ny) || this.soldierAt(nx, ny)) continue;
          seen.add(k);
          q.push([nx, ny]);
        }
      }
      return null;
    }

    // 撤退算一個動作，有 30% 機率失敗；失敗時這一回合照常過（貼著的怪物照樣攻擊）。
    // 成功就直接移到離目標怪物 9 步外、旁邊沒有怪物的最近空地，那隻怪物走回生成點；四周沒有這樣的空地也算失敗
    flee() {
      const m = this.targetMonster();
      if (!m) {
        this.say('旁邊沒有怪物，不需要撤退。', 'sys');
        return;
      }
      this.beginAction();
      const failed = this.rng() < C.FLEE_FAIL;
      const spot = failed ? null : this.findRetreat(m);
      if (!spot) {
        this.say(failed ? '撤退失敗！' : '四周沒有退路，撤退失敗！', 'bad');
        this.endTurn(false);
        return;
      }
      this.player.x = spot.x;
      this.player.y = spot.y;
      this.battle.targetId = null;
      m.chase = 0;
      m.chaseSteps = 0;
      if (m.small) m.returning = true;
      this.say(`你撤退到安全的地方。${m.name}的血量還剩 ${m.hp} / ${m.maxHp}，不會回復。`, 'sys');
      this.endTurn(false);
    }

    // 按鍵 1、2、3：一般攻擊、重擊、撤退，打目前的目標
    act(kind) {
      if (kind === 'flee') {
        this.flee();
        return;
      }
      const m = this.targetMonster();
      if (!m) {
        this.say('旁邊沒有怪物可以打。', 'sys');
        return;
      }
      if (kind === 'deep' && this.battle.cooldown > 0) {
        this.say(`重擊還要 ${this.battle.cooldown} 回合才能再用。`, 'sys');
        return;
      }
      this.strike(kind, m);
    }

    // 倒下後在出生點醒來；世界上有神聖的聚落時，改在離倒下的地方最近的那一座醒來
    die(m) {
      const p = this.player;
      const w = this.world;
      this.fell = true;
      this.battle.targetId = null;
      let at = w.spawn;
      let where = '出生點';
      const holy = w.villages
        .filter((v) => FE.Steading.isHoly(v))
        .sort((a, b) => Math.abs(a.cx - p.x) + Math.abs(a.cy - p.y) - (Math.abs(b.cx - p.x) + Math.abs(b.cy - p.y)))[0];
      if (holy) {
        // 在離聚落中央最近的路上醒來（不在別人家裡）
        let spot = null;
        for (let y = holy.y0; y <= holy.y1; y++) {
          for (let x = holy.x0; x <= holy.x1; x++) {
            if (w.villageAt(x, y) !== holy || w.cell(x, y).t !== '·' || w.npcAt(x, y) || w.chestAt(x, y)) continue;
            const d = Math.abs(x - holy.cx) + Math.abs(y - holy.cy);
            if (!spot || d < spot.d) spot = { x, y, d };
          }
        }
        if (spot) {
          at = spot;
          where = holy.name;
        }
      }
      p.x = at.x;
      p.y = at.y;
      p.hp = p.maxHp;
      this.say(`你倒下了，在${where}重新醒來。${m.name}的血量還剩 ${m.hp} / ${m.maxHp}，不會回復。`, 'bad');
    }

    // 走到地貌旁邊（一格內）第一次看到時，說明那是什麼
    discover() {
      const p = this.player;
      const w = this.world;
      for (const l of w.landmarks) {
        if (l.found || p.x < l.x0 - 1 || p.x > l.x1 + 1 || p.y < l.y0 - 1 || p.y > l.y1 + 1) continue;
        l.found = true;
        const v = w.villageById(l.villageId);
        this.say(`你發現了${v ? v.name + '附近的' : ''}${l.name}。${FE.LANDMARKS[l.kind].desc}`, 'world');
      }
    }

    // by 是士兵時：修好牠負責的錯，冒險者不拿經驗值也不拿算力，也不掉寶箱
    defeat(m, by) {
      this.monsters = this.monsters.filter((o) => o !== m);
      if (this.battle.targetId === m.id) this.battle.targetId = null;
      if (by) {
        const fix = FE.repairBug(this, m, { noExp: true });
        FE.Stability.stat(this).soldierKills++;
        if (Math.abs(m.x - this.player.x) + Math.abs(m.y - this.player.y) <= C.SIGHT * 2) this.say(`士兵打倒了${m.name}。${fix}`, 'world');
        FE.Stability.update(this);
        return;
      }
      const fix = FE.repairBug(this, m);
      // 經驗值與打倒怪物的算力，打倒後一次結算
      this.say(`${m.name}倒下了，經驗值 +${m.exp}。${fix}`, 'good');
      this.dropChest(m);
      this.addExp(m.exp);
      this.earn(m.compute);
      const c = this.player.carrying;
      if (c && c.kind === 'hunt') {
        const ids = [m.id].concat(m.members ? m.members.map((o) => o.id) : []);
        if (ids.some((id) => c.monsterIds.includes(id))) {
          const left = this.huntRemaining(c.monsterIds);
          this.say(left ? `清除委託：還剩 ${left} 隻。` : '清除委託的小怪物都清掉了，回去找委託人。', 'world');
        }
      }
      // 只有大怪物（世界級事件，第 2 階段）寫進歷史紀錄；中型怪物不寫
      if (m.boss) {
        this.history.unshift({
          time: FE.nowTaipei(),
          seed: this.seed,
          player: this.player.name,
          bug: m.name,
          chunk: this.world.chunkNumber(m.x, m.y),
          scope: m.scope,
        });
        FE.store.save('fe.history', this.history.slice(0, 200));
        this.say(`${this.player.name}擊敗${m.name}的事寫進了世界的歷史紀錄。`, 'world');
      }
      FE.Stability.update(this);
    }

    // 掉寶箱：會追人的怪物（m.small）有機率掉、金幣少；其他怪物一定掉，影響範圍越大金幣越多
    dropChest(m) {
      let gold;
      if (m.small) {
        if (this.rng() >= C.DROP_SMALL_CHANCE) return;
        gold = FE.randInt(this.rng, C.DROP_SMALL_GOLD[0], C.DROP_SMALL_GOLD[1]);
      } else {
        gold = C.DROP_GOLD_BASE + m.scope * C.DROP_GOLD_PER_SCOPE + FE.randInt(this.rng, 0, 5);
      }
      const w = this.world;
      let at = { x: m.x, y: m.y };
      if (w.chestAt(at.x, at.y) || w.inVillage(at.x, at.y) || !w.passable(at.x, at.y)) at = this.findFreeNear(m.x, m.y);
      if (!at) return;
      w.chests.push({ id: w.nextId++, x: at.x, y: at.y, gold });
      this.say(`${m.name}掉下了一個寶箱。`, 'good');
    }

    // ---- 執行時錯誤 ----

    // 每個行動都經過這裡。抓到例外，或行動後狀態不合法，就把現場變成崩潰殘響。
    guard(action, fn) {
      try {
        fn();
        this.checkInvariants(action);
      } catch (err) {
        this.battle.targetId = null;
        this.fell = false;
        this.fault(String((err && err.message) || err), String((err && err.stack) || ''), action);
      }
    }

    checkInvariants(action) {
      const p = this.player;
      const problems = [];
      const at = { x: p.x, y: p.y };
      if (!Number.isFinite(p.hp) || p.hp > p.maxHp) {
        problems.push(`冒險者生命值異常（${p.hp}）`);
        p.hp = p.maxHp;
      }
      if (!this.world.passable(p.x, p.y)) {
        problems.push(`冒險者站在不能站的地方（${p.x}, ${p.y}）`);
        p.x = this.lastSafe.x;
        p.y = this.lastSafe.y;
      }
      if (problems.length) this.fault(problems.join('；'), '', action, at);
      else this.lastSafe = { x: p.x, y: p.y };
    }

    fault(message, stack, action, at) {
      const p = this.player;
      const where = at || { x: p.x, y: p.y };
      const report = {
        time: FE.nowTaipei(),
        seed: this.seed,
        turn: this.turn,
        action,
        message,
        stack: stack.split('\n').slice(0, 4).join('\n'),
        x: where.x,
        y: where.y,
      };
      this.reports.unshift(report);
      this.reports = this.reports.slice(0, 30);
      FE.store.save('fe.reports', this.reports);
      const reach = FE.Checker.reachable(this.world);
      const m = this.spawnMonster(
        { type: 'RUNTIME', x: where.x, y: where.y, cells: [[where.x, where.y]], scope: 3, data: { message } },
        (x, y) => reach.has(x + ',' + y)
      );
      if (m) m.exp = C.RUNTIME_EXP;
      // 錯誤的細節只進開發者的錯誤報告，遊戲訊息只寫看得到的現象
      this.say(m ? `空間突然裂開，冒出了一隻${m.name}。` : '空間突然裂開了一下。', 'bug');
    }
  }

  FE.Game = Game;
})();
