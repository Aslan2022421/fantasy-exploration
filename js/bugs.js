// 怪物：程式裡叫 BUG，遊戲內文字一律叫怪物。種族看環境（config.js 的 RACES），
// 錯誤種類是牠身上的異常，決定行為、抗性與閃爍方式；影響範圍決定強度與經驗值。
// 血條歸零時呼叫 repairBug 修世界。
(function () {
  // 遊戲內的字（name、desc）只寫世界裡看得到的現象，不寫程式用語；
  // 程式裡的種類代碼（TERRAIN、VALUE⋯⋯）對應的程式錯誤寫在旁邊的註解。
  // name 是異常的名字；glyphs 是異常發作時閃出來的字元；resist：對哪一種招式有抗性（傷害減半），主手武器的清除等級（品質，見 FE.QUALITIES）到 until 就不再減半；
  // def 是攻防判定（combat.js）裡的防禦：dodge 閃避、counter 反擊、block 格擋機率、blockMax 格擋值上限，沒寫的是 0
  FE.BUG_TYPES = {
    // 生態區冷熱直接相鄰
    TERRAIN: {
      name: '氣候錯位',
      glyphs: ['*', ':', '*', ':', '%'],
      desc: '冷熱兩地硬生生接在一起，周圍的空氣扭曲不定。',
      hpMul: 1,
      atkMod: 0,
      resist: null,
      def: { dodge: 0.05, counter: 0.1 },
    },
    // 走不到的區域
    UNREACHABLE: {
      name: '斷層',
      glyphs: ['%', '%', '&', '%', '#'],
      desc: '大地裂出一道斷層，把一塊土地跟世界隔開了。',
      hpMul: 1.3,
      atkMod: -1,
      resist: { kind: 'attack', until: 2 },
      def: { block: 0.4, blockMax: 6 },
    },
    // 寶箱金幣算成負數或 NaN
    VALUE: {
      name: '狂亂',
      glyphs: '0123456789'.split(''),
      desc: '牠守著一個被扭曲的寶箱，力氣時強時弱，捉摸不定。',
      hpMul: 0.9,
      atkMod: 0,
      resist: { kind: 'attack', until: 1 },
      def: { counter: 0.2 },
    },
    // 任務指向不存在的村民
    REFERENCE: {
      name: '虛影',
      glyphs: ['?', '?', '¿', '?'],
      desc: '牠纏著一個不在這世上的人，身形虛實不定，很難打中。',
      hpMul: 1,
      atkMod: 0,
      resist: { kind: 'deep', until: 1 },
      def: { dodge: 0.3 },
    },
    // 相鄰兩格高度差 2 以上
    CLIFF: {
      name: '斷崖',
      glyphs: ['▲', '▼', '|', '▲'],
      desc: '地面的高低突然斷開，四周的土地跟著崩落。',
      hpMul: 1.2,
      atkMod: 0,
      resist: null,
      def: { block: 0.2, blockMax: 4 },
    },
    // 執行時抓到的例外或不合法的狀態
    RUNTIME: {
      name: '碎裂',
      glyphs: ['!', '!', '¡', '|'],
      desc: '空間碎裂時留下的殘響。',
      hpMul: 1,
      atkMod: 1,
      resist: null,
      def: { counter: 0.15 },
    },
  };

  FE.KIND_NAMES = { attack: '一般攻擊', deep: '重擊' };

  // 分級（m.tier）：影響範圍 1～4 是小怪物，5 以上是中型怪物，12 以上才是大怪物（只來自世界級事件，第 2 階段才做）。
  // 注意 m.small 不是「小怪物」，是「會追人、會合體」的旗標，只有事件與侵蝕生出的怪物有；
  // 創世時生出的怪物就算影響範圍只有 1，m.small 也是 false，只在自己的 B 點附近徘徊
  const TIER_PREFIX = { small: '', mid: '中型', big: '大型' };

  // 體型：畫面上只顯示體型，不顯示格數
  FE.sizeName = (m) => ({ small: '小', mid: '中', big: '巨大' })[m.tier] || '小';

  // 怪物的名字＝（中型、大型）種族（異常），例如「中型哥布林（狂亂）」
  FE.monsterName = (m) => {
    const race = FE.RACES[m.race] || FE.RACES.goblin;
    return `${TIER_PREFIX[m.tier] || ''}${race.name}（${FE.BUG_TYPES[m.type].name}）`;
  };

  // 攻防判定用的防禦數字：異常本身的數字，中型怪物再高一些，生成當下的世界等級每升一級再加一點
  FE.monsterDef = (m) => {
    const d = FE.BUG_TYPES[m.type].def || {};
    const mid = m.tier === 'mid' || m.tier === 'big' ? FE.CONFIG.MID_DEF : {};
    const up = (m.wl || 1) - 1;
    const B = FE.CONFIG.WL_BONUS;
    return {
      dodge: (d.dodge || 0) + (mid.dodge || 0) + up * B.DODGE,
      counter: d.counter || 0,
      block: (d.block || 0) + (mid.block || 0) + up * B.BLOCK,
      blockMax: (d.blockMax || 0) + (mid.blockMax || 0) + up * B.BLOCK_MAX,
    };
  };

  // 打倒怪物時給的算力（單人份量）：小怪物 3，中型怪物 8＋影響範圍÷2，再乘世界等級的獎勵倍率
  FE.killCompute = (tier, scope, wl) => {
    const C = FE.CONFIG;
    const base = tier === 'small' ? C.COMPUTE_KILL_SMALL : C.COMPUTE_KILL_MID + scope * C.COMPUTE_KILL_MID_PER_SCOPE;
    return Math.round(base * FE.wlScale(wl, C.WL_BONUS.REWARD) * 10) / 10;
  };

  // 士兵的數值：以同世界等級、影響範圍 2 的小怪物為準，血量 ×0.9、攻擊力 －1（至少 1）；不升級
  FE.soldierStats = (wl) => {
    const C = FE.CONFIG;
    const base = FE.makeMonster({ type: 'TERRAIN', x: 0, y: 0, cells: [], scope: C.SOLDIER_BASE_SCOPE }, 0, wl);
    const maxHp = Math.max(1, Math.round(base.maxHp * C.SOLDIER_HP_MUL));
    return { maxHp, hp: maxHp, atk: Math.max(1, base.atk - C.SOLDIER_ATK_MINUS) };
  };

  // 依 B 點所在的環境決定種族，名字跟著改
  FE.dressMonster = (m, world) => {
    const c = world.cell(m.x, m.y);
    m.race = FE.raceFor(c ? c.biome : 'grassland');
    m.name = FE.monsterName(m);
    return m;
  };

  // 這一擊會不會被抗性減半。clear 是主手武器的清除等級（普通 0 ～ 傑作 5、傳說物 6，空手 0）
  FE.isResisted = (m, kind, clear) => {
    const r = FE.BUG_TYPES[m.type].resist;
    return !!r && r.kind === kind && clear < r.until;
  };

  FE.resistText = (m, clear) => {
    const r = FE.BUG_TYPES[m.type].resist;
    if (!r) return '沒有抗性';
    if (clear >= r.until) return `原本抗${FE.KIND_NAMES[r.kind]}，你的武器已經對付得了`;
    const q = FE.QUALITIES[r.until];
    return `${FE.KIND_NAMES[r.kind]}傷害減半（武器要${q.sym}${q.name}${q.sym}以上才不減半）`;
  };

  // wl 是生成當下的世界等級：血量、攻擊力、打倒時的經驗值與算力照等級加成，之後不再變
  FE.makeMonster = function (d, id, wl) {
    const T = FE.BUG_TYPES[d.type];
    const B = FE.CONFIG.WL_BONUS;
    wl = wl || 1;
    // 這一版創世時的大錯也只算中型；大怪物（tier 'big'）要由世界級事件指定，d.tier 是留給第 2 階段用的
    const tier = d.tier || (d.scope >= FE.CONFIG.MID_SCOPE ? 'mid' : 'small');
    const boss = tier === 'big';
    const maxHp = Math.max(1, Math.round(Math.min(100, Math.round((8 + d.scope * 2) * T.hpMul)) * FE.wlScale(wl, B.HP)));
    const atk = Math.max(1, Math.round(Math.max(1, Math.min(8, 2 + Math.floor(Math.sqrt(d.scope)) + T.atkMod)) * FE.wlScale(wl, B.ATK)));
    return {
      id,
      wl,                       // 生成當下的世界等級（防禦加成看它）
      type: d.type,
      x: d.x,
      y: d.y,
      cells: d.cells,
      scope: d.scope,
      data: d.data || {},
      tier,
      boss,                     // 大怪物：打倒時寫進歷史紀錄（這一版不會出現）
      race: 'goblin',
      name: TIER_PREFIX[tier] + T.name, // spawnMonster 會依環境改成「種族（異常）」
      maxHp,
      hp: maxHp,
      atk,
      exp: Math.round((4 + d.scope * 2) * FE.wlScale(wl, B.REWARD)), // 打倒時一次結算
      compute: FE.killCompute(tier, d.scope, wl), // 打倒時給的算力（單人份量，創世門檻也照這個加總）
      home: { x: d.x, y: d.y }, // 徘徊時繞著這一點
      small: false,             // 會追人、會合體的旗標（事件與侵蝕生出的才是），跟 tier 的「小怪物」不同
      block: null,              // 目前的格擋值，第一次需要時補成上限（combat.js）
      chase: 0,                 // 還會追幾回合
      chaseSteps: 0,            // 這一趟已經追了幾步
      returning: false,         // 正在回生成點，途中不追
      returnTurns: 0,
      members: null,            // 合體怪物：原本那幾隻小怪物，打倒時一起修
    };
  };

  FE.progress = (m) => Math.round((1 - m.hp / m.maxHp) * 100);


  // 把被生成器刪掉的村民放回給任務那個人的村莊裡
  function restoreVillager(game, giver, id, name) {
    const w = game.world;
    const v = w.villageById(giver.villageId);
    if (!v) return null;
    // 村莊住滿了就不放，改由現有的村民接手，不然事件一直補人，村莊會擠滿
    const cap = v.kind === 'town' ? FE.CONFIG.TOWN_MAX_NPC : FE.CONFIG.VILLAGE_MAX_NPC;
    if (w.npcs.filter((n) => n.villageId === v.id && !FE.Gear.isShopkeeper(n)).length >= cap) return null;
    // 每個村民有自己的家：沒有空床也不放
    const h = FE.Steading.freeHome(w, game.rng, v);
    if (!h) return null;
    const open = (x, y) =>
      w.villageAt(x, y) === v && w.passable(x, y) && !w.npcAt(x, y) && !w.chestAt(x, y) && !game.isPlayerAt(x, y) && !game.monsterAt(x, y) && !game.soldierAt(x, y);
    // 先放在自己家裡，站不了就放在室外
    let at = open(h.spot[0], h.spot[1]) ? h.spot : null;
    for (let y = v.y0; y <= v.y1 && !at; y++) {
      for (let x = v.x0; x <= v.x1 && !at; x++) if (open(x, y) && FE.Steading.roomAt(v, x, y) < 0) at = [x, y];
    }
    if (!at) return null;
    const npc = { id, name, role: 'villager', villageId: v.id, x: at[0], y: at[1], quest: null, home: { b: h.b, bed: h.bed, spot: h.spot }, mode: 'home' };
    w.npcs.push(npc);
    return npc;
  }

  // 回傳一句說明修了什麼
  // opts.noExp：創世神自己清掉時，修好的副作用不給冒險者經驗值
  FE.repairBug = function (game, m, opts) {
    const w = game.world;
    if (m.members) return m.members.map((o) => FE.repairBug(game, o, opts)).join('');
    // 修好的地形錯位與斷崖記下來，世界動盪時可能復發（stability.js）
    if (m.type === 'TERRAIN' || m.type === 'CLIFF') FE.Stability.noteFix(game, m);
    switch (m.type) {
      case 'TERRAIN':
        // 地貌上的斷牆、立石只改生態區，不抹掉
        for (const [x, y] of m.cells) w.setCell(x, y, w.landmarkAt(x, y) ? w.cell(x, y).t : '"', 'grassland');
        return '扭曲的冷熱散去，這片土地成了溫和的草原。';
      case 'UNREACHABLE': {
        // 聚落出入口不足：在外牆上打開一個寬 3 格的出入口
        if (m.data.villageId) {
          const v = w.villageById(m.data.villageId);
          for (const [x, y] of m.data.path) w.setCell(x, y, '·', 'plain');
          if (v) v.entrances = (v.entrances || 0) + 1;
          return v ? `${v.name}的外牆裂開，多了一個出入口。` : '外牆裂開，多了一個出入口。';
        }
        let carved = 0;
        for (const [x, y] of m.data.path) {
          if (!w.passable(x, y)) {
            w.setCell(x, y, '.', 'plain');
            carved++;
          }
        }
        // 把打通的路修成坡：從路口往裡、再從裡往外各修一次，每一步高度差不超過 1
        if (m.data.ends) {
          const seq = [m.data.ends[0], ...m.data.path, m.data.ends[1]];
          const hs = seq.map(([x, y]) => w.cell(x, y).h);
          const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
          for (let i = 1; i < seq.length - 1; i++) hs[i] = clamp(hs[i], hs[i - 1] - 1, hs[i - 1] + 1);
          for (let i = seq.length - 2; i >= 1; i--) hs[i] = clamp(hs[i], hs[i + 1] - 1, hs[i + 1] + 1);
          for (let i = 1; i < seq.length - 1; i++) w.setHeight(seq[i][0], seq[i][1], hs[i]);
          // 路太短、修不成坡時（例如兩邊直接隔著斷崖），把被圍住那一側的接口拉到能走的高度
          const n = seq.length;
          if (Math.abs(hs[n - 1] - hs[n - 2]) > 1) {
            const [cx, cy] = seq[n - 1];
            w.setHeight(cx, cy, clamp(hs[n - 1], hs[n - 2] - 1, hs[n - 2] + 1));
          }
        }
        return carved ? '斷層合上了，被隔開的土地重新連上世界。' : '被隔開的土地重新連上世界。';
      }
      case 'VALUE': {
        const c = w.chests.find((o) => o.id === m.data.chestId);
        if (!c) return '';
        c.gold = Number.isFinite(c.gold) ? Math.abs(c.gold) : 20;
        return '牠守著的寶箱恢復了原樣。';
      }
      case 'REFERENCE': {
        const n = w.npcById(m.data.npcId);
        if (!n || !n.quest) return '';
        const back = restoreVillager(game, n, m.data.missingId, m.data.missingName);
        if (back) {
          const v = w.villageById(back.villageId);
          n.quest.targetVillage = v ? v.name : n.quest.targetVillage;
          return `${back.name}從虛影裡走了出來，回到${n.quest.targetVillage}，${n.name}的委託接上了。`;
        }
        // 冒險者手上如果正拿著這個任務，那份也要跟著改，不然會送不出去
        const c = game.player && game.player.carrying;
        const mine = c && c.kind !== 'hunt' && c.giverId === n.id;
        const others = w.npcs.filter((o) => o.id !== n.id && !FE.Gear.isShopkeeper(o));
        if (others.length) {
          const t = FE.pick(game.rng, others);
          const v = w.villageById(t.villageId);
          n.quest.targetId = t.id;
          n.quest.targetName = t.name;
          n.quest.targetVillage = v ? v.name : n.quest.targetVillage;
          if (mine) Object.assign(c, { targetId: t.id, targetName: t.name, targetVillage: n.quest.targetVillage });
          return `${n.name}的委託改成送給${n.quest.targetVillage}的${t.name}。`;
        }
        // 放不回去也沒人能接手時，任務的經驗值和算力直接給冒險者，創世門檻才不會差這一份
        n.quest.done = true;
        if (mine) {
          game.bagTake('goods', 1, n.id); // 要送的東西也從背包拿掉
          game.player.carrying = null;
        }
        if (!(opts && opts.noExp)) {
          game.addExp(n.quest.exp);
          game.earn(n.quest.compute || 0);
        }
        return `${n.name}的委託再也送不到了，${n.name}還是謝謝你：經驗值 +${n.quest.exp}。`;
      }
      case 'CLIFF': {
        // 斷崖是高度算錯了：把附近（3 格內）的高度改回正確的值，再把剩下的落差修成坡。
        // 村莊外圍三圈是刻意修過的坡，不改回原值、只參與修坡；村莊本身完全不動。
        const nearVillage = (x, y) =>
          w.villages.some((v) => {
            const f = v.flat || v; // 整平過的工作範圍，外牆縮小之後外圍的坡還是繞著它
            return x >= f.x0 - 3 && x <= f.x1 + 3 && y >= f.y0 - 3 && y <= f.y1 + 3;
          });
        const area = new Map();
        for (const [cx, cy] of m.cells) {
          for (let y = cy - 3; y <= cy + 3; y++) {
            for (let x = cx - 3; x <= cx + 3; x++) {
              if (w.inBounds(x, y) && !w.inVillage(x, y) && !w.landmarkAt(x, y)) area.set(x + ',' + y, [x, y]);
            }
          }
        }
        for (const [x, y] of area.values()) if (!nearVillage(x, y)) w.setHeight(x, y, FE.heightAt(w.seed, x, y));
        for (let iter = 0; iter < 10; iter++) {
          let changed = false;
          for (const [x, y] of area.values()) {
            const hs = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => w.cell(x + dx, y + dy)).filter(Boolean).map((n) => n.h);
            const lo = Math.max(...hs) - 1;
            const hi = Math.min(...hs) + 1;
            const h = w.cell(x, y).h;
            const nh = lo <= hi ? Math.max(lo, Math.min(hi, h)) : Math.round((lo + hi) / 2);
            if (nh !== h) {
              w.setHeight(x, y, nh);
              changed = true;
            }
          }
          if (!changed) break;
        }
        return '崩落的地面恢復成平緩的坡。';
      }
      case 'RUNTIME':
        // 錯誤報告已經在開發者面板裡，遊戲訊息只寫看得到的現象
        return '碎裂的空間合上了。';
    }
    return '';
  };
})();
