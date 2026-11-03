// 合併測試（每一版都用這支）：node tools/test.js
// 生成統計（40 個種子各創 17 塊）＋3 個種子各 1500 個動作的單人機器人模擬＋一組「只走路不打怪」的對照
// ＋「四人等效」模擬（機器人每做 4 個動作，世界才走 1 回合；每個職業 1 個種子、三個種子輪流用，各至少 3000 個動作、至少創出 15 塊）。
// 檢查：室內走得通、住戶碰得到、聚落周圍沒有怪物（嚴格）、出入口、戰鬥判定、世界狀態、創世耗時、
// 創世門檻（清光一塊的內容一定解得出下一塊）、世界等級加成、城鎮出現時機、士兵的行為、
// 背包與送貨物品、買工具、採集、藥草、怪物出手擲 6～10 不讓冒險者必定反擊、
// 第二十五版：新的可達性檢查跟全世界檢查的結果一致、品質倍率與四捨五入、清除等級與抗性門檻、防具減傷至少吃 1 點、
// 磨損與壞掉、鐵匠／武器匠／盔甲匠的買修打造賣、盾牌歸盔甲匠、負重兩段減值、打造與掉落的品質範圍。
// 機器人會買防具與盾牌、穿上、耐久低時回去修、錢夠時換更好的品質、超重時賣礦石或丟東西。
// 另外量測：競技場（各職業、世界等級 1～7、角色等級 1／5／10／15 打倒小怪物、中型怪物平均用了幾下和被打一下的平均傷害，校準怪物血量的世界等級加成用）、
// 沒有防具與穿重甲時冒險者平均每下受到多少傷害。
// 第二十九版：種族與體型、技能經驗、屬性效果、升級表、擴充武器第一批與弩矢、負重改磅數的場景檢查在 testGrowth29。
// 只跑四人等效模擬（調數字用）：node tools/test.js sim4
// 第二十九版：測試分成很多項「工作」（生成統計的種子區間、每一場模擬、每一組場景檢查、競技場量測），
// 用子行程同時跑（同時幾個看環境變數 FE_JOBS，預設 4），最後把各項結果合起來印報告，並印出每一段耗時。
//   node tools/test.js          全測
//   node tools/test.js quick    快測：只跑場景檢查、競技場量測加一個種子的短模擬
//   node tools/test.js sim4     只跑四人等效模擬
//   node tools/test.js unit     只跑場景檢查
//   node tools/test.js arena    只跑競技場量測（各職業、世界等級、角色等級打倒怪物要幾下）
// 程式拆在 tools/ 底下的幾個檔：共用工具 test-lib.js，各主題 test-*.js。照順序載進同一個全域環境（跟遊戲的 js/*.js 一樣），
// 彼此的 const、let、function 互相看得到；這支只管載入、分派工作、合併結果與印報告
const fs = require('fs');
const path = require('path');
const vm = require('vm');
global.require = require; // 載進來的檔不是模組，借用這支的 require
for (const f of ['test-lib', 'test-gen', 'test-sim', 'test-world', 'test-gear25', 'test-char26', 'test-combat28', 'test-arena', 'test-growth29', 'test-economy30', 'test-skills31']) {
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, f + '.js'), 'utf8'), { filename: path.join(__dirname, f + '.js') });
}

// ---- 工作：子行程各跑一項，主行程把結果合起來 ----
function runJob(id) {
  const [kind, a, b] = id.split(':');
  const steps = QUICK ? 1000 : 1500;
  if (kind === 'gen') {
    const [lo, hi] = a.split('-').map(Number);
    runGen(lo, hi);
  } else if (kind === 'sim') simResults.push(simulate(Number(b), { steps, cls: a }));
  else if (kind === 'lazy') simResults.push(simulate(SEEDS[0], { steps, lazy: true }));
  else if (kind === 'sim4') {
    simResults.push(simulate(Number(b), { worldEvery: 4, scale: 1, minActions: QUICK ? 2000 : 3000, untilChunks: QUICK ? 8 : 15, maxActions: QUICK ? 4000 : MAX_ACTIONS, verifyReach: a === BOT_CLASSES[0] && Number(b) === SEEDS[0], cls: a }));
  } else if (kind === 'cmp') simResults.push(simulate(Number(b), { steps: SIM_CMP_STEPS, cond: a }));
  else if (kind === 'unit') { useClasses('legacy'); NO_TIRE = a !== 'economy30'; UNITS[a](); NO_TIRE = false; }
  else if (kind === 'arena') {
    // 競技場量的是幾下打倒：不讓角色累；也不演算事件（第三十版起事件每 100 刻演算，原本要走路才演算，站著打的競技場碰不到；
    // 演算了會把侵蝕的地面變成新的怪物、改動競技場的地形）
    NO_TIRE = true;
    const tick0 = FE.Events.tick;
    FE.Events.tick = () => {};
    runArena(a);
    FE.Events.tick = tick0;
    NO_TIRE = false;
  }
  else throw new Error('不認得的工作 ' + id);
}
// 這個行程累積的所有結果（交給主行程合併）
function collectState() {
  return {
    problems, pcount: problems.count || 0,
    stats, geo, reachCheck, bufferViolations, cutOff, stuckFixes, dlgStats, combat,
    measure: { armorCmp: measure.armorCmp },
    checks: { dlg: dlgChecks, creation: creationChecks, wl: wlChecks, soldier: soldierChecks, bag: bagChecks, gear: gearChecks, char: charChecks, reach: reachChecks, combat: combatChecks, growth: growthChecks, econ: econChecks, spell: spellChecks },
    corruptCal,
    botDrops,
    sims: simResults, arena: arenaData,
  };
}
// 把子行程的結果加進主行程：數字相加、陣列接起來、物件逐項合
function mergeDeep(dst, src) {
  for (const k of Object.keys(src)) {
    const v = src[k];
    if (Array.isArray(v)) dst[k] = (dst[k] || []).concat(v);
    else if (v && typeof v === 'object') mergeDeep(dst[k] || (dst[k] = {}), v);
    else if (typeof v === 'number') dst[k] = (dst[k] || 0) + v;
    else dst[k] = v;
  }
}
function mergeState(part) {
  for (const p of part.problems) if (problems.length < 200) problems.push(p);
  problems.count = (problems.count || 0) + part.pcount;
  mergeDeep(stats, part.stats);
  mergeDeep(geo, part.geo);
  mergeDeep(reachCheck, part.reachCheck);
  mergeDeep(dlgStats, part.dlgStats);
  mergeDeep(combat, part.combat);
  mergeDeep(measure.armorCmp, part.measure.armorCmp);
  bufferViolations += part.bufferViolations;
  stuckFixes += part.stuckFixes;
  botDrops += part.botDrops;
  cutOff.push(...part.cutOff);
  const c = part.checks;
  dlgChecks += c.dlg; creationChecks += c.creation; wlChecks += c.wl; soldierChecks += c.soldier; bagChecks += c.bag;
  gearChecks += c.gear; charChecks += c.char; reachChecks += c.reach; combatChecks += c.combat; growthChecks += c.growth; econChecks += c.econ; spellChecks += c.spell;
  mergeDeep(corruptCal, part.corruptCal);
  simResults.push(...part.sims);
  mergeDeep(arenaData, part.arena);
}
// 工作清單：重的排前面，同時跑 FE_JOBS 個（預設 4）
function buildJobs() {
  const jobs = [];
  const add = (id, w) => jobs.push({ id, w });
  const units = ['gear', 'character', 'combat28', 'growth29', 'economy30', 'spells31', 'dialogs', 'creation', 'worldlevel', 'soldiers', 'backpack', 'reach'];
  if (MODE === 'arena') {
    for (const cls of BOT_CLASSES) add('arena:' + cls, 30);
    return jobs;
  }
  if (!SIM4_ONLY) {
    if (QUICK) {
      for (const cls of BOT_CLASSES) add(`sim:${cls}:${SEEDS[0]}`, 20);
      add('sim4:warrior:' + SEEDS[0], 40);
      add('sim4:mage:' + SEEDS[0], 40);
      add('gen:1-4', 30);
    } else {
      for (let lo = 1; lo <= GEN_SEEDS; lo += 10) add(`gen:${lo}-${lo + 9}`, 40);
      for (const cls of BOT_CLASSES) for (const seed of SEEDS) add(`sim:${cls}:${seed}`, 30);
      add('lazy', 20);
    }
  }
  // 四人等效最花時間：每個職業只跑 1 個種子，三個種子照職業順序輪流用（第三十版起，原本每個職業三個種子都跑）
  if (!UNIT_ONLY && !QUICK) BOT_CLASSES.forEach((cls, i) => add(`sim4:${cls}:${SEEDS[i % SEEDS.length]}`, 100));
  if (!SIM4_ONLY && !QUICK) for (const cond of ['none', 'heavy']) for (const seed of SEEDS) add(`cmp:${cond}:${seed}`, 20);
  if (MODE !== 'sim4') for (const u of units) add('unit:' + u, u === 'gear' || u === 'character' || u === 'combat28' ? 60 : 10);
  if (MODE !== 'sim4') for (const cls of BOT_CLASSES) add('arena:' + cls, 30);
  return jobs.sort((x, y) => y.w - x.w);
}
if (JOB) {
  // 子行程：跑一項工作，把結果交回主行程後結束
  const t0 = Date.now();
  runJob(JOB);
  if (process.send) process.send({ id: JOB, ms: Date.now() - t0, state: collectState() }, () => process.exit(0));
  else {
    // 直接叫起來（不經主行程）：只印這一項的耗時、模擬結果和問題，調數字、查單項用
    for (const s of simResults) console.log(JSON.stringify(s));
    if (Object.keys(corruptCal).length) console.log('侵蝕校準', JSON.stringify(corruptCal));
    console.log(`耗時 ${((Date.now() - t0) / 1000).toFixed(1)} 秒｜問題 ${problems.count || 0} 件`);
    for (const p of problems) console.log('  ', p);
  }
} else {
  const T0 = Date.now();
  const jobs = buildJobs();
  const N = Math.max(1, Number(process.env.FE_JOBS) || 4);
  let next = 0;
  let running = 0;
  let failed = 0;
  const finish = () => {
    // 全部跑完：印報告
    const wall = Date.now() - T0;
    report(wall);
  };
  const launch = () => {
    while (running < N && next < jobs.length) {
      const job = jobs[next++];
      running++;
      const child = cp.fork(__filename, ['--job', job.id], { env: Object.assign({}, process.env, { FE_MODE: MODE }) });
      let got = false;
      child.on('message', (m) => {
        got = true;
        mergeState(m.state);
        jobSecs.push([m.id, m.ms]);
      });
      child.on('exit', (code) => {
        running--;
        if (!got) {
          failed++;
          fail(`工作 ${job.id} 沒有交回結果（結束碼 ${code}）`);
        }
        if (next < jobs.length) launch();
        else if (running === 0) finish();
      });
    }
  };
  if (!jobs.length) finish();
  else launch();
}

// ---- 報告 ----
function report(wall) {
const bySeed = (a, b) => (a.cls === b.cls ? a.seed - b.seed : BOT_CLASSES.indexOf(a.cls) - BOT_CLASSES.indexOf(b.cls));
const sim = simResults.filter((s) => !s.lazy && s.worldEvery === 1 && !s.cond && s.cls !== '中性').sort(bySeed);
const lazySim = simResults.find((s) => s.lazy) || null;
const sim4 = simResults.filter((s) => s.worldEvery > 1).sort(bySeed);
const avg =(a, f) => (a.length ? (a.reduce((s, x) => s + f(x), 0) / a.length).toFixed(2) : '-');
const rate = (a, f) => `${a.filter(f).length}/${a.length}`;
for (const k of ['village', 'town']) {
  const a = stats[k];
  console.log(`${k}: ${a.length} 座｜民房蓋齊 ${rate(a, (s) => s.houses >= s.want)}｜工坊 ${rate(a, (s) => s.smithy)}｜神殿與市場 ${rate(a, (s) => s.temple && s.market)}｜出入口（量到）${avg(a, (s) => s.groups)}｜平均民房 ${avg(a, (s) => s.houses)}（8 格 ${avg(a, (s) => s.big)}）｜床 ${avg(a, (s) => s.beds)}｜村民 ${avg(a, (s) => s.villagers)}`);
  console.log(`  外形：平均外接矩形 ${avg(a, (s) => s.gw)}×${avg(a, (s) => s.gh)}（工作範圍 ${k === 'town' ? C.TOWN_W + '×' + C.TOWN_H : C.VILLAGE_W + '×' + C.VILLAGE_H}），佔工作範圍 ${avg(a, (s) => s.garea)}，牆內空地（走道與零碎空地）佔聚落 ${avg(a, (s) => s.gopen)}`);
}
console.log(`貼著外牆有 3 格以上水或巨石的聚落：${geo.nearBlock}/${geo.count}`);
console.log(`地貌 ${stats.landmarks}，沒放成 ${stats.landmarkMiss}｜每塊創世平均 ${avg(stats.ms, (x) => x)} ms，最慢 ${stats.ms.length ? Math.max(...stats.ms).toFixed(0) : '-'} ms（${stats.ms.length} 塊，不含比對舊檢查的時間）｜城鎮沒蓋成盔甲匠工坊 ${stats.noArmory || 0} 座`);
console.log(`可達性：跟全世界檢查逐次比對 ${reachCheck.compared} 次（含四人等效模擬途中被侵蝕、修復過的世界）｜新做法的掃描共 ${reachCheck.newMs.toFixed(0)} ms；對照的舊做法（全世界走一遍＋掃一遍）比對共 ${reachCheck.fullMs.toFixed(0)} ms`);
console.log(`出入口不足、生出斷層怪物的聚落：${stats.gateBugs} 座｜民房或床位沒蓋齊（可接受的粗糙）：${stats.short.length} 件`);
const countOf = (a) => a.reduce((m, x) => ((m[x] = (m[x] || 0) + 1), m), {});
if (!SIM4_ONLY) {
  console.log(`城鎮：第一座都在第 ${JSON.stringify(countOf(stats.firstTowns))} 塊｜之後相隔 ${JSON.stringify(countOf(stats.townGaps))} 塊（次數）｜士兵共 ${stats.soldiers} 位`);
  console.log(`創世門檻檢查 ${creationChecks} 項｜世界等級檢查 ${wlChecks} 項｜士兵場景檢查 ${soldierChecks} 項`);
}
for (const s of sim) console.log('單人模擬', JSON.stringify(s));
if (lazySim) console.log('對照（只走路不打怪）', JSON.stringify(lazySim));
for (const s of sim4) console.log('四人等效（世界每 4 個動作走 1 回合，每個動作的算力不乘 4）', JSON.stringify(s));
console.log(`背包、工具、採集、藥草、艱難選擇的場景檢查 ${bagChecks} 項｜裝備與物品的場景檢查 ${gearChecks} 項｜角色（職業、屬性、生命與負重、加點、技能）的場景檢查 ${charChecks} 項｜可達性快取的場景檢查 ${reachChecks} 項｜戰鬥（第二十八版）的場景檢查 ${combatChecks} 項｜角色與成長（第二十九版）的場景檢查 ${growthChecks} 項`);
// 競技場量測（第二十九版，取代原本從世界模擬統計的下數）：每個職業、角色等級 1／5／10／15、世界等級 1～7，
// 把角色（屬性點照主屬性分配、技能練到合理等級、裝備品質照世界等級）和怪物直接放在一塊空地對打，量打倒小怪物、中型怪物各要幾下
// （冒險者自己出手的次數，不含反擊；遠程職業站在 3 格外射）和被怪物打一下的平均傷害。目標：小怪物約 3 下、中型怪物約 6 下
{
  const mean = (c, t) => (c[t].n ? (c[t].sum / c[t].n).toFixed(1) : '-');
  const taken = (c, t) => (c[t].n ? (c[t].dmg / c[t].n).toFixed(2) : '-');
  const hitDmg = (c, t) => (c[t].n ? (c[t].dmg / Math.max(1, c[t].hit)).toFixed(2) : '-');
  const levels = QUICK ? [1, 15] : ARENA_LEVELS;
  const wls = QUICK ? [1, 4, 7] : [1, 2, 3, 4, 5, 6, 7];
  const trialsText = QUICK ? 10 : 40;
  console.log(`競技場量測（每格 ${trialsText} 場對打；怪物血量的世界等級加成 ${C.WL_BONUS.HP}／級；技能經驗照機器人實測的比例（主武器 ×${SKILL_PER_EXP.main}、格鬥或射擊 ×${SKILL_PER_EXP.fight}、穿甲 ×${SKILL_PER_EXP.armor}、閃避 ×${SKILL_PER_EXP.dodge}、盾牌使用 ×${SKILL_PER_EXP.shield} 角色累計經驗值）；裝備品質隨世界等級）：打倒小怪物／中型怪物平均幾下`);
  for (const cls of BOT_CLASSES) {
    const a = arenaData[cls];
    if (!a) continue;
    console.log(`  【${FE.CLASSES[cls].name}】世界等級：${wls.join('　')}`);
    for (const L of levels) {
      if (!a[L]) continue;
      console.log(`    角色等級 ${String(L).padStart(2)}：` + wls.map((wl) => `${mean(a[L][wl], 'small')}／${mean(a[L][wl], 'mid')}`).join('　'));
    }
  }
  console.log('  被怪物打一下平均受到的傷害（小怪物／中型怪物；括號是命中時）：');
  for (const cls of BOT_CLASSES) {
    const a = arenaData[cls];
    if (!a) continue;
    console.log(`  【${FE.CLASSES[cls].name}】世界等級：${wls.join('　')}`);
    for (const L of levels) {
      if (!a[L]) continue;
      console.log(`    角色等級 ${String(L).padStart(2)}：` + wls.map((wl) => `${taken(a[L][wl], 'takenSmall')}／${taken(a[L][wl], 'takenMid')}（${hitDmg(a[L][wl], 'takenSmall')}／${hitDmg(a[L][wl], 'takenMid')}）`).join('　'));
    }
  }
  // 各職業：四人等效模擬第一次進動盪、失序時的世界等級（每個種子一場）
  console.log('四人等效第一次進動盪／失序時的世界等級：' + BOT_CLASSES.map((cls) => `${FE.CLASSES[cls].name} ${sim4.filter((s) => s.cls === cls).map((s) => `${s.firstUnrestWL == null ? '無' : s.firstUnrestWL}/${s.firstChaosWL == null ? '無' : s.firstChaosWL}`).join('、')}`).join('｜'));
  console.log('模擬結束時的技能等級（單人 1500 動作／四人等效）：');
  for (const cls of BOT_CLASSES) for (const s of sim.concat(sim4).filter((x) => x.cls === cls)) console.log(`    ${FE.CLASSES[cls].name} seed${s.seed} ${s.worldEvery > 1 ? '四人等效' : '單人'}（${s.actions} 個動作）：${s.skills}｜${s.attr}｜生命 ${s.hp}｜負重 ${s.weight}｜${s.over}`);
  {
    const all = sim.concat(sim4);
    const o = all.reduce((t, s) => t + s.overActs, 0);
    const n = all.reduce((t, s) => t + s.actions, 0);
    console.log(`正常玩法（機器人）下超過能背的重量：${o} / ${n} 個動作（${(100 * o / Math.max(1, n)).toFixed(2)}%）｜機器人因為超重丟東西 ${botDrops} 次`);
  }
  // 防具對照：同樣的種子、動作數，沒有防具 vs 穿重甲（都不拿盾牌），冒險者被怪物打一下平均受到多少傷害
  const cmp = measure.armorCmp;
  const line = (c, name) => (cmp[c] ? `${name} 每下 ${(cmp[c].dmg / cmp[c].n).toFixed(2)} 點傷害（怪物出手 ${cmp[c].n} 次、打中 ${cmp[c].hit} 次、命中時平均 ${(cmp[c].dmg / Math.max(1, cmp[c].hit)).toFixed(2)}）` : `${name} -`);
  console.log(`防具對照（${SEEDS.length} 個種子各 ${SIM_CMP_STEPS} 個動作，單人）：${line('none', '沒有防具')}｜${line('heavy', '穿重甲')}${cmp.none && cmp.heavy ? `｜重甲是沒防具的 ${((cmp.heavy.dmg / cmp.heavy.n) / (cmp.none.dmg / cmp.none.n) * 100).toFixed(0)}%` : ''}`);
}
// 第三十版：時間與經濟
{
  console.log(`時間與經濟（第三十版）的場景檢查 ${econChecks} 項｜施法（第三十一版）的場景檢查 ${spellChecks} 項`);
  const cal = Object.keys(corruptCal).sort((a, b) => a - b).map((k) => { const r = corruptCal[k]; return `每回合 ${k}：${r.nights} 晚、附近怪物 ${r.monsters} 隻、侵蝕 ${r.corrupt} 次（每隻 ${(r.corrupt / Math.max(1, r.monsters)).toFixed(2)} 次、每晚多出 ${(r.tiles / Math.max(1, r.nights)).toFixed(1)} 格扭曲地面）`; });
  if (cal.length) console.log(`  侵蝕校準（長休一晚 80 回合）：${cal.join('｜')}`);
  const all = sim.concat(sim4);
  if (all.length) {
    for (const s of all) console.log(`  ${FE.CLASSES[s.cls] ? FE.CLASSES[s.cls].name : s.cls} seed${s.seed} ${s.worldEvery > 1 ? '四人等效' : '單人'}（${s.actions} 動作、${s.days} 天）：長休 ${s.longRests} 次、平均每次付 ${FE.money(s.longRests ? s.restPaid / s.longRests : 0)}、短休 ${s.shortRests}｜經濟標籤 升 ${s.econUp}、降 ${s.econDown}（結束時 ${s.econEnd}）｜力竭最高 ${s.exhaustMax} 級｜完成委託 清除 ${s.jobs.hunt}、送貨 ${s.jobs.deliver}、採藥 ${s.jobs.herb}、採礦 ${s.jobs.ore}，同時最多 ${s.jobsMax} 個｜身上 ${FE.money(s.money)}`);
    const sum = (k) => all.reduce((a, s) => a + s[k], 0);
    console.log(`  合計：長休 ${sum('longRests')} 次、平均每次付 ${FE.money(sum('longRests') ? sum('restPaid') / sum('longRests') : 0)}｜經濟標籤 升 ${sum('econUp')} 次、降 ${sum('econDown')} 次｜力竭最高 ${Math.max(...all.map((s) => s.exhaustMax))} 級`);
  }
}
console.log(`對話：邏輯檢查 ${dlgChecks} 項｜機器人開了 ${dlgStats.opened} 次對話（接委託 ${dlgStats.accept}、交件 ${dlgStats.deliver}、交藥草 ${dlgStats['hand:herb']}、交礦石 ${dlgStats['hand:ore']}、回報 ${dlgStats.report}；工匠那裡買 ${dlgStats.buy}、修 ${dlgStats.repair}、打造 ${dlgStats.craft}、賣礦石 ${dlgStats.sellOre}、賣裝備 ${dlgStats.sell}；離開 ${dlgStats.leave}）`);
console.log(`聚落周圍的怪物（任何時刻、含生成點）：違規 ${bufferViolations} 次｜機器人被村民夾在屋裡、等村民走開 ${stuckFixes} 次`);
const pct = (n, d) => (d ? (100 * n / d).toFixed(1) + '%' : '-');
const dist = (t) => { const n = Object.values(t).reduce((a, b) => a + b, 0); return ['crit', 'hit', 'hard', 'miss', 'fumble'].map((k) => `${k} ${pct(t[k] || 0, n)}`).join('、') + `（共 ${n}）`; };
console.log(`戰鬥：判定 ${combat.events} 次｜冒險者出手 ${dist(combat.player)}｜怪物出手 ${dist(combat.monster)}`);
console.log(`  閃避 ${combat.dodged}、格擋 ${combat.blocked}、暴擊 ${combat.crit}、抗性 ${combat.resisted}、反擊 ${combat.counters}（連鎖 ${combat.chain}）、趁機攻擊 ${combat.opportunity}（打中 ${combat.opportunityHit}）、負傷害 ${combat.negative}｜平均每下 冒險者 ${(combat.pdmg / combat.pn).toFixed(2)}、怪物 ${(combat.mdmg / combat.mn).toFixed(2)}`);
console.log(`從出生點走不到的聚落（世界的斷層）：${cutOff.length} 次 ${cutOff.slice(0, 5).join('、')}`);
console.log(`問題 ${problems.count || 0} 件`);
for (const p of problems) console.log('  ', p);
// 各項工作的耗時（秒，子行程各自量的）和全部的牆鐘時間
{
  const secs = (ms) => (ms / 1000).toFixed(1);
  const group = (re) => jobSecs.filter(([id]) => re.test(id)).reduce((s, [, ms]) => s + ms, 0);
  console.log(`耗時：全部 ${secs(wall)} 秒（同時 ${Math.max(1, Number(process.env.FE_JOBS) || 4)} 個子行程；各項加總 ${secs(jobSecs.reduce((s, [, ms]) => s + ms, 0))} 秒）｜生成統計 ${secs(group(/^gen/))}｜單人模擬 ${secs(group(/^(sim|lazy):/))}｜四人等效 ${secs(group(/^sim4/))}｜防具對照 ${secs(group(/^cmp/))}｜場景檢查 ${secs(group(/^unit/))}｜競技場 ${secs(group(/^arena/))}（加總是各工作的秒數相加）`);
  console.log('  各項：' + jobSecs.slice().sort((a, b) => b[1] - a[1]).map(([id, ms]) => `${id} ${secs(ms)}`).join('、'));
}
}
