// 生物的回合逐格播放：戰鬥的結果在紀錄裡一次算完，畫面再照紀錄一步一步演出來——
// 生物一格一格走過來、一隻動完換下一隻、出手時停一下；訊息欄也跟著播到哪一筆才顯示到哪一筆。
// 播放中不接受輸入（busy），播完回到現在的狀態

const STEP_MS = 60; // 生物走一格
const HIT_MS = 220; // 出手、倒下停一下

// 從 before（播放前的生物狀態）照紀錄 fromId 之後的每一筆，排出每一格畫面：{ creatures, upTo（訊息顯示到第幾筆）, ms }
export function framesFrom(records, before) {
  let cur = before;
  const set = (id, patch) => {
    cur = { ...cur, [id]: { ...cur[id], ...patch } };
  };
  const frames = [];
  for (const rec of records) {
    const d = rec.data ?? {};
    if (rec.verb === 'engage')
      for (const f of [...d.foes, ...(d.flee ?? [])]) if (!cur[f.id]) set(f.id, { x: f.x, y: f.y, hp: f.hp });
    if (rec.verb === 'cmove') {
      for (const p of d.path ?? [d.to]) {
        set(rec.actor, { x: p.x, y: p.y });
        frames.push({ creatures: cur, upTo: rec.id, ms: STEP_MS });
      }
      continue;
    }
    if (rec.verb === 'attack' && rec.actor === 'player')
      set(rec.target, { hp: d.hp, ...(d.hp <= 0 ? { dead: true } : {}) });
    const pause = rec.verb === 'attack' ? HIT_MS : 0;
    frames.push({ creatures: cur, upTo: rec.id + 1, ms: pause });
  }
  return frames;
}

// redraw()：重畫；invalidate(ids)：那些生物移動前後佔的格子丟掉畫面快取
export function createPlayback({ game, redraw, invalidate }) {
  let timer = null;
  let upTo = null;

  function finish() {
    clearTimeout(timer);
    timer = null;
    upTo = null;
    game.showCreatures(null);
    redraw();
  }

  return {
    get busy() {
      return timer !== null;
    },
    // 訊息欄顯示到第幾筆紀錄（不在播放時是 null＝全部）
    get upTo() {
      return upTo;
    },
    // 有生物移動才播；沒有就直接照狀態畫
    play(before, fromId) {
      const records = game.log.all().slice(fromId);
      if (!records.some((r) => r.verb === 'cmove')) return;
      const frames = framesFrom(records, before);
      let i = 0;
      let shown = before;
      game.showCreatures(before);
      upTo = fromId;
      const next = () => {
        if (i >= frames.length) return finish();
        const f = frames[i++];
        const changed = Object.keys(f.creatures).filter((id) => f.creatures[id] !== shown[id]);
        invalidate(changed); // 舊位置
        game.showCreatures(f.creatures);
        invalidate(changed); // 新位置
        shown = f.creatures;
        upTo = f.upTo;
        redraw();
        timer = setTimeout(next, f.ms);
      };
      timer = setTimeout(next, 0);
    },
  };
}
