// 遊戲狀態與規則：移動、對話、回合制戰鬥、等級與創世、村莊、執行時錯誤的處理。
// 遊戲內的文字一律叫「怪物」，不出現 BUG。
(function () {
  const C = FE.CONFIG;
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  // 升到第 level 級要的累計經驗值（第二十九版：《D&D》第五版經驗表 ÷10，最高 LEVEL_MAX 級；超過最高級的等級要的經驗值同最高級）
  FE.levelExp = (level) => C.LEVEL_EXP[Math.max(1, Math.min(level, C.LEVEL_MAX))];

  class Game {
    constructor(seed) {
      this.seed = seed;
      this.rng = FE.makeRng((seed ^ 0x9e3779b9) >>> 0);
      this.world = new FE.World(seed);
      this.monsters = [];
      this.nextMonsterId = 1;
      this.log = [];
      this.turn = 0;
      this.ticks = 0;        // 經過的時間（刻）；一刻 36 秒、一小時 100 刻、一天 2,400 刻（第三十版），怪物、士兵、事件都照這個時鐘
      this.sleeping = false; // 長休中（世界照跑，但不累積力竭；不進存檔）
      this.exp = 0;          // 累計經驗值，只增不減；只管冒險者的等級
      this.level = 1;
      this.creation = 0;     // 創世力（不顯示）：累計的算力裡進創世的那一份
      this.nextChunkAt = 0;  // 創世力累計到這裡，創世神解出下一塊（不顯示）
      this.compute = 0;      // 修補力（不顯示）：算力裡進修補的那一份，用來演算事件、維持穩定
      this.battle = { targetId: null, cooldown: 0, healCd: 0 }; // 目前的目標、重擊冷卻、治療冷卻（牧師）
      this.aim = null;       // 按 F 瞄準時：{ mode, ids 看得到的怪物（近的在前）, i 目前選的 }（不進存檔）
      this.worldState = 0;   // 世界狀態：0 安穩、1 動盪、2 失序（stability.js）；世界等級另外算，見 FE.Stability.worldLevel
      this.soldiers = [];    // 城鎮的士兵（role 'soldier'），不在 world.npcs 裡
      this.worldEvery = 1;   // 世界（怪物、士兵）每 10 刻走一回合，這個數字讓它再慢幾倍；平常是 1，測試的「四人等效」模擬用 4（不進存檔）
      this.worldClock = 0;
      this.fell = false;     // 這一個動作裡冒險者倒下了
      this.talking = null;   // 對話視窗開著時，對方的 id（不進存檔）
      this.talkPage = 'main'; // 工匠的對話停在哪一層（'main'、'buy'、'buy:weapon'、'repair'⋯⋯），不進存檔
      this.nextGearId = 1;   // 下一件裝備的編號
      this.tickAcc = 0;      // 還沒湊滿 10 刻的零頭（怪物每 10 刻行動一次）
      this.player = null;
      this.history = FE.store.load('fe.history', []);
      this.reports = FE.store.load('fe.reports', []);
    }

    // 開新世界。opts.cls 是職業（warrior、ranger、mage、priest），opts.picks 是自己挑的起始裝備（選項 id 的清單，見 FE.CLASSES），
    // opts.body 是種族與體型（{ race, bonus 人類自己加的兩點, height, build }，見 FE.Char.bodyOf）；
    // 沒給就用戰士、預設的挑法和普通體型的人類（測試用，遊戲裡一定由建角的視窗給）
    start(opts) {
      opts = opts || {};
      const clsKey = opts.cls || 'warrior';
      const b = FE.Char.bodyOf(opts.body);
      const picks = opts.picks || FE.Char.defaultPicks(clsKey, FE.bodySize(b.race, b.height, b.build));
      if (!FE.Char.validPicks(clsKey, picks)) throw new Error('起始裝備的挑法不對');
      this.say('創世神正在創世。你是冒險者：走遍世界、打倒怪物、完成任務，世界會跟著長下去。', 'sys');
      this.createChunk(true);
      const s = this.world.spawn;
      // 職業、六項屬性、起始裝備（裝備欄：主手、副手（盾牌或空著）、身上（防具））、生命都在 FE.Char.create 裡配好
      this.player = FE.Char.create(this, clsKey, picks, FE.store.load('fe.name', '冒險者'), b, opts.skills);
      this.player.x = s.x;
      this.player.y = s.y;
      this.lastSafe = { x: s.x, y: s.y };
    }

    say(text, kind) {
      this.log.unshift({ text, kind: kind || 'sys' });
      if (this.log.length > 40) this.log.length = 40;
    }

    // ---- 世界與怪物 ----

    // 創世時替這塊世界的每隻怪物配好「打倒時給的算力」、每個任務配好「完成時給的算力」，
    // 加總後乘 PLAYER_COMPUTE_SCALE 與 CREATION_SHARE，就是到下一塊要累積的創世力。
    // 清光這塊世界，一定解得出下一塊；途中的移動、出手、清掉衰敗生的怪物，都會讓它更快。
    // 新的一塊長在離冒險者最近的邊界上（第一塊在原點）
    // 第三十二版：開局是 96×96 一大塊，之後每次長一段（一圈的上下左右其中一邊，離冒險者最近的先長）；長滿了回傳 false
    createChunk(first) {
      let seg = null;
      if (!first) {
        const at = this.player || this.world.spawn;
        seg = this.world.nextSegment(at.x, at.y);
        if (!seg) return false;
      }
      const { index, rect, village, landmarks } = this.world.addRegion(seg);
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
      if (village) this.moveBufferDebt(village);
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
      // 沒挑上的地形錯位與斷崖（rest）不處理：第三十三版之三起錯的種類不決定怪物，只有挑上的地點才欠 BUG 值
      const { sites } = this.pickSites(found, rect, first, landmarks || []);
      this.curCampaign = index; // 這一段生的怪物都記上是第幾段戰役（spawnGroup）
      for (const site of sites) {
        // 開局最多 24 隻：名額用完了，選到的地方（一定要生的那幾種至少生帶頭的 1 隻）欠的量全部留在格子裡
        const room = first ? C.START_MONSTER_MAX - spawned.length : Infinity;
        const cap = room > 0 || site.must ? Math.max(1, first ? Math.min(room, C.START_SITE_MAX) : room) : 0;
        const group = this.spawnGroup(site, canReach, first, cap);
        if (!group.length) continue;
        spawned.push(...group);
        if (group[0].type === 'UNREACHABLE') for (const [x, y] of group[0].cells) pending.add(x + ',' + y);
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
      // 這一段戰役記下來，清光時寫進歷史紀錄：哪一段、在哪裡（這一段的聚落，沒有就寫最近的聚落）、第幾天、有哪些危害
      if (spawned.length) {
        const cx = Math.floor((rect.x0 + rect.x1) / 2);
        const cy = Math.floor((rect.y0 + rect.y1) / 2);
        const near = village || this.world.villages.slice().sort((a, b) => Math.abs(a.cx - cx) + Math.abs(a.cy - cy) - (Math.abs(b.cx - cx) + Math.abs(b.cy - cy)))[0];
        const heads = spawned.filter((m) => m.id === m.group);
        const content = heads.map((h) => (h.camp ? FE.CAMPS[h.camp].name : `${h.name}${spawned.filter((o) => o.group === h.group).length > 1 ? `等 ${spawned.filter((o) => o.group === h.group).length} 隻` : ''}`)).join('、');
        this.world.campaigns = this.world.campaigns || {};
        this.world.campaigns[index] = { seg: index + 1, place: near ? `${near.name}${village ? '' : '附近'}` : '荒野', day: this.day(), content };
      }
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
      this.lastRegion = rect; // 這一段的範圍（測試算門檻用）
      return true;
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
      FE.npcRace(w, s); // 士兵也擲種族（人類 70%、矮人 15%、精靈 15%）
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

    // 箭矢、弩矢分品質，同品質的疊在一起（key 是品質 q）；送貨的物品照託付的人分開（key 是 giverId）
    isAmmo(id) {
      return !!(FE.BAG_ITEMS[id] && FE.BAG_ITEMS[id].bundle);
    }

    bagEntry(id, key) {
      return this.player.bag.find((e) => e.id === id && (id === 'goods' ? e.giverId === key : this.isAmmo(id) && key !== undefined ? e.q === key : true)) || null;
    }

    // 有幾份；箭矢是各品質加起來的支數
    bagCount(id) {
      return this.player.bag.filter((e) => e.id === id).reduce((s, e) => s + e.n, 0);
    }

    bagAdd(id, n, extra) {
      const e = this.bagEntry(id, id === 'goods' ? extra && extra.giverId : this.isAmmo(id) ? (extra && extra.q) || 0 : undefined);
      if (e) e.n += n;
      else {
        const name = this.isAmmo(id) ? FE.Gear.name({ type: id, q: (extra && extra.q) || 0 }) : FE.BAG_ITEMS[id] ? FE.BAG_ITEMS[id].name : id;
        this.player.bag.push(Object.assign({ id, name, n }, this.isAmmo(id) ? { q: 0 } : {}, extra || {}));
      }
    }

    // 一件裝備放進背包；箭矢、弩矢（買來的、掉的）是一捆，疊進同品質的裡面
    bagAddGear(g) {
      const d = FE.Gear.def(g);
      if (d.cat === 'ammo') {
        this.bagAdd(g.type, d.bundle, { q: g.q || 0 });
        return;
      }
      this.player.bag.push({ id: 'gear', name: FE.Gear.name(g), n: 1, gear: g });
    }

    // 射一支箭（或弩矢）：先用品質最高的，回傳那一支的品質；沒有回傳 null。type 是 'arrow' 或 'bolt'
    takeArrow(type) {
      const id = type || 'arrow';
      const e = this.player.bag.filter((x) => x.id === id && x.n > 0).sort((a, b) => b.q - a.q)[0];
      if (!e) return null;
      this.bagTake(id, 1, e.q);
      return e.q;
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

    // 能背的重量（磅）＝力量值×15
    carryLimit() {
      return FE.Char.carryLimit(this.player);
    }

    // 推拖上限（磅）＝力量值×30
    pushLimit() {
      return FE.Char.pushLimit(this.player);
    }

    // 魅力修正值（價錢、委託金錢獎勵用）
    chaMod() {
      return FE.Char.attrMod(this.player, 'cha');
    }

    // 委託與任務的金錢獎勵（銅）：基本數字×委託人聚落的經濟標籤倍率（荒蕪 ×0.8、貧窮 ×0.9、普通 ×1、繁盛與富裕 ×1.2）
    // ×魅力（每點修正值 +5%）×生活水準的加成（上一次在這個聚落長休，普通 +5%、繁盛 +10%），最後才四捨五入。
    // q 是委託（npc.quest 或手上的 jobs），villageId 是委託人的聚落
    questPay(q, villageId) {
      const p = this.player;
      const v = this.world.villageById(villageId);
      const lodge = p.lodging && p.lodging.villageId === villageId ? p.lodging.bonus : 0;
      return Math.max(0, Math.round((q.copper || 0) * FE.Steading.questEcon(v) * (1 + C.CHA_PRICE * this.chaMod()) * (1 + lodge)));
    }

    // ---- 錢與聚落經濟（第三十版）----
    // 在聚落花錢（買、修、打造、長休）：經濟值每 10 銀 +1，花掉的錢每 20 銀換 1 點修補力（單人份量，只進修補力、不進創世力）
    spend(v, copper) {
      if (!(copper > 0)) return;
      this.econ(v, copper / (C.ECON_PER_SPEND * C.SILVER));
      this.earn(copper / (C.SPEND_REPAIR * C.SILVER), { repairOnly: true });
    }

    // 聚落的經濟值加減；經濟標籤變了出一行訊息
    econ(v, d) {
      const ch = FE.Steading.addEcon(v, d);
      if (!ch) return;
      const up = ch.to > ch.from;
      FE.Stability.stat(this)[up ? 'econUp' : 'econDown']++;
      this.say(`${v.name}的日子${up ? '好過了些' : '難過了起來'}（經濟：${FE.PROSPERITY[ch.from]} → ${FE.PROSPERITY[ch.to]}）。`, 'world');
    }

    // 每過一天：聚落 24 步內每有 1 隻怪物，經濟值 −1
    econDay() {
      for (const v of this.world.villages) {
        const box = (m) => Math.max(v.x0 - m.x, 0, m.x - v.x1) + Math.max(v.y0 - m.y, 0, m.y - v.y1);
        const n = this.monsters.filter((m) => box(m) <= C.HUNT_RADIUS).length;
        FE.Steading.econ(v);
        if (n) this.econ(v, -n * C.ECON_MONSTER);
      }
    }

    // 主手武器現在的傷害寫法（狀態列用），例如「1d8+3 揮砍」
    attackText() {
      return FE.Gear.dmgText(this.player);
    }

    // 拿出 n 個；不夠就不拿，回傳 false（key：送貨的物品是託付的人，箭矢是品質）
    bagTake(id, n, giverId) {
      const e = this.bagEntry(id, giverId);
      if (!e || e.n < n) return false;
      e.n -= n;
      if (e.n <= 0) this.player.bag = this.player.bag.filter((o) => o !== e);
      return true;
    }

    // 手上這份送貨委託（jobs.deliver）的物品（在背包裡）
    goodsFor(c) {
      return c && c.kind === 'deliver' ? this.bagEntry('goods', c.giverId) : null;
    }

    // 手上的委託（第三十版：清除、送貨、採藥、採礦每種最多一個）：照右側欄的順序列出來
    jobList() {
      const j = this.player.jobs || {};
      return FE.JOB_KINDS.map((k) => j[k]).filter(Boolean);
    }

    // 背包視窗列的東西：{ id, name, n, use, gear, info }，按數字選第幾樣（藥草是吃，裝備是穿上或拿起，工具放著就能用）
    bagList() {
      return this.player.bag.map((e) => {
        if (e.id === 'gear') {
          const g = e.gear;
          const tool = FE.Gear.def(g).cat === 'tool';
          // 武器標出你拿起來是單手、雙手還是拿不動（看體型）
          const grip = FE.Gear.def(g).cat === 'weapon' ? `${FE.Gear.gripText(this.player, g)}、` : '';
          return { id: 'gear', name: FE.Gear.name(g), n: 1, gear: g, use: !tool, grip: grip.replace('、', ''), info: `${grip}${FE.Gear.statText(g)}、${FE.Gear.durText(g)}` };
        }
        return {
          id: e.id,
          giverId: e.giverId,
          name: e.id === 'goods' ? `${e.name}（要送去的東西）` : e.name,
          n: e.n,
          use: !!(FE.BAG_ITEMS[e.id] && FE.BAG_ITEMS[e.id].use),
          info: e.id === 'arrow' ? '拿著弓箭按 F 射擊，一次用一支' : e.id === 'bolt' ? '拿著輕弩按 F 射擊，一次用一支' : '',
        };
      });
    }

    // 用背包裡的第 i 樣東西：藥草是吃，裝備是穿上或拿起（算一個動作，換下的放回背包）
    // toOff：武器放副手（雙持；暫時弓箭以外的武器都可以）；弓箭照平常放主手
    useItem(i, toOff) {
      const e = this.bagList()[i];
      if (!e) return;
      if (e.gear) {
        this.equipItem(this.player.bag[i], toOff);
        return;
      }
      if (!e.use) {
        this.say(`${e.name}不能直接用。`, 'sys');
        return;
      }
      if (e.id === 'herb') this.eatHerb();
    }

    // 穿上或拿起背包裡的一件裝備：武器放主手、盾牌放副手、防具穿在身上，換下的放回背包，算一個動作。
    // 體型不夠拿的武器拿不起來（出訊息，不算動作）；只能雙手拿的武器（弓箭、輕弩，或體型不夠單手）佔兩手：拿起來時副手的東西放回背包，拿著時副手拿不了東西。
    // 雙持：副手只能放自己體型能單手拿的武器，副手放了武器就不能拿盾牌，
    // 反之亦然（副手只有一格，放進去就把原本的換下來）
    equipItem(entry, toOff) {
      const p = this.player;
      const g = entry.gear;
      const d = FE.Gear.def(g);
      if (d.cat === 'tool') {
        this.say(`${FE.Gear.name(g)}是工具，放在背包裡，撞上${d.name === '礦鎬' ? '礦脈' : '藥草'}就會用。`, 'sys');
        return;
      }
      if (!FE.Char.canWear(p, g)) {
        this.say(`${FE.Char.cls(p).name}不能穿${d.cls === 'heavy' ? '重甲' : '中甲'}（${FE.Gear.name(g)}）。`, 'sys');
        return;
      }
      const grip = d.cat === 'weapon' ? FE.Char.grip(p, g) : 'one';
      if (grip === 'none') {
        this.say(`${FE.Gear.name(g)}太大太沉了，以你的體型拿不起來。`, 'sys');
        return;
      }
      const slot = d.cat === 'weapon' ? (toOff && FE.Gear.offOk(p, g) ? 'off' : 'main') : d.cat === 'shield' ? 'off' : 'body';
      if (slot === 'off' && p.equip.main && FE.Gear.twoHanded(p, p.equip.main)) {
        const mn = FE.Gear.def(p.equip.main).name;
        this.say(`${mn}要用兩隻手拿，先換下${mn}才拿得了${d.cat === 'shield' ? '盾牌' : '副手的武器'}。`, 'sys');
        return;
      }
      if (toOff && d.cat === 'weapon' && slot === 'main') {
        this.say(`${FE.Gear.name(g)}不能放在副手（以你的體型單手拿不動），改拿在主手。`, 'sys');
      }
      this.beginAction();
      const old = p.equip[slot];
      p.bag = p.bag.filter((e) => e !== entry);
      p.equip[slot] = g;
      if (old) this.bagAddGear(old);
      let extra = '';
      if (slot === 'main' && grip === 'two' && p.equip.off) {
        this.bagAddGear(p.equip.off);
        extra = `${FE.Gear.name(p.equip.off)}放回背包。`;
        p.equip.off = null;
      }
      if (slot === 'off' || extra) p.block = null; // 盾牌換了，格擋值從滿的開始
      this.say(`你${slot === 'main' || d.cat === 'weapon' ? '拿起' : '穿上'}了${FE.Gear.name(g)}${slot === 'off' && d.cat === 'weapon' ? '（副手）' : ''}。${old ? `換下的${FE.Gear.name(old)}放回背包。` : ''}${extra}`, 'good');
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
      this.say(`你把${name}丟掉了（負重 ${this.weight()} / ${this.carryLimit()}）。`, 'sys');
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

    // 第三十二版（三之二）：一段就是一場戰役，裡面的怪物群是這場戰役的危害（試做：照 Dungeon World〈前置〉「一個冒險前置 2～3 個危害」，
    // 地區的樣子照《奇幻探索物語 Quest》：聚落在中間、興趣點在兩側）。開局 4 處，之後每段 2～3 處；
    // 這一段的每個興趣點各放一處（錯誤落在興趣點附近就用它，沒有就挑一處錯誤，把那一群放到興趣點上），其餘的散在這一段裡。
    // 斷層、虛影、狂亂、碎裂一定生（不處理就有走不到的地方、懸空的任務），其餘從地形錯位與斷崖裡隨機挑，沒挑到的不處理
    // （不生怪物、不算進創世門檻）。回傳 { sites: [{ d, must, at }], rest }，at 是放到興趣點上的位置
    pickSites(found, rect, first, landmarks) {
      const rng = this.rng;
      const sites = found.filter((d) => d.type !== 'TERRAIN' && d.type !== 'CLIFF').map((d) => ({ d, must: true }));
      const opt = found.filter((d) => d.type === 'TERRAIN' || d.type === 'CLIFF');
      for (let i = opt.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [opt[i], opt[j]] = [opt[j], opt[i]];
      }
      const n = first ? C.START_SITES : FE.randInt(rng, C.SITE_COUNT[0], C.SITE_COUNT[1]);
      const near = (l, d) => d.x >= l.x0 - 3 && d.x <= l.x1 + 3 && d.y >= l.y0 - 3 && d.y <= l.y1 + 3;
      for (const l of landmarks) {
        if (sites.some((x) => near(l, x.d) || (x.at && near(l, x.at)))) continue;
        const i = opt.findIndex((d) => near(l, d));
        if (i >= 0) sites.push({ d: opt.splice(i, 1)[0] });
        else if (opt.length) sites.push({ d: opt.shift(), at: { x: Math.floor((l.x0 + l.x1) / 2), y: Math.floor((l.y0 + l.y1) / 2) } });
      }
      while (sites.length < n && opt.length) sites.push({ d: opt.shift() });
      return { sites, rest: opt };
    }

    // 第三十三版之二：一處的 BUG 量（budget）拿去配一組怪物，也就是套皮。每隻怪物值多少 BUG 量看數值塊
    // （FE.blockValue：生命 × 一下的平均傷害）。第三十三版之三起 budget 直接是 BUG 值：創世時一處欠的量（rollDebt）、
    // 衰敗的格子欠的量、合體的怪物身上的 bug 加總。候選：這裡每個種族的一群小怪物、中怪物帶小怪物（熊地精在草原帶哥布林）、
    // 只有中怪物的種族一群中怪物、營地（opts.camps；哥布林營地只在戰役 opts.campaign）。總值不超過 BUG 量、又夠接近最好的那幾種，
    // 照種族的權重挑一種；BUG 量到 MID_BUDGET（中怪物）就先挑中怪物帶頭的。一個都放不下就生最便宜的那 1 隻。
    // 回傳 { camp, list: [[種族, 數值塊], ...] }，第一隻是帶頭的
    compose(x, y, budget, opts) {
      const rng = this.rng;
      const c = this.world.cell(x, y);
      const biome = c ? c.biome : 'grassland';
      const val = (race, key) => FE.blockValue(FE.monsterBlock(race, key));
      const has = FE.hasTier;
      const cands = [];
      const add = (list, weight, camp) => cands.push({ list, weight, camp: camp || null, value: list.reduce((t, [r, k]) => t + val(r, k), 0), mid: FE.tierOfKey(list[0][1]) === 'mid' });
      const fit = (v, lo, hi, room) => Math.max(lo, Math.min(hi, Math.floor(room / v)));
      for (const race of FE.racesAt(this.world, x, y)) {
        const R = FE.RACES[race];
        const [, hi] = FE.GROUP_SIZE[race] || [1, 3];
        const H = R.alone && R.alone.includes(biome) ? 1 : hi;
        const lead = R.leads && R.leads[biome];
        if (has(race, 'small') && H > 1) {
          const n = fit(val(race, 'small'), 1, H, budget);
          add(Array(n).fill([race, 'small']), R.weight);
        }
        if (has(race, 'mid')) {
          const vm = val(race, 'mid');
          if (lead) {
            const k = fit(val(lead, 'small'), 0, FE.GROUP_SIZE[lead][1], budget - vm);
            add([[race, 'mid']].concat(Array(k).fill([lead, 'small'])), R.weight);
          } else if (has(race, 'small') && H > 1) {
            const k = fit(val(race, 'small'), 0, H - 1, budget - vm);
            add([[race, 'mid']].concat(Array(k).fill([race, 'small'])), R.weight);
          } else {
            add(Array(fit(vm, 1, H, budget)).fill([race, 'mid']), R.weight);
          }
        } else if (!has(race, 'small')) {
          // 只有菁英數值塊的種族（恐狼、獅子⋯⋯）平常不生，戰役帶頭時才換上（applyElite）
        }
      }
      if (opts && opts.camps) {
        const here = FE.racesAt(this.world, x, y);
        for (const [id, camp] of Object.entries(FE.CAMPS)) {
          if (!here.includes(camp.race) || (camp.campaignOnly && !opts.campaign)) continue;
          // 先放最少的，再一隻一隻往最多加，加到超過 BUG 量為止
          const counts = camp.members.map((m) => m[2][0]);
          const total = () => camp.members.reduce((t, m, i) => t + counts[i] * val(m[0], m[1]), 0);
          if (total() > budget) continue;
          for (let grew = true; grew; ) {
            grew = false;
            for (let i = 0; i < counts.length; i++) {
              if (counts[i] >= camp.members[i][2][1]) continue;
              counts[i]++;
              if (total() > budget) counts[i]--;
              else grew = true;
            }
          }
          const list = [];
          camp.members.forEach((m, i) => { for (let j = 0; j < counts[i]; j++) list.push([m[0], m[1]]); });
          add(list, FE.RACES[camp.race].weight, id);
        }
      }
      let ok = cands.filter((k) => k.value <= budget);
      if (!ok.length) {
        // 一隻都放不下：生最便宜的 1 隻
        const one = cands.map((k) => ({ list: [k.list[0]], weight: k.weight, camp: null, value: val(k.list[0][0], k.list[0][1]) })).sort((p, q) => p.value - q.value)[0];
        return one ? { camp: null, list: one.list } : { camp: null, list: [['goblin', 'small']] };
      }
      if (budget >= C.MID_BUDGET && ok.some((k) => k.mid || k.camp)) ok = ok.filter((k) => k.mid || k.camp);
      const best = Math.max(...ok.map((k) => k.value));
      const pool = ok.filter((k) => k.value >= best * C.SKIN_FIT);
      let r = rng() * pool.reduce((t, k) => t + k.weight, 0);
      const pick = pool.find((k) => (r -= k.weight) < 0) || pool[pool.length - 1];
      return { camp: pick.camp, list: pick.list };
    }

    // 戰役帶頭的是菁英（使用者定的）：帶頭那隻的種族有這一級的菁英數值塊就換上；沒有就換成這裡有菁英數值塊的種族；
    // 這裡也沒有，就由那一群最強的那隻（帶頭的）升成菁英，數值照牠自己的數值塊（怪物圖鑑的數字就夠，不另外加）
    // 營地（camp）照營地自己的規則：沒有菁英就由營地裡最強的那隻升上來（使用者定的，例如最強的食人魔、最強的豺狼人），不換別族
    applyElite(list, x, y, camp) {
      const [race, key] = list[0];
      if (/Elite$/.test(key)) return { list, promoted: false };
      if (camp) return this.promote(list);
      const ek = (FE.tierOfKey(key) === 'mid' ? 'mid' : 'small') + 'Elite';
      if (FE.hasTier(race, ek)) return { list: [[race, ek]].concat(list.slice(1)), promoted: false };
      const others = FE.racesAt(this.world, x, y).filter((k) => FE.hasTier(k, ek));
      if (others.length) return { list: [[FE.pickRace(others, this.rng), ek]].concat(list.slice(1)), promoted: false };
      return this.promote(list);
    }

    // 最強的那隻排到最前面帶頭（升成菁英，數值不變）
    promote(list) {
      const val = (m) => FE.blockValue(FE.monsterBlock(m[0], m[1]));
      const i = list.reduce((bi, m, j) => (val(m) > val(list[bi]) ? j : bi), 0);
      const out = [list[i]].concat(list.filter((_, j) => j !== i));
      return { list: out, promoted: true };
    }

    // 創世時一處起始欠多少 BUG 值（第三十三版之三，使用者定的）：400～2,000（世界等級 1，用 game.rng 擲），每升一級加 10%
    rollDebt() {
      const base = FE.randInt(this.rng, C.SITE_DEBT[0], C.SITE_DEBT[1]);
      return Math.round(base * FE.wlScale(FE.Stability.worldLevel(this), C.WL_BONUS.DEBT));
    }

    // 新聚落的圈伸進舊的區塊：圈裡欠的穩定值挪到圈外最近的地方（圈裡不生怪物也不掉，留著只會算進整體 BUG 值而永遠還不掉），
    // 全世界欠的量不變。跟怪物被挪到圈外是同一個道理
    moveBufferDebt(v) {
      const w = this.world;
      const B = w.bufferWidth(v);
      let moved = 0, sx = 0, sy = 0, n = 0;
      for (let y = v.y0 - B; y <= v.y1 + B; y++) {
        for (let x = v.x0 - B; x <= v.x1 + B; x++) {
          const s = w.stab(x, y);
          if (s >= 0 || !w.inBuffer(x, y)) continue;
          moved -= s;
          sx += x;
          sy += y;
          n++;
          w.setStab(x, y, 0);
        }
      }
      if (moved > 0) this.spillDebt(Math.round(sx / n), Math.round(sy / n), moved);
    }

    // 把 n 點 BUG 值以負的穩定值留在 (x, y) 周圍的格子（能站、不在聚落圈裡），平均分攤；
    // 周圍 3 格內不到 9 格就往外找，最遠 30 格。全世界負值的加總剛好多 n
    spillDebt(x, y, n) {
      n = Math.round(n);
      if (n <= 0) return;
      const w = this.world;
      let cells = [];
      for (let r = 3; r <= 30 && cells.length < 9; r++) {
        cells = [];
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (w.passable(x + dx, y + dy) && !w.inBuffer(x + dx, y + dy)) cells.push([x + dx, y + dy]);
          }
        }
      }
      if (!cells.length) cells = [[x, y]];
      const each = Math.floor(n / cells.length);
      const extra = n - each * cells.length;
      cells.forEach(([cx, cy], i) => w.addDebt(cx, cy, each + (i < extra ? 1 : 0)));
    }

    // 這裡最便宜的一隻（這一格所在的環境有哪些種族）值多少 BUG 值：衰敗的格子欠的量要買得起這個才生怪物
    cheapestAt(x, y) {
      return FE.cheapestValue(FE.racesAt(this.world, x, y));
    }

    // 在一處地點生一組怪物（compose 配好的）：帶頭的那隻帶著錯誤，跟班散在帶頭那隻周圍 2～5 格（營地散得開一點）；
    // 整群守著原地或照常徘徊。每隻的影響範圍照牠值多少 BUG 量分（經驗值、算力跟著算）。room 是這一群最多幾隻（0 就一隻都不生）。
    // 創世時生的都是戰役的危害，帶頭的是菁英；開局那一塊不套營地。
    // 第三十三版之三：這一處起始欠 rollDebt() 那麼多，當 compose 的預算；配出的怪物各帶走 m.bug，欠的量扣掉怪物帶走的，
    // 零頭（含被隻數上限砍掉的、菁英換下去之後超出的跟班、放不下的）以負的穩定值留在帶頭那隻周圍的格子。
    // 守恆：這處欠的量＝怪物 bug 加總＋留在格子的。一隻都放不下、最便宜的那隻比欠的量還貴時，欠的量記成牠的值。
    // 回傳的陣列帶 debt（這處欠的）與 left（留在格子的），測試用
    spawnGroup(site, canReach, first, room) {
      const d = site.at ? Object.assign({}, site.d, site.at) : site.d;
      if (this.isCalm(d.x, d.y)) return [];
      const debt = this.rollDebt();
      const pick = this.compose(d.x, d.y, debt, { campaign: true, camps: !first });
      const el = this.applyElite(pick.list, d.x, d.y, pick.camp);
      const val = (list) => list.reduce((t, [r, k]) => t + FE.blockValue(FE.monsterBlock(r, k)), 0);
      const list = el.list.slice(0, Math.max(0, room));
      // 帶頭的換成菁英會比原本那隻貴一點：總值超過欠的量就從尾巴拿掉跟班（只剩帶頭的為止）
      while (list.length > 1 && val(list) > debt) list.pop();
      const group = list.length ? this.spawnList(d, list, canReach, { camp: pick.camp, origin: 'campaign', elite: true }) : [];
      for (const m of group) m.campaign = this.curCampaign; // 這一段戰役的危害（清光寫進歷史紀錄）
      const placed = group.reduce((t, m) => t + m.bug, 0);
      const owed = Math.max(debt, placed);
      const left = owed - placed;
      if (left > 0) this.spillDebt(group.length ? group[0].x : d.x, group.length ? group[0].y : d.y, left);
      group.debt = owed;
      group.left = left;
      return group;
    }

    // 照清單（[[種族, 數值塊], ...]，第一隻帶頭）在錯誤 d 那裡生一組；opts：camp 營地種類、origin（campaign 戰役、disorder 失序）、
    // elite 帶頭的是菁英。營地記進 world.camps
    spawnList(d, list, canReach, opts) {
      opts = opts || {};
      const pick = { camp: opts.camp || null };
      const share = ([race, key]) => Math.max(1, Math.round(FE.blockValue(FE.monsterBlock(race, key)) / C.REWARD_VALUE_PER_SCOPE));
      const one = (i, at) => Object.assign({}, d, at, { race: list[i][0], block: list[i][1], elite: i === 0 && !!opts.elite, scope: share(list[i]) });
      const lead = this.spawnMonster(one(0, {}), canReach);
      if (!lead) return [];
      const guard = pick.camp ? true : this.rng() < C.GROUP_GUARD;
      Object.assign(lead, { group: lead.id, guard });
      if (pick.camp) lead.camp = pick.camp;
      const group = [lead];
      const w = this.world;
      const [r0, r1] = pick.camp ? C.CAMP_SPREAD : C.GROUP_SPREAD;
      for (let i = 1; i < list.length; i++) {
        let at = null;
        for (let t = 0; t < 30 && !at; t++) {
          const x = lead.x + FE.randInt(this.rng, -r1, r1);
          const y = lead.y + FE.randInt(this.rng, -r1, r1);
          const r = Math.max(Math.abs(x - lead.x), Math.abs(y - lead.y));
          if (r < r0 || !w.passable(x, y) || w.inBuffer(x, y) || this.monsterAt(x, y) || this.isPlayerAt(x, y) || w.npcAt(x, y) || w.chestAt(x, y) || this.soldierAt(x, y)) continue;
          if ((canReach && !canReach(x, y)) || this.isCalm(x, y)) continue;
          at = { x, y };
        }
        if (!at) at = this.findFreeNear(lead.x, lead.y, canReach);
        if (!at) break;
        const m = FE.makeMonster(one(i, at), this.nextMonsterId++, FE.Stability.worldLevel(this));
        m.elite = false;
        m.name = FE.monsterName(m);
        Object.assign(m, { group: lead.id, guard });
        this.monsters.push(m);
        group.push(m);
      }
      if (pick.camp) w.camps.push({ id: lead.id, kind: pick.camp, x: lead.x, y: lead.y, origin: opts.origin || 'campaign' });
      return group;
    }

    // 一群全倒：是營地就把營地拿掉；失序的營地留下遺留地點（第三十三版之二，使用者定的），戰役的營地不留
    siteCleared(groupId) {
      const w = this.world;
      const camp = w.camps.find((c) => c.id === groupId);
      if (!camp) return '';
      w.camps = w.camps.filter((c) => c !== camp);
      const name = FE.CAMPS[camp.kind].name;
      if (camp.origin === 'disorder') {
        w.remnants.push({ kind: camp.kind, x: camp.x, y: camp.y, day: this.day() });
        return `${name}清空了，只剩下一片廢棄的營地。`;
      }
      return `${name}清空了。`;
    }

    // 一段戰役的危害全清光：寫進歷史紀錄（第三十三版之二：戰役是歷史紀錄，接上原本的歷史紀錄）
    campaignCleared(i) {
      const w = this.world;
      const rec = w.campaigns && w.campaigns[i];
      if (!rec) return;
      delete w.campaigns[i];
      this.history.unshift({
        kind: 'campaign',
        time: FE.nowTaipei(),
        seed: this.seed,
        player: this.player.name,
        seg: rec.seg,
        place: rec.place,
        day: rec.day,
        cleared: this.day(),
        content: rec.content,
      });
      FE.store.save('fe.history', this.history.slice(0, 200));
      this.say(`第 ${rec.seg} 段戰役（${rec.place}）的危害都清光了，寫進了世界的歷史紀錄。`, 'world');
    }

    // 遊戲裡的第幾天（從 1 起算）
    day() {
      return Math.floor((this.ticks || 0) / C.DAY_TICKS) + 1;
    }

    // 還沒過期的冷卻區（過期的順手清掉）
    activeCalm() {
      const w = this.world;
      if (!w.calm || !w.calm.length) return [];
      const now = this.ticks || 0;
      w.calm = w.calm.filter((c) => c.until > now);
      return w.calm;
    }

    // 這一格在不在冷卻區裡（清掉怪物後 5～7 天不生怪物、穩定值不掉）
    isCalm(x, y) {
      return this.activeCalm().some((c) => Math.max(Math.abs(x - c.x), Math.abs(y - c.y)) <= c.r);
    }

    // 清掉一處怪物：那一帶記成冷卻區，範圍內的格子補回起始值（第三十三版之三，使用者定的）
    calmAt(x, y) {
      const days = FE.randInt(this.rng, C.CALM_DAYS[0], C.CALM_DAYS[1]);
      this.world.calm.push({ x, y, r: C.CALM_RADIUS, until: (this.ticks || 0) + days * C.DAY_TICKS });
      const w = this.world;
      for (let cy = y - C.CALM_RADIUS; cy <= y + C.CALM_RADIUS; cy++) {
        for (let cx = x - C.CALM_RADIUS; cx <= x + C.CALM_RADIUS; cx++) if (w.inBounds(cx, cy)) w.resetStab(cx, cy);
      }
    }

    spawnMonster(d, canReach) {
      // 冷卻區裡不生怪物；錯誤在區外但要挪位置時，也不挪進區裡
      if (this.isCalm(d.x, d.y)) return null;
      const reach0 = canReach;
      canReach = (x, y) => !this.isCalm(x, y) && (!reach0 || reach0(x, y));
      let { x, y } = d;
      const blocked = this.monsterAt(x, y) || this.isPlayerAt(x, y) || this.soldierAt(x, y) || this.world.inBuffer(x, y);
      if (blocked || (canReach && !canReach(x, y))) {
        const free = this.findFreeNear(x, y, canReach);
        if (!free) return null;
        x = free.x;
        y = free.y;
      }
      // 新生成的怪物照生成當下的世界等級套用加成
      const m0 = FE.makeMonster(Object.assign({}, d, { x, y }), this.nextMonsterId++, FE.Stability.worldLevel(this));
      const m = d.race ? m0 : FE.dressMonster(m0, this.world, this.rng); // 給了種族（compose 配好的）就不再照環境換
      this.monsters.push(m);
      return m;
    }

    // 經驗值只管冒險者的等級；創世改看算力（earn）
    addExp(n) {
      if (n <= 0) return;
      this.exp += n;
      const p = this.player;
      while (p && this.level < C.LEVEL_MAX && this.exp >= FE.levelExp(this.level + 1)) {
        this.level++;
        // 只有升到 4、8、12、16、19 級才有 1 點屬性（畫面會跳出加點視窗，視窗開著不能做別的事），其他等級升級只加生命
        const point = C.LEVEL_POINT_AT.includes(this.level);
        if (point) p.points += C.LEVEL_POINTS;
        const gain = this.recalc();
        this.say(`升到 Lv${this.level}！生命上限 +${gain}（現在 ${p.maxHp}）${point ? `，可以加 ${C.LEVEL_POINTS} 點屬性` : ''}。`, 'world');
      }
      this.dropLostPoints();
    }

    // 生命上限照公式重算（職業基礎、體質、等級），多出來的部分同時補到目前的生命；回傳多了幾點
    recalc() {
      const p = this.player;
      const max = FE.Char.maxHp(p, this.level) + (p.ward ? p.ward.hp || 0 : 0); // 神聖加護、守護加的生命上限
      const gain = max - p.maxHp;
      p.maxHp = max;
      if (gain > 0) p.hp += gain;
      p.hp = Math.min(p.hp, p.maxHp);
      return gain;
    }

    // 升級的屬性點：選一項還沒到上限（18）的屬性加 1。回傳有沒有加成功
    spendPoint(key) {
      const p = this.player;
      const a = FE.ATTRS.find((x) => x.key === key);
      if (!a || !(p.points > 0)) return false;
      if (p.attr[key] >= C.ATTR_CAP) {
        this.say(`${a.name}已經到 ${C.ATTR_CAP} 了，不能再加。`, 'sys');
        return false;
      }
      p.attr[key]++;
      p.points--;
      const gain = this.recalc();
      const m = FE.Char.mod(p.attr[key]);
      this.say(`${a.name}加到 ${p.attr[key]}（修正值 ${m > 0 ? '+' : ''}${m}）${gain > 0 ? `，生命上限 +${gain}（現在 ${p.maxHp}）` : ''}。`, 'good');
      this.dropLostPoints();
      return true;
    }

    // 六項屬性都到上限了，沒地方加的點數就不留
    dropLostPoints() {
      const p = this.player;
      if (p && p.points > 0 && FE.ATTRS.every((a) => p.attr[a.key] >= C.ATTR_CAP)) {
        p.points = 0;
        this.say('六項屬性都到上限了。', 'sys');
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
      for (let i = 0; i < 10 && this.creation >= this.nextChunkAt; i++) if (this.createChunk(false) === false) break; // 長滿 288×288 就停
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

    // 每做一個動作，重擊與治療的冷卻少一回合；瞄準取消
    beginAction() {
      if (this.battle.cooldown > 0) this.battle.cooldown--;
      if (this.battle.healCd > 0) this.battle.healCd--;
      const sc = this.battle.spellCd || {};
      for (const k of Object.keys(sc)) if (sc[k] > 0) sc[k]--;
      this.aim = null;
    }

    // 累積修補力：世界越亂，創世神分到演算事件的修補力越少（創世力不受影響）
    addRepair(n) {
      this.compute = Math.min(C.COMPUTE_CAP, this.compute + n * FE.Stability.mult(this, 'COMPUTE'));
    }

    // opts.noTalk（第三十一版，介面的方向鍵與滑鼠自動行走用）：撞上村民、工匠、士兵只是被擋住，不開對話；對話改成滑鼠點他
    move(dx, dy, opts) {
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
            this.turn++; // 倒下了，已經回到醒來的地方；醒來也算一次長休（afterTurn）
            this.afterTurn();
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
        if (opts && opts.noTalk) return;
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
      // 超過推拖上限（力量值×30 磅）：不能移動，要先丟掉東西
      if (this.loadTier() >= 2) {
        this.say(`你背得太重了（${this.weight()} 磅，推拖上限 ${this.pushLimit()} 磅），邁不開腳步。先丟掉一些東西（按 B 打開背包，選「丟掉」）。`, 'sys');
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
          this.turn++; // 倒下了，已經回到醒來的地方；醒來也算一次長休（afterTurn）
          this.afterTurn();
          return;
        }
      }
      if (node) {
        const def = FE.NODES[node.kind];
        this.say(`這裡有${def.name}，需要${FE.GEAR[def.tool].name}才${def.verb}得下來（鐵匠或武器匠有賣）。`, 'sys');
      }
      this.pickUp(nx, ny);
      const chest = this.world.chestAt(nx, ny);
      if (chest) {
        // 數值暴走體徘徊離開後，寶箱還是壞的，要打倒牠才修得好
        if (FE.Checker.checkChest(chest)) this.say('寶箱被怪物的力量封住了，打不開。', 'sys');
        else this.openChest(chest);
      }
      // 走一步花幾刻：10 刻減敏捷修正值（最少 8）；背超過能背的重量一步 60 刻；被扭曲過的地面一步 30 刻（取較大的）
      // 力量不到身上防具的需求：一步 15 刻（跟超重、被扭曲的地面取最大的）；力竭照《D&D》每級速度少 5 呎，刻數照比例放大（第三十版）
      const base = this.loadTier() >= 1 ? C.OVER_MOVE_TICKS : FE.Char.strShort(p) ? Math.max(C.STR_REQ_TICKS, FE.Char.moveTicks(p)) : FE.Char.moveTicks(p);
      const tired = (t) => Math.round(t * FE.Char.exhaustMoveMul(p));
      if (this.isHardGround(nx, ny)) {
        const t = tired(Math.max(C.TICKS_HARD, base));
        this.say(`這裡的地面被異常扭曲過，很難走，這一步花了 ${t} 刻。`, 'sys');
        this.endTurn(true, t);
      } else {
        this.endTurn(true, tired(base));
      }
    }

    // 冒險者做完一個動作：每個動作都附帶一點虛擬的修補力；移動才累積步數與算力。
    // 時間用「刻」算（參考矮人要塞）：動作花幾刻，失序時每個動作的刻加倍。花掉的刻交給 advance 讓世界照時鐘跑。
    // opts.exact：刻數照給的（休息用：不加防具多花的刻、失序不加倍）；opts.sleep：長休中（不累積力竭）；
    // opts.interrupt()：每 10 刻問一次，回傳 true 就停（野外短休被怪物打斷）。回傳實際花了幾刻
    endTurn(moved, ticks, opts) {
      opts = opts || {};
      const p = this.player;
      const chaos = FE.Stability.state(this) === 2 ? C.CHAOS_TIME : 1;
      // 身上防具讓每個動作多花幾刻（見 gear.js 的 extraTicks）；超重只讓走路變慢（見 move）
      const t = opts.exact ? ticks : ((ticks || C.TICKS_MOVE) + FE.Gear.extraTicks(p)) * chaos;
      this.turn++;
      FE.Combat.regenBlock(this, p);
      this.addRepair(C.VIRTUAL_REPAIR);
      // 冒險者脫離戰鬥（被射過的怪物離冒險者超過視野，撤退、倒下醒來都算）：自動撿回射向牠的箭的一半
      for (const m of this.monsters) if ((m.arrows || m.bolts) && Math.abs(m.x - p.x) + Math.abs(m.y - p.y) > C.SIGHT) this.recoverArrows(m);
      if (moved !== false) {
        p.steps++;
        this.earn(C.COMPUTE_PER_MOVE);
        if (p.steps % C.NPC_MOVE_EVERY === 0) FE.AI.npcTurn(this);
      }
      this.sleeping = !!opts.sleep;
      const spent = this.advance(t, opts.interrupt);
      this.sleeping = false;
      this.afterTurn();
      return spent;
    }

    // 時間往前走 t 刻（第三十版的時鐘，一次走 10 刻）：怪物與士兵每 10 刻各動一次（刻數累積起來，湊滿 10 刻就多動一次，
    // 防具多花的刻真的讓世界多動）；每過 100 刻演算一次事件；每過一天（2,400 刻）聚落的經濟值照附近的怪物扣；
    // 連續一整天沒有長休，力竭 +1。平常 worldEvery 是 1；測試的「四人等效」模擬用 4，世界慢四倍。
    // interrupt() 回傳 true、或冒險者倒下了就停，回傳實際走了幾刻
    advance(t, interrupt) {
      const p = this.player;
      let done = 0;
      while (done < t) {
        const step = Math.min(C.TICKS_MOVE, t - done);
        const before = this.ticks || 0;
        this.ticks = before + step;
        done += step;
        this.tickAcc = (this.tickAcc || 0) + step;
        const turns = Math.floor(this.tickAcc / C.TICKS_MOVE);
        this.tickAcc -= turns * C.TICKS_MOVE;
        this.worldClock += turns / this.worldEvery;
        while (this.worldClock >= 1 && !this.fell) {
          this.worldClock -= 1;
          FE.AI.worldTurn(this);
          if (!this.fell) FE.AI.soldierTurn(this);
        }
        if (this.fell) {
          this.worldClock -= Math.floor(this.worldClock); // 冒險者倒下了，沒走完的回合不補
          return done;
        }
        for (let k = Math.floor(before / C.EVENT_TICKS) + 1; k * C.EVENT_TICKS <= this.ticks; k++) FE.Events.tick(this);
        for (let k = Math.floor(before / C.DAY_TICKS) + 1; k * C.DAY_TICKS <= this.ticks; k++) this.econDay();
        // 力竭：連續一整天（2,400 刻）沒有長休 +1 級（最多 6 級；長休中不算）
        while (!this.sleeping && p.exhaust < C.EXHAUST_MAX && this.ticks - (p.awakeAt || 0) >= C.DAY_TICKS) {
          p.awakeAt = (p.awakeAt || 0) + C.DAY_TICKS;
          p.exhaust++;
          FE.Stability.stat(this).exhaustMax = Math.max(FE.Stability.stat(this).exhaustMax, p.exhaust);
          this.say(p.exhaust >= C.EXHAUST_MAX ? '你撐不住了，眼前一黑。' : `你已經一整天沒好好睡過，越來越累了（力竭 ${p.exhaust}）。`, 'bad');
        }
        if (interrupt && interrupt()) return done;
      }
      return done;
    }

    // 一個動作的收尾：倒下的醒來也算一次長休（世界跑 80 回合、不收錢）；力竭到 6 級也倒下，在最近的聚落醒來，
    // 降到 5 級再照長休 −1。最後量一次世界狀態
    afterTurn() {
      const p = this.player;
      const fell = this.fell;
      this.fell = false;
      if (p.ward && this.ticks >= p.ward.until) this.endWard();
      this.unstrand();
      const collapsed = p.exhaust >= C.EXHAUST_MAX;
      if (collapsed) {
        if (!fell) {
          this.battle.targetId = null;
          this.say(`你累得倒了下去，在${this.wakeSpot()}醒來。`, 'bad');
        }
        p.exhaust = C.EXHAUST_MAX - 1;
      }
      if (fell || collapsed) this.sleepFree();
      FE.Stability.update(this);
    }

    // 不收錢的長休（倒下、力竭倒下後醒來）：世界同步跑 80 回合，生命回滿、力竭 −1，沒有生活水準的效果
    sleepFree() {
      this.sleeping = true;
      this.advance(C.LONG_REST_TICKS);
      this.sleeping = false;
      this.fell = false;
      this.unstrand();
      this.rested();
      this.say('你睡了一覺，生命回滿。', 'good');
    }

    // 長休完：生命回滿、力竭 −1，從現在起重新算「連續多久沒有長休」
    rested() {
      const p = this.player;
      p.hp = p.maxHp;
      p.exhaust = Math.max(0, (p.exhaust || 0) - 1);
      p.awakeAt = this.ticks;
      FE.Stability.stat(this).longRests++;
    }

    // 怪物一定打得到：修補斷層、斷崖這類改高度的事，可能把怪物困在四面斷崖的台子或坑裡。
    // 每回合檢查，上下左右沒有一格走得過去、高度又接得上的怪物，腳下的高度改成跟旁邊最接近的那格一樣（牠滑下台子）
    unstrand() {
      const w = this.world;
      for (const m of this.monsters) {
        const near = DIRS.map(([dx, dy]) => [m.x + dx, m.y + dy]).filter(([x, y]) => w.passable(x, y));
        if (!near.length || near.some(([x, y]) => w.heightOk(m.x, m.y, x, y))) continue;
        const h = w.cell(m.x, m.y).h;
        const [nx, ny] = near.sort((a, b) => Math.abs(w.cell(a[0], a[1]).h - h) - Math.abs(w.cell(b[0], b[1]).h - h))[0];
        w.setHeight(m.x, m.y, w.cell(nx, ny).h);
        if (Math.abs(m.x - this.player.x) + Math.abs(m.y - this.player.y) <= C.SIGHT) this.say(`${m.name}腳下的地面塌了下來。`, 'bug');
      }
    }

    // 攻擊目前的目標（按 1、2；撞上怪物只設目標，不出手）：一個動作，打完所有怪物各做一件事。
    // extra.reach：長槍打直線 2 格外的目標（觸及）
    strike(kind, m, extra) {
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
      if (kind === 'deep') this.battle.cooldown = C.DEEP_COOLDOWN;
      // 拿著弓箭按 1、2 是拿弓打人：1d4 鈍擊（見 char.js 的 profile）；射擊要按 F
      const main = p.equip.main;
      // 雙持：副手也拿著武器時（暫時弓箭以外都能放副手），按 1 一般攻擊，主手、副手各對目標出手一次，各擲 d20；
      // 副手那一下不加屬性修正值（負的照扣）。重擊只用主手。目標在第一下倒下（或冒險者倒下）就不出第二下
      const off = p.equip.off && FE.Gear.def(p.equip.off).cat === 'weapon' ? p.equip.off : null;
      const dual = kind === 'attack' && !!off && !!main && !(extra && extra.reach);
      // 攻擊動作的刻：輕型 8、一般 10、重型 12，減敏捷修正值（最少 6）；雙持時副手那把沒有迅切（短刀以外、或還沒解鎖）就多 5 刻
      const nick = dual && FE.Char.mastery(p, off) === 'nick';
      const ticks = FE.Char.attackTicks(p, main) + (dual && !nick ? C.DUAL_TICKS : 0);
      // 牧師：每個動作第一下命中時，目標多受 1d8 神聖傷害（雙持只算第一下命中的）
      let holy = !!FE.Char.cls(p).holy;
      const first = FE.Combat.resolveAttack(this, p, m, kind, { weapon: main, holy });
      if (first.hit) holy = false;
      // 一個動作內擲出 6～10 的「必定反擊」最多觸發一次：主手已經觸發，副手那一下擲出 6～10 只算命中
      // 主手那一下把目標推開（長槍的推擊）或打倒了，副手就不出手：副手只打得到還貼在旁邊的目標
      if (dual && !this.fell && this.monsters.includes(m) && FE.AI.touching(this, m, p)) FE.Combat.resolveAttack(this, p, m, kind, { dual: true, weapon: off, off: true, noForced: first.forced, holy });
      // 順劈（巨斧的精通）：主手命中後，可以順手打目標旁邊（八方向）、也在你的觸及範圍內（貼著你）的另一隻怪物（挑血量最少的），這一下不加屬性修正值；一個動作最多一次，不再磨損、練技能
      if (first.hit && !this.fell && main && FE.Char.mastery(p, main) === 'cleave' && !(extra && extra.reach)) {
        const other = this.monsters
          .filter((o) => o !== m && Math.max(Math.abs(o.x - m.x), Math.abs(o.y - m.y)) === 1 && FE.AI.touching(this, o, p))
          .sort((a, b) => a.hp - b.hp || a.id - b.id)[0];
        if (other) FE.Combat.resolveAttack(this, p, other, 'attack', { weapon: main, cleave: true, noWear: true, noTrain: true, noForced: true });
      }
      this.endTurn(false, ticks);
    }

    // 觸及：主手是長槍、旁邊沒有目標時，上下左右直線 2 格外、中間是空格的怪物打得到（目前的目標優先）
    reachTarget() {
      const p = this.player;
      const w = p.equip.main;
      if (!w || !FE.Gear.def(w).reach) return null;
      const w0 = this.world;
      const ok = (m) => {
        const dx = m.x - p.x;
        const dy = m.y - p.y;
        if (!((Math.abs(dx) === C.REACH && dy === 0) || (Math.abs(dy) === C.REACH && dx === 0))) return false;
        const mx = p.x + Math.sign(dx);
        const my = p.y + Math.sign(dy);
        return w0.passable(mx, my) && !this.monsterAt(mx, my) && !w0.npcAt(mx, my) && !this.soldierAt(mx, my) && !w0.chestAt(mx, my) &&
          w0.heightOk(p.x, p.y, mx, my) && w0.heightOk(mx, my, m.x, m.y);
      };
      const list = this.monsters.filter(ok);
      return list.find((m) => m.id === this.battle.targetId) || list.sort((a, b) => a.hp - b.hp)[0] || null;
    }

    // ---- 遠程：按 F 瞄準，Tab 換目標，F 或 Enter 出手，Esc 取消 ----
    // 拿弓箭（要箭矢）是射擊，拿短刀、短矛是投擲，法師拿法杖是範圍魔攻。回傳 { mode, weapon, range } 或 null（順便寫出為什麼不行）
    // 投擲（第二十九版追加，所有武器都能丟，按 T）：副手拿著武器先丟副手，否則丟主手；射程一律 4／12 格加感知修正值
    throwMode(quiet) {
      const p = this.player;
      const off = p.equip.off && FE.Gear.def(p.equip.off).cat === 'weapon' ? p.equip.off : null;
      const w = off || p.equip.main;
      if (!w) {
        if (!quiet) this.say('手上沒有武器可以丟。', 'sys');
        return null;
      }
      return { mode: 'throw', weapon: w, slot: off ? 'off' : 'main', range: FE.Char.range(p, C.THROW_RANGE) };
    }

    rangedMode(quiet, kind) {
      const p = this.player;
      if (kind === 'throw') return this.throwMode(quiet);
      const w = p.equip.main;
      const d = w ? FE.Gear.def(w) : null;
      const no = (text) => {
        if (!quiet) this.say(text, 'sys');
        return null;
      };
      // 第三十一版的施法：kind 是要瞄準的法術（魔法攻擊、大魔法攻擊、神聖攻擊）；沒指定就是這個職業的單體攻擊招（機器人用）
      const spells = this.spellsOf();
      if (spells.length && kind !== 'shoot') {
        const id = FE.SPELLS[kind] ? kind : spells.find((k) => FE.SPELLS[k].aim && !FE.SPELLS[k].area);
        if (id && FE.SPELLS[id].aim) {
          const cd = this.spellCd(id);
          if (cd > 0) return no(`${FE.SPELLS[id].name}還要 ${cd} 回合才能再用。`);
          return { mode: id, weapon: null, range: FE.Char.range(p, C.SPELL_RANGE) };
        }
      }
      // 牧師按 F 放神聖之光（不用拿武器）
      if (FE.Char.cls(p).light && !spells.length) return { mode: 'light', weapon: null, range: FE.Char.range(p, C.SPELL_RANGE) };
      if (d && d.ammo) {
        if (!this.bagCount(d.ammo)) return no(`沒有${FE.GEAR[d.ammo].name}了（鐵匠、武器匠有賣）。`);
        return { mode: 'shoot', weapon: w, range: FE.Char.range(p, d.range) };
      }
      if (d && d.thrown) return this.throwMode(quiet);
      if (d && w.type === 'staff' && FE.Char.cls(p).spell && !spells.length) return { mode: 'spell', weapon: w, range: FE.Char.range(p, C.SPELL_RANGE) };
      if (d && w.type === 'staff') return no('法杖在你手上只能近戰（只有法師施得出法術）。');
      return no(w ? `${FE.Gear.name(w)}不能按 F 遠程攻擊。拿弓箭、輕弩可以射擊；任何武器都可以按 T 丟出去。` : '手上沒有武器，不能遠程攻擊。');
    }

    // 射程內、看得到的怪物，近的在前
    shootTargets(range) {
      const p = this.player;
      return this.monsters
        .filter((m) => FE.Combat.canShoot(this, p, m, range))
        .sort((a, b) => FE.Combat.dist(a, p) - FE.Combat.dist(b, p) || a.id - b.id);
    }

    // 按 F：進入瞄準，自動選最近、看得到的怪物（不算動作）
    aimStart(kind) {
      const p = this.player;
      if (this.world.inVillage(p.x, p.y)) {
        this.say('在村莊和城鎮裡不能動手，先走出去。', 'sys');
        return;
      }
      const r = this.rangedMode(false, kind);
      if (!r) return;
      const list = this.shootTargets(r.range);
      if (!list.length) {
        this.say(`射程內（最遠 ${r.range[1]} 格）看不到怪物。`, 'sys');
        return;
      }
      // 目前的目標在射程內就先選牠
      const i = Math.max(0, list.findIndex((m) => m.id === this.battle.targetId));
      this.aim = { mode: r.mode, kind, ids: list.map((m) => m.id), i };
    }

    // 瞄準中的怪物（不在了就是 null）
    aimTarget() {
      if (!this.aim) return null;
      return this.monsters.find((m) => m.id === this.aim.ids[this.aim.i]) || null;
    }

    // Tab：換下一個目標
    aimNext() {
      if (!this.aim) return;
      this.aim.i = (this.aim.i + 1) % this.aim.ids.length;
    }

    aimCancel() {
      this.aim = null;
    }

    // F 或 Enter：對瞄準的怪物出手
    aimFire() {
      const m = this.aimTarget();
      const kind = this.aim && this.aim.kind;
      this.aim = null;
      if (m) this.fireAt(m, kind);
    }

    // 遠程出手（一個動作）：射擊用掉 1 支箭；投擲的武器掉在目標那格；範圍魔攻打目標與周圍的怪物。
    // 出手的目標設成目前的目標（牠會纏上來）。測試的機器人直接叫這個
    fireAt(m, kind) {
      const p = this.player;
      if (this.world.inVillage(p.x, p.y)) {
        this.say('在村莊和城鎮裡不能動手，先走出去。', 'sys');
        return false;
      }
      const r = this.rangedMode(false, kind);
      if (!r) return false;
      if (!this.monsters.includes(m) || !FE.Combat.canShoot(this, p, m, r.range)) {
        this.say(`${m.name}不在射程內，或中間有東西擋著。`, 'sys');
        return false;
      }
      this.beginAction();
      this.battle.targetId = m.id;
      this.earn(C.COMPUTE_PER_ATTACK);
      const w = r.weapon;
      const ticks = FE.Char.attackTicks(p, w);
      let holy = !!FE.Char.cls(p).holy;
      if (FE.SPELLS[r.mode]) {
        this.castOn(r.mode, m, r.range);
      } else if (r.mode === 'shoot') {
        // 先記在怪物身上：牠倒下或冒險者脫離戰鬥時撿回一半（見 recoverArrows）；箭矢記在 m.arrows，弩矢記在 m.bolts
        const q = this.takeArrow(FE.Gear.def(w).ammo);
        const field = FE.Gear.def(w).ammo === 'bolt' ? 'bolts' : 'arrows';
        m[field] = m[field] || {};
        m[field][q] = (m[field][q] || 0) + 1;
        FE.Combat.resolveAttack(this, p, m, 'attack', { mode: 'shoot', weapon: w, range: r.range, ammoQ: q, holy });
      } else if (r.mode === 'throw') {
        const at = { x: m.x, y: m.y };
        FE.Combat.resolveAttack(this, p, m, 'attack', { mode: 'throw', weapon: w, range: r.range, holy });
        // 擲出去的武器（沒在出手時磨壞的話）掉在目標那格，走過去就撿回來；丟的是主手的，副手拿著武器就換到主手
        if (p.equip.off === w) {
          p.equip.off = null;
          this.world.items.push({ x: at.x, y: at.y, gear: w });
        } else if (p.equip.main === w) {
          p.equip.main = null;
          this.world.items.push({ x: at.x, y: at.y, gear: w });
          if (p.equip.off && FE.Gear.def(p.equip.off).cat === 'weapon') {
            p.equip.main = p.equip.off;
            p.equip.off = null;
          }
        }
      } else if (r.mode === 'light') {
        // 牧師的神聖之光：對一個目標，1d8＋感知修正值的神聖傷害，命中加感知修正值
        FE.Combat.resolveAttack(this, p, m, 'attack', { mode: 'light', weapon: null, range: r.range });
      } else {
        // 範圍魔攻：目標與周圍 1 格（智力修正值 +3 起 2 格）的所有怪物，每隻各擲命中；法杖只磨一次、技能只練一次
        const rad = FE.Char.attrMod(p, 'int') >= C.SPELL_BIG_INT ? C.SPELL_RADIUS[1] : C.SPELL_RADIUS[0];
        const hit = this.monsters
          .filter((o) => Math.max(Math.abs(o.x - m.x), Math.abs(o.y - m.y)) <= rad)
          .sort((a, b) => (a === m ? -1 : b === m ? 1 : a.id - b.id));
        hit.forEach((o, i) => {
          if (this.fell || !this.monsters.includes(o)) return;
          FE.Combat.resolveAttack(this, p, o, 'attack', { mode: 'spell', weapon: w, range: r.range, noWear: i > 0, noTrain: i > 0 });
        });
      }
      this.endTurn(false, ticks);
      return true;
    }

    // ---- 施法（第三十一版）：法師、牧師、聖騎士的招式；按 F 打開招式清單（介面），瞄準的招走 aimStart／fireAt，其他的直接 cast ----
    spellsOf() {
      const p = this.player;
      return FE.CLASSES[p.cls] && FE.CLASSES[p.cls].allGear ? FE.CLASS_SPELLS[p.cls] || [] : [];
    }
    spellCd(id) {
      return (this.battle.spellCd && this.battle.spellCd[id]) || 0;
    }
    // 瞄準的攻擊招打出去（fireAt 叫，已經算了動作）：單體打目標；大魔法攻擊打目標與周圍（法杖只磨一次、技能只練一次）
    castOn(id, m, range) {
      const p = this.player;
      const sp = FE.SPELLS[id];
      const staff = !sp.noStaff && p.equip.main && p.equip.main.type === 'staff' ? p.equip.main : null;
      this.battle.spellCd = this.battle.spellCd || {};
      this.battle.spellCd[id] = sp.cd || 0;
      this.say(`你施放${sp.name}。`, 'sys');
      if (sp.area !== 'target') {
        FE.Combat.resolveAttack(this, p, m, 'attack', { mode: id, weapon: staff, range });
        return;
      }
      const rad = FE.Char.attrMod(p, 'int') >= C.SPELL_BIG_INT ? C.SPELL_RADIUS[1] : C.SPELL_RADIUS[0];
      const hit = this.monsters.filter((o) => Math.max(Math.abs(o.x - m.x), Math.abs(o.y - m.y)) <= rad).sort((a, b) => (a === m ? -1 : b === m ? 1 : a.id - b.id));
      hit.forEach((o, i) => {
        if (this.fell || !this.monsters.includes(o)) return;
        FE.Combat.resolveAttack(this, p, o, 'attack', { mode: id, weapon: staff, range, noWear: i > 0, noTrain: i > 0 });
      });
    }
    // 不用瞄準的招（大神聖攻擊、懲戒、三種防禦招）：算一個動作。回傳有沒有放出去
    cast(id) {
      const p = this.player;
      const sp = FE.SPELLS[id];
      if (!sp || !this.spellsOf().includes(id)) {
        this.say('你不會這一招。', 'sys');
        return false;
      }
      if (sp.aim) {
        this.aimStart(id);
        return false;
      }
      if (sp.ward) return this.castWard(id);
      const cd = this.spellCd(id);
      if (cd > 0) {
        this.say(`${sp.name}還要 ${cd} 回合才能再用。`, 'sys');
        return false;
      }
      if (this.world.inVillage(p.x, p.y)) {
        this.say('在村莊和城鎮裡不能動手，先走出去。', 'sys');
        return false;
      }
      const around = this.monsters.filter((o) => Math.max(Math.abs(o.x - p.x), Math.abs(o.y - p.y)) <= 1 && FE.Combat.adjacent(this, p, o));
      if (!around.length) {
        this.say(`周圍沒有怪物，${sp.name}打不到東西。`, 'sys');
        return false;
      }
      this.beginAction();
      this.battle.spellCd = this.battle.spellCd || {};
      this.battle.spellCd[id] = sp.cd || 0;
      this.earn(C.COMPUTE_PER_ATTACK);
      const staff = !sp.noStaff && p.equip.main && p.equip.main.type === 'staff' ? p.equip.main : null;
      this.say(`你施放${sp.name}。`, 'sys');
      around.sort((a, b) => a.id - b.id).forEach((o, i) => {
        if (this.fell || !this.monsters.includes(o)) return;
        const r = FE.Combat.resolveAttack(this, p, o, 'attack', { mode: id, weapon: staff, noWear: i > 0, noTrain: i > 0 });
        // 大神聖攻擊：打中（還活著）就推開，大型推不動
        if (sp.push && r && r.hit && this.monsters.includes(o) && !o.boss) FE.Combat.push(this, p, o, sp.push);
      });
      this.endTurn(false, FE.Char.attackTicks(p, staff));
      return true;
    }
    // 防禦招：AC、生命（照 Aid 加上限與目前生命）、持續時間與被打中次數；效果還在就不能再放
    castWard(id) {
      const p = this.player;
      const sp = FE.SPELLS[id];
      if (p.ward) {
        this.say(`${FE.SPELLS[p.ward.id].name}還在，效果結束才能再放。`, 'sys');
        return false;
      }
      if (sp.unarmored && this.armored()) {
        this.say(`穿著防具，${sp.name}沒有效果（衣袍可以）。`, 'sys');
        return false;
      }
      this.beginAction();
      const m = sp.hpAttr ? FE.Char.attrMod(p, sp.hpAttr) : 0;
      const hp = sp.hp ? Math.max(1, sp.hp + m) : 0;
      p.ward = { id, ac: sp.ac, until: this.ticks + sp.ticks, hits: sp.hits ? Math.max(1, sp.hits + m) : null, hp };
      if (hp) {
        p.maxHp += hp;
        p.hp += hp;
      }
      this.say(`你施放${sp.name}：怪物比較打不中你${hp ? `，生命上限 +${hp}` : ''}。`, 'good');
      this.endTurn(false);
      return true;
    }
    armored() {
      const b = this.player.equip.body;
      return !!b && FE.GEAR[b.type].cls !== 'none';
    }
    // 加護給的 AC（combat 叫）：魔法防禦穿上防具就結束
    wardAC() {
      const w = this.player.ward;
      if (!w) return 0;
      if (FE.SPELLS[w.id].unarmored && this.armored()) {
        this.endWard('你穿上了防具，魔法防禦散掉了。');
        return 0;
      }
      return w.ac;
    }
    // 被打中一次（combat 叫）：守護數次數
    wardHit() {
      const w = this.player.ward;
      if (!w || w.hits == null) return;
      w.hits--;
      if (w.hits <= 0) this.endWard(`${FE.SPELLS[w.id].name}擋到極限，散掉了。`);
    }
    // 加護結束：生命上限扣回去，目前生命最少留 1
    endWard(text) {
      const p = this.player;
      const w = p.ward;
      if (!w) return;
      p.ward = null;
      if (w.hp) {
        p.maxHp -= w.hp;
        p.hp = Math.max(1, Math.min(p.hp, p.maxHp));
      }
      this.say(text || `${FE.SPELLS[w.id].name}的效果結束了。`, 'sys');
    }

    // 脫下裝備（第三十一版）：主手、副手、身上的那一件放回背包，算一個動作（跟穿上一樣）
    unequip(slot) {
      const p = this.player;
      const g = p.equip[slot];
      if (!g) {
        this.say('那裡沒有東西可以脫。', 'sys');
        return false;
      }
      this.beginAction();
      p.equip[slot] = null;
      if (slot === 'off') p.block = null;
      this.bagAddGear(g);
      this.say(`你${slot === 'body' ? '脫下' : '放下'}了${FE.Gear.name(g)}，收進背包。`, 'sys');
      this.endTurn(false);
      return true;
    }

    // 射向這隻怪物的箭撿回一半（捨去，照射出去的品質放回背包）：牠倒下、或冒險者脫離戰鬥時
    recoverArrows(m) {
      for (const [field, id] of [['arrows', 'arrow'], ['bolts', 'bolt']]) {
        const spent = m[field];
        m[field] = null;
        if (!spent) continue;
        const total = Object.values(spent).reduce((s, n) => s + n, 0);
        let back = Math.floor(total * C.ARROW_BACK);
        if (back <= 0) continue;
        const n0 = back;
        // 品質高的先撿回
        for (const q of Object.keys(spent).map(Number).sort((a, b) => b - a)) {
          const k = Math.min(back, spent[q]);
          if (k > 0) this.bagAdd(id, k, { q });
          back -= k;
        }
        this.say(`你撿回了 ${n0} 支${FE.GEAR[id].name}（射出 ${total} 支）。`, 'sys');
      }
    }

    // 走到有東西的那一格（擲出去的武器）就撿回來：主手空著就拿在主手，不然放進背包（不算動作）
    pickUp(x, y) {
      const p = this.player;
      const here = this.world.itemsAt(x, y);
      if (!here.length) return;
      this.world.items = this.world.items.filter((it) => !here.includes(it));
      for (const it of here) {
        if (!p.equip.main && FE.Gear.def(it.gear).cat === 'weapon') {
          p.equip.main = it.gear;
          if (FE.Gear.twoHanded(p, it.gear) && p.equip.off) {
            this.bagAddGear(p.equip.off);
            p.equip.off = null;
            p.block = null;
          }
          this.say(`你撿回了${FE.Gear.name(it.gear)}，拿在手上。`, 'good');
        } else {
          this.bagAddGear(it.gear);
          this.say(`你撿回了${FE.Gear.name(it.gear)}，收進背包。`, 'good');
        }
      }
    }

    // 牧師、聖騎士按 4：治療自己，回 1d8＋修正值（牧師加感知、聖騎士加魅力，最少 1），冷卻 3 回合，算一個動作
    heal() {
      const p = this.player;
      if (!FE.Char.cls(p).heal) {
        this.say('只有牧師和聖騎士會治療。', 'sys');
        return;
      }
      if (this.battle.healCd > 0) {
        this.say(`治療還要 ${this.battle.healCd} 回合才能再用。`, 'sys');
        return;
      }
      if (p.hp >= p.maxHp) {
        this.say('生命是滿的，不用治療。', 'sys');
        return;
      }
      this.beginAction();
      this.battle.healCd = C.HEAL_COOLDOWN;
      // 治療加哪一項屬性的修正值看職業：牧師加感知，聖騎士加魅力
      const got = Math.min(p.maxHp - p.hp, Math.max(1, FE.rollDice(this.rng, C.HEAL_DIE, 1) + FE.Char.attrMod(p, FE.Char.cls(p).healAttr || 'cha')));
      p.hp += got;
      this.say(`你低聲祈禱，傷口癒合了，生命回復 ${got}。`, 'good');
      this.endTurn(false);
    }

    // 戰士拿盾牌按 5：盾擊目前的目標，1d4 鈍擊＋力量修正值，算一個動作；沒有精通、不算技能
    bash() {
      const p = this.player;
      if (!FE.Char.cls(p).bash) {
        this.say('只有戰士會用盾牌撞人。', 'sys');
        return;
      }
      if (!FE.Gear.shieldOf(p)) {
        this.say('副手要拿著盾牌才能盾擊。', 'sys');
        return;
      }
      const m = this.targetMonster();
      if (!m) {
        this.say('旁邊沒有怪物可以打。', 'sys');
        return;
      }
      if (this.world.inVillage(p.x, p.y)) {
        this.say('在村莊和城鎮裡不能動手，先走出去。', 'sys');
        return;
      }
      this.beginAction();
      this.battle.targetId = m.id;
      this.earn(C.COMPUTE_PER_ATTACK);
      FE.Combat.resolveAttack(this, p, m, 'attack', { mode: 'bash' });
      this.endTurn(false, FE.Char.attackTicks(p, null));
    }

    // 被怪物的異常扭曲過的地面（氣候錯位、斷崖影響的格子）很難走
    isHardGround(x, y) {
      const hit = (m) => (m.type === 'TERRAIN' || m.type === 'CLIFF') && m.cells.some(([cx, cy]) => cx === x && cy === y);
      return this.monsters.some((m) => hit(m) || (m.members && m.members.some(hit)));
    }

    // 休息（第三十版）。旁邊有怪物時不能休息；休息一次只把修補力存起來（不進創世力）。
    // 野外短休：1 小時（100 刻，世界同步跑 10 回合），回 1d10＋體質修正值（最少 1），不花錢；途中有怪物貼上來就被打斷，沒回生命。
    // 聚落裡長休：8 小時（800 刻，世界同步跑 80 回合），生命回滿、力竭 −1，付生活開支（見 payLiving）
    // lv：在聚落住一晚選的生活水準（0 荒蕪～這個聚落的經濟等級）；沒給就照聚落的經濟、付不起就住最便宜的（機器人用）
    rest(lv) {
      if (this.adjacentMonsters().length) {
        this.say('旁邊有怪物，沒辦法休息。', 'sys');
        return;
      }
      this.beginAction();
      const p = this.player;
      const v = this.world.villageAt(p.x, p.y);
      this.earn(C.REST_COMPUTE, { repairOnly: true });
      if (v) {
        const paid = this.payLiving(v, lv);
        this.endTurn(false, C.LONG_REST_TICKS, { exact: true, sleep: true });
        this.rested();
        this.say(`你在${v.name}睡了一晚（${paid}），生命回滿。${p.exhaust ? `還有點累（力竭 ${p.exhaust}）。` : ''}`, 'good');
        return;
      }
      FE.Stability.stat(this).shortRests++;
      const spent = this.endTurn(false, C.SHORT_REST_TICKS, { exact: true, interrupt: () => this.adjacentMonsters().length > 0 });
      if (spent < C.SHORT_REST_TICKS || this.adjacentMonsters().length) {
        this.say(`休息被怪物打斷了（歇了 ${spent} 刻）。`, 'bad');
        return;
      }
      const heal = Math.max(1, FE.rollDice(this.rng, C.SHORT_REST_DIE, 1) + FE.Char.attrMod(p, 'con'));
      const got = Math.min(heal, p.maxHp - p.hp);
      p.hp += got;
      this.say(`你歇了一個小時，生命回復 ${got}。`, 'sys');
    }

    // 長休付生活開支：荒蕪 3 銀，沒有加成；貧窮 6 銀，身上裝備的耐久回 3%；
    // 普通 15 銀，耐久回 5%、這個聚落的委託獎勵 +5%；繁盛（與富裕）30 銀，耐久回 10%、委託獎勵 +10%。
    // 第三十二版：玩家在選項視窗選生活水準（最高到這個聚落的經濟等級，付不起的不能選）；最便宜的一級永遠能選，錢不夠就付身上全部。
    // 沒給 want（機器人）就照聚落的經濟、付不起就住最便宜的。回傳一句付了什麼
    payLiving(v, want) {
      const p = this.player;
      const tier = v.steading ? v.steading.prosperity : 0;
      let lv = want === undefined ? tier : Math.max(0, Math.min(tier, want));
      if (want === undefined && p.copper < C.LIVING_COST[lv] * C.SILVER) lv = 0;
      if (lv > 0 && p.copper < C.LIVING_COST[lv] * C.SILVER) lv = 0;
      const paid = Math.min(p.copper, C.LIVING_COST[lv] * C.SILVER);
      p.copper -= paid;
      const st = FE.Stability.stat(this);
      st.restPaid += paid;
      // 身上的裝備耐久回幾成（四捨五入，至少 1 點）
      const rate = C.LIVING_REPAIR[lv];
      let fixed = 0;
      if (rate > 0) {
        for (const g of FE.Gear.equipped(p)) {
          if (g.dur >= g.max) continue;
          g.dur = Math.min(g.max, g.dur + Math.max(1, Math.round(g.max * rate)));
          FE.Gear.repaired(g);
          fixed++;
        }
      }
      const bonus = C.LIVING_QUEST[lv];
      p.lodging = bonus > 0 ? { villageId: v.id, bonus } : null;
      this.spend(v, paid);
      const level = FE.PROSPERITY[lv];
      const head = `${level}的生活，付了 ${FE.money(paid)}`;
      return head + (fixed ? '，身上的裝備也順手整理了一下' : '') + (bonus > 0 ? `，這裡的委託獎勵 +${Math.round(bonus * 100)}%` : '');
    }

    // 開寶箱：錢拆成三種幣（總值不變，見 coins），硬幣沒有重量
    openChest(chest) {
      const p = this.player;
      const copper = Math.max(0, chest.copper | 0);
      p.copper += copper;
      this.world.chests = this.world.chests.filter((c) => c !== chest);
      this.say(`打開寶箱：${this.coins(copper, chest.small)}。`, 'good');
      // 25% 機率多開出一件裝備（品質普通～傑作，每高一級機率減半），放進背包
      if (this.rng() < C.CHEST_GEAR) {
        const g = FE.Gear.randomDrop(this, 0, 5);
        this.bagAddGear(g);
        this.say(`寶箱裡還有${FE.Gear.lootName(g)}，你收進了背包。`, 'good');
      }
    }

    // 掉落的錢拆成三種幣（總值不變，第三十版）：小怪物的多銅與銀（銀佔四到七成），中型怪物與寶箱的多銀（九成）、偶爾有金
    // （夠 1 金時三成機率，金佔三成左右）。回傳「1 金 12 銀 7 銅」這樣的寫法（幣數照實寫，不換算；零的省略）
    coins(copper, small) {
      let g = 0;
      let s;
      if (small) s = Math.floor((copper * (0.4 + 0.3 * this.rng())) / C.SILVER);
      else {
        if (copper >= C.GOLD && this.rng() < 0.3) g = Math.max(1, Math.floor((copper * 0.3) / C.GOLD));
        s = Math.floor(((copper - g * C.GOLD) * 0.9) / C.SILVER);
      }
      const c = copper - g * C.GOLD - s * C.SILVER;
      const parts = [g ? `${g} 金` : '', s ? `${s} 銀` : '', c ? `${c} 銅` : ''].filter(Boolean);
      return parts.length ? parts.join(' ') : '裡面沒有錢';
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
    // 第三十版：委託分清除、送貨、採藥、採礦四種，每種同時只能接一個。同一個人身上可能同時有好幾件事
    // （他是你送貨的收貨人、你接了他的採藥委託、他自己又有新的委託），選項一起列出來：先交件與回報，再接委託
    talkOptions(npc) {
      const p = this.player;
      const q = npc.quest;
      const jobs = p.jobs;
      const v = this.world.villageById(npc.villageId);
      const leave = { id: 'leave', label: '離開' };
      const shop = FE.Gear.shopOf(npc, v);
      const race = FE.PLAYER_RACES[FE.npcRace(this.world, npc)].name;
      const out = (text, options) => ({
        name: npc.name,
        role: `${shop ? FE.Gear.SHOPS[shop].title : npc.role === 'soldier' ? '士兵' : '村民'}・${race}`,
        village: v ? v.name : '',
        text,
        options,
      });
      // 士兵只有一句閒話
      if (npc.role === 'soldier') return out(FE.SOLDIER_LINES[(npc.id + this.turn) % FE.SOLDIER_LINES.length], [leave]);
      // 工匠：買、修、打造、賣礦石、賣裝備（分層，見 shopTalk）
      if (shop) return out(...this.shopTalk(npc, v, shop));
      const reward = (o, vid) => `經驗值 +${o.exp}、${FE.money(this.questPay(o, vid))}`;
      const texts = [];
      const opts = [];
      // 清除委託：清完回來找委託人回報
      const h = jobs.hunt;
      if (h && h.giverId === npc.id) {
        const left = this.huntRemaining(h.monsterIds);
        if (left > 0) texts.push(`附近還有 ${left} 隻小怪物，拜託了。`);
        else {
          texts.push('村子外面安靜多了，謝謝你。');
          opts.push({ id: 'report', label: '回報，領取獎勵', note: reward(h, h.villageId) });
        }
      }
      // 送貨：收貨人身上自己也有委託時，貨照樣交得出去
      const d = jobs.deliver;
      const goods = this.goodsFor(d);
      if (d && d.targetId === npc.id && goods) {
        texts.push(`你是把${goods.name}送來的人吧？`);
        opts.push({ id: 'deliver', label: '交給他', note: reward(d, d.villageId) });
      }
      // 採藥、採礦：背包裡的夠了就交（舊的也能交）
      for (const kind of ['herb', 'ore']) {
        const j = jobs[kind];
        if (!j || j.giverId !== npc.id) continue;
        const unit = kind === 'herb' ? '份藥草' : '顆礦石';
        const have = this.bagCount(kind);
        if (have >= j.n) {
          texts.push(`${j.n} ${unit}帶來了嗎？`);
          opts.push({ id: 'hand:' + kind, label: `交出 ${j.n} ${unit}`, note: reward(j, j.villageId) });
        } else texts.push(`還差 ${j.n - have} ${unit}，拜託了。`);
      }
      // 他自己的委託
      if (q && !q.done) {
        const kind = q.kind || 'deliver';
        const mine = jobs[kind] && jobs[kind].giverId === npc.id;
        if (!q.accepted) {
          if (jobs[kind]) texts.push(`你手上已經有${FE.JOB_NAMES[kind]}委託了，辦完再來找我。`);
          else {
            texts.push(this.questLine(npc, q));
            opts.push({ id: 'accept', label: '接下', note: reward(q, npc.villageId) }, { id: 'decline', label: '不接' });
          }
        } else if (!mine && !texts.length) texts.push('委託已經有人在辦了。');
        else if (kind === 'deliver' && mine && !texts.length) texts.push(`${q.targetVillage}的${q.targetName}還在等${q.item}。`);
      }
      // 沒事就是閒話：用村民的 id 和回合數挑，對話開著時不會變
      if (!texts.length) texts.push(FE.IDLE_LINES[(npc.id + this.turn) % FE.IDLE_LINES.length]);
      if (!opts.some((o) => o.id === 'decline')) opts.push(leave);
      return out(texts.join(''), opts);
    }

    // 委託人開口請託的那句話
    questLine(npc, q) {
      const kind = q.kind || 'deliver';
      if (kind === 'hunt') return `${q.village}附近冒出了 ${q.total} 隻小怪物，可以幫忙清掉嗎？清完回來找我。`;
      if (kind === 'herb') return `我需要 ${q.n} 份藥草，可以幫我採來嗎？舊的也行。`;
      if (kind === 'ore') return `我需要 ${q.n} 顆礦石，可以幫我挖來嗎？`;
      return FE.fill(q.line, { giver: npc.name, target: q.targetName, village: q.targetVillage, item: q.item }).replace(/^[^：]*：/, '');
    }

    // 完成一件委託：拿錢與經驗值、算力（一半創世力、一半修補力），委託人的聚落經濟值 +3
    finishJob(npc, c, head) {
      const p = this.player;
      const pay = this.questPay(c, c.villageId);
      this.say(`${head}：經驗值 +${c.exp}、${FE.money(pay)}。`, 'good');
      p.copper += pay;
      p.jobs[c.kind] = null;
      FE.Stability.stat(this).jobs[c.kind]++;
      this.addExp(c.exp);
      this.earn(c.compute); // 完成委託的算力
      const v = this.world.villageById(c.villageId);
      if (v) this.econ(v, C.ECON_QUEST);
    }

    // 選第 i 個選項；回傳 { close } 說明對話要不要關。不接的委託留在村民身上，之後回來還接得到
    choose(npc, i) {
      const t = this.talkOptions(npc);
      const o = t.options[i];
      if (!o) return { close: false };
      const p = this.player;
      const q = npc.quest;
      const jobs = p.jobs;
      let close = true;
      if (FE.Gear.shopOf(npc, this.world.villageById(npc.villageId))) {
        const r = this.shopChoose(npc, o);
        if (r.close) this.talking = null;
        return r;
      }
      if (o.id === 'report') {
        const c = jobs.hunt;
        if (q && q.kind === 'hunt') q.done = true;
        this.say(`${npc.name}：村子外面安靜多了，謝謝你。`, 'npc');
        this.finishJob(npc, c, '委託完成');
      } else if (o.id === 'deliver') {
        const c = jobs.deliver;
        const giver = this.world.npcById(c.giverId);
        if (giver && giver.quest && (giver.quest.kind || 'deliver') === 'deliver') giver.quest.done = true;
        const item = this.goodsFor(c).name;
        this.bagTake('goods', 1, c.giverId); // 從背包拿出來交給他
        this.say(`${npc.name}：謝謝你把${item}送來。`, 'npc');
        this.finishJob(npc, c, '任務完成');
      } else if (o.id.startsWith('hand:')) {
        const kind = o.id.slice(5);
        const c = jobs[kind];
        if (q && q.kind === kind) q.done = true;
        this.bagTake(kind, c.n); // 交的是背包裡的（舊的也算）
        this.say(`${npc.name}：${kind === 'herb' ? '藥草' : '礦石'}收到了，謝謝你。`, 'npc');
        this.finishJob(npc, c, '委託完成');
      } else if (o.id === 'accept') {
        const kind = q.kind || 'deliver';
        q.accepted = true;
        const base = { kind, giverId: npc.id, villageId: npc.villageId, exp: q.exp, copper: q.copper, compute: q.compute };
        if (kind === 'hunt') {
          jobs.hunt = Object.assign(base, { monsterIds: q.monsterIds, total: q.total, village: q.village });
        } else if (kind === 'deliver') {
          // 委託資料記在手上，要送的東西放進背包
          jobs.deliver = Object.assign(base, { targetId: q.targetId, targetName: q.targetName, targetVillage: q.targetVillage, steps: q.steps });
          this.bagAdd('goods', 1, { name: q.item, giverId: npc.id });
        } else {
          jobs[kind] = Object.assign(base, { n: q.n, village: q.village });
        }
        this.say(`${npc.name}：${this.questLine(npc, q)}`, 'npc');
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
    // 賣回＝半價×剩餘耐久比例；礦石一顆 5 銀；打造要礦石加原價一半的工錢，品質在聚落的範圍內隨機（每高一級機率減半）。
    // 錢一律用銅記帳（第三十版），畫面寫成「1 金 2 銀 3 銅」；在這裡買、修、打造花的錢算進這個聚落的經濟值（spend）

    // 上一層：「買」只有一類東西時，那一類就是第一層，返回直接回最上層
    parentPage(S, page) {
      const parts = page.split(':');
      if (parts.length >= 3) return `buy:${parts[1]}`;
      if (parts[0] === 'buy' && parts.length === 2) return Object.keys(S.buy).length === 1 ? 'main' : 'buy';
      if (parts[0] === 'craft' && parts.length === 2) return Object.keys(FE.Gear.craftCats(S)).length === 1 ? 'main' : 'craft';
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
    shortText(copper, ore) {
      const s = [copper > 0 ? FE.money(copper) : '', ore > 0 ? `${ore} 顆礦石` : ''].filter(Boolean).join('、');
      return s ? `還差 ${s}` : '';
    }

    // 工匠對話目前這一層的內容：回傳 [text, options]
    shopTalk(npc, v, shopKey) {
      const p = this.player;
      const S = FE.Gear.SHOPS[shopKey];
      const back = { id: 'back', label: '返回' };
      const have = `你身上有 ${FE.money(p.copper)}、${this.bagCount('ore')} 顆礦石。`;
      const MAX = 8; // 一層最多列幾項（加上「返回」不超過 9，才按得到）
      let page = this.talkPage || 'main';
      if (page === 'buy' && Object.keys(S.buy).length === 1) page = 'buy:' + Object.keys(S.buy)[0];
      const cha = this.chaMod(); // 魅力：買東西每點修正值 −5%，賣東西 +5%
      const price = (e) => FE.Gear.shopPrice(e.type, e.q, v, cha);
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
            { id: 'sellOre', label: '賣礦石', note: ore ? `${ore} 顆，+${FE.money(FE.Gear.orePrice(ore, cha))}` : '沒有礦石', disabled: !ore },
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
          const short = pr - p.copper;
          opts.push({
            id: `buyItem:${e.type}:${e.q}`,
            label: `${gname(e)}（${FE.Gear.statText(e)}）`,
            note: short > 0 ? this.shortText(short, 0) : FE.money(pr),
            disabled: short > 0,
          });
        }
        opts.push(back);
        return [`${FE.Gear.CAT_NAMES[cat]}。${have}`, opts];
      }

      if (page === 'repair') {
        const list = this.allGear().filter((g) => S.repair.includes(FE.GEAR[g.type].cat) && g.dur < g.max).slice(0, MAX);
        const opts = list.map((g) => {
          const qt = FE.Gear.repairQuote(g, v, cha);
          const short = qt.cost - p.copper;
          const worn = p.equip.main === g || p.equip.off === g || p.equip.body === g ? '（穿著）' : '';
          return {
            id: `repairItem:${g.id}`,
            label: `修${FE.Gear.name(g)}${worn}`,
            note: short > 0 ? `${FE.Gear.durText(g)}，${this.shortText(short, 0)}` : `${FE.Gear.durText(g)}，修回 ${qt.restore} 點，${FE.money(qt.cost)}`,
            disabled: short > 0,
          };
        });
        opts.push(back);
        const how = '我能修到完整。';
        return [list.length ? `${how}${have}` : '沒有要修的東西。', opts];
      }

      if (page === 'craft' || page.startsWith('craft:')) {
        // 打造的東西也分類（跟「買」同一套分類，一層最多 8 項）；只有一類時直接列
        const cats = FE.Gear.craftCats(S);
        const keys = Object.keys(cats);
        const cat = page === 'craft' ? (keys.length === 1 ? keys[0] : null) : page.split(':')[1];
        if (!cat || !cats[cat]) {
          return [`要打造哪一類？${have}`, keys.map((c) => ({ id: `craftCat:${c}`, label: FE.Gear.CAT_NAMES[c] })).concat([back])];
        }
        const opts = cats[cat].map((type) => {
          const qt = FE.Gear.craftQuote(type, v, cha);
          const lackOre = qt.ore - this.bagCount('ore');
          const lackGold = qt.fee - p.copper;
          const lack = this.shortText(lackGold, lackOre);
          const lo = FE.QUALITIES[qt.range[0]];
          const hi = FE.QUALITIES[qt.range[1]];
          const ql = (qq) => `${qq.sym}${qq.name}${qq.sym}`;
          return {
            id: `craftItem:${type}`,
            label: `打造${FE.GEAR[type].name}（${FE.Gear.statText({ type, q: 0 })}）`,
            note: lack || `${qt.ore} 顆礦石、${FE.money(qt.fee)}，品質${ql(lo)}～${ql(hi)}`,
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
          note: `${FE.Gear.durText(e.gear)}，+${FE.money(FE.Gear.sellPrice(e.gear, cha))}`,
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
        const cats = Object.keys(FE.Gear.craftCats(S));
        this.talkPage = this.parentPage(S, this.talkPage === 'buy' && Object.keys(S.buy).length === 1 ? 'buy:' + Object.keys(S.buy)[0] : this.talkPage === 'craft' && cats.length === 1 ? 'craft:' + cats[0] : this.talkPage);
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
      if (o.id.startsWith('craftCat:')) {
        this.talkPage = 'craft:' + o.id.slice(9);
        return stay;
      }
      if (o.id.startsWith('qual:')) {
        const [, cat, q] = o.id.split(':');
        this.talkPage = `buy:${cat}:${q}`;
        return stay;
      }
      const [kind, a, b] = o.id.split(':');
      const cha = this.chaMod();
      if (kind === 'sellOre') {
        const n = this.bagCount('ore');
        const gain = FE.Gear.orePrice(n, cha);
        this.bagTake('ore', n);
        p.copper += gain;
        this.say(`${npc.name}收下 ${n} 顆礦石，給了你 ${FE.money(gain)}。`, 'good');
      } else if (kind === 'buyItem') {
        const type = a;
        const q = Number(b);
        const pr = FE.Gear.shopPrice(type, q, v, cha);
        if (p.copper < pr) return stay;
        p.copper -= pr;
        const g = FE.Gear.make(type, q, this.nextGearId++);
        this.bagAddGear(g);
        this.say(`${npc.name}賣給你${FE.Gear.lootName(g).replace(/^一件/, '')}，花了 ${FE.money(pr)}。${type === 'pick' ? '礦坑裡的礦脈挖得動了。' : type === 'sickle' ? '森林裡的藥草割得下來了。' : ''}`, 'good');
        this.spend(v, pr);
      } else if (kind === 'repairItem') {
        const g = this.allGear().find((x) => x.id === Number(a));
        if (!g || !S.repair.includes(FE.GEAR[g.type].cat) || g.dur >= g.max) return stay;
        const qt = FE.Gear.repairQuote(g, v, cha);
        if (p.copper < qt.cost) return stay;
        p.copper -= qt.cost;
        g.dur += qt.restore;
        FE.Gear.repaired(g);
        this.say(`${npc.name}修好了你的${FE.Gear.name(g)}（${FE.Gear.durText(g)}），花了 ${FE.money(qt.cost)}。`, 'good');
        this.spend(v, qt.cost);
      } else if (kind === 'craftItem') {
        const qt = FE.Gear.craftQuote(a, v, cha);
        if (!S.craft.includes(a) || p.copper < qt.fee || this.bagCount('ore') < qt.ore) return stay;
        this.bagTake('ore', qt.ore);
        p.copper -= qt.fee;
        const g = FE.Gear.make(a, FE.Gear.rollQuality(this.rng, qt.range[0], qt.range[1]), this.nextGearId++);
        this.bagAddGear(g);
        this.say(`${npc.name}用 ${qt.ore} 顆礦石打造了${FE.Gear.name(g)}，工錢 ${FE.money(qt.fee)}，放進了你的背包。`, 'good');
        this.spend(v, qt.fee);
      } else if (kind === 'sellItem') {
        const e = p.bag.find((x) => x.id === 'gear' && x.gear.id === Number(a));
        if (!e || !S.sell.includes(FE.GEAR[e.gear.type].cat)) return stay;
        const gain = FE.Gear.sellPrice(e.gear, cha);
        p.bag = p.bag.filter((x) => x !== e);
        p.copper += gain;
        this.say(`${npc.name}收下了你的${FE.Gear.name(e.gear)}，給了你 ${FE.money(gain)}。`, 'good');
      }
      return stay;
    }

    // ---- 回合制戰鬥 ----
    // 攻防判定在 combat.js。方向鍵撞上怪物只設成目標（不出手、不算動作）；按 1、2 打目前的目標（要貼著）；3 逃跑。

    // 逃跑要去的地方：從冒險者走得到、最多 steps 步內（不穿過水、巨石、斷崖、怪物與人），離所有怪物都 2 格以上的格子裡，挑離怪物最遠的；
    // 一樣遠就挑走得少的。走得到的不到 2 步就算沒有退路
    findRetreat(steps) {
      const w = this.world;
      const p = this.player;
      const dist = new Map([[p.x + ',' + p.y, 0]]);
      const q = [[p.x, p.y]];
      let best = null;
      for (let h = 0; h < q.length; h++) {
        const [x, y] = q[h];
        const d = dist.get(x + ',' + y);
        const near = this.monsters.length ? Math.min(...this.monsters.map((o) => Math.max(Math.abs(o.x - x), Math.abs(o.y - y)))) : 99;
        if (d >= 2 && near >= 2 && !w.chestAt(x, y) && (!best || near > best.near || (near === best.near && d < best.d))) best = { x, y, d, near };
        if (d >= steps) continue;
        for (const [dx, dy] of DIRS) {
          const nx = x + dx;
          const ny = y + dy;
          const k = nx + ',' + ny;
          if (dist.has(k) || !w.canStep(x, y, nx, ny) || this.monsterAt(nx, ny) || w.npcAt(nx, ny) || this.soldierAt(nx, ny)) continue;
          dist.set(k, d + 1);
          q.push([nx, ny]);
        }
      }
      return best;
    }

    // 按 3 逃跑（第三十一版，取代撤退與撤離）：擲成功率（敏捷越高越容易，貼身的怪物越多越難），算一個動作。
    // 成功就直接移到離所有怪物 2 格以上的地方（最多 2＋敏捷修正值格，2～5），一路上不會被趁機攻擊、也甩掉纏上的目標，花的刻照走的格數；
    // 失敗就留在原地，這一回合照常過（貼身的怪物照樣出手）。四周沒有退路時只出訊息，不算動作
    flee() {
      const adj = this.adjacentMonsters();
      if (!adj.length) {
        this.say('旁邊沒有怪物，不需要逃跑。', 'sys');
        return;
      }
      // 超過推拖上限：跑不動
      if (this.loadTier() >= 2) {
        this.say(`你背得太重了（${this.weight()} / ${this.carryLimit()}），跑不動。先丟掉一些東西（按 B 打開背包，選「丟掉」）。`, 'sys');
        return;
      }
      const p = this.player;
      const dex = FE.Char.attrMod(p, 'dex');
      const steps = Math.max(C.FLEE_STEPS[0], Math.min(C.FLEE_STEPS[1], C.FLEE_STEPS[0] + dex));
      const spot = this.findRetreat(steps);
      if (!spot) {
        this.say('四周沒有退路，逃不掉。', 'sys');
        return;
      }
      const chance = Math.max(C.FLEE_MIN, Math.min(C.FLEE_MAX, C.FLEE_BASE + C.FLEE_DEX * dex - C.FLEE_SURROUND * (adj.length - 1)));
      this.beginAction();
      if (this.rng() >= chance) {
        this.say(`逃跑失敗！（成功率 ${Math.round(chance * 100)}%）`, 'bad');
        this.endTurn(false);
        return;
      }
      p.x = spot.x;
      p.y = spot.y;
      this.battle.targetId = null;
      for (const m of adj) {
        m.chase = 0;
        m.chaseSteps = 0;
        if (m.small) m.returning = true;
      }
      this.discover();
      this.say(`你逃開了 ${spot.d} 格。`, 'sys');
      this.endTurn(false, Math.round(FE.Char.moveTicks(p) * FE.Char.exhaustMoveMul(p)) * spot.d);
    }

    // 按鍵 1、2、3、4、5：一般攻擊、重擊、撤退、治療（牧師）、盾擊（戰士），打目前的目標；F 是遠程（見 aimStart）
    act(kind) {
      if (kind === 'flee') {
        this.flee();
        return;
      }
      if (kind === 'heal') {
        this.heal();
        return;
      }
      if (kind === 'bash') {
        this.bash();
        return;
      }
      if (kind === 'fire') {
        this.aimStart();
        return;
      }
      if (kind === 'throw') {
        this.aimStart('throw');
        return;
      }
      let m = this.targetMonster();
      // 觸及：按 1 時旁邊沒有目標，打直線 2 格外的目標
      const reach = !m && kind === 'attack' ? this.reachTarget() : null;
      if (!m && !reach) {
        this.say('旁邊沒有怪物可以打。', 'sys');
        return;
      }
      if (kind === 'deep' && this.battle.cooldown > 0) {
        this.say(`重擊還要 ${this.battle.cooldown} 回合才能再用。`, 'sys');
        return;
      }
      if (reach) this.strike(kind, reach, { reach: true });
      else this.strike(kind, m);
    }

    // 倒下後在離倒下的地方最近的聚落（村莊或城鎮，不看神聖與否）醒來，沒有聚落才回出生點。
    // 醒來也算一次長休（世界跑 80 回合、不收錢），在這個動作收尾時做（afterTurn）
    die(m) {
      this.fell = true;
      this.battle.targetId = null;
      const where = this.wakeSpot();
      this.say(`你倒下了，在${where}重新醒來。${m.name}的血量還剩 ${m.hp} / ${m.maxHp}，不會回復。`, 'bad');
    }

    // 把冒險者放到離他最近的聚落（中央附近的路上）醒來，生命回滿；回傳地名
    wakeSpot() {
      const p = this.player;
      const w = this.world;
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
      return where;
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
      if (m.arrows || m.bolts) this.recoverArrows(m); // 射向牠的箭、弩矢撿回一半
      // 第三十二版：一群共用一處錯誤，全群倒下才修好
      const left = m.group ? this.monsters.filter((o) => o.group === m.group).length : 0;
      const repair = (opts) => {
        if (left) return `這一群還剩 ${left} 隻，全倒下才修得好。`;
        this.calmAt(m.home ? m.home.x : m.x, m.home ? m.home.y : m.y); // 這一帶 5～7 天不再生怪物
        const camp = m.group ? this.siteCleared(m.group) : '';
        const fix = FE.repairBug(this, m, opts) + camp;
        if (m.campaign != null && !this.monsters.some((o) => o.campaign === m.campaign)) this.campaignCleared(m.campaign);
        return fix;
      };
      if (by) {
        const fix = repair({ noExp: true });
        FE.Stability.stat(this).soldierKills++;
        if (Math.abs(m.x - this.player.x) + Math.abs(m.y - this.player.y) <= C.SIGHT * 2) this.say(`士兵打倒了${m.name}。${fix}`, 'world');
        FE.Stability.update(this);
        return;
      }
      const fix = repair();
      // 經驗值與打倒怪物的算力，打倒後一次結算
      this.say(`${m.name}倒下了，經驗值 +${m.exp}。${fix}`, 'good');
      this.dropChest(m);
      this.dropGear(m);
      this.addExp(m.exp);
      this.earn(m.compute);
      const c = this.player.jobs.hunt;
      if (c) {
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

    // 創世時的中型怪物與合體生出的中型怪物（不是衰敗生的 m.small），打倒時 30% 機率多掉一件裝備，
    // 品質做工好～優秀（每高一級機率減半），直接放進背包
    dropGear(m) {
      if (m.tier !== 'mid' || m.small || this.rng() >= C.DROP_MID_GEAR) return;
      const g = FE.Gear.randomDrop(this, 1, 3);
      this.bagAddGear(g);
      this.say(`${m.name}身上掉出${FE.Gear.lootName(g)}，你收進了背包。`, 'good');
    }

    // 掉寶箱：會追人的怪物（m.small）20% 機率掉、錢少；其他怪物 50% 機率掉，影響範圍越大錢越多。
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
      gold = Math.round(gold * C.CHEST_GOLD_MUL); // 所有寶箱的錢減半（單位是銀，存成銅）
      const w = this.world;
      let at = { x: m.x, y: m.y };
      if (w.chestAt(at.x, at.y) || w.inVillage(at.x, at.y) || !w.passable(at.x, at.y)) at = this.findFreeNear(m.x, m.y);
      if (!at) return;
      w.chests.push(Object.assign({ id: w.nextId++, x: at.x, y: at.y, copper: gold * C.SILVER }, m.small ? { small: true } : {}));
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
