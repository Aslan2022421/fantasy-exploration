// 競技場量測：等級 L 角色與怪物在空地對打（第二十九版）
// ---- 等級 L 角色與競技場（第二十九版）----
// 第三十六版之一：建「等級 L 角色」的做法（屬性點照職業主屬性與體質輪流分配、技能照累計經驗換算、裝備品質照世界等級）搬進遊戲程式
// （js/char.js 的 applyTemplate、makeLevelChar，士兵與隊友也用；起始裝備與種族在 config.js 的 FE.TEMPLATE_PICKS、FE.TEMPLATE_BODY，技能經驗比例在 FE.TEMPLATE_PER_EXP），
// 這裡只剩開新世界、呼叫遊戲裡的版本
const SKILL_PER_EXP = FE.TEMPLATE_PER_EXP;
const skillLevelFor = FE.Char.skillLevelFor;
const qualityForWL = FE.qualityForWL;
// 建立「等級 L 角色」：開新世界時挑職業的機器人起始裝備與種族，再套上等級與世界等級。回傳新遊戲；level 1、wl 1 就是剛開局的角色
function makeLevelChar(cls, level, wl, seed) {
  const game = new FE.Game(seed || 9001);
  const picks = FE.Char.validPicks(cls, BOT_PICKS[cls]) ? BOT_PICKS[cls] : FE.Char.defaultPicks(cls); // 舊職業定義下（場景檢查）機器人的挑法不一定合法
  game.start({ cls, picks, body: BOT_BODY[cls] });
  game.level = level;
  game.exp = FE.levelExp(level);
  FE.Char.applyTemplate(game.player, level, wl);
  return game;
}
// 競技場：把冒險者放在一塊整平的空地上（聚落的圈外），怪物也直接放上去對打；關掉創世、掉落、經驗值，免得量測途中角色變了
function arenaGame(cls, level, wl, seed) {
  const game = makeLevelChar(cls, level, wl, seed);
  const w = game.world;
  const p = game.player;
  // 機器人開局沒有擲起始技能（全部 0 級），真正的玩家一定擲過，挑的武器至少 1 級。1 級角色累計經驗是 0，技能會算成 0 級、沒有熟練加值，
  // 比真正開局的角色弱；所以競技場裡出手用的技能（近戰武器、射擊、杖術）至少算 1 級（第三十三版之一）
  const mainW = p.equip.main ? FE.GEAR[p.equip.main.type] : null;
  for (const k of [mainW && mainW.skill, mainW && mainW.ammo && 'shoot', FE.CLASSES[cls].spell && 'staff']) if (k && p.skills[k] && p.skills[k].lv < 1) p.skills[k].lv = 1;
  let spot = null;
  w.forEachCell((x, y) => {
    if (spot || w.inBuffer(x, y) || !w.passable(x, y)) return;
    if (!w.inBounds(x - 6, y - 6) || !w.inBounds(x + 6, y + 6)) return;
    for (let dy = -6; dy <= 6; dy += 3) for (let dx = -6; dx <= 6; dx += 3) if (w.inBuffer(x + dx, y + dy)) return;
    spot = { x, y };
  });
  for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
    w.setCell(spot.x + dx, spot.y + dy, '.', 'plain');
    w.setHeight(spot.x + dx, spot.y + dy, 0);
  }
  game.monsters = [];
  game.world.chests = [];
  p.x = spot.x;
  p.y = spot.y;
  game.checkCreate = () => {};
  game.addExp = () => {};
  game.dropChest = () => {};
  game.dropGear = () => {};
  game.defeat = (m) => { game.monsters = game.monsters.filter((o) => o !== m); if (game.battle.targetId === m.id) game.battle.targetId = null; };
  return game;
}
const ARENA_TYPES = ['DECAY']; // 第三十六版前整理：錯的種類不再影響怪物怎麼打，競技場一律用衰敗
const ARENA_SCOPE = { small: [2, 4], mid: [6, 10] };
// 第三十三版起種族決定數值塊：競技場一律用同一個種族（預設哥布林，整平的空地本來就是哥布林；FE_ARENA_RACE 可以指定別的種族）。
// 原本看腳下的生態區，對打途中怪物侵蝕地面（苔原、沙漠）之後，後面生的怪物會變成雪怪、骷髏
const ARENA_RACE = process.env.FE_ARENA_RACE || 'goblin';
// 第三十三版之二：哥布林沒有中怪物，中型改用同一片平原的中怪物熊地精潛獵者（FE_ARENA_MID 可以指定別的種族）
const ARENA_MID = process.env.FE_ARENA_MID || 'bugbear';
function arenaMonster(game, tier, wl, i, dx) {
  const p = game.player;
  const sc = ARENA_SCOPE[tier][i % 2];
  const race = tier === 'mid' ? ARENA_MID : ARENA_RACE;
  const m = FE.makeMonster({ type: ARENA_TYPES[i % ARENA_TYPES.length], x: p.x + dx, y: p.y, cells: [], scope: sc, data: {}, race, block: tier === 'mid' ? 'mid' : 'small' }, 700000 + i, wl);
  m.name = FE.monsterName(m);
  m.home = { x: m.x, y: m.y };
  game.monsters = [m];
  return m;
}
// 一場對打：打到怪物倒下，數冒險者自己出手幾下（遠程的職業站在 3 格外射，牠被設成目標後會纏上來；貼身的職業貼著打）。冒險者每下都補滿血
function arenaFight(game, tier, wl, i) {
  const p = game.player;
  const ranged = game.rangedMode(true);
  const m = arenaMonster(game, tier, wl, i, ranged ? 3 : 1);
  let n = 0;
  game.battle.cooldown = 0;
  const maxHp = p.maxHp;
  p.maxHp = 1e9; // 對打時冒險者不會倒下（倒下會被送回聚落，後面就打不下去了）
  let low = m.hp; // 整場最低的血量（會再生的沼澤巨魔每回合回血，傷害追不上時血量一直是滿的，不拿來判斷競技場壞了）
  for (; n < 200 && game.monsters.includes(m); n++, low = Math.min(low, m.hp)) {
    p.hp = p.maxHp;
    for (const g of FE.Gear.equipped(p)) g.dur = g.max;
    if (game.bagCount('arrow') < 5) game.bagAdd('arrow', 20);
    const rm = game.rangedMode(true);
    if (rm && rm.mode !== 'throw' && game.shootTargets(rm.range).includes(m)) game.fireAt(m);
    else if (!game.targetMonster() && !game.reachTarget()) {
      // 法術冷卻中、怪物還沒貼上來：站著過一回合，等牠走過來（第三十一版，法術有冷卻）
      game.beginAction();
      game.endTurn(false);
    } else {
      game.battle.targetId = m.id;
      game.act(game.battle.cooldown === 0 && m.hp > 8 ? 'deep' : 'attack');
    }
  }
  p.maxHp = maxHp;
  p.hp = maxHp;
  // 200 下打不倒：第三十三版起是量測結果（怪物照 SRD 變硬，低等級角色打中型怪物可能打不完），記下場數、照 200 下算進平均，不算問題；
  // 怪物沒受傷（打不到、卡住）才是競技場本身壞了
  if (n >= 200 && low >= m.maxHp && !m.regen) fail(`競技場 ${game.player.cls} 一下都沒打到 ${m.name}（世界等級 ${wl}）：相對位置 ${m.x - p.x},${m.y - p.y}，${game.log.slice(0, 2).map((l) => l.text).join('｜')}`);
  game.monsters = [];
  return n;
}
// 被怪物打一下：怪物貼著冒險者出手 N 次，量平均傷害與打中比例（技能、耐久每次還原，免得量測途中變強）
function arenaTaken(game, tier, wl, N, i0) {
  const p = game.player;
  const m = arenaMonster(game, tier, wl, i0, 1);
  const skills = JSON.stringify(p.skills);
  let dmg = 0;
  let hit = 0;
  const maxHp = p.maxHp;
  p.maxHp = 1e9;
  for (let i = 0; i < N; i++) {
    p.hp = p.maxHp;
    p.block = null;
    for (const g of FE.Gear.equipped(p)) g.dur = g.max;
    const r = FE.Combat.resolveAttack(game, m, p, 'attack', { noCounter: true });
    dmg += r.dmg;
    if (r.dmg > 0) hit++;
    if (i % 25 === 24) p.skills = JSON.parse(skills);
  }
  p.skills = JSON.parse(skills);
  p.maxHp = maxHp;
  p.hp = maxHp;
  game.monsters = [];
  return { n: N, dmg, hit };
}
// 競技場量測：每個職業、世界等級 1～7、角色等級 1／5／10／15，量打倒小怪物、中型怪物各要幾下和被打一下的平均傷害。
// 結果放在 arenaData[職業][角色等級][世界等級]：{ small: { n 場數, sum 總下數 }, mid: {...}, takenSmall: { n, dmg, hit }, takenMid: {...} }
const ARENA_LEVELS = [1, 5, 10, 15];
function runArena(cls) {
  const levels = QUICK ? [1, 15] : ARENA_LEVELS;
  const wls = QUICK ? [1, 4, 7] : [1, 2, 3, 4, 5, 6, 7];
  const trials = QUICK ? 10 : 40;
  const out = (arenaData[cls] = {});
  const hook0 = FE.Combat.hook;
  FE.Combat.hook = null; // 競技場的判定不算進戰鬥統計
  for (const L of levels) {
    out[L] = {};
    for (const wl of wls) {
      const game = arenaGame(cls, L, wl, 9001 + BOT_CLASSES.indexOf(cls));
      const cell = (out[L][wl] = { small: { n: 0, sum: 0, stuck: 0 }, mid: { n: 0, sum: 0, stuck: 0 }, takenSmall: { n: 0, dmg: 0, hit: 0 }, takenMid: { n: 0, dmg: 0, hit: 0 } });
      const snap = JSON.stringify(game.player.skills);
      for (const tier of ['small', 'mid']) {
        for (let i = 0; i < trials; i++) {
          game.player.skills = JSON.parse(snap);
          const k = arenaFight(game, tier, wl, i);
          cell[tier].n++;
          cell[tier].sum += k;
          if (k >= 200) cell[tier].stuck++; // 200 下打不倒的場數
        }
        game.player.skills = JSON.parse(snap);
        const t = arenaTaken(game, tier, wl, trials * 10, 0);
        Object.assign(cell[tier === 'small' ? 'takenSmall' : 'takenMid'], t);
      }
    }
  }
  FE.Combat.hook = hook0;
}

