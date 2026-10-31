// 裝備與物品（第二十五版）：裝備物件 { id, type, q, dur, max }（type 見 config.js 的 FE.GEAR，q 是 FE.QUALITIES 的索引）、
// 名字與品質符號、價錢（原價含品質，販售價再乘聚落經濟）、重量與負重、磨損、隨機品質與掉落、商店的貨色。
// 冒險者穿的裝備放在 player.equip（main 主手、off 副手、body 身上），沒穿的放在背包裡（id 'gear' 的項目，每件單獨一格、不疊放）。
// 遊戲內的文字一律只寫世界裡看得到的現象。
(function () {
  const C = FE.CONFIG;
  const Q = FE.QUALITIES;
  const G = FE.GEAR;
  const def = (g) => G[g.type];
  const qual = (g) => Q[g.q || 0];
  const round2 = (n) => Math.round(n * 100) / 100;

  // 名字：普通不加符號，其他把品質寫在兩邊，例如「-做工好-長劍」「☼傑作☼重甲」；傳說物用獨有的名字
  function name(g) {
    const d = def(g);
    const q = qual(g);
    if (g.q === 6) return `${g.title || '傳說物'}（${d.name}）`;
    return q.sym ? `${q.sym}${q.name}${q.sym}${d.name}` : d.name;
  }

  function make(type, q, id) {
    const d = G[type];
    return { id, type, q: q || 0, dur: d.dur, max: d.dur };
  }

  // 原價（含品質，不含聚落經濟）：賣回與修復的基準
  const value = (g) => def(g).price * qual(g).value;

  // 販售價：普通原價×品質價值倍率×聚落經濟倍率（有市場再便宜一成，見 Steading.shopFactor），四捨五入；礦鎬、鐮刀固定 20 金幣、不看經濟
  function shopPrice(type, q, v) {
    if (G[type].cat === 'tool') return C.TOOL_PRICE;
    return Math.round(G[type].price * Q[q].value * FE.Steading.shopFactor(v));
  }

  // 賣回：原價（含品質）的半價×剩餘耐久比例
  const sellPrice = (g) => Math.max(1, Math.round(value(g) * C.SELL_RATE * (g.dur / g.max)));

  // 修復：鐵匠、武器匠、盔甲匠都修到完整（REPAIR_ALL 設成 false 就只修回損失的一半）。回傳 { restore: 修回幾點耐久, cost: 費用 }；耐久已滿 restore 是 0。
  // 費用＝修回的比例×原價×0.5×經濟倍率（至少 1）；工具不看經濟
  function repairQuote(g, v) {
    const missing = g.max - g.dur;
    if (missing <= 0) return { restore: 0, cost: 0 };
    const all = v && v.kind === 'town' ? C.REPAIR_ALL.town : C.REPAIR_ALL.village;
    const restore = all ? missing : Math.ceil(missing / 2);
    const econ = def(g).cat === 'tool' ? 1 : FE.Steading.shopFactor(v);
    return { restore, cost: Math.max(1, Math.round((restore / g.max) * value(g) * C.REPAIR_RATE * econ)) };
  }

  // 打造：礦石數、工錢（原價一半，乘聚落經濟）、品質範圍（村莊鐵匠普通～精良，城鎮做工好～優秀）
  function craftQuote(type, v) {
    const d = G[type];
    const kind = v && v.kind === 'town' ? 'town' : 'village';
    return { ore: d.ore, fee: Math.round(d.price * C.CRAFT_FEE_RATE * FE.Steading.shopFactor(v)), range: C.CRAFT_RANGE[kind] };
  }

  // 隨機品質：範圍 lo～hi（含），每高一級機率減半
  function rollQuality(rng, lo, hi) {
    let total = 0;
    for (let i = lo; i <= hi; i++) total += Math.pow(0.5, i - lo);
    let r = rng() * total;
    for (let i = lo; i <= hi; i++) {
      r -= Math.pow(0.5, i - lo);
      if (r < 0) return i;
    }
    return hi;
  }

  // 掉落的裝備種類：長劍、長槍、短刀、五種防具（重甲、中甲、輕甲、一般衣袍、魔法衣袍）、盾牌
  const DROP_TYPES = Object.keys(G).filter((k) => G[k].drop);
  function randomDrop(game, lo, hi) {
    const type = DROP_TYPES[Math.floor(game.rng() * DROP_TYPES.length)];
    return make(type, rollQuality(game.rng, lo, hi), game.nextGearId++);
  }

  // ---- 冒險者的裝備數字 ----
  const equipped = (p) => [p.equip.main, p.equip.off, p.equip.body].filter(Boolean);
  const atkOf = (p) => (p.equip.main ? def(p.equip.main).atk : C.BARE_ATK);
  const hitBonus = (p) => (p.equip.main ? qual(p.equip.main).hit : 0);
  // 主手武器的清除等級（普通 0 ～ 傑作 5、傳說物 6），抗性門檻看它；空手是 0
  const clearLevel = (p) => (p.equip.main ? qual(p.equip.main).clear : 0);
  // 身上防具的物理減傷（乘品質倍率，四捨五入）
  const physReduce = (p) => (p.equip.body ? Math.round(def(p.equip.body).phys * qual(p.equip.body).armor) : 0);
  const magicReduce = (p) => (p.equip.body ? Math.round(def(p.equip.body).magic * qual(p.equip.body).armor) : 0);
  // 盾牌在副手才擋得住：格擋機率與格擋值（值乘品質倍率，四捨五入）；沒拿盾牌是 0
  const shieldOf = (p) => (p.equip.off && def(p.equip.off).cat === 'shield' ? p.equip.off : null);

  function playerDefense(p) {
    const body = p.equip.body ? def(p.equip.body) : null;
    const sh = shieldOf(p);
    return {
      dodge: C.PLAYER_DODGE + (body ? body.dodge || 0 : 0),
      counter: C.PLAYER_COUNTER,
      block: sh ? def(sh).block : 0,
      blockMax: sh ? Math.round(def(sh).value * qual(sh).armor) : 0,
    };
  }

  // ---- 重量與負重 ----
  function itemWeight(e) {
    if (e.id === 'gear') return def(e.gear).weight;
    const b = FE.BAG_ITEMS[e.id];
    return (b ? b.weight : 1) * e.n;
  }
  function weightOf(p) {
    return round2(equipped(p).reduce((s, g) => s + def(g).weight, 0) + p.bag.reduce((s, e) => s + itemWeight(e), 0));
  }
  // 0 沒超重；1 超過上限 OVER_NEAR 以內（每個動作多 2 刻、出手 -1）；2 再超過（不能移動、不能撤退、出手 -2）
  function loadTier(p) {
    const over = weightOf(p) - C.CARRY_LIMIT;
    return over <= 0 ? 0 : over <= C.OVER_NEAR ? 1 : 2;
  }
  // 每個動作多花的刻：身上防具的 ticks，加上超重
  function extraTicks(p) {
    const body = p.equip.body ? def(p.equip.body).ticks || 0 : 0;
    return body + (loadTier(p) >= 1 ? C.OVER_TICKS : 0);
  }
  // 出手擲 d20 的裝備加減：主手武器的命中加值，扣掉超重的減值
  function hitMod(p) {
    return hitBonus(p) - loadTier(p);
  }

  // ---- 磨損 ----
  // 每次磨損的機率＝1÷品質價值倍率；耐久到 0 就消失；剩兩成時訊息提醒一次。回傳 true 表示壞掉了
  function wear(game, g) {
    const mult = qual(g).value;
    if (mult > 1 && game.rng() >= 1 / mult) return false;
    g.dur--;
    if (g.dur <= 0) {
      game.removeGear(g);
      game.say(`你的${name(g)}壞掉了，碎得不成形。`, 'bad');
      return true;
    }
    if (!g.warned && g.dur <= g.max * C.WARN_DUR) {
      g.warned = true;
      game.say(`你的${name(g)}快壞了（耐久剩 ${g.dur} / ${g.max}）。`, 'bad');
    }
    return false;
  }
  // 修過之後耐久回到兩成以上，下次再磨到兩成又會提醒
  function repaired(g) {
    if (g.dur > g.max * C.WARN_DUR) g.warned = false;
  }

  const durText = (g) => `耐久 ${g.dur} / ${g.max}`;

  // 背包與商店列用的簡短說明（g 只要有 type 和 q 就行）
  function statText(g) {
    const d = def(g);
    const q = qual(g);
    const w = `重 ${d.weight}`;
    if (d.cat === 'weapon') return `攻擊力 ${d.atk}${q.hit ? `、命中 +${q.hit}` : ''}、${w}`;
    if (d.cat === 'armor') {
      const ex = (d.ticks ? `、每個動作多 ${d.ticks} 刻` : '') + (d.dodge ? `、閃避 ${Math.round(d.dodge * 100)}%` : '');
      return `物理減傷 ${Math.round(d.phys * q.armor)}、魔法減傷 ${Math.round(d.magic * q.armor)}、${w}${ex}`;
    }
    if (d.cat === 'shield') return `格擋 ${Math.round(d.block * 100)}%、格擋值 ${Math.round(d.value * q.armor)}、${w}`;
    return w;
  }

  // ---- 商店 ----
  // 鐵匠（村莊）什麼都賣、什麼都修（修到完整）、什麼都能打造；城鎮分成武器匠（武器、礦鎬、鐮刀）和盔甲匠（防具與盾牌）。
  // buy：賣的東西，分類顯示；quals：賣哪幾種品質（工具固定普通）；repair：修哪幾類（GEAR 的 cat）；craft：能打造的；sell：收哪幾類
  const SHOPS = {
    blacksmith: {
      title: '鐵匠',
      buy: { weapon: ['sword', 'spear', 'dagger'], armor: ['heavy', 'medium', 'light', 'robe', 'shield'], tool: ['pick', 'sickle'] },
      quals: [0],
      repair: ['weapon', 'armor', 'shield', 'tool'],
      craft: ['sword', 'spear', 'dagger', 'heavy', 'medium', 'light', 'shield'],
      sell: ['weapon', 'armor', 'shield'],
    },
    weaponsmith: {
      title: '武器匠',
      buy: { weapon: ['sword', 'spear', 'dagger'], tool: ['pick', 'sickle'] },
      quals: [0, 1],
      repair: ['weapon', 'tool'],
      craft: ['sword', 'spear', 'dagger'],
      sell: ['weapon'],
    },
    armorer: {
      title: '盔甲匠',
      buy: { armor: ['heavy', 'medium', 'light', 'robe', 'shield'] },
      quals: [0, 1],
      repair: ['armor', 'shield'],
      craft: ['heavy', 'medium', 'light', 'shield'],
      sell: ['armor', 'shield'],
    },
  };
  const CAT_NAMES = { weapon: '武器', armor: '防具與盾牌', tool: '工具' };
  // 工匠是哪一種店：村莊的 smith 是鐵匠，城鎮的 smith 是武器匠，armorer 是盔甲匠；不是工匠回傳 null
  function shopOf(npc, v) {
    if (!npc) return null;
    if (npc.role === 'armorer') return 'armorer';
    if (npc.role === 'smith') return v && v.kind === 'town' ? 'weaponsmith' : 'blacksmith';
    return null;
  }
  const isShopkeeper = (n) => !!n && (n.role === 'smith' || n.role === 'armorer');

  FE.Gear = {
    def, qual, name, make, value, shopPrice, sellPrice, repairQuote, craftQuote, rollQuality, randomDrop, DROP_TYPES,
    equipped, atkOf, hitBonus, clearLevel, physReduce, magicReduce, shieldOf, playerDefense,
    itemWeight, weightOf, loadTier, extraTicks, hitMod, wear, repaired, durText, statText,
    SHOPS, CAT_NAMES, shopOf, isShopkeeper,
  };
})();
