// 角色（第二十六版）：職業、六項屬性與修正值、生命與負重上限、升級加點、技能、起始裝備；
// 第二十八版加上出手的算法（profile：傷害骰、屬性、技能、重型、暴擊門檻、精通）、射程與攻擊速度；
// 第二十九版：種族與體型（決定武器拿不拿得起、能不能單手）、技能照 Dwarf Fortress（經驗值、等級沒有上限、新增格鬥與各類武器技能）、
// 負重改成力量值×15 磅、敏捷讓走路變快。
// 冒險者的資料放在 player：cls 職業、race 種族、height／build 身高與體格（1～7）、size 體型、attr 六項屬性（str、dex、con、int、wis、cha）、
// skills 各技能 { lv 等級, n 這一級已經累積的經驗 }、points 還沒分配的屬性點。遊戲內的文字一律只寫世界裡看得到的現象。
(function () {
  const C = FE.CONFIG;

  // 修正值＝(屬性－10)÷2，無條件捨去（9、8 都算 -1）
  const mod = (v) => Math.floor((v - 10) / 2);
  const attrMod = (p, key) => mod(p.attr[key]);
  const cls = (p) => FE.CLASSES[p.cls];

  // 生命上限：起始＝(職業基礎＋體質)×1.5 無條件捨去，每升一級再加「職業基礎÷2＋體質修正值」。
  // 每次照公式重算，所以體質加點時前面的等級一起補上
  function maxHp(p, level) {
    const c = cls(p);
    return Math.floor((c.base + p.attr.con) * C.HP_MULT) + ((level || 1) - 1) * (Math.floor(c.base / 2) + attrMod(p, 'con'));
  }
  // 負重（第二十九版，《D&D》2024 的磅數）：能背＝力量值×15 磅，推拖上限＝力量值×30 磅
  const carryLimit = (p) => p.attr.str * C.CARRY_PER_STR;
  const pushLimit = (p) => p.attr.str * C.PUSH_PER_STR;
  // 走一步花幾刻：基本 10 刻減敏捷修正值，最少 8 刻（超重、被扭曲的地面另外算，見 game.js 的 move）
  const moveTicks = (p) => Math.max(C.MOVE_TICKS_MIN, C.TICKS_MOVE - attrMod(p, 'dex'));

  // ---- 種族與體型 ----
  // 冒險者的體型（沒有的話當成人類的基本體型，舊的測試用角色）
  const sizeOf = (p) => (p.size > 0 ? p.size : FE.PLAYER_RACES.human.size);
  // 這把武器冒險者怎麼拿：'one' 單手（可以配盾、可以雙持）、'two' 只能雙手（副手要空著）、'none' 拿不動。
  // 弓、輕弩射擊一律雙手（twoHand 標籤）；其他武器看體型：不到「能拿」拿不動，到「能單手」可以單手，兩個門檻之間只能雙手
  function grip(p, w) {
    const d = w && FE.GEAR[w.type];
    if (!d || !d.grip) return 'one';
    const size = sizeOf(p);
    if (size < d.grip[0]) return 'none';
    if (d.twoHand) return 'two';
    return size >= d.grip[1] ? 'one' : 'two';
  }
  const GRIP_NAMES = { one: '單手', two: '雙手', none: '拿不動' };
  // 這個種類的武器，體型 size 拿不拿得起（建角挑起始裝備時用，不需要裝備物件）
  const canWieldType = (type, size) => {
    const d = FE.GEAR[type];
    return !d || !d.grip || size >= d.grip[0];
  };

  // ---- 技能 ----
  const skillLv = (p, id) => (p.skills && p.skills[id] ? p.skills[id].lv : 0);
  // 升到第 lv＋1 級要累積多少經驗（400＋100N，N 是目標等級）
  const skillNeed = (lv) => C.SKILL_NEED_BASE + C.SKILL_NEED_STEP * (lv + 1);
  const freshSkills = () => Object.fromEntries(Object.keys(FE.SKILLS).map((k) => [k, { lv: 0, n: 0 }]));
  // 智力讓技能練得快慢：每點修正值經驗 ±10%，最少 ×0.5
  const expFactor = (p) => Math.max(C.SKILL_INT_MIN, 1 + C.SKILL_INT_STEP * attrMod(p, 'int'));

  // 武器對應的技能；空手沒有。w 是哪一把武器（沒給就是主手）；mode 是 melee 且是弓、輕弩時，拿來近戰練別的技能（弓練劍術、輕弩練重錘術）
  function weaponSkill(p, w, mode) {
    const g = w === undefined ? p.equip.main : w;
    const d = g && FE.GEAR[g.type];
    if (!d) return null;
    if (mode === 'melee' && d.ammo) return d.meleeSkill || null;
    return d.skill || null;
  }
  // 技能等級帶來的命中（每 5 級 +1）與傷害（每 3 級 +1）
  const lvHit = (p, id) => (id ? Math.floor(skillLv(p, id) / C.SKILL_HIT_EVERY) : 0);
  const lvDmg = (p, id) => (id ? Math.floor(skillLv(p, id) / C.SKILL_DMG_EVERY) : 0);
  const skillHit = (p, w, mode) => lvHit(p, weaponSkill(p, w, mode));
  const skillDmg = (p, w, mode) => lvDmg(p, weaponSkill(p, w, mode));
  const shootHit = (p) => lvHit(p, 'shoot');
  // 格鬥：所有近戰出手都練（含徒手），命中每 10 級 +1，跟武器技能疊加
  const fightHit = (p) => Math.floor(skillLv(p, 'fight') / C.FIGHT_HIT_EVERY);
  // 靈巧武器（短刀、短劍、鞭子）：命中與傷害都取力量與敏捷修正值裡較高的那個
  const isFinesse = (w) => !!w && !!FE.GEAR[w.type].finesse;
  // 近戰一般攻擊、重擊的傷害加值（主手）：力量修正值（可為負；靈巧武器取力量與敏捷較高者）加武器技能
  function dmgBonus(p, w) {
    const g = w === undefined ? p.equip.main : w;
    const str = attrMod(p, 'str');
    return (isFinesse(g) ? Math.max(str, attrMod(p, 'dex')) : str) + skillDmg(p, g, 'melee');
  }

  // ---- 精通與出手 ----
  // 這把武器的精通冒險者用不用得上：戰士、遊俠一開始就會；法師、牧師要那把武器的技能 5 級。回傳精通的 key 或 null
  function mastery(p, w) {
    const d = w && FE.GEAR[w.type];
    if (!d || !d.mastery) return null;
    return cls(p).mastery || skillLv(p, d.skill) >= FE.MASTERY_SKILL ? d.mastery : null;
  }
  // 擲出幾點以上算暴擊：平常 20；感知修正值 +2 以上 19；短刀再擴大 1
  function critMin(p, w) {
    return 20 - (attrMod(p, 'wis') >= C.CRIT_WIS ? 1 : 0) - (w && w.type === 'dagger' ? 1 : 0);
  }
  // 射程：武器的正常射程與最遠射程都加感知修正值，最少 1 格。base 是 [正常, 最遠]
  function range(p, base) {
    const w = attrMod(p, 'wis');
    return [Math.max(1, base[0] + w), Math.max(1, base[1] + w)];
  }

  // 冒險者這一下怎麼算：mode 是 melee（近戰，含觸及）、shoot（弓箭、輕弩射擊）、throw（投擲）、spell（法師拿法杖的範圍魔攻）、bash（戰士盾擊）；
  // w 是用的武器（null 是徒手），off 是雙持時副手那一下（順劈的第二隻也算：不加正的屬性修正值）。回傳：
  //   die 傷害骰（徒手是 null，固定 BARE_DMG）、type 傷害種類、hit 出手 d20 的角色加減（品質＋屬性＋技能；不含地形、高處）、
  //   dmg 傷害加值（屬性＋技能）、attr 這一下用的屬性修正值（失衡的機率、擦掠用）、heavy 重型武器的劣勢、crit 暴擊門檻、
  //   mastery 用得上的精通、skills 這一下練哪些技能、clear 清除等級（抗性）、pierce 穿甲比例
  function profile(p, w, mode, off) {
    const d = w ? FE.GEAR[w.type] : null;
    const q = w ? FE.QUALITIES[w.q || 0] : FE.QUALITIES[0];
    const str = attrMod(p, 'str');
    const dex = attrMod(p, 'dex');
    const fight = fightHit(p);
    const out = { die: null, type: 'blunt', hit: 0, dmg: 0, attr: 0, heavy: false, crit: critMin(p, w), mastery: null, skills: [], clear: q.clear, pierce: q.pierce };
    if (mode === 'bash') {
      // 盾擊：1d4 鈍擊＋力量修正值；沒有精通，練雜物使用與格鬥，命中只加敏捷（盾牌沒有命中加值）
      Object.assign(out, { die: C.BASH_DIE, type: 'blunt', hit: dex + lvHit(p, 'misc') + fight, dmg: str + lvDmg(p, 'misc'), attr: str, crit: critMin(p, null), skills: ['misc', 'fight'], clear: 0, pierce: 0 });
      return out;
    }
    if (!d) {
      // 徒手：固定 1 點鈍擊＋力量修正值，只吃格鬥
      Object.assign(out, { hit: dex + fight, dmg: str, attr: str, skills: ['fight'], clear: 0, pierce: 0 });
      return out;
    }
    if (mode === 'melee' && d.ammo) {
      // 拿弓、輕弩近戰打人：當臨時武器，1d4 鈍擊＋力量修正值；沒有精通，弓練劍術、輕弩練重錘術，命中只加敏捷
      const sk = d.meleeSkill;
      Object.assign(out, { die: C.BOW_MELEE_DIE, type: 'blunt', hit: dex + lvHit(p, sk) + fight, dmg: str + lvDmg(p, sk), attr: str, crit: critMin(p, null), skills: [sk, 'fight'], clear: 0, pierce: 0 });
      return out;
    }
    out.type = d.type;
    out.mastery = mastery(p, w);
    if (mode === 'spell') {
      // 法師的範圍魔攻：1d6 魔法＋智力修正值，命中加智力修正值（取代敏捷），練杖術
      const int = attrMod(p, 'int');
      Object.assign(out, { die: C.SPELL_DIE, type: 'magic', hit: q.hit + int + lvHit(p, d.skill), dmg: int + lvDmg(p, d.skill), attr: int, skills: [d.skill] });
      return out;
    }
    const ranged = mode === 'shoot' || mode === 'throw';
    // 用哪一項屬性：靈巧取力量與敏捷較高者；射擊用敏捷；近戰與投擲的傷害用力量，命中照舊用敏捷
    const hitAttr = d.finesse ? Math.max(str, dex) : dex;
    const dmgAttr = d.finesse ? Math.max(str, dex) : mode === 'shoot' ? dex : str;
    // 副手那一下、順劈的第二隻（off 是 'cleave'）不加屬性修正值，修正值是負數時照扣
    const isOff = off === true;
    const dmgMod = off ? Math.min(0, dmgAttr) : dmgAttr;
    // 可雙手：副手空著時改用比較大的傷害骰（投擲、射擊不算）
    const sides = mode === 'melee' && d.versatile && !p.equip.off && !isOff ? d.versatile : d.die[1];
    out.die = [d.die[0], sides];
    // 副手拿非輕型武器：那一下有劣勢、傷害骰降成 1d4；短刀這類輕型武器不受影響
    if (isOff && !d.light) {
      out.die = C.OFF_CLUMSY_DIE.slice();
      out.offClumsy = true;
    }
    out.attr = dmgAttr;
    out.off = !!off; // 這一下不加屬性修正值（擦掠也因此擦不到傷）
    // 遠程：武器技能只加傷害，命中看射擊；近戰：武器技能加命中與傷害，再加格鬥的命中
    out.hit = q.hit + hitAttr + (ranged ? shootHit(p) : lvHit(p, d.skill) + fight);
    out.dmg = dmgMod + lvDmg(p, d.skill);
    out.skills = ranged ? [d.skill, 'shoot'] : [d.skill, 'fight'];
    // 重型：近戰力量、遠程敏捷不到 13 出手有劣勢
    out.heavy = !!d.heavy && (ranged ? p.attr.dex : p.attr.str) < C.HEAVY_MIN;
    return out;
  }

  // 攻擊動作花幾刻：輕型 8、一般 10、重型 12，減敏捷修正值，最少 6（防具多花的刻另外疊加，見 game.js 的 endTurn）
  function attackTicks(p, w) {
    const d = w ? FE.GEAR[w.type] : null;
    const base = d && d.heavy ? C.ATTACK_TICKS.heavy : d && d.light ? C.ATTACK_TICKS.light : C.ATTACK_TICKS.normal;
    return Math.max(C.ATTACK_TICKS_MIN, base - attrMod(p, 'dex'));
  }

  // 技能得到經驗：base 是這一次的基本經驗（命中 10、沒命中 5、閃開 10⋯⋯），乘智力的倍率；累積滿這一級要的經驗就升級（可以連升），訊息寫出來
  function useSkill(game, id, base) {
    const p = game.player;
    const s = p.skills && p.skills[id];
    if (!s) return;
    s.n = Math.round((s.n + (base === undefined ? C.SKILL_EXP_HIT : base) * expFactor(p)) * 100) / 100;
    while (s.n >= skillNeed(s.lv)) {
      s.n = Math.round((s.n - skillNeed(s.lv)) * 100) / 100;
      s.lv++;
      game.say(`你的${FE.SKILLS[id].name}越練越熟，升到 ${s.lv} 級（${FE.skillLevelName(s.lv)}）了。`, 'good');
    }
  }

  // 穿甲技能的效果：身上防具的重量打折（照 Dwarf Fortress 的表）；5 級起中甲不多花刻、重甲少 1 刻；10 級起重甲不多花刻；15 級起重甲不再扣閃避
  function armorWeightMul(p) {
    const t = C.ARMOR_WEIGHT_MUL;
    return t[Math.min(skillLv(p, 'armor'), t.length - 1)];
  }
  function armorTicks(p, base) {
    const lv = skillLv(p, 'armor');
    return Math.max(0, base - (lv >= 5 ? 1 : 0) - (lv >= 10 ? 1 : 0));
  }
  const armorDodgeFree = (p) => skillLv(p, 'armor') >= C.ARMOR_FREE_DODGE;
  // 體質：挨到的物理傷害，防具減完之後再減（體質修正值÷2，捨去；負的不加傷害）
  const conCut = (p) => Math.max(0, Math.floor(attrMod(p, 'con') / 2));

  // ---- 起始裝備 ----
  // 每組要挑幾樣、挑的是不是都在這組裡、有沒有挑多或挑少，而且體型拿得起（size 沒給就不檢查）；picks 是選項 id 的清單
  function validPicks(clsKey, picks, size) {
    const c = FE.CLASSES[clsKey];
    if (!c || !Array.isArray(picks)) return false;
    if (size !== undefined && picks.some((id) => !startOk(id, size))) return false;
    const rest = picks.slice();
    for (const g of c.groups) {
      const mine = rest.filter((id) => g.of.includes(id));
      if (mine.length !== g.pick || new Set(mine).size !== mine.length) return false;
      for (const id of mine) rest.splice(rest.indexOf(id), 1);
    }
    return rest.length === 0;
  }
  // 這個起始選項體型 size 拿不拿得起（拿不起來的不列出）
  const startOk = (id, size) => {
    const o = FE.START_OPTS[id];
    return !o || !o.gear || canWieldType(o.gear, size);
  };
  // 這一組實際列出來的選項（拿不起來的拿掉）
  const groupOptions = (g, size) => g.of.filter((id) => startOk(id, size));
  // 預設的挑法：每組從前面挑（拿得起的）
  const defaultPicks = (clsKey, size) => FE.CLASSES[clsKey].groups.flatMap((g) => (size === undefined ? g.of : groupOptions(g, size)).slice(0, g.pick));

  // 身體的資料（建角的前半）：race 種族、bonus 人類自己加的屬性點 { 屬性: 點數 }（總共 2 點）、height／build 1～7。沒給就是普通體型的人類，兩點不加
  function bodyOf(body) {
    if (!body) return { race: 'human', height: 4, build: 4, bonus: {}, neutral: true }; // 沒給：測試用，不加那兩點
    const b = body;
    const R = FE.PLAYER_RACES[b.race];
    if (!R) throw new Error('種族不對');
    if (!(b.height >= 1 && b.height <= 7 && b.build >= 1 && b.build <= 7)) throw new Error('身高或體格不對');
    return Object.assign({ bonus: {} }, b);
  }

  // 建立冒險者（還沒放上地圖）：種族與體型、職業、起始屬性（職業的，加種族加成）、生命、固定的與自己挑的裝備。
  // 雙手拿的武器（弓箭、體型不夠單手的）跟盾牌一起挑的時候，盾牌放進背包
  function create(game, clsKey, picks, name, body) {
    const c = FE.CLASSES[clsKey];
    const b = bodyOf(body);
    const R = FE.PLAYER_RACES[b.race];
    const size = FE.bodySize(b.race, b.height, b.build);
    if (!validPicks(clsKey, picks, size)) throw new Error('起始裝備的挑法不對');
    const attr = Object.assign({}, c.attr);
    const bonus = {};
    for (const k of Object.keys(R.bonus || {})) bonus[k] = (bonus[k] || 0) + R.bonus[k];
    if (R.free && !b.neutral) {
      const spent = Object.values(b.bonus).reduce((s, n) => s + n, 0);
      if (spent !== R.free || Object.keys(b.bonus).some((k) => !(k in attr) || !(b.bonus[k] >= 0))) throw new Error(`${R.name}要自己加 ${R.free} 點屬性`);
      for (const k of Object.keys(b.bonus)) bonus[k] = (bonus[k] || 0) + b.bonus[k];
    }
    for (const k of Object.keys(bonus)) attr[k] = Math.min(C.ATTR_CAP, attr[k] + bonus[k]);
    const p = {
      x: 0,
      y: 0,
      cls: clsKey,
      race: b.race,
      height: b.height,
      build: b.build,
      size,
      attr,
      skills: freshSkills(),
      points: 0,
      hp: 1,
      maxHp: 1,
      equip: { main: null, off: null, body: null },
      block: null,         // 目前的格擋值，第一次需要時補成盾牌的格擋值上限（combat.js）
      gold: 0,
      carrying: null,      // 手上的委託（送貨或清除）；送貨的物品放在背包裡
      bag: [],             // 背包：不限格數，同一種東西疊放（{ id, name, n }；送貨的物品是 id 'goods'，另記 giverId）
      name,
      steps: 0,
    };
    for (const id of c.fixed.concat(picks)) {
      const o = FE.START_OPTS[id];
      if (o.gear) {
        const cat = FE.GEAR[o.gear].cat;
        p.equip[cat === 'weapon' ? 'main' : cat === 'shield' ? 'off' : 'body'] = FE.Gear.make(o.gear, 0, game.nextGearId++);
        if (o.arrows) p.bag.push({ id: 'arrow', name: FE.Gear.name({ type: 'arrow', q: 0 }), n: o.arrows, q: 0 });
      } else if (o.herb) {
        const e = p.bag.find((x) => x.id === 'herb');
        if (e) e.n += o.herb;
        else p.bag.push({ id: 'herb', name: FE.BAG_ITEMS.herb.name, n: o.herb });
      } else if (o.gold) {
        p.gold += o.gold;
      }
    }
    if (p.equip.main && p.equip.off && grip(p, p.equip.main) === 'two') {
      p.bag.push({ id: 'gear', name: FE.Gear.name(p.equip.off), n: 1, gear: p.equip.off });
      p.equip.off = null;
    }
    p.maxHp = p.hp = maxHp(p, 1);
    return p;
  }

  FE.Char = {
    mod, attrMod, cls, maxHp, carryLimit, pushLimit, moveTicks,
    sizeOf, grip, GRIP_NAMES, canWieldType,
    skillLv, skillNeed, expFactor, freshSkills, weaponSkill, skillHit, skillDmg, shootHit, fightHit, isFinesse, dmgBonus, useSkill,
    armorWeightMul, armorTicks, armorDodgeFree, conCut,
    mastery, critMin, range, profile, attackTicks,
    validPicks, startOk, groupOptions, defaultPicks, bodyOf, create,
  };
})();
