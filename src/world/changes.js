// 世界加上「採過的格子」：世界本身只由種子生成、建好後不改（world.js），採集造成的變化記在遊戲狀態的 cells，
// 這裡把兩者疊起來，讓走路、尋路、查看、畫面都看到同一個樣子。
// cells：{ "x,y": { o 物件編號（-1 是沒了）, left 還能採幾次, comp 讀出來的組成, picked 採過了 } }

import { PART_MID, PART_TRUNK } from './footprint.js';

export const cellKey = (x, y) => `${x},${y}`;

// getCells() 回傳現在的 cells（狀態會換新物件，所以每次都問）
export function withChanges(world, data, getCells) {
  const changeAt = (x, y) => getCells()[cellKey(x, y)];
  const changed = (ch, x, y) => ch && ch.o !== world.objectAt(x, y);

  function objectAt(x, y) {
    const ch = changeAt(x, y);
    return ch ? ch.o : world.objectAt(x, y);
  }

  function objectPartAt(x, y) {
    const ch = changeAt(x, y);
    return changed(ch, x, y) ? PART_MID : world.objectPartAt(x, y);
  }

  function isPassable(x, y) {
    const ch = changeAt(x, y);
    if (!ch) return world.isPassable(x, y);
    const c = world.cell(x, y);
    if (!c || (c.water && !c.water.passable) || !c.surface.passable) return false;
    if (ch.o < 0) return true;
    return data.objects[ch.o].passable && objectPartAt(x, y) !== PART_TRUNK;
  }

  return {
    ...world,
    base: world, // 沒有變化的世界（測試、量測用）
    changeAt,
    objectAt,
    objectPartAt,
    isPassable,
    anchorAt(x, y) {
      const ch = changeAt(x, y);
      if (!changed(ch, x, y)) return world.anchorAt(x, y);
      return ch.o < 0 ? null : { x, y };
    },
    cell(x, y) {
      const c = world.cell(x, y);
      const ch = changeAt(x, y);
      if (!c || !ch) return c;
      const o = ch.o;
      return {
        ...c,
        object: o < 0 ? null : data.objects[o],
        trunk: objectPartAt(x, y) === PART_TRUNK && o >= 0,
        picked: !!ch.picked,
        worked: ch.left != null,
      };
    },
  };
}
