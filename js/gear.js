// 裝備與物品（第二十五版；第二十八版加上武器的傷害骰與特質、箭矢）：裝備物件 { id, type, q, dur, max }（type 見 config.js 的 FE.GEAR，q 是 FE.QUALITIES 的索引）、
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

  // 魅力（cha 是魅力修正值，沒給就是 0）：每點修正值，向工匠買東西（含修復費、打造工錢）−5%，賣東西 +5%，疊在聚落經濟倍率上
  const buyFactor = (cha) => Math.max(0.1, 1 - C.CHA_PRICE * (cha || 0));
  const sellFactor = (cha) => Math.max(0.1, 1 + C.CHA_PRICE * (cha || 0));

  // 販售價：普通原價×品質價值倍率×聚落經濟倍率（有市場再便宜一成，見 Steading.shopFactor）×魅力，四捨五入；礦鎬、鐮刀固定 20 金幣、不看經濟
  function shopPrice(type, q, v, cha) {
    if (G[type].cat === 'tool') return Math.round(C.TOOL_PRICE * buyFactor(cha));
    return Math.round(G[type].price * Q[q].value * FE.Steading.shopFactor(v) * buyFactor(cha));
  }

  // 賣回：原價（含品質）的半價×剩餘耐久比例×魅力
  const sellPrice = (g, cha) => Math.max(1, Math.round(value(g) * C.SELL_RATE * (g.dur / g.max) * sellFactor(cha)));
  // 礦石賣給工匠：一顆 5 金幣×魅力
  const orePrice = (n, cha) => Math.round(n * C.ORE_PRICE * sellFactor(cha));

  // 修復：鐵匠、武器匠、盔甲匠都修到完整（REPAIR_ALL 設成 false 就只修回損失的一半）。回傳 { restore: 修回幾點耐久, cost: 費用 }；耐久已滿 restore 是 0。
  // 費用＝修回的比例×原價×0.5×經濟倍率（至少 1）；工具不看經濟
  function repairQuote(g, v, cha) {
    const missing = g.max - g.dur;
    if (missing <= 0) return { restore: 0, cost: 0 };
    const all = v && v.kind === 'town' ? C.REPAIR_ALL.town : C.REPAIR_ALL.village;
    const restore = all ? missing : Math.ceil(missing / 2);
    const econ = def(g).cat === 'tool' ? 1 : FE.Steading.shopFactor(v);
    return { restore, cost: Math.max(1, Math.round((restore / g.max) * value(g) * C.REPAIR_RATE * econ * buyFactor(cha))) };
  }

  // 打造：礦石數、工錢（原價一半，乘聚落經濟與魅力）、品質範圍（村莊鐵匠普通～精良，城鎮做工好～優秀）
  function craftQuote(type, v, cha) {
    const d = G[type];
    const kind = v && v.kind === 'town' ? 'town' : 'village';
    return { ore: d.ore, fee: Math.round(d.price * C.CRAFT_FEE_RATE * FE.Steading.shopFactor(v) * buyFactor(cha)), range: C.CRAFT_RANGE[kind] };
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

  // 掉落的裝備種類：長劍、長槍、短矛、短刀、弓箭、法杖、箭矢（一捆）、五種防具（重甲、中甲、輕甲、一般衣袍、魔法衣袍）、盾牌
  const DROP_TYPES = Object.keys(G).filter((k) => G[k].drop);
  function randomDrop(game, lo, hi) {
    const type = DROP_TYPES[Math.floor(game.rng() * DROP_TYPES.length)];
    return make(type, rollQuality(game.rng, lo, hi), game.nextGearId++);
  }

  // ---- 冒險者的裝備數字 ----
  const equipped = (p) => [p.equip.main, p.equip.off, p.equip.body].filter(Boolean);
  // 掉落、寶箱的訊息用：箭矢是「一捆箭矢」，其他是「一件 X」
  const lootName = (g) => (def(g).cat === 'ammo' ? `一捆 ${def(g).bundle} 支的${name(g)}` : `一件${name(g)}`);
  // 武器的傷害寫法：「1d8」
  const dieText = (die) => `${die[0]}d${die[1]}`;
  // 主手武器現在的傷害（狀態列、角色畫面用）：骰子＋加值與傷害種類，例如「1d10+3 揮砍」；徒手「1+3 鈍擊」；弓箭寫射擊的傷害
  function dmgText(p) {
    const w = p.equip.main;
    const sign = (n) => (n ? (n > 0 ? '+' : '') + n : '');
    if (w && def(w).ammo) {
      const r = FE.Char.profile(p, w, 'shoot');
      return `${dieText(r.die)}${sign(r.dmg)} ${FE.DMG_TYPES[r.type]}（射擊）`;
    }
    const pr = FE.Char.profile(p, w, 'melee');
    return `${pr.die ? dieText(pr.die) : C.BARE_DMG}${sign(pr.dmg)} ${FE.DMG_TYPES[pr.type]}`;
  }
  // w 是哪一把武器（沒給就是主手；雙持時副手的短刀要傳進來）
  const wOf = (p, w) => (w === undefined ? p.equip.main : w);
  const hitBonus = (p, w) => (wOf(p, w) ? qual(wOf(p, w)).hit : 0);
  // 武器的清除等級（普通 0 ～ 傑作 5、傳說物 6），抗性門檻看它；空手是 0
  const clearLevel = (p, w) => (wOf(p, w) ? qual(wOf(p, w)).clear : 0);
  // 身上防具的物理減傷（乘品質倍率，四捨五入）
  const physReduce = (p) => (p.equip.body ? Math.round(def(p.equip.body).phys * qual(p.equip.body).armor) : 0);
  const magicReduce = (p) => (p.equip.body ? Math.round(def(p.equip.body).magic * qual(p.equip.body).armor) : 0);
  // 盾牌在副手才擋得住：格擋機率與格擋值（值乘品質倍率，四捨五入）；沒拿盾牌是 0
  const shieldOf = (p) => (p.equip.off && def(p.equip.off).cat === 'shield' ? p.equip.off : null);

  // 冒險者的防禦數字：
  //   閃避＝PLAYER_DODGE＋敏捷修正值×2%＋閃避技能每級 1%＋防具的閃避加減（重甲 -5%，穿甲行動 20 級起不再扣），最低 0
  //   格擋機率＝盾牌的機率＋盾牌使用每級 2%；格擋值＝盾牌與品質的格擋值，戰士再加力量修正值（其他職業只照盾牌）；沒拿盾牌都是 0
  function playerDefense(p) {
    const body = p.equip.body ? def(p.equip.body) : null;
    const sh = shieldOf(p);
    const armorDodge = body && body.dodge ? (FE.Char.armorDodgeFree(p) && body.dodge < 0 ? 0 : body.dodge) : 0;
    const blockMax = sh ? Math.max(0, Math.round(def(sh).value * qual(sh).armor) + (p.cls === 'warrior' ? FE.Char.attrMod(p, 'str') : 0)) : 0;
    return {
      dodge: Math.max(0, C.PLAYER_DODGE + C.DEX_DODGE * FE.Char.attrMod(p, 'dex') + C.SKILL_DODGE * FE.Char.skillLv(p, 'dodge') + armorDodge),
      counter: C.PLAYER_COUNTER,
      block: sh ? def(sh).block + C.SKILL_BLOCK * FE.Char.skillLv(p, 'shield') : 0,
      blockMax,
    };
  }

  // ---- 重量與負重 ----
  function itemWeight(e) {
    if (e.id === 'gear') return def(e.gear).weight;
    const b = FE.BAG_ITEMS[e.id];
    // 箭矢的重量是一捆（20 支）算的
    return b && b.bundle ? (b.weight * e.n) / b.bundle : (b ? b.weight : 1) * e.n;
  }
  function weightOf(p) {
    return round2(equipped(p).reduce((s, g) => s + def(g).weight, 0) + p.bag.reduce((s, e) => s + itemWeight(e), 0));
  }
  // 0 沒超重；1 超過上限 OVER_NEAR 以內（每個動作多 2 刻、出手 -1）；2 再超過（不能移動、不能撤退、出手 -2）
  function loadTier(p) {
    const over = weightOf(p) - FE.Char.carryLimit(p);
    return over <= 0 ? 0 : over <= C.OVER_NEAR ? 1 : 2;
  }
  // 每個動作多花的刻：身上防具的 ticks（穿甲行動 5 級起少 1 刻、10 級起再少 1 刻，最少 0），加上超重
  function extraTicks(p) {
    const body = p.equip.body ? FE.Char.armorTicks(p, def(p.equip.body).ticks || 0) : 0;
    return body + (loadTier(p) >= 1 ? C.OVER_TICKS : 0);
  }
  // 近戰出手擲 d20 的角色加減：武器的命中加值，加敏捷修正值（靈巧取力量與敏捷較高者）與武器技能（每 5 級 +1），扣掉超重的減值
  function hitMod(p, w) {
    return FE.Char.profile(p, wOf(p, w), 'melee').hit;
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
    if (d.cat === 'weapon') {
      const tags = [];
      if (d.versatile) tags.push(`可雙手（副手空著 ${dieText([d.die[0], d.versatile])}）`);
      for (const k of ['heavy', 'light', 'finesse', 'reach', 'twoHand']) if (d[k]) tags.push(FE.WEAPON_TAGS[k]);
      if (d.thrown) tags.push(`投擲 ${d.thrown[0]}／${d.thrown[1]} 格`);
      if (d.ammo) tags.push(`彈藥（射程 ${d.range[0]}／${d.range[1]} 格）`);
      if (d.loading) tags.push(FE.WEAPON_TAGS.loading);
      return `${dieText(d.die)} ${FE.DMG_TYPES[d.type]}${tags.length ? '、' + tags.join('、') : ''}、精通${FE.MASTERIES[d.mastery].name}${q.hit ? `、命中 +${q.hit}` : ''}、${w}`;
    }
    if (d.cat === 'ammo') return `一捆 ${d.bundle} 支${q.pierce ? `、穿甲 ${Math.round(q.pierce * 100)}%` : ''}、重 ${d.weight}`;
    if (d.cat === 'armor') {
      const ex = (d.ticks ? `、每個動作多 ${d.ticks} 刻` : '') + (d.dodge ? `、閃避 ${Math.round(d.dodge * 100)}%` : '');
      return `物理減傷 ${Math.round(d.phys * q.armor)}、魔法減傷 ${Math.round(d.magic * q.armor)}、${w}${ex}`;
    }
    if (d.cat === 'shield') return `格擋 ${Math.round(d.block * 100)}%、格擋值 ${Math.round(d.value * q.armor)}、${w}`;
    return w;
  }

  // ---- 商店 ----
  // 鐵匠（村莊）什麼都賣、什麼都修（修到完整）、什麼都能打造（弓箭、法杖、箭矢、衣袍不能打造）；城鎮分成武器匠（武器、箭矢、礦鎬、鐮刀）和盔甲匠（防具與盾牌）。
  // buy：賣的東西，分類顯示；quals：賣哪幾種品質（工具固定普通）；repair：修哪幾類（GEAR 的 cat）；craft：能打造的；sell：收哪幾類
  const SHOPS = {
    blacksmith: {
      title: '鐵匠',
      buy: { weapon: ['sword', 'spear', 'shortspear', 'dagger', 'bow', 'staff', 'arrow'], armor: ['heavy', 'medium', 'light', 'robe', 'shield'], tool: ['pick', 'sickle'] },
      quals: [0],
      repair: ['weapon', 'armor', 'shield', 'tool'],
      craft: ['sword', 'spear', 'shortspear', 'dagger', 'heavy', 'medium', 'light', 'shield'],
      sell: ['weapon', 'armor', 'shield'],
    },
    weaponsmith: {
      title: '武器匠',
      buy: { weapon: ['sword', 'spear', 'shortspear', 'dagger', 'bow', 'staff', 'arrow'], tool: ['pick', 'sickle'] },
      quals: [0, 1],
      repair: ['weapon', 'tool'],
      craft: ['sword', 'spear', 'shortspear', 'dagger'],
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
  const CAT_NAMES = { weapon: '武器與箭矢', armor: '防具與盾牌', tool: '工具' };
  // 工匠是哪一種店：村莊的 smith 是鐵匠，城鎮的 smith 是武器匠，armorer 是盔甲匠；不是工匠回傳 null
  function shopOf(npc, v) {
    if (!npc) return null;
    if (npc.role === 'armorer') return 'armorer';
    if (npc.role === 'smith') return v && v.kind === 'town' ? 'weaponsmith' : 'blacksmith';
    return null;
  }
  const isShopkeeper = (n) => !!n && (n.role === 'smith' || n.role === 'armorer');
  // 能不能放副手（雙持）：暫時弓箭以外的武器都可以，之後再一把一把定哪些只能單手、哪些要雙手
  const offOk = (d) => !!d && d.cat === 'weapon' && !d.ammo;

  FE.Gear = {
    def, qual, name, make, value, buyFactor, sellFactor, shopPrice, sellPrice, orePrice, repairQuote, craftQuote, rollQuality, randomDrop, DROP_TYPES,
    equipped, lootName, dieText, dmgText, hitBonus, clearLevel, physReduce, magicReduce, shieldOf, playerDefense,
    itemWeight, weightOf, loadTier, extraTicks, hitMod, wear, repaired, durText, statText,
    SHOPS, CAT_NAMES, shopOf, isShopkeeper, offOk,
  };
})();
