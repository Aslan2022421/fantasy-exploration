// 冒險者的動作：走一步、點地圖自動走、選定目標（查看）、Q 對目標動手（挖礦、伐木、採集、攻擊生物）、
// 戰鬥中結束回合、休息。花時間的動作要輪到冒險者才做，做完把回合交回排程；每個動作都寫進紀錄
// - 右鍵選定一格當目標並查看；能採的來源換成那處（樹冠換成樹幹那格），同一格再選一次就收起
// - 撞上能採的來源（樹幹）或生物不動手，只選定成目標
// - Q：沒貼著目標先走到旁邊再動手（遠程武器在射程內直接射）；沒選目標時採腳下那處（矮叢、草本）；
//   採完還能採就留著當目標
// - 戰鬥中走路受這一回合剩下的格數限制；攻擊完自動結束這一回合；生物開始撲上來時自動走路停下

import { DATA } from '../data/load.js';
import { distanceTo } from '../world/chase.js';
import { findPath, findPathNextTo, stepDirection } from '../world/path.js';

const STEP_MS = 70; // 自動走每一步間隔

// persist()：存檔並把訊息欄捲回最新；redraw()：重畫；describe(cell)：查看的文字
export function createActions({ game, turns, worldView, describe, persist, redraw }) {
  const world = game.world;
  const player = () => game.state.player;
  const same = (a, b) => a && b && a.x === b.x && a.y === b.y;
  let walking = []; // 自動走剩下的路線
  let walkPlan = null; // 這次自動走是哪一筆「決定」引起的
  let walkTimer = null;
  let onArrive = null; // 走到了之後要做的事
  let examined = null; // 查看中、選定成目標的那一格
  let targetId = null; // 選定的是生物時記牠的 id（牠會移動，格子跟著換）

  // 新寫進的紀錄裡動到的生物格子（移動、倒下，紀錄的 cells 是格子陣列）：丟掉畫面快取
  function refresh(fromId) {
    const cells = [];
    for (let i = fromId; i < game.log.size; i++) {
      const c = game.log.get(i).data?.cells;
      if (Array.isArray(c)) cells.push(...c);
    }
    if (cells.length) worldView.invalidateCells(cells);
  }

  // 選定的生物還活著就把目標格子換到牠現在的位置，不然收起
  function followTarget() {
    const now = targetId && world.creatureById(targetId);
    examined = now ? { x: now.member.x, y: now.member.y } : null;
    if (!now) targetId = null;
  }

  function act(fn) {
    if (!turns.playersTurn) return null;
    const before = game.log.size;
    const rec = fn();
    if (rec && !rec.refused) {
      turns.endTurn(rec.data?.duration ?? 0);
      refresh(before);
      // 選定的生物留著當目標（跟著牠走），其他動作收起
      if (targetId) followTarget();
      else examined = null;
      persist();
    }
    return rec;
  }

  // 戰鬥的動作（攻擊、結束回合、休息）：做不到時記一筆原因
  function fightAct(fn, target = null, cause = null) {
    const r = act(fn);
    if (r?.refused) note(() => game.refuse(r.refused, target, cause));
    return r;
  }

  function note(fn) {
    fn();
    persist();
  }

  function stop() {
    clearInterval(walkTimer);
    walkTimer = null;
    walking = [];
    walkPlan = null;
    onArrive = null;
  }

  function walk(steps, to, arrive = null) {
    stop();
    note(() => {
      walkPlan = game.plan(to, steps.length).id;
    });
    walking = steps.slice();
    onArrive = arrive;
    // 每一拍走一步；走完的下一拍（又輪到冒險者時）才做走到之後的事
    walkTimer = setInterval(() => {
      if (!turns.playersTurn) return; // 還沒輪到，下一拍再走
      if (!walking.length) {
        const then = onArrive;
        const cause = walkPlan;
        stop();
        then?.(cause);
      } else {
        const fighting = !!game.state.combat;
        const plan = walkPlan;
        const rec = act(() => game.move(stepDirection(player(), walking[0]), plan));
        if (rec) {
          walking.shift();
          if (!fighting && game.state.combat) stop(); // 生物撲上來了
        } else {
          note(() => (outOfMoves() ? game.refuse('moves', null, plan) : game.blocked(plan)));
          stop();
        }
      }
      redraw();
    }, STEP_MS);
  }

  // 採 src 一次；變了的格子丟掉畫面快取
  function gatherAt(src, cause = null) {
    const rec = act(() => game.gather(src, cause));
    if (!rec) return;
    worldView.invalidateCells(Object.keys(rec.data.cells).map((k) => ({ x: +k.split(',')[0], y: +k.split(',')[1] })));
    if (game.sourceAt(src)) examined = { x: src.x, y: src.y };
  }

  // 這格上的生物當成一處目標：{ id, x, y（那一隻的錨點）, cells, species（資料的 id）}，不是生物回傳 null
  function creatureSrc(cell) {
    const cr = cell && world.creatureAt(cell.x, cell.y);
    return cr
      ? { id: cr.id, x: cr.member.x, y: cr.member.y, cells: cr.cells, species: DATA.species[cr.species].id }
      : null;
  }

  const inRange = (cr) => distanceTo(cr.cells, player()) <= game.hero.range;
  const outOfMoves = () => game.state.combat && game.state.combat.moved >= game.hero.speed;

  // 攻擊一隻生物；這一下擲完就結束這一回合，生物接著動。牠還活著就繼續當目標
  function attackAt(cr, cause = null) {
    targetId = cr.id;
    const r = fightAct(() => game.attack(cr.id, cause), { x: cr.x, y: cr.y }, cause);
    if (r?.verb === 'attack' && game.state.combat) endTurnNow();
    followTarget();
  }

  // 結束回合不花排程上的時間（回合的時間在紀錄裡算），所以不等排程輪到，攻擊完可以馬上接著做
  function endTurnNow() {
    const before = game.log.size;
    if (!game.endTurn()) return null;
    refresh(before);
    if (targetId) followTarget();
    persist();
    return { verb: 'endturn' };
  }

  function look(cell) {
    const src = game.sourceAt(cell);
    const cr = src ? null : creatureSrc(cell);
    const at = src || cr ? { x: (src ?? cr).x, y: (src ?? cr).y } : cell;
    if (same(examined, at)) {
      examined = null;
      targetId = null;
      return;
    }
    examined = at;
    targetId = cr?.id ?? null;
    note(() => game.examine(cell, describe(cell)));
  }

  return {
    get examined() {
      return examined;
    },
    get walking() {
      return walking;
    },
    stop,
    look,
    step(dx, dy) {
      stop();
      const to = { x: player().x + dx, y: player().y + dy };
      const rec = act(() => game.move(stepDirection(player(), to)));
      if (!rec && outOfMoves()) {
        note(() => game.refuse('moves'));
        return;
      }
      const src = rec ? null : (game.sourceAt(to) ?? creatureSrc(to));
      if (src && !same(examined, src)) look(to);
    },
    // 空白鍵在戰鬥中：不攻擊、直接結束這一回合（例如只移動），生物接著動
    endTurn() {
      stop();
      return endTurnNow();
    },
    rest() {
      stop();
      return fightAct(() => game.rest());
    },
    go(cell) {
      examined = null;
      targetId = null;
      const steps = findPath(world, player(), cell);
      if (steps.length) walk(steps, cell);
    },
    // 空白鍵：有選定的目標、畫出路線時出發，走到路線終點；能採的來源與生物走到旁邊，不動手（動手按 Q）
    startRoute() {
      if (!examined || walking.length) return false;
      const target = examined;
      const route = this.shownPath();
      if (!route?.reachable || !route.steps.length) return false;
      walk(route.steps, target);
      return true;
    },
    actOnTarget() {
      if (targetId) followTarget();
      const cr = creatureSrc(examined);
      if (cr) {
        // 遠程武器看得到、在射程內就直接射；不然先走到旁邊
        if (game.hero.ranged && game.fight.foe(cr.id) && inRange(cr)) return attackAt(cr);
        const steps = findPathNextTo(world, player(), cr);
        if (steps === null) return;
        if (steps.length) walk(steps, cr, (cause) => attackAt(cr, cause));
        else attackAt(cr);
        return;
      }
      const src = (examined && game.sourceAt(examined)) || game.sourceAt(player());
      if (!src) return;
      const steps = findPathNextTo(world, player(), src);
      if (steps === null) return;
      if (steps.length) walk(steps, src, (cause) => gatherAt(src, cause));
      else gatherAt(src);
    },
    // 要畫的路線：走路中顯示剩下的路，否則顯示目標怎麼走（能採的來源走到旁邊；礦坑貼著佔的任一格就算，跟 Q 一樣）
    shownPath() {
      if (walking.length) return { steps: walking, reachable: true };
      if (!examined) return null;
      const cr = creatureSrc(examined);
      if (cr) {
        const steps = findPathNextTo(world, player(), cr);
        return { steps: steps ?? [], reachable: steps !== null };
      }
      const src = game.sourceAt(examined);
      if (src) {
        const steps = findPathNextTo(world, player(), src);
        return { steps: steps ?? [], reachable: steps !== null };
      }
      const steps = findPath(world, player(), examined);
      return { steps, reachable: steps.length > 0 };
    },
  };
}
