// 角色（第二十六版）：職業、六項屬性與修正值、生命與負重上限、升級加點、技能用了就成長、起始裝備；
// 第二十八版加上出手的算法（profile：傷害骰、屬性、技能、重型、暴擊門檻、精通）、射程與攻擊速度。
// 冒險者的資料放在 player：cls 職業、attr 六項屬性（str、dex、con、int、wis、cha）、skills 各技能 { lv 等級, n 這一級已經用了幾次 }、
// points 還沒分配的屬性點、armorActs 穿中甲或重甲累積的動作數。遊戲內的文字一律只寫世界裡看得到的現象。
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
  // 負重上限＝職業基礎＋力量修正值
  const carryLimit = (p) => cls(p).carry + attrMod(p, 'str');

  // ---- 技能 ----
  const skillLv = (p, id) => (p.skills && p.skills[id] ? p.skills[id].lv : 0);
  // 從 lv 級升到 lv＋1 要用幾次
  const skillNeed = (lv) => C.SKILL_USE[0] + C.SKILL_USE[1] * lv;
  const freshSkills = () => Object.fromEntries(Object.keys(FE.SKILLS).map((k) => [k, { lv: 0, n: 0 }]));

  // 武器對應的技能（長劍、長槍、短矛、短刀、弓箭、法杖）；空手沒有
  // w 是哪一把武器（沒給就是主手；副手的短刀要傳進來）
  function weaponSkill(p, w) {
    const g = w === undefined ? p.equip.main : w;
    return g && FE.SKILLS[g.type] && FE.SKILLS[g.type].weapon ? g.type : null;
  }
  // 武器技能：命中每 5 級 +1（出手 d20）、傷害每 3 級 +1（遠程只加傷害，命中看射擊，見 profile）
  function skillHit(p, w) {
    const s = weaponSkill(p, w);
    return s ? Math.floor(skillLv(p, s) / C.SKILL_HIT_EVERY) : 0;
  }
  function skillDmg(p, w) {
    const s = weaponSkill(p, w);
    return s ? Math.floor(skillLv(p, s) / C.SKILL_DMG_EVERY) : 0;
  }
  const shootHit = (p) => Math.floor(skillLv(p, 'shoot') / C.SKILL_HIT_EVERY);
  // 靈巧武器（短刀）：命中與傷害都取力量與敏捷修正值裡較高的那個
  const isFinesse = (w) => !!w && !!FE.GEAR[w.type].finesse;
  // 近戰一般攻擊、重擊的傷害加值（主手）：力量修正值（可為負；靈巧武器取力量與敏捷較高者）加武器技能
  function dmgBonus(p, w) {
    const g = w === undefined ? p.equip.main : w;
    const str = attrMod(p, 'str');
    return (isFinesse(g) ? Math.max(str, attrMod(p, 'dex')) : str) + skillDmg(p, g);
  }

  // ---- 精通與出手 ----
  // 這把武器的精通冒險者用不用得上：戰士、遊俠一開始就會；法師、牧師要那把武器的技能 5 級。回傳精通的 key 或 null
  function mastery(p, w) {
    const d = w && FE.GEAR[w.type];
    if (!d || !d.mastery) return null;
    return cls(p).mastery || skillLv(p, w.type) >= FE.MASTERY_SKILL ? d.mastery : null;
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

  // 冒險者這一下怎麼算：mode 是 melee（近戰，含觸及）、shoot（弓箭射擊）、throw（投擲）、spell（法師拿法杖的範圍魔攻）、bash（戰士盾擊）；
  // w 是用的武器（null 是徒手），off 是雙持時副手那一下。回傳：
  //   die 傷害骰（徒手是 null，固定 BARE_DMG）、type 傷害種類、hit 出手 d20 的角色加減（品質＋屬性＋技能－超重；不含地形、高處）、
  //   dmg 傷害加值（屬性＋技能）、attr 這一下用的屬性修正值（失衡的機率用）、heavy 重型武器的劣勢、crit 暴擊門檻、
  //   mastery 用得上的精通、skills 這一下練哪些技能、clear 清除等級（抗性）、pierce 穿甲比例
  function profile(p, w, mode, off) {
    const d = w ? FE.GEAR[w.type] : null;
    const q = w ? FE.QUALITIES[w.q || 0] : FE.QUALITIES[0];
    const str = attrMod(p, 'str');
    const dex = attrMod(p, 'dex');
    const load = FE.Gear.loadTier(p);
    const out = { die: null, type: 'blunt', hit: 0, dmg: 0, attr: 0, heavy: false, crit: critMin(p, w), mastery: null, skills: [], clear: q.clear, pierce: q.pierce };
    if (mode === 'bash') {
      // 盾擊：1d4 鈍擊＋力量修正值；沒有精通、不算技能，命中只加敏捷（盾牌沒有命中加值）
      Object.assign(out, { die: C.BASH_DIE, type: 'blunt', hit: dex - load, dmg: str, attr: str, crit: critMin(p, null), clear: 0, pierce: 0 });
      return out;
    }
    if (!d) {
      // 徒手：固定 1 點鈍擊＋力量修正值
      Object.assign(out, { hit: dex - load, dmg: str, attr: str, clear: 0, pierce: 0 });
      return out;
    }
    out.type = d.type;
    out.mastery = mastery(p, w);
    if (mode === 'spell') {
      // 法師的範圍魔攻：1d6 魔法＋智力修正值，命中加智力修正值（取代敏捷），算法杖技能
      const int = attrMod(p, 'int');
      Object.assign(out, { die: C.SPELL_DIE, type: 'magic', hit: q.hit + int + skillHit(p, w) - load, dmg: int + skillDmg(p, w), attr: int, skills: ['staff'] });
      return out;
    }
    const ranged = mode === 'shoot' || mode === 'throw';
    // 用哪一項屬性：靈巧取力量與敏捷較高者；射擊用敏捷；近戰與投擲的傷害用力量，命中照舊用敏捷
    const hitAttr = d.finesse ? Math.max(str, dex) : dex;
    const dmgAttr = d.finesse ? Math.max(str, dex) : mode === 'shoot' ? dex : str;
    // 副手那一下不加屬性修正值，修正值是負數時照扣
    const dmgMod = off ? Math.min(0, dmgAttr) : dmgAttr;
    // 可雙手：副手空著時改用比較大的傷害骰（投擲、射擊不算）
    const sides = mode === 'melee' && d.versatile && !p.equip.off && !off ? d.versatile : d.die[1];
    out.die = [d.die[0], sides];
    out.attr = dmgAttr;
    // 遠程：武器技能只加傷害，命中看射擊；近戰：武器技能加命中與傷害
    out.hit = q.hit + hitAttr + (ranged ? shootHit(p) : skillHit(p, w)) - load;
    out.dmg = dmgMod + skillDmg(p, w);
    out.skills = ranged ? [w.type, 'shoot'] : [w.type];
    // 重型：近戰力量、遠程敏捷不到 13 出手有劣勢
    out.heavy = !!d.heavy && (ranged ? p.attr.dex : p.attr.str) < C.HEAVY_MIN;
    return out;
  }

  // 攻擊動作花幾刻：輕型 8、一般 10、重型 12，減敏捷修正值，最少 6（防具與超重另外疊加，見 game.js 的 endTurn）
  function attackTicks(p, w) {
    const d = w ? FE.GEAR[w.type] : null;
    const base = d && d.heavy ? C.ATTACK_TICKS.heavy : d && d.light ? C.ATTACK_TICKS.light : C.ATTACK_TICKS.normal;
    return Math.max(C.ATTACK_TICKS_MIN, base - attrMod(p, 'dex'));
  }

  // 用了一次：這一級的次數滿了就升級，訊息寫出來。20 級就不再累積
  function useSkill(game, id) {
    const p = game.player;
    const s = p.skills && p.skills[id];
    if (!s || s.lv >= C.SKILL_MAX) return;
    s.n++;
    if (s.n >= skillNeed(s.lv)) {
      s.lv++;
      s.n = 0;
      game.say(`你的${FE.SKILLS[id].name}越練越熟，升到 ${s.lv} 級了。`, 'good');
    }
  }

  // 穿中甲或重甲做的動作：滿 ARMOR_ACTS 個算穿甲行動用一次（每個動作結束時呼叫一次）
  function armorAct(game) {
    const p = game.player;
    const b = p.equip.body;
    if (!b || (b.type !== 'medium' && b.type !== 'heavy')) return;
    p.armorActs = (p.armorActs || 0) + 1;
    if (p.armorActs >= C.ARMOR_ACTS) {
      p.armorActs = 0;
      useSkill(game, 'armor');
    }
  }
  // 穿甲行動的效果：5 級起中甲不多花刻、重甲少 1 刻；10 級起重甲不多花刻；20 級起重甲不再扣閃避
  function armorTicks(p, base) {
    const lv = skillLv(p, 'armor');
    return Math.max(0, base - (lv >= 5 ? 1 : 0) - (lv >= 10 ? 1 : 0));
  }
  const armorDodgeFree = (p) => skillLv(p, 'armor') >= 20;

  // ---- 起始裝備 ----
  // 每組要挑幾樣、挑的是不是都在這組裡、有沒有挑多或挑少；picks 是選項 id 的清單
  function validPicks(clsKey, picks) {
    const c = FE.CLASSES[clsKey];
    if (!c || !Array.isArray(picks)) return false;
    const rest = picks.slice();
    for (const g of c.groups) {
      const mine = rest.filter((id) => g.of.includes(id));
      if (mine.length !== g.pick || new Set(mine).size !== mine.length) return false;
      for (const id of mine) rest.splice(rest.indexOf(id), 1);
    }
    return rest.length === 0;
  }
  // 預設的挑法：每組從前面挑
  const defaultPicks = (clsKey) => FE.CLASSES[clsKey].groups.flatMap((g) => g.of.slice(0, g.pick));

  // 建立冒險者（還沒放上地圖）：職業、起始屬性、生命、固定的與自己挑的裝備。
  // 雙手武器（長槍、弓箭）跟盾牌一起挑的時候，盾牌放進背包
  function create(game, clsKey, picks, name) {
    const c = FE.CLASSES[clsKey];
    if (!validPicks(clsKey, picks)) throw new Error('起始裝備的挑法不對');
    const p = {
      x: 0,
      y: 0,
      cls: clsKey,
      attr: Object.assign({}, c.attr),
      skills: freshSkills(),
      points: 0,
      armorActs: 0,
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
    if (p.equip.main && FE.GEAR[p.equip.main.type].twoHand && p.equip.off) {
      p.bag.push({ id: 'gear', name: FE.Gear.name(p.equip.off), n: 1, gear: p.equip.off });
      p.equip.off = null;
    }
    p.maxHp = p.hp = maxHp(p, 1);
    return p;
  }

  FE.Char = {
    mod, attrMod, cls, maxHp, carryLimit,
    skillLv, skillNeed, freshSkills, weaponSkill, skillHit, skillDmg, shootHit, isFinesse, dmgBonus, useSkill, armorAct, armorTicks, armorDodgeFree,
    mastery, critMin, range, profile, attackTicks,
    validPicks, defaultPicks, create,
  };
})();
