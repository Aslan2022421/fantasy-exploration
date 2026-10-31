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
      this.talkPage = 'main'; // 工匠的對話停在哪一層（'main'、'buy'、'buy:weapon'、'repair'⋯⋯），不進存檔
      this.nextGearId = 1;   // 下一件裝備的編號
      this.tickAcc = 0;      // 還沒湊滿 10 刻的零頭（怪物每 10 刻行動一次）
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
        // 裝備欄：主手、副手（盾牌或空著）、身上（防具）。起始是普通長劍、沒有防具（還沒有職業時的暫用值）
        equip: { main: FE.Gear.make('sword', 0, this.nextGearId++), off: null, body: null },
        block: null,         // 目前的格擋值，第一次需要時補成盾牌的格擋值上限（combat.js）
        gold: 0,
        carrying: null,      // 手上的委託（送貨或清除）；送貨的物品放在背包裡
        bag: [],             // 背包：不限格數，同一種東西疊放（{ id, name, n }；送貨的物品是 id 'goods'，另記 giverId）
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
          const free = this.findFreeNear(m.x, m.y, (x, y) => reach.at(x, y));
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
        if (reach.at(x, y) || pending.has(x + ',' + y)) return true;
        return DIRS.some(([dx, dy]) => reach.at(x + dx, y + dy) && this.world.heightOk(x, y, x + dx, y + dy));
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
    // 只有城鎮有，每座城鎮固定 3 位（第二十四版起不看人口）。
    // 數值以同世界等級的小怪物為準，不升級；被打倒就消失，要等世界回到安穩，該城鎮才補回原本的人數。
    soldierQuota() {
      return C.SOLDIER_PER_TOWN;
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

    // ---- 背包 ----
    // 不限格數，同一種東西疊放（藥草、礦石、送貨的物品）。送貨的物品是 id 'goods'，名字照委託，記著是誰託的（giverId），不跟採來的東西疊在一起。
    // 裝備（含礦鎬、鐮刀）每件單獨一格、不疊放：{ id: 'gear', n: 1, gear }，穿上的裝備不在背包裡，在 player.equip

    bagEntry(id, giverId) {
      return this.player.bag.find((e) => e.id === id && (id !== 'goods' || e.giverId === giverId)) || null;
    }

    bagCount(id) {
      const e = this.bagEntry(id);
      return e ? e.n : 0;
    }

    bagAdd(id, n, extra) {
      const e = this.bagEntry(id, extra && extra.giverId);
      if (e) e.n += n;
      else this.player.bag.push(Object.assign({ id, name: FE.BAG_ITEMS[id] ? FE.BAG_ITEMS[id].name : id, n }, extra || {}));
    }

    // 一件裝備放進背包
    bagAddGear(g) {
      this.player.bag.push({ id: 'gear', name: FE.Gear.name(g), n: 1, gear: g });
    }

    // 背包裡有沒有這種工具（礦鎬、鐮刀），有就回傳要用的那一把：工具可以有好幾把，各自有耐久，先用耐久最低的，壞了換下一把
    toolOf(type) {
      let best = null;
      for (const e of this.player.bag) {
        if (e.id === 'gear' && e.gear.type === type && (!best || e.gear.dur < best.dur)) best = e.gear;
      }
      return best;
    }

    // 這件裝備從身上或背包拿掉（壞掉、賣掉時用）
    removeGear(g) {
      const p = this.player;
      for (const slot of ['main', 'off', 'body']) {
        if (p.equip[slot] === g) {
          p.equip[slot] = null;
          if (slot === 'off') p.block = null;
          return;
        }
      }
      p.bag = p.bag.filter((e) => e.gear !== g);
    }

    // 身上穿著的加背包裡的所有裝備（修復、賣裝備、列出要修的東西用）
    allGear() {
      const p = this.player;
      return FE.Gear.equipped(p).concat(p.bag.filter((e) => e.id === 'gear').map((e) => e.gear));
    }

    // 負重（目前重量、上限）與超重的等級（0 沒超重，1 超過 2 以內，2 超過太多）
    weight() {
      return FE.Gear.weightOf(this.player);
    }

    loadTier() {
      return FE.Gear.loadTier(this.player);
    }

    // 主手武器的攻擊力
    playerAtk() {
      return FE.Gear.atkOf(this.player);
    }

    // 拿出 n 個；不夠就不拿，回傳 false
    bagTake(id, n, giverId) {
      const e = this.bagEntry(id, giverId);
      if (!e || e.n < n) return false;
      e.n -= n;
      if (e.n <= 0) this.player.bag = this.player.bag.filter((o) => o !== e);
      return true;
    }

    // 手上這份送貨委託的物品（在背包裡）
    goodsFor(c) {
      return c && c.kind !== 'hunt' ? this.bagEntry('goods', c.giverId) : null;
    }

    // 背包視窗列的東西：{ id, name, n, use, gear, info }，按數字選第幾樣（藥草是吃，裝備是穿上或拿起，工具放著就能用）
    bagList() {
      return this.player.bag.map((e) => {
        if (e.id === 'gear') {
          const g = e.gear;
          const tool = FE.Gear.def(g).cat === 'tool';
          return { id: 'gear', name: FE.Gear.name(g), n: 1, gear: g, use: !tool, info: `${FE.Gear.statText(g)}、${FE.Gear.durText(g)}` };
        }
        return {
          id: e.id,
          giverId: e.giverId,
          name: e.id === 'goods' ? `${e.name}（要送去的東西）` : e.name,
          n: e.n,
          use: !!(FE.BAG_ITEMS[e.id] && FE.BAG_ITEMS[e.id].use),
          info: '',
        };
      });
    }

    // 用背包裡的第 i 樣東西：藥草是吃，裝備是穿上或拿起（算一個動作，換下的放回背包）
    useItem(i) {
      const e = this.bagList()[i];
      if (!e) return;
      if (e.gear) {
        this.equipItem(this.player.bag[i]);
        return;
      }
      if (!e.use) {
        this.say(`${e.name}不能直接用。`, 'sys');
        return;
      }
      if (e.id === 'herb') this.eatHerb();
    }

    // 穿上或拿起背包裡的一件裝備：武器放主手、盾牌放副手、防具穿在身上，換下的放回背包，算一個動作。
    // 弓箭佔兩手：拿弓箭時副手的盾牌放回背包，拿著弓箭時拿不了盾牌
    equipItem(entry) {
      const p = this.player;
      const g = entry.gear;
      const d = FE.Gear.def(g);
      if (d.cat === 'tool') {
        this.say(`${FE.Gear.name(g)}是工具，放在背包裡，撞上${d.name === '礦鎬' ? '礦脈' : '藥草'}就會用。`, 'sys');
        return;
      }
      const slot = d.cat === 'weapon' ? 'main' : d.cat === 'shield' ? 'off' : 'body';
      if (slot === 'off' && p.equip.main && FE.Gear.def(p.equip.main).twoHand) {
        this.say('弓箭要用兩隻手拿，先換下弓箭才拿得了盾牌。', 'sys');
        return;
      }
      this.beginAction();
      const old = p.equip[slot];
      p.bag = p.bag.filter((e) => e !== entry);
      p.equip[slot] = g;
      if (old) this.bagAddGear(old);
      let extra = '';
      if (slot === 'main' && d.twoHand && p.equip.off) {
        this.bagAddGear(p.equip.off);
        extra = `${FE.Gear.name(p.equip.off)}放回背包。`;
        p.equip.off = null;
      }
      if (slot === 'off' || extra) p.block = null; // 盾牌換了，格擋值從滿的開始
      this.say(`你${slot === 'main' ? '拿起' : '穿上'}了${FE.Gear.name(g)}。${old ? `換下的${FE.Gear.name(old)}放回背包。` : ''}${extra}`, 'good');
      this.endTurn(false);
    }

    // 把背包裡的第 i 樣東西丟掉（整疊），直接消失，不算動作。送貨的物品不能丟（委託還在手上）；身上穿著的要先換下
    dropItem(i) {
      const p = this.player;
      const e = p.bag[i];
      if (!e) return;
      if (e.id === 'goods') {
        this.say(`${e.name}是別人託你送的東西，不能丟。`, 'sys');
        return;
      }
      const name = e.id === 'gear' ? FE.Gear.name(e.gear) : `${e.name}${e.n > 1 ? ` ×${e.n}` : ''}`;
      p.bag = p.bag.filter((o) => o !== e);
      this.say(`你把${name}丟掉了（負重 ${this.weight()} / ${C.CARRY_LIMIT}）。`, 'sys');
    }

    // 吃一份藥草：回生命上限的 25%（無條件進位），算一個動作，戰鬥中也能吃
    eatHerb() {
      const p = this.player;
      if (!this.bagCount('herb')) {
        this.say('背包裡沒有藥草。', 'sys');
        return;
      }
      if (p.hp >= p.maxHp) {
        this.say('生命是滿的，不用吃藥草。', 'sys');
        return;
      }
      this.beginAction();
      this.bagTake('herb', 1);
      const got = Math.min(Math.ceil(p.maxHp * C.HERB_HEAL), p.maxHp - p.hp);
      p.hp += got;
      this.say(`你吃了一份藥草，生命回復 ${got}（還剩 ${this.bagCount('herb')} 份）。`, 'good');
      this.endTurn(false);
    }

    // ---- 採集點 ----
    // 礦脈在礦坑的空地上，藥草長在三種森林裡。都可以走過去；拿著對的工具撞上去就採（像撞上村民開對話），
    // 採一次算一個動作，得到 1～2 份，跟移動一樣產生算力；採完那一格變回普通地面，2000 刻後長回來

    // 這一格長著的採集點（採完還沒長回來的不算）
    nodeAt(x, y) {
      const t = this.ticks || 0;
      return this.world.nodes.find((n) => n.x === x && n.y === y && !(n.regrowAt > t) && this.world.passable(x, y)) || null;
    }

    // 採一次磨損工具一次（耐久 50，用完就壞）
    gather(node) {
      const def = FE.NODES[node.kind];
      const item = FE.BAG_ITEMS[def.item];
      const tool = this.toolOf(def.tool);
      this.beginAction();
      const n = FE.randInt(this.rng, C.GATHER_YIELD[0], C.GATHER_YIELD[1]);
      this.bagAdd(def.item, n);
      node.regrowAt = (this.ticks || 0) + C.REGROW_TICKS;
      this.earn(C.COMPUTE_PER_GATHER);
      this.say(`你用${FE.GEAR[def.tool].name}${def.verb}下${item.name} ${n} 份（背包裡共 ${this.bagCount(def.item)} 份）。`, 'good');
      if (tool) FE.Gear.wear(this, tool);
      this.endTurn(false);
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
        // 撞上怪物只把牠設成目前的目標，不出手，也不算動作（不花刻、怪物不動、不產生算力）；要按 1 一般攻擊、2 重擊才出手。
        // 目標會纏上冒險者（見 ai.js 的 worldTurn）。已經有貼著的目標時換目標算一個動作，原本的目標趁隙出手一下（只看閃避）
        if (this.battle.targetId === m.id) return;
        const old = this.monsters.find((o) => o.id === this.battle.targetId);
        if (old && FE.AI.touching(this, old, p)) {
          this.beginAction();
          this.battle.targetId = m.id;
          this.say(`你轉頭盯上了${m.name}（按 1 攻擊、2 重擊、3 撤退）。`, 'sys');
          FE.Combat.resolveAttack(this, old, p, 'attack', { noCounter: true, cling: true, clingWord: '轉向別的怪物' });
          if (this.fell) {
            this.fell = false; // 倒下了，已經回到醒來的地方
            this.turn++;
            return;
          }
          this.endTurn(false);
          return;
        }
        this.battle.targetId = m.id;
        this.say(`你盯上了${m.name}（按 1 攻擊、2 重擊、3 撤退）。`, 'sys');
        return;
      }
      const npc = this.world.npcAt(nx, ny) || this.soldierAt(nx, ny);
      if (npc) {
        // 對話不移動，算一個動作但不算步數；打開對話視窗，選項在視窗裡選（村民、武器匠、士兵都一樣）
        this.openTalk(npc);
        return;
      }
      // 採集點：拿著對的工具撞上去就採，不移動；沒有工具就照常走過去
      const node = this.nodeAt(nx, ny);
      if (node && this.toolOf(FE.NODES[node.kind].tool)) {
        this.gather(node);
        return;
      }
      if (!this.world.passable(nx, ny)) return;
      // 超重太多（超過上限＋2）：不能移動，要先丟掉東西
      if (this.loadTier() >= 2) {
        this.say(`你背得太重了（${this.weight()} / ${C.CARRY_LIMIT}），邁不開腳步。先丟掉一些東西（按 B 打開背包，選「丟掉」）。`, 'sys');
        return;
      }
      this.beginAction();
      const leaving = this.adjacentMonsters();
      p.x = nx;
      p.y = ny;
      this.discover();
      // 從貼著的怪物旁走開：纏著你的目標一定趁這一步出手一下（不擲命中，只看你的閃避，見 combat.js 的 cling），
      // 其他貼著的怪物各有機率白打一下（走判定流程，但這一下不觸發反擊）
      for (const o of leaving) {
        if (!this.monsters.includes(o) || FE.AI.touching(this, o, p)) continue;
        if (o.id === this.battle.targetId) {
          FE.Combat.resolveAttack(this, o, p, 'attack', { noCounter: true, cling: true, clingWord: '後退' });
        } else {
          if (this.rng() >= C.OPPORTUNITY_CHANCE) continue;
          FE.Combat.resolveAttack(this, o, p, 'attack', { noCounter: true, opportunity: true });
        }
        if (this.fell) {
          this.fell = false; // 倒下了，已經回到醒來的地方
          this.turn++;
          return;
        }
      }
      if (node) {
        const def = FE.NODES[node.kind];
        this.say(`這裡有${def.name}，需要${FE.GEAR[def.tool].name}才${def.verb}得下來（鐵匠或武器匠有賣）。`, 'sys');
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
      const p = this.player;
      const chaos = FE.Stability.state(this) === 2 ? C.CHAOS_TIME : 1;
      // 身上防具和超重讓每個動作多花幾刻（見 gear.js 的 extraTicks）
      const t = ((ticks || C.TICKS_MOVE) + FE.Gear.extraTicks(p)) * chaos;
      this.turn++;
      this.ticks = (this.ticks || 0) + t;
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
      // 怪物每 10 刻行動一次：刻數累積起來，湊滿 10 刻就多動一次（防具多花的刻真的讓怪物多動，不被四捨五入吃掉）
      this.tickAcc = (this.tickAcc || 0) + t;
      const turns = Math.floor(this.tickAcc / C.TICKS_MOVE);
      this.tickAcc -= turns * C.TICKS_MOVE;
      this.worldClock += turns / this.worldEvery;
      while (this.worldClock >= 1 && !this.fell) {
        this.worldClock -= 1;
        FE.AI.worldTurn(this);
      }
      if (this.fell) this.worldClock -= Math.floor(this.worldClock); // 冒險者倒下了，沒走完的回合不補
      this.fell = false;
      FE.Stability.update(this);
    }

    // 攻擊目前的目標（按 1、2；撞上怪物只設目標，不出手）：一個動作，打完所有怪物各做一件事
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
      // 25% 機率多開出一件裝備（品質普通～傑作，每高一級機率減半），放進背包
      if (this.rng() < C.CHEST_GEAR) {
        const g = FE.Gear.randomDrop(this, 0, 5);
        this.bagAddGear(g);
        this.say(`寶箱裡還有一件${FE.Gear.name(g)}，你收進了背包。`, 'good');
      }
    }

    // 清除委託指定的小怪物還剩幾隻；合體了的話，合體怪物還在就算還在
    huntRemaining(ids) {
      return ids.filter((id) => this.monsters.some((m) => m.id === id || (m.members && m.members.some((o) => o.id === id)))).length;
    }

    // ---- 對話 ----
    // 撞上村民、鐵匠、武器匠、盔甲匠或士兵就打開對話視窗（畫面在 render.js，按鍵在 main.js）：打開算一個動作，不算步數，
    // 怪物各做一件事；在對話裡選選項不再花動作（買賣、修復、打造也一樣）。
    // 工匠的選項分層（買、修、打造、賣礦石、賣裝備）：game.talkPage 記著停在哪一層，Esc 或「返回」回上一層，最上層再按就關掉。
    // 對話開著時 game.talking 記著對方的 id（不進存檔）

    openTalk(npc) {
      this.beginAction();
      this.talking = npc.id;
      this.talkPage = 'main';
      this.endTurn(false);
    }

    // 對話的內容：{ name, role, village, text, options: [{ id, label, note, disabled }] }
    talkOptions(npc) {
      const p = this.player;
      const q = npc.quest;
      const c = p.carrying;
      const v = this.world.villageById(npc.villageId);
      const leave = { id: 'leave', label: '離開' };
      const goods = this.goodsFor(c);
      const shop = FE.Gear.shopOf(npc, v);
      const out = (text, options) => ({
        name: npc.name,
        role: shop ? FE.Gear.SHOPS[shop].title : npc.role === 'soldier' ? '士兵' : '村民',
        village: v ? v.name : '',
        text,
        options,
      });
      // 士兵只有一句閒話
      if (npc.role === 'soldier') return out(FE.SOLDIER_LINES[(npc.id + this.turn) % FE.SOLDIER_LINES.length], [leave]);
      // 工匠：買、修、打造、賣礦石、賣裝備（分層，見 shopTalk）
      if (shop) return out(...this.shopTalk(npc, v, shop));
      if (c && c.kind === 'hunt' && c.giverId === npc.id) {
        const left = this.huntRemaining(c.monsterIds);
        if (left > 0) return out(`附近還有 ${left} 隻小怪物，拜託了。`, [leave]);
        return out('村子外面安靜多了，謝謝你。', [{ id: 'report', label: '回報，領取獎勵', note: `經驗值 +${c.exp}、金幣 +${c.gold}` }, leave]);
      }
      // 先處理交件，再處理接委託：收貨人身上自己也有委託時，貨照樣交得出去
      if (c && c.kind !== 'hunt' && c.targetId === npc.id && goods) {
        return out(`你是把${goods.name}送來的人吧？`, [{ id: 'deliver', label: '交給他', note: `經驗值 +${c.exp}、金幣 +${c.gold}` }, leave]);
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
      if (FE.Gear.shopOf(npc, this.world.villageById(npc.villageId))) {
        const r = this.shopChoose(npc, o);
        if (r.close) this.talking = null;
        return r;
      }
      if (o.id === 'report') {
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
        const { exp, gold, compute } = c;
        const item = this.goodsFor(c).name;
        this.bagTake('goods', 1, c.giverId); // 從背包拿出來交給他
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
          // 委託資料照舊記在手上，要送的東西放進背包
          p.carrying = {
            giverId: npc.id,
            targetId: q.targetId,
            targetName: q.targetName,
            targetVillage: q.targetVillage,
            steps: q.steps,
            exp: q.exp,
            gold: q.gold,
            compute: q.compute,
          };
          this.bagAdd('goods', 1, { name: q.item, giverId: npc.id });
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
      this.talkPage = 'main';
    }

    // Esc：工匠的對話在第二層以下就回上一層（回傳 false，對話還開著），在最上層或不是工匠就關掉（回傳 true）
    talkBack() {
      const npc = this.talking != null ? this.talkTarget(this.talking) : null;
      const v = npc ? this.world.villageById(npc.villageId) : null;
      const shop = npc ? FE.Gear.shopOf(npc, v) : null;
      if (shop && this.talkPage && this.talkPage !== 'main') {
        this.talkPage = this.parentPage(FE.Gear.SHOPS[shop], this.talkPage);
        return false;
      }
      this.closeTalk();
      return true;
    }

    // ---- 工匠的對話 ----
    // 鐵匠（村莊）什麼都賣、修、打造；城鎮分成武器匠（武器、礦鎬、鐮刀）和盔甲匠（防具與盾牌），各修自己那一類。
    // 價錢：販售價＝原價×品質價值倍率×聚落經濟倍率；修復費＝修回的比例×原價×0.5×經濟倍率（至少 1）；
    // 賣回＝半價×剩餘耐久比例；礦石一顆 5 金幣；打造要礦石加原價一半的工錢，品質在聚落的範圍內隨機（每高一級機率減半）

    // 上一層：「買」只有一類東西時，那一類就是第一層，返回直接回最上層
    parentPage(S, page) {
      const parts = page.split(':');
      if (parts.length >= 3) return `buy:${parts[1]}`;
      if (parts[0] === 'buy' && parts.length === 2) return Object.keys(S.buy).length === 1 ? 'main' : 'buy';
      return 'main';
    }

    // 這家店「買」的某一類東西：[{ type, q }]；工具只有普通品質，其他類每種品質各一筆
    buyEntries(S, cat, q) {
      const out = [];
      for (const type of S.buy[cat]) {
        const quals = FE.GEAR[type].cat === 'tool' ? [0] : S.quals;
        for (const qq of quals) if (q === undefined || q === qq) out.push({ type, q: qq });
      }
      return out;
    }

    // 錢或礦石不夠時，選項的說明寫還差多少
    shortText(gold, ore) {
      const s = [gold > 0 ? `${gold} 金幣` : '', ore > 0 ? `${ore} 顆礦石` : ''].filter(Boolean).join('、');
      return s ? `還差 ${s}` : '';
    }

    // 工匠對話目前這一層的內容：回傳 [text, options]
    shopTalk(npc, v, shopKey) {
      const p = this.player;
      const S = FE.Gear.SHOPS[shopKey];
      const back = { id: 'back', label: '返回' };
      const have = `你身上有 ${p.gold} 金幣、${this.bagCount('ore')} 顆礦石。`;
      const MAX = 8; // 一層最多列幾項（加上「返回」不超過 9，才按得到）
      let page = this.talkPage || 'main';
      if (page === 'buy' && Object.keys(S.buy).length === 1) page = 'buy:' + Object.keys(S.buy)[0];
      const price = (e) => FE.Gear.shopPrice(e.type, e.q, v);
      const gname = (e) => FE.Gear.name({ type: e.type, q: e.q });
      const lines = {
        blacksmith: '武器、盔甲、盾牌我都能賣、能修、能打。礦鎬和鐮刀也有。',
        weaponsmith: '武器、礦鎬、鐮刀歸我管；盾牌和盔甲去找盔甲匠。',
        armorer: '盔甲和盾牌歸我管；武器和工具去找武器匠。',
      };

      if (page === 'main') {
        const repairs = this.allGear().filter((g) => S.repair.includes(FE.GEAR[g.type].cat) && g.dur < g.max).length;
        const sellable = p.bag.filter((e) => e.id === 'gear' && S.sell.includes(FE.GEAR[e.gear.type].cat)).length;
        const ore = this.bagCount('ore');
        return [
          `${lines[shopKey]}${have}`,
          [
            { id: 'buy', label: '買' },
            { id: 'repair', label: '修', note: repairs ? `${repairs} 件要修` : '沒有要修的' },
            { id: 'craft', label: '打造', note: '用礦石' },
            { id: 'sellOre', label: '賣礦石', note: ore ? `${ore} 顆，+${ore * C.ORE_PRICE} 金幣` : '沒有礦石', disabled: !ore },
            { id: 'sell', label: '賣裝備', note: sellable ? `${sellable} 件` : '沒有可賣的', disabled: !sellable },
            { id: 'leave', label: '離開' },
          ],
        ];
      }

      if (page === 'buy') {
        return [
          `要買哪一類？${have}`,
          Object.keys(S.buy).map((cat) => ({ id: `cat:${cat}`, label: FE.Gear.CAT_NAMES[cat] })).concat([back]),
        ];
      }

      const m = /^buy:(\w+)(?::(\d+))?$/.exec(page);
      if (m) {
        const cat = m[1];
        const q = m[2] === undefined ? undefined : Number(m[2]);
        const all = this.buyEntries(S, cat, q);
        // 這一類的東西太多就先選品質
        if (q === undefined && all.length > MAX) {
          return [`要哪種做工的？${have}`, S.quals.map((qq) => ({ id: `qual:${cat}:${qq}`, label: FE.QUALITIES[qq].name })).concat([back])];
        }
        const opts = [];
        for (const e of all) {
          const pr = price(e); // 工具可以重複買，各自有耐久
          const short = pr - p.gold;
          opts.push({
            id: `buyItem:${e.type}:${e.q}`,
            label: `${gname(e)}（${FE.Gear.statText(e)}）`,
            note: short > 0 ? this.shortText(short, 0) : `${pr} 金幣`,
            disabled: short > 0,
          });
        }
        opts.push(back);
        return [`${FE.Gear.CAT_NAMES[cat]}。${have}`, opts];
      }

      if (page === 'repair') {
        const list = this.allGear().filter((g) => S.repair.includes(FE.GEAR[g.type].cat) && g.dur < g.max).slice(0, MAX);
        const opts = list.map((g) => {
          const qt = FE.Gear.repairQuote(g, v);
          const short = qt.cost - p.gold;
          const worn = p.equip.main === g || p.equip.off === g || p.equip.body === g ? '（穿著）' : '';
          return {
            id: `repairItem:${g.id}`,
            label: `修${FE.Gear.name(g)}${worn}`,
            note: short > 0 ? `${FE.Gear.durText(g)}，${this.shortText(short, 0)}` : `${FE.Gear.durText(g)}，修回 ${qt.restore} 點，${qt.cost} 金幣`,
            disabled: short > 0,
          };
        });
        opts.push(back);
        const how = '我能修到完整。';
        return [list.length ? `${how}${have}` : '沒有要修的東西。', opts];
      }

      if (page === 'craft') {
        const opts = S.craft.map((type) => {
          const qt = FE.Gear.craftQuote(type, v);
          const lackOre = qt.ore - this.bagCount('ore');
          const lackGold = qt.fee - p.gold;
          const lack = this.shortText(lackGold, lackOre);
          const lo = FE.QUALITIES[qt.range[0]];
          const hi = FE.QUALITIES[qt.range[1]];
          const ql = (qq) => `${qq.sym}${qq.name}${qq.sym}`;
          return {
            id: `craftItem:${type}`,
            label: `打造${FE.GEAR[type].name}（${FE.Gear.statText({ type, q: 0 })}）`,
            note: lack || `${qt.ore} 顆礦石、${qt.fee} 金幣，品質${ql(lo)}～${ql(hi)}`,
            disabled: !!lack,
          };
        });
        opts.push(back);
        return [`用礦石打造新的，要礦石加一半原價的工錢，做出來的品質不一定。${have}`, opts];
      }

      if (page === 'sell') {
        const list = p.bag.filter((e) => e.id === 'gear' && S.sell.includes(FE.GEAR[e.gear.type].cat)).slice(0, MAX);
        const opts = list.map((e) => ({
          id: `sellItem:${e.gear.id}`,
          label: `賣${FE.Gear.name(e.gear)}`,
          note: `${FE.Gear.durText(e.gear)}，+${FE.Gear.sellPrice(e.gear)} 金幣`,
        }));
        opts.push(back);
        return [`背包裡的東西我照原價的一半、再看磨損收。穿在身上的要先換下來。${have}`, opts];
      }
      return ['……', [back]];
    }

    // 工匠對話選第 o 個選項：換層、買、修、打造、賣；錢或礦石不夠的選項（disabled）只說還差多少。回傳 { close }
    shopChoose(npc, o) {
      const p = this.player;
      const v = this.world.villageById(npc.villageId);
      const S = FE.Gear.SHOPS[FE.Gear.shopOf(npc, v)];
      const stay = { close: false };
      if (o.id === 'leave') {
        this.talkPage = 'main';
        return { close: true };
      }
      if (o.id === 'back') {
        this.talkPage = this.parentPage(S, this.talkPage === 'buy' && Object.keys(S.buy).length === 1 ? 'buy:' + Object.keys(S.buy)[0] : this.talkPage);
        return stay;
      }
      if (o.disabled) {
        this.say(`${npc.name}：${o.label.replace(/（.*$/, '')}，${o.note}。`, 'npc');
        return stay;
      }
      if (['buy', 'repair', 'craft', 'sell'].includes(o.id)) {
        this.talkPage = o.id;
        return stay;
      }
      if (o.id.startsWith('cat:')) {
        this.talkPage = 'buy:' + o.id.slice(4);
        return stay;
      }
      if (o.id.startsWith('qual:')) {
        const [, cat, q] = o.id.split(':');
        this.talkPage = `buy:${cat}:${q}`;
        return stay;
      }
      const [kind, a, b] = o.id.split(':');
      if (kind === 'sellOre') {
        const n = this.bagCount('ore');
        this.bagTake('ore', n);
        p.gold += n * C.ORE_PRICE;
        this.say(`${npc.name}收下 ${n} 顆礦石，給了你 ${n * C.ORE_PRICE} 金幣。`, 'good');
      } else if (kind === 'buyItem') {
        const type = a;
        const q = Number(b);
        const pr = FE.Gear.shopPrice(type, q, v);
        if (p.gold < pr) return stay;
        p.gold -= pr;
        const g = FE.Gear.make(type, q, this.nextGearId++);
        this.bagAddGear(g);
        this.say(`${npc.name}賣給你${FE.Gear.name(g)}，花了 ${pr} 金幣。${type === 'pick' ? '礦坑裡的礦脈挖得動了。' : type === 'sickle' ? '森林裡的藥草割得下來了。' : ''}`, 'good');
      } else if (kind === 'repairItem') {
        const g = this.allGear().find((x) => x.id === Number(a));
        if (!g || !S.repair.includes(FE.GEAR[g.type].cat) || g.dur >= g.max) return stay;
        const qt = FE.Gear.repairQuote(g, v);
        if (p.gold < qt.cost) return stay;
        p.gold -= qt.cost;
        g.dur += qt.restore;
        FE.Gear.repaired(g);
        this.say(`${npc.name}修好了你的${FE.Gear.name(g)}（${FE.Gear.durText(g)}），花了 ${qt.cost} 金幣。`, 'good');
      } else if (kind === 'craftItem') {
        const qt = FE.Gear.craftQuote(a, v);
        if (!S.craft.includes(a) || p.gold < qt.fee || this.bagCount('ore') < qt.ore) return stay;
        this.bagTake('ore', qt.ore);
        p.gold -= qt.fee;
        const g = FE.Gear.make(a, FE.Gear.rollQuality(this.rng, qt.range[0], qt.range[1]), this.nextGearId++);
        this.bagAddGear(g);
        this.say(`${npc.name}用 ${qt.ore} 顆礦石打造了${FE.Gear.name(g)}，工錢 ${qt.fee} 金幣，放進了你的背包。`, 'good');
      } else if (kind === 'sellItem') {
        const e = p.bag.find((x) => x.id === 'gear' && x.gear.id === Number(a));
        if (!e || !S.sell.includes(FE.GEAR[e.gear.type].cat)) return stay;
        const gain = FE.Gear.sellPrice(e.gear);
        p.bag = p.bag.filter((x) => x !== e);
        p.gold += gain;
        this.say(`${npc.name}收下了你的${FE.Gear.name(e.gear)}，給了你 ${gain} 金幣。`, 'good');
      }
      return stay;
    }

    // ---- 回合制戰鬥 ----
    // 攻防判定在 combat.js。方向鍵撞上怪物只設成目標（不出手、不算動作）；按 1、2 打目前的目標（要貼著）；3 撤退。

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
      // 超重太多（超過上限＋2）：不能撤退
      if (this.loadTier() >= 2) {
        this.say(`你背得太重了（${this.weight()} / ${C.CARRY_LIMIT}），跑不動。先丟掉一些東西（按 B 打開背包，選「丟掉」）。`, 'sys');
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

    // 倒下後在離倒下的地方最近的聚落（村莊或城鎮，不看神聖與否）醒來，沒有聚落才回出生點
    die(m) {
      const p = this.player;
      const w = this.world;
      this.fell = true;
      this.battle.targetId = null;
      let at = w.spawn;
      let where = '出生點';
      const holy = w.villages
        .slice()
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
      this.dropGear(m);
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

    // 創世時的中型怪物與合體生出的中型怪物（不是事件與侵蝕生的 m.small），打倒時 30% 機率多掉一件裝備，
    // 品質做工好～優秀（每高一級機率減半），直接放進背包
    dropGear(m) {
      if (m.tier !== 'mid' || m.small || this.rng() >= C.DROP_MID_GEAR) return;
      const g = FE.Gear.randomDrop(this, 1, 3);
      this.bagAddGear(g);
      this.say(`${m.name}身上掉出一件${FE.Gear.name(g)}，你收進了背包。`, 'good');
    }

    // 掉寶箱：會追人的怪物（m.small）20% 機率掉、金幣少；其他怪物 50% 機率掉，影響範圍越大金幣越多。
    // 多掉一件裝備（dropGear）是另外獨立判定的，不跟寶箱綁在一起
    dropChest(m) {
      let gold;
      if (m.small) {
        if (this.rng() >= C.DROP_SMALL_CHANCE) return;
        gold = FE.randInt(this.rng, C.DROP_SMALL_GOLD[0], C.DROP_SMALL_GOLD[1]);
      } else {
        if (this.rng() >= C.DROP_BIG_CHANCE) return; // 中型以上怪物 50% 機率掉寶箱（原本必掉）
        gold = C.DROP_GOLD_BASE + m.scope * C.DROP_GOLD_PER_SCOPE + FE.randInt(this.rng, 0, 5);
      }
      gold = Math.round(gold * C.CHEST_GOLD_MUL); // 所有寶箱的金幣減半
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
        (x, y) => reach.at(x, y)
      );
      if (m) m.exp = C.RUNTIME_EXP;
      // 錯誤的細節只進開發者的錯誤報告，遊戲訊息只寫看得到的現象
      this.say(m ? `空間突然裂開，冒出了一隻${m.name}。` : '空間突然裂開了一下。', 'bug');
    }
  }

  FE.Game = Game;
})();
