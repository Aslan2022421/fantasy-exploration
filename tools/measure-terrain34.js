// 第三十四版草稿：地形量測。用好幾個種子各創開局＋16 段（長滿 288×288），量地形的數字，幾組參數並排比較。
//   node tools/measure-terrain34.js                 跑全部的組
//   node tools/measure-terrain34.js 推薦 山多        只跑指定的組
//   FE_SEEDS=10                                      種子數（預設 10）
//   FE_ROOT=<別的 js 資料夾> node ... 舊版          量別的版本（例如 v33 的 worktree），只跑「舊版」一組、不蓋設定
// 只用 World（不開 Game、不生怪物），所以量的是生成器本身的地形：生態區佔比、湖、山地、斷崖、山壁、隘口、聚落出口、採集點、走不到的格子
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = process.env.FE_ROOT ? path.resolve(process.env.FE_ROOT) + path.sep : path.join(__dirname, '..', 'js') + path.sep;
global.window = global;
for (const f of ['config', 'rng', 'world', 'checker', 'bugs', 'steading', 'char', 'gear', 'combat', 'stability', 'events', 'ai', 'game', 'save']) {
  vm.runInThisContext(fs.readFileSync(ROOT + f + '.js', 'utf8'), { filename: f + '.js' });
  if (f === 'rng') {
    const mem = new Map();
    FE.store = { load: (k, d) => (mem.has(k) ? mem.get(k) : d), save: (k, v) => mem.set(k, v), remove: (k) => mem.delete(k) };
  }
}
const C = FE.CONFIG;
const SEEDS = Number(process.env.FE_SEEDS) || 10;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// 參數組：每組只寫跟目前設定（config.js）不同的地方
const VARIANTS = process.env.FE_ROOT
  ? [{ name: '舊版', cfg: {} }]
  : [
      { name: '推薦', cfg: {} },
      { name: '山少', cfg: { RANGE_CUT: 0.84 } },
      { name: '山多', cfg: { RANGE_CUT: 0.76 } },
      { name: '湖少', cfg: { LAKE_CUT: 0.75 } },
      { name: '湖多', cfg: { LAKE_CUT: 0.69 } },
      { name: '湖小而多', cfg: { LAKE_SCALE: 22 } },
      { name: '丘陵多', cfg: { HILL_FLOOR: 0.3 } },
      { name: '有巨石', cfg: { ROCKS_MUL: 1 } },
      { name: '隘口寬 3', cfg: { PASS_GAP: 3, PASS_LEN: [56, 80] } },
    ];

const BIOME_ORDER = ['plain', 'grassland', 'shrubland', 'forest', 'taiga', 'tundra', 'glacier', 'mountain', 'jungle', 'savanna', 'desert', 'marsh', 'swamp', 'lake'];

// 連在一起的一片（上下左右），test(x, y) 決定哪些格子算
function components(w, test) {
  const b = w.bounds();
  const W = b.x1 - b.x0;
  const seen = new Uint8Array(W * (b.y1 - b.y0));
  const out = [];
  for (let y = b.y0; y < b.y1; y++) {
    for (let x = b.x0; x < b.x1; x++) {
      const i = (y - b.y0) * W + (x - b.x0);
      if (seen[i] || !w.cell(x, y) || !test(x, y)) continue;
      seen[i] = 1;
      const q = [[x, y]];
      for (let h = 0; h < q.length; h++) {
        for (const [dx, dy] of DIRS) {
          const nx = q[h][0] + dx;
          const ny = q[h][1] + dy;
          if (nx < b.x0 || nx >= b.x1 || ny < b.y0 || ny >= b.y1) continue;
          const j = (ny - b.y0) * W + (nx - b.x0);
          if (seen[j] || !w.cell(nx, ny) || !test(nx, ny)) continue;
          seen[j] = 1;
          q.push([nx, ny]);
        }
      }
      out.push(q);
    }
  }
  return out;
}

// 聚落的出口走不走得出去：出口是聚落外面、貼著聚落的路（·）連成的一段；從那裡不穿過聚落，走得到離聚落外框 D 格以外（或世界邊緣）就算走得出去
function exitsBlocked(w, v) {
  const D = w.bufferWidth(v) + 3;
  const mouths = new Set();
  for (let y = v.y0 - 1; y <= v.y1 + 1; y++) {
    for (let x = v.x0 - 1; x <= v.x1 + 1; x++) {
      const c = w.cell(x, y);
      if (!c || c.t !== '·' || w.villageAt(x, y) === v) continue;
      if (DIRS.some(([dx, dy]) => w.villageAt(x + dx, y + dy) === v)) mouths.add(x + ',' + y);
    }
  }
  // 同一個出口的幾格併成一組
  const groups = [];
  const used = new Set();
  for (const k of mouths) {
    if (used.has(k)) continue;
    const g = [k.split(',').map(Number)];
    used.add(k);
    for (let i = 0; i < g.length; i++) {
      for (const [dx, dy] of DIRS) {
        const nk = g[i][0] + dx + ',' + (g[i][1] + dy);
        if (mouths.has(nk) && !used.has(nk)) {
          used.add(nk);
          g.push(nk.split(',').map(Number));
        }
      }
    }
    groups.push(g);
  }
  let blocked = 0;
  for (const g of groups) {
    const seen = new Set(g.map(([x, y]) => x + ',' + y));
    const q = g.slice();
    let out = false;
    for (let h = 0; h < q.length && !out; h++) {
      const [x, y] = q[h];
      const d = Math.max(v.x0 - x, x - v.x1, v.y0 - y, y - v.y1);
      if (d >= D) { out = true; break; }
      for (const [dx, dy] of DIRS) {
        const nx = x + dx;
        const ny = y + dy;
        const k = nx + ',' + ny;
        if (seen.has(k)) continue;
        if (!w.cell(nx, ny)) { out = true; break; } // 世界邊緣（還沒長或最外圈外面）
        if (w.villageAt(nx, ny) === v || !w.canStep(x, y, nx, ny)) continue;
        seen.add(k);
        q.push([nx, ny]);
      }
    }
    if (!out) blocked++;
  }
  return { exits: groups.length, blocked };
}

// 隘口的繞路：隘口兩側各退 4 格，量開著與堵住時要走幾步
function passDetour(w, p) {
  const [px, py] = p.normal;
  const near = (x, y) => {
    for (let r = 0; r <= 3; r++) for (let o = -r; o <= r; o++) {
      const cx = x + (px ? 0 : o);
      const cy = y + (py ? 0 : o);
      if (w.passable(cx, cy)) return [cx, cy];
    }
    return null;
  };
  const a = near(p.x - px * 4, p.y - py * 4);
  const b = near(p.x + px * 4, p.y + py * 4);
  if (!a || !b) return null;
  const steps = () => {
    const d = w.stepMap([a], b[0] + ',' + b[1]);
    return d.has(b[0] + ',' + b[1]) ? d.get(b[0] + ',' + b[1]) : Infinity;
  };
  const open = steps();
  const saved = p.gap.map(([x, y]) => [x, y, w.cell(x, y).t, w.cell(x, y).biome]);
  for (const [x, y] of p.gap) w.setCell(x, y, '█', w.cell(x, y).biome);
  const shut = steps();
  for (const [x, y, t, bi] of saved) w.setCell(x, y, t, bi);
  return { open, shut };
}

function measureSeed(seed) {
  const t0 = Date.now();
  const w = new FE.World(seed * 7919);
  // 每段創完時，檢查器在這一段找到的地形錯位與斷崖（怪物地點的候選，game.js 的 pickSites）；量這個的時間不算進生成時間
  const sites = [];
  let scanMs = 0;
  const scan = (rect) => {
    const t = Date.now();
    sites.push(FE.Checker.scan(w, rect, []).filter((d) => d.type === 'TERRAIN' || d.type === 'CLIFF').length);
    scanMs += Date.now() - t;
  };
  scan(w.addRegion(null).rect);
  for (let i = 0; i < 16; i++) {
    const seg = w.nextSegment(w.spawn.x, w.spawn.y);
    if (!seg) break;
    scan(w.addRegion(seg).rect);
  }
  const ms = Date.now() - t0 - scanMs;
  const m = { ms, sites0: sites[0], sites: sites.slice(1), total: 0, pass: 0, biome: {}, hist: [0, 0, 0, 0, 0], cliff: 0, walls: 0, rocks: 0 };
  w.forEachCell((x, y, c) => {
    m.total++;
    m.biome[c.biome] = (m.biome[c.biome] || 0) + 1;
    if (c.t === '█') m.walls++;
    if (c.t === '#' && !w.landmarkAt(x, y)) m.rocks++;
    if (!FE.TERRAIN[c.t].pass) return;
    m.pass++;
    m.hist[c.h]++;
    if (DIRS.some(([dx, dy]) => w.passable(x + dx, y + dy) && Math.abs(w.cell(x + dx, y + dy).h - c.h) >= 2)) m.cliff++;
  });
  // 湖：連在一起的水
  const lakes = components(w, (x, y) => w.cell(x, y).t === '≈').map((q) => q.length);
  m.lakes = lakes;
  // 山地（含冰川）連成的片：200 格以上算一條山脈
  const mt = components(w, (x, y) => ['mountain', 'glacier'].includes(w.cell(x, y).biome)).map((q) => q.length);
  m.mtCells = mt.reduce((s, n) => s + n, 0);
  m.ranges = mt.filter((n) => n >= 200).length;
  m.mtInRanges = mt.filter((n) => n >= 200).reduce((s, n) => s + n, 0);
  // 走不到的格子、採集點
  const reach = FE.Checker.reachable(w);
  let unreach = 0;
  w.forEachCell((x, y, c) => { if (FE.TERRAIN[c.t].pass && !reach.at(x, y)) unreach++; });
  m.unreach = unreach;
  m.nodes = w.nodes.length;
  m.nodesBad = w.nodes.filter((n) => !reach.at(n.x, n.y)).length;
  // 聚落
  m.villages = w.villages.length;
  m.towns = w.villages.filter((v) => v.kind === 'town').length;
  m.exits = 0;
  m.exitsBlocked = 0;
  m.exitsFixed = 0;
  m.backdrops = { lake: 0, wall: 0 };
  for (const v of w.villages) {
    const e = exitsBlocked(w, v);
    m.exits += e.exits;
    m.exitsBlocked += e.blocked;
    m.exitsFixed += v.exitFixed || 0;
    if (v.backdrop) m.backdrops[v.backdrop]++;
  }
  // 隘口
  m.passes = (w.passes || []).length;
  m.passMiss = w.passMiss || 0;
  m.detours = [];
  for (const p of w.passes || []) {
    const d = passDetour(w, p);
    if (d) m.detours.push(d);
  }
  return m;
}

const pct = (a, b) => (b ? ((100 * a) / b).toFixed(1) + '%' : '-');
const avg = (arr) => (arr.length ? arr.reduce((s, n) => s + n, 0) / arr.length : 0);
const med = (arr) => {
  if (!arr.length) return 0;
  const s = arr.slice().sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

const only = process.argv.slice(2);
const results = [];
for (const vr of VARIANTS) {
  if (only.length && !only.includes(vr.name)) continue;
  const saved = {};
  for (const [k, v] of Object.entries(vr.cfg)) { saved[k] = C[k]; C[k] = v; }
  const per = [];
  for (let s = 1; s <= SEEDS; s++) per.push(measureSeed(s));
  for (const [k, v] of Object.entries(saved)) C[k] = v;
  results.push({ name: vr.name, cfg: vr.cfg, per });
  process.stderr.write(`${vr.name} 完成\n`);
}

// ---- 報表：每組一欄 ----
const rows = [];
const row = (label, fn) => rows.push([label, ...results.map((r) => fn(r.per))]);
const sum = (per, f) => per.reduce((s, m) => s + f(m), 0);
row('改了什麼', () => '');
results.forEach((r, i) => { rows[0][i + 1] = Object.entries(r.cfg).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ') || '（目前設定）'; });
for (const b of BIOME_ORDER) row(`生態區：${FE.BIOMES[b].name}`, (per) => pct(sum(per, (m) => m.biome[b] || 0), sum(per, (m) => m.total)));
row('山地＋冰川', (per) => pct(sum(per, (m) => m.mtCells), sum(per, (m) => m.total)));
row('山地裡屬於 200 格以上山脈的比例', (per) => pct(sum(per, (m) => m.mtInRanges), sum(per, (m) => m.mtCells)));
row('山脈（200 格以上）每個世界幾條', (per) => avg(per.map((m) => m.ranges)).toFixed(1));
row('高度 0／1／2／3／4（能走的格子）', (per) => [0, 1, 2, 3, 4].map((h) => pct(sum(per, (m) => m.hist[h]), sum(per, (m) => m.pass)).replace('%', '')).join('／') + '%');
row('湖：每個世界幾片', (per) => avg(per.map((m) => m.lakes.length)).toFixed(1));
const bucket = (lo, hi) => (per) => avg(per.map((m) => m.lakes.filter((n) => n >= lo && n <= hi).length)).toFixed(1);
row('　1～4 格', bucket(1, 4));
row('　5～19 格', bucket(5, 19));
row('　20～99 格', bucket(20, 99));
row('　100～399 格', bucket(100, 399));
row('　400 格以上', bucket(400, Infinity));
row('　最大一片（各種子中位數）', (per) => String(med(per.map((m) => Math.max(0, ...m.lakes)))));
row('水佔比', (per) => pct(sum(per, (m) => m.lakes.reduce((s, n) => s + n, 0)), sum(per, (m) => m.total)));
row('相鄰高度差 ≥2 的格數（每世界）', (per) => avg(per.map((m) => m.cliff)).toFixed(1));
row('山壁格數（每世界）', (per) => avg(per.map((m) => m.walls)).toFixed(0));
row('巨石格數（每世界，不含地貌）', (per) => avg(per.map((m) => m.rocks)).toFixed(0));
row('隘口（每世界）', (per) => avg(per.map((m) => m.passes)).toFixed(1) + (sum(per, (m) => m.passMiss) ? `（放不下 ${sum(per, (m) => m.passMiss)}）` : ''));
row('隘口繞路：開著／堵住的步數（中位數）', (per) => {
  const d = per.flatMap((m) => m.detours);
  if (!d.length) return '-';
  return `${med(d.map((x) => x.open))}／${med(d.map((x) => x.shut))}`;
});
row('聚落（村莊＋城鎮，每世界）', (per) => `${avg(per.map((m) => m.villages)).toFixed(1)}（城鎮 ${avg(per.map((m) => m.towns)).toFixed(1)}）`);
row('聚落背後擺湖／山壁（總數）', (per) => `${sum(per, (m) => m.backdrops.lake)}／${sum(per, (m) => m.backdrops.wall)}`);
row('出口被擋、生成時打通（總數）', (per) => String(sum(per, (m) => m.exitsFixed)));
row('長滿後仍走不出去的出口／出口總數', (per) => `${sum(per, (m) => m.exitsBlocked)}／${sum(per, (m) => m.exits)}`);
row('採集點走不到／總數', (per) => `${sum(per, (m) => m.nodesBad)}／${sum(per, (m) => m.nodes)}`);
row('能走但從出生點走不到的格子', (per) => pct(sum(per, (m) => m.unreach), sum(per, (m) => m.pass)));
row('能走的格子佔比', (per) => pct(sum(per, (m) => m.pass), sum(per, (m) => m.total)));
row('怪物地點的候選（地形錯位＋斷崖）：開局／之後每段（平均）', (per) => `${avg(per.map((m) => m.sites0)).toFixed(1)}／${avg(per.flatMap((m) => m.sites)).toFixed(1)}`);
row('　其中一處都沒有的段', (per) => `${sum(per, (m) => m.sites.filter((n) => n === 0).length + (m.sites0 === 0 ? 1 : 0))}／${sum(per, (m) => m.sites.length + 1)}`);
row('生成一個世界（毫秒，平均）', (per) => avg(per.map((m) => m.ms)).toFixed(0));

console.log(`種子 ${SEEDS} 個（各開局＋16 段，長滿 288×288）\n`);
console.log('| 項目 | ' + results.map((r) => r.name).join(' | ') + ' |');
console.log('|---|' + results.map(() => '---').join('|') + '|');
for (const r of rows) console.log('| ' + r.join(' | ') + ' |');
