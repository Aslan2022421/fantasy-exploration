// 回合迴圈：ROT.js 的行動排程（Scheduler.Action）＋引擎（Engine）。
// 排程照時間叫下一位行動；輪到冒險者時引擎停下等輸入，冒險者做完一個花時間的動作就交回。
// 階段 1 只有冒險者一位；之後的生物加進同一個排程即可

import { Engine, Scheduler } from 'rot-js';

export function createTurnLoop() {
  const scheduler = new Scheduler.Action();
  let resolveTurn = null; // 輪到冒險者時，用來交回控制權

  const player = {
    act: () =>
      new Promise((resolve) => {
        resolveTurn = resolve;
      }),
  };
  // ROT.js 把起始時間 0 當成「沒給」改用預設的 1，所以第一回合在時間 1；對外的時間扣掉這個起點
  const START = 1;
  scheduler.add(player, true, START);
  const engine = new Engine(scheduler);

  return {
    start() {
      engine.start();
    },
    // 現在是否輪到冒險者（可以接受輸入）
    get playersTurn() {
      return resolveTurn !== null;
    },
    // 冒險者做完一個花 duration 時間的動作
    endTurn(duration = 1) {
      if (!resolveTurn) return false;
      scheduler.setDuration(duration);
      const resolve = resolveTurn;
      resolveTurn = null;
      resolve();
      return true;
    },
    // 排程上現在的時間
    get time() {
      return scheduler.getTime() - START;
    },
  };
}
