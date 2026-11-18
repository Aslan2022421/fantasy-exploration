// 生物平常的遊蕩：位置由「種子＋這一群＋現在的時間」算出來，不寫紀錄、不進存檔，讀檔重放結果一樣。
// 每一群每隔一段時間（WANDER.period，每群固定、各群錯開）在落腳處附近（radius 格內）換一個位置，
// 整群照自己的速度（走一格幾刻）一格一格走過去，到了就站著。第 0 段在落腳處。
// 某一隻在新位置放不下（水、走不過去、冒險者站在那裡）就留在上一個位置，再不行就回落腳處的原位

import { creatureCells } from './herds.js';
import { hash01 } from './noise.js';
import { lineSteps } from './path.js';

export const WANDER = {
  herbivore: { period: [240, 720], radius: 6 }, // 草食：1～3 分鐘換一次吃草的位置
  predator: { period: [120, 360], radius: 12 }, // 掠食：巡得勤、範圍大
  omnivore: { period: [120, 360], radius: 12 }, // 混食（怪物）：照掠食的節奏
};

// 第 k 段要去的位置（相對落腳處）
function spot(seed, home, k, radius) {
  if (k <= 0) return { x: 0, y: 0 };
  const a = hash01(seed, home.x, home.y, 7000 + 2 * k) * Math.PI * 2;
  const r = Math.round(hash01(seed, home.x, home.y, 7001 + 2 * k) * radius);
  return { x: Math.round(Math.cos(a) * r), y: Math.round(Math.sin(a) * r) };
}

// 這一群在 time 時相對落腳處偏了多少：{ now 現在, prev 這一段出發前 }
export function herdOffset(seed, herd, sp, time) {
  const cfg = WANDER[sp.diet] ?? WANDER.herbivore;
  const home = herd.members[0];
  const [lo, hi] = cfg.period;
  const period = lo + Math.floor(hash01(seed, home.x, home.y, 6990) * (hi - lo + 1));
  const phase = Math.floor(hash01(seed, home.x, home.y, 6991) * period);
  const t = Math.max(0, time) + phase;
  const k = Math.floor(t / period);
  const from = spot(seed, home, k - 1, cfg.radius);
  const to = spot(seed, home, k, cfg.radius);
  const steps = lineSteps(from, to);
  const n = Math.min(steps.length, Math.floor((t - k * period) / sp.moveTicks));
  return { now: n ? steps[n - 1] : from, prev: from };
}

// 第 m 隻在 time 時的錨點；hero 是冒險者站的格子（生物不會走到他身上）
export function wanderAt(world, sp, herd, m, time, hero) {
  const base = herd.members[m];
  const { now, prev } = herdOffset(world.seed, herd, sp, time);
  const fits = (a) =>
    creatureCells(sp, a).every(
      (c) =>
        world.groundPassable(c.x, c.y) && world.waterAt(c.x, c.y) < 0 && !(hero && c.x === hero.x && c.y === hero.y),
    );
  for (const off of [now, prev]) {
    const a = { x: base.x + off.x, y: base.y + off.y };
    if (fits(a)) return a;
  }
  return base;
}
