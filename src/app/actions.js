// 冒險者的動作：走一步、點地圖自動走、選定目標（查看）、Q 對目標動手（挖礦、伐木、採集；之後怪物是攻擊）。
// 花時間的動作要輪到冒險者才做，做完把回合交回排程；每個動作都寫進紀錄
// - 右鍵選定一格當目標並查看；能採的來源換成那處（樹冠換成樹幹那格），同一格再選一次就收起
// - 撞上能採的來源（岩壁、礦脈、樹幹）不動手，只選定成目標
// - Q：沒貼著目標先走到旁邊再動手；沒選目標時採腳下那處（矮叢、草本）；採完還能採就留著當目標

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

  function act(fn) {
    if (!turns.playersTurn) return null;
    const rec = fn();
    if (rec) {
      turns.endTurn(rec.data.duration ?? 1);
      examined = null;
      persist();
    }
    return rec;
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
        const rec = act(() => game.move(stepDirection(player(), walking[0]), walkPlan));
        if (rec) walking.shift();
        else {
          note(() => game.blocked(walkPlan));
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

  function look(cell) {
    const src = game.sourceAt(cell);
    const at = src ? { x: src.x, y: src.y } : cell;
    if (same(examined, at)) {
      examined = null;
      return;
    }
    examined = at;
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
      const src = rec ? null : game.sourceAt(to);
      if (src && !same(examined, src)) look(to);
    },
    go(cell) {
      examined = null;
      const steps = findPath(world, player(), cell);
      if (steps.length) walk(steps, cell);
    },
    actOnTarget() {
      const src = (examined && game.sourceAt(examined)) || game.sourceAt(player());
      if (!src) return;
      const steps = findPathNextTo(world, player(), src);
      if (steps === null) return;
      if (steps.length) walk(steps, src, (cause) => gatherAt(src, cause));
      else gatherAt(src);
    },
    // 要畫的路線：走路中顯示剩下的路，否則顯示目標怎麼走（能採的來源走到旁邊）
    shownPath() {
      if (walking.length) return { steps: walking, reachable: true };
      if (!examined) return null;
      if (game.sourceAt(examined)) {
        const steps = findPathNextTo(world, player(), examined);
        return { steps: steps ?? [], reachable: steps !== null };
      }
      const steps = findPath(world, player(), examined);
      return { steps, reachable: steps.length > 0 };
    },
  };
}
