// 怪物：程式裡叫 BUG，遊戲內文字一律叫怪物。種族看環境（config.js 的 RACES），
// 錯誤種類（m.type）只在世界底層，決定打倒時修什麼；強度看種族與數值塊，影響範圍只換算經驗值與算力。
// 血條歸零時呼叫 repairBug 修世界。
(function () {
  // 遊戲內的字（name、desc）只寫世界裡看得到的現象，不寫程式用語；
  // 程式裡的種類代碼（TERRAIN、VALUE⋯⋯）對應的程式錯誤寫在旁邊的註解。
  // name 是異常的名字、desc 是現象。第三十三版之二：異常種類只在世界底層（檢查器找錯、修補時修什麼），
  // 不再給怪物生命倍率、傷害加減、抗性與防禦；怪物怎麼打只看套上去的數值塊
  FE.BUG_TYPES = {
    // 走不到的區域
    UNREACHABLE: {
      name: '斷層',
      desc: '大地裂出一道斷層，把一塊土地跟世界隔開了。',
    },
    // 寶箱金幣算成負數或 NaN
    VALUE: {
      name: '狂亂',
      desc: '牠守著一個被扭曲的寶箱，力氣時強時弱，捉摸不定。',
    },
    // 任務指向不存在的村民
    REFERENCE: {
      name: '虛影',
      desc: '牠纏著一個不在這世上的人，身形虛實不定，很難打中。',
    },
    // 執行時抓到的例外或不合法的狀態
    RUNTIME: {
      name: '碎裂',
      desc: '空間碎裂時留下的殘響。',
    },
    // 第三十三版之三：穩定值掉到負的格子生出來的怪物，沒有哪一處具體的錯要修；打倒時只把那一帶的穩定值補回起始值
    DECAY: {
      name: '衰敗',
      desc: '大地一點一點失去了穩定，聚成了怪物。',
    },
  };

  // 分級（m.tier）：影響範圍 1～4 是小怪物，5 以上是中型怪物，12 以上才是大怪物（只來自世界級事件，第 2 階段才做）。
  // 注意 m.small 不是「小怪物」，是「會追人、會合體」的旗標，只有衰敗的格子生出的怪物有（第三十三版之三）；
  // 創世時生出的怪物就算影響範圍只有 1，m.small 也是 false，只在自己的 B 點附近徘徊
  // 第三十三版之二：名字看數值塊（Giant Crocodile 是巨鱷）；沒有菁英數值塊、由一群裡最強的那隻升上來的菁英，名字前加「菁英」

  // 體型：畫面上只顯示體型，不顯示格數
  FE.sizeName = (m) => ({ small: '小', mid: '中', big: '巨大' })[m.tier] || '小';

  // 怪物的名字看數值塊（菁英由一群裡最強的升上來時名字前加「菁英」）
  FE.monsterName = (m) => {
    const b = FE.monsterBlock(m.race, FE.blockKey(m));
    const name = b.name || (FE.RACES[m.race] || FE.RACES.goblin).name;
    return m.elite && !/Elite$/.test(FE.blockKey(m)) ? '菁英' + name : name;
  };

  // 攻防判定用的防禦數字：防禦看數值塊的 AC，這裡只剩生成當下的世界等級每升一級加的一點閃避與格擋
  // （第三十三版之二拿掉異常本身的閃避、反擊、格擋與中型怪物多加的防禦）
  FE.monsterDef = (m) => {
    const up = (m.wl || 1) - 1;
    const B = FE.CONFIG.WL_BONUS;
    return { dodge: up * B.DODGE, counter: 0, block: up * B.BLOCK, blockMax: up * B.BLOCK_MAX };
  };

  // 打倒怪物時給的算力（單人份量）：小怪物 3，中型怪物 8＋影響範圍÷2，再乘世界等級的獎勵倍率
  FE.killCompute = (tier, scope, wl) => {
    const C = FE.CONFIG;
    const base = tier === 'small' ? C.COMPUTE_KILL_SMALL : C.COMPUTE_KILL_MID + scope * C.COMPUTE_KILL_MID_PER_SCOPE;
    return Math.round(base * FE.wlScale(wl, C.WL_BONUS.REWARD) * 10) / 10;
  };

  // 傷害骰的平均（顯示攻擊力、合體的難度評級與 BUG 量用）
  const avgDie = (die) => (die[0] * (die[1] + 1)) / 2;

  // ---- 第三十三版：怪物的數值照 SRD 5.2.1（資料與出處見 config.js 的 FE.MONSTER_BLOCKS）----
  // 這隻怪物用哪一級的數值塊：m.bkey（small、smallElite、mid、midElite、minion），沒給就照分級（小怪物 small，中型以上 mid）
  FE.blockKey = (m) => m.bkey || (m.tier === 'small' ? 'small' : 'mid');
  // 數值塊屬於小怪物還是中怪物（小怪物的菁英、哥布林手下算小怪物）
  FE.tierOfKey = (key) => (key === 'mid' || key === 'midElite' ? 'mid' : 'small');
  // 這個種族、這一級的數值塊；這個種族沒有這一級就找最接近的（同一級的菁英或一般、再來是另一級）；沒有的種族當哥布林
  const KEY_ORDER = { small: ['small', 'smallElite', 'minion', 'mid', 'midElite'], smallElite: ['smallElite', 'small', 'mid', 'midElite'], minion: ['minion', 'small'],
    mid: ['mid', 'midElite', 'smallElite', 'small'], midElite: ['midElite', 'mid', 'smallElite', 'small'], big: ['midElite', 'mid'] };
  FE.monsterBlock = (race, key) => {
    const R = FE.MONSTER_BLOCKS[race] || FE.MONSTER_BLOCKS.goblin;
    for (const k of KEY_ORDER[key] || KEY_ORDER.small) if (R[k]) return R[k];
    return R[Object.keys(R)[0]];
  };
  // 一隻怪物值多少 BUG 量：世界等級 1 的生命 × 一下的平均傷害（第三十三版之二，使用者同意的算法）
  // 第三十三版之三：這個值也是怪物身上的 BUG 值（m.bug），跟格子的穩定值同一個單位（穩定值負的量就是 BUG 值）
  FE.blockValue = (b) => FE.monsterHp(b) * (avgDie(b.die) + b.dmg + (b.extraDie ? avgDie(b.extraDie) : 0));
  // 這幾個種族裡最便宜的一隻值多少 BUG 值（小怪物、中怪物兩級，菁英不算；衰敗的格子欠的量要買得起這個才生怪物）
  FE.cheapestValue = (races) => {
    let best = Infinity;
    for (const r of races) for (const k of ['small', 'mid']) if (FE.hasTier(r, k)) best = Math.min(best, FE.blockValue(FE.monsterBlock(r, k)));
    return best === Infinity ? FE.blockValue(FE.monsterBlock('goblin', 'small')) : best;
  };
  // 生命：跟冒險者同一套（char.js 的 maxHp）：（生命骰面數＋體質值）×1.5 無條件捨去，每多一級（生命骰多 1 顆）再加 面數÷2＋體質修正值
  FE.monsterHp = (b) => {
    const [n, f] = b.hd;
    return Math.floor((f + b.con) * FE.CONFIG.HP_MULT) + (n - 1) * (Math.floor(f / 2) + Math.floor((b.con - 10) / 2));
  };
  // 套上數值塊：AC、攻擊加值、傷害、特性與生命（生命再乘異常的倍率與世界等級的加成；血量回滿）。
  // m.atk 是一下的平均傷害（含世界等級的加成），只拿來顯示與算難度評級；異常種類不改數值（第三十三版之二）
  FE.statMonster = (m) => {
    const b = FE.monsterBlock(m.race, FE.blockKey(m));
    const B = FE.CONFIG.WL_BONUS;
    Object.assign(m, {
      srd: b.srd,
      ac: b.ac,
      toHit: b.hit,
      die: b.die.slice(),
      dmgBonus: b.dmg,
      dmgType: b.type,
      advDie: b.advDie ? b.advDie.slice() : null,
      extraDie: b.extraDie ? b.extraDie.slice() : null, // 每次命中都多擲的傷害（毒、死靈、寒冷、閃電），照一般傷害算
      extraType: b.extraType || null,
      stealth: b.stealth || 0,
      traits: b.traits.slice(),
      vuln: (b.vuln || []).slice(),
      regen: b.regen || 0,
    });
    m.atk = Math.max(1, Math.round((avgDie(m.die) + (m.extraDie ? avgDie(m.extraDie) : 0) + m.dmgBonus) * FE.wlScale(m.wl, B.ATK)));
    m.maxHp = m.hp = Math.max(1, Math.round(FE.monsterHp(b) * FE.wlScale(m.wl, B.HP)));
    m.bug = Math.round(FE.blockValue(b)); // 牠身上的 BUG 值（世界等級 1 的 blockValue 四捨五入成整數，跟格子的整數穩定值一起算；不乘世界等級的加成）；合體怪物由 merge 改成合進去的加總
    return m;
  };
  FE.hasTrait = (m, k) => !!(m && m.traits && m.traits.includes(k));

  // 依 B 點所在的環境決定種族，名字與數值跟著改。第三十三版之一：每個生態區有 3～5 種，給了 rng 就照權重隨機套一種
  // （沒給就是那一區原本的種族）；遺跡、墓地附近是殭屍或食屍鬼（FE.raceAt）
  // 第三十三版之二：先定級別再套皮，只從這裡有這一級數值塊的種族挑
  FE.dressMonster = (m, world, rng) => {
    const key = m.tier === 'small' ? 'small' : 'mid';
    m.race = FE.raceAt(world, m.x, m.y, rng, key);
    m.bkey = FE.hasTier(m.race, key) ? key : FE.hasTier(m.race, key + 'Elite') ? key + 'Elite' : Object.keys(FE.MONSTER_BLOCKS[m.race] || { small: 1 })[0];
    m.name = FE.monsterName(m);
    FE.statMonster(m);
    return m;
  };

  // wl 是生成當下的世界等級：血量、傷害、打倒時的經驗值與算力照等級加成，之後不再變。
  // 第三十三版：血量、AC、攻擊加值、傷害照種族與分級的 SRD 數值塊（statMonster）；影響範圍只決定分級、經驗值與算力。
  // 種族沒給先當哥布林，dressMonster 看環境換種族時數值跟著換
  FE.makeMonster = function (d, id, wl) {
    const B = FE.CONFIG.WL_BONUS;
    wl = wl || 1;
    // 這一版創世時的大錯也只算中型；大怪物（tier 'big'）要由世界級事件指定，d.tier 是留給第 2 階段用的。
    // 給了數值塊（d.block）就照數值塊的級別（第三十三版之二：創世時照 BUG 量配好的組合）
    const tier = d.tier || (d.block ? FE.tierOfKey(d.block) : d.scope >= FE.CONFIG.MID_SCOPE ? 'mid' : 'small');
    const boss = tier === 'big';
    const m = {
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
      race: d.race || 'goblin',
      bkey: d.block || null,    // 用哪一級的數值塊（FE.blockKey），沒給照分級
      elite: !!d.elite,          // 戰役帶頭的菁英（第三十三版之二）
      name: '',                 // statMonster 照數值塊填
      maxHp: 1,                 // 生命、AC、攻擊加值、傷害由 statMonster 照數值塊填
      hp: 1,
      atk: 1,
      exp: Math.round((4 + d.scope * 2) * FE.wlScale(wl, B.REWARD)), // 打倒時一次結算
      compute: FE.killCompute(tier, d.scope, wl), // 打倒時給的算力（單人份量，創世門檻也照這個加總）
      home: { x: d.x, y: d.y }, // 徘徊時繞著這一點
      small: false,             // 會追人、會合體的旗標（衰敗的格子生出的才是），跟 tier 的「小怪物」不同
      block: null,              // 目前的格擋值，第一次需要時補成上限（combat.js）
      chase: 0,                 // 還會追幾回合
      chaseSteps: 0,            // 這一趟已經追了幾步
      returning: false,         // 正在回生成點，途中不追
      returnTurns: 0,
      members: null,            // 合體怪物：原本那幾隻小怪物，打倒時一起修
    };
    FE.statMonster(m);
    m.name = FE.monsterName(m);
    return m;
  };

  // 把被生成器刪掉的村民放回給任務那個人的村莊裡
  function restoreVillager(game, giver, id, name) {
    const w = game.world;
    const v = w.villageById(giver.villageId);
    if (!v) return null;
    // 村莊住滿了就不放，改由現有的村民接手，不然事件一直補人，村莊會擠滿
    const cap = v.kind === 'city' ? 2 * FE.CONFIG.TOWN_MAX_NPC : v.kind === 'town' ? FE.CONFIG.TOWN_MAX_NPC : FE.CONFIG.VILLAGE_MAX_NPC; // 城市是兩座城鎮（第三十四版）
    if (w.npcs.filter((n) => n.villageId === v.id && !FE.Gear.isShopkeeper(n) && n.role !== 'recruit').length >= cap) return null;
    // 每個村民有自己的家：沒有空床也不放；人口裡沒有名字的人用完了也不放（第三十六版之一）
    if (game.unnamed && game.unnamed(v) < 1) return null;
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
    FE.npcRace(w, npc);
    w.npcs.push(npc);
    return npc;
  }

  // 回傳一句說明修了什麼
  // opts.noExp：創世神自己清掉時，修好的副作用不給冒險者經驗值
  FE.repairBug = function (game, m, opts) {
    const w = game.world;
    if (m.members) return m.members.map((o) => FE.repairBug(game, o, opts)).join('');
    switch (m.type) {
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
        c.copper = Number.isFinite(c.copper) ? Math.abs(c.copper) : 20 * FE.CONFIG.SILVER;
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
        const c = game.player && game.player.jobs ? game.player.jobs.deliver : null;
        const mine = !!c && c.giverId === n.id;
        const others = w.npcs.filter((o) => o.id !== n.id && !FE.Gear.isShopkeeper(o) && o.role !== 'recruit');
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
          game.player.jobs.deliver = null;
        }
        if (!(opts && opts.noExp)) {
          game.addExp(n.quest.exp);
          game.earn(n.quest.compute || 0);
        }
        return `${n.name}的委託再也送不到了，${n.name}還是謝謝你：經驗值 +${n.quest.exp}。`;
      }
      case 'RUNTIME':
        // 錯誤報告已經在開發者面板裡，遊戲訊息只寫看得到的現象
        return '碎裂的空間合上了。';
    }
    return '';
  };
})();
