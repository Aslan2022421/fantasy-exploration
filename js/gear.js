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

  // 磨損：耐久低於最大值的一半是「磨損」（武器傷害、防具減傷 −1），低於四分之一是「破損」（−2）；回傳 [懲罰, 符號]
  function wearTier(g) {
    if (!g || !g.max) return [0, ''];
    let out = [0, ''];
    for (const [ratio, pen, sym] of C.WEAR_TIERS) if (g.dur < g.max * ratio) out = [pen, sym];
    return out;
  }
  const wearPenalty = (g) => wearTier(g)[0];

  // 名字：普通不加符號，其他把品質寫在兩邊，例如「-做工好-長劍」「☼傑作☼重甲」；傳說物用獨有的名字。
  // 磨損、破損的再在最外面加 x、X（參考 DF），例如「x-做工好-長劍x」
  function name(g) {
    const d = def(g);
    const q = qual(g);
    const base = g.q === 6 ? `${g.title || '傳說物'}（${d.name}）` : q.sym ? `${q.sym}${q.name}${q.sym}${d.name}` : d.name;
    const w = wearTier(g)[1];
    return w ? `${w}${base}${w}` : base;
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

  // 第三十版：價錢的數字（GEAR 的 price、TOOL_PRICE、ORE_PRICE）單位是銀，這裡算出來的一律是銅（乘 SILVER 之後才四捨五入）
  // 販售價：普通原價×品質價值倍率×聚落經濟倍率（有市場再便宜一成，見 Steading.shopFactor）×魅力，四捨五入；礦鎬、鐮刀固定 20 銀、不看經濟
  function shopPrice(type, q, v, cha) {
    const gear = G[type];
    if (gear && gear.cat === 'tool') return Math.round(C.TOOL_PRICE * C.SILVER * buyFactor(cha));
    const item = FE.BAG_ITEMS[type];
    const pack = type.startsWith('pack_') && FE.EQUIPMENT_PACKS[type.slice(5)];
    const base = gear ? gear.price * Q[q].value : item ? item.price : pack ? pack.price : null;
    if (!Number.isFinite(base)) throw new Error(`沒有商品價格：${type}`);
    return Math.round(base * C.SILVER * FE.Steading.shopFactor(v) * buyFactor(cha));
  }

  // 賣回：原價（含品質）的半價×剩餘耐久比例×魅力（至少 1 銅）
  const sellPrice = (g, cha) => Math.max(1, Math.round(value(g) * C.SILVER * C.SELL_RATE * (g.dur / g.max) * sellFactor(cha)));
  // 礦石賣給工匠：一顆 5 銀×魅力
  const orePrice = (n, cha) => Math.round(n * C.ORE_PRICE * C.SILVER * sellFactor(cha));

  // 修復：鐵匠、武器匠、盔甲匠都修到完整（REPAIR_ALL 設成 false 就只修回損失的一半）。回傳 { restore: 修回幾點耐久, cost: 費用（銅） }；耐久已滿 restore 是 0。
  // 費用＝修回的比例×原價×經濟倍率×魅力（至少 1 銅）；工具不看經濟
  function repairQuote(g, v, cha) {
    const missing = g.max - g.dur;
    if (missing <= 0) return { restore: 0, cost: 0 };
    const all = FE.Steading.townish(v) ? C.REPAIR_ALL.town : C.REPAIR_ALL.village; // 城市照城鎮（第三十四版）
    const restore = all ? missing : Math.ceil(missing / 2);
    const econ = def(g).cat === 'tool' ? 1 : FE.Steading.shopFactor(v);
    return { restore, cost: Math.max(1, Math.round((restore / g.max) * value(g) * C.SILVER * C.REPAIR_RATE * econ * buyFactor(cha))) };
  }

  // 打造：礦石數、工錢（銅；原價一半，乘聚落經濟與魅力）、品質範圍（村莊鐵匠普通～精良，城鎮做工好～優秀）
  function craftQuote(type, v, cha) {
    const d = G[type];
    const kind = FE.Steading.townish(v) ? 'town' : 'village';
    return { ore: d.ore, fee: Math.round(d.price * C.SILVER * C.CRAFT_FEE_RATE * FE.Steading.shopFactor(v) * buyFactor(cha)), range: C.CRAFT_RANGE[kind] };
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
  // 磨損、破損的防具減傷 −1、−2，最少 0
  const physReduce = (p) => (p.equip.body ? Math.max(0, Math.round(def(p.equip.body).phys * qual(p.equip.body).armor) - wearPenalty(p.equip.body)) : 0);
  const magicReduce = (p) => (p.equip.body ? Math.max(0, Math.round(def(p.equip.body).magic * qual(p.equip.body).armor) - wearPenalty(p.equip.body)) : 0);
  // 盾牌在副手才擋得住：格擋機率與格擋值（值乘品質倍率，四捨五入）；沒拿盾牌是 0
  const shieldOf = (p) => (p.equip.off && def(p.equip.off).cat === 'shield' ? p.equip.off : null);

  // 冒險者的反擊機率（第三十一版）：防具、重型武器、盾牌三個來源相加，最多 COUNTER_MAX
  const legendShare = (lv) => Math.min(lv, C.SKILL_LEGEND) / C.SKILL_LEGEND;
  function counterChance(p) {
    let c = 0;
    const body = p.equip.body ? def(p.equip.body) : null;
    const aid = body ? FE.ARMOR_SKILL[body.cls] : null;
    if (aid) {
      const lv = FE.Char.skillLv(p, aid);
      c += C.COUNTER_ARMOR[aid] * legendShare(lv);
      if (lv >= 1) c += C.COUNTER_DEX * Math.max(0, FE.Char.dexForDodge(p));
    }
    const w = p.equip.main;
    if (w && def(w).heavy) c += C.COUNTER_HEAVY * legendShare(FE.Char.skillLv(p, def(w).skill)) + C.COUNTER_CLEAR * qual(w).clear;
    const sh = shieldOf(p);
    if (sh) c += C.COUNTER_SHIELD * legendShare(FE.Char.skillLv(p, 'shield')) + C.COUNTER_CLEAR * qual(sh).clear;
    return Math.min(C.COUNTER_MAX, c);
  }
  // 冒險者反擊打中時的傷害：主手武器的類別（重型、一般、輕型；遠程武器與徒手算輕型）＋盾牌，各照自己的技能加到傳奇 ×1.5
  function counterDamage(p) {
    const up = (n, lv) => Math.round(n * (1 + C.COUNTER_DMG_LEGEND * legendShare(lv)));
    const w = p.equip.main;
    const d = w ? def(w) : null;
    const kind = !d || d.ammo ? 'light' : d.heavy ? 'heavy' : d.light ? 'light' : 'normal';
    let dmg = up(C.COUNTER_DMG[kind], d ? FE.Char.skillLv(p, d.skill) : FE.Char.skillLv(p, 'fight'));
    if (shieldOf(p)) dmg += up(C.COUNTER_DMG.shield, FE.Char.skillLv(p, 'shield'));
    return dmg;
  }

  // 冒險者的 AC（第三十三版，照 SRD 5.2.1 的防具表）：身上防具的基本 AC＋敏捷修正值（輕甲全加、中甲最多 +2、重甲不加，見 Char.dexForDodge），
  // 沒穿防具或穿衣袍是 10＋敏捷修正值；副手拿盾牌再 +2。品質不加 AC（品質照舊加減傷）。法術的加護另外加（combat.js 的 acOf）
  function playerAC(p) {
    const b = p.equip.body ? def(p.equip.body) : null;
    const sh = shieldOf(p);
    return (b && b.ac ? b.ac : C.BASE_AC) + FE.Char.dexForDodge(p) + (sh ? def(sh).ac : 0);
  }

  // 冒險者的防禦數字：
  //   閃避＝PLAYER_DODGE（0）＋閃避技能每級 1%（第三十三版：敏捷不再加閃避，改加 AC；閃避是被命中之後再擲，閃開只吃一半傷害）
  //   格擋機率＝盾牌的機率＋盾牌使用每級 2%；格擋值＝盾牌與品質的格擋值，戰士再加力量修正值（其他職業只照盾牌）；沒拿盾牌都是 0
  function playerDefense(p) {
    const sh = shieldOf(p);
    const blockMax = sh ? Math.max(0, Math.round(def(sh).value * qual(sh).armor) + (p.cls === 'warrior' ? FE.Char.attrMod(p, 'str') : 0)) : 0;
    return {
      dodge: Math.max(0, C.PLAYER_DODGE + C.SKILL_DODGE * FE.Char.skillLv(p, 'dodge')),
      counter: FE.Gear.counterChance(p),
      block: sh ? def(sh).block + C.SKILL_BLOCK * FE.Char.skillLv(p, 'shield') : 0,
      blockMax,
    };
  }

  // ---- 重量與負重（第二十九版，單位磅）----
  function itemWeight(e) {
    if (e.id === 'gear') return def(e.gear).weight;
    const b = FE.BAG_ITEMS[e.id];
    // 箭矢、弩矢的重量是一捆（20 支）算的
    return b && b.bundle ? (b.weight * e.n) / b.bundle : (b ? b.weight : 5) * e.n;
  }
  // 身上穿著的防具照穿甲技能打折（Dwarf Fortress 的表），其他照原重量
  function weightOf(p) {
    const worn = equipped(p).reduce((s, g) => s + def(g).weight * (g === p.equip.body ? FE.Char.armorWeightMul(p) : 1), 0);
    return round2(worn + p.bag.reduce((s, e) => s + itemWeight(e), 0));
  }
  // 0 沒超重（範圍內沒有任何減值）；1 超過能背（力量值×15 磅）：移動一步 60 刻；2 超過推拖上限（力量值×30 磅）：不能移動（還能丟東西）
  function loadTier(p) {
    const w = weightOf(p);
    return w <= FE.Char.carryLimit(p) ? 0 : w <= FE.Char.pushLimit(p) ? 1 : 2;
  }
  // 每個動作多花的刻：身上防具的 ticks（穿甲 5 級起少 1 刻、10 級起再少 1 刻，最少 0）；超重不在這裡算，走路才變慢（見 game.js 的 move）
  function extraTicks(p) {
    return p.equip.body ? FE.Char.armorTicks(p, def(p.equip.body).ticks || 0) : 0;
  }
  // 近戰出手擲 d20 的角色加減：武器的命中加值，加敏捷修正值（靈巧取力量與敏捷較高者）與武器技能（每 5 級 +1）、格鬥（每 10 級 +1）
  function hitMod(p, w) {
    return FE.Char.profile(p, wOf(p, w), 'melee').hit;
  }
  // 這把武器冒險者怎麼拿：單手、雙手、拿不動（背包顯示用）
  const gripText = (p, g) => FE.Char.GRIP_NAMES[FE.Char.grip(p, g)];
  // 雙手拿的（體型不夠單手，或弓、輕弩）：拿著時副手不能放東西
  const twoHanded = (p, g) => !!g && FE.Char.grip(p, g) === 'two';

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
      if (d.ammo) tags.push(`彈藥（${G[d.ammo].name}，射程 ${d.range[0]}／${d.range[1]} 格）`);
      if (d.loading) tags.push(FE.WEAPON_TAGS.loading);
      return `${dieText(d.die)} ${FE.DMG_TYPES[d.type]}${tags.length ? '、' + tags.join('、') : ''}、精通時${FE.MASTERIES[d.mastery].name}${q.hit ? `、命中 +${q.hit}` : ''}、${w}`;
    }
    if (d.cat === 'ammo') return `一捆 ${d.bundle} 支${q.pierce ? `、穿甲 ${Math.round(q.pierce * 100)}%` : ''}、重 ${d.weight}`;
    if (d.cat === 'armor') {
      const kind = { light: '輕甲', medium: '中甲', heavy: '重甲', none: '無甲' }[d.cls] || '';
      // AC（第三十三版）：輕甲與衣袍加整個敏捷修正值、中甲最多 +2、重甲不加
      const ac = { light: `AC ${d.ac}＋敏捷`, medium: `AC ${d.ac}＋敏捷（最多 +2）`, heavy: `AC ${d.ac}`, none: `AC ${C.BASE_AC}＋敏捷` }[d.cls] || '';
      const ex = (d.ticks ? `、每個動作多 ${d.ticks} 刻` : '') + (d.str ? `、力量要 ${d.str}` : '') + (d.stealth ? '、不利隱匿' : '');
      return `${kind}、${ac}、物理減傷 ${Math.round(d.phys * q.armor)}、魔法減傷 ${Math.round(d.magic * q.armor)}、${w}${ex}${d.desc ? '。' + d.desc : ''}`;
    }
    if (d.cat === 'shield') return `AC +${d.ac}、格擋 ${Math.round(d.block * 100)}%、格擋值 ${Math.round(d.value * q.armor)}、${w}`;
    return w;
  }

  // ---- 商店 ----
  // 鐵匠與武器匠販售武器、彈藥、消耗品、陷阱、門鎖工具與裝備包；盔甲匠販售防具與盾牌。
  // buy：賣的東西，分類顯示（一層最多列 8 項，所以武器分成四類）；quals：賣哪幾種品質（工具固定普通）；repair：修哪幾類（GEAR 的 cat）；craft：能打造的；sell：收哪幾類
  const SHOPS = {
    blacksmith: {
      title: '鐵匠',
      buy: {
        blade: ['sword', 'shortsword', 'dagger', 'scimitar', 'rapier'],
        axe: ['waraxe', 'club', 'warhammer', 'handaxe', 'lightHammer', 'woodclub', 'greatclub', 'flail', 'morningstar', 'warpick', 'maul'],
        pole: ['spear', 'shortspear', 'staff', 'javelin', 'glaive', 'halberd', 'trident', 'lance'],
        ranged: ['bow', 'longbow', 'arrow', 'sling', 'slingBullet'],
        supplies: ['potion', 'acid', 'alchemistFire', 'holyWater', 'oil'],
        kit: ['caltrops', 'bearings', 'huntingTrap', 'lock', 'thievesTools', 'crowbar', 'pack_gathering', 'pack_supply', 'pack_archer', 'pack_thrower'],
        armor: ['padded', 'light', 'hide', 'chainshirt', 'ringmail', 'robe', 'shield'],
        tool: ['pick', 'sickle'],
      },
      quals: [0],
      repair: ['weapon', 'armor', 'shield', 'tool'],
      craft: ['sword', 'spear', 'shortspear', 'dagger', 'shortsword', 'waraxe', 'club', 'warhammer', 'padded', 'light', 'hide', 'chainshirt', 'ringmail', 'shield'],
      sell: ['weapon', 'armor', 'shield'],
    },
    weaponsmith: {
      title: '武器匠',
      buy: {
        blade: ['sword', 'shortsword', 'greatsword', 'dagger', 'scimitar', 'rapier'],
        axe: ['waraxe', 'greataxe', 'handaxe', 'club', 'warhammer', 'lightHammer', 'woodclub', 'greatclub', 'flail', 'morningstar', 'warpick', 'maul'],
        pole: ['spear', 'shortspear', 'staff', 'whip', 'javelin', 'glaive', 'halberd', 'trident', 'lance'],
        ranged: ['bow', 'longbow', 'crossbow', 'handcrossbow', 'heavycrossbow', 'sling', 'arrow', 'bolt', 'slingBullet', 'musket', 'pistol', 'blowgun', 'bullet', 'needle'],
        supplies: ['potion', 'acid', 'alchemistFire', 'holyWater', 'oil'],
        kit: ['caltrops', 'bearings', 'huntingTrap', 'lock', 'thievesTools', 'crowbar', 'pack_gathering', 'pack_supply', 'pack_archer', 'pack_thrower'],
        tool: ['pick', 'sickle'],
      },
      quals: [0, 1],
      repair: ['weapon', 'tool'],
      craft: ['sword', 'spear', 'shortspear', 'dagger', 'shortsword', 'waraxe', 'club', 'warhammer', 'greataxe', 'greatsword'],
      sell: ['weapon'],
    },
    armorer: {
      title: '盔甲匠',
      buy: {
        armorL: ['padded', 'light', 'studded', 'robe'],
        armorM: ['hide', 'chainshirt', 'medium', 'breastplate', 'halfplate'],
        armorH: ['ringmail', 'heavy', 'splint', 'plate'],
        shieldC: ['shield'],
      },
      quals: [0, 1],
      repair: ['armor', 'shield'],
      craft: ['padded', 'light', 'studded', 'hide', 'chainshirt', 'medium', 'breastplate', 'halfplate', 'ringmail', 'heavy', 'splint', 'plate', 'shield'],
      sell: ['armor', 'shield'],
    },
  };
  const CAT_NAMES = { blade: '劍與刀', axe: '斧與錘', pole: '長柄與法杖', ranged: '遠程武器與彈藥', supplies: '藥水與投擲物', kit: '陷阱、門鎖與裝備包', armor: '防具與盾牌', armorL: '輕甲與衣袍', armorM: '中甲', armorH: '重甲', shieldC: '盾牌', tool: '工具' };
  // 打造的東西也分類顯示（跟「買」同一套分類）：回傳 { 分類: [種類] }，沒有東西的分類不列
  function craftCats(S) {
    const out = {};
    for (const type of S.craft) {
      const cat = Object.keys(S.buy).find((c) => S.buy[c].includes(type));
      (out[cat] = out[cat] || []).push(type);
    }
    return out;
  }
  // 工匠是哪一種店：村莊的 smith 是鐵匠，城鎮的 smith 是武器匠，armorer 是盔甲匠；不是工匠回傳 null
  function shopOf(npc, v) {
    if (!npc) return null;
    if (npc.role === 'armorer') return 'armorer';
    if (npc.role === 'smith') return FE.Steading.townish(v) ? 'weaponsmith' : 'blacksmith';
    return null;
  }
  const isShopkeeper = (n) => !!n && (n.role === 'smith' || n.role === 'armorer');
  // 能不能放副手（雙持）：武器、不是弓和弩，而且冒險者的體型能單手拿（第二十九版）
  const offOk = (p, g) => !!g && def(g).cat === 'weapon' && !def(g).ammo && FE.Char.grip(p, g) === 'one';

  function shopEntries(S, cat, q) {
    const out = [];
    for (const id of S.buy[cat] || []) {
      if (G[id]) {
        const quals = G[id].cat === 'tool' ? [0] : S.quals;
        for (const qq of quals) if (q === undefined || q === qq) out.push({ id, type: id, q: qq, gear: true });
      } else {
        const pack = id.startsWith('pack_') && FE.EQUIPMENT_PACKS[id.slice(5)];
        if (FE.BAG_ITEMS[id] || pack) out.push({ id, type: id, q: 0, gear: false, pack: !!pack });
        else throw new Error(`商店列了不存在的商品：${id}`);
      }
    }
    return out;
  }
  function productName(e) {
    if (e.gear) return name({ type: e.type, q: e.q });
    if (e.pack) return FE.EQUIPMENT_PACKS[e.id.slice(5)].name;
    const item = FE.BAG_ITEMS[e.id];
    return item.bundle ? `一捆 ${item.bundle} 支的${item.name}` : item.name;
  }
  function productText(e) {
    if (e.gear) return statText({ type: e.type, q: e.q });
    if (e.pack) return FE.EQUIPMENT_PACKS[e.id.slice(5)].desc;
    const item = FE.BAG_ITEMS[e.id];
    return `${item.weight} 磅${item.die ? `、${dieText(item.die)} ${item.damage === 'holy' ? '神聖' : FE.DMG_TYPES[item.damage]}` : ''}${item.fixedDamage ? `、${item.fixedDamage} 點${FE.DMG_TYPES[item.damage]}傷害` : ''}`;
  }

  FE.Gear = {
    def, qual, name, make, value, buyFactor, sellFactor, shopPrice, sellPrice, orePrice, repairQuote, craftQuote, rollQuality, randomDrop, DROP_TYPES,
    equipped, lootName, dieText, dmgText, hitBonus, clearLevel, physReduce, magicReduce, shieldOf, playerAC, playerDefense, counterChance, counterDamage, wearTier, wearPenalty,
    itemWeight, weightOf, loadTier, extraTicks, hitMod, gripText, twoHanded, wear, repaired, durText, statText,
    SHOPS, CAT_NAMES, craftCats, shopOf, isShopkeeper, offOk, shopEntries, productName, productText,
  };
})();
