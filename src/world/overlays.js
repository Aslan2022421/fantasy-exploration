// 遊戲看到的世界：種子生出來的世界（world.js）一層一層疊上狀態造成的變化，
// 走路、尋路、查看、畫面都看同一個樣子。由內到外：
// 採過的格子（changes.js）→ 據點的範圍與寶箱（nest-overlay.js）→ 聚落的範圍與經濟（settle-overlay.js）
// → 生物的遊蕩與打過的狀態（creatures.js）→ 村民（villagers.js）

import { withChanges } from './changes.js';
import { withCreatures } from './creatures.js';
import { withNests } from './nest-overlay.js';
import { withSettlements } from './settle-overlay.js';
import { withVillagers } from './villagers.js';

// get：{ state() 現在的狀態, creatures() 要顯示的生物（播放中暫時換掉）}
export function overlayWorld(base, data, get) {
  const st = get.state;
  const clock = () => ({ time: st().time, hero: st().player }); // 生物、村民照時間走動，不會走到冒險者身上
  const changed = withChanges(base, data, () => st().cells);
  const nests = withNests(changed, data, () => st().nests);
  const settles = withSettlements(
    nests,
    data,
    () => st().settles,
    () => st().cells,
  );
  const creatures = withCreatures(settles, data, get.creatures, clock, () => st().nests);
  return withVillagers(creatures, data, clock);
}
