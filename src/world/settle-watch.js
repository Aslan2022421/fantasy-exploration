// 聚落跟著冒險者的動作變（見 design/PLAN.md「聚落」）：
// - 採光一處來源前後，附近聚落的經濟標籤變了就各記一筆（不改狀態，訊息欄寫一行）
// - 跟村民說話：要貼著，記一筆（不花時間、不改狀態），寫下聽到哪幾則傳聞
// 人口只在據點的對抗裡變（nest-watch.js）

import { ECON_TAGS, SETTLE } from './settlements.js';

// env：{ world, state()（現在的狀態）, record(entry), news(聚落, 村民 id) 這個人現在會講的傳聞 }
export function createSettleWatch(env) {
  const { world } = env;
  return {
    // 採集之前：附近聚落現在的經濟標籤
    econBefore(at) {
      return world
        .settlesNear(at.x, at.y, SETTLE.sources + 1)
        .map((s) => ({ s, tag: world.settleEcon(s, env.state().cells).tag }));
    },
    // 採集之後：跟之前比，變了的記一筆
    econAfter(before, cause) {
      for (const { s, tag } of before) {
        const now = world.settleEcon(s, env.state().cells).tag;
        if (now === tag) continue;
        env.record({
          verb: 'settletag',
          target: { ...s.plaza },
          data: { settle: s.id, name: s.name, what: 'econ', from: ECON_TAGS[tag], to: ECON_TAGS[now] },
          cause,
        });
      }
    },
    talk(id, cause) {
      const v = world.npcById(id);
      const p = env.state().player;
      if (!v || Math.max(Math.abs(v.member.x - p.x), Math.abs(v.member.y - p.y)) > 1) return null;
      // heard：這次聽到的傳聞（事件的紀錄編號），地圖照這個標出聽過的地方
      const heard = (env.news?.(v.settle, id) ?? []).map((n) => n.id);
      return env.record({
        verb: 'talk',
        target: { ...v.member },
        data: { npc: id, name: v.villager.name, settle: v.settle.id, settleName: v.settle.name, heard },
        cause,
      });
    },
  };
}
