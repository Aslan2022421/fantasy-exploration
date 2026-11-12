// 按鍵 → 方向：方向鍵四方向，數字鍵盤八方向（看實體鍵位，不管 NumLock）

const KEYS = {
  ArrowUp: 'n',
  ArrowDown: 's',
  ArrowLeft: 'w',
  ArrowRight: 'e',
  Numpad8: 'n',
  Numpad2: 's',
  Numpad4: 'w',
  Numpad6: 'e',
  Numpad7: 'nw',
  Numpad9: 'ne',
  Numpad1: 'sw',
  Numpad3: 'se',
};

export function directionFor(code) {
  return KEYS[code] ?? null;
}
