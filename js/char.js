// 角色（第二十六版）：職業、六項屬性與修正值、生命與負重上限、升級加點、技能用了就成長、起始裝備。
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

  // 主手武器對應的技能（長劍、長槍、短刀、法杖）；空手、弓箭沒有
  // w 是哪一把武器（沒給就是主手；副手的短刀要傳進來）
  function weaponSkill(p, w) {
    const g = w === undefined ? p.equip.main : w;
    return g && FE.SKILLS[g.type] && FE.SKILLS[g.type].weapon ? g.type : null;
  }
  // 近戰武器技能：命中每 5 級 +1（出手 d20）、傷害每 3 級 +1
  function skillHit(p, w) {
    const s = weaponSkill(p, w);
    return s ? Math.floor(skillLv(p, s) / C.SKILL_HIT_EVERY) : 0;
  }
  function skillDmg(p, w) {
    const s = weaponSkill(p, w);
    return s ? Math.floor(skillLv(p, s) / C.SKILL_DMG_EVERY) : 0;
  }
  // 靈巧武器（短刀）：傷害吃力量與敏捷修正值裡較高的那個，算完再 ÷2 無條件進位（見 combat.js 的 baseDamage）
  const isFinesse = (w) => !!w && !!FE.GEAR[w.type].finesse;
  // 冒險者一般攻擊、重擊的傷害加值：力量修正值（可為負；靈巧武器取力量與敏捷較高者）加武器技能
  function dmgBonus(p, w) {
    const g = w === undefined ? p.equip.main : w;
    const str = attrMod(p, 'str');
    return (isFinesse(g) ? Math.max(str, attrMod(p, 'dex')) : str) + skillDmg(p, g);
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

  // 建立冒險者（還沒放上地圖）：職業、起始屬性、生命、固定的與自己挑的裝備
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
      } else if (o.herb) {
        const e = p.bag.find((x) => x.id === 'herb');
        if (e) e.n += o.herb;
        else p.bag.push({ id: 'herb', name: FE.BAG_ITEMS.herb.name, n: o.herb });
      } else if (o.gold) {
        p.gold += o.gold;
      }
    }
    p.maxHp = p.hp = maxHp(p, 1);
    return p;
  }

  FE.Char = {
    mod, attrMod, cls, maxHp, carryLimit,
    skillLv, skillNeed, freshSkills, weaponSkill, skillHit, skillDmg, isFinesse, dmgBonus, useSkill, armorAct, armorTicks, armorDodgeFree,
    validPicks, defaultPicks, create,
  };
})();
