// 第三十七版之一：逐把武器的競技場量測（一優一劣、新精通都要在競技場測過，使用者定的）
//   node tools/measure-weapons371.js            全部武器（角色等級 1、15，世界等級 1、7，每格 20 場）
//   FE_TRIALS=40 node tools/measure-weapons371.js
// 做法：近戰與投擲武器套戰士的樣板、射擊武器套遊俠的樣板（tools/test-arena.js 的 arenaGame），主手換成那把武器（品質照世界等級）、
// 副手一律空著（不拿盾，只比武器本身）；那把武器的技能等級＝樣板原本主武器的技能等級；屬性不到需求就補到需求（表上標 *）。
// 量打倒小怪物（哥布林）與中型怪物（熊地精潛獵者）平均幾下、花幾刻（刻數看得出攻擊刻數的優劣）。結果印成表，貼進 MEASURE.md
const fs = require('fs');
const path = require('path');
const vm = require('vm');
global.require = require;
for (const f of ['test-lib', 'test-gen', 'test-sim', 'test-world', 'test-gear25', 'test-gear35', 'test-char26', 'test-combat28', 'test-arena']) {
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, f + '.js'), 'utf8'), { filename: path.join(__dirname, f + '.js') });
}

const TRIALS = Number(process.env.FE_TRIALS) || 20;
const LEVELS = [1, 15];
const WLS = [1, 7];
const weapons = Object.keys(FE.GEAR).filter((k) => FE.GEAR[k].cat === 'weapon');

function weaponGame(type, level, wl, seed) {
  const d = FE.GEAR[type];
  const shooter = !!d.ammo;
  const game = arenaGame(shooter ? 'ranger' : 'warrior', level, wl, seed);
  const p = game.player;
  const baseSkill = p.equip.main ? p.skills[FE.GEAR[p.equip.main.type].skill].lv : 1;
  p.equip.main = FE.Gear.make(type, FE.qualityForWL(wl), game.nextGearId++);
  p.equip.off = null;
  p.skills[d.skill] = { lv: Math.max(1, baseSkill), n: 0 };
  if (d.ammo && p.skills.shoot) p.skills.shoot.lv = Math.max(1, p.skills.shoot.lv);
  let raised = false;
  const e = d.edge || {};
  for (const k of ['str', 'dex']) {
    if (e[k] && p.attr[k] < e[k]) {
      p.attr[k] = e[k];
      raised = true;
    }
  }
  if (d.ammo) game.bagAdd(d.ammo === 'needle' ? 'poisonNeedle' : d.ammo, 500, { q: 0 });
  // 競技場（arenaFight）本來只量各職業的起始武器，有兩處不合逐把武器的量法，在這裡補：
  // 1. 可投擲的近戰武器會被當成遠程，怪物放在 3 格外又不出手，只是原地等；這裡一律當近戰打（投擲另外量不在這張表）
  // 2. 重擊冷卻好就按 2，但重擊沒有觸及：長槍把怪物推到 2 格外時按 2 打不到、也不花時間，一直空轉到 200 下；貼身沒有目標時改按 1
  const rangedMode = game.rangedMode.bind(game);
  game.rangedMode = (q) => {
    const r = rangedMode(q);
    return r && r.mode === 'throw' ? null : r;
  };
  const act = game.act.bind(game);
  game.act = (k) => act(k === 'deep' && !game.targetMonster() ? 'attack' : k);
  return { game, raised };
}

const rows = [];
for (const type of weapons) {
  const d = FE.GEAR[type];
  const row = { name: d.name, cells: [], raised: false };
  for (const level of LEVELS) {
    for (const wl of WLS) {
      // 同一個角色連打 TRIALS 場（亂數接著走，每場不一樣；每場開頭由 arenaFight 補滿血與耐久）
      const { game, raised } = weaponGame(type, level, wl, 9001);
      row.raised = row.raised || raised;
      for (const tier of ['small', 'mid']) {
        let hits = 0;
        let ticks = 0;
        let unfinished = 0;
        for (let i = 0; i < TRIALS; i++) {
          if (d.ammo) game.bagAdd(d.ammo === 'needle' ? 'poisonNeedle' : d.ammo, 50, { q: 0 });
          game.player.x = game.player.x; // 位置不動：arenaFight 把怪物放在旁邊或 3 格外
          const t0 = game.ticks;
          const n = arenaFight(game, tier, wl, i);
          hits += n;
          ticks += game.ticks - t0;
          if (n >= 200) unfinished++;
        }
        row.cells.push({ level, wl, tier, hits: hits / TRIALS, ticks: ticks / TRIALS, unfinished });
      }
    }
  }
  rows.push(row);
  process.stderr.write('.');
}
process.stderr.write('\n');

// 表：每把武器一列，欄是「角色等級／世界等級」下打倒小怪物、中型怪物平均幾下（刻數）
const head = [];
for (const level of LEVELS) for (const wl of WLS) head.push(`Lv${level}／世界${wl}`);
console.log(`逐把武器競技場（每格 ${TRIALS} 場；小怪物／中型怪物平均幾下，括號是平均刻數；*N 是 200 下打不倒的場數；* 表示屬性補到需求）`);
console.log(`| 武器 | ${head.join(' | ')} |`);
console.log(`|---|${head.map(() => '---').join('|')}|`);
for (const r of rows) {
  const parts = [];
  for (let i = 0; i < r.cells.length; i += 2) {
    const s = r.cells[i];
    const m = r.cells[i + 1];
    const f = (c) => `${c.hits.toFixed(1)}（${Math.round(c.ticks)}）${c.unfinished ? '*' + c.unfinished : ''}`;
    parts.push(`${f(s)}／${f(m)}`);
  }
  console.log(`| ${r.name}${r.raised ? ' *' : ''} | ${parts.join(' | ')} |`);
}
