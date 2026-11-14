// 鍵盤移動：
// - 數字鍵盤 1～9 直接八方向（看實體鍵位，不管 NumLock）
// - 方向鍵與 WASD：同時按兩個就斜走。先按下的鍵等 CHORD_MS 看第二個鍵來不來，
//   來了就照兩個鍵合起來的方向走一步；兩個一起按住連發時一直斜走

export const CHORD_MS = 60;

const NUMPAD = {
  Numpad7: [-1, -1],
  Numpad8: [0, -1],
  Numpad9: [1, -1],
  Numpad4: [-1, 0],
  Numpad6: [1, 0],
  Numpad1: [-1, 1],
  Numpad2: [0, 1],
  Numpad3: [1, 1],
};

const CHORD_KEYS = {
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  KeyW: [0, -1],
  KeyS: [0, 1],
  KeyA: [-1, 0],
  KeyD: [1, 0],
};

// onStep(dx, dy) 在決定要走一步時呼叫；wait／cancel 可換成假的計時器方便測試
export function createKeyboard(onStep, wait = setTimeout, cancel = clearTimeout) {
  const held = new Set();
  let chord = null;

  // 按住的方向鍵合起來的方向（相反的兩個鍵互相抵消）
  const combined = () => {
    let dx = 0;
    let dy = 0;
    for (const k of held) {
      dx += CHORD_KEYS[k][0];
      dy += CHORD_KEYS[k][1];
    }
    return [Math.sign(dx), Math.sign(dy)];
  };
  const fire = ([dx, dy], fallback) => {
    const [x, y] = dx || dy ? [dx, dy] : fallback;
    if (x || y) onStep(x, y);
  };

  return {
    // 回傳 true 表示這是移動鍵（呼叫端要擋掉瀏覽器預設動作）
    keydown(code, repeat = false) {
      if (NUMPAD[code]) {
        onStep(...NUMPAD[code]);
        return true;
      }
      const v = CHORD_KEYS[code];
      if (!v) return false;
      held.add(code);
      const now = combined();
      if (chord) {
        cancel(chord);
        chord = null;
        fire(now, v);
        return true;
      }
      if (repeat || (now[0] && now[1])) {
        fire(now, v);
        return true;
      }
      chord = wait(() => {
        chord = null;
        fire(combined(), v); // 很快就放開的話，照原本那個鍵走
      }, CHORD_MS);
      return true;
    },
    keyup(code) {
      held.delete(code);
    },
    clear() {
      held.clear();
      if (chord) cancel(chord);
      chord = null;
    },
  };
}
